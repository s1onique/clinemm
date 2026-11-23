/**
 * ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
 *
 * TEST-LOCAL checkpoint GENERATION probe.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a probe script.
 * ============================================================================
 *
 * WHAT IT DOES
 * ------------
 *
 * It generates ONE model-authored working-knowledge checkpoint per frozen
 * boundary, from the REAL canonical history, using the EXISTING authorized
 * local provider configuration.
 *
 * It does NOT send the private Keycloak transcript to a NEW external
 * provider. It uses the operator's already-configured provider (the same
 * provider the extension itself uses), read from the operator-local
 * `~/.cline/data` stores.
 *
 * It does NOT write to the repository, does NOT run repository commands,
 * does NOT modify the live session, and does NOT touch the live sidecar.
 *
 * The generated checkpoints are written to the OPERATOR-LOCAL private
 * capture root, never into Git.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHandlerAsync } from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import {
	buildCheckpointInputView,
	buildCheckpointRequest,
	CHECKPOINT_SYSTEM_PROMPT,
} from "../src/extensions/context/knowledge-checkpoint-probe/checkpoint-request";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

const SESSION_ID = "1795466566666_uzla2";
/**
 * The OPERATOR-LOCAL output root for the generated checkpoints.
 *
 * It is the repository's gitignored `tmp/` tree, so the raw model output
 * and the checkpoint free text are NEVER committed. The private capture
 * root is read-only in this environment, so the generated artifacts live
 * in their own operator-local directory.
 */
const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"pck-probe-private",
	SESSION_ID,
);

/**
 * The READ-ONLY root of the frozen capture artifacts.
 */
const CAPTURE_ROOT = join(homedir(), "clinemm-private-captures", SESSION_ID);
const TRANSCRIPT_ROOT = join(
	homedir(),
	".vscodium-roz",
	"cline-data",
	"sessions",
	SESSION_ID,
);

interface Boundary {
	readonly name: string;
	readonly sidecar: string;
}

const BOUNDARIES: readonly Boundary[] = [
	{ name: "boundary-1", sidecar: "first-compaction.json" },
	{ name: "boundary-2", sidecar: "second-compaction.json" },
];

interface OperatorProviderConfig {
	readonly providerId: string;
	readonly modelId: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly modelInfo?: Record<string, unknown>;
}

/**
 * Read the operator's EXISTING provider configuration.
 *
 * The credential is read from the operator-local secrets store and is NEVER
 * written to any output file, log line, or evidence artifact.
 */
function readOperatorProviderConfig(): OperatorProviderConfig {
	const state = JSON.parse(
		readFileSync(join(homedir(), ".cline", "data", "globalState.json"), "utf8"),
	) as Record<string, unknown>;
	const secrets = JSON.parse(
		readFileSync(join(homedir(), ".cline", "data", "secrets.json"), "utf8"),
	) as Record<string, string>;
	// The operator's configured provider is reached through the
	// OpenAI-COMPATIBLE transport with the operator's own base URL and key.
	// The `minimax` provider id in the state file is a product-level alias
	// resolved by the host, not a registered SDK provider id.
	const providerId = "openai-compatible";
	const modelId = String(state.actModeApiModelId ?? "MiniMax-M3");
	const baseUrl = state.openAiBaseUrl ? String(state.openAiBaseUrl) : undefined;
	const modelInfo = state.actModeOpenAiModelInfo as
		| Record<string, unknown>
		| undefined;
	const apiKey = secrets.openAiApiKey ?? secrets.minimaxApiKey;
	return { providerId, modelId, baseUrl, apiKey, modelInfo };
}

/**
 * Extract the first JSON object from a model response.
 *
 * The model may wrap the JSON in a fenced code block, so the fence is
 * stripped before the object is located.
 */
function extractJsonObject(text: string): unknown {
	const withoutFence = text
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/^\s*```(?:json)?\s*/i, "")
		.replace(/\s*```\s*$/, "")
		.trim();
	const start = withoutFence.indexOf("{");
	const end = withoutFence.lastIndexOf("}");
	if (start === -1 || end === -1 || end < start) {
		writeFileSync(join(PRIVATE_ROOT, "checkpoint-raw-response.txt"), text);
		throw new Error("The model response contained no JSON object.");
	}
	return JSON.parse(withoutFence.slice(start, end + 1));
}

async function generateCheckpoint(input: {
	canonicalMessages: MessageWithMetadata[];
}): Promise<{ raw: string; document: unknown }> {
	const provider = readOperatorProviderConfig();
	const view = buildCheckpointInputView(input.canonicalMessages);
	const request = buildCheckpointRequest(view);
	const handler = await createHandlerAsync({
		providerId: provider.providerId,
		modelId: provider.modelId,
		apiKey: provider.apiKey,
		baseUrl: provider.baseUrl,
		modelInfo: provider.modelInfo as never,
	} as never);
	const stream = handler.createMessage(CHECKPOINT_SYSTEM_PROMPT, [
		{ role: "user", content: request },
	]);
	let raw = "";
	for await (const chunk of stream) {
		if (chunk.type === "text" && typeof chunk.text === "string") {
			raw += chunk.text;
		}
	}
	return { raw, document: extractJsonObject(raw) };
}

async function main(): Promise<void> {
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	const transcript = JSON.parse(
		readFileSync(join(TRANSCRIPT_ROOT, `${SESSION_ID}.messages.json`), "utf8"),
	) as { messages: MessageWithMetadata[] };
	const canonical = canonicalSourceMessages(transcript.messages);
	const provider = readOperatorProviderConfig();
	const results: Record<string, unknown> = {};
	for (const boundary of BOUNDARIES) {
		const sidecar = JSON.parse(
			readFileSync(join(CAPTURE_ROOT, boundary.sidecar), "utf8"),
		) as { source_message_count: number };
		const prefix = canonical.slice(0, sidecar.source_message_count);
		const started = Date.now();
		const { raw, document } = await generateCheckpoint({
			canonicalMessages: prefix,
		});
		const latencyMs = Date.now() - started;
		const payload = {
			boundary: boundary.name,
			sourceMessageCount: prefix.length,
			providerId: provider.providerId,
			modelId: provider.modelId,
			latencyMs,
			rawResponseChars: raw.length,
			rawResponseSha256: createHash("sha256").update(raw).digest("hex"),
			document,
		};
		const outPath = join(PRIVATE_ROOT, `checkpoint-${boundary.name}.json`);
		writeFileSync(outPath, JSON.stringify(payload, null, 2), {
			mode: 0o600,
		});
		results[boundary.name] = {
			outPath,
			latencyMs,
			rawResponseChars: raw.length,
			recordCount: Array.isArray((document as { records?: unknown[] }).records)
				? (document as { records: unknown[] }).records.length
				: 0,
		};
	}
	// A sanitized receipt only. The raw response and the free text stay in
	// the operator-local capture root.
	writeFileSync(
		join(PRIVATE_ROOT, "checkpoint-generation-receipt.json"),
		JSON.stringify(results, null, 2),
		{ mode: 0o600 },
	);
	process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

await main();
