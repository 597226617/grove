/**
 * Grove HTTP server entry point.
 *
 * Creates stores from environment/flags and starts Bun.serve().
 * Optionally enables gossip federation when GOSSIP_SEEDS is set.
 *
 * This is the only file excluded from test coverage — use createApp() for testing.
 */

import { join } from "node:path";
import { DefaultFrontierCalculator } from "../core/frontier.js";
import type { GossipService } from "../core/gossip/types.js";
import { CachedFrontierCalculator } from "../gossip/cached-frontier.js";
import { HttpGossipTransport } from "../gossip/http-transport.js";
import { DefaultGossipService } from "../gossip/protocol.js";
import { FsCas } from "../local/fs-cas.js";
import { createSqliteStores } from "../local/sqlite-store.js";
import { createApp } from "./app.js";
import type { ServerDeps } from "./deps.js";

const GROVE_DIR = process.env.GROVE_DIR ?? join(process.cwd(), ".grove");
const PORT = Number(process.env.PORT ?? 4515);

const dbPath = join(GROVE_DIR, "grove.db");
const casDir = join(GROVE_DIR, "cas");

const stores = createSqliteStores(dbPath);
const cas = new FsCas(casDir);
const rawFrontier = new DefaultFrontierCalculator(stores.contributionStore);
const frontier = new CachedFrontierCalculator(rawFrontier);

// ---------------------------------------------------------------------------
// Optional gossip federation
// ---------------------------------------------------------------------------

let gossipService: GossipService | undefined;

const gossipSeeds = process.env.GOSSIP_SEEDS; // comma-separated "id@address" pairs
const peerId = process.env.GOSSIP_PEER_ID ?? `grove-${PORT}`;
const peerAddress = process.env.GOSSIP_ADDRESS ?? `http://localhost:${PORT}`;

if (gossipSeeds) {
  const seedPeers = gossipSeeds.split(",").map((seed) => {
    const [id, address] = seed.trim().split("@");
    if (!id || !address) {
      throw new Error(`Invalid GOSSIP_SEEDS entry: "${seed}". Expected format: "id@address".`);
    }
    return { peerId: id, address, age: 0, lastSeen: new Date().toISOString() };
  });

  const transport = new HttpGossipTransport();
  gossipService = new DefaultGossipService({
    config: { peerId, address: peerAddress, seedPeers },
    transport,
    frontier,
    getLoad: () => ({ queueDepth: 0 }),
  });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const deps: ServerDeps = {
  contributionStore: stores.contributionStore,
  claimStore: stores.claimStore,
  cas,
  frontier,
  gossip: gossipService,
};

const app = createApp(deps);

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

// Start gossip after server is listening
if (gossipService) {
  gossipService.start();
  console.log(`gossip enabled: peerId=${peerId}, seeds=${gossipSeeds}`);
}

console.log(`grove-server listening on http://localhost:${server.port}`);

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log("Shutting down...");
  if (gossipService) {
    await gossipService.stop();
  }
  server.stop();
  stores.close();
  cas.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
