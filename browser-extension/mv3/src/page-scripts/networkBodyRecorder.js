import { CLIENT_MESSAGES, EXTENSION_MESSAGES } from "common/constants";

/**
 * MAIN-world page script for Network Interceptor v2 — body + header capture for XHR/Fetch.
 *
 * v1 captures all resource types via chrome.webRequest in the service worker, but webRequest
 * cannot read bodies. For XHR/Fetch we instead use the web-sdk Network interceptor (the same
 * module session recording uses), which sees request + response headers AND bodies. The service
 * worker hard-suppresses webRequest for xhr/fetch, so this is their sole source — no correlation.
 *
 * The web-sdk UMD (`libs/requestly-web-sdk.js`) is injected before this script and declares a
 * top-level `var Requestly` (global binding), so we call `Requestly.Network.intercept(...)`
 * directly — no import/bundle needed. (Same global-reference style as sessionRecorderHelper.js.)
 *
 * Caps: Network.intercept has no size options — those live only on SessionRecorder — so we port
 * its `#filterOutLargeNetworkValues` here (media-skip + per-body maxPayloadSize, with error flags).
 */

// Mirrors web-sdk RQNetworkEventErrorCodes.
const REQUEST_TOO_LARGE = 101;
const RESPONSE_TOO_LARGE = 102;

const isMediaContentType = (contentType) => /^(image|audio|video)\/.+$/gi.test(contentType || "");

const sizeInBytes = (value) => {
  if (!value) return NaN;
  let str = value;
  if (typeof value !== "string") {
    try {
      str = JSON.stringify(value);
    } catch {
      return NaN;
    }
  }
  return str.length;
};

// Clear over-cap / media bodies in place and collect error codes — a port of the web-sdk's
// SessionRecorder.#filterOutLargeNetworkValues so behaviour matches session recording.
const applyCaps = (data, cfg) => {
  const errors = [];
  const payload = { ...data };

  if (cfg.ignoreMediaResponse && isMediaContentType(payload.contentType)) {
    payload.response = "";
  } else if (sizeInBytes(payload.response) > cfg.maxPayloadSize) {
    payload.response = "";
    errors.push(RESPONSE_TOO_LARGE);
  }

  if (sizeInBytes(payload.requestData) > cfg.maxPayloadSize) {
    payload.requestData = "";
    errors.push(REQUEST_TOO_LARGE);
  }

  payload.errors = errors;
  return payload;
};

(() => {
  // Idempotency guard across re-injections into the SAME document. The SW re-injects this script
  // on every webNavigation.onCommitted of the recorded tab, which also fires for same-document
  // (history.pushState / hash) navigations — where the previous injection's IIFE and its
  // Requestly.Network.intercept registration are still live. Without this, a second interceptor
  // would register and every XHR/Fetch would be captured (and streamed) twice. The flag lives on
  // window so it survives across separate injected-script scopes in the same document.
  if (window.__rqNetworkBodyRecorderInstalled) return;
  window.__rqNetworkBodyRecorderInstalled = true;

  let enabled = false;
  let registered = false;
  // Init default; overwritten by the SW's resolved value on the START signal (keep in sync with
  // DEFAULT_MAX_PAYLOAD_SIZE in networkRecording/index.ts).
  let cfg = { maxPayloadSize: 200 * 1024, ignoreMediaResponse: true };

  const postToExtension = (action, payload) => {
    window.postMessage({ source: "requestly:client", action, payload }, window.location.href);
  };

  const registerInterceptorOnce = () => {
    if (registered) return;
    // The web-sdk UMD declares a top-level `var Requestly`; reference it bare (same as
    // sessionRecorderHelper.js does with `Requestly.SessionRecorder`) rather than via window,
    // so it resolves the global binding regardless of how the file scope reflects onto window.
    if (typeof Requestly === "undefined" || !Requestly?.Network?.intercept) return; // UMD not present yet
    registered = true;
    // overrideResponse=false → observe only, never block/alter the real response.
    Requestly.Network.intercept(
      /.*/,
      (data) => {
        if (!enabled) return;
        postToExtension(CLIENT_MESSAGES.NETWORK_BODY_CAPTURED, applyCaps(data, cfg));
      },
      false
    );
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "requestly:extension") return;

    if (event.data.action === EXTENSION_MESSAGES.START_NETWORK_BODY_CAPTURE) {
      const incoming = event.data.payload || {};
      if (typeof incoming.maxPayloadSize === "number") cfg.maxPayloadSize = incoming.maxPayloadSize;
      if (typeof incoming.ignoreMediaResponse === "boolean") cfg.ignoreMediaResponse = incoming.ignoreMediaResponse;
      enabled = true;
      registerInterceptorOnce();
    } else if (event.data.action === EXTENSION_MESSAGES.STOP_NETWORK_BODY_CAPTURE) {
      // Gate the callback off — do NOT call Network.clearInterceptors() (it would nuke every
      // SDK consumer on the page, e.g. session recording).
      enabled = false;
    }
  });
})();
