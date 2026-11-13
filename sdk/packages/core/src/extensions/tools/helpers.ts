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
 * ACT-CLINEMM-FLINT-TOOLCALL-RED-01 — bounded compatibility canonicalizer
 * for the `run_commands` tool input.
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
 * ## Why this canonicalizer exists (and why it is bounded)
 *
 * The generic, schema-driven compatibility step
 * (`normalizeJsonLikeStringsForSchema`) only rewrites values of DECLARED
 * properties. `command` is not a declared property of the strict
 * `RunCommandsInputSchema` (`additionalProperties: false`), so that step
 * is a no-op for this shape and the call is rejected.
 *
 * This canonicalizer accepts EXACTLY ONE shape — the one confirmed in the
 * captured transcript:
 *
 *   - the input is a plain object whose ONLY key is `command`;
 *   - the value of `command` is a string;
 *   - that string parses as JSON into an ARRAY;
 *   - every array member is a string;
 *   - the array is non-empty;
 *   - the array members satisfy the canonical `commands` element schema.
 *
 * Everything else is returned UNCHANGED so the strict schema rejects it
 * exactly as before. In particular this canonicalizer REJECTS:
 *
 *   - unknown/conflicting sibling keys (`{command, commands}`, `{command,
 *     timeout}`, ...) — ambiguous input is never guessed at;
 *   - a `command` value that is not a JSON array (a bare command string
 *     stays a bare command string; it is NOT the captured shape);
 *   - a JSON array containing non-string members;
 *   - an empty array;
 *   - malformed JSON.
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
 */
export function normalizeRunCommandsToolInput(input: unknown): unknown {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}
	const record = input as Record<string, unknown>;
	const keys = Object.keys(record);
	// ONLY the captured shape: a single `command` key and nothing else.
	// Conflicting or unknown sibling keys are ambiguous and are rejected.
	if (keys.length !== 1 || keys[0] !== "command") {
		return input;
	}
	const raw = record.command;
	if (typeof raw !== "string") {
		return input;
	}
	// Only a JSON-encoded ARRAY is the confirmed shape. A bare command
	// string (e.g. "echo hello") is a different shape and must not be
	// reinterpreted.
	const trimmed = raw.trim();
	if (!trimmed.startsWith("[")) {
		return input;
	}
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
	// Every member must be a string: the captured payloads are arrays of
	// complete shell command strings. A mixed/invalid member is rejected
	// rather than coerced.
	if (!parsed.every((member) => typeof member === "string")) {
		return input;
	}
	// Validate the COMPLETE array against the canonical `commands` schema
	// BEFORE canonicalization, so an invalid member can never reach
	// validation, approval, or execution.
	const validated = RunCommandsInputSchema.shape.commands.safeParse(parsed);
	if (!validated.success) {
		return input;
	}
	// Canonical shape. `notifyOnCompletion` is deliberately NOT carried
	// over: the captured shape has `command` as its ONLY key, so any
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
