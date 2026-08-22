/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01-CORRECTION01+02+03
 *
 * gRPC handler for TaskService.handoffWithContext(EmptyRequest) -> String.
 *
 * Restores the documented product contract for the `/newtask` slash
 * command:
 *
 *   /newtask  = fresh task + distilled context from current conversation
 *   /compact  = same-task compaction (handled by condense RPC)
 *   /smol     = same-task compaction alias (handled by condense RPC)
 *
 * CORRECTION01+02+03 flow:
 *   1. Capture `sourceSessionId` from the active session.
 *   2. Read the source session's transcript via `sdkHost.readMessages`.
 *   3. CORRECTION03: revalidate active session after the readMessages
 *      await. If identity drifted, abort fail-closed.
 *   4. Resolve the source session's `ProviderConfig` via the Controller
 *      accessor.
 *   5. Build a REQUEST-SCOPED production provider via
 *      `createSdkHandoffSummaryProvider(providerConfig)` (CORRECTION02:
 *      no module-scoped slot — the config is captured in closure).
 *   6. Invoke `generateHandoffSummary` (real LLM call through
 *      `createHandlerAsync`). On any LLM failure, surface an explicit
 *      failure (no fake handoff, no task creation).
 *   7. CORRECTION03: revalidate active session again before COMMIT. If
 *      identity drifted during the LLM await, abort fail-closed.
 *   8. Pass the resulting handoff text to `controller.initTask`, the
 *      existing new-task creation seam.
 *
 * Returns the new taskId (String). Returns an empty string if the host
 * has no active session, no provider configured, the LLM call fails, OR
 * source-session identity drifted during the awaits — in all four cases
 * `controller.initTask` is NOT called.
 *
 * The CURRENT task identity is NOT mutated — there is no
 * `controller.compactTask()` call here; the prior task's history
 * remains as a historical record. (NDHA06 no-mutation invariant.)
 *
 * CORRECTION03 invariant (source-session identity binding): the handler
 * commits a handoff ONLY against the same session identity it captured
 * at entry. Identity drift between capture and commit aborts fail-closed
 * — never commits against a different active session, never silently
 * produces a fresh task from a stale source.
 */

import type { Message as SdkMessage } from "@cline/llms"
import { EmptyRequest, String } from "@shared/proto/cline/common"
import { createSdkHandoffSummaryProvider, generateHandoffSummary, withProxyAwareFetch } from "@/sdk/handoff-summary"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

interface ActiveSessionLike {
	readonly sessionId: string
	readonly sdkHost?: {
		readMessages?: (sessionId: string) => Promise<unknown[] | undefined>
	}
}

interface ControllerLike {
	sessions?: { getActiveSession?: () => ActiveSessionLike | undefined }
	getActiveSessionProviderConfig?: () => ReturnType<typeof withProxyAwareFetch> | undefined
}

function extractMessages(raw: unknown): SdkMessage[] {
	if (!Array.isArray(raw)) {
		return []
	}
	return raw as SdkMessage[]
}

/**
 * Produce a fresh task whose initial prompt is a handoff summary of the
 * current session's transcript. Returns the new taskId. Returns an empty
 * string if distillation cannot proceed (no active session, no provider,
 * LLM failure, no messages, OR source-session identity drift); in every
 * failure case `controller.initTask` is NOT called.
 */
export async function handoffWithContext(controller: Controller, _request: EmptyRequest): Promise<String> {
	const controllerLike = controller as unknown as ControllerLike

	// (1) Capture the source session identity. Every subsequent await
	// revalidates against this captured id; drift fails-closed.
	const initialSession = controllerLike.sessions?.getActiveSession?.()
	if (!initialSession) {
		Logger.warn("[handoffWithContext] No active session; returning empty taskId")
		return String.create({ value: "" })
	}
	const sourceSessionId = initialSession.sessionId

	const readMessages = initialSession.sdkHost?.readMessages
	if (typeof readMessages !== "function") {
		Logger.warn("[handoffWithContext] Active session has no readMessages primitive; returning empty taskId")
		return String.create({ value: "" })
	}

	let messages: SdkMessage[] = []
	try {
		const raw = await readMessages.call(initialSession.sdkHost, sourceSessionId)
		messages = extractMessages(raw)
	} catch (error) {
		Logger.error(`[handoffWithContext] readMessages failed for ${sourceSessionId}:`, error)
		return String.create({ value: "" })
	}

	// CORRECTION03: revalidate the active session after the readMessages
	// await. If the active session has changed (e.g. another task
	// transition swapped the source), fail-closed — do NOT commit a
	// handoff whose source identity no longer matches the current
	// active session.
	const sessionAfterRead = controllerLike.sessions?.getActiveSession?.()
	if (!sessionAfterRead || sessionAfterRead.sessionId !== sourceSessionId) {
		Logger.warn(
			`[handoffWithContext] Source session identity drift after readMessages: was=${sourceSessionId} now=${sessionAfterRead?.sessionId ?? "<none>"}; aborting handoff`,
		)
		return String.create({ value: "" })
	}

	if (messages.length === 0) {
		Logger.warn("[handoffWithContext] Active session has no messages; returning empty taskId")
		return String.create({ value: "" })
	}

	// Resolve the active session's ProviderConfig (SDK shape). This is
	// the SAME provider the active session is using, so the distillation
	// call has access to the API key, base URL, and proxy-aware fetch.
	const providerConfig = controllerLike.getActiveSessionProviderConfig?.()
	if (!providerConfig) {
		Logger.warn("[handoffWithContext] No active ProviderConfig; cannot distill handoff; returning empty taskId")
		return String.create({ value: "" })
	}

	// CORRECTION02: build a request-scoped provider so each invocation
	// captures its own ProviderConfig in closure. Two concurrent
	// /newtask calls remain provider-isolated; no module state.
	const provider = createSdkHandoffSummaryProvider(withProxyAwareFetch(providerConfig))

	let handoffText = ""
	try {
		handoffText = await generateHandoffSummary({ messages }, { provider })
	} catch (error) {
		Logger.error("[handoffWithContext] Handoff distillation failed:", error)
		return String.create({ value: "" })
	}

	if (!handoffText) {
		Logger.warn("[handoffWithContext] Handoff text was empty after distillation; returning empty taskId")
		return String.create({ value: "" })
	}

	// CORRECTION03: revalidate again before the COMMIT boundary. If the
	// active session has drifted during the LLM distillation await,
	// fail-closed — do NOT create a new task identity from a stale
	// source transcript.
	const sessionAfterLlm = controllerLike.sessions?.getActiveSession?.()
	if (!sessionAfterLlm || sessionAfterLlm.sessionId !== sourceSessionId) {
		Logger.warn(
			`[handoffWithContext] Source session identity drift after LLM distillation: was=${sourceSessionId} now=${sessionAfterLlm?.sessionId ?? "<none>"}; aborting handoff commit`,
		)
		return String.create({ value: "" })
	}

	// Reuse the existing new-task creation seam. controller.initTask returns
	// the new taskId and is an identified existing new-task creation seam
	// (see EPIC RECON — CS5; not claimed SOLE without exhaustive inventory).
	const taskId = await controller.initTask(handoffText, undefined, undefined, undefined, undefined)
	return String.create({ value: taskId || "" })
}

// Touch EmptyRequest so this module imports it once for tree-shaking
// diagnostics (the generated types reference it through the service binding).
export const _typeTouch = EmptyRequest
