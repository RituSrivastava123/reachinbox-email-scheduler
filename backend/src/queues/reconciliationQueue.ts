import { Queue, Worker } from "bullmq";
import { createRedisConnection } from "./connection";
import { reconcileStuckEmails, reconcileScheduledEmailsWithoutJobs } from "../services/emailService";
import { logger } from "../utils/logger";

export const RECONCILIATION_QUEUE_NAME = "email-reconciliation";

export const reconciliationQueue = new Queue(RECONCILIATION_QUEUE_NAME, {
  connection: createRedisConnection(),
});

/**
 * Registers BullMQ repeatable job for recurring crash recovery.
 * NO cron, NO node-cron, NO setInterval. BullMQ handles repeatable scheduling
 * natively via Redis sorted sets.
 */
export async function setupRepeatableReconciliation(): Promise<void> {
  try {
    const existingRepeatables = await reconciliationQueue.getRepeatableJobs();
    for (const r of existingRepeatables) {
      if (r.name === "reconcile-stuck-emails") {
        await reconciliationQueue.removeRepeatableByKey(r.key);
      }
    }

    await reconciliationQueue.add(
      "reconcile-stuck-emails",
      {},
      {
        repeat: {
          every: 60_000,
        },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
    logger.info("BullMQ repeatable reconciliation job registered (every 60s)");
  } catch (err) {
    logger.warn({ err }, "Could not register BullMQ repeatable reconciliation job");
  }
}

export function startReconciliationWorker(): Worker {
  const worker = new Worker(
    RECONCILIATION_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id }, "Running BullMQ durable crash recovery pass");
      const stuckRecovered = await reconcileStuckEmails();
      const orphanedScheduled = await reconcileScheduledEmailsWithoutJobs();
      logger.info(
        { stuckRecovered, orphanedScheduled },
        "Durable crash recovery pass completed"
      );
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Reconciliation job failed");
  });

  return worker;
}
