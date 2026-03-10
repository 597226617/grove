/**
 * E2E integration tests for the Grove CLI.
 *
 * Spawns the actual CLI binary to test the full dispatch pipeline:
 * argument parsing, store initialization, command execution, and exit codes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeContribution } from "../core/test-helpers.js";
import { initSqliteDb, SqliteContributionStore } from "../local/sqlite-store.js";

const CLI_PATH = join(import.meta.dir, "main.ts");

/** Run the CLI with given args in a working directory and return stdout, stderr, exitCode. */
async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

let tmpDir: string;
let groveDir: string;

/**
 * Set up a temp grove with a few contributions for testing.
 */
async function setupGrove(): Promise<void> {
  groveDir = join(tmpDir, ".grove");
  await mkdir(groveDir, { recursive: true });

  const dbPath = join(groveDir, "grove.db");

  const db = initSqliteDb(dbPath);
  const store = new SqliteContributionStore(db);

  // Seed some contributions
  const c1 = makeContribution({
    summary: "Initial schema design",
    tags: ["schema"],
  });
  const c2 = makeContribution({
    summary: "Add validation layer",
    createdAt: "2026-01-02T00:00:00Z",
  });

  await store.put(c1);
  await store.put(c2);

  store.close();
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "grove-e2e-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Help and unknown commands
// ---------------------------------------------------------------------------

describe("CLI dispatch", () => {
  test("--help prints usage and exits 0", async () => {
    const { stdout, exitCode } = await runCli(["--help"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("grove");
    expect(stdout).toContain("checkout");
    expect(stdout).toContain("frontier");
  });

  test("-h prints usage", async () => {
    const { stdout, exitCode } = await runCli(["-h"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("grove");
  });

  test("no args prints usage", async () => {
    const { stdout, exitCode } = await runCli([], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("grove");
  });

  test("unknown command exits 1", async () => {
    const { stderr, exitCode } = await runCli(["bogus"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown command");
  });

  test("unimplemented command exits 1", async () => {
    const { stderr, exitCode } = await runCli(["init"], tmpDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not yet implemented");
  });
});

// ---------------------------------------------------------------------------
// Commands that need a grove
// ---------------------------------------------------------------------------

describe("CLI commands (with grove)", () => {
  test("grove log works", async () => {
    await setupGrove();
    const { stdout, exitCode } = await runCli(["log"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Initial schema");
  });

  test("grove log --json works", async () => {
    await setupGrove();
    const { stdout, exitCode } = await runCli(["log", "--json"], tmpDir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("grove search works", async () => {
    await setupGrove();
    const { stdout, exitCode } = await runCli(["search", "--query", "schema"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("schema");
  });

  test("grove frontier works (empty is ok)", async () => {
    await setupGrove();
    const { stdout, exitCode } = await runCli(["frontier"], tmpDir);
    expect(exitCode).toBe(0);
    // May show recency data or "no frontier data"
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("grove tree works", async () => {
    await setupGrove();
    const { stdout, exitCode } = await runCli(["tree"], tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("*"); // DAG node marker
  });

  test("fails gracefully outside a grove", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "grove-empty-"));
    try {
      const { stderr, exitCode } = await runCli(["log"], emptyDir);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Not inside a grove");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
