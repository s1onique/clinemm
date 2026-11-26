/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01
 *
 * PRINCIPAL PRODUCTION RUNTIME WITNESS.
 *
 * WHAT THIS FILE PROVES
 * ---------------------
 * A SHORT, DETERMINISTIC trajectory of repeated RECOGNISED REMOTE SOURCE
 * INSPECTIONS, driven through the REAL `AgentRuntime` with the REAL
 * production host classifier, shows the five required facts:
 *
 *   1. The PREDECESSOR classifier misclassifies the remote inspections as
 *      execution.
 *   2. R1 does NOT activate as required on the predecessor's reading.
 *   3. The CORRECTED classifier increments the stagnation streak.
 *   4. The EXISTING R1 allowance is consumed.
 *   5. The EXISTING R2 entry condition becomes REACHABLE.
 *
 * and, as the CONSERVATION control, a second trajectory containing GENUINE
 * REMOTE BUILD ACTIVITY still produces productive rounds.
 *
 * WHAT THIS FILE DOES NOT PROVE
 * -----------------------------
 * It does not duplicate the R2 qualification suite, and it does not prove
 * live behavioral recovery: a deterministic trajectory reports WHEN the
 * detector WOULD have intervened. No new recovery mechanism is introduced
 * here — the R1 threshold, the R1 allowance, the R2 activation limits and
 * the R2 selection limits are the EXISTING ones, unchanged.
 *
 * EVIDENCE CLASS
 * --------------
 * SYNTHETIC_REAL_PRODUCTION_SEAM — the runtime is the real `AgentRuntime`,
 * the classifier is the real production host classifier, and the decision
 * function is the real pure decision function from `@cline/shared`.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeEvent,
	AgentTool,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createHostExecutionProgressClassifier as createDefectivePredecessorClassifier } from "./__fixtures__/defective-execution-progress-classifier";
import { createHostExecutionProgressClassifier } from "./execution-progress-classifier";

/**
 * A deterministic scripted model. Every step is a canned response.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01:
 * the model also serves the R2 SELECTION INFERENCE. The selection inference
 * carries NO tools (it names an objective; it executes nothing), while every
 * execution request carries the runtime's tool set — that is the SAME
 * discriminator the existing R2 suite uses.
 */
class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	readonly selectionRequests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
		private readonly selectionReply?: Record<string, unknown>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const isSelectionRequest = (request.tools ?? []).length === 0;
		if (isSelectionRequest) {
			this.selectionRequests.push(request);
			const reply = JSON.stringify(this.selectionReply ?? {});
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
		return (async function* () {
			for await (const ev of step(request)) yield ev;
		})();
	}
}

/** One round that calls a tool and asks for another round. */
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

/** One round that produces only text and finishes. */
function finishStep(): AgentModelEvent[] {
	return [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

/**
 * The `run_commands` tool, whose result carries the PRODUCTION completed
 * observation envelope (`{ ok: true, exitCode: 0 }`).
 *
 * The result is a COMPLETED, SUCCESSFUL observation: the classifier must
 * classify the command by its SHAPE, not by an outcome it already read.
 */
function createCommandTool(calls: { count: number }): AgentTool {
	return {
		name: "run_commands",
		description: "Runs commands",
		inputSchema: { type: "object" },
		async execute() {
			calls.count += 1;
			return [{ ok: true, exitCode: 0, stdout: "", stderr: "" }];
		},
	};
}

/**
 * The RECOGNISED REMOTE SOURCE INSPECTION commands — the EXACT historical
 * command shape from the frozen session's reconnaissance rounds.
 *
 * They are CLASSIFICATION INPUTS: the witness's command tool never executes
 * them, it only counts the call.
 */
const REMOTE_INSPECTION_COMMANDS: readonly string[] = [
	'ssh host \'grep -n "proc*" "$L/posix/posix.nim"\'',
	'ssh host \'grep -n "type Process" "$L/posix/posix.nim"\'',
	'ssh host \'grep -rn "osproc" "$L/"\'',
	'ssh host \'sed -n "330,420p" "$L/posix/osproc.nim"\'',
	"ssh host 'ls \"$L/posix\"'",
	'ssh host \'grep -n "socket" "$L/posix/posix.nim"\'',
	'ssh host \'grep -rn "proc_open" "$L/"\'',
];

/**
 * The HISTORICAL REMOTE INSPECTION commands WITH the DESCRIPTOR DUPLICATION
 * suffix the frozen session actually used.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01:
 * every historical reconnaissance command of the frozen Session A transcript
 * ends with `2>&1 | tail -N`. That suffix is a DESCRIPTOR DUPLICATION, not a
 * command separator, and the defective predecessor classifier read it as a
 * separator.
 *
 * These are the EXACT historical command strings — CLASSIFICATION INPUTS
 * ONLY. The witness never executes them and never opens an SSH connection.
 */
const HISTORICAL_REMOTE_INSPECTION_COMMANDS: readonly string[] = [
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; ls $N/lib | grep -E "^(sha2|monotimes|httpclient|osproc|json|unittest|times|posix)\\.nimle?$"; grep -n "proc fsync" $N/lib/posix/posix_linux_amd64.nim | head -3; grep -rn "flock" $N/lib/posix/*.nim | head -5; grep -n "proc sha256" $N/lib/pure/sha2.nim | head -3; grep -n "proc getMonoTime" $N/lib/std/monotimes.nim | head -3\' 2>&1 | tail -30',
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; ls $N/lib $N/lib/pure $N/lib/std | grep -iE "sha|http|mono|proc|json|unit" ; echo ---; grep -rn "sha256" $N/lib/pure/*.nim | head -5; echo ---; grep -rn "proc fsync\\|proc open\\b" $N/lib/posix/posix_linux_amd64.nim | head\' 2>&1 | tail -40',
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; grep -rn "fsync\\|proc open\\*\\|O_CREAT" $N/lib/posix/*.nim | head -20; echo ---; grep -rn "proc readFile\\|proc writeFile" $N/lib/system/io.nim | head\' 2>&1 | tail -30',
	"SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.11 'N=~/nim/nim-2.2.4; grep -n \"streamOut\\|streamErr\\|proc startProcess\\|proc running\\|proc terminate\\|proc waitFor\\|proc close\\|type Process\\*\\|poStdErrToStdOut\\|proc execCmdEx\\|proc peekExitCode\" $N/lib/pure/osproc.nim | head -40' 2>&1 | tail -45",
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; sed -n "330,420p" $N/lib/pure/osproc.nim; echo =====; sed -n "955,1060p" $N/lib/pure/osproc.nim\' 2>&1 | tail -140',
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; sed -n "55,120p" $N/lib/pure/osproc.nim; echo =====; sed -n "780,830p" $N/lib/pure/osproc.nim\' 2>&1 | tail -120',
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; grep -n "^  proc \\\\(fcntl\\|poll\\|waitpid\\|kill\\|dup2\\|execv\\|execve\\|pipe\\|fork\\|read\\|write\\|close\\|open\\|fcntl\\)\\b" $N/lib/posix/posix.nim | head -40; echo ---; grep -n "O_NONBLOCK\\|F_SETFL\\|SIGKILL\\|WNOHANG" $N/lib/posix/posix_linux_amd64_consts.nim | head -10\' 2>&1 | tail -50',
	'SSH_AUTH_SOCK=/private/tmp/com.apple.launchd.d79HgW0fyF/Listeners ssh -o BatchMode=yes 192.168.50.111 \'N=~/nim/nim-2.2.4; grep -n "proc \\\\(waitpid\\|kill\\|dup2\\|execv\\|execve\\|pipe\\|fork\\|read\\|write\\|close\\|fcntl\\|open\\)\\*" $N/lib/posix/posix.nim | head -40; echo ---; grep -n "proc \\\\(waitpid\\|kill\\|dup2\\|execv\\|pipe\\|fork\\|read\\|write\\|close\\|fcntl\\)\\*" $N/lib/posix/posix_linux_amd64.nim | head -40\' 2>&1 | tail -60',
];

/** A GENUINE REMOTE BUILD command — real work, not reconnaissance. */
const REMOTE_BUILD_COMMANDS: readonly string[] = [
	"ssh host 'nim c -d:release src/main.nim'",
	"ssh host 'make build'",
];

/**
 * The FROZEN DEFECTIVE PREDECESSOR production classifier.
 *
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01:
 * the predecessor the witness compares against is the ACTUAL production
 * classifier at commit 1708f1e8f (Git blob
 * b8029cada039e371cdf2d0a2dc2b987dfc1926c4), frozen verbatim under
 * `./__fixtures__/defective-execution-progress-classifier.ts`.
 *
 * This file does NOT re-implement the predecessor's logic and does NOT carry
 * a test-local program whitelist: it drives the real predecessor module.
 */
const DEFECTIVE_PREDECESSOR_CLASSIFIER = createDefectivePredecessorClassifier();

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 / principal production runtime witness", () => {
	it("the DEFECTIVE PREDECESSOR production classifier already recognises the SSH transport shape", () => {
		// The frozen defective predecessor is the production classifier at
		// commit 1708f1e8f. It already recognises the SSH TRANSPORT
		// wrapper: the remote payload is classified, not the local first
		// token. This witness pins that fact so the amendment's own
		// discriminator is unambiguous: the defect this ACT repairs is the
		// DESCRIPTOR DUPLICATION, not the SSH transport.
		for (const command of REMOTE_INSPECTION_COMMANDS) {
			expect(
				DEFECTIVE_PREDECESSOR_CLASSIFIER(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("inspected");
		}
	});

	it("the CORRECTED classifier recognises the remote inspections as inspections", () => {
		const classify = createHostExecutionProgressClassifier();
		for (const command of REMOTE_INSPECTION_COMMANDS) {
			expect(
				classify(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("inspected");
		}
		// And the genuine remote build is still an execution.
		for (const command of REMOTE_BUILD_COMMANDS) {
			expect(
				classify(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("executed");
		}
	});

	it("R1 activates on the corrected reading and consumes the EXISTING allowance", async () => {
		const calls = { count: 0 };
		// The trajectory: the threshold (2) is below the production default
		// (5) so the witness stays SHORT; the ALLOWANCE is the production
		// default (2). Both are the EXISTING policy values — only the
		// threshold is lowered so the witness fits in a short trajectory.
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		for (const [index, command] of REMOTE_INSPECTION_COMMANDS.entries()) {
			steps.push(
				toolCallStep(`t${index}`, "run_commands", { commands: [command] }),
			);
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createCommandTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: createHostExecutionProgressClassifier(),
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		const result = await runtime.run("inspect the remote sources");
		expect(result.status).toBe("completed");
		expect(calls.count).toBe(REMOTE_INSPECTION_COMMANDS.length);

		// (4) The EXISTING R1 allowance is consumed: exactly TWO corrective
		// instructions are injected, and no more.
		const stagnationNotices = notices.filter((n) =>
			n.includes("execution stagnation detected"),
		);
		expect(stagnationNotices).toHaveLength(2);
		expect(stagnationNotices[0]).toContain(
			"injecting a recovery instruction (attempt 1/2)",
		);
		expect(stagnationNotices[1]).toContain(
			"injecting a recovery instruction (attempt 2/2)",
		);

		// (3) The corrected classifier increments the stagnation streak: the
		// first notice reports TWO consecutive unproductive rounds, which is
		// only possible if the remote inspections were counted as
		// UNPRODUCTIVE rather than productive.
		expect(stagnationNotices[0]).toContain("after 2 unproductive round(s)");
		// The injected corrective instruction carries the OBSERVABLE facts:
		// the tool NAME — never the command's text, never a path.
		const instruction = model.requests
			.flatMap((request) => request.messages ?? [])
			.flatMap((message) =>
				Array.isArray(message.content)
					? message.content.flatMap((part) =>
							part && typeof part === "object" && "text" in part
								? [String((part as { text: unknown }).text)]
								: [],
						)
					: [],
			)
			.find((text) => text.startsWith("[SYSTEM] Execution has stalled:"));
		expect(instruction).toBeDefined();
		expect(instruction).toContain("run_commands");
		expect(instruction).toContain("the last 2 consecutive execution round(s)");
		expect(instruction).toContain("No edit was attempted in those rounds.");
		// It never names the command's text or a path.
		expect(instruction).not.toContain("ssh");
		expect(instruction).not.toContain("$L");
	});

	it("CONSERVATION: a trajectory with GENUINE remote build activity still produces productive rounds", async () => {
		const calls = { count: 0 };
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		// Alternate a remote inspection with a genuine remote build.
		for (const [index, command] of REMOTE_BUILD_COMMANDS.entries()) {
			steps.push(
				toolCallStep(`b${index}`, "run_commands", { commands: [command] }),
			);
			steps.push(
				toolCallStep(`i${index}`, "run_commands", {
					commands: [REMOTE_INSPECTION_COMMANDS[index]],
				}),
			);
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps);
		const runtime = new AgentRuntime({
			model,
			tools: [createCommandTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: createHostExecutionProgressClassifier(),
			},
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("build the remote target");
		// The genuine remote build RESETS the streak every time, so the
		// streak never reaches the threshold of 2 and NO corrective
		// instruction is injected. Legitimate engineering progress is
		// conserved.
		expect(
			notices.filter((n) => n.includes("execution stagnation detected")),
		).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01
//
// THE ACTUAL R2 ENTRY WITNESS.
//
// The predecessor witness above configures R1 ONLY: it proves that the
// corrected classifier increments the stagnation streak and that the EXISTING
// R1 allowance is consumed. It never configures R2 and never observes R2's
// activation.
//
// This block closes that gap. It drives a SHORT trajectory of the HISTORICAL
// remote inspection shape — WITH the descriptor duplication the frozen
// session actually used — through the REAL `AgentRuntime` with R2 CONFIGURED,
// and establishes the ACTUAL R2 entry witness.
// ---------------------------------------------------------------------------

/**
 * The R2 SELECTION REPLY the scripted model returns for the ONE selection
 * inference.
 *
 * It is the EXISTING R2 selection-rejection control: the reply cites an
 * obligation that is NOT outstanding and an observation that was never
 * established, so the runtime's validator REJECTS it. The rejection consumes
 * the selection-inference allowance and MUST NOT start another attempt.
 */
const REJECTED_SELECTION_REPLY: Record<string, unknown> = {
	objective: "Do something unauthorised",
	firstStep: "Touch an unauthorised path",
	mutationScope: "/etc",
	verificationCondition: "nothing is verified",
	obligationReferences: ["An obligation that was never outstanding"],
	evidenceReferences: ["An observation that was never established"],
	successCondition: "never",
	failureCondition: "always",
};

/** The R2 policy, reusing the EXISTING R2 activation and selection limits. */
const R2_POLICY = {
	enabled: true,
	maxActivations: 2,
	maxObjectiveRounds: 8,
	maxSelectionInferences: 1,
} as const;

describe("ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 (AMENDMENT-01) / actual R2 entry witness", () => {
	it("the DEFECTIVE PREDECESSOR production classifier does NOT reach the R2 entry branch", () => {
		// The RED condition, driven by the ACTUAL defective production
		// classifier: the historical inspection shape carries the trailing
		// `2>&1 | tail -N` DESCRIPTOR DUPLICATION, so the predecessor reads
		// it as a command separator and reports the reconnaissance as a
		// productive execution.
		for (const command of HISTORICAL_REMOTE_INSPECTION_COMMANDS) {
			expect(
				DEFECTIVE_PREDECESSOR_CLASSIFIER(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("executed");
		}
	});

	it("the REPAIRED production classifier recognises the historical inspection shape", () => {
		const classify = createHostExecutionProgressClassifier();
		for (const command of HISTORICAL_REMOTE_INSPECTION_COMMANDS) {
			expect(
				classify(
					"run_commands",
					{ commands: [command] },
					{ output: [{ ok: true, exitCode: 0 }] },
				),
				`command: ${command}`,
			).toBe("inspected");
		}
	});

	it("reaches the EXISTING R2 entry branch, runs EXACTLY ONE selection inference and manufactures NO further selection allowance", async () => {
		const calls = { count: 0 };
		const steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		> = [];
		// A short trajectory of the HISTORICAL remote inspection shape. The
		// R1 threshold (2) is below the production default (5) so the
		// witness stays SHORT; the R1 allowance (2) and the R2 limits are
		// the EXISTING ones.
		for (const [
			index,
			command,
		] of HISTORICAL_REMOTE_INSPECTION_COMMANDS.entries()) {
			steps.push(
				toolCallStep(`h${index}`, "run_commands", { commands: [command] }),
			);
		}
		steps.push(() => finishStep());
		const model = new ScriptedModel(steps, REJECTED_SELECTION_REPLY);
		const runtime = new AgentRuntime({
			model,
			tools: [createCommandTool(calls)],
			executionStagnationPolicy: {
				unproductiveRoundThreshold: 2,
				maxRecoveryInstructions: 2,
				enabled: true,
				classifyToolCall: createHostExecutionProgressClassifier(),
			},
			boundedObjectivePolicy: R2_POLICY,
		});
		const notices: string[] = [];
		runtime.subscribe((event: AgentRuntimeEvent) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});
		await runtime.run("inspect the remote sources");

		// (1) The R1 allowance is CONSUMED: exactly TWO corrective
		// instructions are injected, and no more.
		const stagnationNotices = notices.filter((n) =>
			n.includes("execution stagnation detected"),
		);
		expect(stagnationNotices).toHaveLength(2);
		expect(stagnationNotices[0]).toContain(
			"injecting a recovery instruction (attempt 1/2)",
		);
		expect(stagnationNotices[1]).toContain(
			"injecting a recovery instruction (attempt 2/2)",
		);

		// (2) The SUBSEQUENT QUALIFYING ROUND reaches the EXISTING R2 entry
		// branch — the R1 `allowance_exhausted` branch, which is the ONLY
		// R2 entry point.
		const r2Notices = notices.filter((n) =>
			n.includes("R1 recovery allowance exhausted"),
		);
		expect(r2Notices).toHaveLength(1);
		expect(r2Notices[0]).toContain("selecting a bounded objective");

		// (3) EXACTLY ONE selection inference executes.
		expect(model.selectionRequests).toHaveLength(1);

		// (4) NO ADDITIONAL selection allowance is manufactured: the
		// rejection consumed the ONE permitted selection inference and was
		// never retried.
		expect(
			notices.filter((n) => n.includes("bounded objective selection rejected")),
		).toHaveLength(1);
		expect(
			notices.filter((n) =>
				n.includes("bounded objective recovery outcome: failed"),
			),
		).toHaveLength(1);
		// No bounded objective was ever dispatched.
		for (const request of model.requests) {
			expect(
				(request.systemPrompt ?? "").includes(
					"[SYSTEM] Active bounded objective (runtime authority):",
				),
			).toBe(false);
		}
	});
});
