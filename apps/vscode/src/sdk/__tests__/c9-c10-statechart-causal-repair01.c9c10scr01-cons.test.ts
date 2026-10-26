/**
 * ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01-CONS
 *
 * Phase 6 CONSERVATION suite.
 *
 * Every case the ACT requires, asserted against the REAL production
 * seams (the production message translator, the production session
 * event coordinator, the production BCB owner, the production phase
 * writer) and the REAL webview authority projection
 * (`resolveTerminalReportFraming`).
 *
 * The suite asserts the ACT's invariants, not just message shapes:
 *
 *   Current-turn authoritative completion display
 *     => C10 committed for the same owner/epoch
 *   C9 attempt != C10 completion
 *   Terminal response finalized != task completion committed
 *   C10 committed => TS conservation passed and Elm authorized
 *   BCB held => no authoritative completion display
 *   Held-attempt summary => content may remain visible without a
 *     false Completed badge
 *
 * The RED / GREEN witnesses live in
 * `c9-c10-statechart-causal-repair01.c9c10scr01.test.ts`.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { describe, expect, it, vi } from "vitest"
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
// Conservation cases
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01-CONS", () => {
	describe("CONS-01: a held terminal result produces NO authoritative completion display", () => {
		it("BCB hold on unconsumed terminal results: no badge, no C10, phase resumable", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.ownedJobIds.push("J1")
			h.unconsumedTerminalCount = 1

			await driveSubmitAndExit(h, { resultText: "Held." })

			expect(h.completionCommitCount()).toBe(0)
			// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
			// (PTWCR01C01): the held completion is published as the
			// TRUTHFUL non-running `resumable` phase (the BCB hold), not
			// as the stale ACTIVE `streaming` (which the webview rendered
			// as `Working` + `Cancel`). The CONSERVATION invariants — no
			// C10 commit, no authoritative completion display, no
			// published completion row — are UNCHANGED.
			expect(h.tracker.currentPhase).toBe("resumable")
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
			// The BCB path removes the row from the published set
			// entirely — the user never sees it.
			expect(publishedCompletionRows(h).filter((r) => r.partial !== true).length).toBe(0)
		})
	})

	describe("CONS-02: all terminal observations consumed -> the completion commits", () => {
		it("held set drains to zero: exactly one C10 commit and the badge is shown", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.ownedJobIds.push("J1")
			h.unconsumedTerminalCount = 2

			// First attempt: HELD.
			await driveSubmitAndExit(h, { resultText: "Held.", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(0)
			expect(authoritativeCompletionFraming(h)).toBeUndefined()

			// The observations are consumed (the agent called command_status).
			h.unconsumedTerminalCount = 0

			// Second attempt: the obligation is discharged -> commits.
			await driveSubmitAndExit(h, { resultText: "Observed and done.", turnId: "t2" })
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(authoritativeCompletionFraming(h)?.kind).toBe("completed")
		})
	})

	describe("CONS-03: one missing / evicted terminal observation keeps the task held", () => {
		it("the held count never reaches zero: no C10 commit, no badge", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.ownedJobIds.push("J1", "J2")
			// One of the two observations is evicted / unresolvable.
			h.unconsumedTerminalCount = 1

			await driveSubmitAndExit(h, { resultText: "Still held." })

			expect(h.completionCommitCount()).toBe(0)
			// ACT-CLINEMM-P0-POST-TERMINAL-WORKING-CANCEL-REPRO01-CORRECTION01
			// (PTWCR01C01): the still-held completion is published as the
			// TRUTHFUL non-running `resumable` phase (the BCB hold), not
			// as the stale ACTIVE `streaming`. The CONSERVATION
			// invariants — no C10 commit, no authoritative completion
			// display — are UNCHANGED.
			expect(h.tracker.currentPhase).toBe("resumable")
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
		})
	})

	describe("CONS-04: Elm HOLD then a later AUTHORIZE", () => {
		it("HOLD withholds the badge; a later AUTHORIZE commits exactly once and shows it", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "cons-hold",
				holdReasons: ["active_run"],
			}))

			await driveSubmitAndExit(h, { resultText: "Held by Elm.", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).toBe("streaming")
			// The held attempt's summary text is STILL VISIBLE, but
			// without a false "Completed" badge.
			expect(finalizedCompletionRow(h)?.text).toBe("Held by Elm.")
			expect(authoritativeCompletionFraming(h)).toBeUndefined()

			// Elm later AUTHORIZEs.
			h.setElmDecision(() => ({ kind: "authorize", reason: "cons-authorize" }))
			await driveSubmitAndExit(h, { resultText: "Authorized.", turnId: "t2" })

			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			// The AUTHORIZED attempt's row carries the badge; the earlier
			// HELD attempt's row does not (its marker was retracted).
			const rows = publishedCompletionRows(h).filter((r) => r.partial !== true)
			expect(rows.length).toBe(2)
			expect(rows[0]?.isAuthoritativelyCompletedResult).toBeUndefined()
			expect(rows[1]?.isAuthoritativelyCompletedResult).toBe(true)
			expect(
				resolveTerminalReportFraming({
					message: rows[1] as never,
					turnState: { phase: h.tracker.currentPhase, ts: 0 } as never,
					mode: "act",
				})?.kind,
			).toBe("completed")
		})
	})

	describe("CONS-05: a duplicate C9 does not produce a second C10", () => {
		it("two completion attempts (the first HELD): exactly one C10 commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.ownedJobIds.push("J1")
			h.unconsumedTerminalCount = 1

			// Attempt 1: HELD by the BCB.
			await driveSubmitAndExit(h, { resultText: "First.", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(0)

			// Attempt 2: the obligation is discharged -> commits ONCE.
			h.unconsumedTerminalCount = 0
			await driveSubmitAndExit(h, { resultText: "Second.", turnId: "t2" })

			expect(h.completionCommitCount()).toBe(1)
			// Exactly one AUTHORITATIVE row survives.
			const authoritative = publishedCompletionRows(h).filter(
				(r) => r.partial !== true && r.isAuthoritativelyCompletedResult === true,
			)
			expect(authoritative.length).toBe(1)
			expect(authoritative[0]?.text).toBe("Second.")
		})
	})

	describe("CONS-06: exactly-once C10 across a held attempt and a committed attempt", () => {
		it("held attempt then committed attempt: exactly one C10 commit", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.ownedJobIds.push("J1")
			h.unconsumedTerminalCount = 1

			await driveSubmitAndExit(h, { resultText: "Held.", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(0)

			h.unconsumedTerminalCount = 0
			await driveSubmitAndExit(h, { resultText: "Committed.", turnId: "t2" })

			expect(h.completionCommitCount()).toBe(1)
		})
	})

	describe("CONS-07: a late previous-epoch completion does not claim the new turn", () => {
		it("a completion row published in an earlier epoch keeps its own authority; the new turn is unaffected", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			// Epoch N: a genuine completion, committed.
			await driveSubmitAndExit(h, { resultText: "Epoch N verdict.", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(1)
			expect(authoritativeCompletionFraming(h)?.kind).toBe("completed")

			// Epoch N+1: the task starts again.
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "cons-late-epoch",
				holdReasons: ["active_run"],
			}))
			await driveSubmitAndExit(h, { resultText: "Epoch N+1 held.", turnId: "t2" })

			// The NEW turn did not commit.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("streaming")
			// The HISTORICAL row keeps its badge (the first finalized row
			// is the epoch-N row, which still carries its marker).
			const rows = publishedCompletionRows(h).filter((r) => r.partial !== true)
			expect(rows.length).toBe(2)
			expect(rows[0]?.isAuthoritativelyCompletedResult).toBe(true)
			// The NEW row does NOT carry the badge.
			expect(rows[1]?.isAuthoritativelyCompletedResult).toBeUndefined()
		})
	})

	describe("CONS-08: a background job from a foreign session does not affect this task", () => {
		it("a foreign session's held observation neither holds nor releases this task", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			// The held count is reported for a DIFFERENT session id.
			const other = makeHarness({ activeSessionId: "session-other", activeTaskId: "task-other" })
			other.unconsumedTerminalCount = 3

			await driveSubmitAndExit(h, { resultText: "Mine." })

			// This task is uncontended -> it commits normally.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		})
	})

	describe("CONS-09: cancellation and resume preserve the resumable phase", () => {
		it("a cancelled turn is not clobbered by the turn-complete straggler", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
			;(h.coordinator as unknown as { options: { getTurnPhase: () => string } }).options.getTurnPhase = () => "resumable"

			await driveSubmitAndExit(h, { resultText: "Cancelled attempt." })

			// The cancel-set phase survives.
			expect(h.tracker.currentPhase).toBe("resumable")
			expect(h.completionCommitCount()).toBe(0)
		})
	})

	describe("CONS-10: a historical completed row during a subsequent active turn", () => {
		it("the historical row keeps its badge while the new turn streams", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveSubmitAndExit(h, { resultText: "Historical verdict.", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(1)

			// A new turn begins; the phase returns to streaming.
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			const rows = publishedCompletionRows(h).filter((r) => r.partial !== true)
			expect(rows.length).toBe(1)
			expect(rows[0]?.isAuthoritativelyCompletedResult).toBe(true)
			expect(authoritativeCompletionFraming(h)?.kind).toBe("completed")
		})
	})

	describe("CONS-11: a normal successful completion", () => {
		it("no held work, Elm authorizes: one row, one C10 commit, badge shown", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveSubmitAndExit(h, { resultText: "All done." })

			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(publishedCompletionRows(h).filter((r) => r.partial !== true).length).toBe(1)
			expect(authoritativeCompletionFraming(h)?.kind).toBe("completed")
		})
	})

	describe("CONS-12: no premature Completed badge and no incorrect TaskHeader phase", () => {
		it("Elm HOLD: the badge is absent and the phase stays streaming (TaskHeader 'Working')", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "cons-premature",
				holdReasons: ["active_run"],
			}))

			await driveSubmitAndExit(h, { resultText: "Premature?" })

			// No badge.
			expect(authoritativeCompletionFraming(h)).toBeUndefined()
			// No C10 commit.
			expect(h.completionCommitCount()).toBe(0)
			// The phase stays `streaming`, which the TaskHeader projects
			// to "Working" — NOT a terminal label.
			expect(h.tracker.currentPhase).toBe("streaming")
			expect(h.committedPhases()).not.toContain("completed")
		})

		it("Elm FAILURE: the badge is absent and the phase stays streaming", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "failure",
				reason: "cons-failure",
				classification: "elm_authority_unavailable",
			}))

			await driveSubmitAndExit(h, { resultText: "Failed?" })

			expect(authoritativeCompletionFraming(h)).toBeUndefined()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).toBe("streaming")
		})
	})

	describe("CONS-13: a held-attempt summary keeps its CONTENT without a false badge", () => {
		it("the summary text survives the retraction", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "cons-summary",
				holdReasons: ["active_run"],
			}))

			await driveSubmitAndExit(h, { resultText: "The summary the agent produced." })

			const row = finalizedCompletionRow(h)
			expect(row).toBeDefined()
			expect(row?.text).toBe("The summary the agent produced.")
			expect(row?.isAuthoritativelyCompletedResult).toBeUndefined()
		})
	})
})
