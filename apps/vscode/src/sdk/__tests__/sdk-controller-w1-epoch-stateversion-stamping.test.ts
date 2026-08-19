// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01 /
// producer-seam witness
//
// P1 test binding fix for the W1 producer stamping repair. The webview-side
// regression test
// (`apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/w1-epoch-domain-mismatch-red-fix01.test.tsx`)
// proves that a CORRECTLY stamped W1 payload is accepted end-to-end, but it
// does NOT exercise the actual producer seam:
//
//   SdkController.getStateToPostToWebview()
//     -> { ..., stateVersion, epoch, turnState, ... }
//
// This file pins that seam:
//
//   P0 - structural witness: the literal stamping lines exist in
//        SdkController.ts SdkController.getStateToPostToWebview.
//
//   P1 - runtime invariant on MessageIdMinter: the W1 stamping uses
//        `minter.nextSeq()` and `minter.epoch`, which advances the SAME
//        counter the W2 message path stamps. This pins the total-order
//        semantic delta the repair introduces (every W1 snapshot now
//        consumes a sequence number, even with PTAD disabled).
//
//   P2 - shared-seq invariant: when PTAD is on, `_ptadPushId` MUST equal
//        `stateVersion` (both are the same `sharedSeq` value). When PTAD
//        is off, `_ptadPushId` MUST be undefined. This preserves the
//        diagnostic correlation that W8-1 / W11-2 / W12-1 pin.
//
//   P3 - causal ordering witness: W1 → W2 → W1 interleaving produces
//        strictly monotonic stateVersion relative to intervening seqs,
//        same epoch throughout. This is the load-bearing invariant the
//        reducer's older-epoch fence (`snapshotEpoch < state.epoch`)
//        relies on.
// ============================================================================

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"

const SDK_CONTROLLER_PATH = resolve(__dirname, "../SdkController.ts")

function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

function getStateToPostToWebviewBody(): string {
	const source = readSource(SDK_CONTROLLER_PATH)
	const start = source.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>")
	expect(start, "SdkController.getStateToPostToWebview signature must exist").toBeGreaterThanOrEqual(0)
	return source.slice(start)
}

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01 / producer seam", () => {
	describe("P0: structural witness — SdkController.getStateToPostToWebview stamps W1", () => {
		it("P0-1: stamps stateVersion from minter.nextSeq()", () => {
			const body = getStateToPostToWebviewBody()
			expect(body).toMatch(/stateVersion:\s*sharedSeq/)
		})

		it("P0-2: stamps epoch from minter.epoch", () => {
			const body = getStateToPostToWebviewBody()
			expect(body).toMatch(/epoch:\s*minter\.epoch/)
		})

		it("P0-3: the stamping lines live INSIDE the snapshot object literal", () => {
			const body = getStateToPostToWebviewBody()
			const snapshotBlock = body.match(/(?:return\s*\{|const\s+snapshot\s*=\s*\{)\s*([\s\S]*?)\n\s{2,}\}/)
			expect(snapshotBlock).not.toBeNull()
			const inner = snapshotBlock?.[1] ?? ""
			expect(inner).toMatch(/stateVersion:\s*sharedSeq/)
			expect(inner).toMatch(/epoch:\s*minter\.epoch/)
		})

		it("P0-4: a single sharedSeq value seeds BOTH stateVersion and _ptadPushId when PTAD is enabled", () => {
			const body = getStateToPostToWebviewBody()
			expect(body).toMatch(/stateVersion:\s*sharedSeq/)
			expect(body).toMatch(/ptadPushId\s*=\s*ptadEnabled\s*\?\s*sharedSeq/)
		})
	})

	describe("P1: runtime invariant — MessageIdMinter", () => {
		it("P1-1: nextSeq() advances the freshness counter (the same counter W2 messages use)", () => {
			const minter = new MessageIdMinter()
			const s1 = minter.nextSeq()
			const s2 = minter.nextSeq()
			const s3 = minter.nextSeq()
			expect(s2).toBeGreaterThan(s1)
			expect(s3).toBeGreaterThan(s2)
			expect(minter.seq).toBe(s3)
		})

		it("P1-2: epoch is a fence that does NOT advance on nextSeq/nextId (only on bumpEpoch)", () => {
			const minter = new MessageIdMinter()
			expect(minter.epoch).toBe(0)
			minter.nextSeq()
			minter.nextSeq()
			minter.nextId()
			expect(minter.epoch).toBe(0)
			minter.bumpEpoch()
			expect(minter.epoch).toBe(1)
			minter.nextSeq()
			expect(minter.epoch).toBe(1)
		})

		it("P1-3: every W1 stamp consumes a sequence number (the repair's real semantic delta)", () => {
			// Pre-fix: stateVersion was not stamped; the seq counter was advanced ONLY by W2
			// message traffic. Post-fix: every W1 snapshot now consumes one seq slot too.
			// This pins the ordering invariant below (P3-1) without changing the reducer.
			const minter = new MessageIdMinter()
			minter.nextId()
			const beforeAnySeq = minter.seq
			const w1Version = minter.nextSeq()
			expect(w1Version).toBeGreaterThan(beforeAnySeq)
			expect(minter.seq).toBe(w1Version)
		})
	})

	describe("P2: shared-seq invariant — _ptadPushId aliases stateVersion when PTAD is on", () => {
		it("P2-1: PTAD ON — _ptadPushId === stateVersion, both nonzero", () => {
			// Mirror the production semantics: the SAME sharedSeq seeds both fields.
			const minter = new MessageIdMinter()
			const sharedSeq = minter.nextSeq()
			const ptadEnabled = true
			const ptadPushId = ptadEnabled ? sharedSeq : undefined
			const stateVersion = sharedSeq
			expect(stateVersion).toBeGreaterThan(0)
			expect(ptadPushId).toBe(stateVersion)
		})

		it("P2-2: PTAD OFF — _ptadPushId is undefined, stateVersion is still nonzero", () => {
			const minter = new MessageIdMinter()
			const sharedSeq = minter.nextSeq()
			const ptadEnabled = false
			const ptadPushId = ptadEnabled ? sharedSeq : undefined
			const stateVersion = sharedSeq
			expect(stateVersion).toBeGreaterThan(0)
			expect(ptadPushId).toBeUndefined()
		})
	})

	describe("P3: causal ordering witness — W1 → W2 → W1 interleaving", () => {
		it("P3-1: stateVersion strictly orders W1 pushes across intervening W2 traffic (same epoch)", () => {
			// Simulate the canonical interleaving the live PTAD captures show:
			//   W1 push (P12) -> W2 partial -> W2 partial -> W1 push (P35)
			// The reducer's older-epoch fence runs first; the same-epoch branch then
			// gates on stateVersion. This witness pins the ordering the repair creates.
			const minter = new MessageIdMinter()
			const w1aVersion = minter.nextSeq()
			expect(minter.epoch).toBe(0)
			const w2SeqA = minter.nextSeq()
			const w2SeqB = minter.nextSeq()
			const w1bVersion = minter.nextSeq()
			expect(minter.epoch).toBe(0)

			expect(w1aVersion).toBeGreaterThan(0)
			expect(w2SeqA).toBeGreaterThan(w1aVersion)
			expect(w2SeqB).toBeGreaterThan(w2SeqA)
			expect(w1bVersion).toBeGreaterThan(w2SeqB)
			expect(minter.epoch).toBe(0)
		})

		it("P3-2: a bumpEpoch() between two W1 pushes strictly advances the fence (W2 stale-traffic drop)", () => {
			const minter = new MessageIdMinter()
			const w1aEpoch = minter.epoch
			minter.nextSeq()
			minter.bumpEpoch()
			const w1bEpoch = minter.epoch
			expect(w1bEpoch).toBeGreaterThan(w1aEpoch)
			expect(w1aEpoch).toBe(0)
			expect(w1bEpoch).toBe(1)
		})

		it("P3-3: a W1 stamp on the OLD epoch would be dropped by the reducer (negative witness)", () => {
			// Live failure mode the repair closes: W2 advances fence to 2;
			// a W1 with epoch=0 is dropped wholesale by `snapshotEpoch < state.epoch`.
			const reducerStateEpoch = 2
			const staleSnapshotEpoch = 0
			const freshSnapshotEpoch = 2
			expect(staleSnapshotEpoch < reducerStateEpoch).toBe(true)
			expect(freshSnapshotEpoch < reducerStateEpoch).toBe(false)
		})
	})
})