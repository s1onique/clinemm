/**
 * ACT-CLINEMM-BCB-CAPTURE-ACTIVATION01 — BCBCAP01
 *
 * Bounded executable test gate for the dogfood-profile activation
 * helper for the BCB observation-unavailable capture diagnostic at
 * `apps/vscode/src/shared/bcb-observation-unavailable-capture.ts`.
 *
 * The prior ACT (ACT-CLINEMM-BCB-CAPTURE01) delivered the diagnostic
 * DEFAULT_OFF with a manual operator toggle but no profile-level
 * auto-enable. The live site reproduced that defect: the bounded ring
 * stayed empty in a `dogfood` install. This ACT adds the single
 * production activation helper
 * `applyBcbObservationUnavailableDiagnosticProfile` to
 * `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` and wires it
 * into `extension.ts:activate` BEFORE SdkController construction.
 *
 * The activation helper is the SAME production module that
 * `extension.ts:activate` calls. Per the Factory causal reviewer's
 * P0 #2 finding on the TSWPD test: the prior implementation tested
 * a COPY of the activation logic (synthetic orchestration validating
 * itself), which is the exact Factory failure mode this ACT
 * explicitly rejects. This test exercises the REAL helper.
 *
 * Coverage (mirrors the spec's CAP-A..CAP-E):
 *
 *   CAP-A: Normal mode (no dogfood, no operator toggle) — effective
 *          enabled = false, no capture allocations/records,
 *          unchanged SDK behavior.
 *
 *   CAP-B: Dogfood mode (real `apply...` helper) — effective enabled
 *          = true before the BCB coordinator events; a BCB cycle
 *          produces exactly one capture record.
 *
 *   CAP-C: Dump — from the same runtime instance, dump includes
 *          the captured record; JSONL is valid; writer/task/epoch
 *          correlate exactly; nonempty ring produces a nonempty
 *          file; dump does not clear the ring.
 *
 *   CAP-D: Lifecycle — workspace-toggle precedence; enable/disable
 *          transitions; command invocation; idempotence.
 *
 *   CAP-E: Equivalence — diagnostic OFF vs ON produces identical
 *          SDK state transitions, messages, writer decisions,
 *          and continuation behavior (covered by the existing
 *          BCAPT01 BCAPT-EQUIV describe block; not duplicated here
 *          to keep the existing 26 BCAPT tests passing).
 *
 * The existing 26 BCAPT tests are NOT touched by this file. The
 * intentionally RED L2847 witnesses in
 * `task-terminal-divergence-red01.tdd-red01.test.ts` are NOT
 * touched by this file.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CoreSessionEvent } from "@cline/core"
import {
	clearBcbObservationUnavailableCapture,
	disableBcbObservationUnavailableCapture,
	getBcbObservationUnavailableCaptureRecords,
	isBcbObservationUnavailableCaptureEnabled as isBcbObsCapEnabled,
	recordBcbObservationUnavailableCapture,
} from "@shared/bcb-observation-unavailable-capture"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type BcbObservationUnavailableCaptureContext,
	dumpExtensionSideBcbObservationUnavailableCapture,
} from "../bcb-observation-unavailable-capture-runtime"
import { applyBcbObservationUnavailableDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
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

function makeContext(initialWorkspaceToggle?: boolean): BcbObservationUnavailableCaptureContext & {
	tmpDir: string
	workspaceStateMap: Map<string, unknown>
} {
	const tmpDir = mkdtempSync(join(tmpdir(), "bcbcap01-"))
	const workspaceStateMap = new Map<string, unknown>()
	if (initialWorkspaceToggle !== undefined) {
		workspaceStateMap.set("bcbObsCapEnabled", initialWorkspaceToggle)
	}
	return {
		tmpDir,
		workspaceStateMap,
		workspaceState: {
			get: <T>(key: string): T | undefined => workspaceStateMap.get(key) as T | undefined,
			update: (key: string, value: unknown): Promise<void> => {
				if (value === undefined) {
					workspaceStateMap.delete(key)
				} else {
					workspaceStateMap.set(key, value)
				}
				return Promise.resolve()
			},
		},
		globalStorageUri: { fsPath: tmpDir },
		subscriptions: [],
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

interface BcbcapHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	activeSessionId: string
	activeTaskId: string
	finalPhase: () => string
	allCommittedPhases: () => string[]
	allCommittedWriterIds: () => string[]
	appendAndEmit: ReturnType<typeof vi.fn>
	unconsumedOverride: { value: number }
	unconsumedJobIdsOverride: { value: readonly string[] }
	liveToolsOverride: { value: readonly string[] | undefined }
	getCaptureRecords: () => ReturnType<typeof getBcbObservationUnavailableCaptureRecords>
}

function makeCoordinatorHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): BcbcapHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-bcbcap01"
	const activeTaskId = opts.activeTaskId ?? "task-bcbcap01"

	const appendAndEmit = vi.fn()
	const allCommittedPhases: string[] = []
	const allCommittedWriterIds: string[] = []
	const unconsumedOverride = { value: 0 }
	const unconsumedJobIdsOverride: { value: readonly string[] } = { value: [] }
	const liveToolsOverride: { value: readonly string[] | undefined } = {
		value: ["command_status", "read_files", "run_commands", "submit_and_exit"],
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
		messages: { appendAndEmit: ((msgs: unknown[]) => appendAndEmit(msgs as never)) as never },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, _anchorTs, writerId) => {
			allCommittedPhases.push(phase)
			allCommittedWriterIds.push(String(writerId ?? "unknown-legacy-writer"))
			tracker.setWithWriter(phase, _anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		getElmCompletionAuthorityDecision: () => ({ kind: "hold" as const, reason: "test_default_hold" }),
		flushElmAuthorityForSession: async () => {},
		hasRunningBackgroundJobForOwner: () => false,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) =>
			sid === activeSessionId ? unconsumedOverride.value : 0,
		getUnconsumedOwnedTerminalJobIds: (sid: string) => (sid === activeSessionId ? unconsumedJobIdsOverride.value : []),
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		getLaunchedBackgroundJobIds: () => [],
		liveTools: () => liveToolsOverride.value,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		finalPhase: () => tracker.currentPhase,
		allCommittedPhases: () => allCommittedPhases,
		allCommittedWriterIds: () => allCommittedWriterIds,
		appendAndEmit,
		unconsumedOverride,
		unconsumedJobIdsOverride,
		liveToolsOverride,
		getCaptureRecords: () => getBcbObservationUnavailableCaptureRecords(),
	}
}

async function emitSubmitAndExit(h: BcbcapHarness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(h.activeSessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await h.coordinator.handleSessionEvent(doneEvent)
}

const bcbRec = (sessionId: string, taskId: string) => ({
	sessionId,
	taskId,
	epoch: 0,
	eligibleForCoalescedContinuation: true,
	unconsumedOwnedTerminalResultsForC10: 1,
	ownedTerminalJobIdsForC10: ["j1"] as readonly string[],
	outstandingAutonomousWork: false,
	ownerStillRunningForC10: false,
	heldObligationForC10: true,
	suppressOriginatingCompletion: false,
	liveToolsAvailable: false,
	liveToolsIncludesCommandStatus: false,
	liveToolsCount: 0,
	liveToolsValue: undefined,
	canObserveHeldResults: false,
	sameObligationAlreadyObservationUnavailable: false,
	writerId: "session-event-bcb-blocked-observation-unavailable" as const,
	requestedPhase: "error" as const,
	committedPhase: "error" as const,
})

beforeEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
})

afterEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
})

// =====================================================================
// CAP-A: Normal mode (no dogfood, no operator toggle)
// =====================================================================

describe("CAP-A: Normal mode (no dogfood, no operator toggle)", () => {
	it("CAP-A.1: dogfood=false + workspaceState undefined -> effective enabled=false, source=profile-off", () => {
		const ctx = makeContext()
		const r = applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(r.enabled).toBe(false)
		expect(r.flipped).toBe(false)
		expect(r.source).toBe("profile-off")
		expect(isBcbObsCapEnabled()).toBe(false)
	})

	it("CAP-A.2: when DISABLED, recordBcbObservationUnavailableCapture is a complete no-op (no allocations/records)", () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(isBcbObsCapEnabled()).toBe(false)
		// Call the REAL producer; it MUST no-op.
		recordBcbObservationUnavailableCapture(bcbRec("s1", "t1"))
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
	})

	it("CAP-A.3: when DISABLED, the SdkSessionEventCoordinator BCB path produces no capture record", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		const h = makeCoordinatorHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["bcbcap-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"] // no command_status
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getCaptureRecords()).toHaveLength(0)
	})

	it("CAP-A.4: SDK behavior is unchanged when DISABLED (phase + writer fired, capture is read-only)", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		const h = makeCoordinatorHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["bcbcap-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		await emitSubmitAndExit(h)
		// The DISABLED state MUST observe the BCB writer firing
		// (capture is read-only and does NOT affect the writer).
		expect(h.finalPhase()).toBe("error")
		expect(h.allCommittedWriterIds()).toContain("session-event-bcb-blocked-observation-unavailable")
	})
})

// =====================================================================
// CAP-B: Dogfood mode (real apply... helper)
// =====================================================================

describe("CAP-B: Dogfood mode (real apply... helper)", () => {
	it("CAP-B.1: dogfood=true + workspaceState undefined -> effective enabled=true, source=profile-on", () => {
		const ctx = makeContext()
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(true)
		expect(r.flipped).toBe(true)
		expect(r.source).toBe("profile-on")
		expect(isBcbObsCapEnabled()).toBe(true)
	})

	it("CAP-B.2: after dogfood profile arms the ring, a BCB cycle produces exactly one capture record", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		const h = makeCoordinatorHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["bcbcap-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"] // no command_status
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		expect(records[0]!.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(records[0]!.sessionId).toBe(h.activeSessionId)
		expect(records[0]!.taskId).toBe(h.activeTaskId)
	})

	it("CAP-B.3: dogfood arming precedes the first BCB writer (capture ring armed BEFORE the first SdkController BCB cycle)", async () => {
		const ctx = makeContext()
		// The activation happens BEFORE SdkController construction in
		// the real extension.ts. The test mirrors that order: apply
		// first, then exercise the BCB path.
		const activationResult = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(activationResult.enabled).toBe(true)
		const h = makeCoordinatorHarness()
		// Right after construction (no submit_and_exit yet), the
		// capture MUST already be enabled.
		expect(isBcbObsCapEnabled()).toBe(true)
		expect(h.getCaptureRecords()).toHaveLength(0)
		// Now exercise the BCB path; the capture MUST record.
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["bcbcap-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getCaptureRecords()).toHaveLength(1)
	})
})

// =====================================================================
// CAP-C: Dump (real production dump runtime)
// =====================================================================

describe("CAP-C: Dump (real production dump runtime)", () => {
	it("CAP-C.1: dogfood-on -> record -> dump -> JSONL contains the record", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		const h = makeCoordinatorHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["bcbcap-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getCaptureRecords()).toHaveLength(1)
		const file = await dumpExtensionSideBcbObservationUnavailableCapture(ctx)
		expect(file).toBe(join(ctx.tmpDir, "bcb-observation-unavailable-capture.jsonl"))
		const text = readFileSync(file, "utf8")
		const lines = text.split("\n").filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0]!)
		expect(parsed.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(parsed.sessionId).toBe(h.activeSessionId)
		expect(parsed.taskId).toBe(h.activeTaskId)
		rmSync(ctx.tmpDir, { recursive: true, force: true })
	})

	it("CAP-C.2: dogfood-on -> NO records -> dump -> empty file (0 bytes), ring NOT cleared", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(isBcbObsCapEnabled()).toBe(true)
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
		const file = await dumpExtensionSideBcbObservationUnavailableCapture(ctx)
		expect(file).toBe(join(ctx.tmpDir, "bcb-observation-unavailable-capture.jsonl"))
		const text = readFileSync(file, "utf8")
		expect(text).toBe("")
		expect(existsSync(file)).toBe(true)
		// Dump MUST NOT clear the ring.
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
		rmSync(ctx.tmpDir, { recursive: true, force: true })
	})

	it("CAP-C.3: dogfood-on -> record -> dump -> dump again -> second dump also includes the record (idempotent)", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		recordBcbObservationUnavailableCapture(bcbRec("s-idem", "t-idem"))
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(1)
		const file1 = await dumpExtensionSideBcbObservationUnavailableCapture(ctx)
		const file2 = await dumpExtensionSideBcbObservationUnavailableCapture(ctx)
		const t1 = readFileSync(file1, "utf8")
		const t2 = readFileSync(file2, "utf8")
		expect(t1).toBe(t2)
		expect(t1.split("\n").filter((l) => l.length > 0)).toHaveLength(1)
		rmSync(ctx.tmpDir, { recursive: true, force: true })
	})

	it("CAP-C.4: producer/recorder is the SAME instance read by the dump (identity proven via shared helper)", () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		recordBcbObservationUnavailableCapture(bcbRec("s-id", "t-id"))
		const sameInstance = getBcbObservationUnavailableCaptureRecords()
		expect(sameInstance).toHaveLength(1)
		expect(sameInstance[0]!.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
	})
})

// =====================================================================
// CAP-D: Lifecycle
// =====================================================================

describe("CAP-D: Lifecycle", () => {
	it("CAP-D.1: workspace toggle = true wins over dogfood=false (operator explicit ON)", () => {
		const ctx = makeContext(true)
		const r = applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(r.enabled).toBe(true)
		expect(r.source).toBe("workspace-on")
		expect(isBcbObsCapEnabled()).toBe(true)
	})

	it("CAP-D.2: workspace toggle = true wins over dogfood=true (operator explicit ON, source=workspace-on)", () => {
		const ctx = makeContext(true)
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(true)
		expect(r.source).toBe("workspace-on")
	})

	it("CAP-D.3: workspace toggle = false wins over dogfood=true (operator explicit OFF, source=workspace-off)", () => {
		const ctx = makeContext(false)
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("workspace-off")
		expect(isBcbObsCapEnabled()).toBe(false)
	})

	it("CAP-D.4: workspace toggle = false wins over dogfood=false (operator explicit OFF)", () => {
		const ctx = makeContext(false)
		const r = applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("workspace-off")
	})

	it("CAP-D.5: workspace toggle undefined + dogfood=true -> source=profile-on (the live-site defect scenario)", () => {
		const ctx = makeContext() // no toggle set
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(true)
		expect(r.source).toBe("profile-on")
	})

	it("CAP-D.6: workspace toggle undefined + dogfood=false -> source=profile-off (the public default)", () => {
		const ctx = makeContext()
		const r = applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("profile-off")
	})

	it("CAP-D.7: idempotence — repeated apply call with same args does not flip", () => {
		const ctx = makeContext()
		const r1 = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		const r2 = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r1.flipped).toBe(true)
		expect(r2.flipped).toBe(false)
		expect(r2.enabled).toBe(true)
	})

	it("CAP-D.8: dogfood=true -> dogfood=false flips ON seam to OFF (no workspace toggle)", () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(isBcbObsCapEnabled()).toBe(true)
		const r = applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(r.enabled).toBe(false)
		expect(r.flipped).toBe(true)
		expect(r.source).toBe("profile-off")
		expect(isBcbObsCapEnabled()).toBe(false)
	})

	it("CAP-D.9: dogfood=false -> dogfood=true flips OFF seam to ON (no workspace toggle)", () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(isBcbObsCapEnabled()).toBe(false)
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(true)
		expect(r.flipped).toBe(true)
		expect(r.source).toBe("profile-on")
		expect(isBcbObsCapEnabled()).toBe(true)
	})

	it("CAP-D.10: workspace toggle = false is honored even after a dogfood=true cycle (researcher who disabled it is not silently re-enabled)", () => {
		const ctx = makeContext(false)
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(isBcbObsCapEnabled()).toBe(false)
		// Simulate a fresh launch with the same disabled workspace state.
		disableBcbObservationUnavailableCapture()
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(false)
		expect(r.source).toBe("workspace-off")
	})

	it("CAP-D.11: activation helper does NOT clear the ring on disable (records remain dumpable)", async () => {
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		recordBcbObservationUnavailableCapture(bcbRec("s-dis", "t-dis"))
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(1)
		// Now disable via re-apply with dogfood=false (no workspace toggle).
		applyBcbObservationUnavailableDiagnosticProfile(false, ctx)
		expect(isBcbObsCapEnabled()).toBe(false)
		// The pre-disable record MUST still be in the ring.
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(1)
		// The dump is unconditional — it MUST still serialize the record.
		const file = await dumpExtensionSideBcbObservationUnavailableCapture(ctx)
		const lines = readFileSync(file, "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
		rmSync(ctx.tmpDir, { recursive: true, force: true })
	})

	it("CAP-D.12: workspace-state helper structural type accepts a vscode.ExtensionContext (static shape check)", () => {
		const widerShapeLike: BcbObservationUnavailableCaptureContext = {
			workspaceState: {
				get: <T>(_key: string): T | undefined => undefined as T | undefined,
				update: async (_key: string, _value: unknown): Promise<void> => {},
			},
			globalStorageUri: { fsPath: "/tmp/x" },
			subscriptions: [],
		}
		// No assertion needed beyond the type assignment itself
		// being accepted; the test fails at compile time if the
		// production shape is wrong.
		expect(typeof widerShapeLike.workspaceState.get).toBe("function")
	})

	it("CAP-D.13: extension-host restart boundary — activation is process-local; the ring does not persist across restarts (volatile by design)", () => {
		// No persistence guarantee is made for the process-local ring.
		// The ring is in-memory only; the dump is the only durable
		// artifact. After a host restart, the ring is empty and the
		// activation helper runs fresh from workspace state. This
		// test pins that contract: a "fresh" helper invocation
		// against a clean module-level buffer sees zero records,
		// and the helper re-arms the seam when the workspace state
		// is "undefined" + dogfood=true.
		const ctx = makeContext()
		applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		// Simulate process restart by clearing the module-level ring.
		clearBcbObservationUnavailableCapture()
		disableBcbObservationUnavailableCapture() // also reset the module-level enable flag
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
		expect(isBcbObsCapEnabled()).toBe(false)
		// The activation is re-derivable; the helper stays
		// idempotent across the simulated restart.
		const r = applyBcbObservationUnavailableDiagnosticProfile(true, ctx)
		expect(r.enabled).toBe(true)
		expect(r.flipped).toBe(true)
	})
})
