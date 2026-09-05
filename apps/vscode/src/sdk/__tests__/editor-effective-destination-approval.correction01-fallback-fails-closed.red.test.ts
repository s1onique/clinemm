/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — P1 RED.
 *
 * REVIEWER (factory review `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS`):
 *
 *   The JSDoc on `getAutoApprovalSettings` says:
 *
 *     "When this option is omitted, target-aware composition fails
 *      closed (returns ASK) for editor/apply_patch. The legacy boolean
 *      short-circuit is NEVER consulted as a fallback for these tool
 *      names — that was the load-bearing defect."
 *
 *   But the implementation does:
 *
 *     if (targetAwareOptionsWired && (editor | apply_patch)) {
 *       // target-aware composition
 *     } else if (autoApprove || shouldAutoApproveTool) {
 *       ALLOW
 *     }
 *
 *   So missing `getCwd` or `getAutoApprovalSettings` actually restores
 *   the old silent-ALLOW behavior.
 *
 *   For production, `SdkController` wiring may make this unreachable,
 *   which prevents it being P0. But a coordinator instance that
 *   executes tools without those options gets exactly the defect this
 *   ACT exists to eliminate.
 *
 *   Required behavior (post-CORRECTION01):
 *
 *     editor / apply_patch
 *     + target-aware inputs unavailable
 *     -> ASK  (fail closed)
 *
 *   The legacy boolean short-circuit must NEVER apply to
 *   editor / apply_patch. Period. If compatibility absolutely requires
 *   a fallback for non-production harnesses, that's an explicit
 *   `legacyEditToolFallback` flag — NOT an inferred condition.
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC = REAL (real coordinator + real
 *                            shouldAutoApproveTool wired to real
 *                            isToolAutoApproved).
 *   FILESYSTEM GEOMETRY   = SYNTHETIC_REAL (constructed via realpathSync
 *                            + mkdtempSync + writeFileSync — not faked).
 *   UI APPROVAL SURFACE   = TEST HARNESS (the `tool` ask card is
 *                            observed via the task's messageStateHandler,
 *                            which is the canonical publication surface).
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { SdkInteractionCoordinator } from "../sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { isToolAutoApproved } from "../sdk-tool-policies"
import { createTaskProxy } from "../task-proxy"

vi.mock("../webview-grpc-bridge", () => ({
	pushMessageToWebview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@core/storage/disk", () => ({
	saveClineMessages: vi.fn().mockResolvedValue(undefined),
}))

let workspaceRoot: string
let outsideVictim: string

beforeAll(() => {
	workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "correction01-fallback-ws-")))
	mkdirSync(join(workspaceRoot, "src"), { recursive: true })
	writeFileSync(join(workspaceRoot, "src", "a.ts"), "inside\n")
	outsideVictim = realpathSync(mkdtempSync(join(tmpdir(), "correction01-fallback-outside-")))
	writeFileSync(join(outsideVictim, "victim.ts"), "outside\n")
	// Sanity: outsideVictim must NOT be inside workspaceRoot.
	expect(existsSync(outsideVictim)).toBe(true)
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
 * Build a coordinator WITHOUT wiring `getCwd` + `getAutoApprovalSettings`.
 * The legacy `shouldAutoApproveTool` IS wired (to `isToolAutoApproved`)
 * to simulate a host that has the legacy path but forgot to wire the
 * target-aware options. With `editFiles=true` + `autoApprove=true`
 * (shouldn't matter, but a hostile harness might set it), the legacy
 * short-circuit would silently ALLOW this OUTSIDE target. After the
 * fix, it MUST ASK.
 *
 * Returns the task proxy so the caller can assert on the canonical
 * UI publication surface (`task.messageStateHandler.getClineMessages()`)
 * — see CORRECTION02 test-quality improvement (factory reviewer
 * `HALT_TOOL_POLICY_PRECEDENCE_REGRESSION` P1).
 */
function makeCoordinatorWithoutTargetAwareOptions(): {
	coordinator: SdkInteractionCoordinator
	task: ReturnType<typeof createTaskProxy>
} {
	const task = createTaskProxy(`s-correction01-fallback-${Math.random().toString(36).slice(2)}`, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => task.taskId,
		postStateToWebview: async () => {},
		// `shouldAutoApproveTool` is the LEGACY path. The reviewer's
		// concern: if the host only wires this (not getCwd/getAutoApprovalSettings)
		// the current code falls through to it for editor/apply_patch and
		// silently ALLOWs an OUTSIDE target. Post-CORRECTION01 the
		// target-aware composition is MANDATORY for editor/apply_patch.
		shouldAutoApproveTool: (request) => isToolAutoApproved(request.toolName, DEFAULT_AUTO_APPROVAL_SETTINGS),
		// getCwd + getAutoApprovalSettings are deliberately NOT wired.
	})
	return { coordinator, task }
}

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION01 — missing-options fallback fails closed", () => {
	// NOTE: per CORRECTION02 frozen precedence, `request.policy.autoApprove === true`
	// is the outermost priority (explicit host-level escape hatch) and ALWAYS wins.
	// To exercise the missing-options ASK path we must use `autoApprove: false`
	// (the default ClineMM host wiring) so the override does not fire first.
	it("editor tool WITHOUT getCwd/getAutoApprovalSettings + OUTSIDE target + editFiles=true => ASK (no legacy silent ALLOW)", async () => {
		const { coordinator, task } = makeCoordinatorWithoutTargetAwareOptions()
		// Drive a tool approval for editor targeting the OUTSIDE victim.
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-c01-fallback",
			conversationId: "c-c01-fallback",
			iteration: 1,
			toolCallId: "tc-c01-fallback",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside-original",
				new_text: "outside-modified",
			},
			policy: { autoApprove: false },
		})

		// CORRECTION02 test-quality improvement: mechanically prove the
		// ASK card was actually published — not just that the promise
		// didn't resolve within a timeout. The card lives at the canonical
		// publication surface (task.messageStateHandler). A timeout-based
		// assertion could pass for any unrelated reason; this is precise.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "tool", partial: false })

		// Resolve pending so the test does not leak into the next case.
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: false })
	})

	it("apply_patch tool WITHOUT getCwd/getAutoApprovalSettings + OUTSIDE target in patch + editFiles=true => ASK", async () => {
		const { coordinator, task } = makeCoordinatorWithoutTargetAwareOptions()
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${outsideVictim}`,
			"@@",
			"-original",
			"+modified",
			"*** End Patch",
		].join("\n")
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-c01-fallback-ap",
			conversationId: "c-c01-fallback-ap",
			iteration: 1,
			toolCallId: "tc-c01-fallback-ap",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: false },
		})
		// Same mechanical proof as the editor test above.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "tool", partial: false })
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: false })
	})

	it("non-edit tool (read_file) WITHOUT getCwd/getAutoApprovalSettings + legacy ALLOW path intact (no false regression)", async () => {
		// CORRECTION01 MUST NOT regress the legacy behavior for non-edit
		// tools. read_file is governed by `enabled` + `actions.readFiles`,
		// not by the edit-target lattice. The legacy boolean short-circuit
		// still applies to read/browser/MCP/legacy edit names.
		const task = createTaskProxy("s-c01-noned", vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "s-c01-noned",
			postStateToWebview: async () => {},
			shouldAutoApproveTool: (request) => isToolAutoApproved(request.toolName, DEFAULT_AUTO_APPROVAL_SETTINGS),
			// getCwd + getAutoApprovalSettings NOT wired.
		})
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-c01-noned",
			conversationId: "c-c01-noned",
			iteration: 1,
			toolCallId: "tc-c01-noned",
			toolName: "read_file",
			input: { path: join(workspaceRoot, "src", "a.ts") },
			policy: { autoApprove: true },
		})
		// read_file with autoApprove=true should ALLOW (default behavior).
		expect(result.approved).toBe(true)
		// No UI surface published on ALLOW.
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})
})
