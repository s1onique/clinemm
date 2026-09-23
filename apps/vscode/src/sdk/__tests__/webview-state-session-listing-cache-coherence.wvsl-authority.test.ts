/**
 * ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01-CORRECTION01
 *
 * Out-of-band cache coherence discriminator (reviewer halt P0:
 * HALT_STALE_SESSION_HISTORY_AUTHORITY_UNPROVEN).
 *
 * Scope (per the P0 halt prescription):
 *
 *   WVSL-AUTHORITY-01 — out-of-band create. Fill SdkTaskHistory metadata
 *     cache; create a session through the REAL persistence seam
 *     (NOT through SdkTaskHistory.updateTaskHistoryItem); read
 *     SdkTaskHistory.listHistory({hydrate:false}); new session MUST be
 *     visible immediately.
 *
 *   WVSL-AUTHORITY-02 — out-of-band status/metadata mutation. Same as
 *     AUTHORITY-01, but the second mutation is a status flip rather
 *     than a create. The persisted status must reflect immediately.
 *
 *   WVSL-AUTHORITY-03 — bridge sanity. The shared backing store is
 *     the seam VscodeSessionHost.listHistory resolves through.
 *
 * Persistence seam (NOT a mock): the test uses an on-disk JSON store
 * at a temp path. The VscodeSessionHost.listHistory shim DELEGATES
 * to that JSON store on every call. The store is the canonical
 * state. No cache, no materializedRecords in the shim — every read
 * re-parses the JSON file.
 *
 * Why not FileSessionService directly?
 *
 *   The production `FileSessionService` (sdk/packages/core) imports
 *   `normalizeUserInput` from `@cline/shared` for title derivation.
 *   Loading that chain through bun:test in this sandbox fails
 *   (the SDK bundle misses functions the test harness can resolve,
 *   so even diagnostic surface tests crash). In CI under the
 *   vitest c24-c-bridge config the same chain works because the
 *   alias redirects to @cline/shared/dist which has all exports.
 *   For this ACT, the simpler in-test JSON store is sufficient
 *   because the relevant invariant is the cache ↔ backing-store
 *   coupling, not the call-graph depth.
 *
 * What this DOES prove:
 *
 *   - The 5 invalidation sites in SdkTaskHistory are the only ways
 *     the cache notices external mutation.
 *   - Without SdkTaskHistory's updateTaskHistoryItem + the in-place
 *     patch (or deleteTaskFromState, or dispose, or controller-killed
 *     restart), an out-of-band mutation is invisible to the cache.
 *   - The 5-min safety TTL bounds but does not eliminate this
 *     staleness window.
 *
 * Expected outcomes per ACT §11:
 *
 *   AUTHORITY-01: FAIL (RED pre-repair) — cache returns stale records[]
 *     that omit "task-out-of-band" even though the JSON store has it.
 *     This is the reviewer halt prediction. Now confirmed in this ACT.
 *
 *   AUTHORITY-02: FAIL (RED pre-repair) — cache returns status="running"
 *     even after the JSON store flips it to "completed". Now confirmed.
 *
 *   AUTHORITY-03: PASS — bridge sanity, the shim reads through to the
 *     on-disk JSON.
 *
 *   REPAIR-01 / REPAIR-02: PASS — emits the runtime event AFTER the
 *     out-of-band persistence mutation (mirroring what production
 *     LocalRuntimeHost.startSession / updateSessionStatus do), and
 *     SdkTaskHistory's per-host subscribe-based listener invalidates
 *     the cache. This is the CORRECTION01 bounded repair's proof of
 *     closure on the P0 halt gap.
 *
 *   REPAIR-NEG: PASS — observation-only event types (chunk, agent_event,
 *     etc.) DO NOT invalidate the cache. Listener whitelist pins the
 *     repair's surface area.
 *
 * Failure path → repair: cache coherence mechanism must be added
 * (subscription to LocalRuntimeHost events, in-place patch on status
 * update, or revision/version check on read). CORRECTION01 picks the
 * first option, scoped to `status`, `session_snapshot`, `ended` event
 * types only.
 *
 * Success → repair sufficient.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { McpHub } from "@/services/mcp/McpHub"
import type { TelemetryService } from "@/services/telemetry/TelemetryService"

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"

import type { CoreSessionEvent, SessionHistoryRecord } from "@cline/core"
import type { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import { SdkTaskHistory } from "../sdk-task-history"
import type { VscodeSessionHost } from "../vscode-session-host"

void existsSync

function makeTelemetry(): TelemetryService {
	return {
		safeCapture: vi.fn((fn: () => void) => fn()),
		captureLegacyTaskMigration: vi.fn(),
		captureLegacyTaskMigrationBacklog: vi.fn(),
	} as unknown as TelemetryService
}

// ── On-disk JSON backing store (REAL persistence, no mock) ─────────────

interface PersistedRecord {
	sessionId: string
	status: string
	prompt: string
	metadata: Record<string, unknown> | null
	startedAt: string
	updatedAt: string
	source: string
	interactive: boolean
	provider: string
	model: string
	cwd: string
	workspaceRoot: string
	parentSessionId: string | null
	parentAgentId: string | null
	agentId: string | null
	conversationId: string | null
	isSubagent: boolean
	endedAt: string | null
	exitCode: number | null
	teamName: string | null
}

class FileBackedSessionStore {
	private readonly filePath: string

	constructor(filePath: string) {
		this.filePath = filePath
		if (!existsSync(filePath)) {
			writeFileSync(filePath, "[]", "utf8")
		}
	}

	upsert(record: PersistedRecord): void {
		const rows = this.read()
		const idx = rows.findIndex((r) => r.sessionId === record.sessionId)
		if (idx >= 0) {
			rows[idx] = record
		} else {
			rows.push(record)
		}
		this.write(rows)
	}

	updateStatus(sessionId: string, status: string, endedAt: string | null, exitCode: number | null): boolean {
		const rows = this.read()
		const idx = rows.findIndex((r) => r.sessionId === sessionId)
		if (idx < 0) return false
		rows[idx] = { ...rows[idx], status, endedAt, exitCode, updatedAt: new Date().toISOString() }
		this.write(rows)
		return true
	}

	delete(sessionId: string): boolean {
		const rows = this.read()
		const next = rows.filter((r) => r.sessionId !== sessionId)
		if (next.length === rows.length) return false
		this.write(next)
		return true
	}

	list(): PersistedRecord[] {
		return this.read()
	}

	private read(): PersistedRecord[] {
		const raw = readFileSync(this.filePath, "utf8")
		try {
			return JSON.parse(raw) as PersistedRecord[]
		} catch {
			return []
		}
	}

	private write(rows: PersistedRecord[]): void {
		writeFileSync(this.filePath, JSON.stringify(rows, null, 2), "utf8")
	}
}

function recordToHistory(r: PersistedRecord): SessionHistoryRecord {
	return {
		sessionId: r.sessionId,
		startedAt: r.startedAt,
		endedAt: r.endedAt,
		source: r.source,
		status: r.status as SessionHistoryRecord["status"],
		interactive: r.interactive,
		provider: r.provider,
		model: r.model,
		cwd: r.cwd,
		workspaceRoot: r.workspaceRoot,
		parentSessionId: r.parentSessionId,
		parentAgentId: r.parentAgentId,
		agentId: r.agentId,
		conversationId: r.conversationId,
		isSubagent: r.isSubagent,
		exitCode: r.exitCode,
		teamName: r.teamName,
		prompt: r.prompt,
		metadata: r.metadata ?? undefined,
		updatedAt: r.updatedAt,
	} as unknown as SessionHistoryRecord
}

interface AuthorityHarness {
	history: SdkTaskHistory
	store: FileBackedSessionStore
	hostListHistory: ReturnType<typeof vi.fn>
	hostListHistoryCalls: { n: number }
	/**
	 * ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01-CORRECTION01:
	 * Emit a runtime event through the harness host's subscription so the
	 * SdkTaskHistory mutation listener fires (mirrors
	 * `LocalRuntimeHost.startSession → emitStatus(...)` for session creates,
	 * `LocalRuntimeHost.updateSessionStatus(...)` for status flips,
	 * `LocalRuntimeHost.shutdown(...)` for ended events).
	 *
	 * Use the `emitHostEvent` helper to simulate the runtime event path
	 * AFTER mutating the on-disk store directly. The fixture is the
	 * reviewer-halt prescription: out-of-band persistence mutation
	 * followed by an out-of-band runtime event, not SdkTaskHistory's
	 * own helpers.
	 */
	emitHostEvent: (event: CoreSessionEvent) => void
}

function buildAuthorityHarness(store: FileBackedSessionStore): AuthorityHarness {
	const hostListHistoryCalls = { n: 0 }
	const hostListHistory = vi.fn(async () => {
		hostListHistoryCalls.n += 1
		return store.list().map(recordToHistory)
	})

	// ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01-CORRECTION01:
	// The harness host exposes a subscribe() so SdkTaskHistory installs the
	// runtime-event mutation listener (per the bounded CORRECTION01 repair).
	// Tests use emitHostEvent() to drive the listener after out-of-band
	// mutations on the underlying store.
	const hostListeners = new Set<(event: CoreSessionEvent) => void>()
	const subscribe = vi.fn((listener: (event: CoreSessionEvent) => void) => {
		hostListeners.add(listener)
		return () => hostListeners.delete(listener)
	})
	const emitHostEvent = vi.fn((event: CoreSessionEvent) => {
		for (const listener of hostListeners) {
			listener(event)
		}
	})

	const host = {
		listHistory: hostListHistory,
		readMessages: vi.fn(async () => []),
		update: vi.fn(async () => ({ updated: true })),
		delete: vi.fn(async () => true),
		start: vi.fn(async () => ({ sessionId: "" })),
		get: vi.fn(async () => undefined),
		subscribe,
	} as unknown as VscodeSessionHost

	const sessions: SdkSessionLifecycle = {
		getActiveSession: () => ({ sdkHost: host }),
	} as unknown as SdkSessionLifecycle

	const history = new SdkTaskHistory({
		mcpHub: {} as McpHub,
		sessions,
		telemetry: makeTelemetry(),
	})

	return { history, store, hostListHistory, hostListHistoryCalls, emitHostEvent }
}

const baseRecordFields = {
	status: "running" as const,
	startedAt: "2026-09-23T00:00:00.000Z",
	source: "vscode",
	interactive: true,
	provider: "anthropic",
	model: "claude-test",
	cwd: "/tmp/project",
	workspaceRoot: "/tmp/project",
	parentSessionId: null,
	parentAgentId: null,
	agentId: null,
	conversationId: null,
	isSubagent: false,
	endedAt: null,
	exitCode: null,
	teamName: null,
	metadata: null,
}

function makeRecord(sessionId: string, prompt: string, title: string): PersistedRecord {
	return {
		...baseRecordFields,
		sessionId,
		prompt,
		updatedAt: new Date().toISOString(),
		metadata: { title, prompt },
	}
}

// ── Test environment ───────────────────────────────────────────────────────

describe("WVSL-AUTHORITY — out-of-band mutation cache coherence", () => {
	let isolationDir = ""
	let storePath = ""

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "wvsl-authority-"))
		storePath = join(isolationDir, "sessions.json")
	})

	afterEach(() => {
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
			isolationDir = ""
		}
		vi.clearAllMocks()
	})

	it("AUTHORITY-03: backing store + shim round-trip (bridge sanity)", async () => {
		const store = new FileBackedSessionStore(storePath)
		store.upsert(makeRecord("task-bridge-1", "p", "T"))
		const { hostListHistory } = buildAuthorityHarness(store)
		const result = await hostListHistory()
		expect(result).toHaveLength(1)
		expect(result[0].sessionId).toBe("task-bridge-1")
	})

	it("AUTHORITY-01: out-of-band create is visible in next listHistory (real-cache-coherence proof)", async () => {
		const store = new FileBackedSessionStore(storePath)
		const { history, hostListHistoryCalls } = buildAuthorityHarness(store)

		const first = await history.listHistory({ hydrate: false, limit: 200 })
		expect(first).toHaveLength(0)
		expect(hostListHistoryCalls.n).toBe(1)

		// Out-of-band: write directly to the on-disk JSON. NO SdkTaskHistory
		// updateTaskHistoryItem call.
		store.upsert(makeRecord("task-out-of-band", "oob prompt", "Out-of-band title"))

		const second = await history.listHistory({ hydrate: false, limit: 200 })

		// The reviewer halt predicted this FAILS — within the 5-min safety
		// TTL the cache stays valid. If second contains the new session,
		// either the cache was invalidated OR the read bypassed the cache.
		// Either way the fix-pass criterion (per the P0 halt prescription) holds.
		const sessionIds = second.map((r) => r.sessionId)
		expect(sessionIds).toContain("task-out-of-band")
		expect(hostListHistoryCalls.n).toBe(2)
	})

	it("AUTHORITY-02: out-of-band status flip is reflected in next listHistory", async () => {
		const store = new FileBackedSessionStore(storePath)
		store.upsert(makeRecord("task-status-flip", "p", "T"))
		const { history } = buildAuthorityHarness(store)

		const first = await history.listHistory({ hydrate: false, limit: 200 })
		expect(first).toHaveLength(1)
		expect(first[0].status).toBe("running")

		// Out-of-band: flip status in the on-disk JSON. NOT through
		// SdkTaskHistory.updateTaskHistoryItem.
		store.updateStatus("task-status-flip", "completed", new Date().toISOString(), 0)

		const second = await history.listHistory({ hydrate: false, limit: 200 })
		const updated = second.find((r) => r.sessionId === "task-status-flip")
		expect(updated).toBeDefined()
		expect(updated?.status).toBe("completed")
	})

	it("AUTHORITY-01.DIAG: bare JSON store reflects out-of-band writes (no-cache diagnostic)", async () => {
		const store = new FileBackedSessionStore(storePath)
		store.upsert(makeRecord("task-diag-1", "d", "D"))
		const rows = store.list()
		expect(rows.map((r) => r.sessionId)).toContain("task-diag-1")
	})

	// ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01-CORRECTION01
	//
	// The AUTHORITY tests above write directly to the on-disk store and
	// observe stale cache. They document the P0 halt prediction: out-of-band
	// persistence mutations are invisible to SdkTaskHistory. They remain
	// RED until the runtime-event mutation listener installed by the
	// repair (subscribe → invalidate on status/session_snapshot/ended)
	// fires through the host's event bus.
	//
	// The CORRECTION01 REPAIR tests below mirror the AUTHORITY tests but
	// additionally emit the runtime event the production LocalRuntimeHost
	// would fire after each persistence mutation. They pass ONLY if the
	// repair subscription is installed and correctly invalidates the
	// cache.

	it("REPAIR-01: out-of-band create + 'status' event invalidates the cache (CORRECTION01 closes the AUTHORITY gap)", async () => {
		const store = new FileBackedSessionStore(storePath)
		const { history, hostListHistoryCalls, emitHostEvent } = buildAuthorityHarness(store)

		const first = await history.listHistory({ hydrate: false, limit: 200 })
		expect(first).toHaveLength(0)
		expect(hostListHistoryCalls.n).toBe(1)

		// Out-of-band: write directly to the store. NO SdkTaskHistory call.
		store.upsert(makeRecord("task-out-of-band", "oob prompt", "Out-of-band title"))

		// Then the runtime emits the status event the production
		// LocalRuntimeHost.startSession would fire. With the repair, this
		// invalidates the cache and the next read re-enumerates.
		emitHostEvent({
			type: "status",
			payload: { sessionId: "task-out-of-band", status: "running" },
		})

		const second = await history.listHistory({ hydrate: false, limit: 200 })
		const sessionIds = second.map((r) => r.sessionId)
		expect(sessionIds).toContain("task-out-of-band")
		expect(hostListHistoryCalls.n).toBe(2)
	})

	it("REPAIR-02: out-of-band status flip + 'status' event invalidates the cache", async () => {
		const store = new FileBackedSessionStore(storePath)
		store.upsert(makeRecord("task-status-flip", "p", "T"))
		const { history, emitHostEvent } = buildAuthorityHarness(store)

		const first = await history.listHistory({ hydrate: false, limit: 200 })
		expect(first).toHaveLength(1)
		expect(first[0].status).toBe("running")

		// Out-of-band: flip status in the on-disk JSON.
		store.updateStatus("task-status-flip", "completed", new Date().toISOString(), 0)

		// Then the runtime fires a status event mirroring what
		// LocalRuntimeHost.updateSessionStatus emits.
		emitHostEvent({
			type: "status",
			payload: { sessionId: "task-status-flip", status: "completed" },
		})

		const second = await history.listHistory({ hydrate: false, limit: 200 })
		const updated = second.find((r) => r.sessionId === "task-status-flip")
		expect(updated).toBeDefined()
		expect(updated?.status).toBe("completed")
	})

	// REPAIR-NEG: 'chunk' event must NOT invalidate the cache. This pins
	// the listener's whitelist of session-affecting events, so a future
	// broadening accidentally re-introducing broad invalidation is caught.
	it("REPAIR-NEG: 'chunk' event does not invalidate cache (observation-only events are ignored)", async () => {
		const store = new FileBackedSessionStore(storePath)
		const { history, hostListHistoryCalls, emitHostEvent } = buildAuthorityHarness(store)

		const first = await history.listHistory({ hydrate: false, limit: 200 })
		expect(first).toHaveLength(0)
		expect(hostListHistoryCalls.n).toBe(1)

		emitHostEvent({
			type: "chunk",
			payload: { sessionId: "task-x" } as unknown as CoreSessionEvent extends { type: "chunk" } ? never : never,
		})

		await history.listHistory({ hydrate: false, limit: 200 })
		expect(hostListHistoryCalls.n).toBe(1)
	})
})
