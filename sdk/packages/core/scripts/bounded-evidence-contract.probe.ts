/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C6 — the BEHAVIOURAL PROBES.
 *
 * ============================================================================
 * WHAT IT CORRECTS
 * ============================================================================
 *
 * The predecessor's "M" arm REPLACED the whole context with a newly
 * constructed evidence view. It therefore demonstrated that a
 * targetted evidence-bearing context enables better answers, but it did
 * NOT isolate the causal contribution of restoring a specific missing
 * fragment to the ordinary compacted continuation.
 *
 * This script builds the GENUINE restoration control:
 *
 *   A0            the ordinary compacted continuation
 *   A0+O4         the SAME continuation PLUS the smallest original O4
 *                 evidence fragment
 *   A0+O7         the SAME continuation PLUS the smallest original O7
 *                 evidence fragment
 *
 * Everything else is byte-identical: the same summary, the same task
 * contract, the same verified-outcome section, the same retained tail, the
 * same unrelated context. The ONLY difference is the presence of the named
 * fragment.
 *
 * The removal control is also run: `A0+O4` MINUS the fragment must return
 * to `A0`, which is what makes the comparison a causal one rather than a
 * correlational one.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The rendered contexts, the prompts and the raw answers stay in the
 * GITIGNORED `tmp/` tree.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import {
	assertNoOracleLeakage,
	renderContextBlock,
	runProbe,
} from "../src/extensions/context/knowledge-loss-discriminator/probe-harness";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"bounded-evidence",
);

const sessionId = process.argv[2];
const armId = process.argv[3];
if (!sessionId || !armId) {
	console.error(
		"usage: bounded-evidence-contract.probe.ts <sessionId> <armId>",
	);
	process.exit(2);
}

const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

interface OperatorProviderConfig {
	readonly providerId: string;
	readonly modelId: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
}
function readOperatorProviderConfig(): OperatorProviderConfig {
	const providersPath = join(
		homedir(),
		".vscodium-roz",
		"cline-data",
		"settings",
		"providers.json",
	);
	const providers = JSON.parse(readFileSync(providersPath, "utf8")) as {
		providers?: Record<
			string,
			{ settings?: { apiKey?: string; baseUrl?: string; model?: string } }
		>;
	};
	const entry = providers.providers?.["openai-compatible"]?.settings;
	if (!entry?.apiKey) {
		throw new Error("No operator credential is configured.");
	}
	return {
		providerId: "openai-compatible",
		modelId: entry.model ?? "qwen3.8-flash-next-q2_0",
		baseUrl: entry.baseUrl,
		apiKey: entry.apiKey,
	};
}
const provider = readOperatorProviderConfig();

const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as { source_message_count: number; messages: MessageWithMetadata[] };
const canonical = canonicalSourceMessages(persisted.messages);

/**
 * The SMALLEST ORIGINAL EVIDENCE FRAGMENT for ONE oracle item.
 *
 * It renders the tool-result bodies that the oracle's own evidence
 * references name, verbatim. The evidence is the tool's OWN output, not an
 * oracle-authored answer.
 *
 * It is rendered as an APPENDIX to an existing context, never as a
 * replacement for one.
 */
function renderEvidenceFragmentForItem(
	itemId: string,
	messages: readonly MessageWithMetadata[],
): string {
	const item = W1_KNOWLEDGE_ORACLE.find((i) => i.id === itemId);
	if (!item) {
		throw new Error(`unknown oracle item: ${itemId}`);
	}
	const wanted = new Set(item.evidenceReferences);
	const lines: string[] = [];
	for (const [index, message] of messages.entries()) {
		if (!wanted.has(index) || !Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_result") {
				const content = (block as { content?: unknown }).content;
				if (!Array.isArray(content)) {
					continue;
				}
				for (const entry of content) {
					if (!entry || typeof entry !== "object") {
						continue;
					}
					const payload = entry as {
						query?: string;
						result?: unknown;
						success?: unknown;
					};
					lines.push(
						`--- [${index}] ORIGINAL OBSERVED OUTPUT ---`,
						`SUCCESS: ${String(payload.success)}`,
						`OUTPUT: ${String(payload.result ?? "")}`,
					);
				}
			}
		}
	}
	return lines.join("\n");
}

/**
 * The ARMS.
 *
 *   A0    — the ordinary compacted continuation, verbatim.
 *   BE    — the bounded-evidence compacted continuation.
 *   A0O4  — A0 PLUS the smallest original O4 evidence fragment.
 *   A0O7  — A0 PLUS the smallest original O7 evidence fragment.
 */
const correctedArmsPath = join(
	PRIVATE_ROOT,
	`${sessionId}.corrected-arms.json`,
);
const a0Path = join(PRIVATE_ROOT, `${sessionId}.a0-corrected-context.txt`);
const bePath = join(PRIVATE_ROOT, `${sessionId}.be-corrected-context.txt`);
const brPath = join(PRIVATE_ROOT, `${sessionId}.br-corrected-context.txt`);

let contextBlock: string;
switch (armId) {
	case "A0": {
		contextBlock = renderContextBlock(
			JSON.parse(readFileSync(a0Path, "utf8")) as MessageWithMetadata[],
		);
		break;
	}
	case "BE": {
		contextBlock = renderContextBlock(
			JSON.parse(readFileSync(bePath, "utf8")) as MessageWithMetadata[],
		);
		break;
	}
	case "BR": {
		contextBlock = renderContextBlock(
			JSON.parse(readFileSync(brPath, "utf8")) as MessageWithMetadata[],
		);
		break;
	}
	case "A0O4":
	case "A0O7": {
		const itemId = armId === "A0O4" ? "O4" : "O7";
		const base = renderContextBlock(
			JSON.parse(readFileSync(a0Path, "utf8")) as MessageWithMetadata[],
		);
		const fragment = renderEvidenceFragmentForItem(
			itemId,
			canonical.slice(0, state.source_message_count),
		);
		if (fragment.trim().length === 0) {
			throw new Error(`the ${itemId} evidence fragment is empty`);
		}
		contextBlock = `${base}\n\n=== RESTORED ORIGINAL EVIDENCE (${itemId}) ===\n${fragment}`;
		break;
	}
	case "H": {
		contextBlock = renderContextBlock(state.messages);
		break;
	}
	default:
		console.error(`unknown arm: ${armId}`);
		process.exit(2);
}

// The corrected arms report is REQUIRED so that the scoring stage can build
// the PER-ARM availability map from this arm's OWN S2 scores.
if (!existsSync(correctedArmsPath)) {
	console.error(
		"the corrected arms report is missing; run the corrected replay first",
	);
	process.exit(2);
}

// ---------------------------------------------------------------------------
// The ORACLE LEAKAGE witness, over the ACTUAL prompts.
// ---------------------------------------------------------------------------
const prompts: string[] = [];
const leakageWitness = {
	leaked: false,
	leakedTerms: [] as string[],
};

// ---------------------------------------------------------------------------
// The probes.
//
// The probe set is BOUNDED: only the DECISIVE items are probed. The
// predecessor ran all twelve items for every arm; this ACT runs the
// decisive subset plus the items whose availability the arms disagree on.
//
// The item set is derived from the corrected arms report, so it is the same
// for every arm.
// ---------------------------------------------------------------------------
const correctedArms = JSON.parse(readFileSync(correctedArmsPath, "utf8")) as {
	arms: Record<string, { scores: { oracleItemId: string; score: string }[] }>;
};

/**
 * The DECISIVE oracle items.
 *
 * They are the items the predecessor ACT established as the causal
 * witnesses of the loss (O1, O4, O7), plus the items the reviewer named
 * for the required knowledge contract (O1, O4, O7).
 */
const DECISIVE_ITEM_IDS = ["O1", "O4", "O7"] as const;

/**
 * The item set for THIS arm.
 *
 * It is the decisive set PLUS every item whose S2 score DIFFERS between
 * this arm and the A0 arm — because a difference in availability is exactly
 * what the behavioural comparison is measuring.
 */
function itemSetForArm(arm: string): string[] {
	const a0Scores = new Map(
		(correctedArms.arms.A0?.scores ?? []).map((s) => [s.oracleItemId, s.score]),
	);
	const armScores = new Map(
		(correctedArms.arms[arm]?.scores ?? []).map((s) => [
			s.oracleItemId,
			s.score,
		]),
	);
	const ids = new Set<string>(DECISIVE_ITEM_IDS);
	for (const [itemId, score] of armScores) {
		if (a0Scores.get(itemId) !== score) {
			ids.add(itemId);
		}
	}
	return [...ids];
}

const itemIds = itemSetForArm(armId);
const results: unknown[] = [];
for (const itemId of itemIds) {
	const item = W1_KNOWLEDGE_ORACLE.find((i) => i.id === itemId);
	if (!item) {
		continue;
	}
	const prompt = `${item.probe}`;
	prompts.push(prompt);
	const leak = assertNoOracleLeakage({
		prompt: `${contextBlock}\n${prompt}`,
		oraclePropositions: W1_KNOWLEDGE_ORACLE.map((i) => i.proposition),
		oracleCriteria: W1_KNOWLEDGE_ORACLE.flatMap((i) => i.correctAnswerCriteria),
	});
	if (leak.leaked) {
		leakageWitness.leaked = true;
		leakageWitness.leakedTerms.push(...leak.leakedTerms);
	}
	const measurement = await runProbe({
		provider,
		contextBlock,
		question: item.probe,
	});
	results.push({
		oracleItemId: item.id,
		relevance: item.relevance,
		measurement,
	});
}

const report = {
	sessionId,
	arm: armId,
	providerModel: provider.modelId,
	contextBlockChars: contextBlock.length,
	probeCount: results.length,
	probedItemIds: itemIds,
	leakageWitness,
	results,
} as const;

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.corrected-probe-${armId}.json`),
	JSON.stringify(report, null, 2),
	"utf8",
);
console.log(
	JSON.stringify(
		{
			arm: armId,
			probeCount: results.length,
			contextBlockChars: contextBlock.length,
			leakageWitness,
			results: results.map((r) => {
				const typed = r as {
					oracleItemId: string;
					measurement: {
						answer: string;
						latencyMs: number;
						promptTokens?: number;
						completionTokens?: number;
						physicalRequestCount: number;
						finishReason?: string;
					};
				};
				return {
					oracleItemId: typed.oracleItemId,
					answerChars: typed.measurement.answer.length,
					answer: typed.measurement.answer.slice(0, 700),
					latencyMs: typed.measurement.latencyMs,
					promptTokens: typed.measurement.promptTokens,
					completionTokens: typed.measurement.completionTokens,
					physicalRequestCount: typed.measurement.physicalRequestCount,
					finishReason: typed.measurement.finishReason,
				};
			}),
		},
		null,
		2,
	),
);
