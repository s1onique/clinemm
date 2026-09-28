/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01 — RED reproduction
 * for the bounded acquisition discriminator (AF-RED-01..AF-RED-06).
 *
 * Mission: prove the live diagnostic can identify the FIRST failed
 * operation inside `runMycPrimeOnSessionStart` when driven through the
 * REAL production lifecycle seam (`SdkSessionLifecycle.startNewSession`),
 * NOT through a test-body shortcut.
 *
 * Each test below targets ONE of the six hypotheses H1..H6 from
 * `.factory/acts/ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01.md`
 * §6. The discriminator asserts the unique (phase, failureClass) pair
 * that identifies the failing operation.
 *
 * RED-vs-GREEN contract:
 *   - GREEN on HEAD `a0d496408...` for the LIFECYCLE-OWNER seam
 *     (the helper records the phase-tagged observation correctly).
 *   - AF-RED-04 + AF-RED-05 + AF-RED-06 exercise failure modes that
 *     were INDISTINGUISHABLE before this ACT — these were the live RED
 *     discriminator failures that motivated the ACT. They now produce
 *     distinct (phase, failureClass) pairs.
 *
 * Topology (per ACT §5):
 *   - The test body does NOT manually call `runMycPrimeOnSessionStart`.
 *   - The test body does NOT manually call `myc_prime`.
 *   - The only prime invocation is the production automatic-prime path
 *     wired through `SdkSessionLifecycle.onMycPrimeRequested`.
 *
 * Conservation: the test does NOT modify McpHub, SdkSessionLifecycle,
 * hooks-adapter, or the production call chain. It only injects a
 * controllable failure mode at the McpHub boundary and asserts the
 * recorded diagnostic discriminator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test"
import { resolve } from "node:path"
import sinon from "sinon"
import "should"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { __resetMycPrimeResultsForTests, getMycPrimeResult, runMycPrimeOnSessionStart } from "@/sdk/myc-prime-automation"
import {
	__getAllMycPrimeLiveDiagForTests,
	__resetMycPrimeLiveDiagForTests,
	getMycPrimeLiveDiag,
	setMycPrimeLiveDiagEnabled,
} from "@/sdk/myc-prime-live-diag"
import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"
import type { SdkSessionHost } from "@/sdk/session-host"
import { McpHub } from "@/services/mcp/McpHub"
import type { McpConnection } from "@/services/mcp/types"

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

const FIXTURE = resolve(__dirname, "../../services/mcp/__fixtures__/myc-prime-echo/server.mjs")

function createMycHub(options: { serverName?: string; disabled?: boolean; transportType?: "stdio" | "sse" } = {}): McpHub {
	const serverName = options.serverName ?? "myc"
	const transportType = options.transportType ?? "stdio"
	const config = {
		type: transportType,
		command: "node",
		args: [FIXTURE],
		timeout: 60,
		env: { MYC_SESSION_ID: { fromSession: "sessionId" } } as Record<string, { fromSession: string }>,
		...(options.disabled ? { disabled: true } : {}),
	}
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).telemetryService = { captureMcpToolCall: sinon.stub() }
	;(hub as any).clientVersion = "test-0.0.0"
	const connection: McpConnection = {
		server: {
			name: serverName,
			config: JSON.stringify(config),
			status: options.disabled ? "disconnected" : "connected",
			disabled: !!options.disabled,
		},
		client: {} as unknown as Client,
		transport: {} as unknown as McpConnection["transport"],
	}
	;(hub as any).connections = [connection]
	;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()
	return hub
}

function makeFakeSdkHost(sessionIdToReturn: string): SdkSessionHost {
	return {
		start: async () => ({ sessionId: sessionIdToReturn }),
		stop: async () => {},
		subscribe: () => () => {},
		pendingPrompts: async () => [],
	} as unknown as SdkSessionHost
}

async function waitForPrimeResult(sessionId: string, timeoutMs = 2000): Promise<void> {
	const start = Date.now()
	while (!getMycPrimeResult(sessionId) && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 25))
	}
}

describe("ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01 — bounded discriminator RED reproduction", () => {
	beforeEach(() => {
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		setMycPrimeLiveDiagEnabled(true)
	})

	afterEach(async () => {
		__resetMycPrimeResultsForTests()
		__resetMycPrimeLiveDiagForTests()
		setMycPrimeLiveDiagEnabled(false)
	})

	it("AF-RED-01: H1 — no myc server configured → discriminator pins registration_lookup + no_myc_server", async () => {
		const sessionId = `af-red-01-${Date.now()}`
		// Build a hub WITHOUT the `myc` server entry — `resolveMycServerName`
		// will return undefined and the helper will short-circuit at
		// `registration_lookup`.
		const hub = Object.create(McpHub.prototype) as McpHub
		;(hub as any).telemetryService = { captureMcpToolCall: sinon.stub() }
		;(hub as any).clientVersion = "test-0.0.0"
		;(hub as any).connections = []
		;(hub as any).sessionConnections = new Map<string, Map<string, McpConnection>>()

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("skipped")
		expect(entry?.acquisition.serverDetected).toBe(false)
		expect(entry?.acquisition.phase).toBe("registration_lookup")
		expect(entry?.acquisition.failureClass).toBeUndefined() // skipped is not a failure
		expect(entry?.acquisition.sessionConnectionStatus).toBe("not_attempted")
		expect(entry?.acquisition.toolFound).toBe(false)
	})

	it("AF-RED-02: H6 — myc configured but disabled → discriminator pins registration_lookup + not_attempted", async () => {
		// A disabled myc server is treated as "not configured" by the
		// registration filter (`getServers()` filters out disabled). This
		// collapses to the same AF-RED-01 discriminator — the AF-RED-02
		// boundary is "configured-but-disabled" not "session-bound without
		// sessionId" (which is AF-RED-06).
		const sessionId = `af-red-02-${Date.now()}`
		const hub = createMycHub({ disabled: true })

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("skipped")
		expect(entry?.acquisition.phase).toBe("registration_lookup")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("not_attempted")
		expect(entry?.acquisition.toolFound).toBe(false)
	})

	it("AF-RED-03: H1 server-name variant — only 'myc-other' configured (not 'myc' / 'myc-mcp') → registration_lookup", async () => {
		const sessionId = `af-red-03-${Date.now()}`
		const hub = createMycHub({ serverName: "myc-other" })

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("skipped")
		expect(entry?.acquisition.serverDetected).toBe(false)
		expect(entry?.acquisition.phase).toBe("registration_lookup")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("not_attempted")
	})

	it("AF-RED-04: H2 — SSE transport (ensureSessionConnection returns undefined) → discriminator pins session_connection + no_static_connection", async () => {
		const sessionId = `af-red-04-${Date.now()}`
		// SSE transport bypasses the per-session child path (Stage 5 is
		// stdio-only). ensureSessionConnection returns undefined for SSE
		// (McpHub.ts:500-502), callTool throws
		// "No per-session connection available for server: myc", the
		// helper's catch pins it to session_connection +
		// no_static_connection via the error-prefix heuristic.
		//
		// REACHABILITY NOTE: the `unsupported_transport` failureClass
		// is a discriminated sub-case of H2 that requires a richer
		// error envelope from McpHub (the callTool layer currently
		// collapses the "why" into a single string). It remains in
		// the bounded enum for a future ACT that threads
		// error.code through.
		const hub = createMycHub({ transportType: "sse" })

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("session_connection")
		expect(entry?.acquisition.failureClass).toBe("no_static_connection")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("unavailable")
		expect(entry?.acquisition.toolFound).toBe(false)
	})

	it("AF-RED-05: H4 — callTool throws (hub.callTool is replaced with a throwing stub) → discriminator pins tool_call + client_request_failed", async () => {
		const sessionId = `af-red-05-${Date.now()}`
		const hub = createMycHub()
		// Replace ensureSessionConnection so the helper sees a
		// successful spawn, then replace the connection's client.request
		// with a throwing stub so the tools/call call itself fails.
		// This is the cleanest way to inject the H4 failure mode
		// without depending on the fixture.
		;(hub as any).ensureSessionConnection = async () => {
			// Return a stub connection whose client.request throws.
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						throw new Error("simulated client.request failure")
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.failureClass).toBe("client_request_failed")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("unavailable")
		expect(entry?.acquisition.toolFound).toBe(false)
	})

	it("AF-RED-06: H5 — tool call succeeds but returns empty text → discriminator pins result_parse + empty_text", async () => {
		const sessionId = `af-red-06-${Date.now()}`
		const hub = createMycHub()
		// ensureSessionConnection succeeds (returns a stub connection),
		// client.request returns a valid-shape-but-empty-text response.
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						// Empty text — triggers the result_parse empty_text branch.
						return { content: [{ type: "text", text: "" }] }
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("result_parse")
		expect(entry?.acquisition.failureClass).toBe("empty_text")
		// Session connection succeeded and tool call succeeded — only the
		// parser failed.
		expect(entry?.acquisition.sessionConnectionStatus).toBe("spawned")
		expect(entry?.acquisition.toolFound).toBe(true)
	})

	it("AF-RED-07: H5 non-text variant — content array has no {type:text} → discriminator pins result_parse + non_text_response", async () => {
		const sessionId = `af-red-07-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						// Only image content — no text block.
						return { content: [{ type: "image", data: "binary" }] }
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("result_parse")
		expect(entry?.acquisition.failureClass).toBe("non_text_response")
	})

	it("AF-RED-08: H5 missing-content variant — response.content is undefined → McpHub normalizes to [] → non_text_response", async () => {
		// REACHABILITY NOTE: McpHub.callTool normalizes a missing
		// `content` field to `[]` (see McpHub.ts:2204
		// `content: result.content ?? []`). The prime-automation helper
		// therefore sees an empty array, not `undefined`. The
		// discriminator tree correctly pins this as `non_text_response`
		// (the array has no `{type:"text"}` block).
		//
		// The `missing_content` failureClass remains in the bounded enum
		// for two reasons:
		//   1. Defense-in-depth: a future McpHub change that bypasses
		//      the `?? []` normalization would expose the discriminator.
		//   2. The ACQ-F-04 unit test exercises the discriminator
		//      directly against the recorder, independent of McpHub's
		//      normalization, to pin the bounded enum value is accepted.
		const sessionId = `af-red-08-${Date.now()}`
		const hub = createMycHub()
		;(hub as any).ensureSessionConnection = async () => {
			return {
				server: { name: "myc", config: "{}", status: "connected", disabled: false },
				client: {
					request: async () => {
						// No content at all.
						return { content: undefined }
					},
				},
				transport: {} as unknown as McpConnection["transport"],
			} as unknown as McpConnection
		}

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("failed")
		expect(entry?.acquisition.phase).toBe("result_parse")
		expect(entry?.acquisition.failureClass).toBe("non_text_response")
	})

	it("AF-RED-09: GREEN regression — real lifecycle + real fixture still produces status=ok with bounded discriminator", async () => {
		// This test pins the GREEN synthetic-real path (lifecycle02 T1).
		// The diagnostic expansion MUST remain bit-identical for the
		// happy path. status=ok, phase=tool_call,
		// sessionConnectionStatus=spawned, toolFound=true.
		const sessionId = `af-red-09-${Date.now()}`
		const hub = createMycHub()

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		const entry = getMycPrimeLiveDiag(sessionId)
		expect(entry?.acquisition.status).toBe("ok")
		expect(entry?.acquisition.phase).toBe("tool_call")
		expect(entry?.acquisition.sessionConnectionStatus).toBe("spawned")
		expect(entry?.acquisition.toolFound).toBe(true)
		expect(entry?.acquisition.failureClass).toBeUndefined()
		expect(entry?.acquisition.textBytes).toBeGreaterThan(0)
	})

	it("AF-RED-10: diagnostic OFF — all the above observations are silent (off-path bit-identical)", async () => {
		setMycPrimeLiveDiagEnabled(false)
		const sessionId = `af-red-10-${Date.now()}`
		const hub = createMycHub()

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: hub,
			requestToolApproval: sinon.stub().resolves({ approved: true }) as never,
			askQuestion: sinon.stub().resolves({}) as never,
			onSessionEvent: sinon.stub(),
			onSendComplete: sinon.stub(),
			onSendError: sinon.stub(),
			onMycPrimeRequested: ({ sessionId: sid }) => runMycPrimeOnSessionStart({ sessionId: sid, mcpHub: hub }),
		})
		;(lifecycle as any).sharedHost = makeFakeSdkHost(sessionId)
		;(lifecycle as any).sharedHostPromise = Promise.resolve(makeFakeSdkHost(sessionId))

		const result = await lifecycle.startNewSession({
			config: {
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4",
				cwd: "/workspace",
			},
		} as never)
		expect(result.status).toBe("started")
		await waitForPrimeResult(sessionId)

		// Diagnostic OFF — entry should be undefined.
		expect(getMycPrimeLiveDiag(sessionId)).toBeUndefined()
		expect(__getAllMycPrimeLiveDiagForTests().length).toBe(0)

		// The recorder singleton is still populated — production behavior
		// is bit-identical when diagnostic is OFF.
		const recorded = getMycPrimeResult(sessionId)
		expect(recorded?.status).toBe("ok")
	})
})
