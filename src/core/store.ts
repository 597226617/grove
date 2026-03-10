/**
 * Store protocols for the contribution graph.
 *
 * These define the abstract interface that storage backends must implement.
 * The local SQLite adapter and the Nexus adapter both satisfy these protocols.
 */

import type {
  Claim,
  Contribution,
  ContributionKind,
  ContributionMode,
  Relation,
  RelationType,
} from "./models.js";

/** Filters for querying contributions. */
export interface ContributionQuery {
  readonly kind?: ContributionKind | undefined;
  readonly mode?: ContributionMode | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly agentId?: string | undefined;
  readonly agentName?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

/** Store for immutable contributions and their typed relations. */
export interface ContributionStore {
  /** Store a contribution (idempotent — same CID is a no-op). */
  put(contribution: Contribution): Promise<void>;

  /** Store multiple contributions in a single transaction. Idempotent per CID. */
  putMany(contributions: readonly Contribution[]): Promise<void>;

  /** Retrieve a contribution by CID. */
  get(cid: string): Promise<Contribution | undefined>;

  /** List contributions matching filters. */
  list(query?: ContributionQuery): Promise<readonly Contribution[]>;

  /** Get contributions that have a relation pointing to this CID (incoming edges). */
  children(cid: string): Promise<readonly Contribution[]>;

  /** Get contributions that this CID has relations to (outgoing edge targets). */
  ancestors(cid: string): Promise<readonly Contribution[]>;

  /** Get relations originating from this CID. */
  relationsOf(cid: string, relationType?: RelationType): Promise<readonly Relation[]>;

  /** Get contributions that have relations pointing to this CID. */
  relatedTo(cid: string, relationType?: RelationType): Promise<readonly Contribution[]>;

  /**
   * Full-text search on summary and description.
   *
   * Implementations should use an efficient text search mechanism (e.g.,
   * SQLite FTS5) rather than naive substring matching. The query string
   * is matched against summary and description fields.
   */
  search(query: string, filters?: ContributionQuery): Promise<readonly Contribution[]>;

  /** Count contributions matching filters. */
  count(query?: ContributionQuery): Promise<number>;

  /** Release resources (e.g., close database connections). */
  close(): void;
}

/** Store for mutable claims (coordination objects). */
export interface ClaimStore {
  /** Create a new claim. Throws if claimId already exists. */
  createClaim(claim: Claim): Promise<Claim>;

  /** Get a claim by ID. */
  getClaim(claimId: string): Promise<Claim | undefined>;

  /**
   * Update heartbeat timestamp and renew lease.
   *
   * @param claimId - The claim to heartbeat.
   * @param leaseDurationMs - Optional lease duration in milliseconds.
   *   If omitted, the implementation uses a default (e.g., 300 seconds / 5 minutes).
   * @returns The updated claim snapshot. Throws if claim is not active.
   */
  heartbeat(claimId: string, leaseDurationMs?: number): Promise<Claim>;

  /** Release a claim (agent gives up). Returns the updated claim snapshot. */
  release(claimId: string): Promise<Claim>;

  /** Mark a claim as completed. Returns the updated claim snapshot. */
  complete(claimId: string): Promise<Claim>;

  /** Expire all claims past their lease. Returns the expired claims. */
  expireStale(): Promise<readonly Claim[]>;

  /** List active claims, optionally filtered by target. */
  activeClaims(targetRef?: string): Promise<readonly Claim[]>;

  /** Release resources (e.g., close database connections). */
  close(): void;
}
