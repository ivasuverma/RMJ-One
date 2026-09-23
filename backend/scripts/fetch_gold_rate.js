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
//        GOLD_RATE_USDINR_LABEL   (default: USD/INR)
//        PUPPETEER_EXECUTABLE_PATH (required — path to chrome.exe)
// Prints one JSON line to stdout: {ok, gold: {rate, row_text}, silver: {rate,
// row_text}, usd_inr: {rate, row_text}|null, source_url} or {ok: false,
// error}. Exit code non-zero on failure, or if EITHER of gold/silver
// couldn't be read — usd_inr is best-effort (null on a miss, doesn't fail
// the whole fetch) since it's an informational display field, not what the
// shop actually prices off. XAU/XAG spot come from a separate, independent
// source (twelvedata.com's API — see gold_rate.py's _fetch_spot_prices),
// not from this scrape: the source page lays those out as separate cells
// with no reliable single label to anchor on, and a dedicated price API is
// far less fragile than DOM-scraping a page whose markup can (and did,
// twice) change under us.
const puppeteer = require('puppeteer-core');

const URL = process.env.GOLD_RATE_SOURCE_URL || 'https://ayodhyabullion.com';
const GOLD_LABEL = process.env.GOLD_RATE_ROW_LABEL || 'GOLD RETAIL HAJIR';
const SILVER_LABEL = process.env.GOLD_RATE_SILVER_LABEL || 'SILVER RETAIL HAJIR';
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
    // gate the wait — usd_inr is best-effort (see file header).
    await page.waitForFunction(
      (goldLabel, silverLabel) => {
        const text = document.body.innerText;
        const has = (label) => new RegExp(label + '[\\s\\S]{0,400}\\d{5,}').test(text);
        return has(goldLabel) && has(silverLabel);
      },
      { timeout: 25000 },
      GOLD_LABEL, SILVER_LABEL,
    );
    const result = await page.evaluate((goldLabel, silverLabel, usdInrLabel) => {
      // For a given row label, find the leaf element whose text contains it,
      // then walk up to the smallest ancestor whose text also contains at
      // least `minNums` numbers (2 for a Buy+Sell row, 1 for a single spot
      // value) — resilient to exact class names/markup, which matters
      // because this is a third-party page we don't control. Numbers may
      // carry a decimal part (USD-INR does; INR rupee amounts don't, but
      // matching one anyway is harmless).
      //
      // Only numbers AFTER the label's own text count (numbers from an
      // earlier, unrelated row merged into the same ancestor don't get
      // counted). Two more exclusions, found from a real captured row
      // ("SILVER RETAIL HAJIR – 99.99%SILVER 5KG LOT" — no price in it at
      // all): a number immediately followed by '%' is a purity figure, and
      // for the two retail rows (minValue set) anything under minValue is
      // noise like a lot-size count ("5" from "5KG LOT"), not a price — real
      // gold/silver retail rates are always 4+ digits. Both used to be able
      // to satisfy minNums on their own, on a level of the tree the walk
      // reached before it got to the row's actual Buy/Sell numbers, so
      // extraction stopped there and returned lot-size/purity noise as if
      // it were the rate.
      function extractRow(label, minNums, minValue) {
        const all = Array.from(document.querySelectorAll('body *'));
        const hit = all.find((el) => el.children.length === 0 && el.textContent && el.textContent.includes(label));
        if (!hit) return null;
        let node = hit;
        for (let i = 0; i < 6 && node; i++) {
          const text = node.textContent || '';
          const idx = text.indexOf(label);
          if (idx !== -1) {
            const after = text.slice(idx + label.length);
            const numRe = /\d[\d,]*(?:\.\d+)?/g;
            const nums = [];
            let m;
            while ((m = numRe.exec(after)) !== null) {
              const tail = after.slice(m.index + m[0].length, m.index + m[0].length + 2);
              if (/^\s?%/.test(tail)) continue; // purity, e.g. "99.99%" — never the price
              const val = parseFloat(m[0].replace(/,/g, ''));
              if (val < (minValue || 0)) continue; // lot-size/count noise, too small to be a real price
              nums.push(val);
            }
            if (nums.length >= minNums) {
              return { rowText: text.replace(/\s+/g, ' ').trim().slice(0, 200), numbers: nums };
            }
          }
          node = node.parentElement;
        }
        return null;
      }
      return {
        gold: extractRow(goldLabel, 2, 1000), silver: extractRow(silverLabel, 2, 1000),
        usd_inr: extractRow(usdInrLabel, 1),
      };
    }, GOLD_LABEL, SILVER_LABEL, USDINR_LABEL);

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
    const usd_inr = pickFirst(result.usd_inr);
    console.log(JSON.stringify({ ok: true, gold, silver, usd_inr, source_url: URL }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    process.exitCode = 1;
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
})();
