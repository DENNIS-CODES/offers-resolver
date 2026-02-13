import DataLoader from "dataloader";
import type { PrismaClient, OfferKind } from "@prisma/client";
import { escapeLike } from "../graphql/resolvers/user/helpers/offers/filters.js";

/**
 * Offer loaders:
 * - Given a list of outletIds, return eligible offers for the current user.
 *
 * We intentionally re-use OfferIndex as the "eligibility gate".
 * The heavy eligibility logic never touches the base offer tables directly.
 */
export type OfferLoaders = {
  cashbackByOutlet: DataLoader<string, any[]>;
  exclusiveByOutlet: DataLoader<string, any[]>;
  loyaltyByOutlet: DataLoader<string, any | null>;
};

function groupBy<T extends Record<string, any>>(rows: T[], key: keyof T): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
}

/**
 * Fetch eligible OfferIndex rows for a set of outlets and a given offer kind.
 * This is a tight query over indexed tables; returns offer IDs and outlet mapping.
 */
async function eligibleOfferIndexRowsForOutlets(
  prisma: PrismaClient,
  userId: string,
  outletIds: readonly string[],
  kind: OfferKind,
): Promise<Array<{ outletId: string; offerIndexId: string; cashbackConfigurationId: string | null; exclusiveOfferId: string | null; loyaltyProgramId: string | null }>> {
  const now = new Date();

  // IMPORTANT: We keep this query stable: the only variable part is the IN list (small: <= page size).
  return prisma.$queryRaw`
    WITH profile AS (
      SELECT "merchantId", "customerType", "rank"
      FROM "UserMerchantProfile"
      WHERE "userId" = ${userId}
    )
    SELECT
      oio."outletId" as "outletId",
      oi."id" as "offerIndexId",
      oi."cashbackConfigurationId" as "cashbackConfigurationId",
      oi."exclusiveOfferId" as "exclusiveOfferId",
      oi."loyaltyProgramId" as "loyaltyProgramId"
    FROM "OfferIndex" oi
    JOIN "OfferIndexOutlet" oio ON oio."offerIndexId" = oi."id"
    LEFT JOIN profile p ON p."merchantId" = oi."merchantId"
    WHERE
      oi."kind" = ${kind}::"OfferKind"
      AND oio."outletId" IN (${prisma.join(outletIds)})
      AND oi."isActiveSnapshot" = true
      AND oi."isApprovedSnapshot" = true
      AND oi."deletedAtSnapshot" IS NULL
      AND oi."budgetExhausted" = false
      AND (
        (oi."startDate" IS NULL AND oi."endDate" IS NULL)
        OR (oi."startDate" <= ${now} AND oi."endDate" >= ${now})
      )
      AND (
        -- Cashback/Exclusive share the same eligibility table
        -- Loyalty eligibility is checked separately for kind=LOYALTY below
        (${kind}::"OfferKind" <> 'LOYALTY' AND (
          EXISTS (SELECT 1 FROM "OfferIndexCustomerType" ect WHERE ect."offerIndexId" = oi."id" AND ect."customerType" = 'All')
          OR (p."customerType" IS NOT NULL AND EXISTS (
            SELECT 1 FROM "OfferIndexCustomerType" ect WHERE ect."offerIndexId" = oi."id" AND ect."customerType" = p."customerType"
          ))
          OR (p."customerType" IS NULL AND EXISTS (
            SELECT 1 FROM "OfferIndexCustomerType" ect WHERE ect."offerIndexId" = oi."id" AND ect."customerType" = 'NonCustomer'
          ))
        ))
        OR
        (${kind}::"OfferKind" = 'LOYALTY' AND EXISTS (
          SELECT 1 FROM "LoyaltyTierIndex" lti
          WHERE lti."offerIndexId" = oi."id"
            AND lti."isActiveSnapshot" = true
            AND lti."isApprovedSnapshot" = true
            AND lti."deletedAtSnapshot" IS NULL
            AND lti."tierRank" <= COALESCE(p."rank", 0)
        ))
      );
  `;
}

export function buildOfferLoaders(prisma: PrismaClient, userId: string): OfferLoaders {
  const cashbackByOutlet = new DataLoader<string, any[]>(async (outletIds) => {
    const rows = await eligibleOfferIndexRowsForOutlets(prisma, userId, outletIds, "CASHBACK" as any);

    const byOutlet = groupBy(rows, "outletId");
    const cashbackIds = Array.from(new Set(rows.map((r) => r.cashbackConfigurationId).filter(Boolean))) as string[];

    const offers = cashbackIds.length
      ? await prisma.cashbackConfiguration.findMany({
          where: { id: { in: cashbackIds } },
          select: { id: true, name: true },
        })
      : [];
    const offerById = new Map(offers.map((o) => [o.id, o]));

    return outletIds.map((oid) => (byOutlet.get(oid) ?? []).map((r) => offerById.get(r.cashbackConfigurationId!)).filter(Boolean));
  });

  const exclusiveByOutlet = new DataLoader<string, any[]>(async (outletIds) => {
    const rows = await eligibleOfferIndexRowsForOutlets(prisma, userId, outletIds, "EXCLUSIVE" as any);
    const byOutlet = groupBy(rows, "outletId");
    const offerIds = Array.from(new Set(rows.map((r) => r.exclusiveOfferId).filter(Boolean))) as string[];

    const offers = offerIds.length
      ? await prisma.exclusiveOffer.findMany({
          where: { id: { in: offerIds } },
          select: { id: true, name: true, description: true },
        })
      : [];
    const offerById = new Map(offers.map((o) => [o.id, o]));

    return outletIds.map((oid) => (byOutlet.get(oid) ?? []).map((r) => offerById.get(r.exclusiveOfferId!)).filter(Boolean));
  });

  const loyaltyByOutlet = new DataLoader<string, any | null>(async (outletIds) => {
    // Loyalty is merchant-level, but OfferIndexOutlet already maps it to outlets.
    const rows = await eligibleOfferIndexRowsForOutlets(prisma, userId, outletIds, "LOYALTY" as any);
    const byOutlet = groupBy(rows, "outletId");
    const programIds = Array.from(new Set(rows.map((r) => r.loyaltyProgramId).filter(Boolean))) as string[];

    const programs = programIds.length
      ? await prisma.loyaltyProgram.findMany({
          where: { id: { in: programIds } },
          select: { id: true, name: true },
        })
      : [];
    const programById = new Map(programs.map((p) => [p.id, p]));

    // For each outlet we return the "first" eligible program (should be at most 1 per merchant in this schema).
    return outletIds.map((oid) => {
      const first = (byOutlet.get(oid) ?? [])[0];
      if (!first?.loyaltyProgramId) return null;
      return programById.get(first.loyaltyProgramId) ?? null;
    });
  });

  return { cashbackByOutlet, exclusiveByOutlet, loyaltyByOutlet };
}
