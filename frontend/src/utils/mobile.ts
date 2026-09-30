/**
 * Mobile numbers identify customers and karigars: they're entered mobile
 * first, and no two of the same kind may share one. Numbers compare on their
 * last 10 digits, so "+91 98765 43210", "098765-43210" and "9876543210" match.
 */
export const mobileKey = (s?: string | null): string => (s || '').replace(/\D/g, '').slice(-10);

/** The party (if any) already saved with this mobile number. */
export function findByMobile<T extends { mobile?: string | null }>(list: T[], mobile: string): T | undefined {
  const k = mobileKey(mobile);
  return k.length >= 7 ? list.find((x) => mobileKey(x.mobile) === k) : undefined;
}
