/**
 * In-memory MockNexusClient for testing.
 *
 * Implements the full NexusClient interface using Maps and supports
 * failure injection for resilience testing.
 */

import { writeFile } from "node:fs/promises";

import type { JsonValue } from "../core/models.js";
import type {
  BlobStat,
  CacheEntry,
  CacheSetResult,
  NexusClient,
  RecordQueryOpts,
} from "./client.js";
import { NexusConnectionError, NexusRevisionConflictError, NexusTimeoutError } from "./errors.js";

// ---------------------------------------------------------------------------
// Failure injection
// ---------------------------------------------------------------------------

/** Failure modes that can be injected into the mock. */
export type FailureKind = "timeout" | "connection" | "auth";

/** Configuration for failure injection. */
export interface FailureMode {
  /** Number of next calls that should fail. Decremented on each call. */
  readonly failNext: number;
  /** The kind of failure to simulate. */
  readonly failWith: FailureKind;
}

// ---------------------------------------------------------------------------
// Internal cache entry with TTL + revision
// ---------------------------------------------------------------------------

interface CacheRecord {
  value: Uint8Array;
  revision: number;
  expiresAt: number; // epoch ms
}

// ---------------------------------------------------------------------------
// MockNexusClient
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of NexusClient for testing.
 *
 * All data is stored in Maps. Supports failure injection via
 * `setFailureMode()` for resilience testing.
 */
export class MockNexusClient implements NexusClient {
  // Blob store
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly blobMeta = new Map<string, BlobStat>();

  // KV store
  private readonly kv = new Map<string, Uint8Array>();

  // Record store
  private readonly records = new Map<string, Array<Record<string, JsonValue>>>();

  // Cache store
  private readonly cache = new Map<string, CacheRecord>();

  // Failure injection
  private failureMode: { failNext: number; failWith: FailureKind } | undefined;

  // Track whether close() has been called
  private closed = false;

  /**
   * Configure failure injection. The next `failNext` calls to any method
   * will throw the specified error. After that, calls succeed normally.
   */
  setFailureMode(mode: FailureMode | undefined): void {
    this.failureMode = mode !== undefined ? { ...mode } : undefined;
  }

  /** Check if the client has been closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  // -----------------------------------------------------------------------
  // Failure injection helper
  // -----------------------------------------------------------------------

  private maybeThrow(): void {
    if (this.closed) {
      throw new NexusConnectionError("Client is closed");
    }
    if (this.failureMode !== undefined && this.failureMode.failNext > 0) {
      this.failureMode = {
        ...this.failureMode,
        failNext: this.failureMode.failNext - 1,
      };
      switch (this.failureMode.failWith) {
        case "timeout":
          throw new NexusTimeoutError("Mock timeout");
        case "connection":
          throw new NexusConnectionError("Mock ECONNREFUSED");
        case "auth":
          throw new Error("401 Unauthorized");
        default:
          throw new NexusConnectionError("Mock failure");
      }
    }
  }

  // -----------------------------------------------------------------------
  // Blob / CAS
  // -----------------------------------------------------------------------

  async putBlob(data: Uint8Array, hash: string, mediaType?: string): Promise<void> {
    this.maybeThrow();
    this.blobs.set(hash, new Uint8Array(data));
    this.blobMeta.set(hash, {
      sizeBytes: data.byteLength,
      ...(mediaType !== undefined && { mediaType }),
    });
  }

  async putBlobFromFile(path: string, hash: string, mediaType?: string): Promise<void> {
    this.maybeThrow();
    const file = Bun.file(path);
    const data = new Uint8Array(await file.arrayBuffer());
    this.blobs.set(hash, data);
    this.blobMeta.set(hash, {
      sizeBytes: data.byteLength,
      ...(mediaType !== undefined && { mediaType }),
    });
  }

  async getBlob(hash: string): Promise<Uint8Array | undefined> {
    this.maybeThrow();
    const data = this.blobs.get(hash);
    return data !== undefined ? new Uint8Array(data) : undefined;
  }

  async getBlobToFile(hash: string, path: string): Promise<boolean> {
    this.maybeThrow();
    const data = this.blobs.get(hash);
    if (data === undefined) return false;
    await writeFile(path, data);
    return true;
  }

  async blobExists(hash: string): Promise<boolean> {
    this.maybeThrow();
    return this.blobs.has(hash);
  }

  async deleteBlob(hash: string): Promise<boolean> {
    this.maybeThrow();
    const existed = this.blobs.delete(hash);
    this.blobMeta.delete(hash);
    return existed;
  }

  async statBlob(hash: string): Promise<BlobStat | undefined> {
    this.maybeThrow();
    return this.blobMeta.get(hash);
  }

  // -----------------------------------------------------------------------
  // KV / metastore
  // -----------------------------------------------------------------------

  async kvPut(key: string, value: Uint8Array): Promise<void> {
    this.maybeThrow();
    this.kv.set(key, new Uint8Array(value));
  }

  async kvPutBatch(entries: ReadonlyArray<{ key: string; value: Uint8Array }>): Promise<void> {
    this.maybeThrow();
    for (const entry of entries) {
      this.kv.set(entry.key, new Uint8Array(entry.value));
    }
  }

  async kvGet(key: string): Promise<Uint8Array | undefined> {
    this.maybeThrow();
    const data = this.kv.get(key);
    return data !== undefined ? new Uint8Array(data) : undefined;
  }

  async kvList(
    prefix: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ReadonlyArray<{ key: string; value: Uint8Array }>> {
    this.maybeThrow();
    const entries: Array<{ key: string; value: Uint8Array }> = [];
    for (const [key, value] of this.kv) {
      if (key.startsWith(prefix)) {
        entries.push({ key, value: new Uint8Array(value) });
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? entries.length;
    return entries.slice(offset, offset + limit);
  }

  async kvDelete(key: string): Promise<boolean> {
    this.maybeThrow();
    return this.kv.delete(key);
  }

  // -----------------------------------------------------------------------
  // Record store
  // -----------------------------------------------------------------------

  private getTable(table: string): Array<Record<string, JsonValue>> {
    let records = this.records.get(table);
    if (records === undefined) {
      records = [];
      this.records.set(table, records);
    }
    return records;
  }

  async recordPut(table: string, record: Record<string, JsonValue>): Promise<void> {
    this.maybeThrow();
    this.getTable(table).push({ ...record });
  }

  async recordPutBatch(
    table: string,
    records: ReadonlyArray<Record<string, JsonValue>>,
  ): Promise<void> {
    this.maybeThrow();
    const t = this.getTable(table);
    for (const record of records) {
      t.push({ ...record });
    }
  }

  async recordQuery(
    table: string,
    filter: Record<string, JsonValue>,
    opts?: RecordQueryOpts,
  ): Promise<ReadonlyArray<Record<string, JsonValue>>> {
    this.maybeThrow();
    const t = this.getTable(table);
    const results = t.filter((record) => matchesFilter(record, filter));

    // Sort
    if (opts?.orderBy) {
      const dir = opts.orderDir === "asc" ? 1 : -1;
      const key = opts.orderBy;
      results.sort((a, b) => {
        const va = String(a[key] ?? "");
        const vb = String(b[key] ?? "");
        return va.localeCompare(vb) * dir;
      });
    }

    // Pagination
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? results.length;
    return results.slice(offset, offset + limit).map((r) => ({ ...r }));
  }

  async recordCount(table: string, filter: Record<string, JsonValue>): Promise<number> {
    this.maybeThrow();
    const t = this.getTable(table);
    return t.filter((record) => matchesFilter(record, filter)).length;
  }

  async recordCountBatch(
    table: string,
    filters: ReadonlyArray<Record<string, JsonValue>>,
  ): Promise<readonly number[]> {
    this.maybeThrow();
    const t = this.getTable(table);
    return filters.map((filter) => t.filter((record) => matchesFilter(record, filter)).length);
  }

  async recordDelete(table: string, filter: Record<string, JsonValue>): Promise<number> {
    this.maybeThrow();
    const t = this.getTable(table);
    const before = t.length;
    const kept = t.filter((record) => !matchesFilter(record, filter));
    this.records.set(table, kept);
    return before - kept.length;
  }

  // -----------------------------------------------------------------------
  // Full-text search
  // -----------------------------------------------------------------------

  async search(
    table: string,
    query: string,
    filter?: Record<string, JsonValue>,
  ): Promise<ReadonlyArray<Record<string, JsonValue>> | undefined> {
    this.maybeThrow();
    const t = this.getTable(table);
    const lowerQuery = query.toLowerCase();
    return t
      .filter((record) => {
        // Match against all string values in the record
        const textMatch = Object.values(record).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(lowerQuery),
        );
        if (!textMatch) return false;
        if (filter !== undefined) return matchesFilter(record, filter);
        return true;
      })
      .map((r) => ({ ...r }));
  }

  // -----------------------------------------------------------------------
  // Cache store
  // -----------------------------------------------------------------------

  async cacheSet(key: string, value: Uint8Array, ttlMs: number): Promise<CacheSetResult> {
    this.maybeThrow();
    const existing = this.cache.get(key);
    const revision = (existing?.revision ?? 0) + 1;
    this.cache.set(key, {
      value: new Uint8Array(value),
      revision,
      expiresAt: Date.now() + ttlMs,
    });
    return { revision };
  }

  async cacheGet(key: string): Promise<CacheEntry | undefined> {
    this.maybeThrow();
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return { value: new Uint8Array(entry.value), revision: entry.revision };
  }

  async cacheCAS(
    key: string,
    value: Uint8Array,
    expectedRevision: number,
    ttlMs: number,
  ): Promise<CacheSetResult> {
    this.maybeThrow();
    const existing = this.cache.get(key);
    const currentRevision = existing?.revision ?? 0;

    if (currentRevision !== expectedRevision) {
      throw new NexusRevisionConflictError({
        message: `CAS conflict on key '${key}': expected revision ${expectedRevision}, got ${currentRevision}`,
        expectedRevision,
        actualRevision: currentRevision,
      });
    }

    const newRevision = currentRevision + 1;
    this.cache.set(key, {
      value: new Uint8Array(value),
      revision: newRevision,
      expiresAt: Date.now() + ttlMs,
    });
    return { revision: newRevision };
  }

  async cacheDelete(key: string): Promise<boolean> {
    this.maybeThrow();
    return this.cache.delete(key);
  }

  async cacheList(
    prefix: string,
    opts?: { limit?: number },
  ): Promise<ReadonlyArray<{ key: string; value: Uint8Array; revision: number }>> {
    this.maybeThrow();
    const now = Date.now();
    const entries: Array<{ key: string; value: Uint8Array; revision: number }> = [];
    for (const [key, entry] of this.cache) {
      if (key.startsWith(prefix) && entry.expiresAt >= now) {
        entries.push({
          key,
          value: new Uint8Array(entry.value),
          revision: entry.revision,
        });
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    if (opts?.limit !== undefined) {
      return entries.slice(0, opts.limit);
    }
    return entries;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if a record matches a filter.
 * All filter keys must match the record's values.
 */
function matchesFilter(
  record: Record<string, JsonValue>,
  filter: Record<string, JsonValue>,
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (record[key] !== value) return false;
  }
  return true;
}
