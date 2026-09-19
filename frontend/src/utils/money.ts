// Compact Indian money format for tiles where a full figure won't fit or is
// noise: 15,45,500 -> ₹15.45L, 1,25,00,000 -> ₹1.25Cr. Truncated (not rounded)
// to two decimals so a tile never shows more cash than there is; trailing zeros
// drop (₹15L, ₹15.5L). Below a lakh the exact amount is short, so it's shown in
// full with Indian digit grouping.
export function fmtCompactINR(n: number): string {
  const v = Math.round(n || 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  // Integer hundredths of the unit, THEN divide: floor(1.15 * 100) is 114 in
  // floating point, which would show ₹1,15,000 as ₹1.14L.
  const short = (hundredths: number, unit: string) => `${sign}₹${(hundredths / 100).toString()}${unit}`;
  if (abs >= 10000000) return short(Math.floor(abs / 100000), 'Cr');
  if (abs >= 100000) return short(Math.floor(abs / 1000), 'L');
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}
