/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-seventh-pass) — unit tests for the temporary
 * Q1..Q4 W-carrier trace observer.
 *
 * The diagnostic is DEFAULT OFF; these tests cover the
 * frozen module seam semantics. The env-var precedence and
 * dogfood default are tested in
 * `dogfood-diagnostic-profile-w-carrier.test.ts`.
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
	recordWCarrierTrace,
	setWCarrierTraceEnabled,
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

describe("WCarrierTraceContext default-off + opt-in", () => {
	let dirs: string[] = []
	beforeEach(() => {
		_resetWCarrierTrace()
	})
	afterEach(async () => {
		await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})))
		dirs = []
	})

	it("is disabled by default (frozen seam OFF)", () => {
		expect(isWCarrierTraceEnabled()).toBe(false)
	})

	it("setWCarrierTraceEnabled flips the seam ON", () => {
		setWCarrierTraceEnabled(true)
		expect(isWCarrierTraceEnabled()).toBe(true)
	})

	it("setWCarrierTraceEnabled flips the seam back OFF (idempotent)", () => {
		setWCarrierTraceEnabled(true)
		setWCarrierTraceEnabled(false)
		expect(isWCarrierTraceEnabled()).toBe(false)
	})

	it("recordWCarrierTrace is a no-op when the seam is OFF", async () => {
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

	it("recordWCarrierTrace appends when the seam is ON", async () => {
		const dir = mkdtempSync(join(tmpdir(), "w-carrier-trace-test-"))
		dirs.push(dir)
		const ctx: WCarrierTraceContext = {
			workspaceState: {
				get: () => undefined as never,
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		setWCarrierTraceEnabled(true)
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
				get: () => undefined as never,
				update: async () => {},
			},
			globalStorageUri: { fsPath: dir },
			subscriptions: [],
		}
		setWCarrierTraceEnabled(true)
		recordWCarrierTrace(ctx, {
			t: 1,
			kind: "state_publish",
			sessionId: "x",
			publishedW: 100,
		})
		await dumpWCarrierTrace(ctx)
		_resetWCarrierTrace()
		setWCarrierTraceEnabled(true)
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
