/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01
 *
 * Extension-host runtime for the Round C latency trace.
 *
 * ## What this module is
 *
 * This module connects the EXISTING Round C `LatencyTraceSink`
 * (ACT-CLINEMM-ROUND-C-HARNESS-01/02) to the REAL VSCodium extension host,
 * automatically, for the CLOSED dogfood runtime profile only.
 *
 * HARNESS-02 established the sink and its production hooks (the four wired
 * boundaries: `schema_validation`, `tool_result_delivered`, `provider_ready`
 * and `compaction`, plus the request-lifecycle channels). It did NOT
 * establish a way for the VSCodium extension host to INSTALL the sink — the
 * offline integration tests activated it programmatically:
 *
 * ```ts
 * const sink = new LatencyTraceSink("roundc-live-01")
 * const runtime = new AgentRuntime({ ..., modelBehaviorTraceSink: sink })
 * ```
 *
 * That is the tested SDK mechanism. This module is the missing activation
 * seam for the installed extension, and nothing more.
 *
 * ## Activation contract (frozen)
 *
 *   - The sink is installed ONLY when the authoritative runtime profile is
 *     `dogfood` (`resolveClineMmRuntimeProfile(env) === "dogfood"`, i.e.
 *     `CLINEMM_RUNTIME_PROFILE=dogfood` in the EXTENSION-HOST process
 *     environment, injected by the operator's isolated launcher).
 *   - There is NO new environment variable, NO workspace setting, NO
 *     command-palette toggle and NO public configuration surface. The
 *     dogfood profile is the ONE gate, exactly like the sibling diagnostics
 *     (`applyBackgroundOwnerCorrelationDiagnosticProfile`,
 *     `applyCompletionIncidentFlightRecorderDiagnosticProfile`, ...).
 *   - The PUBLIC profile installs NOTHING. The disabled path has ZERO
 *     state-semantic delta: no sink is constructed, no registry entry is
 *     created, no file is written.
 *
 * ## Scope and correlation (frozen)
 *
 * The registry holds AT MOST ONE live session sink. A new session REPLACES
 * the previous entry, so:
 *
 *   - memory is bounded (one sink, not one per task);
 *   - no cross-task attribution is possible (the replaced sink's trace is
 *     discarded, never merged into the new session's trace).
 *
 * The sink's correlation id is the REAL session id, so the exported trace's
 * `correlationId` joins to the session that produced it. The sink is
 * installed at the SAME seam that installs the extension's existing
 * `modelBehaviorTraceSink` (`VscodeSessionHost.prepareStartSessionInput`),
 * which is the REAL SDK runtime construction path — not a separate
 * diagnostic runtime.
 *
 * ## Privacy (frozen)
 *
 * The trace itself carries only ALLOWLISTED metadata: identifiers, counts,
 * sizes, digests and bounded classifications. The SDK's
 * `sanitizeLatencyMetadata` DROPS every non-allowlisted field, and
 * `skipReason` is persisted only as a BOUNDED classification — never the
 * raw diagnostic text. No prompt, command, tool-result content,
 * credential or raw diagnostic text can reach the artifact through this
 * path.
 *
 * ## Artifact
 *
 * The dump writes ONE JSON document to
 * `<globalStorageUri>/roundc-latency-trace.json` — the extension-owned,
 * profile-isolated diagnostic storage convention used by the sibling
 * diagnostics (the ring modules and their `*-runtime.ts` dump adapters).
 * The dump is UNCONDITIONAL (the operator can always inspect what was
 * captured) and it does NOT clear the registry.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { type LatencyTrace, LatencyTraceSink } from "@cline/core/internal/latency-trace"
import type { ModelBehaviorTraceSink } from "@cline/shared"

/**
 * The dump filename under `context.globalStorageUri`.
 */
export const ROUNDC_LATENCY_TRACE_DUMP_FILE = "roundc-latency-trace.json"

/**
 * The minimal `vscode.ExtensionContext` shape this module needs.
 *
 * Structural typing keeps the module testable without the VS Code host.
 */
export interface RoundcLatencyTraceContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

/**
 * The ONE live session sink.
 *
 * `undefined` when the diagnostic is OFF (public profile) or when no
 * session has started yet.
 */
let activeSink: LatencyTraceSink | undefined

/**
 * The session id the active sink belongs to.
 *
 * Kept beside the sink so the exported artifact can state WHICH session
 * the trace came from without the reader having to infer it.
 */
let activeSessionId: string | undefined

/**
 * The dogfood activation bit.
 *
 * `false` by default, so a PUBLIC install that somehow reaches this module
 * without the activation helper still installs NOTHING. The activation
 * helper is the ONLY writer.
 */
let enabled = false

/**
 * True when the Round C latency trace is armed.
 *
 * A pure, synchronous read of the in-memory enable bit — safe on hot
 * paths.
 */
export function isRoundcLatencyTraceEnabled(): boolean {
	return enabled
}

/**
 * Arm (or disarm) the Round C latency trace.
 *
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01: the ONLY caller is the central
 * dogfood diagnostic-profile activation helper
 * (`applyRoundcLatencyTraceDiagnosticProfile`), which arms the trace when
 * the authoritative runtime profile is `dogfood` and disarms it otherwise.
 *
 * Disarming ALSO drops the active sink: a public install can never keep a
 * live trace from a previous dogfood run in the same process.
 */
export function setRoundcLatencyTraceEnabled(next: boolean): void {
	if (enabled === next) {
		return
	}
	enabled = next
	if (!enabled) {
		activeSink = undefined
		activeSessionId = undefined
	}
}

/**
 * Install the Round C latency sink for ONE session.
 *
 * Called from the REAL SDK runtime construction seam
 * (`VscodeSessionHost.prepareStartSessionInput`) with the session's
 * canonical session id.
 *
 * Returns the sink to attach to the runtime config, or `undefined` when
 * the diagnostic is OFF. When the diagnostic is OFF this function performs
 * NO allocation, NO registry mutation and NO I/O — the disabled path has
 * zero state-semantic delta.
 *
 * Installing a sink for a NEW session REPLACES the previous one. The
 * replaced sink's trace is discarded (not merged), so no cross-task
 * attribution is possible and the registry stays bounded at ONE entry.
 */
export function installRoundcLatencyTraceSink(sessionId: string | undefined): ModelBehaviorTraceSink | undefined {
	if (!enabled) {
		return undefined
	}
	const correlationId = normalizeCorrelationId(sessionId)
	activeSink = new LatencyTraceSink(correlationId)
	activeSessionId = correlationId
	return activeSink
}

/**
 * The correlation id used for the active session's sink.
 *
 * A session id is preferred. When the session id is missing (the SDK did
 * not supply one), a stable, NON-SECRET placeholder is used so the trace
 * is still produced and still states that it was unattributed — rather
 * than silently reporting a fabricated session identity.
 */
function normalizeCorrelationId(sessionId: string | undefined): string {
	const trimmed = sessionId?.trim()
	if (trimmed) {
		return trimmed
	}
	return "roundc-unattributed-session"
}

/**
 * The captured trace, plus the session it belongs to.
 *
 * `undefined` when no session sink is live (public profile, or no session
 * has started yet).
 */
export interface RoundcLatencyTraceSnapshot {
	readonly sessionId: string
	readonly trace: LatencyTrace
}

/**
 * Read the currently captured trace.
 *
 * The trace is a SNAPSHOT of the live sink: it can be read WHILE the task
 * is still running, which is what the operator dump command needs.
 */
export function getRoundcLatencyTraceSnapshot(): RoundcLatencyTraceSnapshot | undefined {
	if (!enabled || !activeSink) {
		return undefined
	}
	return {
		sessionId: activeSessionId ?? activeSink.correlationId,
		trace: activeSink.getTrace(),
	}
}

/**
 * The exported artifact's document shape.
 *
 * Every field is either an identifier, a count, a timestamp, a
 * classification or a digest. There is no free-form text field and no
 * content field, so the artifact cannot smuggle raw content even if a
 * future change widened the SDK's allowlist.
 */
export interface RoundcLatencyTraceArtifact {
	readonly schema: "cline.roundc-latency-trace.v1"
	/** The session the trace belongs to. */
	readonly sessionId: string
	/** The trace's own correlation id (the session id). */
	readonly correlationId: string
	/** The runtime profile the trace was captured under. */
	readonly captureProfile: "dogfood"
	/** The wall-clock ISO instant the artifact was written. */
	readonly exportedAtIso: string
	/** The number of recorded boundary events. */
	readonly eventCount: number
	/** The number of measured stages. */
	readonly stageCount: number
	/** The number of explicitly unavailable measurements. */
	readonly unavailableCount: number
	/** The number of trace-integrity failures. */
	readonly integrityFailureCount: number
	/** The trace's wall-clock duration in milliseconds. */
	readonly wallClockMs: number
	/** Whether any two spans overlapped in time. */
	readonly overlapping: boolean
	/** The recorded boundary events (allowlisted metadata only). */
	readonly events: LatencyTrace["events"]
	/** The measured stages. */
	readonly stages: LatencyTrace["stages"]
	/** The measurements that were not available, and why. */
	readonly unavailable: LatencyTrace["unavailable"]
	/** The trace-integrity failures. */
	readonly integrityFailures: LatencyTrace["integrityFailures"]
}

/**
 * Build the exported artifact from the live snapshot.
 *
 * `undefined` when no trace is live — the caller then writes an explicit
 * empty document so the operator can tell "not captured" from "extension
 * not running".
 */
export function buildRoundcLatencyTraceArtifact(): RoundcLatencyTraceArtifact | undefined {
	const snapshot = getRoundcLatencyTraceSnapshot()
	if (!snapshot) {
		return undefined
	}
	const { trace } = snapshot
	return {
		schema: "cline.roundc-latency-trace.v1",
		sessionId: snapshot.sessionId,
		correlationId: trace.correlationId,
		captureProfile: "dogfood",
		exportedAtIso: new Date().toISOString(),
		eventCount: trace.events.length,
		stageCount: trace.stages.length,
		unavailableCount: trace.unavailable.length,
		integrityFailureCount: trace.integrityFailures.length,
		wallClockMs: trace.wallClockMs,
		overlapping: trace.overlapping,
		events: trace.events,
		stages: trace.stages,
		unavailable: trace.unavailable,
		integrityFailures: trace.integrityFailures,
	}
}

/**
 * Dump the captured Round C latency trace to a private local JSON
 * artifact under the extension-owned global storage directory.
 *
 * The dump is UNCONDITIONAL with respect to the CAPTURE state: the
 * operator can always inspect what was captured, even after the trace was
 * disabled. It never CLEARS the registry (dump != clear).
 *
 * Returns the absolute path, the artifact's event count and whether a
 * trace was actually captured.
 */
export async function dumpRoundcLatencyTrace(
	context: RoundcLatencyTraceContext,
): Promise<{ file: string; eventCount: number; captured: boolean }> {
	const dir = context.globalStorageUri.fsPath
	await mkdir(dir, { recursive: true })
	const file = join(dir, ROUNDC_LATENCY_TRACE_DUMP_FILE)
	const artifact = buildRoundcLatencyTraceArtifact()
	if (!artifact) {
		// Write an explicit empty document so the operator can tell
		// "nothing captured" from "extension not running".
		await writeFile(
			file,
			`${JSON.stringify(
				{
					schema: "cline.roundc-latency-trace.v1",
					captured: false,
					reason: "no session latency trace is live in this extension host",
				},
				null,
				2,
			)}\n`,
			"utf8",
		)
		return { file, eventCount: 0, captured: false }
	}
	await writeFile(file, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
	return { file, eventCount: artifact.eventCount, captured: true }
}

/**
 * Test seam: reset the module state between tests so successive runs do
 * not bleed. Production code never calls this.
 */
export function _resetRoundcLatencyTraceForTests(): void {
	enabled = false
	activeSink = undefined
	activeSessionId = undefined
}

/**
 * The `ModelBehaviorTraceSink` channel names this module fans out.
 *
 * The list is the SDK's `ModelBehaviorTraceSink` interface, VERBATIM. It
 * is declared here (rather than derived) because the interface is a
 * TypeScript type — there is no runtime reflection of it — and because an
 * explicitly enumerated list is auditable: a reviewer can compare it
 * against `sdk/packages/shared/src/runtime/model-behavior-trace.ts` and
 * see that no channel is missing and no channel is invented.
 *
 * `COMPOSABLE_SINK_CHANNELS` is the SINGLE source of truth for the
 * fan-out; `composeModelBehaviorTraceSinks` below is generic over it.
 */
export const COMPOSABLE_SINK_CHANNELS = [
	"onEffectiveModelConfig",
	"onModelRequestStart",
	"onRequestPrepared",
	"onProviderRequestSubmitted",
	"onProviderRequestCompleted",
	"onModelRequestFinish",
	"onModelRequestError",
	"onModelRequestAbort",
	"onToolStart",
	"onToolFinish",
	"onSchemaValidation",
	"onToolResultDelivered",
	"onProviderReady",
	"onLoopVerdict",
	"onCompactionDiagnostics",
	"onCompactionCompleted",
	"onRunTerminated",
	"onRunAbortRequested",
] as const satisfies readonly (keyof ModelBehaviorTraceSink)[]

/**
 * Compose two `ModelBehaviorTraceSink`s into one.
 *
 * ## Why this exists
 *
 * The extension host installs TWO sinks into the REAL SDK runtime:
 *
 *   - the extension's existing `modelBehaviorTraceSink` (the model behavior
 *     flight recorder, ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01), and
 *   - the Round C `LatencyTraceSink` (ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01).
 *
 * The SDK config carries ONE `modelBehaviorTraceSink`, so they have to be
 * composed or one would silently replace the other. Composition is the
 * correct answer: the two sinks observe DIFFERENT aspects of the SAME
 * production boundaries, and neither replaces the other.
 *
 * ## Failure isolation (load-bearing)
 *
 * Each channel is invoked through a `try`/`catch` wrapper, so a throw in
 * EITHER sink cannot break the runtime or prevent the OTHER sink from
 * observing the same event. The Round C diagnostic must never be able to
 * affect normal execution — that is the "preserve failure isolation"
 * requirement.
 *
 * ## `isTraceEnabled`
 *
 * The composed sink reports `true` when EITHER constituent is armed. The
 * SDK uses this bit to take a SYNCHRONOUS fast path (skipping the
 * fingerprint `await`) when NOBODY is listening, so it must be the OR of
 * the two — never one of them alone.
 */
export function composeModelBehaviorTraceSinks(
	primary: ModelBehaviorTraceSink,
	secondary: ModelBehaviorTraceSink,
): ModelBehaviorTraceSink {
	const composed: Record<string, unknown> = {}
	for (const channel of COMPOSABLE_SINK_CHANNELS) {
		const primaryHandler = primary[channel]
		const secondaryHandler = secondary[channel]
		if (typeof primaryHandler !== "function" && typeof secondaryHandler !== "function") {
			continue
		}
		composed[channel] = (observation: never) => {
			// Each side is isolated from the other: a throw in one must
			// not prevent the other from observing the same event.
			if (typeof primaryHandler === "function") {
				try {
					;(primaryHandler as (o: unknown) => void).call(primary, observation)
				} catch {
					// Failure isolation: a broken recorder must never break
					// production, and must never break the other sink.
				}
			}
			if (typeof secondaryHandler === "function") {
				try {
					;(secondaryHandler as (o: unknown) => void).call(secondary, observation)
				} catch {
					// Failure isolation (see above).
				}
			}
		}
	}
	const primaryEnabled = primary.isTraceEnabled
	const secondaryEnabled = secondary.isTraceEnabled
	if (typeof primaryEnabled === "function" || typeof secondaryEnabled === "function") {
		composed.isTraceEnabled = () => {
			if (typeof primaryEnabled === "function") {
				try {
					if (primaryEnabled.call(primary)) {
						return true
					}
				} catch {
					// Failure isolation: treat an unreadable enable bit as
					// "not enabled" for this side.
				}
			}
			if (typeof secondaryEnabled === "function") {
				try {
					if (secondaryEnabled.call(secondary)) {
						return true
					}
				} catch {
					// Failure isolation (see above).
				}
			}
			return false
		}
	}
	return composed as ModelBehaviorTraceSink
}
