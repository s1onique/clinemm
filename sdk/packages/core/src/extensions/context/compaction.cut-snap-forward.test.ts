/**
 * ACT-CLINEMM-AGENTIC-COMPACTION-CUT-SNAP-FORWARD01
 *
 * Regression guards for the findCutIndex snap-clause fix.
 *
 * REPAIR CONTRACT:
 *   Starting from the token-budget candidate, alignment to a typed-user /
 *   turn boundary MUST preserve the progress made by the token-budget walk.
 *   A turn-alignment adjustment may move the cut FORWARD to a later safe
 *   boundary. It MUST NOT move a token-derived candidate BACKWARD to an
 *   old typed-user boundary and thereby reintroduce already-selected
 *   history into the retained tail.
 *   Tool-use/result atomicity and preserved-recent-tail invariants remain
 *   unchanged.
 */

import { describe, expect, it } from "vitest";
import { findCutIndex } from "./compaction-shared";
import type { MessageWithMetadata } from "@cline/shared";

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
  // loop. Total ~450k tokens across 472 messages.
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

  it("R2 (load-bearing): cut may snap forward to next typed-user when candidate is before it", () => {
    const messages: MessageWithMetadata[] = [];
    for (let i = 0; i < 100; i += 1) {
      messages.push(assistantToolUse(`a${i}`, "read_files"));
    }
    messages.push(typedUser("Mid-turn request"));
    messages.push(assistantToolUse("b1"));
    messages.push(toolResult("b1", "file contents"));
    messages.push(typedUser("Latest instruction"));
    const cut = findCutIndex(messages, 1, estimateJsonTokens);
    expect(cut).toBeGreaterThanOrEqual(100);
  });

  it("R3: cut on a typed-user boundary remains on the boundary", () => {
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
    expect(cut).toBeGreaterThanOrEqual(4);
    expect(cut).toBeLessThan(8);
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
});
