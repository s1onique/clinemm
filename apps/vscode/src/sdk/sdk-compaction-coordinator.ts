// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Coordinates a manual "/compact" (alias "/smol") request triggered from the
// VSCode compact button or slash command. This mirrors the CLI's
// `compactCurrentSession` (apps/cli/src/runtime/interactive/session-runtime.ts):
//
//   1. Read the session's transcript.
//   2. Run a manual SDK compaction over it (sdk-compaction.ts).
//   3. Persist the SDK compaction sidecar so the next turn and resumes keep
//      using the compacted working context.
//
// Compaction always runs against an active session. When the user compacts a
// task opened from history (a displayed, non-running task with no active
// session, including a legacy task not yet migrated), we first resume it into
// an isolated session — using the same resume preparation as the follow-up
// path, which also migrates legacy tasks — then compact it through the single
// path below. The coordinator owns this session's host, so another task can
// replace the controller's active session without compaction stopping it during
// cleanup. Resuming and compaction both run inside the session-rebuild mutex, so
// a concurrent follow-up (which awaits that mutex before choosing a host)
// cannot interleave with the read/compact/persist sequence.
//
// Before this, the VSCode button sent the literal text "/compact" to the model,
// which the SDK does not treat as a runtime command, so the model improvised a
// fake "Conversation Summary" instead of compacting (CLINE-2503).

import type { Message as SdkMessage } from "@cline/llms"
import type { ClineCompactionInfo, ClineMessage, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { buildCompactionMessage, parseCompactionNoticeMetadata } from "./message-translator"
import { compactSessionMessages } from "./sdk-compaction"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkTaskHistory } from "./sdk-task-history"
import { prepareTaskResumeStartInput } from "./sdk-task-resume"
import type { SdkSessionHost } from "./session-host"

const COMPACTION_FAILURE_MESSAGE = "Couldn't compact the conversation. Please try again."
const COMPACTION_UNSUPPORTED_MESSAGE = "Compaction is not supported by this runtime yet. Please update Cline and try again."
const COMPACTION_TURN_RUNNING_MESSAGE =
	"Cannot compact while a response is in progress. Try again once the current turn finishes."

export interface SdkCompactionCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	rebuilds: SdkSessionRebuildScheduler
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	sessionConfigBuilder: SdkSessionConfigBuilder
	/** The task currently shown in the webview (may have no active session). */
	getDisplayedTaskId: () => string | undefined
	createTempSessionHost: () => Promise<SdkSessionHost>
	loadInitialMessages: (sessionHost: SdkSessionHost, taskId: string) => Promise<unknown[] | undefined>
	getWorkspaceRoot: () => Promise<string>
	postStateToWebview: () => Promise<void>
	/**
	 * ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01 (PASS
	 * POST_COMPACTION_PUBLICATION_REPAIRED):
	 *
	 * Optional: when supplied, the coordinator publishes the post-
	 * compaction `currentWorkingContextEstimate` to the host-side
	 * `WorkingContextHostCapture` carrier at the SAME moment the
	 * terminal divider is published. The carrier is normally only
	 * fed by `AgentRuntime.prepareTurnForModelRequest` via the
	 * canonical runtime-event subscription; manual compaction never
	 * flows through that runtime seam, so this hook is the bounded
	 * transport-only repair that closes the live-UI gap (divider
	 * updates to 29.6k, top bar stays at 412.7k) without changing
	 * the canonical prepareTurn flow.
	 *
	 * Caller contract:
	 *   - The VS Code host (`SdkController`) wires this option to
	 *     `WorkingContextHostCapture.setLatest(w)` — the additive
	 *     transport-only seam added to the carrier as part of this
	 *     ACT. `setLatest` reuses the carrier's existing fail-closed
	 *     assignment semantics (UNDEFINED_W_STALE_REUSE = FORBIDDEN)
	 *     so publication is identical in behavior to feeding the
	 *     carrier via its runtime-event observer. (Earlier review
	 *     drafts of this comment said the caller invoked
	 *     `WorkingContextHostCapture.observe(...)` with a
	 *     synthesized `working-context-state-changed` event; the
	 *     implementation landed on the simpler `setLatest(w)` seam
	 *     and the comment was tightened accordingly.)
	 *   - The function MUST be non-throwing (log + no-op on
	 *     failure); the divider publication is the user-visible
	 *     success indicator and MUST proceed even if W publication
	 *     fails. The coordinator wraps the call in try/catch and
	 *     logs via the existing Logger — exceptions do not
	 *     propagate.
	 *
	 * Optional so test constructions / non-VSCode hosts (CLI) keep
	 * working unchanged.
	 */
	publishPostCompactionW?: (w: number) => void
	/**
	 * ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01
	 *
	 * The canonical turn-phase authority (`TurnStateTracker`). Compaction
	 * is active SYSTEM work: while it runs, the runtime — not the user —
	 * owns the next progress step, so the canonical phase must say so.
	 * Without this the tracker keeps whatever phase the finished turn
	 * left behind (typically `awaiting_followup`), and the TaskHeader
	 * truthfully projects that stale authority as "Waiting" while the
	 * chat surface shows "Compacting context" — the observed
	 * contradiction.
	 *
	 * Optional so a caller that has no tracker (tests of unrelated
	 * behaviour) still constructs; production always supplies both.
	 */
	getTurnState?: () => TurnState
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number, writerId?: TurnStateWriterId) => void
	/**
	 * ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01
	 * + CORRECTION04
	 *
	 * Canonical authority for the legacy phase that should be written
	 * after a compaction restores. The callback receives the CAPTURED
	 * entry phase (the phase before compaction took ownership) as its
	 * sole argument and returns the host-derived canonical
	 * `TurnPhase` projection, or `undefined` when no canonical
	 * observation is available (no runtime activity seen, Hub/Remote
	 * hosts without a shadow wiring, fresh install before the first
	 * runtime event).
	 *
	 * Read at the compaction restore boundary
	 * (`enterCompactingPhase`'s returned closure) to recover from the
	 * LIVE-stale split: a non-terminal owner phase
	 * (`"streaming"` or `"awaiting_approval"`) left over in the legacy
	 * `TurnStateTracker` paired with a canonical authority that has
	 * already moved on. When that combination is observed, the
	 * restore writes the CANONICAL PHASE rather than the stale entry
	 * phase. The canonical phase is itself a fully-resolved `TurnPhase`
	 * (idle / awaiting_followup / completed / resumable / error /
	 * etc.) — the bounded repair does NOT infer a phase from a binary
	 * activity bit.
	 *
	 * Optional so callers that have not yet wired the canonical
	 * projection (CLI hosts, tests of unrelated behavior) see
	 * byte-equivalent restore semantics. When the callback is absent
	 * or returns `undefined`, the coordinator preserves the prior
	 * compatibility behavior (`unavailable ≠ idle`).
	 *
	 * CORRECTION04 (Factory reviewer disposition): the callback MUST
	 * receive the captured `entryPhase` as its argument. The selector
	 * (`selectCanonicalRestorePhase`) uses THREE inputs:
	 *
	 *   entryPhase          -- CAPTURED before compaction
	 *                           (governs terminal-owner preservation)
	 *   canonicalShadowPhase -- canonical authority projection
	 *   currentLegacyPhase  -- LIVE tracker at restore time; legitimate
	 *                           signal only for `awaiting_followup`
	 *                           (host-owned override during compaction)
	 *
	 * The coordinator passes `entryPhase` through so the selector
	 * CANNOT confuse `entryPhase` (CAPTURED) with `currentLegacyPhase`
	 * (LIVE). The live tracker reads `compacting` for the entire
	 * compaction window by construction; the selector must NOT consult
	 * `currentLegacyPhase === "compacting"`. `compacting` is a
	 * transition marker, not a restore destination.
	 *
	 * ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01 (P0):
	 *
	 * The previous incarnation of this option was
	 * `getRuntimeActivityState: () => "idle" | "active"`. That shape
	 * was rejected by Factory review — it compressed an 8-state domain
	 * to one bit and tried to reconstruct a specific phase
	 * (`awaiting_followup`) from it, which is not derivable from
	 * activity alone. The canonical projection owns the
	 * awaiting_followup vs idle distinction (it requires the
	 * host-interaction dimension in
	 * `TaskState.projectHostTurnState(model, hostInteraction)`). The
	 * coordinator MUST ask the canonical authority for the resolved
	 * phase rather than infer one.
	 */
	getCanonicalRestorePhase?: (entryPhase: TurnPhase) => TurnPhase | undefined
}

export class SdkCompactionCoordinator {
	private compactInFlight = false

	constructor(private readonly options: SdkCompactionCoordinatorOptions) {}

	/**
	 * Compact the displayed task's conversation. Mirrors the CLI's `/compact`
	 * (alias `/smol`) local command. No-ops with a status message when there is
	 * nothing to compact or a turn is running.
	 */
	async compactTask(): Promise<void> {
		if (this.compactInFlight) {
			Logger.warn("[SdkController] compactTask: a compaction is already in progress; ignoring")
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (activeSession) {
			// A turn is still running; compacting mid-turn would race the live agent
			// loop's own message persistence. Ask the user to wait until it finishes.
			if (activeSession.isRunning) {
				this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, activeSession.sessionId)
				await this.options.postStateToWebview()
				return
			}

			this.compactInFlight = true
			try {
				// Hold the same boundary as idle follow-up sends so a follow-up
				// cannot grow the transcript between this read/compact/persist
				// sequence and its persistence.
				await this.options.rebuilds.runExclusive(async () => {
					// Compare by sessionId, not object identity: idle rebuilds
					// (provider/MCP/terminal mode) replace the session object but
					// reuse the sessionId for the same conversation, which is what
					// the user asked to compact. Use the current host either way.
					const current = this.options.sessions.getActiveSession()
					if (current?.sessionId !== activeSession.sessionId) {
						Logger.log("[SdkController] compactTask: Target changed while waiting for the mutex; cancelling")
						return
					}
					if (current.isRunning) {
						this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, current.sessionId)
						await this.options.postStateToWebview()
						return
					}
					await this.runCompaction(current.sdkHost, current.sessionId)
				})
			} catch (error) {
				// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01:
				// The failure-notice row is appended to the transcript via
				// `emitInfo` → `appendAndEmit` regardless of the trailing
				// publication, so the user still sees it. A publication
				// failure on this outer catch must NOT mask the already-
				// logged original error or propagate to the caller — the
				// UX-level failure row already landed.
				Logger.error("[SdkController] compactTask failed:", error)
				try {
					this.emitInfo(COMPACTION_FAILURE_MESSAGE, activeSession.sessionId)
					await this.options.postStateToWebview()
				} catch (publicationError) {
					Logger.error(
						"[SdkController] compactTask: failure-notice publication failed; failure row already on transcript",
						publicationError,
					)
				}
			} finally {
				this.compactInFlight = false
			}
			return
		}

		const displayedTaskId = this.options.getDisplayedTaskId()
		if (!displayedTaskId) {
			Logger.warn("[SdkController] compactTask: No active session or displayed task to compact")
			this.emitInfo("There is no task to compact.")
			await this.options.postStateToWebview()
			return
		}

		this.compactInFlight = true
		try {
			await this.compactDisplayedTask(displayedTaskId)
		} catch (error) {
			// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01:
			// Mirror the active-session branch above.
			Logger.error("[SdkController] compactTask failed:", error)
			try {
				this.emitInfo(COMPACTION_FAILURE_MESSAGE, displayedTaskId)
				await this.options.postStateToWebview()
			} catch (publicationError) {
				Logger.error(
					"[SdkController] compactTask: failure-notice publication failed; failure row already on transcript",
					publicationError,
				)
			}
		} finally {
			this.compactInFlight = false
		}
	}

	/**
	 * Resume a displayed history task in an isolated host, compact it, then
	 * dispose the owned host so the task stays "displayed only". Runs inside the
	 * session-rebuild mutex so a concurrent follow-up cannot resume the same task
	 * in parallel; the follow-up waits, then reads the sidecar this persisted.
	 */
	private async compactDisplayedTask(taskId: string): Promise<void> {
		await this.options.rebuilds.runExclusive(async () => {
			// Another path may have made this task active while we waited for the
			// mutex. If so, compact that live session instead of resuming a second.
			const active = this.options.sessions.getActiveSession()
			if (active) {
				if (active.sessionId !== taskId) {
					Logger.log(`[SdkController] compactTask: Target changed while waiting to compact ${taskId}; cancelling`)
					return
				}
				if (active.isRunning) {
					this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, taskId)
					await this.options.postStateToWebview()
					return
				}
				await this.runCompaction(active.sdkHost, taskId)
				return
			}

			const resumeStart = await prepareTaskResumeStartInput(this.options, taskId)
			if (this.options.sessions.getActiveSession() || this.options.getDisplayedTaskId() !== taskId) {
				Logger.log(`[SdkController] compactTask: Target changed before resuming ${taskId}; cancelling`)
				return
			}

			// Opening a task from history fires an un-awaited endActiveSession for
			// this sessionId; core cleanup is keyed by sessionId, so starting over
			// that in-flight stop would let the old session's late cleanup tear
			// down this one. Enforce the same stop-before-start as startNewSession.
			await this.options.sessions.waitForPendingStop(taskId)

			const sdkHost = await this.options.createTempSessionHost()
			let sessionId: string | undefined
			try {
				const startResult = await sdkHost.start({
					...resumeStart,
					interactive: true,
				})
				sessionId = startResult.sessionId
				// Starting may persist legacy conversion. Once it succeeds, complete
				// compaction even if navigation changes the displayed/active task. The
				// isolated host owns this session, while UI emitters fence stale rows.
				await this.runCompaction(sdkHost, sessionId)
			} finally {
				try {
					if (sessionId) {
						await sdkHost.stop(sessionId)
					}
				} finally {
					await sdkHost.dispose("compactDisplayedTask")
				}
			}
		})
	}

	private async runCompaction(sdkHost: SdkSessionHost, sessionId: string): Promise<void> {
		const updateSessionCompactionState = sdkHost.updateSessionCompactionState
		if (!updateSessionCompactionState) {
			this.emitInfo(COMPACTION_UNSUPPORTED_MESSAGE, sessionId)
			await this.options.postStateToWebview()
			return
		}
		const messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]
		const messagesBefore = messages.length
		if (messagesBefore === 0) {
			this.emitInfo("No messages to compact.", sessionId)
			await this.options.postStateToWebview()
			return
		}

		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()
		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })

		// A live divider row, updated in place (same ts) from "started" to its
		// terminal state — the same UX as the CLI's compaction divider.
		const compactionTs = Date.now()
		// ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01: the canonical phase
		// enters `compacting` BEFORE the divider is emitted, so every
		// consumer that samples state while the divider is visible (the
		// TaskHeader projection included) sees runtime ownership rather
		// than the stale phase the previous turn left behind. The entry
		// phase + anchor are captured here and restored in `finally`,
		// which keeps this a bounded system-transition window rather
		// than a new terminal state.
		const restorePhase = this.enterCompactingPhase()
		// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01:
		//
		// Captured before the try so the `finally` block can distinguish:
		//   success exit → the trailing post-restore publication is the
		//                  user's only feedback that the webview actually
		//                  saw the restored phase; a publication failure
		//                  here is observable and must propagate.
		//   throw exit   → the original compaction throw is authoritative;
		//                  a publication failure here is secondary, log
		//                  it, do NOT mask the original error.
		let compactionError: unknown
		try {
			this.emitCompactionRow({ status: "started", mode: "manual" }, compactionTs, sessionId)
			await this.options.postStateToWebview()
			try {
				await this.runCompactionInPhase({
					sdkHost,
					sessionId,
					messages,
					messagesBefore,
					config,
					compactionTs,
					updateSessionCompactionState,
				})
			} catch (error) {
				compactionError = error
				throw error
			}
		} finally {
			restorePhase()
			// ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01:
			//
			// The success path publishes its terminal snapshot from inside
			// `runCompactionInPhase` while the tracker is still in the
			// `compacting` phase. The `finally` block restores the entry
			// phase + anchor above; without this trailing publication the
			// webview's last received snapshot would still say
			// `phase = "compacting"` and the TaskHeader / composer would
			// remain stuck on the runtime-owned state until some other
			// event happened to flush again. The publication here is
			// unconditional on exit (success, throw, or skip) — every
			// terminal path lands in `finally`.
			try {
				await this.options.postStateToWebview()
			} catch (publicationError) {
				if (compactionError === undefined) {
					// Success exit — publication is the user's only
					// signal that the webview saw the restore. Propagate.
					// biome-ignore lint/correctness/noUnsafeFinally: throw is gated by `compactionError === undefined`, so it never runs while another throw is in flight.
					throw publicationError
				}
				// Failure exit — the original compaction throw is
				// authoritative. Surface the publication failure as a
				// log entry but do NOT mask the compaction error.
				Logger.error(
					"[SdkController] compactTask: post-restore publication failed after a compaction error; preserving original error",
					publicationError,
				)
			}
		}
	}

	/**
	 * Enter the canonical `compacting` phase and return a function that
	 * restores the phase (and anchor) that was current on entry.
	 *
	 * No-ops (returning a no-op restorer) when the caller supplied no
	 * turn-state authority — this coordinator never invents a second one.
	 *
	 * ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01:
	 *
	 * The returned closure applies the canonical-projection restore
	 * policy. When the caller wired `getCanonicalRestorePhase()` AND
	 * that callback returns a non-`undefined` `TurnPhase` AND the
	 * entry phase was a non-terminal owner (`"streaming"` or
	 * `"awaiting_approval"`) — the LIVE-stale split — the restore
	 * writes the canonical projection rather than the stale entry
	 * phase. Otherwise the restore preserves byte-equivalent
	 * behavior:
	 *
	 *   * entry phase already terminal (idle / awaiting_followup /
	 *     completed / resumable / error) → preserve entry
	 *   * canonical projection absent / undefined → preserve entry
	 *     (unavailable ≠ idle; Factory P1)
	 *   * canonical projection present but entry phase already
	 *     canonical → preserve entry (no override)
	 *
	 * The canonical phase is itself a fully-resolved `TurnPhase` — the
	 * bounded repair does NOT infer one from a binary activity bit.
	 */
	private enterCompactingPhase(): () => void {
		const getTurnState = this.options.getTurnState
		const setTurnPhase = this.options.setTurnPhase
		if (!getTurnState || !setTurnPhase) {
			return () => {}
		}
		const entry = getTurnState()
		setTurnPhase("compacting", entry.anchorTs, "compaction-enter")
		const getCanonicalRestorePhase = this.options.getCanonicalRestorePhase
		return () => {
			// Bounded canonical-projection restore — see ACT-CLINEMM-
			// COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01.
			//
			// CORRECTION04 (Factory reviewer disposition): the callback
			// receives the CAPTURED `entry.phase` as its argument. This
			// is the coordinator's only point of contact with the
			// selector. The selector CANNOT confuse `entryPhase`
			// (CAPTURED before compaction) with `currentLegacyPhase`
			// (LIVE tracker at restore time, which reads `compacting`
			// during the callback by construction).
			//
			// The legacy entry phase is preserved UNLESS the canonical
			// projection has a fully-resolved `TurnPhase` AND the entry
			// phase was a non-terminal owner (the LIVE-stale split).
			// Callers that have not wired `getCanonicalRestorePhase` or
			// whose canonical projection is undefined keep the previous
			// byte-equivalent behavior.
			const isNonTerminalOwner = entry.phase === "streaming" || entry.phase === "awaiting_approval"
			if (!isNonTerminalOwner) {
				setTurnPhase(entry.phase, entry.anchorTs, "compaction-restore-entry-preserve")
				return
			}
			const canonicalRestorePhase = getCanonicalRestorePhase?.(entry.phase)
			if (canonicalRestorePhase === undefined) {
				// Canonical projection unavailable. Preserve entry.
				// Factory P1: `unavailable ≠ idle`. Do NOT synthesize
				// a phase from absence of evidence.
				setTurnPhase(entry.phase, entry.anchorTs, "compaction-restore-canonical-unavailable-preserve")
				return
			}
			setTurnPhase(canonicalRestorePhase, entry.anchorTs, "compaction-restore-canonical-resolved")
		}
	}

	private async runCompactionInPhase(input: {
		sdkHost: SdkSessionHost
		sessionId: string
		messages: SdkMessage[]
		messagesBefore: number
		config: Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>
		compactionTs: number
		updateSessionCompactionState: NonNullable<SdkSessionHost["updateSessionCompactionState"]>
	}): Promise<void> {
		const { sdkHost, sessionId, messages, messagesBefore, config, compactionTs } = input

		// The SDK reports the compaction's token/message counters through its
		// status notices; capture the terminal one for the final divider.
		let noticeInfo: ClineCompactionInfo | undefined
		try {
			const result = await compactSessionMessages({
				config: {
					providerConfig: config.providerConfig,
					providerId: config.providerId,
					modelId: config.modelId,
					knownModels: config.knownModels,
					compaction: config.compaction,
					logger: config.logger,
					telemetry: config.telemetry,
				},
				sessionId,
				messages,
				emitStatusNotice: (_message, metadata) => {
					const parsed = parseCompactionNoticeMetadata(metadata)
					if (parsed && parsed.status !== "started") {
						noticeInfo = { ...parsed, mode: "manual" }
					}
				},
			})

			if (!result.compacted) {
				this.emitCompactionRow(noticeInfo ?? { status: "skipped", mode: "manual" }, compactionTs, sessionId)
				await this.options.postStateToWebview()
				return
			}

			if (!result.compactionState) {
				throw new Error("Compaction did not return durable state.")
			}
			// The `updateSessionCompactionState` field in `input` carries the
			// narrowing proof from `runCompaction`'s presence check; the call
			// itself stays a method call so the host keeps its receiver.
			const persisted = await input.updateSessionCompactionState.call(sdkHost, sessionId, result.compactionState)
			if (!persisted.updated) {
				throw new Error("Compaction sidecar could not be persisted.")
			}

			this.emitCompactionRow(
				noticeInfo?.status === "completed"
					? noticeInfo
					: {
							status: "completed",
							mode: "manual",
							messagesBefore,
							messagesAfter: result.messages.length,
						},
				compactionTs,
				sessionId,
			)
			// ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01: surface
			// the producer's W BEFORE the postStateToWebview so the
			// extension state payload carries the new W in the very
			// next publication (no race window). Failure is logged and
			// swallowed — the divider publication is the user-visible
			// success indicator and MUST proceed even if W publication
			// fails.
			if (typeof result.currentWorkingContextEstimate === "number") {
				try {
					this.options.publishPostCompactionW?.(result.currentWorkingContextEstimate)
				} catch (publishError) {
					Logger.error(
						"[SdkController] compactTask: post-compaction W publication failed; divider already published",
						publishError,
					)
				}
			}
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Compacted session ${sessionId}: ${messagesBefore} -> ${result.messages.length} messages`)
		} catch (error) {
			// Manual-mode counterpart of the translator's finalizeDanglingCompaction
			// (message-translator.ts), which handles auto compaction from turn
			// events — keep the terminal-state rules of the two in sync.
			this.emitCompactionRow({ status: "failed", mode: "manual" }, compactionTs, sessionId)
			await this.options.postStateToWebview()
			throw error
		}
	}

	private getCurrentMode(): Mode {
		const m = this.options.stateManager.getGlobalSettingsKey("mode")
		return m === "plan" ? m : "act"
	}

	/** Append or update-in-place (same ts) the compaction divider row. */
	private emitCompactionRow(info: ClineCompactionInfo, ts: number, sessionId: string): void {
		const targetSessionId = this.getTargetSessionId()
		if (targetSessionId !== sessionId) {
			Logger.warn(`[SdkController] compactTask: skipped compaction row for inactive session ${sessionId}`)
			return
		}
		this.options.messages.appendAndEmit([buildCompactionMessage(info, ts)], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
	}

	private emitInfo(text: string, sessionId?: string): void {
		const targetSessionId = this.getTargetSessionId()
		if (sessionId && targetSessionId !== sessionId) {
			Logger.warn(`[SdkController] compactTask: skipped info for inactive session ${sessionId}`)
			return
		}
		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text,
			partial: false,
		}
		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId: sessionId ?? targetSessionId ?? "", status: "running" },
		})
	}

	/**
	 * The session a compaction row belongs to: the active session if one exists,
	 * otherwise the displayed task. The fallback lets the displayed-task path's
	 * terminal failure message land after its transient session has been ended.
	 */
	private getTargetSessionId(): string | undefined {
		return this.options.sessions.getActiveSession()?.sessionId ?? this.options.getDisplayedTaskId()
	}
}
