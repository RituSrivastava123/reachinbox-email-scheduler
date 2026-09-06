import { redis } from "../queues/connection";
import { config } from "../config";

/**
 * Redis-backed, multi-worker-safe rate limiting.
 *
 * Two independent mechanisms are implemented here, both required by the
 * assignment:
 *
 * 1. A global *minimum delay* between any two emails sent by the same
 *    sender (MIN_EMAIL_DELAY_MS). A naive `sleep()` inside a worker only
 *    throttles that worker's own event loop -- with WORKER_CONCURRENCY > 1
 *    or multiple worker processes, several sleeps can elapse in parallel and
 *    the real-world gap between two sends collapses to ~0. To make the delay
 *    global we store a single "next allowed send timestamp" per sender in
 *    Redis and advance it atomically with a Lua script, so concurrent
 *    workers effectively queue up for their own personal slot before the
 *    Lua script even returns.
 *
 * 2. An *hourly cap* per sender (MAX_EMAILS_PER_HOUR). We use an atomic
 *    INCR against a key scoped to sender + hour-window
 *    (email_rate_limit:{senderId}:{YYYY-MM-DD-HH}), with an EXPIRE set only
 *    on the first increment of the window. INCR is atomic in Redis, so this
 *    is safe across any number of worker processes/instances.
 */

// ---------------------------------------------------------------------------
// Hourly cap
// ---------------------------------------------------------------------------

function hourWindowKey(senderId: string, date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  return `email_rate_limit:${senderId}:${y}-${m}-${d}-${h}`;
}

export function startOfNextHour(from: Date): Date {
  const next = new Date(from);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

interface HourlyQuotaResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  nextWindowStart: Date;
}

const INCR_WITH_TTL_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if tonumber(current) == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

/**
 * Attempts to reserve one "slot" in the sender's current hourly window.
 * Uses an atomic INCR (via a tiny Lua script so the INCR + EXPIRE pairing is
 * itself atomic) so it is safe under arbitrary concurrency.
 *
 * If the reservation pushes the count over the limit, the increment is
 * immediately reversed (DECR) so we don't permanently "burn" a slot for an
 * email that will instead be rescheduled.
 */
export async function tryConsumeHourlySlot(
  senderId: string,
  limitOverride?: number
): Promise<HourlyQuotaResult> {
  const limit = limitOverride ?? config.maxEmailsPerHour;
  const now = new Date();
  const key = hourWindowKey(senderId, now);

  const current = (await redis.eval(INCR_WITH_TTL_SCRIPT, 1, key, 3600)) as number;

  if (current > limit) {
    // Give the slot back -- we didn't actually send anything.
    await redis.decr(key);
    return {
      allowed: false,
      currentCount: limit,
      limit,
      nextWindowStart: startOfNextHour(now),
    };
  }

  return { allowed: true, currentCount: current, limit, nextWindowStart: startOfNextHour(now) };
}

const DECR_IF_POSITIVE_SCRIPT = `
local val = tonumber(redis.call("GET", KEYS[1]))
if val and val > 0 then
  return redis.call("DECR", KEYS[1])
end
return 0
`;

/**
 * Releases an hourly quota slot previously consumed when an email send
 * terminates with an error before successful delivery (H6 fix).
 * Safely guards against negative counters.
 */
export async function releaseHourlySlot(senderId: string): Promise<void> {
  const now = new Date();
  const key = hourWindowKey(senderId, now);
  await redis.eval(DECR_IF_POSITIVE_SCRIPT, 1, key).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Global minimum delay between sends (per sender)
// ---------------------------------------------------------------------------

const RESERVE_SLOT_SCRIPT = `
-- KEYS[1] = per-sender "next allowed send time" key
-- ARGV[1] = now (ms)
-- ARGV[2] = min delay (ms)
-- ARGV[3] = key TTL (seconds), just to avoid leaking keys forever
local nextAllowed = tonumber(redis.call("GET", KEYS[1]))
local now = tonumber(ARGV[1])
local minDelay = tonumber(ARGV[2])

local base = now
if nextAllowed and nextAllowed > now then
  base = nextAllowed
end

local mySlot = base
local newNext = base + minDelay

redis.call("SET", KEYS[1], newNext, "EX", ARGV[3])
return mySlot
`;

/**
 * Atomically reserves the next available send slot for a sender, honoring
 * the configured minimum delay between sends. Returns the timestamp (ms
 * since epoch) at which THIS caller is allowed to send. The caller is
 * responsible for waiting out any remaining time before calling SMTP.
 *
 * Because the read-modify-write happens inside a single Lua script, two
 * workers racing to send for the same sender at the same instant will
 * always be handed distinct, correctly-spaced slots -- there is no
 * check-then-act window for a race to slip through.
 */
export async function reserveSendSlot(senderId: string, minDelayMsOverride?: number): Promise<number> {
  // Cap minDelayMs to 45 seconds to stay well within BullMQ worker lock duration (M2)
  const rawDelay = minDelayMsOverride ?? config.minEmailDelayMs;
  const minDelayMs = Math.min(Math.max(0, rawDelay), 45000);
  const key = `email_min_delay:${senderId}`;
  const now = Date.now();
  const ttlSeconds = Math.max(60, Math.ceil((minDelayMs * 2) / 1000));

  const slot = (await redis.eval(
    RESERVE_SLOT_SCRIPT,
    1,
    key,
    now,
    minDelayMs,
    ttlSeconds
  )) as number;

  return slot;
}

export async function waitForSlot(
  slotTimestampMs: number,
  onProgress?: (remainingMs: number) => Promise<void> | void
): Promise<void> {
  let remaining = slotTimestampMs - Date.now();
  while (remaining > 0) {
    const chunk = Math.min(remaining, 2000);
    await new Promise((resolve) => setTimeout(resolve, chunk));
    remaining = slotTimestampMs - Date.now();
    if (onProgress) {
      await onProgress(Math.max(0, remaining));
    }
  }
}
