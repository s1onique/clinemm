/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — persistence gate.
 *
 * The abnormal-terminal artifact must be:
 *   - WRITTEN to a KNOWN local path (no manual chronology reconstruction),
 *   - ATOMIC (a reader never sees a partial artifact),
 *   - RESTRICTED (owner-only permissions),
 *   - ABSENT when nothing abnormal happened (the absence is itself a fact),
 *   - NEVER uploaded.
 */
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ModelBehaviorTraceRecorder } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { _dumpSdkAbortCauseSnapshots, SDK_ABORT_CAUSE_DUMP_FILE } from "../model-behavior-trace-runtime"
import {
	_resetSdkAbortCauseRetention,
	captureSdkAbortCauseSnapshot,
	observeSdkAbortCauseRecord,
	setSdkAbortCauseRecordProvider,
} from "../sdk-abort-cause-retention"

let dir: string

beforeEach(async () => {
	_resetSdkAbortCauseRetention()
	dir = await mkdtemp(join(tmpdir(), "abort-cause-dump-"))
})

afterEach(() => {
	_resetSdkAbortCauseRetention()
})

describe("ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01 — persistence", () => {
	it("writes a self-contained artifact with the correlated evidence", async () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		const record = recorder.record(
			"model_request_start",
			{ sessionId: "s-p", taskId: "t-p", runId: "r-p", modelRequestId: "req-p" },
			{},
		)!
		observeSdkAbortCauseRecord(record)
		const terminal = recorder.record(
			"run_terminated",
			{ sessionId: "s-p", taskId: "t-p", runId: "r-p" },
			{ status: "aborted", terminalPath: "observed_cancellation" },
		)!
		observeSdkAbortCauseRecord(terminal)
		captureSdkAbortCauseSnapshot(terminal)

		const result = await _dumpSdkAbortCauseSnapshots({
			globalStorageUri: { fsPath: dir },
			workspaceState: { get: () => undefined, update: async () => {} },
		})
		expect(result).toBeDefined()
		expect(result?.snapshotCount).toBe(1)

		const filePath = join(dir, SDK_ABORT_CAUSE_DUMP_FILE)
		const raw = await readFile(filePath, "utf8")
		const parsed = JSON.parse(raw)
		expect(parsed.kind).toBe("sdk_abort_cause_snapshots")
		expect(parsed.snapshotCount).toBe(1)
		const snapshot = parsed.snapshots[0]
		expect(snapshot.status).toBe("aborted")
		expect(snapshot.identity.runId).toBe("r-p")
		// The chronology is IN the artifact — no manual reconstruction.
		expect(snapshot.events.map((e: { event: string }) => e.event)).toEqual(["model_request_start", "run_terminated"])
		// The per-request correlation id is present in the artifact.
		expect(snapshot.events[0].modelRequestId).toBe("req-p")

		// The artifact is RESTRICTED (owner-only).
		const stats = await stat(filePath)
		expect(stats.mode & 0o077).toBe(0)
	})

	it("writes NO artifact when nothing abnormal happened", async () => {
		const recorder = new ModelBehaviorTraceRecorder()
		recorder.setEnabled(true)
		setSdkAbortCauseRecordProvider(() => recorder.getRecords())

		const terminal = recorder.record("run_terminated", { sessionId: "s-n", runId: "r-n" }, { status: "completed" })!
		observeSdkAbortCauseRecord(terminal)
		captureSdkAbortCauseSnapshot(terminal)

		const result = await _dumpSdkAbortCauseSnapshots({
			globalStorageUri: { fsPath: dir },
			workspaceState: { get: () => undefined, update: async () => {} },
		})
		expect(result).toBeUndefined()
		// The ABSENCE of the artifact is the fact.
		await expect(readFile(join(dir, SDK_ABORT_CAUSE_DUMP_FILE), "utf8")).rejects.toThrow()
	})
})
