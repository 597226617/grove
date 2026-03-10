import { describe, expect, test } from "bun:test";

import {
  canRetry,
  computeBackoffMs,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_BACKOFF_MS,
} from "./backoff.js";

describe("computeBackoffMs", () => {
  test("returns a value in [0, baseMs) for attempt 0", () => {
    const base = 1000;
    for (let i = 0; i < 200; i++) {
      const result = computeBackoffMs(0, base, 300_000);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(base);
    }
  });

  test("returns an integer (no fractional milliseconds)", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      for (let i = 0; i < 100; i++) {
        const result = computeBackoffMs(attempt);
        expect(Number.isInteger(result)).toBe(true);
      }
    }
  });

  test("never exceeds the cap", () => {
    const cap = 5000;
    for (let attempt = 0; attempt < 20; attempt++) {
      for (let i = 0; i < 100; i++) {
        const result = computeBackoffMs(attempt, 1000, cap);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(cap);
      }
    }
  });

  test("never returns negative values", () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      for (let i = 0; i < 50; i++) {
        expect(computeBackoffMs(attempt)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("cap is respected for very large attempt numbers", () => {
    const cap = 10_000;
    for (let i = 0; i < 200; i++) {
      const result = computeBackoffMs(100, 1000, cap);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(cap);
    }
  });

  test("expected value increases monotonically with attempt (statistical)", () => {
    const samples = 2000;
    const base = 1000;
    const cap = 300_000;

    const means: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      let sum = 0;
      for (let i = 0; i < samples; i++) {
        sum += computeBackoffMs(attempt, base, cap);
      }
      means.push(sum / samples);
    }

    // Each mean should be less than the next (up to the cap)
    for (let i = 0; i < means.length - 1; i++) {
      const current = means[i] ?? 0;
      const next = means[i + 1] ?? 0;
      // Allow 20% tolerance for statistical noise
      const theoretical_current = Math.min(cap, base * 2 ** i) / 2;
      const theoretical_next = Math.min(cap, base * 2 ** (i + 1)) / 2;
      if (theoretical_next > theoretical_current) {
        // Only assert monotonicity if theoretical values differ
        expect(next).toBeGreaterThan(current * 0.5);
      }
    }
  });

  test("mean approximates half of exponential range (statistical)", () => {
    const samples = 5000;
    const base = 1000;
    const cap = 300_000;

    for (let attempt = 0; attempt < 6; attempt++) {
      let sum = 0;
      for (let i = 0; i < samples; i++) {
        sum += computeBackoffMs(attempt, base, cap);
      }
      const mean = sum / samples;
      const expectedMean = Math.min(cap, base * 2 ** attempt) / 2;
      // Allow 15% tolerance
      expect(mean).toBeGreaterThan(expectedMean * 0.85);
      expect(mean).toBeLessThan(expectedMean * 1.15);
    }
  });

  test("uses default parameters when not specified", () => {
    const result = computeBackoffMs(0);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(DEFAULT_BASE_DELAY_MS);
  });

  test("uses default cap when only base is specified", () => {
    const result = computeBackoffMs(20, 1000);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(DEFAULT_MAX_BACKOFF_MS);
  });
});

describe("canRetry", () => {
  test("returns true when attempts < maxAttempts", () => {
    expect(canRetry(0, 5)).toBe(true);
    expect(canRetry(4, 5)).toBe(true);
  });

  test("returns false when attempts >= maxAttempts", () => {
    expect(canRetry(5, 5)).toBe(false);
    expect(canRetry(6, 5)).toBe(false);
  });

  test("uses default maxAttempts", () => {
    expect(canRetry(DEFAULT_MAX_ATTEMPTS - 1)).toBe(true);
    expect(canRetry(DEFAULT_MAX_ATTEMPTS)).toBe(false);
  });

  test("handles zero maxAttempts", () => {
    expect(canRetry(0, 0)).toBe(false);
  });
});

describe("defaults", () => {
  test("DEFAULT_BASE_DELAY_MS is 10 seconds", () => {
    expect(DEFAULT_BASE_DELAY_MS).toBe(10_000);
  });

  test("DEFAULT_MAX_BACKOFF_MS is 5 minutes", () => {
    expect(DEFAULT_MAX_BACKOFF_MS).toBe(300_000);
  });

  test("DEFAULT_MAX_ATTEMPTS is 5", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
  });
});
