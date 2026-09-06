/**
 * Unit tests for the state-machine / idempotency logic in emailService.
 * Prisma and the BullMQ queue helpers are mocked so these run without any
 * external services, and specifically exercise the "guarded transition"
 * behavior that prevents duplicate sends.
 */
import { EmailStatus } from "@prisma/client";

jest.mock("../src/db/prisma", () => ({
  prisma: {
    email: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      createMany: jest.fn(),
    },
    batch: {
      create: jest.fn(),
    },
    emailSender: {
      findFirst: jest.fn(),
    },
    idempotencyRecord: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("../src/queues/emailQueue", () => ({
  scheduleEmailJob: jest.fn().mockResolvedValue("mock-job-id"),
  removeEmailJob: jest.fn().mockResolvedValue(undefined),
  emailQueue: {
    getJob: jest.fn().mockResolvedValue(null),
    addBulk: jest.fn().mockResolvedValue([]),
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
  },
  EMAIL_QUEUE_NAME: "email-send",
}));

jest.mock("../src/integrations/elasticsearch/emailIndex", () => ({
  indexEmail: jest.fn().mockResolvedValue(undefined),
  deleteEmailFromIndex: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../src/db/prisma";
import { scheduleEmailJob, removeEmailJob, emailQueue } from "../src/queues/emailQueue";
import {
  tryTransition,
  markSent,
  markCancelled,
  rescheduleForQuota,
  searchEmailsInPostgres,
  reconcileStuckEmails,
  reconcileScheduledEmailsWithoutJobs,
  scheduleBatch,
} from "../src/services/emailService";

const mockedUpdateMany = prisma.email.updateMany as jest.Mock;
const mockedFindUnique = prisma.email.findUnique as jest.Mock;
const mockedUpdate = prisma.email.update as jest.Mock;
const mockedFindMany = prisma.email.findMany as jest.Mock;
const mockedCount = prisma.email.count as jest.Mock;
const mockedCreateMany = prisma.email.createMany as jest.Mock;
const mockedBatchCreate = prisma.batch.create as jest.Mock;
const mockedSenderFindFirst = prisma.emailSender.findFirst as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("tryTransition", () => {
  it("returns true when exactly one row matched the guarded WHERE clause", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    const ok = await tryTransition("email-1", [EmailStatus.SCHEDULED], {
      status: EmailStatus.PROCESSING,
    });
    expect(ok).toBe(true);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "email-1", status: { in: [EmailStatus.SCHEDULED] } },
      data: { status: EmailStatus.PROCESSING },
    });
  });

  it("returns false when the row was already moved out of the expected state -- this is the duplicate-send guard", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    const ok = await tryTransition("email-1", [EmailStatus.SCHEDULED], {
      status: EmailStatus.PROCESSING,
    });
    expect(ok).toBe(false);
  });
});

describe("markSent", () => {
  it("only marks SENT from PROCESSING, and re-indexes on success", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    mockedFindUnique.mockResolvedValue({ id: "email-1", status: EmailStatus.SENT });

    const ok = await markSent("email-1", "msg-123", "https://ethereal.email/preview/xyz");
    expect(ok).toBe(true);
    expect(mockedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "email-1", status: { in: [EmailStatus.PROCESSING] } } })
    );
  });

  it("does nothing if the email was not in PROCESSING (e.g. duplicate job delivery)", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    const ok = await markSent("email-1", "msg-123", undefined);
    expect(ok).toBe(false);
    expect(mockedFindUnique).not.toHaveBeenCalled();
  });
});

describe("rescheduleForQuota", () => {
  it("moves the email back to SCHEDULED at the next window and creates a fresh BullMQ job", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });
    mockedUpdate.mockResolvedValue({});

    const nextWindow = new Date(Date.now() + 3600_000);
    await rescheduleForQuota("email-1", nextWindow);

    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "email-1", status: { in: [EmailStatus.PROCESSING] } },
      data: { status: EmailStatus.SCHEDULED, scheduledAt: nextWindow },
    });
    expect(scheduleEmailJob).toHaveBeenCalledWith("email-1", nextWindow);
  });

  it("is a no-op if the email already moved to a different state (e.g. was cancelled)", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });
    await rescheduleForQuota("email-1", new Date());
    expect(scheduleEmailJob).not.toHaveBeenCalled();
  });
});

describe("searchEmailsInPostgres (M1 fix)", () => {
  it("queries across scheduled, sent, and failed emails matching query and status filters", async () => {
    mockedFindMany.mockResolvedValue([
      { id: "e1", subject: "Welcome newsletter", recipient: "user@test.com", status: EmailStatus.SENT },
    ]);
    mockedCount.mockResolvedValue(1);

    const result = await searchEmailsInPostgres({
      userId: "user-1",
      query: "newsletter",
      status: "SENT",
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(mockedFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: EmailStatus.SENT,
          OR: expect.arrayContaining([
            { recipient: { contains: "newsletter", mode: "insensitive" } },
            { subject: { contains: "newsletter", mode: "insensitive" } },
            { body: { contains: "newsletter", mode: "insensitive" } },
          ]),
        }),
      })
    );
  });
});

describe("reconcileStuckEmails (C4 fix)", () => {
  it("recovers orphaned PROCESSING rows when no BullMQ job is actively running", async () => {
    mockedFindMany.mockResolvedValue([
      { id: "stuck-1", status: EmailStatus.PROCESSING, updatedAt: new Date(Date.now() - 300_000) },
    ]);
    mockedUpdateMany.mockResolvedValue({ count: 1 });

    const recovered = await reconcileStuckEmails(120_000);

    expect(recovered).toBe(1);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "stuck-1", status: { in: [EmailStatus.PROCESSING] } },
      data: expect.objectContaining({ status: EmailStatus.SCHEDULED }),
    });
    expect(scheduleEmailJob).toHaveBeenCalledWith("stuck-1", expect.any(Date));
  });
});

describe("markCancelled (Ownership & Cancellation)", () => {
  it("allows user to cancel their own scheduled email", async () => {
    mockedFindUnique.mockResolvedValue({ id: "email-1", userId: "user-123" });
    mockedUpdateMany.mockResolvedValue({ count: 1 });

    const ok = await markCancelled("email-1", "user-123");
    expect(ok).toBe(true);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "email-1", status: { in: [EmailStatus.SCHEDULED, EmailStatus.PROCESSING] } },
      data: { status: EmailStatus.CANCELLED },
    });
    expect(removeEmailJob).toHaveBeenCalledWith("email-1");
  });

  it("denies cancellation when User A tries to cancel User B's email (Requirement 20)", async () => {
    mockedFindUnique.mockResolvedValue({ id: "email-1", userId: "user-b" });

    await expect(markCancelled("email-1", "user-a")).rejects.toThrow(
      /Forbidden: You cannot cancel an email belonging to another user/
    );
    expect(mockedUpdateMany).not.toHaveBeenCalled();
    expect(removeEmailJob).not.toHaveBeenCalled();
  });
});

describe("reconcileScheduledEmailsWithoutJobs (Restart Recovery)", () => {
  it("detects scheduled emails with no active BullMQ jobs and re-adds them", async () => {
    mockedFindMany.mockResolvedValue([
      { id: "sched-1", status: EmailStatus.SCHEDULED, scheduledAt: new Date() },
    ]);
    (emailQueue.getJob as jest.Mock).mockResolvedValue(null);

    const readded = await reconcileScheduledEmailsWithoutJobs();
    expect(readded).toBe(1);
    expect(scheduleEmailJob).toHaveBeenCalledWith("sched-1", expect.any(Date));
  });
});

describe("scheduleBatch (High-performance batching)", () => {
  it("creates Batch entity and bulk inserts emails + adds bulk BullMQ jobs", async () => {
    mockedSenderFindFirst.mockResolvedValue({ id: "sender-1", userId: "user-1" });
    mockedBatchCreate.mockResolvedValue({ id: "batch-1" });
    mockedCreateMany.mockResolvedValue({ count: 2 });

    const result = await scheduleBatch("user-1", {
      senderId: "sender-1",
      subject: "Test campaign",
      body: "Hello world",
      recipients: ["alice@test.com", "bob@test.com"],
      startTime: new Date().toISOString(),
      delayBetweenEmailsMs: 1000,
      hourlyLimit: 50,
    });

    expect(result.batchId).toBeDefined();
    expect(result.emails).toHaveLength(2);
    expect(mockedBatchCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          senderId: "sender-1",
          delayBetweenEmailsMs: 1000,
          hourlyLimit: 50,
        }),
      })
    );
    expect(mockedCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ recipient: "alice@test.com" }),
        expect.objectContaining({ recipient: "bob@test.com" }),
      ]),
    });
    expect(emailQueue.addBulk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "email-send" }),
      ])
    );
  });
});

