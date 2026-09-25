/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT-WIRE-03
 * (correction03 - REAL production SdkController callback witness).
 *
 * Drives the REAL `buildSdkControllerEnqueueTerminalWake` factory
 * function exported by `apps/vscode/src/sdk/SdkController.ts`. This
 * is the SAME factory the production `Controller` constructor calls
 * at `SdkController.ts:~1076` to obtain the `enqueueTerminalWake`
 * closure passed to `BackgroundNotifyCoordinator`.
 *
 * The tests assert the EXACT production callback composition:
 *
 *   buildSdkControllerEnqueueTerminalWake({
 *     getActiveSession: () => this.sessions?.getActiveSession(),
 *     logger: Logger,
 *   })({ sessionId, prompt })
 *
 * i.e. the wake is delivered via:
 *
 *   active.sdkHost.send({ sessionId, prompt, delivery: "queue" })
 *
 * with owner-mismatch silent-drop and rejection / synchronous-throw
 * swallowing routed through the supplied `logger.warn` (the
 * production constructor passes the module-level `Logger`).
 *
 * correction02's BCNT-WIRE-02 reimplemented the callback body inside
 * the test (the closure "mirrored" production). The reviewer's HALT
 * correctly noted that "mirrored" is not "actual". correction03
 * closes that gap by extracting the closure into a module-scope
 * named exported function (`buildSdkControllerEnqueueTerminalWake`)
 * and asserting on its REAL output here.
 *
 * Runs only under `apps/vscode/vitest.config.c2-4-c-bridge.ts`
 * because the bridge needs the real `@/sdk/...` aliases for
 * SdkController.ts (the base config also aliases `@/` but the
 * bridge config is the dedicated C2.4-C stream that owns
 * production-callback witnesses for this ACT).
 */

import type { Mock } from "vitest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import { buildSdkControllerEnqueueTerminalWake } from "@/sdk/SdkController"

interface MakeSessionResult {
	session: ActiveSession
	send: ReturnType<typeof vi.fn>
}

function makeFakeSession(sessionId: string, sendImpl?: (input: unknown) => Promise<unknown>): MakeSessionResult {
	const send = vi.fn(sendImpl ?? (async () => undefined))
	// The full SdkSessionHost interface has many more methods than
	// the callback exercises; cast through unknown to keep the
	// fixture minimal. The callback only touches `send`.
	const sdkHost = {
		runtimeAddress: undefined,
		start: vi.fn(async () => ({})),
		send,
		getAccumulatedUsage: vi.fn(async () => undefined),
		abort: vi.fn(async () => undefined),
		stop: vi.fn(async () => undefined),
		dispose: vi.fn(async () => undefined),
		get: vi.fn(async () => undefined),
		list: vi.fn(async () => []),
		listHistory: vi.fn(async () => []),
		delete: vi.fn(async () => false),
		readMessages: vi.fn(async () => []),
	} as unknown as ActiveSession["sdkHost"]
	const session: ActiveSession = {
		sessionId,
		startConfig: undefined,
		sdkHost,
		unsubscribe: () => undefined,
		startResult: undefined,
		isRunning: true,
	}
	return { session, send }
}

interface MakeDepsResult {
	getActiveSession: () => ActiveSession | undefined
	warn: Mock<(msg: string) => void>
	setActive: (session: ActiveSession | undefined) => void
}

function makeDeps(): MakeDepsResult {
	let current: ActiveSession | undefined
	const warn = vi.fn((_msg: string) => {})
	return {
		getActiveSession: () => current,
		warn,
		setActive: (session) => {
			current = session
		},
	}
}

describe("BCNT-WIRE-03 - REAL buildSdkControllerEnqueueTerminalWake factory", () => {
	let deps: MakeDepsResult

	beforeEach(() => {
		deps = makeDeps()
	})

	it("routes the wake to the active session's sdkHost.send({ delivery: 'queue' })", async () => {
		const { session, send } = makeFakeSession("sess-A")
		deps.setActive(session)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		wake({ sessionId: "sess-A", prompt: "State: exited, ExitCode: 0" })

		// The production factory fires `void sdkHost.send(...)`
		// without awaiting. Wait for the resolved promise to
		// be observed so the assertion is deterministic.
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(send).toHaveBeenCalledTimes(1)
		expect(send).toHaveBeenCalledWith({
			sessionId: "sess-A",
			prompt: "State: exited, ExitCode: 0",
			delivery: "queue",
		})
		expect(deps.warn).not.toHaveBeenCalled()
	})

	it("ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: forwards the originating jobId to sdkHost.send", async () => {
		const { session, send } = makeFakeSession("sess-jobid-thread")
		deps.setActive(session)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		wake({
			sessionId: "sess-jobid-thread",
			prompt: "State: exited, ExitCode: 0",
			jobId: "test-jobid-correlation-token",
		})

		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(send).toHaveBeenCalledTimes(1)
		// SendSessionInput.jobId is threaded through. Vitest's
		// toHaveBeenCalledWith ignores undefined keys, so the
		// expected shape matches exactly what the host must send.
		expect(send).toHaveBeenCalledWith({
			sessionId: "sess-jobid-thread",
			prompt: "State: exited, ExitCode: 0",
			delivery: "queue",
			jobId: "test-jobid-correlation-token",
		})
		expect(deps.warn).not.toHaveBeenCalled()
	})

	it("silent-drops when active sessionId != wake sessionId", async () => {
		const { session, send } = makeFakeSession("sess-A")
		deps.setActive(session)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		wake({ sessionId: "sess-DIFFERENT", prompt: "should not deliver" })

		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(send).not.toHaveBeenCalled()
		expect(deps.warn).not.toHaveBeenCalled()
	})

	it("silent-drops when there is no active session", async () => {
		deps.setActive(undefined)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		wake({ sessionId: "sess-A", prompt: "no active session" })

		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(deps.warn).not.toHaveBeenCalled()
	})
})

describe("BCNT-WIRE-03 swallow semantics (rejection + synchronous throw)", () => {
	let deps: MakeDepsResult

	beforeEach(() => {
		deps = makeDeps()
	})

	it("logs warn on send() promise rejection and does not throw", async () => {
		const { session, send } = makeFakeSession("sess-A", async () => {
			throw new Error("downstream queue full")
		})
		deps.setActive(session)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		// The production factory does not await send(); a rejected
		// promise is captured via .catch and logged.
		wake({ sessionId: "sess-A", prompt: "rejection path" })

		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(send).toHaveBeenCalledTimes(1)
		expect(deps.warn).toHaveBeenCalledTimes(1)
		const warnMsg = deps.warn.mock.calls[0]?.[0] ?? ""
		expect(warnMsg).toContain("send() rejected")
		expect(warnMsg).toContain("sess-A")
		expect(warnMsg).toContain("downstream queue full")
	})

	it("logs warn on send() synchronous throw and does not throw", () => {
		const { session, send } = makeFakeSession("sess-A")
		// Replace send with a synchronous thrower.
		send.mockImplementation(() => {
			throw new Error("sdkHost.send blew up before returning a promise")
		})
		deps.setActive(session)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		expect(() => wake({ sessionId: "sess-A", prompt: "sync throw path" })).not.toThrow()

		expect(send).toHaveBeenCalledTimes(1)
		expect(deps.warn).toHaveBeenCalledTimes(1)
		const warnMsg = deps.warn.mock.calls[0]?.[0] ?? ""
		expect(warnMsg).toContain("send() threw")
		expect(warnMsg).toContain("sess-A")
		expect(warnMsg).toContain("blew up before returning a promise")
	})
})

describe("BCNT-WIRE-03 - closure seam re-reads active session at wake time", () => {
	it("re-reads the active session at wake time, not at factory construction time", async () => {
		// Construction time: no active session.
		// Wake time: an active session has been set.
		// This proves the factory captures the getActiveSession
		// seam (not a static snapshot).
		const deps = makeDeps()
		const { session, send } = makeFakeSession("sess-late")
		deps.setActive(undefined)

		const wake = buildSdkControllerEnqueueTerminalWake({
			getActiveSession: deps.getActiveSession,
			logger: { warn: (msg: string) => deps.warn(msg) },
		})

		// No active session yet - silent drop.
		wake({ sessionId: "sess-late", prompt: "first wake (no active)" })
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))
		expect(send).not.toHaveBeenCalled()

		// Now an active session appears, with matching id.
		deps.setActive(session)

		wake({ sessionId: "sess-late", prompt: "second wake (active now)" })
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))

		expect(send).toHaveBeenCalledTimes(1)
		expect(send).toHaveBeenCalledWith({
			sessionId: "sess-late",
			prompt: "second wake (active now)",
			delivery: "queue",
		})
	})
})
