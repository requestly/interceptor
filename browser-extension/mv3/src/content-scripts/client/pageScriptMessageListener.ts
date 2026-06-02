import { CLIENT_MESSAGES, EXTENSION_MESSAGES } from "common/constants";

export const initPageScriptMessageListener = () => {
  // SW → page relay for Network Interceptor v2 body capture start/stop control signals.
  // The page script (networkBodyRecorder, MAIN world) listens for source "requestly:extension".
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message?.action === EXTENSION_MESSAGES.START_NETWORK_BODY_CAPTURE ||
      message?.action === EXTENSION_MESSAGES.STOP_NETWORK_BODY_CAPTURE
    ) {
      window.postMessage(
        { source: "requestly:extension", action: message.action, payload: message.payload },
        window.location.href
      );
    }
  });

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.data.source !== "requestly:client") {
      return;
    }

    switch (event.data.action) {
      case "response_rule_applied":
      case "request_rule_applied":
        // tabId not populated from content script. Popuplate in service worker
        chrome.runtime.sendMessage({
          action: EXTENSION_MESSAGES.RULE_EXECUTED,
          rule: event.data.rule,
          requestDetails: event.data.requestDetails,
        });
        break;
      case EXTENSION_MESSAGES.ON_BEFORE_AJAX_REQUEST:
        chrome.runtime.sendMessage(event.data, () => {
          window.postMessage(
            {
              source: "requestly:client",
              action: CLIENT_MESSAGES.ON_BEFORE_AJAX_REQUEST_PROCESSED,
            },
            window.location.href
          );
        });
        break;
      case EXTENSION_MESSAGES.ON_ERROR_OCCURRED:
        chrome.runtime.sendMessage(event.data, () => {
          window.postMessage(
            {
              source: "requestly:client",
              action: CLIENT_MESSAGES.ON_ERROR_OCCURRED_PROCESSED,
            },
            window.location.href
          );
        });
        break;
      case EXTENSION_MESSAGES.CACHE_SHARED_STATE:
        chrome.runtime.sendMessage(event.data);
        break;
      case CLIENT_MESSAGES.NETWORK_BODY_CAPTURED:
        // Network Interceptor v2: forward a captured XHR/Fetch body+headers to the SW.
        // Fire-and-forget; tabId is added in the SW from sender.tab.id.
        chrome.runtime.sendMessage({
          action: CLIENT_MESSAGES.NETWORK_BODY_CAPTURED,
          payload: event.data.payload,
        });
        break;
    }
  });
};
