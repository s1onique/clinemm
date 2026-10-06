/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 CORRECTION02 — end-to-end
 * cardinality proof.
 *
 * The reviewer explicitly required:
 *   "automatic real myc_prime call → callsTotal = 1, not 2"
 *
 * Before CORRECTION02, the wire read `myc 2/2` for one real
 * automatic prime because BOTH the McpHub completion observer AND
 * `observeMycPrimeResult` incremented `callsTotal`. CORRECTION02
 * strips the prime helper to status-only updates — McpHub is the
 * sole cardinality owner.
 *
 * This test reproduces the SdkController production wiring at the
 * level of "the tracker observer is installed + a real prime fires"
 * without bringing up a full stdio MCP child. It uses an in-memory
 * `McpHub` test fixture and drives `runMycPrimeOnSessionStart`
 * directly. The tracker is a real `TaskTelemetryTracker` wired
 * through `observeMcpToolCompletion` (production completion-side
 * helper) and `observeMycPrimeResult` (production prime-side
 * helper), exactly as the SdkController constructor wires them.
 */
import { describe, expect, it } from "vitest"
import { runMycPrimeOnSessionStart } from "../myc-prime-automation"
import { observeMcpToolCompletion, observeMycPrimeResult } from "../myc-task-observation"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

describe("ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 CORRECTION02 / one real prime => exactly one recordMycToolCall", () => {
	it("THMYC-CRONE-01: real prime (ok + non-empty text) => callsTotal=1, callsSuccessful=1, retrieval 1/1, callsFailed=0 (NOT 2)", async () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.setMycConfigured(true)

		const observer = (event: {
			serverName: string
			toolName: string
			outcome: "success" | "empty" | "error"
			hasNonEmptyContent: boolean
		}) => {
			observeMcpToolCompletion(tracker, {
				toolName: event.toolName,
				outcome: event.outcome,
				hasNonEmptyContent: event.hasNonEmptyContent,
			})
		}

		const fakeMcpHub = {
			getServers: () => [{ name: "myc", status: "connected" }],
			callTool: async (
				_serverName: string,
				_toolName: string,
				_args: unknown,
				_ulid: string,
				_signal?: AbortSignal,
				_sessionId?: string,
			): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> => {
				// Production sequencing: the observer fires AFTER the
				// result resolves, before the SDK receives it.
				observer({
					serverName: "myc",
					toolName: "myc_prime",
					outcome: "success",
					hasNonEmptyContent: true,
				})
				return {
					content: [{ type: "text", text: "echoed prime payload" }],
					isError: false,
				}
			},
		}

		const result = await runMycPrimeOnSessionStart({
			sessionId: "ses-x",
			cwd: "/tmp",
			mcpHub: fakeMcpHub as any,
		})
		// Production sequencing in SdkController.onMycPrimeRequested:
		// McpHub observer fires DURING the callTool Promise resolve;
		// observeMycPrimeResult fires AFTER the await.
		observeMycPrimeResult(tracker, result)

		const m = tracker.get()?.myc
		expect(m?.callsTotal).toBe(1)
		expect(m?.callsSuccessful).toBe(1)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(1)
		expect(m?.usefulRetrievals).toBe(1)
		expect(m?.automaticPrime.status).toBe("ok")
		expect(m?.automaticPrime.attempted).toBe(true)
		expect(m?.last?.operation).toBe("prime")
		expect(m?.last?.outcome).toBe("success")
	})

	it("THMYC-CRONE-03: TWO real primes (sequential distinct sessions) => callsTotal=2 (NOT 1, NOT 4)", async () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.setMycConfigured(true)

		const observer = (event: {
			serverName: string
			toolName: string
			outcome: "success" | "empty" | "error"
			hasNonEmptyContent: boolean
		}) => {
			observeMcpToolCompletion(tracker, {
				toolName: event.toolName,
				outcome: event.outcome,
				hasNonEmptyContent: event.hasNonEmptyContent,
			})
		}
		let callCount = 0
		const fakeMcpHub = {
			getServers: () => [{ name: "myc", status: "connected" }],
			callTool: async () => {
				callCount++
				observer({ serverName: "myc", toolName: "myc_prime", outcome: "success", hasNonEmptyContent: true })
				return { content: [{ type: "text", text: `prime-${callCount}` }], isError: false }
			},
		}

		const r1 = await runMycPrimeOnSessionStart({ sessionId: "ses-A", cwd: "/tmp", mcpHub: fakeMcpHub as any })
		observeMycPrimeResult(tracker, r1)
		const r2 = await runMycPrimeOnSessionStart({ sessionId: "ses-B", cwd: "/tmp", mcpHub: fakeMcpHub as any })
		observeMycPrimeResult(tracker, r2)

		const m = tracker.get()?.myc
		expect(callCount).toBe(2)
		expect(m?.callsTotal).toBe(2)
		expect(m?.callsSuccessful).toBe(2)
		expect(m?.callsFailed).toBe(0)
		expect(m?.retrievalCalls).toBe(2)
		expect(m?.usefulRetrievals).toBe(2)
		expect(m?.automaticPrime.status).toBe("ok")
	})
})
