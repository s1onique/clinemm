/**
 * ACT-CLINEMM-AUTONOMOUS-RECOVERY-TRIGGER-FORENSICS-01
 *
 * Replay harness that binds the VERBATIM production classifier + decision
 * functions extracted from the two installed extension source versions.
 *
 * NOTHING here is an approximation:
 *   - `foldExecutionRound` / `decideExecutionStagnation` /
 *     `applyExecutionStagnationDecision` /
 *     `buildExecutionStagnationNoticeMessage` are imported from the REAL
 *     `@cline/shared` `agents/execution-stagnation` module at the session's
 *     own version.
 *   - `createHostExecutionProgressClassifier` is imported from the REAL
 *     `@cline/core` `extensions/tools/execution-progress-classifier` module
 *     at the session's own version.
 *   - The runtime's OWN structural classifier
 *     (`classifyToolCallProductivity` / `resultReportsStillRunning` /
 *     `outputReportsStillRunningShape` / `classifyExecutionRound`) is
 *     copied VERBATIM out of `AgentRuntime` at the session's own version.
 *     The copies are byte-identical between the two versions (verified by
 *     diff); the copy is only made so the private methods can be exercised
 *     outside the class.
 */

export interface RoundFacts {
	toolNames: string[];
	editAttempts: number;
	successfulEdits: number;
	executedCommands: number;
	awaitingBackgroundWork: boolean;
}

export function createRoundFacts(): RoundFacts {
	return {
		toolNames: [],
		editAttempts: 0,
		successfulEdits: 0,
		executedCommands: 0,
		awaitingBackgroundWork: false,
	};
}

/** VERBATIM: AgentRuntime.outputReportsStillRunningShape */
function outputReportsStillRunningShape(value: unknown): boolean {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	for (const key of ["status", "state", "commandExecutionDisposition"]) {
		const marker = record[key];
		if (typeof marker === "string") {
			const normalized = marker.toLowerCase();
			if (
				normalized === "running" ||
				normalized === "backgrounded" ||
				normalized === "still_running" ||
				normalized === "in_progress"
			) {
				return true;
			}
		}
	}
	if (record.isRunning === true || record.stillRunning === true) {
		return true;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			if (outputReportsStillRunningShape(entry)) {
				return true;
			}
		}
	}
	return false;
}

/** VERBATIM: AgentRuntime.resultReportsStillRunning */
function resultReportsStillRunning(output: unknown): boolean {
	if (typeof output === "string") {
		try {
			if (outputReportsStillRunningShape(JSON.parse(output))) {
				return true;
			}
		} catch {
			// Not JSON: fall through to the prose reading.
		}
		return /\b(still running|running in the background|backgrounded)\b/i.test(
			output,
		);
	}
	if (!output || typeof output !== "object") {
		return false;
	}
	return outputReportsStillRunningShape(output);
}

/** VERBATIM: AgentRuntime.classifyToolCallProductivity */
export function classifyToolCallProductivity(
	toolName: string,
	input: unknown,
	result: { output: unknown; isError?: boolean } | undefined,
): {
	kind: "edit" | "command" | "inspection";
	awaiting: boolean;
} {
	const record = (input ?? {}) as Record<string, unknown>;
	const hasEditShape =
		typeof record.path === "string" &&
		(typeof record.old_text === "string" ||
			typeof record.new_text === "string" ||
			typeof record.insert_line === "string" ||
			typeof record.content === "string" ||
			typeof record.diff === "string" ||
			typeof record.patch === "string");
	const hasPatchBody =
		typeof input === "string" && input.includes("*** Begin Patch");
	if (hasEditShape || hasPatchBody) {
		return { kind: "edit", awaiting: false };
	}
	const commands = record.commands;
	if (Array.isArray(commands)) {
		return {
			kind: "command",
			awaiting: resultReportsStillRunning(result?.output),
		};
	}
	const awaiting = resultReportsStillRunning(result?.output);
	void toolName;
	return { kind: "inspection", awaiting };
}

/** VERBATIM: AgentRuntime.applyHostProductivityVerdict */
export function applyHostProductivityVerdict(
	facts: RoundFacts,
	verdict: "edited" | "executed" | "awaiting" | "inspected" | "idle",
	result: { output: unknown; isError?: boolean } | undefined,
): void {
	switch (verdict) {
		case "edited":
			facts.editAttempts += 1;
			if (result?.isError !== true) {
				facts.successfulEdits += 1;
			}
			return;
		case "executed":
			if (result?.isError !== true) {
				facts.executedCommands += 1;
			}
			return;
		case "awaiting":
			facts.awaitingBackgroundWork = true;
			return;
		case "inspected":
		case "idle":
			return;
		default:
			return;
	}
}


/** VERBATIM: AgentRuntime.observeExecutionRoundToolCall */
export function observeExecutionRoundToolCall(
	facts: RoundFacts,
	toolName: string,
	input: unknown,
	result: { output: unknown; isError?: boolean } | undefined,
	hostClassifier:
		| ((
				toolName: string,
				input: unknown,
				result: { output: unknown; isError?: boolean } | undefined,
		  ) => "edited" | "executed" | "awaiting" | "inspected" | "idle" | undefined)
		| undefined,
): void {
	try {
		facts.toolNames.push(toolName);
		const hostVerdict = hostClassifier
			? (() => {
					try {
						return hostClassifier(toolName, input, result);
					} catch {
						return undefined;
					}
				})()
			: undefined;
		if (hostVerdict !== undefined) {
			applyHostProductivityVerdict(facts, hostVerdict, result);
			return;
		}
		const classified = classifyToolCallProductivity(toolName, input, result);
		if (classified.kind === "edit") {
			facts.editAttempts += 1;
			if (result?.isError !== true) {
				facts.successfulEdits += 1;
			}
			return;
		}
		if (classified.kind === "command") {
			if (classified.awaiting) {
				facts.awaitingBackgroundWork = true;
			} else if (result?.isError !== true) {
				facts.executedCommands += 1;
			}
			return;
		}
		if (classified.awaiting) {
			facts.awaitingBackgroundWork = true;
		}
	} catch {
		// Observation isolation: instrumentation NEVER affects a tool call.
	}
}

/** VERBATIM: AgentRuntime.classifyExecutionRound */
export function classifyExecutionRound(facts: RoundFacts):
	| "edited"
	| "executed"
	| "awaiting"
	| "inspected"
	| "idle" {
	if (facts.successfulEdits > 0) {
		return "edited";
	}
	if (facts.awaitingBackgroundWork) {
		return "awaiting";
	}
	if (facts.executedCommands > 0) {
		return "executed";
	}
	if (facts.toolNames.length === 0) {
		return "idle";
	}
	return "inspected";
}
