/**
 * C1.5 AgentRuntime canonical recovery state/event truth.
 *
 * C1.4 decides what the runtime WILL DO; C1.5 makes that exact decision
 * state OBSERVABLE without re-deriving it.
 *
 * These tests drive the real AgentRuntime and assert the C1.5 contract:
 *
 *   1. `runtime.snapshot().recovery` is canonical runtime truth.
 *   2. `recovery-state-changed` announces transitions of that truth.
 *   3. `event.snapshot.recovery` === `runtime.snapshot().recovery` at
 *      emission (structurally guaranteed: both come from the same
 *      `snapshotRecoveryState()` call).
 *   4. Control-plane outcomes never fabricate recovery pressure.
 *   5. Public surfaces expose opaque diagnostic ids only.
 *   6. Lifecycle resets are observable; no-op resets are silent.
 *   7. Parallel batches emit ONE reconciled event at the batch
 *      boundary — the sequence never depends on completion order.
 *   8. A throwing subscriber cannot alter recovery control decisions.
 *
 * NOTE ON SCOPE: C1.5 stops at the runtime surface. No webview, no task
 * header, no chat projection. Consumers must never re-derive recovery
 * state from tool-result prose such as `bounded_recovery_exhausted`.
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentRuntimeRecoverySnapshot,
	AgentTool,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";
import { DEFAULT_RECOVERY_POLICY } from "./runtime/recovery";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
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
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

const ENOENT = Object.assign(new Error("ENOENT: /secret/path/token.pem"), {
	code: "ENOENT" as const,
});
const OPAQUE = new Error("opaque internal failure");

/**
 * A recovery event paired with the snapshot read back from the runtime
 * INSIDE the subscriber. This is how we prove the re-entrant
 * snapshot/event consistency invariant.
 */
interface CapturedRecoveryEvent {
	previous: AgentRuntimeRecoverySnapshot;
	payload: AgentRuntimeRecoverySnapshot;
	reentrantSnapshot: AgentRuntimeRecoverySnapshot;
}

/** Compact transition label used for exact sequence assertions. */
function label(e: CapturedRecoveryEvent): string {
	return `${e.previous.state}/${e.previous.secondStage}→${e.payload.state}/${e.payload.secondStage}`;
}

function subscribeRecovery(
	runtime: AgentRuntime,
	out: CapturedRecoveryEvent[],
	allEvents?: string[],
): void {
	runtime.subscribe((event: AgentRuntimeEvent) => {
		allEvents?.push(event.type);
		if (event.type !== "recovery-state-changed") return;
		out.push({
			previous: event.previousRecovery,
			payload: event.snapshot.recovery,
			// Re-entrant read: MUST already observe the announced state.
			reentrantSnapshot: runtime.snapshot().recovery,
		});
	});
}

function toolCallStep(
	toolCallId: string,
	toolName: string,
	input: unknown,
): () => AgentModelEvent[] {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

const finishStep = (): AgentModelEvent[] => [
	{ type: "text-delta", text: "done" },
	{ type: "finish", reason: "stop" },
];

function createEnoentTool(calls: {
	count: number;
}): AgentTool<{ path: string }, never> {
	return {
		name: "fs_read",
		description: "Throws ENOENT",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			throw ENOENT;
		},
	};
}

function createOpaqueTool(calls: {
	count: number;
}): AgentTool<{ value: string }, never> {
	return {
		name: "opaque_thrower",
		description: "Throws opaque",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			throw OPAQUE;
		},
	};
}

function createSuccessTool(calls: {
	count: number;
}): AgentTool<{ x: number }, { ok: true }> {
	return {
		name: "ok",
		description: "Succeeds",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return { ok: true };
		},
	};
}

// ============================================================================
//      C15 SNAPSHOT TRUTH
// ============================================================================

describe("AgentRuntime / C1.5 canonical recovery snapshot", () => {
	it("C15_INITIAL_SNAPSHOT_IDLE: a fresh runtime exposes a fully idle recovery projection", () => {
		const runtime = new AgentRuntime({
			model: new ScriptedModel([finishStep]),
			tools: [],
		});
		const recovery = runtime.snapshot().recovery;
		expect(recovery.state).toBe("idle");
		expect(recovery.secondStage).toBe("idle");
		expect(recovery.secondStageTrigger).toBeUndefined();
		expect(recovery.episodeFailures).toBe(0);
		expect(recovery.maxEpisodeFailures).toBe(
			DEFAULT_RECOVERY_POLICY.maxRecoveryEpisodeFailures,
		);
		expect(recovery.circuitNoticeCount).toBe(0);
		expect(recovery.tracker.state).toBe("idle");
		expect(recovery.tracker.currentRepairAttempts).toBe(0);
		expect(recovery.tracker.equivalentRepeatCount).toBe(0);
		expect(recovery.tracker.blockedFamilies).toEqual([]);
		expect(recovery.tracker.blockedExactKeys).toEqual([]);
	});

	it("C15_FIRST_FAILURE_EVENT: the first recoverable failure moves the public projection to recovering with one episode failure", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		expect(events.length).toBe(1);
		const first = events[0];
		expect(first.previous.state).toBe("idle");
		expect(first.payload.state).toBe("recovering");
		expect(first.payload.episodeFailures).toBe(1);
		expect(first.payload.tracker.currentRepairAttempts).toBe(0);
		expect(first.payload.secondStage).toBe("idle");
		// Final snapshot agrees with the last announced state.
		expect(runtime.snapshot().recovery.state).toBe("recovering");
	});

	it("C15_WARNING_EVENT: repeated equivalent failures escalate the public projection through recovering to warning", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			toolCallStep("t2", "fs_read", { path: "/a" }),
			toolCallStep("t3", "fs_read", { path: "/a" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		// EXACT sequence — not merely "some event happened". One event
		// per tool call; no duplicates. Note event #2 keeps the same
		// visible state but advances `repairAttempts`, which IS an
		// externally meaningful change and therefore fires.
		expect(events.map(label)).toEqual([
			"idle/idle→recovering/idle",
			"recovering/idle→recovering/idle",
			"recovering/idle→warning/armed",
		]);
		expect(events.map((e) => e.payload.tracker.currentRepairAttempts)).toEqual([
			0,
			1,
			DEFAULT_RECOVERY_POLICY.maxRepairAttempts,
		]);
		expect(runtime.snapshot().recovery.state).toBe("warning");
		// The third failure exhausts the family budget, which arms the
		// C1.4 second stage (Trigger B) — observable without any chat
		// history inspection.
		const last = events[events.length - 1].payload;
		expect(last.secondStage).toBe("armed");
		expect(last.secondStageTrigger).toBe("family_exhausted");
		expect(calls.count).toBe(3);
	});
});

// ============================================================================
//      C15 EVENT / SNAPSHOT CONSISTENCY
// ============================================================================

describe("AgentRuntime / C1.5 event–snapshot consistency", () => {
	it("C15_EVENT_EQUALS_SNAPSHOT: every event's recovery payload is carried on the same snapshot the runtime exposes", async () => {
		// Structural invariant: because every AgentRuntimeEvent embeds
		// `snapshot`, and `snapshot()` builds `recovery` from the one
		// canonical projection, no event can carry recovery state that
		// disagrees with the runtime. Assert it across the whole event
		// stream — not just recovery events.
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			toolCallStep("t2", "fs_read", { path: "/a" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		const mismatches: string[] = [];
		let sawRecoveryEvent = false;
		runtime.subscribe((event: AgentRuntimeEvent) => {
			// Every event exposes the recovery projection...
			expect(event.snapshot.recovery).toBeDefined();
			if (event.type !== "recovery-state-changed") return;
			sawRecoveryEvent = true;
			// ...and for recovery events it must equal what a consumer
			// reads back from the runtime at that instant.
			const live = runtime.snapshot().recovery;
			if (JSON.stringify(live) !== JSON.stringify(event.snapshot.recovery)) {
				mismatches.push(
					`${JSON.stringify(live)} !== ${JSON.stringify(event.snapshot.recovery)}`,
				);
			}
		});
		await runtime.run("Start");
		expect(sawRecoveryEvent).toBe(true);
		expect(mismatches).toEqual([]);
	});

	it("C15_REENTRANT_SNAPSHOT_EQUALS_EVENT: reading runtime.snapshot() inside the subscriber observes the announced state, not the previous one", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			toolCallStep("t2", "fs_read", { path: "/a" }),
			toolCallStep("t3", "fs_read", { path: "/a" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		expect(events.length).toBeGreaterThan(0);
		for (const captured of events) {
			// The re-entrant read must match the payload exactly...
			expect(captured.reentrantSnapshot).toEqual(captured.payload);
			// ...and must NOT be the pre-mutation state (which is what a
			// stale-snapshot bug would produce).
			expect(captured.reentrantSnapshot).not.toEqual(captured.previous);
		}
	});

	it("C15_TEST_ACCESSOR_MATCHES_PUBLIC: the internal test seam is derived from the same canonical projection", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			toolCallStep("t2", "fs_read", { path: "/a" }),
			toolCallStep("t3", "fs_read", { path: "/a" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		await runtime.run("Start");
		const publicRecovery = runtime.snapshot().recovery;
		const seam = (
			runtime as unknown as {
				__recoverySnapshotForTests(): {
					state: string;
					circuitNoticeCount: number;
					secondStage: { kind: string; trigger?: string };
					episodeFailures: number;
					maxRecoveryEpisodeFailures: number;
				};
			}
		).__recoverySnapshotForTests();
		expect(seam.state).toBe(publicRecovery.state);
		expect(seam.circuitNoticeCount).toBe(publicRecovery.circuitNoticeCount);
		expect(seam.secondStage.kind).toBe(publicRecovery.secondStage);
		expect(seam.secondStage.trigger).toBe(publicRecovery.secondStageTrigger);
		expect(seam.episodeFailures).toBe(publicRecovery.episodeFailures);
		expect(seam.maxRecoveryEpisodeFailures).toBe(
			publicRecovery.maxEpisodeFailures,
		);
	});
});

// ============================================================================
//      C15 PRIVACY
// ============================================================================

describe("AgentRuntime / C1.5 public surface privacy", () => {
	it("C15_PRIVACY_NO_RAW_IDENTITY: recovery events and snapshots never carry canonical input, secrets, or raw control identities", async () => {
		// The tool input embeds a sentinel secret and the thrown error
		// embeds a sentinel path. Neither may appear anywhere in the
		// serialized public recovery surface.
		const SENTINEL_SECRET = "C15_SENTINEL_API_KEY_DO_NOT_LEAK_7F3A";
		const SENTINEL_PATH = "/secret/path/token.pem";
		const leakTool: AgentTool<{ apiKey: string }, never> = {
			name: "fs_read",
			description: "Throws ENOENT",
			inputSchema: { type: "object" },
			async execute() {
				throw ENOENT; // message contains SENTINEL_PATH
			},
		};
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { apiKey: SENTINEL_SECRET }),
			toolCallStep("t2", "fs_read", { apiKey: SENTINEL_SECRET }),
			toolCallStep("t3", "fs_read", { apiKey: SENTINEL_SECRET }),
			finishStep,
		]);
		const runtime = new AgentRuntime({ model, tools: [leakTool] });
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		expect(events.length).toBeGreaterThan(0);
		const serialized = JSON.stringify([
			...events.map((e) => [e.previous, e.payload]),
			runtime.snapshot().recovery,
		]);
		expect(serialized).not.toContain(SENTINEL_SECRET);
		expect(serialized).not.toContain(SENTINEL_PATH);
		expect(serialized).not.toContain("apiKey");
		// The diagnostic family id IS present and IS opaque: 8-char hex.
		const family =
			events[events.length - 1].payload.tracker.currentFailureFamily;
		expect(family).toBeDefined();
		expect(family).toMatch(/^[0-9a-f]{8}$/);
	});

	it("C15_PRIVACY_NO_PRIVATE_CONTROL_FIELDS: private runtime control state is structurally absent from the public projection", async () => {
		const calls = { count: 0 };
		// Distinct opaque inputs populate the PRIVATE `exactOnlyBudget`
		// map. Its cardinality must not be inferable from the public
		// surface, and the private batch buffer must never appear.
		const model = new ScriptedModel([
			...Array.from({ length: 4 }, (_, i) =>
				toolCallStep(`t${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createOpaqueTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		const serialized = JSON.stringify([
			...events.map((e) => e.payload),
			runtime.snapshot().recovery,
		]);
		for (const forbidden of [
			"exactOnlyBudget",
			"pendingBatchOutcomes",
			"secondStageBeforeRecord",
			"controlKey",
			"controlFamily",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		// Sanity: the run really did exercise the private budget.
		expect(calls.count).toBe(4);
	});
});

// ============================================================================
//      C15 SECOND STAGE + TERMINAL LATCH
// ============================================================================

describe("AgentRuntime / C1.5 second-stage observability", () => {
	it("C15_EXACT_BLOCK_CIRCUIT_EVENT: a pre-execution exact block is publicly observable as circuit_open with a blocked exact key", async () => {
		const calls = { count: 0 };
		// Four identical attempts: the fourth is intercepted by the C1.3
		// pre-exec breaker before the executor runs.
		const model = new ScriptedModel([
			...Array.from({ length: 4 }, (_, i) =>
				toolCallStep(`t${i}`, "fs_read", { path: "/a" }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		const final = runtime.snapshot().recovery;
		expect(final.state).toBe("circuit_open");
		expect(final.circuitNoticeCount).toBe(1);
		// EXACT public sequence for an exact-repeat episode.
		expect(events.map(label)).toEqual([
			"idle/idle→recovering/idle",
			"recovering/idle→recovering/idle",
			"recovering/idle→warning/armed",
			"warning/armed→circuit_open/terminating",
		]);
		// The circuit transition was ANNOUNCED, not merely reachable, and
		// carries the opaque blocked-family id.
		const circuitEvent = events.find((e) => e.payload.state === "circuit_open");
		expect(circuitEvent).toBeDefined();
		expect(circuitEvent?.payload.tracker.blockedFamilies.length).toBe(1);
		expect(circuitEvent?.payload.tracker.blockedFamilies[0]).toMatch(
			/^[0-9a-f]{8}$/,
		);
		// The exact block consumed the bounded continuation, so the
		// terminal latch is publicly visible in the same event.
		expect(circuitEvent?.payload.secondStage).toBe("terminating");
		// Executor was NOT called for the intercepted 4th attempt.
		expect(calls.count).toBe(3);
	});

	it("C15_SECOND_STAGE_TERMINATING_EVENT: the terminal latch is announced BEFORE the run's terminal event", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			...Array.from({ length: 8 }, (_, i) =>
				toolCallStep(`t${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createOpaqueTool(calls)],
		});
		const order: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "recovery-state-changed") {
				if (event.snapshot.recovery.secondStage === "terminating") {
					order.push("recovery:terminating");
				}
				return;
			}
			if (event.type === "run-finished" || event.type === "run-failed") {
				order.push(`terminal:${event.type}`);
			}
		});
		const result = await runtime.run("Start");

		// The run really did terminate under the bounded-recovery latch.
		expect(result.status).toBe("aborted");
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");
		// ORDERING: a consumer never sees the terminal event before
		// learning why.
		const terminatingAt = order.indexOf("recovery:terminating");
		const terminalAt = order.findIndex((o) => o.startsWith("terminal:"));
		expect(terminatingAt).toBeGreaterThanOrEqual(0);
		expect(terminalAt).toBeGreaterThanOrEqual(0);
		expect(terminatingAt).toBeLessThan(terminalAt);
	});

	it("C15_SUCCESS_RESET_EVENT: a successful tool clears the episode and the reset is announced", async () => {
		const failCalls = { count: 0 };
		const okCalls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			toolCallStep("t2", "fs_read", { path: "/a" }),
			toolCallStep("t3", "ok", { x: 1 }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(failCalls), createSuccessTool(okCalls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		const final = runtime.snapshot().recovery;
		// C1.4 semantics: a successful tool clears the runtime's
		// EPISODE-level counter and the second stage. The C1.0 tracker
		// resets the ACTIVE FAMILY (repairAttempts drop back), which is
		// why the visible tracker state remains `recovering` rather than
		// `idle` — `resetEpisode` is reserved for user input / new run.
		// C1.5 reports that truth exactly; it does not invent an `idle`.
		expect(final.episodeFailures).toBe(0);
		expect(final.secondStage).toBe("idle");
		expect(final.state).toBe("recovering");
		expect(final.tracker.currentRepairAttempts).toBe(1);
		// EXACT sequence: three events, one per tool call, and the third
		// (the success) is externally meaningful because it drops the
		// episode counter and the repair counter.
		expect(events.map(label)).toEqual([
			"idle/idle→recovering/idle",
			"recovering/idle→recovering/idle",
			"recovering/idle→recovering/idle",
		]);
		const last = events[events.length - 1];
		expect(last.previous.episodeFailures).toBe(2);
		expect(last.payload.episodeFailures).toBe(0);
		expect(failCalls.count).toBe(2);
		expect(okCalls.count).toBe(1);
	});
});

// ============================================================================
//      C15 LIFECYCLE RESET
// ============================================================================

describe("AgentRuntime / C1.5 lifecycle reset observability", () => {
	it("C15_RUN_RESET_EVENT: a meaningful reset is announced, and a no-op reset is silent", async () => {
		const calls = { count: 0 };
		// Run 1 drives the runtime into a terminating latch.
		const model1 = new ScriptedModel([
			...Array.from({ length: 8 }, (_, i) =>
				toolCallStep(`a${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model: model1,
			tools: [createOpaqueTool(calls)],
		});
		await runtime.run("Start");
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");

		// Run 2 on the SAME runtime must reset — and that reset must be
		// observable, because the previous state was non-idle.
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		(runtime as unknown as { config: { model: AgentModel } }).config.model =
			new ScriptedModel([finishStep]);
		await runtime.run("Second");

		expect(events.length).toBe(1);
		expect(events[0].previous.secondStage).toBe("terminating");
		expect(events[0].payload.secondStage).toBe("idle");
		expect(events[0].payload.state).toBe("idle");
		expect(events[0].payload.episodeFailures).toBe(0);
		expect(runtime.snapshot().recovery.secondStage).toBe("idle");

		// Run 3 starts from an already-idle projection: the reset is a
		// no-op and MUST NOT produce a pointless `idle → idle` event.
		events.length = 0;
		(runtime as unknown as { config: { model: AgentModel } }).config.model =
			new ScriptedModel([finishStep]);
		await runtime.run("Third");
		expect(events).toEqual([]);
	});

	it("C15_RESTORE_SNAPSHOT_TRUTH: restore() clears recovery state, observable on the next snapshot", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			...Array.from({ length: 8 }, (_, i) =>
				toolCallStep(`a${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createOpaqueTool(calls)],
		});
		await runtime.run("Start");
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");

		// `restore()` resets per-episode recovery state; the canonical
		// snapshot MUST immediately report the cleared state — a consumer
		// that reads `snapshot()` after restore can never observe stale
		// truth. `restore()` is now `Promise<void>` (parent P0 correction)
		// because subscribers must be notified when their last known
		// recovery projection is invalidated. This test is a snapshot-
		// truth probe, not an event probe; the meaningful-change event
		// from `terminating → idle` is verified separately in
		// `C15_RESTORE_RESET_EVENT` below.
		await runtime.restore([]);
		const recovery = runtime.snapshot().recovery;
		expect(recovery.secondStage).toBe("idle");
		expect(recovery.secondStageTrigger).toBeUndefined();
		expect(recovery.state).toBe("idle");
		expect(recovery.episodeFailures).toBe(0);
		expect(recovery.circuitNoticeCount).toBe(0);
		expect(recovery.tracker.blockedFamilies).toEqual([]);
	});

	it("C15_RESTORE_RESET_EVENT: a meaningful restore() emits the canonical recovery-state-changed event, a no-op restore is silent", async () => {
		// Parent verdict P0: `restore()` preserves subscribers but
		// invalidates their last-known recovery projection. Without an
		// event, subscriber-only consumers keep stale truth while a
		// snapshot-reading consumer immediately sees the new state.
		//
		// Two paths must be observable exactly like the run-start reset:
		//   terminating → restore → idle    → exactly one canonical event
		//   idle       → restore → idle    → silent (dedup suppression)
		const calls = { count: 0 };
		const model = new ScriptedModel([
			...Array.from({ length: 8 }, (_, i) =>
				toolCallStep(`a${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createOpaqueTool(calls)],
		});

		// Drive the runtime into a `terminating` latch.
		await runtime.run("Drive to circuit");
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");

		// --- MEANINGFUL RESET ---
		// Subscribe from a position where we know the previous projection
		// was terminating. Restore → idle. Exactly one event must fire.
		const meaningfulEvents: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, meaningfulEvents);
		await runtime.restore([]);
		expect(meaningfulEvents.length).toBe(1);
		expect(meaningfulEvents[0].previous.secondStage).toBe("terminating");
		expect(meaningfulEvents[0].payload.secondStage).toBe("idle");
		expect(meaningfulEvents[0].payload.state).toBe("idle");
		expect(meaningfulEvents[0].payload.episodeFailures).toBe(0);
		expect(meaningfulEvents[0].payload.circuitNoticeCount).toBe(0);
		expect(meaningfulEvents[0].payload.tracker.blockedFamilies).toEqual([]);
		// Public event payload MUST equal current `snapshot()` value —
		// structural equality, not tested equality.
		expect(runtime.snapshot().recovery).toEqual(meaningfulEvents[0].payload);

		// --- NO-OP RESET ---
		// Already idle. A fresh restore from this state must emit
		// nothing — otherwise a UI would re-render a null transition.
		const noopEvents: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, noopEvents);
		await runtime.restore([]);
		expect(noopEvents).toEqual([]);
	});
});

// ============================================================================
//      C15 SUBSCRIBER / LIVE-TYPE GUARANTEES
// ============================================================================

describe("AgentRuntime / C1.5 subscribe surface compiles with the live recovery refinement", () => {
	it("C15_LIVE_RECOVERY_TYPE_GUARANTEE: subscribe() callbacks receive event.snapshot.recovery as non-optional at compile time", async () => {
		// C1.5 P1 — three live-runtime refine­ment witnesses at the
		// subscribe boundary.
		//
		// The runtime value already proves `recovery` is present
		// (`C15_EVENT_EQUALS_SNAPSHOT`). This test pins the matching
		// type-level guarantee via three independent witnesses:
		//
		//   W1. `LiveAgentRuntimeEvent` is exported from the public
		//       `@cline/shared` surface (compile-time witness —
		//       captured by an inline `import()` type expression).
		//   W2. `LiveAgentRuntimeStateSnapshot.recovery` is
		//       structurally non-optional.
		//   W3. The public subscribe callback receives the live event
		//       shape via `AgentEventListener`'s `(event:
		//       LiveAgentRuntimeEvent) => void` signature.
		//
		// Witnesses W1+W2 are anchored in production code
		// (`agent-runtime.ts`) — removing the type or the
		// refinement makes `bun run build:sdk` fail. Witness W3 is
		// anchored in this test file's contextual-typing of
		// `runtime.subscribe((event) => ...)` — TS infers `event`
		// from `AgentEventListener`, so a regression that reverts
		// the signature widens `event.snapshot.recovery` to
		// `... | undefined`. If a future refactor breaks either
		// branch, the production build OR the `AgentEventListener`
		// declaration fails to typecheck.
		const calls = { count: 0 };
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				toolCallStep("t1", "fs_read", { path: "/a" }),
				finishStep,
			]),
			tools: [createEnoentTool(calls)],
		});

		// W1: type witness via inline import — survives even if
		// the `type` keyword was stripped from a future refactor.
		type LiveWitness = import("@cline/shared").LiveAgentRuntimeEvent;
		// W2: structural witness — proves `recovery` is required
		// on the live variant. Compile-time guard: removing the
		// refinement makes this assignment impossible.
		const _nonOptionalRecovery: AgentRuntimeRecoverySnapshot =
			null as unknown as LiveWitness["snapshot"]["recovery"];

		const received: { secondStage: string }[] = [];
		const unsubscribe: () => void = runtime.subscribe((event) => {
			// W3: contextual typing. With the live refinement,
			// `event.snapshot.recovery.secondStage` is reachable
			// without an `?` or a non-null check. The plain
			// property access is the witness — if the
			// refinement were stripped, TS would emit
			// `Object is possibly 'undefined'`.
			const r = event.snapshot.recovery;
			received.push({ secondStage: r.secondStage });
		});
		await runtime.run("Probe live type");
		unsubscribe();
		expect(received.length).toBeGreaterThan(0);
		// Runtime assertion that the recovered projection is
		// fully shaped (not undefined).
		expect(received.every((r) => typeof r.secondStage === "string")).toBe(true);
	});
});

// ============================================================================
//      C15 CONTROL-PLANE EXCLUSION
// ============================================================================

describe("AgentRuntime / C1.5 control-plane exclusion", () => {
	it("C15_CONTROL_PLANE_NO_FALSE_EVENT: repeated host DENY never emits recovering/warning/circuit_open", async () => {
		// Control-plane outcomes are structurally excluded from the
		// recovery tracker (C1.2). C1.5 must not invent public recovery
		// pressure for them: the projection stays idle, so the dedup rule
		// suppresses every event. EXACT count is 0 — the cleanest
		// possible contract.
		const executed = { count: 0 };
		const denyTool: AgentTool<{ value: string }, never> = {
			name: "opaque_thrower",
			description: "Never actually runs",
			inputSchema: { type: "object" },
			async execute() {
				executed.count += 1;
				throw OPAQUE;
			},
		};
		const approvals: string[] = [];
		const model = new ScriptedModel([
			...Array.from({ length: 5 }, (_, i) =>
				toolCallStep(`d${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [denyTool],
			toolPolicies: { opaque_thrower: { autoApprove: false } },
			requestToolApproval: async (
				request: ToolApprovalRequest,
			): Promise<ToolApprovalResult> => {
				approvals.push(request.toolCallId);
				return {
					approved: false,
					reason: "denied",
					decision: { kind: "deny" },
				};
			},
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		// The denials really happened...
		expect(approvals.length).toBe(5);
		// ...the executor never ran...
		expect(executed.count).toBe(0);
		// ...and NO recovery event was fabricated.
		expect(events).toEqual([]);
		const final = runtime.snapshot().recovery;
		expect(final.state).toBe("idle");
		expect(final.secondStage).toBe("idle");
		expect(final.episodeFailures).toBe(0);
		expect(final.circuitNoticeCount).toBe(0);
	});
});

// ============================================================================
//      C15 PARALLEL EVENT ATOMICITY
// ============================================================================

/**
 * Drive an armed second stage, then run a parallel batch of
 * [opaque failure, unrelated success] with a controllable completion
 * order. Returns the public recovery-event sequence produced by the
 * continuation batch only.
 */
async function driveParallelContinuation(failFirst: boolean): Promise<{
	batchEvents: CapturedRecoveryEvent[];
	finalRecovery: AgentRuntimeRecoverySnapshot;
	order: string[];
}> {
	const order: string[] = [];
	let inBatch = false;
	const failTool: AgentTool<{ x: number }, never> = {
		name: "opaque_thrower",
		description: "Fails opaque",
		inputSchema: { type: "object" },
		async execute(input) {
			// Only the continuation call (x === 99) participates in the
			// race; the 6 pre-arm calls run sequentially beforehand.
			const isBatch = inBatch && input.x === 99;
			if (isBatch && !failFirst) {
				// Delay so the sibling success resolves (and applies its
				// provisional armed → idle reset) BEFORE this failure
				// lands. This is the worst-case race the atomicity rule
				// must absorb.
				for (let i = 0; i < 20; i++) {
					await new Promise((r) => setImmediate(r));
				}
			}
			if (isBatch) order.push("fail_throw");
			throw OPAQUE;
		},
	};
	const okTool: AgentTool<{ x: number }, { ok: true }> = {
		name: "ok",
		description: "Succeeds",
		inputSchema: { type: "object" },
		async execute() {
			if (failFirst) {
				for (let i = 0; i < 20; i++) {
					await new Promise((r) => setImmediate(r));
				}
			}
			order.push("ok_resolve");
			return { ok: true };
		},
	};
	const model = new ScriptedModel([
		// 6 distinct opaque failures arm the second stage (Trigger D).
		...Array.from({ length: 6 }, (_, i) =>
			toolCallStep(`a${i}`, "opaque_thrower", { x: i }),
		),
		// Continuation: a real parallel batch.
		() => [
			{
				type: "tool-call-delta",
				toolCallId: "p_fail",
				toolName: "opaque_thrower",
				inputText: JSON.stringify({ x: 99 }),
			},
			{
				type: "tool-call-delta",
				toolCallId: "p_ok",
				toolName: "ok",
				inputText: JSON.stringify({ x: 1 }),
			},
			{ type: "finish", reason: "tool-calls" },
		],
		finishStep,
	]);
	const runtime = new AgentRuntime({
		model,
		tools: [failTool, okTool],
		toolExecution: "parallel",
	});
	const all: CapturedRecoveryEvent[] = [];
	subscribeRecovery(runtime, all);
	// Mark where the continuation batch begins so we can isolate the
	// events the batch itself produced, and enable the race delays.
	let batchStartIndex = 0;
	runtime.subscribe((event: AgentRuntimeEvent) => {
		if (
			event.type === "tool-started" &&
			event.toolCall.toolCallId === "p_fail"
		) {
			batchStartIndex = all.length;
			inBatch = true;
		}
	});
	await runtime.run("Start");
	return {
		batchEvents: all.slice(batchStartIndex),
		finalRecovery: runtime.snapshot().recovery,
		order,
	};
}

describe("AgentRuntime / C1.5 parallel event atomicity", () => {
	it("C15_PARALLEL_FAIL_FIRST_ATOMIC and C15_PARALLEL_OK_FIRST_ATOMIC produce the SAME public event truth", async () => {
		const failFirst = await driveParallelContinuation(true);
		const okFirst = await driveParallelContinuation(false);

		// Sanity: the two runs really did complete in opposite orders.
		expect(failFirst.order.indexOf("fail_throw")).toBeLessThan(
			failFirst.order.indexOf("ok_resolve"),
		);
		expect(okFirst.order.indexOf("ok_resolve")).toBeLessThan(
			okFirst.order.indexOf("fail_throw"),
		);

		// ATOMICITY: exactly ONE canonical recovery event per batch,
		// emitted at the batch boundary — never one per sibling.
		expect(failFirst.batchEvents.length).toBe(1);
		expect(okFirst.batchEvents.length).toBe(1);

		// EQUIVALENCE: the public sequences are identical, so a consumer
		// cannot tell which sibling finished first.
		expect(failFirst.batchEvents.map(label)).toEqual(
			okFirst.batchEvents.map(label),
		);

		// The reconciled batch truth is the terminal latch.
		for (const run of [failFirst, okFirst]) {
			expect(run.batchEvents[0].payload.secondStage).toBe("terminating");
			expect(run.batchEvents[0].payload.secondStageTrigger).toBe(
				"episode_exhausted",
			);
			expect(run.finalRecovery.secondStage).toBe("terminating");
		}

		// NO transient `idle` was ever exposed: the sibling success's
		// provisional armed → idle reset is suppressed while the batch is
		// in flight and overturned by reconciliation.
		for (const run of [failFirst, okFirst]) {
			expect(
				run.batchEvents.some((e) => e.payload.secondStage === "idle"),
			).toBe(false);
		}
	});
});

// ============================================================================
//      C15 SUBSCRIBER ROBUSTNESS
// ============================================================================

describe("AgentRuntime / C1.5 subscriber robustness", () => {
	it("C15_SUBSCRIBER_THROW_DOES_NOT_BREAK_CONTROL: a throwing listener cannot alter recovery control decisions", async () => {
		// Observation must never become control. A subscriber that throws
		// on every recovery event must not prevent the breaker or the
		// terminal latch.
		const calls = { count: 0 };
		const model = new ScriptedModel([
			...Array.from({ length: 8 }, (_, i) =>
				toolCallStep(`a${i}`, "opaque_thrower", { value: `v${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createOpaqueTool(calls)],
		});
		let thrown = 0;
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "recovery-state-changed") {
				thrown += 1;
				throw new Error("subscriber blew up");
			}
		});

		const result = await runtime.run("Start");

		// The throwing subscriber really did fire...
		expect(thrown).toBeGreaterThan(0);
		// ...and the CONTROL decision is unchanged: the breaker still
		// tripped and the terminal latch still terminated the run. An
		// observer cannot veto recovery.
		expect(result.status).toBe("aborted");
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");
		expect(runtime.snapshot().recovery.secondStageTrigger).toBeDefined();
	});

	it("C15_SUBSCRIBER_THROW_DOES_NOT_ABORT_RUN: a throwing recovery listener does not surface as a run failure", async () => {
		// Distinguishes "recovery terminated the run" (correct) from
		// "the subscriber's exception escaped and failed the run"
		// (incorrect). A single failing tool is not enough to trip the
		// latch, so a clean completion proves the throw was absorbed.
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		let thrown = 0;
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "recovery-state-changed") {
				thrown += 1;
				throw new Error("subscriber blew up");
			}
		});
		const result = await runtime.run("Start");

		expect(thrown).toBe(1);
		expect(result.status).toBe("completed");
		expect(result.error).toBeUndefined();
		// Recovery state still advanced correctly despite the throw.
		expect(runtime.snapshot().recovery.state).toBe("recovering");
		expect(runtime.snapshot().recovery.episodeFailures).toBe(1);
	});

	it("C15_BATCH_GUARD_RESTORED: after any parallel batch the emission guard is down and the private buffer is empty", async () => {
		// C1.6 residue pulled forward: `executeToolCalls` suspends
		// emission for the duration of a parallel batch. If the guard
		// were not restored in a `finally`, every later recovery event in
		// the run would be silently swallowed and stale typed outcomes
		// would leak into the next batch's reconciliation.
		const failCalls = { count: 0 };
		const okCalls = { count: 0 };
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "b_fail",
					toolName: "fs_read",
					inputText: JSON.stringify({ path: "/a" }),
				},
				{
					type: "tool-call-delta",
					toolCallId: "b_ok",
					toolName: "ok",
					inputText: JSON.stringify({ x: 1 }),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			// A sequential-style follow-up whose recovery event MUST
			// still be emitted (proving the guard was lifted).
			toolCallStep("after", "fs_read", { path: "/b" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(failCalls), createSuccessTool(okCalls)],
			toolExecution: "parallel",
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		const internals = runtime as unknown as {
			recoveryEmissionSuspended: boolean;
			pendingBatchOutcomes: unknown[];
		};
		expect(internals.recoveryEmissionSuspended).toBe(false);
		expect(internals.pendingBatchOutcomes.length).toBe(0);
		// Events after the batch are NOT swallowed.
		expect(events.length).toBeGreaterThanOrEqual(2);
		expect(failCalls.count).toBe(2);
		expect(okCalls.count).toBe(1);
	});
});

// ============================================================================
//      C15 FRESH-INPUT PUBLIC TRUTH
// ============================================================================

describe("AgentRuntime / C1.5 fresh-input escape hatches are publicly visible", () => {
	it("C15_FAMILY_FRESH_INPUT_PUBLIC_TRUTH: changing inputs within one failure family still shows rising public pressure", async () => {
		// /a → /b → /c are three DISTINCT canonical inputs, so no exact
		// repeat occurs. The public surface must still reveal that the
		// FAMILY is under pressure — without the consumer knowing any
		// path.
		const calls = { count: 0 };
		const model = new ScriptedModel([
			toolCallStep("t1", "fs_read", { path: "/a" }),
			toolCallStep("t2", "fs_read", { path: "/b" }),
			toolCallStep("t3", "fs_read", { path: "/c" }),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEnoentTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		const final = runtime.snapshot().recovery;
		expect(final.state).toBe("warning");
		// Family-level pressure IS visible: the family is blocked and the
		// second stage armed with a family-exhaustion trigger, even
		// though every canonical input differed.
		expect(final.tracker.blockedFamilies.length).toBe(1);
		expect(final.secondStage).toBe("armed");
		expect(final.secondStageTrigger).toBe("family_exhausted");
		expect(final.episodeFailures).toBeGreaterThan(0);
		// One stable family id across all three distinct inputs.
		const families = new Set(
			events
				.map((e) => e.payload.tracker.currentFailureFamily)
				.filter((f): f is string => f !== undefined),
		);
		expect(families.size).toBe(1);
		// No canonical path leaked.
		const serialized = JSON.stringify(events.map((e) => e.payload));
		expect(serialized).not.toContain("/a");
		expect(serialized).not.toContain("/b");
		expect(serialized).not.toContain("/c");
		expect(calls.count).toBe(3);
	});

	it("C15_OPAQUE_EPISODE_PUBLIC_TRUTH: seven distinct opaque keys drive visible episode exhaustion without exposing key cardinality", async () => {
		const calls = { count: 0 };
		const model = new ScriptedModel([
			...Array.from({ length: 7 }, (_, i) =>
				toolCallStep(`t${i}`, "opaque_thrower", { value: `distinct-${i}` }),
			),
			finishStep,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createOpaqueTool(calls)],
		});
		const events: CapturedRecoveryEvent[] = [];
		subscribeRecovery(runtime, events);
		await runtime.run("Start");

		// Episode pressure is publicly visible and bounded by policy.
		const peak = Math.max(...events.map((e) => e.payload.episodeFailures));
		expect(peak).toBeGreaterThanOrEqual(
			DEFAULT_RECOVERY_POLICY.maxRecoveryEpisodeFailures,
		);
		expect(events[0].payload.maxEpisodeFailures).toBe(
			DEFAULT_RECOVERY_POLICY.maxRecoveryEpisodeFailures,
		);
		// The second stage became observable...
		expect(events.some((e) => e.payload.secondStage !== "idle")).toBe(true);
		expect(runtime.snapshot().recovery.secondStage).toBe("terminating");
		// ...without ever exposing the private exact-only key cardinality.
		const serialized = JSON.stringify(events.map((e) => e.payload));
		expect(serialized).not.toContain("distinct-");
		expect(serialized).not.toContain("exactOnlyBudget");
	});
});
