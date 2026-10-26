/**
 * ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01
 *
 * RED witness for the live incident:
 *
 *   SESSION = 1792824738628_cw4og
 *   EPOCH   = 8
 *   C9      = 2 observed attempts
 *   C10     = 0 observed commits
 *   LEGACY  = streaming
 *   UI      = Working / Cancel
 *   ROW     = finalized completion_result
 *
 * The reported mismatch: a finalized `completion_result` row is
 * PRESENTED as authoritative completion (the green "Completed" badge)
 * while the task is still `streaming`, the TaskHeader says "Working",
 * and no canonical C10 completion commit has occurred.
 *
 * PHASE 3 REQUIREMENT: the RED must assert the actual AUTHORITATIVE ROW
 * FRAMING or the PUBLISHED UI PROJECTION — not merely that a
 * `completion_result` message exists.
 *
 * This suite drives the REAL production seams:
 *   - `MessageTranslatorState` + `translateSessionEvent` (the production
 *     message translator),
 *   - `SdkSessionEventCoordinator.handleSessionEvent` (the production
 *     session event coordinator — where the C9 capture, the C10 commit
 *     barrier, and the message-layer completion filter live),
 *   - `TurnStateTracker` (the production phase writer),
 *   - `BackgroundNotifyCoordinator` (the production BCB owner),
 * and the REAL webview framing projection
 * (`resolveTerminalReportFraming` from
 * `webview-ui/src/components/chat/terminalReportFraming.ts`) so the
 * assertion is on the AUTHORITATIVE ROW FRAMING, not on message shape.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { describe, expect, it, vi } from "vitest"
// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01: the REAL webview
// authority projection. Imported from the webview source tree so the
// RED asserts the AUTHORITATIVE ROW FRAMING (the "Completed" badge)
// rather than the mere presence of a `completion_result` message.
import { resolveTerminalReportFraming } from "../../../webview-ui/src/components/chat/terminalReportFraming"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

interface ClineMessage {
	ts: number
	type: "say" | "ask"
	say?: string
	ask?: string
	text?: string
	partial?: boolean
	isAuthoritativelyCompletedResult?: boolean
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	activeSessionId: string
	activeTaskId: string
	appendAndEmit: ReturnType<typeof vi.fn>
	completionCommitCount: () => number
	committedPhases: () => string[]
	/** Background jobs launched by THIS turn (owned job ids). */
	ownedJobIds: string[]
	/** Jobs whose notify marker is still alive. */
	activeNotifyJobIds: Set<string>
	/** Running background jobs for the owner. */
	runningJobIds: Set<string>
	/** Unconsumed owned terminal results (BCB held observations). */
	unconsumedTerminalCount: number
	/** Pending prompt count authority. */
	pendingPromptCount: number
	/** Override the Elm completion-authority decision. */
	setElmDecision: (fn: () => ElmCompletionAuthorityDecision) => void
	/**
	 * The MESSAGE STORE as the user sees it: the rows that survived the
	 * message-layer completion filter, with any retraction applied.
	 */
	storedRows: ClineMessage[]
}

function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: 1,
		pgid: 1,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "OK\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	}) as unknown as SupervisableShellProcess
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-c9c10scr01"
	const activeTaskId = opts.activeTaskId ?? "task-c9c10scr01"

	const appendAndEmit = vi.fn()
	/**
	 * The MESSAGE STORE, modelled with the production upsert-by-`ts`
	 * semantics. This is what the USER SEES — the rows that survived
	 * the message-layer completion filter, with any retraction applied.
	 */
	const storedRows: ClineMessage[] = []
	let completionCommitCount = 0
	const committedPhases: string[] = []
	const ownedJobIds: string[] = []
	const activeNotifyJobIds = new Set<string>()
	const runningJobIds = new Set<string>()
	const state = { unconsumedTerminalCount: 0, pendingPromptCount: 0 }
	// The Elm completion-authority decision. Default: AUTHORIZE.
	// The live incident corresponds to the HOLD / FAILURE outcome.
	let elmDecision: () => ElmCompletionAuthorityDecision = () => ({
		kind: "authorize",
		reason: "c9c10scr01-test-authorize",
	})
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((msgs: unknown[]) => {
				// Model the PRODUCTION message store's upsert-by-`ts`
				// semantics (MessageStateHandler.addMessages): a message
				// with the same `ts` REPLACES the stored row in place.
				// The retraction seam relies on this.
				for (const m of msgs as ClineMessage[]) {
					const idx = storedRows.findIndex((r) => r.ts === m.ts)
					if (idx >= 0) {
						storedRows[idx] = m
					} else {
						storedRows.push(m)
					}
				}
				appendAndEmit(msgs as never)
			}) as never,
			// The PRODUCTION "update a message" channel
			// (SdkMessageCoordinator.emitHookMessage): store-append
			// (upsert by `ts`) + a direct webview push. It does NOT
			// emit a session event, so the published-row cardinality is
			// unchanged.
			emitHookMessage: (m: ClineMessage) => {
				const idx = storedRows.findIndex((r) => r.ts === m.ts)
				if (idx >= 0) {
					storedRows[idx] = m
				} else {
					storedRows.push(m)
				}
			},
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			committedPhases.push(phase)
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01: the Elm
		// completion-authority decision provider. The Elm kernel is the
		// MANDATORY authority for the C10 commit (no silent TS
		// fallback). The harness drives it explicitly so the test can
		// exercise both the AUTHORIZE and the HOLD/FAILURE outcomes.
		getElmCompletionAuthorityDecision: () => elmDecision(),
		hasRunningBackgroundJobForOwner: (sid: string | undefined) => {
			if (sid !== activeSessionId) return false
			return runningJobIds.size > 0
		},
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return state.unconsumedTerminalCount
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId || tid !== activeTaskId) return []
			return state.unconsumedTerminalCount > 0 ? ownedJobIds.slice() : []
		},
		getPendingPromptCount: () => ({ available: true as const, count: state.pendingPromptCount }),
		getActiveNotifyCount: (sid: string | undefined, tid: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(sid ?? activeSessionId, tid ?? activeTaskId),
		hasActiveNotify: (jobId: string) => activeNotifyJobIds.has(jobId),
		getLaunchedBackgroundJobIds: () => ownedJobIds.slice(),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		activeSessionId,
		activeTaskId,
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		committedPhases: () => committedPhases.slice(),
		ownedJobIds,
		activeNotifyJobIds,
		runningJobIds,
		get unconsumedTerminalCount() {
			return state.unconsumedTerminalCount
		},
		set unconsumedTerminalCount(v: number) {
			state.unconsumedTerminalCount = v
		},
		get pendingPromptCount() {
			return state.pendingPromptCount
		},
		set pendingPromptCount(v: number) {
			state.pendingPromptCount = v
		},
		setElmDecision(fn: () => ElmCompletionAuthorityDecision) {
			elmDecision = fn
		},
		storedRows,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/**
 * Drive the canonical production translation pipeline:
 *   content_start(submit_and_exit) -> content_end(submit_and_exit) -> done
 *
 * The `content_end` is the CANONICAL completion publication seam
 * (`message-translator.ts:1761-1821`): it emits the finalized
 * `say:"completion_result"` row and stamps the
 * `isAuthoritativelyCompletedResult` marker.
 */
async function driveSubmitAndExit(h: Harness, opts: { resultText?: string; turnId?: string } = {}): Promise<void> {
	const resultText = opts.resultText ?? "Verdict."
	const sessionId = h.activeSessionId
	const turnId = opts.turnId ?? "turn-1"

	await h.coordinator.handleSessionEvent(
		agentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolName: "submit_and_exit",
			toolCallId: `tc-${turnId}-submit`,
			input: { result: resultText },
		}),
	)
	await h.coordinator.handleSessionEvent(
		agentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolName: "submit_and_exit",
			toolCallId: `tc-${turnId}-submit`,
			input: { result: resultText },
		}),
	)
	await h.coordinator.handleSessionEvent(
		agentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: resultText,
			iterations: 1,
		}),
	)
}

/**
 * Every `completion_result` row in the MESSAGE STORE — i.e. what the
 * user actually sees.
 *
 * The first row published for a completion tool is the PARTIAL one
 * (`content_start`); the FINALIZED row is published at `content_end`.
 * Only the finalized row carries the authority marker, so the
 * conservation checks below distinguish the two.
 *
 * The store applies the production upsert-by-`ts` semantics, so a
 * retraction (re-publication with the same `ts` and the marker
 * dropped) is reflected here.
 */
function publishedCompletionRows(h: Harness): ClineMessage[] {
	return h.storedRows.filter((m) => m.say === "completion_result")
}

/** The FINALIZED (non-partial) completion row, if one was published. */
function finalizedCompletionRow(h: Harness): ClineMessage | undefined {
	return publishedCompletionRows(h).find((m) => m.partial !== true)
}

/**
 * The AUTHORITATIVE ROW FRAMING — the exact predicate the webview uses
 * to decide whether the green "Completed" badge is rendered.
 *
 * This is the projection under test: it answers "does the USER SEE
 * authoritative completion?", which is the invariant the ACT states:
 *
 *   Current-turn authoritative completion display
 *     => C10 committed for the same owner/epoch
 */
function authoritativeCompletionFraming(h: Harness): { label: string; kind: string } | undefined {
	const row = finalizedCompletionRow(h)
	if (!row) {
		return undefined
	}
	const framing = resolveTerminalReportFraming({
		message: row as never,
		turnState: { phase: h.tracker.currentPhase, ts: 0 } as never,
		mode: "act",
	})
	return framing as never
}

// ---------------------------------------------------------------------------
// RED witness — the LIVE incident chronology, encoded against REAL seams.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01", () => {
	describe("RED-01: BCB-held terminal observations must NOT produce authoritative completion display", () => {
		it("held terminal observation: no Completed badge, no C10 commit, phase stays streaming", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			// The turn launched a background job (owned by this session).
			h.ownedJobIds.push("J1")
			// The job has TERMINATED but its terminal observation is HELD
			// (not yet consumed) — the BCB hold condition.
			h.runningJobIds.delete("J1")
			h.unconsumedTerminalCount = 2

			await driveSubmitAndExit(h, { resultText: "Verdict while a job is still held." })

			// (a) NO C10 completion commit.
			expect(h.completionCommitCount()).toBe(0)
			// (b) The legacy phase is the TRUTHFUL non-running `resumable`
			// (the BCB hold), NOT the stale ACTIVE `streaming`.
			// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
			// (PTWCR01C01): a held completion used to leave the phase at
			// `streaming`, which the webview rendered as `Working` +
			// `Cancel` for a runtime that was not running. The
			// conservation invariants (a) and (c) are UNCHANGED.
			expect(h.tracker.currentPhase).toBe("resumable")
			// (c) NO authoritative completion display.
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
		})
	})

	describe("RED-02: the same incident with the OWNED job still RUNNING", () => {
		it("running owned background job: no Completed badge, no C10 commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.ownedJobIds.push("J1")
			h.runningJobIds.add("J1")

			await driveSubmitAndExit(h, { resultText: "Verdict while a job is running." })

			expect(h.completionCommitCount()).toBe(0)
			// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
			// (PTWCR01C01): the held completion is published as the
			// TRUTHFUL non-running `resumable` phase (the BCB hold), not
			// as the stale ACTIVE `streaming`. The conservation
			// invariants — no C10 commit, no authoritative completion
			// display — are UNCHANGED.
			expect(h.tracker.currentPhase).toBe("resumable")
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
		})
	})

	// =======================================================================
	// THE LIVE DEFECT.
	//
	// The BCB hold is NOT what leaks the row. The leak is the ELM
	// authority HOLD / FAILURE path:
	//
	//   1. `content_end` publishes the finalized `completion_result`
	//      row and stamps `isAuthoritativelyCompletedResult: true`
	//      UNCONDITIONALLY (message-translator.ts:1804).
	//   2. At turn end, the C10 barrier evaluates its hold predicates.
	//   3. `checkElmCompletionAuthority` returns `false` for an Elm
	//      HOLD or FAILURE -> the C10 commit is SUPPRESSED, so the
	//      task phase stays `streaming` and the TaskHeader keeps
	//      saying "Working".
	//   4. The already-published row KEEPS its authoritative marker ->
	//      the webview renders the green "Completed" badge.
	//
	// Invariant under test (ACT Phase 5):
	//   Current-turn authoritative completion display
	//     => C10 committed for the same owner/epoch
	// =======================================================================
	describe("RED-03 (THE LIVE DEFECT): Elm HOLD suppresses C10 but the published row still claims authority", () => {
		it("Elm HOLD: no C10 commit, phase streaming, yet the row is framed as authoritative completion", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "c9c10scr01-live-hold",
				holdReasons: ["active_run"],
			}))

			await driveSubmitAndExit(h, { resultText: "Verdict held by Elm." })

			// (a) NO C10 completion commit — the Elm HOLD is honoured.
			expect(h.completionCommitCount()).toBe(0)
			// (b) The legacy phase stays `streaming`.
			expect(h.tracker.currentPhase).toBe("streaming")
			// (c) THE DEFECT: the row is STILL framed as authoritative
			//     completion. This assertion is the RED.
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
		})

		it("Elm FAILURE: no C10 commit, phase streaming, yet the row is framed as authoritative completion", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "failure",
				reason: "c9c10scr01-live-failure",
				classification: "elm_authority_unavailable",
			}))

			await driveSubmitAndExit(h, { resultText: "Verdict under Elm failure." })

			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).toBe("streaming")
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
		})
	})

	describe("GREEN control: an uncontended completion DOES display and DOES commit", () => {
		it("no held work: Completed badge present and C10 committed exactly once", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveSubmitAndExit(h, { resultText: "Clean verdict." })

			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(authoritativeCompletionFraming(h)?.kind).toBe("completed")
		})
	})
})
