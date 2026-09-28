// Bridges Cline's file-based hook scripts into the SDK's runtime hooks.
//
// Runtime hooks use typed in-process lifecycle callbacks:
//   TaskStart        -> beforeRun
//   UserPromptSubmit -> beforeRun with the latest submitted user message
//   PreToolUse       -> beforeTool
//   PostToolUse      -> afterTool
//   TaskComplete     -> afterRun when completed
//   TaskCancel       -> afterRun when aborted
//   beforeModel      -> inject the session-start prime packet (ACT-MYC-CLINEMM02-C-CORRECTION01; identity join fixed in CORRECTION02)
//
// Deferred hooks (NOT wired here): TaskResume, TaskError, SessionShutdown,
// PreCompact, Notification.

import type {
	AgentAfterToolContext,
	AgentBeforeModelContext,
	AgentBeforeToolContext,
	AgentHooks,
	AgentRunLifecycleContext,
	AgentStopControl,
} from "@cline/shared"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"
import { HookFactory } from "@/core/hooks/hook-factory"
import { getHooksEnabledSafe } from "@/core/hooks/hooks-utils"
import type { StateManager } from "@/core/storage/StateManager"
import { getMycPrimeResult } from "./myc-prime-automation"
import {
	isMycPrimeLiveDiagEnabled,
	recordMycPrimeLiveBind,
	recordMycPrimeLiveCapture,
	recordMycPrimeLiveEnter,
	recordMycPrimeLiveInjection,
	recordMycPrimeLiveLookup,
} from "./myc-prime-live-diag"

// Per-session flag: once we have injected the prime for a given sessionId
// at iteration 1, subsequent iterations MUST NOT re-inject (the runtime
// has already seen the text and would treat a second injection as
// duplicate context). The Map is keyed by the canonical HOST sessionId
// (snapshot.sessionId — the same key as `runMycPrimeOnSessionStart`'s
// recorder key, which is keyed by `startResult.sessionId` ==
// `CoreSessionConfig.sessionId` in production). Cleared per session via
// `clearPrimeInjectionStateForSession` so it cannot grow unbounded across
// long-running hosts.
const primeInjectedSessionIds = new Map<string, true>()

/**
 * Drop the per-session injection flag for a single host session id.
 * Called by `SdkSessionLifecycle.endActiveSession` when a session is
 * torn down (new install or replace), so the bounded Map stays at most
 * ONE entry per active session — NOT an unbounded growth set across
 * the host's lifetime.
 *
 * Missing entries are a no-op (idempotent). Safe to call on already-
 * cleared ids.
 */
export function clearPrimeInjectionStateForSession(sessionId: string): void {
	primeInjectedSessionIds.delete(sessionId)
}

/**
 * Test-only: clear the per-session injection tracker entirely. The
 * RED/GREEN witnesses for ACT-MYC-CLINEMM02-C-CORRECTION0{1,2} call this
 * in beforeEach so each test starts with a clean injection state. NOT
 * for production use.
 */
export function __resetPrimeInjectionStateForTests(): void {
	primeInjectedSessionIds.clear()
}

export type HookMessageEmitter = (message: ClineMessage) => void

function toStringRecord(input: unknown): Record<string, string> {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		return {}
	}
	const result: Record<string, string> = {}
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		result[key] = typeof value === "string" ? value : JSON.stringify(value)
	}
	return result
}

function mapStopControl(hookOutput: {
	cancel?: boolean
	errorMessage?: string
	contextModification?: string
}): AgentStopControl | undefined {
	if (!hookOutput.cancel) {
		return undefined
	}
	// A cancelling hook's contextModification is never injected as context;
	// it serves as the fallback explanation when no errorMessage was given.
	const reason = hookOutput.errorMessage?.trim() || hookOutput.contextModification?.trim() || undefined
	return {
		stop: true,
		reason,
	}
}

function taskIdFromSnapshot(snapshot: AgentRunLifecycleContext["snapshot"]): string {
	return snapshot.conversationId ?? snapshot.runId ?? snapshot.agentId
}

function textFromMessageContent(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("")
}

function latestUserPrompt(ctx: AgentRunLifecycleContext): string {
	for (let index = ctx.snapshot.messages.length - 1; index >= 0; index -= 1) {
		const message = ctx.snapshot.messages[index]
		if (message?.role === "user") {
			return textFromMessageContent(message.content)
		}
	}
	return ""
}

function buildHookStatusMessage(opts: {
	hookName: string
	status: "running" | "completed" | "failed" | "cancelled"
	toolName?: string
	ts?: number
}): ClineMessage {
	return {
		ts: opts.ts ?? Date.now(),
		type: "say",
		say: "hook_status",
		text: JSON.stringify({
			hookName: opts.hookName,
			...(opts.toolName && { toolName: opts.toolName }),
			status: opts.status,
		}),
		partial: false,
	}
}

export function buildAgentHooks(
	stateManager: StateManager,
	emitHookMessage?: HookMessageEmitter,
	sessionWorkspaceRoot?: string,
	/**
	 * ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: optional
	 * canonical host sessionId. When provided AND the live diagnostic is
	 * enabled, the BIND observation is recorded against this id so a
	 * post-capture join can compare it against the operator's captured
	 * MYC_SESSION_ID and against the later `enter.sessionId` from
	 * `beforeModel`. When omitted (or diagnostics disabled), the
	 * observation is a no-op — zero state writes, zero log lines, zero
	 * request mutations. Production callers in
	 * `sdk-session-config-builder.ts` pass `config.sessionId`.
	 */
	bindSessionId?: string,
): AgentHooks {
	const hooksEnabled = () => getHooksEnabledSafe(stateManager.getGlobalSettingsKey("hooksEnabled"))
	// Session-scoped discovery: the session's root is not always among the
	// window's workspace folders (e.g. the chat-workspace fallback when no
	// folder is open), so the factory also scans this session's own workspace.
	const createFactory = () => new HookFactory({ sessionWorkspaceRoot })

	// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01: fire the
	// BIND observation up-front so a missing BIND event in the captured
	// trace is unambiguous evidence of "the runtime was never given a
	// hook bag" (Case A), not "the bag was built but never invoked".
	if (bindSessionId) {
		recordMycPrimeLiveBind(bindSessionId)
	}

	return {
		async beforeRun(ctx: AgentRunLifecycleContext): Promise<AgentStopControl | undefined> {
			const taskStartControl = await runTaskStart(ctx, hooksEnabled, createFactory, emitHookMessage)
			if (taskStartControl) {
				return taskStartControl
			}
			return runUserPromptSubmit(ctx, hooksEnabled, createFactory, emitHookMessage)
		},

		// ACT-MYC-CLINEMM02-C-CORRECTION01: inject the session-start
		// `myc prime` packet into the FIRST model request so the agent
		// has model-visible memory of the prime. Subsequent iterations
		// must NOT re-inject (the prime text is already part of the
		// conversation history after iteration 1). The singleton is
		// populated by `SdkSessionLifecycle.startNewSession`'s awaited
		// `onMycPrimeRequested` callback BEFORE the lifecycle returns
		// `started` — so this hook always finds a recorded result by
		// the time the first model request fires.
		//
		// ACT-MYC-CLINEMM02-C-CORRECTION02 — IDENTITY JOIN FIX.
		// The lookup key is `snapshot.sessionId` (the host-owned
		// session id from `CoreSessionConfig.sessionId`,
		// surfaced via `AgentRuntimeConfig.sessionId`), NOT
		// `snapshot.conversationId` (the agent transcript id
		// auto-generated by `ConversationStore` as
		// `conv_<ts>_<rand>`). In production these are two
		// DIFFERENT identity layers; the prime recorder is
		// keyed by the host sessionId, so the lookup MUST use
		// the same key or the prime is never found.
		// Fallback to `conversationId` is kept ONLY for the
		// pre-CORRECTION02 synthetic-id test fixture (where
		// the two ids happen to be equal by construction); in
		// production `snapshot.sessionId` is always populated
		// by the live runtime.
		//
		// Failure modes (all DEGRADED_WITH_DIAGNOSTIC, never throw):
		//   - no myc prime recorded (status="skipped"/"failed"/"ok" but
		//     no text)   -> no messages replacement; pass through.
		//   - sessionId already injected -> no messages replacement.
		//   - runtime iteration > 1     -> no messages replacement.
		async beforeModel(
			ctx: AgentBeforeModelContext,
		): Promise<
			{ messages?: readonly import("@cline/shared").AgentMessage[]; options?: Record<string, unknown> } | undefined
		> {
			try {
				// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
				// fire the ENTER observation before any short-circuit.
				// The discriminator tree in ACT §17 needs the ENTER
				// event to be present even when the body short-circuits
				// on iteration>1 or missing sessionId, otherwise Case
				// A ("hook never installed") is indistinguishable
				// from Case C ("hook installed and fired, but
				// `snapshot.sessionId` was undefined"). The
				// `__no_session__` sentinel is the same key the
				// downstream `recordMycPrimeLiveLookup`/`Injection`
				// calls already use, so a post-capture join finds
				// every observation under the same key.
				if (isMycPrimeLiveDiagEnabled()) {
					const enterKey =
						ctx.snapshot.sessionId ?? ctx.snapshot.conversationId ?? "__no_session__"
					recordMycPrimeLiveEnter(enterKey, ctx.snapshot.sessionId, ctx.snapshot.iteration)
				}
				// Iteration gate: only inject on the very first model
				// request of the run. Later iterations would duplicate
				// the prime (it is already in the conversation).
				if (ctx.snapshot.iteration > 1) {
					if (isMycPrimeLiveDiagEnabled()) {
						const sid = ctx.snapshot.sessionId ?? ctx.snapshot.conversationId
						if (sid) {
							recordMycPrimeLiveLookup(sid, {
								attempted: true,
								snapshotSessionIdPresent: ctx.snapshot.sessionId !== undefined,
								matchedRecordedSession: getMycPrimeResult(sid) !== undefined,
								recordedPrimeFound: (() => {
									const r = getMycPrimeResult(sid)
									return Boolean(r && r.status === "ok" && r.text)
								})(),
								iteration: ctx.snapshot.iteration,
								// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
								// record the actual lookup key so a post-capture
								// join can tell `snapshot.sessionId` lookups from
								// `conversationId` fallbacks. In this branch
								// `sid` is exactly the post-fallback key.
								lookupKey: sid,
							})
							recordMycPrimeLiveInjection(sid, {
								attempted: true,
								injected: false,
								reason: "iteration_not_first",
								iteration: ctx.snapshot.iteration,
							})
						}
					}
					return undefined
				}
				// CORRECTION02: use the HOST sessionId, not the
				// agent conversationId. The fallback to conversationId
				// is ONLY for hand-built partial snapshots / test
				// fixtures that predate CORRECTION02 — in production,
				// every live snapshot carries `sessionId` (populated
				// from `AgentRuntimeConfig.sessionId`).
				const sessionId = ctx.snapshot.sessionId ?? ctx.snapshot.conversationId
				if (!sessionId) {
					if (isMycPrimeLiveDiagEnabled()) {
						recordMycPrimeLiveLookup("__no_session__", {
							attempted: true,
							snapshotSessionIdPresent: false,
							matchedRecordedSession: false,
							recordedPrimeFound: false,
							iteration: ctx.snapshot.iteration,
							// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
							// the lookup key is `__no_session__` here because
							// both `snapshot.sessionId` and
							// `snapshot.conversationId` are absent.
							lookupKey: "__no_session__",
						})
						recordMycPrimeLiveInjection("__no_session__", {
							attempted: true,
							injected: false,
							reason: "no_session_id",
							iteration: ctx.snapshot.iteration,
						})
					}
					return undefined
				}
				// ACT-MYC-CLINEMM03-LIVE-DIAG01: observe the recorder
				// lookup BEFORE deciding injection. This is the
				// discriminator between
				//   acquisition=ok & lookup.recordedPrimeFound=false
				// (identity/join boundary; HALT_LIVE_PRIME_LOOKUP_MISS)
				// and
				//   acquisition=ok & lookup.recordedPrimeFound=true
				// (correct identity, recorder populated).
				if (isMycPrimeLiveDiagEnabled()) {
					const recordedForLookup = getMycPrimeResult(sessionId)
					const primeFoundForLookup = Boolean(
						recordedForLookup && recordedForLookup.status === "ok" && recordedForLookup.text,
					)
					recordMycPrimeLiveLookup(sessionId, {
						attempted: true,
						snapshotSessionIdPresent: ctx.snapshot.sessionId !== undefined,
						matchedRecordedSession: recordedForLookup !== undefined,
						recordedPrimeFound: primeFoundForLookup,
						iteration: ctx.snapshot.iteration,
						// ACT-MYC-CLINEMM-AUTOMATIC-PRIME-LIVE-BOUNDARY-CAPTURE01:
						// record the post-fallback lookup key. When
						// `snapshot.sessionId` is undefined, this is
						// `snapshot.conversationId`; when it is defined,
						// this is `snapshot.sessionId` itself. The
						// discriminator tree can compare `lookupKey`
						// against `bind.sessionId` to detect a key
						// mismatch (Case B).
						lookupKey: sessionId,
					})
				}
				// Per-session dedupe: even if iteration=1 fires twice
				// (defensive), only inject once.
				if (primeInjectedSessionIds.has(sessionId)) {
					if (isMycPrimeLiveDiagEnabled()) {
						recordMycPrimeLiveInjection(sessionId, {
							attempted: true,
							injected: false,
							reason: "already_injected",
							iteration: ctx.snapshot.iteration,
						})
					}
					return undefined
				}
				const recorded = getMycPrimeResult(sessionId)
				if (!recorded) {
					if (isMycPrimeLiveDiagEnabled()) {
						recordMycPrimeLiveInjection(sessionId, {
							attempted: true,
							injected: false,
							reason: "no_recorded_prime",
							iteration: ctx.snapshot.iteration,
						})
					}
					primeInjectedSessionIds.set(sessionId, true)
					return undefined
				}
				if (recorded.status !== "ok" || !recorded.text) {
					if (isMycPrimeLiveDiagEnabled()) {
						recordMycPrimeLiveInjection(sessionId, {
							attempted: true,
							injected: false,
							reason: "prime_empty",
							iteration: ctx.snapshot.iteration,
						})
					}
					primeInjectedSessionIds.set(sessionId, true)
					return undefined
				}
				primeInjectedSessionIds.set(sessionId, true)
				// Build a synthetic user message that carries the
				// prime packet. The runtime will REPLACE the request
				// messages with this returned array (per
				// agent-runtime.ts:1937-1939: `if (result?.messages)
				// { request = { ...request, messages: cloneMessages(result.messages) } }`).
				// We therefore must include the ORIGINAL messages
				// (the user's prompt) so the model still sees it.
				const packetText =
					`<prime_packet source="myc" session="${sessionId}" ts="${recorded.ts}">\n` +
					recorded.text +
					`\n</prime_packet>`
				const primeMessage = {
					id: `prime-${sessionId}-${recorded.ts}`,
					role: "user" as const,
					content: [
						{
							type: "text" as const,
							text: packetText,
						},
					],
					createdAt: recorded.ts,
				}
				const result: {
					messages: typeof ctx.request.messages
					options?: Record<string, unknown>
				} = {
					messages: [...ctx.request.messages, primeMessage],
				}
				// ACT-MYC-CLINEMM03-LIVE-DIAG01: when diagnostic mode
				// is enabled, stamp a stable captureId onto the
				// request metadata so downstream provider-capture
				// stages (CLINE_CAPTURE_PROVIDER_REQUEST=full,
				// CLINE_CAPTURE_WIRE=true) write files keyed by this
				// id. Existing metadata is PRESERVED by structural
				// merge: existing keys (`existing`, etc.) survive
				// intact; only `captureId`, `sessionId`, `iteration`,
				// and `mycPrimeDiag` are added/overridden.
				if (isMycPrimeLiveDiagEnabled()) {
					const captureId = `mycprime-${sessionId}-${recorded.ts}`
					const existingOptions =
						ctx.request.options && typeof ctx.request.options === "object"
							? (ctx.request.options as Record<string, unknown>)
							: {}
					const existingMetadata =
						existingOptions.metadata && typeof existingOptions.metadata === "object"
							? (existingOptions.metadata as Record<string, unknown>)
							: {}
					const mergedMetadata: Record<string, unknown> = {
						...existingMetadata,
						captureId,
						sessionId,
						iteration: ctx.snapshot.iteration,
						mycPrimeDiag: true,
					}
					result.options = {
						...existingOptions,
						metadata: mergedMetadata,
					}
					recordMycPrimeLiveInjection(sessionId, {
						attempted: true,
						injected: true,
						reason: "ok",
						packetBytes: Buffer.byteLength(packetText, "utf8"),
						iteration: ctx.snapshot.iteration,
					})
					recordMycPrimeLiveCapture(sessionId, {
						captureId,
						aiSdkPromptObserved: true,
					})
				}
				return result
			} catch (error) {
				// Never throw — DEGRADED_WITH_DIAGNOSTIC.
				Logger.warn("[HooksAdapter] beforeModel prime injection failed:", error)
				return undefined
			}
		},

		async beforeTool(
			ctx: AgentBeforeToolContext,
		): Promise<{ stop?: boolean; reason?: string; appendContext?: string } | undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const taskId = taskIdFromSnapshot(ctx.snapshot)
				const toolName = ctx.toolCall.toolName
				const factory = createFactory()
				const runner = await factory.create("PreToolUse", taskId, toolName)
				if (runner.isNoOp) {
					return undefined
				}

				const runningMsg = buildHookStatusMessage({ hookName: "PreToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				const result = await runner.run({
					taskId,
					preToolUse: {
						toolName,
						parameters: toStringRecord(ctx.input),
					},
				})

				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PreToolUse",
						toolName,
						status: result.cancel ? "cancelled" : "completed",
						ts: runningTs,
					}),
				)
				const stopControl = mapStopControl(result)
				if (stopControl) {
					return stopControl
				}
				// The runtime injects appendContext into the conversation as a
				// <hook_context> block, restoring the documented contextModification
				// behavior. HookFactory already truncates it at 50KB.
				const contextModification = result.contextModification?.trim()
				return contextModification ? { appendContext: contextModification } : undefined
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PreToolUse",
						toolName: ctx.toolCall.toolName,
						status: "failed",
						ts: runningTs,
					}),
				)
				Logger.error("[HooksAdapter] beforeTool hook failed:", error)
				return undefined
			}
		},

		async afterTool(
			ctx: AgentAfterToolContext,
		): Promise<{ stop?: boolean; reason?: string; appendContext?: string } | undefined> {
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return undefined
				}

				const taskId = taskIdFromSnapshot(ctx.snapshot)
				const toolName = ctx.toolCall.toolName
				const factory = createFactory()
				const runner = await factory.create("PostToolUse", taskId, toolName)
				if (runner.isNoOp) {
					return undefined
				}

				const runningMsg = buildHookStatusMessage({ hookName: "PostToolUse", toolName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				const result = await runner.run({
					taskId,
					postToolUse: {
						toolName,
						parameters: toStringRecord(ctx.input),
						result: String(ctx.result.output ?? ""),
						success: !ctx.result.isError,
						executionTimeMs: ctx.durationMs,
					},
				})

				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PostToolUse",
						toolName,
						status: result.cancel ? "cancelled" : "completed",
						ts: runningTs,
					}),
				)
				const stopControl = mapStopControl(result)
				if (stopControl) {
					return stopControl
				}
				// The runtime injects appendContext into the conversation as a
				// <hook_context> block, restoring the documented contextModification
				// behavior. HookFactory already truncates it at 50KB.
				const contextModification = result.contextModification?.trim()
				return contextModification ? { appendContext: contextModification } : undefined
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({
						hookName: "PostToolUse",
						toolName: ctx.toolCall.toolName,
						status: "failed",
						ts: runningTs,
					}),
				)
				Logger.error("[HooksAdapter] afterTool hook failed:", error)
				return undefined
			}
		},

		async afterRun(ctx): Promise<void> {
			let hookName: "TaskComplete" | "TaskCancel" | undefined
			let runningTs: number | undefined
			try {
				if (!hooksEnabled()) {
					return
				}

				hookName =
					ctx.result.status === "completed"
						? "TaskComplete"
						: ctx.result.status === "aborted"
							? "TaskCancel"
							: undefined
				if (!hookName) {
					return
				}

				const taskId = taskIdFromSnapshot(ctx.snapshot)
				const factory = createFactory()
				const runner = await factory.create(hookName, taskId)
				if (runner.isNoOp) {
					return
				}

				const runningMsg = buildHookStatusMessage({ hookName, status: "running" })
				runningTs = runningMsg.ts
				emitHookMessage?.(runningMsg)

				if (hookName === "TaskComplete") {
					await runner.run({
						taskId,
						taskComplete: {
							taskMetadata: {
								taskId,
								ulid: "",
								initialTask: "",
								result: ctx.result.outputText,
							},
						},
					})
				} else {
					await runner.run({
						taskId,
						taskCancel: {
							taskMetadata: {
								taskId,
								ulid: "",
								initialTask: "",
								completionStatus: "cancelled",
							},
						},
					})
				}

				emitHookMessage?.(buildHookStatusMessage({ hookName, status: "completed", ts: runningTs }))
			} catch (error) {
				emitHookMessage?.(
					buildHookStatusMessage({ hookName: hookName ?? "TaskComplete", status: "failed", ts: runningTs }),
				)
				Logger.error("[HooksAdapter] afterRun hook failed:", error)
			}
		},
	}
}

async function runTaskStart(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	createFactory: () => HookFactory,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const taskId = taskIdFromSnapshot(ctx.snapshot)
		const factory = createFactory()
		const runner = await factory.create("TaskStart", taskId)
		if (runner.isNoOp) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "TaskStart", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const result = await runner.run({
			taskId,
			taskStart: {
				taskMetadata: {
					taskId,
					ulid: "",
					initialTask: latestUserPrompt(ctx),
				},
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "TaskStart",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "TaskStart", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (TaskStart) hook failed:", error)
		return undefined
	}
}

async function runUserPromptSubmit(
	ctx: AgentRunLifecycleContext,
	hooksEnabled: () => boolean,
	createFactory: () => HookFactory,
	emitHookMessage?: HookMessageEmitter,
): Promise<AgentStopControl | undefined> {
	let runningTs: number | undefined
	try {
		if (!hooksEnabled()) {
			return undefined
		}

		const taskId = taskIdFromSnapshot(ctx.snapshot)
		const factory = createFactory()
		const runner = await factory.create("UserPromptSubmit", taskId)
		if (runner.isNoOp) {
			return undefined
		}

		const runningMsg = buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "running" })
		runningTs = runningMsg.ts
		emitHookMessage?.(runningMsg)

		const result = await runner.run({
			taskId,
			userPromptSubmit: {
				prompt: latestUserPrompt(ctx),
				attachments: [],
			},
		})

		emitHookMessage?.(
			buildHookStatusMessage({
				hookName: "UserPromptSubmit",
				status: result.cancel ? "cancelled" : "completed",
				ts: runningTs,
			}),
		)
		return mapStopControl(result)
	} catch (error) {
		emitHookMessage?.(buildHookStatusMessage({ hookName: "UserPromptSubmit", status: "failed", ts: runningTs }))
		Logger.error("[HooksAdapter] beforeRun (UserPromptSubmit) hook failed:", error)
		return undefined
	}
}
