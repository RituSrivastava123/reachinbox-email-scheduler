# ReachInbox — Full-Stack Email Job Scheduler

A production-grade, full-stack email campaign scheduler built from scratch with TypeScript, Node.js, Express, BullMQ, Redis, PostgreSQL (Prisma), Nodemailer (Ethereal SMTP), Elasticsearch, React (Vite), and Tailwind CSS.

> **Zero Cron Architecture**: Absolutely no `cron`, `node-cron`, or `setInterval` schedulers are used anywhere in this system. All scheduling, rate-limit delays, and crash recovery reconciliation are handled natively via BullMQ delayed and repeatable jobs backed by Redis sorted sets and PostgreSQL ACID transactions.

---

## 1. System Architecture

```
                       ┌────────────────────────────────┐
                       │     React 18 + Vite Frontend   │
                       │  Dashboard / Compose / Senders │
                       └───────────────┬────────────────┘
                                       │ HTTP / JSON (Session Cookie)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Express API Server                              │
│  · Auth (Google OAuth 2.0 / Dev Login)    · Senders (Credential Whitelisting)│
│  · Email Batches (Idempotency Guard)      · Search (Elasticsearch/Postgres)  │
│  · Slack OAuth (Integration & Alerting)   · Bull Board UI (/admin/queues)   │
└───────────────┬──────────────────────┬──────────────────────┬───────────────┘
                │                      │                      │
                ▼                      ▼                      ▼
    ┌──────────────────────┐ ┌───────────────────┐ ┌─────────────────────┐
    │   PostgreSQL 16      │ │     Redis 7       │ │  Elasticsearch 8    │
    │  Source of Truth     │ │ BullMQ Queues     │ │ Full-text search    │
    │  (Prisma ORM)        │ │ Distributed Locks │ │ index (best-effort) │
    │  · Users / Senders   │ │ Atomic Rate Limits│ │ · Searchable fields │
    │  · Batches / Emails  │ │ Session Store     │ │ · Graceful Postgres │
    │  · IdempotencyRecords│ │ Idempotency Cache │ │   fallback on drop  │
    └───────────▲──────────┘ └─────────┬─────────┘ └──────────▲──────────┘
                │                      │                      │
                │                      │ delayed jobs         │
                │                      ▼                      │
                │            ┌───────────────────┐            │
                └────────────┤   Worker Process  ├────────────┘
                             │ BullMQ Worker     │
                             │ Concurrency = env │
                             └─────────┬─────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
        ┌───────────────────────┐             ┌───────────────────────┐
        │     Ethereal SMTP     │             │     Slack API v2      │
        │ Real Nodemailer send  │             │ Real rate limit alert │
        │ Instant preview links │             │ Per-sender/hour dedupe│
        └───────────────────────┘             └───────────────────────┘
```

---

## 2. Tech Stack

- **Backend**: Node.js 20+, TypeScript, Express 4, Prisma ORM, BullMQ 5, ioredis, Nodemailer, `@elastic/elasticsearch`, `@bull-board/express`, Passport (Google OAuth 2.0), `@slack/web-api` (Slack OAuth 2.0), Zod, Pino.
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, React Router 6.
- **Infrastructure**: Docker Compose (PostgreSQL 16 Alpine, Redis 7 Alpine with AOF persistence, Elasticsearch 8.13.4).

---

## 3. Repository Structure

```
reachinbox/
├── docker-compose.yml           # PostgreSQL, Redis (AOF), Elasticsearch
├── .env.example                 # Environment template with production tunables
├── README.md                    # Technical documentation and audit report
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # PostgreSQL models: User, EmailSender, Batch, Email, IdempotencyRecord, SlackConnection
│   ├── src/
│   │   ├── config/              # Centralized environment configuration
│   │   ├── controllers/         # authController, emailController, senderController, slackController
│   │   ├── db/                  # Prisma database client
│   │   ├── integrations/        # elasticsearch, ethereal, google, slack
│   │   ├── middleware/          # auth guards, centralized error sanitizer
│   │   ├── queues/              # emailQueue, reconciliationQueue, redis connection
│   │   ├── routes/              # Express route mounting & security policies
│   │   ├── services/            # emailService, rateLimiter, csvParser
│   │   ├── types/               # TypeScript interfaces & DTO definitions
│   │   ├── utils/               # logger
│   │   ├── workers/             # emailWorker (BullMQ processor with moveToDelayed)
│   │   ├── app.ts               # Express application builder
│   │   ├── server.ts            # API server bootstrapper
│   │   └── worker.ts            # Standalone worker & crash recovery bootstrapper
│   └── tests/                   # 6 comprehensive test suites (34 tests)
│       ├── csvParser.test.ts
│       ├── emailService.test.ts
│       ├── emailWorker.test.ts
│       ├── idempotency.test.ts
│       ├── rateLimiter.test.ts
│       └── senderSecurity.test.ts
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── api/                 # Typed REST client
        ├── components/          # AddSenderModal, ComposeModal, Header, ScheduledTable, SentTable
        ├── hooks/               # useAuth
        └── pages/               # Dashboard, Login
```

---

## 4. Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- (Optional) Google OAuth 2.0 Credentials (a built-in Dev Login is provided for testing)
- (Optional) Slack App Credentials (for Slack notification testing)

### Quick Setup

1. **Clone the repository and prepare environment files:**
   ```bash
   cp .env.example .env
   cp .env.example backend/.env
   ```

2. **Start Datastores via Docker Compose:**
   ```bash
   docker compose up -d
   ```
   *Verify that PostgreSQL (5432), Redis (6379), and Elasticsearch (9200) are healthy:*
   ```bash
   docker compose ps
   ```

3. **Install Dependencies and Migrate Database:**
   ```bash
   # Backend
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate dev --name init

   # Frontend
   cd ../frontend
   npm install
   ```

4. **Start the API Server:**
   ```bash
   cd backend
   npm run dev
   # Server runs on http://localhost:4000
   # Bull Board runs on http://localhost:4000/admin/queues
   ```

5. **Start the Worker Process (in a separate terminal):**
   ```bash
   cd backend
   npm run dev:worker
   ```

6. **Start the Frontend (in a third terminal):**
   ```bash
   cd frontend
   npm run dev
   # Dashboard runs on http://localhost:5173
   ```

---

## 5. Core Architectural Mechanisms & Hostile Code Audit Verification

### Critical Check #1: Rate Limit Rescheduling (Never Drop Jobs)
- **Verified in**: `backend/src/workers/emailWorker.ts`
- **Mechanism**: When an active BullMQ job encounters hourly rate limit exhaustion (`tryConsumeHourlySlot` returns `allowed: false`):
  1. Updates the database row status back to `SCHEDULED` with `scheduledAt: quota.nextWindowStart` via guarded transition.
  2. Dispatches a deduplicated Slack alert to the user.
  3. Uses BullMQ v5 native `await job.moveToDelayed(quota.nextWindowStart.getTime(), token)` and throws `new DelayedError()`.
  4. This moves the **current active job** into BullMQ's delayed sorted set in Redis. It does **not** drop the job and does **not** call `queue.add()` with the same ID (which would cause collisions or duplicate deliveries).

### Critical Check #2: Retry and Exponential Backoff
- **Verified in**: `backend/src/workers/emailWorker.ts` & `backend/src/queues/emailQueue.ts`
- **Mechanism**:
  - `emailQueue` is initialized with `attempts: 5` and exponential backoff `backoff: { type: "exponential", delay: 5000 }`.
  - On non-fatal failure (e.g. SMTP socket timeout on attempt 1 of 5), `isFinalAttempt` (`job.attemptsMade + 1 >= maxAttempts`) evaluates to `false`.
  - The worker updates `attempts` count, leaves the database status in `PROCESSING`, safely releases the consumed hourly quota slot (`releaseHourlySlot`), and **re-throws the error**. BullMQ catches the re-thrown error and manages delayed retry.
  - Only when all attempts are exhausted does `markFailed()` execute, transitioning status to `FAILED`.
  - On retried execution, the worker verifies that the email was not cancelled (`status === CANCELLED`) or already sent (`status === SENT`) before attempting delivery.

### Critical Check #3: Idempotency Key Handling (PostgreSQL + Redis)
- **Verified in**: `backend/src/controllers/emailController.ts`
- **Mechanism**:
  - Accepts idempotency keys via HTTP header `Idempotency-Key` or request body `idempotencyKey`.
  - **Persistent Path**: Queries PostgreSQL `prisma.idempotencyRecord` table (scoped to `userId` and `key`). If present, returns the cached response status and payload immediately without queueing new jobs.
  - **Fast Path / Atomic Lock**: Checks Redis `idempotency:schedule:{userId}:{key}`. An atomic `SET ... EX 60 NX` locks concurrent in-flight requests. If another request is currently processing with the same key, it returns `409 Conflict`.
  - Upon successful batch creation, persists the 201 response into both PostgreSQL (`IdempotencyRecord`) and Redis (cached for 24 hours).

### Critical Check #4: Crash Recovery & Zero Cron Schedulers
- **Verified in**: `backend/src/queues/reconciliationQueue.ts` & `backend/src/worker.ts`
- **Mechanism**:
  - No `cron`, `node-cron`, or `setInterval` exists in the codebase.
  - On worker boot, `reconcileStuckEmails` sweeps for orphaned `PROCESSING` rows older than lock duration, and `reconcileScheduledEmailsWithoutJobs` ensures all `SCHEDULED` emails have active/delayed BullMQ jobs in Redis.
  - Continuous background crash recovery is handled by a durable BullMQ repeatable job (`repeat: { every: 60000 }`) managed within Redis sorted sets.

### Critical Check #5: Credential Protection (Zero Leakage)
- **Verified in**: `backend/src/controllers/senderController.ts` & `backend/src/integrations/ethereal/mailer.ts`
- **Mechanism**:
  - `toPublicSender()` applies an explicit DTO whitelist (`id`, `userId`, `name`, `email`, `smtpHost`, `smtpPort`, `smtpUser`, `hourlyLimit`, `minDelayMs`, `createdAt`, `updatedAt`).
  - Object spread `{ ...sender }` and `delete sender.smtpPassword` are forbidden.
  - `smtpPassword` is never logged in logger output and never returned in `GET /api/senders`, `POST /api/senders`, or `DELETE /api/senders/:id`.

### Critical Check #6: Multi-Tenant User Isolation
- **Verified in**: All API controllers and services
- **Mechanism**:
  - `GET /api/senders`: Strictly queries `where: { userId: user.id }`.
  - `POST /api/senders`: Creates sender with `userId: user.id`.
  - `DELETE /api/senders/:id`: Validates `sender.userId === user.id`; returns `403 Forbidden` on unauthorized deletion.
  - `POST /api/emails/schedule`: Validates `senderId` belongs to `user.id`.
  - `GET /api/emails/scheduled` & `GET /api/emails/sent`: Filtered by `userId: user.id`.
  - `POST /api/emails/:id/cancel`: Enforces `email.userId === user.id`; throws `403 Forbidden` if User A attempts to cancel User B's email.
  - `GET /api/emails/search`: Elasticsearch query enforces `{ term: { userId } }`; Postgres fallback enforces `where: { userId }`.
  - Slack alerts: Look up the sending email's specific `userId`.

### High-Priority Features:
- **Batch Model & Relationship**: `prisma/schema.prisma` models `Batch` linked to `User`, `EmailSender`, and `Email[]`.
- **1000+ Email Scalability**: `scheduleBatch` uses `prisma.email.createMany` and `emailQueue.addBulk` to insert 1,000+ recipients in a single SQL operation and single Redis pipeline.
- **Per-Batch Overrides**: Compose modal allows specifying `delayBetweenEmailsMs` and `hourlyLimit`, which take precedence over sender defaults.
- **Global Minimum Delay**: Per-sender atomic reservation via Redis Lua script (`reserveSendSlot`) prevents race conditions under high concurrency. Maximum delay is clamped to 45s to avoid exceeding BullMQ lock duration.
- **Safe Quota Release**: If SMTP send fails after consuming an hourly slot, `releaseHourlySlot` executes a safe Lua script that decrements without dropping below zero.
- **Graceful Search Fallback**: If Elasticsearch is unavailable, `GET /api/emails/search` falls back to a case-insensitive multi-field PostgreSQL query (`source: "postgres-fallback"`).

---

## 6. API Reference

### Authentication
- `GET /api/auth/me`: Returns current authenticated user profile.
- `POST /api/auth/logout`: Clears session and cookie.
- `POST /api/auth/dev-login`: Logs in as demo user (`demo@reachinbox.ai`) for testing without Google credentials.
- `GET /api/auth/google`: Initiates Google OAuth 2.0 flow.
- `GET /api/auth/google/callback`: OAuth 2.0 callback endpoint.

### Senders
- `GET /api/senders`: Lists senders owned by the user (`smtpPassword` omitted).
- `POST /api/senders`: Creates a new sender (supports custom Ethereal/SMTP credentials).
- `DELETE /api/senders/:id`: Deletes a sender owned by the user (returns 403 on foreign sender).

### Emails & Scheduling
- `POST /api/emails/parse-recipients`: Parses and deduplicates CSV files or pasted text.
- `POST /api/emails/schedule`: Creates batch, email rows, and BullMQ delayed jobs. Accepts `Idempotency-Key` header.
- `GET /api/emails`: Lists user emails with pagination and status filters.
- `GET /api/emails/scheduled`: Lists scheduled and in-processing emails.
- `GET /api/emails/sent`: Lists sent and failed emails (with Ethereal preview URLs).
- `GET /api/emails/search`: Full-text search across subject, recipient, body via Elasticsearch or Postgres fallback.
- `POST /api/emails/:id/cancel`: Cancels scheduled email and deletes BullMQ job.

### Slack Integration
- `GET /api/slack/connect`: Initiates Slack OAuth 2.0 flow (`chat:write`, `channels:read`, `im:write`).
- `GET /api/slack/callback`: Slack OAuth callback; exchanges token and stores connection.
- `POST /api/slack/disconnect`: Deactivates Slack integration.
- `GET /api/slack/status`: Checks connection status without exposing access tokens.

### Bull Board Monitoring
- `GET /admin/queues`: Live dashboard showing waiting, delayed, active, completed, and failed BullMQ jobs. Protected by HTTP Basic Auth (`admin` / configured password).

---

## 7. Testing & Verification

The test suite covers unit logic, guarded state transitions, BullMQ worker rescheduling, retry backoff, multi-tenancy authorization, and idempotency handling.

Run all tests:
```bash
cd backend
npm test
```

### Verified Test Suites:
1. `tests/emailWorker.test.ts`:
   - Reschedules via `moveToDelayed` and `DelayedError` when hourly limit is reached.
   - Updates DB status back to `SCHEDULED` with `nextWindowStart`.
   - Sends deduplicated Slack notification.
   - Non-final failures re-throw error for BullMQ backoff and release hourly slot.
   - Final attempt (attempt 5) transitions email to `FAILED`.
   - Skips redelivery if email was cancelled or already sent.
2. `tests/idempotency.test.ts`:
   - Returns cached response from PostgreSQL if record exists.
   - Returns cached response from Redis fast path.
   - Rejects concurrent requests with `409 Conflict`.
   - Acquires Redis atomic lock, persists to PostgreSQL, and caches result for 24h.
3. `tests/senderSecurity.test.ts`:
   - `toPublicSender` DTO whitelist strictly excludes `smtpPassword`.
   - `GET /api/senders` strictly filters by `req.user.id` and omits `smtpPassword`.
   - `POST /api/senders` associates with `req.user.id` and omits `smtpPassword`.
   - `DELETE /api/senders/:id` enforces ownership and returns `403 Forbidden` on foreign senders.
4. `tests/emailService.test.ts`:
   - Guarded atomic state transitions (`tryTransition`) prevent duplicate sends.
   - `markSent` and `markFailed` state handling.
   - `markCancelled` enforces ownership (403 on cross-user cancellation).
   - Case-insensitive PostgreSQL search fallback across all statuses.
   - Startup crash recovery sweeps for stuck and missing jobs.
   - Batch creation and bulk BullMQ job creation.
5. `tests/rateLimiter.test.ts`:
   - UTC hour window calculation and rollover.
   - Redis atomic Lua hourly rate limiting.
   - Safe quota slot release without dropping below zero.
6. `tests/csvParser.test.ts`:
   - CSV and plain text parsing, RFC email validation, whitespace trimming, and deduplication.

---

## 8. Step-by-Step Demo Flow

1. Open `http://localhost:5173` in your browser.
2. Click **Demo Login** (or Sign in with Google if configured).
3. Click **Add Sender**, enter sender information (or click "Auto-fill with Ethereal" to auto-generate a disposable SMTP inbox).
4. Click **Compose New Email**:
   - Select your sender.
   - Paste or upload a list of recipient emails (e.g. 5 recipients).
   - Set start time to 1 minute in the future.
   - Set Delay between emails to 2000 ms.
   - Set Hourly limit to 2 (to observe rate limit rescheduling).
   - Click **Schedule Batch**.
5. Observe the emails appear in the **Scheduled Emails** tab with live count badges.
6. Open `http://localhost:4000/admin/queues` in another tab to inspect the delayed jobs in Bull Board.
7. As the scheduled time arrives:
   - First 2 emails are sent via real Ethereal SMTP.
   - Emails appear in the **Sent Emails** tab with clickable Ethereal preview links.
   - Subsequent emails beyond the hourly quota are rescheduled to the next hour window via `moveToDelayed`.
8. Search for any recipient or subject keyword in the search bar to observe real-time search with source indicators.
