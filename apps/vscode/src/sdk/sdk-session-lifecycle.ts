import type {
	CoreSessionEvent,
	ITelemetryService,
	PreparedRemoteConfigCoreIntegration,
	RestoreInput,
	RestoreResult,
	StartSessionResult,
} from "@cline/core"
import { formatModeSwitchNotice, type ModeSwitchNotice } from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import type { ActiveSession } from "./cline-session-factory"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import { buildToolPolicies } from "./sdk-tool-policies"
import type { SdkSessionHost } from "./session-host"
import { VscodeSessionHost } from "./vscode-session-host"

type RequestToolApprovalHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["requestToolApproval"]>
type AskQuestionHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["askQuestion"]>
type EditorExecutorHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["editorExecutor"]>
type ApplyPatchExecutorHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["applyPatchExecutor"]>
type ReadFileExecutorHandler = NonNullable<Parameters<typeof VscodeSessionHost.create>[0]["readFileExecutor"]>

export interface SdkSessionLifecycleOptions {
	mcpHub: McpHub
	requestToolApproval: RequestToolApprovalHandler
	askQuestion: AskQuestionHandler
	/** Custom `editor` executor (diff-view edit pipeline); replaces the SDK's disk writer. */
	editorExecutor?: EditorExecutorHandler
	/** Custom `apply_patch` executor (reverts the diff preview, then applies via the SDK default). */
	applyPatchExecutor?: ApplyPatchExecutorHandler
	/** Custom `read_files` executor (resolves relative paths against the workspace root). */
	readFileExecutor?: ReadFileExecutorHandler
	onSessionEvent: (event: CoreSessionEvent) => void
	/**
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: per-tool-start hook. Fires
	 * exactly once per canonical `tool-started` runtime event (post
	 * chat-translation: `content_start(tool)`). Receives the SDK
	 * `AgentContentStartEvent` for the tool. NOT called for tool
	 * updates (`content_update`) or finishes (`content_end`).
	 */
	onToolStarted?: (event: import("@cline/shared").AgentContentStartEvent) => void
	/** Lazy factory for the VscodeTerminalManager (foreground terminal support). */
	getTerminalManager?: () => VscodeTerminalManager
	/** Registry of in-flight foreground executions for "Proceed While Running". */
	foregroundCommands?: SdkForegroundCommandCoordinator
	/** Returns the latest prepared remote-config integration, if remote config is active. */
	getRemoteConfigIntegration?: () => PreparedRemoteConfigCoreIntegration | undefined
	/** Shared SDK telemetry service owned by SdkController. */
	telemetry?: ITelemetryService
	onSendStart?: (sessionId: string) => void
	onSendComplete: (sessionId: string) => Promise<void> | void
	onSendError: (error: unknown, sessionId: string) => Promise<void> | void
	/**
	 * Returns (and clears) a pending user-initiated plan/act switch recorded by
	 * SdkModeCoordinator for this session, so fireAndForgetSend — the single
	 * funnel for outbound turn sends — can stamp a <mode_notice> onto the next
	 * message. Consumed exactly once; null when no switch is pending.
	 */
	consumeModeSwitchNotice?: (sessionId: string) => ModeSwitchNotice | null
	/**
	 * ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION02: bind the user-armed
	 * session-autonomy pre-arm to the new SDK session id when this session
	 * is allocated. This is the ONLY caller of consumePendingOverride and
	 * the authoritative site where the arm becomes a bound override. The
	 * store itself has a pure getOverride() — we do not consume the arm
	 * from any query path. See SessionAutoApprovalStore for the contract.
	 */
	consumePendingOverride?: (sessionId: string) => void
	/**
	 * ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01:
	 * Setting-driven capability snapshot source forwarded to the
	 * shared VscodeSessionHost. Required so the LIVE primary session
	 * (and resume-from-history sessions) read the persisted
	 * `clinemmSafeYoloAllowNetwork` / `clinemmSafeYoloAllowSshAgent`
	 * values from StateManager instead of falling back to the env-only
	 * network path. The 5 SdkController.ts callsites
	 * (`createTempSessionHost` for followup / compaction / edit /
	 * regenerate) already wire this; this field closes the
	 * `getOrCreateSharedHost` gap that the live UI=true → deny
	 * specimen exposed.
	 */
	safeYoloCapabilitySource?: () => {
		readonly network: boolean | undefined
		readonly sshAgent: boolean | undefined
	}
	onDidBecomeIdle?: () => void
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: lifecycle callback for the
	 * background `run_commands` path. Forwarded to the host so the
	 * run_commands tool can flip the projection when it returns RUNNING
	 * / reaches a terminal state. The host owns the projection; the
	 * session lifecycle is the pass-through.
	 */
	onBackgroundStateChange?: (running: boolean, jobId: string | undefined) => void
	/**
	 * ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: the originating
	 * task-operation generation authority. The lifecycle does NOT
	 * own a separate generation counter; it consults this single
	 * authority via `isOperationCurrent(token)` before installing
	 * `this.activeSession` after `sdkHost.start()`. A stale token
	 * means a newer intent has superseded this operation; the
	 * lifecycle disposes the just-started session and returns
	 * `{ status: "superseded", startedSessionId? }`. The
	 * `startedSessionId` is only present on the load-bearing
	 * post-start fence path (the disposed session is observable
	 * for logging/test purposes); pre-host fence paths carry no
	 * extra field. `sdkHost` is never returned on `"superseded"`
	 * because there is no live host to expose.
	 */
	isOperationCurrent?: (token: number) => boolean
}

export class SdkSessionLifecycle {
	private activeSession: ActiveSession | undefined
	private sharedHost: SdkSessionHost | undefined
	private sharedHostPromise: Promise<SdkSessionHost> | undefined
	private sharedHostUnsubscribe: (() => void) | undefined
	/**
	 * Stops still in flight, keyed by sessionId. Mode/MCP rebuilds and
	 * follow-up resumes reuse the sessionId of the session they replace, and
	 * core cleanup is keyed by sessionId, so a same-id start that overlaps a
	 * stop would be torn down by the old session's late cleanup.
	 * startNewSession consults this map to enforce stop-before-start, the same
	 * sequencing the CLI uses.
	 */
	private readonly pendingStops = new Map<string, Promise<void>>()

	constructor(private readonly options: SdkSessionLifecycleOptions) {}

	getActiveSession(): ActiveSession | undefined {
		return this.activeSession
	}

	setRunning(isRunning: boolean): void {
		const activeSession = this.activeSession
		if (!activeSession || activeSession.isRunning === isRunning) {
			return
		}
		activeSession.isRunning = isRunning
		if (!isRunning) {
			this.options.onDidBecomeIdle?.()
		}
	}

	/**
	 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
	 * Public wrapper around the private `endActiveSession` for bounded
	 * session-clear paths that aren't full replacements. Used by the
	 * `SdkSessionAutoApprovalCoordinator` failure handler to drop the
	 * active session when a rebuild fails — without that, the OLD
	 * runtime would continue running with a stale `submit_and_exit`
	 * toolset while the canonical `SessionAutoApprovalStore` already
	 * reflects the user's NEW override. Tearing down on failure matches
	 * the reviewer's preferred failure policy: "current runtime is
	 * marked STALE_FOR_COMPLETION_AUTHORITY. next safe session rebuild /
	 * task construction obtains the new completion-authority state."
	 *
	 * Returns the disposed session (if any) so callers can chain cleanup.
	 */
	async clearActiveSession(reason: string): Promise<ActiveSession | undefined> {
		return this.endActiveSession(reason)
	}

	private clearActiveSessionReference(): ActiveSession | undefined {
		const activeSession = this.activeSession
		this.activeSession = undefined
		return activeSession
	}

	async endActiveSession(
		reason: string,
		options: { awaitStop?: boolean; timeoutMs?: number } = {},
	): Promise<ActiveSession | undefined> {
		const activeSession = this.clearActiveSessionReference()
		if (!activeSession) {
			return undefined
		}

		this.safeUnsubscribe(activeSession, reason)
		const stopPromise = this.trackSessionStop(activeSession.sdkHost, activeSession.sessionId, reason)
		if (options.awaitStop) {
			const timeoutMs = options.timeoutMs ?? 3000
			const stopped = await this.waitForStop(stopPromise, timeoutMs)
			if (!stopped) {
				Logger.warn(
					`[SdkController] Timed out stopping SDK session ${activeSession.sessionId} after ${timeoutMs}ms (${reason})`,
				)
			}
		}
		return activeSession
	}

	/**
	 * Resolves once any in-flight stop for `sessionId` has settled. Callers that
	 * start a session outside startNewSession (e.g. on an isolated host) must
	 * wait here first, or the old session's late cleanup tears down the new one.
	 */
	async waitForPendingStop(sessionId: string): Promise<void> {
		const pendingStop = this.pendingStops.get(sessionId)
		if (pendingStop) {
			Logger.log(`[SdkController] Waiting for session ${sessionId} to stop before restarting it`)
			await pendingStop
		}
	}

	async updateActiveSessionModel(modelId: string): Promise<boolean> {
		const activeSession = this.activeSession
		if (!activeSession?.sdkHost.updateSessionModel) {
			return false
		}

		await activeSession.sdkHost.updateSessionModel(activeSession.sessionId, modelId)
		return true
	}

	async startNewSession(
		startInput: Parameters<VscodeSessionHost["start"]>[0],
		/**
		 * ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: the originating
		 * task-operation token. The lifecycle carries this through the
		 * awaited `sdkHost.start()` boundary and refuses to install
		 * `this.activeSession` if a newer intent has superseded this
		 * operation. Pass-through from `SdkTaskStartCoordinator.initTask`
		 * (and `reinitExistingTaskFromId`); SdkController wires the
		 * token from the shared `TaskOperationFence`.
		 *
		 * When undefined, the fence check is skipped. This is the
		 * legacy behavior for callers that have not yet been updated
		 * to thread a token through (e.g. the four
		 * `replaceActiveSession` callers — mode/terminal/provider/MCP
		 * rebuilds). Threading tokens through those callers is a
		 * separate follow-up ACT; the parent race targeted here is
		 * initTask ↔ clearTask, which goes through the explicit token
		 * path.
		 */
		operationToken: number,
	): Promise<
		| { status: "started"; startResult: StartSessionResult; sdkHost: SdkSessionHost }
		| { status: "superseded"; startedSessionId?: string }
	>
	async startNewSession(
		startInput: Parameters<VscodeSessionHost["start"]>[0],
	): Promise<{ status: "started"; startResult: StartSessionResult; sdkHost: SdkSessionHost }>
	async startNewSession(
		startInput: Parameters<VscodeSessionHost["start"]>[0],
		operationToken?: number,
	): Promise<
		| { status: "started"; startResult: StartSessionResult; sdkHost: SdkSessionHost }
		| { status: "superseded"; startedSessionId?: string }
	> {
		// FENCE-FIRST (P0): the fence must reject a stale token BEFORE
		// any destructive lifecycle action. The previous ordering
		// called `endActiveSession("startNewSession")` first, allowing
		// a stale operation to terminate the newer operation's session
		// before its own supersession was detected. A stale operation
		// MUST NOT terminate, clear, replace, or install any session
		// belonging to a newer operation.
		const isCurrent = (t: number) => this.options.isOperationCurrent?.(t) ?? true
		if (operationToken !== undefined && !isCurrent(operationToken)) {
			Logger.debug(
				`[SdkController] startNewSession: pre-endActiveSession supersession; operationToken=${operationToken} abandoned`,
			)
			// We haven't touched activeSession yet — no cleanup needed.
			return { status: "superseded" }
		}

		if (this.activeSession) {
			await this.endActiveSession("startNewSession")
			// FENCE again after the awaited endActiveSession — a
			// concurrent clearTask or new initTask could have advanced
			// the fence during the await.
			if (operationToken !== undefined && !isCurrent(operationToken)) {
				Logger.debug(
					`[SdkController] startNewSession: post-endActiveSession supersession; operationToken=${operationToken} abandoned`,
				)
				return { status: "superseded" }
			}
		}

		// Same-id starts must wait for the previous session's stop to finish;
		// see pendingStops. A fresh id cannot conflict, so it never waits.
		const requestedSessionId = startInput.config?.sessionId?.trim()
		if (requestedSessionId) {
			await this.waitForPendingStop(requestedSessionId)
			// FENCE after waitForPendingStop await — defensive check.
			if (operationToken !== undefined && !isCurrent(operationToken)) {
				Logger.debug(
					`[SdkController] startNewSession: post-waitForPendingStop supersession; operationToken=${operationToken} abandoned`,
				)
				return { status: "superseded" }
			}
		}

		const autoApprovalSettings = StateManager.get().getGlobalSettingsKey("autoApprovalSettings")
		const toolPolicies = autoApprovalSettings ? buildToolPolicies(autoApprovalSettings, this.options.mcpHub) : undefined

		const sdkHost = await this.getOrCreateSharedHost()

		// FENCE again after getOrCreateSharedHost await — defensive
		// check; the host-creation path can theoretically await too.
		if (operationToken !== undefined && !isCurrent(operationToken)) {
			Logger.debug(
				`[SdkController] startNewSession: pre-host.start supersession; operationToken=${operationToken} abandoned`,
			)
			// The shared host was created but no session was started,
			// so there is no `startedSessionId` to surface. Return
			// the closed state without exposing the host (the caller
			// has nothing to use it for).
			return { status: "superseded" }
		}

		const startResult = await sdkHost.start({
			...startInput,
			...(toolPolicies ? { toolPolicies } : {}),
		})

		// LOAD-BEARING POST-START FENCE: this is the critical race
		// window the parent RED reproduces. If a newer intent (e.g.
		// concurrent clearTask or initTask B) advanced the fence
		// while we were awaiting host.start, dispose the just-started
		// session via `trackSessionStop` (so `pendingStops`
		// bookkeeping protects against same-id collision with a
		// future start) and return `superseded`. Do NOT install
		// `this.activeSession`.
		if (operationToken !== undefined && !isCurrent(operationToken)) {
			Logger.debug(
				`[SdkController] startNewSession: post-start supersession; disposing just-started session=${startResult.sessionId}`,
			)
			this.trackSessionStop(sdkHost, startResult.sessionId, "superseded-by-fence")
			// The session was just started but is being disposed; we DO NOT
			// return a live `sdkHost` (it is no longer usable). Surface the
			// disposed sessionId so logs/tests can name the supersession.
			return { status: "superseded", startedSessionId: startResult.sessionId }
		}

		this.activeSession = {
			sessionId: startResult.sessionId,
			startConfig: startInput.config
				? {
						providerId: startInput.config.providerId,
						modelId: startInput.config.modelId,
					}
				: undefined,
			sdkHost,
			unsubscribe: () => {},
			startResult,
			isRunning: true,
		}

		// ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION02:
		// consume any user-armed pre-arm intent and bind it to this
		// brand-new session id. This is the authoritative consumption
		// site; the store's getOverride() is pure and never consumes.
		this.options.consumePendingOverride?.(startResult.sessionId)

		return { status: "started", startResult, sdkHost }
	}

	async replaceActiveSession(options: {
		expectedSession: ActiveSession
		startInput: Parameters<VscodeSessionHost["start"]>[0]
		initialMessages?: Parameters<VscodeSessionHost["start"]>[0]["initialMessages"]
		disposeReason: string
		/**
		 * ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: the originating
		 * task-operation token. Each caller of `replaceActiveSession`
		 * (mode switch, terminal mode change, provider change, MCP
		 * change) allocates its own token and threads it through so
		 * the post-start fence check can detect supersession. Optional
		 * for now; threading this through the four callers is a
		 * separate follow-up ACT.
		 */
		operationToken?: number
	}): Promise<
		| {
				oldSessionId: string
				startResult: StartSessionResult
				sdkHost: SdkSessionHost
		  }
		| undefined
	> {
		const oldSession = this.activeSession
		if (!oldSession || oldSession !== options.expectedSession || oldSession.isRunning) {
			return undefined
		}

		const { sessionId: oldSessionId } = oldSession

		// No need to await the stop here: callers reuse oldSessionId in the
		// startInput, and startNewSession waits on the pending stop for it.
		await this.endActiveSession(options.disposeReason)

		// Legacy callers (no token) take the legacy overload; new callers
		// take the fenced overload. The two overloads have different
		// return shapes so TypeScript can narrow correctly.
		const result = await (options.operationToken !== undefined
			? this.startNewSession(
					{
						...options.startInput,
						...(options.initialMessages ? { initialMessages: options.initialMessages } : {}),
					},
					options.operationToken,
				)
			: this.startNewSession({
					...options.startInput,
					...(options.initialMessages ? { initialMessages: options.initialMessages } : {}),
				}))
		if (result.status === "superseded") {
			return undefined
		}
		const { startResult, sdkHost } = result
		this.setRunning(false)

		return { oldSessionId, startResult, sdkHost }
	}

	async restoreActiveSession(input: RestoreInput): Promise<RestoreResult> {
		const activeSession = this.activeSession
		if (!activeSession) {
			throw new Error("No active SDK session to restore")
		}

		const sourceSessionId = activeSession.sessionId
		const restored = await activeSession.sdkHost.restore(input)
		if (!restored.startResult || !restored.sessionId) {
			return restored
		}

		this.activeSession = {
			...activeSession,
			sessionId: restored.sessionId,
			startConfig: input.start?.config
				? {
						providerId: input.start.config.providerId,
						modelId: input.start.config.modelId,
					}
				: activeSession.startConfig,
			startResult: restored.startResult,
			isRunning: false,
		}

		if (restored.sessionId !== sourceSessionId) {
			const stopPromise = this.trackSessionStop(activeSession.sdkHost, sourceSessionId, "restoreActiveSession")
			stopPromise.catch((error) => {
				Logger.warn(`[SdkController] Failed to stop source session after checkpoint restore: ${sourceSessionId}`, error)
			})
		}

		return restored
	}

	async dispose(reason = "SdkSessionLifecycle.dispose"): Promise<void> {
		await this.endActiveSession(reason, { awaitStop: true })

		const sharedHost = this.sharedHost ?? (await this.sharedHostPromise?.catch(() => undefined))
		this.sharedHost = undefined
		this.sharedHostPromise = undefined
		this.sharedHostUnsubscribe?.()
		this.sharedHostUnsubscribe = undefined
		await sharedHost?.dispose(reason)
	}

	private createSafeUnsubscribe(unsubscribe: () => void, label: string): () => void {
		let unsubscribed = false
		return () => {
			if (unsubscribed) {
				return
			}
			unsubscribed = true
			try {
				unsubscribe()
			} catch (error) {
				Logger.warn(`[SdkController] Failed to unsubscribe SDK session listener (${label}):`, error)
			}
		}
	}

	private safeUnsubscribe(activeSession: ActiveSession, reason: string): void {
		activeSession.unsubscribe()
		Logger.debug(`[SdkController] Unsubscribed SDK session listener: ${activeSession.sessionId} (${reason})`)
	}

	private ensureSharedHostSubscription(sdkHost: SdkSessionHost): void {
		if (this.sharedHostUnsubscribe) {
			return
		}
		const userHandler = this.options.onSessionEvent
		const toolHandler = this.options.onToolStarted
		const handler = toolHandler
			? (event: CoreSessionEvent) => {
					userHandler(event)
					if (event.type === "agent_event") {
						const agentEvent = event.payload.event
						if (agentEvent.type === "content_start" && agentEvent.contentType === "tool") {
							toolHandler(agentEvent as import("@cline/shared").AgentContentStartEvent)
						}
					}
				}
			: userHandler
		this.sharedHostUnsubscribe = this.createSafeUnsubscribe(sdkHost.subscribe(handler), "shared-host")
	}

	/**
	 * Starts the session's stop and records it in pendingStops until it
	 * settles. The returned promise never rejects.
	 */
	private trackSessionStop(sdkHost: SdkSessionHost, sessionId: string, reason: string): Promise<void> {
		const startedAt = Date.now()
		const stopPromise = sdkHost
			.stop(sessionId)
			.then(() => {
				const elapsed = Date.now() - startedAt
				if (elapsed > 250) {
					Logger.log(`[SdkController] SDK session ${sessionId} stopped in ${elapsed}ms (${reason})`)
				}
			})
			.catch((error: unknown) => {
				Logger.warn(`[SdkController] Failed to stop SDK session ${sessionId} (${reason}):`, error)
			})
			.finally(() => {
				if (this.pendingStops.get(sessionId) === stopPromise) {
					this.pendingStops.delete(sessionId)
				}
			})
		this.pendingStops.set(sessionId, stopPromise)
		return stopPromise
	}

	private async waitForStop(stopPromise: Promise<void>, timeoutMs: number): Promise<boolean> {
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined
		try {
			const timeout = new Promise<"timeout">((resolve) => {
				timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs)
			})
			const result = await Promise.race([stopPromise.then(() => "stopped" as const), timeout])
			return result === "stopped"
		} finally {
			clearTimeout(timeoutHandle)
		}
	}

	private async getOrCreateSharedHost(): Promise<SdkSessionHost> {
		if (this.sharedHost) {
			this.ensureSharedHostSubscription(this.sharedHost)
			return this.sharedHost
		}
		if (!this.sharedHostPromise) {
			// Host-lifetime dependencies only. Anything task/session-specific must be
			// supplied to sdkHost.start(...), otherwise it can leak across reused sessions.
			this.sharedHostPromise = VscodeSessionHost.create({
				mcpHub: this.options.mcpHub,
				requestToolApproval: this.options.requestToolApproval,
				askQuestion: this.options.askQuestion,
				editorExecutor: this.options.editorExecutor,
				applyPatchExecutor: this.options.applyPatchExecutor,
				readFileExecutor: this.options.readFileExecutor,
				getTerminalManager: this.options.getTerminalManager,
				foregroundCommands: this.options.foregroundCommands,
				getRemoteConfigIntegration: this.options.getRemoteConfigIntegration,
				telemetry: this.options.telemetry,
				// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: pass-through to the
				// host so the run_commands tool can flip the projection when
				// it returns RUNNING / reaches a terminal state.
				onBackgroundStateChange: this.options.onBackgroundStateChange,
				// ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01:
				// forward the setting-driven capability source to the
				// shared VscodeSessionHost. Without this, every live
				// primary-session and resume-from-history command build
				// receives safeYoloCapabilitySource=undefined inside the
				// CommandJobManager and falls through to the env-only
				// network path — yielding network="deny" regardless of
				// the persisted clinemmSafeYoloAllowNetwork=true.
				safeYoloCapabilitySource: this.options.safeYoloCapabilitySource,
			})
				.then((sdkHost) => {
					this.ensureSharedHostSubscription(sdkHost)
					this.sharedHost = sdkHost
					return sdkHost
				})
				.finally(() => {
					this.sharedHostPromise = undefined
				})
		}
		return this.sharedHostPromise
	}

	fireAndForgetSend(
		sdkHost: SdkSessionHost,
		sessionId: string,
		prompt: string,
		images?: string[],
		files?: string[],
		delivery?: "queue" | "steer",
	): void {
		// Captured by object identity, not sessionId: rebuilds (mode change) reuse
		// the same sessionId for the replacement session, so only reference
		// equality can tell this send's session apart from a successor. If the
		// session was replaced by the time the send settles, the settle callbacks
		// must not run bookkeeping against the successor (e.g. flipping a live
		// auto-continued run to isRunning=false, which makes the event coordinator
		// treat the new turn's completion as a cancelled-turn straggler).
		const sessionAtSend = this.activeSession
		const isSuperseded = (label: string): boolean => {
			if (this.activeSession === sessionAtSend) {
				return false
			}
			Logger.debug(`[SdkController] Ignoring ${label} of superseded send for session: ${sessionId}`)
			return true
		}
		// Mark a preceding user-initiated mode switch on this message so the model
		// sees exactly when the rules changed, instead of only inferring it from
		// the user_input mode attribute flipping (mirrors the CLI's
		// run-interactive stamping). The notice survives prepareTurnInput's
		// normalizeUserInput sanitize and is hidden from display surfaces by
		// stripModeNotices.
		const notice = this.options.consumeModeSwitchNotice?.(sessionId)
		const noticedPrompt = notice ? `${formatModeSwitchNotice(notice.from, notice.to)}\n${prompt}` : prompt
		this.options.onSendStart?.(sessionId)
		sdkHost
			.send({
				sessionId,
				prompt: noticedPrompt,
				userImages: images,
				userFiles: files,
				delivery,
			})
			.then(async () => {
				if (delivery === "queue" || delivery === "steer") {
					Logger.log(`[SdkController] Message queued for session: ${sessionId}`)
					return
				}
				if (isSuperseded("completion")) {
					return
				}
				Logger.log(`[SdkController] Agent turn completed for session: ${sessionId}`)
				this.setRunning(false)
				await this.options.onSendComplete(sessionId)
			})
			.catch(async (error: unknown) => {
				if (isAbortError(error)) {
					Logger.debug(`[SdkController] Agent turn aborted (expected): ${sessionId}`)
					return
				}
				if (isSuperseded("failure")) {
					return
				}
				Logger.error("[SdkController] Agent turn failed:", error)
				this.setRunning(false)
				await this.options.onSendError(error, sessionId)
			})
	}
}

export function isAbortError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError" || error.message.toLowerCase().includes("aborted")
	}
	return false
}
