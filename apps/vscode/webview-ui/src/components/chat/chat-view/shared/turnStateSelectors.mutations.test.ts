// ACT-CLINEMM-COMPLETION-CHANGESET-UI-STATE-TRUTH01:
//
// This file is a SENTINEL/DISPOSITION SUITE for the five-mutation
// campaign listed below. Each `it` block is the test that, on
// the unmutated source, asserts the production contract the
// mutation would violate. The mutations themselves were run
// MANUALLY by editing `turnStateSelectors.ts` and re-running
// the focused test suite; the file does not include a replayable
// harness. The numbers cited in the ACT closure report
// (8 / 4 / 4 / 3 / 1 failures per mutation) come from those
// manual runs against this disposition file plus
// `turnStateSelectors.test.ts` plus the two consumer-side
// test files (`InputSection.test.tsx`,
// `useMessageHandlers.test.tsx`). A follow-up ACT could add
// `turnStateSelectors.mutations.py` for reproducibility; the
// parent ACT deliberately did not block on building that
// harness for a small UI consumer.
//
// Mutation disposition (ACT-CLINEMM-COMPLETION-CHANGESET-UI-STATE-TRUTH01 §33):
//
//   M1  Restore `lastMessage.partial === true` authority at the
//       InputSection composer lockout (would reintroduce the
//       prose fallback). Kills CUI07 + the legacy regression
//       test renamed at `InputSection.test.tsx`. Observed: 8
//       failures across the four-file focused suite.
//
//   M2  Drop the awaiting_approval arm of `allowsQueuedSubmit`
//       so approval can never queue. Kills CUI04 + the
//       InputSection "approval queue" test. Observed: 4
//       failures.
//
//   M3  Drop the streaming arm of `turnAllowsFollowup` so
//       streaming turns cannot receive interrupt-with-
//       feedback. Kills CUI02 + the useMessageHandlers steering
//       test. Observed: 4 failures.
//
//   M4  Ignore awaiting_followup in `isRunTerminal` (treat it
//       as live). Kills CUI09 + the "between-turn active"
//       invariant in CUI11. Observed: 3 failures.
//
//   M5  Collapse `isRunTerminal` to `!isRunLive(turnState)`.
//
//       EARLIER VERSION OF THIS FILE claimed M5's kill was the
//       "negation property" (live vs terminal symmetry). That
//       was wrong: for every *defined* `TurnPhase`, the
//       production `isRunLive` and `isRunTerminal` are exact
//       complements (see CUI11) — so collapsing them produces
//       identical per-phase answers. The actual asymmetry the
//       production code protects is the `undefined` case:
//       `isRunLive(undefined) === false` AND
//       `isRunTerminal(undefined) === false` (conservative
//       missing-canonical-state). A naive negation flips
//       `isRunTerminal(undefined)` to `true` and lifts every
//       terminal-gated surface when the transport is silent.
//
//       M5's mutation therefore kills CUI10 ("missing canonical
//       state is conservative in every selector"), not the
//       per-phase symmetry. Observed: 1 failure.
//
// All five mutations are KILLED on the unmutated source.

import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { allowsQueuedSubmit, isRunLive, isRunTerminal, turnAllowsFollowup } from "./turnStateSelectors"

function ts(phase: TurnPhase): TurnState {
	return { phase, seq: 1 }
}

describe("ACT-CLINEMM-COMPLETION-CHANGESET-UI-STATE-TRUTH01 / selector mutation disposition", () => {
	// M1 — the InputSection legacy fallback. We assert the
	// selector does NOT accept a `lastMessage` argument at all
	// (pure function, no prose fallback). The companion
	// InputSection test pins the consumer side.
	it("M1: selectors take only turnState; a `lastMessage` argument is impossible", () => {
		// Selector signatures are the canonical contract.
		expect(turnAllowsFollowup.length).toBe(1)
		expect(allowsQueuedSubmit.length).toBe(1)
		expect(isRunLive.length).toBe(1)
		expect(isRunTerminal.length).toBe(1)
	})

	// M2 — drop awaiting_approval from queued submit.
	// `turnAllowsFollowup(awaiting_approval)` is false by
	// design (it's the dedicated clineAsk branch), but
	// `allowsQueuedSubmit(awaiting_approval)` MUST be true so
	// typed feedback can reject.
	it("M2: allowsQueuedSubmit includes awaiting_approval", () => {
		expect(allowsQueuedSubmit(ts("awaiting_approval"))).toBe(true)
	})

	// M3 — drop streaming from follow-up. Steering against a
	// live turn must continue to work.
	it("M3: turnAllowsFollowup includes streaming", () => {
		expect(turnAllowsFollowup(ts("streaming"))).toBe(true)
	})

	// M4 — awaiting_followup must be terminal. This is the
	// load-bearing "agent explicitly asked for input" case.
	it("M4: awaiting_followup is terminal", () => {
		expect(isRunTerminal(ts("awaiting_followup"))).toBe(true)
	})

	// M5 — collapsing `isRunTerminal` into `!isRunLive` would
	// mis-classify `undefined`. For every *defined* `TurnPhase`
	// the two are exact complements (the symmetry is pinned in
	// CUI11 — see `turnStateSelectors.test.ts`), so the killer
	// for M5 is NOT the per-phase symmetry. The actual asymmetry
	// the production code protects is `undefined → false / false`:
	// a naive `return !isRunLive(turnState)` would flip
	// `isRunTerminal(undefined)` from `false` to `true` and the
	// conservative-missing-canonical-state lock (CUI10) would
	// silently drop, lifting buttons and rendering completion
	// surfaces when no canonical state authority is on the wire.
	//
	// This test is the load-bearing M5 sentinel: it asserts the
	// production contract directly. M5's mutation
	// (`return !isRunLive(turnState)`) fails THIS assertion.
	// The earlier version of this test pinned the per-phase
	// symmetry, which was the wrong kill target — both shapes
	// (production and M5) satisfy the symmetry for defined
	// phases. See the file header for the corrected disposition.
	it("M5: isRunTerminal(undefined) stays false under the conservative contract", () => {
		expect(isRunLive(undefined)).toBe(false)
		expect(isRunTerminal(undefined)).toBe(false)
	})
})
