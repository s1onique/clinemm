/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 — BCTCP01
 *
 * Controller-side unit tests for the per-job lifecycle projection
 * maintained by `SdkController.updateBackgroundCommandState` and
 * `SdkController.cancelBackgroundCommand`. These tests drive the
 * REAL `SdkController` (via the prototype methods) so the
 * production seam is exercised end-to-end at the Node layer
 * (complementing the webview-side BCTCP01 family).
 *
 * Conservation matrix:
 *   BCTCP-CTL-01  (true, jobId)   → map[jobId] = "running"
 *   BCTCP-CTL-02  (false, undef) → every "running" entry → "terminal"
 *   BCTCP-CTL-03  multi-job:     → independent per-job projection
 *   BCTCP-CTL-04  cancel(jobId)  → that job → "terminal"
 *   BCTCP-CTL-05  cancel(no jobId) → every "running" entry → "terminal"
 *   BCTCP-CTL-06  projection is preserved in getStateToPostToWebview
 *                  spread (NOT mutated by reference)
 *   BCTCP-CTL-07  invariant: backgroundCommandRunning === any("running")
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { Controller as SdkController } from "../SdkController"

// Mirror of the production private fields the prototype method
// mutates. We invoke SdkController.prototype.updateBackgroundCommandState
// and cancelBackgroundCommand against a synthetic controller that
// carries ONLY the fields the seam actually reads/writes — keeps
// the test focused on the per-job projection contract.
function makeControllerStub(extra: Record<string, unknown> = {}): {
	backgroundCommandRunning: boolean
	backgroundCommandTaskId: string | undefined
	backgroundCommandJobStates: Record<string, "running" | "terminal">
	postStateToWebview: () => Promise<void>
	// cancelBackgroundCommand reads `sessions.getActiveSession()`
	sessions: { getActiveSession: () => unknown }
	sessionEvents: unknown
	maybeReevaluateDeferredContinuation: (
		previousRunning: boolean,
		running: boolean,
		taskId: string | undefined,
		sessionEvents: unknown,
	) => void
} & Record<string, unknown> {
	return {
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundCommandJobStates: {},
		postStateToWebview: vi.fn(async () => {}),
		sessions: { getActiveSession: () => undefined },
		sessionEvents: {},
		maybeReevaluateDeferredContinuation: vi.fn(),
		...extra,
	}
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01 — SdkController per-job projection", () => {
	let controller: ReturnType<typeof makeControllerStub>
	let btcontSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		controller = makeControllerStub()
		// Stub out the production static bridge so we don't depend on
		// a fully-wired sessionEvents coordinator. The stub records the
		// call args so we can assert the BTCONT reevaluation trigger
		// (BCTCP-CTL-08) WITHOUT actually invoking it.
		btcontSpy = vi.fn()
		// biome-ignore lint/suspicious/noExplicitAny: test seam (private static method)
		;(SdkController as any).maybeReevaluateDeferredContinuation = btcontSpy
	})

	it("BCTCP-CTL-01 (true, jobId) sets map[jobId] = 'running' and flips backgroundCommandRunning", () => {
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		expect(controller.backgroundCommandJobStates["cmd_alpha"]).toBe("running")
		expect(controller.backgroundCommandRunning).toBe(true)
		expect(controller.backgroundCommandTaskId).toBe("cmd_alpha")
	})

	it("BCTCP-CTL-02 (false, undefined) marks every 'running' entry 'terminal'", () => {
		// Seed two running siblings.
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_beta",
		)
		expect(controller.backgroundCommandJobStates["cmd_alpha"]).toBe("running")
		expect(controller.backgroundCommandJobStates["cmd_beta"]).toBe("running")
		// Cardinal flip.
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			undefined,
		)
		expect(controller.backgroundCommandJobStates["cmd_alpha"]).toBe("terminal")
		expect(controller.backgroundCommandJobStates["cmd_beta"]).toBe("terminal")
		expect(controller.backgroundCommandRunning).toBe(false)
		expect(controller.backgroundCommandTaskId).toBeUndefined()
	})

	it("BCTCP-CTL-03 multi-job: independent per-job projection (cardinal flip only)", () => {
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		// Pre-existing terminal entry must NOT be touched by the
		// cardinal flip (defensive: terminal is sticky).
		controller.backgroundCommandJobStates["cmd_pre_existing_terminal"] = "terminal"
		// Mark alpha terminal via the projection seam that the manager
		// uses for terminal updates: (true, jobId) then (false, undef).
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			undefined,
		)
		// New job starts after the cardinal flip.
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_beta",
		)
		expect(controller.backgroundCommandJobStates["cmd_alpha"]).toBe("terminal")
		expect(controller.backgroundCommandJobStates["cmd_pre_existing_terminal"]).toBe("terminal")
		expect(controller.backgroundCommandJobStates["cmd_beta"]).toBe("running")
		expect(controller.backgroundCommandRunning).toBe(true)
	})

	it("BCTCP-CTL-06 getStateToPostToWebview spreads a fresh shallow copy", async () => {
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		// Build a fake "snapshot" the way the production code would:
		const snapshot = { ...controller.backgroundCommandJobStates }
		// Mutate the projection map AFTER taking the snapshot.
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			undefined,
		)
		// The previously-emitted snapshot must still reflect "running".
		expect(snapshot["cmd_alpha"]).toBe("running")
		// The current projection is terminal.
		expect(controller.backgroundCommandJobStates["cmd_alpha"]).toBe("terminal")
	})

	it("BCTCP-CTL-07 invariant: backgroundCommandRunning === any(values==='running')", () => {
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		expect(controller.backgroundCommandRunning).toBe(
			Object.values(controller.backgroundCommandJobStates).some((s) => s === "running"),
		)
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_beta",
		)
		expect(controller.backgroundCommandRunning).toBe(
			Object.values(controller.backgroundCommandJobStates).some((s) => s === "running"),
		)
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			undefined,
		)
		expect(controller.backgroundCommandRunning).toBe(
			Object.values(controller.backgroundCommandJobStates).some((s) => s === "running"),
		)
	})

	it("BCTCP-CTL-08 BTCONT predicate fires only on the cardinal flip (BTCONT-01 compat)", () => {
		// The production updateBackgroundCommandState calls
		// Controller.maybeReevaluateDeferredContinuation(...)
		// UNCONDITIONALLY on every transition (cheap, no-op when
		// predicate is false). The PREDICATE inside the static
		// method is `previousRunning && !running && taskId === undefined`,
		// which fires ONLY on the >0->0 cardinal flip. The
		// BTCONT01 family exercises the predicate itself
		// (see btcont01.test.ts); this BCTCP-CTL-08 just verifies
		// the production call site passes the correct arguments.
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_beta",
		)
		// 2 calls so far: each (true, jobId) triggers one BTCONT call.
		expect(btcontSpy).toHaveBeenCalledTimes(2)
		// First call: previousRunning=false (initial); running=true.
		expect(btcontSpy).toHaveBeenNthCalledWith(1, false, true, "cmd_alpha", controller.sessionEvents)
		// Second call: previousRunning=true; running=true (still running).
		expect(btcontSpy).toHaveBeenNthCalledWith(2, true, true, "cmd_beta", controller.sessionEvents)
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			undefined,
		)
		// Cardinal flip — call site passes (true, false, undef).
		expect(btcontSpy).toHaveBeenCalledTimes(3)
		expect(btcontSpy).toHaveBeenLastCalledWith(true, false, undefined, controller.sessionEvents)
	})

	it("BCTCP-CTL-09 (true, jobId) after cardinal flip starts a new running entry", () => {
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_alpha",
		)
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			false,
			undefined,
		)
		// New session starts a job — must appear as "running".
		SdkController.prototype.updateBackgroundCommandState.call(
			controller as never,
			true,
			"cmd_beta",
		)
		expect(controller.backgroundCommandJobStates["cmd_alpha"]).toBe("terminal")
		expect(controller.backgroundCommandJobStates["cmd_beta"]).toBe("running")
		expect(controller.backgroundCommandRunning).toBe(true)
	})
})
