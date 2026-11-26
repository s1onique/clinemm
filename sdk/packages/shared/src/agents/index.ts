// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01: the exact
// runtime completion-reminder contract, shared by its producer (the agent
// runtime) and its recogniser (the compaction task-contract conservation
// path) so the runtime obligation is matched by template equality rather
// than by broad string guessing.

// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the runtime-owned
// parent-obligation reference vocabulary and the selection-boundary
// observation sink.
export type {
	BoundedObjective,
	BoundedObjectiveExecutionReceipt,
	BoundedObjectiveObservationFacts,
	BoundedObjectivePolicy,
	BoundedObjectiveRejectionDiagnosis,
	BoundedObjectiveRejectionReason,
	BoundedObjectiveSelectionObservation,
	BoundedObjectiveSelectionTraceSink,
	BoundedObjectiveValidation,
	BoundedObjectiveVerificationAuthority,
} from "./bounded-objective";
// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01: the runtime
// bounded-objective contract, shared by its producer (the agent runtime's
// R2 recovery boundary), its validator, and the compaction task-contract
// conservation path so the active objective's identity survives compaction.
export {
	buildParentObligationReferences,
	type CanonicalScopePath,
	canonicalizeScopePath,
	DEFAULT_BOUNDED_OBJECTIVE_POLICY,
	describeBoundedObjectiveRejection,
	extractScopePaths,
	isBoundedObjectiveInstruction,
	isParentObligationReferenceId,
	isPathWithinCanonicalRoot,
	MAX_BOUNDED_OBJECTIVE_FIELD_LENGTH,
	MAX_BOUNDED_OBJECTIVE_REFERENCE_COUNT,
	MAX_PARENT_OBLIGATION_REFERENCE_COUNT,
	PARENT_TASK_ORIGINAL_REFERENCE_ID,
	PARENT_TASK_REFERENCE_ID_PREFIX,
	type ParentObligationReference,
	parseBoundedObjectiveInstruction,
	renderBoundedObjectiveInstruction,
	resolveBoundedObjectiveVerification,
	validateBoundedObjective,
} from "./bounded-objective";
// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01: the FROZEN FAILURE
// WITNESS for the R2 stall session. It records only aggregate, non-content
// metrics; the transcript itself stays operator-local and private.
export {
	FROZEN_R2_EXTENSION_VERSION,
	FROZEN_R2_METRICS,
	FROZEN_R2_MODEL,
	FROZEN_R2_ROUND_TOOL_NAMES,
	FROZEN_R2_SESSION_ID,
	FROZEN_R2_WORKLOAD,
} from "./bounded-objective.fixture";
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
	// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01: the
	// recovery-only generation override policy. DEFAULT_OFF.
	DEFAULT_RECOVERY_OUTPUT_OVERRIDE_POLICY,
	decideExecutionStagnation,
	foldExecutionRound,
	isExecutionStagnationNoticeMessage,
	parseExecutionStagnationNoticeMessage,
	type RecoveryOutputOverridePolicy,
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
