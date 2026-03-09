/**
 * Content-Addressable Storage (CAS) protocol.
 *
 * Artifacts are stored by BLAKE3 content hash.
 * Implementations handle deduplication automatically.
 */

import type { Artifact } from "./models.js";

/** Options for storing artifacts. */
export interface PutOptions {
  /**
   * Advisory media type for the blob (e.g., "application/json").
   * Persisted alongside the content for retrieval via `stat()`.
   */
  readonly mediaType?: string | undefined;
}

/**
 * Abstract content store — storage backends implement this.
 *
 * All content hashes use the format `blake3:<64-char-lowercase-hex>`
 * (71 characters total). This applies to both return values and parameters.
 *
 * The recommended local filesystem layout is:
 *   {root}/{hash[0:2]}/{hash[2:4]}/{hash}
 * where {hash} is the 64-char hex portion (without the `blake3:` prefix).
 * This layout is an implementation recommendation, not a protocol requirement.
 */
export interface ContentStore {
  /**
   * Store bytes and return the content hash.
   * @returns Content hash in `blake3:<hex64>` format.
   */
  put(data: Uint8Array, options?: PutOptions): Promise<string>;

  /** Retrieve bytes by content hash. Returns undefined if not found. */
  get(contentHash: string): Promise<Uint8Array | undefined>;

  /** Check if content exists. */
  exists(contentHash: string): Promise<boolean>;

  /** Delete content by hash. Returns true if deleted. */
  delete(contentHash: string): Promise<boolean>;

  /**
   * Store a file and return the content hash.
   * Preferred over `put()` for large artifacts — implementations SHOULD
   * use streaming I/O and incremental BLAKE3 hashing.
   * @returns Content hash in `blake3:<hex64>` format.
   */
  putFile(path: string, options?: PutOptions): Promise<string>;

  /** Retrieve content to a file. Returns true if found and written. */
  getToFile(contentHash: string, path: string): Promise<boolean>;

  /**
   * Get artifact metadata without downloading the blob bytes.
   * Returns content hash, size, and optional media type.
   */
  stat(contentHash: string): Promise<Artifact | undefined>;

  /** Release resources (e.g., clean up temp files). */
  close(): void;
}
