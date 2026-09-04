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
//        PUPPETEER_EXECUTABLE_PATH (required — path to chrome.exe)
// Prints one JSON line to stdout: {ok, gold: {rate, row_text}, silver: {rate,
// row_text}, source_url} or {ok: false, error}. Exit code non-zero on
// failure, or if EITHER row couldn't be read.
const puppeteer = require('puppeteer-core');

const URL = process.env.GOLD_RATE_SOURCE_URL || 'https://ayodhyabullion.com';
const GOLD_LABEL = process.env.GOLD_RATE_ROW_LABEL || 'GOLD RETAIL HAJIR';
const SILVER_LABEL = process.env.GOLD_RATE_SILVER_LABEL || 'SILVER RETAIL HAJIR';

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
    // show up near each label, not just the labels themselves.
    await page.waitForFunction(
      (goldLabel, silverLabel) => {
        const text = document.body.innerText;
        const has = (label) => new RegExp(label + '[\\s\\S]{0,400}\\d{5,}').test(text);
        return has(goldLabel) && has(silverLabel);
      },
      { timeout: 25000 },
      GOLD_LABEL, SILVER_LABEL,
    );
    const result = await page.evaluate((goldLabel, silverLabel) => {
      // For a given row label, find the leaf element whose text contains it,
      // then walk up to the smallest ancestor whose text also contains at
      // least two numbers (Buy + Sell) — resilient to exact class
      // names/markup, which matters because this is a third-party page we
      // don't control.
      function extractRow(label) {
        const all = Array.from(document.querySelectorAll('body *'));
        const hit = all.find((el) => el.children.length === 0 && el.textContent && el.textContent.includes(label));
        if (!hit) return null;
        let node = hit;
        for (let i = 0; i < 6 && node; i++) {
          const text = node.textContent || '';
          const nums = text.match(/[\d][\d,]{2,}/g);
          if (nums && nums.length >= 2) {
            return { rowText: text.replace(/\s+/g, ' ').trim().slice(0, 200), numbers: nums.map((n) => parseInt(n.replace(/,/g, ''), 10)) };
          }
          node = node.parentElement;
        }
        return null;
      }
      return { gold: extractRow(goldLabel), silver: extractRow(silverLabel) };
    }, GOLD_LABEL, SILVER_LABEL);

    const pick = (row) => (row && row.numbers && row.numbers.length ? { rate: row.numbers[row.numbers.length - 1], row_text: row.rowText } : null);
    const gold = pick(result.gold);
    const silver = pick(result.silver);
    if (!gold || !silver) {
      throw new Error(`could not extract both rows (gold=${gold ? 'ok' : 'missing'}, silver=${silver ? 'ok' : 'missing'})`);
    }
    console.log(JSON.stringify({ ok: true, gold, silver, source_url: URL }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
})();
