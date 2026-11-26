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
import { getPrefixForensicsCohortId } from "@cline/shared";

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
 * EVERY field is a scalar, so the record is bounded by construction. The
 * record NEVER carries conversation content, a prompt, a tool argument or a
 * credential.
 *
 * ============================================================================
 * THE IDENTITY MODEL — EACH IDENTITY IS DISTINCT
 * ============================================================================
 *
 * The amendment requires that no identity substitutes for another:
 *
 *   runCohortId           the RUN identity. It is the SAME cohort id the
 *                         prefix-forensics capture uses, so the two captures
 *                         join on it.
 *   sessionId             the SESSION identity.
 *   decisionId            the COMPACTION DECISION identity.
 *   preparationRequestId  the CURRENT preparation identity — the request the
 *                         runtime is preparing now.
 *   lastDispatchedRequestId
 *                         the LAST DISPATCHED ordinary request identity. It
 *                         is ABSENT at the PCK boundary: the runtime does
 *                         not retain the dispatched request's identity there.
 *                         The ABSENCE is preserved explicitly by
 *                         `lastDispatchedRequestIdAvailable`, so it is never
 *                         inferred from timestamp proximity.
 *   pckLogicalRequestId   the PCK LOGICAL request identity — the attempt's
 *                         identity within the decision.
 *   pckPhysicalAttemptId  the PCK PHYSICAL attempt identity — the
 *                         transport's own per-request id. It is the JOIN key
 *                         with the provider's own capture.
 */
export interface PckPrefixCaptureRecord {
	/** The RUN identity: the shared prefix-forensics cohort id. */
	readonly runCohortId: string;
	/** The wall-clock instant of the attempt. */
	readonly capturedAt: string;
	/** The SESSION identity, when the host supplied it. */
	readonly sessionId: string | undefined;
	/**
	 * The COMPACTION DECISION identity.
	 *
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	 * — F2.
	 *
	 * It is the EXACT identity of the decision that ORIGINATED the
	 * attempt. It is never minted, substituted or defaulted: a capture
	 * that cannot name its decision says so, but it never invents one.
	 */
	readonly decisionId: string | undefined;
	/** The CURRENT preparation identity, when the host supplied it. */
	readonly preparationRequestId: string | undefined;
	/**
	 * The LAST DISPATCHED ordinary request identity.
	 *
	 * It is ABSENT at the PCK boundary. The absence is preserved, never
	 * inferred.
	 */
	readonly lastDispatchedRequestId: string | undefined;
	/** Whether a last-dispatched ordinary request identity was available. */
	readonly lastDispatchedRequestIdAvailable: boolean;
	/** The PCK LOGICAL request identity. */
	readonly pckLogicalRequestId: string;
	/**
	 * The PCK PHYSICAL attempt identity — the JOIN key with the provider's
	 * own capture.
	 */
	readonly pckPhysicalAttemptId: string | undefined;
	/** The ROUTE the request took. */
	readonly route: PckPrefixCaptureRoute;
	/** The provider id. */
	readonly providerId: string | undefined;
	/** The model id. */
	readonly modelId: string | undefined;
	/** The REQUEST PURPOSE. It is ALWAYS "pck". */
	readonly purpose: "pck";
	/**
	 * The ACTUAL RESOLVED inference policy identifier.
	 *
	 * It is captured at the policy's RESOLUTION boundary, so it is the policy
	 * that was really applied — not the one an operator selected.
	 */
	readonly resolvedInferencePolicyId: string | undefined;
	/** The provider-reported input tokens. ABSENT means UNKNOWN. */
	readonly inputTokens: number | undefined;
	/** The provider-reported CACHE-READ tokens. ABSENT means UNKNOWN. */
	readonly cacheReadTokens: number | undefined;
	/** The request duration, in milliseconds, as observed by the runtime. */
	readonly durationMs: number | undefined;
	/**
	 * The PHYSICAL attempt cardinality — how many physical provider
	 * requests the attempt issued, including retries.
	 */
	/**
	 * The OBSERVED PHYSICAL attempt cardinality — how many physical
	 * provider requests the attempt issued, including retries.
	 *
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	 * — F2.
	 *
	 * It is the provider's own observed cardinality. It is ABSENT when
	 * the provider established none: an absent cardinality is UNKNOWN,
	 * and it is never replaced by a hardcoded constant.
	 */
	readonly physicalAttemptCount?: number /** The EXTRACTION outcome. */;
	readonly extractionOutcome: "accepted" | "rejected" | "failed";
	/** The failure reason, when the attempt failed. */
	readonly failureReason: string | undefined;
	/**
	 * The number of records the PUBLICATION GATE admitted.
	 *
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	 * — F2.
	 *
	 * This is the ADMITTED count. It is NOT the projected count and NOT
	 * the committed count.
	 */
	readonly gateAdmittedRecordCount: number;
	/**
	 * The number of records PROJECTED into the compacted transcript.
	 *
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	 * — F2.
	 *
	 * PROJECTED is the state between ADMITTED and COMMITTED: the records
	 * the projection placed into the transcript that is ABOUT to be
	 * written. It is distinct from the admitted count, because the
	 * projection can carry fewer records than the gate admitted.
	 */
	readonly projectedRecordCount: number;
	/**
	 * The number of records COMMITTED into the persisted transcript.
	 *
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01)
	 * — F2.
	 *
	 * COMMITTED is the state the installation actually persisted. It is
	 * ZERO when the installation did not happen, so a record that was
	 * admitted and projected but never written is distinguishable from
	 * one that was written.
	 */
	readonly committedRecordCount: number;
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
 *
 * The RUN identity is the SHARED prefix-forensics cohort id, so the two
 * captures join on it. It is resolved HERE, at the capture's own boundary,
 * and it is never a substituted identity.
 */
export function recordPckPrefixCapture(
	record: Omit<PckPrefixCaptureRecord, "runCohortId">,
): void {
	try {
		if (!isPckPrefixCaptureEnabled()) {
			return;
		}
		const directory = captureDirectory();
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		appendFileSync(
			join(directory, "pck-prefix-capture.jsonl"),
			`${JSON.stringify({
				...record,
				runCohortId: getPrefixForensicsCohortId(),
			})}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	} catch {
		// The capture must never affect the attempt.
	}
}
