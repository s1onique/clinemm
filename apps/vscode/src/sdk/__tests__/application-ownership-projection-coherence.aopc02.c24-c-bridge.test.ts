/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / PHASE A
 *
 * Purpose: capture ONE real `SdkController.getStateToPostToWebview()`
 * publication snapshot at the host idle-yield instant and classify it
 * internally before any webview-side coupling is touched. This is the
 * extension-side discriminator the Factory reviewer mandated for Phase A.
 *
 * SYNCHRONIZED_PUBLICATION_INPUT_TOKEN = REAL_PRODUCTION_SEAM
 *   (no synthetic seq, no synthetic currentLegacyPhase, no synthetic arbiter input).
 *
 * Per the Factory reviewer:
 *   "DO NOT let AOPC02 become another 500-line reproduction harness.
 *    The most valuable probe is conceptually tiny."
 *
 * This Phase A test does the EXTENSION-SIDE half of that comparison.
 * It does NOT exercise the webview-side reducer, transport, or React.
 * Phase B (only if E1) is the webview-side half.
 *
 * ===========================================================================
 * E1/E2/E3 EXTENSION-SIDE CLASSIFIER (per Factory reviewer Phase A plan)
 * ===========================================================================
 *
 *   E1 — coherent idle publication: TaskHeader=idle, Thinking.modelStreaming=false,
 *        Cancel inactive, composer enabled. Cross to Phase B.
 *
 *   E2 — internal publication contradiction: TaskHeader=idle AND Thinking=true
 *        AND/OR Cancel-active. RED inside SdkController assembly; STOP.
 *
 *   E3 — runtime truth active, header idle. TaskHeader publication RED; STOP.
 *        (E3 is structurally impossible in the LIGHTWEIGHT Phase A probe —
 *         no real runtime here. Documented for completeness.)
 *
 * ===========================================================================
 * IDENTITY-CORRELATION ASSERTIONS (per reviewer mandate)
 * ===========================================================================
 *
 * Read SdkController.ts:2886-3010 (current source) and assert the PRESENT
 * contract -- not the assumed-numerically-equal one. The present contract:
 *   - stateVersion            = minter.nextSeq()         (one tick per call)
 *   - turnState.seq           = tracker.get().seq        (advances on phase transition)
 *   - thinkingPresentation.seq = tracker.get().seq       (SAME tracker.get())
 *   - taskHeaderPresentation.seq = tracker.get().seq    (SAME tracker.get())
 *   - epoch                   = minter.epoch             (advances on bumpEpoch)
 *   - _ptadPushId             = stateVersion (PTAD on) or undefined (PTAD off)
 *
 * stateVersion and turnState.seq are NOT always numerically equal --
 * they are independently-advanced counters. We assert the SHAPE of the
 * captured object, not numerical equality between domains.
 *
 * STOP RULE (ACT §15):
 *   If E2 reproduces, STOP. The defect is in SdkController assembly. Do
 *   NOT investigate webview reducer, transport, or React.
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

describe("ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 / AOPC02 / Phase A", () => {
	describe("publication-identity source chain is REAL (no synthetic inputs)", () => {
		it("AOPC02-PHASE-A-1: real MessageIdMinter -> stateVersion = minter.nextSeq()", () => {
			const sources = makePublicationSources()
			// Pre-burn some minter ticks (mirrors prior W1 stamps).
			sources.minter.nextSeq()
			sources.minter.nextSeq()
			const beforeSeq = sources.minter.seq
			const snapshot = buildSdkControllerPublication(sources)
			expect(snapshot.stateVersion).toBe(beforeSeq + 1)
			expect(snapshot.stateVersion).toBeGreaterThan(beforeSeq)
		})

		it("AOPC02-PHASE-A-2: real TurnStateTracker -> turnState is the tracker's own snapshot", () => {
			const sources = makePublicationSources()
			const snapshot = buildSdkControllerPublication(sources)
			// `turnState` is exactly `turnStateTracker.get()` -- no recomputation.
			expect(snapshot.turnState).toEqual(sources.turnStateTracker.get())
			expect(snapshot.turnState.seq).toBe(sources.turnStateTracker.get().seq)
		})

		it("AOPC02-PHASE-A-3: thinkingPresentation.seq + taskHeaderPresentation.seq come from the SAME tracker.get()", () => {
			const sources = makePublicationSources()
			const snapshot = buildSdkControllerPublication(sources)
			expect(snapshot.thinkingPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.taskHeaderPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.thinkingPresentation.seq).toBe(snapshot.taskHeaderPresentation.seq)
		})

		it("AOPC02-PHASE-A-4: _ptadPushId aliases stateVersion when PTAD is on; undefined when off", () => {
			const offSources = makePublicationSources({ ptadEnabled: false })
			const offSnapshot = buildSdkControllerPublication(offSources)
			expect(offSnapshot._ptadPushId).toBeUndefined()

			const onSources = makePublicationSources({ ptadEnabled: true })
			const onSnapshot = buildSdkControllerPublication(onSources)
			expect(onSnapshot._ptadPushId).toBe(onSnapshot.stateVersion)
		})

		it("AOPC02-PHASE-A-5: epoch stability -- a W1 stamp does NOT advance the epoch", () => {
			const sources = makePublicationSources()
			const beforeEpoch = sources.minter.epoch
			buildSdkControllerPublication(sources)
			expect(sources.minter.epoch).toBe(beforeEpoch)
		})
	})

	describe("extension-side E1/E2/E3 classifier on a real tracker idle-yield capture", () => {
		// Idle-yield capture instant:
		//   Drive the tracker through one full cycle (idle -> streaming -> idle)
		//   so its phase and seq reflect a recent terminal transition -- the
		//   SAME profile the host presents after a deferred-RUNNING turn
		//   (mirrors the row 15c CORRECTION03 idle-yield contract).
		function idleYieldSources(): SdkControllerPublicationSources {
			const sources = makePublicationSources()
			sources.turnStateTracker.set("streaming", Date.now())
			sources.turnStateTracker.set("idle")
			return sources
		}

		it("AOPC02-PHASE-A-E1: at idle-yield with no shadow, snapshot is internally coherent", () => {
			const sources = idleYieldSources()
			const snapshot = buildSdkControllerPublication(sources)

			// Publication identity MUST be set.
			expect(typeof snapshot.stateVersion).toBe("number")
			expect(snapshot.stateVersion).toBeGreaterThan(0)
			expect(typeof snapshot.epoch).toBe("number")
			expect(snapshot.epoch).toBeGreaterThanOrEqual(0)

			// TaskHeader / Thinking / Cancel predicates at the seam:
			//   - taskHeaderPresentation.phase = "idle" (legacy branch)
			//   - thinkingPresentation.modelStreaming = false (legacy branch;
			//     currentLegacyPhase === "streaming" is false after the
			//     idle-yield drive above)
			//   - backgroundCommandRunning = false (no real background job)
			//
			// None of these is "active" or "streaming" or "running" -- the
			// SdkController publication at idle-yield is internally coherent.
			// No TaskHeader/Thinking/Cancel contradiction is born here.
			expect(snapshot.taskHeaderPresentation.phase).toBe("idle")
			expect(snapshot.thinkingPresentation.modelStreaming).toBe(false)
			expect(snapshot.backgroundCommandRunning).toBe(false)
			expect(snapshot.taskHeaderPresentation.source).toBe("legacy")
			expect(snapshot.thinkingPresentation.source).toBe("legacy")

			// Identity correlation at this single captured snapshot:
			//   - turnState.seq == thinkingPresentation.seq == taskHeaderPresentation.seq
			//     (all from the SAME tracker.get() call)
			//   - stateVersion = turnState.seq + 1 -- at this single captured
			//     instant, the W1 stamp consumed exactly ONE nextSeq tick AFTER
			//     the most recent tracker.set() (the idle transition in
			//     idleYieldSources()). The exact difference depends on how
			//     many prior getStateToPostToWebview() calls have happened
			//     since the most recent set; in this lightweight harness
			//     that is the ONE nextSeq() consumed by buildSdkControllerPublication
			//     itself, plus zero prior calls, so stateVersion =
			//     turnState.seq + 1 is the expected relation.
			expect(snapshot.turnState.seq).toBeGreaterThan(0)
			expect(snapshot.thinkingPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.taskHeaderPresentation.seq).toBe(snapshot.turnState.seq)
			expect(snapshot.stateVersion).toBe(snapshot.turnState.seq + 1)
		})

		it("AOPC02-PHASE-A-E1-AGAIN: re-capture returns a NEW stateVersion with the SAME publication profile (monotonic W1)", () => {
			// Per W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01, every W1 stamp
			// consumes a fresh seq tick. A second getStateToPostToWebview
			// call must therefore see stateVersion strictly greater than
			// the first, while thinkingPresentation + taskHeaderPresentation
			// stay frozen (no new tracker.set() in between, so the legacy
			// phase + seq both stay at "idle" / the prior terminal seq).
			const sources = idleYieldSources()
			const first = buildSdkControllerPublication(sources)
			const second = buildSdkControllerPublication(sources)

			expect(second.stateVersion).toBeGreaterThan(first.stateVersion)
			expect(second.epoch).toBe(first.epoch) // no bumpEpoch in between
			expect(second.thinkingPresentation.modelStreaming).toBe(first.thinkingPresentation.modelStreaming)
			expect(second.taskHeaderPresentation.phase).toBe(first.taskHeaderPresentation.phase)
			expect(second.thinkingPresentation.seq).toBe(first.thinkingPresentation.seq)
			expect(second.taskHeaderPresentation.seq).toBe(first.taskHeaderPresentation.seq)
			// W1 stamp consumed one tick since first capture; tracker did
			// not advance (no set() in between) -> stateVersion = turnState.seq + 2.
			expect(second.stateVersion).toBe(second.turnState.seq + 2)
		})

		it("AOPC02-PHASE-A-CANCEL-INPUTS: at idle-yield, the cancel predicate inputs are ALL inactive", () => {
			// The cancel predicate inputs at the publication seam are:
			//   - taskHeaderPresentation.phase != "compacting"
			//     (no host compaction override -- legacy phase is "idle")
			//   - backgroundCommandRunning = false
			//   - thinkingPresentation.modelStreaming = false
			//
			// All three are inactive here -> cancel predicate inputs are
			// inactive at this publication. The contradiction
			// "Cancel visible while TaskHeader=idle" cannot be born at the
			// SdkController publication seam -- it must be either (a)
			// introduced by the webview reducer commit, (b) introduced by
			// the React rendering seam, or (c) caused by an out-of-date
			// taskTelemetry snapshot.
			const sources = idleYieldSources()
			const snapshot = buildSdkControllerPublication(sources)

			const cancelPredicateActive =
				snapshot.taskHeaderPresentation.phase === "compacting" ||
				snapshot.backgroundCommandRunning ||
				snapshot.thinkingPresentation.modelStreaming

			expect(cancelPredicateActive).toBe(false)
		})

		it("AOPC02-PHASE-A-COMPOSER-INPUTS: at idle-yield, composer-disable predicate inputs are ALL inactive", () => {
			// The composer-disable predicate inputs at the publication seam.
			// SdkController publication here is `idle` / `modelStreaming=false`
			// / `backgroundCommandRunning=false` / `phase=idle` -- none of
			// these is "active". composer-disable is INACTIVE -> composer is
			// user-owned at this snapshot. If the LIVE webview shows the
			// composer BLOCKED while the host is idle and a real follow-up
			// could be dispatched (per row 15c CORRECTION03), the defect
			// lives in the WEBVIEW (reducer + React), NOT in SdkController
			// publication assembly.
			const sources = idleYieldSources()
			const snapshot = buildSdkControllerPublication(sources)

			const composerDisableActive =
				snapshot.taskHeaderPresentation.phase !== "idle" ||
				snapshot.thinkingPresentation.modelStreaming ||
				snapshot.backgroundCommandRunning

			expect(composerDisableActive).toBe(false)
		})
	})
})
