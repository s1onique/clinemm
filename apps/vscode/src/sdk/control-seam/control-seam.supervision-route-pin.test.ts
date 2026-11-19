/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01 — the ROUTE PIN.
 *
 * The MCP feedback route in `SdkController.sendSupervisionFeedback` MUST
 * call the follow-up coordinator DIRECTLY, with NO response type.
 *
 * It MUST NOT call `SdkController.askResponse()`, because that method
 * forwards `this.task?.taskState?.askResponse` — the value the UI's
 * "Approve" click PERSISTS on the task proxy — into the follow-up
 * coordinator, and `resolvePendingToolApproval` APPROVES the pending tool
 * when that value is `"yesButtonClicked"`.
 *
 * This is a SOURCE-CONTRACT witness: it pins the ROUTE the production
 * controller takes, because the route is the fence. The BEHAVIOUR of the
 * route is pinned separately by AF-1..AF-5 in
 * `control-seam.supervision-approval-fence.production-shape.test.ts`.
 *
 * Reading the production source is legitimate here: the property under
 * test IS a property of the source text (which method the controller
 * calls), and the alternative — driving the whole controller through its
 * gRPC surface — would not observe the route at all.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const CONTROLLER_SOURCE = readFileSync(join(__dirname, "..", "SdkController.ts"), "utf8")

/** The body of `sendSupervisionFeedback`. */
function supervisionFeedbackBody(): string {
	const start = CONTROLLER_SOURCE.indexOf("private async sendSupervisionFeedback(")
	expect(start).toBeGreaterThan(-1)
	const end = CONTROLLER_SOURCE.indexOf("\n\tprivate ", start + 1)
	expect(end).toBeGreaterThan(start)
	return CONTROLLER_SOURCE.slice(start, end)
}

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 — the MCP feedback route pin", () => {
	it("RP-1: the MCP feedback route calls the follow-up coordinator DIRECTLY, not `SdkController.askResponse()`", () => {
		const body = supervisionFeedbackBody()
		// The SAFE route is present.
		expect(body).toContain("this.followups.askResponse(")
		// The UNSAFE route is ABSENT. `this.askResponse(` would forward
		// the persisted `taskState.askResponse` into the coordinator.
		expect(body).not.toContain("this.askResponse(")
	})

	it("RP-2: the MCP feedback route supplies NO response type to the follow-up coordinator", () => {
		const body = supervisionFeedbackBody()
		const call = body.slice(body.indexOf("this.followups.askResponse("))
		const argumentsText = call.slice(0, call.indexOf(")"))
		// The 4th argument is the response type. It MUST be `undefined`.
		expect(argumentsText).toContain("undefined")
		// The route must never name an approving response type.
		expect(argumentsText).not.toContain("yesButtonClicked")
		expect(argumentsText).not.toContain("noButtonClicked")
		expect(argumentsText).not.toContain("messageResponse")
		// It must not read the persisted response type.
		expect(body).not.toContain("taskState?.askResponse")
		expect(body).not.toContain("taskState.askResponse")
	})

	it("RP-3: the MCP cancellation route calls the EXISTING `cancelTask()` lifecycle, not an independent abort path", () => {
		const start = CONTROLLER_SOURCE.indexOf("private async cancelSupervisionRun(")
		expect(start).toBeGreaterThan(-1)
		const end = CONTROLLER_SOURCE.indexOf("\n\tprivate ", start + 1)
		const body = CONTROLLER_SOURCE.slice(start, end)
		// The EXISTING lifecycle is the route.
		expect(body).toContain("this.cancelTask()")
		// NO independent abort path and NO PID kill.
		expect(body).not.toContain("sdkHost.abort(")
		expect(body).not.toContain("process.kill")
		expect(body).not.toContain("SIGKILL")
		expect(body).not.toContain("SIGTERM")
	})
})
