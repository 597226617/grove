/**
 * Nexus-backed ContributionStore and ClaimStore adapters.
 *
 * Contributions (immutable) are stored in the Nexus KV store (metastore).
 * Relations and tags are stored in the Nexus record store (relational queries).
 * Claims (mutable) are stored in the Nexus cache store (TTL + optimistic concurrency).
 *
 * Features:
 * - Zone-scoped keys for multi-tenancy
 * - Batch operations via NexusClient batch methods
 * - LRU cache for immutable contribution reads
 * - Concurrency semaphore
 * - Retry with exponential backoff
 * - Optimistic concurrency via revision numbers on claims
 */

import {
  computeLeaseDuration,
  DEFAULT_LEASE_DURATION_MS,
  resolveClaimOrRenew,
  validateClaimContext,
  validateHeartbeat,
  validateTransition,
} from "../core/claim-logic.js";
import { fromManifest, toManifest, verifyCid } from "../core/manifest.js";
import type {
  Claim,
  ClaimStatus,
  Contribution,
  ContributionKind,
  JsonValue,
  Relation,
  RelationType,
} from "../core/models.js";
import type {
  ActiveClaimFilter,
  ClaimQuery,
  ClaimStore,
  ContributionQuery,
  ContributionStore,
  ExpiredClaim,
  ExpireStaleOptions,
  ThreadNode,
} from "../core/store.js";
import { ExpiryReason } from "../core/store.js";
import { toUtcIso } from "../core/time.js";
import type { NexusClient } from "./client.js";
import type { NexusConfig, ResolvedNexusConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import { isRetryable, mapNexusError } from "./errors.js";
import { LruCache } from "./lru-cache.js";
import { Semaphore } from "./semaphore.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj));
}

function decode<T>(data: Uint8Array): T {
  return JSON.parse(decoder.decode(data)) as T;
}

// ---------------------------------------------------------------------------
// NexusContributionStore
// ---------------------------------------------------------------------------

/**
 * Nexus-backed ContributionStore.
 *
 * Contributions are stored as JSON manifests in the KV store.
 * Relations and tags are stored in the record store for indexed queries.
 */
export class NexusContributionStore implements ContributionStore {
  readonly storeIdentity: string;
  private readonly client: NexusClient;
  private readonly config: ResolvedNexusConfig;
  private readonly semaphore: Semaphore;
  private readonly cache: LruCache<Contribution>;

  // Key prefixes
  private readonly kvPrefix: string;
  private readonly relationsTable: string;
  private readonly tagsTable: string;
  private readonly ftsTable: string;

  constructor(config: NexusConfig) {
    this.config = resolveConfig(config);
    this.client = this.config.client;
    this.storeIdentity = `nexus:${this.config.zoneId}:contributions`;
    this.semaphore = new Semaphore(this.config.maxConcurrency);
    this.cache = new LruCache(this.config.cacheMaxEntries);

    this.kvPrefix = `${this.config.zoneId}/contributions/`;
    this.relationsTable = `${this.config.zoneId}_relations`;
    this.tagsTable = `${this.config.zoneId}_tags`;
    this.ftsTable = `${this.config.zoneId}_fts`;
  }

  async put(contribution: Contribution): Promise<void> {
    if (!verifyCid(contribution)) {
      throw new Error(
        `CID integrity check failed for '${contribution.cid}': CID does not match manifest content`,
      );
    }

    const manifest = toManifest(contribution);
    const key = `${this.kvPrefix}${contribution.cid}`;
    const value = encode(manifest);

    await this.withRetry(async () => {
      // Check if already exists (idempotent put)
      const existing = await this.runWithSemaphore(() => this.client.kvGet(key));
      if (existing !== undefined) return;

      // Store manifest
      await this.runWithSemaphore(() => this.client.kvPut(key, value));

      // Store relations
      if (contribution.relations.length > 0) {
        const relationRecords = contribution.relations.map((r) => ({
          sourceCid: contribution.cid as JsonValue,
          targetCid: r.targetCid as JsonValue,
          relationType: r.relationType as JsonValue,
          metadata: (r.metadata !== undefined ? JSON.stringify(r.metadata) : null) as JsonValue,
          createdAt: contribution.createdAt as JsonValue,
        }));
        await this.runWithSemaphore(() =>
          this.client.recordPutBatch(this.relationsTable, relationRecords),
        );
      }

      // Store tags
      if (contribution.tags.length > 0) {
        const tagRecords = contribution.tags.map((tag) => ({
          cid: contribution.cid as JsonValue,
          tag: tag as JsonValue,
        }));
        await this.runWithSemaphore(() => this.client.recordPutBatch(this.tagsTable, tagRecords));
      }

      // Store FTS entry
      await this.runWithSemaphore(() =>
        this.client.recordPut(this.ftsTable, {
          cid: contribution.cid as JsonValue,
          summary: contribution.summary as JsonValue,
          description: (contribution.description ?? "") as JsonValue,
          kind: contribution.kind as JsonValue,
          mode: contribution.mode as JsonValue,
          agentId: contribution.agent.agentId as JsonValue,
          agentName: (contribution.agent.agentName ?? null) as JsonValue,
          createdAt: toUtcIso(contribution.createdAt) as JsonValue,
          tags: JSON.stringify(contribution.tags) as JsonValue,
        }),
      );
    }, "put");

    this.cache.set(contribution.cid, contribution);
  }

  async putMany(contributions: readonly Contribution[]): Promise<void> {
    // Filter out duplicates (same CID) and already-stored
    const unique = new Map<string, Contribution>();
    for (const c of contributions) {
      unique.set(c.cid, c);
    }
    for (const c of unique.values()) {
      await this.put(c);
    }
  }

  async get(cid: string): Promise<Contribution | undefined> {
    const cached = this.cache.get(cid);
    if (cached !== undefined) return cached;

    const key = `${this.kvPrefix}${cid}`;
    const data = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.kvGet(key)),
      "get",
    );
    if (data === undefined) return undefined;

    const manifest = decode<Record<string, unknown>>(data);
    const contribution = fromManifest(manifest, { verify: false });
    this.cache.set(cid, contribution);
    return contribution;
  }

  async list(query?: ContributionQuery): Promise<readonly Contribution[]> {
    const filter: Record<string, JsonValue> = {};
    if (query?.kind !== undefined) filter.kind = query.kind;
    if (query?.mode !== undefined) filter.mode = query.mode;
    if (query?.agentId !== undefined) filter.agentId = query.agentId;
    if (query?.agentName !== undefined) filter.agentName = query.agentName;

    let records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.ftsTable, filter, {
            orderBy: "createdAt",
            orderDir: "desc",
            limit: query?.limit,
            offset: query?.offset,
          }),
        ),
      "list",
    );

    // Tag intersection filter
    if (query?.tags !== undefined && query.tags.length > 0) {
      const queriedTags = query.tags;
      records = records.filter((r) => {
        const recordTags: string[] = JSON.parse(r.tags as string);
        return queriedTags.every((t) => recordTags.includes(t));
      });
    }

    // Resolve full contributions from CIDs
    const contributions: Contribution[] = [];
    for (const r of records) {
      const c = await this.get(r.cid as string);
      if (c !== undefined) contributions.push(c);
    }
    return contributions;
  }

  async children(cid: string): Promise<readonly Contribution[]> {
    const records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.relationsTable, { targetCid: cid as JsonValue }),
        ),
      "children",
    );

    const contributions: Contribution[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      const sourceCid = r.sourceCid as string;
      if (seen.has(sourceCid)) continue;
      seen.add(sourceCid);
      const c = await this.get(sourceCid);
      if (c !== undefined) contributions.push(c);
    }
    return contributions;
  }

  async ancestors(cid: string): Promise<readonly Contribution[]> {
    const records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.relationsTable, { sourceCid: cid as JsonValue }),
        ),
      "ancestors",
    );

    const contributions: Contribution[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      const targetCid = r.targetCid as string;
      if (seen.has(targetCid)) continue;
      seen.add(targetCid);
      const c = await this.get(targetCid);
      if (c !== undefined) contributions.push(c);
    }
    return contributions;
  }

  async relationsOf(cid: string, relationType?: RelationType): Promise<readonly Relation[]> {
    const filter: Record<string, JsonValue> = { sourceCid: cid as JsonValue };
    if (relationType !== undefined) filter.relationType = relationType as JsonValue;

    const records = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordQuery(this.relationsTable, filter)),
      "relationsOf",
    );

    return records.map((r) => ({
      targetCid: r.targetCid as string,
      relationType: r.relationType as RelationType,
      ...(r.metadata !== null && r.metadata !== undefined
        ? { metadata: JSON.parse(r.metadata as string) as Readonly<Record<string, JsonValue>> }
        : {}),
    }));
  }

  async relatedTo(cid: string, relationType?: RelationType): Promise<readonly Contribution[]> {
    const filter: Record<string, JsonValue> = { targetCid: cid as JsonValue };
    if (relationType !== undefined) filter.relationType = relationType as JsonValue;

    const records = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordQuery(this.relationsTable, filter)),
      "relatedTo",
    );

    const contributions: Contribution[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      const sourceCid = r.sourceCid as string;
      if (seen.has(sourceCid)) continue;
      seen.add(sourceCid);
      const c = await this.get(sourceCid);
      if (c !== undefined) contributions.push(c);
    }
    return contributions;
  }

  async search(query: string, filters?: ContributionQuery): Promise<readonly Contribution[]> {
    const filter: Record<string, JsonValue> = {};
    if (filters?.kind !== undefined) filter.kind = filters.kind;
    if (filters?.mode !== undefined) filter.mode = filters.mode;
    if (filters?.agentId !== undefined) filter.agentId = filters.agentId;
    if (filters?.agentName !== undefined) filter.agentName = filters.agentName;

    // Use client.search if available
    const searchFn = this.client.search;
    if (searchFn !== undefined) {
      const records = await this.withRetry(
        () => this.runWithSemaphore(() => searchFn.call(this.client, this.ftsTable, query, filter)),
        "search",
      );
      if (records !== undefined) {
        let filteredRecords = records;
        if (filters?.tags !== undefined && filters.tags.length > 0) {
          const queriedTags = filters.tags;
          filteredRecords = records.filter((r) => {
            const recordTags: string[] = JSON.parse(r.tags as string);
            return queriedTags.every((t) => recordTags.includes(t));
          });
        }
        const contributions: Contribution[] = [];
        for (const r of filteredRecords) {
          const c = await this.get(r.cid as string);
          if (c !== undefined) contributions.push(c);
        }
        return contributions;
      }
    }

    // Fallback: query all and filter by text
    const allRecords = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordQuery(this.ftsTable, filter)),
      "search.fallback",
    );

    const lowerQuery = query.toLowerCase();
    const matchingRecords = allRecords.filter((r) => {
      const summary = (r.summary as string).toLowerCase();
      const description = ((r.description as string) ?? "").toLowerCase();
      return summary.includes(lowerQuery) || description.includes(lowerQuery);
    });

    if (filters?.tags !== undefined && filters.tags.length > 0) {
      const queriedTags = filters.tags;
      const tagFiltered = matchingRecords.filter((r) => {
        const recordTags: string[] = JSON.parse(r.tags as string);
        return queriedTags.every((t) => recordTags.includes(t));
      });
      const contributions: Contribution[] = [];
      for (const r of tagFiltered) {
        const c = await this.get(r.cid as string);
        if (c !== undefined) contributions.push(c);
      }
      return contributions;
    }

    const contributions: Contribution[] = [];
    for (const r of matchingRecords) {
      const c = await this.get(r.cid as string);
      if (c !== undefined) contributions.push(c);
    }
    return contributions;
  }

  async findExisting(
    agentId: string,
    targetCid: string,
    kind: ContributionKind,
    relationType?: RelationType,
  ): Promise<readonly Contribution[]> {
    // Find relations pointing to targetCid
    const relFilter: Record<string, JsonValue> = { targetCid: targetCid as JsonValue };
    if (relationType !== undefined) relFilter.relationType = relationType as JsonValue;

    const relationRecords = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordQuery(this.relationsTable, relFilter)),
      "findExisting.relations",
    );

    const candidateCids = new Set(relationRecords.map((r) => r.sourceCid as string));

    // Filter by agentId and kind via FTS table
    const contributions: Contribution[] = [];
    for (const cid of candidateCids) {
      const c = await this.get(cid);
      if (c !== undefined && c.agent.agentId === agentId && c.kind === kind) {
        contributions.push(c);
      }
    }

    // Sort by createdAt descending (most recent first)
    contributions.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

    return contributions;
  }

  async count(query?: ContributionQuery): Promise<number> {
    const filter: Record<string, JsonValue> = {};
    if (query?.kind !== undefined) filter.kind = query.kind;
    if (query?.mode !== undefined) filter.mode = query.mode;
    if (query?.agentId !== undefined) filter.agentId = query.agentId;
    if (query?.agentName !== undefined) filter.agentName = query.agentName;

    if (query?.tags !== undefined && query.tags.length > 0) {
      // Need to count with tag filtering — fetch records and filter
      const records = await this.withRetry(
        () => this.runWithSemaphore(() => this.client.recordQuery(this.ftsTable, filter)),
        "count",
      );
      const queriedTags = query.tags;
      return records.filter((r) => {
        const recordTags: string[] = JSON.parse(r.tags as string);
        return queriedTags.every((t) => recordTags.includes(t));
      }).length;
    }

    return this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordCount(this.ftsTable, filter)),
      "count",
    );
  }

  async thread(
    rootCid: string,
    opts?: { readonly maxDepth?: number; readonly limit?: number },
  ): Promise<readonly ThreadNode[]> {
    const maxDepth = opts?.maxDepth ?? 50;

    // Check root exists
    const root = await this.get(rootCid);
    if (root === undefined) return [];

    const result: ThreadNode[] = [{ contribution: root, depth: 0 }];
    const seen = new Set<string>([rootCid]);
    let currentLevel = [rootCid];

    for (let depth = 1; depth <= maxDepth && currentLevel.length > 0; depth++) {
      const nextLevel: string[] = [];

      // For each CID in current level, find responds_to relations
      for (const parentCid of currentLevel) {
        const records = await this.withRetry(
          () =>
            this.runWithSemaphore(() =>
              this.client.recordQuery(this.relationsTable, {
                targetCid: parentCid as JsonValue,
                relationType: "responds_to" as JsonValue,
              }),
            ),
          "thread.walk",
        );

        for (const r of records) {
          const childCid = r.sourceCid as string;
          if (seen.has(childCid)) continue;
          seen.add(childCid);

          const c = await this.get(childCid);
          if (c !== undefined) {
            result.push({ contribution: c, depth });
            nextLevel.push(childCid);
          }
        }
      }

      currentLevel = nextLevel;

      if (opts?.limit !== undefined && result.length >= opts.limit) {
        return result.slice(0, opts.limit);
      }
    }

    // Sort: depth ASC, then createdAt ASC within each depth
    result.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (
        new Date(a.contribution.createdAt).getTime() - new Date(b.contribution.createdAt).getTime()
      );
    });

    return opts?.limit !== undefined ? result.slice(0, opts.limit) : result;
  }

  async replyCounts(cids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const result = new Map<string, number>();
    for (const cid of cids) {
      result.set(cid, 0);
    }
    if (cids.length === 0) return result;

    // Batch count via recordCountBatch
    const filters = cids.map((cid) => ({
      targetCid: cid as JsonValue,
      relationType: "responds_to" as JsonValue,
    }));

    const counts = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordCountBatch(this.relationsTable, filters)),
      "replyCounts",
    );

    for (let i = 0; i < cids.length; i++) {
      const cid = cids[i];
      const count = counts[i];
      if (cid !== undefined && count !== undefined) {
        result.set(cid, count);
      }
    }
    return result;
  }

  close(): void {
    // No-op — lifecycle managed by client
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// NexusClaimStore
// ---------------------------------------------------------------------------

/**
 * Nexus-backed ClaimStore.
 *
 * Claims are stored in the Nexus cache store with TTL and revision-based
 * optimistic concurrency. Also uses the record store for indexed queries.
 */
export class NexusClaimStore implements ClaimStore {
  readonly storeIdentity: string;
  private readonly client: NexusClient;
  private readonly config: ResolvedNexusConfig;
  private readonly semaphore: Semaphore;
  private readonly claimsTable: string;

  constructor(config: NexusConfig) {
    this.config = resolveConfig(config);
    this.client = this.config.client;
    this.storeIdentity = `nexus:${this.config.zoneId}:claims`;
    this.semaphore = new Semaphore(this.config.maxConcurrency);
    this.claimsTable = `${this.config.zoneId}_claims`;
  }

  async createClaim(claim: Claim): Promise<Claim> {
    validateClaimContext(claim);

    const now = new Date();
    const _nowIso = now.toISOString();

    // Check for duplicate claimId
    const existingById = await this.getClaimRecord(claim.claimId);
    if (existingById !== undefined) {
      throw new Error(`Claim with id '${claim.claimId}' already exists`);
    }

    // Check for active claim on target
    const activeOnTarget = await this.findActiveClaimOnTarget(claim.targetRef, now);
    if (activeOnTarget !== undefined) {
      throw new Error(
        `Target '${claim.targetRef}' already has an active claim '${activeOnTarget.claimId}'`,
      );
    }

    // Create the claim
    const createdClaim: Claim = {
      ...claim,
      createdAt: toUtcIso(claim.createdAt),
      heartbeatAt: toUtcIso(claim.heartbeatAt),
      leaseExpiresAt: toUtcIso(claim.leaseExpiresAt),
      revision: 1,
    };

    await this.storeClaimRecord(createdClaim);
    return createdClaim;
  }

  async claimOrRenew(claim: Claim): Promise<Claim> {
    validateClaimContext(claim);

    const now = new Date();
    const nowIso = now.toISOString();

    const activeOnTarget = await this.findActiveClaimOnTarget(claim.targetRef, now);
    const resolution = resolveClaimOrRenew(
      activeOnTarget !== undefined
        ? { claimId: activeOnTarget.claimId, agentId: activeOnTarget.agent.agentId }
        : undefined,
      claim.agent.agentId,
      claim.targetRef,
    );

    if (resolution.action === "renew" && activeOnTarget !== undefined) {
      // Renew the existing claim
      const existing = activeOnTarget;
      const durationMs = computeLeaseDuration(claim);
      const renewed: Claim = {
        ...existing,
        heartbeatAt: nowIso,
        leaseExpiresAt: new Date(now.getTime() + durationMs).toISOString(),
        intentSummary: claim.intentSummary,
        revision: (existing.revision ?? 0) + 1,
      };
      await this.updateClaimRecord(renewed);
      return renewed;
    }

    // Create new claim
    const existingById = await this.getClaimRecord(claim.claimId);
    if (existingById !== undefined) {
      throw new Error(`Claim with id '${claim.claimId}' already exists`);
    }

    const createdClaim: Claim = {
      ...claim,
      createdAt: toUtcIso(claim.createdAt),
      heartbeatAt: toUtcIso(claim.heartbeatAt),
      leaseExpiresAt: toUtcIso(claim.leaseExpiresAt),
      revision: 1,
    };
    await this.storeClaimRecord(createdClaim);
    return createdClaim;
  }

  async getClaim(claimId: string): Promise<Claim | undefined> {
    return this.getClaimRecord(claimId);
  }

  async heartbeat(claimId: string, leaseDurationMs?: number): Promise<Claim> {
    const existing = await this.getClaimRecord(claimId);
    validateHeartbeat(existing, claimId);
    // After validateHeartbeat, existing is guaranteed to be defined
    const validClaim = existing as Claim;

    const now = new Date();
    const duration = leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    const updated: Claim = {
      ...validClaim,
      heartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + duration).toISOString(),
      revision: (validClaim.revision ?? 0) + 1,
    };

    await this.updateClaimRecord(updated);
    return updated;
  }

  async release(claimId: string): Promise<Claim> {
    return this.transitionClaim(claimId, "released" as ClaimStatus);
  }

  async complete(claimId: string): Promise<Claim> {
    return this.transitionClaim(claimId, "completed" as ClaimStatus);
  }

  async expireStale(options?: ExpireStaleOptions): Promise<readonly ExpiredClaim[]> {
    const now = new Date();
    const results: ExpiredClaim[] = [];

    // Get all claims with status "active" (including lease-expired ones)
    const activeClaims = await this.getAllActiveStatusClaims();

    for (const claim of activeClaims) {
      let reason: typeof ExpiryReason.LeaseExpired | typeof ExpiryReason.Stalled | undefined;

      if (new Date(claim.leaseExpiresAt).getTime() < now.getTime()) {
        reason = ExpiryReason.LeaseExpired;
      } else if (
        options?.stallThresholdMs !== undefined &&
        new Date(claim.heartbeatAt).getTime() < now.getTime() - options.stallThresholdMs
      ) {
        reason = ExpiryReason.Stalled;
      }

      if (reason !== undefined) {
        const expired: Claim = {
          ...claim,
          status: "expired" as ClaimStatus,
          revision: (claim.revision ?? 0) + 1,
        };
        await this.updateClaimRecord(expired);
        results.push({ claim: expired, reason });
      }
    }

    return results;
  }

  async activeClaims(targetRef?: string): Promise<readonly Claim[]> {
    const all = await this.getActiveClaimRecords();
    if (targetRef === undefined) return all;
    return all.filter((c) => c.targetRef === targetRef);
  }

  async listClaims(query?: ClaimQuery): Promise<readonly Claim[]> {
    const records = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordQuery(this.claimsTable, {})),
      "listClaims",
    );

    let claims = records.map((r) => this.recordToClaim(r));

    if (query?.status !== undefined) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      claims = claims.filter((c) => statuses.includes(c.status));
    }
    if (query?.agentId !== undefined) {
      claims = claims.filter((c) => c.agent.agentId === query.agentId);
    }
    if (query?.targetRef !== undefined) {
      claims = claims.filter((c) => c.targetRef === query.targetRef);
    }

    // Order by createdAt descending
    claims.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return claims;
  }

  async cleanCompleted(retentionMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionMs);
    const records = await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordQuery(this.claimsTable, {})),
      "cleanCompleted",
    );

    let deleted = 0;
    for (const r of records) {
      const status = r.status as string;
      if (["completed", "expired", "released"].includes(status)) {
        const heartbeatAt = new Date(r.heartbeatAt as string);
        if (heartbeatAt.getTime() < cutoff.getTime()) {
          const claimId = r.claimId as string;
          await this.withRetry(
            () =>
              this.runWithSemaphore(() =>
                this.client.recordDelete(this.claimsTable, { claimId: claimId as JsonValue }),
              ),
            "cleanCompleted.delete",
          );
          deleted++;
        }
      }
    }
    return deleted;
  }

  async countActiveClaims(filter?: ActiveClaimFilter): Promise<number> {
    const claims = await this.getActiveClaimRecords();
    let filtered = claims;
    if (filter?.agentId !== undefined) {
      filtered = filtered.filter((c) => c.agent.agentId === filter.agentId);
    }
    if (filter?.targetRef !== undefined) {
      filtered = filtered.filter((c) => c.targetRef === filter.targetRef);
    }
    return filtered.length;
  }

  async detectStalled(stallTimeoutMs: number): Promise<readonly Claim[]> {
    const now = new Date();
    const stallCutoff = new Date(now.getTime() - stallTimeoutMs);
    const claims = await this.getActiveClaimRecords();
    return claims.filter((c) => {
      return (
        new Date(c.leaseExpiresAt).getTime() >= now.getTime() &&
        new Date(c.heartbeatAt).getTime() < stallCutoff.getTime()
      );
    });
  }

  close(): void {
    // No-op — lifecycle managed by client
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async transitionClaim(claimId: string, newStatus: ClaimStatus): Promise<Claim> {
    const existing = await this.getClaimRecord(claimId);
    validateTransition(existing, claimId, newStatus);
    const validClaim = existing as Claim;

    const updated: Claim = {
      ...validClaim,
      status: newStatus,
      revision: (validClaim.revision ?? 0) + 1,
    };
    await this.updateClaimRecord(updated);
    return updated;
  }

  private claimToRecord(claim: Claim): Record<string, JsonValue> {
    return {
      claimId: claim.claimId,
      targetRef: claim.targetRef,
      agentId: claim.agent.agentId,
      agentJson: JSON.stringify(claim.agent),
      status: claim.status,
      intentSummary: claim.intentSummary,
      createdAt: claim.createdAt,
      heartbeatAt: claim.heartbeatAt,
      leaseExpiresAt: claim.leaseExpiresAt,
      contextJson: claim.context !== undefined ? JSON.stringify(claim.context) : null,
      attemptCount: claim.attemptCount ?? 0,
      revision: claim.revision ?? 0,
    };
  }

  private recordToClaim(r: Record<string, JsonValue>): Claim {
    const agent = JSON.parse(r.agentJson as string);
    return {
      claimId: r.claimId as string,
      targetRef: r.targetRef as string,
      agent,
      status: r.status as ClaimStatus,
      intentSummary: r.intentSummary as string,
      createdAt: r.createdAt as string,
      heartbeatAt: r.heartbeatAt as string,
      leaseExpiresAt: r.leaseExpiresAt as string,
      ...(r.contextJson !== null ? { context: JSON.parse(r.contextJson as string) } : {}),
      attemptCount: r.attemptCount as number,
      revision: r.revision as number,
    };
  }

  private async storeClaimRecord(claim: Claim): Promise<void> {
    const record = this.claimToRecord(claim);
    await this.withRetry(
      () => this.runWithSemaphore(() => this.client.recordPut(this.claimsTable, record)),
      "storeClaimRecord",
    );
  }

  private async updateClaimRecord(claim: Claim): Promise<void> {
    // Delete old record and insert new one (atomic in the mock)
    await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordDelete(this.claimsTable, { claimId: claim.claimId as JsonValue }),
        ),
      "updateClaimRecord.delete",
    );
    await this.storeClaimRecord(claim);
  }

  private async getClaimRecord(claimId: string): Promise<Claim | undefined> {
    const records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.claimsTable, { claimId: claimId as JsonValue }),
        ),
      "getClaimRecord",
    );
    const first = records[0];
    if (first === undefined) return undefined;
    return this.recordToClaim(first);
  }

  private async findActiveClaimOnTarget(targetRef: string, now: Date): Promise<Claim | undefined> {
    const records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.claimsTable, {
            targetRef: targetRef as JsonValue,
            status: "active" as JsonValue,
          }),
        ),
      "findActiveClaimOnTarget",
    );

    for (const r of records) {
      const claim = this.recordToClaim(r);
      if (new Date(claim.leaseExpiresAt).getTime() >= now.getTime()) {
        return claim;
      }
    }
    return undefined;
  }

  private async getActiveClaimRecords(): Promise<Claim[]> {
    const now = new Date();
    const records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.claimsTable, { status: "active" as JsonValue }),
        ),
      "getActiveClaimRecords",
    );

    return records
      .map((r) => this.recordToClaim(r))
      .filter((c) => new Date(c.leaseExpiresAt).getTime() >= now.getTime());
  }

  /** Returns all claims with status "active" without filtering by lease expiry. */
  private async getAllActiveStatusClaims(): Promise<Claim[]> {
    const records = await this.withRetry(
      () =>
        this.runWithSemaphore(() =>
          this.client.recordQuery(this.claimsTable, { status: "active" as JsonValue }),
        ),
      "getAllActiveStatusClaims",
    );

    return records.map((r) => this.recordToClaim(r));
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
