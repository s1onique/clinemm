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
		// P1 — jobId survives the deps.send boundary:
		expect(sendCalls[0]?.jobId).toBe("job-1");
		expect(sendCalls[0]?.delivery).toBe("queue");
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

	// =====================================================================
	// ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01
	// =====================================================================
	//
	// AB-DELIVERY-01 (structural): When the
	// CLINEMM_OOM_DISC01_ABLATE_DELIVERY ablation seam is engaged,
	// the REAL PendingPromptsController.drain boundary MUST NOT
	// forward `next.delivery` into the deps.send(...) payload, but
	// MUST continue to forward `next.jobId`. This is the load-bearing
	// proof that the ablation is exactly the single-field removal
	// the ACT authorizes — no other field may change. The test
	// exercises the REAL controller (not a duplicate of the
	// payload-construction helper) by stubbing send and observing
	// the captured input.
	//
	// AB-DELIVERY-02 (conservation): With the ablation seam OFF
	// (production default), the controller forwards `delivery`
	// exactly as the current production seam does. This guards
	// against an accidental baseline drift in the seam during
	// refactors; if this test ever fails post-hoc, the ACT's
	// ablation result cannot be interpreted as a clean single-field
	// removal.
	describe("AB-DELIVERY-01: ablation seam drops next.delivery but preserves next.jobId", () => {
		const ORIGINAL_ENV = process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
		afterEach(() => {
			if (ORIGINAL_ENV === undefined) {
				delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
			} else {
				process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY = ORIGINAL_ENV;
			}
		});

		it("under ablation: deps.send input has NO delivery field BUT has jobId field", async () => {
			process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY = "1";
			const sessionId = "sess-ab-delivery-01";
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
				agent: { canStartRun: () => true },
			} as unknown as ActiveSession;

			const sendCalls: Array<{
				sessionId: string;
				prompt: string;
				jobId?: string;
				delivery?: "queue" | "steer";
			}> = [];
			const send = vi.fn(async (input: {
				sessionId: string;
				prompt: string;
				jobId?: string;
				delivery?: "queue" | "steer";
			}) => {
				sendCalls.push(input);
			});
			const onEnqueue = vi.fn();
			const onBeforeDrain = vi.fn();
			const onBeforeDispatch = vi.fn();
			const controller = new PendingPromptsController({
				getSession: () => session,
				emit: () => {},
				send,
				onEnqueue,
				onBeforeDrain,
				onBeforeDispatch,
			});

			await controller.drain(sessionId);

			// Send must have been called exactly once.
			expect(sendCalls).toHaveLength(1);
			const call = sendCalls[0];
			expect(call).toBeDefined();
			// Structural assertion: delivery is NOT in the payload
			// under ablation. jobId IS.
			expect(Object.prototype.hasOwnProperty.call(call, "delivery")).toBe(
				false,
			);
			expect(call?.jobId).toBe("job-1");
			// The C5/C6 hooks still observe the originating delivery
			// (they read it from the entry, not the deps.send payload)
			// — this is intentional and is part of the
			// production-shape conservation guarantee for the
			// diagnostic hooks.
			expect(onBeforeDrain.mock.calls[0]?.[0]?.delivery).toBe("queue");
			expect(onBeforeDispatch.mock.calls[0]?.[0]?.delivery).toBe("queue");
			expect(onBeforeDrain.mock.calls[0]?.[0]?.jobId).toBe("job-1");
			expect(onBeforeDispatch.mock.calls[0]?.[0]?.jobId).toBe("job-1");
		});

		it("AB-DELIVERY-02: with ablation OFF, deps.send input forwards delivery exactly as production", async () => {
			delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
			const sessionId = "sess-ab-delivery-02";
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
				agent: { canStartRun: () => true },
			} as unknown as ActiveSession;

			const sendCalls: Array<{
				sessionId: string;
				prompt: string;
				jobId?: string;
				delivery?: "queue" | "steer";
			}> = [];
			const send = vi.fn(async (input: {
				sessionId: string;
				prompt: string;
				jobId?: string;
				delivery?: "queue" | "steer";
			}) => {
				sendCalls.push(input);
			});
			const controller = new PendingPromptsController({
				getSession: () => session,
				emit: () => {},
				send,
			});

			await controller.drain(sessionId);

			// Conservation: the production-equivalent path forwards
			// BOTH delivery and jobId exactly as the current
			// production seam does. If this changes, the ablation
			// cannot be interpreted as a clean single-field removal.
			expect(sendCalls).toHaveLength(1);
			const call = sendCalls[0];
			expect(call?.delivery).toBe("queue");
			expect(call?.jobId).toBe("job-1");
		});
	});

	// =====================================================================
	// AB-ATTEST-01 (positive Extension Host attestation)
	// =====================================================================
	//
	// CORRECTION01 §3 — Establish positive attestation that the running
	// process is bound to the expected ablation state. The constructor
	// emits ONE line to process.stderr:
	//
	//   [CLINEMM_OOM_DISC01_ATTEST] subject=<sha|unknown|unset>
	//                              ablation_active=true|false
	//                              env_present="1"|"<unset>"
	//                              eh_pid=<int>
	//                              ppid=<int|unknown>
	//                              constructed_at=<ISO>
	//
	// The test spies on process.stderr.write, parses the emitted line,
	// and asserts the structural fields. This guarantees the live-specimen
	// operator can pair `ablation_active=true|false` with the Extension
	// Host PID they record — a positive proof that the live-run
	// actually exercised the configured ablation (not a stale copy,
	// not a different process).
	//
	// Historical pitfall (now documented in the production code):
	// `declare const CLINEMM_OOM_DISC01_SUBJECT_HEAD` is a TypeScript
	// type-only declaration; at runtime the identifier is `undefined`
	// unless esbuild `--define:CLINEMM_OOM_DISC01_SUBJECT_HEAD='...'` was
	// applied. A direct reference would throw `ReferenceError: ... is
	// not defined`, which `try { ... } catch {}` silently swallowed,
	// making the test fail mysteriously with `n_calls=0`. The lookup
	// now goes through `globalThis as { ... }.CLINEMM_..._SUBJECT_HEAD`
	// so the absence is observable as the literal token `<runtime-unset>`
	// rather than a silent swallowed error.
	describe("AB-ATTEST-01: controller emits a parseable positive attestation at construction", () => {
		const ORIGINAL_ENV = process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
		afterEach(() => {
			if (ORIGINAL_ENV === undefined) {
				delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
			} else {
				process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY = ORIGINAL_ENV;
			}
			vi.restoreAllMocks();
		});

		function parseAttestLine(spy: ReturnType<typeof vi.spyOn>): {
			subject: string;
			ablationActive: boolean;
			envPresent: string;
			ehPid: number;
			ppid: string;
			constructedAt: string;
		} | null {
			const calls = spy.mock.calls;
			for (const callArgs of calls) {
				const line = String(callArgs[0] ?? "");
				if (!line.startsWith("[CLINEMM_OOM_DISC01_ATTEST]")) continue;
				const subject = /subject=(\S+)/.exec(line)?.[1] ?? "";
				const ablationActive =
					/ablation_active=(true|false)/.exec(line)?.[1] === "true";
				const envPresent = /env_present=(".*?"|\S+)/.exec(line)?.[1] ?? "";
				const ehPidRaw = /eh_pid=(\d+)/.exec(line)?.[1] ?? "";
				const ppid = /ppid=(\S+)/.exec(line)?.[1] ?? "";
				const constructedAt = /constructed_at=(\S+)/.exec(line)?.[1] ?? "";
				return {
					subject,
					ablationActive,
					envPresent,
					ehPid: Number.parseInt(ehPidRaw, 10),
					ppid,
					constructedAt,
				};
			}
			return null;
		}

		it("with env=1, ablation_active=true and eh_pid is the live process pid", () => {
			process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY = "1";
			const spy = vi
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);
			new PendingPromptsController({
				getSession: () => undefined,
				emit: () => {},
				send: async () => undefined,
			});
			const parsed = parseAttestLine(spy);
			expect(parsed, "must have emitted at least one [CLINEMM_OOM_DISC01_ATTEST] line").not.toBeNull();
			expect(parsed!.ablationActive).toBe(true);
			expect(parsed!.envPresent).toBe("1");
			expect(parsed!.ehPid).toBe(process.pid);
			expect(parsed!.constructedAt).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
			);
		});

		it("with env unset, ablation_active=false and eh_pid is the live process pid", () => {
			delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
			const spy = vi
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);
			new PendingPromptsController({
				getSession: () => undefined,
				emit: () => {},
				send: async () => undefined,
			});
			const parsed = parseAttestLine(spy);
			expect(parsed, "must have emitted at least one [CLINEMM_OOM_DISC01_ATTEST] line").not.toBeNull();
			expect(parsed!.ablationActive).toBe(false);
			expect(parsed!.envPresent).toBe("<unset>");
			expect(parsed!.ehPid).toBe(process.pid);
		});

		it("attestation subject token is one of {<sha>, <unknown>, <runtime-unset>}", () => {
			delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
			const spy = vi
				.spyOn(process.stderr, "write")
				.mockImplementation(() => true);
			new PendingPromptsController({
				getSession: () => undefined,
				emit: () => {},
				send: async () => undefined,
			});
			const parsed = parseAttestLine(spy);
			expect(parsed).not.toBeNull();
			expect(
				parsed!.subject === "<unknown>" ||
					parsed!.subject === "<runtime-unset>" ||
					/^[0-9a-f]{7,40}$/.test(parsed!.subject),
				`subject token ${JSON.stringify(parsed!.subject)} is not in the allowed set`,
			).toBe(true);
		});
	});
});
