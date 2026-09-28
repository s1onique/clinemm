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

import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
import { installMycPrimeLiveDiagReadoutRuntime } from "@/sdk/myc-prime-live-diag-runtime"

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

// ===========================================================================
// DLR-06: production writer materializes parent dir on a clean dogfood
// profile (CORRECTION01)
//
// The DLR-01..DLR-05 suite replaces the writer with an in-memory spy,
// so no filesystem topology is exercised. That gap is the only reason
// the original ACT slipped through with a P0 in the evidence-acquisition
// path: on a clean profile the parent dir did not exist, Node's
// `appendFile` rejected with ENOENT, the detached `.catch` swallowed
// the failure, and the sink produced zero evidence.
//
// DLR-06 fixes that by exercising the PRODUCTION writer (not a spy)
// against a real on-disk temp data root whose diagnostic subdir
// does not yet exist. PRE-FIX: events.jsonl absent (the original ACT
// would have produced nothing). POST-FIX: the parent dir is created
// and exactly one valid JSON line is present.
//
// This also re-pins DLR-01.a (default-off still zero-I/O — the
// production writer is bound but the diagnostic is OFF) and DLR-05.a
// (write failure still non-fatal — the production writer rejects
// when given a path whose data root cannot be resolved; the recorder
// does not throw and the warn seam surfaces the failure).
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-06: production writer materializes parent dir", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG
	const tempDirs: string[] = []

	async function createTempDataRoot(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "dlr06-readout-"))
		tempDirs.push(dir)
		return dir
	}

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_MYC_PRIME_DIAG
		} else {
			process.env.CLINEMM_MYC_PRIME_DIAG = originalEnv
		}
	})

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetMycPrimeLiveDiagReadoutForTests()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
	})

	it("DLR-06.a: production writer creates diagnostics/myc-prime-live-diag/ + events.jsonl on a clean profile", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)

		// Install the PRODUCTION wiring (real `node:fs/promises`
		// writer + real `resolveDataDirFromEnv` resolver), then
		// override ONLY the data root resolver to point at the
		// temp dir. This is the same end-to-end shape that
		// `extension.ts:activate` installs in production; the
		// only thing we swap is the writable root.
		installMycPrimeLiveDiagReadoutRuntime()
		const dataRoot = await createTempDataRoot()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => dataRoot)

		const target = resolveMycPrimeLiveDiagReadoutPath()
		expect(target).toBe(join(dataRoot, MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR, MYC_PRIME_LIVE_DIAG_READOUT_FILENAME))
		expect(target).toBe(join(dataRoot, "diagnostics/myc-prime-live-diag/events.jsonl"))
		// The resolver is bound, so `target` is non-null. Narrow for
		// the post-fix filesystem calls below.
		if (target === null) throw new Error("target is null despite bound resolver")

		// PRE-FIX invariant: the subdir does not exist yet.
		// `stat` would throw ENOENT. We assert by `stat` on the
		// subdir explicitly; this is the DLR-06 RED.
		const subdir = join(dataRoot, MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR)
		await expect(stat(subdir)).rejects.toMatchObject({ code: "ENOENT" })

		// Fire one diagnostic event. The recorder dispatches the
		// writer Promise detached; we must await enough microtasks
		// (and the real mkdir+appendFile) to settle.
		recordMycPrimeLiveBind("hs-dlr-06")
		for (let i = 0; i < 32; i++) {
			await Promise.resolve()
		}
		// Give the real fs a chance: appendFile is a real syscall.
		await new Promise((r) => setTimeout(r, 50))

		// POST-FIX invariants: the parent subdir exists, the
		// events.jsonl file exists, and it contains exactly one
		// valid JSON line.
		const subdirStat = await stat(subdir)
		expect(subdirStat.isDirectory()).toBe(true)
		const fileStat = await stat(target)
		expect(fileStat.isFile()).toBe(true)
		const contents = await readFile(target, "utf8")
		const lines = contents.split("\n").filter((l) => l.length > 0)
		expect(lines.length).toBe(1)

		const event = JSON.parse(lines[0])
		expect(event.event).toBe("bind")
		expect(event.sessionId).toBe("hs-dlr-06")
		expect(event.iteration).toBe(0)
		// Bounded-event-shape re-pin: no prime text, no witness,
		// no prompt, no path. The shape is a closed set of
		// {ts, event, sessionId, iteration} for a bind event.
		expect(typeof event.ts).toBe("string")
		expect(Object.keys(event).sort()).toEqual(["event", "iteration", "sessionId", "ts"])
	})

	it("DLR-06.b: a failing production writer (e.g. unresolvable data root) is swallowed by the warn seam", async () => {
		// Re-pins DLR-05.a against the PRODUCTION writer topology:
		// if the writer rejects, the recorder does NOT throw, the
		// warn seam receives the failure, and the in-process
		// diagnostic entry still reflects the full chain.
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		recordMycPrimeResult(okPrime("hs-dlr-06b", "<real-prime>"))

		// Install the PRODUCTION writer; point the resolver at a
		// path that does not exist AND cannot be created (a
		// regular file whose "diagnostics" subdir cannot be
		// created). We create a file first, then point at the
		// file path. resolvePath will yield
		// <file>/diagnostics/myc-prime-live-diag/events.jsonl, so
		// mkdir of the file's child dir will reject with ENOTDIR.
		const badRoot = join(tmpdir(), `dlr06b-readout-${Date.now()}.notdir`)
		const { writeFile } = await import("node:fs/promises")
		await writeFile(badRoot, "I am a file, not a directory\n", "utf8")
		tempDirs.push(badRoot)

		installMycPrimeLiveDiagReadoutRuntime()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => badRoot)

		const warned: string[] = []
		setMycPrimeLiveDiagReadoutWarn((m) => warned.push(m))

		const hooks = buildAgentHooks(createStateManager(), undefined, undefined, "hs-dlr-06b")
		const beforeModel = hooks.beforeModel
		if (!beforeModel) throw new Error("beforeModel missing")
		const ctx = makeBeforeModelContext({
			snapshot: { ...makeBeforeModelContext().snapshot, sessionId: "hs-dlr-06b" },
		})
		// beforeModel MUST resolve even though every writer call
		// will reject against this bad data root.
		const result = await beforeModel(ctx)
		expect(result).toBeDefined()
		expect(result?.messages?.length).toBe(2)
		const text = (result?.messages?.[1]?.content?.[0] as { text?: string })?.text ?? ""
		expect(text).toContain("real-prime")
		expect(text).toContain("<prime_packet")

		// Drain microtasks AND a real tick so detached Promises
		// reach the warn seam.
		for (let i = 0; i < 32; i++) {
			await Promise.resolve()
		}
		await new Promise((r) => setTimeout(r, 50))

		expect(warned.length).toBeGreaterThan(0)
		// The in-process entry must still reflect the full GREEN
		// chain — the readout failure must NOT bleed into the
		// in-process record.
		const entry = getMycPrimeLiveDiag("hs-dlr-06b")
		expect(entry?.injection.injected).toBe(true)
		expect(entry?.injection.reason).toBe("ok")
	})

	it("DLR-06.c: diagnostic OFF keeps the bound production writer at zero I/O (DLR-01 re-pin)", async () => {
		// Same shape as DLR-06.a but with the diagnostic OFF: the
		// production writer is bound (it would create the dir and
		// write the line if reached), but the recorder
		// short-circuits on `isMycPrimeLiveDiagEnabled()` BEFORE
		// dispatching anything. The data root stays untouched.
		delete process.env.CLINEMM_MYC_PRIME_DIAG
		expect(isMycPrimeLiveDiagEnabled()).toBe(false)

		installMycPrimeLiveDiagReadoutRuntime()
		const dataRoot = await createTempDataRoot()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => dataRoot)

		// Drive every recorder; none should reach the writer.
		recordMycPrimeLiveBind("hs-dlr-06c")
		recordMycPrimeLiveEnter("hs-dlr-06c", "hs-dlr-06c", 1)
		recordMycPrimeLiveAcquisition("hs-dlr-06c", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 9,
		})
		recordMycPrimeLiveLookup("hs-dlr-06c", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
			lookupKey: "hs-dlr-06c",
		})
		recordMycPrimeLiveInjection("hs-dlr-06c", {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 256,
			iteration: 1,
		})
		recordMycPrimeLiveCapture("hs-dlr-06c", { captureId: "cap-dlr06c", aiSdkPromptObserved: true })

		for (let i = 0; i < 32; i++) {
			await Promise.resolve()
		}
		await new Promise((r) => setTimeout(r, 50))

		// No parent dir, no file, no in-process entries.
		const subdir = join(dataRoot, MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR)
		await expect(stat(subdir)).rejects.toMatchObject({ code: "ENOENT" })
		expect(__getAllMycPrimeLiveDiagForTests()).toEqual([])
	})
})

// ===========================================================================
// DLR-07: production writer serializes concurrent appendFile calls
// (CORRECTION02)
//
// The detached dispatch pattern means six recorders (BIND, ENTER,
// ACQUISITION, LOOKUP, INJECTION, CAPTURE) can fire in the same
// microtask burst. Node's `fs/promises` operations run on the libuv
// thread pool and are NOT synchronized/threadsafe; two concurrent
// `appendFile` calls against the same `events.jsonl` can interleave
// on the thread pool and produce torn JSONL lines. CORRECTION02
// serializes the production writer through a module-level
// `writeTail: Promise<void>` chain.
//
// DLR-06 did not close this because it fired exactly ONE event.
// DLR-07.a fires the full chain synchronously (no awaits between
// recorders) and asserts:
//   - exactly 6 non-empty lines in the JSONL
//   - every line parses as a valid JSON object
//   - the events appear in exactly the causal order
//     [bind, enter, acquisition, lookup, injection, capture]
//   - all sessionIds are identical
//
// DLR-07.b exercises the failure-recovery property: the queue
// must NOT poison subsequent evidence if one op fails. We drive
// the production writer with a counter-based resolver that returns
// a bad data root (parent is a regular file → mkdir rejects with
// ENOTDIR) on the first call and a good temp data root on the
// second call. The first op's failure must be reported via the
// warn seam, and the second op must still produce a valid
// `events.jsonl` line in the good root.
// ===========================================================================

describe("ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 — DLR-07: production writer serializes concurrent appendFile", () => {
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG
	const tempDirs: string[] = []

	async function createTempDataRoot(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "dlr07-readout-"))
		tempDirs.push(dir)
		return dir
	}

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_MYC_PRIME_DIAG
		} else {
			process.env.CLINEMM_MYC_PRIME_DIAG = originalEnv
		}
	})

	beforeEach(() => {
		__resetMycPrimeLiveDiagForTests()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
	})

	it("DLR-07.a: 6 synchronous recorders → exactly 6 ordered, intact JSON lines on disk", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		expect(isMycPrimeLiveDiagEnabled()).toBe(true)

		// Install the PRODUCTION wiring. This binds both the
		// production writer (with the CORRECTION02 FIFO chain) and
		// the production data-root resolver; we then override ONLY
		// the resolver to point at the temp dir. This is the same
		// end-to-end shape as DLR-06.
		installMycPrimeLiveDiagReadoutRuntime()
		const dataRoot = await createTempDataRoot()
		setMycPrimeLiveDiagReadoutDataRootResolver(() => dataRoot)

		const target = resolveMycPrimeLiveDiagReadoutPath()
		expect(target).toBe(join(dataRoot, "diagnostics/myc-prime-live-diag/events.jsonl"))
		if (target === null) throw new Error("target is null despite bound resolver")

		// PRE-FIX invariant: the file does not exist yet.
		await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" })

		// Fire the full chain synchronously — NO awaits between
		// recorders. Each recorder synchronously calls
		// `appendReadoutLine` which calls `void writer(target, line)`,
		// which enqueues onto `writeTail`. The queue is the
		// CORRECTION02 invariant under test.
		recordMycPrimeLiveBind("hs-dlr-07")
		recordMycPrimeLiveEnter("hs-dlr-07", "hs-dlr-07", 1)
		recordMycPrimeLiveAcquisition("hs-dlr-07", {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 7,
		})
		recordMycPrimeLiveLookup("hs-dlr-07", {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
			lookupKey: "hs-dlr-07",
		})
		recordMycPrimeLiveInjection("hs-dlr-07", {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 128,
			iteration: 1,
		})
		recordMycPrimeLiveCapture("hs-dlr-07", { captureId: "cap-dlr07", aiSdkPromptObserved: true })

		// Drain microtasks AND a real-tick wait so the
		// serialized chain (6 × mkdir+appendFile ops) settles.
		// Each op on local APFS is ~1-5ms; 6 ops × 5ms = 30ms;
		// 200ms is a comfortable safety margin while still
		// keeping the test fast.
		for (let i = 0; i < 32; i++) {
			await Promise.resolve()
		}
		await new Promise((r) => setTimeout(r, 200))

		// POST-FIX invariants: exactly 6 non-empty lines, every
		// line is a valid JSON object, the order is the causal
		// order, and every sessionId is identical.
		const contents = await readFile(target, "utf8")
		const lines = contents.split("\n").filter((l) => l.length > 0)
		expect(lines.length).toBe(6)

		const events: MycPrimeLiveDiagReadoutEvent[] = lines.map((l) => JSON.parse(l))
		expect(events.map((e) => e.event)).toEqual(["bind", "enter", "acquisition", "lookup", "injection", "capture"])
		expect(events.every((e) => e.sessionId === "hs-dlr-07")).toBe(true)

		// Sanity: bounded event shape preserved on every line.
		// No prime text, no witness, no prompt, no path.
		for (const e of events) {
			expect(typeof e.ts).toBe("string")
			expect(typeof e.event).toBe("string")
			expect(typeof e.sessionId).toBe("string")
			expect(
				Object.keys(e)
					.sort()
					.every((k) =>
						[
							"event",
							"sessionId",
							"ts",
							"iteration",
							"lookupKey",
							"recordedPrimeFound",
							"recordedPrimeSessionId",
							"status",
							"injected",
							"reason",
							"packetBytes",
							"captureId",
						].includes(k),
					),
			).toBe(true)
		}
	})

	it("DLR-07.b: one failed op does not poison the queue — subsequent op still executes", async () => {
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"

		installMycPrimeLiveDiagReadoutRuntime()

		// Build a "bad" data root: a regular file, so when the
		// production writer tries to mkdir its child, mkdir
		// rejects with ENOTDIR. (Same shape as DLR-06.b's
		// resolution failure but driven through the queue.)
		const badRoot = join(tmpdir(), `dlr07b-bad-${Date.now()}.notdir`)
		const { writeFile } = await import("node:fs/promises")
		await writeFile(badRoot, "I am a file, not a directory\n", "utf8")
		tempDirs.push(badRoot)

		// Counter-based resolver: first call returns `badRoot`,
		// every subsequent call returns the good root. This
		// drives a single failing op followed by a successful
		// op, both through the same `writeTail` chain.
		const goodRoot = await createTempDataRoot()
		let resolverCalls = 0
		setMycPrimeLiveDiagReadoutDataRootResolver(() => {
			resolverCalls += 1
			return resolverCalls === 1 ? badRoot : goodRoot
		})

		const warned: string[] = []
		setMycPrimeLiveDiagReadoutWarn((m) => warned.push(m))

		// Fire two recorders synchronously. The first resolves
		// to <badRoot>/diagnostics/.../events.jsonl → mkdir
		// rejects with ENOTDIR. The second resolves to
		// <goodRoot>/diagnostics/.../events.jsonl → succeeds.
		recordMycPrimeLiveBind("hs-dlr-07b-first")
		recordMycPrimeLiveBind("hs-dlr-07b-second")

		// Wait for the queue to drain.
		for (let i = 0; i < 32; i++) {
			await Promise.resolve()
		}
		await new Promise((r) => setTimeout(r, 200))

		// The first op's failure must be reported via the warn
		// seam. The warn text (per `appendReadoutLine`'s
		// `_readoutWarn("append failed (target=..., event=...)")`)
		// does NOT include the sessionId by design — to keep the
		// log line bounded. We assert the failure was reported
		// for the FIRST op's target (the bad root) and not for
		// the second op's target (the good root). One warn line
		// is emitted; the second op must have succeeded without
		// producing a warn.
		expect(warned.length).toBe(1)
		expect(warned[0]).toContain(badRoot)
		expect(warned[0]).not.toContain(goodRoot)

		// The second op must have produced a valid file. This
		// is the load-bearing assertion: if the queue had
		// poisoned on the first op, the second op would not
		// have run, and this file would not exist (or would
		// not contain a complete line).
		const goodTarget = join(goodRoot, MYC_PRIME_LIVE_DIAG_READOUT_SUBDIR, MYC_PRIME_LIVE_DIAG_READOUT_FILENAME)
		const goodContents = await readFile(goodTarget, "utf8")
		const goodLines = goodContents.split("\n").filter((l) => l.length > 0)
		expect(goodLines.length).toBe(1)
		const goodEvent = JSON.parse(goodLines[0])
		expect(goodEvent.sessionId).toBe("hs-dlr-07b-second")
		expect(goodEvent.event).toBe("bind")
	})
})
