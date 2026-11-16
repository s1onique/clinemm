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
 * Classify a command into the finite allowlist.
 *
 * The command's LEADING WORDS are matched against the allowlist. Only the
 * matched allowlist entry is returned — never the user's words themselves.
 * A command that matches nothing yields no classification, and the outcome
 * is then carried with an empty label list: the verified FACT survives and
 * nothing unverified is invented.
 */
export function classifyCommand(command: string): string {
	const normalized = command.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		return "";
	}
	// Split the command into shell-ish words, keeping quoted runs intact.
	const words = normalized.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
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
 */
export function applyVerifiedEvidenceToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
): EvidenceApplicationResult {
	const ledger = extractVerifiedToolOutcomes(canonicalMessages);
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
		};
	}
	const nextSummary = applyEvidenceToSummary(currentSummary, ledger);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedOutcomeCount: ledger.outcomes.length,
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
	};
}
