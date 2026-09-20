/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
 *
 * Production-dump roundtrip test for the Background Owner
 * Correlation (BOCOR) diagnostic. Mirrors the W carrier /
 * TSWPD / THSICAP roundtrip shape:
 *
 *   operator action
 *   -> VS Code command
 *   -> dumpExtensionSideBackgroundOwnerCorrelationDiagnostic()
 *   -> file
 *   -> JSONL parse
 *   -> exact correlation fields survive
 *
 * BOCOR-DUMP-01 (capture -> dump -> parse): exercises the
 * non-empty case with all required correlation fields preserved.
 *
 * BOCOR-DUMP-EMPTY: empty ring produces an explicit empty file
 * (mirrors the THSICAP convention).
 *
 * BOCOR-DOGFOOD-OFF: when the capture seam is OFF, the dump
 * emits no records (the recorder bails).
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	captureBackgroundOwnerCorrelationRecord,
	clearBackgroundOwnerCorrelationCaptureRecords,
	setBackgroundOwnerCorrelationCaptureEnabled,
	type BackgroundOwnerCorrelationRecord,
} from "../background-owner-correlation"
import {
	dumpExtensionSideBackgroundOwnerCorrelationDiagnostic,
	type BackgroundOwnerCorrelationDiagnosticContext,
} from "../background-owner-correlation-runtime"

const makeRecord = (overrides: Partial<BackgroundOwnerCorrelationRecord> = {}): BackgroundOwnerCorrelationRecord => ({
	event: "background_owner_correlation_decision",
	capturedAt: Date.now(),
	taskId: "1789897019328_sn0k5",
	sessionEventSessionId: "session-EVT",
	activeSessionId: "session-A",
	currentPhase: "streaming",
	candidatePhase: "awaiting_followup",
	guardAvailable: true,
	queriedOwnerSessionId: "session-A",
	guardResult: false,
	activeJobs: [
		{
			jobId: "cmd_xyz",
			state: "running",
			ownerSessionId: "session-A",
		},
	],
	candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
	...overrides,
})

describe("ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01 / BOCOR dump roundtrip", () => {
	let dirs: string[] = []

	beforeEach(() => {
		clearBackgroundOwnerCorrelationCaptureRecords()
		setBackgroundOwnerCorrelationCaptureEnabled(false)
	})

	afterEach(async () => {
		clearBackgroundOwnerCorrelationCaptureRecords()
		setBackgroundOwnerCorrelationCaptureEnabled(false)
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
		dirs = []
	})

	function makeContext(): { ctx: BackgroundOwnerCorrelationDiagnosticContext; dir: string } {
		const dir = mkdtempSync(join(tmpdir(), "bocor-roundtrip-"))
		dirs.push(dir)
		const ctx: BackgroundOwnerCorrelationDiagnosticContext = {
			globalStorageUri: { fsPath: dir },
		}
		return { ctx, dir }
	}

	it("BOCOR-DUMP-01: dogfood capture -> production dump -> JSONL contains the exact correlation tuple", async () => {
		// 1) Activate the capture seam (mirrors dogfood activation path).
		setBackgroundOwnerCorrelationCaptureEnabled(true)

		// 2) Build a real temporary context (mirrors production
		//    globalStorageUri authority).
		const { ctx, dir } = makeContext()

		// 3) Compose one realistic record at the Q5 decision boundary.
		const record = makeRecord({
			taskId: "1789897019328_sn0k5",
			sessionEventSessionId: "session-1789897019328",
			activeSessionId: "session-1789897019328",
			guardAvailable: true,
			queriedOwnerSessionId: "session-1789897019328",
			guardResult: false,
			activeJobs: [
				{
					jobId: "cmd_mu9mh0uahxjkxbo3",
					state: "running",
					ownerSessionId: "session-1789897019328",
				},
			],
		})
		captureBackgroundOwnerCorrelationRecord(record)

		// 4) Operator invokes the production dump command path.
		const { file, recordCount } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)

		// 5) JSONL roundtrip equality: the exact correlation fields survive.
		expect(file).toBe(join(dir, "background-owner-correlation.jsonl"))
		expect(recordCount).toBe(1)
		const text = readFileSync(file, "utf8")
		const lines = text.split("\n").filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0]) as BackgroundOwnerCorrelationRecord
		expect(parsed).toEqual(record)
		// Spot-check the exact correlation fields the operator needs.
		expect(parsed.activeJobs[0].jobId).toBe("cmd_mu9mh0uahxjkxbo3")
		expect(parsed.activeJobs[0].state).toBe("running")
		expect(parsed.activeJobs[0].ownerSessionId).toBe("session-1789897019328")
		expect(parsed.activeSessionId).toBe("session-1789897019328")
		expect(parsed.queriedOwnerSessionId).toBe("session-1789897019328")
		expect(parsed.guardResult).toBe(false)
		expect(parsed.guardAvailable).toBe(true)
		expect(parsed.candidateWriterId).toBe("session-event-turn-complete-resumable-straggler-preserve")
	})

	it("BOCOR-DUMP-EMPTY: empty ring -> dump writes an empty file (no records)", async () => {
		const { ctx, dir } = makeContext()
		const { file, recordCount } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(recordCount).toBe(0)
		expect(file).toBe(join(dir, "background-owner-correlation.jsonl"))
		const text = readFileSync(file, "utf8")
		expect(text).toBe("")
	})

	it("BOCOR-DOGFOOD-OFF: capture seam OFF -> recorder bails -> dump file has zero records", async () => {
		// Seam stays OFF (default).
		expect(false).toBe(false)
		const { ctx, dir } = makeContext()
		captureBackgroundOwnerCorrelationRecord(makeRecord())
		const { file, recordCount } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(recordCount).toBe(0)
		const text = readFileSync(file, "utf8")
		expect(text).toBe("")
		expect(file).toBe(join(dir, "background-owner-correlation.jsonl"))
	})

	it("dump != clear: two consecutive dumps both contain the records (no implicit ring wipe)", async () => {
		setBackgroundOwnerCorrelationCaptureEnabled(true)
		const { ctx } = makeContext()
		captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 100 }))
		captureBackgroundOwnerCorrelationRecord(makeRecord({ capturedAt: 200 }))
		const r1 = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(readFileSync(r1.file, "utf8").split("\n").filter((l) => l.length > 0)).toHaveLength(2)
		const r2 = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(readFileSync(r2.file, "utf8").split("\n").filter((l) => l.length > 0)).toHaveLength(2)
		expect(r1.recordCount).toBe(2)
		expect(r2.recordCount).toBe(2)
	})
})
