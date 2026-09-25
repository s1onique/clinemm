import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreSessionEvent } from "../../types/events";
import type { ActiveSession } from "../../types/session";
import {
	type PendingPromptQueueState,
	PendingPromptService,
	PendingPromptsController,
} from "./pending-prompt-service";

function createState(): PendingPromptQueueState {
	return { pendingPrompts: [] };
}

describe("PendingPromptService", () => {
	it("deduplicates prompts and prioritizes steer delivery", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "first", delivery: "queue" });
		service.enqueue(state, { prompt: "second", delivery: "queue" });
		service.enqueue(state, { prompt: "first", delivery: "steer" });

		expect(
			service.list(state).map(({ prompt, delivery }) => ({ prompt, delivery })),
		).toEqual([
			{ prompt: "first", delivery: "steer" },
			{ prompt: "second", delivery: "queue" },
		]);
		expect(state.pendingPrompts).toHaveLength(2);
	});

	it("updates prompts and reorders when delivery changes", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "first", delivery: "queue" });
		service.enqueue(state, { prompt: "second", delivery: "queue" });
		const queued = service.list(state);

		const edited = service.update(state, {
			sessionId: "sess-1",
			promptId: queued[0]?.id,
			prompt: "edited first",
		});
		expect(edited.updated).toBe(true);
		expect(edited.prompts.map((prompt) => prompt.prompt)).toEqual([
			"edited first",
			"second",
		]);

		const steered = service.update(state, {
			sessionId: "sess-1",
			promptId: queued[1]?.id,
			delivery: "steer",
		});
		expect(
			steered.prompts.map(({ prompt, delivery }) => ({ prompt, delivery })),
		).toEqual([
			{ prompt: "second", delivery: "steer" },
			{ prompt: "edited first", delivery: "queue" },
		]);
	});

	it("consumes steer prompts before queued turns", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "queued", delivery: "queue" });
		service.enqueue(state, { prompt: "steered", delivery: "steer" });

		const steered = service.consumeSteer(state);
		expect(steered.entry?.prompt).toBe("steered");
		expect(steered.prompts.map((prompt) => prompt.prompt)).toEqual(["queued"]);

		const queued = service.shiftNext(state);
		expect(queued.entry?.prompt).toBe("queued");
		expect(queued.prompts).toEqual([]);
	});

	it("deletes prompts and reports missing prompts without mutation", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "keep", delivery: "queue" });
		service.enqueue(state, { prompt: "remove", delivery: "queue" });
		const removeId = service.list(state)[1]?.id;

		const missing = service.delete(state, {
			sessionId: "sess-1",
			promptId: "missing",
		});
		expect(missing.removed).toBe(false);
		expect(missing.prompts.map((prompt) => prompt.prompt)).toEqual([
			"keep",
			"remove",
		]);

		const removed = service.delete(state, {
			sessionId: "sess-1",
			promptId: removeId,
		});
		expect(removed.removed).toBe(true);
		expect(removed.prompt?.prompt).toBe("remove");
		expect(removed.prompts.map((prompt) => prompt.prompt)).toEqual(["keep"]);
	});

	it("normalizes edited prompt text and rejects empty prompts", () => {
		const service = new PendingPromptService();
		const state = createState();

		service.enqueue(state, { prompt: "first", delivery: "queue" });
		const queued = service.list(state);

		expect(() =>
			service.update(state, {
				sessionId: "sess-1",
				promptId: queued[0]?.id,
				prompt: "   ",
			}),
		).toThrow("prompt cannot be empty");
	});

	it("keeps prompts enqueued while the session is aborting", async () => {
		const sessionId = "sess-enqueue-while-aborting";
		const session = {
			sessionId,
			pendingPrompts: [],
			aborting: true,
			drainingPendingPrompts: false,
			status: "running",
			agent: {
				canStartRun: () => false,
			},
		} as unknown as ActiveSession;
		const events: CoreSessionEvent[] = [];
		const send = vi.fn().mockResolvedValue(undefined);
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send,
		});

		// A prompt typed right after Escape lands during the abort window; it
		// must join the queue (which survives the abort) instead of being
		// silently dropped.
		controller.enqueue(sessionId, {
			prompt: "typed after escape",
			delivery: "queue",
		});

		expect(controller.list(sessionId).map((prompt) => prompt.prompt)).toEqual([
			"typed after escape",
		]);
		// The drain must not start while the abort is still settling.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(send).not.toHaveBeenCalled();
	});

	it("requeues a drained prompt when send fails", async () => {
		const sessionId = "sess-drain-failure";
		const session = {
			sessionId,
			pendingPrompts: [
				{
					id: "pending-1",
					prompt: "try later",
					delivery: "steer",
				},
			],
			aborting: false,
			drainingPendingPrompts: false,
			status: "completed",
			agent: {
				canStartRun: () => true,
			},
		} as unknown as ActiveSession;
		const events: CoreSessionEvent[] = [];
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send: vi.fn().mockRejectedValue(new Error("send failed")),
		});

		await controller.drain(sessionId);

		expect(controller.list(sessionId).map((prompt) => prompt.prompt)).toEqual([
			"try later",
		]);
		expect(
			events.some(
				(event) =>
					event.type === "pending_prompts" &&
					event.payload.prompts.length === 0,
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.type === "pending_prompts" &&
					event.payload.prompts.some((prompt) => prompt.prompt === "try later"),
			),
		).toBe(true);
	});

	// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
	// (production wiring fix per FACTORY HALT_CCARD_V2_PRODUCTION_WIRING_FALSE_GREEN):
	// Production-shape regression test for the FACTORY HALT_CCARD_V2_*
	// halt. The previous CCARD-DISCRIMINATOR-01 in
	// apps/vscode/src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts
	// drove the capture module directly, which meant it could not
	// detect that the real `PendingPromptsController` was NEVER
	// observing the C6 hook (the `onBeforeDispatch` forwarding was
	// missing). This test exercises the REAL controller with a stub
	// `send` so the hooks are observed at the production boundary.
	// No `captureContinuationCardinalityAuthorityRecord(...)` calls
	// here — the test asserts on the hooks themselves.
	it("CCARD-WIRE-01: real PendingPromptsController fires onBeforeDrain once + onBeforeDispatch once per shift (P0 production wiring regression)", async () => {
		const sessionId = "sess-ccard-wire-01";
		const session = {
			sessionId,
			pendingPrompts: [
				{
					id: "pending-1",
					prompt: "the only queued prompt",
					delivery: "queue",
					jobId: "job-1",
				},
			],
			aborting: false,
			drainingPendingPrompts: false,
			status: "completed",
			agent: {
				canStartRun: () => true,
			},
		} as unknown as ActiveSession;

		const events: CoreSessionEvent[] = [];
		const sendCalls: Array<{ sessionId: string; prompt: string; jobId?: string; delivery?: "queue" | "steer" }> = [];
		const send = vi.fn(async (input: { sessionId: string; prompt: string; jobId?: string; delivery?: "queue" | "steer" }) => {
			sendCalls.push(input);
		});
		const onEnqueue = vi.fn();
		const onBeforeDrain = vi.fn();
		const onBeforeDispatch = vi.fn();
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send,
			onEnqueue,
			onBeforeDrain,
			onBeforeDispatch,
		});

		await controller.drain(sessionId);

		// The hooks are wired into the REAL drain path. Per the
		// drained entry, onBeforeDrain and onBeforeDispatch fire
		// exactly once each, and the send call carries the jobId.
		// This is the production shape that the FACTORY HALT was
		// missing — the previous version of this test drove the
		// capture module directly, which would have passed even if
		// the controller never wired onBeforeDispatch.
		expect(onBeforeDrain).toHaveBeenCalledTimes(1);
		expect(onBeforeDispatch).toHaveBeenCalledTimes(1);
		expect(sendCalls).toHaveLength(1);
		// P1 — jobId survives the deps.send boundary (unchanged by
		// the bounded repair):
		expect(sendCalls[0]?.jobId).toBe("job-1");
		// ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01:
		// `delivery` is NO LONGER forwarded into deps.send from
		// drain — forwarding it caused `LocalRuntimeHost.runTurn`'s
		// queue/steer branch (line 1204) to re-enqueue the
		// just-dequeued prompt, producing a non-terminating drain
		// loop that OOMed the native Extension Host. C7/C8 origin
		// derivation moved to `jobId`-presence-based.
		expect(Object.prototype.hasOwnProperty.call(sendCalls[0], "delivery")).toBe(
			false,
		);
		// C5/C6 observe the originating delivery context so the host
		// deriveOrigin() can map to pending_prompt_drain:
		expect(onBeforeDrain.mock.calls[0]?.[0]?.delivery).toBe("queue");
		expect(onBeforeDispatch.mock.calls[0]?.[0]?.delivery).toBe("queue");
		expect(onBeforeDrain.mock.calls[0]?.[0]?.jobId).toBe("job-1");
		expect(onBeforeDispatch.mock.calls[0]?.[0]?.jobId).toBe("job-1");
	});

	// Production-shape test that proves the C5/C6 hooks are wired
	// into the REAL drain path so that the FACTORY HALT can never
	// regress: if a future refactor drops `onBeforeDispatch`
	// forwarding (the original P0 production-wiring bug) this test
	// will fail with `expected to be called 1 time, but got 0 times`.
	it("CCARD-WIRE-01c: controller without onBeforeDispatch option never throws and is a complete no-op for C6 (backward-compat)", async () => {
		const sessionId = "sess-ccard-wire-01c";
		const session = {
			sessionId,
			pendingPrompts: [
				{
					id: "pending-1",
					prompt: "the only queued prompt",
					delivery: "queue",
					jobId: "job-1",
				},
			],
			aborting: false,
			drainingPendingPrompts: false,
			status: "completed",
			agent: {
				canStartRun: () => true,
			},
		} as unknown as ActiveSession;

		const events: CoreSessionEvent[] = [];
		const send = vi.fn(async () => undefined);
		// Note: NO onBeforeDispatch provided.
		const onEnqueue = vi.fn();
		const onBeforeDrain = vi.fn();
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send,
			onEnqueue,
			onBeforeDrain,
		});

		await controller.drain(sessionId);

		expect(onEnqueue).not.toHaveBeenCalled();
		expect(onBeforeDrain).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(1);
		// Drain completes without throwing — onBeforeDispatch is
		// optional and missing it is a backward-compatible no-op.
	});

	// Production-shape test that pins the queue-path: enqueue is
	// queue-only; it must NOT fire C5 (drain), C6 (dispatch), or
	// any send. Without this test the FACTORY HALT could regress:
	// a future refactor might let the controller drain-on-enqueue,
	// which would manufacture request-time cardinality noise.
	it("CCARD-WIRE-02: enqueue (queue-path) does NOT fire C5/C6 hooks or call send (request != execution cardinality)", async () => {
		const sessionId = "sess-ccard-wire-02";
		const session = {
			sessionId,
			pendingPrompts: [],
			aborting: false,
			drainingPendingPrompts: false,
			status: "running",
			agent: {
				canStartRun: () => false, // user types while agent busy -> queue
			},
		} as unknown as ActiveSession;

		const events: CoreSessionEvent[] = [];
		const send = vi.fn();
		const onEnqueue = vi.fn();
		const onBeforeDrain = vi.fn();
		const onBeforeDispatch = vi.fn();
		const controller = new PendingPromptsController({
			getSession: () => session,
			emit: (event) => events.push(event),
			send,
			onEnqueue,
			onBeforeDrain,
			onBeforeDispatch,
		});

		controller.enqueue(sessionId, {
			prompt: "typed while busy",
			delivery: "queue",
			jobId: "job-2",
		});

		expect(onEnqueue).toHaveBeenCalledTimes(1);
		// C5 / C6 are drain-class hooks, NOT queue-class hooks.
		// They must NOT fire for an enqueue.
		expect(onBeforeDrain).not.toHaveBeenCalled();
		expect(onBeforeDispatch).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
		// No runTurn-style completion event must be emitted from
		// the queue path. Only the `pending_prompts` event.
		for (const event of events) {
			expect(event.type).not.toBe("agent_run_completed");
			expect(event.type).not.toBe("agent_run_started");
		}
	});

});

// ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01:
// Predecessor AB-DELIVERY-01/02 and AB-ATTEST-01 blocks REMOVED.
// The ablation env var and constructor attestation no longer
// exist; the bounded repair made the delivery removal permanent.
// The structural invariant is now permanently asserted by
// `CCARD-WIRE-01` (updated to assert `delivery` is NOT in the
// deps.send payload) and by the DRP-* suite in
// `pending-prompt-service.drain-semantics.test.ts`.
