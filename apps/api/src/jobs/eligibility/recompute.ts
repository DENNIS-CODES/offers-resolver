import type { PrismaClient } from "@fusion/db";
import { customerTypeRank } from "@fusion/shared";

/**
 * Recompute functions are idempotent:
 * - Upsert the OfferIndex row
 * - Replace child rows (customer types / outlets / tier ranks)
 *
 * This keeps correctness easy and avoids complex incremental diffs.
 */

function isApproved(review: { status: string } | null | undefined): boolean {
  return review?.status === "Approved";
}

function cashbackBudgetExhausted(net: any, used: any): boolean {
  // Mirrors original eligibility: used < net
  // If net is 0, treat as exhausted (no budget).
  try {
    const netNum = Number(net);
    const usedNum = Number(used);
    return !(usedNum < netNum);
  } catch {
    return true;
  }
}

function offerBudgetExhausted(net: any, used: any): boolean {
  try {
    const netNum = Number(net);
    const usedNum = Number(used);
    return !(usedNum < netNum);
  } catch {
    return true;
  }
}

function pointsLimitExhausted(limit: any, used: any): boolean {
  // If limit is null -> unlimited
  if (limit == null) return false;
  try {
    const limitNum = Number(limit);
    const usedNum = Number(used);
    return usedNum >= limitNum;
  } catch {
    return true;
  }
}

export async function rebuildUserMerchantProfilesForUser(prisma: PrismaClient, userId: string): Promise<void> {
  const rows = await prisma.customerType.findMany({
    where: { userId },
    select: { merchantId: true, type: true },
  });

  // Replace-all strategy for this user.
  await prisma.userMerchantProfile.deleteMany({ where: { userId } });

  if (!rows.length) return;

  await prisma.userMerchantProfile.createMany({
    data: rows.map((r) => ({
      userId,
      merchantId: r.merchantId,
      customerType: r.type,
      rank: customerTypeRank(r.type),
    })),
  });
}

export async function rebuildCashbackIndex(prisma: PrismaClient, cashbackConfigurationId: string): Promise<void> {
  const cc = await prisma.cashbackConfiguration.findUnique({
    where: { id: cashbackConfigurationId },
    include: {
      Review: true,
      Outlets: { select: { id: true } },
      CashbackConfigurationTiers: {
        where: {
          isActive: true,
          deletedAt: null,
          Review: { status: "Approved" as any },
        },
        select: { percentage: true },
      },
    },
  });

  if (!cc) return;

  const maxBps = cc.CashbackConfigurationTiers.reduce((max, t) => Math.max(max, t.percentage), 0);

  const exhausted = cashbackBudgetExhausted(cc.netCashbackBudget, cc.usedCashbackBudget);

  const index = await prisma.offerIndex.upsert({
    where: { cashbackConfigurationId },
    update: {
      kind: "CASHBACK" as any,
      merchantId: cc.merchantId,
      isActiveSnapshot: cc.isActive,
      isApprovedSnapshot: isApproved(cc.Review),
      deletedAtSnapshot: cc.deletedAt,
      budgetExhausted: exhausted,
      startDate: cc.startDate,
      endDate: cc.endDate,
      maxCashbackPercentBps: maxBps,
      computedAt: new Date(),
    },
    create: {
      kind: "CASHBACK" as any,
      merchantId: cc.merchantId,
      cashbackConfigurationId: cc.id,
      isActiveSnapshot: cc.isActive,
      isApprovedSnapshot: isApproved(cc.Review),
      deletedAtSnapshot: cc.deletedAt,
      budgetExhausted: exhausted,
      startDate: cc.startDate,
      endDate: cc.endDate,
      maxCashbackPercentBps: maxBps,
    },
    select: { id: true },
  });

  // Replace child rows in a transaction for consistency.
  await prisma.$transaction([
    prisma.offerIndexCustomerType.deleteMany({ where: { offerIndexId: index.id } }),
    prisma.offerIndexOutlet.deleteMany({ where: { offerIndexId: index.id } }),
    prisma.offerIndexCustomerType.createMany({
      data: cc.eligibleCustomerTypes.map((ct) => ({ offerIndexId: index.id, customerType: ct })),
    }),
    prisma.offerIndexOutlet.createMany({
      data: cc.Outlets.map((o) => ({ offerIndexId: index.id, outletId: o.id })),
      skipDuplicates: true,
    }),
  ]);
}

export async function rebuildExclusiveIndex(prisma: PrismaClient, exclusiveOfferId: string): Promise<void> {
  const eo = await prisma.exclusiveOffer.findUnique({
    where: { id: exclusiveOfferId },
    include: {
      Review: true,
      Outlets: { select: { id: true } },
      Merchant: { select: { id: true } },
    },
  });

  if (!eo) return;

  const merchantId = eo.merchantId ?? eo.Merchant?.id;
  if (!merchantId) return;

  const exhausted = offerBudgetExhausted(eo.netOfferBudget, eo.usedOfferBudget);

  const index = await prisma.offerIndex.upsert({
    where: { exclusiveOfferId },
    update: {
      kind: "EXCLUSIVE" as any,
      merchantId,
      isActiveSnapshot: eo.isActive,
      isApprovedSnapshot: isApproved(eo.Review),
      deletedAtSnapshot: eo.deletedAt,
      budgetExhausted: exhausted,
      startDate: eo.startDate,
      endDate: eo.endDate,
      maxCashbackPercentBps: null,
      computedAt: new Date(),
    },
    create: {
      kind: "EXCLUSIVE" as any,
      merchantId,
      exclusiveOfferId: eo.id,
      isActiveSnapshot: eo.isActive,
      isApprovedSnapshot: isApproved(eo.Review),
      deletedAtSnapshot: eo.deletedAt,
      budgetExhausted: exhausted,
      startDate: eo.startDate,
      endDate: eo.endDate,
    },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.offerIndexCustomerType.deleteMany({ where: { offerIndexId: index.id } }),
    prisma.offerIndexOutlet.deleteMany({ where: { offerIndexId: index.id } }),
    prisma.offerIndexCustomerType.createMany({
      data: eo.eligibleCustomerTypes.map((ct) => ({ offerIndexId: index.id, customerType: ct })),
    }),
    prisma.offerIndexOutlet.createMany({
      data: eo.Outlets.map((o) => ({ offerIndexId: index.id, outletId: o.id })),
      skipDuplicates: true,
    }),
  ]);
}

export async function rebuildLoyaltyIndexByMerchant(prisma: PrismaClient, merchantId: string): Promise<void> {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    include: {
      LoyaltyProgram: {
        include: {
          Review: true,
          LoyaltyTiers: { include: { Review: true } },
          MerchantLoyaltyRewards: { include: { Review: true } },
        },
      },
      Outlets: { select: { id: true } },
    },
  });

  if (!merchant?.LoyaltyProgram) return;

  const lp = merchant.LoyaltyProgram;

  const exhausted = pointsLimitExhausted(lp.pointsIssuedLimit, lp.pointsUsedInPeriod);

  // We only index loyalty programs that have at least one active+approved tier and one active+approved reward,
  // matching the original filter.
  const activeApprovedTierRanks = lp.LoyaltyTiers
    .filter((t) => t.isActive && !t.deletedAt && isApproved(t.Review))
    .map((t) => customerTypeRank(t.minCustomerType));

  const hasRewards = lp.MerchantLoyaltyRewards.some((r) => r.isActive && isApproved(r.Review));
  const isApprovedSnapshot = isApproved(lp.Review) && hasRewards && activeApprovedTierRanks.length > 0;

  const index = await prisma.offerIndex.upsert({
    where: { loyaltyProgramId: lp.id },
    update: {
      kind: "LOYALTY" as any,
      merchantId,
      isActiveSnapshot: lp.isActive,
      isApprovedSnapshot,
      deletedAtSnapshot: null,
      budgetExhausted: exhausted,
      startDate: null,
      endDate: null,
      maxCashbackPercentBps: null,
      computedAt: new Date(),
    },
    create: {
      kind: "LOYALTY" as any,
      merchantId,
      loyaltyProgramId: lp.id,
      isActiveSnapshot: lp.isActive,
      isApprovedSnapshot,
      deletedAtSnapshot: null,
      budgetExhausted: exhausted,
    },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.offerIndexOutlet.deleteMany({ where: { offerIndexId: index.id } }),
    prisma.loyaltyTierIndex.deleteMany({ where: { offerIndexId: index.id } }),
    prisma.offerIndexOutlet.createMany({
      data: merchant.Outlets.map((o) => ({ offerIndexId: index.id, outletId: o.id })),
      skipDuplicates: true,
    }),
    prisma.loyaltyTierIndex.createMany({
      data: activeApprovedTierRanks.map((rank) => ({
        offerIndexId: index.id,
        tierRank: rank,
        isActiveSnapshot: true,
        isApprovedSnapshot: true,
        deletedAtSnapshot: null,
      })),
      skipDuplicates: true,
    }),
  ]);
}
