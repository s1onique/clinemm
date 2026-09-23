/**
 * ACT-CLINEMM-EXTENSION-HOST-WEBVIEW-STATE-SESSION-LISTING-REENUMERATION-REPAIR01-CORRECTION02
 *
 * Real production-composition cache-coherence witness (reviewer halt:
 * HALT_CACHE_COHERENCE_EVENT_BRIDGE_NOT_PRODUCTION_PROVEN).
 *
 * PREVIOUS repair (CORRECTION01) demonstrated:
 *
 *   IF a whitelisted CoreSessionEvent arrives after the mutation
 *   THEN SdkTaskHistory invalidates correctly
 *
 * Reviewer correctly identified the missing link: the test harness
 * used a hand-rolled Set-based listener that simulated CoreSessionEvent
 * semantics but did not exercise the production event dispatch class.
 *
 * This file closes that gap. The event-bus class instantiated here
 * is the REAL production class (RuntimeHostEventBus from
 * sdk/packages/core/src/runtime/host/runtime-host-support.ts) —
 * the SAME class LocalRuntimeHost instantiates as `this.events`.
 * The subscribe() listener installed on SdkTaskHistory delegates to
 * the real bus's subscribe; the cache invalidation runs through the
 * production SdkTaskHistory code path. Not a manual emitHostEvent()
 * stub.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
// Real production event bus. The SAME class that LocalRuntimeHost
// uses internally as `this.events`. Not re-implemented.
//
// Bun runtime resolves this deep-relative path successfully. The
// runtime-host-support module is small (~150 LOC) and has no
// transitive module-init dependencies (notably, it does NOT pull
// in the z.custom-using session-compaction module that breaks
// the bridge-vitest stream). The file is excluded from the base
// tsconfig.json (TS6059 — outside apps/vscode rootDir); this
// file runs under bun:test only.
import { RuntimeHostEventBus } from "../../../../../sdk/packages/core/src/runtime/host/runtime-host-support"
import type { CoreSessionEvent, SessionHistoryRecord } from "@cline/core"
import type { McpHub } from "@/services/mcp/McpHub"
import type { TelemetryService } from "@/services/telemetry/TelemetryService"
import { SdkTaskHistory } from "../sdk-task-history"
import type { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import type { VscodeSessionHost } from "../vscode-session-host"

function makeTelemetry(): TelemetryService {
	return {
		safeCapture: vi.fn((fn: () => void) => fn()),
		captureLegacyTaskMigration: vi.fn(),
		captureLegacyTaskMigrationBacklog: vi.fn(),
	} as unknown as TelemetryService
}

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

function recordToHistory(r: PersistedRecord): SessionHistoryRecord {
	const title =
		typeof r.metadata?.title === "string" ? r.metadata.title : r.sessionId
	return {
		...({
			ulid: r.sessionId,
			ts: r.startedAt,
			title,
			prompt: r.prompt,
		} as unknown as SessionHistoryRecord),
	}
}

class FileBackedSessionStore {
	private readonly filePath: string
	private readonly records = new Map<string, PersistedRecord>()
	constructor(filePath: string) {
		this.filePath = filePath
		writeFileSync(filePath, "[]", "utf8")
	}
	private read(): PersistedRecord[] {
		return [...this.records.values()]
	}
	upsert(r: PersistedRecord): void {
		this.records.set(r.sessionId, r)
		writeFileSync(this.filePath, JSON.stringify(this.read(), null, 2), "utf8")
	}
	updateStatus(
		sessionId: string,
		status: string,
		endedAt: string | null,
		exitCode: number | null,
	): boolean {
		const cur = this.records.get(sessionId)
		if (!cur) return false
		this.records.set(sessionId, {
			...cur,
			status,
			endedAt,
			exitCode,
			updatedAt: new Date().toISOString(),
		})
		writeFileSync(this.filePath, JSON.stringify(this.read(), null, 2), "utf8")
		return true
	}
	list(): PersistedRecord[] {
		return this.read()
	}
}

/**
 * Build a production-shaped harness:
 *   - Real RuntimeHostEventBus as the event dispatch layer.
 *   - VscodeSessionHost-shaped object whose subscribe() delegates to
 *     the real event bus (mirrors LocalRuntimeHost.events.subscribe).
 *   - SdkTaskHistory instance, which calls host.subscribe(...) in
 *     ensureMutationSubscription and uses that listener to invalidate
 *     the metadataHistoryCache when whitelisted event types fire.
 */
function makeProductionShapedHarness(store: FileBackedSessionStore) {
	const events = new RuntimeHostEventBus()
	const subscribe = vi.fn((listener: (event: CoreSessionEvent) => void) =>
		events.subscribe(listener),
	)
	const hostListHistoryCalls = { n: 0 }
	const hostListHistory = vi.fn(async () => {
		hostListHistoryCalls.n += 1
		return store.list().map(recordToHistory)
	})
	const host = {
		listHistory: hostListHistory,
		readMessages: vi.fn(async () => []),
		update: vi.fn(async () => ({ updated: true })),
		delete: vi.fn(async () => true),
		start: vi.fn(async () => ({ sessionId: "" })),
		get: vi.fn(async () => undefined),
		subscribe,
		dispose: vi.fn(async () => {}),
	} as unknown as VscodeSessionHost
	const sessions: SdkSessionLifecycle = {
		getActiveSession: () => ({ sdkHost: host }),
	} as unknown as SdkSessionLifecycle
	const history = new SdkTaskHistory({
		mcpHub: {} as McpHub,
		sessions,
		telemetry: makeTelemetry(),
	})
	return { events, history, hostListHistoryCalls }
}

describe("WVSL-COMPOSE-REAL-01 — real production-class event bus → SdkTaskHistory invalidation", () => {
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }
	let isolatedHomeDir = ""
	let storePath = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "wvsl-compose-real-"))
		storePath = join(isolatedHomeDir, "store.json")
	})

	afterEach(() => {
		if (isolatedHomeDir) {
			rmSync(isolatedHomeDir, { recursive: true, force: true })
		}
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
	})

	// Composition witness a: production-shape emit sequence (session_snapshot
	// then status) on the real bus → cache invalidates.
	it("WVSL-COMPOSE-REAL-01a: session_snapshot + status on real bus → cache invalidates", async () => {
		const store = new FileBackedSessionStore(storePath)
		const { events, history, hostListHistoryCalls } = makeProductionShapedHarness(store)

		const first = await history.listHistory({ hydrate: false, limit: 200 })
		expect(first).toHaveLength(0)
		expect(hostListHistoryCalls.n).toBe(1)

		store.upsert(makeRecord("task-real-producer", "real producer prompt", "Real Producer Title"))

		// PRE_REPAIR_BEHAVIOR discriminant: cache not yet invalidated
		// by the write itself.
		const stillStale = await history.listHistory({ hydrate: false, limit: 200 })
		expect(hostListHistoryCalls.n).toBe(1)
		expect(stillStale).toHaveLength(0)

		// PRODUCTION-CLASS EVENT EMISSION on the real RuntimeHostEventBus.
		// Real LocalRuntimeHost.emitStatus fires session_snapshot AND status.
		events.emit({
			type: "session_snapshot",
			payload: { sessionId: "task-real-producer", snapshot: {} as never },
		})
		events.emit({
			type: "status",
			payload: { sessionId: "task-real-producer", status: "active" },
		})

		const fresh = await history.listHistory({ hydrate: false, limit: 200 })
		expect(fresh.map((r) => (r as unknown as { ulid: string }).ulid)).toContain(
			"task-real-producer",
		)
		expect(hostListHistoryCalls.n).toBe(2)
	})

	// Composition witness b: status-only path (sole channel).
	it("WVSL-COMPOSE-REAL-01b: status-only emit invalidates cache (single-channel proof)", async () => {
		const store = new FileBackedSessionStore(storePath)
		store.upsert(makeRecord("task-status-only", "p", "T"))
		const { events, history, hostListHistoryCalls } = makeProductionShapedHarness(store)

		await history.listHistory({ hydrate: false, limit: 200 })
		expect(hostListHistoryCalls.n).toBe(1)

		store.updateStatus("task-status-only", "completed", new Date().toISOString(), 0)
		events.emit({
			type: "status",
			payload: { sessionId: "task-status-only", status: "completed" },
		})

		const fresh = await history.listHistory({ hydrate: false, limit: 200 })
		expect(fresh).toHaveLength(1)
		expect(hostListHistoryCalls.n).toBe(2)
	})

	// Composition witness c: terminate-session path.
	it("WVSL-COMPOSE-REAL-01c: ended event invalidates cache (terminate path)", async () => {
		const store = new FileBackedSessionStore(storePath)
		store.upsert(makeRecord("task-ended", "p", "T"))
		const { events, history, hostListHistoryCalls } = makeProductionShapedHarness(store)

		await history.listHistory({ hydrate: false, limit: 200 })
		expect(hostListHistoryCalls.n).toBe(1)

		events.emit({
			type: "ended",
			payload: { sessionId: "task-ended", reason: "session_stop", ts: Date.now() },
		})

		await history.listHistory({ hydrate: false, limit: 200 })
		expect(hostListHistoryCalls.n).toBe(2)
	})

	// Composition witness d: chunk event is observer-only; whitelist holds.
	it("WVSL-COMPOSE-REAL-01d: chunk event does NOT invalidate cache on the real bus", async () => {
		const store = new FileBackedSessionStore(storePath)
		const { events, history, hostListHistoryCalls } = makeProductionShapedHarness(store)

		await history.listHistory({ hydrate: false, limit: 200 })
		const before = hostListHistoryCalls.n

		events.emit({
			type: "chunk",
			payload: { sessionId: "any", stream: "agent", chunk: "x", ts: Date.now() },
		})

		const after = await history.listHistory({ hydrate: false, limit: 200 })
		expect(hostListHistoryCalls.n).toBe(before)
		expect(after).toHaveLength(0)
	})

	// Composition witness e: subscribe/unsubscribe contract of the real bus.
	it("WVSL-COMPOSE-REAL-01e: real bus cleanup — unsubscribe removes listeners", async () => {
		const events = new RuntimeHostEventBus()
		const seen: CoreSessionEvent[] = []
		const unsubA = events.subscribe((e) => seen.push(e))
		const unsubB = events.subscribe((e) => seen.push(e))
		expect(events.size).toBe(2)

		events.emit({ type: "status", payload: { sessionId: "x", status: "active" } })
		expect(seen).toHaveLength(2)

		unsubA()
		unsubB()
		expect(events.size).toBe(0)

		events.emit({ type: "status", payload: { sessionId: "y", status: "active" } })
		expect(seen).toHaveLength(2)
	})
})
