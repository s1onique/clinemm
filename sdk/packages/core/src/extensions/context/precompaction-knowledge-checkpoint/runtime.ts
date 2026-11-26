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

import type {
	Message,
	MessageWithMetadata,
	ToolDefinition,
} from "@cline/shared";
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
import { recordPckPrefixCapture } from "./pck-capture";
import type { PrefixPreservingAuxiliaryRequest } from "./prefix-preserving-request";
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
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01.
	 *
	 * The EXPLICIT message array for the request.
	 *
	 * When it is ABSENT the transport sends the single user message carrying
	 * `request`, which is the LEGACY route's shape and stays byte-identical.
	 *
	 * When it is PRESENT the transport sends EXACTLY these messages. The
	 * `request` string is then IGNORED, so the request body is the parent's
	 * messages plus the appended extraction suffix.
	 */
	readonly messages?: readonly Message[];
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01.
	 *
	 * The VISIBLE tool schema for the request.
	 *
	 * It is advertised so the rendered request matches the parent's, but the
	 * transport NEVER invokes an executor: a tool call in the response
	 * stream is reported as `usedTools` and the attempt is REJECTED.
	 */
	readonly tools?: readonly ToolDefinition[];
}) => Promise<{
	readonly text: string;
	readonly reasoningChars: number;
	readonly usedTools: boolean;
	readonly failed: boolean;
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
	 *
	 * The PHYSICAL provider request identity, when the transport reported
	 * one. It is the JOIN key with the provider's own capture.
	 */
	readonly providerRequestId?: string;
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
	 *
	 * The provider-reported usage, when the transport observed it.
	 */
	readonly usage?: {
		readonly inputTokens?: number;
		readonly cacheReadTokens?: number;
	};
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
 *
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
 *
 * The function is a thin WRAPPER around the attempt itself, so the capture
 * observes EVERY outcome — the accepted one and every failure — through a
 * single call site. The capture is DEFAULT-OFF and has NO semantic effect.
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
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
	 *
	 * The ROUTE the attempt took, for the capture.
	 */
	readonly route?: "b_prime" | "legacy";
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C8.
	 *
	 * The identities the host holds for the capture.
	 */
	readonly captureContext?: {
		readonly sessionId?: string;
		readonly parentRequestId?: string;
		readonly providerId?: string;
		readonly modelId?: string;
		readonly inferencePolicyId?: string;
	};
	/**
	 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — C2.
	 *
	 * The PREFIX-PRESERVING route's request, when it was selected.
	 *
	 * When it is ABSENT the LEGACY independent request is dispatched, byte
	 * for byte as before. When it is PRESENT the transport receives the
	 * parent's provider-visible messages plus the appended extraction
	 * suffix, and the `request` string is not sent.
	 */
	readonly prefixPreservingRequest?: PrefixPreservingAuxiliaryRequest;
}): Promise<PckAttemptOutcome> {
	const startedAt = Date.now();
	const observed: {
		providerRequestId?: string;
		inputTokens?: number;
		cacheReadTokens?: number;
	} = {};
	const outcome = await executePckAttempt(input, observed);
	recordPckPrefixCapture({
		cohortId: input.identity.decisionId,
		capturedAt: new Date(startedAt).toISOString(),
		sessionId: input.captureContext?.sessionId,
		decisionId: input.identity.decisionId,
		sourcePrefixKey: input.identity.sourcePrefixKey,
		parentRequestId: input.captureContext?.parentRequestId,
		providerRequestId: observed.providerRequestId ?? outcome.providerRequestId,
		route: input.route ?? "legacy",
		providerId: input.captureContext?.providerId,
		modelId: input.captureContext?.modelId,
		purpose: "pck",
		inferencePolicyId: input.captureContext?.inferencePolicyId,
		inputTokens: observed.inputTokens,
		cacheReadTokens: observed.cacheReadTokens,
		durationMs: Date.now() - startedAt,
		extractionOutcome: outcome.accepted
			? "accepted"
			: outcome.failureReason === undefined
				? "failed"
				: "rejected",
		failureReason: outcome.failureReason,
		publishedRecordCount: outcome.records.length,
	});
	return outcome;
}

/**
 * The attempt itself. It is separated from the wrapper so the capture
 * observes EVERY outcome through ONE call site.
 */
async function executePckAttempt(
	input: {
		readonly generate: PckGenerate;
		readonly canonicalMessages: readonly MessageWithMetadata[];
		readonly identity: PckAttemptIdentity;
		readonly taskSignal: AbortSignal;
		readonly deadlineMs: number;
		readonly currentSourcePrefixKey: () => string;
		readonly prefixPreservingRequest?: PrefixPreservingAuxiliaryRequest;
	},
	observed: {
		providerRequestId?: string;
		inputTokens?: number;
		cacheReadTokens?: number;
	},
): Promise<
	PckAttemptOutcome & {
		readonly providerRequestId?: string;
	}
> {
	const observedReferences = collectObservedCanonicalReferences(
		input.canonicalMessages,
	);
	const inputView = buildCheckpointInputView(input.canonicalMessages);
	const request = buildCheckpointRequest(inputView, observedReferences);
	const handle = createPckAbortHandle({
		taskSignal: input.taskSignal,
		deadlineMs: input.deadlineMs,
	});
	let response:
		| {
				text: string;
				reasoningChars: number;
				usedTools: boolean;
				failed: boolean;
				providerRequestId?: string;
				usage?: { inputTokens?: number; cacheReadTokens?: number };
		  }
		| undefined;
	try {
		response = await input.generate({
			systemPrompt: input.prefixPreservingRequest
				? input.prefixPreservingRequest.systemPrompt
				: CHECKPOINT_SYSTEM_PROMPT,
			request,
			...(input.prefixPreservingRequest
				? {
						messages: input.prefixPreservingRequest
							.messages as readonly Message[],
						tools: input.prefixPreservingRequest
							.tools as readonly ToolDefinition[],
					}
				: {}),
			signal: handle.signal,
		});
		observed.providerRequestId = response.providerRequestId;
		observed.inputTokens = response.usage?.inputTokens;
		observed.cacheReadTokens = response.usage?.cacheReadTokens;
	} catch {
		const failureReason = handle.timedOut()
			? "timeout"
			: input.taskSignal.aborted
				? "cancelled"
				: "provider_failure";
		return {
			records: [],
			failureReason,
			accepted: false,
			providerRequestId: response?.providerRequestId,
		};
	} finally {
		handle.dispose();
	}
	if (handle.timedOut()) {
		return {
			records: [],
			failureReason: "timeout",
			accepted: false,
			providerRequestId: response?.providerRequestId,
		};
	}
	if (input.taskSignal.aborted) {
		return {
			records: [],
			failureReason: "cancelled",
			accepted: false,
			providerRequestId: response?.providerRequestId,
		};
	}
	// A model request that attempts a tool call is NOT an accepted
	// checkpoint: the checkpoint request has no execution tools at all.
	if (response.usedTools) {
		return {
			records: [],
			failureReason: "tool_call_attempted",
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	if (response.failed) {
		return {
			records: [],
			failureReason: "provider_failure",
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	if (response.text.length > MAX_PCK_RESPONSE_CHARS) {
		return {
			records: [],
			failureReason: "oversized_output",
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	const publicText = response.text.trim();
	if (publicText.length === 0) {
		// A thinking-only response carries no public checkpoint content, so
		// it is rejected rather than mined for reasoning.
		return {
			records: [],
			failureReason: "no_public_response",
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	const parsed = extractCheckpointJson(publicText);
	if (parsed === undefined) {
		return {
			records: [],
			failureReason: "invalid_json",
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	const proposals = extractCheckpointProposals(parsed);
	// The source prefix is RE-VERIFIED here: a checkpoint generated from a
	// prefix that has since changed is stale.
	if (input.currentSourcePrefixKey() !== input.identity.sourcePrefixKey) {
		return {
			records: [],
			failureReason: "stale_source_prefix",
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	const gate = gateClosedProposals({
		proposals,
		sourcePrefixKey: input.identity.sourcePrefixKey,
		evidence: {
			canonicalReferences: observedReferences,
			// ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02:
			// the SELECTED ARGUMENT is passed to the interpreter, because
			// the rendered proposition is the atom's label joined with the
			// argument's label. Without it the interpreter could not compare
			// the rendered argument with the observed operation.
			maximumAssuranceFor: (references, atom, argument) =>
				interpretCanonicalEvidence({
					canonicalMessages: input.canonicalMessages,
					references,
					atom,
					argument,
				}),
		},
	});
	if (gate.records.length === 0) {
		return {
			records: [],
			failureReason: "gate_rejected",
			gateCodes: gate.codes,
			accepted: false,
			providerRequestId: response.providerRequestId,
		};
	}
	return {
		records: gate.records,
		accepted: true,
		providerRequestId: response.providerRequestId,
	};
}
