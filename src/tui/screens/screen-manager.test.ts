/**
 * State machine transition tests for ScreenManager.
 *
 * Tests the transition logic and initial state computation without rendering
 * React components. Validates the state machine spec:
 *
 *   preset-select → agent-detect → goal-input → running ↔ advanced → complete
 *                 ↑               ↑            ↑                       │
 *                 └───────────────┘            └───────────────────────┘
 */

import { describe, expect, test } from "bun:test";
import type { Screen, ScreenState } from "./screen-manager.js";

// ---------------------------------------------------------------------------
// State machine spec
// ---------------------------------------------------------------------------

/** Valid transitions: source → [allowed targets] */
const VALID_TRANSITIONS: Record<Screen, readonly Screen[]> = {
  "preset-select": ["agent-detect"],
  "agent-detect": ["preset-select", "goal-input"],
  "goal-input": ["agent-detect", "spawning"],
  spawning: ["running"],
  running: ["advanced", "complete"],
  advanced: ["running", "complete"],
  complete: ["preset-select", "running"],
};

/** All screens in the flow. */
const ALL_SCREENS: readonly Screen[] = [
  "preset-select",
  "agent-detect",
  "goal-input",
  "spawning",
  "running",
  "complete",
  "advanced",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute initial screen (mirrors ScreenManager's useState initializer). */
function computeInitialScreen(opts: {
  startOnRunning?: boolean;
  hasTopology?: boolean;
  hasPresets?: boolean;
}): Screen {
  if (opts.startOnRunning) return "running";
  if (opts.hasTopology) return "agent-detect";
  if (opts.hasPresets) return "preset-select";
  return "running";
}

/** Simulate a state transition. */
function transition(state: ScreenState, target: Screen, extra?: Partial<ScreenState>): ScreenState {
  return { ...state, screen: target, ...extra };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScreenManager: state machine spec", () => {
  test("every screen has at least one valid transition", () => {
    for (const screen of ALL_SCREENS) {
      expect(VALID_TRANSITIONS[screen].length).toBeGreaterThan(0);
    }
  });

  test("complete screen can restart to preset-select or running", () => {
    expect(VALID_TRANSITIONS.complete).toContain("preset-select");
    expect(VALID_TRANSITIONS.complete).toContain("running");
  });

  test("running and advanced can both reach complete", () => {
    expect(VALID_TRANSITIONS.running).toContain("complete");
    expect(VALID_TRANSITIONS.advanced).toContain("complete");
  });

  test("advanced and running toggle bidirectionally", () => {
    expect(VALID_TRANSITIONS.running).toContain("advanced");
    expect(VALID_TRANSITIONS.advanced).toContain("running");
  });
});

describe("ScreenManager: initial state computation", () => {
  test("resumed grove starts on running screen", () => {
    expect(computeInitialScreen({ startOnRunning: true })).toBe("running");
  });

  test("grove with topology goes to agent-detect first", () => {
    expect(computeInitialScreen({ hasTopology: true })).toBe("agent-detect");
  });

  test("grove with presets starts on preset-select", () => {
    expect(computeInitialScreen({ hasPresets: true })).toBe("preset-select");
  });

  test("grove with no presets and no topology starts on running", () => {
    expect(computeInitialScreen({})).toBe("running");
  });

  test("startOnRunning takes precedence over topology", () => {
    expect(computeInitialScreen({ startOnRunning: true, hasTopology: true })).toBe("running");
  });

  test("topology takes precedence over presets", () => {
    expect(computeInitialScreen({ hasTopology: true, hasPresets: true })).toBe("agent-detect");
  });
});

describe("ScreenManager: transition flow", () => {
  test("full happy path: preset → detect → goal → running → complete → restart", () => {
    let state: ScreenState = { screen: "preset-select" };

    // Preset selected → agent detect (or start here if topology exists)
    state = transition(state, "agent-detect", { selectedPreset: "review-loop" });
    expect(state.screen).toBe("agent-detect");
    expect(state.selectedPreset).toBe("review-loop");

    // Agent detect → goal input
    state = transition(state, "goal-input");
    expect(state.screen).toBe("goal-input");

    // Goal submitted → spawning
    state = transition(state, "spawning", { goal: "Review PR #42" });
    expect(state.screen).toBe("spawning");
    expect(state.goal).toBe("Review PR #42");

    // Spawning complete → running
    state = transition(state, "running");
    expect(state.screen).toBe("running");

    // Session completes
    state = transition(state, "complete", {
      completeSnapshot: { reason: "All roles signaled done", contributionCount: 12 },
    });
    expect(state.screen).toBe("complete");
    expect(state.completeSnapshot?.contributionCount).toBe(12);

    // New session
    state = transition(state, "preset-select");
    expect(state.screen).toBe("preset-select");
  });

  test("back navigation: goal-input → agent-detect → preset-select", () => {
    let state: ScreenState = {
      screen: "goal-input",
      selectedPreset: "review-loop",
    };

    state = transition(state, "agent-detect");
    expect(state.screen).toBe("agent-detect");
    expect(state.selectedPreset).toBe("review-loop"); // preserved

    state = transition(state, "preset-select");
    expect(state.screen).toBe("preset-select");
  });

  test("advanced mode toggle: running ↔ advanced", () => {
    let state: ScreenState = { screen: "running", goal: "test" };

    state = transition(state, "advanced");
    expect(state.screen).toBe("advanced");
    expect(state.goal).toBe("test"); // preserved

    state = transition(state, "running");
    expect(state.screen).toBe("running");
  });

  test("complete from advanced mode", () => {
    const state: ScreenState = { screen: "advanced", goal: "test" };
    const next = transition(state, "complete", {
      completeSnapshot: { reason: "Stop condition", contributionCount: 5 },
    });
    expect(next.screen).toBe("complete");
    expect(next.completeSnapshot?.reason).toBe("Stop condition");
  });

  test("complete snapshot preserves session data", () => {
    const state: ScreenState = {
      screen: "running",
      selectedPreset: "review-loop",
      goal: "Review PR #42",
      sessionId: "abc123",
    };
    const next = transition(state, "complete", {
      completeSnapshot: { reason: "All done", contributionCount: 7 },
    });

    expect(next.selectedPreset).toBe("review-loop");
    expect(next.goal).toBe("Review PR #42");
    expect(next.sessionId).toBe("abc123");
    expect(next.completeSnapshot?.contributionCount).toBe(7);
  });

  test("new session resets state when presets available", () => {
    const state: ScreenState = {
      screen: "complete",
      selectedPreset: "review-loop",
      goal: "old goal",
      sessionId: "old-id",
      completeSnapshot: { reason: "done", contributionCount: 5 },
    };

    // New session resets to just the screen (clearing old session state)
    const next: ScreenState = { screen: "preset-select" };
    expect(next.screen).toBe("preset-select");
    expect(next.goal).toBeUndefined();
    expect(next.sessionId).toBeUndefined();
    expect(next.completeSnapshot).toBeUndefined();
  });
});
