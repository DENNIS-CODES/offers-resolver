-- Hand-written migration for the Offer Index tables.
-- In a real codebase, this is typically generated via `prisma migrate dev`.
-- This assumes your existing tables already exist.

-- Enums
DO $$ BEGIN
  CREATE TYPE "OfferKind" AS ENUM ('CASHBACK', 'EXCLUSIVE', 'LOYALTY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ReviewStatusEnum may already exist in your DB; keep as-is if so.

-- UserMerchantProfile
CREATE TABLE IF NOT EXISTS "UserMerchantProfile" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "merchantId" text NOT NULL,
  "customerType" text NOT NULL,
  "rank" integer NOT NULL,
  "computedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserMerchantProfile_userId_merchantId_key"
  ON "UserMerchantProfile" ("userId", "merchantId");

CREATE INDEX IF NOT EXISTS "UserMerchantProfile_userId_merchantId_idx"
  ON "UserMerchantProfile" ("userId", "merchantId");

CREATE INDEX IF NOT EXISTS "UserMerchantProfile_merchantId_rank_idx"
  ON "UserMerchantProfile" ("merchantId", "rank");

-- OfferIndex
CREATE TABLE IF NOT EXISTS "OfferIndex" (
  "id" text PRIMARY KEY,
  "kind" "OfferKind" NOT NULL,
  "merchantId" text NOT NULL,

  "cashbackConfigurationId" text UNIQUE,
  "exclusiveOfferId" text UNIQUE,
  "loyaltyProgramId" text UNIQUE,

  "isActiveSnapshot" boolean NOT NULL,
  "isApprovedSnapshot" boolean NOT NULL,
  "deletedAtSnapshot" timestamptz NULL,
  "budgetExhausted" boolean NOT NULL DEFAULT false,

  "startDate" timestamptz NULL,
  "endDate" timestamptz NULL,

  "maxCashbackPercentBps" integer NULL,

  "computedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "OfferIndex_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE,
  CONSTRAINT "OfferIndex_cashbackConfigurationId_fkey" FOREIGN KEY ("cashbackConfigurationId") REFERENCES "CashbackConfiguration"("id") ON DELETE SET NULL,
  CONSTRAINT "OfferIndex_exclusiveOfferId_fkey" FOREIGN KEY ("exclusiveOfferId") REFERENCES "ExclusiveOffer"("id") ON DELETE SET NULL,
  CONSTRAINT "OfferIndex_loyaltyProgramId_fkey" FOREIGN KEY ("loyaltyProgramId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "OfferIndex_kind_active_approved_budget_idx"
  ON "OfferIndex" ("kind", "isActiveSnapshot", "isApprovedSnapshot", "budgetExhausted");

CREATE INDEX IF NOT EXISTS "OfferIndex_merchant_kind_idx"
  ON "OfferIndex" ("merchantId", "kind");

-- OfferIndexCustomerType
CREATE TABLE IF NOT EXISTS "OfferIndexCustomerType" (
  "id" text PRIMARY KEY,
  "offerIndexId" text NOT NULL,
  "customerType" text NOT NULL,
  CONSTRAINT "OfferIndexCustomerType_offerIndexId_fkey" FOREIGN KEY ("offerIndexId") REFERENCES "OfferIndex"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfferIndexCustomerType_offerIndexId_customerType_key"
  ON "OfferIndexCustomerType" ("offerIndexId", "customerType");

CREATE INDEX IF NOT EXISTS "OfferIndexCustomerType_customerType_offerIndexId_idx"
  ON "OfferIndexCustomerType" ("customerType", "offerIndexId");

-- OfferIndexOutlet
CREATE TABLE IF NOT EXISTS "OfferIndexOutlet" (
  "id" text PRIMARY KEY,
  "offerIndexId" text NOT NULL,
  "outletId" text NOT NULL,
  CONSTRAINT "OfferIndexOutlet_offerIndexId_fkey" FOREIGN KEY ("offerIndexId") REFERENCES "OfferIndex"("id") ON DELETE CASCADE,
  CONSTRAINT "OfferIndexOutlet_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OfferIndexOutlet_offerIndexId_outletId_key"
  ON "OfferIndexOutlet" ("offerIndexId", "outletId");

CREATE INDEX IF NOT EXISTS "OfferIndexOutlet_outletId_offerIndexId_idx"
  ON "OfferIndexOutlet" ("outletId", "offerIndexId");

-- LoyaltyTierIndex
CREATE TABLE IF NOT EXISTS "LoyaltyTierIndex" (
  "id" text PRIMARY KEY,
  "offerIndexId" text NOT NULL,
  "tierRank" integer NOT NULL,
  "isActiveSnapshot" boolean NOT NULL,
  "isApprovedSnapshot" boolean NOT NULL,
  "deletedAtSnapshot" timestamptz NULL,
  CONSTRAINT "LoyaltyTierIndex_offerIndexId_fkey" FOREIGN KEY ("offerIndexId") REFERENCES "OfferIndex"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "LoyaltyTierIndex_offerIndexId_tierRank_idx"
  ON "LoyaltyTierIndex" ("offerIndexId", "tierRank");

CREATE INDEX IF NOT EXISTS "LoyaltyTierIndex_tierRank_idx"
  ON "LoyaltyTierIndex" ("tierRank");

-- OfferIndexRebuildLog
CREATE TABLE IF NOT EXISTS "OfferIndexRebuildLog" (
  "id" text PRIMARY KEY,
  "jobType" text NOT NULL,
  "entityType" text NOT NULL,
  "entityId" text NOT NULL,
  "status" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "errorMessage" text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "OfferIndexRebuildLog_status_createdAt_idx"
  ON "OfferIndexRebuildLog" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "OfferIndexRebuildLog_entity_status_idx"
  ON "OfferIndexRebuildLog" ("entityType", "entityId", "status");
