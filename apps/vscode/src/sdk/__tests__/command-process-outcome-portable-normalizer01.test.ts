/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01
 *
 * The PORTABLE-NORMALIZER gates plus the SYNTHETIC-CONTROL ablation.
 *
 * GATES COVERED
 * -------------
 *   G10/HIST — a frozen pre-bridge fixture normalizes with its ORIGINAL
 *               counts and completeness. The historical `run_commands` tool
 *               finishes are NOT retroactively reinterpreted as successful
 *               processes.
 *   PORT-1   — the new native event maps to the portable `process` family,
 *               which previously had NO native producer.
 *   PORT-2   — the portable payload carries the per-command identity and
 *               the observed exit code, and drops everything else.
 *   G9/PORT  — the portable allowlist drops hostile and unknown fields.
 *   C5/CTRL  — the SYNTHETIC-CONTROL ablation: the normalizer's behaviour
 *               over an AUTHORED fixture.
 *
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01-CORRECTION01:
 * C5 IS NOW EXPLICITLY A **SYNTHETIC CONTROL**.
 *
 * BRIDGE01 ran the C5 ablation over a hand-authored array and labelled it
 * "CAPTURED process evidence". That promoted a CONSTRUCTED fixture to
 * captured evidence. The fixture is retained — it is a perfectly good control
 * for the NORMALIZER's behaviour — but it is RENAMED and RELABELLED so it can
 * no longer be mistaken for real evidence, and it no longer carries the
 * necessity claim.
 *
 * The REAL-evidence necessity ablation lives in
 * `command-process-outcome-real-capture-ablation01.test.ts`, where it runs
 * over the REAL `ModelBehaviorTraceRecorder`'s OWN output, produced by the
 * REAL `run_commands` tool driving REAL subprocesses through the REAL
 * `CommandJobManager`.
 */

import { describe, expect, it } from "vitest"
import { filterPortablePayload, normalizeNativeRecord, normalizeNativeTrace, parseNativeTrace } from "../normalize-agent-trace"

// ============================================================================
// The FROZEN pre-bridge fixture.
//
// This is a PRE-BRIDGE capture: it contains `tool_finish` records for
// `run_commands` and NO `process_observation` records. The historical
// specimen reported 949 `run_commands` tool finishes, all reporting
// success, and ZERO process exit codes. This fixture reproduces that
// shape at a small, checkable scale.
//
// The witness pins that the normalizer does NOT reinterpret these records:
// they remain `tool` family, with no process facts.
// ============================================================================

const FROZEN_PRE_BRIDGE_CAPTURE = [
	{
		seq: 0,
		timestamp: "2026-01-01T00:00:00.000Z",
		traceId: "trace_frozen_pre_bridge",
		event: "tool_start",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: { toolCallId: "tc-1", toolName: "run_commands", origin: "model_requested" },
	},
	{
		seq: 1,
		timestamp: "2026-01-01T00:00:01.000Z",
		traceId: "trace_frozen_pre_bridge",
		event: "tool_finish",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: { toolCallId: "tc-1", toolName: "run_commands", outcome: "success" },
	},
	{
		seq: 2,
		timestamp: "2026-01-01T00:00:02.000Z",
		traceId: "trace_frozen_pre_bridge",
		event: "tool_start",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 2,
		payload: { toolCallId: "tc-2", toolName: "run_commands", origin: "model_requested" },
	},
	{
		seq: 3,
		timestamp: "2026-01-01T00:00:03.000Z",
		traceId: "trace_frozen_pre_bridge",
		event: "tool_finish",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 2,
		payload: { toolCallId: "tc-2", toolName: "run_commands", outcome: "success" },
	},
].map((record) => JSON.stringify(record))

describe("portable normalizer — pre-bridge historical compatibility (G10/HIST)", () => {
	it("G10: a frozen pre-bridge capture normalizes with its ORIGINAL counts and completeness", () => {
		const parsed = parseNativeTrace(FROZEN_PRE_BRIDGE_CAPTURE.join("\n"))
		expect(parsed.records).toHaveLength(4)
		expect(parsed.unparsedLines).toBe(0)

		const normalized = normalizeNativeTrace(parsed)
		expect(normalized.records).toHaveLength(4)
		expect(normalized.coverage.unnormalizedRecords).toBe(0)

		// The original event counts are UNCHANGED.
		expect(normalized.coverage.byNativeEventType["tool_start"]).toBe(2)
		expect(normalized.coverage.byNativeEventType["tool_finish"]).toBe(2)
		// The pre-bridge capture has NO process records.
		expect(normalized.coverage.byNativeEventType["process_observation"]).toBeUndefined()
		// The `process` family was NOT populated by this capture — the
		// coverage report only lists families that actually appear.
		expect(normalized.coverage.byFamily.process).toBeUndefined()
		// The tool family count is unchanged.
		expect(normalized.coverage.byFamily.tool).toBe(4)

		// The historical `run_commands` tool finishes are NOT retroactively
		// reinterpreted as successful processes: no portable record in this
		// capture carries a process fact.
		for (const record of normalized.records) {
			expect(record.family).toBe("tool")
			expect(record.payload.exitCode).toBeUndefined()
			expect(record.payload.terminalState).toBeUndefined()
			expect(record.payload.commandIndex).toBeUndefined()
		}
	})

	it("G10: the frozen capture's tool-finish outcome is still the AGGREGATE it always was", () => {
		const parsed = parseNativeTrace(FROZEN_PRE_BRIDGE_CAPTURE.join("\n"))
		const normalized = normalizeNativeTrace(parsed)
		const finishes = normalized.records.filter((r) => r.nativeEventType === "tool_finish")
		expect(finishes).toHaveLength(2)
		for (const finish of finishes) {
			expect(finish.payload.outcome).toBe("success")
		}
	})
})

describe("portable normalizer — the new process family (PORT-1/PORT-2)", () => {
	it("PORT-1: the native process observation maps to the portable `process` family", () => {
		const native = {
			seq: 10,
			timestamp: "2026-02-01T00:00:00.000Z",
			traceId: "trace_with_process",
			event: "process_observation",
			evidenceBoundary: "observed",
			sessionId: "session-1",
			runId: "run_abcdefgh",
			iteration: 3,
			payload: {
				toolCallId: "tc-9",
				commandIndex: 0,
				executionMode: "foreground",
				terminalState: "exited",
				exitCode: 0,
				provenance: "REAL_PRODUCTION_SEAM",
				source: "foreground_terminal_completion",
			},
		}
		const normalized = normalizeNativeRecord(native, { traceTruncated: false, harness: "cline" })
		expect(normalized.unnormalized).toBeUndefined()
		const portable = normalized.record
		expect(portable?.family).toBe("process")
		expect(portable?.nativeEventType).toBe("process_observation")
		expect(portable?.identity.sessionId).toBe("session-1")
		expect(portable?.identity.runId).toBe("run_abcdefgh")
		expect(portable?.identity.toolCallId).toBe("tc-9")
		expect(portable?.payload.commandIndex).toBe(0)
		expect(portable?.payload.terminalState).toBe("exited")
		expect(portable?.payload.exitCode).toBe(0)
		expect(portable?.payload.executionMode).toBe("foreground")
		expect(portable?.payload.provenance).toBe("REAL_PRODUCTION_SEAM")
	})

	it("PORT-2: a NONTERMINAL running handoff stays `running` and carries NO exit code", () => {
		const native = {
			seq: 11,
			timestamp: "2026-02-01T00:00:01.000Z",
			traceId: "trace_with_process",
			event: "process_observation",
			evidenceBoundary: "observed",
			sessionId: "session-1",
			runId: "run_abcdefgh",
			iteration: 3,
			payload: {
				toolCallId: "tc-9",
				commandIndex: 1,
				executionMode: "background",
				terminalState: "running",
				jobId: "cmd_abc123",
				provenance: "REAL_PRODUCTION_SEAM",
				source: "background_job_manager_handoff",
			},
		}
		const normalized = normalizeNativeRecord(native, { traceTruncated: false, harness: "cline" })
		expect(normalized.unnormalized).toBeUndefined()
		const portable = normalized.record
		expect(portable?.family).toBe("process")
		expect(portable?.payload.terminalState).toBe("running")
		expect(portable?.payload.exitCode).toBeUndefined()
		expect(portable?.payload.jobId).toBe("cmd_abc123")
	})

	it("G9/PORT: the portable allowlist drops hostile and UNKNOWN fields", () => {
		const { payload, dropped } = filterPortablePayload(
			{
				toolCallId: "tc-9",
				commandIndex: 0,
				terminalState: "exited",
				exitCode: 3,
				// Hostile / unknown injections:
				command: "rm -rf /",
				args: ["--danger"],
				stdout: "secret",
				stderr: "secret",
				env: { SECRET: "value" },
				absolutePath: "/Users/someone/private",
				unknownNested: { deeper: { secret: "value" } },
			},
			"process",
		)

		// The allowed structural facts survive.
		expect(payload.toolCallId).toBe("tc-9")
		expect(payload.commandIndex).toBe(0)
		expect(payload.terminalState).toBe("exited")
		expect(payload.exitCode).toBe(3)
		// Every forbidden / unknown key is DROPPED (not merely redacted).
		expect(payload.command).toBeUndefined()
		expect(payload.args).toBeUndefined()
		expect(payload.stdout).toBeUndefined()
		expect(payload.stderr).toBeUndefined()
		expect(payload.env).toBeUndefined()
		expect(payload.absolutePath).toBeUndefined()
		expect(payload.unknownNested).toBeUndefined()
		// The drops are ACCOUNTED FOR, so the loss is visible.
		expect(dropped.length).toBeGreaterThan(0)
	})
})

/**
 * ============================================================================
 * C5 — THE EXECUTED NECESSITY ABLATION
 * ============================================================================
 *
 * The ablation runs over CAPTURED process evidence (the portable records a
 * real run produced), NOT over a conceptual table.
 *
 * Q2 is the exact process-success classification:
 *
 *   "For each command executed by `run_commands`, did the actual process
 *    finish successfully, fail, remain running, or terminate for another
 *    reason?"
 *
 * BASELINE — with the process-observation records PRESENT, Q2 is answerable
 * per command.
 *
 * ABLATION — remove ONLY the process-observation category from the offline
 * analysis and recompute Q2. The exact process-success classification
 * becomes `CAPTURE_INSUFFICIENT`, while the TOOL-ACTIVITY SEQUENCE remains
 * fully observable.
 *
 * RESTORE — put the process records back and Q2 is answerable again.
 *
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01-CORRECTION01:
 * THIS SUITE IS A **SYNTHETIC CONTROL**, NOT REAL-EVIDENCE NECESSITY.
 *
 * The fixture below is AUTHORED — hand-written timestamps, hand-written
 * events, hand-written ordering. BRIDGE01 labelled it "CAPTURED" evidence and
 * the report described the ablation as running over "captured process
 * evidence"; that promoted a CONSTRUCTED fixture to captured evidence. The
 * label was wrong and the report claim was not supported.
 *
 * An ablation over an authored fixture can only prove that the NORMALIZER
 * classifies the fixture's shape. It cannot prove that the REAL producer
 * emits records with that shape, and it cannot prove that removing the real
 * category destroys the answerability of REAL evidence.
 *
 * The REAL-evidence necessity ablation now lives in
 * `command-process-outcome-real-capture-ablation01.test.ts`, where the
 * ablation runs over the REAL `ModelBehaviorTraceRecorder`'s OWN output
 * produced by the REAL `run_commands` tool and the REAL `CommandJobManager`.
 *
 * What THIS suite still establishes, and it is worth keeping: the NORMALIZER
 * maps the process family, the portable allowlist drops hostile fields, the
 * pre-bridge fixture is NOT retroactively reinterpreted, and the classifier
 * returns `CAPTURE_INSUFFICIENT` rather than inferring an outcome. Those are
 * NORMALIZER properties, and they are exactly what a synthetic control is
 * for.
 */

// ============================================================================
// The SYNTHETIC CONTROL fixture.
//
// AUTHORED, NOT CAPTURED. One `run_commands` tool call with FOUR commands
// plus the per-command process observations the bridge produces.
//
// Note the ordering: the authored `tool_finish` precedes the process
// observations. That is NOT the observed foreground execution order (a real
// foreground capture emits the process observation BEFORE the tool finishes).
// This suite does not assert the ordering, because the ordering is a
// property of REAL evidence — and REAL evidence is asserted in
// `command-process-outcome-real-capture-ablation01.test.ts`.
// ============================================================================

const SYNTHETIC_CONTROL_WITH_PROCESS = [
	{
		seq: 0,
		timestamp: "2026-03-01T00:00:00.000Z",
		traceId: "trace_captured",
		event: "tool_start",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: { toolCallId: "tc-1", toolName: "run_commands", origin: "model_requested" },
	},
	{
		seq: 1,
		timestamp: "2026-03-01T00:00:01.000Z",
		traceId: "trace_captured",
		event: "tool_finish",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: { toolCallId: "tc-1", toolName: "run_commands", outcome: "success" },
	},
	// command 0 → exited 0
	{
		seq: 2,
		timestamp: "2026-03-01T00:00:02.000Z",
		traceId: "trace_captured",
		event: "process_observation",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: {
			toolCallId: "tc-1",
			commandIndex: 0,
			executionMode: "foreground",
			terminalState: "exited",
			exitCode: 0,
			provenance: "REAL_PRODUCTION_SEAM",
			source: "foreground_terminal_completion",
		},
	},
	// command 1 → exited 3
	{
		seq: 3,
		timestamp: "2026-03-01T00:00:03.000Z",
		traceId: "trace_captured",
		event: "process_observation",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: {
			toolCallId: "tc-1",
			commandIndex: 1,
			executionMode: "foreground",
			terminalState: "exited",
			exitCode: 3,
			provenance: "REAL_PRODUCTION_SEAM",
			source: "foreground_terminal_completion",
		},
	},
	// command 2 → still running (nonterminal background handoff)
	{
		seq: 4,
		timestamp: "2026-03-01T00:00:04.000Z",
		traceId: "trace_captured",
		event: "process_observation",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: {
			toolCallId: "tc-1",
			commandIndex: 2,
			executionMode: "background",
			terminalState: "running",
			jobId: "cmd_captured_2",
			provenance: "REAL_PRODUCTION_SEAM",
			source: "background_job_manager_handoff",
		},
	},
	// command 3 → exit status NOT observed
	{
		seq: 5,
		timestamp: "2026-03-01T00:00:05.000Z",
		traceId: "trace_captured",
		event: "process_observation",
		evidenceBoundary: "observed",
		sessionId: "session-1",
		runId: "run_abcdefgh",
		iteration: 1,
		payload: {
			toolCallId: "tc-1",
			commandIndex: 3,
			executionMode: "foreground",
			terminalState: "unknown",
			provenance: "REAL_PRODUCTION_SEAM",
			source: "foreground_terminal_completion",
		},
	},
].map((record) => JSON.stringify(record))

/**
 * The Q2 classifier: the EXACT process-success classification, per command.
 *
 * Returns `CAPTURE_INSUFFICIENT` when the evidence does not carry the
 * per-command process facts — and NEVER invents an outcome.
 */
function classifyProcessSuccess(records: ReadonlyArray<{ nativeEventType: string; payload: Record<string, unknown> }>): {
	answerable: boolean
	perCommand: Map<number, string>
} {
	const perCommand = new Map<number, string>()
	for (const record of records) {
		if (record.nativeEventType !== "process_observation") {
			continue
		}
		const index = record.payload.commandIndex
		if (typeof index !== "number") {
			continue
		}
		const terminalState = record.payload.terminalState
		const exitCode = record.payload.exitCode
		if (terminalState === "exited" && typeof exitCode === "number") {
			perCommand.set(index, exitCode === 0 ? "exited_0" : `exited_nonzero_${exitCode}`)
		} else if (terminalState === "running") {
			perCommand.set(index, "running")
		} else {
			perCommand.set(index, String(terminalState ?? "unknown"))
		}
	}
	return { answerable: perCommand.size > 0, perCommand }
}

/**
 * The tool-ACTIVITY sequence — what remains observable WITHOUT the process
 * category: which tool calls ran, in what order, with what aggregate
 * outcome.
 */
function toolActivitySequence(records: ReadonlyArray<{ nativeEventType: string; payload: Record<string, unknown> }>): string[] {
	return records
		.filter((record) => record.nativeEventType === "tool_start" || record.nativeEventType === "tool_finish")
		.map((record) => `${record.nativeEventType}:${String(record.payload.toolName ?? "?")}`)
}

describe("C5 — SYNTHETIC CONTROL: the normalizer ablation over an AUTHORED fixture", () => {
	it("SYNTHETIC CONTROL BASELINE: over the AUTHORED fixture, Q2 is answerable per command", () => {
		const parsed = parseNativeTrace(SYNTHETIC_CONTROL_WITH_PROCESS.join("\n"))
		const normalized = normalizeNativeTrace(parsed)
		const q2 = classifyProcessSuccess(normalized.records)

		expect(q2.answerable).toBe(true)
		expect(q2.perCommand.get(0)).toBe("exited_0")
		expect(q2.perCommand.get(1)).toBe("exited_nonzero_3")
		expect(q2.perCommand.get(2)).toBe("running")
		expect(q2.perCommand.get(3)).toBe("unknown")
	})

	it("SYNTHETIC CONTROL ABLATION: removing ONLY the process category makes Q2 CAPTURE_INSUFFICIENT, while the tool-activity sequence stays observable", () => {
		const parsed = parseNativeTrace(SYNTHETIC_CONTROL_WITH_PROCESS.join("\n"))
		const normalized = normalizeNativeTrace(parsed)

		// The tool-activity sequence BEFORE the ablation.
		const activityBefore = toolActivitySequence(normalized.records)
		expect(activityBefore).toEqual(["tool_start:run_commands", "tool_finish:run_commands"])

		// ABLATE: remove ONLY the process-observation category.
		const ablated = normalized.records.filter((record) => record.nativeEventType !== "process_observation")
		expect(ablated).toHaveLength(normalized.records.length - 4)

		// Q2 is now INSUFFICIENT — and it is NOT answered by inference.
		const q2 = classifyProcessSuccess(ablated)
		expect(q2.answerable).toBe(false)
		expect(q2.perCommand.size).toBe(0)

		// The tool-activity sequence is UNCHANGED by the ablation.
		const activityAfter = toolActivitySequence(ablated)
		expect(activityAfter).toEqual(activityBefore)

		// The aggregate tool outcome still says "success" — which is
		// EXACTLY the defect the bridge removes: it cannot distinguish
		// command 1's nonzero exit from command 0's clean exit.
		const finish = ablated.find((record) => record.nativeEventType === "tool_finish")
		expect(finish?.payload.outcome).toBe("success")
	})

	it("SYNTHETIC CONTROL RESTORE: putting the process records back makes Q2 answerable again", () => {
		const parsed = parseNativeTrace(SYNTHETIC_CONTROL_WITH_PROCESS.join("\n"))
		const normalized = normalizeNativeTrace(parsed)
		const q2 = classifyProcessSuccess(normalized.records)
		expect(q2.answerable).toBe(true)
		expect(q2.perCommand.get(1)).toBe("exited_nonzero_3")
	})
})
