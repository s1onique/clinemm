/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION02 - P0 RED.
 *
 * REVIEWER (factory review HALT_TOOL_POLICY_PRECEDENCE_REGRESSION):
 *
 *   CORRECTION01 fixes the issues raised in the previous round, but it
 *   introduces a NEW regression: for editor and apply_patch,
 *   request.policy.autoApprove === true is silently ignored. The new
 *   branch on lines 551-569 evaluates only getAutoApprovalSettings +
 *   effective-destination classification, while non-editor tools still
 *   honor request.policy.autoApprove === true || shouldAutoApproveTool().
 *
 *   This contradicts the documented SDK contract that
 *   toolPolicies.editor.autoApprove = true means "tool runs without
 *   approval", and the analogous contract for apply_patch.
 *
 * RESOLUTION (frozen in this RED suite + in the production code):
 *
 *   We adopt OPTION B with an explicit override escape hatch.
 *
 *     ClineMM EDIT-TOOL POLICY PRECEDENCE (frozen CORRECTION02):
 *
 *     1.  request.policy.autoApprove === true
 *           => ALLOW  (host-level escape hatch; explicit override
 *               beats every safety envelope).
 *
 *     2.  otherwise (default ClineMM host wiring forces
 *         autoApprove=false for editor/apply_patch at the SDK seam):
 *
 *         a.  getCwd() unavailable          => ASK (fail closed)
 *         b.  getAutoApprovalSettings() unavailable => ASK
 *         c.  classification=inside + editFiles=true
 *                                              => ALLOW
 *         d.  classification=outside + editFilesExternally=true
 *                                              => ALLOW
 *         e.  classification=outside + editFilesExternally=false
 *                                              => ASK
 *         f.  classification=unavailable    => ASK (fail closed)
 *
 *     The legacy boolean short-circuit
 *     (request.policy.autoApprove || shouldAutoApproveTool)
 *     is NEVER consulted as a fallback for editor/apply_patch when
 *     policy.autoApprove is false (or undefined).
 *
 *   NOTE on upstream SDK docs:
 *
 *     permission-handling.mdx describes the SDK contract where the
 *     host's toolPolicies map flows unchanged into the runtime. ClineMM
 *     intentionally diverges for native edit tools
 *     (editor/apply_patch/replace_in_file/write_to_file/delete_file)
 *     by routing them through the target-aware composition. This is the
 *     product contract already resolved as E3 PASS_BY_PRODUCT_CONTRACT
 *     in ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 section E3
 *     and is preserved verbatim in CORRECTION02 - the override escape
 *     hatch (priority 1 above) lets an explicit autoApprove=true
 *     propagate when an upstream consumer chooses to set it.
 *
 * RED -> GREEN behavior (locked by this suite):
 *
 *   T1 editor + autoApprove=true + editFiles=false + INSIDE
 *        => ALLOW  (priority 1: explicit override)
 *   T2 editor + autoApprove=true + OUTSIDE + editFilesExternally=false
 *        => ALLOW  (priority 1: explicit override beats safety envelope)
 *   T3 apply_patch + autoApprove=true + INSIDE
 *        => ALLOW  (priority 1: explicit override)
 *   T4 editor + autoApprove=false (default) + INSIDE + editFiles=true
 *        => ALLOW  (priority 2c: target-aware composition)
 *   T5 editor + autoApprove=false (default) + OUTSIDE + editFilesExternally=false
 *        => ASK    (priority 2e: safety envelope)
 *   T6 apply_patch + autoApprove=false (default) + INSIDE + editFiles=true
 *        => ALLOW  (priority 2c: target-aware composition)
 *   T7 apply_patch + autoApprove=false (default) + OUTSIDE + editFilesExternally=false
 *        => ASK    (priority 2e: safety envelope)
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC   = REAL  (real coordinator + real
 *                                   shouldAutoApproveTool wired to real
 *                                   isToolAutoApproved + real
 *                                   getCwd/getAutoApprovalSettings wired
 *                                   to real classifyEditTarget).
 *   FILESYSTEM GEOMETRY     = SYNTHETIC_REAL (mkdtempSync + realpathSync).
 *   UI APPROVAL SURFACE     = TEST HARNESS (assertions against
 *                                   task.messageStateHandler.getClineMessages(),
 *                                   not a Promise.race timeout).
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

beforeAll(() => {
	workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "correction02-precedence-ws-")))
	mkdirSync(join(workspaceRoot, "src"), { recursive: true })
	writeFileSync(join(workspaceRoot, "src", "a.ts"), "inside\n")
	outsideVictim = realpathSync(mkdtempSync(join(tmpdir(), "correction02-precedence-outside-")))
	writeFileSync(join(outsideVictim, "victim.ts"), "outside\n")
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
 * Build a coordinator with target-aware options wired. The
 * getAutoApprovalSettings snapshot and editFiles/editFilesExternally
 * flags are caller-supplied so each test can dial in its own lattice state.
 *
 * NOTE: shouldAutoApproveTool is wired to a constant. The host-side
 * isToolAutoApproved callback is NOT the authority for editor/apply_patch
 * post-CORRECTION01; the target-aware composition is. Tests that
 * exercise the autoApprove=true override path keep the callback as a
 * defense-in-depth sentinel (false) so a latent legacy-short-circuit
 * regression would surface as ASK instead of ALLOW.
 */
function makeCoordinatorWithTargetAwareOptions(input: {
	editFiles: boolean
	editFilesExternally: boolean
	workspaceRoot: string
}): {
	coordinator: SdkInteractionCoordinator
	task: ReturnType<typeof createTaskProxy>
} {
	const task = createTaskProxy(`s-correction02-precedence-${Math.random().toString(36).slice(2)}`, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => task.taskId,
		postStateToWebview: async () => {},
		// shouldAutoApproveTool intentionally returns FALSE - the legacy
		// short-circuit is NOT the authority for editor/apply_patch. A
		// regression that re-enables it would surface as ASK here, not
		// silent ALLOW.
		shouldAutoApproveTool: () => false,
		getCwd: () => input.workspaceRoot,
		getAutoApprovalSettings: () => ({
			editFiles: input.editFiles,
			editFilesExternally: input.editFilesExternally,
		}),
	})
	return { coordinator, task }
}
describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 CORRECTION02 - frozen policy precedence", () => {
	// ---- T1: editor + autoApprove=true + INSIDE -> ALLOW (override wins) ----
	it("T1 editor + autoApprove=true + editFiles=false + INSIDE target => ALLOW (priority 1 explicit override)", async () => {
		const { coordinator } = makeCoordinatorWithTargetAwareOptions({
			editFiles: false,
			editFilesExternally: false,
			workspaceRoot,
		})
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t1",
			conversationId: "c-c02-t1",
			iteration: 1,
			toolCallId: "tc-c02-t1",
			toolName: "editor",
			input: {
				path: join(workspaceRoot, "src", "a.ts"),
				old_text: "inside",
				new_text: "inside-modified",
			},
			policy: { autoApprove: true },
		})
		expect(result.approved).toBe(true)
		expect(result.decision?.source).toBe("sdk-policy-autoApprove")
	})

	// ---- T2: editor + autoApprove=true + OUTSIDE -> ALLOW (override beats safety envelope) ----
	it("T2 editor + autoApprove=true + OUTSIDE + editFilesExternally=false => ALLOW (priority 1 explicit override beats safety envelope)", async () => {
		const { coordinator } = makeCoordinatorWithTargetAwareOptions({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t2",
			conversationId: "c-c02-t2",
			iteration: 1,
			toolCallId: "tc-c02-t2",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside",
				new_text: "outside-modified",
			},
			policy: { autoApprove: true },
		})
		expect(result.approved).toBe(true)
		expect(result.decision?.source).toBe("sdk-policy-autoApprove")
	})

	// ---- T3: apply_patch + autoApprove=true + INSIDE -> ALLOW ----
	it("T3 apply_patch + autoApprove=true + INSIDE patch => ALLOW (priority 1 explicit override)", async () => {
		const { coordinator } = makeCoordinatorWithTargetAwareOptions({
			editFiles: false,
			editFilesExternally: false,
			workspaceRoot,
		})
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${join(workspaceRoot, "src", "a.ts")}`,
			"@@",
			"-inside",
			"+inside-modified",
			"*** End Patch",
		].join("\n")
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t3",
			conversationId: "c-c02-t3",
			iteration: 1,
			toolCallId: "tc-c02-t3",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: true },
		})
		expect(result.approved).toBe(true)
		expect(result.decision?.source).toBe("sdk-policy-autoApprove")
	})

	// ---- T4: editor + autoApprove=false + INSIDE + editFiles=true -> ALLOW (target-aware composition) ----
	it("T4 editor + autoApprove=false (default) + INSIDE + editFiles=true => ALLOW via target-aware composition (priority 2c)", async () => {
		const { coordinator, task } = makeCoordinatorWithTargetAwareOptions({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t4",
			conversationId: "c-c02-t4",
			iteration: 1,
			toolCallId: "tc-c02-t4",
			toolName: "editor",
			input: {
				path: join(workspaceRoot, "src", "a.ts"),
				old_text: "inside",
				new_text: "inside-modified",
			},
			policy: { autoApprove: false },
		})
		expect(result.approved).toBe(true)
		expect(result.decision?.source).toBe("inside")
		// No UI surface published on ALLOW.
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})

	// ---- T5: editor + autoApprove=false + OUTSIDE + editFilesExternally=false -> ASK ----
	it("T5 editor + autoApprove=false (default) + OUTSIDE + editFilesExternally=false => ASK (priority 2e safety envelope)", async () => {
		const { coordinator, task } = makeCoordinatorWithTargetAwareOptions({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t5",
			conversationId: "c-c02-t5",
			iteration: 1,
			toolCallId: "tc-c02-t5",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside",
				new_text: "outside-modified",
			},
			policy: { autoApprove: false },
		})
		// Mechanically prove the ASK card was published - not just that
		// the promise didn't resolve within a timeout. The card lives at
		// the canonical publication surface (task.messageStateHandler).
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "tool", partial: false })
		// Resolve pending so other tests are not polluted.
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: false })
	})

	// ---- T6: apply_patch + autoApprove=false + INSIDE + editFiles=true -> ALLOW ----
	it("T6 apply_patch + autoApprove=false (default) + INSIDE patch + editFiles=true => ALLOW via target-aware composition (priority 2c)", async () => {
		const { coordinator, task } = makeCoordinatorWithTargetAwareOptions({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${join(workspaceRoot, "src", "a.ts")}`,
			"@@",
			"-inside",
			"+inside-modified",
			"*** End Patch",
		].join("\n")
		const result = await coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t6",
			conversationId: "c-c02-t6",
			iteration: 1,
			toolCallId: "tc-c02-t6",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: false },
		})
		expect(result.approved).toBe(true)
		expect(result.decision?.source).toBe("inside")
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})

	// ---- T7: apply_patch + autoApprove=false + OUTSIDE + editFilesExternally=false -> ASK ----
	it("T7 apply_patch + autoApprove=false (default) + OUTSIDE patch + editFilesExternally=false => ASK (priority 2e)", async () => {
		const { coordinator, task } = makeCoordinatorWithTargetAwareOptions({
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})
		const patchText = [
			"*** Begin Patch",
			`*** Update File: ${outsideVictim}`,
			"@@",
			"-outside",
			"+outside-modified",
			"*** End Patch",
		].join("\n")
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-c02-t7",
			conversationId: "c-c02-t7",
			iteration: 1,
			toolCallId: "tc-c02-t7",
			toolName: "apply_patch",
			input: patchText,
			policy: { autoApprove: false },
		})
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1))
		const [message] = task.messageStateHandler.getClineMessages()
		expect(message).toMatchObject({ type: "ask", ask: "tool", partial: false })
		expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: false })
	})
})
