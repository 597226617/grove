/**
 * Tests for VT-aware text extraction.
 */

import { describe, test, expect } from "bun:test";
import { isAvailable } from "./ffi.js";

const hasLib = isAvailable();
const describeIfAvailable = hasLib ? describe : describe.skip;

describeIfAvailable("ptyToText", () => {
  async function loadText() {
    const { ptyToText } = await import("./text.js");
    return ptyToText;
  }

  test("strips ANSI color codes", async () => {
    const ptyToText = await loadText();
    const result = ptyToText("\x1b[32mGreen text\x1b[0m");
    expect(result).toContain("Green text");
    expect(result).not.toContain("\x1b");
  });

  test("handles cursor movements", async () => {
    const ptyToText = await loadText();
    // Move cursor to column 10, then write
    const result = ptyToText("\x1b[10GHello");
    expect(result).toContain("Hello");
  });

  test("handles empty input", async () => {
    const ptyToText = await loadText();
    const result = ptyToText("");
    expect(result.trim()).toBe("");
  });

  test("respects custom dimensions", async () => {
    const ptyToText = await loadText();
    const result = ptyToText("test", { cols: 40, rows: 10 });
    expect(result).toContain("test");
  });
});

describeIfAvailable("ptyToHtml", () => {
  async function loadHtml() {
    const { ptyToHtml } = await import("./text.js");
    return ptyToHtml;
  }

  test("produces HTML with styled content", async () => {
    const ptyToHtml = await loadHtml();
    const result = ptyToHtml("\x1b[1mBold\x1b[0m Normal");
    expect(result).toContain("Bold");
    expect(result).toContain("Normal");
  });
});
