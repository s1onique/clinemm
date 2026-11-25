/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01
 *
 * THE ADVERSARIAL PRODUCTION WITNESS.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * Two P0 boundaries, exercised together through the REAL `AgentRuntime`:
 *
 *   A1  EXECUTION AUTHORIZATION CONSERVATION — while a bounded objective
 *       is active, a tool call that would mutate a path OUTSIDE the
 *       objective's authorised scope is REFUSED at the tool-execution
 *       boundary. The parent's authorisation is intact, and the
 *       objective's narrower scope is ENFORCED, not merely stated.
 *
 *   A2  UNRELATED COMMAND VERIFICATION DENIAL — after the unauthorized
 *       mutation was refused, the model runs an UNRELATED successful
 *       command. That command does NOT establish objective success.
 *
 *   A3  AUTOMATIC PARENT CONTINUATION — a completed objective does NOT
 *       automatically satisfy the parent's outstanding obligations.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM. The REAL `AgentRuntime`, the REAL tool
 * execution boundary, the REAL R2 activation/dispatch/evaluation path. A
 * DISPOSABLE WORKSPACE on disk. Scripted model responses ONLY at the model
 * boundary. NO paid inference.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A deterministic scripted model. */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	readonly selectionRequests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
		private readonly selectionReply: Record<string, unknown>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const isSelectionRequest = (request.tools ?? []).length === 0;
		if (isSelectionRequest) {
			this.selectionRequests.push(request);
			const reply = JSON.stringify(this.selectionReply);
			return (async function* () {
				yield { type: "text-delta", text: reply } as AgentModelEvent;
				yield { type: "finish", reason: "stop" } as AgentModelEvent;
			})();
		}
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			return (async function* () {})();
		}
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

/** One round that calls a tool and asks for another round. */
function toolCallStep(
	toolCallId: string,
	toolName: string,
	input: unknown,
): (request: AgentModelRequest) => AgentModelEvent[] {
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

/** One round that produces only text and finishes. */
function finishStep(): (request: AgentModelRequest) => AgentModelEvent[] {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/**
 * The R2 SELECTION REPLY.
 *
 * The objective's mutation scope is the disposable workspace's `src`
 * directory — an ABSOLUTE, canonical path — so the runtime can resolve
 * it and enforce it.
 */
const SELECTION_REPLY: Record<string, unknown> = {
	objective: "Repair the disposable target so its VALUE constant is 2",
	firstStep: "Edit the disposable target module to set VALUE = 2",
	mutationScope: "PLACEHOLDER_SCOPE",
	verificationCondition:
		"the run_commands regression check `check-value` for VALUE reports PASS",
	obligationReferences: ["Complete the parent task as authorized by the user"],
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the executable check `check-value` reports PASS",
	failureCondition:
		"the editable file cannot be changed or the check cannot pass",
};

/** The DISPOSABLE WORKSPACE. */
function createDisposableWorkspace(): {
	dir: string;
	srcDir: string;
	targetPath: string;
	outsidePath: string;
	read: () => string;
	readOutside: () => string;
} {
	const dir = mkdtempSync(join(tmpdir(), "cline-r2-adversarial-"));
	const srcDir = join(dir, "src");
	mkdirSync(srcDir, { recursive: true });
	const targetPath = join(srcDir, "target.ts");
	const outsidePath = join(dir, "outside.ts");
	writeFileSync(targetPath, "export const VALUE = 1;\n", "utf-8");
	writeFileSync(outsidePath, "export const SECRET = 'keep';\n", "utf-8");
	return {
		dir,
		srcDir,
		targetPath,
		outsidePath,
		read: () => readFileSync(targetPath, "utf-8"),
		readOutside: () => readFileSync(outsidePath, "utf-8"),
	};
}

// ---------------------------------------------------------------------------
// THE ADVERSARIAL TRAJECTORY
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / adversarial trajectory", () => {
	it("A1+A2+A3: an UNAUTHORIZED mutation is REFUSED, an UNRELATED successful command does NOT verify the objective, and the parent obligation survives", async () => {
		const workspace = createDisposableWorkspace();
		const calls = { inspect: 0, edit: 0, unauthorizedEdit: 0, command: 0 };

		// An inspection-only tool.
		const inspectTool: AgentTool = {
			name: "read_files",
			description: "Reads files (inspection only)",
			inputSchema: { type: "object" },
			async execute() {
				calls.inspect += 1;
				return "file contents";
			},
		};
		// The mutating tool. It records WHICH paths it was asked to write.
		const editTool: AgentTool = {
			name: "editor",
			description: "Edits a file",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				const record = (input ?? {}) as Record<string, unknown>;
				const path = typeof record.path === "string" ? record.path : "";
				if (path === workspace.outsidePath) {
					calls.unauthorizedEdit += 1;
					writeFileSync(path, "export const SECRET = 'leaked';\n", "utf-8");
					return "edited";
				}
				calls.edit += 1;
				writeFileSync(path, "export const VALUE = 2;\n", "utf-8");
				return "edited";
			},
		};
		// The command tool. The `check-value` gate SUCCEEDS when the
		// disposable target really carries the repaired value; every OTHER
		// command succeeds trivially — the UNRELATED successful command.
		const commandTool: AgentTool = {
			name: "run_commands",
			description: "Runs commands",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				calls.command += 1;
				const record = (input ?? {}) as Record<string, unknown>;
				const commands = Array.isArray(record.commands)
					? (record.commands as unknown[])
					: [];
				const identity = commands
					.filter((entry): entry is string => typeof entry === "string")
					.join(" && ");
				if (identity.includes("check-value")) {
					if (!workspace.read().includes("VALUE = 2")) {
						throw new Error("the regression check failed");
					}
					return "PASS: the regression check for VALUE succeeded";
				}
				// An UNRELATED command: it succeeds.
				return "PASS: an unrelated command completed";
			},
		};

		const selectionReply = {
			...SELECTION_REPLY,
			mutationScope: workspace.targetPath,
		};

		// The scripted trajectory.
		//
		// Phase A: nine stalled inspection rounds exhaust R1's allowance.
		// Phase B: the objective is active. The model attempts an
		//          UNAUTHORIZED mutation OUTSIDE the objective's scope.
		// Phase C: the model runs an UNRELATED successful command.
		// Phase D: the model runs the REQUIRED gate — which FAILS,
		//          because the objective's own work was never done.
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", {
					files: [{ path: workspace.targetPath }],
				}),
			);
		}
		steps.push(
			// The UNAUTHORIZED mutation: outside the objective's scope.
			toolCallStep("x1", "editor", {
				path: workspace.outsidePath,
				old_text: "SECRET = 'keep'",
				new_text: "SECRET = 'leaked'",
			}),
		);
		steps.push(
			// The UNRELATED successful command.
			toolCallStep("x2", "run_commands", { commands: ["build-the-project"] }),
		);
		steps.push(
			// The REQUIRED gate.
			toolCallStep("x3", "run_commands", { commands: ["check-value"] }),
		);
		steps.push(finishStep());

		const model = new ScriptedModel(steps, selectionReply);
		const runtime = new AgentRuntime({
			model,
			tools: [inspectTool, editTool, commandTool],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 8,
				maxSelectionInferences: 1,
				// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
				// (AMENDMENT-02): the TRUSTED HOST VERIFICATION AUTHORITY.
				// The AMENDMENT-01 substring gate is REMOVED; only the
				// host's own verdict establishes verification.
				verifyObjective: () => false,
			},
		});
		const notices: string[] = [];
		const toolResults: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
			if (event.type === "tool-finished") {
				for (const part of event.message.content) {
					if (part.type === "tool-result") {
						toolResults.push(
							typeof part.output === "string"
								? part.output
								: JSON.stringify(part.output),
						);
					}
				}
			}
		});
		await runtime.run(
			`Repair the disposable target module at ${workspace.targetPath} and report the outcome`,
		);

		// A1 — EXECUTION AUTHORIZATION CONSERVATION.
		//
		// The unauthorized mutation was REFUSED at the tool-execution
		// boundary: the executor never ran for the out-of-scope path.
		expect(calls.unauthorizedEdit).toBe(0);
		// The file outside the objective's scope is UNCHANGED on disk.
		expect(workspace.readOutside()).toContain("SECRET = 'keep'");
		expect(workspace.readOutside()).not.toContain("leaked");
		// The refusal is observable in the tool result the model received.
		expect(
			toolResults.some((result) =>
				result.includes("outside the objective's authorised mutation scope"),
			),
		).toBe(true);

		// A2 — UNRELATED COMMAND VERIFICATION DENIAL.
		//
		// The unrelated command DID run and DID succeed...
		expect(calls.command).toBeGreaterThan(0);
		// ...but the objective was NOT reported verified.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
		// And the failure was reported TRUTHFULLY.
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);

		// A3 — AUTOMATIC PARENT CONTINUATION.
		//
		// The parent's obligation was NEVER discharged by the objective:
		// the objective did not verify, and the parent completion contract
		// is unchanged.
		expect(
			notices.filter((n) => n.includes("bounded objective did not verify")),
		).toHaveLength(1);
	});
});
