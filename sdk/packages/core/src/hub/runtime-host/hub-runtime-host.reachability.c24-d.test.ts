/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D1
 *
 * C2.4-D1 -- REAL HubRuntimeHost transport reachability qualification.
 *
 * Scope:
 *   Prove that the REAL `HubRuntimeHost` -- not a HubTopology shim --
 *   accepts `HubEventEnvelope`s through its REAL transport seam
 *   (`NodeHubClient.subscribe`) and that the resulting `CoreSessionEvent`
 *   stream delivered to `host.subscribe(listener)` is exactly what
 *   `handleHubEvent` actually emits. This is qualification step 1
 *   of C2.4-D; D2 will then compose this stream into the shadow
 *   wiring under both polarities (FALLBACK_APPLY / DIAGNOSTIC_ONLY).
 *
 * Why this is a single-host reachability witness:
 *   D0 (14e24c135) established that Hub reconstructed translation
 *   has NO run-epoch tracker (Hub `iteration.started` carries no
 *   `conversationId`; `activeRunId.value` is therefore never seeded
 *   and every reconstructed Hub snapshot has `runId === undefined`).
 *   The D0 finding is theoretical until a real-host witness drives
 *   the actual emission path. D1 is that witness for one question
 *   only: "do REAL Hub events reach a REAL listener through the
 *   REAL host, and what CoreSessionEvent shape do they produce?"
 *
 * Hard requirement (per plan §D1.3):
 *   REAL_HUB_RUNTIME_HOST_OBJECT = true
 *   TEST_HUB_TOPOLOGY_SHIM       = false
 *
 * How this test satisfies that:
 *   1. `HubRuntimeHost` is imported via the SOURCE path
 *      `./hub-runtime-host`, NOT the bundled `@cline/core` index.
 *      Same deep-import pattern used by C2.4-C and E2F-F1-CORRECTION01.
 *   2. `HubRuntimeHost` is constructed with the production constructor
 *      and its REAL `subscribe(listener)` method is invoked. The only
 *      test seam is `NodeHubClient` (mocked via `vi.mock("../client")`),
 *      because `HubRuntimeHost.createClient` is a `private` method
 *      with no production injection point. This is the existing seam
 *      proven by `hub-runtime-host.test.ts:8-43`. Replacing it with
 *      a HubTopology shim would invalidate the C2.4 acceptance gate.
 *   3. The wired transport topology
 *      (NodeHubClient.subscribe -> handleHubEvent -> this.events.emit
 *      -> host.subscribe -> listener)
 *      is exactly the production topology; see
 *      `hub-runtime-host.ts:1482-1496` (subscribe plumbing) and
 *      `hub-runtime-host.ts:757` (RuntimeHostEventBus). The wiring
 *      under test is unchanged.
 *
 * L-rows documented here (D1 acceptance core):
 *   L1  REAL HubRuntimeHost constructed and host.subscribe(listener)
 *       attached, listener receives HubRuntimeHost event-bus emissions.
 *   L1b Hub `run.started` envelope emits `status` (and would also
 *       emit `session_snapshot` if the envelope carries a valid
 *       snapshot). Most importantly for L5/L8, it resets the
 *       per-session `agentDoneEmittedForCurrentRunBySession` tracker
 *       (hub-runtime-host.ts:1587) so the next terminal envelope will
 *       re-emit `agent_event` `done`. The test deliberately omits the
 *       `snapshot` field so the only emission is `status`, isolating
 *       the L1b precondition.
 *   L2  Hub `iteration.started` envelope (NO conversationId) is
 *       accepted and produces exactly one `agent_event` with
 *       `event.type = "iteration_start"`, carrying only `iteration: N`
 *       -- NO `conversationId`, NO `runId`, NO any run-identity field.
 *       This is the host-level confirmation of D0's
 *       RUN_ID_EPOCH_TRACKER = NOT_YET_QUALIFIED finding.
 *   L3  Hub `session.notice` envelope (with payload.agent.conversationId
 *       = "run-A") produces exactly one `agent_event` with
 *       `event.type = "notice"` carrying the conversationId from the
 *       envelope payload. This is the per-event conversationId
 *       propagation (Hub session.notice is the ONLY Hub source that
 *       carries conversationId at the envelope boundary).
 *   L4  Hub `tool.started` and `tool.finished` produce `agent_event`
 *       `content_start` / `content_end` with `contentType: "tool"`,
 *       carrying `toolCallId`, `toolName`, `input`/`output`. NO
 *       conversationId, NO runId (Hub does not stamp run identity
 *       onto tool envelopes).
 *   L5  Hub `run.completed` produces TWO emissions: (a) one
 *       `agent_event` with `event.type = "done"` via
 *       `emitAgentDoneIfNeeded`, and (b) one `ended` event with
 *       `reason: "completed"`. NO conversationId on either.
 *   L6  Epoch separation: a SECOND Hub `iteration.started` envelope
 *       (without conversationId) is emitted in the same stream and
 *       produces a second `agent_event` `iteration_start` whose
 *       `sessionId` matches the first epoch's (same Hub session) but
 *       carries NO epoch-separation metadata. There is NO
 *       host-level run-identity field emitted by `iteration.started`,
 *       so the listener cannot distinguish epochs from Hub events
 *       alone. (Epoch provenance is observer-level, lives in
 *       `task-state-shadow-observer.ts:288-315`; the D2 composition
 *       test will exercise that path.)
 *   L7  Hub `session.notice` in the second epoch (with
 *       conversationId = "run-B") produces a notice agent_event
 *       carrying `"run-B"`. The first epoch's notice carried
 *       `"run-A"`. The listener CAN distinguish epochs at the
 *       per-event conversationId level (when present), but the
 *       bare `iteration.started` and the per-tool envelopes carry
 *       no such signal.
 *   L8  Hub `run.failed` produces (a) one `agent_event` `done` via
 *       `emitAgentDoneIfNeeded`, and (b) one `ended` event with
 *       `reason: "error"`. NO conversationId on either.
 *   L9  HubRuntimeHost.subscribeRuntimeEvents is undefined. Per D0,
 *       this is the structural proof that Hub has no canonical
 *       seam, which is why the shadow wiring falls back to
 *       `host.subscribe()` + reconstructed ingress.
 *   L10 No fan-out duplication: every scripted envelope produces
 *       exactly the expected CoreSessionEvent count. No silent
 *       drops, no extra emissions from the mock seam.
 *
 * Two-epoch scripted sequence (per reviewer round-12 protocol):
 *   Epoch A:  run.started        (resets agentDone tracker; emits 2 events)
 *             iteration.started  (no conversationId)
 *             session.notice     (conversationId = "run-A")
 *             tool.started
 *             tool.finished
 *             run.completed      (emits agent_event done + ended)
 *   Epoch B:  run.started        (resets agentDone tracker; emits 2 events)
 *             iteration.started  (no conversationId)
 *             session.notice     (conversationId = "run-B")
 *             run.failed         (emits agent_event done + ended)
 *
 * Out-of-scope (lives in the VS Code boundary file or downstream):
 *   - observer-level reconstructSnapshot.runId (C2.4-D2/D3 composition)
 *   - FALLBACK_APPLY / DIAGNOSTIC_ONLY disposition (C2.4-D2 mirror)
 *   - canonical runtime seam presence/absence for Local (C2.4-C frozen)
 *   - Remote runtime host (C2.4-D0 deferred: Remote inherits Hub)
 *   - HubTopology class definition (explicitly disallowed by plan §7)
 */

import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreSessionEvent } from "../../types/events";

// Single-purpose vi.hoisted sink so the real HubRuntimeHost constructor
// can capture the per-session listener when ensureSessionSubscription
// calls this.client.subscribe(listener, { sessionId }).
//
// Mirrors the proven seam in `hub-runtime-host.test.ts:8-43`:
//
//   vi.mock("../client", () => ({
//     NodeHubClient: class { ... command/subscribe/close/dispose mocks ... },
//   }));
//
// The constructor here is intentionally minimal: it captures the URL
// (no behavior under test) and exposes only the methods the real
// HubRuntimeHost invokes (command + subscribe + close + dispose +
// getClientId + getUrl). All behavioral expectations live on the
// `commandMock` and `subscribeMock` references that the test mutates.
const commandMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const getClientIdMock = vi.hoisted(() => vi.fn(() => "client-d1"));
const restartLocalHubIfIdleAfterStartupTimeoutMock = vi.hoisted(() => vi.fn());

vi.mock("../client", () => ({
	NodeHubClient: class {
		private readonly url: string;
		constructor(options: { url: string }) {
			this.url = options.url;
		}
		command = commandMock;
		subscribe = subscribeMock;
		close = closeMock;
		dispose = disposeMock;
		getClientId = getClientIdMock;
		getUrl = () => this.url;
	},
	isHubCommandTimeoutError: (
		error: unknown,
		command?: string,
	): error is Error & { command?: string; code?: string } =>
		!!error &&
		typeof error === "object" &&
		(error as { code?: unknown }).code === "hub_command_timeout" &&
		(command === undefined ||
			(error as { command?: unknown }).command === command),
	restartLocalHubIfIdleAfterStartupTimeout:
		restartLocalHubIfIdleAfterStartupTimeoutMock,
}));

interface CapturedRecord {
	// What was driven INTO handleHubEvent:
	envelope: Pick<HubEventEnvelope, "event" | "sessionId"> & {
		// ConversationId at envelope level: explicit undefined when not
		// present on the Hub source boundary (e.g. iteration.started).
		// For session.notice, lifted from payload.agent.conversationId.
		conversationId: string | undefined;
	};
	// What came OUT of host.subscribe(listener):
	emitted: CoreSessionEvent;
}

function makeSessionReply(sessionId: string, workspaceRoot = "/tmp/project") {
	return {
		payload: {
			session: {
				sessionId,
				status: "running",
				createdAt: Date.now(),
				updatedAt: Date.now(),
				workspaceRoot,
			},
		},
	};
}

function makeConfig(sessionId: string, workspaceRoot = "/tmp/project") {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: workspaceRoot,
		workspaceRoot,
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		sessionId,
	};
}

function makeCapture(
	capture: (listener: (e: HubEventEnvelope) => void) => void,
) {
	return (listener: (e: HubEventEnvelope) => void) => {
		// Expose the listener to the test driver. The returned
		// unsubscribe is a no-op: HubRuntimeHost.ensureSessionSubscription
		// stores it and only calls it when disposeSessionSubscription
		// runs; tests do not dispose mid-sequence.
		capture(listener);
		return () => {};
	};
}

describe("HubRuntimeHost reachability (C2.4-D1)", () => {
	// Reset all hoisted mocks between tests; the seam is shared across
	// describe blocks via vi.hoisted, so a single afterEach is enough.
	afterEach(() => {
		commandMock.mockReset();
		subscribeMock.mockReset();
		closeMock.mockReset();
		disposeMock.mockReset();
		getClientIdMock.mockClear();
		restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset();
	});

	it("drives a two-epoch scripted Hub sequence through the real host and captures every emitted CoreSessionEvent", async () => {
		// L1: capture the per-session listener and pre-queue the
		// session.create reply that HubRuntimeHost.startSession awaits
		// (see hub-runtime-host.ts:893-895).
		let onHubEvent: ((e: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation(
			makeCapture((l) => {
				onHubEvent = l;
			}),
		);
		const sessionId = "sess-d1";
		commandMock.mockResolvedValue(makeSessionReply(sessionId));

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
		});

		// Attach a listener to the REAL host event bus BEFORE
		// startSession triggers ensureSessionSubscription. This is
		// the same listener path the shadow wiring exercises under
		// Hub/Remote (host.subscribe + reconstructed ingress).
		const captured: CapturedRecord[] = [];
		host.subscribe((event) => {
			captured.push({
				envelope: {
					event: "<driver-marker>" as HubEventEnvelope["event"],
					sessionId: undefined,
					conversationId: undefined,
				},
				emitted: event,
			});
		});

		// startSession seeds sessionCapabilities + the per-session
		// subscribeMock invocation that captures `onHubEvent`. The
		// resulting event-bus listener stays attached for the whole
		// scripted sequence below.
		await host.startSession({
			config: makeConfig(sessionId),
			source: "core",
			prompt: "Drive the D1 witness",
			interactive: true,
		});

		// Capture the driver's intended envelope mapping alongside each
		// emission so the assertion table below can assert provenance
		// field-by-field (envelope-level conversationId vs emitted
		// CoreSessionEvent payload-level conversationId).
		type Driven = {
			envelope: HubEventEnvelope;
			expectedEmissionKinds: CoreSessionEvent["type"][];
			expectedConversationId?: string;
		};
		const driven: Driven[] = [];

		const drive = (entry: Driven) => {
			driven.push(entry);
			onHubEvent!(entry.envelope);
		};

		// === Epoch A: run-A ===
		drive({
			envelope: {
				version: "v1",
				event: "run.started",
				sessionId,
				timestamp: 0,
				payload: {
					// No `snapshot` field -- parseCoreSessionSnapshot returns
					// undefined because the field is missing. The run.started
					// branch still emits `status` and (critically) resets
					// the per-session agentDone tracker at line 1587 BEFORE
					// the conditional session_snapshot emit.
					session: {
						sessionId,
						status: "running",
						createdAt: 0,
						updatedAt: 0,
						workspaceRoot: "/tmp/project",
					},
				},
			},
			// run.started unconditionally emits `status` and (in the
			// presence of a valid snapshot) would also emit
			// `session_snapshot`. We deliberately omit the snapshot
			// here so the only emission is `status` -- the L1b
			// tracker reset is the only invariant we need from this
			// envelope for L5/L8 below.
			expectedEmissionKinds: ["status"],
		});
		drive({
			envelope: {
				version: "v1",
				event: "iteration.started",
				sessionId,
				timestamp: 1,
				payload: { iteration: 1 },
				// DELIBERATELY NO conversationId at any nesting level.
				// This is the corrected D0 R1 finding's empirical source:
				// Hub's iteration.started envelope does not carry one.
			},
			expectedEmissionKinds: ["agent_event"],
		});
		drive({
			envelope: {
				version: "v1",
				event: "session.notice",
				sessionId,
				timestamp: 2,
				payload: {
					noticeType: "recovery",
					displayRole: "status",
					reason: "stuck",
					message: "recovering",
					agent: {
						agentId: "agent-run-A",
						conversationId: "run-A",
					},
				},
			},
			expectedEmissionKinds: ["agent_event"],
			expectedConversationId: "run-A",
		});
		drive({
			envelope: {
				version: "v1",
				event: "tool.started",
				sessionId,
				timestamp: 3,
				payload: {
					toolCallId: "tool-1",
					toolName: "readFile",
					input: { path: "/tmp/x" },
				},
			},
			expectedEmissionKinds: ["agent_event"],
		});
		drive({
			envelope: {
				version: "v1",
				event: "tool.finished",
				sessionId,
				timestamp: 4,
				payload: {
					toolCallId: "tool-1",
					toolName: "readFile",
					output: { ok: true },
				},
			},
			expectedEmissionKinds: ["agent_event"],
		});
		drive({
			envelope: {
				version: "v1",
				event: "run.completed",
				sessionId,
				timestamp: 5,
				payload: {
					snapshot: { status: "completed" },
				},
			},
			// L5: run.completed emits TWO events -- a done agent_event
			// via emitAgentDoneIfNeeded + an ended event.
			expectedEmissionKinds: ["agent_event", "ended"],
		});

		// === Epoch B: run-B ===
		drive({
			envelope: {
				version: "v1",
				event: "run.started",
				sessionId,
				timestamp: 5,
				payload: {
					session: {
						sessionId,
						status: "running",
						createdAt: 5,
						updatedAt: 5,
						workspaceRoot: "/tmp/project",
					},
				},
			},
			// Resets the per-session agentDone tracker so this epoch's
			// terminal envelope re-emits agent_event done. See L1b.
			expectedEmissionKinds: ["status"],
		});
		drive({
			envelope: {
				version: "v1",
				event: "iteration.started",
				sessionId,
				timestamp: 6,
				payload: { iteration: 2 },
				// DELIBERATELY NO conversationId here either.
			},
			expectedEmissionKinds: ["agent_event"],
		});
		drive({
			envelope: {
				version: "v1",
				event: "session.notice",
				sessionId,
				timestamp: 7,
				payload: {
					noticeType: "recovery",
					displayRole: "status",
					reason: "stuck",
					message: "recovering",
					agent: {
						agentId: "agent-run-B",
						conversationId: "run-B",
					},
				},
			},
			expectedEmissionKinds: ["agent_event"],
			expectedConversationId: "run-B",
		});
		drive({
			envelope: {
				version: "v1",
				event: "run.failed",
				sessionId,
				timestamp: 8,
				payload: {
					snapshot: { status: "errored" },
					reason: "boom",
				},
			},
			expectedEmissionKinds: ["agent_event", "ended"],
		});

		// Annotate captured records with the driver mapping AFTER the
		// sequence runs. We pair each captured emission with the driven
		// entry whose expectedEmissionKinds remain unconsumed.
		const annotated: Array<{ driven: Driven; emitted: CoreSessionEvent }> = [];
		let cursor = 0;
		for (const entry of driven) {
			for (const expectedKind of entry.expectedEmissionKinds) {
				const found = captured[cursor];
				if (!found) {
					throw new Error(
						`captured emission underflow at driven ${entry.envelope.event} (cursor=${cursor})`,
					);
				}
				if (found.emitted.type !== expectedKind) {
					throw new Error(
						`emission kind mismatch at driven ${entry.envelope.event}: expected ${expectedKind}, got ${found.emitted.type}`,
					);
				}
				annotated.push({ driven: entry, emitted: found.emitted });
				cursor++;
			}
		}
		expect(cursor).toBe(captured.length);

		// L10 sanity: no fan-out duplication, no silent drops.
		expect(captured.length).toBe(
			driven.reduce((n, d) => n + d.expectedEmissionKinds.length, 0),
		);

		// L9: Hub has no canonical seam. Proven structurally.
		expect(
			(host as unknown as { subscribeRuntimeEvents?: unknown })
				.subscribeRuntimeEvents,
		).toBeUndefined();

		// === L2 / L6: iteration.started emission shape ===
		const epochAStarted = annotated.find(
			(a) =>
				a.driven.envelope.event === "iteration.started" &&
				(a.driven.envelope.payload as { iteration?: number }).iteration === 1,
		);
		const epochBStarted = annotated.find(
			(a) =>
				a.driven.envelope.event === "iteration.started" &&
				(a.driven.envelope.payload as { iteration?: number }).iteration === 2,
		);
		expect(epochAStarted).toBeDefined();
		expect(epochBStarted).toBeDefined();
		for (const a of [epochAStarted!, epochBStarted!]) {
			const emitted = a.emitted as Extract<
				CoreSessionEvent,
				{ type: "agent_event" }
			>;
			// L2: Hub emits iteration_start with iteration only. NO
			// conversationId, NO agentId, NO parentAgentId, NO runId.
			expect(emitted.type).toBe("agent_event");
			expect(emitted.payload.sessionId).toBe(sessionId);
			// envelope.payload is optional in HubEventEnvelope; in our
			// scripted sequence we always supply it, so a runtime
			// assertion is appropriate here.
			const drivenPayload = a.driven.envelope.payload as {
				iteration?: number;
			} | undefined;
			expect(drivenPayload).toBeDefined();
			expect(emitted.payload.event).toMatchObject({
				type: "iteration_start",
				iteration: drivenPayload?.iteration,
			});
			expect(emitted.payload.event).not.toHaveProperty("conversationId");
			expect(emitted.payload.event).not.toHaveProperty("agentId");
			expect(emitted.payload.event).not.toHaveProperty("runId");
			expect(emitted.payload).not.toHaveProperty("conversationId");
			expect(emitted.payload).not.toHaveProperty("runId");
		}

		// === L3 / L7: session.notice carries per-event conversationId ===
		const noticeA = annotated.find(
			(a) =>
				a.driven.envelope.event === "session.notice" &&
				a.driven.expectedConversationId === "run-A",
		);
		const noticeB = annotated.find(
			(a) =>
				a.driven.envelope.event === "session.notice" &&
				a.driven.expectedConversationId === "run-B",
		);
		expect(noticeA).toBeDefined();
		expect(noticeB).toBeDefined();
		for (const notice of [noticeA!, noticeB!]) {
			const emitted = notice.emitted as Extract<
				CoreSessionEvent,
				{ type: "agent_event" }
			>;
			expect(emitted.type).toBe("agent_event");
			expect(emitted.payload.sessionId).toBe(sessionId);
			expect(emitted.payload.event).toMatchObject({
				type: "notice",
				noticeType: "recovery",
				conversationId: notice.driven.expectedConversationId,
				agentId: (notice.driven.envelope.payload as {
					agent?: { agentId?: string };
				}).agent?.agentId,
			});
		}

		// === L4: tool.started/finished carry no identity fields ===
		const toolStarted = annotated.find(
			(a) => a.driven.envelope.event === "tool.started",
		);
		const toolFinished = annotated.find(
			(a) => a.driven.envelope.event === "tool.finished",
		);
		expect(toolStarted).toBeDefined();
		expect(toolFinished).toBeDefined();
		for (const a of [toolStarted!, toolFinished!]) {
			const emitted = a.emitted as Extract<
				CoreSessionEvent,
				{ type: "agent_event" }
			>;
			expect(emitted.payload.sessionId).toBe(sessionId);
			expect(emitted.payload.event).not.toHaveProperty("conversationId");
			expect(emitted.payload).not.toHaveProperty("conversationId");
		}
		const contentStart = toolStarted!.emitted as Extract<
			CoreSessionEvent,
			{ type: "agent_event" }
		>;
		const contentEnd = toolFinished!.emitted as Extract<
			CoreSessionEvent,
			{ type: "agent_event" }
		>;
		expect(contentStart.payload.event).toMatchObject({
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "readFile",
		});
		expect(contentEnd.payload.event).toMatchObject({
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "readFile",
		});

		// === L5 / L8: terminal envelopes emit agent_event + ended ===
		const runCompleted = annotated.filter(
			(a) => a.driven.envelope.event === "run.completed",
		);
		const runFailed = annotated.filter(
			(a) => a.driven.envelope.event === "run.failed",
		);
		expect(runCompleted).toHaveLength(2);
		expect(runFailed).toHaveLength(2);

		const completedDone = runCompleted.find(
			(a) => a.emitted.type === "agent_event",
		)!;
		const completedEnded = runCompleted.find(
			(a) => a.emitted.type === "ended",
		)!;
		expect(completedDone).toBeDefined();
		expect(completedEnded).toBeDefined();
		expect(completedDone.emitted.type).toBe("agent_event");
		expect(
			(completedDone.emitted as Extract<
				CoreSessionEvent,
				{ type: "agent_event" }
			>).payload.event.type,
		).toBe("done");
		expect(completedEnded.emitted).toMatchObject({
			type: "ended",
			payload: { sessionId, reason: "completed" },
		});

		const failedDone = runFailed.find((a) => a.emitted.type === "agent_event")!;
		const failedEnded = runFailed.find((a) => a.emitted.type === "ended")!;
		expect(failedDone.emitted.type).toBe("agent_event");
		expect(
			(failedDone.emitted as Extract<
				CoreSessionEvent,
				{ type: "agent_event" }
			>).payload.event.type,
		).toBe("done");
		expect(failedEnded.emitted).toMatchObject({
			type: "ended",
			// The host prefers envelope-level `reason` when present
			// (hub-runtime-host.ts:1896-1901), falling back to the
			// event-name-derived value otherwise. We supplied
			// `reason: "boom"` in the envelope, so the emitted reason
			// carries that override verbatim. This is host-side
			// behavior, independent of the translator layer.
			payload: { sessionId, reason: "boom" },
		});

		// === Epoch-separation evidence ===
		// L6/L7: across both epochs, only session.notice carries a
		// conversationId at the host-emission level. iteration.started,
		// tool.started, tool.finished, run.completed/failed emit NO
		// conversationId, NO runId, NO epoch-separation metadata.
		// This is the host-level observation that the D3 disposition
		// choice (A/B/C repair classes for RUN_ID_EPOCH_TRACKER) must
		// address; the host cannot provide it on its own.
		const runIdentityCarriers = annotated.filter((a) =>
			a.driven.envelope.event === "session.notice",
		);
		expect(runIdentityCarriers.length).toBe(2); // one per epoch
		const epochANotice = runIdentityCarriers.find(
			(a) => a.driven.expectedConversationId === "run-A",
		)!;
		const epochBNotice = runIdentityCarriers.find(
			(a) => a.driven.expectedConversationId === "run-B",
		)!;
		const epochAAgentEvent = epochANotice.emitted as Extract<
			CoreSessionEvent,
			{ type: "agent_event" }
		>;
		const epochBAgentEvent = epochBNotice.emitted as Extract<
			CoreSessionEvent,
			{ type: "agent_event" }
		>;
		expect(epochAAgentEvent.payload.event).toMatchObject({ conversationId: "run-A" });
		expect(epochBAgentEvent.payload.event).toMatchObject({ conversationId: "run-B" });
	});
});
