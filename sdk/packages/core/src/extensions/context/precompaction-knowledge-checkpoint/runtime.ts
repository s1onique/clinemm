/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * PRODUCTION runtime control for the Pre-Compaction Knowledge Checkpoint (PCK).
 *
 * ============================================================================
 * THE FEATURE IS DEFAULT-OFF
 * ============================================================================
 *
 * The checkpoint is an ADDITIONAL model call. It must never become a reason
 * for the underlying agent to stall, and it must never change ordinary
 * compaction behaviour unless an operator explicitly enables it.
 *
 * The opt-in is a narrowly scoped environment variable, because the ACT
 * forbids introducing a permanent settings/protobuf field solely to support
 * this experiment:
 *
 *   CLINEMM_PCK_CLOSED_ENABLED=1
 *
 * With the flag OFF, the production path is BYTE-IDENTICAL to the
 * pre-ACT behaviour: no additional model call, no additional summary, no
 * changed provider messages, no changed sidecar state, no changed task
 * contract, no changed tool-result pairing, no changed stable prefix, no
 * changed callback cardinality and no new public message.
 *
 * ============================================================================
 * THE DEADLINE
 * ============================================================================
 *
 * The predecessor measured two legitimate checkpoint model costs:
 *
 *   Boundary 1: 178 853 ms
 *   Boundary 2:  73 827 ms
 *
 * A default deadline SMALLER than those would reject legitimate
 * executions, so the default is at least the slower observed cost. The
 * deadline is FINITE and RECORDED, and it is always the MINIMUM of the
 * operator-selected deadline and the time remaining in the task's own
 * budget, so a checkpoint can never starve the subsequent compaction
 * request.
 *
 * ============================================================================
 * NO RETRY LOOP
 * ============================================================================
 *
 * On provider failure, timeout, cancellation, invalid JSON, an unknown
 * atom, an unknown field, an invalid reference, an oversized output or an
 * unsupported assurance, the attempt TERMINATES. The ordinary compaction
 * continues using its existing failure policy. There is no automatic
 * second checkpoint generation.
 */

import type { MessageWithMetadata } from "@cline/shared";
import {
	collectObservedCanonicalReferences,
	interpretCanonicalEvidence,
} from "./evidence";
import {
	buildCheckpointInputView,
	buildCheckpointRequest,
	CHECKPOINT_SYSTEM_PROMPT,
	extractCheckpointJson,
	extractCheckpointProposals,
} from "./model-request";
import {
	type AdmittedCheckpointRecord,
	gateClosedProposals,
} from "./publication-gate";

/**
 * The environment variable that opts into the closed PCK.
 */
export const PCK_ENABLE_ENV_VAR = "CLINEMM_PCK_CLOSED_ENABLED";

/**
 * The environment variable that overrides the checkpoint deadline.
 */
export const PCK_DEADLINE_ENV_VAR = "CLINEMM_PCK_CLOSED_DEADLINE_MS";

/**
 * The DEFAULT checkpoint deadline, in milliseconds.
 *
 * It is NOT smaller than the slowest legitimate execution the predecessor
 * observed (178 853 ms), so a legitimate checkpoint is not rejected by the
 * clock alone.
 */
export const DEFAULT_PCK_DEADLINE_MS = 180_000;

/**
 * The maximum number of GENERATION attempts for one compaction decision.
 *
 * The budget in the ACT is two attempts, and no automatic retries.
 */
export const MAX_PCK_GENERATION_ATTEMPTS = 2;

/**
 * The maximum characters of a checkpoint model response.
 *
 * An oversized response is a rejection, not a truncation: a truncated
 * response is not a well-formed candidate.
 */
export const MAX_PCK_RESPONSE_CHARS = 64_000;

/**
 * Whether the closed PCK is enabled.
 *
 * The flag is read from the environment. The value must be exactly "1" or
 * "true" (case-insensitive) so an unrelated value cannot enable it
 * accidentally.
 */
export function isPckClosedEnabled(
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	const raw = env[PCK_ENABLE_ENV_VAR];
	if (typeof raw !== "string") {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true";
}

/**
 * Resolve the operator-selected checkpoint deadline.
 *
 * The deadline is always FINITE. A non-numeric, negative, zero or
 * non-finite value falls back to the default rather than disabling the
 * bound.
 */
export function resolvePckDeadlineMs(
	env: Readonly<Record<string, string | undefined>> = process.env,
): number {
	const raw = env[PCK_DEADLINE_ENV_VAR];
	if (typeof raw !== "string") {
		return DEFAULT_PCK_DEADLINE_MS;
	}
	const parsed = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_PCK_DEADLINE_MS;
	}
	return parsed;
}

/**
 * The identity of ONE compaction decision's checkpoint attempt.
 *
 * The identity binds the attempt to the ACTUAL compaction decision and to
 * the canonical source prefix the checkpoint was generated from. It exists
 * so a re-evaluated `prepareTurn` cannot silently repeat a checkpoint
 * attempt for the same decision.
 */
export interface PckAttemptIdentity {
	/** The compaction decision identity. */
	readonly decisionId: string;
	/** The canonical source-prefix identity. */
	readonly sourcePrefixKey: string;
}

/**
 * The reason a checkpoint attempt ended without an accepted record.
 */
export type PckFailureReason =
	| "disabled"
	| "provider_failure"
	| "timeout"
	| "cancelled"
	| "invalid_json"
	| "no_public_response"
	| "oversized_output"
	| "tool_call_attempted"
	| "gate_rejected"
	| "stale_source_prefix";

/**
 * The outcome of ONE checkpoint attempt.
 */
export interface PckAttemptOutcome {
	/** The accepted records. Empty when the attempt failed. */
	readonly records: readonly AdmittedCheckpointRecord[];
	/** The failure reason, or undefined when the attempt succeeded. */
	readonly failureReason?: PckFailureReason;
	/** The gate's reason codes, when the gate rejected the candidate. */
	readonly gateCodes?: readonly string[];
	/** Whether the attempt was ACCEPTED (at least one admitted record). */
	readonly accepted: boolean;
}

/**
 * The provider call the checkpoint attempt makes.
 *
 * The implementation is injected so the production seam can use the
 * existing `generateSummary` transport, and so the qualification tests can
 * drive the SAME seam with a deterministic provider.
 */
export type PckGenerate = (input: {
	readonly systemPrompt: string;
	readonly request: string;
	readonly signal: AbortSignal;
}) => Promise<{
	readonly text: string;
	readonly reasoningChars: number;
	readonly usedTools: boolean;
	readonly failed: boolean;
}>;

/**
 * Combine the task's abort signal with the checkpoint's own deadline.
 *
 * The combined signal fires when EITHER source fires, so a cancellation of
 * the originating task cancels the checkpoint attempt and the deadline
 * bounds an attempt that never completes.
 *
 * The returned handle also exposes whether the DEADLINE (rather than the
 * task's cancellation) fired, so the caller can record the right reason.
 */
export function createPckAbortHandle(input: {
	readonly taskSignal: AbortSignal;
	readonly deadlineMs: number;
}): {
	readonly signal: AbortSignal;
	readonly dispose: () => void;
	readonly timedOut: () => boolean;
} {
	const controller = new AbortController();
	let timedOut = false;
	const onTaskAbort = () => controller.abort(input.taskSignal.reason);
	if (input.taskSignal.aborted) {
		controller.abort(input.taskSignal.reason);
	} else {
		input.taskSignal.addEventListener("abort", onTaskAbort, { once: true });
	}
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error("PCK deadline exceeded"));
	}, input.deadlineMs);
	// The timer must not hold the process open.
	if (typeof timer.unref === "function") {
		timer.unref();
	}
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timer);
			input.taskSignal.removeEventListener("abort", onTaskAbort);
		},
		timedOut: () => timedOut,
	};
}

/**
 * RUN ONE checkpoint attempt for ONE compaction decision.
 *
 * The order of operations is load-bearing:
 *
 *   1. The controlled input is built from the CANONICAL history.
 *   2. The MODEL CALL happens under the combined deadline/cancellation.
 *   3. The response is parsed and the PROPOSALS are extracted. A response
 *      with no public content, or that attempted a tool call, is rejected.
 *   4. The source prefix is RE-VERIFIED after the model call: a checkpoint
 *      generated from a prefix that has since changed is STALE and is
 *      rejected rather than published against a newer prefix.
 *   5. The PUBLICATION GATE runs BEFORE any destination receives the
 *      candidate.
 *
 * There is NO retry loop inside this function. The caller may invoke it
 * again for the same decision ONLY when the first attempt produced no
 * public response at all, which the ACT's budget bounds at two attempts.
 */
export async function runPckAttempt(input: {
	readonly generate: PckGenerate;
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly identity: PckAttemptIdentity;
	readonly taskSignal: AbortSignal;
	readonly deadlineMs: number;
	/**
	 * Re-read the canonical source-prefix identity at publication time.
	 *
	 * The runtime supplies it so a checkpoint cannot claim it was acquired
	 * earlier than it actually was.
	 */
	readonly currentSourcePrefixKey: () => string;
}): Promise<PckAttemptOutcome> {
	const observedReferences = collectObservedCanonicalReferences(
		input.canonicalMessages,
	);
	const inputView = buildCheckpointInputView(input.canonicalMessages);
	const request = buildCheckpointRequest(inputView, observedReferences);
	const handle = createPckAbortHandle({
		taskSignal: input.taskSignal,
		deadlineMs: input.deadlineMs,
	});
	let response: {
		text: string;
		reasoningChars: number;
		usedTools: boolean;
		failed: boolean;
	};
	try {
		response = await input.generate({
			systemPrompt: CHECKPOINT_SYSTEM_PROMPT,
			request,
			signal: handle.signal,
		});
	} catch {
		const failureReason = handle.timedOut()
			? "timeout"
			: input.taskSignal.aborted
				? "cancelled"
				: "provider_failure";
		return { records: [], failureReason, accepted: false };
	} finally {
		handle.dispose();
	}
	if (handle.timedOut()) {
		return { records: [], failureReason: "timeout", accepted: false };
	}
	if (input.taskSignal.aborted) {
		return { records: [], failureReason: "cancelled", accepted: false };
	}
	// A model request that attempts a tool call is NOT an accepted
	// checkpoint: the checkpoint request has no execution tools at all.
	if (response.usedTools) {
		return {
			records: [],
			failureReason: "tool_call_attempted",
			accepted: false,
		};
	}
	if (response.failed) {
		return { records: [], failureReason: "provider_failure", accepted: false };
	}
	if (response.text.length > MAX_PCK_RESPONSE_CHARS) {
		return { records: [], failureReason: "oversized_output", accepted: false };
	}
	const publicText = response.text.trim();
	if (publicText.length === 0) {
		// A thinking-only response carries no public checkpoint content, so
		// it is rejected rather than mined for reasoning.
		return {
			records: [],
			failureReason: "no_public_response",
			accepted: false,
		};
	}
	const parsed = extractCheckpointJson(publicText);
	if (parsed === undefined) {
		return { records: [], failureReason: "invalid_json", accepted: false };
	}
	const proposals = extractCheckpointProposals(parsed);
	// The source prefix is RE-VERIFIED here: a checkpoint generated from a
	// prefix that has since changed is stale.
	if (input.currentSourcePrefixKey() !== input.identity.sourcePrefixKey) {
		return {
			records: [],
			failureReason: "stale_source_prefix",
			accepted: false,
		};
	}
	const gate = gateClosedProposals({
		proposals,
		sourcePrefixKey: input.identity.sourcePrefixKey,
		evidence: {
			canonicalReferences: observedReferences,
			maximumAssuranceFor: (references, atom) =>
				interpretCanonicalEvidence({
					canonicalMessages: input.canonicalMessages,
					references,
					atom,
				}),
		},
	});
	if (gate.records.length === 0) {
		return {
			records: [],
			failureReason: "gate_rejected",
			gateCodes: gate.codes,
			accepted: false,
		};
	}
	return { records: gate.records, accepted: true };
}
