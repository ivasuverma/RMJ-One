// Shared by the Cash Ledger screens (app/cash-ledger).
export type CLAccount = { id: string; name: string; phone?: string; note?: string; balance: number; entries: number; last_date: string | null; created_at: string };

export const inr = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
