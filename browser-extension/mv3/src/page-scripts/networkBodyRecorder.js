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

  // Capture lifecycle (see the injection-timing-race fix below):
  //   "buffering" — interceptor is armed and captures, but we hold events in `buffer` until START
  //                 arrives with the resolved caps. This is the state at injection time.
  //   "live"      — START received; flush the buffer and stream every capture immediately.
  //   "stopped"   — STOP received, OR the READY handshake gave up with no START (this tab is not
  //                 being recorded). Drop captures and free the buffer. We do NOT call
  //                 clearInterceptors — that would nuke other SDK consumers (e.g. session recording).
  let state = "buffering";
  let registered = false;
  let buffer = [];
  // Init default; overwritten by the SW's resolved value on the START signal (keep in sync with
  // DEFAULT_MAX_PAYLOAD_SIZE in networkRecording/index.ts).
  let cfg = { maxPayloadSize: 10 * 1024 * 1024, ignoreMediaResponse: true };

  // The body recorder is registered broadly (every http(s) tab) for the recording's duration, but
  // only the recorded tab ever receives START. On every OTHER tab the interceptor sits in
  // "buffering" until the READY handshake gives up. Two guards bound memory there (and on a
  // slow-to-START recorded tab):
  //   1. the pre-START buffer is hard-capped to MAX_BUFFERED_ENTRIES (drop-oldest), so it can't grow
  //      without bound while waiting;
  //   2. when the READY handshake gives up with no START, the interceptor transitions to "stopped"
  //      and frees the buffer (see startReadyHandshake's give-up branch).
  // START normally arrives in ms, so the cap is only ever exercised on non-recorded tabs.
  const MAX_BUFFERED_ENTRIES = 100;

  const postToExtension = (action, payload) => {
    window.postMessage({ source: "requestly:client", action, payload }, window.location.href);
  };

  const emit = (data) => postToExtension(CLIENT_MESSAGES.NETWORK_BODY_CAPTURED, applyCaps(data, cfg));

  // Arm the interceptor IMMEDIATELY at injection — do NOT wait for the START signal.
  //
  // Injection-timing race fix: the web-sdk fetch/XHR override is installed at module-eval, but it
  // only emits for URLs that have a registered intercept record. Previously we registered that
  // record only on START, which arrives several async hops after the document commits (SW
  // executeScript x2 + an SW→content-script→page relay). By then the SPA's bootstrap GET /api/...
  // requests have already fired and were passed through un-emitted — so their response bodies (the
  // ones LTS correlates IDs/slugs from) were lost, and downstream auto-correlation chained 0 rows.
  //
  // Now we register synchronously and BUFFER every capture from t=0; START only flips us to live
  // (flushing the buffer first). Paired with document_start MAIN-world injection (registerContent-
  // Scripts in clientHandler/networkRecording), this guarantees request #1 is observed.
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
        if (state === "stopped") return;
        if (state === "buffering") {
          // Hold until START resolves the caps, then flush in order. Hard-cap the buffer so a tab
          // that is slow to START — or never will (a non-recorded tab the broad registration landed
          // in, before the give-up below terminates it) — cannot grow memory without bound. Keep the
          // most recent MAX_BUFFERED_ENTRIES; drop the oldest. (Kept raw, not pre-capped, so the
          // flush applies the START-resolved maxPayloadSize — capping here would use the default.)
          buffer.push(data);
          if (buffer.length > MAX_BUFFERED_ENTRIES) buffer.shift();
          return;
        }
        emit(data); // live
      },
      false
    );
    // Pull-based handshake: announce readiness so the SW sends START (with resolved caps) now that
    // we're armed and listening. We do NOT rely on the SW push-sending START — that can race the
    // content-script relay's listener and be dropped.
    startReadyHandshake();
  };

  // Announce READY and RETRY until START arrives. A single READY is not reliable: on a fast page
  // load the MAIN-world page script (document_start) can post READY before the isolated-world
  // content-script relay has attached its window 'message' listener — so that READY (or its START
  // reply) is lost and the buffer would never flush (capture silently dies). We re-post READY on a
  // short interval until state flips to "live", with a cap so we don't loop forever on a page where
  // the SW genuinely isn't recording (e.g. a non-recorded tab the broadly-registered script landed
  // in — it correctly never gets START and just stops asking).
  let readyTimer;
  let readyAttempts = 0;
  const READY_RETRY_MS = 300;
  const READY_MAX_ATTEMPTS = 20; // ~6s of retries
  const stopReadyHandshake = () => {
    if (readyTimer !== undefined) {
      clearInterval(readyTimer);
      readyTimer = undefined;
    }
  };
  const announceReady = () => {
    postToExtension(CLIENT_MESSAGES.NETWORK_BODY_RECORDER_READY);
  };
  const startReadyHandshake = () => {
    if (readyTimer !== undefined || state !== "buffering") return; // already handshaking or past it
    announceReady();
    readyAttempts = 1;
    readyTimer = setInterval(() => {
      if (state !== "buffering") {
        stopReadyHandshake(); // START (or STOP) already moved us out of buffering
        return;
      }
      if (readyAttempts >= READY_MAX_ATTEMPTS) {
        // Gave up: no START ever arrived (this tab is not being recorded, or its relay never
        // attached). Terminate capture so the interceptor stops accumulating — go "stopped" (the
        // callback early-returns on it) and free the buffered entries. Without this the buffer would
        // be retained, and keep growing up to MAX_BUFFERED_ENTRIES, for the page's whole lifetime.
        stopReadyHandshake();
        state = "stopped";
        buffer = [];
        return;
      }
      readyAttempts += 1;
      announceReady();
    }, READY_RETRY_MS);
  };

  // Try to arm now. If the UMD isn't evaluated yet in this scope, retry on microtask/next tick —
  // both scripts are injected together at document_start, so this resolves within the same frame,
  // still before the page's own bundles run their first request.
  registerInterceptorOnce();
  if (!registered) {
    Promise.resolve().then(registerInterceptorOnce);
    setTimeout(registerInterceptorOnce, 0);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "requestly:extension") return;

    if (event.data.action === EXTENSION_MESSAGES.START_NETWORK_BODY_CAPTURE) {
      const incoming = event.data.payload || {};
      if (typeof incoming.maxPayloadSize === "number") cfg.maxPayloadSize = incoming.maxPayloadSize;
      if (typeof incoming.ignoreMediaResponse === "boolean") cfg.ignoreMediaResponse = incoming.ignoreMediaResponse;
      // Only the first START matters. "live" = already started (ignore the handshake's retried
      // READYs' duplicate STARTs); "stopped" = STOPped, or the handshake gave up before START
      // arrived (>6s, effectively never for a recorded tab) — don't resurrect either.
      if (state !== "buffering") return;
      registerInterceptorOnce(); // belt-and-suspenders: ensure armed even if the eager attempts raced the UMD
      stopReadyHandshake(); // got START — stop re-posting READY
      // Flush everything captured before START (the bootstrap requests), in arrival order, with the
      // now-resolved caps — then go live.
      const pending = buffer;
      buffer = [];
      state = "live";
      pending.forEach(emit);
    } else if (event.data.action === EXTENSION_MESSAGES.STOP_NETWORK_BODY_CAPTURE) {
      // Stop capturing — do NOT call Network.clearInterceptors() (it would nuke every SDK consumer
      // on the page, e.g. session recording). Drop any unflushed buffer.
      stopReadyHandshake();
      state = "stopped";
      buffer = [];
    }
  });
})();
