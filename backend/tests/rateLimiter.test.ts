import { startOfNextHour } from "../src/services/rateLimiter";
import { redis } from "../src/queues/connection";

describe("startOfNextHour", () => {
  it("computes the exact top of the next UTC hour", () => {
    const d = new Date("2026-09-06T14:25:30.000Z");
    const next = startOfNextHour(d);
    expect(next.toISOString()).toBe("2026-09-06T15:00:00.000Z");
  });

  it("rolls over correctly across UTC midnight", () => {
    const d = new Date("2026-09-06T23:45:00.000Z");
    const next = startOfNextHour(d);
    expect(next.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });
});

describe("tryConsumeHourlySlot (Unit with Mocked Redis)", () => {
  it("allows when under limit and rejects and decrements when limit is exceeded", async () => {
    const evalSpy = jest.spyOn(redis, "eval");
    const decrSpy = jest.spyOn(redis, "decr").mockResolvedValue(3);

    // 1. Under limit (current = 1, limit = 2)
    evalSpy.mockResolvedValueOnce(1);
    const { tryConsumeHourlySlot } = await import("../src/services/rateLimiter");
    const res1 = await tryConsumeHourlySlot("sender-1", 2);
    expect(res1.allowed).toBe(true);
    expect(res1.currentCount).toBe(1);

    // 2. Over limit (current = 3, limit = 2)
    evalSpy.mockResolvedValueOnce(3);
    const res2 = await tryConsumeHourlySlot("sender-1", 2);
    expect(res2.allowed).toBe(false);
    expect(res2.currentCount).toBe(2);
    expect(decrSpy).toHaveBeenCalled();

    evalSpy.mockRestore();
    decrSpy.mockRestore();
  });
});

describe("releaseHourlySlot", () => {
  it("evaluates safe decrement on the hourWindowKey", async () => {
    const evalSpy = jest.spyOn(redis, "eval").mockResolvedValue(0);
    const { releaseHourlySlot } = await import("../src/services/rateLimiter");
    await releaseHourlySlot("sender-1");
    expect(evalSpy).toHaveBeenCalledWith(
      expect.stringContaining("DECR"),
      1,
      expect.stringContaining("email_rate_limit:sender-1:")
    );
    evalSpy.mockRestore();
  });
});

