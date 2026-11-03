/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01 — LOSS
 *
 * The RED that demonstrated that checkpoint TRUNCATION silently lost
 * evidence, and that the loss accounting did not survive a restart.
 *
 * THE DEFECT
 * ----------
 * `buildBoundedCheckpoint()` computes `droppedCapsules` when it
 * shrinks the checkpoint to fit the 512-KiB bound, but the caller
 * DISCARDED the result:
 *
 *   const { checkpoint, bytes } = buildBoundedCheckpoint(MAX_CHECKPOINT_BYTES)
 *
 * So capsules dropped by truncation were never counted as evidence
 * loss. Worse, `restoreCompletionIncidentCheckpoint()` restored the
 * capsules but NOT the checkpoint's previous eviction/failure
 * statistics. After a restart the bundle could report
 * `evidenceLoss: false` even though records HAD been lost during
 * checkpoint truncation.
 *
 * Additionally, the bound was enforced with `String.length` (UTF-16
 * code units) rather than actual UTF-8 byte counts, so a checkpoint
 * containing multi-byte characters could exceed the 512-KiB bound on
 * disk.
 *
 * THE FIX
 * -------
 *   1. Truncation loss is counted into the recorder's loss accounting.
 *   2. The loss statistics survive checkpoint → restore.
 *   3. The 512-KiB bound is enforced with actual UTF-8 byte counts.
 *
 * GREEN counterpart:
 * `completion-incident-checkpoint-correction01.green.test.ts`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	clearCompletionIncidentRecorder,
	getCompletionIncidentRecorderStats,
	getCompletionIncidentRecords,
	hasCompletionIncidentEvidenceLoss,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
	setCompletionIncidentRecorderBounds,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildCompletionIncidentBundleSummaries, dumpCompletionIncidentBundle } from "@/sdk/completion-incident-bundle-runtime"
import {
	checkpointCompletionIncidentCapsules,
	MAX_CHECKPOINT_BYTES,
	restoreCompletionIncidentCapsules,
} from "@/sdk/completion-incident-checkpoint-runtime"
import { emitSubmitAndExit, flush, makeFlightRecorderHarness } from "./completion-incident-flight-recorder-harness"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

let tmp: string

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "cifr-loss-"))
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

/**
 * Fill the recorder with enough capsules that the serialized
 * checkpoint exceeds the 512-KiB bound and the bounded builder has
 * to drop capsules.
 *
 * The recorder's DEFAULT caps (16 capsules / 2048 records) keep the
 * checkpoint far below the byte bound, so the truncation path is
 * reached by RAISING the configurable bounds — the same bounded
 * configuration seam the recorder exposes for diagnostics. The
 * truncation path itself is unchanged production code.
 */
async function fillRecorderBeyondCheckpointBound(): Promise<number> {
	setCompletionIncidentRecorderBounds({
		capsuleCap: 500,
		capsuleRecordCap: 256,
		globalRecordCap: 100_000,
		anomalousCapsuleRetention: 500,
	})
	// Each task capsule carries a sizeable, privacy-safe record so
	// that a modest number of tasks exceeds the bound.
	for (let i = 0; i < 200; i++) {
		const taskId = `task-${String(i).padStart(3, "0")}`
		const h = makeFlightRecorderHarness({ activeSessionId: `session-${i}`, activeTaskId: taskId })
		h.pendingPromptRead.value = { available: false }
		h.unconsumedCount.value = 3
		h.unconsumedJobIds.value = Array.from({ length: 12 }, (_, j) => `job-${i}-${j}`)
		await emitSubmitAndExit(h)
		await flush()
	}
	return getCompletionIncidentRecorderStats().capsuleCount
}

describe("LOSS.1: checkpoint TRUNCATION is counted as evidence loss", () => {
	it("LOSS.1.1: a truncated checkpoint records the dropped capsules in the loss accounting", async () => {
		const capsuleCount = await fillRecorderBeyondCheckpointBound()
		expect(capsuleCount).toBeGreaterThan(1)

		const before = getCompletionIncidentRecorderStats()
		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		const after = getCompletionIncidentRecorderStats()
		// The truncation loss is VISIBLE in the recorder's accounting.
		expect(after.checkpointTruncatedCapsules ?? 0).toBeGreaterThan(0)
		// And the loss is declared.
		expect(hasCompletionIncidentEvidenceLoss()).toBe(true)
		expect(after.evictedCapsules).toBeGreaterThanOrEqual(before.evictedCapsules)
	})
})

describe("LOSS.2: the loss accounting SURVIVES a restart", () => {
	it("LOSS.2.1: checkpoint → clear → restore keeps the loss accounting", async () => {
		await fillRecorderBeyondCheckpointBound()

		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)
		expect(getCompletionIncidentRecorderStats().checkpointTruncatedCapsules ?? 0).toBeGreaterThan(0)

		// The extension host restarts: the in-memory recorder is
		// cleared, then the checkpoint is restored.
		clearCompletionIncidentRecorder()
		expect(hasCompletionIncidentEvidenceLoss()).toBe(false)

		const restored = await restoreCompletionIncidentCapsules(context())
		expect(restored).toBe(true)

		// The loss is STILL declared after the restart. The bundle
		// must never report `evidenceLoss: false` for a capture that
		// lost records during truncation.
		const stats = getCompletionIncidentRecorderStats()
		expect(stats.checkpointTruncatedCapsules ?? 0).toBeGreaterThan(0)
		expect(hasCompletionIncidentEvidenceLoss()).toBe(true)
	})
})

describe("LOSS.3: the 512-KiB bound is enforced with ACTUAL UTF-8 byte counts", () => {
	it("LOSS.3.1: the persisted checkpoint never exceeds the byte bound", async () => {
		await fillRecorderBeyondCheckpointBound()
		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)

		const raw = readFileSync(join(tmp, "completion-incident-checkpoint.json"))
		expect(raw.byteLength).toBeLessThanOrEqual(MAX_CHECKPOINT_BYTES)
		expect(result.bytes).toBe(raw.byteLength)
	})
})

describe("LOSS.4: checkpoint truncation → restart → BUNDLE declares the loss", () => {
	it("LOSS.4.1: the dumped bundle reports evidenceLoss: true after a truncating restart", async () => {
		await fillRecorderBeyondCheckpointBound()
		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)
		expect(result.droppedCapsules ?? 0).toBeGreaterThan(0)

		// The extension host restarts: the in-memory recorder is
		// cleared, then the checkpoint is restored.
		clearCompletionIncidentRecorder()
		expect(hasCompletionIncidentEvidenceLoss()).toBe(false)
		expect(await restoreCompletionIncidentCapsules(context())).toBe(true)
		expect(hasCompletionIncidentEvidenceLoss()).toBe(true)

		// The BUNDLE must declare the loss — it must never present a
		// truncated capture as complete.
		const bundleDir = await dumpCompletionIncidentBundle(context(), {
			extensionVersion: "0.0.0-test",
			sourceCommit: "deadbeef",
			captureProfiles: ["dogfood"],
		})
		const manifest = JSON.parse(readFileSync(join(bundleDir, "manifest.json"), "utf8")) as {
			droppedRecords: {
				checkpointTruncatedCapsules: number
				checkpointTruncatedRecords: number
				evidenceLoss: boolean
			}
		}
		expect(manifest.droppedRecords.evidenceLoss).toBe(true)
		expect(manifest.droppedRecords.checkpointTruncatedCapsules).toBeGreaterThan(0)
		expect(manifest.droppedRecords.checkpointTruncatedRecords).toBeGreaterThan(0)
	})

	it("LOSS.4.2: a lossy incident is NEVER reported as CAPTURE_SUFFICIENT", async () => {
		await fillRecorderBeyondCheckpointBound()
		await checkpointCompletionIncidentCapsules(context())
		clearCompletionIncidentRecorder()
		await restoreCompletionIncidentCapsules(context())

		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		expect(summaries.length).toBeGreaterThan(0)
		for (const summary of summaries) {
			expect(summary.status).not.toBe("CAPTURE_SUFFICIENT")
			expect(summary.status).toBe("CAPTURE_EVIDENCE_LOST")
			expect(summary.evidenceLoss).toBe(true)
		}
	})
})
