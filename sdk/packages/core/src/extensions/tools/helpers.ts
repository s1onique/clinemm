import { validateWithZod } from "@cline/shared";
import type { z } from "zod";
import {
	type EditFileInput,
	INPUT_ARG_CHAR_LIMIT,
	type ReadFileRequest,
	RunCommandsInputSchema,
	RunCommandsInputUnionSchema,
	type StructuredCommandInput,
} from "./schemas";

/**
 * Format an error into a string message
 */
export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export function getEditorSizeError(input: EditFileInput): string | null {
	if (
		typeof input.old_text === "string" &&
		input.old_text.length > INPUT_ARG_CHAR_LIMIT
	) {
		return `Editor input too large: old_text was ${input.old_text.length} characters, exceeding the recommended limit of ${INPUT_ARG_CHAR_LIMIT}. Split the edit into smaller tool calls so later tool calls are less likely to be truncated or time out.`;
	}

	if (input.new_text.length > INPUT_ARG_CHAR_LIMIT) {
		return `Editor input too large: new_text was ${input.new_text.length} characters, exceeding the recommended limit of ${INPUT_ARG_CHAR_LIMIT}. Split the edit into smaller tool calls so later tool calls are less likely to be truncated or time out.`;
	}

	return null;
}

/**
 * Create a timeout-wrapped promise
 */
export class TimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(message: string, timeoutMs: number) {
		super(message);
		this.name = "TimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

export function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new TimeoutError(message, ms)), ms);
		}),
	]);
}

export function formatReadFileQuery(request: ReadFileRequest): string {
	const { path, start_line, end_line } = request;
	if (start_line == null && end_line == null) {
		return path;
	}
	const start = start_line ?? 1;
	const end = end_line ?? "EOF";
	return `${path}:${start}-${end}`;
}

export function getReadFileRangeError(request: ReadFileRequest): string | null {
	const { start_line, end_line } = request;
	if (start_line == null || end_line == null || start_line <= end_line) {
		return null;
	}

	return `start_line must be less than or equal to end_line (received start_line: ${start_line}, end_line: ${end_line})`;
}

const READ_RANGE_KEYS = new Set(["start_line", "end_line"]);

function isOrphanReadRangeEntry(
	value: unknown,
): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const keys = Object.keys(value);
	return keys.length > 0 && keys.every((key) => READ_RANGE_KEYS.has(key));
}

function coalesceOrphanReadRangeEntries(entries: unknown[]): unknown[] {
	const coalesced: unknown[] = [];
	for (const entry of entries) {
		if (isOrphanReadRangeEntry(entry)) {
			const previous = coalesced[coalesced.length - 1];
			if (typeof previous === "string") {
				coalesced[coalesced.length - 1] = { path: previous, ...entry };
				continue;
			}
			if (
				previous !== null &&
				typeof previous === "object" &&
				!Array.isArray(previous) &&
				"path" in previous &&
				Object.keys(entry).every((key) => !(key in previous))
			) {
				coalesced[coalesced.length - 1] = { ...previous, ...entry };
				continue;
			}
		}
		coalesced.push(entry);
	}
	return coalesced;
}

/**
 * Some models emit a file's line range as a separate array element instead of
 * placing start_line/end_line on the same object as its path. Fold such
 * orphan range entries into the preceding file entry before validation.
 */
export function coalesceOrphanReadRanges(input: unknown): unknown {
	if (Array.isArray(input)) {
		return coalesceOrphanReadRangeEntries(input);
	}
	if (input !== null && typeof input === "object") {
		for (const key of ["files", "paths"] as const) {
			const value = (input as Record<string, unknown>)[key];
			if (Array.isArray(value)) {
				return { ...input, [key]: coalesceOrphanReadRangeEntries(value) };
			}
		}
	}
	return input;
}

export function normalizeRunCommandsInput(
	input: unknown,
): Array<string | StructuredCommandInput> {
	const commands = collectRunCommands(
		validateWithZod(RunCommandsInputUnionSchema, input),
	);
	// An empty list is well-formed but never a real request: nothing would
	// run and the call would still report success. Fail it so the model sees
	// that no command was given instead of an empty result it has to read
	// into.
	if (commands.length === 0) {
		throw new Error(
			"run_commands requires at least one command; the commands list was empty.",
		);
	}
	return commands;
}

/**
 * ACT-CLINEMM-FLINT-TOOLCALL-RED-01(-CORRECTION01) — bounded compatibility
 * canonicalizer for the `run_commands` tool input.
 *
 * ## Observed defect (REAL evidence)
 *
 * Session `1794587196390_xn030.messages.json`, installed version
 * `4.1.16-5a1c485cb`, model `flint:16gb`, provider `openai-compatible`.
 * Starting at message index 37 (inputTokens = 29323), 11 assistant tool
 * calls used the shape:
 *
 *   { "command": "[\"echo hello\"]" }
 *
 * i.e. the SINGULAR key `command` whose value is a STRING containing a
 * JSON-encoded array, instead of the canonical `{ "commands": [...] }`.
 *
 * The pre-approval validator rejected every one of them with:
 *
 *   Invalid input for tool run_commands: ✖ Unrecognized key: "command"
 *   ✖ Invalid input: expected array, received undefined → at commands
 *
 * A SECOND live session (`1794593797996_r48lj.messages.json`, installed
 * version `4.1.16-5a1c485cb-0b6ec51af`) confirmed that the repair above
 * is active — the one `{"command":"[\"...\"]"}` call in that transcript
 * was ACCEPTED and executed both commands — while exposing two
 * ADDITIONAL single-string shapes that this canonicalizer deliberately
 * left unchanged and the strict schema therefore rejected:
 *
 *   { "commands": "ls -la /path" }   → ✖ expected array, received string
 *   { "command":  "ls -la /path" }   → ✖ Unrecognized key: "command"
 *
 * In that session 7 of the 12 `run_commands` calls used one of those two
 * shapes and were rejected. The first rejection occurred at message
 * index 2 — EARLY in the session — so the defect is not
 * long-context-only: the model's argument formatting is inconsistent
 * from the start of the session.
 *
 * ## Why this canonicalizer exists (and why it is bounded)
 *
 * The generic, schema-driven compatibility step
 * (`normalizeJsonLikeStringsForSchema`) only rewrites values of DECLARED
 * properties. `command` is not a declared property of the strict
 * `RunCommandsInputSchema` (`additionalProperties: false`), so that step
 * is a no-op for that shape and the call is rejected.
 *
 * This canonicalizer accepts EXACTLY THREE shapes — the ones confirmed
 * in the captured transcripts:
 *
 *   1. `{ "command": "<JSON array string>" }` → the decoded array
 *      (the FLINT-TOOLCALL-RED-01 shape);
 *   2. `{ "commands": "<shell text>" }` → a one-element command list
 *      (the CORRECTION01 shape);
 *   3. `{ "command": "<shell text>" }`  → a one-element command list
 *      (the CORRECTION01 shape).
 *
 * In every case:
 *
 *   - the input is a plain object whose ONLY key is `command` or
 *     `commands` — unknown/conflicting sibling keys are ambiguous and
 *     are never guessed at;
 *   - the value is a string;
 *   - for the JSON-array form, the string parses as JSON into an ARRAY
 *     whose every member is a string and which is non-empty;
 *   - for the plain-string forms, the string is non-empty after
 *     trimming (an empty or whitespace-only value is NOT a command);
 *   - the resulting command list satisfies the canonical `commands`
 *     element schema.
 *
 * Everything else is returned UNCHANGED so the strict schema rejects it
 * exactly as before. In particular this canonicalizer REJECTS:
 *
 *   - unknown/conflicting sibling keys (`{command, commands}`, `{command,
 *     timeout}`, ...) — ambiguous input is never guessed at;
 *   - empty / whitespace-only command strings;
 *   - a JSON array containing non-string members;
 *   - an empty array;
 *   - malformed JSON;
 *   - a JSON OBJECT value (only arrays are decoded; a serialized object
 *     is never executed as shell text).
 *
 * ## Anti-shell invariant
 *
 * The parsed array members are the COMMANDS. The serialized JSON text is
 * NEVER forwarded as a command. This is load-bearing: the permissive
 * union (`RunCommandsInputUnionSchema`) has a `{ command: string }` arm,
 * so WITHOUT this canonicalizer the captured payload would normalize to
 * the single shell command `["echo hello"]` — the serialized JSON text
 * executed as shell code. This canonicalizer runs BEFORE validation so
 * the canonical array is what the schema validates, what the approval
 * card previews, what the per-command authorization binding is built
 * from, and what the executor runs.
 *
 * ## Strict, unambiguous string interpretation
 *
 * A plain (non-JSON) string is interpreted as ONE complete shell command
 * — never as a command list, never split on whitespace/newlines. The
 * canonicalizer does NOT implement generic key guessing: the accepted
 * keys are exactly `command` and `commands`, and only when they are the
 * SOLE key of the input object.
 */
export function normalizeRunCommandsToolInput(input: unknown): unknown {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}
	const record = input as Record<string, unknown>;
	const keys = Object.keys(record);
	// ONLY the captured shapes: a single `command` or `commands` key and
	// nothing else. Conflicting or unknown sibling keys are ambiguous and
	// are rejected.
	if (keys.length !== 1) {
		return input;
	}
	const key = keys[0]!;
	if (key !== "command" && key !== "commands") {
		return input;
	}
	const raw = record[key];
	if (typeof raw !== "string") {
		return input;
	}
	const trimmed = raw.trim();
	// An empty (or whitespace-only) value is never a command. Rejecting it
	// here keeps the strict schema's rejection message authoritative.
	if (trimmed.length === 0) {
		return input;
	}
	// The JSON-encoded ARRAY form is decoded into its members. Only a
	// value that STARTS with `[` is treated as a JSON array candidate: a
	// plain shell command is never re-interpreted as serialized JSON.
	if (trimmed.startsWith("[")) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			// Malformed JSON is not a compatibility shape; let the strict
			// schema produce the normal rejection.
			return input;
		}
		if (!Array.isArray(parsed) || parsed.length === 0) {
			return input;
		}
		// Every member must be a string: the captured payloads are arrays
		// of complete shell command strings. A mixed/invalid member is
		// rejected rather than coerced.
		if (!parsed.every((member) => typeof member === "string")) {
			return input;
		}
		// Validate the COMPLETE array against the canonical `commands`
		// schema BEFORE canonicalization, so an invalid member can never
		// reach validation, approval, or execution.
		const validated = RunCommandsInputSchema.shape.commands.safeParse(parsed);
		if (!validated.success) {
			return input;
		}
		// Canonical shape. `notifyOnCompletion` is deliberately NOT
		// carried over: the captured shape has `command` as its ONLY key,
		// so any sibling flag would have been rejected above as ambiguous
		// input.
		return { commands: validated.data };
	}
	// A JSON OBJECT value is never a shell command. Without this guard the
	// plain-string branch below would hand the serialized object text to
	// the executor as shell code. Only arrays are decoded, and only a
	// value that is NOT JSON-looking at all is treated as a plain command.
	if (trimmed.startsWith("{")) {
		return input;
	}
	// The plain-string form: exactly ONE complete shell command. The
	// string is validated against the canonical `commands` element schema
	// BEFORE canonicalization, so an invalid command can never reach
	// validation, approval, or execution.
	const validated = RunCommandsInputSchema.shape.commands.safeParse([raw]);
	if (!validated.success) {
		return input;
	}
	// Canonical shape. `notifyOnCompletion` is deliberately NOT carried
	// over: the captured shape has the command key as its ONLY key, so any
	// sibling flag would have been rejected above as ambiguous input.
	return { commands: validated.data };
}

function collectRunCommands(
	validate: z.infer<typeof RunCommandsInputUnionSchema>,
): Array<string | StructuredCommandInput> {
	if (typeof validate === "string") {
		return [validate];
	}

	if (Array.isArray(validate)) {
		return validate;
	}

	if ("commands" in validate) {
		return Array.isArray(validate.commands)
			? validate.commands
			: [validate.commands];
	}

	if ("command" in validate) {
		return "args" in validate ? [validate] : [validate.command];
	}

	if ("cmd" in validate) {
		return [validate.cmd];
	}

	return [validate];
}

export function formatRunCommandQuery(
	command: string | StructuredCommandInput,
): string {
	if (typeof command === "string") {
		return command;
	}

	const args = command.args ?? [];
	if (args.length === 0) {
		return command.command;
	}

	const renderedArgs = args.map((arg) =>
		/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg,
	);
	return `${command.command} ${renderedArgs.join(" ")}`;
}

/**
 * Max characters of the executed command echoed back in the tool result's
 * `query` field. The full command already exists in the assistant tool-call
 * input, so repeating it in the result only duplicates tokens in the
 * provider request (expensive for large heredoc/file-generation commands).
 */
export const RUN_COMMAND_QUERY_PREVIEW_LIMIT = 200;

/**
 * Bound the command echo placed in a provider-facing tool result.
 * Short commands pass through unchanged; long commands keep a short
 * prefix plus a truncation note so the result is still identifiable.
 */
export function formatRunCommandQueryPreview(
	command: string | StructuredCommandInput,
): string {
	const rendered = formatRunCommandQuery(command);
	if (rendered.length <= RUN_COMMAND_QUERY_PREVIEW_LIMIT) {
		return rendered;
	}
	const truncatedChars = rendered.length - RUN_COMMAND_QUERY_PREVIEW_LIMIT;
	return `${rendered.slice(0, RUN_COMMAND_QUERY_PREVIEW_LIMIT)} ... [command truncated: ${truncatedChars} more chars; full command is in the tool call input]`;
}
