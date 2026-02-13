import { PrismaClient } from "@prisma/client";

/**
 * Shared PrismaClient instance.
 * In real services, you may want request-scoped transactions or pool tuning.
 */
export const prisma = new PrismaClient();
export type { PrismaClient } from "@prisma/client";
