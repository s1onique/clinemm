/**
 * ACT-CLINEMM-FINALIZATION-RUN-BOOTSTRAP-STALL01 — Test harness helpers.
 *
 * Mirrors the AUTOSTART01 test's `driveSessionStart` plumbing so the
 * FRBS tests can drive the production session-start seam:
 *   VscodeSessionHost.create → prepareStartSessionInput → createVscodeExtraTools
 *   → createMcpTools → provider.listTools → ensureSessionConnection.
 *
 * `mockClineCoreCreate` must be defined in the test file itself
 * (vitest's `vi.hoisted()` cannot be exported across modules).
 * Pass it in via the `setMock` hook below.
 */

import type { ClineCoreStartInput } from "@cline/core"
import type { McpHub } from "../McpHub"

export type MockClineCoreCreate = {
	latestPrepare: () =>
		| undefined
		| (() => Promise<{
				applyToStartSessionInput: (i: ClineCoreStartInput) => Promise<ClineCoreStartInput>
		  }>)
	reset: () => void
}

export async function configureHubWith(
	hub: McpHub,
	fixturePath: string,
	stallKind: "none" | "listResources" | "listResourceTemplates" | "listPrompts" | "listTools",
	timeoutSeconds = 1,
): Promise<void> {
	await hub.updateServerConnections({
		"frbs-stallable": {
			type: "stdio" as const,
			command: "node",
			args: [fixturePath],
			// The per-request bound. The repair routes the optional
			// post-connect probes through the same per-server timeout
			// value. 1 second is small enough that the test's 8-second
			// race timeout comfortably catches the bounded behaviour
			// after the repair.
			timeout: timeoutSeconds,
			env: {
				MYC_SESSION_ID: { fromSession: "sessionId" } as unknown as Record<string, never>,
				FRBS_STALL_KIND: stallKind as unknown as Record<string, never>,
			},
		},
	})
}

export type BootstrapResult = {
	pid: number
	session: string | null
}

export async function driveSessionStart(mock: MockClineCoreCreate, hub: McpHub, sessionId: string): Promise<BootstrapResult> {
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	await (await import("@/sdk/vscode-session-host")).VscodeSessionHost.create({
		mcpHub: hub,
		// biome-ignore lint/suspicious/noExplicitAny: focused test seam
		telemetry: {} as any,
	})
	const prepare = mock.latestPrepare()
	if (!prepare) {
		throw new Error("[frbs-harness] prepare hook not registered")
	}
	const bootstrap = await prepare()
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const prepared = await (bootstrap as any).applyToStartSessionInput({
		source: undefined,
		config: {
			sessionId,
			cwd: "/workspace",
			extraTools: [],
		} as unknown as ClineCoreStartInput["config"],
	})
	const mcpTool = (prepared.config.extraTools as Array<{ name?: string }>).find((t) => t?.name?.includes?.("frbs-stallable"))
	if (!mcpTool) {
		throw new Error(`[frbs-harness] frbs-stallable MCP tool not found in extraTools for sessionId=${sessionId}`)
	}
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const result = await (mcpTool as any).execute({}, { agentId: "test-agent", iteration: 0 })
	// biome-ignore lint/suspicious/noExplicitAny: focused test seam
	const text = ((result as any)?.content as Array<{ type: string; text?: string }>)?.find(
		(c: { type: string }) => c.type === "text",
	)?.text
	if (typeof text !== "string") {
		throw new Error("[frbs-harness] no text content in tool result")
	}
	return JSON.parse(text) as BootstrapResult
}

/**
 * Race `driveSessionStart` against a short timeout. If the bootstrap
 * hangs (RED), the timeout wins and we surface the hang as a thrown
 * error. If the bootstrap completes in time (GREEN), we return its
 * result normally.
 *
 * 8 seconds is generous enough that even a slow fixture (1s connect +
 * 5s probe aggregate) is comfortably below the bound, while still
 * short enough that a hanging bootstrap fails the test in a
 * reasonable amount of time.
 */
export async function driveSessionStartWithTimeout(
	mock: MockClineCoreCreate,
	hub: McpHub,
	sessionId: string,
	timeoutMs = 8000,
): Promise<BootstrapResult> {
	return await Promise.race([
		driveSessionStart(mock, hub, sessionId),
		new Promise<never>((_, reject) =>
			setTimeout(
				() =>
					reject(
						new Error(
							`[frbs-red] driveSessionStart(${sessionId}) did not complete within ${timeoutMs}ms — bootstrap is hanging`,
						),
					),
				timeoutMs,
			),
		),
	])
}
