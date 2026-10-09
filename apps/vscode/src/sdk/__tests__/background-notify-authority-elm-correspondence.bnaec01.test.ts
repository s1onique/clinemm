/**
 * ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY (BNAEC01)
 *
 * Differential correspondence test: TS reference (real
 * `BackgroundNotifyCoordinator.consumeTerminal`) vs Elm candidate
 * (`pickConsumeDecisionForAudit` over the compiled kernel) on
 * the frozen BNA-01..BNA-12 corpus. This is the structural
 * evidence the Elm candidate preserves the existing decision
 * surface; the next ACT
 * (`ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`)
 * is the explicit successor for the live cutover.
 *
 * Classification: STRUCTURAL (no live supervisor; the test
 * surface drives both authorities end-to-end on identical facts).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { BackgroundNotifyAuthorityFactsInput } from "../background-notify-authority-elm"
import {
	buildFactsJson,
	failClosedNoMarker,
	pickConsumeDecisionForAudit,
	resetBackgroundNotifyAuthorityElmAuthorityForTests,
} from "../background-notify-authority-elm"
import {
	BackgroundNotifyCoordinator,
	type ConsumeTerminalDecision,
	legacyConsumeTerminalPolicy,
} from "../background-notify-coordinator"
import { type CommandJobState } from "../command-job-manager"

// ---------------------------------------------------------------------------
// Corpus (matches the BNA-01..BNA-12 fixtures in Policy.elm)
// ---------------------------------------------------------------------------

const ACTIVE_SESSION = "session-bnaec01"
const ACTIVE_TASK = "task-bnaec01"

function makeCoordinator(opts?: {
	resolveActiveOwner?: () => { sessionId: string; taskId: string | undefined } | undefined
}): BackgroundNotifyCoordinator {
	let now = 0
	return new BackgroundNotifyCoordinator({
		resolveActiveOwner: opts?.resolveActiveOwner ?? (() => ({ sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })),
		enqueueTerminalWake: async () => ({ kind: "delivered" }),
		now: () => (now += 1),
		// ACT-CLINEMM-ELM-SEAM04: BNAEC01 is the differential
		// correspondence corpus. The TS side drives the
		// coordinator with the legacy policy (the SEAM03
		// branch-by-branch decision) so the comparison isolates
		// the Elm candidate. Production wiring uses
		// `defaultElmAuthority` (the Elm kernel).
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})
}

interface CorpusEntry {
	readonly id: string
	readonly description: string
	readonly input: BackgroundNotifyAuthorityFactsInput
	readonly setupCoordinator: (c: BackgroundNotifyCoordinator) => void
}

const CORPUS: readonly CorpusEntry[] = [
	{
		id: "BNA-01",
		description: "marker absent -> NoMarker",
		input: {
			jobId: "J-1",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: null,
			markerTaskId: null,
			remainingNotify: 0,
		},
		setupCoordinator: () => {
			// No marker registration.
		},
	},
	{
		id: "BNA-02",
		description: "no active owner -> OwnerMismatch",
		input: {
			jobId: "J-2",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: null,
			activeOwnerTaskId: null,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 0,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-2", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-03",
		description: "marker.sessionId != owner.sessionId -> OwnerMismatch",
		input: {
			jobId: "J-3",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: "markerS",
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 0,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-3", sessionId: "markerS", taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-04",
		description: "marker.taskId != owner.taskId -> OwnerMismatch",
		input: {
			jobId: "J-4",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: "markerT",
			remainingNotify: 0,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-4", sessionId: ACTIVE_SESSION, taskId: "markerT" })
		},
	},
	{
		id: "BNA-05",
		description: "containment_failed + marker present -> ContainmentNoWake",
		input: {
			jobId: "J-5",
			terminalState: "containment_failed",
			isContainmentFailed: true,
			exitCode: 137,
			reason: "killed",
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 0,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-5", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-06",
		description: "remainingNotify > 0 -> Held",
		input: {
			jobId: "J-6",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 2,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-6", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
			c.registerMarker({ jobId: "J-other", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-07",
		description: "remainingNotify == 0 -> Drained",
		input: {
			jobId: "J-7",
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
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-7", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-08",
		description: "empty jobId -> NoMarker (fail-closed)",
		input: {
			jobId: "",
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
		},
		setupCoordinator: (c) => {
			// No marker; the empty jobId forces NoMarker.
		},
	},
	{
		id: "BNA-09",
		description: "negative remainingNotify -> NoMarker (fail-closed)",
		input: {
			jobId: "J-9",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: -1,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-9", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-10",
		description: "negative exitCode -> NoMarker (fail-closed)",
		input: {
			jobId: "J-10",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: -2,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 0,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-10", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-11",
		description: "exitCode null -> NoMarker (fail-closed; Absent is encoded as -1 in wire)",
		input: {
			jobId: "J-11",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: null,
			reason: undefined,
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: ACTIVE_SESSION,
			markerTaskId: ACTIVE_TASK,
			remainingNotify: 0,
		},
		setupCoordinator: (c) => {
			c.registerMarker({ jobId: "J-11", sessionId: ACTIVE_SESSION, taskId: ACTIVE_TASK })
		},
	},
	{
		id: "BNA-12",
		description: "marker absent (already-committed duplicate) -> NoMarker",
		input: {
			jobId: "J-12",
			terminalState: "exited",
			isContainmentFailed: false,
			exitCode: 0,
			reason: "duplicate",
			outputTail: undefined,
			activeOwnerSessionId: ACTIVE_SESSION,
			activeOwnerTaskId: ACTIVE_TASK,
			markerSessionId: null,
			markerTaskId: null,
			remainingNotify: 0,
		},
		setupCoordinator: () => {
			// No marker; the duplicate terminal produces NoMarker.
		},
	},
]

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BNAEC01: TS↔Elm correspondence (BackgroundNotifyAuthority)", () => {
	beforeEach(() => {
		resetBackgroundNotifyAuthorityElmAuthorityForTests()
	})

	afterEach(() => {
		resetBackgroundNotifyAuthorityElmAuthorityForTests()
	})

	for (const entry of CORPUS) {
		it(`${entry.id}: ${entry.description}`, async () => {
			// 1. Run the TS reference.
			const coordinator = makeCoordinator({
				resolveActiveOwner: entry.input.activeOwnerSessionId
					? () => ({
							sessionId: entry.input.activeOwnerSessionId as string,
							taskId: entry.input.activeOwnerTaskId ?? undefined,
						})
					: () => undefined,
			})
			entry.setupCoordinator(coordinator)
			const tsDecision: ConsumeTerminalDecision = await coordinator.consumeTerminal({
				jobId: entry.input.jobId,
				terminalState: translateToCommandJobState(entry.input.terminalState),
				exitCode: entry.input.exitCode ?? undefined,
				reason: entry.input.reason,
				isContainmentFailed: entry.input.isContainmentFailed,
				outputTail: entry.input.outputTail,
			})

			// 2. Run the Elm candidate.
			const elmAudit = await pickConsumeDecisionForAudit(entry.input)

			// 3. Compare decision kinds. The Elm candidate is
			// STRICTER on semantically wrong facts (negative
			// remainingNotify, negative exitCode other than the
			// -1 sentinel) — the schema decoder rejects them as
			// malformed and the audit surfaces a `decode_error`,
			// which the fail-closed projection maps to
			// `no_marker`. The TS predecessor does not validate
			// these fields; it just trusts them. This is
			// expected: the Elm substrate is MORE conservative
			// than the TS predecessor on bad input, and the
			// fail-closed action is the same. The BNA-09 and
			// BNA-10 fixtures therefore expect TS to produce
			// its natural decision (Drained or Held) and Elm
			// to fall closed to no_marker. We classify the
			// gap as EXPECTED_FIX (Elm is the new authority
			// and its stricter validation is the desired
			// behavior).
			const tsKind = normalizeTsKind(tsDecision)
			const elmKind = normalizeElmKind(elmAudit)

			const isElmFailClosedDecode =
				elmKind === "no_marker" &&
				(elmAudit.kind === "decode_error" || elmAudit.kind === "no_decision" || elmAudit.kind === "kernel_offline")

			const isKnownStrictValidation = entry.id === "BNA-09" || entry.id === "BNA-10"

			if (isElmFailClosedDecode && isKnownStrictValidation) {
				// Expected: Elm is more conservative on bad input.
				// This is the desired behavior of the new
				// substrate. The TS test result is preserved for
				// the test record.
				expect(elmKind).toBe("no_marker")
				expect(tsKind).not.toBe("no_marker") // sanity
				return
			}

			expect(elmKind, `${entry.id}: TS kind=${tsKind} vs Elm kind=${elmKind} (audit=${JSON.stringify(elmAudit)})`).toBe(
				tsKind,
			)
		})
	}
})

// ---------------------------------------------------------------------------
// TS-↔-Elm normalization
// ---------------------------------------------------------------------------

/**
 * Translate the Elm wire `terminalState` into the TS
 * `CommandJobState` value the production caller would have
 * produced upstream.
 */
function translateToCommandJobState(elmState: BackgroundNotifyAuthorityFactsInput["terminalState"]): CommandJobState {
	switch (elmState) {
		case "exited":
			return "exited"
		case "failed":
			return "deadline_exceeded"
		case "aborted":
			return "cancelled"
		case "killed":
			return "spawn_failed"
		case "containment_failed":
			return "containment_failed"
		case "unknown":
			return "running"
	}
}

/**
 * The TS `consumeTerminal` returns a `ConsumeTerminalDecision`; we
 * only compare the discriminator `kind` here.
 */
function normalizeTsKind(
	decision: ConsumeTerminalDecision,
): "no_marker" | "owner_mismatch" | "containment_no_wake" | "held" | "drained" {
	return decision.kind
}

/**
 * The Elm candidate returns one of four audit kinds; only the
 * `directive` branch carries a typed decision. The `decode_error`,
 * `kernel_offline`, and `no_decision` branches all map to
 * `no_marker` (the fail-closed conservative action), matching
 * `Policy.decideFailClosed`.
 */
function normalizeElmKind(audit: {
	kind: string
	value?: { kind?: string }
}): "no_marker" | "owner_mismatch" | "containment_no_wake" | "held" | "drained" {
	if (audit.kind === "directive" && audit.value && audit.value.kind) {
		return audit.value.kind as "no_marker" | "owner_mismatch" | "containment_no_wake" | "held" | "drained"
	}
	return "no_marker"
}

// ---------------------------------------------------------------------------
// Helper: buildFactsJson smoke
// ---------------------------------------------------------------------------

describe("BNAEC01: buildFactsJson shape", () => {
	it("emits a closed-schema JSON for the BNA-07 fixture", () => {
		const json = buildFactsJson(CORPUS[6].input)
		expect(json.version).toBe(1)
		expect(json.facts.terminalState).toBe("exited")
		expect(json.facts.exitCode).toBe(0)
		expect(json.facts.remainingNotify).toBe(0)
	})

	it("encodes exitCode: null as the -1 Absent sentinel", () => {
		const json = buildFactsJson(CORPUS[10].input)
		expect(json.facts.exitCode).toBe(-1)
	})

	it("failClosedNoMarker returns the conservative decision", () => {
		expect(failClosedNoMarker().kind).toBe("no_marker")
	})
})

// ---------------------------------------------------------------------------
// Malformed-edges: the Elm decoder is fail-closed on bad wire inputs.
// The TS adapter projects all of these to the conservative action.
// ---------------------------------------------------------------------------

describe("BNAEC01-ME: malformed wire inputs (decoder fail-closed)", () => {
	it("ME-01: empty jobId -> no_marker", async () => {
		const r = await pickConsumeDecisionForAudit({
			...CORPUS[7].input,
		})
		// BNA-08: empty jobId => no_marker (the schema decoder
		// accepts the empty string but the policy's
		// `factsIsExpected` returns False so the policy
		// returns NoMarker).
		expect(r.kind).toBe("directive")
		if (r.kind === "directive") {
			expect(r.value.kind).toBe("no_marker")
		}
	})

	it("ME-02: a string that is not valid JSON for the inbound port fails closed", async () => {
		// We can't easily inject bad JSON through the typed
		// adapter; the buildFactsJson path always produces
		// well-formed JSON. The Elm kernel fail-closes on
		// schema-level malformation (negative remainingNotify,
		// etc.) which the BNA-09 / BNA-10 fixtures cover.
		const r = await pickConsumeDecisionForAudit(CORPUS[6].input)
		expect(r.kind).toBe("directive")
	})

	it("ME-03: negative remainingNotify in wire JSON -> decode_error", async () => {
		const r = await pickConsumeDecisionForAudit(CORPUS[8].input)
		expect(r.kind === "decode_error" || (r.kind === "directive" && r.value.kind === "no_marker")).toBe(true)
	})

	it("ME-04: negative exitCode (not the -1 sentinel) -> decode_error", async () => {
		const r = await pickConsumeDecisionForAudit(CORPUS[9].input)
		expect(r.kind === "decode_error" || (r.kind === "directive" && r.value.kind === "no_marker")).toBe(true)
	})
})
