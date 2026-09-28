#!/usr/bin/env node
/**
 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — Deterministic prime fixture.
 *
 * A real MCP server (Node ESM, stdio transport) used by the production-shape
 * API-01 test. The fixture echoes back a deterministic `myc prime` payload
 * containing a stable witness `MYC-AUTO-PRIME-WITNESS-<fixed-marker>` so the
 * test never depends on local myc queue state.
 *
 * The fixture models the real `myc prime` output shape:
 *   {
 *     content: [{ type: "text", text: "# READY 1 of 1\n# auto-prime\nMYC-AUTO-PRIME-WITNESS-AUTO01\n" }]
 *   }
 *
 * It also echoes MYC_SESSION_ID env to prove session routing, matching the
 * AUTOSTART01 fixture's behavior at `myc-prime-echo/server.mjs`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const WITNESS = "MYC-AUTO-PRIME-WITNESS-AUTO01"

const server = new McpServer(
	{ name: "myc-prime-auto", version: "0.0.0" },
	{ capabilities: { tools: {} } },
)

server.tool(
	"prime",
	"Deterministic prime returning MYC-AUTO-PRIME-WITNESS-AUTO01 — used to drive the API-01 production-shape RED for ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01.",
	{
		session: z.string().optional(),
		repo: z.string().optional(),
		format: z.string().optional(),
		budget: z.number().optional(),
	},
	async (args) => {
		const session = process.env.MYC_SESSION_ID ?? null
		const primeBody =
			`# READY 1 of 1\n` +
			`# auto-prime (deterministic fixture)\n` +
			`session: ${session ?? "<unset>"}\n` +
			`session_keys: ${Object.keys(process.env).filter((k) => k.startsWith("MYC_")).join(",") || "<none>"}\n` +
			`called_with_session: ${args && typeof args.session === "string" ? args.session : "<unset>"}\n` +
			`called_with_repo: ${args && typeof args.repo === "string" ? args.repo : "<unset>"}\n` +
			`called_with_format: ${args && typeof args.format === "string" ? args.format : "<unset>"}\n` +
			`\n${WITNESS}\n`
		return {
			content: [
				{
					type: "text",
					text: primeBody,
				},
			],
		}
	},
)

const transport = new StdioServerTransport()
await server.connect(transport)
