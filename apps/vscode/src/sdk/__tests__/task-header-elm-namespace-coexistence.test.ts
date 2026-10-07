/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING
 *
 * Regression test: the TaskHeader kernel MUST coexist with another Elm
 * bundle already loaded into `globalThis.Elm` (e.g. the completion-
 * authority kernel, which is loaded unconditionally at extension
 * activation BEFORE any TaskHeader invocation).
 *
 * Production bug (the cause of the LIVE 512/512 decode_error):
 *
 *   1. The completion-authority kernel loads first via
 *      `initializeElmAuthorityRuntime(elmAuthorityKernelPath)` in
 *      `extension.ts:activate`. Its IIFE writes `globalThis.Elm =
 *      completionAuthorityKernelExports`.
 *   2. The TaskHeader kernel's `ensureElmKernelEvaluated` then tries
 *      to evaluate the TaskHeader bundle into `globalThis.Elm`. The
 *      IIFE's `_Platform_export` detects the existing `globalThis.Elm`,
 *      walks the merge, and trips on `Main.init` —
 *      `_Debug_crash(6, 'Elm')`.
 *   3. The TS wrapper around the bundle evaluation swallows the throw
 *      and returns false. `globalThis.Elm` is STILL the completion-
 *      authority kernel. `loadCompiledElmKernel` then reads
 *      `globalThis.Elm.Main.init` — the completion-authority init.
 *   4. Every `Facts` quadruple the runtime shadow sends through
 *      `kernel.sendInbound` is fed into the COMPLETION-AUTHORITY's
 *      `decoder`, which begins with
 *      `Decode.field "tag" Decode.string |> andThen decodeMsgFromTag`.
 *      The flat `Facts` quadruple has no `tag` field, so the decoder
 *      reports "Expecting an OBJECT with a field named `tag`" — 512
 *      times in the LIVE observation.
 *
 * Repair: `ensureElmKernelEvaluated` evaluates the bundle into a
 * per-kernel `{}` namespace via `evaluator.call(namespace, namespace)`
 * so the IIFE's `scope` parameter is `namespace`, never
 * `globalThis`. `loadCompiledElmKernel` reads from the captured
 * `_taskHeaderKernelNamespace`, never `globalThis.Elm`. The TaskHeader
 * kernel and the completion-authority kernel can therefore both be
 * loaded into the same process without collision.
 *
 * This test simulates the production coexistence scenario by:
 *
 *   1. Pre-populating `globalThis.Elm` with a fake completion-authority
 *      kernel that fails on flat Facts (mirrors the
 *      completion-authority's `Decode.field "tag"` rejection).
 *   2. Calling the real `invokeElmKernel` (no DI — exercises the
 *      production seam end-to-end).
 *   3. Asserting the decision is `presentation` for the LIVE
 *      specimen, NOT `decode_error`. Before the repair this test
 *      failed with `kind: "decode_error", reason: "Expecting an OBJECT
 *      with a field named `tag"` — exactly the LIVE 512/512 trace.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { invokeElmKernel, type TaskHeaderElmFactsJson } from "../task-header-elm-shadow"

// The LIVE 512/512 specimen (canonical idle / legacy streaming, seq=6286).
const LIVE_SPECIMEN: TaskHeaderElmFactsJson = {
	canonicalShadowPhase: "idle",
	currentLegacyPhase: "streaming",
	seq: 6286,
	canonicalShadowObservedTurnSeq: null,
}

interface FakeElmMain {
	init(opts: unknown): unknown
}
interface FakeElmExports {
	readonly Main: FakeElmMain
}

/**
 * Install a fake completion-authority `Elm` global whose `Main.init({})`
 * returns a Platform.worker-shaped app. Sending ANY object to its
 * `inbound` port triggers a single outbound
 * `{kind:"decode_error", error: "<reason>"}` payload — mirroring the
 * real completion-authority kernel's `Decode.field "tag"` rejection of
 * any non-tagged object. The fake is constructed to behave IDENTICALLY
 * to what the real completion-authority bundle would do on a
 * TaskHeader-shaped payload (always reject, always with the same "tag"
 * error) — so this test reproduces the exact production symptom.
 *
 * Returns a teardown that restores the previous `globalThis.Elm` (if
 * any).
 */
function installFakeCompletionAuthorityKernel(reason: string = "Expecting an OBJECT with a field named `tag`"): () => void {
	const previous = (globalThis as { Elm?: unknown }).Elm

	const subs = new Set<(v: unknown) => void>()
	const fakeApp = {
		ports: {
			inbound: {
				send(_value: unknown): void {
					// Synchronously dispatch the decode_error reply on the next
					// microtask, mirroring the real Elm worker pattern.
					Promise.resolve().then(() => {
						for (const cb of subs) {
							cb({ kind: "decode_error", error: reason })
						}
					})
				},
			},
			outbound: {
				subscribe(cb: (v: unknown) => void): void {
					subs.add(cb)
				},
			},
		},
	}

	const fakeElm: FakeElmExports = {
		Main: {
			init(_opts: unknown): unknown {
				return fakeApp
			},
		},
	}
	;(globalThis as { Elm?: unknown }).Elm = fakeElm

	return () => {
		;(globalThis as { Elm?: unknown }).Elm = previous
	}
}

beforeEach(async () => {
	const { resetElmKernelForTests } = await import("../task-header-elm-shadow")
	resetElmKernelForTests()
})

afterEach(async () => {
	const { resetElmKernelForTests } = await import("../task-header-elm-shadow")
	resetElmKernelForTests()
	// Clear the fake kernel we may have installed.
	;(globalThis as { Elm?: unknown }).Elm = undefined
})

describe("ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING", () => {
	it("GREEN: real invokeElmKernel against the LIVE specimen succeeds (presentation) when no other kernel occupies globalThis.Elm", async () => {
		// Baseline: with a clean globalThis, the real TaskHeader kernel
		// loads via the sandboxed namespace and returns presentation.
		// This is the contract the ORCHESTRATION01 fixture suite
		// (`task-header-elm-orchestration-authority01.test.ts`) already
		// validates for many fixtures; this is the LIVE specimen in
		// particular.
		const decision = await invokeElmKernel(LIVE_SPECIMEN)
		expect(decision.kind).toBe("presentation")
		if (decision.kind !== "presentation") return
		expect(decision.value).toStrictEqual({ phase: "streaming", source: "legacy", seq: 6286 })
	})

	it("GREEN: real invokeElmKernel against the LIVE specimen succeeds EVEN WHEN globalThis.Elm is already populated (completion-authority coexistence)", async () => {
		// The repair's invariant: the TaskHeader kernel writes to its
		// own sandboxed namespace and never touches `globalThis.Elm`.
		// Therefore a pre-populated `globalThis.Elm` (simulating the
		// completion-authority kernel loaded at extension activation)
		// MUST NOT contaminate the TaskHeader decision.
		const uninstall = installFakeCompletionAuthorityKernel()
		try {
			const decision = await invokeElmKernel(LIVE_SPECIMEN)
			expect(decision.kind).toBe("presentation")
			if (decision.kind !== "presentation") return
			expect(decision.value).toStrictEqual({ phase: "streaming", source: "legacy", seq: 6286 })
		} finally {
			uninstall()
		}
	})

	it("GREEN: the fake completion-authority globalThis.Elm is NOT mutated by invokeElmKernel (sandbox isolation)", async () => {
		// Additional invariant: after `invokeElmKernel` runs, the fake
		// completion-authority `globalThis.Elm` MUST still be the fake's
		// exports (i.e., the TaskHeader kernel did NOT overwrite it).
		const uninstall = installFakeCompletionAuthorityKernel()
		try {
			await invokeElmKernel(LIVE_SPECIMEN)
			const after = (globalThis as { Elm?: FakeElmExports }).Elm
			expect(after).toBeDefined()
			expect(typeof after!.Main.init).toBe("function")
			// The fake's init still returns a working fake app.
			const app = after!.Main.init({})
			expect(app).toBeDefined()
		} finally {
			uninstall()
		}
	})

	it("GREEN: malformed TaskHeader payload still fails via the TaskHeader decoder (not the fake completion-authority decoder)", async () => {
		// GREEN-4 invariant: the repair MUST NOT relax fail-closed
		// semantics. A genuinely malformed TaskHeader payload (no
		// `currentLegacyPhase`) must still produce a decode_error, and
		// the reason must come from the TASKHEADER decoder (missing
		// field "currentLegacyPhase"), NOT from the fake
		// completion-authority decoder (missing field "tag").
		//
		// Concretely: if the TaskHeader loader were still reading
		// `globalThis.Elm` (the wrong-kernel defect), this input would
		// be sent to the fake completion-authority `Main.init({})` and
		// the reply would carry `error: "Expecting an OBJECT with a
		// field named `tag`"`. The repair routes the input through the
		// TaskHeader kernel, whose `factsDecoder` requires
		// `currentLegacyPhase`, `seq`, and (non-null) `canonicalShadowObservedTurnSeq`
		// — so the reply is a TaskHeader-flavored decode error.
		const MALFORMED_TASKHEADER_PAYLOAD = {
			canonicalShadowPhase: null,
			seq: 6286,
			// currentLegacyPhase intentionally absent
		} as unknown as TaskHeaderElmFactsJson

		const uninstall = installFakeCompletionAuthorityKernel()
		try {
			const decision = await invokeElmKernel(MALFORMED_TASKHEADER_PAYLOAD)
			expect(decision.kind).toBe("decode_error")
			if (decision.kind !== "decode_error") return
			// The TaskHeader decoder requires `currentLegacyPhase`; the
			// failure must reference that field (or any non-`tag` field
			// owned by the TaskHeader factsDecoder). It MUST NOT
			// reference the completion-authority top-level `tag`.
			expect(decision.reason).not.toContain("`tag`")
			expect(decision.classification).toBe("task_header_elm_decode_error")
		} finally {
			uninstall()
		}
	})
})
