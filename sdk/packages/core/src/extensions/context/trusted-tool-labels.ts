/**
 * ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01
 *
 * The TRUSTED TOOL LABEL vocabulary.
 *
 * ============================================================================
 * THE DEFECT THIS REPAIRS
 * ============================================================================
 *
 * The evidence-continuity carry-forward PUBLISHES its section into BOTH
 * protected destinations:
 *
 *   1. the PERSISTED compaction sidecar, and
 *   2. the PROVIDER-VISIBLE continuation.
 *
 * The section publishes the TOOL NAME of each carried outcome. The tool name
 * is TRANSCRIPT-SUPPLIED: it is whatever byte string the producer of the
 * transcript put in the `tool_use` block. The predecessor's alias repair
 * already removed the canonical tool-call id from the published form, but the
 * tool NAME was published verbatim (only escaped for the section delimiters
 * and reduced to one line).
 *
 * The counterexample is a synthetic, VALID canonical call/result pair whose
 * tool name carries a confidential sentinel:
 *
 *   - run_commands-FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz (ev-0): succeeded
 *
 * The observation is REPRESENTATIVE AND VALID: the call/result join is
 * unambiguous, the names agree, and the result carries an affirmative
 * success signal. It IS carried — the defect is that its LABEL is
 * published in an uncontrolled form.
 *
 * ============================================================================
 * WHY A SHAPE RULE IS NOT ENOUGH
 * ============================================================================
 *
 * A tool name is an IDENTIFIER, not content — but an identifier is still an
 * arbitrary byte string supplied by whoever produced the transcript. A
 * credential-shaped name satisfies every shape rule an identifier might
 * have, so no regex can decide that it is safe to republish.
 *
 * The sound rule is the same one the alias repair already established for
 * the reference id: the PUBLISHED form must be RUNTIME-OWNED.
 *
 * ============================================================================
 * THE RULE
 * ============================================================================
 *
 * A published tool label is resolved against a FINITE, RUNTIME-OWNED
 * vocabulary of tool identities:
 *
 *   - a tool name that IS a member of the trusted vocabulary is published
 *     under that name (the label is runtime-owned, so it carries no
 *     transcript bytes);
 *   - a tool name that is NOT a member is published under a NEUTRAL,
 *     RUNTIME-OWNED label that says only "some tool", so an unknown or
 *     untrusted name never reaches either destination.
 *
 * The vocabulary is a FIXED list of the runtime's own built-in tool
 * identities. It is deliberately NOT derived from the transcript, from the
 * session's live tool inventory, or from any provider message: a vocabulary
 * assembled from the transcript would re-admit exactly the bytes this
 * repair removes.
 *
 * The INTERNAL canonical identity is UNCHANGED: `VerifiedToolOutcome
 * .toolName` still holds the canonical name, the call/result join is still
 * made on the canonical id, and the fail-closed admission rules are
 * untouched. Only the PUBLISHED REPRESENTATION changes.
 */

/**
 * The NEUTRAL label used for a tool name that is NOT a member of the
 * trusted vocabulary.
 *
 * It is a runtime-owned constant, so it carries no transcript bytes and no
 * information about the untrusted name it replaces.
 */
export const UNTRUSTED_TOOL_LABEL = "tool";

/**
 * The RUNTIME-OWNED vocabulary of built-in tool identities.
 *
 * Every entry is a tool the runtime itself defines and registers, so the
 * string is a runtime-owned constant rather than transcript input. The
 * vocabulary is deliberately a FIXED list: it is not assembled from the
 * session's live tool inventory, because a live inventory can contain
 * host-, plugin- or MCP-supplied names, and a transcript-supplied name
 * must never become trusted by being observed.
 *
 * The list covers the core built-ins, the team tools and the two
 * host-facing tools the VS Code adapter contributes.
 */
export const TRUSTED_TOOL_LABELS: readonly string[] = [
	// The core built-ins (`extensions/tools/runtime.ts`).
	"web_search",
	"read_files",
	"search_codebase",
	"run_commands",
	"editor",
	"fetch_web_content",
	"skills",
	"ask_question",
	"submit_and_exit",
	"apply_patch",
	"spawn_agent",
	"tasks",
	// The team tools (`extensions/tools/team/team-tools.ts`).
	"team_spawn_teammate",
	"team_shutdown_teammate",
	"team_status",
	"team_task",
	"team_run_task",
	"team_cancel_run",
	"team_list_runs",
	"team_await_runs",
	"team_send_message",
	"team_broadcast",
	"team_read_mailbox",
	"team_mission_log",
	"team_cleanup",
	"team_create_outcome",
	"team_attach_outcome_fragment",
	"team_review_outcome_fragment",
	"team_finalize_outcome",
	"team_list_outcomes",
	// The VS Code host's terminal-observation tool
	// (`apps/vscode/src/sdk/command-status-tool.ts`).
	"command_status",
];

/**
 * The trusted vocabulary as a SET, for O(1) membership tests.
 *
 * It is a module-level constant, so the membership test is not
 * re-constructed on every published outcome.
 */
const TRUSTED_TOOL_LABEL_SET: ReadonlySet<string> = new Set(
	TRUSTED_TOOL_LABELS,
);

/**
 * Resolve a transcript-supplied tool name to a PUBLISHABLE label.
 *
 * A name in the trusted vocabulary is published unchanged — it is a
 * runtime-owned string. Any other name is published as the neutral
 * {@link UNTRUSTED_TOOL_LABEL}.
 *
 * The function is PURE and depends on nothing but its argument, so the
 * published section stays byte-stable across re-derivation (the
 * prompt-cache invariant the alias repair established).
 */
export function resolvePublishedToolLabel(toolName: string): string {
	return TRUSTED_TOOL_LABEL_SET.has(toolName) ? toolName : UNTRUSTED_TOOL_LABEL;
}
