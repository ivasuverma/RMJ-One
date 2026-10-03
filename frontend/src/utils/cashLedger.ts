// Shared by the Cash Ledger screens (app/cash-ledger).
export type Balances = Record<string, number>;   // { INR: 17500, USD: -200 } — never converted into each other
export type CLAccount = {
  id: string; name: string; phone?: string; note?: string; currency: string;
  balances: Balances; entries: number; last_date: string | null; created_at: string;
};

export const BASE_CURRENCY = 'INR';

// The common ones first; any other 3-letter code can be typed in.
export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'INR', name: 'Indian Rupee' },
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
      fmtCache[code] = new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2 });
    } catch {
      fmtCache[code] = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
  }
  return fmtCache[code];
}

/** "₹17,500", "$200", "AED 1,250.50" — always positive; the caller says owes / owe. */
export function money(n: number, code: string = BASE_CURRENCY): string {
  const s = formatter(code).format(Math.abs(n));
  return /\d/.test(s.charAt(0)) ? `${code} ${s}` : s;   // a code with no symbol
}

export function symbol(code: string): string {
  const parts = formatter(code).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value || code;
}

/** Currencies in a stable order: INR first, then the rest alphabetically. */
export function orderedCodes(b: Balances): string[] {
  return Object.keys(b).sort((x, y) => (x === BASE_CURRENCY ? -1 : y === BASE_CURRENCY ? 1 : x.localeCompare(y)));
}

// Letters only, so "Imran (Dubai)" is "ID", not "I(".
export const initials = (name: string) => name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  .slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
