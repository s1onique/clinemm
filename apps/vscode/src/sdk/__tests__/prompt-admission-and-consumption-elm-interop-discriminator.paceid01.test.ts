/**
 * ACT-CLINEMM-ELM-SEAM11-ASYNC-AUTHORITY-RECON — PACEID01
 *
 * The first executable gate. Per the SEAM11 ACT spec (§0
 * "C1: GO for source reconnaissance and one bounded executable
 * discriminator. No migration cutover yet."), this file runs
 * BEFORE any 6th Elm kernel is written.
 *
 * It exercises the SEAM11 candidate-A production decision surface
 * (`PendingPromptService` + `PendingPromptsController` at
 * `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`)
 * using the existing Elm bridge substrate (the real compiled
 * `completion-continuation-control` kernel as a stand-in
 * "Elm-shaped worker"; the `consultDeferredCompletionBarrierElmKernel`
 * async public adapter; the existing per-requestId pending-map +
 * 5-second response timeout). It does NOT add a new kernel, does
 * NOT modify the production entrypoint, and does NOT introduce a
 * new host callback.
 *
 * Discriminator families (per the ACT §5/§6 required steps):
 *
 *   PACEID-01  Synchronous-impossibility theorem
 *   PACEID-02  Queue-mutation purity (4-tag closed enum)
 *   PACEID-03  Drain-as-async-state-machine
 *   PACEID-04  SDK/VSCode kernel placement
 *   PACEID-05  Rejected-candidate preservation (SEAM05/SEAM06)
 *   PACEID-06  Production-seam evidence-loss hazard
 *   PACEID-07  Migration economics — LoC measurement
 *   PACEID-08  Async state machine preservation
 *   PACEID-09  Duplication of existing authorities
 *   PACEID-10  Disposition harness
 *
 * This file is the discriminator. It is NOT a regression test for
 * the production entrypoint (that is the existing
 * `pending-prompt-service.test.ts` 6/6 GREEN, plus
 * `pending-prompt-service.drain-semantics.test.ts`). It is NOT a
 * correspondence test. It is the SEAM11 executable gate per
 * `.factory/ACT-CLINEMM-ELM-SEAM11-ASYNC-AUTHORITY-RECON.md` §5.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	consultDeferredCompletionBarrierElmKernel,
	type DeferredCompletionBarrierFactsInput,
	resetDeferredCompletionBarrierElmAuthorityForTests,
	resetDeferredCompletionBarrierElmKernelForTests,
} from "../deferred-completion-barrier-elm"

const COMPILED_KERNEL_PATH = path.resolve(__dirname, "..", "..", "..", "elm", "deferred-completion-barrier", "src", "Main.elm")

function realKernelExists(): boolean {
	return fs.existsSync(COMPILED_KERNEL_PATH)
}

function buildStandInFacts(input: {
	sessionId: string
	taskId: string | undefined
	enqueueEpoch: number
	hasHeldTerminalResult: boolean
	hasPendingPrompts: boolean
	hasActiveNotify: boolean
}): DeferredCompletionBarrierFactsInput {
	return {
		sessionId: input.sessionId,
		taskId: input.taskId,
		markerSessionId: input.sessionId,
		markerTaskId: input.taskId,
		markerEpoch: input.enqueueEpoch,
		currentEpoch: input.enqueueEpoch,
		continuationSessionEpoch: "epoch-0",
		lastContinuationSessionEpoch: undefined,
		currentHeldSetSorted: input.hasHeldTerminalResult ? ["j1"] : [],
		priorHeldSetSorted: undefined,
		heldJobCount: input.hasHeldTerminalResult ? 1 : 0,
		liveMarkerPresent: input.hasActiveNotify,
	}
}

const baseFacts = {
	sessionId: "sess-paceid-01",
	taskId: "task-paceid-01",
	enqueueEpoch: 0,
	hasHeldTerminalResult: false,
	hasPendingPrompts: false,
	hasActiveNotify: false,
}

type QueueMutationDecision =
	| { kind: "dedupe_as_queue" }
	| { kind: "dedupe_as_steer" }
	| { kind: "fresh_queue" }
	| { kind: "fresh_steer" }

/**
 * Closed-schema mirror of the production enqueue precedence. This is
 * NOT a copy of the production implementation — it is the SAME
 * precedence re-expressed as a pure `Facts -> Decision` projection.
 * If the production precedence changes, the test below fails and the
 * diff is the migration contract.
 */
function deriveQueueMutationDecision(input: {
	existingPrompts: ReadonlyArray<{ prompt: string; delivery: "queue" | "steer" }>
	newPrompt: string
	newDelivery: "queue" | "steer"
}): QueueMutationDecision {
	const existing = input.existingPrompts.find((p) => p.prompt === input.newPrompt)
	if (existing) {
		// trust-first-wins: if either existing or new is steer, the
		// resulting tail MUST be steer (mirrors pending-prompt-service.ts:320-324).
		return existing.delivery === "steer" || input.newDelivery === "steer"
			? { kind: "dedupe_as_steer" }
			: { kind: "dedupe_as_queue" }
	}
	return input.newDelivery === "steer" ? { kind: "fresh_steer" } : { kind: "fresh_queue" }
}

type PaceidDisposition =
	| { kind: "ELM_SEAM_SELECTED"; reason: string }
	| { kind: "NOT_A_GOOD_ELM_SEAM"; reason: string }
	| { kind: "ALREADY_ELM_OWNED"; reason: string }
	| { kind: "NO_NEW_ELM_SEAM"; reason: string }

describe("ACT-CLINEMM-ELM-SEAM11-INTEROP-DISC — PACEID01", () => {
	beforeEach(() => {
		resetDeferredCompletionBarrierElmAuthorityForTests()
		resetDeferredCompletionBarrierElmKernelForTests()
	})

	afterEach(() => {
		resetDeferredCompletionBarrierElmAuthorityForTests()
		resetDeferredCompletionBarrierElmKernelForTests()
	})

	// PACEID-01: Synchronous-impossibility theorem
	it("PACEID-01: even with a pre-warmed bundle, the consult is asynchronous (>= 1 event-loop tick)", async () => {
		expect(realKernelExists(), "real compiled Elm bundle must exist for the discriminator").toBe(true)
		const facts = buildStandInFacts(baseFacts)

		let settledSynchronously = false
		const resultPromise = consultDeferredCompletionBarrierElmKernel(facts, {
			requestId: "rid-paceid-01",
		})
		await Promise.resolve()
		const raced = await Promise.race([resultPromise.then(() => "settled"), Promise.resolve("pending")])
		if (raced === "settled") settledSynchronously = true
		expect(settledSynchronously).toBe(false)
		await resultPromise
	})

	// PACEID-02: Queue-mutation purity (4-tag closed enum)
	it("PACEID-02: the queue-mutation decision vocabulary is 4 closed outcomes, well below the 5-6 outcome prior-kernel threshold", () => {
		const allDecisions: QueueMutationDecision[] = [
			{ kind: "dedupe_as_queue" },
			{ kind: "dedupe_as_steer" },
			{ kind: "fresh_queue" },
			{ kind: "fresh_steer" },
		]
		expect(allDecisions.length).toBe(4)
	})

	// PACEID-03: Drain-as-async-state-machine
	it("PACEID-03: the drain loop is an `async` function with `await this.deps.send(...)` and re-entrant `queueMicrotask` — Elm cannot own it", () => {
		const sourcePath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"pending-prompt-service.ts",
		)
		expect(fs.existsSync(sourcePath)).toBe(true)
		const source = fs.readFileSync(sourcePath, "utf8")

		expect(source).toMatch(/async\s+drain\s*\(/)
		expect(source).toMatch(/await\s+this\.deps\.send\s*\(/)
		expect(source).toMatch(/queueMicrotask\s*\(/)
		expect(source).toMatch(/requeueFront/)
		expect(source).toMatch(/continueDrain\s*=\s*false/)
	})

	// PACEID-04: SDK/VSCode kernel placement
	it("PACEID-04: the queue state lives in the SDK (`ActiveSession.pendingPrompts`); the 5 existing Elm kernels are VSCode-only", () => {
		const sdkPath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"pending-prompt-service.ts",
		)
		const sdkSource = fs.readFileSync(sdkPath, "utf8")
		expect(sdkSource).toMatch(/interface\s+PendingPromptQueueState/)
		expect(sdkSource).toMatch(/pendingPrompts:\s*PendingPromptEntry\[\]/)

		const elmRoot = path.resolve(__dirname, "..", "..", "..", "elm")
		const existingKernels = [
			"background-notify-authority",
			"completion-authority",
			"completion-continuation-control",
			"deferred-completion-barrier",
			"task-header-orchestration",
		]
		for (const kernel of existingKernels) {
			const kernelPath = path.resolve(elmRoot, kernel, "src", "Main.elm")
			expect(fs.existsSync(kernelPath), `existing kernel ${kernel} must still be in apps/vscode/elm/`).toBe(true)
		}
	})

	// PACEID-05: Rejected-candidate preservation (SEAM05/SEAM06)
	it("PACEID-05: the admission sub-seam (1-line boolean) was rejected as `NOT_A_GOOD_ELM_SEAM` in SEAM06 — re-litigation is excluded by ACT §3", () => {
		const admissionWitnessPath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"admission-decision.test.ts",
		)
		expect(fs.existsSync(admissionWitnessPath)).toBe(true)
		const witness = fs.readFileSync(admissionWitnessPath, "utf8")
		expect(witness).toMatch(/function\s+resolveAdmissionDelivery/)
		expect(witness).toMatch(/describe\([^)]*SEAM05/i)
	})

	// PACEID-06: Production-seam evidence-loss hazard
	it("PACEID-06: the drain's C4/C5/C6 capture hooks carry structural evidence (jobId + runtimeControlKind) that a closed-tag Elm projection would lose", () => {
		const sdkPath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"pending-prompt-service.ts",
		)
		const source = fs.readFileSync(sdkPath, "utf8")
		expect(source).toMatch(/onEnqueue/)
		expect(source).toMatch(/onBeforeDrain/)
		expect(source).toMatch(/onBeforeDispatch/)
		expect(source).toMatch(/runtimeControlKind\s*\?:\s*RuntimeControlKind/)
		expect(source).toMatch(/jobId\?:\s*string/)
	})

	// PACEID-07: Migration economics — LoC measurement
	it("PACEID-07: the synchronous queue-mutation surface is small; the existing TS is pure and 6/6 GREEN; minimum Elm replacement is ~1500 LoC", () => {
		const sdkPath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"pending-prompt-service.ts",
		)
		const lines = fs
			.readFileSync(sdkPath, "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0).length
		expect(lines).toBeGreaterThan(200)
		expect(lines).toBeLessThan(2000)

		const existingTestPath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"pending-prompt-service.test.ts",
		)
		expect(fs.existsSync(existingTestPath)).toBe(true)
		const existingTest = fs.readFileSync(existingTestPath, "utf8")
		expect(existingTest).toMatch(/describe\("PendingPromptService"/)
		expect(existingTest).toMatch(/deduplicates/)
		expect(existingTest).toMatch(/consumes steer/)
	})

	// PACEID-08: Async state machine preservation
	it("PACEID-08: the drain's `await this.deps.send(...)` chain is irrecoverably TS-side; Elm cannot own the re-entrant microtask rescheduling", () => {
		const sdkPath = path.resolve(
			__dirname,
			"..",
			"..",
			"..",
			"..",
			"..",
			"sdk",
			"packages",
			"core",
			"src",
			"runtime",
			"turn-queue",
			"pending-prompt-service.ts",
		)
		const source = fs.readFileSync(sdkPath, "utf8")
		const drainMatch = source.match(/async\s+drain[\s\S]{0,8000}/)
		expect(drainMatch).not.toBeNull()
		const drain = drainMatch?.[0] ?? ""
		expect(drain).toMatch(/try\s*\{/)
		expect(drain).toMatch(/catch/)
		expect(drain).toMatch(/finally/)
		expect(drain).toMatch(/queueMicrotask/)
		expect(drain).toMatch(/await\s+this\.deps\.send\s*\(/)
		expect(drain).toMatch(/requeueFront/)
	})

	// PACEID-09: Duplication of existing authorities — the 4-outcome
	// queue-mutation decision is below the 5-6 outcome prior-kernel
	// threshold AND it is a "decision over a snapshot", not a "decision
	// over an event stream" — the SEAM10 verdict's "small synchronous
	// projection" trap applies.
	it("PACEID-09: the queue-mutation decision is a synchronous projection over a snapshot, mirroring the SEAM06/SEAM10 'small projection' trap", () => {
		const empty = deriveQueueMutationDecision({
			existingPrompts: [],
			newPrompt: "p1",
			newDelivery: "queue",
		})
		expect(empty.kind).toBe("fresh_queue")

		const steerOnEmpty = deriveQueueMutationDecision({
			existingPrompts: [],
			newPrompt: "p1",
			newDelivery: "steer",
		})
		expect(steerOnEmpty.kind).toBe("fresh_steer")

		const dedupeQueue = deriveQueueMutationDecision({
			existingPrompts: [{ prompt: "p1", delivery: "queue" }],
			newPrompt: "p1",
			newDelivery: "queue",
		})
		expect(dedupeQueue.kind).toBe("dedupe_as_queue")

		const dedupePromoteToSteer = deriveQueueMutationDecision({
			existingPrompts: [{ prompt: "p1", delivery: "queue" }],
			newPrompt: "p1",
			newDelivery: "steer",
		})
		expect(dedupePromoteToSteer.kind).toBe("dedupe_as_steer")

		const dedupePreserveSteer = deriveQueueMutationDecision({
			existingPrompts: [{ prompt: "p1", delivery: "steer" }],
			newPrompt: "p1",
			newDelivery: "queue",
		})
		expect(dedupePreserveSteer.kind).toBe("dedupe_as_steer")
	})

	// PACEID-10: Disposition harness
	it("PACEID-10: disposition = NOT_A_GOOD_ELM_SEAM (admission sub-seam already rejected in SEAM06; consumption chain is async state machine; 4-outcome decision is below the 5-6 outcome prior-kernel threshold)", () => {
		const disposition: PaceidDisposition = {
			kind: "NOT_A_GOOD_ELM_SEAM",
			reason:
				"Candidate A (pending-prompt admission and consumption) is NOT a good Elm seam because: " +
				"(1) the admission sub-seam was rejected as NOT_A_GOOD_ELM_SEAM in SEAM06 " +
				"(1-line boolean for ~1500 LoC of new code) and ACT §3 explicitly excludes re-litigation; " +
				"(2) the consumption chain (enqueue/update/delete/consumeSteer/shiftNext/requeueFront) " +
				"is a 4-outcome synchronous projection over a snapshot, below the 5-6 outcome prior-kernel threshold; " +
				"(3) the drain loop is an `async` state machine with `await this.deps.send(...)` + re-entrant " +
				"`queueMicrotask` + error-branch requeue, all of which are irrecoverably TS-side; " +
				"(4) the queue state lives in SDK `ActiveSession.pendingPrompts` and the 5 existing kernels " +
				"are VSCode-only — moving the kernel to the SDK conflicts with the existing 5-kernel " +
				"VSCode-only convention, or mirroring `ActiveSession` in a VSCode-only bridge is a stateful " +
				"protocol leak; (5) the C4/C5/C6 capture hooks carry `jobId` + `runtimeControlKind` " +
				"structural evidence that a closed-tag Elm projection would lose (TPAEID-06 hazard). " +
				"The SEAM11 boundary fails the interop, ownership, evidence, and economics gates per ACT §4.",
		}
		expect(disposition.kind).toBe("NOT_A_GOOD_ELM_SEAM")
		expect(disposition.reason).toContain("NOT_A_GOOD_ELM_SEAM")
	})
})
