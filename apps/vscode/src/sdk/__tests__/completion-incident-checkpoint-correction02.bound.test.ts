/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02 — CHECKPOINT BOUND
 *
 * The RED that demonstrated that the checkpoint's SINGLE-CAPSULE
 * fallback did not honour the 512-KiB byte bound.
 *
 * THE DEFECT
 * ----------
 * `buildBoundedCheckpoint()` drops the ordinary capsules until the
 * serialized checkpoint fits `maxBytes`. When even the ANOMALOUS
 * capsules alone do not fit, it falls back to "keep only the most
 * recent one" and returns that fallback WITHOUT checking its final
 * serialized size.
 *
 * A single anomalous capsule can be larger than the whole bound — the
 * recorder's per-capsule ring bound is a RECORD count, not a byte
 * count. The fallback therefore wrote a checkpoint OVER the 512-KiB
 * bound: the exact limit the bounded builder exists to enforce.
 *
 * THE FIX
 * -------
 * The single-capsule fallback verifies its own final serialized size.
 * When even one capsule is too large, it sheds that capsule's RECORDS
 * until it fits, and reports the shed records as dropped evidence.
 *
 * GREEN counterpart:
 * `completion-incident-checkpoint-correction02.bound.green.test.ts`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	getCompletionIncidentRecorderStats,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
	setCompletionIncidentRecorderBounds,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkpointCompletionIncidentCapsules, MAX_CHECKPOINT_BYTES } from "@/sdk/completion-incident-checkpoint-runtime"
import { emitSubmitAndExit, flush, makeFlightRecorderHarness } from "./completion-incident-flight-recorder-harness"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

let tmp: string

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "cifr-bound-"))
	resetCompletionIncidentRecorderForTests()
	setCompletionIncidentFlightRecorderEnabled(true)
})

afterEach(() => {
	if (existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
	resetCompletionIncidentRecorderForTests()
})

const context = () => ({ globalStorageUri: { fsPath: tmp } })

const CHECKPOINT_FILE = "completion-incident-checkpoint.json"

/**
 * Fill ONE anomalous capsule with enough records that its serialized
 * form alone exceeds the 512-KiB bound.
 *
 * The recorder's default per-capsule ring bound is a RECORD COUNT, so
 * a single capsule can legitimately exceed the byte bound. The
 * bounds are raised through the recorder's own configurable-bounds
 * seam — the production code path is unchanged.
 */
async function fillOneOversizedAnomalousCapsule(): Promise<void> {
	setCompletionIncidentRecorderBounds({
		capsuleCap: 4,
		capsuleRecordCap: 4096,
		globalRecordCap: 100_000,
		anomalousCapsuleRetention: 4,
	})
	// ONE task, so ONE capsule — and that capsule is ANOMALOUS (a
	// hold is an anomalous outcome), so it survives the ordinary
	// capsule drop and reaches the single-capsule fallback.
	//
	// Each captured record is ~1 KiB, so ~700 records in ONE capsule
	// push its serialized form past the 512-KiB bound.
	const h = makeFlightRecorderHarness({ activeSessionId: "session-big", activeTaskId: "task-big" })
	h.pendingPromptRead.value = { available: false }
	h.unconsumedCount.value = 3
	h.unconsumedJobIds.value = Array.from({ length: 200 }, (_, j) => `job-${j}`)
	for (let i = 0; i < 700; i++) {
		await emitSubmitAndExit(h)
		await flush()
	}
}

describe("BOUND.1: the checkpoint NEVER exceeds its byte bound", () => {
	it("BOUND.1.1: a single oversized capsule is still bounded", async () => {
		await fillOneOversizedAnomalousCapsule()
		const before = getCompletionIncidentRecorderStats()
		expect(before.capsuleCount).toBe(1)

		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		// The reported byte count is within the bound.
		expect(result.bytes).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES)

		// And the artifact ON DISK is within the bound — the bound is
		// enforced on the thing that is actually persisted, not just
		// on a reported number.
		const file = join(tmp, CHECKPOINT_FILE)
		expect(existsSync(file)).toBe(true)
		const onDisk = readFileSync(file)
		expect(onDisk.byteLength).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES)
	})

	it("BOUND.1.2: the shed records are reported as dropped evidence", async () => {
		await fillOneOversizedAnomalousCapsule()

		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		// The capsule had to shed records to fit, and that loss is
		// VISIBLE — never silently presented as a complete capture.
		expect(result.droppedRecords ?? 0).toBeGreaterThan(0)
		expect(getCompletionIncidentRecorderStats().checkpointTruncatedRecords ?? 0).toBeGreaterThan(0)
	})
})
