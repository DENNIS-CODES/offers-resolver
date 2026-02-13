/**
 * This file is where your old implementation used to build giant nested Prisma filters.
 *
 * In the optimized approach, we split filters into:
 * 1) "Eligibility + Offer existence" handled by OfferIndex SQL query
 * 2) "Outlet + Merchant static filters" handled by SQL join predicates here
 *
 * NOTE: The resulting filters are used inside a single queryRaw statement,
 * not as a Prisma OutletWhereInput. This keeps query plans stable and avoids OR fanout.
 */

export type CashbackPercentageFilters = { minBps?: number; maxBps?: number };

export type OffersInput = {
  search?: string | null;
  category?: string | null;
  percentage?: CashbackPercentageFilters | null;
  take?: number | null;
  cursor?: string | null;
};

export function normalizeTake(take: number | null | undefined): number {
  const n = take ?? 20;
  return Math.max(1, Math.min(n, 50));
}

/**
 * Keyset cursor parsing for stable pagination.
 * Cursor format: `${sortKey}:${outletId}` (base64-encoded).
 */
export function decodeCursor(cursor: string | null | undefined): { sortKey: number; outletId: string } | null {
  if (!cursor) return null;
  const raw = Buffer.from(cursor, "base64").toString("utf8");
  const [sortKeyStr, outletId] = raw.split(":");
  const sortKey = Number(sortKeyStr);
  if (!Number.isFinite(sortKey) || !outletId) return null;
  return { sortKey, outletId };
}

export function encodeCursor(sortKey: number, outletId: string): string {
  return Buffer.from(`${sortKey}:${outletId}`, "utf8").toString("base64");
}

/**
 * Escapes % and _ for ILIKE patterns.
 * We use ESCAPE '\\' in SQL so backslash escapes are respected.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}
