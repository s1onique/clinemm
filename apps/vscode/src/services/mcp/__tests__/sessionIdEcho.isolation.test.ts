/**
 * ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 4 A/B isolation rows.
 *
 * Each test row drives the real `__fixtures__/session-id-echo/whoami.mjs`
 * child through the public seams (StdioClientTransport + Client + the
 * resolveMcpServerEnv projection) with two concurrent sessions, asserting
 * the per-session-child invariants A2A-08..14 rely on.
 */

import { afterEach, describe, it } from "bun:test"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import "should"
import { resolveMcpServerEnv } from "../envResolver"

const FIXTURE = resolve(__dirname, "../__fixtures__/session-id-echo/whoami.mjs")

function buildChild(env: Record<string, string>): { transport: StdioClientTransport; client: Client } {
	const transport = new StdioClientTransport({
		command: "node",
		args: [FIXTURE],
		env: { ...process.env, ...env } as Record<string, string>,
	})
	const client = new Client({ name: "a2a-stage4", version: "0.0.0" }, { capabilities: {} })
	return { transport, client }
}

async function whoami(client: Client): Promise<{ pid: number; session: string | null; session_keys: string[] }> {
	const res = await client.callTool({ name: "whoami", arguments: {} })
	const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text
	return JSON.parse(text!)
}

describe("Stage 4 — A/B isolation rows (each row isolated, drives real fixture)", () => {
	const openClients: Client[] = []

	afterEach(async () => {
		await Promise.all(
			openClients.splice(0).map(async (c) => {
				try {
					await c.close()
				} catch (_e) {
					/* ignore */
				}
			}),
		)
	})

	function track<T extends { client: Client }>(p: T): T {
		openClients.push(p.client)
		return p
	}

	it("A2A-08: two concurrent sessions have distinct PIDs and distinct echoed sessions", async () => {
		const a = track(buildChild({ MYC_SESSION_ID: "session-A" }))
		const b = track(buildChild({ MYC_SESSION_ID: "session-B" }))
		await a.client.connect(a.transport)
		await b.client.connect(b.transport)

		const ra = await whoami(a.client)
		const rb = await whoami(b.client)

		ra.pid.should.not.equal(rb.pid)
		ra.pid.should.not.equal(process.pid)
		rb.pid.should.not.equal(process.pid)
		ra.session.should.equal("session-A")
		rb.session.should.equal("session-B")
	})

	it("A2A-09: reconnect A under same id => new PID, identity preserved, B untouched", async () => {
		const a1 = track(buildChild({ MYC_SESSION_ID: "session-A" }))
		const b = track(buildChild({ MYC_SESSION_ID: "session-B" }))
		await a1.client.connect(a1.transport)
		await b.client.connect(b.transport)

		const ra1 = await whoami(a1.client)
		const rb = await whoami(b.client)

		await a1.client.close()
		openClients.splice(openClients.indexOf(a1.client), 1)

		const a2 = track(buildChild({ MYC_SESSION_ID: "session-A" }))
		await a2.client.connect(a2.transport)
		const ra2 = await whoami(a2.client)

		ra2.pid.should.not.equal(ra1.pid)
		ra2.session.should.equal("session-A")
		const rbAfter = await whoami(b.client)
		rbAfter.pid.should.equal(rb.pid)
		rbAfter.session.should.equal("session-B")
	})

	it("A2A-10: two env names both { fromSession:'sessionId' } materialize the SAME identity", () => {
		const env = resolveMcpServerEnv(
			{
				MYC_SESSION_ID: { fromSession: "sessionId" },
				CLINE_SESSION_ID: { fromSession: "sessionId" },
			},
			{},
			{ sessionId: "session-A" },
		)
		env.MYC_SESSION_ID.should.equal("session-A")
		env.CLINE_SESSION_ID.should.equal("session-A")
	})

	it("A2A-12: legacy flat env coexists with session-bound (resolver projects both)", () => {
		const env = resolveMcpServerEnv(
			{
				API_KEY: "abc",
				MYC_SESSION_ID: { fromSession: "sessionId" },
			},
			{},
			{ sessionId: "session-A" },
		)
		env.API_KEY.should.equal("abc")
		env.MYC_SESSION_ID.should.equal("session-A")
	})

	it("A2A-13: lifecycle isolation — disconnecting one session's client does not kill the other's child", async () => {
		const a = track(buildChild({ MYC_SESSION_ID: "session-A" }))
		const b = track(buildChild({ MYC_SESSION_ID: "session-B" }))
		await a.client.connect(a.transport)
		await b.client.connect(b.transport)

		const ra0 = await whoami(a.client)
		const rb0 = await whoami(b.client)

		await a.client.close()
		openClients.splice(openClients.indexOf(a.client), 1)

		const rb1 = await whoami(b.client)
		rb1.pid.should.equal(rb0.pid)
		rb1.session.should.equal("session-B")
		ra0.pid.should.not.equal(rb1.pid)
	})

	it("A2A-14: startup defer — settings load with fromSession and no active session => resolver yields empty (no spawn yet)", () => {
		const env = resolveMcpServerEnv(
			{
				LEGACY: "still-here",
				MYC_SESSION_ID: { fromSession: "sessionId" },
			},
			{},
			undefined,
		)
		env.LEGACY.should.equal("still-here")
		;(env.MYC_SESSION_ID === undefined).should.be.true()
	})
})
