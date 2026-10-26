/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — offline comparator witnesses.
 *
 * Gates covered here:
 *   T14  Comparator detects material configuration mismatch.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01 gates covered here:
 *   C01  Two traces with NO model_config snapshot are NOT compatible.
 *        (The OLD comparator said `compatible: true` because two equally
 *        missing configurations compared equal.)
 *   C02  An M3-labelled trace containing M3.1 events is REJECTED.
 *   C03  Two runs with different context ceilings but the SAME first
 *        configuration are rejected or scoped explicitly.
 *   C04  Different KNOWN source identities are incompatible.
 *   C05  Two fully identified, compatible configurations ARE compatible.
 *   C06  Accepted executable gates are UNAVAILABLE_FROM_TRACE — a
 *        successful `run_commands` is NOT a passing test gate.
 *
 * The witness drives the REAL comparator script as a subprocess, so the
 * shipped CLI is what is exercised — not a re-implementation of it.
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

// The comparator script lives at the repo root.
const SCRIPT = resolve(__dirname, "../../../../../scripts/compare-model-behavior-traces.ts")

/**
 * The configuration values every well-formed trace carries.
 *
 * The `model_config` snapshot is what makes a trace IDENTIFIABLE. Without
 * it the comparator cannot establish comparability at all.
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
	// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the context ceiling must be
	// KNOWN for a comparison to be compatible. Two equally-unknown ceilings
	// are equally unknown — they are NOT evidence of a match.
	userContextCeiling: "200000",
	toolCount: "5",
	toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
	sourceHead: "b22855b4a83a958904d9d87c31e4d6c298d355da",
	extensionVersion: "1.0.0",
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

/** Build a synthetic trace file. */
async function writeTrace(
	dir: string,
	name: string,
	options: {
		/** Omit the `model_config` snapshot entirely. */
		omitConfig?: boolean
		config?: Record<string, unknown>
		tools?: Array<{ name: string; fingerprint: string; outcome?: string }>
		compactions?: number
		finishReason?: string
		truncated?: boolean
		droppedCount?: number
		/** Extra raw events appended after the standard ones. */
		extraEvents?: SyntheticEvent[]
		/** The identity carried by the `model_config` record. */
		configIdentity?: { sessionId?: string; runId?: string; providerId?: string; modelId?: string }
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
			payload: {
				...BASE_CONFIG,
				...(options.config ?? {}),
			},
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

	for (let index = 0; index < (options.compactions ?? 0); index += 1) {
		push({
			event: "compaction_completed",
			sessionId: "s1",
			runId: "r1",
			iteration: 1,
			payload: {
				tokensBefore: 119_000,
				tokensAfter: 40_000,
				inputBudgetSource: "fallback_128k",
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
		payload: { finishReason: options.finishReason ?? "stop", durationMs: 1000, iterations: 1 },
	})

	const truncation = {
		truncated: options.truncated ?? false,
		droppedCount: options.droppedCount ?? 0,
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
	const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
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

describe("compare-model-behavior-traces", () => {
	it("T14: detects a material configuration mismatch", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
		})
		const m31Path = await writeTrace(dir, "m31", {
			// A DIFFERENT source HEAD makes the comparison invalid.
			config: { sourceHead: "0000000000000000000000000000000000000000" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const sourceHead = differences.find((difference) => difference.dimension === "sourceHead")
		expect(sourceHead).toBeDefined()
		expect(sourceHead?.severity).toBe("material")
		expect(markdown).toContain("Material Differences")
		expect(markdown).toContain("sourceHead")
		expect(markdown).toContain("NO")
	})

	it("T14b: reports a compatible comparison when the configuration matches", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
		})
		const m31Path = await writeTrace(dir, "m31", {
			// The M3.1 side must actually record an M3.1 model identity —
			// otherwise the label is unproven.
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

	it("T14c: flags a differing context ceiling as material", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {})
		const m31Path = await writeTrace(dir, "m31", {
			config: { userContextCeiling: "100000" },
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		expect(differences.find((difference) => difference.dimension === "userContextCeiling")).toBeDefined()
	})

	it("T14d: flags a differing reasoning policy as material", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {})
		const m31Path = await writeTrace(dir, "m31", {
			config: { reasoningEffort: "low" },
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
	})

	it("T14e: flags a differing tool configuration as material", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {})
		const m31Path = await writeTrace(dir, "m31", {
			config: { toolCount: "9" },
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
	})

	it("T14f: counts repetitions, errors, and tool-name heuristics", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {
			tools: [
				{ name: "read_file", fingerprint: "fp-a" },
				{ name: "read_file", fingerprint: "fp-a" },
				{ name: "write_file", fingerprint: "fp-b" },
				{ name: "run_tests", fingerprint: "fp-t", outcome: "error" },
				{ name: "run_tests", fingerprint: "fp-t" },
			],
			compactions: 1,
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: { selectedModelId: "minimax-m3.1", runtimeModelId: "minimax-m3.1" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		const statistics = json.statistics as Record<string, Record<string, unknown>>
		expect(statistics.m3?.totalToolCalls).toBe(5)
		expect(statistics.m3?.exactRepeatedActionCount).toBe(2)
		expect(statistics.m3?.repeatedVerificationAttempts).toBe(1)
		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the verification count is
		// a TOOL-NAME heuristic, not an accepted-gate count.
		expect(statistics.m3?.verificationToolCallCount).toBe(2)
		expect(statistics.m3?.verificationToolNameHeuristic).toBe(true)
		expect(statistics.m3?.compactionCount).toBe(1)
		// The interpretation explicitly frames the numbers as heuristics.
		expect(markdown).toContain("heuristics")
		expect(markdown).toContain("not proof of a model defect")
		expect(markdown).toContain("NOT, by itself, evidence of a better model")
	})

	it("T14g: warns when a trace is truncated", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", { truncated: true, droppedCount: 17 })
		const m31Path = await writeTrace(dir, "m31", {})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		const warnings = json.warnings as string[]
		expect(warnings.some((warning) => warning.includes("TRUNCATED"))).toBe(true)
		expect(markdown).toContain("TRUNCATED")
	})

	// -----------------------------------------------------------------------
	// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01 — fail-closed comparability
	// -----------------------------------------------------------------------

	it("C01: two traces with NO model_config snapshot are NOT compatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		// Enabling the recorder on an ALREADY-RUNNING session produces a
		// trace with no configuration snapshot at all.
		const m3Path = await writeTrace(dir, "m3", {
			omitConfig: true,
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
		})
		const m31Path = await writeTrace(dir, "m31", {
			omitConfig: true,
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		// The OLD comparator reported `compatible: true` here, because two
		// equally-missing configurations compared equal.
		expect(json.compatible).toBe(false)
		const comparability = json.comparability as Record<string, unknown>
		expect(comparability.status).not.toBe("compatible")
		const reasons = comparability.reasons as Array<Record<string, unknown>>
		expect(reasons.some((reason) => reason.code === "missing_model_config")).toBe(true)
		expect(markdown).toContain("NO")
	})

	it("C02: an M3-labelled trace containing M3.1 events is REJECTED", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
			extraEvents: [
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r1",
					modelId: "minimax-m3.1",
					payload: { toolName: "read_file", argumentFingerprint: "fp-x" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: { selectedModelId: "minimax-m3.1", runtimeModelId: "minimax-m3.1" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const comparability = json.comparability as Record<string, unknown>
		const reasons = comparability.reasons as Array<Record<string, unknown>>
		expect(reasons.some((reason) => reason.code === "model_attribution_mismatch")).toBe(true)
	})

	it("C03: two runs with different context ceilings are rejected or scoped explicitly", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		// Both runs carry the SAME FIRST configuration snapshot, but the
		// second run has a different context ceiling. Aggregating them
		// against the first snapshot would silently mix the two.
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
			extraEvents: [
				{
					event: "model_config",
					sessionId: "s1",
					runId: "r2",
					modelId: "minimax-m3",
					payload: { ...BASE_CONFIG, userContextCeiling: "100000" },
				},
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r2",
					modelId: "minimax-m3",
					payload: { toolName: "read_file", argumentFingerprint: "fp-b" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: { selectedModelId: "minimax-m3.1", runtimeModelId: "minimax-m3.1" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		// Unscoped: the trace spans two runs and two distinct configurations,
		// so the comparison must be refused.
		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const comparability = json.comparability as Record<string, unknown>
		const reasons = comparability.reasons as Array<Record<string, unknown>>
		expect(reasons.some((reason) => reason.code === "multi_run_unscoped" || reason.code === "ambiguous_model_config")).toBe(
			true,
		)
	})

	it("C03b: an explicitly selected run scopes the comparison", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		// The trace spans two runs. The FIRST run is the one under
		// comparison; the second run has a different context ceiling and
		// must be excluded by the explicit selection.
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
			extraEvents: [
				{
					event: "model_config",
					sessionId: "s1",
					runId: "r2",
					modelId: "minimax-m3",
					payload: { ...BASE_CONFIG, userContextCeiling: "100000" },
				},
				{
					event: "tool_start",
					sessionId: "s1",
					runId: "r2",
					modelId: "minimax-m3",
					payload: { toolName: "run_commands", argumentFingerprint: "fp-b" },
				},
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: { selectedModelId: "minimax-m3.1", runtimeModelId: "minimax-m3.1" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { json } = await runComparator(m3Path, m31Path, ["--m3-run", "r1", "--m3.1-run", "r1"])
		// With the run EXPLICITLY selected, the comparison is scoped and
		// succeeds — and the OTHER run's activity is excluded.
		expect(json.compatible).toBe(true)
		const comparability = json.comparability as Record<string, unknown>
		expect(comparability.status).toBe("compatible")
		const statistics = json.statistics as Record<string, Record<string, unknown>>
		// Only the SELECTED run's tool call is counted.
		expect(statistics.m3?.totalToolCalls).toBe(1)
		const differences = json.configurationDifferences as Record<string, { m3: string; m31: string; comparison: string }>
		expect(differences.userContextCeiling?.comparison).toBe("equal")
	})

	it("C04: different KNOWN source identities are incompatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {
			config: { sourceHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: {
				selectedModelId: "minimax-m3.1",
				runtimeModelId: "minimax-m3.1",
				sourceHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(false)
		const differences = json.materialDifferences as Array<Record<string, unknown>>
		const sourceHead = differences.find((difference) => difference.dimension === "sourceHead")
		expect(sourceHead).toBeDefined()
		expect(sourceHead?.severity).toBe("material")
	})

	it("C05: two fully identified, compatible configurations ARE compatible", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		const m3Path = await writeTrace(dir, "m3", {
			tools: [{ name: "read_file", fingerprint: "fp-a" }],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: { selectedModelId: "minimax-m3.1", runtimeModelId: "minimax-m3.1" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		expect(json.compatible).toBe(true)
		const comparability = json.comparability as Record<string, unknown>
		expect(comparability.status).toBe("compatible")
		expect(markdown).toContain("**Comparable**: YES")
	})

	it("C06: accepted executable gates are UNAVAILABLE_FROM_TRACE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
		// A successful `run_commands` (the way ClineMM actually runs shell
		// verification) must NOT be counted as an accepted executable gate,
		// and a tool merely NAMED `run_tests` must NOT be counted either.
		const m3Path = await writeTrace(dir, "m3", {
			tools: [
				{ name: "run_commands", fingerprint: "fp-c" },
				{ name: "run_tests", fingerprint: "fp-t" },
			],
		})
		const m31Path = await writeTrace(dir, "m31", {
			configIdentity: { modelId: "minimax-m3.1" },
			config: { selectedModelId: "minimax-m3.1", runtimeModelId: "minimax-m3.1" },
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		const statistics = json.statistics as Record<string, Record<string, unknown>>
		expect(statistics.m3?.acceptedExecutableGates).toBe("UNAVAILABLE_FROM_TRACE")
		expect(statistics.m3?.toolCallsPerAcceptedGate).toBe("UNAVAILABLE_FROM_TRACE")
		// The tool-NAME heuristic is still reported, and is labelled as one.
		expect(statistics.m3?.verificationToolCallCount).toBe(1)
		expect(statistics.m3?.verificationToolNameHeuristic).toBe(true)
		// The old `acceptedGateCount` metric must be GONE.
		expect(statistics.m3?.acceptedGateCount).toBeUndefined()
		expect(markdown).toContain("UNAVAILABLE_FROM_TRACE")
	})
})
