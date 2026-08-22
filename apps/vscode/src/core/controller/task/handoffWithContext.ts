/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01-CORRECTION01+02
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
 * CORRECTION01 flow:
 *   1. Read the active session's transcript via `sdkHost.readMessages`.
 *   2. Resolve the active session's `ProviderConfig` (SDK shape) via the
 *      Controller accessor.
 *   3. Build a REQUEST-SCOPED production provider via
 *      `createSdkHandoffSummaryProvider(providerConfig)` (CORRECTION02:
 *      no module-scoped slot — the config is captured in closure, so two
 *      concurrent /newtask invocations remain provider-isolated).
 *   4. Invoke `generateHandoffSummary` (real LLM call through
 *      `createHandlerAsync`). On any LLM failure, surface an explicit
 *      failure (no fake handoff, no task creation).
 *   5. Pass the resulting handoff text to `controller.initTask`, the
 *      existing new-task creation seam.
 *
 * Returns the new taskId (String). Returns an empty string if the host
 * has no active session, no provider configured, or the LLM call fails —
 * in all three cases `controller.initTask` is NOT called.
 *
 * The CURRENT task identity is NOT mutated — there is no
 * `controller.compactTask()` call here; the prior task's history
 * remains as a historical record. (NDHA06 no-mutation invariant.)
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
 * LLM failure, no messages); in every failure case `controller.initTask`
 * is NOT called.
 */
export async function handoffWithContext(controller: Controller, _request: EmptyRequest): Promise<String> {
	const activeSession = (
		controller as unknown as {
			sessions?: { getActiveSession?: () => ActiveSessionLike | undefined }
		}
	).sessions?.getActiveSession?.()

	if (!activeSession) {
		Logger.warn("[handoffWithContext] No active session; returning empty taskId")
		return String.create({ value: "" })
	}

	const readMessages = activeSession.sdkHost?.readMessages
	if (typeof readMessages !== "function") {
		Logger.warn("[handoffWithContext] Active session has no readMessages primitive; returning empty taskId")
		return String.create({ value: "" })
	}

	let messages: SdkMessage[] = []
	try {
		const raw = await readMessages.call(activeSession.sdkHost, activeSession.sessionId)
		messages = extractMessages(raw)
	} catch (error) {
		Logger.error(`[handoffWithContext] readMessages failed for ${activeSession.sessionId}:`, error)
		return String.create({ value: "" })
	}

	if (messages.length === 0) {
		Logger.warn("[handoffWithContext] Active session has no messages; returning empty taskId")
		return String.create({ value: "" })
	}

	// Resolve the active session's ProviderConfig (SDK shape). This is
	// the SAME provider the active session is using, so the distillation
	// call has access to the API key, base URL, and proxy-aware fetch.
	const providerConfig = (
		controller as unknown as {
			getActiveSessionProviderConfig?: () => ReturnType<typeof withProxyAwareFetch> | undefined
		}
	).getActiveSessionProviderConfig?.()
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

	// Reuse the existing new-task creation seam. controller.initTask returns
	// the new taskId and is an identified existing new-task creation seam
	// (see EPIC RECON — CS5; not claimed SOLE without exhaustive inventory).
	const taskId = await controller.initTask(handoffText, undefined, undefined, undefined, undefined)
	return String.create({ value: taskId || "" })
}

// Touch EmptyRequest so this module imports it once for tree-shaking
// diagnostics (the generated types reference it through the service binding).
export const _typeTouch = EmptyRequest
