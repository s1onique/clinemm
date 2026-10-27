/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 — comparator witnesses.
 *
 * The comparator's "Workspace Progress" section is what turns the raw
 * trace into a statement about WHERE the writes landed and what was
 * actually RETAINED. These witnesses drive the REAL comparator script as a
 * subprocess, so the shipped CLI is what is exercised — not a
 * re-implementation of it.
 *
 * Gates covered here:
 *   CW01  A write whose destination was resolved OUTSIDE the workspace is
 *         counted as an out-of-workspace applied write.
 *   CW02  A write whose destination was resolved INSIDE the workspace is
 *         counted as an in-workspace applied write.
 *   CW03  A destination whose scope could not be established is reported
 *         as UNVERIFIED — never as "inside the workspace".
 *   CW04  A write whose read-back could not be performed is UNVERIFIED —
 *         never "succeeded".
 *   CW05  A read-back that observed DIFFERENT bytes is reported as
 *         diverging from the intended content.
 *   CW06  A → B → A is classified REVERTED, not retained.
 *   CW07  A file created and then deleted is classified DELETED, not
 *         retained.
 *   CW08  A file outside the designated benchmark root is classified
 *         OUTSIDE_SCOPE, and the tracked/untracked/ignored counts stay
 *         separate.
 *   CW09  An application WITHOUT a tool-call identity is never attributed
 *         to a destination.
 *   CW10  A trace WITHOUT the workspace evidence reports every workspace
 *         figure as UNAVAILABLE — never as zero.
 *   CW11  Accepted executable gates stay UNAVAILABLE_FROM_TRACE.
 *   CW12  The Workspace Progress section is present in the rendered
 *         markdown.
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

	for (const item of options.events ?? []) {
		const sessionId = item.sessionId === null ? undefined : (item.sessionId ?? "s1")
		const runId = item.runId === null ? undefined : (item.runId ?? "r1")
		push({
			event: item.event,
			...(sessionId === undefined ? {} : { sessionId }),
			...(runId === undefined ? {} : { runId }),
			iteration: 1,
			payload: item.payload,
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
	const dir = await mkdtemp(join(tmpdir(), "workspace-progress-comparator-"))
	const jsonPath = join(dir, "out.json")
	const mdPath = join(dir, "out.md")
	await execFileAsync("bun", [SCRIPT, "--m3", m3Path, "--m3.1", m31Path, "--json", jsonPath, "--md", mdPath])
	const summary = JSON.parse(await readFile(jsonPath, "utf8"))
	const markdown = await readFile(mdPath, "utf8")
	return { summary, markdown }
}

/**
 * Build the workspace evidence for ONE edit.
 *
 * The `scope` is the canonical destination scope; `benchmark` is whether
 * the destination was under the designated benchmark root.
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
 * Build the edit-application event for one write.
 */
function applicationEvent(options: { toolCallId?: string; outcome?: string }): TraceEvent {
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
			provenance: "REAL_PRODUCTION_SEAM",
		},
	}
}

describe("CW01/CW02 — the applied write's destination is attributed", () => {
	it("CW01: an applied write resolved OUTSIDE the workspace is counted as outside", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw01-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-outside",
					scope: "outside_workspace",
					benchmark: false,
					actualContent: "v1",
					readbackMatched: true,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", {
			modelId: "minimax-m3.1",
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-inside",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "v1",
					readbackMatched: true,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const { summary } = await runComparator(m3, m31)
		const m3Progress = summary.workspaceProgress.m3
		const m31Progress = summary.workspaceProgress.m31
		expect(m3Progress.appliedWritesOutsideWorkspace).toBe(1)
		expect(m3Progress.appliedWritesInsideWorkspace).toBe(0)
		expect(m3Progress.targetsOutsideActiveWorkspace).toBe(1)
		expect(m31Progress.appliedWritesInsideWorkspace).toBe(1)
		expect(m31Progress.appliedWritesOutsideWorkspace).toBe(0)
		expect(m31Progress.targetsInsideActiveWorkspace).toBe(1)
	})

	it("CW09: an application WITHOUT a tool-call identity is never attributed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw09-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
				}),
				// No toolCallId: the application cannot be joined to the
				// resolution, so it is never attributed to a destination.
				applicationEvent({}),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		expect(summary.workspaceProgress.m3.appliedWritesInsideWorkspace).toBe(0)
		expect(summary.workspaceProgress.m3.appliedWritesOutsideWorkspace).toBe(0)
	})
})

describe("CW03 — an unverifiable scope is never reported as inside", () => {
	it("CW03: an unknown scope is counted as UNVERIFIED", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw03-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-unknown",
					scope: "unknown",
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3
		expect(progress.targetsScopeUnverified).toBe(1)
		expect(progress.targetsInsideActiveWorkspace).toBe(0)
		expect(progress.targetsOutsideActiveWorkspace).toBe(0)
		// The write is not attributed to either side.
		expect(progress.appliedWritesInsideWorkspace).toBe(0)
		expect(progress.appliedWritesOutsideWorkspace).toBe(0)
	})
})

describe("CW04/CW05 — the independent verification is reported honestly", () => {
	it("CW04: a write whose read-back was unavailable is UNVERIFIED", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw04-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					measurementSkippedReason: "READBACK_UNAVAILABLE",
					fileExistsAfterWrite: false,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3
		expect(progress.unverifiedWrites).toBe(1)
		expect(progress.verifiedWritesMatchingIntended).toBe(0)
		expect(progress.independentlyVerifiedWrites).toBe(0)
		expect(progress.writesWithDestinationAbsent).toBe(1)
	})

	it("CW05: a read-back that observed DIFFERENT bytes is reported as diverging", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw05-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "actual-bytes",
					intendedContent: "intended-bytes",
					readbackMatched: false,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3
		expect(progress.independentlyVerifiedWrites).toBe(1)
		expect(progress.verifiedWritesDivergingFromIntended).toBe(1)
		expect(progress.verifiedWritesMatchingIntended).toBe(0)
	})
})

describe("CW06/CW07/CW08 — the retention classification", () => {
	it("CW06: A → B → A is classified REVERTED, not retained", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw06-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "A",
					readbackMatched: true,
				}),
				...workspaceEvents({
					toolCallId: "tc-2",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "B",
					readbackMatched: true,
				}),
				...workspaceEvents({
					toolCallId: "tc-3",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "A",
					readbackMatched: true,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
				applicationEvent({ toolCallId: "tc-2" }),
				applicationEvent({ toolCallId: "tc-3" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		expect(counts.REVERTED).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
	})

	it("CW07: a file created and then deleted is DELETED, not retained", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw07-"))
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
				// The destination is ABSENT at the last read-back.
				{
					event: "edit_write_verification",
					payload: {
						toolCallId: "tc-2",
						toolName: "editor",
						fileIdentity: "file-1",
						writeReturned: true,
						readbackAttempted: true,
						fileExistsAfterWrite: false,
						measurementSkippedReason: "READBACK_UNAVAILABLE",
						provenance: "REAL_PRODUCTION_SEAM",
					},
				},
				applicationEvent({ toolCallId: "tc-1" }),
				applicationEvent({ toolCallId: "tc-2" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const counts = summary.workspaceProgress.m3.retentionCounts
		expect(counts.DELETED).toBe(1)
		expect(counts.RETAINED_CHANGED).toBe(0)
	})

	it("CW08: a target outside the benchmark root is OUTSIDE_SCOPE and the counts stay separate", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw08-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-outside",
					scope: "outside_workspace",
					benchmark: false,
					actualContent: "v1",
					readbackMatched: true,
				}),
				...workspaceEvents({
					toolCallId: "tc-2",
					fileIdentity: "file-inside",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "v1",
					readbackMatched: true,
				}),
				// A target whose benchmark membership was never established.
				...workspaceEvents({
					toolCallId: "tc-3",
					fileIdentity: "file-ignored",
					scope: "active_workspace",
					actualContent: "v1",
					readbackMatched: true,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
				applicationEvent({ toolCallId: "tc-2" }),
				applicationEvent({ toolCallId: "tc-3" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3
		expect(progress.trackedTargetCount).toBe(1)
		expect(progress.untrackedTargetCount).toBe(1)
		expect(progress.ignoredTargetCount).toBe(1)
		expect(progress.retentionCounts.OUTSIDE_SCOPE).toBe(1)
	})
})

describe("CW10/CW11/CW12 — the section is honest when the evidence is absent", () => {
	it("CW10: a trace WITHOUT the workspace evidence reports UNAVAILABLE, not zero", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw10-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [applicationEvent({ toolCallId: "tc-1" })],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary, markdown } = await runComparator(m3, m31)
		const progress = summary.workspaceProgress.m3
		expect(progress.workspaceEvidenceAvailable).toBe(false)
		expect(progress.workspaceEvidenceMarker).toBe("UNAVAILABLE_FROM_TRACE")
		// The section is present and says the evidence is unavailable.
		expect(markdown).toContain("## Workspace Progress")
		expect(markdown).toContain("UNAVAILABLE_FROM_TRACE")
	})

	it("CW11: the accepted executable gates stay UNAVAILABLE_FROM_TRACE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw11-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "active_workspace",
					benchmark: true,
					actualContent: "v1",
					readbackMatched: true,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { summary } = await runComparator(m3, m31)
		expect(summary.workspaceProgress.m3.acceptedExecutableGates).toBe("UNAVAILABLE_FROM_TRACE")
		expect(summary.workspaceProgress.m31.acceptedExecutableGates).toBe("UNAVAILABLE_FROM_TRACE")
	})

	it("CW12: the Workspace Progress section is rendered in the markdown", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cw12-"))
		const m3 = await writeTrace(dir, "m3", {
			events: [
				...workspaceEvents({
					toolCallId: "tc-1",
					fileIdentity: "file-1",
					scope: "outside_workspace",
					benchmark: false,
					actualContent: "v1",
					readbackMatched: true,
				}),
				applicationEvent({ toolCallId: "tc-1" }),
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1", events: [] })
		const { markdown } = await runComparator(m3, m31)
		expect(markdown).toContain("## Workspace Progress")
		expect(markdown).toContain("Applied writes OUTSIDE the workspace")
		expect(markdown).toContain("Targets OUTSIDE the active workspace")
	})
})
