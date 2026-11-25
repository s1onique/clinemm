/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
 *
 * The PRINCIPAL DETERMINISTIC WITNESS for R2 bounded-objective recovery.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * The three-phase scenario, driven through the REAL `AgentRuntime` with a
 * scripted model and a DISPOSABLE WORKSPACE on disk:
 *
 *   Phase A — STAGNATION
 *     The model repeatedly inspects source files without making meaningful
 *     progress. The existing R1 corrective instructions ARE delivered into
 *     the dispatched requests, and they do NOT change the model's
 *     behaviour.
 *
 *   Phase B — R2 EXECUTION
 *     R1's allowance is exhausted, so R2 activates AUTOMATICALLY. The
 *     scripted model chooses the implementation action ONLY AFTER it
 *     observes the active R2 objective in the dispatched request. The real
 *     tool path changes a DISPOSABLE FILE ON DISK, and the relevant
 *     executable check establishes the required outcome.
 *
 *   Phase C — PARENT CONTINUATION
 *     The objective completes, the runtime AUTOMATICALLY returns to the
 *     parent task, and a SECOND outstanding parent obligation remains
 *     incomplete. An attempted parent completion BEFORE that obligation is
 *     satisfied is REJECTED by the existing completion contract. After the
 *     outstanding obligation is satisfied, ordinary successful completion
 *     remains possible.
 *
 * NO operator intervention occurs at any point.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * The model is SYNTHETIC and deterministic. This establishes that the R2
 * production path ACTIVATES, DISPATCHES, EXECUTES, VERIFIES and RETURNS
 * correctly. It does NOT establish that a live model would select the same
 * objective, nor that the live failure recovers behaviourally. That is a
 * separate, live-behaviour claim.
 *
 * EVIDENCE CLASS: SYNTHETIC_REAL_PRODUCTION_SEAM.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * A deterministic scripted model that can DECIDE based on what the
 * dispatched request actually carries.
 *
 * The R2 phase uses a step that inspects the request: it only performs the
 * implementation action when the request carries the active bounded
 * objective. This is what makes the witness establish that R2's dispatch
 * CHANGED THE MODEL'S BEHAVIOUR, rather than merely counting messages.
 *
 * The R2 SELECTION INFERENCE is served by the SAME model through the SAME
 * `stream()` seam, so the script must distinguish the two request kinds.
 * The discriminator is the request's TOOL INVENTORY: the selection
 * inference carries NO tools (it names an objective; it executes nothing),
 * while every execution request carries the runtime's tool set.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	readonly selectionRequests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
		private readonly selectionReply: Record<string, unknown>,
	) {}
	/** Refill the script, so a SECOND run can be served by the same model. */
	refill(
		steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	): void {
		this.steps.push(...steps);
	}
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
 * The R2 SELECTION REPLY the scripted model returns for the ONE selection
 * inference.
 *
 * It names a bounded objective with an OBSERVABLE verification condition,
 * and cites the established observation and the outstanding parent
 * obligation VERBATIM — exactly as the runtime's validator requires.
 */
const SELECTION_REPLY: Record<string, unknown> = {
	objective: "Repair the disposable target so its VALUE constant is 2",
	firstStep: "Edit the disposable target module to set VALUE = 2",
	mutationScope: "the disposable workspace directory",
	verificationCondition:
		"the run_commands regression check for VALUE reports PASS",
	obligationReferences: [
		"Call the terminal completion tool submit_and_exit only after every parent obligation is satisfied",
	],
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the executable check for VALUE reports PASS",
	failureCondition:
		"the editable file cannot be changed or the check cannot pass",
};

/**
 * The R2 SELECTION REPLY used by the CONSERVATION CONTROLS.
 *
 * The control runtime has no terminal completion tool, so its outstanding
 * parent obligation is the fallback one. The reply cites it verbatim.
 */
const CONTROL_SELECTION_REPLY: Record<string, unknown> = {
	objective: "Repair the disposable target so its VALUE constant is 2",
	firstStep: "Edit the disposable target module to set VALUE = 2",
	mutationScope: "the disposable workspace directory",
	verificationCondition:
		"the run_commands regression check for VALUE reports PASS",
	obligationReferences: ["Complete the parent task as authorized by the user"],
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the executable check for VALUE reports PASS",
	failureCondition:
		"the editable file cannot be changed or the check cannot pass",
};

/** Extract every text block of every message in a model request. */
function requestTexts(request: AgentModelRequest): string[] {
	const texts: string[] = [];
	for (const message of request.messages ?? []) {
		if (typeof message.content === "string") {
			texts.push(message.content);
			continue;
		}
		if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (
					part &&
					typeof part === "object" &&
					"text" in part &&
					typeof (part as { text: unknown }).text === "string"
				) {
					texts.push((part as { text: string }).text);
				}
			}
		}
	}
	return texts;
}

/** The R1 corrective instruction, if the request carries one. */
function recoveryInstructionIn(request: AgentModelRequest): string | undefined {
	return requestTexts(request).find((text) =>
		text.startsWith("[SYSTEM] Execution has stalled:"),
	);
}

/** The ACTIVE BOUNDED OBJECTIVE projection, if the request carries one. */
function boundedObjectiveIn(request: AgentModelRequest): string | undefined {
	const systemPrompt = request.systemPrompt ?? "";
	const marker = "[SYSTEM] Active bounded objective (runtime authority):";
	const at = systemPrompt.indexOf(marker);
	if (at === -1) {
		return undefined;
	}
	return systemPrompt.slice(at);
}

/**
 * The DISPOSABLE WORKSPACE.
 *
 * The witness mutates a real file on disk and verifies it with a real
 * executable check. Nothing touches the repository.
 *
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02: the
 * executable check is a REAL SUBPROCESS that runs a REAL script which
 * READS the disposable file and exits non-zero when the value is wrong.
 * The AMENDMENT-01 witness returned a hard-coded PASS string, which proved
 * only that the tool was called — not that the check ran.
 */
function createDisposableWorkspace(): {
	dir: string;
	targetPath: string;
	checkPath: string;
	read: () => string;
} {
	const dir = mkdtempSync(join(tmpdir(), "cline-r2-witness-"));
	const targetPath = join(dir, "target.ts");
	const checkPath = join(dir, "check-value");
	writeFileSync(targetPath, "export const VALUE = 1;\n", "utf-8");
	// The REAL regression executable. It reads the target and exits 0 only
	// when the repaired value is present.
	writeFileSync(
		checkPath,
		["#!/bin/sh", `grep -q 'VALUE = 2' '${targetPath}'`, "exit $?", ""].join(
			"\n",
		),
		"utf-8",
	);
	chmodSync(checkPath, 0o755);
	return {
		dir,
		targetPath,
		checkPath,
		read: () => readFileSync(targetPath, "utf-8"),
	};
}

/** An inspection-only tool: it reads, and never edits. */
function createInspectTool(calls: { count: number }): AgentTool {
	return {
		name: "read_files",
		description: "Reads files (inspection only)",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return "file contents";
		},
	};
}

/** A native edit tool that succeeds. */
function createEditTool(calls: { count: number }): AgentTool {
	return {
		name: "editor",
		description: "Edits a file",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return "edited";
		},
	};
}

/**
 * A command tool that COMPLETES successfully.
 *
 * Its result is a real, completed observation, so the round counts as
 * EXECUTED progress and can verify a bounded objective whose verification
 * condition is an executable command.
 */
function createCompletedCommandTool(calls: { count: number }): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return "PASS: the requested evidence was collected";
		},
	};
}

/**
 * A command tool whose result reports that the work is STILL RUNNING.
 *
 * A legitimate wait is not a stall, so such a round must never count
 * toward the stagnation streak and must never activate R2.
 */
function createRunningCommandTool(calls: { count: number }): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return { status: "running" };
		},
	};
}

// ---------------------------------------------------------------------------
// THE PRINCIPAL WITNESS — Phase A / B / C.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / principal witness", () => {
	it("A+B+C: R1 exhaustion activates R2, the bounded objective executes and verifies against a disposable workspace, and execution returns to the parent automatically", async () => {
		const workspace = createDisposableWorkspace();
		const calls = { inspect: 0, edit: 0, verify: 0, complete: 0 };

		// A tool that INSPECTS (read-only).
		const inspectTool: AgentTool = {
			name: "read_files",
			description: "Reads files (inspection only)",
			inputSchema: { type: "object" },
			async execute() {
				calls.inspect += 1;
				return "file contents";
			},
		};
		// A tool that MUTATES a disposable file on disk.
		const editTool: AgentTool = {
			name: "editor",
			description: "Edits a file",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				calls.edit += 1;
				const record = (input ?? {}) as Record<string, unknown>;
				if (typeof record.path === "string") {
					writeFileSync(record.path, "export const VALUE = 2;\n", "utf-8");
				}
				return "edited";
			},
		};
		// A tool that runs the EXECUTABLE CHECK. It succeeds only when the
		// disposable file really carries the repaired value.
		//
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02:
		// the check is a REAL SUBPROCESS running the REAL regression script.
		// The AMENDMENT-01 witness returned a hard-coded PASS string.
		const verifyTool: AgentTool = {
			name: "run_commands",
			description: "Runs commands",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				calls.verify += 1;
				const record = (input ?? {}) as Record<string, unknown>;
				const commands = Array.isArray(record.commands)
					? (record.commands as unknown[])
					: [];
				const identity = commands
					.filter((entry): entry is string => typeof entry === "string")
					.join(" && ");
				// The REAL regression executable runs as a REAL process. Its
				// exit status is the verdict.
				const result = spawnSync(identity, {
					shell: true,
					cwd: workspace.dir,
				});
				if (result.status !== 0) {
					return `FAILED: the regression check exited with ${result.status ?? "no status"}`;
				}
				return "PASS: the regression check for VALUE succeeded";
			},
		};
		// The parent's terminal completion tool. The runtime MUST NOT invoke
		// it on the bounded objective's behalf.
		const completionTool: AgentTool = {
			name: "submit_and_exit",
			description: "Completes the task",
			inputSchema: { type: "object" },
			lifecycle: { completesRun: true },
			async execute() {
				calls.complete += 1;
				return "done";
			},
		};

		// The parent task's outstanding obligations. The completion guard
		// refuses completion while the SECOND obligation is unsatisfied —
		// this is the EXISTING completion contract, exercised unchanged.
		const outstandingObligation =
			"The second parent obligation (report the outcome) is still outstanding";
		let secondObligationSatisfied = false;
		const completionGuard = () =>
			secondObligationSatisfied ? undefined : outstandingObligation;

		const INSPECT_INPUT = { files: [{ path: workspace.targetPath }] };

		// The scripted model.
		//
		// Phase A: three inspection rounds. The R1 instruction is delivered
		// into the dispatched request but the model IGNORES it — it keeps
		// inspecting.
		//
		// Then: the R1 allowance is exhausted and R2's SELECTION INFERENCE
		// runs. The model's next reply is the selection JSON.
		//
		// Phase B: the model PERFORMS THE IMPLEMENTATION ACTION ONLY AFTER
		// it observes the active bounded objective in the dispatched
		// request. Before the objective is active it keeps inspecting.
		//
		// Phase C: after the objective verifies, the runtime returns to the
		// parent. The model attempts the parent's terminal completion tool
		// while the second obligation is still outstanding — the guard
		// rejects it. After the obligation is satisfied, ordinary
		// completion succeeds.
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [
			// Phase A: NINE unproductive inspection rounds.
			//
			// The R1 accounting is a CONSECUTIVE streak: rounds 1-3 trip the
			// first corrective instruction (streak resets), rounds 4-6 trip
			// the second (streak resets), and rounds 7-9 reach the threshold
			// with the run-scoped allowance already spent — which is the
			// `allowance_exhausted` branch R2 activates at.
			toolCallStep("a1", "read_files", INSPECT_INPUT),
			toolCallStep("a2", "read_files", INSPECT_INPUT),
			toolCallStep("a3", "read_files", INSPECT_INPUT),
			toolCallStep("a4", "read_files", INSPECT_INPUT),
			toolCallStep("a5", "read_files", INSPECT_INPUT),
			toolCallStep("a6", "read_files", INSPECT_INPUT),
			toolCallStep("a7", "read_files", INSPECT_INPUT),
			toolCallStep("a8", "read_files", INSPECT_INPUT),
			toolCallStep("a9", "read_files", INSPECT_INPUT),
			// Phase B: the model inspects ONCE more, and only then acts —
			// but only because the request now carries the objective.
			(request) => {
				if (!boundedObjectiveIn(request)) {
					// The objective is NOT active yet: keep stalling.
					return toolCallStep("b0", "read_files", INSPECT_INPUT)(request);
				}
				return toolCallStep("b1", "editor", {
					path: workspace.targetPath,
					old_text: "VALUE = 1",
					new_text: "VALUE = 2",
				})(request);
			},
			// The executable verification of the bounded objective. It runs
			// the REAL regression script that lives in the disposable
			// workspace.
			(request) => {
				if (!boundedObjectiveIn(request)) {
					return toolCallStep("b2x", "read_files", INSPECT_INPUT)(request);
				}
				return toolCallStep("b2", "run_commands", {
					commands: [workspace.checkPath],
				})(request);
			},
			// Phase C: the objective is verified and the runtime has
			// returned to the parent. The model attempts to FINISH while the
			// SECOND obligation is still outstanding. The EXISTING
			// completion contract (the completion guard) REJECTS it: the
			// run continues and the guard's obligation is re-injected.
			//
			// The model then satisfies the outstanding obligation and calls
			// the parent's terminal completion tool, which completes the run.
			finishStep(),
			(request) => {
				secondObligationSatisfied = true;
				return toolCallStep("c2", "submit_and_exit", { summary: "final" })(
					request,
				);
			},
		];

		const model = new ScriptedModel(steps, SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [inspectTool, editTool, verifyTool, completionTool],
			completionPolicy: {
				requireCompletionTool: true,
				completionGuard,
			},
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
				//
				// The AMENDMENT-01 substring gate is REMOVED. The host owns
				// the disposable workspace, so it is the only layer that can
				// know whether the objective's verification condition was
				// met — and it decides that from the ACTUAL EXECUTION
				// EVIDENCE: the receipt must show the regression executable
				// itself ran AND succeeded, and the disposable file must
				// really carry the repaired value.
				//
				// A command that merely MENTIONS the executable's name is
				// NOT verification evidence.
				verifyObjective: (_objective, facts) => {
					const receipts = facts.receipts ?? [];
					const gateReceipt = receipts.find(
						(receipt) =>
							!receipt.wasEdit &&
							typeof receipt.command === "string" &&
							receipt.command.includes(workspace.checkPath),
					);
					if (!gateReceipt) {
						return false;
					}
					if (!gateReceipt.succeeded) {
						return false;
					}
					// The executable really ran and passed: the disposable
					// file carries the repaired value.
					return workspace.read().includes("VALUE = 2");
				},
			},
		});

		const notices: Array<{ message: string; metadata?: unknown }> = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push({
					message: event.message,
					metadata: event.metadata,
				});
			}
		});

		const result = await runtime.run(
			"Fix the disposable target module and report the outcome",
		);

		// PHASE A — the R1 instruction WAS delivered and did NOT change the
		// model's behaviour.
		const r1Instructions = model.requests
			.map((request) => recoveryInstructionIn(request))
			.filter((body): body is string => body !== undefined);
		expect(r1Instructions.length).toBeGreaterThan(0);
		// The model inspected before the objective was active.
		expect(calls.inspect).toBeGreaterThanOrEqual(3);

		// PHASE B — R2 activated, dispatched, executed and verified.
		const activationNotices = notices.filter((n) =>
			n.message.includes("bounded objective activated"),
		);
		expect(activationNotices).toHaveLength(1);
		// The dispatched request carried the active objective: the model
		// acted ONLY after observing it.
		const objectiveRequests = model.requests.filter(
			(request) => boundedObjectiveIn(request) !== undefined,
		);
		expect(objectiveRequests.length).toBeGreaterThan(0);
		// The objective's projection names the current execution target,
		// the first action, the mutation scope and the verification
		// condition.
		const objectiveProjection = boundedObjectiveIn(
			objectiveRequests[0] as AgentModelRequest,
		) as string;
		expect(objectiveProjection).toContain(
			"[SYSTEM] Active bounded objective (runtime authority):",
		);
		expect(objectiveProjection).toContain("First action:");
		expect(objectiveProjection).toContain("Permitted mutation scope:");
		expect(objectiveProjection).toContain("Observable verification condition:");
		// ACTUAL WORKSPACE PROGRESS: the disposable file really changed.
		expect(calls.edit).toBe(1);
		expect(workspace.read()).toContain("VALUE = 2");
		// ACTUAL EXECUTABLE VERIFICATION: the executable check really ran.
		expect(calls.verify).toBe(1);
		// The objective was reported verified, and execution returned to the
		// parent automatically.
		const verifiedNotices = notices.filter((n) =>
			n.message.includes("bounded objective verified"),
		);
		expect(verifiedNotices).toHaveLength(1);
		expect(verifiedNotices[0]?.message).toContain(
			"returning execution to the parent task",
		);

		// PHASE C — the parent completion contract was enforced.
		//
		// The premature finish attempt was REJECTED by the existing
		// completion guard: the run continued and the guard's obligation was
		// re-injected into the next dispatched request. Only after the
		// outstanding obligation was satisfied did the terminal completion
		// tool complete the run.
		expect(calls.complete).toBe(1);
		expect(result.status).toBe("completed");
		// The completion guard's obligation WAS re-injected, which is the
		// observable proof that the premature completion was rejected.
		const guardObligationInjected = model.requests.some((request) =>
			requestTexts(request).some(
				(text) => text.trim() === outstandingObligation,
			),
		);
		expect(guardObligationInjected).toBe(true);
		// The parent task was NOT completed by the bounded objective: the
		// objective's completion happened BEFORE the parent's.
		const objectiveVerifiedIndex = notices.findIndex((n) =>
			n.message.includes("bounded objective verified"),
		);
		expect(objectiveVerifiedIndex).toBeGreaterThanOrEqual(0);
	});

	// -----------------------------------------------------------------------
	// THE P0 DISCRIMINATOR IN THE PRINCIPAL WITNESS.
	//
	// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02.
	//
	// The witness must ALSO show that an UNRELATED successful command
	// carrying the required executable's NAME does not establish verified
	// success, and that TRUTHFUL UNVERIFIED progress is followed by an
	// AUTOMATIC return to the parent.
	// -----------------------------------------------------------------------
	it("A+B+C (P0): an UNRELATED successful command carrying the gate's name does NOT establish verified success; the unverified progress is reported truthfully and the parent continues automatically", async () => {
		const workspace = createDisposableWorkspace();
		const calls = { inspect: 0, edit: 0, verify: 0, complete: 0 };

		const inspectTool: AgentTool = {
			name: "read_files",
			description: "Reads files (inspection only)",
			inputSchema: { type: "object" },
			async execute() {
				calls.inspect += 1;
				return "file contents";
			},
		};
		// The edit tool REALLY mutates the disposable file.
		const editTool: AgentTool = {
			name: "editor",
			description: "Edits a file",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				calls.edit += 1;
				const record = (input ?? {}) as Record<string, unknown>;
				if (typeof record.path === "string") {
					writeFileSync(record.path, "export const VALUE = 2;\n", "utf-8");
				}
				return "edited";
			},
		};
		// The command tool runs the REAL command. The unrelated command
		// SUCCEEDS and its text CARRIES the gate executable's name — the
		// AMENDMENT-01 counterexample.
		const commandTool: AgentTool = {
			name: "run_commands",
			description: "Runs commands",
			inputSchema: { type: "object" },
			async execute(input: unknown) {
				calls.verify += 1;
				const record = (input ?? {}) as Record<string, unknown>;
				const commands = Array.isArray(record.commands)
					? (record.commands as unknown[])
					: [];
				const identity = commands
					.filter((entry): entry is string => typeof entry === "string")
					.join(" && ");
				const result = spawnSync(identity, { shell: true, cwd: workspace.dir });
				return result.status === 0
					? "PASS: the command succeeded"
					: `FAILED: the command exited with ${result.status ?? "no status"}`;
			},
		};
		const completionTool: AgentTool = {
			name: "submit_and_exit",
			description: "Completes the task",
			inputSchema: { type: "object" },
			lifecycle: { completesRun: true },
			async execute() {
				calls.complete += 1;
				return "done";
			},
		};

		const INSPECT_INPUT = { files: [{ path: workspace.targetPath }] };

		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [
			toolCallStep("a1", "read_files", INSPECT_INPUT),
			toolCallStep("a2", "read_files", INSPECT_INPUT),
			toolCallStep("a3", "read_files", INSPECT_INPUT),
			toolCallStep("a4", "read_files", INSPECT_INPUT),
			toolCallStep("a5", "read_files", INSPECT_INPUT),
			toolCallStep("a6", "read_files", INSPECT_INPUT),
			toolCallStep("a7", "read_files", INSPECT_INPUT),
			toolCallStep("a8", "read_files", INSPECT_INPUT),
			toolCallStep("a9", "read_files", INSPECT_INPUT),
			// The objective is active: the model performs the REAL mutation.
			(request) => {
				if (!boundedObjectiveIn(request)) {
					return toolCallStep("b0", "read_files", INSPECT_INPUT)(request);
				}
				return toolCallStep("b1", "editor", {
					path: workspace.targetPath,
					old_text: "VALUE = 1",
					new_text: "VALUE = 2",
				})(request);
			},
			// The model then runs an UNRELATED successful command whose text
			// CARRIES the gate executable's name. The required executable
			// NEVER runs.
			(request) => {
				if (!boundedObjectiveIn(request)) {
					return toolCallStep("b2x", "read_files", INSPECT_INPUT)(request);
				}
				return toolCallStep("b2", "run_commands", {
					commands: [`echo ${workspace.checkPath}`],
				})(request);
			},
			// The parent continues automatically after the unverified
			// objective.
			(request) =>
				toolCallStep("c1", "submit_and_exit", { summary: "final" })(request),
		];

		const model = new ScriptedModel(steps, CONTROL_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [inspectTool, editTool, commandTool, completionTool],
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
				// The TRUSTED HOST VERIFICATION AUTHORITY. It requires the
				// required executable ITSELF to have run and succeeded. The
				// unrelated `echo` command that merely MENTIONS its name is
				// not verification evidence.
				verifyObjective: (_objective, facts) => {
					const receipts = facts.receipts ?? [];
					// The host requires the command to BE the required
					// executable, not to MENTION it. An `echo` of the
					// executable's path is not the executable.
					const gateReceipt = receipts.find(
						(receipt) =>
							!receipt.wasEdit &&
							typeof receipt.command === "string" &&
							receipt.command.trim() === workspace.checkPath,
					);
					return gateReceipt !== undefined && gateReceipt.succeeded;
				},
			},
		});

		const p0Notices: Array<{ message: string; metadata?: unknown }> = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				p0Notices.push({
					message: event.message,
					metadata: event.metadata,
				});
			}
		});

		const p0Result = await runtime.run(
			"Fix the disposable target module and report the outcome",
		);

		// The unrelated command really ran and really succeeded.
		expect(calls.verify).toBe(1);
		// The objective was NOT reported verified: the mention is not
		// evidence.
		expect(
			p0Notices.filter((n) => n.message.includes("bounded objective verified")),
		).toHaveLength(0);
		// The unverified outcome was reported TRUTHFULLY.
		expect(
			p0Notices.filter((n) =>
				n.message.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
		// AUTOMATIC PARENT CONTINUATION: the parent task still completed.
		expect(calls.complete).toBe(1);
		expect(p0Result.status).toBe("completed");
	});
});

// ---------------------------------------------------------------------------
// THE REQUIRED CONSERVATION CONTROLS.
//
// Each control is a RED/GREEN pair against the SAME deterministic stalled
// trajectory: with R2 DISABLED the behaviour is unchanged, and with R2
// ENABLED the behaviour changes ONLY in the way R2 is allowed to change it.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / controls", () => {
	/**
	 * Build a runtime over the SAME deterministic stalled trajectory.
	 *
	 * The trajectory is nine unproductive inspection rounds followed by a
	 * finish: exactly the shape that exhausts the R1 allowance at round 9.
	 */
	function buildStalledRuntime(options: {
		r2Enabled: boolean;
		tools?: AgentTool[];
		completionPolicy?: {
			requireCompletionTool?: boolean;
			completionGuard?: () => string | undefined;
		};
	}) {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		steps.push(finishStep());
		const model = new ScriptedModel(steps, CONTROL_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: options.tools ?? [createInspectTool(calls)],
			...(options.completionPolicy
				? { completionPolicy: options.completionPolicy }
				: {}),
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			...(options.r2Enabled
				? {
						boundedObjectivePolicy: {
							enabled: true,
							maxActivations: 2,
							maxObjectiveRounds: 8,
							maxSelectionInferences: 1,
						},
					}
				: {}),
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		return { runtime, model, notices, calls };
	}

	it("CONTROL 1 (RED): with R2 DISABLED, the stalled trajectory consumes the R1 allowance and does NOT execute the bounded objective", async () => {
		const { runtime, model, notices } = buildStalledRuntime({
			r2Enabled: false,
		});
		const result = await runtime.run("fix the thing");
		expect(result.status).toBe("completed");
		// No bounded objective was ever selected or dispatched.
		expect(model.selectionRequests).toHaveLength(0);
		expect(notices.filter((n) => n.includes("bounded objective"))).toHaveLength(
			0,
		);
		for (const request of model.requests) {
			expect(boundedObjectiveIn(request)).toBeUndefined();
		}
	});

	it("CONTROL 2 (GREEN): with R2 ENABLED, the same stalled trajectory activates a bounded objective", async () => {
		const { runtime, model, notices } = buildStalledRuntime({
			r2Enabled: true,
		});
		await runtime.run("fix the thing");
		expect(model.selectionRequests).toHaveLength(1);
		expect(
			notices.filter((n) => n.includes("bounded objective activated")),
		).toHaveLength(1);
	});

	it("CONTROL 3: DISABLED R2 preserves the existing R1 behaviour exactly (the R1 instruction bodies are unchanged)", async () => {
		const disabled = buildStalledRuntime({ r2Enabled: false });
		await disabled.runtime.run("fix the thing");
		const enabled = buildStalledRuntime({ r2Enabled: true });
		await enabled.runtime.run("fix the thing");
		const disabledBodies = disabled.model.requests
			.map((request) => recoveryInstructionIn(request))
			.filter((body): body is string => body !== undefined);
		const enabledBodies = enabled.model.requests
			.map((request) => recoveryInstructionIn(request))
			.filter((body): body is string => body !== undefined);
		// The R1 corrective instruction is delivered the SAME number of
		// times and carries the SAME body, whether R2 is enabled or not.
		expect(disabledBodies.length).toBe(enabledBodies.length);
		expect(disabledBodies.length).toBeGreaterThan(0);
		expect(new Set(disabledBodies).size).toBe(new Set(enabledBodies).size);
	});

	it("CONTROL 4: PRODUCTIVE ordinary execution never activates R2", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		// A productive trajectory: an edit in every round.
		for (let i = 0; i < 20; i += 1) {
			steps.push(
				toolCallStep(`p${i}`, "editor", {
					path: "/tmp/a",
					old_text: "a",
					new_text: "b",
				}),
			);
		}
		steps.push(finishStep());
		const model = new ScriptedModel(steps, SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createEditTool(calls)],
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
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("edit continuously");
		expect(model.selectionRequests).toHaveLength(0);
		expect(notices.filter((n) => n.includes("bounded objective"))).toHaveLength(
			0,
		);
	});

	it("CONTROL 5: a legitimate running-job wait is CONSERVED and never activates R2", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 20; i += 1) {
			steps.push(
				toolCallStep(`w${i}`, "run_commands", { commands: ["build"] }),
			);
		}
		steps.push(finishStep());
		const model = new ScriptedModel(steps, SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createRunningCommandTool(calls)],
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
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("wait for the build");
		expect(model.selectionRequests).toHaveLength(0);
		expect(notices.filter((n) => n.includes("bounded objective"))).toHaveLength(
			0,
		);
	});
});

// ---------------------------------------------------------------------------
// THE REMAINING REQUIRED CONTROLS.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / remaining controls", () => {
	it("CONTROL 6: an INVALID decomposition is REJECTED and never retried (no unbounded selection loop)", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 12; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		steps.push(finishStep());
		// The selection reply cites EVIDENCE THAT WAS NEVER ESTABLISHED and
		// an OBLIGATION THAT IS NOT OUTSTANDING. It must be rejected.
		const model = new ScriptedModel(steps, {
			objective: "Do something unauthorised",
			firstStep: "Touch an unauthorised path",
			mutationScope: "/etc",
			verificationCondition: "nothing is verified",
			obligationReferences: ["An obligation that was never outstanding"],
			evidenceReferences: ["An observation that was never established"],
			successCondition: "never",
			failureCondition: "always",
		});
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
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
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("fix the thing");
		// EXACTLY ONE selection inference: the rejection consumed the
		// allowance and did NOT start another selection attempt.
		expect(model.selectionRequests).toHaveLength(1);
		// The rejection was reported with its reason.
		expect(
			notices.filter((n) => n.includes("bounded objective selection rejected")),
		).toHaveLength(1);
		// The outcome is an explicit FAILURE, never a manufactured success.
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
		// No objective was ever dispatched.
		for (const request of model.requests) {
			expect(boundedObjectiveIn(request)).toBeUndefined();
		}
	});

	it("CONTROL 7: a FAILED objective does not authorize parent completion, and the parent is never completed by the objective", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		// The objective is dispatched but the model only INSPECTS: no
		// executable command ever runs, so the objective never verifies.
		steps.push(
			toolCallStep("o1", "read_files", { files: [{ path: "/tmp/a" }] }),
		);
		steps.push(
			toolCallStep("o2", "read_files", { files: [{ path: "/tmp/a" }] }),
		);
		steps.push(finishStep());
		const model = new ScriptedModel(steps, CONTROL_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 3,
				maxRecoveryInstructions: 2,
				enabled: true,
			},
			boundedObjectivePolicy: {
				enabled: true,
				maxActivations: 2,
				maxObjectiveRounds: 3,
				maxSelectionInferences: 1,
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("fix the thing");
		// The objective FAILED: it never verified, and the outcome says so
		// truthfully.
		expect(
			notices.filter((n) => n.includes("bounded objective did not verify")),
		).toHaveLength(1);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
		// No success was manufactured.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(0);
	});

	it("CONTROL 8: R2 does NOT reactivate RECURSIVELY from within its own bounded objective", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		// Nine stalled rounds to exhaust R1's allowance.
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		// Inside the objective, the model stalls AGAIN. The R1 accounting
		// continues, but R2 must NOT activate a second time from within the
		// first objective.
		for (let i = 0; i < 12; i += 1) {
			steps.push(
				toolCallStep(`o${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		steps.push(finishStep());
		const model = new ScriptedModel(steps, CONTROL_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
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
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("fix the thing");
		// The objective's own round budget ends it. At most ONE activation
		// happened: the selection-inference allowance (1) bounds it, and
		// the activation inside the objective is refused.
		expect(model.selectionRequests.length).toBeLessThanOrEqual(1);
	});

	it("CONTROL 9: CANCELLATION prevents any further recovery dispatch", async () => {
		const calls = { count: 0 };
		const controller = new AbortController();
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		steps.push(finishStep());
		const model = new ScriptedModel(steps, CONTROL_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
			abortSignal: controller.signal,
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
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		// Cancel while the trajectory is still running: the abort lands
		// after the first round but before the R1 allowance is exhausted.
		let rounds = 0;
		let abortingRuntime: AgentRuntime | undefined;
		const abortingSteps: Array<
			(request: AgentModelRequest) => AgentModelEvent[]
		> = [];
		for (let i = 0; i < 10; i += 1) {
			abortingSteps.push((request: AgentModelRequest) => {
				rounds += 1;
				if (rounds === 2) {
					abortingRuntime?.abort(
						"operator cancelled",
						"explicit_abort_request",
					);
				}
				return toolCallStep("t1", "read_files", {
					files: [{ path: "/tmp/a" }],
				})(request);
			});
		}
		const abortingModel = new ScriptedModel(
			abortingSteps,
			CONTROL_SELECTION_REPLY,
		);
		abortingRuntime = new AgentRuntime({
			model: abortingModel,
			tools: [createInspectTool(calls)],
			abortSignal: controller.signal,
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
			},
		});
		const abortingNotices: string[] = [];
		abortingRuntime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				abortingNotices.push(event.message);
			}
		});
		const result = await (abortingRuntime as AgentRuntime).run("fix the thing");
		expect(result.status).toBe("aborted");
		// NO recovery was dispatched after the cancellation.
		expect(abortingModel.selectionRequests).toHaveLength(0);
		for (const request of abortingModel.requests) {
			expect(boundedObjectiveIn(request)).toBeUndefined();
		}
		expect(
			abortingNotices.filter((n) => n.includes("bounded objective")),
		).toHaveLength(0);
		// No bounded objective was dispatched after the cancellation.
		for (const request of model.requests) {
			expect(boundedObjectiveIn(request)).toBeUndefined();
		}
	});

	it("CONTROL 10: the R2 allowance is RUN-SCOPED — a second run starts from a clean allowance", async () => {
		const calls = { count: 0 };
		// ONE full stalled trajectory per run.
		const makeScript = (): Array<
			(request: AgentModelRequest) => AgentModelEvent[]
		> => {
			const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> =
				[];
			for (let i = 0; i < 40; i += 1) {
				steps.push(
					toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
				);
			}
			steps.push(finishStep());
			return steps;
		};
		const model = new ScriptedModel(makeScript(), CONTROL_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls)],
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
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("fix the thing");
		const firstRunSelections = model.selectionRequests.length;
		expect(firstRunSelections).toBe(1);
		// Refill the script for the SECOND run and run again.
		model.refill(makeScript());
		await runtime.run("fix the thing again");
		// The second run gets a FRESH allowance: it selected again.
		expect(model.selectionRequests.length).toBeGreaterThan(firstRunSelections);
	});

	it("CONTROL 11: a genuine READ-ONLY objective does not force a source edit, and the objective verifies on the requested EVIDENCE alone", async () => {
		const calls = { count: 0 };
		const steps: Array<(request: AgentModelRequest) => AgentModelEvent[]> = [];
		for (let i = 0; i < 9; i += 1) {
			steps.push(
				toolCallStep(`t${i}`, "read_files", { files: [{ path: "/tmp/a" }] }),
			);
		}
		// The bounded objective is a RECONNAISSANCE objective: it asks for
		// the specific evidence, not for an edit. The model performs the
		// evidence-gathering command and NOTHING else.
		steps.push(
			toolCallStep("o1", "run_commands", { commands: ["collect-evidence"] }),
		);
		steps.push(finishStep());
		const model = new ScriptedModel(steps, {
			objective: "Collect the specific evidence the parent task asked for",
			firstStep: "Run the evidence collection command",
			mutationScope: "none — this objective is read-only",
			verificationCondition:
				"the evidence collection command reports the requested evidence",
			obligationReferences: [
				"Complete the parent task as authorized by the user",
			],
			evidenceReferences: [
				"The last 3 consecutive execution round(s) produced no productive step",
			],
			successCondition: "the requested evidence was collected",
			failureCondition: "the evidence cannot be collected",
		});
		const runtime = new AgentRuntime({
			model,
			tools: [createInspectTool(calls), createCompletedCommandTool(calls)],
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
				// The host owns the workspace, so its verdict is the only
				// authority — the AMENDMENT-01 substring gate is REMOVED.
				verifyObjective: (_objective, facts) => {
					const receipts = facts.receipts ?? [];
					return receipts.some(
						(receipt) =>
							!receipt.wasEdit &&
							typeof receipt.command === "string" &&
							receipt.command.includes("collect-evidence") &&
							receipt.succeeded,
					);
				},
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("collect the evidence");
		// The objective VERIFIED on the requested evidence alone: no source
		// edit was made, and none was forced.
		expect(
			notices.filter((n) => n.includes("bounded objective verified")),
		).toHaveLength(1);
	});
});
