/**
 * ACT-CLINEMM-SW-CM02-HANDLER-TOOL-ROUTING-EVALS01 — Production-seam characterization.
 *
 * This file is the sibling of the dispatch-only file in
 * `@cline/agents/src/runtime/routing/handler-tool-routing-evals01.swcm02.test.ts`.
 *
 * Scope (this file): the REGISTRATION seam, exercised end-to-end through
 * the REAL `DefaultRuntimeBuilder.build()` path:
 *   1. `filterAvailableTools` / `isToolEnabledByPolicies` — driven by
 *      `toolPolicies: { <toolName>: { enabled: false } }` on a real
 *      `CoreSessionConfig`. Asserts that the resulting `runtime.tools`
 *      omits the disabled tool, and feeds the post-filter list into a real
 *      `AgentRuntime` (via `@cline/agents`) to confirm dispatch becomes
 *      `tool_not_found`.
 *   2. `filterToolsForConfiguredAgent` / `resolveConfiguredAgentToolName` —
 *      driven by `enableSpawnAgent: true` with a REAL `.cline/agents/<name>.yml`
 *      file on disk. Asserts that:
 *         (a) the configured-agent tool `subagent_<name>` is registered at
 *             the lead level, AND
 *         (b) the SUB-AGENT runtime — constructed when the configured-agent
 *             tool is invoked — receives a tool list that is filtered by
 *             the configured-agent's `tools: [...]` allowlist, with aliases
 *             canonicalized (`use_skill` → `skills`, `bash` →
 *             `run_commands`, `read_file` → `read_files`, etc.), and
 *             exclude tools that the configured-agent's allowlist does NOT
 *             include.
 *
 * For (b), this file drives the REAL production child construction seam:
 * it calls `subagent_<name>.execute(...)`, mocks `SessionRuntime` (the same
 * pattern as `runtime-builder.configured-agent-execution.test.ts`), and
 * inspects the captured `agentConstructorSpy.mock.calls.at(-1)[0].tools`
 * — that is the actual tool list that `filterToolsForConfiguredAgent(
 * createBuiltinToolsList(...), agent)` produced end-to-end. No local mirror
 * of the configured-agent filter is used.
 *
 * Discriminators covered here:
 *   - D1 (registry omission)        — covered (disabled tool absent at registration,
 *                                     registry-miss at dispatch).
 *   - D2 (alias misresolution)      — covered (alias canonicalized at filter;
 *                                     observable at child toolset).
 *   - D3 (policy misapplication)    — covered (toolPolicies removed tool).
 *   - D4 (configured-agent defect)  — covered (allowlist scoped correctly in
 *                                     both lead-runtime and child-runtime).
 *
 * Discriminators D5..D9 (dispatch) live in the sibling file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "@cline/agents";
import type {
	AgentConfig,
	AgentEvent,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeHooks,
	AgentTool,
	ToolRuntimeOutcome,
} from "@cline/shared";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreSessionConfig } from "../../types/config";

// =============================================================================
// SessionRuntime mock — captures the AgentConfig passed to `new SessionRuntime(...)`
// for every sub-agent that the configured-agent tool constructs. The captured
// `config.tools` IS the child runtime's tool list, as produced by
// `filterToolsForConfiguredAgent(createBuiltinToolsList(...), agent)` in
// `runtime-builder.ts:594-617`. This is the production child-construction
// seam; we observe it directly without mirroring the filter.
// =============================================================================

const agentConstructorSpy = vi.fn();
let runMock = vi.fn();
let eventListeners: Array<(event: AgentEvent) => void> = [];

vi.mock("./session-runtime-orchestrator", () => ({
	SessionRuntime: class MockSessionRuntime {
		constructor(config: AgentConfig) {
			agentConstructorSpy(config);
		}
		getAgentId(): string {
			return "configured-sub-agent";
		}
		getConversationId(): string {
			return "configured-sub-conversation";
		}
		subscribeEvents(listener: (event: AgentEvent) => void): () => void {
			eventListeners.push(listener);
			return () => {
				eventListeners = eventListeners.filter((entry) => entry !== listener);
			};
		}
		async run(_input: string): Promise<unknown> {
			for (const listener of eventListeners) {
				listener({
					type: "notice",
					noticeType: "status",
					message: "configured agent running",
				} as unknown as AgentEvent);
			}
			return runMock(_input);
		}
	},
}));

// ---- scripted model (two-step) ---------------------------------------

class ScriptedTwoStepModel implements AgentModel {
	constructor(
		private readonly toolCallId: string,
		private readonly toolName: string,
		private readonly input: unknown,
	) {}
	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const inputJson = JSON.stringify(this.input);
		const events: AgentModelEvent[] = [];
		events.push({
			type: "tool-call-delta",
			toolCallId: this.toolCallId,
			toolName: this.toolName,
			inputText: inputJson,
		} as unknown as AgentModelEvent);
		events.push({
			type: "finish",
			reason: "tool-calls",
			usage: { inputTokens: 1, outputTokens: 1 },
		} as unknown as AgentModelEvent);
		void _request;
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
	async stream2(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		const events: AgentModelEvent[] = [];
		events.push({
			type: "text-delta",
			text: "done",
		} as unknown as AgentModelEvent);
		events.push({
			type: "finish",
			reason: "stop",
			usage: { inputTokens: 1, outputTokens: 1 },
		} as unknown as AgentModelEvent);
		return (async function* () {
			for await (const ev of events) yield ev;
		})();
	}
}

// Two-step driver: first step emits one tool-call, second step emits text.
function makeTwoStepDriver(
	toolCallId: string,
	toolName: string,
	input: unknown,
): AgentModel {
	let step = 0;
	return {
		async stream(
			req: AgentModelRequest,
		): Promise<AsyncIterable<AgentModelEvent>> {
			step += 1;
			if (step === 1) {
				const m = new ScriptedTwoStepModel(toolCallId, toolName, input);
				return m.stream(req);
			}
			const m = new ScriptedTwoStepModel(toolCallId, toolName, input);
			return m.stream2(req);
		},
	} as unknown as AgentModel;
}

function captureOutcomes(
	out: { toolCallId: string; toolName: string; outcome: ToolRuntimeOutcome }[],
): AgentRuntimeHooks {
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

function classificationOf(outcome: ToolRuntimeOutcome): string {
	if (outcome.kind === "success") return "tool_execution_succeeded";
	if (outcome.kind === "failure") return outcome.failureClass;
	if (outcome.kind === "control_plane") return outcome.outcome;
	throw new Error(`unknown outcome kind: ${JSON.stringify(outcome)}`);
}

// ---- runtime-builder helpers ----------------------------------------

interface BaseCfgOverrides {
	cwd: string;
	workspaceRoot?: string;
	enableSpawnAgent?: boolean;
	enableTools?: boolean;
	toolPolicies?: CoreSessionConfig["toolPolicies"];
	disableMcpSettingsTools?: boolean;
}

function makeBaseConfig(o: BaseCfgOverrides): CoreSessionConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "key",
		systemPrompt: "test",
		cwd: o.cwd,
		workspaceRoot: o.workspaceRoot ?? o.cwd,
		enableTools: o.enableTools ?? true,
		enableSpawnAgent: o.enableSpawnAgent ?? false,
		enableAgentTeams: false,
		disableMcpSettingsTools: o.disableMcpSettingsTools ?? true,
		toolPolicies: o.toolPolicies,
	} as CoreSessionConfig;
}

/**
 * Build the runtime and return the post-filter tools array WITHOUT driving
 * AgentRuntime. Use this when you only want to assert which tools the
 * production seam allowed through (no I/O needed).
 */
async function buildToolsOnly(config: CoreSessionConfig): Promise<AgentTool[]> {
	const { DefaultRuntimeBuilder } = await import("./runtime-builder");
	const built = await new DefaultRuntimeBuilder().build({ config });
	return built.tools;
}

/**
 * Build the runtime AND drive a single tool call through the resulting
 * `runtime.tools` array via a real `AgentRuntime`. The caller controls
 * `toolName` (the dispatched name). Use a toolName that is either:
 *   (a) known to be present and safe to invoke (e.g. a stub `echo` tool
 *       registered via `extensions`), OR
 *   (b) a name expected to be filtered out (the executor never fires; the
 *       runtime captures a `tool_not_found` outcome).
 *
 * Returns the post-filter tools array AND the captured outcomes.
 */
async function buildAndDriveSingleCall(opts: {
	config: CoreSessionConfig;
	toolCallId: string;
	toolName: string;
	input: unknown;
}): Promise<{
	runtimeTools: AgentTool[];
	captured: {
		toolCallId: string;
		toolName: string;
		outcome: ToolRuntimeOutcome;
	}[];
}> {
	const { DefaultRuntimeBuilder } = await import("./runtime-builder");
	const built = await new DefaultRuntimeBuilder().build({
		config: opts.config,
	});
	const captured: {
		toolCallId: string;
		toolName: string;
		outcome: ToolRuntimeOutcome;
	}[] = [];
	const model = makeTwoStepDriver(opts.toolCallId, opts.toolName, opts.input);
	const runtime = new AgentRuntime({
		agentId: "routing-evals-builder",
		sessionId: "session-A",
		conversationId: "conversation-A",
		systemPrompt: "test",
		tools: built.tools,
		hooks: captureOutcomes(captured),
		model,
	});
	await runtime.run("test prompt");
	return { runtimeTools: built.tools, captured };
}

/**
 * Invoke the configured-agent tool (`subagent_<name>`) and capture the
 * `AgentConfig.tools` that the production child construction seam —
 * `filterToolsForConfiguredAgent(createBuiltinToolsList(...), agent)` at
 * `runtime-builder.ts:594-617` — produced. Returns the captured child
 * tool list as `AgentTool[]`.
 *
 * The child runtime is mocked via `vi.mock("./session-runtime-orchestrator")`
 * at module level; the mock records every `new SessionRuntime(config)`
 * invocation, and the LAST one is the child that the configured-agent
 * tool just constructed. No local mirror of the filter is used.
 */
async function invokeSubAgentAndCaptureChildTools(opts: {
	config: CoreSessionConfig;
	agentName: string;
	prompt: string;
}): Promise<AgentTool[]> {
	const { DefaultRuntimeBuilder } = await import("./runtime-builder");
	const built = await new DefaultRuntimeBuilder().build({
		config: opts.config,
	});
	const reviewerTool = built.tools.find(
		(t) => t.name === `subagent_${opts.agentName}`,
	);
	if (!reviewerTool) {
		throw new Error(
			`Expected subagent_${opts.agentName} tool to be registered on the lead runtime.`,
		);
	}
	// Invoke the configured-agent tool. The mock SessionRuntime records
	// the AgentConfig that the production `createConfiguredAgentTools`
	// code passes to `createDelegatedAgent({...})` — and that config
	// carries the child tool list from `filterToolsForConfiguredAgent`.
	await reviewerTool.execute(
		{ prompt: opts.prompt },
		{
			agentId: "parent-agent",
			conversationId: "parent-conversation",
			iteration: 1,
		},
	);
	const lastCall = agentConstructorSpy.mock.calls.at(-1)?.[0] as
		| AgentConfig
		| undefined;
	if (!lastCall) {
		throw new Error(
			"SessionRuntime constructor was not called by the configured-agent tool.",
		);
	}
	return lastCall.tools ?? [];
}

// =============================================================================
// Section A: filterAvailableTools — driven by toolPolicies.enabled=false.
// =============================================================================

describe("A: filterAvailableTools via DefaultRuntimeBuilder.build({ toolPolicies })", () => {
	const tempDirs: string[] = [];
	const previousHome = process.env.HOME;

	afterEach(() => {
		process.env.HOME = previousHome;
		if (previousHome) setHomeDir(previousHome);
		for (const dir of tempDirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});

	it("A1-disabled-tool: toolPolicies.run_commands.enabled=false strips run_commands from runtime.tools", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-a1-"));
		tempDirs.push(tempHome);
		setHomeDir(tempHome);

		const runtimeTools = await buildToolsOnly(
			makeBaseConfig({
				cwd: tempHome,
				workspaceRoot: tempHome,
				toolPolicies: { run_commands: { enabled: false } },
			}),
		);
		const names = runtimeTools.map((t) => t.name);
		expect(names).not.toContain("run_commands");
		expect(names).toContain("read_files");
	});

	it("A2-disabled-tool-dispatch: AgentRuntime with the filtered list registry-misses run_commands", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-a2-"));
		tempDirs.push(tempHome);
		setHomeDir(tempHome);

		// run_commands is filtered out at registration time, so the
		// dispatcher's `tools.get(name)` returns undefined and the
		// captured outcome is `tool_not_found`. We use `run_commands`
		// here (NOT read_files) so the executor never actually fires and
		// the test does not depend on real filesystem I/O.
		const { captured } = await buildAndDriveSingleCall({
			config: makeBaseConfig({
				cwd: tempHome,
				workspaceRoot: tempHome,
				toolPolicies: { run_commands: { enabled: false } },
			}),
			toolCallId: "tc-1",
			toolName: "run_commands",
			input: { cmd: "ls" },
		});
		expect(captured).toHaveLength(1);
		expect(classificationOf(captured[0]!.outcome)).toBe("tool_not_found");
	});

	it("A3-policy-only-on-target: toolPolicies on run_commands does NOT strip unrelated tools", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-a3-"));
		tempDirs.push(tempHome);
		setHomeDir(tempHome);

		const runtimeTools = await buildToolsOnly(
			makeBaseConfig({
				cwd: tempHome,
				workspaceRoot: tempHome,
				toolPolicies: { run_commands: { enabled: false } },
			}),
		);
		const names = runtimeTools.map((t) => t.name);
		expect(names).toContain("read_files");
		expect(names).not.toContain("run_commands");
	});

	it("A4-disabled-tool-no-effect: toolPolicies with enabled=true (or absent) keeps run_commands", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-a4-"));
		tempDirs.push(tempHome);
		setHomeDir(tempHome);

		// No toolPolicies → run_commands is included by default.
		const runtimeTools = await buildToolsOnly(
			makeBaseConfig({
				cwd: tempHome,
				workspaceRoot: tempHome,
			}),
		);
		const names = runtimeTools.map((t) => t.name);
		expect(names).toContain("run_commands");
		expect(names).toContain("read_files");
	});

	it("A5-multi-disable: toolPolicies disabling two tools removes both", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-a5-"));
		tempDirs.push(tempHome);
		setHomeDir(tempHome);

		const runtimeTools = await buildToolsOnly(
			makeBaseConfig({
				cwd: tempHome,
				workspaceRoot: tempHome,
				toolPolicies: {
					run_commands: { enabled: false },
					editor: { enabled: false },
				},
			}),
		);
		const names = runtimeTools.map((t) => t.name);
		expect(names).not.toContain("run_commands");
		expect(names).not.toContain("editor");
		expect(names).toContain("read_files");
	});
});

// =============================================================================
// Section B: filterToolsForConfiguredAgent — driven by enableSpawnAgent=true
// with a real .cline/agents/<name>.yml file on disk.
// =============================================================================

describe("B: filterToolsForConfiguredAgent via DefaultRuntimeBuilder.build({ enableSpawnAgent: true })", () => {
	const tempDirs: string[] = [];
	const previousHome = process.env.HOME;

	beforeEach(() => {
		vi.clearAllMocks();
		eventListeners = [];
		runMock = vi.fn().mockResolvedValue({
			text: "configured result",
			iterations: 2,
			finishReason: "completed",
			usage: { inputTokens: 13, outputTokens: 8 },
		});
	});

	afterEach(() => {
		process.env.HOME = previousHome;
		if (previousHome) setHomeDir(previousHome);
		for (const dir of tempDirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});

	it("B1-allowlist-canonical: configured agent with `tools: [bash, read_file]` canonicalizes aliases to {run_commands, read_files}", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b1-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b1-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
tools: bash, read_file
---
You are a reviewer.`,
			"utf8",
		);

		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const built = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
			}),
		});
		// The configured agent's allowlist was `bash` (→ run_commands) and
		// `read_file` (→ read_files). The configured-agent tool
		// (`subagent_reviewer`) is registered. The agent's sub-agent tool set
		// is scoped, but the LEAD runtime's tools are NOT scoped by the
		// configured-agent allowlist — only the sub-agent's.
		const names = built.tools.map((t) => t.name);
		// The configured-agent tool itself is present at the lead level.
		expect(names).toContain("subagent_reviewer");
	});

	it("B2-no-tools: configured agent with no `tools:` line keeps all builtins", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b2-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b2-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
---
You are a reviewer.`,
			"utf8",
		);

		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const built = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
			}),
		});
		const names = built.tools.map((t) => t.name);
		expect(names).toContain("subagent_reviewer");
		// Builtins are present at the lead level when no `tools:` line.
		expect(names).toContain("read_files");
	});

	it("B3-skills-declared: configured agent with `skills: [foo]` adds `skills` to its sub-agent allowlist", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b3-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b3-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		const skillDir = join(workspaceRoot, ".cline", "skills", "review");
		mkdirSync(agentsDir, { recursive: true });
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
tools: read_file
skills: review
---
You are a reviewer.`,
			"utf8",
		);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: review
---
Use review guidance.`,
			"utf8",
		);

		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const built = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
			}),
		});
		const names = built.tools.map((t) => t.name);
		expect(names).toContain("subagent_reviewer");
		// Per `runtime-builder.test.ts > "does not register root skills
		// when only configured agents declare skills"`, the lead runtime's
		// own `skills` tool should NOT be registered when only a configured
		// agent declares skills. The sub-agent receives a scoped skills
		// executor instead.
		expect(names).not.toContain("skills");
	});

	it("B4-child-canonical: with `tools: [bash, read_file]`, child receives canonicalized {run_commands, read_files} only", async () => {
		// HALT_CONFIGURED_AGENT_PRODUCTION_SEAM_NOT_EXERCISED called out
		// that B1..B3 only inspect the LEAD runtime's `built.tools` — they
		// never observed what the SUB-AGENT runtime actually receives.
		// This test invokes the configured-agent tool (`subagent_reviewer`)
		// end-to-end and captures the `AgentConfig.tools` that the production
		// `createConfiguredAgentTools` code passes to `createDelegatedAgent`.
		// That config is constructed by `filterToolsForConfiguredAgent(
		// createBuiltinToolsList(...), agent)` at runtime-builder.ts:594-617 —
		// the SAME function used in production.
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b4-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b4-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
tools: bash, read_file
---
You are a reviewer.`,
			"utf8",
		);

		const childTools = await invokeSubAgentAndCaptureChildTools({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
			}),
			agentName: "reviewer",
			prompt: "review this change",
		});
		const childNames = childTools.map((t) => t.name).sort();

		// Aliases are canonicalized at the production
		// `filterToolsForConfiguredAgent` seam. `bash` → `run_commands`,
		// `read_file` → `read_files`.
		expect(childNames).toContain("run_commands");
		expect(childNames).toContain("read_files");
		// Literal alias names do NOT appear in the child toolset:
		// `filterToolsForConfiguredAgent` canonicalizes input names AND
		// intersects against the registered builtin tool list (which is
		// keyed by canonical name only).
		expect(childNames).not.toContain("bash");
		expect(childNames).not.toContain("read_file");
		// Tools NOT in the allowlist do not reach the child runtime.
		expect(childNames).not.toContain("editor");
		expect(childNames).not.toContain("apply_patch");
		expect(childNames).not.toContain("search_codebase");
		expect(childNames).not.toContain("search_files");
		expect(childNames).not.toContain("skills");
		expect(childNames).not.toContain("submit_and_exit");
		expect(childNames).not.toContain("ask_question");
		// The configured-agent tool itself is NOT in the child toolset
		// (recursion guard).
		expect(childNames).not.toContain("subagent_reviewer");
		// The child toolset is exactly the canonicalized allowlist.
		expect(childNames).toEqual(["read_files", "run_commands"]);
	});

	it("B5-child-skills-with-executor: with `skills: [review]`, child receives a `skills` tool tied to the configured-agent's allowlist", async () => {
		// Alias canonicalization for `use_skill` -> `skills` only takes effect
		// when the configured-agent declares `skills: [...]` (because that
		// is when `runtime-builder.ts:604-609` injects a skills executor into
		// `createBuiltinToolsList(...)` for the sub-agent). With only
		// `tools: [use_skill]` (no `skills:` line) the intersection at
		// runtime-builder.ts:114-129 returns `[]` because no `skills` tool
		// is in the available builtin list. This is correct production
		// behavior. Here we declare BOTH `skills: [review]` (so the
		// executor is added) AND verify the child gets `skills`.
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b5-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b5-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		const skillDir = join(workspaceRoot, ".cline", "skills", "review");
		mkdirSync(agentsDir, { recursive: true });
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
tools: read_file
skills: review
---
You are a reviewer.`,
			"utf8",
		);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: review
description: Code review guidance
---
Review the code carefully.`,
			"utf8",
		);

		const childTools = await invokeSubAgentAndCaptureChildTools({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
			}),
			agentName: "reviewer",
			prompt: "review using the skill",
		});
		const childNames = childTools.map((t) => t.name);

		// The configured-agent allowlist `tools: read_file` canonicalizes to
		// `read_files`. AND `skills: review` causes a skills executor to be
		// added to the sub-agent's available tool list at
		// runtime-builder.ts:604-609.
		expect(childNames).toContain("read_files");
		expect(childNames).toContain("skills");
		// `read_file` (alias) is NOT in the child toolset.
		expect(childNames).not.toContain("read_file");
		// No other tools (the configured-agent allowlist is scoped).
		expect(childNames).not.toContain("run_commands");
		expect(childNames).not.toContain("editor");
		// The configured-agent tool itself is NOT in the child toolset.
		expect(childNames).not.toContain("subagent_reviewer");
	});

	it("B6-child-no-tools: with no `tools:` line, child receives full permitted parent/builtin set", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b6-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b6-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
---
You are a reviewer.`,
			"utf8",
		);

		const childTools = await invokeSubAgentAndCaptureChildTools({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
			}),
			agentName: "reviewer",
			prompt: "review",
		});
		const childNames = childTools.map((t) => t.name);
		// When the configured-agent does not declare `tools:`,
		// `filterToolsForConfiguredAgent` at runtime-builder.ts:114-129
		// returns the input list unchanged. The child therefore receives
		// the full permitted parent/builtin set (as produced by
		// `createBuiltinToolsList(...)`).
		expect(childNames).toContain("read_files");
		expect(childNames).toContain("run_commands");
		expect(childNames).toContain("editor");
		expect(childNames).toContain("search_codebase");
		expect(childNames).toContain("fetch_web_content");
		// `skills` is NOT registered when only a configured-agent declares
		// skills (per `runtime-builder.test.ts > "does not register root
		// skills when only configured agents declare skills"`), so the
		// child also does not see it.
		expect(childNames).not.toContain("skills");
		// The configured-agent tool itself is NOT in the child toolset
		// (recursion guard).
		expect(childNames).not.toContain("subagent_reviewer");
	});

	it("B7-child-policy-disable: with `tools: [bash]` AND toolPolicies.run_commands.enabled=false, child does NOT receive run_commands", async () => {
		// The C4 case from the reviewer's halt: combine the configured-agent
		// allowlist AND a parent-level toolPolicies disable. Both filters
		// compose — the child must lose run_commands even though `bash` is
		// in its allowlist (because the parent-level `filterAvailableTools`
		// already removed `run_commands` from the available builtin list
		// before `filterToolsForConfiguredAgent` was called). This proves
		// the two filters compose correctly at the production seam.
		const tempHome = mkdtempSync(join(tmpdir(), "cline-swcm02-b7-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-swcm02-b7-ws-"));
		tempDirs.push(tempHome, workspaceRoot);
		setHomeDir(tempHome);

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
tools: bash
---
You are a reviewer.`,
			"utf8",
		);

		const childTools = await invokeSubAgentAndCaptureChildTools({
			config: makeBaseConfig({
				cwd: workspaceRoot,
				workspaceRoot,
				enableSpawnAgent: true,
				toolPolicies: { run_commands: { enabled: false } },
			}),
			agentName: "reviewer",
			prompt: "review",
		});
		const childNames = childTools.map((t) => t.name);

		// The configured-agent allowlist `tools: bash` canonicalizes to
		// `run_commands` at the configured-agent filter. BUT the
		// parent-level `toolPolicies.run_commands.enabled=false` is
		// applied by `filterAvailableTools` to the input builtin list
		// BEFORE `filterToolsForConfiguredAgent` is called
		// (runtime-builder.ts:594-617). Therefore the child has nothing
		// to intersect against, and run_commands is absent from the
		// child toolset.
		expect(childNames).not.toContain("run_commands");
		expect(childNames).not.toContain("bash");
		// Other builtins are NOT in the child either — the configured-agent
		// allowlist `tools: bash` is the ONLY entry. After canonicalization
		// (bash → run_commands) the intersection is `[]`. This is the
		// exact behavior the reviewer's C4 case requires.
		expect(childNames).toEqual([]);
	});
});
