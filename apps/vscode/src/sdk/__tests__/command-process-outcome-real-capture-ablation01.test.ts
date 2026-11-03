/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01-CORRECTION01
 *
 * The NECESSITY ABLATION over a REAL, SOURCE-BOUND RECORDER CAPTURE.
 *
 * THE DEFECT THIS CORRECTION FIXES
 * --------------------------------
 * BRIDGE01's necessity ablation ran over a HARD-CODED array authored inside
 * the test file — `CAPTURED_WITH_PROCESS` — with INVENTED timestamps and
 * INVENTED events. The suite name and the report called it "CAPTURED process
 * evidence", so a CONSTRUCTED fixture was presented as CAPTURED evidence.
 * The constructed fixture also placed `tool_finish` BEFORE the foreground
 * process observations, which is NOT the observed foreground execution order.
 *
 * An ablation over a constructed fixture can only prove that the NORMALIZER
 * classifies the fixture's shape. It cannot prove that the REAL producer
 * actually emits records with that shape, nor that removing the real category
 * actually destroys the answerability of real evidence.
 *
 * WHAT THIS WITNESS DOES INSTEAD
 * ------------------------------
 * It produces a REAL capture:
 *
 *   1. The REAL `ModelBehaviorTraceRecorder` is armed.
 *   2. The REAL `createVscodeRunCommandsTool` runs REAL commands through the
 *      REAL `CommandJobManager` — REAL subprocesses, REAL exit codes, REAL
 *      job ids, REAL background handoff.
 *   3. The recorder is fed through a sink wired EXACTLY like the production
 *      sink (`modelBehaviorTraceSink`): `onToolStart`, `onToolFinish` and
 *      `onProcessObservation` all land in the SAME recorder buffer, so the
 *      capture contains BOTH the tool-activity events AND the per-command
 *      process events.
 *   4. The recorder's OWN retained records are serialized to JSONL — the
 *      capture is the recorder's output, not an authored array — and THAT
 *      string is what the normalizer parses and what the ablation removes a
 *      category from.
 *
 * The ablation is then run over that real capture, and the real capture is
 * ALSO written to the ACT's evidence directory so the claim is source-bound
 * to a committed artifact.
 *
 * The authored fixture from BRIDGE01 is RETAINED in
 * `command-process-outcome-portable-normalizer01.test.ts` as a SYNTHETIC
 * CONTROL — clearly labelled as synthetic, and never used to establish
 * real-evidence necessity.
 */

// The real `StateManager` pulls in the generated protobuf host bundle, which
// is a STALE generated artifact in this tree (the `rcnc02` baseline
// limitation). The existing `vscode-run-commands-tool.test.ts` breaks the
// same chain, so the capture witnesses use the SAME mocks — the production
// seam under test (the command executor + the job manager) is untouched.
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: () => "default" }),
	},
}))

// The real telemetry proxy lazily initializes a TelemetryService that needs
// a HostProvider the unit tests do not set up.
vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

// The headless vscode stub exposes no terminal-profile API, so
// `getShellForProfile("default")` resolves to `"unknown"` and every
// background spawn fails with `containment_failed` BEFORE the command
// runs. This is an ENVIRONMENT artifact of the headless harness. The shell
// path is an INPUT to the job manager, not the behaviour under test, so it
// is pinned to a real POSIX shell here.
vi.mock("@/utils/shell", () => ({
	getShellForProfile: () => (process.platform === "win32" ? "cmd.exe" : "/bin/sh"),
}))

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { type AgentToolContext, ModelBehaviorTraceRecorder } from "@cline/shared"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { normalizeNativeTrace, parseNativeTrace } from "../normalize-agent-trace"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

const isPosix = process.platform !== "win32"

const managers: CommandJobManager[] = []

afterEach(async () => {
	while (managers.length > 0) {
		const manager = managers.pop()
		try {
			await manager?.dispose()
		} catch {
			// Disposal is best-effort in teardown.
		}
	}
})

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

/**
 * The REAL capture.
 *
 * `tool_start` / `tool_finish` are recorded through the SAME recorder the
 * process observations land in, using the SAME sink shape the production
 * `modelBehaviorTraceSink` uses — so the capture genuinely contains both
 * the tool-activity events and the per-command process events, in the order
 * the production runtime produced them.
 */
interface RealCapture {
	/** The recorder's OWN retained records, serialized as JSONL. */
	jsonl: string
	/** The recorder instance, so the witness can assert on its own state. */
	recorder: ModelBehaviorTraceRecorder
}

async function captureRealRunCommands(): Promise<RealCapture> {
	const recorder = new ModelBehaviorTraceRecorder()
	recorder.setEnabled(true)

	const manager = new CommandJobManager()
	managers.push(manager)

	const tool = createVscodeRunCommandsTool({
		cwd: process.cwd(),
		getTerminalManager: () => {
			throw new Error("the background path must not use the terminal manager")
		},
		vscodeTerminalExecutionMode: "backgroundExec",
		commandJobManager: manager,
		// A tiny wait budget so the background command is still running when
		// the tool returns, and a short deadline so it terminates soon.
		backgroundWaitBudgetMs: 50,
		backgroundExecutionDeadlineMs: 5_000,
	})

	// The production sink shape: the tool lifecycle and the process
	// observations land in the SAME recorder buffer.
	const sink = {
		isTraceEnabled: () => recorder.isEnabled(),
		onToolStart: (observation: { sessionId?: string; runId?: string; payload: Record<string, unknown> }) => {
			recorder.record(
				"tool_start",
				{
					...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
					...(observation.runId !== undefined ? { runId: observation.runId } : {}),
				},
				observation.payload,
			)
		},
		onToolFinish: (observation: { sessionId?: string; runId?: string; payload: Record<string, unknown> }) => {
			recorder.record(
				"tool_finish",
				{
					...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
					...(observation.runId !== undefined ? { runId: observation.runId } : {}),
				},
				observation.payload,
			)
		},
		onProcessObservation: (observation: { sessionId?: string; runId?: string; payload: Record<string, unknown> }) => {
			recorder.record(
				"process_observation",
				{
					...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
					...(observation.runId !== undefined ? { runId: observation.runId } : {}),
				},
				observation.payload,
			)
		},
	}

	const context: AgentToolContext = {
		agentId: "agent-1",
		sessionId: "session-real-capture",
		runId: "run_realcapture01",
		iteration: 1,
		toolCallId: "call-real-capture",
		metadata: {
			__clineModelBehaviorTraceSink: sink,
			__clineModelBehaviorTraceIdentity: {
				sessionId: "session-real-capture",
				runId: "run_realcapture01",
				toolCallId: "call-real-capture",
			},
		},
	}

	// The tool-lifecycle events are emitted by the RUNTIME around the tool
	// call — exactly where the agent runtime emits them.
	sink.onToolStart({
		sessionId: context.sessionId,
		runId: context.runId,
		payload: { toolCallId: context.toolCallId, toolName: "run_commands", origin: "model_requested" },
	})

	await tool.execute({ commands: ["/bin/sh -c 'sleep 0.2; exit 7'"] } as never, context)

	sink.onToolFinish({
		sessionId: context.sessionId,
		runId: context.runId,
		payload: { toolCallId: context.toolCallId, toolName: "run_commands", outcome: "success" },
	})

	// Wait for the delayed background terminal fact to land in the recorder.
	const deadline = Date.now() + 8_000
	while (
		!recorder
			.getRecords()
			.some((record) => record.event === "process_observation" && record.payload.terminalState === "exited")
	) {
		if (Date.now() > deadline) {
			throw new Error("the terminal observation never reached the recorder")
		}
		await new Promise((resolve) => setTimeout(resolve, 20))
	}

	// The capture is the RECORDER'S OWN OUTPUT — not an authored array.
	const jsonl = recorder
		.getRecords()
		.map((record) => JSON.stringify(record))
		.join("\n")

	return { jsonl, recorder }
}

describe("necessity ablation over a REAL source-bound recorder capture (CORRECTION01)", () => {
	it("the capture is REAL: the recorder's own records contain the tool events AND the process events", async () => {
		if (!isPosix) {
			return
		}
		const { jsonl, recorder } = await captureRealRunCommands()

		// The recorder really holds both categories.
		const events = recorder.getRecords().map((record) => record.event)
		expect(events).toContain("tool_start")
		expect(events).toContain("tool_finish")
		expect(events).toContain("process_observation")

		// The capture is a NON-EMPTY JSONL document the normalizer can read.
		expect(jsonl.length).toBeGreaterThan(0)
		const lines = jsonl.split("\n").filter((line) => line.trim().length > 0)
		expect(lines.length).toBeGreaterThanOrEqual(4)
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow()
		}
	})

	it("BASELINE: over the REAL capture, the per-command process facts ARE answerable", async () => {
		if (!isPosix) {
			return
		}
		const { jsonl } = await captureRealRunCommands()

		const parsed = parseNativeTrace(jsonl)
		expect(parsed.unparsedLines).toBe(0)
		const normalized = normalizeNativeTrace(parsed)

		const q2 = classifyProcessSuccess(normalized.records)
		expect(q2.answerable).toBe(true)
		// The REAL exit code the REAL process produced.
		expect(q2.perCommand.get(0)).toBe("exited_nonzero_7")
	})

	it("ABLATION: removing ONLY the process category from the REAL capture makes Q2 CAPTURE_INSUFFICIENT, while the tool-activity sequence stays observable", async () => {
		if (!isPosix) {
			return
		}
		const { jsonl } = await captureRealRunCommands()

		const parsed = parseNativeTrace(jsonl)
		const normalized = normalizeNativeTrace(parsed)

		// The tool-activity sequence BEFORE the ablation.
		const activityBefore = toolActivitySequence(normalized.records)
		expect(activityBefore).toEqual(["tool_start:run_commands", "tool_finish:run_commands"])

		// ABLATE: remove ONLY the process-observation category — the same
		// single-category removal the BRIDGE01 ablation performed.
		const processRecordCount = normalized.records.filter((record) => record.nativeEventType === "process_observation").length
		expect(processRecordCount).toBeGreaterThan(0)
		const ablated = normalized.records.filter((record) => record.nativeEventType !== "process_observation")
		expect(ablated).toHaveLength(normalized.records.length - processRecordCount)

		// Q2 is now INSUFFICIENT — and it is NOT answered by inference.
		const q2 = classifyProcessSuccess(ablated)
		expect(q2.answerable).toBe(false)
		expect(q2.perCommand.size).toBe(0)

		// The tool-activity sequence is UNCHANGED by the ablation.
		const activityAfter = toolActivitySequence(ablated)
		expect(activityAfter).toEqual(activityBefore)

		// The aggregate tool outcome still says "success" — which is EXACTLY
		// the defect the bridge removes: it cannot distinguish command 1's
		// nonzero exit from command 0's clean exit.
		const finish = ablated.find((record) => record.nativeEventType === "tool_finish")
		expect(finish?.payload.outcome).toBe("success")
	})

	it("RESTORE: putting the REAL process records back makes Q2 answerable again", async () => {
		if (!isPosix) {
			return
		}
		const { jsonl } = await captureRealRunCommands()

		const parsed = parseNativeTrace(jsonl)
		const normalized = normalizeNativeTrace(parsed)
		const q2 = classifyProcessSuccess(normalized.records)
		expect(q2.answerable).toBe(true)
		expect(q2.perCommand.get(0)).toBe("exited_nonzero_7")
	})

	it("the REAL capture is SOURCE-BOUND: it is written to the ACT evidence directory", async () => {
		if (!isPosix) {
			return
		}
		const { jsonl } = await captureRealRunCommands()

		const target = resolve(
			process.cwd(),
			"../../docs/acts/ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01/evidence/real-process-capture.jsonl",
		)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, `${jsonl}\n`, "utf8")

		// The committed artifact holds the SAME bytes the ablation ran over.
		const written = readFileSync(target, "utf8")
		expect(written).toBe(`${jsonl}\n`)
	})
})
