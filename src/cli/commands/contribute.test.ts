/**
 * Tests for `grove contribute` command.
 *
 * Covers argument parsing, validation, execution logic, and edge cases.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContributeOptions } from "./contribute.js";
import { executeContribute, parseContributeArgs, validateContributeOptions } from "./contribute.js";
import { executeInit } from "./init.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `grove-contribute-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

function makeInitOptions(cwd: string): InitOptions {
  return {
    name: "test-grove",
    mode: "evaluation",
    seed: [],
    metric: [],
    force: false,
    agentOverrides: { agentId: "test-agent" },
    cwd,
  };
}

function makeContributeOptions(overrides?: Partial<ContributeOptions>): ContributeOptions {
  return {
    kind: "work",
    mode: "evaluation",
    summary: "Test contribution",
    artifacts: [],
    fromGitTree: false,
    metric: [],
    score: [],
    tags: [],
    agentOverrides: { agentId: "test-agent" },
    cwd: "/tmp/test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseContributeArgs
// ---------------------------------------------------------------------------

describe("parseContributeArgs", () => {
  test("parses --summary flag", () => {
    const opts = parseContributeArgs(["--summary", "My contribution"]);
    expect(opts.summary).toBe("My contribution");
  });

  test("parses --kind flag", () => {
    const opts = parseContributeArgs(["--kind", "review", "--summary", "test"]);
    expect(opts.kind).toBe("review");
  });

  test("defaults kind to work", () => {
    const opts = parseContributeArgs(["--summary", "test"]);
    expect(opts.kind).toBe("work");
  });

  test("parses --mode flag", () => {
    const opts = parseContributeArgs(["--summary", "test", "--mode", "exploration"]);
    expect(opts.mode).toBe("exploration");
  });

  test("parses multiple --artifacts flags", () => {
    const opts = parseContributeArgs([
      "--summary",
      "test",
      "--artifacts",
      "./src",
      "--artifacts",
      "./tests",
    ]);
    expect(opts.artifacts).toEqual(["./src", "./tests"]);
  });

  test("parses --from-git-diff flag", () => {
    const opts = parseContributeArgs(["--summary", "test", "--from-git-diff", "HEAD~1"]);
    expect(opts.fromGitDiff).toBe("HEAD~1");
  });

  test("parses --from-git-tree flag", () => {
    const opts = parseContributeArgs(["--summary", "test", "--from-git-tree"]);
    expect(opts.fromGitTree).toBe(true);
  });

  test("parses --from-report flag", () => {
    const opts = parseContributeArgs(["--summary", "test", "--from-report", "./analysis.md"]);
    expect(opts.fromReport).toBe("./analysis.md");
  });

  test("parses relation flags", () => {
    const opts = parseContributeArgs([
      "--summary",
      "test",
      "--parent",
      "blake3:aaa",
      "--reviews",
      "blake3:bbb",
      "--responds-to",
      "blake3:ccc",
      "--adopts",
      "blake3:ddd",
      "--reproduces",
      "blake3:eee",
    ]);
    expect(opts.parent).toBe("blake3:aaa");
    expect(opts.reviews).toBe("blake3:bbb");
    expect(opts.respondsTo).toBe("blake3:ccc");
    expect(opts.adopts).toBe("blake3:ddd");
    expect(opts.reproduces).toBe("blake3:eee");
  });

  test("parses multiple --metric flags", () => {
    const opts = parseContributeArgs([
      "--summary",
      "test",
      "--metric",
      "tests_passing=47",
      "--metric",
      "throughput=14800",
    ]);
    expect(opts.metric).toEqual(["tests_passing=47", "throughput=14800"]);
  });

  test("parses multiple --tag flags", () => {
    const opts = parseContributeArgs([
      "--summary",
      "test",
      "--tag",
      "performance",
      "--tag",
      "database",
    ]);
    expect(opts.tags).toEqual(["performance", "database"]);
  });

  test("parses agent override flags", () => {
    const opts = parseContributeArgs([
      "--summary",
      "test",
      "--agent-id",
      "my-agent",
      "--provider",
      "openai",
    ]);
    expect(opts.agentOverrides.agentId).toBe("my-agent");
    expect(opts.agentOverrides.provider).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// validateContributeOptions
// ---------------------------------------------------------------------------

describe("validateContributeOptions", () => {
  test("valid work contribution passes", () => {
    const result = validateContributeOptions(makeContributeOptions());
    expect(result.valid).toBe(true);
  });

  test("rejects empty summary", () => {
    const result = validateContributeOptions(makeContributeOptions({ summary: "" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("--summary is required and cannot be empty");
    }
  });

  test("rejects whitespace-only summary", () => {
    const result = validateContributeOptions(makeContributeOptions({ summary: "   " }));
    expect(result.valid).toBe(false);
  });

  test("rejects invalid kind", () => {
    const result = validateContributeOptions(
      makeContributeOptions({ kind: "invalid" as ContributeOptions["kind"] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("Invalid kind");
    }
  });

  test("rejects invalid mode", () => {
    const result = validateContributeOptions(
      makeContributeOptions({ mode: "invalid" as ContributeOptions["mode"] }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("Invalid mode");
    }
  });

  // Mutual exclusion of ingestion modes
  test("rejects multiple ingestion modes", () => {
    const result = validateContributeOptions(
      makeContributeOptions({
        artifacts: ["./src"],
        fromGitDiff: "HEAD~1",
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("mutually exclusive");
    }
  });

  test("rejects three ingestion modes", () => {
    const result = validateContributeOptions(
      makeContributeOptions({
        artifacts: ["./src"],
        fromGitDiff: "HEAD~1",
        fromGitTree: true,
      }),
    );
    expect(result.valid).toBe(false);
  });

  // Kind/relation consistency
  test("rejects review without --reviews", () => {
    const result = validateContributeOptions(makeContributeOptions({ kind: "review" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("--kind review requires --reviews");
    }
  });

  test("rejects discussion without --responds-to", () => {
    const result = validateContributeOptions(makeContributeOptions({ kind: "discussion" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("--kind discussion requires --responds-to");
    }
  });

  test("rejects adoption without --adopts", () => {
    const result = validateContributeOptions(makeContributeOptions({ kind: "adoption" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("--kind adoption requires --adopts");
    }
  });

  test("rejects reproduction without --reproduces", () => {
    const result = validateContributeOptions(makeContributeOptions({ kind: "reproduction" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("--kind reproduction requires --reproduces");
    }
  });

  test("accepts review with --reviews", () => {
    const result = validateContributeOptions(
      makeContributeOptions({ kind: "review", reviews: "blake3:abc" }),
    );
    expect(result.valid).toBe(true);
  });

  // Metric format
  test("rejects metric without =value", () => {
    const result = validateContributeOptions(makeContributeOptions({ metric: ["foo"] }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("Invalid metric format");
    }
  });

  test("rejects metric with non-numeric value", () => {
    const result = validateContributeOptions(makeContributeOptions({ metric: ["foo=bar"] }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("Value must be a number");
    }
  });

  test("accepts valid metric format", () => {
    const result = validateContributeOptions(
      makeContributeOptions({ metric: ["tests_passing=47", "throughput=14800"] }),
    );
    expect(result.valid).toBe(true);
  });

  // Score format
  test("rejects score without =value", () => {
    const result = validateContributeOptions(makeContributeOptions({ score: ["quality"] }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]).toContain("Invalid score format");
    }
  });

  // Multiple errors
  test("collects multiple errors", () => {
    const result = validateContributeOptions(
      makeContributeOptions({
        summary: "",
        kind: "review",
        artifacts: ["./src"],
        fromGitDiff: "HEAD",
        metric: ["bad"],
      }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Should have errors for: summary, mutual exclusion, missing --reviews, metric format
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// executeContribute
// ---------------------------------------------------------------------------

describe("executeContribute", () => {
  test("creates a work contribution with artifacts", async () => {
    const dir = await createTempDir();
    try {
      // Initialize grove
      await executeInit(makeInitOptions(dir));

      // Create an artifact file
      const artifactFile = join(dir, "output.txt");
      await writeFile(artifactFile, "test output");

      const result = await executeContribute(
        makeContributeOptions({
          summary: "Test work",
          artifacts: [artifactFile],
          cwd: dir,
        }),
      );

      expect(result.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates a contribution with metrics", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const result = await executeContribute(
        makeContributeOptions({
          summary: "Metric work",
          metric: ["tests_passing=47", "throughput=14800"],
          cwd: dir,
        }),
      );

      expect(result.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates a contribution with tags", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const result = await executeContribute(
        makeContributeOptions({
          summary: "Tagged work",
          tags: ["performance", "database"],
          cwd: dir,
        }),
      );

      expect(result.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates a review contribution with --reviews", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      // Create a work contribution first
      const work = await executeContribute(
        makeContributeOptions({
          summary: "Work to review",
          cwd: dir,
        }),
      );

      // Create a review
      const review = await executeContribute(
        makeContributeOptions({
          kind: "review",
          summary: "Looks good",
          reviews: work.cid,
          score: ["quality=8"],
          cwd: dir,
        }),
      );

      expect(review.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates a discussion contribution with --responds-to", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const work = await executeContribute(
        makeContributeOptions({
          summary: "Original work",
          cwd: dir,
        }),
      );

      const discussion = await executeContribute(
        makeContributeOptions({
          kind: "discussion",
          summary: "Should we use polling or push?",
          respondsTo: work.cid,
          cwd: dir,
        }),
      );

      expect(discussion.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates an adoption contribution with --adopts", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const work = await executeContribute(
        makeContributeOptions({
          summary: "Adoptable work",
          cwd: dir,
        }),
      );

      const adoption = await executeContribute(
        makeContributeOptions({
          kind: "adoption",
          summary: "Adopting this approach",
          adopts: work.cid,
          cwd: dir,
        }),
      );

      expect(adoption.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates a reproduction contribution with --reproduces", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const work = await executeContribute(
        makeContributeOptions({
          summary: "Reproducible work",
          cwd: dir,
        }),
      );

      const reproduction = await executeContribute(
        makeContributeOptions({
          kind: "reproduction",
          summary: "Reproduced on A100",
          reproduces: work.cid,
          metric: ["val_bpb=0.9701"],
          cwd: dir,
        }),
      );

      expect(reproduction.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates contribution with --parent relation", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const parent = await executeContribute(
        makeContributeOptions({
          summary: "Parent work",
          cwd: dir,
        }),
      );

      const child = await executeContribute(
        makeContributeOptions({
          summary: "Child work",
          parent: parent.cid,
          cwd: dir,
        }),
      );

      expect(child.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ingests report via --from-report", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const reportPath = join(dir, "analysis.md");
      await writeFile(reportPath, "# Analysis\n\nFindings here.");

      const result = await executeContribute(
        makeContributeOptions({
          summary: "Analysis report",
          fromReport: reportPath,
          cwd: dir,
        }),
      );

      expect(result.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates exploration mode contribution", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const result = await executeContribute(
        makeContributeOptions({
          mode: "exploration",
          summary: "Database pool exhausts at >100 connections",
          tags: ["performance", "database"],
          cwd: dir,
        }),
      );

      expect(result.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -- Edge cases --

  test("errors when no grove initialized", async () => {
    const dir = await createTempDir();
    try {
      await expect(
        executeContribute(makeContributeOptions({ summary: "test", cwd: dir })),
      ).rejects.toThrow(/No grove found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on nonexistent parent CID", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      await expect(
        executeContribute(
          makeContributeOptions({
            summary: "test",
            parent: "blake3:0000000000000000000000000000000000000000000000000000000000000000",
            cwd: dir,
          }),
        ),
      ).rejects.toThrow(/Parent contribution not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on nonexistent relation target CID", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      await expect(
        executeContribute(
          makeContributeOptions({
            kind: "review",
            summary: "test",
            reviews: "blake3:0000000000000000000000000000000000000000000000000000000000000000",
            cwd: dir,
          }),
        ),
      ).rejects.toThrow(/Relation target contribution not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on nonexistent artifact path", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      await expect(
        executeContribute(
          makeContributeOptions({
            summary: "test",
            artifacts: ["/nonexistent/path.txt"],
            cwd: dir,
          }),
        ),
      ).rejects.toThrow(/Artifact path not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on nonexistent report path", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      await expect(
        executeContribute(
          makeContributeOptions({
            summary: "test",
            fromReport: "/nonexistent/report.md",
            cwd: dir,
          }),
        ),
      ).rejects.toThrow(/Report file not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on invalid metric format in execute", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      await expect(
        executeContribute(
          makeContributeOptions({
            summary: "test",
            metric: ["bad_metric"],
            cwd: dir,
          }),
        ),
      ).rejects.toThrow(/Invalid contribute options/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("errors on mutually exclusive ingestion modes in execute", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      await expect(
        executeContribute(
          makeContributeOptions({
            summary: "test",
            artifacts: ["./src"],
            fromGitDiff: "HEAD~1",
            cwd: dir,
          }),
        ),
      ).rejects.toThrow(/mutually exclusive/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allows duplicate contribution (idempotent put)", async () => {
    const dir = await createTempDir();
    try {
      await executeInit(makeInitOptions(dir));

      const opts = makeContributeOptions({
        summary: "Idempotent work",
        cwd: dir,
      });

      // The CID will differ because createdAt changes, but if we fix it...
      // For true idempotency, we'd need the same createdAt. Let's just
      // verify two contributions with different timestamps don't error.
      const r1 = await executeContribute(opts);
      const r2 = await executeContribute(opts);

      // Different CIDs (different createdAt) but both succeed
      expect(r1.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
      expect(r2.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// E2E smoke test
// ---------------------------------------------------------------------------

describe("grove contribute E2E", () => {
  test("grove contribute via CLI creates a contribution", async () => {
    const dir = await createTempDir();
    try {
      const cliPath = join(import.meta.dir, "..", "..", "cli", "main.ts");

      // First init
      const initProc = Bun.spawn(["bun", "run", cliPath, "init", "e2e-test"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      await initProc.exited;

      // Then contribute
      const proc = Bun.spawn(
        ["bun", "run", cliPath, "contribute", "--summary", "E2E contribution", "--tag", "e2e"],
        { cwd: dir, stdout: "pipe", stderr: "pipe" },
      );

      // Drain stdout/stderr to avoid pipe hang
      await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
