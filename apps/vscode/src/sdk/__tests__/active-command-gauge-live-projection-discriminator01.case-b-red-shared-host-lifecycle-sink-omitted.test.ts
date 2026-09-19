/**
 * ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-DISCRIMINATOR01 — RED (CASE B)
 *
 * Live host lifecycle-sink-omitted RED.
 *
 * Live specimen (frozen at HEAD 84a238464 / installed build
 * `s1onique.clinemm-4.1.16-84a238464`):
 *
 *   REAL/LIVE tool result:
 *     status = "running"
 *     jobId  = "cmd_mu8lx2hm520893hg"
 *
 *   REAL/LIVE task header:
 *     state = Working
 *     ⎇     = ABSENT
 *
 * First-broken-boundary analysis:
 *
 *   P0  CommandJobManager.active map            — OK (DCCT-16/17 prove gauge moves)
 *   P1  CommandJob lifecycle event (emit)      — OK (DCCT-16/17 + ACT emit ordering)
 *   P2  SdkController lifecycle consumer       — **BROKEN** (this RED)
 *   P3  TaskTelemetryTracker.activeCommandJobs — OK (recordActiveCommandJobs is correct)
 *   P4  extension state projection             — OK (taskTelemetry.get() includes the field)
 *   P5  webview receipt/state                  — OK (ExtensionStateContext spreads verbatim)
 *   P6  TaskHeaderTelemetry render             — OK (TaskHeaderTelemetry.gauge.test.tsx G-03)
 *
 * Why P2 is broken:
 *
 *   The 6 SdkController.ts call sites that pass
 *   `onCommandJobLifecycle: this.handleCommandJobLifecycle` are the 5
 *   createTempSessionHost closures (line 1575/1731/1768/3430/3690) and
 *   createRemoteConfigAwareSessionHost (line 2116). All 6 are temp-host
 *   paths used by message-edit rebuilds, checkpoint compare, remote-config
 *   refresh, and followup resume — NOT the live primary session.
 *
 *   The 7th host creation — `SdkSessionLifecycle.getOrCreateSharedHost()`
 *   at `sdk-session-lifecycle.ts:555` (the LIVE primary session host used
 *   by every active task in the production primary-session path) — does
 *   NOT pass `onCommandJobLifecycle` (or `onRuntimeError`). The shared
 *   CommandJobManager therefore has `onCommandJobLifecycle === undefined`,
 *   and `emitCommandJobLifecycle(...)` is a no-op (the sink guard at
 *   `command-job-manager.ts:1238` returns early when the sink is undefined).
 *
 *   Result: every CommandJob lifecycle event from the live primary-session
 *   host silently disappears. The tracker never sees the gauge mutation,
 *   the wire field stays absent (or zero), the webview never renders the
 *   `⎇ N` glyph, and the user-visible "Working" task header shows no
 *   active-command gauge even though `manager.activeCount === 1`.
 *
 * Composition matches the production seam:
 *
 *   SdkSessionLifecycle.startNewSession(...)
 *     -> getOrCreateSharedHost()
 *       -> VscodeSessionHost.create({...})    ← sharedHostPromise
 *         -> new CommandJobManager({...})      ← onCommandJobLifecycle: undefined
 *           -> manager.start(...)
 *             -> emit command_job_process_started   ← SILENTLY DROPPED (no sink)
 *
 * Pre-repair:
 *   - `SdkSessionLifecycleOptions` does not declare
 *     `onCommandJobLifecycle` or `onRuntimeError`; the 7th callsite at
 *     `sdk-session-lifecycle.ts:555` cannot forward what it does not have.
 *   - RED captures the propagation gap and FAILS.
 *
 * Post-repair:
 *   - `SdkSessionLifecycleOptions` declares both fields; the controller
 *     passes both at the construction site; the shared-host factory
 *     forwards both to `VscodeSessionHost.create`; the manager's
 *     lifecycle sink is wired; the tracker receives the gauge update;
 *     the wire ships `activeCommandJobs: 1`; the webview renders `⎇ 1`.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { createStorageContext } from "@/shared/storage/storage-context"

const mockCreateSessionHost = vi.hoisted(() => vi.fn())
const capturedOptions = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("../vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mockCreateSessionHost,
	},
}))

describe("ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-DISCRIMINATOR01 — RED (CASE B)", () => {
	const sharedDir = mkdtempSync(join(tmpdir(), "clinemm-ag01-red-"))

	beforeAll(async () => {
		HostProvider.initialize(
			() => ({}) as never,
			() => ({}) as never,
			() => ({}) as never,
			{
				workspaceClient: {} as never,
				envClient: {
					getTelemetrySettings: async () => ({ isEnabled: false }),
					subscribeToTelemetrySettings: () => ({ unsubscribe: () => {} }),
					getEnvironmentDetails: async () => ({}),
					getHostVersion: async () => ({
						version: "test-host-version",
						clineVersion: "test-cline-version",
						platform: process.platform,
						clineType: "cline",
					}),
				} as never,
				windowClient: {} as never,
				diffClient: {} as never,
			} as never,
			() => {},
			async () => "",
			async () => "",
			"/tmp/mock-extension",
			"/tmp/mock-global-storage",
		)

		const ctx = createStorageContext({ clineDir: sharedDir, workspacePath: sharedDir })
		await StateManager.initialize(ctx)
	})

	afterAll(async () => {
		rmSync(sharedDir, { recursive: true, force: true })
	})

	beforeEach(() => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		mockCreateSessionHost.mockReset()
		capturedOptions.current = null
		mockCreateSessionHost.mockImplementation(async (opts: Record<string, unknown>) => {
			capturedOptions.current = opts
			return {
				inner: {},
				commandJobManager: {},
				start: async () => ({ sessionId: "ag01-red-shared-session" }),
				stop: async () => {},
				dispose: async () => {},
				subscribe: () => () => {},
				readMessages: async () => [],
				updateSessionModel: () => {},
				runtimeAddress: "ag01-red-runtime",
			} as never
		})
	})

	it("RED-B: shared host factory forwards onCommandJobLifecycle to VscodeSessionHost.create", async () => {
		const { SdkSessionLifecycle } = await import("../sdk-session-lifecycle")

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: { getServers: () => [] } as never,
			requestToolApproval: (async () => ({ approved: true })) as never,
			askQuestion: (async () => "") as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
			// The two sink fields the production SdkController passes today
			// to the 6 temp-host creation sites at SdkController.ts:1575,
			// 1731, 1768, 2116, 3430, 3690. After this RED is GREEN, the
			// same two fields MUST also flow into SdkSessionLifecycleOptions
			// and the SdkSessionLifecycle.getOrCreateSharedHost() factory
			// at sdk-session-lifecycle.ts:555 must forward them to
			// VscodeSessionHost.create.
			onCommandJobLifecycle: (event) => {
				// Sink-side identity probe: the field is wired iff the
				// shared host's manager calls this on real events.
				expect(event).toBeDefined()
			},
			onRuntimeError: (incident) => {
				expect(incident).toBeDefined()
			},
		})

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for the lifecycle seam
		await lifecycle.startNewSession({} as any)

		expect(capturedOptions.current, "VscodeSessionHost.create must have been called").not.toBeNull()

		const forwardedLifecycle = capturedOptions.current?.onCommandJobLifecycle
		const forwardedRuntimeError = capturedOptions.current?.onRuntimeError

		expect(typeof forwardedLifecycle, "shared host factory MUST forward onCommandJobLifecycle").toBe("function")
		expect(typeof forwardedRuntimeError, "shared host factory MUST forward onRuntimeError").toBe("function")
	})

	it("RED-B-EVENT-FLOW: shared host manager's lifecycle event reaches the controller sink with activeCommandJobs=1", async () => {
		const { SdkSessionLifecycle } = await import("../sdk-session-lifecycle")
		const { CommandJobManager } = await import("../command-job-manager")

		const receivedEvents: Array<Record<string, unknown>> = []
		const receivedIncidents: unknown[] = []

		// Simulate the SdkController-side wiring: handleCommandJobLifecycle
		// forwards event.activeCommandJobs to the tracker.
		const controllerHandleCommandJobLifecycle = (event: Record<string, unknown>): void => {
			receivedEvents.push(event)
		}
		const controllerHandleTaskRuntimeError = (incident: unknown): void => {
			receivedIncidents.push(incident)
		}

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: { getServers: () => [] } as never,
			requestToolApproval: (async () => ({ approved: true })) as never,
			askQuestion: (async () => "") as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
			onCommandJobLifecycle: controllerHandleCommandJobLifecycle,
			onRuntimeError: controllerHandleTaskRuntimeError,
		})

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for the lifecycle seam
		await lifecycle.startNewSession({} as any)

		expect(capturedOptions.current, "VscodeSessionHost.create must have been called").not.toBeNull()
		const forwardedLifecycle = capturedOptions.current?.onCommandJobLifecycle
		expect(typeof forwardedLifecycle).toBe("function")

		// Drive the SHARED host's CommandJobManager — the production
		// composition after this RED is GREEN.
		const manager = new CommandJobManager({
			onCommandJobLifecycle: forwardedLifecycle as never,
		})

		// Pre-populate the active map so the lifecycle emitter's
		// `active.size` enrichment sees gauge=1. (The production code
		// path at command-job-manager.ts:1792 does this via
		// `this.active.set(id, job)` before emitting; we mirror that
		// here with a typed Map entry. The private Map type is
		// captured via the test seam so we don't need to call the
		// production start() path with a real spawn factory.)
		const fakeJob = { id: "cmd_ag01_red", state: "running", pgid: 99999 } as never
		// biome-ignore lint/suspicious/noExplicitAny: test seam (private field)
		;(manager as any).active.set("cmd_ag01_red", fakeJob)

		// Simulate the start() path's emit-after-set ordering by emitting
		// the exact event the production code emits at
		// command-job-manager.ts:1807 (process_started). The manager's
		// emitter enriches every event with `activeCommandJobs: this.active.size`.
		const fakeStartedEvent = {
			event: "command_job_process_started",
			jobId: "cmd_ag01_red",
			pgid: 99999,
			detached: true,
			jobState: "running",
			tsMs: Date.now(),
		}
		// biome-ignore lint/suspicious/noExplicitAny: test seam
		;(manager as any).emitCommandJobLifecycle(fakeStartedEvent)

		expect(receivedEvents.length, "controller sink must receive the gauge update").toBe(1)
		expect(receivedEvents[0]?.event).toBe("command_job_process_started")
		expect(receivedEvents[0]?.activeCommandJobs, "gauge carries the post-delta value (1)").toBe(1)
		expect(receivedEvents[0]?.jobId).toBe("cmd_ag01_red")
	})

	it("RED-B-CARDINALITY: shared host factory forwards both sinks by reference (NOT re-wrapped)", async () => {
		const { SdkSessionLifecycle } = await import("../sdk-session-lifecycle")

		const lifecycleSink = vi.fn()
		const runtimeErrorSink = vi.fn()

		const lifecycle = new SdkSessionLifecycle({
			mcpHub: { getServers: () => [] } as never,
			requestToolApproval: (async () => ({ approved: true })) as never,
			askQuestion: (async () => "") as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
			onCommandJobLifecycle: lifecycleSink,
			onRuntimeError: runtimeErrorSink,
		})

		// biome-ignore lint/suspicious/noExplicitAny: focused fake for the lifecycle seam
		await lifecycle.startNewSession({} as any)

		const forwardedLifecycle = capturedOptions.current?.onCommandJobLifecycle
		const forwardedRuntimeError = capturedOptions.current?.onRuntimeError

		expect(forwardedLifecycle).toBe(lifecycleSink)
		expect(forwardedRuntimeError).toBe(runtimeErrorSink)
	})
})
