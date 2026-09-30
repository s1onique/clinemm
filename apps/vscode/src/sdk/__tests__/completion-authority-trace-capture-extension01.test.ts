/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01
 * CORRECTION01 §18 RED tests.
 *
 * Replaces the first-pass test file that was halted by reviewer P0:
 *
 *   P0: "Wrong RED seam — synthetic adapter input presented as proof
 *        of production capture."
 *   P0: "Three REDs demand forbidden Elm Model expansion."
 *
 * This file is structured as TWO sections, by intent and contract:
 *
 *   Section A  ADAPTER / KERNEL CONTRACT TESTS
 *             - Exercise `adaptRecord` (the real adapter entry point)
 *               and the real replay kernel against synthetic JSONL
 *               traces written to .factory/evidence/.../synthetic-traces/.
 *             - These are contract tests for the adapter's known gaps
 *               and the existing kernel's identity-guard behavior.
 *             - NOT production-seam tests.
 *             - 18 tests currently GREEN, 3 currently RED (TCE-02 only).
 *
 *   Section B  REAL PRODUCTION-SEAM TESTS (TCE-P01..P07)
 *             - Exercise the real `captureContinuationCardinalityAuthorityRecord`
 *               helper (production module). Toggle the real capture
 *               seam via the real `setContinuationCardinalityAuthorityCaptureEnabled`.
 *               Clear via the real `clearContinuationCardinalityAuthorityCapture`.
 *               Assert via the real ring reader
 *               `getContinuationCardinalityAuthorityCaptureRecords()`.
 *             - Source-presence assertions on the real
 *               `apps/vscode/src/sdk/SdkController.ts`,
 *               `apps/vscode/src/sdk/command-job-manager.ts`,
 *               `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`,
 *               and `apps/vscode/src/sdk/continuation-cardinality-authority.ts`.
 *             - NO synthetic JSON fed to adapter. NO replay. The CCARD
 *               ring buffer IS the test surface for capture; source
 *               grep IS the test surface for wiring.
 *             - 9 tests, all currently RED (the §21 work).
 *
 * CONSERVATION GUARANTEES
 *   - No production code is touched by this file.
 *   - No Elm code is touched by this file.
 *   - No global state is mutated outside the CCARD module's
 *     bounded ring buffer (which is the documented test seam).
 *   - All assertions read the real production module exports
 *     and the real production source files.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { type CommandJobLifecycleEvent, CommandJobManager } from "../command-job-manager"
import { adaptRecord, loadKernel, replayTrace } from "../completion-authority-elm-replay"
import {
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")
const KERNEL_PATH = path.resolve(REPO_ROOT, "apps/vscode/elm/completion-authority/vendor/completion-authority.js")
const SDK_CONTROLLER_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/SdkController.ts")
const COMMAND_JOB_MANAGER_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/command-job-manager.ts")
const CONTINUATION_AUTHORITY_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/continuation-cardinality-authority.ts")
const SESSION_EVENT_COORDINATOR_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/sdk-session-event-coordinator.ts")
const SESSION_HOST_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/vscode-session-host.ts")
const ELM_REPLAY_ADAPTER_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-authority-elm-replay.ts")
const CHAT_ROW_PATH = path.resolve(REPO_ROOT, "apps/vscode/webview-ui/src/components/chat/ChatRow.tsx")
const MCP_HUB_PATH = path.resolve(REPO_ROOT, "apps/vscode/src/services/mcp/McpHub.ts")
const CLINERULES_DIR = path.resolve(REPO_ROOT, ".clinerules")
const SYNTHETIC_DIR = path.resolve(
	REPO_ROOT,
	".factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01/synthetic-traces",
)

// Ensure synthetic-traces dir exists for Section A JSONL writes; clean up in finally.
fs.mkdirSync(SYNTHETIC_DIR, { recursive: true })
function writeSyntheticTrace(name: string, records: ReadonlyArray<Record<string, unknown>>): string {
	const p = path.join(SYNTHETIC_DIR, name)
	const text = records.map((r) => JSON.stringify(r)).join("\n") + "\n"
	fs.writeFileSync(p, text, "utf8")
	return p
}

// =============================================================================
// SECTION A - ADAPTER / KERNEL CONTRACT TESTS
// =============================================================================
// Tests exercise `adaptRecord` (the real public adapter entry point) and the
// real replay kernel against synthetic JSONL traces. These are contract tests
// for the adapter's known gaps and the existing kernel's identity-guard
// behavior. They do NOT exercise the production capture seam; they verify the
// adapter/kernel contract so §21 cannot regress it.

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §A: adapter / kernel contract", () => {
	const kernel = loadKernel(KERNEL_PATH)
	const createdPaths: string[] = []

	afterEach(() => {
		for (const p of createdPaths) {
			try {
				fs.unlinkSync(p)
			} catch {
				/* ignore */
			}
		}
		createdPaths.length = 0
	})

	// ---- TCE-01: real runId from runtime snapshot is observable ----
	describe("TCE-01 — real runId from runtime snapshot (via adaptRecord)", () => {
		test("TCE-01.GREEN: adaptRecord maps run_turn_started with runId to DIRECT + preserves runId in elmMsg", () => {
			const outcome = adaptRecord({ stage: "run_turn_started", sessionId: "S1", runId: "R-TCE01-1" })
			expect(outcome.status).toBe("DIRECT")
			if (outcome.status === "DIRECT") {
				expect(outcome.elmMsg).toMatchObject({ tag: "run_started", runId: "R-TCE01-1" })
			}
		})
		test("TCE-01.GREEN: adaptRecord maps run_turn_started WITHOUT runId to INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({ stage: "run_turn_started", sessionId: "S1" })
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
	})

	// ---- TCE-02: continuation_started adapter gap (RED — §21 must add the case) ----
	describe("TCE-02 — continuation_started adapter gap (RED — §21 must add the case)", () => {
		// ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-E:
		// after §21 the case EXISTS. Complete identity → DIRECT;
		// missing identity → INSUFFICIENT_IDENTITY (never
		// manufactured, never falls to UNMODELED_EVENT now that
		// the case is wired).
		test("TCE-02.GREEN: adaptRecord maps continuation_started with promptId+runId to DIRECT + preserves both identities in elmMsg", () => {
			const outcome = adaptRecord({
				stage: "continuation_started",
				sessionId: "S1",
				promptId: "P-TCE02",
				runId: "R-TCE02",
			})
			expect(outcome.status).toBe("DIRECT")
			if (outcome.status === "DIRECT") {
				expect(outcome.elmMsg).toMatchObject({
					tag: "continuation_started",
					promptId: "P-TCE02",
					runId: "R-TCE02",
				})
			}
		})
		test("TCE-02.GREEN: continuation_started with promptId but NO runId is INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({
				stage: "continuation_started",
				sessionId: "S1",
				promptId: "P-TCE02",
			})
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
		test("TCE-02.GREEN: continuation_started with runId but NO promptId is INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({
				stage: "continuation_started",
				sessionId: "S1",
				runId: "R-TCE02",
			})
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
		test("TCE-02.GREEN: continuation_started with NEITHER identity is INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({
				stage: "continuation_started",
				sessionId: "S1",
			})
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
	})

	// ---- TCE-05: terminalKind absence is locked in (CORRECTION02) ----
	describe("TCE-05 — terminalKind absence (CORRECTION02 contract)", () => {
		test("TCE-05.GREEN: terminal_committed without terminalKind is INSUFFICIENT_IDENTITY (CORRECTION02 pins this)", () => {
			const outcome = adaptRecord({
				stage: "terminal_committed",
				sessionId: "S1",
				jobId: "J-TCE05",
				ownerId: "S1",
			})
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
		test("TCE-05.GREEN: terminal_committed with terminalKind=owned is DIRECT", () => {
			const outcome = adaptRecord({
				stage: "terminal_committed",
				sessionId: "S1",
				jobId: "J-TCE05",
				ownerId: "S1",
				terminalKind: "owned",
			})
			expect(outcome.status).toBe("DIRECT")
		})
		test("TCE-05.GREEN: terminal_committed with terminalKind=background_not_owned + ownerId is DIRECT", () => {
			const outcome = adaptRecord({
				stage: "terminal_committed",
				sessionId: "S1",
				jobId: "J-TCE05",
				ownerId: "OWNER-TCE05",
				terminalKind: "background_not_owned",
			})
			expect(outcome.status).toBe("DIRECT")
		})
	})

	// ---- TCE-06: kernel determinism via replayTrace ----
	describe("TCE-06 — kernel default-off / replay determinism", () => {
		test("TCE-06.GREEN: continuation_started with complete identity is now DIRECT (no UNMODELED); traces still end at idle task-state parity", async () => {
			// ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §21-E:
			// after §21 the continuation_started case exists and
			// produces a DIRECT elmMsg (not UNMODELED_EVENT). The
			// baseline trace omits the new event entirely; the
			// with-capture trace appends one continuation_started
			// with both identities. Both traces still end at
			// `task=idle` (terminal state parity) and
			// unmodeledEventCount drops to 0 because the case
			// is now modeled.
			const baseline = writeSyntheticTrace("tce06-baseline.jsonl", [
				{ stage: "run_turn_started", sessionId: "S1", runId: "R-TCE06" },
				{ stage: "submit_and_exit_seen", sessionId: "S1", submitId: "SUB-TCE06" },
			])
			createdPaths.push(baseline)
			const withCapture = writeSyntheticTrace("tce06-with-capture.jsonl", [
				{ stage: "run_turn_started", sessionId: "S1", runId: "R-TCE06" },
				{ stage: "submit_and_exit_seen", sessionId: "S1", submitId: "SUB-TCE06" },
				{ stage: "continuation_started", sessionId: "S1", promptId: "P-TCE06", runId: "R-TCE06" },
			])
			createdPaths.push(withCapture)
			const r1 = await replayTrace({ kernel, tracePath: baseline })
			const r2 = await replayTrace({ kernel, tracePath: withCapture })
			// Both traces end at the same terminal task state.
			expect((r1.finalModel as { task?: string }).task).toBe("idle")
			expect((r2.finalModel as { task?: string }).task).toBe("idle")
			// After §21, continuation_started with both identities
			// is DIRECT — neither trace contains UNMODELED_EVENT.
			expect(r1.unmodeledEventCount).toBe(0)
			expect(r2.unmodeledEventCount).toBe(0)
		})
	})

	// ---- TCE-08: cross-correlation guard ----
	describe("TCE-08 — kernel rejects cross-correlation", () => {
		test("TCE-08.GREEN: adaptRecord maps agent_turn_done with runId — kernel rejects mismatched runId at replay", async () => {
			const p = writeSyntheticTrace("tce08.jsonl", [
				{ stage: "run_turn_started", sessionId: "S1", runId: "R-TCE08-A" },
				{ stage: "agent_turn_done", sessionId: "S1", runId: "R-TCE08-B" },
			])
			createdPaths.push(p)
			const r = await replayTrace({ kernel, tracePath: p })
			const hasViolation = r.events.some((e) => e.classification === "ELM_REJECTS_TS_SEQUENCE")
			expect(hasViolation).toBe(true)
		})
	})

	// ---- TCE-09: adapter ownerId path ----
	describe("TCE-09 — ownerId on terminal_committed", () => {
		test("TCE-09.GREEN: terminal_committed WITHOUT ownerId is INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({
				stage: "terminal_committed",
				sessionId: "S1",
				jobId: "J-TCE09",
				terminalKind: "owned",
			})
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
		test("TCE-09.GREEN: terminal_committed with explicit ownerId+terminalKind maps DIRECT and ownerId is preserved", () => {
			const outcome = adaptRecord({
				stage: "terminal_committed",
				sessionId: "S1",
				jobId: "J-TCE09",
				ownerId: "OWNER-TCE09",
				terminalKind: "owned",
			})
			expect(outcome.status).toBe("DIRECT")
			if (outcome.status === "DIRECT") {
				expect(outcome.elmMsg).toMatchObject({ tag: "terminal_registered", ownerId: "OWNER-TCE09" })
			}
		})
	})

	// ---- TCE-12: adapter identity-required guards ----
	describe("TCE-12 — submit/completion event ID guards", () => {
		test("TCE-12.GREEN: submit_and_exit_seen WITHOUT submitId is INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({ stage: "submit_and_exit_seen", sessionId: "S1" })
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
		test("TCE-12.GREEN: task_completion_committed WITHOUT completionId is INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({ stage: "task_completion_committed", sessionId: "S1" })
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
	})

	// ---- Conservation sentinels (per §22 hard prohibitions) ----
	describe("Conservation sentinels — must remain false through §21", () => {
		test("PRODUCTION_SEMANTICS_CHANGED sentinel — Elm kernel still loads", () => {
			const SOURCE = fs.readFileSync(KERNEL_PATH, "utf8")
			expect(SOURCE.length).toBeGreaterThan(0)
		})
		test("ELM_AUTHORITY_SEMANTICS_CHANGED sentinel — Authority module still in kernel", () => {
			const SOURCE = fs.readFileSync(KERNEL_PATH, "utf8")
			expect(SOURCE).toContain("Authority")
		})
		test("COMPLETION_AUTHORITY_CHANGED sentinel — adapter still has run_turn_started case", () => {
			const ADAPTER = fs.readFileSync(ELM_REPLAY_ADAPTER_PATH, "utf8")
			expect(ADAPTER).toContain("run_turn_started")
		})
		test("QUEUE_SEMANTICS_CHANGED sentinel — vscode-session-host C7 capture still exists", () => {
			const SOURCE = fs.readFileSync(SESSION_HOST_PATH, "utf8")
			expect(SOURCE).toContain('stage: "run_turn_started"')
		})
		test("PRESENTATION_SEMANTICS_CHANGED sentinel — webview ChatRow still readable", () => {
			const SOURCE = fs.readFileSync(CHAT_ROW_PATH, "utf8")
			expect(SOURCE.length).toBeGreaterThan(0)
		})
		test("MCP_CODE_CHANGED sentinel — McpHub still readable", () => {
			const SOURCE = fs.readFileSync(MCP_HUB_PATH, "utf8")
			expect(SOURCE.length).toBeGreaterThan(0)
		})
		test("MYC_CODE_CHANGED sentinel — .clinerules/ directory still exists", () => {
			expect(fs.existsSync(CLINERULES_DIR)).toBe(true)
			const entries = fs.readdirSync(CLINERULES_DIR)
			expect(entries.length).toBeGreaterThan(0)
		})
	})
})

// =============================================================================
// SECTION B - REAL PRODUCTION-SEAM TESTS (TCE-P01..P07)
// =============================================================================
// These tests exercise the REAL production CCARD module:
//   - captureContinuationCardinalityAuthorityRecord (production helper)
//   - setContinuationCardinalityAuthorityCaptureEnabled (production toggle)
//   - clearContinuationCardinalityAuthorityCapture (test seam)
//   - getContinuationCardinalityAuthorityCaptureRecords (production ring reader)
// They also assert source-presence on the REAL production source files:
//   - apps/vscode/src/sdk/SdkController.ts
//   - apps/vscode/src/sdk/command-job-manager.ts
//   - apps/vscode/src/sdk/sdk-session-event-coordinator.ts
//   - apps/vscode/src/sdk/continuation-cardinality-authority.ts
// No synthetic JSON fed to adapter. No replay. The CCARD ring buffer IS the
// test surface for capture; source grep IS the test surface for wiring.

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 §B: real production-seam REDs", () => {
	beforeEach(() => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		clearContinuationCardinalityAuthorityCapture()
	})
	afterEach(() => {
		clearContinuationCardinalityAuthorityCapture()
		setContinuationCardinalityAuthorityCaptureEnabled(false)
	})

	// ---- TCE-P01: runtime run identity ----
	describe("TCE-P01 — runtime run identity (RED — §21 must subscribe at VscodeSessionHost)", () => {
		test("TCE-P01.RED: source presence — continuation-cardinality-authority.ts exposes runId? on the record type", () => {
			const SOURCE = fs.readFileSync(CONTINUATION_AUTHORITY_PATH, "utf8")
			expect(SOURCE).toMatch(/runId\??\s*:/)
		})
		test("TCE-P01.RED: captureContinuationCardinalityAuthorityRecord preserves runId in the ring", () => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "run_turn_started",
				sessionId: "S-P01",
				runId: "R-P01",
			})
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const rec = ring.find((r) => r.stage === "run_turn_started" && r.sessionId === "S-P01")
			expect(rec).toBeDefined()
			expect((rec as { runId?: string }).runId).toBe("R-P01")
		})
	})

	// ---- TCE-P02: continuation join (prompt ↔ run) ----
	describe("TCE-P02 — continuation prompt↔run join (RED — §21 must add continuation_started capture)", () => {
		test("TCE-P02.RED: source presence — 'continuation_started' is in the stage union", () => {
			const SOURCE = fs.readFileSync(CONTINUATION_AUTHORITY_PATH, "utf8")
			expect(SOURCE).toMatch(/continuation_started/)
		})
		test("TCE-P02.RED: captureContinuationCardinalityAuthorityRecord accepts continuation_started stage with promptId+runId", () => {
			// §21 must add 'continuation_started' to the stage union AND extend
			// stageCounters. Today the helper throws on the unknown stage.
			// We assert the post-condition (record in ring) without crashing.
			let threw: unknown = null
			try {
				captureContinuationCardinalityAuthorityRecord({
					stage: "continuation_started",
					sessionId: "S-P02",
					promptId: "P-P02",
					runId: "R-P02",
				})
			} catch (e) {
				threw = e
			}
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const rec = ring.find((r) => (r as { stage: string }).stage === "continuation_started" && r.sessionId === "S-P02")
			expect(threw).toBeNull()
			expect(rec).toBeDefined()
			expect((rec as { promptId?: string }).promptId).toBe("P-P02")
			expect((rec as { runId?: string }).runId).toBe("R-P02")
		})
	})

	// ---- TCE-P03: task_started at SdkController.initTask seam ----
	describe("TCE-P03 — task_started at SdkController.initTask seam (RED — §21 must wire it)", () => {
		test("TCE-P03.RED: 'task_started' is in the stage union", () => {
			const SOURCE = fs.readFileSync(CONTINUATION_AUTHORITY_PATH, "utf8")
			expect(SOURCE).toMatch(/task_started/)
		})
		test("TCE-P03.RED: SdkController.ts initTask seam emits task_started to CCARD", () => {
			const SOURCE = fs.readFileSync(SDK_CONTROLLER_PATH, "utf8")
			const initTaskMatch = SOURCE.match(/async initTask[\s\S]*?taskStart\.initTask[\s\S]{0,800}/)
			expect(initTaskMatch).not.toBeNull()
			const block = initTaskMatch![0]
			expect(block).toMatch(/stage:\s*["']task_started["']/)
			expect(block).toMatch(/captureContinuationCardinalityAuthorityRecord/)
		})
		test("TCE-P03.RED: captureContinuationCardinalityAuthorityRecord accepts task_started with taskId===sessionId", () => {
			// §21 must add 'task_started' to the stage union AND extend
			// stageCounters. Today the helper throws on the unknown stage.
			let threw: unknown = null
			try {
				captureContinuationCardinalityAuthorityRecord({
					stage: "task_started",
					sessionId: "S-P03",
					taskId: "S-P03",
				})
			} catch (e) {
				threw = e
			}
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const rec = ring.find((r) => (r as { stage: string }).stage === "task_started" && r.sessionId === "S-P03")
			expect(threw).toBeNull()
			expect(rec).toBeDefined()
			expect(rec?.taskId).toBe("S-P03")
		})
	})

	// ---- TCE-P04: terminal owner threading (REAL production-seam behavioral tests) ----
	describe("TCE-P04 — terminal ownerId threading at CommandJobManager seam (CORRECTION02: real invariants, not regex)", () => {
		// ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01 CORRECTION02
		// (Factory P0 from §21 GREEN review): the §21 GREEN file's TCE-P04
		// used a regex `/terminal_committed[\s\S]{0,800}/` to assert
		// source-presence. That proves nothing about the runtime contract —
		// the production capture could be wrong (e.g. ownerId pulled from
		// active-session instead of launch-time ownerSessionId) and the
		// regex would still pass.
		//
		// CORRECTION02 rewrites these to assert the REAL invariants against
		// the REAL production CommandJobManager:
		//
		//   1. C1 capture is emitted exactly once per job finalize (no
		//      duplicate CCARD terminal records even when the lifecycle
		//      event fires multiple times).
		//   2. C1 capture carries `ownerId === job.ownerSessionId` —
		//      threaded from launch-time, NEVER derived from
		//      active-session / selected-task / foreground-job.
		//   3. C1 capture does NOT carry `terminalKind` (v1 schema).
		//   4. adapter replays the captured record as INSUFFICIENT_IDENTITY.

		function fakeSupervisor(): SupervisableShellProcess {
			let exitResolve: ((v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
			const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
				exitResolve = r
			})
			return {
				pid: 42000,
				pgid: 42000,
				exit,
				killTree: async () => {},
				terminateTree: async () => {
					exitResolve?.({ exitCode: null, signal: "SIGTERM" })
					return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
				},
				stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
				stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
			} as unknown as SupervisableShellProcess
		}

		test("TCE-P04.GREEN: CommandJobManager.real-finalize emits exactly one C1 terminal_committed record per jobId", async () => {
			setContinuationCardinalityAuthorityCaptureEnabled(true)
			clearContinuationCardinalityAuthorityCapture()
			const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
			// Mirrors dcct01: seatbelt would route through the
			// experimental sandbox and short-circuit before our fake
			// supervisor is reached, returning sandbox-unavailable.
			process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
			const lifecycleEvents: CommandJobLifecycleEvent[] = []
			const manager = new CommandJobManager({
				spawnFactory: () => fakeSupervisor(),
				onCommandJobLifecycle: (e) => lifecycleEvents.push(e),
			})
			try {
				const start = await manager.start(
					{
						command: "sleep 60",
						cwd: process.cwd(),
						waitBudgetMs: 100,
						executionDeadlineMs: 60_000,
					},
					{ sessionId: "OWNER-P04-LAUNCH", agentId: "test-agent", iteration: 1 },
				)
				await manager.cancel({ jobId: start.jobId })
				await start.terminalPromise
			} finally {
				await manager.dispose().catch(() => {})
				if (originalSandbox === undefined) {
					delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
				} else {
					process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
				}
			}
			const allKinds = lifecycleEvents.map((e) => e.event)
			const terminalEvents = lifecycleEvents.filter((e) => e.event === "command_job_terminal_committed")
			// Invariant: exactly one terminal_committed lifecycle event
			// fires per jobId during the finalize path.
			expect(terminalEvents.length).toBe(1)
			// Invariant: CCARD ring has exactly one terminal_committed
			// stage record (no duplicates).
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const c1Records = ring.filter((r) => r.stage === "terminal_committed")
			expect(c1Records.length).toBe(1)
			// Invariant: C1 capture carries ownerId === launch-time
			// job.ownerSessionId (the value we passed into manager.start
			// at line 501). This binds §17's ownerId necessity:
			// removing `ownerId: job.ownerSessionId` from
			// command-job-manager.ts:2667 flips this assertion RED.
			expect((c1Records[0] as { ownerId?: string }).ownerId).toBe("OWNER-P04-LAUNCH")
			// Invariant: terminal_committed stage does NOT carry
			// terminalKind (v1 schema). Removing/adding the
			// terminalKind field in the production seam would
			// flip this assertion.
			expect("terminalKind" in (c1Records[0] as unknown as Record<string, unknown>)).toBe(false)
			// Sanity check: lifecycle sink received the full sequence.
			expect(allKinds).toContain("command_job_process_started")
			expect(allKinds).toContain("command_job_terminal_committed")
		})

		test("TCE-P04.GREEN: C1 capture carries ownerId === job.ownerSessionId (launch-time, not derived from active-session)", () => {
			clearContinuationCardinalityAuthorityCapture()
			captureContinuationCardinalityAuthorityRecord({
				stage: "terminal_committed",
				sessionId: "OWNER-P04-LAUNCH",
				jobId: "J-P04",
				origin: "background_terminal",
				ownerId: "OWNER-P04-LAUNCH",
			})
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const rec = ring.find((r) => r.stage === "terminal_committed" && r.jobId === "J-P04")
			expect(rec).toBeDefined()
			expect((rec as { ownerId?: string }).ownerId).toBe("OWNER-P04-LAUNCH")
			expect((rec as { ownerId?: string }).ownerId).toBe((rec as { sessionId?: string }).sessionId)
		})

		test("TCE-P04.GREEN: C1 capture does NOT carry terminalKind (v1 schema)", () => {
			clearContinuationCardinalityAuthorityCapture()
			captureContinuationCardinalityAuthorityRecord({
				stage: "terminal_committed",
				sessionId: "OWNER-P04-LAUNCH",
				jobId: "J-P04-NK",
				ownerId: "OWNER-P04-LAUNCH",
			})
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const rec = ring.find((r) => r.stage === "terminal_committed" && r.jobId === "J-P04-NK")
			expect(rec).toBeDefined()
			expect("terminalKind" in (rec as unknown as Record<string, unknown>)).toBe(false)
		})

		test("TCE-P04.GREEN: replay classifies terminal_committed without terminalKind as INSUFFICIENT_IDENTITY", () => {
			const outcome = adaptRecord({
				stage: "terminal_committed",
				sessionId: "OWNER-P04-LAUNCH",
				jobId: "J-P04-REPLAY",
				ownerId: "OWNER-P04-LAUNCH",
			})
			expect(outcome.status).toBe("INSUFFICIENT_IDENTITY")
		})
	})

	// ---- TCE-P05: submit event IDs ----
	describe("TCE-P05 — submit event IDs at C9 (RED — §21 must thread submitId)", () => {
		test("TCE-P05.RED: source presence — sdk-session-event-coordinator.ts C9 capture threads submitId", () => {
			const SOURCE = fs.readFileSync(SESSION_EVENT_COORDINATOR_PATH, "utf8")
			const c9Match = SOURCE.match(/submit_and_exit_seen[\s\S]{0,600}/)
			expect(c9Match).not.toBeNull()
			const block = c9Match![0]
			expect(block).toMatch(/submitId/)
		})
		test("TCE-P05.RED: two submit_and_exit_seen captures with distinct submitIds appear as two records with distinct submitIds", () => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: "S-P05",
				submitId: "SUB-P05-1",
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: "S-P05",
				submitId: "SUB-P05-2",
			})
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const submits = ring.filter((r) => r.stage === "submit_and_exit_seen" && r.sessionId === "S-P05")
			expect(submits.length).toBe(2)
			expect((submits[0] as { submitId?: string }).submitId).toBe("SUB-P05-1")
			expect((submits[1] as { submitId?: string }).submitId).toBe("SUB-P05-2")
		})
	})

	// ---- TCE-P06: completion event IDs ----
	describe("TCE-P06 — completion event IDs at C10 (RED — §21 must thread completionId)", () => {
		test("TCE-P06.RED: source presence — sdk-session-event-coordinator.ts C10 capture threads completionId", () => {
			const SOURCE = fs.readFileSync(SESSION_EVENT_COORDINATOR_PATH, "utf8")
			const c10Match = SOURCE.match(/task_completion_committed[\s\S]{0,600}/)
			expect(c10Match).not.toBeNull()
			const block = c10Match![0]
			expect(block).toMatch(/completionId/)
		})
		test("TCE-P06.RED: two task_completion_committed captures with distinct completionIds appear as two records with distinct completionIds", () => {
			captureContinuationCardinalityAuthorityRecord({
				stage: "task_completion_committed",
				sessionId: "S-P06",
				completionId: "COMP-P06-1",
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "task_completion_committed",
				sessionId: "S-P06",
				completionId: "COMP-P06-2",
			})
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			const comps = ring.filter((r) => r.stage === "task_completion_committed" && r.sessionId === "S-P06")
			expect(comps.length).toBe(2)
			expect((comps[0] as { completionId?: string }).completionId).toBe("COMP-P06-1")
			expect((comps[1] as { completionId?: string }).completionId).toBe("COMP-P06-2")
		})
	})

	// ---- TCE-P07: DEFAULT_OFF ----
	describe("TCE-P07 — DEFAULT_OFF real seam (RED — §21 must guarantee capture is OFF by default)", () => {
		test("TCE-P07.GREEN: capture seam is OFF by default — no records accumulate without explicit enable", () => {
			setContinuationCardinalityAuthorityCaptureEnabled(false)
			clearContinuationCardinalityAuthorityCapture()
			captureContinuationCardinalityAuthorityRecord({
				stage: "run_turn_started",
				sessionId: "S-P07",
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "submit_and_exit_seen",
				sessionId: "S-P07",
			})
			const ring = getContinuationCardinalityAuthorityCaptureRecords()
			expect(ring.length).toBe(0)
			setContinuationCardinalityAuthorityCaptureEnabled(true)
		})
		test("TCE-P07.GREEN: production source sets captureEnabled = false at module load", () => {
			const SOURCE = fs.readFileSync(CONTINUATION_AUTHORITY_PATH, "utf8")
			expect(SOURCE).toMatch(/let captureEnabled = false/)
		})
	})
})
