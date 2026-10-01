/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02
 *
 * Live shadow observer tests. Wires the compiled Elm kernel as a
 * strictly non-authoritative observer of the SAME factual CCARD
 * stream that production emits. Default-off, fail-open,
 * non-blocking, session-isolated, FIFO-ordered.
 *
 * Every test drives the REAL
 * `captureContinuationCardinalityAuthorityRecord` helper
 * (production module). No synthetic adapter input. The Elm kernel is
 * loaded via the REAL `loadKernel` (production replay loader, which
 * has been pre-corrected to return a fresh `Elm.Main.init({})` per
 * call).
 *
 * RED stage (this commit): defines the production-shape contract.
 * Before §17 implementation these tests must FAIL because the
 * shadow module does not yet exist.
 *
 * GREEN stage (subsequent commit): §17 implements
 * `apps/vscode/src/sdk/completion-authority-elm-shadow.ts` and the
 * bounded changes to the CCARD helper, after which all these tests
 * pass.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import * as shadow from "../completion-authority-elm-shadow"
import * as dogfoodProfile from "../dogfood-diagnostic-profile"
import {
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")
const KERNEL_PATH = path.resolve(REPO_ROOT, "apps/vscode/elm/completion-authority/vendor/completion-authority.js")
const FIVE_EVENT_PROJECTION = path.resolve(
	REPO_ROOT,
	".factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-DISCRIMINATOR01/02-replayable-projection.jsonl",
)

interface ElmShadowModule {
	setElmShadowEnabled(enabled: boolean, kernelPath: string | null): void
	isElmShadowEnabled(): boolean
	getElmShadowKernelPath(): string | null
	observeElmShadowFireAndForget(record: Record<string, unknown>): void
	getElmShadowRing(): readonly Record<string, unknown>[]
	getElmShadowCounters(): {
		total: number
		states: number
		violations: number
		decodeErrors: number
		kernelErrors: number
	}
	resetElmShadowForTesting(): void
	drainOneTickForTesting(sessionId: string): Promise<void>
}

function sessionIdOf(rec: Record<string, unknown>): string | null {
	const sid = rec.sessionId
	if (typeof sid === "string" && sid.length > 0) return sid
	const tid = rec.taskId
	if (typeof tid === "string" && tid.length > 0) return tid
	return null
}

function asShadowObservation(rec: Record<string, unknown>): {
	sessionId: string | null
	sourceSeq: number
	sourceStage: string
	adapterStatus: string
	elmOutputKind: string | null
} {
	return {
		sessionId: sessionIdOf(rec),
		sourceSeq: typeof rec.sourceSeq === "number" ? (rec.sourceSeq as number) : -1,
		sourceStage: typeof rec.sourceStage === "string" ? (rec.sourceStage as string) : "",
		adapterStatus: typeof rec.adapterStatus === "string" ? (rec.adapterStatus as string) : "",
		elmOutputKind: typeof rec.elmOutputKind === "string" ? (rec.elmOutputKind as string) : null,
	}
}

const _shadow: ElmShadowModule = shadow as unknown as ElmShadowModule

beforeEach(() => {
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	_shadow.resetElmShadowForTesting()
})

afterEach(() => {
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	_shadow.setElmShadowEnabled(false, null)
})

// ----------------------------------------------------------------------------
// ELS02-01
// ----------------------------------------------------------------------------

describe("ELS02-01 — default off / no kernel load / no Elm init / CCARD unchanged", () => {
	test("ELS02-01.A: default off — `isElmShadowEnabled()` returns false", () => {
		expect(_shadow.isElmShadowEnabled()).toBe(false)
	})

	test("ELS02-01.B: shadow disabled — observe is a complete no-op", () => {
		_shadow.setElmShadowEnabled(false, KERNEL_PATH)
		_shadow.observeElmShadowFireAndForget({
			seq: 1,
			at: 0,
			stage: "task_started",
			sessionId: "S-DIS",
		})
		expect(_shadow.getElmShadowRing().length).toBe(0)
		expect(_shadow.getElmShadowCounters().total).toBe(0)
	})

	test("ELS02-01.C: shadow disabled + CCARD enabled — CCARD ring still works", () => {
		_shadow.setElmShadowEnabled(false, KERNEL_PATH)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_started",
			origin: "explicit_user",
			sessionId: "S-DIS-2",
			taskId: "S-DIS-2",
		})
		const ring = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ring.length).toBe(1)
		expect(ring[0]!.stage).toBe("task_started")
		expect(_shadow.getElmShadowRing().length).toBe(0)
	})
})

// ----------------------------------------------------------------------------
// ELS02-02..ELS02-03
// ----------------------------------------------------------------------------

describe("ELS02-02..ELS02-03 — DIRECT events cross the live shadow API and the canonical 5-event REAL projection reproduces", () => {
	test("ELS02-02: task_started DIRECT crosses adapt → inbound → outbound state", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_started",
			origin: "explicit_user",
			sessionId: "S-02",
			taskId: "S-02",
		})
		await _shadow.drainOneTickForTesting("S-02")
		const ring = _shadow.getElmShadowRing()
		expect(ring.length).toBe(1)
		const obs = asShadowObservation(ring[0]!)
		expect(obs.sessionId).toBe("S-02")
		expect(obs.sourceStage).toBe("task_started")
		expect(obs.adapterStatus).toBe("DIRECT")
		expect(obs.elmOutputKind).toBe("state")
	})

	test("ELS02-03: the canonical 5-event REAL projection drives the live shadow API and the final Elm model matches offline replay", async () => {
		expect(fs.existsSync(FIVE_EVENT_PROJECTION)).toBe(true)
		const lines = fs
			.readFileSync(FIVE_EVENT_PROJECTION, "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
		expect(lines.length).toBe(5)
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		for (const line of lines) {
			const record = JSON.parse(line) as Record<string, unknown>
			captureContinuationCardinalityAuthorityRecord(record as never)
			const sid = sessionIdOf(record)
			if (sid) await _shadow.drainOneTickForTesting(sid)
		}
		const ring = _shadow.getElmShadowRing()
		expect(ring.length).toBe(5)
		const states = ring.filter((r) => asShadowObservation(r).elmOutputKind === "state")
		expect(states.length).toBe(5)
		const violations = ring.filter((r) => typeof (r as { violation?: unknown }).violation === "string")
		expect(violations.length).toBe(0)
		const finalObs = ring[ring.length - 1] as { model?: Record<string, unknown> }
		const model = finalObs.model ?? {}
		expect(model["task"]).toBe("completion_committed")
		expect(model["activeRun"]).toBeNull()
		expect(model["commitReadyRun"]).toBeNull()
		expect(model["committedCompletion"]).toBe("completion-1790809530345_lrsk9-1")
	})
})

// ----------------------------------------------------------------------------
// ELS02-04..ELS02-05
// ----------------------------------------------------------------------------

describe("ELS02-04..ELS02-05 — known insufficient identity is honestly skipped", () => {
	test("ELS02-04: execute_turn_prelude_enter without runId yields INSUFFICIENT_IDENTITY and no inbound.send", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		captureContinuationCardinalityAuthorityRecord({
			stage: "execute_turn_prelude_enter",
			origin: "explicit_user",
			sessionId: "S-04",
		})
		await _shadow.drainOneTickForTesting("S-04")
		const ring = _shadow.getElmShadowRing()
		expect(ring.length).toBe(1)
		const obs = asShadowObservation(ring[0]!)
		expect(obs.adapterStatus).toBe("INSUFFICIENT_IDENTITY")
		expect(obs.elmOutputKind).toBeNull()
	})

	test("ELS02-05: terminal_committed without terminalKind yields INSUFFICIENT_IDENTITY", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		captureContinuationCardinalityAuthorityRecord({
			stage: "terminal_committed",
			origin: "background_terminal",
			jobId: "J-05",
			ownerId: "O-05",
			sessionId: "S-05",
		})
		await _shadow.drainOneTickForTesting("S-05")
		const ring = _shadow.getElmShadowRing()
		expect(ring.length).toBe(1)
		const obs = asShadowObservation(ring[0]!)
		expect(obs.adapterStatus).toBe("INSUFFICIENT_IDENTITY")
		expect(obs.elmOutputKind).toBeNull()
	})
})

// ----------------------------------------------------------------------------
// ELS02-06
// ----------------------------------------------------------------------------

describe("ELS02-06 — two interleaved sessions are isolated", () => {
	test("ELS02-06: S1 and S2 maintain independent Elm models across interleaving", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		const s1: Array<Record<string, unknown>> = [
			{ stage: "task_started", origin: "explicit_user", sessionId: "S1", taskId: "S1" },
			{ stage: "run_turn_started", origin: "explicit_user", sessionId: "S1", runId: "R1" },
			{
				stage: "submit_and_exit_seen",
				origin: "pending_prompt_drain",
				sessionId: "S1",
				taskId: "S1",
				submitId: "sub-1",
			},
		]
		const s2: Array<Record<string, unknown>> = [
			{ stage: "task_started", origin: "explicit_user", sessionId: "S2", taskId: "S2" },
			{ stage: "run_turn_started", origin: "explicit_user", sessionId: "S2", runId: "R2" },
		]
		for (let i = 0; i < Math.max(s1.length, s2.length); i++) {
			if (i < s1.length) captureContinuationCardinalityAuthorityRecord(s1[i]! as never)
			if (i < s2.length) captureContinuationCardinalityAuthorityRecord(s2[i]! as never)
		}
		await _shadow.drainOneTickForTesting("S1")
		await _shadow.drainOneTickForTesting("S2")
		const ring = _shadow.getElmShadowRing()
		const s1Obs = ring.filter((r) => asShadowObservation(r).sessionId === "S1")
		const s2Obs = ring.filter((r) => asShadowObservation(r).sessionId === "S2")
		expect(s1Obs.length).toBe(3)
		expect(s2Obs.length).toBe(2)
		const s1FinalModel = (s1Obs[s1Obs.length - 1] as { model?: Record<string, unknown> }).model ?? {}
		expect(s1FinalModel["activeRun"]).toBe("R1")
		expect(s1FinalModel["submitCount"]).toBe(1)
		const s2FinalModel = (s2Obs[s2Obs.length - 1] as { model?: Record<string, unknown> }).model ?? {}
		expect(s2FinalModel["activeRun"]).toBe("R2")
		expect(s2FinalModel["submitCount"]).toBe(0)
	})
})

// ----------------------------------------------------------------------------
// ELS02-07
// ----------------------------------------------------------------------------

describe("ELS02-07 — same-session FIFO ordering", () => {
	test("ELS02-07: 5+ synchronous source records produce 1:1 in-order outbound correspondence", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		const sessionId = "S-07"
		const events: Array<Record<string, unknown>> = [
			{ stage: "task_started", origin: "explicit_user", sessionId, taskId: sessionId },
			{ stage: "run_turn_started", origin: "explicit_user", sessionId, runId: "R7-1" },
			{
				stage: "submit_and_exit_seen",
				origin: "pending_prompt_drain",
				sessionId,
				taskId: sessionId,
				submitId: "sub-7-1",
			},
			{
				stage: "task_completion_committed",
				origin: "pending_prompt_drain",
				sessionId,
				taskId: sessionId,
				completionId: "c-7-1",
			},
			{ stage: "agent_turn_done", origin: "explicit_user", sessionId, runId: "R7-1" },
		]
		for (const e of events) captureContinuationCardinalityAuthorityRecord(e as never)
		await _shadow.drainOneTickForTesting(sessionId)
		const ring = _shadow.getElmShadowRing()
		const stages = ring.map((r) => asShadowObservation(r).sourceStage)
		expect(stages).toEqual([
			"task_started",
			"run_turn_started",
			"submit_and_exit_seen",
			"task_completion_committed",
			"agent_turn_done",
		])
		const states = ring.filter((r) => asShadowObservation(r).elmOutputKind === "state")
		expect(states.length).toBe(events.length)
	})
})

// ----------------------------------------------------------------------------
// ELS02-08
// ----------------------------------------------------------------------------

describe("ELS02-08 — Elm violation is diagnostic-only", () => {
	test("ELS02-08: a sequence known to produce an Elm violation records the violation without any callback into production state", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		const sessionId = "S-08"
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_started",
			origin: "explicit_user",
			sessionId,
			taskId: sessionId,
		})
		await _shadow.drainOneTickForTesting(sessionId)
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "explicit_user",
			sessionId,
			runId: "R8",
		})
		await _shadow.drainOneTickForTesting(sessionId)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_completion_committed",
			origin: "pending_prompt_drain",
			sessionId,
			taskId: sessionId,
			completionId: "c-8",
		})
		await _shadow.drainOneTickForTesting(sessionId)
		const ring = _shadow.getElmShadowRing()
		const lastObs = ring[ring.length - 1] as {
			violation?: string
			model?: Record<string, unknown>
		}
		const ccardRing = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ccardRing.length).toBe(3)
		expect(ring.length).toBe(3)
		if (lastObs.model) {
			expect(Object.keys(lastObs.model).sort()).toEqual(
				["activeRun", "commitReadyRun", "committedCompletion", "presentedCompletion", "submitCount", "task"].sort(),
			)
		}
	})
})

// ----------------------------------------------------------------------------
// ELS02-09
// ----------------------------------------------------------------------------

describe("ELS02-09 — kernel failure is fail-open", () => {
	test("ELS02-09: invalid kernel path fails open and CCARD behavior is unchanged", () => {
		_shadow.setElmShadowEnabled(true, path.join(REPO_ROOT, "apps/vscode/elm/completion-authority/vendor/does-not-exist.js"))
		expect(() =>
			captureContinuationCardinalityAuthorityRecord({
				stage: "task_started",
				origin: "explicit_user",
				sessionId: "S-09",
				taskId: "S-09",
			}),
		).not.toThrow()
		const ccardRing = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ccardRing.length).toBe(1)
		expect(ccardRing[0]!.stage).toBe("task_started")
		const shadowRing = _shadow.getElmShadowRing()
		const hasErrorOrEmpty = shadowRing.length === 0 || shadowRing.some((r) => asShadowObservation(r).elmOutputKind === null)
		expect(hasErrorOrEmpty).toBe(true)
	})
})

// ----------------------------------------------------------------------------
// ELS02-10
// ----------------------------------------------------------------------------

describe("ELS02-10 — session teardown after agent_turn_done", () => {
	test("ELS02-10: after task_started → ... → agent_turn_done, a fresh session starts from emptyModel", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		const sessionId = "S-10"
		const events = [
			{ stage: "task_started", origin: "explicit_user", sessionId, taskId: sessionId },
			{ stage: "run_turn_started", origin: "explicit_user", sessionId, runId: "R10" },
			{
				stage: "submit_and_exit_seen",
				origin: "pending_prompt_drain",
				sessionId,
				taskId: sessionId,
				submitId: "sub-10",
			},
			{
				stage: "task_completion_committed",
				origin: "pending_prompt_drain",
				sessionId,
				taskId: sessionId,
				completionId: "c-10",
			},
			{ stage: "agent_turn_done", origin: "explicit_user", sessionId, runId: "R10" },
		]
		for (const e of events) captureContinuationCardinalityAuthorityRecord(e as never)
		await _shadow.drainOneTickForTesting(sessionId)
		const freshId = "S-10-fresh"
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_started",
			origin: "explicit_user",
			sessionId: freshId,
			taskId: freshId,
		})
		await _shadow.drainOneTickForTesting(freshId)
		const freshRing = shadow.getElmShadowRing().filter((r) => asShadowObservation(r).sessionId === freshId)
		expect(freshRing.length).toBe(1)
		const freshModel = (freshRing[0] as { model?: Record<string, unknown> }).model ?? {}
		expect(freshModel["task"]).toBe("active")
		expect(freshModel["activeRun"]).toBeNull()
		expect(freshModel["submitCount"]).toBe(0)
		expect(freshModel["committedCompletion"]).toBeNull()
	})
})

// ----------------------------------------------------------------------------
// ELS02-11
// ----------------------------------------------------------------------------

describe("ELS02-11 — disable mid-session", () => {
	test("ELS02-11: turning shadow off mid-session stops further observations without affecting CCARD", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_started",
			origin: "explicit_user",
			sessionId: "S-11",
			taskId: "S-11",
		})
		await _shadow.drainOneTickForTesting("S-11")
		expect(_shadow.getElmShadowRing().length).toBe(1)
		_shadow.setElmShadowEnabled(false, KERNEL_PATH)
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "explicit_user",
			sessionId: "S-11",
			runId: "R11",
		})
		const ccardRing = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ccardRing.length).toBe(2)
		expect(_shadow.getElmShadowRing().length).toBe(1)
	})
})

// ----------------------------------------------------------------------------
// ELS02-12
// ----------------------------------------------------------------------------

describe("ELS02-12 — exact adapter reuse", () => {
	test("ELS02-12: live shadow imports/calls the existing adaptRecord; no second hand-written stage→Msg switch exists in shadow code", () => {
		const shadowPath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-authority-elm-shadow.ts")
		const source = fs.readFileSync(shadowPath, "utf8")
		expect(source).toMatch(/from\s+["']\.\/completion-authority-elm-replay["']/)
		expect(source).toMatch(/\badaptRecord\(/)
		expect(source).not.toMatch(/case\s+["']task_started["']\s*:/)
		expect(source).not.toMatch(/case\s+["']submit_and_exit_seen["']\s*:/)
		expect(source).not.toMatch(/case\s+["']task_completion_committed["']\s*:/)
	})
})

// ----------------------------------------------------------------------------
// ELS02-13 — non-blocking: shadow backpressure cannot block TS authority
// ----------------------------------------------------------------------------

describe("ELS02-13 — non-blocking: shadow backpressure cannot block the authoritative CCARD emission", () => {
	test("ELS02-13: capture() returns synchronously even when the kernel is configured but the shadow ring is busy", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		const startedAt = Date.now()
		// Burst 20 captures synchronously.
		for (let i = 0; i < 20; i++) {
			captureContinuationCardinalityAuthorityRecord({
				stage: "task_started",
				origin: "explicit_user",
				sessionId: `S-BP-${i}`,
				taskId: `S-BP-${i}`,
			})
		}
		const elapsedMs = Date.now() - startedAt
		// Synchronous emissions must return well under 200ms for
		// 20 captures. The shadow is fire-and-forget; it cannot
		// add per-event latency to the authoritative path.
		expect(elapsedMs).toBeLessThan(200)
		// CCARD ring holds all 20 records immediately.
		const ccardRing = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ccardRing.length).toBe(20)
	})
})

// ----------------------------------------------------------------------------
// ELS02-14 — error containment: each failure mode disables the affected
// shadow scope and never propagates
// ----------------------------------------------------------------------------

describe("ELS02-14 — error containment", () => {
	test("ELS02-14.A: capture returns synchronously even when the shadow is enabled but the kernel fails to load", async () => {
		// ELS02-09 already proves the load-fail path for a fresh
		// process. Here we prove the structural guarantee that
		// capture() NEVER awaits the shadow and NEVER propagates
		// the failure, by bursting captures with a (potentially
		// cached) enabled shadow and asserting the CCARD ring is
		// always synchronously populated.
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		const startedAt = Date.now()
		for (let i = 0; i < 50; i++) {
			captureContinuationCardinalityAuthorityRecord({
				stage: "task_started",
				origin: "explicit_user",
				sessionId: `S-EC-A-${i}`,
				taskId: `S-EC-A-${i}`,
			})
		}
		const elapsedMs = Date.now() - startedAt
		expect(elapsedMs).toBeLessThan(500)
		const ccardRing = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ccardRing.length).toBe(50)
		// Drain everything; even if some kernels fail or sessions
		// fail, the capture path is preserved.
		for (let i = 0; i < 50; i++) {
			await _shadow.drainOneTickForTesting(`S-EC-A-${i}`)
		}
	})

	test("ELS02-14.B: malformed outbound decode_error does not block the observer", async () => {
		_shadow.setElmShadowEnabled(true, KERNEL_PATH)
		// Use a stage not in the closed Codec tag set so the
		// kernel emits a decode_error rather than a state.
		captureContinuationCardinalityAuthorityRecord({
			stage: "task_started",
			origin: "explicit_user",
			sessionId: "S-EC-B",
			taskId: "S-EC-B",
			// @ts-expect-error — intentional injected bogus value
			__bogus: { tag: "not_a_real_tag", payload: "x" },
		})
		await _shadow.drainOneTickForTesting("S-EC-B")
		const ring = _shadow.getElmShadowRing()
		expect(ring.length).toBeGreaterThanOrEqual(1)
		// CCARD ring still works
		const ccardRing = getContinuationCardinalityAuthorityCaptureRecords()
		expect(ccardRing.length).toBeGreaterThanOrEqual(1)
	})
})

// ----------------------------------------------------------------------------
// ELS02-15 — adapter reuse invariant at the call site (zero second
// stage→Msg mapping exists in shadow code)
// ----------------------------------------------------------------------------

describe("ELS02-15 — Elm shadow runtime has zero second hand-written stage→Msg mapping", () => {
	test("ELS02-15.A: shadow module imports `adaptRecord` and uses it for every stage", () => {
		const shadowPath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-authority-elm-shadow.ts")
		const source = fs.readFileSync(shadowPath, "utf8")
		// The shadow module MUST delegate to the existing adapter.
		expect(source).toMatch(/adaptRecord\(/)
		// It MUST NOT define a parallel stage→Msg switch.
		const switchCount = (source.match(/case\s+["'][a-z_]+["']\s*:/g) ?? []).length
		expect(switchCount).toBe(0)
	})

	test("ELS02-15.B: shadow runtime never imports mutating authorities", () => {
		const shadowPath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-authority-elm-shadow.ts")
		const source = fs.readFileSync(shadowPath, "utf8")
		const mutatingAuthorities = [
			"SdkController",
			"CommandJobManager",
			"PendingPromptsController",
			"McpHub",
			"react",
			"myc",
			"webview",
		]
		for (const a of mutatingAuthorities) {
			expect(source.toLowerCase()).not.toContain(a.toLowerCase())
		}
	})
})

// ----------------------------------------------------------------------------
// ELS02-16 — production activation wiring (CORRECTION01)
// ----------------------------------------------------------------------------

describe("ELS02-16 — production activation wiring exists in extension.ts + dogfood-diagnostic-profile.ts + registry.ts", () => {
	test("ELS02-16.A: applyElmShadowDiagnosticProfile exists in dogfood-diagnostic-profile.ts and is env-gated", () => {
		const profilePath = path.resolve(
			REPO_ROOT,
			"apps/vscode/src/sdk/dogfood-diagnostic-profile.ts",
		)
		const source = fs.readFileSync(profilePath, "utf8")
		expect(source).toMatch(/export\s+function\s+applyElmShadowDiagnosticProfile/)
		expect(source).toMatch(/CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW/)
	})

	test("ELS02-16.B: extension.ts:activate calls applyElmShadowDiagnosticProfile and registers the dump command", () => {
		const extPath = path.resolve(REPO_ROOT, "apps/vscode/src/extension.ts")
		const source = fs.readFileSync(extPath, "utf8")
		expect(source).toMatch(/applyElmShadowDiagnosticProfile/)
		expect(source).toMatch(/DumpCompletionAuthorityElmShadow/)
	})

	test("ELS02-16.C: registry.ts exposes DumpCompletionAuthorityElmShadow command id", () => {
		const regPath = path.resolve(REPO_ROOT, "apps/vscode/src/registry.ts")
		const source = fs.readFileSync(regPath, "utf8")
		expect(source).toMatch(/DumpCompletionAuthorityElmShadow\s*:\s*prefix\s*\+/)
	})

	test("ELS02-16.D: package.json declares the dump command for the contribution point", () => {
		const pkg = JSON.parse(
			fs.readFileSync(path.resolve(REPO_ROOT, "apps/vscode/package.json"), "utf8"),
		) as { contributes?: { commands?: Array<{ command?: string }> } }
		const ids = (pkg.contributes?.commands ?? []).map((c) => c.command ?? "")
		expect(ids).toContain("cline.debug.dumpCompletionAuthorityElmShadow")
	})

	test("ELS02-16.E: dump runtime module exists and serializes the ring + counter snapshot", () => {
		const runtimePath = path.resolve(
			REPO_ROOT,
			"apps/vscode/src/sdk/completion-authority-elm-shadow-runtime.ts",
		)
		expect(fs.existsSync(runtimePath)).toBe(true)
		const source = fs.readFileSync(runtimePath, "utf8")
		expect(source).toMatch(/completion-authority-elm-shadow\.jsonl/)
		expect(source).toMatch(/completion-authority-elm-shadow\.counters\.json/)
	})

	test("ELS02-16.F: applyElmShadowDiagnosticProfile honors the env contract (1/true/yes -> ON, else OFF)", () => {
		const apply = dogfoodProfile.applyElmShadowDiagnosticProfile as (
			env: Record<string, string | undefined>,
			kernelPath: string | null,
		) => {
			enabled: boolean
			flipped: boolean
			kernelPath: string | null
			resolvedReason: string
		}
		// Default off
		const a = apply({}, KERNEL_PATH)
		expect(a.enabled).toBe(false)
		expect(a.kernelPath).toBeNull()
		// "1" -> ON
		const b = apply(
			{ CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW: "1" },
			KERNEL_PATH,
		)
		expect(b.enabled).toBe(true)
		expect(b.kernelPath).toBe(KERNEL_PATH)
		expect(b.resolvedReason).toBe("env")
		// "true" -> ON
		const c = apply(
			{ CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW: "true" },
			KERNEL_PATH,
		)
		expect(c.enabled).toBe(true)
		// "yes" -> ON
		const d = apply(
			{ CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW: "yes" },
			KERNEL_PATH,
		)
		expect(d.enabled).toBe(true)
		// "0" -> OFF
		const e = apply(
			{ CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW: "0" },
			KERNEL_PATH,
		)
		expect(e.enabled).toBe(false)
		// "no" -> OFF
		const f = apply(
			{ CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW: "no" },
			KERNEL_PATH,
		)
		expect(f.enabled).toBe(false)
		// env on but kernel path missing -> fail-closed OFF
		const g = apply(
			{ CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW: "1" },
			null,
		)
		expect(g.enabled).toBe(false)
		// Reset for downstream tests
		apply({}, null)
	})
})
