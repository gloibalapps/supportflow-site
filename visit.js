/* SupportFlow privacy-safe visit beacon. No cookies, no storage, no IDs.
   Sends only path, referring site and utm tags; the server hashes IP+UA with
   a salt that rotates daily, so visitors cannot be tracked across days. */
(function () {
  try {
    if (navigator.doNotTrack === "1" || navigator.webdriver) return;
    var q = new URLSearchParams(location.search), ref = "";
    try { ref = new URL(document.referrer).hostname.replace(/^www\./, ""); } catch (e) {}
    if (ref === location.hostname.replace(/^www\./, "")) ref = "";
    var body = JSON.stringify({ p: location.pathname.slice(0, 120), r: ref.slice(0, 120),
      s: q.get("utm_source"), m: q.get("utm_medium"), c: q.get("utm_campaign") });
    var u = "/.netlify/functions/track-visit";
    if (!(navigator.sendBeacon && navigator.sendBeacon(u, new Blob([body], { type: "text/plain" }))))
      fetch(u, { method: "POST", body: body, keepalive: true, credentials: "omit" });
  } catch (e) {}
})();
