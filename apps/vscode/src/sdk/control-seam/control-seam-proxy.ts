/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The LOCAL PROXY: a stdio MCP server that forwards to the extension
 * host's control socket.
 *
 *   Codex (MCP stdio client) -> THIS (stdio MCP server)
 *                               -> AF_UNIX socket
 *                                 -> extension-host listener
 *
 * The proxy:
 *
 *   - is a LOCAL process. It binds nothing and listens on nothing.
 *     Codex launches it as a child process over stdio.
 *   - exposes EXACTLY the two read-only operations, by name, as MCP
 *     tools, plus the two MUTATION operations — but the mutation
 *     operations are registered ONLY when the extension host published
 *     a write credential for THIS instance. A read-only installation
 *     therefore exposes EXACTLY the original two operations.
 *   - reads the bearer token from the private token file. If the token
 *     or the socket is absent, every call fails closed with a
 *     non-informative error.
 *   - reads the SEPARATE write credential from its own private file.
 *     The two credentials are independent: the read token never
 *     authorizes a mutation.
 *   - never writes a credential or a transcript to stdout/stderr.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01
 * -----------------------------------------
 * The MCP tool annotations (`readOnlyHint`, `destructiveHint`, ...) are
 * DISCOVERY hints. They are NEVER authorization. The extension-host
 * server performs the credential comparison itself, per request.
 *
 * This file is the ENTRY POINT Codex is pointed at. It is deliberately
 * a thin adapter: it contains no policy, only transport.
 */

import { dirname } from "node:path"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { ControlSeamClient, connectControlSeam, loadControlSeamToken } from "./control-seam-client"
import { loadControlSeamWriteToken, resolveControlSeamWriteTokenPath } from "./control-seam-mutation"
import { resolveControlSeamSocketPath, resolveControlSeamTokenPath } from "./control-seam-paths"
import type { ControlSeamOperationId, ControlSeamResponse, ControlSeamWritePayload } from "./control-seam-protocol"

export interface ControlSeamProxyOptions {
	/** Override the socket path (tests / non-default installs). */
	readonly socketPath?: string
	/** Override the token path (tests / non-default installs). */
	readonly tokenPath?: string
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: override the SEPARATE
	 * write-credential path (tests / non-default installs).
	 */
	readonly writeTokenPath?: string
	/** Environment used for path resolution. */
	readonly env?: NodeJS.ProcessEnv
}

/**
 * Translate a control-seam response into an MCP tool result.
 *
 * A failed seam response becomes an MCP error result whose text is
 * the seam's own (non-informative) code. No task content is ever
 * interpolated.
 */
function toToolResult(response: ControlSeamResponse): {
	content: { type: "text"; text: string }[]
	isError?: boolean
} {
	if (!response.ok) {
		const code = response.error?.code ?? "control_seam_error"
		return { content: [{ type: "text", text: code }], isError: true }
	}
	return { content: [{ type: "text", text: JSON.stringify(response.result ?? null, null, 2) }] }
}

/**
 * Build the proxy's MCP server.
 *
 * The READ tools are registered UNCONDITIONALLY — their behavior is
 * EXACTLY the RECON01 behavior.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the two WRITE tools are
 * registered ONLY when the extension host published a write credential
 * for THIS instance. That file is created ONLY when the operator's
 * SEPARATE mutation opt-in is present AND the extension host minted a
 * grant for its OWN workspace. So:
 *
 *   - mutation DISABLED (the default) -> EXACTLY the original two
 *     read-only tools are exposed, byte-for-byte the RECON01 surface.
 *   - mutation ENABLED -> the two write tools are exposed, and the
 *     extension-host server still enforces the credential per request.
 *
 * The tools are registered by the SAME ids the control protocol uses,
 * so there is exactly one vocabulary across the whole seam.
 */
export function createControlSeamProxyServer(options: ControlSeamProxyOptions = {}): McpServer {
	const env = options.env ?? process.env
	const socketPath = options.socketPath ?? resolveControlSeamSocketPath(env)
	const tokenPath = options.tokenPath ?? resolveControlSeamTokenPath(env)
	// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the SEPARATE write
	// credential lives in its own file next to the read token.
	const writeTokenPath = options.writeTokenPath ?? resolveControlSeamWriteTokenPath(dirname(tokenPath))

	const server = new McpServer({ name: "clinemm-control-seam", version: "1" }, { capabilities: { tools: {} } })

	const call = async (
		op: ControlSeamOperationId,
		sessionId?: string,
		payload?: ControlSeamWritePayload,
	): Promise<ControlSeamResponse> => {
		// Fail closed when there is no installed instance.
		const token = loadControlSeamToken(tokenPath)
		if (!token) {
			return {
				v: 1,
				ok: false,
				error: { code: "control_seam_no_instance", message: "no control-seam instance is available" },
			}
		}
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the write credential
		// is OPTIONAL here — a READ call works without it. A WRITE call
		// without it is refused by the server.
		const writeToken = loadControlSeamWriteToken(writeTokenPath)
		const socket = await connectControlSeam(socketPath)
		if (!socket) {
			return {
				v: 1,
				ok: false,
				error: { code: "control_seam_no_instance", message: "no control-seam instance is available" },
			}
		}
		try {
			const client = new ControlSeamClient(token, writeToken !== undefined ? { writeToken } : {})
			client.setWriter((payload) => socket.write(payload))
			client.attach(socket)
			// ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.2): the client
			// settles every outstanding request on close / error /
			// timeout, so a lost extension host can never leave this
			// MCP tool call hanging forever.
			const response = await client.request(op, sessionId, payload)
			client.dispose()
			return response
		} finally {
			socket.destroy()
		}
	}

	server.registerTool(
		"clinemm_capabilities",
		{
			description: "List the read-only operations the ClineMM control seam exposes.",
			inputSchema: {},
		},
		async () => toToolResult(await call("clinemm_capabilities")),
	)

	server.registerTool(
		"clinemm_get_run",
		{
			description: [
				"Read the active ClineMM run's session identity and authoritative status. Read-only; does not start, steer, or cancel anything.",
				"",
				"Field semantics:",
				"  running: SDK agent turn currently in flight.",
				"  taskState.phase: Last identity-bound host-submitted TaskHeader phase.",
				"    Vocabulary: idle | streaming | awaiting_approval | awaiting_followup |",
				"                compacting | completed | error | resumable",
				"  taskState.source: Provenance of the published projection (shadow | host | legacy).",
				"  taskState.seq: Presentation/turn-state sequence of the published projection.",
				"  taskState.epoch: Conversation epoch of the published state.",
				"  taskState.stateVersion: Publication version of the submitted state.",
				"  taskState.label: The TaskHeader's user-facing label for that phase.",
				"",
				"running=false does NOT mean completed.",
				"taskState.phase=completed is the published terminal presentation,",
				"not proof that every React render has committed.",
				"taskState is omitted when no valid identity-bound published projection exists.",
			].join("\n"),
			inputSchema: {
				sessionId: z.string().optional().describe("Optional echo of the expected session id."),
			},
		},
		async (args) => toToolResult(await call("clinemm_get_run", args.sessionId)),
	)

	// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the MUTATION tools are
	// registered ONLY when the extension host published a write
	// credential for THIS instance. A read-only installation exposes
	// EXACTLY the original two operations.
	//
	// The annotations below are DISCOVERY hints. They are NOT
	// authorization: the extension-host server performs the
	// constant-time credential comparison itself, per request.
	const writeToken = loadControlSeamWriteToken(writeTokenPath)
	if (writeToken !== undefined) {
		server.registerTool(
			"clinemm_start_act",
			{
				description: [
					"Start ONE ClineMM task in the installed extension's own workspace, through the extension's existing task lifecycle.",
					"",
					"Requires the operator's separate mutation grant. The extension host",
					"rejects the call when the workspace does not match the installed one,",
					"when another task already owns the extension, or when the write",
					"credential is invalid.",
					"",
					"The response outcome is one of:",
					"  accepted        — task/session creation was acknowledged (NOT completion).",
					"  rejected        — preconditions failed; no execution started.",
					"  superseded      — another lifecycle operation took ownership.",
					"  unknown_outcome — the host could not prove whether a start occurred.",
					"",
					"`accepted` always carries the authoritative sessionId.",
					"Reuse the SAME requestId to retry: an accepted request is never started twice",
					"within one extension-host instance; a different payload under the same",
					"requestId is rejected.",
					"",
					"Native ClineMM tool approvals still apply; this call does not bypass them.",
				].join("\n"),
				inputSchema: {
					requestId: z.string().describe("Unique client-supplied idempotency key for this operation."),
					prompt: z.string().describe("The task prompt to hand to the installed extension."),
					expectedWorkspace: z
						.string()
						.describe(
							"The workspace path this client believes the extension is installed in. It must match exactly.",
						),
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			async (args) =>
				toToolResult(
					await call("clinemm_start_act", undefined, {
						op: "clinemm_start_act",
						input: {
							requestId: args.requestId,
							prompt: args.prompt,
							expectedWorkspace: args.expectedWorkspace,
						},
					}),
				),
		)

		server.registerTool(
			"clinemm_read_events",
			{
				description: [
					"Read a bounded, ordered slice of the REAL emitted events for the task this client owns.",
					"",
					"The events are the extension's own published messages, with their own",
					"ordering identity. Nothing is reconstructed or invented.",
					"",
					"Pass the previous `nextCursor` as `afterCursor` to page forward.",
					"`cursorExpired: true` means the requested cursor is older than the",
					"retained window — treat the returned slice as INCOMPLETE.",
					"",
					"Only the session this mutation client started may be read; a foreign",
					"session id is rejected.",
				].join("\n"),
				inputSchema: {
					sessionId: z.string().describe("The session id this client owns, as returned by clinemm_start_act."),
					afterCursor: z.string().optional().describe("The cursor of the last event already observed."),
					limit: z.number().int().min(1).max(100).optional().describe("Maximum number of events to return."),
				},
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			async (args) =>
				toToolResult(
					await call("clinemm_read_events", undefined, {
						op: "clinemm_read_events",
						input: {
							sessionId: args.sessionId,
							...(args.afterCursor !== undefined ? { afterCursor: args.afterCursor } : {}),
							...(args.limit !== undefined ? { limit: args.limit } : {}),
						},
					}),
				),
		)
	}

	return server
}

/**
 * Run the proxy over stdio.
 *
 * This is the process Codex launches. It never prints anything to
 * stdout except the MCP protocol traffic — the MCP stdio transport
 * owns stdout.
 */
export async function runControlSeamProxy(options: ControlSeamProxyOptions = {}): Promise<void> {
	const server = createControlSeamProxyServer(options)
	const transport = new StdioServerTransport()
	await server.connect(transport)
}
