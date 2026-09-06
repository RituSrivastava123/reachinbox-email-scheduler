import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return parsed;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: int("PORT", 4000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",

  databaseUrl: required(
    "DATABASE_URL",
    "postgresql://reachinbox:reachinbox@localhost:5432/reachinbox?schema=public"
  ),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  elasticsearchUrl: required("ELASTICSEARCH_URL", "http://localhost:9200"),

  // Scheduling / rate-limiting knobs. These are read from the environment on
  // every boot on purpose -- nothing here is allowed to be hardcoded.
  workerConcurrency: int("WORKER_CONCURRENCY", 10),
  minEmailDelayMs: int("MIN_EMAIL_DELAY_MS", 2000),
  maxEmailsPerHour: int("MAX_EMAILS_PER_HOUR", 200),

  sessionSecret: (() => {
    const val = process.env.SESSION_SECRET;
    if (!val) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("Missing required environment variable: SESSION_SECRET (required in production)");
      }
      console.warn(
        "\x1b[33m%s\x1b[0m",
        "[WARN] SESSION_SECRET is not set. Using dev-only fallback. Set SESSION_SECRET in production!"
      );
      return "dev-only-secret-change-me";
    }
    return val;
  })(),

  backendUrl: process.env.BACKEND_URL ?? "http://localhost:4000",

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/api/auth/google/callback",
  },

  slack: {
    clientId: process.env.SLACK_CLIENT_ID ?? "",
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
    callbackUrl:
      process.env.SLACK_REDIRECT_URI ??
      process.env.SLACK_CALLBACK_URL ??
      "http://localhost:4000/api/slack/callback",
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? "",
  },

  ethereal: {
    user: process.env.ETHEREAL_USER ?? "",
    pass: process.env.ETHEREAL_PASS ?? "",
  },

  bullBoard: {
    user: process.env.BULL_BOARD_USER ?? "admin",
    password: process.env.BULL_BOARD_PASSWORD ?? "admin",
  },
};

export type AppConfig = typeof config;
