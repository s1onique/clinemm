/**
 * Per-session consecutive-mistake tracker.
 *
 * @see PLAN.md §3.1 — wrapped around `recordMistake` moved from
 *                    `packages/agents/src/api/error-handling.ts` lines 147–311.
 * @see PLAN.md §3.2.3 — public surface of `MistakeTracker`.
 *
 * The pure procedural `recordMistake(input, deps)` becomes `record(input)`
 * on the class; `consecutiveMistakes` is internal state. Other deps flow
 * through the constructor instead.
 *
 * NOTE: the §3.2.3 constructor shape omits some fields (agentId,
 * conversationId/runId getters, appendRecoveryNotice). They are retained
 * here for log + notice parity per PLAN.md §3.4.3/§3.4.5. Step 8
 * (`impl-runtime-porter`) may refactor once SessionRuntime is wired up.
 *
 * =============================================================================
 * ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01 — Advisory boundary
 * =============================================================================
 *
 * Historical contract: when the per-session consecutive-mistake counter
 * reached `maxConsecutiveMistakes`, this tracker returned `{ action: "stop" }`
 * (or invoked an `onLimitReached` callback that could return stop). The
 * orchestrator then called `activeRuntime.abort(...)` which terminated the
 * run. This made "mistake limit" a hard gate that:
 *   - aborted the runtime,
 *   - destroyed resumability of the session,
 *   - was wired through UI buttons that forced the user into "Start New Task".
 *
 * New contract (ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01):
 *   - The tracker still emits a recoverable advisory notice at the limit.
 *   - The default (no callback, no consumer guidance) is `action: "continue"`
 *     with empty guidance. Mistake recovery is a protocol-progress concern,
 *     not a model-quality verdict.
 *   - `action: "stop"` is reserved for consumers that explicitly opt in
 *     (e.g. CLI runtimes that want to halt after a real protocol failure).
 *     Returning stop must be a deliberate choice, never the default.
 *   - The advisory notice text no longer implies that one vendor/model is
 *     required; it describes a protocol symptom.
 */

import type {
	AgentEvent,
	BasicLogMetadata,
	ConsecutiveMistakeLimitContext,
	ConsecutiveMistakeLimitDecision,
} from "@cline/shared";

/**
 * Legacy-agents-style leveled log function. The sdk-re `BasicLogger`
 * does not carry a level argument (§shared/logging/logger.ts); callers
 * are expected to bridge via `metadata.severity` or dispatch to
 * `debug`/`log`/`error`. `MistakeTracker` accepts a leveled callable
 * here so Step 8 can plug in whichever bridging shape `SessionRuntime`
 * ends up using.
 */
export type LeveledLog = (
	level: "debug" | "info" | "warn" | "error",
	message: string,
	metadata?: BasicLogMetadata,
) => void;

export type MistakeReason = "api_error" | "invalid_tool_call" | "tool_execution_failed";

export interface RecordMistakeInput {
	iteration: number;
	reason: MistakeReason;
	details?: string;
	/** When true, jump straight to maxConsecutiveMistakes instead of incrementing by 1. */
	forceAtLimit?: boolean;
}

/**
 * Result returned to `SessionRuntime`/`MistakeTracker` consumers.
 *
 * The `kind` discriminator distinguishes an advisory ("continue" + advisory
 * notice) from a deliberate consumer-chosen terminal stop. ACT-CLINEMM
 * requires the advisory path to be the default — `kind: "advisory"` is the
 * default for `action: "continue"` returned by the MistakeTracker itself.
 * Consumers can still emit `{ action: "stop", kind: "terminal" }` when they
 * genuinely need a terminal stop, but that must be an explicit decision.
 */
export type MistakeOutcome =
	| {
			action: "continue";
			guidance?: string;
			/** Discriminator: defaults to "advisory" when the tracker reaches its
			 *  limit and falls through to the default recovery path. Consumers may
			 *  explicitly tag a continue as "user-resolved" via the callback. */
			kind?: "advisory" | "user-resolved";
	  }
	| {
			action: "stop";
			message: string;
			reason?: string;
			kind?: "terminal";
	  };

export interface MistakeTrackerOptions {
	readonly maxConsecutiveMistakes: number;
	readonly onLimitReached?: (
		ctx: ConsecutiveMistakeLimitContext,
	) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;
	/**
	 * Observability hook fired exactly once per limit hit, right before the
	 * limit decision is resolved — regardless of whether `onLimitReached` is
	 * configured or what it decides. Used for telemetry.
	 */
	readonly onLimitTelemetry?: (ctx: ConsecutiveMistakeLimitContext) => void;
	readonly emit: (event: AgentEvent) => void;
	readonly log: LeveledLog;
	readonly agentId: string;
	readonly getConversationId: () => string;
	readonly getActiveRunId: () => string;
	readonly appendRecoveryNotice: (message: string, reason: MistakeReason) => void;
}

export class MistakeTracker {
	private consecutiveMistakes = 0;
	private readonly options: MistakeTrackerOptions;

	constructor(options: MistakeTrackerOptions) {
		this.options = options;
	}

	async record(input: RecordMistakeInput): Promise<MistakeOutcome> {
		const max = this.options.maxConsecutiveMistakes;
		const next = input.forceAtLimit && max ? max : this.consecutiveMistakes + 1;
		this.consecutiveMistakes = next;

		const errorMessage = input.details?.trim() || `consecutive mistake (${input.reason})`;
		this.options.emit({
			type: "error",
			error: new Error(errorMessage),
			recoverable: true,
			iteration: input.iteration,
		});
		this.options.log("warn", "Recorded consecutive mistake", {
			agentId: this.options.agentId,
			conversationId: this.options.getConversationId(),
			runId: this.options.getActiveRunId(),
			iteration: input.iteration,
			reason: input.reason,
			details: input.details,
			consecutiveMistakes: next,
			maxConsecutiveMistakes: this.options.maxConsecutiveMistakes,
		});

		if (!max || next < max) {
			return { action: "continue" };
		}

		const limitContext: ConsecutiveMistakeLimitContext = {
			iteration: input.iteration,
			consecutiveMistakes: next,
			maxConsecutiveMistakes: max,
			reason: input.reason,
			details: input.details,
		};
		this.options.onLimitTelemetry?.(limitContext);
		const decision = await resolveConsecutiveMistakeDecision(limitContext, this.options.onLimitReached);

		if (decision.action === "continue") {
			const guidance = decision.guidance?.trim();
			if (guidance) {
				this.options.appendRecoveryNotice(guidance, input.reason);
			}
			this.consecutiveMistakes = 0;
			// Tag the outcome as an advisory when the limit was reached so the
			// caller can distinguish "user pushed past the limit" from
			// "ordinary continue after a sub-limit mistake".
			return {
				action: "continue",
				guidance,
				kind: guidance ? "user-resolved" : "advisory",
			};
		}

		// `action: "stop"` is an explicit consumer choice (legacy CLI runtimes,
		// or future code paths that need a real terminal). The orchestrator
		// honors it by aborting the runtime. Production adapters
		// (SdkInteractionCoordinator) no longer return stop for mistake_limit
		// by default — see ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01.
		return {
			action: "stop",
			reason: decision.reason?.trim() || undefined,
			message: buildMistakeLimitStopMessage({
				iteration: input.iteration,
				consecutiveMistakes: next,
				maxConsecutiveMistakes: max,
				reason: input.reason,
				details: input.details,
				stopReason: decision.reason,
			}),
			kind: "terminal",
		};
	}

	reset(): void {
		this.consecutiveMistakes = 0;
	}

	get value(): number {
		return this.consecutiveMistakes;
	}
}

// =============================================================================
// Mistake Limit Stop Message (pure helper — ported verbatim, neutral wording)
// =============================================================================

export function buildMistakeLimitStopMessage(input: {
	iteration: number;
	consecutiveMistakes: number;
	maxConsecutiveMistakes: number;
	reason:
		| "api_error"
		| "invalid_tool_call"
		| "completion_without_submit"
		| "tool_execution_failed";
	details?: string;
	stopReason?: string;
}): string {
	const parts = [
		`Stopped after ${input.consecutiveMistakes}/${input.maxConsecutiveMistakes} consecutive protocol errors (${input.reason}) at iteration ${input.iteration}.`,
	];
	const details = input.details?.trim();
	if (details) {
		parts.push(`Error: ${details}`);
	}
	const stopReason = input.stopReason?.trim();
	if (stopReason) {
		parts.push(`Decision: ${stopReason}`);
	}
	parts.push("Session state was preserved. Send a new prompt to resume from the latest state.");
	return parts.join(" ");
}

// =============================================================================
// Consecutive Mistake Decision Resolution (pure helper — ported verbatim)
// =============================================================================
//
// ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01: the no-callback default
// changed from `action: "stop"` (which aborted the runtime) to
// `action: "continue"` (which emits an advisory notice but keeps the run
// alive and the task resumable). Consumers that want a true terminal stop
// must wire an `onLimitReached` callback that returns `{ action: "stop" }`.

async function resolveConsecutiveMistakeDecision(
	input: ConsecutiveMistakeLimitContext,
	callback?: (
		context: ConsecutiveMistakeLimitContext,
	) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision,
): Promise<ConsecutiveMistakeLimitDecision & { kind?: "advisory" | "user-resolved" }> {
	if (!callback) {
		return {
			action: "continue",
			guidance: undefined,
			kind: "advisory",
		};
	}
	try {
		const result = await callback(input);
		return result;
	} catch (error) {
		// A throwing consumer callback is a real bug, not a recoverable
		// protocol symptom — degrade to advisory so the run can keep going
		// rather than aborting the runtime on a callback failure.
		return {
			action: "continue",
			guidance: undefined,
			kind: "advisory",
		};
	}
}

// TODO(PLAN.md Step 8): The `emit` channel currently accepts legacy `AgentEvent`
// so the "recoverable error" event shape is preserved verbatim. When
// `SessionRuntime` wires this up in Step 8, consider whether this should
// emit an `AgentRuntimeEvent` (per the §3.2.3 signature proposal) and let
// the bridge translate, or keep the direct legacy channel for notice parity.
