/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01
 *
 * Authoritative edit-observation seam for the native editing tools.
 *
 * WHY THIS LAYER
 * --------------
 * The chain of an edit is:
 *
 *   edit requested → authorized → executor invoked → mutation applied
 *     → file revision observed → subsequent revision → verification
 *
 * ONLY the layer that performs the write can authoritatively report
 * "a mutation was applied", "the write was a no-op", and "a multi-file
 * patch partially applied". A tool-level "success" is NOT evidence of a
 * source modification: the SDK's `apply_patch` executor writes files one
 * at a time, so a failure on the second file leaves the FIRST file
 * mutated even though the tool reported an error.
 *
 * This module is the SINGLE place that:
 *
 *   1. classifies an edit's structural operation from the tool INPUT,
 *   2. classifies a failure from TYPED executor results (never by
 *      substring-searching model-generated error prose),
 *   3. measures the pre/post content version of every file it writes,
 *      so a no-op write and a file revision are distinguishable, and
 *   4. reports the result through the model-behavior-trace sink.
 *
 * PRIVACY / COST
 * --------------
 *   - No raw path, no content, no patch body, no command is ever
 *     reported. File identity and content version are EPHEMERAL keyed
 *     fingerprints computed by the sink (which owns the key).
 *   - When the trace is OFF the observation is a NO-OP: no extra file
 *     read, no fingerprint computation, no allocation.
 *   - Files larger than {@link EDIT_OBSERVATION_MAX_FILE_BYTES} are
 *     written normally, but their CONTENT is not measured; the
 *     observation records `MEASUREMENT_SKIPPED_SIZE_LIMIT` instead of
 *     letting diagnostics slow the edit down.
 *   - An instrumentation failure NEVER affects the edit: every entry
 *     point swallows its own errors.
 */

import type {
	ModelBehaviorTraceEditApplication,
	ModelBehaviorTraceEditApplicationOutcome,
	ModelBehaviorTraceEditAttempt,
	ModelBehaviorTraceEditCheckpointObservation,
	ModelBehaviorTraceEditDestinationScope,
	ModelBehaviorTraceEditFailureCategory,
	ModelBehaviorTraceEditFileMutation,
	ModelBehaviorTraceEditOperation,
	ModelBehaviorTraceEditPathInputKind,
	ModelBehaviorTraceEditTargetResolution,
	ModelBehaviorTraceEditWriteVerification,
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceSink,
	ModelBehaviorTraceWorkspaceIdentity,
} from "@cline/shared";
import {
	classifyPatchOperationShape,
	countPatchTargetsShape,
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
	type ModelBehaviorTraceEditApprovalOutcome,
} from "@cline/shared";
import {
	type EditCheckpointRegistry,
	getEditCheckpointRegistry,
	resetEditCheckpointRegistry,
} from "./edit-checkpoint-registry";
import type { EditTargetWorkspaceRoots } from "./edit-target-resolution";
import {
	EDIT_OBSERVATION_MAX_FILE_BYTES,
	readBackBounded,
} from "./edit-write-verification";

/**
 * The maximum file size, in bytes, whose CONTENT the instrumentation will
 * measure to compute a pre/post content version.
 *
 * Beyond this the write still happens; only the MEASUREMENT is skipped.
 */
export { EDIT_OBSERVATION_MAX_FILE_BYTES };

/**
 * The tool-context metadata key that carries the trace sink into the
 * executor.
 *
 * Re-exported from `@cline/shared` so the runtime (in `@cline/agents`)
 * and the executor (in `@cline/core`) agree on ONE key without either
 * package depending on the other.
 */
export {
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
} from "@cline/shared";

/**
 * Read the authorization outcome the runtime handed down.
 *
 * The runtime is the authority for this fact; the executor only carries
 * it. When the runtime did not supply one (a sink attached outside the
 * runtime's tool context), the outcome is UNAVAILABLE rather than
 * guessed.
 */
export function readEditApprovalOutcome(
	metadata: Record<string, unknown> | undefined,
): ModelBehaviorTraceEditApprovalOutcome {
	if (!metadata) {
		return "unavailable";
	}
	const outcome = metadata[EDIT_OBSERVATION_APPROVAL_METADATA_KEY];
	return outcome === "approved" ||
		outcome === "rejected" ||
		outcome === "skipped" ||
		outcome === "unavailable"
		? outcome
		: "unavailable";
}

/**
 * The identity the executor stamps onto its observations.
 */
export interface EditObservationIdentity {
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly runId?: string;
	readonly iteration?: number;
	readonly providerId?: string;
	readonly modelId?: string;
	/** The actual runtime tool-call identity. */
	readonly toolCallId?: string;
}

// =============================================================================
// Operation classification
// =============================================================================

/**
 * Classify the structural operation of an `editor` tool input.
 *
 * Derived from the INPUT SHAPE only, so it is reproducible and never
 * depends on the model's prose.
 */
export function classifyEditorOperation(input: {
	path?: unknown;
	old_text?: unknown;
	new_text?: unknown;
	insert_line?: unknown;
}): ModelBehaviorTraceEditOperation {
	if (input.insert_line != null) {
		return "insert";
	}
	if (input.old_text == null) {
		return "create";
	}
	return "replace";
}

/**
 * The operation of an `apply_patch` request, derived from the patch body.
 *
 * The patch body is NOT reported; only its structural kind is. The
 * classification is the SHARED one, so the runtime's view of an edit
 * request and the executor's view can never diverge.
 */
export function classifyPatchOperation(
	patchText: string,
): ModelBehaviorTraceEditOperation {
	return classifyPatchOperationShape(patchText);
}

/**
 * Count how many distinct files a patch body targets.
 *
 * This is a COUNT of targets, never the target names.
 */
export function countPatchTargets(patchText: string): number {
	return countPatchTargetsShape(patchText);
}

/**
 * The number of characters in a requested edit.
 *
 * This is a LENGTH. The text itself is never reported.
 */
export function measureRequestedChars(input: {
	old_text?: unknown;
	new_text?: unknown;
}): number {
	let total = 0;
	if (typeof input.old_text === "string") {
		total += input.old_text.length;
	}
	if (typeof input.new_text === "string") {
		total += input.new_text.length;
	}
	return total;
}

// =============================================================================
// Failure classification
// =============================================================================

/**
 * A failure the SDK itself produced, carrying a STRUCTURAL category.
 *
 * The executors raise these instead of bare `Error`s so the failure
 * classification never has to inspect error prose.
 */
export class EditOperationError extends Error {
	constructor(
		message: string,
		readonly category: ModelBehaviorTraceEditFailureCategory,
	) {
		super(message);
		this.name = "EditOperationError";
	}
}

/**
 * Classify a thrown value into a structural failure category.
 *
 * The categories come from TYPED sources:
 *   - {@link EditOperationError} — the executor's own typed rejection,
 *   - the SDK's `DiffError` — a patch grammar/hunk problem,
 *   - a Node `errno` code — a filesystem-level refusal.
 *
 * Model-generated prose is NEVER substring-searched.
 */
export function classifyEditFailure(
	error: unknown,
): ModelBehaviorTraceEditFailureCategory {
	if (error instanceof EditOperationError) {
		return error.category;
	}
	// The SDK's patch error type is identified by its stable `name`, so
	// this module does not need to import the parser (which would couple
	// the observation seam to the patch grammar).
	const name = error instanceof Error ? error.name : "";
	if (name === "DiffError") {
		return classifyDiffErrorCategory(
			error instanceof Error ? error.message : "",
		);
	}
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code === "EACCES" || code === "EPERM") {
		return "permission_denied";
	}
	if (code === "ENOENT") {
		return "text_not_found";
	}
	if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
		return "timeout";
	}
	if (
		name === "AbortError" ||
		name === "AgentRuntimeAbortError" ||
		(error as { aborted?: boolean } | undefined)?.aborted === true
	) {
		return "runtime_abort";
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("timed out")) {
		return "timeout";
	}
	return "unknown";
}

/**
 * Map the SDK's `DiffError` message onto a structural category.
 *
 * The `DiffError` type carries a human-readable message but no category
 * field, so the mapping is done on the SDK's OWN stable message prefixes
 * (these strings are produced by the SDK's parser, never by the model).
 */
function classifyDiffErrorCategory(
	message: string,
): ModelBehaviorTraceEditFailureCategory {
	if (message.includes("Path must stay within cwd")) {
		return "path_rejected";
	}
	if (
		message.includes("Invalid patch text") ||
		message.includes("Invalid patch") ||
		message.includes("Invalid Add File line")
	) {
		return "invalid_patch";
	}
	if (
		message.includes("Invalid Context") ||
		message.includes("hunk") ||
		message.includes("Failed to find expected lines") ||
		message.includes("does not match")
	) {
		return "hunk_mismatch";
	}
	if (
		message.includes("Could not find file") ||
		message.includes("not found")
	) {
		return "text_not_found";
	}
	return "invalid_patch";
}

// =============================================================================
// Observation channel
// =============================================================================

/**
 * The measured state of one file at one point in the write.
 */
export interface EditFileMeasurement {
	/** The ephemeral fingerprint of the resolved path. */
	readonly fileIdentity?: string;
	/** The ephemeral fingerprint of the content. */
	readonly contentVersion?: string;
	/** Set when the content was not measured. */
	readonly measurementSkipped?: "MEASUREMENT_SKIPPED_SIZE_LIMIT";
}

/**
 * The read-only observation channel used by the executors.
 *
 * One instance is created per tool call.
 */
export class EditObservation {
	private readonly startedAt = Date.now();
	private readonly mutations: ModelBehaviorTraceEditFileMutation[] = [];
	private mutatedFileCount = 0;
	private requestedFileCount = 0;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
	 *
	 * The workspace identity the host handed down. Undefined when the host
	 * supplied none — the destination scope is then `unknown`, never a
	 * guess.
	 */
	private readonly workspace: ModelBehaviorTraceWorkspaceIdentity | undefined;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * The content the executor INTENDED to write to the last destination.
	 *
	 * It is held so the read-back can report the intended fingerprint
	 * alongside the independently measured one. It is never reported as
	 * the actual content.
	 */
	private intendedContent: string | undefined;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01.
	 *
	 * The EPHEMERAL, IN-MEMORY registry of the destinations this
	 * observation has observed.
	 *
	 * It holds RAW PATHS, but ONLY in memory: they are never serialized,
	 * never reported to the sink, and never written to disk. Only
	 * ephemeral fingerprints leave it.
	 *
	 * It exists so an explicit CHECKPOINT can re-observe the targets
	 * rather than inferring the current filesystem state from the last
	 * post-write read-back.
	 *
	 * The registry is shared across the WHOLE capture (it cannot live on
	 * the per-tool-call observation), and is reset when the capture is
	 * reset.
	 */
	private get checkpointRegistry(): EditCheckpointRegistry {
		return getEditCheckpointRegistry();
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01.
	 *
	 * The number of bytes the MOST RECENT read-back asked the operating
	 * system for.
	 *
	 * It is the RESOURCE observation of the read-back: it stays within
	 * `EDIT_OBSERVATION_MAX_FILE_BYTES + 1` per read no matter how large
	 * the destination is.
	 *
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02: this is
	 * the count of ONE read, never the accumulated total of the tool call.
	 * The previous implementation added to a running total, so the second
	 * read-back of a multi-file patch reported the SUM of both reads and the
	 * field no longer described a single read operation.
	 */
	private readBytesRequested = 0;

	constructor(
		private readonly toolName: string,
		private readonly sink: ModelBehaviorTraceSink | undefined,
		private readonly identity: EditObservationIdentity | undefined,
		private readonly approvalOutcome: ModelBehaviorTraceEditApprovalOutcome,
		workspace?: ModelBehaviorTraceWorkspaceIdentity,
	) {
		this.workspace = workspace;
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
	 *
	 * The workspace roots the destination is classified against.
	 *
	 * Exposed so the executor can resolve the destination against the SAME
	 * identity the observation reports.
	 */
	get workspaceRoots(): EditTargetWorkspaceRoots {
		return {
			...(this.workspace?.workspaceRoot !== undefined
				? { workspaceRoot: this.workspace.workspaceRoot }
				: {}),
			...(this.workspace?.otherWorkspaceRoots !== undefined
				? { otherWorkspaceRoots: this.workspace.otherWorkspaceRoots }
				: {}),
			...(this.workspace?.benchmarkRoot !== undefined
				? { benchmarkRoot: this.workspace.benchmarkRoot }
				: {}),
		};
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * The content the executor intended to write to the last destination.
	 */
	get lastIntendedContent(): string | undefined {
		return this.intendedContent;
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * Record the content the executor is about to write to a destination.
	 *
	 * Held so the read-back can report the intended fingerprint alongside
	 * the independently measured one. It is never reported AS the actual
	 * content.
	 */
	recordIntendedContent(content: string | undefined): void {
		this.intendedContent = content;
	}

	/**
	 * True when there is anything to report to. When false, every method
	 * below is a no-op and no file is read.
	 */
	get active(): boolean {
		return (
			this.sink?.onEditAttempt !== undefined ||
			this.sink?.onEditApplication !== undefined ||
			this.sink?.onEditFailure !== undefined ||
			this.sink?.onEditTargetResolved !== undefined ||
			this.sink?.onEditWriteVerification !== undefined ||
			this.sink?.onEditCheckpointObservation !== undefined
		);
	}

	/**
	 * The authorization outcome the runtime handed down.
	 */
	get approval(): ModelBehaviorTraceEditApprovalOutcome {
		return this.approvalOutcome;
	}

	/**
	 * The mutations observed so far.
	 *
	 * Exposed so the caller can determine whether every write was a NO-OP
	 * (identical pre/post content version).
	 */
	get fileMutations(): readonly ModelBehaviorTraceEditFileMutation[] {
		return this.mutations;
	}

	/**
	 * Report the "edit requested" link.
	 *
	 * Emitted BEFORE the write, so an edit that never reaches the
	 * executor is still visible as an attempt.
	 */
	reportAttempt(attempt: ModelBehaviorTraceEditAttempt): void {
		const handler = this.sink?.onEditAttempt;
		if (!handler) {
			return;
		}
		try {
			handler(this.observation({ ...attempt }));
		} catch {
			// Failure isolation: instrumentation NEVER affects an edit.
		}
	}

	/**
	 * Record that the edit REQUESTED `count` target files.
	 */
	setRequestedFileCount(count: number): void {
		this.requestedFileCount = count;
	}

	/**
	 * Measure the file's content version BEFORE the write.
	 */
	async measurePreWrite(
		resolvedPath: string,
		content: string | undefined,
	): Promise<EditFileMeasurement> {
		return this.measure(resolvedPath, content);
	}

	/**
	 * Measure the file's content version AFTER the write.
	 */
	async measurePostWrite(
		resolvedPath: string,
		content: string | undefined,
	): Promise<EditFileMeasurement> {
		return this.measure(resolvedPath, content);
	}

	/**
	 * Record one file's mutation and whether its CONTENT changed.
	 */
	recordMutation(
		pre: EditFileMeasurement,
		post: EditFileMeasurement,
		lines?: { added?: number; removed?: number },
	): void {
		if (!this.active) {
			return;
		}
		const identity = pre.fileIdentity ?? post.fileIdentity;
		this.mutatedFileCount += 1;
		this.mutations.push({
			...(identity !== undefined ? { fileIdentity: identity } : {}),
			...(pre.contentVersion !== undefined
				? { contentVersionPre: pre.contentVersion }
				: {}),
			...(post.contentVersion !== undefined
				? { contentVersionPost: post.contentVersion }
				: {}),
			...(lines?.added !== undefined ? { linesAdded: lines.added } : {}),
			...(lines?.removed !== undefined ? { linesRemoved: lines.removed } : {}),
			...(pre.measurementSkipped !== undefined ||
			post.measurementSkipped !== undefined
				? {
						measurementSkipped: "MEASUREMENT_SKIPPED_SIZE_LIMIT" as const,
					}
				: {}),
		});
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
	 *
	 * Report the RESOLVED destination of one edit.
	 *
	 * The destination's scope is computed by the caller (which owns the
	 * resolved path) and reduced here to privacy-safe facts: the scope
	 * itself, the input-path classification, the ephemeral workspace /
	 * executor-cwd identities, whether the destination existed before the
	 * operation, and whether it was under the designated benchmark root.
	 *
	 * The raw path is NEVER reported.
	 */
	async reportTargetResolution(resolved: {
		readonly inputPathKind: ModelBehaviorTraceEditPathInputKind;
		readonly absolutePath: string;
		readonly destinationScope: ModelBehaviorTraceEditDestinationScope;
		readonly canonicalized: boolean;
		readonly existedBefore: boolean;
		readonly underBenchmarkRoot?: boolean;
		/**
		 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the
		 * EXECUTOR'S OWN working directory — the `cwd` the tool execution
		 * boundary was given.
		 *
		 * This is NEVER the edit destination. The previous implementation
		 * fingerprinted `resolved.absolutePath` and labelled it the
		 * executor's cwd identity, which made two destinations written
		 * from the SAME cwd look like two different cwds.
		 *
		 * ABSENT when the boundary supplied no working directory; the
		 * identity is then unavailable rather than substituted.
		 */
		readonly executorCwd?: string;
	}): Promise<void> {
		const handler = this.sink?.onEditTargetResolved;
		if (!handler) {
			return;
		}
		try {
			const [
				workspaceIdentity,
				executorCwdIdentity,
				benchmarkIdentity,
				fileIdentity,
			] = await Promise.all([
				this.workspace?.workspaceRoot
					? this.fingerprintPath(this.workspace.workspaceRoot)
					: undefined,
				// The executor's cwd — NEVER the destination.
				//
				// An EMPTY cwd is not a working directory: the identity
				// is then unavailable rather than a fingerprint of "".
				resolved.executorCwd !== undefined && resolved.executorCwd.trim() !== ""
					? this.fingerprintPath(resolved.executorCwd)
					: undefined,
				this.workspace?.benchmarkRoot
					? this.fingerprintPath(this.workspace.benchmarkRoot)
					: undefined,
				// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02:
				// the SHARED, TRUSTED per-target identity.
				//
				// It is the fingerprint of the RESOLVED DESTINATION PATH,
				// computed by the sink from the SAME path the write
				// verification fingerprints — so the destination scope
				// and the independent verification join by EXACT
				// per-target identity.
				//
				// Without it, a multi-file `apply_patch` produced several
				// destinations sharing ONE tool-call id, and the
				// comparator could not say which scope belonged to which
				// verified write.
				this.fingerprintPath(resolved.absolutePath),
			]);
			const resolution: ModelBehaviorTraceEditTargetResolution = {
				...(this.identity?.toolCallId !== undefined
					? { toolCallId: this.identity.toolCallId }
					: {}),
				toolName: this.toolName,
				inputPathKind: resolved.inputPathKind,
				...(workspaceIdentity !== undefined ? { workspaceIdentity } : {}),
				...(executorCwdIdentity !== undefined ? { executorCwdIdentity } : {}),
				...(fileIdentity !== undefined ? { fileIdentity } : {}),
				destinationScope: resolved.destinationScope,
				canonicalized: resolved.canonicalized,
				destinationExistedBefore: resolved.existedBefore,
				...(resolved.underBenchmarkRoot !== undefined
					? { underBenchmarkRoot: resolved.underBenchmarkRoot }
					: {}),
				...(benchmarkIdentity !== undefined
					? { benchmarkRootIdentity: benchmarkIdentity }
					: {}),
				provenance: "REAL_PRODUCTION_SEAM",
			};
			handler(this.observation({ ...resolution }));
		} catch {
			// Failure isolation: instrumentation NEVER affects an edit.
		}
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * Report the INDEPENDENT verification of one write.
	 *
	 * The verification is measured by READING THE DESTINATION BACK FROM
	 * DISK, not by re-using the content the executor intended to write.
	 * When the read-back cannot be performed the outcome is UNVERIFIED —
	 * the observation says so explicitly rather than implying success.
	 *
	 * NOTHING here asserts durability: a successful write is not an fsync.
	 */
	async reportWriteVerification(options: {
		readonly absolutePath: string;
		readonly writeReturned: boolean;
		readonly intendedContent?: string;
	}): Promise<void> {
		const handler = this.sink?.onEditWriteVerification;
		if (!handler) {
			return;
		}
		try {
			const fileIdentity = await this.fingerprintPath(options.absolutePath);
			const intendedFingerprint =
				options.intendedContent !== undefined
					? await this.fingerprintContent(options.intendedContent)
					: undefined;

			const readbackAttempted = true;
			let fileExistsAfterWrite = false;
			let actualContentFingerprint: string | undefined;
			let measurementSkippedReason:
				| "MEASUREMENT_SKIPPED_SIZE_LIMIT"
				| "READBACK_UNAVAILABLE"
				| "READBACK_NOT_ATTEMPTED"
				| undefined;

			// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the
			// read-back is BOUNDED. The previous implementation used
			// `fs.readFile()`, which buffers the ENTIRE file into memory
			// before the size limit was checked — so a multi-gigabyte
			// destination made a diagnostic allocate far more than its
			// 512 KiB budget allows. The bounded read requests at most
			// `limit + 1` bytes and never loads the whole file.
			const readBack = await readBackBounded(
				options.absolutePath,
				EDIT_OBSERVATION_MAX_FILE_BYTES,
				(bytes) => this.reportReadBytesRequested(bytes),
			);
			if (readBack.kind === "absent") {
				// The destination does not exist. That is a REAL
				// observation, not a failed measurement.
				fileExistsAfterWrite = false;
				measurementSkippedReason = "READBACK_UNAVAILABLE";
			} else if (readBack.kind === "too_large") {
				// The destination exists but exceeds the size budget:
				// the CONTENT is not measured, the write still happened.
				fileExistsAfterWrite = true;
				measurementSkippedReason = "MEASUREMENT_SKIPPED_SIZE_LIMIT";
			} else if (readBack.kind === "unreadable") {
				// The destination exists but could not be read. The
				// write's outcome is UNVERIFIED — never "succeeded".
				fileExistsAfterWrite = true;
				measurementSkippedReason = "READBACK_UNAVAILABLE";
			} else {
				fileExistsAfterWrite = true;
				actualContentFingerprint = await this.fingerprintContent(
					readBack.content,
				);
			}

			const readbackMatched =
				actualContentFingerprint !== undefined &&
				intendedFingerprint !== undefined
					? actualContentFingerprint === intendedFingerprint
					: undefined;

			// The RESOURCE observation of this read-back: how many bytes the
			// read actually asked the operating system for. A bounded read
			// never asks for more than the ceiling, whatever the
			// destination's size.
			const readBytesRequested = this.readBytesRequested;

			const verification: ModelBehaviorTraceEditWriteVerification = {
				...(this.identity?.toolCallId !== undefined
					? { toolCallId: this.identity.toolCallId }
					: {}),
				toolName: this.toolName,
				...(fileIdentity !== undefined ? { fileIdentity } : {}),
				writeReturned: options.writeReturned,
				readbackAttempted,
				...(readbackMatched !== undefined ? { readbackMatched } : {}),
				fileExistsAfterWrite,
				...(actualContentFingerprint !== undefined
					? { actualContentFingerprint }
					: {}),
				...(intendedFingerprint !== undefined
					? { intendedContentFingerprint: intendedFingerprint }
					: {}),
				...(measurementSkippedReason !== undefined
					? { measurementSkippedReason }
					: {}),
				...(readBytesRequested !== undefined ? { readBytesRequested } : {}),
				provenance: "REAL_PRODUCTION_SEAM",
			};
			handler(this.observation({ ...verification }));
			// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the
			// destination is registered so an explicit CHECKPOINT can
			// re-observe it. The registry holds the raw path in memory
			// only; nothing about it is ever serialized.
			//
			// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02: the
			// destination is registered under the OWNING RUN, so a checkpoint
			// can be attributed to the run that wrote it and two runs that
			// touched the same destination are never merged.
			this.checkpointRegistry.register(
				options.absolutePath,
				actualContentFingerprint,
				{
					...(this.identity?.sessionId !== undefined
						? { sessionId: this.identity.sessionId }
						: {}),
					...(this.identity?.runId !== undefined
						? { runId: this.identity.runId }
						: {}),
				},
			);
		} catch {
			// Failure isolation: instrumentation NEVER affects an edit.
		}
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01.
	 *
	 * Report how many bytes the read-back asked the operating system for.
	 *
	 * This is a RESOURCE observation, not a content observation: it
	 * exists so the boundedness of the read can be witnessed directly,
	 * rather than inferred from a fingerprint. A whole-file read would
	 * report the whole file's size here.
	 *
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02: the count
	 * is REPLACED, not accumulated. Each read-back reports its OWN
	 * requested-byte count; the second read-back of a multi-file patch no
	 * longer reports the SUM of both reads.
	 */
	private reportReadBytesRequested(bytes: number): void {
		this.readBytesRequested = bytes;
	}

	/**
	 * Report the ACTUAL result of the edit attempt.
	 */
	reportApplication(
		outcome: ModelBehaviorTraceEditApplicationOutcome,
		options: {
			failureCategory?: ModelBehaviorTraceEditFailureCategory;
			noOp?: boolean;
			durationMs?: number;
		} = {},
	): void {
		const handler = this.sink?.onEditApplication;
		if (!handler) {
			return;
		}
		const requestedFileCount =
			this.requestedFileCount > 0
				? this.requestedFileCount
				: this.mutations.length;
		const unmutatedFileCount = Math.max(
			0,
			requestedFileCount - this.mutatedFileCount,
		);
		const application: ModelBehaviorTraceEditApplication = {
			outcome,
			// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the
			// tool-call identity is carried on the typed application as well as
			// in the emitted payload, so a consumer that reads the typed
			// object can join the application to its `edit_attempt` by exact
			// identity — never by ordering or timestamp proximity.
			...(this.identity?.toolCallId !== undefined
				? { toolCallId: this.identity.toolCallId }
				: {}),
			...(options.failureCategory !== undefined
				? { failureCategory: options.failureCategory }
				: {}),
			requestedFileCount,
			mutatedFileCount: this.mutatedFileCount,
			unmutatedFileCount,
			noOp: options.noOp ?? this.mutatedFileCount === 0,
			...(this.mutations.length > 0
				? { fileMutations: [...this.mutations] }
				: {}),
			...(options.durationMs !== undefined
				? { durationMs: options.durationMs }
				: {}),
			provenance: "REAL_PRODUCTION_SEAM",
		};
		try {
			handler(this.observation({ ...application }));
		} catch {
			// Failure isolation.
		}
		if (outcome !== "applied" && options.failureCategory !== undefined) {
			this.reportFailure(options.failureCategory, application);
		}
	}

	/**
	 * Report a structural failure category.
	 */
	reportFailure(
		category: ModelBehaviorTraceEditFailureCategory,
		application?: ModelBehaviorTraceEditApplication,
	): void {
		const handler = this.sink?.onEditFailure;
		if (!handler) {
			return;
		}
		try {
			handler(
				this.observation({
					failureCategory: category,
					// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01:
					// the failure carries the SAME tool-call identity as the
					// attempt and the application, so all three links of one
					// edit can be joined by exact identity.
					...(application?.toolCallId !== undefined
						? { toolCallId: application.toolCallId }
						: {}),
					...(application !== undefined
						? {
								mutatedFileCount: application.mutatedFileCount,
								requestedFileCount: application.requestedFileCount,
								unmutatedFileCount: application.unmutatedFileCount,
							}
						: {}),
				}),
			);
		} catch {
			// Failure isolation.
		}
	}

	/** Elapsed time since the observation was created. */
	elapsedMs(): number {
		return Math.max(0, Date.now() - this.startedAt);
	}

	// ------------------------------------------------------------------
	// Internals
	// ------------------------------------------------------------------

	private async measure(
		resolvedPath: string,
		content: string | undefined,
	): Promise<EditFileMeasurement> {
		const fileIdentity = await this.fingerprintPath(resolvedPath);
		if (content === undefined) {
			return { fileIdentity };
		}
		if (Buffer.byteLength(content, "utf8") > EDIT_OBSERVATION_MAX_FILE_BYTES) {
			return {
				...(fileIdentity !== undefined ? { fileIdentity } : {}),
				measurementSkipped: "MEASUREMENT_SKIPPED_SIZE_LIMIT" as const,
			};
		}
		const contentVersion = await this.fingerprintContent(content);
		return {
			...(fileIdentity !== undefined ? { fileIdentity } : {}),
			...(contentVersion !== undefined ? { contentVersion } : {}),
		};
	}

	private async fingerprintPath(
		resolvedPath: string,
	): Promise<string | undefined> {
		const handler = this.sink?.fingerprintFilePath;
		if (!handler) {
			return undefined;
		}
		try {
			const result = handler(resolvedPath);
			return result instanceof Promise ? await result : result;
		} catch {
			return undefined;
		}
	}

	private async fingerprintContent(
		content: string,
	): Promise<string | undefined> {
		const handler = this.sink?.fingerprintFileContent;
		if (!handler) {
			return undefined;
		}
		try {
			const result = handler(content);
			return result instanceof Promise ? await result : result;
		} catch {
			return undefined;
		}
	}

	private observation(
		payload: Record<string, unknown>,
	): ModelBehaviorTraceObservation {
		const identity = this.identity;
		return {
			...(identity?.sessionId !== undefined
				? { sessionId: identity.sessionId }
				: {}),
			...(identity?.taskId !== undefined ? { taskId: identity.taskId } : {}),
			...(identity?.runId !== undefined ? { runId: identity.runId } : {}),
			...(identity?.iteration !== undefined
				? { iteration: identity.iteration }
				: {}),
			...(identity?.providerId !== undefined
				? { providerId: identity.providerId }
				: {}),
			...(identity?.modelId !== undefined ? { modelId: identity.modelId } : {}),
			// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the
			// tool-call identity is forwarded VERBATIM from the trusted
			// tool-context metadata the runtime stamped. It is the ONLY
			// authority that joins an application/failure to its originating
			// `edit_attempt`, so it is never synthesized, inferred, or
			// reconstructed from ordering.
			//
			// When the identity is absent the observation is still emitted —
			// the write really happened — but it carries NO tool-call identity,
			// so the comparator keeps it UNVERIFIED instead of pairing it by
			// timestamp or array adjacency.
			payload: {
				toolName: this.toolName,
				...payload,
				...(identity?.toolCallId !== undefined
					? { toolCallId: identity.toolCallId }
					: {}),
			},
		};
	}
}

/**
 * Read the observation channel out of a tool context's metadata.
 *
 * Returns `undefined` when the trace is OFF or the sink is absent, which
 * is the tracing-OFF fast path: the caller then performs NO measurement
 * and NO extra file read.
 */
export function readEditObservation(
	metadata: Record<string, unknown> | undefined,
	toolName: string,
): EditObservation | undefined {
	if (!metadata) {
		return undefined;
	}
	const sink = metadata[EDIT_OBSERVATION_SINK_METADATA_KEY] as
		| ModelBehaviorTraceSink
		| undefined;
	if (!sink) {
		return undefined;
	}
	const identity = metadata[EDIT_OBSERVATION_IDENTITY_METADATA_KEY] as
		| EditObservationIdentity
		| undefined;
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2): the host
	// hands the workspace identity down so the executor can classify the
	// destination. A malformed value is ignored — the destination scope
	// then stays `unknown` rather than being guessed.
	const workspace = readWorkspaceIdentity(
		metadata[EDIT_OBSERVATION_WORKSPACE_METADATA_KEY],
	);
	const observation = new EditObservation(
		toolName,
		sink,
		identity,
		readEditApprovalOutcome(metadata),
		workspace,
	);
	return observation.active ? observation : undefined;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
 *
 * Read the workspace identity the host handed down.
 *
 * A malformed or partial value yields `undefined` rather than a partial
 * identity: a half-known workspace is worse than an unknown one, because
 * it would make "outside the workspace" look like a verified fact.
 */
function readWorkspaceIdentity(
	value: unknown,
): ModelBehaviorTraceWorkspaceIdentity | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const workspaceRoot =
		typeof record.workspaceRoot === "string" && record.workspaceRoot.trim()
			? record.workspaceRoot
			: undefined;
	const otherWorkspaceRoots = Array.isArray(record.otherWorkspaceRoots)
		? record.otherWorkspaceRoots.filter(
				(item): item is string =>
					typeof item === "string" && item.trim() !== "",
			)
		: undefined;
	const benchmarkRoot =
		typeof record.benchmarkRoot === "string" && record.benchmarkRoot.trim()
			? record.benchmarkRoot
			: undefined;
	if (
		workspaceRoot === undefined &&
		(otherWorkspaceRoots === undefined || otherWorkspaceRoots.length === 0) &&
		benchmarkRoot === undefined
	) {
		return undefined;
	}
	return {
		...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
		...(otherWorkspaceRoots !== undefined && otherWorkspaceRoots.length > 0
			? { otherWorkspaceRoots }
			: {}),
		...(benchmarkRoot !== undefined ? { benchmarkRoot } : {}),
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01.
 *
 * Take a CHECKPOINT observation of the previously observed edit targets.
 *
 * This is the CAPTURE-SCOPED entry point: the host calls it at an explicit
 * operator checkpoint or immediately before a trace dump, and the
 * observation is emitted through the SAME sink the writes were reported
 * through.
 *
 * WHY IT IS NOT AN INLINE POST-WRITE EVENT
 * -----------------------------------------
 * A post-write read-back observes the disk state at the instant of that
 * write. It cannot observe what a LATER command did to the file. The
 * checkpoint is the observation that closes that gap, so it must happen
 * where the current state is actually known — at the checkpoint.
 *
 * The registry it consults holds raw paths IN MEMORY ONLY; only ephemeral
 * fingerprints are reported. The repository is NEVER scanned: only the
 * destinations the write layer actually observed are re-observed.
 *
 * Never throws: a failed checkpoint is a no-op, and the trace then has no
 * checkpoint — which the comparator reports as UNAVAILABLE_FROM_TRACE.
 */
export async function captureEditCheckpoint(
	sink: ModelBehaviorTraceSink | undefined,
): Promise<void> {
	const handler = sink?.onEditCheckpointObservation;
	if (!handler) {
		return;
	}
	try {
		const registry = getEditCheckpointRegistry();
		if (registry.size === 0) {
			// Nothing was observed, so there is nothing to re-observe.
			// An empty checkpoint would be indistinguishable from a
			// missing one, so it is not emitted.
			return;
		}
		const fingerprinting = {
			fingerprintFilePath: async (resolvedPath: string) => {
				const result = sink?.fingerprintFilePath?.(resolvedPath);
				return result instanceof Promise ? await result : result;
			},
			fingerprintFileContent: async (content: string) => {
				const result = sink?.fingerprintFileContent?.(content);
				return result instanceof Promise ? await result : result;
			},
		};
		// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02: the
		// checkpoint is taken PER OWNING RUN.
		//
		// The previous implementation emitted ONE checkpoint for the whole
		// capture and carried NO identity. The comparator's identity-verified
		// scope therefore DROPPED the checkpoint whenever a run was selected
		// (`--m3-run`): the retained-change authority of a selected run was
		// simply absent. Worse, the registry was keyed by path alone, so two
		// runs that wrote the same destination were merged into one target
		// and the checkpoint could not be attributed to either.
		//
		// Now every owner gets its OWN checkpoint, carrying the session and
		// run that own it. Selecting a run keeps that run's checkpoint and
		// drops the other runs'.
		for (const { owner, targets } of registry.ownedTargets()) {
			if (targets.length === 0) {
				continue;
			}
			const observed = await registry.observe(fingerprinting, targets);
			const observation: ModelBehaviorTraceEditCheckpointObservation = {
				...(owner.sessionId !== undefined
					? { sessionId: owner.sessionId }
					: {}),
				...(owner.runId !== undefined ? { runId: owner.runId } : {}),
				observedTargetCount: observed.length,
				targets: observed,
				provenance: "REAL_PRODUCTION_SEAM",
			};
			// The owner identity is carried BOTH in the payload and on the
			// observation ENVELOPE. The envelope is what the recorder stamps
			// onto the trace RECORD, and the record's identity is what the
			// comparator's identity-verified scope reads. Carrying it only
			// in the payload would leave the record unidentified — and an
			// unidentified record is dropped whenever a run is selected.
			handler({
				...(owner.sessionId !== undefined
					? { sessionId: owner.sessionId }
					: {}),
				...(owner.runId !== undefined ? { runId: owner.runId } : {}),
				payload: { ...observation },
			});
		}
	} catch {
		// Failure isolation: a failed checkpoint never breaks a dump.
	}
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01.
 *
 * Drop every registered checkpoint target.
 *
 * The registry holds RAW PATHS in memory, so it is dropped with the
 * capture it belongs to.
 */
export { getEditCheckpointRegistry, resetEditCheckpointRegistry };
