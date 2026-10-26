/**
 * BENCHMARK-M3-M31-CAUSAL-LEDGER-01 — test suite
 *
 * Exercises `analyzeTerminalLedger` directly. There are NO mocks of the
 * ledger under test: every assertion drives the real implementation with
 * literal event records.
 */

import { describe, expect, test } from "bun:test"
import { type AnalysisReport, analyzeTerminalLedger, type OwnerIdentity } from "../src/terminal-ledger.ts"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const S1: OwnerIdentity = { sessionId: "s1", taskId: "t1", epoch: 7 }
const S2: OwnerIdentity = { sessionId: "s2", taskId: "t1", epoch: 7 }

function owner(sessionId: string, taskId: string, epoch: number): OwnerIdentity {
	return { sessionId, taskId, epoch }
}

function registered(seq: number, eventId: string, jobId: string, o: OwnerIdentity = S1) {
	return { type: "job_registered", seq, eventId, jobId, owner: o }
}

function terminal(seq: number, eventId: string, jobId: string, containment: "gone" | "failed", o: OwnerIdentity = S1) {
	return { type: "job_terminal", seq, eventId, jobId, containment, owner: o }
}

function observed(seq: number, eventId: string, jobId: string, o: OwnerIdentity = S1) {
	return { type: "terminal_observed", seq, eventId, jobId, owner: o }
}

function requested(seq: number, eventId: string, decisionId: string, o: OwnerIdentity = S1) {
	return { type: "completion_requested", seq, eventId, decisionId, owner: o }
}

function decisionsById(report: AnalysisReport) {
	return new Map(report.decisions.map((d) => [d.decisionId, d]))
}

// ---------------------------------------------------------------------------
// Mandatory scenario
// ---------------------------------------------------------------------------

describe("mandatory scenario: (s1, t1, epoch=7)", () => {
	const events = [
		registered(1, "e1", "j1"),
		requested(2, "e2", "d1"),
		terminal(3, "e3", "j1", "gone"),
		requested(4, "e4", "d2"),
		observed(5, "e5", "j1"),
		requested(6, "e6", "d3"),
	]

	test("d1 HOLDs, d2 HOLDs, d3 ALLOWs", () => {
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(true)
		expect(report.decisions.map((d) => [d.decisionId, d.decision])).toEqual([
			["d1", "HOLD"],
			["d2", "HOLD"],
			["d3", "ALLOW"],
		])
		expect(report.summary.allowCount).toBe(1)
		expect(report.summary.holdCount).toBe(2)
		expect(report.ok).toBe(false)
	})

	test("d1 blocks on terminal_not_confirmed", () => {
		const report = analyzeTerminalLedger(events)
		const d1 = decisionsById(report).get("d1")
		expect(d1?.decision).toBe("HOLD")
		expect(d1?.blockingJobIds).toEqual(["j1"])
		expect(d1?.reasons).toEqual(["terminal_not_confirmed"])
	})

	test("d2 blocks on observation_missing (terminal gone but not yet observed)", () => {
		const report = analyzeTerminalLedger(events)
		const d2 = decisionsById(report).get("d2")
		expect(d2?.decision).toBe("HOLD")
		expect(d2?.blockingJobIds).toEqual(["j1"])
		expect(d2?.reasons).toEqual(["observation_missing"])
	})

	test("d3 ALLOWs with no blocking jobs", () => {
		const report = analyzeTerminalLedger(events)
		const d3 = decisionsById(report).get("d3")
		expect(d3?.decision).toBe("ALLOW")
		expect(d3?.blockingJobIds).toEqual([])
		expect(d3?.reasons).toEqual([])
		expect(d3?.seq).toBe(6)
	})
})

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("ordering", () => {
	test("sorts by seq, not by array position", () => {
		const shuffled = [
			requested(6, "e6", "d3"),
			observed(5, "e5", "j1"),
			requested(4, "e4", "d2"),
			terminal(3, "e3", "j1", "gone"),
			requested(2, "e2", "d1"),
			registered(1, "e1", "j1"),
		]
		const report = analyzeTerminalLedger(shuffled)
		expect(report.decisions.map((d) => [d.decisionId, d.decision])).toEqual([
			["d1", "HOLD"],
			["d2", "HOLD"],
			["d3", "ALLOW"],
		])
	})

	test("ignores timestamps entirely (a misleading timestamp cannot reorder events)", () => {
		const withTimestamps = [
			{ ...registered(1, "e1", "j1"), timestamp: 9_999_999 },
			{ ...requested(2, "e2", "d1"), timestamp: 1 },
			{ ...terminal(3, "e3", "j1", "gone"), timestamp: 5 },
			{ ...observed(5, "e5", "j1"), timestamp: 0 },
			{ ...requested(6, "e6", "d3"), timestamp: 100 },
		]
		const report = analyzeTerminalLedger(withTimestamps)
		expect(report.decisions.map((d) => [d.decisionId, d.decision])).toEqual([
			["d1", "HOLD"],
			["d3", "ALLOW"],
		])
	})

	test("reports decisions in ascending seq order", () => {
		const events = [requested(30, "e3", "d3"), requested(10, "e1", "d1"), requested(20, "e2", "d2")]
		const report = analyzeTerminalLedger(events)
		expect(report.decisions.map((d) => d.seq)).toEqual([10, 20, 30])
	})
})

// ---------------------------------------------------------------------------
// Owner correlation
// ---------------------------------------------------------------------------

describe("owner correlation requires the COMPLETE owner identity", () => {
	test("a foreign session registering the same job ID cannot discharge the owner's obligation", () => {
		const events = [
			registered(1, "e1", "j1", S1),
			terminal(2, "e2", "j1", "gone", S2),
			observed(3, "e3", "j1", S2),
			requested(4, "e4", "d1", S1),
		]
		const report = analyzeTerminalLedger(events)
		const d1 = decisionsById(report).get("d1")
		expect(d1?.decision).toBe("HOLD")
		expect(d1?.blockingJobIds).toEqual(["j1"])
		expect(d1?.reasons).toEqual(["terminal_not_confirmed"])
	})

	test("a foreign task cannot discharge the owner's obligation", () => {
		const other = owner(S1.sessionId, "t2", S1.epoch)
		const events = [
			registered(1, "e1", "j1", S1),
			terminal(2, "e2", "j1", "gone", other),
			observed(3, "e3", "j1", other),
			requested(4, "e4", "d1", S1),
		]
		const report = analyzeTerminalLedger(events)
		expect(decisionsById(report).get("d1")?.decision).toBe("HOLD")
	})

	test("a stale epoch cannot discharge the owner's obligation", () => {
		const stale = owner(S1.sessionId, S1.taskId, S1.epoch - 1)
		const events = [
			registered(1, "e1", "j1", S1),
			terminal(2, "e2", "j1", "gone", stale),
			observed(3, "e3", "j1", stale),
			requested(4, "e4", "d1", S1),
		]
		const report = analyzeTerminalLedger(events)
		expect(decisionsById(report).get("d1")?.decision).toBe("HOLD")
	})

	test("a newer epoch cannot discharge the owner's obligation", () => {
		const newer = owner(S1.sessionId, S1.taskId, S1.epoch + 1)
		const events = [
			registered(1, "e1", "j1", S1),
			terminal(2, "e2", "j1", "gone", newer),
			observed(3, "e3", "j1", newer),
			requested(4, "e4", "d1", S1),
		]
		const report = analyzeTerminalLedger(events)
		expect(decisionsById(report).get("d1")?.decision).toBe("HOLD")
	})

	test("two owners registering the same job ID are tracked independently", () => {
		const events = [
			registered(1, "e1", "j1", S1),
			registered(2, "e2", "j1", S2),
			terminal(3, "e3", "j1", "gone", S1),
			observed(4, "e4", "j1", S1),
			requested(5, "e5", "d-s1", S1),
			requested(6, "e6", "d-s2", S2),
		]
		const report = analyzeTerminalLedger(events)
		const byId = decisionsById(report)
		expect(byId.get("d-s1")?.decision).toBe("ALLOW")
		expect(byId.get("d-s2")?.decision).toBe("HOLD")
		expect(byId.get("d-s2")?.reasons).toEqual(["terminal_not_confirmed"])
	})

	test("a new epoch of the same task starts with a fresh obligation set", () => {
		const epoch8 = owner("s1", "t1", 8)
		const events = [
			registered(1, "e1", "j1", S1),
			terminal(2, "e2", "j1", "gone", S1),
			observed(3, "e3", "j1", S1),
			requested(4, "e4", "d-old", S1),
			registered(5, "e5", "j2", epoch8),
			requested(6, "e6", "d-new", epoch8),
		]
		const report = analyzeTerminalLedger(events)
		const byId = decisionsById(report)
		expect(byId.get("d-old")?.decision).toBe("ALLOW")
		// The epoch-8 owner owns j2 but never observed it.
		expect(byId.get("d-new")?.decision).toBe("HOLD")
		expect(byId.get("d-new")?.blockingJobIds).toEqual(["j2"])
	})

	test("observations arriving in reverse array order still discharge the owner", () => {
		const events = [
			requested(6, "e6", "d3"),
			observed(5, "e5", "j1"),
			terminal(3, "e3", "j1", "gone"),
			registered(1, "e1", "j1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(report.decisions.map((d) => [d.decisionId, d.decision])).toEqual([["d3", "ALLOW"]])
	})
})

// ---------------------------------------------------------------------------
// Causal ordering of the observation relative to the terminal confirmation
// ---------------------------------------------------------------------------

describe("observation must be consumed AFTER terminal confirmation", () => {
	test("an observation BEFORE the terminal confirmation does not discharge the obligation", () => {
		const events = [
			registered(1, "e1", "j1"),
			observed(2, "e2", "j1"),
			terminal(3, "e3", "j1", "gone"),
			requested(4, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		const d1 = decisionsById(report).get("d1")
		expect(d1?.decision).toBe("HOLD")
		expect(d1?.reasons).toEqual(["observation_before_terminal"])
	})

	test("an observation at the SAME seq as the terminal confirmation does not discharge it", () => {
		const events = [
			registered(1, "e1", "j1"),
			{ type: "job_terminal", seq: 2, eventId: "e2", jobId: "j1", containment: "gone", owner: S1 },
			{ type: "terminal_observed", seq: 2, eventId: "e3", jobId: "j1", owner: S1 },
			requested(3, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		// Same-seq records conflict on the seq axis, so the input is invalid.
		expect(report.valid).toBe(false)
		expect(report.summary.allowCount).toBe(0)
	})

	test("an observation strictly after the terminal confirmation discharges the obligation", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "gone"),
			observed(3, "e3", "j1"),
			requested(4, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(decisionsById(report).get("d1")?.decision).toBe("ALLOW")
	})

	test("a pre-terminal observation PLUS a post-terminal observation discharges the obligation", () => {
		const events = [
			registered(1, "e1", "j1"),
			observed(2, "e2", "j1"),
			terminal(3, "e3", "j1", "gone"),
			observed(4, "e4", "j1"),
			requested(5, "e5", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(decisionsById(report).get("d1")?.decision).toBe("ALLOW")
	})

	test("later events never retroactively authorize an earlier completion request", () => {
		const events = [
			registered(1, "e1", "j1"),
			requested(2, "e2", "d1"),
			terminal(3, "e3", "j1", "gone"),
			observed(4, "e4", "j1"),
			requested(5, "e5", "d2"),
		]
		const report = analyzeTerminalLedger(events)
		const byId = decisionsById(report)
		expect(byId.get("d1")?.decision).toBe("HOLD")
		expect(byId.get("d1")?.reasons).toEqual(["terminal_not_confirmed"])
		expect(byId.get("d2")?.decision).toBe("ALLOW")
	})

	test("a job registered AFTER the request is not an obligation for that request", () => {
		const events = [
			requested(1, "e1", "d1"),
			registered(2, "e2", "j1"),
			terminal(3, "e3", "j1", "gone"),
			observed(4, "e4", "j1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(decisionsById(report).get("d1")?.decision).toBe("ALLOW")
	})
})

// ---------------------------------------------------------------------------
// Containment classification
// ---------------------------------------------------------------------------

describe("containment classification", () => {
	test("a `failed` containment blocks completion even when an observation exists", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "failed"),
			observed(3, "e3", "j1"),
			requested(4, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		const d1 = decisionsById(report).get("d1")
		expect(d1?.decision).toBe("HOLD")
		expect(d1?.reasons).toEqual(["containment_failed"])
	})

	test("contradictory terminal classifications do not silently overwrite each other", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "gone"),
			terminal(3, "e3", "j1", "failed"),
			observed(4, "e4", "j1"),
			requested(5, "e5", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(false)
		expect(report.diagnostics.map((d) => d.code)).toContain("TERMINAL_CLASSIFICATION_CONFLICT")
		expect(report.summary.allowCount).toBe(0)
		expect(decisionsById(report).get("d1")?.decision).toBe("HOLD")
	})

	test("a repeated identical terminal classification is idempotent", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "gone"),
			terminal(3, "e3", "j1", "gone"),
			observed(4, "e4", "j1"),
			requested(5, "e5", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(true)
		expect(decisionsById(report).get("d1")?.decision).toBe("ALLOW")
	})

	test("observing an unknown job is not proof of consumption", () => {
		const events = [
			registered(1, "e1", "j1"),
			observed(2, "e2", "ghost"),
			terminal(3, "e3", "j1", "gone"),
			requested(4, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(false)
		expect(report.diagnostics.map((d) => d.code)).toContain("OBSERVATION_FOR_UNKNOWN_JOB")
		expect(report.summary.allowCount).toBe(0)
	})

	test("observing a registered but NONTERMINAL job is not proof of consumption", () => {
		const events = [registered(1, "e1", "j1"), observed(2, "e2", "j1"), requested(3, "e3", "d1")]
		const report = analyzeTerminalLedger(events)
		const d1 = decisionsById(report).get("d1")
		expect(d1?.decision).toBe("HOLD")
		expect(d1?.reasons).toEqual(["terminal_not_confirmed"])
	})
})

// ---------------------------------------------------------------------------
// Duplicates and conflicts
// ---------------------------------------------------------------------------

describe("duplicate and conflict handling", () => {
	test("identical duplicate events are idempotent", () => {
		const base = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "gone"),
			observed(3, "e3", "j1"),
			requested(4, "e4", "d1"),
		]
		const duplicated = [...base, ...base.map((e) => ({ ...e }))]
		const report = analyzeTerminalLedger(duplicated)
		expect(report.valid).toBe(true)
		expect(report.diagnostics).toEqual([])
		expect(report.summary.duplicateCount).toBe(4)
		expect(report.summary.eventCount).toBe(4)
		expect(decisionsById(report).get("d1")?.decision).toBe("ALLOW")
	})

	test("a conflicting duplicate eventId invalidates the input", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e1", "j1", "gone"),
			observed(3, "e3", "j1"),
			requested(4, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(false)
		expect(report.ok).toBe(false)
		expect(report.diagnostics.map((d) => d.code)).toContain("DUPLICATE_EVENT_ID_CONFLICT")
		expect(report.summary.allowCount).toBe(0)
		expect(report.decisions.every((d) => d.decision === "HOLD")).toBe(true)
	})

	test("a conflicting duplicate seq invalidates the input", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "gone"),
			observed(2, "e3", "j1"),
			requested(4, "e4", "d1"),
		]
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(false)
		expect(report.diagnostics.map((d) => d.code)).toContain("DUPLICATE_SEQ_CONFLICT")
		expect(report.summary.allowCount).toBe(0)
	})

	test("an invalid input can never produce an ALLOW even when the happy path is present", () => {
		const events = [
			registered(1, "e1", "j1"),
			terminal(2, "e2", "j1", "gone"),
			observed(3, "e3", "j1"),
			requested(4, "e4", "d1"),
			{ type: "job_registered", seq: 5, eventId: "bad", jobId: "j2" },
		]
		const report = analyzeTerminalLedger(events)
		expect(report.valid).toBe(false)
		expect(report.summary.allowCount).toBe(0)
		expect(report.decisions.every((d) => d.decision === "HOLD")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// Malformed records
// ---------------------------------------------------------------------------

describe("malformed records fail closed with deterministic diagnostics", () => {
	test("a non-object record is rejected", () => {
		const report = analyzeTerminalLedger([null, 42, "nope"])
		expect(report.valid).toBe(false)
		expect(report.diagnostics.every((d) => d.code === "EVENT_NOT_OBJECT")).toBe(true)
		expect(report.diagnostics.map((d) => d.inputIndex)).toEqual([0, 1, 2])
	})

	test("an unknown event type is rejected", () => {
		const report = analyzeTerminalLedger([{ type: "job_exploded", seq: 1, eventId: "e1" }])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("UNKNOWN_EVENT_TYPE")
	})

	test("a missing seq is rejected", () => {
		const report = analyzeTerminalLedger([{ type: "job_registered", eventId: "e1", jobId: "j1", owner: S1 }])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("MISSING_FIELD")
	})

	test("a non-integer seq is rejected", () => {
		const report = analyzeTerminalLedger([
			{ type: "job_registered", seq: 1.5, eventId: "e1", jobId: "j1", owner: S1 },
		])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("INVALID_FIELD_TYPE")
	})

	test("a missing owner is rejected", () => {
		const report = analyzeTerminalLedger([{ type: "job_registered", seq: 1, eventId: "e1", jobId: "j1" }])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("INVALID_FIELD_TYPE")
	})

	test("an owner missing the epoch component is rejected", () => {
		const report = analyzeTerminalLedger([
			{ type: "job_registered", seq: 1, eventId: "e1", jobId: "j1", owner: { sessionId: "s1", taskId: "t1" } },
		])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("MISSING_FIELD")
	})

	test("an unknown containment classification is rejected", () => {
		const report = analyzeTerminalLedger([
			registered(1, "e1", "j1"),
			{ type: "job_terminal", seq: 2, eventId: "e2", jobId: "j1", containment: "maybe", owner: S1 },
		])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("INVALID_FIELD_VALUE")
	})

	test("a missing decisionId on a completion request is rejected", () => {
		const report = analyzeTerminalLedger([{ type: "completion_requested", seq: 1, eventId: "e1", owner: S1 }])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("MISSING_FIELD")
	})

	test("a non-array input is rejected", () => {
		const report = analyzeTerminalLedger("not-an-array" as unknown as readonly unknown[])
		expect(report.valid).toBe(false)
		expect(report.diagnostics[0]?.code).toBe("INPUT_NOT_ARRAY")
		expect(report.summary.allowCount).toBe(0)
	})

	test("diagnostics are deterministic and ordered by input index", () => {
		const events = [null, { type: "nope", seq: 1, eventId: "e1" }, 7]
		const first = analyzeTerminalLedger(events)
		const second = analyzeTerminalLedger(events)
		expect(first.diagnostics).toEqual(second.diagnostics)
		expect(first.diagnostics.map((d) => d.inputIndex)).toEqual([0, 1, 2])
	})
})

// ---------------------------------------------------------------------------
// Determinism, purity and report shape
// ---------------------------------------------------------------------------

describe("determinism, purity and report shape", () => {
	const events = [
		registered(1, "e1", "j1"),
		registered(2, "e2", "j2"),
		terminal(3, "e3", "j1", "gone"),
		terminal(4, "e4", "j2", "gone"),
		observed(5, "e5", "j1"),
		observed(6, "e6", "j2"),
		requested(7, "e7", "d1"),
	]

	test("the supplied input is never mutated", () => {
		const snapshot = JSON.stringify(events)
		const input = events as readonly unknown[]
		analyzeTerminalLedger(input)
		expect(JSON.stringify(input)).toBe(snapshot)
	})

	test("the supplied input array is not reordered", () => {
		const input = [...events]
		const snapshot = [...input]
		analyzeTerminalLedger(input)
		expect(input).toEqual(snapshot)
	})

	test("repeated analysis of the same input yields byte-identical JSON", () => {
		const first = JSON.stringify(analyzeTerminalLedger(events))
		const second = JSON.stringify(analyzeTerminalLedger(events))
		expect(first).toBe(second)
	})

	test("analysis of a shuffled input yields the same decisions as the sorted input", () => {
		const shuffled = [...events].reverse()
		const a = analyzeTerminalLedger(events)
		const b = analyzeTerminalLedger(shuffled)
		expect(b.decisions).toEqual(a.decisions)
		expect(b.summary.allowCount).toBe(a.summary.allowCount)
	})

	test("the report is JSON-serializable and round-trips", () => {
		const report = analyzeTerminalLedger(events)
		const roundTripped = JSON.parse(JSON.stringify(report))
		expect(roundTripped).toEqual(JSON.parse(JSON.stringify(report)))
		expect(typeof report.ok).toBe("boolean")
		expect(typeof report.valid).toBe("boolean")
	})

	test("multiple blocking jobs are reported sorted with their reasons", () => {
		const multi = [
			registered(1, "e1", "jb"),
			registered(2, "e2", "ja"),
			terminal(3, "e3", "jb", "failed"),
			terminal(4, "e4", "ja", "gone"),
			requested(5, "e5", "d1"),
		]
		const report = analyzeTerminalLedger(multi)
		const d1 = decisionsById(report).get("d1")
		expect(d1?.decision).toBe("HOLD")
		expect(d1?.blockingJobIds).toEqual(["ja", "jb"])
		expect(d1?.reasons).toEqual(["observation_missing", "containment_failed"])
		expect(d1?.blocking).toEqual([
			{ jobId: "ja", reason: "observation_missing" },
			{ jobId: "jb", reason: "containment_failed" },
		])
	})

	test("a completion request for an owner with no registered jobs is ALLOWed", () => {
		const report = analyzeTerminalLedger([requested(1, "e1", "d1")])
		expect(report.valid).toBe(true)
		expect(report.decisions[0]?.decision).toBe("ALLOW")
		expect(report.ok).toBe(true)
	})

	test("the summary counts agree with the decisions", () => {
		const report = analyzeTerminalLedger(events)
		expect(report.summary.decisionCount).toBe(report.decisions.length)
		expect(report.summary.allowCount).toBe(report.decisions.filter((d) => d.decision === "ALLOW").length)
		expect(report.summary.holdCount).toBe(report.decisions.filter((d) => d.decision === "HOLD").length)
		expect(report.summary.inputCount).toBe(events.length)
	})
})
