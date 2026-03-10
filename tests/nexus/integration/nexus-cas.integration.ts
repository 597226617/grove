/**
 * Integration tests for NexusCas against a real Nexus instance.
 *
 * These tests are SKIPPED unless NEXUS_URL is set in the environment.
 * They run the same conformance suite as the unit tests but against
 * a real Nexus backend to validate end-to-end behavior.
 *
 * Usage:
 *   NEXUS_URL=http://localhost:8080 bun test tests/nexus/integration/
 */

import { describe, test } from "bun:test";

const NEXUS_URL = process.env.NEXUS_URL;

describe.skipIf(!NEXUS_URL)("NexusCas integration", () => {
  // When NEXUS_URL is available, create a real NexusClient
  // pointing to the running Nexus instance and run conformance tests.
  //
  // Implementation placeholder — uncomment when real NexusClient exists:
  //
  // runContentStoreTests(async () => {
  //   const client = new RealNexusClient({ url: NEXUS_URL! });
  //   const zoneId = `integration-test-${Date.now()}`;
  //   const store = new NexusCas({ client, zoneId });
  //   return {
  //     store,
  //     cleanup: async () => {
  //       // Clean up test zone data
  //       await client.close();
  //     },
  //   };
  // });

  test("placeholder — real integration tests require NEXUS_URL and NexusClient SDK", () => {
    // This test exists to prevent the file from being empty.
    // Replace with real tests when the Nexus SDK is available.
  });
});
