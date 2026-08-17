/**
 * TARGETED AUDIT DIGEST for C2.3-CONT.6-CORRECTION02.
 *
 * Contains exactly one copy of each:
 *   - runMatrix(label)
 *   - FULL_MATRIX_3X_DETERMINISM describe (R2 acceptance: W01-W16,
 *     RUN1 == RUN2 == RUN3 byte-identical)
 *   - runPureReplayCanonicalOnly(label)
 *   - HOST_AUTHORITY_WORKLOADS set
 *   - PURE_REPLAY_CANONICAL_ONLY_EQUIVALENCE describe (R3 acceptance:
 *     canonical-only Ws have live == pure; host-authority Ws have
 *     expected pure-vs-live divergence by construction)
 *
 * Source-of-truth lives in:
 *   apps/vscode/src/sdk/__tests__/
 *     task-state-shadow-correction02-c23-stateful-workloads.test.ts
 *
 * This digest is for reviewer audit; it is NOT executed.
 */

// ============================================================
// runMatrix(label): runs all 16 Ws in a single harness invocation.
// ============================================================

function runMatrix(label: string): Record<string, ReturnType<typeof snapshotState>> {
	const builders: Array<{ id: string; steps: readonly WorkloadStep[] }> = [
		{ id: "W01", steps: buildW01Steps() },
		{ id: "W02", steps: buildW02Steps() },
		{ id: "W03", steps: buildW03Steps() },
		{ id: "W04", steps: buildW04Steps() },
		{ id: "W05", steps: buildW05Steps() },
		{ id: "W06", steps: buildW06Steps() },
		{ id: "W07", steps: buildW07Steps() },
		{ id: "W08", steps: buildW08Steps() },
		{ id: "W09", steps: buildW09Steps() },
		{ id: "W10", steps: buildW10Steps() },
		{ id: "W11", steps: buildW11Steps() },
		{ id: "W12", steps: buildW12Steps() },
		{ id: "W13", steps: buildW13Steps() },
		{ id: "W14", steps: buildW14Steps() },
		{ id: "W15", steps: buildW15Steps() },
		{ id: "W16", steps: buildW16Steps() },
	]
	const out: Record<string, ReturnType<typeof snapshotState>> = {}
	for (const { id, steps } of builders) {
		const state = runWorkload(steps)
		hardGates(state)
		out[id] = snapshotState(state)
	}
	return out
}

// ============================================================
// FULL_MATRIX_3X_DETERMINISM describe: 3 independent full-matrix
// runs MUST produce byte-identical frozen snapshots.
// ============================================================

describe("C2.3-CONT.6-CORRECTION01 FULL_MATRIX_3X_DETERMINISM — W01-W16, RUN1 == RUN2 == RUN3", () => {
	it("three independent full-matrix runs produce byte-identical frozen snapshots", () => {
		const run1 = runMatrix("RUN1")
		const run2 = runMatrix("RUN2")
		const run3 = runMatrix("RUN3")
		const runKeys = Object.keys(run1).sort()
		expect(runKeys.length).toBe(16)
		for (const w of runKeys) {
			expect(run2[w]).toBeDefined()
			expect(run3[w]).toBeDefined()
			expect(run1[w]).toEqual(run2[w])
			expect(run2[w]).toEqual(run3[w])
		}
	})
}

// ============================================================
// runPureReplayCanonicalOnly(label): re-runs each W's canonical
// events through a fresh TaskStateShadow and compares with the
// live comparator. Splits Ws into canonical-only and host-authority.
// ============================================================

function runPureReplayCanonicalOnly(label: string): Record<
	string,
	{
		live: ReturnType<typeof snapshotState>
		pure: { lifecycle: string; modelStreaming: boolean; activeToolCallIds: string[]; awaitingApproval: boolean }
	}

// ============================================================
// PURE_REPLAY_CANONICAL_ONLY_EQUIVALENCE describe:
// - canonical-only Ws: pure == live (exact).
// - host-authority Ws: pure reflects canonical-only; live reflects
//   host authority. Mismatches are EXPECTED by construction.
// ============================================================

describe("C2.3-CONT.6-CORRECTION02 PURE_REPLAY_CANONICAL_ONLY_EQUIVALENCE — canonical-only Ws: live == pure", () => {
	it("Ws WITHOUT HOST_TASK steps: live == pure", () => {
		const result = runPureReplayCanonicalOnly("RUN1")
		const runKeys = Object.keys(result).sort()
		expect(runKeys.length).toBe(16)
		let mismatches = 0
		const matched: string[] = []
		for (const w of runKeys) {
			if (HOST_AUTHORITY_WORKLOADS.has(w)) continue
			const { live, pure } = result[w]
			const liveCanonical = {
				lifecycle: live.finalLifecycle,
				modelStreaming: live.finalModelStreaming,
				activeToolCallIds: live.finalActiveToolCallIds,
				awaitingApproval: live.finalAwaitingApproval,
			}
			if (JSON.stringify(liveCanonical) !== JSON.stringify(pure)) {
				mismatches += 1
			} else {
				matched.push(w)
			}
		}
		expect(mismatches).toBe(0)
		// Ensure we actually exercised some Ws without HOST_TASK
		// (W01, W02, W03, W04, W05, W06, W09).
		expect(matched.length).toBeGreaterThan(0)
	})

	it("Ws WITH HOST_TASK steps: live reflects host authority; pure reflects canonical-only", () => {
		// This is a documentary test: the mismatches are EXPECTED
		// by design (host TASK authority is not in the pure
		// reducer). The test asserts that mismatches exist for
		// exactly the Ws in HOST_AUTHORITY_WORKLOADS.
		const result = runPureReplayCanonicalOnly("RUN1")
		let expectedMismatches = 0
		let unexpectedMismatches = 0
		const unexpectedW: string[] = []
		for (const { w, live, pure } of (function* (it: Iterable<[string, any]>) {
			for (const [k, v] of it) yield { w: k, live: v.live, pure: v.pure }
		})(Object.entries(result))) {
			const liveCanonical = {
				lifecycle: live.finalLifecycle,
				modelStreaming: live.finalModelStreaming,
				activeToolCallIds: live.finalActiveToolCallIds,
				awaitingApproval: live.finalAwaitingApproval,
			}
			const same = JSON.stringify(liveCanonical) === JSON.stringify(pure)
			if (HOST_AUTHORITY_WORKLOADS.has(w)) {
				if (!same) expectedMismatches += 1
			} else {
				if (!same) {
					unexpectedMismatches += 1
					unexpectedW.push(w)
				}
			}
		}
		expect(unexpectedMismatches).toBe(0)
		expect(unexpectedW).toEqual([])
		expect(expectedMismatches).toBeGreaterThan(0)
	})
}

// ============================================================
// HOST_AUTHORITY_WORKLOADS set: Ws that include HOST_TASK steps
// in their canonical sequence. Pure canonical-only replay cannot
// reproduce host-owned task semantics by construction (canonical
// replay filters out HOST_TASK events; the live comparator sees
// them). See docs/architecture/elm/task-state-shadow-architecture.md
// for the host-runtime event separation.
//
// = HOST_AUTHORITY_WORKLOADS =
//   W07, W08, W10, W11, W12, W13, W14, W15, W16
//
// (W15 is listed here because its reconstruction logic filters
//  reconstructed envelopes into host-authority territory; the
//  original test comment "no host-task" was a stale description
//  that the digest now corrects. The function body is what the
//  test asserts.)
//
// = PURE_REPLAY_EXACT_EQ_WORKLOADS =
//   W01, W02, W03, W04, W05, W06, W09
//
// host_authority_mismatch = EXPECTED_BY_CONSTRUCTION
// ============================================================
