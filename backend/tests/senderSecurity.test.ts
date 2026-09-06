import express from "express";
import request from "supertest";
import { toPublicSender, senderRouter } from "../src/controllers/senderController";

jest.mock("../src/db/prisma", () => ({
  prisma: {
    emailSender: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from "../src/db/prisma";

const mockedSenderFindMany = prisma.emailSender.findMany as jest.Mock;
const mockedSenderFindUnique = prisma.emailSender.findUnique as jest.Mock;
const mockedSenderCreate = prisma.emailSender.create as jest.Mock;
const mockedSenderDelete = prisma.emailSender.delete as jest.Mock;

describe("toPublicSender (C1 Security Fix)", () => {
  it("strictly excludes smtpPassword from the returned public object", () => {
    const rawSender = {
      id: "sender-123",
      userId: "user-456",
      name: "Acme Sales",
      email: "sales@acme.com",
      smtpHost: "smtp.acme.com",
      smtpPort: 587,
      smtpUser: "sales_user",
      smtpPassword: "SuperSecretPassword123!",
      hourlyLimit: 100,
      minDelayMs: 2000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const publicSender = toPublicSender(rawSender as any);

    expect(publicSender).toHaveProperty("id", "sender-123");
    expect(publicSender).toHaveProperty("name", "Acme Sales");
    expect(publicSender).toHaveProperty("email", "sales@acme.com");
    expect(publicSender).toHaveProperty("smtpHost", "smtp.acme.com");
    expect(publicSender).toHaveProperty("smtpPort", 587);
    expect(publicSender).toHaveProperty("smtpUser", "sales_user");
    // Assert smtpPassword is not exposed
    expect(publicSender).not.toHaveProperty("smtpPassword");
    expect((publicSender as any).smtpPassword).toBeUndefined();
    expect(JSON.stringify(publicSender)).not.toContain("SuperSecretPassword123!");
  });
});

describe("senderRouter - Multi-tenancy and Credential Protection (Critical Check #5 & #6)", () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: "user-owner", email: "owner@test.com", name: "Owner", avatarUrl: null };
      next();
    });
    app.use("/api/senders", senderRouter);
  });

  it("GET /api/senders filters exclusively by req.user.id and omits smtpPassword", async () => {
    mockedSenderFindMany.mockResolvedValue([
      {
        id: "sender-1",
        userId: "user-owner",
        name: "Sender 1",
        email: "sender1@test.com",
        smtpHost: "smtp.test.com",
        smtpPort: 587,
        smtpUser: "s1",
        smtpPassword: "SecretPassword1",
        hourlyLimit: 100,
        minDelayMs: 2000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await request(app).get("/api/senders");

    expect(res.status).toBe(200);
    expect(mockedSenderFindMany).toHaveBeenCalledWith({ where: { userId: "user-owner" } });
    expect(res.body.senders).toHaveLength(1);
    expect(res.body.senders[0]).not.toHaveProperty("smtpPassword");
    expect(res.text).not.toContain("SecretPassword1");
  });

  it("POST /api/senders creates sender associated with req.user.id and does NOT return smtpPassword", async () => {
    mockedSenderCreate.mockResolvedValue({
      id: "new-sender-id",
      userId: "user-owner",
      name: "New Sender",
      email: "newsender@test.com",
      smtpHost: "smtp.test.com",
      smtpPort: 587,
      smtpUser: "newuser",
      smtpPassword: "TopSecretPassword",
      hourlyLimit: 100,
      minDelayMs: 2000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/senders")
      .send({
        name: "New Sender",
        email: "newsender@test.com",
        smtpHost: "smtp.test.com",
        smtpPort: 587,
        smtpUser: "newuser",
        smtpPassword: "TopSecretPassword",
      });

    expect(res.status).toBe(201);
    expect(mockedSenderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-owner" }),
      })
    );
    expect(res.body.sender).not.toHaveProperty("smtpPassword");
    expect(res.text).not.toContain("TopSecretPassword");
  });

  it("DELETE /api/senders/:id returns 403 Forbidden if sender belongs to another user (Critical Check #6)", async () => {
    mockedSenderFindUnique.mockResolvedValue({
      id: "sender-other",
      userId: "other-user-999",
    });

    const res = await request(app).delete("/api/senders/sender-other");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Forbidden");
    expect(mockedSenderDelete).not.toHaveBeenCalled();
  });

  it("DELETE /api/senders/:id allows deletion if sender belongs to the requesting user", async () => {
    mockedSenderFindUnique.mockResolvedValue({
      id: "sender-mine",
      userId: "user-owner",
    });
    mockedSenderDelete.mockResolvedValue({});

    const res = await request(app).delete("/api/senders/sender-mine");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockedSenderDelete).toHaveBeenCalledWith({ where: { id: "sender-mine" } });
  });
});
