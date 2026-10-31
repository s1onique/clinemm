#!/usr/bin/env bun
/**
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01 — offline normalizer.
 *
 * Converts a ClineMM model-behavior JSONL capture into the harness-neutral
 * `agent-trace/0.1` portable form, and reports what could NOT be normalized.
 *
 * WHAT THIS TOOL IS
 * -----------------
 * A READ-ONLY, OFFLINE adapter. It reads a previously captured JSONL file and
 * writes:
 *
 *   - `<out>.normalized.jsonl`  — sanitized portable records, one per line.
 *   - `<out>.coverage.json`      — observed / unavailable coverage + truncation.
 *
 * WHAT THIS TOOL IS NOT
 * ---------------------
 * It does NOT re-implement the existing offline comparator
 * (`scripts/compare-model-behavior-traces.ts`). That comparator answers a
 * DIFFERENT question — "are these two traces comparable, and what differed?"
 * — and it is the fail-closed comparability authority. This tool answers the
 * PORTABILITY question — "what does this capture say, in a vocabulary another
 * harness can also speak?" — and it deliberately shares no analysis code with
 * the comparator so the comparator's fail-closed semantics stay untouched.
 *
 * It does NOT instrument anything. There is no runtime dependency, no
 * telemetry package, no exporter, and no change to the recorder.
 *
 * HARD EVIDENCE RULES (the whole point of this tool)
 * --------------------------------------------------
 *   1. MISSING STAYS MISSING. A native field that is absent is absent in the
 *      portable record. No id is invented to fill a hole.
 *   2. NO CROSS-NAMESPACE JOINS. ClineMM emits TWO `runId` namespaces (the
 *      agent runtime's `run_<8>` and the session orchestrator's
 *      `run_<epochMs>_<rand>`). They are NEVER compared as equal strings, and
 *      a portable record carries the namespace explicitly.
 *   3. NO TIMESTAMP-PROXIMITY JOINS. Correlation uses only identities the
 *      source actually established.
 *   4. A TOOL CALL IS NOT A PROCESS. A successful tool invocation never
 *      implies a subprocess exit code.
 *   5. REASONING IS THREE FACTS. Requested reasoning, serialized wire
 *      reasoning, and provider-reported reasoning usage stay distinct.
 *   6. AN EDIT IS NOT A RETAINED CHANGE. Editor application and the final
 *      retained workspace delta are separate records.
 *   7. A TRUNCATED TRACE IS NOT COMPLETE. Truncation is carried through to
 *      the coverage report and to every affected record.
 *
 * PRIVACY
 * -------
 * The adapter NEVER introduces content the recorder deliberately omitted. It
 * copies only the privacy-safe scalars the recorder already sanitized. It
 * additionally drops:
 *
 *   - absolute-looking path strings,
 *   - any key that looks like prompt / reasoning / argument / result content,
 *   - the raw `toolNames` array (replaced by a COUNT only; catalog identity
 *     is explicitly unavailable until an independent manifest authority or an
 *     evaluator-managed secret key exists).
 *
 * USAGE
 * -----
 *   bun scripts/normalize-agent-trace.ts \
 *     --in <capture.jsonl> \
 *     --out <normalized-prefix> \
 *     [--harness cline]
 *
 * Exit code 0 on success, 1 on a malformed capture.
 */

import { readFile, writeFile } from "node:fs/promises"

// ============================================================================
// Portable contract constants
// ============================================================================

/** The portable contract version this adapter emits. */
export const PORTABLE_TRACE_CONTRACT_VERSION = "agent-trace/0.1"

/** The harness identifier this adapter produces records for. */
export const PORTABLE_HARNESS_NAME = "cline"

/**
 * The sentinel the ClineMM recorder uses for "the runtime could not observe
 * this value". Carried through verbatim; never collapsed to `null`.
 */
export const UNAVAILABLE = "UNAVAILABLE_FROM_TRACE"

/**
 * The portable evidence vocabulary.
 *
 * The native ClineMM `evidenceBoundary` labels are NOT this vocabulary — they
 * describe CORRELATION completeness, not EVIDENCE KIND. The mapping is
 * explicit and documented in the ClineMM-native-to-portable mapping table:
 *
 *   - `observed`            -> REAL          (correlation complete)
 *   - `partial_identity`    -> REAL          (observed fact, partial join)
 *   - `no_identity`         -> REAL          (observed fact, no join)
 *   - `synthesized`         -> SYNTHETIC     (derived, e.g. a fingerprint)
 *   - `inferred_budget`     -> INFERRED      (resolver-derived)
 *
 * The recorder's per-payload `provenance` field (`REAL_PRODUCTION_SEAM` /
 * `INFERRED`) is the STRONGER signal for workspace facts and wins when
 * present.
 */
export type PortableEvidenceQuality = "REAL" | "SYNTHETIC" | "INFERRED" | "UNAVAILABLE_FROM_TRACE"

/**
 * The portable event families.
 *
 * The families are the COMPARABLE axes. They deliberately preserve the
 * distinctions the ACT requires:
 *
 *   - `run`       — lifecycle / termination
 *   - `model`     — requests, provider routing, reasoning controls, usage
 *   - `tool`      — tool invocation + typed outcome
 *   - `process`   — subprocess outcomes (independently observable only)
 *   - `workspace` — editor actions and filesystem effects
 *   - `context`   — compaction / input budgets
 *   - `acceptance`— independent correctness evidence
 */
export type PortableEventFamily = "run" | "model" | "tool" | "process" | "workspace" | "context" | "acceptance"

/**
 * The native ClineMM event -> portable family mapping.
 *
 * `process` and `acceptance` have NO native producer in ClineMM: the recorder
 * deliberately does not capture shell command text, exit codes, or test
 * results. Their absence is reported, never fabricated.
 */
const NATIVE_FAMILY: Readonly<Record<string, PortableEventFamily>> = {
	model_config: "model",
	effective_model_config: "model",
	model_request_start: "model",
	model_request_finish: "model",
	model_request_error: "model",
	model_request_abort: "model",
	model_wire_reasoning: "model",
	tool_start: "tool",
	tool_finish: "tool",
	edit_attempt: "workspace",
	edit_target_resolved: "workspace",
	edit_application: "workspace",
	edit_failure: "workspace",
	edit_write_verification: "workspace",
	edit_checkpoint_observation: "workspace",
	loop_verdict: "run",
	compaction_diagnostics: "context",
	compaction_completed: "context",
	run_terminated: "run",
}

/** The ClineMM `evidenceBoundary` -> portable evidence-quality mapping. */
const BOUNDARY_TO_QUALITY: Readonly<Record<string, PortableEvidenceQuality>> = {
	observed: "REAL",
	partial_identity: "REAL",
	no_identity: "REAL",
	synthesized: "SYNTHETIC",
	inferred_budget: "INFERRED",
}

/**
 * The native `provenance` -> portable evidence-quality mapping.
 *
 * `provenance` describes the PRODUCING LAYER, which is a stronger statement
 * about evidence kind than `evidenceBoundary` (which describes correlation
 * completeness). When a payload carries `provenance`, it wins.
 */
const PROVENANCE_TO_QUALITY: Readonly<Record<string, PortableEvidenceQuality>> = {
	REAL_PRODUCTION_SEAM: "REAL",
	INFERRED: "INFERRED",
}

// ============================================================================
// Native record shapes
// ============================================================================

/** One native ClineMM trace record. */
export interface NativeTraceRecord {
	seq: number
	timestamp: string
	traceId: string
	event: string
	evidenceBoundary: string
	sessionId?: string
	taskId?: string
	runId?: string
	iteration?: number
	providerId?: string
	modelId?: string
	payload: Record<string, unknown>
}

/** The terminal summary record the dump appends. NOT an agent event. */
export interface NativeTraceSummary {
	kind: "summary"
	traceId: string
	dumpedAt: string
	truncation: {
		truncated: boolean
		droppedCount: number
		droppedFromSeq?: number
		droppedToSeq?: number
		totalRecorded: number
		retainedCount: number
		retainedBytes: number
	}
}

/** A parsed capture. */
export interface ParsedNativeTrace {
	records: NativeTraceRecord[]
	summary?: NativeTraceSummary
	/** Lines that could not be parsed as JSON. */
	unparsedLines: number
	/** Lines that parsed but carried neither an `event` nor `kind: "summary"`. */
	unrecognizedLines: number
}

// ============================================================================
// Portable record shapes
// ============================================================================

/** The portable identity of one normalized record. */
export interface PortableIdentity {
	/** ClineMM's host-owned session id, when present. */
	sessionId?: string
	/** ClineMM's conversation (task) id, when present. */
	taskId?: string
	/** ClineMM's run id, when present. */
	runId?: string
	/**
	 * The NAMESPACE of `runId`.
	 *
	 * ClineMM emits two disjoint run-id namespaces:
	 *   - `agent_runtime` — `run_<nanoid(8)>`, minted by `AgentRuntime.execute`.
	 *   - `session_orchestrator` — `run_<epochMs>_<rand>`, minted by
	 *     `SessionRuntimeOrchestrator`.
	 *
	 * The strings are not comparable across namespaces, so the namespace is
	 * carried alongside the id and is NEVER inferred from another harness.
	 */
	runIdNamespace?: "agent_runtime" | "session_orchestrator"
	/** The agent iteration, when present. */
	iteration?: number
	/** The provider id, when present. */
	providerId?: string
	/** The model id, when present. */
	modelId?: string
	/**
	 * The per-request correlation id minted by the agent runtime and carried
	 * to the provider transport.
	 *
	 * This is the ONLY exact join between an agent-side request and a
	 * wire-side observation. It is NOT a model-loop iteration and NOT
	 * comparable to another harness's request id.
	 */
	wireRequestId?: string
	/** The tool-call identity, when present. */
	toolCallId?: string
}

/** One normalized portable record. */
export interface PortableRecord {
	/** The contract version. */
	contract: string
	/** A deterministic, adapter-local record id. NOT a causal authority. */
	recordId: string
	/** The source harness identifier. */
	harness: string
	/** The source's own event id (the recorder's monotonic `seq`). */
	nativeEventId: number
	/** The source's event type. */
	nativeEventType: string
	/** The source's ordering position. */
	sourceOrder: number
	/** The source's recorder-scoped trace id. */
	nativeTraceId: string
	/** The portable family. */
	family: PortableEventFamily
	/** The source's evidence boundary label, preserved verbatim. */
	sourceEvidenceBoundary: string
	/** The portable evidence quality. */
	evidenceQuality: PortableEvidenceQuality
	/** The source's correlation-completeness class, preserved verbatim. */
	correlationCompleteness: "observed" | "partial_identity" | "no_identity"
	/** The ISO-8601 source timestamp. */
	timestamp: string
	/** The source's monotonic duration field, when the event carries one. */
	durationMs?: number
	/** The source of `durationMs`, so a reader knows what it measured. */
	durationProvenance?: string
	/** The established identity of this record. */
	identity: PortableIdentity
	/** The normalized payload. */
	payload: Record<string, unknown>
	/** Whether the capture this record came from was truncated. */
	traceTruncated: boolean
}

/** The coverage report the probe emits. */
export interface CoverageReport {
	contract: string
	harness: string
	sourceTraceId?: string
	sourceDumpedAt?: string
	/** The number of native records read. */
	nativeRecordsRead: number
	/** The number of portable records written. */
	portableRecordsWritten: number
	/** The number of native records that could not be normalized. */
	unnormalizedRecords: number
	/** Per-native-event-type counts. */
	byNativeEventType: Record<string, number>
	/** Per-portable-family counts. */
	byFamily: Record<string, number>
	/** Per-family / per-key observed-vs-unavailable coverage. */
	coverage: Record<string, Record<string, "observed" | "unavailable">>
	/** The trace truncation status, preserved from the native summary. */
	truncation: {
		truncated: boolean
		droppedCount: number
		droppedFromSeq?: number
		droppedToSeq?: number
		totalRecorded: number
		retainedCount: number
		retainedBytes: number
	}
	/**
	 * Identities that could NOT be joined.
	 *
	 * Each entry names the JOIN that was refused and why — never a fabricated
	 * join.
	 */
	unjoinableIdentities: Array<{
		kind: string
		detail: string
		count: number
	}>
	/** Records that were dropped by the privacy filter, by key path. */
	privacyFilteredFields: Record<string, number>
	/**
	 * Catalog identity is deliberately unavailable.
	 *
	 * A digest keyed by the exported trace id is reproducible by every
	 * export consumer, so it cannot establish a secret identity. Until an
	 * evaluator-managed secret key or an independent manifest authority
	 * exists, only `toolCatalogCount` is exported and no catalog fingerprint
	 * or key label is published.
	 */
	toolCatalogIdentity: "UNAVAILABLE_FROM_TRACE"
	/**
	 * Whether the capture was complete.
	 *
	 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-2):
	 * this is now DERIVED from {@link assessCaptureCompleteness}. A capture
	 * with no terminal summary is NOT complete.
	 */
	traceComplete: boolean
	/** The full completeness assessment. */
	completeness: CompletenessAssessment
}

// ============================================================================
// Privacy filter — FAIL-CLOSED, SCHEMA-AWARE ALLOWLIST
// ============================================================================

/**
 * Payload keys whose values are NEVER portable.
 *
 * The recorder already refuses most of these, but the adapter is the LAST
 * gate before the portable file exists, so it re-checks. The set is a
 * DEFENCE IN DEPTH behind the family allowlist: a key on this list is
 * rejected even if a future allowlist edit would otherwise admit it.
 */
const FORBIDDEN_PORTABLE_KEYS: ReadonlySet<string> = new Set([
	"arguments",
	"argument",
	"params",
	"input",
	"prompt",
	"systemprompt",
	"system_prompt",
	"message",
	"messages",
	"text",
	"content",
	"reasoning",
	"thinking",
	"raw",
	"request",
	"requestbody",
	"request_body",
	"response",
	"result",
	"output",
	"stdout",
	"stderr",
	"value",
	"token",
	"tokens",
	"secret",
	"secrets",
	"credential",
	"credentials",
	"apikey",
	"password",
	"passwd",
	"command",
	"cmd",
	"script",
	"code",
	"diff",
	"patch",
	"authorization",
	"cookie",
	"bearer",
	"privatekey",
	"env",
	"environment",
])

/**
 * Absolute-path-shaped values are dropped even under an allowed key.
 *
 * The recorder already fingerprints paths, but a portable record is a new
 * export surface, so the adapter refuses anything that looks like an
 * absolute filesystem path.
 */
const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/

// ============================================================================
// Privacy filter — FAIL-CLOSED, SCHEMA-AWARE ALLOWLIST
// ============================================================================

/*
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR02 (P0-A):
 * catalog IDENTITY is intentionally not exported.
 *
 * The predecessor's HMAC key was derived from the capture trace id, and
 * that trace id is present in every portable record. An export consumer can
 * therefore derive the same key and recompute the digest for any candidate
 * catalog. Capture-scoped public hashing is reproducibility, not secrecy.
 *
 * Until an evaluator-managed secret key or an independent manifest
 * authority exists, the adapter exports `toolCatalogCount` only and marks
 * catalog identity unavailable. No digest and no key label are published.
 */

/**
 * The portable payload's ALLOWED keys, per family.
 *
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-1):
 * the previous filter was a DENY-list applied only at the TOP level. A
 * forbidden key nested inside an object, or an object inside an array,
 * escaped unchanged. That is a structural privacy leak.
 *
 * The filter is now an ALLOWLIST: a key that is not explicitly permitted
 * for its family is DROPPED. An unfamiliar key cannot escape merely
 * because the filter has never seen it.
 *
 * The allowlist is derived from the OBSERVED real capture, so every field
 * the real trace carries is preserved; the RED→GREEN witnesses prove the
 * nested/array cases are now closed.
 */
const FAMILY_ALLOWED_KEYS: Readonly<Record<PortableEventFamily, readonly string[]>> = {
	run: ["finishReason", "durationMs", "iterations", "verdict", "hasMessage", "toolName"],
	model: [
		// effective / build-time configuration
		"selectedProviderId",
		"selectedModelId",
		"runtimeProviderId",
		"runtimeModelId",
		"providerConfirmedModelId",
		"thinkingEnabled",
		"reasoningEffort",
		"temperature",
		"topP",
		"maxOutputTokens",
		"contextWindow",
		"maxInputTokens",
		"userContextCeiling",
		"effectiveMaxInputTokens",
		"inputBudgetSource",
		"userContextCeilingMode",
		"toolCount",
		// `toolNames` is permitted ONLY so the filter can REPLACE it with a
		// count. The names themselves are never exported.
		"toolNames",
		"toolCatalogCount",
		"sourceHead",
		"extensionVersion",
		"extensionBundleSha256",
		// request shape
		"messageCount",
		"toolSchemaCount",
		"systemPromptChars",
		"requestJsonChars",
		"visibleTextChars",
		"estimatedTextTokens",
		"toolResultCount",
		"toolResultChars",
		"maxToolResultChars",
		"requestedThinking",
		"requestedReasoningEffort",
		"reasoningEffortAdvertised",
		// wire controls
		"requestId",
		"attempt",
		"httpMethod",
		"wireThinkingMode",
		"wireReasoningEffort",
		"wireReasoningEnabled",
		"wireReasoningExcluded",
		"wireOutputConfigEffort",
		"wireOutputTokenLimit",
		// usage / latency
		"finishReason",
		"requestDurationMs",
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"reasoningContentPresent",
		"reasoningContentBytes",
		"reasoningContentParts",
		"providerReportedReasoningTokens",
		"toolCallCount",
		"invalidToolCallCount",
	],
	tool: [
		"toolCallId",
		"toolName",
		"origin",
		"argumentFingerprint",
		"durationMs",
		"outcome",
		"executionInvoked",
		"outputSizeChars",
	],
	process: [],
	workspace: [
		"toolCallId",
		"toolName",
		"operation",
		"fileIdentity",
		"targetCount",
		"requestedChars",
		"approvalOutcome",
		"executionInvoked",
		"inputPathKind",
		"executorCwdIdentity",
		"destinationScope",
		"canonicalized",
		"destinationExistedBefore",
		"provenance",
		"outcome",
		"failureCategory",
		"requestedFileCount",
		"mutatedFileCount",
		"unmutatedFileCount",
		"noOp",
		"fileMutations",
		"durationMs",
		"writeReturned",
		"readbackAttempted",
		"readbackMatched",
		"fileExistsAfterWrite",
		"actualContentFingerprint",
		"intendedContentFingerprint",
		"measurementSkippedReason",
		"readBytesRequested",
		"observedTargetCount",
		"targets",
		"sessionId",
		"runId",
	],
	context: [
		"mode",
		"strategy",
		"requestInputTokens",
		"maxInputTokens",
		"effectiveMaxInputTokens",
		"requestTriggerTokens",
		"userContextCeiling",
		"inputBudgetSource",
		"shouldCompact",
		"usedFallbackBudget",
		"tokensBefore",
		"tokensAfter",
		"tokensSaved",
		"messagesBefore",
		"messagesAfter",
	],
	acceptance: [],
}

/**
 * The keys permitted INSIDE a nested value.
 *
 * A nested object or an array element may only carry these keys. Anything
 * else — including a key the filter has never seen — is dropped.
 */
/**
 * The sentinel key used to HOIST a tool-catalog replacement into the parent
 * object. The replacement must not be nested under `toolNames`, because the
 * portable payload's shape is flat per family.
 */
const TOOL_CATALOG_REPLACEMENT = "__toolCatalogReplacement" as const

const NESTED_ALLOWED_KEYS: ReadonlySet<string> = new Set([
	// The tool-catalog replacement (count only) produced when a `toolNames`
	// array is filtered. Without this, the catalog SIZE would be silently
	// lost by the nested allowlist.
	"toolCatalogCount",
	// `edit_application.fileMutations[]` entries
	"fileIdentity",
	"contentVersionPre",
	"contentVersionPost",
	"linesAdded",
	"linesRemoved",
	"measurementSkipped",
	// `edit_checkpoint_observation.targets[]` entries
	"state",
	"contentFingerprint",
	"measurementSkippedReason",
	// `edit_target_resolved` scalar fields that may appear nested
	"provenance",
	"destinationScope",
	"inputPathKind",
	"canonicalized",
	"destinationExistedBefore",
	"executorCwdIdentity",
])

/**
 * The maximum nesting depth the filter will descend.
 *
 * Deeper content is dropped rather than partially trusted.
 */
const MAX_PAYLOAD_DEPTH = 4

/**
 * Filter a native payload into a portable payload — FAIL-CLOSED.
 *
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-1):
 *
 *   - The filter is an ALLOWLIST keyed by family. A key that is not
 *     permitted for that family is DROPPED.
 *   - The allowlist applies at EVERY depth. A forbidden or unknown key
 *     nested inside an object, or inside an array element, is dropped.
 *   - Every dropped key is ACCOUNTED for, at the path where it was
 *     dropped, so the loss is visible rather than silent.
 *
 * Returns the filtered payload and the paths of the dropped keys.
 */
export function filterPortablePayload(
	payload: Record<string, unknown>,
	family: PortableEventFamily = "model",
): { payload: Record<string, unknown>; dropped: string[] } {
	const allowed = FAMILY_ALLOWED_KEYS[family] ?? []
	const dropped: string[] = []
	const out: Record<string, unknown> = {}

	for (const key of Object.keys(payload)) {
		const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
		if (FORBIDDEN_PORTABLE_KEYS.has(normalized)) {
			dropped.push(key)
			continue
		}
		if (!allowed.includes(key)) {
			// NOT PERMITTED for this family. An unfamiliar key does NOT
			// escape merely because the filter has never seen it.
			dropped.push(key)
			continue
		}
		const value = payload[key]
		const filtered = filterPortableValue(value, key, 1, dropped)
		if (filtered === undefined) {
			continue
		}
		if (
			typeof filtered === "object" &&
			filtered !== null &&
			!Array.isArray(filtered) &&
			TOOL_CATALOG_REPLACEMENT in filtered
		) {
			// Hoist the catalog replacement; the names themselves stay gone.
			const replacement = (filtered as Record<string, unknown>)[TOOL_CATALOG_REPLACEMENT] as Record<string, unknown>
			for (const replacementKey of Object.keys(replacement)) {
				out[replacementKey] = replacement[replacementKey]
			}
			continue
		}
		out[key] = filtered
	}
	return { payload: out, dropped }
}

/**
 * Filter ONE value under a permitted key.
 *
 * Returns `undefined` when the value must not be exported at all.
 */
function filterPortableValue(value: unknown, key: string, depth: number, dropped: string[]): unknown {
	if (depth > MAX_PAYLOAD_DEPTH) {
		dropped.push(`${key} (nesting deeper than ${MAX_PAYLOAD_DEPTH})`)
		return undefined
	}
	if (value === null || value === undefined) {
		return value
	}
	if (typeof value === "boolean") {
		return value
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined
	}
	if (typeof value === "string") {
		if (ABSOLUTE_PATH_PATTERN.test(value)) {
			dropped.push(key)
			return undefined
		}
		return value
	}
	if (Array.isArray(value)) {
		// A tool-name array is catalog CONTENT. Replace it with a count only.
		// Catalog identity is unavailable until a genuinely secret,
		// evaluator-managed key or an independent manifest authority exists.
		if (key === "toolNames" && value.every((item) => typeof item === "string")) {
			dropped.push(key)
			// The replacement is HOISTED into the parent object by the
			// caller: the catalog is represented by its size, never by its
			// names or a publicly reproducible fingerprint.
			return {
				[TOOL_CATALOG_REPLACEMENT]: {
					toolCatalogCount: value.length,
				},
			}
		}
		const items: unknown[] = []
		for (const item of value) {
			const filteredItem = filterPortableValue(item, key, depth + 1, dropped)
			if (filteredItem !== undefined) {
				items.push(filteredItem)
			}
		}
		return items
	}
	if (typeof value === "object") {
		// A nested object may only carry the NESTED allowlist. An unknown
		// nested key is dropped — it does not escape.
		const nested = value as Record<string, unknown>
		const flat: Record<string, unknown> = {}
		for (const nestedKey of Object.keys(nested)) {
			if (!NESTED_ALLOWED_KEYS.has(nestedKey)) {
				dropped.push(`${key}.${nestedKey}`)
				continue
			}
			const filteredNested = filterPortableValue(nested[nestedKey], nestedKey, depth + 1, dropped)
			if (filteredNested !== undefined) {
				flat[nestedKey] = filteredNested
			}
		}
		return flat
	}
	dropped.push(key)
	return undefined
}

// ============================================================================
// Run-id namespace classification
// ============================================================================

/**
 * Classify a native run id into its namespace.
 *
 * The two namespaces are distinguished by SHAPE because the recorder does not
 * carry a namespace tag:
 *
 *   - `agent_runtime`        — `run_` + exactly 8 nanoid characters
 *   - `session_orchestrator` — `run_` + `<epochMs>_<random>`
 *
 * An id that matches NEITHER shape is reported as unknown rather than being
 * guessed into one of the two.
 */
export function classifyRunIdNamespace(runId: string): "agent_runtime" | "session_orchestrator" | "unknown" {
	if (!runId.startsWith("run_")) {
		return "unknown"
	}
	const suffix = runId.slice(4)
	if (/^[A-Za-z0-9_-]{8}$/.test(suffix)) {
		return "agent_runtime"
	}
	if (/^\d+_[A-Za-z0-9]+$/.test(suffix)) {
		return "session_orchestrator"
	}
	return "unknown"
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a native ClineMM JSONL capture.
 *
 * The terminal summary is recognized SEPARATELY from the agent events: it is
 * a dump artifact, not an observation.
 */
export function parseNativeTrace(raw: string): ParsedNativeTrace {
	const records: NativeTraceRecord[] = []
	let summary: NativeTraceSummary | undefined
	let unparsedLines = 0
	let unrecognizedLines = 0
	const lines = raw.split("\n")
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) {
			continue
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			unparsedLines += 1
			continue
		}
		if (typeof parsed !== "object" || parsed === null) {
			unrecognizedLines += 1
			continue
		}
		const object = parsed as Record<string, unknown>
		if (object.kind === "summary") {
			summary = object as unknown as NativeTraceSummary
			continue
		}
		if (typeof object.event === "string" && typeof object.seq === "number" && typeof object.timestamp === "string") {
			records.push(object as unknown as NativeTraceRecord)
			continue
		}
		unrecognizedLines += 1
	}
	return { records, summary, unparsedLines, unrecognizedLines }
}

// ============================================================================
// Capture completeness — FAIL-CLOSED
// ============================================================================

/**
 * The completeness classification of a capture.
 *
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-2):
 * the previous adapter reported `traceComplete: true` whenever the
 * terminal summary was ABSENT — precisely the state an interrupted
 * capture leaves behind. That promoted partial evidence into a complete
 * benchmark result.
 *
 * The classification is now explicit and fail-closed:
 *
 *   - `COMPLETE`   — a validated terminal summary is present, the summary
 *                    agrees with the observed record identity and counts,
 *                    its truncation state is internally consistent, and every
 *                    line in the capture was a well-formed record.
 *   - `PARTIAL`    — the capture is well-formed but the recorder itself
 *                    declares it truncated. The retained records are real
 *                    evidence, but they are a LOWER BOUND.
 *   - `INCOMPLETE` — the capture is missing its terminal summary, or the
 *                    summary contradicts the observed records, or lines
 *                    could not be parsed or were not recognized. The
 *                    retained records are evidence of WHAT HAPPENED, but
 *                    NOT of what did not.
 *   - `INVALID`    — the capture carries no usable records at all.
 */
export type CaptureCompleteness = "COMPLETE" | "PARTIAL" | "INCOMPLETE" | "INVALID"

/**
 * The reason a capture is not COMPLETE.
 *
 * Every reason is reported explicitly. A capture is never silently
 * promoted to complete.
 */
export interface CompletenessAssessment {
	readonly completeness: CaptureCompleteness
	/** True only for `COMPLETE`. */
	readonly complete: boolean
	/** Every reason the capture is not COMPLETE. Empty for COMPLETE. */
	readonly reasons: string[]
	/** The number of well-formed agent records observed. */
	readonly observedRecords: number
	/** The number of lines that could not be parsed as JSON. */
	readonly unparsedLines: number
	/** The number of parsed lines that were neither a record nor a summary. */
	readonly unrecognizedLines: number
	/** True when the terminal summary was present and validated. */
	readonly summaryPresent: boolean
}

/**
 * Assess whether a capture is complete.
 *
 * ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-2):
 * COMPLETE requires ALL of:
 *
 *   1. a terminal summary is present,
 *   2. the summary is structurally a terminal summary and its trace id agrees
 *      with every observed record,
 *   3. the summary's `retainedCount` agrees with the observed record count,
 *   4. `truncation.totalRecorded` agrees with the retained and dropped
 *      counts,
 *   5. `truncation.truncated` agrees with `droppedCount`,
 *   6. `truncation.truncated` is false, and
 *   7. no line failed to parse or was unrecognized.
 *
 * A truncated-but-otherwise-valid capture is `PARTIAL`: legitimately
 * truncated evidence is PRESERVED as partial, never discarded and never
 * reported as complete.
 */
export function assessCaptureCompleteness(parsed: ParsedNativeTrace): CompletenessAssessment {
	const reasons: string[] = []
	const observedRecords = parsed.records.length
	const summaryPresent = parsed.summary !== undefined

	if (parsed.summary === undefined) {
		reasons.push(
			"the capture has NO terminal summary record; a capture interrupted before its summary cannot be shown to be exhaustive",
		)
	} else {
		const summary = parsed.summary
		const truncation = summary.truncation
		if (truncation === undefined) {
			reasons.push("the capture's terminal summary carries no truncation record")
		} else {
			if (summary.traceId.length === 0) {
				reasons.push("the capture's terminal summary carries no trace identity")
			} else {
				const distinctRecordTraceIds = new Set(parsed.records.map((record) => record.traceId))
				if (distinctRecordTraceIds.size > 1) {
					reasons.push("the capture's records carry more than one trace identity")
				} else if (!distinctRecordTraceIds.has(summary.traceId)) {
					reasons.push(
						`the terminal summary trace id ${summary.traceId} does not match the observed record trace identity`,
					)
				}
			}
			if (truncation.retainedCount !== observedRecords) {
				reasons.push(
					`the terminal summary declares retainedCount=${truncation.retainedCount} but ${observedRecords} well-formed records were observed; the summary CONTRADICTS the capture`,
				)
			}
			if (truncation.totalRecorded !== truncation.retainedCount + truncation.droppedCount) {
				reasons.push(
					`the terminal summary declares totalRecorded=${truncation.totalRecorded}, but retainedCount=${truncation.retainedCount} plus droppedCount=${truncation.droppedCount} is ${truncation.retainedCount + truncation.droppedCount}; the summary counts CONTRADICT each other`,
				)
			}
			if (truncation.truncated !== (truncation.droppedCount > 0)) {
				reasons.push(
					`the terminal summary declares truncated=${truncation.truncated} but droppedCount=${truncation.droppedCount}; the truncation state CONTRADICTS the counts`,
				)
			}
			if (truncation.truncated) {
				reasons.push(
					`the recorder declares the capture truncated (droppedCount=${truncation.droppedCount}); the retained records are a LOWER BOUND, not a total`,
				)
			}
		}
	}

	if (parsed.unparsedLines > 0) {
		reasons.push(`${parsed.unparsedLines} line(s) could not be parsed as JSON; capture content is UNREADABLE`)
	}
	if (parsed.unrecognizedLines > 0) {
		reasons.push(
			`${parsed.unrecognizedLines} line(s) were neither a well-formed record nor a terminal summary; capture content is UNRECOGNIZED`,
		)
	}
	if (observedRecords === 0) {
		reasons.push("the capture contains no usable agent records at all")
	}

	const completeness: CaptureCompleteness =
		observedRecords === 0
			? "INVALID"
			: reasons.length === 0
				? "COMPLETE"
				: parsed.summary?.truncation.truncated === true &&
						parsed.summary?.truncation.retainedCount === observedRecords &&
						parsed.summary?.truncation.totalRecorded ===
							parsed.summary.truncation.retainedCount + parsed.summary.truncation.droppedCount &&
						parsed.summary?.traceId.length !== 0 &&
						new Set(parsed.records.map((record) => record.traceId)).size === 1 &&
						new Set(parsed.records.map((record) => record.traceId)).has(parsed.summary.traceId) &&
						parsed.unparsedLines === 0 &&
						parsed.unrecognizedLines === 0
					? "PARTIAL"
					: "INCOMPLETE"

	return {
		completeness,
		complete: completeness === "COMPLETE",
		reasons,
		observedRecords,
		unparsedLines: parsed.unparsedLines,
		unrecognizedLines: parsed.unrecognizedLines,
		summaryPresent,
	}
}

// ============================================================================
// Normalization
// ============================================================================

/** The duration-bearing native events and what their duration MEASURES. */
const DURATION_PROVENANCE: Readonly<Record<string, string>> = {
	model_request_finish: "provider_request_wall_clock",
	tool_finish: "tool_invocation_wall_clock",
	edit_application: "edit_application_wall_clock",
	run_terminated: "run_wall_clock",
}

/**
 * The native payload keys that carry the portable core facts of a family.
 *
 * The coverage report uses this to state, per family, which facts were
 * OBSERVED and which were UNAVAILABLE in this capture.
 */
const FAMILY_KEYS: Readonly<Record<PortableEventFamily, readonly string[]>> = {
	run: ["finishReason", "durationMs", "iterations", "verdict", "hasMessage"],
	model: [
		"requestedThinking",
		"requestedReasoningEffort",
		"reasoningEffortAdvertised",
		"wireThinkingMode",
		"wireOutputConfigEffort",
		"wireOutputTokenLimit",
		"providerReportedReasoningTokens",
		"reasoningContentBytes",
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"requestDurationMs",
		"finishReason",
		"toolCallCount",
		"toolSchemaCount",
		"messageCount",
		"thinkingEnabled",
		"reasoningEffort",
		"selectedModelId",
		"runtimeModelId",
		"providerConfirmedModelId",
	],
	tool: [
		"toolName",
		"toolCallId",
		"origin",
		"outcome",
		"executionInvoked",
		"durationMs",
		"outputSizeChars",
		"argumentFingerprint",
	],
	process: [
		// INTENTIONALLY EMPTY. ClineMM does not capture shell command text or
		// exit codes, so the `process` family has no native producer at all.
	],
	workspace: [
		"operation",
		"outcome",
		"failureCategory",
		"approvalOutcome",
		"executionInvoked",
		"noOp",
		"requestedFileCount",
		"mutatedFileCount",
		"unmutatedFileCount",
		"writeReturned",
		"readbackAttempted",
		"readbackMatched",
		"fileExistsAfterWrite",
		"observedTargetCount",
		"targetCount",
		"durationMs",
		"provenance",
	],
	context: [
		"mode",
		"strategy",
		"requestInputTokens",
		"maxInputTokens",
		"effectiveMaxInputTokens",
		"requestTriggerTokens",
		"userContextCeiling",
		"inputBudgetSource",
		"shouldCompact",
		"usedFallbackBudget",
		"tokensBefore",
		"tokensAfter",
		"tokensSaved",
		"messagesBefore",
		"messagesAfter",
	],
	acceptance: [
		// INTENTIONALLY EMPTY. ClineMM does not capture structured test
		// results; an independent evaluator must supply acceptance evidence.
	],
}

/**
 * Normalize one native record into a portable record.
 *
 * Returns no record when the native event has no portable family — that is a
 * REPORTED gap, never a silently-dropped record.
 */
export function normalizeNativeRecord(
	record: NativeTraceRecord,
	options: {
		readonly traceTruncated: boolean
		readonly harness: string
	},
): {
	record?: PortableRecord
	unnormalized?: { event: string; reason: string }
	/** The key paths the privacy filter dropped from this record. */
	dropped?: string[]
} {
	const family = NATIVE_FAMILY[record.event]
	if (family === undefined) {
		return {
			unnormalized: {
				event: record.event,
				reason: "no portable family is defined for this native event",
			},
		}
	}
	const filtered = filterPortablePayload(record.payload ?? {}, family)
	const payload = filtered.payload

	// Evidence quality: the per-payload `provenance` (producing layer) wins
	// over the envelope `evidenceBoundary` (correlation completeness).
	const provenance = payload.provenance
	const evidenceQuality =
		typeof provenance === "string" && PROVENANCE_TO_QUALITY[provenance] !== undefined
			? PROVENANCE_TO_QUALITY[provenance]
			: (BOUNDARY_TO_QUALITY[record.evidenceBoundary] ?? "UNAVAILABLE_FROM_TRACE")

	// Correlation completeness: preserved separately from evidence quality.
	const correlationCompleteness =
		record.evidenceBoundary === "observed" ||
		record.evidenceBoundary === "partial_identity" ||
		record.evidenceBoundary === "no_identity"
			? record.evidenceBoundary
			: "no_identity"

	const identity: PortableIdentity = {}
	if (record.sessionId !== undefined) {
		identity.sessionId = record.sessionId
	}
	if (record.taskId !== undefined) {
		identity.taskId = record.taskId
	}
	if (record.runId !== undefined) {
		identity.runId = record.runId
		const namespace = classifyRunIdNamespace(record.runId)
		if (namespace !== "unknown") {
			identity.runIdNamespace = namespace
		}
	}
	if (record.iteration !== undefined) {
		identity.iteration = record.iteration
	}
	if (record.providerId !== undefined) {
		identity.providerId = record.providerId
	}
	if (record.modelId !== undefined) {
		identity.modelId = record.modelId
	}
	const wireRequestId = payload.requestId
	if (typeof wireRequestId === "string" && wireRequestId.length > 0) {
		identity.wireRequestId = wireRequestId
	}
	const toolCallId = payload.toolCallId
	if (typeof toolCallId === "string" && toolCallId.length > 0) {
		identity.toolCallId = toolCallId
	}

	const portable: PortableRecord = {
		contract: PORTABLE_TRACE_CONTRACT_VERSION,
		recordId: `${record.traceId}:${record.seq}`,
		harness: options.harness,
		nativeEventId: record.seq,
		nativeEventType: record.event,
		sourceOrder: record.seq,
		nativeTraceId: record.traceId,
		family,
		sourceEvidenceBoundary: record.evidenceBoundary,
		evidenceQuality,
		correlationCompleteness,
		timestamp: record.timestamp,
		durationProvenance: DURATION_PROVENANCE[record.event],
		identity,
		payload,
		traceTruncated: options.traceTruncated,
	}
	if (typeof payload.durationMs === "number") {
		portable.durationMs = payload.durationMs
	} else if (typeof payload.requestDurationMs === "number") {
		portable.durationMs = payload.requestDurationMs
	}
	return { record: portable, dropped: filtered.dropped }
}

/**
 * Normalize a whole capture.
 *
 * The summary is consumed (for truncation) and NOT emitted as a portable
 * record: it is a dump artifact, not an agent event.
 */
export function normalizeNativeTrace(
	parsed: ParsedNativeTrace,
	options: { readonly harness?: string } = {},
): {
	records: PortableRecord[]
	coverage: CoverageReport
} {
	const harness = options.harness ?? PORTABLE_HARNESS_NAME
	// ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-2):
	// the completeness decision is FAIL-CLOSED. A capture with no
	// terminal summary is NOT complete, and malformed / unrecognized lines
	// are part of the decision.
	const assessment = assessCaptureCompleteness(parsed)
	const truncated = parsed.summary?.truncation.truncated ?? false
	const records: PortableRecord[] = []
	const byNativeEventType: Record<string, number> = {}
	const byFamily: Record<string, number> = {}
	const unnormalized: Array<{ event: string; reason: string }> = []
	const privacyFilteredFields: Record<string, number> = {}

	// Unjoinable-identity accounting.
	const wireWithoutRequestId: string[] = []
	const wireWithoutRunId: string[] = []
	const recordsWithoutRunIdByEvent: Record<string, number> = {}

	for (const native of parsed.records) {
		byNativeEventType[native.event] = (byNativeEventType[native.event] ?? 0) + 1
		if (native.runId === undefined) {
			recordsWithoutRunIdByEvent[native.event] = (recordsWithoutRunIdByEvent[native.event] ?? 0) + 1
		}
		if (native.event === "model_wire_reasoning") {
			if (typeof native.payload?.requestId !== "string") {
				wireWithoutRequestId.push(String(native.seq))
			}
			if (native.runId === undefined) {
				wireWithoutRunId.push(String(native.seq))
			}
		}
		const normalized = normalizeNativeRecord(native, {
			traceTruncated: truncated,
			harness,
		})
		if (normalized.record) {
			records.push(normalized.record)
			byFamily[normalized.record.family] = (byFamily[normalized.record.family] ?? 0) + 1
			// ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P1):
			// every field the privacy filter dropped is ACCOUNTED for, so
			// the loss is visible rather than silent.
			for (const droppedKey of normalized.dropped ?? []) {
				privacyFilteredFields[droppedKey] = (privacyFilteredFields[droppedKey] ?? 0) + 1
			}
		} else if (normalized.unnormalized) {
			unnormalized.push(normalized.unnormalized)
		}
	}

	// Coverage: per family, which of its CORE keys were observed at least once.
	const observedKeys: Record<string, Set<string>> = {}
	for (const portable of records) {
		let set = observedKeys[portable.family]
		if (!set) {
			set = new Set<string>()
			observedKeys[portable.family] = set
		}
		for (const key of Object.keys(portable.payload)) {
			set.add(key)
		}
	}
	const coverage: Record<string, Record<string, "observed" | "unavailable">> = {}
	for (const family of Object.keys(FAMILY_KEYS) as PortableEventFamily[]) {
		const seen = observedKeys[family] ?? new Set<string>()
		const row: Record<string, "observed" | "unavailable"> = {}
		for (const key of FAMILY_KEYS[family]) {
			row[key] = seen.has(key) ? "observed" : "unavailable"
		}
		coverage[family] = row
	}

	const unjoinableIdentities: CoverageReport["unjoinableIdentities"] = []
	if (wireWithoutRequestId.length > 0) {
		unjoinableIdentities.push({
			kind: "wire_request_without_request_id",
			detail: "model_wire_reasoning records that carry no requestId; they CANNOT be joined to an agent-side model request. The adapter does NOT join them by timestamp or by proximity to the neighbouring model_request_start.",
			count: wireWithoutRequestId.length,
		})
	}
	if (wireWithoutRunId.length > 0) {
		unjoinableIdentities.push({
			kind: "wire_request_without_run_id",
			detail: "model_wire_reasoning records that carry no runId; they cannot be attributed to a ClineMM run.",
			count: wireWithoutRunId.length,
		})
	}
	for (const [event, count] of Object.entries(recordsWithoutRunIdByEvent)) {
		unjoinableIdentities.push({
			kind: "record_without_run_id",
			detail: `${event} records that carry no runId; they are correlated by their other identities only.`,
			count,
		})
	}
	// The two run-id namespaces are reported so a reader never treats their
	// strings as globally equivalent.
	unjoinableIdentities.push({
		kind: "dual_run_id_namespace",
		detail: "ClineMM emits TWO disjoint run-id namespaces (agent_runtime `run_<8>` and session_orchestrator `run_<epochMs>_<rand>`). The adapter carries the namespace explicitly and never joins across namespaces.",
		count:
			(byNativeEventType["loop_verdict"] ?? 0) +
			(byNativeEventType["run_terminated"] ?? 0) +
			(byNativeEventType["model_request_start"] ?? 0),
	})

	return {
		records,
		coverage: {
			contract: PORTABLE_TRACE_CONTRACT_VERSION,
			harness,
			sourceTraceId: parsed.summary?.traceId,
			sourceDumpedAt: parsed.summary?.dumpedAt,
			nativeRecordsRead: parsed.records.length,
			portableRecordsWritten: records.length,
			unnormalizedRecords: unnormalized.length,
			byNativeEventType,
			byFamily,
			coverage,
			truncation: parsed.summary?.truncation ?? {
				truncated: false,
				droppedCount: 0,
				totalRecorded: parsed.records.length,
				retainedCount: parsed.records.length,
				retainedBytes: 0,
			},
			unjoinableIdentities,
			privacyFilteredFields,
			toolCatalogIdentity: UNAVAILABLE,
			traceComplete: assessment.complete,
			completeness: assessment,
		},
	}
}

// ============================================================================
// CLI
// ============================================================================

interface CliOptions {
	input: string
	out: string
	harness: string
}

function parseArgs(argv: string[]): CliOptions {
	const options: Partial<CliOptions> = {}
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		const next = argv[index + 1]
		switch (arg) {
			case "--in":
				options.input = next ?? ""
				index += 1
				break
			case "--out":
				options.out = next ?? ""
				index += 1
				break
			case "--harness":
				options.harness = next ?? "cline"
				index += 1
				break
			default:
				break
		}
	}
	if (!options.input || !options.out) {
		throw new Error("usage: normalize-agent-trace.ts --in <capture.jsonl> --out <prefix> [--harness cline]")
	}
	return options as CliOptions
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2))
	const raw = await readFile(options.input, "utf8")
	const parsed = parseNativeTrace(raw)
	const { records, coverage } = normalizeNativeTrace(parsed, {
		harness: options.harness,
	})
	const lines = records.map((record) => JSON.stringify(record))
	await writeFile(`${options.out}.normalized.jsonl`, `${lines.join("\n")}\n`, "utf8")
	await writeFile(`${options.out}.coverage.json`, `${JSON.stringify(coverage, null, 2)}\n`, "utf8")
	process.stdout.write(
		`normalized ${coverage.portableRecordsWritten}/${coverage.nativeRecordsRead} native records; ` +
			`truncated=${coverage.truncation.truncated}; ` +
			`families=${JSON.stringify(coverage.byFamily)}\n`,
	)
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		process.stderr.write(`normalize-agent-trace: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exit(1)
	})
}
