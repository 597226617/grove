#!/usr/bin/env bun
/**
 * Grove MCP server entry point — stdio transport.
 *
 * Discovers the .grove directory, initializes stores, creates the MCP server,
 * and connects it to a StdioServerTransport. Designed to be spawned by
 * Claude Code, Codex, Cline, Goose, Copilot, or any MCP-compatible agent.
 *
 * Usage:
 *   grove-mcp                    # auto-discover .grove in cwd or parent dirs
 *   GROVE_DIR=/path grove-mcp    # explicit grove directory
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { findGroveDir } from "../cli/context.js";
import { TopologyRouter } from "../core/topology-router.js";
import { createLocalRuntime } from "../local/runtime.js";
import type { McpDeps } from "./deps.js";
import { createMcpServer } from "./server.js";

// --- Initialization (eager — catches config errors at startup) ------------

const groveOverride = process.env.GROVE_DIR ?? undefined;
const cwd = process.cwd();

let deps: McpDeps;
let close: () => void;

try {
  const groveDir = groveOverride ?? findGroveDir(cwd);
  if (groveDir === undefined) {
    throw new Error("Not inside a grove. Run 'grove init' to create one, or set GROVE_DIR.");
  }

  const runtime = createLocalRuntime({
    groveDir,
    frontierCacheTtlMs: 5_000,
    workspace: true,
    parseContract: true,
  });

  // Note: creditsService is intentionally omitted. InMemoryCreditsService is
  // not durable — balances and reservations are lost on restart. Bounties still
  // work (persisted in SQLite) but credit enforcement is skipped until a
  // persistent CreditsService (e.g., NexusPay) is configured.
  if (!runtime.workspace) {
    throw new Error("Workspace manager failed to initialize");
  }
  // Wire EventBus + TopologyRouter for IPC when topology exists.
  // In Nexus mode, uses NexusEventBus (VFS-backed); in local mode, uses LocalEventBus.
  let eventBus: import("../core/event-bus.js").EventBus | undefined;
  let topologyRouter: TopologyRouter | undefined;

  if (runtime.contract?.topology) {
    const nexusUrl = process.env.GROVE_NEXUS_URL;
    if (nexusUrl) {
      // Nexus mode — use VFS-backed EventBus for cross-process IPC
      const { NexusEventBus } = await import("../nexus/nexus-event-bus.js");
      const { NexusHttpClient } = await import("../nexus/nexus-http-client.js");
      const apiKey = process.env.NEXUS_API_KEY;
      const nexusClient = new NexusHttpClient({
        url: nexusUrl,
        ...(apiKey ? { apiKey } : {}),
      });
      const zoneId = process.env.GROVE_ZONE_ID ?? "default";
      eventBus = new NexusEventBus(nexusClient, zoneId);
    } else {
      // Local mode — use in-process EventBus (same process only)
      const { LocalEventBus } = await import("../core/local-event-bus.js");
      eventBus = new LocalEventBus();
    }
    topologyRouter = new TopologyRouter(runtime.contract.topology, eventBus);
  }

  deps = {
    contributionStore: runtime.contributionStore,
    claimStore: runtime.claimStore,
    bountyStore: runtime.bountyStore,
    cas: runtime.cas,
    frontier: runtime.frontier,
    workspace: runtime.workspace,
    contract: runtime.contract,
    onContributionWrite: runtime.onContributionWrite,
    workspaceBoundary: runtime.groveRoot,
    ...(eventBus ? { eventBus } : {}),
    ...(topologyRouter ? { topologyRouter } : {}),
  };
  close = () => {
    eventBus?.close();
    runtime.close();
  };
} catch (error) {
  // Write to stderr (stdout is reserved for MCP JSON-RPC)
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`grove-mcp: ${message}\n`);
  process.exit(1);
}

// --- Server setup ---------------------------------------------------------

const server = await createMcpServer(deps);
const transport = new StdioServerTransport();

await server.connect(transport);

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  await server.close();
  close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
