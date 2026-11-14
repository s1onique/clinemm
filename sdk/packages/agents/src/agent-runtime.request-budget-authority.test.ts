/**
 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01
 *
 * Permanent hermetic regression suite for the FINAL-REQUEST budget
 * authority in the agent runtime.
 *
 * WHY THIS EXISTS
 * ---------------
 * The core compaction pipeline publishes the effective request-input
 * ceiling on the prepare-turn result. The runtime captures it verbatim and
 * enforces it against the FINAL provider request — the one that exists
 * AFTER every `beforeModel` hook has run.
 *
 * A `beforeModel` hook may REPLACE the request messages or the tool
 * inventory. The request the host measured during `prepareTurn` is
 * therefore not necessarily the request that is dispatched. Without this
 * enforcement, a hook could grow the request past the ceiling and the
 * request would be dispatched anyway.
 *
 * THE CONTRACT
 * ------------
 * 1. The ceiling is enforced against the final request, after the hooks.
 * 2. The check FAILS CLOSED: an over-budget final request throws
 *    `TaskContractBudgetError` BEFORE any provider dispatch.
 * 3. The check never expands a limit: the runtime uses exactly the ceiling
 *    the host published.
 * 4. When the host publishes no ceiling, the runtime-side check is
 *    disabled (the pre-repair behavior).
 * 5. The estimator is the existing conservative one; provider-reported
 *    usage is never invented.
 */

import { TaskContractBudgetError } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./agent-runtime";
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "./index";

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

describe("agent runtime — final-request budget authority", () => {
	it("rejects a final request that a beforeModel hook grew past the ceiling, with zero provider dispatch", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "should not happen" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			// The host publishes the effective ceiling on the prepare-turn
			// result. The runtime captures it verbatim.
			prepareTurn: async () => ({ maxRequestTokens: 1_000 }),
			hooks: {
				// The hook REPLACES the messages with a request that is far
				// over the published ceiling.
				beforeModel: async () => ({
					messages: [
						{
							id: "m1",
							role: "user",
							content: [{ type: "text", text: "x".repeat(50_000) }],
							createdAt: 1,
						},
					],
				}),
			},
		});

		const result = await runtime.run("hello");

		// The runtime reports a terminal failure rather than rejecting: the
		// budget error is surfaced on the run result so the orchestrator can
		// record it as a terminal, non-retryable error.
		expect(result.status).toBe("failed");
		expect(result.error).toBeInstanceOf(TaskContractBudgetError);
		// Zero provider dispatch: the request never leaves the process.
		expect(model.requests).toHaveLength(0);
	});

	it("accepts a final request that stays within the published ceiling", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			prepareTurn: async () => ({ maxRequestTokens: 100_000 }),
		});

		const result = await runtime.run("hello");

		expect(result.status).toBe("completed");
		expect(model.requests).toHaveLength(1);
	});

	it("does not enforce a ceiling when the host publishes none", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			prepareTurn: async () => ({}),
			hooks: {
				beforeModel: async () => ({
					messages: [
						{
							id: "m1",
							role: "user",
							content: [{ type: "text", text: "x".repeat(500_000) }],
							createdAt: 1,
						},
					],
				}),
			},
		});

		const result = await runtime.run("hello");

		expect(result.status).toBe("completed");
		expect(model.requests).toHaveLength(1);
	});
});
