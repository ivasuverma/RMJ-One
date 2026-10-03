// Shared by the Cash Ledger screens (app/cash-ledger).
export type Balances = Record<string, number>;   // { INR: 17500, USD: -200 } — never converted into each other
export type CLAccount = {
  id: string; name: string; phone?: string; note?: string; currency: string;
  balances: Balances; entries: number; last_date: string | null; created_at: string;
};

export const BASE_CURRENCY = 'INR';

// Gold and silver by weight (grams, 3 decimals), under their ISO codes. Like
// any currency, their balance is kept on its own and never turned into rupees.
export const METALS: Record<string, { name: string; symbol: string }> = {
  XAU: { name: 'Gold', symbol: 'Au' },
  XAG: { name: 'Silver', symbol: 'Ag' },
};
const grams = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

// The common ones first; any other 3-letter code can be typed in.
export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'XAU', name: 'Gold (grams)' },
  { code: 'XAG', name: 'Silver (grams)' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'KWD', name: 'Kuwaiti Dinar' },
  { code: 'OMR', name: 'Omani Rial' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'NPR', name: 'Nepalese Rupee' },
];

const fmtCache: Record<string, Intl.NumberFormat> = {};
function formatter(code: string): Intl.NumberFormat {
  if (!fmtCache[code]) {
    try {
      // ₹ $ € £ for the big four; everything else keeps a clear prefix (A$, CA$, AED…) so AUD never looks like USD.
      const display = ['INR', 'USD', 'EUR', 'GBP'].includes(code) ? 'narrowSymbol' : 'symbol';
      fmtCache[code] = new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, currencyDisplay: display, minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch {
      fmtCache[code] = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
  }
  return fmtCache[code];
}

/** "₹17,500", "$200", "AED 1,250.50", "10.500 g" (gold), "500.000 g Ag" (silver) — always positive; the caller says owes / owe. */
export function money(n: number, code: string = BASE_CURRENCY): string {
  // Gold is just grams; silver keeps "Ag" so the two can't be mixed up in a list.
  if (METALS[code]) return `${grams.format(Math.abs(n))} g${code === 'XAG' ? ' Ag' : ''}`;
  const s = formatter(code).format(Math.abs(n));
  return /\d/.test(s.charAt(0)) ? `${code} ${s}` : s;   // a code with no symbol
}

const plain = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** "17,500" (or "10.500" grams for gold/silver) — no symbol, for statement columns that already say the currency. */
export const num = (n: number, code?: string) => (code && METALS[code] ? grams : plain).format(Math.abs(n));

/** "Indian Rupee", "Gold (grams)", or the code itself. */
export const currencyName = (code: string) => CURRENCIES.find((c) => c.code === code)?.name || code;

export function symbol(code: string): string {
  if (METALS[code]) return METALS[code].symbol;
  const parts = formatter(code).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value || code;
}

/** Currencies in a stable order: INR, gold, silver, then the rest alphabetically. */
const FIRST = [BASE_CURRENCY, 'XAU', 'XAG'];
const rank = (c: string) => (FIRST.includes(c) ? FIRST.indexOf(c) : FIRST.length);
export function orderedCodes(b: Balances): string[] {
  return Object.keys(b).sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
}

// Letters only, so "Imran (Dubai)" is "ID", not "I(".
export const initials = (name: string) => name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  .slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
