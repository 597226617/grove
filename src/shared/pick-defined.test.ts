import { describe, expect, test } from "bun:test";
import { pickDefined } from "./pick-defined.js";

describe("pickDefined", () => {
  test("picks only defined keys", () => {
    const obj = { a: 1, b: undefined, c: "hello" };
    expect(pickDefined(obj, ["a", "b", "c"])).toEqual({ a: 1, c: "hello" });
  });

  test("returns empty object when all keys are undefined", () => {
    const obj = { a: undefined, b: undefined };
    expect(pickDefined(obj, ["a", "b"])).toEqual({});
  });

  test("ignores keys not in the list", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(pickDefined(obj, ["a", "c"])).toEqual({ a: 1, c: 3 });
  });

  test("preserves falsy non-undefined values", () => {
    const obj = { a: 0, b: "", c: false, d: null };
    expect(pickDefined(obj, ["a", "b", "c", "d"])).toEqual({
      a: 0,
      b: "",
      c: false,
      d: null,
    });
  });
});
