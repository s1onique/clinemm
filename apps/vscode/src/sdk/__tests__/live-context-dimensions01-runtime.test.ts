/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01
 *
 * Live-extraction witness tests for the LCD01 runtime module.
 *
 * The C1 commit shipped the in-memory webview ring buffer but did
 * NOT ship a dump/export path; C3 (live walk) would have lost the
 * evidence inside the webview process. C1-FIXUP01 adds the
 * extension-side flush sink:
 *
 *   - `appendWebviewSideLiveContextDimensions01(context, records)`
 *     accepts an array of unknown records, structural-validates
 *     them, and writes them to a JSONL file under
 *     `globalStorageUri/live-context-dimensions01-webview.jsonl`.
 *
 *   - `dumpWebviewSideLiveContextDimensions01ForTesting(context)`
 *     is a test-only helper that reads the webview ring buffer and
 *     flushes it directly to disk without spinning up a webview
 *     process. Used by R2 tests below.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	__resetLiveContextDimensions01CaptureForTesting,
	clearLiveContextDimensions01Capture,
	enableLiveContextDimensions01Capture,
	getLiveContextDimensions01CaptureRecords,
	type LiveContextDimensions01Capture,
	recordLiveContextDimensions01Capture,
} from "@shared/live-context-dimensions01-capture"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	appendWebviewSideLiveContextDimensions01,
	type LiveContextDimensions01RuntimeContext,
	dumpWebviewSideLiveContextDimensions01ForTesting,
} from "../live-context-dimensions01-runtime"

function fakeContext(storagePath: string): LiveContextDimensions01RuntimeContext {
	return {
		globalStorageUri: { fsPath: storagePath },
	}
}

let tmp: string
let context: ReturnType<typeof fakeContext>

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "lcd01-runtime-"))
	context = fakeContext(tmp)
	__resetLiveContextDimensions01CaptureForTesting()
	enableLiveContextDimensions01Capture()
})

afterEach(() => {
	__resetLiveContextDimensions01CaptureForTesting()
	if (existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

function emitW1(pushId: number, phase: "idle" | "streaming") {
	recordLiveContextDimensions01Capture({
		kind: "webview-w1-request",
		correlation: {
			associationQuality: "INTRINSIC",
			associatedPushId: pushId,
			intervalInferred: undefined,
		},
		hostTurnState: { phase, seq: pushId, anchorTs: pushId },
	})
}

function emitW2(seq: number, phase: "partial" | "final") {
	recordLiveContextDimensions01Capture({
		kind: "webview-w2-request",
		correlation: {
			associationQuality: "NONE",
			associatedPushId: undefined,
			intervalInferred: undefined,
		},
		nativeW2: { epoch: 1, seq, ts: seq, discriminator: phase },
	})
}
describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01 / runtime", () => {
	describe("R2: live extraction", () => {
		it("R2-1: webview dump writes a JSONL file under globalStorageUri", async () => {
			emitW1(1, "idle")
			emitW1(2, "streaming")
			emitW2(1, "partial")

			const path = await dumpWebviewSideLiveContextDimensions01ForTesting(context)
			expect(existsSync(path)).toBe(true)
			expect(path).toBe(join(tmp, "live-context-dimensions01-webview.jsonl"))

			const text = readFileSync(path, "utf8")
			const lines = text.split("\n").filter((line) => line.length > 0)
			expect(lines.length).toBe(3)

			const records = lines.map((line) => JSON.parse(line)) as LiveContextDimensions01Capture[]
			expect(records[0].kind).toBe("webview-w1-request")
			expect(records[0].correlation.associationQuality).toBe("INTRINSIC")
			expect(records[0].correlation.associatedPushId).toBe(1)
			expect(records[0].hostTurnState?.phase).toBe("idle")

			expect(records[1].kind).toBe("webview-w1-request")
			expect(records[1].correlation.associatedPushId).toBe(2)
			expect(records[1].hostTurnState?.phase).toBe("streaming")

			expect(records[2].kind).toBe("webview-w2-request")
			expect(records[2].correlation.associationQuality).toBe("NONE")
			expect(records[2].nativeW2?.seq).toBe(1)
			expect(records[2].nativeW2?.discriminator).toBe("partial")
		})

		it("R2-2: appendWebviewSideLiveContextDimensions01 accepts unknown[] and structurally validates", async () => {
			const validW1: LiveContextDimensions01Capture = {
				kind: "webview-w1-request",
				capturedAt: 1000,
				captureSeq: 1,
				correlation: {
					associationQuality: "INTRINSIC",
					associatedPushId: 1,
					intervalInferred: undefined,
				},
				hostTurnState: { phase: "idle", seq: 1, anchorTs: 1 },
			}
			const garbage1 = { not: "an lcd01 record" }
			const garbage2 = null
			const garbage3 = "string-not-object"

			const path = await appendWebviewSideLiveContextDimensions01(context, [
				validW1,
				garbage1,
				garbage2,
				garbage3,
			])
			expect(existsSync(path)).toBe(true)
			const text = readFileSync(path, "utf8")
			const lines = text.split("\n").filter((line) => line.length > 0)
			expect(lines.length).toBe(1)
			const parsed = JSON.parse(lines[0])
			expect(parsed.kind).toBe("webview-w1-request")
			expect(parsed.correlation.associatedPushId).toBe(1)
		})

		it("R2-3: an empty dump produces a file with zero records (empty file, not absent)", async () => {
			const path = await dumpWebviewSideLiveContextDimensions01ForTesting(context)
			expect(existsSync(path)).toBe(true)
			const text = readFileSync(path, "utf8")
			expect(text).toBe("")
		})

		it("R2-4: fresh install - globalStorageUri directory does not exist yet, dump creates it", async () => {
			const freshDir = join(tmp, "fresh-install", "does-not-exist")
			const freshContext = fakeContext(freshDir)
			expect(existsSync(freshDir)).toBe(false)
			emitW1(1, "idle")
			const path = await dumpWebviewSideLiveContextDimensions01ForTesting(freshContext)
			expect(existsSync(path)).toBe(true)
			expect(existsSync(freshDir)).toBe(true)
			const text = readFileSync(path, "utf8")
			expect(text.length).toBeGreaterThan(0)
		})

		it("R2-5: clear after dump does NOT affect the next dump's content", async () => {
			emitW1(1, "idle")
			await dumpWebviewSideLiveContextDimensions01ForTesting(context)
			clearLiveContextDimensions01Capture()
			expect(getLiveContextDimensions01CaptureRecords().length).toBe(0)
			emitW1(2, "streaming")
			const path2 = await dumpWebviewSideLiveContextDimensions01ForTesting(context)
			const text = readFileSync(path2, "utf8")
			const lines = text.split("\n").filter((l) => l.length > 0)
			expect(lines.length).toBe(1)
			const parsed = JSON.parse(lines[0])
			expect(parsed.correlation.associatedPushId).toBe(2)
		})
	})

	describe("R3: strict validator rejects malformed webview input", () => {
		async function expectZeroPersisted(records: readonly unknown[]): Promise<void> {
			const path = await appendWebviewSideLiveContextDimensions01(context, records)
			expect(existsSync(path)).toBe(true)
			const text = readFileSync(path, "utf8")
			const lines = text.split("\n").filter((l) => l.length > 0)
			expect(lines.length).toBe(0)
		}

		it("R3-1: UNKNOWN capture kind is rejected (no record touches disk)", async () => {
			await expectZeroPersisted([
				{
					kind: "webview-totally-unknown",
					capturedAt: 1,
					captureSeq: 1,
					correlation: { associationQuality: "NONE", associatedPushId: undefined },
				},
			])
		})

		it("R3-2: W2 record with INTRINSIC association is rejected", async () => {
			await expectZeroPersisted([
				{
					kind: "webview-w2-request",
					capturedAt: 1,
					captureSeq: 1,
					correlation: { associationQuality: "INTRINSIC", associatedPushId: 7 },
					nativeW2: { epoch: 1, seq: 1, ts: 1, discriminator: "partial" },
				},
			])
		})

		it("R3-3: non-W2 record with INTERVAL_INFERRED association is rejected", async () => {
			await expectZeroPersisted([
				{
					kind: "webview-w1-request",
					capturedAt: 1,
					captureSeq: 1,
					correlation: {
						associationQuality: "INTERVAL_INFERRED",
						associatedPushId: undefined,
						intervalInferred: { previousPushId: 1, nextPushId: 2 },
					},
				},
			])
		})

		it("R3-4: W2 record missing nativeW2 identity is rejected", async () => {
			await expectZeroPersisted([
				{
					kind: "webview-w2-request",
					capturedAt: 1,
					captureSeq: 1,
					correlation: { associationQuality: "NONE", associatedPushId: undefined },
					// no nativeW2
				},
			])
		})

		it("R3-5: non-W2 record carrying nativeW2 identity is rejected (field exclusivity)", async () => {
			await expectZeroPersisted([
				{
					kind: "webview-w1-request",
					capturedAt: 1,
					captureSeq: 1,
					correlation: { associationQuality: "INTRINSIC", associatedPushId: 7 },
					nativeW2: { epoch: 1, seq: 1, ts: 1, discriminator: "partial" },
				},
			])
		})

		it("R3-6: well-formed records are still persisted (positive control)", async () => {
			emitW1(1, "idle")
			const path = await appendWebviewSideLiveContextDimensions01(context, [
				...getLiveContextDimensions01CaptureRecords(),
			])
			const text = readFileSync(path, "utf8")
			const lines = text.split("\n").filter((l) => l.length > 0)
			expect(lines.length).toBe(1)
		})
	})
})
