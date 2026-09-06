import { Worker, Job, DelayedError } from "bullmq";
import { EmailStatus } from "@prisma/client";
import { createRedisConnection } from "../queues/connection";
import { EMAIL_QUEUE_NAME } from "../queues/emailQueue";
import { config } from "../config";
import { logger } from "../utils/logger";
import { prisma } from "../db/prisma";
import { EmailJobData } from "../types";
import { tryTransition, markSent, markFailed } from "../services/emailService";
import { tryConsumeHourlySlot, reserveSendSlot, waitForSlot, releaseHourlySlot } from "../services/rateLimiter";
import { sendEmail } from "../integrations/ethereal/mailer";
import { notifyRateLimitReached } from "../integrations/slack/slackClient";

/**
 * Processes exactly one recipient's email per job.
 *
 * Every step below is a *guarded* operation: we never assume that because a
 * BullMQ job fired, the email is actually eligible to be sent right now.
 * The DB row's current status is always re-checked and transitions are
 * performed with a conditional UPDATE (see emailService.tryTransition),
 * which is what makes this safe if:
 *  - the same job is delivered twice by BullMQ (at-least-once delivery),
 *  - the process crashes mid-send and BullMQ retries the job,
 *  - multiple worker processes run concurrently.
 */
export async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailId } = job.data;

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    logger.warn({ emailId }, "Email row no longer exists -- dropping job");
    return;
  }

  const isRetry = job.attemptsMade > 0;

  if (!isRetry) {
    // Attempt 0: Only a SCHEDULED email may start initial processing.
    const claimed = await tryTransition(emailId, [EmailStatus.SCHEDULED], {
      status: EmailStatus.PROCESSING,
    });

    if (!claimed) {
      logger.info({ emailId, status: email.status }, "Skipping job: email not in SCHEDULED state");
      return;
    }
  } else {
    // Redelivery / retry (C3 fix):
    // Check that email is still eligible for sending (not cancelled or already sent/failed)
    if (email.status === EmailStatus.CANCELLED) {
      logger.info({ emailId }, "Skipping retried job: email was cancelled");
      return;
    }
    if (email.status === EmailStatus.SENT) {
      logger.info({ emailId }, "Skipping retried job: email was already sent");
      return;
    }
    if (email.status === EmailStatus.FAILED) {
      logger.info({ emailId }, "Skipping retried job: email was marked permanently failed");
      return;
    }
  }

  let slotConsumed = false;

  try {
    // 1) Hourly quota check (atomic, Redis-backed, per sender).
    // Reads per-batch limit override if set on the email, else sender limit (H1 fix)
    const hourlyLimit = email.hourlyLimit ?? email.sender.hourlyLimit ?? undefined;
    const quota = await tryConsumeHourlySlot(email.senderId, hourlyLimit);

    if (!quota.allowed) {
      // Revert status to SCHEDULED for the next window
      await tryTransition(emailId, [EmailStatus.PROCESSING], {
        status: EmailStatus.SCHEDULED,
        scheduledAt: quota.nextWindowStart,
      });

      await notifyRateLimitReached(email.userId, email.sender.name, quota.nextWindowStart, email.senderId);
      logger.info(
        { emailId, nextWindowStart: quota.nextWindowStart },
        "Delaying job to next hour window via moveToDelayed (C2 fix)"
      );

      // C2 fix: Use BullMQ's native moveToDelayed + DelayedError
      await job.moveToDelayed(quota.nextWindowStart.getTime(), token ?? "worker-token");
      throw new DelayedError();
    }

    slotConsumed = true;

    // 2) Global minimum delay between sends for this sender (atomic slot
    //    reservation via Lua script -- safe under WORKER_CONCURRENCY > 1 and
    //    multiple worker processes).
    // Reads per-batch minDelayMs override if set on the email, else sender delay (H1 fix)
    const minDelay = email.minDelayMs ?? email.sender.minDelayMs ?? undefined;
    const slot = await reserveSendSlot(email.senderId, minDelay);
    await waitForSlot(slot, async (remainingMs) => {
      await job.updateProgress(remainingMs).catch(() => undefined);
    });

    // 3) Actual SMTP send via Ethereal -- never mocked.
    const result = await sendEmail({
      fromName: email.sender.name,
      fromEmail: email.sender.email,
      to: email.recipient,
      subject: email.subject,
      html: email.body,
      sender: {
        id: email.sender.id,
        smtpHost: email.sender.smtpHost,
        smtpPort: email.sender.smtpPort,
        smtpUser: email.sender.smtpUser,
        smtpPassword: email.sender.smtpPassword,
      },
    });

    // 4) Guarded final transition to SENT.
    await markSent(emailId, result.messageId, result.previewUrl);
    await prisma.email.update({ where: { id: emailId }, data: { attempts: { increment: 1 } } });

    logger.info({ emailId, to: email.recipient, previewUrl: result.previewUrl }, "Email sent successfully");
  } catch (err) {
    if (err instanceof DelayedError) {
      throw err;
    }

    if (slotConsumed) {
      // H6 fix: Release consumed hourly slot so SMTP network failures don't burn quota
      await releaseHourlySlot(email.senderId).catch(() => undefined);
    }

    const message = err instanceof Error ? err.message : "Unknown send error";
    const maxAttempts = job.opts.attempts ?? 5;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    await prisma.email.update({
      where: { id: emailId },
      data: { attempts: { increment: 1 }, errorMessage: message },
    }).catch(() => undefined);

    if (isFinalAttempt) {
      // C3 fix: Only transition to FAILED when all BullMQ attempts are exhausted
      await markFailed(emailId, message);
      logger.error({ err, emailId, attemptsMade: job.attemptsMade + 1 }, "Email send permanently failed after exhausting retry attempts");
    } else {
      // Non-terminal failure: leave row in PROCESSING so BullMQ retry can re-attempt
      logger.warn(
        { err, emailId, attemptsMade: job.attemptsMade + 1, maxAttempts },
        "Email send failed, BullMQ will retry with exponential backoff"
      );
    }

    throw err; // let BullMQ apply its retry/backoff policy
  }
}

export function startEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: createRedisConnection(),
    // Configurable via WORKER_CONCURRENCY -- multiple jobs run concurrently
    // within this one process, and you can also run multiple worker
    // processes; both are safe because all shared state (quota counters,
    // min-delay slots, DB status transitions) is coordinated through Redis
    // and Postgres, never in-process memory.
    concurrency: config.workerConcurrency,
    lockDuration: 60000, // 60 seconds
    maxStalledCount: 2,
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Job failed");
  });

  worker.on("completed", (job) => {
    logger.debug({ jobId: job?.id }, "Job completed");
  });

  return worker;
}
