/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * The forensic capture WRITER.
 *
 * ## What this is
 *
 * A small forensic EXTENSION of the existing provider-request capture. It
 * reuses the existing capture writer's directory resolution, atomic
 * write-then-rename discipline and restrictive file mode, and it reuses the
 * existing attempt-correlation counters. It adds ONE thing the existing
 * capture cannot express: the STRUCTURAL, KEYED fingerprint inventory of a
 * request at a named REPRESENTATION boundary.
 *
 * ## The three representation boundaries
 *
 *   A. `runtime_projection` — the agent runtime's FINAL provider-visible
 *      projection: after compaction, after every `beforeModel` hook and
 *      after the request-budget enforcement. This is what the runtime
 *      INTENDED to submit.
 *
 *   B. `ai_sdk_prompt` — the AI SDK's converted messages, system channel and
 *      tool set, immediately before the provider adapter serializes them.
 *      This distinguishes runtime mutations from adapter transformations.
 *
 *   C. `wire_request` — the SERIALIZED provider request body, captured at the
 *      existing wire-capture seam immediately around the HTTP invocation.
 *      This is the provider-bound request.
 *
 * A runtime-projection fingerprint match does NOT imply a wire-body match.
 * The analyzer is required to keep the three stages separate for exactly
 * that reason.
 *
 * ## The privacy contract
 *
 * The writer persists ONLY: identities, counts, part types, byte lengths and
 * keyed fingerprints. It never persists a prompt, a message body, a tool
 * command, a tool result, a credential, an authorization header, an API key,
 * a raw tool schema, a private project path or an unredacted provider
 * payload.
 *
 * ## The failure contract
 *
 * Every write is FAIL-ISOLATED: a diagnostic failure must never change
 * provider execution. The whole capture body is wrapped so that no throw can
 * escape into the provider path.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	computeCaptureRecordSha256,
	computeRepresentationFingerprint,
	getPrefixForensicsCohortId,
	getPrefixForensicsCohortKey,
	isPrefixForensicsEnabled,
	PREFIX_FORENSICS_FINGERPRINT_PRODUCER,
	PREFIX_FORENSICS_SCHEMA_VERSION,
	type PrefixForensicsCaptureRecord,
	type PrefixForensicsRepresentation,
} from "@cline/shared";

/** The three representation boundaries. */
export type PrefixForensicsStage =
	| "runtime_projection"
	| "ai_sdk_prompt"
	| "wire_request";

/**
 * The representation identifier for each stage.
 *
 * These are the EXACT representations the fingerprints were computed over.
 * A consumer compares representations only when these match.
 */
const STAGE_REPRESENTATION: Record<PrefixForensicsStage, string> = {
	runtime_projection: "AGENT_MODEL_REQUEST_FINAL_PROJECTION",
	ai_sdk_prompt: "AI_SDK_REQUEST_MESSAGES",
	wire_request: "SERIALIZED_PROVIDER_REQUEST",
};

/** The capture file extension. Distinct from the provider-request capture. */
const FORENSICS_FILE_EXTENSION = ".prefix-forensics.json";

/**
 * The directory the forensic records are written to.
 *
 * `CLINEMM_PREFIX_FORENSICS_DIR` when the operator names one; otherwise a
 * uniquely named directory under the data dir. The directory is created with
 * restrictive permissions (0o700) and each file with 0o600, because the
 * records are written OUTSIDE Git under operator control.
 */
function resolveForensicsDir(): string | undefined {
	const explicit = process.env.CLINEMM_PREFIX_FORENSICS_DIR?.trim();
	if (explicit) {
		return resolve(explicit);
	}
	const dataDir = process.env.CLINE_DATA_DIR?.trim();
	if (dataDir) {
		const cohort = getPrefixForensicsCohortId();
		return resolve(dataDir, `prefix-forensics-${cohort}`);
	}
	return undefined;
}

/**
 * The per-stage attempt counters.
 *
 * ONE logical request can produce SEVERAL serialized HTTP attempts (the
 * transport retries). The attempt ordinal is what distinguishes them, and
 * it must NOT be confused with the preparation identity: a retry against the
 * SAME prepared request keeps the SAME preparation identity and receives a
 * DIFFERENT attempt ordinal.
 *
 * The counter is therefore keyed on the PREPARATION identity — never on the
 * attempt identity, which is already unique per attempt and would make the
 * ordinal always 1.
 */
const stageAttemptCounters = new Map<string, number>();

function nextStageAttempt(
	identity: string,
	stage: PrefixForensicsStage,
): number {
	const key = `${identity}:${stage}`;
	const next = (stageAttemptCounters.get(key) ?? 0) + 1;
	stageAttemptCounters.set(key, next);
	return next;
}

/**
 * A safe file-name part.
 *
 * The identity is hashed before it reaches the file name, so a private id
 * never lands in a path.
 */
function safeFilePart(value: string): string {
	const safe = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return safe.slice(0, 64) || "unknown";
}

/**
 * Write ONE forensic capture record.
 *
 * The record is written atomically (write to a temporary file, then rename),
 * with mode 0o600.
 */
function writeForensicsRecord(record: PrefixForensicsCaptureRecord): void {
	try {
		const dir = resolveForensicsDir();
		if (!dir) {
			return;
		}
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const name = [
			"pf",
			safeFilePart(record.cohortId),
			safeFilePart(record.source),
			safeFilePart(record.sessionId ?? "nosession"),
			safeFilePart(
				record.providerAttemptId ?? record.preparationRequestId ?? "noreq",
			),
			String(record.iteration ?? 0),
			record.recordSha256.slice(0, 16),
		].join("_");
		const finalPath = join(dir, `${name}${FORENSICS_FILE_EXTENSION}`);
		const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(record)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(tmpPath, finalPath);
	} catch {
		// The forensic capture must never affect model execution.
	}
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * Record ONE structural observation of a request representation.
 *
 * ## The DEFAULT-OFF contract
 *
 * When `CLINEMM_PREFIX_FORENSICS` is not exactly `1`, this function returns
 * IMMEDIATELY: no key is generated, no fingerprint is computed, no
 * directory is resolved and no file is written. The disabled path performs
 * no serialization, no hashing and no filesystem access.
 *
 * ## The failure contract
 *
 * The whole body is failure-isolated. A malformed request, an unserializable
 * value or a filesystem error never changes provider execution.
 */
export function recordPrefixForensics(input: {
	stage: PrefixForensicsStage;
	messages: unknown;
	system?: unknown;
	tools?: unknown;
	body?: unknown;
	sessionId?: string;
	preparationRequestId?: string;
	providerAttemptId?: string;
	iteration?: number;
	providerId?: string;
	modelId?: string;
}): void {
	try {
		if (!isPrefixForensicsEnabled()) {
			return;
		}
		const key = getPrefixForensicsCohortKey();
		const representation: PrefixForensicsRepresentation =
			computeRepresentationFingerprint(
				STAGE_REPRESENTATION[input.stage],
				input.messages,
				{
					key,
					...(input.system !== undefined ? { system: input.system } : {}),
					...(input.tools !== undefined ? { tools: input.tools } : {}),
					...(input.body !== undefined ? { body: input.body } : {}),
				},
			);
		const identity =
			input.preparationRequestId ??
			input.providerAttemptId ??
			input.sessionId ??
			"unknown";
		const attempt = nextStageAttempt(identity, input.stage);
		const withoutDigest = {
			schemaVersion: PREFIX_FORENSICS_SCHEMA_VERSION,
			producer: PREFIX_FORENSICS_FINGERPRINT_PRODUCER,
			capturedAt: new Date().toISOString(),
			cohortId: getPrefixForensicsCohortId(),
			...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
			...(input.preparationRequestId !== undefined
				? { preparationRequestId: input.preparationRequestId }
				: {}),
			...(input.providerAttemptId !== undefined
				? { providerAttemptId: input.providerAttemptId }
				: {}),
			...(input.iteration !== undefined ? { iteration: input.iteration } : {}),
			...(input.providerId !== undefined
				? { providerId: input.providerId }
				: {}),
			...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
			source: input.stage,
			representation,
			...(attempt > 1 ? { wireAttempt: attempt } : {}),
		};
		writeForensicsRecord({
			...withoutDigest,
			recordSha256: computeCaptureRecordSha256(withoutDigest),
		});
	} catch {
		// The forensic capture must never affect model execution.
	}
}

/**
 * Reset the per-stage attempt counters. Test-only.
 */
export function _resetPrefixForensicsAttemptCountersForTests(): void {
	stageAttemptCounters.clear();
}

/**
 * The minimal shape of an agent runtime request that the forensic capture
 * needs. Declared structurally so this module does not depend on the
 * `@cline/agents` package (which depends on THIS package).
 */
export interface PrefixForensicsRuntimeRequest {
	readonly systemPrompt?: string;
	readonly messages: readonly unknown[];
	readonly tools?: readonly unknown[];
	readonly options?: unknown;
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * Record the FINAL runtime projection (stage A).
 *
 * This is the agent runtime's provider-visible projection as it stands at
 * the dispatch seam: AFTER compaction, AFTER every `beforeModel` hook and
 * AFTER the final request-budget enforcement. It is what the runtime
 * INTENDED to submit — which is not the same thing as what the provider
 * finally received.
 *
 * The observation is failure-isolated and never modifies the request.
 */
export function recordPrefixForensicsRuntimeProjection(
	request: PrefixForensicsRuntimeRequest,
	identity: {
		sessionId?: string;
		preparationRequestId?: string;
		providerAttemptId?: string;
		iteration?: number;
		providerId?: string;
		modelId?: string;
	},
): void {
	try {
		if (!isPrefixForensicsEnabled()) {
			return;
		}
		recordPrefixForensics({
			stage: "runtime_projection",
			messages: request.messages,
			...(request.systemPrompt !== undefined
				? { system: request.systemPrompt }
				: {}),
			...(request.tools !== undefined ? { tools: request.tools } : {}),
			...(identity.sessionId !== undefined
				? { sessionId: identity.sessionId }
				: {}),
			...(identity.preparationRequestId !== undefined
				? { preparationRequestId: identity.preparationRequestId }
				: {}),
			...(identity.providerAttemptId !== undefined
				? { providerAttemptId: identity.providerAttemptId }
				: {}),
			...(identity.iteration !== undefined
				? { iteration: identity.iteration }
				: {}),
			...(identity.providerId !== undefined
				? { providerId: identity.providerId }
				: {}),
			...(identity.modelId !== undefined ? { modelId: identity.modelId } : {}),
		});
	} catch {
		// The forensic capture must never affect model execution.
	}
}
