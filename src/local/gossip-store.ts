/**
 * SQLite-backed gossip state persistence.
 *
 * Stores peer information and merged frontier entries in a separate
 * database file (gossip.db) to avoid coupling with the contribution
 * store schema. Gossip state is ephemeral coordination data — it can
 * be safely deleted without losing contribution history.
 */

import { Database } from "bun:sqlite";
import type { FrontierDigestEntry, PeerInfo } from "../core/gossip/types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const GOSSIP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS gossip_peers (
    peer_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    age INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'alive',
    suspected_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_gossip_peers_status ON gossip_peers(status);

  CREATE TABLE IF NOT EXISTS gossip_frontier (
    metric TEXT NOT NULL,
    cid TEXT NOT NULL,
    value REAL NOT NULL,
    tags_json TEXT,
    PRIMARY KEY (metric, cid)
  );
`;

// ---------------------------------------------------------------------------
// GossipStateStore interface
// ---------------------------------------------------------------------------

/** Persistent storage for gossip protocol state. */
export interface GossipStateStore {
  /** Load all persisted peers. */
  loadPeers(): readonly PeerInfo[];
  /** Save the current peer view (replaces all existing peers). */
  savePeers(peers: readonly PeerInfo[]): void;
  /** Add a single peer. Returns false if already exists. */
  addPeer(peer: PeerInfo): boolean;
  /** Remove a peer by ID. Returns true if removed. */
  removePeer(peerId: string): boolean;
  /** Load the merged frontier. */
  loadFrontier(): readonly FrontierDigestEntry[];
  /** Save the merged frontier (replaces all existing entries). */
  saveFrontier(entries: readonly FrontierDigestEntry[]): void;
  /** Close the database connection. */
  close(): void;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

export class SqliteGossipStore implements GossipStateStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    this.db.exec(GOSSIP_SCHEMA);
  }

  loadPeers(): readonly PeerInfo[] {
    const rows = this.db
      .prepare("SELECT peer_id, address, age, last_seen FROM gossip_peers")
      .all() as Array<{
      peer_id: string;
      address: string;
      age: number;
      last_seen: string;
    }>;

    return rows.map((r) => ({
      peerId: r.peer_id,
      address: r.address,
      age: r.age,
      lastSeen: r.last_seen,
    }));
  }

  savePeers(peers: readonly PeerInfo[]): void {
    const save = this.db.transaction(() => {
      this.db.run("DELETE FROM gossip_peers");
      const stmt = this.db.prepare(
        "INSERT INTO gossip_peers (peer_id, address, age, last_seen) VALUES (?, ?, ?, ?)",
      );
      for (const peer of peers) {
        stmt.run(peer.peerId, peer.address, peer.age, peer.lastSeen);
      }
    });
    save();
  }

  addPeer(peer: PeerInfo): boolean {
    const existing = this.db
      .prepare("SELECT 1 FROM gossip_peers WHERE peer_id = ?")
      .get(peer.peerId);
    if (existing) return false;

    this.db
      .prepare("INSERT INTO gossip_peers (peer_id, address, age, last_seen) VALUES (?, ?, ?, ?)")
      .run(peer.peerId, peer.address, peer.age, peer.lastSeen);
    return true;
  }

  removePeer(peerId: string): boolean {
    const result = this.db.prepare("DELETE FROM gossip_peers WHERE peer_id = ?").run(peerId);
    return result.changes > 0;
  }

  loadFrontier(): readonly FrontierDigestEntry[] {
    const rows = this.db
      .prepare("SELECT metric, cid, value, tags_json FROM gossip_frontier")
      .all() as Array<{
      metric: string;
      cid: string;
      value: number;
      tags_json: string | null;
    }>;

    return rows.map((r) => ({
      metric: r.metric,
      cid: r.cid,
      value: r.value,
      ...(r.tags_json !== null && {
        tags: JSON.parse(r.tags_json) as string[],
      }),
    }));
  }

  saveFrontier(entries: readonly FrontierDigestEntry[]): void {
    const save = this.db.transaction(() => {
      this.db.run("DELETE FROM gossip_frontier");
      const stmt = this.db.prepare(
        "INSERT INTO gossip_frontier (metric, cid, value, tags_json) VALUES (?, ?, ?, ?)",
      );
      for (const entry of entries) {
        stmt.run(
          entry.metric,
          entry.cid,
          entry.value,
          entry.tags ? JSON.stringify(entry.tags) : null,
        );
      }
    });
    save();
  }

  close(): void {
    this.db.close();
  }
}
