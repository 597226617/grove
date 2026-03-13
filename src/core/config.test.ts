/**
 * Tests for grove.json config schema — parsing, validation, and serialization.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GroveConfig, parseGroveConfig, writeGroveConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Valid configs
// ---------------------------------------------------------------------------

describe("parseGroveConfig", () => {
  test("parses minimal local config", () => {
    const config = parseGroveConfig(JSON.stringify({ name: "my-grove" }));
    expect(config.name).toBe("my-grove");
    expect(config.mode).toBe("local");
    expect(config.preset).toBeUndefined();
    expect(config.services).toBeUndefined();
  });

  test("parses full local config with services", () => {
    const config = parseGroveConfig(
      JSON.stringify({
        name: "review-loop",
        mode: "local",
        preset: "review-loop",
        services: { server: true, mcp: false },
        backend: "sqlite",
      }),
    );
    expect(config.name).toBe("review-loop");
    expect(config.mode).toBe("local");
    expect(config.preset).toBe("review-loop");
    expect(config.services).toEqual({ server: true, mcp: false });
    expect(config.backend).toBe("sqlite");
  });

  test("parses nexus config", () => {
    const config = parseGroveConfig(
      JSON.stringify({
        name: "swarm",
        mode: "nexus",
        nexusUrl: "http://localhost:4000",
        preset: "swarm-ops",
      }),
    );
    expect(config.mode).toBe("nexus");
    expect(config.nexusUrl).toBe("http://localhost:4000");
  });

  test("parses remote config", () => {
    const config = parseGroveConfig(
      JSON.stringify({
        name: "remote-grove",
        mode: "remote",
        remoteUrl: "https://grove.example.com",
      }),
    );
    expect(config.mode).toBe("remote");
    expect(config.remoteUrl).toBe("https://grove.example.com");
  });

  // Backward compatibility: old grove.json with only nexusUrl (no mode)
  test("backward compat: old grove.json with just name + nexusUrl", () => {
    const config = parseGroveConfig(
      JSON.stringify({
        name: "legacy",
        nexusUrl: "http://nexus:4000",
      }),
    );
    // mode defaults to "local" — caller checks nexusUrl separately
    expect(config.name).toBe("legacy");
    expect(config.mode).toBe("local");
    expect(config.nexusUrl).toBe("http://nexus:4000");
  });
});

// ---------------------------------------------------------------------------
// Invalid configs
// ---------------------------------------------------------------------------

describe("parseGroveConfig errors", () => {
  test("rejects empty JSON", () => {
    expect(() => parseGroveConfig("{}")).toThrow("Invalid grove.json");
  });

  test("rejects non-JSON", () => {
    expect(() => parseGroveConfig("not json")).toThrow("not valid JSON");
  });

  test("rejects missing name", () => {
    expect(() => parseGroveConfig(JSON.stringify({ mode: "local" }))).toThrow("Invalid grove.json");
  });

  test("rejects invalid mode", () => {
    expect(() => parseGroveConfig(JSON.stringify({ name: "x", mode: "bogus" }))).toThrow(
      "Invalid grove.json",
    );
  });

  test("rejects nexus mode without nexusUrl", () => {
    expect(() => parseGroveConfig(JSON.stringify({ name: "x", mode: "nexus" }))).toThrow(
      "nexusUrl is required",
    );
  });

  test("rejects remote mode without remoteUrl", () => {
    expect(() => parseGroveConfig(JSON.stringify({ name: "x", mode: "remote" }))).toThrow(
      "remoteUrl is required",
    );
  });

  test("rejects invalid nexusUrl (not a URL)", () => {
    expect(() =>
      parseGroveConfig(JSON.stringify({ name: "x", mode: "nexus", nexusUrl: "not-a-url" })),
    ).toThrow("Invalid grove.json");
  });

  test("rejects unknown fields", () => {
    expect(() =>
      parseGroveConfig(JSON.stringify({ name: "x", mode: "local", unknown: true })),
    ).toThrow("Invalid grove.json");
  });
});

// ---------------------------------------------------------------------------
// Round-trip serialization
// ---------------------------------------------------------------------------

describe("writeGroveConfig", () => {
  const tmpPath = join(tmpdir(), `grove-config-test-${Date.now()}.json`);

  afterEach(() => {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  });

  test("round-trips local config", () => {
    const original: GroveConfig = {
      name: "test-grove",
      mode: "local",
      services: { server: true, mcp: true },
    };
    writeGroveConfig(original, tmpPath);

    expect(existsSync(tmpPath)).toBe(true);
    const raw = readFileSync(tmpPath, "utf-8");
    const parsed = parseGroveConfig(raw);

    expect(parsed.name).toBe(original.name);
    expect(parsed.mode).toBe(original.mode);
    expect(parsed.services).toEqual(original.services);
  });

  test("round-trips nexus config", () => {
    const original: GroveConfig = {
      name: "nexus-grove",
      mode: "nexus",
      nexusUrl: "http://nexus:4000",
      preset: "swarm-ops",
    };
    writeGroveConfig(original, tmpPath);

    const parsed = parseGroveConfig(readFileSync(tmpPath, "utf-8"));
    expect(parsed.mode).toBe("nexus");
    expect(parsed.nexusUrl).toBe("http://nexus:4000");
    expect(parsed.preset).toBe("swarm-ops");
  });

  test("omits undefined optional fields", () => {
    const original: GroveConfig = { name: "minimal", mode: "local" };
    writeGroveConfig(original, tmpPath);

    const raw = readFileSync(tmpPath, "utf-8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(obj)).toEqual(["name", "mode"]);
  });
});
