// ACT-MYC-CLINEMM03-LIVE-DIAG01: default-off live diagnostics for the
// ClineMM prime-injection causal chain.
//
// ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01: arming authority moved
// from a per-recorder `process.env.CLINEMM_MYC_PRIME_DIAG` read to a
// module-level boolean. The central dogfood profile
// (`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`) resolves the
// effective state ONCE at extension activation and calls
// `setMycPrimeLiveDiagEnabled(true|false)`. The recorder hot path now
// reads the module boolean, NOT `process.env`. The env-flag override is
// preserved as a one-shot back-compat shim for direct unit tests and
// for the legacy operator opt-in (the resolver sets the module boolean
// before the first recorder call, so env becomes irrelevant in
// production).
//
// SCOPE: OBSERVE ONLY. Do NOT redesign injection, recorder lookup, or
// message construction here. The diagnostic is a forensic scaffolding
// The diagnostic only records numeric / boolean / status metadata. It
// MUST NEVER store, log, or surface:
//   - the prime text itself,
//   - recalled memory contents,
//   - prompts,
//   - provider request bodies,
//   - node IDs, paths, or raw headers.
//
// Gating (per ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01):
//   1. Module-level boolean (set by the central dogfood profile at
//      activation time) — primary authority.
//   2. Fallback to the literal env flag
//      `CLINEMM_MYC_PRIME_DIAG` for back-compat with tests and the
//      legacy operator opt-in.
//
// Precedence (handled by the central profile, not here):
//   - Explicit env override (`=1/true/yes` ON; `=0/off/false` OFF)
//     wins in BOTH profiles.
//   - dogfood + no explicit override -> ON (auto-on, the live-qual
//     operator no longer needs to set the env).
//   - public + no explicit override  -> OFF (default).
//
// When DISABLED (production default, the verified working state):
//   - zero new state writes,
//   - zero new request mutations,
//   - zero new log lines,
//   - zero impact on the prime-recorder singleton,
//   - zero impact on the per-session injection tracker.
// In other words, the production path-of-execution is bit-identical to
// what ACT-MYC-CLINEMM02-C-CORRECTION02 produced.
//
// When ENABLED (operator-driven live dogfood session): the singleton
// below is populated with one entry per active host session id; the
// entry is updated at six observation points:
//   1. BIND        -> buildAgentHooks           hooks-adapter.ts
//   2. ENTER       -> beforeModel               hooks-adapter.ts
//   3. ACQUISITION -> runMycPrimeOnSessionStart myc-prime-automation.ts
//   4. LOOKUP      -> beforeModel               hooks-adapter.ts
//   5. INJECTION   -> beforeModel               hooks-adapter.ts
//   6. CAPTURE     -> beforeModel               hooks-adapter.ts
//
// BIND + ENTER were added by
// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 to
// discriminate the "hook never installed" / "hook installed but never
// fired" / "hook fired with wrong sessionId" failure modes on the real
// installed product. They are observation-only and short-circuit on
// the same `isMycPrimeLiveDiagEnabled()` gate as the pre-existing
// recorders; when disabled they contribute zero state writes, zero
// log lines, and zero request mutations.
//
// Removal trigger (per ACT §14): the first of
//   - root cause isolated,
//   - capture insufficient,
//   - successor evidence supersedes it.
// When telemetry later wants any of these counters, redesign them under
// ACT-MYC-CLINEMM-TELEMETRY01 — do NOT silently promote this record
// into product telemetry.

import { Logger } from "@/shared/services/Logger"

/**
 * Opt-in env flag. Default off; the central dogfood profile
 * (`dogfood-diagnostic-profile.ts#resolveEffectiveMycPrimeLiveDiag`)
 * honors both truthy (`1/true/yes`) and falsy (`0/off/false`) tokens.
 * This module's fallback env read accepts ONLY the literal `"1"`
 * for back-compat with the original ACT-03 forensic shim.
 */
const ENV_FLAG_NAME = "CLINEMM_MYC_PRIME_DIAG"

/**
 * Module-level enablement seam. The central dogfood profile
 * (`applyMycPrimeLiveDiagDiagnosticProfile`) flips this once at
 * extension activation. The recorder hot path reads the boolean
 * directly — no `process.env` lookup per observation point.
 *
 * `null` means "uninitialized; use the env fallback". After the
 * first central-profile activation pass, this is always `boolean`.
 */
let mycPrimeLiveDiagEnabled: boolean | null = null

/**
 * Discriminated per-injection reason. The exhaustive enumeration makes
 * the live decision matrix in ACT §12 a closed-form match — no
 * inferential branch on `reason === undefined`.
 */
export type MycPrimeLiveInjectionReason =
	| "ok"
	| "iteration_not_first"
	| "no_session_id"
	| "no_recorded_prime"
	| "prime_empty"
	| "already_injected"

export type MycPrimeLiveAcquisitionStatus = "ok" | "failed" | "skipped"

/**
 * One entry per host session id. The entry is keyed by the same id used
 * by `lastResultBySessionId` in myc-prime-automation.ts, so a diag
 * lookup miss with `acquisition.status === "ok"` is unambiguous: it
 * points at the identity/join boundary (HALT_LIVE_PRIME_LOOKUP_MISS).
 */
export interface MycPrimeLiveDiagnostic {
	readonly sessionId: string
	/**
	 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: two
	 * pre-runtime observation points that let the operator distinguish
	 * "hook never installed" (Case A) from "hook installed but never
	 * fired" (Case B/C/D) on the real installed product.
	 *
	 * `bind` fires inside `buildAgentHooks(...)` and proves the runtime
	 * was given an `AgentHooks` bag with a `beforeModel` function. It
	 * does NOT prove the runtime actually called it.
	 *
	 * `enter` fires at the very top of `beforeModel` body and proves
	 * the runtime invoked the function. After `enter` fires, every
	 * subsequent short-circuit (iteration>1, no sessionId, already
	 * injected, no recorded prime, prime empty) still records the
	 * `lookup` and `injection` observations with the appropriate
	 * `reason` — so the post-enter discriminator tree is fully
	 * populated.
	 *
	 * No prompt text, no prime text, no node ids, no paths.
	 */
	readonly bind?: {
		/**
		 * The host sessionId the producer of the hook bag was told
		 * the runtime was for. In production this is
		 * `CoreSessionConfig.sessionId` ==
		 * `AgentRuntimeConfig.sessionId`. Comparing this against
		 * the SESSION_ID the operator captured from the running
		 * myc MCP process is the Case B discriminator (production
		 * runtime session identity).
		 */
		sessionId: string
		/**
		 * Always `0` for the bind event — the bind happens once at
		 * hook-bag construction time, before any model request
		 * iteration is allocated. Iteration 0 vs iteration >0 lets
		 * post-capture joins separate the "I built the bag" event
		 * from the "I fired the hook" event.
		 */
		iteration: 0
		/**
		 * Hard-coded `true` — the bind event by definition only
		 * fires when the produced bag carries a `beforeModel`
		 * function. The discriminator for Case A is the ABSENCE
		 * of the bind event, not a falsy `hooksInstalled`.
		 */
		hooksInstalled: true
		ts?: number
	}
	readonly enter?: {
		/**
		 * The `snapshot.sessionId` value the runtime surfaced. May
		 * be `undefined` (then the hook body falls back to
		 * `snapshot.conversationId` and records `no_session_id`).
		 */
		sessionId: string | undefined
		/**
		 * Whether the snapshot carried an explicit `sessionId`
		 * field. `false` means the runtime dropped it (Case B
		 * discriminator).
		 */
		snapshotSessionIdPresent: boolean
		iteration: number
		/**
		 * Hard-coded `true` for the same reason as `bind.hooksInstalled`.
		 */
		hooksInstalled: true
		ts?: number
	}
	readonly acquisition: {
		attempted: boolean
		serverDetected: boolean
		status: MycPrimeLiveAcquisitionStatus
		textPresent: boolean
		/** UTF-8 byte length of the recorded prime text. 0 when none. */
		textBytes: number
		/** Truncated message on failure; NEVER the prime text. */
		error?: string
		ts?: number
	}
	readonly lookup: {
		attempted: boolean
		snapshotSessionIdPresent: boolean
		matchedRecordedSession: boolean
		recordedPrimeFound: boolean
		/**
		 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
		 * the actual key passed to `getMycPrimeResult(...)`. May
		 * equal `snapshot.sessionId`, or `snapshot.conversationId`
		 * (the CORRECTION02 fallback), or `"__no_session__"`.
		 * Frozen so the operator can tell "wrong key" (Case B) from
		 * "right key, recorder miss" (Case C) from a post-capture
		 * join without re-reading the hook body.
		 */
		lookupKey?: string
		iteration?: number
		ts?: number
	}
	readonly injection: {
		attempted: boolean
		injected: boolean
		reason?: MycPrimeLiveInjectionReason
		/** UTF-8 byte length of the `<prime_packet>` text block. 0 when no packet. */
		packetBytes?: number
		ts?: number
		iteration?: number
	}
	capture?: {
		/** Stable capture id stamped onto request.metadata.captureId. */
		captureId?: string
		aiSdkPromptObserved?: boolean
		wireRequestObserved?: boolean
	} | null
}

/**
 * Writeable internal representation of the diagnostic. The public
 * `MycPrimeLiveDiagnostic` interface uses `readonly` so external
 * callers cannot mutate a captured entry; the recorder hot path
 * operates on this writeable shape, then exposes it as readonly
 * through the public type. Used by `freshEntry`, `ensureEntry`, the
 * BIND / ENTER recorders, and the existing ACQUISITION / LOOKUP /
 * INJECTION / CAPTURE recorders below.
 */
type _MycPrimeLiveDiagEntry = { -readonly [K in keyof MycPrimeLiveDiagnostic]: MycPrimeLiveDiagnostic[K] }

/** Module-level singleton. Hold the live diagnostic per host session id. */
const liveDiagBySessionId = new Map<string, _MycPrimeLiveDiagEntry>()

// added to prove WHERE the live chain breaks — not to fix it.
/**
 * Module-level enablement seam (primary authority). When set by the
 * central dogfood profile, the recorder hot path reads the boolean
 * directly — no `process.env` lookup per observation point. When
 * unset (`null`), the env fallback below preserves the original
 * ACT-03 operator opt-in (`CLINEMM_MYC_PRIME_DIAG=1`).
 *
 * Cost: a single boolean read when the module boolean is set.
 * When disabled, every recorder below short-circuits on this single
 * boolean — zero state writes, zero request mutations, zero log lines.
 */
export function isMycPrimeLiveDiagEnabled(): boolean {
	if (mycPrimeLiveDiagEnabled !== null) {
		return mycPrimeLiveDiagEnabled
	}
	// Fallback path: only honored when the central profile has not yet
	// armed the seam (e.g. direct unit tests that bypass the
	// activation helper). Once `setMycPrimeLiveDiagEnabled` has been
	// called for the first time, this fallback is dead code.
	const raw = process.env[ENV_FLAG_NAME]
	if (typeof raw !== "string") return false
	return raw.trim().toLowerCase() === "1"
}

/**
 * Arm / disarm the module-level diagnostic seam.
 *
 * Called from `applyMycPrimeLiveDiagDiagnosticProfile` at extension
 * activation. The function is idempotent: calling it twice with the
 * same boolean produces no extra semantic effect. Calling it with
 * `false` after an initial `true` clears the seam back to the
 * disabled state — no leftover entries are touched (the singleton
 * map is preserved for forensic post-mortem by the host-side dump
 * runtime).
 *
 * Direct callers (other than the central profile) are FORBIDDEN in
 * production. Test code may use `__setMycPrimeLiveDiagForTests` (see
 * below) so test intent is auditable.
 */
export function setMycPrimeLiveDiagEnabled(enabled: boolean): void {
	mycPrimeLiveDiagEnabled = enabled
}

/** Test-only: reset the module seam back to the env fallback path. */
export function __resetMycPrimeLiveDiagForTests(): void {
	mycPrimeLiveDiagEnabled = null
	liveDiagBySessionId.clear()
}

/**
 * Begin (or refresh) a diagnostic entry for `sessionId`. No-op when
 * diagnostics are disabled.
 *
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: the
 * `bind` and `enter` fields from a prior entry are PRESERVED across
 * a re-`start`. The `start` semantics are "begin a new acquisition
 * attempt for an already-bound session"; the runtime's structural
 * facts (the hook bag was built, the runtime invoked beforeModel)
 * survive that re-start. All other fields are reset to their
 * unobserved defaults so a new acquisition cycle starts from a
 * clean slate. The existing `Logger.warn` is preserved so the prior
 * `acquisition.status` and `injection.injected` are still surfaced
 * for forensic post-mortem.
 */
export function startMycPrimeLiveDiag(sessionId: string): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const prior = liveDiagBySessionId.get(sessionId)
	if (prior) {
		Logger.warn(
			`[MycPrimeLiveDiag] overwriting prior diagnostic entry for session=${sessionId} ` +
				`(prior.acquisition.status=${prior.acquisition.status}, prior.injection.injected=${prior.injection.injected}).`,
		)
	}
	const fresh = freshEntry(sessionId)
	// Preserve structural observations across a re-start: the bind
	// (hook bag built for this sessionId) and any pre-existing
	// enter event are facts about the runtime, not the acquisition
	// cycle being re-started.
	if (prior?.bind) fresh.bind = prior.bind
	if (prior?.enter) fresh.enter = prior.enter
	liveDiagBySessionId.set(sessionId, fresh)
}

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: record that
 * a host sessionId was bound into a built `AgentHooks` bag. Fires once
 * per `buildAgentHooks(...)` call. Captures the canonical host
 * sessionId the producer was told, so a post-capture join can compare
 * it against the operator's captured MYC_SESSION_ID and against the
 * later `enter.sessionId` from `beforeModel` (Case A vs Case B
 * discriminator). No-op when diagnostics are disabled.
 */
export function recordMycPrimeLiveBind(sessionId: string): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.bind = {
		sessionId,
		iteration: 0,
		hooksInstalled: true,
		ts: Date.now(),
	}
}

/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: record that
 * the runtime invoked `beforeModel`. Fires once per iteration
 * regardless of the iteration gate or the sessionId gate — the
 * diagnostic must prove the hook body was reached even if a
 * short-circuit fires immediately afterwards (otherwise Case A
 * "hook never installed" and Case C "runtime fired hook but
 * `ctx.snapshot.sessionId` was undefined" are indistinguishable).
 *
 * Captures:
 *  - `sessionId` from `ctx.snapshot.sessionId` (may be undefined;
 *    the post-short-circuit fallback path is `__no_session__`).
 *  - `snapshotSessionIdPresent` so the join can tell "snapshot
 *    carried sessionId" from "fallback to conversationId" without
 *    re-reading the hook body.
 *  - `iteration` so a multi-iteration join can isolate the first
 *    model request (which is the only one that ever injects).
 *
 * No-op when diagnostics are disabled. Does NOT call `ensureEntry`
 * with the snapshot's sessionId — that would create a stray
 * per-iteration entry; the entry is created at the `bind` site
 * (or at `startMycPrimeLiveDiag`) keyed by the canonical host
 * sessionId. When `ctx.snapshot.sessionId` differs from the host
 * sessionId, the enter event is recorded against the entry that
 * the runtime claims it is operating on, so the Case B
 * discriminator (wrong sessionId at runtime) reads as
 * `enter.sessionId !== bind.sessionId`.
 */
export function recordMycPrimeLiveEnter(
	hostSessionId: string,
	snapshotSessionId: string | undefined,
	iteration: number,
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(hostSessionId)
	entry.enter = {
		sessionId: snapshotSessionId,
		snapshotSessionIdPresent: snapshotSessionId !== undefined,
		iteration,
		hooksInstalled: true,
		ts: Date.now(),
	}
}

export function recordMycPrimeLiveAcquisition(
	sessionId: string,
	fields: {
		attempted: boolean
		serverDetected: boolean
		status: MycPrimeLiveAcquisitionStatus
		textPresent: boolean
		textBytes: number
		error?: string
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.acquisition.attempted = fields.attempted
	entry.acquisition.serverDetected = fields.serverDetected
	entry.acquisition.status = fields.status
	entry.acquisition.textPresent = fields.textPresent
	entry.acquisition.textBytes = fields.textBytes
	entry.acquisition.error = fields.error
	entry.acquisition.ts = Date.now()
}

export function recordMycPrimeLiveLookup(
	sessionId: string,
	fields: {
		attempted: boolean
		snapshotSessionIdPresent: boolean
		matchedRecordedSession: boolean
		recordedPrimeFound: boolean
		iteration?: number
		/**
		 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
		 * the actual key the production lookup was issued against.
		 * Defaults to `sessionId` when omitted (preserves
		 * pre-ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
		 * callers' behavior). Production callers MUST pass the
		 * post-fallback key so the discriminator can tell
		 * `snapshot.sessionId` lookups from `conversationId`
		 * fallbacks.
		 */
		lookupKey?: string
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.lookup.attempted = fields.attempted
	entry.lookup.snapshotSessionIdPresent = fields.snapshotSessionIdPresent
	entry.lookup.matchedRecordedSession = fields.matchedRecordedSession
	entry.lookup.recordedPrimeFound = fields.recordedPrimeFound
	entry.lookup.lookupKey = fields.lookupKey ?? sessionId
	entry.lookup.iteration = fields.iteration
	entry.lookup.ts = Date.now()
}

export function recordMycPrimeLiveInjection(
	sessionId: string,
	fields: {
		attempted: boolean
		injected: boolean
		reason: MycPrimeLiveInjectionReason
		packetBytes?: number
		iteration?: number
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.injection.attempted = fields.attempted
	entry.injection.injected = fields.injected
	entry.injection.reason = fields.reason
	entry.injection.packetBytes = fields.packetBytes
	entry.injection.iteration = fields.iteration
	entry.injection.ts = Date.now()
}

export function recordMycPrimeLiveCapture(
	sessionId: string,
	fields: {
		captureId: string
		aiSdkPromptObserved: boolean
		wireRequestObserved?: boolean
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.capture = {
		captureId: fields.captureId,
		aiSdkPromptObserved: fields.aiSdkPromptObserved,
		wireRequestObserved: fields.wireRequestObserved,
	}
}

/**
 * Lookup the live diagnostic for a sessionId. Returns `undefined` when
 * no entry has been started. NEVER throws; caller must NOT depend on
 * the returned shape for control flow.
 */
export function getMycPrimeLiveDiag(sessionId: string): MycPrimeLiveDiagnostic | undefined {
	if (!isMycPrimeLiveDiagEnabled()) return undefined
	return liveDiagBySessionId.get(sessionId)
}

/**
 * Test-only: read every recorded entry as a plain array. Used by
 * diagnostic RED/GREEN assertions to walk the full singleton without
 * depending on internal map ordering.
 */
export function __getAllMycPrimeLiveDiagForTests(): readonly MycPrimeLiveDiagnostic[] {
	if (!isMycPrimeLiveDiagEnabled()) return []
	return Array.from(liveDiagBySessionId.values())
}

function freshEntry(sessionId: string): _MycPrimeLiveDiagEntry {
	return {
		sessionId,
		acquisition: {
			attempted: false,
			serverDetected: false,
			status: "failed",
			textPresent: false,
			textBytes: 0,
		},
		lookup: {
			attempted: false,
			snapshotSessionIdPresent: false,
			matchedRecordedSession: false,
			recordedPrimeFound: false,
		},
		injection: {
			attempted: false,
			injected: false,
		},
	}
}

function ensureEntry(sessionId: string): _MycPrimeLiveDiagEntry {
	const existing = liveDiagBySessionId.get(sessionId)
	if (existing) return existing
	// Defensive: a recorder firing without a prior
	// `startMycPrimeLiveDiag` lazily initializes a minimal entry.
	const entry = freshEntry(sessionId)
	liveDiagBySessionId.set(sessionId, entry)
	return entry
}
