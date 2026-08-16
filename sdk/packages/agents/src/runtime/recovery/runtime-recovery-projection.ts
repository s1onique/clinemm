/**
 * C1.5 canonical runtime recovery projection — pure helpers.
 *
 * This is the new single seam that turns the runtime's PRIVATE recovery
 * authorities into the ONE externally-observable
 * `AgentRuntimeRecoverySnapshot`.
 *
 * ## Why this file exists
 *
 * `agent-runtime.ts` is already ~3.1k lines. C1.5 needs (a) a projection
 * function and (b) a semantic-equality function that decides whether an
 * externally-meaningful change occurred. Both are PURE — no side effects,
 * no `this`, no emission. Keeping them here means the runtime retains a
 * single responsibility: owning the mutation and the emission.
 *
 * ## Authority model
 *
 * The runtime holds several recovery authorities:
 *
 *   | authority                  | stage | classification            |
 *   |----------------------------|-------|---------------------------|
 *   | `RecoveryTracker`          | C1.0  | observable (projected)    |
 *   | `exactOnlyBudget`          | C1.3  | PRIVATE control detail    |
 *   | `recoverySecondStage`      | C1.4  | observable (typed enum)   |
 *   | `recoveryEpisodeFailures`  | C1.4  | observable (counter)      |
 *   | `pendingBatchOutcomes`     | C1.4  | PRIVATE transient buffer  |
 *   | `secondStageBeforeRecord`  | C1.4  | PRIVATE control detail    |
 *
 * Only the rows marked observable reach {@link projectRuntimeRecovery}.
 * `exactOnlyBudget` is deliberately excluded: its cardinality would leak
 * how many distinct canonical inputs the model tried, and no consumer
 * needs it. `pendingBatchOutcomes` is deliberately excluded: it is a
 * scheduler-transient buffer whose contents are overturned by batch
 * reconciliation.
 *
 * ## Privacy
 *
 * The tracker has already projected every identity to an opaque 8-char
 * FNV-1a diagnostic id before it leaves the state machine, so this module
 * performs NO additional redaction — it must not need to. If a raw
 * control identity could reach here, the bug is in the tracker, not here.
 */

import type {
	AgentRuntimeRecoverySnapshot,
	RecoverySecondStage,
	RecoverySecondStageTrigger,
	RecoverySnapshot,
} from "@cline/shared";

/**
 * The runtime-owned inputs required to build the canonical projection.
 * Passed explicitly (rather than reaching into `AgentRuntime`) so this
 * function stays pure and independently testable.
 */
export interface RuntimeRecoveryProjectionInput {
	/** Already-projected tracker snapshot (C1.0 privacy discipline). */
	trackerSnapshot: RecoverySnapshot;
	/** C1.4 second-stage continuation lifecycle. */
	secondStage: {
		kind: RecoverySecondStage;
		trigger?: RecoverySecondStageTrigger;
	};
	/** C1.4 episode-level recoverable-failure counter. */
	episodeFailures: number;
	/** Policy ceiling for `episodeFailures`. */
	maxEpisodeFailures: number;
	/** Circuit notices surfaced to the model this episode. */
	circuitNoticeCount: number;
}

/**
 * Build the canonical `AgentRuntimeRecoverySnapshot`.
 *
 * Deep-copies the mutable parts of the tracker snapshot so a consumer
 * holding an event payload can never observe later mutation through
 * shared array references.
 */
export function projectRuntimeRecovery(
	input: RuntimeRecoveryProjectionInput,
): AgentRuntimeRecoverySnapshot {
	const tracker: RecoverySnapshot = {
		...input.trackerSnapshot,
		blockedExactKeys: [...input.trackerSnapshot.blockedExactKeys],
		blockedFamilies: [...input.trackerSnapshot.blockedFamilies],
	};
	const projection: AgentRuntimeRecoverySnapshot = {
		state: tracker.state,
		tracker,
		secondStage: input.secondStage.kind,
		episodeFailures: input.episodeFailures,
		maxEpisodeFailures: input.maxEpisodeFailures,
		circuitNoticeCount: input.circuitNoticeCount,
	};
	// Only attach the trigger when the second stage actually carries one.
	// An `idle` second stage has no meaningful trigger, and emitting a
	// stale one would let a consumer render a cause for a non-existent
	// condition.
	if (input.secondStage.kind !== "idle" && input.secondStage.trigger) {
		projection.secondStageTrigger = input.secondStage.trigger;
	}
	return projection;
}

/**
 * Semantic equality for the canonical projection.
 *
 * This is the DEDUP RULE for `recovery-state-changed`: an event fires if
 * and only if this returns `false` for (before, after). It intentionally
 * compares the externally-meaningful dimensions only:
 *
 *   - visible state
 *   - second-stage lifecycle + trigger
 *   - episode failure counter and its ceiling
 *   - circuit notice count
 *   - repair-attempt / equivalent-repeat counters
 *   - active failure family / class / tool (diagnostic ids)
 *   - blocked family and blocked exact key sets
 *
 * `circuitReason` is derived from `state` by the tracker, so it carries
 * no independent signal and is not compared.
 */
export function isSameRuntimeRecovery(
	a: AgentRuntimeRecoverySnapshot,
	b: AgentRuntimeRecoverySnapshot,
): boolean {
	if (
		a.state !== b.state ||
		a.secondStage !== b.secondStage ||
		a.secondStageTrigger !== b.secondStageTrigger ||
		a.episodeFailures !== b.episodeFailures ||
		a.maxEpisodeFailures !== b.maxEpisodeFailures ||
		a.circuitNoticeCount !== b.circuitNoticeCount
	) {
		return false;
	}
	const ta = a.tracker;
	const tb = b.tracker;
	if (
		ta.state !== tb.state ||
		ta.currentRepairAttempts !== tb.currentRepairAttempts ||
		ta.equivalentRepeatCount !== tb.equivalentRepeatCount ||
		ta.currentFailureClass !== tb.currentFailureClass ||
		ta.currentToolName !== tb.currentToolName ||
		ta.currentFailureFamily !== tb.currentFailureFamily
	) {
		return false;
	}
	return (
		isSameIdSet(ta.blockedFamilies, tb.blockedFamilies) &&
		isSameIdSet(ta.blockedExactKeys, tb.blockedExactKeys)
	);
}

/**
 * Order-insensitive comparison of opaque diagnostic id lists. The tracker
 * builds these by Map/Set iteration, so ordering is an implementation
 * detail that must not by itself produce a public event.
 */
function isSameIdSet(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	if (a.length === 0) return true;
	const seen = new Set(a);
	for (const value of b) {
		if (!seen.has(value)) return false;
	}
	return true;
}
