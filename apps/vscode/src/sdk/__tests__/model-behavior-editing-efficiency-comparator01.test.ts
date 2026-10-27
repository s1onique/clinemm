/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01 — comparator witnesses.
 *
 * The comparator's "Editing Efficiency" section is what turns the raw
 * trace into an M3-vs-M3.1 statement. These witnesses drive the REAL
 * comparator script as a subprocess, so the shipped CLI is what is
 * exercised — not a re-implementation of it.
 *
 * Gates covered here:
 *   CE01  Native edit attempts, applied mutations and failures are
 *         reported from the OBSERVED edit events.
 *   CE02  Distinct files modified and edits per file are derived from
 *         the correlated file revisions.
 *   CE03  A no-op edit is counted as a no-op, not as a mutation.
 *   CE04  An A → B → A reversion is recognized.
 *   CE05  A → B → C churn is measured WITHOUT falsely claiming a
 *         reversion.
 *   CE06  Shell calls are reported as SEPARATE activity and never
 *         contribute to the native-edit counters.
 *   CE07  A run with source changes but no native edit observations
 *         reports `FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE`.
 *   CE08  Accepted executable gates stay UNAVAILABLE — a successful
 *         `run_commands` is never converted into an accepted test.
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
	toolNames: ["read_file", "editor", "run_commands", "run_tests", "search_codebase"],
	sourceHead: "b22855b4a83a958904d9d87c31e4d6c298d355da",
	extensionVersion: "1.0.0",
	extensionBundleSha256: "1111111111111111111111111111111111111111111111111111111111111111",
	effectiveMaxInputTokens: "200000",
	inputBudgetSource: "userCeiling",
	userContextCeilingMode: "explicit",
}

interface EditEvent {
	event: string
	payload: Record<string, unknown>
}

async function writeTrace(
	dir: string,
	name: string,
	options: {
		modelId?: string
		editEvents?: EditEvent[]
		toolEvents?: Array<{ name: string; outcome?: string }>
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
		modelId: options.modelId ?? "minimax-m3",
		payload: { ...BASE_CONFIG, runtimeModelId: options.modelId ?? "minimax-m3" },
	})

	for (const tool of options.toolEvents ?? []) {
		push({
			event: "tool_start",
			sessionId: "s1",
			runId: "r1",
			iteration: 1,
			payload: { toolName: tool.name, argumentFingerprint: `fp-${tool.name}` },
		})
		push({
			event: "tool_finish",
			sessionId: "s1",
			runId: "r1",
			iteration: 1,
			payload: {
				toolName: tool.name,
				argumentFingerprint: `fp-${tool.name}`,
				outcome: tool.outcome ?? "success",
			},
		})
	}

	for (const edit of options.editEvents ?? []) {
		push({
			event: edit.event,
			sessionId: "s1",
			runId: "r1",
			iteration: 1,
			payload: edit.payload,
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
	const filePath = join(dir, `${name}.jsonl`)
	await writeFile(filePath, `${lines.join("\n")}\n`, "utf8")
	return filePath
}

async function runComparator(m3Path: string, m31Path: string): Promise<{ summary: any; markdown: string }> {
	const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-comparator-"))
	const jsonPath = join(dir, "out.json")
	const mdPath = join(dir, "out.md")
	await execFileAsync("bun", [SCRIPT, "--m3", m3Path, "--m3.1", m31Path, "--json", jsonPath, "--md", mdPath])
	const summary = JSON.parse(await readFile(jsonPath, "utf8"))
	const markdown = await readFile(mdPath, "utf8")
	return { summary, markdown }
}

/**
 * Build the edit events for a file that goes A → B → A.
 */
function reversionEvents(fileIdentity: string): EditEvent[] {
	return [
		{
			event: "edit_attempt",
			payload: {
				toolCallId: "tc-1",
				toolName: "editor",
				operation: "replace",
				fileIdentity,
				targetCount: 1,
				requestedChars: 10,
				approvalOutcome: "approved",
				executionInvoked: true,
			},
		},
		{
			event: "edit_application",
			payload: {
				outcome: "applied",
				requestedFileCount: 1,
				mutatedFileCount: 1,
				unmutatedFileCount: 0,
				noOp: false,
				durationMs: 5,
				provenance: "REAL_PRODUCTION_SEAM",
				fileMutations: [{ fileIdentity, contentVersionPre: "vA", contentVersionPost: "vB" }],
			},
		},
		{
			event: "edit_attempt",
			payload: {
				toolCallId: "tc-2",
				toolName: "editor",
				operation: "replace",
				fileIdentity,
				targetCount: 1,
				requestedChars: 10,
				approvalOutcome: "approved",
				executionInvoked: true,
			},
		},
		{
			event: "edit_application",
			payload: {
				outcome: "applied",
				requestedFileCount: 1,
				mutatedFileCount: 1,
				unmutatedFileCount: 0,
				noOp: false,
				durationMs: 5,
				provenance: "REAL_PRODUCTION_SEAM",
				fileMutations: [{ fileIdentity, contentVersionPre: "vB", contentVersionPost: "vA" }],
			},
		},
	]
}

/**
 * Build the edit events for a file that goes A → B → C.
 */
function churnEvents(fileIdentity: string): EditEvent[] {
	return [
		{
			event: "edit_application",
			payload: {
				outcome: "applied",
				requestedFileCount: 1,
				mutatedFileCount: 1,
				unmutatedFileCount: 0,
				noOp: false,
				durationMs: 4,
				provenance: "REAL_PRODUCTION_SEAM",
				fileMutations: [{ fileIdentity, contentVersionPre: "vA", contentVersionPost: "vB" }],
			},
		},
		{
			event: "edit_application",
			payload: {
				outcome: "applied",
				requestedFileCount: 1,
				mutatedFileCount: 1,
				unmutatedFileCount: 0,
				noOp: false,
				durationMs: 4,
				provenance: "REAL_PRODUCTION_SEAM",
				fileMutations: [{ fileIdentity, contentVersionPre: "vB", contentVersionPost: "vC" }],
			},
		},
	]
}

describe("Model Behavior Trace comparator — Editing Efficiency", () => {
	it("CE01/CE02: reports attempts, applied mutations, failures, files and edits-per-file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-ce01-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: [
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-1",
						toolName: "editor",
						operation: "replace",
						fileIdentity: "file-a",
						targetCount: 1,
						requestedChars: 12,
						approvalOutcome: "approved",
						executionInvoked: true,
					},
				},
				{
					event: "edit_application",
					payload: {
						outcome: "applied",
						requestedFileCount: 1,
						mutatedFileCount: 1,
						unmutatedFileCount: 0,
						noOp: false,
						durationMs: 7,
						provenance: "REAL_PRODUCTION_SEAM",
						fileMutations: [{ fileIdentity: "file-a", contentVersionPre: "v0", contentVersionPost: "v1" }],
					},
				},
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-2",
						toolName: "editor",
						operation: "replace",
						fileIdentity: "file-b",
						targetCount: 1,
						requestedChars: 8,
						approvalOutcome: "approved",
						executionInvoked: true,
					},
				},
				{
					event: "edit_application",
					payload: {
						outcome: "rejected",
						failureCategory: "text_not_found",
						requestedFileCount: 1,
						mutatedFileCount: 0,
						unmutatedFileCount: 1,
						noOp: true,
						durationMs: 2,
						provenance: "REAL_PRODUCTION_SEAM",
					},
				},
			],
		})
		const m31 = await writeTrace(dir, "m31", {
			modelId: "minimax-m3.1",
			editEvents: [],
		})

		const { summary, markdown } = await runComparator(m3, m31)
		const m3Stats = summary.editingEfficiency.m3
		expect(m3Stats.nativeEditAttempts).toBe(2)
		expect(m3Stats.appliedMutations).toBe(1)
		expect(m3Stats.failedEdits).toBe(1)
		expect(m3Stats.distinctFilesModified).toBe(1)
		expect(m3Stats.editsPerFile).toBe(1)
		expect(m3Stats.fileWriteDurationMs).toBe(9)
		expect(m3Stats.mutationProvenance).toBe("REAL_PRODUCTION_SEAM")
		expect(m3Stats.churnProvenance).toBe("INFERRED")

		// The M3.1 side observed NO native edit at all.
		expect(summary.editingEfficiency.m31.nativeEditAttempts).toBe(0)
		expect(summary.editingEfficiency.m31.appliedMutations).toBe(0)

		// The Markdown report carries the section.
		expect(markdown).toContain("## Editing Efficiency")
		expect(markdown).toContain("Native edit attempts")
		expect(markdown).toContain("Distinct files modified")
		expect(markdown).toContain("Edits per file")
	})

	it("CE03: a no-op edit is counted as a no-op", async () => {
		const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-ce03-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: [
				{
					event: "edit_application",
					payload: {
						outcome: "applied",
						requestedFileCount: 1,
						mutatedFileCount: 1,
						unmutatedFileCount: 0,
						noOp: true,
						durationMs: 3,
						provenance: "REAL_PRODUCTION_SEAM",
						fileMutations: [{ fileIdentity: "file-a", contentVersionPre: "v0", contentVersionPost: "v0" }],
					},
				},
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1" })
		const { summary } = await runComparator(m3, m31)
		expect(summary.editingEfficiency.m3.noOpEdits).toBe(1)
	})

	it("CE04: an A → B → A reversion is recognized", async () => {
		const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-ce04-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: reversionEvents("file-a"),
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1" })
		const { summary } = await runComparator(m3, m31)
		const m3Stats = summary.editingEfficiency.m3
		expect(m3Stats.revertedMutations).toBe(1)
		expect(m3Stats.revisionChurn).toBe(1)
	})

	it("CE05: A → B → C churn is measured WITHOUT falsely claiming a reversion", async () => {
		const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-ce05-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: churnEvents("file-a"),
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1" })
		const { summary } = await runComparator(m3, m31)
		const m3Stats = summary.editingEfficiency.m3
		// The churn is measured...
		expect(m3Stats.revisionChurn).toBe(1)
		// ...but the file did NOT return to an earlier version, so no
		// reversion is claimed.
		expect(m3Stats.revertedMutations).toBe(0)
	})

	it("CE06/CE07: shell activity is separate, and an unattributed change is reported as such", async () => {
		const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-ce06-"))
		const m3 = await writeTrace(dir, "m3", {
			toolEvents: [{ name: "run_commands" }, { name: "run_commands", outcome: "error" }],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1" })
		const { summary, markdown } = await runComparator(m3, m31)
		const m3Stats = summary.editingEfficiency.m3
		// The shell calls are counted SEPARATELY...
		expect(m3Stats.shellCallCount).toBe(2)
		expect(m3Stats.shellCallSuccessCount).toBe(1)
		// ...and they never contribute to the native-edit counters.
		expect(m3Stats.nativeEditAttempts).toBe(0)
		expect(m3Stats.appliedMutations).toBe(0)
		// The origin of the change is explicitly unavailable.
		expect(m3Stats.editOriginUnavailable).toBe(true)
		expect(m3Stats.editOriginMarker).toBe("FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE")
		expect(markdown).toContain("FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE")
	})

	it("CE08: accepted executable gates stay UNAVAILABLE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "edit-efficiency-ce08-"))
		const m3 = await writeTrace(dir, "m3", {
			toolEvents: [{ name: "run_commands" }, { name: "run_tests" }],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1" })
		const { summary, markdown } = await runComparator(m3, m31)
		expect(summary.editingEfficiency.m3.acceptedExecutableGates).toBe("UNAVAILABLE_FROM_TRACE")
		expect(summary.editingEfficiency.m31.acceptedExecutableGates).toBe("UNAVAILABLE_FROM_TRACE")
		expect(markdown).toContain("UNAVAILABLE_FROM_TRACE")
	})
})
