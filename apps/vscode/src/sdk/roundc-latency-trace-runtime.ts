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
// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the installed extension VERSION.
//
// The version is the other half of the build binding: a bundle digest
// alone does not say WHICH release produced it.
import { ExtensionRegistryInfo } from "../registry"
// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the CANONICAL installed-bundle
// identity resolver.
//
// It is the SAME resolver the extension-host allocation profiler uses, so
// both diagnostics state the SAME artifact identity — the Round C trace
// does not introduce a second, divergent notion of "which bytes ran".
import { resolveInstalledBundleIdentityCached } from "./extension-host-allocation-profiler-runtime"

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
	const sink = new LatencyTraceSink(correlationId)
	activeSink = sink
	activeSessionId = correlationId
	// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — a NEW session starts with a NEW
	// identity. The previous session's observed identity is discarded with
	// its trace, so an identity can never be attributed to the wrong run.
	activeIdentity = emptyIdentity()
	return sink
}

/**
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the identity OBSERVER.
 *
 * The observer wraps the COMPOSED sink, so it sees every channel that
 * EITHER constituent implements — including `onEffectiveModelConfig`,
 * which the existing model-behavior recorder implements and the latency
 * sink does not.
 *
 * It reads the model identity from the EXISTING production channels:
 *
 *   - `onProviderRequestSubmitted` — the provider FAMILY and the
 *     CONFIGURED (requested) model id. This is the configured value, so
 *     it is recorded as `CONFIGURED`, never as a served receipt.
 *   - `onEffectiveModelConfig` — the effective reasoning / sampling
 *     settings and the output limit.
 *   - `onCompactionDiagnostics` — the EFFECTIVE request-time context
 *     budget, resolved by the production compaction resolver.
 *
 * The provider-REPORTED model id and the quantization are NOT taken from
 * these channels: the SDK does not surface them at these boundaries, so
 * they stay `UNAVAILABLE_FROM_TRACE` unless a future channel reports
 * them explicitly. They are never inferred from the model id.
 *
 * The wrapper is failure-isolated — a throw in the observer cannot
 * break the runtime or prevent either sink from observing the event.
 */
export function observeRoundcCaptureIdentity(sink: ModelBehaviorTraceSink): ModelBehaviorTraceSink {
	const wrapped: Record<string, unknown> = {}
	for (const channel of OBSERVED_IDENTITY_CHANNELS) {
		const original = (sink as unknown as Record<string, unknown>)[channel]
		wrapped[channel] = (observation: { payload: Record<string, unknown> } & Record<string, unknown>): void => {
			try {
				observeIdentityFromObservation(channel, observation)
			} catch {
				// Failure isolation: the observer must never break the
				// runtime or the sink.
			}
			if (typeof original === "function") {
				;(original as (o: unknown) => void).call(sink, observation)
			}
		}
	}
	// Every OTHER channel is forwarded unchanged.
	for (const channel of COMPOSABLE_SINK_CHANNELS) {
		// The identity channels are observed (and wrapped) above. The
		// comparison is widened to `string` because `COMPOSABLE_SINK_CHANNELS`
		// is a SUPERSET of the identity channels — `includes` on the narrow
		// tuple would reject every other channel at the type level.
		if ((OBSERVED_IDENTITY_CHANNELS as readonly string[]).includes(channel)) {
			continue
		}
		const original = (sink as unknown as Record<string, unknown>)[channel]
		if (typeof original !== "function") {
			continue
		}
		wrapped[channel] = (observation: never): void => {
			;(original as (o: unknown) => void).call(sink, observation)
		}
	}
	for (const operation of COMPOSABLE_SINK_FINGERPRINTS) {
		const original = (sink as unknown as Record<string, unknown>)[operation]
		if (typeof original !== "function") {
			continue
		}
		wrapped[operation] = (...args: unknown[]): unknown => {
			return (original as (...a: unknown[]) => unknown).call(sink, ...args)
		}
	}
	const enableBit = (sink as unknown as Record<string, unknown>).isTraceEnabled
	if (typeof enableBit === "function") {
		wrapped.isTraceEnabled = (): boolean => {
			try {
				return (enableBit as () => boolean).call(sink)
			} catch {
				return false
			}
		}
	}
	return wrapped as ModelBehaviorTraceSink
}

/**
 * The channels the identity observer reads.
 *
 * Each one is an EXISTING production channel that already reports the
 * runtime's own authoritative facts. No new channel is introduced.
 */
const OBSERVED_IDENTITY_CHANNELS = ["onProviderRequestSubmitted", "onEffectiveModelConfig", "onCompactionDiagnostics"] as const

/**
 * Extract the observed identity fields from one observation.
 *
 * Every field is read from the observation's OWN payload — the runtime's
 * authoritative facts — and never from a config file, a model catalog or
 * a family-name heuristic.
 */
function observeIdentityFromObservation(
	channel: string,
	observation: { payload: Record<string, unknown> } & Record<string, unknown>,
): void {
	const payload = observation.payload ?? {}
	const providerId = typeof payload.providerId === "string" ? payload.providerId : undefined
	const modelId = typeof payload.modelId === "string" ? payload.modelId : undefined
	if (channel === "onProviderRequestSubmitted") {
		observeIdentityFragment({
			...(providerId !== undefined ? { providerFamily: providerId } : {}),
			...(modelId !== undefined ? { requestedModelId: modelId, requestedModelIdSource: "CONFIGURED" } : {}),
		})
		return
	}
	if (channel === "onEffectiveModelConfig") {
		const reasoningEffort = typeof payload.reasoningEffort === "string" ? payload.reasoningEffort : undefined
		const thinkingEnabled = typeof payload.thinkingEnabled === "boolean" ? payload.thinkingEnabled : undefined
		const maxOutputTokens =
			typeof payload.maxOutputTokens === "number" && Number.isFinite(payload.maxOutputTokens)
				? payload.maxOutputTokens
				: undefined
		observeIdentityFragment({
			...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
			...(thinkingEnabled !== undefined ? { thinkingEnabled } : {}),
			...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
		})
		return
	}
	if (channel === "onCompactionDiagnostics") {
		// The production compaction resolver resolved the EFFECTIVE budget
		// for THIS request — this is the request-time value, not a
		// build-time constant.
		const budget =
			typeof payload.effectiveMaxInputTokens === "number" && Number.isFinite(payload.effectiveMaxInputTokens)
				? payload.effectiveMaxInputTokens
				: undefined
		observeIdentityFragment({
			...(budget !== undefined ? { effectiveContextBudgetTokens: budget } : {}),
		})
	}
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
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the CAPTURE IDENTITY RECORD.
 *
 * ## Why the trace needs one
 *
 * A latency trace measures a RUN. To compare two runs, a reader must know
 * that they measured the SAME software, the SAME model and the SAME
 * inference configuration. The pre-correction trace carried none of that:
 * it stated only the session id and the profile, so a "5.57x speedup"
 * claim could not be attributed to any particular cause.
 *
 * ## The truthfulness rules (frozen)
 *
 *   - The REQUESTED model id and the EFFECTIVE model id are DISTINCT
 *     fields. The requested id is the configured value; the effective id
 *     is what the provider REPORTED. They are never conflated.
 *
 *   - The quantization is recorded ONLY when the provider or the SDK
 *     explicitly supplied it. It is NEVER inferred from a model-family
 *     name: a model id that happens to contain "iq3" is a REQUESTED
 *     identifier, not a served-quantization receipt.
 *
 *   - A field the trace cannot observe is recorded as
 *     `UNAVAILABLE_FROM_TRACE` — never as a guess, and never as a
 *     plausible-looking default.
 *
 *   - NO credential, NO prompt, NO tool command, NO model response and no
 *     credential-bearing URL is ever placed in this record. Every field
 *     is an identifier, a digest, a count or a bounded classification.
 */
export interface RoundcLatencyTraceIdentity {
	/** The capture schema version — explicit, so an old artifact is recognisable. */
	readonly captureSchemaVersion: "cline.roundc-latency-trace.v1"
	/** The runtime profile that armed the capture. */
	readonly runtimeProfile: "dogfood"
	/**
	 * The exact Git identity of the SOURCE the artifact was built from.
	 *
	 * `UNAVAILABLE_FROM_TRACE` when the installed extension has no `.git`
	 * (the normal installed-VSIX case) — the bundle digest below is then
	 * the load-bearing identity.
	 */
	readonly sourceHead: string
	/** The installed extension version, independently checked. */
	readonly extensionVersion: string
	/**
	 * The SHA-256 of the installed bundle — the exact install-artifact
	 * receipt. `UNAVAILABLE_FROM_TRACE` when the bundle could not be read.
	 */
	readonly extensionBundleSha256: string
	/** The provider FAMILY actually configured (e.g. `openai-compatible`). */
	readonly providerFamily: string
	/** The CONFIGURED model id, and where that value came from. */
	readonly requestedModelId: string
	readonly requestedModelIdSource: "CONFIGURED" | "UNAVAILABLE_FROM_TRACE"
	/**
	 * The model id the PROVIDER REPORTED as served.
	 *
	 * `UNAVAILABLE_FROM_TRACE` when the provider did not report one. The
	 * requested id is NEVER substituted for it.
	 */
	readonly effectiveModelId: string
	readonly effectiveModelIdSource: "PROVIDER_REPORTED" | "UNAVAILABLE_FROM_TRACE"
	/**
	 * The quantization, ONLY when explicitly available.
	 *
	 * `UNAVAILABLE_FROM_TRACE` otherwise — never inferred from the model
	 * id.
	 */
	readonly quantization: string
	readonly quantizationSource: "PROVIDER_REPORTED" | "UNAVAILABLE_FROM_TRACE"
	/** The EFFECTIVE request-time context budget, in tokens. */
	readonly effectiveContextBudgetTokens: number | "UNAVAILABLE_FROM_TRACE"
	/** The effective sampling / reasoning settings relevant to comparison. */
	readonly reasoningEffort: string
	readonly thinkingEnabled: boolean | "UNAVAILABLE_FROM_TRACE"
	readonly maxOutputTokens: number | "UNAVAILABLE_FROM_TRACE"
}

/**
 * The marker used for a field the trace could not observe.
 *
 * The same convention the existing model-behavior recorder uses
 * (`recordModelBehaviorTraceEffectiveConfig`), so a reader learns it once.
 */
export const UNAVAILABLE_FROM_TRACE = "UNAVAILABLE_FROM_TRACE" as const

/**
 * The identity a capture starts with: every field UNAVAILABLE except the
 * ones the capture itself knows.
 *
 * The trace then FILLS the observed fields in as the real boundaries
 * report them. A field that is never observed stays UNAVAILABLE, which
 * is the truthful outcome.
 */
function emptyIdentity(): RoundcLatencyTraceIdentity {
	return {
		captureSchemaVersion: "cline.roundc-latency-trace.v1",
		runtimeProfile: "dogfood",
		sourceHead: UNAVAILABLE_FROM_TRACE,
		extensionVersion: UNAVAILABLE_FROM_TRACE,
		extensionBundleSha256: UNAVAILABLE_FROM_TRACE,
		providerFamily: UNAVAILABLE_FROM_TRACE,
		requestedModelId: UNAVAILABLE_FROM_TRACE,
		requestedModelIdSource: "UNAVAILABLE_FROM_TRACE",
		effectiveModelId: UNAVAILABLE_FROM_TRACE,
		effectiveModelIdSource: "UNAVAILABLE_FROM_TRACE",
		quantization: UNAVAILABLE_FROM_TRACE,
		quantizationSource: "UNAVAILABLE_FROM_TRACE",
		effectiveContextBudgetTokens: UNAVAILABLE_FROM_TRACE,
		reasoningEffort: UNAVAILABLE_FROM_TRACE,
		thinkingEnabled: UNAVAILABLE_FROM_TRACE,
		maxOutputTokens: UNAVAILABLE_FROM_TRACE,
	}
}

/**
 * The OBSERVED identity of the live capture.
 *
 * Kept beside the sink so the exported artifact can state WHICH model
 * and WHICH software the trace came from.
 */
let activeIdentity: RoundcLatencyTraceIdentity = emptyIdentity()

/**
 * Merge the OBSERVED identity fields into the live capture's identity.
 *
 * Only fields that were actually OBSERVED are merged: an `undefined`
 * value never overwrites an observed one, and the FIRST observation
 * wins — so the record is stable and explainable.
 */
function observeIdentityFragment(fragment: Partial<RoundcLatencyTraceIdentity>): void {
	for (const [key, value] of Object.entries(fragment)) {
		if (value === undefined) {
			continue
		}
		const current = (activeIdentity as unknown as Record<string, unknown>)[key]
		if (current === UNAVAILABLE_FROM_TRACE) {
			;(activeIdentity as unknown as Record<string, unknown>)[key] = value
		}
	}
}

/**
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — observe the ARTIFACT and SOURCE
 * identity.
 *
 * The SOURCE head is read from the extension's own `.git` when present,
 * and the ARTIFACT digest is the SHA-256 of the bundle that is actually
 * running. Both come from the CANONICAL resolver the allocation profiler
 * uses, so both diagnostics state the SAME identity.
 *
 * The extension VERSION is the other half of the build binding: a bundle
 * digest alone does not say which release produced it.
 *
 * Every field is failure-isolated: an unreadable bundle leaves the field
 * `UNAVAILABLE_FROM_TRACE` rather than failing the dump.
 */
function observeArtifactIdentity(): void {
	try {
		const bundleIdentity = resolveInstalledBundleIdentityCached(__dirname)
		observeIdentityFragment({
			sourceHead: bundleIdentity.sourceHead === "unknown" ? UNAVAILABLE_FROM_TRACE : bundleIdentity.sourceHead,
			extensionBundleSha256:
				bundleIdentity.extensionBundleSha256 === "unknown"
					? UNAVAILABLE_FROM_TRACE
					: bundleIdentity.extensionBundleSha256,
			extensionVersion: ExtensionRegistryInfo.version,
		})
	} catch {
		// Failure isolation: the identity is best-effort metadata, never a
		// reason to fail the dump.
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
	/**
	 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the CAPTURE IDENTITY.
	 *
	 * This is what makes two runs comparable: it states the artifact
	 * bytes, the source commit, the runtime profile and the model
	 * identity — or states, truthfully, that the trace could not observe
	 * one of them.
	 */
	readonly identity: RoundcLatencyTraceIdentity
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
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the completeness metadata.
	 *
	 * The capture is BOUNDED. When `truncation.truncated` is true, the
	 * retained events are only the MOST RECENT window and observations were
	 * dropped — the artifact says so explicitly rather than presenting a
	 * partial trace as a complete one.
	 */
	readonly truncation: LatencyTrace["truncation"]
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
		// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the CAPTURE IDENTITY.
		identity: activeIdentity,
		exportedAtIso: new Date().toISOString(),
		eventCount: trace.events.length,
		stageCount: trace.stages.length,
		unavailableCount: trace.unavailable.length,
		integrityFailureCount: trace.integrityFailures.length,
		wallClockMs: trace.wallClockMs,
		overlapping: trace.overlapping,
		// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the capture is
		// BOUNDED. The truncation block is carried verbatim so the
		// artifact states, explicitly, whether it is COMPLETE.
		truncation: trace.truncation,
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
	// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — observe the ARTIFACT and SOURCE
	// identity at the dump seam.
	//
	// This is the right seam: the artifact is written HERE, so this is
	// where the identity of the bytes that produced the trace is known.
	// The resolver is the CANONICAL one the allocation profiler uses, so
	// both diagnostics record the SAME artifact identity.
	observeArtifactIdentity()
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
	activeIdentity = emptyIdentity()
}

/**
 * The `ModelBehaviorTraceSink` EVENT channels this module fans out.
 *
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — SINK COMPOSITION COMPLETENESS.
 *
 * ## Why the list is explicit AND compile-time checked
 *
 * The SDK's `ModelBehaviorTraceSink` interface is a TypeScript TYPE, so it
 * has no runtime reflection and the channel names cannot be derived at
 * runtime. They are therefore declared here explicitly — which is also what
 * makes the list AUDITABLE: a reviewer can compare it against
 * `sdk/packages/shared/src/runtime/model-behavior-trace.ts` and see that no
 * channel is missing and no channel is invented.
 *
 * ## The defect this correction repairs
 *
 * The original list carried only 18 of the interface's event channels. The
 * seven EDIT / PROCESS channels (`onEditAttempt`, `onEditApplication`,
 * `onEditFailure`, `onEditTargetResolved`, `onEditWriteVerification`,
 * `onEditCheckpointObservation`, `onProcessObservation`) were MISSING, so
 * enabling the Round C trace SILENTLY DROPPED the existing recorder's edit
 * and process telemetry: the composed sink was handed to the SDK INSTEAD of
 * the recorder, and the SDK then called channels the composite did not
 * implement.
 *
 * ## Why the exhaustiveness check is load-bearing
 *
 * A hand-maintained list can silently drift again the moment a channel is
 * added to the SDK interface. The assertion below turns that drift into a
 * COMPILE ERROR: adding a channel to `ModelBehaviorTraceSink` without
 * adding it here fails `check-types`, so the omission can never ship.
 */
export const COMPOSABLE_SINK_CHANNELS = [
	"onEffectiveModelConfig",
	"onModelRequestStart",
	"onRequestPrepared",
	"onProviderRequestSubmitted",
	"onProviderRequestCompleted",
	// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the first-response and
	// first-token channels.
	//
	// The transport's first event and the first GENERATED token are
	// DISTINCT measurements. Composing both is what lets the trace
	// report a true time-to-first-token instead of leaving the
	// measurement unavailable.
	"onProviderFirstResponse",
	"onProviderFirstToken",
	"onModelRequestFinish",
	"onModelRequestError",
	"onModelRequestAbort",
	"onToolStart",
	"onToolFinish",
	"onSchemaValidation",
	"onToolResultDelivered",
	"onProviderReady",
	// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the EDIT channels.
	//
	// These were the channels the original list dropped. The existing
	// recorder implements them (the edit-efficiency and workspace-effect
	// trace ACTs), so omitting them from the composite silently disabled
	// existing telemetry whenever the Round C trace was armed.
	"onEditAttempt",
	"onEditApplication",
	"onEditFailure",
	"onEditTargetResolved",
	"onEditWriteVerification",
	"onEditCheckpointObservation",
	// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the PROCESS channel.
	//
	// The command-process-outcome bridge owns this one; the existing
	// recorder implements it.
	"onProcessObservation",
	"onLoopVerdict",
	"onCompactionDiagnostics",
	"onCompactionCompleted",
	"onRunTerminated",
	"onRunAbortRequested",
] as const satisfies readonly (keyof ModelBehaviorTraceSink)[]

/**
 * The `ModelBehaviorTraceSink` members that are NOT event channels.
 *
 * They are handled separately because they have different semantics:
 *
 *   - `isTraceEnabled` — a synchronous enable bit (an OR of both sides).
 *   - the three fingerprint operations — VALUE-PRODUCING operations. They
 *     return a fingerprint the SDK CONSUMES, so they cannot be fanned out
 *     as events: a composite that returned `undefined` would silently
 *     disable the SDK's argument/path/content fingerprinting.
 *
 * Keeping them in their own list is what makes the exhaustiveness check
 * below TOTAL: every member of `ModelBehaviorTraceSink` is accounted for
 * by exactly one of the three lists.
 */
export const COMPOSABLE_SINK_FINGERPRINTS = [
	"fingerprintToolArguments",
	"fingerprintFilePath",
	"fingerprintFileContent",
] as const satisfies readonly (keyof ModelBehaviorTraceSink)[]

/**
 * The enable-bit member, named separately for the same reason.
 */
export const COMPOSABLE_SINK_ENABLE_BIT = "isTraceEnabled" as const satisfies keyof ModelBehaviorTraceSink

/**
 * Every member of `ModelBehaviorTraceSink`, as a union of the three lists.
 */
type ComposedSinkMember =
	| (typeof COMPOSABLE_SINK_CHANNELS)[number]
	| (typeof COMPOSABLE_SINK_FINGERPRINTS)[number]
	| typeof COMPOSABLE_SINK_ENABLE_BIT

/**
 * The members of `ModelBehaviorTraceSink` that the composition does NOT
 * account for.
 *
 * This MUST be `never`. If a channel is added to the SDK interface and not
 * to one of the three lists above, this type becomes a non-`never` union
 * and the assignment below fails to COMPILE — the drift is caught by
 * `check-types`, not by a reviewer noticing it.
 */
type UncomposedSinkMember = Exclude<keyof ModelBehaviorTraceSink, ComposedSinkMember>

/**
 * COMPILE-TIME EXHAUSTIVENESS GATE.
 *
 * If `UncomposedSinkMember` is not `never`, this assignment is a type
 * error. The exported constant therefore carries the proof that the
 * composition covers EVERY member of the SDK's sink interface.
 */
export type ComposableSinkCoversEveryChannel = UncomposedSinkMember extends never ? true : never

/**
 * The compile-time proof, as a VALUE so it is not elided and so a test can
 * assert on it.
 *
 * It is `true` if and only if the composition is exhaustive. It is typed as
 * `true`, so a future omission makes this declaration a compile error.
 */
export const COMPOSABLE_SINK_IS_EXHAUSTIVE: ComposableSinkCoversEveryChannel = true

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
 *
 * ## Fingerprint operations (VALUE-PRODUCING, not event fan-out)
 *
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01.
 *
 * The three fingerprint operations are NOT event channels: they RETURN a
 * value the SDK CONSUMES (the SDK puts the argument fingerprint into the
 * tool-call record). They therefore cannot be fanned out:
 *
 *   - If the composite dropped them, the SDK would receive `undefined` and
 *     the existing recorder's argument/path/content fingerprinting would be
 *     SILENTLY DISABLED whenever the Round C trace was armed. That is a
 *     correctness regression in the existing telemetry, not a cosmetic one.
 *   - If the composite fanned them out to both sides and returned the
 *     SECOND side's value, the composite's answer would depend on argument
 *     order rather than on authority.
 *
 * The composite therefore DELEGATES: the PRIMARY side (the existing
 * recorder, which owns the ephemeral fingerprint key) is authoritative; the
 * secondary side is the fallback when the primary does not implement the
 * operation at all.
 *
 * Three properties are preserved:
 *
 *   1. The RETURN VALUE, including an asynchronous one. The composed
 *      operation returns the delegate's result verbatim, so a `Promise` in
 *      stays a `Promise` out and the SDK's `await` still observes the real
 *      fingerprint.
 *   2. The RECEIVER BINDING. The delegate is invoked with `.call(receiver,
 *      ...)`, so `this` inside the implementation is still its own sink —
 *      the recorder's `this.fingerprintKey` keeps resolving.
 *   3. FAILURE ISOLATION. A throw in the delegate is contained: the
 *      composite returns `undefined` rather than propagating into the
 *      runtime's tool-execution path.
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
	for (const operation of COMPOSABLE_SINK_FINGERPRINTS) {
		const primaryHandler = primary[operation]
		const secondaryHandler = secondary[operation]
		if (typeof primaryHandler !== "function" && typeof secondaryHandler !== "function") {
			continue
		}
		composed[operation] = (...args: unknown[]) => {
			// The PRIMARY side is authoritative; the secondary is the
			// fallback for a side that does not implement the operation.
			if (typeof primaryHandler === "function") {
				try {
					// `.call(receiver, ...)` preserves the receiver binding,
					// and the result is returned VERBATIM so an async
					// fingerprint stays async.
					return (primaryHandler as (...a: unknown[]) => unknown).call(primary, ...args)
				} catch {
					// Failure isolation: a broken fingerprint implementation
					// must never break the runtime's tool execution.
					return undefined
				}
			}
			try {
				return (secondaryHandler as (...a: unknown[]) => unknown).call(secondary, ...args)
			} catch {
				return undefined
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
