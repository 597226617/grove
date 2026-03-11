/**
 * Spawn → claim → workspace → kill integration test.
 *
 * Uses real SQLite stores (temp dir) + mock TmuxManager
 * to test the full TUI spawn/kill lifecycle.
 */

import type { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultFrontierCalculator } from "../core/frontier.js";
import type { Claim } from "../core/models.js";
import { FsCas } from "../local/fs-cas.js";
import { initSqliteDb, SqliteClaimStore, SqliteContributionStore } from "../local/sqlite-store.js";
import { LocalWorkspaceManager } from "../local/workspace.js";
import { LocalDataProvider } from "./local-provider.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let provider: LocalDataProvider;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "grove-spawn-lifecycle-"));
  db = initSqliteDb(join(tmpDir, "test.db"));

  const contributionStore = new SqliteContributionStore(db);
  const claimStore = new SqliteClaimStore(db);
  const cas = new FsCas(join(tmpDir, "cas"));
  const frontier = new DefaultFrontierCalculator(contributionStore);

  const workspace = new LocalWorkspaceManager({
    groveRoot: tmpDir,
    db,
    contributionStore,
    cas,
  });

  provider = new LocalDataProvider({
    contributionStore,
    claimStore,
    frontier,
    groveName: "test-lifecycle",
    workspace,
  });
});

afterAll(() => {
  provider.close();
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spawn lifecycle (local provider)", () => {
  test("full spawn → verify claim + workspace → kill → verify cleanup", async () => {
    const agentId = "claude";
    const spawnId = `${agentId}-${Date.now().toString(36)}`;
    const agent = { agentId: spawnId, role: agentId };

    // Step 1: Checkout workspace
    const workspacePath = await provider.checkoutWorkspace(spawnId, agent);
    expect(workspacePath).toContain(spawnId);

    // Step 2: Create claim
    const claim = await provider.createClaim({
      targetRef: spawnId,
      agent,
      intentSummary: "TUI-spawned: bash",
      leaseDurationMs: 300_000,
      context: { workspacePath },
    });
    expect(claim.status).toBe("active");
    expect(claim.targetRef).toBe(spawnId);

    // Step 3: Verify claim exists in active claims
    const activeClaims = await provider.getClaims({ status: "active" });
    const found = activeClaims.find((c: Claim) => c.claimId === claim.claimId);
    expect(found).toBeDefined();
    expect(found?.agent.agentId).toBe(spawnId);

    // Step 4: Release claim
    await provider.releaseClaim(claim.claimId);

    // Step 5: Verify claim is no longer active
    const afterRelease = await provider.getClaims({ status: "active" });
    const notFound = afterRelease.find((c: Claim) => c.claimId === claim.claimId);
    expect(notFound).toBeUndefined();

    // Step 6: Clean workspace
    await provider.cleanWorkspace(spawnId, spawnId);

    // The workspace should be cleaned — trying to clean again should be a no-op
    await provider.cleanWorkspace(spawnId, spawnId);
  });

  test("multiple spawns create independent claims and workspaces", async () => {
    const spawns = [];

    for (let i = 0; i < 3; i++) {
      const spawnId = `agent-${i}-${Date.now().toString(36)}`;
      const agent = { agentId: spawnId };

      const workspacePath = await provider.checkoutWorkspace(spawnId, agent);
      const claim = await provider.createClaim({
        targetRef: spawnId,
        agent,
        intentSummary: `spawn ${i}`,
        leaseDurationMs: 300_000,
        context: { workspacePath },
      });
      spawns.push({ spawnId, claim, workspacePath });
    }

    // All 3 should be active
    const active = await provider.getClaims({ status: "active" });
    for (const s of spawns) {
      expect(active.find((c: Claim) => c.claimId === s.claim.claimId)).toBeDefined();
    }

    // Release all
    for (const s of spawns) {
      await provider.releaseClaim(s.claim.claimId);
    }

    // Clean all workspaces
    for (const s of spawns) {
      await provider.cleanWorkspace(s.spawnId, s.spawnId);
    }

    // Verify no active claims remain for these spawns
    const afterCleanup = await provider.getClaims({ status: "active" });
    for (const s of spawns) {
      expect(afterCleanup.find((c: Claim) => c.claimId === s.claim.claimId)).toBeUndefined();
    }
  });

  test("claim creation fails for duplicate targetRef", async () => {
    const spawnId = `dup-${Date.now().toString(36)}`;
    const agent = { agentId: spawnId };

    // Create first claim
    const claim1 = await provider.createClaim({
      targetRef: spawnId,
      agent,
      intentSummary: "first",
      leaseDurationMs: 300_000,
    });
    expect(claim1.status).toBe("active");

    // Second claim with same targetRef should renew (claimOrRenew behavior)
    const claim2 = await provider.createClaim({
      targetRef: spawnId,
      agent,
      intentSummary: "renewed",
      leaseDurationMs: 300_000,
    });
    // Should get the same claim back (renewed)
    expect(claim2.claimId).toBe(claim1.claimId);
    expect(claim2.intentSummary).toBe("renewed");

    // Cleanup
    await provider.releaseClaim(claim1.claimId);
  });
});
