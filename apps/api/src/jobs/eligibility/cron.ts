import { offerIndexQueue } from "./queue.js";

/**
 * Backstop cron (optional):
 * - in production, this would run in a separate worker process
 * - it ensures offers that flip at time boundaries (start/end date) are eventually consistent
 *
 * For the take-home skeleton, we only show the wiring.
 */
export function startBackstopCron(): void {
  const queue = offerIndexQueue;
  if (!queue) return;

  // Every 10 minutes, enqueue a lightweight full rebuild for safety.
  // You can tighten this or replace it with more targeted "next boundary" scheduling.
  setInterval(async () => {
    await queue.add("full-rebuild", { type: "FULL_REBUILD", reason: "cron-backstop" });
  }, 10 * 60 * 1000);
}
