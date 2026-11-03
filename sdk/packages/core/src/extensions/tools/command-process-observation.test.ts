/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01 — RED-01/03/04.
 *
 * Per-command process-outcome observations at the REAL `createShellTool` seam.
 *
 * WHAT THIS WITNESS DRIVES
 * ------------------------
 * The real `createShellTool` (the production `run_commands` tool) with a
 * deterministic INJECTED executor, so the per-command fanout, the positional
 * result array, and the per-command context are the production ones.
 *
 * THE DEFECT
 * ----------
 * A `run_commands` invocation executes N commands concurrently and returns N
 * POSITIONAL results. The recorder observes only `tool_finish.outcome`, which
 * is a SINGLE aggregate for the whole tool call. A batch whose command 0 exits
 * 0 and whose command 1 exits 3 produces exactly ONE observable outcome at
 * the trace boundary, so the individual process results are LOST.
 *
 * The witness therefore requires the trace boundary to carry ONE process
 * observation PER COMMAND, correlated by `(sessionId, toolCallId,
 * commandIndex)`.
 *
 * These witnesses are RED→GREEN: they fail against the pre-bridge recorder
 * and pass once the process-observation bridge exists.
 */

import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createShellTool } from "./definitions";
import {
	isCommandProcessObservationChannelPresent,
	reportCommandProcessObservation,
} from "./executors/command-process-observation";

/**
 * One captured process observation, with its envelope identity.
 *
 * Hoisted to module scope so the CORRECTION01 witnesses (which live in their
 * own `describe`) can use the same shape.
 */
type Observation = {
	sessionId?: string;
	runId?: string;
	payload: Record<string, unknown>;
};

describe("createShellTool — per-command process observations", () => {
	/**
	 * Build the runtime-owned tool context the production runtime hands to a
	 * tool executor, including the trace sink and the correlation identity
	 * the runtime stamps onto `context.metadata`.
	 */
	function makeContext(observations: Observation[]): AgentToolContext {
		return {
			agentId: "agent-1",
			sessionId: "session-1",
			runId: "run_abcdefgh",
			iteration: 3,
			toolCallId: "call-1",
			metadata: {
				__clineModelBehaviorTraceSink: {
					onProcessObservation: (observation: Observation) => {
						observations.push(observation);
					},
				},
				__clineModelBehaviorTraceIdentity: {
					sessionId: "session-1",
					runId: "run_abcdefgh",
					toolCallId: "call-1",
				},
			},
		};
	}

	it("RED-01: records one DISTINCT process observation per command in a mixed-outcome batch", async () => {
		const observations: Observation[] = [];
		// A deterministic injected executor that acts as the PROCESS
		// AUTHORITY — exactly the role the production host executor plays.
		// Command 0 exits 0, command 1 exits 3.
		const execute = vi.fn(
			async (
				command: string | { command: string },
				_cwd: string,
				context: AgentToolContext,
			) => {
				const text = typeof command === "string" ? command : command.command;
				if (text === "cmd-a") {
					reportCommandProcessObservation(
						context.metadata,
						{ terminalState: "exited", exitCode: 0 },
						"foreground",
						"foreground_terminal_completion",
					);
					return "a-ok";
				}
				reportCommandProcessObservation(
					context.metadata,
					{ terminalState: "exited", exitCode: 3 },
					"foreground",
					"foreground_terminal_completion",
				);
				const error = new Error("Command exited with code 3") as Error & {
					exitCode?: number;
				};
				error.exitCode = 3;
				throw error;
			},
		);

		const tool = createShellTool(execute as never);
		const result = await tool.execute(
			{ commands: ["cmd-a", "cmd-b"] } as never,
			makeContext(observations),
		);

		// The production positional result array is UNCHANGED by the bridge:
		// two commands, two positional entries, distinct success flags.
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(2);
		expect(result[0]?.success).toBe(true);
		expect(result[1]?.success).toBe(false);

		// The RECORDER must see BOTH process results distinctly — NOT one
		// collapsed aggregate outcome for the tool call.
		expect(observations.length).toBe(2);

		const byIndex = new Map<number, Observation>();
		for (const observation of observations) {
			byIndex.set(observation.payload.commandIndex as number, observation);
		}

		expect(byIndex.get(0)?.payload).toMatchObject({
			commandIndex: 0,
			toolCallId: "call-1",
			terminalState: "exited",
			exitCode: 0,
		});
		expect(byIndex.get(1)?.payload).toMatchObject({
			commandIndex: 1,
			toolCallId: "call-1",
			terminalState: "exited",
			exitCode: 3,
		});
		// The session/run identity travels on the observation ENVELOPE — the
		// same place the recorder's other events carry it — so the record
		// is correlatable by the recorder's own identity rules.
		expect(byIndex.get(0)?.sessionId).toBe("session-1");
		expect(byIndex.get(0)?.runId).toBe("run_abcdefgh");
		expect(byIndex.get(1)?.sessionId).toBe("session-1");
		expect(byIndex.get(1)?.runId).toBe("run_abcdefgh");
	});

	it("RED-03: records an EXPLICIT unknown exit status when no exit code was observed", async () => {
		const observations: Observation[] = [];
		// The executor completes WITHOUT an exit code — the shell integration
		// did not report one. The observation must be `unknown`, NEVER 0.
		const execute = vi.fn(
			async (
				_command: string | { command: string },
				_cwd: string,
				context: AgentToolContext,
			) => {
				reportCommandProcessObservation(
					context.metadata,
					{ terminalState: "unknown" },
					"foreground",
					"foreground_terminal_completion",
				);
				return "completed-without-exit-code";
			},
		);

		const tool = createShellTool(execute as never);
		await tool.execute(
			{ commands: ["cmd-unknown"] } as never,
			makeContext(observations),
		);

		expect(observations).toHaveLength(1);
		expect(observations[0]?.payload).toMatchObject({
			commandIndex: 0,
			terminalState: "unknown",
		});
		expect(observations[0]?.payload.exitCode).toBeUndefined();
	});

	it("RED-04: concurrent invocations with OVERLAPPING command indices never cross owners", async () => {
		const observations: Observation[] = [];
		const execute = vi.fn(
			async (
				_command: string | { command: string },
				_cwd: string,
				context: AgentToolContext,
			) => {
				reportCommandProcessObservation(
					context.metadata,
					{ terminalState: "exited", exitCode: 0 },
					"foreground",
					"foreground_terminal_completion",
				);
				return "ok";
			},
		);

		const tool = createShellTool(execute as never);

		const contextA = makeContext(observations);
		const contextB = makeContext(observations);
		contextB.toolCallId = "call-2";
		contextB.metadata = {
			...contextB.metadata,
			__clineModelBehaviorTraceIdentity: {
				sessionId: "session-1",
				runId: "run_abcdefgh",
				toolCallId: "call-2",
			},
		};

		await Promise.all([
			tool.execute({ commands: ["x", "y"] } as never, contextA),
			tool.execute({ commands: ["p", "q"] } as never, contextB),
		]);

		expect(observations).toHaveLength(4);
		const ownerOf = (index: number): Set<string> =>
			new Set(
				observations
					.filter((observation) => observation.payload.commandIndex === index)
					.map((observation) => observation.payload.toolCallId as string),
			);
		// commandIndex 0 belongs to BOTH owners (overlapping positional
		// indices) — the correlation key is (session, toolCallId, index).
		expect(ownerOf(0)).toEqual(new Set(["call-1", "call-2"]));
		expect(ownerOf(1)).toEqual(new Set(["call-1", "call-2"]));
		for (const observation of observations) {
			expect(observation.sessionId).toBe("session-1");
			expect(["call-1", "call-2"]).toContain(observation.payload.toolCallId);
		}
	});
});

/**
 * ACT-CLINEMM-COMMAND-PROCESS-OUTCOME-TRACE-BRIDGE01-CORRECTION01.
 *
 * The DISABLED-PATH CONTEXT NEUTRALITY witnesses.
 *
 * THE DEFECT THIS CORRECTION FIXES
 * --------------------------------
 * BRIDGE01 stamped the per-command positional index
 * (`COMMAND_PROCESS_OBSERVATION_INDEX_METADATA_KEY`) onto the per-command
 * tool context UNCONDITIONALLY — including when tracing was OFF. That was an
 * UNCONDITIONAL production-context delta: the executor received a context
 * object (with a new `metadata` identity and a new key) that the predecessor
 * never produced, contradicting the frozen disabled-path neutrality contract.
 *
 * CORRECTION01 makes the stamp CONDITIONAL on the observation channel being
 * PRESENT. These witnesses prove:
 *
 *   - the OFF path (channel ABSENT) hands the executor the EXACT predecessor
 *     context — same object identity, same metadata, NO index key;
 *   - the ON path still stamps the index (the bridge keeps working);
 *   - the results and the scheduling order are identical in both modes;
 *   - the channel-PRESENCE predicate is the SINGLE authority for the stamp.
 *
 * A NOTE ON "DISABLED" vs "ABSENT"
 * --------------------------------
 * These are DIFFERENT states and the correction keeps them distinct:
 *
 *   - ABSENT  — no sink is wired at all. The runtime has no recorder, so
 *                there is nothing to correlate against and the predecessor
 *                context is preserved EXACTLY.
 *   - DISABLED — a sink IS wired but the recorder's enable bit is off. The
 *                channel is structurally present, so the correlation index is
 *                carried; the enable bit is consulted at OBSERVATION time,
 *                so NOTHING is emitted. The index must survive the toggle,
 *                because the G7 contract requires a background command handed
 *                off while disabled to still report its delayed terminal fact
 *                — with its per-command correlation intact — once tracing is
 *                turned back on.
 */
describe("createShellTool — disabled-path context neutrality (CORRECTION01)", () => {
	/**
	 * Capture the EXACT context object the production executor receives.
	 *
	 * The identity (`===`) of the received context is asserted, not just its
	 * shape: the predecessor passed the tool-call context through unchanged
	 * when no per-command authority binding or emit-update envelope applies,
	 * so a context delta is detectable by identity alone.
	 */
	function captureExecutorContexts(): {
		execute: ReturnType<typeof vi.fn>;
		contexts: AgentToolContext[];
	} {
		const contexts: AgentToolContext[] = [];
		const execute = vi.fn(
			async (
				_command: string | { command: string },
				_cwd: string,
				context: AgentToolContext,
			) => {
				contexts.push(context);
				return "ok";
			},
		);
		return { execute, contexts };
	}

	/**
	 * The tool-call context with NO observation channel at all — this is the
	 * trace-OFF shape the production runtime produces when the recorder is
	 * not armed.
	 */
	function makeChannelAbsentContext(): AgentToolContext {
		return {
			agentId: "agent-1",
			sessionId: "session-1",
			runId: "run_abcdefgh",
			iteration: 3,
			toolCallId: "call-1",
			metadata: {},
		};
	}

	/**
	 * The tool-call context with the observation channel PRESENT but the
	 * recorder explicitly DISABLED.
	 *
	 * The sink still collects the observations it is handed, so the witness
	 * can prove that the disabled path emits NOTHING even though the
	 * correlation index is carried.
	 */
	function makeChannelDisabledContext(): {
		context: AgentToolContext;
		observations: Observation[];
	} {
		const observations: Observation[] = [];
		const context: AgentToolContext = {
			agentId: "agent-1",
			sessionId: "session-1",
			runId: "run_abcdefgh",
			iteration: 3,
			toolCallId: "call-1",
			metadata: {
				__clineModelBehaviorTraceSink: {
					onProcessObservation: (observation: Observation) => {
						observations.push(observation);
					},
					isTraceEnabled: () => false,
				},
				__clineModelBehaviorTraceIdentity: {
					sessionId: "session-1",
					runId: "run_abcdefgh",
					toolCallId: "call-1",
				},
			},
		};
		return { context, observations };
	}

	it("CORR01-1: with the observation channel ABSENT, the executor receives the EXACT predecessor context", async () => {
		const { execute, contexts } = captureExecutorContexts();
		const tool = createShellTool(execute as never);
		const context = makeChannelAbsentContext();

		await tool.execute({ commands: ["cmd-a", "cmd-b"] } as never, context);

		expect(contexts).toHaveLength(2);
		for (const received of contexts) {
			// The SAME OBJECT — not a copy with an extra metadata key.
			expect(received).toBe(context);
			// And the index was NOT stamped.
			expect(received.metadata).not.toHaveProperty(
				"__clineCommandProcessObservationIndex",
			);
		}
	});

	it("CORR01-2: with the recorder DISABLED but the channel PRESENT, the index is still stamped so a later toggle can correlate", async () => {
		const { execute, contexts } = captureExecutorContexts();
		const tool = createShellTool(execute as never);
		const { context, observations } = makeChannelDisabledContext();

		await tool.execute({ commands: ["cmd-a", "cmd-b"] } as never, context);

		expect(contexts).toHaveLength(2);
		// The channel is PRESENT, so the correlation index is carried. The
		// recorder's enable bit is a RUNTIME TOGGLE: a background command
		// handed off while disabled must still be able to report its
		// delayed terminal fact once tracing is turned back on.
		expect(contexts[0]?.metadata?.__clineCommandProcessObservationIndex).toBe(
			0,
		);
		expect(contexts[1]?.metadata?.__clineCommandProcessObservationIndex).toBe(
			1,
		);
		// But NO observation is emitted while disabled — the enable bit is
		// still authoritative at observation time.
		expect(observations).toHaveLength(0);
	});
	it("CORR01-3: the OFF path and the ON path produce IDENTICAL results and IDENTICAL scheduling order", async () => {
		const makeOrderedExecutor = (order: string[]): ReturnType<typeof vi.fn> =>
			vi.fn(
				async (
					command: string | { command: string },
					_cwd: string,
					_context: AgentToolContext,
				) => {
					const text = typeof command === "string" ? command : command.command;
					order.push(`start:${text}`);
					return `out:${text}`;
				},
			);

		const offOrder: string[] = [];
		const offTool = createShellTool(makeOrderedExecutor(offOrder) as never);
		const offResult = await offTool.execute(
			{ commands: ["cmd-a", "cmd-b"] } as never,
			makeChannelAbsentContext(),
		);

		const onOrder: string[] = [];
		const onTool = createShellTool(makeOrderedExecutor(onOrder) as never);
		const onContext: AgentToolContext = {
			...makeChannelAbsentContext(),
			metadata: {
				__clineModelBehaviorTraceSink: {
					onProcessObservation: () => {},
					isTraceEnabled: () => true,
				},
				__clineModelBehaviorTraceIdentity: {
					sessionId: "session-1",
					runId: "run_abcdefgh",
					toolCallId: "call-1",
				},
			},
		};
		const onResult = await onTool.execute(
			{ commands: ["cmd-a", "cmd-b"] } as never,
			onContext,
		);

		// IDENTICAL results.
		expect(JSON.stringify(offResult)).toBe(JSON.stringify(onResult));
		// IDENTICAL scheduling order (the order witness, not just the bytes).
		expect(offOrder).toEqual(onOrder);
		expect(offOrder.length).toBe(2);
	});

	it("CORR01-4: with the channel ACTIVE the index IS still stamped, so the bridge keeps working", async () => {
		const observations: Observation[] = [];
		const contexts: AgentToolContext[] = [];
		const execute = vi.fn(
			async (
				_command: string | { command: string },
				_cwd: string,
				context: AgentToolContext,
			) => {
				contexts.push(context);
				reportCommandProcessObservation(
					context.metadata,
					{ terminalState: "exited", exitCode: 0 },
					"foreground",
					"foreground_terminal_completion",
				);
				return "ok";
			},
		);
		const tool = createShellTool(execute as never);
		const activeContext: AgentToolContext = {
			...makeChannelAbsentContext(),
			metadata: {
				__clineModelBehaviorTraceSink: {
					onProcessObservation: (observation: {
						sessionId?: string;
						runId?: string;
						payload: Record<string, unknown>;
					}) => {
						observations.push(observation);
					},
					isTraceEnabled: () => true,
				},
				__clineModelBehaviorTraceIdentity: {
					sessionId: "session-1",
					runId: "run_abcdefgh",
					toolCallId: "call-1",
				},
			},
		};
		await tool.execute(
			{ commands: ["cmd-a", "cmd-b"] } as never,
			activeContext,
		);

		expect(contexts).toHaveLength(2);
		expect(contexts[0]?.metadata?.__clineCommandProcessObservationIndex).toBe(
			0,
		);
		expect(contexts[1]?.metadata?.__clineCommandProcessObservationIndex).toBe(
			1,
		);
		expect(observations).toHaveLength(2);
	});

	it("CORR01-5: the channel-PRESENCE predicate is the SINGLE authority for the stamp", () => {
		// Absent channel → not present.
		expect(isCommandProcessObservationChannelPresent(undefined)).toBe(false);
		expect(isCommandProcessObservationChannelPresent({})).toBe(false);
		// A sink WITHOUT `onProcessObservation` → not present (it can never
		// receive an observation).
		expect(
			isCommandProcessObservationChannelPresent({
				__clineModelBehaviorTraceSink: {},
			}),
		).toBe(false);
		// A sink that reports disabled → STILL PRESENT. The enable bit is a
		// runtime toggle, not a property of the channel's wiring.
		expect(
			isCommandProcessObservationChannelPresent({
				__clineModelBehaviorTraceSink: {
					onProcessObservation: () => {},
					isTraceEnabled: () => false,
				},
			}),
		).toBe(true);
		// A sink that reports enabled → present.
		expect(
			isCommandProcessObservationChannelPresent({
				__clineModelBehaviorTraceSink: {
					onProcessObservation: () => {},
					isTraceEnabled: () => true,
				},
			}),
		).toBe(true);
		// A sink that does NOT implement the probe → present.
		expect(
			isCommandProcessObservationChannelPresent({
				__clineModelBehaviorTraceSink: {
					onProcessObservation: () => {},
				},
			}),
		).toBe(true);
		// A FAILING probe → present (a probe failure must never silently
		// disable an observation).
		expect(
			isCommandProcessObservationChannelPresent({
				__clineModelBehaviorTraceSink: {
					onProcessObservation: () => {},
					isTraceEnabled: () => {
						throw new Error("probe failure");
					},
				},
			}),
		).toBe(true);
	});
});
