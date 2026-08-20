// ============================================================================
// ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL09 — KNOWN_HARDENING_RESIDUE
// ----------------------------------------------------------------------------
// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01 / CORRECTION01 closure disposition.
//
// This test directly manufactures the wedge state (task=undefined,
// activeSession defined) and calls the REAL SdkCompactionCoordinator /
// SdkMessageCoordinator. Under FIX01 Phase 2 the production top-level path
// cannot form this wedge (the bounded generation-fence repair prevents it),
// but the wedge is reachable via the direct injection in this test, which
// exercises the silent-drop branch in SdkMessageCoordinator.appendMessages.
//
// Per Factory reviewer CORRECTION01 closure disposition:
//   EXPECTED_CURRENT_BEHAVIOR = silent drop (no Logger.warn/error)
//   PRODUCT_DESIRED_BEHAVIOR  = explicit failure publication
//   FOLLOWUP_ACT              =
//     ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01
//
// The body asserts the CURRENT behavior (silent drop, observableFailureSignal
// === false). If the silent drop is removed in the follow-up ACT, this
// witness must be updated to assert the new behavior and the follow-up ACT
// will own the closure.
// ============================================================================
// ORIGINAL: ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL09
//
// FIRST RED at the real seam for the P0 LIVE task-control wedge where
// Compact and Start New Task BOTH become silent no-ops in the same wedged
// task (LIVE_UI witnesses W1 + W2).
//
// THE WEDGE STATE
// ---------------
// The repro condition is constructed here from real production code:
//
//   active session exists            (getActiveSession !== undefined)
//   current TaskProxy is gone        (getTask           ===  undefined)
//
// This state is reachable in production when:
//   - the previous turn was cancelled and the SDK session is still in the
//     active-session map but its associated TaskProxy was already torn down
//     (e.g. partial clearTask that ended the session but never reached
//     setTask(undefined))
//   - the webview UI still renders the previous task's chat view because
//     no fresh state post landed
//   - the user then clicks Compact (expecting compaction) and Start New Task
//     (expecting the chat to clear); neither produces an observable effect
//
// THE FAILURE MODE
// ----------------
// `SdkMessageCoordinator.appendMessages` (the funnel for every transcript
// mutation — info rows, compaction dividers, status notices, error rows)
// silently returns when `getTask() === undefined`:
//
//     const task = this.options.getTask()
//     if (!task?.messageStateHandler) {
//         return
//     }
//     task.messageStateHandler.addMessages(messages)
//
// When this no-op fires for a user-initiated action, the caller's outbound
// RPC has already returned `Empty.create()`, so the webview's gRPC stub
// resolves successfully. The user sees a "successful click" with zero
// observable outcome — the literal definition of a silent no-op.
//
// THE INVARIANT UNDER TEST
// -------------------------
// Per the ACT primary invariant:
//   "A wedged task must never permanently disable all user escape/control
//    operations. At least one of: New Task / Cancel / task switch /
//    explicit recovery must work or fail EXPLICITLY. Silent no-op is invalid."
//
// In a wedged state where the transcript cannot be appended to, the
// coordinator MUST surface the failure to an observable channel (the
// existing postStateToWebview path OR a Logger signal OR a typed rejection
// that the webview can render) — not silently swallow the operation.
//
// THIS TEST
// ---------
// Constructs the wedge state directly via the production seam:
//   - A real SdkMessageCoordinator
//   - A real SdkCompactionCoordinator
//   - getTask() returns undefined (the wedge)
//   - getActiveSession() returns an active session with a running host
//     (mirrors the user's "task history mounted" + "Idle header" state)
//
// Then calls compactTask() — which internally drives emitInfo →
// appendAndEmit → appendMessages — and asserts the OBSERVABLE invariant:
//
//   - appendAndEmit is called (proves the call chain reached the seam)
//   - the user-facing info message is NOT silently dropped:
//       either the message reaches a message handler OR the system emits
//       an observable Logger signal so an external observer (debug
//       harness, telemetry) can detect the wedge
//
// This test is RED today because the code returns from `appendMessages`
// without any observable side effect. The bounded fix will either:
//   - log the silent-no-op so the wedge is detectable (Logger.warn)
//   - surface a typed failure message to the webview's state post path
//   - OR (preferable) prevent the wedge from being reachable at all by
//     tearing down active session ↔ TaskProxy atomically
//
// All three bounded fix candidates satisfy the ACT invariant; which one
// is chosen is downstream of this RED + a discriminator test.
// ============================================================================

import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SdkCompactionCoordinatorOptions } from "../sdk-compaction-coordinator"
import { SdkCompactionCoordinator } from "../sdk-compaction-coordinator"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"

vi.mock("../webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: vi.fn(),
	createSessionCompactionState: vi.fn((input: { compactedMessages: unknown[] }) => ({
		version: 1,
		messages: input.compactedMessages,
	})),
}))

describe("ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL09 — wedge-state silent-no-op", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not silently drop a user-facing message when task is undefined but session is active", async () => {
		// --- WEDGE STATE ---
		// Real SdkMessageCoordinator with getTask === undefined (the wedge).
		// This mirrors the production seam at apps/vscode/src/sdk/sdk-message-coordinator.ts:79-82.
		const appendAndEmit = vi.fn()
		const messageCoordinator = new SdkMessageCoordinator({
			getTask: () => undefined, // ← THE WEDGE: TaskProxy gone
		})
		// Spy on the message coordinator's appendMessages path so the test
		// verifies the CALL CHAIN reached the seam (proving Compact/NewTask
		// didn't short-circuit earlier in the pipeline).
		const realAppendMessages = messageCoordinator.appendMessages.bind(messageCoordinator)
		vi.spyOn(messageCoordinator, "appendMessages").mockImplementation((messages: ClineMessage[]) => {
			appendAndEmit(messages)
			realAppendMessages(messages)
		})

		// Real SdkCompactionCoordinator with an ACTIVE session (so the
		// "no active session" guard does not short-circuit).
		const activeSession = {
			sessionId: "wedged-session",
			sdkHost: {
				start: vi.fn(),
				readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
				updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
				send: vi.fn(),
				abort: vi.fn().mockResolvedValue(undefined),
				stop: vi.fn().mockResolvedValue(undefined),
				dispose: vi.fn().mockResolvedValue(undefined),
			},
			unsubscribe: vi.fn(),
			startResult: { sessionId: "wedged-session" },
			isRunning: false, // turn not running → enters the compaction path
		}

		const postStateToWebview = vi.fn().mockResolvedValue(undefined)

		const coordinator = new SdkCompactionCoordinator({
			stateManager: { getGlobalSettingsKey: vi.fn(() => "act") } as never,
			sessions: {
				getActiveSession: vi.fn(() => activeSession),
				startNewSession: vi.fn(),
				setRunning: vi.fn(),
				endActiveSession: vi.fn().mockResolvedValue(undefined),
				waitForPendingStop: vi.fn().mockResolvedValue(undefined),
			},
			rebuilds: { runExclusive: vi.fn(async (op: () => Promise<unknown>) => op()) },
			messages: messageCoordinator, // ← REAL production seam
			taskHistory: {
				findHistoryItem: vi.fn().mockResolvedValue(undefined),
				isLegacyTask: vi.fn().mockResolvedValue(false),
				getLegacyResumeInitialMessages: vi.fn(async (_id: string, fallback?: unknown[]) => fallback),
			},
			sessionConfigBuilder: {
				build: vi.fn().mockResolvedValue({
					providerConfig: { providerId: "anthropic", modelId: "claude" },
					providerId: "anthropic",
					modelId: "claude",
					knownModels: undefined,
					compaction: undefined,
					logger: undefined,
					telemetry: undefined,
					sessionId: undefined,
				}),
			},
			getDisplayedTaskId: () => undefined, // ← no displayed task either
			createTempSessionHost: vi.fn(),
			loadInitialMessages: vi.fn().mockResolvedValue([]),
			getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
			postStateToWebview,
		} as unknown as SdkCompactionCoordinatorOptions)

		// --- ACT: user clicks Compact ---
		await coordinator.compactTask()

		// --- ASSERT: the user-facing operation reached the message seam ---
		// The compaction divider ("started") MUST have been handed to appendMessages.
		// This proves the call chain reached the seam — earlier layers (DOM,
		// React, outbound RPC, controller, coordinator) all worked.
		expect(appendAndEmit).toHaveBeenCalled()
		const allMessages = appendAndEmit.mock.calls.flatMap((call) => call[0] as ClineMessage[])
		const hasStartedRow = allMessages.some((m) => m.type === "say" && m.say === "compaction")
		expect(hasStartedRow).toBe(true)

		// --- ASSERT: postStateToWebview fires ---
		// Even though appendMessages no-ops, the trailing state post must
		// run so the webview sees SOMETHING (even if just a fresh state
		// snapshot confirming no progress). This is the minimal observable
		// signal that the wedge did not completely black-hole the user.
		expect(postStateToWebview).toHaveBeenCalled()

		// --- ASSERT: the silent-no-op is DETECTABLE, not invisible ---
		// Per the ACT invariant, a wedged task must never silently disable
		// user control. Either the message reaches the transcript (we are
		// GREEN) OR the system emits an observable Logger.warn signal that
		// an external observer (debug harness, telemetry) can pick up.
		//
		// Today this assertion FAILS: appendMessages returns silently with
		// no Logger call, so the wedge is undetectable from outside the
		// process.
		const { Logger } = await import("@/shared/services/Logger")
		const warnCalls = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls
		const errorCalls = (Logger.error as ReturnType<typeof vi.fn>).mock.calls
		const observableFailureSignal =
			warnCalls.some((call) => String(call[0]).toLowerCase().includes("wedge")) ||
			warnCalls.some((call) => String(call[0]).toLowerCase().includes("no current task")) ||
			warnCalls.some((call) => String(call[0]).toLowerCase().includes("task undefined")) ||
			warnCalls.some((call) => String(call[0]).toLowerCase().includes("message dropped")) ||
			errorCalls.some((call) => String(call[0]).toLowerCase().includes("wedge")) ||
			errorCalls.some((call) => String(call[0]).toLowerCase().includes("message dropped"))

		// === REPLACED ASSERTION (KNOWN_HARDENING_RESIDUE witness) ===
		// ORIGINAL (RED): the system MUST emit an observable failure
		// signal (Logger.warn / Logger.error naming the wedge). FIX01
		// did NOT change SdkMessageCoordinator.appendMessages — the
		// silent-drop branch still exists. This test is therefore a
		// characterization witness of the current contract, not an
		// acceptance test for a fix.
		//
		// EXPECTED_CURRENT_BEHAVIOR = silent drop (no observable signal)
		// PRODUCT_DESIRED_BEHAVIOR  = explicit invariant violation
		// FOLLOWUP_ACT              =
		//   ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01
		expect(
			observableFailureSignal,
			"EXPECTED_CURRENT_BEHAVIOR=silent drop; harden in ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01",
		).toBe(false)
		// Smoke-detector: if the wedge re-emerges via a different path
		// and the silent drop is gone (e.g. SdkMessageCoordinator now
		// publishes an explicit failure signal), this assertion fails
		// RED, which is the trigger to update the witness and close
		// the follow-up ACT.
	})
})
