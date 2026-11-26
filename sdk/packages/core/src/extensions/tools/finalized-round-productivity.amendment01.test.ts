/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
 *
 * A3 — THE FINALIZED EXECUTION-ROUND PRODUCTIVITY AUTHORITY.
 *
 * THE DEFECT THIS WITNESS PINS
 * ----------------------------
 *
 * The ACT-owned correction added a `classifyExecutionRound()` call to the
 * output-exhaustion branch, IMMEDIATELY BEFORE `this.state.pendingToolCalls`
 * was assigned. That site is BEFORE `executeToolCalls()`, so the current
 * round's observable facts were still EMPTY: the classification observed
 * NOTHING about the round that was about to run. The consequence was that
 * the CONSECUTIVE output-exhaustion streak was NEVER cleared by a genuinely
 * productive round — not even by a successful native edit.
 *
 * The correction moved the reset to the FINALIZED execution-round
 * accounting boundary, where the round's tool calls have actually been
 * executed and their outcomes observed, reusing the SAME
 * already-computed productivity classification the R1 accounting consumes.
 *
 * WHAT THIS WITNESS ESTABLISHES
 * -----------------------------
 *
 * The PAIRED TRAJECTORIES, each with the PRODUCTION HOST CLASSIFIER as the
 * load-bearing discriminator (never a test-local tool-name mapping):
 *
 *   F1  Successful current-round EDIT          -> the streak is cleared.
 *   F2  Failed current-round EDIT               -> the streak is NOT cleared.
 *   F3  Successful current-round EXECUTION      -> the streak is cleared.
 *   F4  Read-only INSPECTION                    -> the streak is NOT cleared.
 *   F5  Failed or UNKNOWN EXECUTION             -> the streak is NOT cleared.
 *   F6  Legitimate WAIT                         -> the streak is cleared.
 *
 * CONSERVATION: the productive round clears ONLY the consecutive streak. It
 * replenishes NO run-scoped resource: neither the ordinary conciseness-
 * reminder allowance nor the exhaustion-driven continuation ceiling is
 * touched by it.
 *
 * EVIDENCE CLASS: SYNTHETIC_REAL_PRODUCTION_SEAM. The runtime is real, the
 * tool execution is real, and the HOST CLASSIFIER is the production one.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createHostExecutionProgressClassifier } from "./execution-progress-classifier";

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];

	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			return (async function* () {})();
		}
		return (async function* () {
			for (const event of step(request)) {
				yield event;
			}
		})();
	}
}

/** A turn cut off at the output limit, with NO tool call. */
function exhaustedTurn(): Iterable<AgentModelEvent> {
	return [
		{ type: "reasoning-delta", text: "thinking..." },
		{ type: "finish", reason: "max-tokens" },
	];
}

/** A turn that calls a tool. */
function toolTurn(
	toolCallId: string,
	toolName: string,
	input: unknown = {},
): Iterable<AgentModelEvent> {
	return [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName,
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

/** A turn that produces text and finishes normally. */
function finishTurn(): Iterable<AgentModelEvent> {
	return [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/**
 * The PRODUCTION host classifier.
 *
 * It is the load-bearing discriminator: it is the SAME instance the VS Code
 * host installs, and it reads the PRODUCTION observation shapes (the
 * `status` / `state` / `commandExecutionDisposition` fields and the
 * `isRunning` / `stillRunning` flags).
 */
const productionClassifier = createHostExecutionProgressClassifier();

/** A native edit tool whose result shape the runtime reads directly. */
function createEditTool(succeeds: boolean): AgentTool<unknown, unknown> {
	return {
		name: "write_file",
		description: "Write a file (a native edit)",
		inputSchema: { type: "object" },
		async execute() {
			if (!succeeds) {
				// The runtime reads a FAILED tool call from a THROWN
				// error: a tool that RETURNS a failure payload is a
				// successful dispatch of a negative observation.
				throw new Error("the write failed");
			}
			return { ok: true };
		},
	} as unknown as AgentTool<unknown, unknown>;
}

/**
 * A `run_commands` tool whose observation carries the PRODUCTION shape for
 * the requested disposition.
 */
function createRunCommandsTool(disposition: {
	readonly kind: "successful" | "failed" | "running" | "absent";
}): AgentTool<unknown, unknown> {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			// The runtime wraps the tool's RETURN VALUE as the tool
			// result's `output`, so the OBSERVATION is the returned value
			// itself — exactly as the production tools return it.
			if (disposition.kind === "absent") {
				// No outcome at all.
				return { ok: true };
			}
			if (disposition.kind === "running") {
				return {
					status: "running",
					state: "running",
					isRunning: true,
				};
			}
			if (disposition.kind === "failed") {
				return {
					status: "failed",
					state: "failed",
					exitCode: 1,
					commandExecutionDisposition: "unsuccessful",
				};
			}
			return {
				status: "completed",
				state: "completed",
				exitCode: 0,
				commandExecutionDisposition: "successful",
			};
		},
	} as unknown as AgentTool<unknown, unknown>;
}

/**
 * The OBSERVED exhaustion streak.
 *
 * The runtime reports the consecutive exhaustion streak to the host
 * through the EXISTING `isExhaustionEstablished` seam of the
 * recovery-only generation override policy: the runtime consults the host
 * predicate with the CURRENT streak value, and the host owns the
 * judgement. The predicate is therefore the production seam that MAKES
 * the streak observable, and the witness uses it instead of reading any
 * private runtime field.
 *
 * The predicate is consulted at the R1 injection boundary, so the reported
 * value is the streak AT that boundary.
 */
async function observeExhaustionStreak(options: {
	readonly steps: Array<
		(request: AgentModelRequest) => Iterable<AgentModelEvent>
	>;
	readonly tools: AgentTool<unknown, unknown>[];
}): Promise<readonly number[]> {
	const model = new ScriptedModel(options.steps);
	const observed: number[] = [];
	const runtime = new AgentRuntime({
		model,
		tools: options.tools,
		executionStagnationPolicy: {
			// The threshold is reached in EVERY trajectory, and the
			// instruction allowance is ONE, so the injection boundary is
			// reached EXACTLY once per trajectory and the host predicate is
			// consulted exactly once with the streak at that boundary.
			unproductiveRoundThreshold: 4,
			maxRecoveryInstructions: 1,
			enabled: true,
			classifyToolCall: productionClassifier,
		},
		recoveryOutputOverridePolicy: {
			enabled: true,
			recoveryMaxOutputTokens: 16_384,
			// The host is told the CURRENT exhaustion streak. The host
			// predicate may only NARROW the eligibility, so it returns
			// `true` and the runtime applies its OWN minimum requirement.
			isExhaustionEstablished: ({ exhaustionStreak }) => {
				observed.push(exhaustionStreak);
				return true;
			},
		},
	});
	await runtime.run("Do the work");
	return observed;
}

/**
 * The trajectory: N exhausted turns, then ONE productive-or-not round, then
 * further exhausted turns.
 *
 * The exhaustion streak limit is 3. The witness therefore uses enough
 * exhausted turns AFTER the observed round to reach the limit UNLESS the
 * observed round cleared the streak.
 */
function trajectory(options: {
	readonly before: number;
	readonly observed: () => Iterable<AgentModelEvent>;
	readonly after: number;
}): Array<(request: AgentModelRequest) => Iterable<AgentModelEvent>> {
	const steps: Array<
		(request: AgentModelRequest) => Iterable<AgentModelEvent>
	> = [];
	for (let i = 0; i < options.before; i += 1) {
		steps.push(exhaustedTurn);
	}
	steps.push(options.observed);
	for (let i = 0; i < options.after; i += 1) {
		steps.push(exhaustedTurn);
	}
	steps.push(finishTurn);
	return steps;
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) / A3 finalized round productivity", () => {
	/**
	 * The trajectory shape.
	 *
	 * `exhaustionsBefore` exhausted rounds, then ONE observed round, then
	 * `exhaustionsAfter` exhausted rounds.
	 *
	 * The two accountings DIVERGE on the observed round:
	 *
	 *   - the R1 accounting folds EVERY finalized round, so a
	 *     non-productive tool-calling round INCREMENTS the R1 streak; and
	 *   - the exhaustion accounting increments ONLY on an exhausted round,
	 *     so a tool-calling round leaves the exhaustion streak UNCHANGED.
	 *
	 * A PRODUCTIVE observed round clears BOTH. The witness therefore
	 * observes the exhaustion streak the runtime reports to the host at the
	 * R1 injection boundary: its VALUE discriminates the two readings.
	 */
	function trajectory(options: {
		readonly exhaustionsBefore: number;
		readonly observed: () => Iterable<AgentModelEvent>;
		readonly exhaustionsAfter: number;
	}): Array<(request: AgentModelRequest) => Iterable<AgentModelEvent>> {
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (let i = 0; i < options.exhaustionsBefore; i += 1) {
			steps.push(exhaustedTurn);
		}
		steps.push(options.observed);
		for (let i = 0; i < options.exhaustionsAfter; i += 1) {
			steps.push(exhaustedTurn);
		}
		steps.push(finishTurn);
		return steps;
	}

	it("F1: a SUCCESSFUL current-round EDIT clears the consecutive exhaustion streak", async () => {
		const observed = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("edit-1", "write_file", {
						path: "a.ts",
						new_text: "written",
					}),
				exhaustionsAfter: 4,
			}),
			tools: [createEditTool(true)],
		});
		// The edit was PRODUCTIVE: it cleared the exhaustion streak, so the
		// streak reported at the injection boundary is only the FOUR
		// exhaustions that followed it.
		expect(observed).toHaveLength(1);
		expect(observed[0]).toBe(4);
	});

	it("F2: a FAILED current-round EDIT does NOT clear the consecutive exhaustion streak", async () => {
		const observed = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("edit-1", "write_file", {
						path: "a.ts",
						new_text: "written",
					}),
				exhaustionsAfter: 4,
			}),
			tools: [createEditTool(false)],
		});
		// The edit FAILED: it did not clear the streak, so the streak
		// reported at the injection boundary is the TWO exhaustions before
		// it PLUS the ONE that followed it before the R1 threshold was
		// reached (the failed round itself counted toward the R1 streak).
		expect(observed).toHaveLength(1);
		expect(observed[0]).toBe(3);
	});

	it("F3: a SUCCESSFUL current-round EXECUTION clears the consecutive exhaustion streak", async () => {
		const observed = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("run-1", "run_commands", { commands: ["vitest run"] }),
				exhaustionsAfter: 4,
			}),
			tools: [createRunCommandsTool({ kind: "successful" })],
		});
		// The execution was PRODUCTIVE: it cleared the exhaustion streak,
		// so the streak reported at the injection boundary is only the FOUR
		// exhaustions that followed it.
		expect(observed).toHaveLength(1);
		expect(observed[0]).toBe(4);
	});

	it("F4: a READ-ONLY INSPECTION does NOT clear the consecutive exhaustion streak", async () => {
		const observed = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("run-1", "run_commands", { commands: ["git log"] }),
				exhaustionsAfter: 4,
			}),
			tools: [createRunCommandsTool({ kind: "successful" })],
		});
		// The PRODUCTION classifier recognises `git log` as an INSPECTION:
		// it read something, it did not run anything. The streak is NOT
		// cleared.
		expect(observed).toHaveLength(1);
		expect(observed[0]).toBe(3);
	});

	it("F5: a FAILED or UNKNOWN EXECUTION does NOT clear the consecutive exhaustion streak", async () => {
		const failed = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("run-1", "run_commands", { commands: ["vitest run"] }),
				exhaustionsAfter: 4,
			}),
			tools: [createRunCommandsTool({ kind: "failed" })],
		});
		expect(failed).toHaveLength(1);
		expect(failed[0]).toBe(3);

		const unknown = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("run-1", "run_commands", { commands: ["vitest run"] }),
				exhaustionsAfter: 4,
			}),
			tools: [createRunCommandsTool({ kind: "absent" })],
		});
		expect(unknown).toHaveLength(1);
		expect(unknown[0]).toBe(3);
	});

	it("F6: a LEGITIMATE WAIT clears the consecutive exhaustion streak", async () => {
		const observed = await observeExhaustionStreak({
			steps: trajectory({
				exhaustionsBefore: 2,
				observed: () =>
					toolTurn("run-1", "run_commands", { commands: ["vitest run"] }),
				exhaustionsAfter: 4,
			}),
			tools: [createRunCommandsTool({ kind: "running" })],
		});
		// A job that is STILL RUNNING is a legitimate wait: it is not a
		// stall, and it clears the consecutive streak.
		expect(observed).toHaveLength(1);
		expect(observed[0]).toBe(4);
	});

	it("F7: the productive round replenishes NO run-scoped resource", async () => {
		// The ordinary conciseness-reminder allowance is a CONSUMABLE
		// run-scoped resource. A PRODUCTIVE round clears the consecutive
		// streak, but it must NOT re-arm the allowance: otherwise an agent
		// could alternate "one trivial progress step, then stall" forever
		// and the recovery would never be bounded.
		//
		// The trajectory: exhaust, exhaust, exhaust (the allowance is now
		// spent at 3), then a PRODUCTIVE edit, then exhaust, exhaust,
		// exhaust. If the productive round re-armed the allowance, a FOURTH
		// conciseness reminder would be injected. It must NOT be.
		const model = new ScriptedModel([
			exhaustedTurn,
			exhaustedTurn,
			exhaustedTurn,
			() =>
				toolTurn("edit-1", "write_file", {
					path: "a.ts",
					new_text: "written",
				}),
			exhaustedTurn,
			exhaustedTurn,
			exhaustedTurn,
			finishTurn,
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEditTool(true)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 99,
				maxRecoveryInstructions: 0,
				enabled: true,
				classifyToolCall: productionClassifier,
			},
		});
		await runtime.run("Do the work");

		// Count the DISTINCT conciseness reminders the runtime injected.
		// The reminder is carried forward into every subsequent request, so
		// the DISTINCT message identity is the count of injections.
		const ids = new Set<string>();
		for (const request of model.requests) {
			for (const message of request.messages) {
				for (const part of message.content ?? []) {
					if (
						part.type === "text" &&
						part.text.startsWith(
							"Your previous response was cut off because it reached the model's output-token limit",
						)
					) {
						ids.add(String((message as { id?: unknown }).id));
					}
				}
			}
		}
		// AT MOST the advertised three reminders: the productive round did
		// NOT replenish the run-scoped allowance.
		expect(ids.size).toBeLessThanOrEqual(3);
	});
});
