import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/rate-limit.js";

describe("RateLimiter", () => {
  it("allows requests up to the burst limit, then blocks", () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("refills over time", async () => {
    const limiter = new RateLimiter(1, 10); // 1 token per 10ms
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    await new Promise((r) => setTimeout(r, 25));
    expect(limiter.allow("a")).toBe(true);
  });
});
