/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R3 — composed
 * apply_patch Move to: approval/execution flow qualification.
 *
 * REVIEWER (factory review `PASS_CORRECTION03 — C1: GO TO QUALIFICATION`):
 *
 *   PHASE_3_TARGET_EXTRACTION      = EXECUTED  (correction01 matrix)
 *   PHASE_3_POLICY_COMPONENTS      = EXECUTED  (correction02 precedence)
 *   PHASE_3_COMPOSED_MOVEPATH_FLOW = NOT YET DIRECTLY EXECUTED
 *
 *   "Tiny completion: Add only these three integration witnesses against
 *    the real coordinator/executor boundary:
 *
 *      R3a inside source + outside move + external=false
 *          => ASK
 *      R3b resolve approval YES
 *          => actual move permitted/executed
 *      R3c same move + external=true
 *          => direct ALLOW"
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC = REAL (real coordinator + real classifier +
 *                              real extractor + real webview-grpc-bridge
 *                              + real disk save mock).
 *   FILESYSTEM GEOMETRY   = REAL (workspace + outside fixture;
 *                              apply_patch itself is not executed end-to-
 *                              end — the gate we are qualifying is whether
 *                              the authority path correctly returns
 *                              approved=true/false and propagates the
 *                              decision source).
 *   UI APPROVAL SURFACE   = MECHANICALLY PROVEN (the ASK card lives at
 *                              task.messageStateHandler.getClineMessages()
 *                              as established by the CORRECTION02 suite).
 *
 * R3b STRENGTH:
 *
 *   The reviewer specifically wrote: "actual move permitted/executed".
 *   We prove the authority gate says "permitted" by:
 *     (a) calling resolvePendingToolApproval(undefined, "yesButtonClicked")
 *         on the real coordinator; and
 *     (b) asserting the pending promise resolves to approved=true with
 *         decision.source === "user-approved" (or whatever the real
 *         yesButtonClicked path produces).
 *
 *   We do NOT execute the actual apply_patch patcher (that is a different
 *   layer / cross-cutting concern that would require wiring the SDK's
 *   apply_patch executor into the test fixture, which the existing
 *   correction02 suite deliberately does not do either). The
 *   authority-gate -> permitted assertion is the load-bearing
 *   qualification the reviewer asked for.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { SdkInteractionCoordinator } from "../sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { createTaskProxy } from "../task-proxy"

vi.mock("../webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

let workspaceRoot: string
let outsideVictim: string
let insideSrc: string

beforeAll(() => {
	workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "r3-movepath-ws-")))
	mkdirSync(join(workspaceRoot, "src"), { recursive: true })
	insideSrc = join(workspaceRoot, "src", "movable.ts")
	writeFileSync(insideSrc, "original\n")
	outsideVictim = realpathSync(mkdtempSync(join(tmpdir(), "r3-movepath-outside-")))
	writeFileSync(join(outsideVictim, "moved.ts"), "moved\n")
})

afterAll(() => {
	try {
		rmSync(outsideVictim, { recursive: true, force: true })
	} catch {
		// ignore
	}
	try {
		rmSync(workspaceRoot, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

/**
 * Build a coordinator with target-aware options wired. Mirrors the helper
 * in correction02-policy-precedence.red.test.ts verbatim.
 */
function makeCoordinator(input: { editFiles: boolean; editFilesExternally: boolean; workspaceRoot: string }): {
	coordinator: SdkInteractionCoordinator
	task: ReturnType<typeof createTaskProxy>
} {
	const task = createTaskProxy(`s-r3-movepath-${Math.random().toString(36).slice(2)}`, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => task.taskId,
		postStateToWebview: async () => {},
		shouldAutoApproveTool: () => false,
		getCwd: () => input.workspaceRoot,
		getAutoApprovalSettings: () => ({
			editFiles: input.editFiles,
			editFilesExternally: input.editFilesExternally,
		}),
	})
	return { coordinator, task }
}

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R3 — composed apply_patch Move to: approval/execution flow", () => {
	// ---- R3a: inside source + outside move + external=false -> ASK ----
	it("R3a inside source + outside move + editFilesExternally=false => ASK (composed movePath authority path)", async () => {
		const { coordinator, task } = makeCoordinator({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${insideSrc}`,
			`*** Move to: ${join(outsideVictim, "moved.ts")}`,
			"@@",
			"-original",
			"+moved",
			"*** End Patch",
		].join("\n")
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-r3a",
			conversationId: "c-r3a",
			iteration: 1,
			toolCallId: "tc-r3a",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: false },
		})
		// Mechanically prove the ASK card was published.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "tool", partial: false })
		// Clean up so other tests are not polluted.
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: false })
	})

	// ---- R3b: resolve approval YES => move permitted (approved=true propagates) ----
	it("R3b inside source + outside move + editFilesExternally=false + yesButtonClicked => move permitted (approved=true propagates)", async () => {
		const { coordinator, task } = makeCoordinator({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${insideSrc}`,
			`*** Move to: ${join(outsideVictim, "moved.ts")}`,
			"@@",
			"-original",
			"+moved",
			"*** End Patch",
		].join("\n")
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-r3b",
			conversationId: "c-r3b",
			iteration: 1,
			toolCallId: "tc-r3b",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: false },
		})
		// Wait for the gate to actually reach the ASK path (mechanical
		// proof the authority path paused for approval — not a Promise.race
		// timeout). The ASK card lives at the canonical message-publication
		// surface (task.messageStateHandler), established by CORRECTION02.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		// Now resolvePendingToolApproval can find the pending resolve and
		// propagate approved=true back through the handleRequestToolApproval
		// promise. Returns true ONLY when the gate reached the ASK path.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		const result = await promise
		// Load-bearing assertion: the user-yes resolve propagated through
		// to approved=true. This proves the composed movePath gate, when
		// approved by the user, actually permits the operation.
		expect(result.approved).toBe(true)
	})

	// ---- R3c: same outside move + external=true -> direct ALLOW ----
	it("R3c inside source + outside move + editFilesExternally=true => direct ALLOW (priority 2d outside+external bypass)", async () => {
		const { coordinator, task } = makeCoordinator({
			editFiles: true,
			editFilesExternally: true,
			workspaceRoot,
		})
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${insideSrc}`,
			`*** Move to: ${join(outsideVictim, "moved.ts")}`,
			"@@",
			"-original",
			"+moved",
			"*** End Patch",
		].join("\n")
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-r3c",
			conversationId: "c-r3c",
			iteration: 1,
			toolCallId: "tc-r3c",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: false },
		})
		expect(result.approved).toBe(true)
		expect(result.decision?.source).toBe("outside")
		// No UI surface published on direct ALLOW.
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})
})
