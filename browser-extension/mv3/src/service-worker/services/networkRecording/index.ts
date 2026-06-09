import { tabService, TAB_SERVICE_DATA } from "../tabService";
import { CLIENT_MESSAGES, EXTENSION_MESSAGES } from "common/constants";
import { ChangeType } from "common/storage";
import { injectWebAccessibleScript } from "../utils";
import { isExtensionEnabled } from "../../../utils";
import { onVariableChange, Variable } from "../../variable";
import {
  buildCompletedEntry,
  buildErrorEntry,
  buildSdkEntry,
  CorrelationData,
  NetworkHarEntry,
  SdkNetworkPayload,
} from "./harBuilder";

// Recording config from the LTS start call. All optional.
// - maxDuration: time cap (no cap when omitted; see isOverMaxDuration).
// - maxPayloadSize: per-body cap (bytes) applied to SDK-captured request/response bodies (v2);
//   defaults to DEFAULT_MAX_PAYLOAD_SIZE when omitted.
// - fallbackUrl: where to send the user on stop if the originating LTS tab+window are both gone;
//   defaults to DEFAULT_FALLBACK_URL when omitted.
export interface NetworkRecordingConfig {
  maxDuration?: number;
  maxPayloadSize?: number;
  fallbackUrl?: string;
}

const DEFAULT_MAX_PAYLOAD_SIZE = 200 * 1024; // 200 KB per-body cap (LTS-overridable via config.maxPayloadSize)

interface NetworkRecordingState {
  targetTabId: number;
  url: string;
  startTime: number;
  config: NetworkRecordingConfig;
  // The LTS tab/window that started the recording. On stop we return focus here.
  // Both may be gone by stop time (user closed the tab/window mid-recording).
  senderTabId?: number;
  senderWindowId?: number;
  // Per-recording max-duration auto-stop timer (only set when config.maxDuration is given).
  maxDurationTimer?: ReturnType<typeof setTimeout>;
}

// Opened only when the originating LTS tab AND its window are both gone at stop time, so the user
// lands back in an LTS context. LTS can override per-recording via config.fallbackUrl (e.g. a
// session-specific deep link); this is the default when it doesn't.
const DEFAULT_FALLBACK_URL = "https://www.browserstack.com";

const activeRecordings = new Map<number, NetworkRecordingState>();
const recordingEntries = new Map<number, NetworkHarEntry[]>();

// LTS streaming subscribers, keyed by target tabId. One LTS page may subscribe to many tabs,
// but a given recorded tab has exactly one port (one consumer per recording).
const subscriptions = new Map<number, Set<chrome.runtime.Port>>();

// In v1 the LTS port is the only data channel, so a recording is pointless once its consumer
// is gone — every entry after that is buffered for nobody. When a tab's port disconnects we
// give LTS a short window to reconnect (it dedups on _request_id, so a brief drop+reconnect is
// expected). If nobody re-subscribes within the window, the recording is stopped.
const disconnectGraceTimers = new Map<number, ReturnType<typeof setTimeout>>();
const DISCONNECT_GRACE_MS = 3_000;

// webRequest requestId -> request-start correlation data (internal only, never surfaced).
const correlationMap = new Map<string, CorrelationData>();

const NETWORK_RECORDING_PORT = "network-recording";

// Opaque, globally-unique id per entry. crypto.randomUUID() (not a counter) so ids never
// collide across a service-worker restart mid-recording — LTS dedups on _request_id across
// reconnects, and a counter would reset to 0 on restart and re-issue ids LTS already saw.
const nextRequestId = (): string => crypto.randomUUID();

// Accessed dynamically so the Firefox build (which has no sidePanel) lints clean —
// the chrome.sidePanel API surface is Chrome/Edge only. onClosed/onOpened are Chrome 142+/141+,
// so they're optional and feature-detected before use.
type PanelInfo = { path: string; tabId?: number; windowId: number };
const sidePanelApi = (chrome as any).sidePanel as
  | {
      setOptions: (opts: { tabId?: number; path?: string; enabled: boolean }) => Promise<void>;
      open: (opts: { tabId: number }) => Promise<void>;
      onClosed?: { addListener: (cb: (info: PanelInfo) => void) => void };
      onOpened?: { addListener: (cb: (info: PanelInfo) => void) => void };
    }
  | undefined;

if (sidePanelApi) {
  sidePanelApi.setOptions({ enabled: false }).catch(() => {});

  // When the recorded tab's panel is closed, show the floating reopen widget on that tab; hide it
  // again when the panel reopens. Feature-detected (Chrome 142+/141+); older Chrome just won't get
  // the widget.
  //
  // Resolve which recorded tab a panel open/close refers to. Chrome gives info.tabId only for
  // tab-specific panels; if it's absent, fall back to an active recording.
  const resolveRecordedTab = (info: PanelInfo): number | undefined => {
    if (info.tabId !== undefined && activeRecordings.has(info.tabId)) return info.tabId;
    if (info.tabId !== undefined) return undefined; // a different (non-recorded) panel
    // No tabId: pick an active recording whose tab is in this window.
    for (const [tabId] of activeRecordings) {
      // best-effort; we don't store windowId, so just take the first active recording
      return tabId;
    }
    return undefined;
  };

  sidePanelApi.onClosed?.addListener((info) => {
    const tabId = resolveRecordedTab(info);
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, { action: CLIENT_MESSAGES.SHOW_NETWORK_RECORDING_WIDGET }).catch(() => {});
    }
  });

  sidePanelApi.onOpened?.addListener((info) => {
    const tabId = resolveRecordedTab(info);
    if (tabId !== undefined) {
      chrome.tabs.sendMessage(tabId, { action: CLIENT_MESSAGES.HIDE_NETWORK_RECORDING_WIDGET }).catch(() => {});
    }
  });
}

// --- Service-worker keepalive ----------------------------------------------------------------
// An open port does NOT keep an MV3 SW alive — only events/API calls reset the 30s idle timer.
// During idle gaps (user reading a page, no requests firing) the SW would die and lose the
// in-memory buffer. A ~20s API-ping interval (well under the 30s limit) keeps the SW warm for the
// whole recording, so we don't need chrome.alarms: max-duration runs off a per-recording setTimeout
// (see startNetworkRecording) and the correlation-map sweep piggybacks on the ping below.
//
// Accepted edge case: the SW can still be killed abruptly on OS sleep/wake regardless of the ping.
// While asleep nothing is being recorded, so a max-duration "overrun" is meaningless; on wake the
// next network event (onCompleted's inline isOverMaxDuration check) or the next ping stops it — a
// few seconds' delay on a fully idle tab, never lost data. Not worth an alarms permission to cover.
const KEEPALIVE_PING_MS = 20_000;
const CORRELATION_TTL_MS = 60_000;
let keepalivePingId: ReturnType<typeof setInterval> | undefined;

const sweepStaleCorrelations = () => {
  const now = Date.now();
  correlationMap.forEach((data, requestId) => {
    if (now - data.startTime > CORRELATION_TTL_MS) {
      correlationMap.delete(requestId);
    }
  });
};

const startKeepalive = () => {
  if (keepalivePingId !== undefined) return;
  keepalivePingId = setInterval(() => {
    // Any extension API call resets the SW idle timer.
    chrome.runtime.getPlatformInfo().catch(() => {});
    // Sweep orphaned correlation entries (request started, never completed/errored) so they
    // don't leak. Normal entries are deleted on completion; this is only the un-correlated tail.
    sweepStaleCorrelations();
  }, KEEPALIVE_PING_MS);
};

const stopKeepaliveIfIdle = () => {
  if (activeRecordings.size > 0) return;
  if (keepalivePingId !== undefined) {
    clearInterval(keepalivePingId);
    keepalivePingId = undefined;
  }
};
// -------------------------------------------------------------------------------------------

// --- Request/response correlation -----------------------------------------------------------
// A HAR entry needs request-side data (start time, request headers) AND response-side data
// (status, response headers, timing), but those arrive on two different webRequest events. We
// stitch them via correlationMap, keyed by the browser's details.requestId (NOT the LTS-facing
// _request_id — that's a separate per-entry UUID):
//   1. onBeforeSendHeaders  → store { startTime, requestHeaders } keyed by requestId.
//   2. onCompleted/onError  → look up + delete that entry (one-shot), merge with response data
//      into one HAR entry via buildCompletedEntry/buildErrorEntry.
//   3. Cache hits have no onBeforeSendHeaders → correlation is undefined; the builder falls back
//      to details.timeStamp + empty request headers. Expected, not an error.
//   4. Orphans (started, never completed/errored — cancelled, navigated away) are swept by the
//      CORRELATION_TTL_MS pass in the keepalive ping.
//
// v2: XHR/Fetch are captured solely by the web-sdk Network interceptor (page script) — it carries
// headers AND bodies. We hard-suppress the webRequest path for "xmlhttprequest" (the resource type
// for both XHR and fetch) so there's exactly one source and no correlation needed for them.
const isSdkOwnedRequest = (type: chrome.webRequest.ResourceType): boolean => type === "xmlhttprequest";

const onBeforeSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
  if (!activeRecordings.has(details.tabId)) return;
  if (isSdkOwnedRequest(details.type)) return; // SDK owns xhr/fetch; don't populate correlationMap for them
  correlationMap.set(details.requestId, {
    startTime: details.timeStamp,
    requestHeaders: details.requestHeaders,
  });
};

// maxDuration is optional with no default — when LTS omits it there is no time cap, and the
// recording runs until the user stops it, the tab closes, or the LTS port disconnects (grace).
const isOverMaxDuration = (recording: NetworkRecordingState): boolean =>
  recording.config.maxDuration !== undefined && Date.now() - recording.startTime > recording.config.maxDuration;

const onRequestCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;

  // Prompt auto-stop on a busy page; the per-recording setTimeout is the backstop for a quiet page.
  if (isOverMaxDuration(recording)) {
    stopNetworkRecording(details.tabId, "max-duration");
    return;
  }

  if (isSdkOwnedRequest(details.type)) return; // xhr/fetch come from the SDK page script, not webRequest

  const correlation = correlationMap.get(details.requestId);
  correlationMap.delete(details.requestId);

  const entry = buildCompletedEntry(details, correlation, nextRequestId());
  recordingEntries.get(details.tabId)?.push(entry);
  deliverEntry(details.tabId, entry);
};

const IGNORED_ERRORS = new Set(["net::ERR_CACHE_MISS", "net::ERR_ABORTED", "net::ERR_BLOCKED_BY_CLIENT"]);

const onRequestError = (details: chrome.webRequest.WebResponseErrorDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;

  if (isSdkOwnedRequest(details.type)) return; // xhr/fetch come from the SDK page script, not webRequest

  const correlation = correlationMap.get(details.requestId);
  correlationMap.delete(details.requestId);

  if (IGNORED_ERRORS.has(details.error)) return;

  const entry = buildErrorEntry(details, correlation, nextRequestId(), details.error);
  recordingEntries.get(details.tabId)?.push(entry);
  deliverEntry(details.tabId, entry);
};

/** Deliver a captured entry to the internal sidepanel and any subscribed LTS ports. */
const deliverEntry = (tabId: number, entry: NetworkHarEntry) => {
  // Internal sidepanel (fire-and-forget; panel may be closed).
  chrome.runtime
    .sendMessage({
      action: CLIENT_MESSAGES.NETWORK_EVENT_CAPTURED,
      entry,
      tabId,
    })
    .catch(() => {});

  // External LTS subscribers.
  const subs = subscriptions.get(tabId);
  subs?.forEach((port) => {
    try {
      port.postMessage({ type: "entry", entry });
    } catch {
      // Port died between events; onDisconnect will clean it up.
    }
  });
};

/**
 * v2: an XHR/Fetch body+headers captured by the SDK page script (networkBodyRecorder) arrives
 * here via the content-script relay. These are the SOLE source for xhr/fetch (webRequest is
 * hard-suppressed for them), so we just build the HAR entry and feed the same buffer + stream
 * path as v1 — no correlation. `tabId` comes from the message sender.
 */
export const onNetworkBodyCaptured = (tabId: number | undefined, payload: SdkNetworkPayload | undefined) => {
  if (tabId === undefined || !payload) return;
  if (!activeRecordings.has(tabId)) return; // not recording this tab (stale page script / race)

  const entry = buildSdkEntry(payload, nextRequestId());
  recordingEntries.get(tabId)?.push(entry);
  deliverEntry(tabId, entry);
};

// Why a recording ended — drives the message the side panel shows.
//   user               – the user clicked Stop in the panel (no banner; just "Stopped")
//   max-duration       – config.maxDuration elapsed (amber banner)
//   connection-lost    – the LTS port disconnected and no reconnect within the grace window (red)
//   tab-closed         – the recorded tab was removed (panel is gone with it; informational only)
//   extension-disabled – the Requestly extension was toggled off mid-recording (red banner)
type StopReason = "user" | "max-duration" | "connection-lost" | "tab-closed" | "extension-disabled";

/** Tell the side panel a recording ended and why, so it can flip to a stopped state with the
 *  right banner. Fire-and-forget — the panel may already be closed. */
const notifyPanelEnded = (tabId: number, reason: StopReason) => {
  chrome.runtime
    .sendMessage({
      action: CLIENT_MESSAGES.NETWORK_RECORDING_ENDED,
      tabId,
      reason,
    })
    .catch(() => {});
};

/** Signal subscribed LTS ports that a recording has ended. Pure signal — the consumer then
 *  fetches the summary via getNetworkRecordingSummary. */
const streamCompleteToPorts = (tabId: number) => {
  const subs = subscriptions.get(tabId);
  if (!subs) return;
  subs.forEach((port) => {
    try {
      port.postMessage({ type: "complete" });
    } catch {
      /* ignore */
    }
  });
};

const addWebRequestListeners = () => {
  if (!chrome.webRequest.onBeforeSendHeaders.hasListener(onBeforeSendHeaders)) {
    chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls: ["<all_urls>"] }, [
      "requestHeaders",
    ]);
  }
  if (!chrome.webRequest.onCompleted.hasListener(onRequestCompleted)) {
    chrome.webRequest.onCompleted.addListener(onRequestCompleted, { urls: ["<all_urls>"] }, ["responseHeaders"]);
  }
  if (!chrome.webRequest.onErrorOccurred.hasListener(onRequestError)) {
    chrome.webRequest.onErrorOccurred.addListener(onRequestError, { urls: ["<all_urls>"] });
  }
};

const removeWebRequestListeners = () => {
  chrome.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
  chrome.webRequest.onCompleted.removeListener(onRequestCompleted);
  chrome.webRequest.onErrorOccurred.removeListener(onRequestError);
};

const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const cancelDisconnectGrace = (tabId: number) => {
  const timer = disconnectGraceTimers.get(tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    disconnectGraceTimers.delete(tabId);
  }
};

const removePortFromAllSubscriptions = (port: chrome.runtime.Port) => {
  subscriptions.forEach((ports, tabId) => {
    if (!ports.delete(port)) return;
    if (ports.size > 0) return;
    subscriptions.delete(tabId);

    // The consumer for an active recording just vanished. Hold a short grace window for a
    // reconnect; if none arrives, stop the recording (its data channel is gone).
    if (!activeRecordings.has(tabId) || disconnectGraceTimers.has(tabId)) return;
    const timer = setTimeout(() => {
      disconnectGraceTimers.delete(tabId);
      if (subscriptions.get(tabId)?.size) return; // reconnected in the meantime
      if (activeRecordings.has(tabId)) stopNetworkRecording(tabId, "connection-lost");
    }, DISCONNECT_GRACE_MS);
    disconnectGraceTimers.set(tabId, timer);
  });
};

/**
 * LTS connects a long-lived port (`network-recording`) and subscribes to a target tab.
 * On subscribe we ack, synchronously backfill the buffer (entries from t=0), then register
 * the port for live entries. Because the backfill is synchronous (no await), no live
 * onCompleted can interleave, so there is no gap or duplicate.
 */
export const initNetworkRecordingPort = () => {
  chrome.runtime.onConnectExternal.addListener((port) => {
    if (port.name !== NETWORK_RECORDING_PORT) return;

    port.onMessage.addListener((msg: { action?: string; targetTabId?: number }) => {
      const tabId = msg?.targetTabId;
      if (typeof tabId !== "number") return;

      if (msg.action === "subscribe") {
        // Reject subscriptions to tabs that were never recorded, so LTS can tell a bad
        // targetTabId from a genuinely-empty recording.
        if (!activeRecordings.has(tabId) && !recordingEntries.has(tabId)) {
          port.postMessage({ type: "error", error: `No recording for tab ${tabId}` });
          return;
        }

        port.postMessage({ type: "subscribed", targetTabId: tabId });

        // Synchronous backfill, then register — no await in between.
        const buffered = recordingEntries.get(tabId) || [];
        for (const entry of buffered) {
          port.postMessage({ type: "entry", entry });
        }

        if (!subscriptions.has(tabId)) subscriptions.set(tabId, new Set());
        subscriptions.get(tabId)!.add(port);
        cancelDisconnectGrace(tabId); // a reconnect within the grace window keeps the recording alive

        // Recording already ended (e.g. very short) but buffer still around: signal complete.
        if (!activeRecordings.has(tabId)) {
          port.postMessage({ type: "complete" });
        }
      } else if (msg.action === "unsubscribe") {
        subscriptions.get(tabId)?.delete(port);
        if (subscriptions.get(tabId)?.size === 0) subscriptions.delete(tabId);
      }
    });

    port.onDisconnect.addListener(() => removePortFromAllSubscriptions(port));
  });
};

// --- v2 body capture: inject the web-sdk Network interceptor into the recorded tab ----------
// The web-sdk UMD exposes the global `Requestly` (incl. Network); networkBodyRecorder.ps.js uses
// it. Both are MAIN-world. executeScript is one-shot, so we re-inject on each navigation of the
// recorded tab (handled by chrome.webNavigation.onCommitted below). The content-script relay
// forwards the start/stop control signals to the page script.

const injectBodyRecorder = async (tabId: number, frameId = 0) => {
  try {
    // 1) web-sdk UMD lib (exposes global Requestly.Network)
    await injectWebAccessibleScript("libs/requestly-web-sdk.js", { tabId, frameIds: [frameId] });
    // 2) our page script that registers the interceptor
    await injectWebAccessibleScript("page-scripts/networkBodyRecorder.ps.js", { tabId, frameIds: [frameId] });
    // 3) start signal with the resolved caps (relayed by the content script to the page)
    sendBodyCaptureSignal(tabId, EXTENSION_MESSAGES.START_NETWORK_BODY_CAPTURE);
  } catch {
    // Injection can fail on restricted pages (e.g. chrome://, strict CSP) — body capture is
    // best-effort; webRequest still covers non-xhr/fetch. Don't break the recording.
  }
};

const sendBodyCaptureSignal = (tabId: number, action: string) => {
  const recording = activeRecordings.get(tabId);
  const payload =
    action === EXTENSION_MESSAGES.START_NETWORK_BODY_CAPTURE
      ? { maxPayloadSize: recording?.config.maxPayloadSize, ignoreMediaResponse: true }
      : undefined;
  // Relayed by the client content script → page (source "requestly:extension").
  chrome.tabs.sendMessage(tabId, { action, payload }).catch(() => {});
};

// Re-inject on navigation of a recorded tab (executeScript is one-shot). Single-tab scoped,
// matching v1's model. Gated to active recordings; main frame only.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!activeRecordings.has(details.tabId)) return;
  injectBodyRecorder(details.tabId, 0);
});

// Synchronously-readable copy of IS_EXTENSION_ENABLED, so startNetworkRecording can reject a start
// while the extension is off WITHOUT an async storage read — an await there would push
// sidePanel.open() past its user-gesture window and the panel would never open. Seeded at init and
// kept fresh via onVariableChange (the same cache pattern clientHandler uses). Optimistic default
// (true) covers the tiny window before the seed resolves; the SW seeds long before any LTS call.
let isExtensionEnabledCache = true;

/**
 * Seed the enabled cache and stop every active recording if the extension is turned off
 * mid-recording. The recorder's webRequest listeners are independent of the extension-enabled flag,
 * so without this a recording would keep capturing while the UI says "disabled". Each stop runs the
 * normal teardown — LTS gets `complete` + a fetchable summary, the panel shows the disabled banner.
 */
export const initNetworkRecordingExtensionToggleListener = async () => {
  isExtensionEnabledCache = await isExtensionEnabled();
  onVariableChange<boolean>(
    Variable.IS_EXTENSION_ENABLED,
    (enabled) => {
      isExtensionEnabledCache = enabled;
      if (enabled) return;
      // Snapshot keys first — stopNetworkRecording mutates activeRecordings while we iterate.
      Array.from(activeRecordings.keys()).forEach((tabId) => stopNetworkRecording(tabId, "extension-disabled"));
    },
    // Catch CREATED too: the flag is lazily stored, so the first time the user disables it the
    // write is a CREATED change (no prior value), which the default MODIFIED-only filter drops.
    [ChangeType.MODIFIED, ChangeType.CREATED]
  );
};

// Firefox exposes sidebarAction only on the `browser.*` namespace, not the `chrome` alias.
const firefoxSidebar = (globalThis as any).browser?.sidebarAction as { open?: () => Promise<void> } | undefined;

const openPanel = (tabId: number) => {
  if (sidePanelApi) {
    // Chrome / Edge: per-tab side panel. Pass targetTabId in the path so the panel binds to THIS
    // recording deterministically — it must not infer its tab from tabs.query({active:true}),
    // which mis-binds when multiple tabs are recording concurrently.
    sidePanelApi.setOptions({
      tabId,
      path: `sidepanel/network-recording/index.html?tabId=${tabId}`,
      enabled: true,
    });
    sidePanelApi.open({ tabId }).catch(() => {});
  } else if (firefoxSidebar?.open) {
    // Firefox: global sidebar (auto-open validated on FF 151, no user gesture needed).
    firefoxSidebar.open().catch(() => {});
  }
  // Safari / other: no panel API → no-op (capture + streaming still work).
};

/**
 * Reopen the panel for a recorded tab on request from the floating widget (the panel was closed).
 * NOTE: sidePanel.open() requires a live user gesture; the widget-click → content-script →
 * runtime.sendMessage → here hop loses it, so Chrome may reject this open(). First-pass to verify
 * empirically — if it doesn't open, the reopen path needs a different mechanism.
 */
export const reopenNetworkRecordingPanel = (tabId: number | undefined) => {
  if (tabId === undefined || !activeRecordings.has(tabId)) return;
  openPanel(tabId);
};

export const startNetworkRecording = (
  url: string,
  config: NetworkRecordingConfig = {},
  sender?: { tabId?: number; windowId?: number }
): Promise<{ success: boolean; targetTabId?: number; error?: string }> => {
  // NOTE: kept synchronous up to chrome.tabs.create (no await) so the LTS sendMessage user gesture
  // survives to the openPanel() call — chrome.sidePanel.open() requires an in-gesture call stack.
  // Reject a start while the extension is off, so the UI never says "disabled" with a live
  // recording. Read from the in-memory cache (NOT an await) to keep that path synchronous.
  if (!isExtensionEnabledCache) {
    return Promise.resolve({
      success: false,
      error: "Requestly extension is disabled. Enable it to start a recording.",
    });
  }

  if (!url || !isValidUrl(url)) {
    return Promise.resolve({ success: false, error: "Invalid URL. Must be a valid http or https URL." });
  }

  return new Promise((resolve) => {
    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve({ success: false, error: chrome.runtime.lastError?.message || "Failed to create tab" });
        return;
      }

      const state: NetworkRecordingState = {
        targetTabId: tab.id,
        url,
        startTime: Date.now(),
        // Resolve maxPayloadSize to its default now so the body page script (v2) can read a
        // concrete cap off state without re-defaulting. maxDuration stays undefined = no cap.
        config: { ...config, maxPayloadSize: config.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE },
        senderTabId: sender?.tabId,
        senderWindowId: sender?.windowId,
      };

      activeRecordings.set(tab.id, state);
      recordingEntries.set(tab.id, []);
      tabService.setData(tab.id, TAB_SERVICE_DATA.NETWORK_RECORDING, { active: true });

      // Max-duration auto-stop. The keepalive ping keeps the SW alive so this timer fires; the
      // inline isOverMaxDuration check in onCompleted is the fast path on a busy page. (See the
      // sleep/wake caveat in the keepalive comment — the only case this timer can be late.)
      if (config.maxDuration !== undefined) {
        state.maxDurationTimer = setTimeout(() => stopNetworkRecording(tab.id!, "max-duration"), config.maxDuration);
      }

      addWebRequestListeners();
      startKeepalive();
      // Open the panel here, synchronously on the external-message path. chrome.sidePanel.open()
      // requires a user gesture and must run within its call stack — the LTS sendMessage provides
      // that gesture, but only as long as nothing awaits before this point (hence no async
      // isExtensionEnabled check above). handleNetworkRecordingOnClientPageLoad re-opens it on
      // later navigations of the recorded tab as a backstop.
      openPanel(tab.id);
      // v2: the body recorder is injected via webNavigation.onCommitted, which fires for this new
      // tab's initial navigation (and every later one). No explicit inject here — it would be too
      // early (the document isn't committed yet).

      resolve({ success: true, targetTabId: tab.id });
    });
  });
};

export interface RecordingSummary {
  targetTabId: number;
  url: string;
  startTime: number;
  endTime: number;
  duration: number;
  totalCount: number;
}

const buildSummary = (recording: NetworkRecordingState, totalCount: number): RecordingSummary => {
  const endTime = Date.now();
  return {
    targetTabId: recording.targetTabId,
    url: recording.url,
    startTime: recording.startTime,
    endTime,
    duration: endTime - recording.startTime,
    totalCount,
  };
};

// Return the user to where they came from after a recording ends. Cascade:
//   1. the originating LTS tab, if it still exists
//   2. else its window (LTS tab closed but window alive), focusing it
//   3. else open the LTS fallback URL in a new tab (tab + window both gone)
// Each step is guarded; failures fall through to the next.
const returnFocusToSender = (recording: NetworkRecordingState) => {
  const { senderTabId, senderWindowId } = recording;

  const openFallback = () => {
    chrome.tabs.create({ url: recording.config.fallbackUrl || DEFAULT_FALLBACK_URL }).catch(() => {});
  };

  const tryWindowThenFallback = () => {
    if (senderWindowId === undefined) {
      openFallback();
      return;
    }
    chrome.windows.update(senderWindowId, { focused: true }).then(
      () => {},
      () => openFallback()
    );
  };

  if (senderTabId === undefined) {
    tryWindowThenFallback();
    return;
  }

  // tabs.get rejects if the tab is gone -> fall through to window, then fallback.
  chrome.tabs
    .get(senderTabId)
    .then(
      () => chrome.tabs.update(senderTabId, { active: true }).then(() => {}, tryWindowThenFallback),
      tryWindowThenFallback
    );
};

export const stopNetworkRecording = (
  targetTabId: number,
  reason: StopReason = "user"
): { success: boolean; error?: string } => {
  const recording = activeRecordings.get(targetTabId);
  if (!recording) {
    return { success: false, error: `No active recording for tab ${targetTabId}` };
  }

  const entries = recordingEntries.get(targetTabId) || [];

  if (recording.maxDurationTimer !== undefined) clearTimeout(recording.maxDurationTimer);
  cancelDisconnectGrace(targetTabId);

  // Stop returns { success } only. Whoever holds the stream (LTS) learns of the end via the
  // port `complete` signal and fetches the metadata with getNetworkRecordingSummary — the same
  // path regardless of who triggered this stop (LTS or the side panel) — so retain it briefly.
  retainSummary(buildSummary(recording, entries.length));

  // Signal subscribed LTS ports before tearing down the buffer.
  streamCompleteToPorts(targetTabId);
  // Tell the side panel why it ended so it can show the right stopped state / banner.
  notifyPanelEnded(targetTabId, reason);
  // v2: tell the page script to stop capturing bodies (gates its callback off; no clearInterceptors).
  sendBodyCaptureSignal(targetTabId, EXTENSION_MESSAGES.STOP_NETWORK_BODY_CAPTURE);

  activeRecordings.delete(targetTabId);
  recordingEntries.delete(targetTabId);
  tabService.removeData(targetTabId, TAB_SERVICE_DATA.NETWORK_RECORDING);

  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }
  stopKeepaliveIfIdle();

  // Leave the panel open showing the stopped state + reason banner; the user closes it.
  // Return focus to the LTS context ONLY when the user themselves ended the recording (clicked
  // Stop). Every other reason — max-duration, connection-lost, extension-disabled — is a
  // background/system event, not an action on this recording; yanking the user's focus on top of
  // the banner that already explains what happened would be surprising.
  if (reason === "user") {
    returnFocusToSender(recording);
  }

  return { success: true };
};

// Summaries are retained for a short window after a recording ends so a stream consumer can
// fetch them on `complete` even though the buffer/state are already torn down.
const recentSummaries = new Map<number, RecordingSummary>();
const SUMMARY_RETENTION_MS = 5 * 60 * 1000;

const retainSummary = (summary: RecordingSummary) => {
  recentSummaries.set(summary.targetTabId, summary);
  setTimeout(() => {
    const current = recentSummaries.get(summary.targetTabId);
    if (current === summary) recentSummaries.delete(summary.targetTabId);
  }, SUMMARY_RETENTION_MS);
};

/**
 * Fetch the final summary for a recording. Call this AFTER the stream's `complete` signal —
 * it only succeeds once the recording has stopped (the summary is retained ~5 min after end).
 * While the recording is still active it returns an error, so a half-finished summary is never
 * mistaken for the final one. Works regardless of who triggered the stop (LTS or the side panel).
 */
export const getNetworkRecordingSummary = (
  targetTabId: number
): { success: boolean; summary?: RecordingSummary; error?: string } => {
  if (activeRecordings.has(targetTabId)) {
    return { success: false, error: `Recording for tab ${targetTabId} is still active` };
  }
  const retained = recentSummaries.get(targetTabId);
  if (retained) {
    return { success: true, summary: retained };
  }
  return { success: false, error: `No summary for tab ${targetTabId}` };
};

export const getNetworkRecordingState = (
  tabId: number
): { active: boolean; entries: NetworkHarEntry[]; startTime: number; url: string } | null => {
  const recording = activeRecordings.get(tabId);
  if (!recording) return null;

  return {
    active: true,
    entries: recordingEntries.get(tabId) || [],
    startTime: recording.startTime,
    url: recording.url,
  };
};

export const handleNetworkRecordingOnClientPageLoad = (tab: chrome.tabs.Tab) => {
  const recordingData = tabService.getData(tab.id, TAB_SERVICE_DATA.NETWORK_RECORDING);
  if (!recordingData?.active) return;
  openPanel(tab.id);
};

const cleanupRecording = (tabId: number) => {
  cancelDisconnectGrace(tabId);
  const recording = activeRecordings.get(tabId);
  if (recording) {
    if (recording.maxDurationTimer !== undefined) clearTimeout(recording.maxDurationTimer);
    retainSummary(buildSummary(recording, recordingEntries.get(tabId)?.length ?? 0));
  }
  streamCompleteToPorts(tabId);
  // The recorded tab closed — its panel is gone with it, but send for contract completeness.
  notifyPanelEnded(tabId, "tab-closed");
  activeRecordings.delete(tabId);
  recordingEntries.delete(tabId);
  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }
  stopKeepaliveIfIdle();
};

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!activeRecordings.has(tabId)) return;
  cleanupRecording(tabId);
});
