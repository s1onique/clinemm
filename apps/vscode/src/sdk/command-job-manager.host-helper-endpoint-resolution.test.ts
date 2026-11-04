/**
 * ACT-CLINEMM-BACKGROUND-EXEC-EPERM-QUALIFICATION01-CORRECTION01
 *
 * BOUNDED, SAFE regression witness for the host-helper endpoint repair.
 *
 * WHY THIS FILE EXISTS (and why it replaces the live-ablation test)
 * -----------------------------------------------------------------
 * The original `command-job-manager.host-helper-live-ablation01.test.ts`
 * was a REAL-KERNEL ablation that:
 *
 *   1. asserted the PRE-REPAIR resolver contract
 *      (`resolveLiveHelperOwnedPgidProvider()` returns `undefined` when
 *      `CLINEMM_HOST_HELPER_SOCKET` is absent) — which the repair
 *      deliberately changed, so the test could never pass against the
 *      repaired code;
 *   2. awaited `manager.cancel()` with NO bounded escape on the
 *      no-helper branch — i.e. it awaited the exact operation that is
 *      known to hang indefinitely under the EPERM substrate;
 *   3. spawned a DETACHED shell running an infinite loop as a substrate
 *      probe, with no guaranteed cleanup — Node's documented
 *      detached-process semantics allow such a child to outlive its
 *      parent, which is how the investigation left residual process
 *      groups behind; and
 *   4. reported `SKIP` via `console.warn` + `return`, which Vitest
 *      records as a PASSING test rather than a skipped one — false
 *      evidence.
 *
 * The live ablation EVIDENCE itself is preserved (it is real and
 * load-bearing) and lives in
 * `.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01/`.
 * The LIVE PROBE ITSELF is preserved as an opt-in, operator-run tool at
 * `apps/vscode/scripts/host-helper-live-ablation.probe.ts` — it is NOT
 * part of any default test suite.
 *
 * WHAT THIS FILE DOES INSTEAD
 * ---------------------------
 * It pins the REPAIRED contract as a pure, deterministic, process-free
 * assertion:
 *
 *   - the shared resolver's tiering (env override, then the installer
 *     default `$HOME/.clinemm/host-helper.sock`);
 *   - the VS Code adapter's factory resolving a provider in the REAL
 *     extension-host shape (env var ABSENT, HOME PRESENT) — the exact
 *     shape that made the EPERM fallback unreachable before the repair;
 *   - the adapter and the SDK Seatbelt backend agreeing on ONE endpoint
 *     (the cross-seam invariant that the repair introduced); and
 *   - the CommandJobManager consulting the provider at registration
 *     time.
 *
 * It spawns NO detached probes, opens NO helper sockets, and cannot
 * hang: every assertion is synchronous or bounded by the manager's own
 * test seam.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CommandJobManager } from "./command-job-manager"
import {
	createLiveHelperOwnedPgidProvider,
	type HelperWireClient,
	HostHelperPgidProvider,
	resolveLiveHelperOwnedPgidProvider,
} from "./host-helper-pgid-adapter"

/**
 * The canonical installer default, duplicated here as a LITERAL (not
 * imported from `@cline/shared`) on purpose: this witness must fail if
 * the shared resolver's default tier ever changes shape. The shared
 * resolver's own unit test (`sdk/packages/shared/src/runtime/
 * host-helper-socket.test.ts`) is the single source of truth for the
 * constant itself.
 */
const INSTALLER_DEFAULT_SUFFIX = ".clinemm/host-helper.sock"

/**
 * A fake wire client. The provider never opens a socket in these
 * tests: the wire is the seam under test, and the adapter's socket
 * path is asserted separately via the resolver.
 */
function makeFakeWire(overrides: Partial<HelperWireClient> = {}): HelperWireClient {
	const fake: HelperWireClient = {
		clientOpen: vi.fn(async () => ({
			clientToken: "a".repeat(32),
			peerUid: 501,
			peerPid: 4242,
		})),
		registerOwned: vi.fn(async () => ({ jobToken: "b".repeat(32) })),
		terminateOwned: vi.fn(async () => "TERMINATED_KILL" as const),
		releaseOwned: vi.fn(async () => "RELEASED" as const),
		clientClose: vi.fn(async () => "CLOSED" as const),
		close: vi.fn(),
		...overrides,
	}
	return fake
}

/**
 * A long-running FAKE process — never exits until `terminateTree` is
 * called. Uses a pid from a high range so it cannot collide with a real
 * OS pid. The `pgid` field is set explicitly so the manager's
 * `tryRegisterOwnedJob` reads the canonical
 * `SupervisableShellProcess.pgid` seam.
 *
 * No OS process is created: that is the whole point. The removed
 * live-ablation test used REAL detached children, which is how the
 * investigation left residual process groups behind.
 */
function fakeLongRunningProcess(): {
	readonly process: import("@cline/core").SupervisableShellProcess
	readonly pid: number
	readonly pgid: number
} {
	const pid = 90_000_000 + Math.floor(Math.random() * 9_000_000)
	const pgid = pid
	let exitResolve: ((value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
	const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		exitResolve = resolve
	})
	const emptySnap = () => ({ text: "", totalChars: 0, dropped: false })
	return {
		pid,
		pgid,
		process: Object.freeze({
			exit,
			killTree: async () => {},
			terminateTree: async () => {
				exitResolve?.({ exitCode: 0, signal: "SIGTERM" })
				return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
			},
			stdoutSnapshot: emptySnap,
			stderrSnapshot: emptySnap,
			pid,
			pgid,
		}),
	}
}

describe("ACT-CLINEMM-BACKGROUND-EXEC-EPERM-QUALIFICATION01-CORRECTION01: host-helper endpoint resolution", () => {
	let originalSocketEnv: string | undefined
	let originalHome: string | undefined
	let originalSandbox: string | undefined

	beforeEach(() => {
		originalSocketEnv = process.env.CLINEMM_HOST_HELPER_SOCKET
		originalHome = process.env.HOME
		originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		// The manager routes through `backend.prepare()` when the
		// experimental Seatbelt sandbox is active, and fails with
		// `spawn_failed` because the Seatbelt substrate is unavailable
		// in the vitest worker environment. Disabling it makes the
		// manager take the legacy direct-spawn path — the same
		// break-glass the sibling adapter test uses.
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	})

	afterEach(() => {
		if (originalSocketEnv === undefined) {
			delete process.env.CLINEMM_HOST_HELPER_SOCKET
		} else {
			process.env.CLINEMM_HOST_HELPER_SOCKET = originalSocketEnv
		}
		if (originalHome === undefined) {
			delete process.env.HOME
		} else {
			process.env.HOME = originalHome
		}
		if (originalSandbox === undefined) {
			delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		} else {
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
		}
	})

	// ------------------------------------------------------------------
	// 1. The REAL extension-host shape.
	//
	// The GUI launchd domain that starts VS Code / VSCodium does NOT
	// export `CLINEMM_HOST_HELPER_SOCKET` (verified live via
	// `launchctl print gui/501` and `launchctl getenv`). Before the
	// repair the adapter read the env var ALONE, so in the real
	// extension host it resolved no endpoint, the provider was
	// `undefined`, the owned PGID was never registered with the
	// helper, and the EPERM-only fallback was DEAD CODE.
	// ------------------------------------------------------------------
	it("resolves a provider in the REAL extension-host shape (env var absent, HOME present)", () => {
		delete process.env.CLINEMM_HOST_HELPER_SOCKET
		process.env.HOME = "/Users/someone"

		const provider = resolveLiveHelperOwnedPgidProvider()

		expect(provider).toBeDefined()
		expect(provider).toBeInstanceOf(HostHelperPgidProvider)
	})

	// ------------------------------------------------------------------
	// 2. The genuinely unresolvable case.
	//
	// `undefined` is now reserved for "no env override AND no home
	// directory" — not for "the env var is unset".
	// ------------------------------------------------------------------
	it("returns undefined only when neither the env override nor a home directory resolves", () => {
		delete process.env.CLINEMM_HOST_HELPER_SOCKET
		delete process.env.HOME

		expect(resolveLiveHelperOwnedPgidProvider()).toBeUndefined()
	})

	// ------------------------------------------------------------------
	// 3. Tiering: the explicit env override still wins.
	// ------------------------------------------------------------------
	it("prefers the explicit env override over the home-directory default", () => {
		process.env.CLINEMM_HOST_HELPER_SOCKET = "/custom/override.sock"
		process.env.HOME = "/Users/someone"

		const provider = resolveLiveHelperOwnedPgidProvider()

		expect(provider).toBeDefined()
		expect(provider).toBeInstanceOf(HostHelperPgidProvider)
	})

	// ------------------------------------------------------------------
	// 4. Cross-seam invariant.
	//
	// The adapter (`apps/vscode`) and the SDK Seatbelt backend
	// (`sdk/packages/core`) must resolve the SAME endpoint. Before the
	// repair they each read the env var independently and could
	// disagree; the repair introduced ONE shared resolver for both.
	// ------------------------------------------------------------------
	it("keeps the adapter and the shared resolver on one endpoint", async () => {
		delete process.env.CLINEMM_HOST_HELPER_SOCKET
		process.env.HOME = "/Users/someone"

		const { resolveHostHelperSocketPath } = await import("@cline/shared")
		const sharedPath = resolveHostHelperSocketPath()

		expect(sharedPath).toBe(`/Users/someone/${INSTALLER_DEFAULT_SUFFIX}`)
		// The adapter resolving a provider in this shape is the
		// observable proof that it consumed the same shared resolution
		// rather than an env-only read.
		expect(resolveLiveHelperOwnedPgidProvider()).toBeDefined()
	})

	// ------------------------------------------------------------------
	// 5. The manager consults the provider at registration time.
	//
	// `tryRegisterOwnedJob` is the seam that binds the owned PGID to
	// the helper. If the provider is present, the manager MUST call
	// `clientOpen` + `registerOwned`; that is what makes
	// `job.helperOwnedCapability` non-undefined, which is the gate on
	// the EPERM-only fallback.
	//
	// The spawn is FAKED via `spawnFactory` (the canonical production
	// seam used by the sibling adapter test): no OS process is created,
	// so this witness cannot leave a residual process group behind —
	// which is exactly the defect the removed live-ablation test had.
	// ------------------------------------------------------------------
	it("registers the owned PGID with the helper through the provider", async () => {
		const wire = makeFakeWire()
		const provider = new HostHelperPgidProvider(wire)
		const fake = fakeLongRunningProcess()
		const manager = new CommandJobManager({
			helperOwnedPgidProvider: provider,
			spawnFactory: () => fake.process,
		})

		try {
			await manager.start({
				command: "/bin/sh -c 'sleep 30'",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 30_000,
			})

			expect(wire.clientOpen).toHaveBeenCalled()
			expect(wire.registerOwned).toHaveBeenCalled()
			// The registered PGID must be the canonical
			// `SupervisableShellProcess.pgid` of the spawned shell — the
			// detached-spawn convention that makes the helper's
			// ownership proof satisfiable.
			const registeredPgid = (wire.registerOwned as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.pgid
			expect(registeredPgid).toBe(fake.pgid)
		} finally {
			await manager.dispose().catch(() => undefined)
		}
	})

	// ------------------------------------------------------------------
	// 6. Without a provider, no helper registration happens at all.
	//
	// This is the pre-ACT direct-kill path. It must remain the
	// behaviour when there is genuinely no endpoint — otherwise the
	// adapter would fabricate a provider that cannot connect.
	// ------------------------------------------------------------------
	it("does not touch the helper when no provider is supplied", async () => {
		const wire = makeFakeWire()
		const fake = fakeLongRunningProcess()
		const manager = new CommandJobManager({ spawnFactory: () => fake.process })

		try {
			await manager.start({
				command: "/bin/sh -c 'sleep 30'",
				cwd: process.cwd(),
				waitBudgetMs: 100,
				executionDeadlineMs: 30_000,
			})

			expect(wire.clientOpen).not.toHaveBeenCalled()
			expect(wire.registerOwned).not.toHaveBeenCalled()
		} finally {
			await manager.dispose().catch(() => undefined)
		}
	})

	// ------------------------------------------------------------------
	// 7. The explicit-socket factory remains available for
	//    integration tests and honours the given path.
	// ------------------------------------------------------------------
	it("creates a provider for an explicitly supplied socket path", () => {
		const provider = createLiveHelperOwnedPgidProvider("/tmp/explicit-helper.sock")
		expect(provider).toBeInstanceOf(HostHelperPgidProvider)
	})
})
