/**
 * MCP tools for claim operations.
 *
 * grove_claim       — Create or renew a claim to prevent duplicate work
 * grove_release     — Release or complete a claim
 * grove_list_claims — List claims with optional filters
 *
 * All business logic is delegated to the shared operations layer.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { JsonValue } from "../../core/models.js";
import type { AgentOverrides } from "../../core/operations/agent.js";
import {
  claimOperation,
  listClaimsOperation,
  releaseOperation,
} from "../../core/operations/index.js";
import type { McpDeps } from "../deps.js";
import { toMcpResult, toOperationDeps } from "../operation-adapter.js";
import { agentSchema } from "../schemas.js";

const claimInputSchema = z.object({
  targetRef: z.string().describe("Reference to the work target (e.g., a CID or task identifier)"),
  agent: agentSchema,
  intentSummary: z.string().describe("What the agent intends to do with this claim"),
  leaseDurationMs: z
    .number()
    .int()
    .positive()
    .optional()
    .default(300_000)
    .describe("Lease duration in milliseconds (default: 5 minutes)"),
  context: z.record(z.string(), z.unknown()).optional().describe("Optional claim metadata"),
});

const releaseInputSchema = z.object({
  claimId: z.string().describe("ID of the claim to release or complete"),
  action: z
    .enum(["release", "complete"])
    .describe("Whether to release (give up) or complete (finished work) the claim"),
});

const listClaimsInputSchema = z.object({
  status: z
    .enum(["active", "released", "expired", "completed"])
    .optional()
    .describe("Filter by claim status"),
  agentId: z.string().optional().describe("Filter by agent ID"),
  targetRef: z.string().optional().describe("Filter by target reference"),
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerClaimTools(server: McpServer, deps: McpDeps): void {
  const opDeps = toOperationDeps(deps);

  // --- grove_claim --------------------------------------------------------
  server.registerTool(
    "grove_claim",
    {
      description:
        "Claim a work target to prevent duplicate effort. If the same agent already has an " +
        "active claim on the target, the lease is renewed. If a different agent has an active " +
        "claim, an error is returned. Claims expire automatically after the lease duration.",
      inputSchema: claimInputSchema,
    },
    async (args) => {
      const result = await claimOperation(
        {
          targetRef: args.targetRef,
          intentSummary: args.intentSummary,
          ...(args.leaseDurationMs !== undefined ? { leaseDurationMs: args.leaseDurationMs } : {}),
          ...(args.context !== undefined
            ? { context: args.context as Readonly<Record<string, JsonValue>> }
            : {}),
          agent: args.agent as AgentOverrides,
        },
        opDeps,
      );
      return toMcpResult(result);
    },
  );

  // --- grove_release ------------------------------------------------------
  server.registerTool(
    "grove_release",
    {
      description:
        "Release or complete an active claim. Use 'release' when giving up on the work, " +
        "or 'complete' when the work is finished.",
      inputSchema: releaseInputSchema,
    },
    async (args) => {
      const result = await releaseOperation(
        {
          claimId: args.claimId,
          action: args.action,
        },
        opDeps,
      );
      return toMcpResult(result);
    },
  );

  // --- grove_list_claims ---------------------------------------------------
  server.registerTool(
    "grove_list_claims",
    {
      description:
        "List claims with optional filters by status, agent, or target reference. " +
        "Returns claim summaries with count.",
      inputSchema: listClaimsInputSchema,
    },
    async (args) => {
      const result = await listClaimsOperation(
        {
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
          ...(args.targetRef !== undefined ? { targetRef: args.targetRef } : {}),
        },
        opDeps,
      );
      return toMcpResult(result);
    },
  );
}
