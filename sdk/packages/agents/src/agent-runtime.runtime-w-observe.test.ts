/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirtieth-pass): RUNTIME_W_TRACE_OBSERVER.
 *
 * Pins the upstream W discriminator seam added at
 * `installRuntimeWTraceObserver(...)`. The observer
 * fires once per `prepareTurnForModelRequest` invocation,
 * AFTER the runtime-state capture and AFTER the emit
 * decision, with a frozen discriminator payload that
 * distinguishes:
 *
 *   A1 producer published W?        <- `prepareTurnW`
 *   A2 runtime captured W?         <- `runtimeW`
 *   A3 emit-decision helper chose
 *      to attempt a publish?       <- `willEmit`
 *   A4 emit() resolved without
 *      an error?                   <- `emitResolved`
 *
 * Six scenarios from the operator's twenty-ninth-pass causal
 * review + diagnostic-off safety:
 *
 *   T1: prepareTurn W=100, previous undefined
 *       -> runtimeW=100, willEmit=true, emitResolved=true
 *
 *   T2: prepareTurn W=100, previous 100 (dedup control)
 *       -> runtimeW=100, willEmit=false, emitResolved=false
 *
 *   T3: prepareTurn W=undefined, previous 100 (fail-closed)
 *       -> runtimeW=undefined, willEmit=true, emitResolved=true
 *
 *   T4: no prepareTurn config -> observer fires zero times
 *
 *   T5: throwing observer must NOT unwind prepareTurn
 *
 *   T6: default (no observer set) -> runtime still emits
 *
 * No production semantic delta beyond the observation hook.
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimePrepareTurnResult,
	AgentTool,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentRuntimeWTraceObserver,
	AgentRuntimeWTraceRecord,
} from "./agent-runtime";
import { AgentRuntime } from "./index"
import { installRuntimeWTraceObserver } from "./runtime-w-trace-internal"

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (thirty-fifth-pass) — the runtime-trace observer is held
	// in a Symbol.for-keyed process-global slot, so it
	// survives between tests. Reset it to `undefined` before
	// each test so the "no observer set" precondition in T6
	// is genuine (otherwise T5's throwing observer would still
	// be present and silently swallowed by `notify`).
	installRuntimeWTraceObserver(undefined);
});

afterEach(() => {
	// Hygiene: don't leave the slot populated after the
	// suite ends (matters in vitest watch mode).
	installRuntimeWTraceObserver(undefined);
});

class FinishingOnlyModel implements AgentModel {
	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		async function* gen(): AsyncIterable<AgentModelEvent> {
			yield { type: "text-delta", text: "ok" };
			yield { type: "finish", reason: "stop" };
		}
		return gen();
	}
}

class TwoIterationModel implements AgentModel {
	public stepCount = 0;
	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.stepCount += 1;
		const stepIndex = this.stepCount;
		async function* gen(): AsyncIterable<AgentModelEvent> {
			if (stepIndex === 1) {
				yield {
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"hi"}',
				};
				yield { type: "finish", reason: "tool-calls" };
			} else {
				yield { type: "text-delta", text: "ok" };
				yield { type: "finish", reason: "stop" };
			}
		}
		return gen();
	}
}

const echoTool: AgentTool = {
	name: "echo",
	description: "Echo input text",
	inputSchema: { type: "object" },
	async execute(input: { text: string }) {
		return { echoed: input.text };
	},
};

describe("AgentRuntime RUNTIME_W_TRACE_OBSERVER - installRuntimeWTraceObserver", () => {
	it("T1: prepareTurn W=100, previous undefined -> runtimeW=100, willEmit=true, emitResolved=true (first-bind)", async () => {
		const W_FIXTURE = 100;
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => ({
				currentWorkingContextEstimate: W_FIXTURE,
			}),
		);

		const captured: AgentRuntimeWTraceRecord[] = [];
		const observer: AgentRuntimeWTraceObserver = (record) => {
			captured.push(record);
		};

		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			sessionId: "session-t1",
		});
		installRuntimeWTraceObserver(observer);

		const result = await runtime.run("hello");
		expect(result.status).toBe("completed");

		expect(captured).toHaveLength(1);
		const row = captured[0];
		if (!row) throw new Error("expected one captured row");
		expect(row.sessionId).toBe("session-t1");
		// AgentRuntime increments `state.iteration` at the
		// top of each turn BEFORE `prepareTurnForModelRequest`
		// runs (`agent-runtime.ts:1612`), so the first prepareTurn
		// observes iteration=1.
		expect(row.iteration).toBe(1);
		expect(row.resultKind).toBe("prepare_turn");
		expect(row.prepareTurnW).toBe(W_FIXTURE);
		expect(row.runtimeW).toBe(W_FIXTURE);
		expect(row.previousRuntimeW).toBeUndefined();
		expect(row.willEmit).toBe(true);
		expect(row.emitResolved).toBe(true);
	});

	it("T2: prepareTurn W=100, previous 100 -> runtimeW=100, willEmit=false (dedup control)", async () => {
		const prepareTurnCalls: Array<AgentRuntimePrepareTurnResult> = [
			{ currentWorkingContextEstimate: 100 },
			{ currentWorkingContextEstimate: 100 },
		];
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const next = prepareTurnCalls.shift() ?? {
					currentWorkingContextEstimate: 100,
				};
				return next;
			},
		);

		const captured: AgentRuntimeWTraceRecord[] = [];
		const model = new TwoIterationModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			tools: [echoTool],
			sessionId: "session-t2",
		});
		installRuntimeWTraceObserver((record) => captured.push(record));

		const result = await runtime.run("start");
		expect(result.status).toBe("completed");
		expect(model.stepCount).toBe(2);
		expect(prepareTurn).toHaveBeenCalledTimes(2);

		expect(captured).toHaveLength(2);

		const first = captured[0];
		const second = captured[1];
		if (!first || !second) {
			throw new Error("expected two captured rows");
		}

		expect(first.resultKind).toBe("prepare_turn");
		expect(first.prepareTurnW).toBe(100);
		expect(first.runtimeW).toBe(100);
		expect(first.previousRuntimeW).toBeUndefined();
		expect(first.willEmit).toBe(true);
		expect(first.emitResolved).toBe(true);
		expect(first.iteration).toBe(1);

		expect(second.resultKind).toBe("prepare_turn");
		expect(second.prepareTurnW).toBe(100);
		expect(second.runtimeW).toBe(100);
		expect(second.previousRuntimeW).toBe(100);
		expect(second.willEmit).toBe(false);
		expect(second.emitResolved).toBe(false);
		expect(second.iteration).toBe(2);
	});

	it("T3: prepareTurn W=undefined, previous 100 -> runtimeW=undefined, willEmit=true, emitResolved=true (fail-closed control)", async () => {
		const prepareTurnCalls: Array<AgentRuntimePrepareTurnResult> = [
			{ currentWorkingContextEstimate: 100 },
			{ messages: [] },
		];
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const next = prepareTurnCalls.shift() ?? {
					currentWorkingContextEstimate: 100,
				};
				return next;
			},
		);

		const captured: AgentRuntimeWTraceRecord[] = [];
		const model = new TwoIterationModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			tools: [echoTool],
			sessionId: "session-t3",
		});
		installRuntimeWTraceObserver((record) => captured.push(record));

		const result = await runtime.run("start");
		expect(result.status).toBe("completed");

		expect(captured).toHaveLength(2);
		const first = captured[0];
		const second = captured[1];
		if (!first || !second) {
			throw new Error("expected two captured rows");
		}

		expect(first.prepareTurnW).toBe(100);
		expect(first.runtimeW).toBe(100);
		expect(first.willEmit).toBe(true);
		expect(first.emitResolved).toBe(true);

		expect(second.resultKind).toBe("prepare_turn");
		expect(second.prepareTurnW).toBeUndefined();
		expect(second.runtimeW).toBeUndefined();
		expect(second.previousRuntimeW).toBe(100);
		expect(second.willEmit).toBe(true);
		expect(second.emitResolved).toBe(true);
	});

	it("T4: runtime with NO prepareTurn config -> observer fires ZERO times", async () => {
		const captured: AgentRuntimeWTraceRecord[] = [];
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			sessionId: "session-t4",
		});
		installRuntimeWTraceObserver((record) => captured.push(record));

		const result = await runtime.run("hello");
		expect(result.status).toBe("completed");
		expect(captured).toEqual([]);
	});

	it("T5: throwing observer does NOT unwind prepareTurn", async () => {
		const W_FIXTURE = 100;
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => ({
				currentWorkingContextEstimate: W_FIXTURE,
			}),
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			sessionId: "session-t5",
		});
		installRuntimeWTraceObserver(() => {
			throw new Error("boom");
		});

		const result = await runtime.run("hello");
		expect(result.status).toBe("completed");

		expect(runtime.snapshot().currentWorkingContextEstimate).toBe(W_FIXTURE);
	});

	it("T6: default (no observer set) -> runtime still captures and emits", async () => {
		const W_FIXTURE = 100;
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => ({
				currentWorkingContextEstimate: W_FIXTURE,
			}),
		);
		const events: Array<{
			type: string;
			w?: number | undefined;
		}> = [];
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			sessionId: "session-t6",
		});
		runtime.subscribe((event) => {
			if (event.type === "working-context-state-changed") {
				events.push({
					type: event.type,
					w: event.snapshot.currentWorkingContextEstimate,
				});
			}
		});

		const result = await runtime.run("hello");
		expect(result.status).toBe("completed");
		expect(events).toHaveLength(1);
		expect(events[0]?.w).toBe(W_FIXTURE);
	});
});
