// apps/api/src/jobs/eligibility/queue.ts
import { Queue, Worker, type Job, type WorkerOptions, type QueueOptions } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";
import type { PrismaClient } from "@fusion/db";
import { prisma } from "@fusion/db";
import { env } from "../../env.js";
import {
  rebuildCashbackIndex,
  rebuildExclusiveIndex,
  rebuildLoyaltyIndexByMerchant,
  rebuildUserMerchantProfilesForUser,
} from "./recompute.js";

/**
 * Offer indexing jobs.
 * These jobs are OPTIONAL for the take-home but recommended for production:
 * - They move expensive eligibility computations to write-time (or scheduled time),
 *   so the hot "offers" resolver becomes a fast indexed read.
 */
export type OfferIndexJob =
  | { type: "CASHBACK_CHANGED"; cashbackConfigurationId: string }
  | { type: "EXCLUSIVE_CHANGED"; exclusiveOfferId: string }
  | { type: "LOYALTY_CHANGED"; merchantId: string }
  | { type: "USER_CUSTOMER_TYPES_CHANGED"; userId: string }
  | { type: "FULL_REBUILD"; reason: string };

/**
 * BullMQ requires special ioredis options for blocking commands.
 * Without these, Worker will crash with:
 * "BullMQ: Your redis options maxRetriesPerRequest must be null."
 */
function buildRedisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,

    // Optional niceties:
    // keepAlive: 30000,
    // connectTimeout: 10000,
    // lazyConnect: true,
  };
}

/**
 * Create a shared Redis connection instance.
 * - Only created when REDIS_URL is configured.
 * - Exported for reuse in other queues (if needed).
 */
export const redisConnection = env.REDIS_URL
  ? new IORedis(env.REDIS_URL, buildRedisOptions())
  : null;

/**
 * Queue instance (or null if Redis is not configured).
 */
export const offerIndexQueue: Queue<OfferIndexJob> | null = redisConnection
  ? new Queue<OfferIndexJob>("offer-index", {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 500,
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
      },
    } satisfies QueueOptions)
  : null;

/**
 * Helper to enqueue jobs safely. No-op when Redis isn't configured.
 * Use this in write-path mutations (e.g., when an offer changes).
 */
export async function enqueueOfferIndexJob(job: OfferIndexJob): Promise<void> {
  if (!offerIndexQueue) return;
  const jobId = jobIdFor(job);
  await offerIndexQueue.add(job.type, job, { jobId });
}

/**
 * Deterministic jobId builder to reduce duplicate work in bursty systems.
 */
function jobIdFor(job: OfferIndexJob): string {
  switch (job.type) {
    case "CASHBACK_CHANGED":
      return `cashback:${job.cashbackConfigurationId}`;
    case "EXCLUSIVE_CHANGED":
      return `exclusive:${job.exclusiveOfferId}`;
    case "LOYALTY_CHANGED":
      return `loyalty:${job.merchantId}`;
    case "USER_CUSTOMER_TYPES_CHANGED":
      return `userct:${job.userId}`;
    case "FULL_REBUILD":
      return `full:${hashish(job.reason)}`;
  }
}

/**
 * Small stable string hash for jobIds (non-crypto).
 */
function hashish(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/**
 * Start the worker only when Redis is configured.
 * Returns null when disabled.
 *
 * IMPORTANT:
 * - If Redis is configured but DOWN, Worker construction may throw.
 *   We catch and log to keep API usable in dev.
 */
export function startOfferIndexWorker(
  prismaClient: PrismaClient = prisma,
): Worker<OfferIndexJob> | null {
  if (!redisConnection || !offerIndexQueue) {
    // Local dev can run without Redis.
    return null;
  }

  const workerOpts: WorkerOptions = {
    connection: redisConnection,
    concurrency: 10,
  };

  try {
    const worker = new Worker<OfferIndexJob>(
      "offer-index",
      async (job: Job<OfferIndexJob>) => {
        await handleOfferIndexJob(prismaClient, job);
      },
      workerOpts,
    );

    worker.on("failed", async (job, err) => {
      if (!job) return;

      // Best-effort logging: never crash the worker on logging failure
      try {
        await prismaClient.offerIndexRebuildLog.create({
          data: {
            jobType: "BULLMQ",
            entityType: job.data.type,
            entityId: entityIdFor(job.data),
            status: "FAILED",
            attempts: job.attemptsMade,
            errorMessage: err?.message ?? String(err),
          },
        });
      } catch (logErr) {
        // eslint-disable-next-line no-console
        console.error("[offer-index] failed to write OfferIndexRebuildLog", logErr);
      }

      // eslint-disable-next-line no-console
      console.error("[offer-index] job failed", {
        type: job.data.type,
        entityId: entityIdFor(job.data),
        error: err?.message ?? String(err),
      });
    });

    worker.on("completed", (job) => {
      // eslint-disable-next-line no-console
      console.log("[offer-index] job completed", {
        type: job.data.type,
        entityId: entityIdFor(job.data),
      });
    });

    return worker;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[offer-index] Worker not started (Redis down or misconfigured). API will still run.",
      err,
    );
    return null;
  }
}

/**
 * Actual job handler. Kept separate for easier unit testing.
 */
async function handleOfferIndexJob(prismaClient: PrismaClient, job: Job<OfferIndexJob>) {
  switch (job.data.type) {
    case "CASHBACK_CHANGED":
      await rebuildCashbackIndex(prismaClient, job.data.cashbackConfigurationId);
      return;

    case "EXCLUSIVE_CHANGED":
      await rebuildExclusiveIndex(prismaClient, job.data.exclusiveOfferId);
      return;

    case "LOYALTY_CHANGED":
      await rebuildLoyaltyIndexByMerchant(prismaClient, job.data.merchantId);
      return;

    case "USER_CUSTOMER_TYPES_CHANGED":
      await rebuildUserMerchantProfilesForUser(prismaClient, job.data.userId);
      return;

    case "FULL_REBUILD": {
      // In production you'd use batching, locks, and observability.
      // For take-home: simple sequential rebuild.
      const merchants = await prismaClient.merchant.findMany({ select: { id: true } });
      for (const m of merchants) {
        await rebuildLoyaltyIndexByMerchant(prismaClient, m.id);
      }
      return;
    }

    default: {
      // Exhaustiveness guard
      const _never: never = job.data;
      throw new Error(`Unhandled job: ${JSON.stringify(_never)}`);
    }
  }
}

/**
 * Extract a stable entityId for logs/observability.
 */
function entityIdFor(job: OfferIndexJob): string {
  switch (job.type) {
    case "CASHBACK_CHANGED":
      return job.cashbackConfigurationId;
    case "EXCLUSIVE_CHANGED":
      return job.exclusiveOfferId;
    case "LOYALTY_CHANGED":
      return job.merchantId;
    case "USER_CUSTOMER_TYPES_CHANGED":
      return job.userId;
    case "FULL_REBUILD":
      return job.reason;
  }
}
