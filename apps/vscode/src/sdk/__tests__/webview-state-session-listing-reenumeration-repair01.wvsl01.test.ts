/**
 * ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01
 *
 * Focused test suite for the webview-state-projection session-list
 * re-enumeration repair.
 *
 * Load-bearing invariant under repair (per ACT §2):
 *
 *     WEBVIEW STATE PROJECTION MUST NOT RE-ENUMERATE THE ENTIRE
 *     SESSION HISTORY UNLESS THE SESSION-LIST PROJECTION HAS
 *     ACTUALLY BECOME STALE.
 *
 * The repair target is the cache contract on
 * `SdkTaskHistory.metadataHistoryCache`. Per ACT §10:
 *
 *     fresh if (cache exists) AND (within safety TTL)
 *
 * Mutation authority remains the existing 5 invalidation call sites
 * (dispose, update-write-failed, updateCachedSessionRecord on
 * index === -1, deleteSession, cacheTaskSize) and the in-place
 * patch path on updateCachedSessionRecord on index >= 0.
 */

import type { SessionHistoryRecord } from "@cline/core"
import type { HistoryItem } from "@shared/HistoryItem"
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import type { McpHub } from "@/services/mcp/McpHub"
import type { TelemetryService } from "@/services/telemetry/TelemetryService"
import { SdkTaskHistory } from "../sdk-task-history"
import type { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import type { VscodeSessionHost } from "../vscode-session-host"

vi.mock("@/core/storage/disk", () => ({
	GlobalFileNames: {
		apiConversationHistory: "api_conversation_history.json",
		contextHistory: "context_history.json",
		taskMetadata: "task_metadata.json",
		uiMessages: "ui_messages.json",
	},
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		get: vi.fn(() => ({ globalStorageFsPath: "/tmp/cline" })),
	},
}))

vi.mock("@/utils/fs", () => ({
	fileExistsAtPath: vi.fn(() => Promise.resolve(false)),
}))

// Bun:test hoists vi.mock() calls automatically; we don't need vi.hoisted
// for the mock state container.
type LegacyStateReaderMock = {
	taskHistory: HistoryItem[]
	taskHistoryByDataDir: Map<string | undefined, HistoryItem[]>
	uiMessages: unknown[]
	uiMessagesByDataDir: Map<string | undefined, unknown[]>
	apiConversationHistory: unknown[]
	apiConversationHistoryByDataDir: Map<string | undefined, unknown[]>
}
const legacyStateReaderMock: LegacyStateReaderMock = {
	taskHistory: [] as HistoryItem[],
	taskHistoryByDataDir: new Map<string | undefined, HistoryItem[]>(),
	uiMessages: [] as unknown[],
	uiMessagesByDataDir: new Map<string | undefined, unknown[]>(),
	apiConversationHistory: [] as unknown[],
	apiConversationHistoryByDataDir: new Map<string | undefined, unknown[]>(),
}

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("../legacy-state-reader", () => ({
	readTaskHistory: vi.fn(
		(dataDir?: string) => legacyStateReaderMock.taskHistoryByDataDir.get(dataDir) ?? legacyStateReaderMock.taskHistory,
	),
	deleteLegacyTask: vi.fn((taskId: string, dataDir?: string) => {
		const history = legacyStateReaderMock.taskHistoryByDataDir.get(dataDir) ?? legacyStateReaderMock.taskHistory
		const filteredHistory = history.filter((item) => item.id !== taskId)
		if (legacyStateReaderMock.taskHistoryByDataDir.has(dataDir)) {
			legacyStateReaderMock.taskHistoryByDataDir.set(dataDir, filteredHistory)
		} else {
			legacyStateReaderMock.taskHistory = filteredHistory
		}
		return filteredHistory.length !== history.length
	}),
	readUiMessages: vi.fn(
		(_taskId: string, dataDir?: string) =>
			legacyStateReaderMock.uiMessagesByDataDir.get(dataDir) ?? legacyStateReaderMock.uiMessages,
	),
	readApiConversationHistory: vi.fn(
		(_taskId: string, dataDir?: string) =>
			legacyStateReaderMock.apiConversationHistoryByDataDir.get(dataDir) ?? legacyStateReaderMock.apiConversationHistory,
	),
	taskDirPath: vi.fn((taskId: string, dataDir?: string) => `${dataDir ?? "default"}/tasks/${taskId}`),
}))

vi.mock("get-folder-size", () => ({
	default: {
		loose: vi.fn(),
	},
}))

// Minimal Date.now() shim for bun:test (which has no vi.useFakeTimers).
// We mutate the global Date constructor's now() via Object.defineProperty
// to inject a fixed epoch; realDateNow() restores the original.
const originalDateNow = Date.now
function fakeDateNow(value: number): void {
	Date.now = () => value
}
function realDateNow(): void {
	Date.now = originalDateNow
}

function makeHistoryItem(id: string, overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id,
		ts: 1,
		task: id,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		...overrides,
	}
}

function makeSessionRecord(id: string, overrides: Partial<SessionHistoryRecord> = {}): SessionHistoryRecord {
	return {
		sessionId: id,
		source: "vscode",
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: null,
		exitCode: null,
		status: "completed",
		interactive: true,
		provider: "anthropic",
		model: "claude-test",
		cwd: "/repo",
		workspaceRoot: "/repo",
		enableTools: true,
		enableSpawn: true,
		enableTeams: false,
		isSubagent: false,
		prompt: id,
		metadata: {},
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	}
}

function makeTelemetry(): TelemetryService {
	return {
		safeCapture: vi.fn((fn: () => void) => fn()),
		captureLegacyTaskMigration: vi.fn(),
		captureLegacyTaskMigrationBacklog: vi.fn(),
	} as unknown as TelemetryService
}

interface HistoryHarness {
	history: SdkTaskHistory
	listHistory: ReturnType<typeof vi.fn>
	updateSession: ReturnType<typeof vi.fn>
	deleteSession: ReturnType<typeof vi.fn>
	startSession: ReturnType<typeof vi.fn>
	getSession: ReturnType<typeof vi.fn>
}

function makeHistory(records: SessionHistoryRecord[]): HistoryHarness {
	let currentRecords = records
	const updateSession = vi.fn(
		async (
			sessionId: string,
			updates: {
				prompt?: string | null
				metadata?: Record<string, unknown> | null
				title?: string | null
			},
		) => {
			const exists = currentRecords.some((record) => record.sessionId === sessionId)
			if (exists) {
				currentRecords = currentRecords.map((record) =>
					record.sessionId === sessionId
						? {
								...record,
								prompt: updates.prompt ?? record.prompt,
								metadata: updates.metadata ?? record.metadata,
							}
						: record,
				)
			} else {
				// Brand-new session: create a row so the test sees it
				// after the next listHistory. This mirrors the production
				// behavior of initTask → write → list.
				currentRecords = [
					makeSessionRecord(sessionId, {
						prompt: updates.prompt ?? sessionId,
						metadata: updates.metadata ?? {},
					}),
					...currentRecords,
				]
			}
			return { updated: true }
		},
	)
	const deleteSession = vi.fn(async (sessionId: string) => {
		const exists = currentRecords.some((record) => record.sessionId === sessionId)
		if (!exists) {
			throw new Error(`Session not found: ${sessionId}`)
		}
		currentRecords = currentRecords.filter((record) => record.sessionId !== sessionId)
		return true
	})
	const getSession = vi.fn(async (sessionId: string) => currentRecords.find((record) => record.sessionId === sessionId))
	const listHistory = vi.fn(async () => currentRecords)
	const readMessages = vi.fn(async () => [])
	const startSession = vi.fn(async (input: { config: { sessionId?: string } }) => {
		currentRecords = [makeSessionRecord(input.config.sessionId ?? "started"), ...currentRecords]
		return { sessionId: input.config.sessionId }
	})
	const host = {
		get: getSession,
		listHistory,
		readMessages,
		start: startSession,
		update: updateSession,
		delete: deleteSession,
	} as unknown as VscodeSessionHost
	const sessions = {
		getActiveSession: () => ({ sdkHost: host }),
	} as unknown as SdkSessionLifecycle
	const history = new SdkTaskHistory({
		mcpHub: {} as McpHub,
		sessions,
		telemetry: makeTelemetry(),
	})
	return { history, listHistory, updateSession, deleteSession, startSession, getSession }
}

describe("WVSL01 — webview-state session-listing re-enumeration repair", () => {
	beforeEach(() => {
		legacyStateReaderMock.taskHistory = []
		legacyStateReaderMock.taskHistoryByDataDir.clear()
	})

	afterEach(() => {
		vi.clearAllMocks()
		realDateNow()
	})

	// WVSL-RED-01: PRE-FIX must fail. POST-FIX must pass.
	//
	// The defect is the TIME-ONLY freshness contract: within the TTL
	// window the cache is reused (existing test
	// "patches cached history record in place without re-listing from
	// host" already covers that path). The defect emerges when a
	// projection falls just OUTSIDE the TTL — pre-fix that triggers
	// a full re-enumeration despite no mutation in between.
	//
	// Simulate the LIVE capture pattern: initial projection, then a
	// burst of state-post flushes spaced > TTL apart (no mutation).
	// Pre-fix: each post-TTL projection rematerializes.
	// Post-fix: cache is reused across the whole sequence.
	it("WVSL-RED-01: projections across multiple TTL windows with no mutation → only one listSessions", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		// Pin Date.now() to a deterministic base so the cache's
		// `createdAt` is reproducible, then advance simulated time.
		const base = 1_700_000_000_000
		fakeDateNow(base)

		// T0: initial projection.
		const first = await history.listHistory({ hydrate: false, limit: 100 })
		expect(first.length).toBe(2)
		expect(listHistory).toHaveBeenCalledTimes(1)

		// T1..T5: state-post flushes spread across simulated 30 s,
		// each at a different simulated time past the 10 s TTL.
		for (let i = 0; i < 5; i++) {
			fakeDateNow(base + 6_000 * (i + 1))
			await history.listHistory({ hydrate: false, limit: 100 })
		}
		realDateNow()

		// PRE-FIX: each post-TTL window forces a rematerialization.
		//   count > 1 (in practice = 3..6 depending on clock alignment).
		// POST-FIX: cache is fresh until a mutation invalidates it.
		//   count = 1.
		expect(listHistory).toHaveBeenCalledTimes(1)
	})

	// WVSL-RED-02: authoritative mutation MUST reflect in next projection.
	// updateTaskHistoryItem on a session already in the cache is patched
	// in place (NOT invalidated). The next listHistory must reflect the
	// new prompt without a host round-trip.
	it("WVSL-RED-02: in-place patch on updateTaskHistoryItem reflects next projection", async () => {
		const { history, listHistory } = makeHistory([
			makeSessionRecord("task-1", { prompt: "original", updatedAt: "2026-01-01T00:00:00.000Z" }),
		])

		await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)

		await history.updateTaskHistoryItem(makeHistoryItem("task-1", { task: "renamed" }))

		const result = await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)
		const record = result.find((r) => r.sessionId === "task-1")
		expect(record?.prompt).toBe("renamed")
	})

	// WVSL-GREEN-01: 3 projections with no mutation → 1 listSessions.
	it("WVSL-GREEN-01: three projections with no mutation → exactly one listSessions", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		await history.listHistory({ hydrate: false, limit: 100 })
		await history.listHistory({ hydrate: false, limit: 100 })
		await history.listHistory({ hydrate: false, limit: 100 })

		expect(listHistory).toHaveBeenCalledTimes(1)
	})

	// WVSL-GREEN-02: real mutation invalidates, next projection re-enumerates.
	//
	// Note: deleteTaskFromState internally calls listHistory() to return
	// the post-delete list (see sdk-task-history.ts:635-637). That
	// counts as 1 host.listSessions call here. The next caller-driven
	// listHistory is the 2nd call after the initial 1, for a total of 3.
	it("WVSL-GREEN-02: real mutation (delete) forces next projection to re-enumerate", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)

		await history.deleteTaskFromState("task-2")

		const result = await history.listHistory({ hydrate: false, limit: 100 })
		// 1 (initial) + 1 (deleteTaskFromState's internal re-list) + 1 (next projection)
		expect(listHistory).toHaveBeenCalledTimes(3)
		expect(result.find((r) => r.sessionId === "task-2")).toBeUndefined()
		expect(result.find((r) => r.sessionId === "task-1")).toBeDefined()
	})

	// WVSL-CTL-01: explicit session-list RPC preserves semantics.
	it("WVSL-CTL-01: cache reuse preserves the explicit-RPC contract across two calls", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		const first = await history.listHistory({ hydrate: false, limit: 100 })
		const second = await history.listHistory({ hydrate: false, limit: 100 })

		expect(first.map((r) => r.sessionId)).toEqual(expect.arrayContaining(["task-1", "task-2"]))
		expect(second.map((r) => r.sessionId)).toEqual(expect.arrayContaining(["task-1", "task-2"]))
		expect(listHistory).toHaveBeenCalledTimes(1)
	})

	// WVSL-ADV-01: brand-new session appears in next projection.
	it("WVSL-ADV-01: brand-new session created during cache lifetime appears in next projection", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1")])

		await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)

		// updateTaskHistoryItem is the production path through initTask.
		await history.updateTaskHistoryItem(makeHistoryItem("task-new", { task: "new session" }))

		const result = await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(2)
		expect(result.find((r) => r.sessionId === "task-new")).toBeDefined()
	})

	// WVSL-ADV-02: deleted session disappears in next projection.
	it("WVSL-ADV-02: session deleted during cache lifetime disappears from next projection", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)

		await history.deleteTaskFromState("task-1")

		const result = await history.listHistory({ hydrate: false, limit: 100 })
		// 1 (initial) + 1 (deleteTaskFromState internal re-list) + 1 (next projection)
		expect(listHistory).toHaveBeenCalledTimes(3)
		expect(result.find((r) => r.sessionId === "task-1")).toBeUndefined()
		expect(result.find((r) => r.sessionId === "task-2")).toBeDefined()
	})

	// WVSL-ADV-03: rename/title change reflects on next projection (in-place patch).
	it("WVSL-ADV-03: rename during cache lifetime reflects in next projection (in-place patch)", async () => {
		const { history, listHistory } = makeHistory([
			makeSessionRecord("task-1", { prompt: "old name", updatedAt: "2026-01-01T00:00:00.000Z" }),
		])

		await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)

		await history.updateTaskHistoryItem(makeHistoryItem("task-1", { task: "new name" }))

		const result = await history.listHistory({ hydrate: false, limit: 100 })
		expect(listHistory).toHaveBeenCalledTimes(1)
		const record = result.find((r) => r.sessionId === "task-1")
		expect(record?.prompt).toBe("new name")
	})

	// WVSL-ADV-04: burst of irrelevant state-post flushes must collapse
	// to exactly one materialization.
	it("WVSL-ADV-04: 25 burst projections with no mutation → exactly one listSessions", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		for (let i = 0; i < 25; i++) {
			await history.listHistory({ hydrate: false, limit: 100 })
		}

		expect(listHistory).toHaveBeenCalledTimes(1)
	})

	// WVSL-ABLATION-01: ablate the repair → repeated cardinality returns.
	//
	// The ablation forces the safety TTL to 0, making the predicate
	// fail on every read (same effect as the pre-fix 10 s contract
	// when a projection falls outside the window). This is a test-only
	// seam: no production global mutates, and the safety TTL field is
	// the load-bearing constant whose semantics are under repair.
	it("WVSL-ABLATION-01: with safety TTL forced to 0, every projection re-enumerates", async () => {
		const { history, listHistory } = makeHistory([makeSessionRecord("task-1"), makeSessionRecord("task-2")])

		;(history as unknown as Record<string, number>).metadataHistoryCacheSafetyTtlMs = 0

		await history.listHistory({ hydrate: false, limit: 100 })
		await history.listHistory({ hydrate: false, limit: 100 })
		await history.listHistory({ hydrate: false, limit: 100 })

		expect(listHistory).toHaveBeenCalledTimes(3)
	})
})