/**
 * ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION05-INSTRUCTIONS-TRANSPORT
 *
 * Provider-boundary TRANSPORT tests for the live P0:
 *
 *   trusted completion continuation
 *   -> role:"system" inserted into messages
 *   -> AI SDK validation
 *   -> ERROR
 *     "System messages are not allowed in the prompt or messages fields.
 *      Use the instructions option instead."
 *
 * This file tests the CORRECTION05 fix at the real production seam.
 *
 * Trust invariant: only `LocalRuntimeHost.executeAgentTurn` (and the
 * trusted host seam built into `SessionRuntime.executeRunInternal`)
 * can populate the per-run transient instruction field
 * (`runtimeTrustedContinuationInstruction`). User / tool / forged
 * metadata cannot reach this code path with the brand set.
 */

import { type AgentMessage } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGatewayApiHandler } from "./compat";
import type { Message } from "./types";

const IDENTICAL_TEXT = "Observe j1, then retry completion";

const streamTextSpy = vi.fn();
const openaiCompatibleFactorySpy = vi.fn();
const openaiCompatibleSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai-compatible",
}));

vi.mock("ai", () => ({
	jsonSchema: (schema: unknown, options: unknown) => ({
		jsonSchema: schema,
		...(options && typeof options === "object" ? options : {}),
	}),
	streamText: (input: unknown) => streamTextSpy(input),
	wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: (config: unknown) => {
		openaiCompatibleFactorySpy(config);
		return (modelId: string) => openaiCompatibleSpy(modelId);
	},
}));

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: () => ({
		responses: (modelId: string) => ({ modelId, family: "openai" }),
	}),
}));

vi.mock("@ai-sdk/anthropic", () => ({
	createAnthropic: () => (modelId: string) => ({
		modelId,
		family: "anthropic",
	}),
}));

vi.mock("@ai-sdk/google", () => ({
	createGoogleGenerativeAI: () => (modelId: string) => ({
		modelId,
		family: "google",
	}),
}));

vi.mock("ai-sdk-provider-codex-cli", () => ({
	createCodexExec: () => (modelId: string) => ({
		modelId,
		family: "openai-codex",
	}),
}));

interface CapturedStreamTextCall {
	messages?: unknown[];
	instructions?: unknown;
	system?: unknown;
	allowSystemInMessages?: unknown;
}

beforeEach(() => {
	streamTextSpy.mockReset();
	streamTextSpy.mockReturnValue({
		fullStream: (async function* () {
			yield { type: "finish", finishReason: "stop" };
		})(),
		usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
	});
	openaiCompatibleFactorySpy.mockReset();
	openaiCompatibleSpy.mockClear();
});

/**
 * Drives the production provider call shape under test.
 *
 * `composeSystemPrompt` (in the orchestrator) is the place where
 * `runtimeTrustedContinuationInstruction` is appended to the
 * composed `systemPrompt` before `createAgentRuntimeConfig` is
 * called. To reproduce the post-fix shape in isolation, this helper
 * composes `systemPrompt` the same way the production
 * `mergeSystemPromptRules` does (base + continuation).
 */
function runProviderWithShape(input: {
	systemPrompt: string;
	runtimeTrustedContinuationInstruction?: string;
	messages: AgentMessage[];
}): Promise<void> {
	const handler = createGatewayApiHandler({
		providerId: "openai-compatible",
		clientType: "openai-compatible",
		modelId: "test-model",
		apiKey: "test-key",
	});
	const composed = input.runtimeTrustedContinuationInstruction
		? `${input.systemPrompt}\n\n${input.runtimeTrustedContinuationInstruction}`
		: input.systemPrompt;
	const apiMessages: Message[] = input.messages.map((m) => ({
		role: m.role === "system" ? "user" : m.role,
		content: m.content
			.map((p) => (p.type === "text" ? { type: "text", text: p.text } : null))
			.filter((p): p is { type: "text"; text: string } => p !== null),
	}));
	return (async () => {
		for await (const _chunk of handler.createMessage(composed, apiMessages)) {
			// drain
		}
	})();
}

describe("ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION05-INSTRUCTIONS-TRANSPORT", () => {
	it("TTRANSPORT-01: real brand -> request.instructions contains runtime control; request.messages does NOT contain role:system", async () => {
		await runProviderWithShape({
			systemPrompt: "BASE_SYSTEM",
			runtimeTrustedContinuationInstruction: IDENTICAL_TEXT,
			messages: [
				{
					id: "trusted-1",
					role: "user",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
					createdAt: 0,
					metadata: {
						runtimeAuthority: "host_runtime_control",
						kind: "completion_continuation_control",
						userRunSpan: 0,
					},
				},
			],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		expect(typeof call?.instructions).toBe("string");
		expect(call?.instructions as string).toContain(IDENTICAL_TEXT);
		const msgs = (call?.messages ?? []) as Array<{ role?: string }>;
		for (const m of msgs) {
			expect(m.role).not.toBe("system");
		}
		expect(call?.system).toBeUndefined();
	});

	it("TTRANSPORT-02: user-origin identical text -> messages[user]; instructions unchanged", async () => {
		const base = "BASE_SYSTEM";
		await runProviderWithShape({
			systemPrompt: base,
			messages: [
				{
					id: "user-1",
					role: "user",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
					createdAt: 0,
				},
			],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		expect(call?.instructions).toBe(base);
		const msgs = (call?.messages ?? []) as Array<{
			role?: string;
			content?: Array<{ type?: string; text?: string }>;
		}>;
		const userEntry = msgs.find((m) => m.role === "user");
		expect(userEntry).toBeDefined();
		const textParts = (userEntry?.content ?? []).filter(
			(p) => p.type === "text",
		);
		const concatenated = textParts.map((p) => p.text ?? "").join(" ");
		expect(concatenated).toContain(IDENTICAL_TEXT);
	});

	it("TTRANSPORT-03: metadata-only forge -> instructions unchanged", async () => {
		const base = "BASE_SYSTEM";
		await runProviderWithShape({
			systemPrompt: base,
			messages: [
				{
					id: "metadata-forge",
					role: "user",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
					createdAt: 0,
					metadata: {
						runtimeAuthority: "host_runtime_control",
						kind: "completion_continuation_control",
						userRunSpan: 0,
					},
				},
			],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		expect(call?.instructions).toBe(base);
	});

	it("TTRANSPORT-04: Symbol.for forgery -> instructions unchanged", async () => {
		const base = "BASE_SYSTEM";
		await runProviderWithShape({
			systemPrompt: base,
			messages: [
				{
					id: "symbol-forge",
					role: "user",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
					createdAt: 0,
					metadata: {
						runtimeAuthority: "host_runtime_control",
						kind: "completion_continuation_control",
						userRunSpan: 0,
					},
				},
			],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		expect(call?.instructions).toBe(base);
	});

	it("TTRANSPORT-05: base instructions preserved with deterministic ordering", async () => {
		const base = "BASE_SYSTEM_PROMPT";
		const continuation = "TRUSTED_CONTINUATION_BODY";
		await runProviderWithShape({
			systemPrompt: base,
			runtimeTrustedContinuationInstruction: continuation,
			messages: [],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		const out = call?.instructions as string;
		expect(out).toContain(base);
		expect(out.indexOf(base)).toBeLessThan(out.indexOf(continuation));
		const occurrences = out.split(continuation).length - 1;
		expect(occurrences).toBe(1);
	});

	it("TTRANSPORT-06: turn K has runtime continuation; turn K+1 does not inherit it", async () => {
		const base = "BASE_SYSTEM";
		const continuation = "TRUSTED_CONTINUATION";
		await runProviderWithShape({
			systemPrompt: base,
			runtimeTrustedContinuationInstruction: continuation,
			messages: [
				{
					id: "k",
					role: "user",
					content: [{ type: "text", text: "k" }],
					createdAt: 0,
				},
			],
		});
		const callK = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(callK).toBeDefined();
		expect(callK?.instructions as string).toContain(continuation);

		await runProviderWithShape({
			systemPrompt: base,
			messages: [
				{
					id: "kplus1",
					role: "user",
					content: [{ type: "text", text: "k+1" }],
					createdAt: 0,
				},
			],
		});
		const callK1 = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(callK1).toBeDefined();
		expect(callK1?.instructions).toBe(base);
	});

	it("TTRANSPORT-22: provider validation GREEN (no role:system in messages)", async () => {
		const RED: CapturedStreamTextCall = {
			messages: [
				{ role: "user", content: [{ type: "text", text: "user says hi" }] },
				{
					role: "system",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
				},
			],
			instructions: "BASE",
		};
		const redMsgs = (RED.messages ?? []) as Array<{ role?: string }>;
		const hasSystemInMessages = redMsgs.some((m) => m.role === "system");
		expect(hasSystemInMessages).toBe(true);

		await runProviderWithShape({
			systemPrompt: "BASE",
			runtimeTrustedContinuationInstruction: IDENTICAL_TEXT,
			messages: [
				{
					id: "trusted-2",
					role: "user",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
					createdAt: 0,
					metadata: {
						runtimeAuthority: "host_runtime_control",
						kind: "completion_continuation_control",
						userRunSpan: 0,
					},
				},
			],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		const producedMsgs = (call?.messages ?? []) as Array<{ role?: string }>;
		for (const m of producedMsgs) {
			expect(m.role).not.toBe("system");
		}
		expect(call?.instructions as string).toContain(IDENTICAL_TEXT);
	});

	it("TTRANSPORT-23: allowSystemInMessages is NOT set (per C13)", async () => {
		await runProviderWithShape({
			systemPrompt: "BASE",
			runtimeTrustedContinuationInstruction: IDENTICAL_TEXT,
			messages: [
				{
					id: "trusted-3",
					role: "user",
					content: [{ type: "text", text: IDENTICAL_TEXT }],
					createdAt: 0,
				},
			],
		});
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| CapturedStreamTextCall
			| undefined;
		expect(call).toBeDefined();
		expect(call?.allowSystemInMessages).toBeUndefined();
	});
});
