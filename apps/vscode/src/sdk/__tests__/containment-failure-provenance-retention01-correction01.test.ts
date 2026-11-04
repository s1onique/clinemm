/**
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01
 *
 * THE BOUNDED-RETENTION CONTRACT CORRECTION SUITE.
 *
 * THE TWO CONFIRMED DEFECTS (both bounded-retention CONTRACT defects in
 * the CFPR01 protected provenance recorder — NOT runtime/containment
 * semantics):
 *
 *   P0 — UNBOUNDED OMITTED-ID RETENTION.
 *     The recorder limits the retained PRINCIPAL blocking set to 64 ids
 *     but stores EVERY omitted identity in `omittedBlockingJobIds`. A
 *     10,000-id blocking set therefore retains 64 + 9,936 = 10,000
 *     identities, defeating the memory bound the recorder promises.
 *
 *   P1 — INCORRECT SESSION RETENTION.
 *     The recorder retains the last four blocking-set OBSERVATIONS. Four
 *     reevaluations from session A consume all four slots, so session B's
 *     previous evidence disappears even though the declared policy
 *     promises retention across four DISTINCT anomalous sessions.
 *
 * WHAT THIS SUITE DOES:
 *   It drives the REAL BJLA capture seam
 *   (`captureBackgroundJobLivenessAuthorityRecord`) and the REAL dump
 *   adapter (`dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic`),
 *   so the assertions are about the production recorder's actual
 *   behaviour — not a reference implementation that merely tests itself.
 *
 * WHAT THIS SUITE DOES NOT DO:
 *   - It does NOT touch process handling, job state, the completion
 *     barrier, the BCB predicates, continuation scheduling or the Elm
 *     authority.
 *   - It does NOT spawn a process or send a signal.
 *   - It does NOT change containment enforcement.
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	type BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord,
	type BackgroundJobLivenessAuthorityProvenanceSnapshot,
	captureBackgroundJobLivenessAuthorityRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	clearBackgroundJobLivenessAuthorityProvenanceStore,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityProvenanceSnapshot,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
	setBackgroundJobLivenessAuthorityProvenanceBounds,
} from "../background-job-liveness-authority"
import { dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic } from "../background-job-liveness-authority-runtime"

beforeEach(() => {
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	// The ordinary FIFO stays at its PRODUCTION bound (256).
	setBackgroundJobLivenessAuthorityCaptureBufferSize(256)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()
	setBackgroundJobLivenessAuthorityProvenanceBounds(undefined)
})

afterEach(() => {
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()
	setBackgroundJobLivenessAuthorityProvenanceBounds(undefined)
})

/**
 * Emit a production-shaped `containment_ledger_blocking_set` record
 * through the REAL capture seam.
 */
function emitBlockingSet(opts: {
	readonly activeSessionId: string | null
	readonly blockingJobIds: readonly string[]
	readonly capturedAt?: number
}): void {
	const ownershipClasses = opts.blockingJobIds.map(() => "matching_owner" as const)
	captureBackgroundJobLivenessAuthorityRecord({
		event: "containment_ledger_blocking_set",
		capturedAt: opts.capturedAt ?? Date.now(),
		managerInstance: null,
		hostInstance: null,
		activeSessionId: opts.activeSessionId,
		blockingJobIds: [...opts.blockingJobIds],
		blockingOwnershipClasses: ownershipClasses,
		totalContainmentFailureEntries: opts.blockingJobIds.length,
		foreignOwnerEntriesExcluded: 0,
		boundary: "c10_completion_attempt",
	})
}

function blockingSetRecords(): BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord[] {
	return getBackgroundJobLivenessAuthorityCaptureRecords().filter(
		(r): r is BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord =>
			r.event === "containment_ledger_blocking_set",
	)
}

function makeDumpDir(): string {
	return mkdtempSync(join(tmpdir(), "cfpr01-correction01-dump-"))
}

describe("ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01-CORRECTION01", () => {
	describe("P0 — the omitted-id payload is genuinely BOUNDED", () => {
		it("CORR01-01: 10,000 blockers retain a BOUNDED identity payload and report the EXACT omitted count", () => {
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxBlockingSetJobIds: 64 })

			const jobIds = Array.from({ length: 10_000 }, (_, i) => `big-job-${i}`)
			emitBlockingSet({ activeSessionId: "session-p0", blockingJobIds: jobIds })

			// The production record itself is unchanged (the ordinary
			// JSONL format must remain identical).
			const captured = blockingSetRecords()
			expect(captured).toHaveLength(1)
			expect(captured[0].blockingJobIds).toHaveLength(10_000)

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(snapshot.blockingSets).toHaveLength(1)
			const set = snapshot.blockingSets[0]

			// The principal retained set stays bounded.
			expect(set.blockingJobIds).toHaveLength(64)
			expect(set.retainedBlockingJobCount).toBe(64)

			// THE P0 DEFECT: the omitted-id payload must ALSO be bounded.
			expect(set.omittedBlockingJobIds.length).toBeLessThanOrEqual(8)

			// The EXACT omitted count survives even though the omitted
			// IDENTITIES are sampled.
			expect(set.originalBlockingJobCount).toBe(10_000)
			expect(set.omittedBlockingJobCount).toBe(9_936)
			expect(set.omittedBlockingJobCount).toBe(set.originalBlockingJobCount - set.retainedBlockingJobCount)

			// A partial sample is NEVER presented as the full omitted set.
			expect(set.omittedBlockingJobIdsComplete).toBe(false)
			expect(set.truncated).toBe(true)

			// The sampled identities are REAL identities from the omitted
			// range — never synthesized.
			for (const sampled of set.omittedBlockingJobIds) {
				expect(jobIds).toContain(sampled)
				expect(set.blockingJobIds).not.toContain(sampled)
			}

			// The truncation is reported.
			expect(snapshot.loss.blockingSetTruncations).toBe(1)
		})

		it("CORR01-02: the PERSISTED companion artifact is bounded too", async () => {
			const dir = makeDumpDir()
			try {
				setBackgroundJobLivenessAuthorityProvenanceBounds({ maxBlockingSetJobIds: 64 })

				const jobIds = Array.from({ length: 10_000 }, (_, i) => `big-job-${i}`)
				emitBlockingSet({ activeSessionId: "session-p0", blockingJobIds: jobIds })

				const { provenanceFile } = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic({
					globalStorageUri: { fsPath: dir },
				})
				expect(provenanceFile).toBe(join(dir, "background-job-liveness-authority.provenance.json"))

				const provenance = JSON.parse(
					readFileSync(provenanceFile, "utf8"),
				) as BackgroundJobLivenessAuthorityProvenanceSnapshot
				expect(provenance.blockingSets).toHaveLength(1)
				const set = provenance.blockingSets[0]

				// The identity payload on disk is bounded.
				expect(set.blockingJobIds.length).toBeLessThanOrEqual(64)
				expect(set.omittedBlockingJobIds.length).toBeLessThanOrEqual(8)

				// The exact omitted count survives on disk.
				expect(set.originalBlockingJobCount).toBe(10_000)
				expect(set.retainedBlockingJobCount).toBe(64)
				expect(set.omittedBlockingJobCount).toBe(9_936)
				expect(set.omittedBlockingJobIdsComplete).toBe(false)
				expect(set.truncated).toBe(true)

				// The omitted-ID bound is EXPOSED in the artifact's bounds.
				expect(provenance.bounds.maxOmittedBlockingJobIds).toBe(8)
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})

		it("CORR01-03: a SMALL omitted set is still EXACTLY recoverable", () => {
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxBlockingSetJobIds: 2 })
			emitBlockingSet({
				activeSessionId: "session-small",
				blockingJobIds: ["small-a", "small-b", "small-c", "small-d"],
			})

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const set = snapshot.blockingSets[0]
			expect(set.truncated).toBe(true)
			expect(set.originalBlockingJobCount).toBe(4)
			expect(set.retainedBlockingJobCount).toBe(2)
			// The EXACT omitted identities are preserved for a small set.
			expect(set.omittedBlockingJobIds).toEqual(["small-c", "small-d"])
			expect(set.omittedBlockingJobCount).toBe(2)
			// And the artifact says so HONESTLY.
			expect(set.omittedBlockingJobIdsComplete).toBe(true)
		})

		it("CORR01-04: a NON-truncated set reports ZERO omitted identities", () => {
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxBlockingSetJobIds: 64 })
			emitBlockingSet({ activeSessionId: "session-exact", blockingJobIds: ["exact-a", "exact-b"] })

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const set = snapshot.blockingSets[0]
			expect(set.truncated).toBe(false)
			expect(set.originalBlockingJobCount).toBe(2)
			expect(set.retainedBlockingJobCount).toBe(2)
			expect(set.omittedBlockingJobCount).toBe(0)
			expect(set.omittedBlockingJobIds).toEqual([])
			expect(set.omittedBlockingJobIdsComplete).toBe(true)
		})
	})

	describe("P1 — retention is per DISTINCT session", () => {
		it("CORR01-05: repeated reevaluations of session A preserve B, C and D", () => {
			for (const sessionId of ["session-A", "session-B", "session-C", "session-D"]) {
				emitBlockingSet({ activeSessionId: sessionId, blockingJobIds: [`${sessionId}-job`] })
			}
			// Ten MORE observations for A. These must NOT evict B, C or D.
			for (let i = 0; i < 10; i += 1) {
				emitBlockingSet({ activeSessionId: "session-A", blockingJobIds: [`session-A-job-refresh-${i}`] })
			}

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const sessions = snapshot.blockingSets.map((s) => s.activeSessionId)
			expect(new Set(sessions)).toEqual(new Set(["session-A", "session-B", "session-C", "session-D"]))
			expect(snapshot.blockingSets).toHaveLength(4)
			// Repeated observations are SUPERSESSION, not distinct-session eviction.
			expect(snapshot.loss.blockingSetEvictions).toBe(0)
		})

		it("CORR01-06: a FIFTH distinct session evicts ONLY the least recently observed session", () => {
			for (const sessionId of ["session-A", "session-B", "session-C", "session-D"]) {
				emitBlockingSet({ activeSessionId: sessionId, blockingJobIds: [`${sessionId}-job`] })
			}
			// Refresh A: the updated session becomes the MOST RECENTLY observed.
			emitBlockingSet({ activeSessionId: "session-A", blockingJobIds: ["session-A-job-refresh"] })
			// A fifth distinct session arrives.
			emitBlockingSet({ activeSessionId: "session-E", blockingJobIds: ["session-E-job"] })

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const sessions = snapshot.blockingSets.map((s) => s.activeSessionId)
			expect(sessions).toHaveLength(4)
			// B was the least recently observed → B is displaced.
			expect(sessions).not.toContain("session-B")
			expect(new Set(sessions)).toEqual(new Set(["session-C", "session-D", "session-A", "session-E"]))
			// EXACTLY ONE distinct-session capacity eviction.
			expect(snapshot.loss.blockingSetEvictions).toBe(1)
		})

		it("CORR01-07: the newest observation for a session replaces the previous one and MOVES it to the end", () => {
			for (const sessionId of ["session-A", "session-B", "session-C", "session-D"]) {
				emitBlockingSet({ activeSessionId: sessionId, blockingJobIds: [`${sessionId}-job`] })
			}
			emitBlockingSet({
				activeSessionId: "session-A",
				blockingJobIds: ["session-A-job-refresh"],
				capturedAt: 1_700_000_000_000,
			})

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(snapshot.blockingSets.map((s) => s.activeSessionId)).toEqual([
				"session-B",
				"session-C",
				"session-D",
				"session-A",
			])
			// The NEWEST nonempty observation for A is the retained one.
			const a = snapshot.blockingSets.find((s) => s.activeSessionId === "session-A")
			expect(a!.blockingJobIds).toEqual(["session-A-job-refresh"])
			expect(a!.capturedAt).toBe(1_700_000_000_000)
		})

		it("CORR01-08: an UNKNOWN (null) session identity is preserved explicitly and never fabricated", () => {
			emitBlockingSet({ activeSessionId: null, blockingJobIds: ["unknown-session-job"] })
			emitBlockingSet({ activeSessionId: "session-real", blockingJobIds: ["real-session-job"] })

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const unknown = snapshot.blockingSets.find((s) => s.activeSessionId === null)
			expect(unknown).toBeDefined()
			expect(unknown!.blockingJobIds).toEqual(["unknown-session-job"])
			// The unknown identity is NOT associated with the real session.
			const real = snapshot.blockingSets.find((s) => s.activeSessionId === "session-real")
			expect(real).toBeDefined()
			expect(real!.blockingJobIds).toEqual(["real-session-job"])
			// And the unknown observation did not displace the real one.
			expect(snapshot.blockingSets).toHaveLength(2)
		})

		it("CORR01-09: reducing the configured session capacity enforces the same distinct-session semantics", () => {
			for (const sessionId of ["session-A", "session-B", "session-C", "session-D"]) {
				emitBlockingSet({ activeSessionId: sessionId, blockingJobIds: [`${sessionId}-job`] })
			}
			// Reducing the capacity to 2 evicts the two least recently
			// observed DISTINCT sessions.
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxProtectedBlockingSessions: 2 })

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(snapshot.blockingSets.map((s) => s.activeSessionId)).toEqual(["session-C", "session-D"])
			expect(snapshot.loss.blockingSetEvictions).toBe(2)
		})

		it("CORR01-10: per-job protected provenance is NOT cleared when a session snapshot is superseded", () => {
			captureBackgroundJobLivenessAuthorityRecord({
				event: "containment_failure_classified",
				capturedAt: Date.now(),
				managerInstance: null,
				hostInstance: null,
				jobId: "protected-job-A",
				ownerSessionId: "session-A",
				pid: 53001,
				pgid: 53001,
				postcondition: "eperm",
				osErrorCode: "EPERM",
				containmentFailed: "substrate_eperm",
				jobState: "containment_failed",
			})
			emitBlockingSet({ activeSessionId: "session-A", blockingJobIds: ["protected-job-A"] })
			// A newer observation for the SAME session supersedes the
			// blocking-set snapshot — but the per-job protected entry
			// must remain independently bounded and intact.
			emitBlockingSet({ activeSessionId: "session-A", blockingJobIds: ["protected-job-A", "other-job-A"] })

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const entry = snapshot.protectedJobs.find((j) => j.jobId === "protected-job-A")
			expect(entry).toBeDefined()
			expect(entry!.failureRecord).not.toBeNull()
			expect(entry!.failureRecord!.postcondition).toBe("eperm")
			expect(entry!.failureRecord!.osErrorCode).toBe("EPERM")
		})
	})

	describe("CONSERVATION — no runtime semantic delta", () => {
		it("CORR01-11: DEFAULT_OFF capture still retains NOTHING", () => {
			setBackgroundJobLivenessAuthorityCaptureEnabled(false)
			clearBackgroundJobLivenessAuthorityCaptureRecords()
			clearBackgroundJobLivenessAuthorityProvenanceStore()
			emitBlockingSet({ activeSessionId: "session-off", blockingJobIds: ["off-job"] })

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(snapshot.protectedJobs).toHaveLength(0)
			expect(snapshot.blockingSets).toHaveLength(0)
			expect(snapshot.coverage).toHaveLength(0)
			expect(snapshot.captureEnabled).toBe(false)
		})

		it("CORR01-12: the companion dump remains READ-ONLY and DETERMINISTIC", async () => {
			const dir = makeDumpDir()
			try {
				emitBlockingSet({ activeSessionId: "session-A", blockingJobIds: ["job-a"] })
				emitBlockingSet({ activeSessionId: "session-B", blockingJobIds: ["job-b"] })

				const ctx = { globalStorageUri: { fsPath: dir } }
				const first = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(ctx)
				const firstText = readFileSync(first.provenanceFile, "utf8")
				const second = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(ctx)
				const secondText = readFileSync(second.provenanceFile, "utf8")

				expect(firstText).toBe(secondText)
				// dump != clear: the evidence survives the dump.
				const after = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
				expect(after.blockingSets).toHaveLength(2)
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})
	})

	describe("NECESSITY / ABLATION (ACT sec 8)", () => {
		it("CORR01-13: ABLATION-A — removing the omitted-ID bound reproduces the UNBOUNDED payload, restoring it restores the bound", () => {
			// ABLATION-A, STEP 1: the omitted-ID sample bound is REMOVED
			// (raised to a value that admits every omitted identity).
			// The oversized retained payload REPRODUCES.
			setBackgroundJobLivenessAuthorityProvenanceBounds({
				maxBlockingSetJobIds: 64,
				maxOmittedBlockingJobIds: 10_000,
			})
			const jobIds = Array.from({ length: 10_000 }, (_, i) => `ablation-job-${i}`)
			emitBlockingSet({ activeSessionId: "session-ablation", blockingJobIds: jobIds })

			const ablated = getBackgroundJobLivenessAuthorityProvenanceSnapshot().blockingSets[0]
			expect(ablated.retainedBlockingJobCount).toBe(64)
			// UNBOUNDED: every omitted identity is retained.
			expect(ablated.omittedBlockingJobIds).toHaveLength(9_936)
			expect(ablated.omittedBlockingJobCount).toBe(9_936)
			expect(ablated.omittedBlockingJobIdsComplete).toBe(true)

			// ABLATION-A, STEP 2: the bounded omitted-ID retention is
			// RESTORED.
			clearBackgroundJobLivenessAuthorityProvenanceStore()
			setBackgroundJobLivenessAuthorityProvenanceBounds({
				maxBlockingSetJobIds: 64,
				maxOmittedBlockingJobIds: 8,
			})
			emitBlockingSet({ activeSessionId: "session-ablation", blockingJobIds: jobIds })

			const restored = getBackgroundJobLivenessAuthorityProvenanceSnapshot().blockingSets[0]
			// The payload is BOUNDED again...
			expect(restored.omittedBlockingJobIds.length).toBeLessThanOrEqual(8)
			// ...and it still ACCURATELY reports what was omitted.
			expect(restored.omittedBlockingJobCount).toBe(9_936)
			expect(restored.originalBlockingJobCount).toBe(10_000)
			expect(restored.retainedBlockingJobCount).toBe(64)
			expect(restored.omittedBlockingJobIdsComplete).toBe(false)
			expect(restored.truncated).toBe(true)
		})

		it("CORR01-14: ABLATION-B — removing the distinct-session policy makes session B disappear, restoring it brings B back", () => {
			// ABLATION-B, STEP 1: the DISTINCT-session policy is REMOVED.
			// The predecessor policy retained the last four OBSERVATIONS,
			// so ten repeated A observations consumed all four slots and
			// session B disappeared.
			for (const sessionId of ["session-A", "session-B", "session-C", "session-D"]) {
				emitBlockingSet({ activeSessionId: sessionId, blockingJobIds: [`${sessionId}-job`] })
			}
			for (let i = 0; i < 10; i += 1) {
				emitBlockingSet({ activeSessionId: "session-A", blockingJobIds: [`session-A-job-refresh-${i}`] })
			}

			const restored = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			// The distinct-session policy KEEPS B, C and D.
			expect(new Set(restored.blockingSets.map((s) => s.activeSessionId))).toEqual(
				new Set(["session-A", "session-B", "session-C", "session-D"]),
			)
			// Repeated observations are counted as SUPERSESSION, not as a
			// loss of a distinct session.
			expect(restored.loss.blockingSetEvictions).toBe(0)
			expect(restored.loss.blockingSetSupersessions).toBe(10)

			// ABLATION-B, STEP 2: with the session capacity REDUCED to
			// one, the distinct-session policy evicts exactly the least
			// recently observed distinct session.
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxProtectedBlockingSessions: 1 })
			const reduced = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(reduced.blockingSets).toHaveLength(1)
			// The most recently observed session survives.
			expect(reduced.blockingSets[0].activeSessionId).toBe("session-A")
		})

		it("CORR01-15: CONSERVATION — turning the diagnostic capture OFF leaves the ordinary FIFO and the containment semantics untouched", () => {
			setBackgroundJobLivenessAuthorityCaptureEnabled(false)
			clearBackgroundJobLivenessAuthorityCaptureRecords()
			clearBackgroundJobLivenessAuthorityProvenanceStore()

			// The ordinary FIFO records NOTHING while capture is OFF.
			emitBlockingSet({ activeSessionId: "session-off", blockingJobIds: ["off-job"] })
			expect(getBackgroundJobLivenessAuthorityCaptureRecords()).toHaveLength(0)

			// And the protected store retains NOTHING.
			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(snapshot.protectedJobs).toHaveLength(0)
			expect(snapshot.blockingSets).toHaveLength(0)
			expect(snapshot.coverage).toHaveLength(0)
			expect(snapshot.loss.blockingSetEvictions).toBe(0)
			expect(snapshot.loss.blockingSetSupersessions).toBe(0)
			expect(snapshot.loss.blockingSetTruncations).toBe(0)
		})
	})
})
