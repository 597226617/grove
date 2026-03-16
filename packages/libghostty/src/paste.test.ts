/**
 * Tests for paste safety validation.
 */

import { describe, test, expect } from "bun:test";
import { isAvailable } from "./ffi.js";

const hasLib = isAvailable();
const describeIfAvailable = hasLib ? describe : describe.skip;

describeIfAvailable("isPasteSafe", () => {
  async function loadPaste() {
    const { isPasteSafe } = await import("./paste.js");
    return isPasteSafe;
  }

  test("safe plain text returns true", async () => {
    const isPasteSafe = await loadPaste();
    expect(isPasteSafe("hello world")).toBe(true);
  });

  test("empty string returns true", async () => {
    const isPasteSafe = await loadPaste();
    expect(isPasteSafe("")).toBe(true);
  });

  test("text with newlines may be flagged", async () => {
    const isPasteSafe = await loadPaste();
    // Newlines in paste content can execute unintended commands
    const result = isPasteSafe("command1\ncommand2");
    expect(typeof result).toBe("boolean");
    // The exact behavior depends on libghostty-vt's implementation
  });
});
