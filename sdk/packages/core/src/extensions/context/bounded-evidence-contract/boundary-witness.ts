/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C2.1 — THE REPAIRED SOURCE-BOUNDARY WITNESS.
 *
 * ============================================================================
 * THE DEFECT THIS CORRECTS
 * ============================================================================
 *
 * The predecessor ACT's post-boundary negative control was DEFECTIVE. It did
 * this:
 *
 *     const syntheticPostBoundary = buildSyntheticPostBoundaryMessages();
 *     const contaminatedPrefix = [...prefix, ...syntheticPostBoundary];
 *     const contaminatedCarried = await carryForwardAndAssemble(
 *         a0Replay.compactedMessages,
 *         contaminatedPrefix,
 *     );
 *
 * and `carryForwardAndAssemble()` passed `sourceMessageCount: frozenPrefix.length`
 * — so the "frozen prefix" it was given was the ORIGINAL PREFIX PLUS the
 * synthetic messages, and the boundary MOVED to include them.
 *
 * The consequence: the outputs were identical, which demonstrated only that
 * the synthetic observation did not influence the carry-forward output. It
 * did NOT demonstrate that the observation was INACCESSIBLE, because the
 * observation was inside the boundary the whole time.
 *
 * ============================================================================
 * THE REPAIR
 * ============================================================================
 *
 * The witness is rebuilt around the ORIGINAL canonical history:
 *
 *   1. The synthetic observation is appended to the ORIGINAL canonical
 *      history — the history that was ALREADY carrying post-boundary
 *      messages.
 *   2. The prefix is RE-DERIVED from that history using the UNCHANGED
 *      historical boundary. The synthetic message is therefore OUTSIDE the
 *      boundary, by construction.
 *   3. The SAME continuation assembly path is exercised over that prefix.
 *   4. The identity of the re-derived prefix is compared with the identity of
 *      the original prefix: they MUST be equal.
 *
 * The POSITIVE CONTROL completes the argument. It advances the boundary
 * DELIBERATELY, by exactly the number of synthetic messages, and shows that
 * the synthetic observation then BECOMES VISIBLE in the carry-forward output.
 *
 * Without the positive control, "the output did not change" would be
 * consistent with a carry-forward that ignores the source entirely. WITH it,
 * the pair establishes both directions:
 *
 *   - at the original boundary, the observation is INACCESSIBLE;
 *   - at an advanced boundary, the observation IS accessible.
 *
 * That is the property the negative control was supposed to establish, and
 * it is the only way to establish it.
 */

import type { MessageWithMetadata } from "@cline/shared";
import {
	buildSyntheticPostBoundaryMessages,
	computeSourcePrefixHash,
	POST_BOUNDARY_MARKER,
	POST_BOUNDARY_TOOL_USE_ID,
} from "./source-prefix";

/**
 * Whether a carry-forward output carries the synthetic observation.
 *
 * The observation is detectable through EITHER of its two published forms:
 * the marker text (carried by the message content and by the payload's own
 * `result`) or the tool-call id (carried by the verified-outcome section).
 * Checking both makes the witness independent of WHICH route publishes the
 * observation.
 */
export function carriesSyntheticObservation(output: string): boolean {
	return (
		output.includes(POST_BOUNDARY_MARKER) ||
		output.includes(POST_BOUNDARY_TOOL_USE_ID)
	);
}

/**
 * The result of ONE boundary-witness run.
 */
export interface BoundaryWitnessResult {
	/**
	 * Whether the re-derived prefix is IDENTICAL to the original prefix.
	 *
	 * The identity is the boundary PLUS the prefix hash. Both must match.
	 */
	readonly prefixIdentityPreserved: boolean;
	/** The boundary used for the re-derivation. */
	readonly boundary: number;
	/** The hash of the re-derived prefix. */
	readonly derivedPrefixHash: string;
	/** The hash of the original prefix. */
	readonly originalPrefixHash: string;
	/** Whether the synthetic marker appears in the CLEAN carry-forward. */
	readonly markerInClean: boolean;
	/** Whether the synthetic marker appears in the CONTAMINATED carry-forward. */
	readonly markerInContaminated: boolean;
	/**
	 * Whether the two carry-forward outputs are byte-identical.
	 *
	 * ============================================================================
	 * WHY THIS IS NOT THE PRIMARY INVARIANT
	 * ============================================================================
	 *
	 * The contaminated history has MORE messages after the boundary, so the
	 * RETAINED TAIL legitimately differs: the tail is `canonical.slice(boundary)`
	 * and the contaminated history has two more messages in it. That difference
	 * is the tail doing its job, NOT a contamination of the prefix.
	 *
	 * The prefix-derived content — the SUMMARY and the carried sections, which
	 * are the ONLY things derived from the boundary — is what must be
	 * identical. That is `prefixDerivedIdentical`.
	 */
	readonly outputsIdentical: boolean;
	/**
	 * Whether the PREFIX-DERIVED content is byte-identical.
	 *
	 * This is the primary invariant: the summary and the carried sections are
	 * derived from the boundary prefix alone, so appending messages AFTER the
	 * boundary cannot change them.
	 */
	readonly prefixDerivedIdentical: boolean;
	/**
	 * The number of post-boundary messages the contaminated history
	 * carried. It MUST be greater than the clean history's, which is what
	 * makes the contamination real.
	 */
	readonly cleanPostBoundaryMessageCount: number;
	/** The number of post-boundary messages the contaminated history carried. */
	readonly contaminatedPostBoundaryMessageCount: number;
}

/**
 * The result of the POSITIVE CONTROL.
 */
export interface PositiveControlResult {
	/**
	 * Whether the synthetic marker became VISIBLE when the boundary was
	 * deliberately advanced past it.
	 */
	readonly markerVisibleAtAdvancedBoundary: boolean;
	/** The boundary used by the positive control. */
	readonly advancedBoundary: number;
	/** The number of synthetic messages the advanced boundary exposed. */
	readonly exposedSyntheticMessageCount: number;
}

/**
 * Re-derive the frozen prefix from a canonical history at a FIXED boundary.
 *
 * The boundary is passed in, NOT derived from the history's length. That is
 * the whole point: the synthetic post-boundary observation changes the
 * history's length, and the re-derived prefix must NOT change with it.
 */
export function rederivePrefixAtBoundary(input: {
	readonly canonical: readonly MessageWithMetadata[];
	readonly boundary: number;
	readonly normalize?: (message: MessageWithMetadata) => MessageWithMetadata;
}): {
	readonly messages: readonly MessageWithMetadata[];
	readonly prefixHash: string;
	readonly boundary: number;
} {
	const messages = input.canonical.slice(0, input.boundary);
	return {
		messages,
		prefixHash: computeSourcePrefixHash(
			input.canonical,
			input.boundary,
			input.normalize,
		),
		boundary: input.boundary,
	};
}

/**
 * Build the CONTAMINATED canonical history.
 *
 * The synthetic observation is appended to the ORIGINAL history, so the
 * history now carries MORE post-boundary messages than it did before. The
 * boundary itself is untouched.
 */
export function buildContaminatedHistory(input: {
	readonly canonical: readonly MessageWithMetadata[];
}): {
	readonly canonical: MessageWithMetadata[];
	readonly synthetic: readonly MessageWithMetadata[];
} {
	const synthetic = buildSyntheticPostBoundaryMessages();
	return {
		canonical: [...input.canonical, ...synthetic],
		synthetic,
	};
}

/**
 * The ASSEMBLY OUTPUT of the witness.
 *
 * The two parts are kept DISTINCT, because conflating them would hide the
 * very effect the witness measures:
 *
 *   - `prefixDerived` is the content the carry-forward DERIVED FROM THE
 *     BOUNDARY: the summary and the carried sections. It must be identical
 *     for the clean and the contaminated history.
 *   - `full` is the whole projected continuation, including the retained
 *     tail. It legitimately differs, because the contaminated history has
 *     more messages after the boundary.
 */
export interface WitnessAssemblyOutput {
	readonly prefixDerived: string;
	readonly full: string;
}

/**
 * The ASSEMBLY INPUT of the witness.
 *
 * The two roles are kept DISTINCT, because conflating them is exactly the
 * defect this witness repairs:
 *
 *   - `canonical` is the FULL canonical history. It is the source of the
 *     retained tail, and the boundary selects the prefix within it.
 *   - `boundary` is the EXACT historical boundary. The carry-forward's
 *     `sourceMessageCount` is this value, NOT the length of anything the
 *     witness constructs.
 */
export interface WitnessAssembly {
	readonly canonical: readonly MessageWithMetadata[];
	readonly boundary: number;
}

/**
 * Run the NEGATIVE control: the re-derived prefix must not carry the
 * synthetic observation, and the carry-forward over it must be identical to
 * the carry-forward over the original prefix.
 */
export async function runNegativeControl(input: {
	readonly originalCanonical: readonly MessageWithMetadata[];
	readonly contaminatedCanonical: readonly MessageWithMetadata[];
	readonly boundary: number;
	readonly originalPrefixHash: string;
	readonly normalize?: (message: MessageWithMetadata) => MessageWithMetadata;
	/**
	 * Assemble the continuation from the canonical history and the boundary.
	 *
	 * The assembler MUST use `boundary` as the carry-forward's
	 * `sourceMessageCount`. An assembler that derives the boundary from the
	 * collection's length reproduces the defect this witness exists to
	 * detect.
	 */
	readonly assemble: (input: WitnessAssembly) => Promise<WitnessAssemblyOutput>;
}): Promise<BoundaryWitnessResult> {
	const derived = rederivePrefixAtBoundary({
		canonical: input.contaminatedCanonical,
		boundary: input.boundary,
		normalize: input.normalize,
	});
	const clean = await input.assemble({
		canonical: input.originalCanonical,
		boundary: input.boundary,
	});
	const contaminated = await input.assemble({
		canonical: input.contaminatedCanonical,
		boundary: input.boundary,
	});
	return {
		prefixIdentityPreserved:
			derived.prefixHash === input.originalPrefixHash &&
			derived.boundary === input.boundary,
		boundary: derived.boundary,
		derivedPrefixHash: derived.prefixHash,
		originalPrefixHash: input.originalPrefixHash,
		markerInClean: carriesSyntheticObservation(clean.full),
		markerInContaminated: carriesSyntheticObservation(contaminated.full),
		outputsIdentical: clean.full === contaminated.full,
		prefixDerivedIdentical: clean.prefixDerived === contaminated.prefixDerived,
		cleanPostBoundaryMessageCount:
			input.originalCanonical.length - input.boundary,
		contaminatedPostBoundaryMessageCount:
			input.contaminatedCanonical.length - input.boundary,
	};
}

/**
 * Run the POSITIVE control: advance the boundary DELIBERATELY so that the
 * synthetic observation falls INSIDE it, and show that the observation then
 * becomes visible.
 *
 * A positive control that does not make the observation visible proves
 * nothing about the negative control. This one must.
 */
export async function runPositiveControl(input: {
	readonly contaminatedCanonical: readonly MessageWithMetadata[];
	readonly boundary: number;
	readonly syntheticMessageCount: number;
	readonly normalize?: (message: MessageWithMetadata) => MessageWithMetadata;
	readonly assemble: (input: WitnessAssembly) => Promise<WitnessAssemblyOutput>;
}): Promise<PositiveControlResult> {
	// ============================================================================
	// THE BOUNDARY ARITHMETIC
	// ============================================================================
	//
	// The synthetic observation is APPENDED to the canonical history, so it
	// occupies the LAST `syntheticMessageCount` positions of the contaminated
	// history. The advanced boundary must therefore be the length of the
	// CONTAMINATED history — not the original boundary plus the synthetic
	// count, which would leave the synthetic messages OUTSIDE whenever the
	// original history already carried post-boundary messages of its own.
	const advancedBoundary = input.contaminatedCanonical.length;
	const output = await input.assemble({
		canonical: input.contaminatedCanonical,
		boundary: advancedBoundary,
	});
	return {
		markerVisibleAtAdvancedBoundary: carriesSyntheticObservation(output.full),
		advancedBoundary,
		exposedSyntheticMessageCount: input.syntheticMessageCount,
	};
}
