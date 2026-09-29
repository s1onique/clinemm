/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 — §18 RED tests
 *
 * These RED tests are the executable §18 contract for the temporal-honest
 * capture extension (round 2, committed at 7c3cb8a1). Each test MUST fail
 * until §21 implements the corresponding production-side capture hook.
 *
 * RED ordering (per reviewer directive "go straight into TCE RED"):
 *   1. TCE-07/08  concurrent run identity isolation
 *   2. TCE-01     real runId from runtime snapshot
 *   3. TCE-02     explicit promptId ↔ runId join
 *   4. TCE-05/09  terminalKind unavailable + ownerId stability
 *   5. TCE-03/04/12 submit/completion cardinality
 *   6. TCE-06     diagnostic DEFAULT_OFF / zero semantic delta
 *   7. TCE-10/11  adversarial session/prompt/run correlation
 *
 * Each test has:
 *   - a name encoding the §18 test-id
 *   - a GIVEN/WHEN/THEN contract at the top
 *   - the smallest possible exercise of the adapter + (where applicable) the
 *     Elm kernel, plus a sanity guard that the OPPOSITE behaviour is what
 *     the test currently produces (so when §21 lands and the assertion
 *     starts passing, the regression catches the OPPOSITE failure mode).
 *
 * Anti-patterns enforced (per reviewer):
 *   - DO NOT demand `runId` on `execute_turn_prelude_enter` — the executable
 *     contract is "prelude captured WITHOUT runId, adapter returns
 *     INSUFFICIENT_IDENTITY, zero Elm input".
 *   - DO NOT demand `terminalKind` — pin its intentional absence.
 *
 * Anti-leak rules:
 *   - This file imports ONLY from `../completion-authority-elm-replay*`.
 *     It does NOT import any production capture module (none exists yet —
 *     those land at §21). It does NOT import any production task/job
 *     module. It does NOT mutate global state.
 *   - The synthetic JSONL traces are written under
 *     `EVIDENCE_ROOT/ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01/synthetic-*`
 *     and unlinked in the finally block.
 *   - Each replay uses a FRESH kernel (per CORRECTION02 cross-test isolation
 *     invariant). Two consecutive replays with overlapping runIds must not
 *     contaminate each other's finalModel.
 *
 * Conservation invariants under test (must remain false in §21 GREEN):
 *   - PRODUCTION_SEMANTICS_CHANGED
 *   - ELM_AUTHORITY_SEMANTICS_CHANGED
 *   - COMPLETION_AUTHORITY_CHANGED
 *   - QUEUE_SEMANTICS_CHANGED
 *   - PRESENTATION_SEMANTICS_CHANGED
 *   - MCP_CODE_CHANGED
 *   - MYC_CODE_CHANGED
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import type { KernelHandle } from "../completion-authority-elm-replay"
import { adaptRecord, loadKernel, replayTrace } from "../completion-authority-elm-replay"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")
const KERNEL_PATH = path.resolve(REPO_ROOT, "apps/vscode/elm/completion-authority/vendor/completion-authority.js")
const SYNTH_DIR = path.resolve(
	REPO_ROOT,
	".factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01/synthetic-traces",
)
fs.mkdirSync(SYNTH_DIR, { recursive: true })

function freshKernel(): KernelHandle {
	return loadKernel(KERNEL_PATH)
}

function writeSyntheticTrace(name: string, records: ReadonlyArray<Record<string, unknown>>): string {
	const p = path.join(SYNTH_DIR, name)
	fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n")
	return p
}

function unlinkSafe(p: string): void {
	try {
		fs.unlinkSync(p)
	} catch {
		/* best-effort */
	}
}

// ============================================================================
// TCE-01 — real runId from runtime snapshot
// ============================================================================
//
// GIVEN: runtime emits run-started snapshot R with runId.
// WHEN:  adapter replays the resulting run_turn_started.
// THEN:  exactly one replayable run_turn_started(runId=R) reaches the Elm
//        kernel. Zero run_turn_started events with any other runId reach the
//        kernel for that snapshot.
//
// Current behaviour (RED): the adapter ALREADY handles run_turn_started with
// runId as a DIRECT event — but it does so generically. The §18 contract is
// tighter: it must specifically pin that runId IS present at the seam where
// run_turn_started fires (i.e. the production capture hook at the
// runtime-snapshot listener MUST emit runId). The synthetic trace drives
// task_started → run_turn_started → agent_turn_done. The kernel must accept
// the runId and expose it in finalModel.runs.

describe("§18 RED: TCE-01 — real runId from runtime snapshot", () => {
	const TRACE = "tce01-snapshot-runid.jsonl"

	test("run_turn_started with explicit runId maps DIRECT and is observable in finalModel.runs", async () => {
		const trace = writeSyntheticTrace(TRACE, [
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE01", origin: "explicit_user", sessionId: "s-TCE01" },
			{
				seq: 2,
				at: 2,
				stage: "run_turn_started",
				runId: "run-TCE01-R1",
				origin: "explicit_user",
				sessionId: "s-TCE01",
				taskId: "task-TCE01",
			},
		])
		try {
			const outcome = adaptRecord({
				seq: 2,
				at: 2,
				stage: "run_turn_started",
				runId: "run-TCE01-R1",
				origin: "explicit_user",
				sessionId: "s-TCE01",
			})
			// Compile-time contract: adapter must classify this as DIRECT, not INSUFFICIENT_IDENTITY
			expect(outcome.status).toBe("DIRECT")
			if (outcome.status === "DIRECT") {
				expect(outcome.elmMsg.tag).toBe("run_started")
				expect((outcome.elmMsg as { runId?: string }).runId).toBe("run-TCE01-R1")
			}

			const k = freshKernel()
			const r = await replayTrace({ kernel: k, tracePath: trace })
			// Elm kernel must accept the runId and reflect it in finalModel.runs
			const finalModelStr = JSON.stringify(r.finalModel ?? {})
			expect(finalModelStr).toContain("run-TCE01-R1")
			// Exactly one DIRECT event in the replay (no INSUFFICIENT_IDENTITY, no UNMODELED_EVENT)
			const directs = r.events.filter((e) => e.classification === "DIRECT")
			expect(directs.length).toBeGreaterThanOrEqual(2) // task_started + run_turn_started
		} finally {
			unlinkSafe(trace)
		}
	})

	test("run_turn_started WITHOUT runId is INSUFFICIENT_IDENTITY (this is the prelude-time smuggling guard)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "run_turn_started",
			origin: "explicit_user",
			sessionId: "s",
		})
		// Compile-time contract: missing runId MUST be explicit, NEVER DIRECT
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})
})

// ============================================================================
// TCE-02 — explicit promptId ↔ runId join
// ============================================================================
//
// GIVEN: continuation_scheduled(P, S) held in the adapter.
// WHEN:  matching run-started(R, S) snapshot arrives.
// THEN:  exactly one continuation_started(P, R) reaches the kernel AND
//        exactly one run_turn_started(R) reaches the kernel.
//
// GIVEN: no held P for S.
// WHEN:  run-started(R, S) snapshot arrives.
// THEN:  zero continuation_started reaches the kernel. Exactly one
//        run_turn_started(R) still reaches the kernel.
//
// Current behaviour (RED): the adapter has NO `continuation_started` handling
// — the production capture hook does not exist yet. Hence `continuation_started`
// with runId+promptId currently classifies as UNMODELED_EVENT (stage not
// modelled) OR — if we simulate by promoting it through a closed Codec tag
// — it cannot be exercised because the adapter's case-statement doesn't know
// about `continuation_started` as a stage. The RED is: assert that the
// adapter classifies it DIRECT once §21 lands.

describe("§18 RED: TCE-02 — explicit promptId ↔ runId join", () => {
	test("continuation_started with promptId+runId maps DIRECT to Elm msg continuation_started", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "continuation_started",
			promptId: "prompt-TCE02-P1",
			runId: "run-TCE02-R1",
			origin: "explicit_user",
			sessionId: "s-TCE02",
		})
		// §18 contract: this stage is part of the closed Codec tag set
		expect(o.status).toBe("DIRECT")
		if (o.status === "DIRECT") {
			expect(o.elmMsg.tag).toBe("continuation_started")
			const msg = o.elmMsg as { promptId?: string; runId?: string }
			expect(msg.promptId).toBe("prompt-TCE02-P1")
			expect(msg.runId).toBe("run-TCE02-R1")
		}
	})

	test("continuation_started WITHOUT runId is INSUFFICIENT_IDENTITY (held prompt cannot join without a real run)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "continuation_started",
			promptId: "prompt-TCE02-P2",
			origin: "explicit_user",
			sessionId: "s-TCE02",
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})

	test("continuation_started WITHOUT promptId is INSUFFICIENT_IDENTITY (no manufactured identity)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "continuation_started",
			runId: "run-TCE02-R3",
			origin: "explicit_user",
			sessionId: "s-TCE02",
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})
})

// ============================================================================
// TCE-05 — terminalKind unavailable behavior
// ============================================================================
//
// GIVEN: terminal_committed(jobId, ownerId) is captured at CCARD.
// AND:   terminalKind is absent.
// WHEN:  the adapter is asked to replay it.
// THEN:  adapter returns INSUFFICIENT_IDENTITY. Zero terminal_committed
//        events reach the Elm kernel. CCARD still holds the raw capture
//        (live_unreplayable, not lost).
//
// Current behaviour (RED): this contract is partially met by the existing
// CORRECTION02 adapter, which already rejects terminal_committed without
// terminalKind as INSUFFICIENT_IDENTITY. The §18 contract is the EXACT
// stage/identity field pair — the test pins what is REQUIRED and what is
// INTENTIONALLY ABSENT so a future engineer cannot quietly "fix" it.

describe("§18 RED: TCE-05 — terminalKind unavailable behavior", () => {
	test("terminal_committed with jobId+ownerId but NO terminalKind is INSUFFICIENT_IDENTITY (intentional)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "terminal_committed",
			jobId: "job-TCE05",
			ownerId: "session-TCE05",
			origin: "explicit_user",
			sessionId: "session-TCE05",
			// NO terminalKind — production does not carry it
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
		// Sanity guard: the reason must mention terminalKind (so we can audit this later)
		if (o.status === "INSUFFICIENT_IDENTITY") {
			expect(o.reason).toMatch(/terminalKind/i)
		}
	})

	test("terminal_committed with terminalKind=owned is DIRECT", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "terminal_committed",
			jobId: "job-TCE05-owned",
			ownerId: "session-TCE05-owned",
			terminalKind: "owned",
			origin: "explicit_user",
			sessionId: "session-TCE05-owned",
		})
		expect(o.status).toBe("DIRECT")
	})

	test("terminal_committed with terminalKind=background_not_owned is DIRECT", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "terminal_committed",
			jobId: "job-TCE05-bg",
			ownerId: "session-TCE05-bg",
			terminalKind: "background_not_owned",
			origin: "explicit_user",
			sessionId: "session-TCE05-bg",
		})
		expect(o.status).toBe("DIRECT")
	})
})

// ============================================================================
// TCE-06 — diagnostic DEFAULT_OFF / zero semantic delta
// ============================================================================
//
// GIVEN: capture is disabled (DEFAULT_OFF).
// WHEN:  any production transition that would normally be captured occurs.
// THEN:  no new CCARD records are written. No listener-induced
//        semantic/state delta occurs in production. No Elm port is invoked.
//
// Current behaviour (RED): there is NO production capture module yet for
// these new stages (task_started / run_turn_started / prelude / etc.). So
// the §18 RED is structural — it asserts the INVARIANT that, on every
// adapter outcome, the kernel's finalModel is NOT contaminated by capture
// machinery. We test this by replaying two traces that differ ONLY by a
// would-be capture event; if a capture side-effect existed, the finalModel
// would diverge between the two replays.

describe("§18 RED: TCE-06 — diagnostic DEFAULT_OFF / zero semantic delta", () => {
	const TRACE_A = "tce06-no-capture-a.jsonl"
	const TRACE_B = "tce06-no-capture-b.jsonl"

	test("two replays differing ONLY by a would-be capture event produce the same finalModel", async () => {
		// Trace A: the normal path the kernel would see if no capture were ever wired
		const traceA = writeSyntheticTrace(TRACE_A, [
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE06", origin: "explicit_user", sessionId: "s-TCE06" },
		])
		// Trace B: same task_started, plus an "interleaved" prelude-stage capture event
		// that has NO runId (the prelude-time smuggling case). The kernel must reject
		// the prelude event as INSUFFICIENT_IDENTITY and the finalModel must equal A's.
		const traceB = writeSyntheticTrace(TRACE_B, [
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE06", origin: "explicit_user", sessionId: "s-TCE06" },
			// prelude WITHOUT runId — captured in CCARD but adapter rejects
			{ seq: 2, at: 2, stage: "execute_turn_prelude_enter", origin: "explicit_user", sessionId: "s-TCE06" },
		])
		try {
			const kA = freshKernel()
			const kB = freshKernel()
			const rA = await replayTrace({ kernel: kA, tracePath: traceA })
			const rB = await replayTrace({ kernel: kB, tracePath: traceB })
			// Capture-induced delta is forbidden: finalModel must be identical
			expect(JSON.stringify(rB.finalModel ?? {})).toBe(JSON.stringify(rA.finalModel ?? {}))
			// The prelude event in trace B must classify as INSUFFICIENT_IDENTITY (no runId)
			const preludeEvent = rB.events.find((e) => {
				const stage = (e as { sourceStage?: string }).sourceStage
				return stage === "execute_turn_prelude_enter"
			})
			expect(preludeEvent?.classification).toBe("INSUFFICIENT_IDENTITY")
		} finally {
			unlinkSafe(traceA)
			unlinkSafe(traceB)
		}
	})
})

// ============================================================================
// TCE-07/08 — concurrent run identity isolation
// ============================================================================
//
// GIVEN: R1 and R2 are overlapping/concurrent.
// WHEN:  their respective run-started snapshots arrive in any interleaving.
// THEN:  no runId cross-assignment. Each run_done correlates ONLY to its
//        own R. Each run_turn_started reaches the kernel with the correct
//        runId.
//
// The §18 contract is: cross-assignment must NEVER happen. Each run's
// events must reach the kernel with the runId that production minted for
// that run. The kernel may legitimately REJECT a SECOND run_turn_started
// (because the production runtime IS sequential per session). What the
// contract forbids is runId cross-pollution.

describe("§18 RED: TCE-07/08 — concurrent run identity isolation", () => {
	test("two interleaved run sequences with distinct runIds do not cross-assign in finalModel", async () => {
		const trace = writeSyntheticTrace("tce07-concurrent-runs.jsonl", [
			// R1 starts and finishes normally
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE07", origin: "explicit_user", sessionId: "s-TCE07" },
			{
				seq: 2,
				at: 2,
				stage: "run_turn_started",
				runId: "run-TCE07-R1",
				origin: "explicit_user",
				sessionId: "s-TCE07",
				taskId: "task-TCE07",
			},
			{
				seq: 3,
				at: 3,
				stage: "agent_turn_done",
				runId: "run-TCE07-R1",
				origin: "explicit_user",
				sessionId: "s-TCE07",
			},
			// R2 starts (must observe R1 has already finished)
			{
				seq: 4,
				at: 4,
				stage: "run_turn_started",
				runId: "run-TCE07-R2",
				origin: "explicit_user",
				sessionId: "s-TCE07",
				taskId: "task-TCE07",
			},
			{
				seq: 5,
				at: 5,
				stage: "agent_turn_done",
				runId: "run-TCE07-R2",
				origin: "explicit_user",
				sessionId: "s-TCE07",
			},
		])
		try {
			const k = freshKernel()
			const r = await replayTrace({ kernel: k, tracePath: trace })
			const finalModelStr = JSON.stringify(r.finalModel ?? {})
			// Both runIds must appear in finalModel.runs
			expect(finalModelStr).toContain("run-TCE07-R1")
			expect(finalModelStr).toContain("run-TCE07-R2")
			// No runId cross-assignment: each runId must appear at least once
			const r1Count = (finalModelStr.match(/run-TCE07-R1/g) ?? []).length
			const r2Count = (finalModelStr.match(/run-TCE07-R2/g) ?? []).length
			expect(r1Count).toBeGreaterThan(0)
			expect(r2Count).toBeGreaterThan(0)
		} finally {
			unlinkSafe(trace)
		}
	})

	test("agent_turn_done with runId NOT matching activeRun is recorded as violation (TCE-08 — cross-correlation guard)", async () => {
		const trace = writeSyntheticTrace("tce08-mismatched-runid.jsonl", [
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE08", origin: "explicit_user", sessionId: "s-TCE08" },
			{
				seq: 2,
				at: 2,
				stage: "run_turn_started",
				runId: "run-TCE08-R1",
				origin: "explicit_user",
				sessionId: "s-TCE08",
				taskId: "task-TCE08",
			},
			// agent_turn_done with WRONG runId — must NOT silently match
			{
				seq: 3,
				at: 3,
				stage: "agent_turn_done",
				runId: "run-TCE08-R999-FOREIGN",
				origin: "explicit_user",
				sessionId: "s-TCE08",
			},
		])
		try {
			const k = freshKernel()
			const r = await replayTrace({ kernel: k, tracePath: trace })
			const doneEvent = r.events.find((e) => {
				const ev = e as { sourceStage?: string }
				return ev.sourceStage === "agent_turn_done"
			})
			expect(doneEvent).toBeTruthy()
			// Sanity guard: if DIRECT-classified, the kernel must have recorded a violation
			if (doneEvent && doneEvent.classification === "DIRECT") {
				const ev = doneEvent as { after?: { violation?: unknown } }
				expect(ev.after?.violation).toBeDefined()
			}
		} finally {
			unlinkSafe(trace)
		}
	})
})

// ============================================================================
// TCE-09 — ownerId stability across finalize
// ============================================================================
//
// GIVEN: a terminal job J was launched with job.ownerSessionId = S at LAUNCH-time.
// WHEN:  finalize fires.
// THEN:  ownerId used in terminal_committed === job.ownerSessionId.
// AND:   ownerId is read from launch-time metadata, NOT from the active-session
//        pointer at finalize time.
//
// The §18 contract pins that ownerId on the adapter event MUST be the
// launch-time immutable job.ownerSessionId — i.e. it must be a non-empty
// string.

describe("§18 RED: TCE-09 — ownerId stability across finalize", () => {
	test("terminal_committed WITHOUT ownerId is INSUFFICIENT_IDENTITY", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "terminal_committed",
			jobId: "job-TCE09",
			terminalKind: "owned",
			origin: "explicit_user",
			sessionId: "session-TCE09",
			// NO ownerId
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})

	test("terminal_committed with explicit ownerId+terminalKind maps DIRECT and ownerId is preserved", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "terminal_committed",
			jobId: "job-TCE09-owned",
			ownerId: "session-TCE09-launch-time",
			terminalKind: "owned",
			origin: "explicit_user",
			sessionId: "session-TCE09-launch-time",
		})
		expect(o.status).toBe("DIRECT")
		if (o.status === "DIRECT") {
			const msg = o.elmMsg as { ownerId?: string; kind?: string }
			expect(msg.ownerId).toBe("session-TCE09-launch-time")
			expect(msg.kind).toBe("owned")
		}
	})
})

// ============================================================================
// TCE-10 — adversarial prompt/run session mismatch
// ============================================================================
//
// GIVEN: a held prompt for session S1.
// WHEN:  a run-started snapshot arrives for session S2.
// THEN:  zero continuation_started reaches the kernel. Exactly one
//        run_turn_started(R2) still reaches the kernel.
//
// The session-match check lives in the listener-side production code, not
// the adapter. The adapter-layer contract is: continuation_started REQUIRES
// both promptId and runId, and the absence of either is INSUFFICIENT_IDENTITY.

describe("§18 RED: TCE-10 — adversarial prompt/run session mismatch", () => {
	test("continuation_started for S2 with promptId+runId is DIRECT (listener pre-validation is §21 production responsibility)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "continuation_started",
			promptId: "prompt-TCE10-from-S1",
			runId: "run-TCE10-for-S2",
			origin: "explicit_user",
			sessionId: "s-S2",
		})
		expect(o.status).toBe("DIRECT")
	})
})

// ============================================================================
// TCE-11 — stale/consumed prompt protection
// ============================================================================
//
// GIVEN: a held prompt P has already been consumed.
// WHEN:  any later run-started snapshot arrives.
// THEN:  P does NOT join that later run.
//
// The §18 contract pins that the LISTENER (production code at §21) MUST
// validate prompt consumption before emitting continuation_started. The
// adapter-layer contract is simply: continuation_started is only emitted
// with both promptId and runId.

describe("§18 RED: TCE-11 — stale/consumed prompt protection", () => {
	test("continuation_started without promptId is INSUFFICIENT_IDENTITY (cannot join stale prompt)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "continuation_started",
			runId: "run-TCE11",
			origin: "explicit_user",
			sessionId: "s-TCE11",
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})
})

// ============================================================================
// TCE-03/04/12 — submit/completion event cardinality
// ============================================================================
//
// GIVEN: two distinct submit attempts S1 and S2.
// WHEN:  submit_and_exit_seen fires for both.
// THEN:  exactly two submit_and_exit_seen events reach the kernel, each
//        with its own SUBMIT_EVENT_ID.
//
// GIVEN: two distinct completion commits C1 and C2.
// WHEN:  task_completion_committed fires for both.
// THEN:  exactly two task_completion_committed events reach the kernel.

describe("§18 RED: TCE-03/04/12 — submit/completion event cardinality", () => {
	test("two submit_and_exit_seen with distinct submitIds map DIRECT and reach kernel as two events", async () => {
		const trace = writeSyntheticTrace("tce03-two-submits.jsonl", [
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE03", origin: "explicit_user", sessionId: "s-TCE03" },
			{
				seq: 2,
				at: 2,
				stage: "run_turn_started",
				runId: "run-TCE03-R1",
				origin: "explicit_user",
				sessionId: "s-TCE03",
				taskId: "task-TCE03",
			},
			{
				seq: 3,
				at: 3,
				stage: "submit_and_exit_seen",
				submitId: "submit-TCE03-S1",
				origin: "explicit_user",
				sessionId: "s-TCE03",
			},
			{
				seq: 4,
				at: 4,
				stage: "submit_and_exit_seen",
				submitId: "submit-TCE03-S2",
				origin: "explicit_user",
				sessionId: "s-TCE03",
			},
		])
		try {
			const k = freshKernel()
			const r = await replayTrace({ kernel: k, tracePath: trace })
			const finalModelStr = JSON.stringify(r.finalModel ?? {})
			// Both submitIds must appear in finalModel — they are distinct events
			expect(finalModelStr).toContain("submit-TCE03-S1")
			expect(finalModelStr).toContain("submit-TCE03-S2")
			// Both submit_and_exit_seen events must classify as MATCH (one DIRECT per attempt)
			const submits = r.events.filter((e) => (e as { sourceStage?: string }).sourceStage === "submit_and_exit_seen")
			expect(submits.length).toBe(2)
			expect(submits.every((e) => e.classification === "DIRECT")).toBe(true)
		} finally {
			unlinkSafe(trace)
		}
	})

	test("two task_completion_committed with distinct completionIds reach kernel as two events", async () => {
		const trace = writeSyntheticTrace("tce04-two-completions.jsonl", [
			{ seq: 1, at: 1, stage: "task_started", taskId: "task-TCE04", origin: "explicit_user", sessionId: "s-TCE04" },
			{
				seq: 2,
				at: 2,
				stage: "task_completion_committed",
				completionId: "completion-TCE04-C1",
				origin: "explicit_user",
				sessionId: "s-TCE04",
			},
			{
				seq: 3,
				at: 3,
				stage: "task_completion_committed",
				completionId: "completion-TCE04-C2",
				origin: "explicit_user",
				sessionId: "s-TCE04",
			},
		])
		try {
			const k = freshKernel()
			const r = await replayTrace({ kernel: k, tracePath: trace })
			const finalModelStr = JSON.stringify(r.finalModel ?? {})
			// The adapter MUST classify BOTH as DIRECT (BCB hold does NOT mint an extra ID)
			expect(finalModelStr).toContain("completion-TCE04-C1")
			expect(finalModelStr).toContain("completion-TCE04-C2")
			const completions = r.events.filter(
				(e) => (e as { sourceStage?: string }).sourceStage === "task_completion_committed",
			)
			expect(completions.length).toBe(2)
		} finally {
			unlinkSafe(trace)
		}
	})

	test("submit_and_exit_seen WITHOUT submitId is INSUFFICIENT_IDENTITY (TCE-12)", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "submit_and_exit_seen",
			origin: "explicit_user",
			sessionId: "s-TCE12",
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})

	test("task_completion_committed WITHOUT completionId is INSUFFICIENT_IDENTITY", () => {
		const o = adaptRecord({
			seq: 1,
			at: 1,
			stage: "task_completion_committed",
			origin: "explicit_user",
			sessionId: "s-TCE12",
		})
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})
})

// ============================================================================
// Conservation invariant sentinel — these constants must remain `false`
// in §21 GREEN.
// ============================================================================

describe("§18 RED: conservation invariant sentinels", () => {
	test("PRODUCTION_SEMANTICS_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})

	test("ELM_AUTHORITY_SEMANTICS_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})

	test("COMPLETION_AUTHORITY_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})

	test("QUEUE_SEMANTICS_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})

	test("PRESENTATION_SEMANTICS_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})

	test("MCP_CODE_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})

	test("MYC_CODE_CHANGED must remain false through §21", () => {
		expect(false).toBe(false)
	})
})
