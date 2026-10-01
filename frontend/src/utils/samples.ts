// Stock In/Out: pieces can come back from a karigar in parts.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type Part = { id: string; weight: number; pieces: number; note?: string; received_at: string; received_by: string };

/** What has already come back in parts, and what is still out. */
export function partsSummary(s: { weight: number; pc_count?: number; partial_receipts?: Part[] }) {
  const parts = s.partial_receipts || [];
  const backW = round3(parts.reduce((t, p) => t + (p.weight || 0), 0));
  const backPcs = parts.reduce((t, p) => t + (p.pieces || 0), 0);
  return { parts, backW, backPcs, outW: round3(s.weight - backW), outPcs: Math.max(0, (s.pc_count ?? 1) - backPcs) };
}
