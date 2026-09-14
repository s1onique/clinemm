/**
 * ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01 — C1 GREEN — kernel witness
 *
 * Bounded production repair: allow the Go default build cache to be
 * writable inside the Seatbelt sandbox, WITHOUT granting write
 * authority to the rest of the user's `~/Library/Caches` subtree.
 *
 * CORRECTED scope (post-CORRECTION01):
 *
 *   Pre-fix RED on this substrate (LIVE_UNOBSERVABLE_HERE):
 *     The local shell is itself sandboxed, so `sandbox-exec -f <profile>`
 *     cannot be invoked recursively (the nested sandbox_apply fails with
 *     EPERM at the OUTER level, BEFORE the inner profile even runs).
 *     This means we cannot locally reproduce the inner-EPERM witness;
 *     the STRONGLY_SUPPORTED root cause is that the prior profile did
 *     not contain any allowance for `<HOME>/Library/Caches/go-build`,
 *     so any Go invocation inside it would have failed.
 *
 *   Post-fix GREEN (this suite, when HAS_SUBSTRATE is true):
 *
 *     G1) mkdir under `<canonical HOME>/Library/Caches/go-build`
 *         inside the sandbox → exit 0. Necessity witness — the
 *         Seatbelt profile grants write authority to the canonical
 *         cache subtree.
 *
 *     G2) mkdir under sibling `<HOME>/Library/Caches/<not-go-build>`
 *         inside the sandbox → DENIED (EPERM, no path created).
 *         Conservation witness — the grant is subpath-scoped to
 *         `<cache>/go-build` ONLY; sibling subtrees under
 *         `~/Library/Caches/` MUST remain DENIED by `(deny default)`.
 *
 *     G3) `go env GOCACHE` (parent GOCACHE unset) reports the
 *         canonical `<HOME>/Library/Caches/go-build`, and a fresh
 *         write under it succeeds. End-to-end integration witness.
 *
 * Skip conditions: non-darwin host, /usr/bin/sandbox-exec not
 * available, or minimal sandbox-exec probe fails. When skipped,
 * the suite reports PASS-with-skip (NOT a regression).
 */

import { spawnSync } from "node:child_process"
import {
	existsSync,
	mkdtempSync,
	realpathSync,
	rmSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { CommandJobManager } from "../command-job-manager"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const SEATBELT_OPTIN = "seatbelt"

/**
 * Substrate check: darwin host + /usr/bin/sandbox-exec exists +
 * minimal profile round-trips. Tests skip (not pass) when false.
 */
const HAS_SUBSTRATE: boolean = (() => {
	if (process.platform !== "darwin") return false
	if (!existsSync("/usr/bin/sandbox-exec")) return false
	const probe = spawnSync(
		"/usr/bin/sandbox-exec",
		["-p", "(version 1)(allow default)", "/bin/echo", "ok"],
		{ encoding: "utf8", timeout: 2_000 },
	)
	return probe.status === 0 && probe.stdout.trim() === "ok"
})()

/**
 * The canonical Go default build cache path on the host running this
 * test, resolved via the SAME chain the profile generator uses
 * internally (CORRECTION01): `realpathSync` of the existing trusted
 * ancestor `<HOME>/Library/Caches`, then appending the fixed leaf
 * `go-build`. `undefined` when the ancestor itself cannot be
 * canonicalized (the bounded-fail-closed branch in the generator).
 *
 * Even if the LEAF `go-build` does not exist on this host yet,
 * this helper still returns the canonical path because Go will
 * `MkdirAll` it on first use inside the sandbox.
 */
const canonicalGoBuildCache: string | undefined = (() => {
	try {
		const parent = realpathSync(`${homedir()}/Library/Caches`)
		return `${parent}/go-build`
	} catch {
		return undefined
	}
})()

let tmpRoot: string | undefined

beforeAll(() => {
	if (!HAS_SUBSTRATE) return
	tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-go-cache-c1-"))
})

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
	if (tmpRoot) {
		try {
			rmSync(tmpRoot, { recursive: true, force: true })
		} catch {
			// ignore — best-effort cleanup
		}
		tmpRoot = mkdtempSync(join(tmpdir(), "clinemm-go-cache-c1-"))
	}
})

function withSandboxOptIn<T>(
	value: string | undefined,
	fn: () => Promise<T> | T,
): Promise<T> | T {
	const prev = process.env[SANDBOX_OPTIN_ENV]
	if (value === undefined) {
		delete process.env[SANDBOX_OPTIN_ENV]
	} else {
		process.env[SANDBOX_OPTIN_ENV] = value
	}
	try {
		return fn()
	} finally {
		if (prev === undefined) {
			delete process.env[SANDBOX_OPTIN_ENV]
		} else {
			process.env[SANDBOX_OPTIN_ENV] = prev
		}
	}
}

interface SandboxRun {
	exitCode: number | null
	signal: NodeJS.Signals | null
	stdout: string
	stderr: string
	state: string
}

async function runSandboxed(opts: {
	command: string
	env?: Record<string, string>
	cwd?: string
}): Promise<SandboxRun> {
	return withSandboxOptIn(SEATBELT_OPTIN, async () => {
		const manager = new CommandJobManager()
		const cwd = opts.cwd ?? tmpRoot ?? tmpdir()
		try {
			const start = await manager.start({
				command: opts.command,
				cwd,
				env: opts.env ?? {},
				waitBudgetMs: 5_000,
				executionDeadlineMs: 10_000,
			})
			await start.terminalPromise
			const statusResult = await manager.status({
				jobId: start.jobId,
				waitMs: 0,
			})
			if (!statusResult.ok) {
				throw new Error(`status() returned code=${statusResult.code}`)
			}
			const s = statusResult.snapshot
			return {
				exitCode: s.exitCode ?? null,
				signal: s.signal,
				stdout: s.stdout,
				stderr: s.stderr,
				state: s.state,
			}
		} finally {
			await manager.dispose()
		}
	})
}

describe.skipIf(!HAS_SUBSTRATE)(
	"ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01 — kernel witness",
	() => {
		it("G1 NECESSITY: mkdir under canonical <HOME>/Library/Caches/go-build inside sandbox -> exit 0", async () => {
			if (!canonicalGoBuildCache) {
				// The trusted ancestor itself is unresolvable on
				// this host. The bounded-fail-closed branch in the
				// generator emits no rule. Skip — the pure-functional
				// suite's GO-CACHE-11 asserts this branch.
				expect(true).toBe(true)
				return
			}
			const probePath = `${canonicalGoBuildCache}/clinemm-probe-g1-${Date.now()}`
			try {
				const out = await runSandboxed({
					command: `/bin/mkdir -p ${JSON.stringify(probePath)}`,
				})
				expect(out.exitCode).toBe(0)
				expect(out.stderr).not.toMatch(/Operation not permitted|EPERM/)
				expect(existsSync(probePath)).toBe(true)
			} finally {
				try {
					rmSync(probePath, { recursive: true, force: true })
				} catch {
					// ignore — best-effort cleanup
				}
			}
		})

		it("G2 CONSERVATION: mkdir under sibling ~/Library/Caches/<not-go-build> -> DENIED (EPERM, no path created)", async () => {
			// Conservation witness. The grant is subpath-scoped to
			// `<cache>/go-build` ONLY. Sibling subtrees under
			// `~/Library/Caches/` MUST remain DENIED by
			// `(deny default)`. The probe name is part of the test
			// contract: a future ACT that genuinely needs that
			// sibling opens the surface explicitly with a
			// corresponding green test.
			const probePath = `${homedir()}/Library/Caches/clinemm-seatbelt-should-deny-${Date.now()}`
			const out = await runSandboxed({
				command: `/bin/mkdir -p ${JSON.stringify(probePath)}`,
			})
			// Load-bearing invariant: the kernel denied the write.
			//   - exit code MUST be non-zero (mkdir failed).
			//   - the probe path MUST NOT exist on disk.
			//   - stderr MUST carry a permission-denial marker.
			expect(out.exitCode).not.toBe(0)
			expect(existsSync(probePath)).toBe(false)
			expect(out.stderr).toMatch(/Operation not permitted|EPERM|not permitted/i)
			try {
				rmSync(probePath, { recursive: true, force: true })
			} catch {
				// ignore — directory was never created
			}
		})

		it("G3 INTEGRATION: `go env GOCACHE` (parent GOCACHE unset) reports <HOME>/Library/Caches/go-build inside sandbox", async () => {
			// End-to-end integration witness: Go's NATIVE default
			// cache is the canonical `<HOME>/Library/Caches/go-build`,
			// and a fresh write under it succeeds.
			//
			// If `go` is not installed on this host, skip with PASS —
			// the pure-functional suite's GO-CACHE-01..11 already
			// cover the profile-shape invariants, and G1+G2 cover
			// the kernel semantics.
			const probe = spawnSync("/usr/bin/env", ["go", "version"], {
				encoding: "utf8",
				timeout: 2_000,
			})
			if (probe.status !== 0) {
				expect(true).toBe(true)
				return
			}
			if (!canonicalGoBuildCache) {
				expect(true).toBe(true)
				return
			}
			const out = await runSandboxed({
				command: `/usr/bin/env -u GOCACHE /usr/bin/env go env GOCACHE`,
			})
			expect(out.exitCode).toBe(0)
			const reported = out.stdout.trim()
			let reportedCanonical: string
			try {
				reportedCanonical = realpathSync(reported)
			} catch {
				reportedCanonical = reported
			}
			expect(reportedCanonical).toBe(canonicalGoBuildCache)
			// Kernel-witness half: a fresh write under the
			// reported cache succeeds (proves the Seatbelt grant
			// is operational, not just nominal in the profile).
			const probePath = `${reportedCanonical}/clinemm-probe-g3-${Date.now()}.txt`
			try {
				const writeOut = await runSandboxed({
					command: `/bin/sh -c ${JSON.stringify(`/bin/echo G3_OK > ${probePath}`)}`,
				})
				expect(writeOut.exitCode).toBe(0)
				expect(existsSync(probePath)).toBe(true)
			} finally {
				try {
					rmSync(probePath, { force: true })
				} catch {
					// ignore — best-effort cleanup
				}
			}
		})
	},
)
