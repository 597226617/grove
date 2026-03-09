import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "./contribution.json";

/** Create a configured Ajv validator with the contribution schema. */
function createValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

/** Generate a valid blake3 CID for testing. Uses hex digit based on index. */
function validCid(index = 0): string {
  const hexDigit = "0123456789abcdef"[index % 16];
  return `blake3:${hexDigit.repeat(64)}`;
}

/** Minimal valid contribution manifest in wire format (snake_case). */
function validManifest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    cid: validCid(0),
    kind: "work",
    mode: "evaluation",
    summary: "Test contribution",
    artifacts: {},
    relations: [],
    tags: [],
    agent: { agent_name: "test-agent" },
    created_at: "2026-03-08T10:00:00Z",
    ...overrides,
  };
}

describe("contribution schema — valid manifests", () => {
  const validate = createValidator();

  test("accepts minimal valid manifest", () => {
    const result = validate(validManifest());
    expect(result).toBe(true);
  });

  test("accepts fully-populated manifest", () => {
    const manifest = validManifest({
      description: "Detailed description of the work",
      artifacts: {
        "train.py": validCid(1),
        "results.json": validCid(2),
      },
      relations: [
        {
          target_cid: validCid(3),
          relation_type: "derives_from",
        },
        {
          target_cid: validCid(4),
          relation_type: "reviews",
          metadata: { verdict: "approved", score: 0.9 },
        },
      ],
      scores: {
        accuracy: { value: 0.95, direction: "maximize" },
        latency_ms: { value: 42, direction: "minimize", unit: "ms" },
      },
      tags: ["optimizer", "numpy", "benchmark"],
      context: {
        hardware: "H100",
        seed: 42,
        budget: { wall_clock: 3600, cost_usd: 10.0 },
      },
      agent: {
        agent_name: "Alice",
        provider: "anthropic",
        model: "claude-opus-4-6",
        version: "1.0.0",
        toolchain: "claude-code",
        runtime: "bun-1.3.9",
        platform: "H100",
      },
    });
    const result = validate(manifest);
    expect(result).toBe(true);
  });

  test("accepts exploration mode with no scores", () => {
    const manifest = validManifest({ mode: "exploration" });
    const result = validate(manifest);
    expect(result).toBe(true);
  });

  test("accepts all contribution kinds", () => {
    for (const kind of ["work", "review", "discussion", "adoption", "reproduction"]) {
      const result = validate(validManifest({ kind }));
      expect(result).toBe(true);
    }
  });

  test("accepts all relation types", () => {
    for (const relationType of ["derives_from", "responds_to", "reviews", "reproduces", "adopts"]) {
      const manifest = validManifest({
        relations: [
          {
            target_cid: validCid(5),
            relation_type: relationType,
          },
        ],
      });
      const result = validate(manifest);
      expect(result).toBe(true);
    }
  });

  test("accepts both score directions", () => {
    for (const direction of ["minimize", "maximize"]) {
      const manifest = validManifest({
        scores: {
          metric: { value: 1.0, direction },
        },
      });
      const result = validate(manifest);
      expect(result).toBe(true);
    }
  });

  test("accepts agent with only required field", () => {
    const manifest = validManifest({
      agent: { agent_name: "minimal-agent" },
    });
    const result = validate(manifest);
    expect(result).toBe(true);
  });

  test("accepts agent with agent_id", () => {
    const manifest = validManifest({
      agent: { agent_name: "Alice", agent_id: "alice-stable-001" },
    });
    const result = validate(manifest);
    expect(result).toBe(true);
  });

  test("accepts empty artifacts and relations", () => {
    const manifest = validManifest({
      artifacts: {},
      relations: [],
      tags: [],
    });
    const result = validate(manifest);
    expect(result).toBe(true);
  });

  test("accepts timestamps with timezone offset", () => {
    const manifest = validManifest({
      created_at: "2026-03-08T10:00:00+05:30",
    });
    const result = validate(manifest);
    expect(result).toBe(true);
  });

  test("accepts timestamps with fractional seconds", () => {
    const manifest = validManifest({
      created_at: "2026-03-08T10:00:00.123Z",
    });
    const result = validate(manifest);
    expect(result).toBe(true);
  });
});

describe("contribution schema — invalid manifests", () => {
  const validate = createValidator();

  test("rejects missing required field: cid", () => {
    const { cid: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: kind", () => {
    const { kind: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: mode", () => {
    const { mode: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: summary", () => {
    const { summary: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: artifacts", () => {
    const { artifacts: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: relations", () => {
    const { relations: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: tags", () => {
    const { tags: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: agent", () => {
    const { agent: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects missing required field: created_at", () => {
    const { created_at: _, ...manifest } = validManifest();
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid CID format — no prefix", () => {
    const manifest = validManifest({ cid: "a".repeat(64) });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid CID format — wrong hash length", () => {
    const manifest = validManifest({ cid: "blake3:abc" });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid CID format — uppercase hex", () => {
    const manifest = validManifest({ cid: `blake3:${"A".repeat(64)}` });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid kind", () => {
    const manifest = validManifest({ kind: "invalid" });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid mode", () => {
    const manifest = validManifest({ mode: "invalid" });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects empty summary", () => {
    const manifest = validManifest({ summary: "" });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects summary exceeding maxLength", () => {
    const manifest = validManifest({ summary: "x".repeat(257) });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects description exceeding maxLength", () => {
    const manifest = validManifest({ description: "x".repeat(65537) });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid artifact hash format", () => {
    const manifest = validManifest({
      artifacts: { "file.py": "sha256:abc123" },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid relation type", () => {
    const manifest = validManifest({
      relations: [
        {
          target_cid: validCid(6),
          relation_type: "invalid_type",
        },
      ],
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects relation with missing target_cid", () => {
    const manifest = validManifest({
      relations: [{ relation_type: "derives_from" }],
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects relation with invalid target_cid format", () => {
    const manifest = validManifest({
      relations: [
        {
          target_cid: "not-a-valid-cid",
          relation_type: "derives_from",
        },
      ],
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects invalid score direction", () => {
    const manifest = validManifest({
      scores: {
        metric: { value: 1.0, direction: "neutral" },
      },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects score without value", () => {
    const manifest = validManifest({
      scores: {
        metric: { direction: "maximize" },
      },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects score without direction", () => {
    const manifest = validManifest({
      scores: {
        metric: { value: 1.0 },
      },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects agent without agent_name", () => {
    const manifest = validManifest({
      agent: { provider: "anthropic" },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects empty agent_name", () => {
    const manifest = validManifest({
      agent: { agent_name: "" },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects duplicate tags", () => {
    const manifest = validManifest({
      tags: ["dup", "dup"],
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects unknown top-level properties", () => {
    const manifest = validManifest({ unknown_field: "value" });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects unknown properties in relation", () => {
    const manifest = validManifest({
      relations: [
        {
          target_cid: validCid(7),
          relation_type: "derives_from",
          unknown: true,
        },
      ],
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects unknown properties in score", () => {
    const manifest = validManifest({
      scores: {
        metric: { value: 1.0, direction: "maximize", unknown: true },
      },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("rejects unknown properties in agent", () => {
    const manifest = validManifest({
      agent: { agent_name: "test", unknown_field: true },
    });
    expect(validate(manifest)).toBe(false);
  });

  test("accepts summary at exactly maxLength boundary", () => {
    const manifest = validManifest({ summary: "x".repeat(256) });
    expect(validate(manifest)).toBe(true);
  });

  test("accepts description at exactly maxLength boundary", () => {
    const manifest = validManifest({ description: "x".repeat(65536) });
    expect(validate(manifest)).toBe(true);
  });
});
