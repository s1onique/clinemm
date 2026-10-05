// Profile-resolver dependency. Pulled at the top of the module rather than
// as a late import: the profile resolver has no SdkSessionLifecycle deps
// and this module has no profile-resolver deps, so there is no cycle to
// avoid. TypeScript forbids `import` statements below executable code, so
// keeping the import at the top is required for the compiler.
import { isDogfoodRuntime } from "./dogfood-runtime-profile"

/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01 — CALLER-REASON DISCRIMINATOR.
 *
 * Closed-runtime, dogfood-only diagnostic that records the caller-reason
 * string of every `SdkSessionLifecycle.endActiveSession(reason)` invocation
 * (the single funnel into the storage writer `clearActiveSessionReference`).
 *
 * Why this exists
 * ---------------
 * The frozen LIVE chronology proves the BCB barrier is destroyed because
 * `SdkSessionLifecycle.activeSession` becomes `undefined` between
 * `submit_and_exit` (marker creation) and the deferred reevaluation. Static
 * recon located the only storage writer (`clearActiveSessionReference`) and
 * enumerated the bounded set of `endActiveSession(reason)` callers, but did
 * NOT locate which caller fired in the failing LIVE run. Without that, no
 * bounded lifecycle repair is authorized (per the reviewer's
 * "do not repair by guessing" rule).
 *
 * This recorder narrows the gap: it snapshots `reason` for every clear.
 * Because `endActiveSession(reason)` is the single funnel and `reason` is
 * already passed as a free-form call-site label, a single observed reason
 * in the next LIVE dump identifies the exact caller.
 *
 * Scope / hard prohibitions
 * -------------------------
 *   - ALWAYS-OFF in `public` profile (default). The `recordLifecycleClear`
 *     call is a no-op when `resolveClineMmRuntimeProfile() !== "dogfood"`.
 *     Public installs see `enabled: false` and `total: 0` in the snapshot.
 *   - NO production semantic delta. The recorder reads `reason` only; it
 *     does not write lifecycle state, does not change ordering, does not
 *     intercept the clear.
 *   - NO raw session ids, no PII, no path strings. Only the bounded
 *     caller-reason enum documented below is ever recorded.
 *   - NO stack capture. Stack traces are noisy, unstable under bundling/
 *     minification, and the bounded enum is sufficient to identify the
 *     caller (each value maps 1:1 to a callsite).
 *
 * Conservation
 * ------------
 *   C1 `public` profile             -> snapshot.enabled === false,
 *                                       snapshot.total === 0, no I/O
 *   C2 `dogfood` profile, no clear  -> snapshot.enabled === true,
 *                                       snapshot.total === 0,
 *                                       snapshot.lastClearReason === undefined
 *   C3 `dogfood` profile, 1 clear  -> snapshot.enabled === true,
 *                                       snapshot.total === 1,
 *                                       snapshot.lastClearReason matches
 *                                       the enum value passed
 *   C5 reason outside enum         -> snapshot.lastClearReason === "unrecognized"
 *                                       and snapshot.lastUnrecognizedReason ===
 *                                       <the offending string>
 *   C6 reason === "" (empty)       -> recorded as "empty"
 *   C7 reset / test isolation      -> `resetLifecycleClearSnapshot()` clears
 *                                       the in-memory counters
 */

// ---------------------------------------------------------------------------
// §BOUNDED_REASON_LIST
// ---------------------------------------------------------------------------
// Frozen enumeration of every caller site that currently invokes
// `SdkSessionLifecycle.endActiveSession(reason)` with a hard-coded string
// label. Adding a new value to this union is a durable API change that
// requires a new ACT.
//
//   startNewSession                 sdk-session-lifecycle.ts:379  ("startNewSession")
//   replaceActiveSession            sdk-session-lifecycle.ts:519  (options.disposeReason)
//   dispose                         sdk-session-lifecycle.ts:581  (SdkSessionLifecycle.dispose)
//   clearTask                       sdk-task-control-coordinator.ts:151
//   showTaskWithId                  sdk-task-control-coordinator.ts:232
//   followupTargetChange            sdk-followup-coordinator.ts:356
//   autoApprovalRebuildFailure       sdk-session-auto-approval-coordinator.ts:292
//                                    (called via clearActiveSession(reason), which
//                                    forwards to endActiveSession)
//   remoteConfigToggle              SdkController.ts:2755
//   empty                           reserved for `""` (defensive guardrail)
//   unrecognized                    reserved for any string outside the enum
//                                    (one LIVE cycle only; not a passthrough)
//
// §CALLER_CHAIN
// `clearActiveSessionReference` is a private method. The only public paths
// into it are `endActiveSession(reason)` and `clearActiveSession(reason)`
// (the latter is a thin wrapper). `replaceActiveSession` does NOT call
// `clearActiveSessionReference` directly; it goes through
// `endActiveSession(options.disposeReason)`. The recorder therefore
// reflects the FUNNEL reason, not the originating source — which is the
// granularity the LIVE needs to classify the failing caller.
export type LifecycleClearReason =
	| "startNewSession"
	| "replaceActiveSession"
	| "dispose"
	| "clearTask"
	| "showTaskWithId"
	| "followupTargetChange"
	| "autoApprovalRebuildFailure"
	| "remoteConfigToggle"
	| "empty"
	| "unrecognized"

const BOUNDARY_REASON_SET: ReadonlySet<string> = new Set<LifecycleClearReason>([
	"startNewSession",
	"replaceActiveSession",
	"dispose",
	"clearTask",
	"showTaskWithId",
	"followupTargetChange",
	"autoApprovalRebuildFailure",
	"remoteConfigToggle",
	"empty",
	"unrecognized",
])

export interface LifecycleClearSnapshot {
	enabled: boolean
	total: number
	lastClearReason: LifecycleClearReason | undefined
	lastUnrecognizedReason: string | undefined
}

interface InternalState {
	total: number
	lastClearReason: LifecycleClearReason | undefined
	lastUnrecognizedReason: string | undefined
}

const INTERNAL_STATE: InternalState = {
	total: 0,
	lastClearReason: undefined,
	lastUnrecognizedReason: undefined,
}

function classifyLifecycleClearReason(
	raw: string,
): { recognized: true; value: LifecycleClearReason } | { recognized: false; raw: string } {
	if (raw === "") {
		return { recognized: true, value: "empty" }
	}
	if (BOUNDARY_REASON_SET.has(raw)) {
		return { recognized: true, value: raw as LifecycleClearReason }
	}
	return { recognized: false, raw }
}

export function recordLifecycleClear(reason: string): void {
	if (!isDogfoodRuntime()) {
		return
	}
	const classified = classifyLifecycleClearReason(reason)
	INTERNAL_STATE.total += 1
	if (classified.recognized) {
		INTERNAL_STATE.lastClearReason = classified.value
		INTERNAL_STATE.lastUnrecognizedReason = undefined
		return
	}
	INTERNAL_STATE.lastClearReason = "unrecognized"
	INTERNAL_STATE.lastUnrecognizedReason = classified.raw
}

export function getLifecycleClearSnapshot(): LifecycleClearSnapshot {
	const enabled = isDogfoodRuntime()
	return {
		enabled,
		total: enabled ? INTERNAL_STATE.total : 0,
		lastClearReason: enabled ? INTERNAL_STATE.lastClearReason : undefined,
		lastUnrecognizedReason: enabled ? INTERNAL_STATE.lastUnrecognizedReason : undefined,
	}
}

export function resetLifecycleClearSnapshot(): void {
	INTERNAL_STATE.total = 0
	INTERNAL_STATE.lastClearReason = undefined
	INTERNAL_STATE.lastUnrecognizedReason = undefined
}
