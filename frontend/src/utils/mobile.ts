/**
 * Mobile numbers identify customers and karigars: pickers search by them and
 * no two of the same kind may share one. Numbers compare on their last 10
 * digits, so "+91 98765 43210", "098765-43210" and "9876543210" are the same.
 */
export const mobileKey = (s?: string | null): string => (s || '').replace(/\D/g, '').slice(-10);

/** Whether a stored mobile matches what's typed in a search box (digits only). */
export const mobileMatches = (stored: string | undefined | null, typed: string): boolean => {
  const q = typed.replace(/\D/g, '');
  return !q || (stored || '').replace(/\D/g, '').includes(q);
};

/** The party (if any) already saved with this mobile number. */
export function findByMobile<T extends { mobile?: string | null }>(list: T[], mobile: string): T | undefined {
  const k = mobileKey(mobile);
  return k.length >= 7 ? list.find((x) => mobileKey(x.mobile) === k) : undefined;
}
