import { CLIENT_MESSAGES, EXTENSION_EXTERNAL_MESSAGES, EXTENSION_MESSAGES } from "common/constants";
import { checkIfNoRulesPresent, getRulesAndGroups } from "common/rulesStore";
import { applyScriptRules } from "../scriptRuleHandler";
import {
  cacheRecordedSessionOnClientPageUnload,
  getTabSession,
  handleSessionRecordingOnClientPageLoad,
  initSessionRecordingSDK,
  launchUrlAndStartRecording,
  onSessionRecordingStartedNotification,
  onSessionRecordingStoppedNotification,
  startRecordingExplicitly,
  stopRecording,
  watchRecording,
} from "../sessionRecording";
import { initCustomWidgets } from "../customWidgets";
import { getAPIResponse } from "../apiClient";
import { requestProcessor } from "../requestProcessor";
import {
  handleTestRuleOnClientPageLoad,
  launchUrlAndStartRuleTesting,
  saveTestRuleResult,
} from "../testThisRuleHandler";
import ruleExecutionHandler from "../ruleExecutionHandler";
import { getPopupConfig, isExtensionEnabled, isUrlInBlockList } from "../../../utils";
import { globalStateManager } from "../globalStateManager";
import { isProxyApplied } from "../proxy";
import {
  connectToDesktopAppAndApplyProxy,
  disconnectFromDesktopAppAndRemoveProxy,
  checkIfDesktopAppOpen,
} from "../desktopApp/index";
import { sendMessageToApp } from "./sender";
import { triggerOpenCurlModalMessage, updateExtensionStatus } from "../utils";
import extensionIconManager from "../extensionIconManager";
import {
  startNetworkRecording,
  stopNetworkRecording,
  getNetworkRecordingState,
  getNetworkRecordingSummary,
  handleNetworkRecordingOnClientPageLoad,
  onNetworkBodyCaptured,
  onBodyRecorderReady,
  reopenNetworkRecordingPanel,
  refreshIncognitoAllowedCache,
} from "../networkRecording";

/**
 * Derives the true origin of a message sender from browser-populated fields
 * (`sender.origin`, falling back to parsing `sender.url`). Chrome sets these from the
 * actual sending frame, so — unlike anything inside the message payload — a web page
 * cannot forge them. Returns `undefined` when no origin can be determined; an opaque
 * (sandboxed) frame legitimately serializes to the string "null".
 *
 * Used to pin caller-supplied `requestDetails.initiator` to the real sender origin so a
 * page cannot claim another origin (RQ-3050 and its onBeforeAjaxRequest sibling).
 */
const getTrustedSenderOrigin = (sender: chrome.runtime.MessageSender): string | undefined => {
  if (sender.origin) {
    return sender.origin;
  }
  if (!sender.url) {
    return undefined;
  }
  try {
    return new URL(sender.url).origin;
  } catch {
    return undefined;
  }
};

export const initExternalMessageListener = () => {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case EXTENSION_EXTERNAL_MESSAGES.GET_EXTENSION_METADATA:
        // Re-seed the incognito-allowed cache on every pre-flight (no change event exists) and
        // expose it so LTS can gate the "Incognito window" option before a start.
        Promise.all([isExtensionEnabled(), refreshIncognitoAllowedCache()])
          .then(([enabled, incognitoAllowed]) => {
            sendResponse({
              name: chrome.runtime.getManifest().name,
              version: chrome.runtime.getManifest().version,
              isExtensionEnabled: enabled,
              incognitoAllowed,
            });
          })
          .catch(() => {
            sendResponse({
              name: chrome.runtime.getManifest().name,
              version: chrome.runtime.getManifest().version,
              isExtensionEnabled: false,
              incognitoAllowed: false,
            });
          });
        return true;

      case EXTENSION_EXTERNAL_MESSAGES.START_NETWORK_RECORDING:
        startNetworkRecording(message.payload?.url, message.payload?.config || {}, {
          tabId: sender.tab?.id,
          windowId: sender.tab?.windowId,
        }).then(sendResponse);
        return true;

      case EXTENSION_EXTERNAL_MESSAGES.STOP_NETWORK_RECORDING:
        sendResponse(stopNetworkRecording(message.payload?.targetTabId));
        break;

      case EXTENSION_EXTERNAL_MESSAGES.GET_NETWORK_RECORDING_SUMMARY:
        sendResponse(getNetworkRecordingSummary(message.payload?.targetTabId));
        break;
    }
  });
};

export const initMessageHandler = () => {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    /* From any case, return true when sendResponse is called asynchronously */
    switch (message.action) {
      case EXTENSION_MESSAGES.HANDSHAKE_CLIENT:
        isExtensionEnabled().then((isExtensionStatusEnabled) => {
          if (!isExtensionStatusEnabled) return;
          initCustomWidgets(sender.tab?.id, sender.frameId);
          applyScriptRules(sender.tab?.id, sender.frameId, sender.url, sender.tab?.url);
        });
        break;

      case EXTENSION_MESSAGES.CLIENT_PAGE_LOADED:
        ruleExecutionHandler.processTabCachedRulesExecutions(sender.tab.id);
        handleTestRuleOnClientPageLoad(sender.tab);
        handleSessionRecordingOnClientPageLoad(sender.tab, sender.frameId);
        handleNetworkRecordingOnClientPageLoad(sender.tab);
        break;

      case EXTENSION_MESSAGES.INIT_SESSION_RECORDER:
        initSessionRecordingSDK(sender.tab.id, sender.frameId).then(() => sendResponse());
        return true;

      case CLIENT_MESSAGES.NOTIFY_SESSION_RECORDING_STARTED:
        onSessionRecordingStartedNotification(sender.tab.id, message.payload.markRecordingIcon);
        break;

      case CLIENT_MESSAGES.NOTIFY_SESSION_RECORDING_STOPPED:
        onSessionRecordingStoppedNotification(sender.tab.id);
        break;

      case CLIENT_MESSAGES.NETWORK_BODY_CAPTURED:
        // Network Interceptor v2: an XHR/Fetch body+headers captured by the SDK page script.
        onNetworkBodyCaptured(sender.tab?.id, message.payload, sender.frameId);
        break;

      case CLIENT_MESSAGES.NETWORK_BODY_RECORDER_READY:
        // Network Interceptor v2: the page body-recorder is armed — reply with START (resolved caps).
        onBodyRecorderReady(sender.tab?.id);
        break;

      case EXTENSION_MESSAGES.REOPEN_NETWORK_RECORDING_PANEL:
        // Floating widget asked to reopen the closed side panel for this tab.
        reopenNetworkRecordingPanel(sender.tab?.id);
        break;

      case EXTENSION_MESSAGES.START_RECORDING_EXPLICITLY:
        startRecordingExplicitly(message.tab ?? sender.tab, message.showWidget);
        break;

      case EXTENSION_MESSAGES.START_RECORDING_ON_URL:
        launchUrlAndStartRecording(message.url);
        break;

      case EXTENSION_MESSAGES.STOP_RECORDING:
        stopRecording(message.tabId ?? sender.tab.id, message.openRecording);
        break;

      case EXTENSION_MESSAGES.GET_TAB_SESSION:
        getTabSession(message.tabId, sendResponse);
        return true;

      case EXTENSION_MESSAGES.GET_RULES_AND_GROUPS:
        getRulesAndGroups().then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.GET_API_RESPONSE:
        getAPIResponse(message.apiRequest).then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.GET_EXECUTED_RULES:
        ruleExecutionHandler.getExecutedRules(message.tabId ?? sender.tab.id).then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.CHECK_IF_NO_RULES_PRESENT:
        checkIfNoRulesPresent().then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.CHECK_IF_EXTENSION_ENABLED:
        isExtensionEnabled().then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.TOGGLE_EXTENSION_STATUS:
        console.log(`[Toggle extension status] message received`, {
          message,
        });
        updateExtensionStatus(message.newStatus)
          .then((updatedStatus) => {
            const response = {
              success: true,
              updatedStatus,
            };
            sendResponse(response);
            console.log(`[Toggle extension status] response sent`, {
              ...response,
              extensionIconState: extensionIconManager.getState(),
            });
          })
          .catch((e) => {
            sendResponse({
              success: false,
            });
            console.log(
              "[messageHandler.handleToggleExtensionStatus] Error occurred while updating extension status.",
              {
                error: e.message,
                extensionIconState: extensionIconManager.getState(),
                message,
              }
            );
          });
        return true;

      case EXTENSION_MESSAGES.WATCH_RECORDING:
        watchRecording(message.tabId ?? sender.tab?.id);
        break;

      case EXTENSION_MESSAGES.CACHE_RECORDED_SESSION_ON_PAGE_UNLOAD:
        cacheRecordedSessionOnClientPageUnload(sender.tab.id, message.payload);
        break;

      case EXTENSION_MESSAGES.ON_BEFORE_AJAX_REQUEST:
        // Security (RQ-3050 sibling): handleInitiatorDomainFunction stamps requestDetails.initiator
        // into headers for rules that use rq_request_initiator_origin(). This message arrives over
        // the same forgeable page channel, so pin initiator to the unforgeable sender origin — a page
        // must not be able to claim another origin. requestDetails.url / requestHeaders stay as-is (the
        // AJAX target is legitimately cross-origin, and forwardHeadersOnRedirect scopes its own rule to
        // the user's redirect destination). For real traffic initiator === sender origin, so this is a
        // no-op; an opaque frame's origin is "null", which is also its truthful value.
        requestProcessor
          .onBeforeAJAXRequest(sender.tab.id, {
            ...message.requestDetails,
            initiator: getTrustedSenderOrigin(sender),
          })
          .then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.ON_ERROR_OCCURRED: {
        // Security (RQ-3050): handleCSPError strips the Content-Security-Policy header for
        // requestDetails.initiator. This message is relayed from the page's MAIN world, where
        // the caller-supplied initiator is forgeable, so a page could arm a CSP-removal rule for
        // an arbitrary third-party origin. Pin the target to the browser-provided sender origin
        // (unforgeable) so a page can only ever affect its own origin. The legitimate emitter
        // already sends initiator === location.origin and posts same-frame, so this is a no-op
        // for real traffic — keep the emitter same-frame (never window.top) or this breaks.
        const trustedOrigin = getTrustedSenderOrigin(sender);
        if (!sender.tab?.id || !trustedOrigin || trustedOrigin === "null") {
          sendResponse();
          return true;
        }
        requestProcessor
          .onErrorOccurred(sender.tab.id, { ...message.requestDetails, initiator: trustedOrigin })
          .then(sendResponse);
        return true;
      }

      case EXTENSION_MESSAGES.TEST_RULE_ON_URL:
        launchUrlAndStartRuleTesting(message, sender.tab.id);
        break;

      case EXTENSION_MESSAGES.SAVE_TEST_RULE_RESULT:
        saveTestRuleResult(message, sender.tab);
        break;

      case EXTENSION_MESSAGES.RULE_EXECUTED:
        const requestDetails = { ...message.requestDetails, tabId: message.requestDetails?.tabId || sender.tab?.id };
        ruleExecutionHandler.onRuleExecuted(message.rule, requestDetails);
        break;

      case EXTENSION_MESSAGES.IS_EXTENSION_BLOCKED_ON_TAB: {
        if (!message.tabUrl) {
          sendResponse(false);
          break;
        }

        isUrlInBlockList(message.tabUrl)
          .then((isBlocked) => sendResponse(isBlocked))
          .catch(() => sendResponse(false));

        return true;
      }

      case EXTENSION_MESSAGES.NOTIFY_RECORD_UPDATED_IN_POPUP:
        sendMessageToApp({ action: CLIENT_MESSAGES.NOTIFY_RECORD_UPDATED, payload: message?.payload });
        break;

      case EXTENSION_MESSAGES.CACHE_SHARED_STATE:
        globalStateManager.updateSharedStateInStorage(sender.tab.id, message.sharedState);
        break;

      case EXTENSION_MESSAGES.CONNECT_TO_DESKTOP_APP:
        connectToDesktopAppAndApplyProxy()
          .then(sendResponse)
          .catch(() => sendResponse(false));
        return true;

      case EXTENSION_MESSAGES.DISCONNECT_FROM_DESKTOP_APP:
        disconnectFromDesktopAppAndRemoveProxy()
          .then(sendResponse)
          .catch(() => sendResponse(false));
        return true;

      case EXTENSION_MESSAGES.IS_PROXY_APPLIED:
        isProxyApplied().then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.CHECK_IF_DESKTOP_APP_OPEN:
        checkIfDesktopAppOpen().then(sendResponse);
        return true;

      case EXTENSION_MESSAGES.IS_SESSION_REPLAY_ENABLED:
        getPopupConfig()
          .then((config) => {
            sendResponse(config?.session_replay === true);
          })
          .catch(() => {
            sendResponse(false);
          });
        return true;

      case EXTENSION_MESSAGES.TRIGGER_OPEN_CURL_MODAL:
        triggerOpenCurlModalMessage({}, message.source);
        break;

      case EXTENSION_MESSAGES.STOP_NETWORK_RECORDING:
        stopNetworkRecording(message.targetTabId || sender.tab?.id);
        break;

      case EXTENSION_MESSAGES.GET_NETWORK_RECORDING_STATE:
        sendResponse(getNetworkRecordingState(message.tabId || sender.tab?.id));
        return true;
    }

    return false;
  });
};
