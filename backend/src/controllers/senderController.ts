import { Router } from "express";
import { z } from "zod";
import { EmailSender } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthenticatedUser, PublicSender } from "../types";

export const senderRouter = Router();

export function toPublicSender(sender: {
  id: string;
  userId: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hourlyLimit?: number | null;
  minDelayMs?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}): PublicSender {
  // Explicit DTO whitelist -- NEVER use spread {...sender} or expose smtpPassword (C1 fix)
  return {
    id: sender.id,
    userId: sender.userId,
    name: sender.name,
    email: sender.email,
    smtpHost: sender.smtpHost,
    smtpPort: sender.smtpPort,
    smtpUser: sender.smtpUser,
    hourlyLimit: sender.hourlyLimit ?? null,
    minDelayMs: sender.minDelayMs ?? null,
    createdAt: sender.createdAt ?? new Date(),
    updatedAt: sender.updatedAt ?? new Date(),
  };
}

const createSenderSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().positive(),
  smtpUser: z.string().min(1),
  smtpPassword: z.string().min(1),
  hourlyLimit: z.number().int().positive().optional(),
  minDelayMs: z.number().int().min(0).optional(),
});

senderRouter.get("/", async (req, res) => {
  const user = req.user as AuthenticatedUser;
  const senders = await prisma.emailSender.findMany({ where: { userId: user.id } });
  res.json({ senders: senders.map(toPublicSender) });
});

senderRouter.post("/", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const body = createSenderSchema.parse(req.body);

    const sender = await prisma.emailSender.create({
      data: { ...body, userId: user.id },
    });

    res.status(201).json({ sender: toPublicSender(sender) });
  } catch (err) {
    next(err);
  }
});

senderRouter.delete("/:id", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const sender = await prisma.emailSender.findUnique({
      where: { id: req.params.id },
    });

    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return;
    }

    if (sender.userId !== user.id) {
      res.status(403).json({ error: "Forbidden: You cannot delete another user's sender" });
      return;
    }

    await prisma.emailSender.delete({
      where: { id: req.params.id },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
