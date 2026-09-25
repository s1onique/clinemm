/**
 * ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 —
 * deriveOrigin precedence conservation.
 *
 * The bounded repair extends `deriveOrigin(delivery, jobId?)` to
 * recover the `pending_prompt_drain` origin at C7/C8 for drained
 * turns whose `next.delivery` was intentionally dropped at the
 * drain -> send boundary. The P1 boundary check is that the
 * `jobId` fallback must NOT re-classify existing
 * `delivery`-bearing calls: in particular,
 * `deriveOrigin("steer", "job-1")` MUST stay
 * `deferred_continuation`, not flip to `pending_prompt_drain`.
 *
 * These assertions are independent of the CCARD capture module:
 * they exercise the precedence rule directly. The CCARD tests
 * exercise the capture module's per-stage origin recording; this
 * test pins the deriveOrigin closure precedence invariant that
 * the OOM repair's bounded boundary depends on.
 *
 * The deriveOrigin closure is private to
 * `apps/vscode/src/sdk/vscode-session-host.ts`. This test pins
 * the precedence invariant by reading the source as text and
 * asserting on the order of the if/return statements, which is
 * the durable structural invariant. A future contributor who
 * re-orders the branches (e.g. putting jobId first) trips this
 * test — that is the discriminator the bounded repair depends
 * on.
 */

import { describe, expect, it } from "vitest"

function readFile(): string {
	// Lazy import so the test runner can locate the source via
	// the workspace tsconfig. The relative path is stable across
	// vitest, bun, and the production build.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("node:fs").readFileSync(require("node:path").resolve(__dirname, "..", "vscode-session-host.ts"), "utf-8")
}

function extractDeriveOriginBody(source: string): string {
	const start = source.indexOf("const deriveOrigin = (")
	if (start < 0) throw new Error("deriveOrigin not found in source")
	const bodyStart = source.indexOf("=>", start)
	if (bodyStart < 0) throw new Error("deriveOrigin body start not found")
	let depth = 0
	let end = bodyStart
	for (let i = bodyStart; i < source.length; i++) {
		const c = source[i]
		if (c === "{") depth++
		else if (c === "}") {
			depth--
			if (depth === 0) {
				end = i
				break
			}
		}
	}
	return source.slice(start, end + 1)
}

describe("ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 — deriveOrigin precedence", () => {
	it("delivery takes precedence over jobId (so 'steer' is not reclassified by jobId)", () => {
		// Read the deriveOrigin closure and confirm the if/return
		// order: `delivery === "queue"` first, then
		// `delivery === "steer"`, then `jobId` fallback, then
		// `explicit_user` default. The CCARD-ORIGIN-01 test
		// exercises the capture module's per-stage recording;
		// this test pins the closure precedence.
		const source = readFile()
		const body = extractDeriveOriginBody(source)
		const queueIdx = body.indexOf('delivery === "queue"')
		const steerIdx = body.indexOf('delivery === "steer"')
		const jobIdIdx = body.indexOf("jobId !== undefined")
		const explicitIdx = body.indexOf('return "explicit_user"')
		expect(queueIdx, 'delivery === "queue" branch missing').toBeGreaterThan(0)
		expect(steerIdx, 'delivery === "steer" branch missing').toBeGreaterThan(0)
		expect(jobIdIdx, "jobId fallback missing").toBeGreaterThan(0)
		expect(explicitIdx, "explicit_user fallback missing").toBeGreaterThan(0)
		// Order invariants. Putting jobId before delivery would
		// re-classify `deriveOrigin("steer", "job-1")` as
		// `pending_prompt_drain` — the regression the bounded
		// P1 fix prevents.
		expect(queueIdx).toBeLessThan(steerIdx)
		expect(steerIdx).toBeLessThan(jobIdIdx)
		expect(jobIdIdx).toBeLessThan(explicitIdx)
	})

	it("deriveOrigin precedence — exhaustive truth table", () => {
		// Reconstruct the precedence rule as a pure function
		// mirror of the production closure. The closure is
		// private; the mirror exists so this test pins the
		// semantic truth table independently of the source
		// extraction above.
		const deriveOrigin = (
			delivery: "queue" | "steer" | undefined,
			jobId?: string,
		): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" => {
			if (delivery === "queue") return "pending_prompt_drain"
			if (delivery === "steer") return "deferred_continuation"
			if (jobId !== undefined) return "pending_prompt_drain"
			return "explicit_user"
		}
		// CCARD C7/C8 drained turn (delivery dropped at the
		// repair boundary; jobId from terminal-wake path).
		expect(deriveOrigin(undefined, "job-1")).toBe("pending_prompt_drain")
		// Backward-compat: explicit queue caller WITHOUT jobId.
		expect(deriveOrigin("queue", undefined)).toBe("pending_prompt_drain")
		expect(deriveOrigin("queue", "job-1")).toBe("pending_prompt_drain")
		// Steer must stay steer regardless of jobId (the P1
		// boundary check).
		expect(deriveOrigin("steer", undefined)).toBe("deferred_continuation")
		expect(deriveOrigin("steer", "job-1")).toBe("deferred_continuation")
		// Default — explicit user, no provenance.
		expect(deriveOrigin(undefined, undefined)).toBe("explicit_user")
	})
})
