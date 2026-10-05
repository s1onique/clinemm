#!/usr/bin/env node
/**
 * ACT-MYC-CLINEMM02-C — Prime automation test fixture.
 *
 * A real MCP server (Node ESM, stdio transport) used by
 * `myc-prime-automation.lifecycle01.test.ts` to prove the
 * `myc_prime` automation reaches the per-session MCP child with the
 * session id threaded through MYC_SESSION_ID.
 *
 * ACT-MYC-CLINEMM03-AUTOMATIC-PRIME-TOOL-NAME-REPAIR01: the fixture
 * advertises `myc_prime` to mirror the real published myc MCP server
 * surface. The prior `"prime"` name was a test-only divergence from
 * the real surface — production was calling `"prime"` against a real
 * server that exports `myc_prime`, yielding `unknown tool 'prime'`.
 * The fixture now mirrors the real surface so the GREEN reproduction
 * is the same shape the LIVE dump will exercise.
 *
 * Exposes one tool: `myc_prime`. Returns:
 *   {
 *     pid:                process.pid,
 *     session:            process.env.MYC_SESSION_ID ?? null,
 *     session_keys:       Object.keys(process.env).filter(k => k.startsWith("MYC_")),
 *     called_with_session: arguments.session ?? null,
 *     called_with_repo:    arguments.repo ?? null,
 *     called_with_format:  arguments.format ?? null,
 *     myrc_args:           arguments,
 *   }
 *
 * The fixture is intentionally minimal: it answers ONLY one question —
 * "did the session id you (the parent) passed in MYC_SESSION_ID actually
 * arrive here in MY child process env, AND did the parent's callTool
 * payload forward `session` to me?" The parent can read the answer via
 * `client.callTool({ name: "myc_prime", arguments: { session, repo, format } })`
 * and there is no way for the parent to fake that answer without
 * spawning the child.
 *
 * Run directly: `node server.mjs`
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "myc-prime-echo", version: "0.0.0" }, { capabilities: { tools: {} } })

server.tool(
	"myc_prime",
	"Returns { pid, session, session_keys, called_with_session, called_with_repo, called_with_format, myrc_args } read from THIS process's process.env plus the parent's callTool payload — proof that MYC_SESSION_ID arrives and that the parent correctly threads it as an argument.",
	{
		session: z.string().optional(),
		repo: z.string().optional(),
		format: z.string().optional(),
	},
	async (args) => {
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
						called_with_session: args && typeof args.session === "string" ? args.session : null,
						called_with_repo: args && typeof args.repo === "string" ? args.repo : null,
						called_with_format: args && typeof args.format === "string" ? args.format : null,
						myrc_args: args ?? {},
					}),
				},
			],
		}
	},
)

const transport = new StdioServerTransport()
await server.connect(transport)
