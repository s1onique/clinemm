/**
 * ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — IDENTITY-BOUNDARY CORRECTION01
 *
 * The bounded PRODUCTION-CONTROLLER identity witness.
 *
 * WHY THIS FILE EXISTS
 *
 *   The ACT's own publication-boundary suite drove the REAL
 *   `sendStateUpdate()` handoff and the REAL store, but it connected
 *   them through a TEST-LOCAL `captureFromSubmittedState()` helper
 *   that MIRRORED `SdkController.capturePublishedTaskState()` instead
 *   of invoking the real controller method.
 *
 *   That left the load-bearing question unproven:
 *
 *     What happens if the active session changes while an asynchronous
 *     state submission is completing?
 *
 *   The published snapshot belongs to session A. The eventual capture
 *   must not accidentally bind that snapshot to session B.
 *
 * WHAT THIS FILE PROVES
 *
 *   This file invokes the REAL production controller methods:
 *
 *     SdkController.prototype.flushStateToWebview()      [REAL]
 *       -> getStateToPostToWebview()                    [REAL, stubbed builder]
 *         -> attachPublishedTaskStateIdentity(...)      [REAL]
 *       -> await sendStateUpdate(state)                 [REAL handoff, mocked
 *                                                         to switch the active
 *                                                         session mid-flight]
 *       -> SdkController.prototype.capturePublishedTaskState(state)  [REAL]
 *         -> PublishedTaskStateStore.capture(...)       [REAL]
 *
 *   The pre-correction production code read the identity LIVE
 *   (`this.sessions.getActiveSession()?.sessionId` /
 *   `this.task?.taskId`) AFTER the `await sendStateUpdate(...)`. With the
 *   session switched mid-flight, that bound session A's projection to
 *   session B's identity. The corrected production code reads the
 *   identity from the carrier that travelled WITH the submitted
 *   snapshot, so the record stays bound to session A.
 *
 * THE INVARIANT UNDER TEST
 *
 *   The captured `sessionId`, `taskId`, `epoch` and `stateVersion` all
 *   originate from ONE consistent publication identity — the identity
 *   of the snapshot that was actually submitted.
 */

import { describe, expect, it, vi } from "vitest"

// The REAL `subscribeToState` module imports the telemetry service,
// whose singleton construction requires a HostProvider. The telemetry
// call is irrelevant to the identity contract, so the service is
// stubbed. The `sendStateUpdate` HANDOFF ITSELF is mocked (below) so
// the test can switch the active session exactly DURING the awaited
// publication — which is the production race window under test.
vi.mock("@/services/telemetry", () => ({
	telemetryService: { captureGrpcResponseSize: () => {} },
}))

const handoff = vi.hoisted(() => ({
	/** Invoked by the mocked `sendStateUpdate` while the publication is in flight. */
	onHandoff: undefined as undefined | (() => void),
	/** The state object handed to `sendStateUpdate` (the submitted snapshot). */
	submitted: undefined as undefined | Record<string, unknown>,
}))

vi.mock("@core/controller/state/subscribeToState", async (importOriginal) => {
	// PARTIAL mock: the REAL `subscribeToState` export is preserved
	// (other modules in the import graph — e.g. the generated protobus
	// host — depend on it). ONLY `sendStateUpdate` is replaced, so the
	// test can switch the active session exactly DURING the awaited
	// publication — the production race window under test.
	const actual = await importOriginal<typeof import("@core/controller/state/subscribeToState")>()
	return {
		...actual,
		sendStateUpdate: async (state: Record<string, unknown>) => {
			handoff.submitted = state
			// The publication is "in flight" here. The active session may
			// switch while this await is pending.
			handoff.onHandoff?.()
			return true
		},
	}
})

import type { ExtensionState } from "@shared/ExtensionMessage"
import { attachPublishedTaskStateIdentity, PublishedTaskStateStore } from "@/sdk/published-task-state"
import { projectControlSeamTaskState } from "../control-seam/control-seam-authority"
import { Controller as SdkController } from "../SdkController"

/** The identity the published snapshot was built for. */
interface FixtureIdentity {
	sessionId: string
	taskId: string
}

/**
 * The REAL production publication methods, reached through the
 * prototype.
 *
 * `flushStateToWebview` and `capturePublishedTaskState` are `private`
 * on the production `Controller`. The prototype-call seam is the
 * established controller-test pattern in this codebase (see
 * `background-command-terminal-card-projection01.bctcp01-controller.test.ts`);
 * the cast below is confined to this accessor so the call sites stay
 * type-safe.
 */
const productionFlushStateToWebview =
	// biome-ignore lint/suspicious/noExplicitAny: test seam (private production method)
	(SdkController.prototype as any).flushStateToWebview as (this: unknown) => Promise<void>

const productionCapturePublishedTaskState =
	// biome-ignore lint/suspicious/noExplicitAny: test seam (private production method)
	(SdkController.prototype as any).capturePublishedTaskState as (this: unknown, state: ExtensionState) => void

/**
 * A synthetic controller carrying ONLY the fields the production
 * publication path actually touches.
 *
 * `getStateToPostToWebview` is stubbed so the test can drive the
 * REAL `flushStateToWebview` → REAL `capturePublishedTaskState` chain
 * with a controlled snapshot. The snapshot is built by the REAL
 * identity-attachment helper, exactly as the production builder does.
 */
function makeControllerStub(options: {
	identity: FixtureIdentity
	epoch: number
	stateVersion: number
	phase: "idle" | "streaming" | "awaiting_approval" | "awaiting_followup" | "compacting" | "completed" | "error" | "resumable"
	source: "shadow" | "host" | "legacy"
	seq: number
}) {
	const store = new PublishedTaskStateStore()

	// The LIVE identity — this is what the PRE-CORRECTION production
	// code read after the await.
	let liveIdentity = options.identity

	// The snapshot the production builder would produce: the same
	// object carries the identity carrier (non-enumerable) exactly as
	// the production `getStateToPostToWebview()` attaches it.
	const snapshot = {
		taskHeaderPresentation: { phase: options.phase, source: options.source, seq: options.seq },
		stateVersion: options.stateVersion,
		epoch: options.epoch,
	} as unknown as ExtensionState
	attachPublishedTaskStateIdentity(snapshot, {
		sessionId: options.identity.sessionId,
		taskId: options.identity.taskId,
	})

	const controller = {
		publishedTaskState: store,
		// The REAL `flushStateToWebview` reads `this.getStateToPostToWebview()`.
		getStateToPostToWebview: async () => snapshot,
		// The REAL capture method, bound onto the synthetic `this` so the
		// production `flushStateToWebview` invokes the production capture
		// (not a test-local mirror of it).
		capturePublishedTaskState: productionCapturePublishedTaskState,
		// The LIVE identity reads. The pre-correction capture used these;
		// the corrected capture MUST NOT.
		sessions: {
			getActiveSession: () => ({ sessionId: liveIdentity.sessionId }),
		},
		task: { taskId: liveIdentity.taskId },
		/** Switch the active identity — used to model the mid-flight change. */
		switchLiveIdentity(next: FixtureIdentity) {
			liveIdentity = next
		},
	}

	return { controller, store, snapshot }
}

const SESSION_A: FixtureIdentity = { sessionId: "session-a", taskId: "task-a" }
const SESSION_B: FixtureIdentity = { sessionId: "session-b", taskId: "task-b" }

describe("ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01 — production-controller identity boundary", () => {
	it("IB01: the REAL capture binds the record to the SUBMITTED snapshot's identity", async () => {
		const { controller, store } = makeControllerStub({
			identity: SESSION_A,
			epoch: 4,
			stateVersion: 900,
			phase: "streaming",
			source: "shadow",
			seq: 42,
		})

		await productionFlushStateToWebview.call(controller)

		expect(store.read()?.sessionId).toBe("session-a")
		expect(store.read()?.taskId).toBe("task-a")
		expect(store.read()?.epoch).toBe(4)
		expect(store.read()?.stateVersion).toBe(900)
		expect(store.read()?.projection.phase).toBe("streaming")
		expect(store.read()?.projection.seq).toBe(42)
	})

	it("IB02: a task switch DURING the publication does NOT rebind session A's projection to session B", async () => {
		const { controller, store } = makeControllerStub({
			identity: SESSION_A,
			epoch: 4,
			stateVersion: 901,
			phase: "streaming",
			source: "shadow",
			seq: 43,
		})

		// The active session switches WHILE the publication is in flight.
		handoff.onHandoff = () => {
			controller.switchLiveIdentity(SESSION_B)
		}
		try {
			await productionFlushStateToWebview.call(controller)
		} finally {
			handoff.onHandoff = undefined
		}

		// The record is bound to the identity that PRODUCED the snapshot.
		expect(store.read()?.sessionId).toBe("session-a")
		expect(store.read()?.taskId).toBe("task-a")
		expect(store.read()?.epoch).toBe(4)
		expect(store.read()?.stateVersion).toBe(901)

		// AND it is NOT projected for the new active owner — the
		// control-seam read path fences on the CURRENT identity.
		expect(projectControlSeamTaskState(store.read(), SESSION_B.sessionId, SESSION_B.taskId, 4)).toBeUndefined()

		// It IS projected for the owner it belongs to.
		expect(projectControlSeamTaskState(store.read(), SESSION_A.sessionId, SESSION_A.taskId, 4)).toMatchObject({
			phase: "streaming",
			epoch: 4,
			stateVersion: 901,
		})
	})

	it("IB03: the submitted snapshot carries the identity carrier, and the carrier is NOT on the wire", async () => {
		const { controller, snapshot } = makeControllerStub({
			identity: SESSION_A,
			epoch: 4,
			stateVersion: 902,
			phase: "awaiting_followup",
			source: "shadow",
			seq: 44,
		})

		await productionFlushStateToWebview.call(controller)

		// The REAL `sendStateUpdate` received the exact submitted object.
		expect(handoff.submitted).toBe(snapshot)

		// The carrier does not change the serialized wire shape.
		const wire = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>
		expect(Object.keys(wire)).not.toContain("sessionId")
		expect(Object.keys(wire)).not.toContain("taskId")
		expect(wire.stateVersion).toBe(902)
		expect(wire.epoch).toBe(4)
	})

	it("IB04: a snapshot WITHOUT the identity carrier is NOT captured (no guessed identity)", () => {
		const store = new PublishedTaskStateStore()
		const state = {
			taskHeaderPresentation: { phase: "streaming", source: "shadow", seq: 45 },
			stateVersion: 903,
			epoch: 4,
		} as unknown as ExtensionState

		// The REAL capture method, against a REAL store, with a state
		// that carries NO identity carrier.
		productionCapturePublishedTaskState.call({ publishedTaskState: store }, state)

		expect(store.read()).toBeUndefined()
	})
})
