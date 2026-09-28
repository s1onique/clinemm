/**
 * ACT-MYC-CLINEMM03-LIVE-DIAG01 — default-off live diagnostic tests
 * (D1..D10).
 *
 * The diagnostic record is a forensic scaffolding added to prove WHERE
 * the live prime-injection causal chain breaks, NOT to fix it. Each
 * test asserts that an observation point records the expected slice
 * of the diagnostic — and that the off path is bit-identical to the
 * pre-ACT production path.
 *
 * The test file uses vitest because the assertions drive the
 * production hooks factory (`buildAgentHooks`), matching the
 * existing prime model-visible tests in this folder.
 */

import type { AgentBeforeModelContext } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { __resetPrimeInjectionStateForTests, buildAgentHooks } from "@/sdk/hooks-adapter"
import { __resetMycPrimeResultsForTests, type MycPrimeResult, recordMycPrimeResult } from "@/sdk/myc-prime-automation"
import {
	__getAllMycPrimeLiveDiagForTests,
	__resetMycPrimeLiveDiagForTests,
	getMycPrimeLiveDiag,
	isMycPrimeLiveDiagEnabled,
	recordMycPrimeLiveAcquisition,
	recordMycPrimeLiveCapture,
	recordMycPrimeLiveInjection,
	recordMycPrimeLiveLookup,
	startMycPrimeLiveDiag,
} from "@/sdk/myc-prime-live-diag"

function createStateManager(): StateManager {
	return { getGlobalSettingsKey: (k: string) => (k === "hooksEnabled" ? false : undefined) } as unknown as StateManager
}

function okPrime(sessionId: string, text: string): MycPrimeResult {
	return { sessionId, status: "ok", text, ts: Date.now() }
}

function skippedPrime(sessionId: string): MycPrimeResult {
	return { sessionId, status: "skipped", error: "no myc server", ts: Date.now() }
}

function makeBeforeModelContext(overrides: Partial<AgentBeforeModelContext> = {}): AgentBeforeModelContext {
	const baseMessages = [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }]
	return {
		snapshot: {
			conversationId: "conv-test",
			sessionId: "hs-test",
			iteration: 1,
			messages: baseMessages as never,
			agentId: "a",
			runId: "r",
		},
		request: { messages: baseMessages, tools: [] },
		...overrides,
	} as unknown as AgentBeforeModelContext
}

describe("ACT-MYC-CLINEMM03-LIVE-DIAG01 — module-level diagnostic helpers", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_MYC_PRIME_DIAG
		} else {
			process.env.CLINEMM_MYC_PRIME_DIAG = originalEnv
		}
	})

	it("D9.a env flag unset → disabled", () => {
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
		startMycPrimeLiveDiag("hs-1")
		recordMycPrimeLiveAcquisition("hs-1", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 42,
		})
		expect(__getAllMycPrimeLiveDiagForTests().length).toBe(0)
		expect(getMycPrimeLiveDiag("hs-1")).toBeUndefined()
	})

	it("D9.b env flag = '1' → enabled", () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
		startMycPrimeLiveDiag("hs-1")
		recordMycPrimeLiveAcquisition("hs-1", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})
		const entries = __getAllMycPrimeLiveDiagForTests()
		expect(entries.length).toBe(1)
		expect(entries[0].sessionId).toBe("hs-1")
		expect(entries[0].acquisition.status).toBe("ok")
		expect(entries[0].acquisition.textBytes).toBe(7)
	})

	it("D9.c whitespace and case-insensitive enable", () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "  1  "
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
		process.env.CLINEMM_MYC_PRIME_DIAG = "true"
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
		process.env.CLINEMM_MYC_PRIME_DIAG = "1 "
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
	})

	it("D9.d env flag = '0' → still disabled", () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "0"
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
		startMycPrimeLiveDiag("hs-2")
		expect(__getAllMycPrimeLiveDiagForTests().length).toBe(0)
	})

	it("helper API round-trip: start / acquisition / lookup / injection / capture", () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		startMycPrimeLiveDiag("hs-x")
		recordMycPrimeLiveAcquisition("hs-x", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 12,
		})
		recordMycPrimeLiveLookup("hs-x", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
		})
		recordMycPrimeLiveInjection("hs-x", {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 256,
			iteration: 1,
		})
		recordMycPrimeLiveCapture("hs-x", { captureId: "cap-1", aiSdkPromptObserved: true })
		const entry = getMycPrimeLiveDiag("hs-x")
		expect(entry).toBeDefined()
		expect(entry?.acquisition.textBytes).toBe(12)
		expect(entry?.lookup.recordedPrimeFound).toBe(true)
		expect(entry?.injection.reason).toBe("ok")
		expect(entry?.injection.packetBytes).toBe(256)
		expect(entry?.capture?.captureId).toBe("cap-1")
	})
})
describe("ACT-MYC-CLINEMM03-LIVE-DIAG01 — wired through buildAgentHooks.beforeModel", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_MYC_PRIME_DIAG
		} else {
			process.env.CLINEMM_MYC_PRIME_DIAG = originalEnv
		}
	})

	it("D5: first iteration injects AND records injected=true, reason='ok', packetBytes>0", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-test", "<real prime>"))

		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext()
		startMycPrimeLiveDiag("hs-test")
		recordMycPrimeLiveAcquisition("hs-test", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 11,
		})

		const result = await beforeModel(ctx)
		expect(result).toBeDefined()
		expect(result?.messages?.length).toBe(2)
		const text = (result?.messages?.[1]?.content?.[0] as { text?: string })?.text ?? ""
		expect(text).toContain("real prime")
		expect(text).toContain("<prime_packet")

		const entry = getMycPrimeLiveDiag("hs-test")
		expect(entry?.injection.attempted).toBe(true)
		expect(entry?.injection.injected).toBe(true)
		expect(entry?.injection.reason).toBe("ok")
		expect(entry?.injection.packetBytes).toBeGreaterThan(0)
		expect(entry?.injection.iteration).toBe(1)
		expect(entry?.lookup.recordedPrimeFound).toBe(true)
		expect(entry?.lookup.snapshotSessionIdPresent).toBe(true)
		expect(entry?.capture?.captureId).toMatch(/^mycprime-hs-test-/)
		expect(entry?.capture?.aiSdkPromptObserved).toBe(true)
	})

	it("D6: later iteration records iteration_not_first", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-test", "<real prime>"))

		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: {
				...makeBeforeModelContext().snapshot,
				iteration: 2,
			},
		})
		startMycPrimeLiveDiag("hs-test")

		const result = await beforeModel(ctx)
		expect(result).toBeUndefined()

		const entry = getMycPrimeLiveDiag("hs-test")
		expect(entry?.injection.attempted).toBe(true)
		expect(entry?.injection.injected).toBe(false)
		expect(entry?.injection.reason).toBe("iteration_not_first")
		expect(entry?.injection.iteration).toBe(2)
	})

	it("D7: already-injected records already_injected", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-test", "<real prime>"))

		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext()
		startMycPrimeLiveDiag("hs-test")
		// First call injects (per-session dedupe engages).
		await beforeModel(ctx)
		const result = await beforeModel(ctx)
		expect(result).toBeUndefined()

		const entry = getMycPrimeLiveDiag("hs-test")
		// The most recent recording is the "already_injected" event.
		expect(entry?.injection.reason).toBe("already_injected")
	})

	it("D8: no prime recorded → injection skipped with reason='no_recorded_prime'", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-empty" },
		})
		startMycPrimeLiveDiag("hs-empty")
		recordMycPrimeLiveAcquisition("hs-empty", {
			attempted: true,
			serverDetected: false,
			status: "skipped",
			textPresent: false,
			textBytes: 0,
			error: "no myc server",
		})

		const result = await beforeModel(ctx)
		expect(result).toBeUndefined()

		const entry = getMycPrimeLiveDiag("hs-empty")
		expect(entry?.acquisition.status).toBe("skipped")
		expect(entry?.acquisition.serverDetected).toBe(false)
		expect(entry?.lookup.recordedPrimeFound).toBe(false)
		expect(entry?.injection.attempted).toBe(true)
		expect(entry?.injection.injected).toBe(false)
		expect(entry?.injection.reason).toBe("no_recorded_prime")
	})

	it("D4 (lookup miss is explicit): prime recorded for hs-1, lookup for hs-2 → recordedPrimeFound=false", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-1", "<x>"))

		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-2" },
		})
		startMycPrimeLiveDiag("hs-2")
		recordMycPrimeLiveAcquisition("hs-2", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 3,
		})

		const result = await beforeModel(ctx)
		expect(result).toBeUndefined()

		const entry = getMycPrimeLiveDiag("hs-2")
		expect(entry?.acquisition.status).toBe("ok")
		// Identity/join boundary: prime recorder is populated under
		// hs-1 but the beforeModel lookup is keyed by hs-2.
		expect(entry?.lookup.recordedPrimeFound).toBe(false)
		expect(entry?.injection.injected).toBe(false)
		expect(entry?.injection.reason).toBe("no_recorded_prime")
	})

	it("D3: lookup finds matching host sessionId", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-1", "<prime>"))
		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-1" },
		})
		startMycPrimeLiveDiag("hs-1")

		await beforeModel(ctx)
		const entry = getMycPrimeLiveDiag("hs-1")
		expect(entry?.lookup.matchedRecordedSession).toBe(true)
		expect(entry?.lookup.recordedPrimeFound).toBe(true)
	})

	it("D10: request metadata preserves existing fields and adds captureId only when diag enabled", async () => {
		// Phase 1 — diag DISABLED: hook returns ONLY `{messages}`.
		__resetMycPrimeResultsForTests()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeLiveDiagForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
		recordMycPrimeResult(okPrime("hs-test", "<x>"))
		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const existingMetadata = { existing: "preserve", other: 42 }
		const ctx = makeBeforeModelContext({
			request: {
				...makeBeforeModelContext().request,
				options: { metadata: existingMetadata },
			},
		})
		const offResult = await beforeModel(ctx)
		expect(offResult?.messages?.length).toBe(2)
		expect(offResult?.options).toBeUndefined()

		// Phase 2 — diag ENABLED: hook returns `{messages, options}`
		// with the preserved metadata extended by `captureId`,
		// `sessionId`, `iteration`, `mycPrimeDiag`.
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-test", "<x>"))
		const onResult = await beforeModel(ctx)
		expect(onResult?.options).toBeDefined()
		const merged = (onResult?.options as { metadata?: Record<string, unknown> })?.metadata
		expect(merged).toBeDefined()
		expect(merged?.existing).toBe("preserve")
		expect(merged?.other).toBe(42)
		expect(merged?.captureId).toMatch(/^mycprime-hs-test-/)
		expect(merged?.sessionId).toBe("hs-test")
		expect(merged?.iteration).toBe(1)
		expect(merged?.mycPrimeDiag).toBe(true)
	})

	it("D2 (smoke): acquisition recorder wraps without throwing on a custom status", () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		startMycPrimeLiveDiag("hs-fail")
		expect(() =>
			recordMycPrimeLiveAcquisition("hs-fail", {
				attempted: true,
				serverDetected: true,
				status: "failed",
				textPresent: false,
				textBytes: 0,
				error: "myc prime failed: ECONNREFUSED",
			}),
		).not.toThrow()
		const entry = getMycPrimeLiveDiag("hs-fail")
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.textPresent).toBe(false)
		expect(entry?.acquisition.error).toMatch(/ECONNREFUSED/)
	})

	it("D*: skipped-prime (R3 shape) → acquisition.skipped, lookup finds the recorder entry but prime_empty", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		// Prime recorder HAS an entry for hs-skip (status="skipped",
		// no text). The beforeModel lookup FINDS this entry
		// (matchedRecordedSession=true), but the lookup predicate
		// requires status="ok" AND text → recordedPrimeFound=false.
		// The injection branch is `prime_empty` (the recorded entry
		// is non-ok), NOT `no_recorded_prime` (which only fires when
		// the singleton has no entry at all).
		recordMycPrimeResult(skippedPrime("hs-skip"))
		const hooks = buildAgentHooks(createStateManager())
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-skip" },
		})
		startMycPrimeLiveDiag("hs-skip")
		recordMycPrimeLiveAcquisition("hs-skip", {
			attempted: true,
			serverDetected: false,
			status: "skipped",
			textPresent: false,
			textBytes: 0,
		})

		const result = await beforeModel(ctx)
		expect(result).toBeUndefined()
		const entry = getMycPrimeLiveDiag("hs-skip")
		expect(entry?.acquisition.status).toBe("skipped")
		expect(entry?.lookup.matchedRecordedSession).toBe(true)
		expect(entry?.lookup.recordedPrimeFound).toBe(false)
		expect(entry?.injection.reason).toBe("prime_empty")
	})
})

// =============================================================================
// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01
//   LBC-01..LBC-05 — diagnostic-correctness tests for the new BIND + ENTER
//   observation points and the `lookupKey` discriminator. These tests prove
//   the diagnostic itself is semantically inert (LBC-01) and that the new
//   observation points expose the exact information the §17 discriminator
//   tree needs. They are NOT bug-reproduction tests; the live bug
//   reproduction is the §14 operator-driven dogfood run.
// =============================================================================
describe("ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01 — BIND + ENTER diagnostics", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_MYC_PRIME_DIAG
		} else {
			process.env.CLINEMM_MYC_PRIME_DIAG = originalEnv
		}
	})

	it("LBC-01: diagnostics OFF → buildAgentHooks + beforeModel produce ZERO new state writes", async () => {
		// Env flag absent; module seam not armed. Recording helpers
		// are called with the realistic production call shape, but
		// must short-circuit on the FIRST `isMycPrimeLiveDiagEnabled()`
		// check inside `buildAgentHooks` and `beforeModel`. The
		// off-path MUST be bit-identical to the pre-ACT path:
		// no bind, no enter, no capture, no options.metadata
		// injection, no log lines, no request mutation other than
		// the prime packet.
		recordMycPrimeResult(okPrime("hs-test", "<real prime>"))
		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-test")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext()

		const offResult = await beforeModel(ctx)
		expect(offResult?.messages?.length).toBe(2)
		expect(offResult?.options).toBeUndefined()
		// Singleton stays empty: bind, enter, lookup, injection,
		// capture all short-circuited.
		expect(__getAllMycPrimeLiveDiagForTests()).toEqual([])
		expect(getMycPrimeLiveDiag("hs-test")).toBeUndefined()
	})

	it("LBC-02: beforeModel lookup HIT → enter + lookup + injection + capture all fire; no payload captured", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		// Pre-populate the prime recorder so the lookup will hit
		// and the injection branch returns `{messages, options}`.
		recordMycPrimeResult(okPrime("hs-bind", "<prime>"))
		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-bind")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-bind" },
		})
		startMycPrimeLiveDiag("hs-bind")
		recordMycPrimeLiveAcquisition("hs-bind", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})

		const result = await beforeModel(ctx)
		expect(result?.messages?.length).toBe(2)

		const entry = getMycPrimeLiveDiag("hs-bind")
		// ENTER fired before any short-circuit.
		expect(entry?.enter?.sessionId).toBe("hs-bind")
		expect(entry?.enter?.snapshotSessionIdPresent).toBe(true)
		expect(entry?.enter?.iteration).toBe(1)
		expect(entry?.enter?.hooksInstalled).toBe(true)
		// BIND fired at buildAgentHooks time.
		expect(entry?.bind?.sessionId).toBe("hs-bind")
		expect(entry?.bind?.iteration).toBe(0)
		expect(entry?.bind?.hooksInstalled).toBe(true)
		// LOOKUP hit and recorded the lookupKey.
		expect(entry?.lookup.matchedRecordedSession).toBe(true)
		expect(entry?.lookup.recordedPrimeFound).toBe(true)
		expect(entry?.lookup.lookupKey).toBe("hs-bind")
		// INJECTION recorded ok.
		expect(entry?.injection.injected).toBe(true)
		expect(entry?.injection.reason).toBe("ok")
		expect(entry?.injection.packetBytes).toBeGreaterThan(0)
		// CAPTURE bound the captureId.
		expect(entry?.capture?.captureId).toMatch(/^mycprime-hs-bind-/)
		// The diagnostic MUST NOT store the prime text.
		const json = JSON.stringify(entry)
		expect(json).not.toContain("real prime")
		expect(json).not.toContain("<prime>")
	})

	it("LBC-03: lookup MISS → recordedPrimeFound=false, injected=false, reason='no_recorded_prime'", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		// Recorder singleton is EMPTY for hs-miss — the lookup will
		// miss, the injection branch returns `undefined`, and the
		// recorded `reason` is `no_recorded_prime`.
		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-miss")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-miss" },
		})
		startMycPrimeLiveDiag("hs-miss")
		recordMycPrimeLiveAcquisition("hs-miss", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 11,
		})

		const result = await beforeModel(ctx)
		expect(result).toBeUndefined()

		const entry = getMycPrimeLiveDiag("hs-miss")
		expect(entry?.enter?.sessionId).toBe("hs-miss")
		expect(entry?.bind?.sessionId).toBe("hs-miss")
		expect(entry?.lookup.recordedPrimeFound).toBe(false)
		expect(entry?.lookup.lookupKey).toBe("hs-miss")
		expect(entry?.injection.injected).toBe(false)
		expect(entry?.injection.reason).toBe("no_recorded_prime")
	})

	it("LBC-04: provider-binding — same session + iteration are linked to a single captureId", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-cap", "<prime>"))
		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-cap")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-cap" },
		})
		startMycPrimeLiveDiag("hs-cap")
		recordMycPrimeLiveAcquisition("hs-cap", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})

		const result = await beforeModel(ctx)
		// The captureId stamped onto options.metadata is the SAME
		// id the diagnostic records under `entry.capture.captureId`,
		// so the post-capture join can read the provider capture
		// file and find the matching diagnostic entry by id.
		const captureId = (result?.options as { metadata?: { captureId?: string } } | undefined)?.metadata?.captureId
		expect(captureId).toBeDefined()
		const entry = getMycPrimeLiveDiag("hs-cap")
		expect(entry?.capture?.captureId).toBe(captureId)
		expect(entry?.capture?.aiSdkPromptObserved).toBe(true)
	})

	it("LBC-05: multi-session — events are keyed independently per sessionId", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		// Session A: recorder populated → injection fires.
		recordMycPrimeResult(okPrime("hs-a", "<prime-a>"))
		// Session B: recorder empty → injection is a no-op.
		const hooksA = buildAgentHooks(createStateManager(), undefined, undefined, "hs-a")
		const beforeModelA = hooksA.beforeModel
		if (!beforeModelA) throw new Error("beforeModel A missing")
		const hooksB = buildAgentHooks(createStateManager(), undefined, undefined, "hs-b")
		const beforeModelB = hooksB.beforeModel
		if (!beforeModelB) throw new Error("beforeModel B missing")

		startMycPrimeLiveDiag("hs-a")
		recordMycPrimeLiveAcquisition("hs-a", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 8,
		})
		startMycPrimeLiveDiag("hs-b")
		recordMycPrimeLiveAcquisition("hs-b", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 8,
		})

		const ctxA = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-a" },
		})
		const ctxB = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-b" },
		})

		await beforeModelA(ctxA)
		await beforeModelB(ctxB)

		const entryA = getMycPrimeLiveDiag("hs-a")
		const entryB = getMycPrimeLiveDiag("hs-b")
		expect(entryA?.bind?.sessionId).toBe("hs-a")
		expect(entryA?.enter?.sessionId).toBe("hs-a")
		expect(entryA?.lookup.recordedPrimeFound).toBe(true)
		expect(entryA?.injection.injected).toBe(true)
		expect(entryA?.injection.reason).toBe("ok")
		expect(entryA?.capture?.captureId).toMatch(/^mycprime-hs-a-/)

		expect(entryB?.bind?.sessionId).toBe("hs-b")
		expect(entryB?.enter?.sessionId).toBe("hs-b")
		expect(entryB?.lookup.recordedPrimeFound).toBe(false)
		expect(entryB?.injection.injected).toBe(false)
		expect(entryB?.injection.reason).toBe("no_recorded_prime")
		expect(entryB?.capture).toBeUndefined()
	})
})
