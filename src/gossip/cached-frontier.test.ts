/**
 * Tests for the CachedFrontierCalculator decorator.
 *
 * Uses a mock FrontierCalculator and injected clock to verify
 * caching, TTL expiry, cache-key stability, and invalidation.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { Frontier, FrontierCalculator, FrontierQuery } from "../core/frontier.js";
import { CachedFrontierCalculator } from "./cached-frontier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal empty Frontier used as a base for test results. */
function emptyFrontier(): Frontier {
  return {
    byMetric: {},
    byAdoption: [],
    byRecency: [],
    byReviewScore: [],
    byReproduction: [],
  };
}

/**
 * Mock FrontierCalculator that counts calls per query key
 * and returns configurable results.
 */
class MockFrontierCalculator implements FrontierCalculator {
  /** Total number of compute() invocations. */
  callCount = 0;

  /** Per-query call counts keyed by JSON-serialized query (or "{}"). */
  readonly callsByQuery = new Map<string, number>();

  /** Last query passed to compute(). */
  lastQuery: FrontierQuery | undefined;

  /** If set, compute() returns this result. Otherwise returns emptyFrontier(). */
  result: Frontier = emptyFrontier();

  /** Map of query key -> result for multi-query scenarios. */
  private readonly resultsByQuery = new Map<string, Frontier>();

  /** Register a result for a specific query. */
  setResultForQuery(query: FrontierQuery | undefined, result: Frontier): void {
    const key = query ? JSON.stringify(query, Object.keys(query).sort()) : "{}";
    this.resultsByQuery.set(key, result);
  }

  async compute(query?: FrontierQuery): Promise<Frontier> {
    this.callCount++;
    this.lastQuery = query;

    const key = query ? JSON.stringify(query, Object.keys(query).sort()) : "{}";
    const prev = this.callsByQuery.get(key) ?? 0;
    this.callsByQuery.set(key, prev + 1);

    const specific = this.resultsByQuery.get(key);
    if (specific) return specific;
    return this.result;
  }
}

/** Simple controllable clock for deterministic time. */
function createClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CachedFrontierCalculator", () => {
  const TTL = 1000; // 1 second TTL for tests
  let inner: MockFrontierCalculator;
  let clock: ReturnType<typeof createClock>;
  let cached: CachedFrontierCalculator;

  beforeEach(() => {
    inner = new MockFrontierCalculator();
    clock = createClock(10_000); // start at t=10000 to avoid zero-edge-cases
    cached = new CachedFrontierCalculator(inner, TTL, clock.now);
  });

  // -----------------------------------------------------------------------
  // 1. Cache miss (first call)
  // -----------------------------------------------------------------------

  describe("cache miss (first call)", () => {
    it("delegates to the inner calculator", async () => {
      await cached.compute();
      expect(inner.callCount).toBe(1);
    });

    it("returns the computed result from inner", async () => {
      const frontier: Frontier = {
        ...emptyFrontier(),
        byRecency: [
          {
            cid: "abc",
            summary: "test",
            value: 42,
            contribution: {} as never,
          },
        ],
      };
      inner.result = frontier;

      const result = await cached.compute();
      expect(result).toBe(frontier);
    });

    it("delegates with query parameter", async () => {
      const query: FrontierQuery = { metric: "accuracy", limit: 5 };
      await cached.compute(query);
      expect(inner.callCount).toBe(1);
      expect(inner.lastQuery).toEqual(query);
    });

    it("delegates for undefined query", async () => {
      await cached.compute(undefined);
      expect(inner.callCount).toBe(1);
      expect(inner.lastQuery).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Cache hit (within TTL)
  // -----------------------------------------------------------------------

  describe("cache hit (within TTL)", () => {
    it("returns cached result without calling inner again", async () => {
      const frontier: Frontier = {
        ...emptyFrontier(),
        byAdoption: [
          {
            cid: "x",
            summary: "adopted",
            value: 10,
            contribution: {} as never,
          },
        ],
      };
      inner.result = frontier;

      const first = await cached.compute();
      clock.advance(TTL - 1); // still within TTL
      const second = await cached.compute();

      expect(inner.callCount).toBe(1);
      expect(second).toBe(first);
    });

    it("inner calculator is called only once for repeated calls", async () => {
      await cached.compute();
      clock.advance(100);
      await cached.compute();
      clock.advance(100);
      await cached.compute();
      clock.advance(100);
      await cached.compute();

      expect(inner.callCount).toBe(1);
    });

    it("returns cached result at exactly TTL - 1 ms", async () => {
      await cached.compute();
      clock.advance(TTL - 1);
      await cached.compute();

      expect(inner.callCount).toBe(1);
    });

    it("returns cached result for query within TTL", async () => {
      const query: FrontierQuery = { platform: "github" };
      await cached.compute(query);
      clock.advance(500);
      await cached.compute(query);

      expect(inner.callCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Cache expiry (after TTL)
  // -----------------------------------------------------------------------

  describe("cache expiry (after TTL)", () => {
    it("recomputes after TTL expires", async () => {
      await cached.compute();
      clock.advance(TTL); // exactly at TTL boundary
      await cached.compute();

      expect(inner.callCount).toBe(2);
    });

    it("recomputes well after TTL", async () => {
      await cached.compute();
      clock.advance(TTL * 10);
      await cached.compute();

      expect(inner.callCount).toBe(2);
    });

    it("returns fresh result after expiry", async () => {
      const oldFrontier: Frontier = {
        ...emptyFrontier(),
        byRecency: [{ cid: "old", summary: "old entry", value: 1, contribution: {} as never }],
      };
      const newFrontier: Frontier = {
        ...emptyFrontier(),
        byRecency: [{ cid: "new", summary: "new entry", value: 2, contribution: {} as never }],
      };

      inner.result = oldFrontier;
      const first = await cached.compute();
      expect(first).toBe(oldFrontier);

      clock.advance(TTL);
      inner.result = newFrontier;
      const second = await cached.compute();
      expect(second).toBe(newFrontier);
      expect(second).not.toBe(first);
    });

    it("inner calculator is called again after expiry for query", async () => {
      const query: FrontierQuery = { tags: ["ml"] };
      await cached.compute(query);
      clock.advance(TTL + 1);
      await cached.compute(query);

      expect(inner.callCount).toBe(2);
    });

    it("refreshed entry resets TTL", async () => {
      await cached.compute(); // t=10000, fetchedAt=10000
      clock.advance(TTL); // t=11000, expired
      await cached.compute(); // t=11000, fetchedAt=11000 (recomputed)
      expect(inner.callCount).toBe(2);

      clock.advance(TTL - 1); // t=11999, still within new TTL
      await cached.compute();
      expect(inner.callCount).toBe(2); // still cached

      clock.advance(1); // t=12000, expired again
      await cached.compute();
      expect(inner.callCount).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Different queries
  // -----------------------------------------------------------------------

  describe("different queries", () => {
    it("different query params get separate cache entries", async () => {
      const queryA: FrontierQuery = { metric: "accuracy" };
      const queryB: FrontierQuery = { metric: "latency" };

      const frontierA: Frontier = {
        ...emptyFrontier(),
        byRecency: [{ cid: "a", summary: "accuracy", value: 1, contribution: {} as never }],
      };
      const frontierB: Frontier = {
        ...emptyFrontier(),
        byRecency: [{ cid: "b", summary: "latency", value: 2, contribution: {} as never }],
      };

      inner.setResultForQuery(queryA, frontierA);
      inner.setResultForQuery(queryB, frontierB);

      const resultA = await cached.compute(queryA);
      const resultB = await cached.compute(queryB);

      expect(inner.callCount).toBe(2);
      expect(resultA).toBe(frontierA);
      expect(resultB).toBe(frontierB);
    });

    it("undefined query and empty-object query are separate from queries with fields", async () => {
      const query: FrontierQuery = { limit: 5 };
      await cached.compute(undefined);
      await cached.compute(query);

      expect(inner.callCount).toBe(2);
    });

    it("cache key is stable - same query hits same cache", async () => {
      const query: FrontierQuery = { metric: "f1", platform: "github" };
      await cached.compute(query);
      // Same query object content, different reference
      const queryClone: FrontierQuery = { metric: "f1", platform: "github" };
      await cached.compute(queryClone);

      expect(inner.callCount).toBe(1);
    });

    it("cache key is stable regardless of property order", async () => {
      const queryA: FrontierQuery = { metric: "f1", platform: "github" };
      // Build with different property insertion order
      const queryB: FrontierQuery = { platform: "github", metric: "f1" };

      await cached.compute(queryA);
      await cached.compute(queryB);

      // Both should hit the same cache entry because keys are sorted
      expect(inner.callCount).toBe(1);
    });

    it("caching one query does not affect another", async () => {
      const queryA: FrontierQuery = { metric: "accuracy" };
      const queryB: FrontierQuery = { metric: "latency" };

      await cached.compute(queryA);
      clock.advance(TTL); // expire queryA
      await cached.compute(queryB); // first call for queryB

      expect(inner.callsByQuery.get(JSON.stringify(queryA, Object.keys(queryA).sort()))).toBe(1);
      expect(inner.callsByQuery.get(JSON.stringify(queryB, Object.keys(queryB).sort()))).toBe(1);
    });

    it("expiry is per-query, not global", async () => {
      const queryA: FrontierQuery = { metric: "accuracy" };
      const queryB: FrontierQuery = { metric: "latency" };

      await cached.compute(queryA); // t=10000
      clock.advance(TTL / 2); // t=10500
      await cached.compute(queryB); // t=10500

      clock.advance(TTL / 2); // t=11000, queryA expired, queryB still valid
      await cached.compute(queryA); // recompute
      await cached.compute(queryB); // cached

      const keyA = JSON.stringify(queryA, Object.keys(queryA).sort());
      const keyB = JSON.stringify(queryB, Object.keys(queryB).sort());
      expect(inner.callsByQuery.get(keyA)).toBe(2); // called twice
      expect(inner.callsByQuery.get(keyB)).toBe(1); // called once
    });
  });

  // -----------------------------------------------------------------------
  // 5. invalidate()
  // -----------------------------------------------------------------------

  describe("invalidate()", () => {
    it("clears all cached entries", async () => {
      await cached.compute();
      await cached.compute({ metric: "x" });
      expect(cached.cacheSize).toBe(2);

      cached.invalidate();
      expect(cached.cacheSize).toBe(0);
    });

    it("next call after invalidate recomputes", async () => {
      await cached.compute();
      expect(inner.callCount).toBe(1);

      cached.invalidate();
      await cached.compute();
      expect(inner.callCount).toBe(2);
    });

    it("invalidate clears all query-specific entries", async () => {
      await cached.compute({ metric: "a" });
      await cached.compute({ metric: "b" });
      await cached.compute({ metric: "c" });

      cached.invalidate();

      await cached.compute({ metric: "a" });
      await cached.compute({ metric: "b" });
      await cached.compute({ metric: "c" });

      // 3 initial + 3 after invalidate
      expect(inner.callCount).toBe(6);
    });

    it("invalidate within TTL forces recompute", async () => {
      await cached.compute();
      clock.advance(TTL / 2); // still within TTL
      cached.invalidate();
      await cached.compute();

      expect(inner.callCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 6. cacheSize
  // -----------------------------------------------------------------------

  describe("cacheSize", () => {
    it("starts at zero", () => {
      expect(cached.cacheSize).toBe(0);
    });

    it("reports 1 after a single compute", async () => {
      await cached.compute();
      expect(cached.cacheSize).toBe(1);
    });

    it("reports correct count for multiple distinct queries", async () => {
      await cached.compute();
      await cached.compute({ metric: "a" });
      await cached.compute({ platform: "github" });
      expect(cached.cacheSize).toBe(3);
    });

    it("does not increase for repeated same query", async () => {
      await cached.compute({ metric: "x" });
      await cached.compute({ metric: "x" });
      await cached.compute({ metric: "x" });
      expect(cached.cacheSize).toBe(1);
    });

    it("stays same after expiry and recompute of existing key", async () => {
      await cached.compute();
      expect(cached.cacheSize).toBe(1);

      clock.advance(TTL);
      await cached.compute(); // recompute replaces the entry
      expect(cached.cacheSize).toBe(1);
    });

    it("returns 0 after invalidate", async () => {
      await cached.compute();
      await cached.compute({ metric: "a" });
      cached.invalidate();
      expect(cached.cacheSize).toBe(0);
    });
  });
});
