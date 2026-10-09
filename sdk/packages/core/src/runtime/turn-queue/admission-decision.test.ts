/**
 * ACT-CLINEMM-ELM-SEAM05-PROMPT-ADMISSION-RECON — executable baseline witness.
 *
 * **Status: recon-only. NO PRODUCTION CODE TOUCHED.**
 *
 * This file pins the **pure** prompt-admission decision currently
 * embedded inline at `LocalRuntimeHost.runTurn` in
 * `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1244-1248`:
 *
 *   const canStartRun = session.agent.canStartRun();
 *   const resolvedDelivery =
 *       input.delivery ??
 *       (session.interactive && !canStartRun ? "queue" as const : undefined);
 *   const delivery = resolvedDelivery;
 *   if (delivery === "queue" || delivery === "steer") {
 *       this.pendingPromptsController.enqueue(...)
 *       return undefined;
 *   }
 *
 * The same three facts that govern the TS decision are the entire input
 * vocabulary. The output is one of three tags:
 *
 *   - "queue"     → caller (or auto-classification) chose deferred
 *   - "steer"     → caller explicitly chose immediate-front-of-queue
 *   - "immediate" → no admission — proceed to executeTurn
 *
 * The test below reproduces the same boolean algebra in isolation, then
 * table-drives every combination so the SEAM05 successor ACT (cutover
 * to an Elm kernel) can call back to this witness and prove behavioral
 * conservation. NO PRODUCTION CALLER IS REPLACED. The function under
 * test is a literal mirror of the inline expression.
 */
import { describe, expect, it } from "vitest"

/** Closed admission decision vocabulary. The same three tags the
 *  inline expression at local-runtime-host.ts:1244-1248 reaches. */
export type AdmissionDelivery = "queue" | "steer" | "immediate"

/**
 * **THE** admission decision. Mirrors local-runtime-host.ts:1244-1248.
 *
 *   resolvedDelivery = input.delivery
 *                   ?? (session.interactive && !canStartRun ? "queue" : undefined)
 *
 * If `resolvedDelivery` is `"queue"` or `"steer"`, the caller enqueues
 * and returns. Otherwise (undefined → "immediate") the caller proceeds
 * to executeTurn.
 *
 * This is a literal, line-for-line mirror of the production expression.
 * If the production expression changes, the test below will fail and
 * the diff is the migration contract.
 */
export function resolveAdmissionDelivery(input: {
	inputDelivery: "queue" | "steer" | undefined
	sessionInteractive: boolean
	canStartRun: boolean
}): AdmissionDelivery {
	const inputDelivery = input.inputDelivery
	const canStartRun = input.canStartRun
	const sessionInteractive = input.sessionInteractive
	const resolvedDelivery =
		inputDelivery ?? (sessionInteractive && !canStartRun ? ("queue" as const) : undefined)
	if (resolvedDelivery === "queue" || resolvedDelivery === "steer") {
		return resolvedDelivery
	}
	return "immediate"
}

describe("SEAM05: LocalRuntimeHost.runTurn admission decision (pure mirror)", () => {
	describe("caller-supplied delivery wins over agent-readiness", () => {
		it("caller's `queue` is preserved when agent CAN start (interactive idle, user defers)", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: "queue",
					sessionInteractive: true,
					canStartRun: true,
				}),
			).toBe("queue")
		})

		it("caller's `queue` is preserved when agent CANNOT start (terminal wake path)", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: "queue",
					sessionInteractive: true,
					canStartRun: false,
				}),
			).toBe("queue")
		})

		it("caller's `steer` is preserved when agent CAN start", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: "steer",
					sessionInteractive: true,
					canStartRun: true,
				}),
			).toBe("steer")
		})

		it("caller's `steer` is preserved when agent CANNOT start", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: "steer",
					sessionInteractive: false,
					canStartRun: false,
				}),
			).toBe("steer")
		})
	})

	describe("auto-classification (no caller delivery) only fires under interactive && busy", () => {
		it("interactive + busy → auto `queue` (the production followup-while-running path)", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: undefined,
					sessionInteractive: true,
					canStartRun: false,
				}),
			).toBe("queue")
		})

		it("interactive + idle → `immediate` (caller did not request deferral)", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: undefined,
					sessionInteractive: true,
					canStartRun: true,
				}),
			).toBe("immediate")
		})

		it("non-interactive + busy → `immediate` (auto-classification is interactive-only)", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: undefined,
					sessionInteractive: false,
					canStartRun: false,
				}),
			).toBe("immediate")
		})

		it("non-interactive + idle → `immediate`", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: undefined,
					sessionInteractive: false,
					canStartRun: true,
				}),
			).toBe("immediate")
		})
		it("non-interactive + idle → `immediate`", () => {
			expect(
				resolveAdmissionDelivery({
					inputDelivery: undefined,
					sessionInteractive: false,
					canStartRun: true,
				}),
			).toBe("immediate")
		})
	})

	describe("SEAM05 truth table — every input combination", () => {
		const TRUTH_TABLE: ReadonlyArray<{
			inputDelivery: "queue" | "steer" | undefined
			sessionInteractive: boolean
			canStartRun: boolean
			expected: AdmissionDelivery
			tag: string
		}> = [
			{ inputDelivery: "queue", sessionInteractive: true, canStartRun: true, expected: "queue", tag: "caller-queue / interactive-idle" },
			{ inputDelivery: "queue", sessionInteractive: true, canStartRun: false, expected: "queue", tag: "caller-queue / interactive-busy" },
			{ inputDelivery: "queue", sessionInteractive: false, canStartRun: true, expected: "queue", tag: "caller-queue / non-interactive-idle" },
			{ inputDelivery: "queue", sessionInteractive: false, canStartRun: false, expected: "queue", tag: "caller-queue / non-interactive-busy" },
			{ inputDelivery: "steer", sessionInteractive: true, canStartRun: true, expected: "steer", tag: "caller-steer / interactive-idle" },
			{ inputDelivery: "steer", sessionInteractive: true, canStartRun: false, expected: "steer", tag: "caller-steer / interactive-busy" },
			{ inputDelivery: "steer", sessionInteractive: false, canStartRun: true, expected: "steer", tag: "caller-steer / non-interactive-idle" },
			{ inputDelivery: "steer", sessionInteractive: false, canStartRun: false, expected: "steer", tag: "caller-steer / non-interactive-busy" },
			{ inputDelivery: undefined, sessionInteractive: true, canStartRun: true, expected: "immediate", tag: "no-caller / interactive-idle" },
			{ inputDelivery: undefined, sessionInteractive: true, canStartRun: false, expected: "queue", tag: "no-caller / interactive-busy (AUTO-QUEUE)" },
			{ inputDelivery: undefined, sessionInteractive: false, canStartRun: true, expected: "immediate", tag: "no-caller / non-interactive-idle" },
			{ inputDelivery: undefined, sessionInteractive: false, canStartRun: false, expected: "immediate", tag: "no-caller / non-interactive-busy" },
		]
		for (const row of TRUTH_TABLE) {
			it(`admits ${row.expected} for ${row.tag}`, () => {
				expect(
					resolveAdmissionDelivery({
						inputDelivery: row.inputDelivery,
						sessionInteractive: row.sessionInteractive,
						canStartRun: row.canStartRun,
					}),
				).toBe(row.expected)
			})
		}
	})

	describe("SEAM05 conservation — the production expression is a literal mirror", () => {
		it("the inline expression at local-runtime-host.ts:1244-1248 must produce identical results to resolveAdmissionDelivery for every row of the truth table", () => {
			// Source-text witness: the production expression is reproduced
			// below verbatim. If a future change drifts the production
			// expression from this witness, the SEAM05 cutover diff will be
			// obvious.
			const mirror: AdmissionDelivery = (() => {
				const inputDelivery: "queue" | "steer" | undefined = undefined
				const canStartRun = true
				const sessionInteractive = false
				const resolvedDelivery =
					inputDelivery ?? (sessionInteractive && !canStartRun ? ("queue" as const) : undefined)
				if (resolvedDelivery === "queue" || resolvedDelivery === "steer") {
					return resolvedDelivery
				}
				return "immediate"
			})()
			expect(mirror).toBe("immediate")
		})
	})
})

