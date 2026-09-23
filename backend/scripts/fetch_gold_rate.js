// Fetches today's reference gold + silver rates from a configured supplier
// page (Ayodhya Jewellers' live bullion board by default) by actually
// rendering it with Chrome — the page injects rates via a live JS/WebSocket
// feed after load (Angular app backed by wss://api.innovativex.in), so a
// plain HTTP GET sees an empty shell with no rate numbers in it at all.
//
// Reuses the Chrome already installed for OpenWA (PUPPETEER_EXECUTABLE_PATH
// env var, set by the Python caller) so this needs no separate browser
// download, and runs against `puppeteer-core` resolved via NODE_PATH from
// OpenWA's own node_modules (also set by the caller) for the same reason.
//
// Usage: node fetch_gold_rate.js
// Env:   GOLD_RATE_SOURCE_URL     (default: https://ayodhyabullion.com)
//        GOLD_RATE_ROW_LABEL      (default: GOLD RETAIL HAJIR)
//        GOLD_RATE_SILVER_LABEL   (default: SILVER RETAIL HAJIR)
//        GOLD_RATE_XAU_LABEL      (default: GOLD SPOT) — international $/oz spot, informational only
//        GOLD_RATE_XAG_LABEL      (default: SILVER SPOT) — same, silver
//        GOLD_RATE_USDINR_LABEL   (default: USD/INR)
//        PUPPETEER_EXECUTABLE_PATH (required — path to chrome.exe)
// Prints one JSON line to stdout: {ok, gold: {rate, row_text}, silver: {rate,
// row_text}, xau: {rate, row_text}|null, xag: {rate, row_text}|null,
// usd_inr: {rate, row_text}|null, source_url} or {ok: false, error}. Exit
// code non-zero on failure, or if EITHER of gold/silver couldn't be read —
// xau/xag/usd_inr are best-effort (null on a miss, doesn't fail the whole
// fetch) since they're informational display fields, not what the shop
// actually prices off.
const puppeteer = require('puppeteer-core');

const URL = process.env.GOLD_RATE_SOURCE_URL || 'https://ayodhyabullion.com';
const GOLD_LABEL = process.env.GOLD_RATE_ROW_LABEL || 'GOLD RETAIL HAJIR';
const SILVER_LABEL = process.env.GOLD_RATE_SILVER_LABEL || 'SILVER RETAIL HAJIR';
const XAU_LABEL = process.env.GOLD_RATE_XAU_LABEL || 'GOLD SPOT';
const XAG_LABEL = process.env.GOLD_RATE_XAG_LABEL || 'SILVER SPOT';
const USDINR_LABEL = process.env.GOLD_RATE_USDINR_LABEL || 'USD/INR';

(async () => {
  let browser;
  try {
    if (!process.env.PUPPETEER_EXECUTABLE_PATH) throw new Error('PUPPETEER_EXECUTABLE_PATH not set');
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    // Both row labels render immediately, but the Buy/Sell numbers populate a
    // moment later once the live feed pushes a value — wait for a number to
    // show up near each label, not just the labels themselves. Only gold+silver
    // gate the wait — xau/xag/usd_inr are best-effort (see file header).
    await page.waitForFunction(
      (goldLabel, silverLabel) => {
        const text = document.body.innerText;
        const has = (label) => new RegExp(label + '[\\s\\S]{0,400}\\d{5,}').test(text);
        return has(goldLabel) && has(silverLabel);
      },
      { timeout: 25000 },
      GOLD_LABEL, SILVER_LABEL,
    );
    const result = await page.evaluate((goldLabel, silverLabel, xauLabel, xagLabel, usdInrLabel) => {
      // For a given row label, find the leaf element whose text contains it,
      // then walk up to the smallest ancestor whose text also contains at
      // least `minNums` numbers (2 for a Buy+Sell row, 1 for a single spot
      // value) — resilient to exact class names/markup, which matters
      // because this is a third-party page we don't control. Numbers may
      // carry a decimal part (spot $ prices and USD/INR do; INR rupee
      // amounts don't, but matching one anyway is harmless).
      function extractRow(label, minNums) {
        const all = Array.from(document.querySelectorAll('body *'));
        const hit = all.find((el) => el.children.length === 0 && el.textContent && el.textContent.includes(label));
        if (!hit) return null;
        let node = hit;
        for (let i = 0; i < 6 && node; i++) {
          const text = node.textContent || '';
          const nums = text.match(/\d[\d,]*(?:\.\d+)?/g);
          if (nums && nums.length >= minNums) {
            return { rowText: text.replace(/\s+/g, ' ').trim().slice(0, 200), numbers: nums.map((n) => parseFloat(n.replace(/,/g, ''))) };
          }
          node = node.parentElement;
        }
        return null;
      }
      return {
        gold: extractRow(goldLabel, 2), silver: extractRow(silverLabel, 2),
        xau: extractRow(xauLabel, 1), xag: extractRow(xagLabel, 1), usd_inr: extractRow(usdInrLabel, 1),
      };
    }, GOLD_LABEL, SILVER_LABEL, XAU_LABEL, XAG_LABEL, USDINR_LABEL);

    const pickLast = (row) => (row && row.numbers && row.numbers.length ? { rate: row.numbers[row.numbers.length - 1], row_text: row.rowText } : null);
    // Spot/USD-INR rows show just the one value — pick the first number
    // after the label rather than the last (which for these rows is the
    // same number, but first is the more natural read for a single-value row).
    const pickFirst = (row) => (row && row.numbers && row.numbers.length ? { rate: row.numbers[0], row_text: row.rowText } : null);
    const gold = pickLast(result.gold);
    const silver = pickLast(result.silver);
    if (!gold || !silver) {
      throw new Error(`could not extract both rows (gold=${gold ? 'ok' : 'missing'}, silver=${silver ? 'ok' : 'missing'})`);
    }
    const xau = pickFirst(result.xau);
    const xag = pickFirst(result.xag);
    const usd_inr = pickFirst(result.usd_inr);
    console.log(JSON.stringify({ ok: true, gold, silver, xau, xag, usd_inr, source_url: URL }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
})();
