/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C4 — THE TASK-CONDITIONED EVIDENCE SELECTION.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * The predecessor ACT measured the SELECTION to be the binding constraint:
 * the admission contract admits O7's decisive fragment correctly, but a
 * SHAPE-BASED selector over a 122-payload prefix does not reliably reach it,
 * and when it reaches a NEIGHBOURING subject's fragment it reproduces the
 * predecessor's mistranscription mode in a new form — not by the summarizer
 * rewriting a value, but by the SELECTION carrying one in.
 *
 * The shape of the failure is precise:
 *
 *     index 187: DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000   <- the oracle's subject
 *     index  73: SOCKET_TIMEOUT_MS          = 1500       <- a DIFFERENT sender
 *
 * Both are "a socket timeout with a value". A shape-based selector cannot
 * tell them apart, because the SHAPE is identical and the SUBJECT differs.
 *
 * ============================================================================
 * WHAT THIS IS NOT
 * ============================================================================
 *
 *   - It is NOT a retrieval framework. There is no index, no vector store,
 *     no embedding, no second inference request.
 *   - It is NOT a memory subsystem. Nothing is persisted; the selection is a
 *     pure function of the canonical history at the boundary.
 *   - It is NOT oracle-driven. The oracle's evidence indexes, answers and
 *     W1-specific identifiers are NOT inputs to this module. The selection
 *     uses the TASK CONTEXT and the RUNTIME-OWNED identifiers only.
 *   - It does NOT widen the admission contract. Admission is INDEPENDENT of
 *     selection: this module consumes only already-admitted fragments.
 *
 * ============================================================================
 * THE LADDER
 * ============================================================================
 *
 *   S0 — the predecessor's shape-based information-density ranking. The
 *        baseline. It is REUSED UNCHANGED, so the comparison is honest.
 *
 *   S1 — task-conditioned lexical selection. The task's own runtime-owned
 *        identifiers (paths, symbols, identifiers, terms) are matched against
 *        the admitted fragments' content. Generic matching: no subject name
 *        is hardcoded, no measurement unit is special-cased.
 *
 *   S2 — subject diversity and qualification conservation. Applied ONLY if
 *        S1 fails. It stops the whole budget being spent on one repetitive
 *        subject, and it conserves the material qualifications that are
 *        ASSOCIATED with a selected observation.
 *
 *   S3 — minimal source windows. Applied only when the admitted excerpts are
 *        too expensive. A window is a CONTIGUOUS span of the original source,
 *        never an isolated number.
 *
 * ============================================================================
 * THE SOURCE IDENTITY
 * ============================================================================
 *
 * A fragment is only usable if its ORIGIN is established. The origin is the
 * tool INVOCATION that produced it, correlated by the RUNTIME-OWNED
 * `tool_use_id` — the production correlation mechanism, with the production
 * fail-closed rules:
 *
 *   - a result with no matching call is UNMATCHED;
 *   - an id claimed by more than one call is AMBIGUOUS;
 *   - an id answered by more than one result is AMBIGUOUS;
 *   - a result whose tool name differs from the call's is a MISMATCH;
 *   - a result that precedes its call is OUT OF ORDER.
 *
 * A fragment whose origin cannot be established is REFUSED, or explicitly
 * marked as uncorrelated. It is never admitted on the strength of chronology,
 * adjacent text, or a matching number.
 *
 * ============================================================================
 * THE BOUNDARY
 * ============================================================================
 *
 * Every arm of the ladder is a PURE function of:
 *
 *   - the frozen canonical prefix (the boundary), and
 *   - the ALREADY-ADMITTED fragment set.
 *
 * The arms differ ONLY in which admitted fragments they select and how they
 * render them. They therefore share the same summary artifact, the same
 * retained tail, the same task contract and the same verified-outcome
 * carry-forward, and the comparison is over the SELECTION alone.
 */

import type { MessageWithMetadata } from "@cline/shared";
import {
	extractSourceBoundEvidenceCandidates,
	MAX_CARRIED_SOURCE_BOUND_EVIDENCE_CHARS,
	type SourceBoundEvidence,
} from "./source-bound-evidence";

/**
 * The SELECTOR ARM.
 *
 * The arms are named so that a report cannot conflate them. `SHAPE` is the
 * predecessor's ranking; the others are this ACT's.
 */
export type EvidenceSelectorArm =
	| "SHAPE"
	| "TASK_CONDITIONED"
	| "SUBJECT_DIVERSITY"
	| "MINIMAL_WINDOW";

/**
 * The SOURCE IDENTITY of ONE candidate fragment.
 *
 * Every property here is either RUNTIME-OWNED or explicitly UNKNOWN. Nothing
 * is inferred from chronology, adjacent text, or a matching number.
 */
export interface EvidenceSourceIdentity {
	/**
	 * The tool-call id that ORIGINATED the observation.
	 *
	 * It is runtime-owned: the runtime allocated it when it issued the call.
	 * It is `undefined` when the origin could not be established, in which
	 * case the fragment must be refused or explicitly marked uncorrelated.
	 */
	readonly toolUseId?: string;
	/** The tool that was invoked. Runtime-owned. */
	readonly toolName?: string;
	/** The canonical index of the INVOCATION, not of the result. */
	readonly invocationIndex?: number;
	/** The canonical index of the RESULT. */
	readonly resultIndex?: number;
	/**
	 * Whether the origin was ESTABLISHED.
	 *
	 * `false` means the fragment's attribution is not runtime-backed.
	 */
	readonly correlated: boolean;
	/**
	 * Why the origin could not be established, when it could not.
	 */
	readonly rejectionReason?: string;
}

/**
 * ONE candidate fragment, with its source identity and its relevance signals.
 */
export interface EvidenceCandidate {
	/** The admitted fragment itself. */
	readonly fragment: SourceBoundEvidence;
	/** The runtime-owned origin of the fragment. */
	readonly identity: EvidenceSourceIdentity;
	/**
	 * The subject tokens the fragment itself declares.
	 *
	 * These are extracted from the fragment's OWN content — a declared
	 * constant's name, a path's basename, a class-like identifier. They are
	 * what makes two same-shaped fragments distinguishable.
	 */
	readonly subjectTokens: readonly string[];
	/**
	 * Whether the fragment records a MATERIAL QUALIFICATION.
	 *
	 * A qualification is a statement that narrows the observation: a
	 * default versus an effective value, a failure versus a success, a
	 * declared constant versus a measured one.
	 */
	readonly hasQualification: boolean;
}

/**
 * The result of ONE selector run.
 */
export interface EvidenceSelectionResult {
	/** The arm that produced the result. */
	readonly arm: EvidenceSelectorArm;
	/** The SELECTED candidates, in selection order. */
	readonly selected: readonly EvidenceCandidate[];
	/** The candidates that were NOT selected, with the reason. */
	readonly rejected: readonly {
		readonly candidate: EvidenceCandidate;
		readonly reason: string;
	}[];
	/**
	 * The characters the RENDERED section will add to the summary.
	 *
	 * It includes the delimiters and the attribution metadata, because that
	 * is what the request actually pays for.
	 */
	readonly renderedChars: number;
	/**
	 * The ESTIMATED tokens the rendered section adds.
	 *
	 * It is an ESTIMATE from the runtime's own estimator, NOT a
	 * provider-observed count.
	 */
	readonly estimatedTokens: number;
	/** The number of candidates the selector examined. */
	readonly examinedCount: number;
	/**
	 * The number of candidates refused because their origin could not be
	 * established.
	 */
	readonly uncorrelatedCount: number;
}

/**
 * Select the evidence for the PRODUCTION seam.
 *
 * It is the entry point the production compaction uses. It runs the
 * TASK-CONDITIONED arm over the WHOLE eligible set and returns the selected
 * fragments, which the carry-forward then attaches to the summary.
 *
 * The SELECTION is INDEPENDENT of the ADMISSION in the sense that it never
 * widens it: the candidates it ranks are exactly the admitted ones.
 */
export function selectTaskConditionedEvidence(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly taskTexts?: readonly string[];
	readonly maxFragments?: number;
	readonly maxEstimatedTokens?: number;
}): {
	readonly fragments: readonly SourceBoundEvidence[];
	readonly result: EvidenceSelectionResult;
} {
	const { candidates } = collectEvidenceCandidates({
		canonicalMessages: input.canonicalMessages,
	});
	const signals = buildRelevanceSignals({
		taskTexts: input.taskTexts ?? [],
		candidates,
		canonicalMessages: input.canonicalMessages,
	});
	const result = selectEvidence({
		candidates,
		arm: "TASK_CONDITIONED",
		signals,
		budget: {
			maxFragments: input.maxFragments ?? MAX_SELECTED_EVIDENCE_FRAGMENTS,
			maxEstimatedTokens: input.maxEstimatedTokens ?? Number.MAX_SAFE_INTEGER,
		},
	});
	return {
		fragments: result.selected.map((candidate) => candidate.fragment),
		result,
	};
}

/**
 * Select the evidence at a CANONICAL BOUNDARY.
 *
 * It is the production entry point: the caller supplies the full message
 * list and the boundary count, and the helper derives the canonical prefix
 * itself — so the three production call sites cannot disagree about what
 * "the boundary prefix" is.
 *
 * The boundary count is the persisted sidecar's `source_message_count`: an
 * INDEX into the CANONICAL message collection (the display-only messages
 * excluded), which is the same collection the persisted boundary was
 * counted over.
 */
export function selectTaskConditionedEvidenceAtBoundary(input: {
	readonly messages: readonly MessageWithMetadata[];
	readonly sourceMessageCount: number;
	readonly taskTexts?: readonly string[];
	readonly maxFragments?: number;
}): {
	readonly fragments: readonly SourceBoundEvidence[];
	readonly result: EvidenceSelectionResult;
} {
	const canonical = input.messages.filter(
		(message) => message.metadata?.displayOnly !== true,
	);
	const boundaryCount = Math.max(
		0,
		Math.min(input.sourceMessageCount, canonical.length),
	);
	return selectTaskConditionedEvidence({
		canonicalMessages: canonical.slice(0, boundaryCount),
		taskTexts: input.taskTexts,
		maxFragments: input.maxFragments,
	});
}

/**
 * The maximum number of fragments the production selection carries.
 *
 * It matches the production carry-forward's own budget, so the selection
 * cannot exceed the carry-forward's capacity.
 */
export const MAX_SELECTED_EVIDENCE_FRAGMENTS = 12;

/**
 * The TOKENIZER.
 *
 * It is deliberately GENERIC: a token is a maximal run of identifier
 * characters, optionally containing `-`, `_` or `.`, and it is lowercased.
 *
 * It does not know about any particular subject, path, unit or command. That
 * is what makes the selection generalisable rather than oracle-fitted.
 */
export function tokenize(text: string): readonly string[] {
	const tokens = text
		.toLowerCase()
		.split(/[^a-z0-9_.\-/]+/)
		.map((token) => token.replace(/^[.\-/]+|[.\-/]+$/g, ""))
		.filter((token) => token.length >= 3 && token.length <= 64);
	return Array.from(new Set(tokens));
}

/**
 * The tokens that are a token SPLIT on a camel-case or snake-case boundary.
 *
 * `NotificationServiceClient` yields `notification`, `service` and `client`
 * as well, so a task that names the subject in prose ("the notification
 * service") matches a fragment that names it as a class name.
 */
export function splitIdentifierTokens(token: string): readonly string[] {
	return token
		.split(/[.\-_/]/)
		.flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
		.map((part) => part.toLowerCase())
		.filter((part) => part.length >= 3);
}

/**
 * The RUNTIME-OWNED invocation table for ONE canonical prefix.
 *
 * It is the production correlation: the `tool_use_id` the runtime allocated
 * when it issued a call, joined to the result that answered it.
 *
 * Every entry is a JOIN over a runtime-allocated identifier. Nothing here is
 * extracted from the CONTENT of a tool result.
 */
export interface InvocationTable {
	/** The correlated invocations, keyed by tool-call id. */
	readonly byToolUseId: ReadonlyMap<
		string,
		{
			readonly toolUseId: string;
			readonly toolName: string;
			readonly invocationIndex: number;
			readonly resultIndex: number;
			/** The result's structured payloads, in order. */
			readonly payloadIndex: number;
		}
	>;
	/** The ids whose join failed, with the reason. */
	readonly rejected: readonly {
		readonly toolUseId: string;
		readonly reason: string;
	}[];
}

/**
 * Build the RUNTIME-OWNED invocation table over a canonical prefix.
 *
 * The rules are the production fail-closed rules, applied to the same
 * runtime-allocated identifier the production carry-forward uses:
 *
 *   - `unmatched_result` — the result has no call with the same id;
 *   - `ambiguous_call_id` — the id was claimed by more than one call;
 *   - `ambiguous_result_id` — the id was answered by more than one result;
 *   - `tool_name_mismatch` — the result's tool name differs from the call's;
 *   - `result_precedes_call` — the result precedes its call.
 *
 * A rejected id is NOT correlated, and a fragment derived from it is refused
 * or explicitly marked uncorrelated.
 */
export function buildInvocationTable(
	canonicalMessages: readonly MessageWithMetadata[],
): InvocationTable {
	const callsById = new Map<
		string,
		{ toolName: string; invocationIndex: number; callCount: number }
	>();
	const resultCountsById = new Map<string, number>();
	const results: {
		toolUseId: string;
		toolName?: string;
		resultIndex: number;
		payloadIndex: number;
	}[] = [];

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
					invocationIndex: index,
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
			const content = (block as { content?: unknown }).content;
			const payloadCount = Array.isArray(content) ? content.length : 0;
			for (
				let payloadIndex = 0;
				payloadIndex < payloadCount;
				payloadIndex += 1
			) {
				results.push({
					toolUseId: block.tool_use_id,
					toolName:
						typeof (block as { name?: unknown }).name === "string"
							? ((block as { name?: string }).name as string)
							: undefined,
					resultIndex: index,
					payloadIndex,
				});
			}
		}
	}

	const byToolUseId = new Map<
		string,
		{
			toolUseId: string;
			toolName: string;
			invocationIndex: number;
			resultIndex: number;
			payloadIndex: number;
		}
	>();
	const rejected: { toolUseId: string; reason: string }[] = [];

	for (const result of results) {
		const call = callsById.get(result.toolUseId);
		if (!call) {
			rejected.push({
				toolUseId: result.toolUseId,
				reason: "unmatched_result",
			});
			continue;
		}
		if (call.callCount > 1) {
			rejected.push({
				toolUseId: result.toolUseId,
				reason: "ambiguous_call_id",
			});
			continue;
		}
		if ((resultCountsById.get(result.toolUseId) ?? 0) > 1) {
			rejected.push({
				toolUseId: result.toolUseId,
				reason: "ambiguous_result_id",
			});
			continue;
		}
		if (result.toolName !== undefined && result.toolName !== call.toolName) {
			rejected.push({
				toolUseId: result.toolUseId,
				reason: "tool_name_mismatch",
			});
			continue;
		}
		if (result.resultIndex < call.invocationIndex) {
			rejected.push({
				toolUseId: result.toolUseId,
				reason: "result_precedes_call",
			});
			continue;
		}
		// The FIRST payload of a result carries the invocation's identity.
		// Subsequent payloads of the SAME result are still attributable to
		// the same invocation, so they are recorded under a composite key.
		const key =
			result.payloadIndex === 0
				? result.toolUseId
				: `${result.toolUseId}#${result.payloadIndex}`;
		byToolUseId.set(key, {
			toolUseId: result.toolUseId,
			toolName: call.toolName,
			invocationIndex: call.invocationIndex,
			resultIndex: result.resultIndex,
			payloadIndex: result.payloadIndex,
		});
	}

	return { byToolUseId, rejected };
}

/**
 * The SUBJECT tokens a fragment declares.
 *
 * A subject token is an IDENTIFIER the fragment itself names:
 *
 *   - a DECLARED CONSTANT's name (`DEFAULT_SOCKET_TIMEOUT_MILLIS`);
 *   - a CLASS-LIKE identifier (`NotificationServiceClient`);
 *   - a PATH's basename and stem (`NotificationServiceClient.java`).
 *
 * It is what makes two SAME-SHAPED fragments distinguishable. The shape
 * ("a timeout with a value") is identical for the oracle's subject and for
 * its neighbour; the SUBJECT TOKENS are not.
 *
 * ============================================================================
 * THE TOOL-NAME EXCLUSION
 * ============================================================================
 *
 * The source attribution of a command result is the TOOL's name — so every
 * command-derived fragment shares the tokens `run` and `commands`. Those
 * tokens are in EVERY fragment, so they carry no information about which
 * fragment is relevant, and a subject score built from them rewards the
 * fragments that merely happen to be command output.
 *
 * They are therefore EXCLUDED from the subject tokens. The exclusion is
 * derived from the RUNTIME-OWNED tool name, not from a list of particular
 * tool names, so it applies to every tool.
 */
export function extractSubjectTokens(
	fragment: SourceBoundEvidence,
): readonly string[] {
	const tokens = new Set<string>();
	// The tokens that belong to the TOOL, not to the SUBJECT. They are
	// derived from the source attribution itself, so the exclusion is
	// generic.
	const toolTokens = new Set<string>();
	for (const token of tokenize(fragment.source)) {
		toolTokens.add(token);
		for (const part of splitIdentifierTokens(token)) {
			toolTokens.add(part);
		}
	}
	const consider = (value: string): void => {
		for (const token of tokenize(value)) {
			if (toolTokens.has(token)) {
				continue;
			}
			tokens.add(token);
			for (const part of splitIdentifierTokens(token)) {
				if (!toolTokens.has(part)) {
					tokens.add(part);
				}
			}
		}
	};
	// The DECLARED CONSTANT names are the strongest subject signal, because
	// they are the identifier the observation is ABOUT.
	for (const match of fragment.excerpt.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) {
		consider(match[1]);
	}
	for (const match of fragment.excerpt.matchAll(
		/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g,
	)) {
		consider(match[1]);
	}
	// The source's own basename is a subject signal when it names a file.
	const sourceTokens = tokenize(fragment.source);
	for (const token of sourceTokens) {
		if (toolTokens.has(token) || !token.includes(".")) {
			continue;
		}
		const stem = token.split(".").filter(Boolean).pop();
		if (stem && stem.length >= 3) {
			tokens.add(stem);
			for (const part of splitIdentifierTokens(stem)) {
				if (!toolTokens.has(part)) {
					tokens.add(part);
				}
			}
		}
	}
	return Array.from(tokens);
}

/**
 * The MATERIAL QUALIFICATION markers.
 *
 * A qualification narrows an observation. The list is GENERIC: it names the
 * SHAPE of the qualification (a default, an override, a failure, a
 * supersession), never a particular subject or value.
 */
const QUALIFICATION_MARKERS: readonly RegExp[] = [
	/\bdefault(?:s|ed)?\b/i,
	/\boverrid(?:e|es|able|den)\b/i,
	/\benv(?:ironment)?[- _]?overrid/i,
	/\bfail(?:ed|ure)?\b/i,
	/\berror\b/i,
	/\bexception\b/i,
	/\bsuperseded\b/i,
	/\bdeprecated\b/i,
	/\breplaced\b/i,
	/\bretry(?:ing|ied)?\b/i,
	/\bexit\s*(?:status|code)\b/i,
	/\bnon[- ]?zero\b/i,
	/\bpartial(?:ly)?\b/i,
	/\bonly\b/i,
];

/**
 * Whether the fragment records a MATERIAL QUALIFICATION.
 */
export function hasMaterialQualification(
	fragment: SourceBoundEvidence,
): boolean {
	return QUALIFICATION_MARKERS.some((marker) => marker.test(fragment.excerpt));
}

/**
 * Collect the CANDIDATES: the admitted fragments, each with its source
 * identity and its relevance signals.
 *
 * A fragment whose ORIGIN cannot be established is marked `correlated:
 * false`. It is not silently dropped: the caller decides whether to refuse
 * it or to carry it explicitly marked as uncorrelated.
 */
export function collectEvidenceCandidates(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly maxFragments?: number;
}): {
	readonly candidates: readonly EvidenceCandidate[];
	readonly report: ReturnType<typeof extractSourceBoundEvidenceCandidates>;
	readonly uncorrelatedCount: number;
} {
	// The UNBUDGETED admission.
	//
	// ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01: the
	// measurement over the frozen W1 workload showed that the predecessor's
	// admission applied the FRAGMENT BUDGET before the selection, so the
	// decisive fragments (canonical indexes 145, 147, 187, 189) were never
	// OFFERED to the selector. A selector cannot choose a fragment it never
	// saw, so the budget is spent by the SELECTION, after the selection.
	//
	// The CONFIDENTIALITY rules are unchanged: they are applied in full by
	// the admission contract.
	const report = extractSourceBoundEvidenceCandidates({
		canonicalMessages: input.canonicalMessages,
	});
	const table = buildInvocationTable(input.canonicalMessages);
	const candidates: EvidenceCandidate[] = [];
	let uncorrelatedCount = 0;
	for (const fragment of report.admitted) {
		// The admitted fragment's `canonicalIndex` is the index of the
		// MESSAGE that carried the tool result. The invocation identity is
		// resolved from the RUNTIME-OWNED id, not from the index.
		const toolUseId = resolveToolUseIdForFragment(
			input.canonicalMessages,
			fragment.canonicalIndex,
		);
		const invocation =
			toolUseId === undefined ? undefined : table.byToolUseId.get(toolUseId);
		const correlated = toolUseId !== undefined && invocation !== undefined;
		if (!correlated) {
			uncorrelatedCount += 1;
		}
		candidates.push({
			fragment,
			identity: correlated
				? {
						toolUseId: invocation?.toolUseId,
						toolName: invocation?.toolName,
						invocationIndex: invocation?.invocationIndex,
						resultIndex: invocation?.resultIndex,
						correlated: true,
					}
				: {
						correlated: false,
						rejectionReason: "invocation_origin_not_established",
					},
			subjectTokens: extractSubjectTokens(fragment),
			hasQualification: hasMaterialQualification(fragment),
		});
	}
	return { candidates, report, uncorrelatedCount };
}

/**
 * The runtime-allocated tool-call id that the tool result at `messageIndex`
 * answers.
 *
 * It is read from the canonical message's OWN `tool_result` block, which is
 * runtime-owned. When the message carries several results, the FIRST
 * uncorrelated id is used; the admission contract admits the payloads of one
 * result at a time, so the mapping is unambiguous in practice and is
 * recorded as the FIRST id for determinism.
 */
function resolveToolUseIdForFragment(
	canonicalMessages: readonly MessageWithMetadata[],
	messageIndex: number,
): string | undefined {
	const message = canonicalMessages[messageIndex];
	if (!message || !Array.isArray(message.content)) {
		return undefined;
	}
	for (const block of message.content) {
		if (block.type === "tool_result") {
			return block.tool_use_id;
		}
	}
	return undefined;
}

/**
 * The RELEVANCE SIGNALS.
 *
 * They are derived from the TASK CONTEXT — the session's own brief — and
 * from the RUNTIME-OWNED identifiers the task names. No oracle input is
 * involved.
 */
/**
 * The RUNTIME-OWNED identifiers the agent itself used.
 *
 * ============================================================================
 * WHY THIS IS THE RIGHT SIGNAL
 * ============================================================================
 *
 * The measurement over the frozen W1 workload produced three findings, in
 * order:
 *
 *   1. The ADMISSION budget was spent BEFORE the selection, so the decisive
 *      fragments were never offered. Fixed by the unbounded admission.
 *
 *   2. A plain token overlap against the TASK CONTEXT is dominated by
 *      PROCEDURAL NOISE. The task context is the session's own brief and
 *      the previous session's PLAN, and its vocabulary ("phase", "act",
 *      "watcher", "job") is DECLARED by the planning fragments. A fragment
 *      can therefore win by declaring many plan words.
 *
 *   3. The tool CALL INPUTS name the SUBJECT the agent was actually
 *      investigating. On the frozen W1 workload the runtime-owned call
 *      inputs name `NotificationServiceClient`, `DEFAULT_SOCKET_TIMEOUT`,
 *      `47` and `*Test.java` — the decisive subjects — while the plan
 *      vocabulary does not.
 *
 * The call inputs are RUNTIME-OWNED: the runtime issued the call and
 * recorded its arguments. They are not model-authored, not oracle-derived,
 * and not extracted from a tool RESULT's content. They are the agent's own
 * operational intent, which is the closest thing the runtime owns to "what
 * is this session about".
 *
 * The selection therefore uses BOTH signals, and the call-input identifiers
 * are the STRONGER one:
 *
 *   - the TASK CONTEXT supplies the general vocabulary;
 *   - the CALL INPUTS supply the specific subjects.
 */
export interface RelevanceSignals {
	/**
	 * The tokens the TASK names.
	 *
	 * They come from the task contract's own items and from the initial user
	 * request. They are the session's own vocabulary.
	 */
	readonly taskTokens: ReadonlySet<string>;
	/**
	 * The RUNTIME-OWNED identifiers the task names — paths, symbols,
	 * identifiers.
	 *
	 * They are distinguished from ordinary words because an identifier match
	 * is a much stronger signal than a common-word match.
	 */
	readonly taskIdentifiers: ReadonlySet<string>;
	/**
	 * The RUNTIME-OWNED identifiers the agent's own tool CALL INPUTS name.
	 *
	 * These are the STRONGEST signal: they are the subjects the agent was
	 * actually operating on.
	 */
	readonly callInputIdentifiers: ReadonlySet<string>;
	/**
	 * The tokens the agent's own tool CALL INPUTS name.
	 */
	readonly callInputTokens: ReadonlySet<string>;
	/**
	 * The DOCUMENT FREQUENCY of every token across the candidate set.
	 *
	 * It is the signal that separates a DISTINCTIVE identifier from a generic
	 * word.
	 *
	 * ============================================================================
	 * WHY THIS EXISTS
	 * ============================================================================
	 *
	 * The first measurement of the task-conditioned selector over the frozen
	 * W1 workload showed that a plain token-overlap score is dominated by
	 * PROCEDURAL NOISE: the carried task contract is the previous session's
	 * PLAN, and its vocabulary ("phase", "act", "pre-arm", "run") matches
	 * fragments that are planning prose rather than observations.
	 *
	 * The decisive fragments — the ones that carry the observed values — name
	 * DISTINCTIVE identifiers: a declared constant's name, a class name, a
	 * path segment. Those identifiers are RARE across the candidate set.
	 *
	 * A token that appears in EVERY fragment carries no information about
	 * which fragment is relevant. A token that appears in ONE is decisive.
	 * The document frequency captures exactly that, and it is computed from
	 * the candidate set itself — not from any oracle.
	 */
	readonly documentFrequency: ReadonlyMap<string, number>;
	/** The number of candidates the document frequency was computed over. */
	readonly candidateCount: number;
}

/**
 * Build the relevance signals from the TASK CONTEXT.
 *
 * The task context is the SESSION'S OWN material: the initial user request
 * and the carried task contract. Nothing oracle-specific enters here.
 */
export function buildRelevanceSignals(input: {
	readonly taskTexts: readonly string[];
	readonly candidates?: readonly EvidenceCandidate[];
	readonly canonicalMessages?: readonly MessageWithMetadata[];
}): RelevanceSignals {
	const taskTokens = new Set<string>();
	const taskIdentifiers = new Set<string>();
	for (const text of input.taskTexts) {
		for (const token of tokenize(text)) {
			taskTokens.add(token);
			for (const part of splitIdentifierTokens(token)) {
				taskTokens.add(part);
			}
		}
		// An IDENTIFIER is a token that carries internal structure: a
		// separator, a camel-case boundary, or a domain-like dot. A plain
		// word is not an identifier.
		for (const match of text.matchAll(
			/\b[A-Za-z0-9_]*(?:[._\-/][A-Za-z0-9_]+)+\b/g,
		)) {
			taskIdentifiers.add(match[0].toLowerCase());
		}
		for (const match of text.matchAll(/\b[A-Za-z0-9_]*[A-Z][a-z0-9]+\b/g)) {
			const value = match[0].toLowerCase();
			if (value.length >= 4) {
				taskIdentifiers.add(value);
			}
		}
	}
	// The RUNTIME-OWNED call-input identifiers.
	const callInputs = input.canonicalMessages
		? collectCallInputIdentifiers(input.canonicalMessages)
		: { identifiers: new Set<string>(), tokens: new Set<string>() };
	// The DOCUMENT FREQUENCY over the candidate set.
	const documentFrequency = new Map<string, number>();
	const candidates = input.candidates ?? [];
	for (const candidate of candidates) {
		for (const token of new Set([
			...tokenize(candidate.fragment.excerpt),
			...tokenize(candidate.fragment.source),
		])) {
			documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
		}
	}
	return {
		taskTokens,
		taskIdentifiers,
		callInputIdentifiers: callInputs.identifiers,
		callInputTokens: callInputs.tokens,
		documentFrequency,
		candidateCount: candidates.length,
	};
}

/**
 * Collect the RUNTIME-OWNED identifiers from the agent's tool CALL INPUTS.
 *
 * The call inputs are the runtime's record of the agent's OPERATIONAL INTENT.
 * They are not model-authored prose, and they are not extracted from a tool
 * RESULT's content — they are the arguments the runtime was asked to run.
 *
 * Only the SHAPE of an identifier is collected: a path, a symbol, a
 * camel-case name, a dotted name. The VALUES are not collected, because a
 * value is an OBSERVATION and must not be a selection input.
 */
export function collectCallInputIdentifiers(
	canonicalMessages: readonly MessageWithMetadata[],
): {
	readonly identifiers: ReadonlySet<string>;
	readonly tokens: ReadonlySet<string>;
} {
	const identifiers = new Set<string>();
	const tokens = new Set<string>();
	for (const message of canonicalMessages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_use") {
				continue;
			}
			const input = (block as { input?: unknown }).input;
			if (input === undefined || input === null) {
				continue;
			}
			for (const value of collectStringLeaves(input)) {
				for (const match of value.matchAll(
					/\b[A-Za-z0-9_]*(?:[._\-/][A-Za-z0-9_]+)+\b/g,
				)) {
					identifiers.add(match[0].toLowerCase());
				}
				for (const match of value.matchAll(
					/\b[A-Za-z0-9_]*[A-Z][a-z0-9]+[A-Za-z0-9_]*\b/g,
				)) {
					const token = match[0].toLowerCase();
					if (token.length >= 4) {
						identifiers.add(token);
					}
				}
				for (const token of tokenize(value)) {
					tokens.add(token);
					for (const part of splitIdentifierTokens(token)) {
						tokens.add(part);
					}
				}
			}
		}
	}
	return { identifiers, tokens };
}

/**
 * Collect every STRING leaf of a structured value.
 *
 * It is bounded by the value's own size, and it never inspects a tool
 * RESULT — only a call's input.
 */
function collectStringLeaves(value: unknown, depth = 0): readonly string[] {
	if (depth > 6) {
		return [];
	}
	if (typeof value === "string") {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry) => collectStringLeaves(entry, depth + 1));
	}
	if (value !== null && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).flatMap((entry) =>
			collectStringLeaves(entry, depth + 1),
		);
	}
	return [];
}

/**
 * The SPECIFICITY of a token, as a weight in [0, 1].
 *
 * A token that appears in EVERY candidate carries no information; a token
 * that appears in ONE is decisive. The weight is the inverse of the token's
 * document frequency, normalised by the candidate count.
 *
 * It is computed from the CANDIDATE SET itself. No oracle is involved.
 */
export function tokenSpecificity(
	token: string,
	signals: RelevanceSignals,
): number {
	if (signals.candidateCount === 0) {
		return 0;
	}
	const frequency = signals.documentFrequency.get(token) ?? 0;
	if (frequency === 0) {
		return 1;
	}
	return 1 - (frequency - 1) / signals.candidateCount;
}

/**
 * The RELEVANCE of ONE candidate against the task signals.
 *
 * The score rewards:
 *
 *   - an IDENTIFIER match (the task named this exact subject);
 *   - a token match, weighted by the token's specificity;
 *   - a material qualification, because a qualified observation is knowledge
 *     and an unqualified one is often merely a number;
 *   - a correlated origin, because an uncorrelated fragment cannot be
 *     attributed to the operation that produced it.
 *
 * It NEVER rewards the shape alone. That is the whole point: the shape is
 * what made the predecessor's selector carry a neighbouring subject's value.
 */
export function relevanceScore(
	candidate: EvidenceCandidate,
	signals: RelevanceSignals,
): number {
	let score = 0;
	const fragmentTokens = new Set<string>();
	for (const token of tokenize(candidate.fragment.excerpt)) {
		fragmentTokens.add(token);
		for (const part of splitIdentifierTokens(token)) {
			fragmentTokens.add(part);
		}
	}
	// ==========================================================================
	// THE RUNTIME-OWNED CALL-INPUT SIGNAL
	// ==========================================================================
	//
	// The strongest signal, and the one the measurement supports: the
	// agent's own tool CALL INPUTS name the subjects it was operating on.
	//
	// A fragment whose DECLARED subject is one of those identifiers is
	// decisive, and the weight is the identifier's specificity across the
	// candidate set: an identifier that appears in ONE fragment's subject
	// is far more decisive than one that appears in MANY.
	let callInputScore = 0;
	for (const subject of candidate.subjectTokens) {
		if (!signals.callInputIdentifiers.has(subject)) {
			continue;
		}
		callInputScore += tokenSpecificity(subject, signals) * 40;
	}
	score += callInputScore;
	// ==========================================================================
	// THE DECLARED-SUBJECT SIGNAL
	// ==========================================================================
	//
	// The first measurement of this selector showed that a plain token
	// overlap is dominated by PROCEDURAL NOISE: the carried task contract is
	// the previous session's PLAN, and its vocabulary matches planning prose
	// rather than observations. A second measurement showed that a
	// match-COUNT rewards the fragment that mentions the MOST task words,
	// which is the same failure with a different arithmetic.
	//
	// The decisive signal is therefore NOT "how many task words does this
	// fragment mention" but "does this fragment DECLARE a subject the task
	// names". A declared constant or class is the identifier the observation
	// is ABOUT; a mention is a word that happens to appear.
	//
	// The score is therefore built from the fragment's DECLARED subject
	// tokens, each weighted by its SPECIFICITY across the candidate set. A
	// declared subject that the task names AND that is rare across the
	// candidate set is decisive.
	let declaredScore = 0;
	for (const subject of candidate.subjectTokens) {
		if (!signals.taskTokens.has(subject)) {
			continue;
		}
		declaredScore += tokenSpecificity(subject, signals) * 12;
	}
	score += declaredScore;
	// The INCIDENTAL mentions are discounted and SATURATING: the tenth task
	// word a fragment mentions is worth less than the first, so a fragment
	// cannot win by breadth.
	let incidental = 0;
	for (const token of fragmentTokens) {
		if (
			signals.taskTokens.has(token) &&
			!candidate.subjectTokens.includes(token)
		) {
			incidental += 1;
		}
	}
	score += Math.sqrt(incidental) * 2;
	// An EXACT identifier match — the task named this exact path or symbol —
	// is worth more than a part of it.
	let exactMatches = 0;
	for (const identifier of signals.taskIdentifiers) {
		for (const token of fragmentTokens) {
			if (
				token === identifier ||
				token.startsWith(`${identifier}.`) ||
				token.endsWith(`.${identifier}`) ||
				token.includes(`.${identifier}.`)
			) {
				exactMatches += 1;
				break;
			}
		}
	}
	score += exactMatches * 6;
	// A material qualification is knowledge; an unqualified value is often
	// merely a number.
	if (candidate.hasQualification) {
		score += 4;
	}
	// A correlated origin is worth more than an uncorrelated one, because an
	// uncorrelated fragment cannot be attributed to the operation that
	// produced it.
	if (candidate.identity.correlated) {
		score += 2;
	}
	return score;
}

/**
 * The SHAPE-BASED score — the predecessor's ranking, REUSED UNCHANGED.
 *
 * It is reproduced here, rather than imported, so that the baseline and the
 * candidate are compared over the SAME admitted set with the SAME budget,
 * and so that the baseline is not silently improved by a change to the
 * production module.
 *
 * The predecessor's ranking lives in `source-bound-evidence.ts` and is
 * applied by the production extraction BEFORE the budget. The baseline arm
 * therefore reproduces the production order.
 */
function shapeScore(candidate: EvidenceCandidate): number {
	const excerpt = candidate.fragment.excerpt;
	const nonEmptyLines = excerpt
		.split("\n")
		.filter((line) => line.trim().length > 0);
	let score = 0;
	const declarations = excerpt.match(
		/\b[A-Za-z_][A-Za-z0-9_]*\s*(?:=|:)\s*"?-?\d+(?:\.\d+)?/g,
	);
	const declarationCount = declarations?.length ?? 0;
	score += Math.min(declarationCount, 8) * 12;
	if (nonEmptyLines.length > 0) {
		score += Math.round((declarationCount / nonEmptyLines.length) * 40);
	}
	if (/\b[A-Z][a-z]+[A-Z]\w{2,}\b/.test(excerpt)) {
		score += 5;
	}
	if (/[\\/][\w.-]+/.test(excerpt)) {
		score += 4;
	}
	if (/\b(fail(?:ed|ure)?|error|exception|denied|refused)\b/i.test(excerpt)) {
		score += 3;
	}
	if (/\b(usage|help|welcome|deprecated)\b/i.test(excerpt)) {
		score -= 8;
	}
	return score;
}

/**
 * The SELECTION BUDGET.
 *
 * It is expressed in ESTIMATED TOKENS of the RENDERED section — including
 * the delimiters and the attribution metadata, because that is what the
 * request actually pays for.
 *
 * These are SCREENING PARAMETERS, not production constants.
 */
export interface SelectionBudget {
	/** The maximum number of fragments. */
	readonly maxFragments: number;
	/** The maximum ESTIMATED tokens of the rendered section. */
	readonly maxEstimatedTokens: number;
}

/**
 * The DEFAULT screening budgets.
 *
 * They are the ACT's screening points, not a production constant.
 */
export const SCREENING_BUDGETS: readonly SelectionBudget[] = [
	{ maxFragments: 12, maxEstimatedTokens: 512 },
	{ maxFragments: 12, maxEstimatedTokens: 1_024 },
	{ maxFragments: 12, maxEstimatedTokens: 2_048 },
];

/**
 * The ESTIMATED tokens of a text.
 *
 * It is the runtime's own ESTIMATOR, not a provider-observed count. The two
 * are reported separately and are never conflated.
 */
export function estimateTokens(text: string): number {
	if (!text) {
		return 0;
	}
	// The runtime's own estimator shape: a quarter of the characters, with a
	// floor of one token for any non-empty text.
	return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * The RENDERED line for ONE selected candidate.
 *
 * It is the SAME shape the production renderer uses, plus the RUNTIME-OWNED
 * invocation identity, so that a reader can distinguish the operation that
 * produced the observation from the observation itself.
 *
 * The `MINIMAL_WINDOW` arm renders the CONTIGUOUS SOURCE WINDOW instead of
 * the whole excerpt, because the whole excerpt can cost more than the
 * decisive observation is worth.
 */
export function renderCandidateLine(
	candidate: EvidenceCandidate,
	arm: EvidenceSelectorArm = "TASK_CONDITIONED",
): string {
	const fragment = candidate.fragment;
	const identity = candidate.identity;
	const attribution = identity.correlated
		? `${fragment.source} (${fragment.status}; ${identity.toolName ?? "tool"}#${identity.toolUseId ?? "?"})`
		: `${fragment.source} (${fragment.status}; origin unestablished)`;
	const body =
		arm === "MINIMAL_WINDOW"
			? buildMinimalSourceWindow(fragment)
			: fragment.excerpt;
	return `- [${fragment.kind}] ${attribution}: ${body}`;
}

/**
 * The RENDERED section for a set of selected candidates.
 *
 * It is the SAME shape the production section uses, so the cost measurement
 * is the cost the request actually pays.
 */
export function renderSelectionSection(
	selected: readonly EvidenceCandidate[],
	arm: EvidenceSelectorArm = "TASK_CONDITIONED",
): string {
	if (selected.length === 0) {
		return "";
	}
	return [
		"## Source-bound evidence (canonical excerpts, verbatim)",
		"<!-- cline-source-evidence:begin -->",
		...selected.map((candidate) => renderCandidateLine(candidate, arm)),
		"<!-- cline-source-evidence:end -->",
	].join("\n");
}

/**
 * Select the evidence with ONE arm of the ladder.
 *
 * The arms share the SAME admitted candidate set, the SAME budget and the
 * SAME rendering. They differ ONLY in the ORDER they rank the candidates in,
 * which is exactly the variable under test.
 *
 * The budget is applied FAIL-CLOSED: a candidate that does not fit is not
 * partially carried.
 */
export function selectEvidence(input: {
	readonly candidates: readonly EvidenceCandidate[];
	readonly arm: EvidenceSelectorArm;
	readonly signals: RelevanceSignals;
	readonly budget: SelectionBudget;
}): EvidenceSelectionResult {
	const rejected: {
		candidate: EvidenceCandidate;
		reason: string;
	}[] = [];
	let ranked = [...input.candidates];
	if (input.arm === "SHAPE") {
		ranked.sort((left, right) => {
			const delta = shapeScore(right) - shapeScore(left);
			return delta !== 0
				? delta
				: left.fragment.canonicalIndex - right.fragment.canonicalIndex;
		});
	} else {
		ranked.sort((left, right) => {
			const delta =
				relevanceScore(right, input.signals) -
				relevanceScore(left, input.signals);
			if (delta !== 0) {
				return delta;
			}
			// The tie-break is the SHAPE score, then the canonical order. It
			// is deterministic and it does not favour a particular subject.
			const shapeDelta = shapeScore(right) - shapeScore(left);
			return shapeDelta !== 0
				? shapeDelta
				: left.fragment.canonicalIndex - right.fragment.canonicalIndex;
		});
	}
	if (input.arm === "SUBJECT_DIVERSITY") {
		ranked = applySubjectDiversity(ranked);
	}
	const selected: EvidenceCandidate[] = [];
	for (const candidate of ranked) {
		if (selected.length >= input.budget.maxFragments) {
			rejected.push({ candidate, reason: "fragment_budget_spent" });
			continue;
		}
		const rendered = renderSelectionSection(
			[...selected, candidate],
			input.arm,
		);
		if (estimateTokens(rendered) > input.budget.maxEstimatedTokens) {
			rejected.push({ candidate, reason: "token_budget_spent" });
			continue;
		}
		selected.push(candidate);
	}
	const section = renderSelectionSection(selected, input.arm);
	return {
		arm: input.arm,
		selected,
		rejected,
		renderedChars: section.length,
		estimatedTokens: estimateTokens(section),
		examinedCount: input.candidates.length,
		uncorrelatedCount: input.candidates.filter(
			(candidate) => !candidate.identity.correlated,
		).length,
	};
}

/**
 * Apply SUBJECT DIVERSITY to the ranked candidates.
 *
 * It prevents the whole budget being spent on ONE repetitive subject, while
 * CONSERVING the material observations that are ASSOCIATED with a selected
 * subject.
 *
 * The association is established from the SOURCE, not from chronology: two
 * candidates are associated when they share a subject token AND their
 * fragments record the SAME KIND of relation — a declaration, a measurement,
 * a failure, an override. The relationship types the ACT names are:
 *
 *   - a failed attempt and its successful replacement;
 *   - different definitions of the same reported measurement;
 *   - a default configuration versus the observed effective value;
 *   - different subjects with similar field names;
 *   - contradictory or superseded observations.
 *
 * It does NOT build a generalised ontology and it does NOT synthesise
 * propositions the original observations do not establish.
 */
function applySubjectDiversity(
	ranked: readonly EvidenceCandidate[],
): EvidenceCandidate[] {
	const result: EvidenceCandidate[] = [];
	const selectedSubjects = new Set<string>();
	for (const candidate of ranked) {
		const primary = primarySubject(candidate);
		const isNewSubject = !selectedSubjects.has(primary);
		if (isNewSubject || result.length === 0) {
			result.push(candidate);
			selectedSubjects.add(primary);
			continue;
		}
		// A candidate whose subject is already represented is kept only when
		// it records a MATERIAL QUALIFICATION the represented subject does
		// not. That conserves a default-versus-effective distinction, a
		// failure-versus-success distinction, or a supersession — without
		// spending the budget on a second copy of the same fact.
		const alreadyHas = result.some(
			(selected) =>
				primarySubject(selected) === primary && selected.hasQualification,
		);
		if (candidate.hasQualification && !alreadyHas) {
			result.push(candidate);
		}
	}
	return result;
}

/**
 * The PRIMARY SUBJECT of a candidate.
 *
 * It is the fragment's own DECLARED CONSTANT name when it has one, because
 * that is the identifier the observation is ABOUT. Otherwise it is the
 * fragment's source.
 */
function primarySubject(candidate: EvidenceCandidate): string {
	const declared = candidate.fragment.excerpt.match(/\b([A-Z][A-Z0-9_]{3,})\b/);
	return declared?.[1] ?? candidate.fragment.source;
}

/**
 * ============================================================================
 * S3 — THE MINIMAL SOURCE WINDOWS
 * ============================================================================
 *
 * The measurement over the frozen W1 workload showed that the ADMISSION
 * contract's line selection can DROP the context that establishes a
 * subject-value relationship. The `47` count at canonical index 67 is
 * carried on its own line, and the `*Test.java` definition that gives it
 * meaning sits on an adjacent line. When the lines between them are dropped,
 * the value survives and the QUALIFICATION does not — so the observation is
 * carried in a form that can no longer be interpreted correctly.
 *
 * A WINDOW is the remedy: a CONTIGUOUS span of the ORIGINAL source that
 * keeps the decisive line together with the lines that qualify it.
 *
 * The rules the ACT states:
 *
 *   - a window is CONTIGUOUS: it is a span of the original text, never a
 *     re-assembly of separated lines;
 *   - a window preserves enough CONTEXT for subject attribution and for the
 *     material qualification;
 *   - it never selects an ISOLATED number;
 *   - it never strips the context necessary for CREDENTIAL DETECTION.
 *
 * The last rule is why the window is applied to the ALREADY-BOUNDED, ALREADY-
 * REDACTED excerpt and never to the raw body: the redaction has already
 * happened, and the window cannot reintroduce anything the sanitizer removed.
 */

/**
 * The CONTEXT WINDOW around a decisive line.
 */
export const SOURCE_WINDOW_CONTEXT_LINES = 3;

/**
 * Build the MINIMAL SOURCE WINDOW for a candidate.
 *
 * It returns the contiguous span of the excerpt that carries the decisive
 * observation together with its qualifying context.
 *
 * When the excerpt is short enough to carry in full, it is returned
 * unchanged: the window is a REDUCTION, never an expansion.
 */
export function buildMinimalSourceWindow(
	fragment: SourceBoundEvidence,
	options: {
		readonly contextLines?: number;
		readonly maxChars?: number;
	} = {},
): string {
	const contextLines = options.contextLines ?? SOURCE_WINDOW_CONTEXT_LINES;
	const maxChars = options.maxChars ?? MAX_CARRIED_SOURCE_BOUND_EVIDENCE_CHARS;
	const lines = fragment.excerpt.split("\n");
	if (lines.length <= 1) {
		return fragment.excerpt.slice(0, maxChars);
	}
	// The DECISIVE lines are the ones that carry a declared constant with a
	// value, or a concrete count. They are the observation.
	const decisiveIndexes = lines
		.map((line, index) => ({ line, index }))
		.filter(
			({ line }) =>
				/\b[A-Za-z_][A-Za-z0-9_]*\s*(?:=|:)\s*"?-?\d+(?:\.\d+)?/.test(line) ||
				/(?<!\d)\d+(?!\d)\s*(?:$|[^\d])/.test(line),
		)
		.map(({ index }) => index);
	if (decisiveIndexes.length === 0) {
		return fragment.excerpt.slice(0, maxChars);
	}
	// The window is the CONTIGUOUS span that covers every decisive line plus
	// the context around it. The span is contiguous by construction: it runs
	// from the first covered line to the last.
	const first = Math.max(0, Math.min(...decisiveIndexes) - contextLines);
	const last = Math.min(
		lines.length - 1,
		Math.max(...decisiveIndexes) + contextLines,
	);
	const window = lines.slice(first, last + 1).join("\n");
	return window.length > maxChars
		? `${window.slice(0, maxChars)}\n...[window truncated]`
		: window;
}
