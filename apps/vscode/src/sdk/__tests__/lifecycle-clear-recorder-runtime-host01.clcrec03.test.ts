/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01 — CALLER-REASON DISCRIMINATOR.
 *
 * Wiring-invariant tests for the lifecycle-clear dump command AND the
 * host-side dump runtime. Mirrors the CCDCO01 / CCNTUP / EHLOOP /
 * ELM-SHADOW / ELM-AUTHORITY wiring invariant tests so the four production
 * wiring layers — `package.json` declaration, `registry.ts` command id,
 * `extension.ts:activate` registration, AND the host-side dump runtime —
 * cannot silently disappear in a future refactor without turning these
 * tests RED.
 *
 * The dump is a DIAGNOSTIC seam: it serializes the existing
 * `getLifecycleClearSnapshot()` snapshot to
 * <globalStorageUri>/lifecycle-clear.counters.json. It does NOT change
 * lifecycle semantics, the clear funnel, or any protocol surface. It
 * exists only so an operator can identify which of the 10 bounded
 * `LifecycleClearReason` enum values fired in the failing LIVE run.
 *
 * REMOVAL_TRIGGER: first of (a) root cause isolated (LIVE classifies an
 * exact `lastClearReason`), (b) capture insufficient (successor counter
 * design required), (c) successor evidence supersedes. On removal,
 * this test file + the registry entry + the package.json declaration +
 * the extension.ts handler + the host dump runtime + the production
 * recorder MUST be removed TOGETHER.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")

describe("CLCREC03 — production activation wiring exists in extension.ts + registry.ts + package.json", () => {
	test("CLCREC03.A: registry.ts exposes DumpLifecycleClear command id", () => {
		const regPath = path.resolve(REPO_ROOT, "apps/vscode/src/registry.ts")
		const source = fs.readFileSync(regPath, "utf8")
		expect(source).toMatch(/DumpLifecycleClear\s*:\s*prefix\s*\+/)
	})

	test("CLCREC03.B: extension.ts:activate registers DumpLifecycleClear as a command", () => {
		const extPath = path.resolve(REPO_ROOT, "apps/vscode/src/extension.ts")
		const source = fs.readFileSync(extPath, "utf8")
		expect(source).toMatch(/DumpLifecycleClear/)
		expect(source).toMatch(/dumpExtensionSideLifecycleClearSnapshot/)
	})

	test("CLCREC03.C: package.json declares the dump command for the contribution point", () => {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, "apps/vscode/package.json"), "utf8")) as {
			contributes?: { commands?: Array<{ command?: string; title?: string }> }
		}
		const entries = pkg.contributes?.commands ?? []
		const entry = entries.find((c) => c.command === "cline.debug.dumpLifecycleClear")
		expect(entry).toBeDefined()
		expect(entry?.title).toBe("Cline Debug: Dump Lifecycle Clear")
	})

	test("CLCREC03.D: host-side dump runtime module exists and serializes the snapshot", () => {
		const runtimePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/lifecycle-clear-recorder-runtime-host.ts")
		expect(fs.existsSync(runtimePath)).toBe(true)
		const source = fs.readFileSync(runtimePath, "utf8")
		expect(source).toMatch(/getLifecycleClearSnapshot/)
		expect(source).toMatch(/lifecycle-clear\.counters\.json/)
		// dump must not call the test-only reset; mirrors the
		// CCARD / CCDO / EHLOOP / SHADOW / ELM-AUTHORITY convention.
		expect(source).not.toMatch(/resetLifecycleClearSnapshot/)
	})

	test("CLCREC03.E: host dump writes a well-shaped JSON snapshot matching the diagnostic snapshot", async () => {
		const { dumpExtensionSideLifecycleClearSnapshot } = await import("../lifecycle-clear-recorder-runtime-host")
		const { resetLifecycleClearSnapshot, getLifecycleClearSnapshot } = await import("../lifecycle-clear-recorder")
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clcrec-dump-"))
		try {
			resetLifecycleClearSnapshot()
			const { countersFile, snapshot } = await dumpExtensionSideLifecycleClearSnapshot({
				globalStorageUri: { fsPath: tmpRoot },
			})
			expect(fs.existsSync(countersFile)).toBe(true)
			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>

			// `enabled` and `total` are ALWAYS serialized (never undefined
			// in the snapshot). `lastClearReason` and `lastUnrecognizedReason`
			// are deliberately `undefined` when nothing has been observed;
			// `JSON.stringify` drops `undefined` keys, so the on-disk file
			// contains ONLY the fields the operator can act on. This mirrors
			// the CCDO / CCNTUP contract where fresh-process counters
			// (`total: 0`, `lastOutcome: null`) ARE present on disk.
			const alwaysSerializedKeys = ["enabled", "total"] as const
			for (const k of alwaysSerializedKeys) {
				expect(parsed).toHaveProperty(k)
			}
			expect(snapshot).toMatchObject(parsed)

			// Fresh process: no clear observed (test runs in public
			// profile because the runner does NOT set
			// CLINEMM_RUNTIME_PROFILE=dogfood). The `enabled` flag
			// proves the gate is wired; `total: 0` proves the funnel
			// was not invoked.
			expect(snapshot.enabled).toBe(false)
			expect(snapshot.total).toBe(0)
			expect(snapshot.lastClearReason).toBeUndefined()
			expect(snapshot.lastUnrecognizedReason).toBeUndefined()

			// Cross-check: the snapshot the dump serialized matches
			// the live snapshot the recorder returns at the same moment.
			const live = getLifecycleClearSnapshot()
			expect(live.enabled).toBe(false)
			expect(live.total).toBe(0)
		} finally {
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)

	test("CLCREC03.F: host dump in dogfood profile surfaces the lastClearReason when present", async () => {
		const { dumpExtensionSideLifecycleClearSnapshot } = await import("../lifecycle-clear-recorder-runtime-host")
		const { resetLifecycleClearSnapshot, recordLifecycleClear, getLifecycleClearSnapshot } = await import(
			"../lifecycle-clear-recorder"
		)
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "clcrec-dump-dogfood-"))
		const prevProfile = process.env.CLINEMM_RUNTIME_PROFILE
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
		try {
			resetLifecycleClearSnapshot()
			// Dogfood profile — record one clear via the funnel reason.
			recordLifecycleClear("clearTask")
			recordLifecycleClear("dispose") // last-wins
			const beforeDump = getLifecycleClearSnapshot()
			expect(beforeDump.enabled).toBe(true)
			expect(beforeDump.total).toBe(2)
			expect(beforeDump.lastClearReason).toBe("dispose")

			const { countersFile, snapshot } = await dumpExtensionSideLifecycleClearSnapshot({
				globalStorageUri: { fsPath: tmpRoot },
			})
			expect(fs.existsSync(countersFile)).toBe(true)
			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>

			// In dogfood profile the meaningful keys are serialized.
			expect(parsed).toHaveProperty("enabled", true)
			expect(parsed).toHaveProperty("total", 2)
			expect(parsed).toHaveProperty("lastClearReason", "dispose")
			// After a recognized clear, `lastUnrecognizedReason` is
			// explicitly `undefined` (see lifecycle-clear-recorder.ts)
			// and JSON.stringify drops it. The dump still round-trips
			// the meaningful fields.
			expect(snapshot.lastClearReason).toBe("dispose")
			expect(snapshot.total).toBe(2)
			expect(snapshot.enabled).toBe(true)
		} finally {
			process.env.CLINEMM_RUNTIME_PROFILE = prevProfile
			resetLifecycleClearSnapshot()
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)
})
