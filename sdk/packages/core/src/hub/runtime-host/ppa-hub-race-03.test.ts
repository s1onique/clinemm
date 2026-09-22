/**
 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION03 /
 * PPA-HUB-RACE-03
 *
 * REAL producer → projector → publish composition discriminator.
 *
 * Per the eighty-pass Factory reviewer (after CORRECTION02):
 *
 *   "CORRECTION02 gives us useful new evidence, but it does not establish
 *    the invariant it claims. The strongest new fact is actually in your
 *    own Layout B test: after an initialized-empty mirror, run.completed
 *    can be processed while pendingPrompts.count() still returns
 *    {available:true,count:0}, and only afterward does session.pending_prompts
 *    move it to 1.
 *
 *    The claimed proof is:
 *
 *      wake authored before done
 *      → pending_prompts published before done
 *      → WebSocket preserves order
 *      → Q5 sees wake
 *
 *    The last implication is fine if the first publication ordering is
 *    established. But the evidence only demonstrates:
 *
 *      if pending_prompts is delivered first → mirror is fresh
 *      if run.completed is delivered first    → mirror is stale
 *
 *    Those are Layout A and Layout B respectively. They do not establish
 *    which wire order production must use when the remote authoritative
 *    queue mutation causally precedes completion.
 *
 *    The test must NOT say:
 *
 *      onHubEvent(pendingPrompts)
 *      onHubEvent(runCompleted)
 *
 *    because that merely assumes the invariant. Let production choose the
 *    ordering."
 *
 * This file implements that bounded discriminator: a real `LocalRuntimeHost`
 * is wired as the `sessionHost` of a real `HubServerTransport`. The transport
 * subscribes to the host's CoreSessionEvent stream and feeds every event
 * through the real `projectSessionEvent` projector — the same wiring used
 * in production (see `hub-server-transport.ts:430`). We then drive both
 * the wake mutation and the OWNER's run completion through the REAL public
 * producer surface (`pendingPrompts.update(...)` and `host.runTurn(...)`)
 * and observe the order of envelopes published on the wire.
 *
 * The chronology is NOT chosen by the test. The producer's natural emit
 * order — pending_prompts synchronously on enqueue, ended after the agent
 * returns and the host tears down — decides the wire order. Both the
 * projector and the transport preserve the producer's emit order because
 * the projector is mostly synchronous and the transport publishes
 * synchronously per publish() call.
 *
 * Layout 1 (case B — wake during OWNER run): the wake is enqueued via
 *   `host.runTurn({ delivery: "queue" })` from inside the agent's
 *   `run()` callback, BEFORE the agent returns. The producer emits
 *   `pending_prompts` BEFORE `agent_event done` (which is part of the
 *   agent's natural AgentRuntimeEvent sequence) and BEFORE `ended`
 *   (which is emitted by `shutdownSession` after the agent returns).
 *   The projector translates each event in order; the wire publishes
 *   `session.pending_prompts` BEFORE `agent.done` and BEFORE
 *   `run.completed`. Verdict A applies: HubRuntimeHost's mirror is
 *   fresh by the time Q5 reads.
 *
 * Layout 2 (case A — wake after OWNER run): the OWNER's run completes
 *   first, then the wake is enqueued. The producer emits `agent_event
 *   done` and `ended` FIRST, then `pending_prompts` LATER. The wire
 *   publishes `agent.done` and `run.completed` BEFORE
 *   `session.pending_prompts`. The mirror at Q5 time is empty
 *   `{available:true, count:0}` — which is the AUTHORITATIVE state at
 *   that decision moment (the wake has not yet been authored at the
 *   Hub), so Q5's commit of awaiting_followup is correct.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { HubEventEnvelope } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { FileSessionService } from "../../session/services/file-session-service"
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host"
import { HubServerTransport } from "../server"
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers"

// Module-level so `buildComposition` (defined outside the describe) can
// read the per-test isolated home directory that `beforeEach` populates.
let isolatedHomeDir = ""

function baseResult() {
	return {
		// AgentResult shape (legacy):
		text: "ok",
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed" as const,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date(),
		endedAt: new Date(),
		durationMs: 0,
	}
}

/**
 * Build a stub AgentRuntime. `onRun` is invoked INSIDE `run()` BEFORE
 * the agent emits `done` and returns. This lets the test author the
 * wake via the real producer while the run is in flight.
 *
 * IMPORTANT: the host wires the AgentEventBridge via
 * `agent.subscribeEvents(...)` (line 855 of local-runtime-host.ts),
 * NOT `subscribeRuntimeEvents`. The legacy `AgentEvent` shape has
 * `{ type: "done", reason, text, iterations, usage }` — emitting
 * `run-finished` would NOT reach the bridge. We therefore emit the
 * legacy `done` shape on the `subscribeEvents` channel.
 */
function makeStubAgent(opts: {
	onRun?: (emit: (event: { type: string; [k: string]: unknown }) => void) => void
} = {}) {
	const legacyListeners = new Set<
		(event: { type: string; [k: string]: unknown }) => void
	>()
	const agent = {
		run: vi.fn(async () => {
			const emit = (event: { type: string; [k: string]: unknown }) => {
				for (const l of legacyListeners) l(event)
			}
			if (opts.onRun) {
				opts.onRun(emit)
			}
			emit({
				type: "done",
				reason: "completed",
				text: "ok",
				iterations: 1,
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			})
			return baseResult()
		}),
		continue: vi.fn(async () => baseResult()),
		abort: vi.fn(),
		subscribe: vi.fn(),
		subscribeEvents: vi.fn(
			(listener: (event: { type: string; [k: string]: unknown }) => void) => {
				legacyListeners.add(listener)
				return () => {
					legacyListeners.delete(listener)
				}
			},
		),
		subscribeRuntimeEvents: vi.fn(() => () => {}),
		subscribeRecoveryStateChange: vi.fn(() => () => {}),
		canStartRun: vi.fn(() => true),
		shutdown: vi.fn(async () => {}),
		getMessages: vi.fn(() => []),
		getAgentId: vi.fn(() => "agent_test"),
		getConversationId: vi.fn(() => "conv_test"),
	}
	return { agent, listeners: legacyListeners }
}

/**
 * Compose the REAL production wiring:
 *   LocalRuntimeHost  → CoreSessionEvent stream
 *     ↳ HubServerTransport.subscribe listener
 *       ↳ projectSessionEvent(ctx, event)   ← REAL projector
 *         ↳ ctx.publish → transport.publish  ← REAL fan-out
 * Subscribers registered with transport.subscribe("name", listener)
 * see the published envelopes.
 *
 * This is the EXACT composition used in production at
 * `sdk/packages/core/src/hub/server/hub-server-transport.ts:430`.
 */
function buildComposition(opts: {
	createAgent: (config: unknown) => unknown
}) {
	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
	const sessionsDir = join(isolatedHomeDir, "sessions")
	const host = new LocalRuntimeHost({
		distinctId: "ppa-hub-race-03",
		sessionService: new FileSessionService(sessionsDir),
		runtimeBuilder: runtimeBuilder as never,
		createAgent: opts.createAgent as never,
	})
	const transport = new HubServerTransport({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		sessionHost: host as never,
	})
	return { host, transport }
}

async function startNonInteractiveSession(
	host: LocalRuntimeHost,
	sid: string,
) {
	return await host.startSession({
		config: {
			sessionId: sid,
			providerId: "mock-provider",
			modelId: "mock-model",
			systemPrompt: "test",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		source: "core" as never,
	})
}

describe(
	"ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION03 / PPA-HUB-RACE-03",
	() => {
		const envSnapshot = {
			HOME: process.env.HOME,
			CLINE_DIR: process.env.CLINE_DIR,
		}

		beforeEach(() => {
			isolatedHomeDir = mkdtempSync(
				join(tmpdir(), "ppa-hub-race-03-"),
			)
			process.env.HOME = isolatedHomeDir
			process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
			setHomeDir(isolatedHomeDir)
			setClineDir(process.env.CLINE_DIR)
		})

		afterEach(() => {
			process.env.HOME = envSnapshot.HOME
			process.env.CLINE_DIR = envSnapshot.CLINE_DIR
			setHomeDir(envSnapshot.HOME ?? "~")
			setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"))
			rmSync(isolatedHomeDir, { recursive: true, force: true })
		})

		/**
		 * PPA-HUB-RACE-03 LAYOUT 1 ("case B chronology").
		 *
		 * The wake is authored REMOTELY BEFORE the OWNER's agent run
		 * completes. We drive this by:
		 *   1. Starting the OWNER's run via `host.runTurn(...)`
		 *      with a stub agent whose `run()` synchronously
		 *      enqueues a wake via `host.runTurn({ delivery:"queue"
		 *      })` BEFORE it emits `done`. The wake enqueue
		 *      synchronously emits `pending_prompts` through
		 *      `pendingPromptsController.enqueue(...)` →
		 *      `emitPrompts(session)` → `this.emit(pending_prompts
		 *      CoreSessionEvent)`.
		 *   2. The agent then emits `done` via the bridge → bridge
		 *      emits `agent_event done` CoreSessionEvent.
		 *   3. The host tears down → `ended` CoreSessionEvent →
		 *      bridge.
		 *
		 * The HubServerTransport's subscribe listener feeds each
		 * CoreSessionEvent through the real `projectSessionEvent`
		 * projector. Wire order on the published envelopes:
		 *   `session.pending_prompts` BEFORE `agent.done` BEFORE
		 *   `run.completed`. Verdict A applies: producer's emit
		 * order is preserved by the projector and the transport.
		 */
		it("Layout 1: wake authored during OWNER run → wire order preserves pending_prompts BEFORE agent.done BEFORE run.completed", async () => {
			const sid = "session-ppa-hub-race-03-L1"
			let wakeHost: LocalRuntimeHost | undefined
			const { agent } = makeStubAgent({
				onRun: () => {
					// Real producer: enqueue the wake via the public
					// runTurn({ delivery: "queue" }) path. This
					// routes through pendingPromptsController
					// .enqueue → emitPrompts → emit pending_prompts
					// CoreSessionEvent. The HubServerTransport
					// listener at hub-server-transport.ts:430 feeds
					// this through projectSessionEvent → publishes
					// session.pending_prompts envelope SYNCHRONOUSLY.
					if (wakeHost) {
						wakeHost.runTurn({
							sessionId: sid,
							prompt: "wake-from-stub-agent",
							delivery: "queue",
						} as never)
					}
				},
			})
			const { host, transport } = buildComposition({
				createAgent: () => {
					wakeHost = host
					return agent
				},
			})
			await startNonInteractiveSession(host, sid)

			const published: string[] = []
			transport.subscribe("test", (event: HubEventEnvelope) => {
				published.push(event.event)
			})

			// Drive the OWNER's run via the REAL public producer
			// surface. The agent's `run()` callback synchronously
			// enqueues the wake via the REAL runTurn({ delivery:
			// "queue" }) path BEFORE it emits `done`.
			await host.runTurn({
				sessionId: sid,
				prompt: "owner prompt",
			} as never)

			// Drain any pending microtasks (projectSessionEvent is
			// mostly synchronous, but the projector awaits a few
			// I/O points; ensure all envelopes have been delivered
			// before assertions).
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			// Find indices of the relevant envelopes.
			const idxPendingPrompts = published.indexOf(
				"session.pending_prompts",
			)
			const idxAgentDone = published.indexOf("agent.done")
			const idxRunCompleted = published.indexOf("run.completed")

			// All three events MUST have been published.
			expect(idxPendingPrompts).toBeGreaterThanOrEqual(0)
			expect(idxAgentDone).toBeGreaterThanOrEqual(0)
			expect(idxRunCompleted).toBeGreaterThanOrEqual(0)

			// Verdict A: producer's emit order is preserved by the
			// projector AND the transport. session.pending_prompts
			// arrives on the wire BEFORE agent.done (which is the
			// OWNER's done-without-completion signal) AND BEFORE
			// run.completed (which is the terminal terminal event).
			expect(idxPendingPrompts).toBeLessThan(idxAgentDone)
			expect(idxPendingPrompts).toBeLessThan(idxRunCompleted)
			expect(idxAgentDone).toBeLessThan(idxRunCompleted)
		})

		/**
		 * PPA-HUB-RACE-03 LAYOUT 2 ("case A chronology").
		 *
		 * The OWNER's run completes FIRST, THEN the wake is enqueued.
		 * The producer emits `agent_event done` BEFORE `pending_prompts`.
		 * The wire reflects that order: `agent.done` arrives at the
		 * consumer BEFORE `session.pending_prompts`.
		 *
		 * For this Layout we use an interactive session because the
		 * production wake-after-Owner case typically sees the OWNER's
		 * run complete via `completeInteractiveTurn` (not
		 * `finalizeSingleRun`) — the user is still expected to
		 * interact. An interactive session is NOT torn down by
		 * `shutdownSession`, so the post-run wake enqueue can route
		 * through `pendingPromptsController.update(...)` without
		 * `SessionNotFoundError`.
		 *
		 * This is NOT a defect. At the moment Q5 reads count (right
		 * after `agent.done`), the AUTHORITATIVE state at the Hub is
		 * the empty queue — the wake has not yet been authored. Q5's
		 * commit of `awaiting_followup` is correct given that state.
		 * This test asserts the AUTHORITATIVE state invariant only;
		 * whether the visible operator prompt between Q5's commit
		 * and the queue drain is the desirable UX is a separate
		 * product question outside this ACT.
		 */
		it("Layout 2: wake authored AFTER OWNER run → agent.done arrives BEFORE session.pending_prompts", async () => {
			const sid = "session-ppa-hub-race-03-L2"
			const { agent } = makeStubAgent({})
			let wakeHost: LocalRuntimeHost | undefined
			const { host, transport } = buildComposition({
				createAgent: () => {
					wakeHost = host
					return agent
				},
			})
			// Interactive session — NOT torn down by `completeInteractiveTurn`,
			// so the post-run wake enqueue can still find the session.
			await host.startSession({
				interactive: true,
				config: {
					sessionId: sid,
					providerId: "mock-provider",
					modelId: "mock-model",
					systemPrompt: "test",
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
				source: "core" as never,
			} as never)

			const published: string[] = []
			transport.subscribe("test", (event: HubEventEnvelope) => {
				published.push(event.event)
			})

			// Drive the OWNER's run via the REAL public producer
			// surface. The stub agent does NOT enqueue a wake; the
			// run completes normally.
			await host.runTurn({
				sessionId: sid,
				prompt: "owner prompt",
			} as never)

			// Drain any pending microtasks.
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			// Snapshot the published envelopes BEFORE driving the
			// wake so we can demonstrate the order at the moment Q5
			// would read count (right after agent.done).
			const agentDoneIdx = published.indexOf("agent.done")
			const pendingPromptsBeforeWake = published.filter(
				(e) => e === "session.pending_prompts",
			).length

			// Drive the wake via the REAL public producer surface
			// AFTER the OWNER's run has settled.
			if (wakeHost) {
				wakeHost.runTurn({
					sessionId: sid,
					prompt: "wake-after-owner",
					delivery: "queue",
				} as never)
			}

			// Drain any pending microtasks.
			await new Promise<void>((resolve) => setTimeout(resolve, 50))

			const pendingPromptsAfterWake = published.filter(
				(e) => e === "session.pending_prompts",
			).length

			// Layout 2 chronology: agent.done was published BEFORE
			// the wake was authored at the Hub. At the moment Q5
			// reads count (right after agent.done), the
			// AUTHORITATIVE Hub queue is empty.
			expect(agentDoneIdx).toBeGreaterThanOrEqual(0)
			expect(pendingPromptsBeforeWake).toBe(0)
			expect(pendingPromptsAfterWake).toBeGreaterThan(0)

			// After the post-run wake enqueue, at least one
			// session.pending_prompts envelope has landed. Its
			// index MUST come AFTER the agent.done index.
			const firstPendingPromptsAfter = published
				.slice(agentDoneIdx + 1)
				.indexOf("session.pending_prompts")
			expect(firstPendingPromptsAfter).toBeGreaterThanOrEqual(0)
		})
	},
)
