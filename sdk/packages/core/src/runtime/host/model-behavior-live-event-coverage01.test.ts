/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-LIVE-EVENT-COVERAGE01 — RED witnesses.
 *
 * The M3 benchmark's native installed-VSIX trace captured 121
 * `compaction_diagnostics` events but ZERO `model_request_start`,
 * `model_request_finish`, `tool_start`, `tool_finish`, `loop_verdict` or
 * `run_terminated` events, and every compaction decision used the model's
 * 1048576-token budget instead of the session's configured 512000-token
 * ceiling.
 *
 * These witnesses reproduce BOTH defects against the REAL production seams:
 *
 *   W1  `LocalRuntimeHost` builds the `AgentConfig` for the session runtime
 *       WITHOUT forwarding `modelBehaviorTraceSink`. The sink therefore never
 *       reaches `AgentRuntime`, so no model/tool boundary is ever observed.
 *       (Defect at `local-runtime-host.ts` — the `agentConfig` literal.)
 *
 *   W2  `splitCoreSessionConfig()` rebuilds the `compaction` config object
 *       field-by-field and OMITS `userContextCeiling`, so the configured
 *       operating ceiling never reaches the compaction policy.
 *       (Defect at `runtime-host.ts` — the `compaction` reconstruction.)
 *
 * Both witnesses are RED against the unpatched sources and GREEN after the
 * bounded repair.
 */

import type {
	AgentConfig,
	AgentResult,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionManifest } from "../../session/models/session-manifest";
import { SessionSource } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createResult(): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: { inputTokens: 1, outputTokens: 2, totalCost: 0 },
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: { id: "mock-model", provider: "mock-provider" },
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
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

function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
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

function createSink(): ModelBehaviorTraceSink {
	return {
		isTraceEnabled: () => true,
		onModelRequestStart: vi.fn(),
		onModelRequestFinish: vi.fn(),
		onToolStart: vi.fn(),
		onToolFinish: vi.fn(),
		onLoopVerdict: vi.fn(),
		onRunTerminated: vi.fn(),
		onCompactionDiagnostics: vi.fn(),
		onCompactionCompleted: vi.fn(),
	};
}

/**
 * Start a session on a REAL `LocalRuntimeHost` and capture the `AgentConfig`
 * the host hands to the session runtime.
 */
async function captureAgentConfig(
	config: CoreSessionConfig,
): Promise<AgentConfig> {
	const sessionId = "sess-model-behavior-live-event-coverage01";
	const manifest = createManifest(sessionId);
	const sessionService = {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-mblive.json",
			messagesPath: "/tmp/messages-mblive.json",
			manifest,
		}),
		persistSessionMessages: vi.fn(),
		updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
		writeSessionManifest: vi.fn(),
		listSessions: vi.fn().mockResolvedValue([]),
		deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
	};
	const createAgent = vi.fn().mockReturnValue({
		run: vi.fn().mockResolvedValue(createResult()),
		continue: vi.fn(),
		abort: vi.fn(),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		canStartRun: vi.fn().mockReturnValue(true),
		getAgentId: vi.fn().mockReturnValue("agent-root-1"),
		getConversationId: vi.fn().mockReturnValue("conv-root-1"),
		restore: vi.fn(),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
		messages: [],
	});
	const manager = new RuntimeHostUnderTest({
		distinctId: "test-machine-id",
		sessionService: sessionService as never,
		runtimeBuilder: {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		},
		createAgent: createAgent as never,
	});

	await manager.startSession(
		normalizeStartInput({ config, interactive: true }),
	);

	const call = createAgent.mock.calls[0];
	expect(
		call,
		"the host must construct exactly one session runtime",
	).toBeDefined();
	return call?.[0] as AgentConfig;
}

// ---------------------------------------------------------------------------
// W1 — the model-behavior observation sink never reaches AgentRuntime
// ---------------------------------------------------------------------------

describe("W1 — modelBehaviorTraceSink reaches the session runtime", () => {
	it("forwards the configured observation sink into the AgentConfig", async () => {
		const sink = createSink();

		const agentConfig = await captureAgentConfig(
			createConfig({ modelBehaviorTraceSink: sink }),
		);

		// RED before the repair: `local-runtime-host.ts` builds the
		// `AgentConfig` literal WITHOUT `modelBehaviorTraceSink`, so the sink
		// is dropped on the way to `AgentRuntime` and no model/tool boundary
		// can ever be observed.
		expect(agentConfig.modelBehaviorTraceSink).toBe(sink);
	});

	it("leaves the runtime observationally inert when no sink is configured", async () => {
		const agentConfig = await captureAgentConfig(createConfig());

		expect(agentConfig.modelBehaviorTraceSink).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// W2 — the configured context ceiling survives the session-config split
// ---------------------------------------------------------------------------

describe("W2 — the user context ceiling survives the session-config split", () => {
	it("preserves compaction.userContextCeiling through splitCoreSessionConfig", () => {
		const split = splitCoreSessionConfig(
			createConfig({
				compaction: {
					enabled: true,
					strategy: "basic",
					userContextCeiling: 512_000,
				},
			}),
		);

		// RED before the repair: `splitCoreSessionConfig()` rebuilds the
		// `compaction` object field-by-field and omits `userContextCeiling`,
		// so the configured operating ceiling never reaches the compaction
		// policy and the model's own 1048576-token budget wins instead.
		//
		// This is the PRODUCTION path: the VSCode session factory sets
		// `compaction: { enabled, strategy, userContextCeiling }` (no custom
		// `compact` override), so `split.config.compaction` is what
		// `LocalRuntimeHost` consumes.
		expect(split.config.compaction?.userContextCeiling).toBe(512_000);
	});

	it("preserves compaction.userContextCeiling alongside a custom compact override", () => {
		const compact = vi.fn();
		const split = splitCoreSessionConfig(
			createConfig({
				compaction: {
					enabled: true,
					strategy: "basic",
					userContextCeiling: 512_000,
					compact,
				},
			}),
		);

		// The custom-compaction branch forwards the WHOLE compaction object
		// through `localRuntime`, so the ceiling must survive there too.
		expect(split.localRuntime?.compaction?.userContextCeiling).toBe(512_000);
		expect(split.localRuntime?.compaction?.compact).toBe(compact);
	});

	it("leaves the ceiling absent when the session does not configure one", () => {
		const split = splitCoreSessionConfig(
			createConfig({ compaction: { enabled: true, strategy: "basic" } }),
		);

		expect(split.config.compaction?.userContextCeiling).toBeUndefined();
	});
});
