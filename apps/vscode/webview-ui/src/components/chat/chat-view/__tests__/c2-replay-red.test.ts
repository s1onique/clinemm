/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH
 *
 * Live C2 RED replay against the PRODUCTION `applyStateSnapshot` /
 * `applyTurnState` reducer. The frozen live evidence (see
 * `docs/architecture/elm/task-state-e71-c2-live-replica-truth-evidence.md`
 * §2) showed a mixed-generation webview state:
 *
 *   extension truth (per push V):   awaiting_followup / seq 15
 *   webview   truth (per push V):   idle / seq 2
 *
 * while newer webview fields DID update on the same push. This test
 * replays the exact observed E1-E6 sequence through the production
 * reducer and asserts the post-reducer `turnState` advances to the
 * extension's terminal value (`awaiting_followup / seq 15`).
 *
 * Per the ACT critical rule:
 *
 *   NO PRODUCTION CHANGE UNTIL THE EXACT
 *   idle/seq2 → streaming/seq4
 *   AND
 *   idle/seq2 → awaiting_followup/seq15
 *   REPLAY IS RED THROUGH THE PRODUCTION WEBVIEW APPLY PATH.
 *
 * If this test PASSES, the replica/apply boundary is NOT the root cause
 * and the ACT's Outcome C applies (HALT_REPLICA_REPRO_NOT_OBTAINED).
 */

import { describe, expect, it } from "vitest"
import { applyStateSnapshot, createReplicaState, type ReplicaState } from "../messageReducer"

// Exact live observed sequence (frozen C2 evidence §2.3).
// stateVersion=0 on every push (frozen C2 evidence §3 PTAD_STATEVERSION_CORRELATION = FAIL).
// epoch=0 on every push (unstamped classic/legacy wire shape).
const PUSHES: Array<{ phase: string; seq: number; label: string }> = [
	{ label: "E1", phase: "idle", seq: 2 },
	{ label: "E2", phase: "streaming", seq: 4 },
	{ label: "E3", phase: "streaming", seq: 4 },
	{ label: "E4", phase: "streaming", seq: 4 },
	{ label: "E5", phase: "awaiting_followup", seq: 15 },
	{ label: "E6", phase: "idle", seq: 2 }, // straggler
	{ label: "E7", phase: "idle", seq: 2 },
	{ label: "E8", phase: "idle", seq: 2 },
	{ label: "E9", phase: "idle", seq: 2 },
]

function replay(pushes: typeof PUSHES): ReplicaState {
	let s = createReplicaState()
	for (const p of pushes) {
		// The wire shape observed live: stateVersion=0, epoch=0, messages=[].
		s = applyStateSnapshot(s, [], 0, 0, { phase: p.phase as never, seq: p.seq })
	}
	return s
}

describe("C2 replay — RED through production reducer", () => {
	it("RED-1: idle/seq2 → streaming/seq4 advances the replica", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [], 0, 0, { phase: "idle", seq: 2 })
		s = applyStateSnapshot(s, [], 0, 0, { phase: "streaming", seq: 4 })
		expect(s.turnState?.phase).toBe("streaming")
		expect(s.turnState?.seq).toBe(4)
	})

	it("RED-2: idle/seq2 → awaiting_followup/seq15 advances the replica", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [], 0, 0, { phase: "idle", seq: 2 })
		s = applyStateSnapshot(s, [], 0, 0, { phase: "awaiting_followup", seq: 15 })
		expect(s.turnState?.phase).toBe("awaiting_followup")
		expect(s.turnState?.seq).toBe(15)
	})

	it("RED-3 (equal seq, newer phase): incoming replaces previous (production contract: applyTurnState uses <=, so equal seq is REJECTED)", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [], 0, 0, { phase: "idle", seq: 5 })
		s = applyStateSnapshot(s, [], 0, 0, { phase: "streaming", seq: 5 })
		// Frozen contract: `incoming.seq <= state.turnState.seq` is rejected.
		// Equal seq preserves previous — this is what stops a duplicate
		// postMessage from reverting the UI.
		expect(s.turnState?.phase).toBe("idle")
		expect(s.turnState?.seq).toBe(5)
	})

	it("RED-4 (older incoming): previous retained (production contract: monotonic rejection)", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [], 0, 0, { phase: "awaiting_followup", seq: 15 })
		s = applyStateSnapshot(s, [], 0, 0, { phase: "streaming", seq: 4 })
		expect(s.turnState?.phase).toBe("awaiting_followup")
		expect(s.turnState?.seq).toBe(15)
	})

	it("RED-5 (epoch boundary): new epoch + lower seq wholesale replaces (not subject to the seq gate)", () => {
		let s = createReplicaState()
		s = applyStateSnapshot(s, [], 0, 0, { phase: "awaiting_followup", seq: 15 })
		s = applyStateSnapshot(s, [], 1, 0, { phase: "streaming", seq: 1 })
		expect(s.turnState?.phase).toBe("streaming")
		expect(s.turnState?.seq).toBe(1)
		expect(s.epoch).toBe(1)
	})

	it("LIVE: exact E1-E9 sequence through the production reducer reaches awaiting_followup/seq15", () => {
		// This is the load-bearing witness. If this test passes, the
		// webview's seq-gated reducer is NOT the cause of the observed
		// mixed-generation state. The ACT's Outcome C applies and the
		// replica-repair slice is HALTED.
		const finalState = replay(PUSHES)
		expect(finalState.turnState?.phase).toBe("awaiting_followup")
		expect(finalState.turnState?.seq).toBe(15)
	})

	it("LIVE: per-push trace — every push where seq advances also advances the replica's turnState", () => {
		const trace: Array<{ label: string; phase: string | undefined; seq: number | undefined }> = []
		let s = createReplicaState()
		for (const p of PUSHES) {
			s = applyStateSnapshot(s, [], 0, 0, { phase: p.phase as never, seq: p.seq })
			trace.push({
				label: p.label,
				phase: s.turnState?.phase,
				seq: s.turnState?.seq,
			})
		}
		// After E1: idle/2; after E2: streaming/4; after E3: streaming/4 (duplicate);
		// after E4: streaming/4 (duplicate); after E5: awaiting_followup/15;
		// after E6-E9: awaiting_followup/15 (stragglers all rejected by seq gate).
		expect(trace[0]).toEqual({ label: "E1", phase: "idle", seq: 2 })
		expect(trace[1]).toEqual({ label: "E2", phase: "streaming", seq: 4 })
		expect(trace[2]).toEqual({ label: "E3", phase: "streaming", seq: 4 })
		expect(trace[3]).toEqual({ label: "E4", phase: "streaming", seq: 4 })
		expect(trace[4]).toEqual({ label: "E5", phase: "awaiting_followup", seq: 15 })
		expect(trace[5]).toEqual({ label: "E6", phase: "awaiting_followup", seq: 15 })
		expect(trace[6]).toEqual({ label: "E7", phase: "awaiting_followup", seq: 15 })
		expect(trace[7]).toEqual({ label: "E8", phase: "awaiting_followup", seq: 15 })
		expect(trace[8]).toEqual({ label: "E9", phase: "awaiting_followup", seq: 15 })
	})
})
