/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 3 child witness.
 *
 * Spawns the real MCP fixture (`__fixtures__/session-id-echo/whoami.mjs`) as
 * a stdio child via @modelcontextprotocol/sdk's `StdioClientTransport` +
 * `Client.connect()` and asserts the child RECEIVED `MYC_SESSION_ID` in its
 * `process.env`.
 *
 * The proof is INSIDE the spawned child: the fixture's `whoami` tool reads
 * `process.env.MYC_SESSION_ID` from its own process and returns it. A parent
 * cannot fake that value without actually running the child. That is what
 * A2A-04 means by "load-bearing child-side proof".
 */

import { afterEach, beforeEach, describe, it } from "bun:test"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import "should"

const FIXTURE = resolve(__dirname, "../__fixtures__/session-id-echo/whoami.mjs")

describe("A2A-04 child-side proof: STDIO MCP child sees MYC_SESSION_ID in its process.env", () => {
	let client: Client
	let transport: StdioClientTransport

	beforeEach(() => {
		transport = new StdioClientTransport({
			command: "node",
			args: [FIXTURE],
			env: {
				...process.env,
				MYC_SESSION_ID: "session-A",
			} as Record<string, string>,
		})
		client = new Client({ name: "a2a-04-witness", version: "0.0.0" }, { capabilities: {} })
	})

	afterEach(async () => {
		try {
			await client.close()
		} catch (_e) {
			/* ignore — the child may already be gone */
		}
	})

	it("connects and lists the `whoami` tool", async () => {
		await client.connect(transport)
		const { tools } = await client.listTools()
		const whoami = tools.find((t) => t.name === "whoami")
		whoami!.should.not.be.undefined()
	})

	it("A2A-04: child reports MYC_SESSION_ID === 'session-A' from inside its own process.env", async () => {
		await client.connect(transport)
		const res = await client.callTool({ name: "whoami", arguments: {} })
		const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text
		text!.should.be.a.String()
		const payload = JSON.parse(text!)
		// pid proves this is the CHILD's pid (not the parent's)
		payload.pid.should.be.a.Number()
		payload.pid.should.not.equal(process.pid)
		// session proves the env var reached the child
		payload.session.should.equal("session-A")
		// session_keys proves no other MYC_ env was set
		payload.session_keys.should.deepEqual(["MYC_SESSION_ID"])
	})

	it("a different parent-supplied session id reaches a fresh child", async () => {
		// Tear down the default transport + client, build a new one with a
		// different MYC_SESSION_ID. Asserts that each acquisition carries
		// ITS own session id — the foundation A2A-08 (A+B concurrent) and
		// A2A-09 (reconnect A) build on.
		await client.close()

		const transport2 = new StdioClientTransport({
			command: "node",
			args: [FIXTURE],
			env: {
				...process.env,
				MYC_SESSION_ID: "session-B",
			} as Record<string, string>,
		})
		const client2 = new Client({ name: "a2a-04-witness-2", version: "0.0.0" }, { capabilities: {} })
		try {
			await client2.connect(transport2)
			const res = await client2.callTool({ name: "whoami", arguments: {} })
			const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text
			const payload = JSON.parse(text!)
			payload.session.should.equal("session-B")
		} finally {
			await client2.close()
		}
	})
})
