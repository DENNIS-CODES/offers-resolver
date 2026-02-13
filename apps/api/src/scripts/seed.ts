/**
 * Seed data for the "offers" take-home repo.
 *
 * What this gives you:
 * - Multiple merchants + outlets + paybills
 * - Approved vs Pending reviews (to test gating)
 * - Cashback configs:
 *    - "All" (visible for everyone)
 *    - "Vip" (visible only for VIP at that merchant)
 *    - Exhausted budget (should not show)
 *    - Future-dated (should not show yet)
 * - Exclusive offers:
 *    - "NonCustomer" (visible only when user has no CustomerType for that merchant)
 *    - "All"
 *    - Inactive / Pending review (should not show)
 * - Loyalty program:
 *    - tiers at New + Regular + Vip (eligibility depends on user rank)
 *    - rewards required
 * - CustomerType rows for a few synthetic users
 * - Then runs recompute helpers to populate OfferIndex and UserMerchantProfile.
 *
 * Run:
 *   yarn workspace @fusion/api seed
 *
 * Optional:
 *   yarn workspace @fusion/api seed --big
 *   (adds extra outlets + OfferIndex rows to stress-test performance)
 */

import "dotenv/config";
import { prisma } from "@fusion/db";
import { Prisma } from "@prisma/client";

import {
  rebuildCashbackIndex,
  rebuildExclusiveIndex,
  rebuildLoyaltyIndexByMerchant,
  rebuildUserMerchantProfilesForUser,
} from "../jobs/eligibility/recompute.js";

const args = new Set(process.argv.slice(2));
const BIG = args.has("--big");
const NO_RESET = args.has("--no-reset");

const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[seed] ${msg}`);
}

async function resetDb() {
  log("Resetting tables...");

  // Many-to-many join tables created by Prisma (implicit M:N)
  // If they don't exist (depending on how your schema was pushed), ignore.
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "_CashbackConfigurationToOutlet" RESTART IDENTITY CASCADE;`,
    );
  } catch {}
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "_ExclusiveOfferToOutlet" RESTART IDENTITY CASCADE;`,
    );
  } catch {}

  // Index tables first
  await prisma.offerIndexOutlet.deleteMany();
  await prisma.offerIndexCustomerType.deleteMany();
  await prisma.loyaltyTierIndex.deleteMany();
  await prisma.offerIndexRebuildLog.deleteMany();
  await prisma.offerIndex.deleteMany();
  await prisma.userMerchantProfile.deleteMany();

  // Domain tables
  await prisma.customerType.deleteMany();
  await prisma.merchantLoyaltyReward.deleteMany();
  await prisma.loyaltyTier.deleteMany();
  await prisma.loyaltyProgram.deleteMany();
  await prisma.exclusiveOffer.deleteMany();
  await prisma.cashbackConfigurationTier.deleteMany();
  await prisma.cashbackConfiguration.deleteMany();
  await prisma.paybillOrTill.deleteMany();
  await prisma.outlet.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.review.deleteMany();

  log("Reset complete.");
}

async function createReview(id: string, status: "Approved" | "Pending" | "Rejected" = "Approved") {
  return prisma.review.create({
    data: {
      id,
      status: status as any,
    },
  });
}

async function seedCore() {
  log("Seeding core dataset...");

  // Synthetic userIds (no User table needed in this simplified repo)
  const USERS = {
    demo: "demo-user", // no CustomerType rows -> good for NonCustomer tests
    vip: "user-vip",
    regular: "user-regular",
    none: "user-noncustomer",
  };

  /**
   * Merchants
   */
  await prisma.merchant.create({
    data: {
      id: "m_food_1",
      businessName: "Tasty Bites",
      status: "Active",
      category: "Food",
    },
  });

  await prisma.merchant.create({
    data: {
      id: "m_tech_1",
      businessName: "Gadget Hub",
      status: "Active",
      category: "Tech",
    },
  });

  await prisma.merchant.create({
    data: {
      id: "m_beauty_1",
      businessName: "Glow & Go",
      status: "Active",
      category: "Beauty",
    },
  });

  await prisma.merchant.create({
    data: {
      id: "m_loyalty_1",
      businessName: "Coffee Club",
      status: "Active",
      category: "Food",
    },
  });

  // Merchant not active (should be filtered out)
  await prisma.merchant.create({
    data: {
      id: "m_inactive_1",
      businessName: "Pending Store",
      status: "Pending",
      category: "Other",
    },
  });

  /**
   * Outlets + Reviews + Paybills (resolver requires outlet Review approved + active paybill/till approved)
   */
  await createReview("r_outlet_food_1", "Approved");
  await prisma.outlet.create({
    data: {
      id: "o_food_1",
      name: "Tasty Bites - CBD",
      description: "Downtown branch",
      isActive: true,
      merchantId: "m_food_1",
      reviewId: "r_outlet_food_1",
    },
  });

  await createReview("r_pay_food_1", "Approved");
  await prisma.paybillOrTill.create({
    data: {
      id: "p_food_1",
      outletId: "o_food_1",
      isActive: true,
      deletedAt: null,
      reviewId: "r_pay_food_1",
    },
  });

  await createReview("r_outlet_tech_1", "Approved");
  await prisma.outlet.create({
    data: {
      id: "o_tech_1",
      name: "Gadget Hub - Westlands",
      description: "Premium gadgets & repairs",
      isActive: true,
      merchantId: "m_tech_1",
      reviewId: "r_outlet_tech_1",
    },
  });

  await createReview("r_pay_tech_1", "Approved");
  await prisma.paybillOrTill.create({
    data: {
      id: "p_tech_1",
      outletId: "o_tech_1",
      isActive: true,
      deletedAt: null,
      reviewId: "r_pay_tech_1",
    },
  });

  await createReview("r_outlet_beauty_1", "Approved");
  await prisma.outlet.create({
    data: {
      id: "o_beauty_1",
      name: "Glow & Go - Kilimani",
      description: "Skin & beauty",
      isActive: true,
      merchantId: "m_beauty_1",
      reviewId: "r_outlet_beauty_1",
    },
  });

  await createReview("r_pay_beauty_1", "Approved");
  await prisma.paybillOrTill.create({
    data: {
      id: "p_beauty_1",
      outletId: "o_beauty_1",
      isActive: true,
      deletedAt: null,
      reviewId: "r_pay_beauty_1",
    },
  });

  // Beauty outlet WITHOUT paybill: should never appear in offers query even if offers exist
  await createReview("r_outlet_beauty_2", "Approved");
  await prisma.outlet.create({
    data: {
      id: "o_beauty_2",
      name: "Glow & Go - Riverside",
      description: "No paybill -> should be filtered out",
      isActive: true,
      merchantId: "m_beauty_1",
      reviewId: "r_outlet_beauty_2",
    },
  });

  // Loyalty merchant outlets
  await createReview("r_outlet_loy_1", "Approved");
  await prisma.outlet.create({
    data: {
      id: "o_loy_1",
      name: "Coffee Club - Village Market",
      description: "Loyalty outlet #1",
      isActive: true,
      merchantId: "m_loyalty_1",
      reviewId: "r_outlet_loy_1",
    },
  });
  await createReview("r_pay_loy_1", "Approved");
  await prisma.paybillOrTill.create({
    data: {
      id: "p_loy_1",
      outletId: "o_loy_1",
      isActive: true,
      deletedAt: null,
      reviewId: "r_pay_loy_1",
    },
  });

  await createReview("r_outlet_loy_2", "Approved");
  await prisma.outlet.create({
    data: {
      id: "o_loy_2",
      name: "Coffee Club - Karen",
      description: "Loyalty outlet #2",
      isActive: true,
      merchantId: "m_loyalty_1",
      reviewId: "r_outlet_loy_2",
    },
  });
  await createReview("r_pay_loy_2", "Approved");
  await prisma.paybillOrTill.create({
    data: {
      id: "p_loy_2",
      outletId: "o_loy_2",
      isActive: true,
      deletedAt: null,
      reviewId: "r_pay_loy_2",
    },
  });

  /**
   * Cashback Configurations
   *
   * NOTE: tiers.percentage is treated as "bps" by the offers resolver filters (minBps/maxBps).
   * Example:
   *   1000 = 10%
   *   2000 = 20%
   */
  await createReview("r_cb_all", "Approved");
  await prisma.cashbackConfiguration.create({
    data: {
      id: "cb_all_10",
      name: "10% cashback for everyone",
      startDate: null,
      endDate: null,
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["All"],
      merchantId: "m_food_1",
      reviewId: "r_cb_all",
      netCashbackBudget: new Prisma.Decimal("1000.0"),
      usedCashbackBudget: new Prisma.Decimal("100.0"),
      Outlets: { connect: [{ id: "o_food_1" }] },
    },
  });

  await createReview("r_cb_all_t1", "Approved");
  await prisma.cashbackConfigurationTier.create({
    data: {
      id: "cb_all_10_tier",
      cashbackConfigurationId: "cb_all_10",
      isActive: true,
      deletedAt: null,
      percentage: 1000,
      reviewId: "r_cb_all_t1",
    },
  });

  await createReview("r_cb_vip", "Approved");
  await prisma.cashbackConfiguration.create({
    data: {
      id: "cb_vip_20",
      name: "20% VIP cashback",
      startDate: days(-1),
      endDate: days(7),
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["Vip"],
      merchantId: "m_tech_1",
      reviewId: "r_cb_vip",
      netCashbackBudget: new Prisma.Decimal("500.0"),
      usedCashbackBudget: new Prisma.Decimal("10.0"),
      Outlets: { connect: [{ id: "o_tech_1" }] },
    },
  });

  await createReview("r_cb_vip_t1", "Approved");
  await prisma.cashbackConfigurationTier.create({
    data: {
      id: "cb_vip_20_tier",
      cashbackConfigurationId: "cb_vip_20",
      isActive: true,
      deletedAt: null,
      percentage: 2000,
      reviewId: "r_cb_vip_t1",
    },
  });

  // Exhausted cashback (should be excluded)
  await createReview("r_cb_exhausted", "Approved");
  await prisma.cashbackConfiguration.create({
    data: {
      id: "cb_exhausted",
      name: "Exhausted cashback budget (should not show)",
      startDate: null,
      endDate: null,
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["All"],
      merchantId: "m_beauty_1",
      reviewId: "r_cb_exhausted",
      netCashbackBudget: new Prisma.Decimal("100.0"),
      usedCashbackBudget: new Prisma.Decimal("100.0"),
      Outlets: { connect: [{ id: "o_beauty_1" }] },
    },
  });

  await createReview("r_cb_exhausted_t1", "Approved");
  await prisma.cashbackConfigurationTier.create({
    data: {
      id: "cb_exhausted_tier",
      cashbackConfigurationId: "cb_exhausted",
      isActive: true,
      deletedAt: null,
      percentage: 1500,
      reviewId: "r_cb_exhausted_t1",
    },
  });

  // Future-dated cashback (should not show yet)
  await createReview("r_cb_future", "Approved");
  await prisma.cashbackConfiguration.create({
    data: {
      id: "cb_future",
      name: "Future cashback (starts later)",
      startDate: days(2),
      endDate: days(10),
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["All"],
      merchantId: "m_food_1",
      reviewId: "r_cb_future",
      netCashbackBudget: new Prisma.Decimal("1000.0"),
      usedCashbackBudget: new Prisma.Decimal("0.0"),
      Outlets: { connect: [{ id: "o_food_1" }] },
    },
  });

  await createReview("r_cb_future_t1", "Approved");
  await prisma.cashbackConfigurationTier.create({
    data: {
      id: "cb_future_tier",
      cashbackConfigurationId: "cb_future",
      isActive: true,
      deletedAt: null,
      percentage: 1200,
      reviewId: "r_cb_future_t1",
    },
  });

  /**
   * Exclusive Offers
   */
  await createReview("r_ex_all", "Approved");
  await prisma.exclusiveOffer.create({
    data: {
      id: "ex_all_food",
      name: "Free dessert with meal",
      description: "Available to everyone",
      startDate: days(-1),
      endDate: days(5),
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["All"],
      merchantId: "m_food_1",
      reviewId: "r_ex_all",
      netOfferBudget: new Prisma.Decimal("200.0"),
      usedOfferBudget: new Prisma.Decimal("10.0"),
      Outlets: { connect: [{ id: "o_food_1" }] },
    },
  });

  await createReview("r_ex_non", "Approved");
  await prisma.exclusiveOffer.create({
    data: {
      id: "ex_noncustomer_beauty",
      name: "New customer welcome pack",
      description: "Only for NonCustomer at this merchant",
      startDate: days(-1),
      endDate: days(10),
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["NonCustomer"],
      merchantId: "m_beauty_1",
      reviewId: "r_ex_non",
      netOfferBudget: new Prisma.Decimal("500.0"),
      usedOfferBudget: new Prisma.Decimal("0.0"),
      Outlets: { connect: [{ id: "o_beauty_1" }, { id: "o_beauty_2" }] }, // o_beauty_2 should be filtered due to missing paybill
    },
  });

  // Inactive / pending exclusive (should be excluded)
  await createReview("r_ex_pending", "Pending");
  await prisma.exclusiveOffer.create({
    data: {
      id: "ex_pending",
      name: "Pending review exclusive",
      description: "Should not show (pending review)",
      startDate: days(-1),
      endDate: days(10),
      isActive: true,
      deletedAt: null,
      eligibleCustomerTypes: ["All"],
      merchantId: "m_food_1",
      reviewId: "r_ex_pending",
      netOfferBudget: new Prisma.Decimal("100.0"),
      usedOfferBudget: new Prisma.Decimal("0.0"),
      Outlets: { connect: [{ id: "o_food_1" }] },
    },
  });

  /**
   * Loyalty Program (Merchant m_loyalty_1)
   */
  await createReview("r_lp_1", "Approved");
  await prisma.loyaltyProgram.create({
    data: {
      id: "lp_coffee",
      name: "Coffee Points",
      isActive: true,
      merchantId: "m_loyalty_1",
      reviewId: "r_lp_1",
      pointsIssuedLimit: new Prisma.Decimal("10000.0"),
      pointsUsedInPeriod: new Prisma.Decimal("100.0"),
    },
  });

  // tiers
  await createReview("r_lt_new", "Approved");
  await prisma.loyaltyTier.create({
    data: {
      id: "lt_new",
      name: "New tier",
      isActive: true,
      deletedAt: null,
      minCustomerType: "New",
      loyaltyProgramId: "lp_coffee",
      reviewId: "r_lt_new",
    },
  });

  await createReview("r_lt_regular", "Approved");
  await prisma.loyaltyTier.create({
    data: {
      id: "lt_regular",
      name: "Regular tier",
      isActive: true,
      deletedAt: null,
      minCustomerType: "Regular",
      loyaltyProgramId: "lp_coffee",
      reviewId: "r_lt_regular",
    },
  });

  await createReview("r_lt_vip", "Approved");
  await prisma.loyaltyTier.create({
    data: {
      id: "lt_vip",
      name: "VIP tier",
      isActive: true,
      deletedAt: null,
      minCustomerType: "Vip",
      loyaltyProgramId: "lp_coffee",
      reviewId: "r_lt_vip",
    },
  });

  // reward required
  await createReview("r_lr_1", "Approved");
  await prisma.merchantLoyaltyReward.create({
    data: {
      id: "lr_1",
      loyaltyProgramId: "lp_coffee",
      isActive: true,
      reviewId: "r_lr_1",
    },
  });

  /**
   * CustomerType rows
   */
  // VIP user is VIP at tech merchant (gets VIP cashback)
  await prisma.customerType.create({
    data: {
      id: "ct_vip_tech",
      userId: USERS.vip,
      merchantId: "m_tech_1",
      type: "Vip",
    },
  });

  // VIP user is "New" at beauty merchant (so they are NOT a NonCustomer there)
  await prisma.customerType.create({
    data: {
      id: "ct_vip_beauty",
      userId: USERS.vip,
      merchantId: "m_beauty_1",
      type: "New",
    },
  });

  // Regular user is Regular at loyalty merchant (gets tiers up to Regular)
  await prisma.customerType.create({
    data: {
      id: "ct_regular_loyalty",
      userId: USERS.regular,
      merchantId: "m_loyalty_1",
      type: "Regular",
    },
  });

  // Regular user is Regular at food merchant (still sees "All" anyway, but good for coverage)
  await prisma.customerType.create({
    data: {
      id: "ct_regular_food",
      userId: USERS.regular,
      merchantId: "m_food_1",
      type: "Regular",
    },
  });

  /**
   * Build UserMerchantProfile (effective rank) for each user with CustomerTypes
   * (demo-user + user-noncustomer have none -> profiles stay empty)
   */
  await rebuildUserMerchantProfilesForUser(prisma, USERS.vip);
  await rebuildUserMerchantProfilesForUser(prisma, USERS.regular);

  /**
   * Build OfferIndex rows from the domain objects
   */
  await rebuildCashbackIndex(prisma, "cb_all_10");
  await rebuildCashbackIndex(prisma, "cb_vip_20");
  await rebuildCashbackIndex(prisma, "cb_exhausted");
  await rebuildCashbackIndex(prisma, "cb_future");

  await rebuildExclusiveIndex(prisma, "ex_all_food");
  await rebuildExclusiveIndex(prisma, "ex_noncustomer_beauty");
  await rebuildExclusiveIndex(prisma, "ex_pending");

  await rebuildLoyaltyIndexByMerchant(prisma, "m_loyalty_1");

  log("Core dataset seeded + indexes rebuilt.");

  return { USERS };
}

async function seedBigPerformanceBatch() {
  // Adds extra rows to show the hot-path is stable under more data.
  // We keep these offers "All" and approved/active so they appear in queries.
  log("Seeding BIG performance batch...");

  const extraMerchants = 120; 
  for (let i = 1; i <= extraMerchants; i++) {
    const mid = `m_perf_${i}`;
    const oid = `o_perf_${i}`;
    const ridOutlet = `r_perf_outlet_${i}`;
    const pid = `p_perf_${i}`;

    await prisma.merchant.create({
      data: {
        id: mid,
        businessName: `Perf Merchant ${i}`,
        status: "Active",
        category: i % 2 === 0 ? "Food" : "Tech",
      },
    });

    await createReview(ridOutlet, "Approved");
    await prisma.outlet.create({
      data: {
        id: oid,
        name: `Perf Outlet ${i}`,
        description: "Bulk seeded outlet",
        isActive: true,
        merchantId: mid,
        reviewId: ridOutlet,
      },
    });

    await createReview(`r_perf_pay_${i}`, "Approved");
    await prisma.paybillOrTill.create({
      data: {
        id: pid,
        outletId: oid,
        isActive: true,
        deletedAt: null,
        reviewId: `r_perf_pay_${i}`,
      },
    });

    // Fast path: create OfferIndex directly (no need to create real offers for perf test)
    await prisma.offerIndex.create({
      data: {
        kind: "CASHBACK",
        merchantId: mid,
        isActiveSnapshot: true,
        isApprovedSnapshot: true,
        deletedAtSnapshot: null,
        budgetExhausted: false,
        startDate: null,
        endDate: null,
        maxCashbackPercentBps: 1000,
        outlets: {
          create: [{ outletId: oid }],
        },
        eligibleCustomerTypes: {
          create: [{ customerType: "All" }],
        },
      },
    });
  }

  log(`BIG batch done: ${extraMerchants} merchants/outlets/index rows added.`);
}

async function main() {
  await prisma.$connect();

  if (!NO_RESET) {
    await resetDb();
  }

  const { USERS } = await seedCore();

  if (BIG) {
    await seedBigPerformanceBatch();
  }

  log("");
  log("✅ Seed complete.");
  log("");
  log("Test users:");
  log(`- demo-user (no customer types)          => ${USERS.demo}`);
  log(`- vip user (Vip at Gadget Hub)           => ${USERS.vip}`);
  log(`- regular user (Regular at Coffee Club)  => ${USERS.regular}`);
  log(`- noncustomer user (no customer types)   => ${USERS.none}`);
  log("");
  log("Next: start API and query with header x-user-id.");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
