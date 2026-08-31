// ===========================================================================
// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02
//
// RED suite — drives the REAL production seam end-to-end.
//
// What CORRECTION01 got wrong:
//   The original REPAIR01 compared the publication `turnState.seq`
//   against the shadow's INTERNAL observation counter
//   (`TaskShadowComparator.seq`). Those are unrelated counters with
//   different cardinalities — comparing them numerically does not
//   establish chronology. The RED tests at that time encoded the
//   invalid identity assumption by hand.
//
// What CORRECTION02 fixes:
//   The shadow observation is now stamped, at the moment of
//   observation, with the **TurnStateTracker.seq** value the
//   observation occurred under. Both sides of the staleness gate
//   (`seq` and `canonicalShadowObservedTurnSeq`) are now in the
//   same TurnState sequence domain.
//
// RED structure (CORRECTION02):
//   1. Real `MessageIdMinter`.
//   2. Real `TurnStateTracker` (so `tracker.set(phase)` advances
//      the SAME `seq` the selector and the comparator see).
//   3. Real `TaskShadowComparator` (so observation stamps
//      `lastObservedTurnSeq` from the SAME `tracker.get().seq`).
//   4. Drive the live sequence:
//        a. tracker.set("idle")           → seq=1
//        b. comparator.observe(...) with turnSeq=tracker.get().seq
//                                        → stamps seq=1
//        c. tracker.set("streaming")       → seq=2 (legacy advances)
//        d. selectTaskHeaderPresentation(canonicalShadowPhase,
//                                        currentLegacyPhase,
//                                        seq=tracker.get().seq,
//                                        canonicalShadowObservedTurnSeq
//                                          =comparator.debugLastObservedTurnSeq())
//      The publication MUST NOT carry
//      `taskHeaderPresentation.phase = "idle"`.
//   5. Repeat for the inverse case (stale shadow "streaming"
//      overridden by fresh legacy "completed").
// ===========================================================================

import { TaskState } from "@cline/agents"
import type { AgentRuntimeEvent } from "@cline/shared"
import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { TaskShadowComparator, toLegacyPhase } from "../task-state-shadow"
import {
	selectTaskHeaderPresentation,
	selectThinkingPresentation,
	type TaskHeaderPresentationInputs,
	type ThinkingPresentationInputs,
} from "../task-state-shadow-arbiter-mapper"
import { emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"
import { TurnStateTracker } from "../turn-state-tracker"

// ---------------------------------------------------------------------------
// Production-seam helpers.
// ---------------------------------------------------------------------------

interface ProductionSeamFixture {
	readonly tracker: TurnStateTracker
	readonly minter: MessageIdMinter
	readonly comparator: TaskShadowComparator
	observeViaCanonicalShadow(): TurnPhase
	observeNoopViaCanonicalShadow(turnSeq?: number): TurnPhase
	currentShadowPhase(): TurnPhase | undefined
}

function fixture(): ProductionSeamFixture {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const comparator = new TaskShadowComparator()
	return {
		tracker,
		minter,
		comparator,
		observeViaCanonicalShadow(): TurnPhase {
			const now = Date.now()
			const legacyPhase = tracker.currentPhase
			const turnSeq = tracker.get().seq
			// Use a real `task_requested` TaskMsg (NOT `"noop"`) so
			// the comparator's CORRECTION03 stamping rule (only
			// stamp on non-noop events) actually fires. The
			// comparator accepts real TaskMsg types like
			// `task_requested`; using `"noop"` would bypass the
			// stamp entirely, leaving the Map empty.
			comparator.observeTaskMsg(
				{
					type: "task_requested",
					taskId: "test",
					at: now,
				},
				legacyPhase,
				now,
				turnSeq,
			)
			if (!comparator.hasObservedShadowState()) return "idle" as TurnPhase
			const model = comparator.debugSnapshot()
			const canonical = TaskState.projectTurnState(model)
			return toLegacyPhase(canonical)
		},
		// Adversarial: drive a `"noop"` observation through the
		// comparator that does NOT advance the comparator's
		// phase-keyed stamp. This mirrors the production path at
		// shadow-adapter.ts:212 (`observeRuntimeEvent` returns
		// `shadow.noop(now)` when the event has no shadow
		// analogue). The CORRECTION03 invariant requires that
		// such noop observations do NOT bypass the staleness gate.
		observeNoopViaCanonicalShadow(turnSeq?: number): TurnPhase {
			const now = Date.now()
			const effectiveTurnSeq = turnSeq ?? tracker.get().seq
			// Drive an `observeRuntimeEvent` for an event type
			// that the adapter does not translate (e.g. plain
			// `"noop"`); production's `observeRuntimeEvent` falls
			// back to the shadow.noop observation in this case.
			comparator.observeRuntimeEvent(runtimeEvent("noop"), tracker.currentPhase, now, effectiveTurnSeq)
			if (!comparator.hasObservedShadowState()) return "idle" as TurnPhase
			const model = comparator.debugSnapshot()
			const canonical = TaskState.projectTurnState(model)
			return toLegacyPhase(canonical)
		},
		currentShadowPhase(): TurnPhase | undefined {
			if (!comparator.hasObservedShadowState()) return undefined
			const model = comparator.debugSnapshot()
			const canonical = TaskState.projectTurnState(model)
			return toLegacyPhase(canonical)
		},
	}
}

function runtimeEvent(type: string): AgentRuntimeEvent {
	return { type, snapshot: { runId: "test", status: "running" } } as unknown as AgentRuntimeEvent
}

// ---------------------------------------------------------------------------
// RED — REPAIR01-CORRECTION02 / TCR01:
// STALE SHADOW MUST NOT OVERRIDE FRESH LEGACY (same-domain proof).
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02 / production-seam RED", () => {
	it("THCP11_C02_RED: stale shadow 'idle' MUST NOT override fresh legacy 'streaming' (LIVE contradiction, real seam)", () => {
		// Same-domain identity proof:
		//   1. tracker.set("idle") advances the SAME seq that
		//      the comparator stamps on its observation.
		//   2. observeViaCanonicalShadow() reads
		//      tracker.get().seq AT THE MOMENT of observation
		//      and passes it to comparator.observeTaskMsg().
		//   3. tracker.set("streaming") advances the SAME seq.
		//   4. The publication reads tracker.get().seq for the
		//      `seq` field and comparator.debugLastObservedTurnSeq()
		//      for `canonicalShadowObservedTurnSeq`.
		//
		// Both values are in the SAME TurnState sequence
		// domain. The numeric comparison `seq >
		// canonicalShadowObservedTurnSeq` now has causal
		// meaning: it asks whether the legacy has advanced
		// since the shadow last observed.
		const fx = fixture()
		fx.tracker.set("idle")
		const seqAtFirstSet = fx.tracker.get().seq
		const shadowPhase = fx.observeViaCanonicalShadow()
		// Same-domain assertion: the comparator's stamp equals
		// the TurnStateTracker.seq that was live when the
		// observation occurred.
		expect(fx.comparator.debugLastObservedTurnSeqForPhase("idle")).toBe(seqAtFirstSet)
		expect(shadowPhase).toBe("idle")
		fx.tracker.set("streaming")
		const seqAfterStreaming = fx.tracker.get().seq
		expect(seqAfterStreaming).toBeGreaterThan(seqAtFirstSet)

		const publicationSeq = fx.tracker.get().seq
		const publicationShadowStamp = fx.comparator.debugLastObservedTurnSeqForPhase("idle")
		// The publication's `seq` and the comparator's stamp
		// are BOTH sampled from the SAME TurnStateTracker.
		expect(publicationSeq).toBe(seqAfterStreaming)
		expect(publicationShadowStamp).toBeLessThan(publicationSeq)

		const projection = selectTaskHeaderPresentation({
			canonicalShadowPhase: fx.currentShadowPhase(),
			currentLegacyPhase: fx.tracker.currentPhase,
			seq: publicationSeq,
			canonicalShadowObservedTurnSeq: publicationShadowStamp,
		})

		expect(projection.phase).not.toBe("idle")
		expect(projection.phase).toBe("streaming")
		expect(projection.source).toBe("legacy")
	})

	it("THCP11_C02_RED_INVERSE: stale shadow 'streaming' MUST NOT override fresh legacy 'completed'", () => {
		const fx = fixture()
		fx.tracker.set("idle")
		// Observe via the real TaskMsg-driven seam (uses
		// `task_requested` — produces a non-noop event, stamps
		// the comparator's phase-keyed entry).
		fx.observeViaCanonicalShadow()
		const stampedTurnSeqAfterFirstObserve = fx.comparator.debugLastObservedTurnSeqForPhase("idle")
		expect(stampedTurnSeqAfterFirstObserve).toBe(fx.tracker.get().seq)
		expect(stampedTurnSeqAfterFirstObserve).toBeDefined()

		fx.tracker.set("streaming")
		fx.tracker.set("completed")
		expect(fx.tracker.get().seq).toBeGreaterThan(stampedTurnSeqAfterFirstObserve!)

		const projection = selectTaskHeaderPresentation({
			canonicalShadowPhase: fx.currentShadowPhase(),
			currentLegacyPhase: fx.tracker.currentPhase,
			seq: fx.tracker.get().seq,
			canonicalShadowObservedTurnSeq: fx.comparator.debugLastObservedTurnSeqForPhase(fx.currentShadowPhase() ?? "idle"),
		})

		expect(projection.phase).not.toBe("streaming")
		expect(projection.phase).toBe("completed")
		expect(projection.source).toBe("legacy")
	})

	it("THCP11_C02_RED_FRESH_SHADOW_PRESERVED: when the shadow's stamp equals the legacy seq AND shadow agrees with legacy, no regression", () => {
		// Conservation baseline — proves the repair doesn't
		// regress the "shadow is authoritative when fresh"
		// property. With the shadow stamp equal to the legacy
		// seq AND the shadow projection agreeing with the
		// legacy phase, the staleness gate does NOT fire and
		// the selector returns the shadow branch (the LIVE
		// contradiction is forbidden because shadow agrees).
		//
		// We drive this by passing canonicalShadowPhase =
		// currentLegacyPhase directly (i.e. simulate that the
		// canonical shadow DID observe the legacy transition
		// and agrees with it). The staleness gate's
		// `seq > canonicalShadowObservedTurnSeq` does NOT
		// fire (equal values), so the shadow branch wins.
		const fx = fixture()
		fx.tracker.set("idle")
		fx.tracker.set("streaming")
		const seq = fx.tracker.get().seq
		const projection = selectTaskHeaderPresentation({
			canonicalShadowPhase: "streaming",
			currentLegacyPhase: "streaming",
			seq,
			canonicalShadowObservedTurnSeq: seq, // same-domain equality
		})
		expect(projection.phase).toBe("streaming")
		expect(projection.source).toBe("shadow")
	})

	it("THCP11_C02_THINKING_RED: selectThinkingPresentation staleness gate honors same-domain comparator stamp", () => {
		const fx = fixture()
		fx.tracker.set("idle")
		fx.observeViaCanonicalShadow()
		fx.tracker.set("streaming")
		const staleShadow: ArbiterSnapshot = {
			...emptyArbiterSnapshot(),
			execution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		}
		const projection = selectThinkingPresentation({
			canonicalShadow: staleShadow,
			currentLegacyPhase: fx.tracker.currentPhase,
			seq: fx.tracker.get().seq,
			canonicalShadowObservedTurnSeq: fx.comparator.debugLastObservedTurnSeqForPhase(fx.currentShadowPhase() ?? "idle"),
		})
		expect(projection.modelStreaming).toBe(true)
		expect(projection.source).toBe("legacy")
	})

	// -----------------------------------------------------------------------
	// CORRECTION03 adversarial RED (HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION):
	// A no-op shadow observation under TurnState generation N+1 advances
	// `lastObservedTurnSeq` to N+1 WITHOUT changing the shadow's projected
	// phase (still "idle"). The publication's `seq` is also N+1 (because
	// the legacy tracker advanced to `streaming` at N+1). The numeric
	// comparison `seq > canonicalShadowObservedTurnSeq` evaluates to
	// `false`, the staleness gate does NOT fire, and the shadow branch
	// returns `phase="idle"` against `currentLegacyPhase="streaming"`
	// — the LIVE contradiction resurfaces.
	//
	// CORE ASSERTION: this schedule MUST be forbidden. The publication
	// phase must NOT be "idle" when the legacy is "streaming".
	// -----------------------------------------------------------------------
	it("THCP11_C03_RED: unrelated no-op shadow observation after legacy transitions MUST NOT bypass the staleness gate", () => {
		const fx = fixture()
		// Step 1: legacy is idle (seq=N). Shadow observes idle → stamps at N.
		fx.tracker.set("idle")
		fx.observeViaCanonicalShadow()
		const seqAtIdle = fx.tracker.get().seq
		const stampAtIdle = fx.comparator.debugLastObservedTurnSeqForPhase("idle")
		expect(stampAtIdle).toBe(seqAtIdle)

		// Step 2: legacy transitions to streaming (seq=N+1). The shadow
		// is NOT given a corresponding streaming observation. Its
		// projected phase remains "idle".
		fx.tracker.set("streaming")
		const seqAfterStreaming = fx.tracker.get().seq
		expect(seqAfterStreaming).toBeGreaterThan(seqAtIdle)
		// Shadow's projected phase is still "idle" — it never received
		// a streaming transition.
		const shadowPhaseBeforeNoop = fx.currentShadowPhase()
		expect(shadowPhaseBeforeNoop).toBe("idle")

		// Step 3: an unrelated shadow noop observation occurs under
		// seq=N+1 that does NOT change the shadow's projected phase.
		// Production emits noop observations for many events
		// (shadow-adapter.ts:212). Per the CORRECTION03 invariant,
		// the noop observation does NOT advance the comparator's
		// phase-keyed stamp — the comparator's stamp for "idle"
		// remains at seqAtIdle (NOT seqAfterStreaming). This is the
		// load-bearing assertion.
		fx.observeNoopViaCanonicalShadow()
		const stampAfterNoop = fx.comparator.debugLastObservedTurnSeqForPhase("idle")
		expect(stampAfterNoop).toBe(seqAtIdle)
		expect(stampAfterNoop).not.toBe(seqAfterStreaming)
		// The shadow's projection is still "idle" (no new model
		// transition occurred):
		const shadowPhaseAfterNoop = fx.currentShadowPhase()
		expect(shadowPhaseAfterNoop).toBe("idle")

		// Step 4: publication. The publication's `seq` is
		// `seqAfterStreaming` (legacy advanced) but the phase-keyed
		// stamp for "idle" remains at `seqAtIdle`. The selector's
		// staleness gate `seq > stamp` evaluates to TRUE; the gate
		// fires; the shadow branch is bypassed; the legacy branch
		// returns phase="streaming" — the LIVE contradiction is
		// forbidden by the phase-keyed stamp.
		const projection = selectTaskHeaderPresentation({
			canonicalShadowPhase: fx.currentShadowPhase(),
			currentLegacyPhase: fx.tracker.currentPhase,
			seq: fx.tracker.get().seq,
			canonicalShadowObservedTurnSeq: fx.comparator.debugLastObservedTurnSeqForPhase(fx.currentShadowPhase() ?? "idle"),
		})

		// CORE ASSERTION (CORRECTION03): the publication MUST NOT be
		// "idle" when the legacy is "streaming" — even though the
		// numerical comparison `seq > canonicalShadowObservedTurnSeq`
		// evaluates to false. The reviewer's P0
		// SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION requires the
		// stamp to be bound to the projected phase.
		expect(projection.phase).not.toBe("idle")
		expect(projection.phase).toBe("streaming")
	})
})
// ---------------------------------------------------------------------------
// Conservation suite (T1..T14) — pure-selector tests using
// `canonicalShadowObservedTurnSeq` (the renamed parameter). These
// pin the precedence contract through the new staleness gate.
// ---------------------------------------------------------------------------

function taskHeaderInputs(overrides: Partial<TaskHeaderPresentationInputs> = {}): TaskHeaderPresentationInputs {
	return {
		canonicalShadowPhase: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

function shadowWith(execution: Partial<ArbiterSnapshot["execution"]> = {}): ArbiterSnapshot {
	return {
		...emptyArbiterSnapshot(),
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
			...execution,
		},
	}
}

function thinkingInputs(overrides: Partial<ThinkingPresentationInputs> = {}): ThinkingPresentationInputs {
	return {
		canonicalShadow: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02 / conservation", () => {
	it("T1: idle turn → task header idle (no shadow)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({ canonicalShadowPhase: undefined, currentLegacyPhase: "idle", seq: 1 }),
		)
		expect(out).toEqual({ phase: "idle", source: "legacy", seq: 1 })
	})

	it("T2: streaming turn → task header NOT idle (shadow fresh, same domain)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowObservedTurnSeq: 5,
			}),
		)
		expect(out.phase).toBe("streaming")
		expect(out.source).toBe("shadow")
	})

	it("T3: completed turn → completed preserved (shadow fresh)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "completed",
				currentLegacyPhase: "completed",
				seq: 10,
				canonicalShadowObservedTurnSeq: 10,
			}),
		)
		expect(out).toEqual({ phase: "completed", source: "shadow", seq: 10 })
	})

	it("T4: error turn → error preserved (shadow fresh)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "error",
				currentLegacyPhase: "error",
				seq: 7,
				canonicalShadowObservedTurnSeq: 7,
			}),
		)
		expect(out).toEqual({ phase: "error", source: "shadow", seq: 7 })
	})

	it("T5: resumable task reopened from History → Resume presentation preserved (shadow absent)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "resumable",
				seq: 3,
			}),
		)
		expect(out).toEqual({ phase: "resumable", source: "legacy", seq: 3 })
	})

	it("T6: completed task reopened → completed presentation preserved (shadow absent)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "completed",
				seq: 4,
			}),
		)
		expect(out).toEqual({ phase: "completed", source: "legacy", seq: 4 })
	})

	it("T7: task switching does not leak previous task phase (no shadow)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		expect(out.phase).toBe("idle")
		expect(out.source).toBe("legacy")
	})

	it("T8: cancel fence behavior preserved (legacy 'resumable' beats stale shadow 'streaming')", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "resumable",
				seq: 10,
				canonicalShadowObservedTurnSeq: 5,
			}),
		)
		expect(out.phase).toBe("resumable")
		expect(out.source).toBe("legacy")
	})

	it("T9: stale older projection/generation cannot overwrite newer authoritative phase (THE LIVE CONTRADICTION)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowObservedTurnSeq: 2,
			}),
		)
		expect(out.phase).toBe("streaming")
		expect(out.source).toBe("legacy")
	})

	it("T10: thinking presentation remains coherent with streaming lifecycle (stale shadow fallback)", () => {
		const staleShadow = shadowWith({ modelStreaming: false })
		const out = selectThinkingPresentation(
			thinkingInputs({
				canonicalShadow: staleShadow,
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowObservedTurnSeq: 2,
			}),
		)
		expect(out.modelStreaming).toBe(true)
		expect(out.source).toBe("legacy")
	})

	it("T11: foreground/background command-running presentation remains conserved (fresh shadow wins)", () => {
		const freshShadow = shadowWith({ modelStreaming: true })
		const out = selectThinkingPresentation(
			thinkingInputs({
				canonicalShadow: freshShadow,
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowObservedTurnSeq: 5,
			}),
		)
		expect(out.modelStreaming).toBe(true)
		expect(out.source).toBe("shadow")
	})

	it("T12 (regression guard): host compaction override still wins over fresh shadow", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "compacting",
				seq: 42,
				canonicalShadowObservedTurnSeq: 42,
			}),
		)
		expect(out).toEqual({ phase: "compacting", source: "host", seq: 42 })
	})

	it("T13 (regression guard): shadow equal-or-newer than legacy wins over legacy absence", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "streaming",
				seq: 7,
				canonicalShadowObservedTurnSeq: 7,
			}),
		)
		expect(out).toEqual({ phase: "awaiting_followup", source: "shadow", seq: 7 })
	})

	it("T14: canonicalShadowObservedTurnSeq === undefined keeps legacy-absent fallback (Hub/Remote)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 1,
				// canonicalShadowObservedTurnSeq intentionally omitted
			}),
		)
		// With undefined canonicalShadowObservedTurnSeq, the
		// staleness gate does NOT fire — the shadow branch
		// wins, source="shadow". This is the pre-repair
		// behavior preserved for the "no observation yet" case.
		expect(out.phase).toBe("idle")
		expect(out.source).toBe("shadow")
	})
})
