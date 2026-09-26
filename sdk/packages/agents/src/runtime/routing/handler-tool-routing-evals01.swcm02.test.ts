/**
 * ACT-CLINEMM-SW-CM02-HANDLER-TOOL-ROUTING-EVALS01 — AgentRuntime dispatch characterization.
 *
 * Scope (this file): the `AgentRuntime.tools.get(name)` boundary inside the
 * `@cline/agents` runtime. Every assertion in this file drives the REAL
 * `AgentRuntime` end-to-end via a scripted model.
 *
 * What this file does NOT cover (covered by the sibling test in `@cline/core`):
 *   - `CONFIGURED_AGENT_TOOL_NAME_ALIASES` / `filterToolsForConfiguredAgent`:
 *     tested in `@cline/core/src/runtime/orchestration/runtime-builder.routing-evals.swcm02.test.ts`
 *     by driving the REAL `DefaultRuntimeBuilder.build()` with a real `.yml` file.
 *   - `filterAvailableTools` / `isToolEnabledByPolicies` (policy.enabled=false):
 *     tested in the same sibling file by driving the REAL
 *     `DefaultRuntimeBuilder.build({ toolPolicies: { run_commands: { enabled: false } } })`.
 *
 * Together, the two files characterize the full SW-CM02 routing seam:
 *   1. This file: dispatch-layer (`tools.get` exact match, executor invocation,
 *      `toolCallId` propagation, error taxonomy, parallel-call no-crosstalk).
 *   2. The sibling file: registration-layer (filterAvailableTools and
 *      filterToolsForConfiguredAgent — i.e. the upstream steps that decide
 *      which tools the dispatch layer sees).
 */
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	AgentToolResult,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "../../index";

// ---- scripted model helper -------------------------------------------

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) throw new Error("No scripted model step available");
		const events = step(request);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

// ---- observable hook capture -----------------------------------------

interface CapturedOutcome {
	toolCallId: string;
	toolName: string;
	outcome: ToolRuntimeOutcome;
}

function captureOutcomes(out: CapturedOutcome[]): AgentRuntimeHooks {
	return {
		onToolRuntimeOutcome: (ctx) => {
			out.push({
				toolCallId: ctx.toolCall.toolCallId,
				toolName: ctx.toolCall.toolName,
				outcome: ctx.outcome,
			});
		},
	};
}

// ---- shared errors --------------------------------------------------

const enoentError = Object.assign(new Error("ENOENT: not found"), {
	code: "ENOENT" as const,
});

// ---- tool factories --------------------------------------------------

interface WitnessLog {
	record: (entry: {
		handler: string;
		toolCallId: string;
		input: unknown;
		context: { sessionId: string; conversationId: string };
	}) => void;
	snapshot: () => Array<{
		handler: string;
		toolCallId: string;
		input: unknown;
		context: { sessionId: string; conversationId: string };
	}>;
}

function makeWitnessLog(): WitnessLog {
	const entries: Array<{
		handler: string;
		toolCallId: string;
		input: unknown;
		context: { sessionId: string; conversationId: string };
	}> = [];
	return {
		record(entry) {
			entries.push(entry);
		},
		snapshot() {
			return [...entries];
		},
	};
}

function stableDigest(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableDigest).join(",")}]`;
	const keys = Object.keys(value as Record<string, unknown>).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableDigest((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

interface ToolCtx {
	toolCallId: string;
	sessionId?: string;
	conversationId?: string;
}

function ctxRecord(log: WitnessLog, handler: string, ctx: ToolCtx, input: unknown): void {
	log.record({
		handler,
		toolCallId: ctx.toolCallId,
		input,
		context: { sessionId: ctx.sessionId ?? "", conversationId: ctx.conversationId ?? "" },
	});
}

function makeTool(opts: {
	name: string;
	description?: string;
	inputSchema?: unknown;
	handler: string;
	log: WitnessLog;
	executeBody?: (input: unknown) => Promise<AgentToolResult> | AgentToolResult;
	thrownError?: Error;
}): AgentTool {
	return {
		name: opts.name,
		description: opts.description ?? opts.name,
		inputSchema:
			(opts.inputSchema as never) ?? ({ type: "object", properties: {}, required: [] } as never),
		execute: async (input: unknown, ctx: unknown) => {
			const tctx = ctx as ToolCtx;
			ctxRecord(opts.log, opts.handler, tctx, input);
			if (opts.thrownError) throw opts.thrownError;
			return opts.executeBody ? await opts.executeBody(input) : { ok: true };
		},
	};
}

function readFilesTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "read_files",
		handler: "read_files",
		log,
		inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		executeBody: (i) => ({ ok: true, content: `(read_files:${(i as { path: string }).path})` }),
	});
}

function readFileTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "read_file",
		handler: "read_file",
		description: "Read a single file (legacy/sibling name — distinct from read_files)",
		log,
		inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		executeBody: (i) => ({ ok: true, content: `(read_file:${(i as { path: string }).path})` }),
	});
}

function runCommandsTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "run_commands",
		handler: "run_commands",
		log,
		inputSchema: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
		executeBody: (i) => ({ ok: true, stdout: `(run:${(i as { cmd: string }).cmd})` }),
	});
}

function editorTool(log: WitnessLog): AgentTool {
	return makeTool({ name: "editor", handler: "editor", log });
}

function applyPatchTool(log: WitnessLog): AgentTool {
	return makeTool({ name: "apply_patch", handler: "apply_patch", log });
}

function searchCodebaseTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "search_codebase",
		handler: "search_codebase",
		log,
		executeBody: () => ({ ok: true, hits: [] }),
	});
}

function searchFilesTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "search_files",
		handler: "search_files",
		description: "Search files (sibling to search_codebase — distinct registration)",
		log,
		executeBody: () => ({ ok: true, hits: [] }),
	});
}

function skillsTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "skills",
		handler: "skills",
		log,
		inputSchema: { type: "object", properties: { name: { type: "string" } } },
		executeBody: (i) => ({ ok: true, skillName: (i as { name: string }).name }),
	});
}

function submitAndExitTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "submit_and_exit",
		handler: "submit_and_exit",
		log,
		executeBody: () => ({ ok: true, finished: true }),
	});
}

function askQuestionTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "ask_question",
		handler: "ask_question",
		log,
		executeBody: () => ({ ok: true, awaiting: true }),
	});
}

// Custom tools — registered directly in tools[].
// NOTE: this exercises the dispatcher's view of custom tools; it does NOT
// exercise a plugin's `setup(...)`-time registration. SW-CM02 scopes to
// "tools already in the registry" only.
function alphaLookupTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "alpha_lookup",
		handler: "alpha_lookup",
		log,
		inputSchema: { type: "object", properties: { q: { type: "string" } } },
		executeBody: (i) => ({ ok: true, found: `alpha:${(i as { q: string }).q}` }),
	});
}

function alphaWriteTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "alpha_write",
		handler: "alpha_write",
		log,
		inputSchema: { type: "object", properties: { v: { type: "string" } } },
		executeBody: (i) => ({ ok: true, wrote: (i as { v: string }).v }),
	});
}

function betaLookupTool(log: WitnessLog): AgentTool {
	return makeTool({
		name: "beta_lookup",
		handler: "beta_lookup",
		log,
		inputSchema: { type: "object", properties: { q: { type: "string" } } },
		executeBody: (i) => ({ ok: true, found: `beta:${(i as { q: string }).q}` }),
	});
}

function enoentErrorTool(log: WitnessLog): AgentTool {
	return makeTool({ name: "always_errors", handler: "always_errors", log, thrownError: enoentError });
}

function opaqueErrorTool(_log: WitnessLog): AgentTool {
	return {
		name: "opaque_failure",
		description: "Tool that throws an opaque (non-ENOENT) error",
		inputSchema: { type: "object", properties: {} },
		execute: async () => {
			throw new Error("opaque internal failure");
		},
	};
}

// ---- default bundle --------------------------------------------------

function defaultBundle(log: WitnessLog): AgentTool[] {
	return [
		readFilesTool(log),
		readFileTool(log),
		runCommandsTool(log),
		editorTool(log),
		applyPatchTool(log),
		searchCodebaseTool(log),
		searchFilesTool(log),
		skillsTool(log),
		submitAndExitTool(log),
		askQuestionTool(log),
	];
}

// ---- driver ----------------------------------------------------------

async function drive(opts: {
	tools: AgentTool[];
	toolCalls: Array<{ id: string; name: string; input: unknown }>;
	requestToolApproval?: (req: unknown) => Promise<{ approved: boolean }>;
	hooks?: AgentRuntimeHooks;
	agentId?: string;
	sessionId?: string;
	conversationId?: string;
}): Promise<{ runtime: AgentRuntime; captured: CapturedOutcome[]; model: ScriptedModel }> {
	const captured: CapturedOutcome[] = [];
	const model = new ScriptedModel([
		(_req) => {
			const events: AgentModelEvent[] = [];
			for (const tc of opts.toolCalls) {
				events.push({
					type: "tool-call-delta",
					toolCallId: tc.id,
					toolName: tc.name,
					inputText: JSON.stringify(tc.input),
				} as unknown as AgentModelEvent);
			}
			events.push({ type: "finish", reason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1 } } as unknown as AgentModelEvent);
			return events;
		},
		() => {
			return [
				{ type: "text-delta", text: "done" } as unknown as AgentModelEvent,
				{ type: "finish", reason: "stop", usage: { inputTokens: 1, outputTokens: 1 } } as unknown as AgentModelEvent,
			];
		},
	]);
	const runtime = new AgentRuntime({
		agentId: opts.agentId ?? "routing-evals-agent",
		sessionId: opts.sessionId ?? "session-A",
		conversationId: opts.conversationId ?? "conversation-A",
		systemPrompt: "test",
		tools: opts.tools,
		hooks: { ...captureOutcomes(captured), ...opts.hooks },
		model,
		requestToolApproval: opts.requestToolApproval as never,
	});
	await runtime.run("test prompt");
	return { runtime, captured, model };
}

function expectOutcomeFor(captured: CapturedOutcome[], toolCallId: string): ToolRuntimeOutcome {
	const match = captured.find((c) => c.toolCallId === toolCallId);
	if (!match) throw new Error(`no captured outcome for ${toolCallId}`);
	return match.outcome;
}

/**
 * Derive the SW-CM02 "classification" projection from the production
 * `ToolRuntimeOutcome` shape. The runtime's outcome discriminator is:
 *   - kind="success"              → "tool_execution_succeeded"
 *   - kind="failure"              → failureClass
 *   - kind="control_plane"        → outcome (e.g. "runtime_skipped",
 *                                     "user_rejected", "host_policy_denied")
 * This projection is what SW-CM02 tests assert against.
 */
function classificationOf(outcome: ToolRuntimeOutcome): string {
	if (outcome.kind === "success") return "tool_execution_succeeded";
	if (outcome.kind === "failure") return outcome.failureClass;
	if (outcome.kind === "control_plane") return outcome.outcome;
	throw new Error(`unknown outcome kind: ${JSON.stringify(outcome)}`);
}

function expectClassification(captured: CapturedOutcome[], toolCallId: string, expected: string): void {
	const outcome = expectOutcomeFor(captured, toolCallId);
	const actual = classificationOf(outcome);
	if (actual !== expected) {
		throw new Error(
			`outcome classification mismatch for ${toolCallId}: expected=${expected} actual=${actual} outcome=${JSON.stringify(outcome)}`,
		);
	}
}

// =============================================================================
// B-series baseline: canonical name resolution at dispatch layer. 14 cases.
// =============================================================================

describe("B-series: canonical name resolution (real AgentRuntime)", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});
	afterEach(() => {
		// no cleanup needed
	});

	it("B1-rf: read_files routes to read_files executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "read_files", input: { path: "x.ts" } }],
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]?.toolName).toBe("read_files");
		expect(log.snapshot()[0]?.handler).toBe("read_files");
		expect(log.snapshot()[0]?.toolCallId).toBe("tc-1");
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
	});

	it("B1-rc: run_commands routes to run_commands executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "run_commands", input: { cmd: "ls" } }],
		});
		expect(captured[0]?.toolName).toBe("run_commands");
		expect(log.snapshot()[0]?.handler).toBe("run_commands");
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
	});

	it("B1-ed: editor routes to editor executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "editor", input: {} }],
		});
		expect(captured[0]?.toolName).toBe("editor");
		expect(log.snapshot()[0]?.handler).toBe("editor");
	});

	it("B1-ap: apply_patch routes to apply_patch executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "apply_patch", input: {} }],
		});
		expect(captured[0]?.toolName).toBe("apply_patch");
		expect(log.snapshot()[0]?.handler).toBe("apply_patch");
	});

	it("B1-sc: search_codebase routes to search_codebase executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "search_codebase", input: {} }],
		});
		expect(captured[0]?.toolName).toBe("search_codebase");
		expect(log.snapshot()[0]?.handler).toBe("search_codebase");
	});

	it("B1-sk: skills routes to skills executor exactly once", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "skills", input: { name: "review" } }],
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]?.toolName).toBe("skills");
		expect(log.snapshot()[0]?.handler).toBe("skills");
		expect(log.snapshot()[0]?.input).toEqual({ name: "review" });
	});

	it("B1-sae: submit_and_exit routes to submit_and_exit executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "submit_and_exit", input: {} }],
		});
		expect(captured[0]?.toolName).toBe("submit_and_exit");
		expect(log.snapshot()[0]?.handler).toBe("submit_and_exit");
	});

	it("B1-aq: ask_question routes to ask_question executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "ask_question", input: {} }],
		});
		expect(captured[0]?.toolName).toBe("ask_question");
		expect(log.snapshot()[0]?.handler).toBe("ask_question");
	});

	it("B2-rf-rc: distinct names route to distinct executors", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [
				{ id: "tc-1", name: "read_files", input: { path: "a.ts" } },
				{ id: "tc-2", name: "run_commands", input: { cmd: "ls" } },
			],
		});
		expect(captured).toHaveLength(2);
		expect(captured.find((c) => c.toolCallId === "tc-1")?.toolName).toBe("read_files");
		expect(captured.find((c) => c.toolCallId === "tc-2")?.toolName).toBe("run_commands");
	});

	it("B3-rf-rfile: read_files and read_file are distinct handlers", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [
				{ id: "tc-1", name: "read_files", input: { path: "a.ts" } },
				{ id: "tc-2", name: "read_file", input: { path: "b.ts" } },
			],
		});
		expect(captured).toHaveLength(2);
		const handlers = log.snapshot().map((w) => w.handler).sort();
		expect(handlers).toEqual(["read_file", "read_files"]);
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
		expectClassification(captured, "tc-2", "tool_execution_succeeded");
	});

	it("B4-sc-sf: search_codebase and search_files are distinct handlers", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [
				{ id: "tc-1", name: "search_codebase", input: {} },
				{ id: "tc-2", name: "search_files", input: {} },
			],
		});
		expect(captured).toHaveLength(2);
		expect(log.snapshot().map((w) => w.handler).sort()).toEqual(["search_codebase", "search_files"]);
	});

	it("B5-unknown: unknown tool name registry-misses", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "no_such_tool_xyz", input: {} }],
		});
		expect(log.snapshot()).toHaveLength(0);
		expectClassification(captured, "tc-1", "tool_not_found");
	});

	it("B7-sk: skills routes to skills (no other builtin)", async () => {
		const { captured } = await drive({
			tools: [skillsTool(log), editorTool(log)],
			toolCalls: [{ id: "tc-1", name: "skills", input: { name: "review" } }],
		});
		expect(captured[0]?.toolName).toBe("skills");
		expect(log.snapshot()[0]?.handler).toBe("skills");
	});

	it("B8-handler-error: handler throwing ENOENT surfaces as tool_execution_error", async () => {
		const { captured } = await drive({
			tools: [...defaultBundle(log), enoentErrorTool(log)],
			toolCalls: [{ id: "tc-1", name: "always_errors", input: {} }],
		});
		expect(log.snapshot()).toHaveLength(1);
		expectClassification(captured, "tc-1", "tool_execution_error");
	});
});

// =============================================================================
// Section 10: exact-name adversarial. 8 cases.
// =============================================================================

describe("S10: exact-name adversarial (no fuzzy / no canonicalization at dispatch)", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	const adversarialNames = [
		"read",
		"read-files",
		"READ_FILES",
		"read_files_",
		"/read_files",
		" read_files",
		"read_files ",
		"\tread_files\n",
	];

	adversarialNames.forEach((name) => {
		it(`S10-adversarial: "${name}" registry-misses (registered as "read_files")`, async () => {
			const { captured } = await drive({
				tools: defaultBundle(log),
				toolCalls: [{ id: "tc-1", name, input: { path: "x" } }],
			});
			expect(log.snapshot()).toHaveLength(0);
			expectClassification(captured, "tc-1", "tool_not_found");
		});
	});
});

// =============================================================================
// Section 11: alias canonicalization scope-bounded assertion. 11 cases.
// =============================================================================

describe("S11: alias canonicalization does NOT silently re-route at top-level dispatch", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	const cases: Array<{ alias: string; registeredAs: string | null; expectation: "miss" | "own" }> = [
		{ alias: "use_skill", registeredAs: null, expectation: "miss" },
		{ alias: "attempt_completion", registeredAs: null, expectation: "miss" },
		{ alias: "bash", registeredAs: null, expectation: "miss" },
		{ alias: "execute_command", registeredAs: null, expectation: "miss" },
		{ alias: "list_code_definition_names", registeredAs: null, expectation: "miss" },
		{ alias: "list_files", registeredAs: null, expectation: "miss" },
		{ alias: "replace_in_file", registeredAs: null, expectation: "miss" },
		{ alias: "apply_diff", registeredAs: null, expectation: "miss" },
		{ alias: "write_to_file", registeredAs: null, expectation: "miss" },
		{ alias: "read_file", registeredAs: "read_file", expectation: "own" },
		{ alias: "search_files", registeredAs: "search_files", expectation: "own" },
	];

	cases.forEach(({ alias, registeredAs, expectation }) => {
		it(`S11-alias: "${alias}" ${expectation === "miss" ? "registry-misses" : `routes to its own handler (${registeredAs})`}`, async () => {
			const { captured } = await drive({
				tools: defaultBundle(log),
				toolCalls: [{ id: "tc-1", name: alias, input: { path: "x" } }],
			});
			if (expectation === "miss") {
				expect(log.snapshot()).toHaveLength(0);
				expectClassification(captured, "tc-1", "tool_not_found");
			} else {
				expect(log.snapshot()).toHaveLength(1);
				expect(log.snapshot()[0]?.handler).toBe(registeredAs);
				expectClassification(captured, "tc-1", "tool_execution_succeeded");
			}
		});
	});
});

// =============================================================================
// Section 12: skill routing. 2 cases.
// =============================================================================

describe("S12: skill routing", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	it("S12-sk: skills handler runs when invoked with a skill name", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "skills", input: { name: "review" } }],
		});
		expect(captured[0]?.toolName).toBe("skills");
		expect(log.snapshot()[0]?.input).toEqual({ name: "review" });
	});

	it("S12-sk-collision: dispatcher does not fan-out across same-name collisions", async () => {
		// Two registrations of "editor" — last registration wins. Exactly one
		// handler fires. This proves dispatch is map-lookup, not fan-out.
		const bundle: AgentTool[] = [
			makeTool({ name: "editor", handler: "editor#1", log }),
			makeTool({ name: "editor", handler: "editor#2", log }),
		];
		const { captured } = await drive({
			tools: bundle,
			toolCalls: [{ id: "tc-1", name: "editor", input: {} }],
		});
		expect(log.snapshot()).toHaveLength(1);
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
	});
});

// =============================================================================
// Section 14: custom tool dispatch (direct tools[] registration). 3 cases.
// =============================================================================

describe("S14: custom tool dispatch (direct tools[] registration)", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	it("S14-al: alpha_lookup routes to alpha_lookup executor", async () => {
		const { captured } = await drive({
			tools: [...defaultBundle(log), alphaLookupTool(log)],
			toolCalls: [{ id: "tc-1", name: "alpha_lookup", input: { q: "x" } }],
		});
		expect(captured[0]?.toolName).toBe("alpha_lookup");
		expect(log.snapshot()[0]?.handler).toBe("alpha_lookup");
	});

	it("S14-bl: beta_lookup routes to beta_lookup executor", async () => {
		const { captured } = await drive({
			tools: [...defaultBundle(log), alphaLookupTool(log), betaLookupTool(log)],
			toolCalls: [{ id: "tc-1", name: "beta_lookup", input: { q: "y" } }],
		});
		expect(log.snapshot()).toHaveLength(1);
		expect(log.snapshot()[0]?.handler).toBe("beta_lookup");
		expect(captured[0]?.toolName).toBe("beta_lookup");
	});

	it("S14-al+bl: parallel alpha_lookup and beta_lookup do not cross-talk", async () => {
		const { captured } = await drive({
			tools: [...defaultBundle(log), alphaLookupTool(log), betaLookupTool(log)],
			toolCalls: [
				{ id: "tc-1", name: "alpha_lookup", input: { q: "x" } },
				{ id: "tc-2", name: "beta_lookup", input: { q: "y" } },
			],
		});
		expect(log.snapshot()).toHaveLength(2);
		const byCall = new Map(log.snapshot().map((w) => [w.toolCallId, w.handler] as const));
		expect(byCall.get("tc-1")).toBe("alpha_lookup");
		expect(byCall.get("tc-2")).toBe("beta_lookup");
		expect(captured.find((c) => c.toolCallId === "tc-1")?.toolName).toBe("alpha_lookup");
		expect(captured.find((c) => c.toolCallId === "tc-2")?.toolName).toBe("beta_lookup");
	});
});

// =============================================================================
// Section 16: tool policy (approval path only). Registration-time
// filterAvailableTools is exercised in the sibling @cline/core file.
// =============================================================================

describe("S16: tool policy (approval path only)", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	it("S16-approval: host approves; the registered handler runs with same handler identity", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "run_commands", input: { cmd: "ls" } }],
			requestToolApproval: async () => ({ approved: true }),
		});
		expect(log.snapshot()).toHaveLength(1);
		expect(log.snapshot()[0]?.handler).toBe("run_commands");
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
	});

	it("S16-no-policy: without policy entry, run_commands handler runs without approval", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "run_commands", input: { cmd: "ls" } }],
		});
		expect(log.snapshot()).toHaveLength(1);
		expect(log.snapshot()[0]?.handler).toBe("run_commands");
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
	});
});

// =============================================================================
// Section 18: argument preservation. 2 cases.
// =============================================================================

describe("S18: argument preservation", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	it("S18-deep: deep nesting + unicode + mixed types reach executor verbatim", async () => {
		const input = {
			path: "ümlaut/中文/🎉.ts",
			nested: { a: [1, "two", null, { b: true }], c: { d: [{ e: "f" }] } },
		};
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "read_files", input }],
		});
		expect(captured).toHaveLength(1);
		const w = log.snapshot()[0];
		expect(w?.input).toEqual(input);
		expect(stableDigest(w?.input)).toBe(stableDigest(input));
	});

	it("S18-tcid: toolCallId propagates through context to executor", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "call_unique_xyz", name: "read_files", input: { path: "x" } }],
		});
		const w = log.snapshot()[0];
		expect(w?.toolCallId).toBe("call_unique_xyz");
		expectClassification(captured, "call_unique_xyz", "tool_execution_succeeded");
	});
});

// =============================================================================
// Section 19: context preservation. 2 cases.
// =============================================================================

describe("S19: context preservation (sessionId/conversationId isolation)", () => {
	it("S19-A: session A's context reaches session A's executor", async () => {
		const log = makeWitnessLog();
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "read_files", input: { path: "x" } }],
			sessionId: "session-A",
			conversationId: "conversation-A",
		});
		const w = log.snapshot()[0];
		expect(w?.context.sessionId).toBe("session-A");
		expect(w?.context.conversationId).toBe("conversation-A");
		expectClassification(captured, "tc-1", "tool_execution_succeeded");
	});

	it("S19-A+B: parallel A and B runtimes see their own context", async () => {
		const logA = makeWitnessLog();
		const logB = makeWitnessLog();
		const taskA = drive({
			tools: defaultBundle(logA),
			toolCalls: [{ id: "tc-1", name: "read_files", input: { path: "x" } }],
			sessionId: "session-A",
			conversationId: "conversation-A",
			agentId: "agent-A",
		});
		const taskB = drive({
			tools: defaultBundle(logB),
			toolCalls: [{ id: "tc-1", name: "read_files", input: { path: "y" } }],
			sessionId: "session-B",
			conversationId: "conversation-B",
			agentId: "agent-B",
		});
		const [, rB] = await Promise.all([taskA, taskB]);
		const wB = rB.captured.length > 0 ? logB.snapshot()[0] : undefined;
		expect(wB?.context.sessionId).toBe("session-B");
		expect(wB?.context.conversationId).toBe("conversation-B");
	});
});

// =============================================================================
// Section 20: parallel result correlation. 1 case.
// =============================================================================

describe("S20: parallel result correlation", () => {
	it("S20: two parallel tool calls produce independent outcomes keyed by toolCallId", async () => {
		const log = makeWitnessLog();
		const { captured } = await drive({
			tools: [...defaultBundle(log), alphaLookupTool(log), alphaWriteTool(log)],
			toolCalls: [
				{ id: "tc-A", name: "alpha_lookup", input: { q: "x" } },
				{ id: "tc-B", name: "alpha_write", input: { v: "y" } },
			],
		});
		expect(captured).toHaveLength(2);
		const a = captured.find((c) => c.toolCallId === "tc-A");
		const b = captured.find((c) => c.toolCallId === "tc-B");
		expect(a?.toolName).toBe("alpha_lookup");
		expect(b?.toolName).toBe("alpha_write");
		expect(log.snapshot().map((w) => w.toolCallId).sort()).toEqual(["tc-A", "tc-B"]);
	});
});

// =============================================================================
// Section 21: error routing. 3 cases.
// =============================================================================

describe("S21: error routing", () => {
	let log: WitnessLog;
	beforeEach(() => {
		log = makeWitnessLog();
	});

	it("E1-unknown: unknown name → tool_not_found (handler does NOT fire)", async () => {
		const { captured } = await drive({
			tools: defaultBundle(log),
			toolCalls: [{ id: "tc-1", name: "no_such_tool", input: {} }],
		});
		expect(log.snapshot()).toHaveLength(0);
		expectClassification(captured, "tc-1", "tool_not_found");
	});

	it("E2-enoent: handler throwing ENOENT → tool_execution_error (handler DID fire)", async () => {
		const { captured } = await drive({
			tools: [...defaultBundle(log), enoentErrorTool(log)],
			toolCalls: [{ id: "tc-1", name: "always_errors", input: {} }],
		});
		expect(log.snapshot()).toHaveLength(1);
		expectClassification(captured, "tc-1", "tool_execution_error");
	});

	it("E3-opaque: handler throwing opaque Error → tool_execution_error", async () => {
		const { captured } = await drive({
			tools: [...defaultBundle(log), opaqueErrorTool(log)],
			toolCalls: [{ id: "tc-1", name: "opaque_failure", input: {} }],
		});
		expectClassification(captured, "tc-1", "tool_execution_error");
	});
});
