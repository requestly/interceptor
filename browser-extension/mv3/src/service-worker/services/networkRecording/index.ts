import { tabService, TAB_SERVICE_DATA } from "../tabService";
import { CLIENT_MESSAGES } from "common/constants";
import { onVariableChange, Variable } from "../../variable";
import { buildCompletedEntry, buildErrorEntry, CorrelationData, NetworkHarEntry } from "./harBuilder";

interface NetworkRecordingState {
  targetTabId: number;
  url: string;
  startTime: number;
  config: { maxDuration?: number };
  // The LTS tab/window that started the recording. On stop we return focus here.
  // Both may be gone by stop time (user closed the tab/window mid-recording).
  senderTabId?: number;
  senderWindowId?: number;
  // Per-recording max-duration auto-stop timer (only set when config.maxDuration is given).
  maxDurationTimer?: ReturnType<typeof setTimeout>;
}

// TODO(before-merge): replace with the real LTS fallback URL provided by the LTS team.
// Used only when the originating LTS tab AND its window are both gone at stop time —
// we open this so the user always lands back in an LTS context. Placeholder for now.
const LTS_FALLBACK_URL = "https://www.browserstack.com";

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
// the chrome.sidePanel API surface is Chrome/Edge only.
const sidePanelApi = (chrome as any).sidePanel as
  | {
      setOptions: (opts: { tabId?: number; path?: string; enabled: boolean }) => Promise<void>;
      open: (opts: { tabId: number }) => Promise<void>;
    }
  | undefined;

if (sidePanelApi) {
  sidePanelApi.setOptions({ enabled: false }).catch(() => {});
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
const onBeforeSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
  if (!activeRecordings.has(details.tabId)) return;
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

  // Prompt auto-stop on a busy page; the alarm tick is the backstop for a quiet page.
  if (isOverMaxDuration(recording)) {
    stopNetworkRecording(details.tabId, "max-duration");
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

/**
 * Stop every active recording if the extension is turned off mid-recording. The recorder's
 * webRequest listeners are independent of the extension-enabled flag, so without this a recording
 * would keep capturing while the UI says "disabled". Each stop runs the normal teardown — LTS gets
 * `complete` + a fetchable summary, the panel shows the disabled banner.
 */
export const initNetworkRecordingExtensionToggleListener = () => {
  onVariableChange<boolean>(Variable.IS_EXTENSION_ENABLED, (enabled) => {
    if (enabled) return;
    // Snapshot keys first — stopNetworkRecording mutates activeRecordings while we iterate.
    Array.from(activeRecordings.keys()).forEach((tabId) => stopNetworkRecording(tabId, "extension-disabled"));
  });
};

// Firefox exposes sidebarAction only on the `browser.*` namespace, not the `chrome` alias.
const firefoxSidebar = (globalThis as any).browser?.sidebarAction as { open?: () => Promise<void> } | undefined;

const openPanel = (tabId: number) => {
  if (sidePanelApi) {
    // Chrome / Edge: per-tab side panel.
    sidePanelApi.setOptions({
      tabId,
      path: "sidepanel/network-recording/index.html",
      enabled: true,
    });
    sidePanelApi.open({ tabId }).catch(() => {});
  } else if (firefoxSidebar?.open) {
    // Firefox: global sidebar (auto-open validated on FF 151, no user gesture needed).
    firefoxSidebar.open().catch(() => {});
  }
  // Safari / other: no panel API → no-op (capture + streaming still work).
};

export const startNetworkRecording = (
  url: string,
  config: { maxDuration?: number } = {},
  sender?: { tabId?: number; windowId?: number }
): Promise<{ success: boolean; targetTabId?: number; error?: string }> => {
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
        config,
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
      openPanel(tab.id);

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
    chrome.tabs.create({ url: LTS_FALLBACK_URL }).catch(() => {});
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

  activeRecordings.delete(targetTabId);
  recordingEntries.delete(targetTabId);
  tabService.removeData(targetTabId, TAB_SERVICE_DATA.NETWORK_RECORDING);

  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }
  stopKeepaliveIfIdle();

  // Leave the panel open showing the stopped state + reason banner; the user closes it.
  returnFocusToSender(recording);

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
): { active: boolean; entries: NetworkHarEntry[]; startTime: number } | null => {
  const recording = activeRecordings.get(tabId);
  if (!recording) return null;

  return {
    active: true,
    entries: recordingEntries.get(tabId) || [],
    startTime: recording.startTime,
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
