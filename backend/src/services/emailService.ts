import { randomUUID } from "crypto";
import { Email, EmailStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";
import { scheduleEmailJob, removeEmailJob, emailQueue, EMAIL_QUEUE_NAME } from "../queues/emailQueue";
import { ScheduleEmailRequest } from "../types";
import { indexEmail, deleteEmailFromIndex } from "../integrations/elasticsearch/emailIndex";
import { HttpError } from "../middleware/errorHandler";

/**
 * Creates one Email row + one BullMQ delayed job PER RECIPIENT. This is the
 * "one job per recipient, not one job per campaign" requirement: a CSV of
 * 1000 rows becomes 1000 independent DB rows and 1000 independent delayed
 * jobs, each individually resumable, cancellable and retryable.
 *
 * Optimized for 1000+ recipients (H3 fix): uses bulk insert (createMany)
 * and BullMQ bulk job addition (addBulk) instead of 3000+ sequential round trips.
 *
 * Also persists per-batch delayBetweenEmailsMs and hourlyLimit overrides (H1 fix).
 */
export async function scheduleBatch(userId: string, req: ScheduleEmailRequest) {
  const batchId = randomUUID();
  const startTime = new Date(req.startTime);
  if (Number.isNaN(startTime.getTime())) {
    throw new HttpError(400, "Invalid startTime; must be a valid ISO date/time string");
  }

  const sender = await prisma.emailSender.findFirst({
    where: { id: req.senderId, userId },
  });
  if (!sender) {
    throw new HttpError(404, "Sender not found or does not belong to this user");
  }

  const uniqueRecipients = Array.from(new Set(req.recipients.map((r) => r.toLowerCase())));
  const now = new Date();

  const emailsToCreate = uniqueRecipients.map((recipient, index) => {
    const emailId = randomUUID();
    const scheduledAt = req.delayBetweenEmailsMs
      ? new Date(startTime.getTime() + index * req.delayBetweenEmailsMs)
      : startTime;

    return {
      id: emailId,
      userId,
      senderId: sender.id,
      batchId,
      recipient,
      subject: req.subject,
      body: req.body,
      status: EmailStatus.SCHEDULED,
      scheduledAt,
      bullJobId: emailId,
      minDelayMs: req.delayBetweenEmailsMs ?? null,
      hourlyLimit: req.hourlyLimit ?? null,
      createdAt: now,
      updatedAt: now,
    };
  });

  // Persist Batch entity
  await prisma.batch.create({
    data: {
      id: batchId,
      userId,
      senderId: sender.id,
      delayBetweenEmailsMs: req.delayBetweenEmailsMs ?? null,
      hourlyLimit: req.hourlyLimit ?? null,
      startTime,
      createdAt: now,
      updatedAt: now,
    },
  });

  // Bulk insert all emails in a single Postgres operation (H3 fix)
  await prisma.email.createMany({
    data: emailsToCreate,
  });

  // Bulk add delayed jobs to BullMQ in a single Redis pipeline (H3 fix)
  const jobsToAdd = emailsToCreate.map((e) => ({
    name: EMAIL_QUEUE_NAME,
    data: { emailId: e.id },
    opts: {
      jobId: e.id,
      delay: Math.max(0, e.scheduledAt.getTime() - Date.now()),
    },
  }));
  await emailQueue.addBulk(jobsToAdd);

  // Background non-blocking Elasticsearch indexing
  void Promise.all(
    emailsToCreate.map((e) =>
      indexEmail(e as unknown as Email).catch((err) =>
        logger.warn({ err, emailId: e.id }, "Elasticsearch indexing failed (non-fatal)")
      )
    )
  );

  logger.info(
    { batchId, senderId: sender.id, count: emailsToCreate.length },
    "Scheduled email batch"
  );

  return { batchId, emails: emailsToCreate as unknown as Email[] };
}

/**
 * Guarded state transition: only succeeds if the row is CURRENTLY in one of
 * `fromStatuses`. Implemented as a single conditional UPDATE
 * (`updateMany` with a `status: { in: [...] }` predicate), which Postgres
 * executes atomically -- this is what actually prevents two concurrent
 * workers (or a retried job) from both thinking they "won" the right to send
 * the same email. `count === 1` means this call won the transition;
 * `count === 0` means someone else already moved the row on.
 */
export async function tryTransition(
  emailId: string,
  fromStatuses: EmailStatus[],
  data: Prisma.EmailUpdateManyMutationInput
): Promise<boolean> {
  const result = await prisma.email.updateMany({
    where: { id: emailId, status: { in: fromStatuses } },
    data,
  });
  return result.count === 1;
}

export async function getEmailOrThrow(emailId: string): Promise<Email> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) throw new Error(`Email ${emailId} not found`);
  return email;
}

export async function markSent(
  emailId: string,
  providerMessageId: string | undefined,
  previewUrl: string | undefined
): Promise<boolean> {
  const ok = await tryTransition(emailId, [EmailStatus.PROCESSING], {
    status: EmailStatus.SENT,
    sentAt: new Date(),
    providerMessageId,
    previewUrl,
    errorMessage: null,
  });
  if (ok) {
    const email = await getEmailOrThrow(emailId);
    void indexEmail(email).catch((err) => logger.warn({ err, emailId }, "ES index failed"));
  }
  return ok;
}

export async function markFailed(emailId: string, errorMessage: string): Promise<boolean> {
  const ok = await tryTransition(emailId, [EmailStatus.PROCESSING], {
    status: EmailStatus.FAILED,
    failedAt: new Date(),
    errorMessage,
  });
  if (ok) {
    const email = await getEmailOrThrow(emailId);
    void indexEmail(email).catch((err) => logger.warn({ err, emailId }, "ES index failed"));
  }
  return ok;
}

export async function markCancelled(emailId: string, userId?: string): Promise<boolean> {
  if (userId) {
    const email = await prisma.email.findUnique({ where: { id: emailId } });
    if (!email) {
      throw new HttpError(404, "Email not found");
    }
    if (email.userId !== userId) {
      throw new HttpError(403, "Forbidden: You cannot cancel an email belonging to another user");
    }
  }

  const ok = await tryTransition(emailId, [EmailStatus.SCHEDULED, EmailStatus.PROCESSING], {
    status: EmailStatus.CANCELLED,
  });
  if (ok) {
    await removeEmailJob(emailId);
    await deleteEmailFromIndex(emailId).catch(() => undefined);
  }
  return ok;
}

/**
 * Reschedules an email that could not be sent because its sender's hourly
 * quota was exhausted. The email keeps its identity (same row, same id) --
 * only `scheduledAt`, `status` and `bullJobId` change -- and a fresh BullMQ
 * delayed job is created for the new time. This directly implements
 * requirement 8 (rate limit behavior: reschedule, never drop).
 */
export async function rescheduleForQuota(emailId: string, nextWindowStart: Date): Promise<void> {
  const ok = await tryTransition(emailId, [EmailStatus.PROCESSING], {
    status: EmailStatus.SCHEDULED,
    scheduledAt: nextWindowStart,
  });
  if (!ok) {
    // Someone else already moved this email on (e.g. cancelled). Nothing to do.
    return;
  }
  const jobId = await scheduleEmailJob(emailId, nextWindowStart);
  await prisma.email.update({ where: { id: emailId }, data: { bullJobId: jobId } });
  logger.info({ emailId, nextWindowStart }, "Rescheduled email after hourly quota exhaustion");
}

export async function listScheduled(userId: string, page: number, pageSize: number) {
  const where = { userId, status: { in: [EmailStatus.SCHEDULED, EmailStatus.PROCESSING] } };
  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.email.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function listSent(userId: string, page: number, pageSize: number) {
  const where = { userId, status: { in: [EmailStatus.SENT, EmailStatus.FAILED] } };
  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { failedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.email.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

/**
 * Robust database search fallback (M1 fix).
 * Searches across ALL statuses (SCHEDULED, PROCESSING, SENT, FAILED, CANCELLED)
 * with case-insensitive matching on recipient, subject, and body.
 */
export async function searchEmailsInPostgres(params: {
  userId: string;
  query?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const { userId, query, status, page, pageSize } = params;
  const where: Prisma.EmailWhereInput = {
    userId,
    ...(status && Object.values(EmailStatus).includes(status as EmailStatus)
      ? { status: status as EmailStatus }
      : {}),
    ...(query && query.trim()
      ? {
          OR: [
            { recipient: { contains: query, mode: "insensitive" } },
            { subject: { contains: query, mode: "insensitive" } },
            { body: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.email.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

/**
 * Supervisory pass for stuck / orphaned emails (C4 fix).
 * Finds emails in PROCESSING status that have had no updates for longer than
 * the lock duration window and ensures they are safely requeued.
 */
export async function reconcileStuckEmails(stuckOlderThanMs = 120_000): Promise<number> {
  const cutoff = new Date(Date.now() - stuckOlderThanMs);
  const stuckEmails = await prisma.email.findMany({
    where: {
      status: EmailStatus.PROCESSING,
      updatedAt: { lt: cutoff },
    },
    take: 50,
  });

  let recovered = 0;
  for (const email of stuckEmails) {
    const job = await emailQueue.getJob(email.id);
    let isRunning = false;
    if (job) {
      const state = await job.getState();
      if (state === "active" || state === "delayed" || state === "waiting") {
        isRunning = true;
      }
    }

    if (!isRunning) {
      const ok = await tryTransition(email.id, [EmailStatus.PROCESSING], {
        status: EmailStatus.SCHEDULED,
        scheduledAt: new Date(),
      });
      if (ok) {
        await scheduleEmailJob(email.id, new Date());
        recovered++;
        logger.warn({ emailId: email.id }, "Reconciled orphaned PROCESSING email back to SCHEDULED");
      }
    }
  }
  return recovered;
}

/**
 * Reconciles SCHEDULED emails in PostgreSQL that lack an active/delayed BullMQ job.
 * Handles system/worker crash recovery where jobs were lost from Redis or uncommitted.
 */
export async function reconcileScheduledEmailsWithoutJobs(): Promise<number> {
  const scheduledEmails = await prisma.email.findMany({
    where: {
      status: EmailStatus.SCHEDULED,
    },
    take: 100,
  });

  let readded = 0;
  for (const email of scheduledEmails) {
    const job = await emailQueue.getJob(email.id);
    let hasJob = false;
    if (job) {
      const state = await job.getState();
      if (state === "active" || state === "delayed" || state === "waiting") {
        hasJob = true;
      }
    }

    if (!hasJob) {
      await scheduleEmailJob(email.id, email.scheduledAt);
      readded++;
      logger.info({ emailId: email.id }, "Re-added missing BullMQ job for SCHEDULED email");
    }
  }
  return readded;
}

