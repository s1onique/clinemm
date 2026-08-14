/**
 * Command Approval Policy - Host Authority for Shell Command Execution
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01
 *
 * Architectural separation:
 */

// ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01:
// This module previously imported the canonical SDK normalizer
// (sdk/packages/core/src/extensions/tools/helpers.ts `normalizeRunCommandsInput`)
// from `@cline/core`. The canonical IS exposed via that path (see
// sdk/packages/core/src/extensions/tools/index.ts and src/index.ts
// exports added in this ACT). However, the bun:test workspace
// module loader used in this package does not always expose the
// export binding through `@cline/core` even though the function is
// present in dist/index.js. The wrapper below is hand-rolled and
// pinned to the canonical contract via command-policy.parity.test.ts.
//
// Future: when the test loader discrepancy is resolved, switch the
// wrapper to call the canonical normalizer and update parity tests
// to compare outputs instead of pinned expectations.

// =============================================================================
// Types
// =============================================================================

/**
 * Command Approval Policy - Host Authority for Shell Command Execution
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01
 *
 * This module composes the explicit host authorization that the host
 * genuinely possesses (user chose "execute all commands" / "YOLO" / "auto-approve all")
 * with the model-provided `requires_approval` hint (advisory escalation only).
 *
 * PRIMARY INVARIANT:
 *   effectiveDecision >= hostDecision
 *   where restrictiveness: ALLOW < ASK < DENY
 *
 * The model may ONLY ESCALATE. It can never downgrade ASK or DENY.
 *
 * The host does NOT maintain a complete shell-command semantic classifier.
 * Therefore the host can only legitimately ALLOW when the user has explicitly
 * granted unrestricted command execution. The "execute safe commands" toggle
 * does NOT by itself grant ALLOW — it requires the host to actually know
 * the command is safe, which we cannot prove for arbitrary shell input.
 *
 * What the host CAN do:
 *   - Recognize explicit user "execute all commands" / YOLO mode (=> ALLOW)
 *   - Recognize explicit user "execute safe commands" toggle (=> ASK when command
 *     cannot be proven safe; the host does not pretend to know safety)
 *   - Recognize a hard DENY (if such a future policy exists)
 *   - Recognize escalation from model (=> ASK)
 *
 * What the host CANNOT do:
 *   - Infer safety from an executable name being "common"
 *   - Infer safety from "no dangerous pattern was matched"
 *   - Trust the model saying `requires_approval=false`
 */

// =============================================================================
// Types
// =============================================================================

/**
 * The host's command mode is the authoritative source of auto-approval.
 * It is NOT a boolean. It is a typed expression of explicit user intent.
 *
 * - "manual": no host auto-apply. Default. Every command requires approval.
 * - "safe-only": user has enabled "execute safe commands" toggle. The host
 *   does NOT have a complete safe classifier; we treat this as ASK for any
 *   command unless the host can prove safety through other means.
 *   (This is the conservative, truthful semantic. If the CLI/UI allows a
 *   broader interpretation, it must encode it in a distinct mode.)
 * - "all": user has explicitly enabled "execute all commands" / YOLO /
 *   `--auto-approve` / `autoApproveTools: true`. The host delegates ALLOW
 *   to the user. The model can still escalate to ASK.
 */
export type CommandHostMode = "manual" | "safe-only" | "all"

/**
 * Decision kinds, ordered by restrictiveness.
 */
export type CommandDecisionKind = "allow" | "ask" | "deny"

const RESTRICTIVENESS: Record<CommandDecisionKind, number> = {
	allow: 0,
	ask: 1,
	deny: 2,
}

export function isMoreRestrictive(a: CommandDecisionKind, b: CommandDecisionKind): boolean {
	return RESTRICTIVENESS[a] > RESTRICTIVENESS[b]
}

export function maxRestrictive(a: CommandDecisionKind, b: CommandDecisionKind): CommandDecisionKind {
	return RESTRICTIVENESS[a] >= RESTRICTIVENESS[b] ? a : b
}

/**
 * Source of the decision, retained for diagnostics.
 * IMPORTANT: `host_safe` is NOT a valid source. Safety is not a host
 * authority this code claims to possess. We either have explicit user
 * "all" mode, or we ask.
 */
export type CommandDecisionSource =
	| "host_mode_all" // User enabled "execute all commands"
	| "host_mode_safe_only" // User enabled "execute safe commands" (still ASK)
	| "host_mode_manual" // No auto-approve
	| "host_hard_deny" // Future: explicit host deny rule
	| "model_escalation" // Model says requires_approval=true
	| "unknown_input" // Command input could not be normalized

export interface CommandDecision {
	kind: CommandDecisionKind
	reason: string
	source: CommandDecisionSource
}

/**
 * Authorization context the host actually possesses.
 * Replaces a single boolean `autoApproveEnabled`, which collapses
 * distinct product semantics.
 */
export interface CommandHostAuthorization {
	mode: CommandHostMode
	/**
	 * Optional explicit host deny rules (future). When set, any command
	 * matching these patterns is DENY unconditionally. The model cannot
	 * override a deny.
	 *
	 * Today this is ABSENT from production (no production deny source).
	 * Tests can inject rules to validate the lattice.
	 */
	explicitDenyRules?: ReadonlyArray<{ source: string; pattern: RegExp }>
	/**
	 * Optional explicit host allow rules (future). When a command matches
	 * one of these, the host can legitimately return ALLOW because the user
	 * (or a trusted host policy plugin) explicitly authorized it.
	 *
	 * Today this is ABSENT from production. This is the missing piece a
	 * future "execute safe commands" rules engine would supply.
	 *
	 * The unit tests inject a synthetic `unit_test_safe` rule to prove
	 * the lattice with explicit host sources.
	 */
	explicitAllowRules?: ReadonlyArray<{ source: string; pattern: RegExp }>
}

/**
 * Strict-mode constructor for host authorization.
 * The "mode" is the only legitimate host authority for shell commands today.
 */
export function commandHostAuthorization(params: {
	mode: CommandHostMode
	explicitDenyRules?: ReadonlyArray<{ source: string; pattern: RegExp }>
	explicitAllowRules?: ReadonlyArray<{ source: string; pattern: RegExp }>
}): CommandHostAuthorization {
	return {
		mode: params.mode,
		explicitDenyRules: params.explicitDenyRules,
		explicitAllowRules: params.explicitAllowRules,
	}
}

// =============================================================================
// Model Hint Parsing
// =============================================================================

/**
 * A model requires_approval hint, per command.
 * - true: this command wants approval
 * - false: this command does not want approval (host MAY ignore)
 * - undefined: not present or malformed (host MAY ignore)
 */
export type CommandModelHint = true | false | undefined

export interface CommandModelHints {
	/**
	 * Per-command ordered list of hints. Multi-command aggregation rule:
	 *   ANY true => effective escalation = true
	 * Order-independent.
	 */
	perCommand: ReadonlyArray<CommandModelHint>
	/**
	 * The aggregated effective escalation. true if ANY component is true.
	 * Cannot be weakened by setting `requires_approval=false` on another.
	 */
	effectiveEscalation: boolean
}

/**
 * Parse `requires_approval` from a run_commands input shape.
 *
 * Peer to canonical normalizeRunCommandsInput, but for the model hint.
 * Walks every command in the input and returns one hint per command
 * plus the aggregated effective escalation.
 *
 * The hint is UNTRUSTED. Aggregation guarantees a model cannot swallow
 * a true by emitting both true and false in the same call.
 */
export function parseCommandModelHints(input: unknown): CommandModelHints {
	const hints: CommandModelHint[] = []
	collectHints(input, hints)
	let effective = false
	for (const h of hints) {
		if (h === true) {
			effective = true
		}
	}
	return { perCommand: hints, effectiveEscalation: effective }
}

function collectHints(input: unknown, out: CommandModelHint[]): void {
	if (input == null) {
		return
	}

	if (typeof input === "string") {
		// A bare string command has no per-command hint.
		out.push(undefined)
		return
	}

	if (Array.isArray(input)) {
		for (const element of input) {
			collectHints(element, out)
		}
		return
	}

	if (typeof input !== "object") {
		return
	}

	const record = input as Record<string, unknown>

	// Singular command: process as one component.
	if ("command" in record || "args" in record) {
		out.push(extractHint(record))
		// Continue scanning for nested `commands` arrays below.
	}

	// Array of commands.
	if ("commands" in record && Array.isArray(record.commands)) {
		for (const element of record.commands) {
			collectHints(element, out)
		}
	}

	if ("cmd" in record) {
		// Legacy alias.
		collectHints(record.cmd, out)
	}
}

function extractHint(record: Record<string, unknown>): CommandModelHint {
	if ("requires_approval" in record) {
		const value = record.requires_approval
		if (typeof value === "boolean") {
			return value
		}
	}
	return undefined
}

// =============================================================================
// Command Normalization (canonical decomposition)
// =============================================================================

/**
 * A normalized command representation. `string` is the simple form;
 * `StructuredCommandInput` is the structured form used by the
 * canonical SDK normalizer.
 */
export type NormalizedCommand = string | StructuredCommandInput

export interface StructuredCommandInput {
	command: string
	args?: string[]
	cwd?: string
	continue_on_error?: boolean
}

export interface NormalizedCommands {
	commands: NormalizedCommand[]
	ok: true
}

/**
 * Strict normalization that mirrors the canonical
 * sdk/packages/core/src/extensions/tools/helpers.ts `normalizeRunCommandsInput`.
 *
 * Returns NO commands (with ok=true) when the input is structurally valid
 * but empty. Returns the failure shape otherwise.
 *
 * The unit tests pin this to the canonical implementation's behavior
 * via the parity test in command-policy.parity.test.ts.
 */
export function normalizeCommandInput(
	input: unknown,
): { ok: true; commands: NormalizedCommand[] } | { ok: false; reason: string } {
	// ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION01:
	// This wrapper mirrors the canonical SDK normalizer at
	// sdk/packages/core/src/extensions/tools/helpers.ts (`normalizeRunCommandsInput`).
	// Both are exported; the canonical is now reachable via
	// `@cline/core`. The wrapper below is hand-rolled because:
	//
	// 1. The canonical normalizer is bundled with the SDK and `bun:test`
	//    in some configurations does not expose the export binding
	//    through the workspace module path. Production paths that import
	//    `@cline/core` directly (CLI, JetBrains) work correctly; only
	//    the test runner exhibits this discrepancy.
	// 2. The wrapper adds an `ok` flag for the security boundary
	//    (distinguishing parse failure from empty input).
	//
	// The parity test (command-policy.parity.test.ts) pins this
	// wrapper's behavior to the canonical's documented contract. If
	// the canonical is ever updated, update the parity test AND this
	// wrapper together.

	if (input == null) {
		return { ok: false, reason: "input is null/undefined" }
	}

	if (typeof input === "string") {
		if (input.length === 0) {
			return { ok: false, reason: "empty command string" }
		}
		return { ok: true, commands: [input] }
	}

	if (Array.isArray(input)) {
		const out: NormalizedCommand[] = []
		for (const element of input) {
			if (typeof element === "string") {
				if (element.length === 0) {
					return { ok: false, reason: "empty command element in array" }
				}
				out.push(element)
			} else if (
				element &&
				typeof element === "object" &&
				typeof (element as StructuredCommandInput).command === "string"
			) {
				out.push(element as StructuredCommandInput)
			} else {
				return { ok: false, reason: "unparseable command element in array" }
			}
		}
		if (out.length === 0) {
			return { ok: false, reason: "empty command array" }
		}
		return { ok: true, commands: out }
	}

	if (typeof input !== "object") {
		return { ok: false, reason: "input is not an object nor string" }
	}

	const record = input as Record<string, unknown>

	if ("commands" in record && Array.isArray(record.commands)) {
		const out: NormalizedCommand[] = []
		for (const element of record.commands) {
			if (typeof element === "string") {
				if (element.length === 0) {
					return { ok: false, reason: "empty command element in commands array" }
				}
				out.push(element)
			} else if (
				element &&
				typeof element === "object" &&
				typeof (element as StructuredCommandInput).command === "string"
			) {
				out.push(element as StructuredCommandInput)
			} else {
				return { ok: false, reason: "unparseable command element in commands array" }
			}
		}
		if (out.length === 0) {
			return { ok: false, reason: "empty commands array" }
		}
		return { ok: true, commands: out }
	}

	if ("command" in record) {
		const cmd = record.command
		if (typeof cmd === "string") {
			if (cmd.length === 0) {
				return { ok: false, reason: "empty command field" }
			}
			if ("args" in record && Array.isArray(record.args)) {
				return {
					ok: true,
					commands: [
						{
							command: cmd,
							args: (record.args as unknown[]).map((a) => String(a)),
						},
					],
				}
			}
			return { ok: true, commands: [cmd] }
		}
		if (cmd && typeof cmd === "object" && typeof (cmd as StructuredCommandInput).command === "string") {
			return { ok: true, commands: [cmd as StructuredCommandInput] }
		}
		return { ok: false, reason: "command field is not a string or structured object" }
	}

	if ("cmd" in record) {
		if (typeof record.cmd === "string") {
			if (record.cmd.length === 0) {
				return { ok: false, reason: "empty cmd field" }
			}
			return { ok: true, commands: [record.cmd] }
		}
		return { ok: false, reason: "cmd field is not a string" }
	}

	if (typeof record.command === "string" && "args" in record && Array.isArray(record.args)) {
		return {
			ok: true,
			commands: [
				{
					command: record.command,
					args: (record.args as unknown[]).map((a) => String(a)),
				},
			],
		}
	}

	return { ok: false, reason: "input does not match any known command shape" }
}
// Policy Composition
// =============================================================================

export interface EvaluateCommandPolicyInput {
	toolInput: unknown
	hostAuthorization: CommandHostAuthorization
}

export interface EvaluateCommandPolicyResult {
	decision: CommandDecision
	normalized: NormalizedCommand[]
	modelHints: CommandModelHints
}

/**
 * Compose the final command decision.
 *
 * Composition rule (monotonic):
 *   decision = host_base.max_restrictive(model_escalation)
 *
 * Steps:
 *   1. Normalize the input. Failure => ASK (source: unknown_input).
 *   2. Resolve host base from explicit host authorization.
 *      - "all" mode => ALLOW (the user granted unrestricted authority)
 *      - explicit deny rules (if any) => DENY (highest priority)
 *      - explicit allow rules (if any) => ALLOW
 *      - "safe-only" => ASK (host does not pretend to know safety)
 *      - "manual"  => ASK
 *   3. Apply model hint escalation ONLY.
 *      - model_escalation=true  => at least ASK
 *      - model_escalation=false => no weakening
 *      - missing/malformed      => no weakening
 */
export function evaluateCommandPolicy(input: EvaluateCommandPolicyInput): EvaluateCommandPolicyResult {
	// 1. Normalize input.
	const normalized = normalizeCommandInput(input.toolInput)
	if (!normalized.ok) {
		const decision: CommandDecision = {
			kind: "ask",
			reason: `unable to parse command: ${normalized.reason}`,
			source: "unknown_input",
		}
		return {
			decision,
			normalized: [],
			modelHints: parseCommandModelHints(input.toolInput),
		}
	}

	// 2. Host base decision.
	const hostBase = resolveHostBase(normalized.commands, input.hostAuthorization)

	// 3. Model hint aggregation.
	const modelHints = parseCommandModelHints(input.toolInput)

	// 4. Compose monotonically.
	let finalKind: CommandDecisionKind = hostBase.kind
	let finalReason = hostBase.reason
	let finalSource = hostBase.source

	if (modelHints.effectiveEscalation && finalKind === "allow") {
		finalKind = "ask"
		finalReason = `${hostBase.reason} (model requested approval)`
		finalSource = "model_escalation"
	}

	return {
		decision: {
			kind: finalKind,
			reason: finalReason,
			source: finalSource,
		},
		normalized: normalized.commands,
		modelHints,
	}
}

function resolveHostBase(commands: NormalizedCommand[], auth: CommandHostAuthorization): CommandDecision {
	// Explicit deny rules win absolutely.
	if (auth.explicitDenyRules && auth.explicitDenyRules.length > 0) {
		for (const cmd of commands) {
			const rendered = renderCommand(cmd)
			for (const rule of auth.explicitDenyRules) {
				if (rule.pattern.test(rendered)) {
					return {
						kind: "deny",
						reason: `host deny rule matched: ${rule.source}`,
						source: "host_hard_deny",
					}
				}
			}
		}
	}

	// Explicit allow rules (future-safe-only semantics).
	if (auth.explicitAllowRules && auth.explicitAllowRules.length > 0) {
		// ONLY allow if ALL commands match an allow rule. Otherwise ASK
		// (the user only authorized a subset of operations).
		let allMatched = true
		if (commands.length === 0) {
			allMatched = false
		}
		for (const cmd of commands) {
			const rendered = renderCommand(cmd)
			let matched = false
			for (const rule of auth.explicitAllowRules) {
				if (rule.pattern.test(rendered)) {
					matched = true
					break
				}
			}
			if (!matched) {
				allMatched = false
				break
			}
		}
		if (allMatched) {
			return {
				kind: "allow",
				reason: "all commands matched explicit host allow rules",
				source: "host_mode_safe_only",
			}
		}
		// Fall through to the mode-based resolution.
	}

	// Mode-based resolution.
	switch (auth.mode) {
		case "all":
			return {
				kind: "allow",
				reason: "user enabled execute-all-commands mode",
				source: "host_mode_all",
			}
		case "safe-only":
			// Host does not possess a complete safe classifier.
			// "safe-only" without explicit allow rules => ASK.
			return {
				kind: "ask",
				reason: "safe-only mode requires explicit host allow rules",
				source: "host_mode_safe_only",
			}
		case "manual":
		default:
			return {
				kind: "ask",
				reason: "manual mode requires approval",
				source: "host_mode_manual",
			}
	}
}

function renderCommand(cmd: NormalizedCommand): string {
	if (typeof cmd === "string") {
		return cmd
	}
	const args = cmd.args ?? []
	if (args.length === 0) {
		return cmd.command
	}
	return `${cmd.command} ${args.join(" ")}`
}
