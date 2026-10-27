/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01 — comparator
 * witnesses.
 *
 * The comparator's retained-change classification is the statement that
 * answers the question the benchmark asked: did the agent's work REMAIN in
 * the workspace?
 *
 * WHY THIS SUITE EXISTS
 * ----------------------
 * The review of WORKSPACE-EFFECT-TRACE01 found that the classification was
 * derived from the LAST post-write read-back rather than from a filesystem
 * observation at the checkpoint. That is unsound, because a command that
 * later restores the file produces no native editor event:
 *
 *   T1  native editor writes B     → read-back confirms B on disk
 *   T2  a shell command restores A  → NO native editor event is emitted
 *   T3  the trace is dumped         → the last read-back still says "B"
 *
 * The comparator then reported RETAINED_CHANGED for a workspace that was
 * demonstrably back at A.
 *
 * These witnesses drive the REAL comparator script as a subprocess, so the
 * shipped CLI is what is exercised — not a re-implementation of it.
 *
 * Gates covered here:
 *   CWC01  A write restored by a command      → REVERTED, not retained
 *   CWC02  A write deleted after the edit     → DELETED, not retained
 *   CWC03  A write that survives              → RETAINED_CHANGED
 *   CWC04  A trace with NO checkpoint          → UNAVAILABLE_FROM_TRACE
 *   CWC05  An unreadable checkpoint target     → UNVERIFIED
 *   CWC06  A target outside the benchmark root → OUTSIDE_SCOPE
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
		push({ event: event.event, payload: event.payload })
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

async function runComparator(m3Path: string, m31Path: string): Promise<{ summary: any; markdown: string }> {
	const dir = await mkdtemp(join(tmpdir(), "workspace-progress-corr01-"))
	const jsonPath = join(dir, "out.json")
	const mdPath = join(dir, "out.md")
	await execFileAsync("bun", [SCRIPT, "--m3", m3Path, "--m3.1", m31Path, "--json", jsonPath, "--md", mdPath])
	const summary = JSON.parse(await readFile(jsonPath, "utf8"))
	const markdown = await readFile(mdPath, "utf8")
	return { summary, markdown }
}

/**
 * Build the workspace evidence for ONE edit.
 */
function workspaceEvents(options: {
	toolCallId?: string
	fileIdentity: string
	scope: "active_workspace" | "other_workspace" | "outside_workspace" | "unknown"
	benchmark?: boolean
	existedBefore?: boolean
	actualContent?: string
	intendedContent?: string
	fileExistsAfterWrite?: boolean
	readbackMatched?: boolean
	measurementSkippedReason?: string
}): TraceEvent[] {
	const toolCallId = options.toolCallId === undefined ? {} : { toolCallId: options.toolCallId }
	const events: TraceEvent[] = [
		{
			event: "edit_target_resolved",
			payload: {
				...toolCallId,
				toolName: "editor",
				inputPathKind: "absolute",
				destinationScope: options.scope,
				canonicalized: options.scope !== "unknown",
				destinationExistedBefore: options.existedBefore ?? false,
				fileIdentity: options.fileIdentity,
				...(options.benchmark !== undefined ? { underBenchmarkRoot: options.benchmark } : {}),
				provenance: "REAL_PRODUCTION_SEAM",
			},
		},
	]
	if (
		options.actualContent === undefined &&
		options.readbackMatched === undefined &&
		options.measurementSkippedReason === undefined
	) {
		return events
	}
	events.push({
		event: "edit_write_verification",
		payload: {
			...toolCallId,
			toolName: "editor",
			fileIdentity: options.fileIdentity,
			writeReturned: true,
			readbackAttempted: true,
			...(options.readbackMatched !== undefined ? { readbackMatched: options.readbackMatched } : {}),
			fileExistsAfterWrite: options.fileExistsAfterWrite ?? true,
			...(options.actualContent !== undefined ? { actualContentFingerprint: options.actualContent } : {}),
			...(options.intendedContent !== undefined ? { intendedContentFingerprint: options.intendedContent } : {}),
			...(options.measurementSkippedReason !== undefined
				? { measurementSkippedReason: options.measurementSkippedReason }
				: {}),
			provenance: "REAL_PRODUCTION_SEAM",
		},
	})
	return events
}

/**
 * Build the edit-application event for one write, carrying the PRE-write
 * content version — the baseline a retained change is measured against.
 */
function applicationEvent(options: {
	toolCallId?: string
	outcome?: string
	fileIdentity?: string
	contentVersionPre?: string
	contentVersionPost?: string
}): TraceEvent {
	return {
		event: "edit_application",
		payload: {
			...(options.toolCallId !== undefined ? { toolCallId: options.toolCallId } : {}),
			toolName: "editor",
			outcome: options.outcome ?? "applied",
			requestedFileCount: 1,
			mutatedFileCount: 1,
			unmutatedFileCount: 0,
			noOp: false,
			durationMs: 5,
			...(options.fileIdentity !== undefined
				? {
						fileMutations: [
							{
								fileIdentity: options.fileIdentity,
								...(options.contentVersionPre !== undefined
									? { contentVersionPre: options.contentVersionPre }
									: {}),
								...(options.contentVersionPost !== undefined
									? { contentVersionPost: options.contentVersionPost }
									: {}),
							},
						],
					}
				: {}),
			provenance: "REAL_PRODUCTION_SEAM",
		},
	}
}

/**
 * Build the CHECKPOINT observation — the real filesystem observation taken
 * at the operator checkpoint or the trace dump.
 */
function checkpointEvent(options: {
	targets: Array<{
		fileIdentity: string
		state: "present" | "absent" | "unreadable"
		contentFingerprint?: string
	}>
}): TraceEvent {
	return {
		event: "edit_checkpoint_observation",
		payload: {
			observedTargetCount: options.targets.length,
			targets: options.targets,
			provenance: "REAL_PRODUCTION_SEAM",
		},
	}
}
describe("CWC01 — a write that a command RESTORES is REVERTED, not retained", () => {
	it("CWC01: the checkpoint decides, not the last post-write read-back", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc01-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				// T1: the native editor writes B. The pre-write baseline is A.
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "B",
					readbackMatched: true,
				}),
				applicationEvent({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					contentVersionPre: "A",
					contentVersionPost: "B",
				}),
				// T3: the CHECKPOINT observes the file back at A. The
				// checkpoint is the real filesystem observation; the
				// read-back above is not.
				checkpointEvent({
					targets: [{ fileIdentity: "file-1", state: "present", contentFingerprint: "A" }],
				}),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		// The change did NOT survive: it was reverted.
		expect(counts.REVERTED).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
	})
})

describe("CWC02 — a write that is later DELETED is DELETED, not retained", () => {
	it("CWC02: the checkpoint observes the target as absent", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc02-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "created",
					readbackMatched: true,
				}),
				applicationEvent({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					contentVersionPost: "created",
				}),
				// The checkpoint observes the file as GONE.
				checkpointEvent({ targets: [{ fileIdentity: "file-1", state: "absent" }] }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		expect(counts.DELETED).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
	})
})

describe("CWC03 — a write that SURVIVES to the checkpoint is retained", () => {
	it("CWC03: the checkpoint observed content that differs from the baseline", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc03-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "B",
					readbackMatched: true,
				}),
				applicationEvent({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					contentVersionPre: "A",
					contentVersionPost: "B",
				}),
				// The checkpoint observed B: the change SURVIVED.
				checkpointEvent({
					targets: [{ fileIdentity: "file-1", state: "present", contentFingerprint: "B" }],
				}),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		expect(counts.RETAINED_CHANGED).toBe(1)
		expect(counts.REVERTED).toBe(0)
	})
})

describe("CWC04 — a trace with NO checkpoint reports UNAVAILABLE_FROM_TRACE", () => {
	it("CWC04: the current state is not knowable, so it is not a retained change", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc04-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				// The post-write read-back observed B...
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "B",
					readbackMatched: true,
				}),
				applicationEvent({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					contentVersionPre: "A",
					contentVersionPost: "B",
				}),
				// ...and there is NO checkpoint.
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		// The classification is UNAVAILABLE, never a guess.
		expect(counts.UNAVAILABLE_FROM_TRACE).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
		expect(counts.REVERTED).toBe(0)
		expect(counts.DELETED).toBe(0)
	})
})

describe("CWC05 — an unreadable checkpoint target is UNVERIFIED", () => {
	it("CWC05: an unknown state is never reported as unchanged", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc05-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "B",
					readbackMatched: true,
				}),
				applicationEvent({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					contentVersionPre: "A",
					contentVersionPost: "B",
				}),
				checkpointEvent({ targets: [{ fileIdentity: "file-1", state: "unreadable" }] }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		expect(counts.UNVERIFIED).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
		expect(counts.UNCHANGED).toBe(0)
	})
})

describe("CWC06 — a target outside the benchmark root stays OUTSIDE_SCOPE", () => {
	it("CWC06: the scope check precedes the checkpoint check", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cwc06-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-outside",
					scope: "outside_workspace",
					benchmark: false,
					actualContent: "B",
					readbackMatched: true,
				}),
				applicationEvent({
					toolCallId: "tc-1",
					fileIdentity: "file-outside",
					contentVersionPre: "A",
					contentVersionPost: "B",
				}),
				checkpointEvent({
					targets: [{ fileIdentity: "file-outside", state: "present", contentFingerprint: "B" }],
				}),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		expect(counts.OUTSIDE_SCOPE).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
	})
})
