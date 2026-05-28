import { tabService, TAB_SERVICE_DATA } from "./tabService";
import { CLIENT_MESSAGES } from "common/constants";

interface NetworkRecordingEvent {
  requestId: string;
  url: string;
  method: string;
  type: chrome.webRequest.ResourceType;
  statusCode: number;
  timeStamp: number;
  fromCache: boolean;
  ip?: string;
  contentLength?: number;
  contentType?: string;
  state: "complete" | "error";
  error?: string;
}

interface NetworkRecordingState {
  senderTabId: number | undefined;
  targetTabId: number;
  startTime: number;
  config: { showWidget?: boolean; maxDuration?: number };
}

const activeRecordings = new Map<number, NetworkRecordingState>();
const recordingEvents = new Map<number, NetworkRecordingEvent[]>();

const hasSidePanelAPI = typeof chrome.sidePanel !== "undefined";

if (hasSidePanelAPI) {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}

const DEFAULT_MAX_DURATION = 15 * 60 * 1000;

const parseContentLength = (headers: chrome.webRequest.HttpHeader[] | undefined): number | undefined => {
  if (!headers) return undefined;
  const header = headers.find((h) => h.name.toLowerCase() === "content-length");
  if (!header?.value) return undefined;
  const parsed = parseInt(header.value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseHeaderValue = (headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value;
};

const onRequestCompleted = (details: chrome.webRequest.WebResponseCacheDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;

  const maxDuration = recording.config.maxDuration || DEFAULT_MAX_DURATION;
  if (Date.now() - recording.startTime > maxDuration) {
    stopNetworkRecording(details.tabId);
    return;
  }

  const event: NetworkRecordingEvent = {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    statusCode: details.statusCode,
    timeStamp: details.timeStamp,
    fromCache: details.fromCache,
    ip: details.ip,
    contentLength: parseContentLength(details.responseHeaders),
    contentType: parseHeaderValue(details.responseHeaders, "content-type"),
    state: "complete",
  };

  recordingEvents.get(details.tabId)?.push(event);

  chrome.runtime
    .sendMessage({
      action: CLIENT_MESSAGES.NETWORK_EVENT_CAPTURED,
      event,
      tabId: details.tabId,
    })
    .catch(() => {});
};

const IGNORED_ERRORS = new Set(["net::ERR_CACHE_MISS", "net::ERR_ABORTED", "net::ERR_BLOCKED_BY_CLIENT"]);

const onRequestError = (details: chrome.webRequest.WebResponseErrorDetails) => {
  const recording = activeRecordings.get(details.tabId);
  if (!recording) return;

  if (IGNORED_ERRORS.has(details.error)) return;

  const event: NetworkRecordingEvent = {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    statusCode: 0,
    timeStamp: details.timeStamp,
    fromCache: false,
    state: "error",
    error: details.error,
  };

  recordingEvents.get(details.tabId)?.push(event);

  chrome.runtime
    .sendMessage({
      action: CLIENT_MESSAGES.NETWORK_EVENT_CAPTURED,
      event,
      tabId: details.tabId,
    })
    .catch(() => {});
};

const addWebRequestListeners = () => {
  if (!chrome.webRequest.onCompleted.hasListener(onRequestCompleted)) {
    chrome.webRequest.onCompleted.addListener(onRequestCompleted, { urls: ["<all_urls>"] }, ["responseHeaders"]);
  }
  if (!chrome.webRequest.onErrorOccurred.hasListener(onRequestError)) {
    chrome.webRequest.onErrorOccurred.addListener(onRequestError, { urls: ["<all_urls>"] });
  }
};

const removeWebRequestListeners = () => {
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

export const startNetworkRecording = (
  senderTabId: number | undefined,
  url: string,
  config: Record<string, any> = {}
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
      recordingEvents.set(tab.id, []);
      tabService.setData(tab.id, TAB_SERVICE_DATA.NETWORK_RECORDING, { active: true, senderTabId });

      addWebRequestListeners();

      if (hasSidePanelAPI && config.showWidget !== false) {
        chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: "sidepanel/network-recording/index.html",
          enabled: true,
        });
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      }

      resolve({ success: true, targetTabId: tab.id });
    });
  });
};

export const stopNetworkRecording = (
  targetTabId: number
): { success: boolean; events?: NetworkRecordingEvent[]; error?: string } => {
  if (!activeRecordings.has(targetTabId)) {
    return { success: false, error: `No active recording for tab ${targetTabId}` };
  }

  const events = recordingEvents.get(targetTabId) || [];

  activeRecordings.delete(targetTabId);
  recordingEvents.delete(targetTabId);
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
): { active: boolean; events: NetworkRecordingEvent[]; startTime: number } | null => {
  const recording = activeRecordings.get(tabId);
  if (!recording) return null;

  return {
    active: true,
    events: recordingEvents.get(tabId) || [],
    startTime: recording.startTime,
  };
};

export const handleNetworkRecordingOnClientPageLoad = (tab: chrome.tabs.Tab) => {
  const recordingData = tabService.getData(tab.id, TAB_SERVICE_DATA.NETWORK_RECORDING);
  if (!recordingData?.active) return;

  if (hasSidePanelAPI) {
    chrome.sidePanel
      .setOptions({
        tabId: tab.id,
        path: "sidepanel/network-recording/index.html",
        enabled: true,
      })
      .catch(() => {});
  }
};

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!activeRecordings.has(tabId)) return;

  const recording = activeRecordings.get(tabId);
  const events = recordingEvents.get(tabId) || [];

  activeRecordings.delete(tabId);
  recordingEvents.delete(tabId);

  if (activeRecordings.size === 0) {
    removeWebRequestListeners();
  }

  if (recording?.senderTabId != null) {
    chrome.tabs
      .sendMessage(recording.senderTabId, {
        action: "networkRecordingTerminated",
        targetTabId: tabId,
        events,
      })
      .catch(() => {});
  }
});
