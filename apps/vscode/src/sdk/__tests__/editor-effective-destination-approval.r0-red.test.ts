/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
 *
 * R0 PRODUCTION-SEAM PRINCIPAL RED (Phase 1 RED — the canonical
 * Factory RED-before-repair ordering required by the reviewer's
 * HALT_RED_BEFORE_IMPLEMENTATION verdict).
 *
 * OBSERVED FAILURE (today, on production):
 *
 *   The `editor` tool auto-approves based ONLY on
 *   `settings.actions.editFiles === true`. The effective target
 *   (input.path) is never classified as inside or outside the
 *   workspace, so an editor request targeting a file OUTSIDE the
 *   workspace (e.g. /tmp/outside-victim.txt) is silently approved
 *   when the user has the "Edit files" auto-approval toggle on.
 *
 *   The required behavior (per upstream issue #13114 — the
 *   external-edit rule):
 *
 *     editFiles=true  + outside + external=false  → ASK
 *     editFiles=true  + inside                    → ALLOW
 *     editFiles=false + inside OR outside         → ASK
 *
 *   This file reproduces the silent-ALLOW bug THROUGH THE REAL
 *   coordinator + real `shouldAutoApproveTool` callback wired to
 *   real `isToolAutoApproved`. The only thing constructed is the
 *   filesystem geometry (an outside-area victim file whose
 *   `realpathSync` is provably outside the workspace root) so the
 *   eventual classifier has a deterministic target.
 *
 * STOP RULE (per the reviewer's HALT_RED_BEFORE_IMPLEMENTATION):
 *
 *   R0 silently auto-approved (no approval card published) AND
 *     the path is provably outside the workspace
 *     → RED_REPRODUCED. The silent auto-approval bug is the
 *       load-bearing production defect. Halt and proceed to
 *       Phase 2 (bounded repair: classifier + pure policy +
 *       coordinator wiring + apply_patch conservation).
 *
 *   R0 cannot reach the real coordinator seam through the
 *     constructed filesystem geometry
 *     → HALT_RED_NOT_REPRODUCED. Capture why the seam was
 *       unreachable and do NOT fake the seam by replacing
 *       shouldAutoApproveTool with a hand-rolled closure that
 *       embeds the new classification logic.
 *
 * DISPOSITION (this run):
 *
 *   R0 (OUTSIDE + editFiles=true + external=false)
 *     = silent ALLOW (current code path) vs ASK (required)
 *     = RED_REPRODUCED → principal defect confirmed.
 *
 *   R0b (INSIDE + editFiles=true)        = ALLOW (positive control)
 *   R0c (OUTSIDE + editFiles=false)      = ASK (base-disabled control)
 *
 *   Conservation invariant (R5 — only the
 *   CURRENT INCLUDED SURFACE: editor + apply_patch):
 *
 *     If the user APPROVES the ASK card for an OUTSIDE target,
 *     the file MUST still be written by the executor. That is
 *     the load-bearing "approved-outside STILL WRITES"
 *     conservation — proven by R3/R4 in later phases, not in
 *     this RED.
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

/**
 * Mirror the production wiring exactly:
 *   shouldAutoApproveTool(request) = isToolAutoApproved(request.toolName, effective)
 *
 * This is the load-bearing seam that decides authority for the
 * non-command tool path (sdk-interaction-coordinator.ts:521). The
 * RED must drive THIS callback, not a hand-rolled substitute,
 * otherwise the reproduction is not on the production seam.
 */
function makeCoordinator(opts: { sessionId: string }) {
	const task = createTaskProxy(opts.sessionId, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const persistedSettings = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			// editFiles=true: edit tool is enabled for the user. The
			// production defect is that this single flag governs
			// every editor request, regardless of whether the
			// effective target is inside or outside the workspace.
			editFiles: true,
		},
	}
	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => opts.sessionId,
		postStateToWebview,
		shouldAutoApproveTool: (request) => isToolAutoApproved(request.toolName, persistedSettings),
	})
	return { coordinator, task, persistedSettings }
}

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R0 — production-seam principal RED", () => {
	let workspaceRoot: string
	let outsideDir: string
	let outsideVictim: string
	let insideVictim: string

	beforeAll(() => {
		// Workspace root = the repo's realpath. Any path whose
		// realpathSync does NOT start with this prefix is OUTSIDE.
		workspaceRoot = realpathSync(process.cwd())

		// Create the inside victim INSIDE the workspace (so it
		// always satisfies the inside-prefix check, regardless of
		// /tmp being a symlink on macOS).
		insideVictim = join(workspaceRoot, ".factory/tmp/r0-red-inside-victim.txt")
		mkdirSync(join(workspaceRoot, ".factory/tmp"), { recursive: true })
		writeFileSync(insideVictim, "inside-victim-original\n", "utf8")

		// Create the outside victim in /tmp and resolve its real
		// path. We verify the resolved path is OUTSIDE the
		// workspace so the test asserts the actual production
		// defect, not a coincidental same-prefix collision.
		outsideDir = mkdtempSync(join(tmpdir(), "r0-red-outside-"))
		outsideVictim = join(outsideDir, "outside-victim.txt")
		writeFileSync(outsideVictim, "outside-victim-original\n", "utf8")

		// Sanity: confirm geometry is what we think it is. If
		// either check fails, the test cannot reach the seam.
		const resolvedOutside = realpathSync(outsideVictim)
		expect(resolvedOutside.startsWith(workspaceRoot + "/")).toBe(false)
		expect(resolvedOutside.startsWith(workspaceRoot)).toBe(false)
		expect(existsSync(insideVictim)).toBe(true)
		expect(existsSync(outsideVictim)).toBe(true)
	})

	afterAll(() => {
		try {
			if (existsSync(outsideDir)) {
				rmSync(outsideDir, { recursive: true, force: true })
			}
			if (existsSync(insideVictim)) {
				rmSync(insideVictim, { force: true })
			}
		} catch {
			// ignore: best-effort cleanup
		}
	})

	// -----------------------------------------------------------------
	// R0 — principal RED: OUTSIDE + editFiles=true + external=false
	//      CURRENT (BUG): silently auto-approved (no approval card)
	//      REQUIRED:    ASK (approval card published, await user choice)
	// -----------------------------------------------------------------
	it("R0: editor target OUTSIDE workspace + editFiles=true => MUST ASK (currently silently ALLOW)", async () => {
		const { coordinator, task } = makeCoordinator({ sessionId: "s-r0-outside" })
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-r0-outside",
			conversationId: "c-r0-outside",
			iteration: 1,
			toolCallId: "tc-r0-outside",
			toolName: "editor",
			input: {
				path: outsideVictim, // provably OUTSIDE the workspace
				old_text: "outside-victim-original",
				new_text: "outside-victim-MODIFIED-WITHOUT-APPROVAL",
			},
			policy: { autoApprove: false },
		})

		// The ASK path emits a tool approval ask message into the
		// task message stream. The ALLOW path returns immediately
		// without emitting any message.
		//
		// REQUIRED: an ask message is published (length grows to 1).
		// CURRENT (BUG): no ask message is published; the promise
		//   resolves to { approved: true } and the length stays at 0.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1), { timeout: 500 })

		// The card was published; resolve it as the user approving
		// the outside write so we can also observe the resolved
		// promise shape (R5 conservation asserts the executor
		// STILL WRITES after this YES — proven in R3/R4 phases).
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: true })
	})

	// -----------------------------------------------------------------
	// R0b — positive control: INSIDE + editFiles=true => ALLOW
	// -----------------------------------------------------------------
	it("R0b: editor target INSIDE workspace + editFiles=true => ALLOW (positive control)", async () => {
		const { coordinator, task } = makeCoordinator({ sessionId: "s-r0b-inside" })
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-r0b-inside",
			conversationId: "c-r0b-inside",
			iteration: 1,
			toolCallId: "tc-r0b-inside",
			toolName: "editor",
			input: {
				path: insideVictim, // provably INSIDE the workspace
				old_text: "inside-victim-original",
				new_text: "inside-victim-modified",
			},
			policy: { autoApprove: false },
		})

		// ALLOW path: no approval card; promise resolves immediately.
		await expect(promise).resolves.toMatchObject({ approved: true })
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})

	// -----------------------------------------------------------------
	// R0c — base-disabled control: OUTSIDE + editFiles=false => ASK
	// -----------------------------------------------------------------
	it("R0c: editor target OUTSIDE workspace + editFiles=false => ASK (base-disabled control)", async () => {
		const sessionId = "s-r0c-base-disabled"
		const task = createTaskProxy(sessionId, vi.fn(), vi.fn())
		const messages = new SdkMessageCoordinator({ getTask: () => task })
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const persistedSettings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				editFiles: false,
			},
		}
		const coordinator = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => sessionId,
			postStateToWebview,
			shouldAutoApproveTool: (request) => isToolAutoApproved(request.toolName, persistedSettings),
		})

		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-r0c",
			conversationId: "c-r0c",
			iteration: 1,
			toolCallId: "tc-r0c",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside-victim-original",
				new_text: "outside-victim-modified-base-disabled",
			},
			policy: { autoApprove: false },
		})

		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1), { timeout: 500 })
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: true })
	})
})
