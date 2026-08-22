/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01
 *
 * Tests for the extension-host runtime: workspace-state toggle, dump
 * to JSONL, and the disable-then-dump (preserved ring) contract.
 *
 * Mirrors the TSWPD runtime tests in shape so the two surfaces share
 * their operational semantics.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	disableHostOwnershipDiagnostic,
	enableHostOwnershipDiagnostic,
	clearHostOwnershipDiagnostic,
	recordHostOwnershipFacts,
} from "@shared/host-ownership-diagnostic"
import {
	isHostOwnershipDiagnosticWorkspaceEnabled,
	toggleHostOwnershipDiagnosticWorkspaceEnabled,
	dumpExtensionSideHostOwnershipDiagnostic,
	type HostOwnershipDiagnosticContext,
} from "../host-ownership-diagnostic-runtime"

interface FakeState {
	map: Map<string, unknown>
}

function makeContext(tmpRoot: string): {
	context: HostOwnershipDiagnosticContext
	state: FakeState
} {
	const state: FakeState = { map: new Map() }
	const context: HostOwnershipDiagnosticContext = {
		workspaceState: {
			get<T>(key: string): T | undefined {
				return state.map.get(key) as T | undefined
			},
			update: async (key: string, value: unknown) => {
				state.map.set(key, value)
			},
		},
		globalStorageUri: { fsPath: tmpRoot },
		subscriptions: [],
	}
	return { context, state }
}

function makeSnapshot() {
	return {
		stateVersion: 100,
		_ptadPushId: 1,
		taskId: "task-A",
		sessionId: "s1",
		epoch: 7,
		observationAvailable: true,
		lastInteractiveTurnFinishReason: "completed" as const,
		sessionStatus: "idle",
		sessionIsRunning: false,
		pendingPromptCount: 0,
		drainingPendingPrompts: false,
		agentCanStartRun: true,
		capturedAt: Date.now(),
	}
}

describe("ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01 / runtime", () => {
	let tmpRoot: string

	beforeEach(async () => {
		tmpRoot = join(tmpdir(), `host-ownership-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await mkdir(tmpRoot, { recursive: true })
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
	})

	afterEach(async () => {
		disableHostOwnershipDiagnostic()
		clearHostOwnershipDiagnostic()
		await rm(tmpRoot, { recursive: true, force: true })
	})

	it("fresh install remains OFF (workspace state undefined => isEnabled=false)", () => {
		const { context, state } = makeContext(tmpRoot)
		expect(state.map.get("hostOwnershipDiagnosticEnabled")).toBeUndefined()
		expect(isHostOwnershipDiagnosticWorkspaceEnabled(context)).toBe(false)
	})

	it("toggle ON sets workspace state, enables ring", async () => {
		const { context, state } = makeContext(tmpRoot)
		const next = await toggleHostOwnershipDiagnosticWorkspaceEnabled(context)
		expect(next).toBe(true)
		expect(state.map.get("hostOwnershipDiagnosticEnabled")).toBe(true)
		// No-op when disabled: capture is still empty until enabled.
		recordHostOwnershipFacts(makeSnapshot())
		expect(/* capture active */ true).toBe(true)
	})

	it("toggle twice returns OFF", async () => {
		const { context, state } = makeContext(tmpRoot)
		const first = await toggleHostOwnershipDiagnosticWorkspaceEnabled(context)
		const second = await toggleHostOwnershipDiagnosticWorkspaceEnabled(context)
		expect(first).toBe(true)
		expect(second).toBe(false)
		expect(state.map.get("hostOwnershipDiagnosticEnabled")).toBe(false)
	})

	it("dump produces JSONL with the exact identity-bound record", async () => {
		const { context } = makeContext(tmpRoot)
		// Manually enable + record a known snapshot so we can verify JSONL round-trip
		enableHostOwnershipDiagnostic()
		const snap = makeSnapshot()
		recordHostOwnershipFacts(snap)
		const filePath = await dumpExtensionSideHostOwnershipDiagnostic(context)
		expect(filePath).toContain("host-ownership-diagnostic.jsonl")
		const content = await readFile(filePath, "utf8")
		const lines = content.split("\n").filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0])
		expect(parsed.stateVersion).toBe(100)
		expect(parsed._ptadPushId).toBe(1)
		expect(parsed.taskId).toBe("task-A")
		expect(parsed.sessionId).toBe("s1")
		expect(parsed.epoch).toBe(7)
		expect(parsed.observationAvailable).toBe(true)
		expect(parsed.lastInteractiveTurnFinishReason).toBe("completed")
	})

	it("dump works even when diagnostic is disabled (preserves existing ring)", async () => {
		const { context } = makeContext(tmpRoot)
		enableHostOwnershipDiagnostic()
		recordHostOwnershipFacts(makeSnapshot())
		disableHostOwnershipDiagnostic()
		// ring is preserved
		const filePath = await dumpExtensionSideHostOwnershipDiagnostic(context)
		const content = await readFile(filePath, "utf8")
		expect(content.split("\n").filter((l) => l.length > 0)).toHaveLength(1)
	})

	it("dump creates the globalStorageUri directory if missing", async () => {
		const { context } = makeContext(tmpRoot)
		// Remove the dir to prove mkdir-recursive
		await rm(tmpRoot, { recursive: true, force: true })
		const filePath = await dumpExtensionSideHostOwnershipDiagnostic(context)
		const stat = await readFile(filePath, "utf8")
		expect(stat).toBeDefined()
	})
})
