/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The MCP-side proof: the local stdio MCP proxy (what Codex launches)
 * correctly exposes the two READ-ONLY operations and correctly
 * relays them to the extension host's AF_UNIX listener.
 *
 * The proxy is driven through the REAL MCP SDK `Client` over an
 * in-memory transport pair, so the whole MCP surface — tool listing,
 * tool calling, result shape — is exercised.
 */

import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, describe, expect, it } from "vitest"

import type { ControlSeamAuthority } from "./control-seam-authority"
import { createControlSeamProxyServer } from "./control-seam-proxy"
import { ControlSeamServer } from "./control-seam-server"

const openServers: ControlSeamServer[] = []

afterEach(async () => {
	while (openServers.length > 0) {
		await openServers.pop()?.dispose()
	}
})

function makeAuthority(sessionId: string | undefined): ControlSeamAuthority {
	return {
		readActiveSessionId: () => sessionId,
		readActiveTaskId: () => (sessionId ? `task-${sessionId}` : undefined),
		readIsRunning: () => true,
		readQueuedPromptCount: () => 0,
		readRuntimeSnapshot: () => (sessionId ? { status: "running", runId: `run-${sessionId}` } : undefined),
		// ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: this fixture has no
		// published TaskHeader record, so `taskState` is omitted.
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => 0,
	}
}

/** Start a REAL extension-host listener on a short private path. */
async function startHost(sessionId: string | undefined) {
	const dir = mkdtempSync(join("/tmp", "csproxy-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const server = new ControlSeamServer({
		authority: makeAuthority(sessionId),
		extensionVersion: "0.0.0-proxy-test",
		platform: "darwin",
		socketPath,
		tokenPath,
		dirPath: dir,
		forceEnabled: true,
	})
	openServers.push(server)
	const handle = await server.start()
	return { socketPath, tokenPath, handle }
}

describe("ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01 — MCP proxy", () => {
	it("PX01: the proxy exposes EXACTLY the two read-only tools", async () => {
		const { socketPath, tokenPath } = await startHost("session-proxy")
		const server = createControlSeamProxyServer({ socketPath, tokenPath })
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		const client = new Client({ name: "test-client", version: "1" }, { capabilities: {} })
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

		const tools = await client.listTools()
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["clinemm_capabilities", "clinemm_get_run"])
		// No mutating tool is exposed.
		for (const forbidden of ["start_act", "send_feedback", "cancel_run", "run_commands", "editor", "read_file"]) {
			expect(tools.tools.map((tool) => tool.name)).not.toContain(forbidden)
		}
		await client.close()
		await server.close()
	})

	it("PX02: the proxy relays clinemm_get_run to the extension host", async () => {
		const { socketPath, tokenPath } = await startHost("session-proxy")
		const server = createControlSeamProxyServer({ socketPath, tokenPath })
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		const client = new Client({ name: "test-client", version: "1" }, { capabilities: {} })
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

		const result = await client.callTool({ name: "clinemm_get_run", arguments: {} })
		const text = (result.content as { type: "text"; text: string }[])[0]?.text ?? ""
		const payload = JSON.parse(text) as Record<string, unknown>
		expect(payload.sessionId).toBe("session-proxy")
		expect(payload.running).toBe(true)
		expect(payload.runtimeStatus).toBe("running")
		await client.close()
		await server.close()
	})

	it("PX03: the proxy relays clinemm_capabilities", async () => {
		const { socketPath, tokenPath } = await startHost("session-proxy")
		const server = createControlSeamProxyServer({ socketPath, tokenPath })
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		const client = new Client({ name: "test-client", version: "1" }, { capabilities: {} })
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

		const result = await client.callTool({ name: "clinemm_capabilities", arguments: {} })
		const text = (result.content as { type: "text"; text: string }[])[0]?.text ?? ""
		const payload = JSON.parse(text) as { readOnly: boolean; operations: { id: string }[] }
		expect(payload.readOnly).toBe(true)
		expect(payload.operations.map((operation) => operation.id)).toEqual(["clinemm_capabilities", "clinemm_get_run"])
		await client.close()
		await server.close()
	})

	it("PX04: with NO installed instance the proxy FAILS CLOSED", async () => {
		// A socket path that does not exist -> no instance.
		const dir = mkdtempSync(join("/tmp", "csproxy-empty-"))
		const server = createControlSeamProxyServer({
			socketPath: join(dir, "absent.sock"),
			tokenPath: join(dir, "absent-token"),
		})
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		const client = new Client({ name: "test-client", version: "1" }, { capabilities: {} })
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

		const result = await client.callTool({ name: "clinemm_get_run", arguments: {} })
		expect(result.isError).toBe(true)
		const text = (result.content as { type: "text"; text: string }[])[0]?.text ?? ""
		// The failure is non-informative: it discloses no session data.
		expect(text).toBe("control_seam_no_instance")
		await client.close()
		await server.close()
	})

	it("PX05: a WRONG token is refused by the extension host", async () => {
		const { socketPath, tokenPath } = await startHost("session-proxy")
		// Overwrite the token file with a wrong value.
		const { writeFileSync } = await import("node:fs")
		writeFileSync(tokenPath, "not-the-real-token\n")
		const server = createControlSeamProxyServer({ socketPath, tokenPath })
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		const client = new Client({ name: "test-client", version: "1" }, { capabilities: {} })
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

		const result = await client.callTool({ name: "clinemm_get_run", arguments: {} })
		expect(result.isError).toBe(true)
		const text = (result.content as { type: "text"; text: string }[])[0]?.text ?? ""
		expect(text).toBe("control_seam_unauthorized")
		expect(text).not.toContain("session-proxy")
		await client.close()
		await server.close()
	})
})
