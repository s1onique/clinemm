/**
 * Session-scoped auto-approval projection.
 *
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * This module defines a thin, ephemeral projection over the canonical
 * AutoApprove authority. It is NOT a new approval authority — every
 * effective decision still flows through:
 *
 *   1. The canonical SDK command policy (apps/vscode/src/sdk/sdk-tool-policies.ts
 *      → evaluateCommandPolicy() in @cline/core). Hard DENY remains DENY.
 *   2. isToolAutoApproved() for non-command tools, which reads the live
 *      persisted AutoApprovalSettings from StateManager.
 *
 * What this module does:
 *
 *   - Defines a narrow "SessionAutoApprovalOverride" type ("none" | "all").
 *   - Hosts a single in-memory owner of that override, scoped to the
 *     active SDK session (the Cline task/session identity produced by
 *     SdkSessionLifecycle). It is intentionally NOT a global boolean,
 *     NOT in workspaceState, NOT in globalState, NOT in StateManager.
 *   - Exposes a pure resolver `resolveEffectiveAutoApproval(persisted, override)`
 *     that yields the effective AutoApprovalSettings used by the non-command
 *     `isToolAutoApproved()` path. It does not mutate its inputs.
 *   - Exposes `resolveEffectiveHostMode(persisted, override)` for the command
 *     path: when the override is "all", commands enter the canonical command
 *     policy in `"all"` host mode; otherwise the host mode is derived from the
 *     persisted settings exactly as today (safe-only/manual).
 *
 * Hard invariants this module preserves:
 *
 *   - No persistent YOLO boolean is added to storage.
 *   - `getCommandHostAuthorization(..., persisted, ...)` is still the source
 *     of truth; we only project a different persisted-equivalent into it
 *     when the override is "all".
 *   - The persisted `AutoApprovalSettings` (in StateManager) is NEVER mutated
 *     by enabling/disabling the session override. The resolver returns a NEW
 *     object.
 *   - Hard DENY in the command policy still DENY; the override cannot bypass
 *     `host_hard_deny` or `execution_plan_invalid`.
 *   - Override lifetime is bound to the active SDK session. clearTask()
 *     cancels any in-flight task and destroys the override. New tasks start
 *     with `none`. Resuming the SAME taskId preserves it (because the SDK
 *     session id is reused across reinitExistingTaskFromId/showTaskWithId).
 */
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { Logger } from "@/shared/services/Logger"

/**
 * Session-scoped auto-approval override.
 *
 * - "none" (default): behavior is identical to the persisted AutoApprove
 *   settings; the override is a no-op projection.
 * - "all": for the duration of the active SDK session, ordinary read/edit/web/MCP
 *   categories are projected enabled and command tools enter the canonical
 *   command policy in `"all"` host mode. Hard DENY remains DENY.
 *
 * Intentionally narrow. Future ACTs may add a "selected" variant; YAGNI here.
 */
export type SessionAutoApprovalOverride = "none" | "all"

/**
 * Pure resolver: produce the effective AutoApprovalSettings used by
 * isToolAutoApproved() and getCommandHostAuthorization().
 *
 * Invariants:
 *   - Does NOT mutate `persisted`.
 *   - Returns the SAME object reference when `override === "none"`.
 *   - Returns a NEW shallow-cloned object when `override === "all"`.
 *
 * The "all" projection enables the ordinary categories (read/edit/web/MCP)
 * while preserving the legacy/external-file fields exactly as today (we do
 * NOT silently widen authority to external files).
 *
 * For command tools, callers MUST still call getCommandHostAuthorization()
 * with the effective settings — `executeSafeCommands` continues to mean
 * "safe-only" host mode. When the override is "all", the caller should pass
 * `mode === "all"` directly into commandHostAuthorization() instead of using
 * getCommandHostAuthorization(). See `resolveEffectiveHostMode()`.
 */
export function resolveEffectiveAutoApproval(
	persisted: AutoApprovalSettings,
	override: SessionAutoApprovalOverride,
): AutoApprovalSettings {
	if (override === "none") {
		return persisted
	}
	// override === "all": ordinary categories projected enabled.
	return {
		...persisted,
		actions: {
			...persisted.actions,
			readFiles: true,
			readFilesExternally: persisted.actions.readFilesExternally,
			editFiles: true,
			editFilesExternally: persisted.actions.editFilesExternally,
			executeSafeCommands: persisted.actions.executeSafeCommands,
			executeAllCommands: true,
			useBrowser: true,
			useMcp: true,
		},
	}
}

/**
 * Pure resolver: produce the effective host command mode for the current
 * override.
 *
 * Returns `"all"` when the override is active (the user has explicitly opted
 * into unattended command execution for this task). Otherwise returns
 * `"safe-only"` when the persisted executeSafeCommands toggle is on, else
 * `"manual"`. The caller (SdkController) MUST still pass this through the
 * canonical `evaluateCommandPolicy()` — the override does not bypass
 * `host_hard_deny` or `execution_plan_invalid`.
 */
export function resolveEffectiveHostMode(
	persisted: AutoApprovalSettings,
	override: SessionAutoApprovalOverride,
): "all" | "safe-only" | "manual" {
	if (override === "all") {
		return "all"
	}
	if (persisted.actions.executeSafeCommands) {
		return "safe-only"
	}
	return "manual"
}

/**
 * The single owner of the active session's auto-approval override.
 *
 * Why a class with explicit methods (not a bare module-global):
 *   - Bounded by the SdkController lifetime; we can prove no leak into a
 *     stale task because clearSessionAutoApproval() is called from the
 *     clearTask choke-point.
 *   - Discoverable: every mutation and read goes through these methods,
 *     so a code reviewer can prove the override cannot silently resurrect.
 *   - Testable: a fresh instance per test trivially isolates state.
 *
 * Threading: all methods are synchronous; the SDK coordinator's approval
 * callback already runs on the extension-host main loop, so a snapshot
 * read at entry is sufficient. No async locking required.
 */
export class SessionAutoApprovalStore {
	private current: SessionAutoApprovalOverride = "none"
	private currentSessionId: string | undefined

	/**
	 * Returns the override currently active for `sessionId`, or "none" if the
	 * override is bound to a different (or no) session. This prevents a stale
	 * override from surviving into a new task that happens to reuse sessionId.
	 */
	getOverride(sessionId: string | undefined): SessionAutoApprovalOverride {
		if (!sessionId) {
			return "none"
		}
		if (this.currentSessionId !== sessionId) {
			return "none"
		}
		return this.current
	}

	/**
	 * Activate or deactivate the session override. When `override` is "all"
	 * the store binds itself to `sessionId`; when "none" it clears (regardless
	 * of sessionId, because the same call is also the explicit "deactivate"
	 * path used by the UI toggle).
	 */
	setOverride(sessionId: string | undefined, override: SessionAutoApprovalOverride): void {
		if (override === "none") {
			this.current = "none"
			this.currentSessionId = undefined
			Logger.log(`[SessionAutoApproval] override cleared (sessionId=${sessionId ?? "<none>"})`)
			return
		}
		if (!sessionId) {
			Logger.warn("[SessionAutoApproval] refusing to enable override without sessionId")
			return
		}
		this.current = override
		this.currentSessionId = sessionId
		Logger.log(`[SessionAutoApproval] override=${override} bound to sessionId=${sessionId}`)
	}

	/**
	 * Destroy any active override. Called from the task-clear choke-point.
	 */
	clearSessionAutoApproval(): void {
		if (this.current !== "none" || this.currentSessionId !== undefined) {
			Logger.log(
				`[SessionAutoApproval] override destroyed (was=${this.current}, sessionId=${this.currentSessionId ?? "<none>"})`,
			)
		}
		this.current = "none"
		this.currentSessionId = undefined
	}

	/**
	 * Snapshot of the active override, for inclusion in getStateToPostToWebview().
	 * Always returns the bound sessionId (or undefined when inactive) so the UI
	 * can show "active for current task" without having to know the rule.
	 */
	snapshot(): { override: SessionAutoApprovalOverride; sessionId: string | undefined } {
		return {
			override: this.current,
			sessionId: this.currentSessionId,
		}
	}
}
