// Display-only twin of netlify/lib/premium-window.mjs.
// The server decides the amount Stripe charges. This file only updates
// marketing copy so it shows A$149 as the real price and A$129 until the
// end of 31 January 2027, Australia/Adelaide, then A$149 with no deploy.
(function (root) {
  var LIST = 149;
  var WINDOW = 129;
  var UNTIL = "2027-01-31";
  var TZ = "Australia/Adelaide";
  function adelaideDate(now) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now || new Date());
    var get = function (type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
      return "";
    };
    return get("year") + "-" + get("month") + "-" + get("day");
  }
  function windowOpen(now) { return adelaideDate(now) <= UNTIL; }
  function saving() {
    var amount = Math.round((LIST - WINDOW) * 100) / 100;
    var percent = Math.round((amount / LIST) * 100);
    return { amount: amount, percent: percent };
  }
  function apply(doc) {
    var rootDoc = doc || (typeof document !== "undefined" ? document : null);
    if (!rootDoc || !rootDoc.querySelectorAll) return;
    var s = saving();
    var open = windowOpen();
    var pct = rootDoc.querySelectorAll("[data-premium-pct]");
    for (var i = 0; i < pct.length; i++) pct[i].textContent = String(s.percent);
    var aud = rootDoc.querySelectorAll("[data-premium-saving-aud]");
    for (var j = 0; j < aud.length; j++) aud[j].textContent = String(s.amount);
    var ctas = rootDoc.querySelectorAll("[data-premium-cta]");
    for (var n = 0; n < ctas.length; n++) ctas[n].textContent = "Get Premium \u2014 A$" + (open ? WINDOW : LIST);
    if (!open) {
      var hide = rootDoc.querySelectorAll("[data-premium-window]");
      for (var k = 0; k < hide.length; k++) { hide[k].hidden = true; hide[k].style.display = "none"; }
    }
  }
  root.SupportFlowPremium = {
    listAud: LIST,
    windowAud: WINDOW,
    until: UNTIL,
    untilLabel: "31 January 2027",
    tz: TZ,
    adelaideDate: adelaideDate,
    windowOpen: windowOpen,
    chargeAud: function (now) { return windowOpen(now) ? WINDOW : LIST; },
    saving: saving,
    apply: apply,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
