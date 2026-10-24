/**
 * ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 / C9C10SCR01-CORRECTION01
 * (C9C10CDAP01)
 *
 * BOUNDED CORRECTION — commit-driven completion-authority publication.
 *
 * THE DEFECT THIS CORRECTION REPAIRS.
 *
 * C9C10SCR01 repaired the divergence by RETRACTING the completion
 * authority marker AFTER the Elm authority rejected the completion.
 * That repair is retrospective: the marker was still PUBLISHED at the
 * completion tool's `content_end`, i.e. BEFORE the turn-end C10
 * completion-commit barrier decided whether the task may actually
 * commit its completion.
 *
 * The invariant the ACT states is TEMPORAL:
 *
 *     an authoritative completion must never be PUBLISHED before its
 *     C10 commit.
 *
 * A later corrective update cannot establish that invariant. The
 * webview receives the publication and the retraction as SEPARATE
 * messages over an event-based channel; it can render the first one
 * before the second arrives. So the temporal invariant is violated
 * even though the FINAL projection is correct.
 *
 * There is a second, related gap. The deferred C10 path
 * (`reevaluateDeferredCompletionBarrier`) can later AUTHORIZE and
 * COMMIT the C10 after the Elm decision flipped HOLD -> AUTHORIZE. The
 * retraction removed the marker and nothing ever restored it, so a
 * legitimate, committed completion ended up with NO badge.
 *
 * THE REPAIR (commit-driven publication).
 *
 *   1. Live `content_end` publishes the finalized `completion_result`
 *      row WITHOUT the authority marker. The row is visible and keeps
 *      its summary text, but it does not claim C10 authority.
 *   2. The C10 COMMIT promotes the row: the SAME `ts` is re-published
 *      with the marker ADDED, using the established "update a message"
 *      channel (`emitHookMessage`). This happens on BOTH C10 paths
 *      (the immediate turn-complete path and the deferred
 *      `reevaluateDeferredCompletionBarrier` path).
 *   3. Historical / RESTORED completed rows keep their marker (the
 *      persisted-transcript path stamps it as before) — reopening a
 *      finished task still shows the "Completed" badge.
 *
 * The two RED cases below are the missing witnesses:
 *
 *   RED-04 — the projection IMMEDIATELY AFTER `content_end` (before
 *            `done`) carries NO authoritative badge. The existing
 *            C9C10SCR01 suite only inspected the FINAL projection
 *            after `done`, so it could not see the premature
 *            publication.
 *   RED-05 — the DEFERRED C10 path promotes the EXISTING row (same
 *            `ts`, no second `submit_and_exit`) once the Elm authority
 *            flips to AUTHORIZE.
 *
 * Both cases drive the REAL production seams and project through the
 * REAL webview reducer (`applyMessage` from
 * `webview-ui/src/components/chat/chat-view/messageReducer.ts`), so the
 * assertions are on the actual webview replica — including its
 * sequence/epoch fencing — not on a simulated message store.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { describe, expect, it, vi } from "vitest"
// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01: the REAL
// webview replica reducer. The temporal invariant is about what the WEBVIEW
// can observe, so the assertion must be on the webview's own convergent
// replica (with its seq/epoch fencing), not on the host's message store.
import {
	applyMessage,
	createReplicaState,
	type ReplicaState,
} from "../../../webview-ui/src/components/chat/chat-view/messageReducer"
// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01: the REAL webview
// authority projection (the "Completed" badge predicate).
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
	seq?: number
	epoch?: number
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	/** Override the Elm completion-authority decision. */
	setElmDecision: (fn: () => ElmCompletionAuthorityDecision) => void
	/**
	 * THE WEBVIEW REPLICA. Fed through the REAL `applyMessage` reducer with
	 * the REAL seq/epoch stamps, so the assertion is on what the webview can
	 * observe at any point in time.
	 */
	webview: ReplicaState
	/** Push a message into the webview replica (the production partial-stream push). */
	pushToWebview: (message: ClineMessage) => void
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
	const activeSessionId = opts.activeSessionId ?? "session-c9c10cdap01"
	const activeTaskId = opts.activeTaskId ?? "task-c9c10cdap01"

	let completionCommitCount = 0
	const ownedJobIds: string[] = []
	const activeNotifyJobIds = new Set<string>()
	const runningJobIds = new Set<string>()
	const state = { unconsumedTerminalCount: 0, pendingPromptCount: 0 }
	let elmDecision: () => ElmCompletionAuthorityDecision = () => ({
		kind: "authorize",
		reason: "c9c10cdap01-test-authorize",
	})
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	// THE WEBVIEW REPLICA — the production convergent replica.
	let webview = createReplicaState()
	const pushToWebview = (message: ClineMessage) => {
		webview = applyMessage(webview, message as never)
	}
	// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01
	// (C9C10CDAP01): the PRODUCTION `seq` / `epoch` stamping
	// (`SdkMessageCoordinator.stamp`). Every message that flows to the
	// webview gets a FRESH, higher `seq` and the current `epoch`, so a
	// message that is UPDATED (same `ts`, new content) always wins the
	// webview reducer's freshness comparison. The harness models this
	// exactly so the reducer's sequence/epoch fencing is genuinely
	// exercised rather than assumed.
	const stamp = (message: ClineMessage) => {
		message.seq = minter.nextSeq()
		message.epoch = minter.epoch
	}

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
			// The PRODUCTION "publish new rows" channel: store-append
			// (upsert by `ts`) + the partial stream the webview consumes.
			appendAndEmit: ((msgs: unknown[]) => {
				for (const m of msgs as ClineMessage[]) {
					stamp(m)
					pushToWebview(m)
				}
			}) as never,
			// The PRODUCTION "update a message" channel
			// (SdkMessageCoordinator.emitHookMessage): store-append
			// (upsert by `ts`) + a direct webview push. It does NOT emit
			// a session event, so the published-row cardinality is
			// unchanged.
			//
			// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01
			// (C9C10CDAP01): the production channel RE-STAMPS the message
			// with a FRESH, higher `seq` and the current `epoch` (see
			// `SdkMessageCoordinator.stamp`). The harness models that
			// exactly, so the webview reducer's sequence/epoch fencing is
			// genuinely exercised.
			emitHookMessage: (m: ClineMessage) => {
				stamp(m)
				pushToWebview(m)
			},
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
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
		completionCommitCount: () => completionCommitCount,
		setElmDecision(fn: () => ElmCompletionAuthorityDecision) {
			elmDecision = fn
		},
		get webview() {
			return webview
		},
		pushToWebview,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/** The completion tool's `content_start` — emits the PARTIAL row. */
async function driveContentStart(h: Harness, opts: { resultText?: string; turnId?: string } = {}): Promise<void> {
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
}

/**
 * The completion tool's `content_end` — the CANONICAL completion
 * PUBLICATION seam. It emits the finalized `say:"completion_result"` row.
 */
async function driveContentEnd(h: Harness, opts: { resultText?: string; turnId?: string } = {}): Promise<void> {
	const resultText = opts.resultText ?? "Verdict."
	const sessionId = h.activeSessionId
	const turnId = opts.turnId ?? "turn-1"
	await h.coordinator.handleSessionEvent(
		agentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolName: "submit_and_exit",
			toolCallId: `tc-${turnId}-submit`,
			input: { result: resultText },
		}),
	)
}

/** The turn-end event — the C10 completion-commit barrier runs here. */
async function driveDone(h: Harness, opts: { resultText?: string; turnId?: string } = {}): Promise<void> {
	const resultText = opts.resultText ?? "Verdict."
	const sessionId = h.activeSessionId
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
 * THE FINALIZED completion row as the WEBVIEW sees it.
 *
 * The webview replica holds the row the user actually renders. The first
 * row published for a completion tool is the PARTIAL one (`content_start`);
 * the FINALIZED row is published at `content_end`.
 */
function webviewFinalizedCompletionRow(h: Harness): ClineMessage | undefined {
	return h.webview.messages.find((m) => m.say === "completion_result" && m.partial !== true) as ClineMessage | undefined
}

/**
 * THE AUTHORITATIVE ROW FRAMING — the exact predicate the webview uses to
 * decide whether the green "Completed" badge is rendered, evaluated against
 * the WEBVIEW REPLICA's row.
 */
function webviewAuthoritativeFraming(h: Harness): { kind: string; label: string } | undefined {
	const row = webviewFinalizedCompletionRow(h)
	if (!row) {
		return undefined
	}
	return resolveTerminalReportFraming({
		message: row as never,
		turnState: { phase: h.tracker.currentPhase, ts: 0 } as never,
		mode: "act",
	}) as never
}

// ---------------------------------------------------------------------------
// THE MISSING WITNESSES.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01 / C9C10CDAP01", () => {
	describe("RED-04: the completion authority must NOT be published before the C10 commit", () => {
		it("immediately after content_end (before done) the row carries NO authoritative badge", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveContentStart(h, { resultText: "Verdict before the commit." })
			await driveContentEnd(h, { resultText: "Verdict before the commit." })

			// (a) The finalized row IS published — the summary is visible.
			const row = webviewFinalizedCompletionRow(h)
			expect(row).toBeDefined()
			expect(row?.text).toBe("Verdict before the commit.")

			// (b) NO C10 commit has happened yet — the turn is still live.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).toBe("streaming")

			// (c) THE RED: the row must NOT yet claim C10 authority. The
			//     temporal invariant is "an authoritative completion must
			//     never be PUBLISHED before its C10 commit".
			expect(webviewAuthoritativeFraming(h)).toBeUndefined()
		})

		it("after the C10 commit the SAME row (same ts) is promoted and DOES carry the badge", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveContentStart(h, { resultText: "Verdict." })
			await driveContentEnd(h, { resultText: "Verdict." })
			const publishedTs = webviewFinalizedCompletionRow(h)?.ts
			expect(publishedTs).toBeDefined()

			await driveDone(h, { resultText: "Verdict." })

			// (a) The C10 commit happened.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			// (b) The SAME row was promoted (no new visible row).
			const row = webviewFinalizedCompletionRow(h)
			expect(row?.ts).toBe(publishedTs)
			expect(h.webview.messages.filter((m) => m.say === "completion_result")).toHaveLength(1)

			// (c) The promoted row DOES carry the authoritative badge.
			expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
		})
	})

	describe("RED-05: the deferred C10 path promotes the EXISTING row (no second submit_and_exit)", () => {
		it("Elm HOLD at turn end -> Elm AUTHORIZE at agent_turn_done -> the existing row is promoted", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			// The Elm authority HOLDS the completion at turn end (e.g.
			// an active_run is still outstanding).
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "c9c10cdap01-deferred-hold",
				holdReasons: ["active_run"],
			}))

			await driveContentStart(h, { resultText: "Deferred verdict." })
			await driveContentEnd(h, { resultText: "Deferred verdict." })
			const publishedTs = webviewFinalizedCompletionRow(h)?.ts
			expect(publishedTs).toBeDefined()

			await driveDone(h, { resultText: "Deferred verdict." })

			// (a) The C10 commit was DEFERRED — no commit yet.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).toBe("streaming")

			// (b) The published row carries NO authority (it was never
			//     published with authority in the first place).
			expect(webviewAuthoritativeFraming(h)).toBeUndefined()

			// (c) The obstacle clears and the Elm authority now AUTHORIZEs.
			h.setElmDecision(() => ({
				kind: "authorize",
				reason: "c9c10cdap01-deferred-authorize",
			}))

			// The deferred-barrier reevaluation is driven by the
			// `agent_turn_done` notification — the production trigger.
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

			// (d) The C10 commit happened on the DEFERRED path.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			// (e) THE RED: the EXISTING row is promoted — the SAME `ts`,
			//     with NO second `submit_and_exit` invocation — and it
			//     DOES carry the authoritative badge.
			const row = webviewFinalizedCompletionRow(h)
			expect(row?.ts).toBe(publishedTs)
			expect(h.webview.messages.filter((m) => m.say === "completion_result")).toHaveLength(1)
			expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
		})
	})

	describe("RED-06: the promotion is fenced by the webview's seq/epoch reducer", () => {
		it("the promoted row carries a HIGHER seq than the publication, so the reducer accepts it", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveContentStart(h, { resultText: "Fenced verdict." })
			await driveContentEnd(h, { resultText: "Fenced verdict." })

			const publishedRow = webviewFinalizedCompletionRow(h)
			const publishedSeq = publishedRow?.seq
			expect(publishedSeq).toBeDefined()
			expect(publishedRow?.isAuthoritativelyCompletedResult).toBeUndefined()

			await driveDone(h, { resultText: "Fenced verdict." })

			const promotedRow = webviewFinalizedCompletionRow(h)
			// (a) The promotion carries a STRICTLY HIGHER seq than the
			//     publication — this is what lets the webview reducer
			//     accept the update instead of ignoring it as a stale
			//     straggler.
			expect(promotedRow?.seq).toBeGreaterThan(publishedSeq as number)
			// (b) The SAME epoch — the promotion is not a cross-epoch
			//     straggler.
			expect(promotedRow?.epoch).toBe(publishedRow?.epoch)
			// (c) The marker is now present and the badge renders.
			expect(promotedRow?.isAuthoritativelyCompletedResult).toBe(true)
			expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
		})

		it("a STALE (older-epoch) promotion is dropped by the webview reducer", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveContentStart(h, { resultText: "Epoch fenced." })
			await driveContentEnd(h, { resultText: "Epoch fenced." })
			const publishedTs = webviewFinalizedCompletionRow(h)?.ts
			const publishedEpoch = webviewFinalizedCompletionRow(h)?.epoch
			expect(publishedTs).toBeDefined()
			expect(publishedEpoch).toBeDefined()

			// The webview advances to a NEWER epoch (a new task / render).
			const newerEpoch = (publishedEpoch as number) + 1
			let fenced = applyMessage(h.webview, {
				ts: 999_999,
				type: "say",
				say: "text",
				text: "new epoch",
				seq: 999_999,
				epoch: newerEpoch,
			} as never)
			expect(fenced.epoch).toBe(newerEpoch)

			// A promotion carrying the OLD epoch is a STALE straggler: the
			// reducer DROPS it (older epoch -> drop). The row must not be
			// resurrected into the newer epoch's transcript.
			const before = fenced.messages.length
			fenced = applyMessage(fenced, {
				ts: publishedTs as number,
				type: "say",
				say: "completion_result",
				text: "Epoch fenced.",
				partial: false,
				isAuthoritativelyCompletedResult: true,
				seq: 999_999 + 1,
				epoch: publishedEpoch as number,
			} as never)

			// (a) The stale promotion was DROPPED — the transcript did not
			//     grow and no stale-epoch completion row was introduced.
			expect(fenced.messages.length).toBe(before)
			expect(fenced.messages.find((m) => m.ts === publishedTs)?.isAuthoritativelyCompletedResult).toBeUndefined()
			// (b) The fence did not regress.
			expect(fenced.epoch).toBe(newerEpoch)
		})
	})

	describe("GREEN controls", () => {
		it("an uncontended completion commits once and shows the badge", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			await driveContentStart(h, { resultText: "Clean verdict." })
			await driveContentEnd(h, { resultText: "Clean verdict." })
			expect(webviewAuthoritativeFraming(h)).toBeUndefined()

			await driveDone(h, { resultText: "Clean verdict." })

			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
		})

		it("a permanently-held completion never claims authority", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			h.setElmDecision(() => ({
				kind: "hold",
				reason: "c9c10cdap01-permanent-hold",
				holdReasons: ["active_run"],
			}))

			await driveContentStart(h, { resultText: "Held verdict." })
			await driveContentEnd(h, { resultText: "Held verdict." })
			await driveDone(h, { resultText: "Held verdict." })
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).toBe("streaming")
			expect(webviewAuthoritativeFraming(h)).toBeUndefined()
		})
	})
})
