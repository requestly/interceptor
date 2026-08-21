/* Analytics for interceptor-docs.requestly.com — Amplitude + GA4, both CONSENT-GATED on "tracking".

   WHY THIS FILE EXISTS
   Mintlify can inject Amplitude and GA4 for you via `integrations` in docs.json, but it injects
   them itself, before custom JS runs, and there is no setting that makes them wait for consent.
   So both were removed from docs.json and re-implemented here instead. Same vendors, same keys,
   same data — the only difference is that nothing loads until the visitor grants tracking consent,
   and a withdrawal tears both down.

   PAGEVIEWS
   Mintlify is a single-page app: the first load is a real navigation, everything after is
   history.pushState. Amplitude's autocapture and GA4's default page_view only see the first one,
   so route changes are tracked explicitly below. Without that, gating would have quietly turned a
   full pageview stream into a single event per session.

   DELIBERATELY NOT the CDN snippet build (cdn.amplitude.com/script/<key>.js). That bundle pulls in
   Session Replay, which starts a recording and contacts sr-client-cfg.amplitude.com. The docs do
   not need recording, and quietly acquiring it would need its own disclosure.

   SOURCE ATTRIBUTION
   All three Requestly properties share Amplitude project key 6d37003f0c..., so without a
   distinguishing property their traffic is indistinguishable in that project. Every event and
   user here carries source="interceptor-docs", matching the convention api-explorer already uses.
   docs.requestly.com does NOT set this yet — it is a listed follow-up on
   requestly/requestly-api-client#4540.

   Timing note: custom JS runs after the page is interactive, so these load slightly later than
   Mintlify's platform integrations did. Pageview totals should be comparable but not identical to
   history — do not read the changeover as data loss. */
(function () {
  var AMP_KEY = "6d37003f0cdb1921422bc474c634c135";
  var AMP_SDK = "https://cdn.amplitude.com/libs/analytics-browser-2.11.0-min.js.gz";
  var GA4_ID = "G-7FZEBFLWK0";
  var SOURCE = "interceptor-docs";

  var granted = false;
  var ampReady = false;
  var ga4Ready = false;

  /* ---------- Amplitude ---------- */
  function bootAmplitude() {
    if (document.getElementById("rq-amp-sdk")) return;
    var s = document.createElement("script");
    s.id = "rq-amp-sdk";
    s.src = AMP_SDK;
    s.onload = function () {
      if (!granted) return; // consent withdrawn while the SDK was in flight
      if (!window.amplitude || typeof window.amplitude.init !== "function") return;
      window.amplitude.init(AMP_KEY, {
        autocapture: {
          attribution: true,
          pageViews: true,
          sessions: true,
          formInteractions: false,
          fileDownloads: false,
          elementInteractions: false,
        },
      });
      window.amplitude.setOptOut(false); // clear a persisted opt-out from an earlier withdrawal
      try {
        var id = new window.amplitude.Identify();
        id.set("source", SOURCE);
        window.amplitude.identify(id);
      } catch (e) {}
      ampReady = true;
    };
    document.head.appendChild(s);
  }

  /* ---------- GA4 ---------- */
  function bootGa4() {
    if (document.getElementById("rq-ga4-sdk")) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window["ga-disable-" + GA4_ID] = false; // undo a previous teardown
    var s = document.createElement("script");
    s.id = "rq-ga4-sdk";
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA4_ID;
    s.onload = function () {
      if (!granted) return;
      window.gtag("js", new Date());
      /* send_page_view is left ON for the first load; SPA routes are sent explicitly below. */
      window.gtag("config", GA4_ID, { source: SOURCE });
      ga4Ready = true;
    };
    document.head.appendChild(s);
  }

  /* ---------- SPA pageviews ---------- */
  var lastPath = location.pathname + location.search;

  function trackPageView() {
    if (!granted) return;
    var path = location.pathname + location.search;
    if (path === lastPath) return; // pushState fires for hash/no-op changes too
    lastPath = path;
    if (ampReady && window.amplitude) {
      try {
        window.amplitude.track("Page Viewed", { path: location.pathname, source: SOURCE });
      } catch (e) {}
    }
    if (ga4Ready && window.gtag) {
      window.gtag("event", "page_view", {
        page_path: path,
        page_title: document.title,
        source: SOURCE,
      });
    }
  }

  function patchHistory(method) {
    var original = history[method];
    history[method] = function () {
      original.apply(this, arguments);
      setTimeout(trackPageView, 0);
    };
  }
  patchHistory("pushState");
  patchHistory("replaceState");
  window.addEventListener("popstate", function () {
    setTimeout(trackPageView, 0);
  });

  /* ---------- Shared event API ----------
     Nothing on this property emits custom events today. Exposed so that when something does, the
     sanctioned way to send it is already gated — rather than a new file loading its own SDK, which
     is how this property ended up with ungated analytics in the first place. Safe to call at any
     time: a no-op until consent exists, re-checked per call so a withdrawal takes effect. */
  window.rqAnalytics = {
    track: function (name, props) {
      if (!granted || !ampReady || !window.amplitude) return;
      var p = props || {};
      p.source = SOURCE;
      try {
        window.amplitude.track(name, p);
      } catch (e) {}
    },
  };

  /* ---------- Consent ---------- */
  function onGrant() {
    granted = true;
    bootAmplitude();
    bootGa4();
  }

  /* A loaded bundle cannot be unloaded, so silence both SDKs and clear what they persisted.
     GA4 honours the window['ga-disable-<id>'] flag; Amplitude honours setOptOut. */
  function onRevoke() {
    granted = false;
    ampReady = false;
    ga4Ready = false;
    try {
      if (window.amplitude && window.amplitude.setOptOut) window.amplitude.setOptOut(true);
    } catch (e) {}
    window["ga-disable-" + GA4_ID] = true;
    if (window.rqConsent && window.rqConsent.clearCookies) {
      window.rqConsent.clearCookies(/^(AMP_|EXP_|_ga|_gid|_gat)/);
    }
    try {
      Object.keys(localStorage)
        .filter(function (k) {
          return /^(AMP_|EXP_)/.test(k);
        })
        .forEach(function (k) {
          localStorage.removeItem(k);
        });
    } catch (e) {}
  }

  if (window.rqDocsConsent) {
    window.rqDocsConsent.whenConsent("tracking", onGrant, onRevoke);
  } else {
    console.warn("[analytics] consent gate unavailable — Amplitude and GA4 not loaded");
  }
})();
