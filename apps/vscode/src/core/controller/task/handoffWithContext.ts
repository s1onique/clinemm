/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01
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
 * The handler reads the active session's transcript, generates a structured
 * handoff summary via the SDK summary helper, and creates a fresh task
 * whose initial prompt is the summary. The CURRENT task identity is NOT
 * mutated — there is no `controller.compactTask()` call here; the prior
 * task's history remains as a historical record. (NDHA06 no-mutation
 * invariant.)
 *
 * Returns the new taskId (String), mirroring the existing
 * `controller.initTask` return contract.
 */

import type { Message as SdkMessage } from "@cline/llms"
import { EmptyRequest, String } from "@shared/proto/cline/common"
import { generateHandoffSummary } from "@/sdk/handoff-summary"
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
 * current session's transcript. Returns the new taskId (empty string if
 * the host has no active session to hand off from, so the webview can
 * surface the no-active-session case to the user without crashing).
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

	const handoffText = await generateHandoffSummary({ messages })

	// Reuse the existing new-task creation seam. controller.initTask returns
	// the new taskId and is the SOLE production seam that allocates a fresh
	// sessionId via SdkTaskStartCoordinator.
	const taskId = await controller.initTask(handoffText, undefined, undefined, undefined, undefined)
	return String.create({ value: taskId || "" })
}

// Touch EmptyRequest so this module imports it once for tree-shaking
// diagnostics (the generated types reference it through the service binding).
export const _typeTouch = EmptyRequest
