/**
 * Grove CLI — command-line interface for the contribution graph.
 *
 * Dispatches subcommands using parseArgs tokens for two-pass parsing:
 * global options are parsed first, then the subcommand handler parses
 * its own flags.
 *
 * Commands:
 *   grove init          — Create a new grove
 *   grove contribute    — Submit a contribution
 *   grove claim         — Claim work
 *   grove release       — Release a claim
 *   grove checkout      — Materialize contribution artifacts
 *   grove frontier      — Show current frontier
 *   grove search        — Search contributions
 *   grove log           — Recent contributions
 *   grove tree          — DAG visualization
 */

import { parseArgs } from "node:util";
import { parseCheckoutArgs, runCheckout } from "./commands/checkout.js";
import { parseFrontierArgs, runFrontier } from "./commands/frontier.js";
import { parseLogArgs, runLog } from "./commands/log.js";
import { parseSearchArgs, runSearch } from "./commands/search.js";
import { parseTreeArgs, runTree } from "./commands/tree.js";
import { initCliDeps } from "./context.js";

/** Command metadata for help text and dispatch. */
interface CommandEntry {
  readonly usage: string;
  readonly description: string;
}

const COMMANDS: ReadonlyMap<string, CommandEntry> = new Map([
  ["init", { usage: "init [name]", description: "Create a new grove" }],
  ["contribute", { usage: "contribute", description: "Submit a contribution" }],
  ["claim", { usage: "claim <target>", description: "Claim work to prevent duplication" }],
  ["release", { usage: "release <claim-id>", description: "Release a claim" }],
  [
    "checkout",
    { usage: "checkout <cid> --to <dir>", description: "Materialize contribution artifacts" },
  ],
  ["frontier", { usage: "frontier [--metric <name>]", description: "Show current frontier" }],
  ["search", { usage: "search [--query <text>]", description: "Search contributions" }],
  ["log", { usage: "log [-n <count>]", description: "Recent contributions" }],
  ["tree", { usage: "tree [--from <cid>]", description: "DAG visualization" }],
]);

function printUsage(): void {
  const lines = ["grove — asynchronous multi-agent contribution graph", "", "Usage:"];
  for (const [, meta] of COMMANDS) {
    lines.push(`  grove ${meta.usage.padEnd(30)} ${meta.description}`);
  }
  lines.push("", "Options:", "  --help, -h                  Show this help message");
  console.log(lines.join("\n"));
}

/**
 * Parse global options and extract the subcommand + its args.
 *
 * Uses parseArgs with tokens to split argv into:
 * - Global flags (--help, --version)
 * - Subcommand name (first positional)
 * - Subcommand args (everything after the subcommand)
 */
function parseGlobal(argv: string[]): {
  help: boolean;
  subcommand: string;
  subArgs: string[];
} {
  const { tokens } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  const helpToken = tokens.find(
    (t) => t.kind === "option" && (t.name === "help" || t.name === "h"),
  );
  const firstPos = tokens.find((t) => t.kind === "positional");

  if (!firstPos) {
    return { help: helpToken !== undefined, subcommand: "", subArgs: [] };
  }

  return {
    help: helpToken !== undefined,
    subcommand: firstPos.value,
    subArgs: argv.slice(firstPos.index + 1),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { help, subcommand, subArgs } = parseGlobal(argv);

  if (help || !subcommand) {
    printUsage();
    return;
  }

  // Commands that don't need a grove context
  // TODO: init, contribute, claim, release (issues #11, #12)
  if (
    subcommand === "init" ||
    subcommand === "contribute" ||
    subcommand === "claim" ||
    subcommand === "release"
  ) {
    console.error(`grove: '${subcommand}' is not yet implemented.`);
    process.exit(1);
  }

  // Commands that need a grove context
  const STORE_COMMANDS = new Set(["checkout", "frontier", "search", "log", "tree"]);

  if (!STORE_COMMANDS.has(subcommand) && !COMMANDS.has(subcommand)) {
    console.error(`grove: unknown command '${subcommand}'. Run 'grove --help' for usage.`);
    process.exit(1);
  }

  const deps = initCliDeps(process.cwd());
  try {
    switch (subcommand) {
      case "log": {
        const options = parseLogArgs(subArgs);
        await runLog(options, deps);
        break;
      }
      case "search": {
        const options = parseSearchArgs(subArgs);
        await runSearch(options, deps);
        break;
      }
      case "frontier": {
        const options = parseFrontierArgs(subArgs);
        await runFrontier(options, deps);
        break;
      }
      case "checkout": {
        const options = parseCheckoutArgs(subArgs);
        await runCheckout(options, deps);
        break;
      }
      case "tree": {
        const options = parseTreeArgs(subArgs);
        await runTree(options, deps);
        break;
      }
      default:
        console.error(`grove: unknown command '${subcommand}'. Run 'grove --help' for usage.`);
        process.exit(1);
    }
  } finally {
    deps.close();
  }
}

main().catch((err) => {
  console.error(`grove: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
