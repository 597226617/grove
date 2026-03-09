import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { hash } from "blake3";
import artifactSchema from "./artifact.json";
import contributionSchema from "./contribution.json";

/** Create a configured Ajv validator with the artifact schema. */
function createValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(artifactSchema);
}

/** Generate a valid blake3 content hash for testing. */
function validHash(index = 0): string {
  const hexDigit = "0123456789abcdef"[index % 16];
  return `blake3:${hexDigit.repeat(64)}`;
}

/** Minimal valid artifact in wire format (snake_case). */
function validArtifact(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    content_hash: validHash(0),
    size_bytes: 1024,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validation — valid artifacts
// ---------------------------------------------------------------------------

describe("artifact schema — valid artifacts", () => {
  const validate = createValidator();

  test("accepts minimal valid artifact (no media_type)", () => {
    expect(validate(validArtifact())).toBe(true);
  });

  test("accepts artifact with all fields", () => {
    const artifact = validArtifact({ media_type: "application/json" });
    expect(validate(artifact)).toBe(true);
  });

  test("accepts zero-byte artifact", () => {
    const artifact = validArtifact({ size_bytes: 0 });
    expect(validate(artifact)).toBe(true);
  });

  test("accepts large artifact size", () => {
    // 10 GB — well within JSON safe integer range
    const artifact = validArtifact({ size_bytes: 10_737_418_240 });
    expect(validate(artifact)).toBe(true);
  });

  test("accepts various media types", () => {
    const types = [
      "application/octet-stream",
      "text/plain",
      "application/json",
      "image/png",
      "application/x-tar",
      "text/markdown",
      "application/vnd.grove.patch+json",
    ];
    for (const mediaType of types) {
      const artifact = validArtifact({ media_type: mediaType });
      expect(validate(artifact)).toBe(true);
    }
  });

  test("accepts different valid content hashes", () => {
    for (let i = 0; i < 16; i++) {
      const artifact = validArtifact({ content_hash: validHash(i) });
      expect(validate(artifact)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema validation — invalid artifacts
// ---------------------------------------------------------------------------

describe("artifact schema — invalid artifacts", () => {
  const validate = createValidator();

  test("rejects missing required field: content_hash", () => {
    const { content_hash: _, ...artifact } = validArtifact();
    expect(validate(artifact)).toBe(false);
  });

  test("rejects missing required field: size_bytes", () => {
    const { size_bytes: _, ...artifact } = validArtifact();
    expect(validate(artifact)).toBe(false);
  });

  test("rejects empty object", () => {
    expect(validate({})).toBe(false);
  });

  // content_hash format validation
  test("rejects content_hash without blake3: prefix", () => {
    const artifact = validArtifact({ content_hash: "a".repeat(64) });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects content_hash with wrong hash length", () => {
    const artifact = validArtifact({ content_hash: "blake3:abc" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects content_hash with uppercase hex", () => {
    const artifact = validArtifact({ content_hash: `blake3:${"A".repeat(64)}` });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects content_hash with wrong prefix", () => {
    const artifact = validArtifact({ content_hash: `sha256:${"a".repeat(64)}` });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects non-string content_hash", () => {
    const artifact = validArtifact({ content_hash: 12345 });
    expect(validate(artifact)).toBe(false);
  });

  // size_bytes validation
  test("rejects negative size_bytes", () => {
    const artifact = validArtifact({ size_bytes: -1 });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects non-integer size_bytes", () => {
    const artifact = validArtifact({ size_bytes: 1024.5 });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects string size_bytes", () => {
    const artifact = validArtifact({ size_bytes: "1024" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects null size_bytes", () => {
    const artifact = validArtifact({ size_bytes: null });
    expect(validate(artifact)).toBe(false);
  });

  // media_type validation
  test("rejects empty string media_type", () => {
    const artifact = validArtifact({ media_type: "" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects media_type without slash", () => {
    const artifact = validArtifact({ media_type: "plaintext" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects media_type with leading slash", () => {
    const artifact = validArtifact({ media_type: "/json" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects media_type with whitespace", () => {
    const artifact = validArtifact({ media_type: "text / plain" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects non-string media_type", () => {
    const artifact = validArtifact({ media_type: 42 });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects media_type with parameters (semicolons)", () => {
    const artifact = validArtifact({ media_type: "text/html; charset=utf-8" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects size_bytes beyond Number.MAX_SAFE_INTEGER", () => {
    const artifact = validArtifact({ size_bytes: 9007199254740992 });
    expect(validate(artifact)).toBe(false);
  });

  // strict mode
  test("rejects unknown properties", () => {
    const artifact = validArtifact({ unknown_field: "value" });
    expect(validate(artifact)).toBe(false);
  });

  test("rejects name field (name is per-reference, not per-blob)", () => {
    const artifact = validArtifact({ name: "train.py" });
    expect(validate(artifact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BLAKE3 content hash golden vector
// ---------------------------------------------------------------------------

describe("BLAKE3 content hash golden vector", () => {
  test("known input produces expected blake3:<hex64> hash", () => {
    // Reference test: hash the string "hello grove" and verify the output.
    // This proves the spec's hash format claim and serves as a reference
    // for any CAS implementation.
    const input = new TextEncoder().encode("hello grove");
    const digest = hash(input).toString("hex");
    const contentHash = `blake3:${digest}`;

    // Verify format
    expect(contentHash).toMatch(/^blake3:[0-9a-f]{64}$/);

    // Golden vector — this value is deterministic and must not change.
    expect(contentHash).toBe(
      "blake3:e7a191b97e0488a369e819a5e31bbeff94d91d8302ef0f0b7d0918a505a31862",
    );
  });

  test("empty input produces a valid hash", () => {
    const input = new Uint8Array(0);
    const digest = hash(input).toString("hex");
    const contentHash = `blake3:${digest}`;

    expect(contentHash).toMatch(/^blake3:[0-9a-f]{64}$/);

    // BLAKE3 hash of empty input — well-known value.
    expect(contentHash).toBe(
      "blake3:af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
    );
  });

  test("different inputs produce different hashes", () => {
    const hash1 = hash(new TextEncoder().encode("artifact-a")).toString("hex");
    const hash2 = hash(new TextEncoder().encode("artifact-b")).toString("hex");
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Cross-schema consistency: contribution.json artifact refs
// ---------------------------------------------------------------------------

describe("cross-schema consistency", () => {
  test("artifact content_hash pattern matches contribution.json artifact value pattern", () => {
    // Both schemas use the same blake3 hash pattern.
    // If either changes, this test catches the divergence.
    const artifactPattern = artifactSchema.properties.content_hash.pattern;
    const contributionPattern = (
      contributionSchema.properties.artifacts as { additionalProperties: { pattern: string } }
    ).additionalProperties.pattern;
    expect(artifactPattern).toBe(contributionPattern);
  });
});
