/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-EVENT-COVERAGE01 — END-TO-END witness.
 *
 * The installed-VSIX trace proved the missing events are NOT a recorder
 * problem: the recorder, the sink and every `AgentRuntime` observation site
 * were correct. The observer attachment was missing at ONE seam — the
 * `AgentConfig` the `LocalRuntimeHost` builds for the session runtime did
 * not carry `modelBehaviorTraceSink`.
 *
 * This witness proves the COMPLETE chain, end to end, with REAL production
 * classes:
 *
 *   LocalRuntimeHost  →  AgentConfig  →  SessionRuntime  →  AgentRuntime
 *                                                      ↘  real model request
 *                                                      ↘  real tool execution
 *                                                      ↘  real recorder
 *
 * The model is scripted (no network), but the model-request boundary, the
 * tool-execution boundary, the orchestrator and the recorder are all the
 * production implementations.
 *
 * Gates:
 *   E1  A real model request produces correlated start/finish records.
 *   E2  A real tool execution produces correlated start/finish records.
 *   E3  The records carry the real session/run identity.
 *   E4  Tracing OFF produces the same execution result and NO records.
 *   E5  The recorder never retains raw prompt/tool content.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentConfig,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceRecord,
} from "@cline/shared";
import { ModelBehaviorTraceRecorder } from "@cline/shared";
import { setClineDir, setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionManifest } from "../../session/models/session-manifest";
import { SessionSource } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

// The production agent runtime imports `@cline/llms` at module scope, and
// the shared barrel evaluates `agents/types.ts`, which calls `z.object(...)`
// at module scope. This package's unit-test vitest config does not
// pre-bundle zod, so the llms gateway CONSTRUCTION is stubbed — exactly as
// the sibling `sdk/packages/agents/src/agent-runtime.model-behavior-trace.test.ts`
// does. Every other export of `@cline/llms` is preserved, because the core
// package legitimately imports the provider catalogs from it.
//
// The witness still drives the REAL agent runtime; only the provider
// gateway CONSTRUCTION is stubbed (this witness supplies its own scripted
// `AgentModel`).
vi.mock("@cline/llms", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/llms")>();
	return {
		...actual,
		createGateway: vi.fn(() => ({
			createAgentModel: vi.fn(),
		})),
	};
});

import { createAgentRuntime } from "@cline/agents";
import { createContextCompactionPrepareTurn } from "../../extensions/context/compaction";
import { SessionRuntime } from "../orchestration/session-runtime-orchestrator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A scripted model: one tool call, then a plain text answer. */
class ScriptedModel implements AgentModel {
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

function toolCallStep(
	toolName: string,
	toolCallId: string,
	value: string,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			index: 0,
			input: { value },
		} as unknown as AgentModelEvent,
		{ type: "finish", reason: "tool_use" } as unknown as AgentModelEvent,
	];
}

function textStep(
	text: string,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "text", text } as unknown as AgentModelEvent,
		{ type: "finish", reason: "stop" } as unknown as AgentModelEvent,
	];
}

interface TestTool {
	name: string;
	description: string;
	inputSchema: { type: "object"; properties: Record<string, unknown> };
	execute: (input: Record<string, unknown>) => Promise<{ output: string }>;
}

function makeRecordingTool(name: string, calls: string[]): TestTool {
	return {
		name,
		description: `test tool ${name}`,
		inputSchema: { type: "object", properties: {} },
		execute: async (input: Record<string, unknown>) => {
			calls.push(`${name}:${String(input.value ?? "")}`);
			return { output: `ok:${name}` };
		},
	};
}

function createManifest(sessionId: string): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		started_at: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/project",
		workspace_root: "/tmp/project",
		enable_tools: true,
		enable_spawn: true,
		enable_teams: true,
		prompt: "hello",
		messages_path: "/tmp/messages.json",
	};
}

function normalizeStartInput(
	input: Omit<StartSessionInput, "config" | "localRuntime"> & {
		config: CoreSessionConfig;
	},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	return { ...input, ...split };
}

// ---------------------------------------------------------------------------
// The end-to-end driver
// ---------------------------------------------------------------------------

interface E2EResult {
	readonly records: readonly ModelBehaviorTraceRecord[];
	readonly toolCalls: string[];
	readonly agentConfig: AgentConfig;
}

/**
 * Drive the REAL chain:
 *
 *   LocalRuntimeHost.startSession()
 *     → the `AgentConfig` it builds (the seam that dropped the sink)
 *     → SessionRuntime (the real orchestrator)
 *     → AgentRuntime (the real runtime)
 *     → a real model request and a real tool execution
 *
 * The `AgentConfig` the host produced is handed to the REAL `SessionRuntime`
 * so the orchestrator's own `createAgentRuntimeConfig` runs — exactly as in
 * production, where the host passes that config to the session runtime.
 */
async function runEndToEnd(options: {
	traceEnabled: boolean;
}): Promise<E2EResult> {
	const toolCalls: string[] = [];
	const recorder = new ModelBehaviorTraceRecorder();
	recorder.setEnabled(options.traceEnabled);

	// The recorder's identity is the OBSERVATION's identity — the real
	// session id the host allocated and the runtime's own run id. This
	// mirrors what the production `modelBehaviorTraceSink` adapter does.
	const record = (
		event:
			| "effective_model_config"
			| "model_request_start"
			| "model_request_finish"
			| "tool_start"
			| "tool_finish"
			| "loop_verdict"
			| "compaction_diagnostics"
			| "compaction_completed"
			| "run_terminated",
		observation: ModelBehaviorTraceObservation,
	): void => {
		recorder.record(
			event,
			{
				...(observation.sessionId !== undefined
					? { sessionId: observation.sessionId }
					: {}),
				...(observation.taskId !== undefined
					? { taskId: observation.taskId }
					: {}),
				...(observation.runId !== undefined
					? { runId: observation.runId }
					: {}),
				...(observation.iteration !== undefined
					? { iteration: observation.iteration }
					: {}),
				...(observation.providerId !== undefined
					? { providerId: observation.providerId }
					: {}),
				...(observation.modelId !== undefined
					? { modelId: observation.modelId }
					: {}),
			},
			observation.payload,
		);
	};

	const sink = {
		isTraceEnabled: () => recorder.isEnabled(),
		fingerprintToolArguments: async (
			toolName: string,
			input: unknown,
		): Promise<string | undefined> =>
			(await recorder.fingerprintArguments(toolName, input))?.fingerprint,
		onEffectiveModelConfig: (
			observation: ModelBehaviorTraceObservation,
		): void => {
			record("effective_model_config", observation);
		},
		onModelRequestStart: (observation: ModelBehaviorTraceObservation): void => {
			record("model_request_start", observation);
		},
		onModelRequestFinish: (
			observation: ModelBehaviorTraceObservation,
		): void => {
			record("model_request_finish", observation);
		},
		onToolStart: (observation: ModelBehaviorTraceObservation): void => {
			record("tool_start", observation);
		},
		onToolFinish: (observation: ModelBehaviorTraceObservation): void => {
			record("tool_finish", observation);
		},
		onLoopVerdict: (observation: ModelBehaviorTraceObservation): void => {
			record("loop_verdict", observation);
		},
		onCompactionDiagnostics: (
			observation: ModelBehaviorTraceObservation,
		): void => {
			record("compaction_diagnostics", observation);
		},
		onCompactionCompleted: (
			observation: ModelBehaviorTraceObservation,
		): void => {
			record("compaction_completed", observation);
		},
		onRunTerminated: (observation: ModelBehaviorTraceObservation): void => {
			record("run_terminated", observation);
		},
	};

	const sessionId = "sess-e2e-model-behavior-live-event-coverage01";
	const manifest = createManifest(sessionId);
	const sessionService = {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-e2e.json",
			messagesPath: "/tmp/messages-e2e.json",
			manifest,
		}),
		persistSessionMessages: vi.fn(),
		updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
		writeSessionManifest: vi.fn(),
		listSessions: vi.fn().mockResolvedValue([]),
		deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
	};

	// The REAL agent runtime, with a scripted model. The runtime is created
	// by the REAL `SessionRuntime` orchestrator from the host-produced
	// `AgentConfig`, so the sink's arrival is decided by the host.
	let agentConfig: AgentConfig | undefined;
	const manager = new RuntimeHostUnderTest({
		distinctId: "test-machine-id",
		sessionService: sessionService as never,
		runtimeBuilder: {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		},
		createAgent: ((config: AgentConfig) => {
			agentConfig = config;
			// The production host hands the `AgentConfig` to the session
			// runtime. This seam reproduces that hand-off so the REAL
			// orchestrator + REAL `AgentRuntime` consume the host-produced
			// config verbatim.
			return new SessionRuntime(config, {
				createAgentRuntimeImpl: (runtimeConfig) =>
					createAgentRuntime({
						...runtimeConfig,
						model: new ScriptedModel([
							toolCallStep("read_file", "tc-e2e-1", "alpha"),
							textStep("done"),
						]),
						tools: [makeRecordingTool("read_file", toolCalls)],
					} as never),
			});
		}) as never,
	});

	await manager.startSession(
		normalizeStartInput({
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: "/tmp/project",
				systemPrompt: "You are a test agent",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				modelBehaviorTraceSink: sink,
			},
			interactive: true,
		}),
	);

	expect(
		agentConfig,
		"the host must construct the session runtime",
	).toBeDefined();

	// Run the real orchestrator with the real runtime.
	const runtime = manager as unknown as {
		runTurn(input: { sessionId: string; prompt: string }): Promise<unknown>;
	};
	await runtime.runTurn({ sessionId, prompt: "do the thing" });

	return {
		records: recorder.getRecords(),
		toolCalls,
		agentConfig: agentConfig as AgentConfig,
	};
}

// ---------------------------------------------------------------------------
// Witnesses
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-EVENT-COVERAGE01 — end-to-end", () => {
	// The production runtime writes hook logs under the Cline data dir, so
	// the witness MUST run against an isolated home — otherwise it touches
	// the developer's real `~/.cline` tree.
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	};
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-mblive-home-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	it("E1/E2/E3: a real model request and tool execution produce correlated records", async () => {
		const result = await runEndToEnd({ traceEnabled: true });

		// The tool really executed.
		expect(result.toolCalls).toContain("read_file:alpha");

		const kinds = result.records.map((record) => record.event);
		expect(kinds).toContain("model_request_start");
		expect(kinds).toContain("model_request_finish");
		expect(kinds).toContain("tool_start");
		expect(kinds).toContain("tool_finish");

		// E3 — the records carry the REAL session identity the host
		// allocated, so the timeline is correlatable.
		const starts = result.records.filter(
			(record) => record.event === "model_request_start",
		);
		expect(starts.length).toBeGreaterThanOrEqual(1);
		expect(starts[0]?.sessionId).toBe(
			"sess-e2e-model-behavior-live-event-coverage01",
		);
		expect(starts[0]?.runId).toBeDefined();

		// The tool boundaries correlate by the runtime's OWN tool-call id.
		const toolStarts = result.records.filter(
			(record) => record.event === "tool_start",
		);
		const toolFinishes = result.records.filter(
			(record) => record.event === "tool_finish",
		);
		expect(toolStarts).toHaveLength(1);
		expect(toolFinishes).toHaveLength(1);
		expect(toolStarts[0]?.payload.toolCallId).toBe("tc-e2e-1");
		expect(toolFinishes[0]?.payload.toolCallId).toBe("tc-e2e-1");
		expect(toolStarts[0]?.payload.toolName).toBe("read_file");
		expect(toolFinishes[0]?.payload.toolName).toBe("read_file");

		// The model-request boundaries pair by the runtime's own run id.
		const modelFinishes = result.records.filter(
			(record) => record.event === "model_request_finish",
		);
		expect(modelFinishes.length).toBeGreaterThanOrEqual(1);
		expect(modelFinishes[0]?.runId).toBe(starts[0]?.runId);
	});

	it("E5: the recorded payload never retains raw prompt or tool content", async () => {
		const result = await runEndToEnd({ traceEnabled: true });
		const serialized = JSON.stringify(result.records);

		// The prompt text, the tool output and the tool argument VALUE are
		// never retained — only privacy-safe scalars and fingerprints.
		expect(serialized).not.toContain("do the thing");
		expect(serialized).not.toContain("ok:read_file");
		expect(serialized).not.toContain("alpha");
	});

	it("E4: tracing OFF records nothing and does not change the execution", async () => {
		const on = await runEndToEnd({ traceEnabled: true });
		const off = await runEndToEnd({ traceEnabled: false });

		expect(off.records).toHaveLength(0);

		// The execution is IDENTICAL with tracing on and off.
		expect(off.toolCalls).toEqual(on.toolCalls);
	});

	it("E6: the compaction policy uses the CONFIGURED ceiling, not the model's own budget", async () => {
		// The REAL config split, then the REAL compaction policy, with the
		// REAL model budget of the M3 benchmark (1048576) and the session's
		// CONFIGURED ceiling (512000).
		const split = splitCoreSessionConfig({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			workspaceRoot: "/tmp/project",
			systemPrompt: "You are helpful.",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			compaction: {
				enabled: true,
				strategy: "basic",
				userContextCeiling: 512_000,
			},
		});

		const diagnostics: ModelBehaviorTraceObservation[] = [];
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			providerConfig: {
				providerId: "minimax",
				modelId: "MiniMax-M3",
			} as never,
			// The ceiling as it arrives from the REAL config split.
			compaction: split.config.compaction,
			sessionId: "sess-e2e-ceiling",
			modelBehaviorTraceSink: {
				onCompactionDiagnostics: (
					observation: ModelBehaviorTraceObservation,
				): void => {
					diagnostics.push(observation);
				},
			},
		});

		const messages = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		] as never;

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "MiniMax-M3",
				provider: "minimax",
				info: {
					id: "MiniMax-M3",
					// The model's OWN budget — exactly what the installed trace
					// used for all 121 production compaction decisions.
					maxInputTokens: 1_048_576,
					contextWindow: 1_048_576,
					maxTokens: 1_000_000,
				},
			},
		});

		expect(diagnostics).toHaveLength(1);
		const payload = diagnostics[0]?.payload ?? {};
		// The CONFIGURED ceiling wins, and the provenance says so.
		expect(payload.maxInputTokens).toBe(512_000);
		expect(payload.effectiveMaxInputTokens).toBe(512_000);
		expect(payload.inputBudgetSource).toBe("userCeiling");
		expect(payload.userContextCeiling).toBe(512_000);
		// The model's own 1048576 budget is NOT the operating budget.
		expect(payload.maxInputTokens).not.toBe(1_048_576);
	});
});
