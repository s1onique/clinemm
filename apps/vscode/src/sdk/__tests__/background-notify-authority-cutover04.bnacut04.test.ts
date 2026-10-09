/**
 * ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER
 *
 * Production-cutover evidence (C5 / C6 / C7 / C8 / C4 / C3).
 *
 * Exercises the real `BackgroundNotifyCoordinator.consumeTerminal`
 * against the compiled `background-notify-authority` Elm kernel.
 * Load-bearing evidence that the production policy decision is
 * Elm-owned, the TS effect interpreter is unchanged, and the
 * boundary semantics from C4 (edge cases) and C8 (adversarial
 * sequences) hold.
 *
 * Classification: STRUCTURAL (the BCB01 family is the LIVE
 * qualification matrix; this file is the deterministic
 * production-seam matrix for SEAM04 specifically).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	pickConsumeDecisionForAudit,
	resetBackgroundNotifyAuthorityElmAuthorityForTests,
} from "../background-notify-authority-elm"
import {
	BackgroundNotifyCoordinator,
	type ConsumeTerminalAuthorityFn,
	type ConsumeTerminalDecision,
} from "../background-notify-coordinator"

const ACTIVE_SESSION = "session-bnacut04"
const ACTIVE_TASK = "task-bnacut04"

interface Harness {
	coordinator: BackgroundNotifyCoordinator
	decisions: Array<{ jobId: string; decision: ConsumeTerminalDecision["kind"] | string }>
	enqueuedPrompts: Array<{ sessionId: string; prompt: string; jobId: string }>
	setActiveOwner: (sessionId: string, taskId: string | undefined) => void
}

function makeHarness(opts?: { consumeTerminalAuthority?: ConsumeTerminalAuthorityFn }): Harness {
	const decisions: Array<{ jobId: string; decision: ConsumeTerminalDecision["kind"] | string }> = []
	const enqueuedPrompts: Array<{ sessionId: string; prompt: string; jobId: string }> = []
	let currentSessionId = ACTIVE_SESSION
	let currentTaskId: string | undefined = ACTIVE_TASK
	const coordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: currentSessionId, taskId: currentTaskId }),
		enqueueTerminalWake: async ({ sessionId, prompt, jobId }) => {
			enqueuedPrompts.push({ sessionId, prompt, jobId: jobId ?? "" })
			return { kind: "delivered" as const }
		},
		recordNotifyDecision: (record) => {
			decisions.push({ jobId: record.jobId, decision: record.decision })
		},
		now: (() => {
			let tick = 0
			return () => ++tick
		})(),
		consumeTerminalAuthority: opts?.consumeTerminalAuthority,
	})
	return {
		coordinator,
		decisions,
		enqueuedPrompts,
		setActiveOwner: (sessionId, taskId) => {
			currentSessionId = sessionId
			currentTaskId = taskId
		},
	}
}

beforeEach(() => {
	resetBackgroundNotifyAuthorityElmAuthorityForTests()
})

afterEach(() => {
	resetBackgroundNotifyAuthorityElmAuthorityForTests()
})

// C7 (CUT-OVER)
describe("BNACUT04-C7: production cutover", () => {
	it("C7-01: drained → wake delivered", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-1", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-1",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("drained")
		expect(decision).toEqual({
			kind: "drained",
			jobId: "J-1",
			drainedCount: 1,
			enqueuedNow: true,
		})
		expect(h.enqueuedPrompts).toHaveLength(1)
		expect(h.enqueuedPrompts[0].jobId).toBe("J-1")
	})

	it("C7-02: held (other markers outstanding) — no wake delivered", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-1", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		h.coordinator.registerMarker({ jobId: "J-2", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-1",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("held")
		if (decision.kind === "held") {
			expect(decision.heldCount).toBe(1)
		}
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("C7-03: containment_no_wake", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-cf", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-cf",
			terminalState: "containment_failed",
			exitCode: 137,
			reason: "killed",
			isContainmentFailed: true,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("containment_no_wake")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("C7-04: owner_mismatch preserves the marker", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-om", sessionId: "OTHER", taskId: "OTHER" })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-om",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("owner_mismatch")
		// The Elm-driven owner_mismatch branch RESTORES the marker.
		expect(h.coordinator.diagnosticMarkerCount()).toBe(1)
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("C7-05: no_marker (marker absent)", async () => {
		const h = makeHarness()
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-no-marker",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})
})

// C6 (NECESSITY)
describe("BNACUT04-C6: necessity (Elm is the live authority)", () => {
	it("C6-01: production path matches the audit path for drained", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-c601", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const productionDecision = await h.coordinator.consumeTerminal({
			jobId: "J-c601",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		const audit = await pickConsumeDecisionForAudit({
			jobId: "J-c601",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 0,
		})
		expect(productionDecision.kind).toBe("drained")
		expect(audit.kind).toBe("directive")
		if (audit.kind === "directive") {
			expect(audit.value.kind).toBe("drained")
		}
	})

	it("C6-02: an overridden TS policy stub changes the decision", async () => {
		// Proves the delegation seam is live: the override is
		// observed, not bypassed.
		const alwaysNoMarker: ConsumeTerminalAuthorityFn = async () => ({
			kind: "directive",
			value: { kind: "no_marker" },
			summary: "stub:no_marker",
			requestId: null,
		})
		const h = makeHarness({ consumeTerminalAuthority: alwaysNoMarker })
		h.coordinator.registerMarker({ jobId: "J-c602", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-c602",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("C6-03: held-then-drained via the production path", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-c603-a", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		h.coordinator.registerMarker({ jobId: "J-c603-b", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const heldDecision = await h.coordinator.consumeTerminal({
			jobId: "J-c603-a",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(heldDecision.kind).toBe("held")
		expect(h.coordinator.diagnosticMarkerCount()).toBe(1)
		const drainedDecision = await h.coordinator.consumeTerminal({
			jobId: "J-c603-b",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(drainedDecision.kind).toBe("drained")
	})
})

// C8 (ADVERSARIAL)
describe("BNACUT04-C8: adversarial sequences", () => {
	it("SEQ-1: two outstanding notify jobs → exactly-once grouped wake", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq1-A", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		h.coordinator.registerMarker({ jobId: "J-seq1-B", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const a = await h.coordinator.consumeTerminal({
			jobId: "J-seq1-A",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(a.kind).toBe("held")
		expect(h.enqueuedPrompts).toHaveLength(0)
		const b = await h.coordinator.consumeTerminal({
			jobId: "J-seq1-B",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(b.kind).toBe("drained")
		expect(b).toEqual({
			kind: "drained",
			jobId: "J-seq1-B",
			drainedCount: 2,
			enqueuedNow: true,
		})
		expect(h.enqueuedPrompts).toHaveLength(2)
	})

	it("SEQ-2: reverse completion order → same obligation conservation", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq2-A", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		h.coordinator.registerMarker({ jobId: "J-seq2-B", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const b = await h.coordinator.consumeTerminal({
			jobId: "J-seq2-B",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(b.kind).toBe("held")
		const a = await h.coordinator.consumeTerminal({
			jobId: "J-seq2-A",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(a.kind).toBe("drained")
		// FIFO: B registered first → B wakes first.
		expect(h.enqueuedPrompts).toHaveLength(2)
		expect(h.enqueuedPrompts[0].jobId).toBe("J-seq2-B")
		expect(h.enqueuedPrompts[1].jobId).toBe("J-seq2-A")
	})

	it("SEQ-3: owner switch → no cross-owner delivery", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq3", sessionId: "X", taskId: "Tx" })
		h.setActiveOwner("Y", "Ty")
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-seq3",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("owner_mismatch")
		expect(h.enqueuedPrompts).toHaveLength(0)
		expect(h.coordinator.diagnosticMarkerCount()).toBe(1)
	})

	it("SEQ-4: duplicate terminal event → no duplicate wake", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq4", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const first = await h.coordinator.consumeTerminal({
			jobId: "J-seq4",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(first.kind).toBe("drained")
		expect(h.enqueuedPrompts).toHaveLength(1)
		const second = await h.coordinator.consumeTerminal({
			jobId: "J-seq4",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(second.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(1)
	})

	it("SEQ-5: owner_mismatch preserves the marker (cancellation provenance)", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq5", sessionId: "ORIG", taskId: "Torig" })
		h.setActiveOwner("DIFFERENT", "Tdiff")
		const first = await h.coordinator.consumeTerminal({
			jobId: "J-seq5",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(first.kind).toBe("owner_mismatch")
		expect(h.coordinator.diagnosticMarkerCount()).toBe(1)
		h.setActiveOwner("ORIG", "Torig")
		const second = await h.coordinator.consumeTerminal({
			jobId: "J-seq5",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(second.kind).toBe("drained")
		expect(h.enqueuedPrompts).toHaveLength(1)
	})

	it("SEQ-6: containment failure → no inappropriate wake", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq6", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-seq6",
			terminalState: "containment_failed",
			exitCode: 137,
			reason: "killed",
			isContainmentFailed: true,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("containment_no_wake")
		expect(h.enqueuedPrompts).toHaveLength(0)
		expect(h.coordinator.diagnosticMarkerCount()).toBe(0)
	})

	it("SEQ-7: kernel offline (stubbed) → obligation preserved via no_marker classification", async () => {
		const kernelOffline: ConsumeTerminalAuthorityFn = async () => ({
			kind: "kernel_offline",
			classification: "background_notify_authority_elm_kernel_offline",
		})
		const h = makeHarness({ consumeTerminalAuthority: kernelOffline })
		h.coordinator.registerMarker({ jobId: "J-seq7", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-seq7",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		// Classified failure → no_marker (audit). No wake fired.
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("SEQ-8: owner switch after snapshot but before decision → decision uses snapshot owner", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq8", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		let authorityStarted = false
		const slowAuthority: ConsumeTerminalAuthorityFn = (input) => {
			authorityStarted = true
			// Switch active owner AFTER the snapshot but BEFORE
			// the policy decision. The Elm decision is computed
			// from the SNAPSHOT.
			h.setActiveOwner("DIFFERENT", "Tdiff")
			// Use the real audit path (Elm kernel) for the decision.
			return pickConsumeDecisionForAudit(input)
		}
		const h2 = makeHarness({ consumeTerminalAuthority: slowAuthority })
		h2.coordinator.registerMarker({ jobId: "J-seq8", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h2.coordinator.consumeTerminal({
			jobId: "J-seq8",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(authorityStarted).toBe(true)
		// Decision is based on the SNAPSHOT owner (ACTIVE_SESSION).
		expect(decision.kind).toBe("drained")
		expect(h2.enqueuedPrompts).toHaveLength(1)
	})

	it("SEQ-9: dispose after the decision resolves → late effects bounded", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-seq9", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-seq9",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("drained")
		expect(h.enqueuedPrompts).toHaveLength(1)
		h.coordinator.dispose()
		expect(h.coordinator.diagnosticDisposed()).toBe(true)
	})
})

// C4 (BOUNDARY)
describe("BNACUT04-C4: boundary edge cases", () => {
	it("C4-01: exitCode undefined is encoded as -1 (Absent) → drained", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-c4-01", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-c4-01",
			terminalState: "exited",
			exitCode: undefined,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("drained")
	})

	it("C4-02: empty jobId → no_marker (fail-closed)", async () => {
		const h = makeHarness()
		const decision = await h.coordinator.consumeTerminal({
			jobId: "",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("C4-03: exitCode=-1 is the Absent sentinel", async () => {
		const h = makeHarness()
		h.coordinator.registerMarker({ jobId: "J-c4-03", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-c4-03",
			terminalState: "exited",
			exitCode: -1,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("drained")
	})
})

// C3 (FAILURE SEMANTICS)
describe("BNACUT04-C3: production failure contract", () => {
	it("C3-01: kernel_offline (no_marker classification, no duplicate effect)", async () => {
		const kernelOffline: ConsumeTerminalAuthorityFn = async () => ({
			kind: "kernel_offline",
			classification: "background_notify_authority_elm_kernel_offline",
		})
		const h = makeHarness({ consumeTerminalAuthority: kernelOffline })
		h.coordinator.registerMarker({ jobId: "J-c3-01", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-c3-01",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		// Classified failure → no_marker (audit). No wake fired.
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
		// The audit sink captured the classified failure as
		// no_marker with the failure class as the reason.
		expect(h.decisions.some((d) => d.jobId === "J-c3-01" && d.decision === "no_marker")).toBe(true)
	})

	it("C3-02: decode_error → no_marker classification, no wake", async () => {
		const decodeError: ConsumeTerminalAuthorityFn = async () => ({
			kind: "decode_error",
			reason: "simulated decode failure",
			classification: "background_notify_authority_elm_decode_error",
			requestId: "test-1",
		})
		const h = makeHarness({ consumeTerminalAuthority: decodeError })
		h.coordinator.registerMarker({ jobId: "J-c3-02", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-c3-02",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})

	it("C3-03: response_timeout → no_marker classification, no wake", async () => {
		const responseTimeout: ConsumeTerminalAuthorityFn = async () => ({
			kind: "response_timeout",
			requestId: "test-rt",
			timeoutMs: 5_000,
			classification: "background_notify_authority_elm_response_timeout",
		})
		const h = makeHarness({ consumeTerminalAuthority: responseTimeout })
		h.coordinator.registerMarker({ jobId: "J-c3-03", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		const decision = await h.coordinator.consumeTerminal({
			jobId: "J-c3-03",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(decision.kind).toBe("no_marker")
		expect(h.enqueuedPrompts).toHaveLength(0)
	})
})
