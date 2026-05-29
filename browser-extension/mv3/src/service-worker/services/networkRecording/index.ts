import { tabService, TAB_SERVICE_DATA } from "../tabService";
import { CLIENT_MESSAGES } from "common/constants";
import { buildCompletedEntry, buildErrorEntry, CorrelationData, NetworkHarEntry } from "./harBuilder";

interface NetworkRecordingState {
  senderTabId: number | undefined;
  targetTabId: number;
  startTime: number;
  config: { maxDuration?: number };
}

const activeRecordings = new Map<number, NetworkRecordingState>();
const recordingEntries = new Map<number, NetworkHarEntry[]>();

// webRequest requestId -> request-start correlation data (internal only, never surfaced).
const correlationMap = new Map<string, CorrelationData>();

let entryCounter = 0;
const nextRequestId = (tabId: number): string => `${tabId}-${++entryCounter}`;

const hasSidePanelAPI = typeof chrome.sidePanel !== "undefined";

if (hasSidePanelAPI) {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}

const DEFAULT_MAX_DURATION = 15 * 60 * 1000;

const onBeforeSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
  if (!activeRecordings.has(details.tabId)) return;
  correlationMap.set(details.requestId, {
    startTime: details.timeStamp,
    requestHeaders: details.requestHeaders,
  });
};

const onRequestCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;

  // PR1 stopgap: enforce maxDuration inline. PR5 moves this into the keepalive tick so a
  // quiet page (no further requests) also auto-stops.
  const maxDuration = recording.config.maxDuration || DEFAULT_MAX_DURATION;
  if (Date.now() - recording.startTime > maxDuration) {
    stopNetworkRecording(details.tabId);
    return;
  }

  const correlation = correlationMap.get(details.requestId);
  correlationMap.delete(details.requestId);

  const entry = buildCompletedEntry(details, correlation, nextRequestId(details.tabId));
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

  const entry = buildErrorEntry(details, correlation, nextRequestId(details.tabId), details.error);
  recordingEntries.get(details.tabId)?.push(entry);
  deliverEntry(details.tabId, entry);
};

/** Deliver a captured entry to the internal sidepanel. (External port delivery added in PR2.) */
const deliverEntry = (tabId: number, entry: NetworkHarEntry) => {
  chrome.runtime
    .sendMessage({
      action: CLIENT_MESSAGES.NETWORK_EVENT_CAPTURED,
      entry,
      tabId,
    })
    .catch(() => {});
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

const openPanel = (tabId: number) => {
  if (!hasSidePanelAPI) return;
  chrome.sidePanel.setOptions({
    tabId,
    path: "sidepanel/network-recording/index.html",
    enabled: true,
  });
  chrome.sidePanel.open({ tabId }).catch(() => {});
};

export const startNetworkRecording = (
  senderTabId: number | undefined,
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
        senderTabId,
        targetTabId: tab.id,
        startTime: Date.now(),
        config,
      };

      activeRecordings.set(tab.id, state);
      recordingEntries.set(tab.id, []);
      tabService.setData(tab.id, TAB_SERVICE_DATA.NETWORK_RECORDING, { active: true, senderTabId });

      addWebRequestListeners();
      openPanel(tab.id);

      resolve({ success: true, targetTabId: tab.id });
    });
  });
};

export const stopNetworkRecording = (
  targetTabId: number
): { success: boolean; events?: NetworkHarEntry[]; error?: string } => {
  if (!activeRecordings.has(targetTabId)) {
    return { success: false, error: `No active recording for tab ${targetTabId}` };
  }

  const events = recordingEntries.get(targetTabId) || [];

  activeRecordings.delete(targetTabId);
  recordingEntries.delete(targetTabId);
  tabService.removeData(targetTabId, TAB_SERVICE_DATA.NETWORK_RECORDING);

  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }

  if (hasSidePanelAPI) {
    chrome.sidePanel.setOptions({ tabId: targetTabId, enabled: false }).catch(() => {});
  }

  return { success: true, events };
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
  activeRecordings.delete(tabId);
  recordingEntries.delete(tabId);
  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }
};

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!activeRecordings.has(tabId)) return;
  cleanupRecording(tabId);
});
