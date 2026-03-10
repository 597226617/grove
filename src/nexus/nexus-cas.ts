/**
 * Nexus-backed ContentStore adapter.
 *
 * Implements the ContentStore interface using a NexusClient for
 * content-addressed blob storage. Uses BLAKE3 hashing (same as Nexus native).
 *
 * Features:
 * - Zone-scoped blob keys for multi-tenancy
 * - exists-before-put optimization for large blobs (configurable threshold)
 * - LRU cache for exists() and stat() (immutable data)
 * - Concurrency semaphore to limit parallel Nexus requests
 * - Retry with exponential backoff for transient errors
 */

import { createReadStream } from "node:fs";

import { createHash as createBlake3, hash } from "blake3";

import type { ContentStore, PutOptions } from "../core/cas.js";
import { validateMediaType } from "../core/cas.js";
import type { Artifact } from "../core/models.js";
import type { NexusClient } from "./client.js";
import type { NexusConfig, ResolvedNexusConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import { isRetryable, mapNexusError } from "./errors.js";
import { LruCache } from "./lru-cache.js";
import { Semaphore } from "./semaphore.js";

/** Prefix for BLAKE3 content hashes. */
const HASH_PREFIX = "blake3:";

/** Pattern for valid hex portion: exactly 64 lowercase hex characters. */
const HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Compute the BLAKE3 hash of a Uint8Array and return the prefixed hex string.
 */
function computeHash(data: Uint8Array): string {
  const digest = hash(data).toString("hex");
  return `${HASH_PREFIX}${digest}`;
}

/**
 * Validate and extract the hex portion from a content hash string.
 */
function validateHash(contentHash: string): void {
  if (!contentHash.startsWith(HASH_PREFIX)) {
    throw new Error(`Invalid content hash prefix: expected '${HASH_PREFIX}', got '${contentHash}'`);
  }
  const hex = contentHash.slice(HASH_PREFIX.length);
  if (!HEX_PATTERN.test(hex)) {
    throw new Error("Invalid content hash: hex portion must be 64 lowercase hex characters");
  }
}

/**
 * Nexus-backed Content-Addressable Storage.
 */
export class NexusCas implements ContentStore {
  private readonly client: NexusClient;
  private readonly config: ResolvedNexusConfig;
  private readonly prefix: string;
  private readonly semaphore: Semaphore;
  private readonly existsCache: LruCache<boolean>;
  private readonly statCache: LruCache<Artifact>;

  constructor(config: NexusConfig) {
    this.config = resolveConfig(config);
    this.client = this.config.client;
    this.prefix = `${this.config.zoneId}/cas/`;
    this.semaphore = new Semaphore(this.config.maxConcurrency);
    this.existsCache = new LruCache(this.config.cacheMaxEntries);
    this.statCache = new LruCache(this.config.cacheMaxEntries);
  }

  async put(data: Uint8Array, options?: PutOptions): Promise<string> {
    // Normalize empty mediaType to undefined
    const mediaType = options?.mediaType || undefined;
    if (mediaType) validateMediaType(mediaType);

    const contentHash = computeHash(data);
    const blobKey = this.blobKey(contentHash);

    // Exists-before-put optimization for large blobs
    if (data.byteLength > this.config.existsThresholdBytes) {
      const exists = await this.withRetry(
        () => this.runWithSemaphore(() => this.client.blobExists(blobKey)),
        "put.exists",
      );
      if (exists) {
        // Update metadata if provided (last-writer-wins, like FsCas)
        if (mediaType) {
          await this.withRetry(
            () =>
              this.runWithSemaphore(() =>
                this.client.putBlob(new Uint8Array(0), this.metaKey(contentHash), mediaType),
              ),
            "put.meta",
          );
        }
        this.existsCache.set(contentHash, true);
        return contentHash;
      }
    }

    await this.withRetry(
      () => this.runWithSemaphore(() => this.client.putBlob(data, blobKey, mediaType)),
      "put",
    );

    this.existsCache.set(contentHash, true);
    this.statCache.delete(contentHash);
    return contentHash;
  }

  async get(contentHash: string): Promise<Uint8Array | undefined> {
    validateHash(contentHash);
    const blobKey = this.blobKey(contentHash);
    return this.withRetry(() => this.runWithSemaphore(() => this.client.getBlob(blobKey)), "get");
  }

  async exists(contentHash: string): Promise<boolean> {
    validateHash(contentHash);

    const cached = this.existsCache.get(contentHash);
    if (cached !== undefined) return cached;

    const blobKey = this.blobKey(contentHash);
    const exists = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.blobExists(blobKey)),
      "exists",
    );
    if (exists) this.existsCache.set(contentHash, true);
    return exists;
  }

  async delete(contentHash: string): Promise<boolean> {
    validateHash(contentHash);
    const blobKey = this.blobKey(contentHash);
    const deleted = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.deleteBlob(blobKey)),
      "delete",
    );
    // Also delete metadata sidecar
    const metaKey = this.metaKey(contentHash);
    await this.withRetry(
      () => this.runWithSemaphore(() => this.client.deleteBlob(metaKey)),
      "delete.meta",
    ).catch(() => {});
    this.existsCache.delete(contentHash);
    this.statCache.delete(contentHash);
    return deleted;
  }

  async putFile(path: string, options?: PutOptions): Promise<string> {
    const mediaType = options?.mediaType || undefined;
    if (mediaType) validateMediaType(mediaType);

    // Stream through BLAKE3 hasher
    const hasher = createBlake3();
    try {
      for await (const chunk of createReadStream(path)) {
        hasher.update(chunk);
      }
    } catch (err) {
      hasher.dispose();
      throw err;
    }
    const contentHash = `${HASH_PREFIX}${hasher.digest("hex")}`;
    const blobKey = this.blobKey(contentHash);

    // Exists-before-put — file-based puts are always "large"
    const exists = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.blobExists(blobKey)),
      "putFile.exists",
    );
    if (exists) {
      if (mediaType) {
        await this.withRetry(
          () =>
            this.runWithSemaphore(() =>
              this.client.putBlob(new Uint8Array(0), this.metaKey(contentHash), mediaType),
            ),
          "putFile.meta",
        );
      }
      this.existsCache.set(contentHash, true);
      return contentHash;
    }

    await this.withRetry(
      () => this.runWithSemaphore(() => this.client.putBlobFromFile(path, blobKey, mediaType)),
      "putFile",
    );

    this.existsCache.set(contentHash, true);
    this.statCache.delete(contentHash);
    return contentHash;
  }

  async getToFile(contentHash: string, path: string): Promise<boolean> {
    validateHash(contentHash);
    const blobKey = this.blobKey(contentHash);
    return this.withRetry(
      () => this.runWithSemaphore(() => this.client.getBlobToFile(blobKey, path)),
      "getToFile",
    );
  }

  async stat(contentHash: string): Promise<Artifact | undefined> {
    validateHash(contentHash);

    const cached = this.statCache.get(contentHash);
    if (cached !== undefined) return cached;

    const blobKey = this.blobKey(contentHash);
    const blobStat = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.statBlob(blobKey)),
      "stat",
    );
    if (blobStat === undefined) return undefined;

    const artifact: Artifact = {
      contentHash,
      sizeBytes: blobStat.sizeBytes,
      ...(blobStat.mediaType ? { mediaType: blobStat.mediaType } : {}),
    };
    this.statCache.set(contentHash, artifact);
    this.existsCache.set(contentHash, true);
    return artifact;
  }

  close(): void {
    // No-op — lifecycle managed by client
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private blobKey(contentHash: string): string {
    return `${this.prefix}${contentHash}`;
  }

  private metaKey(contentHash: string): string {
    return `${this.prefix}${contentHash}.meta`;
  }

  private async runWithSemaphore<T>(fn: () => Promise<T>): Promise<T> {
    return this.semaphore.run(fn);
  }

  private async withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.config.retryMaxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.config.retryMaxAttempts - 1) {
          throw mapNexusError(error, context);
        }
        const delay = Math.min(
          this.config.retryBaseDelayMs * 2 ** attempt,
          this.config.retryMaxDelayMs,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw mapNexusError(lastError, context);
  }
}
