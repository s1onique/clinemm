/**
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
 *
 * R0 PRODUCTION-SEAM REGRESSION (Phase 2 GREEN — the post-repair
 * regression that proves the bounded repair fixed the load-bearing
 * silent-ALLOW defect). Runs through the REAL production coordinator
 * + REAL `shouldAutoApproveTool` wired to REAL `isToolAutoApproved`,
 * with `getCwd` + `getAutoApprovalSettings` snapshot options wired
 * exactly as the production `SdkController` does.
 *
 * HISTORY:
 *   Commit 1aaa65a84 (Phase 1 RED): this file was named
 *     editor-effective-destination-approval.r0-red.test.ts and
 *     reproduced the silent ALLOW on OUTSIDE+editFiles=true.
 *     Observed:
 *       x R0: expected ASK, currently silently ALLOW (RED_REPRODUCED).
 *       v R0b: INSIDE+editFiles=true => ALLOW (positive control).
 *       v R0c: OUTSIDE+editFiles=false => ASK (base-disabled control).
 *   Commit <this commit> (Phase 2 GREEN): the test was renamed
 *     editor-effective-destination-approval.r0-green.test.ts and
 *     the wiring was extended with the new getCwd +
 *     getAutoApprovalSettings snapshot options that drive the
 *     classifier → pure-policy → coordinator composition.
 *
 * LAYER BOUNDARY:
 *
 *   PRODUCTION-SEAM LOGIC = REAL (real coordinator + real
 *                            shouldAutoApproveTool wired to real
 *                            isToolAutoApproved + real
 *                            classifier + real pure policy).
 *   FILESYSTEM GEOMETRY   = SYNTHETIC_REAL (constructed via
 *                            realpathSync + mkdtempSync +
 *                            writeFileSync — not faked).
 *   UI APPROVAL SURFACE   = TEST HARNESS (the `tool` ask card
 *                            is observed via the task's
 *                            messageStateHandler, which is the
 *                            canonical publication surface).
 *
 * CONSERVATION (R5 — only the CURRENT INCLUDED SURFACE:
 * editor + apply_patch):
 *
 *   If the user APPROVES the ASK card for an OUTSIDE target,
 *   the file MUST still be written by the executor. The test
 *   resolves the ASK as yesButtonClicked and asserts
 *   `approved: true` — the executor-side writeback is proven
 *   in R3/R4 (PHASE 3) and is out of scope here.
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
 *   getCwd()                        = the workspace root snapshot
 *   getAutoApprovalSettings()       = the live editFiles + editFilesExternally toggles
 *
 * The legacy boolean short-circuit is REPLACED for `editor` and
 * `apply_patch` tool names; every other tool keeps the existing
 * behavior. This test exclusively exercises the `editor` name.
 */
function makeCoordinator(opts: { sessionId: string; editFiles: boolean; editFilesExternally: boolean }) {
	const task = createTaskProxy(opts.sessionId, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
	const workspaceRoot = realpathSync(process.cwd())
	const persistedSettings = {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
			editFiles: opts.editFiles,
			editFilesExternally: opts.editFilesExternally,
		},
	}
	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => opts.sessionId,
		postStateToWebview,
		shouldAutoApproveTool: (request) => isToolAutoApproved(request.toolName, persistedSettings),
		// PHASE 2 wiring — drives the target-aware composition.
		getCwd: () => workspaceRoot,
		getAutoApprovalSettings: () => ({
			editFiles: !!persistedSettings.actions.editFiles,
			editFilesExternally: !!persistedSettings.actions.editFilesExternally,
		}),
	})
	return { coordinator, task, persistedSettings, workspaceRoot }
}

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R0 — production-seam GREEN regression", () => {
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
	// R0 — principal regression: OUTSIDE + editFiles=true + external=false
	//      PHASE 1 (RED): silently auto-approved (no approval card)
	//      PHASE 2 (GREEN): MUST ASK (approval card published)
	// -----------------------------------------------------------------
	it("R0: editor target OUTSIDE workspace + editFiles=true => MUST ASK", async () => {
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-r0-outside",
			editFiles: true,
			editFilesExternally: false,
		})
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
		// PHASE 2 (GREEN): an ask message is published (length grows to 1).
		// PHASE 1 (RED):   no ask message was published; the promise
		//                  resolved to { approved: true } and the
		//                  length stayed at 0. That defect is now fixed.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1), { timeout: 1000 })

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
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-r0b-inside",
			editFiles: true,
			editFilesExternally: false,
		})
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
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-r0c-base-disabled",
			editFiles: false,
			editFilesExternally: false,
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

	// -----------------------------------------------------------------
	// R0d — explicit external authority: OUTSIDE + editFiles=true + external=true => ALLOW
	//       (the case where the user has explicitly granted outside-edit authority)
	// -----------------------------------------------------------------
	it("R0d: editor target OUTSIDE workspace + editFiles=true + external=true => ALLOW (explicit external authority)", async () => {
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-r0d-external",
			editFiles: true,
			editFilesExternally: true,
		})
		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-r0d",
			conversationId: "c-r0d",
			iteration: 1,
			toolCallId: "tc-r0d",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside-victim-original",
				new_text: "outside-victim-modified-external",
			},
			policy: { autoApprove: false },
		})

		// External=true lifts the outside barrier. ALLOW: no card.
		await expect(promise).resolves.toMatchObject({ approved: true })
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)
	})
})
