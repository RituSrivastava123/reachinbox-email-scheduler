import { EmailStatus } from "@prisma/client";
import { DelayedError } from "bullmq";

jest.mock("../src/db/prisma", () => ({
  prisma: {
    email: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("../src/services/emailService", () => ({
  tryTransition: jest.fn(),
  markSent: jest.fn(),
  markFailed: jest.fn(),
}));

jest.mock("../src/services/rateLimiter", () => ({
  tryConsumeHourlySlot: jest.fn(),
  reserveSendSlot: jest.fn(),
  waitForSlot: jest.fn(),
  releaseHourlySlot: jest.fn(),
}));

jest.mock("../src/integrations/ethereal/mailer", () => ({
  sendEmail: jest.fn(),
}));

jest.mock("../src/integrations/slack/slackClient", () => ({
  notifyRateLimitReached: jest.fn(),
}));

jest.mock("../src/queues/connection", () => ({
  createRedisConnection: jest.fn(() => ({})),
}));

import { prisma } from "../src/db/prisma";
import { tryTransition, markSent, markFailed } from "../src/services/emailService";
import {
  tryConsumeHourlySlot,
  reserveSendSlot,
  waitForSlot,
  releaseHourlySlot,
} from "../src/services/rateLimiter";
import { sendEmail } from "../src/integrations/ethereal/mailer";
import { notifyRateLimitReached } from "../src/integrations/slack/slackClient";
import { processEmailJob } from "../src/workers/emailWorker";

const mockedEmailFindUnique = prisma.email.findUnique as jest.Mock;
const mockedEmailUpdate = prisma.email.update as jest.Mock;
const mockedTryTransition = tryTransition as jest.Mock;
const mockedMarkSent = markSent as jest.Mock;
const mockedMarkFailed = markFailed as jest.Mock;
const mockedTryConsumeHourlySlot = tryConsumeHourlySlot as jest.Mock;
const mockedReserveSendSlot = reserveSendSlot as jest.Mock;
const mockedWaitForSlot = waitForSlot as jest.Mock;
const mockedReleaseHourlySlot = releaseHourlySlot as jest.Mock;
const mockedSendEmail = sendEmail as jest.Mock;
const mockedNotifyRateLimitReached = notifyRateLimitReached as jest.Mock;

describe("emailWorker - Critical Check #1: Rate Limit Rescheduling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEmailUpdate.mockResolvedValue({});
  });

  const mockEmail = {
    id: "email-123",
    userId: "user-1",
    senderId: "sender-1",
    recipient: "test@example.com",
    subject: "Hello",
    body: "World",
    status: EmailStatus.SCHEDULED,
    hourlyLimit: 50,
    minDelayMs: 1000,
    sender: {
      id: "sender-1",
      name: "Sender One",
      email: "sender@example.com",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user",
      smtpPassword: "password",
      hourlyLimit: 100,
      minDelayMs: 2000,
    },
  };

  it("reschedules via moveToDelayed and DelayedError when rate limit is exceeded (Critical Check #1)", async () => {
    mockedEmailFindUnique.mockResolvedValue(mockEmail);
    mockedTryTransition.mockResolvedValue(true);

    const nextWindow = new Date(Date.now() + 1800_000);
    mockedTryConsumeHourlySlot.mockResolvedValue({
      allowed: false,
      currentCount: 50,
      limit: 50,
      nextWindowStart: nextWindow,
    });

    const mockJob = {
      data: { emailId: "email-123" },
      attemptsMade: 0,
      opts: { attempts: 5 },
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    // processEmailJob should throw DelayedError so BullMQ leaves the job in delayed state
    await expect(processEmailJob(mockJob as any, "worker-lock-token")).rejects.toThrow(DelayedError);

    // 1. Must update DB status back to SCHEDULED with new scheduledAt
    expect(mockedTryTransition).toHaveBeenCalledWith(
      "email-123",
      [EmailStatus.PROCESSING],
      {
        status: EmailStatus.SCHEDULED,
        scheduledAt: nextWindow,
      }
    );

    // 2. Must invoke moveToDelayed on the existing job with next window timestamp and lock token
    expect(mockJob.moveToDelayed).toHaveBeenCalledWith(nextWindow.getTime(), "worker-lock-token");

    // 3. Must notify Slack with deduplication
    expect(mockedNotifyRateLimitReached).toHaveBeenCalledWith(
      "user-1",
      "Sender One",
      nextWindow,
      "sender-1"
    );

    // 4. Must NOT mark as failed
    expect(mockedMarkFailed).not.toHaveBeenCalled();

    // 5. Must NOT attempt SMTP send
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});

describe("emailWorker - Critical Check #2: Retry and Exponential Backoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedEmailUpdate.mockResolvedValue({});
  });

  const mockEmail = {
    id: "email-456",
    userId: "user-1",
    senderId: "sender-1",
    recipient: "test@example.com",
    subject: "Hello",
    body: "World",
    status: EmailStatus.SCHEDULED,
    sender: {
      id: "sender-1",
      name: "Sender One",
      email: "sender@example.com",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user",
      smtpPassword: "password",
    },
  };

  it("re-throws transient error on non-final attempt without marking FAILED (attempt 1 of 5)", async () => {
    mockedEmailFindUnique.mockResolvedValue(mockEmail);
    mockedTryTransition.mockResolvedValue(true);
    mockedTryConsumeHourlySlot.mockResolvedValue({
      allowed: true,
      currentCount: 1,
      limit: 100,
      nextWindowStart: new Date(),
    });
    mockedReserveSendSlot.mockResolvedValue(Date.now());
    mockedWaitForSlot.mockResolvedValue(undefined);
    mockedSendEmail.mockRejectedValue(new Error("SMTP Connection Timeout"));
    mockedReleaseHourlySlot.mockResolvedValue(undefined);

    const mockJob = {
      data: { emailId: "email-456" },
      attemptsMade: 0, // First attempt (attemptsMade = 0, so attemptsMade + 1 = 1 < 5)
      opts: { attempts: 5 },
      moveToDelayed: jest.fn(),
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    await expect(processEmailJob(mockJob as any, "token")).rejects.toThrow("SMTP Connection Timeout");

    // Must release consumed hourly quota so failed network attempts don't burn quota
    expect(mockedReleaseHourlySlot).toHaveBeenCalledWith("sender-1");

    // Must NOT mark permanently failed (BullMQ backoff handles retry)
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });

  it("marks email FAILED when final attempt is exhausted (attempt 5 of 5)", async () => {
    mockedEmailFindUnique.mockResolvedValue({
      ...mockEmail,
      status: EmailStatus.PROCESSING,
    });
    mockedTryConsumeHourlySlot.mockResolvedValue({
      allowed: true,
      currentCount: 1,
      limit: 100,
      nextWindowStart: new Date(),
    });
    mockedReserveSendSlot.mockResolvedValue(Date.now());
    mockedWaitForSlot.mockResolvedValue(undefined);
    mockedSendEmail.mockRejectedValue(new Error("550 User unknown"));
    mockedReleaseHourlySlot.mockResolvedValue(undefined);

    const mockJob = {
      data: { emailId: "email-456" },
      attemptsMade: 4, // 5th attempt (4 + 1 >= 5)
      opts: { attempts: 5 },
      moveToDelayed: jest.fn(),
      updateProgress: jest.fn().mockResolvedValue(undefined),
    };

    await expect(processEmailJob(mockJob as any, "token")).rejects.toThrow("550 User unknown");

    // On final attempt, must call markFailed
    expect(mockedMarkFailed).toHaveBeenCalledWith("email-456", "550 User unknown");
    expect(mockedReleaseHourlySlot).toHaveBeenCalledWith("sender-1");
  });

  it("skips retried job if email was cancelled during backoff", async () => {
    mockedEmailFindUnique.mockResolvedValue({
      ...mockEmail,
      status: EmailStatus.CANCELLED,
    });

    const mockJob = {
      data: { emailId: "email-456" },
      attemptsMade: 1, // retry
      opts: { attempts: 5 },
      moveToDelayed: jest.fn(),
    };

    await processEmailJob(mockJob as any, "token");

    expect(mockedTryConsumeHourlySlot).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
    expect(mockedMarkSent).not.toHaveBeenCalled();
  });

  it("skips retried job if email was already marked SENT", async () => {
    mockedEmailFindUnique.mockResolvedValue({
      ...mockEmail,
      status: EmailStatus.SENT,
    });

    const mockJob = {
      data: { emailId: "email-456" },
      attemptsMade: 1,
      opts: { attempts: 5 },
      moveToDelayed: jest.fn(),
    };

    await processEmailJob(mockJob as any, "token");

    expect(mockedTryConsumeHourlySlot).not.toHaveBeenCalled();
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});
