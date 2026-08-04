import { CLIENT_MESSAGES } from "common/constants";
import { getRecord } from "common/storage";
import { AutoRecordingMode, SessionRecordingConfig, SourceKey, SourceOperator } from "common/types";
import { matchSourceUrl } from "../../common/ruleMatcher";
import { injectWebAccessibleScript } from "./utils";
import config from "common/config";
import { TAB_SERVICE_DATA, tabService } from "./tabService";
import extensionIconManager from "./extensionIconManager";
import { isExtensionEnabled } from "../../utils";

const CONFIG_STORAGE_KEY = "sessionRecordingConfig";

const getTopFrameOrigin = (url?: string): string | undefined => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

// Ensures the per-recording relay auth fields (RQ-3095 / RQ-3096) are present and
// stable across every frame of the tab: one random token, generated once and reused
// (so top and iframes share it), plus the top-frame origin used as the relay
// postMessage targetOrigin. Both are broadcast to all frames via startRecording.
const withRelayAuth = (data: Record<string, any>, topUrl?: string): Record<string, any> => ({
  ...data,
  relayToken: data.relayToken ?? crypto.randomUUID(),
  trustedOrigin: getTopFrameOrigin(topUrl),
});

const getSessionRecordingConfig = async (url: string): Promise<SessionRecordingConfig> => {
  const sessionRecordingConfig = await getRecord<SessionRecordingConfig>(CONFIG_STORAGE_KEY);

  if (!sessionRecordingConfig) {
    return null;
  }

  let pageSources = sessionRecordingConfig?.pageSources || [];

  if (await isExtensionEnabled()) {
    if ("autoRecording" in sessionRecordingConfig) {
      if (!sessionRecordingConfig?.autoRecording.isActive) {
        return null;
      } else if (sessionRecordingConfig?.autoRecording.mode === AutoRecordingMode.ALL_PAGES) {
        pageSources = [
          {
            value: "*",
            key: SourceKey.URL,
            isActive: true,
            operator: SourceOperator.WILDCARD_MATCHES,
          },
        ];
      }
    }

    if (pageSources.some((pageSource) => matchSourceUrl(pageSource, url))) {
      return sessionRecordingConfig;
    }
  }

  return null;
};

export const initSessionRecordingSDK = async (tabId: number, frameId: number) => {
  await injectWebAccessibleScript("libs/requestly-web-sdk.js", {
    tabId,
    frameIds: [frameId],
  });
};

export const onSessionRecordingStartedNotification = (tabId: number, markIcon: boolean) => {
  if (markIcon) {
    extensionIconManager.markRecording(tabId);
  }
};

export const onSessionRecordingStoppedNotification = (tabId: number) => {
  extensionIconManager.markNotRecording(tabId);
};

export const getTabSession = (tabId: number, callback: () => void) => {
  chrome.tabs.sendMessage(
    tabId,
    { action: CLIENT_MESSAGES.GET_TAB_SESSION },
    { frameId: 0 }, // top frame
    callback
  );
};

export const watchRecording = (tabId: number) => {
  chrome.tabs.create({ url: `${config.WEB_URL}/sessions/draft/${tabId}` });
};

const startRecording = (tabId: number, config: Record<string, any>) => {
  return chrome.tabs.sendMessage(tabId, {
    action: CLIENT_MESSAGES.START_RECORDING,
    payload: config,
  });
};

export const stopRecording = (tabId: number, openRecording: boolean) => {
  chrome.tabs.sendMessage(tabId, { action: CLIENT_MESSAGES.STOP_RECORDING }, () => {
    tabService.removeData(tabId, TAB_SERVICE_DATA.SESSION_RECORDING);
  });

  if (openRecording) {
    watchRecording(tabId);
  }
};

export const startRecordingExplicitly = async (tab: chrome.tabs.Tab, showWidget: boolean = true) => {
  const sessionRecordingConfig = await getSessionRecordingConfig(tab.url);

  const sessionRecordingDataExist = !!tabService.getData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING);
  // Auto recording is on for current tab if sessionRecordingConfig exist,
  // so forcefully start explicit recording.
  if (!sessionRecordingConfig && sessionRecordingDataExist) {
    return;
  }

  const sessionRecordingData = withRelayAuth({ explicit: true, showWidget }, tab.url);
  tabService.setData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING, sessionRecordingData);

  startRecording(tab.id, sessionRecordingData);
};

export const launchUrlAndStartRecording = (url: string) => {
  chrome.tabs.create({ url }, (tab) => {
    tabService.setData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING, {
      notify: true,
      explicit: true,
      showWidget: true,
    });
  });
};

export const handleSessionRecordingOnClientPageLoad = async (tab: chrome.tabs.Tab, frameId: number) => {
  let sessionRecordingData = tabService.getData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING);

  if (!sessionRecordingData) {
    const sessionRecordingConfig = await getSessionRecordingConfig(tab.url);

    if (sessionRecordingConfig) {
      sessionRecordingData = { config: sessionRecordingConfig, url: tab.url };
      const recordingMode = sessionRecordingConfig?.autoRecording?.mode;

      sessionRecordingData.showWidget = recordingMode === AutoRecordingMode.CUSTOM;

      if (recordingMode === AutoRecordingMode.ALL_PAGES) {
        sessionRecordingData.markRecordingIcon = false;
      }

      tabService.setData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING, sessionRecordingData);
    }
  } else if (!sessionRecordingData.explicit) {
    // stop recording if config was changed to turn off auto-recording for the session URL
    const sessionRecordingConfig = await getSessionRecordingConfig(sessionRecordingData.url);

    if (!sessionRecordingConfig) {
      stopRecording(tab.id, false);
      return;
    }
  }

  if (sessionRecordingData) {
    // Attach/keep the stable relay token + top origin before broadcasting so every
    // frame (top and iframes, including ones that load later) receives the same values.
    sessionRecordingData = withRelayAuth(sessionRecordingData, tab.url);
    tabService.setData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING, sessionRecordingData);

    startRecording(tab.id, sessionRecordingData).then(() => {
      tabService.setData(tab.id, TAB_SERVICE_DATA.SESSION_RECORDING, {
        ...sessionRecordingData,
        notify: false,
        previousSession: null,
      });
    });
  }
};

export const cacheRecordedSessionOnClientPageUnload = (tabId: number, payload: any) => {
  const sessionRecordingData = tabService.getData(tabId, TAB_SERVICE_DATA.SESSION_RECORDING);
  if (sessionRecordingData) {
    tabService.setData(tabId, TAB_SERVICE_DATA.SESSION_RECORDING, {
      ...sessionRecordingData,
      previousSession: payload.session,
      widgetPosition: payload.widgetPosition,
      recordingStartTime: payload.recordingStartTime,
    });
  }
};

export const stopRecordingOnAllTabs = () => {
  Object.values(tabService.getTabs()).forEach(({ id: tabId }) => {
    if (tabId && tabService.getData(tabId, TAB_SERVICE_DATA.SESSION_RECORDING)) {
      stopRecording(tabId, false);
    }
  });
};
