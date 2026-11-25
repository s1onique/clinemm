/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
 * (AMENDMENT-02 C1) — THE GEMINI TERMINAL-AUTHORITY REGRESSION.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 *
 * The compaction acceptance contract refuses a summary candidate whose
 * terminal status is KNOWN to be bad. That decision consumes the terminal
 * facts the compatibility adapter (`compat.ts`) produces from the gateway's
 * `finish` event.
 *
 * The adapter mapped the gateway's finish reason with:
 *
 *     success: event.reason !== "error"
 *
 * The gateway's finish reason vocabulary (`AgentModelFinishReason`) contains
 * MORE than "error", and the shared contract states the intended semantics
 * explicitly:
 *
 *     "Missing or unrecognized provider finish reasons normalize to
 *      `unknown`: the response may be cut off and must not be treated as
 *      successful completion."
 *
 * The adapter therefore DISCARDED the distinction the transport had already
 * made. A Gemini stream that ends without a provider finish reason produces
 * gateway `finish.reason === "unknown"`; because that is not the literal
 * string "error", the adapter reported:
 *
 *     done { success: true, incompleteReason: undefined }
 *
 * which is BYTE-IDENTICAL to the compatibility chunk a NORMAL Gemini `STOP`
 * completion produces (`finish.reason === "stop"` -> `success: true`). A
 * premature termination was therefore indistinguishable from an authoritative
 * successful completion at the compatibility boundary, and a summary produced
 * by a prematurely terminated stream carried no signal that authoritative
 * successful completion had never been established.
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 * It drives the REAL compatibility adapter (`createGatewayApiHandlerAsync`)
 * over the REAL gateway with a deterministic Gemini SSE substitute — the same
 * fixtures the transport probe established — and asserts the EXACT
 * compatibility chunks.
 *
 * The claim is deliberately narrow: an `unknown` terminal reason means
 * AUTHORITATIVE SUCCESSFUL COMPLETION HAS NOT BEEN ESTABLISHED. It does NOT
 * claim that an unknown reason proves truncation; a provider may legitimately
 * report a reason this codebase does not model. The distinction the contract
 * requires is between an ESTABLISHED completion and an UNEStablished one.
 */

import { describe, expect, it } from "vitest";
import { createGatewayApiHandlerAsync } from "./compat";

const PROVIDER_ID = "gemini";
const MODEL_ID = "stub-model";

/**
 * A Gemini SSE body whose candidate carries the given finish reason.
 *
 * `finishReason: undefined` is the premature case: the stream ends after
 * producing text, without the provider ever reporting a terminal reason.
 */
function geminiSse(finishReason: string | undefined, content: string): string {
	const candidate: Record<string, unknown> = {
		content: { parts: [{ text: content }], role: "model" },
		index: 0,
	};
	if (finishReason !== undefined) {
		candidate.finishReason = finishReason;
	}
	return `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`;
}

/**
 * Stream one turn through the REAL compatibility adapter and return the
 * compatibility chunks it produced.
 */
async function adapterChunks(input: {
	finishReason: string | undefined;
	content: string;
}): Promise<readonly Record<string, unknown>[]> {
	const fetchStub = (async () =>
		new Response(geminiSse(input.finishReason, input.content), {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		})) as typeof fetch;

	const handler = await createGatewayApiHandlerAsync({
		providerId: PROVIDER_ID,
		modelId: MODEL_ID,
		apiKey: "test-key",
		baseUrl: "https://stub.invalid/v1",
		fetch: fetchStub,
	} as never);

	const chunks: Record<string, unknown>[] = [];
	for await (const chunk of handler.createMessage("sys", [
		{ role: "user", content: "hi" } as never,
	])) {
		chunks.push(chunk as unknown as Record<string, unknown>);
	}
	return chunks;
}

function doneChunk(
	chunks: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
	return chunks.find((chunk) => chunk.type === "done");
}

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the Gemini terminal authority at the compatibility boundary", () => {
	it("does not report an UNEStablished completion as a successful completion", async () => {
		// The premature stream: text, then the provider never reports a
		// terminal reason.
		const chunks = await adapterChunks({
			finishReason: undefined,
			content: "partial summary",
		});

		const done = doneChunk(chunks);
		expect(done).toBeDefined();
		// The text was still delivered — the defect is not a lost text chunk.
		expect(
			chunks.some(
				(chunk) => chunk.type === "text" && chunk.text === "partial summary",
			),
		).toBe(true);
		// THE DEFECT: an unestablished completion was reported as a
		// SUCCESSFUL completion, indistinguishable from a normal STOP.
		expect(done?.success).not.toBe(true);
		// It is not reported as a provider-reported incompleteness either:
		// the adapter must not manufacture a truncation claim it cannot make.
		expect(done?.incompleteReason).toBeUndefined();
		// The terminal reason is preserved, so a consumer can tell an
		// UNEStablished completion from a FAILED one. Both are non-successful,
		// but they are different facts.
		expect(done?.finishReason).toBe("unknown");
		// No error message is invented: the transport did not report a
		// failure, it reported the absence of a terminal reason.
		expect(done?.error).toBeUndefined();
	});

	it("keeps a NORMAL STOP completion successful", async () => {
		const chunks = await adapterChunks({
			finishReason: "STOP",
			content: "complete summary",
		});

		const done = doneChunk(chunks);
		expect(done).toBeDefined();
		expect(done?.success).toBe(true);
		expect(done?.incompleteReason).toBeUndefined();
		expect(done?.finishReason).toBe("stop");
	});

	it("keeps the two Gemini completions DISTINGUISHABLE", async () => {
		const premature = doneChunk(
			await adapterChunks({
				finishReason: undefined,
				content: "partial summary",
			}),
		);
		const normal = doneChunk(
			await adapterChunks({
				finishReason: "STOP",
				content: "complete summary",
			}),
		);

		// The two compatibility completions must not be the same shape.
		expect(premature?.success).not.toBe(normal?.success);
		expect(premature?.finishReason).not.toBe(normal?.finishReason);
	});

	it("keeps the established MAX_TOKENS mapping intact", async () => {
		const chunks = await adapterChunks({
			finishReason: "MAX_TOKENS",
			content: "truncated summary",
		});

		const done = doneChunk(chunks);
		expect(done).toBeDefined();
		// The truncation claim is reported EXACTLY as before.
		expect(done?.incompleteReason).toBe("max_tokens");
		// The completion itself IS established, so it stays successful and
		// the truncation is carried by `incompleteReason` alone.
		expect(done?.success).toBe(true);
		expect(done?.finishReason).toBe("max-tokens");
	});

	it("keeps the established SAFETY (content filter) mapping intact", async () => {
		const chunks = await adapterChunks({
			finishReason: "SAFETY",
			content: "filtered summary",
		});

		const done = doneChunk(chunks);
		expect(done).toBeDefined();
		expect(done?.incompleteReason).toBe("content_filter");
		expect(done?.success).toBe(true);
		expect(done?.finishReason).toBe("content-filter");
	});
});
