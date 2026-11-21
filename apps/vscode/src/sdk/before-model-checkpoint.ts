/**
 * ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01
 *
 * The operator-configurable, request-local `beforeModel` completion
 * checkpoint.
 *
 * The mechanism is intentionally narrow:
 *   - it COMPOSES with the existing `beforeModel` hook bag (it does not
 *     replace it, and it does not introduce a new hook framework),
 *   - it counts COMPLETED tool-using assistant turns using the runtime's
 *     `turn-finished` event (`toolCallCount > 0`) — not tool calls, not
 *     provider attempts and not UI updates,
 *   - it appends ONE synthetic user-role text message to the
 *     provider-bound `request.messages` through the typed `beforeModel`
 *     return contract,
 *   - it never mutates the persistent conversation history, never inserts
 *     inside a tool-call/tool-result pair, never forces completion and
 *     never blocks further tool calls,
 *   - it leaves the runtime's final request-budget guard authoritative.
 *
 * DEFAULT IS OFF: when the effective configuration is `undefined`, the
 * hook contributes NO modification to the provider request.
 */

import type { AgentBeforeModelContext, AgentBeforeModelResult, AgentMessage } from "@cline/shared"
import type { EffectiveBeforeModelCheckpoint } from "@shared/storage/beforeModelCheckpoint"

/**
 * The stable id prefix of an injected checkpoint message.
 *
 * The id is deterministic per (session, milestone) so that the
 * "already present in this request" check is exact — a re-prepared
 * request that already carries the checkpoint is never given a second
 * copy, while a re-prepared request that does NOT carry it (the
 * overflow-recovery path rebuilds the request from the persistent
 * history) still receives it.
 */
const CHECKPOINT_MESSAGE_ID_PREFIX = "before-model-checkpoint"

/**
 * Per-session state owned by the hook INSTANCE.
 *
 * The hook bag is built once per SDK session (`buildAgentHooks` is
 * called from `SdkSessionConfigBuilder.build`), so this state is
 * naturally per-session: a fresh session starts from zero. There is NO
 * module-global counter.
 */
export interface BeforeModelCheckpointState {
	/**
	 * The number of COMPLETED tool-using assistant turns observed so far.
	 * Incremented once per `turn-finished` event whose `toolCallCount` is
	 * greater than zero.
	 */
	completedToolUsingTurns: number
	/**
	 * The highest checkpoint milestone whose checkpoint has been delivered.
	 *
	 * A milestone is the largest multiple of the interval that is less
	 * than or equal to the completed tool-using turn count (4, 8, 12, ...
	 * for interval 4). Zero means "no milestone reached yet".
	 */
	deliveredMilestone: number
	/**
	 * The iteration in which the current milestone's checkpoint was
	 * delivered.
	 *
	 * The runtime may RE-PREPARE a request inside the SAME iteration
	 * (the provider-error retry and the overflow recovery both rebuild
	 * the request). In that case the checkpoint must be present in the
	 * rebuilt request — so the milestone alone is not enough to decide.
	 * A LATER iteration at the same milestone means the checkpoint was
	 * already delivered in an earlier request and must NOT be delivered
	 * again.
	 */
	deliveredIteration: number
}

/**
 * Create the per-session checkpoint state.
 */
export function createBeforeModelCheckpointState(): BeforeModelCheckpointState {
	return {
		completedToolUsingTurns: 0,
		deliveredMilestone: 0,
		deliveredIteration: 0,
	}
}

/**
 * The `turn-finished` event shape consumed by the checkpoint counter.
 *
 * Narrow structural typing keeps this module free of a dependency on
 * the full runtime event union while still consuming the runtime's
 * authoritative event.
 */
interface TurnFinishedLike {
	type: string
	toolCallCount?: number
}

/**
 * Observe a runtime event and advance the completed-tool-using-turn
 * counter.
 *
 * ONLY the runtime's `turn-finished` event with `toolCallCount > 0`
 * advances the counter. The runtime emits that event AFTER the
 * assistant turn's tool results have been delivered, so the count
 * reflects COMPLETED tool-using assistant turns — a turn that issued
 * three tool calls counts as ONE turn, and a turn with zero tool calls
 * does not advance the counter at all.
 */
export function observeBeforeModelCheckpointEvent(state: BeforeModelCheckpointState, event: unknown): void {
	if (!event || typeof event !== "object") {
		return
	}
	const candidate = event as TurnFinishedLike
	if (candidate.type !== "turn-finished") {
		return
	}
	const toolCallCount = candidate.toolCallCount
	if (typeof toolCallCount !== "number" || !Number.isFinite(toolCallCount) || toolCallCount <= 0) {
		return
	}
	state.completedToolUsingTurns += 1
}

/**
 * The checkpoint milestone for the current completed-turn count.
 *
 * `0` means "no milestone reached yet".
 */
export function beforeModelCheckpointMilestone(state: BeforeModelCheckpointState, interval: number): number {
	if (state.completedToolUsingTurns <= 0) {
		return 0
	}
	const remainder = state.completedToolUsingTurns % interval
	return remainder === 0 ? state.completedToolUsingTurns : state.completedToolUsingTurns - remainder
}

/**
 * Build the synthetic user-role message that carries the checkpoint.
 *
 * The message id is deterministic so the presence check below is exact.
 */
function buildCheckpointMessage(config: EffectiveBeforeModelCheckpoint, milestone: number, sessionKey: string): AgentMessage {
	return {
		id: `${CHECKPOINT_MESSAGE_ID_PREFIX}-${sessionKey}-${milestone}`,
		role: "user" as const,
		content: [
			{
				type: "text" as const,
				text: config.text,
			},
		],
		createdAt: Date.now(),
	}
}

/**
 * True when the request ALREADY carries the checkpoint message for the
 * given milestone.
 *
 * This is the guard that keeps a single prepared request free of
 * duplicate copies while still allowing a re-prepared request (which is
 * rebuilt from the persistent history and therefore does NOT carry the
 * checkpoint) to receive it.
 */
function requestAlreadyCarriesCheckpoint(messages: readonly AgentMessage[], milestone: number, sessionKey: string): boolean {
	const expectedId = `${CHECKPOINT_MESSAGE_ID_PREFIX}-${sessionKey}-${milestone}`
	return messages.some((message) => message?.id === expectedId)
}

/**
 * Compute the checkpoint contribution for one `beforeModel` invocation.
 *
 * Returns `undefined` when the feature is not effective, when no
 * milestone has been reached, when the milestone was already delivered
 * in an EARLIER iteration, or when the request already carries the
 * checkpoint.
 *
 * The returned message list preserves the original messages and their
 * ordering: the checkpoint is APPENDED after them. The persistent
 * conversation history is never mutated — the runtime replaces the
 * request's message list with the returned projection.
 */
export function buildBeforeModelCheckpointResult(
	state: BeforeModelCheckpointState,
	config: EffectiveBeforeModelCheckpoint | undefined,
	ctx: AgentBeforeModelContext,
	sessionKey: string,
): AgentBeforeModelResult | undefined {
	if (!config) {
		return undefined
	}
	const milestone = beforeModelCheckpointMilestone(state, config.interval)
	if (milestone <= 0) {
		return undefined
	}
	// A NEW milestone (milestone > deliveredMilestone) is always eligible.
	// The SAME milestone is eligible only within the iteration that
	// delivered it — that is the runtime's re-preparation path (provider
	// error retry / overflow recovery), which MUST NOT discard an
	// eligible checkpoint. A later iteration at the same milestone means
	// the checkpoint was already delivered and must not repeat.
	const isNewMilestone = milestone > state.deliveredMilestone
	const isSameIterationRepreparation =
		milestone === state.deliveredMilestone && ctx.snapshot.iteration === state.deliveredIteration
	if (!isNewMilestone && !isSameIterationRepreparation) {
		return undefined
	}
	const baseMessages = ctx.request.messages
	if (requestAlreadyCarriesCheckpoint(baseMessages, milestone, sessionKey)) {
		// The request already carries this checkpoint: never duplicate it.
		return undefined
	}
	state.deliveredMilestone = milestone
	state.deliveredIteration = ctx.snapshot.iteration
	return {
		messages: [...baseMessages, buildCheckpointMessage(config, milestone, sessionKey)],
	}
}
