/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 (TES-OUT-01)
 *
 * Proves the typed runtime-outcome observation seam REACHES the real
 * `AgentRuntime` through the production session construction path.
 *
 * Before this ACT the hook was dropped by BOTH merge layers
 * (`mergeAgentHooks` in `src/hooks/hook-file-hooks.ts` and
 * `mergeRuntimeHooks` in `session-runtime-orchestrator.ts`), so NO host
 * could ever subscribe to the runtime's authoritative
 * `ToolRuntimeOutcome`. This suite pins the closed wiring.
 *
 * Scope:
 *   - `mergeAgentHooks` fans out `onToolRuntimeOutcome`;
 *   - `SessionRuntime.createRuntimeHooks()` (the real production method
 *     used to build the `AgentRuntime` hook bag) fans it out too;
 *   - the composed hook is READ-ONLY: its return value never reaches the
 *     runtime's execution decision.
 */
import type { AgentRuntimeHooks, ToolRuntimeOutcome } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { mergeAgentHooks } from "../../hooks/hook-file-hooks";
import {
	SessionRuntime,
	type SessionRuntimeOrchestratorDeps,
} from "./session-runtime-orchestrator";

function makeAgentConfig(
	overrides: Partial<Parameters<typeof SessionRuntime>[0]> = {},
) {
	return {
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-key",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
		...overrides,
	} as Parameters<typeof SessionRuntime>[0];
}

const noopDeps: SessionRuntimeOrchestratorDeps = {};

function successOutcome(toolCallId: string): ToolRuntimeOutcome {
	return { kind: "success", toolName: "echo", toolCallId };
}

describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 / runtime outcome hook wiring", () => {
	it("TESOUTSDK-01: mergeAgentHooks fans out the onToolRuntimeOutcome observation seam", async () => {
		const seen: string[] = [];
		const merged = mergeAgentHooks([
			{
				onToolRuntimeOutcome: (ctx) => {
					seen.push(ctx.toolCall.toolCallId);
				},
			},
		]);
		expect(merged?.onToolRuntimeOutcome).toBeDefined();
		await merged?.onToolRuntimeOutcome?.({
			toolCall: {
				type: "tool-call",
				toolCallId: "call-1",
				toolName: "echo",
				input: {},
			},
			outcome: successOutcome("call-1"),
		});
		expect(seen).toEqual(["call-1"]);
	});

	it("TESOUTSDK-02: the real SessionRuntime runtime-hook bag fans out the outcome seam", async () => {
		const seen: ToolRuntimeOutcome[] = [];
		const session = new SessionRuntime(
			makeAgentConfig({
				hooks: {
					onToolRuntimeOutcome: (ctx) => {
						seen.push(ctx.outcome);
					},
				} satisfies Partial<AgentRuntimeHooks>,
			}),
			noopDeps,
		);
		const hooks = (
			session as unknown as {
				createRuntimeHooks(): AgentRuntimeHooks;
			}
		).createRuntimeHooks();
		expect(hooks.onToolRuntimeOutcome).toBeDefined();
		await hooks.onToolRuntimeOutcome?.({
			toolCall: {
				type: "tool-call",
				toolCallId: "call-2",
				toolName: "echo",
				input: {},
			},
			outcome: successOutcome("call-2"),
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]?.kind).toBe("success");
	});

	it("TESOUTSDK-03: the outcome seam is READ-ONLY — its return value is ignored", async () => {
		const session = new SessionRuntime(
			makeAgentConfig({
				hooks: {
					onToolRuntimeOutcome: () => "not-a-control-value" as never,
				} satisfies Partial<AgentRuntimeHooks>,
			}),
			noopDeps,
		);
		const hooks = (
			session as unknown as {
				createRuntimeHooks(): AgentRuntimeHooks;
			}
		).createRuntimeHooks();
		// The merged observer must not surface a control-plane value to the
		// runtime. The runtime ignores the return value entirely; this
		// assertion pins that the composed hook does not fabricate one.
		const result = await hooks.onToolRuntimeOutcome?.({
			toolCall: {
				type: "tool-call",
				toolCallId: "call-3",
				toolName: "echo",
				input: {},
			},
			outcome: successOutcome("call-3"),
		});
		expect(result === undefined || result === null).toBe(true);
	});
});
