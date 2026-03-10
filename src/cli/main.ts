/**
 * Grove CLI — command-line interface for the contribution graph.
 *
 * Dispatches subcommands to dedicated handlers. Each command parses
 * its own arguments via `parseArgs` from `node:util`.
 *
 * Global flags (--help, --version, --verbose) are handled before dispatch.
 */

/** Command handler type — receives the remaining args after the subcommand name. */
type CommandHandler = (args: readonly string[]) => Promise<void>;

/** A registered CLI command. */
interface Command {
  readonly name: string;
  readonly description: string;
  readonly handler: CommandHandler;
}

/**
 * Command registry.
 *
 * Handlers use dynamic imports to avoid loading heavy dependencies
 * (SQLite, BLAKE3, Zod) for simple commands like --help and --version.
 */
const COMMANDS: readonly Command[] = [
  {
    name: "init",
    description: "Create a new grove",
    handler: async (args) => {
      const { handleInit } = await import("./commands/init.js");
      await handleInit(args);
    },
  },
  {
    name: "contribute",
    description: "Submit a contribution",
    handler: async (args) => {
      const { handleContribute } = await import("./commands/contribute.js");
      await handleContribute(args);
    },
  },
];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const first = args[0];

  // Global flags — handled before dispatch
  if (!first || first === "--help" || first === "-h") {
    printUsage();
    return;
  }

  if (first === "--version" || first === "-v") {
    console.log("grove 0.1.0");
    return;
  }

  // Find command
  const command = COMMANDS.find((c) => c.name === first);
  if (!command) {
    console.error(`grove: unknown command '${first}'. Run 'grove --help' for usage.`);
    process.exit(1);
  }

  // Dispatch with centralized error handling
  await command.handler(args.slice(1));
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printUsage(): void {
  const lines = ["grove — asynchronous multi-agent contribution graph", "", "Usage:"];

  for (const cmd of COMMANDS) {
    const padded = `  grove ${cmd.name}`.padEnd(30);
    lines.push(`${padded}${cmd.description}`);
  }

  // Future commands (not yet implemented)
  const futureCommands = [
    ["claim <target>", "Claim work to prevent duplication"],
    ["release <claim-id>", "Release a claim"],
    ["checkout <cid>", "Materialize contribution artifacts"],
    ["frontier", "Show current frontier"],
    ["search [query]", "Search contributions"],
    ["log", "Recent contributions"],
    ["tree", "DAG visualization"],
  ];

  for (const [name, desc] of futureCommands) {
    const padded = `  grove ${name}`.padEnd(30);
    lines.push(`${padded}${desc} (coming soon)`);
  }

  lines.push("");
  lines.push("Options:");
  lines.push("  --help, -h                  Show this help message");
  lines.push("  --version, -v               Show version");

  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Centralized error handling
// ---------------------------------------------------------------------------

main().catch((err: unknown) => {
  // Check for --verbose in original args for stack trace display
  const verbose = process.argv.includes("--verbose");

  if (err instanceof Error) {
    console.error(`grove: ${err.message}`);
    if (verbose && err.stack) {
      console.error(err.stack);
    }
  } else {
    console.error(`grove: unexpected error: ${String(err)}`);
  }

  process.exit(1);
});
