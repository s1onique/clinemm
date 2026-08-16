/**
 * Bounded recovery subsystem — public surface.
 *
 *   @cline/agents
 *   └─ runtime/recovery/
 *      ├─ fingerprint.ts             (browser-compatible deterministic identity)
 *      ├─ policy.ts                  (recovery policy configuration)
 *      ├─ tracker.ts                 (state machine: idle/recovering/warning/circuit_open)
 *      ├─ failure-classifier.ts      (provenance-first C1.1 classifier)
 *      ├─ runtime-outcome-adapter.ts (C1.2 boundary evidence → classifier input)
 *      └─ index.ts                   (this file — public surface)
 *
 * Contract types live in @cline/shared (no Node builtins).
 */

export type {
	AgentRuntimeRecoverySnapshot,
	ControlPlaneOutcome,
	RecoveryClassification,
	RecoveryExhaustedDetails,
	RecoverySecondStage,
	RecoverySecondStageTrigger,
	RecoverySnapshot,
	RecoveryState,
	RecoveryStateChangeEvent,
	StableFailureCode,
	ToolFailureClass,
	ToolFailureReason,
	ToolRuntimeOutcome,
} from "@cline/shared";

export { serializeFailureCode } from "@cline/shared";
export {
	classifyToolRuntimeOutcome,
	isRecoverableToolFailure,
	serializeStableFailureCode,
	type ToolOutcomeClassificationInput,
	toRecoveryClassification,
} from "./failure-classifier";
export {
	attemptDiagnosticId,
	controlFamilyToDiagnosticId,
	controlKeyToDiagnosticId,
	createAttemptIdentity,
	createFamilyIdentity,
	familyDiagnosticId,
	fingerprintToolFailure,
	fingerprintToolInput,
	isSameExactFailure,
	isSameFailureFamily,
	type ToolAttemptIdentity,
	type ToolCallFingerprint,
	type ToolFailureFingerprint,
	type ToolFamilyIdentity,
} from "./fingerprint";
export {
	computeRecoveryState,
	DEFAULT_RECOVERY_POLICY,
	RecoveryPolicy,
	type RecoveryPolicyConfig,
} from "./policy";
export {
	buildToolOutcomeClassificationInput,
	type ControlPlaneSignal,
	type RuntimeOutcomeEvidence,
	selectControlPlaneOutcome,
} from "./runtime-outcome-adapter";
export {
	isSameRuntimeRecovery,
	projectRuntimeRecovery,
	type RuntimeRecoveryProjectionInput,
} from "./runtime-recovery-projection";
// RSMT01 CORRECTION02: `buildExecutionState` and friends
// moved from `./runtime-execution-state` to
// `runtime/state/execution-state.ts`. The recovery
// barrel is intentionally recovery-only; importing
// execution-state helpers from here is a layering
// violation. Use `runtime/state` instead.
export { RecoveryTracker } from "./tracker";
