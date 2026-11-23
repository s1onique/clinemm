/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION02
 *
 * THE HOOK-BOUNDARY SUITE for the acquisition-time evidence capture.
 *
 * WHAT THIS SUITE CLOSES
 * ----------------------
 *
 * The predecessor suite
 * (`session-runtime-orchestrator.adjudication-acquisition.correction01.test.ts`)
 * asserted that the acquisition record describes "the result the host's
 * `afterTool` hook PRODUCED" — but it never INVOKED the hook. It fed an
 * already-replaced result straight into the conversion helpers, so the
 * production hook ORDERING (`const result = control?.result ?? ctx.result`)
 * was only ever STRUCTURALLY INSPECTED, never EXECUTED.
 *
 * This suite drives the REAL production seam:
 *
 *   SessionRuntime.createRuntimeHooks()      (the real hook factory)
 *     -> hooks.afterTool(ctx)                (the real hook)
 *       -> captureToolAcquisition(...)       (the real capture)
 *         -> the recorded acquisition record
 *
 * The `afterTool` hook is obtained from a REAL `SessionRuntime` instance
 * and is CALLED with a REAL tool-call context, so the ordering between the
 * host's hook and the acquisition capture is EXECUTED, not assumed.
 *
 * THE INVARIANT
 * --------------
 *
 *   The acquisition record must describe the EFFECTIVE result — the one
 *   the host's `afterTool` hook produced — because an `afterTool` hook is
 *   a RESULT-TRANSFORMING hook: the pre-hook result is not necessarily the
 *   result the canonical history records, and a record derived from it
 *   would describe content that was never persisted.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC.
 */

import type { AgentConfig } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	captureAcquisitionEvidence,
	type SourceRevision,
} from "../../extensions/context/adjudication-continuity";
import {
	SessionRuntime,
	type SessionRuntimeOrchestratorDeps,
} from "./session-runtime-orchestrator";

const SOURCE_PATH = "/synthetic/workspace/synthetic-pool-config.yaml";

const SYNTHETIC_REVISION: SourceRevision = {
	repositoryIdentity: "synthetic-repo",
	workspaceRootIdentity: "synthetic-root",
	revision: "9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd",
	contentIdentity:
		"3b1f0c9a7d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a",
	clean: true,
};

/**
 * The resolver the host supplies. It answers for the synthetic source path
 * only, so a capture of any other path establishes no source identity.
 */
const RESOLVER = {
	resolve: ({ sourcePath }: { sourcePath: string }) =>
		sourcePath === SOURCE_PATH ? SYNTHETIC_REVISION : undefined,
};

const PRE_HOOK_OUTPUT = [
	{ query: SOURCE_PATH, result: "PRE-HOOK CONTENT", success: true },
];

const POST_HOOK_OUTPUT = [
	{ query: SOURCE_PATH, result: "POST-HOOK CONTENT", success: true },
];

/**
 * The content identity the PRODUCTION capture computes for a content.
 *
 * The expectation is derived through the production capture function
 * itself, so it cannot drift from the implementation.
 */
async function hashOf(content: unknown): Promise<string> {
	const evidence = await captureAcquisitionEvidence({
		toolUseId: "call_1",
		toolName: "read_files",
		content,
		resolver: RESOLVER,
	});
	return evidence?.contentIdentities.get(SOURCE_PATH) ?? "";
}

/**
 * The minimal deps a `SessionRuntime` needs to construct. The agent runtime
 * is never RUN here — the suite exercises the HOOK FACTORY, which is the
 * production seam under test.
 */
function makeDeps(): SessionRuntimeOrchestratorDeps {
	return {
		createAgentRuntimeImpl: () =>
			({
				async run() {
					throw new Error("the agent runtime is not exercised here");
				},
				async continue() {
					throw new Error("the agent runtime is not exercised here");
				},
				abort() {},
				subscribe() {
					return () => {};
				},
				snapshot: () => ({
					agentId: "agent_fake",
					runId: "run_fake",
					status: "running" as const,
					iteration: 1,
				}),
			}) as never,
	} as SessionRuntimeOrchestratorDeps;
}

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-key",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
		...overrides,
	};
}

/**
 * Build a REAL `SessionRuntime` whose runtime hooks include a host
 * `afterTool` hook, and return both the session and the real hooks.
 */
function makeSessionWithAfterTool(
	afterTool: (ctx: Record<string, unknown>) => unknown,
): { session: SessionRuntime; hooks: Record<string, unknown> } {
	const session = new SessionRuntime(
		makeAgentConfig({
			hooks: { afterTool } as never,
			adjudication: { revisionResolver: RESOLVER } as never,
		}),
		makeDeps(),
	);
	const hooks = (
		session as unknown as {
			createRuntimeHooks(): Record<string, unknown>;
		}
	).createRuntimeHooks();
	return { session, hooks };
}

/**
 * The tool-call context the agent runtime hands to the `afterTool` hook.
 *
 * It carries every field the production hook reads: the tool-call identity
 * (which the capture keys on), the tool (whose `resultPolicy` the hook
 * consults) and the result (which the hook may replace).
 */
function afterToolContext(output: unknown) {
	return {
		snapshot: {
			agentId: "agent_fake",
			runId: "run_fake",
			status: "running" as const,
			iteration: 1,
		},
		tool: { name: "read_files" },
		toolCall: {
			toolCallId: "call_1",
			toolName: "read_files",
			input: { path: SOURCE_PATH },
		},
		input: { path: SOURCE_PATH },
		result: { output, isError: false },
		startedAt: new Date(0),
		endedAt: new Date(0),
		durationMs: 0,
	};
}

/**
 * The acquisition record the runtime captured for one tool call.
 *
 * The records live in a private map, so the suite reads them the way the
 * production code populates them.
 */
function capturedRecord(
	session: SessionRuntime,
): { contentIdentities: Record<string, string> } | undefined {
	return (
		session as unknown as {
			toolAcquisitions?: Map<
				string,
				{ contentIdentities: Record<string, string> }
			>;
		}
	).toolAcquisitions?.get("call_1");
}

/**
 * The content identity the runtime recorded for the synthetic source path.
 */
function capturedContentIdentity(session: SessionRuntime): string | undefined {
	return capturedRecord(session)?.contentIdentities[SOURCE_PATH];
}

describe("the acquisition capture observes the EFFECTIVE, POST-HOOK result", () => {
	it("captures the result the host's afterTool hook PRODUCED", async () => {
		// The host's hook REPLACES the result. The EFFECTIVE result is the
		// replacement, so the acquisition record must describe the
		// replacement's content and NOT the pre-hook content.
		const { session, hooks } = makeSessionWithAfterTool(() => ({
			result: { output: POST_HOOK_OUTPUT, isError: false },
		}));

		const afterTool = hooks.afterTool as (ctx: unknown) => Promise<unknown>;
		await afterTool(afterToolContext(PRE_HOOK_OUTPUT));

		// The capture ran, and it ran for the tool call under test.
		expect(capturedRecord(session)).toBeDefined();
		expect(capturedContentIdentity(session)).toBeTruthy();
	});

	it("does NOT capture the PRE-HOOK result when the hook REPLACES it", async () => {
		// The decisive assertion: the recorded content identity is the one
		// of the EFFECTIVE content, not the one of the content the hook
		// replaced.
		const { session, hooks } = makeSessionWithAfterTool(() => ({
			result: { output: POST_HOOK_OUTPUT, isError: false },
		}));

		const afterTool = hooks.afterTool as (ctx: unknown) => Promise<unknown>;
		await afterTool(afterToolContext(PRE_HOOK_OUTPUT));

		expect(capturedContentIdentity(session)).toBe(
			await hashOf(POST_HOOK_OUTPUT),
		);
		expect(capturedContentIdentity(session)).not.toBe(
			await hashOf(PRE_HOOK_OUTPUT),
		);
	});

	it("captures the PRE-HOOK result when the hook does NOT replace it", async () => {
		// The control: a hook that returns no replacement leaves the
		// EFFECTIVE result equal to the pre-hook result, so the capture
		// must describe the pre-hook content.
		const { session, hooks } = makeSessionWithAfterTool(() => undefined);

		const afterTool = hooks.afterTool as (ctx: unknown) => Promise<unknown>;
		await afterTool(afterToolContext(PRE_HOOK_OUTPUT));

		expect(capturedContentIdentity(session)).toBe(
			await hashOf(PRE_HOOK_OUTPUT),
		);
	});

	it("produces NO record when the runtime has no revision resolver", async () => {
		// The control: with no resolver the runtime captures nothing, so
		// the ordinary path stays byte-identical.
		const session = new SessionRuntime(makeAgentConfig(), makeDeps());
		const hooks = (
			session as unknown as {
				createRuntimeHooks(): Record<string, unknown>;
			}
		).createRuntimeHooks();
		const afterTool = hooks.afterTool as (ctx: unknown) => Promise<unknown>;
		await afterTool(afterToolContext(PRE_HOOK_OUTPUT));
		expect(capturedRecord(session)).toBeUndefined();
	});
});
