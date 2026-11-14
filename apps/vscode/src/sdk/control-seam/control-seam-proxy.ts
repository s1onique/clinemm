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
 *     tools. There is no `start_act`, no `send_feedback`, no
 *     `cancel_run`.
 *   - reads the bearer token from the private token file. If the token
 *     or the socket is absent, every call fails closed with a
 *     non-informative error.
 *   - never writes a credential or a transcript to stdout/stderr.
 *
 * This file is the ENTRY POINT Codex is pointed at. It is deliberately
 * a thin adapter: it contains no policy, only transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { ControlSeamClient, connectControlSeam, loadControlSeamToken } from "./control-seam-client"
import { resolveControlSeamSocketPath, resolveControlSeamTokenPath } from "./control-seam-paths"
import type { ControlSeamOperationId, ControlSeamResponse } from "./control-seam-protocol"

export interface ControlSeamProxyOptions {
	/** Override the socket path (tests / non-default installs). */
	readonly socketPath?: string
	/** Override the token path (tests / non-default installs). */
	readonly tokenPath?: string
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
 * Build the proxy's MCP server with the two read-only tools.
 *
 * The tools are registered by the SAME ids the control protocol uses,
 * so there is exactly one vocabulary across the whole seam.
 */
export function createControlSeamProxyServer(options: ControlSeamProxyOptions = {}): McpServer {
	const env = options.env ?? process.env
	const socketPath = options.socketPath ?? resolveControlSeamSocketPath(env)
	const tokenPath = options.tokenPath ?? resolveControlSeamTokenPath(env)

	const server = new McpServer({ name: "clinemm-control-seam", version: "1" }, { capabilities: { tools: {} } })

	const call = async (op: ControlSeamOperationId, sessionId?: string): Promise<ControlSeamResponse> => {
		// Fail closed when there is no installed instance.
		const token = loadControlSeamToken(tokenPath)
		if (!token) {
			return {
				v: 1,
				ok: false,
				error: { code: "control_seam_no_instance", message: "no control-seam instance is available" },
			}
		}
		const socket = await connectControlSeam(socketPath)
		if (!socket) {
			return {
				v: 1,
				ok: false,
				error: { code: "control_seam_no_instance", message: "no control-seam instance is available" },
			}
		}
		try {
			const client = new ControlSeamClient(token)
			client.setWriter((payload) => socket.write(payload))
			client.attach(socket)
			// ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 (C1.2): the client
			// settles every outstanding request on close / error /
			// timeout, so a lost extension host can never leave this
			// MCP tool call hanging forever.
			const response = await client.request(op, sessionId)
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
			description:
				"Read the active ClineMM run's session identity and authoritative status. Read-only; does not start, steer, or cancel anything.",
			inputSchema: {
				sessionId: z.string().optional().describe("Optional echo of the expected session id."),
			},
		},
		async (args) => toToolResult(await call("clinemm_get_run", args.sessionId)),
	)

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
