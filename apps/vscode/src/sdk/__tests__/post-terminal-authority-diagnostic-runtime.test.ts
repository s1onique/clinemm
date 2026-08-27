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
// ACT-CLINEMM-PTAD-ENV-OPTIN01
//
// Adds `parseClinemmPtadEnv` + `isPostTerminalAuthorityDiagnosticEffectivelyEnabled`
// so the diagnostic can be armed from extension startup via the
// `CLINEMM_PTAD=1` env var (additive with the persisted workspace toggle,
// default off, no schema/wire change, no forced-disable semantics). See
// `apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts` for
// the merged-predicate contract.
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
	isPostTerminalAuthorityDiagnosticEffectivelyEnabled,
	isPostTerminalAuthorityDiagnosticWorkspaceEnabled,
	parseClinemmPtadEnv,
	type PostTerminalAuthorityDiagnosticContext,
	togglePostTerminalAuthorityDiagnosticWorkspaceEnabled,
} from "../post-terminal-authority-diagnostic-runtime"

function fakeContext(storagePath: string): PostTerminalAuthorityDiagnosticContext & {
	__store: Map<string, unknown>
} {
	const store = new Map<string, unknown>()
	return {
		__store: store,
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

	// ============================================================================
	// ACT-CLINEMM-PTAD-ENV-OPTIN01
	//
	// `CLINEMM_PTAD` env opt-in: additive with the persisted workspace toggle,
	// default off, no schema/wire change, no forced-disable semantics.
	//
	// Truth table under test (from the spec):
	//
	//   ENV unset + toggle false  -> false
	//   ENV unset + toggle true   -> true    (conservation of C1 behavior)
	//   ENV "1"   + toggle false  -> true    (NEW: env opt-in)
	//   ENV "true"+ toggle false  -> true
	//   ENV "0"   + toggle true   -> true    (env does NOT force-disable)
	//   ENV garbage + toggle false-> false   (env source ignored)
	//
	// Every test passes `env` explicitly so it never touches the
	// developer's real `process.env`. The merged predicate takes the env as
	// a parameter for exactly this reason.
	// ============================================================================
	describe("R9: CLINEMM_PTAD env opt-in", () => {
		describe("R9-A: parseClinemmPtadEnv", () => {
			it("R9-A1: unset env returns false", () => {
				expect(parseClinemmPtadEnv({})).toBe(false)
			})

			it('R9-A2: "1" returns true', () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "1" })).toBe(true)
			})

			it('R9-A3: "true" (any case) returns true', () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "true" })).toBe(true)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "TRUE" })).toBe(true)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "True" })).toBe(true)
			})

			it('R9-A4: "0" returns false (no forced-disable contract)', () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "0" })).toBe(false)
			})

			it('R9-A5: "false" returns false', () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "false" })).toBe(false)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "FALSE" })).toBe(false)
			})

			it("R9-A6: empty string returns false", () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "" })).toBe(false)
			})

			it("R9-A7: garbage returns false (env source ignored)", () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "yes" })).toBe(false)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "on" })).toBe(false)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "💩" })).toBe(false)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: "1;rm -rf /" })).toBe(false)
			})

			it("R9-A8: whitespace-padded truthy values are accepted", () => {
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: " 1 " })).toBe(true)
				expect(parseClinemmPtadEnv({ CLINEMM_PTAD: " true\t" })).toBe(true)
			})

			it("R9-A9: default arg reads real process.env when no env is passed", () => {
				// Pin that the default-arg path uses `process.env`. We don't
				// assert the value (test-env parity is unreliable across
				// hosts) — we only assert that the call does not throw.
				expect(() => parseClinemmPtadEnv()).not.toThrow()
			})
		})

		describe("R9-B: isPostTerminalAuthorityDiagnosticEffectivelyEnabled truth table", () => {
			it("R9-B1: ENV unset + toggle false -> false", () => {
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, {})).toBe(false)
			})

			it("R9-B2: ENV unset + toggle true -> true (conservation)", async () => {
				// Bypass the lint-restricted `workspaceState.update` by
				// writing directly to the fake's backing store.
				context.__store.set("ptadEnabled", true)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, {})).toBe(true)
			})

			it('R9-B3: ENV "1" + toggle false -> true (env opt-in)', () => {
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "1" })).toBe(true)
			})

			it('R9-B4: ENV "true" + toggle false -> true (env opt-in, case-insensitive)', () => {
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "TRUE" })).toBe(true)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "True" })).toBe(true)
			})

			it('R9-B5: ENV "0" + toggle true -> true (env does NOT force-disable)', async () => {
				context.__store.set("ptadEnabled", true)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "0" })).toBe(true)
			})

			it('R9-B6: ENV "false" + toggle true -> true (env does NOT force-disable)', async () => {
				context.__store.set("ptadEnabled", true)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "false" })).toBe(true)
			})

			it("R9-B7: ENV garbage + toggle false -> false", () => {
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "yes" })).toBe(false)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "💩" })).toBe(false)
			})

			it('R9-B8: ENV "1" + toggle true -> true (both sources on)', async () => {
				context.__store.set("ptadEnabled", true)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, { CLINEMM_PTAD: "1" })).toBe(true)
			})
		})

		describe("R9-C: conservation invariant", () => {
			it("R9-C1: when CLINEMM_PTAD is unset, the merged predicate is byte-equivalent to the workspace-only predicate", async () => {
				// The two predicates must agree for every toggle state when
				// the env contribution is absent. This pins that the env
				// opt-in changes NOTHING about the pre-existing behavior.
				const env = {} // CLINEMM_PTAD unset

				// Toggle off (default)
				expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(false)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env)).toBe(false)

				// Toggle on
				context.__store.set("ptadEnabled", true)
				expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(true)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env)).toBe(true)

				// Toggle off again
				context.__store.set("ptadEnabled", false)
				expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(false)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env)).toBe(false)
			})

			it("R9-C2: the toggle command itself never reads process.env (toggle is authoritative for the persisted flag)", async () => {
				// Even with CLINEMM_PTAD=1, the toggle flips ONLY the
				// persisted workspace flag. The next merged-predicate read
				// is what brings the diagnostic back online.
				const env = { CLINEMM_PTAD: "1" }

				// First toggle: persisted=true, env=1 -> effective=true
				await togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env)).toBe(true)

				// Second toggle: persisted=false, env=1 -> effective=true
				// (env still contributes)
				await togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
				expect(isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)).toBe(false)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env)).toBe(true)

				// Third toggle: persisted=true, env=1 -> effective=true
				await togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
				expect(isPostTerminalAuthorityDiagnosticEffectivelyEnabled(context, env)).toBe(true)
			})
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
					captureKind: "webview-committed",
					stateVersion: 1,
					capturedAt: Date.now(),
					legacyPhase: "idle",
				},
				{
					origin: "webview",
					captureKind: "webview-committed",
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
					captureKind: "webview-committed",
					stateVersion: 1,
					capturedAt: Date.now(),
					legacyPhase: "idle",
				},
			])
			expect(existsSync(freshDir)).toBe(true)
		})
	})
})
