import type { GraphQLContext } from "../../context.js";
import type { OffersInput } from "./helpers/offers/filters.js";
import { decodeCursor, encodeCursor, escapeLike, normalizeTake } from "./helpers/offers/filters.js";

/**
 * OPTIMIZED OFFERS RESOLVER
 *
 * Hot path strategy:
 * - Use OfferIndex + normalized eligibility tables to *avoid dynamic OR arrays*
 * - Do a single stable SQL query to return eligible outlet IDs for this user
 * - Fetch Outlet rows by those IDs (Prisma) and preserve ordering
 *
 * Why this is fast:
 * - No more "merchantId + eligibleCustomerTypes has X" OR lists
 * - Eligibility is expressed via joins/exists using indexed tables
 * - Query plan shape is stable and re-usable
 */
export async function offersResolver(
  _parent: unknown,
  args: { input?: OffersInput | null },
  ctx: GraphQLContext,
): Promise<{ nodes: any[]; nextCursor: string | null; hasNextPage: boolean }> {
  const userId = ctx.auth.userId;
  const input = args.input ?? {};
  const take = normalizeTake(input.take);
  const now = new Date();

  // Optional short-lived cache: safe because TTL is small and offers change frequently.
  // Use cache only when cursor is not set (first page).
  const cacheKey =
    ctx.redis && !input.cursor
      ? `offers:v3:user:${userId}:take:${take}:search:${input.search ?? ""}:cat:${input.category ?? ""}:min:${input.percentage?.minBps ?? ""}:max:${input.percentage?.maxBps ?? ""}`
      : null;

  if (cacheKey && ctx.redis) {
    const cached = await ctx.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const cursor = decodeCursor(input.cursor);
  const search = input.search?.trim() ?? null;
  const category = input.category?.trim() ?? null;
  const minBps = input.percentage?.minBps ?? null;
  const maxBps = input.percentage?.maxBps ?? null;

  /**
   * We generate eligible outlets via a UNION of:
   * - Cashback/Exclusive indices where customer type rules match for this user
   * - Loyalty indices where at least one active tier rank <= user rank for the merchant
   *
   * Then we join Outlet + Merchant + PaybillOrTill + Review constraints.
   *
   * NOTE: This is *one query* with stable shape; only parameters vary.
   */
  const rows: Array<{ outletId: string; sortKey: number }> = await ctx.prisma.$queryRaw`
    WITH
      -- User profiles: one row per merchant the user is known to be a customer of.
      profile AS (
        SELECT "merchantId", "customerType", "rank"
        FROM "UserMerchantProfile"
        WHERE "userId" = ${userId}
      ),

      eligible_cashback_or_exclusive AS (
        SELECT DISTINCT oio."outletId" AS "outletId",
          -- sortKey: prefer higher cashback % when available, else 0.
          COALESCE(oi."maxCashbackPercentBps", 0) AS "sortKey"
        FROM "OfferIndex" oi
        JOIN "OfferIndexOutlet" oio ON oio."offerIndexId" = oi."id"
        LEFT JOIN profile p ON p."merchantId" = oi."merchantId"
        WHERE
          oi."kind" IN ('CASHBACK', 'EXCLUSIVE')
          AND oi."isActiveSnapshot" = true
          AND oi."isApprovedSnapshot" = true
          AND oi."deletedAtSnapshot" IS NULL
          AND oi."budgetExhausted" = false
          AND (
            -- Cashback: the original rules allowed either (start=null,end=null) or (start<=now,end>=now)
            (oi."startDate" IS NULL AND oi."endDate" IS NULL)
            OR (oi."startDate" <= ${now} AND oi."endDate" >= ${now})
          )
          AND (
            -- Percentage filter: only applies to Cashback; for Exclusive this will be NULL and pass through unless min/max are set.
            (${minBps}::int IS NULL OR COALESCE(oi."maxCashbackPercentBps", 0) >= ${minBps}::int)
            AND (${maxBps}::int IS NULL OR COALESCE(oi."maxCashbackPercentBps", 0) <= ${maxBps}::int)
          )
          AND (
            -- Eligibility rules (normalized):
            -- 1) Offer allows All
            EXISTS (
              SELECT 1 FROM "OfferIndexCustomerType" ect
              WHERE ect."offerIndexId" = oi."id" AND ect."customerType" = 'All'
            )
            OR
            -- 2) User is a customer of merchant with matching type
            (p."customerType" IS NOT NULL AND EXISTS (
              SELECT 1 FROM "OfferIndexCustomerType" ect
              WHERE ect."offerIndexId" = oi."id" AND ect."customerType" = p."customerType"
            ))
            OR
            -- 3) Offer allows NonCustomer and user has no profile for merchant
            (p."customerType" IS NULL AND EXISTS (
              SELECT 1 FROM "OfferIndexCustomerType" ect
              WHERE ect."offerIndexId" = oi."id" AND ect."customerType" = 'NonCustomer'
            ))
          )
      ),

      eligible_loyalty AS (
        SELECT DISTINCT oio."outletId" AS "outletId",
          0 AS "sortKey"
        FROM "OfferIndex" oi
        JOIN "OfferIndexOutlet" oio ON oio."offerIndexId" = oi."id"
        LEFT JOIN profile p ON p."merchantId" = oi."merchantId"
        WHERE
          oi."kind" = 'LOYALTY'
          AND oi."isActiveSnapshot" = true
          AND oi."isApprovedSnapshot" = true
          AND oi."deletedAtSnapshot" IS NULL
          AND oi."budgetExhausted" = false
          AND EXISTS (
            -- At least one active tier rank <= user rank (NonCustomer rank=0 when no profile)
            SELECT 1
            FROM "LoyaltyTierIndex" lti
            WHERE lti."offerIndexId" = oi."id"
              AND lti."isActiveSnapshot" = true
              AND lti."isApprovedSnapshot" = true
              AND lti."deletedAtSnapshot" IS NULL
              AND lti."tierRank" <= COALESCE(p."rank", 0)
          )
      ),

      eligible_outlets AS (
        SELECT * FROM eligible_cashback_or_exclusive
        UNION
        SELECT * FROM eligible_loyalty
      )

    SELECT eo."outletId", MAX(eo."sortKey") AS "sortKey"
    FROM eligible_outlets eo
    JOIN "Outlet" o ON o."id" = eo."outletId"
    JOIN "Merchant" m ON m."id" = o."merchantId"
    LEFT JOIN "Review" r ON r."id" = o."reviewId"
    WHERE
      o."isActive" = true
      AND r."status" = 'Approved'
      AND m."status" = 'Active'
      ${category ? ctx.prisma.$queryRaw`AND m."category" = ${category}` : ctx.prisma.$queryRaw``}
      ${
        search
          ? ctx.prisma.$queryRaw`
            AND (
              o."name" ILIKE ${"%" + escapeLike(search) + "%"} ESCAPE '\\'
              OR COALESCE(o."description", '') ILIKE ${"%" + escapeLike(search) + "%"} ESCAPE '\\'
              OR m."businessName" ILIKE ${"%" + escapeLike(search) + "%"} ESCAPE '\\'
            )
          `
          : ctx.prisma.$queryRaw``
      }
      AND EXISTS (
        -- Paybill/till constraints (same as original filter, but expressed as EXISTS for performance)
        SELECT 1 FROM "PaybillOrTill" p
        LEFT JOIN "Review" pr ON pr."id" = p."reviewId"
        WHERE p."outletId" = o."id"
          AND p."isActive" = true
          AND p."deletedAt" IS NULL
          AND pr."status" = 'Approved'
      )
      ${
        cursor
          ? ctx.prisma.$queryRaw`
            AND (
              MAX(eo."sortKey") < ${cursor.sortKey}
              OR (MAX(eo."sortKey") = ${cursor.sortKey} AND eo."outletId" > ${cursor.outletId})
            )
          `
          : ctx.prisma.$queryRaw``
      }
    GROUP BY eo."outletId"
    ORDER BY "sortKey" DESC, eo."outletId" ASC
    LIMIT ${take + 1};
  `;

  const pageRows = rows.slice(0, take);
  const hasNextPage = rows.length > take;
  const outletIds = pageRows.map((r) => r.outletId);

  // Fetch outlets (and merchant) via Prisma to reuse the ORM mapping.
  const outlets = outletIds.length
    ? await ctx.prisma.outlet.findMany({
        where: { id: { in: outletIds } },
        include: { Merchant: true },
      })
    : [];

  // Preserve ordering from SQL
  const byId = new Map(outlets.map((o) => [o.id, o]));
  const ordered = outletIds.map((id) => byId.get(id)).filter(Boolean) as any[];

  // Attach private fields used by field resolvers to batch-fetch eligible offers.
  // GraphQL will ignore unknown fields, but our Outlet field resolvers can read them.
  const withHints = ordered.map((o) => ({
    ...o,
    __sortKey: pageRows.find((r) => r.outletId === o.id)?.sortKey ?? 0,
  }));

  const nextCursor =
    hasNextPage && pageRows.length
      ? encodeCursor(pageRows[pageRows.length - 1]!.sortKey, pageRows[pageRows.length - 1]!.outletId)
      : null;

  const result = { nodes: withHints, nextCursor, hasNextPage };

  if (cacheKey && ctx.redis) {
    // TTL 20 seconds: small enough for near-real-time UX; large enough to absorb burst traffic.
    await ctx.redis.set(cacheKey, JSON.stringify(result), "EX", 20);
  }

  return result;
}
