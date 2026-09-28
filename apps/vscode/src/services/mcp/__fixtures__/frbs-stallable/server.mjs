#!/usr/bin/env node
/**
 * ACT-CLINEMM-FINALIZATION-RUN-BOOTSTRAP-STALL01 — Discriminator fixture.
 *
 * A real MCP server (Node ESM, stdio transport) used by the FRBS tests to
 * prove which post-connect probe can stall session bootstrap and which one
 * cannot.
 *
 * Behavior controlled by env vars:
 *   FRBS_STALL_KIND ∈ { "none", "listResources", "listResourceTemplates", "listPrompts", "listTools" }
 *     Default "none" (responsive — FRBS-02 / FRBS-08).
 *
 * For "listResources" / "listResourceTemplates" / "listPrompts": the chosen
 * probe is received and the request id is captured, but the response is
 * intentionally never written. The JSON-RPC stream is left half-open.
 * (Other probes respond normally so the responsive baseline can be
 * compared directly.)
 *
 * For "listTools": same stall, applied to tools/list. This is the
 * load-bearing discriminator (FRBS-06) because tools/list is consumed by
 * the model tool surface; the test asserts the bootstrap does not hang
 * the entire session even when this probe never resolves.
 *
 * Exposes one tool: `whoami` — returns
 *   { pid, session, session_keys }
 * so the bootstrap-eager caller can verify the session id reached the child.
 *
 * For the responsive path this fixture is behaviorally indistinguishable
 * from the production-shape fixture at
 * `__fixtures__/session-id-echo/whoami.mjs`. The single delta is the
 * env-var-controlled stall on one post-connect probe.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
	CallToolRequestSchema,
	ListPromptsRequestSchema,
	ListPromptsResultSchema,
	ListResourcesRequestSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesRequestSchema,
	ListResourceTemplatesResultSchema,
	ListToolsRequestSchema,
	ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js"

const STALL_KIND = process.env.FRBS_STALL_KIND || "none"

const server = new Server(
	{ name: "frbs-stallable", version: "0.0.0" },
	{
		capabilities: {
			tools: {},
			// resources and prompts are intentionally advertised even when
			// FRBS_STALL_KIND targets one of them — the FRBS-03 / FRBS-21
			// scenario only skips the probe when the server did NOT advertise
			// the capability. The capability-aware probe must still be
			// able to defend against an *advertised* probe that never
			// responds.
			resources: {},
			prompts: {},
		},
	},
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [
			{
				name: "whoami",
				description:
					"Returns { pid, session, session_keys } from THIS process's process.env — proof the parent-supplied session id reached the child.",
				inputSchema: { type: "object", properties: {}, additionalProperties: false },
			},
		],
	}
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name } = request.params || {}
	if (name !== "whoami") {
		return {
			content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${name}` }) }],
			isError: true,
		}
	}
	const session = process.env.MYC_SESSION_ID ?? null
	const sessionKeys = Object.keys(process.env).filter((k) => k.startsWith("MYC_"))
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({ pid: process.pid, session, session_keys: sessionKeys }),
			},
		],
	}
})

if (STALL_KIND === "listResources") {
	// Stall ONLY this probe. Respond normally to the others.
	server.setRequestHandler(ListResourcesRequestSchema, async () => {
		process.stderr.write("[frbs-stallable] resources/list entered; stalling\n")
		// Block forever. The half-open JSON-RPC stream is exactly the
		// pathological shape this ACT is targeting.
		await new Promise(() => {})
		// Unreachable.
		return ListResourcesResultSchema.parse({ resources: [] })
	})
} else {
	server.setRequestHandler(ListResourcesRequestSchema, async () => ListResourcesResultSchema.parse({ resources: [] }))
}

if (STALL_KIND === "listResourceTemplates") {
	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
		process.stderr.write("[frbs-stallable] resources/templates/list entered; stalling\n")
		await new Promise(() => {})
		return ListResourceTemplatesResultSchema.parse({ resourceTemplates: [] })
	})
} else {
	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () =>
		ListResourceTemplatesResultSchema.parse({ resourceTemplates: [] }),
	)
}

if (STALL_KIND === "listPrompts") {
	server.setRequestHandler(ListPromptsRequestSchema, async () => {
		process.stderr.write("[frbs-stallable] prompts/list entered; stalling\n")
		await new Promise(() => {})
		return ListPromptsResultSchema.parse({ prompts: [] })
	})
} else {
	server.setRequestHandler(ListPromptsRequestSchema, async () => ListPromptsResultSchema.parse({ prompts: [] }))
}

if (STALL_KIND === "listTools") {
	// Replace the normal tools/list with a stalling version. FRBS-06.
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		process.stderr.write("[frbs-stallable] tools/list entered; stalling\n")
		await new Promise(() => {})
		return ListToolsResultSchema.parse({ tools: [] })
	})
}

const transport = new StdioServerTransport()
await server.connect(transport)
