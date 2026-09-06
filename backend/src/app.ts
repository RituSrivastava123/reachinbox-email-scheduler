import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import session from "express-session";
import RedisStore from "connect-redis";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

import { config } from "./config";
import { logger } from "./utils/logger";
import { redis } from "./queues/connection";
import passport from "./integrations/google/passport";
import { apiRouter } from "./routes";
import { buildBullBoardRouter } from "./dashboard/bullBoard";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function buildApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  const sessionStore = new RedisStore({ client: redis, prefix: "reachinbox:sess:" });
  app.use(
    session({
      store: sessionStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: config.nodeEnv === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // Basic rate limiting on public auth endpoints to blunt credential-stuffing
  // / OAuth abuse. This is unrelated to the per-sender email rate limiter.
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 });
  app.use("/api/auth", authLimiter);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/admin/queues", buildBullBoardRouter());
  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
