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

import type {
	CommandExecutionPlan,
	CommandExecutionPlanEntry,
} from "@cline/shared";

import { normalizeRunCommandsInput } from "../../extensions/tools/helpers";
import type { StructuredCommandInput } from "../../extensions/tools/schemas";
import type { EvaluatedCommand } from "./command-policy-types";
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
		if (profile === undefined) {
			hardenedInputs.push(original);
			entries.push({
				commandIndex: i,
				hardenedCommand: toPlanCommand(original),
				matchedRuleSource: evaluated.matchedRuleSource,
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
		});
	}

	return {
		transformedInput: mirrorInputShape(toolInput, hardenedInputs),
		commands: entries,
	};
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
