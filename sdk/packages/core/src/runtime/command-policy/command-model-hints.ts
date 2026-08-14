/**
 * Model hint parsing for command-approval policy.
 *
 * ACT-CLINEMM-TOOL-COMMAND-APPROVAL-AUTHORITY01-CORRECTION02
 *
 * The model emits a `requires_approval` hint per command. The hint is
 * UNTRUSTED: it can only escalate, never weaken, host authority.
 *
 * Aggregation rule: ANY component hint = true  =>  effectiveEscalation = true.
 * Order-independent. A model that emits both true and false in the same call
 * cannot swallow the true.
 */

import type { NormalizedCommand } from "./command-policy-types";

/**
 * - true: this command wants approval
 * - false: this command does not want approval (host MAY ignore)
 * - undefined: not present or malformed (host MAY ignore)
 */
export type CommandModelHint = true | false | undefined;

export interface CommandModelHints {
	/**
	 * Per-command ordered list of hints. Multi-command aggregation rule:
	 *   ANY true => effective escalation = true
	 * Order-independent.
	 */
	perCommand: ReadonlyArray<CommandModelHint>;
	/**
	 * The aggregated effective escalation. true if ANY component is true.
	 * Cannot be weakened by setting `requires_approval=false` on another.
	 */
	effectiveEscalation: boolean;
}

/**
 * Parse `requires_approval` from a run_commands input shape.
 *
 * Walks every command in the input and returns one hint per command
 * plus the aggregated effective escalation.
 */
export function parseCommandModelHints(input: unknown): CommandModelHints {
	const hints: CommandModelHint[] = [];
	collectHints(input, hints);
	let effective = false;
	for (const h of hints) {
		if (h === true) {
			effective = true;
		}
	}
	return { perCommand: hints, effectiveEscalation: effective };
}

function collectHints(input: unknown, out: CommandModelHint[]): void {
	if (input == null) {
		return;
	}

	if (typeof input === "string") {
		out.push(undefined);
		return;
	}

	if (Array.isArray(input)) {
		for (const element of input) {
			collectHints(element, out);
		}
		return;
	}

	if (typeof input !== "object") {
		return;
	}

	const record = input as Record<string, unknown>;

	if ("command" in record || "args" in record) {
		out.push(extractHint(record));
	}

	if ("commands" in record && Array.isArray(record.commands)) {
		for (const element of record.commands) {
			collectHints(element, out);
		}
	}

	if ("cmd" in record) {
		collectHints(record.cmd, out);
	}
}

function extractHint(record: Record<string, unknown>): CommandModelHint {
	if ("requires_approval" in record) {
		const value = record.requires_approval;
		if (typeof value === "boolean") {
			return value;
		}
	}
	return undefined;
}

/**
 * Render a normalized command into a comparable string surface for rule
 * matching and safe-rule classification. Mirrors `formatRunCommandQuery()`
 * in `sdk/packages/core/src/extensions/tools/helpers.ts` but kept
 * dependency-free to avoid coupling the policy to the helper file.
 */
export function renderNormalizedCommand(cmd: NormalizedCommand): string {
	if (typeof cmd === "string") {
		return cmd;
	}
	const args = cmd.args ?? [];
	if (args.length === 0) {
		return cmd.command;
	}
	return `${cmd.command} ${args.join(" ")}`;
}
