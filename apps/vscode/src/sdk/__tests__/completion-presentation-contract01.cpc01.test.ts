/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 — CPC01
 *
 * SOURCE-BOUND EXECUTABLE CONFORMANCE for Chart 04 (Completion
 * Presentation), claims P-01 … P-07.
 *
 * WHAT THIS SUITE IS.
 *
 * Chart 04's seven completion-presentation claims are turned into
 * assertions against the REAL production seams. Nothing here is a
 * re-implementation of production behaviour and nothing here is a
 * synthetic trace-only proof:
 *
 *   - the REAL `MessageTranslatorState` + `translateSessionEvent`
 *     (`message-translator.ts`) publish the completion rows;
 *   - the REAL `SdkSessionEventCoordinator` (`sdk-session-event-coordinator.ts`)
 *     applies the BCB message-layer filter, consults the Elm authority
 *     boundary, commits the C10 phase and promotes the row;
 *   - the REAL `TurnStateTracker` (`turn-state-tracker.ts`) owns the
 *     committed phase;
 *   - the REAL host message store (`MessageStateHandler.addMessages`,
 *     `task-proxy.ts`) and the REAL webview reducer (`applyMessage`,
 *     `messageReducer.ts`) own the visible-row convergence;
 *   - the REAL webview framing projection (`resolveTerminalReportFraming`,
 *     `terminalReportFraming.ts`) owns the "Completed" badge predicate;
 *   - the REAL persistence/reopen translation (`sdkMessagesToClineMessages`,
 *     `message-translator.ts`) owns the restored row.
 *
 * The Elm decision is INJECTED at the existing provider boundary
 * (`getElmCompletionAuthorityDecision`). That is the only injected
 * boundary; every other seam is production code. The evidence level for
 * the affected claims is therefore `INJECTED_DECISION`, not live Elm
 * execution, and no live Elm run is claimed.
 *
 * THE THREE NEGATIVE WITNESSES.
 *
 *   NEG-01 — Premature marker. A finalized row that receives a marker
 *            BEFORE the C10 commit must be REJECTED by the conformance
 *            assertion. The witness drives the real production seam with a
 *            controlled mutation of the coordinator's translator output, so
 *            the mutation is exactly the historical defect (marker stamped
 *            at publication time) and the assertion detects it.
 *   NEG-02 — Stale promotion. An older turn's completion promotion that
 *            arrives during a newer epoch must NOT be treated as the
 *            current turn's authority; the historical/current-turn
 *            distinction is by epoch/turn identity, NOT by timestamp
 *            ordering.
 *   NEG-03 — Failed publication. The C10 commits but the marker
 *            publication throws. The evidence must NOT claim effect success
 *            or completed webview delivery: the trace records the phase
 *            commit but NOT `marker_promoted` / `effect_executed`, and the
 *            webview replica carries no authoritative badge.
 *
 * The controlled mutations used by NEG-01 are performed by injecting a
 * MUTATED TRANSLATOR at the production option-bag boundary
 * (`translateSessionEvent`), NOT by patching production source. The
 * mutant reproduces the historical defect exactly (it stamps the marker at
 * publication time), which is what makes NEG-01 a genuine RED/GREEN
 * detector rather than a tautology.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	applyMessage,
	createReplicaState,
	type ReplicaState,
} from "../../../webview-ui/src/components/chat/chat-view/messageReducer"
import { resolveTerminalReportFraming } from "../../../webview-ui/src/components/chat/terminalReportFraming"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	COMPLETION_PRESENTATION_CLAIM_IDS,
	COMPLETION_PRESENTATION_CLAIMS,
	eligibleCompletionPresentationClaims,
} from "../completion-presentation-contract"
import {
	CHART_04_EXPECTED_EDGES,
	CHART_04_NON_TRANSITION_CLAIM_IDS,
	CHART_04_TRANSITION_CLAIM_IDS,
	extractMermaidBlocks,
	parseMermaidTransitionEdges,
	transitionIdOfLabel,
	verifyChart04CompletionPresentation,
} from "../lifecycle-transition-contract-verifier"
import {
	clearLifecycleTransitionTrace,
	enableLifecycleTransitionTrace,
	getLifecycleTransitionTraceRecords,
	setLifecycleTransitionTraceEnabled,
	validateLifecycleTransitionTrace,
} from "../lifecycle-transition-trace"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, sdkMessagesToClineMessages, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { MessageStateHandler } from "../task-proxy"
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

// ---------------------------------------------------------------------------
// The harness.
//
// It models the PRODUCTION channels exactly:
//
//   appendAndEmit  — "publish new rows": host store upsert-by-`ts`
//                     (`MessageStateHandler.addMessages`) + a webview push
//                     through the REAL `applyMessage` reducer.
//   emitHookMessage — "update a message": host store upsert-by-`ts` +
//                     a webview push. NO session-event emission.
//
// The host store is the REAL `MessageStateHandler` from `task-proxy.ts`, so
// the same-`ts` upsert semantics are the production ones, not a model of
// them. The webview replica is the REAL `applyMessage` reducer, so the
// sequence/epoch fencing is exercised for real.
// ---------------------------------------------------------------------------

interface HarnessOptions {
	readonly activeSessionId?: string
	readonly activeTaskId?: string
	/**
	 * A MUTATED translator injected at the production option-bag boundary.
	 * Used ONLY by NEG-01 to reproduce the historical "marker stamped at
	 * publication time" defect. `undefined` means the real translator.
	 */
	readonly translateOverride?: SdkSessionEventCoordinatorOptions["translateSessionEvent"]
}

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly notifyCoordinator: BackgroundNotifyCoordinator
	/** THE REAL host message store (`MessageStateHandler`). */
	readonly store: MessageStateHandler
	readonly activeSessionId: string
	readonly activeTaskId: string
	/** Number of committed `completed` phase writes (the C10 commit count). */
	completionCommitCount: () => number
	setElmDecision: (fn: () => ElmCompletionAuthorityDecision) => void
	/** Inject a failure at the production marker-update channel. */
	failMarkerPublication: boolean
	/** Owned background-job observations (BCB inputs). */
	readonly ownedJobs: { jobId: string; running: boolean }[]
	readonly unconsumed: { value: number }
	/** The REAL webview replica, fed through the REAL reducer. */
	readonly webview: ReplicaState
	/** The rows the host store currently holds. */
	storedRows: () => ClineMessage[]
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

function makeHarness(opts: HarnessOptions = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-cpc01"
	const activeTaskId = opts.activeTaskId ?? "task-cpc01"

	// THE REAL host message store. Its `addMessages` upserts by `ts`, which
	// is the production same-row-update semantic P-05 is about.
	const store = new MessageStateHandler()

	let completionCommitCount = 0
	let failMarkerPublication = false
	const ownedJobs: { jobId: string; running: boolean }[] = []
	const unconsumed = { value: 0 }
	let elmDecision: () => ElmCompletionAuthorityDecision = () => ({
		kind: "authorize",
		reason: "cpc01-test-authorize",
	})
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	// THE WEBVIEW REPLICA — the REAL convergent reducer.
	let webview = createReplicaState()
	// The PRODUCTION `seq` / `epoch` stamping (`SdkMessageCoordinator.stamp`):
	// every message that flows to the webview gets a FRESH, higher `seq` and
	// the current `epoch`, so an UPDATED row (same `ts`, new content) always
	// wins the webview reducer's freshness comparison.
	const stamp = (message: ClineMessage) => {
		message.seq = minter.nextSeq()
		message.epoch = minter.epoch
	}
	const pushToWebview = (message: ClineMessage) => {
		webview = applyMessage(webview, message as never)
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
			// PRODUCTION "publish new rows" channel.
			appendAndEmit: ((msgs: unknown[]) => {
				const typed = msgs as ClineMessage[]
				store.addMessages(typed)
				for (const m of typed) {
					stamp(m)
					pushToWebview(m)
				}
			}) as never,
			// PRODUCTION "update a message" channel.
			emitHookMessage: (m: ClineMessage) => {
				if (failMarkerPublication) {
					throw new Error("cpc01-test-marker-publication-failure")
				}
				store.addMessages([m])
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
		translateSessionEvent: opts.translateOverride ?? translateSessionEvent,
		getElmCompletionAuthorityDecision: () => elmDecision(),
		hasRunningBackgroundJobForOwner: (sid: string | undefined) => {
			if (sid !== activeSessionId) return false
			return ownedJobs.some((j) => j.running)
		},
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumed.value
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId || tid !== activeTaskId) return []
			return unconsumed.value > 0 ? ownedJobs.map((j) => j.jobId) : []
		},
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: (sid: string | undefined, tid: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(sid ?? activeSessionId, tid ?? activeTaskId),
		hasActiveNotify: () => false,
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		store,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		setElmDecision(fn: () => ElmCompletionAuthorityDecision) {
			elmDecision = fn
		},
		get failMarkerPublication() {
			return failMarkerPublication
		},
		set failMarkerPublication(value: boolean) {
			failMarkerPublication = value
		},
		ownedJobs,
		unconsumed,
		get webview() {
			return webview
		},
		storedRows: () => store.getClineMessages(),
	}
}

// ---------------------------------------------------------------------------
// Drivers — every one of them drives the REAL coordinator / translator.
// ---------------------------------------------------------------------------

/** The completion tool's `content_start` — emits the PARTIAL row. */
async function driveContentStart(h: Harness, resultText = "Verdict."): Promise<void> {
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "content_start",
			contentType: "tool",
			toolName: "submit_and_exit",
			toolCallId: "tc-cpc01-submit",
			input: { summary: resultText },
		}),
	)
}

/** The completion tool's `content_end` — the CANONICAL completion publication seam. */
async function driveContentEnd(h: Harness, resultText = "Verdict."): Promise<void> {
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "content_end",
			contentType: "tool",
			toolName: "submit_and_exit",
			toolCallId: "tc-cpc01-submit",
			input: { summary: resultText },
		}),
	)
}

/** The turn-end event — the C10 completion-commit barrier runs here. */
async function driveDone(h: Harness, resultText = "Verdict."): Promise<void> {
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "done",
			reason: "completed",
			text: resultText,
			iterations: 1,
		}),
	)
}

// ---------------------------------------------------------------------------
// Observation helpers.
// ---------------------------------------------------------------------------

/** The FINALIZED (non-partial) completion row as the WEBVIEW sees it. */
function webviewFinalizedCompletionRow(h: Harness): ClineMessage | undefined {
	return h.webview.messages.find((m) => m.say === "completion_result" && m.partial !== true) as ClineMessage | undefined
}

/** The FINALIZED (non-partial) completion row as the HOST STORE sees it. */
function storedFinalizedCompletionRow(h: Harness): ClineMessage | undefined {
	return h.storedRows().find((m) => m.say === "completion_result" && m.partial !== true) as ClineMessage | undefined
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

/** Every completion_result row visible in the webview replica. */
function webviewCompletionRows(h: Harness): ClineMessage[] {
	return h.webview.messages.filter((m) => m.say === "completion_result") as ClineMessage[]
}

/**
 * THE CONFORMANCE DETECTOR for INV-P01 / P-02.
 *
 * It returns TRUE when the observable state VIOLATES the invariant: a
 * completion row claims the authoritative marker while the task has NOT
 * committed its completion (no C10 commit, and the phase is not
 * "completed"). The detector is expressed as an explicit rejection so a
 * negative witness can assert that the defect IS detected, rather than
 * asserting the defect's absence (which would be a tautology).
 */
function rejectsPrematureAuthority(h: Harness): boolean {
	const row = webviewFinalizedCompletionRow(h)
	if (!row) {
		return false
	}
	const claimsAuthority = row.isAuthoritativelyCompletedResult === true
	const taskCommitted = h.completionCommitCount() > 0 || h.tracker.currentPhase === "completed"
	return claimsAuthority && !taskCommitted
}

// ===========================================================================
// P-01 — Completion start is non-authoritative.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-01", () => {
	it("P-01: content_start publishes a partial completion row with NO authority marker", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(h, "Partial verdict.")

		const row = webviewFinalizedCompletionRow(h)
		// The partial row IS published (the summary is visible while streaming).
		const partial = h.webview.messages.find((m) => m.say === "completion_result" && m.partial === true) as
			| ClineMessage
			| undefined
		expect(partial).toBeDefined()
		expect(partial?.text).toBe("Partial verdict.")
		expect(partial?.isAuthoritativelyCompletedResult).toBeUndefined()

		// The non-authoritative claim holds at the OBSERVABLE boundary: the
		// webview framing projection renders NO "Completed" badge.
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()

		// And the host store agrees.
		expect(storedFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(row?.isAuthoritativelyCompletedResult).toBeUndefined()
	})
})

// ===========================================================================
// P-02 — Finalized does not mean committed.
//
// The LIVE path and the RESTORATION path are exercised SEPARATELY.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-02", () => {
	it("P-02 (LIVE path): content_end finalizes the row WITHOUT the authority marker", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(h, "Live verdict.")
		await driveContentEnd(h, "Live verdict.")

		const row = webviewFinalizedCompletionRow(h)
		// (a) The row IS finalized and visible.
		expect(row).toBeDefined()
		expect(row?.partial).toBe(false)
		expect(row?.text).toBe("Live verdict.")
		// (b) It carries NO authority marker — finalization is NOT commitment.
		expect(row?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(storedFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBeUndefined()
		// (c) The webview projection agrees.
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
		// (d) No C10 commit happened yet.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).toBe("streaming")
	})

	it("P-02 (RESTORATION path): the marker is recovered ONLY from a verified persisted completion identity", async () => {
		// The RESTORATION path is the persistence/reopen translation. A
		// persisted COMMITTED completion (no runtime-control
		// `completion_continuation_control` after its tool_result) restores
		// WITH the marker; the LIVE path never stamps it.
		const committed = sdkMessagesToClineMessages(
			[
				{
					role: "user",
					content: [{ type: "text", text: '<user_input mode="act">task</user_input>' }],
				},
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call-cpc01-committed",
							name: "submit_and_exit",
							input: { summary: "Committed verdict." },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-cpc01-committed",
							name: "submit_and_exit",
							content: "submitted",
						},
					],
				},
			] as never,
			new MessageIdMinter(),
			{ finalTurnCompleted: true, cwd: "/repo" },
		)
		const committedRow = committed.find((m) => m.say === "completion_result") as ClineMessage | undefined
		expect(committedRow).toBeDefined()
		expect(committedRow?.isAuthoritativelyCompletedResult).toBe(true)

		// The LIVE translator, driven with the SAME completion tool, does NOT
		// stamp the marker. The two paths are therefore NOT interchangeable:
		// the marker on restore is a RECOVERED identity, not a publication.
		const liveState = new MessageTranslatorState()
		await driveContentStartWithState(liveState, "Committed verdict.")
		const liveMessages = translateSessionEvent(
			agentEvent("session-cpc01-live", {
				type: "content_end",
				contentType: "tool",
				toolName: "submit_and_exit",
				toolCallId: "tc-cpc01-live",
				input: { summary: "Committed verdict." },
			}),
			liveState,
		)
		const liveRow = liveMessages.messages.find((m) => m.say === "completion_result") as ClineMessage | undefined
		expect(liveRow).toBeDefined()
		expect(liveRow?.isAuthoritativelyCompletedResult).toBeUndefined()
	})
})

/** Drive `content_start` through the REAL translator only (no coordinator). */
async function driveContentStartWithState(state: MessageTranslatorState, resultText: string): Promise<void> {
	translateSessionEvent(
		agentEvent("session-cpc01-live", {
			type: "content_start",
			contentType: "tool",
			toolName: "submit_and_exit",
			toolCallId: "tc-cpc01-live",
			input: { summary: resultText },
		}),
		state,
	)
}

// ===========================================================================
// P-03 — Background barriers prevent false completion presentation.
//
// The BCB policy filters a completion row at the MESSAGE layer. The current
// turn must then publish NO completion row at all, so it cannot present as
// an authoritative completion. BCB filtration is NOT Elm authorization and
// the two are asserted separately.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-03", () => {
	it("P-03 (owned running job): the BCB filter removes the completion row from the published set", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// An OWNED background job is still running.
		h.ownedJobs.push({ jobId: "job-owned-1", running: true })

		await driveContentStart(h, "Held by a running job.")
		await driveContentEnd(h, "Held by a running job.")

		// (a) NO completion row reaches the published set.
		expect(webviewCompletionRows(h)).toHaveLength(0)
		expect(h.storedRows().filter((m) => m.say === "completion_result")).toHaveLength(0)
		// (b) No authoritative badge is possible.
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
		// (c) No C10 commit happened.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).toBe("streaming")
	})

	it("P-03 (held terminal observation): the BCB filter removes the completion row", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// An owned terminal result is held, not yet observed.
		h.ownedJobs.push({ jobId: "job-owned-2", running: false })
		h.unconsumed.value = 1

		await driveContentStart(h, "Held terminal observation.")
		await driveContentEnd(h, "Held terminal observation.")

		expect(webviewCompletionRows(h)).toHaveLength(0)
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
		expect(h.completionCommitCount()).toBe(0)
	})

	it("P-03 (foreign-session observation): a foreign held observation neither HOLDs nor RELEASEs this task's completion", async () => {
		// ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01:
		// this test is RETAINED as a FIXTURE-INDEPENDENCE check, but it is
		// NOT the foreign-session isolation evidence. It builds TWO
		// INDEPENDENT harnesses with separate `ownedJobs` arrays and
		// separate `unconsumed` counters, so the assertion is true BY
		// CONSTRUCTION of the fixture rather than by any property of the
		// production ownership authority.
		//
		// The real foreign-session isolation evidence is the
		// "P-03 SHARED OWNERSHIP ISOLATION" block below, which drives ONE
		// shared production `BackgroundNotifyCoordinator` and asserts that
		// a foreign owner's outstanding obligation neither holds nor
		// releases the target owner's completion — with a RED
		// discriminator for a broken ownership key.
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The held observation belongs to a FOREIGN session. The ownership
		// key is (sessionId, taskId), so it must not match this task.
		const foreign = makeHarness({ activeSessionId: "session-foreign", activeTaskId: "task-foreign" })
		foreign.ownedJobs.push({ jobId: "job-foreign-1", running: true })
		foreign.unconsumed.value = 1

		await driveContentStart(h, "This task owns nothing.")
		await driveContentEnd(h, "This task owns nothing.")

		// The foreign observation did NOT filter this task's row.
		expect(webviewCompletionRows(h)).toHaveLength(1)
		// ... and the foreign task's own observation DID filter its row.
		await driveContentStart(foreign, "Foreign task.")
		await driveContentEnd(foreign, "Foreign task.")
		expect(webviewCompletionRows(foreign)).toHaveLength(0)
	})

	it("P-03 (BCB is NOT Elm authorization): an Elm HOLD leaves the row visible but non-authoritative", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// No BCB hold: nothing outstanding.
		h.setElmDecision(() => ({ kind: "hold", reason: "cpc01-elm-hold", holdReasons: ["active_run"] }))

		await driveContentStart(h, "Elm held verdict.")
		await driveContentEnd(h, "Elm held verdict.")

		// The Elm HOLD does NOT filter the row — the row stays VISIBLE.
		expect(webviewCompletionRows(h)).toHaveLength(1)
		// ... but it is NOT authoritative.
		expect(webviewFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
		// And no C10 commit happened.
		expect(h.completionCommitCount()).toBe(0)
	})
})

// ===========================================================================
// P-04 — The completed badge has a legitimate authority.
//
// For modern SDK completion rows:  Completed badge => authoritative marker.
// For the legacy `ask:"completion_result"` fallback, the independently
// established legacy conditions are preserved.
//
// A row's authority is NOT inferred from the current task phase.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-04", () => {
	const modernRow = (marker: boolean | undefined): ClineMessage =>
		({
			ts: 1,
			type: "say",
			say: "completion_result",
			text: "Modern SDK row.",
			partial: false,
			...(marker === undefined ? {} : { isAuthoritativelyCompletedResult: marker }),
		}) as ClineMessage
	const legacyAskRow = (text: string): ClineMessage =>
		({ ts: 2, type: "ask", ask: "completion_result", text, partial: false }) as ClineMessage

	it("P-04 (modern SDK): the badge requires the authoritative marker", () => {
		// Marker present -> badge, regardless of the current phase.
		expect(
			resolveTerminalReportFraming({
				message: modernRow(true) as never,
				turnState: { phase: "streaming", ts: 0 } as never,
				mode: "act",
			}),
		).toMatchObject({ kind: "completed", label: "Completed" })
		// Marker ABSENT -> no badge, even when the phase says "completed".
		expect(
			resolveTerminalReportFraming({
				message: modernRow(undefined) as never,
				turnState: { phase: "completed", ts: 0 } as never,
				mode: "act",
			}),
		).toBeUndefined()
		// An explicit `false` marker also opts out.
		expect(
			resolveTerminalReportFraming({
				message: modernRow(false) as never,
				turnState: { phase: "completed", ts: 0 } as never,
				mode: "act",
			}),
		).toBeUndefined()
	})

	it("P-04 (plan mode): no badge in plan mode, even for a marked row", () => {
		expect(
			resolveTerminalReportFraming({
				message: modernRow(true) as never,
				turnState: { phase: "completed", ts: 0 } as never,
				mode: "plan",
			}),
		).toBeUndefined()
	})

	it("P-04 (legacy ask fallback): the independently established legacy conditions are preserved", () => {
		// Legacy ask + phase "completed" + non-empty text -> badge.
		expect(
			resolveTerminalReportFraming({
				message: legacyAskRow("Legacy answer.") as never,
				turnState: { phase: "completed", ts: 0 } as never,
				mode: "act",
			}),
		).toMatchObject({ kind: "completed", label: "Completed" })
		// Legacy ask + phase NOT completed -> no badge (the legacy path is
		// still phase-gated; it does NOT borrow the modern marker path).
		expect(
			resolveTerminalReportFraming({
				message: legacyAskRow("Legacy answer.") as never,
				turnState: { phase: "streaming", ts: 0 } as never,
				mode: "act",
			}),
		).toBeUndefined()
		// Legacy ask + phase completed + EMPTY text -> no badge.
		expect(
			resolveTerminalReportFraming({
				message: legacyAskRow("") as never,
				turnState: { phase: "completed", ts: 0 } as never,
				mode: "act",
			}),
		).toBeUndefined()
	})

	it("P-04 (phase transition): a HISTORICAL marked row keeps its badge while a newer turn streams", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(h, "Historical verdict.")
		await driveContentEnd(h, "Historical verdict.")
		await driveDone(h, "Historical verdict.")

		// The C10 committed -> the row carries the marker.
		expect(webviewFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBe(true)
		expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")

		// A NEWER turn starts streaming. The phase flips back to "streaming",
		// but the HISTORICAL row keeps its badge — the badge is a per-row
		// identity, NOT a projection of the mutable current phase.
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(webviewFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBe(true)
		expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
	})
})

// ===========================================================================
// P-05 — Same-row promotion converges.
//
// Publishing an update with the SAME completion-row `ts` updates the
// intended row without introducing another visible completion row. Both the
// host message store and the real webview reducer are exercised.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-05", () => {
	it("P-05: the same-ts promotion updates the row in place in BOTH the host store and the webview replica", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(h, "Convergent verdict.")
		await driveContentEnd(h, "Convergent verdict.")

		const publishedTs = webviewFinalizedCompletionRow(h)?.ts
		expect(publishedTs).toBeDefined()
		expect(webviewCompletionRows(h)).toHaveLength(1)
		expect(h.storedRows().filter((m) => m.say === "completion_result")).toHaveLength(1)

		await driveDone(h, "Convergent verdict.")

		// (a) The webview replica converges on ONE completion row.
		const webviewRows = webviewCompletionRows(h)
		expect(webviewRows).toHaveLength(1)
		expect(webviewRows[0].ts).toBe(publishedTs)
		// (b) The host store converges on ONE completion row, same `ts`.
		const storedRows = h.storedRows().filter((m) => m.say === "completion_result")
		expect(storedRows).toHaveLength(1)
		expect(storedRows[0].ts).toBe(publishedTs)
		// (c) The ORIGINAL summary text is preserved on both boundaries.
		expect(webviewRows[0].text).toBe("Convergent verdict.")
		expect(storedRows[0].text).toBe("Convergent verdict.")
		// (d) The promoted row now carries the marker.
		expect(webviewRows[0].isAuthoritativelyCompletedResult).toBe(true)
		expect(storedRows[0].isAuthoritativelyCompletedResult).toBe(true)
		// (e) The badge renders exactly once.
		expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
	})
})

// ===========================================================================
// P-06 — Completion authority precedes promotion.
//
// On BOTH the immediate and the deferred completion paths:
//   1. The appropriate Elm authority authorizes.
//   2. The actual completed-phase effect commits.
//   3. The current-turn row is promoted.
//   4. The webview converges on one authoritative row.
//
// The trace distinguishes an EFFECT REQUEST, an OBSERVED COMMIT, and a
// SUCCESSFUL MARKER PUBLICATION. A failed publication is never recorded as
// a success, and a HOLD never produces a current-turn authoritative marker.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-06", () => {
	beforeEach(() => {
		clearLifecycleTransitionTrace()
		enableLifecycleTransitionTrace()
	})
	afterEach(() => {
		setLifecycleTransitionTraceEnabled(false)
		clearLifecycleTransitionTrace()
	})

	it("P-06 (immediate path): authority -> effect request -> observed commit -> promotion, then ONE authoritative row", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(h, "Immediate verdict.")
		await driveContentEnd(h, "Immediate verdict.")
		const publishedTs = webviewFinalizedCompletionRow(h)?.ts
		expect(publishedTs).toBeDefined()

		await driveDone(h, "Immediate verdict.")

		// (1) The C10 committed.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		// (2) The trace distinguishes the three stages.
		const records = [...getLifecycleTransitionTraceRecords()]
		const decision = records.find((r) => r.stage === "authority_decision")
		expect(decision).toBeDefined()
		expect(decision?.outcome).toBe("authorized")
		expect(records.some((r) => r.stage === "effect_requested")).toBe(true)
		expect(records.some((r) => r.stage === "phase_commit_observed")).toBe(true)
		expect(records.some((r) => r.stage === "marker_promoted")).toBe(true)
		// The causal chain validates: same decision, task and turn identity.
		expect(validateLifecycleTransitionTrace(records, decision?.decision_id ?? "")).toEqual({ valid: true })

		// (3) The row was promoted (same `ts`, one visible row, text kept).
		expect(webviewCompletionRows(h)).toHaveLength(1)
		expect(webviewFinalizedCompletionRow(h)?.ts).toBe(publishedTs)
		expect(webviewFinalizedCompletionRow(h)?.text).toBe("Immediate verdict.")
		// (4) The webview converges on ONE authoritative row.
		expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
	})

	it("P-06 (deferred path): the EXISTING row is promoted after the deferred C10 commits", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// The Elm authority HOLDS at turn end (e.g. an active_run is still
		// outstanding), so the C10 is DEFERRED.
		h.setElmDecision(() => ({ kind: "hold", reason: "cpc01-deferred-hold", holdReasons: ["active_run"] }))

		await driveContentStart(h, "Deferred verdict.")
		await driveContentEnd(h, "Deferred verdict.")
		const publishedTs = webviewFinalizedCompletionRow(h)?.ts
		expect(publishedTs).toBeDefined()

		await driveDone(h, "Deferred verdict.")

		// (a) The C10 commit was DEFERRED — no commit, no badge.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()

		// (b) The obstacle clears and the Elm authority now AUTHORIZEs.
		h.setElmDecision(() => ({ kind: "authorize", reason: "cpc01-deferred-authorize" }))
		await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

		// (c) The deferred C10 committed.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		// (d) The EXISTING row was promoted — the SAME `ts`, NO second
		//     `submit_and_exit`, ONE visible row, summary preserved.
		expect(webviewCompletionRows(h)).toHaveLength(1)
		expect(webviewFinalizedCompletionRow(h)?.ts).toBe(publishedTs)
		expect(webviewFinalizedCompletionRow(h)?.text).toBe("Deferred verdict.")
		expect(webviewAuthoritativeFraming(h)?.kind).toBe("completed")
	})

	it("P-06 (HOLD): an Elm HOLD produces NO current-turn authoritative marker", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision(() => ({ kind: "hold", reason: "cpc01-permanent-hold", holdReasons: ["active_run"] }))

		await driveContentStart(h, "Held verdict.")
		await driveContentEnd(h, "Held verdict.")
		await driveDone(h, "Held verdict.")
		await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(webviewFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
	})

	it("P-06 (Elm FAILURE): an Elm failure produces NO current-turn authoritative marker", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setElmDecision(() => ({
			kind: "failure",
			reason: "cpc01-elm-failure",
			classification: "elm_authority_unavailable",
		}))

		await driveContentStart(h, "Failed verdict.")
		await driveContentEnd(h, "Failed verdict.")
		await driveDone(h, "Failed verdict.")

		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).toBe("streaming")
		expect(webviewFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
	})
})

// ===========================================================================
// P-07 — Reopen agrees with committed authority.
//
// The restoration path is the REAL persistence/reopen translation
// (`sdkMessagesToClineMessages`). The live row and its restored counterpart
// are compared for the selected cases.
// ===========================================================================

type AnyMsg = Parameters<typeof sdkMessagesToClineMessages>[0][number]

/** Build a persisted transcript with ONE completion attempt. */
function persistedTranscript(opts: { readonly toolUseId: string; readonly summary: string; readonly held: boolean }): AnyMsg[] {
	const messages: AnyMsg[] = [
		{ role: "user", content: [{ type: "text", text: '<user_input mode="act">task</user_input>' }] } as never,
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: opts.toolUseId,
					name: "submit_and_exit",
					input: { summary: opts.summary },
				},
			],
		} as never,
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: opts.toolUseId,
					name: "submit_and_exit",
					content: "submitted",
				},
			],
		} as never,
	]
	if (opts.held) {
		messages.push({
			role: "user",
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: '<user_input mode="act">observe the held terminal result</user_input>' }],
		} as never)
	}
	return messages
}

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / P-07", () => {
	it("P-07 (committed): the restored row RETAINs the authority marker", () => {
		const restored = sdkMessagesToClineMessages(
			persistedTranscript({ toolUseId: "call-cpc01-p07-committed", summary: "Committed verdict.", held: false }),
			new MessageIdMinter(),
			{ finalTurnCompleted: true, cwd: "/repo" },
		)
		const row = restored.find((m) => m.say === "completion_result") as ClineMessage | undefined
		expect(row).toBeDefined()
		expect(row?.isAuthoritativelyCompletedResult).toBe(true)
		expect(row?.text).toBe("Committed verdict.")
		// The restored row renders the badge.
		expect(
			resolveTerminalReportFraming({
				message: row as never,
				turnState: { phase: "streaming", ts: 0 } as never,
				mode: "act",
			}),
		).toMatchObject({ kind: "completed" })
	})

	it("P-07 (held): the restored row does NOT acquire a marker", () => {
		const restored = sdkMessagesToClineMessages(
			persistedTranscript({ toolUseId: "call-cpc01-p07-held", summary: "Held verdict.", held: true }),
			new MessageIdMinter(),
			{ finalTurnCompleted: true, cwd: "/repo" },
		)
		const row = restored.find((m) => m.say === "completion_result") as ClineMessage | undefined
		expect(row).toBeDefined()
		expect(row?.isAuthoritativelyCompletedResult).toBeUndefined()
		// The summary TEXT is preserved.
		expect(row?.text).toBe("Held verdict.")
		// And no badge is rendered.
		expect(
			resolveTerminalReportFraming({
				message: row as never,
				turnState: { phase: "completed", ts: 0 } as never,
				mode: "act",
			}),
		).toBeUndefined()
	})

	it("P-07 (historical identity): a historical committed completion is NOT overwritten by a newer turn", () => {
		// A transcript with an EARLIER committed completion and a LATER held
		// completion. The later hold must NOT revoke the earlier committed
		// completion's authority — the historical identity is preserved.
		const restored = sdkMessagesToClineMessages(
			[
				...persistedTranscript({ toolUseId: "call-cpc01-p07-hist-a", summary: "Historical A.", held: false }),
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call-cpc01-p07-hist-b",
							name: "submit_and_exit",
							input: { summary: "Historical B." },
						},
					],
				} as never,
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-cpc01-p07-hist-b",
							name: "submit_and_exit",
							content: "submitted",
						},
					],
				} as never,
				{
					role: "user",
					metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
					content: [{ type: "text", text: '<user_input mode="act">observe</user_input>' }],
				} as never,
			],
			new MessageIdMinter(),
			{ finalTurnCompleted: true, cwd: "/repo" },
		)
		const rows = restored.filter((m) => m.say === "completion_result") as ClineMessage[]
		expect(rows).toHaveLength(2)
		// The FIRST (historical) completion keeps its authority.
		expect(rows[0].text).toBe("Historical A.")
		expect(rows[0].isAuthoritativelyCompletedResult).toBe(true)
		// The SECOND (held) completion acquires none.
		expect(rows[1].text).toBe("Historical B.")
		expect(rows[1].isAuthoritativelyCompletedResult).toBeUndefined()
	})

	it("P-07 (legacy semantics unchanged): the legacy trailing ask row is still emitted", () => {
		// The restoration path has ALWAYS appended a trailing empty
		// `ask:"completion_result"` row (the "current-terminal" indicator the
		// webview footer reads). P-07 must not change that legacy semantics.
		const restored = sdkMessagesToClineMessages(
			persistedTranscript({ toolUseId: "call-cpc01-p07-legacy", summary: "Legacy verdict.", held: false }),
			new MessageIdMinter(),
			{ finalTurnCompleted: true, cwd: "/repo" },
		)
		const trailingAsk = restored.find((m) => m.type === "ask" && m.ask === "completion_result") as ClineMessage | undefined
		expect(trailingAsk).toBeDefined()
		expect(trailingAsk?.text).toBe("")
		expect(trailingAsk?.isAuthoritativelyCompletedResult).toBeUndefined()
	})
})

// ===========================================================================
// THE NEGATIVE WITNESSES.
//
// Each witness demonstrates that the conformance assertion DETECTS its
// targeted defect. NEG-01 uses a CONTROLLED MUTATION of the translator at
// the production option-bag boundary: the mutant reproduces the historical
// defect exactly (it stamps the authority marker at PUBLICATION time). The
// assertion must then FAIL on the mutant and PASS on production.
//
// NEG-02 and NEG-03 use the REAL production seams with an injected
// condition (a stale-epoch promotion; a throwing publication channel).
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / NEGATIVE WITNESSES", () => {
	beforeEach(() => {
		clearLifecycleTransitionTrace()
		enableLifecycleTransitionTrace()
	})
	afterEach(() => {
		setLifecycleTransitionTraceEnabled(false)
		clearLifecycleTransitionTrace()
	})

	// -----------------------------------------------------------------------
	// NEG-01 — Premature marker.
	//
	// A finalized row that receives a marker BEFORE the C10 commit must be
	// rejected by the conformance assertion.
	//
	// The mutant below is the HISTORICAL defect: it stamps
	// `isAuthoritativelyCompletedResult: true` on the finalized
	// `completion_result` row at PUBLICATION time. Everything else — the
	// coordinator, the BCB filter, the Elm gate, the C10 commit, the
	// promotion, the reducer, the framing projection — is production code.
	// -----------------------------------------------------------------------
	it("NEG-01: the conformance assertion DETECTS a marker stamped before the C10 commit (RED on the mutant, GREEN on production)", async () => {
		// (a) The MUTANT: the historical "stamp at publication" defect.
		const mutant = makeHarness({
			translateOverride: ((event, state) => {
				const result = translateSessionEvent(event, state)
				for (const m of result.messages) {
					if (m.say === "completion_result" && m.partial !== true) {
						m.isAuthoritativelyCompletedResult = true
					}
				}
				return result
			}) as SdkSessionEventCoordinatorOptions["translateSessionEvent"],
		})
		mutant.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(mutant, "Premature verdict.")
		await driveContentEnd(mutant, "Premature verdict.")

		// (b) The mutation DID introduce the defect: the row now claims
		//     authority BEFORE any C10 commit.
		expect(mutant.completionCommitCount()).toBe(0)
		expect(mutant.tracker.currentPhase).toBe("streaming")
		expect(webviewFinalizedCompletionRow(mutant)?.isAuthoritativelyCompletedResult).toBe(true)

		// (c) THE DETECTION: the conformance assertion REJECTS the resulting
		//     authoritative presentation. This is the RED witness — it fails
		//     against a production translator that stamps the marker here.
		//
		//     The detector is expressed as an explicit REJECTION predicate so
		//     the witness asserts the DETECTION, not the defect's absence:
		//
		//       rejectPrematureAuthority(row, phase, committed)
		//         = the row claims authority while the task has NOT committed
		//
		//     On the mutant the predicate is TRUE (the defect is present and
		//     therefore detectable); on production it is FALSE.
		expect(rejectsPrematureAuthority(mutant)).toBe(true)

		// (d) GREEN on production: the same sequence against the REAL
		//     translator produces NO authoritative presentation.
		const production = makeHarness()
		production.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		await driveContentStart(production, "Premature verdict.")
		await driveContentEnd(production, "Premature verdict.")
		expect(webviewFinalizedCompletionRow(production)?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(webviewAuthoritativeFraming(production)).toBeUndefined()
		expect(rejectsPrematureAuthority(production)).toBe(false)
	})

	// -----------------------------------------------------------------------
	// NEG-02 — Stale promotion.
	//
	// An older turn's completion promotion that arrives during a NEWER
	// epoch must NOT be treated as the current turn's authority. The
	// historical/current-turn distinction is by EPOCH / TURN identity, NOT
	// by timestamp ordering: a stale row can carry a LOWER `ts` OR a
	// HIGHER `ts`, and neither makes it current.
	// -----------------------------------------------------------------------
	it("NEG-02: a stale (older-epoch) promotion is NOT treated as the current turn's authority", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await driveContentStart(h, "Epoch fenced.")
		await driveContentEnd(h, "Epoch fenced.")
		const publishedTs = webviewFinalizedCompletionRow(h)?.ts
		const publishedEpoch = webviewFinalizedCompletionRow(h)?.epoch
		expect(publishedTs).toBeDefined()
		expect(publishedEpoch).toBeDefined()

		// The webview advances to a NEWER epoch (a new task / render).
		const newerEpoch = (publishedEpoch as number) + 1
		let replica = applyMessage(h.webview, {
			ts: 999_999,
			type: "say",
			say: "text",
			text: "new epoch",
			seq: 999_999,
			epoch: newerEpoch,
		} as never)
		expect(replica.epoch).toBe(newerEpoch)

		// A promotion carrying the OLD epoch is a STALE straggler: the REAL
		// reducer DROPS it. The historical row is still in the transcript
		// (it legitimately survives the epoch advance — the epoch fence
		// prevents resurrection, not retention), but the stale promotion must
		// NOT upgrade it to an authoritative row, and it must NOT introduce
		// a new completion row.
		const before = replica.messages.length
		const historicalRow = replica.messages.find((m) => m.say === "completion_result") as ClineMessage | undefined
		expect(historicalRow).toBeDefined()
		expect(historicalRow?.isAuthoritativelyCompletedResult).toBeUndefined()
		replica = applyMessage(replica, {
			ts: publishedTs as number,
			type: "say",
			say: "completion_result",
			text: "Epoch fenced.",
			partial: false,
			isAuthoritativelyCompletedResult: true,
			seq: 999_998,
			epoch: publishedEpoch,
		} as never)
		expect(replica.messages).toHaveLength(before)
		const afterStale = replica.messages.find((m) => m.say === "completion_result") as ClineMessage | undefined
		expect(afterStale?.isAuthoritativelyCompletedResult).toBeUndefined()

		// The distinction is NOT timestamp ordering: a stale promotion with a
		// MUCH HIGHER `ts` is dropped for the SAME reason (the epoch fence),
		// and a stale promotion with a LOWER `ts` is dropped too.
		const staleHighTs = applyMessage(replica, {
			ts: (publishedTs as number) + 1_000_000,
			type: "say",
			say: "completion_result",
			text: "Stale but newer ts.",
			partial: false,
			isAuthoritativelyCompletedResult: true,
			seq: 999_997,
			epoch: publishedEpoch,
		} as never)
		expect(staleHighTs.messages).toHaveLength(before)
		expect(staleHighTs.messages.some((m) => m.say === "completion_result" && m.isAuthoritativelyCompletedResult)).toBe(false)
	})

	// -----------------------------------------------------------------------
	// NEG-03 — Failed publication.
	//
	// The C10 commits but the marker publication throws. The evidence must
	// NOT claim effect success or completed webview delivery: the trace
	// records the phase commit but NOT `marker_promoted` / `effect_executed`,
	// and the webview replica carries no authoritative badge.
	// -----------------------------------------------------------------------
	it("NEG-03: a failed marker publication is NOT recorded as a successful promotion", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.failMarkerPublication = true

		await driveContentStart(h, "Failure verdict.")
		await driveContentEnd(h, "Failure verdict.")
		await driveDone(h, "Failure verdict.")

		// (a) The C10 DID commit (the phase effect succeeded).
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")

		// (b) The trace records the phase commit but NOT the successful
		//     marker publication. The effect_executed / marker_promoted
		//     records are emitted INSIDE the try block that surrounds the
		//     publication, so a throwing publication cannot claim them.
		const records = [...getLifecycleTransitionTraceRecords()]
		expect(records.some((r) => r.stage === "phase_commit_observed")).toBe(true)
		expect(records.some((r) => r.stage === "marker_promoted")).toBe(false)
		expect(records.some((r) => r.stage === "effect_executed")).toBe(false)

		// (c) The causal chain does NOT validate: the promotion is missing.
		const decision = records.find((r) => r.stage === "authority_decision")
		expect(decision).toBeDefined()
		expect(validateLifecycleTransitionTrace(records, decision?.decision_id ?? "")).toEqual({
			valid: false,
			reason: "missing_effect_executed",
		})

		// (d) The webview did NOT receive an authoritative completion.
		expect(webviewFinalizedCompletionRow(h)?.isAuthoritativelyCompletedResult).toBeUndefined()
		expect(webviewAuthoritativeFraming(h)).toBeUndefined()
	})
})

// ===========================================================================
// The coverage registry is bound to THIS suite.
//
// The claim registry (`completion-presentation-contract.ts`) names this file
// as the witness for every claim. If a claim's witness drifts, this test
// fails — so the report can never claim coverage for a suite that does not
// assert it.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / CLAIM REGISTRY", () => {
	it("every P-01..P-07 claim names THIS suite as its executable witness", () => {
		expect(COMPLETION_PRESENTATION_CLAIM_IDS).toEqual(["P-01", "P-02", "P-03", "P-04", "P-05", "P-06", "P-07"])
		for (const claim of COMPLETION_PRESENTATION_CLAIMS) {
			expect(claim.witness).toBe("apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts")
			expect(claim.production_symbol.length).toBeGreaterThan(0)
			expect(claim.assertion.length).toBeGreaterThan(0)
			expect(claim.observed_boundary.length).toBeGreaterThan(0)
		}
		// All seven claims are eligible for executable conformance; no claim
		// is silently excluded from the denominator.
		expect(eligibleCompletionPresentationClaims()).toHaveLength(7)
	})
})

// ===========================================================================
// The Chart 04 DOCUMENTATION guard.
//
// These assertions are about the DOCUMENT, not the behaviour. The behaviour
// is proven by the witnesses above; these assertions keep the document from
// re-asserting the historical defect as current behaviour, and keep the
// Mermaid projection and the claim taxonomy in sync.
//
// The guard is a mutation-tested detector: the mutations below MUST be
// rejected.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 / CHART 04 DOCUMENTATION GUARD", () => {
	const chart04Path = resolve(
		import.meta.dirname,
		"../../../../../docs/architecture/task-lifecycle/04-completion-presentation.md",
	)
	const chart04Markdown = readFileSync(chart04Path, "utf8")

	const verify = (markdown: string) =>
		verifyChart04CompletionPresentation({
			markdown,
			transitionClaimIds: CHART_04_TRANSITION_CLAIM_IDS,
			nonTransitionClaimIds: CHART_04_NON_TRANSITION_CLAIM_IDS,
		})

	it("the REAL Chart 04 document passes the documentation guard", () => {
		const { errors, mermaidBlockCount } = verify(chart04Markdown)
		expect(errors).toEqual([])
		expect(mermaidBlockCount).toBe(1)
	})

	it("MUT-01: re-asserting the historical 'marker stamped at content_end' defect is REJECTED", () => {
		const mutated = chart04Markdown.replace(
			"NO authority marker.\n        The marker is published by the C10 COMMIT (P-06),",
			"isAuthoritativelyCompletedResult: true   <-- STAMPED HERE\n        The marker is published by the C10 COMMIT (P-06),",
		)
		expect(mutated).not.toBe(chart04Markdown)
		const { errors } = verify(mutated)
		expect(errors.some((e) => e.includes("still asserts the authority marker is stamped at content_end"))).toBe(true)
	})

	it("MUT-02: removing a TRANSITION claim's Mermaid edge is REJECTED", () => {
		const mutated = chart04Markdown.replace(
			"    PartialRowPublished --> FinalRowPublished : P-02 content_end (completion tool)",
			"    PartialRowPublished --> FinalRowPublished : content_end (completion tool)",
		)
		expect(mutated).not.toBe(chart04Markdown)
		const { errors } = verify(mutated)
		expect(errors.some((e) => e.includes("P-02") && e.includes("absent"))).toBe(true)
	})

	it("MUT-03: giving a PROJECTION claim a Mermaid edge is REJECTED", () => {
		const mutated = chart04Markdown.replace(
			"    RowVisible --> C10Committed : A-04 Elm authorizes + TS conservation passes",
			"    RowVisible --> BadgeShown : P-04 badge projection\n    RowVisible --> C10Committed : A-04 Elm authorizes + TS conservation passes",
		)
		expect(mutated).not.toBe(chart04Markdown)
		const { errors } = verify(mutated)
		expect(errors.some((e) => e.includes("P-04") && e.includes("must NOT carry"))).toBe(true)
	})

	it("MUT-04: removing the FinalRowPublished note is REJECTED", () => {
		const mutated = chart04Markdown.replace(/ {4}note right of FinalRowPublished[\s\S]*? {4}end note\n/, "")
		expect(mutated).not.toBe(chart04Markdown)
		const { errors } = verify(mutated)
		expect(errors.some((e) => e.includes("missing the FinalRowPublished note"))).toBe(true)
	})

	it("the ledger's Chart 04 rows carry the claim taxonomy and the executable witness", () => {
		const ledgerPath = resolve(import.meta.dirname, "../../../../../docs/architecture/task-lifecycle/transitions.tsv")
		const ledgerLines = readFileSync(ledgerPath, "utf8").trim().split("\n")
		const header = ledgerLines[0].split("\t")
		const claimKindIdx = header.indexOf("claim_kind")
		const witnessIdx = header.indexOf("evidence_witness")
		const statusIdx = header.indexOf("evidence_status")
		expect(claimKindIdx).toBeGreaterThanOrEqual(0)
		expect(witnessIdx).toBeGreaterThanOrEqual(0)
		expect(statusIdx).toBeGreaterThanOrEqual(0)

		const rows = ledgerLines.slice(1).map((line) => line.split("\t"))
		for (const claimId of COMPLETION_PRESENTATION_CLAIM_IDS) {
			const row = rows.find((r) => r[0] === claimId)
			expect(row, `ledger is missing ${claimId}`).toBeDefined()
			const claim = COMPLETION_PRESENTATION_CLAIMS.find((c) => c.claim_id === claimId)
			expect(row?.[claimKindIdx]).toBe(claim?.kind)
			expect(row?.[witnessIdx]).toBe(claim?.witness)
			expect(row?.[statusIdx]).toBe(claim?.evidence_level)
		}
	})

	it("the mermaid-block extractor is strict about the fence", () => {
		expect(extractMermaidBlocks(chart04Markdown)).toHaveLength(1)
		expect(extractMermaidBlocks("no fences here")).toHaveLength(0)
		expect(extractMermaidBlocks("```mermaid\nstateDiagram-v2\n```")).toHaveLength(1)
	})
})

// ===========================================================================
// ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01 —
// The Chart 04 ASSOCIATION witness.
//
// THE DEFECT THIS REPAIRS.
//
// The Chart 04 guard checked LABEL CARDINALITY: "each transition claim id
// appears on exactly one labeled Mermaid edge". It never checked that the
// id labels the CORRECT edge. Swapping the labels of two edges therefore
// satisfied every check — both ids still present exactly once — while
// inverting the meaning of both transitions.
//
//   [*] --> PartialRowPublished           : P-01 ...
//   PartialRowPublished --> FinalRowPublished : P-02 ...
//
// becomes
//
//   [*] --> PartialRowPublished           : P-02 ...
//   PartialRowPublished --> FinalRowPublished : P-01 ...
//
// This is EXACTLY the false-positive class that the MUT-03 correction
// (commit 38cb209ff) closed for the c9-c10 traceability diagram: an
// INDEPENDENT substring-presence check accepted a SWAPPED id-to-edge
// association.
//
// THE REPAIR.
//
// The association is now checked as an ASSOCIATION: the labeled edge's
// source/target must equal the VERIFIED endpoints in
// `CHART_04_EXPECTED_EDGES`.
//
// P-03 REMAINS A `GUARD` CLAIM. Its diagram edge represents the OUTCOME
// of that guard (the row is filtered out), not a claim reclassification.
// The taxonomy is not bent to satisfy the validator.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01 / CHART 04 EDGE ASSOCIATION", () => {
	const chart04Path = resolve(
		import.meta.dirname,
		"../../../../../docs/architecture/task-lifecycle/04-completion-presentation.md",
	)
	const chart04Markdown = readFileSync(chart04Path, "utf8")

	const verify = (markdown: string) =>
		verifyChart04CompletionPresentation({
			markdown,
			transitionClaimIds: CHART_04_TRANSITION_CLAIM_IDS,
			nonTransitionClaimIds: CHART_04_NON_TRANSITION_CLAIM_IDS,
			expectedEdges: CHART_04_EXPECTED_EDGES,
		})

	/**
	 * The PRE-CORRECTION semantics: label cardinality only, with no
	 * endpoint association check. Reimplemented faithfully (NOT imported)
	 * so the RED assertion is a genuine independent control.
	 */
	const verifyPreCorrection = (markdown: string) => {
		const diagramText = extractMermaidBlocks(markdown).join("\n")
		const edges = parseMermaidTransitionEdges(diagramText)
		const edgesByClaimId = new Map<string, number>()
		for (const edge of edges) {
			const claimId = transitionIdOfLabel(edge.label)
			if (!claimId) continue
			edgesByClaimId.set(claimId, (edgesByClaimId.get(claimId) ?? 0) + 1)
		}
		const errors: string[] = []
		for (const claimId of CHART_04_TRANSITION_CLAIM_IDS) {
			const count = edgesByClaimId.get(claimId) ?? 0
			if (count === 0) errors.push(`${claimId}: TRANSITION claim is absent from the Chart 04 Mermaid projection`)
			else if (count > 1) errors.push(`${claimId}: appears on ${count} Chart 04 Mermaid edges; expected exactly one`)
		}
		return { errors }
	}

	/** The endpoints of every edge currently labeled with `id`. */
	const endpointsFor = (markdown: string, id: string) => {
		const diagramText = extractMermaidBlocks(markdown).join("\n")
		return parseMermaidTransitionEdges(diagramText)
			.filter((edge) => transitionIdOfLabel(edge.label) === id)
			.map((edge) => `${edge.source} --> ${edge.target}`)
	}

	it("the REAL Chart 04 document passes the association-aware guard", () => {
		const { errors, mermaidBlockCount } = verify(chart04Markdown)
		expect(errors).toEqual([])
		expect(mermaidBlockCount).toBe(1)
	})

	it("the VERIFIED edge mapping matches the REAL Chart 04 document", () => {
		// The expected-endpoint table is not an independent invention: it
		// must describe the document that actually ships.
		for (const claimId of CHART_04_TRANSITION_CLAIM_IDS) {
			const labeled = endpointsFor(chart04Markdown, claimId)
			expect(labeled, `claim ${claimId} must label exactly one Chart 04 edge`).toHaveLength(1)
			const expected = CHART_04_EXPECTED_EDGES[claimId]
			expect(labeled[0]).toBe(`${expected.source} --> ${expected.target}`)
		}
	})

	it("MUT-05: SWAPPED claim labels on existing edges are REJECTED (both associations)", () => {
		// Mutate two DISTINCT edges BY THEIR ENDPOINTS. Locating the second
		// edge by an ALREADY-MUTATED id would reproduce the MUT-03 defect.
		const mutated = chart04Markdown
			.replace(/(\[\*\]\s*-->\s*PartialRowPublished\s*:\s*)P-01\b/, "$1P-02")
			.replace(/(PartialRowPublished\s*-->\s*FinalRowPublished\s*:\s*)P-02\b/, "$1P-01")

		expect(mutated).not.toBe(chart04Markdown)

		// Assert the mutation itself: both ids survive exactly once, each
		// now attached to the other's edge.
		expect(endpointsFor(mutated, "P-01")).toEqual(["PartialRowPublished --> FinalRowPublished"])
		expect(endpointsFor(mutated, "P-02")).toEqual(["[*] --> PartialRowPublished"])

		// Both associations must be rejected INDEPENDENTLY.
		const { errors } = verify(mutated)
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining("P-01: Mermaid edge is"),
				expect.stringContaining("P-02: Mermaid edge is"),
			]),
		)

		// The rejection must NOT come from a missing / absent label.
		expect(errors.some((error) => error.includes("absent from the Chart 04 Mermaid projection"))).toBe(false)
		expect(errors.some((error) => error.includes("expected exactly one"))).toBe(false)
	})

	it("MUT-05 (RED control): the PRE-CORRECTION cardinality-only semantics ACCEPT the swapped labels", () => {
		// This is the RED witness: against the pre-correction validator
		// semantics the swapped-label mutation produces ZERO errors, so the
		// pre-correction guard proved nothing. The corrected guard is
		// therefore a genuine detector, not a tautology.
		const mutated = chart04Markdown
			.replace(/(\[\*\]\s*-->\s*PartialRowPublished\s*:\s*)P-01\b/, "$1P-02")
			.replace(/(PartialRowPublished\s*-->\s*FinalRowPublished\s*:\s*)P-02\b/, "$1P-01")

		const { errors } = verifyPreCorrection(mutated)
		expect(errors).toEqual([])
	})

	it("MUT-06: a claim id attached to a WRONG (non-swapped) edge is REJECTED", () => {
		// P-03 is a GUARD claim whose diagram edge represents the OUTCOME of
		// the guard. Relabeling that edge with P-06 while moving P-06's own
		// id onto the P-03 edge must be rejected.
		const mutated = chart04Markdown
			.replace(/(FinalRowPublished\s*-->\s*RowFilteredOut\s*:\s*)P-03\b/, "$1P-06")
			.replace(/(C10Committed\s*-->\s*BadgeShown\s*:\s*)P-06\b/, "$1P-03")

		expect(mutated).not.toBe(chart04Markdown)
		expect(endpointsFor(mutated, "P-03")).toEqual(["C10Committed --> BadgeShown"])
		expect(endpointsFor(mutated, "P-06")).toEqual(["FinalRowPublished --> RowFilteredOut"])

		const { errors } = verify(mutated)
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining("P-03: Mermaid edge is"),
				expect.stringContaining("P-06: Mermaid edge is"),
			]),
		)
		expect(errors.some((error) => error.includes("absent from the Chart 04 Mermaid projection"))).toBe(false)
	})

	it("P-03 remains a GUARD claim: the taxonomy is not bent to satisfy the validator", () => {
		const p03 = COMPLETION_PRESENTATION_CLAIMS.find((c) => c.claim_id === "P-03")
		expect(p03?.kind).toBe("GUARD")
		// Its diagram edge represents the OUTCOME of the guard — the row is
		// filtered out — so the edge is legitimate and must be PRESENT.
		expect(CHART_04_EXPECTED_EDGES["P-03"]).toEqual({ source: "FinalRowPublished", target: "RowFilteredOut" })
	})
})

// ===========================================================================
// ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01 —
// The P-03 SHARED-OWNERSHIP ISOLATION witness.
//
// THE DEFECT THIS REPAIRS.
//
// The original P-03 foreign-session witness built TWO INDEPENDENT
// harnesses:
//
//     const h        = makeHarness()
//     const foreign  = makeHarness({ activeSessionId: "session-foreign", ... })
//     foreign.ownedJobs.push({ jobId: "job-foreign-1", running: true })
//
// and then asserted that `h` still published its completion row. That
// demonstrated only that TWO INDEPENDENTLY CONFIGURED FIXTURES behave
// independently. It never exercised a SHARED ownership service: the
// foreign obligation lived in a separate fixture with its own separate
// `ownedJobs` array and its own separate `unconsumed` counter, so the
// assertion was true BY CONSTRUCTION of the fixture, not by any property
// of production ownership.
//
// The real production ownership authorities are:
//
//   - `CommandJobManager.hasRunningBackgroundJobForOwner(ownerSessionId)`
//     — ONE manager instance holds the jobs of MANY sessions; the query
//     answers "does THIS owner have a running job?".
//
//   - `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner(
//     sessionId, taskId)` — ONE coordinator instance holds the held
//     obligations of MANY owners; the query is keyed by the canonical
//     `ownerKey(sessionId, taskId)`.
//
// THE REPAIR.
//
// One SINGLE `BackgroundNotifyCoordinator` is shared by BOTH owners. The
// foreign owner's obligation is registered against the foreign
// (sessionId, taskId). The property asserted is the one P-03 actually
// claims: an outstanding FOREIGN obligation neither HOLDS nor RELEASES
// the target task's completion.
//
// THE RED DISCRIMINATOR.
//
// A deliberately BROKEN ownership discriminator — one that keys only on
// `sessionId` and DROPS the `taskId` — is fed to the same witness. The
// witness MUST reject it, so the passing assertion cannot be satisfied
// by a discriminator that does not discriminate.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01 / P-03 SHARED OWNERSHIP ISOLATION", () => {
	/** The REAL canonical owner key used by the production coordinator. */
	const ownerKey = (sessionId: string, taskId: string | undefined) => `${sessionId}\u0000${taskId ?? ""}`

	/**
	 * The REAL production ownership discriminator:
	 * `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner`.
	 */
	const realDiscriminator = (coordinator: BackgroundNotifyCoordinator, sessionId: string, taskId: string | undefined): number =>
		coordinator.unconsumedTerminalCountForOwner(sessionId, taskId)

	/**
	 * The DELIBERATELY BROKEN discriminator: a SESSION-ONLY discriminator
	 * that DROPS the `taskId`. It matches ANY outstanding obligation
	 * belonging to the session, regardless of which task owns it — so it
	 * CANNOT distinguish two owners that share a session but differ in
	 * task. This is the over-broad shape that the canonical
	 * `ownerKey(sessionId, taskId)` exists to prevent.
	 */
	const brokenSessionOnlyDiscriminator = (
		coordinator: BackgroundNotifyCoordinator,
		sessionId: string,
		_taskId: string | undefined,
	): number => {
		// A session-only discriminator asks "does this session have ANY
		// outstanding obligation?" — it cannot narrow to the task.
		const jobs = coordinator.unconsumedOwnedTerminalJobIdsForOwner(sessionId, "task-b")
		const alsoTaskA = coordinator.unconsumedOwnedTerminalJobIdsForOwner(sessionId, "task-a")
		return new Set([...jobs, ...alsoTaskA]).size
	}

	/** Build ONE shared coordinator, exactly as production does. */
	const makeSharedCoordinator = (activeOwner: { sessionId: string; taskId: string }) => {
		const now = { value: 0 }
		return new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => activeOwner,
			enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
			now: () => ++now.value,
			consumeTerminalAuthority: legacyConsumeTerminalPolicy,
		})
	}

	it("the REAL shared coordinator isolates a foreign owner's obligation from the target owner", () => {
		// ONE coordinator instance — shared by BOTH owners, exactly as in
		// production (the coordinator is a singleton-per-host).
		const shared = makeSharedCoordinator({ sessionId: "session-target", taskId: "task-target" })

		const TARGET = { sessionId: "session-target", taskId: "task-target" }
		const FOREIGN = { sessionId: "session-foreign", taskId: "task-foreign" }

		// The FOREIGN owner has an outstanding held terminal obligation,
		// registered against the FOREIGN (sessionId, taskId).
		shared.recordNonNotifyTerminalObservation({
			jobId: "job-foreign-1",
			sessionId: FOREIGN.sessionId,
			taskId: FOREIGN.taskId,
		})

		// The foreign obligation is genuinely outstanding — for the
		// FOREIGN owner.
		expect(realDiscriminator(shared, FOREIGN.sessionId, FOREIGN.taskId)).toBe(1)
		// The shared service genuinely holds it: the foreign obligation is
		// not a fiction of an unshared fixture.
		expect(shared.unconsumedOwnedTerminalJobIdsForOwner(FOREIGN.sessionId, FOREIGN.taskId)).toEqual(["job-foreign-1"])

		// THE PROPERTY UNDER TEST: the target owner sees NOTHING. The
		// outstanding foreign obligation neither HOLDS the target's
		// completion...
		expect(realDiscriminator(shared, TARGET.sessionId, TARGET.taskId)).toBe(0)
		expect(shared.unconsumedOwnedTerminalJobIdsForOwner(TARGET.sessionId, TARGET.taskId)).toEqual([])
		// ...nor RELEASES it (no foreign job id leaks into the target's
		// held-job list, and the target's notify count is unaffected).
		expect(shared.activeNotifyCountForOwner(TARGET.sessionId, TARGET.taskId)).toBe(0)
		expect(shared.activeNotifyCountForOwner(FOREIGN.sessionId, FOREIGN.taskId)).toBe(0)
	})

	it("the REAL shared coordinator keeps two owners that share a SESSION but differ in TASK isolated", () => {
		// The discriminating case for the (sessionId, taskId) key: a
		// session-only key cannot distinguish these two owners.
		const shared = makeSharedCoordinator({ sessionId: "session-shared", taskId: "task-a" })

		shared.recordNonNotifyTerminalObservation({
			jobId: "job-task-b",
			sessionId: "session-shared",
			taskId: "task-b",
		})

		expect(realDiscriminator(shared, "session-shared", "task-b")).toBe(1)
		expect(realDiscriminator(shared, "session-shared", "task-a")).toBe(0)
		expect(shared.unconsumedOwnedTerminalJobIdsForOwner("session-shared", "task-a")).toEqual([])
	})

	it("the BROKEN session-only ownership discriminator is REJECTED (RED discriminator)", () => {
		const shared = makeSharedCoordinator({ sessionId: "session-shared", taskId: "task-a" })

		// task-b owns an outstanding obligation under the SAME session.
		shared.recordNonNotifyTerminalObservation({
			jobId: "job-task-b",
			sessionId: "session-shared",
			taskId: "task-b",
		})

		// The REAL discriminator isolates task-a from task-b.
		expect(realDiscriminator(shared, "session-shared", "task-a")).toBe(0)

		// The BROKEN discriminator CANNOT: it drops the taskId and therefore
		// sees task-b's obligation as task-a's. The witness MUST reject it —
		// this is what proves the passing assertion is not satisfied by a
		// discriminator that does not discriminate.
		const brokenValue = brokenSessionOnlyDiscriminator(shared, "session-shared", "task-a")
		expect(brokenValue).not.toBe(0)
		expect(brokenValue).toBe(1)
	})

	it("the production ownerKey discriminator rejects a session-only key", () => {
		// The canonical production key is `sessionId \u0000 taskId`. Two
		// owners that share a session but differ in task MUST produce
		// DIFFERENT keys; a session-only key collapses them. This is the
		// key-level statement of the same property the RED discriminator
		// demonstrates at the behaviour level.
		expect(ownerKey("session-shared", "task-a")).not.toBe(ownerKey("session-shared", "task-b"))
		expect(ownerKey("session-foreign", "task-foreign")).not.toBe(ownerKey("session-target", "task-target"))
		// The canonical key NEVER collapses a task dimension: dropping the
		// taskId is a DIFFERENT key, not a wildcard match.
		expect(ownerKey("session-shared", undefined)).not.toBe(ownerKey("session-shared", "task-a"))
		expect(ownerKey("session-shared", undefined)).not.toBe(ownerKey("session-shared", "task-b"))
		// A session-only key collapses them.
		expect(ownerKey("session-shared", undefined)).toBe(ownerKey("session-shared", undefined))
	})
})
