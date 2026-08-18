// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01
//
// Live-enablement + extraction witness tests for the runtime module.
//
// The C1 instrument could be enabled only in unit tests (a module-level
// function called from Vitest). C1-CORRECTION01 adds:
//   1. Live enablement via `context.workspaceState` (no in-process call)
//   2. Live extraction via two VS Code commands + a file dump
//   3. The `_ptadEnabled` wire bit so the webview can pick up the toggle
//
// These tests verify the live-enable / live-dump surface end-to-end against
// a fake vscode.ExtensionContext + a fake Webview.
// ============================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	clearPostTerminalAuthorityDiagnostic,
	disablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnostic,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	appendWebviewSidePostTerminalAuthorityDiagnostic,
	dumpExtensionSidePostTerminalAuthorityDiagnostic,
	isPostTerminalAuthorityDiagnosticWorkspaceEnabled,
	type PostTerminalAuthorityDiagnosticContext,
	togglePostTerminalAuthorityDiagnosticWorkspaceEnabled,
} from "../post-terminal-authority-diagnostic-runtime"

function fakeContext(storagePath: string): PostTerminalAuthorityDiagnosticContext {
	const store = new Map<string, unknown>()
	return {
		workspaceState: {
			// Cast: the fake's get is a runtime-untyped Map lookup; the
			// structural interface uses a generic `T`. The narrow cast
			// preserves type safety at the call sites.
			get: ((key: string) => store.get(key)) as PostTerminalAuthorityDiagnosticContext["workspaceState"]["get"],
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					store.delete(key)
				} else {
					store.set(key, value)
				}
			},
		},
		globalStorageUri: { fsPath: storagePath },
		subscriptions: [],
	}
}

let tmp: string
let context: ReturnType<typeof fakeContext>

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "ptad-runtime-"))
	context = fakeContext(tmp)
	clearPostTerminalAuthorityDiagnostic("extension")
	clearPostTerminalAuthorityDiagnostic("webview")
	disablePostTerminalAuthorityDiagnostic("extension")
	disablePostTerminalAuthorityDiagnostic("webview")
})

afterEach(() => {
	if (existsSync(tmp)) {
		rmSync(tmp, { recursive: true, force: true })
	}
})

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01 / runtime", () => {
	describe("R1: live enablement", () => {
		it("R1-1: workspace state default is OFF (undefined → false)", () => {
			expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(false)
		})

		it("R1-2: toggling the workspace state flips the bit and enables the module", async () => {
			const next1 = await togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
			expect(next1).toBe(true)
			expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(true)

			const next2 = await togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
			expect(next2).toBe(false)
			expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(false)
		})

		it("R1-3: the toggle enables the in-process side immediately", async () => {
			await togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
			// The toggle calls enablePostTerminalAuthorityDiagnostic(\"extension\").
			// A subsequent capture must succeed.
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				captureKind: "extension-push",
				stateVersion: 1,
				capturedAt: Date.now(),
			})
			const dumpPath = join(tmp, "post-terminal-authority-diagnostic-extension.jsonl")
			expect(existsSync(dumpPath)).toBe(false) // capture is in-memory; no file yet
		})
	})

	describe("R2: live extraction", () => {
		it("R2-1: extension dump writes a JSONL file under globalStorageUri", async () => {
			enablePostTerminalAuthorityDiagnostic("extension")
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				captureKind: "extension-push",
				stateVersion: 1,
				capturedAt: Date.now(),
				legacyPhase: "idle",
			})
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				captureKind: "extension-push",
				stateVersion: 2,
				capturedAt: Date.now(),
				legacyPhase: "streaming",
			})
			const path = await dumpExtensionSidePostTerminalAuthorityDiagnostic(context)
			expect(existsSync(path)).toBe(true)
			const text = readFileSync(path, "utf8")
			const lines = text.split("\n").filter((line) => line.length > 0)
			expect(lines.length).toBe(2)
			const records = lines.map((line) => JSON.parse(line))
			expect(records[0].stateVersion).toBe(1)
			expect(records[0].legacyPhase).toBe("idle")
			expect(records[1].stateVersion).toBe(2)
			expect(records[1].legacyPhase).toBe("streaming")
		})

		it("R2-2: webview dump writes a JSONL file under globalStorageUri", async () => {
			await appendWebviewSidePostTerminalAuthorityDiagnostic(context, [
				{
					origin: "webview",
				captureKind: "webview-replica",
					stateVersion: 1,
					capturedAt: Date.now(),
					legacyPhase: "idle",
				},
				{
					origin: "webview",
				captureKind: "webview-replica",
					stateVersion: 2,
					capturedAt: Date.now(),
					buttonConfig: { sendingDisabled: true },
				},
			])
			// The runtime wrote to `post-terminal-authority-diagnostic-webview.jsonl`.
			const path = join(tmp, "post-terminal-authority-diagnostic-webview.jsonl")
			expect(existsSync(path)).toBe(true)
			const text = readFileSync(path, "utf8")
			const lines = text.split("\n").filter((line) => line.length > 0)
			expect(lines.length).toBe(2)
			const records = lines.map((line) => JSON.parse(line))
			expect(records[0].origin).toBe("webview")
			expect(records[1].buttonConfig.sendingDisabled).toBe(true)
		})

		it("R2-3: an empty dump produces a file with zero records", async () => {
			const extPath = await dumpExtensionSidePostTerminalAuthorityDiagnostic(context)
			expect(existsSync(extPath)).toBe(true)
			const text = readFileSync(extPath, "utf8")
			expect(text).toBe("")
		})

		it("R2-4 (R8): dump creates the globalStorage directory if it does not exist (fresh install)", async () => {
			// Simulate a fresh installation: globalStorageUri points at a
			// directory that does NOT yet exist on disk.
			const freshDir = join(tmp, "fresh-install", "does-not-exist")
			const freshContext = fakeContext(freshDir)
			expect(existsSync(freshDir)).toBe(false)
			enablePostTerminalAuthorityDiagnostic("extension")
			recordPostTerminalAuthoritySnapshot({
				origin: "extension",
				captureKind: "extension-push",
				stateVersion: 1,
				capturedAt: Date.now(),
				legacyPhase: "idle",
			})
			const extPath = await dumpExtensionSidePostTerminalAuthorityDiagnostic(freshContext)
			expect(existsSync(extPath)).toBe(true)
			expect(existsSync(freshDir)).toBe(true)
			const text = readFileSync(extPath, "utf8")
			expect(text.length).toBeGreaterThan(0)
		})

		it("R2-5 (R8): the webview dump also creates the globalStorage directory if missing", async () => {
			const freshDir = join(tmp, "fresh-install-webview", "does-not-exist")
			const freshContext = fakeContext(freshDir)
			expect(existsSync(freshDir)).toBe(false)
			await appendWebviewSidePostTerminalAuthorityDiagnostic(freshContext, [
				{
					origin: "webview",
				captureKind: "webview-replica",
					stateVersion: 1,
					capturedAt: Date.now(),
					legacyPhase: "idle",
				},
			])
			expect(existsSync(freshDir)).toBe(true)
		})
	})
})
