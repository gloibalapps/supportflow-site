/* SupportFlow first-touch attribution. Stores where a visitor first came from
   (invite code, utm tags, referring site) in this browser only. When the app
   is opened, it is sent once with the device reference. No cookies, no IP/UA. */
(function () {
  var K = "sf:attr", S = "sf:attr:sent";
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  try {
    var q = new URLSearchParams(location.search);
    var clean = function (v) { return (v || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 60); };
    var host = "";
    try { host = new URL(document.referrer).hostname.replace(/^www\./, ""); } catch (e) { }
    if (host === location.hostname.replace(/^www\./, "")) host = "";
    var ref = clean(q.get("ref")), src = clean(q.get("utm_source")), med = clean(q.get("utm_medium")), cam = clean(q.get("utm_campaign"));
    var existing = get(K);
    if (!existing || (ref && !JSON.parse(existing).ref)) {
      set(K, JSON.stringify({ ref: ref, src: src, med: med, cam: cam, host: host, path: location.pathname.slice(0, 120), ts: Date.now() }));
    }
    if (/^\/app(\.html)?\/?$/.test(location.pathname) && !get(S)) {
      var dev = get("ndis:deviceRef");
      if (!dev) {
        dev = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        set("ndis:deviceRef", dev);
      }
      var a = {}; try { a = JSON.parse(get(K) || "{}"); } catch (e) { }
      fetch("/.netlify/functions/track-signup", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ deviceRef: dev, ref: a.ref, src: a.src, med: a.med, cam: a.cam, host: a.host, path: a.path })
      }).then(function (r) { if (r.ok) set(S, "1"); }).catch(function () { });
    }
  } catch (e) { }
})();
