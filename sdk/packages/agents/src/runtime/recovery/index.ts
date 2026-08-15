/**
 * Bounded recovery subsystem — public surface.
 *
 *   @cline/agents
 *   └─ runtime/recovery/
 *      ├─ fingerprint.ts  (browser-compatible deterministic identity)
 *      ├─ policy.ts       (recovery policy configuration)
 *      ├─ tracker.ts      (state machine: idle/recovering/warning/circuit_open)
 *      └─ index.ts        (this file — public surface)
 *
 * Contract types live in @cline/shared (no Node builtins).
 */

export type {
	RecoverySnapshot,
	RecoveryState,
	RecoveryStateChangeEvent,
	ToolFailureClass,
	ControlPlaneOutcome,
	StableFailureCode,
	ToolFailureReason,
	ToolRuntimeOutcome,
	RecoveryClassification,
	RecoveryExhaustedDetails,
} from "@cline/shared";

export { serializeFailureCode } from "@cline/shared";

export {
	fingerprintToolInput,
	fingerprintToolFailure,
	isSameFailureFamily,
	isSameExactFailure,
	familyDiagnosticId,
	attemptDiagnosticId,
	createAttemptIdentity,
	createFamilyIdentity,
	controlKeyToDiagnosticId,
	controlFamilyToDiagnosticId,
	type ToolCallFingerprint,
	type ToolFailureFingerprint,
	type ToolAttemptIdentity,
	type ToolFamilyIdentity,
} from "./fingerprint";

export {
	RecoveryPolicy,
	computeRecoveryState,
	DEFAULT_RECOVERY_POLICY,
	type RecoveryPolicyConfig,
} from "./policy";

export { RecoveryTracker } from "./tracker";
