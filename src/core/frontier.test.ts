import { describe, expect, test } from "bun:test";
import { getScore } from "./frontier.js";
import { ScoreDirection } from "./models.js";
import { makeContribution } from "./test-helpers.js";

describe("getScore", () => {
  const contribution = makeContribution({
    scores: {
      val_bpb: { value: 0.97, direction: ScoreDirection.Minimize },
      throughput: { value: 14800, direction: ScoreDirection.Maximize, unit: "ops/sec" },
    },
  });

  test("returns score for existing metric", () => {
    const score = getScore(contribution, "val_bpb");
    expect(score?.value).toBe(0.97);
    expect(score?.direction).toBe("minimize");
  });

  test("returns undefined for missing metric", () => {
    const score = getScore(contribution, "nonexistent");
    expect(score).toBeUndefined();
  });

  test("returns undefined when contribution has no scores", () => {
    const noScores = makeContribution();
    const score = getScore(noScores, "val_bpb");
    expect(score).toBeUndefined();
  });
});
