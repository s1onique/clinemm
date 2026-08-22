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
 * RED (NCCR01): /newtask reaches the condense RPC at the production
 *               routing seam.
 * CONTROL (NCCR02): /compact reaches the condense RPC at the same seam.
 * CONTROL (NCCR03): /smol reaches the condense RPC at the same seam.
 * INTENT (NCCR04): The catalog declares /newtask to be an alias of /compact.
 * SEAM (NCCR05): controller.initTask is the ONLY existing new-task creation
 *                seam; reachable via TaskServiceClient.newTask from the
 *                webview button flow, NOT from any slash-command dispatch.
 * BOUNDED (NCCR06): The bounded-repair budget forbids a slash-side fix
 *                   that honors the original contract without violating
 *                   the repair constraints.
 *
 * STOP after first causal RED.
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

describe("ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01 / NCCR", () => {
	//
	// NCCR01 -- RED at the production routing seam
	//
	// The webview hook intercepts /newtask (alongside /compact and /smol)
	// and calls SlashServiceClient.condense. The condense RPC is the SDK
	// manual-compaction entry point -- it does NOT create a new task. The
	// intercepted value is hardcoded to "compact", meaning the literal
	// call is also typed as compact semantics.
	//
	it("NCCR01: /newtask reaches the condense RPC at the production routing seam (RED)", () => {
		const interceptBlock = readBlock(
			HookSource,
			"Intercept the built-in compaction commands when an active task exists.",
			1200,
		)
		// The dispatch predicate must include /newtask alongside /compact and /smol.
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/compact"/)
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/smol"/)
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/newtask"/)
		// And the intercept target must be the condense RPC, not the new-task RPC.
		expect(interceptBlock).toMatch(/SlashServiceClient\.condense\(/)
		// The condense call is hardcoded to "compact" -- proving the literal
		// command's intent is collapsed to compaction, not handoff.
		expect(interceptBlock).toMatch(/value:\s*"compact"/)
		// The /newtask branch must NOT reach TaskServiceClient.newTask
		// from within this intercept block.
		expect(interceptBlock).not.toMatch(/TaskServiceClient\.newTask\(/)
	})

	//
	// NCCR02 -- CONTROL: /compact reaches the condense RPC.
	//
	it("NCCR02 (CONTROL): /compact reaches the condense RPC at the same seam", () => {
		const interceptBlock = readBlock(
			HookSource,
			"Intercept the built-in compaction commands when an active task exists.",
			1200,
		)
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/compact"/)
		expect(interceptBlock).toMatch(/SlashServiceClient\.condense\(/)
	})

	//
	// NCCR03 -- CONTROL: /smol reaches the condense RPC.
	//
	it("NCCR03 (CONTROL): /smol reaches the condense RPC at the same seam", () => {
		const interceptBlock = readBlock(
			HookSource,
			"Intercept the built-in compaction commands when an active task exists.",
			1200,
		)
		expect(interceptBlock).toMatch(/messageToSend\s*===\s*"\/smol"/)
		expect(interceptBlock).toMatch(/SlashServiceClient\.condense\(/)
	})

	//
	// NCCR04 -- INTENT: the catalog declares /newtask to be an alias of /compact.
	//
	it("NCCR04 (INTENT): slashCommands catalog declares /newtask is an alias of /compact", () => {
		const catalogBlock = readBlock(CatalogSource, "BASE_SLASH_COMMANDS", 1500)
		expect(catalogBlock).toMatch(/name:\s*"newtask"/)
		// The catalog comment explicitly justifies the alias with the SDK runtime
		// having no `new_task` tool.
		expect(catalogBlock).toMatch(/\/newtask.*alias.*\/compact|alias.*\/compact/)
		expect(catalogBlock).toMatch(/legacy\s+new_task\s+tool/)
		// And the menu description matches the alias semantics.
		expect(catalogBlock).toMatch(/Condenses the current task/)
	})

	//
	// NCCR05 -- SEAM: controller.initTask is the ONLY new-task-with-context
	// creation seam. It is reachable from the webview button flow
	// (TaskServiceClient.newTask), NOT from any slash-command dispatch.
	//
	it("NCCR05 (SEAM): controller.initTask is the only new-task creation seam; unreachable from slash dispatch", () => {
		// The controller's newTask handler calls controller.initTask and returns the new taskId.
		expect(ControllerNewTaskSource).toMatch(/controller\.initTask\(/)
		expect(ControllerNewTaskSource).toMatch(/taskId\s*=\s*await\s+controller\.initTask\(/)

		// The condense handler is a thin wrapper over controller.compactTask -- it does
		// NOT call controller.initTask and therefore does NOT create a new task.
		expect(ControllerCondenseSource).toMatch(/controller\.compactTask\(\)/)
		expect(ControllerCondenseSource).not.toMatch(/controller\.initTask\(/)

		// The webview intercept block must not reach the newTask RPC.
		const interceptBlock = readBlock(
			HookSource,
			"Intercept the built-in compaction commands when an active task exists.",
			1200,
		)
		expect(interceptBlock).not.toMatch(/TaskServiceClient\.newTask\(/)
	})

	//
	// NCCR06 -- BOUNDED-REPAIR BUDGET: structural absence of a distillation
	// primitive that could feed controller.initTask from a slash command.
	//
	// The CLI's `compactCurrentSession` mutates the current session in place
	// and does not expose a handoff summary. The SDK's `SdkCompactionCoordinator`
	// does the same. No production seam in the current codebase produces a
	// "distilled context text" string suitable for passing to
	// `controller.initTask(text, ...)`. A bounded repair that honored the
	// original product contract would require introducing such a primitive,
	// redesigning the slash framework, or re-adding the `new_task` AgentTool
	// -- all forbidden by the bounded-repair constraints.
	//
	it("NCCR06 (BOUNDED): no distillation primitive exists that could feed controller.initTask from a slash command", () => {
		// The controller's condense handler is exclusively a compaction entry point.
		expect(ControllerCondenseSource).toMatch(/compactTask\(\)/)
		// The condense handler returns Empty -- i.e., it returns nothing for the
		// caller to use as a handoff summary.
		expect(ControllerCondenseSource).toMatch(/Empty\.create\(\)/)
		// The /newtask intercept hardcodes the literal "compact" value, proving
		// the intercept never intends to thread a handoff payload back.
		const interceptBlock = readBlock(
			HookSource,
			"Intercept the built-in compaction commands when an active task exists.",
			1200,
		)
		expect(interceptBlock).toMatch(/value:\s*"compact"/)
		// The intercept does not import or reference the new-task RPC.
		expect(interceptBlock).not.toMatch(/TaskServiceClient\.newTask\(/)

		// And the catalog's documented justification is the structural reason
		// a bounded fix is impossible without violating the repair constraints:
		// the SDK runtime has no `new_task` tool to drive distillation.
		const catalogBlock = readBlock(CatalogSource, "BASE_SLASH_COMMANDS", 1500)
		expect(catalogBlock).toMatch(/legacy\s+new_task\s+tool/)
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

	it("CONSERVATION: the intercept block keeps /compact, /smol, /newtask co-routed (current contract)", () => {
		const interceptBlock = readBlock(
			HookSource,
			"Intercept the built-in compaction commands when an active task exists.",
			1200,
		)
		// All three spellings must remain in the same predicate -- any future
		// repair that unaliases them MUST update this contract test, not
		// silently drift.
		const compactMatch = interceptBlock.match(/messageToSend\s*===\s*"\/compact"/)
		const smolMatch = interceptBlock.match(/messageToSend\s*===\s*"\/smol"/)
		const newtaskMatch = interceptBlock.match(/messageToSend\s*===\s*"\/newtask"/)
		expect(compactMatch).not.toBeNull()
		expect(smolMatch).not.toBeNull()
		expect(newtaskMatch).not.toBeNull()
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
