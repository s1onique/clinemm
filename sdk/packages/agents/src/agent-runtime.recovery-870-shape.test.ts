/**
 * C1.6 AgentRuntime — 870-shape adversarial reproducer.
 *
 * Mirrors the upstream failure class
 * (github.com/cline/cline/issues/11542):
 *
 *   tool completion
 *   → model asks again
 *   → tool completion
 *   → model asks again
 *   → ...
 *
 * …until external kill. The C1.6 claim is that the runtime
 * STOPS at a finite exact count long before any external
 * timeout is needed.
 *
 * The fixture scripts 1000 model responses; the runtime must
 * stop at a finite exact N << 1000. Wall-clock is allowed as
 * a safety net but the assertion fails if runtime does not
 * terminate by exact count long before timeout.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(private readonly steps: Array<() => AgentModelEvent[]>) {}
	async stream(): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push({});
		const step = this.steps.shift();
		if (!step) {
			return (async function* () {})();
		}
		const events = step();
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

const OPAQUE = new Error("opaque internal failure");
function opaqueTool(calls: { count: number }): AgentTool<{ value: string }, never> {
	return {
		name: "opaque_thrower",
		description: "",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			throw OPAQUE;
		},
	};
}

/** 1000 scripted model responses, all proposing a fresh
 *  canonical input. The runtime must stop at finite N. */
function build1000StepModel(): ScriptedModel {
	const steps: Array<() => AgentModelEvent[]> = [];
	for (let i = 0; i < 1000; i++) {
		steps.push(() => [
			{
				type: "tool-call-delta",
				toolCallId: `o${i}`,
				toolName: "opaque_thrower",
				inputText: JSON.stringify({ value: `unique_${i}_${"x".repeat(64)}` }),
			},
			{ type: "finish", reason: "tool-calls" },
		]);
	}
	// Final finishStep in case we ever overrun
	steps.push(() => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	]);
	return new ScriptedModel(steps);
}

describe("C1.6 / 870-shape adversarial reproducer", () => {
	it("1000 scripted responses → runtime terminates at finite exact N without external timeout", async () => {
		const calls = { count: 0 };
		const model = build1000StepModel();
		const runtime = new AgentRuntime({
			model,
			tools: [opaqueTool(calls)],
		});
		// Safety net only — runtime must terminate long
		// before this. If the runtime exceeds this, the
		// assertion below fails first.
		const timeout = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("EXTERNAL_TIMEOUT")), 30000);
		});
		const result = await Promise.race([
			runtime.run("drive 870-shape"),
			timeout,
		]);
		expect(result.status).toBe("aborted");
		expect(result.error?.message).toBe("bounded_recovery_exhausted");
		// The runtime MUST terminate at a finite count
		// dramatically less than 1000.
		const REQUESTS = model.requests.length;
		expect(REQUESTS).toBeLessThan(20);
		expect(REQUESTS).toBeGreaterThanOrEqual(2);
		expect(calls.count).toBeLessThanOrEqual(REQUESTS);
		// Termination cause is internal deterministic
		// policy, not external timeout.
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");
	});
});
