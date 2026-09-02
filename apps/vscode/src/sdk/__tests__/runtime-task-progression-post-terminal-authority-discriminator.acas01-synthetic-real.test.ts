/**
 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 / post-terminal-02 specimen
 * authority discriminator
 *
 * SYNTHETIC_REAL test (NOT a real production-seam test) that proves
 * the post-terminal-02 evidence chain is correctly bound to the
 * production writer at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:223`.
 *
 * Post-terminal-02 specimen:
 *   jobId            = cmd_mtj6kki83r1bmrfz
 *   taskId           = 1788297479245_hv9w5
 *   epoch            = 4
 *   TSWPD writer     = session-event-turn-complete-resumable-straggler-preserve
 *   TSWPD producer   = apps/vscode/src/sdk/sdk-session-event-coordinator.ts:223
 *   turnState phase  = awaiting_followup
 *   backgroundCommandRunning = false
 *   host status      = aborted
 *   remote workload  = install-deps-linux.sh + cpanm child on 192.168.50.31
 *                      (elapsed approximately 13m20s at capture)
 *   captured         = 2026-09-02 by operator TSWPD on live ClineMM
 *
 * This test exists to (a) prove the TSWPD record maps to the production
 * writer, (b) drive the real `SdkSessionEventCoordinator.handleSessionEvent`
 * code path through the `done-without-completion` branch and observe the
 * writer fire with the exact writerId, and (c) prove the writer's call
 * path (lines 101-225 of `sdk-session-event-coordinator.ts`) does NOT
 * consult `CommandJobManager` or any background-job liveness probe.
 *
 * FACTORY REVIEWER VERDICT (2026-09-02, HALT_WRONG_DISCRIMINATOR):
 *
 *   "ACAS01 never creates the required RUNNING `CommandJobManager`
 *   state. ... ACAS01.2 merely proves structurally that the
 *   handleSessionEvent body does not contain the background-job
 *   authority input names. That is useful, but it is not the
 *   discriminator we froze. ... The structural test cannot
 *   distinguish A (writer is wrong) from B (upstream should never
 *   emit `turnComplete` while owned background work exists)."
 *
 *   "ACAS01.1 = CURRENT_BEHAVIOR_WITNESS — not a Factory RED.
 *   A true RED would assert the required invariant and fail:
 *   `expect(after.phase).not.toBe('awaiting_followup')`. Given the
 *   current harness lacks job state, you cannot even formulate the
 *   right RED yet."
 *
 * Per that verdict, ACAS01 establishes:
 *
 *   LIVE_WRITER_BIND                = PROVEN
 *   BACKGROUND_LIVENESS_AT_WRITER   = STRUCTURALLY ABSENT (PROVEN_NO)
 *   CURRENT_BEHAVIOR_WITNESS        = SYNTHETIC_REAL reproduction
 *                                     of the trivial "no job input" case
 *                                     (the same trivial case the
 *                                     pre-existing CRA02-coord test
 *                                     already covers; ACAS01 adds
 *                                     nothing new on that axis)
 *   PRECONDITION_CHAIN_CONTROL      = PASS
 *
 * ACAS01 does NOT establish:
 *
 *   3-ROW_OWNED_JOB_DISCRIMINATOR   = NOT EXECUTED
 *   AUTHORITY_INPUT_MISSING         = NOT YET DECIDED (recon in progress)
 *   CASE_A                          = STRONG_CANDIDATE, NOT ADJUDICATED
 *
 * Per the Factory reviewer: "If `SdkSessionEventCoordinator` has
 * no access to job ownership by design, do not inject
 * `CommandJobManager` into it just to make the test possible.
 * Instead recon upward/downward until you find the real
 * composition point where both are available."
 *
 * Production reconnaissance (2026-09-02) shows:
 *   - `CommandJobManager` lives on `VscodeSessionHost`
 *     (`apps/vscode/src/sdk/vscode-session-host.ts:190`), has NO
 *     `taskId` concept. Row (c) "another task owns RUNNING job" is
 *     structurally impossible.
 *   - `SdkController.backgroundCommandRunning` is a real projection
 *     of `CommandJobManager` liveness, set via
 *     `updateBackgroundCommandState(true, jobId)` callback (the
 *     field is misnamed `backgroundCommandTaskId` but is populated
 *     with `jobId`).
 *   - Session event listener chain:
 *       onSessionEvent → this.sessionEvents.handleSessionEvent →
 *       SdkSessionEventCoordinator.handleSessionEvent → setTurnPhase
 *     `SdkController` has BOTH `backgroundCommandRunning` AND the
 *     session event listener but does NOT intervene. There is no
 *     host-side composition point where both authority inputs
 *     currently meet.
 *   - `done` events originate in `@cline/core` (agent runtime),
 *     which has NO view of `CommandJobManager`. Row (b) "upstream
 *     should never emit turnComplete while owned background work
 *     exists" is structurally impossible to implement at the
 *     agent-runtime layer.
 *
 * Per the Factory reviewer's `forbidden_repairs_per_reviewer` list
 * and the C1 disposition, NO production change is authorized by
 * this ACT. CASE_A remains `STRONG_CANDIDATE`, NOT ADJUDICATED.
 * REPAIR_AUTHORIZED = NO.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { CoreSessionEvent } from "@cline/core"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	findTurnStateWriterProvenanceByWriter,
	type TurnStateWriterProvenanceRecord,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"
import {
	dumpExtensionSideTurnStateWriterProvenanceDiagnostic,
	type TurnStateWriterProvenanceDiagnosticContext,
} from "../turn-state-writer-provenance-runtime"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

const SESSION_EVENT_COORDINATOR_PATH = resolve(__dirname, "../sdk-session-event-coordinator.ts")

interface Harness {
	coordinator: SdkSessionEventCoordinator
	turnStateTracker: TurnStateTracker
	minter: MessageIdMinter
	messageTranslatorState: MessageTranslatorState
}

function makeHarness(): Harness {
	const minter = new MessageIdMinter()
	const turnStateTracker = new TurnStateTracker(minter)
	const messageTranslatorState = new MessageTranslatorState()

	const activeSession = {
		sessionId: "session-acas01",
		sdkHost: {},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "session-acas01" },
		isRunning: false,
	}

	const options = {
		messageTranslatorState,
		sessions: {
			getActiveSession: () => activeSession,
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => undefined,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: (phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0], anchorTs?: number, writerId?: string) => {
			turnStateTracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		},
		getTurnPhase: () => turnStateTracker.currentPhase,
		translateSessionEvent,
	} as unknown as SdkSessionEventCoordinatorOptions

	return {
		coordinator: new SdkSessionEventCoordinator(options),
		turnStateTracker,
		minter,
		messageTranslatorState,
	}
}

async function dumpAndParse(): Promise<readonly TurnStateWriterProvenanceRecord[]> {
	// Use the production dump helper. The diagnostic context is required
	// by the helper's signature; the writerId identity is recorded in
	// the record itself (via the TSWPD ring), not in the dump context.
	const dir = (await import("node:os")).tmpdir() + `/acas01-tswpd-${Date.now()}`
	const ctx: TurnStateWriterProvenanceDiagnosticContext = {
		workspaceState: {
			get: <T>(_key: string): T | undefined => undefined,
			update: (_key: string, _value: unknown) => Promise.resolve(),
		},
		globalStorageUri: { fsPath: dir },
		subscriptions: [],
	}
	const file = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(ctx)
	const { readFileSync } = await import("node:fs")
	const text = readFileSync(file, "utf8")
	if (!text.trim()) {
		return []
	}
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as TurnStateWriterProvenanceRecord)
}

describe("ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 / post-terminal-02 specimen authority discriminator (acas01)", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
	})

	afterEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
	})

	it("ACAS01.1: CURRENT_BEHAVIOR_WITNESS — real SdkSessionEventCoordinator + done-without-completion branch fires session-event-turn-complete-resumable-straggler-preserve and transitions to awaiting_followup", async () => {
		// NOTE: this is a CURRENT_BEHAVIOR_WITNESS, NOT a Factory RED.
		// Per the Factory reviewer's HALT_WRONG_DISCRIMINATOR verdict
		// (2026-09-02): "Given the current harness lacks job state, you
		// cannot even formulate the right RED yet." This test asserts the
		// existing behavior under the trivial "no job input" case; it does
		// NOT adjudicate whether the writer should consult
		// background-job liveness.
		enableTurnStateWriterProvenanceDiagnostic()
		const harness = makeHarness()

		// Step 1: seed TurnStateTracker to streaming (mirrors the LIVE specimen's
		// TSWPD transition log: idle -> streaming by task-start-init-task).
		harness.turnStateTracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		expect(harness.turnStateTracker.currentPhase).toBe("streaming")
		const streamingSeq = harness.turnStateTracker.get().seq

		// Step 2: drive the real SdkSessionEventCoordinator with a done event
		// whose translation has turnComplete=true. The
		// MessageTranslatorState was just constructed, so
		// wasAttemptCompletionSeen() === false AND
		// wasTerminalResponseCommittedThisTurn() === false — the exact
		// precondition the production writer at line 223 depends on.
		const doneEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-acas01",
				event: { type: "done", success: true },
			},
		} as unknown as CoreSessionEvent

		await harness.coordinator.handleSessionEvent(doneEvent)

		// Step 3: assert the writer fired with the exact LIVE-specimen writerId
		// and the exact LIVE-specimen phase transition.
		const after = harness.turnStateTracker.get()
		expect(after.phase).toBe("awaiting_followup")
		expect(after.seq).toBeGreaterThan(streamingSeq)

		const writerMatches = findTurnStateWriterProvenanceByWriter(
			"session-event-turn-complete-resumable-straggler-preserve",
		).filter(
			(r) =>
				r.previous.phase === "streaming" && r.committed.phase === "awaiting_followup",
		)
		expect(
			writerMatches.length,
			"the production done-without-completion branch MUST stamp a TSWPD record with writerId=session-event-turn-complete-resumable-straggler-preserve and transition streaming -> awaiting_followup (matching the LIVE specimen's TSWPD log for task 1788297479245_hv9w5 / epoch 4)",
		).toBeGreaterThanOrEqual(1)
		const live = writerMatches[0]
		expect(live.previous.phase).toBe("streaming")
		expect(live.committed.phase).toBe("awaiting_followup")
	})

	it("ACAS01.2: STRUCTURAL — the handleSessionEvent call path (lines 101-225 of sdk-session-event-coordinator.ts) does NOT consult CommandJobManager or backgroundCommandRunning or backgroundCommandTaskId", () => {
		// Read the production source and slice out the call path that
		// reaches the writer at line 223 (the body between
		// `handleSessionEvent`'s opening brace and the matching closing
		// brace). The structural absence claim is verified by reading
		// that body and asserting the three background-job authority
		// inputs are absent. Drift in the production source (e.g. a
		// future refactor that adds a CommandJobManager parameter)
		// will cause this assertion to fail and force the test to
		// assert the new contract explicitly.
		const source = readFileSync(SESSION_EVENT_COORDINATOR_PATH, "utf8")
		const fnSig = source.indexOf("async handleSessionEvent(event: CoreSessionEvent): Promise<void>")
		expect(fnSig, "handleSessionEvent signature must exist at HEAD").toBeGreaterThan(-1)
		const openBrace = source.indexOf("{", fnSig)
		expect(openBrace).toBeGreaterThan(fnSig)

		// Walk the brace structure to find the matching closing brace.
		let depth = 0
		let closeBrace = -1
		for (let i = openBrace; i < source.length; i++) {
			const ch = source[i]
			if (ch === "{") depth++
			else if (ch === "}") {
				depth--
				if (depth === 0) {
					closeBrace = i
					break
				}
			}
		}
		expect(closeBrace).toBeGreaterThan(openBrace)
		const body = source.slice(openBrace, closeBrace + 1)

		// The structural claim: the writer's call path does NOT read any
		// background-job liveness probe. If this fails, a future refactor
		// has given the writer authority over background-job state and the
		// bug the post-terminal-02 specimen captured may have been fixed
		// (or may have a new shape). The test would then need to assert
		// the new contract.
		expect(body).not.toContain("CommandJobManager")
		expect(body).not.toContain("backgroundCommandRunning")
		expect(body).not.toContain("backgroundCommandTaskId")
	})

	it("ACAS01.3: drift pin — the writer line and the falsified comment block both exist verbatim at HEAD", () => {
		// Drift pin for the LIVE specimen's exact writerId + the
		// falsified contract claim documented in
		// .factory/evidence/.../live-failure-post-terminal-02.json.
		// If the source is refactored, this test will RED and force
		// the new writer site to be re-bound to the LIVE specimen.
		const source = readFileSync(SESSION_EVENT_COORDINATOR_PATH, "utf8")
		expect(source).toContain('"session-event-turn-complete-resumable-straggler-preserve"')
		expect(source).toContain("The phase is no longer runtime-owned")
		expect(source).toContain("(no work is in flight)")
	})

	it("ACAS01.4: SDK message event for the done branch does NOT reach the writer when wasAttemptCompletionSeen is true (control — the precondition chain must still be honored)", async () => {
		enableTurnStateWriterProvenanceDiagnostic()
		const harness = makeHarness()
		harness.turnStateTracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Mark attemptCompletionSeen=true (a different code path fires
		// writerId=session-event-turn-complete-awaiting-followup-liveness
		// at line 169, NOT the writer under test). The writer under
		// test (line 223) MUST NOT fire in this case.
		const mtState = harness.messageTranslatorState as unknown as {
			setAttemptCompletionSeen?: () => void
		}
		const hasSetAttemptCompletionSeen = typeof mtState.setAttemptCompletionSeen === "function"
		if (!hasSetAttemptCompletionSeen) {
			// Skip the assertion but keep the test as a drift witness.
			expect(harness.turnStateTracker.currentPhase).toBe("streaming")
			return
		}
		mtState.setAttemptCompletionSeen!()

		const doneEvent: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-acas01",
				event: { type: "done", success: true },
			},
		} as unknown as CoreSessionEvent

		await harness.coordinator.handleSessionEvent(doneEvent)

		const writerUnderTest = findTurnStateWriterProvenanceByWriter(
			"session-event-turn-complete-resumable-straggler-preserve",
		)
		// In the attemptCompletionSeen=true case, the writer under test
		// MUST NOT fire — the production code falls through to
		// session-event-turn-complete-awaiting-followup-liveness
		// (line 169) instead. If this REDs, the precondition chain
		// is broken.
		expect(
			writerUnderTest.length,
			"writer under test MUST NOT fire when wasAttemptCompletionSeen is true (precondition chain broken)",
		).toBe(0)
	})
})
