// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01: the exact
// runtime completion-reminder contract, shared by its producer (the agent
// runtime) and its recogniser (the compaction task-contract conservation
// path) so the runtime obligation is matched by template equality rather
// than by broad string guessing.
export {
	buildCompletionToolReminderMessage,
	isCompletionToolReminderMessage,
} from "./completion-reminder";
export type {
	ExecutionRoundObservation,
	ExecutionRoundProductivity,
	ExecutionStagnationAccounting,
	ExecutionStagnationDecision,
	ExecutionStagnationPolicy,
	ParsedExecutionStagnationNotice,
} from "./execution-stagnation";
// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01: the exact runtime
// execution-stagnation recovery contract, shared by its producer (the agent
// runtime's iteration boundary) and its recogniser (the compaction
// task-contract conservation path) so the runtime's recovery instruction is
// matched by template equality rather than by broad string guessing.
export {
	applyExecutionStagnationDecision,
	buildExecutionStagnationNoticeMessage,
	createExecutionStagnationAccounting,
	DEFAULT_EXECUTION_STAGNATION_POLICY,
	decideExecutionStagnation,
	foldExecutionRound,
	isExecutionStagnationNoticeMessage,
	parseExecutionStagnationNoticeMessage,
} from "./execution-stagnation";
// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01: the FROZEN FAILURE
// WITNESS for the stall session. It records only aggregate, non-content
// metrics; the transcript itself stays operator-local and private.
export {
	FROZEN_STALL_METRICS,
	FROZEN_STALL_ROUND_TOOL_NAMES,
	FROZEN_STALL_SESSION_ID,
} from "./execution-stagnation.fixture";
export * from "./recovery/types";
export * from "./types";
