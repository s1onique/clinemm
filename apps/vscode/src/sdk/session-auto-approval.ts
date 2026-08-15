/**
 * Session-scoped auto-approval projection.
 *
 * ACT-CLINEMM-SESSION-AUTONOMY01 + ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01
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
 *   - Exposes `resolveSessionHostAuthorization(override)` for the command
 *     path: when the override is "all", commands enter the canonical command
 *     policy in `{ mode: "all", explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES }`
 *     so hardened envelopes are preserved (option B). Otherwise `undefined`
 *     is returned and the caller falls through to the existing
 *     `getCommandHostAuthorization(...)` flow unchanged.
 *   - Exposes `stripRequiresApproval(input)` so that when the override is
 *     active, the canonical policy's `model_escalation` rule does not
 *     reintroduce ASK after the user explicitly opted into ALL.
 *
 * CORRECTION01 also adds a one-shot pre-arm intent: the user can flip the
 * toggle before any task exists. The intent is consumed exactly once when
 * the next task obtains its session id and becomes the bound override.
 *
 * Hard invariants this module preserves:
 *
 *   - No persistent YOLO boolean is added to storage.
 *   - The canonical `evaluateCommandPolicy()` remains in the call path;
 *     we only project a different hostAuthorization into it.
 *   - The persisted `AutoApprovalSettings` (in StateManager) is NEVER mutated
 *     by enabling/disabling the session override. The resolver returns a NEW
 *     object.
 *   - Hard DENY in the command policy still DENY (it is checked at step 1,
 *     before any mode-based logic, and the override does not change this).
 *   - When the override is "all" the hostAuthorization is `{ mode: "all",
 *     explicitAllowRules: ... }` so the policy still consults allow rules
 *     first; `execution_plan_invalid` is reachable on planner failure.
 *   - Override lifetime is bound to the active SDK session. clearTask()
 *     cancels any in-flight task and destroys the override (and any armed
 *     intent). New tasks start with `none` unless the pre-arm intent was
 *     set; resuming the SAME taskId preserves it (because the SDK session
 *     id is reused across reinitExistingTaskFromId/showTaskWithId).
 */

import { type CommandHostAuthorization, commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
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
 *
 * CORRECTION01: kept for back-compat callers (tests, prior wiring). The
 * new override-aware authority is built on top via
 * `resolveSessionHostAuthorization()`, which encodes option B (see below).
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
 * ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01
 *
 * Compose the CommandHostAuthorization to feed into the canonical policy
 * lattice when the session override is active. Two design decisions live
 * here:
 *
 *  1. Option B: "Approve all for this task" means "skip human approval but
 *     retain hardened envelopes when a command has a known safe execution
 *     profile." We forward the host allow rules alongside `mode: "all"`,
 *     so the policy's per-command precedence still consults
 *     `explicitAllowRules` first (and so `execution_plan_invalid` is
 *     reachable on planner failure). Only commands with no matching rule
 *     fall through to bare `host_mode_all`. This is materially different
 *     from bare `mode: "all"`, which short-circuits at step 3 of the
 *     precedence and skips the planner entirely.
 *
 *  2. Deny rules stay absolute — they are checked at step 1, before any
 *     mode-based logic. The override does not change this. We still emit
 *     the explicit deny rules the SDK host was already configured with so
 *     that nothing in the production lattice silently weakens under
 *     session autonomy.
 *
 * Returns `undefined` when the override is inactive — callers should fall
 * through to the existing `getCommandHostAuthorization(...)` flow, which
 * already composes allow rules from persisted settings.
 */
export function resolveSessionHostAuthorization(override: SessionAutoApprovalOverride): CommandHostAuthorization | undefined {
	if (override !== "all") {
		return undefined
	}
	return commandHostAuthorization({
		mode: "all",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
	})
}

/**
 * ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01
 *
 * Strip `requires_approval` from a tool input so the canonical policy's
 * `model_escalation` rule does NOT override explicit user session
 * authority ("Approve all for this task" must mean ALL).
 *
 * Only the model hint is suppressed. The raw command payload is left
 * intact: hard deny rules, allow rules, and the planner all see the same
 * command bytes. This is intentionally NOT a hook into the policy — it
 * is an input-side filter applied ONLY when the session override is
 * active. Ordinary safe-only / manual paths remain model-honest.
 */
export function stripRequiresApproval(input: unknown): unknown {
	if (input == null || typeof input !== "object") {
		return input
	}
	const record = input as Record<string, unknown>
	if (!("requires_approval" in record)) {
		return input
	}
	const { requires_approval: _omitted, ...rest } = record
	return rest
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
 * CORRECTION01: also owns the **ephemeral pre-arm intent**: a user can
 * flip the toggle before any task exists. The intent is consumed exactly
 * once when the next task obtains a session id, and is destroyed by the
 * same clearTask/cancelTask choke-points as the active override. There is
 * NO persistent YOLO state and NO leak across tasks.
 *
 * Threading: all methods are synchronous; the SDK coordinator's approval
 * callback already runs on the extension-host main loop, so a snapshot
 * read at entry is sufficient. No async locking required.
 */
export class SessionAutoApprovalStore {
	private current: SessionAutoApprovalOverride = "none"
	private currentSessionId: string | undefined
	/**
	 * One-shot pre-arm intent. When set, the next `getOverride()` call
	 * for any session id returns this value AND consumes it. Subsequent
	 * reads see the regular bound state.
	 */
	private armedOverride: SessionAutoApprovalOverride = "none"

	/**
	 * Returns the override currently active for `sessionId`, or "none" if the
	 * override is bound to a different (or no) session. This prevents a stale
	 * override from surviving into a new task that happens to reuse sessionId.
	 *
	 * CORRECTION01: if a pre-arm intent is set, it is consumed (read once,
	 * cleared) and returned for the requested sessionId — binding the
	 * override to the new task on first read.
	 */
	getOverride(sessionId: string | undefined): SessionAutoApprovalOverride {
		if (!sessionId) {
			return "none"
		}
		// Consume the one-shot pre-arm intent: this is the moment the new
		// task obtains its session id. Bind the armed value to this session
		// and clear the arm. After this read, ordinary bound logic applies.
		if (this.armedOverride !== "none") {
			this.current = this.armedOverride
			this.currentSessionId = sessionId
			Logger.log(`[SessionAutoApproval] pre-arm intent consumed → bound to sessionId=${sessionId}`)
			this.armedOverride = "none"
			return this.current
		}
		if (this.currentSessionId !== sessionId) {
			return "none"
		}
		return this.current
	}

	/**
	 * Activate, deactivate, or arm the session override.
	 *
	 * - `override === "all"` with a `sessionId`: binds the override to the
	 *   active session.
	 * - `override === "all"` without a `sessionId`: arms a one-shot intent
	 *   for the next task (no current binding change).
	 * - `override === "none"`: clears the bound override AND any armed
	 *   intent. (One button turn-off clears both, by design — the user's
	 *   intent is "I don't want autonomy right now.")
	 */
	setOverride(sessionId: string | undefined, override: SessionAutoApprovalOverride): void {
		if (override === "none") {
			const hadArm = this.armedOverride !== "none"
			const hadBind = this.current !== "none" || this.currentSessionId !== undefined
			this.current = "none"
			this.currentSessionId = undefined
			this.armedOverride = "none"
			Logger.log(
				`[SessionAutoApproval] override cleared (sessionId=${sessionId ?? "<none>"}; bound=${hadBind}, armed=${hadArm})`,
			)
			return
		}
		// override === "all"
		if (!sessionId) {
			// Pre-arm intent: consume exactly once when the next task
			// obtains its session id.
			this.armedOverride = "all"
			Logger.log("[SessionAutoApproval] pre-arm intent set (will bind to next session)")
			return
		}
		this.current = override
		this.currentSessionId = sessionId
		Logger.log(`[SessionAutoApproval] override=${override} bound to sessionId=${sessionId}`)
	}

	/**
	 * Destroy any active override AND any pre-arm intent. Called from the
	 * task-clear choke-point (clearTask / cancelTask). This guarantees the
	 * override does not leak into a subsequent task — including a subsequent
	 * arm-then-task workflow that the user expected to consume the arm.
	 */
	clearSessionAutoApproval(): void {
		const hadArm = this.armedOverride !== "none"
		const hadBind = this.current !== "none" || this.currentSessionId !== undefined
		if (hadArm || hadBind) {
			Logger.log(
				`[SessionAutoApproval] override destroyed (was=${this.current}, sessionId=${this.currentSessionId ?? "<none>"}, armed=${this.armedOverride})`,
			)
		}
		this.current = "none"
		this.currentSessionId = undefined
		this.armedOverride = "none"
	}

	/**
	 * Snapshot of the active override, for inclusion in getStateToPostToWebview().
	 * Returns bound sessionId (or undefined when inactive) plus the armed
	 * intent, so the UI can render "active for current task" / "armed for
	 * next task" without having to know the rule.
	 */
	snapshot(): {
		override: SessionAutoApprovalOverride
		sessionId: string | undefined
		armed: SessionAutoApprovalOverride
	} {
		return {
			override: this.current,
			sessionId: this.currentSessionId,
			armed: this.armedOverride,
		}
	}

	/**
	 * Whether a pre-arm intent is currently set. Convenience predicate for
	 * the UI / webview state mirror.
	 */
	isArmed(): boolean {
		return this.armedOverride !== "none"
	}
}
