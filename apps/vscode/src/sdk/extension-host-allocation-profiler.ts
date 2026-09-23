/**
 * ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01
 *
 * TEMPORARY bounded V8 allocation sampler for the ClineMM Extension Host
 * process. Acquires the CORRECT evidence type for identifying the
 * real production allocation stack(s) responsible for the GC-heavy
 * extension-host failure captured by exthost-66cdb2.cpuprofile (where
 * GC_RAW_CPU_SAMPLE_SHARE ≈ 44% was unexplained at the CPU-symbolization
 * layer).
 *
 * The CPU profile told us WHERE V8 spends time but a sampling CPU
 * profile cannot tell us allocation ownership or allocation rate.
 * The Chrome DevTools HeapProfiler domain provides the right primitive:
 * HeapProfiler.startSampling returns a SamplingHeapProfile whose
 * samples carry per-stack allocation size and sample count.
 *
 * Two options are LOAD-BEARING for our hypothesis:
 *
 *   includeObjectsCollectedByMinorGC: true
 *   includeObjectsCollectedByMajorGC: true
 *
 * Without them the profile only reports objects still alive when the
 * profile is retrieved, which is insufficient for the suspected
 * short-lived allocation churn.
 *
 * DESIGN CONSTRAINTS (frozen in this ACT):
 *   - DEFAULT_OFF: profiler is disabled unless the explicit env knob
 *     CLINEMM_DIAG_ALLOCATION_PROFILE=<truthy> is set.
 *   - DOGFOOD_ONLY: the env knob is honored ONLY in dogfood. Public
 *     installs cannot enable the profiler regardless of env.
 *   - BOUNDED: capture duration is hard-capped at MAX_DURATION_MS
 *     (60000); checkpoints occur every CHECKPOINT_INTERVAL_MS (2000).
 *   - ONE-SHOT: a single capture per Extension Host process.
 *   - NO PROTOCOL FIELD: profiler internals never serialize into proto.
 *   - NO WEBVIEW FIELD: profiler internals never appear in webview state.
 *   - NO STATE-SEMANTIC DELTA: profiler never changes command /
 *     continuation / completion / CCARD / BTCONT / TQCB / projection
 *     behavior. Profiler failure logs a bounded warning and never
 *     throws into the host call path.
 *
 * REMOVAL_TRIGGER (per ACT §41): once allocation authority is
 * classified A / B / C, OR capture is declared CAPTURE_INSUFFICIENT,
 * OR profiler perturbation makes evidence unusable, this module +
 * the trigger call site + the activation helper + the env knob +
 * the focused tests + the analyzer script MUST be removed TOGETHER.
 */

// =============================================================================
// Imports
// =============================================================================

import { Logger } from "@/shared/services/Logger"

// =============================================================================
// Constants
// =============================================================================

/** Env var name. Honored ONLY in dogfood (fail-closed in public). */
export const CLINEMM_DIAG_ALLOCATION_PROFILE_ENV = "CLINEMM_DIAG_ALLOCATION_PROFILE"

/** HeapProfiler sampling interval (V8 default 32 KiB; do not invent tuning). */
export const ALLOCATION_PROFILE_SAMPLING_INTERVAL_BYTES = 32768

/** HeapProfiler stack depth (V8 default 128; do not invent tuning). */
export const ALLOCATION_PROFILE_STACK_DEPTH = 128

/** Capture duration cap. The timer is the authority (not task completion). */
export const ALLOCATION_PROFILE_MAX_DURATION_MS = 60_000

/** Checkpoint cadence. 2s is the bounded compromise per ACT §10. */
export const ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS = 2_000

/**
 * If a single getSamplingProfile() call exceeds this, the profiler
 * records host_unresponsive_halt and skips the next checkpoint tick.
 * ACT §39 perturbation gate.
 */
export const ALLOCATION_PROFILE_PERTURBATION_HALT_MS = 500

/** Subdirectory under the Cline data root where artifacts land. */
export const ALLOCATION_PROFILE_ARTIFACT_SUBDIR = "diagnostics/allocation-authority"

// =============================================================================
// State machine
// =============================================================================

/**
 * AllocationProfilerState. Frozen union; adding a state is a durable
 * API change requiring a new ACT.
 */
export type AllocationProfilerState = "disabled" | "armed" | "starting" | "active" | "stopping" | "finalized" | "failed"

/**
 * Discriminated trigger result. The trigger function NEVER throws and
 * NEVER awaits. The host call path treats every kind as a no-op for
 * command semantics.
 */
export type AllocationProfilerTriggerResult =
	| { readonly kind: "skipped"; readonly reason: string; readonly previousState: AllocationProfilerState }
	| { readonly kind: "started"; readonly captureId: string; readonly previousState: AllocationProfilerState }
	| { readonly kind: "failed"; readonly reason: string; readonly previousState: AllocationProfilerState }

let _state: AllocationProfilerState = "disabled"

/** Capture identity for the current process. */
let _captureId: string | undefined

/** Capture identity factory. Default = ULID-shaped; tests inject fakes. */
let _captureIdFactory: () => string = defaultCaptureIdFactory

/** Performance-metrics counters used by ACT §39 perturbation gate. */
export interface AllocationProfilePerformanceCounters {
	getSamplingProfileMs: number
	jsonSerializeMs: number
	writeMs: number
	profileBytes: number
	sampleCount: number
	checkpointCount: number
	longCheckpointCount: number
	/** Transient getSamplingProfile / write failures that did NOT terminate the loop (per ACT §31 recovery contract). */
	transientCheckpointFailures: number
	/** Per-checkpoint wall time for the last completed tick. */
	lastCheckpointWallMs?: number
}

let _perf: AllocationProfilePerformanceCounters = freshPerfCounters()

function freshPerfCounters(): AllocationProfilePerformanceCounters {
	return {
		getSamplingProfileMs: 0,
		jsonSerializeMs: 0,
		writeMs: 0,
		profileBytes: 0,
		sampleCount: 0,
		checkpointCount: 0,
		longCheckpointCount: 0,
		transientCheckpointFailures: 0,
	}
}

/**
 * Default capture-id factory. ULID-shaped: timestamp + 16 random
 * hex chars.
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
export interface AllocationProfilerInspectorSession {
	connect(): void
	disconnect(): void
	post(method: string, params?: Record<string, unknown>): Promise<unknown>
	on(event: "HeapProfiler.addHeapSnapshotChunk", listener: (chunk: unknown) => void): void
}

export type AllocationProfilerInspectorSessionFactory = () => AllocationProfilerInspectorSession

let _inspectorSessionFactory: AllocationProfilerInspectorSessionFactory | undefined

/** Filesystem seam. Production = node:fs/promises. Tests inject fakes. */
export interface AllocationProfilerFilesystem {
	mkdir(path: string, options: { recursive: boolean }): Promise<void>
	rename(from: string, to: string): Promise<void>
	writeFile(path: string, data: string): Promise<void>
}

let _filesystem: AllocationProfilerFilesystem | undefined

/** CLine data root resolver. Production = the CLINE_DIR resolver. */
export type AllocationProfilerDataRootResolver = () => string

let _dataRootResolver: AllocationProfilerDataRootResolver | undefined

/** Identity-binding shape used in meta.json. */
export interface AllocationProfilerIdentityBinding {
	sourceHead: string
	version: string
	extensionPath: string
	extensionBundleSha256: string
}

export type AllocationProfilerIdentityResolver = () => AllocationProfilerIdentityBinding

let _identityResolver: AllocationProfilerIdentityResolver | undefined

/** Logger seam. Production = Logger.warn. Tests inject recorder. */
export type AllocationProfilerWarn = (message: string) => void

let _warn: AllocationProfilerWarn = (message) => {
	Logger.warn(`[allocation-profiler] ${message}`)
}

// =============================================================================
// Env resolver (pure)
// =============================================================================

/**
 * Resolve the effective allocation-profile knob.
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
export function resolveAllocationProfileKnobFromEnv(isDogfood: boolean, env: NodeJS.ProcessEnv): boolean {
	if (!isDogfood) {
		return false
	}
	const raw = env[CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]
	if (typeof raw !== "string" || raw.length === 0) {
		return false
	}
	const normalized = raw.trim().toLowerCase()
	return normalized === "1" || normalized === "true" || normalized === "yes"
}

/**
 * THE single production resolver for the allocation-profile knob.
 * Returns the new state so callers can detect flips.
 *
 * Called from `applyExtensionHostAllocationProfilerProfile` in
 * `dogfood-diagnostic-profile.ts`. There is no other production call
 * site.
 */
export function applyExtensionHostAllocationProfilerPolicy(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	const should = resolveAllocationProfileKnobFromEnv(isDogfood, env)
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

export function getAllocationProfilerState(): AllocationProfilerState {
	return _state
}

export function getAllocationProfilerCaptureId(): string | undefined {
	return _captureId
}

export function getAllocationProfilerPerformanceCounters(): Readonly<AllocationProfilePerformanceCounters> {
	return _perf
}

/** Read-only snapshot for tests and dump adapters. */
export interface AllocationProfilerSnapshot {
	state: AllocationProfilerState
	captureId: string | undefined
	perf: Readonly<AllocationProfilePerformanceCounters>
}

export function getAllocationProfilerSnapshot(): AllocationProfilerSnapshot {
	return { state: _state, captureId: _captureId, perf: _perf }
}

// =============================================================================
// Internal mutators (test seams; do NOT use in production)
// =============================================================================

export function setAllocationProfilerCaptureIdFactory(factory: () => string): void {
	_captureIdFactory = factory
}

export function setAllocationProfilerInspectorSessionFactory(
	factory: AllocationProfilerInspectorSessionFactory | undefined,
): void {
	_inspectorSessionFactory = factory
}

export function setAllocationProfilerFilesystem(fs: AllocationProfilerFilesystem | undefined): void {
	_filesystem = fs
}

export function setAllocationProfilerDataRootResolver(resolver: AllocationProfilerDataRootResolver | undefined): void {
	_dataRootResolver = resolver
}

export function setAllocationProfilerIdentityResolver(resolver: AllocationProfilerIdentityResolver | undefined): void {
	_identityResolver = resolver
}

export function setAllocationProfilerWarn(fn: AllocationProfilerWarn): void {
	_warn = fn
}

/** Reset the profiler to disabled state and clear counters. Test seam ONLY. */
export function __resetAllocationProfilerForTests(): void {
	_state = "disabled"
	_captureId = undefined
	_captureIdFactory = defaultCaptureIdFactory
	_inspectorSessionFactory = undefined
	_filesystem = undefined
	_dataRootResolver = undefined
	_identityResolver = undefined
	_finalizeDriver = undefined
	_warn = (message) => {
		Logger.warn(`[allocation-profiler] ${message}`)
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
export function triggerExtensionHostAllocationProfilerOnFirstQualifyingJob(): AllocationProfilerTriggerResult {
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
	// immediately; the loop runs in the background.
	void runAllocationCaptureLoop(captureId).catch((error) => {
		// Backstop for programming bugs in the loop itself.
		_warn(`capture loop crashed (unhandled): ${errorMessage(error)}`)
		if (_state !== "finalized") {
			_state = "failed"
		}
	})

	return {
		kind: "started",
		captureId,
		previousState,
	}
}

// =============================================================================
// Async capture loop
// =============================================================================

/**
 * Sequence (frozen):
 *   1. Connect inspector session.
 *   2. HeapProfiler.enable.
 *   3. HeapProfiler.startSampling with EXACT load-bearing options.
 *   4. Flip state -> "active".
 *   5. Schedule CHECKPOINT_INTERVAL_MS periodic checkpoints.
 *   6. Schedule MAX_DURATION_MS final timer.
 *   7. On checkpoint tick: getSamplingProfile -> atomic latest replacement.
 *   8. On final tick: stopSampling -> final artifact -> "finalized".
 *   9. Any failure -> flip state -> "failed"; log bounded warning.
 */
/** Test seam — exposed for ALLOCAUTH-FINAL-* deterministic tests. */
let _finalizeDriver: (() => Promise<void>) | undefined

/**
 * Test-only seam that synchronously drives the same finalizer the
 * MAX_DURATION_MS timer drives. Returns a promise that resolves when
 * the finalizer has completed (either with state="finalized" or
 * state="failed"). Required so tests do not have to wait wall-clock
 * 60 seconds.
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

async function runAllocationCaptureLoop(captureId: string): Promise<void> {
	const startedAt = new Date()
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

	let session: AllocationProfilerInspectorSession | undefined
	let checkpointTimer: ReturnType<typeof setInterval> | undefined
	let finalTimer: ReturnType<typeof setTimeout> | undefined
	let skippedNextCheckpoint = false

	const cleanup = (): void => {
		if (checkpointTimer !== undefined) {
			clearInterval(checkpointTimer)
			checkpointTimer = undefined
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
		_finalizeDriver = undefined
	}
	const transitionToFailed = (reason: string): void => {
		_state = "failed"
		_warn(`capture failed: ${reason}`)
		cleanup()
	}

	try {
		const dataRoot = dataRootResolver()
		const artifactDir = `${dataRoot}/${ALLOCATION_PROFILE_ARTIFACT_SUBDIR}`
		await filesystem.mkdir(artifactDir, { recursive: true })
		const identity = identityResolver()
		const latestProfilePath = `${artifactDir}/latest.heapprofile.json`
		const latestMetaPath = `${artifactDir}/latest.meta.json`

		const writeCheckpoint = async (
			profile: unknown,
			perfSnapshot: {
				readonly getSamplingProfileMs: number
				readonly jsonSerializeMs: number
				readonly writeMs: number
				readonly profileBytes: number
				readonly sampleCount: number
			},
		): Promise<void> => {
			const capturedAt = new Date()
			const serializeStart = performance.now()
			const serialized = JSON.stringify(profile)
			const jsonMs = performance.now() - serializeStart
			const writeStart = performance.now()
			await filesystem.writeFile(`${latestProfilePath}.tmp`, serialized)
			await filesystem.rename(`${latestProfilePath}.tmp`, latestProfilePath)
			const writeMs = performance.now() - writeStart
			const meta = buildCheckpointMeta({
				captureId,
				status: "checkpoint",
				startedAt,
				capturedAt,
				checkpointIndex: _perf.checkpointCount,
				identity,
				perf: perfSnapshot,
				jsonMs,
				writeMs,
				transientCheckpointFailures: _perf.transientCheckpointFailures,
				lastCheckpointWallMs: _perf.lastCheckpointWallMs,
			})
			const metaStr = JSON.stringify(meta, null, 2)
			await filesystem.writeFile(`${latestMetaPath}.tmp`, metaStr)
			await filesystem.rename(`${latestMetaPath}.tmp`, latestMetaPath)
		}

		const writeFinal = async (profile: unknown): Promise<void> => {
			const finalProfilePath = `${artifactDir}/final-${captureId}.heapprofile.json`
			const finalMetaPath = `${artifactDir}/final-${captureId}.meta.json`
			const serialized = JSON.stringify(profile)
			await filesystem.writeFile(finalProfilePath, serialized)
			const finalMeta = buildCheckpointMeta({
				captureId,
				status: "final",
				startedAt,
				capturedAt: new Date(),
				checkpointIndex: _perf.checkpointCount,
				identity,
				perf: {
					getSamplingProfileMs: _perf.getSamplingProfileMs,
					jsonSerializeMs: _perf.jsonSerializeMs,
					writeMs: _perf.writeMs,
					profileBytes: _perf.profileBytes,
					sampleCount: _perf.sampleCount,
				},
				jsonMs: 0,
				writeMs: 0,
				transientCheckpointFailures: _perf.transientCheckpointFailures,
				lastCheckpointWallMs: _perf.lastCheckpointWallMs,
			})
			await filesystem.writeFile(finalMetaPath, JSON.stringify(finalMeta, null, 2))
		}

		session = factory()
		try {
			session.connect()
			await session.post("HeapProfiler.enable")
		} catch (error) {
			transitionToFailed(`inspector connect/enable: ${errorMessage(error)}`)
			return
		}
		try {
			await session.post("HeapProfiler.startSampling", {
				samplingInterval: ALLOCATION_PROFILE_SAMPLING_INTERVAL_BYTES,
				stackDepth: ALLOCATION_PROFILE_STACK_DEPTH,
				includeObjectsCollectedByMinorGC: true,
				includeObjectsCollectedByMajorGC: true,
			})
		} catch (error) {
			transitionToFailed(`startSampling: ${errorMessage(error)}`)
			return
		}
		_state = "active"

		const doCheckpoint = async (): Promise<void> => {
			if (_state !== "active") return
			if (skippedNextCheckpoint) {
				skippedNextCheckpoint = false
				return
			}
			const startTime = performance.now()
			let profile: unknown
			try {
				profile = unwrapProfile(await session!.post("HeapProfiler.getSamplingProfile"))
			} catch (error) {
				// P1a fix: transient checkpoint failure must not transition
				// the state machine to "failed". A bounded recover catches
				// a single hiccup and lets the next tick try again.
				// Per ACT §31: "failed checkpoint -> does not terminate
				// profiler; next checkpoint may succeed."
				_perf.transientCheckpointFailures = (_perf.transientCheckpointFailures ?? 0) + 1
				_warn(`getSamplingProfile failed (continuing, retain ACTIVE): ${errorMessage(error)}`)
				return
			}
			const getMs = performance.now() - startTime
			_perf.getSamplingProfileMs += getMs
			const sampleCount = countSamples(profile)
			const profileBytes = Buffer.byteLength(JSON.stringify(profile), "utf8")
			const perfSnapshot = {
				getSamplingProfileMs: getMs,
				jsonSerializeMs: 0,
				writeMs: 0,
				profileBytes,
				sampleCount,
			}
			_perf.profileBytes = Math.max(_perf.profileBytes, profileBytes)
			_perf.sampleCount = sampleCount
			_perf.checkpointCount += 1
			const writeStart = performance.now()
			try {
				await writeCheckpoint(profile, perfSnapshot)
			} catch (error) {
				// Per ACT §31 write failures are also recoverable.
				_perf.transientCheckpointFailures = (_perf.transientCheckpointFailures ?? 0) + 1
				_warn(`checkpoint write failed (continuing, retain ACTIVE): ${errorMessage(error)}`)
				return
			}
			const writeMs = performance.now() - writeStart
			_perf.writeMs += writeMs
			// P1b fix: gate on whole-checkpoint wall time
			// (inspector + json + write + rename), not the Inspector call
			// alone. The check now catches serialization/write stalls that
			// would have previously evaded the gate.
			const wallMs = performance.now() - startTime
			_perf.lastCheckpointWallMs = wallMs
			if (wallMs > ALLOCATION_PROFILE_PERTURBATION_HALT_MS) {
				_perf.longCheckpointCount += 1
				skippedNextCheckpoint = true
				_warn(`checkpoint wall ${wallMs.toFixed(1)}ms (inspector ${getMs.toFixed(1)}ms); skipping next tick`)
			}
		}

		checkpointTimer = setInterval(() => {
			void doCheckpoint()
		}, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS)
		if (typeof (checkpointTimer as { unref?: () => void }).unref === "function") {
			;(checkpointTimer as { unref: () => void }).unref()
		}

		const finalize = async (): Promise<void> => {
			if (_state !== "active") return
			_state = "stopping"
			try {
				// P0 fix (per HALT_ALLOCATION_FINALIZATION_BROKEN review):
				// CDP contract: HeapProfiler.stopSampling returns the completed
				// SamplingHeapProfile as `{ profile }`. Do NOT call
				// getSamplingProfile after stopSampling — sampling has stopped
				// and that call will fail in the success path. Persist the
				// profile returned by stopSampling directly.
				const stopResult = await session!.post("HeapProfiler.stopSampling")
				const profile = unwrapProfile(stopResult)
				await writeFinal(profile)
				_state = "finalized"
			} catch (error) {
				transitionToFailed(`finalize: ${errorMessage(error)}`)
			} finally {
				cleanup()
			}
		}
		finalTimer = setTimeout(() => {
			void finalize()
		}, ALLOCATION_PROFILE_MAX_DURATION_MS)
		if (typeof (finalTimer as { unref?: () => void }).unref === "function") {
			;(finalTimer as { unref: () => void }).unref()
		}
		// Expose the finalizer to the test seam so ALLOCAUTH-FINAL-*
		// tests can drive the same code path the 60-second timer
		// drives, without waiting wall-clock 60 seconds.
		_finalizeDriver = finalize
	} catch (error) {
		transitionToFailed(`unexpected: ${errorMessage(error)}`)
	}
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build a `meta.json` payload. Same shape for checkpoint + final
 * (status discriminator differs).
 */
function buildCheckpointMeta(args: {
	readonly captureId: string
	readonly status: "checkpoint" | "final"
	readonly startedAt: Date
	readonly capturedAt: Date
	readonly checkpointIndex: number
	readonly identity: AllocationProfilerIdentityBinding
	readonly perf: {
		readonly getSamplingProfileMs: number
		readonly jsonSerializeMs: number
		readonly writeMs: number
		readonly profileBytes: number
		readonly sampleCount: number
	}
	readonly jsonMs: number
	readonly writeMs: number
	readonly transientCheckpointFailures: number
	readonly lastCheckpointWallMs?: number
}): Record<string, unknown> {
	return {
		schema_version: 1,
		capture_id: args.captureId,
		capture_kind: "extension_host_allocation_sampling",
		status: args.status,
		// Identity authority: the bundle SHA-256 is the load-bearing
		// identity (P1c fix). The source_head is informational only —
		// it may be "unknown" when the runtime is an installed VSIX
		// (no .git in extension dir).
		installed_bundle_sha256: args.identity.extensionBundleSha256,
		version: args.identity.version,
		extension_path: args.identity.extensionPath,
		source_head_informational: args.identity.sourceHead,
		started_at: args.startedAt.toISOString(),
		captured_at: args.capturedAt.toISOString(),
		checkpoint_index: args.checkpointIndex,
		trigger: "notify_enabled_background_command",
		sampling_interval_bytes: ALLOCATION_PROFILE_SAMPLING_INTERVAL_BYTES,
		stack_depth: ALLOCATION_PROFILE_STACK_DEPTH,
		include_objects_collected_by_minor_gc: true,
		include_objects_collected_by_major_gc: true,
		checkpoint_interval_ms: ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS,
		max_duration_ms: ALLOCATION_PROFILE_MAX_DURATION_MS,
		host_unresponsive_halt: false,
		transient_checkpoint_failures: args.transientCheckpointFailures,
		last_checkpoint_wall_ms: args.lastCheckpointWallMs,
		performance: {
			get_sampling_profile_ms: args.perf.getSamplingProfileMs,
			json_serialize_ms: args.perf.jsonSerializeMs,
			write_ms: args.perf.writeMs,
			profile_bytes: args.perf.profileBytes,
			sample_count: args.perf.sampleCount,
		},
	}
}

/**
 * Extract a sample-count integer from a SamplingHeapProfile response.
 */
function countSamples(profile: unknown): number {
	if (typeof profile !== "object" || profile === null) return 0
	const p = profile as Record<string, unknown>
	if (typeof p["sampleCount"] === "number") return p["sampleCount"]
	if (typeof p["samples"] === "number") return p["samples"]
	if (Array.isArray(p["samples"])) return p["samples"].length
	if (typeof p["head"] === "object" && p["head"] !== null) {
		const head = p["head"] as Record<string, unknown>
		if (typeof head["sampleCount"] === "number") return head["sampleCount"]
	}
	return 0
}

/**
 * Unwrap a CDP response. Some CDP versions wrap
 * `HeapProfiler.getSamplingProfile` in `{ profile: { ... } }`.
 * Return the inner profile when present.
 */
function unwrapProfile(result: unknown): unknown {
	if (typeof result === "object" && result !== null && "profile" in result) {
		const inner = (result as { profile: unknown }).profile
		if (inner !== undefined && inner !== null) return inner
	}
	return result
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	return String(error)
}
