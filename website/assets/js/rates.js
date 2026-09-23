// Live rate widget for the homepage.
// Fetches the same public endpoint the RMJ-One app's own /rates screen uses
// (backend/routers/public.py -> GET /api/public/rates), then does a full
// page reload after every fetch cycle instead of patching the DOM in place
// - this page runs unattended as a public display, so a clean reload each
// cycle is simpler and more robust than long-lived JS state.
(function () {
  var API_BASE = 'https://app.rmj.co.in/api';
  var REFRESH_MS = 60000;

  function fmtINR(n) {
    if (n === null || n === undefined) return '—';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }

  function fmtUSD(n) {
    if (n === null || n === undefined) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtTime(iso) {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    } catch (e) {
      return null;
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function render(data) {
    setText('rate-gold-buy', fmtINR(data.gold_buy));
    setText('rate-gold-sell', fmtINR(data.gold_sell));
    setText('rate-silver-buy', fmtINR(data.silver_buy));
    setText('rate-silver-sell', fmtINR(data.silver_sell));
    setText('rate-xau', fmtUSD(data.xau_usd));
    setText('rate-xag', fmtUSD(data.xag_usd));
    setText('rate-usdinr', data.usd_inr === null || data.usd_inr === undefined ? '—' : '₹' + data.usd_inr.toFixed(2));
    var t = fmtTime(data.fetched_at);
    setText('rate-updated', t ? ('Updated ' + t + ' IST') : '');
    setText('rate-error', '');
  }

  function showError() {
    setText('rate-error', 'Could not load rates right now.');
  }

  function scheduleReload() {
    window.setTimeout(function () { window.location.reload(); }, REFRESH_MS);
  }

  function load() {
    fetch(API_BASE + '/public/rates')
      .then(function (res) {
        if (!res.ok) throw new Error('bad status');
        return res.json();
      })
      .then(render)
      .catch(showError)
      .then(scheduleReload, scheduleReload);
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();
    var btn = document.getElementById('rates-refresh-btn');
    if (btn) btn.addEventListener('click', function () { window.location.reload(); });
  });
})();
