/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
 *
 * AMENDMENT-01 A2 — THE COMPLETION-STATUS PROPAGATION WITNESS.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 *
 * The predecessor's R1 test did NOT independently assert that the provider's
 * terminal status survives the summarizer transport. It asserted that the
 * summarizer was CALLED and that the returned summary text was what the
 * fixture put there. Neither of those proves that the terminal field reached
 * the acceptance decision.
 *
 * This suite therefore drives the ACTUAL `generateSummary()` implementation
 * with a deterministic transport substitute and asserts the EXACT resulting
 * terminal-status representation.
 *
 * The point of the suite is to establish whether propagation is ALREADY
 * correct. If it is, the production code must not be changed for its sake.
 */

import type { ApiStreamChunk } from "@cline/llms";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSummary } from "./summary-generation";

const { createHandlerMock, createMessageMock } = vi.hoisted(() => ({
	createHandlerMock: vi.fn(),
	createMessageMock: vi.fn(),
}));

vi.mock("@cline/llms", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/llms")>()),
	createHandlerAsync: createHandlerMock,
}));

const providerConfig = {
	providerId: "anthropic",
	modelId: "test-model",
	apiKey: "fresh-token",
} as never;

const text = (value: string): ApiStreamChunk => ({
	type: "text",
	id: "summary",
	text: value,
});
const done: ApiStreamChunk = { type: "done", id: "summary", success: true };

function respond(chunks: ApiStreamChunk[]) {
	createMessageMock.mockImplementation(async function* () {
		yield* chunks;
	});
}

beforeEach(() => {
	createHandlerMock.mockReset();
	createMessageMock.mockReset();
	createHandlerMock.mockResolvedValue({
		createMessage: createMessageMock,
	});
});

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the summarizer terminal-status propagation", () => {
	it("propagates a provider-reported incompleteness with success=true", async () => {
		respond([
			text("Partial summary"),
			{ ...done, incompleteReason: "max_output_tokens" },
		]);

		const result = await generateSummary({
			providerConfig,
			systemPrompt: "sys",
			request: "req",
		});

		expect(result.incompleteReason).toBe("max_output_tokens");
		expect(result.failed).toBe(false);
		expect(result.completed).toBe(true);
		expect(result.text).toBe("Partial summary");
	});

	it("propagates a failure with success=false and no error string", async () => {
		respond([text("Partial summary"), { ...done, success: false }]);

		const result = await generateSummary({
			providerConfig,
			systemPrompt: "sys",
			request: "req",
		});

		expect(result.failed).toBe(true);
		expect(result.incompleteReason).toBeUndefined();
		expect(result.completed).toBe(true);
		expect(result.text).toBe("Partial summary");
	});

	it("propagates a normal successful completion", async () => {
		respond([text("A complete summary."), done]);

		const result = await generateSummary({
			providerConfig,
			systemPrompt: "sys",
			request: "req",
		});

		expect(result.failed).toBe(false);
		expect(result.incompleteReason).toBeUndefined();
		expect(result.completed).toBe(true);
		expect(result.text).toBe("A complete summary.");
	});

	it("reports a stream that ended WITHOUT a completion event as not completed", async () => {
		// The transport contract allows a handler to finish without emitting
		// the optional done chunk. That is the LEGACY shape: it is NOT an
		// unexpected stream termination, but it must be distinguishable from
		// a reported completion.
		respond([text("A summary with no done chunk.")]);

		const result = await generateSummary({
			providerConfig,
			systemPrompt: "sys",
			request: "req",
		});

		expect(result.completed).toBeUndefined();
		expect(result.failed).toBe(false);
		expect(result.incompleteReason).toBeUndefined();
		expect(result.text).toBe("A summary with no done chunk.");
	});

	it("propagates an unexpected tool-call termination", async () => {
		respond([
			{
				type: "tool_calls",
				id: "summary",
				tool_call: { function: { name: "run_commands" } },
			} as unknown as ApiStreamChunk,
			done,
		]);

		const result = await generateSummary({
			providerConfig,
			systemPrompt: "sys",
			request: "req",
		});

		expect(result.usedTools).toBe(true);
	});

	it("propagates a transport failure as a thrown error", async () => {
		respond([{ ...done, success: false, error: "Provider failed" }]);

		await expect(
			generateSummary({
				providerConfig,
				systemPrompt: "sys",
				request: "req",
			}),
		).rejects.toThrow("Provider failed");
	});
});
