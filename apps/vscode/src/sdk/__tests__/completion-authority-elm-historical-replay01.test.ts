/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01
 *
 * Offline replay test for the Elm completion-authority kernel. Loads
 * the COMPILED `vendor/completion-authority.js` and feeds it frozen
 * REAL JSONL traces from prior ACTs to determine whether the Elm
 * model faithfully captures historical production behavior.
 *
 * This test is OFFLINE ONLY. No production wiring, no extension
 * activation, no runtime event feed, no effect execution, no
 * diagnostic profile.
 */

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, test } from "vitest"
import type { KernelHandle, ReplayResult } from "../completion-authority-elm-replay"
import {
	adapterIsDeterministic,
	adapterIsExplicitForMissingId,
	adapterIsExplicitForUnknownStage,
	adapterNeverManufacturesIdentity,
	adapterPreservesOrder,
	adapterPreservesOrigin,
	adaptRecord,
	loadKernel,
	replayTrace,
} from "../completion-authority-elm-replay"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")
const KERNEL_PATH = path.resolve(REPO_ROOT, "apps/vscode/elm/completion-authority/vendor/completion-authority.js")
const EVIDENCE_ROOT = path.resolve(REPO_ROOT, ".factory/evidence")
const STALL02_TRACE = path.join(
	EVIDENCE_ROOT,
	"ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/continuation-cardinality-authority.jsonl",
)
const R1_CONTROL_TRACE = path.join(
	EVIDENCE_ROOT,
	"ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/01a-ccard.LIVE_RAW.jsonl",
)
const R2_HELD_TERMINAL_TRACE = path.join(
	EVIDENCE_ROOT,
	"ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/01a-live-ccard.jsonl",
)

function sha256File(p: string): string {
	const text = fs.readFileSync(p, "utf8")
	return createHash("sha256").update(text).digest("hex")
}

function snapshotShaForTrace(tracePath: string): string {
	return sha256File(tracePath)
}
describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01 — adapter self-invariants (AR-01..AR-06)", () => {
	test("AR-01: source order is preserved across all three frozen traces", () => {
		expect(adapterPreservesOrder(STALL02_TRACE).preserved).toBe(true)
		expect(adapterPreservesOrder(R1_CONTROL_TRACE).preserved).toBe(true)
		expect(adapterPreservesOrder(R2_HELD_TERMINAL_TRACE).preserved).toBe(true)
	})

	test("AR-02: unknown stage is explicit UNMODELED_EVENT", () => {
		expect(adapterIsExplicitForUnknownStage().ok).toBe(true)
	})

	test("AR-03: missing required ID is explicit INSUFFICIENT_IDENTITY", () => {
		expect(adapterIsExplicitForMissingId().ok).toBe(true)
	})

	test("AR-04: same record maps identically every run", () => {
		const { ok, sha1, sha2 } = adapterIsDeterministic()
		expect(ok).toBe(true)
		expect(sha1).toBe(sha2)
	})

	test("AR-05: adapter never changes factual origin", () => {
		expect(adapterPreservesOrigin().ok).toBe(true)
	})

	test("AR-06: adapter never manufactures identity for REAL replay", () => {
		expect(adapterNeverManufacturesIdentity().ok).toBe(true)
	})

	test("explicit: a record with a wholly-unknown stage yields UNMODELED_EVENT", () => {
		const o = adaptRecord({ stage: "no_such_stage", seq: 1, at: 0 })
		expect(o.status).toBe("UNMODELED_EVENT")
	})

	test("explicit: pending_prompt_enqueued without promptId yields INSUFFICIENT_IDENTITY", () => {
		const o = adaptRecord({ stage: "pending_prompt_enqueued", origin: "pending_prompt_drain", sessionId: "s", seq: 1, at: 0 })
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})
})

// CORRECTION01: loadKernel runs the Elm bundle's IIFE which
// registers a global `Elm.Main`. Calling loadKernel twice in the
// same process collides on that global. Share a single kernel
// across describe blocks via a module-level handle.
let sharedKernel: KernelHandle | null = null

function getSharedKernel(): KernelHandle {
	if (!sharedKernel) sharedKernel = loadKernel(KERNEL_PATH)
	return sharedKernel
}

beforeAll(() => {
	getSharedKernel()
})

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01 — CORRECTION01 violation-classification oracle", () => {
	// The replay classifier must treat a state.violation as
	// ELM_REJECTS_TS_SEQUENCE, not as a quiet DIRECT.
	// Driving the kernel: task_started -> run_started(R, explicit)
	// -> task_completion_committed(C). The third event is rejected
	// with TaskCompletionCommittedWhileHeld ActiveRun.
	test("HR-09 — synthetic trace with a state.violation: replay classifies it as ELM_REJECTS_TS_SEQUENCE", async () => {
		const k = getSharedKernel()
		const tmpTrace = path.join(
			REPO_ROOT,
			".factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/synthetic-violation-trace.jsonl",
		)
		fs.writeFileSync(
			tmpTrace,
			[
				JSON.stringify({
					seq: 1,
					at: 1,
					stage: "task_started",
					taskId: "task-c01",
					origin: "explicit_user",
					sessionId: "s-c01",
				}),
				JSON.stringify({
					seq: 2,
					at: 2,
					stage: "run_turn_started",
					runId: "run-c01",
					origin: "explicit_user",
					sessionId: "s-c01",
					taskId: "task-c01",
				}),
				JSON.stringify({
					seq: 3,
					at: 3,
					stage: "task_completion_committed",
					completionId: "c-c01",
					origin: "explicit_user",
					sessionId: "s-c01",
					taskId: "task-c01",
				}),
			].join("\n") + "\n",
		)
		try {
			const r = await replayTrace({ kernel: k, tracePath: tmpTrace })
			const violationEvent = r.events.find((e) => e.classification === "ELM_REJECTS_TS_SEQUENCE")
			expect(violationEvent).toBeTruthy()
			expect(violationEvent?.after?.violation).toBeDefined()
			expect(r.firstDivergenceKind).toBe("ELM_REJECTS_TS_SEQUENCE")
			expect(r.firstDivergenceStage).toBe("task_completion_committed")
			expect(r.firstDivergenceSeq).toBe(3)
		} finally {
			try {
				fs.unlinkSync(tmpTrace)
			} catch {
				/* best-effort */
			}
		}
	})
})

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01 — frozen traces replay", () => {
	const beforeSha = {
		stall: snapshotShaForTrace(STALL02_TRACE),
		r1: snapshotShaForTrace(R1_CONTROL_TRACE),
		r2: snapshotShaForTrace(R2_HELD_TERMINAL_TRACE),
	}
	let kernel: KernelHandle

	beforeAll(() => {
		kernel = getSharedKernel()
	})

	test("kernel load + ready", () => {
		expect(kernel).toBeTruthy()
	})

	const replayResults: { tag: string; result: ReplayResult }[] = []

	test("HR-01 — known-good completion trace (R1 control) drives the kernel", async () => {
		const r1 = await replayTrace({ kernel, tracePath: R1_CONTROL_TRACE })
		replayResults.push({ tag: "R1", result: r1 })
		// First event in R1 is `run_turn_started` which lacks the
		// Elm-required `runId`. So the FIRST semantic divergence
		// (precedence 2 — INSUFFICIENT_IDENTITY) hits at seq=1,
		// BEFORE we ever reach `terminal_committed` at seq=2.
		expect(r1.firstDivergenceKind).toBe("INSUFFICIENT_IDENTITY")
		expect(r1.firstDivergenceStage).toBe("run_turn_started")
		expect(r1.firstDivergenceSeq).toBe(1)
		expect(r1.manufacturedIdentityCount).toBe(0)
		expect(r1.originRewriteCount).toBe(0)
		expect(r1.tsCompletionCommitted).toBe(true)
		expect(r1.tsCompletionCommittedSeq).toBe(12)
	})

	test("HR-02 — held-terminal trace (R2) drives the kernel", async () => {
		const r2 = await replayTrace({ kernel, tracePath: R2_HELD_TERMINAL_TRACE })
		replayResults.push({ tag: "R2", result: r2 })
		// R2's first event is `terminal_committed` (origin=background_terminal,
		// no runId, no ownerId). Its first schema gap is the runId
		// absence on `run_turn_started` IF it appeared earlier — it
		// doesn't, so the first gap is the missing ownerId on
		// terminal_committed.
		expect(r2.firstDivergenceKind).toBe("INSUFFICIENT_IDENTITY")
		expect(r2.firstDivergenceStage).toBe("terminal_committed")
		expect(r2.manufacturedIdentityCount).toBe(0)
	})

	test("HR-03 — continuation sequence: same schema gap as R1", async () => {
		// R3 is the continuation segment inside R1. Reuse R1 trace;
		// the schema gap is identical (no runId on run_turn_started).
		const r3 = await replayTrace({ kernel, tracePath: R1_CONTROL_TRACE })
		replayResults.push({ tag: "R3", result: r3 })
		expect(r3.firstDivergenceKind).toBe("INSUFFICIENT_IDENTITY")
		expect(r3.firstDivergenceStage).toBe("run_turn_started")
	})

	test("HR-04 — known stall trace (R4) drives the kernel", async () => {
		const r4 = await replayTrace({ kernel, tracePath: STALL02_TRACE })
		replayResults.push({ tag: "R4", result: r4 })
		// First event is run_turn_started with no runId.
		expect(r4.firstDivergenceKind).toBe("INSUFFICIENT_IDENTITY")
		expect(r4.firstDivergenceStage).toBe("run_turn_started")
		expect(r4.firstDivergenceSeq).toBe(1)
		expect(r4.manufacturedIdentityCount).toBe(0)
		expect(r4.originRewriteCount).toBe(0)
		expect(r4.tsCompletionCommitted).toBe(true)
		expect(r4.tsCompletionCommittedSeq).toBe(21)
		expect(r4.unmodeledEventCount).toBe(0)
		expect(r4.insufficientIdentityCount).toBeGreaterThan(0)
	})

	test("HR-05 — unknown stage becomes explicit UNMODELED_EVENT", () => {
		const o = adaptRecord({ stage: "this_is_not_an_elm_event", seq: 1, at: 0 })
		expect(o.status).toBe("UNMODELED_EVENT")
	})

	test("HR-06 — missing required identity becomes INSUFFICIENT_IDENTITY", () => {
		const o = adaptRecord({ stage: "run_turn_started", origin: "explicit_user", sessionId: "s", seq: 1, at: 0 })
		expect(o.status).toBe("INSUFFICIENT_IDENTITY")
	})

	test("HR-07 — replay is deterministic: same trace twice -> byte-equivalent result", async () => {
		const a = await replayTrace({ kernel, tracePath: STALL02_TRACE })
		const b = await replayTrace({ kernel, tracePath: STALL02_TRACE })
		expect(a.deterministicSha256).toBe(b.deterministicSha256)
	})

	test("HR-08 — source input is never modified (sha256 before/after replay)", () => {
		const afterSha = {
			stall: snapshotShaForTrace(STALL02_TRACE),
			r1: snapshotShaForTrace(R1_CONTROL_TRACE),
			r2: snapshotShaForTrace(R2_HELD_TERMINAL_TRACE),
		}
		expect(afterSha.stall).toBe(beforeSha.stall)
		expect(afterSha.r1).toBe(beforeSha.r1)
		expect(afterSha.r2).toBe(beforeSha.r2)
	})

	test("export: write replay results for offline evidence (single sink)", () => {
		const outDir = path.resolve(REPO_ROOT, ".factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01")
		fs.mkdirSync(outDir, { recursive: true })
		const summary = {
			kernel: { path: KERNEL_PATH, sha256: sha256File(KERNEL_PATH) },
			sourceShas: beforeSha,
			replays: replayResults.map((r) => ({
				tag: r.tag,
				sourceTraceSha256: r.result.sourceTraceSha256,
				eventsTotal: r.result.eventsTotal,
				firstDivergenceSeq: r.result.firstDivergenceSeq,
				firstDivergenceKind: r.result.firstDivergenceKind,
				firstDivergenceStage: r.result.firstDivergenceStage,
				manufacturedIdentityCount: r.result.manufacturedIdentityCount,
				originRewriteCount: r.result.originRewriteCount,
				unmodeledEventCount: r.result.unmodeledEventCount,
				insufficientIdentityCount: r.result.insufficientIdentityCount,
				tsCompletionCommitted: r.result.tsCompletionCommitted,
				tsCompletionCommittedSeq: r.result.tsCompletionCommittedSeq,
				finalModel: r.result.finalModel,
				deterministicSha256: r.result.deterministicSha256,
			})),
		}
		const beforeWriteSha = sha256File(STALL02_TRACE)
		const outPath = path.join(outDir, "test-replay-summary.json")
		fs.writeFileSync(outPath, JSON.stringify(summary, null, 2))
		const afterWriteSha = sha256File(STALL02_TRACE)
		expect(afterWriteSha).toBe(beforeWriteSha)
		expect(fs.existsSync(outPath)).toBe(true)
	})
})
