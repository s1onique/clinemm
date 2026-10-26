/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01
 *
 * RED witnesses + GREEN gates for the native A/B measurement authority.
 *
 * Gates covered here:
 *
 *   G1  Missing-field RED reproduced: the native production capture does
 *       NOT populate every material field, and the comparator fails closed
 *       on the missing ones.
 *   G2  Real session/config identity correlated: the effective snapshot is
 *       bound to the REAL session id, and the build-time snapshot (which
 *       precedes run creation) is associated by that identity.
 *   G3  Installed bundle identity bound: the production resolver's bundle
 *       digest is recorded, and the source provenance stays a SEPARATE
 *       fact.
 *   G4  Actual tool schema configuration captured: the effective toolset
 *       comes from the REAL model request the runtime issued.
 *   G5  Effective reasoning/budget provenance captured where observable.
 *   G6  Mixed-session run-scoping tests pass: one session / many runs,
 *       two sessions / one recorder, and session configuration changes.
 *   G7  Unknown configuration still fails closed.
 *   G8  A known compatible pair can pass.
 *   G9  Trace OFF preserves execution behavior.
 *
 * The RED witnesses exercise the REAL production seams:
 *   - the REAL `AgentRuntime` (sdk/packages/agents) with the REAL
 *     observation sink, and
 *   - the REAL comparator script (`scripts/compare-model-behavior-traces.ts`)
 *     driven as a subprocess.
 *
 * No duplicate implementation of the capture or the comparator is used.
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { createAgentRuntime } from "@cline/agents"
import { type ModelBehaviorTraceObservation, ModelBehaviorTraceRecorder, type ModelBehaviorTraceSink } from "@cline/shared"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

/** The comparator script lives at the repo root. */
const SCRIPT = resolve(__dirname, "../../../../../scripts/compare-model-behavior-traces.ts")

// ---------------------------------------------------------------------------
// Production capture helpers — these call the REAL seams, they do not
// re-implement them.
// ---------------------------------------------------------------------------

/**
 * Build a recording sink that forwards the REAL observation payload into a
 * recorder. This mirrors the production sink contract (the extension host's
 * `modelBehaviorTraceSink`) without duplicating the capture logic.
 */
function createRecordingSink(recorder: ModelBehaviorTraceRecorder): ModelBehaviorTraceSink {
	const record = (event: string) => (observation: ModelBehaviorTraceObservation) => {
		recorder.record(
			event as never,
			{
				...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
				...(observation.taskId !== undefined ? { taskId: observation.taskId } : {}),
				...(observation.runId !== undefined ? { runId: observation.runId } : {}),
				...(observation.iteration !== undefined ? { iteration: observation.iteration } : {}),
				...(observation.providerId !== undefined ? { providerId: observation.providerId } : {}),
				...(observation.modelId !== undefined ? { modelId: observation.modelId } : {}),
			},
			observation.payload as Record<string, unknown>,
		)
	}
	return {
		onEffectiveModelConfig: record("effective_model_config"),
		onModelRequestStart: record("model_request_start"),
		onModelRequestFinish: record("model_request_finish"),
		onToolStart: record("tool_start"),
		onToolFinish: record("tool_finish"),
	} as ModelBehaviorTraceSink
}

/**
 * A scripted model that returns a single assistant message and then stops.
 *
 * It implements the minimal surface the REAL `AgentRuntime` uses, so the
 * runtime's own request-building path (including `prepareTurnForModelRequest`
 * and the `beforeModel` hooks) is what is exercised.
 */
function createScriptedModel(text = "done") {
	return {
		id: "minimax-m3",
		provider: "minimax",
		async *stream(_request: unknown) {
			yield {
				type: "message" as const,
				message: {
					role: "assistant" as const,
					content: [{ type: "text" as const, text }],
					metrics: { inputTokens: 10, outputTokens: 5 },
					finishReason: "stop" as const,
					modelInfo: { id: "minimax-m3", provider: "minimax" },
				},
			}
		},
	}
}

/**
 * Drive the REAL `AgentRuntime` with a REAL toolset and capture the REAL
 * observations.
 */
async function runRealAgent(options: {
	sessionId: string
	tools?: Array<{ name: string; description: string }>
	modelOptions?: Record<string, unknown>
	beforeModel?: (request: unknown) => { tools?: unknown[] } | undefined
}) {
	const recorder = new ModelBehaviorTraceRecorder()
	recorder.setEnabled(true)
	const runtime = createAgentRuntime({
		model: createScriptedModel() as never,
		tools: (options.tools ?? [{ name: "read_file", description: "read" }]) as never,
		systemPrompt: "test",
		sessionId: options.sessionId,
		...(options.modelOptions ? { modelOptions: options.modelOptions } : {}),
		...(options.beforeModel ? { hooks: { beforeModel: options.beforeModel as never } } : {}),
		modelBehaviorTraceSink: createRecordingSink(recorder) as never,
	})
	const result = await runtime.run("hello")
	return {
		records: recorder.getRecords(),
		runId: (result as { runId?: string }).runId,
	}
}

// ---------------------------------------------------------------------------
// Comparator helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: Record<string, unknown> = {
	selectedProviderId: "minimax",
	selectedModelId: "minimax-m3",
	runtimeProviderId: "minimax",
	runtimeModelId: "minimax-m3",
	providerConfirmedModelId: "UNAVAILABLE_FROM_TRACE",
	thinkingEnabled: "true",
	reasoningEffort: "high",
	temperature: "UNAVAILABLE_FROM_TRACE",
	topP: "UNAVAILABLE_FROM_TRACE",
	maxOutputTokens: "8192",
	contextWindow: "1000000",
	maxInputTokens: "UNAVAILABLE_FROM_TRACE",
	userContextCeiling: "200000",
	toolCount: "5",
	toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
	sourceHead: "b22855b4a83a958904d9d87c31e4d6c298d355da",
	extensionVersion: "1.0.0",
	extensionBundleSha256: "1111111111111111111111111111111111111111111111111111111111111111",
	effectiveMaxInputTokens: "200000",
	inputBudgetSource: "userCeiling",
	userContextCeilingMode: "explicit",
}

interface SyntheticEvent {
	event: string
	sessionId?: string
	runId?: string
	iteration?: number
	providerId?: string
	modelId?: string
	payload?: Record<string, unknown>
}

async function writeTrace(
	dir: string,
	name: string,
	options: {
		omitConfig?: boolean
		config?: Record<string, unknown>
		tools?: Array<{ name: string; fingerprint: string; outcome?: string }>
		extraEvents?: SyntheticEvent[]
		configIdentity?: {
			sessionId?: string
			runId?: string
			providerId?: string
			modelId?: string
		}
	},
): Promise<string> {
	const lines: string[] = []
	let seq = 1
	const push = (record: Record<string, unknown>): void => {
		lines.push(
			JSON.stringify({
				seq: seq++,
				timestamp: `2026-01-01T00:00:0${seq}.000Z`,
				traceId: name,
				evidenceBoundary: "observed",
				...record,
			}),
		)
	}

	if (!options.omitConfig) {
		push({
			event: "model_config",
			sessionId: options.configIdentity?.sessionId ?? "s1",
			providerId: options.configIdentity?.providerId ?? "minimax",
			modelId: options.configIdentity?.modelId ?? "minimax-m3",
			payload: { ...BASE_CONFIG, ...(options.config ?? {}) },
		})
	}

	for (const tool of options.tools ?? []) {
		push({
			event: "tool_start",
			sessionId: "s1",
			runId: "r1",
			iteration: 1,
			payload: { toolName: tool.name, argumentFingerprint: tool.fingerprint },
		})
		push({
			event: "tool_finish",
			sessionId: "s1",
			runId: "r1",
			iteration: 1,
			payload: {
				toolName: tool.name,
				argumentFingerprint: tool.fingerprint,
				outcome: tool.outcome ?? "success",
			},
		})
	}

	for (const extra of options.extraEvents ?? []) {
		push({
			event: extra.event,
			...(extra.sessionId !== undefined ? { sessionId: extra.sessionId } : {}),
			...(extra.runId !== undefined ? { runId: extra.runId } : {}),
			...(extra.iteration !== undefined ? { iteration: extra.iteration } : {}),
			...(extra.providerId !== undefined ? { providerId: extra.providerId } : {}),
			...(extra.modelId !== undefined ? { modelId: extra.modelId } : {}),
			payload: extra.payload ?? {},
		})
	}

	push({
		event: "run_terminated",
		sessionId: "s1",
		runId: "r1",
		payload: { finishReason: "stop", durationMs: 1000, iterations: 1 },
	})

	lines.push(
		JSON.stringify({
			kind: "summary",
			traceId: name,
			dumpedAt: "2026-01-01T00:00:00.000Z",
			truncation: {
				truncated: false,
				droppedCount: 0,
				totalRecorded: seq - 1,
				retainedCount: seq - 1,
				retainedBytes: 100,
			},
		}),
	)

	const path = join(dir, `${name}.jsonl`)
	await writeFile(path, `${lines.join("\n")}\n`, "utf8")
	return path
}

async function runComparator(
	m3Path: string,
	m31Path: string,
	extraArgs: string[] = [],
): Promise<{ markdown: string; json: Record<string, unknown> }> {
	const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
	const mdPath = join(dir, "out.md")
	const jsonPath = join(dir, "out.json")
	await execFileAsync(process.execPath, [
		SCRIPT,
		"--m3",
		m3Path,
		"--m3.1",
		m31Path,
		...extraArgs,
		"--md",
		mdPath,
		"--json",
		jsonPath,
	])
	const markdown = await readFile(mdPath, "utf8")
	const json = JSON.parse(await readFile(jsonPath, "utf8")) as Record<string, unknown>
	return { markdown, json }
}

describe("model behavior comparability authority repair 01", () => {
	// -----------------------------------------------------------------------
	// G4 / G5 — the REAL production capture seam.
	// -----------------------------------------------------------------------

	it("G4: the REAL AgentRuntime captures the EFFECTIVE tool schemas of the request it issues", async () => {
		const { records } = await runRealAgent({
			sessionId: "session-real-1",
			tools: [
				{ name: "read_file", description: "read a file" },
				{ name: "write_file", description: "write a file" },
				{ name: "run_commands", description: "run commands" },
			],
		})
		const effective = records.find((record) => record.event === "effective_model_config")
		expect(effective).toBeDefined()
		expect(effective?.payload.toolCount).toBe(3)
		expect(effective?.payload.toolNames).toEqual(["read_file", "write_file", "run_commands"])
	})

	it("G4b: the effective snapshot reflects the toolset AFTER the beforeModel hook rewrites it", async () => {
		// The hook replaces the toolset, so the effective snapshot must report
		// the REWRITTEN toolset — the one the provider actually received.
		const { records } = await runRealAgent({
			sessionId: "session-real-2",
			tools: [{ name: "read_file", description: "read a file" }],
			beforeModel: () => ({
				tools: [
					{ name: "read_file", description: "read a file" },
					{ name: "search_codebase", description: "search" },
				],
			}),
		})
		const effective = records.find((record) => record.event === "effective_model_config")
		expect(effective?.payload.toolCount).toBe(2)
		expect(effective?.payload.toolNames).toEqual(["read_file", "search_codebase"])
	})

	it("G5: the effective snapshot reports the EFFECTIVE reasoning policy and output limit", async () => {
		const { records } = await runRealAgent({
			sessionId: "session-real-3",
			modelOptions: {
				thinking: true,
				reasoningEffort: "high",
				maxTokensPerTurn: 8192,
			},
		})
		const effective = records.find((record) => record.event === "effective_model_config")
		expect(effective?.payload.thinkingEnabled).toBe(true)
		expect(effective?.payload.reasoningEffort).toBe("high")
		expect(effective?.payload.maxOutputTokens).toBe(8192)
	})

	it("G5b: an OMITTED provider reasoning setting is NOT reported as a known default", async () => {
		const { records } = await runRealAgent({
			sessionId: "session-real-4",
			// No model options at all: the runtime specifies nothing.
			modelOptions: {},
		})
		const effective = records.find((record) => record.event === "effective_model_config")
		expect(effective).toBeDefined()
		// The runtime did not specify a reasoning policy, so the effective
		// snapshot must NOT claim one.
		expect(effective?.payload.reasoningEffort).toBeUndefined()
		expect(effective?.payload.thinkingEnabled).toBeUndefined()
		expect(effective?.payload.maxOutputTokens).toBeUndefined()
	})

	it("G2: the effective snapshot carries the REAL session identity and run identity", async () => {
		const { records, runId } = await runRealAgent({
			sessionId: "session-identity-1",
		})
		const effective = records.find((record) => record.event === "effective_model_config")
		expect(effective?.sessionId).toBe("session-identity-1")
		expect(effective?.runId).toBe(runId)
		expect(runId).toBeTruthy()
	})

	it("G9: trace OFF produces NO records and leaves the execution result intact", async () => {
		const recorder = new ModelBehaviorTraceRecorder()
		// Default OFF — the production default.
		const runtime = createAgentRuntime({
			model: createScriptedModel() as never,
			tools: [{ name: "read_file", description: "read" }] as never,
			systemPrompt: "test",
			sessionId: "session-off-1",
			modelBehaviorTraceSink: createRecordingSink(recorder) as never,
		})
		const result = await runtime.run("hello")
		expect(recorder.getRecords()).toHaveLength(0)
		expect((result as { runId?: string }).runId).toBeTruthy()
	})

	// -----------------------------------------------------------------------
	// G2 / G3 — the REAL extension-host production seam.
	// -----------------------------------------------------------------------

	it("G2b: the production runtime binds a session-less configuration to the REAL session id", async () => {
		const production = await import("../model-behavior-trace-runtime")
		production._resetModelBehaviorTrace()
		production.setModelBehaviorTraceEnabled(true)

		// The build-time snapshot is recorded WITHOUT a session identity,
		// exactly as `buildSessionConfig()` does.
		const snapshot = {
			selectedProviderId: "minimax",
			selectedModelId: "minimax-m3",
			runtimeProviderId: "minimax",
			runtimeModelId: "minimax-m3",
			thinkingEnabled: true,
			reasoningEffort: "high",
			maxOutputTokens: 8192,
			userContextCeiling: 200000,
			extensionVersion: "1.0.0",
			extensionBundleSha256: "1111111111111111111111111111111111111111111111111111111111111111",
			effectiveMaxInputTokens: 200000,
			inputBudgetSource: "userCeiling",
			userContextCeilingMode: "explicit" as const,
		}
		production.recordModelBehaviorTraceConfig({ providerId: "minimax", modelId: "minimax-m3" }, snapshot)
		const beforeBind = production.getModelBehaviorTraceRecords()
		expect(beforeBind).toHaveLength(1)
		expect(beforeBind[0]?.sessionId).toBeUndefined()

		// The coordinator that ALLOCATED the session id binds the snapshot to
		// it — an identity assertion, not a timestamp-proximity guess.
		production.bindModelBehaviorTraceConfigToSession("session-bound-1", snapshot, {
			providerId: "minimax",
			modelId: "minimax-m3",
		})
		const afterBind = production.getModelBehaviorTraceRecords()
		expect(afterBind).toHaveLength(2)
		expect(afterBind[1]?.sessionId).toBe("session-bound-1")
		expect(afterBind[1]?.event).toBe("model_config")
		// The bound snapshot carries the SAME facts.
		expect(afterBind[1]?.payload.extensionBundleSha256).toBe(snapshot.extensionBundleSha256)
		expect(afterBind[1]?.payload.effectiveMaxInputTokens).toBe(200000)
		expect(afterBind[1]?.payload.userContextCeilingMode).toBe("explicit")

		production._resetModelBehaviorTrace()
		production.setModelBehaviorTraceEnabled(false)
	})

	it("G3d: the production resolver reports the ACTUAL installed bundle bytes identity", async () => {
		// The canonical resolver reads the real `<extension-root>/dist/extension.js`.
		// In this repository the bundle exists, so the digest is a REAL value —
		// not a placeholder and not a `git rev-parse` output.
		const { resolveInstalledBundleIdentity } = await import("../extension-host-allocation-profiler-runtime")
		const identity = resolveInstalledBundleIdentity(resolve(__dirname, "../../../dist"))
		expect(identity.extensionBundleSha256).toMatch(/^[0-9a-f]{64}$/)
		// The source provenance is a SEPARATE fact: it must not be conflated
		// with the artifact identity.
		expect(identity.extensionPath).toBeTruthy()
		expect(typeof identity.sourceHead).toBe("string")
	})

	// -----------------------------------------------------------------------
	// G1 / G3 / G7 / G8 — the REAL comparator seam.
	// -----------------------------------------------------------------------

	it("G1: a native configuration MISSING a material field fails closed (RED)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		// The native capture does NOT populate the toolset at build time: the
		// tool schema is only known at the effective model-request boundary.
		const m3Path = await writeTrace(dir, "m3", {
			config: { toolCount: "UNAVAILABLE_FROM_TRACE", toolNames: [] },
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				toolCount: "UNAVAILABLE_FROM_TRACE",
				toolNames: [],
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		// The MISSING toolset is reported as UNVERIFIED, never as equal.
		const toolCount = differences.find((d) => d.dimension === "toolCount")
		expect(toolCount?.severity).toBe("unverified")
	})

	it("G3: different verified installed bundles are incompatible even with equal source heads", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				extensionBundleSha256: "2222222222222222222222222222222222222222222222222222222222222222",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const sourceHead = differences.find((d) => d.dimension === "sourceHead")
		expect(sourceHead?.severity).toBe("material")
		expect(String(sourceHead?.reason)).toContain("installed bundle bytes")
	})

	it("G3b: unknown source provenance with NO verified bundle identity stays UNVERIFIED", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {
			config: {
				sourceHead: "UNAVAILABLE_FROM_TRACE",
				extensionBundleSha256: "UNAVAILABLE_FROM_TRACE",
			},
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				sourceHead: "UNAVAILABLE_FROM_TRACE",
				extensionBundleSha256: "UNAVAILABLE_FROM_TRACE",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const sourceHead = differences.find((d) => d.dimension === "sourceHead")
		expect(sourceHead?.severity).toBe("unverified")
	})

	it("G3c: a VERIFIED equivalent artifact-identity proof establishes source/build parity", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		// Both sides ran the SAME installed bundle bytes of the SAME version,
		// but the source provenance is unknown (the installed-VSIX case).
		const m3Path = await writeTrace(dir, "m3", {
			config: { sourceHead: "UNAVAILABLE_FROM_TRACE" },
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				sourceHead: "UNAVAILABLE_FROM_TRACE",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(true)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		expect(differences.find((d) => d.dimension === "sourceHead")).toBeUndefined()
	})

	it("G7: two equally-unknown material dimensions are NOT treated as equivalent", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {
			config: { reasoningEffort: "UNAVAILABLE_FROM_TRACE" },
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				reasoningEffort: "UNAVAILABLE_FROM_TRACE",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const reasoning = differences.find((d) => d.dimension === "reasoningEffort")
		expect(reasoning?.severity).toBe("unverified")
	})

	it("G7b: different effective reasoning policies remain incompatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {
			extraEvents: [
				{
					event: "effective_model_config",
					sessionId: "s1",
					runId: "r1",
					payload: {
						toolCount: "5",
						toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
						thinkingEnabled: "true",
						reasoningEffort: "high",
						maxOutputTokens: "8192",
					},
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
			extraEvents: [
				{
					event: "effective_model_config",
					sessionId: "s1",
					runId: "r1",
					payload: {
						toolCount: "5",
						toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
						thinkingEnabled: "true",
						reasoningEffort: "low",
						maxOutputTokens: "8192",
					},
				},
			],
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const reasoning = differences.find((d) => d.dimension === "reasoningEffort")
		expect(reasoning?.severity).toBe("material")
		expect(reasoning?.m3).toBe("high")
		expect(reasoning?.m31).toBe("low")
	})

	it("G8: a fully identified, compatible pair passes", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(true)
		expect(markdown).toContain("**Comparable**: YES")
	})

	// -----------------------------------------------------------------------
	// G6 — mixed-session run scoping.
	// -----------------------------------------------------------------------

	it("G6a: one session, multiple runs — the selected run excludes the OTHER run's activity", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {
			extraEvents: [
				// The SELECTED run's tool call.
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-sel" },
				},
				// The OTHER run's tool call — same session, different run.
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r2",
					payload: { toolName: "read_file", argumentFingerprint: "fp-other" },
				},
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r2",
					payload: { toolName: "read_file", argumentFingerprint: "fp-other" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1"])
		const statistics = json.statistics as Record<string, Record<string, unknown>>
		// ONLY the selected run's tool call is counted — the other run's
		// activity must not contaminate the selected run.
		expect(statistics.m3?.totalToolCalls).toBe(1)
		expect(statistics.m3?.exactRepeatedActionCount).toBe(0)
	})

	it("G6b: two sessions, one shared recorder — the selected run never inherits the OTHER session's unscoped configuration", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		// Session A's build-time configuration carries NO session identity
		// (it precedes run creation). Session B's configuration is bound to
		// session B. The selected run belongs to session B.
		const m3Path = await writeTrace(dir, "m3", {
			omitConfig: true,
			extraEvents: [
				{
					event: "model_config",
					payload: { ...BASE_CONFIG, userContextCeiling: "111111" },
				},
				{
					event: "model_config",
					sessionId: "s2",
					payload: { ...BASE_CONFIG, userContextCeiling: "222222" },
				},
				{
					event: "tool_start",
					sessionId: "s2",
					runId: "rB",
					payload: { toolName: "read_file", argumentFingerprint: "fp-b" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "rB"])
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const ceiling = differences.find((d) => d.dimension === "userContextCeiling")
		// The M3 side's configuration is the one bound to the SELECTED run's
		// session (222222), and the M3.1 side's is 200000 — so the ceilings
		// DIFFER and the comparison is refused.
		expect(ceiling?.m3).toBe("222222")
		expect(ceiling?.severity).toBe("material")
	})

	it("G6c: a record with NO identity is never attached to a selected run", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		const m3Path = await writeTrace(dir, "m3", {
			omitConfig: true,
			extraEvents: [
				// A record with NEITHER a session nor a run id. It must not be
				// attached to the selected run by timestamp proximity.
				{
					event: "tool_start",
					payload: { toolName: "read_file", argumentFingerprint: "fp-orphan" },
				},
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-sel" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1"])
		const statistics = json.statistics as Record<string, Record<string, unknown>>
		// Only the identity-verified record is counted.
		expect(statistics.m3?.totalToolCalls).toBe(1)
	})

	it("G6d: one session, one run — the session-level configuration is inherited", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-authority-"))
		// The build-time configuration precedes run creation and carries the
		// SESSION id (not a run id). The selected run belongs to that
		// session, so the configuration is inherited.
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1" },
			extraEvents: [
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-a" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
			extraEvents: [
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-b" },
				},
			],
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1"])
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		// The inherited configuration matched, so there is no ceiling
		// difference to report.
		expect(differences.find((d) => d.dimension === "userContextCeiling")).toBeUndefined()
	})
})
