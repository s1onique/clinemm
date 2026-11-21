/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * The OFFLINE request-difference ANALYZER.
 *
 * ## What it answers
 *
 * For two consecutive provider requests, WHERE is the earliest model-facing
 * difference? It compares the sanitized capture records at the three
 * representation boundaries and reports:
 *
 *   - the common ordered prefix by exact structural fingerprint;
 *   - the FIRST inserted / removed / reordered / modified message;
 *   - the role and content-part changes;
 *   - the byte-length changes;
 *   - the tool inventory / order / definition changes;
 *   - the system / reasoning / tool-choice control changes;
 *   - the stage at which the change FIRST appears (runtime projection, AI
 *     SDK prompt, or wire payload).
 *
 * ## The fail-closed contract
 *
 * The analyzer NEVER fabricates a comparison. If a request, a stage or a
 * correlation identity is absent, the corresponding comparison is reported
 * as `UNAVAILABLE_FROM_TRACE` — it does not fall back to "the previous
 * capture in the file", because a chronological-adjacency join is NOT an
 * authoritative join.
 *
 * ## The identity contract
 *
 * Comparisons are made ONLY between records that carry the SAME cohort id
 * (the keyed fingerprints of two different cohorts are not comparable), and
 * the analyzer reports the correlation identity it used. A pair whose
 * identities do not line up is reported as `NOT_AUTHORITATIVE`, never as
 * "equal".
 */

import {
	PREFIX_FORENSICS_FINGERPRINT_PRODUCER,
	PREFIX_FORENSICS_SCHEMA_VERSION,
	type PrefixForensicsCaptureRecord,
	type PrefixForensicsMessageFingerprint,
} from "./prefix-forensics.ts";

/** The three representation boundaries, in causal order. */
export const PREFIX_FORENSICS_STAGES = [
	"runtime_projection",
	"ai_sdk_prompt",
	"wire_request",
] as const;

export type PrefixForensicsStageName = (typeof PREFIX_FORENSICS_STAGES)[number];

/** The marker used whenever an observation cannot be made. */
export const UNAVAILABLE_FROM_TRACE = "UNAVAILABLE_FROM_TRACE" as const;

/** How a message changed between two requests. */
export type PrefixForensicsMessageChangeKind =
	| "unchanged"
	| "modified"
	| "inserted"
	| "removed"
	| "reordered";

/** One message-level difference. */
export interface PrefixForensicsMessageDifference {
	readonly index: number;
	readonly kind: PrefixForensicsMessageChangeKind;
	readonly roleBefore?: string;
	readonly roleAfter?: string;
	readonly bytesBefore?: number;
	readonly bytesAfter?: number;
	/**
	 * The per-PART byte lengths before and after.
	 *
	 * The whole-message byte length can be UNCHANGED while a part's length
	 * changes (a one-character edit in a long message keeps the message
	 * length the same only by coincidence — but a same-length replacement
	 * is entirely possible). The part-level lengths are what locate the
	 * change precisely, so they are reported separately.
	 */
	readonly partBytesBefore?: readonly number[];
	readonly partBytesAfter?: readonly number[];
	/** The index of the SAME message in the other request, when known. */
	readonly counterpartIndex?: number;
	/** Whether the changed message carries a tool result. */
	readonly involvesToolResult?: boolean;
	/** Whether the changed message carries a compaction summary. */
	readonly involvesCompactionSummary?: boolean;
	/** The part types that changed, when the message was modified. */
	readonly changedPartTypes?: readonly string[];
}

/** One tool-level difference. */
export interface PrefixForensicsToolDifference {
	readonly kind:
		| "unchanged"
		| "inventory_changed"
		| "order_changed"
		| "definition_changed";
	readonly addedTools?: readonly string[];
	readonly removedTools?: readonly string[];
	/** The tools whose position moved. */
	readonly reorderedTools?: readonly string[];
	/** The tools whose SCHEMA changed. */
	readonly changedDefinitionTools?: readonly string[];
	/** The tools whose schema is identical but whose SERIALIZATION differs. */
	readonly changedSerializationTools?: readonly string[];
}

/** One system / options-level difference. */
export interface PrefixForensicsSystemDifference {
	readonly systemChanged: boolean;
	readonly systemBytesBefore?: number;
	readonly systemBytesAfter?: number;
	readonly reasoningControlsChanged?: boolean;
	readonly toolChoiceChanged?: boolean;
	readonly modelOptionsChanged?: boolean;
}

/** The comparison of ONE stage. */
export interface PrefixForensicsStageComparison {
	readonly stage: PrefixForensicsStageName;
	readonly representation: string;
	readonly available: boolean;
	readonly unavailableReason?: string;
	/** The number of messages in the common ordered prefix. */
	readonly commonPrefixLength: number;
	/** The FIRST differing message, when there is one. */
	readonly firstDifference?: PrefixForensicsMessageDifference;
	/** Every differing message. */
	readonly differences: readonly PrefixForensicsMessageDifference[];
	readonly tools: PrefixForensicsToolDifference;
	readonly system: PrefixForensicsSystemDifference;
	readonly bodyFingerprintChanged?: boolean;
	/**
	 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: whether THIS
	 * stage differs at all, across EVERY change category.
	 *
	 * The pre-correction implementation derived stage equality from the
	 * MESSAGE list alone, so a stage whose tool inventory, system prompt or
	 * serialized body had changed was reported as "equal". Every change
	 * category is now included.
	 */
	readonly differs: boolean;
	/**
	 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the change
	 * categories that actually differ at this stage.
	 *
	 * Empty when the stage does not differ. This is what the stage
	 * attribution reads, so a TOOL-ONLY or BODY-ONLY change is never
	 * silently omitted from the attribution.
	 */
	readonly differingCategories: readonly PrefixForensicsChangeCategory[];
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the change
 * categories a stage comparison can report.
 */
export type PrefixForensicsChangeCategory =
	| "messages"
	| "tools"
	| "system"
	| "body";

/** The comparison of TWO requests. */
export interface PrefixForensicsRequestDifference {
	readonly authoritative: boolean;
	readonly unavailableReason?: string;
	readonly cohortId?: string;
	readonly beforeIdentity: {
		readonly sessionId?: string;
		readonly preparationRequestId?: string;
		readonly providerAttemptId?: string;
		readonly iteration?: number;
	};
	readonly afterIdentity: {
		readonly sessionId?: string;
		readonly preparationRequestId?: string;
		readonly providerAttemptId?: string;
		readonly iteration?: number;
	};
	readonly stages: readonly PrefixForensicsStageComparison[];
	/** The EARLIEST stage at which a difference appears. */
	readonly earliestDifferingStage?: PrefixForensicsStageName;
	/**
	 * Whether the stages were all equal.
	 *
	 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: an
	 * UNAVAILABLE stage can no longer imply equality. The pre-correction
	 * implementation treated `!stage.available` as "equal", so a comparison
	 * in which two of the three representation boundaries were missing
	 * produced a POSITIVE equality result — a claim the evidence did not
	 * support. Equality now requires EVERY stage to be available AND
	 * undiffering.
	 */
	readonly allStagesEqual: boolean;
	/**
	 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the stages
	 * that could NOT be compared.
	 *
	 * A non-empty list means the equality claim is INCOMPLETE: the
	 * comparison is fail-closed, not affirmative.
	 */
	readonly unavailableStages: readonly PrefixForensicsStageName[];
}

/**
 * Does this message carry a tool result?
 *
 * A tool result is the message whose rewriting destroys a provider prefix
 * cache: it sits in the EARLY history and its bytes change between two
 * otherwise identical requests.
 */
function isToolResult(message: PrefixForensicsMessageFingerprint): boolean {
	return (
		message.role === "tool" ||
		message.parts.some((part) => part.type === "tool-result")
	);
}

/**
 * Does this message carry a compaction summary?
 *
 * The sanitized record never exposes text, so the summary is detected
 * STRUCTURALLY: a text-bearing message whose byte length is large enough to
 * be a synthesized summary rather than a short turn. This is a HEURISTIC
 * marker on the sanitized record, never a claim about the content.
 */
function isCompactionSummary(
	message: PrefixForensicsMessageFingerprint,
): boolean {
	const hasText = message.parts.some((part) => part.type === "text");
	return hasText && message.bytes >= 512;
}

/** The part types that differ between two messages. */
function changedPartTypes(
	before: PrefixForensicsMessageFingerprint,
	after: PrefixForensicsMessageFingerprint,
): string[] {
	const changed = new Set<string>();
	const count = Math.max(before.parts.length, after.parts.length);
	for (let index = 0; index < count; index += 1) {
		const left = before.parts[index];
		const right = after.parts[index];
		if (!left || !right || left.fingerprint !== right.fingerprint) {
			changed.add(left?.type ?? right?.type ?? "unknown");
		}
	}
	return [...changed].sort();
}

/**
 * Compare the ORDERED message lists of two representations.
 *
 * The common prefix is computed by EXACT structural fingerprint: the first
 * message whose fingerprint differs ends the common prefix.
 */
function compareMessages(
	before: readonly PrefixForensicsMessageFingerprint[],
	after: readonly PrefixForensicsMessageFingerprint[],
): {
	commonPrefixLength: number;
	differences: PrefixForensicsMessageDifference[];
} {
	let commonPrefixLength = 0;
	const limit = Math.min(before.length, after.length);
	while (
		commonPrefixLength < limit &&
		before[commonPrefixLength]?.fingerprint ===
			after[commonPrefixLength]?.fingerprint
	) {
		commonPrefixLength += 1;
	}

	const differences: PrefixForensicsMessageDifference[] = [];
	const tail = Math.max(before.length, after.length);
	for (let index = commonPrefixLength; index < tail; index += 1) {
		const left = before[index];
		const right = after[index];
		if (left && right) {
			// The message at this index exists on both sides but differs.
			// When the fingerprints of the two sides appear at DIFFERENT
			// indices, the message was REORDERED rather than modified.
			const leftElsewhere = after.findIndex(
				(message) => message.fingerprint === left.fingerprint,
			);
			const rightElsewhere = before.findIndex(
				(message) => message.fingerprint === right.fingerprint,
			);
			const reordered =
				leftElsewhere !== -1 &&
				rightElsewhere !== -1 &&
				leftElsewhere !== index &&
				rightElsewhere !== index;
			differences.push({
				index,
				kind: reordered ? "reordered" : "modified",
				roleBefore: left.role,
				roleAfter: right.role,
				bytesBefore: left.bytes,
				bytesAfter: right.bytes,
				partBytesBefore: left.parts.map((part) => part.bytes),
				partBytesAfter: right.parts.map((part) => part.bytes),
				counterpartIndex: reordered ? leftElsewhere : index,
				involvesToolResult: isToolResult(left) || isToolResult(right),
				involvesCompactionSummary:
					isCompactionSummary(left) || isCompactionSummary(right),
				changedPartTypes: changedPartTypes(left, right),
			});
			continue;
		}
		if (left) {
			differences.push({
				index,
				kind: "removed",
				roleBefore: left.role,
				bytesBefore: left.bytes,
				involvesToolResult: isToolResult(left),
				involvesCompactionSummary: isCompactionSummary(left),
			});
			continue;
		}
		if (right) {
			differences.push({
				index,
				kind: "inserted",
				roleAfter: right.role,
				bytesAfter: right.bytes,
				involvesToolResult: isToolResult(right),
				involvesCompactionSummary: isCompactionSummary(right),
			});
		}
	}
	return { commonPrefixLength, differences };
}

/**
 * Compare the ORDERED tool inventories of two representations.
 *
 * The three tool differences are kept DISTINCT, because they have
 * different causes:
 *
 *   - `inventory_changed` — a tool was added or removed;
 *   - `order_changed` — the SAME tool definitions in a DIFFERENT order
 *     (this alone invalidates a provider prefix cache, because the tool
 *     block is serialized before the messages);
 *   - `definition_changed` — a tool's SCHEMA changed.
 *
 * A tool whose schema is IDENTICAL but whose serialized representation
 * differs is reported separately, so a re-serialization is never mistaken
 * for a schema edit.
 */
function compareTools(
	before:
		| readonly { readonly name: string; readonly fingerprint: string }[]
		| undefined,
	after:
		| readonly { readonly name: string; readonly fingerprint: string }[]
		| undefined,
): PrefixForensicsToolDifference {
	if (!before || !after) {
		return { kind: "unchanged" };
	}
	const beforeByName = new Map(
		before.map((tool) => [tool.name, tool.fingerprint]),
	);
	const afterByName = new Map(
		after.map((tool) => [tool.name, tool.fingerprint]),
	);
	const addedTools = after
		.filter((tool) => !beforeByName.has(tool.name))
		.map((tool) => tool.name);
	const removedTools = before
		.filter((tool) => !afterByName.has(tool.name))
		.map((tool) => tool.name);
	const changedDefinitionTools: string[] = [];
	for (const [name, fingerprint] of beforeByName) {
		const afterFingerprint = afterByName.get(name);
		if (afterFingerprint !== undefined && afterFingerprint !== fingerprint) {
			changedDefinitionTools.push(name);
		}
	}

	const beforeOrder = before.map((tool) => tool.name);
	const afterOrder = after.map((tool) => tool.name);
	const sameOrder =
		beforeOrder.length === afterOrder.length &&
		beforeOrder.every((name, index) => afterOrder[index] === name);
	const reorderedTools = sameOrder
		? []
		: beforeOrder.filter((name, index) => afterOrder[index] !== name);

	let kind: PrefixForensicsToolDifference["kind"] = "unchanged";
	if (addedTools.length > 0 || removedTools.length > 0) {
		kind = "inventory_changed";
	} else if (!sameOrder) {
		kind = "order_changed";
	} else if (changedDefinitionTools.length > 0) {
		kind = "definition_changed";
	}

	return {
		kind,
		...(addedTools.length > 0 ? { addedTools } : {}),
		...(removedTools.length > 0 ? { removedTools } : {}),
		...(reorderedTools.length > 0 ? { reorderedTools } : {}),
		...(changedDefinitionTools.length > 0 ? { changedDefinitionTools } : {}),
	};
}

/**
 * The comparison of ONE stage between two representations.
 */
function compareStage(
	stage: PrefixForensicsStageName,
	before: PrefixForensicsCaptureRecord | undefined,
	after: PrefixForensicsCaptureRecord | undefined,
): PrefixForensicsStageComparison {
	const unavailable = (reason: string): PrefixForensicsStageComparison => ({
		stage,
		representation: "UNAVAILABLE_FROM_TRACE",
		available: false,
		unavailableReason: reason,
		commonPrefixLength: 0,
		differences: [],
		tools: { kind: "unchanged" },
		system: { systemChanged: false },
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: an
		// unavailable stage does NOT differ — but it also does NOT support
		// an equality claim. `differs: false` here is paired with
		// `available: false`, and the equality verdict reads BOTH.
		differs: false,
		differingCategories: [],
	});

	if (!before) {
		return unavailable("the BEFORE capture for this stage is absent");
	}
	if (!after) {
		return unavailable("the AFTER capture for this stage is absent");
	}
	if (before.source !== stage || after.source !== stage) {
		return unavailable(
			`the capture source does not match the stage (${before.source} / ${after.source})`,
		);
	}
	if (before.cohortId !== after.cohortId) {
		return unavailable(
			"the two captures belong to DIFFERENT cohorts; their keyed fingerprints are not comparable",
		);
	}

	const left = before.representation;
	const right = after.representation;
	if (left.representation !== right.representation) {
		return unavailable(
			`the two captures describe DIFFERENT representations (${left.representation} / ${right.representation})`,
		);
	}

	const { commonPrefixLength, differences } = compareMessages(
		left.messages,
		right.messages,
	);
	const tools = compareTools(left.toolFingerprints, right.toolFingerprints);
	const systemChanged =
		left.systemFingerprint !== right.systemFingerprint ||
		left.systemBytes !== right.systemBytes;
	const bodyFingerprintChanged =
		left.bodyFingerprint !== right.bodyFingerprint ||
		left.bodyBytes !== right.bodyBytes;

	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the change
	// categories. EVERY category is checked — the pre-correction
	// implementation compared the MESSAGE list alone, so a TOOL-ONLY, a
	// SYSTEM-ONLY or a BODY-ONLY change was invisible to the stage
	// attribution.
	const differingCategories: PrefixForensicsChangeCategory[] = [];
	if (differences.length > 0) {
		differingCategories.push("messages");
	}
	if (tools.kind !== "unchanged") {
		differingCategories.push("tools");
	}
	if (systemChanged) {
		differingCategories.push("system");
	}
	if (bodyFingerprintChanged) {
		differingCategories.push("body");
	}

	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: an
	// INCOMPLETE representation (a wire body that could not be parsed) is
	// not a comparable observation. It is reported as unavailable rather
	// than compared as an empty request.
	if (left.complete === false || right.complete === false) {
		return unavailable(
			"one of the two captures is an INCOMPLETE representation; it cannot be compared as a request",
		);
	}

	return {
		stage,
		representation: left.representation,
		available: true,
		commonPrefixLength,
		...(differences.length > 0 ? { firstDifference: differences[0] } : {}),
		differences,
		tools,
		system: {
			systemChanged,
			...(left.systemBytes !== undefined
				? { systemBytesBefore: left.systemBytes }
				: {}),
			...(right.systemBytes !== undefined
				? { systemBytesAfter: right.systemBytes }
				: {}),
			reasoningControlsChanged: false,
			toolChoiceChanged: false,
			modelOptionsChanged: false,
		},
		...(left.bodyFingerprint !== undefined ||
		right.bodyFingerprint !== undefined
			? { bodyFingerprintChanged }
			: {}),
		differs: differingCategories.length > 0,
		differingCategories,
	};
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the identity
 * model for pairing capture records.
 *
 * ## The runtime's own distinction (the authority for this model)
 *
 * `AgentRuntime` mints THREE different identities, and they have DIFFERENT
 * lifetimes. The runtime documents this at
 * `sdk/packages/agents/src/agent-runtime.ts:930-949`:
 *
 * | Identity | Minted | Lifetime |
 * |---|---|---|
 * | `preparationRequestId` (`req_…`) | once per PREPARED REQUEST (`createUID("req")`, `:2801`) | UNCHANGED across provider retries |
 * | `providerAttemptId` / `modelRequestId` (`model_request_…`) | per PROVIDER ATTEMPT (`:3011`) | RE-MINTED on every retry |
 * | `iteration` | per MODEL TURN | advances once per turn |
 *
 * So the CORRECTION01 rule — "consecutive means the same
 * `preparationRequestId`" — was INVERTED. It accepted the RETRY case
 * (same preparation, different attempt) and REJECTED the CONSECUTIVE-TURN
 * case (different preparation, adjacent iteration), which is exactly the
 * comparison the next experiment needs.
 *
 * ## The three identities this module distinguishes
 *
 * 1. **Within-request identity** — the A/B/C representation stages of ONE
 *    request or attempt. They share a session, an iteration and a
 *    preparation identity, and differ only by their `source`.
 * 2. **Consecutive-turn identity** — the SAME session, PROVEN ADJACENT
 *    iterations (`after.iteration === before.iteration + 1`), and DISTINCT
 *    preparation identities (each turn is its own prepared request).
 * 3. **Retry identity** — the SAME preparation identity with a DISTINCT
 *    attempt ordinal, at the SAME iteration. It is a second transport
 *    attempt of one prepared request, never another turn.
 *
 * Where a required identity is UNAVAILABLE, the pair is reported
 * `NOT_AUTHORITATIVE` (or the stage `UNAVAILABLE_FROM_TRACE`) — a TIMESTAMP
 * is never substituted.
 */
export type PrefixForensicsPairingRelation =
	| "consecutive_turn"
	| "retry"
	| "same_request";

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the outcome of
 * pairing two capture records.
 */
export interface PrefixForensicsLineageVerdict {
	/** Whether the two records may be compared as two consecutive requests. */
	readonly consecutive: boolean;
	/** The relation that was established, when one was. */
	readonly relation?: PrefixForensicsPairingRelation;
	/** Why the pair is not a consecutive request, when it is not. */
	readonly reason?: string;
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: establish the
 * relation between two capture records.
 *
 * ## The rule
 *
 * A pair is a **consecutive turn** only when ALL of the following hold:
 *
 *   - both records carry a session id, and they are the SAME session;
 *   - both records carry an iteration, and `after.iteration` is EXACTLY
 *     `before.iteration + 1` (proven adjacency — a gap is refused, never
 *     bridged);
 *   - the preparation identities are DISTINCT (each turn is its own prepared
 *     request), and so are the attempt identities.
 *
 * A pair is a **retry** when the preparation identity is the SAME and the
 * attempt identity is DIFFERENT at the SAME iteration. A retry is never a
 * consecutive turn.
 *
 * A pair is **the same request** when it shares a session, an iteration and
 * a preparation identity and differs only by `source` — those are the
 * representation stages of ONE request and are AGGREGATED, not compared.
 */
export function establishRequestLineage(
	before: PrefixForensicsCaptureRecord,
	after: PrefixForensicsCaptureRecord,
): PrefixForensicsLineageVerdict {
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: EVERY
	// identity is MANDATORY.
	//
	// The CORRECTION02 implementation checked that the preparation and
	// attempt identities DIFFER only when BOTH were present, so a record
	// with a MISSING identity SKIPPED the check entirely and fell through
	// to `consecutive: true`. That promoted incomplete capture evidence
	// into a positive attribution and contradicted this module's own
	// stated contract.
	//
	// The identities are now REQUIRED UP FRONT: a record that does not
	// carry the full identity set can never be part of an authoritative
	// consecutive-turn pair, and the reason says which one is missing.
	const beforeIdentities = missingIdentities(before);
	const afterIdentities = missingIdentities(after);
	if (beforeIdentities.length > 0 || afterIdentities.length > 0) {
		const missing = [
			...beforeIdentities.map((name) => `before: ${name}`),
			...afterIdentities.map((name) => `after: ${name}`),
		];
		return {
			consecutive: false,
			reason:
				`the captures carry an incomplete identity set (${missing.join(", ")}); ` +
				"consecutive request lineage cannot be established",
		};
	}
	const beforeSession = before.sessionId;
	const afterSession = after.sessionId;
	if (beforeSession !== afterSession) {
		return {
			consecutive: false,
			reason:
				"the captures belong to DIFFERENT sessions; they are not a consecutive pair",
		};
	}
	const beforeIteration = before.iteration;
	const afterIteration = after.iteration;
	if (beforeIteration === undefined || afterIteration === undefined) {
		return {
			consecutive: false,
			reason:
				"the captures carry no iteration identity; consecutive request lineage cannot be established",
		};
	}
	if (afterIteration === beforeIteration) {
		// The SAME turn. This is either the stages of ONE request (which
		// differ only by `source`) or a RETRY of it (same preparation,
		// different attempt).
		if (
			before.preparationRequestId !== undefined &&
			after.preparationRequestId !== undefined &&
			before.preparationRequestId === after.preparationRequestId
		) {
			if (
				before.providerAttemptId !== undefined &&
				after.providerAttemptId !== undefined &&
				before.providerAttemptId !== after.providerAttemptId
			) {
				return {
					consecutive: false,
					relation: "retry",
					reason:
						"the captures are two transport ATTEMPTS of the same prepared request (a retry), not two consecutive model turns",
				};
			}
			return {
				consecutive: false,
				relation: "same_request",
				reason:
					"the captures are two representation stages of the SAME request",
			};
		}
		return {
			consecutive: false,
			relation: "same_request",
			reason:
				"the captures share a session and an iteration but carry different preparation identities; they cannot be paired as consecutive turns",
		};
	}
	if (afterIteration !== beforeIteration + 1) {
		return {
			consecutive: false,
			reason: `the iterations are not adjacent (${beforeIteration} -> ${afterIteration}); a missing turn cannot be bridged`,
		};
	}
	// Adjacent iterations. The preparation identities MUST differ: each model
	// turn is its own prepared request, so two records carrying the SAME
	// preparation id at adjacent iterations would be a capture inconsistency,
	// not a turn pair.
	if (
		before.preparationRequestId !== undefined &&
		after.preparationRequestId !== undefined &&
		before.preparationRequestId === after.preparationRequestId
	) {
		return {
			consecutive: false,
			reason:
				"the captures share a preparation identity but sit on adjacent iterations; each model turn must be its own prepared request",
		};
	}
	if (
		before.providerAttemptId !== undefined &&
		after.providerAttemptId !== undefined &&
		before.providerAttemptId === after.providerAttemptId
	) {
		return {
			consecutive: false,
			reason:
				"the captures share a provider attempt identity but sit on adjacent iterations; each model turn must be its own provider attempt",
		};
	}
	return { consecutive: true, relation: "consecutive_turn" };
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the identities a
 * capture record MUST carry to take part in an authoritative consecutive-turn
 * comparison.
 *
 * All five are required: the cohort (the keyed-fingerprint scope), the session
 * (the conversation), the iteration (the turn ordinal), the preparation
 * identity (the prepared request) and the attempt identity (the transport
 * attempt).
 */
function missingIdentities(record: PrefixForensicsCaptureRecord): string[] {
	const missing: string[] = [];
	if (record.cohortId === undefined || record.cohortId.trim() === "") {
		missing.push("cohort");
	}
	if (record.sessionId === undefined || record.sessionId.trim() === "") {
		missing.push("session");
	}
	if (record.iteration === undefined) {
		missing.push("iteration");
	}
	if (
		record.preparationRequestId === undefined ||
		record.preparationRequestId.trim() === ""
	) {
		missing.push("preparation");
	}
	if (
		record.providerAttemptId === undefined ||
		record.providerAttemptId.trim() === ""
	) {
		missing.push("attempt");
	}
	return missing;
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: ONE request,
 * observed at the representation stages that were captured.
 *
 * ## Why a bundle
 *
 * A request is observed at up to THREE representation boundaries (the final
 * runtime projection, the AI SDK prompt, the serialized wire body). Those
 * observations are the SAME request, not three requests. The CORRECTION01
 * analyzer compared ONE record per side, so it could only ever compare two
 * observations of the same stage — it could not express "the request as a
 * whole changed at stage X".
 *
 * A bundle is therefore the unit of comparison: it carries the request's
 * identity and the stage observation for each boundary.
 */
export interface PrefixForensicsRequestBundle {
	readonly sessionId?: string;
	readonly preparationRequestId?: string;
	readonly providerAttemptId?: string;
	readonly iteration?: number;
	readonly cohortId?: string;
	/** The stage observation for each boundary, keyed by the stage name. */
	readonly stages: ReadonlyMap<
		PrefixForensicsStageName,
		PrefixForensicsCaptureRecord
	>;
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: group capture
 * records into request bundles.
 *
 * ## The grouping rule
 *
 * Records are grouped by the identity that identifies ONE request:
 * the cohort, the session, the iteration and the preparation identity.
 * The stage is the KEY inside the bundle, never part of the grouping key —
 * that is the correction: the A/B/C stages of one request must land in ONE
 * bundle even when their file order interleaves them with another request's
 * stages.
 */
export function groupCapturesIntoRequestBundles(
	records: readonly PrefixForensicsCaptureRecord[],
): PrefixForensicsRequestBundle[] {
	const byKey = new Map<string, PrefixForensicsRequestBundle>();
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: a second
	// record for the same identity AND the same stage must not silently
	// REPLACE the first.
	//
	// The grouping used `stages.set(...)`, so two different observations of
	// one boundary were resolved by file order. Which one is authoritative
	// is not decidable from the capture, so a CONFLICTING duplicate is
	// EXCLUDED from the bundle (the stage is reported unavailable); a
	// byte-identical re-emission is a harmless duplicate and is collapsed.
	for (const record of records) {
		const key = bundleGroupingKey(record);
		const existing = byKey.get(key);
		if (existing) {
			const stages = new Map(existing.stages);
			const stage = record.source as PrefixForensicsStageName;
			const previous = stages.get(stage);
			if (previous === undefined) {
				stages.set(stage, record);
			} else if (!sameObservation(previous, record)) {
				stages.delete(stage);
			}
			byKey.set(key, { ...existing, stages });
			continue;
		}
		byKey.set(key, {
			...(record.sessionId !== undefined
				? { sessionId: record.sessionId }
				: {}),
			...(record.preparationRequestId !== undefined
				? { preparationRequestId: record.preparationRequestId }
				: {}),
			...(record.providerAttemptId !== undefined
				? { providerAttemptId: record.providerAttemptId }
				: {}),
			...(record.iteration !== undefined
				? { iteration: record.iteration }
				: {}),
			...(record.cohortId !== undefined ? { cohortId: record.cohortId } : {}),
			stages: new Map([
				[record.source as PrefixForensicsStageName, record] as const,
			]),
		});
	}
	return [...byKey.values()];
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the within-request
 * grouping key of a capture record.
 */
function bundleGroupingKey(record: PrefixForensicsCaptureRecord): string {
	return [
		record.cohortId ?? "-",
		record.sessionId ?? "-",
		String(record.iteration ?? "-"),
		record.preparationRequestId ?? "-",
		record.providerAttemptId ?? "-",
	].join("|");
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: are two records
 * the SAME observation?
 *
 * The comparison is over the record's own content digest AND the whole
 * structural representation. The `representation` identifier is only the
 * STAGE NAME, so it alone cannot distinguish two observations of the same
 * stage; the discriminating parts are the message fingerprint list and the
 * system / tool / body fingerprints.
 */
function sameObservation(
	left: PrefixForensicsCaptureRecord,
	right: PrefixForensicsCaptureRecord,
): boolean {
	if (left.recordSha256 !== right.recordSha256) {
		return false;
	}
	const leftRepresentation = left.representation;
	const rightRepresentation = right.representation;
	if (
		leftRepresentation.representation !== rightRepresentation.representation ||
		leftRepresentation.messageCount !== rightRepresentation.messageCount ||
		leftRepresentation.systemFingerprint !==
			rightRepresentation.systemFingerprint ||
		leftRepresentation.bodyFingerprint !== rightRepresentation.bodyFingerprint
	) {
		return false;
	}
	const leftTools = leftRepresentation.toolFingerprints ?? [];
	const rightTools = rightRepresentation.toolFingerprints ?? [];
	if (leftTools.length !== rightTools.length) {
		return false;
	}
	for (let index = 0; index < leftTools.length; index += 1) {
		const leftTool = leftTools[index];
		const rightTool = rightTools[index];
		if (
			leftTool === undefined ||
			rightTool === undefined ||
			leftTool.name !== rightTool.name ||
			leftTool.fingerprint !== rightTool.fingerprint
		) {
			return false;
		}
	}
	const leftMessages = leftRepresentation.messages ?? [];
	const rightMessages = rightRepresentation.messages ?? [];
	if (leftMessages.length !== rightMessages.length) {
		return false;
	}
	for (let index = 0; index < leftMessages.length; index += 1) {
		const leftMessage = leftMessages[index];
		const rightMessage = rightMessages[index];
		if (
			leftMessage === undefined ||
			rightMessage === undefined ||
			leftMessage.fingerprint !== rightMessage.fingerprint
		) {
			return false;
		}
	}
	return true;
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: compare TWO
 * request BUNDLES across the three representation boundaries.
 *
 * The comparison is the bundle-level analogue of
 * {@link comparePrefixForensicsRequests}: each stage is compared against
 * the SAME stage in the other bundle, and the result reports which stages
 * were available, which differed, and the earliest stage at which a
 * difference appears.
 */
export function comparePrefixForensicsBundles(input: {
	before: PrefixForensicsRequestBundle | undefined;
	after: PrefixForensicsRequestBundle | undefined;
}): PrefixForensicsRequestDifference {
	const { before, after } = input;
	if (!before || !after) {
		return {
			authoritative: false,
			unavailableReason:
				"one of the two requests is absent; no comparison is possible",
			beforeIdentity: bundleIdentity(before),
			afterIdentity: bundleIdentity(after),
			stages: [],
			allStagesEqual: false,
			unavailableStages: [...PREFIX_FORENSICS_STAGES],
		};
	}
	if (
		before.cohortId !== undefined &&
		after.cohortId !== undefined &&
		before.cohortId !== after.cohortId
	) {
		return {
			authoritative: false,
			unavailableReason:
				"the two requests belong to DIFFERENT cohorts; their keyed fingerprints are not comparable",
			beforeIdentity: bundleIdentity(before),
			afterIdentity: bundleIdentity(after),
			stages: [],
			allStagesEqual: false,
			unavailableStages: [...PREFIX_FORENSICS_STAGES],
		};
	}
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
	// authority validation is CENTRALIZED here.
	//
	// The comparator used to return `authoritative: true` after only the
	// cohort check, so a caller that did not separately apply the lineage
	// gate could publish an authoritative comparison of two arbitrary
	// bundles. The comparator now applies the SAME lineage gate itself, so
	// the authority verdict cannot be bypassed.
	const lineage = establishRequestLineage(
		bundleRepresentative(before),
		bundleRepresentative(after),
	);
	if (!lineage.consecutive) {
		return {
			authoritative: false,
			unavailableReason: lineage.reason,
			beforeIdentity: bundleIdentity(before),
			afterIdentity: bundleIdentity(after),
			stages: [],
			allStagesEqual: false,
			unavailableStages: [...PREFIX_FORENSICS_STAGES],
		};
	}
	const stages = PREFIX_FORENSICS_STAGES.map((stage) =>
		compareStage(stage, before.stages.get(stage), after.stages.get(stage)),
	);
	const earliestDifferingStage = stages.find(
		(stage) => stage.available && stage.differs,
	)?.stage;
	const unavailableStages = stages
		.filter((stage) => !stage.available)
		.map((stage) => stage.stage);
	const allStagesEqual =
		unavailableStages.length === 0 && stages.every((stage) => !stage.differs);
	return {
		authoritative: true,
		...(before.cohortId !== undefined
			? { cohortId: before.cohortId }
			: after.cohortId !== undefined
				? { cohortId: after.cohortId }
				: {}),
		beforeIdentity: bundleIdentity(before),
		afterIdentity: bundleIdentity(after),
		stages,
		...(earliestDifferingStage !== undefined ? { earliestDifferingStage } : {}),
		allStagesEqual,
		unavailableStages,
	};
}

/** The correlation identity of a bundle. */
function bundleIdentity(bundle: PrefixForensicsRequestBundle | undefined): {
	readonly sessionId?: string;
	readonly preparationRequestId?: string;
	readonly providerAttemptId?: string;
	readonly iteration?: number;
} {
	return {
		...(bundle?.sessionId !== undefined ? { sessionId: bundle.sessionId } : {}),
		...(bundle?.preparationRequestId !== undefined
			? { preparationRequestId: bundle.preparationRequestId }
			: {}),
		...(bundle?.providerAttemptId !== undefined
			? { providerAttemptId: bundle.providerAttemptId }
			: {}),
		...(bundle?.iteration !== undefined ? { iteration: bundle.iteration } : {}),
	};
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: a REPRESENTATIVE
 * record of a bundle, used to carry the bundle's identity into the lineage
 * gate.
 *
 * The gate reads the cohort, the session, the iteration, the preparation
 * identity and the attempt identity — all of which are the bundle's identity,
 * identical across the bundle's stages. The representative is the bundle's
 * first stage.
 */
function bundleRepresentative(
	bundle: PrefixForensicsRequestBundle,
): PrefixForensicsCaptureRecord {
	const first = bundle.stages.values().next();
	if (first.done) {
		// A bundle with no stage carries no observation at all. The gate
		// must still see it as incomplete rather than as a valid request.
		return {
			schemaVersion: PREFIX_FORENSICS_SCHEMA_VERSION,
			producer: PREFIX_FORENSICS_FINGERPRINT_PRODUCER,
			capturedAt: "",
			// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
			// cohort is REQUIRED on a record, so an unknown cohort is
			// carried as the EMPTY STRING. The lineage gate reads an empty
			// cohort as ABSENT (`record.cohortId.trim() === ""`), so this
			// bundle can never be promoted to an authoritative turn — it
			// is not silently treated as a present-but-equal cohort.
			cohortId: bundle.cohortId ?? "",
			source: "unknown",
			representation: {
				representation: "unknown",
				representationVersion: PREFIX_FORENSICS_SCHEMA_VERSION,
				producer: PREFIX_FORENSICS_FINGERPRINT_PRODUCER,
				messageCount: 0,
				messages: [],
				complete: false,
				incompleteReason: "the request bundle carries no stage observation",
			},
			recordSha256: "",
		};
	}
	return first.value;
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: establish whether
 * two capture records are an EXACT consecutive request lineage.
 *
 * @deprecated Superseded by {@link establishRequestLineage}, which models the
 * runtime's three identities correctly. Retained as a named alias so the
 * CORRECTION01 contract keeps its exported surface.
 */
export function establishConsecutiveRequestLineage(
	before: PrefixForensicsCaptureRecord,
	after: PrefixForensicsCaptureRecord,
): { consecutive: boolean; reason?: string } {
	const verdict = establishRequestLineage(before, after);
	return {
		consecutive: verdict.consecutive,
		...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
	};
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * Compare TWO requests across the three representation boundaries.
 *
 * ## The fail-closed contract
 *
 * A stage whose capture is missing is reported as UNAVAILABLE_FROM_TRACE.
 * A pair whose cohort ids differ is NOT comparable. A pair whose correlation
 * identities do not line up is reported as `NOT_AUTHORITATIVE`.
 *
 * ## The stage-order contract
 *
 * `earliestDifferingStage` is the FIRST stage (in causal order: runtime
 * projection → AI SDK prompt → wire request) at which a difference appears.
 * A difference that appears ONLY at the wire stage means the runtime
 * projection was stable and the ADAPTER introduced the change.
 */
export function comparePrefixForensicsRequests(input: {
	before: PrefixForensicsCaptureRecord | undefined;
	after: PrefixForensicsCaptureRecord | undefined;
}): PrefixForensicsRequestDifference {
	const { before, after } = input;
	const identity = (record: PrefixForensicsCaptureRecord | undefined) => ({
		...(record?.sessionId !== undefined ? { sessionId: record.sessionId } : {}),
		...(record?.preparationRequestId !== undefined
			? { preparationRequestId: record.preparationRequestId }
			: {}),
		...(record?.providerAttemptId !== undefined
			? { providerAttemptId: record.providerAttemptId }
			: {}),
		...(record?.iteration !== undefined ? { iteration: record.iteration } : {}),
	});

	if (!before || !after) {
		return {
			authoritative: false,
			unavailableReason:
				"one of the two requests is absent; no comparison is possible",
			beforeIdentity: identity(before),
			afterIdentity: identity(after),
			stages: [],
			allStagesEqual: false,
			unavailableStages: [...PREFIX_FORENSICS_STAGES],
		};
	}

	if (before.cohortId !== after.cohortId) {
		return {
			authoritative: false,
			unavailableReason:
				"the two requests belong to DIFFERENT cohorts; their keyed fingerprints are not comparable",
			beforeIdentity: identity(before),
			afterIdentity: identity(after),
			stages: [],
			allStagesEqual: false,
			unavailableStages: [...PREFIX_FORENSICS_STAGES],
		};
	}

	// The two requests must be attributable to the SAME preparation lineage.
	// A retry keeps the SAME preparation identity and gains a DIFFERENT
	// attempt identity; two DIFFERENT preparations are two DIFFERENT
	// requests and are compared as such.
	const sameLineage =
		before.preparationRequestId !== undefined &&
		after.preparationRequestId !== undefined &&
		before.preparationRequestId === after.preparationRequestId;
	const sameSession =
		before.sessionId !== undefined &&
		after.sessionId !== undefined &&
		before.sessionId === after.sessionId;
	const comparable = sameLineage || sameSession;

	const stages = PREFIX_FORENSICS_STAGES.map((stage) =>
		compareStage(stage, before, after),
	);
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the stage
	// attribution now reads `differs`, which covers EVERY change category
	// (messages, tools, system, body). The pre-correction implementation
	// looked only at `differences.length > 0` — the MESSAGE list — so a
	// tool-only, a system-only or a body-only change was omitted from the
	// attribution entirely.
	const earliestDifferingStage = stages.find(
		(stage) => stage.available && stage.differs,
	)?.stage;
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: an
	// UNAVAILABLE stage can no longer imply equality. The pre-correction
	// implementation treated `!stage.available` as "equal", so a comparison
	// with two of the three boundaries missing produced a POSITIVE
	// equality result. Equality now requires EVERY stage to be available
	// AND undiffering.
	const unavailableStages = stages
		.filter((stage) => !stage.available)
		.map((stage) => stage.stage);
	const allStagesEqual =
		unavailableStages.length === 0 && stages.every((stage) => !stage.differs);

	return {
		authoritative: comparable,
		...(comparable
			? {}
			: {
					unavailableReason:
						"the two requests do not share a preparation lineage or a session; the comparison is NOT authoritative",
				}),
		cohortId: before.cohortId,
		beforeIdentity: identity(before),
		afterIdentity: identity(after),
		stages,
		...(earliestDifferingStage !== undefined ? { earliestDifferingStage } : {}),
		allStagesEqual,
		unavailableStages,
	};
}
