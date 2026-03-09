/**
 * Content-derived identifier (CID) computation for Grove contributions.
 *
 * CID = blake3:<hex64> where the hash is computed over the RFC 8785 (JCS)
 * canonical JSON serialization of the manifest, excluding the `cid` field.
 *
 * The wire format uses snake_case keys. The canonical serialization
 * converts from camelCase TypeScript fields to snake_case before hashing.
 */

import { hash } from "blake3";
import { canonicalize } from "json-canonicalize";
import type {
  AgentIdentity,
  Contribution,
  ContributionInput,
  JsonValue,
  Relation,
  Score,
} from "./models.js";

/** CID prefix identifying the hash algorithm. */
const CID_PREFIX = "blake3:";

/** Recursively freeze an object and all its nested objects. */
function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/**
 * Normalize a JSON value to its canonical equivalent.
 *
 * Round-trips through JSON.parse(JSON.stringify(...)) to ensure the hash
 * input matches what JSON serialization would produce. This handles:
 * - NaN → null, Infinity / -Infinity → null (valid numbers in JS, not in JSON)
 * - undefined keys are dropped
 *
 * The JsonValue type prevents structurally non-JSON types (Map, Set,
 * BigInt, functions, symbols) at compile time. This function handles
 * the remaining numeric edge cases at runtime.
 */
function jsonNormalize(value: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

/**
 * Normalize an RFC 3339 timestamp to UTC with Z suffix.
 * Ensures that equivalent instants (e.g. "10:00:00+05:30" and "04:30:00Z")
 * produce the same canonical form and therefore the same CID.
 */
function normalizeTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid timestamp: ${timestamp}`);
  }
  return date.toISOString();
}

/**
 * Convert a camelCase AgentIdentity to snake_case wire format.
 */
function agentToWire(agent: AgentIdentity): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    agent_name: agent.agentName,
  };
  if (agent.agentId !== undefined) wire.agent_id = agent.agentId;
  if (agent.provider !== undefined) wire.provider = agent.provider;
  if (agent.model !== undefined) wire.model = agent.model;
  if (agent.version !== undefined) wire.version = agent.version;
  if (agent.toolchain !== undefined) wire.toolchain = agent.toolchain;
  if (agent.runtime !== undefined) wire.runtime = agent.runtime;
  if (agent.platform !== undefined) wire.platform = agent.platform;
  return wire;
}

/**
 * Convert a camelCase Score to snake_case wire format.
 * Throws if the score value is not finite (NaN, Infinity, -Infinity).
 */
function scoreToWire(score: Score): Record<string, unknown> {
  if (!Number.isFinite(score.value)) {
    throw new RangeError(`Score value must be finite, got ${score.value}`);
  }
  const wire: Record<string, unknown> = {
    value: score.value,
    direction: score.direction,
  };
  if (score.unit !== undefined) wire.unit = score.unit;
  return wire;
}

/**
 * Convert a camelCase Relation to snake_case wire format.
 * Normalizes metadata through JSON round-trip for hash consistency.
 */
function relationToWire(relation: Relation): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    target_cid: relation.targetCid,
    relation_type: relation.relationType,
  };
  if (relation.metadata !== undefined) {
    wire.metadata = jsonNormalize(relation.metadata);
  }
  return wire;
}

/**
 * Convert camelCase scores map to snake_case wire format.
 */
function scoresToWire(
  scores: Readonly<Record<string, Score>> | undefined,
): Record<string, unknown> | undefined {
  if (scores === undefined) return undefined;
  const wire: Record<string, unknown> = {};
  for (const [key, score] of Object.entries(scores)) {
    wire[key] = scoreToWire(score);
  }
  return wire;
}

/**
 * Convert a ContributionInput to the snake_case wire format object
 * used for canonical serialization. Excludes the `cid` field.
 *
 * Normalizes timestamps to UTC and strips undefined values from
 * context/metadata to ensure consistent CID computation.
 */
export function toWireFormat(input: ContributionInput): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    kind: input.kind,
    mode: input.mode,
    summary: input.summary,
    artifacts: input.artifacts,
    relations: input.relations.map(relationToWire),
    tags: [...input.tags].sort(),
    agent: agentToWire(input.agent),
    created_at: normalizeTimestamp(input.createdAt),
  };
  if (input.description !== undefined) wire.description = input.description;
  if (input.scores !== undefined) wire.scores = scoresToWire(input.scores);
  if (input.context !== undefined) {
    wire.context = jsonNormalize(input.context);
  }
  return wire;
}

/**
 * Compute the CID for a contribution manifest.
 *
 * Converts the input to snake_case wire format, serializes with RFC 8785
 * canonical JSON, and hashes with BLAKE3.
 *
 * @param input - The contribution fields (everything except cid)
 * @returns CID string in format `blake3:<hex64>`
 */
export function computeCid(input: ContributionInput): string {
  const wire = toWireFormat(input);
  const canonical = canonicalize(wire);
  const digest = hash(canonical);
  return `${CID_PREFIX}${Buffer.from(digest).toString("hex")}`;
}

/**
 * Validate a ContributionInput against the protocol's schema constraints.
 * Throws RangeError for any violation so callers cannot silently mint
 * contributions that would fail schema validation on the wire.
 */
function validateInput(input: ContributionInput): void {
  if (input.summary.length < 1 || input.summary.length > 256) {
    throw new RangeError(`summary must be 1-256 characters, got ${input.summary.length}`);
  }
  if (input.description !== undefined && input.description.length > 65_536) {
    throw new RangeError(
      `description must be at most 65536 characters, got ${input.description.length}`,
    );
  }
  if (new Set(input.tags).size !== input.tags.length) {
    throw new RangeError("tags must be unique");
  }
  if (input.tags.length > 100) {
    throw new RangeError(`tags must have at most 100 items, got ${input.tags.length}`);
  }
  if (Object.keys(input.artifacts).length > 1000) {
    throw new RangeError(
      `artifacts must have at most 1000 entries, got ${Object.keys(input.artifacts).length}`,
    );
  }
  if (input.relations.length > 1000) {
    throw new RangeError(`relations must have at most 1000 items, got ${input.relations.length}`);
  }
  if (input.scores !== undefined && Object.keys(input.scores).length > 100) {
    throw new RangeError(
      `scores must have at most 100 entries, got ${Object.keys(input.scores).length}`,
    );
  }
}

/**
 * Create an immutable Contribution from input fields.
 *
 * Validates the input against protocol schema constraints, computes the
 * CID from the canonical serialization, normalizes context/metadata to
 * match the hashed representation, and returns a deeply frozen object.
 *
 * @param input - The contribution fields (everything except cid)
 * @returns A deeply frozen Contribution with computed CID
 * @throws RangeError if the input violates schema constraints
 */
export function createContribution(input: ContributionInput): Contribution {
  validateInput(input);
  const cid = computeCid(input);
  const cloned = structuredClone(input);
  // Normalize context and metadata so stored values match what was hashed.
  // Without this, NaN/Infinity would survive structuredClone but the CID
  // was computed from their JSON-normalized equivalents (null).
  const normalized: Record<string, unknown> = { ...cloned };
  if (cloned.context !== undefined) {
    normalized.context = jsonNormalize(cloned.context);
  }
  if (cloned.relations.length > 0) {
    normalized.relations = cloned.relations.map((r) =>
      r.metadata !== undefined ? { ...r, metadata: jsonNormalize(r.metadata) } : r,
    );
  }
  const contribution: Contribution = { cid, ...normalized } as Contribution;
  return deepFreeze(contribution);
}

/**
 * Verify that a contribution's CID matches its content.
 *
 * Returns false for both tampered content and malformed input
 * (e.g., non-finite score values). Never throws.
 *
 * @param contribution - The contribution to verify
 * @returns true if the CID is valid
 */
export function verifyCid(contribution: Contribution): boolean {
  try {
    const { cid: _cid, ...rest } = contribution;
    const input: ContributionInput = rest;
    return computeCid(input) === contribution.cid;
  } catch {
    return false;
  }
}
