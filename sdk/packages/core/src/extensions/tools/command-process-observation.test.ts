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
import { reportCommandProcessObservation } from "./executors/command-process-observation";

describe("createShellTool — per-command process observations", () => {
	/**
	 * Build the runtime-owned tool context the production runtime hands to a
	 * tool executor, including the trace sink and the correlation identity
	 * the runtime stamps onto `context.metadata`.
	 */
	type Observation = {
		sessionId?: string;
		runId?: string;
		payload: Record<string, unknown>;
	};

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
