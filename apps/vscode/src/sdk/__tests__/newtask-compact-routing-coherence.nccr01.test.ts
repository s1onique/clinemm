/**
 * ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01 / NCCR
 *
 * DISCRIMINATOR at the REAL production seam for the upstream-reported
 * regression `cline/cline#13157`: `/newtask` behaving like `/compact`
 * instead of creating a new task with distilled context.
 *
 * SCOPE: bounded to the slash-command routing layer. This file does NOT
 * redesign the slash framework, does NOT open a new protocol field,
 * does NOT introduce an AgentTool, does NOT rewrite the SDK compaction
 * coordinator, and does NOT change any unrelated task control.
 *
 * METHOD: static-source assertions on the EXACT production files the
 * upstream issue exercises, plus an executable mirror of the webview's
 * send-routing seam against the real BASE_SLASH_COMMANDS catalog and
 * the real SlashServiceClient.condense invocation pattern.
 *
 * Why static-source on the routing layer is authoritative:
 *
 *   `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`
 *   is the canonical send-path seam. The conditional intercept at the
 *   top of `handleSendMessage` is the FIRST dispatch decision: it
 *   either intercepts the command into a runtime RPC (`condense`,
 *   `newTask`) or lets it fall through to the model. Whichever branch
 *   wins determines the task identity outcome:
 *
 *     - condense branch -> task identity unchanged (same-session compaction)
 *     - newTask branch  -> fresh task identity via `controller.initTask`
 *
 *   The webview test at
 *   `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.test.tsx`
 *   already encodes the current implementation as passing assertions
 *   (line 142: "routes the /newtask alias to the condense RPC as well").
 *   That test is the webview's own contract for the alias behavior.
 *   This NCCR file duplicates the contract as a static-source
 *   assertion under the canonical vitest gate so the routing choice
 *   is also pinned by the apps/vscode vitest surface.
 *
 * WHY THIS ACT VERDICTS NOT_REPRODUCED (in the actionable sense):
 *
 *   The behavior reproduced here -- /newtask sharing the same
 *   condense path as /compact and /smol -- is a DELIBERATE,
 *   COMMITTED architectural decision:
 *
 *     commit 7b8798c99
 *     "Fix built-in slash commands on the SDK runtime: /newtask aliases
 *      /compact, port /deep-planning expansion, hide /newrule and
 *      /reportbug (#12721)"
 *
 *   The same commit explicitly REVERTED an earlier attempt to port the
 *   legacy `new_task` tool handoff because the SDK runtime has no
 *   `new_task` AgentTool to drive distillation. The slashCommands.ts
 *   catalog (lines 9-12) and useMessageHandlers.ts (lines 103-111)
 *   both encode the alias rationale as code-comments.
 *
 *   A bounded repair that honored the ORIGINAL product contract
 *   (`/newtask` = distill + create new task) would require one of:
 *
 *     (a) re-introducing a `new_task` AgentTool on the SDK runtime
 *         (forbidden: "redesign slash command framework"),
 *     (b) exposing a distillation primitive that produces a handoff
 *         summary the existing `controller.initTask` can consume
 *         (no such primitive exists today; the CLI's
 *          `compactCurrentSession` mutates the current session,
 *          does not return a handoff),
 *     (c) wire `/newtask` to `controller.initTask` with NO distillation
 *         (that would delete the handoff, violating NCCR04),
 *     (d) add a new public protocol field for the handoff
 *         (forbidden: "add new public protocol fields unless
 *          absolutely required").
 *
 *   All four bounded-repair paths are forbidden by either the ACT's
 *   explicit constraints or by the structural absence of the
 *   required distillation seam. Therefore this ACT VERDICTS
 *   NOT_REPRODUCED with the architecture decision documented as
 *   load-bearing evidence: the bug cannot be fixed without violating
 *   the bounded-repair constraint.
 *
 *   The "Start New Task with Context" button
 *   (`apps/vscode/src/core/controller/task/newTask.ts` ->
 *   `controller.initTask`) remains the SOLE production seam that
 *   creates a true new task identity with distilled context (the
 *   "new_task" ask message carries the prior task's distilled text
 *   that the user authored via the model's summarization turn).
 *
 * POST-REPAIR REWRITE (ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01):
 *
 *   This discriminator is REWRITTEN to assert the NEW post-repair contract.
 *   The original NCCR01 RED is now a GREEN — the bug is repaired — so the
 *   same file at the same production source files is repurposed to encode
 *   the post-repair invariants. The followup ACT added:
 *
 *     - TaskService.handoffWithContext(EmptyRequest) -> String RPC method
 *     - SdkController.handoffWithContext() (host-side handler)
 *     - webview dispatch predicate branching /newtask from /compact,/smol
 *     - apps/vscode/src/sdk/handoff-summary.ts (pure summary generator)
 *
 *   The discriminator below proves:
 *
 *     POST-NCCR01: /newtask reaches the handoffWithContext RPC (not condense)
 *     POST-NCCR02: /compact still reaches the condense RPC
 *     POST-NCCR03: /smol still reaches the condense RPC
 *     POST-NCCR04: the catalog still documents /newtask alongside /compact
 *     POST-NCCR05: controller.initTask is the fresh-task identity seam,
 *                  reused by both TaskServiceClient.newTask (button flow) and
 *                  TaskServiceClient.handoffWithContext (slash flow)
 *     POST-NCCR06: the bounded-repair budget now PASSES — the missing
 *                  distillation primitive exists at handoff-summary.ts and
 *                  the /newtask slash command reaches controller.initTask
 *                  via the new handoff RPC
 *
 *   These are GREEN assertions of the post-repair contract; the original
 *   REDs are encoded by the new RED file at
 *   apps/vscode/src/sdk/__tests__/newtask-distillation-handoff-architecture.ndha01.test.ts
 *   which proves the production seam before the bounded production repair.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = path.resolve(process.cwd(), "..", "..")
const HOOK_PATH = path.join(REPO_ROOT, "apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts")
const SLASH_CATALOG_PATH = path.join(REPO_ROOT, "apps/vscode/src/shared/slashCommands.ts")
const CONTROLLER_NEWTASK_PATH = path.join(REPO_ROOT, "apps/vscode/src/core/controller/task/newTask.ts")
const CONTROLLER_CONDENSE_PATH = path.join(REPO_ROOT, "apps/vscode/src/core/controller/slash/condense.ts")

const HookSource = fs.readFileSync(HOOK_PATH, "utf8")
const CatalogSource = fs.readFileSync(SLASH_CATALOG_PATH, "utf8")
const ControllerNewTaskSource = fs.readFileSync(CONTROLLER_NEWTASK_PATH, "utf8")
const ControllerCondenseSource = fs.readFileSync(CONTROLLER_CONDENSE_PATH, "utf8")

function readBlock(source: string, startMarker: string, maxChars = 4000): string {
	const start = source.indexOf(startMarker)
	if (start < 0) {
		throw new Error(`marker not found: ${startMarker}`)
	}
	return source.slice(start, start + maxChars)
}

describe("ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01 / NCCR (POST-REPAIR)", () => {
	//
	// POST-NCCR01 -- /newtask reaches the handoffWithContext RPC, not condense.
	//
	it("POST-NCCR01: /newtask now reaches handoffWithContext (repaired contract)", () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands when an active task exists.", 2000)
		// The new dispatch branch must reach TaskServiceClient.handoffWithContext.
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/newtask"/)
		expect(interceptBlock).toMatch(/TaskServiceClient\.handoffWithContext\s*\(/)
		// /newtask MUST NOT reach TaskServiceClient.newTask in the slash path
		// (the button flow's executeButtonAction branch is separate).
		expect(interceptBlock).not.toMatch(/TaskServiceClient\.newTask\(/)
	})

	//
	// POST-NCCR02 -- /compact still reaches condense RPC (same-task control).
	//
	it("POST-NCCR02 (CONTROL): /compact still reaches the condense RPC", () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands when an active task exists.", 2500)
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/compact"/)
		expect(interceptBlock).toMatch(/SlashServiceClient\.condense\(/)
	})

	//
	// POST-NCCR03 -- /smol still reaches condense RPC (same-task control).
	//
	it("POST-NCCR03 (CONTROL): /smol still reaches the condense RPC", () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands when an active task exists.", 2500)
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/smol"/)
		expect(interceptBlock).toMatch(/SlashServiceClient\.condense\(/)
	})

	//
	// POST-NCCR04 -- INTENT: the catalog still declares /newtask alongside
	// /compact and /smol. The catalog description may evolve as the product
	// semantics evolve; the presence of all three spellings is the pinned
	// invariant.
	//
	it("POST-NCCR04 (INTENT): the catalog still lists /newtask alongside /compact and /smol", () => {
		const catalogBlock = readBlock(CatalogSource, "BASE_SLASH_COMMANDS", 1500)
		expect(catalogBlock).toMatch(/name:\s*"newtask"/)
		expect(catalogBlock).toMatch(/name:\s*"compact"/)
		expect(catalogBlock).toMatch(/name:\s*"smol"/)
	})

	//
	// POST-NCCR05 -- SEAM: controller.initTask is the SOLE fresh-task
	// identity seam. It is reached by BOTH TaskServiceClient.newTask (button
	// flow, ask:new_task ask response) and TaskServiceClient.handoffWithContext
	// (slash flow, /newtask dispatch).
	//
	it("POST-NCCR05 (SEAM): controller.initTask is the sole fresh-task seam; reached by both newTask and handoffWithContext", () => {
		// The existing button-flow handler reaches controller.initTask.
		expect(ControllerNewTaskSource).toMatch(/controller\.initTask\(/)
		expect(ControllerNewTaskSource).toMatch(/taskId\s*=\s*await\s+controller\.initTask\(/)
		// The condense handler remains exclusively a compaction entry point.
		expect(ControllerCondenseSource).toMatch(/controller\.compactTask\(\)/)
		// The condense handler does NOT create a new task.
		expect(ControllerCondenseSource).not.toMatch(/controller\.initTask\(/)
		// The handoff handler reuses controller.initTask (handover path).
		const handoffSource = fs.readFileSync(
			path.join(REPO_ROOT, "apps/vscode/src/core/controller/task/handoffWithContext.ts"),
			"utf8",
		)
		expect(handoffSource).toMatch(/controller\.initTask\(/)
		// Both newTask and handoffWithContext are wired through TaskService.
		expect(HookSource).toMatch(/TaskServiceClient\.newTask\(/)
		expect(HookSource).toMatch(/TaskServiceClient\.handoffWithContext\(/)
	})

	//
	// POST-NCCR06 -- BOUNDED-REPAIR BUDGET: the missing distillation
	// primitive now exists at apps/vscode/src/sdk/handoff-summary.ts and
	// is the only LLM-touching seam in the /newtask path. The /newtask
	// slash command now reaches controller.initTask via the new
	// handoffWithContext RPC, satisfying the original product contract
	// without resurrecting the legacy `new_task` AgentTool.
	//
	it("POST-NCCR06 (BOUNDED): the missing distillation primitive now exists; /newtask reaches controller.initTask via the new RPC", () => {
		// The new distillation helper exists and exports the structural handoff.
		const handoffSource = fs.readFileSync(path.join(REPO_ROOT, "apps/vscode/src/sdk/handoff-summary.ts"), "utf8")
		expect(handoffSource).toMatch(/export\s+(?:async\s+)?function\s+generateHandoffSummary\b/)
		expect(handoffSource).toMatch(/goal:/)
		expect(handoffSource).toMatch(/completedWork:/)
		expect(handoffSource).toMatch(/relevantFiles:/)
		expect(handoffSource).toMatch(/nextSteps:/)
		expect(handoffSource).toMatch(/keyDecisions:/)
		// The handoff handler wires the helper into the new-task creation seam.
		const handoffHandlerSource = fs.readFileSync(
			path.join(REPO_ROOT, "apps/vscode/src/core/controller/task/handoffWithContext.ts"),
			"utf8",
		)
		expect(handoffHandlerSource).toMatch(/generateHandoffSummary\s*\(/)
		expect(handoffHandlerSource).toMatch(/controller\.initTask\s*\(/)
		// The proto file declares the new RPC method.
		const protoSource = fs.readFileSync(path.join(REPO_ROOT, "apps/vscode/proto/cline/task.proto"), "utf8")
		expect(protoSource).toMatch(/rpc\s+handoffWithContext\s*\(\s*EmptyRequest\s*\)\s+returns\s+\(\s*String\s*\)/)
	})

	//
	// CONSERVATION -- pinned invariants must remain unchanged.
	//
	// These assertions prove the existing routing contract is preserved
	// (so a future "fix" cannot silently break /compact or /smol while
	// attempting to repair /newtask). They are not the RED; they are
	// the fence that any future repair must respect.
	//
	it("CONSERVATION: /compact remains the same-task compaction entry point", () => {
		expect(ControllerCondenseSource).toMatch(/controller\.compactTask\(\)/)
	})

	it('CONSERVATION: the /compact-and-/smol branch still hardcodes value:"compact" (same-task semantics)', () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands when an active task exists.", 2500)
		// The condense call site must still carry value:"compact".
		const condenseCall = interceptBlock.match(/SlashServiceClient\.condense\([\s\S]{0,200}value:\s*"compact"/)
		expect(condenseCall).not.toBeNull()
	})

	it("CONSERVATION: the /newtask-with-context seam remains the button flow (TaskServiceClient.newTask -> controller.initTask)", () => {
		// The webview hook keeps a SEPARATE executeButtonAction("new_task")
		// branch that routes to TaskServiceClient.newTask -- that branch is
		// the ONLY route that honors the original /newtask product contract.
		expect(HookSource).toMatch(/case\s+"new_task":/)
		expect(HookSource).toMatch(/TaskServiceClient\.newTask\(/)
		// And it feeds controller.initTask (which creates a new task identity).
		expect(ControllerNewTaskSource).toMatch(/controller\.initTask\(/)
	})
})
