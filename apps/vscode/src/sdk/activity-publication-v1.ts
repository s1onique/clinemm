/**
 * ACT-CLINEMM-CANCEL-AFFORDANCE-AUTHORITY-RECON:
 *
 * Pure builder for the `activity.publication.v1` JSONL record. Lives at
 * the extension-side seam of `SdkController.getStateToPostToWebview()`
 * and is invoked once per ExtensionState publication when the
 * diagnostic-profile `A` knob is effective (= true).
 *
 * Why a separate module: this builder is testable in isolation
 * (without instantiating a SdkController, the runtime, or the
 * extension host) and the test can exercise the EXACT shape the
 * production seam produces. The same builder is called from the
 * production seam; there is no duplicate code path.
 *
 * Composition model (load-bearing, per the bounded ACT review):
 *
 *   snapshot     = the SAME object the wire payload is built from
 *                  (carries stateVersion, epoch, turnState,
 *                  taskHeaderPresentation, thinkingPresentation,
 *                  taskTelemetry, currentTaskItem,
 *                  foregroundCommandRunning, backgroundCommandRunning).
 *
 *   shadow       = an INDEPENDENT observation produced by
 *                  `SdkController.getLocalShadowProjection()`
 *                  (ArbiterSnapshot). This interface carries
 *                  `execution`/`recoveryState`/`status`/`pendingToolCalls`
 *                  but NO generation identity (`stateVersion`/`seq`
 *                  are absent). Therefore:
 *
 *                  - The `snapshot` fields and the `shadow` fields
 *                    CANNOT be claimed to belong to the same
 *                    publication generation without further evidence.
 *
 *                  - We refuse to silently promote separately sampled
 *                    observations into one synchronized observation
 *                    (per Factory rule).
 *
 *                  - The builder records `shadowPublicationBinding`
 *                    honestly:
 *
 *                      "MISSING" -> shadow was undefined at the seam
 *                      "UNBOUND" -> shadow was present but lacks a
 *                                    generation identity, so cross-
 *                                    binding to snapshot.stateVersion
 *                                    CANNOT be proven
 *
 *                    Callers that need same-generation proof MUST NOT
 *                    rely on the shadow-derived fields (hostStatus,
 *                    modelStreaming, toolActive). They are emitted
 *                    as observed, with the binding state recorded,
 *                    so the post-capture join can decide whether to
 *                    trust them.
 *
 *   knobs        = the EFFECTIVE diagnostic-knob object (resolved
 *                  immediately before this builder is invoked, so the
 *                  A knob IS the gate the production seam enforces).
 *
 *   ptadPushId   = the same monotonic counter the PTAD ring buffer
 *                  uses. May be undefined if PTAD is disabled; the
 *                  builder does not require it.
 *
 * Returns a discriminated union. The caller dispatches on
 * `kind === "emit"` and only forwards the data to `emitV2Capture`.
 */

import type { TurnState, ThinkingPresentationProjection } from "@shared/ExtensionMessage"
import type { TaskHeaderPresentationProjection } from "./task-state-shadow-arbiter-mapper"
import type { ArbiterSnapshot } from "./task-state-shadow-recorder"

/**
 * Bounded shape of the `snapshot` object the builder consumes.
 *
 * Only the fields the builder actually reads are typed. Other fields
 * on the snapshot (currentTaskItem, etc.) are referenced by name and
 * survive the typecheck as long as they exist on the live snapshot.
 */
export interface ActivityPublicationSnapshotLike {
	readonly stateVersion: number
	readonly epoch: number | undefined
	readonly currentTaskItem?: { readonly id?: string } | undefined
	readonly turnState: TurnState | undefined
	readonly thinkingPresentation: ThinkingPresentationProjection | undefined
	readonly taskHeaderPresentation: TaskHeaderPresentationProjection | undefined
	readonly taskTelemetry?: unknown
	readonly foregroundCommandRunning?: boolean | undefined
	readonly backgroundCommandRunning?: boolean | undefined
}

/**
 * Bounded shape of the EFFECTIVE knobs the builder consumes.
 * Only the `a` field matters here.
 */
export interface ActivityPublicationKnobsLike {
	readonly a: boolean
}

/**
 * Cross-binding state for the shadow-derived fields. Honest
 * classification; never "BOUND" because `ArbiterSnapshot` carries no
 * generation identity.
 */
export type ShadowPublicationBinding = "MISSING" | "UNBOUND"

/**
 * Discriminated return shape. The caller MUST treat `kind === "skip"`
 * as a complete no-op (no emission, no state-semantic delta).
 */
export type ActivityPublicationV1BuildResult =
	| { readonly kind: "skip"; readonly reason: "A_DISABLED" }
	| { readonly kind: "skip"; readonly reason: "A_MISSING" }
	| {
			readonly kind: "emit"
			readonly shadowPublicationBinding: ShadowPublicationBinding
			readonly data: Readonly<Record<string, unknown>>
	  }

/**
 * Build the `activity.publication.v1` record payload.
 *
 * Pure function (no I/O, no side effects, no module-level state).
 * One call maps to one record.
 */
export function buildActivityPublicationV1Record(args: {
	snapshot: ActivityPublicationSnapshotLike
	shadow: ArbiterSnapshot | undefined
	knobs: ActivityPublicationKnobsLike
	ptadPushId: number | undefined
}): ActivityPublicationV1BuildResult {
	// The A knob IS the gate. If it's not effective at the seam, no
	// record. (Mechanical enforcement of the bounded ACT contract
	// §18: identity is the SOLE gate for the public path; A is the
	// runtime-effective gate for the dogfood path.)
	if (!knobs || typeof knobs.a !== "boolean") {
		return { kind: "skip", reason: "A_MISSING" }
	}
	if (knobs.a !== true) {
		return { kind: "skip", reason: "A_DISABLED" }
	}

	const snapshot = args.snapshot
	const shadow = args.shadow

	// Cross-binding state. There is no field on `ArbiterSnapshot`
	// that maps to `snapshot.stateVersion`; we record the binding
	// state as "UNBOUND" whenever a shadow is present, so callers
	// and post-capture analysis know the shadow-derived fields are
	// NOT proven same-generation.
	const shadowPublicationBinding: ShadowPublicationBinding = shadow === undefined ? "MISSING" : "UNBOUND"

	// Host authority (shadow-derived). The three fields are emitted
	// as observed; the binding state is recorded alongside.
	const runtimeStatus = shadow?.status
	const runtimeModelStreaming = shadow?.execution?.modelStreaming
	const runtimePendingToolCount = shadow?.pendingToolCalls?.length ?? 0

	// UI authority (snapshot-derived; same publication by construction).
	const turnPhase = snapshot.turnState?.phase
	const taskHeaderPhase = snapshot.taskHeaderPresentation?.phase
	const thinkingModelStreaming = snapshot.thinkingPresentation?.modelStreaming
	const thinkingSource = snapshot.thinkingPresentation?.source
	const taskHeaderSource = snapshot.taskHeaderPresentation?.source

	return {
		kind: "emit",
		shadowPublicationBinding,
		data: {
			// Publication identity (snapshot-derived, by construction
			// same-publication for the four wire fields).
			publicationId: snapshot.stateVersion,
			ptadPushId: args.ptadPushId ?? null,
			taskId: snapshot.currentTaskItem?.id ?? null,
			epoch: snapshot.epoch ?? null,
			// Cross-binding honesty stamp. "UNBOUND" forever (see the
			// module-level comment); consumers MUST NOT treat the
			// shadow-derived fields as proven same-generation without
			// independent corroboration.
			shadowPublicationBinding,
			// Host authority (shadow-derived).
			hostStatus: runtimeStatus ?? null,
			turnPhase: turnPhase ?? null,
			modelStreaming: runtimeModelStreaming ?? null,
			toolActive: runtimePendingToolCount > 0,
			foregroundCommandRunning:
				typeof snapshot.foregroundCommandRunning === "boolean"
					? snapshot.foregroundCommandRunning
					: null,
			backgroundCommandRunning:
				typeof snapshot.backgroundCommandRunning === "boolean"
					? snapshot.backgroundCommandRunning
					: null,
			// UI authority (snapshot-derived). Each projection carries
			// its own `source` provenance so the post-capture join can
			// see which authority was active ("shadow" vs "legacy"
			// vs "host"-compaction for taskHeader).
			taskHeaderPhase: taskHeaderPhase ?? null,
			taskHeaderSource: taskHeaderSource ?? null,
			thinkingModelStreaming: thinkingModelStreaming ?? null,
			thinkingSource: thinkingSource ?? null,
			// Webview-side fields (LIVE_UNOBSERVABLE from the
			// extension-side seam; the webview-side PTAD ring buffer
			// captures them under the same `stateVersion`, and the
			// post-capture join is deterministic).
			cancelVisible: "LIVE_UNOBSERVABLE",
			cancelEnabled: "LIVE_UNOBSERVABLE",
			cancelAuthority: "LIVE_UNOBSERVABLE",
			composerEnabled: "LIVE_UNOBSERVABLE",
			lastMessageType: "LIVE_UNOBSERVABLE",
			lastMessageSay: "LIVE_UNOBSERVABLE",
			lastMessageAsk: "LIVE_UNOBSERVABLE",
			lastMessagePartial: "LIVE_UNOBSERVABLE",
		},
	}
}

