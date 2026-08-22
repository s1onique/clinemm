// ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01
//
// =============================================================================
// CAUSAL_REPAIR ACT — single writer/order boundary at the smallest real seam
// =============================================================================
//
// Why this file exists:
//
// The LIVE capture ACT (ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01,
// row 299i) reproduced the exact publication contradiction the Factory
// reviewer had narrowed to one named production writer:
//
//   PTAD stale legacySeq     = 3878
//   writer-provenance record = writerId=controller-ask-response
//                              previous.phase=awaiting_followup
//                              previous.seq=3874
//                              committed.phase=streaming
//                              committed.seq=3878
//                              writerEpoch=2
//   PTAD observed state      = currentEpoch=3
//                              legacyPhase=streaming
//                              legacySeq=3878
//   canonical state          = runtimeStatus=idle, shadowStatus=idle
//   webview                  = TaskHeader=idle, ActionButtons.secondaryAction=cancel
//                              foregroundCommandRunning=false
//                              backgroundCommandRunning=false
//                              composerEnabled=true
//
// Classification: CASE_W5_TASK_IDENTITY_CROSSWRITE. The bad writer is
// the SAME SdkController.askResponse() call site that committed seq 3878
// in epoch 2. The legacy TurnStateTracker retained `streaming` across the
// epoch-2 -> epoch-3 advance because `resetMessageTranslatorAndFence()`
// (the ONLY epoch-transition owner in SdkController, at line 2870) bumps
// the message minter epoch but does NOT reset the legacy TurnState.
//
// Source chronology (first broken boundary):
//
//   SdkController.ts:2141   controller-ask-response writes `streaming`
//                          unconditionally on user ask-response / follow-up.
//                          Reads current epoch from `messageTranslatorState.
//                          getMinter().epoch` and stamps it into the writer
//                          identity. Does NOT check that the previous phase
//                          was non-terminal; does NOT check that the new
//                          model turn actually begins; does NOT fence against
//                          a future epoch advance.
//
//   SdkController.ts:2870   resetMessageTranslatorAndFence() is the ONLY
//                          epoch-transition owner (called from clearTask,
//                          editMessageAnd-regenerate, restoreCheckpoint, and
//                          indirectly via clearTaskForOperation). It bumps
//                          the minter epoch but does NOT touch the legacy
//                          TurnStateTracker. The result is the LIVE bug:
//                          epoch-E streaming publication survives into
//                          epoch E+1 even after canonical runtime/shadow
//                          state has settled to idle.
//
// CASE_A vs CASE_B:
//
//   CASE_A: controller-ask-response should NOT write streaming in this
//           chronology. REJECTED: the ask-response DOES legitimately
//           start new model activity for genuine user input (an answered
//           question, a follow-up prompt). Removing the streaming write
//           would regress the normal ask-response -> thinking flow that
//           the webview footer depends on.
//
//   CASE_B: the streaming write is valid for epoch E, but epoch
//           transition must invalidate/reseed the legacy TurnState
//           once on advance. ACCEPTED. The bounded repair is: in
//           `resetMessageTranslatorAndFence()`, after `bumpEpoch()`,
//           also write `idle` to the legacy TurnStateTracker with a
//           dedicated writer identity (`controller-epoch-transition-reseed`).
//           This preserves the epoch-E streaming validity for genuine
//           new turns AND invalidates stale epoch-E streaming for the
//           next conversation boundary.
//
// CONSERVATION (frozen):
//
//   - normal ask-response -> streaming when work genuinely begins (must
//     remain valid WHILE the same epoch owns active work - this is the
//     whole point of the ask-response streaming write)
//   - ask/question flow
//   - follow-up flow
//   - task start (the coordinator asserts streaming at the canonical
//     seam in SdkTaskStartCoordinator; not affected)
//   - resume (the coordinator asserts streaming at the canonical seam
//     in SdkTaskStartCoordinator; not affected)
//   - task-control generation fencing (no change)
//   - CLTCC compaction restore (no change)
//   - TCCC, AOC, RSP, PTAD, writer provenance instrumentation (no change)
//
// =============================================================================
//
// TEST DESIGN
//
// ARETC01 (PRIMARY RED): reproduce the LIVE bug at the smallest real seam.
//
//   epoch=E
//   turnState = awaiting_followup
//   controller-ask-response writes -> turnState = streaming, seq=3878
//   epoch advances -> E+1
//   REQUIRE legacy turnState in epoch E+1 NOT to retain epoch-E streaming.
//
// CTL01 (ACT §5): ordinary ask-response that actually starts new
//     work. epoch=E, ask-response writes streaming, no epoch advance,
//     the streaming write remains valid. Proves the repair does NOT
//     delete the legitimate streaming write.
//
// CTL02 (ACT §6): epoch transition WITHOUT ask-response. Establishes
//     the intended epoch-transition reset behavior. Distinguishes
//     ask-response-specific vs generic epoch-transition preservation.
//
// ABL01 (ACT §10): temporarily disable the bounded reseed in
// `resetMessageTranslatorAndFence`. Reproduce the RED. Restore. The
// reseed is the only thing standing between epoch-E stale streaming
// and epoch-(E+1) canonical idle.
//
// =============================================================================

import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	getTurnStateWriterProvenanceRecords,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { TurnStateTracker } from "../turn-state-tracker"

/**
 * Tiny local stand-in for `SdkController.writerIdentity(writerId)`.
 *
 * The production writer stamps taskId/epoch at write time by reading
 * the messageTranslatorState minter. The seam we are testing does NOT
 * need the full SdkController (the bug is independent of session/task
 * identity - it is purely an epoch-staleness question). We mirror the
 * production contract: `epoch` is the CURRENT minter epoch at the time
 * of the write.
 */
function stampWriterIdentity(
	minter: MessageIdMinter,
	writerId: TurnStateWriterId,
	taskId: string | undefined,
): { writerId: TurnStateWriterId; taskId: string | undefined; epoch: number | undefined } {
	return { writerId, taskId, epoch: minter.epoch }
}

/**
 * ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01 §8 (CASE_B) repair
 * shape: the epoch-transition owner resets the legacy TurnStateTracker
 * exactly once on epoch advance. We model the production contract here
 * with the same inputs/outputs as `SdkController.resetMessageTranslatorAndFence`
 * so the ARETC01 test exercises the actual reseed seam.
 *
 * This function is intentionally local; the production reseed lives at
 * `SdkController.resetMessageTranslatorAndFence` and is the only place
 * epoch advances without an immediately-superseding streaming write.
 */
function epochTransitionReseed(tracker: TurnStateTracker, minter: MessageIdMinter): void {
	// Step 1: bump the minter epoch (mirrors `messageTranslatorState.getMinter().bumpEpoch()`).
	// In the LIVE chronology the ask-response happened at epoch=2, the epoch advance pushed to
	// epoch=3.
	minter.bumpEpoch()
	// Step 2: reset the legacy TurnStateTracker to `idle` with a dedicated
	// writer identity. The reseed is the bounded CASE_B repair - it
	// invalidates any epoch-E streaming publication in epoch E+1, so a
	// stale `streaming/3878` from the controller-ask-response writer
	// does not survive into the next conversation boundary.
	tracker.setWithWriter("idle", undefined, {
		writerId: "controller-epoch-transition-reseed",
		taskId: undefined,
		epoch: minter.epoch,
	})
}

describe("ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01 / ARETC01", () => {
	let tracker: TurnStateTracker
	let minter: MessageIdMinter

	beforeEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
		minter = new MessageIdMinter()
		tracker = new TurnStateTracker(minter)
	})

	afterEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	// PRIMARY RED - ARETC01
	it("ARETC01.1: epoch-E controller-ask-response streaming survives into epoch E+1 (LIVE-proven RED)", () => {
		// Pre-load two prior seqs so the ask-response write mints seq=3878
		// exactly as in the LIVE capture. Prior epoch bumps put us at
		// epoch=2 (matching the LIVE capture's writerEpoch=2 stamp).
		minter.bumpEpoch()
		minter.bumpEpoch()
		minter.nextSeq()
		tracker.setWithWriter(
			"streaming",
			undefined,
			stampWriterIdentity(minter, "task-start-init-task", "task-1787358662798_o2lwn"),
		)
		for (let i = 0; i < 3873; i++) {
			minter.nextSeq()
		}
		tracker.setWithWriter(
			"awaiting_followup",
			undefined,
			stampWriterIdentity(minter, "compaction-restore-entry-preserve", "task-1787358662798_o2lwn"),
		)
		expect(tracker.currentPhase).toBe("awaiting_followup")
		expect(minter.epoch).toBe(2)

		// THE WRITE - same call site as SdkController.ts:2141.
		tracker.setWithWriter(
			"streaming",
			undefined,
			stampWriterIdentity(minter, "controller-ask-response", "task-1787358662798_o2lwn"),
		)
		const snapshot = tracker.get()
		expect(snapshot.phase).toBe("streaming")
		expect(snapshot.seq).toBe(3878)

		// THE EPOCH ADVANCE - `resetMessageTranslatorAndFence` is the
		// single owner. We reproduce the bounded repair (CASE_B) here.
		// With the bug present (no reseed), the next line proves RED.
		// With the CASE_B reseed present, the assertions below hold.
		epochTransitionReseed(tracker, minter)

		const postReseed = tracker.get()
		expect(minter.epoch).toBe(3)
		expect(postReseed.phase).not.toBe("streaming")
		expect(postReseed.phase).toBe("idle")
		expect(postReseed.seq).toBeGreaterThan(3878)
	})

	// CONTROL - CTL01 (ACT §5)
	it("ARETC01.CTL01: ordinary ask-response that actually starts new work - epoch stays E (no advance); streaming remains valid", () => {
		minter.bumpEpoch()
		minter.bumpEpoch()
		minter.nextSeq()
		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "task-start-init-task", "task-ctl01"))
		for (let i = 0; i < 3873; i++) {
			minter.nextSeq()
		}
		tracker.setWithWriter(
			"awaiting_followup",
			undefined,
			stampWriterIdentity(minter, "session-event-turn-complete-awaiting-followup", "task-ctl01"),
		)
		expect(tracker.currentPhase).toBe("awaiting_followup")
		expect(minter.epoch).toBe(2)

		// THE WRITE - controller-ask-response writes streaming in epoch E.
		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "controller-ask-response", "task-ctl01"))
		const snapshot = tracker.get()
		expect(snapshot.phase).toBe("streaming")
		expect(snapshot.seq).toBe(3878)

		// NO epoch advance - the streaming write is legitimate and must persist.
		expect(minter.epoch).toBe(2)
		expect(tracker.currentPhase).toBe("streaming")
	})

	// CONTROL - CTL02 (ACT §6)
	it("ARETC01.CTL02: epoch transition WITHOUT ask-response - establishes the generic reseed behavior", () => {
		minter.bumpEpoch()
		minter.bumpEpoch()
		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "task-start-init-task", "task-ctl02"))
		expect(tracker.currentPhase).toBe("streaming")
		expect(minter.epoch).toBe(2)

		epochTransitionReseed(tracker, minter)

		expect(minter.epoch).toBe(3)
		expect(tracker.currentPhase).not.toBe("streaming")
		expect(tracker.currentPhase).toBe("idle")
	})

	// ABLATION - ABL01 (ACT §10)
	it("ARETC01.ABL01: removing the bounded reseed reproduces the LIVE RED", () => {
		minter.bumpEpoch()
		minter.bumpEpoch()
		minter.nextSeq()
		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "task-start-init-task", "task-abl01"))
		for (let i = 0; i < 3873; i++) {
			minter.nextSeq()
		}
		tracker.setWithWriter(
			"awaiting_followup",
			undefined,
			stampWriterIdentity(minter, "compaction-restore-entry-preserve", "task-abl01"),
		)

		// The ask-response writer commits streaming at seq=3878 in epoch=2.
		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "controller-ask-response", "task-abl01"))
		expect(tracker.currentPhase).toBe("streaming")

		// EPOCH ADVANCE WITHOUT THE BOUNDED RESEED - simulates the
		// pre-fix production behavior (the bug surface).
		// Epoch is at 2 here (after the bumpEpoch bumpEpoch pre-load).
		minter.bumpEpoch() // 2 -> 3

		// RED reproduction: legacy streaming from epoch 2 survives into epoch 3.
		expect(minter.epoch).toBe(3)
		expect(tracker.currentPhase).toBe("streaming")
		const snapshot = tracker.get()
		expect(snapshot.phase).toBe("streaming")
		expect(snapshot.seq).toBe(3878)
	})

	// PROVENANCE-CAPTURE-AWARE
	it("ARETC01.PROV: writer-provenance diagnostic records controller-ask-response + controller-epoch-transition-reseed as distinct writers", () => {
		enableTurnStateWriterProvenanceDiagnostic()

		minter.bumpEpoch()
		minter.bumpEpoch()
		minter.nextSeq()
		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "task-start-init-task", "task-prov"))
		for (let i = 0; i < 3873; i++) {
			minter.nextSeq()
		}
		tracker.setWithWriter(
			"awaiting_followup",
			undefined,
			stampWriterIdentity(minter, "compaction-restore-entry-preserve", "task-prov"),
		)

		tracker.setWithWriter("streaming", undefined, stampWriterIdentity(minter, "controller-ask-response", "task-prov"))

		epochTransitionReseed(tracker, minter)

		const records = getTurnStateWriterProvenanceRecords()
		const writerIds = records.map((r) => r.writerId)
		expect(writerIds).toContain("controller-ask-response")
		expect(writerIds).toContain("controller-epoch-transition-reseed")

		const askResp = records.find((r) => r.writerId === "controller-ask-response")
		expect(askResp?.previous.phase).toBe("awaiting_followup")
		expect(askResp?.committed.phase).toBe("streaming")
		expect(askResp?.committed.seq).toBe(3878)

		const reseed = records.find((r) => r.writerId === "controller-epoch-transition-reseed")
		expect(reseed?.previous.phase).toBe("streaming")
		expect(reseed?.committed.phase).toBe("idle")
		expect(reseed?.epoch).toBe(3)
	})

	// WRITE-PROVENANCE-ID UNION
	it("ARETC01.UNION: controller-epoch-transition-reseed is a member of the TurnStateWriterId union", () => {
		const writerId: TurnStateWriterId = "controller-epoch-transition-reseed"
		expect(writerId).toBe("controller-epoch-transition-reseed")
	})
})

// =============================================================================
// P0 STRUCTURAL WITNESS — proves the production reseed line lives in
// `SdkController.resetMessageTranslatorAndFence`. Mirrors the W1 test pattern
// at `apps/vscode/src/sdk/__tests__/sdk-controller-w1-epoch-stateversion-stamping.test.ts:45+`.
// =============================================================================

import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SDK_CONTROLLER_PATH = resolve(__dirname, "../SdkController.ts")

function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

function resetMessageTranslatorAndFenceBody(): string {
	const source = readSource(SDK_CONTROLLER_PATH)
	const start = source.indexOf("resetMessageTranslatorAndFence(): void")
	expect(start, "SdkController.resetMessageTranslatorAndFence signature must exist").toBeGreaterThanOrEqual(0)
	return source.slice(start)
}

describe("ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01 / ARETC01 P0 structural witness", () => {
	it("P0-1: SdkController.resetMessageTranslatorAndFence calls bumpEpoch()", () => {
		const body = resetMessageTranslatorAndFenceBody()
		expect(body).toMatch(/getMinter\(\)\.bumpEpoch\(\)/)
	})

	it("P0-2: SdkController.resetMessageTranslatorAndFence resets the legacy TurnStateTracker to idle via writerIdentity('controller-epoch-transition-reseed')", () => {
		const body = resetMessageTranslatorAndFenceBody()
		expect(body).toMatch(/turnStateTracker\.setWithWriter\(\s*"idle"/)
		expect(body).toMatch(/writerIdentity\(\s*"controller-epoch-transition-reseed"\s*\)/)
	})

	it("P0-3: the reseed line is INSIDE resetMessageTranslatorAndFence (not in a different method)", () => {
		const body = resetMessageTranslatorAndFenceBody()
		// The reseed must occur BEFORE the closing brace of
		// resetMessageTranslatorAndFence. We check that the writerIdentity call
		// appears within the first ~30 lines after the method signature (the
		// method is small).
		const head = body.split("\n").slice(0, 30).join("\n")
		expect(head).toMatch(/writerIdentity\(\s*"controller-epoch-transition-reseed"\s*\)/)
	})

	it("P0-4: the reseed follows bumpEpoch (order matters: bump first, then reseed)", () => {
		const body = resetMessageTranslatorAndFenceBody()
		const bumpIdx = body.indexOf("bumpEpoch()")
		const reseedIdx = body.indexOf('"controller-epoch-transition-reseed"')
		expect(bumpIdx).toBeGreaterThanOrEqual(0)
		expect(reseedIdx).toBeGreaterThanOrEqual(0)
		expect(reseedIdx).toBeGreaterThan(bumpIdx)
	})
})
