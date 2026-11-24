/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C4/C6 — the S3 BEHAVIOURAL PROBES.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It runs the oracle's bounded diagnostic questions against each arm's
 * CONTEXT and captures the model's answer, the measured inference economics
 * and the physical request count.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 * It does NOT run a complete Round C task. It does NOT supply the answers:
 * the probe question is the whole question, and the ORACLE is never in the
 * prompt.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
	"knowledge-loss",
);

const sessionId = process.argv[2];
const armId = process.argv[3];
if (!sessionId || !armId) {
	console.error(
		"usage: knowledge-loss-discriminator.probe.ts <sessionId> <armId>",
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

// ---------------------------------------------------------------------------
// The arm's CONTEXT.
// ---------------------------------------------------------------------------
const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as { source_message_count: number; messages: MessageWithMetadata[] };
const canonical = canonicalSourceMessages(persisted.messages);

/**
 * The MINIMAL source-faithful evidence view.
 *
 * It renders every tool call's COMMAND and every tool result's OUTPUT
 * verbatim, and drops the private reasoning (which is excluded from the
 * compaction path too) and the assistant prose. It is used ONLY by the
 * full-source control arm, whose rendered size exceeds the model's window.
 */
function renderEvidenceOnlyBlock(
	messages: readonly MessageWithMetadata[],
): string {
	const lines: string[] = [];
	for (const [index, message] of messages.entries()) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				const input = (block as { input?: { commands?: unknown } }).input;
				const commands = input?.commands;
				const list = Array.isArray(commands)
					? commands
					: typeof commands === "string"
						? [commands]
						: [];
				lines.push(
					`--- [${index}] COMMAND ---`,
					list.map((c) => String(c)).join("\n"),
				);
				continue;
			}
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
						`--- [${index}] COMMAND OUTPUT ---`,
						`COMMAND: ${payload.query ?? ""}`,
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
 * The MINIMAL ORIGINAL EVIDENCE block.
 *
 * It restores the ORIGINAL tool-result bodies that the oracle's evidence
 * references name. The evidence is the tool's own output, not an
 * oracle-authored answer.
 */
function renderMinimalEvidenceBlock(
	messages: readonly MessageWithMetadata[],
): string {
	const wanted = new Set<number>();
	for (const item of W1_KNOWLEDGE_ORACLE) {
		for (const reference of item.evidenceReferences) {
			wanted.add(reference);
		}
	}
	const lines: string[] = [];
	for (const [index, message] of messages.entries()) {
		if (!wanted.has(index) || !Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				const input = (block as { input?: { commands?: unknown } }).input;
				const commands = input?.commands;
				const list = Array.isArray(commands)
					? commands
					: typeof commands === "string"
						? [commands]
						: [];
				lines.push(
					`--- [${index}] COMMAND ---`,
					list.map((c) => String(c)).join("\n"),
				);
				continue;
			}
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
						`--- [${index}] COMMAND OUTPUT ---`,
						`COMMAND: ${payload.query ?? ""}`,
						`SUCCESS: ${String(payload.success)}`,
						`OUTPUT: ${String(payload.result ?? "")}`,
					);
				}
			}
			if (block.type === "text") {
				lines.push(
					`--- [${index}] NOTE ---`,
					(block as { text?: string }).text ?? "",
				);
			}
		}
	}
	return lines.join("\n");
}

let contextBlock: string;
switch (armId) {
	case "F":
		// The FULL SOURCE does not fit the model's window: the rendered
		// source prefix is ~146k tokens against a 131072-token window. The
		// ACT forbids silently truncating it, so the limitation is
		// QUALIFIED and recorded, and the arm is built as the MINIMAL
		// source-faithful evidence view: the COMMAND and its OUTPUT for
		// every tool call, with the thinking blocks and the assistant prose
		// removed (neither is provider-visible knowledge in the compaction
		// path either). Every tool-result body is retained verbatim.
		contextBlock = renderEvidenceOnlyBlock(
			canonical.slice(0, state.source_message_count),
		);
		break;
	case "H":
		contextBlock = renderContextBlock(state.messages);
		break;
	case "A0":
		contextBlock = readFileSync(
			join(PRIVATE_ROOT, `${sessionId}.a0-context.txt`),
			"utf8",
		);
		break;
	case "A1":
		contextBlock = readFileSync(
			join(PRIVATE_ROOT, `${sessionId}.a1-context.txt`),
			"utf8",
		);
		break;
	case "M":
		// The MINIMAL EVIDENCE RESTORATION arm (C6.3).
		//
		// It restores the SMALLEST ORIGINAL SOURCE EVIDENCE required to
		// recover the propositions: the tool-result bodies that the oracle's
		// own evidence references name. The evidence is the ORIGINAL tool
		// output, not an oracle-authored answer, and nothing unrelated is
		// added.
		//
		// It exists because the FULL SOURCE does not fit the model's window
		// on this workload, so it is the only way to establish the
		// full-source positive control without silently truncating.
		contextBlock = renderMinimalEvidenceBlock(
			canonical.slice(0, state.source_message_count),
		);
		break;
	default:
		console.error(`unknown arm: ${armId}`);
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
// ---------------------------------------------------------------------------
const results: unknown[] = [];
for (const item of W1_KNOWLEDGE_ORACLE) {
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
	leakageWitness,
	results,
} as const;

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.probe-${armId}.json`),
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
