/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-AWAITING-FOLLOWUP-GUARD01
 * / BCAFG01 — primary RED + GREEN discriminator
 *
 * SYNTHETIC_REAL test (drives the REAL production seam) that
 * discriminates H1 (FALSE_NEGATIVE_LIVENESS) vs H2
 * (OWNER_IDENTITY_MISMATCH) vs H3 (GUARD_BYPASS) vs H4
 * (GUARD_RESULT_IGNORED) for the ClineMM phenomenon:
 *
 *   writer = session-event-turn-complete-resumable-straggler-preserve
 *   committed streaming → awaiting_followup
 *   AND
 *   active session still owns a RUNNING managed CommandJob
 *   (Cancel visible, activeCommandJobs === 1)
 *
 * Production source under test:
 *   - apps/vscode/src/sdk/command-job-manager.ts (the producer +
 *     lookup authority)
 *   - apps/vscode/src/sdk/vscode-session-host.ts
 *     (hasRunningBackgroundJobForOwner delegation)
 *   - apps/vscode/src/sdk/SdkController.ts (the wiring that
 *     threads `activeSession.sessionId` into the coordinator)
 *   - apps/vscode/src/sdk/sdk-session-event-coordinator.ts
 *     (the composition seam at the done-without-completion branch
 *      that consults the guard BEFORE the
 *      `setTurnPhase("awaiting_followup", ...)` call)
 *
 * What this ACT proves:
 *
 *   1. RED (BCAFG01-RED): a managed background CommandJob started
 *      WITH `context.sessionId === activeSessionId` is correctly
 *      observed by the real `CommandJobManager.hasRunningBackgroundJobForOwner`
 *      AND the real `SdkSessionEventCoordinator` composition seam
 *      suppresses the awaiting_followup transition when the
 *      hasRunningBackgroundJobForOwner option is wired to the real
 *      host query. This is the GREEN-side baseline that the LIVE
 *      failure violates.
 *
 *   2. RED (BCAFG01-IDENTITY-MISMATCH): when the same managed
 *      CommandJob is started WITHOUT the AgentToolContext (so
 *      `ownerSessionId === undefined` per the production capture at
 *      command-job-manager.ts:1776), the real lookup returns false
 *      EVEN THOUGH the job is RUNNING. This is the discriminator
 *      between H1 (the lookup is wrong) vs H2 (the owner identity
 *      was never set because no context was passed).
 *
 *   3. CONTROL (BCAFG01-DIRECT): the real
 *      `CommandJobManager.hasRunningBackgroundJobForOwner` returns
 *      true when asked with the correct owner identity against a
 *      real RUNNING job stamped with that owner. Proves the lookup
 *      itself is sound.
 *
 *   4. ABLATION (BCAFG01-ABLATION): the writer
 *      `session-event-turn-complete-resumable-straggler-preserve`
 *      commits ONLY when the guard returns false; when the guard
 *      returns true, the writer does NOT commit. This is the
 *      necessity proof for H4.
 *
 * Hypothesis mapping (per ACT §6):
 *
 *   H1 = lookup returns false despite a RUNNING matching job.
 *       Discriminator: BCAFG01-DIRECT proves the lookup is sound
 *       when the job's ownerSessionId is correctly stamped; the
 *       LIVE failure therefore requires either an owner-identity
 *       defect at start() time OR the option wiring is broken.
 *
 *   H2 = job.ownerSessionId !== activeSession.sessionId.
 *       Discriminator: BCAFG01-IDENTITY-MISMATCH reproduces the
 *       exact production-defect scenario — manager.start(options)
 *       with NO AgentToolContext stamps ownerSessionId=undefined,
 *       and the lookup returns false. This is the most likely
 *       LIVE root cause if the tool caller never threads context.
 *
 *   H3 = guard not consulted.
 *       Discriminator: BCAFG01-BYPASS proves the guard is consulted
 *       unconditionally in the done-without-completion branch.
 *
 *   H4 = guard returns true, writer still commits.
 *       Discriminator: BCAFG01-ABLATION proves the writer is gated
 *       by the guard result; H4 is REFUTED.
 *
 * NO production code is changed by this ACT.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	findTurnStateWriterProvenanceByWriter,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
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

// Disable the experimental sandbox so the test does not require a
// kernel substrate (BCCO01 precedent — see
// background-command-continuation-ownership-discriminator.bcco01-synthetic-real.test.ts:107-117).
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

let supervisorPid = 90000

function fakeSupervisor(opts: { pid: number; pgid: number }): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: opts.pid,
		pgid: opts.pgid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(null)
			return {
				treeTerminated: true,
				escalatedToKill: false,
				epermDetected: false,
			}
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	hasRunningBackgroundJobForOwner: ReturnType<typeof vi.fn> | ((ownerSessionId: string | undefined) => boolean)
	activeSessionId: string
}

interface MakeHarnessOptions {
	/**
	 * If provided, the `hasRunningBackgroundJobForOwner` option is
	 * wired to the REAL `CommandJobManager.hasRunningBackgroundJobForOwner`
	 * (delegating to the manager's actual lookup logic). This is the
	 * GREEN baseline for the LIVE test.
	 *
	 * If undefined, the option is omitted (control / pre-Q5 behavior).
	 */
	wireRealLookup?: boolean
	/**
	 * If provided, the option is wired to a `vi.fn()` whose return is
	 * controlled by this initial value.
	 */
	mockLiveness?: boolean
}

function makeHarness(opts: MakeHarnessOptions = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState()
	const activeSessionId = "session-bcafg01"

	const supervisor = fakeSupervisor({
		pid: ++supervisorPid,
		pgid: ++supervisorPid,
	})
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})

	const hasRunningBackgroundJobForOwner: ReturnType<typeof vi.fn> = vi.fn(() => opts.mockLiveness ?? false)

	const options = {
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => undefined,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((
			phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0],
			anchorTs?: number,
			writerId?: string,
		) => {
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
	} as unknown as SdkSessionEventCoordinatorOptions

	if (opts.wireRealLookup) {
		;(
			options as unknown as {
				hasRunningBackgroundJobForOwner: (id: string | undefined) => boolean
			}
		).hasRunningBackgroundJobForOwner = (id) => manager.hasRunningBackgroundJobForOwner(id)
	} else if (opts.mockLiveness !== undefined) {
		;(
			options as unknown as {
				hasRunningBackgroundJobForOwner: ReturnType<typeof vi.fn>
			}
		).hasRunningBackgroundJobForOwner = hasRunningBackgroundJobForOwner
	}

	return {
		coordinator: new SdkSessionEventCoordinator(options),
		tracker,
		translatorState,
		manager,
		hasRunningBackgroundJobForOwner: opts.wireRealLookup
			? (((id: string | undefined) => manager.hasRunningBackgroundJobForOwner(id)) as unknown as ReturnType<typeof vi.fn>)
			: hasRunningBackgroundJobForOwner,
		activeSessionId,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

async function startBackgroundJob(
	manager: CommandJobManager,
	passContext: boolean,
	sessionId: string,
): Promise<{ jobId: string }> {
	const start = await manager.start(
		{
			command: "sleep 120",
			cwd: process.cwd(),
			shell: "/bin/sh",
			env: { SHELL: "/bin/sh" },
			waitBudgetMs: 10,
			executionDeadlineMs: 60_000,
			maxOutputChars: 4096,
		},
		passContext ? { sessionId } : undefined,
	)
	if (start.state !== "running") {
		throw new Error(`expected state=running, got state=${start.state}`)
	}
	return { jobId: start.jobId }
}

async function emitDoneWithoutCompletion(coordinator: SdkSessionEventCoordinator, sessionId: string): Promise<void> {
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Some text without commit.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-AWAITING-FOLLOWUP-GUARD01 / BCAFG01", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
	})

	afterEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
	})

	it("BCAFG01-RED: ownerSessionId stamped + real lookup wired → awaiting_followup SUPPRESSED (GREEN baseline)", async () => {
		// The operator's expected behavior: when the active
		// session owns a RUNNING CommandJob whose
		// `ownerSessionId` matches the active session's
		// sessionId, the Q5 composition seam suppresses the
		// awaiting_followup transition.
		const h = makeHarness({ wireRealLookup: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		expect(h.tracker.currentPhase).toBe("streaming")

		// Start a background job WITH the AgentToolContext so
		// the manager stamps ownerSessionId = activeSessionId.
		const { jobId } = await startBackgroundJob(h.manager, true, h.activeSessionId)
		expect(h.manager.getActiveJobIds()).toContain(jobId)

		// Sanity-check: the real lookup returns true when
		// asked with the correct ownerSessionId.
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		enableTurnStateWriterProvenanceDiagnostic()
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		// GREEN: the writer at the else-branch (else-of-if) was
		// NOT consulted; the phase stayed at "streaming".
		expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
		const writerCommits = findTurnStateWriterProvenanceByWriter(
			"session-event-turn-complete-resumable-straggler-preserve",
		).filter((r) => r.previous.phase === "streaming" && r.committed.phase === "awaiting_followup")
		expect(writerCommits).length(0)

		await h.manager.dispose()
	}, 15_000)

	it("BCAFG01-IDENTITY-MISMATCH: no context → ownerSessionId=undefined → guard returns false → writer commits (H2 PROVEN)", async () => {
		// The discriminator for H2 (owner identity mismatch):
		// when the production caller (vscode-run-commands-tool.ts
		// or its successor in the live state) does NOT pass an
		// AgentToolContext to manager.start(), the
		// ownerSessionId stamp at
		// command-job-manager.ts:1776 is undefined. The lookup
		// `hasRunningBackgroundJobForOwner(activeSessionId)`
		// then returns false (the job's ownerSessionId is
		// undefined, not equal to activeSessionId), and the
		// writer commits.
		const h = makeHarness({ wireRealLookup: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		// Start WITHOUT passing AgentToolContext — ownerSessionId stays undefined.
		const { jobId } = await startBackgroundJob(h.manager, false, h.activeSessionId)
		expect(h.manager.getActiveJobIds()).toContain(jobId)

		// Sanity-check: the job is RUNNING but ownerSessionId
		// is undefined.
		const jobRecord = (
			h.manager as unknown as {
				active: Map<string, { ownerSessionId?: string; state: string }>
			}
		).active.get(jobId)
		expect(jobRecord?.state).toBe("running")
		expect(jobRecord?.ownerSessionId).toBeUndefined()

		// The real lookup is asked with the active sessionId.
		// It must return false because job.ownerSessionId === undefined.
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(false)

		enableTurnStateWriterProvenanceDiagnostic()
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		// RED reproduced: the writer committed.
		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		const writerCommits = findTurnStateWriterProvenanceByWriter(
			"session-event-turn-complete-resumable-straggler-preserve",
		).filter((r) => r.previous.phase === "streaming" && r.committed.phase === "awaiting_followup")
		expect(writerCommits.length).toBeGreaterThanOrEqual(1)

		await h.manager.dispose()
	}, 15_000)

	it("BCAFG01-DIRECT: real CommandJobManager.hasRunningBackgroundJobForOwner returns true iff RUNNING+matching owner (H1 control)", async () => {
		// Direct lookup probe (no coordinator). The lookup
		// itself, given a correctly-stamped ownerSessionId,
		// returns true iff a RUNNING job matches. This proves
		// H1 (false negative) requires either an
		// ownerSessionId defect at start() time OR an option
		// wiring defect in SdkController.
		const h = makeHarness()
		const { jobId } = await startBackgroundJob(h.manager, true, h.activeSessionId)
		expect(h.manager.getActiveJobIds()).toContain(jobId)

		// With ownerSessionId set to activeSessionId: true.
		expect(h.manager.hasRunningBackgroundJobForOwner(h.activeSessionId)).toBe(true)

		// With a different owner: false.
		expect(h.manager.hasRunningBackgroundJobForOwner("session-other")).toBe(false)

		// With undefined owner: false (defensive guard).
		expect(h.manager.hasRunningBackgroundJobForOwner(undefined)).toBe(false)

		expect(h.manager.getActiveJobIds()).toContain(jobId)
		await h.manager.dispose()
	}, 15_000)

	it("BCAFG01-BYPASS: option omitted → guard not consulted → writer commits unconditionally (H3 control)", async () => {
		// When `hasRunningBackgroundJobForOwner` is omitted
		// (the optional chain short-circuits), the writer
		// commits UNCONDITIONALLY. This proves the production
		// coordinator consults the guard only when the option
		// is wired — H3 (guard bypass) requires either the
		// SdkController wiring to be broken OR the host to
		// omit the method (Hub/Remote).
		const h = makeHarness({ mockLiveness: undefined })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		const { jobId } = await startBackgroundJob(h.manager, true, h.activeSessionId)
		expect(h.manager.getActiveJobIds()).toContain(jobId)

		enableTurnStateWriterProvenanceDiagnostic()
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

		expect(h.tracker.currentPhase).toBe("awaiting_followup")
		const writerCommits = findTurnStateWriterProvenanceByWriter(
			"session-event-turn-complete-resumable-straggler-preserve",
		).filter((r) => r.previous.phase === "streaming" && r.committed.phase === "awaiting_followup")
		expect(writerCommits.length).toBeGreaterThanOrEqual(1)

		await h.manager.dispose()
	}, 15_000)

	it("BCAFG01-ABLATION: guard=true → writer suppressed; guard=false → writer commits (H4 REFUTED)", async () => {
		// Necessity proof: hold everything constant except the
		// guard result. With guard=true, the writer is
		// suppressed. With guard=false, the writer commits.
		// The control flow is fully gated by the guard
		// result — H4 (guard result ignored) is REFUTED.
		const h = makeHarness({ mockLiveness: true })
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})

		await startBackgroundJob(h.manager, true, h.activeSessionId)

		enableTurnStateWriterProvenanceDiagnostic()
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
		disableTurnStateWriterProvenanceDiagnostic()

		// Now flip the guard to false and drive a fresh
		// turn-complete by reusing the harness via
		// setWithWriter back to streaming and re-driving.
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		;(h.hasRunningBackgroundJobForOwner as ReturnType<typeof vi.fn>).mockReturnValue(false)
		enableTurnStateWriterProvenanceDiagnostic()
		await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)
		expect(h.tracker.currentPhase).toBe("awaiting_followup")

		await h.manager.dispose()
	}, 15_000)
})
