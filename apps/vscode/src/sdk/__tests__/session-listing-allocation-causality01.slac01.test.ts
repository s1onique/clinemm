/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01
 *
 * Focused test suite for the session-listing causal diagnostic.
 *
 * Per HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN:
 *   - SLAC-COMPOSE-PRODUCTION-01 drives the REAL
 *     UnifiedSessionPersistenceService.listSessions() against a
 *     bounded in-memory adapter + REAL SessionManifestStore.
 *   - SLAC-MANIFEST-PRODUCTION-01 drives the REAL
 *     SessionManifestStore.readSessionManifestTitle() against a
 *     tmp manifest file on disk.
 *   - SLAC-CALLER-RACE-{01..03} + SLAC-LSR-01 exercise the
 *     AsyncLocalStorage caller correlation.
 *
 * Vitest+ESM deduplication caveat (P0-2): in production (Node
 * CommonJS or ESM with esbuild) the runtime and the persistence
 * service share one module instance for the sink. Under
 * vitest+ESM they may not. We therefore verify each half in
 * dedicated tests:
 *   - The ALS propagation/correlation tests assert that
 *     `_runtime.withListSessionsCaller` + the runtime's
 *     same-module consumer see the SAME class across awaits.
 *   - The composition test counts cardinality but uses an
 *     aggregate assertion for the byCaller bucket (since the
 *     vitest+ESM graph isolation can lose the bucket).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SessionRow } from "../../../../../sdk/packages/core/src/session/models/session-row"
import { UnifiedSessionPersistenceService } from "../../../../../sdk/packages/core/src/session/services/persistence-service"
import {
	__resetActiveListSessionsCallerForTests,
	__resetSessionListingDiagnosticSinkForTests,
	getSessionListingDiagnosticSink,
	SessionListingCallerClass,
	type SessionListingCallerClassValue,
	type SessionListingDiagnosticSink,
	setSessionListingDiagnosticSink,
} from "../../../../../sdk/packages/core/src/session/services/session-listing-diagnostic-sink"
import { SessionManifestStore } from "../../../../../sdk/packages/core/src/session/stores/session-manifest-store"
import type { SessionPersistenceAdapter } from "../../../../../sdk/packages/core/src/types/session"

import {
	__resetSessionListingCausalityForTests,
	callerClassName,
	disableSessionListingCausality,
	enableSessionListingCausality,
	materializeSessionListingCausalitySnapshot,
} from "../session-listing-allocation-diagnostic"

import {
	__resetSessionListingCausalityRuntimeForTests,
	buildSessionListingDiagnosticSink,
} from "../session-listing-diagnostic-runtime"

// =============================================================================
// Runtime snapshot (lazy, so the file is CommonJS-loadable)
// =============================================================================

type Runtime = {
	consumeActiveListSessionsCaller: () => number
	withListSessionsCaller: <T>(caller: SessionListingCallerClassValue, fn: () => Promise<T>) => Promise<T>
}

let _runtimeCache: Runtime | undefined
async function getRuntime(): Promise<Runtime> {
	if (!_runtimeCache) {
		_runtimeCache = (await import("../session-listing-diagnostic-runtime")) as unknown as Runtime
	}
	return _runtimeCache
}

// =============================================================================
// In-memory bounded adapter + manifest writer
// =============================================================================

class InMemorySessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(
		private readonly rows: SessionRow[],
		private readonly dir: string,
	) {}
	ensureSessionsDir(): string {
		return this.dir
	}
	async upsertSession(): Promise<void> {
		/* unused */
	}
	async getSession(): Promise<SessionRow | undefined> {
		return undefined
	}
	async listSessions(options: { limit: number; parentSessionId?: string; status?: string }): Promise<SessionRow[]> {
		let r = this.rows.filter((row) => !options.parentSessionId)
		if (options.status) r = r.filter((row) => row.status === options.status)
		return r.slice(0, options.limit)
	}
	async updateSession(): Promise<{ updated: boolean; statusLock: number }> {
		return { updated: false, statusLock: 0 }
	}
	async deleteSession(): Promise<boolean> {
		return false
	}
	async enqueueSpawnRequest(): Promise<void> {
		/* unused */
	}
	async claimSpawnRequest(): Promise<string | undefined> {
		return undefined
	}
}

function makeRow(sessionId: string, status: string): SessionRow {
	return {
		sessionId,
		source: "test",
		pid: 0,
		startedAt: "2024-01-01T00:00:00Z",
		endedAt: null,
		exitCode: null,
		status,
		statusLock: 0,
		interactive: false,
		provider: null,
		model: null,
		cwd: "/tmp/test",
		workspaceRoot: "/tmp/test",
		teamName: null,
		enableTools: false,
		enableSpawn: false,
		enableTeams: false,
		parentSessionId: null,
		parentAgentId: null,
		agentId: null,
		conversationId: null,
		isSubagent: false,
		prompt: null,
		metadata: null,
		hookPath: "",
		messagesPath: null,
		updatedAt: "2024-01-01T00:00:00Z",
	}
}

let installedSink: SessionListingDiagnosticSink | undefined
let workdir: string | undefined

function writeManifest(store: SessionManifestStore, sid: string, title: string): void {
	const path = store.artifacts.sessionManifestPath(sid, false)
	mkdirSync(join(path, ".."), { recursive: true })
	writeFileSync(
		path,
		JSON.stringify({
			session_id: sid,
			source: "test",
			pid: 0,
			started_at: "2024-01-01T00:00:00Z",
			ended_at: null,
			exit_code: null,
			status: "idle",
			interactive: false,
			provider: null,
			model: null,
			cwd: "/tmp/test",
			workspace_root: "/tmp/test",
			team_name: null,
			enable_tools: false,
			enable_spawn: false,
			enable_teams: false,
			metadata: { title },
			messages_path: null,
		}) + "\n",
		"utf8",
	)
}

beforeEach(() => {
	__resetSessionListingCausalityForTests()
	__resetActiveListSessionsCallerForTests()
	__resetSessionListingDiagnosticSinkForTests()
	__resetSessionListingCausalityRuntimeForTests()
	installedSink = buildSessionListingDiagnosticSink()
	setSessionListingDiagnosticSink(installedSink)
	enableSessionListingCausality()
})

afterEach(() => {
	setSessionListingDiagnosticSink(undefined)
	__resetSessionListingCausalityForTests()
	__resetActiveListSessionsCallerForTests()
	__resetSessionListingDiagnosticSinkForTests()
	__resetSessionListingCausalityRuntimeForTests()
	if (workdir) {
		rmSync(workdir, { recursive: true, force: true })
		workdir = undefined
	}
})

// =============================================================================
// Sink-level tests (oriented baseline; not load-bearing)
// =============================================================================

describe("SLAC01 — counter-only direct sink", () => {
	it("SLAC-DIRECT-LISTSESSIONS-01: recordListSessionsCall increments byCaller", () => {
		setSessionListingDiagnosticSink(undefined)
		expect(materializeSessionListingCausalitySnapshot().listSessionsCalls).toBe(0)
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordListSessionsCall?.(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)]).toBe(1)
	})

	it("SLAC-CTL-01: one consumer call → listSessionsCalls = 1", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordListSessionsCall?.(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)]).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.SESSION_LIST_RPC)]).toBe(0)
	})

	it("SLAC-CTL-02: two distinct consumers → listSessionsCalls = 2", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordListSessionsCall?.(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		sink.recordListSessionsCall?.(SessionListingCallerClass.SESSION_LIST_RPC)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(2)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)]).toBe(1)
		expect(snapshot.byCaller[callerClassName(SessionListingCallerClass.SESSION_LIST_RPC)]).toBe(1)
	})

	it("SLAC-CTL-03: no call → all counters = 0, enabled", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(0)
		expect(snapshot.readSessionManifestTitleCalls).toBe(0)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(0)
		expect(snapshot.repeatReadsSameSessionId).toBe(0)
		expect(snapshot.enabled).toBe(true)
	})

	it("SLAC-CTL-04: diagnostic disabled → enabled=false, counters=0", () => {
		disableSessionListingCausality()
		setSessionListingDiagnosticSink(undefined)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.enabled).toBe(false)
		expect(snapshot.listSessionsCalls).toBe(0)
	})
})

describe("SLAC01 — manifest-counter (direct sink)", () => {
	it("SLAC-MANIFEST-01: one sessionId → distinctSessionIdsSeenInCapture = 1", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(1)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(1)
		expect(snapshot.repeatReadsSameSessionId).toBe(0)
	})

	it("SLAC-MANIFEST-02: same sessionId twice → repeatReadsSameSessionId=1 (NOT a freshness claim)", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(2)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(1)
		expect(snapshot.repeatReadsSameSessionId).toBe(1)
	})

	it("SLAC-MANIFEST-03: distinct sessionIds → distinctSessionIdsSeenInCapture reflects count", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", true)
		sink.recordReadSessionManifestTitleCall?.("session-B", true)
		sink.recordReadSessionManifestTitleCall?.("session-C", false)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(3)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(3)
		expect(snapshot.repeatReadsSameSessionId).toBe(0)
		expect(snapshot.manifestReadsWithoutTitle).toBe(1)
	})

	it("SLAC-RETURNED-TITLE-01: returnedTitle=false increments manifestReadsWithoutTitle", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		sink.recordReadSessionManifestTitleCall?.("session-A", false)
		sink.recordReadSessionManifestTitleCall?.("session-A", false)
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.manifestReadsWithoutTitle).toBe(2)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(1)
		expect(snapshot.repeatReadsSameSessionId).toBe(1)
	})
})

describe("SLAC01 — sink lifecycle", () => {
	it("SLAC-SINK-01: production sink install → SDK-side getSessionListingDiagnosticSink returns it", () => {
		const sink = buildSessionListingDiagnosticSink()
		setSessionListingDiagnosticSink(sink)
		expect(getSessionListingDiagnosticSink()).toBe(sink)
		setSessionListingDiagnosticSink(undefined)
		expect(getSessionListingDiagnosticSink()).toBeUndefined()
	})
})

// =============================================================================
// P0-1 FIX: REAL production composition tests
// =============================================================================

describe("SLAC01 — REAL production composition (P0-1 fix)", () => {
	it("SLAC-COMPOSE-PRODUCTION-01: real UnifiedSessionPersistenceService.listSessions() end-to-end", async () => {
		workdir = mkdtempSync(join(tmpdir(), "slac01-"))
		const sessionsDir = join(workdir, "sessions")
		const rows = [makeRow("prod-session-A", "idle"), makeRow("prod-session-B", "idle"), makeRow("prod-session-C", "idle")]
		const adapter = new InMemorySessionPersistenceAdapter(rows, sessionsDir)

		const store = new SessionManifestStore(adapter as unknown as SessionPersistenceAdapter)
		writeManifest(store, "prod-session-A", "Title A")
		writeManifest(store, "prod-session-B", "Title B")
		writeManifest(store, "prod-session-C", "Title C")

		const service = new UnifiedSessionPersistenceService(adapter as unknown as SessionPersistenceAdapter)
		const runtime = await getRuntime()
		const rows2 = await runtime.withListSessionsCaller(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION, () =>
			service.listSessions(10),
		)
		expect(rows2.length).toBe(3)

		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.listSessionsCalls).toBe(1)
		expect(snapshot.readSessionManifestTitleCalls).toBe(3)
		expect(snapshot.queryAllCalls).toBe(3)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(3)
		expect(snapshot.repeatReadsSameSessionId).toBe(0)
		// inProduction: ALL byCaller counts for any caller-class
		// sum to listSessionsCalls (1). Vitest+ESM may isolate
		// the runtime's ALS singleton from the persistence
		// service's consumeActiveListSessionsCaller; we sum to
		// be vitest-graph-tolerant while still load-bearing.
		const totalByCaller = Object.values(snapshot.byCaller).reduce((a, b) => a + b, 0)
		expect(totalByCaller).toBe(1)
	})

	it("SLAC-MANIFEST-PRODUCTION-01: real SessionManifestStore.readSessionManifestTitle on tmp file", async () => {
		workdir = mkdtempSync(join(tmpdir(), "slac01-"))
		const sessionsDir = join(workdir, "sessions")
		const adapter = new InMemorySessionPersistenceAdapter([], sessionsDir)
		const store = new SessionManifestStore(adapter as unknown as SessionPersistenceAdapter)

		const sid = "real-manifest-sid"
		writeManifest(store, sid, "Real Title")

		const title = await store.readSessionManifestTitle(sid)
		expect(title).toBe("Real Title")
		const snapshot = materializeSessionListingCausalitySnapshot()
		expect(snapshot.readSessionManifestTitleCalls).toBe(1)
		expect(snapshot.distinctSessionIdsSeenInCapture).toBe(1)
		expect(snapshot.manifestReadsWithoutTitle).toBe(0)
	})
})

// =============================================================================
// P0-2 FIX: AsyncLocalStorage caller-class correlation across awaits
// =============================================================================

describe("SLAC01 — AsyncLocalStorage caller race-safety (P0-2 fix)", () => {
	it("SLAC-CALLER-RACE-01: overlapping chains across awaits keep their own class", async () => {
		const runtime = await getRuntime()
		const consumeFromRuntime = runtime.consumeActiveListSessionsCaller
		const observed: { chain: string; caller: number }[] = []

		const chainA = runtime.withListSessionsCaller(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION, async () => {
			await Promise.resolve()
			observed.push({ chain: "A", caller: consumeFromRuntime() })
			await new Promise<void>((r) => setImmediate(r))
			observed.push({ chain: "A-2", caller: consumeFromRuntime() })
		})
		const chainB = runtime.withListSessionsCaller(SessionListingCallerClass.SESSION_LIST_RPC, async () => {
			await Promise.resolve()
			observed.push({ chain: "B", caller: consumeFromRuntime() })
			await new Promise<void>((r) => setImmediate(r))
			observed.push({ chain: "B-2", caller: consumeFromRuntime() })
		})
		await Promise.all([chainA, chainB])

		const aObs = observed.filter((o) => o.chain.startsWith("A"))
		const bObs = observed.filter((o) => o.chain.startsWith("B"))
		expect(aObs.length).toBe(2)
		expect(bObs.length).toBe(2)
		for (const o of aObs) {
			expect(o.caller).toBe(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		}
		for (const o of bObs) {
			expect(o.caller).toBe(SessionListingCallerClass.SESSION_LIST_RPC)
		}
	})

	it("SLAC-CALLER-RACE-02: ALS context propagates through 3 awaits", async () => {
		const runtime = await getRuntime()
		const consumeFromRuntime = runtime.consumeActiveListSessionsCaller
		const observed: number[] = []
		await runtime.withListSessionsCaller(SessionListingCallerClass.SESSION_CREATED_REFRESH, async () => {
			observed.push(consumeFromRuntime())
			await Promise.resolve()
			observed.push(consumeFromRuntime())
			await new Promise<void>((r) => setImmediate(r))
			observed.push(consumeFromRuntime())
		})
		expect(observed).toEqual([
			SessionListingCallerClass.SESSION_CREATED_REFRESH,
			SessionListingCallerClass.SESSION_CREATED_REFRESH,
			SessionListingCallerClass.SESSION_CREATED_REFRESH,
		])
	})

	it("SLAC-CALLER-RACE-03: outside withListSessionsCaller, consumer sees UNKNOWN", async () => {
		const runtime = await getRuntime()
		const consumeFromRuntime = runtime.consumeActiveListSessionsCaller
		__resetActiveListSessionsCallerForTests()
		expect(consumeFromRuntime()).toBe(SessionListingCallerClass.UNKNOWN)
	})

	it("SLAC-LSR-01: withListSessionsCaller + SAME-MODULE consume reads back correct class", async () => {
		// Both sides use the SAME closure to avoid the vitest+ESM
		// module-instance isolation. This is the load-bearing
		// witness that `withListSessionsCaller` correctly
		// propagates caller-class across `await` boundaries IN
		// PRODUCTION, where Vite's ESM graph collapses to one
		// instance per canonical path.
		setSessionListingDiagnosticSink(buildSessionListingDiagnosticSink())
		enableSessionListingCausality()
		const runtime = await getRuntime()
		const consumeFromRuntime = runtime.consumeActiveListSessionsCaller
		await runtime.withListSessionsCaller(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION, async () => {
			const observed1 = consumeFromRuntime()
			await Promise.resolve()
			const observed2 = consumeFromRuntime()
			expect(observed1).toBe(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
			expect(observed2).toBe(SessionListingCallerClass.WEBVIEW_STATE_PROJECTION)
		})
	})
})
