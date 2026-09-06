import express from "express";
import request from "supertest";
import { emailRouter } from "../src/controllers/emailController";
import { errorHandler } from "../src/middleware/errorHandler";

jest.mock("../src/db/prisma", () => ({
  prisma: {
    idempotencyRecord: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
    },
    emailSender: {
      findFirst: jest.fn(),
    },
    email: {
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    batch: {
      create: jest.fn(),
    },
  },
}));

jest.mock("../src/queues/connection", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
  createRedisConnection: jest.fn(() => ({})),
}));

jest.mock("../src/services/emailService", () => ({
  scheduleBatch: jest.fn(),
  listScheduled: jest.fn(),
  listSent: jest.fn(),
  markCancelled: jest.fn(),
  searchEmailsInPostgres: jest.fn(),
}));

jest.mock("../src/integrations/elasticsearch/emailIndex", () => ({
  searchEmails: jest.fn(),
}));

import { prisma } from "../src/db/prisma";
import { redis } from "../src/queues/connection";
import { scheduleBatch } from "../src/services/emailService";

const mockedIdempotencyFindUnique = prisma.idempotencyRecord.findUnique as jest.Mock;
const mockedIdempotencyUpsert = prisma.idempotencyRecord.upsert as jest.Mock;
const mockedRedisGet = redis.get as jest.Mock;
const mockedRedisSet = redis.set as jest.Mock;
const mockedScheduleBatch = scheduleBatch as jest.Mock;

describe("emailController - Critical Check #3: Idempotency Key Handling", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    // Attach test authenticated user middleware
    app.use((req, _res, next) => {
      req.user = {
        id: "user-1",
        email: "user@example.com",
        name: "Test User",
        avatarUrl: null,
      };
      next();
    });
    app.use("/api/emails", emailRouter);
    app.use(errorHandler);
  });

  const validPayload = {
    senderId: "11111111-1111-1111-1111-111111111111",
    subject: "Idempotent Campaign",
    body: "Body content",
    recipients: ["user1@example.com"],
    startTime: new Date().toISOString(),
  };

  it("returns cached response from PostgreSQL if idempotency record exists (Persistent Path)", async () => {
    const cachedResponse = {
      batchId: "batch-cached-1",
      count: 1,
      emails: [{ id: "email-1", recipient: "user1@example.com" }],
    };

    mockedIdempotencyFindUnique.mockResolvedValue({
      id: "rec-1",
      userId: "user-1",
      key: "test-idem-key-1",
      responseStatus: 201,
      responseBody: JSON.stringify(cachedResponse),
    });

    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Idempotency-Key", "test-idem-key-1")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(cachedResponse);
    // Should NOT call scheduleBatch or re-queue jobs
    expect(mockedScheduleBatch).not.toHaveBeenCalled();
  });

  it("returns cached response from Redis fast path if already completed", async () => {
    mockedIdempotencyFindUnique.mockResolvedValue(null);
    const cachedResponse = {
      batchId: "batch-redis-cached",
      count: 1,
      emails: [{ id: "email-2", recipient: "user1@example.com" }],
    };

    mockedRedisGet.mockResolvedValue(
      JSON.stringify({ status: "completed", response: cachedResponse })
    );

    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Idempotency-Key", "test-idem-key-2")
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedResponse);
    expect(mockedScheduleBatch).not.toHaveBeenCalled();
  });

  it("returns 409 Conflict if a concurrent request with the same idempotency key is in-flight", async () => {
    mockedIdempotencyFindUnique.mockResolvedValue(null);
    // Redis SET with NX returns null/false when key already exists
    mockedRedisGet.mockResolvedValue(JSON.stringify({ status: "processing" }));

    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Idempotency-Key", "concurrent-key")
      .send(validPayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("currently processing");
    expect(mockedScheduleBatch).not.toHaveBeenCalled();
  });

  it("succeeds on first request, acquires Redis lock, persists DB record and completes Redis cache", async () => {
    mockedIdempotencyFindUnique.mockResolvedValue(null);
    mockedRedisGet.mockResolvedValue(null);
    mockedRedisSet.mockResolvedValue("OK");
    mockedScheduleBatch.mockResolvedValue({
      batchId: "new-batch-id",
      emails: [{ id: "new-email-id", recipient: "user1@example.com" }],
    });
    mockedIdempotencyUpsert.mockResolvedValue({});

    const res = await request(app)
      .post("/api/emails/schedule")
      .set("Idempotency-Key", "first-time-key")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.batchId).toBe("new-batch-id");
    expect(mockedScheduleBatch).toHaveBeenCalledWith("user-1", expect.objectContaining({
      subject: "Idempotent Campaign",
    }));

    // Must persist completed record in PostgreSQL
    expect(mockedIdempotencyUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uniq_user_idempotency_key: { userId: "user-1", key: "first-time-key" },
        },
      })
    );

    // Must cache completed result in Redis
    expect(mockedRedisSet).toHaveBeenCalledWith(
      "idempotency:schedule:user-1:first-time-key",
      expect.stringContaining('"status":"completed"'),
      "EX",
      86400
    );
  });
});
