/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (fifteenth-pass): PUBLICATION_BIND.
 *
 * Pins the strongest-possible discriminator for the
 * working-context publication contract:
 *
 *   prepareTurn returns W
 *     < W publication event observed by subscribers
 *     < model.stream(...) begins (and any provider response)
 *     < run-finished
 *
 * The model's `stream()` is exercised through a
 * controllable barrier. The barrier holds the runtime
 * at the moment the FIRST event from the model would
 * fire. At that moment the test has already asserted:
 *   - the listener received
 *     `working-context-state-changed` (or any event with
 *     the new W on the snapshot, ordering-permitting)
 *   - `runtime.snapshot().currentWorkingContextEstimate
 *     === W` when read inside the listener
 *
 * The barrier then releases; the model emits
 * `finish:stop`; `run-finished` eventually fires.
 *
 * STATE_BIND = GREEN  (this test only verifies the
 *                      publication aspect).
 * PUBLICATION_BIND = GREEN (this commit).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
} from "@cline/shared";
import { AgentRuntime } from "./index";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class BlockingModel implements AgentModel {
	private resolveBlock: (() => void) | null = null;
	private readonly blocked: Promise<void>;
	public streamCallCount = 0;
	public streamStartedListeners: Array<() => void> = [];

	constructor() {
		this.blocked = new Promise<void>((resolve) => {
			this.resolveBlock = resolve;
		});
	}

	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.streamCallCount += 1;
		// Signal the test that the model stream has been
		// INVOKED — the await prepareTurnForModelRequest has
		// returned (otherwise this code path would not run).
		// The barrier is then held open until the test
		// releases it. During that window the listener MUST
		// already have been called.
		const startedListeners = this.streamStartedListeners;
		for (const fn of startedListeners) {
			fn();
		}
		await this.blocked;
		async function* gen(): AsyncIterable<AgentModelEvent> {
			// Emit a small text-delta so the run finishes as
			// `completed` rather than triggering the
			// "Model returned empty response" branch.
			yield {
				type: "text-delta",
				text: "ok",
			};
			yield { type: "finish", reason: "stop" };
		}
		return gen();
	}

	release(): void {
		if (this.resolveBlock) {
			this.resolveBlock();
			this.resolveBlock = null;
		}
	}
}
describe("AgentRuntime PUBLICATION_BIND — working-context-state-changed", () => {
	const W_FIXTURE = 4242;

	it("emits working-context-state-changed BEFORE the model stream yields (ordering: prepareTurn < W-publication < model.stream < run-finished)", async () => {
		const model = new BlockingModel();

		const prepareTurn = vi.fn(async () => ({
			currentWorkingContextEstimate: W_FIXTURE,
		}));

		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		const eventLog: Array<{
			n: number;
			event: AgentRuntimeEvent;
			wAtEvent: number | undefined;
		}> = [];
		let counter = 0;

		const unsubscribe = runtime.subscribe((event) => {
			eventLog.push({
				n: counter++,
				event,
				wAtEvent:
					runtime.snapshot().currentWorkingContextEstimate,
			});
		});

		const streamStarted = new Promise<void>((resolve) => {
			model.streamStartedListeners.push(resolve);
		});

		const runPromise = runtime.run("hello");

		await streamStarted;

		const pubEvents = eventLog.filter(
			(e) => e.event.type === "working-context-state-changed",
		);
		expect(pubEvents.length).toBeGreaterThanOrEqual(1);

		const pub = pubEvents[0];
		expect(pub).toBeDefined();
		expect(pub?.wAtEvent).toBe(W_FIXTURE);
		if (pub?.event.type === "working-context-state-changed") {
			expect(
				pub.event.snapshot.currentWorkingContextEstimate,
			).toBe(W_FIXTURE);
			expect(
				pub.event.previousWorkingContextEstimate,
			).toBeUndefined();
		}

		const runFinishedSoFar = eventLog.find(
			(e) => e.event.type === "run-finished",
		);
		expect(runFinishedSoFar).toBeUndefined();

		const modelDerivedEvents = eventLog.filter(
			(e) =>
				e.event.type === "assistant-message" ||
				e.event.type === "assistant-text-delta" ||
				e.event.type === "usage-updated" ||
				e.event.type === "run-finished",
		);
		expect(modelDerivedEvents.length).toBe(0);

		model.release();
		const result = await runPromise;
		expect(result.status).toBe("completed");

		unsubscribe();
	});
});

describe("AgentRuntime PUBLICATION_BIND — dedup + error isolation", () => {
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (sixteenth-pass): real two-iteration dedup test
	// using a tool-call-driven multi-iteration loop.
	//
	// Replaces the prior vacuous test that only
	// exercised the FIRST transition
	// (`undefined → 1234`) on a single-shot model.
	// This new test drives:
	//   prepareTurn #1: undefined → 1234  (transition)
	//   prepareTurn #2: 1234 → 1234      (no-op)
	// within ONE execute() lifecycle (no run/restore
	// reset in between).
	it("DEDUP via two prepareTurns in one execute(): undefined→1234 emits ONCE; 1234→1234 emits ZERO additional", async () => {
		const prepareTurnCalls: Array<AgentRuntimePrepareTurnResult> = [];
		prepareTurnCalls.push({ currentWorkingContextEstimate: 1234 });
		prepareTurnCalls.push({ currentWorkingContextEstimate: 1234 });

		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const next =
					prepareTurnCalls.shift() ??
					{ currentWorkingContextEstimate: 1234 };
				return next;
			},
		);

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
		const model = new TwoIterationModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			tools: [echoTool],
		});

		const eventLog: AgentRuntimeEvent[] = [];
		const unsubscribe = runtime.subscribe((event) => {
			eventLog.push(event);
		});

		const result = await runtime.run("start");
		expect(result.status).toBe("completed");
		expect(model.stepCount).toBe(2);
		expect(prepareTurn).toHaveBeenCalledTimes(2);

		const pubEvents = eventLog.filter(
			(e) => e.type === "working-context-state-changed",
		);
		expect(pubEvents.length).toBe(1);
		const pub = pubEvents[0];
		if (pub?.type === "working-context-state-changed") {
			expect(pub.snapshot.currentWorkingContextEstimate).toBe(1234);
			expect(pub.previousWorkingContextEstimate).toBeUndefined();
		}

		unsubscribe();
	});


	it("does NOT throw into the runtime if the working-context subscriber throws (observation event)", async () => {
		const W_THROW = 9999;
		const prepareTurn = vi.fn(async () => ({
			currentWorkingContextEstimate: W_THROW,
		}));
		const model = new BlockingModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		void prepareTurn;

		const unsubscribe = runtime.subscribe((event) => {
			if (event.type === "working-context-state-changed") {
				throw new Error("subscriber intentional throw");
			}
		});

		const streamStarted = new Promise<void>((resolve) => {
			model.streamStartedListeners.push(resolve);
		});

		const runPromise = runtime.run("hello");

		await streamStarted;

		expect(runtime.snapshot().currentWorkingContextEstimate).toBe(
			W_THROW,
		);

		model.release();
		const result = await runPromise;
		expect(result.status).toBe("completed");

		unsubscribe();
	});
});

	// Companion: in-run fail-closed via two prepareTurns.
	// Same fixture topology as the dedup test, but the
	// second prepareTurn omits W. This pins BOTH
	// "in-run dedup" AND "in-run fail-closed" using
	// the same tool-call-driven two-iteration scaffold.
	//
	// This test was previously vacuous (the prior
	// fail-closed test in the state-bind file used
	// two separate run() calls). The publisher-side
	// companion lives here so PUBLICATION_BIND has its
	// own witness for the in-run fail-closed path.
	it("FAIL-CLOSED (publisher side) via two prepareTurns in one execute(): working-context-state-changed does NOT carry a stale W", async () => {
		const prepareTurnCalls: Array<
			AgentRuntimePrepareTurnResult | undefined
		> = [];
		prepareTurnCalls.push({ currentWorkingContextEstimate: 100 });
		// Second prepareTurn returns a result without
		// the field (legacy / non-publisher shape).
		prepareTurnCalls.push({ messages: [] });

		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult | undefined> =>
				prepareTurnCalls.shift(),
		);

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
		const model = new TwoIterationModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			tools: [echoTool],
		});

		const eventLog: AgentRuntimeEvent[] = [];
		const unsubscribe = runtime.subscribe((event) => {
			eventLog.push(event);
		});

		const result = await runtime.run("start");
		expect(result.status).toBe("completed");
		expect(model.stepCount).toBe(2);
		expect(prepareTurn).toHaveBeenCalledTimes(2);

		const pubEvents = eventLog.filter(
			(e) => e.type === "working-context-state-changed",
		);
		// FAIL-CLOSED publisher-side invariant:
		//   prepareTurn #1 (undefined -> 100) emits 1
		//     event carrying snapshot.W === 100.
		//   prepareTurn #2 (100 -> undefined, no field)
		//     emits 1 event carrying snapshot.W ===
		//     undefined (NOT stale 100).
		//   Total: 2 events. The SECOND event is the
		//   one that proves fail-closed semantics in
		//   the publisher contract (if state.W were
		//   stale-preserved, the helper would dedup and
		//   we'd have only 1 event total).
		expect(pubEvents.length).toBe(2);

		const first = pubEvents[0];
		const second = pubEvents[1];
		if (first?.type === "working-context-state-changed") {
			expect(first.snapshot.currentWorkingContextEstimate).toBe(100);
			expect(first.previousWorkingContextEstimate).toBeUndefined();
		}
		if (second?.type === "working-context-state-changed") {
			// The critical assertion: after a no-W
			// prepareTurn, the next publication event
			// MUST carry snapshot.W === undefined. NOT
			// stale 100. This is the in-run fail-closed
			// invariant on the publisher side.
			expect(
				second.snapshot.currentWorkingContextEstimate,
			).toBeUndefined();
			expect(
				second.previousWorkingContextEstimate,
			).toBe(100);
		}

		// Final snapshot also fails closed.
		expect(
			runtime.snapshot().currentWorkingContextEstimate,
		).toBeUndefined();

		unsubscribe();
	});
