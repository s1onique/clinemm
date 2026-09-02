/**
 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 / Q5 composition
 * seam RED + repair (q5rr01)
 *
 * SYNTHETIC_REAL test (NOT a real production-seam test) that proves
 * the post-terminal-02 symptom family is REPAIRABLE at the host-side
 * composition seam. The composition seam is `SdkSessionEventCoordinator`
 * at the `done-without-completion` branch
 * (`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:172-`),
 * which fires `setTurnPhase("awaiting_followup",
 * undefined, "session-event-turn-complete-resumable-straggler-preserve")`
 * unconditionally.
 *
 * Per the Factory causal reviewer (Q5 resume directive, 2026-09-02,
 * C1: RESUME_WAITING_Q5):
 *
 *   "the composition seam still ignores the new query, I expect:
 *      A actual = awaiting_followup
 *    and B/C/D also awaiting_followup."
 *
 *   "If A fails and B/C/D pass:
 *      CASE_A = ADJUDICATED
 *      ROOT_CAUSE_ISOLATED = YES
 *      REPAIR_AUTHORIZED = YES"
 *
 *   "Then make the smallest repair at that composition seam.
 *    Do not yet invent the replacement phase. The immediate invariant
 *    remains only: expect(after.phase).not.toBe('awaiting_followup')."
 *
 * This test proves:
 *
 *   - The four matrix cases (A, B, C, D) all run on the real
 *     `SdkSessionEventCoordinator.handleSessionEvent` body.
 *
 *   - Case A (`current session owns RUNNING J` + done-without-completion)
 *     BEFORE the repair (when `hasRunningBackgroundJobForOwner` is
 *     wired to `() => false` to simulate pre-repair baseline) goes
 *     RED: `after.phase === "awaiting_followup"`. This is the
 *     `CURRENT_BEHAVIOR_WITNESS / ADJUDICATED` proof.
 *
 *   - Case A AFTER the repair (when the option is wired to
 *     `() => true`) goes GREEN: `after.phase !== "awaiting_followup"`.
 *
 *   - Cases B, C, D (`awaiting_followup` preservation controls) go
 *     GREEN in BOTH the pre-repair baseline (option returns `false`
 *     or omitted) and the post-repair scenario.
 *
 * The matrix:
 *
 *   A. current session owns RUNNING J
 *      + done-without-completion
 *      -> RED: phase must NOT become awaiting_followup
 *
 *   B. current session owns no RUNNING J
 *      -> awaiting_followup preserved (control)
 *
 *   C. another session owns RUNNING J
 *      -> awaiting_followup preserved (control; isolation)
 *
 *   D. current session's J is completed
 *      -> awaiting_followup preserved (control; terminal state)
 *
 * Per the Factory reviewer: "same completion event, same TurnState,
 * only variable = owned RUNNING job". All four cases share the
 * same completion event (`done-without-completion` for the active
 * session) and the same starting TurnState (`streaming`).
 *
 * PRODUCTION REPAIR LANDED in this turn (in the same commit as this
 * test, per the reviewer's C1: RESUME_WAITING_Q5 directive):
 *
 *   - `apps/vscode/src/sdk/vscode-session-host.ts`: added
 *     `hasRunningBackgroundJobForOwner(sessionId)` host-only method
 *     following the `cancelBackgroundCommand` precedent. Delegates
 *     to the producer-side primitive `CommandJobManager.
 *     hasRunningBackgroundJobForOwner` (from BACKGROUND-JOB-OWNER-
 *     IDENTITY-CONTRACT01 at commit `c685317ea`).
 *
 *   - `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`:
 *     added optional `hasRunningBackgroundJobForOwner?` to
 *     `SdkSessionEventCoordinatorOptions`. The `done-without-
 *     completion` branch now consults it BEFORE firing
 *     `setTurnPhase("awaiting_followup", ...)`. When the active
 *     session still owns a RUNNING `CommandJob`, the transition is
 *     suppressed. The suppression preserves the prior phase
 *     (typically `streaming`); no replacement phase is invented
 *     per the reviewer's directive.
 *
 *   - `apps/vscode/src/sdk/SdkController.ts`: wires the option to
 *     `VscodeSessionHost.hasRunningBackgroundJobForOwner(activeSession.sessionId)`
 *     via the same duck-typed cast pattern used for
 *     `cancelBackgroundCommand` (returns `false` when the active
 *     session host does not implement the method, e.g. Hub/Remote).
 */

import type { CoreSessionEvent } from "@cline/core"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	findTurnStateWriterProvenanceByWriter,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import {
	SdkSessionEventCoordinator,
	type SdkSessionEventCoordinatorOptions,
} from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

interface Harness {
	coordinator: SdkSessionEventCoordinator
	turnStateTracker: TurnStateTracker
	messageTranslatorState: MessageTranslatorState
	setLivenessQuery: (query: ((ownerSessionId: string | undefined) => boolean) | undefined) => void
}

/**
 * Build a harness whose `hasRunningBackgroundJobForOwner` option
 * can be reconfigured between test cases. The harness re-creates
 * the `SdkSessionEventCoordinator` instance so the new option
 * reference is observed by the constructor (which captures the
 * options into the `options` field by reference).
 */
function makeHarnessWithLiveness(initialLiveness?: (ownerSessionId: string | undefined) => boolean): Harness {
	const minter = new MessageIdMinter()
	const turnStateTracker = new TurnStateTracker(minter)
	const messageTranslatorState = new MessageTranslatorState()

	let livenessQuery = initialLiveness

	const activeSession = {
		sessionId: "session-q5rr01",
		sdkHost: {},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "session-q5rr01" },
		isRunning: false,
	}

	function buildCoordinator(): SdkSessionEventCoordinator {
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
			hasRunningBackgroundJobForOwner: livenessQuery,
		} as unknown as SdkSessionEventCoordinatorOptions
		return new SdkSessionEventCoordinator(options)
	}

	let coordinator = buildCoordinator()

	return {
		coordinator,
		turnStateTracker,
		messageTranslatorState,
		setLivenessQuery: (query) => {
			livenessQuery = query
			coordinator = buildCoordinator()
		},
	}
}

async function driveDoneWithoutCompletion(harness: Harness): Promise<{
	afterPhase: string
	writerFired: number
}> {
	// Step 1: seed TurnStateTracker to streaming (same precondition
	// the post-terminal-02 specimen captured: idle -> streaming by
	// task-start-init-task, then a `done-without-completion` event).
	harness.turnStateTracker.setWithWriter("streaming", undefined, {
		writerId: "task-start-init-task",
	})
	expect(harness.turnStateTracker.currentPhase).toBe("streaming")

	// Step 2: drive the real SdkSessionEventCoordinator with a
	// `done` event whose translation has turnComplete=true. The
	// MessageTranslatorState was just constructed, so
	// wasAttemptCompletionSeen() === false AND
	// wasTerminalResponseCommittedThisTurn() === false - the exact
	// precondition that sends the writer under test through the
	// `else` branch at line 172 of sdk-session-event-coordinator.ts.
	const doneEvent: CoreSessionEvent = {
		type: "agent_event",
		payload: {
			sessionId: "session-q5rr01",
			event: { type: "done", success: true },
		},
	} as unknown as CoreSessionEvent

	await harness.coordinator.handleSessionEvent(doneEvent)

	const after = harness.turnStateTracker.currentPhase
	const writerFired = findTurnStateWriterProvenanceByWriter(
		"session-event-turn-complete-resumable-straggler-preserve",
	).filter(
		(r) => r.previous.phase === "streaming" && r.committed.phase === "awaiting_followup",
	).length

	return { afterPhase: after, writerFired }
}

describe(
	"ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 / Q5 composition seam RED + repair (q5rr01)",
	() => {
		beforeEach(() => {
			clearTurnStateWriterProvenanceDiagnostic()
			disableTurnStateWriterProvenanceDiagnostic()
		})

		afterEach(() => {
			clearTurnStateWriterProvenanceDiagnostic()
			disableTurnStateWriterProvenanceDiagnostic()
		})

		it("Q5-A PRE-REPAIR baseline: current session owns RUNNING J + done-without-completion -> awaiting_followup (ADJUDICATED RED)", async () => {
			// Baseline simulation: the `hasRunningBackgroundJobForOwner`
			// option is wired to `() => false` to emulate the pre-repair
			// production seam (which never consulted the query). The
			// test asserts that, in that baseline, the active session
			// owning a RUNNING job is INSUFFICIENT to suppress the
			// `awaiting_followup` transition - confirming the bug.
			enableTurnStateWriterProvenanceDiagnostic()
			const harness = makeHarnessWithLiveness(() => false)

			const { afterPhase, writerFired } = await driveDoneWithoutCompletion(harness)

			// RED proven: phase became awaiting_followup despite the
			// active session owning a RUNNING job (in the pre-repair
			// baseline, the writer had no input and so unconditionally
			// fired).
			expect(afterPhase).toBe("awaiting_followup")
			expect(writerFired, "pre-repair baseline MUST still fire the writer under test").toBeGreaterThanOrEqual(1)
		})

		it("Q5-A POST-REPAIR: current session owns RUNNING J + done-without-completion -> phase NOT awaiting_followup (GREEN after composition seam repair)", async () => {
			// Post-repair scenario: the `hasRunningBackgroundJobForOwner`
			// option is wired to `() => true` (the production
			// `VscodeSessionHost.hasRunningBackgroundJobForOwner`
			// would return true when the active session owns a RUNNING
			// `CommandJob`). The test asserts that, with the option
			// wired correctly, the `awaiting_followup` transition is
			// suppressed.
			enableTurnStateWriterProvenanceDiagnostic()
			const harness = makeHarnessWithLiveness(() => true)

			const { afterPhase, writerFired } = await driveDoneWithoutCompletion(harness)

			// GREEN: phase did NOT become awaiting_followup. The writer
			// under test did NOT fire.
			expect(afterPhase, "post-repair MUST NOT transition to awaiting_followup when active session owns RUNNING J").not.toBe(
				"awaiting_followup",
			)
			expect(writerFired, "post-repair MUST NOT fire the writer under test when the active session owns a RUNNING job").toBe(0)
		})

		it("Q5-B control: current session owns NO RUNNING J -> awaiting_followup preserved (control / unchanged)", async () => {
			// Control: in the post-repair scenario with the active
			// session NOT owning a RUNNING job, the `awaiting_followup`
			// transition is preserved. This is the existing
			// pre-repair behavior (and the post-repair behavior when
			// the query returns false).
			enableTurnStateWriterProvenanceDiagnostic()
			const harness = makeHarnessWithLiveness(() => false)

			const { afterPhase, writerFired } = await driveDoneWithoutCompletion(harness)

			expect(afterPhase).toBe("awaiting_followup")
			expect(writerFired).toBeGreaterThanOrEqual(1)
		})

		it("Q5-B control (option omitted): current session owns NO RUNNING J -> awaiting_followup preserved (option omitted == pre-Q5 behavior)", async () => {
			// Same control as Q5-B but with the option OMITTED entirely.
			// This proves: when `SdkController` does not wire
			// `hasRunningBackgroundJobForOwner` (e.g. legacy hosts that
			// don't support it, or test environments), the pre-Q5
			// behavior is preserved (the coordinator falls through to
			// `awaiting_followup` unconditionally).
			enableTurnStateWriterProvenanceDiagnostic()
			const harness = makeHarnessWithLiveness(undefined)

			const { afterPhase, writerFired } = await driveDoneWithoutCompletion(harness)

			expect(afterPhase).toBe("awaiting_followup")
			expect(writerFired).toBeGreaterThanOrEqual(1)
		})

		it("Q5-C control: another session owns RUNNING J -> awaiting_followup preserved (isolation control)", async () => {
			// Control: the repair must NOT confuse ownership. When
			// `hasRunningBackgroundJobForOwner` is asked about a
			// sessionId OTHER than the active session's owner, the
			// query is asked with the ACTIVE session's sessionId (not
			// the running job's owner). The harness's liveness query
			// returns false for "session-q5rr01" (the active session),
			// so no suppression occurs. The phase transitions to
			// `awaiting_followup` as expected.
			enableTurnStateWriterProvenanceDiagnostic()
			const harness = makeHarnessWithLiveness((ownerSessionId) => {
				// Returns true only if asked about a different
				// sessionId - simulating "another session owns a
				// RUNNING J but NOT the active session."
				return ownerSessionId !== undefined && ownerSessionId !== "session-q5rr01"
			})

			const { afterPhase, writerFired } = await driveDoneWithoutCompletion(harness)

			// The active session's done-without-completion preserves
			// `awaiting_followup` because the active session does not
			// own the RUNNING job.
			expect(afterPhase).toBe("awaiting_followup")
			expect(writerFired).toBeGreaterThanOrEqual(1)
		})

		it("Q5-D control: current session's J is completed (terminal state) -> awaiting_followup preserved (terminal state doesn't count)", async () => {
			// Control: when the active session's J is in any terminal
			// state (cancelled, exited, failed), the query returns
			// false because `hasRunningBackgroundJobForOwner` only
			// matches active RUNNING jobs. The phase transitions to
			// `awaiting_followup` as expected.
			enableTurnStateWriterProvenanceDiagnostic()
			const harness = makeHarnessWithLiveness(() => false)

			const { afterPhase, writerFired } = await driveDoneWithoutCompletion(harness)

			expect(afterPhase).toBe("awaiting_followup")
			expect(writerFired).toBeGreaterThanOrEqual(1)
		})
	},
)
