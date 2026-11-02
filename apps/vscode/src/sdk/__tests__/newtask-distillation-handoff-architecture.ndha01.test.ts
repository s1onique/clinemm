/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01 / NDHA
 *
 * Restores the documented `/newtask` product contract:
 *
 *   /newtask   = fresh task + distilled context from current conversation
 *   /compact   = summarize current task + same task identity
 *   /smol      = same-task compaction alias
 *
 * The frozen prior evidence (NCCR01) proved /newtask collapsed into the
 * condense RPC. This ACT is the bounded production repair: a NEW gRPC
 * method `handoffWithContext(EmptyRequest) -> String` on TaskService
 * (reuses the existing new-task creation seam `controller.initTask`)
 * creates a fresh task identity whose initial prompt is a host-generated
 * handoff summary of the active session's transcript.
 *
 * RED (NDHA01): /newtask produces a new task identity whose initial prompt
 *                carries structured handoff markers (goal/completedWork/
 *                relevantFiles/nextSteps/keyDecisions), and the active
 *                session's compaction sidecar is NOT mutated as the
 *                terminal effect.
 * CONTROL (NDHA02): /compact leaves taskId unchanged and persists the
 *                   compaction sidecar on the active session.
 * CONTROL (NDHA03): /smol behaves identically to /compact.
 * HANDOFF  (NDHA04): the handoff payload carries the structural markers.
 * IDENTITY (NDHA05): the new taskId differs from the active taskId.
 * NO-MUTATION (NDHA06): /newtask does not persist a compaction sidecar
 *                        on the active session (current-task identity
 *                        remains as historical record).
 *
 * The summary generator is a pluggable provider: tests inject a
 * deterministic provider; production uses the SDK compaction machinery.
 *
 * ABLATION (NDHA-ABLATION): commenting out the /newtask branch in
 * useMessageHandlers.ts must revert NDHA01/NDHA05/NDHA06 to RED.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = path.resolve(process.cwd(), "..", "..")
const HOOK_PATH = path.join(REPO_ROOT, "apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts")
const SLASH_CATALOG_PATH = path.join(REPO_ROOT, "apps/vscode/src/shared/slashCommands.ts")
const CONTROLLER_NEWTASK_PATH = path.join(REPO_ROOT, "apps/vscode/src/core/controller/task/newTask.ts")
const CONTROLLER_HANDOFF_PATH = path.join(REPO_ROOT, "apps/vscode/src/core/controller/task/handoffWithContext.ts")
const HANDOFF_SUMMARY_PATH = path.join(REPO_ROOT, "apps/vscode/src/sdk/handoff-summary.ts")
const TASK_PROTO_PATH = path.join(REPO_ROOT, "apps/vscode/proto/cline/task.proto")
const PROTOBUS_SERVICES_PATH = path.join(REPO_ROOT, "apps/vscode/src/generated/hosts/vscode/protobus-services.ts")
const PROTOBUS_TYPES_PATH = path.join(REPO_ROOT, "apps/vscode/src/generated/hosts/vscode/protobus-service-types.ts")
const SDK_CONTROLLER_PATH = path.join(REPO_ROOT, "apps/vscode/src/sdk/SdkController.ts")
const TASK_START_COORDINATOR_PATH = path.join(REPO_ROOT, "apps/vscode/src/sdk/sdk-task-start-coordinator.ts")

const HookSource = fs.readFileSync(HOOK_PATH, "utf8")
const CatalogSource = fs.readFileSync(SLASH_CATALOG_PATH, "utf8")
const ControllerNewTaskSource = fs.readFileSync(CONTROLLER_NEWTASK_PATH, "utf8")
const ControllerHandoffSource = safeRead(CONTROLLER_HANDOFF_PATH)
const HandoffSummarySource = safeRead(HANDOFF_SUMMARY_PATH)
const TaskProtoSource = fs.readFileSync(TASK_PROTO_PATH, "utf8")
const ProtobusServicesSource = fs.readFileSync(PROTOBUS_SERVICES_PATH, "utf8")
const ProtobusTypesSource = fs.readFileSync(PROTOBUS_TYPES_PATH, "utf8")
const SdkControllerSource = fs.readFileSync(SDK_CONTROLLER_PATH, "utf8")
const TaskStartCoordinatorSource = fs.readFileSync(TASK_START_COORDINATOR_PATH, "utf8")

function safeRead(p: string): string {
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
}
describe("ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01 / NDHA", () => {
	//
	// NDHA01 -- PRIMARY RED at the production slash-routing seam.
	//
	// /newtask must (a) reach a NEW handoff-with-context handler, NOT the
	// condense RPC, AND (b) that handler must create a fresh task identity
	// via the existing controller.initTask seam.
	//
	it("NDHA01: /newtask routes to handoffWithContext and creates a new task identity (RED)", () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands", 4000)

		// /newtask must remain in the dispatch predicate (intercept window).
		const dispatchHasNewtask = interceptBlock.match(/messageToSend\s*===\s*"\/newtask"/)
		expect(dispatchHasNewtask).not.toBeNull()

		// The dispatch branch for /newtask must reach TaskServiceClient.handoffWithContext
		// (or equivalent), NOT SlashServiceClient.condense.
		expect(interceptBlock).toMatch(/TaskServiceClient\.handoffWithContext\s*\(/)
		expect(interceptBlock).toMatch(/EmptyRequest\.create\s*\(\s*\{\s*\}\s*\)/)

		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: upstream refactored the inline
		// `SlashServiceClient.condense(...)` call into a `compactTask()`
		// helper and replaced the literal `/compact` + `/smol` header with
		// the `isCompactionCommand(...)` predicate. The probes below
		// asserted the literal call site inside the dispatch window, which
		// the refactor legitimately moved.
		//
		// The contract is "the compact/smol dispatch still reaches the
		// condense RPC, hardcoding value:'compact'", so assert the same
		// contract against the new structure: the dispatch branch calls the
		// helper, and the helper owns the condense RPC with the hardcoded
		// value.
		expect(interceptBlock).toMatch(/compactTask\s*\(\s*\)/)
		expect(HookSource).toMatch(/const compactTask\s*=\s*useCallback[\s\S]*?SlashServiceClient\.condense\s*\(/)
		// The intercept's condense call MUST still hardcode value:"compact".
		const condenseCallLine = HookSource.match(/SlashServiceClient\.condense\([\s\S]{0,200}value:\s*"compact"/)
		expect(condenseCallLine).not.toBeNull()

		// The handoff handler must create a fresh task identity via
		// controller.initTask. Use a regex that targets an actual statement,
		// not a code comment that mentions the API name.
		expect(ControllerHandoffSource).not.toBe("")
		expect(ControllerHandoffSource).toMatch(/taskId\s*=\s*await\s+controller\.initTask\s*\(/)
		expect(ControllerHandoffSource).toMatch(/String\.create\s*\(\s*\{\s*value:\s*taskId/)
	})

	function readBlock(source: string, startMarker: string, maxChars = 4000): string {
		const start = source.indexOf(startMarker)
		if (start < 0) {
			return ""
		}
		return source.slice(start, start + maxChars)
	}

	/**
	 * Strips block and line comments so a source probe can assert about
	 * CODE rather than about prose that happens to mention a literal.
	 * ACT-CLINEMM-FORK-UPSTREAM-MERGE01: upstream's refactor left a
	 * comment in the dispatch block naming the old
	 * `messageToSend === "/compact" || messageToSend === "/smol"` header,
	 * which made a code-level probe false-positive on it.
	 */
	function stripComments(source: string): string {
		return source
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.split("\n")
			.map((line) => line.replace(/\/\/.*$/, ""))
			.join("\n")
	}
	//
	// NDHA02 -- CONTROL: /compact still routes to condense RPC at the same seam.
	//
	it("NDHA02 (CONTROL): /compact still routes to the condense RPC", () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands", 4000)
		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the literal
		// `messageToSend === "/compact"` header was superseded by upstream's
		// `isCompactionCommand(...)` predicate; the inline condense call was
		// superseded by the `compactTask()` helper. Assert the same
		// contract against the new structure.
		expect(interceptBlock).toMatch(/isCompactionCommand\s*\(\s*messageToSend\s*\)/)
		expect(HookSource).toMatch(/function isCompactionCommand[\s\S]*?text\s*===\s*"\/compact"/)
		expect(interceptBlock).toMatch(/compactTask\s*\(\s*\)/)
		expect(HookSource).toMatch(/const compactTask\s*=\s*useCallback[\s\S]*?SlashServiceClient\.condense\s*\(/)
		// /compact MUST NOT be co-dispatched with the new handoff RPC. The
		// /newtask branch IS allowed to reference handoffWithContext (that is
		// the new repair). What is forbidden is /compact dispatching to it.
		// Pin by reading the post-/-newtask-block code: the /compact branch
		// must NOT exist after the /newtask dispatch.
		const newtaskBlockEnd = interceptBlock.indexOf("TaskServiceClient.handoffWithContext")
		const compactionDispatchPos = interceptBlock.indexOf("isCompactionCommand(messageToSend)")
		expect(newtaskBlockEnd).toBeGreaterThan(-1)
		expect(compactionDispatchPos).toBeGreaterThan(-1)
		// The compaction dispatch appears AFTER the /newtask dispatch in the
		// file, proving they are sibling branches (not /compact reaching
		// handoff).
		expect(compactionDispatchPos).toBeGreaterThan(newtaskBlockEnd)
	})

	//
	// NDHA03 -- CONTROL: /smol still routes to condense RPC at the same seam.
	//
	it("NDHA03 (CONTROL): /smol still routes to the condense RPC", () => {
		const interceptBlock = readBlock(HookSource, "Intercept the built-in slash commands", 4000)
		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the literal `/smol` header was
		// superseded by upstream's `isCompactionCommand(...)` predicate; the
		// inline condense call was superseded by the `compactTask()` helper.
		expect(interceptBlock).toMatch(/isCompactionCommand\s*\(\s*messageToSend\s*\)/)
		expect(HookSource).toMatch(/function isCompactionCommand[\s\S]*?text\s*===\s*"\/smol"/)
		expect(interceptBlock).toMatch(/compactTask\s*\(\s*\)/)
		expect(HookSource).toMatch(/const compactTask\s*=\s*useCallback[\s\S]*?SlashServiceClient\.condense\s*\(/)
		// /smol is co-dispatched with /compact (same predicate). /smol MUST NOT
		// be co-dispatched with /newtask. Pin by checking the /smol literal
		// is in the SAME predicate as /compact, NOT /newtask.
		//
		// The predicate is now the shared authority: `isCompactionCommand`
		// recognises /compact and /smol (and /newtask), while the /newtask
		// DISPATCH is a separate, earlier branch that routes to
		// `handoffWithContext`. So the invariant is: /smol appears in the
		// predicate, and the /newtask branch body does not reference /smol.
		const smolMatch = HookSource.match(/function isCompactionCommand[\s\S]*?text\s*===\s*"\/smol"/)
		expect(smolMatch).not.toBeNull()
		// The predicate must include /smol alongside /compact.
		expect(HookSource).toMatch(
			/function isCompactionCommand[\s\S]*?text\s*===\s*"\/compact"[\s\S]{0,120}text\s*===\s*"\/smol"|function isCompactionCommand[\s\S]*?text\s*===\s*"\/smol"[\s\S]{0,120}text\s*===\s*"\/compact"/,
		)
		// The /smol literal must NOT appear in the /newtask branch (i.e. between
		// the /newtask predicate and the closing brace of its branch). Take the
		// region from the /newtask predicate up to the next sibling dispatch.
		//
		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: the sibling dispatch is now the
		// `isCompactionCommand(messageToSend)` predicate, and the block
		// between the two branches carries a COMMENT that mentions
		// `messageToSend === "/compact" || messageToSend === "/smol"`. The
		// invariant is about CODE, not about comments, so strip comments
		// before slicing.
		const newtaskPredicatePos = interceptBlock.indexOf('messageToSend === "/newtask"')
		expect(newtaskPredicatePos).toBeGreaterThan(-1)
		const nextDispatchPos = interceptBlock.indexOf("isCompactionCommand(messageToSend)", newtaskPredicatePos)
		expect(nextDispatchPos).toBeGreaterThan(newtaskPredicatePos)
		const newtaskBranch = stripComments(interceptBlock.slice(newtaskPredicatePos, nextDispatchPos))
		// /smol MUST NOT be referenced inside the /newtask branch.
		expect(newtaskBranch).not.toMatch(/"\/smol"/)
	})
	//
	// NDHA04 -- HANDOFF QUALITY: the handoff payload carries the structural
	// categories (goal/completedWork/relevantFiles/nextSteps/keyDecisions).
	//
	it("NDHA04 (HANDOFF): the handoff summary helper emits all five required structural categories", () => {
		expect(HandoffSummarySource).not.toBe("")
		// Helper must export a function that produces a structured string.
		expect(HandoffSummarySource).toMatch(/export\s+(?:async\s+)?function\s+generateHandoffSummary\b/)
		// Helper must carry all five structural markers in its emission.
		expect(HandoffSummarySource).toMatch(/goal:/)
		expect(HandoffSummarySource).toMatch(/completedWork:/)
		expect(HandoffSummarySource).toMatch(/relevantFiles:/)
		expect(HandoffSummarySource).toMatch(/nextSteps:/)
		expect(HandoffSummarySource).toMatch(/keyDecisions:/)
		// The helper must accept a pluggable summary provider (test seam).
		expect(HandoffSummarySource).toMatch(/provider\??:\s*HandoffSummaryProvider/)
		expect(HandoffSummarySource).toMatch(/export\s+interface\s+HandoffSummaryProvider\b/)
	})

	//
	// NDHA05 -- IDENTITY: the host handler creates a NEW taskId that differs
	// from the active sessionId, by calling controller.initTask (the sole
	// seam that allocates a fresh sessionId via SdkTaskStartCoordinator).
	//
	it("NDHA05 (IDENTITY): handoff handler creates a fresh task identity via controller.initTask", () => {
		expect(ControllerHandoffSource).toMatch(/taskId\s*=\s*await\s+controller\.initTask\s*\(/)
		// The sole sessionId allocator is SdkTaskStartCoordinator.initTask,
		// called by SdkController.initTask. We verify the seam is wired.
		expect(TaskStartCoordinatorSource).toMatch(
			/taskSessionId\s*=\s*config\.sessionId\?\.trim\s*\(\)\s*\|\|\s*createSessionId\s*\(\)/,
		)
		expect(SdkControllerSource).toMatch(/this\.taskStart\.initTask\s*\(/)
	})

	//
	// NDHA06 -- NO MUTATION: /newtask must NOT persist a compaction sidecar
	// on the active session (current task remains as historical record).
	//
	it("NDHA06 (NO-MUTATION): handoff handler does not call controller.compactTask or persist a sidecar on the active session", () => {
		// Strip comments from the source before checking negative matches,
		// so comments that mention prohibited API names don't false-match.
		const codeOnly = ControllerHandoffSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
		expect(codeOnly).not.toMatch(/controller\.compactTask\s*\(/)
		expect(codeOnly).not.toMatch(/updateSessionCompactionState\s*\(/)
		// The handler must NOT call the SdkCompactionCoordinator (which
		// mutates the active session's compaction sidecar).
		expect(codeOnly).not.toMatch(/this\.compaction\.compactTask\s*\(/)
	})

	//
	// NDHA07 -- PROTOCOL: the new RPC method exists on TaskService, the
	// handler binding is registered, and the generated types include the
	// new method. This pins the protocol delta.
	//
	it("NDHA07 (PROTOCOL): TaskService.handoffWithContext(EmptyRequest) -> String is wired through proto, types, and handler binding", () => {
		// proto file declares the new method on TaskService.
		expect(TaskProtoSource).toMatch(/rpc\s+handoffWithContext\s*\(\s*EmptyRequest\s*\)\s+returns\s+\(\s*String\s*\)/)
		// generated types include the handler signature.
		expect(ProtobusTypesSource).toMatch(
			/handoffWithContext\s*:\s*\(controller:\s*Controller,\s*request:\s*proto\.cline\.EmptyRequest\)\s*=>\s*Promise<proto\.cline\.String>/,
		)
		// generated services register the new handler.
		expect(ProtobusServicesSource).toMatch(
			/import\s*\{\s*handoffWithContext\s*\}\s*from\s*"@core\/controller\/task\/handoffWithContext"/,
		)
		expect(ProtobusServicesSource).toMatch(/handoffWithContext:\s*handoffWithContext/)
	})

	//
	// NDHA-CONSERVATION: the existing /compact / /smol button flows, the
	// existing condense RPC contract, the slash catalog, and the
	// existing new-task-with-context button flow remain unchanged.
	//
	describe("NDHA-CONSERVATION", () => {
		it("the condense RPC handler remains a thin wrapper over controller.compactTask()", () => {
			const condensePath = path.join(REPO_ROOT, "apps/vscode/src/core/controller/slash/condense.ts")
			const condenseSource = fs.readFileSync(condensePath, "utf8")
			expect(condenseSource).toMatch(/controller\.compactTask\s*\(\s*\)/)
			expect(condenseSource).toMatch(/Empty\.create\s*\(\s*\)/)
		})

		it("the slash catalog still declares /newtask, /compact, /smol in BASE_SLASH_COMMANDS", () => {
			expect(CatalogSource).toMatch(/name:\s*"newtask"/)
			expect(CatalogSource).toMatch(/name:\s*"compact"/)
			expect(CatalogSource).toMatch(/name:\s*"smol"/)
		})

		it("the existing TaskServiceClient.newTask button flow remains reachable for the ask:new_task path", () => {
			expect(ControllerNewTaskSource).toMatch(/controller\.initTask\s*\(/)
			expect(HookSource).toMatch(/TaskServiceClient\.newTask\s*\(/)
		})

		it("the condense RPC returns Empty (no handoff return value to leak)", () => {
			const condensePath = path.join(REPO_ROOT, "apps/vscode/src/core/controller/slash/condense.ts")
			const condenseSource = fs.readFileSync(condensePath, "utf8")
			expect(condenseSource).toMatch(/Promise<Empty>/)
		})
	})
})
