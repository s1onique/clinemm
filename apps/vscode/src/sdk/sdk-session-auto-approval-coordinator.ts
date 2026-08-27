/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * Coordinator for the active-session `"ALL — this task"` transition.
 *
 * The UI exposes a toggle that flips the canonical SessionAutoApprovalStore
 * override for the currently-running task. The store mutation alone is
 * NOT enough for completion authority: `CoreSessionConfig.enableSubmitAndExit`
 * is frozen into the registered tool array at session construction time.
 *
 * The coordinator closes the gap by:
 *   1. After SdkController applies the canonical store mutation, this
 *      coordinator requests a bounded session rebuild via
 *      `SdkSessionRebuildScheduler` with reason `"sessionAutoApprovalOverride"`.
 *   2. During the rebuild, it reads the freshly-bound override from the
 *      store via `getOverride(sessionId)` and threads it into
 *      `sessionConfigBuilder.build({ ..., sessionAutoApprovalOverride })`.
 *   3. The new runtime now has `submit_and_exit` registered iff the new
 *      bound state implies the capability (and `requireCompletionTool`).
 *
 * The rebuild scheduler only drains when the active session is idle, so
 * an in-progress turn is never torn down mid-flight — the rebuild fires
 * at the next idle boundary, exactly the same mechanism the existing
 * mode / terminal-mode / provider / mcpTools rebuilds use.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import type { SessionAutoApprovalOverride, SessionAutoApprovalStore } from "./session-auto-approval"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkSessionAutoApprovalCoordinatorOptions {
	stateManager: StateManager
	sessions: Pick<SdkSessionLifecycle, "getActiveSession" | "replaceActiveSession" | "clearActiveSession">
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	sessionAutoApproval: SessionAutoApprovalStore
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<unknown[] | undefined>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

export class SdkSessionAutoApprovalCoordinator {
	constructor(private readonly options: SdkSessionAutoApprovalCoordinatorOptions) {}

	/**
	 * Called from `SdkController.setSessionAutoApprovalOverride` AFTER the
	 * canonical store mutation has already been applied. This method
	 * only triggers the rebuild path — the store is the single source of
	 * truth for the override value, and `setOverride(activeSessionId, override)`
	 * is what binds it.
	 *
	 * Returns `true` if a rebuild was requested, `false` otherwise.
	 *
	 * The `false` cases:
	 *   - No active session: store set the armed override; the next
	 *     initTask will pick it up via peekArmed(). No rebuild needed.
	 *   - Active session's bound override did not change: idempotent
	 *     re-arm; rebuilding would produce the same config.
	 */
	handleOverrideChanged(prev: SessionAutoApprovalOverride): boolean {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log(
				"[SessionAutoApprovalCoordinator] No active session — override armed for next task (peekArmed at next initTask)",
			)
			return false
		}

		const next = this.options.sessionAutoApproval.getOverride(activeSession.sessionId)
		if (next === prev) {
			Logger.log(
				`[SessionAutoApprovalCoordinator] Bound override unchanged (${next}) — no rebuild needed`,
			)
			return false
		}

		Logger.log(
			`[SessionAutoApprovalCoordinator] Override transition detected (prev=${prev}, next=${next}) — requesting rebuild for active session ${activeSession.sessionId}`,
		)
		const sessionId = activeSession.sessionId
		this.options.rebuilds.request("sessionAutoApprovalOverride", async () => {
			await this.restartSessionForOverrideChange(sessionId)
		})
		return true
	}

	private async restartSessionForOverrideChange(sessionId: string): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log(
				"[SessionAutoApprovalCoordinator] Active session disappeared before rebuild — aborting",
			)
			return
		}
		// Defensive re-check: session id must still match (a parallel
		// clearTask/replace could have advanced the fence).
		if (activeSession.sessionId !== sessionId) {
			Logger.log(
				`[SessionAutoApprovalCoordinator] Active session id changed (was ${sessionId}, now ${activeSession.sessionId}) — aborting`,
			)
			return
		}

		const { sdkHost: oldManager, sessionId: currentSessionId } = activeSession

		// Read the freshly-bound override from the canonical store. Since
		// `setOverride(activeSessionId, override)` was the canonical
		// mutation site, `getOverride(activeSessionId)` MUST return the
		// new bound value. If it does not, the store invariant is broken
		// and we abort loudly.
		const boundOverride = this.options.sessionAutoApproval.getOverride(currentSessionId)

		Logger.log(
			`[SessionAutoApprovalCoordinator] Restarting session ${currentSessionId} for sessionAutoApprovalOverride transition (override=${boundOverride})`,
		)

		// Silent rebuild: no chat message; the transition is transparent.
		this.options.messages.emitSessionEvents([], {
			type: "status",
			payload: { sessionId: currentSessionId, status: "running" },
		})

		try {
			const cwd = await this.options.getWorkspaceRoot()
			const modeValue = this.options.stateManager.getGlobalSettingsKey("mode")
			const mode: Mode = modeValue === "plan" || modeValue === "act" ? modeValue : "act"
			const config = await this.options.sessionConfigBuilder.build({
				cwd,
				mode,
				// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
				// thread the freshly-bound override so the new config's
				// enableSubmitAndExit reflects the new capability. This is
				// the load-bearing wiring that closes the active-session
				// gap: the user's "ALL — this task" click now reaches the
				// new runtime's tool registry.
				sessionAutoApprovalOverride: boundOverride,
			})
			config.sessionId = currentSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, currentSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				initialMessages: initialMessages as InitialMessages,
				disposeReason: "sessionAutoApprovalOverride",
			})
			if (!restartResult) {
				// Race: replaceActiveSession returned undefined WITHOUT
				// successfully installing a successor. This can happen
				// when the lifecycle's own identity fence rejected the
				// replacement — either (a) `oldSession !== expectedSession`
				// (some other rebuild changed the active reference while
				// we were inside the awaited endActiveSession) or (b)
				// the post-start supersession fence fired.
				//
				// Hand off to applyRebuildFailurePolicy, which checks
				// REFERENCE identity against the captured `activeSession`.
				await this.applyRebuildFailurePolicy({
					originalActiveSession: activeSession,
					currentSessionId,
					boundOverride,
					error: undefined,
				})
				return
			}
			const { startResult } = restartResult

			if (startResult.sessionId !== currentSessionId) {
				Logger.warn(
					`[SessionAutoApprovalCoordinator] Override-change restart returned a new session ID (${startResult.sessionId}); preserving task ID ${currentSessionId} for UI continuity`,
				)
			}

			this.options.messages.emitSessionEvents([], {
				type: "status",
				payload: { sessionId: startResult.sessionId, status: "idle" },
			})

			await this.options.postStateToWebview()
			Logger.log(
				`[SessionAutoApprovalCoordinator] Session restarted for sessionAutoApprovalOverride: ${currentSessionId} -> ${startResult.sessionId}`,
			)
		} catch (error) {
			Logger.error(
				"[SessionAutoApprovalCoordinator] Failed to restart session for sessionAutoApprovalOverride:",
				error,
			)
			await this.applyRebuildFailurePolicy({
				originalActiveSession: activeSession,
				currentSessionId,
				boundOverride,
				error,
			})
		}
	}

	/**
	 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
	 * Bounded failure policy shared by the `replaceActiveSession ===
	 * undefined` race branch and the general `catch`. Called exactly
	 * once per failed rebuild attempt.
	 *
	 * Reference-identity policy (the reviewer's bounded correction):
	 * the lifecycle's own ownership check at
	 * `SdkSessionLifecycle.replaceActiveSession` (line 369 in
	 * sdk-session-lifecycle.ts) is `oldSession !== expectedSession`,
	 * NOT a session-id comparison. `replaceActiveSession` is
	 * deliberately constructed to REUSE `currentSessionId` (the new
	 * config sets `config.sessionId = currentSessionId`), so a
	 * competing rebuild can install a fresh `ActiveSession` object
	 * whose `.sessionId` equals `currentSessionId`. Comparing only
	 * session ids would mistake the winner for the stale old one.
	 *
	 * The lifecycle ALSO disposes the old session BEFORE awaiting the
	 * replacement (line 377: `await endActiveSession(...)` then line
	 * 382: `await startNewSession(...)`). So the production failure
	 * chronology is:
	 *
	 *   replaceActiveSession(expectedSession=OLD)
	 *     ↓
	 *   endActiveSession() succeeds → this.activeSession = undefined
	 *     ↓
	 *   startNewSession() throws
	 *     ↓
	 *   catch → applyRebuildFailurePolicy
	 *     ↓
	 *   getActiveSession() === undefined  ← OLD is gone, no winner yet
	 *
	 * The previous P0 fix returned early in this case because it
	 * compared only `sessionId` and `undefined` doesn't match. The
	 * user's "all" intent was lost. This corrected helper handles
	 * three cases by REFERENCE identity:
	 *
	 *   CASE 1  postActiveSession === originalActiveSession
	 *           → OLD runtime still installed. Clear it.
	 *           → Re-arm the intent.
	 *
	 *   CASE 2  postActiveSession === undefined
	 *           → Replacement disposed OLD but failed before
	 *             installing the successor. No winner exists; do
	 *             not call clearActiveSession (it would be a no-op
	 *             but the helper should not pretend to clear
	 *             something it didn't clear).
	 *           → Re-arm the intent. The OLD bound value's
	 *             currentSessionId is orphaned by the dispose, so
	 *             this is required for the next task to see "all".
	 *
	 *   CASE 3  postActiveSession !== originalActiveSession
	 *           (and postActiveSession !== undefined)
	 *           → Another lifecycle operation won. Its sessionId
	 *             MAY equal currentSessionId (the rebuild
	 *             deliberately reuses it). Do NOT clobber the
	 *             winner — log and return. The winner's bound
	 *             override is whatever its own rebuild produced.
	 */
	private async applyRebuildFailurePolicy(args: {
		originalActiveSession: object
		currentSessionId: string
		boundOverride: SessionAutoApprovalOverride
		error: unknown
	}): Promise<void> {
		const { originalActiveSession, currentSessionId, boundOverride, error } = args
		const postActiveSession = this.options.sessions.getActiveSession()

		if (postActiveSession === undefined) {
			// CASE 2: endActiveSession ran but the replacement
			// startNewSession threw. The OLD bound value's
			// currentSessionId is orphaned. Re-arm the intent —
			// but no clearActiveSession is needed (it's already
			// cleared by the lifecycle's own dispose).
			Logger.log(
				`[SessionAutoApprovalCoordinator] Rebuild failed after dispose (no successor installed); preserving intent via re-arm`,
			)
		} else if (postActiveSession === originalActiveSession) {
			// CASE 1: OLD still installed. Drop it so it cannot
			// continue with the stale `submit_and_exit` toolset.
			await this.options.sessions.clearActiveSession("sessionAutoApprovalOverrideFailure")
		} else {
			// CASE 3: a competing rebuild installed a fresh
			// ActiveSession object (same sessionId, different
			// reference). Do NOT clobber the winner.
			Logger.log(
				`[SessionAutoApprovalCoordinator] Rebuild failure observed but another rebuild owns the active session slot (winner.sessionId=${postActiveSession.sessionId}); not clobbering the winner`,
			)
			return
		}

		if (boundOverride === "all") {
			// Re-arm: convert the dying bound value into the
			// next-task arm. The next initTask's
			// `consumePendingOverride(newSessionId)` will bind it.
			this.options.sessionAutoApproval.setOverride(undefined, "all")
			Logger.log(
				`[SessionAutoApprovalCoordinator] Rebuild failed; "all" intent re-armed for next task via setOverride(undefined, "all")`,
			)
		} else {
			// boundOverride === "none": user explicitly turned
			// autonomy OFF — preserve that by leaving the arm clear.
			// (setOverride(... "none") clears both bound and arm; we
			// already cleared the bound via the lifecycle's dispose
			// (CASE 2) or via clearActiveSession (CASE 1). If a
			// stray arm existed from a previous toggle, clear it
			// too so the next task doesn't inherit stale intent.)
			this.options.sessionAutoApproval.setOverride(undefined, "none")
			Logger.log(
				`[SessionAutoApprovalCoordinator] Rebuild failed; "none" intent enforced — both bound and arm cleared`,
			)
		}

		const errorMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "error",
			text: `Failed to apply session auto-approval override change (${error instanceof Error ? error.message : String(error)}). The active session was terminated to prevent a stale completion toolset. The new override (${boundOverride}) will take effect on the next task you start.`,
			partial: false,
		}
		this.options.messages.appendAndEmit([errorMessage], {
			type: "status",
			payload: { sessionId: currentSessionId, status: "error" },
		})
		await this.options.postStateToWebview()
	}
}
