// ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01
//
// =============================================================================
// HONEST CLASSIFICATION: SYNTHETIC_REAL (per Factory reviewer's P0_2 verdict)
// =============================================================================
//
// Why this file exists:
//
// Per the Factory reviewer disposition 2026-09-01:
//
//   "The RED is now justified by LIVE evidence, rather than being a
//    speculative schedule."
//
//   ROOT_CAUSE_ISOLATED = YES (LIVE epoch-4 evidence)
//   FIRST_IDLE_WRITER (LIVE) = controller-epoch-transition-reseed
//   LIVE_PREVIOUS_PHASE = streaming
//   LIVE_COMMITTED_PHASE = idle
//   LIVE_NEW_EPOCH_HOST_RUNNING = PROVEN
//   LIVE_NEW_EPOCH_MODEL_STREAMING = PROVEN
//   LIVE_NEW_EPOCH_TOOL_ACTIVE = PROVEN
//
// The reviewer disposition's CORRECTION01 (P0_1, P0_2, P1) mandates:
//
//   P0_1: replace the passing defect-witness oracle with a true RED
//         that fails at HEAD — assert the INVARIANT (`streaming`)
//         and let the actual HEAD value (`idle`) be the failure.
//
//   P0_2: relabel the harness as SYNTHETIC_REAL (not
//         REAL_PRODUCTION_SEAM). The composition-harness pattern
//         (read source, extract method body, `new Function()`,
//         execute against manual `MessageIdMinter` +
//         `MessageTranslatorState` + `TurnStateTracker` deps) is
//         the documented SYNTHETIC_REAL class — same pattern as
//         `background-handoff-turnstate-discriminator.bhtd01-
//         synthetic-real.test.ts` which was relabeled for the
//         same reason per the prior reviewer's P0_2 verdict.
//
//   P1:   make the GREEN harness parameterizable so Strategy B
//         is mechanically runnable after a signature change. The
//         extractor accepts both
//            `resetMessageTranslatorAndFence(): void`           (HEAD)
//            `resetMessageTranslatorAndFence(requestedPhase?:
//                TurnPhase): void`                            (post-Repair01)
//         and `executeProductionReseed()` accepts an optional
//         `requestedPhase?: TurnPhase = "idle"`.
//
// =============================================================================
//
// THE LIVE CHRONOLOGY (per reviewer disposition epoch-4 evidence)
//
//   epoch E, phase = completed (the prior turn legitimately ended)
//   ↓
//   controller-ask-response writes streaming (the new turn begins)
//   ↓
//   resetMessageTranslatorAndFence() bumps epoch to E+1 AND
//   unconditionally writes idle  ← BREAKS THE LIVE DEFECT
//   ↓
//   (no new controller-ask-response yet, because in the LIVE
//    specimen the ask-response is itself deferred through the
//    webview — represented here as no setWithWriter at all)
//   ↓
//   New-generation model streaming starts (real foreground work)
//   ↓
//   New-generation tool activity begins (real foreground work)
//   ↓
//   state is published: modelStreaming=true, toolActive=true,
//                       turnPhase=idle (the contradiction)
//
// This file's role:
//   - SYNTHETIC_REAL RED (RED-SYNTHETIC-PRIMARY → GREEN-STRATEGY-B
//     after the production patch was applied) asserts the
//     INVARIANT (`currentPhase === "streaming"` after the active
//     chronology). FAILS at HEAD with `received: "idle"`; PASSES
//     at the post-REPAIR01 HEAD.
//   - SYNTHETIC_REAL RED (RED-PTD-CTL02) asserts the PTAD
//     1787358662798_o2lwn NEGATIVE-CONTROL invariant (stale
//     streaming MUST NOT survive a genuine epoch transition).
//     PASSES at HEAD (the existing reseed preserves it).
//
// Post-REPAIR01, the test file carries 12 witnesses organized as:
//
//   RED-source drift witnesses (2):
//     RED-SOURCE                  — post-Repair01 body shape
//     RED-UNION                   — writerId union membership
//
//   SYNTHETIC_REAL runtime witnesses (3):
//     GREEN-STRATEGY-B            — active chronology survives the
//                                   fence when caller passes
//                                   requestedPhase="streaming"
//     RED-PTD-CTL01               — PTAD control: no active
//                                   streaming prior to fence
//     RED-PTD-CTL02               — PTAD NEGATIVE-CONTROL: stale
//                                   epoch-E streaming MUST NOT
//                                   survive
//
//   Source-extraction STRUCTURAL witnesses (4):
//     GREEN-SITE-FOLLOWUP         — SdkFollowupCoordinator
//                                   callback passes "streaming"
//                                   (ACTIVE ask-response seam)
//     GREEN-SITE-CONTROL-DEFAULT  — SdkTaskControlCoordinator
//                                   callback does NOT pass
//                                   "streaming" (LIFECYCLE seam)
//     GREEN-SITE-EDIT-AND-REGENERATE
//                                 — edit-message-and-regenerate
//                                   passes "streaming" (ACTIVE
//                                   edit seam)
//     GREEN-PTAD-DEFAULT          — exactly 2 call sites pass
//                                   "streaming"; the rest default
//                                   to "idle" (PTAD preservation)
//
//   Source-extraction STRUCTURAL consumer-witnesses (3):
//     CONTROL_CLEAR_TASK          — SdkTaskControlCoordinator
//                                   .clearTask consumer reaches
//                                   the fence with NO "streaming"
//                                   argument
//     CONTROL_HISTORY_REOPEN      — SdkTaskControlCoordinator
//                                   .showTaskWithId consumer
//                                   reaches the fence with NO
//                                   "streaming" argument
//     ACTIVE_CONTINUATION         — SdkFollowupCoordinator
//                                   .continueIdleSession + .resume
//                                   SessionFromTask consumers
//                                   reach the fence AND the
//                                   SdkController wires that
//                                   callback with "streaming"
//
// IMPORTANT (per the CORRECTION01 reviewer disposition): the
// CONTROL_* and ACTIVE_CONTINUATION tests are
// SOURCE-EXTRACTION STRUCTURAL witnesses (they parse function
// bodies and constructor wiring). They are NOT runtime
// behavioral executions. They are sufficient here because the
// consumer relationships are simple and independently confirmed
// by reading the production source. A future dogfood recurrence
// of the LIVE defect (FRESH_POST_REPAIR_LIVE = PENDING) is the
// strongest final product-level confirmation; this ACT does not
// gate the code commit on that.
//
// =============================================================================

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { TurnPhase } from "@shared/ExtensionMessage"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { TurnStateTracker } from "../turn-state-tracker"

const SDK_CONTROLLER_PATH = resolve(__dirname, "../SdkController.ts")

function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

/**
 * Mirror of the production `resetMessageTranslatorAndFence` body for
 * runtime-execution purposes. Reads the production source at runtime,
 * so source drift is reflected in the test.
 *
 * P1 fix: the harness accepts an optional `requestedPhase?: TurnPhase`
 * so the Strategy-B GREEN is mechanically runnable after the
 * production signature changes to
 *   `resetMessageTranslatorAndFence(requestedPhase?: TurnPhase): void`.
 *
 * The compiled body sees `requestedPhase` as a closure variable bound
 * from the harness. At HEAD the production body does NOT reference
 * `requestedPhase` (it hardcodes `"idle"`), so the value is
 * harmless. After Strategy-B, the body references `requestedPhase`,
 * and the harness-provided value flows through.
 */
function executeProductionReseed(args: {
	messageTranslatorState: MessageTranslatorState
	turnStateTracker: TurnStateTracker
	minter: MessageIdMinter
	requestedPhase?: TurnPhase
}): void {
	const body = getProductionReseedBody()
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

/**
 * Returns the literal body of `SdkController.resetMessageTranslatorAndFence`
 * (between the opening brace and the matching closing brace).
 *
 * P1 fix: tolerant of both HEAD signature
 *   `resetMessageTranslatorAndFence(): void`
 * and post-Repair01 signature
 *   `resetMessageTranslatorAndFence(requestedPhase?: TurnPhase): void`.
 */
function getProductionReseedBody(): string {
	const source = readSource(SDK_CONTROLLER_PATH)
	let start = source.indexOf("resetMessageTranslatorAndFence(): void")
	if (start < 0) {
		start = source.indexOf("resetMessageTranslatorAndFence(requestedPhase")
	}
	if (start < 0) {
		throw new Error(
			"SdkController.resetMessageTranslatorAndFence signature not found " +
				"(tried HEAD `(): void` and post-Repair01 `(requestedPhase?: TurnPhase): void` " +
				"— if neither matches, this ACT's evidence needs to be refreshed)",
		)
	}
	const braceStart = source.indexOf("{", start)
	if (braceStart < 0) {
		throw new Error("SdkController.resetMessageTranslatorAndFence opening brace not found")
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
	throw new Error("SdkController.resetMessageTranslatorAndFence closing brace not found")
}

describe("ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01 / SYNTHETIC_REAL RED", () => {
	let minter: MessageIdMinter
	let messageTranslatorState: MessageTranslatorState
	let turnStateTracker: TurnStateTracker

	beforeEach(() => {
		minter = new MessageIdMinter()
		messageTranslatorState = new MessageTranslatorState(minter)
		turnStateTracker = new TurnStateTracker(minter)
	})

	afterEach(() => {
		// No global state to restore (every test creates fresh instances).
	})

	// -------------------------------------------------------------------------
	// SOURCE-LEVEL DRIFT WITNESS: the production reseed line exists
	// (this is the structural witness; the runtime assertions are below)
	// -------------------------------------------------------------------------
	it("RED-SOURCE: post-Repair01 SdkController.resetMessageTranslatorAndFence body uses the requestedPhase closure variable", () => {
		const body = getProductionReseedBody()
		// Strategy-B shape: the body now references the closure variable
		// `requestedPhase` instead of the literal `"idle"`. The first
		// call argument to setWithWriter MUST be a name, not a string
		// literal.
		expect(body).toMatch(
			/turnStateTracker\.setWithWriter\(\s*requestedPhase\s*,\s*undefined\s*,\s*this\.writerIdentity\(\s*"controller-epoch-transition-reseed"\s*\)/,
		)
		const bumpIdx = body.indexOf("bumpEpoch()")
		const reseedIdx = body.indexOf('"controller-epoch-transition-reseed"')
		expect(bumpIdx).toBeGreaterThanOrEqual(0)
		expect(reseedIdx).toBeGreaterThan(bumpIdx)
		// Source-level witness for the post-Repair01 parameter
		// declaration (the parameter declaration is outside the body
		// braces, so this reads the source rather than the body).
		const source = readSource(SDK_CONTROLLER_PATH)
		expect(source).toMatch(/resetMessageTranslatorAndFence\(\s*requestedPhase:\s*TurnPhase\s*=\s*"idle"\s*\)/)
	})

	// -------------------------------------------------------------------------
	// PRIMARY SYNTHETIC_REAL RED→GREEN (per Strategy-B):
	//
	// At HEAD this MUST FAIL with `received: "idle"` because the
	// production reseed unconditionally writes idle. After Strategy-B
	// lands and the call sites (site 2 + site 4) pass
	// `requestedPhase: "streaming"`, the SAME chronology keeps the
	// tracker at `streaming`.
	//
	// At the corrected-REPAIR01-HEAD, this test exercises the
	// Strategy-B witness path: the call site passes
	// `requestedPhase: "streaming"` (the witness for site 2's
	// `controller-ask-response` callback and site 4's
	// `controller-edit-message-and-regenerate` flow), and the
	// production body uses the closure `requestedPhase` in
	// setWithWriter.
	// -------------------------------------------------------------------------
	it("GREEN-STRATEGY-B: active continuation across epoch fence keeps phase=streaming when caller passes requestedPhase=streaming (PASSES at REPAIR01 HEAD)", () => {
		// EPOCH E: prior turn legitimately completed.
		minter.bumpEpoch()
		minter.bumpEpoch() // epoch = 2
		turnStateTracker.setWithWriter("completed", undefined, {
			writerId: "session-event-turn-complete-completed",
			taskId: undefined,
			epoch: minter.epoch,
		})

		// CONTROLLER-ASK-RESPONSE: new turn begins (site 2 lead-in).
		turnStateTracker.setWithWriter("streaming", undefined, {
			writerId: "controller-ask-response",
			taskId: undefined,
			epoch: minter.epoch,
		})
		expect(turnStateTracker.currentPhase).toBe("streaming")

		// EPOCH TRANSITION (Strategy-B seam): the production
		// `resetMessageTranslatorAndFence` body runs with the
		// site-2 / site-4 contract: requestedPhase="streaming".
		executeProductionReseed({
			messageTranslatorState,
			turnStateTracker,
			minter,
			requestedPhase: "streaming",
		})

		// INVARIANT: phase=streaming survives the fence.
		expect(turnStateTracker.currentPhase).toBe("streaming")

		// Post-fence structural witness: epoch advanced.
		expect(minter.epoch).toBe(3)
	})

	// -------------------------------------------------------------------------
	// CONSERVATION CONTROL #1: PTAD stale-streaming invariant at site 1/3/5.
	//
	// The original PTAD 1787358662798_o2lwn specimen was a stale
	// epoch-E streaming surviving into epoch E+1 published alongside
	// canonical idle. The reseed's job was to prevent THIS. This
	// control asserts the reseed-to-idle is contract-correct when
	// there is no active prior — the case the reseed was designed for.
	//
	// Strategy B's repair MUST NOT regress this case (the
	// `requestedPhase` parameter defaults to `idle` for sites that
	// don't opt in).
	//
	// At HEAD: PASSES (the reseed writes idle, the test asserts idle).
	// -------------------------------------------------------------------------
	it("RED-PTD-CTL01: no active streaming prior to fence — reseed-to-idle is contract-correct (PASSES at HEAD)", () => {
		minter.bumpEpoch()
		minter.bumpEpoch()
		turnStateTracker.setWithWriter("idle", undefined, {
			writerId: "task-start-init-task",
			taskId: undefined,
			epoch: minter.epoch,
		})
		executeProductionReseed({ messageTranslatorState, turnStateTracker, minter })
		expect(turnStateTracker.currentPhase).toBe("idle")
	})

	// -------------------------------------------------------------------------
	// CONSERVATION CONTROL #2 (PTAD NEGATIVE-CONTROL): stale-straggler
	// streaming prior at the fence — the PTAD 1787358662798_o2lwn
	// specimen the reseed was added to fix. Strategy A would re-
	// introduce the PTAD defect; strategy B's `idle` default
	// preserves the invariant.
	//
	// At HEAD: PASSES (the reseed overwrites stale streaming with
	// idle, the test asserts idle).
	//
	// After Strategy-B lands: MUST still PASS (the `requestedPhase`
	// default at site 1/3/5 stays `idle`; the test does not opt
	// into `streaming`, so the reseed-to-idle continues to happen).
	// -------------------------------------------------------------------------
	it("RED-PTD-CTL02: stale epoch-E streaming MUST NOT survive (PTAD 1787358662798_o2lwn NEGATIVE-CONTROL; PASSES at HEAD)", () => {
		minter.bumpEpoch()
		minter.bumpEpoch() // epoch = 2
		// A stray legacy writer leaves a streaming phase from
		// epoch E. This is the PTAD scenario.
		turnStateTracker.setWithWriter("streaming", undefined, {
			writerId: "session-event-turn-complete-resumable-straggler-preserve",
			taskId: undefined,
			epoch: minter.epoch,
		})
		expect(turnStateTracker.currentPhase).toBe("streaming")
		// Production fence: must reseed.
		executeProductionReseed({ messageTranslatorState, turnStateTracker, minter })
		// PTAD invariant: tracker is at `idle` after the fence,
		// not at the stale streaming.
		expect(turnStateTracker.currentPhase).toBe("idle")
	})

	// -------------------------------------------------------------------------
	// STRUCTURAL WITNESSES: the Strategy-B production call sites
	// must place `"streaming"` at ACTIVE seams and `"idle"` at
	// LIFECYCLE seams. Per the CORRECTION01 reviewer disposition's
	// HALT_WRONG_PRODUCTION_SEAM: the previous site classification
	// confused `SdkTaskControlCoordinator.resetMessageTranslator`
	// (a GENERIC lifecycle seam — `clearTask` / `showTaskWithId`)
	// with the ASK-RESPONSE seam.
	//
	// CORRECTED site classification:
	//
	//   ACTIVE ASK-RESPONSE seam:
	//     SdkController line ~1428 (SdkFollowupCoordinator
	//     `resetMessageTranslator` callback) — invoked by
	//     `continueIdleSession()` / `resumeSessionFromTask()` after
	//     the `controller-ask-response` `streaming` write.
	//     MUST pass `"streaming"`.
	//
	//   GENERIC LIFECYCLE seam (clearTask / showTaskWithId):
	//     SdkController line ~1479 (SdkTaskControlCoordinator
	//     `resetMessageTranslator` callback) — invoked by
	//     `clearTaskForOperation()` and `showTaskWithId()` (history
	//     reopen). MUST default to `"idle"` — these are not active
	//     continuations.
	//
	//   MODE-RESET seam:
	//     SdkController line ~1322 (SdkModeCoordinator). MUST
	//     default to `"idle"`.
	//
	//   ACTIVE EDIT-AND-REGENERATE seam:
	//     SdkController line ~3121 (preceded by
	//     `controller-edit-message-and-regenerate` `streaming`
	//     write). MUST pass `"streaming"`.
	//
	//   CHECKPOINT-RESTORE seam:
	//     SdkController line ~3233 (controller-restore-checkpoint).
	//     MUST default to `"idle"`.
	// -------------------------------------------------------------------------
	it("GREEN-SITE-FOLLOWUP: production call site at SdkFollowupCoordinator resetMessageTranslator passes requestedPhase=streaming", () => {
		const source = readSource(SDK_CONTROLLER_PATH)
		const coordBlock = extractConstructorBlock(source, "SdkFollowupCoordinator")
		expect(coordBlock).toMatch(
			/resetMessageTranslator:\s*\(\)\s*=>\s*this\.resetMessageTranslatorAndFence\(\s*"streaming"\s*\)/,
		)
	})

	it("GREEN-SITE-CONTROL-DEFAULT: production call site at SdkTaskControlCoordinator resetMessageTranslator defaults to idle (NOT streaming)", () => {
		// Per the CORRECTION01 reviewer disposition's HALT_WRONG_PRODUCTION_SEAM:
		// the SdkTaskControlCoordinator.resetMessageTranslator callback
		// is a GENERIC LIFECYCLE seam (clearTask + showTaskWithId
		// consumers). It MUST default to `"idle"`. It MUST NOT pass
		// `"streaming"`.
		const source = readSource(SDK_CONTROLLER_PATH)
		const coordBlock = extractConstructorBlock(source, "SdkTaskControlCoordinator")
		// The callback MUST exist (otherwise the structural
		// invariant is broken for a separate reason).
		expect(coordBlock).toMatch(/resetMessageTranslator:\s*\(\)\s*=>\s*this\.resetMessageTranslatorAndFence\(/)
		// And it MUST NOT pass `"streaming"`.
		expect(coordBlock).not.toMatch(
			/resetMessageTranslator:\s*\(\)\s*=>\s*this\.resetMessageTranslatorAndFence\(\s*"streaming"\s*\)/,
		)
	})

	it("GREEN-SITE-EDIT-AND-REGENERATE: production call site at edit-message-and-regenerate passes requestedPhase=streaming", () => {
		const source = readSource(SDK_CONTROLLER_PATH)
		const writerIdx = source.indexOf('"controller-edit-message-and-regenerate"')
		expect(writerIdx).toBeGreaterThan(0)
		const afterWriter = source.slice(writerIdx, writerIdx + 600)
		expect(afterWriter).toMatch(/this\.resetMessageTranslatorAndFence\(\s*"streaming"\s*\)/)
	})

	it("GREEN-PTAD-DEFAULT: sites 1/3/5 + SdkTaskControlCoordinator default to idle; only SdkFollowupCoordinator + edit-and-regenerate pass streaming", () => {
		const source = readSource(SDK_CONTROLLER_PATH)
		// Exactly 2 call sites pass `"streaming"`:
		//   - SdkFollowupCoordinator resetMessageTranslator callback
		//     (line ~1428, the active ask-response seam)
		//   - edit-and-regenerate (line ~3121, preceded by the
		//     controller-edit-message-and-regenerate `streaming`
		//     write)
		const streamingCalls = source.match(/resetMessageTranslatorAndFence\(\s*"streaming"\s*\)/g)
		expect(streamingCalls?.length).toBe(2)
		// All 5 call sites must exist (3 default + 2 streaming).
		const allCalls = source.match(
			/\b(?:this\.resetMessageTranslatorAndFence|resetMessageTranslatorAndFence)\(\s*(?:"[^"]*")?\s*\)/g,
		)
		expect(allCalls?.length).toBeGreaterThanOrEqual(5)
	})

	// -------------------------------------------------------------------------
	// SOURCE-EXTRACTION STRUCTURAL CONSUMER-WITNESSES (per the
	// CORRECTION01 reviewer disposition's `HALT_WRONG_PRODUCTION_SEAM`):
	//
	// The structural witnesses above (GREEN-SITE-FOLLOWUP /
	// GREEN-SITE-CONTROL-DEFAULT / GREEN-SITE-EDIT-AND-REGENERATE /
	// GREEN-PTAD-DEFAULT) prove the source-level call sites are wired
	// correctly. The reviewer requires additional SEMANTIC proof
	// that the CONSUMERS of those callbacks reach the right fence
	// value at the seam. These witnesses parse the SdkTaskControl-
	// Coordinator and SdkFollowupCoordinator source to extract
	// the consumer bodies and verify the fence calls they reach.
	//
	//   CONTROL_CLEAR_TASK [STRUCTURAL]:
	//     The `clearTask()` consumer of SdkTaskControlCoordinator
	//     (clearTaskForOperation at line 176 of
	//     sdk-task-control-coordinator.ts) reaches a fence that
	//     defaults to `"idle"` — NOT `"streaming"`. PTAD
	//     1787358662798_o2lwn invariant preservation.
	//
	//   CONTROL_HISTORY_REOPEN [STRUCTURAL]:
	//     The `showTaskWithId()` consumer of SdkTaskControlCoordinator
	//     (line 253 of sdk-task-control-coordinator.ts) reaches a
	//     fence that defaults to `"idle"` — NOT `"streaming"`. The
	//     phase is later DERIVED from the appended resume ask, not
	//     asserted by the fence.
	//
	//   ACTIVE_CONTINUATION [STRUCTURAL]:
	//     The SdkFollowupCoordinator consumers `continueIdleSession()`
	//     (sdk-followup-coordinator.ts line 195) and
	//     `resumeSessionFromTask()` (line 324) invoke the
	//     `resetMessageTranslator` callback. The SdkController
	//     wires that callback (line 1428) with `"streaming"`. This
	//     is the active-continuation seam that fires after the
	//     `controller-ask-response` `streaming` write.
	//
	// IMPORTANT: these are SOURCE-EXTRACTION STRUCTURAL witnesses
	// (they parse function bodies and constructor wiring). They are
	// NOT runtime behavioral executions. They are sufficient here
	// because the consumer relationships are simple and
	// independently confirmed by reading the production source.
	// A future dogfood recurrence of the LIVE defect
	// (FRESH_POST_REPAIR_LIVE = PENDING) is the strongest final
	// product-level confirmation; this ACT does not gate the code
	// commit on that.
	// -------------------------------------------------------------------------
	const TASK_CONTROL_COORDINATOR_PATH = resolve(__dirname, "../sdk-task-control-coordinator.ts")
	const FOLLOWUP_COORDINATOR_PATH = resolve(__dirname, "../sdk-followup-coordinator.ts")

	function extractFunctionBody(source: string, headerLine: string): string {
		const idx = source.indexOf(headerLine)
		if (idx < 0) {
			throw new Error(`function header not found: ${headerLine}`)
		}
		const braceStart = source.indexOf("{", idx)
		if (braceStart < 0) {
			throw new Error(`opening brace not found for: ${headerLine}`)
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
		throw new Error(`matching closing brace not found for: ${headerLine}`)
	}

	/**
	 * Extract the constructor block at `new <ClassName>({ ... })` by
	 * walking braces depth-aware. Constructor blocks contain nested
	 * closures (`})` from arrow bodies) so a naive indexOf("})", ...)
	 * stops too early.
	 */
	function extractConstructorBlock(source: string, className: string): string {
		const header = `new ${className}({`
		const idx = source.indexOf(header)
		if (idx < 0) {
			throw new Error(`constructor not found: ${header}`)
		}
		const braceStart = source.indexOf("{", idx)
		if (braceStart < 0) {
			throw new Error(`opening brace not found for: ${header}`)
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
		throw new Error(`matching closing brace not found for: ${header}`)
	}

	it('CONTROL_CLEAR_TASK [STRUCTURAL]: SdkTaskControlCoordinator.clearTask consumer reaches the fence with no "streaming" argument (PTAD preserved)', () => {
		const source = readSource(TASK_CONTROL_COORDINATOR_PATH)
		const body = extractFunctionBody(source, "async clearTaskForOperation(token: number): Promise<void>")
		// The body MUST invoke `this.options.resetMessageTranslator()`.
		expect(body).toMatch(/this\.options\.resetMessageTranslator\(/)
		// The body MUST NOT invoke the callback with `"streaming"`.
		// (Any consumer that does would be a regression of the
		// PTAD 1787358662798_o2lwn invariant.)
		expect(body).not.toMatch(/this\.options\.resetMessageTranslator\(\s*"streaming"\s*\)/)
	})

	it('CONTROL_HISTORY_REOPEN [STRUCTURAL]: SdkTaskControlCoordinator.showTaskWithId consumer reaches the fence with no "streaming" argument (PTAD preserved)', () => {
		const source = readSource(TASK_CONTROL_COORDINATOR_PATH)
		const body = extractFunctionBody(source, "async showTaskWithId(taskId: string): Promise<HistoryItem | undefined>")
		// The body MUST invoke `this.options.resetMessageTranslator()`.
		expect(body).toMatch(/this\.options\.resetMessageTranslator\(/)
		// The body MUST NOT invoke the callback with `"streaming"`.
		expect(body).not.toMatch(/this\.options\.resetMessageTranslator\(\s*"streaming"\s*\)/)
	})

	it('ACTIVE_CONTINUATION [STRUCTURAL]: SdkFollowupCoordinator consumers reach the fence via the SdkController wiring that passes "streaming"', () => {
		// Witness 1: the SdkFollowupCoordinator source actually invokes
		// `this.options.resetMessageTranslator()` at the two consumer
		// sites. If the wiring drifts, this fails.
		const followupSource = readSource(FOLLOWUP_COORDINATOR_PATH)
		const continueIdleBody = extractFunctionBody(followupSource, "private async continueIdleSession(")
		expect(continueIdleBody).toMatch(/this\.options\.resetMessageTranslator\(/)
		const resumeBody = extractFunctionBody(followupSource, "async resumeSessionFromTask(")
		expect(resumeBody).toMatch(/this\.options\.resetMessageTranslator\(/)
		// Witness 2: the SdkController wires the
		// SdkFollowupCoordinator callback with `"streaming"`. If
		// the wiring is wrong, this fails.
		const sdkSource = readSource(SDK_CONTROLLER_PATH)
		const coordBlock = extractConstructorBlock(sdkSource, "SdkFollowupCoordinator")
		expect(coordBlock).toMatch(
			/resetMessageTranslator:\s*\(\)\s*=>\s*this\.resetMessageTranslatorAndFence\(\s*"streaming"\s*\)/,
		)
	})

	// -------------------------------------------------------------------------
	// WRITER-ID UNION drift witness
	// -------------------------------------------------------------------------
	it("RED-UNION: controller-epoch-transition-reseed is a member of the TurnStateWriterId union", () => {
		const writerId: TurnStateWriterId = "controller-epoch-transition-reseed"
		expect(writerId).toBe("controller-epoch-transition-reseed")
	})
})
