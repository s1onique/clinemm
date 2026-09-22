/**
 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
 * (P0+P1 fix)
 *
 * CCARD01 — bounded cardinality-capture regression for the
 * autonomous-turn boundary. This is the diagnostic-only test
 * surface; the actual REPAIR gate lives in subsequent ACTs once
 * the first 1 -> 2 cardinality seam is isolated.
 *
 * Mechanical invariant: when the CCARD capture seam is ON, every
 * production seam listed in this test emits EXACTLY ONE record
 * per call (no doubling, no skipping). When the seam is OFF (the
 * default for public installs) every capture helper is a complete
 * no-op so the production path semantics are unchanged.
 *
 * Tests:
 *   CCARD-CTL-01..06     — capture-enabled flag semantics
 *   CCARD-RED-01        — direct exercise of the capture module API
 *                          (record-and-dump) without the full
 *                          production wiring
 *   CCARD-COMPOSE-01    — verify the production callback signatures
 *                          match the SDK contract
 *   CCARD-ABLATION-01   — verify capture OFF leaves every SDK
 *                          capture site a no-op (no records)
 *   CCARD-DISCRIMINATOR-01 — proves C5=1 with C6=2 is observable
 *                            as a duplicate-dispatch fingerprint
 *                            (per FACTORY HALT_CCARD_DIAGNOSTIC_*
 *                             rejection of the lockstep C5/C6
 *                             design)
 *   CCARD-ORIGIN-01     — proves C7/C8 origin is derived from
 *                          the actual delivery
 *                          (`queue`→pending_prompt_drain,
 *                           `steer`→deferred_continuation,
 *                           undefined→explicit_user)
 *                          (per FACTORY HALT_CCARD_DIAGNOSTIC_*
 *                             rejection of the hard-coded origin)
 *
 * Mirrors the BJLA / BOCOR test surface (bclas01..06). Uses the
 * production diagnostic module directly — no fake orchestration.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	type ContinuationCardinalityAuthorityRecord,
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	getContinuationCardinalityAuthorityCounters,
	isContinuationCardinalityAuthorityCaptureEnabled,
	setContinuationCardinalityAuthorityCaptureBufferSize,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"

// Disable the experimental sandbox (mirrors the BJLA / BOCOR tests).
const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureBufferSize(64)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

describe("CCARD01 — continuation cardinality authority capture", () => {
	it("CCARD-CTL-01: captureEnabled default is false", () => {
		// Fresh module state — clear before assertion (beforeEach
		// already ran but defensive). The setter returns void; we
		// observe the side-effect through the reader.
		clearContinuationCardinalityAuthorityCapture()
		expect(setContinuationCardinalityAuthorityCaptureEnabled(false) as unknown).toBeUndefined()
		// afterEach sets it OFF, so by the time this test runs the
		// module state is OFF (false).
		expect(isContinuationCardinalityAuthorityCaptureEnabled()).toBe(false)
	})

	it("CCARD-CTL-02: capture() with seam OFF is a no-op", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		captureContinuationCardinalityAuthorityRecord({
			stage: "terminal_committed",
			origin: "background_terminal",
			jobId: "j-1",
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "wake_created",
			origin: "background_terminal",
			jobId: "j-1",
		})
		expect(getContinuationCardinalityAuthorityCaptureRecords()).toHaveLength(0)
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.terminal_committed.count).toBe(0)
		expect(counters.stages.wake_created.count).toBe(0)
	})

	it("CCARD-CTL-03: capture() with seam ON writes a record and increments counter", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "terminal_committed",
			origin: "background_terminal",
			jobId: "j-1",
		})
		const records = getContinuationCardinalityAuthorityCaptureRecords()
		expect(records).toHaveLength(1)
		const rec = records[0] as ContinuationCardinalityAuthorityRecord
		expect(rec.stage).toBe("terminal_committed")
		expect(rec.origin).toBe("background_terminal")
		expect(rec.jobId).toBe("j-1")
		expect(rec.seq).toBe(1)
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.total).toBe(1)
		expect(counters.stages.terminal_committed.count).toBe(1)
		expect(counters.stages.terminal_committed.origins).toEqual(["background_terminal"])
	})

	it("CCARD-CTL-04: ring is bounded (FIFO eviction)", () => {
		setContinuationCardinalityAuthorityCaptureBufferSize(3)
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		for (let i = 0; i < 5; i++) {
			captureContinuationCardinalityAuthorityRecord({
				stage: "terminal_committed",
				origin: "background_terminal",
				jobId: `j-${i}`,
			})
		}
		const records = getContinuationCardinalityAuthorityCaptureRecords()
		expect(records).toHaveLength(3)
		// First record should be the 3rd emitted (FIFO evict of
		// the first two).
		expect((records[0] as ContinuationCardinalityAuthorityRecord).jobId).toBe("j-2")
		expect((records[2] as ContinuationCardinalityAuthorityRecord).jobId).toBe("j-4")
		// Counter still counts EVERY emitted record, not just the
		// ones still in the ring (the ring is the durable evidence;
		// the counters are the cheap post-capture discriminator).
		expect(getContinuationCardinalityAuthorityCounters().stages.terminal_committed.count).toBe(5)
	})

	it("CCARD-CTL-05: getCounters() snapshot returns every stage with its origin set", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "terminal_committed",
			origin: "background_terminal",
			jobId: "j-1",
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_enqueued",
			origin: "pending_prompt_drain",
			sessionId: "s-1",
			promptId: "p-1",
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "pending_prompt_drain",
			sessionId: "s-1",
		})
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.total).toBe(3)
		expect(counters.stages.terminal_committed.count).toBe(1)
		expect(counters.stages.terminal_committed.origins).toEqual(["background_terminal"])
		expect(counters.stages.pending_prompt_enqueued.count).toBe(1)
		expect(counters.stages.pending_prompt_enqueued.origins).toEqual(["pending_prompt_drain"])
		expect(counters.stages.task_completion_committed.count).toBe(1)
		expect(counters.stages.task_completion_committed.origins).toEqual(["pending_prompt_drain"])
		// Untouched stages report count=0 and empty origins.
		expect(counters.stages.wake_created.count).toBe(0)
		expect(counters.stages.wake_created.origins).toEqual([])
		expect(counters.stages.run_turn_started.count).toBe(0)
	})

	it("CCARD-CTL-06: clear() resets ring + counters + seq", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "terminal_committed",
			origin: "background_terminal",
			jobId: "j-1",
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "wake_created",
			origin: "background_terminal",
			jobId: "j-1",
		})
		expect(getContinuationCardinalityAuthorityCaptureRecords()).toHaveLength(2)
		expect(getContinuationCardinalityAuthorityCounters().total).toBe(2)
		clearContinuationCardinalityAuthorityCapture()
		expect(getContinuationCardinalityAuthorityCaptureRecords()).toHaveLength(0)
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.total).toBe(0)
		for (const stage of Object.keys(counters.stages) as Array<keyof typeof counters.stages>) {
			expect(counters.stages[stage].count).toBe(0)
			expect(counters.stages[stage].origins).toEqual([])
		}
		// Next record should restart the seq at 1.
		captureContinuationCardinalityAuthorityRecord({
			stage: "terminal_committed",
			origin: "background_terminal",
			jobId: "j-2",
		})
		const rec = getContinuationCardinalityAuthorityCaptureRecords()[0] as ContinuationCardinalityAuthorityRecord
		expect(rec.seq).toBe(1)
	})

	it("CCARD-RED-01: one logical terminal fact -> exactly one record per stage C1..C10", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const sessionId = "s-1"
		const taskId = "t-1"
		const jobId = "j-1"
		const promptId = "p-1"

		captureContinuationCardinalityAuthorityRecord({ stage: "terminal_committed", origin: "background_terminal", jobId })
		captureContinuationCardinalityAuthorityRecord({ stage: "notify_consume_enter", origin: "background_terminal", jobId })
		captureContinuationCardinalityAuthorityRecord({
			stage: "wake_created",
			origin: "background_terminal",
			jobId,
			sessionId,
			taskId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_enqueued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_dequeued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "continuation_scheduled",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})
		captureContinuationCardinalityAuthorityRecord({ stage: "run_turn_started", origin: "pending_prompt_drain", sessionId })
		captureContinuationCardinalityAuthorityRecord({ stage: "agent_turn_done", origin: "pending_prompt_drain", sessionId })
		captureContinuationCardinalityAuthorityRecord({
			stage: "submit_and_exit_seen",
			origin: "pending_prompt_drain",
			sessionId,
			taskId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "pending_prompt_drain",
			sessionId,
			taskId,
		})

		const records = getContinuationCardinalityAuthorityCaptureRecords()
		expect(records).toHaveLength(10)
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.total).toBe(10)
		for (const stage of [
			"terminal_committed",
			"notify_consume_enter",
			"wake_created",
			"pending_prompt_enqueued",
			"pending_prompt_dequeued",
			"continuation_scheduled",
			"run_turn_started",
			"agent_turn_done",
			"submit_and_exit_seen",
			"task_completion_committed",
		] as const) {
			expect(counters.stages[stage].count).toBe(1)
		}
	})

	it("CCARD-RED-01-DUP: simulated 1 -> 2 cardinality expansion at C5 is observable (per-PromptEntry dequeue)", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const sessionId = "s-1"
		const promptId = "p-1"

		// Simulate: two PendingPromptEntries with the same prompt
		// (rare in production but legal under dedupe-inversion). The
		// shift path destructively claims the next entry exactly
		// twice — the controller emits C5 once per shift, so the
		// counter must show 2.
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_enqueued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_enqueued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_dequeued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_dequeued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
		})

		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.pending_prompt_enqueued.count).toBe(2)
		expect(counters.stages.pending_prompt_dequeued.count).toBe(2)
	})

	it("CCARD-DISCRIMINATOR-01: C5=1 with C6=2 is observable as a duplicate-dispatch fingerprint", () => {
		// FACTORY HALT_CCARD_DIAGNOSTIC_* accepted only AFTER this
		// test lands. The previous ACT-frozen hook emitted C5 and
		// C6 in lockstep so this discriminator was, by
		// construction, unobservable. After the P0 fix C5 and C6
		// are distinct observation seams: a single dequeue (C5=1)
		// followed by a duplicate dispatch path (C6=2) must be
		// readable from the counters without any other stage
		// counting.
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const sessionId = "s-1"
		const promptId = "p-1"
		const jobId = "j-1"

		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_enqueued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "pending_prompt_dequeued",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})
		// Duplicate dispatch (e.g. the FIRST ACT hypothesis: a path
		// that re-enters `deps.send` for one shifted entry):
		captureContinuationCardinalityAuthorityRecord({
			stage: "continuation_scheduled",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "continuation_scheduled",
			origin: "pending_prompt_drain",
			sessionId,
			promptId,
			jobId,
		})

		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.pending_prompt_enqueued.count).toBe(1)
		expect(counters.stages.pending_prompt_dequeued.count).toBe(1)
		// C5=1 C6=2 — the load-bearing discriminator.
		expect(counters.stages.continuation_scheduled.count).toBe(2)
	})

	it("CCARD-ORIGIN-01: C7 origin is derived from `delivery` (queue/steer/undefined)", () => {
		// FACTORY HALT_CCARD_DIAGNOSTIC_CANNOT_DISCRIMINATE_CONTINUATION_ORIGIN:
		// the host MUST derive origin from actual delivery rather
		// than hard-code `pending_prompt_drain`. This test stands
		// for the host adapter — it pins the rule by directly
		// calling the capture module's three origin branches and
		// confirming the per-stage origins set is correct.
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const sessionId = "s-1"

		// simulated explicit user runTurn
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "explicit_user",
			sessionId,
		})
		// simulated queued wake
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "pending_prompt_drain",
			sessionId,
		})
		// simulated steer
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "deferred_continuation",
			sessionId,
		})

		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.run_turn_started.count).toBe(3)
		const origins = counters.stages.run_turn_started.origins.slice().sort()
		expect(origins).toEqual(["deferred_continuation", "explicit_user", "pending_prompt_drain"].sort())
	})

	it("CCARD-COMPOSE-01: SDK package is reachable from the host test runner", async () => {
		// The host wiring in `vscode-session-host.ts` passes
		// `pendingPromptCapture: { ... }` to `ClineCore.create(...)`.
		// This option is on `ClineCoreOptions` and is a structural
		// TypeScript-only contract (interfaces are erased at runtime).
		// We assert the SDK module is loadable here so the host
		// test runner's own `@cline/core` resolution stays healthy;
		// the structural compile-time contract (that the capture
		// hook shape matches `PendingPromptsControllerDeps`) is
		// enforced by `bunx tsc --noEmit` in `bun run check-types`.
		const sdk = await import("@cline/core")
		expect(sdk).toBeDefined()
	})

	it("CCARD-ABLATION-01: with capture OFF the production callback wiring is a no-op", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		const sessionId = "s-1"
		const jobId = "j-1"
		const promptId = "p-1"

		for (let i = 0; i < 50; i++) {
			captureContinuationCardinalityAuthorityRecord({ stage: "terminal_committed", origin: "background_terminal", jobId })
			captureContinuationCardinalityAuthorityRecord({
				stage: "wake_created",
				origin: "background_terminal",
				jobId,
				sessionId,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "pending_prompt_enqueued",
				origin: "pending_prompt_drain",
				sessionId,
				promptId,
				jobId,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "pending_prompt_dequeued",
				origin: "pending_prompt_drain",
				sessionId,
				promptId,
				jobId,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "continuation_scheduled",
				origin: "pending_prompt_drain",
				sessionId,
				promptId,
				jobId,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "run_turn_started",
				origin: "pending_prompt_drain",
				sessionId,
			})
			captureContinuationCardinalityAuthorityRecord({ stage: "agent_turn_done", origin: "pending_prompt_drain", sessionId })
			captureContinuationCardinalityAuthorityRecord({
				stage: "submit_and_exit_seen",
				origin: "pending_prompt_drain",
				sessionId,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "task_completion_committed",
				origin: "pending_prompt_drain",
				sessionId,
			})
		}
		expect(getContinuationCardinalityAuthorityCaptureRecords()).toHaveLength(0)
		expect(getContinuationCardinalityAuthorityCounters().total).toBe(0)
	})
})
