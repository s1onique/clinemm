/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-sixth-pass) — unit tests for the temporary
 * Q1..Q4 W-carrier trace observer.
 *
 * The diagnostic is DEFAULT OFF; these tests cover the
 * gate, the buffer, and the dump semantics. Production
 * code never reads the trace unless the workspace-state
 * toggle OR the env var is set.
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	_resetWCarrierTrace,
	dumpWCarrierTrace,
	isWCarrierTraceEnabled,
	parseClinemmWTraceEnv,
	recordWCarrierTrace,
	type WCarrierTraceContext,
} from "../w-carrier-trace-runtime"

function makeContext(): { ctx: WCarrierTraceContext; dir: string } {
	const dir = mkdtempSync(join(tmpdir(), "w-carrier-trace-test-"))
	const ctx: WCarrierTraceContext = {
		workspaceState: {
			get: () => undefined as never,
			update: async () => {},
		},
		globalStorageUri: { fsPath: dir },
		subscriptions: [],
	}
	return { ctx, dir }
}

describe("parseClinemmWTraceEnv", () => {
	const cases: Array<[string | undefined, boolean]> = [
		[undefined, false],
		["", false],
		["0", false],
		["false", false],
		["off", false],
		["garbage", false],
		["1", true],
		["true", true],
		["TRUE", true],
		["True", true],
		["  true  ", true],
	]
	for (const [input, expected] of cases) {
		it(`returns ${expected} for ${JSON.stringify(input)}`, () => {
			const env = input === undefined ? {} : { CLINEMM_W_TRACE: input }
			expect(parseClinemmWTraceEnv(env)).toBe(expected)
		})
	}
})

describe("WCarrierTraceContext default-off + opt-in", () => {
	let dirs: string[] = []
	beforeEach(() => {
		_resetWCarrierTrace()
	})
	afterEach(async () => {
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
		dirs = []
	})

	it("is disabled when neither workspace toggle nor env var is set", () => {
		const { ctx, dir } = makeContext()
		dirs.push(dir)
		expect(isWCarrierTraceEnabled(ctx)).toBe(false)
	})

	it("is enabled when workspaceState holds `true`", () => {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-trace-test-"))
		dirs.push(dir)
		const ctx: WCarrierTraceContext = {
			workspaceState: {
				get: <T>(key: string) => (key === "wCarrierTraceEnabled" ? (true as T) : undefined),
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		expect(isWCarrierTraceEnabled(ctx)).toBe(true)
	})

	it("is enabled when env var is '1'", () => {
		const { ctx, dir } = makeContext()
		dirs.push(dir)
		expect(isWCarrierTraceEnabled(ctx, { CLINEMM_W_TRACE: "1" })).toBe(true)
	})

	it("recordWCarrierTrace is a no-op when the diagnostic is disabled", async () => {
		const { ctx, dir } = makeContext()
		dirs.push(dir)
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "carrier_observe",
			sessionId: "session-a",
			carrierW: 42,
			eventType: "working-context-state-changed",
			snapshotW: 42,
		})
		expect(await dumpWCarrierTrace(ctx)).toBeUndefined()
	})

	it("records both row kinds and flushes them in order", async () => {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-trace-test-"))
		dirs.push(dir)
		const ctx: WCarrierTraceContext = {
			workspaceState: {
				get: <T>(key: string) => (key === "wCarrierTraceEnabled" ? (true as T) : undefined),
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		recordWCarrierTrace(ctx, {
			t: 100,
			kind: "carrier_observe",
			sessionId: "session-a",
			carrierW: 42,
			eventType: "working-context-state-changed",
			snapshotW: 42,
		})
		recordWCarrierTrace(ctx, {
			t: 200,
			kind: "state_publish",
			sessionId: "session-a",
			publishedW: 42,
		})
		recordWCarrierTrace(ctx, {
			t: 300,
			kind: "state_publish",
			sessionId: "session-a",
			publishedW: null,
		})
		const filePath = await dumpWCarrierTrace(ctx)
		expect(filePath).toBeDefined()
		expect(filePath).toBe(join(dir, "w-carrier-trace.jsonl"))
		const lines = readFileSync(filePath as string, "utf8")
			.trim()
			.split("\n")
		expect(lines).toHaveLength(3)
		expect(JSON.parse(lines[0])).toEqual({
			t: 100,
			kind: "carrier_observe",
			sessionId: "session-a",
			carrierW: 42,
			eventType: "working-context-state-changed",
			snapshotW: 42,
		})
		expect(JSON.parse(lines[1])).toEqual({
			t: 200,
			kind: "state_publish",
			sessionId: "session-a",
			publishedW: 42,
		})
		expect(JSON.parse(lines[2])).toEqual({
			t: 300,
			kind: "state_publish",
			sessionId: "session-a",
			publishedW: null,
		})
	})

	it("overwrites the file on each dump (single-snapshot semantics)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-trace-test-"))
		dirs.push(dir)
		const ctx: WCarrierTraceContext = {
			workspaceState: {
				get: <T>(key: string) => (key === "wCarrierTraceEnabled" ? (true as T) : undefined),
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "x",
			publishedW: 100,
		})
		await dumpWCarrierTrace(ctx)
		_resetWCarrierTrace()
		recordWCarrierTrace(ctx, {
			t: 2,
			kind: "state_publish",
			sessionId: "y",
			publishedW: 200,
		})
		await dumpWCarrierTrace(ctx)
		const lines = readFileSync(join(dir, "w-carrier-trace.jsonl"), "utf8").trim().split("\n")
		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0]).publishedW).toBe(200)
	})
})
