/**
 * ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — JSONL readout sink tests
 * (DLR-01..DLR-05).
 *
 * The default-off JSONL readout sink was added so the diagnostic
 * state held in the module-private `Map` of `myc-prime-live-diag.ts`
 * becomes externally observable during dogfood. The sink:
 *
 *   - is gated on the SAME `isMycPrimeLiveDiagEnabled()` boolean —
 *     when the diagnostic is disabled, no file is written, no async
 *     work is scheduled, no log lines are produced,
 *   - appends one bounded JSON object per observation point under
 *     `<dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl`,
 *   - never logs prime text, witness text, prompts, or payload
 *     content — only the numeric / boolean / status fields already
 *     captured by the in-process entry,
 *   - never blocks `beforeModel`: writes are dispatched through a
 *     Promise-returning writer seam and any failure is swallowed and
 *     surfaced through a bounded warn seam.
 *
 * The five tests below (DLR-01..DLR-05) exercise the hard invariants
 * of the ACT: default-off, ordered bounded records, no-leak, session
 * isolation, and write-failure does not block the model request.
 */

import type { AgentBeforeModelContext } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { __resetPrimeInjectionStateForTests, buildAgentHooks } from "@/sdk/hooks-adapter"
import { __resetMycPrimeResultsForTests, type MycPrimeResult, recordMycPrimeResult } from "@/sdk/myc-prime-automation"
import {
	__getAllMycPrimeLiveDiagForTests,
	__resetMycPrimeLiveDiagForTests,
	__resetMycPrimeLiveDiagReadoutForTests,
	getMycPrimeLiveDiag,
	isMycPrimeLiveDiagEnabled,
	MYC_PRIME_LIVE_DIAG_READOUT_FILENAME,
	MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR,
	type MycPrimeLiveDiagReadoutEvent,
	type MycPrimeLiveDiagReadoutWriter,
	recordMycPrimeLiveAcquisition,
	recordMycPrimeLiveBind,
	recordMycPrimeLiveCapture,
	recordMycPrimeLiveEnter,
	recordMycPrimeLiveInjection,
	recordMycPrimeLiveLookup,
	resolveMycPrimeLiveDiagReadoutPath,
	setMycPrimeLiveDiagEnabled,
	setMycPrimeLiveDiagReadoutDataRootResolver,
	setMycPrimeLiveDiagReadoutWarn,
	setMycPrimeLiveDiagReadoutWriter,
} from "@/sdk/myc-prime-live-diag"

// ---- helpers ---------------------------------------------------------------

function createStateManager(): StateManager {
	return { getGlobalSettingsKey: (k: string) => (k === "hooksEnabled" ? false : undefined) } as unknown as StateManager
}

function okPrime(sessionId: string, text: string): MycPrimeResult {
	return { sessionId, status: "ok", text, ts: Date.now() }
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

/**
 * In-memory capturing writer. Records every `(target, line)` pair so
 * the test can assert on the bounded JSONL output without touching
 * the real filesystem.
 */
function capturingWriter(): {
	writer: MycPrimeLiveDiagReadoutWriter
	lines: string[]
	reset: () => void
} {
	const lines: string[] = []
	const writer: MycPrimeLiveDiagReadoutWriter = async (_target, line) => {
		lines.push(line)
	}
	return { writer, lines, reset: () => lines.splice(0, lines.length) }
}

/**
 * Drain microtasks so any detached Promise resolutions (the writer
 * dispatch) settle before the test reads the captured lines.
 */
async function drainMicrotasks(): Promise<void> {
	for (let i = 0; i < 16; i++) {
		await Promise.resolve()
	}
}

// ===========================================================================
// DLR-01: diagnostics OFF → no readout file → existing behavior unchanged
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-01: default-off invariant", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetMycPrimeLiveDiagReadoutForTests()
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

	it("DLR-01.a: env unset + writer bound → zero writer calls", async () => {
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr01")
		setMycPrimeLiveDiagReadoutWriter(writer)
		// Drive every recorder — none should reach the writer because
		// the diagnostic is OFF. The pre-existing recorders are no-ops
		// at the top, so the in-process `Map` stays empty too.
		recordMycPrimeLiveAcquisition("hs-dlr-01", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 9,
		})
		recordMycPrimeLiveLookup("hs-dlr-01", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
			lookupKey: "hs-dlr-01",
		})
		recordMycPrimeLiveInjection("hs-dlr-01", {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 256,
			iteration: 1,
		})
		recordMycPrimeLiveCapture("hs-dlr-01", { captureId: "cap-x", aiSdkPromptObserved: true })
		await drainMicrotasks()
		expect(lines).toEqual([])
		expect(__getAllMycPrimeLiveDiagForTests()).toEqual([])
	})

	it("DLR-01.b: explicit CLINEMM_MYC_PRIME_DIAG=0 + writer bound → zero writer calls", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "0"
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr01b")
		setMycPrimeLiveDiagReadoutWriter(writer)
		recordMycPrimeLiveAcquisition("hs-dlr-01b", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 9,
		})
		await drainMicrotasks()
		expect(lines).toEqual([])
	})

	it("DLR-01.c: env enabled + NO writer seam bound → zero writer calls AND no exception", async () => {
		// Diagnostic ON, readout seams unbound — exactly the state of a
		// unit test that arms via env but never installs the runtime.
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)
		// Both seams are deliberately unbound (the reset above already
		// cleared them). The recorders must not throw.
		expect(resolveMycPrimeLiveDiagReadoutPath()).toBeNull()
		recordMycPrimeLiveAcquisition("hs-dlr-01c", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 9,
		})
		expect(__getAllMycPrimeLiveDiagForTests().length).toBe(1)
	})
})

// ===========================================================================
// DLR-02: BIND/ENTER/LOOKUP/INJECTION enabled → ordered bounded JSONL
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-02: ordered bounded records", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetMycPrimeLiveDiagReadoutForTests()
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

	it("DLR-02.a: full chain (BIND → ENTER → ACQUISITION → LOOKUP → INJECTION → CAPTURE) yields 6 ordered lines", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		setMycPrimeLiveDiagEnabled(true)
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr02")
		setMycPrimeLiveDiagReadoutWriter(writer)

		const sessionId = "hs-dlr-02"
		// BIND
		recordMycPrimeLiveBind(sessionId)
		// ENTER (iteration 1)
		recordMycPrimeLiveEnter(sessionId, sessionId, 1)
		// ACQUISITION
		recordMycPrimeLiveAcquisition(sessionId, {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 11,
		})
		// LOOKUP
		recordMycPrimeLiveLookup(sessionId, {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
			lookupKey: sessionId,
		})
		// INJECTION
		recordMycPrimeLiveInjection(sessionId, {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 256,
			iteration: 1,
		})
		// CAPTURE
		recordMycPrimeLiveCapture(sessionId, { captureId: "cap-dlr02", aiSdkPromptObserved: true })

		await drainMicrotasks()
		expect(lines.length).toBe(6)

		const events: MycPrimeLiveDiagReadoutEvent[] = lines.map((l) => JSON.parse(l.replace(/\n$/, "")))
		const names = events.map((e) => e.event)
		expect(names).toEqual(["bind", "enter", "acquisition", "lookup", "injection", "capture"])

		// Every event carries the bounded-shape fields only.
		for (const ev of events) {
			expect(typeof ev.ts).toBe("string")
			expect(ev.sessionId).toBe(sessionId)
			// Verify NO banned field types slipped through: prime text,
			// witness text, prompts, payload content, node IDs, paths.
			const keys = Object.keys(ev).sort()
			expect(keys).not.toContain("text")
			expect(keys).not.toContain("prime")
			expect(keys).not.toContain("witness")
			expect(keys).not.toContain("messages")
			expect(keys).not.toContain("prompt")
			expect(keys).not.toContain("payload")
			expect(keys).not.toContain("nodeId")
		}

		// Event-specific field sanity.
		const bind = events[0]
		expect(bind.iteration).toBe(0)
		const enter = events[1]
		expect(enter.iteration).toBe(1)
		const acq = events[2]
		expect(acq.status).toBe("ok")
		const lookup = events[3]
		expect(lookup.lookupKey).toBe(sessionId)
		expect(lookup.recordedPrimeFound).toBe(true)
		expect(lookup.recordedPrimeSessionId).toBe(sessionId)
		expect(lookup.iteration).toBe(1)
		const injection = events[4]
		expect(injection.injected).toBe(true)
		expect(injection.reason).toBe("ok")
		expect(injection.packetBytes).toBe(256)
		expect(injection.iteration).toBe(1)
		const capture = events[5]
		expect(capture.captureId).toBe("cap-dlr02")
	})

	it("DLR-02.b: full chain runs through buildAgentHooks.beforeModel and writes ordered events", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-dlr-02b", "<real-prime-text>"))
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr02b")
		setMycPrimeLiveDiagReadoutWriter(writer)

		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-dlr-02b")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-dlr-02b" },
		})
		await beforeModel(ctx)

		await drainMicrotasks()
		// From `beforeModel` alone we expect at minimum ENTER, LOOKUP,
		// INJECTION, CAPTURE. ACQUISITION is fired by
		// `runMycPrimeOnSessionStart`, not by `beforeModel`, so we
		// assert >= 4 with the expected ordering rather than a strict 6.
		expect(lines.length).toBeGreaterThanOrEqual(4)
		const events: MycPrimeLiveDiagReadoutEvent[] = lines.map((l) => JSON.parse(l.replace(/\n$/, "")))
		const names = events.map((e) => e.event)
		expect(names).toEqual(expect.arrayContaining(["enter", "lookup", "injection", "capture"]))
		const enterIdx = names.indexOf("enter")
		const lookupIdx = names.indexOf("lookup")
		const injectionIdx = names.indexOf("injection")
		const captureIdx = names.indexOf("capture")
		expect(enterIdx).toBeLessThan(lookupIdx)
		expect(lookupIdx).toBeLessThan(injectionIdx)
		expect(injectionIdx).toBeLessThan(captureIdx)
	})
})

// ===========================================================================
// DLR-03: no prime text leaks — fixture witness absent from serialized JSONL
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-03: no prime text leak", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetMycPrimeLiveDiagReadoutForTests()
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

	it("DLR-03.a: fixture witness substring never appears in any serialized JSONL line", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		const witness = "FIXTURE_WITNESS_SENTINEL_DLR03_PURPLE_FALCON_42"
		recordMycPrimeResult(okPrime("hs-dlr-03", witness))
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr03")
		setMycPrimeLiveDiagReadoutWriter(writer)

		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-dlr-03")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-dlr-03" },
		})
		const result = await beforeModel(ctx)
		expect(result).toBeDefined()
		// Sanity: the in-process diagnostic should reflect the prime
		// being injected (we're testing the GREEN path).
		expect(getMycPrimeLiveDiag("hs-dlr-03")?.injection.injected).toBe(true)

		await drainMicrotasks()
		expect(lines.length).toBeGreaterThan(0)
		const joined = lines.join("\n")
		expect(joined).not.toContain(witness)
		expect(joined).not.toContain("<prime")
		expect(joined).not.toContain("prime_packet")
		expect(joined).not.toContain("purple")
		expect(joined).not.toContain("falcon")
	})

	it("DLR-03.b: error message from acquisition never includes the prime text", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr03b")
		setMycPrimeLiveDiagReadoutWriter(writer)
		// Simulate an acquisition failure with a bounded error message.
		// The error string here is intentionally NOT a prime text — it
		// is a real failure mode (e.g. server unreachable). The
		// readout does NOT carry the error string (the bounded event
		// shape exposes only `status`); this test pins that.
		recordMycPrimeLiveAcquisition("hs-dlr-03b", {
			attempted: true,
			serverDetected: false,
			status: "failed",
			textPresent: false,
			textBytes: 0,
			error: "myc server unreachable",
		})
		await drainMicrotasks()
		expect(lines.length).toBe(1)
		const joined = lines.join("\n")
		expect(joined).not.toContain("myc server unreachable")
		// The status field IS allowed (bounded enum value).
		expect(joined).toContain('"status":"failed"')
	})
})

// ===========================================================================
// DLR-04: multi-session isolation — S1/S2 records preserve identities
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-04: multi-session isolation", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetMycPrimeLiveDiagReadoutForTests()
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

	it("DLR-04.a: S1 + S2 each get their own ordered records with the correct sessionId", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		const { writer, lines } = capturingWriter()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/tmp/dlr04")
		setMycPrimeLiveDiagReadoutWriter(writer)

		// S1: BIND + ENTER + ACQUISITION + LOOKUP + INJECTION + CAPTURE.
		recordMycPrimeLiveBind("S1")
		recordMycPrimeLiveEnter("S1", "S1", 1)
		recordMycPrimeLiveAcquisition("S1", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})
		recordMycPrimeLiveLookup("S1", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
			lookupKey: "S1",
		})
		recordMycPrimeLiveInjection("S1", {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 100,
			iteration: 1,
		})
		recordMycPrimeLiveCapture("S1", { captureId: "cap-S1", aiSdkPromptObserved: true })

		// S2: BIND + ENTER + ACQUISITION + LOOKUP + INJECTION (miss).
		recordMycPrimeLiveBind("S2")
		recordMycPrimeLiveEnter("S2", "S2", 1)
		recordMycPrimeLiveAcquisition("S2", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})
		recordMycPrimeLiveLookup("S2", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: false,
			recordedPrimeFound: false,
			iteration: 1,
			lookupKey: "S2",
		})
		recordMycPrimeLiveInjection("S2", {
			attempted: true,
			injected: false,
			reason: "no_recorded_prime",
			iteration: 1,
		})

		await drainMicrotasks()
		expect(lines.length).toBe(11)

		const events: MycPrimeLiveDiagReadoutEvent[] = lines.map((l) => JSON.parse(l.replace(/\n$/, "")))

		// S1's 6 events all carry sessionId=S1.
		const s1 = events.filter((e) => e.sessionId === "S1")
		expect(s1.length).toBe(6)
		expect(s1.map((e) => e.event)).toEqual(["bind", "enter", "acquisition", "lookup", "injection", "capture"])

		// S2's 5 events all carry sessionId=S2; the lookup records
		// recordedPrimeFound=false and the injection reason is
		// "no_recorded_prime".
		const s2 = events.filter((e) => e.sessionId === "S2")
		expect(s2.length).toBe(5)
		expect(s2.map((e) => e.event)).toEqual(["bind", "enter", "acquisition", "lookup", "injection"])
		const s2Lookup = s2.find((e) => e.event === "lookup")
		expect(s2Lookup?.recordedPrimeFound).toBe(false)
		const s2Injection = s2.find((e) => e.event === "injection")
		expect(s2Injection?.injected).toBe(false)
		expect(s2Injection?.reason).toBe("no_recorded_prime")
	})

	it("DLR-04.b: resolveMycPrimeLiveDiagReadoutPath composes the canonical subdir + filename", () => {
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/data/root")
		const path = resolveMycPrimeLiveDiagReadoutPath()
		expect(path).toBe(`/data/root/${MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR}/${MYC_PRIME_LIVE_DIAG_READOUT_FILENAME}`)
		expect(MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR).toBe("diagnostics/myc-prime-live-diag")
		expect(MYC_PRIME_LIVE_DIAG_READOUT_FILENAME).toBe("events.jsonl")
	})
})

// ===========================================================================
// DLR-05: write failure → swallowed/diagnosed → model request continues
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-05: write failure never blocks", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetMycPrimeLiveDiagReadoutForTests()
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

	it("DLR-05.a: failing writer does not throw out of any recorder; beforeModel still mutates messages", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-dlr-05", "<real-prime>"))

		const warned: string[] = []
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/data/root")
		setMycPrimeLiveDiagReadoutWriter(async () => {
			throw new Error("synthetic fs failure")
		})
		setMycPrimeLiveDiagReadoutWarn((m) => warned.push(m))

		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-dlr-05")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-dlr-05" },
		})
		// beforeModel MUST resolve to a mutated request even though
		// every append call rejects. This is the DLR-05 contract.
		const result = await beforeModel(ctx)
		expect(result).toBeDefined()
		expect(result?.messages?.length).toBe(2)
		const text = (result?.messages?.[1]?.content?.[0] as { text?: string })?.text ?? ""
		expect(text).toContain("real-prime")
		expect(text).toContain("<prime_packet")

		// Drain microtasks so the rejected writer Promises reach the
		// warn seam.
		await drainMicrotasks()
		expect(warned.length).toBeGreaterThan(0)
		expect(warned.some((m) => m.includes("synthetic fs failure"))).toBe(true)
		// The in-process diagnostic should still reflect the full
		// GREEN chain — the readout failure must NOT bleed into the
		// in-process record.
		const entry = getMycPrimeLiveDiag("hs-dlr-05")
		expect(entry?.injection.injected).toBe(true)
		expect(entry?.injection.reason).toBe("ok")
	})

	it("DLR-05.b: a single rejected writer promise does not reject subsequent recorders", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		setMycPrimeLiveDiagReadoutDataRootResolver(() => "/data/root")
		let callCount = 0
		setMycPrimeLiveDiagReadoutWriter(async () => {
			callCount += 1
			throw new Error("always fails")
		})
		const warned: string[] = []
		setMycPrimeLiveDiagReadoutWarn((m) => warned.push(m))

		// Fire 6 recorders back-to-back. Each must not throw.
		recordMycPrimeLiveBind("hs-dlr-05b")
		recordMycPrimeLiveEnter("hs-dlr-05b", "hs-dlr-05b", 1)
		recordMycPrimeLiveAcquisition("hs-dlr-05b", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})
		recordMycPrimeLiveLookup("hs-dlr-05b", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
			lookupKey: "hs-dlr-05b",
		})
		recordMycPrimeLiveInjection("hs-dlr-05b", {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 128,
			iteration: 1,
		})
		recordMycPrimeLiveCapture("hs-dlr-05b", { captureId: "cap-dlr05b", aiSdkPromptObserved: true })
		await drainMicrotasks()

		expect(callCount).toBe(6)
		expect(warned.length).toBe(6)
		expect(warned.every((m) => m.includes("always fails"))).toBe(true)
	})
})
