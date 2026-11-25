/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * Host-side classification of a `run_commands` call into INSPECTION versus
 * EXECUTION, for the runtime's execution-stagnation recovery.
 *
 * WHY THIS LIVES IN THE HOST
 * --------------------------
 * The runtime CANNOT make this judgement: a `run_commands` input carries
 * arbitrary shell text, and reading that text to decide "did this make
 * progress?" is exactly the provider-specific string matching this
 * repository forbids. The HOST owns the command-policy layer
 * (`command-guard.ts`), the tool-mechanism classifier
 * (`tool-mechanism-classifier.ts`) and the per-command approval plan, so
 * the HOST is the layer that legitimately knows whether a command was a
 * read-only inspection or a real execution.
 *
 * The runtime therefore accepts this classification through the
 * `ExecutionStagnationPolicy.classifyToolCall` hook and never guesses.
 *
 * WHAT THIS MODULE DOES
 * ---------------------
 * A small, explicit, centralized normalizer:
 *
 *   - a command whose PROGRAM is a known INSPECTION program (git log, git
 *     show, git status, git diff, grep, rg, ls, cat, sed -n, head, tail,
 *     find without -delete, wc, which, echo, pwd, tree, ...) is an
 *     INSPECTION;
 *   - a command that is a MUTATION (writes a file, installs, commits,
 *     stages, ...) is an EXECUTION of the deliverable — it changed
 *     something;
 *   - anything else — a test run, a build, a probe, an unknown program —
 *     is an EXECUTION, because running it produced EXECUTABLE EVIDENCE.
 *
 * The default is deliberately "executed": the runtime must not declare a
 * stall on the basis of an unrecognised command. Only a positively
 * recognised inspection is excluded from progress.
 */
import type { ExecutionStagnationPolicy } from "@cline/shared";
import { findFileEditingCommand } from "./command-guard";

/**
 * The program names (the FIRST token of a command) that are recognised as
 * pure INSPECTION.
 *
 * These are programs whose entire purpose is to READ state: they do not
 * build, test, install, or produce a deliverable. The list is explicit and
 * closed — an unrecognised program is never treated as inspection.
 */
const INSPECTION_PROGRAMS: ReadonlySet<string> = new Set([
	"cat",
	"echo",
	"file",
	"find",
	"git",
	"grep",
	"head",
	"ls",
	"nl",
	"od",
	"printenv",
	"pwd",
	"rg",
	"sed",
	"stat",
	"tail",
	"tree",
	"type",
	"wc",
	"which",
	"whoami",
]);

/**
 * The `git` SUBCOMMANDS that are pure inspection.
 *
 * `git stash`, `git commit`, `git checkout`, `git reset` etc. mutate the
 * repository and are therefore EXECUTION, not inspection.
 */
const INSPECTION_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"blame",
	"cat-file",
	"diff",
	"grep",
	"log",
	"ls-files",
	"ls-tree",
	"rev-list",
	"rev-parse",
	"shortlog",
	"show",
	"show-ref",
	"status",
	"tag",
	"whatchanged",
]);

/**
 * Wrapper programs that only invoke the command that follows them, and the
 * number of ARGUMENTS each wrapper consumes before the wrapped command.
 *
 * `timeout 180 git log` — `timeout` takes a duration argument, then the
 * wrapped command. `sudo -u root git log` — `sudo` takes flags and their
 * values, then the wrapped command.
 */
const WRAPPER_PROGRAMS: ReadonlyMap<string, number> = new Map([
	["sudo", -1],
	["doas", -1],
	["env", -1],
	["command", 0],
	["builtin", 0],
	["nohup", 0],
	["time", 0],
	["nice", 0],
	["stdbuf", -1],
	["timeout", 1],
	["xargs", -1],
]);

/**
 * Split a command string into its simple-command segments.
 *
 * The split is QUOTE- and ESCAPE-aware: a `|` inside a quoted argument (for
 * example the grep pattern `"type: \"done\"\|type: 'done'"`) is part of the
 * argument, not a command separator. Splitting it would fragment the
 * command and misclassify a read-only inspection.
 */
function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaped = false;
	for (const char of command) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			current += char;
			escaped = true;
			continue;
		}
		if (quote !== undefined) {
			current += char;
			if (char === quote) {
				quote = undefined;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			current += char;
			quote = char;
			continue;
		}
		if (
			char === "\n" ||
			char === ";" ||
			char === "|" ||
			char === "&" ||
			char === "(" ||
			char === ")"
		) {
			segments.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	segments.push(current);
	return segments
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

/**
 * Strip the wrapper programs from a command segment's tokens, returning the
 * program name and its arguments.
 *
 * A wrapper whose argument count is `-1` consumes every leading FLAG and
 * the value that follows a flag that takes one, up to the wrapped command.
 */
function unwrap(tokens: string[]): { program: string; args: string[] } {
	let index = 0;
	while (index < tokens.length) {
		const base = tokens[index].split("/").pop()?.toLowerCase() ?? "";
		const arity = WRAPPER_PROGRAMS.get(base);
		if (arity === undefined) {
			break;
		}
		index += 1;
		if (arity < 0) {
			// Consume leading flags (and the value of a flag that takes one)
			// until the wrapped command is reached.
			while (index < tokens.length) {
				const candidate = tokens[index];
				if (!candidate.startsWith("-")) {
					break;
				}
				index += 1;
				// `--flag=value` carries its own value; `--flag value` needs
				// the next token consumed.
				if (!candidate.includes("=") && index < tokens.length) {
					const next = tokens[index];
					if (!next.startsWith("-")) {
						index += 1;
					}
				}
			}
			continue;
		}
		index += arity;
	}
	const program = tokens[index]?.split("/").pop()?.toLowerCase() ?? "";
	return { program, args: tokens.slice(index + 1) };
}

/**
 * Whether ONE command segment is a pure inspection.
 */
function segmentIsInspection(segment: string): boolean {
	const tokens = segment.split(/\s+/).filter(Boolean);
	const { program, args } = unwrap(tokens);
	if (program.length === 0) {
		return false;
	}
	// `cd <dir>` only changes the shell's working directory: it is setup,
	// not work. It is always an inspection segment.
	if (program === "cd") {
		return true;
	}
	if (program === "git") {
		const subcommand = args[0]?.toLowerCase();
		return (
			subcommand !== undefined && INSPECTION_GIT_SUBCOMMANDS.has(subcommand)
		);
	}
	if (!INSPECTION_PROGRAMS.has(program)) {
		return false;
	}
	// `sed -i` edits in place; `find -delete` deletes. Neither is
	// inspection. The existing command guard already knows how to detect
	// file-modifying constructs, so it is the authority for that question.
	if (findFileEditingCommand(segment) !== undefined) {
		return false;
	}
	return true;
}

/**
 * Whether a whole `run_commands` input is a pure INSPECTION.
 *
 * A command list is an inspection only when EVERY segment in it is an
 * inspection. One real execution in the list makes the whole call an
 * execution.
 */
export function isInspectionCommandInput(input: unknown): boolean {
	const record = (input ?? {}) as { commands?: unknown };
	const commands = record.commands;
	if (!Array.isArray(commands) || commands.length === 0) {
		return false;
	}
	let sawSegment = false;
	for (const command of commands) {
		if (typeof command !== "string") {
			// A structured argv command is not an inspection by default.
			return false;
		}
		for (const segment of splitSegments(command)) {
			sawSegment = true;
			if (!segmentIsInspection(segment)) {
				return false;
			}
		}
	}
	return sawSegment;
}

/**
 * Build the host-side `classifyToolCall` hook for the runtime's
 * execution-stagnation recovery policy.
 *
 * The hook classifies a `run_commands` call as INSPECTION when every
 * command in it is a recognised inspection program, and defers to the
 * runtime (`undefined`) for every other tool, so the runtime keeps its own
 * structural classification for reads and edits.
 */
export function createHostExecutionProgressClassifier(): NonNullable<
	ExecutionStagnationPolicy["classifyToolCall"]
> {
	return (toolName, input, result) => {
		if (toolName !== "run_commands") {
			return undefined;
		}
		if (result?.isError === true) {
			// A failed command produced no evidence either way; let the
			// runtime's own classification decide.
			return undefined;
		}
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01):
		// a FAILED observation is declined too.
		//
		// The production `command_status` snapshot of a job that failed
		// carries the observed exit code and the terminal state. The host
		// classifier must not claim an INSPECTION verdict about a command
		// that failed: the failed command did not read anything, it ran
		// and failed. The runtime's own structural reading governs.
		if (observationReportsFailure(result?.output)) {
			return undefined;
		}
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01):
		// a command that is STILL RUNNING is not an inspection and not an
		// execution — it is a LEGITIMATE WAIT, and the runtime's own
		// structural classifier owns that reading.
		//
		// Returning "executed" here would OVERRIDE the runtime's "awaiting"
		// verdict and manufacture a false progress signal for a job that
		// has not produced any evidence yet.
		//
		// The marker is a DATA-SHAPE fact about the observation (the
		// explicit `status` / `state` / `commandExecutionDisposition` fields
		// and the `isRunning` / `stillRunning` flags), never a prose read.
		if (observationReportsStillRunning(result?.output)) {
			return undefined;
		}
		return isInspectionCommandInput(input) ? "inspected" : "executed";
	};
}

/**
 * Whether an observation carries the explicit "still running" marker.
 *
 * The marker is read from the EXPLICIT fields only — the same fields the
 * runtime's own structural classifier reads — and through BOTH the single
 * operation-result shape and the production array envelope
 * (`ToolOperationResult[]`), because the production tools return their
 * result as an array and the marker lives on the ENTRY.
 *
 * No prose is parsed: a command whose output merely mentions "running" is
 * not treated as still running by this function.
 */
function observationReportsStillRunning(output: unknown): boolean {
	if (typeof output === "string") {
		// The production `run_commands` RUNNING envelope is a JSON STRING.
		// It is parsed as JSON and read structurally; a non-JSON string is
		// not a still-running observation.
		try {
			return observationReportsStillRunning(JSON.parse(output));
		} catch {
			return false;
		}
	}
	if (!output || typeof output !== "object") {
		return false;
	}
	const record = output as Record<string, unknown>;
	for (const key of ["status", "state", "commandExecutionDisposition"]) {
		const marker = record[key];
		if (typeof marker === "string") {
			const normalized = marker.toLowerCase();
			if (
				normalized === "running" ||
				normalized === "backgrounded" ||
				normalized === "still_running" ||
				normalized === "in_progress"
			) {
				return true;
			}
		}
	}
	if (record.isRunning === true || record.stillRunning === true) {
		return true;
	}
	if (Array.isArray(output)) {
		for (const entry of output) {
			if (observationReportsStillRunning(entry)) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Whether an observation reports a FAILED command.
 *
 * The failure is read from the EXPLICIT fields the production tools set:
 * the observed `exitCode` (a non-zero code is a failure) and the `ok` flag
 * (false is a failure). No prose is parsed.
 *
 * The production `command_status` snapshot of a failed job carries
 * `{ ok: true, state: "exited", exitCode: 1 }` — the `exitCode` is the
 * authoritative failure evidence.
 */
function observationReportsFailure(output: unknown): boolean {
	if (typeof output === "string") {
		try {
			return observationReportsFailure(JSON.parse(output));
		} catch {
			return false;
		}
	}
	if (!output || typeof output !== "object") {
		return false;
	}
	const record = output as Record<string, unknown>;
	if (record.ok === false) {
		return true;
	}
	if (typeof record.exitCode === "number" && record.exitCode !== 0) {
		return true;
	}
	if (Array.isArray(output)) {
		for (const entry of output) {
			if (observationReportsFailure(entry)) {
				return true;
			}
		}
	}
	return false;
}
