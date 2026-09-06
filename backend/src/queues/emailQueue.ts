import { Queue } from "bullmq";
import { createRedisConnection } from "./connection";
import { EmailJobData } from "../types";

export const EMAIL_QUEUE_NAME = "email-send";

// One Queue instance per process is enough; BullMQ manages the underlying
// Redis keys (bull:email-send:*) which persist across restarts because Redis
// itself is configured with an AOF-backed volume (see docker-compose.yml).
export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // keep 7 days of history for the dashboard
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
});

/**
 * Schedule (or reschedule) a single email as a BullMQ delayed job.
 *
 * We always use `emailId` as the BullMQ jobId. This is the core of our
 * idempotency strategy at the queue layer: BullMQ guarantees that adding a
 * job with a jobId that already exists in the queue is a no-op, so retrying
 * this call (e.g. from a flaky request handler) can never create two jobs
 * for the same email row.
 *
 * When *rescheduling* an already-existing email (e.g. after an hourly quota
 * was exhausted) we must first remove the old job, because its delay has
 * already been computed against the old scheduledAt.
 */
export async function scheduleEmailJob(emailId: string, runAt: Date): Promise<string> {
  const delay = Math.max(0, runAt.getTime() - Date.now());

  const existing = await emailQueue.getJob(emailId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active") {
      // If currently active, worker is executing it; do not disrupt
      return existing.id as string;
    }
    // Remove completed, failed, delayed, or waiting job so the new delayed job can be added cleanly
    await existing.remove().catch(() => undefined);
  }

  const job = await emailQueue.add(
    EMAIL_QUEUE_NAME,
    { emailId },
    {
      jobId: emailId,
      delay,
    }
  );

  return job.id as string;
}

export async function removeEmailJob(emailId: string): Promise<void> {
  const job = await emailQueue.getJob(emailId);
  if (job) {
    const state = await job.getState();
    if (state !== "active" && state !== "completed") {
      await job.remove();
    }
  }
}
