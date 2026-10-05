/**
 * ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-DUMP-COMMAND-SURFACE01
 *
 * Wiring-invariant tests for the MYC prime live diagnostic dump
 * command AND the host-side dump runtime. Mirrors the CLCREC03 /
 * CCARD / CCDO / CCNTUP / EHLOOP / ELM-SHADOW / ELM-AUTHORITY
 * wiring invariant tests so the four production wiring layers —
 * `package.json` declaration, `registry.ts` command id,
 * `extension.ts:activate` registration, AND the host-side dump
 * runtime — cannot silently disappear in a future refactor without
 * turning these tests RED.
 *
 * The dump is a DIAGNOSTIC seam: it serializes the existing
 * `getMycPrimeLiveDiag(sessionId)` snapshot to
 * <globalStorageUri>/myc-prime-live.counters.json. It does NOT
 * change prime injection semantics, the diagnostic singleton, or any
 * protocol surface. It exists only so an operator can identify
 * which of the four MYC03 §17 boundary buckets (acquisition,
 * lookup, injection, capture) is empty when the production hook bag
 * fires.
 *
 * REMOVAL_TRIGGER: first successful LIVE binding of MYC03, OR
 * CAPTURE_INSUFFICIENT, OR successor evidence supersedes. On
 * removal, this test file + the registry entry + the package.json
 * declaration + the extension.ts handler + the host dump runtime +
 * the production recorder MUST be removed TOGETHER.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")
describe("MPDIAG01 — production activation wiring exists in extension.ts + registry.ts + package.json", () => {
	test("MPDIAG01.A: registry.ts exposes DumpMycPrimeLiveDiagnostic command id", () => {
		const regPath = path.resolve(REPO_ROOT, "apps/vscode/src/registry.ts")
		const source = fs.readFileSync(regPath, "utf8")
		expect(source).toMatch(/DumpMycPrimeLiveDiagnostic\s*:\s*prefix\s*\+/)
	})

	test("MPDIAG01.B: extension.ts:activate registers DumpMycPrimeLiveDiagnostic as a command", () => {
		const extPath = path.resolve(REPO_ROOT, "apps/vscode/src/extension.ts")
		const source = fs.readFileSync(extPath, "utf8")
		expect(source).toMatch(/DumpMycPrimeLiveDiagnostic/)
		expect(source).toMatch(/dumpExtensionSideMycPrimeLiveDiag/)
		// The handler must resolve the sessionId from the controller's
		// active task (NOT from a manually typed argument) — manually
		// typing the session id would weaken the exact identity proof
		// MYC03 needs. See the implementation comments.
		expect(source).toMatch(/controller\?\.task\?\.taskId/)
	})

	test("MPDIAG01.C: package.json declares the dump command for the contribution point", () => {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, "apps/vscode/package.json"), "utf8")) as {
			contributes?: { commands?: Array<{ command?: string; title?: string }> }
		}
		const entries = pkg.contributes?.commands ?? []
		const entry = entries.find((c) => c.command === "cline.debug.dumpMycPrimeLiveDiagnostic")
		expect(entry).toBeDefined()
		expect(entry?.title).toBe("Cline Debug: Dump myc Prime Diagnostic")
	})

	test("MPDIAG01.D: host-side dump runtime module exists and serializes the snapshot", () => {
		const runtimePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/myc-prime-live-diag-runtime-host.ts")
		expect(fs.existsSync(runtimePath)).toBe(true)
		const source = fs.readFileSync(runtimePath, "utf8")
		expect(source).toMatch(/getMycPrimeLiveDiag/)
		expect(source).toMatch(/myc-prime-live\.counters\.json/)
		// dump must not call the test-only reset; mirrors the
		// CCARD / CCDO / EHLOOP / SHADOW / ELM-AUTHORITY /
		// Lifecycle-Clear dump convention (dump != clear).
		expect(source).not.toMatch(/__resetMycPrimeLiveDiagForTests/)
	})
})
describe("MPDIAG01.E — host dump writes a well-shaped envelope (public profile)", () => {
	const originalProfile = process.env.CLINEMM_RUNTIME_PROFILE

	beforeEach(async () => {
		const { __resetMycPrimeLiveDiagForTests } = await import("../myc-prime-live-diag")
		__resetMycPrimeLiveDiagForTests()
		delete process.env.CLINEMM_MYC_PRIME_DIAG
		process.env.CLINEMM_RUNTIME_PROFILE = "public"
	})

	afterEach(async () => {
		const { __resetMycPrimeLiveDiagForTests } = await import("../myc-prime-live-diag")
		__resetMycPrimeLiveDiagForTests()
		if (originalProfile === undefined) {
			delete process.env.CLINEMM_RUNTIME_PROFILE
		} else {
			process.env.CLINEMM_RUNTIME_PROFILE = originalProfile
		}
	})

	test("MPDIAG01.E1: no active session → sessionIdPresent=false, snapshot absent", async () => {
		const { dumpExtensionSideMycPrimeLiveDiag } = await import("../myc-prime-live-diag-runtime-host")
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mpdiag-dump-noactive-"))
		try {
			const { countersFile, result } = await dumpExtensionSideMycPrimeLiveDiag(
				{ globalStorageUri: { fsPath: tmpRoot } },
				undefined,
			)
			expect(fs.existsSync(countersFile)).toBe(true)
			expect(result.sessionIdPresent).toBe(false)
			expect(result.snapshotPresent).toBe(false)
			expect(result.snapshot).toBeUndefined()

			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>
			expect(parsed).toMatchObject({ sessionIdPresent: false, snapshotPresent: false })
			expect(parsed).not.toHaveProperty("snapshot")
		} finally {
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)

	test("MPDIAG01.E2: active session, diagnostic OFF → sessionIdPresent=true, snapshot absent", async () => {
		const { dumpExtensionSideMycPrimeLiveDiag } = await import("../myc-prime-live-diag-runtime-host")
		const { getMycPrimeLiveDiag } = await import("../myc-prime-live-diag")
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mpdiag-dump-off-"))
		try {
			// diagnostic OFF (public profile + no env override) → live
			// snapshot is undefined.
			expect(getMycPrimeLiveDiag("hs-mpdiag01-e2")).toBeUndefined()

			const { countersFile, result } = await dumpExtensionSideMycPrimeLiveDiag(
				{ globalStorageUri: { fsPath: tmpRoot } },
				"hs-mpdiag01-e2",
			)
			expect(fs.existsSync(countersFile)).toBe(true)
			expect(result.sessionIdPresent).toBe(true)
			expect(result.snapshotPresent).toBe(false)
			expect(result.snapshot).toBeUndefined()

			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>
			expect(parsed).toMatchObject({ sessionIdPresent: true, snapshotPresent: false })
			expect(parsed).not.toHaveProperty("snapshot")
		} finally {
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)
})

describe("MPDIAG01.F — host dump in dogfood profile round-trips a recorded snapshot", () => {
	const originalProfile = process.env.CLINEMM_RUNTIME_PROFILE
	const originalEnv = process.env.CLINEMM_MYC_PRIME_DIAG

	beforeEach(async () => {
		const { __resetMycPrimeLiveDiagForTests } = await import("../myc-prime-live-diag")
		__resetMycPrimeLiveDiagForTests()
		// NOTE on activation path: in production the central dogfood
		// profile resolver (`applyMycPrimeLiveDiagDiagnosticProfile`)
		// arms the module-level enablement seam via
		// `setMycPrimeLiveDiagEnabled(true)` at extension activation;
		// the resolver also honors `CLINEMM_RUNTIME_PROFILE=dogfood`
		// as a default-ON signal. This unit test bypasses the resolver
		// (the host-side dump adapter is `vscode`-free and runs as a
		// pure module) and arms the diagnostic via the legacy env-flag
		// fallback documented in `isMycPrimeLiveDiagEnabled()` — the
		// fallback is only honored when the module-level boolean has
		// never been touched. The dump adapter itself does NOT depend
		// on HOW the diagnostic was armed; it only reads
		// `getMycPrimeLiveDiag(sessionId)`.
		process.env.CLINEMM_MYC_PRIME_DIAG = "1"
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
	})

	afterEach(async () => {
		const { __resetMycPrimeLiveDiagForTests } = await import("../myc-prime-live-diag")
		__resetMycPrimeLiveDiagForTests()
		if (originalProfile === undefined) {
			delete process.env.CLINEMM_RUNTIME_PROFILE
		} else {
			process.env.CLINEMM_RUNTIME_PROFILE = originalProfile
		}
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_MYC_PRIME_DIAG
		} else {
			process.env.CLINEMM_MYC_PRIME_DIAG = originalEnv
		}
	})

	test("MPDIAG01.F1: recorded four-section snapshot is serialized verbatim, dump != clear", async () => {
		const { dumpExtensionSideMycPrimeLiveDiag } = await import("../myc-prime-live-diag-runtime-host")
		const {
			__resetMycPrimeLiveDiagForTests,
			getMycPrimeLiveDiag,
			recordMycPrimeLiveAcquisition,
			recordMycPrimeLiveCapture,
			recordMycPrimeLiveInjection,
			recordMycPrimeLiveLookup,
			startMycPrimeLiveDiag,
		} = await import("../myc-prime-live-diag")
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "mpdiag-dump-dogfood-"))

		const sessionId = "hs-mpdiag01-f1"
		startMycPrimeLiveDiag(sessionId)
		recordMycPrimeLiveAcquisition(sessionId, {
			attempted: true,
			serverDetected: true,
			status: "ok",
			textPresent: true,
			textBytes: 1234,
			phase: "tool_call",
			sessionConnectionStatus: "spawned",
			toolFound: true,
		})
		recordMycPrimeLiveLookup(sessionId, {
			attempted: true,
			snapshotSessionIdPresent: true,
			matchedRecordedSession: true,
			recordedPrimeFound: true,
			iteration: 1,
		})
		recordMycPrimeLiveInjection(sessionId, {
			attempted: true,
			injected: true,
			reason: "ok",
			packetBytes: 5678,
			iteration: 1,
		})
		recordMycPrimeLiveCapture(sessionId, {
			captureId: "mycprime-test-capture",
			aiSdkPromptObserved: true,
		})

		try {
			const liveBeforeDump = getMycPrimeLiveDiag(sessionId)
			expect(liveBeforeDump).toBeDefined()

			const { countersFile, result } = await dumpExtensionSideMycPrimeLiveDiag(
				{ globalStorageUri: { fsPath: tmpRoot } },
				sessionId,
			)
			expect(fs.existsSync(countersFile)).toBe(true)
			expect(result.sessionIdPresent).toBe(true)
			expect(result.snapshotPresent).toBe(true)
			expect(result.snapshot).toBeDefined()

			// dump != clear: the live snapshot survives untouched.
			const liveAfterDump = getMycPrimeLiveDiag(sessionId)
			expect(liveAfterDump).toBeDefined()
			expect(liveAfterDump?.injection.injected).toBe(true)
			expect(liveAfterDump?.capture?.captureId).toBe("mycprime-test-capture")

			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>
			expect(parsed).toMatchObject({ sessionIdPresent: true, snapshotPresent: true })
			const inner = parsed.snapshot as Record<string, unknown>
			expect(inner).toMatchObject({
				sessionId,
				acquisition: {
					attempted: true,
					serverDetected: true,
					status: "ok",
					textPresent: true,
					textBytes: 1234,
				},
				lookup: {
					attempted: true,
					snapshotSessionIdPresent: true,
					matchedRecordedSession: true,
					recordedPrimeFound: true,
				},
				injection: {
					attempted: true,
					injected: true,
					reason: "ok",
					packetBytes: 5678,
				},
				capture: {
					captureId: "mycprime-test-capture",
					aiSdkPromptObserved: true,
				},
			})
		} finally {
			__resetMycPrimeLiveDiagForTests()
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)
})
