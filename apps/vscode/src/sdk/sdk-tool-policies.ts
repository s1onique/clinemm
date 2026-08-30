import * as child_process from "node:child_process"
import * as fs from "node:fs"
import {
	buildCommandExecutionPlan,
	type CommandDecision,
	type CommandHostAuthorization,
	type CommandHostMode,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	type EvaluatedCommand,
	evaluateCommandPolicy,
	type TempAuthorityEvidence,
	type WorkspacePathAuthorityEvidence,
} from "@cline/core"
import { evaluateCommandRiskWithParser } from "@cline/core/internal/command-risk-internal"
import type { CommandExecutionPlan } from "@cline/shared"

/**
 * Host-owned V2 parser evidence — a structurally-compatible alias for
 * the internal `TrustedParserEvidence` type. We use a local alias rather than
 * importing the internal type name directly so the host source
 * remains free of the V2 protocol surface identifier (see
 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01
 * PROVENANCE INVARIANT — the type identifier is intentionally not
 * exposed; only the trusted `MvdanShHelper` capability can construct
 * one, and provenance is established at runtime by the helper
 * (SHA-256 digest + protocol version + structural validation)).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type TrustedParserEvidence = unknown

import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpHub } from "@/services/mcp/McpHub"
import type { SessionAutoApprovalOverride } from "./session-auto-approval"
import { emitV2Capture } from "./v2-capture"

/**
 * Build SDK `toolPolicies` for tools governed by Cline's auto-approval UI.
 *
 * The SDK defaults unlisted tools to auto-approved. For tools controlled by
 * the AutoApproveBar toggles (including all MCP tools), force the SDK to call
 * `requestToolApproval`; the approval callback then evaluates the latest
 * settings and either silently approves or shows the approval UI. This keeps
 * active sessions in sync when the user toggles auto-approval mid-task.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02:
 * The command policy lives in `@cline/core/runtime/command-policy`. This
 * module adapts the VS Code `AutoApprovalSettings` shape into the canonical
 * `CommandHostAuthorization` form and routes command-tool decisions through
 * the same `evaluateCommandPolicy()` used by the CLI.
 *
 * CRITICAL: Command tools are subject to host command policy evaluation.
 * The `requires_approval` model hint is advisory only - it can escalate
 * but never downgrade host authority.
 */
export function buildToolPolicies(
	_settings: AutoApprovalSettings,
	mcpHub?: McpHub,
): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {}

	const set = (tools: string[]) => {
		for (const tool of tools) {
			policies[tool] = { autoApprove: false }
		}
	}

	set(["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"])
	set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"])
	set(["run_commands", "execute_command", "cancel_command"])
	set(["fetch_web_content", "web_fetch", "web_search"])

	if (mcpHub) {
		for (const server of mcpHub.getServers()) {
			for (const tool of server.tools ?? []) {
				const sdkName = `${server.name}__${tool.name}`
				policies[sdkName] = { autoApprove: false }
			}
		}
	}

	return policies
}

export function isReadTool(toolName: string): boolean {
	return ["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"].includes(
		toolName,
	)
}

export function isEditTool(toolName: string): boolean {
	return ["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"].includes(toolName)
}

export function isCommandTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "execute_command" || toolName === "cancel_command"
}

function isBrowserTool(toolName: string): boolean {
	return toolName === "fetch_web_content" || toolName === "web_fetch" || toolName === "web_search"
}

/** MCP tools are registered by `createMcpTools` under `serverName__toolName`. */
function parseMcpToolName(toolName: string): { serverName: string; toolName: string } | undefined {
	const separatorIndex = toolName.indexOf("__")
	if (separatorIndex <= 0) return undefined
	const serverName = toolName.substring(0, separatorIndex)
	const mcpToolName = toolName.substring(separatorIndex + 2)
	if (!mcpToolName) return undefined
	return { serverName, toolName: mcpToolName }
}

/**
 * Evaluate the current UI auto-approval settings for a single SDK tool name.
 * Used both when building initial SDK policies and as a live guard in the
 * approval callback, so changes from the AutoApproveBar are respected even if
 * an SDK session was created before the toggle changed.
 *
 * For command tools, this returns the host "mode" — NOT a boolean. The
 * caller is responsible for passing that mode into the command policy.
 *
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT:
 *
 * `pathAuthorityEvidence` is HOST-PRODUCED realpath evidence. The
 * host (VS Code here) calls `fs.realpathSync` on the workspace
 * root(s) and on every path operand; the policy layer consumes
 * the evidence and tests containment on realpath-resolved strings.
 * This is the gate that closes the V1 lexical-only
 * symlink-escape attack (e.g. project-internal symlink → /etc).
 *
 * The evidence is OPTIONAL. When absent, the policy layer falls
 * back to the V1 lexical-only `workspaceRoots` + `cwd` containment
 * check. The host should ALWAYS supply evidence in production;
 * tests may omit it.
 */

/**
 * ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01
 *
 * Pull the first rendered command string from a tool input and
 * return its first whitespace-delimited token IF AND ONLY IF it
 * is exactly `/usr/bin/mktemp`. Returns `undefined` otherwise
 * (including on parse failure or for any non-mktemp command).
 *
 * This is a narrow helper. It exists to detect the exact
 * reviewed slash-prefixed form so the host adapter can bind
 * evidence to the ACTUAL executable bash will run, rather than
 * to whatever `which mktemp` finds in PATH. It does NOT support
 * any other binary; the policy gate already requires
 * `realpath === "/usr/bin/mktemp"`, so even if a future bug
 * allowed a different `executablePath` through, the strict
 * identity gate would reject it.
 *
 * Supports the common input shapes observed in production:
 *   - `{ command: "/usr/bin/mktemp" }`                 -> string
 *   - `{ command: "/usr/bin/mktemp -d" }`              -> string with args
 *   - `{ commands: ["/usr/bin/mktemp"] }`              -> array
 *   - `{ command: { command: "/usr/bin/mktemp", args: [] } }` -> structured
 *
 * Returns the first token trimmed of leading/trailing
 * whitespace. Trailing tokens / args are ignored.
 */
function extractExplicitMktempPath(toolInput: unknown): string | undefined {
	if (toolInput === null || toolInput === undefined) {
		return undefined
	}
	const REVIEWED = "/usr/bin/mktemp"
	// String form: command is the raw shell text.
	if (typeof toolInput === "string") {
		const first = toolInput.trim().split(/\s+/u)[0]
		return first === REVIEWED ? first : undefined
	}
	// Structured form: object with command / commands / cmd.
	if (typeof toolInput !== "object") {
		return undefined
	}
	const record = toolInput as Record<string, unknown>
	const pickFirst = (cmd: unknown): string | undefined => {
		if (typeof cmd !== "string") {
			return undefined
		}
		const first = cmd.trim().split(/\s+/u)[0]
		return first === REVIEWED ? first : undefined
	}
	if (typeof record.command === "string") {
		return pickFirst(record.command)
	}
	if (Array.isArray(record.commands) && record.commands.length > 0) {
		return pickFirst(record.commands[0])
	}
	if (typeof record.cmd === "string") {
		return pickFirst(record.cmd)
	}
	// StructuredCommandInput: { command: string, args?: string[] }.
	// Already covered by `record.command` above, but if the outer
	// shape wraps it (e.g. { command: { command: "...", args: [] } })
	// recurse one level.
	if (record.command !== null && typeof record.command === "object") {
		return extractExplicitMktempPath(record.command)
	}
	return undefined
}

/**
 * ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02
 * ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01
 *
 * Host-side evidence builder for the `host_safe_mktemp_default_temp`
 * safe rule.
 *
 * On Darwin (process.platform === "darwin"), the function:
 *
 *   (1) EXPLICIT-PATH INVOCATION: when `opts.executablePath` is
 *       supplied (the user's command text already contains a
 *       slash-prefixed path such as `/usr/bin/mktemp`), that
 *       pathname IS the authority. Bash executes a slash-prefixed
 *       command name as a pathname, bypassing shell-function /
 *       builtin / PATH lookup (GNU Bash Reference Manual, Command
 *       Search and Execution). The adapter therefore skips
 *       `/usr/bin/which mktemp` and `fs.realpathSync`s the
 *       supplied path directly. PATH shadow (Nix coreutils,
 *       homebrew coreutils, etc.) is irrelevant -- the executed
 *       identity is the explicit pathname, not whatever `which`
 *       happens to find.
 *   (2) NO EXPLICIT PATH (default): falls back to PATH resolution
 *       via `/usr/bin/which mktemp` (a subprocess so PATH
 *       resolution matches what the executor will see). Captures
 *       the raw executable path.
 *   (3) Realpathes the resolved executable via `fs.realpathSync`.
 *   (4) Requires the realpath to equal `/usr/bin/mktemp` -- only
 *       Apple-system identity is reviewed in this ACT. Any other
 *       resolution (homebrew coreutils, Nix coreutils, custom
 *       build, symlink hack, etc.) returns undefined evidence
 *       and the policy gate fails closed to ASK with
 *       host_mktemp_executable_identity_unbound.
 *   (5) Sourced the true Darwin per-user temp root from
 *       `/usr/bin/getconf DARWIN_USER_TEMP_DIR` (which calls
 *       confstr(_CS_DARWIN_USER_TEMP_DIR) on darwin). This is
 *       the Apple-authoritative source per the Secure Coding
 *       Guide; unlike os.tmpdir(), it ignores inherited TMPDIR.
 *   (6) Realpathes the getconf result for the canonical form.
 *
 * Returns undefined on:
 *   - non-darwin platform (linux/win32/unknown)
 *   - explicit-path invocation where the realpath does not equal
 *     `/usr/bin/mktemp` (i.e. `/usr/local/bin/mktemp`, a custom
 *     build, a symlink that resolves elsewhere, etc.)
 *   - PATH-resolution fallback: which subprocess failure (PATH
 *     has no mktemp at all)
 *   - realpath mismatch against /usr/bin/mktemp
 *   - getconf subprocess failure
 *
 * The returned evidence satisfies BOTH the
 *   (a) executable identity gate
 *       (realpath === /usr/bin/mktemp)
 * and
 *   (b) true Darwin temp authority gate
 *       (darwinUserTempRoot from getconf, NOT os.tmpdir())
 * required by the CORRECTION02 policy gate.
 *
 * EXPLICIT-PATH EVIDENCE BINDING (CORRECTION01):
 * `opts.executablePath` is the adapter's request: "the user's
 * command text invoked THIS exact pathname, so the executed
 * identity IS this pathname." The adapter does NOT do generic
 * arbitrary-executable resolution; it only opts in for the
 * already-reviewed slash-prefixed `/usr/bin/mktemp` family. The
 * caller's responsibility is to extract the first token from the
 * normalized command and pass it here; the adapter then runs the
 * same strict identity gate (realpath === "/usr/bin/mktemp") so
 * no other binary can sneak through.
 */
export function buildTempAuthorityEvidence(opts?: {
	/**
	 * The slash-prefixed executable pathname the user invoked
	 * (e.g. `/usr/bin/mktemp`). When supplied, the adapter
	 * resolves this path directly via `fs.realpathSync` instead
	 * of asking PATH (`/usr/bin/which mktemp`). Only the
	 * Apple-system `/usr/bin/mktemp` identity passes the strict
	 * realpath gate.
	 */
	executablePath?: string
}): TempAuthorityEvidence | undefined {
	if (process.platform !== "darwin") {
		return undefined
	}

	let executablePath: string
	if (opts?.executablePath !== undefined) {
		// Explicit-path invocation. The user's command text
		// already names the binary by pathname; bash will
		// execute that pathname directly. We realpath it to
		// detect symlink escapes (e.g. `/usr/local/bin/mktemp`
		// that happens to be a symlink to GNU coreutils).
		executablePath = opts.executablePath
	} else {
		try {
			const which = child_process.spawnSync("/usr/bin/which", ["mktemp"], {
				encoding: "utf8",
				timeout: 5_000,
			})
			if (which.status !== 0 || !which.stdout) {
				return undefined
			}
			executablePath = which.stdout.trim().split("\n")[0]
			if (!executablePath) {
				return undefined
			}
		} catch {
			return undefined
		}
	}

	let executableRealpath: string
	try {
		executableRealpath = fs.realpathSync(executablePath)
	} catch {
		return undefined
	}

	// STRICT IDENTITY GATE: only Apple-system /usr/bin/mktemp is
	// reviewed in this ACT. Anything else fails closed to ASK.
	if (executableRealpath !== "/usr/bin/mktemp") {
		return undefined
	}

	let darwinUserTempRoot: string
	try {
		const getconf = child_process.spawnSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
			encoding: "utf8",
			timeout: 5_000,
		})
		if (getconf.status !== 0 || !getconf.stdout) {
			return undefined
		}
		darwinUserTempRoot = getconf.stdout.trim()
		if (!darwinUserTempRoot) {
			return undefined
		}
	} catch {
		return undefined
	}

	let canonicalDarwinUserTempRoot: string
	try {
		canonicalDarwinUserTempRoot = fs.realpathSync(darwinUserTempRoot)
	} catch {
		canonicalDarwinUserTempRoot = darwinUserTempRoot
	}

	return {
		platform: "darwin",
		executablePath,
		executableRealpath,
		darwinUserTempRoot,
		canonicalDarwinUserTempRoot,
	}
}

export function getCommandHostAuthorization(
	toolName: string,
	settings: AutoApprovalSettings,
	_mcpHub?: McpHub,
	/**
	 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
	 * REALPATH_WORKSPACE_CONFINEMENT:
	 *
	 * Optional workspace context for the path authority gate.
	 * All three fields are optional; when absent, the policy
	 * layer refuses to ALLOW any path-bearing R0 command.
	 */
	workspaceContext?: {
		workspaceRoots?: ReadonlyArray<string>
		cwd?: string
		pathAuthorityEvidence?: WorkspacePathAuthorityEvidence
	},
	/**
	 * ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01
	 *
	 * Optional tool input (the raw `toolInput` from the SDK
	 * request). When provided AND the first rendered command
	 * starts with `/usr/bin/mktemp`, the host adapter passes
	 * that explicit pathname to `buildTempAuthorityEvidence()`
	 * so the executable identity is bound to the ACTUAL
	 * slash-prefixed executable bash will execute, NOT to
	 * whatever `which mktemp` happens to find via PATH. This
	 * closes the exact-path-name-with-PATH-shadow false
	 * negative: `/usr/bin/mktemp` is AUTO on darwin even when
	 * PATH points at GNU/Nix coreutils first.
	 *
	 * Omitting this argument falls back to the legacy
	 * PATH-resolution behavior (used by older callers and by
	 * the CLI's `command-policy-host.ts` which has its own
	 * resolver).
	 */
	toolInput?: unknown,
): CommandHostAuthorization {
	// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01:
	// Extract the first whitespace-delimited token of the
	// rendered command string and, if it is exactly
	// `/usr/bin/mktemp`, pass it as `executablePath` to
	// `buildTempAuthorityEvidence`. This binds the host
	// evidence to the slash-prefixed pathname the user
	// invoked -- PATH shadow (Nix coreutils, homebrew
	// coreutils, BASH_FUNC_* shadows) becomes irrelevant for
	// the executed identity, because bash treats a
	// slash-prefixed command name as a pathname directly
	// (GNU Bash Reference Manual, Command Search and Execution).
	const explicitMktempPath = extractExplicitMktempPath(toolInput)
	let resolved: CommandHostAuthorization
	if (isCommandTool(toolName)) {
		// `cancel_command` is mutating (terminates a process tree) but
		// has no command-shaped input. It must follow the user's
		// executeSafeCommands setting too: cancel is part of the
		// command-execution authority boundary, so the same safe-only
		// rules apply (the user must have opted in to auto-approve
		// command execution for cancel to be auto-approved as well).
		// In `manual` mode, cancel_command goes through the normal
		// ASK path and surfaces as an unparseable command for the
		// canonical policy, which the host treats as a confirmation
		// prompt. The executeSafeCommands toggle is therefore the
		// authoritative gate: off -> ASK; on -> ALLOW.
		if (settings.actions.executeSafeCommands) {
			resolved = commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
				workspaceRoots: workspaceContext?.workspaceRoots,
				cwd: workspaceContext?.cwd,
				// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
				// REALPATH_WORKSPACE_CONFINEMENT: attach the
				// host-produced realpath evidence. When the
				// caller does not supply it, the policy layer
				// falls back to the V1 lexical-only check.
				pathAuthorityEvidence: workspaceContext?.pathAuthorityEvidence,
				// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION02 +
				// ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01:
				// NARROW scope: only attach tempAuthorityEvidence
				// when the user's command is in the reviewed
				// explicit-path `/usr/bin/mktemp` family. Bare
				// `mktemp` is intentionally ASK now (binding
				// requires a slash-prefixed executable), so there
				// is no reason to probe `/usr/bin/which mktemp` /
				// `/usr/bin/getconf DARWIN_USER_TEMP_DIR` for an
				// arbitrary safe command (`pwd`, `git status`,
				// `ls`, `cat package.json`, etc.) — that would be
				// unnecessary subprocess work on every command
				// authorization and violates the ACT's stated
				// narrow scope.
				//
				// The CORRECTION03 policy gate independently
				// returns `host_mktemp_temp_authority_unbound`
				// (ASK) when `tempAuthorityEvidence === undefined`
				// and the command's lexical shape matches
				// `host_safe_mktemp_default_temp` (bare
				// `mktemp` / `mktemp -d`). The bare-form ASK
				// fallback is therefore preserved without
				// evidence discovery.
				tempAuthorityEvidence:
					explicitMktempPath !== undefined
						? buildTempAuthorityEvidence({
								executablePath: explicitMktempPath,
							})
						: undefined,
			})
		} else {
			resolved = commandHostAuthorization({ mode: "manual" })
		}
	} else {
		// For non-command tools, the auto-approve toggle is a
		// simple boolean. We only return the authorization mode when
		// the tool is a command tool; callers should not use this
		// function for non-command tools.
		resolved = commandHostAuthorization({ mode: "manual" })
	}
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
	// C5 — capture the resolved host authorization mode at its actual
	// owner. This is the load-bearing input the V2 promotion branch
	// consults; if it is not "safe-only" the branch cannot fire.
	emitV2Capture({
		codePoint: "approval.authorization.v2",
		data: {
			toolName,
			mode: resolved.mode,
			hasExplicitAllowRules: (resolved.explicitAllowRules?.length ?? 0) > 0,
		},
	})
	return resolved
}

/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * CORRECTION02 (REAL_MANDATORY_SEATBELT_PRODUCER):
 *
 * Pure, side-effect-free authority envelope stamper. The function
 * derives the conditional authority from the kernel-envelope
 * invariant (`sandboxMode`), NOT from any user-facing toggle:
 *
 *   auth.mode === "all"
 *   AND sandboxMode === "seatbelt-experimental"
 *     => auth with mandatorySeatbelt: true stamped on
 *     => canonical lattice emits host_mode_all_seatbelt_required
 *     => R5 hard floor suppressed (kernel is the gate)
 *
 *   any other combination
 *     => auth returned unchanged
 *     => mandatorySeatbelt remains undefined
 *     => canonical lattice emits plain host_mode_all
 *     => R5 hard floor still fires (user is the gate)
 *
 * The host adapter (VSCode `SdkController`) calls this in its
 * `resolveHostAuthorization` closure after the session override
 * has projected `mode: "all"`. The function is pure (no I/O,
 * no environment reads) so the production site can be unit-tested
 * with synthetic inputs.
 *
 * Exported for the same reason the other authority utilities are
 * exported: this is the producer seam of the conditional
 * authority, and the test suite needs to exercise it directly
 * without standing up the entire SdkController.
 */
export function applySeatbeltAuthorityEnvelope(
	auth: CommandHostAuthorization,
	sandboxMode: string | undefined,
): CommandHostAuthorization {
	if (auth.mode === "all" && sandboxMode === "seatbelt-experimental") {
		return { ...auth, mandatorySeatbelt: true }
	}
	return auth
}

/**
 * Evaluate whether a specific command tool call should be auto-approved.
 *
 * This function applies the complete command policy:
 * 1. Host command authorization (derived from user settings)
 * 2. Model `requires_approval` hint (as advisory escalation only)
 *
 * The model hint CANNOT downgrade host authority. If the host classifies
 * a command as requiring approval (ASK) or dangerous, the model cannot
 * override this by setting `requires_approval=false`.
 *
 * @returns Object containing:
 *   - approved: whether the command can execute without explicit user approval
 *   - decision: the full CommandDecision with reason and source
 */
export function evaluateCommandToolApproval(
	toolInput: unknown,
	hostAuthorization: CommandHostAuthorization,
	/**
	 * Optional V2 evidence (TrustedParserEvidence) produced by the trusted
	 * host-owned `MvdanShHelper` capability. The host adapter
	 * (VSCode `SdkController`) awaits the helper and snapshots
	 * `toolInput` ONCE before invoking this entry point; this
	 * parameter carries that already-validated `TrustedParserEvidence` (or
	 * `undefined` when the helper is unavailable).
	 *
	 * MUST come only from the trusted host-owned `MvdanShHelper`
	 * capability — NEVER from model payload, MCP, webview, gRPC, or
	 * remote caller.
	 *
	 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	 * (CORRECTION02 Phase 2).
	 */
	parserResult?: TrustedParserEvidence | undefined,
): {
	approved: boolean
	decision: CommandDecision
	/**
	 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
	 * Executor-side Seatbelt obligation. `true` iff the canonical
	 * lattice emitted `host_mode_all_seatbelt_required` AND the R5
	 * composer honored the obligation (did NOT downgrade to ASK). The
	 * runtime stamps this into
	 * `AgentToolContext.mandatorySeatbeltExecution`; the executor
	 * (`CommandJobManager.start`) refuses host-shell fallback when
	 * `true`.
	 */
	mandatorySeatbeltExecution: boolean
} {
	// Always enforce dangerous classification for host safety
	const result = evaluateCommandPolicy({
		toolInput,
		hostAuthorization,
	})

	// DENY precedence: an explicit hard host DENY rule (e.g. an
	// admin-defined `^rm -rf` block) takes precedence over the R5
	// hard floor and over any V2 promotion. The user-configured
	// deny must win. ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
	// CORRECTION01: a DENY MUST NEVER carry the executor-side Seatbelt
	// obligation — the obligation is `allow`-shaped; nothing executes
	// under DENY (INV-5).
	if (result.decision.kind === "deny") {
		return {
			approved: false,
			decision: result.decision,
			mandatorySeatbeltExecution: false,
		}
	}

	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01:
	// Layer the R5 catastrophic hard floor on top of the canonical
	// policy verdict. `evaluateCommandRiskWithParser` is a
	// DOWNGRADE-only layer — it can downgrade an ALLOW to ASK when
	// the command argv positively matches a catastrophic family,
	// but it never weakens an existing ASK or DENY. The hard floor
	// is identical to the CLI's. The motivating ClineMM incident
	// surface is VSCodium (i.e. this host), not CLI, so this
	// wiring is the load-bearing safety invariant.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
	// uses the trusted-internal `evaluateCommandRiskWithParser`
	// (imported from `@cline/core/internal/command-risk-internal`).
	// `parserResult: undefined` keeps V2 dormant. The future ACT
	// (ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01)
	// will replace `undefined` with the trusted helper's result.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	// CORRECTION02 Phase 2: `parserResult` is now threaded from the
	// host adapter (the SdkController callback awaits the trusted
	// `MvdanShHelper.invoke()` and passes the result down via this
	// optional parameter). The async seam lives at the host adapter,
	// NOT in this pure function. When the helper is unavailable /
	// fails / returns null / digest mismatches, the host adapter
	// passes `undefined` here and V2 stays dormant.
	//
	// CORRECTION01 (HALT_PROVENANCE_GAP): the V2-aware evaluator is
	// invoked UNCONDITIONALLY — not only when the canonical verdict
	// is ALLOW. V2 may PROMOTE a structure-only V1 ASK to ALLOW when
	// every reachable AST branch is auto-approve eligible. Without
	// this composition, safe compound commands (e.g. `pwd; pwd`)
	// would never reach the V2 promotion gate.
	const riskVerdict = evaluateCommandRiskWithParser({
		toolInput,
		hostAuthorization,
		// Cast at the trust boundary. This function is a pure
		// host-policy function: it does NOT authenticate provenance
		// itself. The PROVENANCE INVARIANT is enforced by the
		// production call graph — the trusted host adapter
		// (`SdkController.ts`) is the ONLY entry point that
		// constructs this value, and it awaits
		// `MvdanShHelper.invoke()` (whose digest + protocol version
		// + structural validation make it tamper-evident).
		// `unknown` keeps the V2 type identifier out of this host
		// source (the parser-provenance invariant forbids the
		// literal V2 type identifier in host source files).
		parserResult: parserResult as never,
	})
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-CAPTURE01
	// C6 — observe the structured classifier verdict at the seam where
	// the V2 promotion branch is reachable. We capture both the V1
	// lattice verdict and the V2 overlay so post-mortem can distinguish
	// "host did not authorize promotion" from "structurally not
	// promotable" without going inside the SDK.
	emitV2Capture({
		codePoint: "commandRisk.structured.v2",
		data: {
			preV2Decision: result.decision.kind,
			preV2Source: result.decision.source,
			structuredDecision: riskVerdict.decision,
			structuredSource: riskVerdict.source,
			structuredDisposition: riskVerdict.disposition,
		},
	})
	if (riskVerdict.disposition === "never-auto-approve") {
		// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
		// CORRECTION01: when the R5 layer forced a downgrade (no
		// Seatbelt obligation, or obligation was not honored), the
		// executor-side flag is `false`. The user is the gate.
		return {
			approved: false,
			decision: {
				kind: "ask",
				reason: "R5 catastrophic hard floor: never auto-approve",
				source: "risk_hard_floor",
			},
			mandatorySeatbeltExecution: false,
		}
	}

	// V2-aware ASK -> ALLOW promotion. Today this never fires because
	// parserResult is undefined (V2 dormant), but the structural seam
	// is here so the helper-binary ACT just has to drop in a parser
	// result. The `risk_v2_structured_promotion` source is the ONLY
	// path through which a V1 ASK may be promoted to ALLOW.
	if (
		result.decision.kind === "ask" &&
		riskVerdict.source === "risk_v2_structured_promotion" &&
		riskVerdict.decision === "allow"
	) {
		return {
			approved: true,
			decision: riskVerdict as unknown as CommandDecision,
			// V2 promotion is independent of Seatbelt obligation; if
			// the underlying lattice did not emit the seatbelt source,
			// the obligation is absent here too.
			mandatorySeatbeltExecution: false,
		}
	}

	// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
	// CORRECTION01 (final-state projection): the executor-side flag is
	// `true` iff the canonical lattice emitted the conditional source
	// AND the R5 layer did NOT force a downgrade (the disposition is
	// `auto-approve-eligible`, not `never-auto-approve`). The
	// executor reads this flag and refuses host-shell fallback.
	return {
		approved: result.decision.kind === "allow",
		decision: result.decision,
		mandatorySeatbeltExecution: result.decision.source === "host_mode_all_seatbelt_required",
	}
}

/**
 * Validate that an input looks like a `cancel_command` invocation.
 *
 * Shape: `{ jobId: string, ... }`. Anything else is rejected with a
 * DENY (the model cannot elicit mutation through a malformed input).
 *
 * ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-CORRECTION02:
 * `cancel_command` is a job-control capability, not a shell command.
 * It MUST NOT be routed through the canonical run_commands normalizer,
 * because the canonical normalizer returns ASK on unparseable input
 * regardless of host mode — including mode `all`. That would prevent
 * even YOLO sessions from cancelling their own jobs.
 */
export function isCancelCommandInput(input: unknown): boolean {
	if (input === null || typeof input !== "object") return false
	const record = input as Record<string, unknown>
	return typeof record.jobId === "string" && record.jobId.length > 0
}

/**
 * Evaluate the authority decision for a `cancel_command` invocation.
 *
 * This is the dedicated job-control authority path. It does NOT route
 * through `evaluateCommandPolicy` because cancel_command has no
 * command-shaped input — it has a jobId. The matrix is:
 *
 *   - explicit hard host DENY rule (when/if cancellation is denied at
 *     the host level)         → DENY (host_hard_deny)
 *   - malformed input          → DENY (unknown_input)
 *   - host mode `manual`       → ASK  (host_mode_manual)
 *   - host mode `safe-only`    → ALLOW (host_mode_safe_only_rule)
 *   - host mode `all`          → ALLOW (host_mode_all)
 *
 * Model escalation via `requires_approval` is intentionally ignored:
 * cancel_command has no command field for the model to evaluate, and
 * a model advisory hint cannot override the user's explicit authority.
 *
 * The result is observable: the same authority matrix that protects
 * `run_commands` (manual=ASK, safe-only=ALLOW, all=ALLOW) without
 * false-ASK for unparseable input.
 */
export function evaluateCancelCommandToolApproval(
	toolInput: unknown,
	hostAuthorization: CommandHostAuthorization,
): { approved: boolean; decision: CommandDecision } {
	// Input shape check first — malformed input is a hard DENY.
	if (!isCancelCommandInput(toolInput)) {
		return {
			approved: false,
			decision: {
				kind: "deny",
				reason: "cancel_command input must be a non-empty object with a string jobId",
				source: "unknown_input",
			},
		}
	}
	// Hard host DENY. The current production deny rules are empty
	// (no production deny source), but the branch is here so future
	// hard-deny sources compose without re-architecting this function.
	// The exact same explicitDenyRules pattern runs in the canonical
	// shell-command policy; the only difference is which calls those
	// rules are evaluated against.
	const denyRules = hostAuthorization.explicitDenyRules ?? []
	if (denyRules.length > 0) {
		const probeInput = JSON.stringify(toolInput)
		for (const rule of denyRules) {
			if (rule.pattern.test(probeInput)) {
				return {
					approved: false,
					decision: {
						kind: "deny",
						reason: `cancel denied by host rule ${rule.source}`,
						source: "host_hard_deny",
					},
				}
			}
		}
	}
	// Authority matrix by host mode.
	const mode: CommandHostMode = hostAuthorization.mode
	if (mode === "all") {
		return {
			approved: true,
			decision: {
				kind: "allow",
				reason: "host mode allows all command controls",
				source: "host_mode_all",
			},
		}
	}
	if (mode === "safe-only") {
		return {
			approved: true,
			decision: {
				kind: "allow",
				reason: "host mode safe-only permits cancelling a host-owned job",
				source: "host_mode_safe_only_rule",
			},
		}
	}
	// manual mode (default): every cancel requires user confirmation.
	return {
		approved: false,
		decision: {
			kind: "ask",
			reason: "host mode manual requires user confirmation to cancel a command",
			source: "host_mode_manual",
		},
	}
}

/**
 * CORRECTION04: Evaluate a command tool call AND return the per-command
 * hardened execution plan. The plan is attached to the approval result so
 * the SDK AgentRuntime can substitute the hardened argv at the execution
 * boundary. Mirrors `cliEvaluateCommandToolApproval` in
 * `@cline/cli/runtime/command-policy-host.ts`.
 *
 * Authority and execution constraints are INDEPENDENT axes:
 *   - authority may be ALLOW, ASK, or DENY
 *   - execution constraints attach whenever the canonical policy
 *     successfully classifies commands, regardless of whether
 *     authority is ALLOW or ASK.
 *   - DENY: no execution plan (no execution will happen).
 *
 * A successful ASK -> user YES must still execute the hardened argv,
 * never the raw model input. The host coordinator (VS Code) carries
 * the plan through the pending approval state.
 */
/**
 * Optional seam for testing: override the execution plan builder.
 * Allows tests to simulate planner failure without mocking internals.
 */
export interface EvaluateCommandToolApprovalWithPlanOptions {
	/**
	 * Inject a custom execution plan builder. When provided, the adapter
	 * calls this instead of `buildCommandExecutionPlan`. Return `undefined`
	 * to simulate a planner failure (e.g., cardinality mismatch).
	 *
	 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
	 * CORRECTION03: the override now also receives the host
	 * authorization so test stubs can exercise the real grant seam.
	 * Production callers DO NOT use this override.
	 */
	buildExecutionPlanOverride?: (
		toolInput: unknown,
		commands: readonly EvaluatedCommand[],
		hostAuthorization: CommandHostAuthorization,
	) => CommandExecutionPlan | undefined
	/**
	 * Optional V2 evidence (TrustedParserEvidence) produced by the trusted
	 * host-owned `MvdanShHelper` capability. The host adapter
	 * (VSCode `SdkController`) awaits the helper and snapshots
	 * `toolInput` ONCE before invoking this entry point; this
	 * parameter carries that already-validated `TrustedParserEvidence` (or
	 * `undefined` when the helper is unavailable).
	 *
	 * MUST come only from the trusted host-owned `MvdanShHelper`
	 * capability — NEVER from model payload, MCP, webview, gRPC, or
	 * remote caller.
	 *
	 * ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	 * (CORRECTION02 Phase 2).
	 */
	parserResult?: TrustedParserEvidence | undefined
}

export function evaluateCommandToolApprovalWithPlan(
	toolInput: unknown,
	hostAuthorization: CommandHostAuthorization,
	options?: EvaluateCommandToolApprovalWithPlanOptions,
): {
	approved: boolean
	decision: CommandDecision
	executionPlan?: CommandExecutionPlan
	/**
	 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
	 * Executor-side Seatbelt obligation. See the corresponding
	 * field on `evaluateCommandToolApproval`. Same computation:
	 * `true` iff the canonical lattice emitted the conditional
	 * source AND the R5 layer did NOT force a downgrade.
	 */
	mandatorySeatbeltExecution: boolean
} {
	const result = evaluateCommandPolicy({
		toolInput,
		hostAuthorization,
	})
	// Plan construction: DENY discards it because nothing executes.
	// For ALLOW/ASK, build the plan. If plan construction fails
	// (invalid input, cardinality mismatch) and a safe profile is
	// required, fail closed — do not let raw input execute.
	const planBuilder = options?.buildExecutionPlanOverride ?? buildCommandExecutionPlan
	// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
	// CORRECTION03: thread the host authorization into the plan
	// builder so it can derive per-entry FilesystemCreateOnlyCapability
	// from the policy decision + host evidence. The override hook
	// (test-only) also receives it. Production planBuilder is the
	// default `buildCommandExecutionPlan` from the SDK, which now
	// attaches the capability when the four-condition gate passes.
	const executionPlan = result.decision.kind === "deny" ? undefined : planBuilder(toolInput, result.commands, hostAuthorization)
	if (result.decision.kind === "deny") {
		// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
		// CORRECTION01: DENY MUST NEVER carry the obligation.
		return { approved: false, decision: result.decision, mandatorySeatbeltExecution: false }
	}
	// CORRECTION04 P0: if a safe execution profile is required but the
	// plan could not be constructed, fail closed rather than allowing
	// raw input to execute. This is an internal invariant violation —
	// the classifier matched a rule but the planner could not produce
	// a hardened argv.
	const requiresPlan = result.commands.some((c) => c.safeExecutionProfile !== undefined)
	if (requiresPlan && !executionPlan) {
		// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
		// CORRECTION01: an internal failure (plan could not be built)
		// is treated as DENY. No Seatbelt obligation is propagated
		// because nothing executes.
		return {
			approved: false,
			decision: {
				kind: "deny",
				source: "execution_plan_invalid",
				reason: "required hardened execution plan could not be constructed",
			},
			mandatorySeatbeltExecution: false,
		}
	}
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01:
	// Layer the R5 catastrophic hard floor on top of the canonical
	// policy verdict. `evaluateCommandRiskWithParser` is a
	// DOWNGRADE-only layer — it can downgrade an ALLOW to ASK when
	// the command argv positively matches a catastrophic family,
	// but it never weakens an existing ASK or DENY. The hard floor
	// is identical to the CLI's. The motivating ClineMM incident
	// surface is VSCodium (i.e. this host), not CLI, so this
	// wiring is the load-bearing safety invariant. The execution
	// plan is preserved so a user-approved ASK still runs
	// hardened.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
	// uses the trusted-internal `evaluateCommandRiskWithParser`.
	// `parserResult: undefined` keeps V2 dormant. The future ACT
	// will replace this with the trusted helper's result.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	// CORRECTION02 Phase 2: `parserResult` is now threaded from
	// the host adapter (the SdkController callback awaits the
	// trusted `MvdanShHelper.invoke()` and passes the result down
	// via `options.parserResult`). The async seam lives at the
	// host adapter, NOT in this pure function. When the helper is
	// unavailable / fails / returns null / digest mismatches, the
	// host adapter passes `undefined` here and V2 stays dormant.
	//
	// CORRECTION01 (HALT_PROVENANCE_GAP): the V2-aware evaluator is
	// invoked UNCONDITIONALLY — not only when the canonical verdict
	// is ALLOW. V2 may PROMOTE a structure-only V1 ASK to ALLOW when
	// every reachable AST branch is auto-approve eligible. Without
	// this composition, safe compound commands (e.g. `pwd; pwd`)
	// would never reach the V2 promotion gate.
	const risk = evaluateCommandRiskWithParser({
		toolInput,
		hostAuthorization,
		// Cast at the trust boundary. This function is a pure
		// host-policy function: it does NOT authenticate provenance
		// itself. The PROVENANCE INVARIANT is enforced by the
		// production call graph — `SdkController.ts` is the ONLY
		// entry point that constructs this value, and it awaits
		// `MvdanShHelper.invoke()` (whose digest + protocol version
		// + structural validation make it tamper-evident).
		// `unknown` keeps the V2 type identifier out of this host
		// source (the parser-provenance invariant forbids the
		// literal V2 type identifier in host source files).
		parserResult: options?.parserResult as never,
	})
	if (risk.disposition === "never-auto-approve") {
		// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
		// CORRECTION01: when R5 forces a downgrade (no obligation or
		// obligation was not honored), the executor-side flag is
		// `false`. The user is the gate.
		return {
			approved: false,
			decision: {
				kind: "ask",
				reason: "R5 catastrophic hard floor: never auto-approve",
				source: "risk_hard_floor",
			},
			executionPlan,
			mandatorySeatbeltExecution: false,
		}
	}

	// V2-aware ASK -> ALLOW promotion. Today this never fires because
	// parserResult is undefined (V2 dormant), but the structural seam
	// is here so the helper-binary ACT just has to drop in a parser
	// result. The `risk_v2_structured_promotion` source is the ONLY
	// path through which a V1 ASK may be promoted to ALLOW.
	//
	// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
	// CORRECTION02 Phase 2: build a real `CommandDecision` shape
	// (`kind: "allow" | "ask" | "deny"`, `source`, `reason`) instead
	// of casting the `RiskDecision`. The previous
	// `risk as unknown as CommandDecision` cast did NOT add a `kind`
	// field, so any consumer reading `decision.kind` would see
	// `undefined`. With V2 promotion actually firing, this matters.
	if (result.decision.kind === "ask" && risk.source === "risk_v2_structured_promotion" && risk.decision === "allow") {
		return {
			approved: true,
			decision: {
				kind: "allow",
				source: "risk_v2_structured_promotion",
				reason: risk.reasons.join("; "),
			},
			executionPlan,
			mandatorySeatbeltExecution: false,
		}
	}

	// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
	// CORRECTION01 (final-state projection): the executor-side flag
	// is `true` iff the canonical lattice emitted the conditional
	// source AND the R5 layer did NOT force a downgrade. The
	// executor reads this flag and refuses host-shell fallback.
	return {
		approved: result.decision.kind === "allow",
		decision: result.decision,
		executionPlan,
		mandatorySeatbeltExecution: result.decision.source === "host_mode_all_seatbelt_required",
	}
}

/**
 * Build a CommandExecutionPlan from an evaluated decision. The plan
 * carries the per-command hardened argv the executor must use, plus
 * provenance (matched rule source, profile source) for each command.
 * Kept for backwards compatibility with existing UI logic.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01:
 * This function MUST NOT be used for command tools. Command tools
 * require the typed `CommandHostAuthorization` flow via
 * `getCommandHostAuthorization` + `evaluateCommandToolApproval`.
 */
export function isToolAutoApproved(
	toolName: string,
	settings: AutoApprovalSettings,
	mcpHub?: McpHub,
	override: SessionAutoApprovalOverride = "none",
): boolean {
	if (isReadTool(toolName)) {
		return !!settings.actions.readFiles
	}
	if (isEditTool(toolName)) {
		return !!settings.actions.editFiles
	}
	if (isCommandTool(toolName)) {
		// Do NOT infer a boolean here. Use getCommandHostAuthorization
		// to get the typed host mode and pass through the policy.
		return !!settings.actions.executeSafeCommands
	}
	if (isBrowserTool(toolName)) {
		return !!settings.actions.useBrowser
	}

	const mcpTool = parseMcpToolName(toolName)
	if (mcpTool) {
		if (!mcpHub) {
			return false
		}
		const server = mcpHub.getServers().find((entry) => entry.name === mcpTool.serverName)
		const tool = server?.tools?.find((entry) => entry.name === mcpTool.toolName)
		// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03:
		// "ALL — this task" must project into ordinary MCP tool execution.
		// When the session override is active, lift the global `useMcp`
		// gate (resolveEffectiveAutoApproval already projects it true;
		// we keep this structural so a future caller that forgets to
		// pre-project cannot reintroduce ASK here) AND lift the
		// per-server/per-tool `autoApprove` flag. The tool still has to
		// exist on a known server — unknown server/tool pairs fall
		// through to false (the closest thing to a hard-DENY for MCP
		// today, and it must NOT be widened by the override).
		if (override === "all") {
			return !!tool
		}
		if (!settings.actions.useMcp) {
			return false
		}
		return !!tool?.autoApprove
	}

	return false
}
