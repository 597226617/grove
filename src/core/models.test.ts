import { describe, expect, test } from "bun:test";
import type { AgentIdentity, Contribution, Relation, Score } from "./models.js";
import {
  ClaimStatus,
  ContributionKind,
  ContributionMode,
  RelationType,
  ScoreDirection,
} from "./models.js";

describe("ContributionKind", () => {
  test("has all expected values", () => {
    expect(ContributionKind.Work).toBe("work");
    expect(ContributionKind.Review).toBe("review");
    expect(ContributionKind.Discussion).toBe("discussion");
    expect(ContributionKind.Adoption).toBe("adoption");
    expect(ContributionKind.Reproduction).toBe("reproduction");
  });
});

describe("ContributionMode", () => {
  test("has evaluation and exploration", () => {
    expect(ContributionMode.Evaluation).toBe("evaluation");
    expect(ContributionMode.Exploration).toBe("exploration");
  });
});

describe("RelationType", () => {
  test("has all v1 relation types", () => {
    expect(RelationType.DerivesFrom).toBe("derives_from");
    expect(RelationType.RespondsTo).toBe("responds_to");
    expect(RelationType.Reviews).toBe("reviews");
    expect(RelationType.Reproduces).toBe("reproduces");
    expect(RelationType.Adopts).toBe("adopts");
  });
});

describe("ClaimStatus", () => {
  test("has all lifecycle states", () => {
    expect(ClaimStatus.Active).toBe("active");
    expect(ClaimStatus.Released).toBe("released");
    expect(ClaimStatus.Expired).toBe("expired");
    expect(ClaimStatus.Completed).toBe("completed");
  });
});

describe("Contribution interface", () => {
  test("can construct a valid contribution object", () => {
    const agent: AgentIdentity = {
      agentId: "claude-code-alice",
      agentName: "Alice",
      provider: "anthropic",
      model: "claude-opus-4-6",
      platform: "H100",
    };

    const relation: Relation = {
      targetCid: "blake3:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      relationType: RelationType.DerivesFrom,
    };

    const score: Score = {
      value: 0.9697,
      direction: ScoreDirection.Minimize,
      unit: "bpb",
    };

    const contribution: Contribution = {
      cid: "blake3:0000000000000000000000000000000000000000000000000000000000000000",
      manifestVersion: 1,
      kind: ContributionKind.Work,
      mode: ContributionMode.Evaluation,
      summary: "Vectorized inner loop with numpy",
      description: "Detailed analysis of vectorization opportunities",
      artifacts: {
        "train.py": "blake3:deed456deed456deed456deed456deed456deed456deed456deed456deed",
      },
      relations: [relation],
      scores: { val_bpb: score },
      tags: ["optimizer", "numpy"],
      context: { hardware: "H100", seed: 42 },
      agent,
      createdAt: "2026-03-08T10:00:00Z",
    };

    expect(contribution.cid).toMatch(/^blake3:[0-9a-f]{64}$/);
    expect(contribution.manifestVersion).toBe(1);
    expect(contribution.kind).toBe("work");
    expect(contribution.mode).toBe("evaluation");
    expect(contribution.summary).toBe("Vectorized inner loop with numpy");
    expect(contribution.relations).toHaveLength(1);
    expect(contribution.scores?.val_bpb?.value).toBe(0.9697);
    expect(contribution.tags).toEqual(["optimizer", "numpy"]);
    expect(contribution.agent.agentId).toBe("claude-code-alice");
  });

  test("supports exploration mode with no scores", () => {
    const contribution: Contribution = {
      cid: "blake3:1111111111111111111111111111111111111111111111111111111111111111",
      manifestVersion: 1,
      kind: ContributionKind.Work,
      mode: ContributionMode.Exploration,
      summary: "Database connection pool bottleneck analysis",
      artifacts: {},
      relations: [],
      tags: ["performance", "database"],
      agent: { agentId: "codex-bob" },
      createdAt: "2026-03-08T11:00:00Z",
    };

    expect(contribution.mode).toBe("exploration");
    expect(contribution.scores).toBeUndefined();
  });

  test("supports minimal contribution with empty collections", () => {
    const contribution: Contribution = {
      cid: "blake3:2222222222222222222222222222222222222222222222222222222222222222",
      manifestVersion: 1,
      kind: ContributionKind.Discussion,
      mode: ContributionMode.Exploration,
      summary: "Initial discussion",
      artifacts: {},
      relations: [],
      tags: [],
      agent: { agentId: "test-agent" },
      createdAt: "2026-03-08T12:00:00Z",
    };

    expect(Object.keys(contribution.artifacts)).toHaveLength(0);
    expect(contribution.relations).toHaveLength(0);
    expect(contribution.tags).toHaveLength(0);
  });
});
