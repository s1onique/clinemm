/**
 * ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01)
 *
 * Real-seam RED/GREEN for the recurring false-Working/Cancel defect:
 * a task whose latest SDK run finished and whose canonical completion
 * authority permits `completed` remains in `legacyPhase = "streaming"`,
 * so the TaskHeader keeps rendering Working + Cancel forever.
 *
 * PTLL01-CORR01 (this revision) corrects the L1 evidence:
 *
 *   - RED-03 no longer supplies the missing event. The previous version
 *     called `notifyAgentTurnDone(...)` after clearing the scheduled
 *     continuation — the very production reevaluation entry point whose
 *     ABSENCE is the premise of the defect — so it could not prove the
 *     claimed scenario. RED-03 is now a genuine RED that documents the
 *     limit of the PTLL01-L1 drain-callback repair.
 *
 *   - The CAUSAL question ("which real event supplies the post-continuation
 *     reevaluation authority, and is the drain callback the cause?") is
 *     answered against the REAL compiled Elm kernel in the sibling file
 *     `post-terminal-lifecycle-liveness01.corr01-real-elm.test.ts`. This
 *     file uses a synthetic Elm stand-in, so it CANNOT establish the Elm
 *     causal order and does not claim to.
 *
 * TWO independent defects, each reproduced at ITS OWN production boundary:
 *
 *   L1 — COMPLETION liveness.
 *        `SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier`
 *        is only reachable from `notifyAgentTurnDone` and from
 *        `SdkController.maybeReevaluateDeferredContinuation`. It is NOT
 *        reachable from the BCB obligation DRAIN. So when the final
 *        `agent_turn_done` arrives while the Elm authority still holds
 *        (`scheduled_continuation` / `pending_prompt`), the reevaluation
 *        re-registers the marker (L1539) and returns — and if no further
 *        `agent_turn_done` / terminal-idle transition occurs, C10 is
 *        NEVER attempted even though every obligation predicate is now
 *        false and the authority has since cleared.
 *
 *   L2 — CANCELLATION liveness.
 *        `SdkTaskControlCoordinator.cancelTask()` early-returns when
 *        `getActiveSession()` is undefined, WITHOUT raising the cancel
 *        fence, WITHOUT a `setTurnPhase` write, and WITHOUT publishing.
 *        The committed webview state is unchanged, so `streaming` and
 *        the Cancel affordance persist — and re-clicking Cancel re-enters
 *        the same no-op branch forever.
 *
 * REAL_PRODUCTION_SEAM: the real `SdkSessionEventCoordinator`, the real
 * `BackgroundNotifyCoordinator` (the actual BCB obligation store — held
 * sets are asserted against the coordinator, not test-local counters),
 * and the real `SdkTaskControlCoordinator.cancelTask`.
 *
 * Safety (non-negotiable): a task must NEVER appear completed before
 * canonical completion authority permits it. RED-01/RED-02 assert C10
 * is ABSENT while obligations are held; LCV-07 asserts Elm AUTHORIZE
 * cannot commit while the TS conservation predicates still block.
 */

import type { CoreSessionEvent } from "@cline/core"
import type { TurnPhase } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkTaskControlCoordinator } from "../sdk-task-control-coordinator"
import { TaskOperationFence } from "../task-operation-fence"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
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
// Elm completion authority: a controllable REAL adapter stand-in.
//
// Models the ACTUAL production sequencing constraint that matters for L1:
// Elm holds while `pending_prompt` / `scheduled_continuation` is
// outstanding, and authorizes once that dependency clears. The HOLD is
// *causal* (gated on real obligation facts), not a canned stub.
// ---------------------------------------------------------------------------
type ElmHoldReason = "pending_prompt" | "scheduled_continuation" | "active_run"

class ElmAuthorityHarness {
	readonly holds: ElmHoldReason[] = []
	private authorizeCount_ = 0
	private holdCount_ = 0
	constructor(private readonly outstanding: () => ElmHoldReason | undefined) {}
	decision = (): { kind: "authorize" | "hold"; reason?: string } => {
		const active = this.outstanding()
		if (active) {
			this.holdCount_ += 1
			this.holds.push(active)
			return { kind: "hold", reason: active }
		}
		this.authorizeCount_ += 1
		return { kind: "authorize" }
	}
	flush = async (): Promise<void> => {}
	authorizeCount(): number {
		return this.authorizeCount_
	}
	holdCount(): number {
		return this.holdCount_
	}
}
interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string | undefined
	readonly prompt: string
	readonly delivery: "queue"
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	drainTriggers: number[]
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	minter: MessageIdMinter
	notify: BackgroundNotifyCoordinator
	elm: ElmAuthorityHarness
	sessionId: string
	taskId: string
	sendLog: ContinuationSend[]
	phaseWrites: { phase: string; writerId: string }[]
	publishedCount: () => number
	/**
	 * PTLL01-CORR01: the number of publications that occurred AFTER the
	 * canonical C10 commit (`setTurnPhase("completed", ...)`).
	 *
	 * The harness records an ordered event stream: every `setTurnPhase`
	 * write and every `postStateToWebview` publication append to it. The
	 * terminal publication must come strictly after the C10 write — that
	 * temporal relation is the LCV-08 invariant.
	 */
	publicationAfterC10Count: () => number
	completionCommitCount: () => number
	runningJobs: string[]
	/** jobIds the REAL BCB still holds (unconsumed terminal obligations). */
	heldJobIds: () => string[]
	unconsumedCount: () => number
	setActiveSession: (present: boolean) => void
}

function makeHarness(opts: { sessionId?: string; taskId?: string } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = opts.sessionId ?? "ptll01-session"
	const taskId = opts.taskId ?? "ptll01-task"

	const sendLog: ContinuationSend[] = []
	const phaseWrites: { phase: string; writerId: string }[] = []
	const runningJobs: string[] = []
	let publishedCount = 0
	let activeSessionPresent = true
	let completionCommitCount = 0
	let now = 0
	/**
	 * PTLL01-CORR01: the ordered stream of C10 writes and publications.
	 * Index 0 is the first event. A publication is "after the C10" iff the
	 * C10 write appears at a strictly smaller index.
	 */
	const eventOrder: ("c10" | "publication")[] = []

	// Elm holds while a coalesced continuation is still scheduled for this
	// owner — the exact dependency named in the reported holdReasons.
	const elm = new ElmAuthorityHarness(() => (sendLog.length > 0 ? "scheduled_continuation" : undefined))

	// Declared before construction so the drain hook can reach it (the hook
	// only fires on a real drain, which happens after construction).
	let coordinator: SdkSessionEventCoordinator
	/** Every drain-triggered reevaluation, in order. */
	const drainTriggers: number[] = []

	const notify = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId, taskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "rejected" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
		// ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01: the production
		// causal drain trigger, wired exactly as SdkController wires it.
		onOwnedTerminalSetDrained: () => {
			drainTriggers.push(drainTriggers.length)
			void coordinator.reevaluateDeferredCompletionBarrier()
		},
	})

	coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () =>
				activeSessionPresent
					? {
							sessionId,
							sdkHost: {
								send: (input: { sessionId: string; prompt: string; delivery: "queue" }) => {
									sendLog.push({ ...input })
									return Promise.resolve()
								},
								abort: () => Promise.resolve(),
							},
							unsubscribe: vi.fn(),
							startResult: { sessionId },
							isRunning: true,
						}
					: undefined,
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId }) as never,
		getTurnPhase: () => tracker.currentPhase,
		postStateToWebview: vi.fn().mockImplementation(() => {
			publishedCount += 1
			eventOrder.push("publication")
			return Promise.resolve()
		}),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			phaseWrites.push({ phase, writerId: writerId ?? "unknown-legacy-writer" })
			if (phase === "completed") {
				completionCommitCount += 1
				eventOrder.push("c10")
			}
			tracker.setWithWriter(phase as never, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		},
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasRunningBackgroundJobForOwner: () => runningJobs.length > 0,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) =>
			sid === sessionId ? notify.unconsumedTerminalCountForOwner(sessionId, taskId) : 0,
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) =>
			sid === sessionId ? notify.unconsumedOwnedTerminalJobIdsForOwner(sessionId, tid) : [],
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => [...runningJobs],
		// The resumed turn's live tool registry — the capability projection
		// must be truthful (BCB01 bounded correlation guard). A task that
		// still has the closed completion toolset CAN observe held results and
		// retry completion, which is what the production BCB01-C4 chronology
		// requires for the coalesced continuation to be delivered.
		liveTools: () => ["command_status", "submit_and_exit"],
		getElmCompletionAuthorityDecision: () => elm.decision(),
		flushElmAuthorityForSession: elm.flush,
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			sendLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `COALESCED continuation for jobIds=${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		drainTriggers,
		tracker,
		translatorState,
		minter,
		notify,
		elm,
		sessionId,
		taskId,
		sendLog,
		phaseWrites,
		publishedCount: () => publishedCount,
		publicationAfterC10Count: () => {
			const c10Index = eventOrder.indexOf("c10")
			if (c10Index < 0) {
				return 0
			}
			return eventOrder.slice(c10Index + 1).filter((e) => e === "publication").length
		},
		completionCommitCount: () => completionCommitCount,
		runningJobs,
		heldJobIds: () => notify.unconsumedOwnedTerminalJobIdsForOwner(sessionId, taskId),
		unconsumedCount: () => notify.unconsumedTerminalCountForOwner(sessionId, taskId),
		setActiveSession: (present: boolean) => {
			activeSessionPresent = present
		},
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: { sessionId, event: event as never },
	}) as CoreSessionEvent

async function emitSubmitAndExit(h: Harness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.sessionId, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
	)
}

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

/**
 * Deterministic async drain — NOT an arbitrary timing sleep.
 *
 * The completion-continuation path awaits the Continuation Control Elm
 * kernel, which is a `Platform.worker` (its own effect-queue / macrotask).
 * A microtask-only drain (`setImmediate` chained a bounded number of
 * times) can observe the state BEFORE the worker's effect has run, which
 * produced a false RED for BCB01-C4's own delivery assertion. This helper
 * drains both the microtask queue and one macrotask turn, which is exactly
 * the boundary the production `await` crosses.
 *
 * To stay deterministic we poll a caller-supplied PREDICATE rather than
 * sleeping a fixed interval: the wait resolves on the first turn where the
 * predicate is satisfied, with a generous bounded ceiling that fails loudly
 * rather than passing vacuously.
 */
async function drainUntil(predicate: () => boolean, label: string): Promise<void> {
	for (let turn = 0; turn < 50; turn++) {
		if (predicate()) {
			return
		}
		await new Promise((r) => setTimeout(r, 10))
	}
	if (!predicate()) {
		throw new Error(`drainUntil(${label}) did not settle within the bounded ceiling`)
	}
}

/** Five task-owned jobIds, exactly matching the reported incident shape. */
const FIVE_HELD = [
	"cmd_mvcz1k7a5irpcww7",
	"cmd_mvcz934cx36o6oh5",
	"cmd_mvczawjxn8du7rlw",
	"cmd_mvczu3i72jb9sb5g",
	"cmd_mvczv13lozyou9dk",
]

// ===========================================================================
// L1 — COMPLETION liveness
// ===========================================================================

describe("PTLL01 L1 — completion liveness (RED-01 / RED-03)", () => {
	it("RED-01: five held terminal obligations gate C10; draining them via the production observation path eventually commits exactly one C10", async () => {
		const h = makeHarness()
		// Epoch 18 shape: five task-owned background jobs reach terminal.
		for (const jobId of FIVE_HELD) {
			h.runningJobs.push(jobId)
			h.notify.recordNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		expect(h.unconsumedCount()).toBe(5)
		expect(h.heldJobIds()).toHaveLength(5)

		// The model calls submit_and_exit. BCB admission HOLDS: C10 must NOT
		// commit, because owned terminal results remain unconsumed.
		await emitSubmitAndExit(h)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.phaseWrites.map((w) => w.phase)).not.toContain("completed")

		// The jobs themselves are no longer running (they reached terminal
		// state and their terminal snapshots are held).
		h.runningJobs.length = 0

		// The terminal-idle transition re-drives the barrier, which fires the
		// bounded coalesced continuation listing all five held jobIds.
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await drainUntil(() => h.sendLog.length > 0, "continuation-delivered")

		// Drain the REAL BCB obligations through the production Path C
		// observation seam (`consumeNonNotifyTerminalObservation` — the
		// canonical `command_status` caller in command-status-tool.ts),
		// one per held jobId.
		for (const jobId of FIVE_HELD) {
			h.notify.consumeNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		// Conservation verified against the REAL BCB store, not local counters.
		expect(h.unconsumedCount()).toBe(0)
		expect(h.heldJobIds()).toHaveLength(0)

		// The coalesced continuation was delivered exactly once.
		expect(h.sendLog).toHaveLength(1)
		// The scheduled continuation is now drained — Elm's causal dependency
		// is gone. This models the agent consuming the coalesced prompt and
		// reaching its final terminal response.
		h.sendLog.length = 0

		// Final agent_turn_done for this epoch.
		await h.coordinator.notifyAgentTurnDone(h.sessionId)

		// C10 commits exactly once and the terminal phase is published.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.phaseWrites.at(-1)?.phase).toBe("completed")
		// LCV-08 (STRENGTHENED, PTLL01-CORR01): publication FOLLOWS the
		// canonical C10 — not merely "some publication happened".
		//
		// The previous assertion (`publishedCount() > 0`) was satisfied by
		// ANY publication, including ones emitted BEFORE the C10 commit
		// (the barrier's own reevaluation publishes state on the way in).
		// The temporal relation is the invariant that matters: the webview
		// must not be told about the terminal phase before the canonical
		// completion authority committed it.
		//
		// `phaseWrites` and the publication log share one ordered stream in
		// this harness: `setTurnPhase` is the C10 effect and
		// `postStateToWebview` is the publication, so the C10 write MUST
		// appear at an index strictly before the terminal publication.
		const c10Index = h.phaseWrites.findIndex((w) => w.phase === "completed")
		expect(c10Index).toBeGreaterThanOrEqual(0)
		expect(h.publicationAfterC10Count()).toBeGreaterThan(0)
	})

	/**
	 * PTLL01-CORR01 — CORRECTED RED-03.
	 *
	 * The original RED-03 (commit `cb39c81e4`) claimed to reproduce "a
	 * completion that remains stranded without another `agent_turn_done`
	 * after the scheduled continuation clears", but it then CALLED
	 * `notifyAgentTurnDone(...)` — the very production reevaluation entry
	 * point whose ABSENCE is the premise of the defect. The test therefore
	 * supplied the event it claimed was missing, and could not prove the
	 * claimed causal scenario.
	 *
	 * This version removes that call. It is a genuine RED at the `cb39c81e4`
	 * repair: the drain callback fires BEFORE the scheduled continuation
	 * clears, so the Elm authority HOLDs on `scheduled_continuation` and
	 * the deferred marker is re-registered; when the continuation clears
	 * there is no further reevaluation, so C10 is never attempted and the
	 * task strands in `streaming` (the false-Working/Cancel symptom).
	 *
	 * IMPORTANT — what this test does and does NOT prove:
	 *
	 *   - It DOES prove that the PTLL01-L1 drain callback, on its own,
	 *     cannot repair the post-continuation liveness: the callback fires
	 *     while the continuation is still scheduled, so it cannot observe
	 *     the dependency clearing.
	 *
	 *   - It does NOT claim the defect occurs in production. The REAL-ELM
	 *     qualification in
	 *     `post-terminal-lifecycle-liveness01.corr01-real-elm.test.ts`
	 *     establishes the production causal order: the `agent_turn_done`
	 *     that ends the continuation's own turn is the SAME event that
	 *     clears the Elm `scheduled_continuation` hold
	 *     (Authority.elm `handleAgentTurnDone` -> `consumePromptForRun`),
	 *     and it is the SAME event that drives
	 *     `reevaluateDeferredCompletionBarrier` — correctly ordered
	 *     (`flushElmAuthorityForSession` BEFORE the consult). So in
	 *     production the post-continuation reevaluation is supplied by the
	 *     continuation's own turn completion.
	 *
	 *   - The ablated arm of the real-Elm file proves the drain callback is
	 *     NOT the causal repair for the reported chronology.
	 */
	it("RED-03: with the scheduled continuation cleared and NO further agent_turn_done, the completion stays stranded (the drain callback alone cannot repair it)", async () => {
		const h = makeHarness()
		for (const jobId of FIVE_HELD) {
			h.runningJobs.push(jobId)
			h.notify.recordNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		await emitSubmitAndExit(h)
		expect(h.completionCommitCount()).toBe(0)

		// Terminal-idle re-drives the barrier; the BCB01-CORRECTION03/C4
		// trigger fires the bounded coalesced continuation (still held).
		h.runningJobs.length = 0
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		await drainUntil(() => h.sendLog.length > 0, "continuation-delivered")
		expect(h.sendLog.length).toBe(1)

		// The model observes FOUR of the five held jobIds. The held set is
		// still non-empty, so the drain trigger must NOT fire yet — and the
		// TS conservation predicate (not Elm) is what blocks here.
		for (const jobId of FIVE_HELD.slice(0, 4)) {
			h.notify.consumeNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		expect(h.unconsumedCount()).toBe(1)
		expect(h.drainTriggers).toHaveLength(0)
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.elm.holds).toHaveLength(0)

		// The model observes the FIFTH and LAST held jobId. THIS is the causal
		// event: the held set becomes empty and the drain trigger fires. But
		// the coalesced continuation is still scheduled, so the Elm authority
		// — now reachable, because every TS predicate is satisfied — HOLDs on
		// `scheduled_continuation` and re-registers the marker.
		h.notify.consumeNonNotifyTerminalObservation({ jobId: FIVE_HELD[4], sessionId: h.sessionId, taskId: h.taskId })
		expect(h.unconsumedCount()).toBe(0)
		expect(h.drainTriggers).toHaveLength(1)
		await drainUntil(() => h.elm.holds.includes("scheduled_continuation"), "elm-hold-on-scheduled-continuation")
		expect(h.completionCommitCount()).toBe(0)

		// ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01-CORR01):
		// The continuation is consumed by the next turn (its causal dependency
		// clears). NO further `agent_turn_done` and NO background-command-state
		// transition follows — this is precisely the chronology in which the
		// pre-repair task stranded in `streaming` with Working + Cancel
		// offered forever.
		h.sendLog.length = 0

		// THE REPAIR DOES NOT COVER THIS. The drain callback already fired
		// (while the continuation was still scheduled), so the Elm authority
		// HOLDed and the deferred marker was re-registered. Now that the
		// dependency has cleared there is NO further reevaluation, so C10 is
		// never attempted: the task is stranded.
		//
		// This is the assertion that makes RED-03 a REAL RED. The previous
		// version asserted `completionCommitCount() === 1` AFTER calling
		// `notifyAgentTurnDone(...)`, which supplied the missing event and
		// therefore proved nothing about the reported scenario.
		await drainUntil(() => h.elm.holds.length > 0, "elm-hold-settled")
		await new Promise((r) => setTimeout(r, 50))
		expect(h.completionCommitCount()).toBe(0)
		expect(h.phaseWrites.map((w) => w.phase)).not.toContain("completed")
	})

	it("LCV-03: duplicate reevaluations cannot produce duplicate C10", async () => {
		const h = makeHarness()
		await emitSubmitAndExit(h)
		// No obligations → first reevaluate commits.
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.completionCommitCount()).toBe(1)
		// Additional reevaluations are no-ops (marker cleared).
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
		expect(h.phaseWrites.filter((w) => w.phase === "completed")).toHaveLength(1)
	})

	it("LCV-07: Elm AUTHORIZE cannot commit while TS conservation predicates still block", async () => {
		const h = makeHarness()
		// One held obligation that is NEVER drained. The job itself is already
		// terminal (not running), so the ONLY blocking predicate at the
		// authority gate is the held BCB obligation itself.
		h.runningJobs.push("cmd_stuck")
		h.notify.recordNonNotifyTerminalObservation({ jobId: "cmd_stuck", sessionId: h.sessionId, taskId: h.taskId })
		await emitSubmitAndExit(h)
		h.runningJobs.length = 0

		// The BCB obligation is still held, so the barrier MUST hold before
		// the Elm gate is ever consulted. This is the stronger form of the
		// invariant: the TS conservation predicate is an OUTER guard, so no
		// Elm decision (authorize or hold) can produce a commit here.
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.phaseWrites.map((w) => w.phase)).not.toContain("completed")

		// Even after the Elm authority is reachable (obligations drained but
		// the coordinator is asked again), the already-committed C10 count
		// must stay at 0 while the held set is non-empty — proven above.
		// Now prove the complementary half: once Elm AUTHORIZEs and every TS
		// predicate clears, exactly ONE C10 commits.
		h.notify.consumeNonNotifyTerminalObservation({ jobId: "cmd_stuck", sessionId: h.sessionId, taskId: h.taskId })
		expect(h.unconsumedCount()).toBe(0)
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.elm.authorizeCount()).toBeGreaterThan(0)
		expect(h.completionCommitCount()).toBe(1)
	})

	it("LCV-06: Elm HOLD cannot be silently bypassed", async () => {
		const h = makeHarness()
		// Force an Elm hold via a scheduled continuation with no held jobs.
		h.sendLog.push({ sessionId: h.sessionId, prompt: "pending", delivery: "queue" })
		await emitSubmitAndExit(h)
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.elm.holdCount()).toBeGreaterThan(0)
		expect(h.completionCommitCount()).toBe(0)
	})

	it("LCV-04: a prior-epoch marker cannot commit a newer epoch", async () => {
		const h = makeHarness()
		for (const jobId of FIVE_HELD) {
			h.runningJobs.push(jobId)
			h.notify.recordNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		await emitSubmitAndExit(h)
		expect(h.completionCommitCount()).toBe(0)

		// A new turn begins → the epoch advances, superseding the marker.
		h.minter.bumpEpoch()
		for (const jobId of FIVE_HELD) {
			h.notify.consumeNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		h.runningJobs.length = 0
		h.sendLog.length = 0

		// The stale reevaluation must NOT commit the new epoch's completion.
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.completionCommitCount()).toBe(0)
	})

	it("LCV-11: pending-prompt and scheduled-continuation cardinality is conserved", async () => {
		const h = makeHarness()
		for (const jobId of FIVE_HELD) {
			h.runningJobs.push(jobId)
			h.notify.recordNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		}
		await emitSubmitAndExit(h)
		// Repeated reevaluations while obligations are held must not produce
		// unbounded continuations.
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		await h.coordinator.notifyAgentTurnDone(h.sessionId)
		expect(h.sendLog.length).toBeLessThanOrEqual(1)
		expect(h.completionCommitCount()).toBe(0)
	})
})

// ===========================================================================
// L2 — CANCELLATION liveness (RED-04)
// ===========================================================================

/**
 * The REAL production webview action path for Cancel:
 *
 *   ActionButtons (secondaryAction === "cancel", rendered because
 *     `turnState.phase` is "streaming")
 *     → useMessageHandlers.ts:583 `TaskServiceClient.cancelTask(EmptyRequest)`
 *     → gRPC `cancelTask` (src/core/controller/task/cancelTask.ts)
 *     → `controller.cancelTask()`
 *     → `SdkTaskControlCoordinator.cancelTask()`
 *
 * So this is NOT a direct method-call-only test: the branch under test is
 * the same one the shipped UI button reaches.
 */
describe("PTLL01 L2 — cancellation liveness (RED-04)", () => {
	it("RED-04: Cancel with NO active session must reach a supported, published recovery transition — never an indefinite no-op", async () => {
		let publishedCount = 0
		const phaseWrites: { phase: string; writerId: string }[] = []
		let fenceRaised = 0
		let clearPendingCalls = 0
		const minter = new MessageIdMinter()
		// The committed phase the webview is currently showing. The reported
		// incident state is exactly this: `streaming`, so the TaskHeader
		// renders Working + Cancel.
		let currentPhase: TurnPhase = "streaming"

		const coordinator = new SdkTaskControlCoordinator({
			sessions: {
				// The task view still exists (the user sees the task and the
				// Working/Cancel header) but there is NO active SDK session —
				// e.g. the session was replaced/disposed while the committed
				// turn phase still said "streaming".
				getActiveSession: () => undefined,
				endActiveSession: vi.fn().mockResolvedValue(undefined),
				setRunning: vi.fn(),
			} as never,
			interactions: {
				clearPending: () => {
					clearPendingCalls += 1
				},
			} as never,
			messages: { cancelPendingSave: vi.fn() } as never,
			taskHistory: {} as never,
			taskOperationFence: new TaskOperationFence(),
			getTask: () => ({ taskId: "ptll01-task" }) as never,
			setTask: vi.fn(),
			onAskResponse: vi.fn().mockResolvedValue(undefined),
			resetMessageTranslator: () => {
				minter.bumpEpoch()
			},
			postStateToWebview: vi.fn().mockImplementation(() => {
				publishedCount += 1
				return Promise.resolve()
			}),
			clearTaskSettings: vi.fn().mockResolvedValue(undefined),
			setTurnPhase: ((phase: string, _anchorTs: number | undefined, writerId: string | undefined) => {
				phaseWrites.push({ phase, writerId: writerId ?? "unknown-legacy-writer" })
				currentPhase = phase as never
			}) as never,
			getTurnPhase: () => currentPhase,
			raiseCancelFence: () => {
				fenceRaised += 1
				minter.bumpEpoch()
			},
		})

		const epochBefore = minter.epoch
		await coordinator.cancelTask()

		// Contract: pending interactions are ALWAYS cleared (already true).
		expect(clearPendingCalls).toBe(1)

		// The defect: with no abort target, Cancel performs NO lifecycle
		// transition at all — no fence, no phase write, no publication. The
		// committed webview state still says "streaming", so the TaskHeader
		// keeps rendering Working + Cancel, and clicking Cancel again re-enters
		// this exact branch. The task can never leave the false-Working state.
		expect(fenceRaised).toBe(1)
		expect(phaseWrites.map((w) => w.phase)).toContain("resumable")
		expect(minter.epoch).toBeGreaterThan(epochBefore)
		expect(publishedCount).toBe(1)

		// LCV-12: NO additional user prompt may be dispatched merely to make
		// the UI appear idle.
		expect(publishedCount).toBe(1)
	})

	/**
	 * PTLL01-CORR01 — L2 SAFETY CONTRACT for the phase-authority accessor.
	 *
	 * The review flagged that `getTurnPhase` is OPTIONAL on
	 * `SdkTaskControlCoordinatorOptions`. The no-active-session Cancel
	 * branch reads it to decide whether an already-committed terminal
	 * phase must be preserved (LCV-09). If the accessor is absent (or
	 * returns a non-terminal value) while the committed phase IS
	 * terminal, the branch would write `resumable` over it — clobbering
	 * a committed terminal phase.
	 *
	 * In PRODUCTION the accessor is always wired
	 * (`SdkController.ts:2332`: `getTurnPhase: () =>
	 * this.turnStateTracker.currentPhase`), so the absence is a test-only
	 * shape. This test pins the contract:
	 *
	 *   1. With the accessor PRESENT and reporting a terminal phase, Cancel
	 *      MUST NOT write `resumable` (LCV-09 already covers this).
	 *   2. With the accessor ABSENT, the branch has NO phase authority. The
	 *      SAFE behavior is to publish the truthful recovery phase
	 *      (`resumable`) rather than to leave the task in `streaming` —
	 *      i.e. it must NOT skip the transition entirely (the L2 defect)
	 *      and it must NOT invent `completed` (completion authority).
	 */
	it("LCV-13: Cancel with NO phase authority must still make a truthful, bounded transition — never a no-op and never a completion", async () => {
		let publishedCount = 0
		const phaseWrites: { phase: string; writerId: string }[] = []
		const minter = new MessageIdMinter()
		let fenceRaised = 0
		const coordinator = new SdkTaskControlCoordinator({
			sessions: {
				getActiveSession: () => undefined,
				endActiveSession: vi.fn().mockResolvedValue(undefined),
				setRunning: vi.fn(),
			} as never,
			interactions: { clearPending: vi.fn() } as never,
			messages: { cancelPendingSave: vi.fn() } as never,
			taskHistory: {} as never,
			taskOperationFence: new TaskOperationFence(),
			getTask: () => ({ taskId: "ptll01-task" }) as never,
			setTask: vi.fn(),
			onAskResponse: vi.fn().mockResolvedValue(undefined),
			resetMessageTranslator: () => minter.bumpEpoch(),
			postStateToWebview: vi.fn().mockImplementation(() => {
				publishedCount += 1
				return Promise.resolve()
			}),
			clearTaskSettings: vi.fn().mockResolvedValue(undefined),
			setTurnPhase: ((phase: string, _a: number | undefined, writerId: string | undefined) => {
				phaseWrites.push({ phase, writerId: writerId ?? "unknown-legacy-writer" })
			}) as never,
			// `getTurnPhase` is OPTIONAL — omit it entirely to model the
			// "phase authority unavailable" shape.
			raiseCancelFence: () => {
				fenceRaised += 1
				minter.bumpEpoch()
			},
		})

		await coordinator.cancelTask()

		// The transition MUST happen (this is the L2 defect being guarded):
		// fence raised, a phase written, state published.
		expect(fenceRaised).toBe(1)
		expect(phaseWrites).toHaveLength(1)
		expect(publishedCount).toBe(1)

		// The written phase must be the truthful RECOVERY phase — never a
		// completion. `completed` is completion authority and this branch
		// must never claim it.
		expect(phaseWrites[0].phase).toBe("resumable")
		expect(phaseWrites.map((w) => w.phase)).not.toContain("completed")
	})

	it("LCV-09: Cancel cannot clobber an already committed terminal phase", async () => {
		let publishedCount = 0
		const phaseWrites: { phase: string; writerId: string }[] = []
		const minter = new MessageIdMinter()
		let currentPhase: TurnPhase = "streaming"
		const coordinator = new SdkTaskControlCoordinator({
			sessions: {
				getActiveSession: () => undefined,
				endActiveSession: vi.fn().mockResolvedValue(undefined),
				setRunning: vi.fn(),
			} as never,
			interactions: { clearPending: vi.fn() } as never,
			messages: { cancelPendingSave: vi.fn() } as never,
			taskHistory: {} as never,
			taskOperationFence: new TaskOperationFence(),
			getTask: () => ({ taskId: "ptll01-task" }) as never,
			setTask: vi.fn(),
			onAskResponse: vi.fn().mockResolvedValue(undefined),
			resetMessageTranslator: () => minter.bumpEpoch(),
			postStateToWebview: vi.fn().mockImplementation(() => {
				publishedCount += 1
				return Promise.resolve()
			}),
			clearTaskSettings: vi.fn().mockResolvedValue(undefined),
			setTurnPhase: ((phase: string, _a: number | undefined, writerId: string | undefined) => {
				phaseWrites.push({ phase, writerId: writerId ?? "unknown-legacy-writer" })
				currentPhase = phase as never
			}) as never,
			getTurnPhase: () => currentPhase,
			raiseCancelFence: () => minter.bumpEpoch(),
		})

		// The canonical completion already committed `completed`.
		phaseWrites.push({ phase: "completed", writerId: "session-event-turn-complete-completed" })
		currentPhase = "completed"
		await coordinator.cancelTask()

		// Cancel must NOT overwrite `completed` with a non-terminal phase.
		// The committed terminal phase wins (LCV-09).
		expect(phaseWrites.filter((w) => w.phase === "completed")).toHaveLength(1)
		expect(phaseWrites.map((w) => w.phase)).not.toContain("streaming")
		// It still publishes, so the committed state is refreshed truthfully.
		expect(publishedCount).toBe(1)
	})

	it("LCV-10: a Cancel request with an ACTIVE session still fences, aborts and publishes", async () => {
		let publishedCount = 0
		let abortCalls = 0
		let fenceRaised = 0
		const phaseWrites: string[] = []
		const minter = new MessageIdMinter()
		const coordinator = new SdkTaskControlCoordinator({
			sessions: {
				getActiveSession: () =>
					({
						sessionId: "ptll01-session",
						sdkHost: {
							abort: () => {
								abortCalls += 1
								return Promise.resolve()
							},
						},
					}) as never,
				endActiveSession: vi.fn().mockResolvedValue(undefined),
				setRunning: vi.fn(),
			} as never,
			interactions: { clearPending: vi.fn() } as never,
			messages: { cancelPendingSave: vi.fn(), appendAndEmit: vi.fn() } as never,
			taskHistory: {} as never,
			taskOperationFence: new TaskOperationFence(),
			getTask: () => ({ taskId: "ptll01-task", messageStateHandler: { addMessages: vi.fn() } }) as never,
			setTask: vi.fn(),
			onAskResponse: vi.fn().mockResolvedValue(undefined),
			resetMessageTranslator: () => minter.bumpEpoch(),
			postStateToWebview: vi.fn().mockImplementation(() => {
				publishedCount += 1
				return Promise.resolve()
			}),
			clearTaskSettings: vi.fn().mockResolvedValue(undefined),
			setTurnPhase: ((phase: string) => {
				phaseWrites.push(phase)
			}) as never,
			raiseCancelFence: () => {
				fenceRaised += 1
				minter.bumpEpoch()
			},
		})

		await coordinator.cancelTask()
		expect(fenceRaised).toBe(1)
		expect(abortCalls).toBe(1)
		expect(publishedCount).toBe(1)
	})
})
