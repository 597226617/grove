/**
 * Tests for NexusDataProvider lifecycle methods.
 *
 * Uses mock NexusClient and mock WorkspaceManager to test
 * createClaim, checkoutWorkspace, releaseClaim, cleanWorkspace.
 */

import { describe, expect, test } from "bun:test";
import type { Claim } from "../core/models.js";
import type { WorkspaceInfo, WorkspaceManager } from "../core/workspace.js";
import { WorkspaceStatus } from "../core/workspace.js";
import { MockNexusClient } from "../nexus/mock-client.js";
import { NexusDataProvider } from "./nexus-provider.js";

// ---------------------------------------------------------------------------
// Mock workspace manager
// ---------------------------------------------------------------------------

function makeMockWorkspaceManager(): WorkspaceManager & {
  readonly createdWorkspaces: Map<string, WorkspaceInfo>;
  readonly cleanedWorkspaces: Set<string>;
} {
  const createdWorkspaces = new Map<string, WorkspaceInfo>();
  const cleanedWorkspaces = new Set<string>();

  return {
    createdWorkspaces,
    cleanedWorkspaces,

    checkout: async (cid, _options) => {
      // Simulate failure for non-CID keys (like spawnIds)
      throw new Error(`Contribution not found: ${cid}`);
    },

    createBareWorkspace: async (key, options) => {
      const info: WorkspaceInfo = {
        cid: key,
        workspacePath: `/tmp/workspaces/${key}-${options.agent.agentId}`,
        agent: options.agent,
        status: WorkspaceStatus.Active,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      };
      createdWorkspaces.set(key, info);
      return info;
    },

    getWorkspace: async () => undefined,
    listWorkspaces: async () => [],
    cleanWorkspace: async (cid, agentId) => {
      cleanedWorkspaces.add(`${cid}:${agentId}`);
      return true;
    },
    markStale: async () => [],
    markWorkspaceStale: async () => {
      throw new Error("Not found");
    },
    touchWorkspace: async () => {
      throw new Error("Not found");
    },
    close: () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NexusDataProvider lifecycle", () => {
  function createProvider(withWorkspace = true) {
    const client = new MockNexusClient();
    const workspace = withWorkspace ? makeMockWorkspaceManager() : undefined;
    const provider = new NexusDataProvider({
      nexusConfig: { client, zoneId: "test" },
      workspaceManager: workspace,
    });
    return { provider, client, workspace };
  }

  test("createClaim creates a claim via NexusClaimStore", async () => {
    const { provider } = createProvider();

    const claim = await provider.createClaim({
      targetRef: "spawn-1",
      agent: { agentId: "agent-1" },
      intentSummary: "TUI-spawned: bash",
      leaseDurationMs: 300_000,
    });

    expect(claim.targetRef).toBe("spawn-1");
    expect(claim.agent.agentId).toBe("agent-1");
    expect(claim.status).toBe("active");
    expect(claim.intentSummary).toBe("TUI-spawned: bash");
  });

  test("checkoutWorkspace falls back to createBareWorkspace for spawnIds", async () => {
    const { provider, workspace } = createProvider();

    const path = await provider.checkoutWorkspace("spawn-1", { agentId: "agent-1" });

    expect(path).toContain("spawn-1");
    expect(path).toContain("agent-1");
    expect(workspace?.createdWorkspaces.has("spawn-1")).toBe(true);
  });

  test("checkoutWorkspace throws when workspace manager is not available", async () => {
    const { provider } = createProvider(false);

    await expect(provider.checkoutWorkspace("spawn-1", { agentId: "agent-1" })).rejects.toThrow(
      "Workspace manager not available",
    );
  });

  test("releaseClaim releases a claim", async () => {
    const { provider } = createProvider();

    // Create a claim first
    const claim = await provider.createClaim({
      targetRef: "spawn-2",
      agent: { agentId: "agent-2" },
      intentSummary: "test",
      leaseDurationMs: 300_000,
    });

    // Release it
    await provider.releaseClaim(claim.claimId);

    // Verify claim is no longer active
    const claims = await provider.getClaims({ status: "active" });
    const found = claims.find((c: Claim) => c.claimId === claim.claimId);
    expect(found).toBeUndefined();
  });

  test("cleanWorkspace delegates to workspace manager", async () => {
    const { provider, workspace } = createProvider();

    await provider.cleanWorkspace("spawn-1", "agent-1");

    expect(workspace?.cleanedWorkspaces.has("spawn-1:agent-1")).toBe(true);
  });

  test("cleanWorkspace is a no-op without workspace manager", async () => {
    const { provider } = createProvider(false);

    // Should not throw
    await provider.cleanWorkspace("spawn-1", "agent-1");
  });

  test("full lifecycle: create claim → checkout → release → clean", async () => {
    const { provider, workspace } = createProvider();

    // Step 1: Checkout workspace
    const workspacePath = await provider.checkoutWorkspace("spawn-life", {
      agentId: "agent-life",
    });
    expect(workspacePath).toContain("spawn-life");

    // Step 2: Create claim
    const claim = await provider.createClaim({
      targetRef: "spawn-life",
      agent: { agentId: "agent-life" },
      intentSummary: "lifecycle test",
      leaseDurationMs: 300_000,
      context: { workspacePath },
    });
    expect(claim.status).toBe("active");

    // Step 3: Release claim
    await provider.releaseClaim(claim.claimId);

    // Step 4: Clean workspace
    await provider.cleanWorkspace("spawn-life", "agent-life");
    expect(workspace?.cleanedWorkspaces.has("spawn-life:agent-life")).toBe(true);
  });
});
