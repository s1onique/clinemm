/**
 * ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01 PRODUCTION-SEAM CORRECTION.
 *
 * The earlier adversarial file
 * (apps/vscode/src/sdk/tool-runtime-reliability-recon01.adversarial.test.ts)
 * was a STRUCTURAL contract probe: it injected a fake ITerminalProcess
 * whose awaitable was simply defined to never resolve, then asserted
 * that executeForeground hangs. That establishes only that the executor
 * trusts the process-promise contract; it does NOT establish that the
 * REAL VscodeTerminalProcess state machine can actually reach a state
 * where its awaitable stays pending.
 *
 * Reviewer finding (P0 HALT_RED_NOT_PRODUCTION_REPRODUCTION):
 *   "T5 is a contract probe, not a RED reproduction"
 *   "T9 is weaker still: never instantiates or executes
 *    VscodeTerminalManager.runCommand()"
 *
 * This file CORRECTS the recon by driving the REAL
 * VscodeTerminalProcess.run() through four allegedly-broken branches
 * (A1 terminalClosed, A2 read iterator remains open, A3 markerless
 * idle heuristic, A4 shell execution end without normal completion
 * callback). The four branches were named in the recon; they are
 * exercised here against the production code path.
 *
 * For each branch, the assertion is the SAME shape:
 *
 *   real terminal process.run() is invoked
 *   AND the read loop reaches the documented terminal boundary
 *   AND process.getCompletionDetails() OR process.emit("completed")
 *      is observed
 *   AND the merged awaitable (the same shape executeForeground awaits)
 *      settles within a bounded budget
 *
 * If every branch settles -> CASE_C is NOT REPRODUCED at the real
 * production seam and the unbounded-await is a STRUCTURAL property
 * with no reachable defect. The earlier "RED-1" / "RED-3" claims are
 * downgraded to "structural observation" only.
 *
 * The file is intentionally narrow: 4 production-state-machine
 * probes + 1 structural-contract probe. Real wall-clock budgets
 * (calibrated to the production constants):
 *
 *   A1 terminalClosed mid-command ........... ~10s
 *     (EXIT_CODE_EVENT_TIMEOUT_MS = 5000ms race after close)
 *   A2 executionEnd while reader remains open ~1.5s
 *     (executionEnd signal fires, loop breaks)
 *   A3 markerless-idle prompt-quiet .......... ~38s
 *     (MARKERLESS_IDLE_TIMEOUT=3s + MAX_QUIET_TIME=30s +
 *      EXIT_CODE_EVENT_TIMEOUT_MS=5s)
 *   A4 missing execution-end event .......... ~7s
 *     (streamEnd, then EXIT_CODE_EVENT_TIMEOUT_MS=5s)
 *   structural contract probe ............... ~1s
 *
 * Total wall time ~57s. No real PTY, no `code`/`open` host.
 *
 * Evidence-quality classification (per reviewer): the four probes
 * run the REAL `VscodeTerminalProcess` (production state machine)
 * but feed it synthetic controlled adapters for the VS Code
 * surface (onDidCloseTerminal, onDidEndTerminalShellExecution,
 * createTerminal-with-shellIntegration). The combined label is
 * SYNTHETIC_REAL + REAL_PRODUCTION_SEAM — that is exactly what we
 * need for the causal question (does the state machine settle?)
 * and explicitly NOT a real PTY/shell-integration session.
 */

import { EventEmitter } from "events"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { VscodeTerminalProcess } from "@/hosts/vscode/terminal/VscodeTerminalProcess"

// -----------------------------------------------------------------------
// Real-vscode surface mocks. The vitest stub (vscode-vitest-stub.ts)
// does not provide onDidCloseTerminal, onDidEndTerminalShellExecution,
// or terminals[].createTerminal-with-shellIntegration, so we override
// only the pieces VscodeTerminalProcess.run() consumes.
// -----------------------------------------------------------------------

type EndListener = (e: { terminal: any; execution: any; exitCode: number | undefined }) => unknown
type CloseListener = (terminal: any) => unknown

interface ShellSession {
	terminal: any
	execution: any
	readChunks: string[]
	hanging: boolean
}

let endListeners: EndListener[] = []
let closeListeners: CloseListener[] = []
let currentSession: ShellSession | undefined

vi.mock("vscode", async () => {
	const stub = await import("@/test/vscode-vitest-stub")
	return {
		...stub,
		window: {
			...stub.window,
			onDidCloseTerminal: (listener: CloseListener) => {
				closeListeners.push(listener)
				return { dispose: () => {} }
			},
			onDidEndTerminalShellExecution: (listener: EndListener) => {
				endListeners.push(listener)
				return { dispose: () => {} }
			},
			terminals: [],
		},
	}
})

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
		captureTerminalOutputFailure: () => {},
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getGlobalSettingsKey: () => "default" }) },
}))

afterEach(() => {
	endListeners = []
	closeListeners = []
	currentSession = undefined
})

// OSC 633 markers used by the real shell-integration protocol.
const OSC633_C = "\x1b]633;C\x07"
const OSC633_D = "\x1b]633;D;0\x07"

// Build a mock terminal with shellIntegration whose executeCommand
// yields the given chunks through the read() stream. The terminal's
// `exitStatus` is undefined (live shell) by default.
//
// IMPORTANT: this fixture is shaped after the public `vscode.Terminal`
// surface that `VscodeTerminalProcess.run(terminal: vscode.Terminal, ...)`
// requires — not the narrower internal `ITerminal` from
// `@/integrations/terminal/types`. The production seam dereferences
// `terminal.exitStatus` (see VscodeTerminalProcess.run() entry guard),
// and TypeScript rejects structurally-incompatible mocks. A typed
// fixture here keeps future API drift visible at the production seam
// instead of being hidden behind a double-cast.
function makeTerminal(options: { hanging?: boolean; chunks?: string[] } = {}): vscode.Terminal {
	const session: ShellSession = {
		terminal: undefined as any,
		execution: undefined as any,
		readChunks: options.chunks ?? [],
		hanging: options.hanging ?? false,
	}
	currentSession = session
	// Typed against the public `vscode.TerminalShellExecution` shape so the
	// fixture stays structurally faithful to the production seam — the
	// required `commandLine` / `cwd` fields live here, even though
	// VscodeTerminalProcess only reads `execution.read()`.
	const execution: vscode.TerminalShellExecution = {
		commandLine: { value: "", isTrusted: true, confidence: 2 /* High */ },
		cwd: undefined,
		read: () => ({
			async *[Symbol.asyncIterator]() {
				for (const chunk of session.readChunks) {
					yield chunk
				}
				if (session.hanging) {
					await new Promise<never>(() => {})
				}
			},
		}),
	}
	session.execution = execution
	const terminal: vscode.Terminal = {
		name: "mock",
		processId: Promise.resolve(12345),
		// creationOptions is `Readonly<TerminalOptions | ExtensionTerminalOptions>`;
		// an empty literal is a valid TerminalOptions. The production seam does not
		// read this — it is required only by the public `vscode.Terminal` shape.
		creationOptions: {},
		exitStatus: undefined,
		// TerminalState carries isInteractedWith + shell — also unused by the
		// production seam but mandatory on the public type.
		state: { isInteractedWith: false, shell: undefined },
		shellIntegration: {
			// cwd is `Uri | undefined` on TerminalShellIntegration. The
			// production seam does not read this — required only by the
			// public type.
			cwd: undefined,
			executeCommand: () => execution,
		},
		sendText: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}
	session.terminal = terminal
	return terminal
}

function fireExecutionEnd(exitCode: number | undefined) {
	const e = currentSession
	if (!e) throw new Error("fireExecutionEnd: no currentSession")
	for (const listener of endListeners) {
		listener({ terminal: e.terminal, execution: e.execution, exitCode })
	}
}

function fireTerminalClose() {
	const e = currentSession
	if (!e) throw new Error("fireTerminalClose: no currentSession")
	for (const listener of closeListeners) {
		listener(e.terminal)
	}
}

async function settle(p: Promise<unknown>, ms: number) {
	let done = false
	p.then(
		() => {
			done = true
		},
		() => {
			done = true
		},
	)
	await new Promise((r) => setTimeout(r, ms))
	return done
}

// -----------------------------------------------------------------------
// PRODUCTION-SEAM PROBES
//
// Each probe drives a single terminal-fact branch through the real
// VscodeTerminalProcess.run() state machine and asserts that the
// process settles (i.e. emits "completed" AND resolves its merged
// awaitable) within a bounded budget. If any probe fails, the recon
// becomes REPRODUCED at the real production seam and we promote the
// defect to ROOT_CAUSE_ISOLATED.
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01 / production-seam A1 (terminalClosed mid-command)", () => {
	it("real VscodeTerminalProcess settles when terminal is closed mid-command", { timeout: 15_000 }, async () => {
		const terminal = makeTerminal({ hanging: true, chunks: [OSC633_C, "partial output\n"] })
		const proc = new VscodeTerminalProcess()
		const runPromise = proc.run(terminal, "long-running-cmd")
		await new Promise((r) => setTimeout(r, 200))
		fireTerminalClose()
		// After close: read loop breaks, then exit-code race times out at
		// EXIT_CODE_EVENT_TIMEOUT_MS = 5000. So runPromise should resolve
		// within ~6s. We budget 10s.
		const settled = await settle(runPromise, 10_000)
		expect(settled).toBe(true)
		expect(proc.getCompletionDetails()?.terminalClosed).toBe(true)
		expect(proc.isHot).toBe(false)
	})
})

describe("ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01 / production-seam A2 (read iterator stays open after executionEnd)", () => {
	it("real VscodeTerminalProcess settles when shell execution ends while read() remains open", async () => {
		const terminal = makeTerminal({ hanging: true, chunks: [OSC633_C, "test output\n"] })
		const proc = new VscodeTerminalProcess()
		const runPromise = proc.run(terminal, "echo test")
		await new Promise((r) => setTimeout(r, 50))
		// Stream is hanging; only executionEnd can break the read loop.
		fireExecutionEnd(0)
		const settled = await settle(runPromise, 1500)
		expect(settled).toBe(true)
		expect(proc.getCompletionDetails()?.exitCode).toBe(0)
	})
})

describe("ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01 / production-seam A3 (markerless idle, no C marker, prompt-quiet)", () => {
	it("real VscodeTerminalProcess settles via prompt-quiet heuristic when no C marker ever arrives", { timeout: 60_000 }, async () => {
		// Stream yields a single chunk that ends with a strong shell prompt;
		// never yields C marker; stream then hangs.
		const terminal = makeTerminal({
			hanging: true,
			chunks: ["remote output\n", "user@remote:~$ "],
		})
		const proc = new VscodeTerminalProcess()
		const runPromise = proc.run(terminal, "ls")
		// First idle check fires after the post-data idle timeout (3s in
		// production). We tick virtual time. Use real time + a budget
		// large enough to observe the heuristic in production constants.
		// MARKERLESS_IDLE_TIMEOUT = 3000, MARKERLESS_MAX_QUIET_TIME = 30000,
		// plus EXIT_CODE_EVENT_TIMEOUT_MS = 5000. Total ~35s; we cap at 38s.
		const settled = await settle(runPromise, 38_000)
		expect(settled).toBe(true)
		// The unobserved-command signal must be set: callers must not
		// treat this as success.
		const details = proc.getCompletionDetails()
		expect(details?.unobservedCommand).toBeDefined()
	})
})

describe("ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01 / production-seam A4 (shell execution end event never fires)", () => {
	it("real VscodeTerminalProcess settles via the EXIT_CODE_EVENT_TIMEOUT_MS race when no end event arrives", async () => {
		// Stream yields a full C/D-marker session that ends naturally
		// (streamEnd), but the end event is never invoked (ssh-style).
		const terminal = makeTerminal({ chunks: [OSC633_C, "test output\n", OSC633_D] })
		const proc = new VscodeTerminalProcess()
		const runPromise = proc.run(terminal, "echo test")
		// Stream ends naturally. EXIT_CODE_EVENT_TIMEOUT_MS is 5000ms; we
		// cap at 7s to observe the timeout race.
		const settled = await settle(runPromise, 7_000)
		expect(settled).toBe(true)
		// The D-marker exit code (0) is preferred when the event timeout
		// fires (real VscodeTerminalProcess code path).
		expect(proc.getCompletionDetails()?.exitCode).toBe(0)
	})
})

// -----------------------------------------------------------------------
// STRUCTURAL CONTRACT PROBE (NOT a production RED)
//
// This probe documents a STRUCTURAL property of executeForeground's
// wait seam: it has no independent bounded timeout on `await process`.
// The probe injects a fake ITerminalProcess whose awaitable is defined
// to never resolve (mirroring the seam's only fallback: detach()).
//
// Per ACT contract §11 / reviewer finding P0, this is a CONTRACT probe,
// not a production reproduction. The production seam's state machine
// always settles (A1-A4 above prove this), so this probe only documents
// what executeForeground DOES NOT protect against if a future ITerminalProcess
// implementation breaks the contract. No RED is claimed.
// -----------------------------------------------------------------------

describe("ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01 / structural contract", () => {
	it("documents that executeForeground's `await process` is bounded only by the process-promise contract", async () => {
		const { executeForeground } = await import("@/sdk/vscode-run-commands-tool")
		// Fake ITerminalProcess: emits line but never emits "completed"
		// and never resolves the merged awaitable.
		const emitter = new EventEmitter()
		const neverPromise = new Promise<void>(() => {})
		const fakeProcess = Object.assign(emitter, {
			then: neverPromise.then.bind(neverPromise),
			catch: neverPromise.catch.bind(neverPromise),
			finally: neverPromise.finally.bind(neverPromise),
			getCompletionDetails: () => ({}),
			detach: () => {
				emitter.emit("continue")
			},
		}) as unknown as ReturnType<typeof executeForeground>
		const fakeManager = {
			getOrCreateTerminal: async () => ({ terminal: { show: () => {} } }) as never,
			runCommand: () => fakeProcess,
		} as unknown as any
		// Emit a line and observe that the call does NOT return within 1s.
		setTimeout(() => emitter.emit("line", "partial"), 50)
		let settled = false
		await Promise.race([
			executeForeground("sleep 999", "/workspace", fakeManager, 1000)
				.then(() => {
					settled = true
				})
				.catch(() => {
					settled = true
				}),
			new Promise<void>((r) => setTimeout(r, 1000)),
		])
		// STRUCTURAL observation only: executeForeground did not return
		// within 1s. This is the structural property of the wait seam
		// and NOT a production RED (A1-A4 above show production always
		// settles in every reachable branch).
		expect(settled).toBe(false)
	})
})
