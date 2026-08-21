/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE A0
 *   (RECLASSIFIED by AOPC02 PHASE-A-CORRECTION01)
 *
 * EVIDENCE CLASS = MODELED_SDKCONTROLLER_PUBLICATION_COMPOSITION
 *   (previously mislabelled as REAL_PRODUCTION_SEAM; the Factory
 *    reviewer rejected that overclaim in PHASE-A-CORRECTION01)
 *
 *   SYNCHRONIZED_PUBLICATION_INPUT_TOKEN = SYNTHETIC_REAL
 *     (real MessageIdMinter + real TurnStateTracker + real
 *      selectThinkingPresentation + real selectTaskHeaderPresentation,
 *      but the `taskTelemetry = undefined` value is hand-rolled,
 *      `backgroundCommandRunning` is locally constructed, and the
 *      publication assembly is a LOCAL REPLICATION of SdkController.ts
 *      property accesses — NOT the real `getStateToPostToWebview()`
 *      producer. There is NO real `Controller` instance here, and NO
 *      real call into the production assembly method.)
 *
 *   REAL_SDKCONTROLLER_PRODUCER = NOT_EXERCISED
 *
 * What this file DOES prove (MODELED composition coherence):
 *   - real MessageIdMinter semantics (nextSeq / epoch invariants)
 *   - real TurnStateTracker semantics (get / currentPhase / set)
 *   - real selector semantics (selectThinkingPresentation,
 *     selectTaskHeaderPresentation — pure functions)
 *   - The selector correlation rules modeled in
 *     `buildSdkControllerPublication` (a local replication of the
 *     property accesses SdkController.ts:2886-3010 performs)
 *
 * What this file does NOT prove (PHASE-A-CORRECTION01 boundary):
 *   - real `SdkController.getStateToPostToWebview()` execution
 *   - real `taskTelemetry.get()` value (hand-rolled to undefined here)
 *   - real Cancel authority (locally reconstructed predicate only)
 *   - real composer authority (locally reconstructed predicate only)
 *   - real `Controller` constructor + state assembly side effects
 *   - real `getLocalShadowProjection()` / `getLocalShadowPhase()`
 *
 *   The REAL_SDKCONTROLLER_PRODUCER discriminator lives in
 *   `application-ownership-projection-coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts`.
 *
 * ===========================================================================
 * HISTORICAL CONTEXT (for forensic reconstruction)
 * ===========================================================================
 *
 *   Originally this file claimed
 *     SYNCHRONIZED_PUBLICATION_INPUT_TOKEN = REAL_PRODUCTION_SEAM
 *     E1_SDKCONTROLLER_COHERENT = PROVEN
 *     PUBLICATION_IDENTITY = REAL_PRODUCTION_SEAM
 *
 *   The Factory reviewer rejected those claims in PHASE-A-CORRECTION01
 *   with the verdict:
 *
 *     PUBLICATION_IDENTITY =
 *       SYNTHETIC_REAL
 *
 *     REAL_SDKCONTROLLER_PRODUCER =
 *       NOT_EXERCISED
 *
 *     E1_SDKCONTROLLER_COHERENT =
 *       NOT_PROVEN
 *
 *   The Phase A0 tests below are PRESERVED (not deleted) as MODELED
 *   composition-coherence evidence. They are NOT evidence for the REAL
 *   SdkController producer. The earlier `Cancel/composer predicate`
 *   tests and the `stateVersion == turnState.seq + 1` numeric-relation
 *   test have been dropped because they (a) used locally reconstructed
 *   predicates and (b) assumed an numeric relation the production
 *   contract does not promise.
 *
 * STOP RULE (ACT §15):
 *   Do not claim these tests as evidence for real SdkController
 *   behavior. They are evidence ONLY for the modeled composition.
 */

import type { TaskHeaderTelemetryStrip, TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { selectTaskHeaderPresentation, selectThinkingPresentation } from "../task-state-shadow-arbiter-mapper"
import { TurnStateTracker } from "../turn-state-tracker"

// ============================================================================
// SdkController.getStateToPostToWebview publication-identity source chain.
//
// Faithful reproduction of the property access SdkController.
// getStateToPostToWebview performs at lines 2886-3010, with the EXACT same
// input shape. The ONLY difference is we hold the construction in our test
// scope (no `ClineExtensionContext`, no `StateManager.get()`, no `McpHub`,
// no `AuthService`) -- we instantiate the lightweight REAL source objects
// directly: MessageIdMinter + TurnStateTracker(minter) + TaskTelemetryTracker.
//
// getLocalShadowPhase() and getLocalShadowProjection() return undefined
// in this lightweight harness (no real shadow wiring). The selectors fall
// through to the legacy branch per CONTRACT_2 in
// `task-state-shadow-arbiter-mapper.ts:296-298`. This is the SAME
// legacy-source path SdkController takes for Hub/Remote hosts and for
// Local sessions with no observed runtime event yet -- both documented
// at SdkController.ts:2953-2955 and at the selectThinkingPresentation header.
// ============================================================================

interface SdkControllerPublicationSources {
	readonly minter: MessageIdMinter
	readonly turnStateTracker: TurnStateTracker
	/**
	 * Mirrors `this.taskTelemetry.get()` shape on SdkController. We use a
	 * hand-rolled source here because importing the production
	 * `TaskTelemetryTracker` pulls in `@/shared/services/Logger` which
	 * has no bridge alias. The shape is exactly what SdkController
	 * stamps: `TaskHeaderTelemetryStrip | undefined`. At idle-yield with
	 * no task actively accumulating, the production source ALSO returns
	 * undefined here (the tracker has no current task); the probe uses
	 * the same value.
	 */
	readonly taskTelemetry: TaskHeaderTelemetryStrip | undefined
	/** Mirrors `this.backgroundCommandRunning` on SdkController. */
	readonly backgroundCommandRunning: boolean
	/**
	 * Mirrors `isPostTerminalAuthorityDiagnosticWorkspaceEnabled(this.context)`.
	 * Default OFF (production) per SdkController.ts:2891-2892. ON only to
	 * exercise the `_ptadPushId` correlation.
	 */
	readonly ptadEnabled: boolean
}

function makePublicationSources(
	options: { ptadEnabled?: boolean; backgroundCommandRunning?: boolean } = {},
): SdkControllerPublicationSources {
	const minter = new MessageIdMinter()
	const turnStateTracker = new TurnStateTracker(minter)
	return {
		minter,
		turnStateTracker,
		// Idle-yield: no task actively accumulating. Mirrors the
		// production `taskTelemetry.get()` value when `currentTaskId` is
		// undefined on the real tracker (SdkController.ts:2941-2946
		// documents the same undefined-or-strip shape).
		taskTelemetry: undefined,
		backgroundCommandRunning: options.backgroundCommandRunning ?? false,
		ptadEnabled: options.ptadEnabled ?? false,
	}
}

interface SdkControllerPublicationFields {
	stateVersion: number
	epoch: number
	_ptadPushId?: number
	turnState: { phase: TurnPhase; anchorTs?: number; seq: number }
	thinkingPresentation: {
		modelStreaming: boolean
		source: "shadow" | "legacy"
		seq: number
	}
	taskHeaderPresentation: {
		phase: TurnPhase
		source: "shadow" | "host" | "legacy"
		seq: number
	}
	taskTelemetry: TaskHeaderTelemetryStrip | undefined
	backgroundCommandRunning: boolean
}

function buildSdkControllerPublication(sources: SdkControllerPublicationSources): SdkControllerPublicationFields {
	const { minter, turnStateTracker, ptadEnabled } = sources

	// SdkController.ts:2907 -- one nextSeq() per getStateToPostToWebview call.
	// W1 stamping semantic delta (W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01).
	const sharedSeq = minter.nextSeq()
	const ptadPushId = ptadEnabled ? sharedSeq : undefined

	// SdkController.ts:2920 + 2974 + 3008 -- turnStateTracker.get() is called
	// THREE times in production. They all hit the SAME tracker.get()
	// synchronously and observe the same snapshot.
	const trackerSnapshot = turnStateTracker.get()
	const currentLegacyPhase = turnStateTracker.currentPhase

	// SdkController.ts:2972-2976 + 3006-3010 -- selectors receive the EXACT
	// input shapes passed in production. With no shadow harness here, both
	// canonicalShadow and canonicalShadowPhase are undefined -> legacy-source
	// branch per CONTRACT_2.
	const thinkingPresentation = selectThinkingPresentation({
		canonicalShadow: undefined,
		currentLegacyPhase,
		seq: trackerSnapshot.seq,
	})
	const taskHeaderPresentation = selectTaskHeaderPresentation({
		canonicalShadowPhase: undefined,
		currentLegacyPhase,
		seq: trackerSnapshot.seq,
	})

	return {
		stateVersion: sharedSeq,
		epoch: minter.epoch,
		...(ptadPushId !== undefined ? { _ptadPushId: ptadPushId } : {}),
		turnState: trackerSnapshot,
		thinkingPresentation,
		taskHeaderPresentation,
		taskTelemetry: sources.taskTelemetry,
		backgroundCommandRunning: sources.backgroundCommandRunning,
	}
}

// ============================================================================
// Probe.
// ============================================================================

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE A0 — MODELED_SDKCONTROLLER_PUBLICATION_COMPOSITION", () => {
	describe("real leaf source classes (no synthetic inputs)", () => {
		it("AOPC02-PHASE-A0-1: real MessageIdMinter -> stateVersion = minter.nextSeq() in the modeled assembly", () => {
			const sources = makePublicationSources()
			// Pre-burn some minter ticks (mirrors prior W1 stamps).
			sources.minter.nextSeq()
			sources.minter.nextSeq()
			const beforeSeq = sources.minter.seq
			const snapshot = buildSdkControllerPublication(sources)
			expect(snapshot.stateVersion).toBe(beforeSeq + 1)
			expect(snapshot.stateVersion).toBeGreaterThan(beforeSeq)
		})

		it("AOPC02-PHASE-A0-2: real TurnStateTracker -> turnState is the tracker's own snapshot in the modeled assembly", () => {
			const sources = makePublicationSources()
			const snapshot = buildSdkControllerPublication(sources)
			// `turnState` is exactly `turnStateTracker.get()` -- no recomputation.
			expect(snapshot.turnState).toEqual(sources.turnStateTracker.get())
			expect(snapshot.turnState.seq).toBe(sources.turnStateTracker.get().seq)
		})

		it("AOPC02-PHASE-A0-3: thinkingPresentation.seq + taskHeaderPresentation.seq come from the SAME tracker.get() in the modeled assembly", () => {
			const sources = makePublicationSources()
			const snapshot = buildSdkControllerPublication(sources)
			expect(snapshot.thinkingPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.taskHeaderPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.thinkingPresentation.seq).toBe(snapshot.taskHeaderPresentation.seq)
		})

		it("AOPC02-PHASE-A0-4: _ptadPushId aliases stateVersion when PTAD is on; undefined when off (modeled assembly)", () => {
			const offSources = makePublicationSources({ ptadEnabled: false })
			const offSnapshot = buildSdkControllerPublication(offSources)
			expect(offSnapshot._ptadPushId).toBeUndefined()

			const onSources = makePublicationSources({ ptadEnabled: true })
			const onSnapshot = buildSdkControllerPublication(onSources)
			expect(onSnapshot._ptadPushId).toBe(onSnapshot.stateVersion)
		})

		it("AOPC02-PHASE-A0-5: epoch stability -- a modeled W1 stamp does NOT advance the epoch", () => {
			const sources = makePublicationSources()
			const beforeEpoch = sources.minter.epoch
			buildSdkControllerPublication(sources)
			expect(sources.minter.epoch).toBe(beforeEpoch)
		})
	})

	describe("modeled idle-yield composition coherence (NOT real SdkController evidence)", () => {
		// Idle-yield capture instant:
		//   Drive the tracker through one full cycle (idle -> streaming -> idle)
		//   so its phase and seq reflect a recent terminal transition -- the
		//   SAME profile the host presents after a deferred-RUNNING turn
		//   (mirrors the row 15c CORRECTION03 idle-yield contract).
		//
		// NOTE: this only proves the MODELED composition is coherent at an
		// idle-yield input. It does NOT prove the real SdkController producer
		// returns a coherent idle snapshot. The real producer discriminator
		// lives in PHASE-A-CORRECTION01.
		function idleYieldSources(): SdkControllerPublicationSources {
			const sources = makePublicationSources()
			sources.turnStateTracker.set("streaming", Date.now())
			sources.turnStateTracker.set("idle")
			return sources
		}

		it("AOPC02-PHASE-A0-E1: MODEL only -- at idle-yield the modeled snapshot is internally coherent (no contradiction among taskHeader / thinking / backgroundCommandRunning)", () => {
			// What this proves:
			//   Given an idle-yield tracker + idle shadow-absent input +
			//   backgroundCommandRunning=false + taskTelemetry=undefined,
			//   the SELECTORS (real selectThinkingPresentation +
			//   selectTaskHeaderPresentation) + local property-access
			//   replication produces a non-contradictory modeled snapshot.
			// What this does NOT prove:
			//   - real SdkController.getStateToPostToWebview() returns a
			//     non-contradictory snapshot;
			//   - the Cancel affordance / composer are inactive at the real
			//     publication seam (those predicates are locally reconstructed
			//     and may differ from production selectors);
			//   - the real taskTelemetry.get() value is undefined (it is
			//     hand-rolled to undefined here, which is NOT an observed value).
			const sources = idleYieldSources()
			const snapshot = buildSdkControllerPublication(sources)

			// Modeled identity MUST be set.
			expect(typeof snapshot.stateVersion).toBe("number")
			expect(snapshot.stateVersion).toBeGreaterThan(0)
			expect(typeof snapshot.epoch).toBe("number")
			expect(snapshot.epoch).toBeGreaterThanOrEqual(0)

			// Modeled selector outputs are non-contradictory.
			expect(snapshot.taskHeaderPresentation.phase).toBe("idle")
			expect(snapshot.thinkingPresentation.modelStreaming).toBe(false)
			expect(snapshot.taskHeaderPresentation.source).toBe("legacy")
			expect(snapshot.thinkingPresentation.source).toBe("legacy")

			// Modeled identity correlation (SHAPE only):
			//   turnState.seq == thinkingPresentation.seq == taskHeaderPresentation.seq
			//   (all from the SAME tracker.get() call)
			// Numeric equality with stateVersion is NOT asserted: production
			// does not promise `stateVersion == turnState.seq + 1` (those
			// are independently-advanced counters).
			expect(snapshot.turnState.seq).toBeGreaterThan(0)
			expect(snapshot.thinkingPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.taskHeaderPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.backgroundCommandRunning).toBe(false)
		})

		it("AOPC02-PHASE-A0-E1-AGAIN: SHAPE only -- a second modeled capture advances stateVersion strictly (no numeric equality with turnState.seq asserted)", () => {
			// SHAPE-only invariants: every modeled assembly advances stateVersion;
			// no new tracker.set() means tracker-driven fields stay frozen;
			// epoch is stable across modeled calls.
			//
			// Does NOT assert `stateVersion == turnState.seq + N` because
			// production does not promise that numeric relation.
			const sources = idleYieldSources()
			const first = buildSdkControllerPublication(sources)
			const second = buildSdkControllerPublication(sources)

			expect(second.stateVersion).toBeGreaterThan(first.stateVersion)
			expect(second.epoch).toBe(first.epoch)
			expect(second.thinkingPresentation.modelStreaming).toBe(first.thinkingPresentation.modelStreaming)
			expect(second.taskHeaderPresentation.phase).toBe(first.taskHeaderPresentation.phase)
			expect(second.thinkingPresentation.seq).toBe(first.thinkingPresentation.seq)
			expect(second.taskHeaderPresentation.seq).toBe(first.taskHeaderPresentation.seq)
		})

		it("AOPC02-PHASE-A0-CANCEL-PREDICATE-LOCAL: the LOCALLY RECONSTRUCTED cancel-predicate-reconstruction returns false at the modeled idle-yield snapshot (NOT real cancel authority)", () => {
			// What this proves:
			//   The locally reconstructed predicate (hand-rolled boolean
			//   combination) returns false given the modeled snapshot.
			// What this does NOT prove:
			//   The REAL webview cancel-button selector (which may differ
			//   from this hand-rolled predicate) is inactive at the real
			//   SdkController publication seam. PHASE-A-CORRECTION01 will
			//   import and apply the real production cancel selector.
			const sources = idleYieldSources()
			const snapshot = buildSdkControllerPublication(sources)

			const localCancelPredicateActive =
				snapshot.taskHeaderPresentation.phase === "compacting" ||
				snapshot.backgroundCommandRunning ||
				snapshot.thinkingPresentation.modelStreaming

			expect(localCancelPredicateActive).toBe(false)
		})

		it("AOPC02-PHASE-A0-COMPOSER-PREDICATE-LOCAL: the LOCALLY RECONSTRUCTED composer-disable-predicate returns false at the modeled idle-yield snapshot (NOT real composer authority)", () => {
			// What this proves:
			//   The locally reconstructed composer-disable predicate returns
			//   false given the modeled snapshot.
			// What this does NOT prove:
			//   The REAL webview composer-disable selector (which may differ)
			//   is inactive at the real SdkController publication seam.
			//   PHASE-A-CORRECTION01 will import and apply the real production
			//   composer selector.
			const sources = idleYieldSources()
			const snapshot = buildSdkControllerPublication(sources)

			const localComposerDisableActive =
				snapshot.taskHeaderPresentation.phase !== "idle" ||
				snapshot.thinkingPresentation.modelStreaming ||
				snapshot.backgroundCommandRunning

			expect(localComposerDisableActive).toBe(false)
		})
	})
})
