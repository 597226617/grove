/**
 * grove checkout — materialize a contribution's artifacts into a directory.
 *
 * Usage:
 *   grove checkout blake3:abc123 --to ./workspace/
 *   grove checkout --frontier throughput --to ./workspace/
 */

import { parseArgs } from "node:util";

import type { CliDeps, Writer } from "../context.js";
import { truncateCid } from "../format.js";

export interface CheckoutOptions {
  readonly cid?: string | undefined;
  readonly frontierMetric?: string | undefined;
  readonly to: string;
  readonly agent: string;
}

export function parseCheckoutArgs(argv: string[]): CheckoutOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      to: { type: "string" },
      frontier: { type: "string" },
      agent: { type: "string", default: "cli-user" },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.to === undefined) {
    throw new Error("Missing required --to <directory> option.");
  }

  const cid = positionals[0];
  const frontierMetric = values.frontier;

  if (cid === undefined && frontierMetric === undefined) {
    throw new Error("Provide a CID positional argument or --frontier <metric>.");
  }

  if (cid !== undefined && frontierMetric !== undefined) {
    throw new Error("Provide either a CID or --frontier, not both.");
  }

  return {
    cid,
    frontierMetric,
    to: values.to,
    agent: values.agent ?? "cli-user",
  };
}

export async function runCheckout(
  options: CheckoutOptions,
  deps: CliDeps,
  writer: Writer = console.log,
): Promise<void> {
  let targetCid: string;

  if (options.cid !== undefined) {
    targetCid = options.cid;
  } else {
    // Resolve CID from frontier metric
    const frontier = await deps.frontier.compute({ metric: options.frontierMetric, limit: 1 });
    const metricEntries = options.frontierMetric
      ? frontier.byMetric[options.frontierMetric]
      : undefined;

    if (metricEntries === undefined || metricEntries.length === 0) {
      throw new Error(`No frontier entries found for metric '${options.frontierMetric}'.`);
    }

    const best = metricEntries[0];
    if (best === undefined) {
      throw new Error(`No frontier entries found for metric '${options.frontierMetric}'.`);
    }
    targetCid = best.cid;
    writer(`Resolved frontier best for '${options.frontierMetric}': ${truncateCid(targetCid)}`);
  }

  // Verify contribution exists
  const contribution = await deps.store.get(targetCid);
  if (contribution === undefined) {
    throw new Error(`Contribution '${targetCid}' not found.`);
  }

  const workspace = await deps.workspace.checkout(targetCid, {
    agent: { agentId: options.agent },
  });

  writer(`Checked out ${truncateCid(targetCid)} to ${workspace.workspacePath}`);
  writer(`  Kind: ${contribution.kind}`);
  writer(`  Summary: ${contribution.summary}`);

  const artifactCount = Object.keys(contribution.artifacts).length;
  writer(`  Artifacts: ${artifactCount}`);
}
