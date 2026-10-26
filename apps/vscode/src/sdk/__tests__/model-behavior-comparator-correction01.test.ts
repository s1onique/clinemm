/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01
 *
 * RED witnesses + GREEN gates for the four bounded comparator corrections.
 *
 * The four corrections under test:
 *
 *   C1  AUTO CEILING
 *       Two independently verified Auto modes satisfy ceiling-mode
 *       equivalence when their effective input budgets AND their budget
 *       provenance are known and equal. Auto vs explicit is incompatible.
 *       An Auto mode with an UNKNOWN effective budget is inconclusive.
 *
 *   C2  CONFIGURATION SNAPSHOTS
 *       The session-less/session-bound build-time pair is handled correctly
 *       for a single run. EVERY `effective_model_config` belonging to the
 *       selected run is evaluated (not just the first one). A mid-run
 *       material change is DETECTED, not silently ignored. True session/run
 *       isolation is preserved.
 *
 *   C3  MODEL ATTRIBUTION
 *       The identity-verified run scope is applied BEFORE model-family
 *       membership is evaluated. Selecting an M3 run from a mixed-model dump
 *       does not inherit M3.1 identities. An UNSCOPED mixed-model dump stays
 *       refused.
 *
 *   C4  DISABLED-PATH OVERHEAD
 *       With the trace DISABLED, the production configuration builder does
 *       NOT invoke `resolveInstalledBundleIdentity()` and performs no
 *       synchronous bundle hashing. With the trace ENABLED the verified
 *       installed bundle identity is cached and recorded unchanged.
 *
 * The comparator witnesses drive the REAL comparator script as a
 * subprocess, so the shipped CLI is what is exercised.
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

/** The comparator script lives at the repo root. */
const SCRIPT = resolve(__dirname, "../../../../../scripts/compare-model-behavior-traces.ts")

/**
 * The configuration values every well-formed trace carries.
 *
 * The M3/M3.1 label is carried by `selectedModelId` / `runtimeModelId` and
 * by the record's own `modelId` identity.
 */
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

/** One recorded event in a synthetic trace. */
interface SyntheticEvent {
	event: string
	sessionId?: string
	runId?: string
	iteration?: number
	providerId?: string
	modelId?: string
	payload?: Record<string, unknown>
}

/**
 * A build-time `model_config` record.
 *
 * The event kind is implied by the array it is placed in, so it is not
 * repeated on every entry.
 */
interface ConfigSnapshot {
	sessionId?: string
	runId?: string
	providerId?: string
	modelId?: string
	payload?: Record<string, unknown>
}

/**
 * An `effective_model_config` record.
 *
 * The event kind is implied by the array it is placed in, so it is not
 * repeated on every entry.
 */
interface EffectiveSnapshot {
	sessionId?: string
	runId?: string
	iteration?: number
	providerId?: string
	modelId?: string
	payload?: Record<string, unknown>
}

/** The identity carried by a `model_config` record. */
interface ConfigIdentity {
	sessionId?: string
	runId?: string
	providerId?: string
	modelId?: string
}

/**
 * Build a synthetic trace file.
 *
 * `configSnapshots` allows several build-time `model_config` records with
 * DIFFERENT identities (the session-less/session-bound pair) and
 * `effectiveSnapshots` allows several `effective_model_config` records for
 * the SAME run (the mid-run change case).
 */
async function writeTrace(
	dir: string,
	name: string,
	options: {
		omitConfig?: boolean
		config?: Record<string, unknown>
		configIdentity?: ConfigIdentity
		/** Additional build-time `model_config` records. */
		configSnapshots?: ConfigSnapshot[]
		/** `effective_model_config` records for the selected run. */
		effectiveSnapshots?: EffectiveSnapshot[]
		tools?: Array<{ name: string; fingerprint: string; outcome?: string }>
		extraEvents?: SyntheticEvent[]
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

	for (const snapshot of options.configSnapshots ?? []) {
		push({
			event: "model_config",
			...(snapshot.sessionId !== undefined ? { sessionId: snapshot.sessionId } : {}),
			...(snapshot.runId !== undefined ? { runId: snapshot.runId } : {}),
			...(snapshot.providerId !== undefined ? { providerId: snapshot.providerId } : {}),
			...(snapshot.modelId !== undefined ? { modelId: snapshot.modelId } : {}),
			payload: { ...BASE_CONFIG, ...(snapshot.payload ?? {}) },
		})
	}

	for (const snapshot of options.effectiveSnapshots ?? []) {
		push({
			event: "effective_model_config",
			...(snapshot.sessionId !== undefined ? { sessionId: snapshot.sessionId } : {}),
			...(snapshot.runId !== undefined ? { runId: snapshot.runId } : {}),
			...(snapshot.iteration !== undefined ? { iteration: snapshot.iteration } : {}),
			...(snapshot.providerId !== undefined ? { providerId: snapshot.providerId } : {}),
			...(snapshot.modelId !== undefined ? { modelId: snapshot.modelId } : {}),
			payload: snapshot.payload ?? {},
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

	const truncation = {
		truncated: false,
		droppedCount: 0,
		totalRecorded: seq - 1,
		retainedCount: seq - 1,
		retainedBytes: 100,
	}
	lines.push(JSON.stringify({ kind: "summary", traceId: name, dumpedAt: "2026-01-01T00:00:00.000Z", truncation }))

	const path = join(dir, `${name}.jsonl`)
	await writeFile(path, `${lines.join("\n")}\n`, "utf8")
	return path
}

async function runComparator(
	m3Path: string,
	m31Path: string,
	extraArgs: string[] = [],
): Promise<{ markdown: string; json: Record<string, unknown> }> {
	const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
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

/** The per-dimension comparison map of a comparison summary. */
function dimensions(json: Record<string, unknown>): Record<string, { m3: string; m31: string; comparison: string }> {
	return json.configurationDifferences as Record<string, { m3: string; m31: string; comparison: string }>
}

/** The material/unverified difference list of a comparison summary. */
function differences(json: Record<string, unknown>): Array<Record<string, unknown>> {
	return json.materialDifferences as Array<Record<string, unknown>>
}

/** The overall comparability status of a comparison summary. */
function status(json: Record<string, unknown>): string {
	return (json.comparability as Record<string, unknown>).status as string
}

/** The comparability reasons of a comparison summary. */
function reasons(json: Record<string, unknown>): Array<Record<string, unknown>> {
	return (json.comparability as Record<string, unknown>).reasons as Array<Record<string, unknown>>
}

describe("model behavior comparator correction 01", () => {
	// -----------------------------------------------------------------------
	// C1 — auto ceiling equivalence.
	// -----------------------------------------------------------------------

	it("C1a: Auto/Auto with identical effective budget AND provenance is comparable on the ceiling dimensions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const autoConfig = {
			// Auto ⇒ there is NO user-configured ceiling.
			userContextCeiling: "UNAVAILABLE_FROM_TRACE",
			userContextCeilingMode: "auto",
			effectiveMaxInputTokens: "900000",
			inputBudgetSource: "contextWindow",
		}
		const m3Path = await writeTrace(dir, "m3", { config: autoConfig })
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				...autoConfig,
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		const fields = dimensions(json)
		// The ceiling-mode dimension is settled by the verified Auto/Auto
		// equivalence — NOT by an unknown raw user ceiling.
		expect(fields.userContextCeilingMode?.comparison).toBe("equal")
		expect(fields.effectiveMaxInputTokens?.comparison).toBe("equal")
		expect(fields.inputBudgetSource?.comparison).toBe("equal")
		// The raw ceiling number is not a material difference in Auto mode.
		expect(differences(json).find((d) => d.dimension === "userContextCeiling")).toBeUndefined()
		expect(json.compatible).toBe(true)
	})

	it("C1b: Auto vs explicit ceiling mode is incompatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			config: {
				userContextCeiling: "UNAVAILABLE_FROM_TRACE",
				userContextCeilingMode: "auto",
				effectiveMaxInputTokens: "900000",
				inputBudgetSource: "contextWindow",
			},
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				userContextCeiling: "200000",
				userContextCeilingMode: "explicit",
				effectiveMaxInputTokens: "200000",
				inputBudgetSource: "userCeiling",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		expect(status(json)).toBe("incompatible")
		expect(differences(json).find((d) => d.dimension === "userContextCeilingMode")?.severity).toBe("material")
	})

	it("C1c: Auto with an UNKNOWN effective budget is inconclusive, never compatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const autoConfig = {
			userContextCeiling: "UNAVAILABLE_FROM_TRACE",
			userContextCeilingMode: "auto",
			effectiveMaxInputTokens: "UNAVAILABLE_FROM_TRACE",
			inputBudgetSource: "UNAVAILABLE_FROM_TRACE",
		}
		const m3Path = await writeTrace(dir, "m3", { config: autoConfig })
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				...autoConfig,
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		expect(status(json)).toBe("inconclusive")
		expect(dimensions(json).effectiveMaxInputTokens?.comparison).toBe("unverified")
	})

	it("C1d: an UNKNOWN operating mode fails closed (no Auto equivalence is assumed)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const unknownMode = {
			userContextCeiling: "UNAVAILABLE_FROM_TRACE",
			userContextCeilingMode: "UNAVAILABLE_FROM_TRACE",
			effectiveMaxInputTokens: "900000",
			inputBudgetSource: "contextWindow",
		}
		const m3Path = await writeTrace(dir, "m3", { config: unknownMode })
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				...unknownMode,
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		expect(status(json)).toBe("inconclusive")
		expect(dimensions(json).userContextCeilingMode?.comparison).toBe("unverified")
	})

	it("C1e: Auto/Auto with DIFFERENT effective budgets is incompatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			config: {
				userContextCeiling: "UNAVAILABLE_FROM_TRACE",
				userContextCeilingMode: "auto",
				effectiveMaxInputTokens: "900000",
				inputBudgetSource: "contextWindow",
			},
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				userContextCeiling: "UNAVAILABLE_FROM_TRACE",
				userContextCeilingMode: "auto",
				effectiveMaxInputTokens: "600000",
				inputBudgetSource: "contextWindow",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		expect(status(json)).toBe("incompatible")
		expect(differences(json).find((d) => d.dimension === "effectiveMaxInputTokens")?.severity).toBe("material")
	})
	// -----------------------------------------------------------------------
	// C2 — configuration snapshots.
	// -----------------------------------------------------------------------

	it("C2a: one normal session with the session-less/session-bound build-time pair and identical request snapshots has NO false ambiguity", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const effective = {
			toolCount: "5",
			toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
			thinkingEnabled: "true",
			reasoningEffort: "high",
			maxOutputTokens: "8192",
		}
		const m3Path = await writeTrace(dir, "m3", {
			// The session-BOUND build-time snapshot.
			configIdentity: { sessionId: "s1" },
			// The SESSION-LESS build-time snapshot (recorded before the
			// session id existed).
			configSnapshots: [{ payload: { ...BASE_CONFIG } }],
			// Several IDENTICAL request snapshots for the same run.
			effectiveSnapshots: [
				{ sessionId: "s1", runId: "r1", iteration: 1, payload: effective },
				{ sessionId: "s1", runId: "r1", iteration: 2, payload: effective },
				{ sessionId: "s1", runId: "r1", iteration: 3, payload: effective },
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
			effectiveSnapshots: [
				{ sessionId: "s1", runId: "r1", iteration: 1, payload: effective },
				{ sessionId: "s1", runId: "r1", iteration: 2, payload: effective },
			],
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		expect(reasons(json).find((reason) => reason.code === "ambiguous_model_config")).toBeUndefined()
		expect(json.compatible).toBe(true)
	})

	it("C2b: a mid-run effective TOOL change is detected, not silently ignored", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1" },
			effectiveSnapshots: [
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 1,
					payload: {
						toolCount: "5",
						toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
						thinkingEnabled: "true",
						reasoningEffort: "high",
						maxOutputTokens: "8192",
					},
				},
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 2,
					payload: {
						toolCount: "9",
						toolNames: [
							"read_file",
							"write_file",
							"run_command",
							"run_tests",
							"search_codebase",
							"extra_a",
							"extra_b",
							"extra_c",
							"extra_d",
						],
						thinkingEnabled: "true",
						reasoningEffort: "high",
						maxOutputTokens: "8192",
					},
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
			effectiveSnapshots: [
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 1,
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

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		expect(json.compatible).toBe(false)
		expect(reasons(json).some((reason) => String(reason.code).includes("effective"))).toBe(true)
	})
	it("C2c: a mid-run effective REASONING change is detected", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1" },
			effectiveSnapshots: [
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 1,
					payload: {
						toolCount: "5",
						toolNames: ["read_file"],
						thinkingEnabled: "true",
						reasoningEffort: "high",
						maxOutputTokens: "8192",
					},
				},
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 2,
					payload: {
						toolCount: "5",
						toolNames: ["read_file"],
						thinkingEnabled: "true",
						reasoningEffort: "low",
						maxOutputTokens: "8192",
					},
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		expect(json.compatible).toBe(false)
		expect(reasons(json).some((reason) => String(reason.code).includes("effective"))).toBe(true)
	})

	it("C2d: an effective snapshot belonging to ANOTHER run never contaminates the selected run", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1" },
			effectiveSnapshots: [
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 1,
					payload: {
						toolCount: "5",
						toolNames: ["read_file"],
						thinkingEnabled: "true",
						reasoningEffort: "high",
						maxOutputTokens: "8192",
					},
				},
				// A DIFFERENT run of the same session, with a different toolset.
				{
					sessionId: "s1",
					runId: "r2",
					iteration: 1,
					payload: {
						toolCount: "9",
						toolNames: ["read_file", "a", "b", "c", "d", "e", "f", "g", "h"],
						thinkingEnabled: "true",
						reasoningEffort: "high",
						maxOutputTokens: "8192",
					},
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		expect(reasons(json).some((reason) => String(reason.code).includes("effective"))).toBe(false)
	})
	// -----------------------------------------------------------------------
	// C3 — model attribution.
	// -----------------------------------------------------------------------

	it("C3a: selecting an M3 run from a mixed-model dump attributes ONLY the selected run's model", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		// The SAME effective toolset on both sides, so the ONLY thing that
		// differs is WHICH run the recorded model identities belong to.
		const effective = {
			toolCount: "5",
			toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
			thinkingEnabled: "true",
			reasoningEffort: "high",
			maxOutputTokens: "8192",
		}
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1", modelId: "minimax-m3" },
			effectiveSnapshots: [
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 1,
					modelId: "minimax-m3",
					payload: effective,
				},
			],
			extraEvents: [
				// ANOTHER run in the SAME dump, running the M3.1 model.
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r2",
					modelId: "minimax-m3.1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-other" },
				},
				{
					event: "effective_model_config",
					sessionId: "s1",
					runId: "r2",
					iteration: 1,
					modelId: "minimax-m3.1",
					payload: effective,
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
			effectiveSnapshots: [
				{
					sessionId: "s1",
					runId: "r1",
					iteration: 1,
					modelId: "minimax-m3.1",
					payload: effective,
				},
			],
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		expect(reasons(json).find((reason) => reason.code === "model_attribution_mismatch")).toBeUndefined()
		expect(json.compatible).toBe(true)
	})

	it("C3b: an UNSCOPED mixed-model dump remains refused", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1", modelId: "minimax-m3" },
			extraEvents: [
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r2",
					modelId: "minimax-m3.1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-other" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		expect(
			reasons(json).some((reason) => reason.code === "model_attribution_mismatch" || reason.code === "multi_run_unscoped"),
		).toBe(true)
	})

	it("C3c: a selected run that genuinely contains the WRONG model family is still rejected", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-correction-"))
		const m3Path = await writeTrace(dir, "m3", {
			configIdentity: { sessionId: "s1", modelId: "minimax-m3" },
			extraEvents: [
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r1",
					modelId: "minimax-m3.1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-sel" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1", sessionId: "s1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
			},
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		expect(json.compatible).toBe(false)
		expect(reasons(json).find((reason) => reason.code === "model_attribution_mismatch")).toBeDefined()
	})
})
