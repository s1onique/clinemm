/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01
 *
 * Verified tool-outcome continuity across Agentic compaction.
 *
 * PROBLEM
 * -------
 *
 * An Agentic compaction replaces the compacted prefix with a generated
 * summary. The generated summary is a LOSSY PROJECTION of the canonical
 * history, and it can drop a DECISIVE fact: an operation that actually
 * executed successfully.
 *
 * The reproduced instance (Round C session `1794780088950_tc1vx`):
 *
 *   - The canonical history carried a SUCCESSFUL `helm template` render
 *     (`rc=0`, resolved image, `runAsNonRoot: true`, `fsGroup: 1000`).
 *   - That evidence REACHED the summarizer's input window (the causal
 *     discriminator proved every marker present in the production
 *     serialization of the folded prefix).
 *   - The INSTALLED SUMMARY carried NONE of it, and the final report
 *     consequently claimed the render was `NOT_EXECUTED` — a statement
 *     contradicted by the canonical record.
 *
 * The violated invariant:
 *
 *   A generated summary may omit historical detail, but it must NOT become
 *   MORE AUTHORITATIVE than the canonical record of what actually executed.
 *
 * AUTHORITY
 * ---------
 *
 * The canonical session history is the ONLY authority, exactly as for the
 * active task contract (`task-contract.ts`). This module never becomes a
 * second evidence owner, never invents a new durable representation and
 * never reads a previous summary as an authority source. Every carried
 * outcome is derived from a CANONICAL tool-call/tool-result PAIR, matched
 * by its tool-call id, and classified by the result's OWN success signal.
 *
 * WHAT COUNTS AS "VERIFIED"
 * -------------------------
 *
 * A tool outcome is carried only when ALL of the following hold:
 *
 *   1. The canonical history contains the tool CALL (`tool_use` block).
 *   2. The canonical history contains the matching tool RESULT
 *      (`tool_result` block with the same `tool_use_id`).
 *   3. The result is NOT an error (`is_error` is not set).
 *   4. The result carries an explicit, POSITIVE success signal, and every
 *      payload in the result AGREES on that signal.
 *
 * Rule 4 is deliberately strict. A result with no success signal at all
 * is NOT carried: "no evidence of failure" is not "evidence of success",
 * and promoting an unclassified result would repeat the very defect this
 * module repairs (asserting an outcome the canonical record does not
 * establish). A FAILED or NOT-RUN operation is therefore NEVER carried as
 * a success — the absence of a carried entry is the truthful representation
 * of "not established".
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 tightened rule 4
 * in two ways that the first cut got wrong:
 *
 *   a. CONFLICTING STATUSES FAIL CLOSED. A single tool result can carry
 *      MULTIPLE per-command payloads (the `run_commands` executor persists
 *      one `{query, result, success}` entry per command). If any payload
 *      reports a failure, the BATCH did not wholly succeed, so the batch
 *      is NOT carried as a success. One successful command can no longer
 *      certify an entire mixed-result batch. The first cut returned on the
 *      first positive flag it saw, which promoted a failed operation.
 *
 *   b. `isError: false` IS NOT AFFIRMATIVE SUCCESS. That flag establishes
 *      only that no error was REPORTED, not that the operation succeeded.
 *      It is now treated as "no signal", which fails closed.
 *
 *   c. EVERY PAYLOAD MUST AFFIRMATIVELY SUCCEED. A batch is carried only
 *      when every payload agrees. A payload that carries no affirmative
 *      signal (for example `{isError: false}`) leaves the batch NOT wholly
 *      verified, even when a sibling payload succeeded.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02 also fixed the
 * evaluation ORDER: the CORRECTION01 implementation used `continue` after
 * `success === true`, which BYPASSED the `isError` check on that same
 * payload and so accepted `{success: true, isError: true}`. All failure
 * indicators are now checked INDEPENDENTLY on the SAME payload, and the
 * classification is order-independent.
 *
 * The positive success signal recognised is the `success: boolean` field
 * on a result payload. It is matched on the DATA SHAPE, never on a
 * provider id and never on a tool name, so the rule applies uniformly.
 *
 * ATTRIBUTION IS ALSO FAIL-CLOSED
 * -------------------------------
 *
 * A tool-call id is the join key between a call and its result, but an id
 * is not guaranteed to be unique. When the canonical history contains
 * DUPLICATE tool-call ids, the join is AMBIGUOUS and the outcome is not
 * carried at all. The first cut let the first call own the id and then
 * attributed a LATER result to it without checking the tool name or the
 * call/result chronology — which can attach a different tool's output to
 * the wrong call. A result that names a tool the call did not declare, or
 * that arrives for a call that was never issued, is not carried.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02 added the
 * MIRROR case: a call id answered by MORE THAN ONE result is equally
 * ambiguous. A successful result followed by a contradictory failed result
 * must not leave the successful one carried, so the whole id fails closed
 * (`ambiguous_result_id`).
 *
 * CREDENTIAL SAFETY: STRUCTURED EVIDENCE, NOT RAW OUTPUT
 * -------------------------------------------------------
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 replaced the raw
 * output carry-forward with a STRUCTURED, ALLOWLISTED evidence record.
 *
 * The first cut carried up to 240 characters of the raw tool output and
 * relied on a regex sanitizer to strip credentials. That sanitizer was NOT
 * safe for arbitrary tool output: it missed JSON (`{"password":"..."}`),
 * YAML (`password: "..."`) and multi-word quoted values, so the carry-
 * forward could have PRESERVED credential-bearing output that the
 * pre-repair pipeline would simply have discarded — a new exposure
 * surface, not a neutral one.
 *
 * The corrected module never carries raw tool output. It carries only
 * fields derived from the tool CALL's own declared input plus the result's
 * own status, and every carried string passes through a conservative
 * redaction that is applied to the VALUE POSITION rather than to a
 * credential-shaped token. A value that cannot be shown to be safe is
 * not shown at all.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02 closed the
 * REMAINING exposure path: the CORRECTION01 implementation still carried
 * the first three WORDS of the command line. A command's ARGUMENTS are
 * arbitrary user-controlled strings, and no regex can establish that an
 * arbitrary argument is safe — `echo <secret>`,
 * `curl https://user:pass@host/...` and `psql postgresql://user:pass@host`
 * all leak a credential into the provider-visible summary.
 *
 * So the carried command information is now a CLASSIFICATION drawn from a
 * FINITE allowlist (`COMMAND_CLASSIFICATION_ALLOWLIST` /
 * `COMMAND_SUBCOMMAND_ALLOWLIST`). No user-supplied argument, path or URL
 * is ever persisted into the summary.
 *
 * BOUNDEDNESS
 * -----------
 *
 * The carried section is bounded on BOTH axes: at most
 * `MAX_CARRIED_OUTCOMES` outcomes, each rendered as a line of at most
 * `MAX_CARRIED_OUTCOME_CHARS` characters. The overhead is therefore a
 * fixed constant, not a function of the transcript size.
 *
 * CREDENTIAL SAFETY
 * -----------------
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 replaced the raw
 * output carry-forward with a STRUCTURED, ALLOWLISTED evidence record.
 *
 * The first cut carried up to 240 characters of the raw tool output and
 * relied on a regex sanitizer to strip credentials. That sanitizer was NOT
 * safe for arbitrary tool output: it missed JSON (`{"password":"..."}`),
 * YAML (`password: "..."`) and multi-word quoted values, so the carry-
 * forward could have PRESERVED credential-bearing output that the
 * pre-repair pipeline would simply have discarded — a new exposure
 * surface, not a neutral one.
 *
 * The corrected module never carries raw tool output. It carries only
 * fields derived from the tool CALL's own declared input plus the result's
 * own status, and every carried string passes through a conservative
 * redaction that is applied to the VALUE POSITION rather than to a
 * credential-shaped token. A value that cannot be shown to be safe is
 * not shown at all.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02 closed the
 * REMAINING exposure path: the CORRECTION01 implementation still carried
 * the first three WORDS of the command line. A command's ARGUMENTS are
 * arbitrary user-controlled strings, and no regex can establish that an
 * arbitrary argument is safe — `echo <secret>`,
 * `curl https://user:pass@host/...` and `psql postgresql://user:pass@host`
 * all leak a credential into the provider-visible summary.
 *
 * So the carried command information is now a CLASSIFICATION drawn from a
 * FINITE allowlist (`COMMAND_CLASSIFICATION_ALLOWLIST` /
 * `COMMAND_SUBCOMMAND_ALLOWLIST`). No user-supplied argument, path or URL
 * is ever persisted into the summary.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { canonicalSourceMessages } from "../../session/models/session-compaction";

/**
 * The maximum number of verified outcomes carried into one summary.
 *
 * The count is a fixed constant: the carried section's size must not grow
 * with the length of the session.
 */
export const MAX_CARRIED_OUTCOMES = 12;

/**
 * The maximum number of characters of a single carried outcome line.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: the carried
 * evidence is STRUCTURED, so this bounds the rendered line (tool name, call
 * id, status, command count and the redacted command subjects) rather than
 * a raw output excerpt.
 */
export const MAX_CARRIED_OUTCOME_CHARS = 240;

/**
 * The section heading. A stable, greppable marker so a carried section can
 * be located and replaced deterministically on a later compaction instead
 * of accumulating copies.
 */
export const EVIDENCE_SECTION_HEADING =
	"## Verified tool outcomes (canonical record)";

const EVIDENCE_BEGIN_MARKER = "<!-- cline-evidence:begin -->";
const EVIDENCE_END_MARKER = "<!-- cline-evidence:end -->";

/** The outcome classification of a canonical tool result. */
export type VerifiedOutcomeStatus = "succeeded" | "failed" | "unknown";

/**
 * Why a canonical result was NOT carried as a verified success.
 *
 * The absence of a carried entry is the truthful representation of "not
 * established", and these reasons make that absence AUDITABLE rather than
 * silent.
 */
export type VerifiedOutcomeRejectionReason =
	/** No canonical tool call matched the result's id. */
	| "unmatched_result"
	/** The result's id was claimed by more than one canonical call. */
	| "ambiguous_call_id"
	/**
	 * The call's id was answered by more than one canonical result.
	 *
	 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: a successful
	 * result followed by a contradictory failed result is ambiguous, so the
	 * whole id fails closed.
	 */
	| "ambiguous_result_id"
	/** The result's tool name did not match the matched call's name. */
	| "tool_name_mismatch"
	/** The result arrived before the call it claims to answer. */
	| "result_precedes_call"
	/** The result was flagged as an error. */
	| "result_is_error"
	/** The result carried no affirmative success signal. */
	| "no_success_signal"
	/** The result's payloads disagreed about the outcome. */
	| "conflicting_status"
	/** The result carried a failure signal in at least one payload. */
	| "payload_failure";

/** A single tool outcome recovered from the canonical history. */
export interface VerifiedToolOutcome {
	/** The canonical tool-call id this outcome belongs to. */
	toolUseId: string;
	/** The tool name, as the canonical call declared it. */
	toolName: string;
	/** The outcome classification derived from the result itself. */
	status: VerifiedOutcomeStatus;
	/** The canonical index of the tool CALL. */
	sourceIndex: number;
	/**
	 * A structured, allowlisted description of what the call did.
	 *
	 * This is NOT raw tool output. It is derived from the tool CALL's own
	 * declared input plus the result's own status, so no credential-bearing
	 * stdout/stderr can reach the provider-visible summary.
	 */
	evidence: VerifiedOutcomeEvidence;
}

/**
 * The structured, allowlisted evidence carried for one verified outcome.
 *
 * Every field is either a tool NAME, a bounded count, or a redacted
 * command SUBJECT. No field is raw tool output.
 */
export interface VerifiedOutcomeEvidence {
	/**
	 * The command CLASSIFICATION(S) the call declared, drawn from a finite
	 * allowlist.
	 *
	 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: these are
	 * NOT the user's command words. A command line's arguments are
	 * arbitrary user-controlled strings, so no regex can establish that an
	 * arbitrary argument is safe. Only a matched allowlist entry is carried.
	 */
	subjects: string[];
	/**
	 * The number of per-command payloads the result carried.
	 *
	 * A batch of N commands is carried only when all N succeeded, so this
	 * is the number of affirmatively successful commands.
	 */
	commandCount: number;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * A BOUNDED, SOURCE-ATTRIBUTED excerpt of one file's content.
 *
 * The excerpt is a fixed-cost fragment: it never grows with the transcript,
 * and it is always attributed to the source it was read from.
 */
export interface SourceFileFact {
	/** The source path, exactly as the tool reported it. */
	path: string;
	/** The bounded excerpt of the source's content. */
	excerpt: string;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * The maximum number of characters of a SINGLE source-attributed file fact.
 *
 * The carried representation is a bounded EXCERPT of one file's content. It
 * is a fixed constant, so neither the summarizer input nor the carried
 * evidence section grows with the transcript size.
 */
export const SOURCE_FILE_FACT_CHAR_LIMIT = 2_000;

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * The tool whose result is a SOURCE ATTRIBUTED FILE READ.
 *
 * The `read_files` executor persists one `{query, result, success}` payload
 * per requested file. Its `query` is the file PATH (optionally suffixed
 * with `:start-end`), and its `result` is that file's numbered content.
 *
 * This is a DISTINCT result class from a command's stdout: the payload
 * identifies the SOURCE it came from, and the payload body IS the source
 * text rather than arbitrary program output. That is what makes a bounded
 * excerpt of it safe to carry, and it is the class the Round C R4 witness
 * fact belongs to.
 */
const SOURCE_FILE_READ_TOOL_NAME = "read_files";

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * Truncate a carried excerpt to a bounded length, marking the cut.
 *
 * The marker is the same shape the compaction serializer uses, so a reader
 * (human or model) can tell that an excerpt was CUT rather than complete.
 */
function truncateText(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * Parse a source-file-read query into its source path.
 *
 * `formatReadFileQuery()` (in `../../extensions/tools/helpers.ts`) renders a
 * range as `<path>:<start>-<end>`. The range suffix is stripped so the
 * attribution names the SOURCE, not the line window.
 *
 * A query that is not a path-like string (no separator, or a bare
 * newline/control character) is rejected: the attribution must be a real
 * source, and an ambiguous attribution is worse than none.
 */
export function parseSourceFilePath(query: string): string | undefined {
	const trimmed = query.trim();
	if (!trimmed || /[\n\r\0]/.test(trimmed)) {
		return undefined;
	}
	// Strip a trailing `:start-end` / `:start` range suffix. The path itself
	// may legitimately contain a colon (a Windows drive), so only a suffix
	// that matches the range grammar is removed.
	const rangeMatch = /^(.*?):(\d+)(?:-(?:(\d+)|EOF))?$/.exec(trimmed);
	const candidate = rangeMatch?.[1] ?? trimmed;
	if (!candidate || (!candidate.includes("/") && !candidate.includes("\\"))) {
		return undefined;
	}
	return candidate;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * Strip the source-file-read line-number gutter from a file body.
 *
 * The production `read_files` executor renders each line as
 * `<number> | <content>`. The gutter is a PRESENTATION artifact of the
 * read tool, not part of the source, so the carried excerpt carries the
 * source text itself.
 *
 * A body whose lines do NOT carry the gutter is left untouched: it is
 * still source-attributed by path, and mangling an unrecognized shape
 * would be worse than carrying it verbatim.
 */
export function stripSourceLineGutter(body: string): string {
	const lines = body.split("\n");
	const gutter = /^\s*\d+\s*\|\s?/;
	// Only strip when EVERY non-empty line carries the gutter.
	const meaningful = lines.filter((line) => line.trim().length > 0);
	if (
		meaningful.length === 0 ||
		!meaningful.every((line) => gutter.test(line))
	) {
		return body;
	}
	return lines
		.map((line) => (gutter.test(line) ? line.replace(gutter, "") : line))
		.join("\n");
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * Build the bounded, source-attributed file fact for ONE structured result
 * payload, or return undefined when the payload is not a source-attributed
 * file read.
 *
 * The conditions are ALL required:
 *
 *   1. The result's tool is the source-file read tool.
 *   2. The payload SUCCEEDED. A failed read establishes no file content.
 *   3. The query names a source path.
 *   4. The result is a non-empty STRING.
 *
 * The excerpt is bounded by `SOURCE_FILE_FACT_CHAR_LIMIT` characters, so
 * the carried representation is a fixed cost per payload.
 */
export function buildSourceFileFact(
	payload: Record<string, unknown>,
	toolName: string | undefined,
): SourceFileFact | undefined {
	if (toolName !== SOURCE_FILE_READ_TOOL_NAME) {
		return undefined;
	}
	if (payload.success === false || payload.isError === true) {
		return undefined;
	}
	if (payload.success !== true) {
		// No affirmative success signal: the read establishes nothing.
		return undefined;
	}
	const rawQuery = payload.query;
	if (typeof rawQuery !== "string") {
		return undefined;
	}
	const path = parseSourceFilePath(rawQuery);
	if (!path) {
		return undefined;
	}
	const rawResult = payload.result;
	if (typeof rawResult !== "string" || rawResult.trim().length === 0) {
		return undefined;
	}
	const stripped = stripSourceLineGutter(rawResult);
	// ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-3): a
	// SOURCE file can contain CREDENTIALS -- a `.env`, a configmap with a
	// password, a private key. The excerpt is therefore REDACTED with the
	// module's existing value-position sanitizer before it is carried.
	//
	// This is a NARROW, EXPLICIT exception to the module's standing rule
	// ("no regex can be made safe for arbitrary output"): the rule exists
	// because arbitrary tool OUTPUT has no attribution. Here the content is
	// the SOURCE the agent was reading, and the sanitizer is applied to the
	// VALUE position of a credential-shaped assignment, so a value that
	// cannot be shown to be safe is redacted rather than carried.
	//
	// The sanitizer is NOT trusted to make arbitrary content safe: it is
	// applied on top of the source-attribution requirement, and the excerpt
	// is still bounded.
	const redacted = sanitizeOutcomeText(stripped);
	return {
		path,
		excerpt: truncateText(redacted, SOURCE_FILE_FACT_CHAR_LIMIT),
	};
}

/** A canonical outcome that was NOT carried, with the reason why. */
export interface RejectedVerifiedOutcome {
	/** The canonical tool-call id the result claimed. */
	toolUseId: string;
	/** The tool name the result declared, when it declared one. */
	toolName?: string;
	/** Why the outcome was not carried. */
	reason: VerifiedOutcomeRejectionReason;
	/** The canonical index of the tool RESULT (or of the call, when known). */
	sourceIndex: number;
}

/** The verified outcomes recovered from a canonical history. */
export interface VerifiedOutcomeLedger {
	outcomes: VerifiedToolOutcome[];
	/**
	 * The canonical results that were NOT carried, with the reason why.
	 *
	 * This makes the absence of a carried entry auditable: a reviewer can
	 * tell "the operation failed" apart from "the join was ambiguous" and
	 * apart from "the result carried no signal at all".
	 */
	rejected: RejectedVerifiedOutcome[];
}

/**
 * The explicit success/failure signal of a tool result.
 *
 * The signal is read from the RESULT ITSELF, never from the tool name and
 * never from a provider id.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01:
 *
 *   - The `success: boolean` payload field is the ONLY affirmative success
 *     signal. `isError: false` is NOT affirmative: it establishes that no
 *     error was reported, not that the operation succeeded.
 *   - A result may carry MANY payloads (one per command in a batch). The
 *     classification is the AGGREGATE over all payloads, and a single
 *     failure poisons the aggregate: the batch did not wholly succeed, so
 *     it is not carried as a success.
 *   - A result with no payload carrying a signal is `unknown`, which is
 *     not carried.
 */
export function classifyToolResultStatus(resultBlock: {
	is_error?: boolean;
	content: unknown;
}): VerifiedOutcomeStatus {
	if (resultBlock.is_error === true) {
		return "failed";
	}
	const payloads =
		Array.isArray(resultBlock.content) &&
		resultBlock.content.every((item) => item && typeof item === "object")
			? (resultBlock.content as Record<string, unknown>[])
			: [];
	let sawSuccess = false;
	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: EVERY payload
	// must AFFIRMATIVELY succeed. A payload that carries no affirmative
	// signal (for example `{success: true}` alongside `{isError: false}`)
	// leaves the batch NOT wholly verified.
	let sawUnverifiedPayload = false;
	for (const payload of payloads) {
		// All failure indicators are checked INDEPENDENTLY on the SAME
		// payload. The previous implementation used `continue` after
		// `success === true`, which BYPASSED the `isError` check on that
		// payload and so accepted `{success: true, isError: true}`.
		if (payload.success === false || payload.isError === true) {
			return "failed";
		}
		if (payload.success === true) {
			sawSuccess = true;
			continue;
		}
		// `isError: false` is deliberately NOT a success signal: it only
		// says that no error was reported. A payload that carries such a
		// flag but no affirmative success leaves the outcome UNVERIFIED.
		sawUnverifiedPayload = true;
	}
	if (sawUnverifiedPayload) {
		// At least one payload did not affirm success, so the batch is not
		// wholly verified. "No evidence of failure" is not "evidence of
		// success".
		return "unknown";
	}
	return sawSuccess ? "succeeded" : "unknown";
}

/**
 * The maximum number of characters of a single carried command label.
 */
export const MAX_CARRIED_SUBJECT_CHARS = 160;

/**
 * The maximum number of command labels carried for one outcome.
 */
export const MAX_CARRIED_SUBJECTS = 4;

/**
 * The FINITE allowlist of command classifications that may be carried.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: the previous
 * implementation carried the first three WORDS of the command line. Command
 * arguments are arbitrary user-controlled strings, and no regex can
 * establish that an arbitrary argument is safe — `echo <secret>`,
 * `curl https://user:pass@host/...` and `psql postgresql://user:pass@host`
 * all leak the credential into the provider-visible summary.
 *
 * So the carried evidence is now a CLASSIFICATION drawn from this finite
 * allowlist. Nothing that came from the user's command line other than the
 * matched classification is persisted.
 *
 * Each entry is matched as a PREFIX of the command's leading words, and the
 * LONGEST matching entry wins, so `helm template` is preferred over `helm`.
 */
export const COMMAND_CLASSIFICATION_ALLOWLIST: readonly string[] = [
	"bash",
	"cat",
	"curl",
	"docker",
	"echo",
	"find",
	"git",
	"grep",
	"helm",
	"kubectl",
	"ls",
	"make",
	"npm",
	"pwd",
	"python",
	"read_files",
	"rg",
	"run_commands",
	"sed",
	"tar",
	"unzip",
	"wget",
	"yarn",
];

/**
 * The command SUBCOMMAND classifications that refine a base command.
 *
 * A base command alone ("helm") is too coarse to be useful, and a base
 * command plus a free-form argument is unsafe. These entries are the
 * finite set of two-word classifications that MAY be carried.
 */
export const COMMAND_SUBCOMMAND_ALLOWLIST: readonly string[] = [
	"git status",
	"git diff",
	"git log",
	"git show",
	"helm template",
	"helm lint",
	"helm list",
	"helm dependency",
	"kubectl apply",
	"kubectl describe",
	"kubectl get",
	"kubectl logs",
	"make build",
	"make test",
	"npm run",
	"npm test",
	"docker build",
	"docker ps",
];

/**
 * Characters that make a command segment AMBIGUOUS.
 *
 * A segment containing any of these cannot be reduced to "the executable this
 * segment runs" without executing a shell, so the classifier FAILS CLOSED on
 * it and carries nothing. This is the difference between reading a command
 * line and INTERPRETING one: this module deliberately does not implement a
 * shell.
 *
 *   - `$`, backtick — command substitution: the executed word is not the word
 *     that is written.
 *   - `(`, `)`, `{`, `}` — subshell / brace grouping.
 *   - `>`, `<` — redirection: the executed word is not necessarily the first
 *     word of the segment.
 *   - `&` — background execution.
 *   - `*`, `?`, `[`, `]`, `~` — globbing / tilde expansion: the written word
 *     is not the executed path.
 *   - `!` — history expansion.
 */
const AMBIGUOUS_SEGMENT_CHARACTERS = /[$`(){}[\]<>*?~!&]/;

/**
 * Split a command line into its shell SEGMENTS.
 *
 * The split is QUOTE-AWARE: a `&&` inside a quoted string is data, not an
 * operator. Every segment records the operator that FOLLOWED it, because the
 * operator's semantics decide whether the next segment continues the same
 * logical command or starts an independent one.
 *
 * The returned segments are RAW TEXT. They are never carried; they are only
 * inspected to locate an executable word.
 */
function splitShellSegments(command: string): {
	text: string;
	operator: "&&" | "||" | ";" | "|" | "";
}[] {
	const segments: {
		text: string;
		operator: "&&" | "||" | ";" | "|" | "";
	}[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];
		// Inside a single-quoted string NOTHING is an operator.
		if (quote === "'") {
			current += character;
			if (character === "'") {
				quote = undefined;
			}
			continue;
		}
		if (quote === '"') {
			current += character;
			if (character === '"') {
				quote = undefined;
			}
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			current += character;
			continue;
		}
		// A backslash escapes the next character, so it cannot start an
		// operator.
		if (character === "\\") {
			current += character;
			if (index + 1 < command.length) {
				index += 1;
				current += command[index];
			}
			continue;
		}
		const twoCharacterOperator = command.slice(index, index + 2);
		if (twoCharacterOperator === "&&" || twoCharacterOperator === "||") {
			segments.push({ text: current, operator: twoCharacterOperator });
			current = "";
			index += 1;
			continue;
		}
		if (character === ";" || character === "|") {
			segments.push({ text: current, operator: character });
			current = "";
			continue;
		}
		current += character;
	}
	segments.push({ text: current, operator: "" });
	return segments;
}

/**
 * The leading words of a command segment, with quoted runs kept intact.
 *
 * This is the SAME word-splitting the pre-existing classifier used, so a
 * single-segment command classifies exactly as it did before.
 */
function splitSegmentWords(segment: string): string[] {
	return segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

/**
 * Strip the QUOTED regions of a segment.
 *
 * A quoted region is INERT DATA: the shell does not interpret an operator, a
 * substitution or a glob inside single quotes, and inside double quotes it
 * interprets only `$` and backtick. So the ambiguity check must look at the
 * segment's STRUCTURE, not at the literal characters of its arguments.
 *
 * The stripped text keeps a single space in place of each quoted run so that
 * word boundaries are preserved.
 */
function stripQuotedRegions(segment: string): string {
	let result = "";
	let quote: '"' | "'" | undefined;
	for (let index = 0; index < segment.length; index += 1) {
		const character = segment[index];
		if (quote === undefined) {
			if (character === "'" || character === '"') {
				quote = character;
				result += " ";
				continue;
			}
			result += character;
			continue;
		}
		if (character === quote) {
			quote = undefined;
			result += " ";
			continue;
		}
		// Inside DOUBLE quotes the shell still performs `$` expansion and
		// backtick substitution, so those characters stay VISIBLE to the
		// ambiguity check. Inside SINGLE quotes nothing is interpreted, so
		// the whole run becomes inert data.
		if (quote === '"' && (character === "$" || character === "`")) {
			result += character;
			continue;
		}
		// Every other quoted character becomes a space: the quoted run is one
		// argument, whatever it contains.
		result += " ";
	}
	return result;
}

/**
 * Whether a segment is safe to reduce to its executable word.
 *
 * A segment is safe when its STRUCTURE contains no character that could
 * change WHICH word the shell executes, and when its first word is a plain
 * executable name (not a quoted path that could carry a secret through the
 * allowlist match).
 */
function isUnambiguousSegment(segment: string): boolean {
	if (AMBIGUOUS_SEGMENT_CHARACTERS.test(stripQuotedRegions(segment))) {
		return false;
	}
	const executable = splitSegmentWords(segment)[0];
	if (executable === undefined) {
		return false;
	}
	// A quoted executable is not matched by the allowlist (the allowlist
	// entries are bare command names), but it is rejected here so a segment
	// can never be "recognised" through quoting tricks.
	return !/["']/.test(executable);
}

/**
 * The classification of ONE command segment, or `""` when the segment does
 * not name an allowlisted executable.
 */
function classifySegment(segment: string): string {
	const words = splitSegmentWords(segment);
	const firstWord = words[0];
	if (firstWord === undefined) {
		return "";
	}
	// A shell chain's leading redirector is not part of the command.
	const first = firstWord.replace(/^[;&|]+\s*/, "");
	const secondWord = words[1];
	const two = secondWord === undefined ? first : `${first} ${secondWord}`;

	// The longest allowlist match wins, so a two-word classification is
	// preferred over its base command.
	let match = "";
	for (const candidate of COMMAND_SUBCOMMAND_ALLOWLIST) {
		if (two === candidate || two.startsWith(`${candidate} `)) {
			if (candidate.length > match.length) {
				match = candidate;
			}
		}
	}
	if (match) {
		return match;
	}
	for (const candidate of COMMAND_CLASSIFICATION_ALLOWLIST) {
		if (first === candidate) {
			if (candidate.length > match.length) {
				match = candidate;
			}
		}
	}
	return match;
}

/**
 * Classify a command into the finite allowlist.
 *
 * The command's LEADING WORDS are matched against the allowlist. Only the
 * matched allowlist entry is returned — never the user's words themselves.
 * A command that matches nothing yields no classification, and the outcome
 * is then carried with an empty label list: the verified FACT survives and
 * nothing unverified is invented.
 *
 * ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01 (S1) — SHELL CHAINS.
 *
 * The pre-existing implementation matched the WHOLE LINE's leading words, so
 * a common `cd <path> && <cmd>` chain matched nothing: `cd` is not in the
 * allowlist, and the classification of the command that ACTUALLY ran was
 * lost. This is the Round C defect — every carried verified-outcome line
 * degraded to "succeeded — N commands" with no indication of what ran.
 *
 * The corrected implementation reads the command line as a sequence of shell
 * SEGMENTS and classifies the executable of the segment that carries the
 * work. The invariants are preserved:
 *
 *   - The carried value is ALWAYS a finite-allowlist entry. No user-supplied
 *     path, argument, URL or credential is ever carried.
 *   - The classifier is NOT a shell. A segment that contains a character
 *     which could change WHICH word the shell executes (command
 *     substitution, redirection, globbing, backgrounding, grouping, history
 *     expansion) is AMBIGUOUS and the whole chain is skipped.
 *   - A chain that names MORE THAN ONE allowlisted executable is AMBIGUOUS:
 *     which one ran is not decidable from the text alone, so nothing is
 *     carried. One label is carried, or none.
 *
 * The `cd` prefix is recognised as a DIRECTORY CHANGE, not as a command:
 * `cd <path> && <cmd>` classifies `<cmd>`. The `cd` segment's own argument is
 * a path and is never carried.
 *
 * THE REPORTED STATUS BELONGS TO THE LAST SEGMENT
 * -----------------------------------------------
 *
 * A shell chain reports the exit status of its LAST segment, whatever
 * operators joined the segments. So a trailing segment MASKS the status of
 * every segment before it: `helm template broken; echo done` exits 0 even
 * though Helm itself failed, and `helm template broken; some-unknown-tool`
 * does the same.
 *
 * A classification may therefore be attributed ONLY when the classified
 * segment is the LAST segment of the chain. Otherwise the wrapper's success
 * says nothing about the classified command's own outcome, and carrying the
 * classification would report a failure as a success — the same
 * misattribution defect as a pipeline or a `||` chain.
 *
 * This preserves the supported `cd /repo; helm template kc` shape: the
 * classified command IS the last segment there, so its status IS the status
 * the shell reported. The `cd` segment contributes no classification and
 * never carries its path.
 */
export function classifyCommand(command: string): string {
	const normalized = command.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		return "";
	}
	if (normalized.includes("\n")) {
		// A newline is a shell command-list separator. Without `set -e`, a
		// later successful command can hide an earlier failure, so the
		// executed command is not decidable from this text alone. Fail
		// closed rather than attributing the wrapper status to one command.
		return "";
	}
	const segments = splitShellSegments(normalized).filter((segment) => {
		return splitSegmentWords(segment.text).length > 0;
	});
	if (segments.length === 0) {
		return "";
	}
	const classifications: string[] = [];
	// The index of the segment that produced the classification. The shell
	// reports the LAST segment's exit status, so a classification is only
	// attributable when its segment IS that last one.
	let classifiedSegmentIndex = -1;
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		if (segment.operator === "|") {
			// A PIPELINE is AMBIGUOUS. The shell's exit status of a pipeline is
			// the status of its LAST element, so a successful wrapper does not
			// establish that the earlier element succeeded — this is exactly
			// the Round C R1 failure (a `helm template | head` chain reported
			// success while Helm itself failed). Fail closed.
			return "";
		}
		if (segment.operator === "||") {
			// A `||` chain runs its second segment only when the FIRST one
			// FAILED. Which segment ran is therefore not decidable from the
			// text. Fail closed.
			return "";
		}
		if (!isUnambiguousSegment(segment.text)) {
			// An AMBIGUOUS segment makes the whole chain undecidable. Fail
			// closed: carry nothing rather than guess which command ran. This
			// validation applies to `cd` too: a directory-change segment can
			// still execute command substitution or redirection.
			return "";
		}
		const executable = splitSegmentWords(segment.text)[0]?.replace(
			/^[;&|]+\s*/,
			"",
		);
		// The `cd` prefix is a DIRECTORY CHANGE, not the command that ran. It
		// never contributes a classification: `cd`'s argument is a PATH, and a
		// path must never be carried.
		if (executable === "cd") {
			continue;
		}
		const classification = classifySegment(segment.text);
		if (classification) {
			classifications.push(classification);
			classifiedSegmentIndex = index;
		}
	}
	if (classifications.length === 0) {
		return "";
	}
	if (classifications.length > 1) {
		// MORE THAN ONE allowlisted executable in the chain: which one ran is
		// not decidable from the command text, so nothing is carried.
		return "";
	}
	if (classifiedSegmentIndex !== segments.length - 1) {
		// A TRAILING segment follows the classified one. The shell reports
		// the LAST segment's exit status, so the classified command's own
		// outcome is MASKED by that trailing segment: `helm template broken;
		// echo done` exits 0 even though Helm failed. The wrapper's success
		// therefore establishes nothing about the classified command, and
		// attributing it would report a failure as a success. Fail closed.
		//
		// The trailing segment need not be allowlisted for this to hold —
		// `helm template broken; some-unknown-tool` masks Helm's status in
		// exactly the same way.
		return "";
	}
	const match = classifications[0];
	if (match.length > MAX_CARRIED_SUBJECT_CHARS) {
		return `${match.slice(0, MAX_CARRIED_SUBJECT_CHARS)}...`;
	}
	return match;
}

/**
 * Redact credential-shaped values from a COMMAND SUBJECT.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: this function
 * operates ONLY on the structured subject derived from the tool CALL's
 * declared input. It is NOT a sanitizer for arbitrary tool output — the
 * module no longer carries raw output at all, precisely because no regex
 * can be made safe for arbitrary output.
 *
 * The redaction is applied at the VALUE POSITION of a `key=value` or
 * `key: value` pair, and it consumes the ENTIRE quoted value (including
 * spaces and punctuation) rather than a whitespace-delimited token. That is
 * what makes it safe for the formats the first cut missed:
 *
 *   - `DB_PASSWORD=hunter2`
 *   - `{"password":"sensitiveExample123"}`
 *   - `password="two word secret"`
 *   - `apiKey: "a b c"`
 *
 * A value that cannot be shown to be safe is redacted rather than carried.
 */
export function sanitizeOutcomeText(text: string): string {
	return (
		text
			// KEY=value / KEY: value assignments whose key names a secret.
			// The value runs to the end of the quoted string (spaces and all)
			// or to the next delimiter, so a multi-word secret is consumed
			// whole rather than partially.
			.replace(
				/("?)((?:[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth[_-]?key|passphrase)[A-Za-z0-9_.-]*)\1\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)\]}]+)/gi,
				"$1$2[REDACTED]",
			)
			// Bearer headers.
			.replace(
				/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
				"$1 [REDACTED]",
			)
			// PEM private key blocks.
			.replace(
				/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
				"[REDACTED PRIVATE KEY]",
			)
			// Common provider-shaped keys that are not key=value.
			.replace(
				/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
				"[REDACTED]",
			)
	);
}

/**
 * Collect the declared command labels for a tool CALL.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: the labels come
 * from the FINITE classification allowlist, never from the user's command
 * words. A tool call that declares no recognizable command yields no label,
 * and the outcome is carried with an empty label list — the verified FACT
 * survives, and no unverified text is invented.
 */
function collectCallSubjects(input: unknown): string[] {
	const subjects: string[] = [];
	const push = (value: unknown): void => {
		if (typeof value === "string") {
			const label = classifyCommand(value);
			if (label && !subjects.includes(label)) {
				subjects.push(label);
			}
			return;
		}
		// A command list (`commands: [...]`) is an ARRAY of command strings.
		if (Array.isArray(value)) {
			for (const item of value) {
				push(item);
			}
		}
	};
	const visit = (value: unknown, depth: number): void => {
		if (depth > 3) {
			return;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				visit(item, depth + 1);
			}
			return;
		}
		if (!value || typeof value !== "object") {
			return;
		}
		for (const [key, nested] of Object.entries(
			value as Record<string, unknown>,
		)) {
			// The keys that carry an executable command in the production
			// tool-call shapes. This is a DATA SHAPE allowlist, not a
			// provider- or tool-name branch.
			if (
				key === "command" ||
				key === "commands" ||
				key === "query" ||
				key === "script" ||
				key === "path" ||
				key === "file_path" ||
				key === "filePath"
			) {
				push(nested);
				continue;
			}
			if (nested && typeof nested === "object") {
				visit(nested, depth + 1);
			}
		}
	};
	visit(input, 0);
	return subjects.slice(0, MAX_CARRIED_SUBJECTS);
}

/**
 * Recover the verified tool outcomes from the CANONICAL history.
 *
 * The canonical history MUST be the canonical history, not a compacted
 * projection: a previous summary is never an authority source, and a
 * projection may already have dropped the very outcomes being recovered.
 *
 * Outcomes are returned in canonical order (the order the calls were made),
 * and at most `MAX_CARRIED_OUTCOMES` of them are kept - the most RECENT
 * ones, because a later verification supersedes an earlier one for the
 * same subject.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: attribution
 * FAILS CLOSED.
 *
 *   - A tool-call id claimed by MORE THAN ONE canonical call is ambiguous.
 *     Neither claim is trusted and the id's outcome is not carried.
 *   - A result whose declared tool name disagrees with the matched call's
 *     name is not attributed to that call.
 *   - A result that appears BEFORE the call it claims to answer is not
 *     attributed to it.
 *
 * Every non-carried result is recorded in `rejected` with the reason, so
 * the absence of a carried entry is auditable rather than silent.
 */
export function extractVerifiedToolOutcomes(
	canonicalMessages: readonly MessageWithMetadata[],
): VerifiedOutcomeLedger {
	/** The canonical tool calls, by tool-call id. */
	const callsById = new Map<
		string,
		{ toolName: string; sourceIndex: number; callCount: number }
	>();
	/** The canonical tool results, in canonical order. */
	const results: {
		toolUseId: string;
		toolName?: string;
		status: VerifiedOutcomeStatus;
		sourceIndex: number;
		commandCount: number;
		/**
		 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01: the raw result
		 * CONTENT, kept so the source-attributed file fact can be derived
		 * from the SAME canonical payload the status was derived from.
		 */
		content: unknown;
	}[] = [];
	/**
	 * How many canonical results claimed each tool-call id.
	 *
	 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: a call id
	 * answered by MORE THAN ONE result is ambiguous in the same way a
	 * duplicated call is. A successful result followed by a contradictory
	 * failed result must not leave the successful one carried.
	 */
	const resultCountsById = new Map<string, number>();

	for (let index = 0; index < canonicalMessages.length; index += 1) {
		const message = canonicalMessages[index];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				const existing = callsById.get(block.id);
				if (existing) {
					existing.callCount += 1;
					continue;
				}
				callsById.set(block.id, {
					toolName: block.name,
					sourceIndex: index,
					callCount: 1,
				});
				continue;
			}
			if (block.type !== "tool_result") {
				continue;
			}
			resultCountsById.set(
				block.tool_use_id,
				(resultCountsById.get(block.tool_use_id) ?? 0) + 1,
			);
			results.push({
				toolUseId: block.tool_use_id,
				toolName:
					typeof (block as { name?: unknown }).name === "string"
						? ((block as { name?: string }).name as string)
						: undefined,
				status: classifyToolResultStatus(block),
				sourceIndex: index,
				commandCount: countSignalPayloads(block.content),
				content: block.content,
			});
		}
	}

	const outcomes: VerifiedToolOutcome[] = [];
	const rejected: RejectedVerifiedOutcome[] = [];
	const reject = (entry: {
		toolUseId: string;
		toolName?: string;
		reason: VerifiedOutcomeRejectionReason;
		sourceIndex: number;
	}): void => {
		rejected.push(entry);
	};
	for (const result of results) {
		const call = callsById.get(result.toolUseId);
		if (!call) {
			reject({
				toolUseId: result.toolUseId,
				toolName: result.toolName,
				reason: "unmatched_result",
				sourceIndex: result.sourceIndex,
			});
			continue;
		}
		if (call.callCount > 1) {
			// The id was claimed by more than one call: the join is
			// ambiguous, so neither claim can be trusted.
			reject({
				toolUseId: result.toolUseId,
				toolName: result.toolName,
				reason: "ambiguous_call_id",
				sourceIndex: call.sourceIndex,
			});
			continue;
		}
		if ((resultCountsById.get(result.toolUseId) ?? 0) > 1) {
			// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: the
			// call was answered by MORE THAN ONE result. A successful result
			// followed by a contradictory failed result must not leave the
			// successful one carried, so the whole id fails closed.
			reject({
				toolUseId: result.toolUseId,
				toolName: result.toolName,
				reason: "ambiguous_result_id",
				sourceIndex: call.sourceIndex,
			});
			continue;
		}
		if (result.toolName !== undefined && result.toolName !== call.toolName) {
			reject({
				toolUseId: result.toolUseId,
				toolName: result.toolName,
				reason: "tool_name_mismatch",
				sourceIndex: call.sourceIndex,
			});
			continue;
		}
		if (result.sourceIndex < call.sourceIndex) {
			reject({
				toolUseId: result.toolUseId,
				toolName: result.toolName,
				reason: "result_precedes_call",
				sourceIndex: result.sourceIndex,
			});
			continue;
		}
		if (result.status !== "succeeded") {
			reject({
				toolUseId: result.toolUseId,
				toolName: result.toolName,
				reason:
					result.status === "failed" ? "payload_failure" : "no_success_signal",
				sourceIndex: call.sourceIndex,
			});
			continue;
		}
		outcomes.push({
			toolUseId: result.toolUseId,
			toolName: call.toolName,
			status: result.status,
			sourceIndex: call.sourceIndex,
			evidence: {
				subjects: collectCallSubjects(
					findCallInput(canonicalMessages, call.sourceIndex, result.toolUseId),
				),
				commandCount: result.commandCount,
			},
		});
	}

	outcomes.sort((left, right) => left.sourceIndex - right.sourceIndex);
	if (outcomes.length > MAX_CARRIED_OUTCOMES) {
		outcomes.splice(0, outcomes.length - MAX_CARRIED_OUTCOMES);
	}
	return { outcomes, rejected };
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01
 *
 * Extract the bounded, source-attributed file facts from a canonical result's
 * content, or return an empty array.
 *
 * The rules are the SAME fail-closed rules that govern the verified status
 * itself:
 *
 *   1. The content must be an ARRAY of structured payloads (the production
 *      `read_files` / `run_commands` result shape).
 *   2. EVERY payload must carry an affirmative `success: true` and no
 *      failure signal. A batch with one failed payload is not a wholly
 *      verified read, so NO fact is extracted from it -- the same rule that
 *      keeps a mixed batch from certifying a success.
 *
 * A MULTI-FILE batch is NOT ambiguous: each payload carries its OWN
 * attribution (its own source path), so each payload contributes its own
 * independently attributed fact. The facts are returned in payload order.
 */
function extractSourceFileFactsFromContent(
	content: unknown,
	toolName: string | undefined,
): SourceFileFact[] {
	if (!Array.isArray(content) || content.length === 0) {
		return [];
	}
	const payloads = content.filter(
		(payload): payload is Record<string, unknown> =>
			payload !== null &&
			typeof payload === "object" &&
			!Array.isArray(payload),
	);
	if (payloads.length !== content.length) {
		// An unrecognized entry shape: the batch is not wholly understood.
		return [];
	}
	const facts: SourceFileFact[] = [];
	for (const payload of payloads) {
		const fact = buildSourceFileFact(payload, toolName);
		if (!fact) {
			// The batch is not wholly a verified source-file read: fail
			// closed for the WHOLE batch, so a mixed result cannot smuggle a
			// fact past a failure signal.
			return [];
		}
		facts.push(fact);
	}
	return facts;
}

/**
 * The number of result payloads that carried a success/failure signal.
 *
 * This is the number of commands the result actually reported on. It is
 * carried as structured evidence so the continuing model knows whether the
 * verified success covered one command or a batch, without seeing any of
 * the output.
 */
function countSignalPayloads(content: unknown): number {
	if (!Array.isArray(content)) {
		return 1;
	}
	let count = 0;
	for (const payload of content) {
		if (!payload || typeof payload !== "object") {
			continue;
		}
		const record = payload as Record<string, unknown>;
		if (record.success !== undefined || record.isError !== undefined) {
			count += 1;
		}
	}
	return count > 0 ? count : 1;
}

/**
 * The declared input of the tool CALL at `sourceIndex` with `toolUseId`.
 */
function findCallInput(
	canonicalMessages: readonly MessageWithMetadata[],
	sourceIndex: number,
	toolUseId: string,
): unknown {
	const message = canonicalMessages[sourceIndex];
	if (!message || !Array.isArray(message.content)) {
		return undefined;
	}
	for (const block of message.content) {
		if (block.type === "tool_use" && block.id === toolUseId) {
			return (block as { input?: unknown }).input;
		}
	}
	return undefined;
}

/**
 * Escape delimiter occurrences inside carried source text.
 *
 * Anti-spoofing: an occurrence of a delimiter inside a carried excerpt is
 * escaped before the excerpt is embedded, so tool output can never open or
 * close the generated section and thereby forge a new authority.
 */
function escapeDelimiters(text: string): string {
	return text
		.split(EVIDENCE_BEGIN_MARKER)
		.join(`\\${EVIDENCE_BEGIN_MARKER}`)
		.split(EVIDENCE_END_MARKER)
		.join(`\\${EVIDENCE_END_MARKER}`);
}

/**
 * Render the deterministic carry-forward section for the verified outcomes.
 *
 * Returns `undefined` when there is nothing verified to carry, so the
 * caller can leave the summary untouched - no synthetic section is invented.
 *
 * The output is a pure function of the canonical outcomes: the same canonical
 * history always yields byte-identical text.
 *
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: the section
 * carries STRUCTURED evidence only - the tool name, the call id, the
 * verified status, the number of commands the result covered, and the
 * redacted command subjects. It never carries raw tool output.
 */
export function renderEvidenceSection(
	ledger: VerifiedOutcomeLedger,
): string | undefined {
	if (ledger.outcomes.length === 0) {
		return undefined;
	}
	const lines: string[] = [];
	for (const outcome of ledger.outcomes) {
		const details: string[] = [];
		if (outcome.evidence.commandCount > 1) {
			details.push(`${outcome.evidence.commandCount} commands`);
		}
		for (const subject of outcome.evidence.subjects) {
			details.push(escapeDelimiters(subject));
		}
		const suffix = details.length > 0 ? ` — ${details.join("; ")}` : "";
		const line = `- ${outcome.toolName} (${outcome.toolUseId}): succeeded${suffix}`;
		lines.push(
			line.length > MAX_CARRIED_OUTCOME_CHARS
				? `${line.slice(0, MAX_CARRIED_OUTCOME_CHARS)}...`
				: line,
		);
	}
	return [
		EVIDENCE_SECTION_HEADING,
		EVIDENCE_BEGIN_MARKER,
		...lines,
		EVIDENCE_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried evidence section from a summary text.
 *
 * This makes the carry-forward IDEMPOTENT: a later compaction replaces the
 * carried section with the section derived from the CURRENT canonical
 * authority instead of appending a second copy.
 *
 * The HEADING is removed together with the delimited body. Stripping only
 * the body would leave an orphaned heading behind, and the next carry-forward
 * would then produce a duplicate heading - the exact accumulation this
 * function exists to prevent.
 */
export function stripEvidenceSection(summaryText: string): string {
	const begin = summaryText.indexOf(EVIDENCE_BEGIN_MARKER);
	if (begin === -1) {
		return summaryText;
	}
	const end = summaryText.indexOf(EVIDENCE_END_MARKER, begin);
	// The section's own heading, when present, sits immediately before the
	// begin marker.
	const headingIndex = summaryText.lastIndexOf(EVIDENCE_SECTION_HEADING, begin);
	const sectionStart =
		headingIndex !== -1 &&
		summaryText
			.slice(headingIndex + EVIDENCE_SECTION_HEADING.length, begin)
			.trim() === ""
			? headingIndex
			: begin;
	if (end === -1) {
		// A malformed (truncated) section is removed to its end so a partial
		// record can never be presented as a complete one.
		return summaryText.slice(0, sectionStart).trimEnd();
	}
	const before = summaryText.slice(0, sectionStart).trimEnd();
	const after = summaryText.slice(end + EVIDENCE_END_MARKER.length).trimStart();
	if (!before) {
		return after;
	}
	if (!after) {
		return before;
	}
	return `${before}\n\n${after}`;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2)
 *
 * The section heading for the SOURCE-ATTRIBUTED FILE FACTS.
 *
 * It is a SEPARATE section from the verified-outcomes section on purpose.
 * The verified-outcomes section is bounded by `MAX_CARRIED_OUTCOMES`, which
 * keeps the MOST RECENT outcomes. A source-file read that happened early in
 * the session therefore falls outside that window, and the deterministic
 * carry-forward would stop rescuing the fact once the window has moved past
 * it.
 *
 * The file-fact section has its OWN, independently bounded budget
 * (`MAX_CARRIED_FILE_FACTS`), because a file fact is a different KIND of
 * evidence: it is a bounded, source-attributed excerpt, not an execution
 * status. Keeping it inside the outcome budget would let an execution-status
 * budget silently decide a factual question.
 */
export const SOURCE_FILE_FACT_SECTION_HEADING =
	"## Source file facts (canonical record)";

const SOURCE_FILE_FACT_BEGIN_MARKER = "<!-- cline-file-facts:begin -->";
const SOURCE_FILE_FACT_END_MARKER = "<!-- cline-file-facts:end -->";

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2)
 *
 * The maximum number of source-file facts carried into one summary.
 *
 * It is a FIXED constant, independent of the transcript size. The budget is
 * SEPARATE from `MAX_CARRIED_OUTCOMES` on purpose: the outcome budget is an
 * execution-status budget, and it must not be the thing that decides whether
 * a bounded factual excerpt survives.
 */
export const MAX_CARRIED_FILE_FACTS = 12;

/**
 * Escape delimiter occurrences inside a carried source-file fact.
 *
 * The same anti-spoofing rule as the outcome section: a carried excerpt can
 * never open or close the generated section and thereby forge a new
 * authority.
 */
function escapeFileFactDelimiters(text: string): string {
	return text
		.split(SOURCE_FILE_FACT_BEGIN_MARKER)
		.join(`\\${SOURCE_FILE_FACT_BEGIN_MARKER}`)
		.split(SOURCE_FILE_FACT_END_MARKER)
		.join(`\\${SOURCE_FILE_FACT_END_MARKER}`);
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2)
 *
 * Collect the bounded, source-attributed file facts from the CANONICAL
 * history, independently of the verified-outcome budget.
 *
 * The rules are the same fail-closed rules:
 *
 *   1. The canonical history must contain the tool CALL and the matching
 *      tool RESULT, with the same attribution rules the outcome ledger uses
 *      (no unmatched, ambiguous or contradicting id).
 *   2. The result must be wholly verified: every payload affirmatively
 *      succeeded.
 *   3. The payloads must be source-file reads whose queries name a source
 *      path.
 *
 * The facts are returned in canonical order, most recent last, and at most
 * `MAX_CARRIED_FILE_FACTS` of them are kept.
 */
export function extractSourceFileFacts(
	canonicalMessages: readonly MessageWithMetadata[],
): SourceFileFact[] {
	const callsById = new Map<
		string,
		{ toolName: string; sourceIndex: number; callCount: number }
	>();
	const results: {
		toolUseId: string;
		toolName?: string;
		sourceIndex: number;
		content: unknown;
	}[] = [];
	const resultCountsById = new Map<string, number>();

	for (let index = 0; index < canonicalMessages.length; index += 1) {
		const message = canonicalMessages[index];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				const existing = callsById.get(block.id);
				if (existing) {
					existing.callCount += 1;
					continue;
				}
				callsById.set(block.id, {
					toolName: block.name,
					sourceIndex: index,
					callCount: 1,
				});
				continue;
			}
			if (block.type !== "tool_result") {
				continue;
			}
			resultCountsById.set(
				block.tool_use_id,
				(resultCountsById.get(block.tool_use_id) ?? 0) + 1,
			);
			results.push({
				toolUseId: block.tool_use_id,
				toolName:
					typeof (block as { name?: unknown }).name === "string"
						? ((block as { name?: string }).name as string)
						: undefined,
				sourceIndex: index,
				content: block.content,
			});
		}
	}

	const facts: SourceFileFact[] = [];
	for (const result of results) {
		const call = callsById.get(result.toolUseId);
		if (!call || call.callCount > 1) {
			continue;
		}
		if ((resultCountsById.get(result.toolUseId) ?? 0) > 1) {
			continue;
		}
		if (result.toolName !== undefined && result.toolName !== call.toolName) {
			continue;
		}
		if (result.sourceIndex < call.sourceIndex) {
			continue;
		}
		for (const fact of extractSourceFileFactsFromContent(
			result.content,
			call.toolName,
		)) {
			facts.push(fact);
		}
	}
	if (facts.length > MAX_CARRIED_FILE_FACTS) {
		facts.splice(0, facts.length - MAX_CARRIED_FILE_FACTS);
	}
	return facts;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2)
 *
 * Render the deterministic carry-forward section for the source-file facts.
 *
 * Returns `undefined` when there is nothing to carry, so a summary without a
 * source-file fact is never rewritten.
 */
export function renderSourceFileFactSection(
	facts: readonly SourceFileFact[],
): string | undefined {
	if (facts.length === 0) {
		return undefined;
	}
	const lines: string[] = [];
	for (const fact of facts) {
		lines.push(
			`- ${escapeFileFactDelimiters(fact.path)}: ${escapeFileFactDelimiters(fact.excerpt)}`,
		);
	}
	return [
		SOURCE_FILE_FACT_SECTION_HEADING,
		SOURCE_FILE_FACT_BEGIN_MARKER,
		...lines,
		SOURCE_FILE_FACT_END_MARKER,
	].join("\n");
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2)
 *
 * Remove any previously carried source-file-fact section from a summary text.
 *
 * The carry-forward is therefore IDEMPOTENT: a later compaction replaces the
 * section rather than appending a second copy.
 */
export function stripSourceFileFactSection(summaryText: string): string {
	const begin = summaryText.indexOf(SOURCE_FILE_FACT_BEGIN_MARKER);
	if (begin === -1) {
		return summaryText;
	}
	const end = summaryText.indexOf(SOURCE_FILE_FACT_END_MARKER, begin);
	const headingIndex = summaryText.lastIndexOf(
		SOURCE_FILE_FACT_SECTION_HEADING,
		begin,
	);
	const sectionStart =
		headingIndex !== -1 &&
		summaryText
			.slice(headingIndex + SOURCE_FILE_FACT_SECTION_HEADING.length, begin)
			.trim() === ""
			? headingIndex
			: begin;
	if (end === -1) {
		return summaryText.slice(0, sectionStart).trimEnd();
	}
	const before = summaryText.slice(0, sectionStart).trimEnd();
	const after = summaryText
		.slice(end + SOURCE_FILE_FACT_END_MARKER.length)
		.trimStart();
	if (!before) {
		return after;
	}
	if (!after) {
		return before;
	}
	return `${before}\n\n${after}`;
}

/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2)
 *
 * Apply the source-file-fact carry-forward to a summary text.
 */
export function applySourceFileFactsToSummary(
	summaryText: string,
	facts: readonly SourceFileFact[],
): string {
	const section = renderSourceFileFactSection(facts);
	const stripped = stripSourceFileFactSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
}

/**
 * Apply the carry-forward to a summary text: strip any previously carried
 * section and append the section derived from the canonical outcomes.
 *
 * Returns the original text unchanged when there is nothing verified to
 * carry, so a summary without verified outcomes is never rewritten.
 */
export function applyEvidenceToSummary(
	summaryText: string,
	ledger: VerifiedOutcomeLedger,
): string {
	const section = renderEvidenceSection(ledger);
	const stripped = stripEvidenceSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
}

/**
 * The provider-visible text of a summary message: `buildSummaryMessage()`
 * renders `Context summary:\n\n<summary>`.
 */
function readSummaryTextFromContent(
	message: MessageWithMetadata,
): string | undefined {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return undefined;
	}
	const text = message.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) {
		return undefined;
	}
	const prefix = "Context summary:\n\n";
	return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Rebuild a summary message with a new summary text, keeping every other
 * metadata field (kind, displayRole, userRunSpan, details, tokensBefore,
 * generatedAt) and the message envelope unchanged.
 */
function rebuildSummaryMessage(
	message: MessageWithMetadata,
	summary: string,
): MessageWithMetadata {
	const metadata = message.metadata
		? { ...message.metadata, summary }
		: { summary };
	return {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata,
	};
}

/**
 * The outcome of applying the evidence carry-forward.
 */
export interface EvidenceApplicationResult {
	/** The message list to use (carried when applied, original otherwise). */
	messages: MessageWithMetadata[];
	/** Whether the carry-forward was actually applied. */
	applied: boolean;
	/** The number of verified outcomes carried. */
	carriedOutcomeCount: number;
	/**
	 * ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2): the
	 * number of source-attributed file facts carried.
	 *
	 * It is counted SEPARATELY from `carriedOutcomeCount`, because the two
	 * have separate budgets and separate semantics.
	 */
	carriedFileFactCount?: number;
}

/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION01
 *
 * The SOURCE BOUNDARY of a compacted projection — INFERRED.
 *
 * A compaction projection is:
 *
 *     [ ...the persisted sidecar's messages..., ...the canonical TAIL... ]
 *
 * where the canonical tail is EXACTLY `canonicalMessages.slice(boundary)` —
 * a true SUFFIX of the canonical history — and `boundary` is the sidecar's
 * `source_message_count`.
 *
 * The boundary can therefore be APPROXIMATED by measuring the longest common
 * suffix between the projected message list and the canonical history.
 *
 * WHAT THIS MEASUREMENT IS **NOT**
 * -------------------------------
 *
 * It is NOT exact, and it does NOT claim to be. The correction is explicit
 * about the counterexample:
 *
 *     Canonical:      A B C D E
 *     Sidecar:        [summary, D, E]     <- a RE-COMPACTION sidecar retains
 *     Projected:      [summary, D, E]        canonical messages from before
 *     Longest suffix: D E                    its own boundary
 *     Inferred:       3
 *     Actual:         5
 *
 * A re-compaction's sidecar is `[summary, ...messages.slice(cutIndex)]` over
 * the COMPACTOR'S INPUT, so it legitimately retains canonical messages that
 * precede its own boundary. Those messages also match the canonical suffix,
 * so the suffix measurement reports an EARLIER boundary than the true one.
 *
 * THE MEASUREMENT UNDER-ESTIMATES
 * -------------------------------
 *
 * An UNDER-estimated boundary scopes the ledger to a SHORTER prefix of the
 * canonical history, so the carried section can only ever be a SUBSET of the
 * boundary's own outcomes. The section therefore never claims an outcome the
 * boundary did not contain.
 *
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION02
 *
 * That SUBSET property is NOT a correctness guarantee, and this contract no
 * longer claims one. An under-estimated boundary can OMIT a boundary outcome:
 * a verified `tool_result` that sits between the inferred boundary and the
 * true boundary is carried by neither the section nor the canonical tail, so
 * it disappears from the provider-visible request.
 *
 * MEASURED (tool/probe-fallback-underestimate.ts): with a canonical history
 * of `A, B, tool_use(call_y), tool_result(call_y), E` and a sidecar retaining
 * the trailing `E`, the inferred boundary is 3 while the true boundary is 5.
 * The ledger over the inferred prefix carries ZERO outcomes — `call_y` is
 * inside the true boundary but outside the inferred one.
 *
 * So the correct statement is: the measurement is a SAFE DIRECTION FOR
 * FABRICATION — it never invents an outcome — but it is NOT SAFE FOR
 * OMISSION. It is an APPROXIMATION whose result is NOT AUTHORITATIVE for
 * evidence conservation.
 *
 * THE AUTHORITATIVE VALUE
 * -----------------------
 *
 * This measurement is a FALLBACK for callers that do NOT hold the sidecar.
 * The compaction pipeline ALWAYS holds the sidecar and passes the
 * authoritative `source_message_count` explicitly, so the production path
 * never depends on this measurement.
 *
 * It exists so that a DIRECT helper call — which has no sidecar — still
 * produces a stable, evidence-preserving result rather than re-deriving the
 * section from the growing transcript on every call.
 *
 * A caller that needs the evidence-conservation guarantee MUST pass the
 * authoritative boundary explicitly.
 */
export function inferCompactionSourceBoundary(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
): number {
	let tailLength = 0;
	const maxTail = Math.min(compactedMessages.length, canonicalMessages.length);
	while (
		tailLength < maxTail &&
		sameMessage(
			compactedMessages[compactedMessages.length - 1 - tailLength],
			canonicalMessages[canonicalMessages.length - 1 - tailLength],
		)
	) {
		tailLength += 1;
	}
	return canonicalMessages.length - tailLength;
}

/**
 * Whether two messages are the SAME canonical message.
 *
 * The comparison is by the persisted content shape (role + content), NOT by
 * object identity: the projection holds deep copies of the canonical
 * messages. The volatile transport identity (`id`, `ts`) is deliberately
 * EXCLUDED, exactly as the persisted source-prefix hash excludes it, because
 * the message codec regenerates both on every storage round-trip.
 */
function sameMessage(
	left: MessageWithMetadata | undefined,
	right: MessageWithMetadata | undefined,
): boolean {
	if (!left || !right) {
		return false;
	}
	if (left.role !== right.role) {
		return false;
	}
	return (
		JSON.stringify(left.content ?? null) ===
		JSON.stringify(right.content ?? null)
	);
}

/**
 * Apply the verified-outcome carry-forward to a compacted message list.
 *
 * The outcomes are attached to the EXISTING `compaction_summary` message -
 * the message `buildSummaryMessage()` already produced. No second summary
 * message is created, no provider tool call is added, and every other
 * projected message is preserved unchanged.
 *
 * The provider-visible text AND `metadata.summary` are updated together, so
 * the representation a later compaction reads as `previousSummary` agrees
 * with what the model sees. (A repair that changed only one of the two
 * would be incorrect.)
 *
 * The carry-forward is a pure function of the CANONICAL history. A previous
 * summary is never an authority source: a summary that already carries a
 * section has it STRIPPED and replaced, so repeated compactions converge on
 * the canonical record instead of accumulating copies.
 *
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — THE SOURCE BOUNDARY
 * --------------------------------------------------------------------
 *
 * The carried section is derived from the canonical history AS IT WAS AT THE
 * SOURCE BOUNDARY, not from the whole growing canonical history.
 *
 * WHY. The compaction summary is the FIRST provider-visible message of every
 * request. A prompt cache can only reuse a checkpoint over an UNCHANGED
 * prefix, so a summary rewritten on every continuation invalidates every
 * deeper checkpoint. The section must therefore be a function of the
 * BOUNDARY, which does not change when the canonical transcript grows.
 *
 * WHAT THIS PRESERVES. The evidence-continuity guarantee is:
 *
 *   > A generated summary may omit historical detail, but it must not become
 *   > MORE AUTHORITATIVE than the canonical record of what actually executed.
 *
 * Every outcome verified AT the boundary stays carried — including the ones
 * that have fallen out of the visible tail, which is exactly the set the tail
 * CANNOT represent. Every outcome verified AFTER the boundary remains
 * model-visible through the provider-visible canonical tail, whose
 * `tool_result` block carries the canonical tool-call identity
 * (`tool_use_id`), the tool name, and the affirmative success payload that
 * `classifyToolResultStatus()` reads. The canonical history remains the
 * ONLY authority; a previous summary is never one.
 */
export function applyVerifiedEvidenceToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
	options: {
		/**
		 * The number of canonical messages that belonged to the compacted
		 * prefix — the persisted sidecar's `source_message_count`.
		 *
		 * This is an INDEX into the CANONICAL message collection (the
		 * display-only messages excluded), which is the same collection the
		 * persisted boundary was counted over.
		 *
		 * When omitted, the boundary is INFERRED from the projection itself
		 * (see {@link inferCompactionSourceBoundary}). That inference is an
		 * APPROXIMATION: it can report an EARLIER boundary than the true one
		 * when the sidecar retained canonical messages from before its own
		 * boundary (the re-compaction shape). It never FABRICATES an outcome,
		 * but it CAN OMIT one — so it is not authoritative for evidence
		 * conservation, and a caller that needs that guarantee must pass the
		 * authoritative boundary explicitly.
		 *
		 * The compaction pipeline always supplies the authoritative value
		 * explicitly, so the production path never depends on the inference.
		 */
		sourceMessageCount?: number;
	} = {},
): EvidenceApplicationResult {
	// ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION02
	//
	// The boundary is an INDEX INTO THE CANONICAL COLLECTION, so the prefix
	// must be selected over THAT SAME COLLECTION.
	//
	// A persisted sidecar's `source_message_count` counts the CANONICAL
	// messages — `createSessionCompactionState()` and
	// `projectSessionCompactionState()` both exclude the display-only
	// messages first. Slicing the RAW list with a CANONICAL count selects the
	// wrong messages: every display-only message that precedes the boundary
	// consumes one slot of the slice, so the prefix ends EARLY and can drop a
	// verified outcome that is genuinely INSIDE the boundary.
	//
	// That failure is silent and it is a CORRECTNESS failure, not a
	// compactness one: the dropped outcome is before the canonical tail, so
	// nothing else restores it, and the provider-visible request loses a
	// verified result while the prefix still looks stable.
	//
	// The count and the slice therefore operate over the identical ordered
	// collection.
	const canonical = canonicalSourceMessages(canonicalMessages);
	const boundaryCount = Math.max(
		0,
		Math.min(
			options.sourceMessageCount ??
				inferCompactionSourceBoundary(compactedMessages, canonical),
			canonical.length,
		),
	);
	// The boundary prefix is the canonical history AS IT WAS at the boundary.
	// It is a prefix of the growing canonical history, so the derivation is
	// stable across every continuation.
	const boundaryPrefix = canonical.slice(0, boundaryCount);
	const ledger = extractVerifiedToolOutcomes(boundaryPrefix);
	// ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01 (P0-2): the
	// SOURCE-ATTRIBUTED FILE FACTS are derived from the SAME
	// boundary-scoped canonical prefix, but with their OWN budget
	// (`MAX_CARRIED_FILE_FACTS`), so an execution-status budget never
	// decides whether a bounded factual excerpt survives.
	const fileFacts = extractSourceFileFacts(boundaryPrefix);
	const summaryIndex = compactedMessages.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedOutcomeCount: ledger.outcomes.length,
			carriedFileFactCount: fileFacts.length,
		};
	}
	const summaryMessage = compactedMessages[summaryIndex];
	const currentSummary =
		(summaryMessage.metadata as { summary?: string } | undefined)?.summary ??
		readSummaryTextFromContent(summaryMessage);
	if (typeof currentSummary !== "string") {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedOutcomeCount: ledger.outcomes.length,
			carriedFileFactCount: fileFacts.length,
		};
	}
	const withEvidence = applyEvidenceToSummary(currentSummary, ledger);
	const nextSummary = applySourceFileFactsToSummary(withEvidence, fileFacts);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedOutcomeCount: ledger.outcomes.length,
			carriedFileFactCount: fileFacts.length,
		};
	}
	const nextMessages = [...compactedMessages];
	nextMessages[summaryIndex] = rebuildSummaryMessage(
		summaryMessage,
		nextSummary,
	);
	return {
		messages: nextMessages,
		applied: true,
		carriedOutcomeCount: ledger.outcomes.length,
		carriedFileFactCount: fileFacts.length,
	};
}
