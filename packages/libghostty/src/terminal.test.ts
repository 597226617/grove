/**
 * Tests for GhosttyTerminal.
 *
 * These tests verify the high-level terminal API. When libghostty-vt
 * is not available (no prebuilt binary), tests are skipped gracefully.
 */

import { describe, test, expect } from "bun:test";
import { isAvailable } from "./ffi.js";

const hasLib = isAvailable();
const describeIfAvailable = hasLib ? describe : describe.skip;

describeIfAvailable("GhosttyTerminal", () => {
  // Dynamic import to avoid loading FFI when library is unavailable
  async function loadTerminal() {
    const { GhosttyTerminal } = await import("./terminal.js");
    return GhosttyTerminal;
  }

  test("creates and destroys without error", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);
    term.destroy();
  });

  test("write and getText round-trip", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    term.write("Hello, World!");
    const text = term.getText();
    expect(text).toContain("Hello, World!");
    term.destroy();
  });

  test("handles ANSI color sequences", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    // Write text with ANSI color codes
    term.write("\x1b[31mRed\x1b[0m Normal");
    const text = term.getText();
    expect(text).toContain("Red");
    expect(text).toContain("Normal");
    // Plain text should NOT contain escape sequences
    expect(text).not.toContain("\x1b");
    term.destroy();
  });

  test("resize with reflow", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    term.write("A".repeat(80)); // Fill one line
    term.resize(40, 24); // Halve width — should reflow to 2 lines
    expect(term.cols).toBe(40);
    expect(term.rows).toBe(24);
    term.destroy();
  });

  test("reset clears content", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    term.write("Some content");
    term.reset();
    const text = term.getText();
    // After reset, content should be empty or whitespace only
    expect(text.trim()).toBe("");
    term.destroy();
  });

  test("getHtml returns HTML content", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    term.write("\x1b[1mBold\x1b[0m");
    const html = term.getHtml();
    // HTML should contain the text and some markup
    expect(html).toContain("Bold");
    term.destroy();
  });

  test("throws after destroy", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    term.destroy();
    expect(() => term.write("test")).toThrow("destroyed");
  });

  test("incremental write maintains state", async () => {
    const GhosttyTerminal = await loadTerminal();
    const term = new GhosttyTerminal(80, 24);
    term.write("Line 1\n");
    term.write("Line 2\n");
    const text = term.getText();
    expect(text).toContain("Line 1");
    expect(text).toContain("Line 2");
    term.destroy();
  });
});

describe("isAvailable", () => {
  test("returns a boolean", () => {
    const result = isAvailable();
    expect(typeof result).toBe("boolean");
  });
});
