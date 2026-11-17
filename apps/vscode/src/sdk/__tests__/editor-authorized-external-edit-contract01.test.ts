/**
 * ACT-CLINEMM-EDITOR-REALPATH-TEST-CONTRACT-CORRECTION01
 *
 * HOST-SIDE COVERAGE for the two contract points that the pre-existing
 * host suites did NOT pin, so that the SDK-side test-contract correction
 * does not leave a hole:
 *
 *   GAP 1 — "nonexistent outside descendant" classification.
 *           The existing classifier suite
 *           (`editor-path-authority.r1-classifier.test.ts`) covers
 *           absolute-outside, symlink-realpath-outside and unavailable, but
 *           it does NOT pin the THIRD geometry the SDK-side suite exercises:
 *           a target that does not exist yet, whose nearest EXISTING ancestor
 *           is OUTSIDE the workspace root. This is the classification that
 *           makes the SDK executor's case-E ("nonexistent outside tree")
 *           an *authorized* external edit rather than an escape.
 *
 *   GAP 2 — "explicit user approval permitting an outside write".
 *           `editor-effective-destination-approval.r0-green.test.ts` R0
 *           drives the REAL coordinator and asserts that resolving the ASK as
 *           `yesButtonClicked` yields `{ approved: true }` — but it never
 *           asserts the FILESYSTEM EFFECT. The load-bearing product semantic
 *           is "APPROVAL != REFUSAL": once the user approves an outside edit,
 *           the executor DOES write outside. That semantic is what makes the
 *           SDK-side C/D/E rows an authorized-external-edit contract instead
 *           of a workspace-only restriction, so it deserves its own
 *           executable assertion.
 *
 * LAYER BOUNDARY:
 *
 *   CLASSIFIER + COORDINATOR = REAL production sources
 *       (`../editor-path-authority`, `../sdk-interaction-coordinator`,
 *        `../sdk-message-coordinator`, `../sdk-tool-policies`, `../task-proxy`)
 *   EXECUTOR                  = REAL production source. `@cline/core` is
 *       aliased to `src/test/cline-core-vitest-stub.ts` under the base
 *       vitest config, and that stub re-exports `createEditorExecutor`
 *       directly from
 *       `sdk/packages/core/src/extensions/tools/executors/editor` — i.e. the
 *       REAL executor, not a re-implementation.
 *   FILESYSTEM GEOMETRY       = DISPOSABLE `os.tmpdir()` mkdtemp roots.
 *       Every root is removed by the suite's own `afterEach`.
 *
 * NO production source is touched by this file. NO policy is added to the
 * executor. The 21 disposable triage witnesses from
 * `ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01` are NOT duplicated here
 * as permanent tests — only the two actual coverage gaps are.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { createEditorExecutor } from "@cline/core"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { classifyEditTarget } from "../editor-path-authority"
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

const AGENT_CONTEXT = {
	agentId: "agent-contract01",
	conversationId: "conv-contract01",
	iteration: 1,
} as never

/**
 * Mirror the production wiring exactly:
 *   shouldAutoApproveTool(request) = isToolAutoApproved(request.toolName, effective)
 *   getCwd()                        = the workspace root snapshot
 *   getAutoApprovalSettings()       = the live editFiles + editFilesExternally toggles
 *
 * `workspaceRoot` is injected so the suite can drive the REAL coordinator
 * against a DISPOSABLE temp root instead of the repository.
 */
function makeCoordinator(opts: { sessionId: string; editFiles: boolean; editFilesExternally: boolean; workspaceRoot: string }) {
	const task = createTaskProxy(opts.sessionId, vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })
	const postStateToWebview = vi.fn().mockResolvedValue(undefined)
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
		getCwd: () => opts.workspaceRoot,
		getAutoApprovalSettings: () => ({
			editFiles: !!persistedSettings.actions.editFiles,
			editFilesExternally: !!persistedSettings.actions.editFilesExternally,
		}),
	})
	return { coordinator, task, persistedSettings, workspaceRoot: opts.workspaceRoot }
}

describe("ACT-CLINEMM-EDITOR-REALPATH-TEST-CONTRACT-CORRECTION01 — host coverage for the authorized-external-edit contract", () => {
	let workspaceRoot: string
	let outsideRoot: string
	let outsideVictim: string
	const disposableRoots: string[] = []

	beforeEach(() => {
		// The workspace root is a DISPOSABLE temp root (not the repo), so
		// the OUTSIDE root is unambiguously outside it and the suite can
		// never touch a real repository file.
		workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), "contract01-ws-")))
		outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), "contract01-outside-")))
		disposableRoots.push(workspaceRoot, outsideRoot)
		outsideVictim = join(outsideRoot, "victim.txt")
		writeFileSync(outsideVictim, "outside-original\n", "utf8")
	})

	afterEach(() => {
		for (const root of disposableRoots.splice(0)) {
			try {
				rmSync(root, { recursive: true, force: true })
			} catch {
				// ignore: best-effort cleanup
			}
		}
	})

	// ---------------------------------------------------------------------
	// GAP 1 — nonexistent outside descendant classification
	// ---------------------------------------------------------------------
	it("GAP1: a NONEXISTENT descendant whose nearest existing ancestor is OUTSIDE classifies as OUTSIDE", async () => {
		// The target does not exist yet, and neither does its parent chain
		// below the outside root. The nearest EXISTING ancestor is
		// `outsideRoot` itself, which is OUTSIDE the workspace root.
		const target = join(outsideRoot, "deep", "sub", "new-file.txt")
		expect(existsSync(target)).toBe(false)
		expect(existsSync(join(outsideRoot, "deep"))).toBe(false)

		const result = await classifyEditTarget(target, workspaceRoot)
		expect(result).toBe("outside")
	})

	it("GAP1 conservation: a NONEXISTENT descendant whose nearest existing ancestor is INSIDE still classifies as INSIDE", async () => {
		// The mirror case must be conserved: ordinary in-workspace file
		// creation is NOT reclassified as an external edit.
		const target = join(workspaceRoot, "src", "new-file.txt")
		expect(existsSync(target)).toBe(false)

		const result = await classifyEditTarget(target, workspaceRoot)
		expect(result).toBe("inside")
	})

	// ---------------------------------------------------------------------
	// GAP 2 — explicit user approval permitting an outside write
	// ---------------------------------------------------------------------
	it("GAP2: external authorization OFF => ASK, and NO outside write occurs", async () => {
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-contract01-ask",
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})

		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-contract01-ask",
			conversationId: "c-contract01-ask",
			iteration: 1,
			toolCallId: "tc-contract01-ask",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside-original",
				new_text: "outside-must-not-change-yet",
			},
			policy: { autoApprove: false },
		})

		// ASK: the approval card is published and the gate BLOCKS.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1), {
			timeout: 1000,
		})

		// The executor is NOT invoked while the approval is pending, so
		// the outside file is untouched.
		expect(readFileSync(outsideVictim, "utf8")).toBe("outside-original\n")

		// The user explicitly APPROVES the outside edit.
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: true })
	})

	it("GAP2: external authorization OFF + explicit user approval => the outside write IS performed", async () => {
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-contract01-approved",
			editFiles: true,
			editFilesExternally: false,
			workspaceRoot,
		})

		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-contract01-approved",
			conversationId: "c-contract01-approved",
			iteration: 1,
			toolCallId: "tc-contract01-approved",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside-original",
				new_text: "outside-approved-and-written",
			},
			policy: { autoApprove: false },
		})

		// The ASK card must be published before the approval can be resolved.
		await vi.waitFor(() => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1), {
			timeout: 1000,
		})
		expect(coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)
		await expect(promise).resolves.toMatchObject({ approved: true })

		// APPROVAL != REFUSAL: with the approval granted, the REAL executor
		// performs the outside write. This is the load-bearing semantic
		// that makes the SDK-side C/D/E rows an AUTHORIZED-external-edit
		// contract rather than a workspace-only restriction.
		const editor = createEditorExecutor()
		await editor(
			{
				path: outsideVictim,
				old_text: "outside-original",
				new_text: "outside-approved-and-written",
			},
			workspaceRoot,
			AGENT_CONTEXT,
		)

		// Actual destination and contents: the OUTSIDE file was written.
		// (The executor normalizes new-file line endings to the file's own
		// EOL — the source file uses LF — so the written content carries the
		// trailing LF.)
		expect(readFileSync(outsideVictim, "utf8")).toBe("outside-approved-and-written\n")
		// The effective destination really is outside the workspace root.
		expect(realpathSync(outsideVictim).startsWith(workspaceRoot + sep)).toBe(false)
	})

	it("GAP2: external authorization ON => ALLOW with no approval card, and the outside write IS performed", async () => {
		const { coordinator, task } = makeCoordinator({
			sessionId: "s-contract01-external",
			editFiles: true,
			editFilesExternally: true,
			workspaceRoot,
		})

		const promise = coordinator.handleRequestToolApproval({
			agentId: "agent-contract01-external",
			conversationId: "c-contract01-external",
			iteration: 1,
			toolCallId: "tc-contract01-external",
			toolName: "editor",
			input: {
				path: outsideVictim,
				old_text: "outside-original",
				new_text: "outside-external-authorized",
			},
			policy: { autoApprove: false },
		})

		// ALLOW: no approval card is published.
		await expect(promise).resolves.toMatchObject({ approved: true })
		expect(task.messageStateHandler.getClineMessages()).toHaveLength(0)

		const editor = createEditorExecutor()
		await editor(
			{
				path: outsideVictim,
				old_text: "outside-original",
				new_text: "outside-external-authorized",
			},
			workspaceRoot,
			AGENT_CONTEXT,
		)

		expect(readFileSync(outsideVictim, "utf8")).toBe("outside-external-authorized\n")
		expect(realpathSync(outsideVictim).startsWith(workspaceRoot + sep)).toBe(false)
	})
})
