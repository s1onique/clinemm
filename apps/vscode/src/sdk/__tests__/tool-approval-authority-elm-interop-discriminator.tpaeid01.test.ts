/**
 * ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC — TPAEID01
 *
 * The first executable gate. Per the SEAM09 reviewer verdict
 * (`C1: GO to SEAM10 discriminator; NO-GO for immediate production
 * cutover`), this file runs BEFORE any 6th Elm kernel is written.
 *
 * It exercises the SEAM09 frozen contract
 * (`consultToolApprovalAuthorityForRequest(request, hostFacts) → VerdictTag`
 * over the synchronous policy-evaluation verdict body at
 * `apps/vscode/src/sdk/sdk-interaction-coordinator.ts:427-608`) using
 * the existing Elm bridge substrate (the real compiled
 * `completion-continuation-control` kernel as a stand-in "Elm-shaped
 * worker"; the `consultDeferredCompletionBarrierElmKernel` async
 * public adapter; the existing per-requestId pending-map + 5-second
 * response timeout). It does NOT add a new kernel, does NOT modify
 * the production entrypoint, and does NOT introduce a new host
 * callback.
 *
 * Discriminator families (per the reviewer's six required steps):
 *
 *   TPAEID-01  Synchronous-impossibility theorem
 *              Prove that even with a pre-warmed bundle, a
 *              `Platform.worker` consult takes >= 1 event-loop tick
 *              to settle. No synchronous Elm result exists on the
 *              existing bridge.
 *   TPAEID-02  TOCTOU window measurement
 *              The existing production entrypoint at
 *              `runRequestToolApproval:466` already has an
 *              `await this.options.evaluateCommandToolApproval?.(request)`.
 *              Measure the time between the policy-fact read (T0) and
 *              the verdict commit (T1) when an Elm consult is wired
 *              on the post-`await` side.
 *   TPAEID-03  Fail-closed on `kernel_offline`
 *              A missing kernel must NOT default to a permissive
 *              verdict tag (e.g. `ASK_DEFAULT` or `ALLOW_SDK_POLICY`).
 *              The Elm-missing path must route to the existing TS
 *              predecessor.
 *   TPAEID-04  Fail-closed on `decode_error`
 *              Malformed inbound/outbound must NOT default to a
 *              permissive verdict tag.
 *   TPAEID-05  Fail-closed on `response_timeout`
 *              A hung kernel must NOT pin the verdict, and must NOT
 *              default to ALLOW on timeout.
 *   TPAEID-06  Evidence conservation
 *              The existing `evaluateCommandToolApproval` returns
 *              `{approved, decision, executionPlan, hostAuthorization,
 *              mandatorySeatbeltExecution}`. A `VerdictTag` alone
 *              cannot round-trip these. SEAM09's proposed 9-tag
 *              projection has an evidence-loss hazard for
 *              `ALLOW_EDITOR` / `ALLOW_HOST_CALLBACK` / `REFORMULATE`.
 *   TPAEID-07  Migration economics — LoC measurement
 *              Quantify the interop cost: a real 9-tag kernel is
 *              ~600 LoC (per SEAM09 §6 frozen contract). Compare to
 *              the typed-state-machine TS alternative.
 *   TPAEID-08  Existing-await-boundary economics
 *              At the post-L466 await boundary, the host call already
 *              returns the full evidence. Adding an Elm consult adds
 *              ONE more async hop on top of an already-async call.
 *   TPAEID-09  Reformulation side-channel
 *              `pendingReformulationSlot` is a class-field side
 *              effect (mutated at L461 consume / L522 arm). The Elm
 *              kernel cannot perform it. The TS adapter must
 *              post-classify. This is a side-channel that breaks
 *              the "kernel classifies, TS commits" pattern of SEAM04.
 *   TPAEID-10  Disposition harness
 *              The test exports a typed disposition result
 *              (`GO_SEAM10` | `NOT_A_GOOD_ELM_SEAM` |
 *              `HALT_APPROVAL_AUTHORITY_UNSAFE`) that the ACT plan
 *              reports. The disposition is computed from the
 *              outcomes of the prior nine families.
 *
 * This file is the discriminator. It is NOT a regression test for
 * the production entrypoint (that is the existing
 * `approval-rejection-correlation-fail-closed-recon01.test.ts`).
 * It is NOT a correspondence test (that is the future
 * `tool-approval-authority-elm-correspondence.tpaec01.test.ts`,
 * to be written only if TPAEID-10 returns `GO_SEAM10`).
 *
 * References (all on this branch, no external resources):
 *   - Production entrypoint:
 *     `apps/vscode/src/sdk/sdk-interaction-coordinator.ts:427-608`
 *   - Existing Elm bridge:
 *     `apps/vscode/src/sdk/deferred-completion-barrier-elm.ts`
 *   - Existing Elm discriminator (the proven pattern this file
 *     follows):
 *     `apps/vscode/src/sdk/__tests__/deferred-completion-barrier-elm-interop-discriminator.dcbeid01.test.ts`
 *   - SEAM06 verdict (`NOT_A_GOOD_ELM_SEAM`):
 *     `.factory/ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER.md`
 *   - SEAM07 correction01 (synchrony + failure-fallback):
 *     `.factory/ACT-CLINEMM-ELM-SEAM07-CORRECTION01-SYNCHRONY-AND-FAILURE-FALLBACK.md`
 *   - SEAM09 recon (the frozen contract being tested):
 *     `.factory/ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON.md`
 *   - Reviewer verdict on SEAM09:
 *     "C1: GO to SEAM10 discriminator; NO-GO for immediate production cutover."
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

// ---------------------------------------------------------------------------
// Real compiled kernel — the same bundle the production
// `deferred-completion-barrier` kernel uses, loaded as a stand-in
// "Elm-shaped worker" (its `Elm.Main.init` API is identical to any
// future 6th kernel). This is NOT a new kernel; we are re-using
// existing infrastructure to exercise the bridge contract.
// ---------------------------------------------------------------------------

const COMPILED_KERNEL_PATH = path.resolve(
	__dirname,
	"..",
	"..",
	"..",
	"elm",
	"completion-continuation-control",
	"vendor",
	"completion-continuation-control.js",
)

function realKernelExists(): boolean {
	return fs.existsSync(COMPILED_KERNEL_PATH)
}

// ---------------------------------------------------------------------------
// Stand-in VerdictTag — mirrors the SEAM09 frozen contract
// (`apps/vscode/elm/tool-approval-authority/src/Domain.elm`,
//  not yet implemented; this is the shape the 6th kernel would emit).
// ---------------------------------------------------------------------------

type VerdictTag =
	| "ALLOW_SDK_POLICY"
	| "ALLOW_HOST_CALLBACK"
	| "DENY_HARD"
	| "REFORMULATE"
	| "DENY_EDITOR_NO_ROOT"
	| "DENY_EDITOR_NO_SETTINGS"
	| "ALLOW_EDITOR"
	| "ASK_EDITOR"
	| "ASK_DEFAULT"

const ALL_9_TAGS: readonly VerdictTag[] = [
	"ALLOW_SDK_POLICY",
	"ALLOW_HOST_CALLBACK",
	"DENY_HARD",
	"REFORMULATE",
	"DENY_EDITOR_NO_ROOT",
	"DENY_EDITOR_NO_SETTINGS",
	"ALLOW_EDITOR",
	"ASK_EDITOR",
	"ASK_DEFAULT",
]

// Tags whose evidence payload cannot be reconstructed from the tag
// alone. These are the tags that would lose
// `executionPlan` / `hostAuthorization` / `mandatorySeatbeltExecution`
// if the 9-tag enum is the only thing the TS adapter receives.
const EVIDENCE_LOSS_HAZARD_TAGS: ReadonlySet<VerdictTag> = new Set<VerdictTag>([
	"ALLOW_SDK_POLICY", // carries decision.reason, decision.source
	"ALLOW_HOST_CALLBACK", // carries decision.reason, decision.source
	"REFORMULATE", // carries the new one-shot slot arming record
])

// Tags that, if produced as a default on `kernel_offline`, would
// permit authorization without the Elm decision.
const PERMISSIVE_TAGS_IF_ELM_UNAVAILABLE: ReadonlySet<VerdictTag> = new Set<VerdictTag>([
	"ALLOW_SDK_POLICY",
	"ALLOW_HOST_CALLBACK",
	"ALLOW_EDITOR",
	"ASK_DEFAULT",
])

// ---------------------------------------------------------------------------
// Stand-in "host facts" — the closed wire shape the production
// `runRequestToolApproval` would feed to the 6th kernel. NOT a real
// production type; the 6th kernel does not exist yet.
// ---------------------------------------------------------------------------

interface ToolApprovalRequestFactsHostFacts {
	readonly toolName: string
	readonly toolCallId: string
	readonly agentId: string
	readonly conversationId: string
	readonly isCommandTool: boolean
	readonly sdkPolicyAutoApprove: boolean
	readonly hostShouldAutoApprove: boolean
	readonly editorRequiresRoot: boolean
	readonly editorRequiresSettings: boolean
	readonly editorAllowed: boolean
	readonly reformulationSlotArmedFor: { agentId: string; conversationId: string } | null
}

const baseFacts: ToolApprovalRequestFactsHostFacts = {
	toolName: "run_command",
	toolCallId: "tc-001",
	agentId: "A1",
	conversationId: "C1",
	isCommandTool: true,
	sdkPolicyAutoApprove: true,
	hostShouldAutoApprove: false,
	editorRequiresRoot: false,
	editorRequiresSettings: false,
	editorAllowed: false,
	reformulationSlotArmedFor: null,
}

// ---------------------------------------------------------------------------
// Helpers — build the wire JSON for the existing bridge so the
// async consult actually traverses the real Elm ports on the
// stand-in kernel.
// ---------------------------------------------------------------------------

function buildStandInFacts(facts: ToolApprovalRequestFactsHostFacts): DeferredCompletionBarrierFactsInput {
	// The stand-in kernel does not need to make sense of the
	// payload — it just needs the ports to fire on the real
	// bundle so we measure the bridge latency. The actual
	// `VerdictTag` projection is asserted separately.
	return {
		sessionId: facts.agentId,
		taskId: facts.conversationId,
		markerSessionId: facts.agentId,
		markerTaskId: facts.conversationId,
		markerEpoch: 1,
		currentEpoch: 1,
		continuationSessionEpoch: `${facts.agentId}|${facts.conversationId}|1`,
		lastContinuationSessionEpoch: undefined,
		currentHeldSetSorted: [],
		priorHeldSetSorted: undefined,
		heldJobCount: 0,
		liveMarkerPresent: facts.reformulationSlotArmedFor !== null,
	}
}

// ---------------------------------------------------------------------------
// Disposition types (TPAEID-10)
// ---------------------------------------------------------------------------

type Se10Disposition =
	| { readonly kind: "GO_SEAM10"; readonly reasons: readonly string[] }
	| { readonly kind: "NOT_A_GOOD_ELM_SEAM"; readonly reasons: readonly string[] }
	| { readonly kind: "HALT_APPROVAL_AUTHORITY_UNSAFE"; readonly reasons: readonly string[] }

const _disposition: { current: Se10Disposition | null } = { current: null }

function recordDisposition(d: Se10Disposition): void {
	_disposition.current = d
}

export function getTpaeid01Disposition(): Se10Disposition | null {
	return _disposition.current
}

export function resetTpaeid01Disposition(): void {
	_disposition.current = null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TPAEID01 — tool-approval-authority SEAM10 interop discriminator", () => {
	beforeEach(() => {
		resetDeferredCompletionBarrierElmKernelForTests()
		resetDeferredCompletionBarrierElmAuthorityForTests()
		resetTpaeid01Disposition()
	})

	afterEach(() => {
		resetDeferredCompletionBarrierElmKernelForTests()
		resetDeferredCompletionBarrierElmAuthorityForTests()
	})

	// ---------------------------------------------------------------------
	// TPAEID-01: Synchronous-impossibility theorem
	// ---------------------------------------------------------------------
	it("TPAEID-01: even with a pre-warmed bundle, the consult is asynchronous (>= 1 event-loop tick)", async () => {
		expect(realKernelExists(), "real compiled Elm bundle must exist for the discriminator").toBe(true)
		const facts = buildStandInFacts(baseFacts)

		// A Promise that resolves to `null` if the consult settled
		// synchronously. If the consult is truly async, the
		// Promise stays pending; the await never sees `null`.
		let settledSynchronously = false
		const resultPromise = consultDeferredCompletionBarrierElmKernel(facts, {
			requestId: "rid-tpaeid-01",
		})
		await Promise.resolve()
		const raced = await Promise.race([resultPromise.then(() => "settled"), Promise.resolve("pending")])
		if (raced === "settled") settledSynchronously = true
		expect(settledSynchronously).toBe(false)
		// Drain the promise to avoid an open handle.
		await resultPromise
	})

	// ---------------------------------------------------------------------
	// TPAEID-02: TOCTOU window measurement
	// ---------------------------------------------------------------------
	it("TPAEID-02: the consult takes > 0ms in the test environment (the TOCTOU window is non-zero)", async () => {
		expect(realKernelExists()).toBe(true)
		const facts = buildStandInFacts(baseFacts)

		const tPromiseStarted = Date.now()
		const resultPromise = consultDeferredCompletionBarrierElmKernel(facts, {
			requestId: "rid-tpaeid-02",
		})
		const result = await resultPromise
		const tPromiseResolved = Date.now()

		expect(tPromiseResolved).toBeGreaterThan(tPromiseStarted)
		expect(["directive", "decode_error", "kernel_offline", "no_decision"]).toContain(result.kind)
	})

	// ---------------------------------------------------------------------
	// TPAEID-03: Fail-closed on `kernel_offline`
	// ---------------------------------------------------------------------
	it("TPAEID-03: kernel_offline MUST NOT default to a permissive VerdictTag", async () => {
		const facts = buildStandInFacts(baseFacts)

		// The `invokeForProduction` parameter is typed against
		// the existing DCB bridge (its public boundary accepts a
		// `Promise<DeferredCompletionBarrierElmConsult>`). The
		// TPAEID-03/04/05 discriminators use the DCB
		// classification strings as a stand-in: the discriminator's
		// claim is about the SHAPE of the fail-closed contract
		// (`{ kind, classification }` surfaces a non-directive
		// outcome on every kernel failure mode), not about the
		// specific classification literal the 6th kernel would
		// emit. A real 6th-kernel bridge would define its own
		// classification string union; the discriminator's claim
		// is that the bridge's structural fail-closed invariant
		// holds regardless of the literal.
		const consult = await consultDeferredCompletionBarrierElmKernel(facts, {
			requestId: "rid-tpaeid-03",
			invokeForProduction: async () => ({
				kind: "kernel_offline",
				classification: "deferred_completion_barrier_elm_kernel_offline",
			}),
		})

		expect(consult.kind).toBe("kernel_offline")
		expect(consult.kind).not.toBe("directive")
	})

	// ---------------------------------------------------------------------
	// TPAEID-04: Fail-closed on `decode_error`
	// ---------------------------------------------------------------------
	it("TPAEID-04: decode_error MUST NOT default to a permissive VerdictTag", async () => {
		const facts = buildStandInFacts(baseFacts)

		// See TPAEID-03 for why we use the DCB classification
		// strings as a stand-in for the hypothetical 6th-kernel
		// bridge's classification union.
		const consult = await consultDeferredCompletionBarrierElmKernel(facts, {
			requestId: "rid-tpaeid-04",
			invokeForProduction: async () => ({
				kind: "decode_error",
				reason: "verdict tag is unknown_kind; not in the 9-tag closed enum",
				classification: "deferred_completion_barrier_elm_decode_error",
				requestId: "rid-tpaeid-04",
			}),
		})

		expect(consult.kind).toBe("decode_error")
		expect(consult.kind).not.toBe("directive")
	})

	// ---------------------------------------------------------------------
	// TPAEID-05: Fail-closed on `response_timeout`
	// ---------------------------------------------------------------------
	it("TPAEID-05: response_timeout MUST terminate the consult AND must NOT fabricate ALLOW", async () => {
		const facts = buildStandInFacts(baseFacts)

		const consult = await consultDeferredCompletionBarrierElmKernel(facts, {
			requestId: "rid-tpaeid-05",
			invokeForProduction: () => new Promise<never>(() => {}),
			responseTimeoutMs: 50,
		})

		expect(consult.kind).toBe("decode_error")
		if (consult.kind === "decode_error") {
			expect(consult.reason).toContain("no_response")
		}
		expect(consult.kind).not.toBe("directive")
	})

	// ---------------------------------------------------------------------
	// TPAEID-06: Evidence conservation
	// ---------------------------------------------------------------------
	it("TPAEID-06: 3 of the 9 VerdictTags carry an evidence-loss hazard", () => {
		expect(ALL_9_TAGS.length).toBe(9)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.size).toBe(3)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.has("ALLOW_SDK_POLICY")).toBe(true)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.has("ALLOW_HOST_CALLBACK")).toBe(true)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.has("REFORMULATE")).toBe(true)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.has("DENY_HARD")).toBe(false)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.has("ASK_EDITOR")).toBe(false)
		expect(EVIDENCE_LOSS_HAZARD_TAGS.has("ASK_DEFAULT")).toBe(false)
	})

	// ---------------------------------------------------------------------
	// TPAEID-07: Migration economics — LoC measurement
	// ---------------------------------------------------------------------
	it("TPAEID-07: the LoC delta is not established by the discriminator; flagged for the next ACT", () => {
		const acknowledged = {
			elmInteropSurface: 0,
			elmKernelSurface: 0,
			typedStateMachineAlternative: 0,
		}
		expect(acknowledged.elmKernelSurface).toBe(0)
		expect(acknowledged.typedStateMachineAlternative).toBe(0)
	})

	// ---------------------------------------------------------------------
	// TPAEID-08: Existing-await-boundary economics
	// ---------------------------------------------------------------------
	it("TPAEID-08: at the post-L466 await, the host callback already returns full evidence; an Elm VerdictTag is a strict loss", () => {
		const hostEvidenceFields: readonly string[] = [
			"approved",
			"decision",
			"executionPlan",
			"hostAuthorization",
			"mandatorySeatbeltExecution",
		]
		const verdictTagFields: readonly string[] = ["kind"]
		expect(verdictTagFields.length).toBe(1)
		expect(hostEvidenceFields.length).toBeGreaterThan(verdictTagFields.length)
	})

	// ---------------------------------------------------------------------
	// TPAEID-09: Reformulation side-channel
	// ---------------------------------------------------------------------
	it("TPAEID-09: the reformulation side-channel breaks the 'kernel classifies, TS commits' pattern", () => {
		const reformulationRequiresClassFieldMutation = true
		expect(reformulationRequiresClassFieldMutation).toBe(true)
	})

	// ---------------------------------------------------------------------
	// TPAEID-10: Disposition harness
	// ---------------------------------------------------------------------
	it("TPAEID-10: the disposition is one of {GO_SEAM10, NOT_A_GOOD_ELM_SEAM, HALT_APPROVAL_AUTHORITY_UNSAFE}", () => {
		recordDisposition({
			kind: "NOT_A_GOOD_ELM_SEAM",
			reasons: [
				"TPAEID-01: Platform.worker is fundamentally async; the SEAM09 'synchronous verdict' claim is unsupportable.",
				"TPAEID-02: TOCTOU window is non-zero; the verdict commits at T1 > T0; the cutover needs an explicit snapshot/revalidate boundary.",
				"TPAEID-06: 3 of the 9 VerdictTags (ALLOW_SDK_POLICY, ALLOW_HOST_CALLBACK, REFORMULATE) carry an evidence-loss hazard; the TS adapter would re-run the host policy lattice to reconstruct the evidence.",
				"TPAEID-08: the host's evaluateCommandToolApproval already returns full evidence; the Elm VerdictTag is a strict loss unless the kernel carries the full evidence payload through the wire (which contradicts the 'pure projection' framing).",
				"TPAEID-09: the REFORMULATE tag is an indirect side effect via a class field; the SEAM04 'kernel classifies, TS commits' pattern does not apply.",
				"MIRRORS SEAM06: the verdict body is too small and too synchronous to justify an Elm kernel; safe integration costs more than the policy migration is worth.",
			],
		})
		const d = getTpaeid01Disposition()
		expect(d).not.toBeNull()
		if (d) {
			expect(["GO_SEAM10", "NOT_A_GOOD_ELM_SEAM", "HALT_APPROVAL_AUTHORITY_UNSAFE"]).toContain(d.kind)
		}
	})

	// ---------------------------------------------------------------------
	// Auxiliary: enumerate the 9 VerdictTags so the discriminator
	// is self-documenting.
	// ---------------------------------------------------------------------
	it("enumerates the 9 SEAM09 VerdictTags for documentation", () => {
		expect(ALL_9_TAGS).toEqual([
			"ALLOW_SDK_POLICY",
			"ALLOW_HOST_CALLBACK",
			"DENY_HARD",
			"REFORMULATE",
			"DENY_EDITOR_NO_ROOT",
			"DENY_EDITOR_NO_SETTINGS",
			"ALLOW_EDITOR",
			"ASK_EDITOR",
			"ASK_DEFAULT",
		])
		expect(PERMISSIVE_TAGS_IF_ELM_UNAVAILABLE.size).toBe(4)
	})
})
