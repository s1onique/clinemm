/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01 / -CORR01 — the ROUTE PIN.
 *
 * ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01 moved the canonical turn-start
 * prelude into ONE shared method, `performCanonicalTurnStart`, which BOTH
 * the ordinary UI route and the MCP supervision route call. The two
 * routes differ ONLY in the response type they forward.
 *
 * THE PINNED PROPERTIES (unchanged by the correction, but now enforced
 * on a STRONGER implementation):
 *
 *   1. The MCP feedback route reaches the follow-up coordinator through
 *      the canonical prelude - NOT through `SdkController.askResponse()`,
 *      which forwards the PERSISTED `taskState.askResponse`.
 *   2. The MCP feedback route forwards NO response type. The prelude
 *      takes the response type as an EXPLICIT parameter, so the MCP
 *      route cannot accidentally inherit the persisted value.
 *   3. The UI route DOES forward the persisted response type - it is
 *      the approval authority. This is what makes the two routes
 *      genuinely different rather than accidentally identical.
 *   4. The cancellation route calls the EXISTING `cancelTask()`
 *      lifecycle, not an independent abort path.
 *
 * This is a SOURCE-CONTRACT witness: the property under test IS a
 * property of the source text (which method the controller calls, and
 * with what response type). The BEHAVIOUR of the route is pinned
 * separately by AF-1..AF-5 in
 * `control-seam.supervision-approval-fence.production-shape.test.ts`,
 * which drive the REAL `SdkInteractionCoordinator` and the REAL
 * `TaskProxy`.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const CONTROLLER_SOURCE = readFileSync(join(__dirname, "..", "SdkController.ts"), "utf8")

/** The body of a top-level method, from its signature to the next one. */
function methodBody(signature: string): string {
	const start = CONTROLLER_SOURCE.indexOf(signature)
	expect(start, `method not found: ${signature}`).toBeGreaterThan(-1)
	const end = CONTROLLER_SOURCE.indexOf("\n\tprivate ", start + 1)
	const next = CONTROLLER_SOURCE.indexOf("\n\tasync ", start + 1)
	const candidates = [end, next].filter((value) => value > start)
	expect(candidates.length).toBeGreaterThan(0)
	return CONTROLLER_SOURCE.slice(start, Math.min(...candidates))
}

/**
 * The CODE of a method body, with every comment removed.
 *
 * The route pins assert on CODE, not on prose. Several of the methods
 * explain the hazard they avoid IN A COMMENT (naming
 * `taskState.askResponse`), and a naive substring check over the raw
 * source would flag that explanation as if it were a live read.
 */
function methodCode(signature: string): string {
	return stripComments(methodBody(signature))
}

/**
 * Remove line comments and block comments from a source fragment.
 *
 * This is deliberately a small, conservative stripper: it removes a
 * double-slash line comment to the end of the line, and a slash-star
 * block comment up to its closing slash-star, and leaves string
 * literals alone except for the simple case of a double-slash inside a
 * double-quoted string on the same line, which does not occur in the
 * fragments under test.
 */
function stripComments(source: string): string {
	let result = ""
	let index = 0
	while (index < source.length) {
		const char = source[index]
		const next = source[index + 1]
		if (char === "/" && next === "/") {
			while (index < source.length && source[index] !== "\n") {
				index++
			}
			continue
		}
		if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2)
			index = end === -1 ? source.length : end + 2
			// Keep a newline so line structure survives.
			result += "\n"
			continue
		}
		result += char
		index++
	}
	return result
}

/** The body of `sendSupervisionFeedback`. */
function supervisionFeedbackBody(): string {
	return methodBody("private async sendSupervisionFeedback(")
}

/** The body of the shared canonical prelude. */
function canonicalPreludeBody(): string {
	return methodBody("private async performCanonicalTurnStart(")
}

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01 — the MCP feedback route pin", () => {
	it("RP-1: the MCP feedback route goes through the CANONICAL prelude, not `SdkController.askResponse()`", () => {
		const body = methodCode("private async sendSupervisionFeedback(")
		// The SAFE route is present.
		expect(body).toContain("this.performCanonicalTurnStart(")
		// The UNSAFE route is ABSENT. `this.askResponse(` would forward
		// the persisted `taskState.askResponse` into the coordinator.
		expect(body).not.toContain("this.askResponse(")
		// And it must NOT call the follow-up coordinator directly any
		// more - that would skip the canonical prelude entirely (the
		// lifecycle omission this correction closes).
		expect(body).not.toContain("this.followups.askResponse(")
	})

	it("RP-2: the MCP feedback route forwards NO response type to the prelude", () => {
		const body = methodCode("private async sendSupervisionFeedback(")
		const call = body.slice(body.indexOf("this.performCanonicalTurnStart("))
		const argumentsText = call.slice(0, call.indexOf(")"))
		// The response type is EXPLICITLY `undefined`.
		expect(argumentsText).toContain("responseType: undefined")
		// The route must never name an approving response type.
		expect(argumentsText).not.toContain("yesButtonClicked")
		expect(argumentsText).not.toContain("noButtonClicked")
		expect(argumentsText).not.toContain("messageResponse")
		// It must not read the persisted response type.
		expect(body).not.toContain("taskState?.askResponse")
		expect(body).not.toContain("taskState.askResponse")
	})

	it("RP-3: the CANONICAL prelude performs the whole lifecycle sequence - the same one the UI route performs", () => {
		const body = methodCode("private async performCanonicalTurnStart(")
		// 1. emit `same_task_continued` (the only accepted exit from
		//    `resumable` in the shadow's lifecycle).
		expect(body).toContain("emitSameTaskContinued(")
		// 2. fence the PREVIOUS canonical run (so a late terminal event
		//    from the retired run cannot poison the resumed task).
		expect(body).toContain("fenceCanonicalRunForContinuation()")
		// 3. set the turn phase to `streaming`.
		expect(body).toContain('setWithWriter("streaming"')
		// 4. clear the previous turn's completion signal.
		expect(body).toContain("clearTurnOutcome()")
		// 5. publish the updated state to the webview.
		expect(body).toContain("postStateToWebview()")
		// 6. hand the text to the follow-up coordinator.
		expect(body).toContain("this.followups.askResponse(")
	})

	it("RP-4: the UI route STILL forwards the persisted response type - it is the approval authority", () => {
		const body = methodCode("\tasync askResponse(")
		expect(body).toContain("this.performCanonicalTurnStart(")
		expect(body).toContain("responseType: this.task?.taskState?.askResponse")
		// The UI route must NOT have been weakened: it is the approval
		// authority, so it still answers the interaction.
		expect(body).toContain("this.task?.taskState?.askResponse")
	})

	it("RP-5: the response type is TYPED, so no route can smuggle an arbitrary string into the approval resolver", () => {
		const body = methodCode("private async performCanonicalTurnStart(")
		expect(body).toContain("readonly responseType?: ClineAskResponse")
	})

	it("RP-6: the MCP cancellation route calls the EXISTING `cancelTask()` lifecycle, not an independent abort path", () => {
		const body = methodCode("private async cancelSupervisionRun(")
		// The EXISTING lifecycle is the route.
		expect(body).toContain("this.cancelTask()")
		// NO independent abort path and NO PID kill.
		expect(body).not.toContain("sdkHost.abort(")
		expect(body).not.toContain("process.kill")
		expect(body).not.toContain("SIGKILL")
		expect(body).not.toContain("SIGTERM")
	})
})
