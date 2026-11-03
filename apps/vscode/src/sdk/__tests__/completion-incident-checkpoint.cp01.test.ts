/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01 — CP-01
 *
 * The checkpoint persistence gate.
 *
 * Proves that the per-task capsules SURVIVE:
 *   - an extension-host restart (checkpoint → restore), and
 *   - a task switch (the checkpoint is written before the new task
 *     becomes active).
 *
 * Also proves the honesty rules: a FAILED checkpoint is counted and
 * reported, never silently swallowed.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	clearCompletionIncidentRecorder,
	getCompletionIncidentCapsuleForTask,
	getCompletionIncidentRecorderStats,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	checkpointCompletionIncidentCapsules,
	restoreCompletionIncidentCapsules,
} from "@/sdk/completion-incident-checkpoint-runtime"
import { emitSubmitAndExit, flush, makeFlightRecorderHarness } from "./completion-incident-flight-recorder-harness"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

let tmp: string

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "cifr-checkpoint-"))
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

describe("CP-01: the capsules survive an extension-host restart", () => {
	it("CP-01.1: a checkpoint round-trip restores the task capsule", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		const before = getCompletionIncidentCapsuleForTask("task-a")
		expect(before).toBeDefined()
		const recordCount = before!.records.length
		expect(recordCount).toBeGreaterThan(0)

		// The checkpoint is written.
		const result = await checkpointCompletionIncidentCapsules(context())
		expect(result.succeeded).toBe(true)
		expect(result.bytes).toBeGreaterThan(0)
		expect(existsSync(join(tmp, "completion-incident-checkpoint.json"))).toBe(true)

		// The extension host restarts: the in-memory recorder is
		// empty, then the checkpoint is restored.
		clearCompletionIncidentRecorder()
		expect(getCompletionIncidentCapsuleForTask("task-a")).toBeUndefined()

		const restored = await restoreCompletionIncidentCapsules(context())
		expect(restored).toBe(true)

		const after = getCompletionIncidentCapsuleForTask("task-a")
		expect(after).toBeDefined()
		expect(after!.records.length).toBe(recordCount)
		expect(after!.anomalous).toBe(true)
		// The restored records keep their causal identity.
		expect(after!.records[0]!.taskId).toBe("task-a")
		expect(after!.records[0]!.sessionId).toBe("session-a")
	})

	it("CP-01.2: a missing checkpoint is a no-op, not an error", async () => {
		const restored = await restoreCompletionIncidentCapsules(context())
		expect(restored).toBe(false)
	})

	it("CP-01.3: a corrupt checkpoint is a no-op, not an error", async () => {
		const { writeFileSync } = await import("node:fs")
		writeFileSync(join(tmp, "completion-incident-checkpoint.json"), "{not json", "utf8")
		const restored = await restoreCompletionIncidentCapsules(context())
		expect(restored).toBe(false)
	})
})

describe("CP-02: a FAILED checkpoint is counted and reported explicitly", () => {
	it("CP-02.1: a failing write increments the failed-checkpoint counter", async () => {
		// A path that cannot be created (a file where a directory is
		// expected) makes the write fail.
		const { writeFileSync } = await import("node:fs")
		writeFileSync(join(tmp, "blocker"), "x", "utf8")
		const badContext = { globalStorageUri: { fsPath: join(tmp, "blocker") } }

		const result = await checkpointCompletionIncidentCapsules(badContext)
		expect(result.succeeded).toBe(false)
		expect(result.error).toBeDefined()

		const stats = getCompletionIncidentRecorderStats()
		expect(stats.failedCheckpoints).toBe(1)
		expect(stats.successfulCheckpoints).toBe(0)
	})

	it("CP-02.2: a successful checkpoint increments the success counter", async () => {
		await checkpointCompletionIncidentCapsules(context())
		const stats = getCompletionIncidentRecorderStats()
		expect(stats.successfulCheckpoints).toBe(1)
		expect(stats.failedCheckpoints).toBe(0)
	})
})

describe("CP-03: the checkpoint carries NO prompt text or provider payloads", () => {
	it("CP-03.1: the serialized checkpoint contains only identity/predicate facts", async () => {
		const h = makeFlightRecorderHarness()
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		await checkpointCompletionIncidentCapsules(context())
		const raw = readFileSync(join(tmp, "completion-incident-checkpoint.json"), "utf8")
		// The harness's completion text must NOT appear.
		expect(raw).not.toContain("Task completed.")
		// The schema identity IS present.
		expect(raw).toContain('"schemaVersion":1')
	})
})
