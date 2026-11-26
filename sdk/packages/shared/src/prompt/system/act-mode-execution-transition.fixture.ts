/**
 * ACT-CLINEMM-ACT-MODE-EXECUTION-TRANSITION-01
 *
 * FROZEN FAILURE WITNESS for session `1795603246098_cdmel`.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL frozen witness module.
 * ============================================================================
 *
 * The session transcript itself is OPERATOR-LOCAL and PRIVATE and is NEVER
 * committed. This module records only the AGGREGATE, NON-CONTENT metrics that
 * the ACT contract cites as evidence, so the regression this ACT corrects
 * stays mechanically checkable in the repository.
 *
 * The witness is FROZEN: the numbers below are a historical record of a
 * session that already happened. Nothing here is recomputed, and nothing
 * here is a runtime input. The witness exists so that a future change which
 * reintroduces reconnaissance-without-execution can be compared against the
 * exact shape of the failure it must not recreate.
 */

/** The frozen session id this witness records. */
export const FROZEN_FAILURE_SESSION_ID = "1795603246098_cdmel";

/**
 * The frozen aggregate metrics of the failure session.
 *
 * `editorCalls` and `executedRegressionTests` are the two load-bearing
 * zeros: the session produced 50 tool calls and never once edited a file or
 * ran a regression test.
 */
export const FROZEN_FAILURE_METRICS = {
	sessionId: FROZEN_FAILURE_SESSION_ID,
	/** Model responses observed in the session. */
	modelResponses: 48,
	/** Tool calls observed in the session. */
	toolCalls: 50,
	/** Editor (file-edit) tool calls. ZERO — the failure. */
	editorCalls: 0,
	/** Executed regression tests. ZERO — the failure. */
	executedRegressionTests: 0,
	/** Wall-clock elapsed time. */
	elapsedMs: 20 * 60 * 1000 + 32 * 1000,
	/** Cumulative reported input tokens across the session. */
	cumulativeReportedInputTokens: 4_005_470,
	/** Recorded reasoning characters across the session. */
	recordedReasoningCharacters: 266_845,
	/** Captured SDK requests that carried the editor tool. */
	capturedSdkRequests: 32,
	/** Captured SDK requests that carried the editor tool. */
	capturedSdkRequestsWithEditor: 32,
	/** The per-response generation allowance confirmed before compaction. */
	outputLimit: 8192,
} as const;

/**
 * The frozen qualitative witness.
 *
 * `repeatedReconnaissanceAfterCompaction` records that the session kept
 * re-reading the same source ranges after an overflow-recovery compaction —
 * the exact behaviour the execution-transition contract forbids.
 */
export const FROZEN_FAILURE_QUALITATIVE = {
	/** The session repeated reconnaissance after overflow-recovery compaction. */
	repeatedReconnaissanceAfterCompaction: true,
	/** The editor tool was PRESENT in every captured SDK request. */
	editorAvailableThroughout: true,
	/** The session never reached a source or regression-test edit. */
	reachedFirstMeaningfulEdit: false,
} as const;

/**
 * The frozen failure shape.
 *
 * This is the discriminator: a session that reaches the FIRST meaningful
 * edit within the frozen inspection budget is NOT this failure. The
 * execution-transition contract in `act.ts` is the prompt-level correction
 * for exactly this shape.
 */
export function isFrozenFailureShape(metrics: {
	editorCalls: number;
	executedRegressionTests: number;
	modelResponses: number;
}): boolean {
	return (
		metrics.editorCalls === 0 &&
		metrics.executedRegressionTests === 0 &&
		metrics.modelResponses >= FROZEN_FAILURE_METRICS.modelResponses
	);
}
