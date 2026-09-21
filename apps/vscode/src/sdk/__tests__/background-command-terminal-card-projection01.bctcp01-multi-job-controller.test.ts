/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01
 * (correction01 / Factory HALT_TERMINAL_CARD_MULTI_JOB_PROJECTION_FALSE_GREEN):
 *
 * Controller-side RED witness for the multi-job terminal projection
 * defect. The predecessor ACT's BCTCP01-CTL-03 multi-job test
 * exercised the cardinality pathway (J1 + J2 simultaneous, then
 * cardinal flip, then J3 starts). That test passed in isolation
 * but did NOT prove the production composition: when J1
 * terminalizes while J2 stays running, the runner previously
 * fired `(false, undefined)` ONLY on the >0->0 cardinal
 * transition (gated by `if (becameIdle)` at
 * `vscode-run-commands-tool.ts:835-839`). J1's terminalPromise
 * resolves with `becameIdle: false` (J2 still active), so the
 * previous code dropped the signal entirely — leaving J1's
 * projection stuck at `"running"` indefinitely (the stale
 * Backgrounded pill bug the Factory reviewer caught).
 *
 * The correction01 fix moves the per-job terminal signal to the
 * runner (carrying the terminating jobId AND the exact
 * terminalState), and the controller updates the projection
 * accordingly. This file exercises the CONTROLLER side of that
 * repair via the new `updateBackgroundCommandState(false,
 * jobId, terminalState)` signature, end-to-end with the real
 * `SdkController.prototype.updateBackgroundCommandState` method.
 *
 * Production composition claim: when the runner fires the
 * per-job terminal signal (proven via the diff at
 * `vscode-run-commands-tool.ts:847-849` — the unconditional
 * `.then(({jobId, terminalState}) => notifyBackgroundStateChange
 * (false, jobId, terminalState))` — no longer gated on
 * `if (becameIdle)`), the controller must update ONLY the
 * specific job's projection and recompute the scalar from the
 * map. The factory-shape proxy for the production runner is
 * to drive `updateBackgroundCommandState` directly with the
 * exact arguments the runner would emit.
 *
 * RED->GREEN contract (correction01):
 *   updateBackgroundCommandState(true,  J1)
 *     -> map[J1] = "running"; anyRunning = true; scalar = true
 *   updateBackgroundCommandState(true,  J2)
 *     -> map[J2] = "running"; anyRunning = true; scalar = true
 *   updateBackgroundCommandState(false, J1, "exited")
 *     -> map[J1] = "exited"; map[J2] = "running" (UNCHANGED)
 *        anyRunning = true (J2 still alive); scalar stays true
 *
 * Pre-correction01 behavior (proves the bug):
 *   The runner fired `(false, undefined)` only on the >0->0
 *   cardinal flip, so it would NEVER call
 *   `updateBackgroundCommandState(false, J1, "exited")` while
 *   J2 was still running. The Map's J1 entry would stay
 *   "running" forever, and the corresponding chat row would
 *   render stale Backgrounded + Cancel.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { Controller as SdkController } from "../SdkController"

function makeControllerStub(): {
	backgroundCommandRunning: boolean
	backgroundCommandTaskId: string | undefined
	backgroundCommandJobStates: Record<
		string,
		"running" | "exited" | "cancelled" | "deadline_exceeded" | "spawn_failed" | "containment_failed" | "terminal"
	>
	postStateToWebview: () => Promise<void>
	sessions: { getActiveSession: () => unknown }
	sessionEvents: { reevaluateDeferredContinuation: () => void }
	didProjectionChange: (
		terminalState?: "exited" | "cancelled" | "deadline_exceeded" | "spawn_failed" | "containment_failed" | "terminal",
	) => boolean
} & Record<string, unknown> {
	return {
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundCommandJobStates: {},
		postStateToWebview: vi.fn(async () => {}),
		sessions: { getActiveSession: () => undefined },
		sessionEvents: { reevaluateDeferredContinuation: vi.fn() },
		// Mirror the production `didProjectionChange` semantics —
		// any explicit terminalState invalidates the no-op.
		// (Production method is private; this stub is a public
		// surface the prototype method calls via `this.`.)
		didProjectionChange: (terminalState?: string) => terminalState !== undefined,
	}
}

describe(
	"ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 (correction01) — multi-job controller projection",
	() => {
		let controller: ReturnType<typeof makeControllerStub>
		let btcontSpy: ReturnType<typeof vi.fn>

		beforeEach(() => {
			controller = makeControllerStub()
			btcontSpy = vi.fn()
			// biome-ignore lint/suspicious/noExplicitAny: test seam (private static method)
			;(SdkController as any).maybeReevaluateDeferredContinuation = btcontSpy
		})

		// THE Factory reviewer's required RED->GREEN.
		// Drives the real `updateBackgroundCommandState` method
		// with the EXACT arguments the correction01 runner
		// emits (per-job terminal with terminalState). Pre-
		// correction01, no such signal ever fired — J1's
		// projection would stay "running" indefinitely. Post-
		// correction01, the projection flips per-job while
		// siblings stay running.
		it("BCTCP-CTL-MULTI-01 J1 terminal while J2 stays running -> independent per-job projection", () => {
			// Step 1: J1 starts (0->1 transition)
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J1")
			// Step 2: J2 starts (1->2 transition, scalar stays true)
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J2")
			expect(controller.backgroundCommandJobStates["cmd_J1"]).toBe("running")
			expect(controller.backgroundCommandJobStates["cmd_J2"]).toBe("running")
			expect(controller.backgroundCommandRunning).toBe(true)
			expect(controller.backgroundCommandTaskId).toBe("cmd_J2") // last started

			// Step 3: J1 terminalizes while J2 is still running.
			// The runner (post-correction01) fires this signal
			// unconditionally — NOT gated on the >0->0 cardinal
			// flip. Pre-correction01 this signal NEVER fired (the
			// runner dropped it via `if (becameIdle)`).
			SdkController.prototype.updateBackgroundCommandState.call(
				controller as never,
				false,
				"cmd_J1",
				"exited",
			)

			// BUG GATE — pre-correction01 this assertion failed
			// because J1's projection never received a per-job
			// terminal signal (the runner dropped it).
			expect(controller.backgroundCommandJobStates["cmd_J1"]).toBe("exited")
			// J2 must be UNCHANGED.
			expect(controller.backgroundCommandJobStates["cmd_J2"]).toBe("running")
			// Scalar stays true because J2 is still alive.
			expect(controller.backgroundCommandRunning).toBe(true)
			// Active taskId points at J2 (the last "running"
			// entry in the projection map), NOT at J1 (which just
			// terminalized).
			expect(controller.backgroundCommandTaskId).toBe("cmd_J2")
			// BTCONT must NOT have fired reevaluation yet — the
			// >0->0 transition has not happened (J2 still
			// active). The static bridge is invoked
			// unconditionally on every callback, but the
			// predicate inside is `previousRunning && !running &&
			// taskId === undefined`; with `previousRunning === true`,
			// `running === true` (J2 still alive), the predicate is
			// false (regardless of taskId value) and no
			// reevaluation fires.
			const lastCall = btcontSpy.mock.calls[btcontSpy.mock.calls.length - 1]
			expect(lastCall[0]).toBe(true) // previousRunning
			expect(lastCall[1]).toBe(true) // running (J2 still alive)
			// taskId is the parameter the runner passed (cmd_J1);
			// BTCONT's predicate doesn't care about the value
			// here because `running` is still true.
			expect(lastCall[2]).toBe("cmd_J1")
		})

		// When J2 also terminalizes (the >0->0 transition),
		// the scalar flips false and BTCONT's predicate
		// fires. The runner's correction01 per-job callback
		// now sees `anyRunning === false` and the controller
		// derives the legacy `taskId === undefined` predicate
		// signal so BTCONT is invoked with the right shape.
		it("BCTCP-CTL-MULTI-02 J2 terminal after J1 -> >0->0 cardinal flip -> BTCONT predicate fires", () => {
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J1")
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J2")
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, false, "cmd_J1", "exited")
			// Reset spy to isolate the J2-terminal call.
			btcontSpy.mockClear()

			SdkController.prototype.updateBackgroundCommandState.call(
				controller as never,
				false,
				"cmd_J2",
				"exited",
			)

			// Both jobs are now terminal.
			expect(controller.backgroundCommandJobStates["cmd_J1"]).toBe("exited")
			expect(controller.backgroundCommandJobStates["cmd_J2"]).toBe("exited")
			expect(controller.backgroundCommandRunning).toBe(false)
			expect(controller.backgroundCommandTaskId).toBeUndefined()

			// BTCONT predicate fires on the >0->0 transition
			// (the controller derives `taskId === undefined`
			// because no entry is "running" anymore).
			expect(btcontSpy).toHaveBeenCalledTimes(1)
			expect(btcontSpy).toHaveBeenCalledWith(
				true, // previousRunning (J1 was exited but J2 was running)
				false, // running
				undefined, // taskId (legacy BTCONT shape)
				controller.sessionEvents,
			)
		})

		// The legacy `(false, undefined)` pathway still works
		// (backward-compat for callers that have not been
		// updated). Every running entry becomes terminal with
		// the supplied terminalState.
		it("BCTCP-CTL-MULTI-03 (false, undefined, terminalState) legacy pathway still flips every running entry", () => {
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J1")
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J2")
			SdkController.prototype.updateBackgroundCommandState.call(
				controller as never,
				false,
				undefined,
				"cancelled",
			)
			expect(controller.backgroundCommandJobStates["cmd_J1"]).toBe("cancelled")
			expect(controller.backgroundCommandJobStates["cmd_J2"]).toBe("cancelled")
			expect(controller.backgroundCommandRunning).toBe(false)
		})

		// Per-job terminal pill reason is preserved on the
		// projection map (the bounded P1 fix).
		it("BCTCP-CTL-MULTI-04 per-job terminalState is preserved on the projection map", () => {
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J1")
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J2")
			SdkController.prototype.updateBackgroundCommandState.call(
				controller as never,
				false,
				"cmd_J1",
				"deadline_exceeded",
			)
			expect(controller.backgroundCommandJobStates["cmd_J1"]).toBe("deadline_exceeded")
			// J2 still running
			expect(controller.backgroundCommandJobStates["cmd_J2"]).toBe("running")
		})

		// Invariant preservation: any("running") === backgroundCommandRunning
		it("BCTCP-CTL-MULTI-05 invariant: backgroundCommandRunning === any(map value === 'running')", () => {
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J1")
			SdkController.prototype.updateBackgroundCommandState.call(controller as never, true, "cmd_J2")
			expect(controller.backgroundCommandRunning).toBe(
				Object.values(controller.backgroundCommandJobStates).some((s) => s === "running"),
			)
			SdkController.prototype.updateBackgroundCommandState.call(
				controller as never,
				false,
				"cmd_J1",
				"exited",
			)
			expect(controller.backgroundCommandRunning).toBe(
				Object.values(controller.backgroundCommandJobStates).some((s) => s === "running"),
			)
			SdkController.prototype.updateBackgroundCommandState.call(
				controller as never,
				false,
				"cmd_J2",
				"exited",
			)
			expect(controller.backgroundCommandRunning).toBe(false)
			expect(
				Object.values(controller.backgroundCommandJobStates).some((s) => s === "running"),
			).toBe(false)
		})
	},
)
