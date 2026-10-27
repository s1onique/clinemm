/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01
 *
 * Model-agnostic flight recorder for observable model behavior.
 *
 * PURPOSE
 * -------
 * Answer, with executable evidence, the question:
 *
 *   "When a model appears to loop, is it actually making repeated model
 *    decisions, encountering runtime failures, losing context, or performing
 *    productive work that merely requires more calls?"
 *
 * The recorder is a CENTRALIZED bounded ring. It is deliberately NOT one
 * ring per subsystem: the whole point is a single interleaved timeline where
 * model requests, tool executions, loop-detector verdicts, and compaction
 * boundaries can be correlated against one another.
 *
 * HARD CONSTRAINTS (see the ACT)
 * ------------------------------
 *   - Default OFF. No records are produced until explicitly enabled.
 *   - Model-agnostic. No provider/model special-casing anywhere.
 *   - Read-only observation. The recorder NEVER changes model requests,
 *     prompts, tool execution, compaction policy, lifecycle authority, or
 *     loop-detector behavior.
 *   - No disk writes until an explicit Dump. The recorder is memory-only.
 *   - Privacy-preserving. No prompt contents, reasoning text, tool
 *     arguments, tool results, credentials, environment values, or raw
 *     request bodies are recorded by default.
 *   - Bounded. Ring capacity is capped by BOTH a record count and a byte
 *     budget; dropped records are REPORTED (count + sequence range), never
 *     silently presented as exhaustive.
 *   - Failure-isolated. A recorder failure must never affect a model call,
 *     tool execution, or lifecycle commit. Every public entry point is
 *     wrapped so a throw degrades to a no-op.
 *
 * EVIDENCE BOUNDARY
 * -----------------
 * Correlation fields are carried on every record. Where an identity is
 * unavailable the field is ABSENT (not guessed) and the record carries an
 * `evidenceBoundary` marker so an analyst can tell "not correlated" apart
 * from "correlated to the wrong thing". Events are NEVER correlated by
 * timestamp alone.
 */

// =============================================================================
// Limits
// =============================================================================

/** Maximum number of records retained in the ring. */
export const MODEL_BEHAVIOR_TRACE_MAX_RECORDS = 8_192;

/** Maximum retained payload size, in bytes, across all records in the ring. */
export const MODEL_BEHAVIOR_TRACE_MAX_BYTES = 4 * 1024 * 1024;

/** Sentinel used wherever a value could not be observed from the runtime. */
export const MODEL_BEHAVIOR_TRACE_UNAVAILABLE =
	"UNAVAILABLE_FROM_TRACE" as const;

// =============================================================================
// Schema
// =============================================================================

/**
 * The correlation identity carried on every record.
 *
 * Every field is optional on purpose: an unavailable identity is omitted
 * rather than invented. `traceId` is always present because it is minted by
 * the recorder itself.
 */
export interface ModelBehaviorTraceIdentity {
	/** Recorder-scoped id. Stable for the lifetime of the recorder. */
	readonly traceId: string;
	/** Host-owned session id, when the producer knows it. */
	readonly sessionId?: string;
	/** Host-owned task id, when the producer knows it. */
	readonly taskId?: string;
	/** Runtime run id, when the producer knows it. */
	readonly runId?: string;
	/** Agent iteration number, when the producer knows it. */
	readonly iteration?: number;
	/** Configured provider id, when known. */
	readonly providerId?: string;
	/** Configured model id, when known. */
	readonly modelId?: string;
}

/**
 * Classification of the evidence boundary for a record.
 *
 * - `observed`            — the record reflects a directly observed runtime fact.
 * - `partial_identity`    — some correlation identities were unavailable.
 * - `no_identity`         — no session/task/run identity was available.
 * - `synthesized`         — the value was derived (e.g. a fingerprint), not raw.
 * - `inferred_budget`     — the effective budget was inferred by the production resolver.
 */
export type ModelBehaviorTraceEvidenceBoundary =
	| "observed"
	| "partial_identity"
	| "no_identity"
	| "synthesized"
	| "inferred_budget";

/** The event kinds the recorder understands. */
export type ModelBehaviorTraceEvent =
	| "model_config"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
	 *
	 * The EFFECTIVE model configuration observed at the model-request
	 * boundary, carrying the real session/run identity.
	 */
	| "effective_model_config"
	| "model_request_start"
	| "model_request_finish"
	| "model_request_error"
	| "model_request_abort"
	| "tool_start"
	| "tool_finish"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * A native edit was REQUESTED. This event says nothing about whether
	 * the file was modified.
	 */
	| "edit_attempt"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * The write layer reported the ACTUAL result of an edit attempt.
	 */
	| "edit_application"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * An edit attempt failed, with a STRUCTURAL failure category.
	 */
	| "edit_failure"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
	 *
	 * The write layer RESOLVED the destination of an edit: where the write
	 * would land relative to the active workspace, whether the destination
	 * already existed, and how the input path was classified.
	 *
	 * This event is the ONLY place the trace learns about a write that
	 * landed OUTSIDE the intended workspace. Without it an absolute-path
	 * write outside the workspace and a write inside it produce IDENTICAL
	 * `edit_application` evidence.
	 */
	| "edit_target_resolved"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * The write layer INDEPENDENTLY verified one write by reading the
	 * destination back from disk.
	 *
	 * This is the ONLY evidence that the bytes the executor INTENDED to
	 * write are actually the bytes on disk.
	 */
	| "edit_write_verification"
	| "loop_verdict"
	| "compaction_diagnostics"
	| "compaction_completed"
	| "run_terminated";

/**
 * One recorded observation.
 *
 * `payload` holds ONLY privacy-safe scalar facts. Raw text, arguments,
 * results, and request bodies are never stored here.
 */
export interface ModelBehaviorTraceRecord extends ModelBehaviorTraceIdentity {
	/** Monotonically increasing sequence number, unique per recorder. */
	readonly seq: number;
	/** ISO-8601 timestamp of the observation. */
	readonly timestamp: string;
	/** What happened. */
	readonly event: ModelBehaviorTraceEvent;
	/** How trustworthy the correlation on this record is. */
	readonly evidenceBoundary: ModelBehaviorTraceEvidenceBoundary;
	/** Privacy-safe scalar facts about the observation. */
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The provenance of the effective input budget.
 *
 * These are the ACTUAL sources the production resolver consults, in
 * precedence order. `fallback_128k` is the production `DEFAULT_MAX_INPUT_TOKENS`
 * fallback used when the model exposes neither an input limit nor a context
 * window.
 */
export type ModelBehaviorTraceBudgetSource =
	| "modelMaxInputTokens"
	| "contextWindow"
	| "userCeiling"
	| "fallback_128k";

/**
 * A snapshot of model configuration.
 *
 * Selected / SDK-resolved / provider-confirmed identities are DISTINCT on
 * purpose. A provider-confirmed identity is only ever populated when the
 * provider actually exposed one — it is never inferred from the request.
 */
export interface ModelBehaviorTraceModelConfig {
	/** What the user selected. */
	readonly selectedProviderId?: string;
	readonly selectedModelId?: string;
	/** What the SDK resolved the request to. */
	readonly runtimeProviderId?: string;
	readonly runtimeModelId?: string;
	/** What the server reported, only when the provider exposed it. */
	readonly providerConfirmedModelId?: string;
	readonly thinkingEnabled?: boolean;
	readonly reasoningEffort?: string;
	readonly temperature?: number;
	readonly topP?: number;
	readonly maxOutputTokens?: number;
	readonly contextWindow?: number;
	readonly maxInputTokens?: number;
	readonly userContextCeiling?: number;
	readonly toolCount?: number;
	readonly toolNames?: readonly string[];
	readonly sourceHead?: string;
	readonly extensionVersion?: string;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2).
	 *
	 * The SHA-256 of the ACTUAL installed `dist/extension.js` bundle bytes.
	 *
	 * This is the artifact identity, NOT the source identity. It is read from
	 * the installed bundle via `resolveInstalledBundleIdentity()`, so it
	 * describes the bytes that actually ran. `sourceHead` remains a SEPARATE
	 * fact: it is informational only, and "unknown" source provenance never
	 * becomes a match on its own.
	 */
	readonly extensionBundleSha256?: string;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3).
	 *
	 * The EFFECTIVE context input budget the production compaction/model
	 * resolver actually applies, together with the provenance of the value
	 * that won.
	 *
	 * - `effectiveMaxInputTokens` — the number the production policy uses.
	 * - `inputBudgetSource` — which input determined it
	 *   (`modelMaxInputTokens` | `contextWindow` | `userCeiling` |
	 *   `fallback_128k`).
	 * - `userContextCeilingMode` — `auto` when the configured ceiling is
	 *   undefined AND the operating mode is the verified Auto mode; `explicit`
	 *   when a numeric ceiling governs. This distinguishes "no ceiling
	 *   configured" (a known operating mode) from "ceiling unknown".
	 */
	readonly effectiveMaxInputTokens?: number;
	readonly inputBudgetSource?: string;
	readonly userContextCeilingMode?: "auto" | "explicit";
}

/**
 * A privacy-preserving, stable-within-trace fingerprint of normalized
 * tool arguments.
 *
 * The fingerprint is an HMAC over a canonicalized argument form, keyed by
 * an EPHEMERAL per-trace random key. That means:
 *   - the same normalized arguments produce the same fingerprint WITHIN one
 *     trace (so repetition is detectable),
 *   - the same arguments produce a DIFFERENT fingerprint ACROSS traces
 *     (so a dump cannot be used as a cross-session rainbow table),
 *   - low-entropy values (a bare filename, a flag, a numeric literal) are
 *     not recoverable by dictionary attack, because the key is unknown.
 */
export interface ModelBehaviorTraceFingerprint {
	readonly fingerprint: string;
	/** Key id of the ephemeral key used; never the key itself. */
	readonly keyId: string;
}

// =============================================================================
// Argument normalization (privacy-preserving)
// =============================================================================

/**
 * Normalize an arbitrary argument value into a canonical, comparable shape
 * WITHOUT retaining the original values.
 *
 * Strategy:
 *   - object keys are sorted (so key order does not change the fingerprint),
 *   - string values are replaced by their TYPE plus a length bucket AND a
 *     KEYED digest of the value (see `fingerprintArguments` — the digest is
 *     an HMAC under an ephemeral per-trace key, so it distinguishes two
 *     different same-length strings WITHOUT exposing either, and cannot be
 *     reversed or dictionary-attacked without the key),
 *   - numeric values keep their exact value ONLY in the digest (the
 *     normalized shape records finiteness, not the number),
 *   - array LENGTHS are preserved (a different number of arguments is a
 *     meaningfully different action),
 *   - nested structures are normalized recursively with a depth cap.
 *
 * The result is deliberately lossy in its STRUCTURE, but the final
 * fingerprint is computed over the canonicalized structure together with
 * the keyed digests, so distinct actions stay distinguishable.
 */
export function normalizeTraceArguments(
	value: unknown,
	depth = 0,
	digest?: (input: string) => string | Promise<string>,
): unknown {
	const MAX_DEPTH = 6;
	if (depth > MAX_DEPTH) {
		return { $depth: "truncated" };
	}
	if (value === null) {
		return { $type: "null" };
	}
	if (value === undefined) {
		return { $type: "undefined" };
	}
	switch (typeof value) {
		case "string":
			return {
				$type: "string",
				$len: lengthBucket(value.length),
				...(digest ? { $digest: digest(value) } : {}),
			};
		case "number":
			return {
				$type: "number",
				$finite: Number.isFinite(value),
				...(digest ? { $digest: digest(String(value)) } : {}),
			};
		case "boolean":
			return { $type: "boolean", $value: value };
		case "bigint":
			return { $type: "bigint" };
		case "symbol":
			return { $type: "symbol" };
		case "function":
			return { $type: "function" };
		default:
			break;
	}
	if (Array.isArray(value)) {
		return {
			$type: "array",
			$len: value.length,
			$items: value.map((item) =>
				normalizeTraceArguments(item, depth + 1, digest),
			),
		};
	}
	if (value instanceof Date) {
		return { $type: "date" };
	}
	if (value instanceof Error) {
		return { $type: "error", $name: value.name };
	}
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = { $type: "object" };
	for (const key of Object.keys(record).sort()) {
		out[key] = normalizeTraceArguments(record[key], depth + 1, digest);
	}
	return out;
}

/**
 * Asynchronously normalize an argument value, awaiting any keyed digests.
 *
 * This is the variant the recorder uses: the keyed digest is an HMAC, which
 * is asynchronous under WebCrypto.
 */
export async function normalizeTraceArgumentsAsync(
	value: unknown,
	digest: (input: string) => Promise<string>,
	depth = 0,
): Promise<unknown> {
	const MAX_DEPTH = 6;
	if (depth > MAX_DEPTH) {
		return { $depth: "truncated" };
	}
	if (value === null) {
		return { $type: "null" };
	}
	if (value === undefined) {
		return { $type: "undefined" };
	}
	switch (typeof value) {
		case "string":
			return {
				$type: "string",
				$len: lengthBucket(value.length),
				$digest: await digest(value),
			};
		case "number":
			return {
				$type: "number",
				$finite: Number.isFinite(value),
				$digest: await digest(String(value)),
			};
		case "boolean":
			return { $type: "boolean", $value: value };
		case "bigint":
			return { $type: "bigint" };
		case "symbol":
			return { $type: "symbol" };
		case "function":
			return { $type: "function" };
		default:
			break;
	}
	if (Array.isArray(value)) {
		const items = await Promise.all(
			value.map((item) =>
				normalizeTraceArgumentsAsync(item, digest, depth + 1),
			),
		);
		return { $type: "array", $len: value.length, $items: items };
	}
	if (value instanceof Date) {
		return { $type: "date" };
	}
	if (value instanceof Error) {
		return { $type: "error", $name: value.name };
	}
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = { $type: "object" };
	for (const key of Object.keys(record).sort()) {
		out[key] = await normalizeTraceArgumentsAsync(
			record[key],
			digest,
			depth + 1,
		);
	}
	return out;
}

/**
 * Bucket a length into a small, non-revealing band.
 *
 * Bands (not exact lengths) keep the fingerprint stable against trivial
 * jitter while still distinguishing materially different argument shapes.
 */
function lengthBucket(length: number): string {
	if (length === 0) return "0";
	if (length <= 4) return "1-4";
	if (length <= 16) return "5-16";
	if (length <= 64) return "17-64";
	if (length <= 256) return "65-256";
	if (length <= 1024) return "257-1024";
	return "1025+";
}

// =============================================================================
// Keyed fingerprint (ephemeral per-trace)
// =============================================================================

/**
 * Minimal HMAC-SHA256 over a string, implemented on top of the platform
 * `crypto` module.
 *
 * This lives in `@cline/shared` (not in the extension) so the SDK core can
 * fingerprint tool arguments with the SAME key material the extension
 * recorder uses — a fingerprint computed in one place and compared in
 * another must agree.
 */
export async function hmacSha256(
	key: string,
	message: string,
): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("model-behavior-trace: WebCrypto subtle is unavailable");
	}
	const encoder = new TextEncoder();
	const keyBytes = await subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await subtle.sign(
		"HMAC",
		keyBytes,
		encoder.encode(message),
	);
	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Stable canonical JSON serialization (sorted keys) for fingerprinting.
 */
export function canonicalizeTraceValue(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalizeTraceValue(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const parts = Object.keys(record)
		.sort()
		.map(
			(key) => `${JSON.stringify(key)}:${canonicalizeTraceValue(record[key])}`,
		);
	return `{${parts.join(",")}}`;
}

// =============================================================================
// Tool categorization
// =============================================================================

/** Coarse tool category. Used for milestone/analysis grouping. */
export type ModelBehaviorTraceToolCategory =
	| "read"
	| "search"
	| "write"
	| "test"
	| "command"
	| "other";

// =============================================================================
// Edit observation schema
// =============================================================================
//
// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01
//
// The edit chain is:
//
//   edit requested → authorized → executor invoked → mutation applied
//     → file revision observed → subsequent revision → verification
//
// Each link has a DIFFERENT authority, and the trace records them as
// SEPARATE events so a generic "tool succeeded" can never be mistaken for
// "a source file was actually modified".
//
// PRIVACY: nothing below carries a raw path, a raw content hash of user
// data, old/new text, a patch body, or a command. File identity is an
// EPHEMERAL keyed fingerprint that is stable within ONE capture and is not
// comparable across captures.

/**
 * The structural kind of edit the model requested.
 *
 * Derived from the TOOL INPUT SHAPE (never from model prose), so the
 * classification is reproducible.
 */
export type ModelBehaviorTraceEditOperation =
	| "create"
	| "replace"
	| "insert"
	| "update"
	| "delete"
	| "move";

/**
 * The authorization state of an edit at the moment the executor boundary
 * was reached.
 *
 * - `approved` — the runtime authorized the tool call.
 * - `rejected` — the runtime DENIED the tool call (user or host policy).
 * - `skipped` — the runtime never asked for authorization because the call
 *   was structurally ineligible (unknown tool, schema-invalid input,
 *   policy-disabled tool, pre-execution recovery breaker).
 * - `unavailable` — the authorization state could not be observed.
 */
export type ModelBehaviorTraceEditApprovalOutcome =
	| "approved"
	| "rejected"
	| "skipped"
	| "unavailable";

/**
 * The structural classification of an edit failure.
 *
 * These categories are produced from TYPED executor results (the SDK's
 * `DiffError` for patch problems, the editor executor's own typed
 * rejections) — NEVER by substring-searching model-generated error prose.
 */
export type ModelBehaviorTraceEditFailureCategory =
	| "text_not_found"
	| "multiple_matches"
	| "invalid_patch"
	| "hunk_mismatch"
	| "path_rejected"
	| "permission_denied"
	| "approval_rejected"
	| "timeout"
	| "runtime_abort"
	| "unknown";

/**
 * The outcome of the write attempt itself.
 *
 * - `applied` — at least one file was actually mutated.
 * - `rejected` — the executor refused the edit (e.g. ambiguous match).
 * - `failed` — the executor ran and the write did not complete.
 * - `timed_out` — the executor exceeded its timeout.
 */
export type ModelBehaviorTraceEditApplicationOutcome =
	| "applied"
	| "rejected"
	| "failed"
	| "timed_out";

/**
 * The provenance of a recorded fact.
 *
 * - `REAL_PRODUCTION_SEAM` — observed at the layer that performs the write.
 * - `INFERRED` — a heuristic derived from correlated observations.
 */
export type ModelBehaviorTraceEvidenceProvenance =
	| "REAL_PRODUCTION_SEAM"
	| "INFERRED";

/**
 * One observed file mutation, reported by the layer that performed the write.
 *
 * The `contentVersion` pair is an EPHEMERAL keyed fingerprint of the file's
 * bytes: `pre` is the version observed before the write, `post` the version
 * observed after it. Equal pre/post values mean the write was a NO-OP.
 */
export interface ModelBehaviorTraceEditFileMutation {
	/**
	 * Ephemeral HMAC of the resolved path. Never the path itself.
	 *
	 * ABSENT when the sink could not compute it; the record then says the
	 * identity is unavailable rather than inventing one.
	 */
	readonly fileIdentity?: string;
	/** Ephemeral fingerprint of the file content BEFORE the write. */
	readonly contentVersionPre?: string;
	/** Ephemeral fingerprint of the file content AFTER the write. */
	readonly contentVersionPost?: string;
	/** Approximate lines added, when safely computable. */
	readonly linesAdded?: number;
	/** Approximate lines removed, when safely computable. */
	readonly linesRemoved?: number;
	/**
	 * True when the measurement was skipped because the file exceeded the
	 * instrumentation's size limit. The write still happened; only the
	 * measurement was skipped.
	 */
	readonly measurementSkipped?: "MEASUREMENT_SKIPPED_SIZE_LIMIT";
}

/**
 * The observed result of ONE edit attempt.
 *
 * `mutatedFileCount` and `requestedFileCount` are kept separate so a
 * PARTIALLY applied multi-file patch is reported accurately: a failure
 * after the first file was written is NOT "zero applied changes".
 */
export interface ModelBehaviorTraceEditApplication {
	/**
	 * The runtime tool-call identity that produced this observation.
	 *
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: this is the
	 * ONLY authority that joins an application/failure to its originating
	 * `edit_attempt`. The runtime stamps the identity into the trusted
	 * tool-context metadata and the executor forwards it verbatim, so the
	 * join is an exact identity match — never a timestamp proximity or an
	 * array adjacency.
	 *
	 * ABSENT when the executor was invoked without a trusted identity (a
	 * sink attached outside the runtime's tool context). Such an observation
	 * stays UNVERIFIED: it is counted on its own, but it is never paired
	 * with an attempt.
	 */
	readonly toolCallId?: string;
	/**
	 * The native editing tool that performed the write: `editor` or
	 * `apply_patch`.
	 *
	 * The two are MUTUALLY EXCLUSIVE in the tool registry, so this field
	 * records WHICH native editing tool was actually available to the
	 * model in this run.
	 */
	readonly toolName?: string;
	/** The structural outcome of the write attempt. */
	readonly outcome: ModelBehaviorTraceEditApplicationOutcome;
	/** Failure category, when the outcome was not `applied`. */
	readonly failureCategory?: ModelBehaviorTraceEditFailureCategory;
	/** How many files the edit REQUESTED. */
	readonly requestedFileCount: number;
	/** How many files were ACTUALLY mutated. */
	readonly mutatedFileCount: number;
	/**
	 * How many requested files were NOT mutated.
	 *
	 * Derived from the executor's own accounting, not from a diff.
	 */
	readonly unmutatedFileCount: number;
	/**
	 * True when every requested file was written but the content is
	 * byte-identical to before (a no-op edit).
	 */
	readonly noOp: boolean;
	/** Per-file pre/post content-version fingerprints. */
	readonly fileMutations?: readonly ModelBehaviorTraceEditFileMutation[];
	/** Elapsed executor duration, in milliseconds. */
	readonly durationMs?: number;
	/** The provenance of this observation. */
	readonly provenance: ModelBehaviorTraceEvidenceProvenance;
}

// =============================================================================
// Edit target resolution schema
// =============================================================================
//
// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2/R3)
//
// WHY THIS EXISTS
// ---------------
// The `edit_application` event answers "did the write call return without an
// error?". It does NOT answer "WHERE did the write land?", and it does NOT
// answer "what is actually on disk afterwards?".
//
// Those two gaps are exactly what makes a benchmark run that produced
// THIRTEEN applied native writes and ZERO retained workspace changes
// unexplainable from the trace alone:
//
//   - the production executor ACCEPTS an absolute input path without any
//     containment check, so an out-of-workspace write is indistinguishable
//     from an in-workspace write in the existing evidence;
//   - the existing `contentVersionPost` is the fingerprint of the content
//     the executor INTENDED to write, not of the bytes on disk, so it can
//     never contradict a successful write.
//
// The types below close both gaps with BOUNDED, PRIVACY-SAFE facts. No raw
// absolute path, no relative path, no file content and no source text is
// ever carried: identities are EPHEMERAL keyed HMACs computed by the sink.

/**
 * How the executor's INPUT path was classified before resolution.
 *
 * - `relative` — the model supplied a path relative to the executor's
 *   working directory.
 * - `absolute` — the model supplied an absolute path. This is the
 *   classification that MATTERS: the production executor accepts an
 *   absolute path as-is, so an absolute path is the only way a native
 *   write can land outside the workspace without an error.
 */
export type ModelBehaviorTraceEditPathInputKind = "relative" | "absolute";

/**
 * Where the resolved destination sits relative to the ACTIVE workspace.
 *
 * - `active_workspace` — the canonical destination is under the active
 *   workspace root.
 * - `other_workspace` — the canonical destination is under a DIFFERENT
 *   known workspace root.
 * - `outside_workspace` — the canonical destination is outside every known
 *   workspace root.
 * - `unknown` — the destination could not be classified (no workspace
 *   identity was available to the executor).
 */
export type ModelBehaviorTraceEditDestinationScope =
	| "active_workspace"
	| "other_workspace"
	| "outside_workspace"
	| "unknown";

/**
 * The MARKER used when the destination scope could not be established.
 *
 * A missing canonicalization is NEVER silently reported as "inside the
 * workspace": the trace records the failure to verify instead.
 */
export const MODEL_BEHAVIOR_TRACE_PATH_SCOPE_UNVERIFIED =
	"PATH_SCOPE_UNVERIFIED" as const;

/**
 * The resolution of ONE edit destination.
 *
 * Every field is privacy-safe: the workspace identity and the file identity
 * are EPHEMERAL keyed fingerprints, and the destination itself is described
 * only by its SCOPE relative to the workspace.
 */
export interface ModelBehaviorTraceEditTargetResolution {
	/**
	 * The runtime tool-call identity that produced this observation.
	 *
	 * The SAME identity the `edit_attempt` / `edit_application` events
	 * carry, so all three links of one edit join by EXACT identity.
	 */
	readonly toolCallId?: string;
	/** The native editing tool that resolved the destination. */
	readonly toolName?: string;
	/** How the INPUT path was classified. */
	readonly inputPathKind: ModelBehaviorTraceEditPathInputKind;
	/**
	 * The ephemeral fingerprint of the ACTIVE workspace root.
	 *
	 * ABSENT when the executor had no workspace identity. It is an
	 * HMAC of the canonical workspace path — never the path itself.
	 */
	readonly workspaceIdentity?: string;
	/**
	 * The ephemeral fingerprint of the EXECUTOR's working directory.
	 *
	 * This is NOT necessarily the workspace: the production tool
	 * definitions default `cwd` to `process.cwd()`, which in the VS Code
	 * extension host is frequently NOT the workspace root. Recording the
	 * two identities separately is what makes the difference visible.
	 */
	readonly executorCwdIdentity?: string;
	/**
	 * The canonical scope of the resolved destination.
	 */
	readonly destinationScope: ModelBehaviorTraceEditDestinationScope;
	/**
	 * True when the destination was canonically resolved (symlinks
	 * followed) and the scope was therefore established from the REAL
	 * target rather than from a lexical guess.
	 */
	readonly canonicalized: boolean;
	/**
	 * True when the destination file EXISTED before the operation.
	 *
	 * This is what separates a genuine NEW-file creation from an
	 * OVERWRITE of an existing file. A `create` operation applied to an
	 * already-existing file is an overwrite, and the trace must not
	 * report it as a new file.
	 */
	readonly destinationExistedBefore: boolean;
	/**
	 * True when the resolved destination was under the DESIGNATED
	 * benchmark root (the root the operator nominated for the run).
	 *
	 * When no benchmark root was designated this field is ABSENT, and the
	 * `benchmarkRootIdentity` is absent too — "no benchmark root" is
	 * never reported as "outside the benchmark root".
	 */
	readonly underBenchmarkRoot?: boolean;
	/**
	 * The ephemeral fingerprint of the designated benchmark root.
	 */
	readonly benchmarkRootIdentity?: string;
	/** The provenance of this resolution. */
	readonly provenance: ModelBehaviorTraceEvidenceProvenance;
}

/**
 * The INDEPENDENT verification of one write, measured from disk.
 *
 * The distinction this type exists to preserve:
 *
 * - the INTENDED fingerprint is what the executor calculated from the
 *   content it was about to write;
 * - the ACTUAL fingerprint is what an INDEPENDENT read-back observed on
 *   disk afterwards.
 *
 * When they differ, the write landed somewhere else (or was rewritten).
 * When the read-back could not be performed, the outcome is UNVERIFIED —
 * never "succeeded".
 *
 * NOTHING in this type asserts DURABILITY. A successful write is not an
 * fsync, and a successful read-back is not a proof that the bytes survive a
 * power loss. The type deliberately has no durability field.
 */
export interface ModelBehaviorTraceEditWriteVerification {
	/** The runtime tool-call identity. */
	readonly toolCallId?: string;
	/** The native editing tool that performed the write. */
	readonly toolName?: string;
	/** The ephemeral fingerprint of the file the write targeted. */
	readonly fileIdentity?: string;
	/** True when the write call returned without throwing. */
	readonly writeReturned: boolean;
	/** True when an independent read-back was actually attempted. */
	readonly readbackAttempted: boolean;
	/**
	 * True when the independent read-back observed the SAME bytes the
	 * executor intended to write.
	 *
	 * False when the read-back observed DIFFERENT bytes. ABSENT when the
	 * read-back was not attempted or did not complete.
	 */
	readonly readbackMatched?: boolean;
	/**
	 * True when the destination file EXISTED when the read-back ran.
	 *
	 * A file that was created and then deleted reports `false` here — it
	 * is NOT evidence of a retained change.
	 */
	readonly fileExistsAfterWrite: boolean;
	/**
	 * The fingerprint of the content actually observed on disk.
	 *
	 * This is the INDEPENDENTLY MEASURED fingerprint, never the
	 * intended one.
	 */
	readonly actualContentFingerprint?: string;
	/**
	 * The fingerprint of the content the executor INTENDED to write.
	 *
	 * Present so a consumer can compare it against the actual one
	 * WITHOUT re-deriving the intent.
	 */
	readonly intendedContentFingerprint?: string;
	/**
	 * Why the measurement was skipped, when it was.
	 *
	 * - `MEASUREMENT_SKIPPED_SIZE_LIMIT` — the file exceeded the
	 *   instrumentation's size budget.
	 * - `READBACK_UNAVAILABLE` — the destination could not be read back
	 *   (it was removed between the write and the read, or the read
	 *   failed). The write's outcome is then UNVERIFIED.
	 * - `READBACK_NOT_ATTEMPTED` — the read-back was not performed.
	 */
	readonly measurementSkippedReason?:
		| "MEASUREMENT_SKIPPED_SIZE_LIMIT"
		| "READBACK_UNAVAILABLE"
		| "READBACK_NOT_ATTEMPTED";
	/**
	 * The provenance of the verification.
	 *
	 * `REAL_PRODUCTION_SEAM` means the read-back was a real filesystem
	 * read performed by the write layer.
	 */
	readonly provenance: ModelBehaviorTraceEvidenceProvenance;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
 *
 * The tool-context metadata key that carries the trace sink into the
 * executor.
 *
 * The runtime stamps the sink onto every `AgentToolContext`'s metadata,
 * so the executor can reach the observation channel WITHOUT changing the
 * public `EditorExecutor` / `ApplyPatchExecutor` signatures and WITHOUT
 * adding a public protocol field.
 */
export const EDIT_OBSERVATION_SINK_METADATA_KEY =
	"__clineModelBehaviorTraceSink";

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
 *
 * The tool-context metadata key that carries the correlation identity
 * (session / run / tool call) into the executor.
 */
export const EDIT_OBSERVATION_IDENTITY_METADATA_KEY =
	"__clineModelBehaviorTraceIdentity";

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
 *
 * The tool-context metadata key that carries the AUTHORIZATION OUTCOME
 * into the executor.
 *
 * The runtime is the authority for whether a tool call was authorized:
 * only it knows whether the host denied the call, whether the tool was
 * policy-disabled, and whether the approval round-trip happened at all.
 * The executor cannot infer any of that, so the runtime hands the
 * structural answer down through the tool context.
 */
export const EDIT_OBSERVATION_APPROVAL_METADATA_KEY =
	"__clineModelBehaviorTraceApprovalOutcome";

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
 *
 * The tool-context metadata key that carries the WORKSPACE IDENTITY into the
 * executor.
 *
 * The executor is the only layer that knows the RESOLVED destination, so it
 * is the only layer that can classify a destination as inside or outside the
 * workspace. It needs the workspace root to do that, and the host owns the
 * workspace root — so the host hands it down here.
 *
 * The value is a plain object of ABSOLUTE PATHS. It is consumed INSIDE the
 * executor to compute SCOPES and EPHEMERAL fingerprints; it is never
 * forwarded to the sink and never recorded.
 */
export const EDIT_OBSERVATION_WORKSPACE_METADATA_KEY =
	"__clineModelBehaviorTraceWorkspace";

/**
 * The workspace identity the host hands down to the executor.
 *
 * Only the paths are carried — the executor is responsible for reducing
 * them to scopes and ephemeral fingerprints before anything is reported.
 */
export interface ModelBehaviorTraceWorkspaceIdentity {
	/**
	 * The ACTIVE workspace root — the root the operator is working in.
	 */
	readonly workspaceRoot?: string;
	/**
	 * Every OTHER known workspace root (a multi-root VS Code workspace).
	 *
	 * A destination under one of these is `other_workspace`, not
	 * `outside_workspace`.
	 */
	readonly otherWorkspaceRoots?: readonly string[];
	/**
	 * The DESIGNATED benchmark root for the run.
	 *
	 * The root whose retained changes the benchmark actually measures. It
	 * is frequently the same as `workspaceRoot`, but it is carried
	 * separately because "the workspace the agent was given" and "the
	 * workspace the benchmark measures" are different questions.
	 */
	readonly benchmarkRoot?: string;
}

/**
 * The structural description of a requested native edit.
 *
 * Produced from the tool INPUT SHAPE alone. No content is retained.
 */
export interface ModelBehaviorTraceEditRequestShape {
	/** The structural kind of edit requested. */
	readonly operation: ModelBehaviorTraceEditOperation;
	/** How many files the edit targeted. */
	readonly targetCount: number;
	/** The SIZE of the requested edit, in characters. */
	readonly requestedChars: number;
	/**
	 * The path to fingerprint, when the input carries a resolvable path.
	 *
	 * The path is handed to the SINK (which owns the key) and is never
	 * retained by the caller.
	 */
	readonly resolvedPath?: string;
}

/**
 * Describe a native edit request from its tool input.
 *
 * `editor` input carries a `path`, an optional `old_text`, an optional
 * `new_text` and an optional `insert_line`. `apply_patch` input carries a
 * freeform patch body.
 *
 * The description is purely structural: the patch body is scanned for
 * MARKERS and for the count of targets, but neither the body nor any
 * path is retained in the result beyond the single path the caller needs
 * to hand to the sink for fingerprinting.
 */
export function describeEditRequest(
	toolName: string,
	input: unknown,
): ModelBehaviorTraceEditRequestShape {
	if (toolName === "apply_patch") {
		const patchText =
			typeof input === "string"
				? input
				: typeof (input as { input?: unknown } | undefined)?.input === "string"
					? (input as { input: string }).input
					: "";
		return {
			operation: classifyPatchOperationShape(patchText),
			targetCount: countPatchTargetsShape(patchText),
			requestedChars: patchText.length,
		};
	}
	const record = (input ?? {}) as {
		path?: unknown;
		old_text?: unknown;
		new_text?: unknown;
		insert_line?: unknown;
	};
	let requestedChars = 0;
	if (typeof record.old_text === "string") {
		requestedChars += record.old_text.length;
	}
	if (typeof record.new_text === "string") {
		requestedChars += record.new_text.length;
	}
	return {
		operation:
			record.insert_line != null
				? "insert"
				: record.old_text == null
					? "create"
					: "replace",
		targetCount: 1,
		requestedChars,
		...(typeof record.path === "string" ? { resolvedPath: record.path } : {}),
	};
}

/**
 * The structural kind of an `apply_patch` request.
 *
 * A patch MAY target several files with different actions. The reported
 * operation is the DOMINANT one — the action that covers the most
 * targets — so a mixed patch is not mislabelled by whichever marker
 * happens to appear first in the text. Ties are broken by the fixed
 * order below, which is deterministic.
 */
export function classifyPatchOperationShape(
	patchText: string,
): ModelBehaviorTraceEditOperation {
	const counts = {
		create: countPatchTargetsShape(patchText, "*** Add File:"),
		update: countPatchTargetsShape(patchText, "*** Update File:"),
		delete: countPatchTargetsShape(patchText, "*** Delete File:"),
	};
	if (
		counts.update > 0 &&
		counts.update >= counts.create &&
		counts.update >= counts.delete
	) {
		return "update";
	}
	if (counts.create > 0 && counts.create > counts.delete) {
		return "create";
	}
	if (counts.delete > 0) {
		return "delete";
	}
	if (patchText.includes("*** Move to:")) {
		return "move";
	}
	return "update";
}

/**
 * How many distinct files an `apply_patch` request targets.
 *
 * When a `marker` is supplied only that action's targets are counted.
 */
export function countPatchTargetsShape(
	patchText: string,
	marker?: string,
): number {
	const markers = marker
		? [marker]
		: ["*** Add File:", "*** Update File:", "*** Delete File:"];
	const targets = new Set<string>();
	for (const line of patchText.split("\n")) {
		const trimmed = line.trim();
		for (const candidate of markers) {
			if (trimmed.startsWith(candidate)) {
				targets.add(trimmed.slice(candidate.length).trim());
			}
		}
	}
	return targets.size;
}

/**
 * The STRUCTURE of one requested native edit.
 *
 * This is the "edit requested" link of the chain. It deliberately does NOT
 * say whether the edit was applied.
 */
export interface ModelBehaviorTraceEditAttempt {
	/** The actual runtime tool-call identity. */
	readonly toolCallId: string;
	/** `editor` or `apply_patch`. */
	readonly toolName: string;
	/** The structural kind of edit requested. */
	readonly operation: ModelBehaviorTraceEditOperation;
	/**
	 * Ephemeral HMAC of the resolved path.
	 *
	 * For a MULTI-file patch this is the identity of the FIRST targeted
	 * file; the per-file identities are reported in the application event.
	 */
	readonly fileIdentity: string;
	/** How many files the edit targeted. */
	readonly targetCount: number;
	/**
	 * The SIZE of the requested edit, in characters.
	 *
	 * This is a LENGTH, never the text itself.
	 */
	readonly requestedChars: number;
	/** The authorization state observed at the executor boundary. */
	readonly approvalOutcome: ModelBehaviorTraceEditApprovalOutcome;
	/** Whether the executor was actually invoked. */
	readonly executionInvoked: boolean;
}

/**
 * Classify a tool by NAME only (never by its arguments).
 *
 * Name-based classification is model-agnostic and does not inspect content.
 * The mapping is deliberately coarse and order-sensitive: the first match
 * wins, so more specific categories are checked first.
 */
export function categorizeTraceTool(
	toolName: string,
): ModelBehaviorTraceToolCategory {
	// Tool names are conventionally snake_case or kebab-case, so the word
	// boundary must treat `_` and `-` as separators (the default `\b` does
	// not: `_` is a word character).
	const name = toolName.toLowerCase().replace(/[_\-.]+/g, " ");
	if (
		/(^| )(test|tests|spec|specs|jest|vitest|pytest|mocha|go test|cargo test)( |$)/.test(
			name,
		)
	) {
		return "test";
	}
	if (
		/(^| )(search|grep|glob|find|list|ls|ripgrep|codebase|explore)( |$)/.test(
			name,
		)
	) {
		return "search";
	}
	if (/(^| )(read|cat|view|open|get file|load)( |$)/.test(name)) {
		return "read";
	}
	if (
		/(^| )(write|edit|create|delete|remove|replace|apply patch|patch|insert|update)( |$)/.test(
			name,
		)
	) {
		return "write";
	}
	if (
		/(^| )(command|bash|shell|exec|execute|run|terminal|process)( |$)/.test(
			name,
		)
	) {
		return "command";
	}
	return "other";
}

// =============================================================================
// Recorder
// =============================================================================

/** Options accepted by {@link ModelBehaviorTraceRecorder}. */
export interface ModelBehaviorTraceRecorderOptions {
	/** Max retained records. Defaults to {@link MODEL_BEHAVIOR_TRACE_MAX_RECORDS}. */
	readonly maxRecords?: number;
	/** Max retained bytes. Defaults to {@link MODEL_BEHAVIOR_TRACE_MAX_BYTES}. */
	readonly maxBytes?: number;
	/**
	 * Ephemeral fingerprint key. When omitted the recorder mints one.
	 * Tests may inject a fixed key to make fingerprints deterministic.
	 */
	readonly fingerprintKey?: string;
	/** Stable trace id. When omitted the recorder mints one. */
	readonly traceId?: string;
	/** Clock injection point for deterministic tests. */
	readonly now?: () => number;
}

/**
 * What a Dump reports about the ring's completeness.
 *
 * The ACT requires that an incomplete trace is NEVER silently presented as
 * exhaustive. Every dump carries this block.
 */
export interface ModelBehaviorTraceTruncation {
	/** True when at least one record was dropped from the ring. */
	readonly truncated: boolean;
	/** How many records were dropped. */
	readonly droppedCount: number;
	/** Lowest dropped sequence number, when any were dropped. */
	readonly droppedFromSeq?: number;
	/** Highest dropped sequence number, when any were dropped. */
	readonly droppedToSeq?: number;
	/** Total records ever accepted by the recorder. */
	readonly totalRecorded: number;
	/** Records currently retained in the ring. */
	readonly retainedCount: number;
	/** Approximate retained bytes. */
	readonly retainedBytes: number;
}

/** A dump payload: the records plus their completeness metadata. */
export interface ModelBehaviorTraceDump {
	readonly traceId: string;
	readonly records: readonly ModelBehaviorTraceRecord[];
	readonly truncation: ModelBehaviorTraceTruncation;
	/** ISO timestamp of the dump. */
	readonly dumpedAt: string;
}

/**
 * The centralized bounded recorder.
 *
 * Failure isolation: every public method catches its own errors. A recorder
 * failure degrades to a no-op and never propagates into a model call, a
 * tool execution, or a lifecycle commit.
 */
export class ModelBehaviorTraceRecorder {
	private readonly records: ModelBehaviorTraceRecord[] = [];
	private readonly maxRecords: number;
	private readonly maxBytes: number;
	private readonly now: () => number;
	private readonly fingerprintKey: string;
	private readonly fingerprintKeyId: string;

	private enabled = false;
	private nextSeq = 1;
	private totalRecorded = 0;
	private retainedBytes = 0;
	private droppedCount = 0;
	private droppedFromSeq: number | undefined;
	private droppedToSeq: number | undefined;
	private readonly traceId: string;

	constructor(options: ModelBehaviorTraceRecorderOptions = {}) {
		this.maxRecords = Math.max(
			1,
			options.maxRecords ?? MODEL_BEHAVIOR_TRACE_MAX_RECORDS,
		);
		this.maxBytes = Math.max(
			1,
			options.maxBytes ?? MODEL_BEHAVIOR_TRACE_MAX_BYTES,
		);
		this.now = options.now ?? (() => Date.now());
		this.traceId = options.traceId ?? mintTraceId();
		this.fingerprintKey = options.fingerprintKey ?? mintFingerprintKey();
		this.fingerprintKeyId = mintKeyId(this.fingerprintKey);
	}

	/** The recorder-scoped trace id. */
	getTraceId(): string {
		return this.traceId;
	}

	/** True when the recorder is armed. */
	isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Arm or disarm the recorder.
	 *
	 * Disarming NEVER clears the buffer — the operator must still be able to
	 * dump evidence captured before the toggle.
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Record one observation.
	 *
	 * Returns the stored record, or `undefined` when the recorder is OFF or
	 * the record failed to serialize. Never throws.
	 */
	record(
		event: ModelBehaviorTraceEvent,
		identity: Omit<ModelBehaviorTraceIdentity, "traceId">,
		payload: Record<string, unknown> = {},
		options: {
			readonly evidenceBoundary?: ModelBehaviorTraceEvidenceBoundary;
		} = {},
	): ModelBehaviorTraceRecord | undefined {
		if (!this.enabled) {
			return undefined;
		}
		try {
			const seq = this.nextSeq++;
			const record: ModelBehaviorTraceRecord = {
				seq,
				timestamp: new Date(this.now()).toISOString(),
				traceId: this.traceId,
				event,
				evidenceBoundary:
					options.evidenceBoundary ?? classifyEvidenceBoundary(identity),
				...(identity.sessionId !== undefined
					? { sessionId: identity.sessionId }
					: {}),
				...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
				...(identity.runId !== undefined ? { runId: identity.runId } : {}),
				...(identity.iteration !== undefined
					? { iteration: identity.iteration }
					: {}),
				...(identity.providerId !== undefined
					? { providerId: identity.providerId }
					: {}),
				...(identity.modelId !== undefined
					? { modelId: identity.modelId }
					: {}),
				payload: sanitizePayload(payload),
			};
			this.append(record);
			return record;
		} catch {
			// Failure isolation: a recorder bug must never affect production.
			return undefined;
		}
	}

	/**
	 * Compute a stable-within-trace fingerprint of normalized arguments.
	 *
	 * Returns `undefined` when the recorder is OFF or the fingerprint could
	 * not be computed. Never throws.
	 */
	async fingerprintArguments(
		toolName: string,
		input: unknown,
	): Promise<ModelBehaviorTraceFingerprint | undefined> {
		if (!this.enabled) {
			return undefined;
		}
		try {
			// A per-call keyed digest lets two DIFFERENT same-length values
			// produce different fingerprints without exposing either: the HMAC
			// key is ephemeral and never leaves the recorder, so the digest
			// cannot be reversed or dictionary-attacked from a dump.
			const digest = (input: string) =>
				hmacSha256(this.fingerprintKey, `v:${input}`).then((value) =>
					value.slice(0, 32),
				);
			const normalized = await normalizeTraceArgumentsAsync(input, digest);
			const message = `${toolName}${canonicalizeTraceValue(normalized)}`;
			const fingerprint = await hmacSha256(this.fingerprintKey, message);
			return { fingerprint, keyId: this.fingerprintKeyId };
		} catch {
			return undefined;
		}
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Compute a stable-within-capture fingerprint of a RESOLVED FILE PATH.
	 *
	 * The path is NEVER retained: only the keyed digest leaves this method.
	 * The digest is stable within ONE capture (so a file's revisions can be
	 * correlated) and is NOT comparable across captures, because the key is
	 * minted per recorder and never persisted.
	 *
	 * Returns `undefined` when the recorder is OFF. Never throws.
	 */
	async fingerprintFilePath(resolvedPath: string): Promise<string | undefined> {
		if (!this.enabled) {
			return undefined;
		}
		try {
			// The digest is TRUNCATED to 32 hex characters so it always
			// survives the payload sanitizer's length ceiling (a 64-char
			// SHA-256 digest would sit exactly on the boundary). The
			// truncation is still collision-free for a single capture's
			// file set.
			return (
				await hmacSha256(this.fingerprintKey, `path:${resolvedPath}`)
			).slice(0, 32);
		} catch {
			return undefined;
		}
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Compute a stable-within-capture fingerprint of FILE CONTENT.
	 *
	 * Used to detect a file REVISION (content version changed) and a NO-OP
	 * write (pre and post versions identical). The content is NEVER
	 * retained: only the keyed digest leaves this method.
	 *
	 * Returns `undefined` when the recorder is OFF. Never throws.
	 */
	async fingerprintFileContent(content: string): Promise<string | undefined> {
		if (!this.enabled) {
			return undefined;
		}
		try {
			// See `fingerprintFilePath`: truncated to stay under the
			// sanitizer's length ceiling.
			return (
				await hmacSha256(this.fingerprintKey, `content:${content}`)
			).slice(0, 32);
		} catch {
			return undefined;
		}
	}

	/** The retained records, oldest first. */
	getRecords(): readonly ModelBehaviorTraceRecord[] {
		return this.records;
	}
	/** How many records are currently retained. */
	getRecordCount(): number {
		return this.records.length;
	}

	/** The completeness metadata for the current ring state. */
	getTruncation(): ModelBehaviorTraceTruncation {
		return {
			truncated: this.droppedCount > 0,
			droppedCount: this.droppedCount,
			...(this.droppedFromSeq !== undefined
				? { droppedFromSeq: this.droppedFromSeq }
				: {}),
			...(this.droppedToSeq !== undefined
				? { droppedToSeq: this.droppedToSeq }
				: {}),
			totalRecorded: this.totalRecorded,
			retainedCount: this.records.length,
			retainedBytes: this.retainedBytes,
		};
	}

	/** Build the dump payload (records + completeness metadata). */
	dump(): ModelBehaviorTraceDump {
		return {
			traceId: this.traceId,
			records: [...this.records],
			truncation: this.getTruncation(),
			dumpedAt: new Date(this.now()).toISOString(),
		};
	}

	/**
	 * Reset the recorder to a pristine state. Test seam only — production
	 * code never calls this.
	 */
	_reset(): void {
		this.records.length = 0;
		this.enabled = false;
		this.nextSeq = 1;
		this.totalRecorded = 0;
		this.retainedBytes = 0;
		this.droppedCount = 0;
		this.droppedFromSeq = undefined;
		this.droppedToSeq = undefined;
	}

	// --------------------------------------------------------------------------
	// Internals
	// --------------------------------------------------------------------------

	private append(record: ModelBehaviorTraceRecord): void {
		const size = estimateRecordBytes(record);
		this.totalRecorded += 1;
		this.records.push(record);
		this.retainedBytes += size;

		// Evict oldest records until BOTH bounds are satisfied. A single
		// oversized record still gets evicted so the ring cannot grow without
		// bound.
		while (
			this.records.length > this.maxRecords ||
			(this.retainedBytes > this.maxBytes && this.records.length > 1)
		) {
			const evicted = this.records.shift();
			if (!evicted) {
				break;
			}
			this.retainedBytes -= estimateRecordBytes(evicted);
			this.droppedCount += 1;
			this.droppedFromSeq =
				this.droppedFromSeq === undefined
					? evicted.seq
					: Math.min(this.droppedFromSeq, evicted.seq);
			this.droppedToSeq =
				this.droppedToSeq === undefined
					? evicted.seq
					: Math.max(this.droppedToSeq, evicted.seq);
		}
	}
}

// =============================================================================
// Module helpers
// =============================================================================

/**
 * Keys that MUST NEVER be written into a trace payload.
 *
 * The recorder's privacy guarantee is enforced structurally: the payload
 * sanitizer drops these keys rather than trusting callers to omit them.
 * The list is deliberately broad — a key whose NAME suggests it could carry
 * user content or a secret is dropped even if a particular value would
 * happen to be harmless.
 */
const FORBIDDEN_PAYLOAD_KEYS = new Set([
	"apikey",
	"api_key",
	"auth",
	"authorization",
	"body",
	"command",
	"content",
	"credential",
	"credentials",
	"env",
	"environment",
	"input",
	"message",
	"messages",
	"output",
	"password",
	"path",
	"prompt",
	"raw",
	"reasoning",
	"request",
	"requestbody",
	"request_body",
	"response",
	"result",
	"secret",
	"stderr",
	"stdout",
	"systemprompt",
	"system_prompt",
	"text",
	"thinking",
	"token",
	"tokens",
	"value",
]);

/**
 * Strip non-privacy-safe values from a payload.
 *
 * Allowed value shapes: `undefined`, `null`, booleans, finite numbers,
 * strings that are short AND not obviously content-bearing, and arrays of
 * allowed scalars. Everything else is replaced by a type marker.
 */
export function sanitizePayload(
	payload: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(payload)) {
		const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey)) {
			out[key] = "[REDACTED_BY_TRACE_SCHEMA]";
			continue;
		}
		out[key] = sanitizePayloadValue(payload[key]);
	}
	return out;
}

function sanitizePayloadValue(value: unknown): unknown {
	if (value === undefined || value === null) {
		return value;
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : String(value);
	}
	if (typeof value === "string") {
		// Long strings are the classic carrier for raw content. Only short
		// opaque identifiers survive.
		return value.length <= 64 ? value : `[STRING:${value.length}]`;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 64).map((item) => sanitizePayloadValue(item));
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(record).slice(0, 64)) {
			out[key] = sanitizePayloadValue(record[key]);
		}
		return out;
	}
	return `[${typeof value}]`;
}

/**
 * Classify the evidence boundary implied by the available identities.
 *
 * A record with no session/task/run identity cannot be correlated to a
 * specific execution and must say so.
 */
export function classifyEvidenceBoundary(
	identity: Omit<ModelBehaviorTraceIdentity, "traceId">,
): ModelBehaviorTraceEvidenceBoundary {
	const hasSession = identity.sessionId !== undefined;
	const hasTask = identity.taskId !== undefined;
	const hasRun = identity.runId !== undefined;
	if (!hasSession && !hasTask && !hasRun) {
		return "no_identity";
	}
	if (hasSession && hasTask && hasRun) {
		return "observed";
	}
	return "partial_identity";
}

/**
 * Approximate the retained byte cost of a record.
 *
 * Uses the serialized length so the byte cap reflects what the dump will
 * actually cost on disk.
 */
export function estimateRecordBytes(record: ModelBehaviorTraceRecord): number {
	try {
		return JSON.stringify(record).length;
	} catch {
		return 256;
	}
}

/**
 * Mint a random, opaque trace id.
 */
export function mintTraceId(): string {
	const bytes = new Uint8Array(12);
	globalThis.crypto.getRandomValues(bytes);
	return `mbt_${hex(bytes)}`;
}

/**
 * Mint an ephemeral fingerprint key.
 *
 * The key NEVER leaves the recorder; only a short key id (derived from it)
 * is exposed on fingerprints, so two fingerprints can be shown to belong to
 * the same key without the key itself being recoverable.
 */
export function mintFingerprintKey(): string {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return hex(bytes);
}

/**
 * Derive a short, non-reversible key id from a fingerprint key.
 */
export function mintKeyId(key: string): string {
	// A short prefix of a non-cryptographic hash is sufficient here: the key
	// id is a LABEL, not a secret, and the key itself is never exposed.
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `k_${hash.toString(16).padStart(8, "0")}`;
}

function hex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// SDK observation sink
// =============================================================================

/**
 * The observation contract the SDK core calls into.
 *
 * This is intentionally a NARROW, read-only interface: the SDK reports what
 * it observed and the sink decides whether to record it. The SDK never
 * reads back a decision, so the sink can NEVER influence execution.
 *
 * Every method is optional so a partially-implemented sink still compiles.
 */
export interface ModelBehaviorTraceSink {
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: report whether tracing is
	 * currently ARMED.
	 *
	 * This is a pure, synchronous, side-effect-free read of the recorder's
	 * enable bit. It exists so the runtime can take a SYNCHRONOUS fast path
	 * when tracing is OFF: without it, the runtime would have to `await` the
	 * fingerprint promise on every tool call, and that `await` introduces an
	 * extra microtask suspension point between the tool-start boundary and
	 * the tool execution even when the recorder is inert.
	 *
	 * When this is ABSENT the runtime conservatively awaits the fingerprint
	 * (it cannot prove tracing is off), so behavior is unchanged for sinks
	 * that do not implement the signal.
	 */
	isTraceEnabled?: () => boolean;
	/**
	 * Compute a privacy-preserving fingerprint of a tool call's arguments.
	 *
	 * The SDK passes the RAW arguments here and the implementation returns
	 * only the fingerprint. The implementation MUST NOT retain the raw
	 * arguments. This keeps the ephemeral fingerprint key inside the
	 * recorder (which owns it) while still letting the SDK compute the
	 * fingerprint at the tool boundary.
	 */
	fingerprintToolArguments?: (
		toolName: string,
		input: unknown,
	) => Promise<string | undefined> | string | undefined;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Compute a privacy-preserving fingerprint of a RESOLVED FILE PATH.
	 *
	 * The SDK passes the resolved absolute path and receives only the
	 * fingerprint. The implementation MUST NOT retain the path. The
	 * fingerprint is an EPHEMERAL keyed HMAC: it is stable within ONE
	 * capture (so a file's revisions can be correlated) and is NOT
	 * comparable across captures (the key is per-recorder and never
	 * persisted).
	 */
	fingerprintFilePath?: (
		resolvedPath: string,
	) => Promise<string | undefined> | string | undefined;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Compute a privacy-preserving fingerprint of FILE CONTENT.
	 *
	 * Used to detect a file revision (content version) and a no-op write
	 * (identical pre/post versions). The implementation MUST NOT retain
	 * the content.
	 */
	fingerprintFileContent?: (
		content: string,
	) => Promise<string | undefined> | string | undefined;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
	 *
	 * The EFFECTIVE model configuration observed at the boundary where the
	 * values actually govern execution — the model request the runtime is
	 * about to issue.
	 *
	 * This is deliberately a SEPARATE channel from the build-time
	 * `model_config` snapshot: the build-time snapshot describes what the
	 * host CONFIGURED (and may predate the session id), while this one
	 * describes what the runtime EFFECTIVELY sends, carrying the real
	 * session/run identity.
	 *
	 * The payload carries only privacy-safe scalars:
	 * `toolCount`, `toolNames`, `reasoningEffort`, `thinkingEnabled`,
	 * `maxOutputTokens`.
	 */
	onEffectiveModelConfig?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request is about to be issued. */
	onModelRequestStart?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request completed (successfully or with a finish reason). */
	onModelRequestFinish?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request failed. */
	onModelRequestError?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request was aborted / cancelled. */
	onModelRequestAbort?: (observation: ModelBehaviorTraceObservation) => void;
	/** A tool call started. */
	onToolStart?: (observation: ModelBehaviorTraceObservation) => void;
	/** A tool call finished. */
	onToolFinish?: (observation: ModelBehaviorTraceObservation) => void;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * A native edit was REQUESTED by the model.
	 *
	 * The payload carries the request's STRUCTURE only — never a path,
	 * never old/new text, never a patch body:
	 * `toolCallId`, `toolName`, `operation`, `fileIdentity`,
	 * `targetCount`, `requestedChars`, `approvalOutcome`,
	 * `executionInvoked`.
	 */
	onEditAttempt?: (observation: ModelBehaviorTraceObservation) => void;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * The write layer reported the ACTUAL result of an edit attempt.
	 */
	onEditApplication?: (observation: ModelBehaviorTraceObservation) => void;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * An edit attempt failed, with a STRUCTURAL failure category.
	 */
	onEditFailure?: (observation: ModelBehaviorTraceObservation) => void;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2).
	 *
	 * The write layer RESOLVED the destination of an edit.
	 *
	 * The payload carries the destination's SCOPE relative to the active
	 * workspace, the input-path classification, the ephemeral workspace /
	 * executor-cwd identities, whether the destination existed before the
	 * operation, and whether it was under the designated benchmark root.
	 *
	 * No raw path and no content is ever carried.
	 */
	onEditTargetResolved?: (observation: ModelBehaviorTraceObservation) => void;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3).
	 *
	 * The write layer INDEPENDENTLY verified one write by reading the
	 * destination back from disk.
	 *
	 * The payload carries `writeReturned`, `readbackAttempted`,
	 * `readbackMatched`, `fileExistsAfterWrite`, the actual content
	 * fingerprint, the intended content fingerprint and the reason the
	 * measurement was skipped.
	 */
	onEditWriteVerification?: (
		observation: ModelBehaviorTraceObservation,
	) => void;
	/** The production loop detector returned a verdict. */
	onLoopVerdict?: (observation: ModelBehaviorTraceObservation) => void;
	/** The production compaction resolver produced its diagnostics. */
	onCompactionDiagnostics?: (
		observation: ModelBehaviorTraceObservation,
	) => void;
	/** The production compaction completed. */
	onCompactionCompleted?: (observation: ModelBehaviorTraceObservation) => void;
	/** The run terminated. */
	onRunTerminated?: (observation: ModelBehaviorTraceObservation) => void;
}

/**
 * What the SDK hands to the sink for one observation.
 *
 * `payload` contains privacy-safe facts only. The SDK is responsible for
 * NOT passing raw content through this channel.
 */
export interface ModelBehaviorTraceObservation {
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly runId?: string;
	readonly iteration?: number;
	readonly providerId?: string;
	readonly modelId?: string;
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A sink that observes nothing. Used as the default so the production path
 * pays only a null check.
 */
export const NOOP_MODEL_BEHAVIOR_TRACE_SINK: ModelBehaviorTraceSink = {};
