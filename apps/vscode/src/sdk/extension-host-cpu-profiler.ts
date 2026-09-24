/**
 * ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
 *
 * TEMPORARY bounded rolling V8 CPU profiler for the ClineMM Extension
 * Host process. Acquires the CORRECT evidence type for identifying the
 * real production CPU leaf responsible for the unresponsive extension
 * host captured by exthost-402d7f.cpuprofile (where the reactive
 * VSCodium emergency profiler attaches AFTER the stall has begun and
 * therefore captures only the dying tail).
 *
 * CRITICAL PROTOCOL CONSTRAINT (frozen per ACT §3):
 *
 *   For CPU sampling, the CDP Profiler domain has NO equivalent of
 *   HeapProfiler.getSamplingProfile() that returns a snapshot while
 *   sampling remains active. The protocol surface contains
 *   Profiler.start and Profiler.stop; Profiler.stop returns the
 *   completed profile.
 *
 *   Therefore crash-survivable CPU capture MUST use bounded segments:
 *
 *     Profiler.start  -> sample for N ms -> Profiler.stop (returns P)
 *     -> atomically persist P -> Profiler.start  (next segment)
 *
 *   If the host crashes mid-segment, segments 0..K-1 are safely
 *   persisted; segment K is lost. This is the explicit and
 *   acceptable contract.
 *
 *   We do NOT use the HeapProfiler pattern (startSampling +
 *   getSamplingProfile) because no such snapshot primitive exists
 *   for CPU.
 *
 * DESIGN CONSTRAINTS (frozen in this ACT):
 *   - DEFAULT_OFF: profiler is disabled unless the explicit env knob
 *     CLINEMM_DIAG_CPU_PROFILE=<truthy> is set.
 *   - DOGFOOD_ONLY: the env knob is honored ONLY in dogfood. Public
 *     installs cannot enable the profiler regardless of env.
 *   - BOUNDED: total capture horizon is hard-capped at
 *     MAX_DURATION_MS (60000). Each segment is bounded at
 *     SEGMENT_MS (5000).
 *   - ONE-SHOT: a single capture per Extension Host process.
 *   - NO PROTOCOL FIELD: profiler internals never serialize into proto.
 *   - NO WEBVIEW FIELD: profiler internals never appear in webview state.
 *   - NO STATE-SEMANTIC DELTA: profiler never changes command /
 *     continuation / completion / CCARD / BTCONT / TQCB / projection
 *     behavior. Profiler failure logs a bounded warning and never
 *     throws into the host call path.
 *
 * REMOVAL_TRIGGER (SUPERSEDED per ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
 * operator directive, 2026-09-24): The original REMOVAL_TRIGGER said
 * the CPU profiler would be removed once CP1..CP5 was classified.
 * The operator has now overridden that policy: the CPU profiler is
 * RETAINED as a diagnostic substrate even after CP5 classification.
 * The module + the runtime + the trigger call site + the activation
 * helper + the env knob + the focused tests + the analyzer script
 * MAY stay in the tree as a labeled diagnostic substrate. Removal
 * now requires an explicit bounded-removal ACT.
 */

// =============================================================================
// Imports
// =============================================================================

import { Logger } from "@/shared/services/Logger"

// =============================================================================
// Constants (frozen; tuning is for a later bounded correction ACT)
// =============================================================================

/** Env var name. Honored ONLY in dogfood (fail-closed in public). */
export const CLINEMM_DIAG_CPU_PROFILE_ENV = "CLINEMM_DIAG_CPU_PROFILE"

/**
 * CDP Profiler sampling interval (microseconds). Do not assume the default is
 * ideal — explicitly call Profiler.setSamplingInterval per ACT §10.
 */
export const CPU_PROFILE_SAMPLING_INTERVAL_US = 1000

/** Segment duration in ms. 5s is the bounded compromise per ACT §8. */
export const CPU_PROFILE_SEGMENT_MS = 5_000

/** Total capture horizon in ms. Timer is the authority (per ACT §9). */
export const CPU_PROFILE_MAX_DURATION_MS = 60_000

/**
 * Maximum number of completed segments retained on disk. At SEGMENT_MS=5000
 * and MAX_DURATION_MS=60000, 12 segments == 60s of evidence (per ACT §14).
 */
export const CPU_PROFILE_MAX_RETAINED_SEGMENTS = 12

/**
 * Perturbation gate: if a single rotation wall exceeds this, the profiler
 * records a slow-rotation event but does NOT auto-stop (per ACT §13).
 */
export const CPU_PROFILE_PERTURBATION_WARN_MS = 250

/** Subdirectory under the Cline data root where artifacts land. */
export const CPU_PROFILE_ARTIFACT_SUBDIR = "diagnostics/cpu-profile"

// =============================================================================
// State machine
// =============================================================================

/**
 * CPU profiler state. Frozen union; adding a state is a durable API
 * change requiring a new ACT.
 *
 * Transitions:
 *
 *   public runtime
 *     -> disabled
 *
 *   dogfood + knob absent
 *     -> disabled
 *
 *   dogfood + knob=1
 *     -> armed
 *
 *   armed + qualifying trigger
 *     -> starting -> active
 *
 *   active + segment timer
 *     -> rotating -> write completed segment -> active
 *
 *   capture horizon reached
 *     -> stop current segment -> write final -> finalized
 *
 *   protocol failure
 *     -> failed
 */
export type CpuProfilerState = "disabled" | "armed" | "starting" | "active" | "rotating" | "finalized" | "failed"

/**
 * Discriminated trigger result. The trigger function NEVER throws and
 * NEVER awaits. The host call path treats every kind as a no-op for
 * command semantics.
 */
export type CpuProfilerTriggerResult =
	| { readonly kind: "skipped"; readonly reason: string; readonly previousState: CpuProfilerState }
	| { readonly kind: "started"; readonly captureId: string; readonly previousState: CpuProfilerState }
	| { readonly kind: "failed"; readonly reason: string; readonly previousState: CpuProfilerState }

let _state: CpuProfilerState = "disabled"

/** Capture identity for the current process. */
let _captureId: string | undefined

/** Capture identity factory. Default = ULID-shaped; tests inject fakes. */
let _captureIdFactory: () => string = defaultCaptureIdFactory

/**
 * Performance counters for the rolling-segment capture. Used by ACT §13
 * perturbation gate. Every rotation records its wall-time breakdown.
 */
export interface CpuProfilePerformanceCounters {
	segmentCount: number
	successfulSegmentCount: number
	failedSegmentCount: number
	stopMsTotal: number
	serializeMsTotal: number
	writeMsTotal: number
	restartMsTotal: number
	rotationWallMsTotal: number
	slowRotationCount: number
	maxRotationWallMs: number
	profileBytesMax: number
	sampleCountMax: number
}

let _perf: CpuProfilePerformanceCounters = freshPerfCounters()

function freshPerfCounters(): CpuProfilePerformanceCounters {
	return {
		segmentCount: 0,
		successfulSegmentCount: 0,
		failedSegmentCount: 0,
		stopMsTotal: 0,
		serializeMsTotal: 0,
		writeMsTotal: 0,
		restartMsTotal: 0,
		rotationWallMsTotal: 0,
		slowRotationCount: 0,
		maxRotationWallMs: 0,
		profileBytesMax: 0,
		sampleCountMax: 0,
	}
}

/**
 * Default capture-id factory. ULID-shaped: timestamp + 16 random hex chars.
 */
function defaultCaptureIdFactory(): string {
	const ts = Date.now().toString(36)
	const rand = Math.floor(Math.random() * 2 ** 32 * 2 ** 32 - 1)
		.toString(16)
		.padStart(16, "0")
	return `${ts}-${rand}`
}

// =============================================================================
// Inspector / IO / identity seams
// =============================================================================

/**
 * Narrow inspector session interface. Production = Node inspector.Session
 * adapter. Tests inject deterministic fakes.
 */
export interface CpuProfilerInspectorSession {
	connect(): void
	disconnect(): void
	post(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export type CpuProfilerInspectorSessionFactory = () => CpuProfilerInspectorSession

let _inspectorSessionFactory: CpuProfilerInspectorSessionFactory | undefined

/** Filesystem seam. Production = node:fs/promises. Tests inject fakes. */
export interface CpuProfilerFilesystem {
	mkdir(path: string, options: { recursive: boolean }): Promise<void>
	rename(from: string, to: string): Promise<void>
	writeFile(path: string, data: string): Promise<void>
}

let _filesystem: CpuProfilerFilesystem | undefined

/** CLine data root resolver. Production = the CLINE_DIR resolver. */
export type CpuProfilerDataRootResolver = () => string

let _dataRootResolver: CpuProfilerDataRootResolver | undefined

/** Identity-binding shape used in meta.json. */
export interface CpuProfilerIdentityBinding {
	sourceHead: string
	version: string
	extensionPath: string
	extensionBundleSha256: string
}

export type CpuProfilerIdentityResolver = () => CpuProfilerIdentityBinding

let _identityResolver: CpuProfilerIdentityResolver | undefined

/** Logger seam. Production = Logger.warn. Tests inject recorder. */
export type CpuProfilerWarn = (message: string) => void

let _warn: CpuProfilerWarn = (message) => {
	Logger.warn(`[cpu-profiler] ${message}`)
}

// =============================================================================
// Env resolver (pure)
// =============================================================================

/**
 * Resolve the effective cpu-profile knob.
 *
 * CONTRACT (frozen):
 *   - isDogfood === false  ->  returns false regardless of env
 *   - isDogfood === true   ->  env knob honored ONLY if truthy
 *   - empty / missing env  ->  returns false
 *   - non-truthy env value ->  returns false
 *
 * This function NEVER throws. It NEVER logs. It NEVER touches the
 * filesystem. It is a pure resolver.
 */
export function resolveCpuProfileKnobFromEnv(isDogfood: boolean, env: NodeJS.ProcessEnv): boolean {
	if (!isDogfood) {
		return false
	}
	const raw = env[CLINEMM_DIAG_CPU_PROFILE_ENV]
	if (typeof raw !== "string" || raw.length === 0) {
		return false
	}
	const normalized = raw.trim().toLowerCase()
	return normalized === "1" || normalized === "true" || normalized === "yes"
}

/**
 * THE single production resolver for the cpu-profile knob.
 * Returns the new state so callers can detect flips.
 *
 * Called from `applyExtensionHostCpuProfilerProfile` in
 * `dogfood-diagnostic-profile.ts`. There is no other production call
 * site.
 */
export function applyExtensionHostCpuProfilerPolicy(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	const should = resolveCpuProfileKnobFromEnv(isDogfood, env)
	const wasArmed = _state === "armed"
	if (should && _state === "disabled") {
		_state = "armed"
		return { enabled: true, flipped: true }
	}
	if (!should && (_state === "armed" || _state === "disabled")) {
		_state = "disabled"
		return { enabled: false, flipped: wasArmed }
	}
	return { enabled: should, flipped: false }
}

// =============================================================================
// Accessors (read-only)
// =============================================================================

export function getCpuProfilerState(): CpuProfilerState {
	return _state
}

export function getCpuProfilerCaptureId(): string | undefined {
	return _captureId
}

export function getCpuProfilerPerformanceCounters(): Readonly<CpuProfilePerformanceCounters> {
	return _perf
}

/** Read-only snapshot for tests and dump adapters. */
export interface CpuProfilerSnapshot {
	state: CpuProfilerState
	captureId: string | undefined
	perf: Readonly<CpuProfilePerformanceCounters>
}

export function getCpuProfilerSnapshot(): CpuProfilerSnapshot {
	return { state: _state, captureId: _captureId, perf: _perf }
}

// =============================================================================
// Internal mutators (test seams; do NOT use in production)
// =============================================================================

export function setCpuProfilerCaptureIdFactory(factory: () => string): void {
	_captureIdFactory = factory
}

export function setCpuProfilerInspectorSessionFactory(factory: CpuProfilerInspectorSessionFactory | undefined): void {
	_inspectorSessionFactory = factory
}

export function setCpuProfilerFilesystem(fs: CpuProfilerFilesystem | undefined): void {
	_filesystem = fs
}

export function setCpuProfilerDataRootResolver(resolver: CpuProfilerDataRootResolver | undefined): void {
	_dataRootResolver = resolver
}

export function setCpuProfilerIdentityResolver(resolver: CpuProfilerIdentityResolver | undefined): void {
	_identityResolver = resolver
}

export function setCpuProfilerWarn(fn: CpuProfilerWarn): void {
	_warn = fn
}

/** Reset the profiler to disabled state and clear counters. Test seam ONLY. */
export function __resetCpuProfilerForTests(): void {
	_state = "disabled"
	_captureId = undefined
	_captureIdFactory = defaultCaptureIdFactory
	_inspectorSessionFactory = undefined
	_filesystem = undefined
	_dataRootResolver = undefined
	_identityResolver = undefined
	_finalizeDriver = undefined
	_segmentRotator = undefined
	_warn = (message) => {
		Logger.warn(`[cpu-profiler] ${message}`)
	}
	_perf = freshPerfCounters()
}

// =============================================================================
// Trigger function (synchronous, hot-path-safe)
// =============================================================================

/**
 * Hot-path-safe trigger.
 *
 * Called from the production background-handoff seam in
 * `vscode-run-commands-tool.ts` exactly once per qualifying job.
 *
 * Invariants:
 *   - Always returns synchronously; NEVER awaits.
 *   - Never throws.
 *   - Never changes command semantics.
 *   - Idempotent: subsequent calls in the same process return
 *     kind="skipped" because the state machine has advanced past "armed".
 *   - Failure returns kind="failed" but does NOT propagate.
 */
export function triggerExtensionHostCpuProfilerOnFirstQualifyingJob(): CpuProfilerTriggerResult {
	const previousState = _state
	if (_state !== "armed") {
		return {
			kind: "skipped",
			reason: `state=${_state} (not armed)`,
			previousState,
		}
	}

	// Atomic state flip. Subsequent triggers see != "armed" and short-circuit.
	_state = "starting"
	const captureId = _captureIdFactory()
	_captureId = captureId

	// Spawn the capture loop WITHOUT awaiting. The hot-path returns
	// synchronously to the caller. The loop runs in the background and
	// never throws into the host call path.
	void runCpuCaptureLoop(captureId).catch((error) => {
		_state = "failed"
		_warn(`capture loop crashed: ${errorMessage(error)}`)
	})

	return { kind: "started", captureId, previousState }
}

// =============================================================================
// Test seams (deterministic segment rotation + finalize)
// =============================================================================

/**
 * Segment rotation test seam. The capture loop installs this so tests
 * can rotate segments deterministically instead of waiting 5s wall-clock
 * per segment. No-op in production (the seam is never invoked).
 */
export type CpuProfilerSegmentRotator = (() => Promise<unknown>) | undefined

let _segmentRotator: CpuProfilerSegmentRotator

/**
 * Drive a single segment rotation synchronously (test-only).
 *
 * PRECONDITION: capture loop must be in state="active" or "rotating".
 * Returns a promise that resolves when the rotation has completed
 * (the next segment has been started OR the capture has finalized).
 *
 * Idempotent under state guard.
 */
export async function __driveSegmentRotationForTests(): Promise<void> {
	const rotator = _segmentRotator
	if (typeof rotator !== "function") {
		_warn("__driveSegmentRotationForTests called but no capture loop is active")
		return
	}
	await rotator()
}

/**
 * Finalizer test seam. Mirrors the pattern used in the allocation
 * profiler (per ALLOCAUTH-FINAL-* tests).
 */
export type CpuProfilerFinalizeDriver = (() => Promise<void>) | undefined

let _finalizeDriver: CpuProfilerFinalizeDriver

/**
 * Drive the finalizer synchronously (test-only).
 *
 * PRECONDITION: capture loop must be in state="active". The seam is a
 * no-op if state !== "active".
 */
export async function __driveFinalizerForTests(): Promise<void> {
	const driver = _finalizeDriver
	if (typeof driver !== "function") {
		_warn("__driveFinalizerForTests called but no capture loop is active")
		return
	}
	await driver()
}

// =============================================================================
// Capture loop
// =============================================================================

/**
 * Run the rolling CPU capture loop.
 *
 * Lifecycle (per ACT §7):
 *
 *   1. Connect inspector + Profiler.enable + Profiler.setSamplingInterval
 *   2. Profiler.start (segment 0)
 *   3. Wait SEGMENT_MS, then Profiler.stop -> persist segment 0
 *   4. Profiler.start (segment 1) -> wait -> stop -> persist
 *   5. ... repeat until MAX_DURATION_MS reached
 *   6. Final Profiler.stop + persist final segment -> state="finalized"
 *
 * Failure modes:
 *   - Profiler.enable / setSamplingInterval / start rejects: state="failed"
 *   - Profiler.stop rejects mid-rotation: increment counter, continue
 *     with next segment (transient recovery, mirrors ALLOCAUTH-CHECKPOINT
 *     behavior). If 2 consecutive stop failures, transition to "failed"
 *     to avoid indefinite stall.
 *   - Filesystem write rejects: count as transient rotation failure;
 *     segment is lost but the capture continues.
 *   - Timer wall-clock exceeds MAX_DURATION_MS: finalize.
 *
 * NEVER throws into the hot path.
 */
async function runCpuCaptureLoop(captureId: string): Promise<void> {
	const factory = _inspectorSessionFactory
	if (typeof factory !== "function") {
		_state = "failed"
		_warn("no inspector session factory registered")
		return
	}
	const filesystem = _filesystem
	const dataRootResolver = _dataRootResolver
	const identityResolver = _identityResolver
	if (!filesystem || !dataRootResolver || !identityResolver) {
		_state = "failed"
		_warn("required seams not registered")
		return
	}

	const startedAt = new Date()
	let session: CpuProfilerInspectorSession | undefined
	let segmentTimer: ReturnType<typeof setTimeout> | undefined
	let finalTimer: ReturnType<typeof setTimeout> | undefined

	let consecutiveStopFailures = 0
	let finalized = false
	/**
	 * Tracks the highest segment index that was persisted successfully.
	 * `latest-complete.json.latest_segment_index` reads from this value
	 * even if the most recent rotation's write failed — preserving the
	 * authoritative complete-checkpoint pointer (per ACT
	 * ROTATE-FAIL-CORRECTION02 P1 fix).
	 */
	let lastSuccessfulSegmentIndex = -1
	/**
	 * Wall-clock timestamp captured when the active segment began. Used
	 * as `started_at` in the segment meta (per ACT
	 * SEGMENT-WALLCLOCK-CORRECTION02 P1 fix). We do NOT derive it from
	 * `performance.now()` because `performance.now()` is monotonic
	 * relative to process origin and produces dates near 1970 when fed
	 * to `new Date()`.
	 */
	let activeSegmentStartedAt: Date = new Date()
	/**
	 * EXPLICIT sampling authority (per ACT
	 * ROTATION-RACE-CORRECTION03 P0 fix). `state === "active"` is NOT
	 * sufficient — rotation enters `state === "rotating"` and has
	 * ALREADY called `Profiler.stop` before finalization can decide
	 * whether to stop again. Only `profilerRunning === true` means a
	 * `Profiler.start` resolved successfully and the next stop will
	 * return a real profile. `_state` reflects capture lifecycle
	 * bookkeeping; `profilerRunning` reflects sampling authority.
	 *
	 * Set true after each successful Profiler.start (initial,
	 * post-rotation, recovery). Set false after each Profiler.stop
	 * (rotation, recovery-fail-stop, final). The MAX_DURATION
	 * finalizer and the rotation-driven horizon path consult this
	 * flag — the same flag — so neither path can issue a duplicate
	 * Profiler.stop.
	 *
	 * NOTE (per ACT INFLIGHT-STOP-CORRECTION04 P0 fix):
	 * `profilerRunning` alone is NOT sufficient — a `Profiler.stop`
	 * has been posted to the CDP but its Promise has not yet
	 * resolved. During that await window, an independent finalizer
	 * firing would see `profilerRunning === true` and post a
	 * duplicate stop. The in-flight stop authority
	 * (`stopInFlight`) tracks "a `Profiler.stop` Promise is
	 * currently outstanding" — that is the ONLY gate that
	 * guarantees "at most one Profiler.stop may be outstanding".
	 */
	let profilerRunning = false
	/**
	 * In-flight stop authority (per ACT INFLIGHT-STOP-CORRECTION04 P0
	 * fix). When rotate() or finalizeActiveCapture() has posted a
	 * `Profiler.stop` but is awaiting the response, `stopInFlight`
	 * is true. A second caller (e.g. the MAX_DURATION backstop
	 * finalizer firing while rotate()'s stop is unresolved) MUST
	 * see this flag and either await the existing Promise or bail —
	 * it MUST NOT post a duplicate Profiler.stop.
	 *
	 * Invariant: "at most one Profiler.stop may be outstanding".
	 * The only way a second Profiler.stop can be posted is if a
	 * Profiler.start has resolved successfully AND no Profiler.stop
	 * is currently outstanding. `stopInFlight` is set true
	 * synchronously BEFORE the `await session.post(...)` and false
	 * synchronously AFTER its `.then`/`.catch` continuation.
	 */
	let stopInFlight = false
	/**
	 * The Promise of the in-flight Profiler.stop (per ACT
	 * INFLIGHT-STOP-CORRECTION04 P0 fix). When `stopInFlight` is
	 * true, this holds the Promise that will resolve with the
	 * stop's result. A concurrent caller (e.g. finalizeActiveCapture
	 * entering while rotate()'s stop is unresolved) can await this
	 * Promise to observe the same stop result without issuing a
	 * duplicate Profiler.stop. This guarantees "at most one
	 * Profiler.stop may be outstanding" AND "all callers observe
	 * the same stop result".
	 */
	let inFlightStopPromise: Promise<unknown> | undefined
	/**
	 * Rotation body completion Promise (per ACT INFLIGHT-STOP-CORRECTION04
	 * P0 fix). When rotate() is in flight, this holds a Promise that
	 * resolves AFTER the rotation's body has fully settled —
	 * including persist, counter updates, and the disconnected-aware
	 * post-rotation Profiler.start check. A concurrent finalizer
	 * awaiting this Promise is guaranteed to observe the rotation's
	 * final _perf state before writing the capture meta.
	 */
	let rotationSettled: Promise<void> | undefined
	/**
	 * Finalization lock (per ACT ROTATION-RACE-CORRECTION03 P0 fix).
	 * Set true the instant `finalizeActiveCapture` begins and remains
	 * true until the function returns. `rotate()` checks this flag
	 * at entry — if finalization has begun, the rotation returns
	 * immediately so it cannot issue a Profiler.start that races
	 * with the finalizer's Profiler.stop.
	 */
	let finalizing = false

	/**
	 * Disconnected flag (per ACT INFLIGHT-STOP-CORRECTION04 P0 fix).
	 * Set when cleanup() has run. The rotate() post-stop Profiler.start
	 * guard checks this flag — if a finalizer fired concurrently with
	 * a rotation's in-flight stop and called cleanup() first, the
	 * rotation must NOT attempt its post-rotation Profiler.start on
	 * the disconnected session.
	 */
	let disconnected = false
	const cleanup = (): void => {
		disconnected = true
		if (segmentTimer !== undefined) {
			clearTimeout(segmentTimer)
			segmentTimer = undefined
		}
		if (finalTimer !== undefined) {
			clearTimeout(finalTimer)
			finalTimer = undefined
		}
		if (session) {
			try {
				session.disconnect()
			} catch {
				/* best-effort */
			}
			session = undefined
		}
		_segmentRotator = undefined
		_finalizeDriver = undefined
	}

	const transitionToFailed = (reason: string): void => {
		_state = "failed"
		_warn(`capture failed: ${reason}`)
		cleanup()
	}

	const dataRoot = dataRootResolver()
	const captureDir = `${dataRoot}/${CPU_PROFILE_ARTIFACT_SUBDIR}/capture-${captureId}`
	try {
		await filesystem.mkdir(captureDir, { recursive: true })
	} catch (error) {
		transitionToFailed(`mkdir: ${errorMessage(error)}`)
		return
	}
	const identity = identityResolver()

	// Write top-level meta.json ONCE at start. Per-segment entries
	// accumulate via the latest-complete.json sidecar (atomic rename).
	const topMeta = buildTopMeta({
		captureId,
		status: "active",
		identity,
		startedAt,
	})
	try {
		await writeAtomic(filesystem, `${captureDir}/meta.json`, JSON.stringify(topMeta, null, 2))
	} catch (error) {
		transitionToFailed(`meta write: ${errorMessage(error)}`)
		return
	}

	session = factory()
	try {
		session.connect()
		await session.post("Profiler.enable")
		// ACT §10: explicitly set sampling interval. Do not assume default.
		await session.post("Profiler.setSamplingInterval", {
			interval: CPU_PROFILE_SAMPLING_INTERVAL_US,
		})
	} catch (error) {
		transitionToFailed(`inspector connect/enable: ${errorMessage(error)}`)
		return
	}

	// Per-rotation helper. Returns true if rotation succeeded and a new
	// segment is now active; false if the capture was finalized or
	// transitioned to "failed".
	const rotate = async (): Promise<boolean> => {
		// Set up the rotation-completion deferred (per ACT
		// INFLIGHT-STOP-CORRECTION04 P0 fix). Concurrent callers
		// (e.g. finalizeActiveCapture) that detected `stopInFlight`
		// await `rotationSettled` to observe this rotation's final
		// counter updates before writing capture meta.
		let rotationResolve!: () => void
		rotationSettled = new Promise<void>((resolve) => {
			rotationResolve = resolve
		})
		try {
			return await rotateBody()
		} finally {
			rotationResolve()
			rotationSettled = undefined
		}
	}

	// The actual rotation body. Splits the helper from the
	// rotation-completion tracking so a concurrent finalizer can
	// observe when the body has fully settled (per ACT
	// INFLIGHT-STOP-CORRECTION04 P0 fix).
	const rotateBody = async (): Promise<boolean> => {
		// Finalization lock (per ACT ROTATION-RACE-CORRECTION03 P0):
		// if the MAX_DURATION backstop timer (or another path) has
		// already begun finalization, abort this rotation. Issuing a
		// Profiler.start now would race with the finalizer's stop and
		// produce a phantom segment + a state mismatch.
		if (finalizing || finalized) {
			return false
		}
		if (_state !== "active" && _state !== "rotating") {
			return false
		}
		// In-flight stop lock (per ACT INFLIGHT-STOP-CORRECTION04 P0
		// fix): if a Profiler.stop is already outstanding on the
		// session (e.g. the previous rotation's stop has not yet
		// resolved), abort this rotation. Issuing another
		// Profiler.stop here would violate the "at most one stop
		// may be outstanding" invariant — the CDP serializes
		// commands, so the second stop would either queue behind
		// the first or race for the response.
		if (stopInFlight) {
			return false
		}
		_state = "rotating"

		// Capture the segment that is currently active BEFORE we call
		// Profiler.stop. This timestamp is the authoritative wall-clock
		// start of the segment we are about to capture (per ACT
		// SEGMENT-WALLCLOCK-CORRECTION02).
		const segmentStartedAt = activeSegmentStartedAt

		const rotationStart = performance.now()
		let profile: unknown
		const stopStart = performance.now()
		// Per ACT INFLIGHT-STOP-CORRECTION04 P0 fix: a stop is about
		// to be in flight. Mark the in-flight flag synchronously
		// BEFORE the await so a concurrent finalizer cannot interleave
		// a duplicate Profiler.stop while our await is pending.
		// Also capture the Promise so a concurrent caller can
		// observe the same result (per ACT INFLIGHT-STOP-CORRECTION04
		// P0 fix).
		stopInFlight = true
		inFlightStopPromise = session?.post("Profiler.stop")
		try {
			const stopResult = await inFlightStopPromise
			profile = unwrapProfilerStopResult(stopResult)
			consecutiveStopFailures = 0
			// Profiler has just stopped (per ACT
			// ROTATION-RACE-CORRECTION03 P0): sampling authority is
			// now false until the post-rotation Profiler.start below.
			profilerRunning = false
			// Stop resolved; no longer in flight (per ACT
			// INFLIGHT-STOP-CORRECTION04 P0 fix).
			stopInFlight = false
			inFlightStopPromise = undefined
		} catch (error) {
			consecutiveStopFailures += 1
			_perf.failedSegmentCount += 1
			_warn(`Profiler.stop failed (continuing): ${errorMessage(error)}`)
			// Stop attempt completed (with error); no longer in flight.
			stopInFlight = false
			inFlightStopPromise = undefined
			if (consecutiveStopFailures >= 2) {
				transitionToFailed(`Profiler.stop failed 2x consecutively: ${errorMessage(error)}`)
				return false
			}
			// Try to recover by starting a fresh segment.
			try {
				await session?.post("Profiler.start")
				// The recovery segment starts NOW. Re-baseline the
				// wall-clock timestamp and re-arm sampling authority.
				activeSegmentStartedAt = new Date()
				profilerRunning = true
				_state = "active"
			} catch (restartError) {
				transitionToFailed(`Profiler.start recovery failed: ${errorMessage(restartError)}`)
				return false
			}
			return true
		}
		const stopMs = performance.now() - stopStart

		if (_perf.segmentCount === 0) {
			_state = "active"
		}

		const segmentIndex = _perf.segmentCount
		// Single serialize (per ACT P1 PERTURBATION-CORRECTION02):
		// the diagnostic's purpose is to avoid perturbing a struggling
		// Extension Host, so we serialize once and measure bytes from
		// that exact string rather than re-stringifying just for sizing.
		// Measure the cost BEFORE stringifying as well so the
		// `serialize_ms` breakdown reflects the real cost (per ACT
		// ROTATION-RACE-CORRECTION03 P1 fix).
		const serializeStart = performance.now()
		const serialized = JSON.stringify(profile)
		const serializeMs = performance.now() - serializeStart
		const profileBytes = Buffer.byteLength(serialized, "utf8")
		const sampleCount = countSamplesInProfile(profile)

		const segmentPath = `${captureDir}/segment-${String(segmentIndex).padStart(3, "0")}.cpuprofile`
		const writeStart = performance.now()
		let writeOk = false
		try {
			await writeAtomic(filesystem, segmentPath, serialized)
			writeOk = true
		} catch (error) {
			_perf.failedSegmentCount += 1
			_warn(`segment write failed (continuing): ${errorMessage(error)}`)
		}
		const writeMs = performance.now() - writeStart

		// Use the wall-clock timestamp captured at segment start (per
		// ACT SEGMENT-WALLCLOCK-CORRECTION02). NOT derived from
		// performance.now(), which is monotonic and produces bogus
		// epoch dates when fed to new Date().
		const segmentMeta: CpuProfilerSegmentMeta = {
			segment_index: segmentIndex,
			started_at: segmentStartedAt.toISOString(),
			stopped_at: new Date().toISOString(),
			sampling_interval_us: CPU_PROFILE_SAMPLING_INTERVAL_US,
			sample_count: sampleCount,
			profile_bytes: profileBytes,
			stop_ms: round2(stopMs),
			serialize_ms: round2(serializeMs),
			write_ms: round2(writeMs),
			restart_ms: 0,
			rotation_wall_ms: 0,
		}

		if (writeOk) {
			_perf.successfulSegmentCount += 1
			// Advance the last-successful pointer ONLY when the atomic
			// write succeeded (per ACT ROTATE-FAIL-CORRECTION02).
			lastSuccessfulSegmentIndex = segmentIndex
			_perf.profileBytesMax = Math.max(_perf.profileBytesMax, profileBytes)
			_perf.sampleCountMax = Math.max(_perf.sampleCountMax, sampleCount)
		}
		_perf.segmentCount += 1
		_perf.stopMsTotal += stopMs
		_perf.serializeMsTotal += serializeMs
		_perf.writeMsTotal += writeMs

		// ACT §14 + ACT ROTATE-FAIL-CORRECTION02: latest-complete.json
		// reports the highest SUCCESSFULLY-PERSISTED segment. If the
		// most recent rotation's write failed, we still point at the
		// last complete checkpoint rather than regressing to -1.
		const latest = buildLatestComplete({
			captureId,
			captureDir,
			latestSegmentIndex: lastSuccessfulSegmentIndex,
			latestStatus: writeOk ? "complete" : "failed",
			successfulSegmentCount: _perf.successfulSegmentCount,
			failedSegmentCount: _perf.failedSegmentCount,
			totalSegmentCount: _perf.segmentCount,
			identity,
			startedAt,
		})
		try {
			await writeAtomic(filesystem, `${captureDir}/latest-complete.json`, JSON.stringify(latest, null, 2))
		} catch (error) {
			_warn(`latest-complete write failed: ${errorMessage(error)}`)
		}

		// Rotation done. Decide: start next segment OR finalize.
		const elapsedMs = Date.now() - startedAt.getTime()
		const shouldFinalize = elapsedMs >= CPU_PROFILE_MAX_DURATION_MS
		if (shouldFinalize) {
			await finalizeActiveCapture()
			return false
		}

		const restartStart = performance.now()
		// Per ACT INFLIGHT-STOP-CORRECTION04 P0 fix: if cleanup()
		// ran while our Profiler.stop was in flight (because the
		// finalizer fired concurrently and chose to disconnect
		// first), the session is gone. We must NOT attempt a
		// Profiler.start on the disconnected session.
		if (disconnected) {
			_warn(`rotate(): session disconnected while Profiler.stop was in flight; skipping post-rotation Profiler.start`)
			return false
		}
		try {
			await session?.post("Profiler.start")
			// The new segment starts NOW. Re-baseline the wall-clock
			// timestamp so segment-N+1's started_at is correct (per ACT
			// SEGMENT-WALLCLOCK-CORRECTION02), and re-arm sampling
			// authority (per ACT ROTATION-RACE-CORRECTION03 P0).
			activeSegmentStartedAt = new Date()
			profilerRunning = true
		} catch (error) {
			transitionToFailed(`Profiler.start (next segment): ${errorMessage(error)}`)
			return false
		}
		const restartMs = performance.now() - restartStart
		_perf.restartMsTotal += restartMs

		const rotationWallMs = performance.now() - rotationStart
		_perf.rotationWallMsTotal += rotationWallMs
		if (rotationWallMs > _perf.maxRotationWallMs) {
			_perf.maxRotationWallMs = rotationWallMs
		}
		if (rotationWallMs > CPU_PROFILE_PERTURBATION_WARN_MS) {
			_perf.slowRotationCount += 1
			_warn(`slow rotation: ${rotationWallMs.toFixed(1)}ms (> ${CPU_PROFILE_PERTURBATION_WARN_MS}ms)`)
		}

		// Backfill the rotation_wall_ms + restart_ms on the segment meta.
		segmentMeta.restart_ms = round2(restartMs)
		segmentMeta.rotation_wall_ms = round2(rotationWallMs)
		try {
			await writeAtomic(
				filesystem,
				`${captureDir}/segment-${String(segmentIndex).padStart(3, "0")}.meta.json`,
				JSON.stringify(segmentMeta, null, 2),
			)
		} catch (error) {
			_warn(`segment meta write failed: ${errorMessage(error)}`)
		}

		_state = "active"
		return true
	}

	/**
	 * Single finalization authority for the capture. ALWAYS owns the
	 * final Profiler.stop (per ACT FINALIZATION-CORRECTION02):
	 *
	 *   1. Idempotency guard
	 *   2. Capture the active segment by calling Profiler.stop ourselves,
	 *      persisting the returned profile as the FINAL segment index.
	 *   3. Then clear timers + disconnect the Inspector session.
	 *   4. Then write meta.status="finalized".
	 *
	 * The MAX_DURATION backstop timer, the segment-timer MAX_DURATION
	 * branch, and the test seam MUST all call this function. There is
	 * only one path to state="finalized".
	 *
	 * If the capture is NOT currently in state="active" (e.g. it has
	 * already failed or finalized), this is a no-op except for the
	 * idempotency guard.
	 */
	const finalizeActiveCapture = async (): Promise<void> => {
		if (finalizing || finalized) return
		finalizing = true
		// The finalizer is the SINGLE authority for Profiler.stop on
		// the final segment (per ACT FINALIZATION-CORRECTION02 P0 +
		// ROTATION-RACE-CORRECTION03 P0). Two race conditions are
		// guarded here:
		//
		//   (a) The rotation-driven horizon path: rotate() has
		//       already stopped profiling (profilerRunning === false)
		//       before calling finalizeActiveCapture(). We MUST NOT
		//       issue another Profiler.stop in that case.
		//
		//   (b) The independent MAX_DURATION backstop timer can fire
		//       while an in-flight rotation is between its stop and
		//       restart. The `finalizing` lock prevents a duplicate
		//       finalizer, and the `profilerRunning` flag tells us
		//       whether the CDP actually has a profiler started.
		const rotationStart = performance.now()
		const stopStart = performance.now()
		// Capture the segment's start timestamp BEFORE we stop, so
		// the final segment's started_at describes its REAL start,
		// not its end (per ACT ROTATION-RACE-CORRECTION03 P1 fix).
		const segmentStartedAt = activeSegmentStartedAt
		let profile: unknown
		let stopAttempted = false
		// In-flight stop gate (per ACT INFLIGHT-STOP-CORRECTION04 P0
		// fix): if a Profiler.stop is already outstanding (e.g.
		// rotate() is mid-stop), we MUST NOT post a second one. The
		// "at most one Profiler.stop may be outstanding" invariant
		// is enforced here. We still proceed with finalization
		// (timers, disconnect, meta write) — but we defer to the
		// in-flight caller for the segment persistence.
		const concurrentStopInFlight = stopInFlight
		if (profilerRunning && !concurrentStopInFlight) {
			_state = "rotating"
			// Mark in-flight synchronously BEFORE the await (per
			// ACT INFLIGHT-STOP-CORRECTION04 P0 fix).
			stopInFlight = true
			inFlightStopPromise = session?.post("Profiler.stop")
			try {
				const stopResult = await inFlightStopPromise
				profile = unwrapProfilerStopResult(stopResult)
				consecutiveStopFailures = 0
				// Sampling authority consumed (per ACT
				// ROTATION-RACE-CORRECTION03 P0). Whether or not the
				// next code path persists the profile, profiler
				// sampling is no longer active.
				profilerRunning = false
				stopInFlight = false
				inFlightStopPromise = undefined
				stopAttempted = true
			} catch (error) {
				consecutiveStopFailures += 1
				_perf.failedSegmentCount += 1
				_warn(`final Profiler.stop failed: ${errorMessage(error)}`)
				profile = undefined
				stopAttempted = true
				// Even on failure the sampling state is no longer
				// authoritative — V8 may have already stopped but
				// returned an error. We do NOT attempt to recover
				// here; finalization is a one-shot operation.
				profilerRunning = false
				stopInFlight = false
				inFlightStopPromise = undefined
			}
		} else if (concurrentStopInFlight && inFlightStopPromise) {
			// A concurrent stop is already outstanding. We defer to
			// that caller for the segment persistence (per ACT
			// INFLIGHT-STOP-CORRECTION04 P0 fix). Await the
			// in-flight Promise to observe its result without
			// issuing a duplicate Profiler.stop — but DO NOT
			// persist the profile ourselves. The rotation's
			// persist path owns the segment.
			//
			// We also wait for the rotation's body to FULLY settle
			// via `rotationSettled` so the finalizer's meta write
			// observes the rotation's counter updates (per ACT
			// INFLIGHT-STOP-CORRECTION04 P0 fix).
			_warn(`finalizer entered while Profiler.stop was in flight; deferring to concurrent stop path`)
			try {
				await inFlightStopPromise
			} catch {
				// In-flight stop failed; the rotation's failure
				// path handles its own state. We just proceed to
				// finalize bookkeeping.
			}
			if (rotationSettled) {
				await rotationSettled
			}
			profilerRunning = false
			stopAttempted = true
		}
		const stopMs = stopAttempted ? performance.now() - stopStart : 0

		if (profile !== undefined) {
			const finalSegmentIndex = _perf.segmentCount
			// Measure the serialization cost (per ACT
			// ROTATION-RACE-CORRECTION03 P1 fix): start the clock
			// BEFORE JSON.stringify so the breakdown reflects the
			// real cost rather than ~0.
			const serializeStart = performance.now()
			const serialized = JSON.stringify(profile)
			const serializeMs = performance.now() - serializeStart
			const profileBytes = Buffer.byteLength(serialized, "utf8")
			const sampleCount = countSamplesInProfile(profile)

			const segmentPath = `${captureDir}/segment-${String(finalSegmentIndex).padStart(3, "0")}.cpuprofile`
			const writeStart = performance.now()
			let writeOk = false
			try {
				await writeAtomic(filesystem, segmentPath, serialized)
				writeOk = true
			} catch (error) {
				_perf.failedSegmentCount += 1
				_warn(`final segment write failed: ${errorMessage(error)}`)
			}
			const writeMs = performance.now() - writeStart

			const segmentMeta: CpuProfilerSegmentMeta = {
				segment_index: finalSegmentIndex,
				started_at: segmentStartedAt.toISOString(),
				stopped_at: new Date().toISOString(),
				sampling_interval_us: CPU_PROFILE_SAMPLING_INTERVAL_US,
				sample_count: sampleCount,
				profile_bytes: profileBytes,
				stop_ms: round2(stopMs),
				serialize_ms: round2(serializeMs),
				write_ms: round2(writeMs),
				restart_ms: 0,
				rotation_wall_ms: 0,
			}

			if (writeOk) {
				_perf.successfulSegmentCount += 1
				lastSuccessfulSegmentIndex = finalSegmentIndex
				_perf.profileBytesMax = Math.max(_perf.profileBytesMax, profileBytes)
				_perf.sampleCountMax = Math.max(_perf.sampleCountMax, sampleCount)
			}
			_perf.segmentCount += 1
			_perf.stopMsTotal += stopMs
			_perf.serializeMsTotal += serializeMs
			_perf.writeMsTotal += writeMs

			const rotationWallMs = performance.now() - rotationStart
			_perf.rotationWallMsTotal += rotationWallMs
			if (rotationWallMs > _perf.maxRotationWallMs) {
				_perf.maxRotationWallMs = rotationWallMs
			}

			const latest = buildLatestComplete({
				captureId,
				captureDir,
				latestSegmentIndex: lastSuccessfulSegmentIndex,
				latestStatus: writeOk ? "complete" : "failed",
				successfulSegmentCount: _perf.successfulSegmentCount,
				failedSegmentCount: _perf.failedSegmentCount,
				totalSegmentCount: _perf.segmentCount,
				identity,
				startedAt,
			})
			try {
				await writeAtomic(filesystem, `${captureDir}/latest-complete.json`, JSON.stringify(latest, null, 2))
			} catch (error) {
				_warn(`latest-complete write failed: ${errorMessage(error)}`)
			}

			try {
				await writeAtomic(
					filesystem,
					`${captureDir}/segment-${String(finalSegmentIndex).padStart(3, "0")}.meta.json`,
					JSON.stringify(segmentMeta, null, 2),
				)
			} catch (error) {
				_warn(`segment meta write failed: ${errorMessage(error)}`)
			}
		}

		// Now disconnect and write the final meta.json. The Inspector
		// session is only closed AFTER the final Profiler.stop has
		// resolved (or AFTER we determined no stop was needed).
		cleanup()
		const finalMeta = buildTopMeta({
			captureId,
			status: "finalized",
			identity,
			startedAt,
			capturedAt: new Date(),
			perf: _perf,
		})
		try {
			await writeAtomic(filesystem, `${captureDir}/meta.json`, JSON.stringify(finalMeta, null, 2))
		} catch (error) {
			_warn(`final meta write failed: ${errorMessage(error)}`)
		}
		_state = "finalized"
		finalized = true
		finalizing = false
	}

	// Install test seams BEFORE starting the first segment. The test
	// seam must mirror the production path exactly: it calls the SAME
	// finalizer that the MAX_DURATION backstop calls. NO pre-call to
	// rotate() — the finalizer owns the final Profiler.stop.
	_segmentRotator = rotate
	_finalizeDriver = async () => {
		await finalizeActiveCapture()
	}

	// Start the first segment.
	try {
		await session.post("Profiler.start")
		// The first segment starts NOW. Capture the wall-clock
		// timestamp so segment-000's started_at is correct (per ACT
		// SEGMENT-WALLCLOCK-CORRECTION02), and arm sampling
		// authority so the finalizer's stop gate knows profiling is
		// live (per ACT ROTATION-RACE-CORRECTION03 P0).
		activeSegmentStartedAt = new Date()
		profilerRunning = true
	} catch (error) {
		transitionToFailed(`Profiler.start (initial): ${errorMessage(error)}`)
		return
	}
	_state = "active"

	// Schedule the first segment rotation.
	segmentTimer = setTimeout(() => {
		void rotate().then((more) => {
			if (!more) return
			const tick = (): void => {
				if (_state !== "active") return
				const elapsed = Date.now() - startedAt.getTime()
				if (elapsed >= CPU_PROFILE_MAX_DURATION_MS) {
					void finalizeActiveCapture()
					return
				}
				segmentTimer = setTimeout(async () => {
					const more2 = await rotate()
					if (more2) tick()
				}, CPU_PROFILE_SEGMENT_MS)
				if (typeof (segmentTimer as { unref?: () => void }).unref === "function") {
					;(segmentTimer as { unref: () => void }).unref()
				}
			}
			tick()
		})
	}, CPU_PROFILE_SEGMENT_MS)
	if (typeof (segmentTimer as { unref?: () => void }).unref === "function") {
		;(segmentTimer as { unref: () => void }).unref()
	}

	// Backstop timer (per ACT MAX-DURATION-FINALIZATION-CORRECTION02).
	// This is NOT a starvation-resistant timer: it is a JS EventLoop
	// timer, so if the Extension Host event loop is starved (the very
	// bug we are trying to diagnose) this timer will NOT fire. It is
	// only an independent MAX_DURATION backstop against ordinary timer
	// scheduling drift when the loop IS responsive.
	finalTimer = setTimeout(() => {
		void finalizeActiveCapture()
	}, CPU_PROFILE_MAX_DURATION_MS)
	if (typeof (finalTimer as { unref?: () => void }).unref === "function") {
		;(finalTimer as { unref: () => void }).unref()
	}
}

// =============================================================================
// Atomic write helper
// =============================================================================

async function writeAtomic(filesystem: CpuProfilerFilesystem, target: string, data: string): Promise<void> {
	const tmp = `${target}.tmp`
	await filesystem.writeFile(tmp, data)
	await filesystem.rename(tmp, target)
}

// =============================================================================
// Meta builders
// =============================================================================

interface CpuProfilerSegmentMeta {
	segment_index: number
	started_at: string
	stopped_at: string
	sampling_interval_us: number
	sample_count: number
	profile_bytes: number
	stop_ms: number
	serialize_ms: number
	write_ms: number
	restart_ms: number
	rotation_wall_ms: number
}

interface CpuProfilerTopMeta {
	schema_version: 1
	capture_id: string
	capture_kind: "extension_host_cpu_sampling_rolling"
	status: "active" | "finalized" | "failed"
	installed_bundle_sha256: string
	version: string
	extension_path: string
	source_head_informational: string
	started_at: string
	captured_at?: string
	trigger: "notify_enabled_background_command"
	sampling_interval_us: number
	segment_ms: number
	max_duration_ms: number
	performance: CpuProfilePerformanceCounters
}

function buildTopMeta(args: {
	captureId: string
	status: "active" | "finalized" | "failed"
	identity: CpuProfilerIdentityBinding
	startedAt: Date
	capturedAt?: Date
	perf?: CpuProfilePerformanceCounters
}): CpuProfilerTopMeta {
	return {
		schema_version: 1,
		capture_id: args.captureId,
		capture_kind: "extension_host_cpu_sampling_rolling",
		status: args.status,
		installed_bundle_sha256: args.identity.extensionBundleSha256,
		version: args.identity.version,
		extension_path: args.identity.extensionPath,
		source_head_informational: args.identity.sourceHead,
		started_at: args.startedAt.toISOString(),
		...(args.capturedAt ? { captured_at: args.capturedAt.toISOString() } : {}),
		trigger: "notify_enabled_background_command",
		sampling_interval_us: CPU_PROFILE_SAMPLING_INTERVAL_US,
		segment_ms: CPU_PROFILE_SEGMENT_MS,
		max_duration_ms: CPU_PROFILE_MAX_DURATION_MS,
		performance: args.perf ?? freshPerfCounters(),
	}
}

interface CpuProfilerLatestComplete {
	schema_version: 1
	capture_id: string
	capture_dir: string
	latest_segment_index: number
	latest_status: "complete" | "failed" | "none"
	successful_segment_count: number
	/**
	 * Independent of `total_segment_count`. Records every rotation
	 * whose atomic persist failed (per ACT ROTATE-FAIL-CORRECTION02).
	 * The `latest_segment_index` continues to point at the highest
	 * SUCCESSFULLY-PERSISTED segment so crash-survivability does not
	 * regress to -1 on a single bad write.
	 */
	failed_segment_count: number
	total_segment_count: number
	installed_bundle_sha256: string
	version: string
	extension_path: string
	source_head_informational: string
	started_at: string
}

function buildLatestComplete(args: {
	captureId: string
	captureDir: string
	latestSegmentIndex: number
	latestStatus: "complete" | "failed"
	successfulSegmentCount: number
	failedSegmentCount: number
	totalSegmentCount: number
	identity: CpuProfilerIdentityBinding
	startedAt: Date
}): CpuProfilerLatestComplete {
	return {
		schema_version: 1,
		capture_id: args.captureId,
		capture_dir: args.captureDir,
		latest_segment_index: args.latestSegmentIndex,
		latest_status: args.latestStatus,
		successful_segment_count: args.successfulSegmentCount,
		failed_segment_count: args.failedSegmentCount,
		total_segment_count: args.totalSegmentCount,
		installed_bundle_sha256: args.identity.extensionBundleSha256,
		version: args.identity.version,
		extension_path: args.identity.extensionPath,
		source_head_informational: args.identity.sourceHead,
		started_at: args.startedAt.toISOString(),
	}
}

// =============================================================================
// Helpers
// =============================================================================

function countSamplesInProfile(profile: unknown): number {
	if (typeof profile !== "object" || profile === null) return 0
	const p = profile as Record<string, unknown>
	if (Array.isArray(p.samples)) return p.samples.length
	if (typeof p.samples === "number") return p.samples
	return 0
}

/**
 * Unwrap a profiler response. Some CDP versions wrap the CPU profile
 * payload in `{ profile: { ... } }` (mirrors the HeapProfiler pattern).
 */
function unwrapProfilerStopResult(result: unknown): unknown {
	if (typeof result !== "object" || result === null) return result
	if ("profile" in result) {
		const inner = (result as { profile: unknown }).profile
		if (inner !== undefined && inner !== null) return inner
	}
	return result
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}
