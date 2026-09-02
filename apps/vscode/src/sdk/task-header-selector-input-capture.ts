// ===========================================================================
// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01
//
// Bounded diagnostic capture for the TaskHeader selector-input fields.
// Lives at the same state-post boundary as the existing
// activity.publication.v1 emission (SdkController.getStateToPostToWebview())
// and is gated by the EFFECTIVE capture state held in the module-level
// `captureEnabled` seam. When the effective captureEnabled is false,
// no record is appended and production path-semantics are unchanged in
// the default build.
//
// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01 (this ACT):
// the env-var gate is now CONSUMED by the central dogfood diagnostic
// profile resolver (`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`),
// which is the SOLE parser of the env var (explicit env override >
// dogfood profile default ON > public default OFF). The resolver arms
// the module seam below at extension activation via
// `applyTaskHeaderSelectorInputCaptureDiagnosticProfile`. The capture
// helper consults ONLY the module seam — the env var is NOT read
// anywhere in this module. Tests that bypass the activation path call
// the seam helpers directly. See the "REMOVAL_TRIGGER" comment block
// at the bottom of this file for the bounded-diagnostic doctrine.
//
// Why this exists (reviewer disposition 2026-09-02 HALT_LIVE_BINDING_NOT_PROVEN):
//
// The LIVE specimen (taskId 1788292664979_9qbpd, epoch 16) was observed with
// shadowPublicationBinding = "UNBOUND" (diagnostic wire classification,
// produced by activity-publication-v1.ts:148 whenever the shadow is present).
// The bounded selector guard added by the predecessor ACT fires when
// canonicalShadowObservedTurnSeq === undefined (the selector-local input
// the rule-3 gate inspects).
//
// Those two facts are NOT mechanically equivalent:
//   shadowPublicationBinding = "UNBOUND"
//       => the ArbiterSnapshot at the seam carried no generation identity
//   canonicalShadowObservedTurnSeq = undefined
//       => the phase-keyed map lastObservedTurnSeqByPhase had no entry for
//          the shadow's current projection
//
// The first is true whenever a shadow is sampled. The second is true only
// when the shadow has never observed the specific phase it is currently
// projecting (e.g. shadow never observed "idle" but is projecting it from
// a never-observed TaskModel initial state).
//
// This capture exists so the next recurrence can mechanically bind the
// ACTUAL selector-input tuple to the LIVE specimen. Each record carries
// the four input fields the bounded guard inspects PLUS the post-selection
// phase/source for downstream cross-check.
//
// Trust binding:
//   - read-only: never mutates the production state shape
//   - bounded: appends to a caller-provided ring buffer (default 64 records)
//   - privacy-safe: no prompt content, no model output, no tool args
//   - opt-in: env-var gate; default-off in production
//
// Companion diagnostic field semantics (matches the corrected selector contract):
//
//   PUBLICATION_SHADOW_BINDING = UNBOUND | MISSING
//       Diagnostic wire classification (activity-publication-v1.ts:148).
//       MISSING => no shadow at the seam; UNBOUND => shadow present, no
//       generation identity on the ArbiterSnapshot itself.
//
//   LOCAL_SHADOW_TURNSEQ = number | MISSING
//       Selector-local phase-observation stamp.
//       number => shadow has observed the current projection phase at this
//                 TurnStateTracker.seq; the REPAIR01-CORRECTION02
//                 explicit-staleness gate is the active authority gate.
//       MISSING => shadow has not observed the current projection phase;
//                  the new UNBOUND-demotion guard (if applicable) fires.
//
// ===========================================================================

import type { TurnPhase } from "@shared/ExtensionMessage"

const DEFAULT_BUFFER_SIZE = 64

export interface TaskHeaderSelectorInputRecord {
	readonly stateVersion: number
	readonly publicationShadowBinding: "MISSING" | "UNBOUND"
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly localShadowTurnSeq: number | undefined
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly selectedPhase: TurnPhase
	readonly selectedSource: "host" | "shadow" | "legacy"
	readonly capturedAt: number
}

const buffer: TaskHeaderSelectorInputRecord[] = []
let bufferSize = DEFAULT_BUFFER_SIZE

// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
// module-level capture seam. The dogfood diagnostic profile resolver
// (apps/vscode/src/sdk/dogfood-diagnostic-profile.ts) computes the
// EFFECTIVE capture state at extension activation and arms this seam.
// Production capture (`captureTaskHeaderSelectorInput`) consults ONLY
// this seam — the env var is read in exactly ONE place (the resolver).
// Default: OFF (fail-closed).
let captureEnabled = false

function pushRecord(record: TaskHeaderSelectorInputRecord): void {
	buffer.push(record)
	if (buffer.length > bufferSize) {
		buffer.shift()
	}
}

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
 * Module-level seam for the capture state. The dogfood diagnostic
 * profile resolver sets this once at extension activation; production
 * capture consults this helper (NOT the env var directly) to decide
 * whether to append. Tests that bypass the activation path can flip
 * this directly via `setTaskHeaderSelectorInputCaptureEnabled`.
 *
 * Pure read of the module-level bit; no env-var reading here.
 */
export function isTaskHeaderSelectorInputCaptureEnabled(): boolean {
	return captureEnabled
}

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
 * Flip the module-level capture seam. Idempotent: calling twice with
 * the same value is a no-op. Used exclusively by the activation helper
 * in `dogfood-diagnostic-profile.ts`; tests call this directly to
 * exercise the capture path without going through activation.
 */
export function setTaskHeaderSelectorInputCaptureEnabled(enabled: boolean): void {
	captureEnabled = Boolean(enabled)
}

// ===========================================================================
// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
// The env-var parsing function (`isTaskHeaderSelectorInputDiagnosticEnabled`)
// was REMOVED from this module in the P1-fix turn. The central dogfood
// diagnostic profile resolver
// (`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:
// resolveEffectiveTaskHeaderSelectorInputCapture`) is now the SOLE parser of
// the env var. This module exports ONLY: the module seam
// (`isTaskHeaderSelectorInputCaptureEnabled` /
// `setTaskHeaderSelectorInputCaptureEnabled`), the capture helper
// (`captureTaskHeaderSelectorInput`), the ring buffer accessors
// (`getTaskHeaderSelectorInputRecords` /
// `clearTaskHeaderSelectorInputRecords` /
// `setTaskHeaderSelectorInputBufferSize`). Production code in this
// module never reads `process.env`.
// ===========================================================================

export function captureTaskHeaderSelectorInput(args: {
	readonly stateVersion: number
	readonly publicationShadowBinding: "MISSING" | "UNBOUND"
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly localShadowTurnSeq: number | undefined
	readonly currentLegacyPhase: TurnPhase
	readonly seq: number
	readonly selectedPhase: TurnPhase
	readonly selectedSource: "host" | "shadow" | "legacy"
}): void {
	// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
	// consult ONLY the module seam set by the activation profile
	// resolver. The env var is read in exactly ONE place (the resolver);
	// the capture helper is a downstream consumer of the resolved state.
	if (!isTaskHeaderSelectorInputCaptureEnabled()) return
	pushRecord({
		stateVersion: args.stateVersion,
		publicationShadowBinding: args.publicationShadowBinding,
		canonicalShadowPhase: args.canonicalShadowPhase,
		localShadowTurnSeq: args.localShadowTurnSeq,
		currentLegacyPhase: args.currentLegacyPhase,
		seq: args.seq,
		selectedPhase: args.selectedPhase,
		selectedSource: args.selectedSource,
		capturedAt: Date.now(),
	})
}

export function getTaskHeaderSelectorInputRecords(): readonly TaskHeaderSelectorInputRecord[] {
	return buffer
}

export function clearTaskHeaderSelectorInputRecords(): void {
	buffer.length = 0
}

export function setTaskHeaderSelectorInputBufferSize(n: number): void {
	bufferSize = Math.max(0, n | 0)
	while (buffer.length > bufferSize) {
		buffer.shift()
	}
}

// ============================================================================
// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01
// REMOVAL_TRIGGER (per Factory doctrine on temporary diagnostics):
//
//   first successful LIVE binding of
//     PUBLICATION_SHADOW_BINDING + LOCAL_SHADOW_TURNSEQ
//     for a recurrence, OR
//   CAPTURE_INSUFFICIENT
//
// No quiet promotion to architecture. When the Idle recurrence is
// finally bound and this capture is no longer needed, REMOVE the
// profile knob together with the diagnostic. The capture module,
// the activation seam, the resolver helper, and this comment block
// all go together.
//
// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01 (P1-fix
// turn): the legacy `isTaskHeaderSelectorInputDiagnosticEnabled`
// function was REMOVED from this module. The central dogfood
// diagnostic profile resolver is now the SOLE parser of the env var;
// this module exports the module seam + capture helper + ring buffer
// accessors only. When the trigger fires, REMOVE THE FOLLOWING
// TOGETHER:
//   - this entire file (apps/vscode/src/sdk/task-header-selector-input-capture.ts)
//   - the resolver+activation helper+THSICAP_ENV_VAR+THSICAP comment
//     block in apps/vscode/src/sdk/dogfood-diagnostic-profile.ts
//   - the activation call in apps/vscode/src/extension.ts
//   - the seam-toggling in apps/vscode/src/sdk/__tests__/task-header-selector-input-capture.tusix01.test.ts
//   - the new canonical vitest suite at apps/vscode/src/sdk/__tests__/dogfood-diagnostic-profile-thsicap-activation.test.ts
//   - the operator dump runtime + commands
//   - the capture call in apps/vscode/src/sdk/SdkController.ts
//   - the ACT MD at .factory/acts/ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01.md
//   - the .gitignore whitelist entry
//   - the THSICAP row in .factory/epic-board.md
// ============================================================================
