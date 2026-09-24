/**
 * ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
 *
 * TEMPORARY bounded process witness for the ClineMM Extension Host.
 * Acquires the CORRECT evidence type for classifying the LIVE failure
 * captured by the failing notify-enabled background workload where
 * the Extension Host terminates unexpectedly:
 *
 *   UI reports Code: 5, Signal: unknown
 *   -> no JS CPU hot leaf was found
 *   -> the host was overwhelmingly idle before death
 *   -> the previous profiler authority was a NECESSARY failure
 *   -> root_cause = UNRESOLVED
 *
 * VS Code treats an unresponsive Extension Host as a single-threaded
 * stall in this process and attaches a CPU profiler; the LIVE capture
 * showed the OPPOSITE shape. So the next epistemic need is:
 * "Who/what terminated the process?" Not a CPU attribution. A
 * termination-authority classification.
 *
 * The probe classifies death into exactly one of:
 *
 *   TA1 — explicit JS / process termination authority identified
 *   TA2 — native / runtime crash signature identified
 *   TA3 — host / watchdog / external termination authority identified
 *   TA4 — resource / OOM termination authority identified
 *   TA5 — process death observed but authority unresolved
 *   TA6 — crash not reproduced
 *
 * DESIGN CONSTRAINTS (frozen per ACT §5/§8 + CORRECTION01):
 *   - DEFAULT_OFF: witness installs only when CLINEMM_DIAG_TERMINATION_AUTHORITY
 *     is truthy.
 *   - DOGFOOD_ONLY: the env knob is honored ONLY in dogfood. Public
 *     installs never install the witness regardless of env
 *     (fail-closed; mirror of CLINEMM_DIAG_CPU_PROFILE).
 *   - BOUNDED writes: every artifact is appended-only JSONL or
 *     atomic-rename JSON; total bytes per capture are capped.
 *   - DEFAULT_OFF does NOT perturb command / continuation / completion
 *     / CCARD / BTCONT / TQCB / projection behavior. The witness
 *     installs passive process listeners only.
 *   - NO PROTOCOL FIELD: witness internals never serialize into proto.
 *   - NO WEBVIEW FIELD: witness internals never appear in webview state.
 *   - NO WORKSPACE SETTING: dogfood env knob only.
 *   - NO TASK-SEMANTIC DELTA: process events are observations only;
 *     the witness NEVER calls process.exit(), NEVER swallows
 *     uncaughtException, NEVER replaces the fatal-exception path.
 *   - SEMANTIC INERTIA (per CORRECTION01 + CORRECTION02): the
 *     witness observes ONLY channels that are provably observational
 *     AND cannot keep the process alive on their own. The frozen
 *     safe-list is exactly:
 *       exit, uncaughtExceptionMonitor, warning
 *     All signal channels (SIGHUP/SIGINT/SIGTERM/SIGPIPE/SIGBREAK/
 *     SIGWINCH) and unhandledRejection + rejectionHandled are
 *     DELIBERATELY NOT observed because installing a listener would
 *     alter process-termination semantics. `beforeExit` was REMOVED
 *     in CORRECTION02 because, per Node.js docs, a `beforeExit`
 *     listener may schedule asynchronous work (the witness's async
 *     `writer()` path qualifies) and cause the process to continue
 *     instead of exiting — directly violating the witness contract.
 *     See the TerminationAuthorityEventKind union for the full
 *     rationale.
 *
 * REMOVAL_TRIGGER / RETAIN_AS_DIAGNOSTIC (per the operator's directive
 * accompanying this ACT): the prior CPU profiler's old removal
 * trigger is SUPERSEDED; the profiler is retained as a diagnostic
 * substrate. The same applies to this witness once the termination
 * authority is classified TA1..TA4, OR CAPTURE_INSUFFICIENT, OR the
 * crash fails to reproduce — at that point this module + the runtime
 * wiring + the env knob + the focused tests + the analyzer script
 * MAY stay in the tree as a labeled diagnostic substrate. Termination
 * of this ACT does NOT auto-remove the substrate.
 */

// =============================================================================
// Imports
// =============================================================================

import { Logger } from "@/shared/services/Logger"

// =============================================================================
// Constants (frozen per ACT §8 -- tuning requires a bounded correction ACT)
// =============================================================================

/** Env var name. Honored ONLY in dogfood (fail-closed in public). */
export const CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV = "CLINEMM_DIAG_TERMINATION_AUTHORITY"

/**
 * Env var name for an operator-supplied capture ID. The Go launcher
 * (`cmd/clinemm-live-capture`) already owns the authoritative capture
 * ID (`live-YYYYMMDD-HHMMSS`) and uses it for the parent lifecycle
 * observer's `parent-lifecycle.json` directory. The in-process Node
 * witness independently generated its own capture ID via
 * `_captureIdFactory()`, producing two separate `capture-<id>/`
 * namespaces for the same run -- making the analyzer's compose step
 * fail because it expects ONE composed directory.
 *
 * CORRECTION08 (P0 — `HALT_TERMINATION_CAPTURE_ID_SPLIT`):
 * When set, the in-process witness uses this ID instead of generating
 * its own. The analyzer then reads a single directory containing
 * `meta.json` (in-process), `host-self-events.jsonl` (in-process),
 * `parent-lifecycle.json` (external observer), and the verdict.
 *
 * CONTRACT (frozen):
 *   - unset / empty      -> existing `_captureIdFactory()` behavior
 *                           preserved (CAPTURE-COMPOSE-02 conservation)
 *   - valid bounded ID   -> in-process witness uses that exact ID
 *   - unsafe value
 *     (`/`, `\`, `..`,
 *      null byte,
 *      or > MAX_CAPTURE_ID_LEN)
 *                        -> fail-closed: falls back to
 *                           `_captureIdFactory()` and emits a bounded
 *                           warn. The env var MUST NOT become a path
 *                           traversal seam. (CAPTURE-COMPOSE-03..06)
 *
 * The Go launcher (`cmd/clinemm-live-capture/startClineMM`) sets
 * `CLINEMM_DIAG_TERMINATION_CAPTURE_ID=<captureID>` alongside
 * `CLINEMM_DIAG_TERMINATION_AUTHORITY=1` and
 * `CLINEMM_USER_DATA_DIR=<dir>` so the in-process witness and the
 * external lifecycle observer share the same `capture-<id>/` namespace.
 */
export const CLINEMM_DIAG_TERMINATION_CAPTURE_ID_ENV = "CLINEMM_DIAG_TERMINATION_CAPTURE_ID"

/**
 * Hard upper bound on the operator-supplied capture ID. The Go
 * launcher's `live-YYYYMMDD-HHMMSS` shape is 18 chars; this bound is
 * conservative for future format changes (e.g. adding a suffix).
 */
export const TERMINATION_AUTHORITY_MAX_CAPTURE_ID_LEN = 128

/**
 * Subdirectory under the Cline data root where artifacts land.
 * MUST NOT collide with `diagnostics/cpu-profile/` (CPU profiler) or
 * `diagnostics/allocation-profile/` (allocation profiler). The
 * computed subdir is `diagnostics/termination-authority/`.
 */
export const TERMINATION_AUTHORITY_ARTIFACT_SUBDIR = "diagnostics/termination-authority"

/**
 * Hard upper bound on appended JSON events. Prevents a noisy process
 * (one firing `warning` repeatedly) from saturating the disk. The
 * witness appends in append-only mode until this cap, then begins
 * dropping with a bounded `_warn` rather than blocking.
 */
export const TERMINATION_AUTHORITY_MAX_EVENTS = 512

/**
 * Cap on parent-side observation write rounds (one round = one set of
 * samples). The parent-side observer is run externally; this is the
 * cap the witness enforces on the parent JSON, NOT a polling cap.
 */
export const TERMINATION_AUTHORITY_MAX_PARENT_ROUNDS = 256

/**
 * Maximum number of parent-side lifecycle JSON files retained. Older
 * ones are pruned on next run (FIFO by capture id timestamp).
 */
export const TERMINATION_AUTHORITY_MAX_PARENT_LIFECYCLE_FILES = 8

/**
 * Maximum number of macOS crash report summaries retained (file paths
 * + bounded per-field summary). Full reports are NOT copied into
 * permanent repo evidence by design.
 */
export const TERMINATION_AUTHORITY_MAX_CRASH_REPORT_SUMMARIES = 4

/**
 * Bounded number of bytes retained per crash-report-summary entry
 * (process_name + exception_type + termination_reason + first frames).
 * Crash reports can be large; this is the amount we are willing to
 * mirror into our capture dir.
 */
export const TERMINATION_AUTHORITY_CRASH_REPORT_SUMMARY_BYTES_MAX = 16 * 1024

// =============================================================================
// State machine
// =============================================================================

/**
 * Witness state. Frozen union.
 *
 * Transitions:
 *
 *   public runtime              -> disabled
 *   dogfood + knob absent       -> disabled
 *   dogfood + knob=1            -> armed
 *   armed + install()           -> installed
 *   installed + process signal  -> stays installed (evidence appended)
 */
export type TerminationAuthorityState = "disabled" | "armed" | "installed"

/**
 * Discriminator union for a single host-self event observed through
 * one of the Node `process.on(...)` channels. The kind is the source
 * channel; the payload is bounded by schema below.
 *
 * FROZEN SAFE-LIST (per CORRECTION01 + CORRECTION02):
 *   The witness observes ONLY channels that are provably observational
 *   for process-termination attribution AND cannot keep the process
 *   alive on their own. Specifically:
 *
 *     - exit                (observation only; sync flush before death;
 *                            Node guarantees this does not extend the
 *                            process lifetime — only synchronous
 *                            operations are allowed in `exit`)
 *     - uncaughtExceptionMonitor  (observational; Node guarantees this
 *                                  does not change eventual crash)
 *     - warning             (observation only; non-load-bearing for
 *                            termination attribution)
 *
 *   The following channels are DELIBERATELY NOT observed because
 *   installing a listener would alter process-termination semantics:
 *
 *     - beforeExit          (REMOVED in CORRECTION02: per Node.js docs,
 *                            a beforeExit listener may schedule
 *                            asynchronous work (e.g. the witness's own
 *                            async `writer()` path) and cause the
 *                            process to continue instead of exiting.
 *                            Even when not strictly required, the
 *                            channel is not load-bearing for TA1..TA6.)
 *     - unhandledRejection  (default `--unhandled-rejections=throw`
 *                            becomes effective ONLY if no listener is
 *                            installed)
 *     - rejectionHandled     (default no-op; not load-bearing)
 *     - SIGHUP / SIGINT / SIGTERM / SIGPIPE / SIGBREAK / SIGWINCH
 *                           (default Node dispositions for these
 *                            signals are active ONLY when no listener
 *                            is installed)
 *     - uncaughtException   (fatal-handler; explicitly forbidden)
 */
export type TerminationAuthorityEventKind = "exit" | "uncaughtExceptionMonitor" | "warning"

/**
 * Bounded shape of one self-event row. We do NOT serialize full
 * stack traces on `warning`, full multi-line object printouts on
 * `unhandledRejection`, etc. -- only enough to identify the cause.
 */
export interface TerminationAuthorityEvent {
	readonly kind: TerminationAuthorityEventKind
	readonly observed_at: string
	readonly pid: number
	readonly uptime_ms: number
	/** exit code (`exit` channel only; undefined elsewhere) */
	readonly exit_code?: number
	/** signal name (`exit` channel only; undefined elsewhere) */
	readonly signal?: string
	/** Bounded reason string -- never the full Error object. */
	readonly reason_kind?: string
	/** First line of the stack/message, capped to BOUNDED_REASON_LEN. */
	readonly reason_first_line?: string
	/** `warning` only -- bounded name field. */
	readonly warning_name?: string
	/**
	 * `uncaughtExceptionMonitor` / `unhandledRejection` only --
	 * bounded stack head (`stack.split("\n")[0]`-ish), NOT the full
	 * stack. We rely on Node's crash inspector for the stack.
	 */
	readonly stack_head?: string
	/**
	 * Some channels emit non-Error objects (e.g. strings). We record
	 * the JS typeof, NOT the value, to keep this bounded.
	 */
	readonly reason_typeof?: string
	/** Monotonic counter so the analyzer can detect dropped events. */
	readonly seq: number
}

export interface TerminationAuthorityCounters {
	armedAt: Date | undefined
	installedAt: Date | undefined
	observedEventCount: number
	droppedEventCount: number
	lastEventKind: TerminationAuthorityEventKind | undefined
	lastEventObservedAt: string | undefined
	processExitObserved: boolean
	processExitObservedAt: string | undefined
	processExitCode: number | undefined
	uncaughtExceptionMonitorObserved: boolean
	warningObserved: boolean
}

/**
 * Snapshot accessor type for the analyzer + dumpers.
 */
export interface TerminationAuthoritySnapshot {
	state: TerminationAuthorityState
	armedAt: Date | undefined
	installedAt: Date | undefined
	counters: Readonly<TerminationAuthorityCounters>
	captureId: string | undefined
	knob: boolean
}

// =============================================================================
// Module state (mutable; single per process)
// =============================================================================

let _state: TerminationAuthorityState = "disabled"
let _captureId: string | undefined
let _captureIdFactory: () => string = defaultCaptureIdFactory
const _events: TerminationAuthorityEvent[] = []
let _counters: TerminationAuthorityCounters = freshCounters()
let _eventListenersInstalled = false
let _knob = false
let _warn: TerminationAuthorityWarn = (m) => Logger.warn(`[termination-authority] ${m}`)

/** Append-only write seam. Production = node:fs/promises appendFile. Tests inject. */
export type TerminationAuthorityWriter = (target: string, line: string) => Promise<void>

let _writer: TerminationAuthorityWriter | undefined

/** Cline data root resolver. Production = resolveDataDirFromEnv. */
export type TerminationAuthorityDataRootResolver = () => string

let _dataRootResolver: TerminationAuthorityDataRootResolver | undefined

export type TerminationAuthorityWarn = (message: string) => void

function freshCounters(): TerminationAuthorityCounters {
	return {
		armedAt: undefined,
		installedAt: undefined,
		observedEventCount: 0,
		droppedEventCount: 0,
		lastEventKind: undefined,
		lastEventObservedAt: undefined,
		processExitObserved: false,
		processExitObservedAt: undefined,
		processExitCode: undefined,
		uncaughtExceptionMonitorObserved: false,
		warningObserved: false,
	}
}

function defaultCaptureIdFactory(): string {
	const ts = Date.now().toString(36)
	const rand = Math.floor(Math.random() * 2 ** 32 * 2 ** 32 - 1)
		.toString(16)
		.padStart(16, "0")
	return `${ts}-${rand}`
}

// =============================================================================
// Env resolver (pure)
// =============================================================================

/**
 * Resolve the effective termination-authority knob.
 *
 * CONTRACT (frozen per ACT §8):
 *   - isDogfood === false   -> returns false regardless of env
 *   - isDogfood === true    -> env knob honored ONLY if truthy
 *   - empty / missing env   -> returns false
 *   - non-truthy env value  -> returns false
 *
 * This function NEVER throws. It NEVER logs. It NEVER touches the
 * filesystem. It is a pure resolver.
 */
export function resolveTerminationAuthorityKnobFromEnv(isDogfood: boolean, env: NodeJS.ProcessEnv): boolean {
	if (!isDogfood) {
		return false
	}
	const raw = env[CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]
	if (typeof raw !== "string" || raw.length === 0) {
		return false
	}
	const normalized = raw.trim().toLowerCase()
	return normalized === "1" || normalized === "true" || normalized === "yes"
}

/**
 * Resolve the operator-supplied capture ID from the env (if any).
 *
 * CONTRACT (frozen per CORRECTION08 + CORRECTION09):
 *   - env var unset / empty         -> returns undefined (caller falls
 *                                      back to `_captureIdFactory()`)
 *   - env var set to a valid ID
 *     (matches `^[A-Za-z0-9_-]+$`,
 *      1..MAX_CAPTURE_ID_LEN chars,
 *      no `/`, no `\`, no `..`, no NUL,
 *      no leading/trailing/internal whitespace) -> returns that
 *                                      EXACT ID byte-for-byte
 *   - env var set to anything else   -> returns undefined; caller
 *                                      falls back to the factory.
 *                                      The function NEVER throws;
 *                                      it NEVER logs; it is a pure
 *                                      resolver. The caller surfaces
 *                                      a bounded `_warn` so the
 *                                      operator can see the unsafe
 *                                      value without the env var
 *                                      becoming a path traversal
 *                                      seam.
 *
 * CORRECTION09 tightening: the resolver used to `.trim()` the
 * supplied value and accept the trimmed form. That allowed a
 * divergence between the Go launcher's argv `--capture-id "  foo  "`
 * (which writes `capture-  foo  /`) and the Node resolver's
 * trimmed `"foo"` (which would land at `capture-foo/`) — exactly
 * the kind of split that the analyzer cannot compose. The new
 * contract is exact byte-for-byte identity or REFUSE; the operator
 * sees the bounded warn and can fix the source.
 *
 * Validation rationale: the capture ID flows into
 * `<dataRoot>/diagnostics/termination-authority/capture-<id>/<files>`.
 * Rejecting `/`, `\`, `..`, NUL, and whitespace closes the obvious
 * traversal vectors and forces producer identity. The character
 * class `[A-Za-z0-9_-]` covers the Go launcher's
 * `live-YYYYMMDD-HHMMSS` format and any reasonable future shape
 * (e.g. `live-YYYYMMDD-HHMMSS-<rand>`, ULIDs, etc.) without
 * permitting path metacharacters or shell metacharacters.
 *
 * This function NEVER throws. It NEVER logs. It NEVER touches the
 * filesystem. It is a pure resolver.
 */
export function resolveOperatorTerminationCaptureIdFromEnv(env: NodeJS.ProcessEnv): string | undefined {
	const raw = env[CLINEMM_DIAG_TERMINATION_CAPTURE_ID_ENV]
	if (typeof raw !== "string") {
		return undefined
	}
	// CORRECTION09: empty / whitespace-only / oversized / path-meta /
	// NUL are all REFUSE-and-fall-back. We do NOT silently trim:
	// the captured value MUST match byte-for-byte the value the Go
	// launcher used to build `capture-<id>/` on the external
	// observer side, otherwise the analyzer cannot compose the
	// two halves.
	if (raw.length === 0) {
		return undefined
	}
	if (raw.length > TERMINATION_AUTHORITY_MAX_CAPTURE_ID_LEN) {
		return undefined
	}
	if (raw.includes("\0")) {
		return undefined
	}
	// Any whitespace (leading, trailing, or internal) is REFUSED.
	// The character-class regex below already excludes all
	// whitespace, but we keep an explicit early reject for
	// readability and to short-circuit before regex.
	if (/\s/.test(raw)) {
		return undefined
	}
	if (raw.includes("/") || raw.includes("\\")) {
		return undefined
	}
	if (raw.includes("..")) {
		return undefined
	}
	// Conservative shape: letters, digits, underscore, hyphen.
	if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
		return undefined
	}
	return raw
}

const BOUNDED_REASON_LEN = 280
const _BOUNDED_STACK_HEAD_LEN = 280

/**
 * Bound a string to BOUNDED_REASON_LEN, replacing newlines with
 * spaces so the JSONL stays one-line. Used for reason_first_line.
 */
function boundLine(s: string | undefined): string | undefined {
	if (typeof s !== "string") return undefined
	const flat = s.replace(/\s+/g, " ").trim()
	if (flat.length === 0) return undefined
	if (flat.length <= BOUNDED_REASON_LEN) return flat
	return `${flat.slice(0, BOUNDED_REASON_LEN)}...<truncated>`
}

/**
 * Bound a stack head: take the first line only, then bound.
 * Used for stack_head.
 */
function boundStackHead(stack: string | undefined): string | undefined {
	if (typeof stack !== "string") return undefined
	const first = stack.split("\n", 1)[0]
	return boundLine(first)
}

/**
 * Best-effort classification of `reason` into a kind string. We
 * only surface the type and the FIRST LINE; we never serialize the
 * raw Error or string. This is intentionally lossy — Node's crash
 * inspector / V8 are the authority on stack shape.
 */
function classifyReason(reason: unknown): {
	reason_kind?: string
	reason_first_line?: string
	reason_typeof?: string
} {
	if (reason === undefined || reason === null) {
		return { reason_typeof: reason === null ? "null" : "undefined" }
	}
	if (reason instanceof Error) {
		return {
			reason_kind: "Error",
			reason_first_line: boundLine(reason.message ?? "(no message)"),
			reason_typeof: "object",
		}
	}
	const t = typeof reason
	if (t === "string") {
		return {
			reason_kind: "String",
			reason_first_line: boundLine(reason as string),
			reason_typeof: "string",
		}
	}
	return {
		reason_kind: t,
		reason_first_line: boundLine(String(reason)),
		reason_typeof: t,
	}
}

/**
 * THE single production resolver for the termination-authority knob.
 * Returns the new state so callers can detect flips.
 */
export function applyExtensionHostTerminationAuthorityPolicy(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	const should = resolveTerminationAuthorityKnobFromEnv(isDogfood, env)
	_knob = should
	if (should && _state === "disabled") {
		_state = "armed"
		_counters = freshCounters()
		_counters.armedAt = new Date()
		return { enabled: true, flipped: true }
	}
	if (!should && (_state === "disabled" || _state === "armed")) {
		_state = "disabled"
		_counters = freshCounters()
		return { enabled: false, flipped: false }
	}
	return { enabled: should, flipped: false }
}

// =============================================================================
// Accessors (read-only)
// =============================================================================

export function getTerminationAuthorityState(): TerminationAuthorityState {
	return _state
}

export function getTerminationAuthorityCaptureId(): string | undefined {
	return _captureId
}

export function getTerminationAuthorityEventCount(): number {
	return _counters.observedEventCount
}

export function getTerminationAuthoritySnapshot(): TerminationAuthoritySnapshot {
	return {
		state: _state,
		armedAt: _counters.armedAt,
		installedAt: _counters.installedAt,
		counters: { ..._counters },
		captureId: _captureId,
		knob: _knob,
	}
}

// =============================================================================
// Internal mutators (test seams; do NOT use in production)
// =============================================================================

export function setTerminationAuthorityCaptureIdFactory(factory: () => string): void {
	_captureIdFactory = factory
}

export function setTerminationAuthorityDataRootResolver(resolver: TerminationAuthorityDataRootResolver | undefined): void {
	_dataRootResolver = resolver
}

export function setTerminationAuthorityWriter(writer: TerminationAuthorityWriter | undefined): void {
	_writer = writer
}

export function setTerminationAuthorityWarn(fn: TerminationAuthorityWarn): void {
	_warn = fn
}

/**
 * Reset the witness to the disabled state and clear all counters.
 * Test seam ONLY.
 */
export function __resetTerminationAuthorityForTests(): void {
	_state = "disabled"
	_captureId = undefined
	_captureIdFactory = defaultCaptureIdFactory
	_dataRootResolver = undefined
	_writer = undefined
	_warn = (m) => Logger.warn(`[termination-authority] ${m}`)
	_counters = freshCounters()
	_events.length = 0
	_eventListenersInstalled = false
	_knob = false
}

// =============================================================================
// Install seam (production)
// =============================================================================

/**
 * Install the witness on the current process. Idempotent.
 *
 * Mirrors the producer-side install model used by the CPU profiler
 * and the allocation profiler: pure module owns the policy + the
 * event handlers; the runtime module owns the FS / IO seams.
 *
 * Invariants:
 *   - MAY be called only when getTerminationAuthorityState() === "armed".
 *     Calling on "disabled" is a no-op + a bounded warn.
 *   - NEVER throws. Idempotent: a second install() is a no-op.
 *   - NEVER alters command / continuation / completion semantics.
 *   - Installs ONLY the documented observational listeners (frozen
 *     safe-list per CORRECTION01 + CORRECTION02):
 *       exit, uncaughtExceptionMonitor, warning
 *     Does NOT install `beforeExit` (REMOVED in CORRECTION02: it can
 *     schedule asynchronous work and keep the process alive). Does
 *     NOT install signal listeners (SIGHUP/SIGINT/SIGTERM/SIGPIPE/
 *     SIGBREAK/SIGWINCH) because installing one removes Node's
 *     default disposition for that signal. Does NOT install
 *     unhandledRejection because installing one removes the default
 *     `--unhandled-rejections=throw` behavior. Does NOT install
 *     `uncaughtException` (fatal-handler) — only
 *     `uncaughtExceptionMonitor` (observational), per Node docs.
 *   - NEVER calls process.exit().
 */
export async function installTerminationAuthorityWitness(): Promise<void> {
	if (_state !== "armed") {
		_warn(`install skipped: state=${_state} (not armed)`)
		return
	}
	if (_eventListenersInstalled) {
		return
	}
	const writer = _writer
	const dataRootResolver = _dataRootResolver
	if (!writer || !dataRootResolver) {
		_warn("install skipped: writer or dataRootResolver seam not bound (runtime wiring missing)")
		return
	}
	const rawEnvCaptureId = process.env[CLINEMM_DIAG_TERMINATION_CAPTURE_ID_ENV]
	const operatorCaptureId = resolveOperatorTerminationCaptureIdFromEnv(process.env)
	const captureId = operatorCaptureId ?? _captureIdFactory()
	// CORRECTION08: when the operator set the env var but the
	// resolver REJECTED it (path-traversal / unbounded), fall back
	// to the factory AND surface a bounded warn so the operator
	// sees the rejection. Silent acceptance would let a typo
	// ("live-20260924/203917") silently produce a non-composed
	// capture directory — recreating exactly the HALT we are
	// fixing.
	if (rawEnvCaptureId !== undefined && operatorCaptureId === undefined) {
		_warn(`operator capture id rejected (env=${CLINEMM_DIAG_TERMINATION_CAPTURE_ID_ENV}); falling back to factory`)
	}
	_captureId = captureId
	const captureDir = `${dataRootResolver()}/${TERMINATION_AUTHORITY_ARTIFACT_SUBDIR}/capture-${captureId}`
	const eventsPath = `${captureDir}/host-self-events.jsonl`
	const verdictPath = `${captureDir}/verdict.json`

	// Best-effort mkdir before installing listeners. If mkdir fails,
	// we still install the listeners in-memory and queue events to
	// the bounded ring buffer; the analyzer reads from the ring when
	// the on-disk capture dir is unavailable.
	let persistedDir = false
	try {
		const fs = await import("node:fs/promises")
		await fs.mkdir(captureDir, { recursive: true })
		persistedDir = true
	} catch (err) {
		_warn(`mkdir failed (ring-buffer fallback): ${errorMessage(err)}`)
	}

	_counters.installedAt = new Date()
	const installedAt = _counters.installedAt

	if (persistedDir) {
		try {
			const meta = buildTopMeta({
				captureId,
				state: "installed",
				installedAt,
				counters: _counters,
			})
			await writer(`${captureDir}/meta.json`, meta)
		} catch (err) {
			_warn(`meta write failed: ${errorMessage(err)}`)
		}
	}

	// Helper: append a JSONL row to the bounded ring buffer AND (best
	// effort) persist it via the writer seam. We never await the
	// writer; the listener MUST be fast.
	const record = (kind: TerminationAuthorityEventKind, extra: Record<string, unknown>): void => {
		if (_counters.observedEventCount >= TERMINATION_AUTHORITY_MAX_EVENTS) {
			_counters.droppedEventCount += 1
			if (_counters.droppedEventCount === 1 || _counters.droppedEventCount % 64 === 0) {
				_warn(`dropped event (cap ${TERMINATION_AUTHORITY_MAX_EVENTS}): kind=${kind}`)
			}
			return
		}
		const observedAt = new Date().toISOString()
		const event: TerminationAuthorityEvent = {
			kind,
			observed_at: observedAt,
			pid: process.pid,
			uptime_ms: Math.round(process.uptime() * 1000),
			seq: _counters.observedEventCount,
			...extra,
		}
		_events.push(event)
		_counters.observedEventCount += 1
		_counters.lastEventKind = kind
		_counters.lastEventObservedAt = observedAt
		if (kind === "uncaughtExceptionMonitor") {
			_counters.uncaughtExceptionMonitorObserved = true
		}
		if (kind === "warning") {
			_counters.warningObserved = true
		}
		if (persistedDir) {
			void writer(eventsPath, `${JSON.stringify(event)}\n`).catch((err) => {
				_counters.droppedEventCount += 1
				if (_counters.droppedEventCount <= 3) {
					_warn(`event append failed: ${errorMessage(err)}`)
				}
			})
		}
	}

	process.on("uncaughtExceptionMonitor", (err, origin) => {
		const classified = classifyReason(err)
		record("uncaughtExceptionMonitor", {
			...classified,
			warning_name: boundLine(String(origin)),
		})
	})
	process.on("warning", (warning) => {
		record("warning", {
			warning_name: boundLine(warning?.name ?? "Warning"),
			reason_first_line: boundLine(warning?.message ?? "(no message)"),
			stack_head: boundStackHead(warning?.stack),
		})
	})

	// `exit` listener MUST run synchronously to flush its event
	// before the process exits. Process exit listeners complete
	// before the process actually terminates, but the event loop
	// is unreliable in that phase — so we use sync fs here.
	process.on("exit", (code) => {
		const observedAt = new Date().toISOString()
		const event: TerminationAuthorityEvent = {
			kind: "exit",
			observed_at: observedAt,
			pid: process.pid,
			uptime_ms: Math.round(process.uptime() * 1000),
			exit_code: code,
			seq: _counters.observedEventCount,
		}
		_events.push(event)
		_counters.observedEventCount += 1
		_counters.lastEventKind = "exit"
		_counters.lastEventObservedAt = observedAt
		_counters.processExitObserved = true
		_counters.processExitObservedAt = observedAt
		_counters.processExitCode = code
		if (persistedDir) {
			try {
				const fsSync = require("node:fs") as typeof import("node:fs")
				fsSync.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8")
				const finalMeta = buildTopMeta({
					captureId,
					state: "installed",
					installedAt,
					counters: _counters,
				})
				fsSync.writeFileSync(`${captureDir}/meta.json`, finalMeta, "utf8")
				const verdict = computeTerminationAuthorityVerdict({
					captureId,
					installedAt,
					counters: _counters,
					eventCount: _counters.observedEventCount,
					// In-process witness alone cannot independently confirm;
					// a downstream operator-side analyzer will recompute
					// once parent-side evidence lands.
					processExitedNormally: false,
					nativeCrashReportPresent: false,
					externalTerminationReported: false,
					resourceExhaustionReported: false,
				})
				fsSync.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2), "utf8")
			} catch (err) {
				try {
					process.stderr.write(`[termination-authority] exit-flush failed: ${errorMessage(err)}\n`)
				} catch {
					/* no-op */
				}
			}
		}
	})

	_eventListenersInstalled = true
	_state = "installed"
}

// =============================================================================
// Verdict computation (pure; can be exercised by tests)
// =============================================================================

/**
 * Compute the termination-authority verdict from the observed
 * counters + external evidence. Pure function — the side-effect of
 * writing the verdict file is factored out so tests can call this
 * directly without touching the FS.
 *
 * See ACT §9 for the discriminator semantics. The output shape is
 * frozen so a downstream analyzer can consume it.
 */
export function computeTerminationAuthorityVerdict(input: {
	readonly captureId: string
	readonly installedAt: Date
	readonly counters: Readonly<TerminationAuthorityCounters>
	readonly eventCount: number
	readonly processExitedNormally: boolean
	readonly nativeCrashReportPresent: boolean
	readonly externalTerminationReported: boolean
	readonly resourceExhaustionReported: boolean
	// ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01
	// New (post-fix): parent-lifecycle evidence presence.
	// When FALSE, the classifier MUST NOT classify as TA6 even when
	// there are no host-self events. Absence of evidence from the
	// external witness is NOT evidence that the process survived.
	// Defaults to TRUE for backward compatibility with the prior
	// call site in extension-host-termination-authority.ts:651
	// (the in-process exit listener) which runs without an external
	// witness and where TA6 was a legitimate "no events captured"
	// outcome for that single-process scope.
	readonly parentLifecyclePresent?: boolean
	// New (post-fix): the affirmative negative witness. Set true
	// ONLY when parent-lifecycle.json explicitly confirms
	// observation_window_started=true AND
	// observation_window_completed=true AND
	// extension_host_started=true AND
	// extension_host_terminated=false AND
	// extension_host_restarted=false. Required for TA6.
	readonly affirmativeNegativeWitness?: boolean
	// New (post-fix): external lifecycle proves death/restart.
	// Set true when parent-lifecycle.json explicitly records
	// extension_host_terminated=true OR
	// extension_host_restarted=true. Routes the "PID disappeared
	// then replacement appeared" shape to TA5 (death observed but
	// authority unresolved) when no explicit authority exists.
	readonly externalLifecycleProvesDeath?: boolean
	// CORRECTION01 (P0 — false-TA6 on initial-dead PID): the
	// external observer MUST record at least one alive sample for
	// the bound PID before parent-lifecycle.json can authorize
	// TA6. When the requested PID is stale/already-dead when
	// observation begins, the observer now writes
	// extension_host_started_at = null and
	// extension_host_observed_alive = false; the analyzer maps
	// that to parentLifecycleObservedAlive = false. Defaults to
	// TRUE for backward compatibility with the prior call site
	// (in-process exit-listener verdict flush) and with the
	// legacy affirmative-negative-witness callers that pre-date
	// the CORRECTION01 invariant.
	readonly parentLifecycleObservedAlive?: boolean
}): TerminationAuthorityVerdict {
	const { counters, processExitedNormally, nativeCrashReportPresent, externalTerminationReported, resourceExhaustionReported } =
		input
	// ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01:
	// New TA6-affirmative-negative-witness invariant. Backward-
	// compatible defaults (parentLifecyclePresent=true,
	// affirmativeNegativeWitness=false, externalLifecycleProvesDeath
	// =false) preserve the prior classifier behavior for callers
	// that pre-date this ACT (e.g. the in-process exit-listener
	// verdict flush). The mjs analyzer supplies the explicit
	// values per its actual parent-lifecycle.json contents.
	const parentLifecyclePresent = input.parentLifecyclePresent ?? true
	const affirmativeNegativeWitness = input.affirmativeNegativeWitness ?? false
	const externalLifecycleProvesDeath = input.externalLifecycleProvesDeath ?? false
	// CORRECTION01: extract observed-alive invariant. Default TRUE
	// preserves prior behavior for legacy callers; the mjs
	// analyzer explicitly supplies this from the parent-lifecycle
	// samples[].
	const parentLifecycleObservedAlive = input.parentLifecycleObservedAlive ?? true
	const evidence_summary = {
		process_exit_observed: counters.processExitObserved,
		process_exit_code: counters.processExitCode,
		process_exit_at: counters.processExitObservedAt,
		uncaught_exception_monitor_observed: counters.uncaughtExceptionMonitorObserved,
		warning_observed: counters.warningObserved,
		native_crash_report_present: nativeCrashReportPresent,
		external_termination_reported: externalTerminationReported,
		resource_exhaustion_reported: resourceExhaustionReported,
	} as const

	// TA-D1: graceful / self-controlled exit.
	if (processExitedNormally && counters.processExitObserved && !nativeCrashReportPresent) {
		return {
			classification: "TA1",
			label: "PASS_TERMINATION_AUTHORITY_EXPLICIT_PROCESS_EXIT",
			summary: "process emitted exit; no native crash report; operator confirms clean shutdown",
			evidence_summary,
		}
	}

	// TA-D2: native crash. Acceptable with EITHER a matching crash
	// report OR an in-process signal-only configuration that the
	// operator later supplements. We require BOTH: the absence of
	// `exit` AND a matching native crash report.
	if (nativeCrashReportPresent) {
		return {
			classification: "TA2",
			label: "PASS_TERMINATION_AUTHORITY_NATIVE_CRASH",
			summary: "native crash report matches Extension Host PID + timestamp; no normal self-terminal event precedes",
			evidence_summary: { ...evidence_summary, native_crash_report_present: true },
		}
	}

	// TA-D3: external / watchdog termination. Requires BOTH the
	// process never fired `exit` AND a parent-side termination
	// report.
	if (externalTerminationReported && !counters.processExitObserved && !nativeCrashReportPresent) {
		return {
			classification: "TA3",
			label: "PASS_TERMINATION_AUTHORITY_EXTERNAL_OR_WATCHDOG",
			summary: "parent-side termination recorded; no self-terminal event; no native crash",
			evidence_summary: { ...evidence_summary, external_termination_reported: true },
		}
	}

	// TA-D4: resource termination. Requires BOTH a resource-exhaustion
	// report AND no normal self-terminal event.
	if (resourceExhaustionReported && !counters.processExitObserved && !nativeCrashReportPresent) {
		return {
			classification: "TA4",
			label: "PASS_TERMINATION_AUTHORITY_RESOURCE",
			summary: "resource-exhaustion report precedes death; no self-terminal event; no native crash",
			evidence_summary: { ...evidence_summary, resource_exhaustion_reported: true },
		}
	}

	// TA-D5: death observed but authority unresolved. Covers two
	// shapes:
	//   (a) host-self events captured but no explicit authority
	//       (was the original TA-D5 fallthrough)
	//   (b) external lifecycle proves death/restart (PID
	//       disappeared, replacement appeared) but no explicit
	//       authority is bound — ACT-LIVE-CLASSIFICATION01:
	//       this is NOT TA6 (TA6 is reserved for the affirmative
	//       negative-witness shape).
	if (
		counters.observedEventCount > 0 ||
		counters.processExitObserved ||
		(externalLifecycleProvesDeath && !nativeCrashReportPresent && !externalTerminationReported && !resourceExhaustionReported)
	) {
		return {
			classification: "TA5",
			label: "CAPTURE_INSUFFICIENT",
			summary: "process death observed but termination authority unresolved by current evidence",
			evidence_summary,
		}
	}

	// TA-D6: not reproduced.
	//
	// ACT-LIVE-CLASSIFICATION01 invariant: TA6 requires an
	// AFFIRMATIVE external negative witness. Without
	// parent-lifecycle.json confirming observation_window_started
	// AND observation_window_completed AND extension_host_started
	// AND extension_host_terminated=false AND
	// extension_host_restarted=false, the fallthrough is TA5 (not
	// TA6). Absence of evidence from a process that may have been
	// killed is NOT evidence that it survived.
	//
	// Backward-compat: when the caller does not supply the new
	// fields at all (the in-process exit-listener verdict flush)
	// the defaults keep the pre-fix behavior. When the caller
	// supplies parentLifecyclePresent=false (the mjs analyzer
	// found no parent-lifecycle.json) the classifier falls to TA5.
	//
	// CORRECTION01 (P0 — false-TA6 on initial-dead PID):
	// parentLifecycleObservedAlive MUST be true for TA6. The
	// default is true (preserves legacy behavior); the mjs
	// analyzer computes it from the parent-lifecycle samples[].
	// When the requested PID was stale/dead when observation
	// began, the observer never recorded a sample with alive=true
	// and parentLifecycleObservedAlive is false -> TA5.
	if (parentLifecyclePresent && affirmativeNegativeWitness && parentLifecycleObservedAlive && !nativeCrashReportPresent) {
		return {
			classification: "TA6",
			label: "NOT_REPRODUCED",
			summary:
				"external witness confirms completed observation window with at least one alive sample for the bound PID, no Extension Host death or restart; no matching native crash report",
			evidence_summary: {
				...evidence_summary,
				process_exit_observed: false,
			},
		}
	}

	// TA5 fallthrough (no host events + no external authority +
	// no affirmative negative witness): absence of evidence is
	// not evidence of absence. The classifier refuses to call
	// TA6 when the external witness is missing OR did not
	// affirmatively confirm a completed window without death.
	return {
		classification: "TA5",
		label: "CAPTURE_INSUFFICIENT",
		summary:
			"no host-self events observed AND external parent-side witness absent or non-affirming — absence of evidence is NOT evidence of absence; capture is insufficient to claim NOT_REPRODUCED",
		evidence_summary: {
			...evidence_summary,
			process_exit_observed: false,
		},
	}
}

export interface TerminationAuthorityVerdict {
	classification: "TA1" | "TA2" | "TA3" | "TA4" | "TA5" | "TA6"
	label: string
	summary: string
	evidence_summary: {
		process_exit_observed: boolean
		process_exit_code: number | undefined
		process_exit_at: string | undefined
		uncaught_exception_monitor_observed: boolean
		warning_observed: boolean
		native_crash_report_present: boolean
		external_termination_reported: boolean
		resource_exhaustion_reported: boolean
	}
}

/**
 * Build the top-level meta.json content for the capture directory.
 * Pure function; tests can call directly.
 */
export function buildTopMeta(input: {
	captureId: string
	state: "armed" | "installed"
	installedAt: Date
	counters: Readonly<TerminationAuthorityCounters>
}): string {
	const payload = {
		schema_version: 1,
		act: "ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01",
		capture_id: input.captureId,
		state: input.state,
		installed_at: input.installedAt.toISOString(),
		counters: input.counters,
	}
	return JSON.stringify(payload, null, 2)
}

/**
 * Read-only accessor for the in-memory bounded ring of events.
 * Used by the in-process analyzer when the on-disk capture dir is
 * unavailable (e.g. mkdir failed mid-install).
 */
export function getTerminationAuthorityEvents(): ReadonlyArray<TerminationAuthorityEvent> {
	return _events
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}
