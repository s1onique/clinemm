/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER
 *
 * SYNCHRONOUS REAL Elm authority runtime for the completion commit seam.
 *
 * Why this module exists:
 *   The predecessor ACT proved the DI seam is causal (synthetic provider
 *   changes the real production commit effect), but the synthetic
 *   provider is NOT an Elm kernel. This ACT replaces the synthetic
 *   provider with a synchronous per-session REAL compiled Elm
 *   application instance that participates in the active decision path.
 *
 * Why a separate runtime from the shadow observer:
 *   The Elm shadow observer (`completion-authority-elm-shadow.ts`) is
 *   intentionally fire-and-forget (uses `setTimeout(0)` between inbound
 *   and drain so the bounded ring + counter snapshot are populated from
 *   a separate microtask). Authority is the FINAL pre-effect decision and
 *   MUST be synchronous relative to the moment the coordinator consults
 *   `getElmCompletionAuthorityDecision`. Sharing state with the shadow's
 *   out-of-band ring would introduce (a) stale-by-N-microtask reads,
 *   (b) double-fire on shared off-band state, and (c) a self-fulfilling
 *   loop where the same record that asserts `task_completion_committed`
 *   is fed to Elm and Elm is then asked whether the commit is allowed.
 *
 *   Therefore: separate Elm kernel instances per session. Each
 *   `AuthorityKernelSession` owns its own `Elm.Main.init({})` and its own
 *   inbound/outbound ports. The shadow observer remains untouched.
 *
 * Chronology discipline (ACT §8, load-bearing):
 *   The Elm authority kernel MUST NOT receive
 *   `task_completion_committed` records. The Elm kernel already models
 *   this stage and will emit the `TaskCompletionCommittedWhileHeld`
 *   violation when it sees one (Authority.elm handleMsg), but for the
 *   authority path this stage is POST-DECISION: by definition the
 *   coordinator is asking "may commit happen" — telling Elm "commit
 *   committed" before that question is a self-fulfilling loop.
 *
 *   This runtime therefore subscribes to the SAME factual CCARD stream
 *   the shadow does, but filters out the post-decision stage
 *   (`task_completion_committed`, `completion_presented`,
 *   `task_cancelled`) before forwarding to the Elm authority instance.
 *
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
 * The runtime is MANDATORY. There is no OFF mode and no silent
 * default-Authorize decision. If `state.enabled` is false (the kernel
 * failed to load), `getElmAuthorityCompletionDecision` returns a
 * `failure` decision and the coordinator suppresses the commit effect.
 * The legacy silent default-Authorize symbols have been deleted from
 * `./completion-authority-elm-authority.ts`.
 */

import { Logger } from "@/shared/services/Logger"
import type { ElmCompletionAuthorityDecision } from "./completion-authority-elm-authority"
import { adaptRecord, type KernelHandle } from "./completion-authority-elm-replay"
import { loadKernel } from "./completion-authority-elm-replay.kernel"

// ----------------------------------------------------------------------------
// Authority diagnostic counter snapshot (mirrors the shadow counter shape)
// ----------------------------------------------------------------------------

export interface ElmAuthorityCountersSnapshot {
	readonly total: number
	readonly states: number
	readonly decodeErrors: number
	readonly kernelErrors: number
	readonly authorize: number
	readonly hold: number
	readonly failure: number
	readonly fallbackUsed: number
	readonly sessionsActive: number
	readonly lastDecision: ElmCompletionAuthorityDecision["kind"] | null
	readonly lastClassification: Extract<ElmCompletionAuthorityDecision, { kind: "failure" }>["classification"] | null
	readonly lastHoldReasons: readonly string[]
}

/**
 * Filter the factual CCARD stages the authority Elm kernel may receive.
 * Excludes every POST-DECISION stage. This is the load-bearing guard
 * against the self-fulfilling chronology loop (ACT §8).
 *
 * Stage names match the CCARD capture stage vocabulary (the source),
 * NOT the Elm Msg tag vocabulary (the target). The adapter
 * (`completion-authority-elm-replay.ts > adaptRecord`) renames at the
 * boundary; the authority runtime only deals in source stage names.
 */
const AUTHORITY_STAGES = new Set<string>([
	"task_started",
	"run_turn_started",
	"agent_turn_done",
	"terminal_committed",
	"notify_consume_enter",
	"wake_created",
	"pending_prompt_enqueued",
	"pending_prompt_dequeued",
	"continuation_scheduled",
	"continuation_started",
	"submit_and_exit_seen",
	// NOTE: `task_completion_committed`, `completion_presented`,
	// `task_cancelled` are deliberately EXCLUDED. These are POST-DECISION
	// facts. Telling the authority kernel that the task was decided
	// before the question "may commit happen?" is a self-fulfilling loop.
	//
	// NOTE: `execute_turn_prelude_enter` is deliberately NOT in this
	// set, even though production emits it and Elm handles it as a
	// run-start signal (Authority.elm:146). Reason: the adapter
	// (replay.ts:106) requires a non-null `runId` for this stage,
	// and the production capture seam (session-host-capture.ts:106
	// and canonical-event-subscription.ts:71-78) deliberately does
	// NOT supply a runId — the runtime runId does not exist at that
	// boundary. Adding the stage name here would only cause the
	// adapter to return INSUFFICIENT_IDENTITY silently. Fixing this
	// requires a coordinated adapter + producer change; it is a
	// separate causal problem (lives at the producer-adapter
	// boundary, not the filter) and is DEFERRED per ACT §11:
	// "if they expose a different causal problem, record and defer
	// unless P0."
])

interface AuthorityKernelSession {
	readonly sessionId: string
	readonly kernel: KernelHandle
	failed: boolean
	// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	// `lastDecision` is `null` when no Elm decision has been produced
	// yet for this session. The consult site maps `null` to a
	// fail-closed `failure` decision — never to `authorize`.
	lastDecision: ElmCompletionAuthorityDecision | null
}

interface AuthorityGlobalState {
	enabled: boolean
	kernelPath: string | null
	counters: {
		total: number
		states: number
		decodeErrors: number
		kernelErrors: number
		authorize: number
		hold: number
		failure: number
		fallbackUsed: number
	}
	sessions: Map<string, AuthorityKernelSession>
	queues: Map<string, Array<Record<string, unknown>>> | null
	provider: ((sessionId: string) => ElmCompletionAuthorityDecision) | null
}

const SHARED_STATE_KEY = Symbol.for("__clineEmmElmAuthorityState")

function getOrInitGlobal(): AuthorityGlobalState {
	const g = globalThis as unknown as Record<symbol, AuthorityGlobalState | undefined>
	let state = g[SHARED_STATE_KEY]
	if (!state) {
		state = {
			enabled: false,
			kernelPath: null,
			counters: {
				total: 0,
				states: 0,
				decodeErrors: 0,
				kernelErrors: 0,
				authorize: 0,
				hold: 0,
				failure: 0,
				fallbackUsed: 0,
			},
			sessions: new Map(),
			queues: null,
			provider: null,
		}
		g[SHARED_STATE_KEY] = state
	}
	return state
}

function getOrCreateSession(state: AuthorityGlobalState, sessionId: string, kernelPath: string): AuthorityKernelSession {
	let sess = state.sessions.get(sessionId)
	if (sess) return sess
	const kernel = loadKernel(kernelPath)
	sess = {
		sessionId,
		kernel,
		failed: false,
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
		// `lastDecision` starts as `null` (no Elm opinion yet). The
		// consult site returns a fail-closed `failure` decision when
		// there is no Elm decision — there is no default-Authorize
		// fallback in this module.
		lastDecision: null,
	}
	state.sessions.set(sessionId, sess)
	return sess
}

function bumpCounter<K extends keyof AuthorityGlobalState["counters"]>(state: AuthorityGlobalState, k: K, by = 1): void {
	state.counters[k] += by
}

function buildFailureClassification(
	reason: string,
): Extract<ElmCompletionAuthorityDecision, { kind: "failure" }>["classification"] {
	const r = reason.toLowerCase()
	if (r.includes("no session")) return "elm_authority_no_session"
	if (r.includes("decode")) return "elm_authority_decode_error"
	if (r.includes("kernel")) return "elm_authority_kernel_error"
	if (r.includes("transition") || r.includes("violation")) return "elm_authority_invalid_transition"
	return "elm_authority_unavailable"
}

function decideElmAuthorityCompletion(state: AuthorityGlobalState, sessionId: string): ElmCompletionAuthorityDecision {
	const sess = state.sessions.get(sessionId)
	if (!sess) {
		bumpCounter(state, "failure")
		return { kind: "failure", reason: "elm_authority_no_session", classification: "elm_authority_no_session" }
	}
	// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	// `null` means no Elm opinion has been produced yet for this
	// session. Map to a fail-closed `failure` decision rather than a
	// silent `authorize`.
	if (sess.lastDecision === null) {
		bumpCounter(state, "failure")
		return {
			kind: "failure",
			reason: "elm_authority_no_session",
			classification: "elm_authority_no_session",
		}
	}
	if (sess.failed) {
		return sess.lastDecision
	}
	return sess.lastDecision
}

/**
 * The provider SdkController consults at `checkElmCompletionAuthority`.
 * Returns the latest synchronous Elm authority decision for the given
 * session. ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-
 * TS-AUTHORITY: if `state.enabled` is false (the kernel failed to
 * load), returns a fail-closed `failure` decision. There is no
 * default-Authorize fallback.
 */
export function getElmAuthorityCompletionDecision(sessionId: string): ElmCompletionAuthorityDecision {
	const state = getOrInitGlobal()
	if (!state.enabled) {
		bumpCounter(state, "fallbackUsed")
		state.counters.total++
		state.counters.failure++
		return {
			kind: "failure",
			reason: "elm_authority_unavailable",
			classification: "elm_authority_unavailable",
		}
	}
	const decision = decideElmAuthorityCompletion(state, sessionId)
	switch (decision.kind) {
		case "authorize":
			bumpCounter(state, "authorize")
			break
		case "hold":
			bumpCounter(state, "hold")
			break
		case "failure":
			bumpCounter(state, "failure")
			break
	}
	state.counters.total++
	return decision
}

/**
 * Synchronously enqueue a record into the per-session authority queue.
 * Called from `captureContinuationCardinalityAuthorityRecord` (which is
 * synchronous). The actual Elm kernel send + outbound drain happens
 * later when `flushElmAuthorityForSession` is awaited by the gate.
 */
export function enqueueElmAuthorityRecord(record: Record<string, unknown>): void {
	const state = getOrInitGlobal()
	if (!state.enabled || !state.kernelPath) return
	const sessionId = typeof record.sessionId === "string" ? (record.sessionId as string) : ""
	if (!sessionId) {
		bumpCounter(state, "failure")
		return
	}
	const stage = typeof record.stage === "string" ? (record.stage as string) : ""
	if (!AUTHORITY_STAGES.has(stage)) {
		return
	}
	if (!state.queues) {
		state.queues = new Map()
	}
	let q = state.queues.get(sessionId)
	if (!q) {
		q = []
		state.queues.set(sessionId, q)
	}
	q.push(record)
}

/**
 * Flush the per-session authority queue into the live Elm instance,
 * updating `lastDecision`. This MUST be called before the authority
 * decision is read. The Elm outbound message is delivered on a
 * microtask boundary (the Elm Platform.worker scheduler uses
 * setTimeout(0)); we await a microtask per record.
 */
export async function flushElmAuthorityForSession(sessionId: string): Promise<void> {
	const state = getOrInitGlobal()
	if (!state.enabled || !state.kernelPath) return
	const queues = state.queues
	if (!queues) return
	const q = queues.get(sessionId)
	if (!q || q.length === 0) return
	const records = q.splice(0, q.length)
	for (const record of records) {
		await processOneAuthorityRecord(state, record)
		const sess = state.sessions.get(sessionId)
		if (sess?.failed) {
			queues.set(sessionId, [])
			return
		}
	}
}

async function processOneAuthorityRecord(state: AuthorityGlobalState, record: Record<string, unknown>): Promise<void> {
	const sessionId = typeof record.sessionId === "string" ? (record.sessionId as string) : ""
	if (!sessionId) {
		bumpCounter(state, "failure")
		return
	}
	let sess: AuthorityKernelSession
	try {
		sess = getOrCreateSession(state, sessionId, state.kernelPath ?? "")
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		const failure: ElmCompletionAuthorityDecision = {
			kind: "failure",
			reason: msg,
			classification: buildFailureClassification(msg),
		}
		bumpCounter(state, "kernelErrors")
		bumpCounter(state, "failure")
		state.sessions.set(sessionId, {
			sessionId,
			kernel: { send: () => {}, drainOutbound: () => [] } as KernelHandle,
			failed: true,
			lastDecision: failure,
		})
		return
	}
	if (sess.failed) return
	const adapterResult = adaptRecord(record)
	if (adapterResult.status !== "DIRECT") {
		return
	}
	try {
		sess.kernel.send(adapterResult.elmMsg)
	} catch (err) {
		sess.failed = true
		const failure: ElmCompletionAuthorityDecision = {
			kind: "failure",
			reason: err instanceof Error ? err.message : String(err),
			classification: buildFailureClassification(err instanceof Error ? err.message : String(err)),
		}
		sess.lastDecision = failure
		bumpCounter(state, "kernelErrors")
		bumpCounter(state, "failure")
		return
	}
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	let outbounds: ReturnType<KernelHandle["drainOutbound"]> = []
	try {
		outbounds = sess.kernel.drainOutbound()
	} catch (err) {
		sess.failed = true
		const failure: ElmCompletionAuthorityDecision = {
			kind: "failure",
			reason: err instanceof Error ? err.message : String(err),
			classification: buildFailureClassification(err instanceof Error ? err.message : String(err)),
		}
		sess.lastDecision = failure
		bumpCounter(state, "kernelErrors")
		bumpCounter(state, "failure")
		return
	}
	const decodeError = outbounds.find((o) => o.kind === "decode_error") as { kind: "decode_error"; error: string } | undefined
	if (decodeError) {
		sess.failed = true
		const failure: ElmCompletionAuthorityDecision = {
			kind: "failure",
			reason: decodeError.error,
			classification: "elm_authority_decode_error",
		}
		sess.lastDecision = failure
		bumpCounter(state, "decodeErrors")
		bumpCounter(state, "failure")
		return
	}
	const lastState = [...outbounds].reverse().find((o) => o.kind === "state") as
		| { kind: "state"; model: Record<string, unknown>; violation?: string }
		| undefined
	if (!lastState) {
		return
	}
	bumpCounter(state, "states")
	const decision = decodeElmDecision(lastState.model)
	if (decision.kind === "failure" && decision.classification === "elm_authority_decode_error") {
		bumpCounter(state, "decodeErrors")
	}
	sess.lastDecision = decision
}

/**
 * Activate the synchronous authority runtime. ACT-CLINEMM-COMPLETION-
 * AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY: production
 * MUST call this with a non-null `kernelPath` BEFORE SdkController
 * construction. The only `null` accept path is `resetElmAuthorityForTests`
 * (test-only); production code that passes `null` is a fatal
 * configuration error and is logged via `console.error` so the
 * operator can see why their extension failed to activate.
 */
export function setElmAuthorityProvider(kernelPath: string | null): void {
	const state = getOrInitGlobal()
	if (!kernelPath) {
		Logger.error(
			"[SdkController] Elm authority runtime was given a null kernelPath; " +
				"this is a configuration error. The authority MUST be initialized unconditionally at extension activation.",
		)
		state.enabled = false
		state.kernelPath = null
		state.sessions.clear()
		if (state.queues) state.queues.clear()
		state.provider = null
		return
	}
	state.enabled = true
	state.kernelPath = kernelPath
	state.provider = getElmAuthorityCompletionDecision
}

/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
 * Returns `true` iff the Elm authority runtime is armed with a kernel
 * path. In production this is set unconditionally at extension
 * activation (no env-gate). It returns `false` ONLY when the kernel
 * failed to load (`setElmAuthorityProvider(null)` from
 * `resetElmAuthorityForTests`, or a load-time error). This is a
 * health/availability observation, NOT an authority decision switch
 * — production callers MUST NOT branch on it to decide whether to
 * consult the authority. The authority is consulted unconditionally
 * via `getElmAuthorityCompletionDecision`.
 */
export function isElmAuthorityAvailable(): boolean {
	return getOrInitGlobal().enabled
}

export function hasElmAuthoritySession(sessionId: string): boolean {
	const state = getOrInitGlobal()
	if (!state.enabled) return false
	const sess = state.sessions.get(sessionId)
	// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
	// "Available" means a real Elm kernel has produced at least one
	// decision for this session. `lastDecision === null` means no
	// decision yet — still no real Elm opinion to consult.
	return Boolean(sess) && !sess?.failed && sess?.lastDecision !== null
}

/**
 * Decode the latest Elm model into the closed TS union.
 *
 * **This function is a PURE TRANSLATOR — it owns NO domain logic.**
 *
 * The ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER
 * Elm encoder (`Codec.elm`) emits the AUTHORITATIVE hold projection as
 * `holdReasons : List String` (the closed list computed by
 * `Authority.computeHoldReasons` — the SAME projection that drives
 * Elm's own `Effect` derivation in `update`). It also emits
 * `completionAuthorized : Bool` as a redundant boolean cross-check.
 *
 * TS only:
 *   1. pulls the `holdReasons : List String` field out of the Elm model
 *   2. coerces it to a `string[]`
 *   3. maps the empty-list / non-empty-list to {authorize} / {hold}
 *
 * TS does NOT:
 *   - look at `task` (task terminal state is a Stage, not a decision input)
 *   - look at `committedCompletion` (post-effect state; would re-introduce
 *     the self-fulfilling loop the AUTHORITY_STAGES filter exists to prevent)
 *   - look at `presentedCompletion`, `submitCount`, `activeRun`,
 *     `commitReadyRun` (all Elm diagnostic fields)
 *   - recompute ANY projection
 *
 * Failure modes:
 *   - `holdReasons` is missing or wrong type → counted as `decodeError`
 *     and returned as `{ kind: "failure", reason: "elm_authority_decode_error", classification: "elm_authority_decode_error" }`
 *     (fail-closed; the runtime's whole purpose is to be the authority
 *     - silent fallback re-introduces the same risk the ACT was opened
 *     against; ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-
 *     LEGACY-TS-AUTHORITY removed the silent default-Authorize fallback
 *     entirely).
 *   - `holdReasons` contains a non-string entry → counted as `decodeError`
 *     and fail-closed.
 */
function decodeElmDecision(model: Record<string, unknown>): ElmCompletionAuthorityDecision {
	const rawReasons = model.holdReasons
	if (!Array.isArray(rawReasons)) {
		return {
			kind: "failure",
			classification: "elm_authority_decode_error",
			reason: "holdReasons_missing_or_wrong_type",
		}
	}
	const holdReasons: string[] = []
	for (const r of rawReasons) {
		if (typeof r !== "string") {
			return {
				kind: "failure",
				classification: "elm_authority_decode_error",
				reason: "holdReasons_contains_non_string",
			}
		}
		holdReasons.push(r)
	}
	if (holdReasons.length > 0) {
		return { kind: "hold", reason: holdReasons[0], holdReasons }
	}
	// Cross-check the redundant Elm signal: if `completionAuthorized` is
	// present and explicitly `false` while `holdReasons` is empty, the
	// Elm model is internally inconsistent — fail closed. This is a
	// self-consistency check, NOT a TS-owned domain decision.
	const authorized = model.completionAuthorized
	if (authorized === false) {
		return {
			kind: "failure",
			classification: "elm_authority_decode_error",
			reason: "completionAuthorized_inconsistent_with_holdReasons",
		}
	}
	return { kind: "authorize", reason: "no_hold_reasons" }
}

/**
 * Bounded snapshot for diagnostic dumps. Mirrors the shadow counter
 * snapshot shape so a single dump command can present both rings.
 */
export function getElmAuthorityCounters(): ElmAuthorityCountersSnapshot {
	const state = getOrInitGlobal()
	const sess = state.sessions.values().next().value as AuthorityKernelSession | undefined
	const last = sess?.lastDecision ?? null
	const lastClassification = last && last.kind === "failure" ? last.classification : null
	const lastHoldReasons = last && last.kind === "hold" ? last.holdReasons : []
	return {
		total: state.counters.total,
		states: state.counters.states,
		decodeErrors: state.counters.decodeErrors,
		kernelErrors: state.counters.kernelErrors,
		authorize: state.counters.authorize,
		hold: state.counters.hold,
		failure: state.counters.failure,
		fallbackUsed: state.counters.fallbackUsed,
		sessionsActive: state.sessions.size,
		lastDecision: last?.kind ?? null,
		lastClassification,
		lastHoldReasons,
	}
}

/**
 * Test-only: reset all state. Production code NEVER calls this.
 */
export function resetElmAuthorityForTests(): void {
	const state = getOrInitGlobal()
	state.enabled = false
	state.kernelPath = null
	state.sessions.clear()
	if (state.queues) state.queues.clear()
	state.provider = null
	state.counters = {
		total: 0,
		states: 0,
		decodeErrors: 0,
		kernelErrors: 0,
		authorize: 0,
		hold: 0,
		failure: 0,
		fallbackUsed: 0,
	}
}
