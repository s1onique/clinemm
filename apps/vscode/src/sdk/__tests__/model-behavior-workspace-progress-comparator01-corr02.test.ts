/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02 — comparator
 * witnesses.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * CORR01 made the checkpoint a real filesystem observation. The review of
 * CORR01 then found two P0 defects in the CAUSAL IDENTITY of that evidence:
 *
 *   P0-1  The checkpoint carried NO session/run identity. The comparator's
 *         `scopeRecords()` excludes a record that carries neither the
 *         selected run id nor the owning session id, so `--m3-run` /
 *         `--m3.1-run` DROPPED the checkpoint — the retained-change
 *         authority of a selected run was simply absent. The registry was
 *         also keyed by absolute path ALONE, so two runs touching the same
 *         destination were MERGED into one target.
 *
 *   P0-2  The destination scope and the independently verified write were
 *         joined by TOOL-CALL ID alone. Several destinations of ONE
 *         `apply_patch` share ONE tool-call id, so the join was ambiguous
 *         and the write was attributed to whichever destination happened to
 *         be resolved last.
 *
 * These witnesses drive the REAL comparator script as a subprocess, so the
 * shipped CLI is what is exercised — not a re-implementation of it. The
 * trace events they feed it are produced by the REAL production executors
 * (`createApplyPatchExecutor`, `createEditorExecutor`) against REAL
 * temporary files, so the correlation is driven by production events and
 * not by hand-written synthetic records.
 *
 * Gates covered here:
 *   CWC07  Two runs in ONE capture → selecting a run keeps ONLY that run's
 *          checkpoint evidence.
 *   CWC08  A real two-file apply_patch → each write joins to its OWN
 *          destination (one inside, one outside the workspace).
 *   CWC09  An AMBIGUOUS join (no per-target identity, several
 *          destinations) → UNAVAILABLE, never inferred.
 *   CWC10  A single-run capture is UNCHANGED.
 */
import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import * as core from "@cline/core"
import type { ModelBehaviorTraceObservation, ModelBehaviorTraceSink } from "@cline/shared"
import {
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
} from "@cline/shared"
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

interface TraceEvent {
	event: string
	payload: Record<string, unknown>
	sessionId?: string | null
	runId?: string | null
}

async function writeTrace(
	dir: string,
	name: string,
	options: {
		modelId?: string
		events?: TraceEvent[]
	},
): Promise<string> {
	const lines: string[] = []
	let seq = 1
	const push = (record: Record<string, unknown>): void => {
		lines.push(
			JSON.stringify({
				seq: seq++,
				timestamp: "2026-01-01T00:00:00.000Z",
				evidenceBoundary: "direct_observation",
				sessionId: "session-1",
				runId: "run-1",
				...record,
			}),
		)
	}
	push({
		event: "model_config",
		payload: { ...BASE_CONFIG, ...(options.modelId ? { selectedModelId: options.modelId } : {}) },
	})
	for (const event of options.events ?? []) {
		push({
			event: event.event,
			payload: event.payload,
			...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
			...(event.runId !== undefined ? { runId: event.runId } : {}),
		})
	}
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

/**
 * The subset of the comparator's JSON summary this suite reads.
 *
 * The comparator's summary is a large, evolving document; the witnesses
 * read only the workspace-progress section, so the type names exactly the
 * fields they assert on.
 */
interface ComparatorSummary {
	readonly workspaceProgress: {
		readonly m3: {
			readonly targetsResolved: number
			readonly targetsInsideActiveWorkspace: number
			readonly targetsOutsideActiveWorkspace: number
			readonly appliedWritesInsideWorkspace: number
			readonly appliedWritesOutsideWorkspace: number
			readonly unattributedAppliedWrites: number
			readonly retentionCounts: Record<string, number>
		}
	}
}

async function runComparator(
	m3Path: string,
	m31Path: string,
	options: { m3Run?: string; m31Run?: string } = {},
): Promise<{ summary: ComparatorSummary; markdown: string }> {
	const dir = await mkdtemp(join(tmpdir(), "workspace-progress-corr02-"))
	const jsonPath = join(dir, "out.json")
	const mdPath = join(dir, "out.md")
	const args = [SCRIPT, "--m3", m3Path, "--m3.1", m31Path, "--json", jsonPath, "--md", mdPath]
	if (options.m3Run !== undefined) {
		args.push("--m3-run", options.m3Run)
	}
	if (options.m31Run !== undefined) {
		args.push("--m3.1-run", options.m31Run)
	}
	await execFileAsync("bun", args)
	const summary = JSON.parse(await readFile(jsonPath, "utf8")) as ComparatorSummary
	const markdown = await readFile(mdPath, "utf8")
	return { summary, markdown }
}

/**
 * The REAL production events of ONE native edit, captured from the real
 * executor against a real temporary file.
 *
 * The events are produced by the production code itself, so the identity
 * that correlates them is the identity the production code emits — not a
 * hand-written synthetic value.
 */
async function captureRealEditEvents(options: {
	workspaceRoot: string
	toolCallId: string
	sessionId?: string
	runId?: string
	files: readonly {
		absolutePath: string
		content: string
		originalContent: string
	}[]
	toolName: "editor" | "apply_patch"
}): Promise<TraceEvent[]> {
	// The sink is a REAL capture channel: it records the production
	// observations verbatim.
	const captured: TraceEvent[] = []
	// The production observation carries the OWNER identity at the
	// observation level; the trace record carries it at the record level.
	const withOwner = (event: string, observation: ModelBehaviorTraceObservation): TraceEvent => ({
		event,
		payload: observation.payload as Record<string, unknown>,
		...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
		...(observation.runId !== undefined ? { runId: observation.runId } : {}),
	})
	const digest = (value: string): string => {
		let hash = 0x811c9dc5
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index)
			hash = Math.imul(hash, 0x01000193) >>> 0
		}
		return `corr02:${hash.toString(16).padStart(8, "0")}`
	}
	const sink: ModelBehaviorTraceSink = {
		fingerprintFilePath: (resolvedPath: string) => digest(`path:${resolvedPath}`),
		fingerprintFileContent: (content: string) => digest(`content:${content}`),
		onEditAttempt: (observation) => captured.push(withOwner("edit_attempt", observation)),
		onEditApplication: (observation) => captured.push(withOwner("edit_application", observation)),
		onEditFailure: (observation) => captured.push(withOwner("edit_failure", observation)),
		onEditTargetResolved: (observation) => captured.push(withOwner("edit_target_resolved", observation)),
		onEditWriteVerification: (observation) => captured.push(withOwner("edit_write_verification", observation)),
		onEditCheckpointObservation: (observation) => captured.push(withOwner("edit_checkpoint_observation", observation)),
	}

	const metadata = {
		[EDIT_OBSERVATION_SINK_METADATA_KEY]: sink,
		[EDIT_OBSERVATION_IDENTITY_METADATA_KEY]: {
			...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
			...(options.runId !== undefined ? { runId: options.runId } : {}),
			toolCallId: options.toolCallId,
		},
		[EDIT_OBSERVATION_APPROVAL_METADATA_KEY]: "approved",
		[EDIT_OBSERVATION_WORKSPACE_METADATA_KEY]: {
			workspaceRoot: options.workspaceRoot,
		},
	}
	const context = {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: 1,
		toolCallId: options.toolCallId,
		metadata,
	} as never

	if (options.toolName === "editor") {
		const editor = core.createEditorExecutor()
		for (const file of options.files) {
			// The file already exists, so the production path records a
			// PRE-write content baseline — the baseline a retained change
			// is measured against.
			await writeFile(file.absolutePath, file.originalContent, "utf8")
			await editor(
				{
					path: file.absolutePath,
					old_text: file.originalContent,
					new_text: file.content,
				} as never,
				options.workspaceRoot,
				context,
			)
		}
	} else {
		const applyPatch = core.createApplyPatchExecutor({ restrictToCwd: false })
		// The files already exist, so the patch UPDATES them and the
		// production path records a PRE-write content baseline for each.
		for (const file of options.files) {
			await writeFile(file.absolutePath, file.originalContent, "utf8")
		}
		const patch = [
			"*** Begin Patch",
			...options.files.flatMap((file) => [
				`*** Update File: ${file.absolutePath}`,
				"@@",
				`-${file.originalContent}`,
				`+${file.content}`,
			]),
			"*** End Patch",
		].join("\n")
		await applyPatch({ input: patch } as never, options.workspaceRoot, context)
	}

	// The REAL checkpoint capture, through the REAL production seam.
	await core.captureEditCheckpoint(sink as never)
	return captured
}

/**
 * The REAL checkpoint event produced by the production capture, with the
 * identity it carries.
 */
function checkpointEventOf(captured: readonly TraceEvent[]): TraceEvent | undefined {
	return captured.find((event) => event.event === "edit_checkpoint_observation")
}

describe("CWC07 — selecting a run keeps ONLY that run's checkpoint evidence", () => {
	it("CWC07: two runs in ONE capture are scoped independently", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc07-"))
		const workspaceRoot = join(dir, "workspace")
		await (await import("node:fs/promises")).mkdir(workspaceRoot, { recursive: true })

		// Each run is its own CAPTURE: the checkpoint registry is
		// capture-scoped, so it is reset between them.
		core.resetEditCheckpointRegistry()
		const runA = await captureRealEditEvents({
			workspaceRoot,
			toolCallId: "call-a",
			sessionId: "session-1",
			runId: "run-a",
			files: [
				{
					absolutePath: join(workspaceRoot, "a.txt"),
					content: "alpha",
					originalContent: "original-a",
				},
			],
			toolName: "editor",
		})
		core.resetEditCheckpointRegistry()
		const runB = await captureRealEditEvents({
			workspaceRoot,
			toolCallId: "call-b",
			sessionId: "session-1",
			runId: "run-b",
			files: [
				{
					absolutePath: join(workspaceRoot, "b.txt"),
					content: "beta",
					originalContent: "original-b",
				},
			],
			toolName: "editor",
		})

		// The REAL checkpoint carries the REAL owner identity.
		expect(checkpointEventOf(runA)?.payload.sessionId).toBe("session-1")
		expect(checkpointEventOf(runA)?.payload.runId).toBe("run-a")
		expect(checkpointEventOf(runB)?.payload.runId).toBe("run-b")

		// Both runs' events go into ONE trace.
		const m3 = await writeTrace(dir, "m3", {
			events: [...runA, ...runB],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })

		// Selecting run-a keeps run-a's evidence only.
		const { summary } = await runComparator(m3, m31, { m3Run: "run-a" })
		const progress = summary.workspaceProgress.m3
		// The selected run observed exactly ONE target — its OWN.
		expect(progress.targetsResolved).toBe(1)
		// And its checkpoint is PRESENT: the retained-change authority of
		// the selected run is not missing.
		expect(progress.retentionCounts.UNAVAILABLE_FROM_TRACE).toBe(0)
		expect(progress.retentionCounts.RETAINED_CHANGED).toBe(1)
	})
})

describe("CWC08 — a real two-file patch attributes each write to its OWN destination", () => {
	it("CWC08: one write inside and one outside the workspace", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc08-"))
		const workspaceRoot = join(dir, "workspace")
		const outsideRoot = join(dir, "outside")
		await (await import("node:fs/promises")).mkdir(workspaceRoot, { recursive: true })
		await (await import("node:fs/promises")).mkdir(outsideRoot, { recursive: true })

		const captured = await captureRealEditEvents({
			workspaceRoot,
			toolCallId: "call-multi",
			sessionId: "session-1",
			runId: "run-1",
			files: [
				{
					absolutePath: join(workspaceRoot, "inside.txt"),
					content: "inside",
					originalContent: "original-inside",
				},
				{
					absolutePath: join(outsideRoot, "outside.txt"),
					content: "outside",
					originalContent: "original-outside",
				},
			],
			toolName: "apply_patch",
		})

		const m3 = await writeTrace(dir, "m3", { events: captured })
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3

		// Both destinations were resolved, and each resolved to its OWN scope.
		expect(progress.targetsResolved).toBe(2)
		expect(progress.targetsInsideActiveWorkspace).toBe(1)
		expect(progress.targetsOutsideActiveWorkspace).toBe(1)

		// And each write joined to its OWN destination: ONE inside, ONE
		// outside. The old tool-call-id join attributed BOTH writes to the
		// LAST resolved destination.
		expect(progress.appliedWritesInsideWorkspace).toBe(1)
		expect(progress.appliedWritesOutsideWorkspace).toBe(1)
		expect(progress.unattributedAppliedWrites).toBe(0)
	})
})

describe("CWC09 — an ambiguous join is never inferred", () => {
	it("CWC09: a write with no per-target identity is UNATTRIBUTED", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc09-"))
		const workspaceRoot = join(dir, "workspace")
		await (await import("node:fs/promises")).mkdir(workspaceRoot, { recursive: true })

		// A hand-built trace whose application carries NO per-file identity
		// while the tool call resolved SEVERAL destinations: the join is
		// ambiguous and must not be guessed.
		const events: TraceEvent[] = [
			{
				event: "edit_target_resolved",
				payload: {
					toolCallId: "tc-ambiguous",
					toolName: "apply_patch",
					inputPathKind: "absolute",
					destinationScope: "active_workspace",
					canonicalized: true,
					destinationExistedBefore: false,
					fileIdentity: "file-inside",
					provenance: "REAL_PRODUCTION_SEAM",
				},
			},
			{
				event: "edit_target_resolved",
				payload: {
					toolCallId: "tc-ambiguous",
					toolName: "apply_patch",
					inputPathKind: "absolute",
					destinationScope: "outside_workspace",
					canonicalized: true,
					destinationExistedBefore: false,
					fileIdentity: "file-outside",
					provenance: "REAL_PRODUCTION_SEAM",
				},
			},
			{
				event: "edit_application",
				payload: {
					toolCallId: "tc-ambiguous",
					toolName: "apply_patch",
					outcome: "applied",
					requestedFileCount: 2,
					mutatedFileCount: 2,
					unmutatedFileCount: 0,
					noOp: false,
					durationMs: 5,
					// NO fileMutations ⇒ NO per-target identity.
					provenance: "REAL_PRODUCTION_SEAM",
				},
			},
		]

		const m3 = await writeTrace(dir, "m3", { events })
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3

		// The ambiguous write is NOT counted as inside or outside.
		expect(progress.appliedWritesInsideWorkspace).toBe(0)
		expect(progress.appliedWritesOutsideWorkspace).toBe(0)
		expect(progress.unattributedAppliedWrites).toBe(1)
	})
})

describe("CWC10 — a single-run capture is unchanged", () => {
	it("CWC10: one run's write is still attributed to its destination", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc10-"))
		const workspaceRoot = join(dir, "workspace")
		await (await import("node:fs/promises")).mkdir(workspaceRoot, { recursive: true })

		const captured = await captureRealEditEvents({
			workspaceRoot,
			toolCallId: "call-single",
			sessionId: "session-1",
			runId: "run-1",
			files: [
				{
					absolutePath: join(workspaceRoot, "single.txt"),
					content: "content",
					originalContent: "original",
				},
			],
			toolName: "editor",
		})

		const m3 = await writeTrace(dir, "m3", { events: captured })
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3

		expect(progress.targetsResolved).toBe(1)
		expect(progress.targetsInsideActiveWorkspace).toBe(1)
		expect(progress.appliedWritesInsideWorkspace).toBe(1)
		expect(progress.appliedWritesOutsideWorkspace).toBe(0)
		expect(progress.unattributedAppliedWrites).toBe(0)
		expect(progress.retentionCounts.RETAINED_CHANGED).toBe(1)
	})
})
