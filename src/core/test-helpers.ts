/**
 * Shared test fixture factories for Grove core tests.
 *
 * Provides sensible defaults so tests only override the fields they care about.
 */

import type { AgentIdentity, Contribution, Relation, Score } from "./models.js";
import { ContributionKind, ContributionMode, RelationType, ScoreDirection } from "./models.js";

/** Create an AgentIdentity with sensible defaults. */
export function makeAgent(overrides?: Partial<AgentIdentity>): AgentIdentity {
  return {
    agentId: "test-agent",
    ...overrides,
  };
}

/** Create a Relation with sensible defaults. */
export function makeRelation(overrides?: Partial<Relation>): Relation {
  return {
    targetCid: "blake3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    relationType: RelationType.DerivesFrom,
    ...overrides,
  };
}

/** Create a Score with sensible defaults. */
export function makeScore(overrides?: Partial<Score>): Score {
  return {
    value: 0.95,
    direction: ScoreDirection.Minimize,
    ...overrides,
  };
}

/** Create a Contribution with sensible defaults. Override any field. */
export function makeContribution(overrides?: Partial<Contribution>): Contribution {
  return {
    cid: "blake3:0000000000000000000000000000000000000000000000000000000000000000",
    manifestVersion: 1,
    kind: ContributionKind.Work,
    mode: ContributionMode.Evaluation,
    summary: "Test contribution",
    artifacts: {},
    relations: [],
    tags: [],
    agent: makeAgent(),
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
