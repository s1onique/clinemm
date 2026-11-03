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
	getCompletionIncidentCapsules,
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
async function fillOneOversizedAnomalousCapsule(): Promise<number> {
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
	// The number of records the capsule held BEFORE the checkpoint had
	// to shed any of them. The exact loss accounting is asserted
	// against this number.
	const capsules = getCompletionIncidentCapsules()
	expect(capsules).toHaveLength(1)
	return capsules[0]?.records.length ?? 0
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
		const originalRecordCount = await fillOneOversizedAnomalousCapsule()

		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		// The capsule had to shed records to fit, and that loss is
		// VISIBLE — never silently presented as a complete capture.
		expect(result.droppedRecords ?? 0).toBeGreaterThan(0)
		expect(getCompletionIncidentRecorderStats().checkpointTruncatedRecords ?? 0).toBeGreaterThan(0)
	})

	it("BOUND.1.3: the reported loss is EXACTLY the number of records dropped", async () => {
		const originalRecordCount = await fillOneOversizedAnomalousCapsule()

		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		// The number of records actually PERSISTED, read back from the
		// artifact on disk.
		const persisted = JSON.parse(readFileSync(join(tmp, CHECKPOINT_FILE), "utf8")) as {
			capsules: { records: unknown[] }[]
		}
		const persistedRecordCount = persisted.capsules.reduce((sum, c) => sum + c.records.length, 0)

		// The loss accounting must be EXACT: the reported count is the
		// difference between what the recorder held and what survived
		// into the persisted artifact.
		//
		// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION03: the
		// previous implementation always reported `1` here (the shed
		// count was derived from `slice(0, -1)`, which removes exactly
		// one element), so a checkpoint that discarded hundreds of
		// records understated the loss by hundreds. This assertion
		// pins the EXACT accounting.
		expect(result.droppedRecords).toBe(originalRecordCount - persistedRecordCount)

		// And the persisted artifact's own stats block carries the same
		// exact number — the artifact declares its own loss.
		const stats = JSON.parse(readFileSync(join(tmp, CHECKPOINT_FILE), "utf8")) as {
			stats: { checkpointTruncatedRecords: number }
		}
		expect(stats.stats.checkpointTruncatedRecords).toBe(originalRecordCount - persistedRecordCount)
	})

	it("BOUND.1.4: the shed preserves the NEWEST causal records", async () => {
		await fillOneOversizedAnomalousCapsule()
		const before = getCompletionIncidentCapsules()
		const newestBefore = before[0]?.records.at(-1)

		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		const persisted = JSON.parse(readFileSync(join(tmp, CHECKPOINT_FILE), "utf8")) as {
			capsules: { records: { eventSeq: number }[] }[]
		}
		const newestAfter = persisted.capsules[0]?.records.at(-1)

		// The NEWEST record (the one closest to the incident's terminal
		// state) is the most valuable during diagnosis and must survive
		// the truncation. The previous implementation shed the tail
		// (`slice(0, -1)`) and kept the OLDEST instead.
		expect(newestBefore).toBeDefined()
		expect(newestAfter).toBeDefined()
		expect(newestAfter?.eventSeq).toBe(newestBefore?.eventSeq)
	})
})
