/* Consent bootstrap for interceptor-docs.requestly.com.

   WHY THIS EXISTS
   Until this landed, this docs site ran GA4 and Amplitude with no consent banner and no gate of
   any kind. It also carries the SAME GA4 measurement id (G-7FZEBFLWK0) and the SAME Amplitude
   project key (6d37003f0c...) as requestly.com and docs.requestly.com, so a visitor who pressed
   "Reject Optional" on the marketing site and then followed a link here was tracked anyway, under
   the same device id.

   HOW IT IS FIXED
   TrustArc writes its decision cookies on `.requestly.com`, so a choice made on the marketing
   site is ALREADY readable here. We therefore load the marketing site's gate rather than shipping
   a third copy of it:

     https://requestly.com/js/consent.js  ->  window.rqConsent

   One implementation, one set of category indexes, no drift across the three properties. If that
   request fails, rqConsent never appears and every consumer stays shut — fail closed, which is
   the correct direction.

   MINTLIFY CONSTRAINTS worth knowing before changing any of this:
     * Custom JS cannot be injected into <head>; it runs after the page is interactive. TrustArc
       auto-block is therefore NOT available on this property (it must be the first script on the
       page to intercept anything). Enforcement here is the explicit rqConsent gate only.
     * Mintlify auto-includes every .js file under this folder on every page, in an order we do
       not control. Consumers must not assume window.rqConsent exists yet — use whenConsent()
       below, which waits for it.
     * Mintlify's OWN telemetry is injected by the platform and cannot be gated from JS. It is
       gated instead by `integrations.cookies` in docs.json, which disables telemetry unless a
       localStorage key is present. This file writes that key on grant and removes it on revoke.
       Keep the key/value here in sync with docs.json.

   This file is deliberately identical to documentation/js/consent-bootstrap.js in
   requestly/requestly-api-client (docs.requestly.com). If one changes, change both. */
(function () {
  var GATE_SRC = "https://requestly.com/js/consent.js";
  var NOTICE_SRC = "https://consent.trustarc.com/v2/notice/87juza";

  /* Mirrors the "tracking" grant into localStorage for docs.json -> integrations.cookies.
     Must match docs.json exactly. */
  var MINTLIFY_KEY = "rq_consent_tracking";
  var MINTLIFY_VALUE = "granted";

  if (window.rqDocsConsent) return; // Mintlify is a SPA; only bootstrap once per load.

  /* TrustArc draws the banner into this element. requestly.com provides it in its layout; on
     Mintlify we have no template to edit, so create it. */
  function ensureMount() {
    if (document.getElementById("consent-banner")) return;
    var d = document.createElement("div");
    d.id = "consent-banner";
    d.style.cssText = "position:fixed;bottom:0;left:0;width:100%;z-index:999999";
    document.body.appendChild(d);
  }

  function inject(src, id) {
    if (document.getElementById(id)) return;
    var s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.async = true;
    document.head.appendChild(s);
  }

  /* Consumers call this instead of touching window.rqConsent directly, because file order is not
     guaranteed and the gate arrives over the network. Polls for up to ~20s, then gives up —
     giving up means nothing non-essential ever runs, which is the safe outcome. */
  var waiters = [];
  function whenConsent(need, onGrant, onRevoke) {
    waiters.push({ need: need, onGrant: onGrant, onRevoke: onRevoke });
  }

  var tries = 0;
  var poll = setInterval(function () {
    tries++;
    if (window.rqConsent) {
      clearInterval(poll);
      /* Keep Mintlify's telemetry flag in step with the tracking grant. */
      window.rqConsent.on(
        "tracking",
        function () {
          try {
            localStorage.setItem(MINTLIFY_KEY, MINTLIFY_VALUE);
          } catch (e) {}
        },
        function () {
          try {
            localStorage.removeItem(MINTLIFY_KEY);
          } catch (e) {}
        }
      );
      waiters.forEach(function (w) {
        window.rqConsent.on(w.need, w.onGrant, w.onRevoke);
      });
      waiters = [];
      /* Late callers (SPA navigation) go straight through. */
      whenConsent = function (need, onGrant, onRevoke) {
        window.rqConsent.on(need, onGrant, onRevoke);
      };
      window.rqDocsConsent.whenConsent = function (n, g, r) {
        whenConsent(n, g, r);
      };
      return;
    }
    if (tries > 200) {
      clearInterval(poll);
      console.warn("[consent] " + GATE_SRC + " did not load — nothing non-essential will run.");
    }
  }, 100);

  window.rqDocsConsent = {
    whenConsent: function (n, g, r) {
      whenConsent(n, g, r);
    },
  };

  ensureMount();
  inject(GATE_SRC, "rq-consent-gate");
  inject(NOTICE_SRC, "truste-consent-js");
})();
