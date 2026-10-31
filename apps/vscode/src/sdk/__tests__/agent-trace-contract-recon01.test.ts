/**
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01 — contract witnesses.
 *
 * These witnesses pin the `agent-trace/0.1` portable contract against REAL
 * ClineMM evidence. Where a REAL capture is available they use it; where a
 * negative control needs a shape the real capture does not contain, the
 * control is explicitly labelled `SYNTHETIC` and is a construction, not
 * evidence of live behaviour.
 *
 * COVERAGE OF THE ACT's WITNESS TABLE
 * -----------------------------------
 *   REAL-01  A real captured model start/finish normalizes without changing
 *            usage or durations.
 *   REAL-02  A real tool start/finish preserves authoritative identity.
 *   REAL-03  Provider wire controls remain distinct from requested controls.
 *   REAL-04  Compaction keeps the original token-count meaning and boundary.
 *   REAL-05  Edit application remains distinct from final retained workspace
 *            state.
 *   NEG-01   Missing request identity does not cause a fabricated join.
 *   NEG-02   Reused tool-call id in an unrelated owner cannot discharge
 *            another owner's call.
 *   NEG-03   A truncated trace cannot be reported as complete.
 *   NEG-04   Tool success cannot fabricate subprocess exit 0.
 *   NEG-05   Unknown source HEAD cannot become an observed artifact identity.
 *   PRIV-01  Normalized output contains no forbidden sensitive fields.
 *
 * THE REAL CAPTURE
 * ----------------
 * The witness reads the operator's REAL capture when it is present on disk:
 *
 *   $CLINE_MODEL_BEHAVIOR_TRACE_JSONL
 *
 * or, failing that, the default installed-extension path. When the capture
 * is ABSENT the REAL witnesses are SKIPPED with an explicit reason — they
 * never pass on synthetic data, because a synthetic pass would be a false
 * claim of real evidence.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import {
	classifyRunIdNamespace,
	filterPortablePayload,
	normalizeNativeRecord,
	normalizeNativeTrace,
	PORTABLE_TRACE_CONTRACT_VERSION,
	parseNativeTrace,
} from "../normalize-agent-trace"

// ============================================================================
// The REAL capture
// ============================================================================

/**
 * Locate the operator's REAL model-behavior capture.
 *
 * The capture is NOT committed to the repository (it is operator evidence), so
 * the witnesses locate it at runtime and SKIP the real-positive witnesses when
 * it is absent.
 */
function locateRealCapture(): string | undefined {
	const candidates: string[] = []
	const fromEnv = process.env.CLINE_MODEL_BEHAVIOR_TRACE_JSONL
	if (fromEnv) {
		candidates.push(fromEnv)
	}
	candidates.push(join(homedir(), ".vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/model-behavior-trace.jsonl"))
	candidates.push(join(homedir(), ".vscode/user-data/User/globalStorage/s1onique.clinemm/model-behavior-trace.jsonl"))
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) {
			return candidate
		}
	}
	return undefined
}

const REAL_CAPTURE_PATH = locateRealCapture()

/** Parse the REAL capture once, if it is available. */
const REAL = REAL_CAPTURE_PATH ? parseNativeTrace(readFileSync(REAL_CAPTURE_PATH, "utf8")) : undefined

/** The reason the REAL witnesses are skipped. A skipped witness is honest. */
const REAL_SKIP_REASON = REAL_CAPTURE_PATH ? undefined : "no REAL model-behavior capture is available on this machine"

// ============================================================================
// Helpers
// ============================================================================

type NativeRecord = NonNullable<typeof REAL>["records"][number]

/** Find the first native record with the given event type. */
function firstNative(parsed: NonNullable<typeof REAL>, event: string): NativeRecord {
	const found = parsed.records.find((record) => record.event === event)
	if (!found) {
		throw new Error(`the REAL capture has no ${event} record`)
	}
	return found
}

/** Normalize one native record with the standard options. */
function normalizeOne(record: NativeRecord, truncated = false) {
	const result = normalizeNativeRecord(record, {
		traceTruncated: truncated,
		harness: "cline",
	})
	if (!result.record) {
		throw new Error(`record ${record.seq} (${record.event}) did not normalize`)
	}
	return result.record
}

// ============================================================================
// REAL witnesses
// ============================================================================

describe.skipIf(!REAL)("agent-trace/0.1 REAL witnesses", () => {
	it("REAL-01: a real captured model start/finish normalizes without changing usage or durations", () => {
		const parsed = REAL!
		const start = firstNative(parsed, "model_request_start")
		const finish = firstNative(parsed, "model_request_finish")

		const portableStart = normalizeOne(start)
		const portableFinish = normalizeOne(finish)

		// The contract version is stamped on every record.
		expect(portableStart.contract).toBe(PORTABLE_TRACE_CONTRACT_VERSION)
		expect(portableFinish.contract).toBe(PORTABLE_TRACE_CONTRACT_VERSION)

		// The USAGE numbers are conserved EXACTLY.
		expect(portableFinish.payload.inputTokens).toBe(finish.payload.inputTokens)
		expect(portableFinish.payload.outputTokens).toBe(finish.payload.outputTokens)
		expect(portableFinish.payload.cacheReadTokens).toBe(finish.payload.cacheReadTokens)
		expect(portableFinish.payload.cacheWriteTokens).toBe(finish.payload.cacheWriteTokens)

		// The DURATION is conserved EXACTLY and is labelled with what it
		// measured, so a reader cannot mistake it for a wall-clock span of
		// the whole turn.
		expect(portableFinish.durationMs).toBe(finish.payload.requestDurationMs)
		expect(portableFinish.durationProvenance).toBe("provider_request_wall_clock")

		// The start record keeps its own facts distinct from the finish.
		expect(portableStart.payload.messageCount).toBe(start.payload.messageCount)
		expect(portableStart.payload.toolSchemaCount).toBe(start.payload.toolSchemaCount)

		// The SOURCE ORDER is preserved exactly.
		expect(portableStart.sourceOrder).toBe(start.seq)
		expect(portableFinish.sourceOrder).toBe(finish.seq)

		// The NATIVE EVENT IDENTITY is preserved.
		expect(portableStart.nativeEventId).toBe(start.seq)
		expect(portableStart.nativeEventType).toBe("model_request_start")
		expect(portableFinish.nativeEventType).toBe("model_request_finish")
	})

	it("REAL-02: a real tool start/finish preserves authoritative identity", () => {
		const parsed = REAL!
		const start = firstNative(parsed, "tool_start")
		const finish = firstNative(parsed, "tool_finish")

		const portableStart = normalizeOne(start)
		const portableFinish = normalizeOne(finish)

		// The tool-call identity is preserved EXACTLY on both sides.
		expect(portableStart.identity.toolCallId).toBe(start.payload.toolCallId)
		expect(portableFinish.identity.toolCallId).toBe(finish.payload.toolCallId)
		expect(portableStart.identity.toolCallId).toBe(portableFinish.identity.toolCallId)

		// The owner scope (run id + namespace) is preserved.
		expect(portableStart.identity.runId).toBe(start.runId)
		expect(portableFinish.identity.runId).toBe(finish.runId)
		expect(portableStart.identity.runIdNamespace).toBe(classifyRunIdNamespace(start.runId ?? ""))

		// The tool NAME and outcome are conserved.
		expect(portableStart.payload.toolName).toBe(start.payload.toolName)
		expect(portableFinish.payload.outcome).toBe(finish.payload.outcome)
		expect(portableFinish.durationMs).toBe(finish.payload.durationMs)
		expect(portableFinish.durationProvenance).toBe("tool_invocation_wall_clock")
	})

	it("REAL-03: provider wire controls remain distinct from requested controls", () => {
		const parsed = REAL!
		const request = firstNative(parsed, "model_request_start")
		const wire = parsed.records.find(
			(record) => record.event === "model_wire_reasoning" && typeof record.payload.requestId === "string",
		)
		if (!wire) {
			throw new Error("the REAL capture has no identified model_wire_reasoning record")
		}

		const portableRequest = normalizeOne(request)
		const portableWire = normalizeOne(wire)

		// The REQUESTED controls live on the request record.
		expect(portableRequest.payload.requestedThinking).toBe(request.payload.requestedThinking)
		expect(portableRequest.payload.requestedReasoningEffort).toBe(request.payload.requestedReasoningEffort)

		// The SERIALIZED wire controls live on the WIRE record.
		expect(portableWire.payload.wireThinkingMode).toBe(wire.payload.wireThinkingMode)
		expect(portableWire.payload.wireOutputConfigEffort).toBe(wire.payload.wireOutputConfigEffort)

		// The two are NOT merged: the wire record does not carry the
		// requested controls, and the request record does not carry the
		// serialized controls.
		expect(portableWire.payload.requestedThinking).toBeUndefined()
		expect(portableWire.payload.requestedReasoningEffort).toBeUndefined()
		expect(portableRequest.payload.wireThinkingMode).toBeUndefined()
		expect(portableRequest.payload.wireOutputConfigEffort).toBeUndefined()

		// The wire request id is carried as the ESTABLISHED join identity,
		// not as an iteration and not as a bare provider request id.
		expect(portableWire.identity.wireRequestId).toBe(wire.payload.requestId)
	})

	it("REAL-04: compaction keeps the original token-count meaning and boundary", () => {
		const parsed = REAL!
		const diagnostics = firstNative(parsed, "compaction_diagnostics")
		const portable = normalizeOne(diagnostics)

		// The token counts are conserved EXACTLY and keep their MEANING:
		// `requestInputTokens` is the INPUT size, `maxInputTokens` is the
		// budget, and `requestTriggerTokens` is the trigger threshold.
		expect(portable.payload.requestInputTokens).toBe(diagnostics.payload.requestInputTokens)
		expect(portable.payload.maxInputTokens).toBe(diagnostics.payload.maxInputTokens)
		expect(portable.payload.requestTriggerTokens).toBe(diagnostics.payload.requestTriggerTokens)

		// The COMPACTION BOUNDARY survives: the budget provenance and the
		// effective budget are both preserved.
		expect(portable.payload.effectiveMaxInputTokens).toBe(diagnostics.payload.effectiveMaxInputTokens)
		expect(portable.payload.inputBudgetSource).toBe(diagnostics.payload.inputBudgetSource)

		// A compaction that DID happen keeps its before/after boundary.
		const completed = parsed.records.find((record) => record.event === "compaction_completed")
		if (completed) {
			const portableCompleted = normalizeOne(completed)
			expect(portableCompleted.payload.tokensBefore).toBe(completed.payload.tokensBefore)
			expect(portableCompleted.payload.tokensAfter).toBe(completed.payload.tokensAfter)
			expect(portableCompleted.payload.tokensSaved).toBe(completed.payload.tokensSaved)
		}
	})

	it("REAL-05: edit application remains distinct from final retained workspace state", () => {
		const parsed = REAL!
		const application = parsed.records.find(
			(record) => record.event === "edit_application" && record.payload.outcome === "applied",
		)
		if (!application) {
			throw new Error("the REAL capture has no applied edit_application record")
		}
		const portableApplication = normalizeOne(application)

		// The APPLICATION says the write happened.
		expect(portableApplication.family).toBe("workspace")
		expect(portableApplication.payload.outcome).toBe("applied")
		expect(portableApplication.payload.mutatedFileCount).toBe(application.payload.mutatedFileCount)
		expect(portableApplication.evidenceQuality).toBe("REAL")

		// The APPLICATION does NOT claim the change was retained. A
		// retained-change claim lives ONLY on a checkpoint observation.
		expect(portableApplication.payload.retained).toBeUndefined()
		expect(portableApplication.payload.retainedFinalWorkspaceDelta).toBeUndefined()

		// The checkpoint observation — the ONLY authority for a retained
		// change — is a SEPARATE record with its own provenance.
		const checkpoint = parsed.records.find((record) => record.event === "edit_checkpoint_observation")
		if (checkpoint) {
			const portableCheckpoint = normalizeOne(checkpoint)
			expect(portableCheckpoint.nativeEventType).toBe("edit_checkpoint_observation")
			expect(portableCheckpoint.nativeEventType).not.toBe("edit_application")
			expect(portableCheckpoint.evidenceQuality).toBe("REAL")
		}
	})
})

// ============================================================================
// Negative controls (SYNTHETIC constructions)
// ============================================================================

describe("agent-trace/0.1 negative controls (SYNTHETIC)", () => {
	it("NEG-01: a missing request identity does not cause a fabricated join", () => {
		// SYNTHETIC control: a wire observation with NO requestId.
		const wireWithoutId = {
			seq: 9001,
			timestamp: "2026-10-31T00:00:00.000Z",
			traceId: "mbt_synthetic",
			event: "model_wire_reasoning",
			evidenceBoundary: "no_identity",
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			payload: { attempt: 1, httpMethod: "POST", wireOutputTokenLimit: 4096 },
		}
		const portable = normalizeOne(wireWithoutId)

		// The identity is NOT invented.
		expect(portable.identity.wireRequestId).toBeUndefined()
		expect(portable.identity.runId).toBeUndefined()
		expect(portable.identity.iteration).toBeUndefined()

		// The correlation incompleteness is preserved so a reader can tell
		// "not correlated" apart from "correlated to the wrong thing".
		expect(portable.correlationCompleteness).toBe("no_identity")
		expect(portable.sourceEvidenceBoundary).toBe("no_identity")
	})

	it("NEG-02: a reused tool-call id in an unrelated owner cannot discharge another owner's call", () => {
		// SYNTHETIC control: the SAME tool-call id under TWO different
		// owners (the exact hazard the ACT names).
		const sharedCallId = "call_shared_0001"
		const ownerAStart = {
			seq: 9101,
			timestamp: "2026-10-31T00:00:01.000Z",
			traceId: "mbt_synthetic",
			event: "tool_start",
			evidenceBoundary: "partial_identity",
			sessionId: "session-a",
			runId: "run_AAAAAAAA",
			iteration: 1,
			payload: { toolCallId: sharedCallId, toolName: "run_commands" },
		}
		const ownerBFinish = {
			seq: 9102,
			timestamp: "2026-10-31T00:00:02.000Z",
			traceId: "mbt_synthetic",
			event: "tool_finish",
			evidenceBoundary: "partial_identity",
			sessionId: "session-b",
			runId: "run_BBBBBBBB",
			iteration: 1,
			payload: {
				toolCallId: sharedCallId,
				toolName: "run_commands",
				outcome: "success",
				durationMs: 5,
			},
		}

		const portableA = normalizeOne(ownerAStart)
		const portableB = normalizeOne(ownerBFinish)

		// The shared tool-call id is preserved on BOTH records, but the
		// OWNER scopes differ, so the two are distinguishable and cannot
		// be collapsed into one call.
		expect(portableA.identity.toolCallId).toBe(sharedCallId)
		expect(portableB.identity.toolCallId).toBe(sharedCallId)
		expect(portableA.identity.runId).not.toBe(portableB.identity.runId)
		expect(portableA.identity.sessionId).not.toBe(portableB.identity.sessionId)

		// A pairing key built from the tool-call id ALONE is insufficient:
		// the owner scope must be part of it.
		const ownerScopedKey = (record: typeof portableA) =>
			`${record.identity.sessionId ?? ""}|${record.identity.runId ?? ""}|${record.identity.toolCallId ?? ""}`
		expect(ownerScopedKey(portableA)).not.toBe(ownerScopedKey(portableB))
	})

	it("NEG-03: a truncated trace cannot be reported as complete", () => {
		// SYNTHETIC control: a capture whose summary declares truncation.
		const synthetic = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_truncated",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					sessionId: "s",
					runId: "run_AAAAAAAA",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_truncated",
					dumpedAt: "2026-10-31T00:10:00.000Z",
					truncation: {
						truncated: true,
						droppedCount: 42,
						droppedFromSeq: 1,
						droppedToSeq: 42,
						totalRecorded: 100,
						retainedCount: 58,
						retainedBytes: 1024,
					},
				}),
			].join("\n"),
		)
		const { records, coverage } = normalizeNativeTrace(synthetic)

		expect(coverage.traceComplete).toBe(false)
		expect(coverage.truncation.truncated).toBe(true)
		expect(coverage.truncation.droppedCount).toBe(42)
		expect(coverage.truncation.droppedFromSeq).toBe(1)
		expect(coverage.truncation.droppedToSeq).toBe(42)

		// EVERY record carries the truncation flag, so no single record can
		// be read as a complete account.
		expect(records.length).toBe(1)
		expect(records[0].traceTruncated).toBe(true)
	})

	it("NEG-04: tool success cannot fabricate a subprocess exit code", () => {
		// SYNTHETIC control: a successful tool invocation.
		const successfulTool = {
			seq: 9201,
			timestamp: "2026-10-31T00:00:00.000Z",
			traceId: "mbt_synthetic",
			event: "tool_finish",
			evidenceBoundary: "partial_identity",
			sessionId: "s",
			runId: "run_AAAAAAAA",
			iteration: 1,
			payload: {
				toolCallId: "call_1",
				toolName: "run_commands",
				outcome: "success",
				executionInvoked: true,
				durationMs: 111,
				outputSizeChars: 2550,
			},
		}
		const portable = normalizeOne(successfulTool)

		// The tool outcome is preserved.
		expect(portable.family).toBe("tool")
		expect(portable.payload.outcome).toBe("success")

		// But NO process fact is invented. The record does not claim an
		// exit code, a signal, or a subprocess result.
		expect(portable.payload.exitCode).toBeUndefined()
		expect(portable.payload.exitStatus).toBeUndefined()
		expect(portable.payload.signal).toBeUndefined()
		expect(portable.payload.processExitCode).toBeUndefined()

		// And the portable family is `tool`, NOT `process`.
		expect(portable.family).not.toBe("process")
	})

	it("NEG-05: an unknown source HEAD cannot become an observed artifact identity", () => {
		// SYNTHETIC control: a config snapshot whose sourceHead is the
		// recorder's UNAVAILABLE sentinel.
		const config = {
			seq: 9301,
			timestamp: "2026-10-31T00:00:00.000Z",
			traceId: "mbt_synthetic",
			event: "model_config",
			evidenceBoundary: "synthesized",
			providerId: "minimax",
			modelId: "MiniMax-M3.1-Flash",
			payload: {
				selectedModelId: "MiniMax-M3.1-Flash",
				sourceHead: "UNAVAILABLE_FROM_TRACE",
				extensionVersion: "4.1.16-5a1c485cb",
				extensionBundleSha256: "086ff133ca70af9b1fa5fcacf8d22e3a32c2124badbc64280d2928c8fa6f0770",
			},
		}
		const portable = normalizeOne(config)

		// The unknown source HEAD stays unknown. It is NOT replaced with a
		// checkout HEAD, and it is NOT promoted to an artifact identity.
		expect(portable.payload.sourceHead).toBe("UNAVAILABLE_FROM_TRACE")
		expect(portable.payload.harnessSourceHead).toBeUndefined()
		expect(portable.payload.observedSourceHead).toBeUndefined()

		// The OBSERVED artifact identity (the bundle digest) is a SEPARATE
		// fact and is preserved as-is.
		expect(portable.payload.extensionBundleSha256).toBe("086ff133ca70af9b1fa5fcacf8d22e3a32c2124badbc64280d2928c8fa6f0770")
	})

	it("PRIV-01: the normalized output contains no forbidden sensitive fields", () => {
		// SYNTHETIC control: a payload carrying every forbidden shape.
		const hostile = {
			seq: 9401,
			timestamp: "2026-10-31T00:00:00.000Z",
			traceId: "mbt_synthetic",
			event: "tool_finish",
			evidenceBoundary: "partial_identity",
			sessionId: "s",
			runId: "run_AAAAAAAA",
			payload: {
				toolCallId: "call_1",
				toolName: "run_commands",
				prompt: "the user's secret prompt",
				reasoning: "the model's secret reasoning",
				arguments: { command: "rm -rf /" },
				stdout: "secret output",
				result: "secret result",
				password: "hunter2",
				absolutePath: "/Users/someone/private/file.ts",
				toolNames: ["run_commands", "editor"],
				unknownKey: "an unfamiliar field",
				outcome: "success",
			},
		}
		const portable = normalizeOne(hostile)

		for (const forbidden of ["prompt", "reasoning", "arguments", "stdout", "result", "password", "absolutePath"]) {
			expect(portable.payload[forbidden]).toBeUndefined()
		}

		// ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01: the
		// filter is now a family-scoped ALLOWLIST, so an unknown key is
		// dropped even though it is not on the deny list.
		expect(portable.payload.unknownKey).toBeUndefined()

		// The tool CATALOG is not exported as names; only its SIZE is.
		// (The catalog replacement applies to the `model` family, which is
		// where the recorder emits the catalog.)
		expect(portable.payload.toolNames).toBeUndefined()
		const catalog = filterPortablePayload({ toolNames: ["run_commands", "editor"] }, "model")
		expect(catalog.payload.toolNames).toBeUndefined()
		expect(catalog.payload.toolCatalogCount).toBe(2)
		expect(catalog.payload.toolCatalogDigest).toBeUndefined()

		// The safe facts survive.
		expect(portable.payload.outcome).toBe("success")
		expect(portable.identity.toolCallId).toBe("call_1")
	})

	it("the privacy filter drops absolute paths even under an allowed key", () => {
		const { payload, dropped } = filterPortablePayload(
			{
				fileIdentity: "/Users/someone/private/file.ts",
				executorCwdIdentity: "4d6629a7bae8e0b1b7ac6e804bd3ded6",
			},
			"workspace",
		)
		expect(payload.fileIdentity).toBeUndefined()
		expect(payload.executorCwdIdentity).toBe("4d6629a7bae8e0b1b7ac6e804bd3ded6")
		expect(dropped).toContain("fileIdentity")
	})
})

// ============================================================================
// ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01
// ============================================================================

/**
 * The CORR01 witnesses.
 *
 * The predecessor's `PRIV-01` witness only exercised forbidden fields at
 * the TOP level of a payload, so its success could not establish general
 * privacy safety. These witnesses close that gap:
 *
 *   P0-1  Privacy filtering is FAIL-CLOSED at every depth.
 *         The filter is now a schema-aware ALLOWLIST: an unfamiliar key
 *         does not escape merely because the filter has never seen it, and
 *         a forbidden key nested inside an object or an array element is
 *         dropped.
 *
 *   P0-2  A capture is COMPLETE only when it is provably exhaustive.
 *         A capture with no terminal summary, a summary that contradicts
 *         the observed records, or unreadable / unrecognized lines is
 *         explicitly INCOMPLETE — never silently complete. A legitimately
 *         truncated capture is PRESERVED as PARTIAL.
 *
 *   P1     Every dropped field is ACCOUNTED for.
 *
 * The RED state of each defect was demonstrated against the predecessor's
 * implementation before the fix; the GREEN state is what these witnesses
 * pin.
 */
describe("agent-trace/0.1 CORR01 witnesses", () => {
	// ------------------------------------------------------------------------
	// P0-1 — privacy filtering is fail-closed
	// ------------------------------------------------------------------------

	it("P0-1: a forbidden key nested inside an object does not escape", () => {
		const { payload, dropped } = filterPortablePayload({
			metadata: { password: "example-secret" },
		})
		expect(JSON.stringify(payload)).not.toContain("example-secret")
		expect(payload.metadata).toBeUndefined()
		// The drop is ACCOUNTED for.
		expect(dropped).toContain("metadata")
	})

	it("P0-1: a forbidden key nested inside an ARRAY ELEMENT does not escape", () => {
		const { payload, dropped } = filterPortablePayload({
			entries: [{ stdout: "private output" }],
		})
		expect(JSON.stringify(payload)).not.toContain("private output")
		expect(payload.entries).toBeUndefined()
		expect(dropped).toContain("entries")
	})

	it("P0-1: an UNFAMILIAR key does not escape merely because it is unknown", () => {
		// The fail-closed property: a key the filter has never seen is
		// DROPPED, not exported.
		const { payload, dropped } = filterPortablePayload({
			someBrandNewFieldNobodyAnticipated: "sensitive value",
		})
		expect(payload.someBrandNewFieldNobodyAnticipated).toBeUndefined()
		expect(dropped).toContain("someBrandNewFieldNobodyAnticipated")
	})

	it("P0-1: credential-like keys are dropped at EVERY depth", () => {
		const hostile = {
			metadata: {
				credential: "c",
				apiKey: "k",
				authorization: "Bearer x",
				cookie: "s",
				password: "p",
				secret: "s",
				env: { HOME: "/root" },
			},
			entries: [{ stdout: "o", stderr: "e", result: "r", command: "c" }],
			nested: { deeper: { deepest: { secret: "s" } } },
		}
		const { payload } = filterPortablePayload(hostile)
		const serialized = JSON.stringify(payload)
		for (const secret of ["c", "k", "Bearer x", "p", "/root", "o", "e", "r"]) {
			expect(serialized).not.toContain(secret)
		}
		// The whole hostile structure is gone.
		expect(payload.metadata).toBeUndefined()
		expect(payload.entries).toBeUndefined()
		expect(payload.nested).toBeUndefined()
	})

	it("P0-1: a permitted field with a nested safe value is PRESERVED", () => {
		// The fail-closed filter must not become a filter that destroys
		// legitimate evidence.
		const { payload } = filterPortablePayload(
			{
				fileMutations: [
					{
						fileIdentity: "abc123",
						contentVersionPre: "pre",
						contentVersionPost: "post",
						linesAdded: 10,
						linesRemoved: 2,
					},
				],
			},
			"workspace",
		)
		expect(payload.fileMutations).toEqual([
			{
				fileIdentity: "abc123",
				contentVersionPre: "pre",
				contentVersionPost: "post",
				linesAdded: 10,
				linesRemoved: 2,
			},
		])
	})

	it("P0-A: the tool catalog is exported as a COUNT only, never as names or a reproducible fingerprint", () => {
		const { payload, dropped } = filterPortablePayload({ toolNames: ["run_commands", "editor", "read_files"] }, "model")
		expect(payload.toolNames).toBeUndefined()
		expect(payload.toolCatalogCount).toBe(3)
		expect(payload.toolCatalogDigest).toBeUndefined()
		expect(dropped).toContain("toolNames")
	})

	it("P0-A: the coverage report explicitly marks catalog identity unavailable", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_keyid",
					event: "effective_model_config",
					evidenceBoundary: "partial_identity",
					payload: { toolCount: 2, toolNames: ["a", "b"] },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_keyid",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: false,
						droppedCount: 0,
						totalRecorded: 1,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.toolCatalogIdentity).toBe("UNAVAILABLE_FROM_TRACE")
		expect("toolCatalogDigestKeyId" in coverage).toBe(false)
	})

	it("P0-1: every dropped field is ACCOUNTED for", () => {
		const { dropped } = filterPortablePayload({
			metadata: { password: "x" },
			entries: [{ stdout: "y" }],
			unknownTopLevel: "z",
		})
		expect(dropped).toEqual(expect.arrayContaining(["metadata", "entries", "unknownTopLevel"]))
	})

	// ------------------------------------------------------------------------
	// P0-2 — completeness is fail-closed
	// ------------------------------------------------------------------------

	it("P0-2: a capture with NO terminal summary is NOT complete", () => {
		// This is the exact state an INTERRUPTED capture leaves behind.
		const parsed = parseNativeTrace(
			JSON.stringify({
				seq: 1,
				timestamp: "2026-10-31T00:00:00.000Z",
				traceId: "mbt_no_summary",
				event: "tool_start",
				evidenceBoundary: "partial_identity",
				sessionId: "s",
				runId: "run_AAAAAAAA",
				payload: { toolCallId: "call_1", toolName: "run_commands" },
			}),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).not.toBe("COMPLETE")
		expect(coverage.completeness.summaryPresent).toBe(false)
		expect(coverage.completeness.reasons.join(" ")).toContain("NO terminal summary")
	})

	it("P0-B: a summary with a different trace id and contradictory counts is NOT complete", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_record",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_summary",
					dumpedAt: "2026-10-31T00:00:01.000Z",
					truncation: {
						truncated: false,
						droppedCount: 39,
						totalRecorded: 40,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("INCOMPLETE")
		expect(coverage.completeness.reasons.join(" ")).toContain("does not match")
		expect(coverage.completeness.reasons.join(" ")).toContain("truncation state CONTRADICTS")
	})

	it("P0-B: summary counts that do not reconcile are NOT complete", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_count_mismatch",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_count_mismatch",
					dumpedAt: "2026-10-31T00:00:01.000Z",
					truncation: {
						truncated: false,
						droppedCount: 39,
						totalRecorded: 41,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("INCOMPLETE")
		expect(coverage.completeness.reasons.join(" ")).toContain("counts CONTRADICT")
	})

	it("P0-B: a capture whose summary CONTRADICTS its records is NOT complete", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_contradiction",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_contradiction",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: false,
						droppedCount: 0,
						totalRecorded: 99,
						retainedCount: 99,
						retainedBytes: 100,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("INCOMPLETE")
		expect(coverage.completeness.reasons.join(" ")).toContain("CONTRADICTS")
	})

	it("P0-2: malformed lines make the capture INCOMPLETE", () => {
		const parsed = parseNativeTrace(
			[
				"{ this is not json",
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_malformed",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_malformed",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: false,
						droppedCount: 0,
						totalRecorded: 1,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("INCOMPLETE")
		expect(coverage.completeness.unparsedLines).toBe(1)
		expect(coverage.completeness.reasons.join(" ")).toContain("could not be parsed")
	})

	it("P0-2: UNRECOGNIZED lines make the capture INCOMPLETE", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({ hello: "world" }),
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_unrecognized",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_unrecognized",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: false,
						droppedCount: 0,
						totalRecorded: 1,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.unrecognizedLines).toBe(1)
		expect(coverage.completeness.reasons.join(" ")).toContain("UNRECOGNIZED")
	})

	it("P0-2: a legitimately TRUNCATED capture is PRESERVED as PARTIAL, not discarded and not complete", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_partial",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_partial",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: true,
						droppedCount: 42,
						droppedFromSeq: 1,
						droppedToSeq: 42,
						totalRecorded: 43,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { records, coverage } = normalizeNativeTrace(parsed)
		// The retained records ARE preserved — they are real evidence.
		expect(records.length).toBe(1)
		expect(records[0].traceTruncated).toBe(true)
		// But they are NOT reported as complete.
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("PARTIAL")
		expect(coverage.completeness.reasons.join(" ")).toContain("LOWER BOUND")
		expect(coverage.truncation.droppedCount).toBe(42)
	})

	it("P0-2: a capture with no usable records at all is INVALID", () => {
		const parsed = parseNativeTrace(
			JSON.stringify({
				kind: "summary",
				traceId: "mbt_empty",
				dumpedAt: "2026-10-31T00:00:00.000Z",
				truncation: {
					truncated: false,
					droppedCount: 0,
					totalRecorded: 0,
					retainedCount: 0,
					retainedBytes: 0,
				},
			}),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("INVALID")
	})

	it("P0-2: a fully valid capture IS complete", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_good",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_good",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: false,
						droppedCount: 0,
						totalRecorded: 1,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		expect(coverage.traceComplete).toBe(true)
		expect(coverage.completeness.completeness).toBe("COMPLETE")
		expect(coverage.completeness.reasons).toEqual([])
	})

	it("P0-B: a legitimately truncated capture with consistent identity and counts remains PARTIAL", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_consistent_partial",
					event: "tool_start",
					evidenceBoundary: "partial_identity",
					payload: { toolCallId: "call_1", toolName: "run_commands" },
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_consistent_partial",
					dumpedAt: "2026-10-31T00:00:01.000Z",
					truncation: {
						truncated: true,
						droppedCount: 39,
						totalRecorded: 40,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { records, coverage } = normalizeNativeTrace(parsed)
		expect(records).toHaveLength(1)
		expect(records[0].traceTruncated).toBe(true)
		expect(coverage.traceComplete).toBe(false)
		expect(coverage.completeness.completeness).toBe("PARTIAL")
	})

	// ------------------------------------------------------------------------
	// P1 — dropped-field accounting
	// ------------------------------------------------------------------------

	it("P1: the coverage report ACCOUNTs for every field the filter dropped", () => {
		const parsed = parseNativeTrace(
			[
				JSON.stringify({
					seq: 1,
					timestamp: "2026-10-31T00:00:00.000Z",
					traceId: "mbt_accounting",
					event: "effective_model_config",
					evidenceBoundary: "partial_identity",
					payload: {
						toolCount: 22,
						toolNames: ["a", "b", "c"],
						reasoningEffort: "low",
					},
				}),
				JSON.stringify({
					kind: "summary",
					traceId: "mbt_accounting",
					dumpedAt: "2026-10-31T00:00:00.000Z",
					truncation: {
						truncated: false,
						droppedCount: 0,
						totalRecorded: 1,
						retainedCount: 1,
						retainedBytes: 10,
					},
				}),
			].join("\n"),
		)
		const { coverage } = normalizeNativeTrace(parsed)
		// The dropped `toolNames` is visible in the report, not silent.
		expect(Object.keys(coverage.privacyFilteredFields)).toContain("toolNames")
		expect(coverage.privacyFilteredFields.toolNames).toBe(1)
	})
})
