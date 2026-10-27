/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — REAL orchestrator path witnesses.
 *
 * These witnesses drive the REAL `SessionRuntime` orchestrator with the
 * REAL `LoopDetectionTracker` and the REAL tool-boundary handling, so the
 * recorded observations come from the production event path.
 *
 * Gates covered here:
 *   T04  Tool start/finish match by tool-call identity (orchestrator level).
 *   T10  Existing loop-detector behavior unchanged.
 *   T13  Trace ON/OFF produces equivalent execution results.
 */
import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
	ModelBehaviorTraceObservation,
} from "@cline/shared"
import {
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
} from "@cline/shared"
import type { AgentRuntime } from "@cline/agents"
import { describe, expect, it } from "vitest"
import {
	SessionRuntime,
	type SessionRuntimeOrchestratorDeps,
} from "./session-runtime-orchestrator"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_fake",
		runId: "run_fake",
		status: "running",
		iteration: 1,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	};
}

function toolStartedEvent(
	toolCallId: string,
	toolName: string,
	input: unknown,
): AgentRuntimeEvent {
	return {
		type: "tool-started",
		snapshot: makeSnapshot(),
		iteration: 1,
		toolCall: {
			type: "tool-call",
			toolCallId,
			toolName,
			input,
		},
	} as AgentRuntimeEvent;
}

function toolFinishedEvent(
	toolCallId: string,
	toolName: string,
	isError: boolean,
): AgentRuntimeEvent {
	return {
		type: "tool-finished",
		snapshot: makeSnapshot(),
		iteration: 1,
		toolCall: {
			type: "tool-call",
			toolCallId,
			toolName,
			input: { value: "x" },
		},
		message: {
			id: `msg-${toolCallId}`,
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId,
					toolName,
					output: isError ? "boom" : "ok",
					isError,
				},
			],
			createdAt: Date.now(),
		},
	} as AgentRuntimeEvent;
}

interface CapturedRuntime {
	runtime: AgentRuntime;
	listeners: Set<(event: AgentRuntimeEvent) => void>;
}

function makeFakeRuntime(events: AgentRuntimeEvent[]): CapturedRuntime {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>();
	const baseResult = {
		agentId: "agent_fake",
		runId: "run_fake",
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	};
	const emit = (): void => {
		for (const event of events) {
			for (const listener of listeners) {
				listener(event);
			}
		}
	};
	const runtime = {
		async run() {
			emit();
			return baseResult;
		},
		async continue() {
			emit();
			return baseResult;
		},
		abort() {
			/* no-op */
		},
		subscribe(listener: (event: AgentRuntimeEvent) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		restore() {
			/* no-op */
		},
	};
	return { runtime: runtime as unknown as AgentRuntime, listeners };
}

function makeCollectingSink(): {
	sink: NonNullable<
		SessionRuntimeOrchestratorDeps["modelBehaviorTraceSink"]
	>;
	observations: ModelBehaviorTraceObservation[];
} {
	const observations: ModelBehaviorTraceObservation[] = [];
	const push = (
		kind: string,
		observation: ModelBehaviorTraceObservation,
	): void => {
		observations.push({ ...observation, payload: { kind, ...observation.payload } });
	};
	const sink = {
		onModelRequestStart: (observation: ModelBehaviorTraceObservation) =>
			push("start", observation),
		onModelRequestFinish: (observation: ModelBehaviorTraceObservation) =>
			push("finish", observation),
		onModelRequestError: (observation: ModelBehaviorTraceObservation) =>
			push("error", observation),
		onModelRequestAbort: (observation: ModelBehaviorTraceObservation) =>
			push("abort", observation),
		onToolStart: (observation: ModelBehaviorTraceObservation) =>
			push("tool_start", observation),
		onToolFinish: (observation: ModelBehaviorTraceObservation) =>
			push("tool_finish", observation),
		onLoopVerdict: (observation: ModelBehaviorTraceObservation) =>
			push("loop_verdict", observation),
		onCompactionDiagnostics: (observation: ModelBehaviorTraceObservation) =>
			push("compaction_diag", observation),
		onCompactionCompleted: (observation: ModelBehaviorTraceObservation) =>
			push("compaction_done", observation),
		onRunTerminated: (observation: ModelBehaviorTraceObservation) =>
			push("terminated", observation),
	};
	return { sink, observations };
}

function makeRuntime(options: {
	events: AgentRuntimeEvent[]
	sink?: SessionRuntimeOrchestratorDeps["modelBehaviorTraceSink"]
}): SessionRuntime {
	const { runtime } = makeFakeRuntime(options.events);
	const deps: SessionRuntimeOrchestratorDeps = {
		createAgentRuntimeImpl: () => runtime,
		...(options.sink ? { modelBehaviorTraceSink: options.sink } : {}),
	};
	return new SessionRuntime(
		{
			providerId: "test-provider",
			modelId: "test-model",
			systemPrompt: "test prompt",
			tools: [],
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			...(options.sink ? { modelBehaviorTraceSink: options.sink } : {}),
		},
		deps,
	);
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("SessionRuntime model behavior trace — real orchestrator path", () => {
	it("T04: the orchestrator correlates the tool-call identity it records", async () => {
		const { sink, observations } = makeCollectingSink();
		const runtime = makeRuntime({
			events: [
				toolStartedEvent("tc-99", "read_file", { path: "/a.ts" }),
				toolFinishedEvent("tc-99", "read_file", false),
			],
			sink,
		});

		await runtime.run("do the thing");

		// The ORCHESTRATOR consumes the tool boundaries and correlates the
		// tool-call identity itself: the `ToolCallRecord` it produces (and
		// exposes on `AgentResult.toolCalls`) carries the SAME id the
		// `tool-started` event carried.
		//
		// NOTE: the orchestrator does NOT emit the tool_start / tool_finish
		// TRACE records itself — those come from the real `AgentRuntime`
		// (witnessed in
		// `sdk/packages/agents/src/agent-runtime.model-behavior-trace.test.ts`).
		// The orchestrator owns the LOOP verdict and the RUN TERMINATION.
		const result = await runtime.run("do the thing");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.id).toBe("tc-99");
		expect(result.toolCalls[0]?.name).toBe("read_file");

		// The orchestrator's own observation channels are the loop verdict
		// and the run termination.
		const kinds = observations.map((observation) => observation.payload.kind);
		expect(kinds).toContain("loop_verdict");
		expect(kinds).toContain("terminated");
	});

	it("T10: the existing loop-detector behavior is unchanged", async () => {
		// Three IDENTICAL consecutive tool calls trip the PRODUCTION soft
		// threshold (default 3) and the fifth trips the hard threshold.
		const { sink, observations } = makeCollectingSink();
		const runtime = makeRuntime({
			events: [
				toolStartedEvent("tc-1", "read_file", { path: "/same.ts" }),
				toolFinishedEvent("tc-1", "read_file", false),
				toolStartedEvent("tc-2", "read_file", { path: "/same.ts" }),
				toolFinishedEvent("tc-2", "read_file", false),
				toolStartedEvent("tc-3", "read_file", { path: "/same.ts" }),
				toolFinishedEvent("tc-3", "read_file", false),
			],
			sink,
		});

		await runtime.run("repeat the same call");

		const verdicts = observations.filter(
			(observation) => observation.payload.kind === "loop_verdict",
		);
		// The sink observed the PRODUCTION verdicts, unmodified.
		expect(verdicts).toHaveLength(3)
		expect(verdicts[0]?.payload.verdict).toBe("ok")
		expect(verdicts[1]?.payload.verdict).toBe("ok")
		expect(verdicts[2]?.payload.verdict).toBe("soft")
		expect(verdicts[2]?.payload.toolName).toBe("read_file")
	});

	it("T10b: the hard escalation verdict is observed without changing it", async () => {
		const { sink, observations } = makeCollectingSink();
		const runtime = makeRuntime({
			events: [
				toolStartedEvent("tc-1", "run_command", { cmd: "x" }),
				toolStartedEvent("tc-2", "run_command", { cmd: "x" }),
				toolStartedEvent("tc-3", "run_command", { cmd: "x" }),
				toolStartedEvent("tc-4", "run_command", { cmd: "x" }),
				toolStartedEvent("tc-5", "run_command", { cmd: "x" }),
			],
			sink,
		});

		await runtime.run("repeat the same call");

		const verdicts = observations.filter(
			(observation) => observation.payload.kind === "loop_verdict",
		)
		expect(verdicts).toHaveLength(5)
		expect(verdicts[4]?.payload.verdict).toBe("hard");
		// The hard verdict is observed; the OBSERVATION does not itself
		// perform the abort — the production loop detector does.
		expect(verdicts[4]?.payload.verdict).toBe("hard");
	});

	it("T13: trace ON and trace OFF produce equivalent execution results", async () => {
		const events = [
			toolStartedEvent("tc-1", "read_file", { path: "/a.ts" }),
			toolFinishedEvent("tc-1", "read_file", false),
		];
		const { sink } = makeCollectingSink();
		const runtimeOn = makeRuntime({ events, sink });
		const runtimeOff = makeRuntime({ events });

		const resultOn = await runtimeOn.run("do the thing");
		const resultOff = await runtimeOff.run("do the thing");

		expect(resultOn.finishReason).toBe(resultOff.finishReason)
		expect(resultOn.iterations).toBe(resultOff.iterations)
		expect(resultOn.toolCalls).toHaveLength(resultOff.toolCalls.length)
	});

	it("T10c: the loop detector is NOT fed when loop detection is disabled", async () => {
		const { sink, observations } = makeCollectingSink();
		const { runtime: fakeRuntime } = makeFakeRuntime([
			toolStartedEvent("tc-1", "read_file", { path: "/same.ts" }),
			toolStartedEvent("tc-2", "read_file", { path: "/same.ts" }),
			toolStartedEvent("tc-3", "read_file", { path: "/same.ts" }),
		]);
		const deps: SessionRuntimeOrchestratorDeps = {
			createAgentRuntimeImpl: () => fakeRuntime,
			modelBehaviorTraceSink: sink,
		};
		const runtime = new SessionRuntime(
			{
				providerId: "test-provider",
				modelId: "test-model",
				systemPrompt: "test prompt",
				tools: [],
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				execution: { loopDetection: false },
				modelBehaviorTraceSink: sink,
			},
			deps,
		);

		await runtime.run("repeat the same call");

		const verdicts = observations.filter(
			(observation) => observation.payload.kind === "loop_verdict",
		)
		// With loop detection disabled the tracker is never fed, so the sink
		// observes NOTHING — the observation did not re-enable it.
		expect(verdicts).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2)
//
// The workspace identity must travel from the ORCHESTRATOR (which owns the
// session's workspace) down to the WRITE LAYER (which is the only layer
// that knows the resolved destination).
//
// These witnesses capture the tool-context metadata the orchestrator
// builds and assert that the workspace identity is present — and that it
// is ABSENT when the recorder is off.
// ---------------------------------------------------------------------------

describe("SessionRuntime — the workspace identity reaches the write layer", () => {
	it("W-E1: the workspace identity is handed down in the tool-context metadata", async () => {
		const { sink, observations } = makeCollectingSink()
		// The orchestrator only hands the workspace identity down when the
		// recorder is PROVABLY ON, so the witness sink reports itself armed.
		const armedSink = {
			...sink,
			isTraceEnabled: () => true,
		}
		const { runtime: fakeRuntime } = makeFakeRuntime([])
		const captured: Record<string, unknown>[] = []

		const deps: SessionRuntimeOrchestratorDeps = {
			createAgentRuntimeImpl: (config) => {
				// Capture the tool-context metadata the orchestrator built.
				captured.push(
					(config.toolContextMetadata ?? {}) as Record<string, unknown>,
				)
				return fakeRuntime
			},
			modelBehaviorTraceSink: armedSink,
		}
		const runtime = new SessionRuntime(
			{
				providerId: "test-provider",
				modelId: "test-model",
				systemPrompt: "test prompt",
				tools: [],
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				workspaceRoot: "/workspace/root",
				modelBehaviorTraceSink: armedSink,
			},
			deps,
		)

		await runtime.run("do the thing")

		expect(captured).toHaveLength(1)
		const metadata = captured[0] ?? {}
		const workspace = metadata[
			EDIT_OBSERVATION_WORKSPACE_METADATA_KEY
		] as { workspaceRoot?: string; benchmarkRoot?: string } | undefined
		expect(workspace).toBeDefined()
		expect(workspace?.workspaceRoot).toBe("/workspace/root")
		// The benchmark root is the workspace whose retained changes the
		// benchmark observes.
		expect(workspace?.benchmarkRoot).toBe("/workspace/root")
		// The sink itself is present, so the executor's observation is live.
		expect(metadata[EDIT_OBSERVATION_SINK_METADATA_KEY]).toBe(armedSink)
		expect(observations.length).toBeGreaterThan(0)
	})

	it("W-E2: with the recorder OFF, NO workspace identity is handed down", async () => {
		const { runtime: fakeRuntime } = makeFakeRuntime([])
		const captured: Record<string, unknown>[] = []
		const deps: SessionRuntimeOrchestratorDeps = {
			createAgentRuntimeImpl: (config) => {
				captured.push(
					(config.toolContextMetadata ?? {}) as Record<string, unknown>,
				)
				return fakeRuntime
			},
		}
		const runtime = new SessionRuntime(
			{
				providerId: "test-provider",
				modelId: "test-model",
				systemPrompt: "test prompt",
				tools: [],
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				workspaceRoot: "/workspace/root",
			},
			deps,
		)

		await runtime.run("do the thing")

		expect(captured).toHaveLength(1)
		const metadata = captured[0] ?? {}
		// Trace OFF: neither the sink nor the workspace identity is added,
		// so the executor's observation channel is completely inert.
		expect(metadata[EDIT_OBSERVATION_WORKSPACE_METADATA_KEY]).toBeUndefined()
		expect(metadata[EDIT_OBSERVATION_SINK_METADATA_KEY]).toBeUndefined()
	})
})
