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

import type {
	PrefixForensicsCaptureRecord,
	PrefixForensicsMessageFingerprint,
} from "./prefix-forensics";

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
}

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
	/** Whether the stages were all equal. */
	readonly allStagesEqual: boolean;
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
	const earliestDifferingStage = stages.find(
		(stage) => stage.available && stage.differences.length > 0,
	)?.stage;
	const allStagesEqual = stages.every(
		(stage) => !stage.available || stage.differences.length === 0,
	);

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
	};
}
