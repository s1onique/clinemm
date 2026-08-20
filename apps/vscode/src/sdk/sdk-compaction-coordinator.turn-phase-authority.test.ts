// ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01
//
// RED/GREEN at the REAL production seam for the observed LIVE_UI
// contradiction:
//
//     main chat surface : "Compacting context"      (CompactionRow)
//     TaskHeader        : "Waiting"                 (stateLabel)
//
// Both ends of this test are production code:
//
//   producer   — the real `SdkCompactionCoordinator` + the real
//                `TurnStateTracker` (+ real `MessageIdMinter`)
//   projection — the real webview `stateLabel` projection from
//                `taskHeaderTelemetryHelpers`
//
// The phase is sampled AT THE MOMENT the production coordinator emits
// the `status: "started"` compaction divider — i.e. exactly the instant
// the screenshot captured. No constant-only assertion, no UI text
// heuristic, no re-implementation of either side.

import { createContextCompactionPrepareTurn } from "@cline/core"
import type { ClineCompactionInfo, ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
// Real webview projection under test (imported as production source, not copied).
import { stateLabel } from "../../webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers"
import { MessageIdMinter } from "./message-id-minter"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "./sdk-compaction-coordinator"
import { TurnStateTracker } from "./turn-state-tracker"

vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: vi.fn(),
	createSessionCompactionState: vi.fn((input: { compactedMessages: unknown[] }) => ({
		version: 1,
		messages: input.compactedMessages,
	})),
}))

const mockCreateContextCompactionPrepareTurn = createContextCompactionPrepareTurn as unknown as ReturnType<typeof vi.fn>

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

describe("ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01 / compaction owns the canonical turn phase", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("CSA01: while the 'started' divider is visible the canonical phase is NOT a human-wait phase", async () => {
		// A finished turn that asked a follow-up question — the phase the
		// live repro was sitting in when the user pressed Compact.
		const { coordinator, phaseWhenCompactionStarted } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		// The divider was actually emitted (the seam really ran).
		expect(phaseWhenCompactionStarted()).toBeDefined()
		// Canonical authority during active compaction must not be a
		// human-wait phase.
		expect(phaseWhenCompactionStarted()).not.toBe("awaiting_followup")
	})

	it("CSA02: TaskHeader must not render 'Waiting' while compaction is active", async () => {
		const { coordinator, phaseWhenCompactionStarted } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const projected = stateLabel(phaseWhenCompactionStarted())
		expect(projected.label).not.toBe("Waiting")
		expect(projected.label).toBe("Compacting")
		// Active system work keeps the elapsed clock ticking.
		expect(projected.live).toBe(true)
	})

	it("CSA03: a compaction that started from a completed task is also not 'Waiting'", async () => {
		const { coordinator, phaseWhenCompactionStarted } = makeHarness({ entryPhase: "completed" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(stateLabel(phaseWhenCompactionStarted()).label).toBe("Compacting")
	})

	it("CSA04: the entry phase (and its anchor) is restored after a successful compaction", async () => {
		const { coordinator, tracker } = makeHarness({ entryPhase: "awaiting_followup", entryAnchorTs: 4242 })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(tracker.get().phase).toBe("awaiting_followup")
		expect(tracker.get().anchorTs).toBe(4242)
	})

	it("CSA05: the entry phase is restored when compaction fails", async () => {
		const { coordinator, tracker } = makeHarness({ entryPhase: "awaiting_followup", entryAnchorTs: 99 })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask()

		expect(tracker.get().phase).toBe("awaiting_followup")
		expect(tracker.get().anchorTs).toBe(99)
	})

	it("CSA06: the strategy declining to compact still restores the entry phase", async () => {
		const { coordinator, tracker, phaseWhenCompactionStarted } = makeHarness({ entryPhase: "completed" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockResolvedValue(undefined))

		await coordinator.compactTask()

		expect(phaseWhenCompactionStarted()).not.toBe("completed")
		expect(tracker.get().phase).toBe("completed")
	})

	it("CSA07 (conservation): a genuine human wait with no compaction still reads 'Waiting'", () => {
		expect(stateLabel("awaiting_followup").label).toBe("Waiting")
	})

	it("CSA08 (conservation): model/tool work and approvals are unchanged", () => {
		expect(stateLabel("streaming").label).toBe("Working")
		expect(stateLabel("awaiting_approval").label).toBe("Approval")
		expect(stateLabel("completed").label).toBe("Complete")
		expect(stateLabel("idle").label).toBe("Idle")
	})

	it("CSA09: every 'started' divider is paired with a canonical compacting phase (single authority)", async () => {
		const { coordinator, options, phaseWhenCompactionStarted } = makeHarness({ entryPhase: "awaiting_followup" })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const started = compactionRows(options).filter((row) => row.info.status === "started")
		expect(started).toHaveLength(1)
		expect(phaseWhenCompactionStarted()).toBe("compacting")
	})
})

/** Collect all say:"compaction" rows emitted through appendAndEmit, in order. */
function compactionRows(options: { messages: { appendAndEmit: ReturnType<typeof vi.fn> } }) {
	return options.messages.appendAndEmit.mock.calls
		.flatMap((call) => call[0] as ClineMessage[])
		.filter((message) => message.say === "compaction")
		.map((message) => ({ ts: message.ts, info: JSON.parse(message.text ?? "{}") as ClineCompactionInfo }))
}

function makeSessionHost() {
	return {
		start: vi.fn().mockResolvedValue({ sessionId: "old-session" }),
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
		send: vi.fn(),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

function makeHarness(input: { entryPhase: TurnPhase; entryAnchorTs?: number }) {
	const tracker = new TurnStateTracker(new MessageIdMinter())
	tracker.set(input.entryPhase, input.entryAnchorTs)

	// Sampled synchronously inside the production emit path, at the exact
	// instant the "Compacting context" divider becomes visible.
	let sampledPhase: TurnPhase | undefined

	const sessionHost = makeSessionHost()
	const activeSession = {
		sessionId: "old-session",
		sdkHost: sessionHost,
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: false,
	}

	const options = {
		stateManager: { getGlobalSettingsKey: vi.fn(() => "act") } as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			startNewSession: vi.fn(),
			setRunning: vi.fn(),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			waitForPendingStop: vi.fn().mockResolvedValue(undefined),
		},
		rebuilds: { runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()) },
		messages: {
			appendAndEmit: vi.fn((messages: ClineMessage[]) => {
				for (const message of messages) {
					if (message.say !== "compaction") {
						continue
					}
					const info = JSON.parse(message.text ?? "{}") as ClineCompactionInfo
					if (info.status === "started") {
						sampledPhase = tracker.currentPhase
					}
				}
			}),
		},
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({
				providerConfig: { providerId: "anthropic", modelId: "claude" },
				providerId: "anthropic",
				modelId: "claude",
				knownModels: undefined,
				compaction: undefined,
				logger: undefined,
				telemetry: undefined,
			}),
		},
		getDisplayedTaskId: vi.fn(() => "old-session"),
		createTempSessionHost: vi.fn().mockResolvedValue(sessionHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		// The canonical turn-phase authority, wired exactly as SdkController wires it.
		getTurnState: () => tracker.get(),
		setTurnPhase: (phase: TurnPhase, anchorTs?: number) => tracker.set(phase, anchorTs),
	} as unknown as SdkCompactionCoordinatorOptions & {
		messages: { appendAndEmit: ReturnType<typeof vi.fn> }
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
		tracker,
		phaseWhenCompactionStarted: () => sampledPhase,
	}
}
