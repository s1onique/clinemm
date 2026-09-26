#!/usr/bin/env node
/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 3 child witness.
 *
 * A real MCP server (Node ESM, stdio transport) used by the A2A-04 test to
 * prove that a per-session child process actually receives the supplied
 * session id in its `process.env`.
 *
 * Exposes exactly one tool: `whoami`. Returns:
 *   {
 *     pid:          process.pid,
 *     session:      process.env.MYC_SESSION_ID ?? null,
 *     session_keys: Object.keys(process.env).filter(k => k.startsWith("MYC_")),
 *   }
 *
 * The fixture is intentionally minimal: it answers ONLY one question —
 * "did the session id you (the parent) passed in MYC_SESSION_ID actually
 * arrive here in MY child process env?" The parent can read the answer
 * via `client.callTool({ name: "whoami", arguments: {} })` and there is no
 * way for the parent to fake that answer without spawning the child.
 *
 * Run directly: `node whoami.mjs`
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

const server = new McpServer({ name: "session-id-echo", version: "0.0.0" }, { capabilities: { tools: {} } })

server.tool(
	"whoami",
	"Returns { pid, session, session_keys } read from THIS process's process.env — proof that the parent-supplied env actually reached the child.",
	{},
	async () => {
		const session = process.env.MYC_SESSION_ID ?? null
		const sessionKeys = Object.keys(process.env).filter((k) => k.startsWith("MYC_"))
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						pid: process.pid,
						session,
						session_keys: sessionKeys,
					}),
				},
			],
		}
	},
)

const transport = new StdioServerTransport()
await server.connect(transport)
