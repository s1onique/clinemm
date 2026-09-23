/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01
 *
 * PERMANENT production policy for the synchronous `Logger.log`
 * breadcrumb inside `SdkSessionEventCoordinator.logQueueEvents`.
 *
 * This module is the OWNER of the production-soundness decision.
 * The temporary diagnostic (extension-host-hotloop-diagnostic.ts)
 * observes the decision but does not own it.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE MODULE FROM THE DIAGNOSTIC
 * ============================================================================
 *
 * The CPU profile `exthost-66cdb2.cpuprofile` showed that this
 * synchronous breadcrumb, when enabled, is the dominant source of
 * extension-host CPU time under dogfood (the runtime where the LIVE
 * failure was captured). Therefore the gate that decides whether to
 * emit it must be PERMANENT — it must not be removable without a
 * deliberate change of this file.
 *
 * The temporary diagnostic (counters / nested depth / phase write
 * witness) will be removed together post-qualification per the
 * REMOVAL_TRIGGER in `extension-host-hotloop-diagnostic.ts`. If the
 * queue-log gate lived inside that temporary module, the post-removal
 * state would be:
 *
 *     remove extension-host-hotloop-diagnostic.ts
 *     BUT logQueueEvents kept using isExtensionHostHotloopQueueLogEnabled()
 *
 * which fails to compile OR forces a later cleanup edit that silently
 * changes the production repair. Both outcomes are unacceptable.
 *
 * ============================================================================
 * CONTRACT — frozen in this ACT (CORRECTION02)
 * ============================================================================
 *
 *   1. The synchronous `Logger.log` breadcrumb in `logQueueEvents`
 *      is gated behind `shouldEmitExtensionHostQueueLog()` exported
 *      from THIS module.
 *
 *   2. The default answer is `false`. Every profile — public,
 *      dogfood, or otherwise — starts with the breadcrumb
 *      suppressed. The diagnostic is forbidden from silently
 *      re-enabling the breadcrumb.
 *
 *   3. The breadcrumb is honored ONLY in dogfood builds where the
 *      operator has explicitly set the env knob
 *      `CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=<truthy>` (1 / true / yes).
 *      Public builds can never enable the breadcrumb regardless of
 *      env var.
 *
 *   4. Removing `extension-host-hotloop-diagnostic.ts` does NOT
 *      change this contract. The decision lives here.
 *
 *   5. Removing the diagnostic does NOT require touching this file.
 *      The reverse direction (removing this file) WOULD re-open
 *      the hot path — by design.
 *
 * ============================================================================
 * REMOVAL_TRIGGER
 * ============================================================================
 *
 * This module is PERMANENT for the lifetime of the extension host.
 * It is removed only when the synchronous `Logger.log` breadcrumb
 * in `logQueueEvents` itself is removed (a deliberate change to
 * the production call site, not a diagnostic cleanup).
 */

// ---------------------------------------------------------------------------
// Module-level state (PERMANENT). Default = false.
// ---------------------------------------------------------------------------

let _queueLogEnabled = false

/**
 * The single production-soundness gate. Default is `false`.
 * Even if this module's state were not initialized, `false` is
 * the only safe default — the synchronous breadcrumb is
 * DOCUMENTED to monopolize the extension-host thread when fired.
 */
export function shouldEmitExtensionHostQueueLog(): boolean {
	return _queueLogEnabled
}

/**
 * Mutator for the queue-log gate. Called from
 * `applyExtensionHostHotloopDiagnosticProfile` in
 * `dogfood-diagnostic-profile.ts` (the central dogfood resolver).
 *
 * The mutator is intentionally narrow: it accepts only the
 * resolved value from the central resolver. There is no other
 * production code path that flips this state.
 */
export function setExtensionHostQueueLogEnabled(enabled: boolean): void {
	_queueLogEnabled = enabled
}

/**
 * Resolves the queue-log gate from environment + dogfood profile.
 * Returns the new value (so callers can detect flips).
 *
 * Invariants:
 *
 *   - isDogfood === false  ->  returns false regardless of env
 *   - isDogfood === true   ->  env knob honored ONLY if truthy
 *                               (1 / true / yes)
 *   - empty / missing env  ->  returns false
 *   - non-truthy env value ->  returns false
 *
 * This function NEVER throws. It NEVER logs. It NEVER
 * touches the filesystem. It is a pure resolver.
 */
export function resolveExtensionHostQueueLogFromEnv(isDogfood: boolean, env: NodeJS.ProcessEnv): boolean {
	if (!isDogfood) {
		return false
	}
	const raw = env["CLINEMM_DIAG_HOTLOOP_QUEUE_LOG"]
	if (typeof raw !== "string" || raw.length === 0) {
		return false
	}
	const normalized = raw.trim().toLowerCase()
	return normalized === "1" || normalized === "true" || normalized === "yes"
}

/**
 * Apply the resolver and mutate the gate. Returns true if the
 * gate flipped (so callers can detect change).
 *
 * The single production resolver for the queue-log gate. Called
 * from `applyExtensionHostHotloopDiagnosticProfile` in
 * `dogfood-diagnostic-profile.ts`. There is no other production
 * call site.
 */
export function applyExtensionHostQueueLogPolicy(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	const should = resolveExtensionHostQueueLogFromEnv(isDogfood, env)
	const was = _queueLogEnabled
	if (should && !was) {
		_queueLogEnabled = true
		return { enabled: true, flipped: true }
	}
	if (!should && was) {
		_queueLogEnabled = false
		return { enabled: false, flipped: true }
	}
	return { enabled: should, flipped: false }
}
