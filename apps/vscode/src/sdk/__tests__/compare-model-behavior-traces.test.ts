/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — offline comparator witnesses.
 *
 * Gates covered here:
 *   T14  Comparator detects material configuration mismatch.
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

/** Build a synthetic trace file. */
async function writeTrace(
	dir: string,
	name: string,
	options: {
		config?: Record<string, unknown>
		tools?: Array<{ name: string; fingerprint: string; outcome?: string }>
		compactions?: number
		finishReason?: string
		truncated?: boolean
		droppedCount?: number
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

	push({
		event: "model_config",
		sessionId: "s1",
		providerId: "minimax",
		modelId: "minimax-m3",
		payload: {
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
			userContextCeiling: "UNAVAILABLE_FROM_TRACE",
			toolCount: "5",
			toolNames: ["read_file", "write_file", "run_command", "run_tests", "search_codebase"],
			sourceHead: "b22855b4a83a958904d9d87c31e4d6c298d355da",
			extensionVersion: "1.0.0",
			...(options.config ?? {}),
		},
	})

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

async function runComparator(m3Path: string, m31Path: string): Promise<{ markdown: string; json: Record<string, unknown> }> {
	const dir = await mkdtemp(join(tmpdir(), "mbt-compare-"))
	const mdPath = join(dir, "out.md")
	const jsonPath = join(dir, "out.json")
	await execFileAsync(process.execPath, [SCRIPT, "--m3", m3Path, "--m3.1", m31Path, "--md", mdPath, "--json", jsonPath])
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

	it("T14f: counts repetitions, errors, and gates as HEURISTICS", async () => {
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
			tools: [{ name: "read_file", fingerprint: "fp-b" }],
		})

		const { markdown, json } = await runComparator(m3Path, m31Path)
		const statistics = json.statistics as Record<string, Record<string, number>>
		expect(statistics.m3?.totalToolCalls).toBe(5)
		expect(statistics.m3?.exactRepeatedActionCount).toBe(2)
		expect(statistics.m3?.repeatedVerificationAttempts).toBe(1)
		expect(statistics.m3?.acceptedGateCount).toBe(1)
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
})
