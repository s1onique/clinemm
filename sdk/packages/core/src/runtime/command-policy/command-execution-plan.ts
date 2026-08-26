/**
 * Command Execution Plan Builder (CORRECTION04)
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION04
 *
 * Owns the canonical CommandExecutionPlan construction. Both the CLI and
 * VS Code host adapters MUST call `buildCommandExecutionPlan()` here; the
 * plan shape (and the per-command SafeExecutionProfile application) is
 * security-critical duplicated semantics and must not diverge across
 * hosts.
 *
 * The output is a structured execution envelope:
 *   - `transformedInput` is the input the executor must run instead of
 *     the raw model input. The runtime contract (AgentRuntime) uses this
 *     when present; there is no fallback to raw input when a plan exists.
 *   - `commands[]` is per-command provenance: hardened argv, matched rule
 *     source, profile source. Telemetry/audit/debug consumers only; the
 *     executor MUST use `transformedInput` for execution.
 */

import { realpathSync } from "node:fs";
import type {
	CommandExecutionPlan,
	CommandExecutionPlanEntry,
} from "@cline/shared";

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import type {
	CommandHostAuthorization,
	EvaluatedCommand,
} from "./command-policy-types";
import { buildFilesystemCreateOnlyCapabilityForCommand } from "./command-policy-types";
import { applySafeExecutionProfileToCommand } from "./safe-execution-profile";

/**
 * Build a CommandExecutionPlan from the original tool input and the
 * canonical policy's per-command evaluated decisions. Returns undefined
 * when the input cannot be normalized, is empty, or the cardinality
 * of per-command decisions does not match the normalized input.
 *
 * Cardinality invariant:
 *   normalized.length === perCommand.length
 * A mismatch is treated as an invariant violation: it indicates that
 * the canonical policy failed to evaluate one or more commands and the
 * caller is asking us to construct a partially-unevaluated execution
 * plan. We fail closed (return undefined) rather than ship a plan that
 * includes unhardened commands. The host MUST treat undefined as
 * "no execution constraint can be safely attached".
 *
 * The function mirrors the original input shape:
 *   - string input          -> string[] transformedInput (canonical
 *                              normalizer wraps bare strings)
 *   - { command, args? }    -> { command, args? } transformedInput
 *   - { commands: [...] }   -> { commands: [...] } transformedInput
 *   - string[]              -> string[] transformedInput
 *   - mixed arrays          -> the array form
 *
 * For StructuredCommandInput, the rewrite operates directly on the typed
 * `args` array; the renderer/string-splitter is NEVER consulted. This
 * preserves argv boundaries even when args contain spaces or quotes.
 */
export function buildCommandExecutionPlan(
	toolInput: unknown,
	perCommand: ReadonlyArray<EvaluatedCommand>,
	/**
	 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
	 * CORRECTION03 (production grant seam):
	 *
	 * The host authorization carrying the evidence required to
	 * decide whether a plan entry qualifies for a real
	 * `FilesystemCreateOnlyCapability` (currently: darwin
	 * mktemp). When present and the four-condition gate passes,
	 * the matching entry's `executionCapability` field is set
	 * and the capability travels WITH the plan entry to the
	 * executor-boundary stamping in executeShellCommands.
	 *
	 * Optional: omitting it (e.g. host adapters that have not
	 * yet collected darwin mktemp evidence) preserves the
	 * existing plan shape — no entries carry executionCapability
	 * — but the tool flow then cannot use Seatbelt's
	 * create-only authority for mktemp.
	 */
	hostAuthorization?: CommandHostAuthorization,
): CommandExecutionPlan | undefined {
	let normalized: ReadonlyArray<string | StructuredCommandInput>;
	try {
		normalized = normalizeRunCommandsInput(toolInput);
	} catch {
		return undefined;
	}
	if (normalized.length === 0) {
		return undefined;
	}
	// Fail closed on cardinality mismatch. A safe-rule-matched command
	// without a per-command decision means the policy couldn't classify
	// it, so we cannot construct a hardened plan for it.
	if (normalized.length !== perCommand.length) {
		return undefined;
	}

	const entries: CommandExecutionPlanEntry[] = [];
	const hardenedInputs: Array<string | StructuredCommandInput> = [];

	for (let i = 0; i < normalized.length; i++) {
		const original = normalized[i]!;
		const evaluated = perCommand[i]!;
		const profile = evaluated.safeExecutionProfile;

		// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
		// CORRECTION03: derive the real per-command capability from
		// the policy decision + host authorization. The helper is
		// pure; it consumes only the matched rule source, the host
		// evidence, and the canonicalized argv of THIS entry (not
		// the original model input — we trust the normalized/hardened
		// argv). When the gate passes, the capability travels WITH
		// the plan entry; when it fails, the entry's
		// `executionCapability` remains undefined (no widening).
		// CORRECTION04 narrowing: gate the resolveExecutableRealpath
		// call (a realpathSync() filesystem probe) behind the mktemp
		// matched-rule source. The helper's gate 3 only consults
		// `resolvedExecutableRealpath` when the matched rule is
		// host_safe_mktemp_default_temp; for ALL other commands the
		// resolved argv would be discarded by the helper's early
		// return on the wrong rule source, making the realpath probe
		// pure host-side filesystem work that achieves nothing.
		let executionCapability: CommandExecutionPlanEntry["executionCapability"];
		if (
			hostAuthorization !== undefined &&
			evaluated.matchedRuleSource === "host_safe_mktemp_default_temp"
		) {
			const resolvedExec = resolveExecutableRealpath(original);
			const cap = buildFilesystemCreateOnlyCapabilityForCommand({
				evaluated,
				hostAuthorization,
				resolvedExecutableRealpath: resolvedExec,
			});
			executionCapability = cap;
		}

		if (profile === undefined) {
			hardenedInputs.push(original);
			entries.push({
				commandIndex: i,
				hardenedCommand: toPlanCommand(original),
				matchedRuleSource: evaluated.matchedRuleSource,
				executionCapability,
			});
			continue;
		}
		const hardened = applySafeExecutionProfileToCommand(original, profile);
		hardenedInputs.push(hardened);
		entries.push({
			commandIndex: i,
			hardenedCommand: toPlanCommand(hardened),
			matchedRuleSource: evaluated.matchedRuleSource,
			profileSource: profile.source,
			executionCapability,
		});
	}

	return {
		transformedInput: mirrorInputShape(toolInput, hardenedInputs),
		commands: entries,
	};
}

/**
 * Resolve the executable argv[0] of a normalized command to its
 * host-PATH-resolved canonical path. Returns undefined when the
 * command is structured (no string argv[0] to realpath), when the
 * path does not exist (the file would be unrunnable anyway), or
 * when realpathSync throws (sandbox restriction at probe time
 * is treated as "no authority granted" rather than "any
 * authority granted").
 *
 * The call is intentionally narrow — only the executable token
 * is canonicalized, NOT the full argv or any operand. This
 * matches the host's policy gate, which keys on
 * `executableRealpath === "/usr/bin/mktemp"`.
 */
function resolveExecutableRealpath(
	cmd: string | StructuredCommandInput,
): string | undefined {
	const argv0 = typeof cmd === "string" ? cmd.split(/\s+/)[0] : cmd.command;
	if (!argv0) return undefined;
	try {
		return realpathSync(argv0);
	} catch {
		return undefined;
	}
}

function toPlanCommand(
	command: string | StructuredCommandInput,
): string | Record<string, unknown> {
	if (typeof command === "string") {
		return command;
	}
	return { command: command.command, args: command.args ?? [] };
}

function mirrorInputShape(
	original: unknown,
	hardened: ReadonlyArray<string | StructuredCommandInput>,
): unknown {
	if (original === null || original === undefined) {
		return original;
	}
	if (Array.isArray(original)) {
		return hardened;
	}
	if (typeof original === "object") {
		const obj = original as Record<string, unknown>;
		if ("command" in obj && typeof obj.command === "string") {
			const first = hardened[0];
			if (first === undefined) {
				return original;
			}
			if (typeof first === "string") {
				return { ...obj, command: first };
			}
			return {
				...obj,
				command: first.command,
				args: first.args ?? [],
			};
		}
		if ("commands" in obj) {
			return { ...obj, commands: hardened };
		}
	}
	return hardened;
}
