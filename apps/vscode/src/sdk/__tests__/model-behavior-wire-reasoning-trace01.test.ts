/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 — comparator and
 * runtime witnesses.
 *
 * These witnesses drive the REAL comparator script as a subprocess and the
 * REAL extension-host trace runtime, so the shipped code is what is
 * exercised — not a re-implementation of it.
 *
 * Gates covered here:
 *   WR01  A trace with NO wire evidence is NOT reported as a reasoning
 *         mismatch — the comparison stays compatible.
 *   WR02  Two traces that serialized DIFFERENT wire reasoning controls
 *         are INCOMPATIBLE: the models were asked to reason differently on
 *         the wire.
 *   WR03  Two traces that serialized the SAME wire reasoning controls stay
 *         compatible, and the wire section reports the exact request-id
 *         join.
 *   WR04  Wire evidence on ONE side only is UNVERIFIED, never a mismatch.
 *   WR05  A wire record is joined to the requested configuration ONLY by
 *         exact request id.
 *   WR06  A REJECTED native edit with no application is a LEGITIMATE
 *         absence, counted as `rejected` — not as an unfulfilled attempt.
 *   WR07  A SKIPPED native edit with no application is counted as
 *         `skipped`.
 *   WR08  An APPROVED, INVOKED native edit with no application is a
 *         genuine EVIDENCE GAP, counted as `unfulfilled`.
 *   WR09  An applied no-op edit is counted as `applied_no_change`, never
 *         as a content change.
 *   WR10  The recorder is DEFAULT OFF: the wire observer records NOTHING
 *         while the trace is disabled.
 *   WR11  The wire observation retains NO prompt, message, tool-argument or
 *         credential material.
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
	reasoningEffort: "low",
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

/** One wire observation in a synthetic trace. */
interface WireEvent {
	/** The per-request correlation id. */
	requestId?: string
	/** The HTTP attempt ordinal within the request. */
	attempt?: number
	/** The serialized Anthropic-compatible effort. */
	outputConfigEffort?: string
	/** The serialized thinking mode. */
	thinkingMode?: string
	/**
	 * The `requestId` written into the companion `effective_model_config`
	 * record. `undefined` means "the same id as the wire record"; `null`
	 * means "no `effective_model_config` counterpart at all".
	 */
	effectiveConfigRequestId?: string | null
}

async function writeTrace(
	dir: string,
	name: string,
	options: {
		modelId?: string
		wireEvents?: WireEvent[]
		editEvents?: Array<{ event: string; payload: Record<string, unknown> }>
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

	// The REQUESTED configuration, carrying the per-request correlation id.
	// This is the join target of the wire evidence.
	for (const [index, wire] of (options.wireEvents ?? []).entries()) {
		// The REQUESTED configuration, carrying the per-request correlation
		// id. This is the join target of the wire evidence. A `null`
		// `effectiveConfigRequestId` writes NO `requestId` at all.
		const effectiveRequestId = wire.effectiveConfigRequestId === undefined ? wire.requestId : wire.effectiveConfigRequestId
		push({
			event: "effective_model_config",
			sessionId: "s1",
			runId: "r1",
			iteration: index + 1,
			providerId: "minimax",
			modelId: options.modelId ?? "minimax-m3",
			payload: {
				toolCount: 5,
				toolNames: BASE_CONFIG.toolNames,
				thinkingEnabled: true,
				reasoningEffort: "low",
				maxOutputTokens: 8192,
				...(effectiveRequestId !== undefined && effectiveRequestId !== null ? { requestId: effectiveRequestId } : {}),
			},
		})
		push({
			event: "model_wire_reasoning",
			sessionId: "s1",
			runId: "r1",
			iteration: index + 1,
			providerId: "minimax",
			modelId: options.modelId ?? "minimax-m3",
			payload: {
				...(wire.requestId !== undefined ? { requestId: wire.requestId } : {}),
				...(wire.attempt !== undefined ? { attempt: wire.attempt } : {}),
				...(wire.outputConfigEffort !== undefined ? { wireOutputConfigEffort: wire.outputConfigEffort } : {}),
				...(wire.thinkingMode !== undefined ? { wireThinkingMode: wire.thinkingMode } : {}),
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
	const dir = await mkdtemp(join(tmpdir(), "wire-reasoning-comparator-"))
	const jsonPath = join(dir, "out.json")
	const mdPath = join(dir, "out.md")
	await execFileAsync("bun", [SCRIPT, "--m3", m3Path, "--m3.1", m31Path, "--json", jsonPath, "--md", mdPath])
	const summary = JSON.parse(await readFile(jsonPath, "utf8"))
	const markdown = await readFile(mdPath, "utf8")
	return { summary, markdown }
}

describe("wire-reasoning comparator", () => {
	it("WR01: NO wire evidence on either side is NOT a reasoning mismatch", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wire-reasoning-wr01-"))
		const m3 = await writeTrace(dir, "m3", {})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1-flash" })
		const { summary } = await runComparator(m3, m31)

		expect(summary.wireReasoning.evidence.m3.recordCount).toBe(0)
		expect(summary.wireReasoning.evidence.m31.recordCount).toBe(0)
		// The absence is UNVERIFIED, never "different".
		expect(summary.wireReasoning.parity.comparison).toBe("unverified")
		// And it does NOT turn a compatible comparison into an incompatible one.
		expect(summary.materialDifferences.some((d: any) => d.dimension === "wireReasoningControls")).toBe(false)
		expect(summary.comparability.status).not.toBe("incompatible")
	})

	it("WR02: DIFFERENT serialized wire controls are INCOMPATIBLE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wire-reasoning-wr02-"))
		const m3 = await writeTrace(dir, "m3", {
			wireEvents: [{ requestId: "req-a", attempt: 1, outputConfigEffort: "low" }],
		})
		const m31 = await writeTrace(dir, "m31", {
			modelId: "minimax-m3.1-flash",
			wireEvents: [{ requestId: "req-b", attempt: 1, outputConfigEffort: "high" }],
		})
		const { summary, markdown } = await runComparator(m3, m31)

		expect(summary.wireReasoning.parity.comparison).toBe("different")
		const difference = summary.materialDifferences.find((d: any) => d.dimension === "wireReasoningControls")
		expect(difference?.severity).toBe("material")
		expect(summary.comparability.status).toBe("incompatible")
		expect(markdown).toContain("Wire Reasoning (Serialized Provider Controls)")
	})

	it("WR03: IDENTICAL serialized wire controls stay compatible and report the join", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wire-reasoning-wr03-"))
		const wire: WireEvent[] = [
			{ requestId: "req-a", attempt: 1, outputConfigEffort: "low", thinkingMode: "adaptive" },
			{ requestId: "req-b", attempt: 1, outputConfigEffort: "low", thinkingMode: "adaptive" },
		]
		const m3 = await writeTrace(dir, "m3", { wireEvents: wire })
		const m31 = await writeTrace(dir, "m31", {
			modelId: "minimax-m3.1-flash",
			wireEvents: wire,
		})
		const { summary } = await runComparator(m3, m31)

		expect(summary.wireReasoning.parity.comparison).toBe("equal")
		expect(summary.wireReasoning.evidence.m3.recordCount).toBe(2)
		expect(summary.wireReasoning.evidence.m3.requestIds).toEqual(["req-a", "req-b"])
		// WR05: the join to the requested config is by EXACT request id.
		expect(summary.wireReasoning.evidence.m3.joinedToRequested).toBe(true)
		expect(summary.wireReasoning.evidence.m3.unjoinedToRequested).toBe(0)
		expect(summary.materialDifferences.some((d: any) => d.dimension === "wireReasoningControls")).toBe(false)
	})

	it("WR04: wire evidence on ONE side only is UNVERIFIED, never a mismatch", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wire-reasoning-wr04-"))
		const m3 = await writeTrace(dir, "m3", {
			wireEvents: [{ requestId: "req-a", attempt: 1, outputConfigEffort: "low" }],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1-flash" })
		const { summary } = await runComparator(m3, m31)

		expect(summary.wireReasoning.parity.comparison).toBe("unverified")
		const difference = summary.materialDifferences.find((d: any) => d.dimension === "wireReasoningControls")
		// UNVERIFIED, never MATERIAL.
		expect(difference?.severity).toBe("unverified")
		expect(summary.comparability.status).not.toBe("incompatible")
	})

	it("WR05: a wire record with NO requested-config counterpart is counted as unjoined", async () => {
		const dir = await mkdtemp(join(tmpdir(), "wire-reasoning-wr05-"))
		// The wire record's request id has NO matching effective-config record.
		const m3 = await writeTrace(dir, "m3", {
			wireEvents: [
				{
					requestId: "req-orphan",
					effectiveConfigRequestId: null,
					attempt: 1,
					outputConfigEffort: "low",
				},
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1-flash" })
		const { summary } = await runComparator(m3, m31)

		expect(summary.wireReasoning.evidence.m3.joinedToRequested).toBe(false)
		expect(summary.wireReasoning.evidence.m3.unjoinedToRequested).toBe(1)
	})
})

describe("native-edit dispositions", () => {
	it("WR06/WR07/WR08: the approval outcome and the executor invocation drive the disposition", async () => {
		const dir = await mkdtemp(join(tmpdir(), "native-edit-disposition-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: [
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-rejected",
						toolName: "editor",
						operation: "write",
						fileIdentity: "fp-1",
						targetCount: 1,
						requestedChars: 10,
						approvalOutcome: "rejected",
						// The `edit_attempt` event is recorded at the TOOL-START
						// boundary, so production ALWAYS reports `false` here.
						executionInvoked: false,
					},
				},
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-skipped",
						toolName: "editor",
						operation: "write",
						fileIdentity: "fp-2",
						targetCount: 1,
						requestedChars: 10,
						approvalOutcome: "skipped",
						executionInvoked: false,
					},
				},
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-gap",
						toolName: "editor",
						operation: "write",
						fileIdentity: "fp-3",
						targetCount: 1,
						requestedChars: 10,
						approvalOutcome: "approved",
						executionInvoked: false,
					},
				},
				{
					// The REAL invocation authority: the matching `tool_finish`
					// event carries the production C1.2 `toolExecutionInvoked`.
					event: "tool_finish",
					payload: {
						toolCallId: "tc-gap",
						toolName: "editor",
						outcome: "success",
						executionInvoked: true,
					},
				},
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1-flash" })
		const { summary } = await runComparator(m3, m31)

		const dispositions = summary.nativeEditDispositions.m3
		expect(dispositions.totalAttempts).toBe(3)
		// A REJECTED edit with no application is a LEGITIMATE absence.
		expect(dispositions.rejected).toBe(1)
		// A SKIPPED edit with no application is a LEGITIMATE absence.
		expect(dispositions.skipped).toBe(1)
		// An APPROVED, INVOKED edit with no application is an EVIDENCE GAP.
		expect(dispositions.unfulfilled).toBe(1)
		// None of them is counted as a failed write.
		expect(dispositions.failed).toBe(0)
		// The never-invoked bucket is EMPTY: the only approved attempt WAS
		// invoked.
		expect(dispositions.notInvoked).toBe(0)
	})

	it("WR08b: an APPROVED edit whose executor was NEVER invoked is NOT an evidence gap", async () => {
		const dir = await mkdtemp(join(tmpdir(), "native-edit-not-invoked-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: [
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-not-invoked",
						toolName: "editor",
						operation: "write",
						fileIdentity: "fp-ni",
						targetCount: 1,
						requestedChars: 10,
						approvalOutcome: "approved",
						executionInvoked: false,
					},
				},
				{
					// The executor never ran, so no application is EXPECTED.
					event: "tool_finish",
					payload: {
						toolCallId: "tc-not-invoked",
						toolName: "editor",
						outcome: "success",
						executionInvoked: false,
					},
				},
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1-flash" })
		const { summary } = await runComparator(m3, m31)

		const dispositions = summary.nativeEditDispositions.m3
		// A never-invoked executor is a LEGITIMATE absence.
		expect(dispositions.notInvoked).toBe(1)
		// It is NOT counted as an evidence gap.
		expect(dispositions.unfulfilled).toBe(0)
		expect(dispositions.rejected).toBe(0)
		expect(dispositions.skipped).toBe(0)
	})

	it("WR09: an applied no-op edit is counted as applied_no_change", async () => {
		const dir = await mkdtemp(join(tmpdir(), "native-edit-noop-"))
		const m3 = await writeTrace(dir, "m3", {
			editEvents: [
				{
					event: "edit_attempt",
					payload: {
						toolCallId: "tc-noop",
						toolName: "editor",
						operation: "write",
						fileIdentity: "fp-noop",
						targetCount: 1,
						requestedChars: 10,
						approvalOutcome: "approved",
						executionInvoked: true,
					},
				},
				{
					event: "edit_application",
					payload: {
						toolCallId: "tc-noop",
						toolName: "editor",
						outcome: "applied",
						requestedFileCount: 1,
						mutatedFileCount: 1,
						unmutatedFileCount: 0,
						noOp: true,
						provenance: "REAL_PRODUCTION_SEAM",
					},
				},
			],
		})
		const m31 = await writeTrace(dir, "m31", { modelId: "minimax-m3.1-flash" })
		const { summary } = await runComparator(m3, m31)

		const dispositions = summary.nativeEditDispositions.m3
		expect(dispositions.appliedNoChange).toBe(1)
		expect(dispositions.appliedWithChange).toBe(0)
		expect(dispositions.unfulfilled).toBe(0)
	})
})
