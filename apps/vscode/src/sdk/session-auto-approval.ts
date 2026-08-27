/**
 * Session-scoped auto-approval projection.
 *
 * ACT-CLINEMM-SESSION-AUTONOMY01 + ...-CORRECTION01 + ...-CORRECTION02
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
 * CORRECTION02 lifecycle invariants (vs CORRECTION01):
 *
 *   - getOverride() is PURE — it returns the bound override for a given
 *     session id without consuming any pre-arm intent. Pre-arm consumption
 *     lives in consumePendingOverride(sessionId), which is called exactly
 *     once at the authoritative session-id allocation site
 *     (SdkSessionLifecycle.startNewSession) and nowhere else. CORRECTION01's
 *     implementation made getOverride() consume state, which is brittle:
 *     the first approval callback wins, and lifecycle order is no longer
 *     explicit.
 *
 *   - clearTask/cancelTask call clearActiveOverride() (NOT the union
 *     clearSessionAutoApproval()). A pre-armed intent for the next task
 *     therefore survives cancellation of the current task, which is what
 *     the user actually wants when they arm a follow-up task.
 *
 *   - resolveSessionHostAuthorization(baseAuth, override) composes OVER
 *     baseAuth instead of manufacturing a fresh authorization. This makes
 *     explicitDenyRules preservation structural rather than conventional.
 *
 *   - setOverride(undefined, "none") still clears both the bound override
 *     AND the pre-arm intent — this is the UI toggle's "off" semantic,
 *     distinct from the production lifecycle hooks.
 *
 * What this module does:
 *
 *   - Defines a narrow "SessionAutoApprovalOverride" type ("none" | "all").
 *   - Hosts a single in-memory owner of that override, scoped to the
 *     active SDK session. It is intentionally NOT a global boolean,
 *     NOT in workspaceState, NOT in globalState, NOT in StateManager.
 *   - Exposes a pure resolver `resolveEffectiveAutoApproval(persisted, override)`
 *     that yields the effective AutoApprovalSettings used by the non-command
 *     `isToolAutoApproved()` path. It does not mutate its inputs.
 *   - Exposes `resolveSessionHostAuthorization(baseAuth, override)` for the
 *     command path: when the override is "all", the host authorization is
 *     composed OVER baseAuth (preserving explicitDenyRules) with mode:"all"
 *     + the base's explicitAllowRules (falling back to
 *     DEFAULT_COMMAND_HOST_ALLOW_RULES only when the base has none).
 *     Otherwise `undefined` is returned and the caller falls through to
 *     the existing `getCommandHostAuthorization(...)` flow unchanged.
 *   - Exposes `stripRequiresApproval(input)` so that when the override is
 *     active, the canonical policy's `model_escalation` rule does not
 *     reintroduce ASK after the user explicitly opted into ALL.
 *
 * CORRECTION01 added the pre-arm intent. CORRECTION02 made its lifecycle
 * explicit (pure read + authoritative consume) and made the host-authority
 * composition defensive against deny-rule regression.
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
 *   - The composed host authorization preserves explicitDenyRules from the
 *     base (structural guarantee; today empty in production but available
 *     for future deny sources).
 *   - When the override is "all" the hostAuthorization is `{ mode: "all",
 *     explicitAllowRules: base.explicitAllowRules ?? DEFAULT_..., ...base }`
 *     so the policy still consults allow rules first; `execution_plan_invalid`
 *     is reachable on planner failure.
 *   - Override lifetime is bound to the active SDK session. clearTask() and
 *     cancelTask() destroy only the bound override (clearActiveOverride);
 *     a pre-armed intent survives cancellation of the current task and is
 *     consumed exactly once by consumePendingOverride() when the next task
 *     obtains its session id.
 */
import { type CommandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
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
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * Inputs to the explicit completion authority derivation. All four facts
 * are explicit booleans so the conservation matrix (CAI-13A/13B/13C) can
 * be exercised independently of the SDK side.
 *
 *   YOLO_REQUESTED        isYoloSessionRequested(persisted, override)
 *   SEATBELT_SELECTED     resolveExperimentalSandboxMode() === "seatbelt-experimental"
 *   SEATBELT_AVAILABLE    (await getSandboxBackend(...)) !== undefined
 *   interactive           true for VS Code (always); CLI uses a separate path
 */
export interface ExplicitCompletionAuthorityInputs {
	interactive: boolean
	persisted: AutoApprovalSettings
	override: SessionAutoApprovalOverride
	seatbeltSelected: boolean
	seatbeltAvailable: boolean
}

/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * Authoritative "is the session requesting autonomous execution?" predicate.
 *
 * The plan (IMPLEMENTATION01 §2 + §4):
 *
 *   isYoloSessionRequested(persisted, override) =
 *     override === "all"
 *     ||
 *     (
 *       persisted.actions.readFiles
 *       && persisted.actions.editFiles
 *       && persisted.actions.executeSafeCommands
 *       && persisted.actions.useBrowser
 *       && persisted.actions.useMcp
 *     )
 *
 * Invariants:
 *   - Pure. No reads from StateManager, globalState, or session id.
 *   - Does NOT touch Seatbelt state (fact 2 is a separate concern).
 *   - The CLI --yolo axis is intentionally NOT consulted here — it is an
 *     upstream distinction (VS Code auto-approval is the ClineMM user-facing
 *     YOLO toggle; the CLI preset is the runtime's broader skip-approval
 *     mode, owned by `@cline/core`).
 *
 * Schema-coverage test (RED a.5) iterates the canonical 5-key set; legacy
 * compatibility fields (`readFilesExternally`, `editFilesExternally`,
 * `executeAllCommands`) are explicitly excluded (RED a.6).
 */
export function isYoloSessionRequested(
	persisted: AutoApprovalSettings,
	override: SessionAutoApprovalOverride,
): boolean {
	if (override === "all") {
		return true
	}
	return (
		persisted.actions.readFiles === true &&
		persisted.actions.editFiles === true &&
		persisted.actions.executeSafeCommands === true &&
		persisted.actions.useBrowser === true &&
		persisted.actions.useMcp === true
	)
}

/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * Pure derivation of `explicitCompletionAuthority` from the four facts:
 *
 *   explicitCompletionAuthority =
 *     interactive
 *     && YOLO_REQUESTED
 *     && SEATBELT_SELECTED
 *     && SEATBELT_AVAILABLE
 *
 * This helper is the single owner of the conjunction. The four facts are
 * explicit booleans so the conservation matrix (CAI-13A/13B/13C) is
 * testable without an integration harness.
 *
 * CAI-13B is the load-bearing substrate-broken case:
 *   interactive=true, YOLO_REQUESTED=true, SEATBELT_SELECTED=true,
 *   SEATBELT_AVAILABLE=false → explicitCompletionAuthority=false
 *
 * Caller is responsible for resolving the four facts from their canonical
 * sources at the buildSessionConfig seam (cline-session-factory.ts).
 */
export function deriveExplicitCompletionAuthority(
	inputs: ExplicitCompletionAuthorityInputs,
): boolean {
	return (
		inputs.interactive === true &&
		isYoloSessionRequested(inputs.persisted, inputs.override) &&
		inputs.seatbeltSelected === true &&
		inputs.seatbeltAvailable === true
	)
}

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
 * ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION02
 *
 * Compose the CommandHostAuthorization to feed into the canonical policy
 * lattice when the session override is active. **Composes over** the
 * existing `baseAuth` rather than manufacturing a fresh one, so:
 *
 *   - Any `explicitDenyRules` already configured on the host survive the
 *     override (today: absent in production, but injected by tests and
 *     available for future deny sources). CORRECTION01 dropped these;
 *     CORRECTION02 preserves them by spreading.
 *   - Any existing `explicitAllowRules` on the host are kept when set
 *     (we only fall back to DEFAULT_COMMAND_HOST_ALLOW_RULES when the
 *     host has none). This avoids accidentally widening a host that
 *     already has a narrower curated rule set.
 *
 * Two semantic decisions still live here:
 *
 *  1. Option B (carried from CORRECTION01): we project the host
 *     authorization to `mode: "all"` so the canonical policy's
 *     per-command precedence still consults `explicitAllowRules`
 *     first (and so `execution_plan_invalid` is reachable on planner
 *     failure). Only commands with no matching rule fall through to
 *     bare `host_mode_all`. This is materially different from a bare
 *     `mode: "all"` authorization, which short-circuits at step 3 of
 *     the precedence and skips the planner entirely.
 *
 *  2. Deny rules stay absolute — they are checked at step 1, before any
 *     mode-based logic. The override does not change this. By composing
 *     over `baseAuth`, we make that guarantee structural: the call
 *     site cannot accidentally drop the deny rules.
 *
 * Returns `undefined` when the override is inactive — callers fall through
 * to the existing `getCommandHostAuthorization(...)` flow unchanged.
 */
export function resolveSessionHostAuthorization(
	baseAuth: CommandHostAuthorization,
	override: SessionAutoApprovalOverride,
): CommandHostAuthorization | undefined {
	if (override !== "all") {
		return undefined
	}
	const allowRules = baseAuth.explicitAllowRules ?? DEFAULT_COMMAND_HOST_ALLOW_RULES
	return {
		...baseAuth,
		mode: "all",
		explicitAllowRules: allowRules,
	}
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
 *     stale task because clearActiveOverride() is called from the
 *     clearTask/cancelTask choke-points.
 *   - Discoverable: every mutation and read goes through these methods,
 *     so a code reviewer can prove the override cannot silently resurrect.
 *   - Testable: a fresh instance per test trivially isolates state.
 *
 * CORRECTION01: also owns the **ephemeral pre-arm intent**: a user can
 * flip the toggle before any task exists.
 *
 * CORRECTION02: the lifecycle is now explicit:
 *   - getOverride() is PURE — never consumes intent.
 *   - consumePendingOverride(newSessionId) is the ONLY arm-consumer; it is
 *     called exactly once at the authoritative session-id allocation site.
 *   - clearActiveOverride() destroys only the bound override; the pre-arm
 *     survives the cancellation of the current task (so an arm-then-cancel
 *     workflow can still let the next task start in ALL mode).
 *   - clearPendingArm() destroys only the pre-arm.
 *   - clearSessionAutoApproval() is the legacy union of both; the
 *     production lifecycle prefers the targeted methods above.
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
	/**
	 * Read the override bound to `sessionId`. **Pure** — does not consume any
	 * pre-arm intent. Lifecycle transitions that allocate a new session id
	 * MUST call `consumePendingOverride(sessionId)` exactly once at the
	 * authoritative allocation point (not here, since `getOverride` is called
	 * on every approval request and we cannot tie lifecycle to queries).
	 *
	 * Returns "none" when:
	 *   - sessionId is undefined
	 *   - the bound override is for a different session (prevents stale-task leak)
	 *   - the store is entirely inactive
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
	 * Consume any pending pre-arm intent and bind it to `sessionId`.
	 *
	 * This is the ONLY method that consumes the arm. Called from the
	 * authoritative session-id-allocation site (SdkSessionLifecycle.startNewSession
	 * after `startResult.sessionId` becomes the active session id) and from
	 * the resume path (same id is reused, so this is a no-op when the arm is
	 * empty).
	 *
	 * Returns `true` if an arm was consumed (and the override was bound),
	 * `false` if no arm was set.
	 *
	 * `consumePendingOverride` MUST NOT be called twice for the same session
	 * id with an arm in between — by design the arm is one-shot. Calling it
	 * twice with no intervening arm is safe (returns false).
	 */
	consumePendingOverride(sessionId: string): boolean {
		if (this.armedOverride === "none") {
			return false
		}
		this.current = this.armedOverride
		this.currentSessionId = sessionId
		this.armedOverride = "none"
		Logger.log(`[SessionAutoApproval] pre-arm intent consumed → bound to sessionId=${sessionId}`)
		return true
	}

	/**
	 * Activate, deactivate, or arm the session override.
	 *
	 * - `override === "all"` with a `sessionId`: binds the override to the
	 *   active session.
	 * - `override === "all"` without a `sessionId`: arms a one-shot intent
	 *   for the next task (no current binding change).
	 * - `override === "none"`: clears the bound override AND any armed
	 *   intent. (The UI toggle explicitly means "I don't want autonomy
	 *   right now" — that covers both the current task and any pending
	 *   next-task arm. clearTask/cancelTask, in contrast, only call
	 *   `clearActiveOverride()` so a pre-arm survives the cancellation of
	 *   the previous task.)
	 */
	setOverride(sessionId: string | undefined, override: SessionAutoApprovalOverride): void {
		if (override === "none") {
			// UI toggle: explicit "off" clears both bound AND arm.
			// Distinct from clearSessionAutoApproval() which is the union of
			// the two clear-* methods below; calling the split methods keeps
			// each one's log path honest.
			this.clearActiveOverride()
			this.clearPendingArm()
			void sessionId // accepted for symmetry with setOverride(... , "all")
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
	 * Destroy ONLY the bound override. Does NOT touch the pre-arm intent.
	 * Called from the task-clear choke-point (clearTask) and from cancelTask.
	 *
	 * Cancellation of the currently-running task should NOT erase a pre-arm
	 * intent that exists specifically for the not-yet-created next task — the
	 * user may have explicitly armed the next task before cancelling this one.
	 * Cancellation of the current task means "stop this one", not "abort my
	 * plans for the next one".
	 */
	clearActiveOverride(): void {
		const hadBind = this.current !== "none" || this.currentSessionId !== undefined
		if (hadBind) {
			Logger.log(
				`[SessionAutoApproval] active override cleared (was=${this.current}, sessionId=${this.currentSessionId ?? "<none>"})`,
			)
		}
		this.current = "none"
		this.currentSessionId = undefined
	}

	/**
	 * Destroy ONLY the pre-arm intent. Does NOT touch the bound override.
	 * Called when the user explicitly disarms via the UI toggle without an
	 * active task (setOverride(undefined, "none") also calls this).
	 */
	clearPendingArm(): void {
		if (this.armedOverride !== "none") {
			Logger.log(`[SessionAutoApproval] pending arm cleared (was=${this.armedOverride})`)
		}
		this.armedOverride = "none"
	}

	/**
	 * Destroy the bound override AND the pre-arm intent. Legacy union of
	 * clearActiveOverride() + clearPendingArm(); kept for callers that want
	 * a full reset. The production lifecycle (clearTask/cancelTask) should
	 * prefer clearActiveOverride() to preserve a separately-armed next-task
	 * intent across the current task's cancellation.
	 */
	clearSessionAutoApproval(): void {
		this.clearActiveOverride()
		this.clearPendingArm()
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

	/**
	 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
	 * Peek the armed override WITHOUT consuming it. `consumePendingOverride`
	 * remains the sole consumer (called from the session-id allocation site
	 * after `startResult.sessionId` becomes the active session id). This
	 * peek exists so the authoritative completion-authority derivation at
	 * `buildSessionConfig` time can read the pending intent before the
	 * session id is allocated — and BEFORE the consume happens, so the
	 * rely-by-construction guarantee is preserved.
	 *
	 * Returns "none" when no arm is set. Does NOT mutate state.
	 */
	peekArmed(): SessionAutoApprovalOverride {
		return this.armedOverride
	}
}
