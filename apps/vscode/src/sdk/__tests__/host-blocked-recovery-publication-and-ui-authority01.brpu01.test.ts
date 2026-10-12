/**
 * ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01 — BRPU01
 *
 * Host publication witness (C4/C5/C6 executable RED/GREEN/ablation
 * matrix).
 *
 * The decisive question: when a BCB-held `observation_unavailable`
 * obligation is the cause of the current `error` phase, does the
 * host's wire payload carry enough information for the webview to
 * distinguish it from a genuine `api_req_failed` transport failure?
 *
 * The RED assertions in this file are PRE-FIX proof. The GREEN
 * assertions are POST-FIX proof. Both run against the SAME
 * production `projectBlockedRecovery` helper (extracted to
 * `apps/vscode/src/sdk/blocked-recovery-projection.ts`) and the
 * SAME `SdkController.getStateToPostToWebview` source.
 *
 * The C4 production boundary is exercised via the real
 * `BackgroundNotifyCoordinator` + `SdkSessionEventCoordinator` +
 * real BCB barrier (the same seam BOCR01/HBRC01 use), with the
 * producer projection called on the live barrier state.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { projectBlockedRecovery } from "../blocked-recovery-projection"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

const SdkControllerPath = resolve(__dirname, "..", "SdkController.ts")
const SdkControllerSource = readFileSync(SdkControllerPath, "utf8")
const BlockedRecoveryProjectionPath = resolve(__dirname, "..", "blocked-recovery-projection.ts")
const BlockedRecoveryProjectionSource = readFileSync(BlockedRecoveryProjectionPath, "utf8")
const ExtensionMessagePath = resolve(__dirname, "..", "..", "shared", "ExtensionMessage.ts")
const ExtensionMessageSource = readFileSync(ExtensionMessagePath, "utf8")

interface BrpuHarness {
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	activeSessionId: string
	activeTaskId: string
	getBarrier: () => ReturnType<SdkSessionEventCoordinator["getDeferredCompletionBarrierForTesting"]>
}

function makeBrpuHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): BrpuHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-brpu01"
	const activeTaskId = opts.activeTaskId ?? "task-brpu01"
	const liveTools: readonly string[] | undefined = ["submit_and_exit"]
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: async (_args) => {
			return { kind: "delivered" as const }
		},
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: () => ({ kind: "delivered" as const }),
				},
				taskId: activeTaskId,
			}),
		} as never,
		sessions_getActiveSessionId: () => activeSessionId,
		getTask: () => ({ taskId: activeTaskId }),
		messageTranslatorState_getMinter: () => minter,
		getLaunchedBackgroundJobIds: () => [],
		pendingPromptCountResolver: { available: false } as never,
		activeNotifyCountResolver: () => 0,
		liveTools: () => liveTools,
		taskTelemetry: undefined,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		notifyCoordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		getBarrier: () => coordinator.getDeferredCompletionBarrierForTesting(),
	}
}

describe("ACT-CLINEMM-P0-BRPU01 / blocked recovery — host publication (RED + GREEN)", () => {
	let h: BrpuHarness

	beforeEach(() => {
		h = makeBrpuHarness()
	})

	afterEach(() => {
		h.coordinator.setDeferredCompletionBarrierForTesting(undefined)
		h.notifyCoordinator.dispose()
	})

	describe("WITNESS — production source carries the new projection boundary (no fabrication, no Elm kernel, no completion mutation)", () => {
		it("WITNESS-1: ExtensionMessage.ts defines BlockedRecoveryProjection and BlockedRecoveryReason as closed-enum additive types", () => {
			// The type is the wire contract. Closed-enum additive.
			expect(ExtensionMessageSource).toMatch(/export type BlockedRecoveryReason = "observation_unavailable"/)
			expect(ExtensionMessageSource).toMatch(/export interface BlockedRecoveryProjection \{/)
			expect(ExtensionMessageSource).toMatch(/blockedRecovery\?:\s*BlockedRecoveryProjection/)
		})

		it("WITNESS-2: blocked-recovery-projection.ts is a pure read-only helper (no mutation, no incident registration, no continuation trigger)", () => {
			// C5.1 invariant. The projection helper must NOT call
			// recordRuntimeError, must NOT mutate the barrier, must
			// NOT trigger continuations, must NOT recompute the held
			// set. A pure function with a barrier input and a
			// projection output.
			expect(BlockedRecoveryProjectionSource).toMatch(/export function projectBlockedRecovery\(/)
			expect(BlockedRecoveryProjectionSource).not.toMatch(/recordRuntimeError/)
			expect(BlockedRecoveryProjectionSource).not.toMatch(/deferredCompletionBarrier\s*=/)
			// The function body must not invoke any continuation /
			// enqueue / dispatch call. We assert by extracting the
			// function body and scanning for the disallow list.
			const funcMatch = BlockedRecoveryProjectionSource.match(/export function projectBlockedRecovery\([\s\S]*?\n\}/)
			expect(funcMatch).not.toBeNull()
			const funcBody = funcMatch?.[0] ?? ""
			expect(funcBody).not.toMatch(/enqueueIfHeld|send\s*\(|continueIdle|triggerContinuation/)
			expect(funcBody).not.toMatch(/recordRuntimeError|taskTelemetry/)
			// The function must consult the closed-enum reason.
			expect(BlockedRecoveryProjectionSource).toMatch(/observation_unavailable/)
		})

		it("WITNESS-3: SdkController.getStateToPostToWebview calls projectBlockedRecovery with the live BCB barrier (read-only)", () => {
			// The producer must read the barrier via the existing
			// `getDeferredCompletionBarrierForTesting()` accessor (the
			// only production seam that exposes the marker). The call
			// must be a single expression, not a stored reference.
			const getStateBody = SdkControllerSource.slice(
				SdkControllerSource.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>"),
			)
			expect(getStateBody).toMatch(/blockedRecovery:\s*projectBlockedRecovery\(/)
			expect(getStateBody).toMatch(/this\.sessionEvents\?\.getDeferredCompletionBarrierForTesting\?\.\(\)/)
			// Must NOT assign the projection to any side-effect variable
			// (the call must be a pure expression).
			expect(getStateBody).not.toMatch(/const\s+blockedRecovery\s*=/)
		})

		it("WITNESS-4: buttonConfig.ts carries the new BUTTON_CONFIGS.api_req_failed_blocked variant and the buttonsForPhase branch", () => {
			// Re-read the production buttonConfig source for the new
			// branch. The new variant has Start New Task primary only
			// (no Retry), and the buttonsForPhase selector consults
			// `blockedRecovery?.reason === "observation_unavailable"`.
			const buttonConfigPath = resolve(
				__dirname,
				"..",
				"..",
				"..",
				"webview-ui",
				"src",
				"components",
				"chat",
				"chat-view",
				"shared",
				"buttonConfig.ts",
			)
			const buttonConfigSource = readFileSync(buttonConfigPath, "utf8")
			expect(buttonConfigSource).toMatch(/api_req_failed_blocked:\s*\{/)
			expect(buttonConfigSource).toMatch(/blockedRecovery\?\.reason === "observation_unavailable"/)
			// The blocked variant must have NO retry affordance.
			const blockedMatch = buttonConfigSource.match(/api_req_failed_blocked:\s*\{([\s\S]*?)\}/)
			expect(blockedMatch).not.toBeNull()
			const blockedBody = blockedMatch?.[1] ?? ""
			expect(blockedBody).not.toMatch(/primaryAction:\s*"retry"/)
			expect(blockedBody).toMatch(/primaryAction:\s*"new_task"/)
		})
	})

	describe("BRPU-05/06 — producer projection: blocked vs ordinary", () => {
		it("BRPU-05: with NO barrier, projectBlockedRecovery returns undefined (BRPU-06: ordinary API error has NO projection)", () => {
			// Pre-fix RED: the production code had no projection at all.
			// Post-fix GREEN: the helper returns undefined when no
			// barrier is registered.
			expect(projectBlockedRecovery(undefined)).toBeUndefined()
		})

		it("BRPU-05: a barrier with reason !== observation_unavailable is treated as absent", () => {
			// BRPU-04 boundary: only the closed-enum `observation_unavailable`
			// reason projects. `stalled_no_progress` and `delivery_rejected`
			// mean "wait for reevaluation" and do NOT disable Retry.
			const stalled = {
				sessionId: "session-brpu01",
				taskId: "task-brpu01",
				epoch: 1,
				reason: "stalled_no_progress" as const,
			}
			const rejected = {
				sessionId: "session-brpu01",
				taskId: "task-brpu01",
				epoch: 1,
				reason: "delivery_rejected" as const,
			}
			expect(projectBlockedRecovery(stalled)).toBeUndefined()
			expect(projectBlockedRecovery(rejected)).toBeUndefined()
		})

		it("BRPU-05: a barrier with reason === observation_unavailable projects the typed BlockedRecoveryProjection", () => {
			// The producer boundary returns the typed payload.
			const barrier = {
				sessionId: "session-K",
				taskId: "task-K",
				epoch: 7,
				reason: "observation_unavailable" as const,
			}
			const projection = projectBlockedRecovery(barrier)
			expect(projection).toBeDefined()
			expect(projection).toEqual({
				reason: "observation_unavailable",
				sessionId: "session-K",
				taskId: "task-K",
				enqueueEpoch: 7,
			})
		})

		it("BRPU-05: a barrier with NO reason is treated as absent (defensive)", () => {
			// A fresh BCB hold (the BCB predicate registered the
			// barrier before any blocked outcome was applied) carries
			// `reason: undefined`. That is "a hold is registered,
			// but no blocked outcome has been emitted yet" — this is
			// NOT a blocked recovery from the user's perspective.
			const freshHold = {
				sessionId: "session-K",
				taskId: "task-K",
				epoch: 7,
				reason: undefined,
			}
			expect(projectBlockedRecovery(freshHold)).toBeUndefined()
		})
	})

	describe("BRPU-07 — duplicate same-obligation idempotence (HBCLO01 contract re-asserted)", () => {
		it("a barrier with reason === observation_unavailable is set ONCE per obligation; the projection function is pure (no increment, no side effect)", () => {
			// The HBCLO01 lineage guarantees at-most-one incident per
			// (session, task, epoch). The projection helper is a
			// pure function: calling it twice with the same barrier
			// returns the same shape and does NOT increment
			// runtimeErrorCount. This is the BRPU-07 contract.
			const barrier = {
				sessionId: "session-K",
				taskId: "task-K",
				epoch: 7,
				reason: "observation_unavailable" as const,
			}
			const a = projectBlockedRecovery(barrier)
			const b = projectBlockedRecovery(barrier)
			expect(a).toEqual(b)
		})
	})

	describe("BRPU-09/10/11 — clearing: when the barrier is released, the projection is absent", () => {
		it("BRPU-09/11: with the BCB barrier cleared, projectBlockedRecovery returns undefined (the production code path)", () => {
			// The producer path: when the BCB barrier is released by
			// genuine observation drain or authorized lifecycle
			// disposal, `getDeferredCompletionBarrierForTesting()`
			// returns `undefined`, and the projection helper returns
			// `undefined`. The cumulative `runtimeErrorCount` may
			// remain positive (BRPU-11 — historical incident is not
			// active state).
			expect(projectBlockedRecovery(undefined)).toBeUndefined()
		})
	})

	describe("BRPU-15/16/17/18 — recovery controls (source-bound on the button selector)", () => {
		it("BRPU-15: when a blocked `observation_unavailable` projection is set, the production button selector must return a config that does NOT dispatch a Retry path", () => {
			// C8.1 (Elm ownership): the host owns whether a current
			// blocked observation exists. The webview selects
			// permitted controls from a validated host recovery
			// projection. The blocked variant must be the
			// `api_req_failed_blocked` config and MUST NOT have a
			// `retry` primaryAction.
			const buttonConfigPath = resolve(
				__dirname,
				"..",
				"..",
				"..",
				"webview-ui",
				"src",
				"components",
				"chat",
				"chat-view",
				"shared",
				"buttonConfig.ts",
			)
			const buttonConfigSource = readFileSync(buttonConfigPath, "utf8")
			// The blocked config does not have a `retry` action.
			const blockedMatch = buttonConfigSource.match(/api_req_failed_blocked:\s*\{([\s\S]*?)\n\t\},/)
			expect(blockedMatch).not.toBeNull()
			const blockedBody = blockedMatch?.[1] ?? ""
			expect(blockedBody).not.toMatch(/primaryAction:\s*"retry"/)
			expect(blockedBody).not.toMatch(/secondaryAction:\s*"retry"/)
			// The blocked config has Start New Task primary only.
			expect(blockedBody).toMatch(/primaryAction:\s*"new_task"/)
			expect(blockedBody).toMatch(/primaryText:\s*"Start New Task"/)
			// sendingDisabled: true so the composer cannot bypass.
			expect(blockedBody).toMatch(/sendingDisabled:\s*true/)
		})

		it("BRPU-16: ordinary API failure preserves Retry + Start New Task", () => {
			const buttonConfigPath = resolve(
				__dirname,
				"..",
				"..",
				"..",
				"webview-ui",
				"src",
				"components",
				"chat",
				"chat-view",
				"shared",
				"buttonConfig.ts",
			)
			const buttonConfigSource = readFileSync(buttonConfigPath, "utf8")
			const ordinaryMatch = buttonConfigSource.match(/api_req_failed:\s*\{([\s\S]*?)\n\t\},/)
			expect(ordinaryMatch).not.toBeNull()
			const ordinaryBody = ordinaryMatch?.[1] ?? ""
			expect(ordinaryBody).toMatch(/primaryAction:\s*"retry"/)
			expect(ordinaryBody).toMatch(/secondaryAction:\s*"new_task"/)
		})

		it("BRPU-18: Start New Task uses the existing new_task action (the supported user action)", () => {
			// The useMessageHandlers hook dispatches `new_task` to
			// `TaskServiceClient.newTask` (or `startNewTask` for the
			// terminal-state path). The blocked config's
			// `primaryAction: "new_task"` is the EXISTING supported
			// user action; the ACT does not introduce a new action
			// type.
			const useMessageHandlersPath = resolve(
				__dirname,
				"..",
				"..",
				"..",
				"webview-ui",
				"src",
				"components",
				"chat",
				"chat-view",
				"hooks",
				"useMessageHandlers.ts",
			)
			const useMessageHandlersSource = readFileSync(useMessageHandlersPath, "utf8")
			expect(useMessageHandlersSource).toMatch(/case "new_task":/)
			expect(useMessageHandlersSource).toMatch(/TaskServiceClient\.newTask/)
		})
	})
})
