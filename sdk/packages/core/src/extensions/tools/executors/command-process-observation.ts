/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01
 *
 * The bridge from ClineMM's EXISTING command-execution authorities into the
 * EXISTING centralized model-behavior flight recorder.
 *
 * WHY THIS LAYER
 * --------------
 * The recorder observes `tool_finish.outcome`, which is ONE aggregate for the
 * whole tool call. A `run_commands` invocation executes N commands
 * CONCURRENTLY and returns N POSITIONAL results, so a batch whose command 0
 * exits 0 and whose command 1 exits 3 is INDISTINGUISHABLE at the trace
 * boundary: the individual process results are LOST.
 *
 * The source ALREADY observes the necessary terminal information:
 *
 *   - the FOREGROUND executor owns the VS Code terminal's completion
 *     details (`getCompletionDetails()` → `exitCode` / `terminalClosed` /
 *     `unobservedCommand`);
 *   - the BACKGROUND executor owns the `CommandJobManager`, which knows the
 *     job id at the handoff and the authoritative terminal state (with the
 *     real exit code) when the job finalizes — INCLUDING long after the
 *     enclosing tool call has returned.
 *
 * This module is the SINGLE narrow channel that carries those already-known
 * facts to the recorder. It does NOT monitor processes, does NOT change
 * execution, and does NOT infer anything.
 *
 * HARD RULES
 * ----------
 *   1. AN EXIT CODE IS ONLY CARRIED WHEN IT WAS OBSERVED FROM THE PROCESS
 *      AUTHORITY. It is never inferred from a tool-wrapper boolean, never
 *      synthesized from a generic error, and never defaulted to 0.
 *   2. AN ABSENT EXIT CODE MEANS "unknown", NEVER 0.
 *   3. A NONTERMINAL BACKGROUND HANDOFF IS `running`, NEVER a success.
 *   4. THE OBSERVATION NEVER CARRIES a command string, an argument array,
 *      stdout, stderr, an environment value, an absolute path, or raw tool
 *      output. It carries structural scalars only.
 *   5. THE TRACE-OFF PATH IS A NO-OP: no allocation, no awaited work, no
 *      suspension point in the command execution path.
 *   6. A FAILURE IN THE OBSERVATION NEVER AFFECTS COMMAND EXECUTION.
 */

import {
	COMMAND_PROCESS_OBSERVATION_INDEX_METADATA_KEY,
	COMMAND_PROCESS_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	type ModelBehaviorTraceObservation,
	type ModelBehaviorTraceProcessExecutionMode,
	type ModelBehaviorTraceProcessTerminalState,
	type ModelBehaviorTraceSink,
} from "@cline/shared";

/**
 * The correlation identity the runtime stamped onto the tool context.
 *
 * These are the runtime's OWN identifiers — the executor never invents one.
 */
export interface CommandProcessObservationIdentity {
	readonly sessionId?: string;
	readonly runId?: string;
	readonly toolCallId?: string;
}

/**
 * The OBSERVED facts about one command's process.
 *
 * Every field is optional because each is present ONLY when the authority
 * that owns the process actually reported it.
 */
export interface CommandProcessObservationFacts {
	/** The observed terminal class. */
	readonly terminalState: ModelBehaviorTraceProcessTerminalState;
	/**
	 * The ACTUAL observed process exit code.
	 *
	 * Present ONLY when the process authority reported one. `undefined` and
	 * `null` both mean "not observed" and are dropped — neither is 0.
	 */
	readonly exitCode?: number | null;
	/** The termination signal, when reported. */
	readonly signal?: string | null;
	/** The background job id, when established. */
	readonly jobId?: string;
}

/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01-CORRECTION01.
 *
 * Whether the command-process observation channel is PRESENT for a tool
 * context.
 *
 * WHY THIS EXISTS
 * ---------------
 * The per-command positional index (`commandIndex`) has to be stamped onto
 * the per-command tool context so the executor can correlate a process
 * outcome with its position in the batch. CORRECTION01 established that
 * stamping that index UNCONDITIONALLY changed the executor's context even
 * when tracing was OFF — an unconditional production-context delta that
 * contradicts the frozen disabled-path neutrality contract.
 *
 * The fix is to stamp the metadata ONLY when the observation channel is
 * PRESENT. This predicate is the SINGLE authority for that decision, so the
 * stamp site and the report site can never disagree:
 *
 *   - the channel is ABSENT (no sink stamped by the runtime) → NOT present;
 *   - the sink does not implement `onProcessObservation` → NOT present (it
 *     can never receive an observation).
 *
 * WHY THE ENABLE BIT IS DELIBERATELY NOT CONSULTED HERE
 * ------------------------------------------------------
 * The recorder's enable bit is a RUNTIME TOGGLE, not a property of the
 * channel. The G7 contract requires that toggling tracing ON *after* a
 * background command was handed off still emits the delayed terminal fact
 * — with its per-command correlation intact. If the stamp decision
 * consulted the enable bit at launch time, a command launched while the
 * recorder was disabled would lose its `commandIndex` forever, and the
 * delayed terminal observation could never be correlated to its position in
 * the batch.
 *
 * The enable bit IS still authoritative — but it is consulted at
 * OBSERVATION time, inside `readObservationChannel`, where the observation
 * is actually emitted. That keeps the two decisions separate:
 *
 *   - THIS predicate decides whether the executor's CONTEXT changes at all
 *     (a stable, structural property of the runtime's wiring);
 *   - `readObservationChannel` decides whether an OBSERVATION is emitted
 *     (a volatile, per-event property of the recorder's enable bit).
 *
 * When the recorder is disabled and the channel is present, the executor
 * receives a context with the index stamped, and the observation channel
 * emits NOTHING. The disabled path therefore produces no recorder event
 * while still preserving the correlation identity a later toggle needs.
 *
 * This predicate is a PURE, SYNCHRONOUS, SIDE-EFFECT-FREE read. It never
 * allocates an observation, never awaits, and never introduces a suspension
 * point in the command execution path.
 */
export function isCommandProcessObservationChannelPresent(
	metadata: Record<string, unknown> | undefined,
): boolean {
	if (!metadata) {
		return false;
	}
	const sink = metadata[COMMAND_PROCESS_OBSERVATION_SINK_METADATA_KEY] as
		| ModelBehaviorTraceSink
		| undefined;
	if (!sink || typeof sink.onProcessObservation !== "function") {
		return false;
	}
	return true;
}

/**
 * Read the trace sink and the runtime-owned identity out of a tool context.
 *
 * Returns `undefined` when tracing is OFF (no sink) or when the runtime did
 * not stamp a correlation identity — the caller then performs NO work at all.
 */
function readObservationChannel(metadata: Record<string, unknown> | undefined):
	| {
			sink: ModelBehaviorTraceSink;
			identity: CommandProcessObservationIdentity;
			commandIndex: number;
	  }
	| undefined {
	if (!metadata) {
		return undefined;
	}
	const sink = metadata[COMMAND_PROCESS_OBSERVATION_SINK_METADATA_KEY] as
		| ModelBehaviorTraceSink
		| undefined;
	if (!sink || typeof sink.onProcessObservation !== "function") {
		return undefined;
	}
	// The recorder's enable bit is consulted AT OBSERVATION TIME, so a
	// toggle affects an already-running session for subsequent events.
	// A sink that does not implement the signal is treated as enabled (the
	// same discipline the agent runtime uses).
	try {
		if (sink.isTraceEnabled?.() === false) {
			return undefined;
		}
	} catch {
		// A failing enable probe must not suppress the observation; the
		// recorder's own enabled check remains authoritative.
	}
	const rawIndex = metadata[COMMAND_PROCESS_OBSERVATION_INDEX_METADATA_KEY];
	if (
		typeof rawIndex !== "number" ||
		!Number.isInteger(rawIndex) ||
		rawIndex < 0
	) {
		// Without the positional index the per-command correlation key
		// cannot be formed, so the observation is not emitted. The
		// identity is NEVER inferred.
		return undefined;
	}
	const rawIdentity = metadata[EDIT_OBSERVATION_IDENTITY_METADATA_KEY] as
		| Record<string, unknown>
		| undefined;
	const identity: CommandProcessObservationIdentity = {
		...(typeof rawIdentity?.sessionId === "string"
			? { sessionId: rawIdentity.sessionId }
			: {}),
		...(typeof rawIdentity?.runId === "string"
			? { runId: rawIdentity.runId }
			: {}),
		...(typeof rawIdentity?.toolCallId === "string"
			? { toolCallId: rawIdentity.toolCallId }
			: {}),
	};
	return { sink, identity, commandIndex: rawIndex };
}

/**
 * Report ONE command's genuine process outcome to the flight recorder.
 *
 * NEVER throws: an observation failure must never affect command execution.
 * When tracing is OFF this is a no-op with no allocation.
 *
 * @param metadata The tool context's metadata (the established observation
 *                 channel).
 * @param facts The OBSERVED facts from the process authority.
 * @param executionMode Whether the command ran in the foreground terminal or
 *                      under the supervised background job manager.
 * @param source A bounded structural label naming the authority that
 *               produced the observation.
 */
export function reportCommandProcessObservation(
	metadata: Record<string, unknown> | undefined,
	facts: CommandProcessObservationFacts,
	executionMode: ModelBehaviorTraceProcessExecutionMode,
	source: string,
): void {
	try {
		const channel = readObservationChannel(metadata);
		if (!channel) {
			return;
		}
		const { sink, identity, commandIndex } = channel;
		const handler = sink.onProcessObservation;
		if (!handler) {
			return;
		}
		// An exit code is carried ONLY when it was actually observed. An
		// absent code is NOT 0.
		const observedExitCode =
			typeof facts.exitCode === "number" && Number.isFinite(facts.exitCode)
				? facts.exitCode
				: undefined;
		const payload: Record<string, unknown> = {
			toolCallId: identity.toolCallId ?? "",
			commandIndex,
			executionMode,
			terminalState: facts.terminalState,
			...(observedExitCode !== undefined ? { exitCode: observedExitCode } : {}),
			...(typeof facts.signal === "string" && facts.signal.length > 0
				? { signal: facts.signal }
				: {}),
			...(typeof facts.jobId === "string" && facts.jobId.length > 0
				? { jobId: facts.jobId }
				: {}),
			provenance: "REAL_PRODUCTION_SEAM",
			source,
		};
		const observation: ModelBehaviorTraceObservation = {
			...(identity.sessionId !== undefined
				? { sessionId: identity.sessionId }
				: {}),
			...(identity.runId !== undefined ? { runId: identity.runId } : {}),
			payload,
		};
		handler(observation);
	} catch {
		// Failure isolation: an observation bug must never affect command
		// execution.
	}
}
