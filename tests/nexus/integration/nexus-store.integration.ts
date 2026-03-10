/**
 * Integration tests for NexusContributionStore and NexusClaimStore
 * against a real Nexus instance.
 *
 * These tests are SKIPPED unless NEXUS_URL is set in the environment.
 *
 * Usage:
 *   NEXUS_URL=http://localhost:8080 bun test tests/nexus/integration/
 */

import { describe, test } from "bun:test";

const NEXUS_URL = process.env.NEXUS_URL;

describe.skipIf(!NEXUS_URL)("NexusContributionStore integration", () => {
  // Implementation placeholder — uncomment when real NexusClient exists:
  //
  // runContributionStoreTests(async () => {
  //   const client = new RealNexusClient({ url: NEXUS_URL! });
  //   const zoneId = `integration-test-${Date.now()}`;
  //   const store = new NexusContributionStore({ client, zoneId });
  //   return {
  //     store,
  //     cleanup: async () => { await client.close(); },
  //   };
  // });

  test("placeholder — real integration tests require NEXUS_URL and NexusClient SDK", () => {});
});

describe.skipIf(!NEXUS_URL)("NexusClaimStore integration", () => {
  // Implementation placeholder — uncomment when real NexusClient exists:
  //
  // runClaimStoreTests(async () => {
  //   const client = new RealNexusClient({ url: NEXUS_URL! });
  //   const zoneId = `integration-test-${Date.now()}`;
  //   const store = new NexusClaimStore({ client, zoneId });
  //   return {
  //     store,
  //     cleanup: async () => { await client.close(); },
  //   };
  // });

  test("placeholder — real integration tests require NEXUS_URL and NexusClient SDK", () => {});
});
