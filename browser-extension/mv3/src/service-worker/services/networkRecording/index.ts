import { tabService, TAB_SERVICE_DATA } from "../tabService";
import { CLIENT_MESSAGES } from "common/constants";
import { buildCompletedEntry, buildErrorEntry, CorrelationData, NetworkHarEntry } from "./harBuilder";

interface NetworkRecordingState {
  targetTabId: number;
  url: string;
  startTime: number;
  config: { maxDuration?: number };
}

const activeRecordings = new Map<number, NetworkRecordingState>();
const recordingEntries = new Map<number, NetworkHarEntry[]>();

// LTS streaming subscribers, keyed by target tabId. One LTS page may subscribe to many tabs.
const subscriptions = new Map<number, Set<chrome.runtime.Port>>();

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

const DEFAULT_MAX_DURATION = 15 * 60 * 1000;

// --- Service-worker keepalive ----------------------------------------------------------------
// An open port does NOT keep an MV3 SW alive — only events/API calls reset the 30s idle timer.
// During idle gaps (user reading a page, no requests firing) the SW would die and lose the
// in-memory buffer. Prevention: a ~20s API-ping interval keeps the SW warm while a recording is
// active. Backstop: a chrome.alarms tick (0.5min floor; sub-0.5 is clamped in packed builds)
// survives SW death, re-wakes it, and runs the max-duration auto-stop + correlation-map sweep so
// a quiet page still stops and stale correlation entries don't leak.
const KEEPALIVE_ALARM = "nr-keepalive";
const KEEPALIVE_PING_MS = 20_000;
const CORRELATION_TTL_MS = 60_000;
let keepalivePingId: ReturnType<typeof setInterval> | undefined;

const startKeepalive = () => {
  if (keepalivePingId === undefined) {
    keepalivePingId = setInterval(() => {
      // Any extension API call resets the SW idle timer.
      chrome.runtime.getPlatformInfo().catch(() => {});
    }, KEEPALIVE_PING_MS);
  }
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
};

const stopKeepaliveIfIdle = () => {
  if (activeRecordings.size > 0) return;
  if (keepalivePingId !== undefined) {
    clearInterval(keepalivePingId);
    keepalivePingId = undefined;
  }
  chrome.alarms.clear(KEEPALIVE_ALARM);
};

// Alarm tick: enforce max-duration even on quiet pages, and sweep stale correlation entries.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;

  activeRecordings.forEach((recording, tabId) => {
    if (isOverMaxDuration(recording)) {
      stopNetworkRecording(tabId);
    }
  });

  const now = Date.now();
  correlationMap.forEach((data, requestId) => {
    if (now - data.startTime > CORRELATION_TTL_MS) {
      correlationMap.delete(requestId);
    }
  });
});
// -------------------------------------------------------------------------------------------

const onBeforeSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
  if (!activeRecordings.has(details.tabId)) return;
  correlationMap.set(details.requestId, {
    startTime: details.timeStamp,
    requestHeaders: details.requestHeaders,
  });
};

const isOverMaxDuration = (recording: NetworkRecordingState): boolean =>
  Date.now() - recording.startTime > (recording.config.maxDuration || DEFAULT_MAX_DURATION);

const onRequestCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;

  // Prompt auto-stop on a busy page; the alarm tick is the backstop for a quiet page.
  if (isOverMaxDuration(recording)) {
    stopNetworkRecording(details.tabId);
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

/** Notify subscribed LTS ports that a recording has ended. */
const streamCompleteToPorts = (tabId: number) => {
  const subs = subscriptions.get(tabId);
  if (!subs) return;
  const totalCount = recordingEntries.get(tabId)?.length ?? 0;
  subs.forEach((port) => {
    try {
      port.postMessage({ type: "complete", totalCount });
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

const removePortFromAllSubscriptions = (port: chrome.runtime.Port) => {
  subscriptions.forEach((ports, tabId) => {
    ports.delete(port);
    if (ports.size === 0) subscriptions.delete(tabId);
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

        // Recording already ended (e.g. very short) but buffer still around: tell LTS.
        if (!activeRecordings.has(tabId)) {
          port.postMessage({ type: "complete", totalCount: buffered.length });
        }
      } else if (msg.action === "unsubscribe") {
        subscriptions.get(tabId)?.delete(port);
        if (subscriptions.get(tabId)?.size === 0) subscriptions.delete(tabId);
      }
    });

    port.onDisconnect.addListener(() => removePortFromAllSubscriptions(port));
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

const closePanel = (tabId: number) => {
  if (sidePanelApi) {
    sidePanelApi.setOptions({ tabId, enabled: false }).catch(() => {});
  }
  // Firefox sidebar is global; leave it for the user to close.
};

export const startNetworkRecording = (
  url: string,
  config: { maxDuration?: number } = {}
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
      };

      activeRecordings.set(tab.id, state);
      recordingEntries.set(tab.id, []);
      tabService.setData(tab.id, TAB_SERVICE_DATA.NETWORK_RECORDING, { active: true });

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

export const stopNetworkRecording = (
  targetTabId: number
): { success: boolean; summary?: RecordingSummary; error?: string } => {
  const recording = activeRecordings.get(targetTabId);
  if (!recording) {
    return { success: false, error: `No active recording for tab ${targetTabId}` };
  }

  const entries = recordingEntries.get(targetTabId) || [];
  const endTime = Date.now();
  const summary: RecordingSummary = {
    targetTabId,
    url: recording.url,
    startTime: recording.startTime,
    endTime,
    duration: endTime - recording.startTime,
    totalCount: entries.length,
  };

  // Notify subscribed LTS ports before tearing down the buffer.
  streamCompleteToPorts(targetTabId);

  activeRecordings.delete(targetTabId);
  recordingEntries.delete(targetTabId);
  tabService.removeData(targetTabId, TAB_SERVICE_DATA.NETWORK_RECORDING);

  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }
  stopKeepaliveIfIdle();

  closePanel(targetTabId);

  return { success: true, summary };
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
  streamCompleteToPorts(tabId);
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
