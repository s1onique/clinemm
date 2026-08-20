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
 *       a design decision**, not a discovered fact.
 *       ACL06 in the main file pins what the production
 *       tool description does say (long-running ->
 *       redirect output to tmp file -> model reads
 *       later); the description does NOT describe what
 *       happens when an ordinary foreground call
 *       crosses the 15-second wait budget and the tool
 *       returns RUNNING(jobId) autonomously. The
 *       ownership contract for HOST_DEFERRED_FOREGROUND
 *       is undefined. Without a deliberate contract
 *       change, asserting `agentRuns === 2` proves
 *       nothing about the codebase; it just enshrines
 *       a hypothesis.
 *
 * The strongest claim this ACT is willing to make:
 *
 *   SOURCE_RECON:
 *     no dedicated async-command-terminal successor
 *     surface was found in the inspected composition
 *     (LocalRuntimeHost.prototype carries no method
 *     named onAsyncTerminalResult,
 *     onBackgroundTerminalEvent, scheduleContinuation,
 *     or resumeFromAsyncTerminal).
 *
 *   EXECUTABLE CAUSAL PROOF:
 *     UNAVAILABLE -- the absence of those four names
 *     does NOT prove that no reception path exists;
 *     a generic event method, callback passed through
 *     composition, runTurn, queue API, or non-prototype
 *     field could provide one.
 *
 *   CAPTURE_INSUFFICIENT_FOR_CAUSAL_RED.
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

	it("SOURCE_RECON - inspect LocalRuntimeHost.prototype for hypothetical async-terminal successor methods (does NOT prove no path exists)", () => {
		// SOURCE_RECON only. The strongest justified claim
		// is "no dedicated async-command-terminal successor
		// surface was found in the inspected composition".
		// The absence of a handful of method names does
		// NOT prove that no reception path exists: a
		// generic event method, callback passed through
		// composition, runTurn, queue API, or
		// non-prototype field could provide one.
		//
		// EXECUTABLE CAUSAL PROOF = UNAVAILABLE
		// (CAPTURE_INSUFFICIENT_FOR_CAUSAL_RED).
		const proto = Object.getPrototypeOf(host) as Record<string, unknown>
		const methodNames = Object.getOwnPropertyNames(proto).filter((name) => {
			// Inherited/private methods are noise; we want
			// public methods.
			if (name === "constructor") return false
			return typeof (host as unknown as Record<string, unknown>)[name] === "function"
		})

		// The composition seam that the bg-job terminal
		// event would have to invoke, under a hypothetical
		// Contract Y (host-owned wakeup). Today: NONE OF
		// THESE FOUR HYPOTHETICAL NAMES was found in the
		// prototype. This is structural evidence, not a
		// proof of absence of any reception path.
		const hasOnAsyncTerminal =
			methodNames.includes("onAsyncTerminalResult") ||
			methodNames.includes("onBackgroundTerminalEvent") ||
			methodNames.includes("scheduleContinuation") ||
			methodNames.includes("resumeFromAsyncTerminal")
		expect(hasOnAsyncTerminal).toBe(false)

		// What the prototype DOES carry (for sanity):
		expect(methodNames).toContain("runTurn")
		expect(methodNames).toContain("startSession")
		expect(methodNames).toContain("deleteSession")
	})

	it("DOCUMENTARY - the bridge test wires the real LocalRuntimeHost constructor; the structural claim lives in the prior SOURCE_RECON test", () => {
		// The strongest justified SOURCE RECON claim is
		// documented in the previous test. This second
		// test merely records that the LocalRuntimeHost
		// instance used in this ACT is the production
		// class (not a hand-rolled shim) -- a package_pin
		// for the bridge fixture.
		//
		// It does NOT prove that CommandJobManager has no
		// consumer in the host. The host composition for
		// the run_commands tool happens in apps/vscode
		// (SdkController + VscodeRuntimeBuilder); the
		// background-execution pipeline ends at
		// `SdkController.updateBackgroundCommandState`,
		// which only updates a UI projection. That
		// structural observation is recorded in the main
		// file's ACL01 and the previous SOURCE_RECON
		// test -- NOT here.
		const sourceFile = (host as unknown as { constructor: { name: string } }).constructor.name
		// The class is `LocalRuntimeHost`. Confirm.
		expect(sourceFile).toBe("LocalRuntimeHost")
	})
})
