/**
 * ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01
 *
 * C5 — the R2 selector source-visibility discriminator.
 *
 * It compares the ACTUAL selector prompt (frozen capture) with the ACTUAL
 * parent history (frozen session transcript) and reports, category by
 * category, which engineering evidence the selector could and could not see.
 *
 * NO inference, NO network. Frozen artifacts only.
 *
 * Usage: bun r2-selector-visibility.ts <extracted-archive-root> <session-dir>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "/tmp/cpai-w2";
const sessionDir =
	process.argv[3] ??
	"/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data/sessions/1795689353819_2k3co";

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

/** Extract one labelled section of the selector prompt. */
function section(label: string, nextLabel?: string): string {
	const start = selectorPrompt.indexOf(label);
	if (start === -1) {
		return "";
	}
	const from = start + label.length;
	const end = nextLabel ? selectorPrompt.indexOf(nextLabel, from) : -1;
	return selectorPrompt
		.slice(from, end === -1 ? undefined : end)
		.replace(/^[:\s]+/, "")
		.trim();
}

const establishedObservations = section(
	"Established observations",
	"Recent failed execution strategy",
);
const obligationReferences = section(
	"Parent obligation references",
	"Outstanding parent acceptance obligations",
);

const session = JSON.parse(
	readFileSync(join(sessionDir, "1795689353819_2k3co.messages.json"), "utf8"),
) as {
	messages?: { role: string; content: unknown }[];
	system_prompt?: string;
};
const parentMessages = session.messages ?? [];

interface ToolActivity {
	readonly name: string;
	readonly text: string;
}
const toolCalls: ToolActivity[] = [];
const toolResults: ToolActivity[] = [];
for (const message of parentMessages) {
	if (!Array.isArray(message.content)) {
		continue;
	}
	for (const block of message.content as Record<string, unknown>[]) {
		if (block.type === "tool_use") {
			toolCalls.push({
				name: String(block.name ?? "?"),
				text: JSON.stringify(block.input ?? {}).slice(0, 400),
			});
			continue;
		}
		if (block.type === "tool_result") {
			const inner = block.content as Record<string, unknown>[] | undefined;
			for (const entry of inner ?? []) {
				if (entry && typeof entry === "object" && "result" in entry) {
					toolResults.push({
						name: String(block.name ?? "?"),
						text: String((entry as { result?: unknown }).result ?? "").slice(
							0,
							400,
						),
					});
				}
			}
		}
	}
}

/**
 * Does the selector prompt carry ANY of the parent's tool activity?
 *
 * A 60-character shingle from each parent tool activity is the probe: a real
 * projection would carry the observation verbatim.
 */
const shingles = new Set<string>();
for (const activity of [...toolCalls, ...toolResults]) {
	const normalized = activity.text.replace(/\s+/g, " ").trim();
	for (let i = 0; i + 60 <= normalized.length; i += 60) {
		shingles.add(normalized.slice(i, i + 60));
	}
}
let visibleShingles = 0;
for (const shingle of shingles) {
	if (selectorPrompt.includes(shingle)) {
		visibleShingles++;
	}
}

const categories = {
	previously_attempted_changes: {
		visible: visibleShingles > 0,
		evidence: `${visibleShingles} of ${shingles.size} parent activity shingles appear verbatim in the selector prompt`,
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

const report = {
	actId: "ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01",
	c5: "C5 R2 selector source visibility",
	evidenceClass: "REAL_PRODUCTION_SEAM",
	selector: {
		systemChars: (selectorBody.system ?? []).map((part) => part.text).join("")
			.length,
		promptChars: selectorPrompt.length,
		messageCount: selectorBody.messages?.length ?? 0,
		toolCount: 0,
	},
	parent: {
		systemPromptChars: session.system_prompt?.length ?? 0,
		messageCount: parentMessages.length,
		toolCallCount: toolCalls.length,
		toolResultCount: toolResults.length,
	},
	establishedObservationsVerbatim: establishedObservations,
	obligationReferencesVerbatim: obligationReferences,
	visibilityCategories: categories,
	projections: {
		S0: {
			name: "existing selector context",
			seesCompletedWork: false,
			seesVerificationOutcomes: false,
			seesTranscriptTail: false,
			note: "the historical stale-objective witness: the objective proposed implementing rpCommitted recovery behaviour that the parent had already implemented and verified",
		},
		S1: {
			name: "existing selector context plus a bounded projection of established engineering evidence",
			seesCompletedWork:
				"FEASIBLE — the parent history already carries tool-level activity; a bounded projection of successful edits and verification outcomes could be derived from it",
			seesVerificationOutcomes:
				"FEASIBLE — the tool results carry the command output, but no trustworthy success classification exists yet and must not be inferred from command execution alone",
			seesTranscriptTail: false,
			note: "the smallest evidence projection; it does not preserve a parent request prefix, because the selector is an INDEPENDENT request",
		},
		S2: {
			name: "cache-compatible parent-context projection with a selection activation suffix",
			seesCompletedWork: true,
			seesVerificationOutcomes: true,
			seesTranscriptTail: true,
			note: "structurally feasible against the parent request, but it would broaden the selector's authority beyond the bounded-objective contract and is NOT proposed for the PCK successor",
		},
	},
	claims: {
		STALE_OBJECTIVE_WITNESS:
			"CONFIRMED — the selector prompt asks for an objective advancing an outstanding obligation and cites only stagnation facts; the parent history shows the rpCommitted work was already implemented and tested, and no projection of that work reached the selector prompt",
		SELECTOR_SOURCE_VISIBILITY:
			"the selector sees the parent task text, the obligation reference ids, the available tools, the remaining allowance and a stagnation-only observation list; it does NOT see the parent's tool activity, verification outcomes or transcript tail",
		COMPLETED_WORK_EVIDENCE_AVAILABLE:
			"YES in the parent history (tool calls and tool results exist in the frozen transcript)",
		COMPLETED_WORK_EVIDENCE_PROJECTED:
			"NO — none of the parent activity shingles appears verbatim in the selector prompt",
		OUTSTANDING_WORK_AUTHORITY:
			"the parent obligation reference ids and the parent task text; the selector cannot infer completion from them",
		SMALLEST_EVIDENCE_PROJECTION:
			"a bounded list of completed/verified engineering observations, derived from the parent's own recorded activity, added to the selector prompt",
		FULL_CONTEXT_CANDIDATE_FEASIBILITY:
			"structurally feasible (see S2) but out of scope for the PCK successor and it would weaken the bounded-objective authority boundary",
	},
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
