/**
 * Tests for SqliteStore using conformance test suites.
 *
 * Creates a fresh SQLite database in a temp directory for each test,
 * and tears it down after.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runClaimStoreTests } from "../core/claim-store.conformance.js";
import { runContributionStoreTests } from "../core/store.conformance.js";
import { SqliteStore } from "./sqlite-store.js";

// ---------------------------------------------------------------------------
// ContributionStore conformance
// ---------------------------------------------------------------------------

runContributionStoreTests(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-store-contrib-"));
  const dbPath = join(dir, "test.db");
  const store = new SqliteStore(dbPath);

  return {
    store,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
});

// ---------------------------------------------------------------------------
// ClaimStore conformance
// ---------------------------------------------------------------------------

runClaimStoreTests(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-store-claim-"));
  const dbPath = join(dir, "test.db");
  const store = new SqliteStore(dbPath);

  return {
    store,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
});
