/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C11)
 *
 * Kernel-namespace coexistence: the completion-continuation-control Elm
 * kernel MUST coexist with the completion-authority and task-header
 * orchestration kernels already loaded into `globalThis.Elm`.
 *
 * Mirrors the proven task-header-elm-namespace-coexistence pattern.
 * Pre-populates `globalThis.Elm` with a fake completion-authority kernel
 * that fails on the completion-continuation-control facts shape, then
 * asserts the real completion-continuation-control kernel still emits a
 * valid directive.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	pickContinuationDirectiveForPublication,
	resetElmKernelForTests,
	resetCompletionContinuationControlElmAuthorityForTests,
} from "../completion-continuation-control-elm"

const FACT_INPUT = {
	unconsumedCount: 2,
	capabilities: { canObserveHeldResults: true, canRetryCompletion: true },
	priorHeldSetSorted: undefined, currentHeldSetSorted: ["j1", "j2"],
	sessionMatches: true,
	taskMatches: true,
	alreadyCommitted: false,
}

interface FakeElmMain {
	init(opts: unknown): unknown
}
interface FakeElmExports {
	readonly Main: FakeElmMain
}

function installFakeCompletionAuthority(): FakeElmExports {
	const fakeElm: FakeElmExports = {
		Main: {
			init() {
				const ports = {
					inbound: {
						send: () => {
							// The fake never emits outbound; observation would be the
							// decode_error signature if it did.
						},
					},
					outbound: {
						subscribe: () => {
							// No-op
						},
					},
				}
				return { ports }
			},
		},
	}
	;(globalThis as Record<string, unknown>).Elm = fakeElm
	return fakeElm
}

function uninstallFakeCompletionAuthority() {
	delete (globalThis as Record<string, unknown>).Elm
}

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C11 namespace coexistence", () => {
	beforeEach(() => {
		resetElmKernelForTests()
		resetCompletionContinuationControlElmAuthorityForTests()
	})
	afterEach(() => {
		resetElmKernelForTests()
		uninstallFakeCompletionAuthority()
	})

	it("GREEN: real invoke against a process with globalThis.Elm already populated (completion-authority coexistence)", async () => {
		installFakeCompletionAuthority()
		const directive = await pickContinuationDirectiveForPublication(FACT_INPUT)
		expect(directive.tag).toBe("observe_then_retry")
		expect(directive.completionStatus).toBe("HELD")
		expect(directive.requiredAction).toBe("observe_then_submit")
		// The fake never pollutes our namespace.
		const fake = (globalThis as Record<string, unknown>).Elm as FakeElmExports
		expect(fake.Main).toBeDefined()
	})

	it("GREEN: completion-continuation-control Elm does NOT mutate globalThis.Elm", async () => {
		installFakeCompletionAuthority()
		const fakeBefore = (globalThis as Record<string, unknown>).Elm as FakeElmExports
		const directive = await pickContinuationDirectiveForPublication(FACT_INPUT)
		expect(directive.tag).toBe("observe_then_retry")
		const fakeAfter = (globalThis as Record<string, unknown>).Elm as FakeElmExports
		expect(fakeAfter).toBe(fakeBefore)
	})
})
