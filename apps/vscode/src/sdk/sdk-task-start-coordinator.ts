import { getProviderAuthStorageId } from "@cline/core"
import { createSessionId } from "@cline/shared"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "@shared/ClineAccount"
import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { TurnStateWriterId } from "@shared/turn-state-writer-provenance"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { isDirectory } from "@/utils/fs"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE, type ProviderFailureTelemetry } from "./provider-failure-telemetry"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import { historyItemToSessionMetadata, type SdkTaskHistory } from "./sdk-task-history"
import type { SdkSessionHost } from "./session-host"
import { TaskOperationFence } from "./task-operation-fence"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

function usesClineAccountAuth(providerId: string): boolean {
	return getProviderAuthStorageId(providerId) === "cline"
}

export interface SdkTaskStartCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	sessionConfigBuilder: SdkSessionConfigBuilder
	/**
	 * ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: shared task-operation
	 * generation authority. The coordinator calls `fence.begin()` at
	 * the top of `initTask` and `reinitExistingTaskFromId` to capture
	 * the user's intent token, then checks `fence.isCurrent(token)`
	 * after each awaited boundary before committing shared state.
	 */
	taskOperationFence: TaskOperationFence
	buildStartSessionInput: (
		config: SessionConfig,
		input: {
			prompt?: string
			images?: string[]
			files?: string[]
			historyItem?: HistoryItem
			taskSettings?: Partial<Settings>
			cwd: string
			mode: Mode
		},
	) => StartInput
	createHistoryItemFromSession: (sessionId: string, prompt: string, modelId?: string, cwd?: string) => HistoryItem
	clearTask: () => Promise<void>
	/**
	 * ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: internal clearTask that
	 * runs under the operation's existing token WITHOUT advancing the
	 * fence. The wiring MUST provide this — see the explanation at
	 * the top of `initTask`.
	 */
	clearTaskForOperation: (token: number) => Promise<void>
	setTask: (task: TaskProxy | undefined) => void
	onAskResponse: (text?: string, images?: string[], files?: string[]) => Promise<void>
	onCancelTask: () => Promise<void>
	getWorkspaceRoot: () => Promise<string>
	createTempSessionHost: () => Promise<SdkSessionHost>
	loadInitialMessages: (reader: SdkSessionHost, taskId: string) => Promise<unknown[] | undefined>
	resolveContextMentions: (text: string) => Promise<string>
	isClineManagedProviderActive: () => boolean
	emitClineAuthError: (task?: string) => void
	captureProviderApiError?: (event: ProviderFailureTelemetry) => void
	postStateToWebview: () => Promise<void>
	/**
	 * Assert the authoritative UI turn phase at the lifecycle boundary.
	 *
	 * ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION03: this option is
	 * REQUIRED. The coordinator is the sole writer of the new-task /
	 * resume → streaming transition. Allowing `undefined` here would
	 * silently downgrade a wiring defect into a stale-state runtime
	 * mode — the runtime would keep running, but the webview's header
	 * would stay at the previous phase forever. TypeScript must enforce
	 * that every real constructor supplies the authority, so a missing
	 * `setTurnPhase` is a construction error, not a runtime fallback.
	 */
	setTurnPhase: (phase: TurnPhase, anchorTs?: number, writerId?: TurnStateWriterId) => void
}

export class SdkTaskStartCoordinator {
	constructor(private readonly options: SdkTaskStartCoordinatorOptions) {}

	async initTask(
		prompt?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
	): Promise<string | undefined> {
		Logger.log(`[SdkController] initTask called: "${prompt?.substring(0, 50)}"`)
		// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: capture the originating
		// task-operation token at entry. The internal `clearTask()` below
		// inherits this token (via `clearTaskForOperation`); only the
		// top-level user intent advances the fence.
		const operationToken = this.options.taskOperationFence.begin()
		const isCurrent = () => this.options.taskOperationFence.isCurrent(operationToken)
		let taskSessionId: string | undefined
		let providerId: string | undefined
		let modelId: string | undefined
		try {
			// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: clear under the
			// SAME token we just allocated for this operation. A naive
			// `this.options.clearTask()` would advance the fence and
			// self-supersede initTask; the `clearTaskForOperation`
			// wiring performs the same teardown without advancing.
			await this.options.clearTaskForOperation(operationToken)

			const cwd = await this.options.getWorkspaceRoot()
			const mode = this.getCurrentMode()
			Logger.log(`[SdkController] Building session config: mode=${mode}, cwd=${cwd}`)
			const config = await this.options.sessionConfigBuilder.build({
				prompt,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})
			providerId = config.providerId
			modelId = config.modelId

			Logger.log(
				`[SdkController] Session config: provider=${config.providerId}, model=${config.modelId}, hasApiKey=${!!config.apiKey}`,
			)

			if (usesClineAccountAuth(config.providerId) && !config.apiKey) {
				Logger.warn(
					`[SdkController] ${config.providerId} provider selected but no Cline auth token — emitting auth error`,
				)
				// No task/session id exists yet, so this preflight auth UI path is
				// intentionally not recorded as task-joinable provider error telemetry.
				this.options.emitClineAuthError(prompt)
				return undefined
			}

			taskSessionId = config.sessionId?.trim() || createSessionId()
			const configWithSessionId = {
				...config,
				sessionId: taskSessionId,
			}

			const startInput = this.options.buildStartSessionInput(configWithSessionId, {
				prompt: prompt,
				images,
				files,
				historyItem,
				taskSettings,
				cwd,
				mode,
			})

			// FENCE: refuse to install TaskProxy B if a newer intent has
			// superseded this operation while we awaited config/build.
			if (!isCurrent()) {
				Logger.debug(
					`[SdkController] initTask: abandoning before createAndSetTask; operationToken=${operationToken} superseded`,
				)
				return undefined
			}

			const task = this.createAndSetTask(taskSessionId)
			this.emitInitialTaskMessage(taskSessionId, prompt ?? "", images, files)

			// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION01: ship a state
			// post so the webview sees the initial task message immediately
			// while `startNewSession` resolves in parallel below. The
			// authoritative `streaming` turn-phase is asserted right after
			// `startNewSession` returns (below) — not here, because at
			// THIS point the previous task's `clearTask()` has already
			// stamped `idle`, and posting here would just confirm that
			// idle state. Posting here is still useful to seed the
			// task message into the webview's transcript; the phase is
			// pinned on the next post, once the session is running.
			this.options.postStateToWebview().catch((error) => {
				Logger.error("[SdkController] Failed to post state after emitting initial task message:", error)
			})

			const startResultEnvelope = await this.options.sessions.startNewSession(startInput, operationToken)

			// FENCE: this is the load-bearing check. If a newer intent
			// advanced the fence while host.start awaited, the lifecycle
			// has already disposed the just-started session and returned
			// "superseded". We MUST NOT call setTurnPhase, MUST NOT
			// install TaskProxy (already installed above; the newer
			// intent owns it now), MUST NOT fireAndForgetSend. Critically:
			// we MUST NOT call setTask(undefined) — that would erase the
			// newer TaskProxy installed by the superseding operation.
			if (startResultEnvelope.status === "superseded") {
				Logger.debug(
					`[SdkController] initTask: post-start supersession; abandoning without mutating shared state; operationToken=${operationToken}`,
				)
				// Clean up only resources this operation uniquely owns.
				// Do NOT touch shared task/session state — the superseding
				// operation is the new authority.
				return undefined
			}
			const { startResult, sdkHost } = startResultEnvelope
			if (startResult.sessionId !== taskSessionId) {
				Logger.warn(
					`[SdkController] SDK returned session id ${startResult.sessionId} after requested id ${taskSessionId}`,
				)
				task.taskId = startResult.sessionId
				taskSessionId = startResult.sessionId
			}

			// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION03: this is the
			// CANONICAL authority for the new-task → streaming transition.
			// Sole writer — `SdkController.initTask` no longer re-asserts
			// streaming after this returns. Asserting it HERE (after the
			// inner `clearTask()` ran and after `startNewSession`
			// resolves) guarantees:
			//
			//   1. The header's streaming indicator reaches the webview
			//      AFTER the seed post — the initial task message lands
			//      first, then the phase flips to streaming.
			//   2. The new session is actually running before we claim
			//      "streaming" — the deferred-promise test in
			//      `sdk-task-start-coordinator.test.ts` pins this by
			//      blocking `startNewSession` on a manual resolver and
			//      asserting `setTurnPhase` is NOT called until the
			//      session promise resolves.
			//   3. One logical new-task lifecycle produces exactly ONE
			//      streaming transition. Nothing else writes it.
			//   4. The setTurnPhase option is REQUIRED (not optional) —
			//      see `SdkTaskStartCoordinatorOptions.setTurnPhase`.
			//      TypeScript enforces that every constructor supplies
			//      the authority.
			//   5. A subsequent `postStateToWebview()` follows below so
			//      the webview observes the streaming phase. The order
			//      is asserted by CORRECTION03-1.
			this.options.setTurnPhase("streaming", undefined, "task-start-init-task")

			const newHistoryItem = this.options.createHistoryItemFromSession(
				taskSessionId,
				prompt ?? "",
				configWithSessionId.modelId,
				cwd,
			)
			await this.options.taskHistory.updateTaskHistoryItem(newHistoryItem)
			await this.options.postStateToWebview()

			if (prompt?.trim() || images?.length || files?.length) {
				Logger.log(`[SdkController] Sending prompt to session: ${taskSessionId}`)
				const resolvedTask = await this.options.resolveContextMentions(prompt || "")
				this.options.sessions.fireAndForgetSend(sdkHost, taskSessionId, resolvedTask, images, files)
			}

			Logger.log(`[SdkController] Task initialized: ${taskSessionId}`)
			return taskSessionId
		} catch (error) {
			this.options.captureProviderApiError?.({
				sessionId: taskSessionId,
				error,
				providerId,
				modelId,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.TASK_INIT,
				failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
			})
			this.handleInitError(error, taskSessionId)
			await this.options.postStateToWebview().catch((postError) => {
				Logger.error("[SdkController] Failed to post state after init error:", postError)
			})
			return undefined
		}
	}

	async reinitExistingTaskFromId(taskId: string): Promise<void> {
		// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: capture the originating
		// task-operation token at entry; internal `clearTask()` inherits it.
		const operationToken = this.options.taskOperationFence.begin()
		try {
			await this.options.clearTaskForOperation(operationToken)

			const historyItem = await this.options.taskHistory.findHistoryItem(taskId)
			if (!historyItem) {
				Logger.error(`[SdkController] Task not found in history: ${taskId}`)
				return
			}

			// A task's stored cwd may have been deleted/moved since the task ran
			// (or migrated from another machine) — feeding a stale path into the
			// session bootstrap makes workspace init fail. Fall back to the live
			// workspace root instead.
			const storedCwd = historyItem.cwdOnTaskInitialization
			const cwd = storedCwd && (await isDirectory(storedCwd)) ? storedCwd : await this.options.getWorkspaceRoot()
			const config = await this.options.sessionConfigBuilder.build({
				cwd,
				mode: "act",
			})

			const tempManager = await this.options.createTempSessionHost()
			const initialMessages = await this.options.loadInitialMessages(tempManager, taskId)
			await tempManager.dispose("readMessages")

			// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: pre-start
			// fence check. The lifecycle will re-check internally, but
			// defense-in-depth at the task-start coordinator prevents
			// the lifecycle's pre-endActiveSession fence from being
			// the only barrier against stale operations terminating a
			// newer session.
			if (!this.options.taskOperationFence.isCurrent(operationToken)) {
				Logger.debug(
					`[SdkController] reinitExistingTaskFromId: pre-start supersession; abandoning; operationToken=${operationToken}`,
				)
				return
			}

			const startResultEnvelope = await this.options.sessions.startNewSession(
				{
					config,
					interactive: true,
					...(initialMessages ? { initialMessages: initialMessages as InitialMessages } : {}),
					sessionMetadata: historyItemToSessionMetadata(historyItem, config.modelId),
				},
				operationToken,
			)

			// FENCE: post-start supersession — abandon without mutating
			// shared state. The newer intent (if any) owns the result.
			if (startResultEnvelope.status === "superseded") {
				Logger.debug(
					`[SdkController] reinitExistingTaskFromId: post-start supersession; abandoning; operationToken=${operationToken}`,
				)
				return
			}
			const { startResult } = startResultEnvelope

			// Pre-install fence check before mutating shared task state.
			if (!this.options.taskOperationFence.isCurrent(operationToken)) {
				Logger.debug(
					`[SdkController] reinitExistingTaskFromId: pre-install supersession; abandoning; operationToken=${operationToken}`,
				)
				return
			}

			this.createAndSetTask(startResult.sessionId)
			// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION03: same canonical
			// ownership as `initTask`. The resumed session is now running
			// after `startNewSession` resolved — assert "streaming" at the
			// boundary so the header is never left at Idle while the agent
			// streams. Sole writer; nothing else touches it. The
			// `postStateToWebview` immediately below delivers the streaming
			// phase to the webview (the resume path makes this ordering
			// explicit; the new-task path's identical ordering is asserted
			// by CORRECTION03-1).
			this.options.setTurnPhase("streaming", undefined, "task-start-reinit-existing-task")
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Task resumed: ${taskId} → ${startResult.sessionId}`)
		} catch (error) {
			this.handleReinitError(taskId, error)
		}
	}

	private getCurrentMode(): Mode {
		const m = this.options.stateManager.getGlobalSettingsKey("mode")
		return m === "plan" ? m : "act"
	}

	private createAndSetTask(sessionId: string): TaskProxy {
		const task = createTaskProxy(
			sessionId,
			(text?: string, images?: string[], files?: string[]) => this.options.onAskResponse(text, images, files),
			() => this.options.onCancelTask(),
		)
		this.options.setTask(task)
		return task
	}

	private emitInitialTaskMessage(sessionId: string, task: string, images?: string[], files?: string[]): void {
		// Attachments must ride on the authoritative task message: the webview's
		// optimistic pending copy is only cleared once an identical message (text
		// AND images/files) arrives from the extension. Omitting them left the
		// optimistic message unconfirmed forever, so it was re-injected into the
		// transcript even after "New Task" cleared it (#12924).
		const taskMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "task",
			text: task,
			...(images?.length ? { images } : {}),
			...(files?.length ? { files } : {}),
			partial: false,
		}
		this.options.messages.appendAndEmit([taskMessage], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
	}

	private handleInitError(error: unknown, sessionId?: string): void {
		const errorDetails =
			error instanceof Error ? `${error.name}: ${error.message}\n${error.stack?.substring(0, 500)}` : String(error)
		Logger.error(`[SdkController] Failed to init task: ${errorDetails}`)
		;(globalThis as Record<string, unknown>).__cline_last_init_error = errorDetails
		;(globalThis as Record<string, unknown>).__cline_last_init_error_raw = error
		this.options.messages.appendAndEmit(
			[
				{
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `Failed to start task: ${error instanceof Error ? error.message : String(error)}`,
					partial: false,
				},
			],
			{ type: "status", payload: { sessionId: sessionId ?? "", status: "error" } },
		)
	}

	private handleReinitError(taskId: string, error: unknown): void {
		Logger.error("[SdkController] Failed to reinit task:", error)

		const reinitErrorMsg = error instanceof Error ? error.message : String(error)
		const isClineAuthReinit =
			this.options.isClineManagedProviderActive() &&
			(reinitErrorMsg.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE) ||
				reinitErrorMsg.toLowerCase().includes("missing api key") ||
				reinitErrorMsg.toLowerCase().includes("unauthorized"))

		if (isClineAuthReinit) {
			this.options.emitClineAuthError()
			return
		}

		this.options.messages.emitSessionEvents(
			[
				{
					ts: Date.now(),
					type: "say",
					say: "error",
					text: `Failed to resume task: ${reinitErrorMsg}`,
					partial: false,
				},
			],
			{ type: "status", payload: { sessionId: taskId, status: "error" } },
		)
	}
}
