import { startEmailWorker } from "./workers/emailWorker";
import { setupRepeatableReconciliation, startReconciliationWorker } from "./queues/reconciliationQueue";
import { reconcileStuckEmails, reconcileScheduledEmailsWithoutJobs } from "./services/emailService";
import { ensureEmailIndex } from "./integrations/elasticsearch/client";
import { logger } from "./utils/logger";
import { prisma } from "./db/prisma";

async function main() {
  await ensureEmailIndex().catch((err) => {
    logger.warn({ err }, "Elasticsearch index init warning (Postgres fallback will be active)");
  });

  // Startup crash recovery (Requirement 12: Restart Recovery)
  logger.info("Executing startup recovery sweep for stuck/orphaned emails...");
  const stuckCount = await reconcileStuckEmails().catch((err) => {
    logger.warn({ err }, "Startup stuck email check error");
    return 0;
  });
  const readdedCount = await reconcileScheduledEmailsWithoutJobs().catch((err) => {
    logger.warn({ err }, "Startup scheduled email check error");
    return 0;
  });
  logger.info(
    { stuckCount, readdedCount },
    "Startup recovery complete (reconciled stuck PROCESSING and orphaned SCHEDULED emails)"
  );

  // Setup BullMQ repeatable job for continuous durable recovery without cron/setInterval
  await setupRepeatableReconciliation().catch((err) => {
    logger.warn({ err }, "Failed to schedule repeatable reconciliation");
  });

  const emailWorker = startEmailWorker();
  const reconWorker = startReconciliationWorker();

  logger.info(
    "Worker started: email sending worker + BullMQ durable crash recovery worker active (no cron used)"
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down workers (waiting for active jobs to finish)");
    await emailWorker.close();
    await reconWorker.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal error starting worker");
  process.exit(1);
});
