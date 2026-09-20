/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01-CORRECTION01
 *
 * Tests for the dogfood-profile activation helper for the
 * Background Owner Correlation (BOCOR) capture seam.
 *
 * CORRECTION01 - bounded: the env-var override layer was REMOVED
 * per the Factory reviewer. Enablement is now STRICTLY:
 *
 *   dogfood profile enabled  -> ON
 *   dogfood profile disabled -> OFF
 *
 * No env var. No parser. No override matrix. This file no
 * longer tests env-var precedence (that layer is gone).
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { applyBackgroundOwnerCorrelationDiagnosticProfile } from "../dogfood-diagnostic-profile"
import {
	captureBackgroundOwnerCorrelationRecord,
	clearBackgroundOwnerCorrelationCaptureRecords,
	isBackgroundOwnerCorrelationCaptureEnabled,
	setBackgroundOwnerCorrelationCaptureEnabled,
} from "../background-owner-correlation"
import {
	dumpExtensionSideBackgroundOwnerCorrelationDiagnostic,
	type BackgroundOwnerCorrelationDiagnosticContext,
} from "../background-owner-correlation-runtime"

describe("ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01-CORRECTION01 / BOCOR dogfood profile", () => {
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
		const dir = mkdtempSync(join(tmpdir(), "bocordp-"))
		dirs.push(dir)
		const ctx: BackgroundOwnerCorrelationDiagnosticContext = {
			globalStorageUri: { fsPath: dir },
		}
		return { ctx, dir }
	}

	it("dogfood = true flips the seam ON (flipped=true)", () => {
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile(true)
		expect(r).toEqual({ enabled: true, flipped: true })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
	})

	it("dogfood = false keeps the seam OFF (flipped=false because already OFF)", () => {
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile(false)
		expect(r).toEqual({ enabled: false, flipped: false })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
	})

	it("is idempotent (no flip on repeated call with same isDogfood)", () => {
		const r1 = applyBackgroundOwnerCorrelationDiagnosticProfile(true)
		const r2 = applyBackgroundOwnerCorrelationDiagnosticProfile(true)
		expect(r1.flipped).toBe(true)
		expect(r2.flipped).toBe(false)
		expect(r2.enabled).toBe(true)
	})

	it("dogfood=true then dogfood=false flips an ON seam to OFF", () => {
		applyBackgroundOwnerCorrelationDiagnosticProfile(true)
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile(false)
		expect(r).toEqual({ enabled: false, flipped: true })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
	})

	it("dogfood=false then dogfood=true flips an OFF seam to ON", () => {
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile(true)
		expect(r).toEqual({ enabled: true, flipped: true })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
	})

	it("roundtrip: dogfood=true -> capture records -> dump yields the record", async () => {
		applyBackgroundOwnerCorrelationDiagnosticProfile(true)
		const { ctx, dir } = makeContext()
		captureBackgroundOwnerCorrelationRecord({
			event: "background_owner_correlation_decision",
			capturedAt: 1,
			taskId: null,
			sessionEventSessionId: null,
			activeSessionId: "session-A",
			currentPhase: "streaming",
			candidatePhase: "awaiting_followup",
			guardAvailable: true,
			queriedOwnerSessionId: "session-A",
			guardResult: true,
			activeJobs: [{ jobId: "cmd_x", state: "running", ownerSessionId: "session-A" }],
			candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
		})
		const { file } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(file).toBe(join(dir, "background-owner-correlation.jsonl"))
		const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
	})

	it("roundtrip: dogfood=false -> capture bails -> dump yields an empty file", async () => {
		// Seam stays OFF.
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
		const { ctx, dir } = makeContext()
		captureBackgroundOwnerCorrelationRecord({
			event: "background_owner_correlation_decision",
			capturedAt: 1,
			taskId: null,
			sessionEventSessionId: null,
			activeSessionId: "session-A",
			currentPhase: "streaming",
			candidatePhase: "awaiting_followup",
			guardAvailable: true,
			queriedOwnerSessionId: "session-A",
			guardResult: true,
			activeJobs: [{ jobId: "cmd_x", state: "running", ownerSessionId: "session-A" }],
			candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
		})
		const { file } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(file).toBe(join(dir, "background-owner-correlation.jsonl"))
		const text = readFileSync(file, "utf8")
		expect(text).toBe("")
	})
})
