/**
 * Enforcement wrappers for ContributionStore and ClaimStore.
 *
 * These decorators compose a raw store with a GroveContract to enforce:
 * - Concurrency limits (global, per-agent, per-target)
 * - Rate limits (per-agent, per-grove contributions per hour)
 * - Artifact limits (size, count)
 * - Lease duration limits
 *
 * The raw stores remain contract-agnostic; all policy enforcement
 * lives in these wrappers.
 */

import type { ContentStore } from "./cas.js";
import type { GroveContract } from "./contract.js";
import {
  ArtifactLimitError,
  ConcurrencyLimitError,
  LeaseViolationError,
  RateLimitError,
} from "./errors.js";
import type { Claim, Contribution, ContributionKind, Relation, RelationType } from "./models.js";
import type {
  ActiveClaimFilter,
  ClaimStore,
  ContributionQuery,
  ContributionStore,
  ExpiredClaim,
  ExpireStaleOptions,
} from "./store.js";

// ---------------------------------------------------------------------------
// Rate limit window
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// EnforcingContributionStore
// ---------------------------------------------------------------------------

/**
 * Wraps a ContributionStore with rate-limit and artifact-limit enforcement.
 *
 * All read operations delegate directly to the inner store.
 * Write operations (`put`, `putMany`) check the contract before delegating.
 */
export class EnforcingContributionStore implements ContributionStore {
  private readonly inner: ContributionStore;
  private readonly cas: ContentStore | undefined;
  private readonly contract: GroveContract;
  private readonly clock: () => Date;

  constructor(
    inner: ContributionStore,
    contract: GroveContract,
    options?: {
      cas?: ContentStore;
      clock?: () => Date;
    },
  ) {
    this.inner = inner;
    this.contract = contract;
    this.cas = options?.cas;
    this.clock = options?.clock ?? (() => new Date());
  }

  put = async (contribution: Contribution): Promise<void> => {
    await this.enforceContributionLimits(contribution);
    return this.inner.put(contribution);
  };

  putMany = async (contributions: readonly Contribution[]): Promise<void> => {
    for (let i = 0; i < contributions.length; i++) {
      const contribution = contributions[i];
      if (contribution !== undefined) {
        await this.enforceContributionLimits(contribution, i);
      }
    }
    return this.inner.putMany(contributions);
  };

  // Read operations — direct delegation
  get = (cid: string): Promise<Contribution | undefined> => this.inner.get(cid);
  list = (query?: ContributionQuery): Promise<readonly Contribution[]> => this.inner.list(query);
  children = (cid: string): Promise<readonly Contribution[]> => this.inner.children(cid);
  ancestors = (cid: string): Promise<readonly Contribution[]> => this.inner.ancestors(cid);
  relationsOf = (cid: string, relationType?: RelationType): Promise<readonly Relation[]> =>
    this.inner.relationsOf(cid, relationType);
  relatedTo = (cid: string, relationType?: RelationType): Promise<readonly Contribution[]> =>
    this.inner.relatedTo(cid, relationType);
  search = (query: string, filters?: ContributionQuery): Promise<readonly Contribution[]> =>
    this.inner.search(query, filters);
  findExisting = (
    agentId: string,
    targetCid: string,
    kind: ContributionKind,
    relationType?: RelationType,
  ): Promise<readonly Contribution[]> =>
    this.inner.findExisting(agentId, targetCid, kind, relationType);
  count = (query?: ContributionQuery): Promise<number> => this.inner.count(query);
  close = (): void => this.inner.close();

  // ========================================================================
  // Private enforcement
  // ========================================================================

  private async enforceContributionLimits(
    contribution: Contribution,
    pendingCount = 0,
  ): Promise<void> {
    const rl = this.contract.rateLimits;

    // Check per-agent rate limit
    if (rl?.maxContributionsPerAgentPerHour !== undefined) {
      await this.enforceAgentRateLimit(
        contribution.agent.agentId,
        rl.maxContributionsPerAgentPerHour,
        pendingCount,
      );
    }

    // Check per-grove rate limit
    if (rl?.maxContributionsPerGrovePerHour !== undefined) {
      await this.enforceGroveRateLimit(rl.maxContributionsPerGrovePerHour, pendingCount);
    }

    // Check artifact count
    if (rl?.maxArtifactsPerContribution !== undefined) {
      const artifactCount = Object.keys(contribution.artifacts).length;
      if (artifactCount > rl.maxArtifactsPerContribution) {
        throw new ArtifactLimitError({
          limitType: "count",
          current: artifactCount,
          limit: rl.maxArtifactsPerContribution,
        });
      }
    }

    // Check artifact sizes via CAS
    if (rl?.maxArtifactSizeBytes !== undefined && this.cas !== undefined) {
      for (const [name, contentHash] of Object.entries(contribution.artifacts)) {
        const stat = await this.cas.stat(contentHash);
        if (stat !== undefined && stat.sizeBytes > rl.maxArtifactSizeBytes) {
          throw new ArtifactLimitError({
            limitType: "size",
            current: stat.sizeBytes,
            limit: rl.maxArtifactSizeBytes,
            message: `Artifact '${name}' size ${stat.sizeBytes} bytes exceeds limit of ${rl.maxArtifactSizeBytes} bytes`,
          });
        }
      }
    }
  }

  private async enforceAgentRateLimit(
    agentId: string,
    limit: number,
    pendingCount = 0,
  ): Promise<void> {
    const now = this.clock();
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

    // Count contributions by this agent in the last hour
    const recentContributions = await this.inner.list({
      agentId,
    });
    const count =
      recentContributions.filter((c) => new Date(c.createdAt).getTime() >= windowStart.getTime())
        .length + pendingCount;

    if (count >= limit) {
      const retryAfterMs = this.computeRetryAfterMs(recentContributions, windowStart, limit);
      throw new RateLimitError({
        limitType: "per_agent",
        current: count,
        limit,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
        retryAfterMs,
      });
    }
  }

  private async enforceGroveRateLimit(limit: number, pendingCount = 0): Promise<void> {
    const now = this.clock();
    const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000);

    // Count all contributions in the last hour
    const allContributions = await this.inner.list();
    const count =
      allContributions.filter((c) => new Date(c.createdAt).getTime() >= windowStart.getTime())
        .length + pendingCount;

    if (count >= limit) {
      const retryAfterMs = this.computeRetryAfterMs(allContributions, windowStart, limit);
      throw new RateLimitError({
        limitType: "per_grove",
        current: count,
        limit,
        windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
        retryAfterMs,
      });
    }
  }

  /**
   * Compute how long until a slot opens in the rate limit window.
   * Finds the oldest in-window contribution and calculates when it rolls out.
   */
  private computeRetryAfterMs(
    contributions: readonly Contribution[],
    windowStart: Date,
    _limit: number,
  ): number {
    const now = this.clock();
    const inWindow = contributions
      .filter((c) => new Date(c.createdAt).getTime() >= windowStart.getTime())
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

    const oldest = inWindow[0];
    if (oldest === undefined) return 0;

    const oldestTime = new Date(oldest.createdAt).getTime();
    const rolloutTime = oldestTime + RATE_LIMIT_WINDOW_SECONDS * 1000;
    return Math.max(0, rolloutTime - now.getTime());
  }
}

// ---------------------------------------------------------------------------
// EnforcingClaimStore
// ---------------------------------------------------------------------------

/**
 * Wraps a ClaimStore with concurrency-limit and lease-limit enforcement.
 *
 * All read operations delegate directly to the inner store.
 * `createClaim` checks concurrency limits before delegating.
 */
export class EnforcingClaimStore implements ClaimStore {
  private readonly inner: ClaimStore;
  private readonly contract: GroveContract;

  constructor(inner: ClaimStore, contract: GroveContract) {
    this.inner = inner;
    this.contract = contract;
  }

  createClaim = async (claim: Claim): Promise<Claim> => {
    await this.enforceConcurrencyLimits(claim);
    this.enforceLeaseLimit(claim);
    return this.inner.createClaim(claim);
  };

  // Read/mutation operations — direct delegation
  claimOrRenew = (claim: Claim): Promise<Claim> => this.inner.claimOrRenew(claim);
  getClaim = (claimId: string): Promise<Claim | undefined> => this.inner.getClaim(claimId);
  heartbeat = (claimId: string, leaseDurationMs?: number): Promise<Claim> =>
    this.inner.heartbeat(claimId, leaseDurationMs);
  release = (claimId: string): Promise<Claim> => this.inner.release(claimId);
  complete = (claimId: string): Promise<Claim> => this.inner.complete(claimId);
  expireStale = (options?: ExpireStaleOptions): Promise<readonly ExpiredClaim[]> =>
    this.inner.expireStale(options);
  activeClaims = (targetRef?: string): Promise<readonly Claim[]> =>
    this.inner.activeClaims(targetRef);
  cleanCompleted = (retentionMs: number): Promise<number> => this.inner.cleanCompleted(retentionMs);
  countActiveClaims = (filter?: ActiveClaimFilter): Promise<number> =>
    this.inner.countActiveClaims(filter);
  detectStalled = (stallTimeoutMs: number): Promise<readonly Claim[]> =>
    this.inner.detectStalled(stallTimeoutMs);
  close = (): void => this.inner.close();

  // ========================================================================
  // Private enforcement
  // ========================================================================

  private async enforceConcurrencyLimits(claim: Claim): Promise<void> {
    const concurrency = this.contract.concurrency;
    if (concurrency === undefined) return;

    // Check global active claim limit
    if (concurrency.maxActiveClaims !== undefined) {
      const globalCount = await this.inner.countActiveClaims();
      if (globalCount >= concurrency.maxActiveClaims) {
        throw new ConcurrencyLimitError({
          limitType: "global",
          current: globalCount,
          limit: concurrency.maxActiveClaims,
        });
      }
    }

    // Check per-agent claim limit (0 means unlimited)
    if (concurrency.maxClaimsPerAgent !== undefined && concurrency.maxClaimsPerAgent > 0) {
      const agentCount = await this.inner.countActiveClaims({
        agentId: claim.agent.agentId,
      });
      if (agentCount >= concurrency.maxClaimsPerAgent) {
        throw new ConcurrencyLimitError({
          limitType: "per_agent",
          current: agentCount,
          limit: concurrency.maxClaimsPerAgent,
        });
      }
    }

    // Check per-target claim limit
    if (concurrency.maxClaimsPerTarget !== undefined) {
      const targetCount = await this.inner.countActiveClaims({
        targetRef: claim.targetRef,
      });
      if (targetCount >= concurrency.maxClaimsPerTarget) {
        throw new ConcurrencyLimitError({
          limitType: "per_target",
          current: targetCount,
          limit: concurrency.maxClaimsPerTarget,
        });
      }
    }
  }

  private enforceLeaseLimit(claim: Claim): void {
    const maxLeaseSeconds = this.contract.execution?.maxLeaseSeconds;
    if (maxLeaseSeconds === undefined) return;

    const leaseMs = new Date(claim.leaseExpiresAt).getTime() - new Date(claim.createdAt).getTime();
    const leaseSeconds = leaseMs / 1000;

    if (leaseSeconds > maxLeaseSeconds) {
      throw new LeaseViolationError({
        requestedSeconds: Math.ceil(leaseSeconds),
        maxSeconds: maxLeaseSeconds,
      });
    }
  }
}
