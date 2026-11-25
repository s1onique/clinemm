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
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01
 * -------------------------------------------------------
 * The original decision shape was:
 *
 *     return isInspectionCommandInput(input) ? "inspected" : "executed";
 *
 * That shape has NO distinction between recognised execution, unrecognised
 * inspection, shell environment setup and unknown command semantics: anything
 * the classifier fails to positively recognise as an inspection becomes
 * EXECUTION. The independent review reproduced SEVEN counterexamples against
 * the production classifier — the SSH defect is only ONE manifestation of
 * that general optimism.
 *
 * The correction introduces a THREE-WAY command classification:
 *
 *   - `inspection` — positively recognised read-only work;
 *   - `execution`   — positively recognised work that ran something;
 *   - `unknown`     — the classifier cannot establish the semantics.
 *
 * and it recognises the SETUP and TRANSPORT shapes that used to hide an
 * inspection behind an unrecognised first token:
 *
 *   - ordinary shell assignment / export segments (`L=/tmp`, `export X=1`)
 *     are SETUP, not work;
 *   - environment assignments PRECEDING a command do not change that
 *     command's classification;
 *   - common environment inspection commands (`uname`, `env`, `id`, ...)
 *     are inspections;
 *   - `ssh` is a TRANSPORT WRAPPER: the remote payload is classified, not
 *     the local first token. OpenSSH explicitly separates the destination
 *     from the command and arguments sent for remote execution, so the
 *     remote command is the command that determines what actually ran.
 *
 * The classification of an UNKNOWN command remains CONSERVATIVE with
 * respect to declaring a stall: an unknown command is reported as an
 * execution, because the runtime must not declare a stall on the basis of a
 * command whose semantics were never established. What changed is that the
 * classifier no longer CONFLATES an unrecognised inspection with an
 * established execution, and it no longer lets setup/transport shapes mask a
 * positively recognisable inspection.
 *
 * THIS IS A RECOVERY HEURISTIC, NOT A SECURITY BOUNDARY. The command
 * authorization and sandbox policy are unchanged by this module.
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
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01.
 *
 * The COMMON ENVIRONMENT INSPECTION programs.
 *
 * These read the environment and the system identity; they build nothing,
 * test nothing, install nothing and produce no deliverable. They were
 * previously unrecognised, so an environment reconnaissance round was
 * reported as a productive execution.
 */
const ENVIRONMENT_INSPECTION_PROGRAMS: ReadonlySet<string> = new Set([
	"arch",
	"df",
	"du",
	"env",
	"hostname",
	"id",
	"lscpu",
	"lsblk",
	"printenv",
	"uname",
	"uptime",
	"who",
	"whoami",
]);

/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01.
 *
 * The `mount` program.
 *
 * `mount` with NO arguments LISTS the mounted filesystems: it reads the
 * system's mount table and changes nothing. `mount <device> <mountpoint>`
 * MOUNTS a filesystem: it changes the system's state, which is real work.
 *
 * `mount` therefore cannot be a member of the closed environment-inspection
 * program set. It gets a bounded, explicit rule instead: the listing form is
 * an inspection and every other form is an execution.
 */
const MOUNT_PROGRAM = "mount";

/**
 * The `git` SUBCOMMANDS that are pure inspection.
 *
 * `git stash`, `git commit`, `git checkout`, `git reset` etc. mutate the
 * repository and are therefore EXECUTION, not inspection.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: `git tag` is
 * listed here because the LISTING form (`git tag`) only reads the tag
 * namespace. The CREATING form (`git tag <name>`) is a mutation and is
 * excluded by the argument check below.
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
 * The `git` SUBCOMMANDS whose ARGS are never a listing but always a
 * creation, even in the `git tag` family.
 *
 * `git tag <name>` creates a tag; `git tag` alone lists them. The listing
 * form is the only inspection.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01:
 * the LISTING forms are now recognised EXPLICITLY, instead of by the absence
 * of a flag.
 *
 * The absence-of-a-flag rule let the CREATING and DELETING forms through as
 * inspections, because both carry a flag:
 *
 *   - `git tag -a new-tag -m msg`  (annotated tag creation)
 *   - `git tag -d new-tag`         (tag deletion)
 *
 * A flag-bearing `git tag` is therefore only an inspection when the flag is
 * one of the LISTING flags (`-l`, `--list`). Every other form — including a
 * form whose flag this module does not recognise — keeps the conservative
 * UNKNOWN disposition rather than claiming an inspection it cannot justify.
 */
const GIT_MUTATING_TAG_SUBCOMMANDS: ReadonlySet<string> = new Set(["tag"]);

/**
 * The `git tag` flags whose presence makes the invocation a LISTING.
 *
 * `-l` and `--list` are the two listing flags. Any other flag selects a
 * different operation: `-a` creates an annotated tag, `-d` deletes one,
 * `-s` creates a signed tag, `-v` verifies one.
 */
const GIT_TAG_LISTING_FLAGS: ReadonlySet<string> = new Set(["-l", "--list"]);

/**
 * Whether a `git tag` invocation is a pure LISTING.
 *
 * The listing form is `git tag` with no arguments, or `git tag` followed only
 * by listing flags (and, optionally, a PATTERN to filter by — `git tag -l
 * 'v*'` still only reads the tag namespace).
 */
function gitTagIsListing(args: string[]): boolean {
	const rest = args.slice(1);
	if (rest.length === 0) {
		return true;
	}
	let sawListingFlag = false;
	for (const arg of rest) {
		if (arg.startsWith("-")) {
			if (!GIT_TAG_LISTING_FLAGS.has(arg)) {
				// A non-listing flag selects a mutating operation.
				return false;
			}
			sawListingFlag = true;
		}
		// A bare argument is a PATTERN that filters the listing.
	}
	return sawListingFlag;
}

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
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01.
 *
 * The DESCRIPTOR DUPLICATION forms.
 *
 * `2>&1`, `>&2` and `1>&2` redirect one file descriptor onto another. They
 * are NOT a command separator and NOT a file mutation: the `&` in them does
 * not start a new command, and no file is written.
 *
 * The historical reconnaissance commands of the frozen Session A transcript
 * ALL carry the trailing `2>&1 | tail -N` shape. Reading the `&` of the
 * duplication as a separator fragmented the read-only reconnaissance into an
 * extra, unrecognised segment, so the classifier reported the reconnaissance
 * as a productive execution. That is the defect this form set repairs.
 *
 * A BACKGROUND separator (`cmd &`) and an actual OUTPUT REDIRECTION
 * (`cmd > file`) are DIFFERENT constructs and keep their own behaviour: the
 * `&` still splits the command, and the `>` still writes a file.
 */
/**
 * Split a command string into its simple-command segments.
 *
 * The split is QUOTE- and ESCAPE-aware: a `|` inside a quoted argument (for
 * example the grep pattern `"type: \"done\"\|type: 'done'"`) is part of the
 * argument, not a command separator. Splitting it would fragment the
 * command and misclassify a read-only inspection.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01:
 * the split is also DESCRIPTOR-DUPLICATION-aware. The `&` of a duplication
 * (`2>&1`, `>&2`) is part of the redirection, not a command separator, so it
 * does not split the segment. The `&` of a BACKGROUND separator and the
 * `&` of an output redirection (`&> file`) still split it.
 */
function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaped = false;
	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
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
			char === "(" ||
			char === ")"
		) {
			segments.push(current);
			current = "";
			continue;
		}
		if (char === "&") {
			// The `&` has FOUR distinct shapes, and only ONE of them is a
			// descriptor duplication:
			//
			//   `&&`            the logical AND separator
			//   `&`             the background separator
			//   `&>`            the output redirection (`&> file`)
			//   `N>&M` / `>&M`  the DESCRIPTOR DUPLICATION
			//
			// Only the duplication stays inside the segment.
			const next = command[index + 1];
			if (next === "&") {
				// `&&` — the logical AND separator.
				segments.push(current);
				current = "";
				continue;
			}
			if (next === ">") {
				// `&>` — the output redirection to a file.
				segments.push(current);
				current = "";
				continue;
			}
			if (next === undefined) {
				// A trailing `&` — the background separator.
				segments.push(current);
				current = "";
				continue;
			}
			if (next !== ">" && !/^[0-9]$/.test(next)) {
				// The `&` is followed by whitespace or an ordinary
				// character: this is the BACKGROUND separator.
				segments.push(current);
				current = "";
				continue;
			}
			// The `&` is followed by `>` or a descriptor digit: this is the
			// duplication form `2>&1` or `>&1`. It is NOT a separator.
			current += char;
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
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01.
 *
 * The SSH TRANSPORT WRAPPER.
 *
 * OpenSSH explicitly separates the remote DESTINATION from the command and
 * arguments sent for remote execution. So `ssh` is a TRANSPORT, not a
 * productivity classification: what ran is the REMOTE command, and the
 * remote command is what must be classified.
 *
 * This module supports only the BOUNDED, STATICALLY RECOGNISABLE command
 * shapes needed by the real witnesses:
 *
 *   ssh [options] destination 'remote command'
 *   ssh [options] destination remote-command
 *
 * The destination is identified by the first NON-OPTION argument. OpenSSH
 * options are recognised so an option's VALUE is never mistaken for the
 * destination, and so an option is never mistaken for the remote command.
 *
 * A payload that cannot be statically established — a dynamically constructed
 * command, a here-document, a shell metacharacter that changes the meaning
 * of the payload — yields `undefined`, and the caller keeps its HONEST
 * UNCERTAINTY disposition instead of claiming a semantic reading.
 */
const SSH_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
	"-b",
	"-c",
	"-D",
	"-E",
	"-e",
	"-F",
	"-I",
	"-i",
	"-J",
	"-L",
	"-l",
	"-m",
	"-O",
	"-o",
	"-p",
	"-Q",
	"-R",
	"-S",
	"-W",
	"-w",
]);

/**
 * The result of recognising an SSH invocation.
 */
interface SshInvocation {
	/** The remote payload, as written, or `undefined` when it is not statically recognisable. */
	readonly payload: string | undefined;
}

/**
 * Recognise an `ssh` invocation and extract its remote payload.
 *
 * Returns `undefined` when the segment is not an `ssh` invocation at all.
 * The returned payload is `undefined` when the invocation IS an ssh
 * invocation but its payload cannot be established statically — the caller
 * then keeps its uncertainty disposition.
 */
function readSshInvocation(tokens: string[]): SshInvocation | undefined {
	const program = tokens[0]?.split("/").pop()?.toLowerCase();
	if (program !== "ssh") {
		return undefined;
	}
	let index = 1;
	// Skip the OpenSSH options. An option that takes a value consumes the
	// next token, so the value is never mistaken for the destination.
	while (index < tokens.length) {
		const token = tokens[index];
		if (!token.startsWith("-") || token === "-") {
			break;
		}
		if (token === "--") {
			index += 1;
			break;
		}
		if (SSH_OPTIONS_WITH_VALUE.has(token)) {
			index += 2;
			continue;
		}
		// A `--option=value` form carries its own value.
		index += 1;
	}
	// The DESTINATION is the first non-option argument.
	if (index >= tokens.length) {
		return { payload: undefined };
	}
	index += 1;
	// Everything after the destination is the REMOTE COMMAND.
	const remote = tokens.slice(index);
	if (remote.length === 0) {
		// `ssh host` with no command opens an interactive session: it is
		// not a statically recognisable inspection or execution.
		return { payload: undefined };
	}
	// The remote command is normally a SINGLE quoted argument
	// (`ssh host 'grep -n foo bar'`). Its quotes are shell quoting, not part
	// of the command, so they are stripped before the payload is classified.
	// A single unquoted remote command (`ssh host grep -n foo bar`) keeps
	// its own token boundaries.
	const unquoted = remote.map((token) => stripOuterQuotes(token));
	return { payload: unquoted.join(" ") };
}

/**
 * Strip ONE layer of matching outer quotes from a token.
 *
 * `'grep -n foo bar'` becomes `grep -n foo bar`; `"x"` becomes `x`. A token
 * without matching outer quotes is returned unchanged.
 */
function stripOuterQuotes(token: string): string {
	if (token.length < 2) {
		return token;
	}
	const first = token[0];
	const last = token[token.length - 1];
	if ((first === "'" || first === '"') && last === first) {
		return token.slice(1, -1);
	}
	return token;
}

/**
 * Whether a remote payload contains a construct whose meaning cannot be
 * established statically.
 *
 * A here-document, a command substitution or a backtick substitution
 * produces a command whose text is not knowable from the payload alone.
 */
function payloadIsDynamic(payload: string): boolean {
	return /<<|`|\$\(/.test(payload);
}

/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01.
 *
 * The classification of ONE command segment.
 *
 * The three-way result distinguishes "positively recognised inspection",
 * "positively recognised execution" and "semantics not established". The
 * distinction matters because the ORIGINAL two-way shape reported EVERY
 * unrecognised segment as an execution, which is exactly how an
 * unrecognised reconnaissance round became false productivity.
 */
type SegmentClassification = "inspection" | "execution" | "unknown";

/**
 * Whether a token is an ordinary shell ASSIGNMENT (`NAME=value`).
 *
 * The same shape the command guard already recognises, so the two layers
 * agree about what a shell assignment is.
 */
const SHELL_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/**
 * Whether a command segment is pure SHELL SETUP.
 *
 * Setup prepares the environment for the command that follows; it does not
 * itself observe or change anything. It is neither inspection nor
 * execution — it is not work.
 *
 * The recognised setup shapes are:
 *
 *   - an ordinary assignment: `L=/tmp`
 *   - an assignment with a command substitution: `L=$(pwd)`
 *   - `export NAME=value` / bare `export NAME`
 *   - `unset NAME`
 *   - `cd <dir>` (the shell's working directory only)
 *   - a `VAR=value` prefix on the FOLLOWING command
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01:
 * a setup form that carries an OUTPUT REDIRECTION is NOT setup.
 *
 * `cd /tmp > file` and `export X=1 > file` write a file. The setup action
 * itself changes nothing, but the redirection writes a deliverable, so the
 * segment is a MUTATION and not an inspection. The command guard is the
 * authority for the file-writing question, exactly as it is for `sed -i` and
 * `find -delete`.
 */
function segmentIsSetup(segment: string): boolean {
	const tokens = splitTokens(segment);
	if (tokens.length === 0) {
		return false;
	}
	const first = tokens[0];
	if (first === "export" || first === "unset") {
		return !segmentWritesAFile(segment);
	}
	if (first === "cd") {
		// `cd` only changes the shell's working directory: it is setup, not
		// work — unless it also writes a file.
		return !segmentWritesAFile(segment);
	}
	if (SHELL_ASSIGNMENT.test(first)) {
		// `L=/tmp` on its own is setup. `L=/tmp cmd` is a command WITH an
		// assignment prefix, which is handled by the prefix stripping, not
		// here — a bare assignment segment has exactly one token.
		return tokens.length === 1 && !segmentWritesAFile(segment);
	}
	return false;
}

/**
 * Whether a command segment WRITES A FILE.
 *
 * The existing command guard is the authority for this question: it already
 * distinguishes an output redirection to a real file from a descriptor
 * duplication (`2>&1`) and from an allowed temporary sink. This module
 * reuses that authority rather than inventing a second notion of "writes a
 * file".
 */
function segmentWritesAFile(segment: string): boolean {
	return findFileEditingCommand(segment) !== undefined;
}

/**
 * Strip the leading shell ASSIGNMENT prefixes from a token list.
 *
 * `L=/tmp grep -n foo bar` is the `grep` command with an environment
 * assignment in front of it. The assignment does not change what the
 * command DOES, so it must not change the command's classification.
 *
 * The `export`/`unset`/`cd` setup forms are NOT stripped here: they are
 * handled as their own segments.
 */
function stripAssignmentPrefixes(tokens: string[]): string[] {
	let index = 0;
	while (
		index < tokens.length &&
		SHELL_ASSIGNMENT.test(tokens[index]) &&
		// A `NAME=value` prefix only counts when it is followed by
		// something that could be a command.
		index < tokens.length - 1
	) {
		index += 1;
	}
	return tokens.slice(index);
}

/**
 * Split a command segment into tokens, respecting QUOTES.
 *
 * A quoted token (`'grep -n foo'`) is ONE token even though it contains
 * spaces, so the assignment prefix check never sees a fragment of a quoted
 * string.
 */
function splitTokens(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaped = false;
	let sawContent = false;
	for (const char of segment) {
		if (escaped) {
			current += char;
			sawContent = true;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			current += char;
			sawContent = true;
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
			sawContent = true;
			continue;
		}
		if (char === " " || char === "\t") {
			if (sawContent) {
				tokens.push(current);
				current = "";
				sawContent = false;
			}
			continue;
		}
		current += char;
		sawContent = true;
	}
	if (sawContent) {
		tokens.push(current);
	}
	return tokens;
}

/**
 * Classify ONE command segment.
 *
 * The order of the checks matters:
 *
 *   1. SETUP — an assignment, an export, an unset, a `cd`. Setup is not
 *      work; it neither observes nor changes anything.
 *   2. TRANSPORT — an `ssh` invocation. The REMOTE payload is classified,
 *      because the remote command is the command that ran.
 *   3. MUTATION — a recognised inspection program whose invocation carries
 *      a mutating construct (`sed -i`, `find -delete`, an output
 *      redirection to a real file, `git tag <name>`). A mutation is an
 *      execution of the deliverable.
 *   4. INSPECTION — a recognised inspection program with no mutating
 *      construct.
 *   5. UNKNOWN — anything else. The semantics were not established.
 */
function classifySegment(segment: string): SegmentClassification {
	const tokens = splitTokens(segment);
	if (tokens.length === 0) {
		return "unknown";
	}
	// (1) SETUP.
	if (segmentIsSetup(segment)) {
		return "inspection";
	}
	// An environment assignment PREFIX does not change what the command
	// does: `L=/tmp grep -n foo bar` is the `grep` command.
	const effective = stripAssignmentPrefixes(tokens);
	if (effective.length === 0) {
		return "inspection";
	}
	// (2) TRANSPORT.
	const ssh = readSshInvocation(effective);
	if (ssh !== undefined) {
		if (ssh.payload === undefined || payloadIsDynamic(ssh.payload)) {
			// The remote payload could not be established statically: the
			// classifier keeps its HONEST UNCERTAINTY disposition and does
			// not claim a semantic reading.
			return "unknown";
		}
		return classifyRemotePayload(ssh.payload);
	}
	const { program, args } = unwrap(effective);
	if (program.length === 0) {
		return "unknown";
	}
	// (3) MUTATION.
	if (program === "git") {
		const subcommand = args[0]?.toLowerCase();
		if (subcommand === undefined) {
			return "unknown";
		}
		if (!INSPECTION_GIT_SUBCOMMANDS.has(subcommand)) {
			return "execution";
		}
		if (
			GIT_MUTATING_TAG_SUBCOMMANDS.has(subcommand) &&
			!gitTagIsListing(args)
		) {
			// `git tag <name>` CREATES a tag and `git tag -d <name>` DELETES
			// one: a mutation. Only the LISTING form is an inspection.
			return "execution";
		}
		// A recognised inspection subcommand can still be a MUTATION when
		// the invocation carries a mutating construct — `git status > file`
		// writes a file. The command guard is the authority for that
		// question, exactly as it is for `sed -i` and `find -delete`.
		if (findFileEditingCommand(segment) !== undefined) {
			return "execution";
		}
		return "inspection";
	}
	// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01.
	//
	// `mount` with NO arguments LISTS the mounted filesystems; every other
	// form MOUNTS one and changes the system's state. The listing form is an
	// inspection; the mutating form is an execution.
	if (program === MOUNT_PROGRAM) {
		return args.length === 0 ? "inspection" : "execution";
	}
	if (
		!INSPECTION_PROGRAMS.has(program) &&
		!ENVIRONMENT_INSPECTION_PROGRAMS.has(program)
	) {
		// (5) UNKNOWN — the semantics were not established. The caller
		// reports this conservatively as an execution, but the distinction
		// is preserved here so the classifier does not CONFLATE an
		// unrecognised command with a recognised one.
		return "unknown";
	}
	// `sed -i` edits in place; `find -delete` deletes; `git status > file`
	// writes a file. None is inspection. The existing command guard already
	// knows how to detect file-modifying constructs, so it is the authority
	// for that question.
	if (findFileEditingCommand(segment) !== undefined) {
		return "execution";
	}
	// (4) INSPECTION.
	return "inspection";
}

/**
 * Classify a REMOTE payload — the command that actually ran on the other
 * side of an SSH transport.
 *
 * The payload is split into its own segments, so a remote command that
 * mixes a read with a build is classified as an execution, exactly like the
 * equivalent local command.
 */
function classifyRemotePayload(payload: string): SegmentClassification {
	const segments = splitSegments(payload);
	if (segments.length === 0) {
		return "unknown";
	}
	let sawInspection = false;
	for (const remoteSegment of segments) {
		const classification = classifySegment(remoteSegment);
		if (classification === "execution") {
			return "execution";
		}
		if (classification === "unknown") {
			return "unknown";
		}
		sawInspection = true;
	}
	return sawInspection ? "inspection" : "unknown";
}

/**
 * Whether a whole `run_commands` input is a pure INSPECTION.
 *
 * A command list is an inspection only when EVERY segment in it is an
 * inspection. One real execution in the list makes the whole call an
 * execution.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: a SETUP segment
 * (`L=/tmp`, `export X=1`) does not make the call an execution — setup is
 * not work, so a call whose only non-inspection segments are setup segments
 * is still an inspection.
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
			if (classifySegment(segment) !== "inspection") {
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
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — EXECUTION
 * OUTCOME AUTHORITY
 * -----------------------------------------------
 * The hook used to DECLINE a failed observation, on the correct grounds that
 * the host has no authority to claim success about a command that failed.
 * But a DECLINE is not a verdict: the runtime's fallback then re-classified
 * the very same tool call as an EXECUTION, because the fallback checked only
 * the dispatch `isError` flag. The host's authoritative negative observation
 * DISAPPEARED at that boundary.
 *
 * The hook now reports the failure EXPLICITLY, with the `failed` verdict, so
 * the observation survives the boundary:
 *
 *   - a FAILED outcome (a non-zero exit code, an explicit `ok: false`) is
 *     `failed`;
 *   - a MISSING outcome (the result carries no execution outcome at all) is
 *     `failed` too — a missing result must not establish successful
 *     execution;
 *   - a STILL RUNNING observation remains a DECLINE, because a legitimate
 *     wait is neither an execution nor a failure and the runtime's own
 *     structural reading owns it;
 *   - every other command call is `inspected` or `executed` according to the
 *     command classification.
 */
export function createHostExecutionProgressClassifier(): NonNullable<
	ExecutionStagnationPolicy["classifyToolCall"]
> {
	return (toolName, input, result) => {
		if (toolName !== "run_commands") {
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
		// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: the
		// EXECUTION OUTCOME is authoritative.
		//
		// A FAILED observation — the production `command_status` snapshot of
		// a job that failed carries the observed exit code and the terminal
		// state — is reported as `failed`. The host must not claim an
		// INSPECTION verdict about a command that failed: the failed command
		// did not read anything, it ran and failed.
		//
		// A MISSING outcome is reported as `failed` too: neither a
		// successful dispatch nor an absent result establishes that the
		// command ran and succeeded.
		if (result?.isError === true || observationReportsFailure(result?.output)) {
			return "failed";
		}
		if (result === undefined || !observationEstablishesOutcome(result.output)) {
			// The observation carries NO execution outcome: either the result
			// is absent entirely, or it carries no output at all, or the
			// output is EMPTY.
			//
			// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 —
			// AMENDMENT-01: an EMPTY observation (`null`, `[]`, `{}`) is a
			// MISSING outcome too. The previous check only rejected an
			// ABSENT `output` property, so an empty array or an empty
			// object fell through to the command-shape reading and was
			// reported as a productive EXECUTION. An observation that
			// carries no evidence at all cannot establish that the command
			// ran and produced a deliverable.
			//
			// Neither a successful dispatch nor an empty observation
			// establishes that the command ran and succeeded, so this is not
			// positive evidence of progress.
			return "failed";
		}
		return isInspectionCommandInput(input) ? "inspected" : "executed";
	};
}

/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01.
 *
 * Whether an observation ESTABLISHES a terminal execution outcome.
 *
 * The real production result contract is the `command_status` snapshot
 * (`CommandStatusOutput`) and the `run_commands` array envelope
 * (`ToolOperationResult[]`):
 *
 *   - the `command_status` snapshot carries `ok` (the OBSERVATION succeeded),
 *     `state` (the command's lifecycle state) and `exitCode` (the command's
 *     terminal status);
 *   - the `run_commands` operation result carries `success`, `result` and
 *     `error`.
 *
 * `{ ok: true }` ALONE does NOT establish a terminal outcome: `ok` reports
 * that the OBSERVATION was taken, not that the COMMAND ran and succeeded. A
 * still-running job reports `ok: true` with `state: "running"` and no exit
 * code at all.
 *
 * A terminal outcome is therefore established by an explicit `exitCode`, or
 * by the production operation-result `success` flag, or by a `state` that
 * names a terminal state.
 *
 * A PLAIN-TEXT observation is the documented residual limitation: the
 * classifier cannot distinguish a completed command with no structured
 * envelope from a command whose outcome was never reported, so it treats a
 * plain-text observation as a COMPLETED observation, classified by the
 * command's shape. That limitation is unchanged by this repair.
 *
 * An EMPTY observation (`null`, `[]`, `{}`) carries no evidence at all and
 * therefore establishes no outcome.
 */
function observationEstablishesOutcome(output: unknown): boolean {
	if (output === null || output === undefined) {
		return false;
	}
	if (typeof output === "string") {
		// The production `run_commands` RUNNING envelope is a JSON STRING.
		// It is parsed and read structurally. A non-JSON string is the
		// documented plain-text legacy shape.
		try {
			return observationEstablishesOutcome(JSON.parse(output));
		} catch {
			// A plain-text observation is treated as a COMPLETED
			// observation: the documented residual limitation.
			return true;
		}
	}
	if (typeof output !== "object") {
		// A non-object, non-string observation (a number, a boolean) is a
		// plain-text-equivalent observation.
		return true;
	}
	if (Array.isArray(output)) {
		// The production array envelope. An EMPTY array carries no
		// evidence; a non-empty array is established when any ENTRY
		// establishes a terminal outcome.
		return output.some((entry) => observationEstablishesOutcome(entry));
	}
	const record = output as Record<string, unknown>;
	// The explicit terminal status of the command.
	if (typeof record.exitCode === "number") {
		return true;
	}
	// The production operation-result success flag.
	if (typeof record.success === "boolean") {
		return true;
	}
	// A terminal lifecycle state names the command's terminal outcome.
	if (typeof record.state === "string") {
		const state = record.state.toLowerCase();
		if (
			state === "exited" ||
			state === "failed" ||
			state === "completed" ||
			state === "done" ||
			state === "terminated" ||
			state === "killed" ||
			state === "aborted"
		) {
			return true;
		}
	}
	// The `ok` flag alone is the OBSERVATION's success, not the command's
	// terminal outcome, so it does not establish one.
	return false;
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
