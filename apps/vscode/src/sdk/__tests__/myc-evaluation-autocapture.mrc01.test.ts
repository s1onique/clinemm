/**
 * ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01 — executable tests for the
 * automatic myc evaluation capture.
 *
 * The tests cover the ACT §6 requirements:
 *
 *   - Dogfood automatically enables capture at activation.
 *   - Public runtime leaves capture disabled.
 *   - No new configuration or environment variable.
 *   - Exactly one logical MCP completion event per call.
 *   - Automatic prime does not double-count.
 *   - Existing task telemetry remains unchanged.
 *   - Injection events correlate with their real session.
 *   - Sequential sessions remain isolated.
 *   - Capture survives restart and writer failure.
 *   - Bounded overflow is explicitly reported.
 *   - No sensitive payloads appear in saved evidence.
 *   - Disabled capture has zero state-semantic delta.
 */

import { readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyMycEvaluationCaptureProfile, resolveEffectiveMycEvaluationCapture } from "@/sdk/dogfood-diagnostic-profile"
import { isDogfoodRuntime } from "@/sdk/dogfood-runtime-profile"
import {
	__drainMycEvaluationWritesForTests,
	__getMycEvaluationAccountingForTests,
	__getMycEvaluationEventsForTests,
	__getMycEvaluationSessionIdsForTests,
	__resetMycEvaluationCaptureForTests,
	__resetMycEvaluationSeamsForTests,
	isMycEvaluationCaptureEnabled,
	MYC_EVALUATION_CAPTURE_SUBDIR,
	MYC_EVALUATION_EVENTS_FILENAME,
	MYC_EVALUATION_MAX_EVENTS_PER_SESSION,
	MYC_EVALUATION_REPORT_FILENAME,
	MYC_EVALUATION_SUMMARY_FILENAME,
	type MycEvaluationEvent,
	recordMycEvaluationEvent,
	resolveMycEvaluationEventsPath,
	setMycEvaluationDataRootResolver,
	setMycEvaluationFileWriter,
	setMycEvaluationWarn,
	setMycEvaluationWriter,
} from "@/sdk/myc-evaluation-capture"
import { checkpointMycEvaluation, recordMycEvaluation, recordMycEvaluationMcpCompletion } from "@/sdk/myc-evaluation-recorder"
import { buildMycEvaluationReport, buildMycEvaluationSummary, classifyRetrieval } from "@/sdk/myc-evaluation-report"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let scratchRoot: string

interface CapturedWrite {
	target: string
	line: string
}

function createInMemoryWrites(): { writes: CapturedWrite[]; files: Map<string, string> } {
	const writes: CapturedWrite[] = []
	const files = new Map<string, string>()
	return { writes, files }
}

function bindSeams(
	root: string,
	writes: CapturedWrite[],
	files: Map<string, string>,
	options: { readonly failWrites?: boolean } = {},
): void {
	setMycEvaluationDataRootResolver(() => root)
	setMycEvaluationWriter(async (target, line) => {
		if (options.failWrites) {
			throw new Error("synthetic writer failure")
		}
		writes.push({ target, line })
	})
	setMycEvaluationFileWriter(async (target, contents) => {
		if (options.failWrites) {
			throw new Error("synthetic file writer failure")
		}
		files.set(target, contents)
	})
	setMycEvaluationWarn(() => {})
}

function readRepoFile(relativePath: string): string {
	return readFileSync(join(__dirname, "..", "..", "..", relativePath), "utf8")
}

beforeEach(async () => {
	scratchRoot = await mkdtemp(join(tmpdir(), "myc-eval-autocapture-"))
	__resetMycEvaluationCaptureForTests()
	__resetMycEvaluationSeamsForTests()
})

afterEach(async () => {
	__resetMycEvaluationCaptureForTests()
	__resetMycEvaluationSeamsForTests()
	await rm(scratchRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// §1 — automatic dogfood activation
// ---------------------------------------------------------------------------

describe("MRC-01 — dogfood automatically enables capture at activation", () => {
	it("MRC-01.a: the dogfood profile enables the capture at activation", () => {
		const result = applyMycEvaluationCaptureProfile(true)
		expect(result.enabled).toBe(true)
		expect(result.flipped).toBe(true)
		expect(isMycEvaluationCaptureEnabled()).toBe(true)
	})

	it("MRC-01.b: activation is idempotent (no duplicate initialization)", () => {
		applyMycEvaluationCaptureProfile(true)
		const second = applyMycEvaluationCaptureProfile(true)
		expect(second.enabled).toBe(true)
		expect(second.flipped).toBe(false)
		expect(isMycEvaluationCaptureEnabled()).toBe(true)
	})

	it("MRC-01.c: the effective contract is exactly isDogfoodRuntime()", () => {
		expect(resolveEffectiveMycEvaluationCapture(true).enabled).toBe(true)
		expect(resolveEffectiveMycEvaluationCapture(false).enabled).toBe(false)
		expect(resolveEffectiveMycEvaluationCapture(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "dogfood" })).enabled).toBe(true)
		expect(resolveEffectiveMycEvaluationCapture(isDogfoodRuntime({})).enabled).toBe(false)
	})
})

describe("MRC-02 — public runtime leaves capture disabled", () => {
	it("MRC-02.a: the public profile leaves the capture disabled", () => {
		const result = applyMycEvaluationCaptureProfile(false)
		expect(result.enabled).toBe(false)
		expect(isMycEvaluationCaptureEnabled()).toBe(false)
	})

	it("MRC-02.b: a public runtime with a garbage profile marker stays disabled", () => {
		expect(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "1" })).toBe(false)
		applyMycEvaluationCaptureProfile(isDogfoodRuntime({ CLINEMM_RUNTIME_PROFILE: "1" }))
		expect(isMycEvaluationCaptureEnabled()).toBe(false)
	})
})

describe("MRC-03 — no new configuration or environment variable", () => {
	it("MRC-03.a: the capture has NO environment-variable override", () => {
		// The module-level seam is the SOLE authority; there is no env
		// fallback path. Setting any plausible env var must not enable it.
		process.env.CLINEMM_MYC_EVAL_CAPTURE = "1"
		try {
			expect(isMycEvaluationCaptureEnabled()).toBe(false)
		} finally {
			delete process.env.CLINEMM_MYC_EVAL_CAPTURE
		}
	})

	it("MRC-03.b: the capture module reads no process.env at all", () => {
		expect(readRepoFile("src/sdk/myc-evaluation-capture.ts")).not.toContain("process.env")
	})

	it("MRC-03.c: the dogfood profile resolver reads no env for this knob", () => {
		const source = readRepoFile("src/sdk/dogfood-diagnostic-profile.ts")
		const resolverBody = source.slice(source.indexOf("export function resolveEffectiveMycEvaluationCapture"))
		const end = resolverBody.indexOf("\n}")
		expect(resolverBody.slice(0, end)).not.toContain("env")
	})
})

// ---------------------------------------------------------------------------
// §4/§6 — persistence, isolation, restart survival, writer failure
// ---------------------------------------------------------------------------

describe("MRC-04 — automatic evidence persistence", () => {
	it("MRC-04.a: events are written to <dataRoot>/diagnostics/myc-evaluation/<session-id>/events.jsonl", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "session_start")
		await __drainMycEvaluationWritesForTests()

		expect(writes.length).toBe(1)
		expect(writes[0].target).toBe(
			join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "session-a", MYC_EVALUATION_EVENTS_FILENAME),
		)
		const parsed = JSON.parse(writes[0].line) as MycEvaluationEvent
		expect(parsed.eventType).toBe("session_start")
		expect(parsed.sessionId).toBe("session-a")
	})

	it("MRC-04.b: the writes are ORDERED (one JSON object per line, causal order)", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "session_start")
		recordMycEvaluation("session-a", "prime_acquisition", { toolName: "myc_prime" })
		recordMycEvaluation("session-a", "mcp_call_completed", { toolName: "myc_recall" })
		await __drainMycEvaluationWritesForTests()

		const lines = writes.map((w) => w.line.trim()).filter((l) => l.length > 0)
		expect(lines.length).toBe(3)
		const events = lines.map((l) => JSON.parse(l) as MycEvaluationEvent)
		expect(events.map((e) => e.eventType)).toEqual(["session_start", "prime_acquisition", "mcp_call_completed"])
	})

	it("MRC-04.c: the summary and the report are written on checkpoint", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "session_start")
		recordMycEvaluation("session-a", "mcp_call_completed", {
			toolName: "myc_recall",
			resultClass: "success",
			callId: "call-1",
		})
		checkpointMycEvaluation("session-a")
		await __drainMycEvaluationWritesForTests()

		const bundleDir = join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "session-a")
		expect(files.has(join(bundleDir, MYC_EVALUATION_SUMMARY_FILENAME))).toBe(true)
		expect(files.has(join(bundleDir, MYC_EVALUATION_REPORT_FILENAME))).toBe(true)
		const summary = JSON.parse(files.get(join(bundleDir, MYC_EVALUATION_SUMMARY_FILENAME)) as string)
		expect(summary.sessionId).toBe("session-a")
		expect(summary.mcpCallCount).toBe(1)
		const report = files.get(join(bundleDir, MYC_EVALUATION_REPORT_FILENAME)) as string
		expect(report).toContain("# myc evaluation")
		expect(report).toContain("## Evidence gaps and capture completeness")
	})

	it("MRC-04.d: the checkpoint is EVENT-DRIVEN (independent of successful C10 completion)", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		// The session never ends normally (no C10 completion), but the
		// checkpoint still lands.
		recordMycEvaluation("session-a", "session_start")
		recordMycEvaluation("session-a", "task_started", { taskId: "session-a" })
		checkpointMycEvaluation("session-a")
		await __drainMycEvaluationWritesForTests()

		const bundleDir = join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "session-a")
		expect(files.has(join(bundleDir, MYC_EVALUATION_SUMMARY_FILENAME))).toBe(true)
	})
})

describe("MRC-05 — sequential sessions remain isolated", () => {
	it("MRC-05.a: two sequential sessions produce DISTINCT bundles", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "session_start")
		recordMycEvaluation("session-a", "mcp_call_completed", { toolName: "myc_recall" })
		recordMycEvaluation("session-b", "session_start")
		recordMycEvaluation("session-b", "mcp_call_completed", { toolName: "myc_recall" })
		recordMycEvaluation("session-b", "mcp_call_completed", { toolName: "myc_recall" })
		checkpointMycEvaluation("session-a")
		checkpointMycEvaluation("session-b")
		await __drainMycEvaluationWritesForTests()

		expect(Array.from(__getMycEvaluationSessionIdsForTests()).sort()).toEqual(["session-a", "session-b"])
		expect(__getMycEvaluationEventsForTests("session-a")).toHaveLength(2)
		expect(__getMycEvaluationEventsForTests("session-b")).toHaveLength(3)

		const summaryA = JSON.parse(
			files.get(join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "session-a", MYC_EVALUATION_SUMMARY_FILENAME)) as string,
		)
		const summaryB = JSON.parse(
			files.get(join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "session-b", MYC_EVALUATION_SUMMARY_FILENAME)) as string,
		)
		expect(summaryA.mcpCallCount).toBe(1)
		expect(summaryB.mcpCallCount).toBe(2)
		expect(summaryA.sessionId).toBe("session-a")
		expect(summaryB.sessionId).toBe("session-b")
	})

	it("MRC-05.b: the session id is sanitized so it cannot escape the capture root", () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		expect(resolveMycEvaluationEventsPath("../../etc/passwd")).toBe(
			join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "__.._etc_passwd", MYC_EVALUATION_EVENTS_FILENAME),
		)
	})
})

describe("MRC-06 — capture survives restart and writer failure", () => {
	it("MRC-06.a: a writer failure NEVER blocks execution and is counted", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files, { failWrites: true })
		applyMycEvaluationCaptureProfile(true)

		// The recorder must not throw.
		expect(() => recordMycEvaluation("session-a", "session_start")).not.toThrow()
		expect(() => recordMycEvaluation("session-a", "mcp_call_completed", { toolName: "myc_recall" })).not.toThrow()
		await __drainMycEvaluationWritesForTests()

		const accounting = __getMycEvaluationAccountingForTests("session-a")
		expect(accounting.writeFailureCount).toBeGreaterThan(0)
		// The in-memory event log still holds the observations.
		expect(__getMycEvaluationEventsForTests("session-a")).toHaveLength(2)
	})

	it("MRC-06.b: an earlier bundle survives a later restart (distinct directories)", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "session_start")
		checkpointMycEvaluation("session-a")
		await __drainMycEvaluationWritesForTests()

		// Simulate an extension restart: the module state is reset, but
		// the on-disk bundle from the previous run must survive.
		__resetMycEvaluationCaptureForTests()
		__resetMycEvaluationSeamsForTests()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)
		recordMycEvaluation("session-b", "session_start")
		checkpointMycEvaluation("session-b")
		await __drainMycEvaluationWritesForTests()

		const root = join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR)
		expect(files.has(join(root, "session-a", MYC_EVALUATION_SUMMARY_FILENAME))).toBe(true)
		expect(files.has(join(root, "session-b", MYC_EVALUATION_SUMMARY_FILENAME))).toBe(true)
	})
})

describe("MRC-07 — exactly one logical MCP completion event per call", () => {
	it("MRC-07.a: one McpHub callTool resolution yields exactly ONE completion observation", async () => {
		const { McpHub } = await import("@/services/mcp/McpHub")
		const hub = new McpHub(
			async () => "/tmp",
			async () => "/tmp",
			"1.0.0",
			{ captureMcpToolCall: () => {} } as never,
		)
		// Inject a fake connection that resolves a non-empty result.
		const connection = {
			server: { name: "myc", disabled: false, config: {} },
			client: {
				request: async () => ({
					content: [{ type: "text", text: "hello" }],
					structuredContent: undefined,
					isError: false,
				}),
			},
		}
		;(hub as unknown as { connections: unknown[] }).connections = [connection]

		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		let observerCalls = 0
		hub.setMcpToolObserver((event) => {
			observerCalls++
			recordMycEvaluationMcpCompletion("session-a", {
				callId: event.callId,
				toolName: event.toolName,
				resultClass: event.outcome,
				...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
			})
		})

		await hub.callTool("myc", "myc_recall", {}, "ulid-1")

		expect(observerCalls).toBe(1)
		const mcpEvents = __getMycEvaluationEventsForTests("session-a").filter((e) => e.eventType === "mcp_call_completed")
		expect(mcpEvents).toHaveLength(1)
		expect(mcpEvents[0].toolName).toBe("myc_recall")
		expect(mcpEvents[0].resultClass).toBe("success")
	})

	it("MRC-07.b: a thrown callTool still yields exactly ONE completion observation", async () => {
		const { McpHub } = await import("@/services/mcp/McpHub")
		const hub = new McpHub(
			async () => "/tmp",
			async () => "/tmp",
			"1.0.0",
			{ captureMcpToolCall: () => {} } as never,
		)
		const connection = {
			server: { name: "myc", disabled: false, config: {} },
			client: {
				request: async () => {
					throw new Error("boom")
				},
			},
		}
		;(hub as unknown as { connections: unknown[] }).connections = [connection]

		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		let observerCalls = 0
		hub.setMcpToolObserver((event) => {
			observerCalls++
			recordMycEvaluationMcpCompletion("session-a", {
				callId: event.callId,
				toolName: event.toolName,
				resultClass: event.outcome,
			})
		})

		await expect(hub.callTool("myc", "myc_recall", {}, "ulid-2")).rejects.toThrow()

		expect(observerCalls).toBe(1)
		const mcpEvents = __getMycEvaluationEventsForTests("session-a").filter((e) => e.eventType === "mcp_call_completed")
		expect(mcpEvents).toHaveLength(1)
		expect(mcpEvents[0].resultClass).toBe("error")
	})
})

describe("MRC-08 — automatic prime does not double-count", () => {
	it("MRC-08.a: the prime acquisition is counted exactly ONCE per attempt", async () => {
		const { McpHub } = await import("@/services/mcp/McpHub")
		// Build the hub through the prototype (the existing myc-prime
		// test pattern) so the session-bound connection is stubbed and
		// NO real child process is spawned.
		const hub = Object.create(McpHub.prototype) as InstanceType<typeof McpHub>
		;(hub as unknown as { telemetryService: unknown }).telemetryService = {
			captureMcpToolCall: () => {},
		}
		;(hub as unknown as { clientVersion: string }).clientVersion = "test-0.0.0"
		const connection = {
			server: { name: "myc", config: "{}", status: "connected", disabled: false },
			client: {
				request: async () => ({
					content: [{ type: "text", text: "PRIME TEXT" }],
					structuredContent: undefined,
					isError: false,
				}),
			},
			transport: {},
		}
		;(hub as unknown as { connections: unknown[] }).connections = [connection]
		;(hub as unknown as { sessionConnections: Map<string, Map<string, unknown>> }).sessionConnections = new Map()
		;(hub as unknown as { ensureSessionConnection: unknown }).ensureSessionConnection = async () => connection

		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		hub.setMcpToolObserver((event) => {
			recordMycEvaluationMcpCompletion("session-a", {
				callId: event.callId,
				toolName: event.toolName,
				resultClass: event.outcome,
			})
		})

		const { runMycPrimeOnSessionStart, __resetMycPrimeResultsForTests } = await import("@/sdk/myc-prime-automation")
		__resetMycPrimeResultsForTests()
		const result = await runMycPrimeOnSessionStart({ sessionId: "session-a", mcpHub: hub })
		expect(result.status).toBe("ok")

		const acquisitions = __getMycEvaluationEventsForTests("session-a").filter((e) => e.eventType === "prime_acquisition")
		expect(acquisitions).toHaveLength(1)
		// The MCP completion is a SEPARATE observation (not a second
		// acquisition).
		const mcpEvents = __getMycEvaluationEventsForTests("session-a").filter((e) => e.eventType === "mcp_call_completed")
		expect(mcpEvents).toHaveLength(1)
	})

	it("MRC-08.b: the prime acquisition never records the prime TEXT", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "prime_acquisition", {
			toolName: "myc_prime",
			resultClass: "success",
			resultCount: 1,
			outputBytes: 1234,
		})
		await __drainMycEvaluationWritesForTests()

		expect(writes[0].line).not.toContain("PRIME")
		expect(writes[0].line).toContain("prime_acquisition")
	})
})

describe("MRC-09 — existing task telemetry remains unchanged", () => {
	it("MRC-09.a: the capture does not change the per-task telemetry counters", async () => {
		const { TaskTelemetryTracker } = await import("@/sdk/task-telemetry-tracker")
		const { observeMcpToolCompletion } = await import("@/sdk/myc-task-observation")

		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-1")

		// The capture is DISABLED (public path).
		applyMycEvaluationCaptureProfile(false)
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)

		observeMcpToolCompletion(tracker, {
			serverName: "myc",
			toolName: "myc_recall",
			outcome: "success",
			hasNonEmptyContent: true,
		})
		const disabledStrip = tracker.get()

		// The capture is ENABLED (dogfood path) — same telemetry event.
		applyMycEvaluationCaptureProfile(true)
		observeMcpToolCompletion(tracker, {
			serverName: "myc",
			toolName: "myc_recall",
			outcome: "success",
			hasNonEmptyContent: true,
		})
		const enabledStrip = tracker.get()

		// The telemetry strip is IDENTICAL modulo the counter increment
		// that the second observation itself caused. The capture side
		// contributed NOTHING.
		expect(enabledStrip?.myc?.callsTotal).toBe((disabledStrip?.myc?.callsTotal ?? 0) + 1)
		expect(enabledStrip?.myc?.usefulRetrievals).toBe((disabledStrip?.myc?.usefulRetrievals ?? 0) + 1)
		expect(enabledStrip?.myc?.retrievalCalls).toBe((disabledStrip?.myc?.retrievalCalls ?? 0) + 1)
	})
})

describe("MRC-10 — injection events correlate with their real session", () => {
	it("MRC-10.a: the injection event is recorded against the session that was injected", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-real", "prime_lookup", { toolName: "myc_prime" })
		recordMycEvaluation("session-real", "prime_injection", {
			toolName: "myc_prime",
			resultClass: "success",
			outputBytes: 42,
		})
		recordMycEvaluation("session-other", "prime_lookup", { toolName: "myc_prime" })
		await __drainMycEvaluationWritesForTests()

		const real = __getMycEvaluationEventsForTests("session-real")
		expect(real.map((e) => e.eventType)).toEqual(["prime_lookup", "prime_injection"])
		expect(real.every((e) => e.sessionId === "session-real")).toBe(true)
		expect(__getMycEvaluationEventsForTests("session-other")).toHaveLength(1)
	})

	it("MRC-10.b: the model-context delivery is a SEPARATE observation from the injection", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "prime_injection", { toolName: "myc_prime" })
		recordMycEvaluation("session-a", "prime_model_context_delivery", { toolName: "myc_prime" })
		await __drainMycEvaluationWritesForTests()

		const types = __getMycEvaluationEventsForTests("session-a").map((e) => e.eventType)
		expect(types).toEqual(["prime_injection", "prime_model_context_delivery"])
	})
})

describe("MRC-11 — bounded overflow is explicitly reported", () => {
	it("MRC-11.a: the per-session event bound drops and COUNTS the excess", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		for (let i = 0; i < MYC_EVALUATION_MAX_EVENTS_PER_SESSION + 5; i++) {
			recordMycEvaluation("session-a", "mcp_call_completed", { toolName: "myc_recall" })
		}
		await __drainMycEvaluationWritesForTests()

		const accounting = __getMycEvaluationAccountingForTests("session-a")
		expect(__getMycEvaluationEventsForTests("session-a")).toHaveLength(MYC_EVALUATION_MAX_EVENTS_PER_SESSION)
		expect(accounting.droppedCount).toBe(5)
		expect(accounting.observedCount).toBe(MYC_EVALUATION_MAX_EVENTS_PER_SESSION + 5)
	})

	it("MRC-11.b: the dropped events are reported in the summary and the report", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		for (let i = 0; i < MYC_EVALUATION_MAX_EVENTS_PER_SESSION + 2; i++) {
			recordMycEvaluation("session-a", "mcp_call_completed", { toolName: "myc_recall" })
		}
		checkpointMycEvaluation("session-a")
		await __drainMycEvaluationWritesForTests()

		const bundleDir = join(scratchRoot, MYC_EVALUATION_CAPTURE_SUBDIR, "session-a")
		const summary = JSON.parse(files.get(join(bundleDir, MYC_EVALUATION_SUMMARY_FILENAME)) as string)
		expect(summary.captureCompleteness.droppedEventCount).toBe(2)
		expect(summary.captureCompleteness.complete).toBe(false)
		expect(summary.evidenceGaps.some((g: string) => g.includes("dropped"))).toBe(true)
		const report = files.get(join(bundleDir, MYC_EVALUATION_REPORT_FILENAME)) as string
		expect(report).toContain("Dropped events: 2")
	})
})

describe("MRC-12 — no sensitive payloads appear in saved evidence", () => {
	it("MRC-12.a: the recorded event shape carries bounded metadata only", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(true)

		recordMycEvaluation("session-a", "mcp_call_completed", {
			toolName: "myc_recall",
			resultClass: "success",
			durationMs: 42,
			outputBytes: 128,
			resultCount: 3,
		})
		await __drainMycEvaluationWritesForTests()

		const parsed = JSON.parse(writes[0].line) as Record<string, unknown>
		const allowed = new Set([
			"eventId",
			"timestamp",
			"sessionId",
			"mycSessionId",
			"taskId",
			"eventType",
			"callId",
			"toolName",
			"resultClass",
			"resultCount",
			"durationMs",
			"inputBytes",
			"outputBytes",
			"tokenCount",
			"contentSha256",
			"sourceHead",
			"detail",
		])
		for (const key of Object.keys(parsed)) {
			expect(allowed.has(key)).toBe(true)
		}
		// No field can carry a payload body.
		expect(Object.values(parsed).every((v) => typeof v !== "object" || v === null)).toBe(true)
	})

	it("MRC-12.b: the report never echoes a prompt, response, memory body, or argument value", () => {
		const events: MycEvaluationEvent[] = [
			{
				eventId: "e1",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "mcp_call_completed",
				toolName: "myc_recall",
				resultClass: "success",
				callId: "call-1",
				durationMs: 10,
				outputBytes: 64,
			},
		]
		const summary = buildMycEvaluationSummary({ sessionId: "session-a", events })
		const report = buildMycEvaluationReport(summary)
		expect(report).not.toContain("myc_recall(")
		expect(report).toContain("myc_recall")
		expect(report).toContain("USEFULNESS_NOT_ASSESSABLE")
	})
})

describe("MRC-13 — disabled capture has zero state-semantic delta", () => {
	it("MRC-13.a: with the capture disabled, nothing is recorded and nothing is written", async () => {
		const { writes } = createInMemoryWrites()
		const files = new Map<string, string>()
		bindSeams(scratchRoot, writes, files)
		applyMycEvaluationCaptureProfile(false)

		recordMycEvaluation("session-a", "session_start")
		recordMycEvaluation("session-a", "mcp_call_completed", { toolName: "myc_recall" })
		checkpointMycEvaluation("session-a")
		await __drainMycEvaluationWritesForTests()

		expect(writes).toHaveLength(0)
		expect(files.size).toBe(0)
		// The disabled path creates NO session state at all.
		expect(__getMycEvaluationSessionIdsForTests()).toHaveLength(0)
	})

	it("MRC-13.b: the disabled recorder returns undefined and never throws", () => {
		applyMycEvaluationCaptureProfile(false)
		expect(recordMycEvaluationEvent("session-a", { eventType: "session_start" })).toBeUndefined()
	})
})

describe("MRC-14 — retrieval classification is conservative", () => {
	it("MRC-14.a: a nonempty response is NOT automatically USEFULNESS_PROVEN", () => {
		expect(
			classifyRetrieval({
				contentReturned: true,
				modelContextDelivered: false,
				usefulnessProven: false,
				usefulnessAssessable: false,
			}),
		).toBe("USEFULNESS_NOT_ASSESSABLE")
	})

	it("MRC-14.b: model-context delivery is a separate rung", () => {
		expect(
			classifyRetrieval({
				contentReturned: true,
				modelContextDelivered: true,
				usefulnessProven: false,
				usefulnessAssessable: true,
			}),
		).toBe("MODEL_CONTEXT_DELIVERED")
		expect(
			classifyRetrieval({
				contentReturned: true,
				modelContextDelivered: false,
				usefulnessProven: false,
				usefulnessAssessable: true,
			}),
		).toBe("CONTENT_RETURNED")
	})

	it("MRC-14.c: usefulness requires INDEPENDENT ground truth", () => {
		const events: MycEvaluationEvent[] = [
			{
				eventId: "e1",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "mcp_call_completed",
				toolName: "myc_recall",
				resultClass: "success",
				callId: "call-1",
			},
		]
		const withoutGroundTruth = buildMycEvaluationSummary({ sessionId: "session-a", events })
		expect(withoutGroundTruth.retrievals[0].usefulness).toBe("USEFULNESS_NOT_ASSESSABLE")
		expect(withoutGroundTruth.evidenceGaps.some((g) => g.includes("usefulness was NOT assessable"))).toBe(true)

		const withGroundTruth = buildMycEvaluationSummary({
			sessionId: "session-a",
			events,
			usefulnessGroundTruth: new Map([["call-1", true]]),
		})
		expect(withGroundTruth.retrievals[0].usefulness).toBe("USEFULNESS_PROVEN")
	})
})

describe("MRC-15 — the report covers the required sections", () => {
	it("MRC-15.a: the report carries every ACT §5 section", () => {
		const events: MycEvaluationEvent[] = [
			{
				eventId: "e1",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "session_start",
			},
			{
				eventId: "e2",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "prime_acquisition",
				toolName: "myc_prime",
				resultClass: "success",
			},
			{
				eventId: "e3",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "mcp_call_completed",
				toolName: "myc_recall",
				resultClass: "success",
				durationMs: 12,
			},
			{
				eventId: "e4",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "mcp_call_completed",
				toolName: "myc_recall",
				resultClass: "success",
				durationMs: 15,
			},
			{
				eventId: "e5",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "task_started",
				taskId: "session-a",
			},
			{
				eventId: "e6",
				timestamp: new Date().toISOString(),
				sessionId: "session-a",
				eventType: "compaction_started",
			},
		]
		const summary = buildMycEvaluationSummary({ sessionId: "session-a", events })
		const report = buildMycEvaluationReport(summary)

		expect(report).toContain("## Prime acquisition / injection cardinality")
		expect(report).toContain("## MCP calls, outcomes, and latency")
		expect(report).toContain("## Memory / context byte overhead")
		expect(report).toContain("## Duplicate retrievals")
		expect(report).toContain("## Task lifecycle and continuation")
		expect(report).toContain("## Session lifecycle")
		expect(report).toContain("## Compaction")
		expect(report).toContain("## Retrievals")
		expect(report).toContain("## Evidence gaps and capture completeness")

		// The duplicate retrieval is detected (two myc_recall calls).
		expect(summary.duplicateRetrievals).toEqual([{ toolName: "myc_recall", count: 2 }])
		// The latency statistics are computed from the observed values.
		expect(summary.mcpLatencyMs.count).toBe(2)
		expect(summary.mcpLatencyMs.min).toBe(12)
		expect(summary.mcpLatencyMs.max).toBe(15)
	})
})
