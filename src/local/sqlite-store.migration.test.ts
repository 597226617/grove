/**
 * Schema migration smoke tests for SQLite store.
 *
 * Validates that:
 * - Fresh DB creates schema v1
 * - Re-opening existing DB doesn't corrupt data
 * - Schema migrations table is correctly populated
 */

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Claim } from "../core/models.js";
import { ClaimStatus } from "../core/models.js";
import { makeContribution } from "../core/test-helpers.js";
import { initSqliteDb, SqliteStore } from "./sqlite-store.js";

function makeClaim(overrides?: Partial<Claim>): Claim {
  const now = new Date().toISOString();
  const leaseExpires = new Date(Date.now() + 60_000).toISOString();
  return {
    claimId: "claim-1",
    targetRef: "target-1",
    agent: { agentId: "test-agent" },
    status: ClaimStatus.Active,
    heartbeatAt: now,
    leaseExpiresAt: leaseExpires,
    intentSummary: "Test claim",
    ...overrides,
  };
}

describe("schema migration", () => {
  test("fresh DB creates schema_migrations with version 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      const store = new SqliteStore(dbPath);
      store.close();

      // Inspect the DB directly
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
        .get() as { version: number } | null;
      db.close();

      expect(row).toBeDefined();
      expect(row?.version).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fresh DB creates all expected tables", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      const store = new SqliteStore(dbPath);
      store.close();

      const db = new Database(dbPath, { readonly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as readonly { name: string }[];
      db.close();

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("contributions");
      expect(tableNames).toContain("contribution_tags");
      expect(tableNames).toContain("artifacts");
      expect(tableNames).toContain("relations");
      expect(tableNames).toContain("claims");
      expect(tableNames).toContain("schema_migrations");
      expect(tableNames).toContain("contributions_fts");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("re-opening existing DB does not corrupt contributions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      // First open: create and write data
      const store1 = new SqliteStore(dbPath);
      const c = makeContribution({ summary: "survives reopen" });
      await store1.put(c);
      store1.close();

      // Second open: data should be intact
      const store2 = new SqliteStore(dbPath);
      const retrieved = await store2.get(c.cid);
      expect(retrieved).toBeDefined();
      expect(retrieved?.summary).toBe("survives reopen");
      expect(retrieved?.cid).toBe(c.cid);

      // Count should be 1 (not duplicated)
      const count = await store2.count();
      expect(count).toBe(1);
      store2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("re-opening existing DB does not corrupt claims", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      // First open: create claim
      const store1 = new SqliteStore(dbPath);
      const claim = makeClaim({ claimId: "reopen-claim" });
      await store1.createClaim(claim);
      store1.close();

      // Second open: claim should be intact
      const store2 = new SqliteStore(dbPath);
      const retrieved = await store2.getClaim("reopen-claim");
      expect(retrieved).toBeDefined();
      expect(retrieved?.status).toBe("active");
      expect(retrieved?.targetRef).toBe("target-1");
      store2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("re-opening preserves FTS index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      // First open: write searchable data
      const store1 = new SqliteStore(dbPath);
      const c = makeContribution({ summary: "searchable quantum computing" });
      await store1.put(c);
      store1.close();

      // Second open: search should still work
      const store2 = new SqliteStore(dbPath);
      const results = await store2.search("quantum");
      expect(results.length).toBe(1);
      expect(results[0]?.cid).toBe(c.cid);
      store2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("re-opening preserves tag junction table", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      // First open: write tagged data
      const store1 = new SqliteStore(dbPath);
      const c = makeContribution({ summary: "tagged data", tags: ["alpha", "beta"] });
      await store1.put(c);
      store1.close();

      // Second open: tag filtering should still work
      const store2 = new SqliteStore(dbPath);
      const results = await store2.list({ tags: ["alpha", "beta"] });
      expect(results.length).toBe(1);
      expect(results[0]?.cid).toBe(c.cid);
      store2.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("schema_migrations version is not duplicated on reopen", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      // Open twice
      const store1 = new SqliteStore(dbPath);
      store1.close();
      const store2 = new SqliteStore(dbPath);
      store2.close();

      // Check only one migration row
      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare("SELECT * FROM schema_migrations").all() as readonly {
        version: number;
      }[];
      db.close();

      expect(rows.length).toBe(1);
      expect(rows[0]?.version).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("initSqliteDb returns a functional Database", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sqlite-migration-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = initSqliteDb(dbPath);

      // Should be able to query schema
      const row = db.prepare("SELECT version FROM schema_migrations LIMIT 1").get() as {
        version: number;
      } | null;
      expect(row?.version).toBe(1);

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
