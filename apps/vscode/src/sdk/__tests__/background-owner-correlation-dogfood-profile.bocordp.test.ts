/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
 *
 * Tests for the central dogfood profile resolver and the
 * activation helper for the Background Owner Correlation (BOCOR)
 * capture seam. Mirrors the W carrier / THSICAP / D-knob
 * activation test shape:
 *
 *   - parseBackgroundOwnerCorrelationCaptureEnv matrix
 *   - resolveEffectiveBackgroundOwnerCorrelationCapture matrix
 *   - applyBackgroundOwnerCorrelationDiagnosticProfile
 *     idempotency + flip semantics
 *   - explicit override-down flips an ON activation to OFF
 *   - the recorder + dump roundtrip honor the seam state
 *
 * Per the operator's review (mirroring the W carrier profile
 * matrix):
 *
 *   dogfood + unset   -> ON
 *   public  + unset   -> OFF
 *   dogfood + "0"     -> OFF (override-down)
 *   public  + "1"     -> ON  (override-up)
 *
 *   dogfood profile + capture ON  -> roundtrip yields records
 *   dogfood profile + capture OFF -> roundtrip yields empty
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	applyBackgroundOwnerCorrelationDiagnosticProfile,
	parseBackgroundOwnerCorrelationCaptureEnv,
	resolveEffectiveBackgroundOwnerCorrelationCapture,
} from "../dogfood-diagnostic-profile"
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

describe("parseBackgroundOwnerCorrelationCaptureEnv", () => {
	const cases: Array<[string | undefined, boolean | undefined]> = [
		[undefined, undefined],
		["", undefined],
		["garbage", undefined],
		["0", false],
		["off", false],
		["false", false],
		["1", true],
		["true", true],
		["yes", true],
		["TRUE", true],
		["  off  ", false],
	]
	for (const [input, expected] of cases) {
		it(`returns ${JSON.stringify(expected)} for ${JSON.stringify(input)}`, () => {
			const env = input === undefined ? {} : { CLINEMM_DIAG_BACKGROUND_OWNER_CORRELATION_V1: input }
			expect(parseBackgroundOwnerCorrelationCaptureEnv(env)).toEqual(
				expected === undefined ? undefined : { enabled: expected },
			)
		})
	}
})

describe("resolveEffectiveBackgroundOwnerCorrelationCapture precedence", () => {
	const cases: Array<{
		name: string
		envValue: string | undefined
		isDogfood: boolean
		expectedEnabled: boolean
		expectedSource: "env" | "profile"
	}> = [
		// Operator-specified matrix
		{ name: "dogfood + unset -> ON", envValue: undefined, isDogfood: true, expectedEnabled: true, expectedSource: "profile" },
		{ name: "public  + unset -> OFF", envValue: undefined, isDogfood: false, expectedEnabled: false, expectedSource: "profile" },
		{ name: "dogfood + 0 -> OFF (override-down)", envValue: "0", isDogfood: true, expectedEnabled: false, expectedSource: "env" },
		{ name: "public  + 1 -> ON (override-up)", envValue: "1", isDogfood: false, expectedEnabled: true, expectedSource: "env" },
		// Defensive coverage
		{ name: "dogfood + off -> OFF", envValue: "off", isDogfood: true, expectedEnabled: false, expectedSource: "env" },
		{ name: "dogfood + false -> OFF", envValue: "false", isDogfood: true, expectedEnabled: false, expectedSource: "env" },
		{ name: "public  + yes -> ON", envValue: "yes", isDogfood: false, expectedEnabled: true, expectedSource: "env" },
		{ name: "dogfood + TRUE -> ON (case-insensitive)", envValue: "TRUE", isDogfood: true, expectedEnabled: true, expectedSource: "env" },
		// Garbage -> fall through to profile default
		{ name: "dogfood + garbage -> ON (profile default)", envValue: "garbage", isDogfood: true, expectedEnabled: true, expectedSource: "profile" },
		{ name: "public  + garbage -> OFF (profile default)", envValue: "garbage", isDogfood: false, expectedEnabled: false, expectedSource: "profile" },
	]
	for (const c of cases) {
		it(c.name, () => {
			const env = c.envValue === undefined ? {} : { CLINEMM_DIAG_BACKGROUND_OWNER_CORRELATION_V1: c.envValue }
			expect(resolveEffectiveBackgroundOwnerCorrelationCapture(env, c.isDogfood)).toEqual({
				enabled: c.expectedEnabled,
				source: c.expectedSource,
			})
		})
	}
})

describe("applyBackgroundOwnerCorrelationDiagnosticProfile", () => {
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

	it("dogfood + unset -> flips the seam ON (flipped=true)", () => {
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile({}, true)
		expect(r).toEqual({ enabled: true, source: "profile", flipped: true })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
	})

	it("public + unset -> keeps the seam OFF (flipped=false because already OFF)", () => {
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile({}, false)
		expect(r).toEqual({ enabled: false, source: "profile", flipped: false })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
	})

	it("dogfood + '0' -> explicit override-down flips an ON seam to OFF", () => {
		applyBackgroundOwnerCorrelationDiagnosticProfile({}, true)
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile({ CLINEMM_DIAG_BACKGROUND_OWNER_CORRELATION_V1: "0" }, true)
		expect(r).toEqual({ enabled: false, source: "env", flipped: true })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(false)
	})

	it("public + '1' -> explicit override-up flips an OFF seam to ON", () => {
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile({ CLINEMM_DIAG_BACKGROUND_OWNER_CORRELATION_V1: "1" }, false)
		expect(r).toEqual({ enabled: true, source: "env", flipped: true })
		expect(isBackgroundOwnerCorrelationCaptureEnabled()).toBe(true)
	})

	it("is idempotent (no flip on repeated call with same effective state)", () => {
		const r1 = applyBackgroundOwnerCorrelationDiagnosticProfile({}, true)
		const r2 = applyBackgroundOwnerCorrelationDiagnosticProfile({}, true)
		expect(r1.flipped).toBe(true)
		expect(r2.flipped).toBe(false)
		expect(r2.enabled).toBe(true)
	})

	it("post-activation env mutation does NOT change the seam without re-activation", async () => {
		applyBackgroundOwnerCorrelationDiagnosticProfile({}, true)
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
		// Mutate the env AFTER activation.
		const envAfter = { CLINEMM_DIAG_BACKGROUND_OWNER_CORRELATION_V1: "0" }
		// The resolver evaluates the new env as OFF, but the seam
		// (the recorder's authority) is unchanged unless we call
		// the activation helper again. This is the THSICAP / W
		// carrier / D-knob semantic.
		expect(resolveEffectiveBackgroundOwnerCorrelationCapture(envAfter, true)).toEqual({
			enabled: false,
			source: "env",
		})
		// Prove the seam is still ON by recording + dumping.
		captureBackgroundOwnerCorrelationRecord({
			event: "background_owner_correlation_decision",
			capturedAt: 2,
			taskId: null,
			sessionEventSessionId: null,
			activeSessionId: "session-A",
			currentPhase: "streaming",
			candidatePhase: "awaiting_followup",
			guardAvailable: true,
			queriedOwnerSessionId: "session-A",
			guardResult: false,
			activeJobs: [{ jobId: "cmd_y", state: "running", ownerSessionId: "session-A" }],
			candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve",
		})
		const { file } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(ctx)
		expect(file).toBe(join(dir, "background-owner-correlation.jsonl"))
		const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0)
		expect(lines).toHaveLength(2)
		// Demonstrate: re-activation with the new env flips the seam OFF.
		const r = applyBackgroundOwnerCorrelationDiagnosticProfile(envAfter, true)
		expect(r.flipped).toBe(true)
		expect(r.enabled).toBe(false)
	})
})
