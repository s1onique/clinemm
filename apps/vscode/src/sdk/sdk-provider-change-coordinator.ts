import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkSessionHost } from "./session-host"
import type { TaskProxy } from "./task-proxy"
import type { VscodeSessionHost } from "./vscode-session-host"

type StartInput = Parameters<VscodeSessionHost["start"]>[0]
type InitialMessages = StartInput["initialMessages"]
type SessionConfig = Awaited<ReturnType<SdkSessionConfigBuilder["build"]>>

export interface SdkProviderChangeCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	sessionConfigBuilder: SdkSessionConfigBuilder
	getTask: () => TaskProxy | undefined
	getWorkspaceRoot: () => Promise<string>
	loadInitialMessages: (sdkHost: SdkSessionHost, sessionId: string) => Promise<InitialMessages>
	buildStartSessionInput: (config: SessionConfig, input: { cwd: string; mode: Mode }) => StartInput
	postStateToWebview: () => Promise<void>
	rebuilds: Pick<SdkSessionRebuildScheduler, "request">
}

function providerForMode(config: ApiConfiguration, mode: Mode): string | undefined {
	const provider = mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
	// Compare canonical spellings: previously-persisted snapshots can still
	// hold SDK ids like `openai-compatible` while new writes use the legacy
	// `openai` spelling; a spelling-only difference must not be treated as a
	// provider switch (it would restart the active session for nothing).
	return provider === undefined ? undefined : toLegacyApiProvider(provider)
}

export class SdkProviderChangeCoordinator {
	constructor(private readonly options: SdkProviderChangeCoordinatorOptions) {}

	/**
	 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 / PIIF01
	 * (ninety-seventh pass, R2 GREEN contract with binding):
	 *
	 * Explicit instance-apply seam. Routes A → B through full
	 * session reconstruction (Strategy B), independent of the
	 * providerId-only discriminator that gates
	 * `handleApiConfigurationChanged`.
	 *
	 *   - Idle-gated: refuses to apply while a turn is in flight
	 *     (the session is "running"); callers must wait for the
	 *     next idle or cancel the running turn.
	 *   - Full reconstruction with instance-bound input: calls
	 *     `this.options.sessionConfigBuilder.build({ cwd, mode,
	 *     providerConfigurationInstance: next })` so the resolved
	 *     `CoreSessionConfig` reflects B's identity/connection
	 *     fields (providerId / modelId / apiKey / baseUrl /
	 *     headers) regardless of what the StateManager currently
	 *     holds. The rebuilt session then captures B via
	 *     `replaceActiveSession(...)` →
	 *     `LocalRuntimeHost.startSession(...)`.
	 *   - No persistence: this probe does NOT touch instances.json,
	 *     the secret store, or any new global state. It is a
	 *     bounded minimum probe ahead of the Foundation's durable
	 *     persistence layer.
	 *   - Same-instance / model-only fast path conservation: a
	 *     caller that wants to swap only the modelId should use the
	 *     existing `SdkSessionLifecycle.updateActiveSessionModel`
	 *     → `sdkHost.updateSessionModel` path, which the
	 *     conservation test
	 *     `sdk-session-lifecycle.test.ts:544-556` already exercises.
	 *     This probe is for explicit provider-instance APPLY, not
	 *     for model-only mutations.
	 *
	 * Returns:
	 *   - `{ applied: true, newSessionId }` on success
	 *   - `{ applied: false, reason: "no_active_session" }` if no
	 *     active session exists (caller is expected to start a new
	 *     one with B's config)
	 *   - `{ applied: false, reason: "session_running" }` if the
	 *     active session is mid-turn (caller must wait)
	 *   - `{ applied: false, reason: "reconstruction_failed" }` if
	 *     the underlying `replaceActiveSession` returned undefined
	 *     (e.g. concurrent supersession) or `build` threw
	 */
	async applyProviderConfigurationInstance(
		_previous: ApiConfiguration,
		next: ApiConfiguration,
	): Promise<
		| { applied: true; newSessionId: string }
		| { applied: false; reason: "no_active_session" | "session_running" | "reconstruction_failed" }
	> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log(
				"[SdkController] applyProviderConfigurationInstance: no active session; caller must start a new session with the new config",
			)
			return { applied: false, reason: "no_active_session" }
		}

		if (activeSession.isRunning) {
			Logger.warn(
				"[SdkController] applyProviderConfigurationInstance: active session is running; refusing to destructively replace mid-turn",
			)
			return { applied: false, reason: "session_running" }
		}

		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()

		try {
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 (R2
			// GREEN contract, ninth reviewer reopen): pass `next` as
			// `providerConfigurationInstance` so the builder projects
			// B's identity/connection onto the resolved config —
			// this is what makes `next` load-bearing on the
			// reconstructed session. Without this, the builder would
			// resolve from StateManager and the GREEN contract would
			// silently degrade to "whatever the StateManager says".
			const config = await this.options.sessionConfigBuilder.build({
				cwd,
				mode,
				providerConfigurationInstance: next,
			})
			config.sessionId = activeSession.sessionId

			const initialMessages = await this.options.loadInitialMessages(activeSession.sdkHost, activeSession.sessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				...(initialMessages ? { initialMessages } : {}),
				disposeReason: "providerInstanceApply",
			})
			if (!restartResult) {
				return { applied: false, reason: "reconstruction_failed" }
			}

			const { startResult } = restartResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				task.taskId = startResult.sessionId
			}

			await this.options.postStateToWebview()
			Logger.log(
				`[SdkController] Applied provider-instance config; session reconstructed: ${activeSession.sessionId} -> ${startResult.sessionId}`,
			)
			return { applied: true, newSessionId: startResult.sessionId }
		} catch (error) {
			Logger.error("[SdkController] applyProviderConfigurationInstance failed:", error)
			this.options.messages.appendAndEmit(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to apply provider-instance configuration: ${
							error instanceof Error ? error.message : String(error)
						}. The active session may still use the previous configuration.`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: activeSession.sessionId, status: "error" } },
			)
			await this.options.postStateToWebview()
			return { applied: false, reason: "reconstruction_failed" }
		}
	}

	handleApiConfigurationChanged(previous: ApiConfiguration, next: ApiConfiguration): void {
		const mode = this.getCurrentMode()
		const previousProvider = providerForMode(previous, mode)
		const nextProvider = providerForMode(next, mode)

		if (previousProvider === nextProvider) {
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			Logger.log("[SdkController] Provider changed without active session; next task will use new provider")
			return
		}

		Logger.log(
			`[SdkController] Active provider changed for ${mode}: ${previousProvider ?? "none"} -> ${nextProvider ?? "none"}`,
		)

		this.options.rebuilds.request("provider", () => this.restartActiveSessionForProviderChange())
	}

	async restartActiveSessionForProviderChange(): Promise<void> {
		await this.performRestartActiveSessionForProviderChange()
	}

	private async performRestartActiveSessionForProviderChange(): Promise<void> {
		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession) {
			return
		}

		const { sdkHost: oldManager, sessionId: oldSessionId } = activeSession
		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()

		Logger.log(`[SdkController] Restarting session ${oldSessionId} for provider change`)

		try {
			const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
			config.sessionId = oldSessionId

			const initialMessages = await this.options.loadInitialMessages(oldManager, oldSessionId)
			const startInput = this.options.buildStartSessionInput(config, { cwd, mode })
			const restartResult = await this.options.sessions.replaceActiveSession({
				expectedSession: activeSession,
				startInput,
				...(initialMessages ? { initialMessages } : {}),
				disposeReason: "providerChange",
			})
			if (!restartResult) {
				return
			}

			const { startResult } = restartResult
			const task = this.options.getTask()
			if (task && task.taskId !== startResult.sessionId) {
				Logger.warn(
					`[SdkController] Provider restart returned a new session ID (${startResult.sessionId}); updating task proxy`,
				)
				task.taskId = startResult.sessionId
			}

			await this.options.postStateToWebview()
			Logger.log(`[SdkController] Session restarted for provider change: ${oldSessionId} -> ${startResult.sessionId}`)
		} catch (error) {
			Logger.error("[SdkController] Failed to restart session for provider change:", error)
			this.options.messages.appendAndEmit(
				[
					{
						ts: Date.now(),
						type: "say",
						say: "error",
						text: `Failed to reload provider configuration: ${
							error instanceof Error ? error.message : String(error)
						}. The active session may still use the previous provider.`,
						partial: false,
					},
				],
				{ type: "status", payload: { sessionId: oldSessionId, status: "error" } },
			)
			await this.options.postStateToWebview()
		}
	}

	private getCurrentMode(): Mode {
		return this.options.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
	}
}
