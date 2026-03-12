/**
 * Tests for shared provider utilities.
 *
 * Covers buildOutcomeStats and diffArtifactBuffers — the shared helpers
 * used by all three provider implementations.
 */

import { describe, expect, test } from "bun:test";
import type { OutcomeStore } from "../core/outcome.js";
import { buildOutcomeStats, diffArtifactBuffers } from "./provider-utils.js";

// ---------------------------------------------------------------------------
// buildOutcomeStats
// ---------------------------------------------------------------------------

describe("buildOutcomeStats", () => {
  test("returns zeros when outcomes is undefined", async () => {
    const stats = await buildOutcomeStats(undefined);
    expect(stats.totalContributions).toBe(0);
    expect(stats.outcomeBreakdown).toEqual({
      accepted: 0,
      rejected: 0,
      crashed: 0,
      invalidated: 0,
    });
    expect(stats.acceptanceRate).toBe(0);
    expect(stats.byAgent).toEqual([]);
  });

  test("delegates to OutcomeStore.getStats and maps fields", async () => {
    const mockStore: Pick<OutcomeStore, "getStats"> = {
      getStats: async () => ({
        total: 10,
        accepted: 7,
        rejected: 2,
        crashed: 1,
        invalidated: 0,
        acceptanceRate: 0.7,
      }),
    };

    const stats = await buildOutcomeStats(mockStore as OutcomeStore);
    expect(stats.totalContributions).toBe(10);
    expect(stats.outcomeBreakdown.accepted).toBe(7);
    expect(stats.outcomeBreakdown.rejected).toBe(2);
    expect(stats.outcomeBreakdown.crashed).toBe(1);
    expect(stats.outcomeBreakdown.invalidated).toBe(0);
    expect(stats.acceptanceRate).toBe(0.7);
    expect(stats.byAgent).toEqual([]);
  });

  test("handles store with all zeros", async () => {
    const mockStore: Pick<OutcomeStore, "getStats"> = {
      getStats: async () => ({
        total: 0,
        accepted: 0,
        rejected: 0,
        crashed: 0,
        invalidated: 0,
        acceptanceRate: 0,
      }),
    };

    const stats = await buildOutcomeStats(mockStore as OutcomeStore);
    expect(stats.totalContributions).toBe(0);
    expect(stats.acceptanceRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// diffArtifactBuffers
// ---------------------------------------------------------------------------

describe("diffArtifactBuffers", () => {
  test("fetches both artifacts and returns UTF-8 strings", async () => {
    const getArtifact = async (cid: string, name: string): Promise<Buffer> => {
      if (cid === "parent-cid") return Buffer.from(`parent content of ${name}`);
      if (cid === "child-cid") return Buffer.from(`child content of ${name}`);
      throw new Error(`Unexpected CID: ${cid}`);
    };

    const result = await diffArtifactBuffers(getArtifact, "parent-cid", "child-cid", "readme.md");
    expect(result.parent).toBe("parent content of readme.md");
    expect(result.child).toBe("child content of readme.md");
  });

  test("handles empty buffers", async () => {
    const getArtifact = async (): Promise<Buffer> => Buffer.alloc(0);

    const result = await diffArtifactBuffers(getArtifact, "a", "b", "file.txt");
    expect(result.parent).toBe("");
    expect(result.child).toBe("");
  });

  test("handles binary content as UTF-8", async () => {
    const getArtifact = async (cid: string): Promise<Buffer> => {
      if (cid === "p") return Buffer.from([0xc3, 0xa9]); // é in UTF-8
      return Buffer.from([0xc3, 0xb6]); // ö in UTF-8
    };

    const result = await diffArtifactBuffers(getArtifact, "p", "c", "file.txt");
    expect(result.parent).toBe("é");
    expect(result.child).toBe("ö");
  });

  test("propagates errors from getArtifact", async () => {
    const getArtifact = async (): Promise<Buffer> => {
      throw new Error("Artifact not found");
    };

    await expect(diffArtifactBuffers(getArtifact, "a", "b", "file.txt")).rejects.toThrow(
      "Artifact not found",
    );
  });

  test("fetches both artifacts in parallel", async () => {
    const calls: string[] = [];
    const getArtifact = async (cid: string): Promise<Buffer> => {
      calls.push(cid);
      // Small delay to verify parallel execution
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Buffer.from(cid);
    };

    await diffArtifactBuffers(getArtifact, "parent", "child", "f");
    // Both should have been called (order may vary since they're parallel)
    expect(calls).toContain("parent");
    expect(calls).toContain("child");
    expect(calls.length).toBe(2);
  });
});
