/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01 — BUNDLE-01
 *
 * The ONE-command incident-bundle export gate.
 *
 * Proves that a single dump produces a self-contained evidence bundle
 * that answers the ACT's five diagnostic questions, and that the
 * bundle is HONEST about what it does not know.
 *
 * The bundle is built from the REAL recorders after driving the REAL
 * coordinator seam — no hand-fed fixtures for the causal facts.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	getCompletionIncidentRecords,
	resetCompletionIncidentRecorderForTests,
	setCompletionIncidentFlightRecorderEnabled,
	setCompletionIncidentRecorderBounds,
} from "@shared/completion-incident-flight-recorder"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	buildCompletionIncidentBundleSummaries,
	buildCompletionIncidentBundleSummary,
	type CompletionIncidentBundleManifest,
	dumpCompletionIncidentBundle,
} from "@/sdk/completion-incident-bundle-runtime"
import {
	emitAgentTurnDone,
	emitSubmitAndExit,
	flush,
	makeFlightRecorderHarness,
} from "./completion-incident-flight-recorder-harness"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

let tmp: string

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "cifr-bundle-"))
	resetCompletionIncidentRecorderForTests()
	setCompletionIncidentFlightRecorderEnabled(true)
})

afterEach(() => {
	if (existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
	resetCompletionIncidentRecorderForTests()
})

const context = () => ({ globalStorageUri: { fsPath: tmp } })

const identity = () => ({
	extensionVersion: "0.0.0-test",
	sourceCommit: "deadbeef",
	captureProfiles: ["dogfood"],
})

describe("BUNDLE-01: the dump writes a self-contained evidence bundle", () => {
	it("BUNDLE-01.1: every required file is written", async () => {
		const dir = await dumpCompletionIncidentBundle(context(), identity())
		for (const file of [
			"manifest.json",
			"barrier-timeline.jsonl",
			"turn-state-writers.jsonl",
			"continuation-events.jsonl",
			"completion-authority.jsonl",
			"header-selection.jsonl",
			"summary.json",
			// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
			// ONE independent summary per retained incident.
			"incident-summaries.json",
		]) {
			expect(existsSync(join(dir, file))).toBe(true)
		}
	})

	it("BUNDLE-01.2: the manifest reports the identity, coverage and dropped records", async () => {
		const dir = await dumpCompletionIncidentBundle(context(), identity())
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as CompletionIncidentBundleManifest
		expect(manifest.extensionVersion).toBe("0.0.0-test")
		expect(manifest.sourceCommit).toBe("deadbeef")
		expect(manifest.captureProfiles).toEqual(["dogfood"])
		expect(manifest.schemaVersion).toBe(1)
		// The coverage block is present.
		expect(manifest.recorderCoverage).toBeDefined()
		expect(manifest.recorderCoverage.flightRecorderEnabled).toBe(true)
		// The dropped-records block is present and reports NO loss.
		expect(manifest.droppedRecords.evidenceLoss).toBe(false)
		expect(manifest.droppedRecords.evictedRecords).toBe(0)
	})

	it("BUNDLE-01.3: the manifest reports the UNAVAILABLE sources explicitly", async () => {
		const dir = await dumpCompletionIncidentBundle(context(), identity())
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as CompletionIncidentBundleManifest
		// The timeline had no records, so it is UNAVAILABLE — not
		// silently omitted.
		const timeline = manifest.sources.find((s) => s.file === "barrier-timeline.jsonl")
		expect(timeline).toBeDefined()
		expect(timeline!.status).toBe("unavailable")
		expect(timeline!.recordCount).toBe(0)
		// Every file is listed.
		expect(manifest.sources.length).toBe(5)
	})

	it("BUNDLE-01.4: the manifest reports the evidence LOSS when the recorder overflowed", async () => {
		setCompletionIncidentRecorderBounds({ globalRecordCap: 2, capsuleCap: 4 })
		const h = makeFlightRecorderHarness()
		for (let i = 0; i < 5; i++) {
			await emitSubmitAndExit(h)
			await flush()
		}
		const dir = await dumpCompletionIncidentBundle(context(), identity())
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as CompletionIncidentBundleManifest
		expect(manifest.droppedRecords.evidenceLoss).toBe(true)
		expect(manifest.droppedRecords.evictedRecords).toBeGreaterThan(0)
	})
})

describe("BUNDLE-02: the bundle answers the five diagnostic questions", () => {
	it("BUNDLE-02.1: the timeline links the hold to the authoritative completion", async () => {
		const h = makeFlightRecorderHarness({ activeSessionId: "session-a", activeTaskId: "task-a" })
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		// The user switches to task B; the barrier clears by mismatch.
		h.switchTo("session-b", "task-b")
		await emitAgentTurnDone(h)
		await flush()

		const dir = await dumpCompletionIncidentBundle(context(), identity())
		const timeline = readFileSync(join(dir, "barrier-timeline.jsonl"), "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
			.map((l) => JSON.parse(l) as { stage: string; outcome: string; markerIdentity?: { sessionId: string } })

		// Q1 "Why was completion held?" -> the completion_attempt record.
		const attempt = timeline.find((r) => r.stage === "completion_attempt")
		expect(attempt).toBeDefined()
		expect(attempt!.outcome).toBe("held")
		// Q2 "What exactly happened to the barrier?" -> the clearance record
		// carries BOTH identities.
		const clearance = timeline.find((r) => r.stage === "marker_clearance")
		expect(clearance).toBeDefined()
		expect(clearance!.outcome).toBe("session_mismatch")
		expect(clearance!.markerIdentity?.sessionId).toBe("session-a")
		// The bundle INCLUDES the previous task even after switching.
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as CompletionIncidentBundleManifest
		expect(manifest.includedTaskIds).toContain("task-a")
		expect(manifest.includedSessions).toContain("session-a")
	})
})

describe("BUNDLE-03: the summary NEVER infers a missing transition from silence", () => {
	it("BUNDLE-03.1: with no records the summary reports UNOBSERVED everywhere", () => {
		const summary = buildCompletionIncidentBundleSummary([])
		expect(summary.status).toBe("CAPTURE_INSUFFICIENT")
		expect(summary.lastObservedPhase).toBe("UNOBSERVED")
		expect(summary.lastPhaseWriter).toBe("UNOBSERVED")
		expect(summary.lastBarrierOutcome).toBe("UNOBSERVED")
		expect(summary.completionCommitted).toBe("UNOBSERVED")
		expect(summary.lastBarrierIdentity).toBe("UNOBSERVED")
		expect(summary.notes.length).toBeGreaterThan(0)
	})

	it("BUNDLE-03.2: with a BCB-HELD completion the summary reports the held phase", async () => {
		const h = makeFlightRecorderHarness()
		// The pending-prompt authority is UNKNOWN, so the BCB holds the
		// completion and publishes `resumable`.
		h.pendingPromptRead.value = { available: false }
		await emitSubmitAndExit(h)
		await flush()

		const summary = buildCompletionIncidentBundleSummary(getCompletionIncidentRecords())
		expect(summary.lastObservedPhase).toBe("resumable")
		expect(summary.lastPhaseWriter).toBe("session-event-bcb-hold-resumable")
		// No commit AND no withhold was observed, so the summary
		// reports UNOBSERVED — it does NOT infer "not committed" from
		// the absence of a commit record. This is the ACT's honesty
		// rule: never infer a missing transition from silence.
		expect(summary.completionCommitted).toBe("UNOBSERVED")
		expect(summary.status).toBe("CAPTURE_INSUFFICIENT")
	})

	it("BUNDLE-03.2b: an Elm-HELD completion is reported as withheld, not committed", async () => {
		const h = makeFlightRecorderHarness()
		h.elmDecision.value = { kind: "hold", reason: "test-hold" }
		await emitSubmitAndExit(h)
		await flush()

		// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
		// The terminality assertion is INCIDENT-SCOPED. The bundle-wide
		// summary is an OVERVIEW and never asserts an incident's
		// outcome (it could otherwise report another task's
		// completion). The per-incident summary carries the verdict.
		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		expect(summaries).toHaveLength(1)
		const summary = summaries[0]!
		// The Elm authority withheld the commit — that IS evidence, so
		// the summary reports `false`, not `UNOBSERVED`.
		expect(summary.completionCommitted).toBe(false)
		expect(summary.status).toBe("CAPTURE_SUFFICIENT")
	})

	it("BUNDLE-03.3: with a committed completion the summary reports the commit", async () => {
		const h = makeFlightRecorderHarness()
		h.elmDecision.value = { kind: "authorize" }
		await emitSubmitAndExit(h)
		await flush()

		// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
		// The terminality assertion is INCIDENT-SCOPED (see
		// BUNDLE-03.2b).
		const summaries = buildCompletionIncidentBundleSummaries(getCompletionIncidentRecords())
		expect(summaries).toHaveLength(1)
		const summary = summaries[0]!
		expect(summary.completionCommitted).toBe(true)
		expect(summary.lastObservedPhase).toBe("completed")
	})
})
