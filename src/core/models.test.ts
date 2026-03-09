import { describe, expect, test } from "bun:test";
import type { AgentIdentity, Contribution, ContributionInput, Relation, Score } from "./models.js";
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

  test("has exactly 5 kinds", () => {
    expect(Object.keys(ContributionKind)).toHaveLength(5);
  });
});

describe("ContributionMode", () => {
  test("has evaluation and exploration", () => {
    expect(ContributionMode.Evaluation).toBe("evaluation");
    expect(ContributionMode.Exploration).toBe("exploration");
  });

  test("has exactly 2 modes", () => {
    expect(Object.keys(ContributionMode)).toHaveLength(2);
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

  test("has exactly 5 relation types", () => {
    expect(Object.keys(RelationType)).toHaveLength(5);
  });
});

describe("ClaimStatus", () => {
  test("has all lifecycle states", () => {
    expect(ClaimStatus.Active).toBe("active");
    expect(ClaimStatus.Released).toBe("released");
    expect(ClaimStatus.Expired).toBe("expired");
    expect(ClaimStatus.Completed).toBe("completed");
  });

  test("has exactly 4 statuses", () => {
    expect(Object.keys(ClaimStatus)).toHaveLength(4);
  });
});

describe("ScoreDirection", () => {
  test("has minimize and maximize", () => {
    expect(ScoreDirection.Minimize).toBe("minimize");
    expect(ScoreDirection.Maximize).toBe("maximize");
  });

  test("has exactly 2 directions", () => {
    expect(Object.keys(ScoreDirection)).toHaveLength(2);
  });
});

describe("AgentIdentity", () => {
  test("requires agentName", () => {
    const agent: AgentIdentity = { agentName: "claude-code-alice" };
    expect(agent.agentName).toBe("claude-code-alice");
  });

  test("supports all optional fields", () => {
    const agent: AgentIdentity = {
      agentName: "Alice",
      provider: "anthropic",
      model: "claude-opus-4-6",
      version: "1.0.0",
      toolchain: "claude-code",
      runtime: "bun-1.3.9",
      platform: "H100",
    };
    expect(agent.agentName).toBe("Alice");
    expect(agent.provider).toBe("anthropic");
    expect(agent.model).toBe("claude-opus-4-6");
    expect(agent.version).toBe("1.0.0");
    expect(agent.toolchain).toBe("claude-code");
    expect(agent.runtime).toBe("bun-1.3.9");
    expect(agent.platform).toBe("H100");
  });

  test("optional fields default to undefined", () => {
    const agent: AgentIdentity = { agentName: "minimal" };
    expect(agent.provider).toBeUndefined();
    expect(agent.model).toBeUndefined();
    expect(agent.version).toBeUndefined();
    expect(agent.toolchain).toBeUndefined();
    expect(agent.runtime).toBeUndefined();
    expect(agent.platform).toBeUndefined();
  });
});

describe("Score", () => {
  test("requires value and direction", () => {
    const score: Score = { value: 0.95, direction: ScoreDirection.Maximize };
    expect(score.value).toBe(0.95);
    expect(score.direction).toBe("maximize");
  });

  test("supports optional unit", () => {
    const score: Score = {
      value: 0.9697,
      direction: ScoreDirection.Minimize,
      unit: "bpb",
    };
    expect(score.unit).toBe("bpb");
  });

  test("handles zero and negative values", () => {
    const zero: Score = { value: 0, direction: ScoreDirection.Minimize };
    const negative: Score = { value: -1.5, direction: ScoreDirection.Maximize };
    expect(zero.value).toBe(0);
    expect(negative.value).toBe(-1.5);
  });
});

describe("Relation", () => {
  test("requires targetCid and relationType", () => {
    const relation: Relation = {
      targetCid: "blake3:a".padEnd(71, "0"),
      relationType: RelationType.DerivesFrom,
    };
    expect(relation.targetCid).toStartWith("blake3:");
    expect(relation.relationType).toBe("derives_from");
  });

  test("supports optional metadata", () => {
    const relation: Relation = {
      targetCid: "blake3:b".padEnd(71, "0"),
      relationType: RelationType.Reviews,
      metadata: { verdict: "approved", score: 0.9 },
    };
    expect(relation.metadata?.verdict).toBe("approved");
    expect(relation.metadata?.score).toBe(0.9);
  });

  test("works with all relation types", () => {
    const types = [
      RelationType.DerivesFrom,
      RelationType.RespondsTo,
      RelationType.Reviews,
      RelationType.Reproduces,
      RelationType.Adopts,
    ];
    for (const relationType of types) {
      const relation: Relation = {
        targetCid: "blake3:c".padEnd(71, "0"),
        relationType,
      };
      expect(relation.relationType).toBe(relationType);
    }
  });
});

describe("Contribution", () => {
  const makeAgent = (name = "test-agent"): AgentIdentity => ({ agentName: name });
  const makeCid = (prefix: string): string => `blake3:${prefix.padEnd(64, "0")}`;

  test("can construct a fully-populated contribution", () => {
    const agent: AgentIdentity = {
      agentName: "Alice",
      provider: "anthropic",
      model: "claude-opus-4-6",
      version: "1.0.0",
      toolchain: "claude-code",
      runtime: "bun-1.3.9",
      platform: "H100",
    };

    const relation: Relation = {
      targetCid: makeCid("parent"),
      relationType: RelationType.DerivesFrom,
    };

    const score: Score = {
      value: 0.9697,
      direction: ScoreDirection.Minimize,
      unit: "bpb",
    };

    const contribution: Contribution = {
      cid: makeCid("abc"),
      kind: ContributionKind.Work,
      mode: ContributionMode.Evaluation,
      summary: "Vectorized inner loop with numpy",
      description: "Detailed analysis of vectorization opportunities",
      artifacts: { "train.py": makeCid("deed") },
      relations: [relation],
      scores: { val_bpb: score },
      tags: ["optimizer", "numpy"],
      context: { hardware: "H100", seed: 42 },
      agent,
      createdAt: "2026-03-08T10:00:00Z",
    };

    expect(contribution.cid).toBe(makeCid("abc"));
    expect(contribution.kind).toBe("work");
    expect(contribution.mode).toBe("evaluation");
    expect(contribution.summary).toBe("Vectorized inner loop with numpy");
    expect(contribution.description).toBe("Detailed analysis of vectorization opportunities");
    expect(contribution.relations).toHaveLength(1);
    expect(contribution.scores?.val_bpb?.value).toBe(0.9697);
    expect(contribution.tags).toEqual(["optimizer", "numpy"]);
    expect(contribution.context?.hardware).toBe("H100");
    expect(contribution.agent.agentName).toBe("Alice");
  });

  test("supports exploration mode with no scores", () => {
    const contribution: Contribution = {
      cid: makeCid("explore"),
      kind: ContributionKind.Work,
      mode: ContributionMode.Exploration,
      summary: "Database connection pool bottleneck analysis",
      artifacts: { "analysis.md": makeCid("report") },
      relations: [],
      tags: ["performance", "database"],
      agent: makeAgent("codex-bob"),
      createdAt: "2026-03-08T11:00:00Z",
    };

    expect(contribution.mode).toBe("exploration");
    expect(contribution.scores).toBeUndefined();
  });

  test("supports minimal contribution with empty collections", () => {
    const contribution: Contribution = {
      cid: makeCid("minimal"),
      kind: ContributionKind.Discussion,
      mode: ContributionMode.Exploration,
      summary: "Initial discussion",
      artifacts: {},
      relations: [],
      tags: [],
      agent: makeAgent(),
      createdAt: "2026-03-08T12:00:00Z",
    };

    expect(Object.keys(contribution.artifacts)).toHaveLength(0);
    expect(contribution.relations).toHaveLength(0);
    expect(contribution.tags).toHaveLength(0);
  });

  test("works with all contribution kinds", () => {
    const kinds = [
      ContributionKind.Work,
      ContributionKind.Review,
      ContributionKind.Discussion,
      ContributionKind.Adoption,
      ContributionKind.Reproduction,
    ];
    for (const kind of kinds) {
      const contribution: Contribution = {
        cid: makeCid(kind),
        kind,
        mode: ContributionMode.Evaluation,
        summary: `A ${kind} contribution`,
        artifacts: {},
        relations: [],
        tags: [],
        agent: makeAgent(),
        createdAt: "2026-03-08T10:00:00Z",
      };
      expect(contribution.kind).toBe(kind);
    }
  });

  test("supports multiple artifacts", () => {
    const contribution: Contribution = {
      cid: makeCid("multi"),
      kind: ContributionKind.Work,
      mode: ContributionMode.Evaluation,
      summary: "Multi-file change",
      artifacts: {
        "src/model.py": makeCid("model"),
        "src/train.py": makeCid("train"),
        "results/metrics.json": makeCid("metrics"),
      },
      relations: [],
      tags: [],
      agent: makeAgent(),
      createdAt: "2026-03-08T10:00:00Z",
    };

    expect(Object.keys(contribution.artifacts)).toHaveLength(3);
  });

  test("supports multiple relations of different types", () => {
    const contribution: Contribution = {
      cid: makeCid("multi-rel"),
      kind: ContributionKind.Work,
      mode: ContributionMode.Evaluation,
      summary: "Work with multiple relations",
      artifacts: {},
      relations: [
        { targetCid: makeCid("parent1"), relationType: RelationType.DerivesFrom },
        { targetCid: makeCid("parent2"), relationType: RelationType.Adopts },
        { targetCid: makeCid("review1"), relationType: RelationType.RespondsTo },
      ],
      tags: [],
      agent: makeAgent(),
      createdAt: "2026-03-08T10:00:00Z",
    };

    expect(contribution.relations).toHaveLength(3);
  });

  test("supports multiple scores", () => {
    const contribution: Contribution = {
      cid: makeCid("scores"),
      kind: ContributionKind.Work,
      mode: ContributionMode.Evaluation,
      summary: "Work with multiple metrics",
      artifacts: {},
      relations: [],
      scores: {
        accuracy: { value: 0.95, direction: ScoreDirection.Maximize },
        latency_ms: { value: 42, direction: ScoreDirection.Minimize, unit: "ms" },
        cost: { value: 0.003, direction: ScoreDirection.Minimize, unit: "USD" },
      },
      tags: [],
      agent: makeAgent(),
      createdAt: "2026-03-08T10:00:00Z",
    };

    expect(Object.keys(contribution.scores ?? {})).toHaveLength(3);
    expect(contribution.scores?.accuracy?.direction).toBe("maximize");
    expect(contribution.scores?.latency_ms?.unit).toBe("ms");
  });
});

describe("ContributionInput", () => {
  test("has all Contribution fields except cid", () => {
    const input: ContributionInput = {
      kind: ContributionKind.Work,
      mode: ContributionMode.Evaluation,
      summary: "Test input",
      artifacts: {},
      relations: [],
      tags: [],
      agent: { agentName: "test" },
      createdAt: "2026-03-08T10:00:00Z",
    };

    expect(input.kind).toBe("work");
    expect((input as unknown as Record<string, unknown>).cid).toBeUndefined();
  });
});
