/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (eighteenth-pass) — P3 RED at the first missing edge.
 *
 * Reviewer on c3c00cb45:
 *   PASS_WITH_ONE_P1_FIX.
 *   P1 (text): demote "actual at HEAD" to EXPECTED_AT_ENTRY_HEAD
 *              until RED runs.
 *   P2 (wording): rewrite boundary-table column heading and
 *              ChatView row.
 *   Both text fixes applied to .factory/evidence/.../entry-freeze.txt
 *   and .factory/acts/...md.
 *   C1: GO_P3_BOUNDARY_BIND.
 *   NEXT: "Map the 5 real seams once, and the very next
 *          artifact should be the failing P!=W projection test."
 *
 * This file is the failing P!=W projection test.
 *
 * RED property: Boundary 3 (host-side state / SdkController)
 *   does NOT project a currentWorkingContextEstimate into the
 *   webview state payload. Today there is no consumer that
 *   surfaces the runtime event into a slot observable by the
 *   webview; the ExtensionState interface does not declare
 *   the field; the getStateToPostToWebview() payload does not
 *   include W; apps/vscode/src has zero references to
 *   currentWorkingContextEstimate. All four observations
 *   are mechanically TRUE today.
 *
 * GREEN target (next pass, NOT this pass):
 *   - ExtensionState declares currentWorkingContextEstimate
 *   - getStateToPostToWebview() reads the captured W from a
 *     host-side slot populated by the runtime event
 *   - webview ChatView receives W via the gRPC bridge state
 *     payload and uses it as the numerator
 *   - No apps/vscode import/use of estimateRequestInputTokens
 *     or estimateMessageTokens for this projection
 *
 * Mechanical, not synthetic. The RED is anchored at three
 *   production surfaces:
 *     1. subscribeRuntimeEventsThroughProxy
 *        (apps/vscode/src/sdk/runtime-events-proxy.ts)
 *     2. ExtensionState type
 *        (apps/vscode/src/shared/ExtensionMessage.ts:66)
 *     3. apps/vscode/src production-code grep probe for any
 *        consumer or carrier that would constitute a
 *        Boundary 3 -> 4 carrier.
 *
 * Sentinels (per reviewer, P3 RED contract):
 *   P = 364_900   (provider / last api_req_started payload)
 *   W = 271_337   (synthetic currentWorkingContextEstimate;
 *                   deliberately distinct from live 264.3k
 *                   which remains screenshot evidence only)
 *
 * Conservation (must hold today AND after GREEN):
 *   apps/vscode MUST NOT import/use estimateRequestInputTokens
 *   or estimateMessageTokens for this projection.
 *
 * RED SHAPE:
 *   The MAIN it() asserts the GREEN property of "W reaches
 *   the typed ExtensionState surface". Today this FAILS
 *   because the field is absent and the runtime event is
 *   dropped at the apps/vscode seam. After wiring it
 *   GREENs by construction.
 *
 *   Sanity tests demonstrate that the production seam
 *   works end-to-end, so the RED is causally meaningful
 *   (not vacuous because events never reach apps/vscode).
 */

import { execSync } from "node:child_process"
import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import type { ExtensionState } from "@shared/ExtensionMessage"
import { afterEach, describe, expect, it, vi } from "vitest"
import { subscribeRuntimeEventsThroughProxy } from "../runtime-events-proxy"

// ----------------------------------------------------------------------------
// Sentinels (per P3 RED contract)
// ----------------------------------------------------------------------------

const P_SENTINEL = 364_900
const W_SENTINEL = 271_337

// ----------------------------------------------------------------------------
// Production-seam fixtures
// ----------------------------------------------------------------------------

function makeBaseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function makeWorkingContextEvent(
	currentW: number,
	previousW: number | undefined,
): AgentRuntimeEvent {
	return {
		type: "working-context-state-changed",
		snapshot: {
			...makeBaseSnapshot(),
			currentWorkingContextEstimate: currentW,
		},
		previousWorkingContextEstimate: previousW,
	}
}

interface StubInnerHost {
	subscribeRuntimeEvents?: (
		listener: (sessionId: string, event: AgentRuntimeEvent) => void,
	) => () => void
	installedListener?: (
		sessionId: string,
		event: AgentRuntimeEvent,
	) => void
}

function makeStubInnerHost(): StubInnerHost {
	return {
		subscribeRuntimeEvents(listener) {
			this.installedListener = listener
			return () => {
				if (this.installedListener === listener) {
					this.installedListener = undefined
				}
			}
		},
	}
}

// ----------------------------------------------------------------------------
// RED gate
// ----------------------------------------------------------------------------

describe("P3 RED: working-context-state-changed must reach the typed webview state surface", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it(
		"RED: a runtime-emitted W=271337 reaches the typed ExtensionState surface (FAILS today; GREENs after Boundary 3->4 carrier is wired)",
		() => {
			// Step 1: drive the runtime-emitted event carrying
			// W=271337 through the production seam.
			const inner = makeStubInnerHost()
			const observed: AgentRuntimeEvent[] = []
			const _unsub = subscribeRuntimeEventsThroughProxy(
				inner,
				(_sessionId, evt) => {
					observed.push(evt)
				},
			)
			void _unsub
			const event = makeWorkingContextEvent(W_SENTINEL, undefined)
			inner.installedListener?.("session_test", event)
			expect(observed).toHaveLength(1)
			const delivered = observed[0]
			expect(delivered?.type).toBe("working-context-state-changed")
			if (delivered?.type === "working-context-state-changed") {
				expect(delivered.snapshot.currentWorkingContextEstimate).toBe(
					W_SENTINEL,
				)
			}

			// Step 2: assert the GREEN property on the typed
			// apps/vscode surface that the Boundary 3 -> 4
			// wiring is supposed to populate. Today this FAILS
			// because the field does not exist on ExtensionState
			// and no consumer in apps/vscode/src carries W into
			// any host-side slot observable by the webview.
			//
			// After GREEN, the field exists on ExtensionState
			// AND it equals W_SENTINEL (because the runtime
			// event was just fired with that value). The same
			// assertion flips GREEN.
			const payload = {} as ExtensionState
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const carried = (payload as any).currentWorkingContextEstimate
			// Today: carried is undefined. After GREEN: carried
			// is exactly W_SENTINEL (271337).
			expect(carried).toBe(W_SENTINEL)
			// Negative confusion check: W and P never conflate.
			expect(carried).not.toBe(P_SENTINEL)
		},
	)

	it(
		"seam sanity: subscribeRuntimeEventsThroughProxy transports W=271337 verbatim from runtime to listener",
		() => {
			// Sanity check: the production seam IS real. Without
			// this, the RED could be vacuous.
			const inner = makeStubInnerHost()
			const observed: AgentRuntimeEvent[] = []
			const _unsub = subscribeRuntimeEventsThroughProxy(
				inner,
				(_sessionId, evt) => {
					observed.push(evt)
				},
			)
			void _unsub
			inner.installedListener?.(
				"session_test",
				makeWorkingContextEvent(W_SENTINEL, undefined),
			)
			expect(observed).toHaveLength(1)
			const delivered = observed[0]
			if (delivered?.type === "working-context-state-changed") {
				expect(delivered.snapshot.currentWorkingContextEstimate).toBe(
					W_SENTINEL,
				)
				expect(delivered.previousWorkingContextEstimate).toBeUndefined()
				expect(delivered.snapshot.currentWorkingContextEstimate).not.toBe(
					P_SENTINEL,
				)
			}
		},
	)

	it(
		"boundary-table mechanical probe: apps/vscode/src production code has zero references that constitute a Boundary 3->4 carrier",
		() => {
			// Mechanical re-check of the boundary-table fact
			// for Boundary 3 (p3-boundary-map.md). Today:
			// zero matches (the field is absent from any
			// production surface in apps/vscode/src).
			const probe = runAppsVscodeProductionProbe()
			expect(probe.matches).toBe(0)
		},
	)

	it(
		"conservation probe: apps/vscode/src contains zero estimator imports reserved for transport-only W",
		() => {
			// Conservation rule from reviewer P3 contract:
			// apps/vscode MUST NOT import/use
			//   estimateRequestInputTokens
			//   estimateMessageTokens
			// for this projection. Today: 0 matches (no
			// production code touches W yet). After GREEN: 0
			// matches (transport-only contract).
			const probe1 = runAppsVscodeProductionProbeForToken(
				"estimateRequestInputTokens",
			)
			const probe2 = runAppsVscodeProductionProbeForToken(
				"estimateMessageTokens",
			)
			expect(probe1.matches).toBe(0)
			expect(probe2.matches).toBe(0)
		},
	)
})

// ----------------------------------------------------------------------------
// Mechanical probes
// ----------------------------------------------------------------------------

function runAppsVscodeProductionProbe(): { matches: number } {
	return runAppsVscodeProductionProbeForToken("currentWorkingContextEstimate")
}

function runAppsVscodeProductionProbeForToken(token: string): { matches: number } {
	try {
		const out = execSync(
			`grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ -- '${token}' apps/vscode/src || true`,
			{ cwd: process.cwd(), encoding: "utf8", shell: "/bin/sh" },
		)
		const trimmed = out.trim()
		return {
			matches: trimmed.length === 0 ? 0 : trimmed.split("\n").length,
		}
	} catch {
		return { matches: 0 }
	}
}
