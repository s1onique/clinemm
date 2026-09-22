import type { AgentToolContext, HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { version as corePackageVersion } from "../../../package.json";
import { createSessionCompactionState } from "../../session/models/session-compaction";
import { SessionSource } from "../../types/common";

const commandMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const getClientIdMock = vi.hoisted(() => vi.fn(() => "client-1"));
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

function createConfig() {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
	};
}

function agentDoneEvents(events: unknown[]) {
	return events.filter(
		(
			event,
		): event is {
			type: "agent_event";
			payload: { event: { type: "done"; [key: string]: unknown } };
		} =>
			!!event &&
			typeof event === "object" &&
			(event as { type?: unknown }).type === "agent_event" &&
			(event as { payload?: { event?: { type?: unknown } } }).payload?.event
				?.type === "done",
	);
}

describe("HubRuntimeHost", () => {
	afterEach(() => {
		commandMock.mockReset();
		subscribeMock.mockReset();
		closeMock.mockReset();
		disposeMock.mockReset();
		getClientIdMock.mockClear();
		restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset();
	});

	it("does not auto-start a run during session creation", async () => {
		subscribeMock.mockReturnValue(() => {});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const started = await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			localRuntime: {
				extensionContext: {
					client: { name: "cline-cli", version: "3.0.38" },
				},
			},
			prompt: "Hey",
		});

		expect(started.sessionId).toBe("sess-1");
		expect(started.result).toBeUndefined();
		expect(commandMock).toHaveBeenCalledTimes(1);
		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId: "sess-1",
		});
		expect(commandMock).toHaveBeenCalledWith("session.create", {
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
			sessionConfig: expect.objectContaining({
				providerId: "cline",
				modelId: "anthropic/claude-haiku-4.5",
				cwd: "/tmp/project",
				workspaceRoot: "/tmp/project",
				systemPrompt: "system",
				mode: "act",
				checkpoint: { enabled: true },
				enableTools: true,
				enableSpawnAgent: true,
				enableAgentTeams: true,
				headers: expect.objectContaining({
					"HTTP-Referer": "https://cline.bot",
					"X-Title": "Cline",
					"User-Agent": "Cline/3.0.38",
					"X-IS-MULTIROOT": "false",
					"X-CLIENT-TYPE": "cline-cli",
					"X-CLIENT-VERSION": "3.0.38",
					"X-PLATFORM": "cli",
					"X-PLATFORM-VERSION": "3.0.38",
					"X-CORE-VERSION": corePackageVersion,
					"X-Task-ID": expect.any(String),
				}),
			}),
			metadata: expect.objectContaining({
				source: SessionSource.CLI,
				prompt: "Hey",
				interactive: false,
				sessionHistoryOrigin: {
					mode: "user",
					version: "3.0.38",
				},
			}),
			runtimeOptions: {},
			toolPolicies: undefined,
			initialMessages: undefined,
		});
	});

	it("reconstructs tool content updates from hub events", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));
		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
		});

		onEvent?.({
			version: "v1",
			event: "tool.updated",
			sessionId: "sess-1",
			payload: {
				toolCallId: "call-1",
				toolName: "run_commands",
				update: { stream: "stdout", chunk: "live output\n" },
			},
		});

		expect(events).toContainEqual({
			type: "agent_event",
			payload: {
				sessionId: "sess-1",
				event: {
					type: "content_update",
					contentType: "tool",
					toolCallId: "call-1",
					toolName: "run_commands",
					update: { stream: "stdout", chunk: "live output\n" },
				},
			},
		});
	});

	it("uses the hub-resolved workspace in the manifest for a pathless start", async () => {
		subscribeMock.mockReturnValue(() => {});
		const resolvedWorkspace = "/home/host/.cline/data/workspaces/chat";
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-pathless",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: resolvedWorkspace,
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const started = await host.startSession({
			config: {
				...createConfig(),
				sessionId: "sess-pathless",
				cwd: undefined,
				workspaceRoot: undefined,
			},
			source: SessionSource.CORE,
		});

		expect(started.manifest.cwd).toBe(resolvedWorkspace);
		expect(started.manifest.workspace_root).toBe(resolvedWorkspace);
		const createPayload = commandMock.mock.calls[0]?.[1] as
			| Record<string, unknown>
			| undefined;
		expect(createPayload?.cwd).toBeUndefined();
		expect(createPayload?.workspaceRoot).toBeUndefined();
		expect(createPayload?.sessionConfig).toMatchObject({
			sessionId: "sess-pathless",
		});
		expect(createPayload?.sessionConfig).not.toHaveProperty("cwd");
		expect(createPayload?.sessionConfig).not.toHaveProperty("workspaceRoot");
	});

	it("rejects a pathless reply without the execution host workspace", async () => {
		const unsubscribe = vi.fn();
		subscribeMock.mockReturnValue(unsubscribe);
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-missing-workspace",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(
			host.startSession({
				config: {
					...createConfig(),
					sessionId: "sess-missing-workspace",
					cwd: undefined,
					workspaceRoot: undefined,
				},
				source: SessionSource.CORE,
			}),
		).rejects.toThrow("Hub runtime did not return a resolved workspace path.");
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("cleans a restored session when its host workspace is missing", async () => {
		const unsubscribe = vi.fn();
		subscribeMock.mockReturnValue(unsubscribe);
		commandMock.mockResolvedValue({
			ok: true,
			payload: {
				session: {
					sessionId: "sess-restored-missing-workspace",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
				},
				checkpoint: {},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(
			host.restoreSession({
				sessionId: "source-session",
				checkpointRunCount: 1,
				start: {
					config: {
						...createConfig(),
						sessionId: "sess-restored-missing-workspace",
						cwd: undefined,
						workspaceRoot: undefined,
					},
					source: SessionSource.CORE,
				},
			}),
		).rejects.toThrow("Hub runtime did not return a resolved workspace path.");
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("restarts an idle local hub and retries session.create after startup timeout", async () => {
		subscribeMock.mockReturnValue(() => {});
		const timeoutError = Object.assign(new Error("session.create timed out"), {
			command: "session.create",
			code: "hub_command_timeout",
		});
		commandMock.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce({
			ok: true,
			payload: {
				session: {
					sessionId: "sess-recovered",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		restartLocalHubIfIdleAfterStartupTimeoutMock.mockResolvedValue(
			"ws://127.0.0.1:25464/hub",
		);

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost(
			{ url: "ws://127.0.0.1:25463/hub" },
			{ workspaceRoot: "/tmp/project", cwd: "/tmp/project" },
		);

		const started = await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		expect(started.sessionId).toBe("sess-recovered");
		expect(commandMock).toHaveBeenCalledTimes(2);
		expect(restartLocalHubIfIdleAfterStartupTimeoutMock).toHaveBeenCalledWith({
			url: "ws://127.0.0.1:25463/hub",
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
		});
		expect(disposeMock).toHaveBeenCalledOnce();
	});

	it("starts runs only through send", async () => {
		subscribeMock.mockReturnValue(() => {});
		const result = {
			text: "Hey!",
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			messages: [],
			toolCalls: [],
			iterations: 1,
			finishReason: "completed",
			model: {
				id: "anthropic/claude-haiku-4.5",
				provider: "cline",
				info: {},
			},
			startedAt: new Date("2026-04-21T00:00:00.000Z"),
			endedAt: new Date("2026-04-21T00:00:01.000Z"),
			durationMs: 1000,
		};
		commandMock.mockResolvedValue({ ok: true, payload: { result } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		const sent = await host.runTurn({
			sessionId: "sess-1",
			prompt: "Hey",
			mode: "plan",
			delivery: "queue",
		});

		expect(subscribeMock).toHaveBeenCalledWith(expect.any(Function), {
			sessionId: "sess-1",
		});
		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Hey",
				mode: "plan",
				attachments: undefined,
				delivery: "queue",
			},
			"sess-1",
			{ timeoutMs: null },
		);
		expect(sent).toEqual(result);
	});

	it("projects canonical hub snapshots from replies and lifecycle events", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		const snapshot = {
			version: 1,
			sessionId: "sess-snapshot",
			source: SessionSource.CLI,
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			endedAt: null,
			exitCode: null,
			interactive: true,
			workspace: { cwd: "/tmp/project", root: "/tmp/project" },
			model: {
				providerId: "cline",
				modelId: "anthropic/claude-haiku-4.5",
			},
			capabilities: {
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
			},
			lineage: {
				agentId: "agent-1",
				conversationId: "conversation-1",
				isSubagent: false,
			},
			prompt: "Hey",
			messages: [{ role: "user", content: "Hey" }],
			usage: {
				inputTokens: 1,
				outputTokens: 2,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.01,
			},
		};
		commandMock.mockResolvedValueOnce({ ok: true, payload: { snapshot } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		const events: unknown[] = [];
		host.subscribe((event) => events.push(event));

		const started = await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
			interactive: true,
		});

		expect(started.sessionId).toBe("sess-snapshot");
		expect(started.manifest).toMatchObject({
			session_id: "sess-snapshot",
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			interactive: true,
			prompt: "Hey",
		});

		onEvent?.({
			version: "v1",
			event: "session.updated",
			sessionId: "sess-snapshot",
			payload: {
				snapshot: { ...snapshot, status: "completed", exitCode: 0 },
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "session_snapshot",
					payload: expect.objectContaining({
						sessionId: "sess-snapshot",
						snapshot: expect.objectContaining({
							version: 1,
							sessionId: "sess-snapshot",
							status: "completed",
							workspace: { cwd: "/tmp/project", root: "/tmp/project" },
						}),
					}),
				}),
			]),
		);
		// A snapshot-only session.updated reports the snapshot's status; it
		// must not fabricate "running" for a session whose turn has finished.
		const statusEvents = events.filter(
			(event): event is { type: "status"; payload: { status: string } } =>
				(event as { type?: unknown }).type === "status",
		);
		expect(statusEvents.at(-1)?.payload).toMatchObject({
			status: "completed",
		});

		// A session.updated with neither session nor snapshot reports nothing.
		onEvent?.({
			version: "v1",
			event: "session.updated",
			sessionId: "sess-snapshot",
			payload: {},
		});
		expect(
			events.filter((event) => (event as { type?: unknown }).type === "status")
				.length,
		).toBe(statusEvents.length);

		commandMock.mockResolvedValueOnce({ ok: true, payload: { snapshot } });
		await expect(host.getSession("sess-snapshot")).resolves.toMatchObject({
			sessionId: "sess-snapshot",
			provider: "cline",
			model: "anthropic/claude-haiku-4.5",
			agentId: "agent-1",
			conversationId: "conversation-1",
		});
	});

	it("bridges hub approval requests through runtime capabilities", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: string;
					sessionId: string;
					payload: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock
			.mockResolvedValueOnce({
				payload: {
					session: {
						sessionId: "sess-1",
						status: "running",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						workspaceRoot: "/tmp/project",
						cwd: "/tmp/project",
					},
				},
			})
			.mockResolvedValueOnce({ ok: true, payload: {} });
		const eventOrder: string[] = [];
		const requestToolApproval = vi.fn(async () => {
			eventOrder.push("approval-requested");
			return {
				approved: true,
				reason: "ok",
			};
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
			capabilities: { requestToolApproval },
		});
		host.subscribe((event) => {
			if (
				event.type === "agent_event" &&
				event.payload.event.type === "content_start" &&
				event.payload.event.contentType === "tool"
			) {
				eventOrder.push("tool-started");
			}
		});

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});
		onEvent?.({
			version: 1,
			event: "approval.requested",
			sessionId: "sess-1",
			payload: {
				approvalId: "approval-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 2,
				toolCallId: "call-1",
				toolName: "run_commands",
				inputJson: '{"commands":["echo hi"]}',
				policy: { autoApprove: false },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(eventOrder).toEqual(["tool-started", "approval-requested"]);
		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		expect(commandMock).toHaveBeenLastCalledWith(
			"approval.respond",
			{ approvalId: "approval-1", approved: true, reason: "ok" },
			"sess-1",
		);

		onEvent?.({
			version: 1,
			event: "tool.started",
			sessionId: "sess-1",
			payload: {
				toolCallId: "call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
			},
		});
		expect(eventOrder).toEqual(["tool-started", "approval-requested"]);
	});

	it("uses one app runtime capability object for hub tool executors and approvals", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock
			.mockResolvedValueOnce({
				payload: {
					session: {
						sessionId: "sess-1",
						status: "running",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						workspaceRoot: "/tmp/project",
						cwd: "/tmp/project",
					},
				},
			})
			.mockResolvedValueOnce({ ok: true, payload: {} })
			.mockResolvedValueOnce({ ok: true, payload: {} });
		const askQuestion = vi.fn(
			async (
				_question: string,
				_options: string[],
				_context: AgentToolContext,
			) => "Use the SDK",
		);
		const requestToolApproval = vi.fn(async () => ({
			approved: true,
			reason: "approved by app handler",
		}));
		const appCapabilities = {
			toolExecutors: { askQuestion },
			requestToolApproval,
		};

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			capabilities: appCapabilities,
		});
		expect(commandMock.mock.calls[0]?.[0]).toBe("session.create");
		expect(commandMock.mock.calls[0]?.[1]).toMatchObject({
			runtimeOptions: {
				clientContributions: [
					{
						kind: "toolExecutor",
						executor: "askQuestion",
						capabilityName: "tool_executor.askQuestion",
					},
				],
			},
		});

		onEvent?.({
			version: "v1",
			event: "run.completed",
			sessionId: "sess-1",
			payload: { reason: "completed" },
		});
		onEvent?.({
			version: "v1",
			event: "capability.requested",
			sessionId: "sess-1",
			payload: {
				requestId: "capreq-1",
				targetClientId: "client-1",
				capabilityName: "tool_executor.askQuestion",
				payload: {
					args: ["Which approach?", ["Use the SDK", "Write custom code"]],
					context: {
						sessionId: "sess-1",
						agentId: "agent-1",
						conversationId: "conversation-1",
						iteration: 1,
					},
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(askQuestion).toHaveBeenCalledWith(
			"Which approach?",
			["Use the SDK", "Write custom code"],
			expect.objectContaining({
				sessionId: "sess-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 1,
			}),
		);
		expect(commandMock).toHaveBeenLastCalledWith(
			"capability.respond",
			{
				requestId: "capreq-1",
				ok: true,
				payload: { result: "Use the SDK" },
			},
			"sess-1",
		);

		onEvent?.({
			version: "v1",
			event: "approval.requested",
			sessionId: "sess-1",
			payload: {
				approvalId: "approval-1",
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 2,
				toolCallId: "call-approval-1",
				toolName: "run_commands",
				inputJson: '{"commands":["echo hi"]}',
				policy: { autoApprove: false },
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "call-approval-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});
		expect(commandMock).toHaveBeenLastCalledWith(
			"approval.respond",
			{
				approvalId: "approval-1",
				approved: true,
				reason: "approved by app handler",
			},
			"sess-1",
		);
	});

	it("passes cancellation into long-running hub capability handlers", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValueOnce({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		let receivedSignal: AbortSignal | undefined;
		let resolveExecutor: ((value: string) => void) | undefined;
		const askQuestion = vi.fn(
			async (
				_question: string,
				_options: string[],
				context: AgentToolContext,
			) => {
				receivedSignal = context.signal;
				return await new Promise<string>((resolve) => {
					resolveExecutor = resolve;
				});
			},
		);

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			capabilities: { toolExecutors: { askQuestion } },
		});

		onEvent?.({
			version: "v1",
			event: "capability.requested",
			sessionId: "sess-1",
			payload: {
				requestId: "capreq-1",
				targetClientId: "client-1",
				capabilityName: "tool_executor.askQuestion",
				payload: {
					args: ["Which approach?", ["Use the SDK"]],
					context: {
						agentId: "agent-1",
						conversationId: "conversation-1",
						iteration: 1,
					},
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(receivedSignal).toBeDefined();
		expect(receivedSignal?.aborted).toBe(false);
		onEvent?.({
			version: "v1",
			event: "capability.resolved",
			sessionId: "sess-1",
			payload: {
				requestId: "capreq-1",
				capabilityName: "tool_executor.askQuestion",
				targetClientId: "client-1",
				ok: false,
				cancelled: true,
				error: "user cancelled",
			},
		});

		expect(receivedSignal?.aborted).toBe(true);
		resolveExecutor?.("Use the SDK");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(commandMock).not.toHaveBeenLastCalledWith(
			"capability.respond",
			expect.anything(),
			"sess-1",
		);
	});

	it("tears down session stream subscriptions when a session stops", async () => {
		const unsubscribe = vi.fn();
		subscribeMock.mockReturnValue(unsubscribe);
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.startSession({
			config: { ...createConfig(), sessionId: "sess-1" },
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		commandMock.mockResolvedValue({ ok: true, payload: {} });
		await host.stopSession("sess-1");

		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(commandMock).toHaveBeenLastCalledWith(
			"session.detach",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});

	it("maps hub completion events back to agent and lifecycle events without duplicating done", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event:
						| "assistant.finished"
						| "assistant.media"
						| "reasoning.finished"
						| "agent.done"
						| "run.completed";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "assistant.finished",
			sessionId: "sess-1",
			payload: { text: "hello" },
		});
		onEvent?.({
			version: 1,
			event: "assistant.media",
			sessionId: "sess-1",
			payload: {
				media: {
					id: "generated-1",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "aGVsbG8=" },
				},
			},
		});
		onEvent?.({
			version: 1,
			event: "reasoning.finished",
			sessionId: "sess-1",
			payload: { reasoning: "thought" },
		});
		onEvent?.({
			version: 1,
			event: "agent.done",
			sessionId: "sess-1",
			payload: {
				reason: "completed",
				text: "hello",
				iterations: 1,
				usage: { inputTokens: 2, outputTokens: 3, totalCost: 0.01 },
			},
		});
		onEvent?.({
			version: 1,
			event: "run.completed",
			sessionId: "sess-1",
			payload: { reason: "completed" },
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: { type: "content_end", contentType: "text", text: "hello" },
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: {
							type: "content_end",
							contentType: "media",
							media: {
								id: "generated-1",
								modality: "image",
								mediaType: "image/png",
								source: { type: "base64", data: "aGVsbG8=" },
							},
						},
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: {
							type: "content_end",
							contentType: "reasoning",
							reasoning: "thought",
						},
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "completed",
							text: "hello",
							iterations: 1,
						}),
					}),
				}),
			]),
		);
		expect(agentDoneEvents(events)).toHaveLength(1);
		expect(agentDoneEvents(events)[0]?.payload.event).toMatchObject({
			type: "done",
			reason: "completed",
			text: "hello",
			iterations: 1,
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "completed",
					}),
				}),
			]),
		);
	});

	it("maps hub usage updates back to agent usage events with identity", async () => {
		let onEvent: ((event: HubEventEnvelope) => void) | undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: "v1",
			event: "usage.updated",
			sessionId: "sess-1",
			payload: {
				delta: {
					inputTokens: 7,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					totalCost: 0.12,
				},
				totals: {
					inputTokens: 17,
					outputTokens: 8,
					cacheReadTokens: 3,
					cacheWriteTokens: 3,
					totalCost: 0.23,
				},
				agent: {
					kind: "teammate",
					agentId: "agent-teammate-1",
					conversationId: "conv-teammate-1",
					parentAgentId: "lead",
					teamAgentId: "investigator",
					teamRole: "teammate",
				},
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: {
						sessionId: "sess-1",
						teamAgentId: "investigator",
						teamRole: "teammate",
						event: {
							type: "usage",
							agentId: "agent-teammate-1",
							conversationId: "conv-teammate-1",
							parentAgentId: "lead",
							inputTokens: 7,
							outputTokens: 5,
							cacheReadTokens: 2,
							cacheWriteTokens: 1,
							cost: 0.12,
							totalInputTokens: 17,
							totalOutputTokens: 8,
							totalCacheReadTokens: 3,
							totalCacheWriteTokens: 3,
							totalCost: 0.23,
						},
					},
				}),
			]),
		);
	});

	it("synthesizes done from run.completed when no agent.done was observed", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.completed";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.completed",
			sessionId: "sess-1",
			payload: {
				reason: "completed",
				result: {
					finishReason: "completed",
					text: "fallback text",
					iterations: 2,
				},
			},
		});

		expect(agentDoneEvents(events)).toHaveLength(1);
		expect(agentDoneEvents(events)[0]?.payload.event).toMatchObject({
			type: "done",
			reason: "completed",
			text: "fallback text",
			iterations: 2,
		});
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "completed",
					}),
				}),
			]),
		);
	});

	it("maps hub iteration lifecycle events back to agent events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "iteration.started" | "iteration.finished";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "iteration.started",
			sessionId: "sess-1",
			payload: { iteration: 2 },
		});
		onEvent?.({
			version: 1,
			event: "iteration.finished",
			sessionId: "sess-1",
			payload: { iteration: 2, hadToolCalls: true, toolCallCount: 1 },
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: { type: "iteration_start", iteration: 2 },
					}),
				}),
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: {
							type: "iteration_end",
							iteration: 2,
							hadToolCalls: true,
							toolCallCount: 1,
						},
					}),
				}),
			]),
		);
	});

	it("maps hub aborted runs back to aborted agent events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.aborted";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.aborted",
			sessionId: "sess-1",
			payload: {
				snapshot: {
					version: 1,
					sessionId: "sess-1",
					status: "running",
					interactive: true,
				},
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "aborted",
						}),
					}),
				}),
			]),
		);
		expect(events).not.toContainEqual(
			expect.objectContaining({
				type: "ended",
				payload: expect.objectContaining({ sessionId: "sess-1" }),
			}),
		);
	});

	it("emits ended for terminal interactive hub run events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.aborted";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.aborted",
			sessionId: "sess-1",
			payload: {
				snapshot: {
					version: 1,
					sessionId: "sess-1",
					status: "cancelled",
					interactive: true,
				},
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "aborted",
						}),
					}),
				}),
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "aborted",
					}),
				}),
			]),
		);
	});

	it("maps failed hub runs back to error agent events", async () => {
		let onEvent:
			| ((event: {
					version: 1;
					event: "run.failed";
					sessionId: string;
					payload?: Record<string, unknown>;
			  }) => void)
			| undefined;
		subscribeMock.mockImplementation((listener) => {
			onEvent = listener;
			return () => {};
		});
		commandMock.mockResolvedValue({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});
		const events: unknown[] = [];

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });
		host.subscribe((event) => events.push(event));

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});

		onEvent?.({
			version: 1,
			event: "run.failed",
			sessionId: "sess-1",
			payload: {
				reason: "error",
				text: "run failed",
				iterations: 2,
			},
		});

		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent_event",
					payload: expect.objectContaining({
						event: expect.objectContaining({
							type: "done",
							reason: "error",
							text: "run failed",
							iterations: 2,
						}),
					}),
				}),
				expect.objectContaining({
					type: "ended",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						reason: "error",
					}),
				}),
			]),
		);
	});

	it("forwards image attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.runTurn({
			sessionId: "sess-1",
			prompt: "Describe this image",
			userImages: ["data:image/png;base64,aGVsbG8="],
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Describe this image",
				attachments: {
					userImages: ["data:image/png;base64,aGVsbG8="],
				},
				delivery: undefined,
			},
			"sess-1",
			{ timeoutMs: null },
		);
	});

	it("forwards file attachments when sending a run", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { result: undefined } });

		const filePath = "/tmp/project/note.md";

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.runTurn({
			sessionId: "sess-1",
			prompt: "Use this file",
			userFiles: [filePath],
		});

		expect(commandMock).toHaveBeenCalledWith(
			"run.start",
			{
				sessionId: "sess-1",
				input: "Use this file",
				attachments: {
					userFiles: [filePath],
				},
				delivery: undefined,
			},
			"sess-1",
			{ timeoutMs: null },
		);
	});

	it("serializes error abort reasons for hub abort commands", async () => {
		commandMock.mockResolvedValue({ ok: true, payload: { applied: true } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.abort(
			"sess-1",
			new Error("Interactive runtime abort requested"),
		);

		expect(commandMock).toHaveBeenCalledWith(
			"run.abort",
			{
				sessionId: "sess-1",
				reason: "Interactive runtime abort requested",
			},
			"sess-1",
		);
	});

	it("reads messages through the hub instead of dereferencing client-local artifact paths", async () => {
		const messages = [
			{
				role: "user",
				content: [{ type: "text", text: "hello from another client" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
			},
		];
		commandMock.mockResolvedValue({ ok: true, payload: { messages } });

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.readSessionMessages(" sess-1 ")).resolves.toEqual(
			messages,
		);
		expect(commandMock).toHaveBeenCalledWith(
			"session.messages",
			{ sessionId: "sess-1" },
			"sess-1",
		);
	});

	it("throws when the hub rejects message reads", async () => {
		const telemetry = { capture: vi.fn() };
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "session_not_found",
				message: "Unknown session: sess-missing",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
			telemetry: telemetry as never,
		});

		await expect(host.readSessionMessages("sess-missing")).rejects.toThrow(
			"Unknown session: sess-missing",
		);
		expect(telemetry.capture).toHaveBeenCalledWith({
			event: "sdk.error",
			properties: expect.objectContaining({
				component: "core",
				operation: "hub.runtime_host.read_session_messages",
				severity: "warn",
				handled: true,
				command: "session.messages",
				sessionId: "sess-missing",
				errorCode: "session_not_found",
				error_message: "Unknown session: sess-missing",
			}),
		});
	});

	it("records rejected compaction state updates as handled errors", async () => {
		const telemetry = { capture: vi.fn() };
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "sess-1",
		});
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "session_wrong_client",
				message: "Session sess-1 is owned by other-client",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
			telemetry: telemetry as never,
		});

		await expect(
			host.updateSessionCompactionState(" sess-1 ", state),
		).resolves.toEqual({ updated: false });
		expect(telemetry.capture).toHaveBeenCalledWith({
			event: "sdk.error",
			properties: expect.objectContaining({
				component: "core",
				operation: "hub.runtime_host.update_session_compaction_state",
				severity: "warn",
				handled: true,
				command: "session.compaction.update",
				sessionId: "sess-1",
				errorCode: "session_wrong_client",
				error_message: "Session sess-1 is owned by other-client",
			}),
		});
	});

	it("treats stale compaction state updates as non-error no-ops", async () => {
		const telemetry = { capture: vi.fn() };
		const state = createSessionCompactionState({
			sourceMessages: [{ role: "user", content: "source" }],
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "sess-1",
		});
		commandMock.mockResolvedValue({
			ok: true,
			payload: { updated: false },
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({
			url: "ws://127.0.0.1:25463/hub",
			telemetry: telemetry as never,
		});

		await expect(
			host.updateSessionCompactionState("sess-1", state),
		).resolves.toEqual({ updated: false });
		expect(telemetry.capture).not.toHaveBeenCalled();
	});

	it("throws when the hub rejects settings list", async () => {
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "settings_list_failed",
				message: "Invalid settings list payload",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(host.listSettings({ cwd: "/tmp/project" })).rejects.toThrow(
			"Invalid settings list payload",
		);
		expect(commandMock).toHaveBeenCalledWith("settings.list", {
			cwd: "/tmp/project",
		});
	});

	it("throws when the hub rejects settings toggle", async () => {
		commandMock.mockResolvedValue({
			ok: false,
			error: {
				code: "settings_toggle_failed",
				message: "Unknown settings type",
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await expect(
			host.toggleSetting({ type: "skills", id: "skill-one" }),
		).rejects.toThrow("Unknown settings type");
		expect(commandMock).toHaveBeenCalledWith("settings.toggle", {
			type: "skills",
			id: "skill-one",
		});
	});

	it("detaches active sessions when disposed", async () => {
		commandMock.mockResolvedValueOnce({
			payload: {
				session: {
					sessionId: "sess-1",
					status: "running",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					workspaceRoot: "/tmp/project",
					cwd: "/tmp/project",
				},
			},
		});

		const { HubRuntimeHost } = await import("./hub-runtime-host");
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" });

		await host.startSession({
			config: createConfig(),
			source: SessionSource.CLI,
			prompt: "Hey",
		});
		await host.dispose();

		expect(commandMock).toHaveBeenLastCalledWith(
			"session.detach",
			{ sessionId: "sess-1" },
			"sess-1",
		);
		expect(disposeMock).toHaveBeenCalledTimes(1);
	});
});

/**
 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 / CORRECTION01
 *
 * PPA-HUB-RACE-01 — real `HubRuntimeHost` race test.
 *
 * Per the seventy-ninth-pass Factory reviewer's verdict on the original
 * TRANSPORT01 closure:
 *
 *   "The local refactor is good. The transport-neutral verdict is not
 *    yet justified. `HubRuntimeHost.pendingPrompts.count()` returns
 *    `Map.get(...) ?? 0`, which fails-open: an unmirrored session
 *    read as `count = 0` would authorize Q5 `awaiting_followup`
 *    despite authoritative work pending remotely."
 *
 * This test exercises the REAL `HubRuntimeHost` (not a synthetic
 * `TestPendingPromptQueue`) and drives the canonical race that the
 * reviewer identified. A mocked transport around the REAL
 * `HubRuntimeHost` is sufficient — we do not need a live hub daemon.
 * The mock is the canonical `vi.mock("../client", ...)` seam defined
 * at the top of this file.
 */
describe("ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01 / PPA-HUB-RACE-01", () => {
	it("unmirrored session returns {available:false} (FAIL-CLOSED), not 0", async () => {
		// Capture the subscribe listener so we can drive the
		// `session.pending_prompts` event payload through the real
		// `HubRuntimeHost.handleHubEvent` path. We capture the
		// listener lazily — only the FIRST `subscribe` call wins
		// per sessionId (later calls no-op), so capture the
		// listener when the host calls `ensureSessionSubscription`.
		const listeners: ((event: HubEventEnvelope) => void)[] = []
		subscribeMock.mockImplementation((listener) => {
			listeners.push(listener)
			return () => {
				// no-op
			}
		})
		// Default `command` mock — the `pendingPrompts.list(...)` reply
		// would normally seed the mirror, but in this race we
		// deliberately read BEFORE any list/update/delete/event has
		// reached the host.
		commandMock.mockImplementation(async () => ({ payload: { prompts: [] } }))

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		// T0: NO list / update / delete / event has reached this host.
		// The mirror AND the "initialized" marker are both empty.
		const beforeAnyAuthority = host.pendingPrompts.count("session-ppa-hub-race")
		expect(beforeAnyAuthority).toEqual({ available: false })

		// CORRECTION01 invariant: an unmirrored session MUST NOT be
		// readable as `{ available: true; count: 0 }`. PRE-FIX
		// `Map.get() ?? 0` would have collapsed this to a falsy zero —
		// the exact fail-open smell the reviewer flagged.
		expect(beforeAnyAuthority).not.toEqual({ available: true, count: 0 })
		expect(beforeAnyAuthority).not.toBe(0)

		// T1: trigger the canonical mirror-seed path (production
		// SdkController.getStateToPostToWebview calls this BEFORE any
		// Q5 decision is taken). This also establishes the
		// session-subscription that routes hub-published events to
		// `handleHubEvent`.
		await host.pendingPrompts.list({ sessionId: "session-ppa-hub-race" })

		// T2: deliver the authoritative `session.pending_prompts`
		// event payload carrying one pending prompt. MUST both
		// populate the count AND mark the session as initialized.
		const onHubEvent = listeners[listeners.length - 1]
		expect(onHubEvent).toBeDefined()
		onHubEvent!({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "session-ppa-hub-race",
			payload: {
				prompts: [{ id: "p1", prompt: "wake", delivery: "queue" }],
			},
		} as unknown as HubEventEnvelope)

		const afterEvent = host.pendingPrompts.count("session-ppa-hub-race")
		expect(afterEvent).toEqual({ available: true, count: 1 })

		// T3: deliver an authoritative empty snapshot (queue drained).
		onHubEvent!({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "session-ppa-hub-race",
			payload: {
				prompts: [],
			},
		} as unknown as HubEventEnvelope)

		const afterDrain = host.pendingPrompts.count("session-ppa-hub-race")
		// `{ available: true; count: 0 }` is the ONLY state that
		// authorizes operator handoff in production (CORRECTION01).
		expect(afterDrain).toEqual({ available: true, count: 0 })

		await host.dispose()
	})

	it("stopSession clears the mirror AND the initialization marker → next count returns {available:false}", async () => {
		const listeners: ((event: HubEventEnvelope) => void)[] = []
		subscribeMock.mockImplementation((listener) => {
			listeners.push(listener)
			return () => {
				// no-op
			}
		})
		commandMock.mockImplementation(async () => ({ payload: { prompts: [] } }))

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		// T0: drive the canonical mirror-seed path (list call).
		await host.pendingPrompts.list({ sessionId: "session-ppa-hub-race-stop" })
		const onHubEvent = listeners[listeners.length - 1]
		expect(onHubEvent).toBeDefined()

		// T1: seed the mirror via the authoritative event path.
		onHubEvent!({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "session-ppa-hub-race-stop",
			payload: {
				prompts: [{ id: "p1", prompt: "wake", delivery: "queue" }],
			},
		} as unknown as HubEventEnvelope)
		expect(host.pendingPrompts.count("session-ppa-hub-race-stop")).toEqual({
			available: true,
			count: 1,
		})

		// T2: stop the session. CORRECTION01 must clear BOTH the
		// count-mirror entry AND the "initialized" marker so the
		// next `count` is fail-closed (`{ available: false }`),
		// not fail-open (`{ available: true; count: 0 }`).
		await host.stopSession("session-ppa-hub-race-stop")

		const afterStop = host.pendingPrompts.count("session-ppa-hub-race-stop")
		expect(afterStop).toEqual({ available: false })
		expect(afterStop).not.toEqual({ available: true, count: 0 })

		await host.dispose()
	})

	it("requestPendingPromptsList reply initializes the mirror (count → {available:true, count:N})", async () => {
		subscribeMock.mockReturnValue(() => {})
		// Configure the `session.pending_prompts` command reply to
		// return three prompts. This is the second authoritative
		// mirror source (the first is the `session.pending_prompts`
		// event payload).
		commandMock.mockImplementation(async (cmd: string) => {
			if (cmd === "session.pending_prompts") {
				return {
					payload: {
						prompts: [
							{ id: "p1", prompt: "wake-1", delivery: "queue" },
							{ id: "p2", prompt: "wake-2", delivery: "queue" },
							{ id: "p3", prompt: "wake-3", delivery: "queue" },
						],
					},
				}
			}
			return { payload: {} }
		})

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		// T0: pre-list, the session is unmirrored → { available: false }.
		expect(
			host.pendingPrompts.count("session-ppa-hub-race-list"),
		).toEqual({ available: false })

		// T1: drive the authoritative `pendingPrompts.list(...)` reply.
		// This is the canonical mirror-seed path that production
		// `SdkController.getStateToPostToWebview` exercises before any
		// Q5 decision is taken.
		const prompts = await host.pendingPrompts.list({
			sessionId: "session-ppa-hub-race-list",
		})
		expect(prompts).toHaveLength(3)

		// T2: post-list, the session is initialized.
		expect(
			host.pendingPrompts.count("session-ppa-hub-race-list"),
		).toEqual({ available: true, count: 3 })

		await host.dispose()
	})

	it("empty sessionId returns {available:false} (failsafe)", async () => {
		subscribeMock.mockReturnValue(() => {})
		commandMock.mockImplementation(async () => ({ payload: {} }))

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		expect(host.pendingPrompts.count("")).toEqual({ available: false })
		expect(host.pendingPrompts.count(undefined as unknown as string)).toEqual({
			available: false,
		})

		await host.dispose()
	})
});


/**
 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION02
 *
 * PPA-HUB-RACE-02 — real `HubRuntimeHost` initialized-but-stale
 * discriminator.
 *
 * Per the eighty-pass Factory reviewer's verdict on CORRECTION01
 * (`HALT_HUB_PENDING_AUTHORITY_STALENESS_UNPROVEN`):
 *
 *   "The current mirror closes the uninitialized→fail-open bug. It does
 *    not close the initialized→stale race. Consider this legal
 *    chronology after the mirror has already been initialized:
 *
 *      T0  Hub client receives list reply: []
 *          mirror = 0
 *          initialized = true
 *      T1  remote authoritative queue gains terminal wake
 *          authoritative count = 1
 *      T2  pending_prompts event carrying that mutation is in flight
 *      T3  done-without-completion reaches Q5
 *      T4  Q5 calls count() → { available: true, count: 0 }
 *
 *    CORRECTION01 does not mechanically exclude this chronology.
 *    pendingPromptCountInitializedBySession proves only that some
 *    authoritative snapshot has existed, not that the snapshot is
 *    fresh relative to the done decision."
 *
 * The discriminator the reviewer demanded is:
 *
 *   "PASS only if Q5 cannot observe {available:true,count:0} after the
 *    wake is authoritative but before it learns about the wake."
 *
 * The two layouts below correspond to:
 *   Layout A — wake event arrives at the client listener BEFORE
 *     done-without-completion. The wire delivers the wake event first
 *     → mirror reflects 1 BEFORE Q5 reads → defers.
 *
 *   Layout B — done-without-completion arrives BEFORE the wake event.
 *     The wire delivers the done event first → mirror STILL shows 0
 *     at the moment Q5 reads → Q5 commits awaiting_followup.
 *     THE MIRROR IS STALE.
 *
 * The tests below do NOT modify the production design. They are
 * pure composition witnesses of what the production wire ordering
 * permits. Layout A passes; Layout B documents the staleness the
 * reviewer identified.
 */
describe("ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION02 / PPA-HUB-RACE-02", () => {
	it("Layout A (wake event BEFORE done): mirror is fresh when Q5 reads count", async () => {
		const listeners: ((event: HubEventEnvelope) => void)[] = []
		subscribeMock.mockImplementation((listener) => {
			listeners.push(listener)
			return () => {
				// no-op
			}
		})
		commandMock.mockImplementation(async () => ({ payload: { prompts: [] } }))

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		// T0: initialize the mirror via the canonical mirror-seed
		// path. The reply says prompts=[].
		await host.pendingPrompts.list({ sessionId: "session-ppa-hub-race-2-A" })
		const onHubEvent = listeners[listeners.length - 1]
		expect(onHubEvent).toBeDefined()

		expect(host.pendingPrompts.count("session-ppa-hub-race-2-A")).toEqual({
			available: true,
			count: 0,
		})

		// T1: drive Layout A chronology — wake event arrives at the
		// client listener BEFORE the done-without-completion event.
		onHubEvent!({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "session-ppa-hub-race-2-A",
			payload: {
				prompts: [{ id: "wake-1", prompt: "BG terminal wake", delivery: "queue" }],
			},
		} as unknown as HubEventEnvelope)

		// T2 (Layout A): at the moment Q5 reads count AFTER the
		// done-without-completion event would be processed, the
		// mirror MUST reflect the wake.
		expect(host.pendingPrompts.count("session-ppa-hub-race-2-A")).toEqual({
			available: true,
			count: 1,
		})

		// T3: deliver done-without-completion AFTER the wake event.
		// The host emits `agent_event { type: done }` (the
		// published-into-events-stream form that the Q5 consumer
		// reads).
		let emittedDone = false
		const unsubscribe = host.subscribe((event) => {
			if (
				event.type === "agent_event" &&
				(event.payload as { event?: { type?: string } }).event?.type === "done"
			) {
				emittedDone = true
			}
		})
		onHubEvent!({
			version: "v1",
			event: "run.completed",
			sessionId: "session-ppa-hub-race-2-A",
			payload: {
				reason: "completed",
				result: { finishReason: "completed" },
			},
		} as unknown as HubEventEnvelope)
		expect(emittedDone).toBe(true)

		// Layout A final assertion: the mirror MUST still reflect
		// the wake at the moment the done event is processed. Q5
		// reads this synchronously. {available:true, count:1} →
		// defer (correct).
		expect(host.pendingPrompts.count("session-ppa-hub-race-2-A")).toEqual({
			available: true,
			count: 1,
		})

		unsubscribe()
		await host.dispose()
	})
});
describe("ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION02 / PPA-HUB-RACE-02 Layout B", () => {
	it("Layout B (done BEFORE wake event): mirror is STALE when Q5 reads count", async () => {
		const listeners: ((event: HubEventEnvelope) => void)[] = []
		subscribeMock.mockImplementation((listener) => {
			listeners.push(listener)
			return () => {
				// no-op
			}
		})
		commandMock.mockImplementation(async () => ({ payload: { prompts: [] } }))

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		// T0: initialize the mirror via the canonical mirror-seed
		// path. The reply says prompts=[].
		await host.pendingPrompts.list({ sessionId: "session-ppa-hub-race-2-B" })
		const onHubEvent = listeners[listeners.length - 1]
		expect(onHubEvent).toBeDefined()

		expect(host.pendingPrompts.count("session-ppa-hub-race-2-B")).toEqual({
			available: true,
			count: 0,
		})

		// T1: drive Layout B chronology — done-without-completion
		// arrives at the client listener BEFORE the wake event.
		let emittedDone = false
		const unsubscribe = host.subscribe((event) => {
			if (
				event.type === "agent_event" &&
				(event.payload as { event?: { type?: string } }).event?.type === "done"
			) {
				emittedDone = true
			}
		})

		// T2: deliver `run.completed` (which causes the host to
		// emit the `agent_event { type: done }` into the host's
		// own event stream — that's what the Q5 consumer reads).
		onHubEvent!({
			version: "v1",
			event: "run.completed",
			sessionId: "session-ppa-hub-race-2-B",
			payload: {
				reason: "completed",
				result: { finishReason: "completed" },
			},
		} as unknown as HubEventEnvelope)
		expect(emittedDone).toBe(true)

		// T3 (Layout B): at the EXACT moment Q5 reads count AFTER
		// done-without-completion was processed, the mirror STILL
		// shows {available:true, count:0} — the wake has not yet
		// been observed by the host. THIS IS THE STALENESS THE
		// REVIEWER IDENTIFIED.
		const countAtDone = host.pendingPrompts.count("session-ppa-hub-race-2-B")
		expect(countAtDone).toEqual({ available: true, count: 0 })

		// T4: NOW deliver the wake event. The mirror updates to 1.
		// But this happens AFTER Q5 has already read count. The
		// user's "Your turn" has already been committed (in the
		// production Q5 evaluator).
		onHubEvent!({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "session-ppa-hub-race-2-B",
			payload: {
				prompts: [{ id: "wake-1", prompt: "BG terminal wake", delivery: "queue" }],
			},
		} as unknown as HubEventEnvelope)

		expect(host.pendingPrompts.count("session-ppa-hub-race-2-B")).toEqual({
			available: true,
			count: 1,
		})

		// LAYOUT B DISCRIMINATOR:
		// The fact that the count at the done-event moment was
		// {available:true, count:0} (above) PROVES the design
		// CANNOT distinguish "queue is genuinely empty" from "wake
		// was just enqueued at the Hub but the wire-delivered
		// pending_prompts event hasn't arrived yet". This is
		// exactly the initialized-but-stale race the eighty-pass
		// reviewer identified.
		//
		// Per the reviewer's prescription:
		//
		//   A. If production serializes pending_prompts-before-done
		//      on the same event stream, Layout B cannot happen in
		//      production and the design survives.
		//
		//   B. If production does NOT guarantee that ordering, the
		//      Layout B chronology above demonstrates that the
		//      current mirror is insufficient and an additional
		//      mechanism is required.
		//
		// This test demonstrates that the Layout B chronology is
		// realizable on the Hub transport's wire-ordering. The
		// bounded correction that follows will resolve B by
		// adding a freshness discriminator to the service API.
		unsubscribe()
		await host.dispose()
	})
});
describe("ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION02 / PPA-HUB-RACE-02 Layout C", () => {
	it("Layout B with atomic re-query at the decision boundary recovers freshness", async () => {
		// Per the eighty-pass reviewer:
		//   "If B, then availability alone cannot fix it. You need
		//    freshness/causal identity: revision/sequence, an atomic
		//    remote query at the decision boundary, or another
		//    authority that is ordered with done."
		//
		// This test demonstrates the SIMPLEST recovery: at the Q5
		// decision boundary, RE-QUERY the authoritative source via
		// `pendingPrompts.list(...)`. If the atomic re-query's reply
		// carries a count >0, Q5 defers.
		//
		// We model this by:
		//   1. Initialize the mirror via the first list reply (count=0).
		//   2. Drive Layout B (done-without-completion FIRST).
		//   3. At the moment Q5 reads count, the local mirror is
		//      stale {available:true, count:0}.
		//   4. Q5 RE-QUERIES the Hub via `pendingPrompts.list(...)`.
		//   5. The mock command implementation returns the
		//      authoritative count [wake] in the reply.
		//   6. The mirror becomes {available:true, count:1} BEFORE
		//      Q5 commits `awaiting_followup`.
		//   7. Q5 reads count AGAIN and observes {available:true,
		//      count:1} → defers.
		const listeners: ((event: HubEventEnvelope) => void)[] = []
		subscribeMock.mockImplementation((listener) => {
			listeners.push(listener)
			return () => {
				// no-op
			}
		})

		let listCallCount = 0
		commandMock.mockImplementation(async (cmd: string) => {
			if (cmd === "session.pending_prompts") {
				listCallCount++
				if (listCallCount === 1) {
					return { payload: { prompts: [] } }
				}
				return {
					payload: {
						prompts: [
							{ id: "wake-1", prompt: "BG terminal wake", delivery: "queue" },
						],
					},
				}
			}
			return { payload: {} }
		})

		const { HubRuntimeHost } = await import("./hub-runtime-host")
		const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

		// T0: first list reply (mirror-seed): prompts=[].
		await host.pendingPrompts.list({ sessionId: "session-ppa-hub-race-2-C" })
		const onHubEvent = listeners[listeners.length - 1]
		expect(onHubEvent).toBeDefined()

		expect(host.pendingPrompts.count("session-ppa-hub-race-2-C")).toEqual({
			available: true,
			count: 0,
		})

		// T1: drive Layout B — done-without-completion event
		// arrives at the host FIRST.
		onHubEvent!({
			version: "v1",
			event: "run.completed",
			sessionId: "session-ppa-hub-race-2-C",
			payload: {
				reason: "completed",
				result: { finishReason: "completed" },
			},
		} as unknown as HubEventEnvelope)

		// T2: Q5 first reads count → STALE {available:true, count:0}.
		const firstRead = host.pendingPrompts.count("session-ppa-hub-race-2-C")
		expect(firstRead).toEqual({ available: true, count: 0 })

		// T3: Q5 atomically re-queries the Hub via
		// `pendingPrompts.list(...)`. The reply carries the
		// authoritative count = 1. The local mirror is updated as
		// part of this synchronous call (the
		// `requestPendingPromptsList` path sets both the count AND
		// the initialization marker).
		await host.pendingPrompts.list({ sessionId: "session-ppa-hub-race-2-C" })

		// T4: Q5 reads count AGAIN — now FRESH {available:true,
		// count:1}. Q5 defers.
		const secondRead = host.pendingPrompts.count("session-ppa-hub-race-2-C")
		expect(secondRead).toEqual({ available: true, count: 1 })

		await host.dispose()
	})
});
