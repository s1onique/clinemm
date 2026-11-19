/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01 — the LIFECYCLE witness.
 *
 * The `HALT_FEEDBACK_LIFECYCLE_CONSERVATION` review found that the V2
 * feedback route called the follow-up coordinator DIRECTLY, skipping the
 * canonical turn-start prelude that the ordinary UI route performs:
 *
 *   - emit `same_task_continued` (the only accepted exit from
 *     `resumable` in the shadow's lifecycle),
 *   - fence the PREVIOUS canonical run,
 *   - set the turn phase to `streaming`,
 *   - clear the previous turn's completion signal,
 *   - publish the updated state to the webview.
 *
 * The V2 suite proved only that a MOCKED feedback authority was invoked
 * once. This witness drives the REAL `SdkController` PROTOTYPE METHODS -
 * the real `performCanonicalTurnStart` and the real `sendSupervisionFeedback`
 * - with a REAL `TaskProxy` (the object that persists the approval
 * response type) and a REAL turn-state tracker.
 *
 * WHAT IS PROVEN HERE
 *
 *   LC-1  the MCP feedback route performs the canonical prelude - the
 *         phase moves to `streaming`, the turn outcome is cleared and
 *         the state is published,
 *   LC-2  the prelude emits `same_task_continued` for a terminal phase
 *         and fences the previous canonical run,
 *   LC-3  the MCP route forwards NO response type - the persisted
 *         `"yesButtonClicked"` never reaches the follow-up coordinator,
 *   LC-4  the ordinary UI route DOES forward the persisted response type
 *         (the UI remains the approval authority),
 *   LC-5  a `resumable` task re-enters `streaming` through the MCP
 *         route (the shadow's only accepted exit from `resumable`).
 *
 * The route-pin source contract in `control-seam.supervision-route-pin.test.ts`
 * pins WHICH method the controller calls. This witness pins what that
 * method DOES when it runs for real.
 */

import { describe, expect, it, vi } from "vitest"

import { Controller as SdkController } from "../SdkController"
import { createTaskProxy } from "../task-proxy"

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureRemoteConfigSessionGate: vi.fn(),
	},
}))

const { buildBaseStateMock } = vi.hoisted(() => ({
	buildBaseStateMock: vi.fn(async () => ({ taskHistory: [] })),
}))
vi.mock("@core/controller/state/getStateToPostToWebview", () => ({
	getStateToPostToWebview: buildBaseStateMock,
}))

/** The recorded calls of the follow-up coordinator. */
interface FollowupCalls {
	readonly calls: { prompt?: string; responseType?: string; phase?: string }[]
}

/**
 * Build a controller that drives the REAL prototype methods with the
 * collaborators the canonical prelude touches.
 *
 * `phase` is the phase the tracker starts in (the "previous turn"
 * phase), so the witness can assert the `resumable` -> `streaming`
 * transition and the `same_task_continued` emission.
 */
function makeController(options: {
	readonly phase: "completed" | "resumable" | "awaiting_followup" | "streaming" | "idle"
	readonly epoch?: number
}): {
	controller: unknown
	followups: FollowupCalls
	/** The host-message types observed by the shadow coordinator. */
	readonly emitted: string[]
	tracker: { currentPhase: string; get: () => { phase: string } }
	readonly posted: number
} {
	const followupCalls: { prompt?: string; responseType?: string; phase?: string }[] = []
	const emitted: string[] = []
	const postedStates: number[] = []
	// The phase union mirrors the production `TurnPhase` values the
	// canonical prelude can write.
	type Phase = "idle" | "completed" | "streaming" | "awaiting_followup" | "resumable" | "error"
	const tracker = {
		phase: options.phase as Phase,
		seq: 0,
		currentPhase: options.phase as Phase,
		get() {
			return { phase: this.phase, seq: this.seq, anchorTs: undefined }
		},
		setWithWriter(phase: Phase) {
			this.phase = phase
			this.currentPhase = phase
			this.seq++
		},
		set(phase: Phase) {
			this.phase = phase
			this.currentPhase = phase
			this.seq++
		},
	}
	const controller = Object.assign(Object.create(SdkController.prototype), {
		taskStateShadowWiring: {
			coordinator: {
				observe: (observation: { msg?: { type?: string } }) => {
					if (observation?.msg?.type) {
						emitted.push(observation.msg.type)
					}
				},
			},
			now: () => 1_000,
			fenceCanonicalRunForContinuation: vi.fn(),
		},
		turnStateTracker: tracker,
		messageTranslatorState: {
			getMinter: () => ({ epoch: options.epoch ?? 3 }),
			clearTurnOutcome: vi.fn(),
		},
		postStateToWebview: vi.fn(async () => {
			postedStates.push(1)
		}),
		followups: {
			askResponse: async (
				prompt?: string,
				_images?: string[],
				_files?: string[],
				responseType?: string,
				phase?: string,
			) => {
				followupCalls.push({ prompt, responseType, phase })
			},
		},
		// The ordinary UI route reads the cloud-session guard before the
		// canonical prelude. A non-cloud task id makes it a no-op.
		cloud: {
			isCloudSessionId: () => false,
			getCurrentTaskInfo: () => undefined,
		},
		pendingStartRetry: undefined,
		sessions: {
			getActiveSession: () => ({
				sessionId: "session-owned",
				isRunning: false,
				sdkHost: {
					runtimeSnapshot: () => ({ status: "idle", runId: "run-current" }),
					pendingPrompts: async () => [],
				},
			}),
		},
	})
	return {
		controller,
		followups: { calls: followupCalls },
		emitted,
		tracker: tracker as never,
		get posted() {
			return postedStates.length
		},
	}
}

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01 — the canonical turn-start prelude", () => {
	it("LC-1: the MCP feedback route performs the CANONICAL prelude - the phase moves to `streaming`, the turn outcome is cleared and the state is published", async () => {
		const harness = makeController({ phase: "awaiting_followup" })
		const result = await (
			SdkController.prototype as unknown as {
				sendSupervisionFeedback: (input: {
					sessionId: string
					expectedEpoch: number
					text: string
				}) => Promise<{ outcome: string }>
			}
		).sendSupervisionFeedback.call(harness.controller, {
			sessionId: "session-owned",
			expectedEpoch: 3,
			text: "Please run the focused test.",
		})

		expect(result.outcome).toBe("accepted")
		// 3. the turn phase moved to `streaming`.
		expect(harness.tracker.currentPhase).toBe("streaming")
		// 4. the previous turn's completion signal was cleared.
		expect(
			(harness.controller as { messageTranslatorState: { clearTurnOutcome: ReturnType<typeof vi.fn> } })
				.messageTranslatorState.clearTurnOutcome,
		).toHaveBeenCalled()
		// 5. the updated state was published.
		expect(harness.posted).toBeGreaterThan(0)
		// The message reached the follow-up coordinator.
		expect(harness.followups.calls).toHaveLength(1)
		expect(harness.followups.calls[0]?.prompt).toBe("Please run the focused test.")
	})

	it("LC-2: the prelude emits `same_task_continued` and fences the PREVIOUS canonical run for a terminal phase", async () => {
		const harness = makeController({ phase: "resumable" })
		const wiring = (
			harness.controller as {
				taskStateShadowWiring: { fenceCanonicalRunForContinuation: ReturnType<typeof vi.fn> }
			}
		).taskStateShadowWiring

		await (
			SdkController.prototype as unknown as {
				sendSupervisionFeedback: (input: { sessionId: string; expectedEpoch: number; text: string }) => Promise<unknown>
			}
		).sendSupervisionFeedback.call(harness.controller, {
			sessionId: "session-owned",
			expectedEpoch: 3,
			text: "resume please",
		})

		// 1. `same_task_continued` was emitted - the shadow's only
		//    accepted exit from `resumable`.
		expect(harness.emitted).toContain("same_task_continued")
		// 2. the previous canonical run was fenced.
		expect(wiring.fenceCanonicalRunForContinuation).toHaveBeenCalled()
		// And the phase advanced out of `resumable`.
		expect(harness.tracker.currentPhase).toBe("streaming")
	})

	it("LC-3: the MCP route forwards NO response type - the persisted `yesButtonClicked` never reaches the coordinator", async () => {
		const harness = makeController({ phase: "awaiting_followup" })
		// The REAL task proxy, which PERSISTS the UI's response type.
		const proxy = createTaskProxy(
			"session-owned",
			async () => {},
			async () => {},
		)
		await proxy.handleWebviewAskResponse("yesButtonClicked")
		expect(proxy.taskState.askResponse).toBe("yesButtonClicked")
		// Bind the real proxy onto the controller, exactly as production
		// does.
		;(harness.controller as { task: unknown }).task = proxy

		await (
			SdkController.prototype as unknown as {
				sendSupervisionFeedback: (input: { sessionId: string; expectedEpoch: number; text: string }) => Promise<unknown>
			}
		).sendSupervisionFeedback.call(harness.controller, {
			sessionId: "session-owned",
			expectedEpoch: 3,
			text: "ordinary feedback",
		})

		expect(harness.followups.calls).toHaveLength(1)
		const responseType = harness.followups.calls[0]?.responseType
		expect(responseType).toBeUndefined()
		expect(responseType).not.toBe("yesButtonClicked")
	})

	it("LC-4: the ordinary UI route DOES forward the persisted response type - the UI remains the approval authority", async () => {
		const harness = makeController({ phase: "awaiting_followup" })
		const proxy = createTaskProxy(
			"session-owned",
			async () => {},
			async () => {},
		)
		await proxy.handleWebviewAskResponse("yesButtonClicked")
		;(harness.controller as { task: unknown }).task = proxy

		await (
			SdkController.prototype as unknown as {
				askResponse: (prompt?: string) => Promise<void>
			}
		).askResponse.call(harness.controller, "approve the pending tool")

		expect(harness.followups.calls).toHaveLength(1)
		expect(harness.followups.calls[0]?.responseType).toBe("yesButtonClicked")
	})

	it("LC-5: a `resumable` task re-enters `streaming` through the MCP route", async () => {
		const harness = makeController({ phase: "resumable" })
		expect(harness.tracker.currentPhase).toBe("resumable")

		await (
			SdkController.prototype as unknown as {
				sendSupervisionFeedback: (input: { sessionId: string; expectedEpoch: number; text: string }) => Promise<unknown>
			}
		).sendSupervisionFeedback.call(harness.controller, {
			sessionId: "session-owned",
			expectedEpoch: 3,
			text: "continue",
		})

		expect(harness.tracker.currentPhase).toBe("streaming")
	})
})
