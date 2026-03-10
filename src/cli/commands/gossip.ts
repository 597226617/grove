/**
 * grove gossip — gossip protocol commands.
 *
 * Supports two modes:
 *   Server query mode: query a running grove-server's gossip state
 *   Direct mode: CLI participates in gossip using local stores
 *
 * Usage:
 *   grove gossip peers    [--server <url>]          List known peers
 *   grove gossip status   [--server <url>]          Show gossip overview
 *   grove gossip frontier [--server <url>]          Show merged frontier
 *   grove gossip exchange <peer-url> [--peer-id id] Push-pull frontier exchange
 *   grove gossip shuffle  <peer-url> [--peer-id id] CYCLON peer sampling shuffle
 *   grove gossip sync     <seeds>    [--peer-id id] Full round with seed peers
 */

import { hostname } from "node:os";
import { parseArgs } from "node:util";
import type { FrontierEntry } from "../../core/frontier.js";
import type {
  FrontierDigestEntry,
  GossipMessage,
  PeerInfo,
  ShuffleRequest,
} from "../../core/gossip/types.js";
import { CyclonPeerSampler } from "../../gossip/cyclon.js";
import { HttpGossipTransport } from "../../gossip/http-transport.js";
import type { CliDeps, Writer } from "../context.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SERVER = "http://localhost:4515";
const DEFAULT_DIGEST_LIMIT = 5;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function handleGossip(
  args: readonly string[],
  _groveOverride: string | undefined,
  /** Injected for direct-mode commands that need local stores. */
  withCliDeps?: (
    fn: (args: readonly string[], deps: CliDeps) => Promise<void>,
    args: readonly string[],
  ) => Promise<void>,
  writer: Writer = console.log,
): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "peers":
      await handlePeers(subArgs, writer);
      break;
    case "status":
      await handleStatus(subArgs, writer);
      break;
    case "frontier":
      await handleFrontier(subArgs, writer);
      break;
    case "exchange":
      if (!withCliDeps) {
        throw new Error("exchange requires local grove stores");
      }
      await withCliDeps(async (a, deps) => handleExchange(a, deps, writer), [...subArgs]);
      break;
    case "shuffle":
      await handleShuffle(subArgs, writer);
      break;
    case "sync":
      if (!withCliDeps) {
        throw new Error("sync requires local grove stores");
      }
      await withCliDeps(async (a, deps) => handleSync(a, deps, writer), [...subArgs]);
      break;
    default:
      printGossipUsage(writer);
      if (subcommand && subcommand !== "--help" && subcommand !== "-h") {
        process.exitCode = 1;
      }
  }
}

// ---------------------------------------------------------------------------
// Server query commands
// ---------------------------------------------------------------------------

async function handlePeers(args: readonly string[], writer: Writer): Promise<void> {
  const { server, json } = parseServerArgs([...args]);

  const res = await fetch(`${server}/api/gossip/peers`);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    peers: PeerInfo[];
    liveness: Array<{
      peer: PeerInfo;
      status: string;
      lastSeen: string;
      suspectedAt?: string;
    }>;
  };

  if (json) {
    writer(JSON.stringify(data, null, 2));
    return;
  }

  if (data.peers.length === 0) {
    writer("No peers known.");
    return;
  }

  writer("Known peers:\n");
  for (const l of data.liveness) {
    const status = formatStatus(l.status);
    writer(
      `  ${l.peer.peerId}  ${l.peer.address}  age=${l.peer.age}  ${status}  last=${l.lastSeen}`,
    );
  }
  writer(`\nTotal: ${data.peers.length} peer(s)`);
}

async function handleStatus(args: readonly string[], writer: Writer): Promise<void> {
  const { server, json } = parseServerArgs([...args]);

  const res = await fetch(`${server}/api/grove`);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    version: string;
    stats: { contributions: number; activeClaims: number };
    gossip?: {
      enabled: boolean;
      peers: number;
      liveness: Array<{ peerId: string; status: string; lastSeen: string }>;
    };
  };

  if (json) {
    writer(JSON.stringify(data, null, 2));
    return;
  }

  if (!data.gossip || !data.gossip.enabled) {
    writer("Gossip: disabled");
    return;
  }

  writer(`Gossip: enabled`);
  writer(`Peers: ${data.gossip.peers}`);
  writer(`Contributions: ${data.stats.contributions}`);
  writer(`Active claims: ${data.stats.activeClaims}`);

  if (data.gossip.liveness.length > 0) {
    writer("\nPeer liveness:");
    for (const l of data.gossip.liveness) {
      writer(`  ${l.peerId}  ${formatStatus(l.status)}  last=${l.lastSeen}`);
    }
  }
}

async function handleFrontier(args: readonly string[], writer: Writer): Promise<void> {
  const { server, json } = parseServerArgs([...args]);

  const res = await fetch(`${server}/api/gossip/frontier`);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { entries: FrontierDigestEntry[] };

  if (json) {
    writer(JSON.stringify(data, null, 2));
    return;
  }

  if (data.entries.length === 0) {
    writer("(no frontier data from gossip)");
    return;
  }

  // Group by metric
  const byMetric = new Map<string, FrontierDigestEntry[]>();
  for (const entry of data.entries) {
    const list = byMetric.get(entry.metric) ?? [];
    list.push(entry);
    byMetric.set(entry.metric, list);
  }

  for (const [metric, entries] of byMetric) {
    writer(`\n${metric}:`);
    for (const e of entries) {
      const tags = e.tags && e.tags.length > 0 ? `  [${e.tags.join(", ")}]` : "";
      writer(`  ${e.cid.slice(0, 16)}…  value=${e.value}${tags}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Direct gossip commands
// ---------------------------------------------------------------------------

async function handleExchange(
  args: readonly string[],
  deps: CliDeps,
  writer: Writer,
): Promise<void> {
  const { peerUrl, peerId, json } = parseDirectArgs([...args]);

  const transport = new HttpGossipTransport();
  const message = await buildGossipMessage(peerId, deps);
  const target = urlToPeerInfo(peerUrl);

  writer(`Exchanging frontier with ${peerUrl}...`);
  const response = await transport.exchange(target, message);

  if (json) {
    writer(JSON.stringify(response, null, 2));
    return;
  }

  writer(`\nReceived from ${response.peerId}:`);
  writer(`  Frontier entries: ${response.frontier.length}`);
  writer(`  Load: queueDepth=${response.load.queueDepth}`);
  writer(`  Timestamp: ${response.timestamp}`);

  if (response.frontier.length > 0) {
    writer("\nFrontier digest:");
    for (const e of response.frontier) {
      writer(`  ${e.metric}: ${e.cid.slice(0, 16)}… value=${e.value}`);
    }
  }

  // Show what's new — CIDs they have that we might not
  const localCids = new Set(message.frontier.map((e) => e.cid));
  const newEntries = response.frontier.filter((e) => !localCids.has(e.cid));
  if (newEntries.length > 0) {
    writer(`\nNew CIDs discovered: ${newEntries.length}`);
    for (const e of newEntries) {
      writer(`  ${e.metric}: ${e.cid.slice(0, 16)}… value=${e.value}`);
    }
  } else {
    writer("\nNo new CIDs discovered (frontiers in sync).");
  }
}

async function handleShuffle(args: readonly string[], writer: Writer): Promise<void> {
  const { peerUrl, peerId, json } = parseDirectArgs([...args]);

  const transport = new HttpGossipTransport();
  const selfPeer: PeerInfo = {
    peerId,
    address: `cli://${hostname()}`,
    age: 0,
    lastSeen: new Date().toISOString(),
  };

  const target = urlToPeerInfo(peerUrl);
  const request: ShuffleRequest = {
    sender: { ...selfPeer, age: 0 },
    offered: [{ ...selfPeer, age: 0 }],
  };

  writer(`Shuffling with ${peerUrl}...`);
  const response = await transport.shuffle(target, request);

  if (json) {
    writer(JSON.stringify(response, null, 2));
    return;
  }

  if (response.offered.length === 0) {
    writer("Peer has no other peers to share.");
    return;
  }

  writer(`\nDiscovered ${response.offered.length} peer(s):`);
  for (const peer of response.offered) {
    writer(`  ${peer.peerId}  ${peer.address}  age=${peer.age}`);
  }
}

async function handleSync(args: readonly string[], deps: CliDeps, writer: Writer): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      "peer-id": { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  const seedsArg = positionals[0];
  if (!seedsArg) {
    throw new Error("Usage: grove gossip sync <seed1,seed2,...> [--peer-id id]");
  }

  const peerId = values["peer-id"] ?? `cli-${hostname()}-${process.pid}`;
  const json = values.json ?? false;
  const transport = new HttpGossipTransport();
  const selfPeer: PeerInfo = {
    peerId,
    address: `cli://${hostname()}`,
    age: 0,
    lastSeen: new Date().toISOString(),
  };

  // Parse seeds: either "peerId@url" or just "url"
  const seeds = parseSeedList(seedsArg);
  const sampler = new CyclonPeerSampler(selfPeer, { maxViewSize: 10, shuffleLength: 5 }, seeds);

  const message = await buildGossipMessage(peerId, deps);

  writer(`Syncing with ${seeds.length} seed(s)...\n`);

  const allDiscovered: FrontierDigestEntry[] = [];
  const allPeers: PeerInfo[] = [];

  // 1. Shuffle with each seed to discover peers
  for (const seed of seeds) {
    try {
      writer(`  Shuffling with ${seed.peerId} (${seed.address})...`);
      const request: ShuffleRequest = {
        sender: { ...selfPeer, age: 0 },
        offered: [{ ...selfPeer, age: 0 }],
      };
      const shuffleResp = await transport.shuffle(seed, request);
      sampler.processShuffleResponse(shuffleResp, request.offered);

      for (const peer of shuffleResp.offered) {
        allPeers.push(peer);
      }
      writer(`    Discovered ${shuffleResp.offered.length} peer(s)`);
    } catch (err) {
      writer(`    Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Exchange frontier with all known peers (seeds + discovered)
  const exchangeTargets = sampler.getView();
  writer(`\nExchanging frontier with ${exchangeTargets.length} peer(s)...\n`);

  for (const peer of exchangeTargets) {
    try {
      writer(`  Exchange with ${peer.peerId} (${peer.address})...`);
      const response = await transport.exchange(peer, message);

      for (const entry of response.frontier) {
        allDiscovered.push(entry);
      }
      writer(`    Received ${response.frontier.length} frontier entries`);
    } catch (err) {
      writer(`    Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Summary
  const localCids = new Set(message.frontier.map((e) => e.cid));
  const newCids = new Set(allDiscovered.filter((e) => !localCids.has(e.cid)).map((e) => e.cid));

  if (json) {
    writer(
      JSON.stringify(
        {
          peersDiscovered: allPeers.length,
          frontierEntriesReceived: allDiscovered.length,
          newCids: [...newCids],
          view: [...sampler.getView()],
        },
        null,
        2,
      ),
    );
    return;
  }

  writer(`\nSync complete:`);
  writer(`  Peers in view: ${sampler.size}`);
  writer(`  Frontier entries received: ${allDiscovered.length}`);
  writer(`  New CIDs discovered: ${newCids.size}`);

  if (newCids.size > 0) {
    writer("\nNew CIDs:");
    for (const cid of newCids) {
      writer(`  ${cid.slice(0, 24)}…`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildGossipMessage(peerId: string, deps: CliDeps): Promise<GossipMessage> {
  const frontier = await deps.frontier.compute({ limit: DEFAULT_DIGEST_LIMIT });
  const entries: FrontierDigestEntry[] = [];

  for (const [metric, metricEntries] of Object.entries(frontier.byMetric)) {
    for (const entry of metricEntries) {
      entries.push({
        metric,
        value: entry.value,
        cid: entry.cid,
        tags: entry.contribution.tags.length > 0 ? entry.contribution.tags : undefined,
      });
    }
  }

  const addDimension = (dimension: string, items: readonly FrontierEntry[]): void => {
    for (const entry of items.slice(0, DEFAULT_DIGEST_LIMIT)) {
      entries.push({
        metric: `_${dimension}`,
        value: entry.value,
        cid: entry.cid,
      });
    }
  };

  addDimension("adoption", frontier.byAdoption);
  addDimension("recency", frontier.byRecency);
  addDimension("review_score", frontier.byReviewScore);
  addDimension("reproduction", frontier.byReproduction);

  return {
    peerId,
    frontier: entries,
    load: { queueDepth: 0 },
    capabilities: {},
    timestamp: new Date().toISOString(),
  };
}

function urlToPeerInfo(url: string): PeerInfo {
  return {
    peerId: url,
    address: url,
    age: 0,
    lastSeen: new Date().toISOString(),
  };
}

function parseSeedList(seedsStr: string): PeerInfo[] {
  return seedsStr.split(",").map((s) => {
    const trimmed = s.trim();
    const atIndex = trimmed.indexOf("@");
    if (atIndex > 0) {
      return {
        peerId: trimmed.slice(0, atIndex),
        address: trimmed.slice(atIndex + 1),
        age: 0,
        lastSeen: new Date().toISOString(),
      };
    }
    return {
      peerId: trimmed,
      address: trimmed,
      age: 0,
      lastSeen: new Date().toISOString(),
    };
  });
}

function formatStatus(status: string): string {
  switch (status) {
    case "alive":
      return "[alive]";
    case "suspected":
      return "[SUSPECTED]";
    case "failed":
      return "[FAILED]";
    default:
      return `[${status}]`;
  }
}

function parseServerArgs(args: string[]): { server: string; json: boolean } {
  const { values } = parseArgs({
    args,
    options: {
      server: { type: "string", short: "s" },
      json: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    server: values.server ?? process.env.GROVE_SERVER ?? DEFAULT_SERVER,
    json: values.json ?? false,
  };
}

function parseDirectArgs(args: string[]): { peerUrl: string; peerId: string; json: boolean } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "peer-id": { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  const peerUrl = positionals[0];
  if (!peerUrl) {
    throw new Error("Usage: grove gossip <command> <peer-url> [--peer-id id]");
  }

  return {
    peerUrl,
    peerId: values["peer-id"] ?? `cli-${hostname()}-${process.pid}`,
    json: values.json ?? false,
  };
}

function printGossipUsage(writer: Writer = console.log): void {
  writer(`grove gossip — gossip protocol commands

Server query (connects to a running grove-server):
  grove gossip peers    [--server <url>]           List known peers
  grove gossip status   [--server <url>]           Show gossip overview
  grove gossip frontier [--server <url>]           Show merged frontier

Direct gossip (CLI participates using local stores):
  grove gossip exchange <peer-url> [--peer-id id]  Push-pull frontier exchange
  grove gossip shuffle  <peer-url> [--peer-id id]  CYCLON peer sampling shuffle
  grove gossip sync     <seeds>    [--peer-id id]  Full round with seed peers

Options:
  --server <url>   Server URL (default: GROVE_SERVER env or http://localhost:4515)
  --peer-id <id>   Local peer identity (default: cli-<hostname>-<pid>)
  --json           JSON output
  -h, --help       Show this help

Seeds format: peer1@http://host1:4515,peer2@http://host2:4515
`);
}
