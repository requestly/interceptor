import { CLIENT_MESSAGES, EXTENSION_MESSAGES } from "common/constants";

/**
 * Shows a small floating widget on a recorded tab when the network-recording side panel is closed,
 * and hides it when the panel reopens. The widget's "Open panel" click asks the SW to reopen the
 * side panel.
 *
 * NOTE (gesture caveat): sidePanel.open() needs a live user gesture, and the gesture does not
 * survive the content-script → SW message hop — so the SW-side reopen may be rejected by Chrome.
 * This is a deliberate first-pass to verify behaviour in practice; if it doesn't open, the reopen
 * mechanism needs rethinking (see the panel-reopen discussion).
 */

const TAG_NAME = "rq-network-recording-widget";

const getWidget = (): HTMLElement | null => document.querySelector(TAG_NAME);

const showWidget = () => {
  let widget = getWidget();
  if (!widget) {
    // createElement is fine from the isolated world — the element class is defined in the MAIN
    // world (customElements.js) and upgrades this node. Do NOT touch customElements.* here; it's
    // null in this context.
    widget = document.createElement(TAG_NAME);
    widget.classList.add("rq-element");
    widget.addEventListener("reopen", () => {
      chrome.runtime.sendMessage({ action: EXTENSION_MESSAGES.REOPEN_NETWORK_RECORDING_PANEL });
    });
    document.documentElement.appendChild(widget);
  }
  widget.dispatchEvent(new CustomEvent("show"));
};

const hideWidget = () => {
  getWidget()?.dispatchEvent(new CustomEvent("hide"));
};

export const initNetworkRecordingWidgetHandler = () => {
  // Top frame only — the client content script runs in all_frames, but the widget belongs to the
  // page, not its (many) ad/tracker iframes.
  if (window.top !== window) return;

  chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
      case CLIENT_MESSAGES.SHOW_NETWORK_RECORDING_WIDGET:
        showWidget();
        break;
      case CLIENT_MESSAGES.HIDE_NETWORK_RECORDING_WIDGET:
        hideWidget();
        break;
    }
    return false;
  });
};
