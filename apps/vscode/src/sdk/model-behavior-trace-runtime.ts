/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01
 *
 * Extension-host runtime for the model behavior flight recorder.
 *
 * This module owns:
 *   - the SINGLE, centralized bounded recorder instance,
 *   - the live enable/disable toggle (default OFF),
 *   - the dump to JSONL under `context.globalStorageUri`, and
 *   - the bridge that turns SDK observations into trace records.
 *
 * TRUST BINDING
 * -------------
 *   - Default OFF: the recorder is inert until the operator invokes
 *     `cline.debug.toggleModelBehaviorTrace`.
 *   - One user action: the toggle flips the recorder's enable bit. The
 *     recorder is consulted at OBSERVATION time, so the toggle affects
 *     already-running sessions for subsequent events — no extension reload
 *     and no task restart.
 *   - The dump is UNCONDITIONAL: it works after tracing has been disabled
 *     and NEVER clears the evidence.
 *   - No disk writes until the operator dumps.
 *
 * WHY ONE CENTRAL RECORDER
 * -------------------------
 * The ACT explicitly asks for one centralized bounded recorder rather than
 * separate diagnostic rings per subsystem: the value of the evidence is the
 * INTERLEAVED timeline (model request ↔ tool execution ↔ compaction
 * boundary), which separate rings cannot provide.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { captureEditCheckpoint, resetEditCheckpointRegistry } from "@cline/core"
import {
	type ModelBehaviorTraceEvent,
	type ModelBehaviorTraceObservation,
	type ModelBehaviorTraceRecord,
	ModelBehaviorTraceRecorder,
	type ModelBehaviorTraceSink,
	registerModelBehaviorWireReasoningObserver,
} from "@cline/shared"

/**
 * The dump filename under `context.globalStorageUri`.
 */
export const MODEL_BEHAVIOR_TRACE_DUMP_FILE = "model-behavior-trace.jsonl"

/**
 * The minimal `vscode.ExtensionContext` shape this module needs.
 *
 * Structural typing keeps the module testable without the VS Code host.
 */
export interface ModelBehaviorTraceContext {
	readonly globalStorageUri: { readonly fsPath: string }
	readonly workspaceState: {
		get<T>(key: string): T | undefined
		update(key: string, value: unknown): Thenable<void> | Promise<void>
	}
}

/**
 * The single workspace-state key the diagnostic owns.
 */
const WORKSPACE_STATE_KEY = "modelBehaviorTraceEnabled"

/**
 * The ONE recorder instance.
 *
 * Module-level so the SDK observer and the operator commands share the same
 * buffer — this is what makes the timeline coherent.
 */
const recorder = new ModelBehaviorTraceRecorder()

/**
 * The recorder instance. Exposed for tests and for the host adapter.
 */
export function getModelBehaviorTraceRecorder(): ModelBehaviorTraceRecorder {
	return recorder
}

/**
 * True when the recorder is armed.
 *
 * A pure read of the in-memory enable bit — no I/O, so it is safe to call
 * on hot paths.
 */
export function isModelBehaviorTraceEnabled(): boolean {
	return recorder.isEnabled()
}

/**
 * Flip the recorder's enable bit.
 *
 * Disabling does NOT clear the buffer: the operator must still be able to
 * dump evidence captured before the toggle.
 */
export function setModelBehaviorTraceEnabled(enabled: boolean): void {
	recorder.setEnabled(enabled)
}

/**
 * Read the persisted workspace toggle.
 *
 * `undefined` (never toggled) means OFF.
 */
export function isModelBehaviorTraceWorkspaceEnabled(context: ModelBehaviorTraceContext): boolean {
	return context.workspaceState.get<boolean>(WORKSPACE_STATE_KEY) === true
}

/**
 * Flip the persisted workspace toggle and apply it to the live recorder.
 *
 * Returns the new value. The live recorder is updated immediately so the
 * toggle affects already-running sessions for subsequent events.
 */
export async function toggleModelBehaviorTraceWorkspaceEnabled(context: ModelBehaviorTraceContext): Promise<boolean> {
	const next = !isModelBehaviorTraceWorkspaceEnabled(context)
	await context.workspaceState.update(WORKSPACE_STATE_KEY, next)
	recorder.setEnabled(next)
	return next
}

/**
 * Restore the persisted toggle into the live recorder.
 *
 * Called at extension activation so a toggle survives an extension reload.
 */
export async function syncModelBehaviorTraceEnabled(context: ModelBehaviorTraceContext): Promise<boolean> {
	const persisted = isModelBehaviorTraceWorkspaceEnabled(context)
	recorder.setEnabled(persisted)
	return persisted
}

/**
 * Record one observation into the centralized recorder.
 *
 * Never throws — a recorder failure must never affect a model call, a tool
 * execution, or a lifecycle commit.
 */
export function recordModelBehaviorTrace(
	event: ModelBehaviorTraceEvent,
	observation: ModelBehaviorTraceObservation,
): ModelBehaviorTraceRecord | undefined {
	return recorder.record(
		event,
		{
			...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
			...(observation.taskId !== undefined ? { taskId: observation.taskId } : {}),
			...(observation.runId !== undefined ? { runId: observation.runId } : {}),
			...(observation.iteration !== undefined ? { iteration: observation.iteration } : {}),
			...(observation.providerId !== undefined ? { providerId: observation.providerId } : {}),
			...(observation.modelId !== undefined ? { modelId: observation.modelId } : {}),
		},
		observation.payload as Record<string, unknown>,
	)
}

/**
 * The SDK observation sink backed by the centralized recorder.
 *
 * Every channel maps to exactly one trace event kind. The sink is created
 * once and reused so the SDK can hold a stable reference.
 */
export const modelBehaviorTraceSink: ModelBehaviorTraceSink = {
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the live enablement signal.
	 *
	 * A pure, synchronous read of the recorder's enable bit. The SDK runtime
	 * uses it to take a SYNCHRONOUS fast path when tracing is OFF, so the
	 * disabled recorder introduces NO extra `await` (and therefore NO extra
	 * microtask suspension point) before tool execution.
	 */
	isTraceEnabled: () => recorder.isEnabled(),
	/**
	 * Compute the privacy-preserving argument fingerprint.
	 *
	 * The raw arguments are handed to the recorder, which owns the
	 * ephemeral key, and ONLY the fingerprint comes back. The recorder never
	 * retains the raw arguments.
	 */
	fingerprintToolArguments: async (toolName: string, input: unknown) => {
		const fingerprint = await recorder.fingerprintArguments(toolName, input)
		return fingerprint?.fingerprint
	},
	onEffectiveModelConfig: (observation) => {
		// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
		// The effective snapshot carries the REAL session/run identity, so it
		// is recorded as its own event kind rather than merged into the
		// build-time `model_config` snapshot.
		recordModelBehaviorTraceEffectiveConfig(
			{
				...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
				...(observation.taskId !== undefined ? { taskId: observation.taskId } : {}),
				...(observation.runId !== undefined ? { runId: observation.runId } : {}),
				...(observation.iteration !== undefined ? { iteration: observation.iteration } : {}),
				...(observation.providerId !== undefined ? { providerId: observation.providerId } : {}),
				...(observation.modelId !== undefined ? { modelId: observation.modelId } : {}),
			},
			{
				toolCount: asFiniteNumber(observation.payload.toolCount),
				toolNames: asStringArray(observation.payload.toolNames),
				thinkingEnabled:
					typeof observation.payload.thinkingEnabled === "boolean" ? observation.payload.thinkingEnabled : undefined,
				reasoningEffort:
					typeof observation.payload.reasoningEffort === "string" ? observation.payload.reasoningEffort : undefined,
				maxOutputTokens: asFiniteNumber(observation.payload.maxOutputTokens),
			},
		)
	},
	onModelRequestStart: (observation) => {
		recordModelBehaviorTrace("model_request_start", observation)
	},
	onModelRequestFinish: (observation) => {
		recordModelBehaviorTrace("model_request_finish", observation)
	},
	onModelRequestError: (observation) => {
		recordModelBehaviorTrace("model_request_error", observation)
	},
	onModelRequestAbort: (observation) => {
		recordModelBehaviorTrace("model_request_abort", observation)
	},
	onToolStart: (observation) => {
		recordModelBehaviorTrace("tool_start", observation)
	},
	onToolFinish: (observation) => {
		recordModelBehaviorTrace("tool_finish", observation)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * The ephemeral fingerprint of a resolved file path.
	 *
	 * The path is handed to the recorder, which owns the ephemeral key, and
	 * ONLY the fingerprint comes back. The recorder never retains the path,
	 * so a dump can never expose a filesystem layout.
	 */
	fingerprintFilePath: async (resolvedPath: string) => {
		return await recorder.fingerprintFilePath(resolvedPath)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * The ephemeral fingerprint of file content.
	 *
	 * Used to detect a file REVISION and a NO-OP write. The content is
	 * handed to the recorder, which owns the ephemeral key, and ONLY the
	 * fingerprint comes back.
	 */
	fingerprintFileContent: async (content: string) => {
		return await recorder.fingerprintFileContent(content)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * A native edit was REQUESTED.
	 */
	onEditAttempt: (observation) => {
		recordModelBehaviorTrace("edit_attempt", observation)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * The write layer reported the ACTUAL result of an edit attempt.
	 */
	onEditApplication: (observation) => {
		recordModelBehaviorTrace("edit_application", observation)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * An edit attempt failed with a structural failure category.
	 */
	onEditFailure: (observation) => {
		recordModelBehaviorTrace("edit_failure", observation)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
	 *
	 * The write layer resolved the DESTINATION of an edit: where the write
	 * lands relative to the active workspace.
	 *
	 * This is the ONLY event that distinguishes a write inside the
	 * workspace from one that landed outside it.
	 */
	onEditTargetResolved: (observation) => {
		recordModelBehaviorTrace("edit_target_resolved", observation)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * The write layer independently verified a write by reading the
	 * destination back from disk.
	 */
	onEditWriteVerification: (observation) => {
		recordModelBehaviorTrace("edit_write_verification", observation)
	},
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01.
	 *
	 * The write layer took a CHECKPOINT observation of the previously
	 * observed edit targets.
	 *
	 * This is the ONLY authority for a retained-change classification:
	 * the post-write read-back says what the disk held immediately after
	 * one write, not what it holds now.
	 */
	onEditCheckpointObservation: (observation) => {
		recordModelBehaviorTrace("edit_checkpoint_observation", observation)
	},
	onLoopVerdict: (observation) => {
		recordModelBehaviorTrace("loop_verdict", observation)
	},
	onCompactionDiagnostics: (observation) => {
		recordModelBehaviorTrace("compaction_diagnostics", observation)
	},
	onCompactionCompleted: (observation) => {
		recordModelBehaviorTrace("compaction_completed", observation)
	},
	onRunTerminated: (observation) => {
		recordModelBehaviorTrace("run_terminated", observation)
	},
}

/**
 * Narrow an unknown payload value to a finite number.
 *
 * The observation payload is `Readonly<Record<string, unknown>>`, so every
 * value must be narrowed before it can be used as a typed fact. A
 * non-numeric or non-finite value is treated as UNKNOWN, never coerced.
 */
function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * Narrow an unknown payload value to a string array.
 *
 * A non-array value is treated as UNKNOWN (the caller records the
 * `UNAVAILABLE_FROM_TRACE` sentinel), never as an empty toolset — an empty
 * toolset is a materially DIFFERENT fact from an unknown one.
 */
function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}
	return value.filter((item): item is string => typeof item === "string")
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R4):
 * bind a previously-recorded, session-less configuration snapshot to the
 * session that actually owns it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The build-time configuration is constructed BEFORE the session id is
 * allocated (the session id is assigned by the task-start coordinator after
 * `buildSessionConfig()` returns). The snapshot therefore carries no session
 * identity at record time.
 *
 * The ACT requires that such a snapshot be associated "using an actual
 * session identity carried by subsequent events" — NEVER by timestamp
 * proximity. The production flow satisfies that exactly: the coordinator
 * that ALLOCATED the session id is the same authority that binds the
 * snapshot to it, so the binding is an identity assertion, not a guess.
 *
 * The rebinding is a RECORD-LOCAL correction: the recorder's records are
 * immutable, so the bound snapshot is appended as an ADDITIONAL
 * `model_config` record carrying the session identity. The comparator
 * treats a session-bound snapshot as authoritative for that session and
 * ignores the session-less one when the session can be resolved.
 *
 * This is deliberately NOT a new provenance subsystem: it is a single
 * function on the existing recorder.
 */
export function bindModelBehaviorTraceConfigToSession(
	sessionId: string,
	config: ModelBehaviorTraceConfigSnapshot,
	identity?: { providerId?: string; modelId?: string },
): ModelBehaviorTraceRecord | undefined {
	if (!sessionId.trim()) {
		return undefined
	}
	return recordModelBehaviorTraceConfig(
		{
			sessionId,
			...(identity?.providerId !== undefined ? { providerId: identity.providerId } : {}),
			...(identity?.modelId !== undefined ? { modelId: identity.modelId } : {}),
		},
		config,
	)
}

/**
 * The model configuration snapshot recorded at session creation and when
 * the relevant configuration changes.
 */
export interface ModelBehaviorTraceConfigSnapshot {
	selectedProviderId?: string
	selectedModelId?: string
	runtimeProviderId?: string
	runtimeModelId?: string
	providerConfirmedModelId?: string
	thinkingEnabled?: boolean
	reasoningEffort?: string
	temperature?: number
	topP?: number
	maxOutputTokens?: number
	contextWindow?: number
	maxInputTokens?: number
	userContextCeiling?: number
	toolCount?: number
	toolNames?: readonly string[]
	sourceHead?: string
	extensionVersion?: string
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2).
	 *
	 * The SHA-256 of the ACTUAL installed `dist/extension.js` bytes.
	 */
	extensionBundleSha256?: string
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3).
	 *
	 * The EFFECTIVE context input budget and its provenance.
	 */
	effectiveMaxInputTokens?: number
	inputBudgetSource?: string
	userContextCeilingMode?: "auto" | "explicit"
}

/**
 * Record the model configuration snapshot.
 *
 * Omitted/default provider settings are explicitly marked as
 * `UNAVAILABLE_FROM_TRACE` rather than guessed, so an analyst can tell
 * "the provider did not expose this" apart from "it was the default".
 */
export function recordModelBehaviorTraceConfig(
	identity: {
		sessionId?: string
		taskId?: string
		runId?: string
		providerId?: string
		modelId?: string
	},
	config: ModelBehaviorTraceConfigSnapshot,
): ModelBehaviorTraceRecord | undefined {
	return recorder.record(
		"model_config",
		identity,
		{
			selectedProviderId: config.selectedProviderId ?? "UNAVAILABLE_FROM_TRACE",
			selectedModelId: config.selectedModelId ?? "UNAVAILABLE_FROM_TRACE",
			runtimeProviderId: config.runtimeProviderId ?? "UNAVAILABLE_FROM_TRACE",
			runtimeModelId: config.runtimeModelId ?? "UNAVAILABLE_FROM_TRACE",
			providerConfirmedModelId: config.providerConfirmedModelId ?? "UNAVAILABLE_FROM_TRACE",
			thinkingEnabled: config.thinkingEnabled ?? "UNAVAILABLE_FROM_TRACE",
			reasoningEffort: config.reasoningEffort ?? "UNAVAILABLE_FROM_TRACE",
			temperature: config.temperature ?? "UNAVAILABLE_FROM_TRACE",
			topP: config.topP ?? "UNAVAILABLE_FROM_TRACE",
			maxOutputTokens: config.maxOutputTokens ?? "UNAVAILABLE_FROM_TRACE",
			contextWindow: config.contextWindow ?? "UNAVAILABLE_FROM_TRACE",
			maxInputTokens: config.maxInputTokens ?? "UNAVAILABLE_FROM_TRACE",
			userContextCeiling: config.userContextCeiling ?? "UNAVAILABLE_FROM_TRACE",
			toolCount: config.toolCount ?? "UNAVAILABLE_FROM_TRACE",
			toolNames: config.toolNames ?? [],
			sourceHead: config.sourceHead ?? "UNAVAILABLE_FROM_TRACE",
			extensionVersion: config.extensionVersion ?? "UNAVAILABLE_FROM_TRACE",
			// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2/R3).
			extensionBundleSha256: config.extensionBundleSha256 ?? "UNAVAILABLE_FROM_TRACE",
			effectiveMaxInputTokens: config.effectiveMaxInputTokens ?? "UNAVAILABLE_FROM_TRACE",
			inputBudgetSource: config.inputBudgetSource ?? "UNAVAILABLE_FROM_TRACE",
			userContextCeilingMode: config.userContextCeilingMode ?? "UNAVAILABLE_FROM_TRACE",
		},
		{ evidenceBoundary: "synthesized" },
	)
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
 *
 * Record the EFFECTIVE model configuration observed at the model-request
 * boundary, carrying the REAL session/run identity.
 *
 * The effective snapshot is a DISTINCT event from the build-time
 * `model_config` snapshot: it describes what the runtime actually sends,
 * and it is bound to an execution by identity rather than by timestamp.
 */
export function recordModelBehaviorTraceEffectiveConfig(
	identity: {
		sessionId?: string
		taskId?: string
		runId?: string
		iteration?: number
		providerId?: string
		modelId?: string
	},
	payload: {
		toolCount?: number
		toolNames?: readonly string[]
		thinkingEnabled?: boolean
		reasoningEffort?: string
		maxOutputTokens?: number
	},
): ModelBehaviorTraceRecord | undefined {
	return recorder.record(
		"effective_model_config",
		{
			...(identity.sessionId !== undefined ? { sessionId: identity.sessionId } : {}),
			...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
			...(identity.runId !== undefined ? { runId: identity.runId } : {}),
			...(identity.iteration !== undefined ? { iteration: identity.iteration } : {}),
			...(identity.providerId !== undefined ? { providerId: identity.providerId } : {}),
			...(identity.modelId !== undefined ? { modelId: identity.modelId } : {}),
		},
		{
			toolCount: payload.toolCount ?? "UNAVAILABLE_FROM_TRACE",
			toolNames: payload.toolNames ?? [],
			thinkingEnabled: payload.thinkingEnabled ?? "UNAVAILABLE_FROM_TRACE",
			reasoningEffort: payload.reasoningEffort ?? "UNAVAILABLE_FROM_TRACE",
			maxOutputTokens: payload.maxOutputTokens ?? "UNAVAILABLE_FROM_TRACE",
		},
	)
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * Install the wire-reasoning observer that records the SERIALIZED provider
 * wire controls into the centralized recorder.
 *
 * The observer is installed ONCE at activation and is IDEMPOTENT: calling
 * it again is a no-op. It is NOT gated by the trace toggle — the recorder
 * itself is consulted at observation time, so the observer may fire while
 * the recorder is OFF, in which case the recorder records nothing. That
 * keeps the toggle semantics identical to every other trace channel: the
 * toggle decides whether evidence is RETAINED, and it can be flipped at any
 * time without a reload.
 *
 * The observer is INDEPENDENT of the full provider-request capture: it
 * never enables `CLINE_CAPTURE_PROVIDER_REQUEST` / `CLINE_CAPTURE_WIRE` and
 * never causes a capture file to be written.
 */
let wireReasoningObserverInstalled = false

/**
 * Install the wire-reasoning observer. Idempotent.
 */
export function installModelBehaviorWireReasoningObserver(): void {
	if (wireReasoningObserverInstalled) {
		return
	}
	wireReasoningObserverInstalled = true
	registerModelBehaviorWireReasoningObserver(
		(observation) => {
			recordModelBehaviorTraceWireReasoning(
				{
					...(observation.sessionId !== undefined ? { sessionId: observation.sessionId } : {}),
					...(observation.taskId !== undefined ? { taskId: observation.taskId } : {}),
					...(observation.runId !== undefined ? { runId: observation.runId } : {}),
					...(observation.iteration !== undefined ? { iteration: observation.iteration } : {}),
					...(observation.providerId !== undefined ? { providerId: observation.providerId } : {}),
					...(observation.modelId !== undefined ? { modelId: observation.modelId } : {}),
				},
				{
					...(observation.requestId !== undefined ? { requestId: observation.requestId } : {}),
					...(observation.attempt !== undefined ? { attempt: observation.attempt } : {}),
					...(observation.httpMethod !== undefined ? { httpMethod: observation.httpMethod } : {}),
					...(observation.wireThinkingMode !== undefined ? { wireThinkingMode: observation.wireThinkingMode } : {}),
					...(observation.wireReasoningEffort !== undefined
						? { wireReasoningEffort: observation.wireReasoningEffort }
						: {}),
					...(observation.wireReasoningEnabled !== undefined
						? { wireReasoningEnabled: observation.wireReasoningEnabled }
						: {}),
					...(observation.wireReasoningExcluded !== undefined
						? { wireReasoningExcluded: observation.wireReasoningExcluded }
						: {}),
					...(observation.wireOutputConfigEffort !== undefined
						? { wireOutputConfigEffort: observation.wireOutputConfigEffort }
						: {}),
					...(observation.wireOutputTokenLimit !== undefined
						? { wireOutputTokenLimit: observation.wireOutputTokenLimit }
						: {}),
				},
			)
		},
		{
			// ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 (OFF fast path).
			//
			// The observer is REGISTERED for the whole process lifetime, but it
			// only wants observations while the recorder is ARMED. The
			// predicate is read LIVE at every observation — the recorder's
			// state is NEVER snapshotted at registration time, so toggling
			// the trace ON or OFF takes effect for the NEXT provider request
			// without a reload, a re-registration, or a new gateway.
			//
			// This is what lets the provider seam skip the request-body read
			// entirely while the trace is OFF.
			isActive: () => isModelBehaviorTraceEnabled(),
		},
	)
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * Record the SERIALIZED provider wire controls observed for ONE model
 * request HTTP attempt.
 *
 * This is the ONLY authority on what the provider ACTUALLY received. The
 * `effective_model_config` event says what the runtime REQUESTED; this event
 * says what was SERIALIZED onto the wire.
 *
 * The payload carries ONLY the reasoning-relevant control fields plus the
 * correlation identity. The prompt, the messages, the tool arguments and
 * the credentials are NEVER retained.
 */
export function recordModelBehaviorTraceWireReasoning(
	identity: {
		sessionId?: string
		taskId?: string
		runId?: string
		iteration?: number
		providerId?: string
		modelId?: string
	},
	payload: {
		requestId?: string
		attempt?: number
		httpMethod?: string
		wireThinkingMode?: string
		wireReasoningEffort?: string
		wireReasoningEnabled?: boolean
		wireReasoningExcluded?: boolean
		wireOutputConfigEffort?: string
		wireOutputTokenLimit?: number
	},
): ModelBehaviorTraceRecord | undefined {
	return recorder.record(
		"model_wire_reasoning",
		{
			...(identity.sessionId !== undefined ? { sessionId: identity.sessionId } : {}),
			...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
			...(identity.runId !== undefined ? { runId: identity.runId } : {}),
			...(identity.iteration !== undefined ? { iteration: identity.iteration } : {}),
			...(identity.providerId !== undefined ? { providerId: identity.providerId } : {}),
			...(identity.modelId !== undefined ? { modelId: identity.modelId } : {}),
		},
		{
			...(payload.requestId !== undefined ? { requestId: payload.requestId } : {}),
			...(payload.attempt !== undefined ? { attempt: payload.attempt } : {}),
			...(payload.httpMethod !== undefined ? { httpMethod: payload.httpMethod } : {}),
			...(payload.wireThinkingMode !== undefined ? { wireThinkingMode: payload.wireThinkingMode } : {}),
			...(payload.wireReasoningEffort !== undefined ? { wireReasoningEffort: payload.wireReasoningEffort } : {}),
			...(payload.wireReasoningEnabled !== undefined ? { wireReasoningEnabled: payload.wireReasoningEnabled } : {}),
			...(payload.wireReasoningExcluded !== undefined ? { wireReasoningExcluded: payload.wireReasoningExcluded } : {}),
			...(payload.wireOutputConfigEffort !== undefined ? { wireOutputConfigEffort: payload.wireOutputConfigEffort } : {}),
			...(payload.wireOutputTokenLimit !== undefined ? { wireOutputTokenLimit: payload.wireOutputTokenLimit } : {}),
		},
	)
}

/**
 * The result of a dump operation.
 */
export interface ModelBehaviorTraceDumpResult {
	/** Absolute path of the JSONL file. */
	readonly filePath: string
	/** How many records were written. */
	readonly recordCount: number
	/** True when records were dropped from the ring. */
	readonly truncated: boolean
	/** How many records were dropped. */
	readonly droppedCount: number
}

/**
 * Dump the recorded timeline to JSONL under `globalStorageUri`.
 *
 * The dump is UNCONDITIONAL — it works after tracing has been disabled, and
 * it NEVER clears the evidence.
 *
 * The JSONL file contains ONE record per line (the timeline) followed by a
 * final SUMMARY line carrying the truncation metadata, so the dump is
 * self-describing: an incomplete trace is never presented as exhaustive.
 */
export async function dumpModelBehaviorTrace(context: ModelBehaviorTraceContext): Promise<ModelBehaviorTraceDumpResult> {
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the dump
	// takes a CHECKPOINT of the previously observed edit targets BEFORE it
	// serializes the timeline.
	//
	// The post-write read-back says what the disk held immediately after
	// one write. A command that later restored the file produces no native
	// editor event, so without this checkpoint the trace would still
	// describe the file as changed. The checkpoint is the ACTUAL
	// filesystem observation at dump time, and it is the only authority
	// for a retained-change classification.
	//
	// It is taken through the SAME sink the writes were reported through,
	// so the checkpoint record lands in the dumped timeline.
	await captureEditCheckpoint(modelBehaviorTraceSink)
	const dump = recorder.dump()
	const dir = context.globalStorageUri.fsPath
	await mkdir(dir, { recursive: true })
	const filePath = join(dir, MODEL_BEHAVIOR_TRACE_DUMP_FILE)
	const lines: string[] = dump.records.map((record) => JSON.stringify(record))
	lines.push(
		JSON.stringify({
			kind: "summary",
			traceId: dump.traceId,
			dumpedAt: dump.dumpedAt,
			truncation: dump.truncation,
		}),
	)
	await writeFile(filePath, `${lines.join("\n")}\n`, "utf8")
	return {
		filePath,
		recordCount: dump.records.length,
		truncated: dump.truncation.truncated,
		droppedCount: dump.truncation.droppedCount,
	}
}

/**
 * The recorded records, oldest first. Exposed for tests and for the
 * comparator's in-process use.
 */
export function getModelBehaviorTraceRecords(): readonly ModelBehaviorTraceRecord[] {
	return recorder.getRecords()
}

/**
 * Test seam: reset the recorder to a pristine state. Production code never
 * calls this.
 */
export function _resetModelBehaviorTrace(): void {
	recorder._reset()
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the
	// checkpoint registry holds RAW PATHS in memory, so it is dropped with
	// the capture it belongs to.
	resetEditCheckpointRegistry()
}
