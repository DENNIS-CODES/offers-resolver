import type { PrismaClient } from "@fusion/db";
import { prisma } from "@fusion/db";
import IORedis from "ioredis";
import DataLoader from "dataloader";
import { env } from "../env.js";
import { buildOfferLoaders, type OfferLoaders } from "../loaders/offerLoaders.js";

/**
 * In a real system, `auth` comes from your session/JWT middleware.
 * Here we accept a header `x-user-id` for demo purposes.
 */
export type AuthContext = { userId: string };

export type GraphQLContext = {
  prisma: PrismaClient;
  auth: AuthContext;
  redis?: IORedis;
  loaders: OfferLoaders;
};

export function createContext(req: Request): GraphQLContext {
  const userId = req.headers.get("x-user-id") ?? "demo-user";
  const redis = env.REDIS_URL ? new IORedis(env.REDIS_URL) : undefined;

  return {
    prisma,
    auth: { userId },
    redis,
    loaders: buildOfferLoaders(prisma, userId),
  };
}
