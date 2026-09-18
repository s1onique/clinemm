/**
 * Host-owned supervised command execution.
 *
 * This module is the single owner of command execution lifetime for the
 * VS Code extension's `run_commands` background path. It separates two
 * clocks that the upstream `createShellExecutor` couples:
 *
 *   - WAIT_BUDGET_MS: how long this tool invocation waits before
 *     returning control to the model. Expiry does NOT terminate the
 *     process — it returns a `RUNNING` snapshot with a stable jobId.
 *     The wait budget is clamped DOWN to the execution deadline; it can
 *     never extend the deadline.
 *
 *   - EXECUTION_DEADLINE_MS: maximum wall-clock lifetime the host
 *     permits the command. The deadline is host-authoritative: callers
 *     cannot raise it. Expiry terminates the owned process tree and
 *     records `DEADLINE_EXCEEDED`.
 *
 * Five invariants:
 *   1. RUNNING is not a failure.
 *   2. The host may stop waiting without stopping the command, but it
 *      must never stop owning it.
 *   3. Cancellation is idempotent — calling cancel on an already-terminal
 *      job is a no-op.
 *   4. The deadline is host-authoritative; wait budget never extends it.
 *   5. The terminal outcome reflects why the host initiated termination,
 *      not what the child happened to do — if the host sent SIGTERM on
 *      deadline, the outcome is `deadline_exceeded` even if the child
 *      voluntarily exited 0 milliseconds later.
 *
 * Cancellation is exposed via the separate `cancel_command` tool
 * (see command-status-tool.ts). Observation via `command_status` is
 * read-only and does not require host command policy.
 */
import {
	SandboxError,
	type StructuredCommandInput,
	type SupervisableShellProcess,
	spawnSupervisableShellCommand,
} from "@cline/core"
import { type AgentToolContext, getDefaultShell, getShellInvocation, type InternalExecutionCapability } from "@cline/shared"
import type { RuntimeErrorIncident } from "@shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import {
	buildExperimentalReconCapability,
	defaultSandboxBackendResolver,
	resolveExperimentalSandboxMode,
	resolveSafeYoloCapabilityFromState,
	type SandboxBackendResolver,
} from "./sandbox-policy"

export type CommandJobState =
	| "running"
	| "exited"
	| "deadline_exceeded"
	| "cancelled"
	| "spawn_failed" /**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
	 * (correction06 / Factory HALT_PRIMARY_PGID_CONSERVATION_STILL_NOT_ENFORCED
	 * follow-up):
	 *
	 * Explicit terminal class for jobs whose execution ended
	 * (`process.exit` resolved, the host asked for termination,
	 * etc.) but whose bounded PGID-conservation invariant was
	 * NOT proven — i.e. the synchronous postcondition probe in
	 * `finalize()` returned `alive` / `eperm` / `unknown` (or
	 * no PGID was resolvable). The job has therefore terminated
	 * from the manager's vantage but the group is still on the
	 * OS (or unproven to be gone).
	 *
	 * Distinct from `exited`/`deadline_exceeded`/`cancelled`/
	 * `spawn_failed` so consumers can read the verdict
	 * out-of-band. The bounded invariant
	 * `CLEAN_TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE`
	 * is preserved: only the four "clean" terminal classes
	 * (without `containment_failed`) authorize a clean
	 * `command_job_terminal_committed`.
	 *
	 * Memory hygiene: a `containment_failed` job still moves
	 * from `active` → `terminal` (so the manager does not
	 * retain indefinitely); the gauge decrements via a
	 * post-delete `command_job_containment_failed` event so
	 * the `⎇ N` tracker sees the active-map mutation.
	 */
	| "containment_failed"

/**
 * Why the host initiated termination, if it did. Latched onto the job
 * so the terminal outcome reflects host authority rather than the
 * child's last will.
 */
export type TerminationReason = "natural" | "deadline" | "cancel"

/** A snapshot of a job's observable state. Safe to copy across boundaries. */
export interface CommandJobSnapshot {
	id: string
	state: CommandJobState

	startedAtMs: number
	deadlineAtMs: number
	nowMs: number

	exitCode?: number
	signal?: string

	stdout: string
	stderr: string
	outputTruncated: boolean

	/** Convenience fields for tool results. */
	elapsedMs: number
	deadlineRemainingMs: number

	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
	 * (correction06): projected for terminal jobs whose bounded
	 * PGID-conservation invariant was NOT proven. Carries the
	 * specific reason — mirrors the `CommandJob.terminationFailed`
	 * latched inside `finalize()`. Undefined for `running` jobs
	 * and for terminal jobs whose postcondition was `gone`
	 * (clean terminal).
	 *
	 * Values:
	 *   - 'pgid_unset'        — no PGID resolvable at finalize
	 *   - 'substrate_alive'   — kernel reported the group still exists
	 *   - 'substrate_eperm'   — kernel refused the probe (sandbox)
	 *   - 'substrate_unknown' — any other errno (fail-closed)
	 *
	 * When this field is set, `state` is `"containment_failed"`.
	 */
	containmentFailed?: "pgid_unset" | "substrate_alive" | "substrate_eperm" | "substrate_unknown"

	// NOTE (CORRECTION03): real authority-bearing capabilities
	// (e.g. FilesystemCreateOnlyCapability with the canonical
	// Darwin user temp root) are NOT projected into this snapshot.
	// The snapshot is the public status projection observed by
	// tool consumers and telemetry; surfacing authority data
	// here would re-introduce the leak that an earlier ACT
	// (CORRECTION02 of C1) deliberately removed by deleting the
	// legacy `executionCapability` field. Tests that need to
	// observe per-job stamping wrap `manager.start` (or
	// `tool.execute`) and inspect the captured context — see
	// `darwin-seatbelt-darwin-mktemp-capability01.c2-mixed-isolation.test.ts`.
}

/** Caller-supplied input to {@link CommandJobManager.start}. */
export interface StartCommandJobOptions {
	command: string | StructuredCommandInput
	cwd: string
	shell?: string
	env?: Record<string, string>

	/** How long to wait before returning control. Expiry ≠ termination. Clamped DOWN to the effective deadline. */
	waitBudgetMs: number
	/**
	 * Requested execution deadline. The host clamps this DOWN to its
	 * authoritative ceiling (the manager's `maxExecutionDeadlineMs`);
	 * callers can never extend execution.
	 */
	executionDeadlineMs: number
	/** Cap on per-call response output (chars). */
	maxOutputChars?: number
	/** Cap on per-job retained output (chars). */
	maxRetainedOutputChars?: number
}

/**
 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: terminal
 * transition metadata. `becameIdle` is true iff this terminal
 * completion was the >0->0 cardinality transition (this was the
 * last active job). Captured at the manager's `finalize()` mutation
 * seam — race-safe under concurrent terminal-completions because
 * the check + delete happen in a single synchronous burst.
 */
export interface TerminalTransition {
	becameIdle: boolean
}

export interface StartCommandJobResult {
	jobId: string
	state: CommandJobState
	elapsedMs: number
	deadlineRemainingMs: number
	stdout: string
	/** Stderr for terminal results — combined into stdout for the model-facing result text. */
	stderr: string
	outputTruncated: boolean
	process: SupervisableShellProcess
	exitCode?: number
	signal?: string
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: terminal-state promise.
	 * Resolves when the job reaches a terminal state (any of
	 * exited/deadline_exceeded/cancelled/spawn_failed). The runner
	 * attaches a `.then()` listener to react to the async completion
	 * — in particular, to flip the host's `backgroundCommandRunning`
	 * projection back to false when the tool returns RUNNING but the
	 * process later completes asynchronously. The runner's in-tool
	 * callback chain closes the moment the tool returns, so without
	 * this promise the projection would stay true forever.
	 *
	 * Always resolves (never rejects) — the runner can attach a
	 * `.then()` callback without a `.catch()`.
	 *
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: the
	 * resolved value carries `TerminalTransition` with `becameIdle`
	 * — true iff this terminal completion was the >0->0 cardinality
	 * transition. The runner uses this flag directly to decide
	 * whether to fire the (false, undefined) projection, instead
	 * of a post-hoc `getActiveJobIds()` count (which would be racy
	 * under concurrent starts).
	 */
	terminalPromise: Promise<TerminalTransition>
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: was this
	 * start a 0->1 cardinality transition? The runner uses this flag
	 * directly to decide whether to fire the (true, jobId) projection,
	 * instead of a post-hoc `getActiveJobIds()` count (which would be
	 * racy under concurrent starts).
	 */
	becameActive: boolean
}

/** Caller-supplied input to {@link CommandJobManager.status}. */
export interface StatusCommandJobOptions {
	jobId: string
	/** How long to wait for state transition (clamped to MAX_STATUS_WAIT_MS). */
	waitMs: number
}

/** Caller-supplied input to {@link CommandJobManager.cancel}. */
export interface CancelCommandJobOptions {
	jobId: string
}

/** Constructor options for {@link CommandJobManager}. */
export interface CommandJobManagerOptions {
	/**
	 * Maximum number of terminal jobs retained in memory. Bounded FIFO
	 * eviction (not LRU — status access does not refresh recency). Older
	 * jobs are evicted past the cap. Injectable so tests can prove
	 * eviction deterministically.
	 */
	maxTerminalJobs?: number
	/**
	 * Host-authoritative ceiling on execution deadline. Caller-supplied
	 * deadlines are clamped DOWN to this value. Defaults to
	 * `DEFAULT_EXECUTION_DEADLINE_MS`.
	 */
	maxExecutionDeadlineMs?: number
	/**
	 * Maximum wait budget the caller may request. Defaults to
	 * `DEFAULT_WAIT_BUDGET_MS`. Also clamped DOWN to
	 * `effectiveExecutionDeadlineMs` for any given job.
	 */
	maxWaitBudgetMs?: number
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Optional sandbox backend resolver. When set, overrides the
	 * production default (`defaultSandboxBackendResolver`).
	 *
	 * The resolver is the SOLE dependency-injection seam for the
	 * experimental sandbox integration. Tests use it to:
	 *   - simulate substrate-unavailable (return `undefined`)
	 *   - inject a backend whose `prepare()` throws `SandboxError`
	 *   - assert what was passed to the supervisor
	 *
	 * Production code never sets this; it remains on the default. The
	 * constructor never touches the Seatbelt substrate or SBPL.
	 */
	sandboxBackendResolver?: SandboxBackendResolver
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Canonical absolute paths treated as WRITE-allowed regions in
	 * the Wave-1 capability. Each invocation under Seatbelt (the new
	 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 default) builds a capability
	 * with these as `writableRoots` (Seatbelt write-allow regions).
	 *
	 * Optional. When omitted, the Wave-1 capability has empty
	 * `writableRoots` (no workspace writes protected from the kernel
	 * side). Production host code is responsible for supplying the
	 * actual workspace roots.
	 */
	experimentalSandboxWorkspaceRoots?: readonly string[]
	/**
	 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	 * Optional source for setting-driven capability overrides. When
	 * supplied, the production `buildExperimentalReconCapability`
	 * builder reads this snapshot at every command-start and applies
	 * it as the runtime source of truth; when omitted, the legacy
	 * env-only path runs (every existing test suite stays green).
	 *
	 * The SdkController supplies a closure that reads the persisted
	 * state keys `clinemmSafeYoloAllowNetwork` /
	 * `clinemmSafeYoloAllowSshAgent`. A user who has never opened
	 * the Settings UI reads `undefined` here and the builder falls
	 * through to the env-only path — exactly the pre-ACT runtime.
	 */
	safeYoloCapabilitySource?: () => {
		readonly network: boolean | undefined
		readonly sshAgent: boolean | undefined
	}
	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
	 * Optional helper-owned-PGID capability provider. When supplied,
	 * the manager will:
	 *   - call `provider.clientOpen()` exactly once at construction
	 *     to mint a per-instance client_token
	 *   - call `provider.registerOwned(pgid)` when each job's owned
	 *     PGID is established and stash the returned job_token on
	 *     the job
	 *   - call `provider.terminateOwned(job_token)` from
	 *     `runTerminationSequence()` ONLY when the direct path
	 *     reported `epermDetected` (the EPERM-only fallback)
	 *   - call `provider.releaseOwned(job_token)` best-effort on
	 *     natural completion, so the helper's slot is freed
	 *
	 * The provider is intentionally opaque: CommandJobManager does
	 * not import from `tools/macos-host-helper/`. This keeps the
	 * host→helper boundary injectable and testable, and means the
	 * same CommandJobManager binary works on non-macOS substrates
	 * (where the option is simply omitted).
	 *
	 * Each method must reject (return a rejected promise or throw)
	 * on `METHOD_NOT_AVAILABLE_IN_TS_FALLBACK` and any other error
	 * code; the manager swallows the rejection into the EPERM-only
	 * fallback branch and records `helperFallbackUsed` for
	 * telemetry. The fallback is best-effort: if the helper is
	 * unavailable, the cancellation still completes with whatever
	 * the direct path achieved, and the job's tree-escapee flag
	 * surfaces the unresolved kernel state.
	 */
	helperOwnedPgidProvider?: HelperOwnedPgidProvider
	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction04):
	 * test-only override for the supervisor's spawn primitive. Default
	 * is `spawnSupervisableShellCommand` from `@cline/core`. Tests
	 * inject a fake factory to drive the manager without spawning a
	 * real subprocess (some CI/sandbox environments cannot reliably
	 * `process.kill(-pid, ...)` the spawned child — the production
	 * path works on node but the same code under bun-spawned vitest
	 * workers hits EPERM).
	 *
	 * Not used in production code; surfaced for test determinism.
	 */
	spawnFactory?: (
		config: Parameters<typeof spawnSupervisableShellCommand>[0],
		options?: Parameters<typeof spawnSupervisableShellCommand>[1],
	) => SupervisableShellProcess
	/**
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01:
	 *
	 * Optional callback invoked exactly once when this manager
	 * surfaces a structured ClineMM runtime error incident that is
	 * attributable to the active task. V1 uses:
	 *
	 *   - `EPERM` from `command-job-manager` when the direct
	 *     terminate path returned `epermDetected: true` (the bash
	 *     supervisor's `TerminateTreeResult.epermDetected` is the
	 *     single canonical structured EPERM signal — the manager
	 *     does NOT parse strings or run a parallel `process.kill`
	 *     probe, by design).
	 *
	 * The callback is the narrowest possible seam: it receives a
	 * fully-classified `RuntimeErrorIncident` and the host (the
	 * SdkController) is responsible for forwarding it to the
	 * `TaskTelemetryTracker.recordRuntimeError()` observer. The
	 * manager itself stays host-decoupled — it does not import the
	 * tracker, the SDK adapter, or any UI code, so the same
	 * manager binary can run on substrates without a telemetry
	 * tracker (Hub/Remote, tests, the SDK CLI).
	 *
	 * Cardinality: ONE structured runtime incident → AT MOST ONE
	 * callback invocation. The TERM→KILL escalation on the SAME
	 * process tree counts as ONE incident (single kill operation).
	 * Helper-recovery success does NOT suppress the callback: an
	 * EPERM that was successfully resolved by the LaunchAgent
	 * fallback still counts as a runtime incident (the user-visible
	 * "this task hit a runtime error" fact must be preserved).
	 *
	 * Optional. When omitted, the manager silently drops incidents.
	 * Production callers wire this to the telemetry tracker.
	 */
	onRuntimeError?: (incident: RuntimeErrorIncident) => void

	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	 *
	 * Optional CommandJob lifecycle telemetry sink. The host can
	 * wire this to observe the lifecycle stages enumerated
	 * in §7 of the ACT:
	 *
	 *   - `command_job_process_started`
	 *   - `command_job_primary_group_registered`
	 *   - `command_job_termination_started`
	 *   - `command_job_primary_group_probe`
	 *   - `command_job_primary_group_cleanup`
	 *   - `command_job_helper_cleanup_attempted` (correction05)
	 *   - `command_job_terminal_requested`
	 *   - `command_job_terminal_committed` (correction05: only on `gone`)
	 *   - `command_job_residual_detected`
	 *   - `command_job_containment_failed` (correction06: post-delete
	 *     gauge-conservation event on the failure path)
	 *
	 * The sink is opt-in: omitting it is the production default
	 * (zero overhead, no allocations, no logger writes). Wiring it
	 * produces structured events that operators can correlate
	 * against the helper's request_id stream. The sink receives a
	 * fully-classified event with NO command text — only jobId,
	 * rootPid, pgid, jobState, terminationReason, probeResult, and
	 * helperFallbackUsed. Privacy / leak surface is identical to
	 * the existing `onRuntimeError` sink.
	 *
	 * The manager does NOT branch on the lifecycle kind — every
	 * callback fires with the same shape, and the host decides what
	 * to render. Default sink is no-op (`() => {}`).
	 */
	onCommandJobLifecycle?: (event: CommandJobLifecycleEvent) => void
	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
	 * (correction05 / Factory P0 follow-up):
	 *
	 * Test-only override for the postcondition probe. The production
	 * implementation calls `process.kill(-pgid, 0)` synchronously and
	 * classifies the return value (`gone` | `alive` | `eperm` |
	 * `unknown`). Tests inject a fake to drive the
	 * `command_job_primary_group_cleanup.postcondition` value without
	 * depending on real kernel state — required because the
	 * bounded-invariant gating (gone-only terminalization) needs
	 * composition coverage across the entire fail-closed set, not just
	 * the ESRCH substrate that production tests exercise by accident.
	 *
	 * Defaults to the real `process.kill(-pgid, 0)` classifier.
	 * Production callers MUST NOT supply this — it is reserved for
	 * the DCCT test suite and any future operator-driven diagnostic
	 * harness.
	 */
	terminalPostconditionProbe?: (pgid: number) => "gone" | "alive" | "eperm" | "unknown"
}

/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
 *
 * Frozen V1 lifecycle event payload. Mirrors the eight events in
 * §7 of the ACT spec. The `event` discriminator is a string
 * union; widening it is an additive change. The fields are
 * orthogonal: e.g. `pgid` is undefined for events emitted before
 * the helper registers the group, and `terminationReason` is
 * undefined for events emitted before the host initiates
 * termination.
 */
/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
 * Raw event payload passed to `emitCommandJobLifecycle()`. The
 * emitter enriches it with the live ownership gauge before
 * forwarding to the host sink, so call sites never need to
 * compute the gauge themselves.
 */
export type CommandJobLifecycleEventInput =
	| {
			readonly event: "command_job_process_started"
			readonly jobId: string
			readonly rootPid?: number
			readonly pgid?: number
			readonly detached: boolean
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_primary_group_registered"
			readonly jobId: string
			readonly pgid: number
			readonly helperFallbackUsed: boolean
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_termination_started"
			readonly jobId: string
			readonly pgid: number
			readonly terminationReason: TerminationReason
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_primary_group_probe"
			readonly jobId: string
			readonly pgid: number
			readonly probeResult: "gone" | "alive" | "eperm" | "unknown"
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_primary_group_cleanup"
			readonly jobId: string
			readonly pgid: number
			readonly postcondition: "gone" | "alive" | "eperm" | "unknown"
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			/**
			 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			 * (correction05 / Factory P1 follow-up):
			 *
			 * Fires from `runTerminationSequence()` when the EPERM
			 * fallback path consults the helper-owned-PGID helper. This
			 * is the OBSERVATIONAL signal that the helper was asked to
			 * terminate the group — it is NOT the authoritative
			 * postcondition probe (that lives in
			 * `command_job_primary_group_cleanup`, emitted from
			 * `finalize()` once the helper returned and we can read the
			 * kernel state).
			 *
			 * Disambiguates two events that previously shared the name
			 * `command_job_primary_group_cleanup` (helper-attempt vs
			 * authoritative kernel probe). Consumers now correlate
			 * these chronologically:
			 *   1. `command_job_helper_cleanup_attempted`
			 *      (EPERM fallback fired)
			 *   2. `command_job_primary_group_cleanup`
			 *      (authoritative kernel probe — gone|alive|eperm|unknown)
			 *   3. `command_job_terminal_committed` (only if postcondition===gone)
			 */
			readonly event: "command_job_helper_cleanup_attempted"
			readonly jobId: string
			readonly pgid: number
			readonly helperOutcome: "success" | "denied" | "failed"
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_terminal_requested"
			readonly jobId: string
			readonly terminationReason: TerminationReason
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_terminal_committed"
			readonly jobId: string
			readonly terminationReason: TerminationReason
			readonly exitCode: number | null
			readonly signal: string | null
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			readonly event: "command_job_residual_detected"
			readonly jobId: string
			readonly pgid: number
			readonly residualJobs: number
			readonly jobState: CommandJobState
			readonly tsMs: number
	  }
	| {
			/**
			 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			 * (correction06 / Factory
			 * HALT_PRIMARY_PGID_CONSERVATION_STILL_NOT_ENFORCED):
			 *
			 * Fires AFTER `this.active.delete(job.id)` in the
			 * failure path (postcondition ∈ {alive, eperm, unknown}
			 * or no PGID resolvable). This is the post-delete
			 * gauge-conservation event: it carries the live
			 * ownership gauge AFTER the active-map mutation so the
			 * tracker decrements from N to N-1, closing the
			 * `⎇ N` stale-gauge bug that correction05 introduced.
			 *
			 * Distinct from `command_job_residual_detected`
			 * (pre-delete observation of the kernel state) and
			 * from `command_job_terminal_committed` (clean
			 * terminalization, fires only on `gone`).
			 *
			 * Chronological order on the failure path:
			 *   1. command_job_primary_group_cleanup (probe)
			 *   2. command_job_residual_detected (pre-delete obs)
			 *   3. active.delete (mutation)
			 *   4. command_job_containment_failed (post-delete
			 *      gauge-conservation event — THIS event)
			 */
			readonly event: "command_job_containment_failed"
			readonly jobId: string
			/**
			 * The PGID the postcondition probe attempted to
			 * verify. `undefined` when the supervisor never
			 * exposed a numeric PGID (correction07
			 * `pgid_unset` branch); in that case
			 * `containmentFailed === "pgid_unset"` is the
			 * authoritative verdict.
			 */
			readonly pgid?: number
			readonly containmentFailed: "pgid_unset" | "substrate_alive" | "substrate_eperm" | "substrate_unknown"
			readonly jobState: "containment_failed"
			readonly tsMs: number
	  }

export type CommandJobLifecycleEvent =
	| {
			readonly event: "command_job_process_started"
			readonly jobId: string
			readonly rootPid?: number
			readonly pgid?: number
			readonly detached: boolean
			readonly jobState: CommandJobState
			readonly tsMs: number
			/**
			 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
			 * Live ownership gauge = the size of the manager's
			 * `active` map AT THE TIME of this event (i.e. AFTER
			 * the delta for this event has been applied). Lets the
			 * host update its tracker without holding a
			 * back-reference into the manager.
			 *
			 * NB: this measures jobs still in `active`, NOT live
			 * descendants. The bounded PGID-conservation invariant
			 * is the postcondition probe emitted in `finalize()`
			 * via `command_job_primary_group_cleanup.postcondition`;
			 * the stronger descendant-conservation invariant is
			 * OUT OF SCOPE here and is addressed by the successor
			 * ACT ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01.
			 */
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_primary_group_registered"
			readonly jobId: string
			readonly pgid: number
			readonly helperFallbackUsed: boolean
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_termination_started"
			readonly jobId: string
			readonly pgid: number
			readonly terminationReason: TerminationReason
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_primary_group_probe"
			readonly jobId: string
			readonly pgid: number
			readonly probeResult: "gone" | "alive" | "eperm" | "unknown"
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_primary_group_cleanup"
			readonly jobId: string
			readonly pgid: number
			readonly postcondition: "gone" | "alive" | "eperm" | "unknown"
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			/**
			 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			 * (correction05 / Factory P1 follow-up): see the
			 * `CommandJobLifecycleEventInput` mirror entry for the
			 * full rationale. This is the OBSERVATIONAL helper
			 * attempt signal — distinct from the authoritative
			 * `command_job_primary_group_cleanup` kernel probe.
			 */
			readonly event: "command_job_helper_cleanup_attempted"
			readonly jobId: string
			readonly pgid: number
			readonly helperOutcome: "success" | "denied" | "failed"
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_terminal_requested"
			readonly jobId: string
			readonly terminationReason: TerminationReason
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_terminal_committed"
			readonly jobId: string
			readonly terminationReason: TerminationReason
			readonly exitCode: number | null
			readonly signal: string | null
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			readonly event: "command_job_residual_detected"
			readonly jobId: string
			readonly pgid: number
			readonly residualJobs: number
			readonly jobState: CommandJobState
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }
	| {
			/**
			 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			 * (correction06 / Factory
			 * HALT_PRIMARY_PGID_CONSERVATION_STILL_NOT_ENFORCED):
			 * see the `CommandJobLifecycleEventInput` mirror entry
			 * for the full rationale. This is the post-delete
			 * gauge-conservation event that closes the stale-`⎇ N`
			 * bug on the failure path (postcondition ∈ {alive,
			 * eperm, unknown} or no PGID resolvable).
			 */
			readonly event: "command_job_containment_failed"
			readonly jobId: string
			/**
			 * The PGID the postcondition probe attempted to
			 * verify. `undefined` when the supervisor never
			 * exposed a numeric PGID (correction07
			 * `pgid_unset` branch); in that case
			 * `containmentFailed === "pgid_unset"` is the
			 * authoritative verdict.
			 */
			readonly pgid?: number
			readonly containmentFailed: "pgid_unset" | "substrate_alive" | "substrate_eperm" | "substrate_unknown"
			readonly jobState: "containment_failed"
			readonly tsMs: number
			readonly activeCommandJobs: number
	  }

/**
 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
 * Opaque capability provider. Concrete implementations wrap the
 * C-side helper (see tools/macos-host-helper/client.ts). Tests
 * inject a fake that simulates EPERM, register denial, or
 * successful escalation without the AF_UNIX boundary.
 */
export interface HelperOwnedPgidProvider {
	clientOpen(): Promise<{ clientToken: string }>
	registerOwned(input: { clientToken: string; pgid: number }): Promise<{ jobToken: string }>
	terminateOwned(input: {
		clientToken: string
		jobToken: string
	}): Promise<{ ok: true; outcome: "TERMINATED_TERM" | "TERMINATED_KILL" } | { ok: false; code: string }>
	releaseOwned(input: { clientToken: string; jobToken: string }): Promise<void>
	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction03):
	 * Reclaim the per-instance client slot held by `clientOpen()`. Called
	 * from `CommandJobManager.dispose()` exactly once after every active
	 * job has been terminated and its job slot released.
	 *
	 * Implementations MUST be idempotent and never throw — the manager
	 * is being torn down and cannot meaningfully surface errors. The
	 * C-side helper's `client.close` handler is fail-closed (peer
	 * identity check) and idempotent at the wire level.
	 */
	clientClose(clientToken: string): Promise<void>
}

/**
 * Default wait budget for run_commands. The tool call returns control
 * to the model after this much wall-clock time when the child is
 * still alive — and the child keeps running under the job manager's
 * supervision.
 */
export const DEFAULT_WAIT_BUDGET_MS = 15_000

/**
 * Default execution deadline. The host terminates the owned process
 * tree after this much wall-clock time regardless of whether anyone is
 * observing it. Also the default host-authoritative ceiling for
 * caller-supplied deadlines.
 */
export const DEFAULT_EXECUTION_DEADLINE_MS = 600_000 // 10 min

/**
 * Maximum response output per tool call (UTF-16 code units, "chars").
 * The retained snapshot is bounded separately and may be larger;
 * every model-facing response is projected through this cap.
 *
 * Note: this is consistent with upstream `createShellExecutor`'s
 * `MAX_COMMAND_OUTPUT_CHARS` and the SDK's `truncateCommandOutput`.
 * True UTF-8 byte accounting is a separate concern; treat this as a
 * model-context budget.
 */
export const MAX_RESPONSE_OUTPUT_CHARS = 65_536

/**
 * Maximum retained output per job for follow-up status inspection
 * (UTF-16 code units). Applied per stream (stdout, stderr); total
 * retained output per job can be up to ~2× this value.
 */
export const MAX_RETAINED_JOB_OUTPUT_CHARS = 4 * 1024 * 1024

/** Hard cap on `command_status(jobId, waitMs)`. */
export const MAX_STATUS_WAIT_MS = 30_000

/** Bounded retention for terminal jobs (FIFO eviction; not LRU). */
export const MAX_TERMINAL_JOBS = 128

/** SIGTERM grace before SIGKILL. Matches the bash executor's `5_000` watchdog. */
export const TERM_GRACE_MS = 5_000

/** Stable, opaque job id. Format: `cmd_<base36>`. */
function generateJobId(): string {
	return `cmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** Snap a job to an immutable snapshot the caller can store/return. */
function snapshot(job: CommandJob): CommandJobSnapshot {
	const nowMs = Date.now()
	const stdoutSnap = job.process.stdoutSnapshot()
	const stderrSnap = job.process.stderrSnapshot()
	return {
		id: job.id,
		state: job.state,
		startedAtMs: job.startedAtMs,
		deadlineAtMs: job.deadlineAtMs,
		nowMs,
		exitCode: job.exitCode,
		signal: job.signal,
		stdout: stdoutSnap.text,
		stderr: stderrSnap.text,
		outputTruncated: stdoutSnap.dropped || stderrSnap.dropped,
		elapsedMs: nowMs - job.startedAtMs,
		deadlineRemainingMs: Math.max(0, job.deadlineAtMs - nowMs),
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06): project containment verdict for
		// `containment_failed` terminal jobs. Clean terminal
		// jobs (postcondition `gone`) leave this undefined so
		// callers can read the invariant as
		// `containmentFailed === undefined ⇔ clean terminal`.
		containmentFailed: job.terminationFailed,
		// CORRECTION03: do NOT project job.executionCapability
		// (which may carry real FilesystemCreateOnlyCapability
		// roots) into the snapshot. The merged capability lives
		// on the internal job record for the Seatbelt backend's
		// consumption; the public snapshot is the status-only
		// projection observed by tool consumers / telemetry.
	}
}

/**
 * Project an internal snapshot to a model-facing snapshot with the
 * response cap applied. Distinct from `snapshot()` so the retained
 * spool can be larger than any individual response.
 *
 * The cap is a TOTAL model-context budget — not a per-stream budget.
 * The invariant is:
 *
 *   length(stdout) + length(separator) + length(stderr) <= totalCap
 *
 * where separator is the literal `\n[stderr]\n` (10 chars) used when
 * the run_commands tool concatenates the two streams, and `length`
 * either is just the stream itself when stderr is empty. This is the
 * SUBJECT promise to the model: every response costs at most
 * `MAX_RESPONSE_OUTPUT_CHARS` of context, period.
 *
 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION02:
 * The previous per-stream cap allowed `2 × MAX_RESPONSE_OUTPUT_CHARS`
 * to leak into the model context. The function now allocates a single
 * total budget across both streams, with a deterministic priority:
 *
 *   - stderr is preserved first (it is the diagnostic signal; loss
 *     of stderr obscures failure modes),
 *   - stdout gets the remainder of the stream budget,
 *   - whatever overflows is dropped, with `outputTruncated=true`.
 *
 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION03
 * (cleanup): the docblock no longer contradicts itself. The actual
 * priority is stderr > stdout, which is what the allocation code
 * implements.
 */
function projectResponseSnapshot(snap: CommandJobSnapshot, maxResponseOutputChars: number): CommandJobSnapshot {
	const stdoutRaw = snap.stdout
	const stderrRaw = snap.stderr
	// Combined-text separator is 10 chars (`\n[stderr]\n`) when stderr
	// is non-empty; zero when stderr is empty.
	const separatorLength = stderrRaw.length > 0 ? 10 : 0
	// Reserve budget for the separator; the rest is split between
	// stdout and stderr.
	const streamTotal = Math.max(0, maxResponseOutputChars - separatorLength)
	// Allocate stderr first (diagnostic priority). Then stdout gets
	// whatever remains. This means a large stderr can shrink stdout
	// to zero — the diagnostic signal is preserved at the cost of
	// some stdout content. Documented contract.
	const stderrCap = stderrRaw.length > 0 ? Math.min(stderrRaw.length, streamTotal) : 0
	const stdoutCap = Math.max(0, streamTotal - stderrCap)

	const truncatedStdout = stdoutRaw.length > stdoutCap
	const truncatedStderr = stderrRaw.length > stderrCap
	const truncatedCombined = stdoutRaw.length + stderrRaw.length > streamTotal

	return {
		...snap,
		stdout: truncatedStdout ? stdoutRaw.slice(0, stdoutCap) : stdoutRaw,
		stderr: truncatedStderr ? stderrRaw.slice(0, stderrCap) : stderrRaw,
		outputTruncated: truncatedStdout || truncatedStderr || truncatedCombined || snap.outputTruncated,
	}
}

interface CommandJob {
	id: string
	state: CommandJobState
	startedAtMs: number
	deadlineAtMs: number
	maxRetainedOutputChars: number
	maxResponseOutputChars: number

	process: SupervisableShellProcess

	exitCode?: number
	signal?: string

	/**
	 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
	 * C2 plumbing: closed runtime-owned authority slot captured from
	 * the call site's `AgentToolContext.executionCapability` at job
	 * construction time. NEVER read from generic metadata.
	 */
	executionCapability?: InternalExecutionCapability

	/**
	 * ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01: the
	 * INTERNAL owner identity slot. Captured from
	 * `AgentToolContext.sessionId` at construction time and used
	 * only by `hasRunningBackgroundJobForOwner(...)` to answer the
	 * internal authority question
	 * "does THIS owner still have a RUNNING job?".
	 *
	 * Encapsulation invariant (P1 of the bounded contract
	 * correction at commit 661780875): this field MUST NOT be
	 * projected into `CommandJobSnapshot` (the public status
	 * projection observed by tool consumers / telemetry / UI) or
	 * into the model-facing tool-result text. The internal
	 * `snapshot()` function (line 301) and the
	 * `projectResponseSnapshot()` function (line 358) construct
	 * their return shapes field-by-field WITHOUT spreading the
	 * `CommandJob` record, so a new field added here does not
	 * accidentally leak. Tests assert
	 * `'ownerSessionId' in snapshot === false`.
	 *
	 * `sessionId` is the upstream SDK's "host-owned lifecycle id"
	 * (per `sdk/packages/shared/src/agent.ts:825-845` docblock).
	 * It is stable for hub subscriptions, session persistence,
	 * abort/stop commands, and approval routing — and it can
	 * differ from `conversationId`, which is transcript
	 * correlation and "should not be used as the hub/session
	 * routing key". The fork's
	 * `sdk-session-lifecycle.ts:124-126` confirms sessionId is
	 * reused across mode/MCP rebuilds and follow-up resumes.
	 *
	 * `conversationId` is intentionally NOT captured: persisting
	 * both `sessionId` and `conversationId` because both exist
	 * on `AgentToolContext` is forbidden by the contract ACT
	 * (see ACT §3 "DO NOT persist BOTH sessionId and
	 * conversationId" / Q1-Q2 discrimination table).
	 *
	 * `taskId` is intentionally NOT captured: no such identity
	 * exists on `AgentToolContext` at job creation time
	 * (`sdk/packages/shared/src/agent.ts:348-355`).
	 */
	ownerSessionId?: string

	/**
	 * Latched when the host initiates termination. Survives natural exit.
	 * First-writer-wins: a cancel that arrives after the deadline has
	 * already initiated termination does NOT downgrade the recorded
	 * reason. The terminal outcome reflects the host's first decision,
	 * not the most recent call.
	 */
	terminationReason: TerminationReason
	/**
	 * The in-flight terminate() promise, set once by the first caller.
	 * Subsequent callers receive this same promise instead of starting
	 * a new SIGTERM sequence. Avoids racing two terminate() flows
	 * against each other.
	 */
	terminationPromise?: Promise<void>
	finalized: boolean

	/**
	 * CORRECTION03: set when the process tree was not observed gone
	 * after the grace + SIGKILL sequence. This is a diagnostic flag
	 * indicating an exceptional condition (stuck kernel, setpgid()
	 * escape, or sandbox-swallowed signals). The job is still
	 * considered terminal from the manager's perspective; the flag
	 * is observable through the snapshot for telemetry.
	 */
	treeEscapee?: boolean

	/** Tracked so finalize() can clear them — no leftover listeners. */
	deadlineTimer?: NodeJS.Timeout
	abortListener?: () => void
	abortSignal?: AbortSignal
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: resolver
	 * for the terminal-transition promise. Set by `start()` at job
	 * creation time (BEFORE the active Map is mutated, so the
	 * resolver is registered before the exit transition can
	 * resolve and call `finalize()`). Called by `finalize()` with
	 * `{ becameIdle: boolean }` after the job is removed from the
	 * active Map. The flag is computed at the mutation seam (size
	 * before delete) so it is race-safe.
	 */
	terminalTransitionResolve?: (transition: TerminalTransition) => void
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Optional sandbox-side cleanup hook (e.g. Seatbelt profile temp
	 * dir removal). Set by `start()` when the experimental sandbox
	 * was used; called by `finalize()` best-effort. Cleanup failure
	 * MUST NOT alter the command's exit classification.
	 */
	sandboxCleanup?: () => Promise<void>
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
	 * terminal-transition promise. Pre-created in `start()` so the
	 * resolver is registered before the exit transition can fire
	 * `finalize()`. Resolves with `{ becameIdle: boolean }` after
	 * the job is removed from the active Map. The flag is computed
	 * at the mutation seam (size before delete) so it is race-safe.
	 * The runner attaches `.then(({becameIdle}) => ...)` to this
	 * promise instead of post-hoc-querying `getActiveJobIds()`.
	 */
	terminalTransitionPromise?: Promise<TerminalTransition>

	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
	 * helper-owned-PGID capability, attached privately to the job
	 * when spawn establishes the PGID and the helper verifies the
	 * ownership. Set by `start()` after a successful register-owned
	 * call. Read by `cancel()` when direct termination returns EPERM.
	 *
	 * Never projected into the public snapshot; never included in
	 * any tool result text. The opaque tokens are sensitive (a leaked
	 * token from another connection cannot claim authority on a
	 * different peer, but defense in depth keeps them off the wire
	 * to tool consumers).
	 */
	helperOwnedCapability?: {
		readonly clientToken: string
		readonly jobToken: string
	}
	/** Cancellation safety net: see cancel() body. */
	helperFallbackUsed?: boolean
	/**
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: latched to
	 * `true` the first time this job surfaced a structured runtime
	 * error incident to the host sink. Guarantees the
	 * "ONE INCIDENT → ONE COUNT" invariant even under repeated
	 * termination attempts on the same job (idempotent cancel after
	 * deadline, retries, etc.). The latched value is NEVER reset
	 * within the job's lifetime — it survives the helper-fallback
	 * roundtrip so a successful helper recovery does not allow a
	 * second EPERM observation to double-count.
	 */
	runtimeErrorReported?: boolean
	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
	 * (correction05 / Factory P0 follow-up):
	 *
	 * Latched by `finalize()` after the synchronous PGID postcondition
	 * probe. Set iff the postcondition was NOT `gone`. Carries the
	 * specific reason so the bounded invariant verdict can be read
	 * out-of-band (independent of `state`):
	 *
	 *   - `'pgid_unset'`         — no PGID resolved at finalize time
	 *                              (should be unreachable on POSIX)
	 *   - `'substrate_alive'`    — `kill(-pgid, 0)` returned rc=0,
	 *                              i.e. the OS still has a process in
	 *                              this group. The bounded invariant
	 *                              `TERMINAL ⇒ PRIMARY OWNED PGID
	 *                              GONE` is REFUTED for this job.
	 *   - `'substrate_eperm'`    — `kill(-pgid, 0)` returned EPERM.
	 *                              The kernel refused the probe; the
	 *                              bounded invariant is UNPROVEN.
	 *                              Helper authority is the only path
	 *                              that could still claim conservation.
	 *   - `'substrate_unknown'`  — any other errno. Fail-closed.
	 *
	 * When `undefined`, the bounded invariant was proven for this job
	 * (postcondition === `gone`) — see `command_job_primary_group_cleanup.postcondition`.
	 */
	terminationFailed?: "pgid_unset" | "substrate_alive" | "substrate_eperm" | "substrate_unknown"
} /**
 * CommandJobManager — the single host owner of command execution
 * lifetime for the VS Code extension's `run_commands` background path.
 *
 * Lifetime is the host's session/runtime lifetime: created with the
 * session, disposed when the session ends. Active jobs are tracked in
 * memory; terminal jobs are kept in a bounded LRU so the model can
 * follow up on recently-finished work without unbounded growth.
 */

export class CommandJobManager {
	private readonly active = new Map<string, CommandJob>()
	private readonly terminal = new Map<string, CommandJob>()
	private readonly terminalOrder: string[] = []
	private readonly exitTransitions = new Map<string, Promise<void>>()
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
	 * terminal-transition promises keyed by jobId. Each job's
	 * `terminalPromise` is derived from this map at start time and
	 * is resolved from `finalize()` with `{ becameIdle: boolean }`.
	 * The runner uses the transition flag directly to decide whether
	 * to fire the host's `backgroundCommandRunning` projection
	 * reset — never a post-hoc `getActiveJobIds()` count.
	 */
	private readonly terminalTransitions = new Map<string, Promise<TerminalTransition>>()

	private readonly maxTerminalJobs: number
	private readonly maxExecutionDeadlineMs: number
	private readonly maxWaitBudgetMs: number
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Sandbox backend resolver (DI seam). Falls back to the production
	 * default that reads `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt` and
	 * resolves through `getSandboxBackend`. Frozen so callers cannot
	 * accidentally mutate it post-construction (mutating the resolver
	 * would silently change the fail-closed contract for in-flight jobs).
	 */
	private readonly sandboxBackendResolver: SandboxBackendResolver
	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Canonical workspace roots treated as write-confined regions in
	 * the Wave-1 experimental capability. Frozen.
	 */
	private readonly experimentalSandboxWorkspaceRoots: readonly string[]
	/**
	 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	 * Optional source for setting-driven capability overrides. When
	 * supplied, the production capability builder reads this
	 * snapshot at every command-start and applies it as the runtime
	 * source of truth; when omitted, the legacy env-only path runs
	 * (every existing test suite stays green).
	 */
	private readonly safeYoloCapabilitySource:
		| (() => {
				readonly network: boolean | undefined
				readonly sshAgent: boolean | undefined
		  })
		| undefined
	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
	 * Opaque helper-owned-PGID provider. Optional. When present,
	 * the manager will consult it for register-owned at job start
	 * and terminate-owned on EPERM. When absent, the manager is
	 * exactly the pre-ACT surface (direct kill(-pgid, sig) only).
	 *
	 * Token held in `this.helperClientToken` after the first
	 * successful `clientOpen()`. Lazy: `clientOpen()` is only
	 * awaited once, on the first job-start that wants to register.
	 */
	private readonly helperOwnedPgidProvider: HelperOwnedPgidProvider | undefined
	private readonly spawnFactory: (
		config: Parameters<typeof spawnSupervisableShellCommand>[0],
		options?: Parameters<typeof spawnSupervisableShellCommand>[1],
	) => SupervisableShellProcess
	/**
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: optional host
	 * sink for structured runtime error incidents. When supplied, the
	 * manager invokes it exactly once per qualifying incident (currently:
	 * `epermDetected: true` from the supervisor's `terminateTree`).
	 * When omitted, the manager silently drops incidents — preserving
	 * the existing pre-ACT behavior on substrates without a telemetry
	 * tracker (Hub/Remote, tests, the SDK CLI).
	 *
	 * The callback is invoked synchronously, but the manager treats it
	 * as best-effort: a thrown callback is caught and logged so a
	 * tracker bug cannot poison the termination flow.
	 */
	private readonly onRuntimeError: ((incident: RuntimeErrorIncident) => void) | undefined
	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	 * Lifecycle telemetry sink (opt-in). Production default is
	 * `undefined` (no callback fired, zero overhead). When wired
	 * by the host (e.g. dogfood diagnostic profile), receives the
	 * eight lifecycle events from §7 of the ACT.
	 */
	private readonly onCommandJobLifecycle: ((event: CommandJobLifecycleEvent) => void) | undefined
	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
	 * (correction05 / Factory P0 follow-up):
	 *
	 * Synchronous PGID postcondition classifier. The production
	 * implementation calls `process.kill(-pgid, 0)` and maps the
	 * result onto the fail-closed set; tests inject a fake to drive
	 * `command_job_primary_group_cleanup.postcondition` independently
	 * of real kernel state (the bounded-invariant gating needs
	 * composition coverage across all four classifications, not just
	 * the ESRCH substrate that production tests exercise by accident).
	 *
	 * Defaults to the real-kernel classifier; see
	 * `defaultTerminalPostconditionProbe` below.
	 */
	private readonly terminalPostconditionProbe: (pgid: number) => "gone" | "alive" | "eperm" | "unknown"
	private helperClientToken: string | undefined
	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction03):
	 * the in-flight `clientOpen()` promise resolves to either a
	 * `clientToken` (cached) or `undefined` (open failed → caller
	 * degrades to direct-path-only). The field type is
	 * `Promise<string | undefined>` to match the
	 * `.catch(() => undefined)` arm; the prior `Promise<string>`
	 * caused a typecheck error because undefined is not assignable
	 * to string.
	 */
	private helperClientTokenPromise: Promise<string | undefined> | undefined

	constructor(options: CommandJobManagerOptions = {}) {
		this.maxTerminalJobs = Math.max(1, options.maxTerminalJobs ?? MAX_TERMINAL_JOBS)
		this.maxExecutionDeadlineMs = Math.max(0, options.maxExecutionDeadlineMs ?? DEFAULT_EXECUTION_DEADLINE_MS)
		this.maxWaitBudgetMs = Math.max(0, options.maxWaitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS)
		this.sandboxBackendResolver = options.sandboxBackendResolver ?? defaultSandboxBackendResolver
		this.experimentalSandboxWorkspaceRoots = Object.freeze([...(options.experimentalSandboxWorkspaceRoots ?? [])])
		this.safeYoloCapabilitySource = options.safeYoloCapabilitySource
		this.helperOwnedPgidProvider = options.helperOwnedPgidProvider
		this.spawnFactory = options.spawnFactory ?? spawnSupervisableShellCommand
		this.onRuntimeError = options.onRuntimeError
		this.onCommandJobLifecycle = options.onCommandJobLifecycle
		this.terminalPostconditionProbe = options.terminalPostconditionProbe ?? defaultTerminalPostconditionProbe
	}

	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	 *
	 * Helper that fires a CommandJob lifecycle event into the
	 * optional sink. When the sink is undefined (production
	 * default), the call is a no-op (zero overhead, no
	 * allocations). When wired, the sink receives a fully-
	 * classified event and any thrown error is caught + logged
	 * — a sink bug must never poison the manager's runtime path.
	 */
	private emitCommandJobLifecycle(event: CommandJobLifecycleEventInput): void {
		const sink = this.onCommandJobLifecycle
		if (!sink) return
		try {
			// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			// (correction07 / Factory
			// HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
			//
			// The gauge IS the size of the active map — exactly
			// and only. NOT the length of `getActiveCommandJobs()`,
			// which filters out jobs whose `state !== "running"`
			// or whose PGID is not numeric/positive (that filter
			// is for the postcondition / ownership probe, NOT for
			// the gauge). Picking a single semantic authority
			// means `event.activeCommandJobs === manager.activeCount`
			// at every emit point — including BEFORE the delta has
			// been applied (the mutator must emit AFTER the map
			// write so this invariant holds; see start() and the
			// post-delete `command_job_containment_failed` emit
			// on the failure path).
			const enriched = {
				...(event as object),
				activeCommandJobs: this.active.size,
			} as CommandJobLifecycleEvent
			sink(enriched)
		} catch (e) {
			Logger.warn(
				`[CommandJobManager] onCommandJobLifecycle sink threw; event dropped (event=${event.event}, jobId=${event.jobId}): ${(e as Error).message}`,
			)
		}
	}

	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: lazy + cached
	 * `clientOpen()`. Returns the cached token on subsequent calls.
	 * On provider error, clears the in-flight promise so the next
	 * call retries — and surfaces `undefined` so the caller can
	 * degrade to direct-path-only.
	 */
	private async obtainHelperClientToken(): Promise<string | undefined> {
		if (!this.helperOwnedPgidProvider) return undefined
		if (this.helperClientToken) return this.helperClientToken
		if (!this.helperClientTokenPromise) {
			this.helperClientTokenPromise = this.helperOwnedPgidProvider
				.clientOpen()
				.then((res) => {
					this.helperClientToken = res.clientToken
					return res.clientToken
				})
				.catch(() => {
					// Clear so a future call retries (helper may have
					// come back online via restart).
					this.helperClientTokenPromise = undefined
					return undefined
				})
		}
		return this.helperClientTokenPromise
	}

	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: best-effort
	 * register the freshly-spawned job's PGID with the helper.
	 * Returns undefined when the helper is unavailable or the
	 * register call denies (foreign UID, non-leader PGID, etc.).
	 *
	 * The helper performs all authority checks: we just hand it
	 * the pgid and the caller-derived client_token. There is no
	 * client-side validation — even a bad pgid surfaces as
	 * `undefined` here, which is exactly the desired degradation.
	 */
	private async tryRegisterOwnedJob(childProcess: {
		readonly pgid?: number | undefined
	}): Promise<{ readonly clientToken: string; readonly jobToken: string } | undefined> {
		if (!this.helperOwnedPgidProvider) return undefined
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
		// `SupervisableShellProcess.pgid` is the canonical process-group
		// ID of the spawned shell (POSIX-only; undefined on Windows).
		// The helper verifies that `getpgid(pgid) === pgid` and that
		// the leader's UID matches the peer's UID before minting a
		// job_token.
		const pgid = childProcess.pgid
		if (typeof pgid !== "number" || pgid <= 0) return undefined
		const clientToken = await this.obtainHelperClientToken()
		if (!clientToken) return undefined
		try {
			const res = await this.helperOwnedPgidProvider.registerOwned({ clientToken, pgid })
			return { clientToken, jobToken: res.jobToken }
		} catch {
			// Register denial = no fallback authority. Cancellation
			// still works on the direct path; treeEscapee surfaces
			// any unresolved kernel state.
			return undefined
		}
	}

	/**
	 * ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: best-effort
	 * release of a helper-owned job slot. Called from finalize()
	 * on natural completion. Never throws.
	 */
	private async releaseHelperOwnedJob(job: CommandJob): Promise<void> {
		const cap = job.helperOwnedCapability
		if (!cap || !this.helperOwnedPgidProvider) return
		try {
			await this.helperOwnedPgidProvider.releaseOwned({
				clientToken: cap.clientToken,
				jobToken: cap.jobToken,
			})
		} catch {
			// Helper will reap on its own when the leader dies; this
			// is best-effort.
		}
	}

	/**
	 * ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01:
	 *
	 * Best-effort invocation of the host-supplied runtime-error
	 * sink. NEVER throws — a tracker bug cannot poison the
	 * termination flow. The caller is responsible for the
	 * "ONE INCIDENT → ONE COUNT" latch (`job.runtimeErrorReported`)
	 * so this method can be invoked freely from the call site.
	 */
	private reportRuntimeError(incident: RuntimeErrorIncident): void {
		const sink = this.onRuntimeError
		if (!sink) return
		try {
			sink(incident)
		} catch (err) {
			// NEVER let a sink failure break the manager. Logger.error
			// is the only channel; no propagation.
			Logger.error(
				`[CommandJobManager] onRuntimeError sink threw; incident dropped (class=${incident.errorClass}, source=${incident.source}, correlationId=${incident.correlationId ?? "<none>"})`,
				err,
			)
		}
	}

	async start(options: StartCommandJobOptions, context?: AgentToolContext): Promise<StartCommandJobResult> {
		// INVARIANT 4: the deadline is host-authoritative. The caller's
		// requested deadline is clamped DOWN to the manager's ceiling.
		const effectiveDeadlineMs = Math.min(Math.max(0, options.executionDeadlineMs), this.maxExecutionDeadlineMs)
		// Wait budget is also clamped DOWN — to the manager's ceiling AND
		// to the effective deadline. Waiting can never extend execution.
		const effectiveWaitBudgetMs = Math.min(Math.max(0, options.waitBudgetMs), this.maxWaitBudgetMs, effectiveDeadlineMs)
		const maxRetainedOutputChars = options.maxRetainedOutputChars ?? MAX_RETAINED_JOB_OUTPUT_CHARS
		const maxResponseOutputChars = options.maxOutputChars ?? MAX_RESPONSE_OUTPUT_CHARS

		const shell = options.shell ?? getDefaultShell(process.platform)
		let executable: string
		let args: string[]
		let input: string | undefined
		if (typeof options.command === "string") {
			const invocation = getShellInvocation(shell, options.command)
			executable = shell
			args = invocation.args
			input = invocation.input
		} else {
			const structured = options.command
			executable = structured.command
			args = structured.args ?? []
			input = undefined
		}

		const id = generateJobId()
		const startedAtMs = Date.now()
		const deadlineAtMs = startedAtMs + effectiveDeadlineMs

		// ----------------------------------------------------------------
		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
		// Experimental opt-in integration.
		//
		// ACT-CLINEMM-SEATBELT-DEFAULT-ON01: the contract changed from
		// DEFAULT_OFF to SECURE-BY-DEFAULT on darwin. `resolveExperimental
		// SandboxMode()` returns `"seatbelt-experimental"` for any unset,
		// empty, or "seatbelt" value, and `undefined` ONLY for the
		// explicit break-glass `CLINEMM_EXPERIMENTAL_SANDBOX=off`.
		// Unknown values now THROW `InvalidSandboxConfigurationError`
		// (fail closed; a typo must never silently disable Seatbelt).
		//
		// Fail-closed contract (P0 invariant, ACT-CLINEMM-SEATBELT-DEFAULT-ON01):
		//   - default (unset / "" / "seatbelt") → seatbelt path
		//   - "off"                              → legacy path (break-glass)
		//   - selector throws InvalidSandboxConfig → bubble out (no spawn)
		//   - seatbelt + no backend              → sandbox-unavailable, no spawn
		//   - seatbelt + prepare throws          → fail-closed, no spawn
		//   - seatbelt + prepare ok              → use prepared invocation as-is
		//                                        (executable/args/cwd/env come
		//                                        from the backend, NOT from the
		//                                        original)
		// ----------------------------------------------------------------
		// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
		// Conditional authority enforcement at the executor boundary.
		//
		// When `context.mandatorySeatbeltExecution === true`, the host
		// has asserted that the Seatbelt obligation MUST be honored
		// for this execution. The existing sandbox path below already
		// fail-closes on prepare() failure (see the try/catch around
		// `backend.prepare(...)` further down). The new gate here is:
		// if Seatbelt is unavailable (sandboxMode === undefined), the
		// command MUST NOT execute via `spawnSupervisableShellCommand`.
		// The existing fail-closed `buildSandboxUnavailableResult` path
		// is reused.
		//
		// Why we DON'T probe prepare() up-front:
		//   The existing sandbox branch (below) already fail-closes
		//   on prepare() throw by returning buildSandboxUnavailableResult
		//   BEFORE reaching `spawnSupervisableShellCommand`. The new
		//   thing this gate adds is solely the Seatbelt-availability
		//   check (the case the existing code did NOT cover, because
		//   the pre-fix executor fell through to the host shell when
		//   `sandboxMode === undefined`).
		//
		// INV-3, INV-7. The check happens at the TOP of start() so it
		// runs BEFORE the supervisor is invoked.
		// ----------------------------------------------------------------
		const mandatorySeatbeltExecution = context?.mandatorySeatbeltExecution === true
		if (mandatorySeatbeltExecution && resolveExperimentalSandboxMode() === undefined) {
			// The host asserted Seatbelt is mandatory, but the
			// operator has opted out (`CLINEMM_EXPERIMENTAL_SANDBOX=off`
			// break-glass on darwin, or non-darwin platform). Fail closed.
			return this.buildSandboxUnavailableResult({
				id,
				startedAtMs,
				deadlineAtMs,
				maxRetainedOutputChars,
				maxResponseOutputChars,
				signal: "seatbelt-required-but-unavailable: CLINEMM_EXPERIMENTAL_SANDBOX is off",
			})
		}
		const sandboxMode = resolveExperimentalSandboxMode()
		let preparedEnvSemantics: "overlay" | "complete" | undefined
		let sandboxCleanup: (() => Promise<void>) | undefined
		// The env passed to the supervisor. When the sandbox prepared
		// an invocation, we MUST use `prepared.env` (which contains the
		// sanitized allowlist) and NOT `options.env` (which may contain
		// secrets that the parent wants to pass to an unsandboxed
		// shell). The `envSemantics` field tells the supervisor how to
		// merge this `env` with the parent's `process.env`.
		let spawnEnv: Record<string, string> = options.env ?? {}
		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01-C2-P1:
		// The cwd passed to Node's spawn() MUST come from the prepared
		// invocation when the sandbox prepared one, not from the caller's
		// `options.cwd`. The Seatbelt backend canonicalizes cwd before
		// emitting the prepared invocation (e.g. /tmp/... -> /private/tmp/...);
		// the canonicalized form is what must reach spawn(). Node's
		// `spawn({ cwd })` is the working directory of the explicit
		// child -- this is not cosmetic metadata.
		let spawnCwd: string = options.cwd

		if (sandboxMode !== undefined) {
			// Opt-in recognized: route through the sandbox abstraction.
			const backend = await this.sandboxBackendResolver(sandboxMode)
			if (!backend) {
				// Fail-closed: opt-in recognized but no backend applies
				// (substrate unavailable, gate failed, etc.). The
				// command is NOT executed unsandboxed.
				return this.buildSandboxUnavailableResult({
					id,
					startedAtMs,
					deadlineAtMs,
					maxRetainedOutputChars,
					maxResponseOutputChars,
					signal: `sandbox-unavailable: opt-in ${sandboxMode} but no backend resolved`,
				})
			}

			// Build the Wave-1 capability. This function lives in the
			// sandbox-policy module so the executor stays agnostic of
			// Seatbelt-specific semantics.
			//
			// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
			// when a setting-driven capability source has been injected
			// into the manager (the production path through
			// VscodeSessionHost), read it here and pass the override
			// values through. When no source was injected (legacy
			// callers and existing test suites), the builder's env-only
			// fallback runs unchanged — every pre-existing test stays
			// green.
			let capability: ReturnType<typeof buildExperimentalReconCapability>
			if (this.safeYoloCapabilitySource) {
				const snap = this.safeYoloCapabilitySource()
				const convertedSnap = resolveSafeYoloCapabilityFromState(snap)
				capability = buildExperimentalReconCapability({
					cwd: options.cwd,
					workspaceRoots: this.experimentalSandboxWorkspaceRoots,
					networkOverride: convertedSnap.network,
					sshAgentOverride: convertedSnap.sshAgent,
				})
			} else {
				capability = buildExperimentalReconCapability({
					cwd: options.cwd,
					workspaceRoots: this.experimentalSandboxWorkspaceRoots,
				})
			}

			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
			// map the typed per-command channel into the Seatbelt
			// sandbox capability. The `jobExecutionCapability`
			// variable is constructed later (line 706 below) on
			// purpose; for the sandbox-prepare call we read directly
			// from `context` here, which is the single trusted source
			// for the typed channel.
			//
			// Mapping (exhaustive, spec §17 / §45):
			//   case "filesystem-create-only":
			//     createOnlyRoots = cap.roots (Seatbelt emits
			//      (allow file-write-create (subpath "<root>")))
			//   case "factory-binding-probe":
			//   case undefined:
			//     createOnlyRoots = []  (recon default applies)
			//
			// Future InternalExecutionCapability variants force a
			// switch update (compile error otherwise); prevents
			// silent authority drop (spec §18).
			const createOnlyRootsForThisJob = capabilityFromJobExecution(
				context?.perCommandExecutionCapability !== undefined
					? context.perCommandExecutionCapability
					: context?.executionCapability,
			)

			let prepared
			try {
				prepared = await backend.prepare({
					capability: {
						...capability,
						// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
						// attach the typed per-command create-only roots
						// (if any) so the Seatbelt profile generator
						// emits (allow file-write-create (subpath ...)).
						// [] is the safe no-op (no narrowing).
						...(createOnlyRootsForThisJob.length > 0 ? { createOnlyRoots: createOnlyRootsForThisJob } : {}),
					},
					command: {
						executable,
						args,
						cwd: options.cwd,
						env: options.env ?? {},
						input,
					},
				})
			} catch (err) {
				// Fail-closed: prepare threw (canonicalize, profile,
				// launch-prepare, etc.). The command is NOT executed
				// unsandboxed. The error is surfaced via `signal` on
				// a `spawn_failed` result.
				const reason =
					err instanceof SandboxError
						? `${err.reason}: ${err.message}`
						: err instanceof Error
							? err.message
							: String(err)
				return this.buildSandboxUnavailableResult({
					id,
					startedAtMs,
					deadlineAtMs,
					maxRetainedOutputChars,
					maxResponseOutputChars,
					signal: `sandbox-prepare-failed: ${reason}`,
				})
			}

			// STRUCTURAL spawn binding (reviewer evidence 2): the
			// prepared invocation is the authoritative spawn shape for
			// ALL spawn() fields, not just executable/args/env. We replace
			// each field with what the backend produced, and thread
			// `prepared.envSemantics` through the supervisor so the
			// env-merge site honors the contract.
			executable = prepared.executable
			args = [...prepared.args]
			input = prepared.input
			// CRITICAL: use the BACKEND'S cwd. Node's spawn({ cwd }) is
			// the actual working directory of the spawned child, not
			// metadata. The Seatbelt backend canonicalizes cwd in
			// prepare(); honoring `options.cwd` would silently drop that
			// canonicalization (e.g. /tmp/... -> /private/tmp/...).
			spawnCwd = prepared.cwd
			// CRITICAL: use the BACKEND'S env, not the caller's. The
			// caller's `options.env` may carry secrets that the parent
			// (run_commands host) wants to forward to an unsandboxed
			// shell. Under sanitized mode, those must NOT reach the
			// child. The backend's env is the authoritative allowlist.
			spawnEnv = prepared.env
			preparedEnvSemantics = prepared.envSemantics
			sandboxCleanup = prepared.cleanup
		}

		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01-C2-P2:
		// If the supervisor throws synchronously (rare, but possible:
		// e.g. a malformed SpawnConfig that the supervisor validates
		// before calling spawn()), ensure the sandbox-prepared cleanup
		// hook still runs. Without this, a profile temp dir from a
		// successful prepare() could leak because cleanup was attached
		// to the job only after this line.
		let childProcess
		try {
			childProcess = this.spawnFactory(
				{
					executable,
					args,
					cwd: spawnCwd,
					env: spawnEnv,
					input,
					// When `undefined` (legacy / disabled / unrecognized
					// opt-in) the supervisor preserves the existing
					// `{ ...process.env, ...config.env }` merge. When the
					// sandbox produced a sanitized env, this is "complete"
					// and the supervisor uses `config.env` AS-IS.
					envSemantics: preparedEnvSemantics,
				},
				{
					// Retain enough for follow-up status checks; response
					// truncation happens at the snapshot projection.
					maxOutputChars: maxRetainedOutputChars,
					combineOutput: true,
				},
			)
		} catch (err) {
			if (sandboxCleanup) {
				void sandboxCleanup().catch(() => {
					// Swallow: cleanup is best-effort, synchronous
					// supervisor throw is the load-bearing error.
				})
			}
			throw err
		}

		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: register
		// the freshly-spawned PGID with the helper so the helper
		// has authority to terminate it later (on EPERM). The
		// helper verifies:
		//   - the leader exists
		//   - the leader's UID matches the calling peer
		//   - the leader's PGID equals the proposed pgid
		//   - the leader's start_us is captured for PID reuse
		//     resistance on re-verification
		// Failure to register is best-effort: the job still
		// proceeds with the direct-path termination semantics.
		// If EPERM hits later, `cancel()` will not be able to
		// fall back; treeEscapee will be set instead.
		const helperCapability = await this.tryRegisterOwnedJob(childProcess)

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction07 / Factory
		// HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
		//
		// Capture the data for `command_job_process_started` and
		// `command_job_primary_group_registered` HERE, but DEFER
		// the actual emits until AFTER `this.active.set(id, job)`
		// below. The lifecycle emitter enriches every event with
		// the live ownership gauge; emitting before the active-map
		// mutation would carry `activeCommandJobs = 0` for a
		// start that just grew the gauge from 0 → 1, leaving the
		// header's `⎇ N` hidden for the entire useful lifetime of
		// a long-running command. The `command_job_containment_failed`
		// failure-path event already fires AFTER `active.delete`
		// (correction06); we mirror that here on the start path.
		const processStartedRootPid = readRootPidFromSupervisor(childProcess)
		const processStartedPgid = readPgidFromSupervisor(childProcess)
		const registeredPgid = helperCapability ? readPgidFromSupervisor(childProcess) : undefined

		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03:
		// set up the terminal-transition promise BEFORE the active
		// Map mutation so the resolver is registered before the
		// exit transition can resolve and call `finalize()`. The
		// previous order (set up the deferred in `makeStartResult`
		// after the race) had a race: if the child process completes
		// synchronously (the fast-path case), the exit transition's
		// `.then()` callback fires before `makeStartResult` runs,
		// and the resolver is undefined when `finalize` tries to
		// resolve it. Pre-creating the deferred here removes the
		// race.
		let resolveTerminalTransition!: (transition: TerminalTransition) => void
		const terminalTransitionPromise = new Promise<TerminalTransition>((resolve) => {
			resolveTerminalTransition = resolve
		}).then(
			(value) => value,
			() => ({ becameIdle: false }) as TerminalTransition,
		)
		this.terminalTransitions.set(id, terminalTransitionPromise)

		// ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
		// C2 plumbing: closed runtime-owned authority slot stamped from
		// the call-site `AgentToolContext.executionCapability`. This is
		// the ONLY writer -- it is NEVER derived from `context.metadata`
		// or any other partially-untrusted channel.
		//
		// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
		// CORRECTION01 (typed-channel separation):
		// Read from the typed per-command channel when present; the
		// legacy tool-call channel is reserved for the synthetic
		// `factory-binding-probe` capability (zero real authority)
		// and must not be widened here. This honors the
		// channel-separation contract: real authority-bearing
		// variants (`filesystem-create-only`, ...) flow through
		// `perCommandExecutionCapability` only.
		const jobExecutionCapability: InternalExecutionCapability | undefined =
			context?.perCommandExecutionCapability !== undefined
				? context.perCommandExecutionCapability
				: context?.executionCapability

		const job: CommandJob = {
			id,
			state: "running",
			startedAtMs,
			deadlineAtMs,
			maxRetainedOutputChars,
			maxResponseOutputChars,
			process: childProcess,
			terminationReason: "natural",
			finalized: false,
			terminalTransitionResolve: resolveTerminalTransition,
			terminalTransitionPromise,
			// ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
			// C2 plumbing: closed runtime-owned authority slot stamped at
			// construction time. Recorded on the job record for snapshot
			// inspection by tests; not consumed by the sandbox in C2 of
			// THIS ACT (Seatbelt integration resumes in
			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2).
			executionCapability: jobExecutionCapability,
			// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
			// Stash the sandbox-prepared cleanup hook (e.g. Seatbelt
			// profile temp dir removal). `finalize()` will run it
			// best-effort. Always `undefined` for non-sandboxed jobs.
			sandboxCleanup,
			// ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01:
			// stamp the INTERNAL owner identity from
			// `AgentToolContext.sessionId` (the upstream SDK's
			// host-owned lifecycle id, stable across mode/MCP
			// rebuilds and follow-up resumes per
			// sdk-session-lifecycle.ts:124-126). When `context`
			// is undefined or sessionId is not present, this is
			// `undefined` — `hasRunningBackgroundJobForOwner`
			// then returns false for any owner (the graceful
			// "ProducerHasNoOwnerIdentity" control; the manager
			// never fabricates an owner). The field is OPTIONAL
			// so pre-existing call sites that don't supply a
			// second `context` argument (e.g. the
			// command-job-manager.test.ts pattern) remain
			// behaviorally unchanged.
			ownerSessionId: context?.sessionId,
			// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
			// private helper capability attached by `start()`.
			// Read by `runTerminationSequence()` on EPERM.
			helperOwnedCapability: helperCapability,
		}
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: capture
		// the cardinality transition at the manager's mutation seam.
		// The check happens BEFORE `this.active.set` so the value is
		// race-safe under concurrent `start()` calls — between this
		// check and the `set` no other code can run (single-threaded JS).
		// After this insertion, `wasBecomingActive` is true iff this
		// was a 0->1 cardinality transition. The runner uses this
		// flag directly instead of a post-hoc `getActiveJobIds()`
		// count, which would be racy.
		const wasBecomingActive = this.active.size === 0
		this.active.set(id, job)

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction07 / Factory
		// HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
		//
		// Emit `command_job_process_started` AFTER the active-map
		// insertion so the lifecycle emitter's
		// `activeCommandJobs = this.active.size` enrichment
		// carries the post-delta gauge (1 for a 0→1 transition).
		// Mirror of the `command_job_containment_failed`
		// post-delete emit on the failure path (correction06):
		// both events now carry the gauge value that reflects the
		// mutation that produced them, not the value from before
		// the mutation.
		this.emitCommandJobLifecycle({
			event: "command_job_process_started",
			jobId: id,
			rootPid: processStartedRootPid,
			pgid: processStartedPgid,
			detached: true,
			jobState: "running",
			tsMs: startedAtMs,
		})

		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction07): same ordering rule for
		// `command_job_primary_group_registered`. Emit only when
		// the helper accepted the registration AND a numeric pgid
		// is resolvable (the same predicate as the previous
		// ordering). When the helper is absent or rejects, the
		// bounded contract still owns the PGID via the direct
		// path — no event is emitted in that case.
		if (typeof registeredPgid === "number") {
			this.emitCommandJobLifecycle({
				event: "command_job_primary_group_registered",
				jobId: id,
				pgid: registeredPgid,
				helperFallbackUsed: false,
				jobState: "running",
				tsMs: Date.now(),
			})
		}

		// Track exit; finalize using the latched terminationReason so
		// host-initiated termination wins over the child's cooperation.
		const exitTransition = childProcess.exit
			.then((result: { exitCode: number | null; signal: NodeJS.Signals | null }) => {
				if (job.finalized) return
				const state: CommandJobState =
					job.terminationReason === "deadline"
						? "deadline_exceeded"
						: job.terminationReason === "cancel"
							? "cancelled"
							: "exited"
				this.finalize(job, state, { exitCode: result.exitCode, signal: result.signal })
			})
			.catch((error: Error) => {
				if (job.finalized) return
				this.finalize(job, "spawn_failed", { signal: error.message })
			})
		this.exitTransitions.set(id, exitTransition)

		// Deadline watchdog — the only timer allowed to call killTree.
		// Tracked on the job so finalize() can clear it.
		job.deadlineTimer = setTimeout(() => {
			if (job.finalized || job.state !== "running") return
			void this.terminate(job, "deadline")
		}, effectiveDeadlineMs)
		job.deadlineTimer.unref()

		// Honor caller-supplied AbortSignal as a cancel, not a deadline.
		if (context?.signal) {
			job.abortSignal = context.signal
			job.abortListener = () => {
				if (job.finalized || job.state !== "running") return
				void this.terminate(job, "cancel")
			}
			if (context.signal.aborted) {
				job.abortListener()
			} else {
				context.signal.addEventListener("abort", job.abortListener, { once: true })
			}
		}

		// Race the wait budget against the exit. Wait budget does NOT
		// kill the process — it returns a RUNNING snapshot if the child
		// is still alive after the budget. Fast commands resolve their
		// `process.exit` synchronously after spawn and the finalize()
		// callback runs before this Promise.race resolves, so the tool
		// sees the terminal state without spurious RUNNING.
		return this.awaitOrSnapshot(job, effectiveWaitBudgetMs, wasBecomingActive)
	}

	private async awaitOrSnapshot(
		job: CommandJob,
		waitBudgetMs: number,
		wasBecomingActive: boolean,
	): Promise<StartCommandJobResult> {
		const remaining = Math.max(0, waitBudgetMs - (Date.now() - job.startedAtMs))
		if (remaining > 0 && job.state === "running") {
			// Wait for terminal transition or budget — whichever first.
			// No mutable waiter list: race the existing exitTransition
			// promise against a one-shot timer. Each status() call creates
			// its own ad-hoc promise, so the cost is bounded by the
			// active status callers — not by repeated polls.
			// Critical: clear the timer reference so it does not stay
			// registered for the full remaining duration when the exit
			// wins the race.
			let timer: NodeJS.Timeout | undefined
			await Promise.race([
				this.exitTransitions.get(job.id) ?? Promise.resolve(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, remaining)
					timer.unref()
				}),
			])
			if (timer) {
				clearTimeout(timer)
			}
		}
		return this.makeStartResult(job, wasBecomingActive)
	}

	private makeStartResult(job: CommandJob, wasBecomingActive: boolean): StartCommandJobResult {
		const snap = projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars)
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: the
		// terminal-transition promise is pre-created in `start()`
		// BEFORE the active Map is mutated, so the resolver is
		// registered before the exit transition can resolve and
		// call `finalize()`. This removes the fast-path race where
		// the deferred didn't exist yet when finalize ran. See the
		// creation site in `start()` for the full rationale.
		if (!job.terminalTransitionPromise) {
			// Defensive fallback — should never trigger in practice
			// because the deferred is created at job construction
			// time. If it does, return a never-resolving promise so
			// the runner's `.then()` is a no-op rather than crashing.
			throw new Error("terminalTransitionPromise missing on job")
		}
		return {
			jobId: job.id,
			state: job.state,
			elapsedMs: snap.elapsedMs,
			deadlineRemainingMs: snap.deadlineRemainingMs,
			stdout: snap.stdout,
			stderr: snap.stderr,
			outputTruncated: snap.outputTruncated,
			process: job.process,
			terminalPromise: job.terminalTransitionPromise,
			becameActive: wasBecomingActive,
			...(snap.exitCode !== undefined ? { exitCode: snap.exitCode } : {}),
			...(snap.signal !== undefined ? { signal: snap.signal } : {}),
		}
	}

	/**
	 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
	 * Build a `spawn_failed` result for sandbox fail-closed paths.
	 *
	 * Used when:
	 *   - opt-in recognized, but `sandboxBackendResolver` returns `undefined`
	 *     (substrate unavailable, gate failed)
	 *   - opt-in recognized, backend available, but `prepare()` throws
	 *     a `SandboxError` (canonicalize, profile, etc.)
	 *
	 * The job never enters the active Map (no spawn occurred), so
	 * `terminalPromise` resolves immediately with `becameIdle: true` —
	 * the runner's `.then()` chain is a no-op.
	 *
	 * The `process` field is a synthetic "never-spawned" shell process
	 * whose `killTree()`/`terminateTree()` are no-ops. This is required
	 * by the type but never invoked because `state` is already terminal.
	 */
	private buildSandboxUnavailableResult(input: {
		id: string
		startedAtMs: number
		deadlineAtMs: number
		maxRetainedOutputChars: number
		maxResponseOutputChars: number
		signal: string
	}): StartCommandJobResult {
		const never = (): Promise<never> => new Promise<never>(() => {})
		const emptySnap = () => ({ text: "", totalChars: 0, dropped: false })
		const syntheticProcess: SupervisableShellProcess = Object.freeze({
			exit: never(),
			killTree: async () => {},
			terminateTree: async () => ({ treeTerminated: true, escalatedToKill: false, epermDetected: false }),
			stdoutSnapshot: emptySnap,
			stderrSnapshot: emptySnap,
			pid: undefined,
			pgid: undefined,
		})
		return {
			jobId: input.id,
			state: "spawn_failed",
			elapsedMs: Math.max(0, Date.now() - input.startedAtMs),
			deadlineRemainingMs: Math.max(0, input.deadlineAtMs - Date.now()),
			stdout: "",
			stderr: "",
			outputTruncated: false,
			process: syntheticProcess,
			// The job never entered the active Map, so there is no
			// cardinality transition to observe. Resolve immediately
			// with `becameIdle: true` so any downstream `.then()` is a
			// no-op rather than holding a pending promise.
			terminalPromise: Promise.resolve({ becameIdle: true }),
			becameActive: false,
			signal: input.signal,
		}
	}

	private async terminate(job: CommandJob, reason: "deadline" | "cancel"): Promise<void> {
		if (job.finalized || job.state !== "running") return
		// FIRST-WRITER-WINS: if termination is already in flight, return
		// the existing promise. The deadline-vs-cancel race produces a
		// stable outcome from the first call, not the most recent.
		if (job.terminationPromise) {
			return job.terminationPromise
		}
		// Latch the reason and start the termination flow.
		job.terminationReason = reason
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
		// emit `command_job_termination_started` BEFORE the
		// termination sequence runs so a wired sink can correlate
		// the post-probe event with the originating reason. The
		// event is emitted exactly once per terminate() call thanks
		// to the FIRST-WRITER-WINS gate above.
		const terminatePgid = readPgidFromSupervisor(job.process)
		if (typeof terminatePgid === "number") {
			this.emitCommandJobLifecycle({
				event: "command_job_termination_started",
				jobId: job.id,
				pgid: terminatePgid,
				terminationReason: reason,
				jobState: job.state,
				tsMs: Date.now(),
			})
		}
		job.terminationPromise = this.runTerminationSequence(job)
		return job.terminationPromise
	}

	private async runTerminationSequence(job: CommandJob): Promise<void> {
		// CORRECTION03 P0: terminate the OWNED PROCESS TREE, not just
		// the shell's exit promise. The previous implementation raced
		// against `job.process.exit` and skipped the SIGKILL escalation
		// whenever the shell cooperated — even if SIGTERM-ignoring
		// descendants remained in the owned process group.
		//
		// The primitive handles PGID existence polling and SIGKILL
		// escalation internally (see SupervisableShellProcess.terminateTree).
		// The manager's job here is to:
		//   1) ask the primitive to terminate the tree.
		//   2) await the canonical terminal transition so the caller
		//      (cancel/deadline) can read job.state directly without
		//      synthesizing it.
		//   3) ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: if
		//      direct termination reported EPERM and a helper capability
		//      was registered, ask the helper to terminate the owned
		//      PG. EPERM-only: the helper is NOT consulted on a clean
		//      direct termination (saves an IPC) and is NOT consulted
		//      on tree-escape (helper cannot fix a stuck kernel state;
		//      treeEscapee remains the diagnostic).
		//
		// review-correction04: there is exactly ONE EPERM authority
		// here — the SDK primitive's `terminateTree`. It owns the
		// signaling AND the EPERM observation (returning the result
		// in `TerminateTreeResult.epermDetected`). The pre-correction04
		// code added a parallel `process.kill(-pgid, "SIGTERM")` probe
		// in the manager, which sent a duplicate SIGTERM and read its
		// own EPERM — two competing seams. Removed.
		const treeResult = await job.process.terminateTree({
			gracefulSignal: "SIGTERM",
			graceMs: TERM_GRACE_MS,
		})
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
		// emit `command_job_primary_group_probe` so a wired sink can
		// observe the post-terminate kernel state of the PGID. We
		// classify the result the same way `probeOwnedGroups()`
		// does, but the source of truth here is the supervisor's
		// `treeResult` (it already polled the kernel as part of its
		// grace-race loop). When the supervisor reports
		// `treeTerminated: false`, the PGID is still alive (or
		// EPERM'd); when true, the PGID is gone.
		const probePgid = readPgidFromSupervisor(job.process)
		if (typeof probePgid === "number") {
			let probeResult: "gone" | "alive" | "eperm" | "unknown"
			if (treeResult.treeTerminated) probeResult = "gone"
			else if (treeResult.epermDetected) probeResult = "eperm"
			else probeResult = "alive"
			this.emitCommandJobLifecycle({
				event: "command_job_primary_group_probe",
				jobId: job.id,
				pgid: probePgid,
				probeResult,
				jobState: job.state,
				tsMs: Date.now(),
			})
		}
		// ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01: the
		// supervisor's structured EPERM signal is the canonical
		// runtime-error authority for process-tree termination. We
		// surface it to the host sink EXACTLY ONCE per job,
		// regardless of helper-recovery success — an EPERM that the
		// LaunchAgent helper successfully recovered is still a real
		// runtime incident the user should see in the task header.
		// Guarded by `job.runtimeErrorReported` so a second termination
		// attempt on the same job (idempotent cancel) cannot double-count.
		if (treeResult.epermDetected && !job.runtimeErrorReported) {
			job.runtimeErrorReported = true
			this.reportRuntimeError({
				errorClass: "EPERM",
				source: "command-job-manager",
				correlationId: job.id,
			})
		}
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
		// EPERM-only fallback. The helper is consulted only when:
		//   - the direct path reported epermDetected (it tried to
		//     signal -pgid and the kernel refused), AND
		//   - a helper capability was attached at start time, AND
		//   - the group did NOT vanish anyway (if it did, EPERM was
		//     momentary; the helper is unnecessary).
		//
		// The fallback is best-effort: on any helper error we
		// preserve the existing treeEscapee flag and continue.
		if (treeResult.epermDetected && job.helperOwnedCapability) {
			job.helperFallbackUsed = true
			// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction04-followup):
			// extract the provider into a non-null local so the call site
			// does not need a `!` non-null assertion (biome lint forbids it).
			// The gate `job.helperOwnedCapability` is set only when the
			// helper was used to register (tryRegisterOwnedJob), which
			// requires a non-null provider; this local is therefore sound.
			const provider = this.helperOwnedPgidProvider
			if (!provider) {
				// Unreachable: tryRegisterOwnedJob sets
				// helperOwnedCapability only when a provider was used.
				throw new Error("helper-owned capability set without a provider")
			}
			// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			// (correction05 / Factory P1 follow-up):
			// Capture the helper-attempt outcome so we can emit
			// `command_job_helper_cleanup_attempted` with a structured
			// verdict — distinct from the authoritative
			// `command_job_primary_group_cleanup` kernel probe that
			// `finalize()` emits after the helper returned.
			//
			// Outcomes:
			//   success → terminateOwned resolved; helper told us the
			//             group is gone (caller's responsibility to
			//             await the kernel observation).
			//   denied  → capability-level rejection (e.g. expired
			//             token, foreign UID). Identifiable by the
			//             helper's structured error code (DENY_*).
			//   failed  → IPC / runtime / unknown failure. The direct
			//             path's treeEscapee remains the diagnostic.
			let helperOutcome: "success" | "denied" | "failed" = "failed"
			try {
				await provider.terminateOwned({
					clientToken: job.helperOwnedCapability.clientToken,
					jobToken: job.helperOwnedCapability.jobToken,
				})
				helperOutcome = "success"
				// Helper succeeded — wait briefly for the kernel
				// to observe the group gone. We do NOT block here:
				// `job.process.exit` will catch it; the helper's
				// own timeout-driven kill on its own task guarantees
				// the leader goes away in bounded time.
			} catch (e) {
				// Helper error (DENY_*, TERMINATION_FAILED, IPC fail,
				// METHOD_NOT_AVAILABLE_IN_TS_FALLBACK). The direct
				// path's treeEscapee remains the diagnostic. We do
				// our best-effort classification: provider-shaped
				// rejection surfaces as `denied`, anything else as
				// `failed`. The provider's error contract is opaque
				// to the manager (HelperOwnedPgidProvider is a host
				// seam) so we rely on the convention that helpers
				// with structured codes attach a `code` or
				// `errorClass` to the thrown value.
				const err = e as { code?: string; errorClass?: string; message?: string }
				const codeOrClass = err?.code ?? err?.errorClass
				if (typeof codeOrClass === "string" && (codeOrClass.startsWith("DENY_") || codeOrClass === "PERMISSION_DENIED")) {
					helperOutcome = "denied"
				}
			}
			// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			// (correction05 / Factory P1 follow-up): emit the
			// OBSERVATIONAL helper-attempt event (renamed from the
			// previous `command_job_primary_group_cleanup` reuse).
			// Consumers now correlate these chronologically:
			//   1. command_job_helper_cleanup_attempted (this one)
			//   2. command_job_primary_group_cleanup (kernel probe
			//      from finalize() — fail-closed set)
			//   3. command_job_terminal_committed (only on gone)
			const cleanupPgid = readPgidFromSupervisor(job.process)
			if (typeof cleanupPgid === "number") {
				this.emitCommandJobLifecycle({
					event: "command_job_helper_cleanup_attempted",
					jobId: job.id,
					pgid: cleanupPgid,
					helperOutcome,
					jobState: job.state,
					tsMs: Date.now(),
				})
			}
		}
		// After terminateTree resolves, the tree is observed gone OR
		// the escalation completed. The shell's exit promise will
		// resolve shortly (the shell was part of the tree). Await it
		// so the caller can read job.state as the canonical terminal
		// state — fixes P1 (synthesized state before finalization).
		try {
			await job.process.exit
		} catch {
			// Spawn failure or kill-induced exit; finalize() will have
			// already handled classification.
		}
		// Surface the tree outcome through the job for telemetry/diagnostics.
		if (!treeResult.treeTerminated) {
			// The OS still reports the PG as existing after grace +
			// SIGKILL. This is exceptional — typically a stuck kernel
			// state, a process that called setpgid() to escape our
			// group, or a sandbox that swallowed signals. Record it
			// as a structured detail so the caller can diagnose; do
			// not retry (no further escalation is safe here).
			job.treeEscapee = true
		}
	}

	private finalize(
		job: CommandJob,
		state: Exclude<CommandJobState, "running">,
		detail: { exitCode?: number | null; signal?: NodeJS.Signals | string | null },
	): void {
		if (job.finalized) return
		job.finalized = true
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06 / Factory
		// HALT_PRIMARY_PGID_CONSERVATION_STILL_NOT_ENFORCED):
		//
		// State assignment is DEFERRED until after the postcondition
		// probe. The probe may determine the job belongs in the
		// `containment_failed` terminal class (postcondition ≠
		// `gone`), in which case the caller's `state` (e.g.
		// `"cancelled"`, `"deadline_exceeded"`) is OVERWRITTEN with
		// the containment verdict — the bounded invariant statement
		// `CLEAN_TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE`
		// then has the truthful semantic it claims.
		//
		// correction05 wrote `job.state = state` here eagerly,
		// which made the bounded invariant
		// `TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE`
		// false by construction: any cancelled job whose PGID
		// was still on the OS would terminate with `state =
		// "cancelled"` AND `command_job_terminal_committed`
		// denied — exactly the case Factory caught. The
		// over-write below makes the state machine honest.
		if (detail.exitCode !== undefined && detail.exitCode !== null) {
			job.exitCode = detail.exitCode
		}
		if (typeof detail.signal === "string") {
			job.signal = detail.signal
		}
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction05 / Factory P0 follow-up):
		//
		// BEFORE emitting terminal_committed and BEFORE discarding
		// the job's identity (`this.active.delete(job.id)`), capture
		// the saved PGID and probe `kill(-pgid, 0)` synchronously.
		// The classification is fail-closed (see
		// `defaultTerminalPostconditionProbe`):
		//
		//   gone    → ESRCH — the OS confirms the group is reaped
		//   alive   → rc=0 — the group still exists; the bounded
		//                    invariant `TERMINAL ⇒ PRIMARY OWNED
		//                    PGID GONE` is REFUTED for this job
		//   eperm   → EPERM — the kernel refused the probe; the
		//                    bounded invariant is UNPROVEN
		//   unknown → any other errno — fail-closed
		//
		// The probe fires inside finalize() SYNCHRONOUSLY so the
		// saved PGID is still resolvable and the read cannot race
		// with the active-map delete that follows. The result
		// ALSO drives a LOAD-BEARING GATE on terminalization:
		//
		//   postcondition === "gone"
		//     → emit `command_job_primary_group_cleanup`
		//     → emit `command_job_terminal_committed`
		//     → `gone` is the ONLY path that proves the bounded
		//       invariant
		//
		//   postcondition === "alive" | "eperm" | "unknown"
		//     → emit `command_job_primary_group_cleanup` carrying
		//       the failure classification
		//     → emit `command_job_residual_detected` (a runtime
		//       incident the host can surface)
		//     → latch `job.terminationFailed` so callers reading the
		//       terminal snapshot can read the verdict out-of-band
		//     → DO NOT emit `command_job_terminal_committed` (this
		//       state is terminal but uncommitted — the group is
		//       still on the OS)
		//
		// The previous code (correction04) emitted
		// `terminal_committed` regardless of postcondition — that
		// was a bookkeeping observation, NOT conservation. The
		// `gone`-gating introduced here turns bookkeeping into
		// causality: a terminal job is one whose kernel-level
		// invariant was proven at the moment of finalization.
		const savedPgid = readPgidFromSupervisor(job.process)
		let postcondition: "gone" | "alive" | "eperm" | "unknown" | undefined
		if (typeof savedPgid === "number" && savedPgid > 0) {
			postcondition = this.terminalPostconditionProbe(savedPgid)
			this.emitCommandJobLifecycle({
				event: "command_job_primary_group_cleanup",
				jobId: job.id,
				pgid: savedPgid,
				postcondition,
				jobState: state,
				tsMs: Date.now(),
			})
		} else {
			// No PGID resolvable — fail-closed. POSIX paths should
			// always carry a pgid from the supervisor, but this
			// branch keeps the invariant statement correct on
			// malformed supervisors or non-POSIX substrates.
			postcondition = undefined
			job.terminationFailed = "pgid_unset"
		}
		// Resolve the terminal state: clean (caller's `state`) vs
		// `containment_failed`. The `gone` postcondition is the
		// ONLY verdict compatible with the bounded invariant
		// `CLEAN_TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE` —
		// any other verdict OVERWRITES the caller's clean terminal
		// state with `containment_failed` so the state machine
		// is honest (correction06).
		const invariantProven = postcondition === "gone"
		let terminalState: CommandJobState
		if (invariantProven) {
			terminalState = state
		} else {
			// Map the kernel verdict onto a structured failure
			// reason so the host sink (and `CommandJobSnapshot`
			// consumers) can read the verdict out-of-band.
			if (job.terminationFailed === undefined) {
				if (postcondition === "alive") job.terminationFailed = "substrate_alive"
				else if (postcondition === "eperm") job.terminationFailed = "substrate_eperm"
				else if (postcondition === "unknown") job.terminationFailed = "substrate_unknown"
			}
			terminalState = "containment_failed"
		}
		job.state = terminalState
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
		// emit `command_job_residual_detected` on the failure path —
		// a pre-delete observation of the kernel state. The gauge
		// in this event is the PRE-delete count, NOT the
		// gauge-conservation event (correction06 adds
		// `command_job_containment_failed` for that).
		if (!invariantProven) {
			const residualCount = this.active.size
			this.emitCommandJobLifecycle({
				event: "command_job_residual_detected",
				jobId: job.id,
				pgid: typeof savedPgid === "number" ? savedPgid : 0,
				residualJobs: residualCount,
				jobState: terminalState,
				tsMs: Date.now(),
			})
		}
		// INVARIANT (timer hygiene): clear any leftover watchdog / abort
		// listener so high command volume doesn't accumulate timers.
		if (job.deadlineTimer) {
			clearTimeout(job.deadlineTimer)
			job.deadlineTimer = undefined
		}
		if (job.abortListener && job.abortSignal) {
			job.abortSignal.removeEventListener("abort", job.abortListener)
			job.abortSignal = undefined
			job.abortListener = undefined
		}
		// ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01:
		// Run the sandbox cleanup hook best-effort. For Seatbelt this
		// removes the profile temp dir. MUST NOT alter the command's
		// exit classification — failures are swallowed and `state` /
		// `signal` already reflect the original command outcome.
		if (job.sandboxCleanup) {
			const cleanup = job.sandboxCleanup
			job.sandboxCleanup = undefined
			void cleanup().catch(() => {
				// Swallow: cleanup failures are non-fatal.
			})
		}
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
		// Release the helper-owned job slot best-effort. The helper
		// reaps when the leader dies regardless, but explicit
		// release keeps the active_job_count metric accurate and
		// frees the slot immediately on natural completion.
		if (job.helperOwnedCapability) {
			void this.releaseHelperOwnedJob(job)
		}
		// Move from active → terminal (bounded FIFO).
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: capture
		// the cardinality transition at the manager's mutation seam.
		// The check happens BEFORE `this.active.delete` so the value
		// is race-safe under concurrent terminal-completions — between
		// this check and the delete no other code can run
		// (single-threaded JS). After this delete, `wasBecomingIdle`
		// is true iff this was a >0->0 cardinality transition. The
		// runner uses this flag directly instead of a post-hoc
		// `getActiveJobIds()` count.
		const wasBecomingIdle = this.active.size === 1
		// Move from active → terminal (bounded FIFO). The PGID
		// postcondition probe was emitted above (before
		// terminal_committed) so the saved PGID is still on the
		// supervisor at this point. active.delete below is the
		// final mutation.
		this.active.delete(job.id)
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction07 / Factory
		// HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
		//
		// emit `command_job_terminal_committed` AFTER the
		// active-map delete on the clean path. Previously the
		// emit happened BEFORE the delete (correction05) — the
		// lifecycle emitter's `getActiveCommandJobs().length`
		// enrichment then captured the PRE-delete gauge (N) for a
		// job that just shrunk the active map from N → N-1, leaving
		// the header's `⎇ N` off-by-one for the entire end-of-life
		// window. We now mirror the post-delete emit ordering on
		// the failure path (correction06):
		//   1. command_job_primary_group_cleanup  (probe)
		//   2. command_job_residual_detected      (pre-delete obs, failure path only)
		//   3. active.delete                      (mutation)
		//   4. command_job_terminal_committed     (post-delete — clean path) OR
		//      command_job_containment_failed     (post-delete — failure path, correction06)
		if (invariantProven) {
			this.emitCommandJobLifecycle({
				event: "command_job_terminal_committed",
				jobId: job.id,
				terminationReason: job.terminationReason,
				exitCode: job.exitCode ?? null,
				signal: job.signal ?? null,
				jobState: terminalState,
				tsMs: Date.now(),
			})
		}
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
		// (correction06 / Factory
		// HALT_PRIMARY_PGID_CONSERVATION_STILL_NOT_ENFORCED):
		//
		// emit `command_job_containment_failed` AFTER the
		// active-map delete on the failure path. This is the
		// post-delete gauge-conservation event — it carries the
		// live ownership gauge (post-delete, via the emitter's
		// `this.active.size` enrichment) so the tracker decrements
		// from N to N-1, closing the stale-`⎇ N` bug correction05
		// introduced.
		//
		// On the clean path this event is NOT emitted — the
		// `command_job_terminal_committed` event already carries
		// the post-delete gauge and the tracker decrements off
		// it.
		//
		// The `pgid` and `containmentFailed` fields let consumers
		// correlate this event with the earlier
		// `command_job_primary_group_cleanup.postcondition` and
		// `command_job_residual_detected` events on the same job.
		if (!invariantProven && job.terminationFailed) {
			// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
			// (correction07 / Factory
			// HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
			//
			// The previous guard required `typeof savedPgid === "number"`,
			// which silently skipped the `pgid_unset` branch
			// (line 2289 — supervisor never exposed a numeric
			// PGID). On that path, the tracker would receive
			// `command_job_primary_group_cleanup` carrying
			// `postcondition: undefined` but NO post-delete
			// gauge-conservation event, leaving the live
			// ownership gauge stuck at N instead of decrementing
			// to N-1. Loosen the guard to fire whenever the
			// containment verdict is non-clean AND a structured
			// `terminationFailed` reason was latched. `pgid` is
			// now optional in the event type so `pgid_unset`
			// reaches the tracker without coercion.
			this.emitCommandJobLifecycle({
				event: "command_job_containment_failed",
				jobId: job.id,
				pgid: typeof savedPgid === "number" ? savedPgid : undefined,
				containmentFailed: job.terminationFailed,
				jobState: "containment_failed",
				tsMs: Date.now(),
			})
		}
		// Resolve the terminal-transition promise with the captured
		// flag. This is the single source of truth for the
		// >0->0 transition identity; the runner reads the flag
		// from the resolved value.
		if (job.terminalTransitionResolve) {
			job.terminalTransitionResolve({ becameIdle: wasBecomingIdle })
			job.terminalTransitionResolve = undefined
		}
		this.terminal.set(job.id, job)
		this.terminalOrder.push(job.id)
		while (this.terminalOrder.length > this.maxTerminalJobs) {
			const evictId = this.terminalOrder.shift()
			if (evictId) {
				this.terminal.delete(evictId)
				this.exitTransitions.delete(evictId)
				// Also drop the terminal-transition promise so the
				// map doesn't grow unbounded for the lifetime of the
				// manager.
				this.terminalTransitions.delete(evictId)
			}
		}
	}

	/**
	 * Observe a job's state. If still running, blocks up to `waitMs`
	 * (clamped to MAX_STATUS_WAIT_MS) for the first terminal transition.
	 *
	 * Returns a structured error for unknown jobs (NOT a thrown exception
	 * — the caller needs a deterministic shape to surface to the model).
	 *
	 * Polling pattern is bounded: each call creates its own ad-hoc timer
	 * and races against the job's `exitTransitions` promise; the per-call
	 * promise is dropped once the call returns. Repeated polling therefore
	 * does NOT accumulate waiters on the job.
	 */
	async status(
		options: StatusCommandJobOptions,
	): Promise<{ ok: true; snapshot: CommandJobSnapshot } | { ok: false; code: "unknown_job" }> {
		const job = this.lookup(options.jobId)
		if (!job) {
			return { ok: false, code: "unknown_job" }
		}
		const waitMs = Math.max(0, Math.min(options.waitMs, MAX_STATUS_WAIT_MS))

		if (job.state !== "running") {
			return { ok: true, snapshot: projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars) }
		}

		if (waitMs === 0) {
			return { ok: true, snapshot: projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars) }
		}

		// Race the existing exitTransition promise against a one-shot
		// timer. No mutable waiter list — the timer is local to this
		// call and never registered on the job. Clear the timer
		// reference once the race resolves so it does not stay
		// registered for the full waitMs duration when the exit wins.
		let timer: NodeJS.Timeout | undefined
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, waitMs)
			timer.unref()
		})
		await Promise.race([this.exitTransitions.get(job.id) ?? Promise.resolve(), timeout])
		if (timer) {
			clearTimeout(timer)
		}
		return { ok: true, snapshot: projectResponseSnapshot(snapshot(job), job.maxResponseOutputChars) }
	}

	/**
	 * Cancel a running job. Idempotent: re-cancelling a terminal or
	 * already-cancelled job is a no-op.
	 *
	 * CORRECTION03 P1: by the time `terminate()` returns, the
	 * process tree has been observed gone (grace + escalation),
	 * `job.process.exit` has resolved, and `finalize()` has set
	 * `job.state` to its canonical terminal value (e.g. "cancelled").
	 * We return that value directly — no synthesis. The earlier
	 * `job.state === "running" ? "cancelled" : job.state` formula
	 * could briefly report "cancelled" while `job.state` was still
	 * "running", since killTree() only sends the kill and does not
	 * await the subsequent close event.
	 */
	async cancel(
		options: CancelCommandJobOptions,
	): Promise<{ ok: true; state: CommandJobState } | { ok: false; code: "unknown_job" }> {
		const job = this.lookup(options.jobId)
		if (!job) {
			return { ok: false, code: "unknown_job" }
		}
		if (job.state !== "running") {
			return { ok: true, state: job.state }
		}
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
		// emit `command_job_terminal_requested` from the public
		// cancel() seam — this is the host's authoritative signal
		// that the user/code WANTS termination. Distinct from
		// `command_job_termination_started`, which fires once the
		// SIGTERM/ESCALATE flow actually begins (and is gated by
		// the FIRST-WRITER-WINS latch so it fires at most once).
		this.emitCommandJobLifecycle({
			event: "command_job_terminal_requested",
			jobId: job.id,
			terminationReason: "cancel",
			jobState: job.state,
			tsMs: Date.now(),
		})
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
		// EPERM-only fallback. terminate() below tries the direct
		// path (kill -pgid SIGTERM) first. On EPERM, the
		// `terminate()` flow consults the registered helper
		// capability and falls back to helper.terminate_owned().
		//
		// We do NOT short-circuit the direct path here; the direct
		// path remains primary because:
		//   - it's free (no IPC)
		//   - it succeeds on any substrate where the helper is not
		//     available (non-macOS, helper restart in flight, etc.)
		// The helper is consulted ONLY on EPERM.
		await this.terminate(job, "cancel")
		return { ok: true, state: job.state }
	}

	private lookup(jobId: string): CommandJob | undefined {
		return this.active.get(jobId) ?? this.terminal.get(jobId)
	}

	get activeCount(): number {
		return this.active.size
	}

	get terminalCount(): number {
		return this.terminal.size
	}

	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: enumerate the active job
	 * ids. Returns a snapshot (Array.from) so the caller can iterate
	 * without holding a reference to the underlying `active` Map. The
	 * host's Cancel button iterates this list to cancel every still-
	 * running background command before tearing down the task.
	 */
	getActiveJobIds(): string[] {
		return Array.from(this.active.keys())
	}

	/**
	 * ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01:
	 * encapsulate the owner identity question.
	 *
	 * Returns true iff at least one job is currently in the
	 * ACTIVE map AND still in the `running` state AND carries
	 * `ownerSessionId === ownerSessionId`. The query does NOT
	 * leak the underlying owner IDs through the return value —
	 * callers receive only the boolean authority answer.
	 *
	 * Encapsulates the internal owner identity rather than
	 * exposing raw ownership IDs broadly. This is the
	 * "consumer asks the authority question; the manager
	 * answers" shape chosen by the bounded contract
	 * correction at commit 661780875.
	 *
	 * Truth table (frozen, asserted by
	 * command-job-manager.owner-session-id.test.ts):
	 *
	 *   empty manager                       -> false
	 *   active job in `running` with match  -> true
	 *   active job in `running` no match    -> false
	 *   active job in any terminal state    -> false
	 *     (only `running` counts; even if a job for owner
	 *      X is retained in the terminal map, X does NOT
	 *      own a RUNNING job — X owns only completed
	 *      work, which is authoritatively closed.)
	 *   multiple active jobs, multiple owners
	 *     -> each owner with at least one RUNNING match: true
	 *     -> each owner with no match: false
	 *   `ownerSessionId` arg undefined/empty  -> false
	 *     (defensive: never "finds" an owner when the
	 *      query is degenerate)
	 *
	 * Performance note: this is O(n) over the active map.
	 * Bounded by `activeCount`, which is bounded by the
	 * number of background commands the host has started
	 * but not yet completed (typically a small integer;
	 * multi-job concurrency is rare on the run_commands
	 * path). No indexing by owner is needed for this
	 * minimum contract.
	 */
	hasRunningBackgroundJobForOwner(ownerSessionId: string | undefined): boolean {
		if (typeof ownerSessionId !== "string" || ownerSessionId.length === 0) {
			return false
		}
		for (const job of this.active.values()) {
			if (job.state === "running" && job.ownerSessionId === ownerSessionId) {
				return true
			}
		}
		return false
	}

	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	 *
	 * Snapshot the live ClineMM-owned command containment units.
	 *
	 * Each entry corresponds to a CommandJob whose `state === "running"`
	 * is currently held in the `active` Map. This is the host's
	 * authoritative live-ownership gauge — orthogonal to the
	 * "executables named `node`/`python`/etc. running on the system"
	 * signal (which is diagnostic only and not authoritative for
	 * destruction decisions).
	 *
	 * Returned `pgid` is the same primary PGID the helper LaunchAgent
	 * registered with `process-group.register-owned`. It is what the
	 * production `terminateTree(...)` signals via
	 * `process.kill(-pgid, ...)`. The helper remains the single
	 * source of cleanup authority; this method only projects state.
	 *
	 * `detached` mirrors the spawn shape (`detached: true` -> the
	 * spawned shell is leader of a new process group; this is the
	 * shape CommandJobManager uses). Production code does NOT branch
	 * on this field for cleanup logic; it is exposed only for the
	 * invariant probe and the bounded UI gauge.
	 */
	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
	 * (correction07 / Factory
	 * HALT_ACTIVE_COMMAND_GAUGE_START_DELTA_NOT_OBSERVED):
	 *
	 * Snapshot of "RUNNING jobs retained in `active` with a
	 * numeric, positive PGID resolvable from the supervisor."
	 * NOT the gauge — the gauge is `manager.activeCount` (i.e.
	 * `this.active.size`) and is the value carried by every
	 * lifecycle event as `activeCommandJobs`. The two readings
	 * agree when the manager is idle (both 0) and after a job
	 * finalizes (the job leaves `active` for `terminal`); they
	 * diverge mid-emission only when a job is in `active` but
	 * NOT `running` (e.g. a corner case during finalize), which
	 * the gauge includes and this filtered view does not.
	 *
	 * The filtered view is the canonical input to
	 * `probeOwnedGroups()` and to the bounded UI rendering of
	 * "running background commands". It is NOT the gauge.
	 */
	getActiveCommandJobs(): ReadonlyArray<{
		readonly jobId: string
		readonly pgid: number
		readonly detached: boolean
		readonly startedAtMs: number
	}> {
		const out: { jobId: string; pgid: number; detached: boolean; startedAtMs: number }[] = []
		for (const job of this.active.values()) {
			if (job.state !== "running") continue
			const pgid = readPgidFromSupervisor(job.process)
			if (typeof pgid !== "number" || pgid <= 0) continue
			out.push({
				jobId: job.id,
				pgid,
				detached: true,
				startedAtMs: job.startedAtMs,
			})
		}
		return out
	}

	/**
	 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
	 *
	 * Postcondition probe for the cleanup invariant.
	 *
	 * For every active owned job, probe the kernel with
	 * `kill(-pgid, 0)` and classify the result. The probe is a
	 * read-only assertion (no signal is delivered); the helper
	 * remains the only authority for cleanup decisions.
	 *
	 * Return shape is a per-job tuple so a UI or test can render
	 * "X / Y owned groups confirmed gone" without rescanning the
	 * active Map. The probe is best-effort: a process whose PGID
	 * has been reaped AND whose PID has been reused may produce a
	 * misleading result; production callers MUST combine this probe
	 * with the live `ps` census for diagnostic purposes
	 * (see §16 of the ACT spec — destructive decisions may not rely
	 * on `ps`).
	 *
	 * The implementation is pure-JS: it reads the supervisor's PGID
	 * via the existing `readPgidFromSupervisor` helper, invokes
	 * `process.kill(-pgid, 0)` synchronously, and classifies the
	 * return value as `gone` (ESRCH), `alive` (rc=0), or `eperm`
	 * (EPERM). It is intentionally NOT executed on every keystroke;
	 * the host should call it from the `dispose()` boundary and from
	 * any operator-triggered diagnostic dump.
	 */
	probeOwnedGroups(): ReadonlyArray<{
		readonly jobId: string
		readonly pgid: number
		readonly state: "gone" | "alive" | "eperm" | "unknown"
	}> {
		const out: { jobId: string; pgid: number; state: "gone" | "alive" | "eperm" | "unknown" }[] = []
		for (const job of this.active.values()) {
			if (job.state !== "running") continue
			const pgid = readPgidFromSupervisor(job.process)
			if (typeof pgid !== "number" || pgid <= 0) continue
			// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
			// Classification is fail-closed. Only an unambiguous ESRCH is
			// evidence the PGID is gone. EPERM is a substrate signal
			// (sandbox); unknown errnos are reported as `unknown` so the
			// caller (or DCCT test) does NOT silently read them as gone.
			let state: "gone" | "alive" | "eperm" | "unknown"
			try {
				process.kill(-pgid, 0)
				state = "alive"
			} catch (e) {
				const err = e as NodeJS.ErrnoException
				if (err.code === "ESRCH") state = "gone"
				else if (err.code === "EPERM") state = "eperm"
				else state = "unknown"
			}
			out.push({ jobId: job.id, pgid, state })
		}
		return out
	}

	/**
	 * Dispose the manager: cancel every still-running job and drop all
	 * retained state. Call from the host's session teardown.
	 */
	async dispose(): Promise<void> {
		const activeIds = Array.from(this.active.keys())
		for (const id of activeIds) {
			const job = this.active.get(id)
			if (job) {
				await this.terminate(job, "cancel")
			}
		}
		// ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
		// emit `command_job_residual_detected` per still-residual
		// PGID. The probe runs synchronously after every job was
		// asked to terminate; on the IDE sandboxed shell the probe
		// surfaces EPERM (which is the substrate, not a contract
		// failure). On a non-sandboxed host the probe should report
		// `gone` for every previously-active job. Residual jobs
		// receive the event with `residualJobs` = count of leftover
		// active jobs; the gauge in §13 of the ACT spec renders
		// `⎇! N` when this fires.
		const residualProbe = this.probeOwnedGroups()
		for (const probe of residualProbe) {
			if (probe.state !== "gone") {
				this.emitCommandJobLifecycle({
					event: "command_job_residual_detected",
					jobId: probe.jobId,
					pgid: probe.pgid,
					residualJobs: residualProbe.filter((p) => p.state !== "gone").length,
					jobState: "running",
					tsMs: Date.now(),
				})
			}
		}
		this.active.clear()
		this.terminal.clear()
		this.terminalOrder.length = 0
		this.exitTransitions.clear()
		// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01-CORRECTION03: drop
		// any terminal-transition promises. The terminal maps have
		// been cleared by `terminate()` above (which finalizes each
		// job), so these should be empty in practice; this is a
		// belt-and-suspenders cleanup.
		this.terminalTransitions.clear()
		// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction03):
		// reclaim the per-instance client slot held by `clientOpen()`.
		// Without this, every Codium (VS Code) instance would leak one
		// client slot — the helper's 64-slot client pool would exhaust
		// after ~64 launches. The C-side `handle_client_close` is
		// fail-closed (peer identity check) and reclaims the slot
		// atomically (secure-zeroes the token + sets used=0).
		if (this.helperOwnedPgidProvider && this.helperClientToken) {
			try {
				await this.helperOwnedPgidProvider.clientClose(this.helperClientToken)
			} catch {
				// dispose() is terminal — best-effort. Helper will reap
				// on its own when the connection closes.
			}
			this.helperClientToken = undefined
			this.helperClientTokenPromise = undefined
		}
	}
}

/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
 *
 * Read the canonical PGID from a `SupervisableShellProcess`. The
 * supervisor exposes a `pgid` property on POSIX (POSIX-only field;
 * undefined on Windows). This helper exists so the new
 * `getActiveCommandJobs()` and `probeOwnedGroups()` methods
 * can share a single point of truth for PGID extraction; it also
 * keeps the existing `tryRegisterOwnedJob()` invariant: the PGID
 * the helper verified at registration is the same PGID the probe
 * reads here. Returning `undefined` for any shape mismatch keeps
 * the call sites uniform.
 */
function readPgidFromSupervisor(process: SupervisableShellProcess): number | undefined {
	const p = (process as unknown as { pgid?: number | undefined }).pgid
	if (typeof p !== "number" || p <= 0) return undefined
	return p
}

/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01
 * (correction05 / Factory P0 follow-up):
 *
 * Production PGID postcondition classifier. Calls
 * `process.kill(-pgid, 0)` synchronously and maps the return value
 * onto the fail-closed set:
 *
 *   rc=0        → "alive"   (the OS still has a process in this group)
 *   ESRCH       → "gone"    (the only classification that proves the
 *                            bounded invariant `TERMINAL ⇒ PRIMARY
 *                            OWNED PGID GONE`)
 *   EPERM       → "eperm"   (the kernel refused the probe — the
 *                            bounded invariant is UNPROVEN)
 *   anything    → "unknown" (fail-closed — no silent coerce)
 *
 * The probe MUST run synchronously inside `finalize()` so the
 * saved PGID is still resolvable. No async work, no IPC, no helper
 * — this is the kernel's own verdict on whether the group has been
 * reaped.
 */
function defaultTerminalPostconditionProbe(pgid: number): "gone" | "alive" | "eperm" | "unknown" {
	try {
		process.kill(-pgid, 0)
		return "alive"
	} catch (e) {
		const err = e as NodeJS.ErrnoException
		if (err.code === "ESRCH") return "gone"
		if (err.code === "EPERM") return "eperm"
		return "unknown"
	}
}

/**
 * ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01:
 *
 * Read the canonical root PID from a `SupervisableShellProcess`.
 * Returns `undefined` for any shape mismatch so call sites stay
 * uniform. Mirrors the readPgidFromSupervisor helper above so
 * every extraction of process-identity metadata goes through a
 * single shape check.
 */
function readRootPidFromSupervisor(process: SupervisableShellProcess): number | undefined {
	const p = (process as unknown as { pid?: number | undefined }).pid
	if (typeof p !== "number" || p <= 0) return undefined
	return p
}

/**
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
 *
 * Map a job-level typed `InternalExecutionCapability` into the
 * Seatbelt `CommandCapability.createOnlyRoots` field. Exhaustive
 * switch over the union (spec §17 / §45):
 *
 *   case "filesystem-create-only":
 *     return roots (passed verbatim; the Seatbelt backend
 *     canonicalizes each root again as a fail-closed gate at
 *     prepare() time).
 *   case "factory-binding-probe":
 *   case undefined:
 *     return []  (no narrowing; recon default applies)
 *
 * Future variants of `InternalExecutionCapability` MUST be added
 * here. The TypeScript exhaustiveness check (the trailing
 * `assertNever`) makes a missing branch a compile error, which
 * prevents silent dropping of authority (spec §18: "do not silently
 * drop a capability that was required for the approved
 * execution").
 *
 * Why this is a separate helper:
 *   - testable in isolation
 *   - keeps the sandbox-policy module agnostic of
 *     `InternalExecutionCapability` (the union is policy-layer, not
 *     sandbox-layer)
 *   - future capability variants only need to be wired here, not in
 *     every consumer of CommandJobManager
 */
function capabilityFromJobExecution(capability: InternalExecutionCapability | undefined): readonly string[] {
	switch (capability?.kind) {
		case "filesystem-create-only":
			return capability.roots
		case "factory-binding-probe":
		case undefined:
			return []
		default:
			return assertNeverExhaustiveCapabilityKind(capability)
	}
}

/**
 * TypeScript exhaustiveness helper. If the
 * `InternalExecutionCapability` union grows, this branch becomes
 * unreachable; the `never` annotation then makes the call site
 * a compile error: any caller of `capabilityFromJobExecution`
 * must be updated. Without this, a future variant could silently
 * fall through to `return []`, dropping authority that the
 * approved execution required (spec §18).
 */
function assertNeverExhaustiveCapabilityKind(x: never): never {
	throw new Error(`capabilityFromJobExecution: unhandled InternalExecutionCapability kind ${JSON.stringify(x)}`)
}
