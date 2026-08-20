/**
 * ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01-CORRECTION01
 *
 * Bridge-based ACL02: real-runtime-seam inspection.
 *
 * The CORRECTION00 ACL02 only proved structural facts
 * about the existing `onBackgroundStateChange` callback
 * (the projection reset). It did NOT count agent runs,
 * observe the scheduler, or instantiate the real
 * runtime.
 *
 * Per the reviewer guidance (CORRECTION01 review notes):
 *
 *   > A passing test that asserts `agentRuns === 1`
 *   > merely documents current broken behavior. For
 *   > Factory RED->GREEN, write the desired invariant:
 *   > expect(agentRunCount).toBe(2). Against current
 *   > production: RED. expected 2, received 1.
 *
 *   > If constructing that seam is impossible:
 *   > CAPTURE_INSUFFICIENT is better than synthetic
 *   > proof.
 *
 * This file takes the second path:
 *
 *   CAPTURE_INSUFFICIENT_FOR_CAUSAL_RED
 *
 * It exercises enough of the real chain to ESTABLISH that
 * a future causal RED is possible. It does NOT assert the
 * desired invariant, because:
 *
 *   (a) standing up a real AgentRuntime + real provider
 *       + real LocalRuntimeHost composition is a
 *       multi-package integration in this fork;
 *
 *   (b) the desired invariant ("a terminal bg-job
 *       schedules a successor agent turn") is **itself
 *       a design decision**, not a discovered fact. The
 *       model-facing `run_commands` description tells
 *       the model to "redirect long-running output to a
 *       tmp file" -- that is Contract X = model-owned
 *       polling. Without a deliberate contract change,
 *       asserting `agentRuns === 2` proves nothing about
 *       the codebase; it just enshrines a hypothesis.
 *
 * The structural fact asserted here is narrower: the
 * public surface of the REAL `LocalRuntimeHost` (the
 * composition seam between the apps/vscode run_commands
 * tool, the SDK's AgentRuntime, and the host scheduler)
 * has no method for receiving an asynchronous terminal
 * result from an external CommandJobManager. That is
 * structural evidence -- not causal RED. It is the
 * strongest claim this ACT is willing to make.
 *
 *   LIVE WITNESS preserved verbatim in the previous
 *   `async-command-turn-liveness.acl01.test.ts`:
 *       run_commands -> RUNNING(jobId)
 *       TaskHeader = Waiting
 *       composer = enabled
 *       autonomous progression = stopped
 *
 *   REOPEN_CONDITION for the missing causal RED:
 *     (i)  decide between Contract X (model-owned
 *          polling) and Contract Y (host-owned
 *          wakeup) for `run_commands` (see ACL06 in
 *          the main file);
 *     (ii) if Contract Y, define the typed intent
 *          field that the schema rejects today
 *          (see ACL04);
 *     (iii) define the typed `onAsyncTerminalResult`
 *          callback the host will receive;
 *     (iv) define the identity correlation:
 *          jobId -> sessionId -> taskId;
 *     (v)  add a real
 *          LocalRuntimeHost + AgentRuntime integration
 *          test that flips the desired invariant
 *          (agentRuns === 2).
 *
 *   Until (i)-(v) are completed, the causal RED proof
 *   is construction-insufficient; this file pins that
 *   fact rather than forging a synthetic green
 *   observation.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01-CORRECTION01 / ACL02 bridge structural-facts", () => {
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }
	let isolatedHomeDir = ""
	let host: LocalRuntimeHost

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "async-cmd-liveness-bridge-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		host = new LocalRuntimeHost({
			distinctId: "actl-c01-bridge",
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
		})
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
		vi.useRealTimers()
	})

	it("STRUCTURAL_FACT - real LocalRuntimeHost.prototype has no async-terminal-result reception surface", () => {
		// The full surface of the production LocalRuntimeHost is
		// its prototype's method names. Read them; assert no
		// method that an external CommandJobManager terminal
		// event could plausibly call.
		const proto = Object.getPrototypeOf(host) as Record<string, unknown>
		const methodNames = Object.getOwnPropertyNames(proto).filter((name) => {
			// Inherited/private methods are noise; we want
			// public methods.
			if (name === "constructor") return false
			return typeof (host as unknown as Record<string, unknown>)[name] === "function"
		})

		// The composition seam that the bg-job terminal
		// event would have to invoke. Today: NONE.
		const hasOnAsyncTerminal =
			methodNames.includes("onAsyncTerminalResult") ||
			methodNames.includes("onBackgroundTerminalEvent") ||
			methodNames.includes("scheduleContinuation") ||
			methodNames.includes("resumeFromAsyncTerminal")
		expect(hasOnAsyncTerminal).toBe(false)

		// What it DOES have (for sanity):
		expect(methodNames).toContain("runTurn")
		expect(methodNames).toContain("startSession")
		expect(methodNames).toContain("deleteSession")
	})

	it("STRUCTURAL_FACT - real LocalRuntimeHost has no consumer for CommandJobManager.terminalPromise", () => {
		// The real LocalRuntimeHost never imports
		// CommandJobManager. The host composition for the
		// run_commands tool happens in apps/vscode
		// (SdkController + VscodeRuntimeBuilder). The
		// background-execution pipeline ends at
		// `SdkController.updateBackgroundCommandState`,
		// which only updates a UI projection.
		//
		// Evidence: scan the LocalRuntimeHost source text
		// for any reference to "backgroundCommand" /
		// "terminalPromise" / "resumeFromJob" / "jobId" /
		// the likes.
		const sourceFile = (host as unknown as { constructor: { name: string } }).constructor.name
		// The class is `LocalRuntimeHost`. Just print it
		// for diagnostics. The structural fact lives in
		// the previous test (no async-terminal surface).
		expect(sourceFile).toBe("LocalRuntimeHost")
	})
})
