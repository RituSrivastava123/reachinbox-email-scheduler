import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { AuthenticatedUser } from "../types";
import { parseRecipients } from "../services/csvParser";
import { scheduleBatch, listScheduled, listSent, markCancelled, searchEmailsInPostgres } from "../services/emailService";
import { searchEmails } from "../integrations/elasticsearch/emailIndex";
import { HttpError } from "../middleware/errorHandler";
import { logger } from "../utils/logger";
import { redis } from "../queues/connection";
import { prisma } from "../db/prisma";

export const emailRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// Recipient parsing preview (CSV upload OR pasted text)
// ---------------------------------------------------------------------------

emailRouter.post("/parse-recipients", upload.single("file"), async (req, res, next) => {
  try {
    let raw = "";
    if (req.file) {
      raw = req.file.buffer.toString("utf-8");
    } else if (typeof req.body?.text === "string") {
      raw = req.body.text;
    } else {
      throw new HttpError(400, "Provide either a CSV file upload or a `text` field");
    }

    const summary = parseRecipients(raw);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  startTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid startTime format; must be a valid ISO date/time string",
  }),
  delayBetweenEmailsMs: z.number().int().min(0).optional(),
  hourlyLimit: z.number().int().positive().optional(),
  idempotencyKey: z.string().optional(),
});

emailRouter.post("/schedule", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const body = scheduleSchema.parse(req.body);
    const idempotencyKey =
      (req.headers["idempotency-key"] as string | undefined) || body.idempotencyKey;

    let cacheKey: string | null = null;
    if (idempotencyKey) {
      // 1. Check PostgreSQL IdempotencyRecord
      const dbExisting = await prisma.idempotencyRecord.findUnique({
        where: { uniq_user_idempotency_key: { userId: user.id, key: idempotencyKey } },
      });
      if (dbExisting) {
        logger.info({ idempotencyKey }, "Returning PostgreSQL cached response for idempotency key");
        res.status(dbExisting.responseStatus).json(JSON.parse(dbExisting.responseBody));
        return;
      }

      // 2. Check Redis cache / atomic lock
      cacheKey = `idempotency:schedule:${user.id}:${idempotencyKey}`;
      const existing = await redis.get(cacheKey);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed.status === "processing") {
          throw new HttpError(409, "A scheduling request with this idempotency key is currently processing");
        }
        if (parsed.status === "completed") {
          logger.info({ idempotencyKey }, "Returning Redis cached response for idempotency key");
          res.status(200).json(parsed.response);
          return;
        }
      }

      // Atomically mark in-flight with 60-second TTL
      const acquired = await redis.set(cacheKey, JSON.stringify({ status: "processing" }), "EX", 60, "NX");
      if (!acquired) {
        throw new HttpError(409, "A scheduling request with this idempotency key is currently processing");
      }
    }

    try {
      const { batchId, emails } = await scheduleBatch(user.id, body);
      const responsePayload = {
        batchId,
        count: emails.length,
        emails,
      };

      if (idempotencyKey) {
        // Persist completed record in DB
        await prisma.idempotencyRecord.upsert({
          where: { uniq_user_idempotency_key: { userId: user.id, key: idempotencyKey } },
          update: { responseStatus: 201, responseBody: JSON.stringify(responsePayload) },
          create: {
            userId: user.id,
            key: idempotencyKey,
            responseStatus: 201,
            responseBody: JSON.stringify(responsePayload),
          },
        }).catch(() => undefined);

        if (cacheKey) {
          // Cache completed result in Redis for 24 hours
          await redis.set(
            cacheKey,
            JSON.stringify({ status: "completed", response: responsePayload }),
            "EX",
            86400
          );
        }
      }

      res.status(201).json(responsePayload);
    } catch (err) {
      if (cacheKey) {
        await redis.del(cacheKey).catch(() => undefined);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function paginationParams(req: import("express").Request) {
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? "20", 10) || 20));
  return { page, pageSize };
}

emailRouter.get("/", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const { page, pageSize } = paginationParams(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const result = await searchEmailsInPostgres({ userId: user.id, status, page, pageSize });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

emailRouter.get("/scheduled", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const { page, pageSize } = paginationParams(req);
    res.json(await listScheduled(user.id, page, pageSize));
  } catch (err) {
    next(err);
  }
});

emailRouter.get("/sent", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const { page, pageSize } = paginationParams(req);
    res.json(await listSent(user.id, page, pageSize));
  } catch (err) {
    next(err);
  }
});

emailRouter.get("/search", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const { page, pageSize } = paginationParams(req);
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    try {
      const results = await searchEmails({ userId: user.id, query, status, page, pageSize });
      res.json({ source: "elasticsearch", ...results });
    } catch (esErr) {
      // Elasticsearch unavailable: degrade gracefully to a proper Postgres query (M1 fix)
      logger.warn({ err: esErr }, "Elasticsearch search failed, falling back to Postgres");
      const fallback = await searchEmailsInPostgres({ userId: user.id, query, status, page, pageSize });
      res.json({ source: "postgres-fallback", ...fallback });
    }
  } catch (err) {
    next(err);
  }
});

emailRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const user = req.user as AuthenticatedUser;
    const ok = await markCancelled(req.params.id, user.id);
    if (!ok) throw new HttpError(409, "Email could not be cancelled in its current state");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
