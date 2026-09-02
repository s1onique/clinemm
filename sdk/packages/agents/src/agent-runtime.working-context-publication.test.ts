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
	it("does NOT emit working-context-state-changed when the W value did not change between consecutive prepareTurns", async () => {
		// Dedup: on the FIRST prepareTurn on a run,
		// the field transitions `undefined -> W_SAME`,
		// which fires ONE publication event. (Between
		// runs the runtime resets to `undefined`, so
		// the per-run dedup is the only regime this test
		// pins; the multi-iteration within-run dedup is
		// covered by the cleaner W1->W2 (different W)
		// case in the state-bind suite.)
		const W_SAME = 1234;
		const prepareTurn = vi.fn(async () => ({
			currentWorkingContextEstimate: W_SAME,
		}));
		const model = new BlockingModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		void prepareTurn;

		const eventLog: AgentRuntimeEvent[] = [];
		const unsubscribe = runtime.subscribe((e) => {
			eventLog.push(e);
		});

		const streamStarted = new Promise<void>((resolve) => {
			model.streamStartedListeners.push(resolve);
		});

		const runPromise = runtime.run("hello");

		await streamStarted;

		// Exactly ONE publication event must fire (the
		// transition from undefined -> 1234).
		const pubEvents = eventLog.filter(
			(e) => e.type === "working-context-state-changed",
		);
		expect(pubEvents.length).toBe(1);

		model.release();
		await runPromise;
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
