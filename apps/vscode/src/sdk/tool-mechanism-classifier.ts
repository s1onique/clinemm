/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01):
 *
 * Pure, side-effect-free classifier that maps a canonical tool identity
 * (the `toolName` carried on every `content_start(tool)` runtime event)
 * to a bounded mechanism bucket.
 *
 * Epistemic contract (frozen by the upstream recon
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01):
 *
 *   mechanism  = REAL         (canonical toolName on content_start(tool))
 *   outcome    = REAL         (typed ToolRuntimeOutcome seam — out of V1)
 *   duration   = REAL         (computed upstream — out of V1)
 *   effect     = UNKNOWN      (no failureClass aggregation today)
 *   purpose    = UNAVAILABLE_FROM_TRACE
 *   retryId    = UNAVAILABLE_TODAY
 *
 * This classifier MUST NOT attempt to derive mechanism from any text
 * argument (e.g. shell command text). The identity source is the
 * registered/registered-as tool name only. The `sed -i ...` command
 * text is therefore *always* a `command` mechanism, never an `edit`
 * mechanism — regardless of what the shell command does.
 *
 * The taxonomy is intentionally small and mechanism-only:
 *
 *   editor / apply_patch / write_to_file / replace_in_file / delete_file → edit
 *   run_commands / execute_command / cancel_command                     → command
 *   read_files / read_file / list_files / list_code_definition_names   → read
 *   fetch_web_content / web_fetch / web_search                         → read (browser-fetch)
 *   search_codebase / search_files                                     → search
 *   <server>__<tool> (MCP server tool)                                 → mcp
 *   everything else                                                    → other
 *
 * `cancel_command` is treated as a command-tool identity because the
 * upstream taxonomy (`sdk-tool-policies.isCommandTool`) does so and
 * the canonical SDK tool-name scheme does not differentiate the
 * cancel from the executor mechanism for telemetry purposes.
 */
import type { ToolMechanismSummary } from "@shared/ExtensionMessage"
import { isCommandTool, isEditTool, isReadTool } from "./sdk-tool-policies"

/**
 * The closed set of mechanism buckets the TaskHeader telemetry projection
 * supports. Adding a new bucket is a deliberate API decision (it grows
 * the wire schema and the icon roster); this ACT ships the six
 * documented in the recon.
 */
export type ToolMechanism = "edit" | "command" | "read" | "search" | "mcp" | "other"

/**
 * Browser-fetch / web tool names that the recon explicitly classifies
 * as a `read` mechanism (network read of an external resource), not as
 * a separate `browser` or `web` bucket.
 */
const BROWSER_READ_TOOLS: ReadonlySet<string> = new Set(["fetch_web_content", "web_fetch", "web_search"])

/**
 * Pure predicate: does the given toolName carry the canonical MCP
 * `<server>__<tool>` shape produced by `sdk-tool-policies.ts`?
 */
export function isMcpToolName(toolName: string): boolean {
	if (typeof toolName !== "string" || toolName.length === 0) {
		return false
	}
	const separatorIndex = toolName.indexOf("__")
	if (separatorIndex <= 0) {
		return false
	}
	// Both halves must be non-empty.
	return separatorIndex + 2 < toolName.length
}

/**
 * Pure, deterministic, side-effect-free mapping from canonical
 * toolName to mechanism bucket.
 *
 * Rules (priority order — search comes BEFORE `isReadTool` because
 * `search_*` names are members of `isReadTool` for approval-policy
 * purposes; for the mechanism projection we deliberately distinguish
 * them so the TaskHeader can render `🔍` separately from `👁`):
 *   1. If `isEditTool(name)`    → "edit"
 *   2. If `isCommandTool(name)` → "command"
 *   3. If name is a browser-fetch tool (fetch_web_content /
 *      web_fetch / web_search) → "read"
 *   4. If name is `search_codebase` or `search_files` → "search"
 *      (These names are also members of `isReadTool` in
 *      `sdk-tool-policies` for *approval policy* purposes; for the
 *      mechanism projection we deliberately distinguish them so the
 *      TaskHeader can render `🔍` separately from `👁`. Mechanism ≠
 *      approval policy.)
 *   5. If `isReadTool(name)`    → "read" (covers read_files, read_file,
 *                                 list_files, list_code_definition_names)
 *   6. If `isMcpToolName(name)` → "mcp"
 *   7. Otherwise                → "other"
 *
 * Rule order matters: edit/command take precedence so a tool that is
 * structurally in either set never falls through to read/search/mcp;
 * search takes precedence over `isReadTool` so `search_*` names land
 * in the `search` bucket rather than the `read` bucket.
 */
export function classifyToolMechanism(toolName: string | undefined): ToolMechanism {
	if (typeof toolName !== "string" || toolName.length === 0) {
		return "other"
	}
	if (isEditTool(toolName)) {
		return "edit"
	}
	if (isCommandTool(toolName)) {
		return "command"
	}
	if (BROWSER_READ_TOOLS.has(toolName)) {
		return "read"
	}
	// Search is split out from the read bucket even though
	// `isReadTool` includes search_* names — mechanism projection
	// distinguishes "find something existing in the tree" (search)
	// from "load a file into context" (read).
	if (toolName === "search_codebase" || toolName === "search_files") {
		return "search"
	}
	if (isReadTool(toolName)) {
		return "read"
	}
	if (isMcpToolName(toolName)) {
		return "mcp"
	}
	return "other"
}

/**
 * Build an all-zero `ToolMechanismSummary`. Pure.
 */
export function emptyMechanismSummary(): ToolMechanismSummary {
	return {
		total: 0,
		edit: 0,
		command: 0,
		read: 0,
		search: 0,
		mcp: 0,
		other: 0,
	}
}

/**
 * Pure: increment the bucket for `toolName` on `prev`. Returns a new
 * object — the input is never mutated.
 */
export function recordMechanism(prev: ToolMechanismSummary, toolName: string | undefined): ToolMechanismSummary {
	const bucket = classifyToolMechanism(toolName)
	const next: ToolMechanismSummary = {
		total: prev.total + 1,
		edit: prev.edit,
		command: prev.command,
		read: prev.read,
		search: prev.search,
		mcp: prev.mcp,
		other: prev.other,
	}
	// Defensive: write the increment into the chosen bucket. The
	// bucket name is a closed enum so TypeScript will reject a typo.
	switch (bucket) {
		case "edit":
			next.edit += 1
			break
		case "command":
			next.command += 1
			break
		case "read":
			next.read += 1
			break
		case "search":
			next.search += 1
			break
		case "mcp":
			next.mcp += 1
			break
		case "other":
			next.other += 1
			break
	}
	return next
}

/**
 * Conservation invariant: the sum of all per-mechanism counts must
 * equal `total`. Pure. Exposed for test use.
 */
export function mechanismSummaryIsConserved(summary: ToolMechanismSummary): boolean {
	const sum = summary.edit + summary.command + summary.read + summary.search + summary.mcp + summary.other
	return summary.total === sum
}

/**
 * Wire-boundary invariant. The webview trusts the per-mechanism
 * projection ONLY when:
 *
 *   - the projection is present (`mechanism !== undefined`);
 *   - every field is a finite, non-negative integer (rejects `NaN`,
 *     `Infinity`, negative values, fractional values that might
 *     leak from a malformed snapshot);
 *   - the bucket sum equals `mechanism.total` (in-process conservation);
 *   - `mechanism.total` equals the canonical `toolCalls` (cross-field
 *     conservation against the older flat counter).
 *
 * Any failure here means the projection is unsafe to render as the
 * compact mechanism strip — fall back to the legacy flat `🔧 N`
 * rendering rather than silently displaying contradictory numbers.
 *
 * This function is the production boundary between the host
 * (which constructs the projection) and the webview (which renders
 * it). It exists because `mechanism` is an OPTIONAL wire field
 * (additive compatibility): version-skewed Hub/Remote producers,
 * future type drift, or a malformed snapshot could otherwise produce
 * contradictory UI such as `aria: Tool calls: 10` against
 * `visible: 🔧9 ✏️3 >_3 ...`.
 *
 * Pure. No I/O. No DOM. No React.
 */
export function isUsableMechanismProjection(mechanism: ToolMechanismSummary | undefined, toolCalls: number): boolean {
	if (mechanism === undefined) {
		return false
	}
	const fields: Array<keyof ToolMechanismSummary> = ["total", "edit", "command", "read", "search", "mcp", "other"]
	for (const key of fields) {
		const value = mechanism[key]
		if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
			return false
		}
	}
	if (!mechanismSummaryIsConserved(mechanism)) {
		return false
	}
	if (mechanism.total !== toolCalls) {
		return false
	}
	return true
}
