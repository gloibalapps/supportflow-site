// Billing switch + real Stripe checkout JS, removed alongside the pricing section.
// Restore both together at official launch.

/* ---------- billing switch ---------- */
(function () {
  var m = document.getElementById('btn-m'), y = document.getElementById('btn-y');
  var amt = document.getElementById('amt'), per = document.getElementById('per');
  var sub = document.getElementById('sub'), badge = document.getElementById('badge');

  var MONTHLY = 19.99, YEARLY = 219;
  var saving = (MONTHLY * 12 - YEARLY).toFixed(2);
  var pct = Math.round((1 - YEARLY / (MONTHLY * 12)) * 100);

  function show(yearly) {
    m.setAttribute('aria-pressed', String(!yearly));
    y.setAttribute('aria-pressed', String(yearly));
    amt.textContent = '$' + (yearly ? YEARLY : MONTHLY).toFixed(2);
    per.textContent = yearly ? 'per year' : 'per month';
    sub.innerHTML = yearly
      ? 'Billed yearly at launch, <span class="save">saves $' + saving + ' a year, ' + pct + '% off</span>. Works out at $' + (YEARLY / 12).toFixed(2) + ' a month.'
      : 'Billed monthly at launch. Cancel any time.';
    badge.textContent = '14 days free';
  }
  m.addEventListener('click', function () { show(false); });
  y.addEventListener('click', function () { show(true); });
  show(false);

  /* ---------- real checkout ---------- */
  function deviceRef() {
    var k = 'ndis:deviceRef';
    var v = localStorage.getItem(k);
    if (!v) {
      v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem(k, v);
    }
    return v;
  }

  var subscribeBtn = document.getElementById('btn-subscribe');
  var errBox = document.getElementById('checkout-err');

  subscribeBtn.addEventListener('click', function () {
    var plan = y.getAttribute('aria-pressed') === 'true' ? 'yearly' : 'monthly';
    errBox.style.display = 'none';
    subscribeBtn.disabled = true;
    var originalText = subscribeBtn.textContent;
    subscribeBtn.textContent = 'One moment…';

    fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: plan, clientReferenceId: deviceRef() }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (result) {
        if (result.ok && result.data && result.data.url) {
          window.location.href = result.data.url;
          return;
        }
        throw new Error((result.data && result.data.error) || 'Something went wrong starting checkout.');
      })
      .catch(function (e) {
        errBox.textContent = e.message || 'Checkout isn\'t available right now. Try again shortly.';
        errBox.style.display = 'block';
        subscribeBtn.disabled = false;
        subscribeBtn.textContent = originalText;
      });
  });
})();