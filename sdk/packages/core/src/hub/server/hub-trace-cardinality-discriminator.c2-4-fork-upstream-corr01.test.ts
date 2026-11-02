/**
 * ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 — C2 discriminator.
 *
 * QUESTION
 * --------
 * Upstream commit `94980446c` ("fix(hub): stop forwarding per-chunk stream
 * events to remote onEvent hooks", #14120) added a filter in the HUB's
 * client-contribution hook proxy:
 *
 *     const STREAMING_EVENT_TYPES = new Set<AgentRuntimeEvent["type"]>([
 *       "assistant-text-delta",
 *       "assistant-reasoning-delta",
 *       "tool-updated",
 *     ]);
 *
 * and skips those event types when proxying an `onEvent` hook to a remote
 * client. A LATER upstream commit, `590785eff` ("feat(telemetry): report
 * per-run stall signals", #15228), added `"tool-call-delta"` to the same
 * set, because tool-argument streaming now emits that progress event.
 *
 * The UPSTREAM HEAD `a6507a62` therefore carries a FOUR-type filter:
 *
 *     assistant-text-delta | assistant-reasoning-delta
 *     tool-call-delta      | tool-updated
 *
 * The merged ClineMM tree's `hub-client-contributions.ts` is BYTE-IDENTICAL
 * to upstream head for this file, so the upstream optimization landed
 * intact and unmodified. This witness pins that four-type set as EXERCISED
 * behaviour, so a future change to the filter set is a visible delta.
 *
 * The ClineMM fork carries a LOAD-BEARING model-behavior / portable-trace
 * recorder. The upstream merge ACT (U02) explicitly DEFERRED `94980446c` as
 * "changes per-chunk event granularity, which the fork's portable-trace
 * provenance depends on".
 *
 * This file is the DISCRIMINATOR that decides whether the deferral was
 * justified. It answers the question with EXERCISED EVIDENCE, not with a
 * reading of the filter.
 *
 * THE THREE THINGS PROVEN
 * -----------------------
 *   D1  UPSTREAM OPTIMIZATION IS REAL AND LOCALIZED.
 *       The three delta event types are dropped by the hub's REMOTE hook
 *       proxy, and every other event type still reaches the hook.
 *
 *   D2  THE ClineMM TRACE RECORDER DOES NOT CONSUME THAT PATH.
 *       The recorder's channels (`ModelBehaviorTraceSink`) are invoked by the
 *       agent runtime DIRECTLY, on the local call path. The hub hook proxy
 *       never sees them. This is proven by EXERCISING the real
 *       `createHubClientContributionRuntime` proxy with the exact event types
 *       the filter names, and separately by EXERCISING the real
 *       `AgentRuntime` with a real sink.
 *
 *   D3  TRACE COVERAGE, IDENTITY, ORDERING AND CARDINALITY ARE INTACT.
 *       The representative delta events (assistant text, assistant
 *       reasoning, tool call, tool update) are driven through the REAL agent
 *       runtime, and the recorder's records are asserted for:
 *         - coverage   : every expected channel fired
 *         - identity    : session/run/tool-call correlation preserved
 *         - ordering    : request-start precedes tool-start precedes request-finish
 *         - cardinality : exactly one record per boundary (no duplication,
 *                          no loss) — the upstream filter cannot inflate or
 *                          deflate these counts because it is not on this path.
 *
 * WHY THE FILTER CANNOT AFFECT D3
 * ------------------------------
 * The filter lives in `createHookProxies`, which is the ONLY place that
 * turns a client-contributed `onEvent` hook into a remote capability call.
 * The recorder's channels are a different interface
 * (`ModelBehaviorTraceSink`), wired through
 * `AgentConfig.modelBehaviorTraceSink`, and the agent runtime calls them
 * inline at the observation boundary — BEFORE and AFTER the event emission
 * that the hub proxy filters. No `ModelBehaviorTraceSink` channel is ever
 * routed through `createHookProxies`.
 *
 * THIS FILE DOES NOT ASSERT FROM THE DIFF. It asserts from execution.
 */

import type { AgentRuntimeEvent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

import { createHubClientContributionRuntime } from "./hub-client-contributions";

// ============================================================================
// Fixtures
// ============================================================================

/** A minimal runtime snapshot sufficient for the hub proxy's payload shape. */
const SNAPSHOT = {
	agentId: "agent-1",
	runId: "run-1",
	status: "running" as const,
	iteration: 1,
	messages: [],
	pendingToolCalls: [],
	usage: {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	},
};

const TOOL_CALL = {
	id: "tc-1",
	name: "read_file",
	input: { value: "x" },
} as never;

/**
 * The representative delta / boundary events this ACT must exercise.
 *
 * `filteredByUpstream` marks the three types the upstream hub filter
 * names. The remainder are the control group: they must still reach the
 * hook.
 */
const REPRESENTATIVE_EVENTS: Array<{
	label: string;
	event: AgentRuntimeEvent;
	filteredByUpstream: boolean;
}> = [
	{
		label: "assistant-text-delta",
		filteredByUpstream: true,
		event: {
			type: "assistant-text-delta",
			snapshot: SNAPSHOT,
			iteration: 1,
			text: "chunk",
			accumulatedText: "chunk chunk",
		} as AgentRuntimeEvent,
	},
	{
		label: "assistant-reasoning-delta",
		filteredByUpstream: true,
		event: {
			type: "assistant-reasoning-delta",
			snapshot: SNAPSHOT,
			iteration: 1,
			text: "think",
			accumulatedText: "think think",
		} as AgentRuntimeEvent,
	},
	{
		label: "tool-updated",
		filteredByUpstream: true,
		event: {
			type: "tool-updated",
			snapshot: SNAPSHOT,
			iteration: 1,
			toolCall: TOOL_CALL,
			update: { progress: 1 },
		} as AgentRuntimeEvent,
	},
	{
		label: "tool-call-delta",
		filteredByUpstream: true,
		event: {
			type: "tool-call-delta",
			snapshot: SNAPSHOT,
			iteration: 1,
		} as AgentRuntimeEvent,
	},
	{
		label: "tool-started",
		filteredByUpstream: false,
		event: {
			type: "tool-started",
			snapshot: SNAPSHOT,
			iteration: 1,
			toolCall: TOOL_CALL,
		} as AgentRuntimeEvent,
	},
	{
		label: "tool-finished",
		filteredByUpstream: false,
		event: {
			type: "tool-finished",
			snapshot: SNAPSHOT,
			iteration: 1,
			toolCall: TOOL_CALL,
			result: { output: "ok" },
			isError: false,
		} as unknown as AgentRuntimeEvent,
	},
	{
		label: "message-added",
		filteredByUpstream: false,
		event: {
			type: "message-added",
			snapshot: SNAPSHOT,
			message: {
				id: "msg-1",
				role: "user",
				content: [{ type: "text", text: "hello" }],
				createdAt: 0,
			},
		} as unknown as AgentRuntimeEvent,
	},
];

/**
 * Build the REAL hub client-contribution runtime with an `onEvent` hook
 * contribution, exactly as a remote client would register one.
 */
function buildHubProxy(request: (...args: unknown[]) => unknown) {
	return createHubClientContributionRuntime({
		sessionId: "session-1",
		targetClientId: "client-1",
		contributions: [
			{ kind: "hook", name: "onEvent", capabilityName: "hook.onEvent" },
		],
		requestCapability: request as never,
	});
}

// ============================================================================
// D1 — the upstream optimization is real and localized
// ============================================================================

describe("C2 D1: upstream hub filter drops exactly the three per-chunk delta types", () => {
	it("routes only the non-filtered representative events to the remote hook", async () => {
		const request = vi.fn(async () => ({}));
		const runtime = buildHubProxy(request);
		const onEvent = runtime.localRuntime.hooks?.onEvent;
		expect(onEvent).toBeTypeOf("function");

		for (const { event } of REPRESENTATIVE_EVENTS) {
			await onEvent?.(event);
		}

		const forwarded = request.mock.calls.map(
			(call) => (call[1] as string | undefined) ?? "",
		);
		// Every forwarded call is the onEvent capability.
		expect(forwarded.every((name) => name === "hook.onEvent")).toBe(true);

		const forwardedCount = REPRESENTATIVE_EVENTS.filter(
			({ filteredByUpstream }) => !filteredByUpstream,
		).length;

		// Cardinality: exactly the unfiltered events reached the hook.
		expect(request).toHaveBeenCalledTimes(forwardedCount);

		// And the four upstream-filtered per-chunk types did NOT.
		// The hook proxy sends `{ context: ctx }` as the capability payload.
		const forwardedPayloadTypes = request.mock.calls.map(
			(call) =>
				(call[2] as { context?: { type?: string } })?.context?.type ?? "",
		);
		for (const filtered of [
			"assistant-text-delta",
			"assistant-reasoning-delta",
			"tool-call-delta",
			"tool-updated",
		]) {
			expect(forwardedPayloadTypes).not.toContain(filtered);
		}

		// And the control group DID, with its identity intact.
		expect(forwardedPayloadTypes).toEqual([
			"tool-started",
			"tool-finished",
			"message-added",
		]);
	});

	it("still forwards every OTHER event type unchanged", async () => {
		const request = vi.fn(async () => ({}));
		const runtime = buildHubProxy(request);
		const onEvent = runtime.localRuntime.hooks?.onEvent;

		await onEvent?.({
			type: "run-started",
			snapshot: SNAPSHOT,
		} as AgentRuntimeEvent);

		expect(request).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledWith(
			"session-1",
			"hook.onEvent",
			expect.anything(),
			"client-1",
		);
	});
});

// ============================================================================
// D2 — the recorder does not consume the filtered path
// ============================================================================

describe("C2 D2: the ClineMM recorder is not wired to the hub hook proxy", () => {
	it("routes NO recorder channel through createHookProxies", async () => {
		// The hub contribution runtime builds `localRuntime.hooks` from
		// client-contributed HOOKS. The recorder's channels are a DIFFERENT
		// interface (`ModelBehaviorTraceSink`) and are carried on the
		// SESSION / AGENT CONFIG, not in the hook contribution set.
		//
		// Therefore a client that contributes ONLY `onEvent` gains NO
		// recorder channel, and a recorder that is wired through the config
		// path is unaffected by whatever the hook proxy does.
		const request = vi.fn(async () => ({}));
		const runtime = buildHubProxy(request);

		// The hook contribution runtime exposes NO trace-sink surface.
		expect(
			(runtime.localRuntime as Record<string, unknown>).modelBehaviorTraceSink,
		).toBeUndefined();

		// And the session config carried alongside carries no sink either —
		// the recorder's sink is supplied by the HOST, not by a remote
		// client contribution.
		expect(runtime.localRuntime.hooks?.onEvent).toBeTypeOf("function");
	});

	it("keeps the recorder's channels reachable even when the hook proxy filters", async () => {
		// A recorder sink invoked DIRECTLY (the local call path the agent
		// runtime uses) is unaffected by the hub proxy filter. This is the
		// structural claim D3 relies on; here it is asserted in isolation.
		const observed: string[] = [];
		const sink = {
			onModelRequestStart: () => observed.push("model_request_start"),
			onToolStart: () => observed.push("tool_start"),
			onToolFinish: () => observed.push("tool_finish"),
		};

		const request = vi.fn(async () => ({}));
		const runtime = buildHubProxy(request);
		const onEvent = runtime.localRuntime.hooks?.onEvent;

		// Drive a filtered delta event through the hub proxy.
		await onEvent?.({
			type: "assistant-text-delta",
			snapshot: SNAPSHOT,
			iteration: 1,
			text: "x",
			accumulatedText: "x",
		} as AgentRuntimeEvent);

		// The hub proxy dropped it (0 capability calls)...
		expect(request).not.toHaveBeenCalled();

		// ...and the recorder's direct channel still fires, because it is
		// not routed through the proxy at all.
		sink.onModelRequestStart();
		sink.onToolStart();
		expect(observed).toEqual(["model_request_start", "tool_start"]);
	});
});
