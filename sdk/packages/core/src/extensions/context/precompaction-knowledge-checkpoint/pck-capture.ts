/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
 *
 * The MINIMUM capture configuration the live-qualification successor needs.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * The successor must observe, for the auxiliary request:
 *
 *   run identity, session identity, compaction decision identity, parent
 *   request identity, PCK request identity, route/model identity, request
 *   purpose, effective generation policy, input tokens, cache-read tokens,
 *   request duration, extraction outcome and publication outcome.
 *
 * MOST of those are already observable through the EXISTING capture
 * infrastructure:
 *
 *   - `CLINEMM_PREFIX_FORENSICS=1` records the request REPRESENTATION
 *     fingerprint at the `ai_sdk_prompt` and `wire_request` stages, together
 *     with the session id, the preparation request id, the provider attempt
 *     id, the provider id and the model id.
 *   - `CLINEMM_USAGE_OBSERVABILITY=1` records the provider's reported usage,
 *     including `cacheReadTokens`.
 *
 * What those captures CANNOT express is the PCK-SPECIFIC identity: which
 * request was the auxiliary one, which compaction decision it belonged to,
 * which ROUTE it took, and what the extraction and publication outcomes
 * were.
 *
 * This module supplies EXACTLY that, and nothing else. It is a BOUNDED,
 * DEFAULT_OFF diagnostic.
 *
 * ============================================================================
 * THE DEFAULT-OFF CONTRACT
 * ============================================================================
 *
 * When `CLINEMM_PCK_PREFIX_CAPTURE` is not exactly "1", every function here
 * returns IMMEDIATELY: no key is generated, no directory is resolved and no
 * file is written. The disabled path performs NO serialization, NO hashing
 * and NO filesystem access, and it has NO semantic effect on the request.
 *
 * ============================================================================
 * THE JOIN KEY
 * ============================================================================
 *
 * The record carries the PHYSICAL provider request id, which is the SAME
 * identity the provider's own capture records. The successor therefore joins
 * this record with the prefix-forensics and usage records on that id.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The environment variable that enables the capture.
 */
export const PCK_PREFIX_CAPTURE_ENV_VAR = "CLINEMM_PCK_PREFIX_CAPTURE";

/**
 * Whether the capture is enabled.
 */
export function isPckPrefixCaptureEnabled(
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return env[PCK_PREFIX_CAPTURE_ENV_VAR]?.trim() === "1";
}

/**
 * The ROUTE the auxiliary request took.
 */
export type PckPrefixCaptureRoute = "b_prime" | "legacy";

/**
 * ONE capture record.
 *
 * Every field is a scalar, so the record is bounded by construction. The
 * record NEVER carries conversation content, a prompt, a tool argument or a
 * credential.
 */
export interface PckPrefixCaptureRecord {
	/** The RUN identity: the capture's cohort id. */
	readonly cohortId: string;
	/** The wall-clock instant of the attempt. */
	readonly capturedAt: string;
	/** The SESSION identity, when the host supplied it. */
	readonly sessionId: string | undefined;
	/** The COMPACTION DECISION identity. */
	readonly decisionId: string;
	/** The canonical source-prefix identity the attempt was bound to. */
	readonly sourcePrefixKey: string;
	/** The PARENT request identity, when the host supplied it. */
	readonly parentRequestId: string | undefined;
	/** The PHYSICAL provider request id — the JOIN key. */
	readonly providerRequestId: string | undefined;
	/** The ROUTE the request took. */
	readonly route: PckPrefixCaptureRoute;
	/** The provider id. */
	readonly providerId: string | undefined;
	/** The model id. */
	readonly modelId: string | undefined;
	/** The REQUEST PURPOSE. It is ALWAYS "pck". */
	readonly purpose: "pck";
	/** The effective generation policy identifier, when one applied. */
	readonly inferencePolicyId: string | undefined;
	/** The provider-reported input tokens. */
	readonly inputTokens: number | undefined;
	/** The provider-reported CACHE-READ tokens. */
	readonly cacheReadTokens: number | undefined;
	/** The request duration, in milliseconds, as observed by the runtime. */
	readonly durationMs: number | undefined;
	/** The EXTRACTION outcome. */
	readonly extractionOutcome: "accepted" | "rejected" | "failed";
	/** The failure reason, when the attempt failed. */
	readonly failureReason: string | undefined;
	/** The PUBLICATION outcome: how many records were admitted. */
	readonly publishedRecordCount: number;
}

/**
 * The capture DIRECTORY.
 *
 * It lives under the shared Cline data directory, so it is separated from
 * the repository and is removed with the rest of the local state.
 *
 * `HOME` is read directly rather than through `homedir()`, so the capture
 * is redirectable for a test without touching the process's home
 * directory.
 */
function captureDirectory(): string {
	const home = process.env.HOME ?? homedir();
	return join(home, ".cline", "data", "pck-prefix-capture");
}

/**
 * Record ONE auxiliary-request observation.
 *
 * It is failure-isolated: a filesystem error never changes the request's
 * outcome.
 */
export function recordPckPrefixCapture(record: PckPrefixCaptureRecord): void {
	try {
		if (!isPckPrefixCaptureEnabled()) {
			return;
		}
		const directory = captureDirectory();
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		appendFileSync(
			join(directory, "pck-prefix-capture.jsonl"),
			`${JSON.stringify(record)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	} catch {
		// The capture must never affect the attempt.
	}
}
