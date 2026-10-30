import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { GatewayStreamRequest } from "@cline/shared";
import {
	estimateTokens,
	hasModelBehaviorWireReasoningObserver,
	MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY,
	notifyModelBehaviorWireReasoningObservers,
} from "@cline/shared";

type CaptureMode = "off" | "summary" | "full";
type CaptureStage = "ai_sdk_prompt" | "wire_request";

const DEFAULT_MAX_PREVIEW_BYTES = 64 * 1024;
const CAPTURE_FILE_EXTENSION = ".provider-request.json";
const CAPTURE_TMP_EXTENSION = ".tmp";
const CLEANUP_TTL_MS = 24 * 60 * 60 * 1000;
const cleanupDirs = new Set<string>();
const attemptCounters = new Map<string, number>();

function readCaptureMode(): CaptureMode {
	const raw = process.env.CLINE_CAPTURE_PROVIDER_REQUEST?.trim().toLowerCase();
	if (raw === "summary" || raw === "full") {
		return raw;
	}
	return "off";
}

function isWireCaptureEnabled(): boolean {
	return process.env.CLINE_CAPTURE_WIRE?.trim().toLowerCase() === "true";
}

function readMaxPreviewBytes(): number {
	const parsed = Number(process.env.CLINE_CAPTURE_MAX_PREVIEW_BYTES);
	return Number.isFinite(parsed) && parsed > 0
		? Math.floor(parsed)
		: DEFAULT_MAX_PREVIEW_BYTES;
}

function isCleanupEnabled(): boolean {
	return process.env.CLINE_CAPTURE_CLEANUP?.trim().toLowerCase() !== "off";
}

function resolveCaptureDir(): string | undefined {
	const explicit = process.env.CLINE_CAPTURE_DIR?.trim();
	if (explicit) {
		return resolve(explicit);
	}
	const dataDir = process.env.CLINE_DATA_DIR?.trim();
	if (dataDir) {
		return resolve(dataDir, "provider-request-captures");
	}
	return undefined;
}

function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	try {
		return (
			JSON.stringify(value, (_key, nestedValue: unknown) => {
				if (typeof nestedValue === "bigint") {
					return nestedValue.toString();
				}
				if (typeof nestedValue !== "object" || nestedValue === null) {
					return nestedValue;
				}
				if (seen.has(nestedValue)) {
					return "[Circular]";
				}
				seen.add(nestedValue);
				return nestedValue;
			}) ?? ""
		);
	} catch {
		return String(value ?? "");
	}
}

function hashString(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function previewValue(
	value: unknown,
	maxBytes = DEFAULT_MAX_PREVIEW_BYTES,
): unknown {
	const serialized = safeStringify(value);
	if (byteLength(serialized) <= maxBytes) {
		return value;
	}
	const previewBuffer = Buffer.from(serialized, "utf8").subarray(0, maxBytes);
	let preview = previewBuffer.toString("utf8");
	while (byteLength(preview) > maxBytes) {
		preview = preview.slice(0, -1);
	}
	return {
		truncated: true,
		bytes: byteLength(serialized),
		sha256: hashString(serialized),
		preview,
	};
}

function summarizeContent(value: unknown): {
	bytes: number;
	estimatedTokens: number;
	sha256: string;
	kind: string;
} {
	const serialized = typeof value === "string" ? value : safeStringify(value);
	return {
		bytes: byteLength(serialized),
		estimatedTokens: estimateTokens(byteLength(serialized)),
		sha256: hashString(serialized),
		kind: Array.isArray(value) ? "array" : typeof value,
	};
}

function summarizeMessages(messages: unknown): Record<string, unknown> {
	if (!Array.isArray(messages)) {
		return summarizeContent(messages);
	}

	const roleCounts: Record<string, number> = {};
	let reasoningBlockCount = 0;
	let toolResultCount = 0;
	const messageSummaries = messages.map((message, index) => {
		const record =
			message && typeof message === "object"
				? (message as Record<string, unknown>)
				: {};
		const role = typeof record.role === "string" ? record.role : "unknown";
		roleCounts[role] = (roleCounts[role] ?? 0) + 1;
		const content = record.content;
		const contentArray = Array.isArray(content) ? content : [content];
		for (const part of contentArray) {
			if (!part || typeof part !== "object") continue;
			const type = (part as Record<string, unknown>).type;
			if (type === "reasoning") reasoningBlockCount += 1;
			if (type === "tool-result" || role === "tool") toolResultCount += 1;
		}
		const contentSummary = summarizeContent(content);
		return {
			index,
			role,
			contentParts: contentArray.length,
			contentBytes: contentSummary.bytes,
			estimatedTokens: contentSummary.estimatedTokens,
			sha256: contentSummary.sha256,
		};
	});

	const largestMessages = [...messageSummaries]
		.sort((a, b) => b.contentBytes - a.contentBytes)
		.slice(0, 5)
		.map((message) => ({ ...message }));
	const serialized = safeStringify(messages);
	return {
		messageCount: messages.length,
		roleCounts,
		totalBytes: byteLength(serialized),
		estimatedTokens: estimateTokens(byteLength(serialized)),
		sha256: hashString(serialized),
		reasoningBlockCount,
		toolResultCount,
		largestMessages,
		messages: messageSummaries,
	};
}

function parseJsonString(value: unknown): unknown {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function extractProviderMessages(
	payloadRecord: Record<string, unknown>,
): unknown {
	if ("messages" in payloadRecord) return payloadRecord.messages;
	const body = payloadRecord.body;
	const parsedBody = parseJsonString(body);
	if (parsedBody && typeof parsedBody === "object") {
		const bodyRecord = parsedBody as Record<string, unknown>;
		if ("messages" in bodyRecord) return bodyRecord.messages;
		if ("prompt" in bodyRecord) return bodyRecord.prompt;
		if ("contents" in bodyRecord) return bodyRecord.contents;
	}
	return undefined;
}

function captureCorrelation(
	request: GatewayStreamRequest,
): Record<string, unknown> {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? request.metadata
			: {};
	return {
		...metadata,
		providerId: request.providerId,
		modelId: request.modelId,
	};
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1).
 *
 * The reasoning-relevant fields of a SERIALIZED provider request body.
 *
 * Only the reasoning CONTROL FIELDS are extracted — never the prompt, never
 * the messages, never the tool arguments, never the credentials. The values
 * are small enumerations and numbers.
 *
 * - `wireThinkingMode` — the serialized thinking mode ("adaptive",
 *   "disabled", "enabled"), or absent when the body carries none.
 * - `wireReasoningEffort` — the serialized effort, or absent.
 * - `wireOutputConfigEffort` — the Anthropic-compatible
 *   `output_config.effort`, or absent.
 * - `wireReasoning` — the serialized `reasoning` object, reduced to its
 *   control fields only.
 * - `wireReasoningEffort` — the OpenAI-compatible `reasoning_effort`, or
 *   absent.
 * - `wireOutputTokenLimit` — the serialized output-token cap, when present.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01: exported so the
 * light-weight wire observer reuses the EXACT same summarizer as the full
 * provider-request capture. There is therefore ONE definition of "the
 * reasoning-relevant view of a serialized body" — the two consumers can
 * never disagree about what the wire carried.
 */
export function summarizeWireReasoning(body: unknown): Record<string, unknown> {
	const parsedBody = parseJsonString(body);
	if (!parsedBody || typeof parsedBody !== "object") {
		return {};
	}
	const bodyRecord = parsedBody as Record<string, unknown>;
	const result: Record<string, unknown> = {};

	const thinking = bodyRecord.thinking;
	if (thinking && typeof thinking === "object") {
		const thinkingRecord = thinking as Record<string, unknown>;
		if (typeof thinkingRecord.type === "string") {
			result.wireThinkingMode = thinkingRecord.type;
		}
	}

	const reasoning = bodyRecord.reasoning;
	if (reasoning && typeof reasoning === "object") {
		const reasoningRecord = reasoning as Record<string, unknown>;
		if (typeof reasoningRecord.effort === "string") {
			result.wireReasoningEffort = reasoningRecord.effort;
		}
		if (typeof reasoningRecord.enabled === "boolean") {
			result.wireReasoningEnabled = reasoningRecord.enabled;
		}
		if (typeof reasoningRecord.exclude === "boolean") {
			result.wireReasoningExcluded = reasoningRecord.exclude;
		}
	}

	if (typeof bodyRecord.reasoning_effort === "string") {
		result.wireReasoningEffort = bodyRecord.reasoning_effort;
	}

	const outputConfig = bodyRecord.output_config;
	if (outputConfig && typeof outputConfig === "object") {
		const outputConfigRecord = outputConfig as Record<string, unknown>;
		if (typeof outputConfigRecord.effort === "string") {
			result.wireOutputConfigEffort = outputConfigRecord.effort;
		}
	}

	const maxTokens =
		bodyRecord.max_tokens ??
		bodyRecord.max_output_tokens ??
		bodyRecord.max_completion_tokens;
	if (typeof maxTokens === "number") {
		result.wireOutputTokenLimit = maxTokens;
	}

	return result;
}

function safeFilePart(value: unknown): string | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const raw = String(value).trim();
	if (!raw) return undefined;
	const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return safe || undefined;
}

function captureIdForCorrelation(correlation: Record<string, unknown>): string {
	const explicit = safeFilePart(correlation.captureId);
	if (explicit) return explicit;
	const hash = hashString(safeStringify(correlation)).slice(0, 16);
	const runId = safeFilePart(correlation.runId);
	const iteration = safeFilePart(correlation.iteration);
	return ["cap", runId, iteration, hash].filter(Boolean).join("_");
}

function nextAttempt(captureId: string, stage: CaptureStage): number {
	const key = `${captureId}:${stage}`;
	const next = (attemptCounters.get(key) ?? 0) + 1;
	attemptCounters.set(key, next);
	return next;
}

function cleanupOldCaptures(dir: string): void {
	if (!isCleanupEnabled() || cleanupDirs.has(dir)) return;
	cleanupDirs.add(dir);
	try {
		const cutoff = Date.now() - CLEANUP_TTL_MS;
		for (const file of readdirSync(dir)) {
			if (
				!file.endsWith(CAPTURE_FILE_EXTENSION) &&
				!(
					file.includes(CAPTURE_FILE_EXTENSION) &&
					file.endsWith(CAPTURE_TMP_EXTENSION)
				)
			) {
				continue;
			}
			const path = join(dir, file);
			const stat = statSync(path);
			if (stat.mtimeMs < cutoff) {
				rmSync(path, { force: true });
			}
		}
	} catch {
		// Capture cleanup must never affect model execution.
	}
}

function writeCapture(record: Record<string, unknown>): void {
	try {
		const dir = resolveCaptureDir();
		if (!dir) return;
		mkdirSync(dir, { recursive: true });
		cleanupOldCaptures(dir);
		const correlation =
			record.correlation && typeof record.correlation === "object"
				? (record.correlation as Record<string, unknown>)
				: {};
		const captureId = captureIdForCorrelation(correlation);
		const stage =
			record.captureStage === "ai_sdk_prompt" ||
			record.captureStage === "wire_request"
				? record.captureStage
				: "ai_sdk_prompt";
		const attempt = nextAttempt(captureId, stage);
		const finalPath = join(
			dir,
			`${captureId}.${stage}.${attempt}${CAPTURE_FILE_EXTENSION}`,
		);
		const tmpPath = `${finalPath}.${process.pid}.${Date.now()}${CAPTURE_TMP_EXTENSION}`;
		writeFileSync(tmpPath, `${safeStringify({ ...record, attempt })}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(tmpPath, finalPath);
		if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
	} catch {
		// Provider-request capture must never affect model execution.
	}
}

export function recordProviderRequestCapture(input: {
	stage: CaptureStage;
	request: GatewayStreamRequest;
	payload: unknown;
	/**
	 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1).
	 *
	 * The reasoning-relevant view of the SERIALIZED request. Recorded
	 * verbatim (it contains only enumerations and numbers), so the wire-level
	 * reasoning policy is observable without retaining the raw body.
	 */
	wireReasoning?: Record<string, unknown>;
}): void {
	try {
		const mode = readCaptureMode();
		if (mode === "off") return;
		const payloadRecord =
			input.payload && typeof input.payload === "object"
				? (input.payload as Record<string, unknown>)
				: { value: input.payload };
		const messages = extractProviderMessages(payloadRecord);
		const serializedPayload = safeStringify(input.payload);
		writeCapture({
			timestamp: new Date().toISOString(),
			captureStage: input.stage,
			mode,
			correlation: captureCorrelation(input.request),
			...(input.wireReasoning && Object.keys(input.wireReasoning).length > 0
				? { wireReasoning: input.wireReasoning }
				: {}),
			summary: {
				payloadBytes: byteLength(serializedPayload),
				estimatedTokens: estimateTokens(byteLength(serializedPayload)),
				sha256: hashString(serializedPayload),
				messages: summarizeMessages(messages),
			},
			...(mode === "full"
				? { payload: previewValue(input.payload, readMaxPreviewBytes()) }
				: {}),
		});
	} catch {
		// Provider-request capture must never affect model execution.
	}
}

async function readRequestBody(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<unknown> {
	const body = init?.body;
	if (body !== undefined && body !== null) {
		if (typeof body === "string") return body;
		if (body instanceof URLSearchParams) return body.toString();
		if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
		if (ArrayBuffer.isView(body)) {
			return Buffer.from(
				body.buffer,
				body.byteOffset,
				body.byteLength,
			).toString("utf8");
		}
		return { type: body.constructor?.name ?? typeof body };
	}
	if (input instanceof Request) {
		try {
			return await input.clone().text();
		} catch {
			return { type: "Request", bodyReadable: false };
		}
	}
	return undefined;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * The correlation identity carried from the request metadata to the wire
 * observation.
 *
 * Every field is read DEFENSIVELY: the metadata bag is an untyped channel
 * that other subsystems also write into, so a non-string / non-number value
 * yields `undefined` rather than being coerced.
 */
function wireReasoningCorrelation(request: GatewayStreamRequest): {
	requestId?: string;
	sessionId?: string;
	taskId?: string;
	runId?: string;
	iteration?: number;
} {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? request.metadata
			: {};
	const requestId =
		metadata[MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY];
	const sessionId = metadata.sessionId;
	const taskId = metadata.taskId;
	const runId = metadata.runId;
	const iteration = metadata.iteration;
	return {
		...(typeof requestId === "string" && requestId.trim() !== ""
			? { requestId }
			: {}),
		...(typeof sessionId === "string" && sessionId.trim() !== ""
			? { sessionId }
			: {}),
		...(typeof taskId === "string" && taskId.trim() !== "" ? { taskId } : {}),
		...(typeof runId === "string" && runId.trim() !== "" ? { runId } : {}),
		...(typeof iteration === "number" && Number.isFinite(iteration)
			? { iteration }
			: {}),
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * The HTTP attempt counters, keyed by the logical request identity.
 *
 * ONE logical model request can produce SEVERAL serialized HTTP attempts:
 * the transport retries an all-empty turn and a mid-stream network
 * interruption (`retry-empty-response.ts`). All of those attempts carry the
 * SAME `requestId`, so the attempt ordinal is what distinguishes them.
 *
 * The counter is keyed by the request id when one is available, and by the
 * request object identity otherwise.
 *
 * BOUNDED: the observer is installed at extension activation, so this map
 * would otherwise grow for the whole process lifetime — one entry per
 * distinct model request. It is therefore capped, and the OLDEST entry is
 * evicted when the cap is reached. `Map` preserves insertion order, so the
 * first key is the oldest. The eviction only affects the ATTEMPT ORDINAL of
 * a request that has been evicted (the ordinal restarts at 1); it never
 * affects the correlation identity, which is the part the trace joins on.
 */
const wireAttemptCounters = new Map<string, number>();

/**
 * The maximum number of tracked logical requests.
 *
 * A long session can make thousands of model requests; 4096 entries is
 * far beyond any realistic single-session count while keeping the map's
 * memory footprint trivially small.
 */
const WIRE_ATTEMPT_COUNTER_MAX_ENTRIES = 4096;

/**
 * The counter key for ONE logical request.
 *
 * The request id is preferred: it is stable across every HTTP attempt of
 * that request. The request object identity is the fallback for requests
 * that carry no id (e.g. a direct gateway caller).
 */
function wireAttemptCounterKey(request: GatewayStreamRequest): string {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? request.metadata
			: {};
	const requestId =
		metadata[MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY];
	if (typeof requestId === "string" && requestId.trim() !== "") {
		return `id:${requestId}`;
	}
	return `obj:${requestIdOf(request)}`;
}

/**
 * A stable-per-request fallback key.
 *
 * A `WeakMap` cannot be iterated, so the object identity is tracked with a
 * monotonically increasing id held in a `WeakMap`. The `WeakMap` does not
 * keep the request object alive.
 */
const requestObjectIds = new WeakMap<GatewayStreamRequest, number>();
let nextRequestObjectId = 1;

function requestIdOf(request: GatewayStreamRequest): number {
	const existing = requestObjectIds.get(request);
	if (existing !== undefined) {
		return existing;
	}
	const assigned = nextRequestObjectId++;
	requestObjectIds.set(request, assigned);
	return assigned;
}

/**
 * The 1-based HTTP attempt ordinal for ONE logical request.
 */
function nextWireAttempt(request: GatewayStreamRequest): number {
	const key = wireAttemptCounterKey(request);
	const next = (wireAttemptCounters.get(key) ?? 0) + 1;
	// Evict the OLDEST entry once the cap is reached, so the map cannot
	// grow without bound over a long-lived process.
	if (
		wireAttemptCounters.size >= WIRE_ATTEMPT_COUNTER_MAX_ENTRIES &&
		!wireAttemptCounters.has(key)
	) {
		const oldest = wireAttemptCounters.keys().next();
		if (!oldest.done) {
			wireAttemptCounters.delete(oldest.value);
		}
	}
	wireAttemptCounters.set(key, next);
	return next;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * Report the SERIALIZED wire controls of ONE provider HTTP attempt to the
 * registered wire observers.
 *
 * This is INDEPENDENT of the full provider-request capture: it never writes
 * a capture file and never retains the prompt, the messages, the tool
 * arguments or the credentials. Only the reasoning-relevant control fields
 * of the serialized body are reported.
 */
function notifyWireReasoningObservers(
	request: GatewayStreamRequest,
	body: unknown,
	method: string,
): void {
	try {
		if (!hasModelBehaviorWireReasoningObserver()) {
			return;
		}
		const wire = summarizeWireReasoning(body);
		notifyModelBehaviorWireReasoningObservers({
			...wireReasoningCorrelation(request),
			attempt: nextWireAttempt(request),
			providerId: request.providerId,
			modelId: request.modelId,
			httpMethod: method,
			...(typeof wire.wireThinkingMode === "string"
				? { wireThinkingMode: wire.wireThinkingMode }
				: {}),
			...(typeof wire.wireReasoningEffort === "string"
				? { wireReasoningEffort: wire.wireReasoningEffort }
				: {}),
			...(typeof wire.wireReasoningEnabled === "boolean"
				? { wireReasoningEnabled: wire.wireReasoningEnabled }
				: {}),
			...(typeof wire.wireReasoningExcluded === "boolean"
				? { wireReasoningExcluded: wire.wireReasoningExcluded }
				: {}),
			...(typeof wire.wireOutputConfigEffort === "string"
				? { wireOutputConfigEffort: wire.wireOutputConfigEffort }
				: {}),
			...(typeof wire.wireOutputTokenLimit === "number"
				? { wireOutputTokenLimit: wire.wireOutputTokenLimit }
				: {}),
		});
	} catch {
		// The wire observer must never affect model execution.
	}
}

export function wrapFetchForProviderRequestCapture(
	baseFetch: typeof fetch | undefined,
	request: GatewayStreamRequest,
): typeof fetch | undefined {
	// ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01: the light-weight
	// wire observer is INDEPENDENT of the full provider-request capture.
	//
	// The full capture remains gated by `CLINE_CAPTURE_WIRE` exactly as
	// before; the observer is gated by the presence of a registered
	// observer. When NEITHER is active the fetch is returned UNWRAPPED, so
	// the default path is byte-identical to a build without this feature.
	const captureEnabled = isWireCaptureEnabled();
	const observerEnabled = hasModelBehaviorWireReasoningObserver();
	if (!captureEnabled && !observerEnabled) {
		return baseFetch;
	}
	const delegate = baseFetch ?? globalThis.fetch;
	if (!delegate) {
		return baseFetch;
	}
	const captureFetch = (async (input, init) => {
		const method =
			init?.method ??
			(input instanceof Request ? input.method : undefined) ??
			"GET";
		void readRequestBody(input, init)
			.then((body) => {
				// The observer is checked at CALL time, not only at wrap
				// time, so an observer registered between the wrap and the
				// request is still honored.
				if (hasModelBehaviorWireReasoningObserver()) {
					notifyWireReasoningObservers(request, body, method);
				}
				if (!captureEnabled) {
					return;
				}
				recordProviderRequestCapture({
					stage: "wire_request",
					request,
					payload: {
						url: input instanceof Request ? input.url : String(input),
						method,
						body,
					},
					// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1):
					// the reasoning-relevant view of the SERIALIZED body. This
					// is the wire-level authority for the reasoning policy; the
					// raw body is never retained.
					wireReasoning: summarizeWireReasoning(body),
				});
			})
			.catch(() => {
				// Provider-request capture must never affect model execution.
			});
		return delegate(input, init);
	}) as typeof fetch;
	const delegateWithPreconnect = delegate as typeof fetch & {
		preconnect?: (...args: unknown[]) => unknown;
	};
	if (typeof delegateWithPreconnect.preconnect === "function") {
		(
			captureFetch as typeof fetch & {
				preconnect?: (...args: unknown[]) => unknown;
			}
		).preconnect = delegateWithPreconnect.preconnect.bind(delegate);
	}
	return captureFetch;
}
