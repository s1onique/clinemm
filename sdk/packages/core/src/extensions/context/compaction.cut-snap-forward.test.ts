/**
 * ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01
 * (CORRECTION01: P1 test-geometry strengthening + P2 metric labelling.
 *  CORRECTION02: R7 wording tightening — empirical cross-estimator
 *  witness, not a universal metric-independence claim.)
 *
 * Regression guards for the findCutIndex snap-clause fix.
 *
 * REPAIR CONTRACT:
 *   Starting from the token-budget candidate, alignment to a typed-user /
 *   turn boundary MUST preserve the progress made by the token-budget walk.
 *   A turn-alignment adjustment may move the cut FORWARD to a later safe
 *   boundary. It MUST NOT move a token-derived candidate BACKWARD to an
 *   old typed-user boundary and thereby reintroduce already-selected history
 *   into the retained tail.
 *   Tool-use/result atomicity and preserved-recent-tail invariants remain
 *   unchanged.
 *
 * METRIC NOTE (CORRECTION01 P2 / CORRECTION02 wording tightening):
 *   `estimateJsonTokens` is the deterministic fixture WEIGHT used by R1-R6
 *   to make selection geometry unambiguous. It is JSON-serialized character
 *   length, NOT a token count.
 *
 *   The cut selection is NOT invariant under arbitrary monotonic or
 *   nonlinear per-message weighting. For example, the production token
 *   estimator uses Math.ceil(N/3) per message, which is nonlinear:
 *   summing per-message estimates does NOT equal a single estimate of
 *   the sum. A naive "scales proportionally" comparison is not enough to
 *   make two weight functions produce the same cut.
 *
 *   R1-R6 use the deterministic JSON-length weight to pin selection
 *   geometry. R7 is an empirical cross-estimator witness: it confirms the
 *   same repaired L1 geometry survives the actual production token
 *   estimator. It does NOT claim findCutIndex is invariant under
 *   arbitrary monotonic or nonlinear per-message weighting.
 */

import { describe, expect, it } from "vitest";
import { createTokenEstimator, findCutIndex } from "./compaction-shared";
import type { MessageWithMetadata } from "@cline/shared";

// Deterministic fixture weight: JSON-serialized character length per message.
// R1-R6 use this weight to pin selection geometry precisely. R7 compares
// this weight against the production token estimator (createTokenEstimator)
// on the L1 fixture to provide an empirical cross-estimator conservation
// witness.
const estimateJsonTokens = (m: MessageWithMetadata) => JSON.stringify(m).length;

function typedUser(text: string): MessageWithMetadata {
  return { role: "user", content: text };
}

function assistantToolUse(id: string, name = "execute_command"): MessageWithMetadata {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input: { command: "ls" } }],
  };
}

function toolResult(id: string, content: string): MessageWithMetadata {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, name: "execute_command", content }],
  };
}

function buildLiveShape472(): MessageWithMetadata[] {
  // L1 reproduction: typed-user at index 1, then long assistant/tool_result
  // loop. Total ~452k JSON characters across 472 messages.
  const messages: MessageWithMetadata[] = [];
  messages.push(typedUser("Initial task: refactor the foo module"));
  messages.push(typedUser("Continue with the next thing"));
  let toolId = 0;
  while (messages.length < 472) {
    toolId += 1;
    messages.push(assistantToolUse(`t${toolId}`));
    if (messages.length < 472) {
      messages.push(toolResult(`t${toolId}`, "x".repeat(1700)));
    }
  }
  return messages.slice(0, 472);
}

describe("ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01 — regression guards", () => {
  it("R1 (load-bearing): cut must not snap to a stale early typed-user on a long tool loop", () => {
    const messages = buildLiveShape472();
    const cut = findCutIndex(messages, 20_000, estimateJsonTokens);
    // Token-budget walk computes the candidate from the tail. For this
    // shape (470 alternating assistant/tool_result messages after index 1)
    // and preserveRecentTokens=20_000, the candidate is deep — typically
    // ~451. The OLD snap to lastTurnStartIndex=1 collapsed the cut to 1.
    // The NEW contract must preserve the token-budget progress.
    expect(cut).toBeGreaterThan(100);
    expect(cut).toBeLessThan(messages.length);
  });

  it("R2 (load-bearing): cut snaps FORWARD to a typed-user past the candidate", () => {
    // Geometry: a tool_result dominates the tail walk so the candidate
    // lands BEFORE the latest typed-user, forcing the snap-forward
    // primitive. Without the snap-forward primitive (pre-patch), this
    // shape folds only 1-2 messages; with it (post-patch), the cut
    // returns EXACTLY the latest typed-user index 6.
    //
    //   [0] typedUser("Initial task")                 <- initial prompt
    //   [1] assistant tool_use("a1")
    //   [2] tool_result("a1", "x".repeat(2000))        <- BIG
    //   [3] typedUser("Mid-turn request")             <- typed-user
    //   [4] assistant tool_use("b1")
    //   [5] tool_result("b1", "x".repeat(2000))        <- BIG
    //   [6] typedUser("Latest instruction")           <- LATEST typed-user
    //
    // With preserveRecentTokens=2000, the tail walk lands somewhere in
    // the [0..5] range; lastTurnStartIndex=6 > candidate triggers the
    // snap-forward; messages[6] is a typed-user (safe) -> returns 6.
    //
    // Pre-patch: Math.min(candidate, 6) returns the smaller candidate;
    // backward snap-walk retreats to the preceding assistant tool_use —
    // folding only 1-2 messages and reintroducing history.
    const messages: MessageWithMetadata[] = [
      typedUser("Initial task"),
      assistantToolUse("a1", "read_files"),
      toolResult("a1", "x".repeat(2000)),
      typedUser("Mid-turn request"),
      assistantToolUse("b1", "read_files"),
      toolResult("b1", "x".repeat(2000)),
      typedUser("Latest instruction"),
    ];
    const cut = findCutIndex(messages, 2_000, estimateJsonTokens);
    // Exact-index assertion: the snap-forward primitive MUST return 6.
    expect(cut).toBe(6);
  });

  it("R3: cut on a typed-user boundary remains EXACTLY on the boundary", () => {
    // Geometry: candidate lands EXACTLY on a typed-user index. The
    // contract is "no snap when typed-user is at or before the
    // candidate" — the cut must equal the typed-user index precisely.
    //
    //   [0] assistant tool_use("x1")
    //   [1] tool_result("x1", "x")
    //   [2] assistant tool_use("x2")
    //   [3] tool_result("x2", "x")
    //   [4] typedUser("Mid-turn request")
    //   [5] assistant tool_use("y1")
    //   [6] tool_result("y1", "x")
    //   [7] typedUser("Latest typed user")           <- LATEST typed-user
    //
    // findLastTurnStartIndex walks from messages.length-1 backwards and
    // returns the FIRST typed-user; index 7 is the latest typed-user, so
    // lastTurnStartIndex=7. Tail walk with preserveRecentTokens=1 hits
    // total>=1 immediately at index 7 -> candidate=7. Since
    // lastTurnStartIndex(7) > candidate(7) is FALSE, no snap. Forward
    // walk: messages[7]=typed-user (safe) -> return 7.
    const messages: MessageWithMetadata[] = [];
    messages.push(assistantToolUse("x1"));
    messages.push(toolResult("x1", "x"));
    messages.push(assistantToolUse("x2"));
    messages.push(toolResult("x2", "x"));
    messages.push(typedUser("Mid-turn request"));
    messages.push(assistantToolUse("y1"));
    messages.push(toolResult("y1", "x"));
    messages.push(typedUser("Latest typed user"));
    const cut = findCutIndex(messages, 1, estimateJsonTokens);
    expect(cut).toBe(7);
  });

  it("R4: cut with no later typed-user retains candidate / nearest safe assistant boundary", () => {
    const messages: MessageWithMetadata[] = [typedUser("Initial task")];
    for (let i = 0; i < 10; i += 1) {
      messages.push(assistantToolUse(`p${i}`));
      messages.push(toolResult(`p${i}`, "x".repeat(1500)));
    }
    messages.push({ role: "assistant", content: "Final assistant turn" });
    const cut = findCutIndex(messages, 1_000, estimateJsonTokens);
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(messages.length);
    const cutMessage = messages[cut];
    expect(cutMessage.role === "assistant" || cutMessage.role === "user").toBe(true);
    if (cutMessage.role === "user" && Array.isArray(cutMessage.content)) {
      const isToolResultOnly = cutMessage.content.every(
        (block) => block.type === "tool_result",
      );
      expect(isToolResultOnly).toBe(false);
    }
  });

  it("R5: cut never reintroduces already-selected history (L1 ablation)", () => {
    const messages = buildLiveShape472();
    const cut = findCutIndex(messages, 20_000, estimateJsonTokens);
    const foldSize = cut;
    expect(foldSize).toBeGreaterThan(400);
  });

  it("R6: tool-pair atomicity is preserved (every tool_use in result has its tool_result)", () => {
    const messages = buildLiveShape472();
    const cut = findCutIndex(messages, 20_000, estimateJsonTokens);
    const preservedTail = messages.slice(cut);
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();
    for (const msg of preservedTail) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === "tool_use") toolUseIds.add(block.id);
        if (block.type === "tool_result") toolResultIds.add(block.tool_use_id);
      }
    }
    for (const id of toolUseIds) {
      expect(toolResultIds.has(id)).toBe(true);
    }
    for (const id of toolResultIds) {
      expect(toolUseIds.has(id)).toBe(true);
    }
  });

  it("R7 (CORRECTION02): L1 fixture selects the same cut under the production token estimator and proportionally-scaled JSON fixture weight", () => {
    // Empirical cross-estimator conservation witness for the L1 fixture.
    // This test does NOT claim findCutIndex is invariant under arbitrary
    // monotonic or nonlinear per-message weighting. It is a single-fixture
    // sanity check that the repaired L1 geometry survives when measured
    // by the actual production token estimator (createTokenEstimator,
    // which uses Math.ceil(N/3) per message).
    //
    // Why the threshold is scaled by CHARS_PER_TOKEN: each message is
    // weighted independently by Math.ceil(N/3), and summing those
    // per-message estimates does NOT equal a single estimate of the sum
    // (sub-additivity of the ceiling). A naive threshold comparison with
    // an unscaled JSON-length threshold would cross at a different
    // index. Scaling the JSON threshold by CHARS_PER_TOKEN compensates
    // for the rounding of individual message weights on this fixture
    // (where the rounding errors happen to net out), which is an
    // empirical property of the L1 geometry — NOT a general proof.
    //
    // If the production estimator or the L1 fixture changes, this
    // assertion may legitimately fail; the failure would indicate that
    // the proportional-scaling approximation no longer holds for this
    // shape, not a bug in findCutIndex.
    const CHARS_PER_TOKEN = 3;
    const messages = buildLiveShape472();
    const cutJson = findCutIndex(
      messages,
      20_000 * CHARS_PER_TOKEN,
      estimateJsonTokens,
    );
    const realTokenEstimator = createTokenEstimator();
    const cutReal = findCutIndex(messages, 20_000, realTokenEstimator);
    expect(cutReal).toBe(cutJson);
  });
});
