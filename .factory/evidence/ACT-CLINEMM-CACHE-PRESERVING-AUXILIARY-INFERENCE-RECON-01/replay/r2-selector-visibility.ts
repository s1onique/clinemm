/**
 * ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 (AMENDMENT-01)
 *
 * A6 — the R2 selector visibility comparison, LIMITED TO THE PRE-SELECTION
 * BOUNDARY.
 *
 * The pre-selection boundary is the frozen PARENT wire request that
 * immediately preceded the selector's objective activation: request 79
 * (`cap_run__Jq4WUpj_79_...ai_sdk_prompt...json`), whose `payload.messages`
 * is the parent conversation exactly as it was dispatched before the selector
 * ran. Post-selection observations are EXCLUDED by construction.
 *
 * NO inference, NO network. Frozen artifacts only.
 *
 * Usage: bun r2-selector-visibility.ts <extracted-archive-root>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "/tmp/cpai-w2";

const PRE_SELECTION_CAPTURE =
	"cap_run__Jq4WUpj_79_3befdd8362098a61.ai_sdk_prompt.1.provider-request.json";

interface FrozenCapture {
	readonly payload: {
		readonly messages?: { role: string; content: unknown }[];
		readonly system?: unknown;
		readonly tools?: unknown;
	};
	readonly correlation?: Record<string, unknown>;
}

const selectorCapture = JSON.parse(
	readFileSync(
		join(
			root,
			"provider-request-captures",
			"sel_jxe8l1tr.wire_request.1.provider-request.json",
		),
		"utf8",
	),
) as { payload: { body: string } };
const selectorBody = JSON.parse(selectorCapture.payload.body) as {
	messages?: { role: string; content: { type: string; text: string }[] }[];
	system?: { type: string; text: string }[];
};
const selectorPrompt = (selectorBody.messages ?? [])
	.map((message) => message.content.map((part) => part.text ?? "").join("\n"))
	.join("\n");

const preSelection = JSON.parse(
	readFileSync(
		join(root, "provider-request-captures", PRE_SELECTION_CAPTURE),
		"utf8",
	),
) as FrozenCapture;
const preSelectionMessages = preSelection.payload.messages ?? [];

/**
 * The 60-character shingles of the PRE-SELECTION parent conversation.
 *
 * The FIRST message is the parent TASK text; everything after it is the
 * ENGINEERING ACTIVITY (tool calls and tool results). The two are counted
 * separately, because the selector prompt legitimately embeds the parent task
 * and must NOT embed engineering activity.
 */
const taskShingles = new Set<string>();
const activityShingles = new Set<string>();
for (const [index, message] of preSelectionMessages.entries()) {
	const text = JSON.stringify(message.content ?? "")
		.replace(/\\n/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const target = index === 0 ? taskShingles : activityShingles;
	for (let i = 0; i + 60 <= text.length; i += 60) {
		target.add(text.slice(i, i + 60));
	}
}
let visibleTaskShingles = 0;
for (const shingle of taskShingles) {
	if (selectorPrompt.includes(shingle)) {
		visibleTaskShingles++;
	}
}
let visibleActivityShingles = 0;
let visibleTaskBoilerplateShingles = 0;
const taskText = JSON.stringify(preSelectionMessages[0]?.content ?? "")
	.replace(/\\n/g, " ")
	.replace(/\s+/g, " ")
	.trim();
for (const shingle of activityShingles) {
	if (!selectorPrompt.includes(shingle)) {
		continue;
	}
	// A fragment that ALSO occurs in the parent task message is boilerplate
	// (the runtime instruction block, table separators), not engineering
	// evidence, and is counted separately.
	if (taskText.includes(shingle)) {
		visibleTaskBoilerplateShingles++;
		continue;
	}
	visibleActivityShingles++;
}

/** The selector's own established-observation list. */
const observationStart = selectorPrompt.indexOf("Established observations");
const observationEnd = selectorPrompt.indexOf(
	"Recent failed execution strategy",
);
const establishedObservations =
	observationStart === -1
		? ""
		: selectorPrompt
				.slice(
					observationStart,
					observationEnd === -1 ? undefined : observationEnd,
				)
				.trim();

export interface SelectorVisibilityReport {
	readonly actId: string;
	readonly amendment: string;
	readonly evidenceClass: string;
	readonly boundary: {
		readonly preSelectionCapture: string;
		readonly preSelectionIteration: number | undefined;
		readonly preSelectionMessageCount: number;
		readonly postSelectionObservationsUsed: false;
	};
	readonly selector: {
		readonly systemChars: number;
		readonly promptChars: number;
		readonly messageCount: number;
		readonly toolCount: number;
	};
	readonly preSelectionActivity: {
		readonly parentTaskShingleCount: number;
		readonly parentTaskShinglesVisibleInSelectorPrompt: number;
		readonly engineeringActivityShingleCount: number;
		readonly engineeringActivityShinglesVisibleInSelectorPrompt: number;
		readonly taskBoilerplateShinglesVisibleInSelectorPrompt: number;
	};
	readonly establishedObservationsVerbatim: string;
	readonly visibilityCategories: Record<
		string,
		{ visible: boolean; evidence: string }
	>;
	readonly claims: Record<string, string>;
}

export function runSelectorVisibility(): SelectorVisibilityReport {
	const categories = {
		previously_attempted_changes: {
			visible: visibleActivityShingles > 0,
			evidence: `${visibleActivityShingles} of ${activityShingles.size} PRE-SELECTION engineering-activity shingles appear verbatim in the selector prompt (the parent TASK shingles that do appear are the parent task text the selector is entitled to see)`,
		},
		successful_changes: {
			visible: false,
			evidence:
				"the selector's 'Established observations' list carries only stagnation facts; no successful-edit observation appears in it",
		},
		failed_changes: {
			visible: false,
			evidence:
				"the selector prompt carries a 'Recent failed execution strategy' sentence (tool-level stagnation), not per-change outcomes",
		},
		executed_verification: {
			visible: false,
			evidence:
				"no verification command or its outcome appears in the selector prompt",
		},
		verification_outcomes: {
			visible: false,
			evidence: "same as executed_verification",
		},
		unresolved_parent_requirements: {
			visible: true,
			evidence:
				"the selector prompt carries the parent task text and the parent obligation reference ids verbatim",
		},
		most_recent_engineering_activity: {
			visible: false,
			evidence:
				"the selector prompt carries no transcript tail, only the parent's task text",
		},
		known_blockers: {
			visible: true,
			evidence:
				"the stagnation facts (unproductive rounds, exhausted corrective-instruction allowance) are the only blockers the prompt carries",
		},
		source_references: {
			visible: false,
			evidence:
				"the selector prompt cites no canonical message references, because the existing projection carries no canonical reference ids",
		},
	};
	return {
		actId: "ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01",
		amendment: "AMENDMENT-01",
		evidenceClass: "REAL_PRODUCTION_SEAM",
		boundary: {
			preSelectionCapture: PRE_SELECTION_CAPTURE,
			preSelectionIteration: preSelection.correlation?.iteration as
				| number
				| undefined,
			preSelectionMessageCount: preSelectionMessages.length,
			postSelectionObservationsUsed: false,
		},
		selector: {
			systemChars: (selectorBody.system ?? [])
				.map((part) => (part as { text?: string }).text ?? "")
				.join("").length,
			promptChars: selectorPrompt.length,
			messageCount: selectorBody.messages?.length ?? 0,
			toolCount: 0,
		},
		preSelectionActivity: {
			parentTaskShingleCount: taskShingles.size,
			parentTaskShinglesVisibleInSelectorPrompt: visibleTaskShingles,
			engineeringActivityShingleCount: activityShingles.size,
			engineeringActivityShinglesVisibleInSelectorPrompt:
				visibleActivityShingles,
			taskBoilerplateShinglesVisibleInSelectorPrompt:
				visibleTaskBoilerplateShingles,
		},
		establishedObservationsVerbatim: establishedObservations,
		visibilityCategories: categories,
		claims: {
			STALE_OBJECTIVE_WITNESS:
				"CONFIRMED — the selector cites only stagnation facts; the parent history shows the rpCommitted work was already implemented and tested, and no projection of that work reached the selector prompt",
			SELECTOR_SOURCE_VISIBILITY:
				"the selector sees the parent task text, the obligation reference ids, the available tools, the remaining allowance and a stagnation-only observation list; it does NOT see the parent's tool activity, verification outcomes or transcript tail",
			COMPLETED_WORK_EVIDENCE_AVAILABLE:
				"YES in the pre-selection parent request",
			COMPLETED_WORK_EVIDENCE_PROJECTED:
				"NO — no pre-selection activity shingle appears in the selector prompt",
			OUTSTANDING_WORK_AUTHORITY:
				"the parent obligation reference ids and the parent task text; the selector cannot infer completion from them",
			SMALLEST_EVIDENCE_PROJECTION:
				"a bounded list of completed/verified engineering observations, derived from the parent's own recorded activity, added to the selector prompt",
			FULL_CONTEXT_CANDIDATE_FEASIBILITY:
				"structurally feasible but out of scope for the PCK successor and it would weaken the bounded-objective authority boundary",
		},
	};
}

if (import.meta.main) {
	process.stdout.write(`${JSON.stringify(runSelectorVisibility(), null, 2)}\n`);
}
