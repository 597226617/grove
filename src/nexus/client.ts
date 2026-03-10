/**
 * NexusClient port interface.
 *
 * Defines the abstract contract that a Nexus backend must satisfy.
 * The Nexus adapters (NexusCas, NexusContributionStore, NexusClaimStore)
 * depend on this port — not on any concrete transport (HTTP, gRPC, etc.).
 *
 * For testing, use MockNexusClient (in-memory implementation).
 * For production, implement this against the real Nexus SDK.
 */

import type { JsonValue } from "../core/models.js";

// ---------------------------------------------------------------------------
// Blob / CAS operations
// ---------------------------------------------------------------------------

/** Metadata returned by blob stat operations. */
export interface BlobStat {
  readonly sizeBytes: number;
  readonly mediaType?: string | undefined;
}

// ---------------------------------------------------------------------------
// Record store types
// ---------------------------------------------------------------------------

/** Options for record queries. */
export interface RecordQueryOpts {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly orderBy?: string | undefined;
  readonly orderDir?: "asc" | "desc" | undefined;
}

// ---------------------------------------------------------------------------
// Cache store types
// ---------------------------------------------------------------------------

/** Value with revision tracking for optimistic concurrency. */
export interface CacheEntry {
  readonly value: Uint8Array;
  readonly revision: number;
}

/** Result of a cache set or CAS operation. */
export interface CacheSetResult {
  readonly revision: number;
}

// ---------------------------------------------------------------------------
// NexusClient interface
// ---------------------------------------------------------------------------

/**
 * Abstract port for communicating with a Nexus backend.
 *
 * Covers the four Nexus primitives:
 * - Blob store (CAS): content-addressed binary storage
 * - KV store (metastore): ordered key-value storage
 * - Record store: relational queries with indexed fields
 * - Cache store: TTL-based storage with optimistic concurrency
 */
export interface NexusClient {
  // -----------------------------------------------------------------------
  // Blob / CAS
  // -----------------------------------------------------------------------

  /** Store a blob. No-op if hash already exists (CAS dedup). */
  putBlob(data: Uint8Array, hash: string, mediaType?: string): Promise<void>;

  /** Store a file as a blob. Implementations should stream for large files. */
  putBlobFromFile(path: string, hash: string, mediaType?: string): Promise<void>;

  /** Retrieve a blob by hash. Returns undefined if not found. */
  getBlob(hash: string): Promise<Uint8Array | undefined>;

  /** Retrieve a blob to a file. Returns true if found. */
  getBlobToFile(hash: string, path: string): Promise<boolean>;

  /** Check if a blob exists. */
  blobExists(hash: string): Promise<boolean>;

  /** Delete a blob. Returns true if deleted. */
  deleteBlob(hash: string): Promise<boolean>;

  /** Get blob metadata without downloading content. */
  statBlob(hash: string): Promise<BlobStat | undefined>;

  // -----------------------------------------------------------------------
  // KV / metastore
  // -----------------------------------------------------------------------

  /** Store a single key-value pair. */
  kvPut(key: string, value: Uint8Array): Promise<void>;

  /** Store multiple key-value pairs in a batch. */
  kvPutBatch(entries: ReadonlyArray<{ key: string; value: Uint8Array }>): Promise<void>;

  /** Retrieve a value by key. Returns undefined if not found. */
  kvGet(key: string): Promise<Uint8Array | undefined>;

  /** List key-value pairs by prefix. */
  kvList(
    prefix: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ReadonlyArray<{ key: string; value: Uint8Array }>>;

  /** Delete a key. Returns true if deleted. */
  kvDelete(key: string): Promise<boolean>;

  // -----------------------------------------------------------------------
  // Record store
  // -----------------------------------------------------------------------

  /** Insert a record into a table. */
  recordPut(table: string, record: Record<string, JsonValue>): Promise<void>;

  /** Insert multiple records in a batch. */
  recordPutBatch(table: string, records: ReadonlyArray<Record<string, JsonValue>>): Promise<void>;

  /** Query records with filters. */
  recordQuery(
    table: string,
    filter: Record<string, JsonValue>,
    opts?: RecordQueryOpts,
  ): Promise<ReadonlyArray<Record<string, JsonValue>>>;

  /** Count records matching a filter. */
  recordCount(table: string, filter: Record<string, JsonValue>): Promise<number>;

  /** Count records for multiple filters in a batch. */
  recordCountBatch(
    table: string,
    filters: ReadonlyArray<Record<string, JsonValue>>,
  ): Promise<readonly number[]>;

  /** Delete records matching a filter. Returns number of records deleted. */
  recordDelete(table: string, filter: Record<string, JsonValue>): Promise<number>;

  // -----------------------------------------------------------------------
  // Full-text search (optional — implementations may not support this)
  // -----------------------------------------------------------------------

  /** Search records by text query. Returns undefined if not supported. */
  search?(
    table: string,
    query: string,
    filter?: Record<string, JsonValue>,
  ): Promise<ReadonlyArray<Record<string, JsonValue>> | undefined>;

  // -----------------------------------------------------------------------
  // Cache store (TTL + optimistic concurrency)
  // -----------------------------------------------------------------------

  /** Set a cache entry with TTL. Returns the new revision. */
  cacheSet(key: string, value: Uint8Array, ttlMs: number): Promise<CacheSetResult>;

  /** Get a cache entry. Returns undefined if not found or expired. */
  cacheGet(key: string): Promise<CacheEntry | undefined>;

  /**
   * Compare-and-swap: update only if current revision matches.
   * Throws if revision does not match (stale update).
   */
  cacheCAS(
    key: string,
    value: Uint8Array,
    expectedRevision: number,
    ttlMs: number,
  ): Promise<CacheSetResult>;

  /** Delete a cache entry. Returns true if deleted. */
  cacheDelete(key: string): Promise<boolean>;

  /** List cache entries by prefix. */
  cacheList(
    prefix: string,
    opts?: { limit?: number },
  ): Promise<ReadonlyArray<{ key: string; value: Uint8Array; revision: number }>>;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Release resources (connections, handles, etc.). */
  close(): Promise<void>;
}
