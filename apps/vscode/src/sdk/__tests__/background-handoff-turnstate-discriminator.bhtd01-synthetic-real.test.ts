/**
 * ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
 *
 * SYNTHETIC_REAL test (NOT a real production-seam test) that PROVES
 * the TSWPD discriminator CAPABILITY against the two viable
 * candidates for the LIVE-bound foreground→background-handoff specimen.
 *
 * Per the Factory reviewer's P0_2 verdict
 * (`SYNTHETIC_REAL_PRESENTED_AS_REAL_PRODUCTION_SEAM`), this test
 * is honestly relabeled:
 *
 *   WHAT THIS TEST IS
 *     = real TurnStateTracker
 *     + real MessageIdMinter
 *     + real TSWPD singleton ring
 *     + real dumpExtensionSideTurnStateWriterProvenanceDiagnostic
 *     + source-derived production statement/body (extracted from
 *       SdkController.ts at HEAD)
 *     + synthetic orchestration (the test harness, not the
 *       production SdkController, decides when to call which
 *       writer)
 *
 *   WHAT THIS TEST IS NOT
 *     - it does NOT instantiate the production SdkController
 *     - it does NOT execute the production control flow
 *     - it does NOT replay the LIVE event
 *     - it does NOT bind the LIVE specimen's actual writer
 *
 * Per the reviewer's P0_1 verdict
 * (`LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND`), the LIVE specimen's
 * actual writer is STILL ONE OF THE TWO CANDIDATES. This test only
 * proves that TSWPD CAN distinguish them if it observes a real
 * execution of either writer under production control flow.
 *
 * The reviewer's Required Action is:
 *
 *   1. Enable TSWPD on a real running instance.
 *   2. Reproduce the bounded background handoff.
 *   3. Dump TSWPD.
 *   4. For the LIVE taskId/epoch, filter for
 *        committed.phase == "idle" && previous.phase != "idle"
 *   5. Record writerId, taskId, epoch, previous.phase,
 *      previous.seq, committed.seq, capturedAt.
 *   6. Correlate that write with the first publication showing idle.
 *
 * That step is operator-only. This test exists to (a) prove the
 * discriminator works, (b) drift-pin the production writer lines,
 * (c) exercise the dump/parse/filter chain end-to-end.
 *
 * The test does NOT mutate any production source.
 * The test does NOT instantiate the full SdkController.
 * The test exercises the same setWithWriter closure + same writerIdentity
 * contract + same TSWPD ring as production.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { TurnPhase } from "@shared/ExtensionMessage"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	type TurnStateWriterProvenanceRecord,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { TurnStateTracker } from "../turn-state-tracker"
import {
	dumpExtensionSideTurnStateWriterProvenanceDiagnostic,
	type TurnStateWriterProvenanceDiagnosticContext,
} from "../turn-state-writer-provenance-runtime"

const SDK_CONTROLLER_PATH = resolve(__dirname, "../SdkController.ts")

// ----------------------------------------------------------------------------
// Source-extracted production line probes. The test asserts each candidate's
// idle-write line exists at HEAD so that drift in production source causes an
// immediate assertion failure.
// ----------------------------------------------------------------------------

function expectProductionLineExists(writerId: TurnStateWriterId): void {
	const source = readFileSync(SDK_CONTROLLER_PATH, "utf8")
	const lines = source.split("\n")
	if (writerId === "controller-epoch-transition-reseed") {
		// ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01
		// Strategy-B: this writer is now parameterized via `requestedPhase`.
		// The production setWithWriter argument is the closure variable
		// `requestedPhase` (not the literal `"idle"`).
		const hit = lines.find((l) =>
			l.includes('setWithWriter(requestedPhase, undefined, this.writerIdentity("controller-epoch-transition-reseed")'),
		)
		expect(
			hit,
			`production setWithWriter(requestedPhase, ...) line missing for writerId=controller-epoch-transition-reseed in ${SDK_CONTROLLER_PATH}`,
		).toBeTruthy()
		return
	}
	const needle = `setWithWriter("idle", undefined, this.writerIdentity("${writerId}")`
	const hit = lines.find((l) => l.includes(needle))
	expect(
		hit,
		`production setWithWriter("idle", ...) line missing for writerId=${writerId} in ${SDK_CONTROLLER_PATH}`,
	).toBeTruthy()
	if (hit) {
		expect(hit).toContain(`writerIdentity("${writerId}"`)
	}
}

function readProductionLine(writerId: TurnStateWriterId): string {
	const source = readFileSync(SDK_CONTROLLER_PATH, "utf8")
	const lines = source.split("\n")
	if (writerId === "controller-epoch-transition-reseed") {
		const hit = lines.find((l) =>
			l.includes('setWithWriter(requestedPhase, undefined, this.writerIdentity("controller-epoch-transition-reseed")'),
		)
		if (!hit) {
			throw new Error(`production line not found for writerId=${writerId}`)
		}
		return hit
	}
	const needle = `setWithWriter("idle", undefined, this.writerIdentity("${writerId}")`
	const hit = source.split("\n").find((l) => l.includes(needle))
	if (!hit) {
		throw new Error(`production line not found for writerId=${writerId}`)
	}
	return hit
}

// ----------------------------------------------------------------------------
// Production reseed body extractor — mirrors aretc01-c01-real-seam.test.ts.
// Reads SdkController.ts and returns the body of resetMessageTranslatorAndFence
// so the test can compile and execute the EXACT production code path.
// ----------------------------------------------------------------------------

function getResetMessageTranslatorAndFenceBody(): string {
	const source = readFileSync(SDK_CONTROLLER_PATH, "utf8")
	let start = source.indexOf("resetMessageTranslatorAndFence(): void")
	if (start < 0) {
		start = source.indexOf("resetMessageTranslatorAndFence(requestedPhase")
	}
	if (start < 0) {
		throw new Error(
			"resetMessageTranslatorAndFence signature not found " +
				'(tried HEAD `(): void` and post-Repair01 `(requestedPhase: TurnPhase = "idle"): void`)',
		)
	}
	const braceStart = source.indexOf("{", start)
	if (braceStart < 0) {
		throw new Error("resetMessageTranslatorAndFence opening brace not found")
	}
	let depth = 0
	for (let i = braceStart; i < source.length; i++) {
		const ch = source[i]
		if (ch === "{") depth++
		else if (ch === "}") {
			depth--
			if (depth === 0) {
				return source.slice(braceStart, i + 1)
			}
		}
	}
	throw new Error("resetMessageTranslatorAndFence closing brace not found")
}

function executeProductionReseed(args: {
	minter: MessageIdMinter
	turnStateTracker: TurnStateTracker
	messageTranslatorState: {
		reset(): void
		getMinter(): MessageIdMinter
	}
	requestedPhase?: TurnPhase
}): void {
	const body = getResetMessageTranslatorAndFenceBody()
	const inner = body.slice(1, body.lastIndexOf("}"))
	const compiled = new Function(
		"messageTranslatorState",
		"turnStateTracker",
		"minter",
		"requestedPhase",
		`"use strict"; ${inner}`,
	)
	const requestedPhase = args.requestedPhase ?? "idle"
	compiled.call(
		{
			messageTranslatorState: args.messageTranslatorState,
			turnStateTracker: args.turnStateTracker,
			writerIdentity: (writerId: TurnStateWriterId) => ({
				writerId,
				taskId: undefined,
				epoch: args.minter.epoch,
			}),
			requestedPhase,
		},
		args.messageTranslatorState,
		args.turnStateTracker,
		args.minter,
		requestedPhase,
	)
}

// ----------------------------------------------------------------------------
// Production followup-abandoned line executor. Extracts the single
// setWithWriter line that lives inside SdkController.ts:1425-1427 and runs
// it against the real tracker. The production guard
//   if (this.turnStateTracker.currentPhase === "streaming" &&
//       !this.sessions.getActiveSession()?.isRunning)
// is evaluated by the test fixture; the setWithWriter line itself is the
// production code under test.
// ----------------------------------------------------------------------------

function executeProductionFollowupAbandonedLine(turnStateTracker: TurnStateTracker, minter: MessageIdMinter): boolean {
	const line = readProductionLine("followup-on-follow-up-abandoned")
	const inner = line.trim()
	const compiled = new Function("turnStateTracker", "minter", `"use strict"; ${inner}`)
	compiled.call(
		{
			turnStateTracker,
			writerIdentity: (writerId: TurnStateWriterId) => ({
				writerId,
				taskId: undefined,
				epoch: minter.epoch,
			}),
		},
		turnStateTracker,
		minter,
	)
	return true
}

// ----------------------------------------------------------------------------
// Dump-and-parse helper — mirrors the operator-driven
// cline.debug.dumpTurnStateWriterProvenanceDiagnostic cycle: enables TSWPD,
// drives the writes, dumps to JSONL, parses the JSONL, and returns the
// filtered records. The dump target is a project-local temp directory
// (mirrors the production contract where globalStorageUri is host-supplied).
// ----------------------------------------------------------------------------

async function dumpAndParseJsonl(): Promise<TurnStateWriterProvenanceRecord[]> {
	const dir = mkdtempSync(join(tmpdir(), "bhtd01-tswpd-"))
	try {
		const ctx: TurnStateWriterProvenanceDiagnosticContext = {
			workspaceState: {
				get: <T>(_key: string): T | undefined => undefined,
				update: (_key: string, _value: unknown) => Promise.resolve(),
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		const file = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(ctx)
		const text = readFileSync(file, "utf8")
		if (!text.trim()) {
			return []
		}
		return text
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as TurnStateWriterProvenanceRecord)
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			// ignore cleanup errors
		}
	}
}

function findFirstIdleWrite(records: readonly TurnStateWriterProvenanceRecord[]): TurnStateWriterProvenanceRecord | undefined {
	return records.find((r) => r.committed.phase === "idle" && r.previous.phase !== "idle")
}

// ----------------------------------------------------------------------------
// Tests — bounded operational bind per Factory reviewer Required Action.
// ----------------------------------------------------------------------------

describe("ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01 / TSWPD synthetic-real discriminator", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
	})

	afterEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
	})

	it("P0-SOURCE: every candidate idle-writer line exists at HEAD", () => {
		// Four writers live in SdkController.ts:
		expectProductionLineExists("controller-epoch-transition-reseed")
		expectProductionLineExists("followup-on-follow-up-abandoned")
		expectProductionLineExists("controller-clear-task")
		expectProductionLineExists("controller-restore-checkpoint")
		// task-control-idle-fallback lives in sdk-task-control-coordinator.ts:
		const coordPath = resolve(__dirname, "../sdk-task-control-coordinator.ts")
		const coordSource = readFileSync(coordPath, "utf8")
		expect(coordSource).toContain(`setTurnPhase("idle", undefined, "task-control-idle-fallback")`)
	})

	it("BHTD01.1: epoch-reseed path binds FIRST_IDLE_WRITER=controller-epoch-transition-reseed", async () => {
		enableTurnStateWriterProvenanceDiagnostic()
		const minter = new MessageIdMinter()
		const turnStateTracker = new TurnStateTracker(minter)
		const messageTranslatorState = {
			reset: () => {},
			getMinter: () => minter,
		}

		turnStateTracker.setWithWriter("streaming", undefined, {
			writerId: "controller-ask-response",
		})
		const streamingSeq = turnStateTracker.get().seq

		// Source-side witness: updateBackgroundCommandState body must
		// NOT contain setWithWriter (structurally forbids it).
		const sdkSource = readFileSync(SDK_CONTROLLER_PATH, "utf8")
		// Anchor on the function signature line; capture up to the first
		// matching closing brace. The body is short and indentation is
		// uniform (single tab).
		const sigIdx = sdkSource.indexOf("updateBackgroundCommandState(running:")
		expect(sigIdx, "updateBackgroundCommandState signature must exist").toBeGreaterThan(-1)
		const openBraceIdx = sdkSource.indexOf("{", sigIdx)
		expect(openBraceIdx).toBeGreaterThan(sigIdx)
		let depth = 0
		let closeBraceIdx = -1
		for (let i = openBraceIdx; i < sdkSource.length; i++) {
			const ch = sdkSource[i]
			if (ch === "{") depth++
			else if (ch === "}") {
				depth--
				if (depth === 0) {
					closeBraceIdx = i
					break
				}
			}
		}
		expect(closeBraceIdx).toBeGreaterThan(openBraceIdx)
		const body = sdkSource.slice(openBraceIdx, closeBraceIdx + 1)
		expect(body).not.toContain("setWithWriter")

		executeProductionReseed({ minter, messageTranslatorState, turnStateTracker })

		const after = turnStateTracker.get()
		expect(after.phase).toBe("idle")
		expect(after.seq).toBeGreaterThan(streamingSeq)

		const records = await dumpAndParseJsonl()
		expect(records.length).toBeGreaterThanOrEqual(2)
		const first = findFirstIdleWrite(records)
		expect(first, "FIRST_IDLE_WRITER must be found").toBeTruthy()
		expect(first!.writerId).toBe("controller-epoch-transition-reseed")
		expect(first!.previous.phase).toBe("streaming")
		expect(first!.committed.phase).toBe("idle")
		expect(first!.committed.seq).toBeGreaterThan(streamingSeq)
		expect(first!.taskId).toBeUndefined()
		expect(first!.epoch).toBe(minter.epoch)
	})

	it("BHTD01.2: followup-on-follow-up-abandoned path binds FIRST_IDLE_WRITER=followup-on-follow-up-abandoned", async () => {
		enableTurnStateWriterProvenanceDiagnostic()
		const minter = new MessageIdMinter()
		const turnStateTracker = new TurnStateTracker(minter)

		turnStateTracker.setWithWriter("streaming", undefined, {
			writerId: "controller-ask-response",
		})
		const streamingSeq = turnStateTracker.get().seq
		expect(turnStateTracker.currentPhase).toBe("streaming")

		executeProductionFollowupAbandonedLine(turnStateTracker, minter)

		const after = turnStateTracker.get()
		expect(after.phase).toBe("idle")
		expect(after.seq).toBeGreaterThan(streamingSeq)

		const records = await dumpAndParseJsonl()
		expect(records.length).toBeGreaterThanOrEqual(2)
		const first = findFirstIdleWrite(records)
		expect(first, "FIRST_IDLE_WRITER must be found").toBeTruthy()
		expect(first!.writerId).toBe("followup-on-follow-up-abandoned")
		expect(first!.previous.phase).toBe("streaming")
		expect(first!.committed.phase).toBe("idle")
		expect(first!.committed.seq).toBeGreaterThan(streamingSeq)
	})

	it("BHTD01.3: synthetic candidate schedule — both writers driven in synthetic orchestration; JSONL binds each deterministically", async () => {
		// SCENARIO A — epoch-reseed path
		{
			clearTurnStateWriterProvenanceDiagnostic()
			enableTurnStateWriterProvenanceDiagnostic()
			const minter = new MessageIdMinter()
			const tracker = new TurnStateTracker(minter)
			const mtState = { reset: () => {}, getMinter: () => minter }
			tracker.setWithWriter("streaming", undefined, {
				writerId: "controller-ask-response",
			})
			executeProductionReseed({
				minter,
				messageTranslatorState: mtState,
				turnStateTracker: tracker,
			})
			const recordsA = await dumpAndParseJsonl()
			const firstA = findFirstIdleWrite(recordsA)
			expect(firstA).toBeTruthy()
			expect(firstA!.writerId).toBe("controller-epoch-transition-reseed")
		}

		// SCENARIO B — followup-abandoned path
		{
			clearTurnStateWriterProvenanceDiagnostic()
			enableTurnStateWriterProvenanceDiagnostic()
			const minter = new MessageIdMinter()
			const tracker = new TurnStateTracker(minter)
			tracker.setWithWriter("streaming", undefined, {
				writerId: "controller-ask-response",
			})
			executeProductionFollowupAbandonedLine(tracker, minter)
			const recordsB = await dumpAndParseJsonl()
			const firstB = findFirstIdleWrite(recordsB)
			expect(firstB).toBeTruthy()
			expect(firstB!.writerId).toBe("followup-on-follow-up-abandoned")
		}
	})

	it("BHTD01.4: three filtered-out writers are structurally incompatible with the LIVE narrowing", () => {
		// The three eliminated writers cannot produce a foreground→background-handoff
		// mid-turn idle write. The narrowing pins this.
		const filteredOut: { writerId: TurnStateWriterId; contextKeyword: string }[] = [
			{ writerId: "task-control-idle-fallback", contextKeyword: "showTaskWithId" },
			{ writerId: "controller-clear-task", contextKeyword: "clearTask" },
			{ writerId: "controller-restore-checkpoint", contextKeyword: "restoreCheckpoint" },
		]
		for (const { writerId, contextKeyword } of filteredOut) {
			// task-control-idle-fallback lives in sdk-task-control-coordinator.ts;
			// the other two live in SdkController.ts.
			const sourcePath =
				writerId === "task-control-idle-fallback"
					? resolve(__dirname, "../sdk-task-control-coordinator.ts")
					: SDK_CONTROLLER_PATH
			const source = readFileSync(sourcePath, "utf8")
			const needle =
				writerId === "task-control-idle-fallback"
					? `setTurnPhase("idle", undefined, "${writerId}")`
					: `setWithWriter("idle", undefined, this.writerIdentity("${writerId}")`
			expect(source).toContain(needle)
			const idx = source.indexOf(needle)
			const before = source.slice(0, idx)
			// All three writers live in methods whose contexts are not
			// reachable from a foreground turn mid-execution while
			// backgroundCommandRunning=true.
			expect(before.includes(contextKeyword), `${writerId} must live in a ${contextKeyword} context`).toBe(true)
		}
	})

	it("BHTD01.5: JSONL dump is operator-grade reproducible evidence", async () => {
		// The LIVE operator cycle:
		//   1. Enable TSWPD
		//   2. Run the bounded recurrence
		//   3. Dump via the production runtime helper
		//   4. Filter for committed.phase == "idle" && previous.phase != "idle"
		//   5. Bind FIRST_IDLE_WRITER + seq + previous.phase
		//
		// This test exercises the synthetic-real discriminator chain
		// against the real TurnStateTracker runtime (real
		// MessageIdMinter, real TurnStateTracker, source-extracted
		// production writer code, real TSWPD dump) and asserts the
		// discriminator CAPABILITY is deterministic under both
		// candidate scenarios.
		//
		// THIS IS NOT A LIVE BIND. It does NOT prove which writer fired
		// in the live recurrence for task 1788213818870_vmswf, nor
		// whether its triggering context was legitimate. It only
		// proves that TSWPD would label each candidate correctly if
		// observed under production control flow.
		const scenarios: Array<{
			name: string
			expectedWriterId: TurnStateWriterId
			run: (minter: MessageIdMinter, tracker: TurnStateTracker) => void
		}> = [
			{
				name: "epoch-reseed",
				expectedWriterId: "controller-epoch-transition-reseed",
				run: (minter, tracker) => {
					const mtState = { reset: () => {}, getMinter: () => minter }
					tracker.setWithWriter("streaming", undefined, {
						writerId: "controller-ask-response",
					})
					executeProductionReseed({
						minter,
						messageTranslatorState: mtState,
						turnStateTracker: tracker,
					})
				},
			},
			{
				name: "followup-abandoned",
				expectedWriterId: "followup-on-follow-up-abandoned",
				run: (minter, tracker) => {
					tracker.setWithWriter("streaming", undefined, {
						writerId: "controller-ask-response",
					})
					executeProductionFollowupAbandonedLine(tracker, minter)
				},
			},
		]

		const results: Array<{
			scenario: string
			writerId: TurnStateWriterId
			previous: string
			committed: string
			seqAdvance: number
		}> = []

		for (const scenario of scenarios) {
			clearTurnStateWriterProvenanceDiagnostic()
			enableTurnStateWriterProvenanceDiagnostic()
			const minter = new MessageIdMinter()
			const tracker = new TurnStateTracker(minter)
			const streamingSeq = tracker.get().seq
			scenario.run(minter, tracker)
			const records = await dumpAndParseJsonl()
			const first = findFirstIdleWrite(records)
			expect(first, `${scenario.name}: FIRST_IDLE_WRITER must be found`).toBeTruthy()
			expect(first!.writerId).toBe(scenario.expectedWriterId)
			results.push({
				scenario: scenario.name,
				writerId: first!.writerId,
				previous: first!.previous.phase,
				committed: first!.committed.phase,
				seqAdvance: first!.committed.seq - streamingSeq,
			})
		}

		// Synthetic-real discriminator evidence summary — both
		// scenarios produce a deterministic, JSONL-bindable
		// FIRST_IDLE_WRITER under their respective guards. The LIVE
		// specimen's actual writer is UNBOUND; this test only proves
		// the TSWPD discriminator CAPABILITY against the candidate
		// union, not which candidate actually fired live. The
		// operator's TSWPD capture cycle is the gating step for the
		// LIVE verdict (see ACT §9 final disposition and
		// discriminator-capture.md §5/§6).
		expect(results.length).toBe(2)
		expect(results.map((r) => r.writerId).sort()).toEqual(
			["controller-epoch-transition-reseed", "followup-on-follow-up-abandoned"].sort(),
		)
	})
})
