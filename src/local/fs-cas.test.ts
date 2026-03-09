/**
 * Tests for the filesystem-backed Content-Addressable Storage (FsCas).
 *
 * Runs the shared ContentStore conformance suite against FsCas.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runContentStoreTests } from "../core/cas.conformance.js";
import { FsCas } from "./fs-cas.js";

runContentStoreTests(async () => {
  const dir = await mkdtemp(join(tmpdir(), "fs-cas-test-"));
  const store = new FsCas(dir);
  return {
    store,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
});
