// ===========================================================================
// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01
//
// Bounded diagnostic capture for the TaskHeader selector-input fields.
// Lives at the same state-post boundary as the existing
// activity.publication.v1 emission (SdkController.getStateToPostToWebview())
// and is gated by the new env var
// CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=<truthy>. When the env var is
// not truthy, no record is appended and production path-semantics are
// unchanged in the default build.
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

function pushRecord(record: TaskHeaderSelectorInputRecord): void {
	buffer.push(record)
	if (buffer.length > bufferSize) {
		buffer.shift()
	}
}

export function isTaskHeaderSelectorInputDiagnosticEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env["CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1"]
	if (raw === undefined || raw === null) return false
	const v = String(raw).trim().toLowerCase()
	return v === "1" || v === "true" || v === "yes"
}

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
	if (!isTaskHeaderSelectorInputDiagnosticEnabled()) return
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
