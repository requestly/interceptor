import { tabService, TAB_SERVICE_DATA } from "../tabService";
import { CLIENT_MESSAGES, EXTENSION_MESSAGES } from "common/constants";
import { ChangeType } from "common/storage";
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
// --- Advanced settings (Chrome/Edge only; mirror the classic LTS recorder's advanced options) ---
// - disableCache: when true, wipe the HTTP cache at record start so the first load is cold and
//   requests actually hit the network (no 304/from-cache skeleton entries). The exact equivalent of
//   the browser's "Disable cache" — HTTP cache only, no Cache-Control header injection (which would
//   alter the recorded on-the-wire traffic). Start-time only. NOTE: clears the ENTIRE browser HTTP
//   cache (all sites), not just the recorded origin — Chrome ignores the origins filter for the
//   `cache` data type (see wipeOriginBrowsingData). Chrome/Edge only (browsingData feature-guarded;
//   Firefox/Safari no-op). Default false.
// - wipeServiceWorkers: when true, unregister the target origin's service workers AND clear the
//   Cache API (cacheStorage) they serve from at record start, so SW-cached responses don't bypass
//   capture. Shares the single browsingData.remove call with disableCache. Default false.
// - recordAjax: when true (default) XHR/Fetch are recorded with full request + response bodies and
//   headers via the web-sdk page script (the sole source for them, v2). When false, XHR/Fetch are
//   NOT recorded at all — suppressed from both sources (the page script isn't injected AND the
//   webRequest path drops "xmlhttprequest"). A yes/no on recording ajax, not a bodies toggle.
//   Non-ajax resources (document, image, css, js, font, media) are unaffected either way.
// - requestScope: which requests to record on the webRequest path — RequestScope.ALL (default,
//   includes iframe-originated) or RequestScope.TOP_LEVEL (only main-frame requests, frameId === 0).

// String-valued so the wire contract with LTS is just "all" / "top-level" (sent as JSON over the
// external start message). Default is ALL when omitted/unrecognized.
export enum RequestScope {
  ALL = "all",
  TOP_LEVEL = "top-level",
}

export interface NetworkRecordingConfig {
  maxDuration?: number;
  maxPayloadSize?: number;
  fallbackUrl?: string;
  disableCache?: boolean;
  wipeServiceWorkers?: boolean;
  recordAjax?: boolean;
  requestScope?: RequestScope;
}

// 10 MB per-body cap (bytes), LTS-overridable via config.maxPayloadSize. Sized as a "safe maximum":
// large enough that realistic API/JSON bodies are never truncated, while staying well under Chrome's
// ~32 MB chrome.runtime.sendMessage ceiling (bodies stream one-per-message) so an oversized body
// truncates gracefully (RESPONSE_TOO_LARGE flag) instead of throwing and losing the whole entry.
const DEFAULT_MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;

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
// XHR/Fetch ("xmlhttprequest" is the resource type for both) are NEVER recorded via the webRequest
// path — this guard always suppresses them there:
//   - recordAjax !== false (default): they're captured by the web-sdk Network interceptor (the
//     document_start MAIN-world body-recorder content scripts), which carries headers AND bodies.
//     Single source, no correlation needed.
//   - recordAjax === false: the SDK body-recorder scripts are NOT registered (see
//     registerBodyRecorderScripts), and we still suppress them here — so xhr/fetch are not recorded
//     AT ALL. "Record Ajax Requests" is a yes/no on recording them, not a bodies-vs-no toggle.
// Either way, webRequest must not emit an xhr/fetch entry, so this predicate ignores recordAjax.
const isAjaxRequest = (type: chrome.webRequest.ResourceType): boolean => type === "xmlhttprequest";

// requestScope "top-level": drop sub-frame (iframe-originated) requests on the webRequest path.
// frameId 0 is the main frame. The SDK (xhr/fetch) path needs no equivalent guard: the body-recorder
// content scripts register without allFrames (main frame only), so SDK-sourced entries are inherently
// top-level-only.
const isExcludedByScope = (recording: NetworkRecordingState, frameId: number): boolean =>
  recording.config.requestScope === RequestScope.TOP_LEVEL && frameId !== 0;

const onBeforeSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;
  if (isAjaxRequest(details.type)) return; // xhr/fetch never recorded via webRequest (SDK source, or recordAjax off)
  if (isExcludedByScope(recording, details.frameId)) return; // top-level scope: skip sub-frame requests
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

  if (isAjaxRequest(details.type)) return; // xhr/fetch never recorded via webRequest (SDK source, or recordAjax off)
  if (isExcludedByScope(recording, details.frameId)) {
    correlationMap.delete(details.requestId); // top-level scope: drop sub-frame request, clear any correlation
    return;
  }

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

  if (isAjaxRequest(details.type)) return; // xhr/fetch never recorded via webRequest (SDK source, or recordAjax off)
  if (isExcludedByScope(recording, details.frameId)) {
    correlationMap.delete(details.requestId); // top-level scope: drop sub-frame request, clear any correlation
    return;
  }

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

// Advanced settings: clear cache / service workers for the recorded origin at record start, so the
// load is cold and SW-cached responses don't bypass capture. Chrome/Edge only — Firefox/Safari lack
// chrome.browsingData, so the feature-detect early-return makes this a clean no-op there.
//
// Coalesces both flags into ONE browsingData.remove call:
//   disableCache       → { cache }                       (HTTP cache only — the "Disable cache" equivalent)
//   wipeServiceWorkers → { serviceWorkers, cacheStorage } (the SW and the Cache API it serves from)
//
// SCOPE CAVEAT: we pass origins:[origin], but Chrome applies that filter ONLY to serviceWorkers /
// cacheStorage — it IGNORES origins for the `cache` data type. So disableCache clears the ENTIRE
// browser HTTP cache (all sites), not just the recorded origin. Origin-only HTTP-cache clearing is
// not achievable via the browsingData API. Acceptable here: it's opt-in, a momentary record-start
// action, and reachable only from trusted first-party BrowserStack/LTS pages.
//
// CRITICAL: fire-and-forget — NEVER awaited. startNetworkRecording must stay synchronous up to
// chrome.tabs.create so chrome.sidePanel.open() keeps its user gesture; an await here would break it.
// Start-time only (no teardown — the browser owns this state). Failures are swallowed (best-effort,
// like the body-recorder script registration); a cache wipe that doesn't land just means a few warm-cache entries.
const wipeOriginBrowsingData = (url: string, config: NetworkRecordingConfig) => {
  const remove = (chrome as any).browsingData?.remove;
  if (typeof remove !== "function") return; // Firefox/Safari: no browsingData → no-op

  const dataToRemove: chrome.browsingData.DataTypeSet = {};
  if (config.disableCache) dataToRemove.cache = true;
  if (config.wipeServiceWorkers) {
    dataToRemove.serviceWorkers = true;
    dataToRemove.cacheStorage = true;
  }
  if (Object.keys(dataToRemove).length === 0) return; // neither flag set → nothing to wipe

  let origin: string;
  try {
    origin = new URL(url).origin; // url already passed isValidUrl (http/https), so this won't throw
  } catch {
    return;
  }

  Promise.resolve(remove.call((chrome as any).browsingData, { origins: [origin] }, dataToRemove)).catch(() => {});
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
  // Defensive: on SW startup activeRecordings is always empty (no rehydration), so any body-recorder
  // content scripts still registered from a prior SW session that died without teardown are orphans
  // injecting into every browsed tab. Clear them. A live recording re-registers via
  // registerBodyRecorderScripts on its next start.
  unregisterBodyRecorderScripts();

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
// it. Both run MAIN-world at document_start.
//
// Injection-timing-race fix: previously we injected imperatively via executeScript from
// webNavigation.onCommitted, which fires AFTER the document commits and its early scripts run — so
// an SPA's bootstrap requests fired before the interceptor was armed and their bodies were lost
// (breaking LTS auto-correlation, which needs those bootstrap response IDs). We now register both
// scripts as document_start MAIN-world CONTENT SCRIPTS (registerContentScripts) for the duration of
// the recording, mirroring the always-on ajaxRequestInterceptor (clientHandler.ts). That guarantees
// they load before the page's own scripts on every navigation. The page script arms the interceptor
// synchronously and buffers captures from t=0 (see networkBodyRecorder.js); the START signal only
// delivers the resolved caps and flushes the buffer to live.
//
// registerContentScripts is URL-pattern scoped (no tabId), so while registered the scripts inject
// into every browsed tab. That's harmless: a non-recorded tab buffers and never flushes (no START),
// and the SW's onNetworkBodyCaptured drops captures whose tabId isn't an active recording. The
// scripts are unregistered once the last recording stops.

// One registered content script bundling the UMD + recorder (ordered js array), so the UMD is
// guaranteed evaluated before the recorder reads the global `Requestly`.
const BODY_RECORDER_SCRIPT_ID = "network-recording-body-recorder";

// Registered while ≥1 recording with recordAjax !== false is active. Idempotent: getRegistered →
// register only the missing ids, so a second concurrent recording doesn't double-register.
const registerBodyRecorderScripts = async () => {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BODY_RECORDER_SCRIPT_ID] });
    if (existing.length) return; // already registered (another concurrent recording)
    // ONE registration with both files in order: the UMD MUST evaluate before the recorder reads the
    // global `Requestly`. Multiple files in a single RegisteredContentScript.js array run in array
    // order, in the same injection — so this guarantees Requestly is defined when the recorder runs.
    // (Two separate registrations did NOT guarantee cross-script order, which left `Requestly
    // present? false` and forced a late retry that missed early requests.)
    await chrome.scripting.registerContentScripts([
      {
        id: BODY_RECORDER_SCRIPT_ID,
        js: ["libs/requestly-web-sdk.js", "page-scripts/networkBodyRecorder.ps.js"],
        world: "MAIN",
        runAt: "document_start",
        matches: ["http://*/*", "https://*/*"],
        // No rehydration of recordings across SW restarts, so don't persist; cleaned up on SW init.
        persistAcrossSessions: false,
      },
    ]);
  } catch {
    // Best-effort: if registration fails (e.g. id already present from a race), body capture
    // degrades but the recording continues. webRequest still covers non-xhr/fetch.
  }
};

const unregisterBodyRecorderScripts = async () => {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [BODY_RECORDER_SCRIPT_ID] });
  } catch {
    // Already unregistered / never registered — ignore.
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

/**
 * Pull-based START handshake. The page body-recorder posts NETWORK_BODY_RECORDER_READY once it has
 * armed the interceptor and attached its message listener; this replies with START (resolved caps),
 * which flushes the page's pre-START buffer (the bootstrap requests) and flips it to live.
 *
 * Why pull, not push: previously START was sent on chrome.webNavigation.onCommitted, which fires
 * before the content-script relay is guaranteed to be listening — so START was dropped and the
 * buffer never flushed (0 entries reached the panel). The page asking for START when it's actually
 * ready removes that race entirely (and is the same "START only after the recorder is set up"
 * guarantee the original post-injection sendBodyCaptureSignal had).
 *
 * DELIVERY DEPENDENCY (known limitation): READY (page→here) and START (here→page) both ride the
 * client content-script relay (content-scripts/client/index.ts → initPageScriptMessageListener),
 * which attaches only on HTML top documents and only while the extension is enabled. For a recorded
 * tab whose top document is NOT HTML (a raw JSON/XML/no-doctype URL), the relay never attaches:
 * READY is never delivered, START never arrives, and xhr/fetch BODIES are not captured for that tab
 * (the page buffers and gives up after its ~6s READY-retry window). webRequest still captures
 * non-xhr/fetch skeletons. This is acceptable because LTS records web applications (HTML pages), not
 * raw non-HTML endpoints. If that assumption ever changes, add an SW-side arming watchdog (expect a
 * READY within ~8s of navigating; if none, surface a degraded state to the panel) — deliberately
 * NOT added now to avoid machinery for a case real LTS targets don't hit.
 */
export const onBodyRecorderReady = (tabId: number | undefined) => {
  if (tabId === undefined) return;
  const recording = activeRecordings.get(tabId);
  if (!recording) return; // not a recorded tab (scripts inject broadly; only recorded tabs get START)
  if (recording.config.recordAjax === false) return; // ajax recording off → never arm emission
  sendBodyCaptureSignal(tabId, EXTENSION_MESSAGES.START_NETWORK_BODY_CAPTURE);
};

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

/**
 * Start a network recording in a fresh tab.
 *
 * THE about:blank HACK — read before changing the tab-creation order. Two hard constraints collide:
 *
 *   (A) chrome.sidePanel.open() requires a live USER GESTURE and must be called synchronously within
 *       the gesture's call stack. The gesture comes from the LTS chrome.runtime.sendMessage and
 *       survives exactly ONE async hop — the chrome.tabs.create callback — as long as nothing is
 *       `await`ed before openPanel(). Any await before it forfeits the gesture and the panel never
 *       opens (verified: the CLIENT_PAGE_LOADED backstop can't open it either, since that's a
 *       gesture-less programmatic message).
 *
 *   (B) The v2 body-recorder content scripts (web-sdk UMD + networkBodyRecorder) must be REGISTERED
 *       (chrome.scripting.registerContentScripts, an async call we must await) BEFORE the recorded
 *       URL starts loading — otherwise the SPA's bootstrap requests fire before the fetch/XHR
 *       interceptor is armed and their response bodies are lost (the injection-timing race; LTS
 *       auto-correlation then chains 0 rows because the IDs live in those missed responses).
 *
 * (A) needs NO await before the open; (B) needs an await before the load. Mutually exclusive on one
 * tab created directly at the URL. The resolution: create the tab at **about:blank** first.
 *   1. about:blank loads instantly and does NOT consume the gesture, so openPanel() in the
 *      tabs.create callback still succeeds (constraint A satisfied).
 *   2. The real URL has NOT started loading, so we can await registerBodyRecorderScripts() AFTER
 *      openPanel/resolve, then chrome.tabs.update(tabId, {url}) to navigate — the scripts are now in
 *      place for that navigation's document_start (constraint B satisfied).
 *   3. Because the recorded URL only ever loads ONCE (the post-registration navigation), nothing is
 *      captured twice — no webRequest/SDK double-send. (A reload-after-load approach would have
 *      double-counted the webRequest-sourced doc/js/css/img entries; about:blank avoids that.)
 *
 * COST / SUPPRESSION: the about:blank commit fires the SW's various webNavigation.onCommitted /
 * page-load handlers against a URL the extension has no host access to ("about:blank"), which would
 * otherwise log "Cannot access contents of url about:blank" / "Receiving end does not exist" noise.
 * Those handlers are guarded to skip non-http(s) URLs (see clientHandler.ts and below). Our own
 * networkRecording onCommitted/CLIENT_PAGE_LOADED paths are inert on about:blank too: the body
 * recorder isn't registered for it (registered after), and capture is no-op until the page posts
 * READY (which the about:blank document never does).
 */
export const startNetworkRecording = async (
  url: string,
  config: NetworkRecordingConfig = {},
  sender?: { tabId?: number; windowId?: number }
): Promise<{ success: boolean; targetTabId?: number; error?: string }> => {
  // Reject a start while the extension is off, so the UI never says "disabled" with a live
  // recording. Read from the in-memory cache (NOT an await).
  if (!isExtensionEnabledCache) {
    return {
      success: false,
      error: "Requestly extension is disabled. Enable it to start a recording.",
    };
  }

  if (!url || !isValidUrl(url)) {
    return { success: false, error: "Invalid URL. Must be a valid http or https URL." };
  }

  return new Promise((resolve) => {
    // Create the tab at about:blank FIRST. This keeps the synchronous gesture path to
    // sidePanel.open() intact (about:blank loads instantly and does NOT consume the gesture) AND
    // means the recorded URL hasn't started loading yet — so we can register the document_start
    // body-recorder scripts and ONLY THEN navigate to the URL, guaranteeing the interceptor arms
    // before the recorded page's first request (the injection-timing-race fix). Because the real
    // URL never loads pre-registration, nothing is captured twice (no double-send on reload).
    chrome.tabs.create({ url: "about:blank" }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve({ success: false, error: chrome.runtime.lastError?.message || "Failed to create tab" });
        return;
      }
      const tabId = tab.id;

      const state: NetworkRecordingState = {
        targetTabId: tabId,
        url,
        startTime: Date.now(),
        // Resolve maxPayloadSize to its default now so the body page script (v2) can read a
        // concrete cap off state without re-defaulting. maxDuration stays undefined = no cap.
        config: { ...config, maxPayloadSize: config.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE },
        senderTabId: sender?.tabId,
        senderWindowId: sender?.windowId,
      };

      activeRecordings.set(tabId, state);
      recordingEntries.set(tabId, []);
      tabService.setData(tabId, TAB_SERVICE_DATA.NETWORK_RECORDING, { active: true });

      // Advanced settings: start-time cache / service-worker wipe for the recorded origin (Chrome/
      // Edge only; feature-guarded no-op elsewhere). Fire-and-forget — NOT awaited — so the
      // synchronous gesture path to openPanel() below is preserved.
      wipeOriginBrowsingData(url, config);

      // Max-duration auto-stop. The keepalive ping keeps the SW alive so this timer fires; the
      // inline isOverMaxDuration check in onCompleted is the fast path on a busy page. (See the
      // sleep/wake caveat in the keepalive comment — the only case this timer can be late.)
      if (config.maxDuration !== undefined) {
        state.maxDurationTimer = setTimeout(() => stopNetworkRecording(tabId, "max-duration"), config.maxDuration);
      }

      addWebRequestListeners();
      startKeepalive();
      // Open the panel synchronously in this callback — the LTS sendMessage gesture survives the
      // single tabs.create hop (no await before here), so sidePanel.open() succeeds. The tab is on
      // about:blank, so nothing is loading yet.
      openPanel(tabId);

      resolve({ success: true, targetTabId: tabId });

      // Now register the body-recorder scripts, THEN navigate the blank tab to the real URL. The
      // await is AFTER openPanel/resolve, so it costs neither the gesture nor the LTS response.
      // Skipped when recordAjax === false (just navigate).
      // active:true re-asserts the tab as focused as it navigates — nudges Chrome to put focus on
      // the page rather than leaving it in the omnibox (the blank tab held no focus). Best-effort.
      const navigate = () => chrome.tabs.update(tabId, { url, active: true }).catch(() => {});
      if (config.recordAjax !== false) {
        registerBodyRecorderScripts().then(navigate, navigate);
      } else {
        navigate();
      }
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
    // v2: no recordings left — stop injecting the body-recorder content scripts into every browsed tab.
    unregisterBodyRecorderScripts();
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
    unregisterBodyRecorderScripts(); // no recordings left — stop injecting the body-recorder scripts
  }
  stopKeepaliveIfIdle();
};

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!activeRecordings.has(tabId)) return;
  cleanupRecording(tabId);
});
