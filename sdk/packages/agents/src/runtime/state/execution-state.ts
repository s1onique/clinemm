/**
 * RSMT01 canonical runtime execution projection — pure helpers.
 *
 * This is the new single seam that turns the runtime's PRIVATE
 * activity/interaction flags into the ONE externally-observable
 * `AgentRuntimeExecutionState` projection.
 *
 * ## Why this file exists
 *
 * `agent-runtime.ts` is already ~3.1k lines. RSMT01 needs (a) a
 * projection function and (b) a semantic-equality function that decides
 * whether an externally-meaningful change occurred. Both are PURE — no
 * side effects, no `this`, no emission. Mirrors the C1.5
 * `runtime-recovery-projection.ts` architectural precedent.
 *
 * ## Authority model
 *
 * The runtime holds three execution authorities:
 *
 *   | authority                       | stage | source                             |
 *   |---------------------------------|-------|------------------------------------|
 *   | `executionModelStreaming`       | RSMT01| `state.executionModelStreaming`    |
 *   | `executionAwaitingApproval`     | RSMT01| `state.executionAwaitingApproval`  |
 *   | `state.pendingToolCalls`        | RSMT01| pre-existing                      |
 *
 * `modelStreaming` and `awaitingApproval` are first-class booleans
 * mutated in the few `try`/`finally` boundaries that bracket them
 * (the `model.stream` await and the `requestToolApproval` await).
 * `tooling` is derived from the pre-existing `pendingToolCalls`
 * array so it cannot drift from the tool-execution truth.
 *
 * ## Pure projection
 *
 * All three observable flags are produced by
 * {@link buildExecutionState}, which takes the PRIVATE state and
 * returns the IMMUTABLE `AgentRuntimeExecutionState`. The runtime
 * never composes this projection in any other place.
 *
 * ## Semantic equality
 *
 * `isSameExecutionState` is used by the C1.5 / RSMT01 dedup
 * pattern: an event whose `execution` projection is structurally
 * equal to the previous one is suppressed. Mirrors the
 * `isSameRuntimeRecovery` design.
 */
import type { AgentRuntimeExecutionState } from "@cline/shared";

/**
 * PRIVATE: the bits of `AgentRuntime.state` that
 * `buildExecutionState` reads. Keep this narrow so the projection
 * cannot reach into unrelated state.
 */
export interface ExecutionStateSources {
	readonly executionModelStreaming: boolean;
	readonly executionAwaitingApproval: boolean;
	readonly pendingToolCalls: readonly string[];
}

/**
 * Pure projection:
 *   tooling           = pendingToolCalls.length > 0
 *   modelStreaming    = executionModelStreaming
 *   awaitingApproval  = executionAwaitingApproval
 *
 * Returns a fresh object every call so the snapshot can be
 * embedded in event payloads without sharing identity with the
 * runtime's mutable state.
 *
 * INVARIANT: terminal-lifecycle callers MUST reset the source
 * flags before calling `snapshot()`. See `AgentRuntime.setIdle()` /
 * `finishRun()` / `abort()` for the canonical reset points.
 */
export function buildExecutionState(
	sources: ExecutionStateSources,
): AgentRuntimeExecutionState {
	return {
		modelStreaming: sources.executionModelStreaming,
		tooling: sources.pendingToolCalls.length > 0,
		awaitingApproval: sources.executionAwaitingApproval,
	};
}

/**
 * Semantic equality: structural equality on every field.
 * Used by the event-snapshot dedup invariant.
 */
export function isSameExecutionState(
	a: AgentRuntimeExecutionState,
	b: AgentRuntimeExecutionState,
): boolean {
	return (
		a.modelStreaming === b.modelStreaming &&
		a.tooling === b.tooling &&
		a.awaitingApproval === b.awaitingApproval
	);
}
