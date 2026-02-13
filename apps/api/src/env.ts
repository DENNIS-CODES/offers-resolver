import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  PORT: z.coerce.number().default(4000),
});

export const env = EnvSchema.parse(process.env);
