import { describe, expect, test } from "bun:test";
import { fireAndForget } from "./fire-and-forget.js";

describe("fireAndForget", () => {
  test("sync function — success does not throw", () => {
    expect(() => fireAndForget("test", () => 42)).not.toThrow();
  });

  test("sync function — exception is caught and logged", () => {
    const captured: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      captured.push(msg);
      return true;
    }) as typeof process.stderr.write;
    try {
      fireAndForget("boom", () => {
        throw new Error("kaboom");
      });
      expect(captured.length).toBe(1);
      expect(captured[0]).toContain("boom failed: kaboom");
    } finally {
      process.stderr.write = orig;
    }
  });

  test("async function — rejected promise is caught and logged", async () => {
    const captured: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      captured.push(msg);
      return true;
    }) as typeof process.stderr.write;
    try {
      fireAndForget("async-boom", () => Promise.reject(new Error("async kaboom")));
      await new Promise((r) => setTimeout(r, 10));
      expect(captured.length).toBe(1);
      expect(captured[0]).toContain("async-boom failed: async kaboom");
    } finally {
      process.stderr.write = orig;
    }
  });

  test("async function — resolved promise does not log", async () => {
    const captured: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((msg: string) => {
      captured.push(msg);
      return true;
    }) as typeof process.stderr.write;
    try {
      fireAndForget("ok", () => Promise.resolve("fine"));
      await new Promise((r) => setTimeout(r, 10));
      expect(captured.length).toBe(0);
    } finally {
      process.stderr.write = orig;
    }
  });
});
