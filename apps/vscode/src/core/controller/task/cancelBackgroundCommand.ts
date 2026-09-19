import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
 * Cancel the in-flight background command(s). When the request
 * carries a non-empty `value` (the jobId), the cancel is
 * scoped to a single backgrounded CommandJob; when empty,
 * falls back to the legacy session-wide cancel for
 * back-compat with consumers that have not yet been updated
 * to pass a jobId.
 */
export async function cancelBackgroundCommand(controller: Controller, request: StringRequest): Promise<Empty> {
	const controllerWithCancel = controller as Controller & {
		cancelBackgroundCommand: (jobId?: string) => Promise<void>
	}
	const jobId = request.value && request.value.length > 0 ? request.value : undefined
	await controllerWithCancel.cancelBackgroundCommand(jobId)
	return Empty.create()
}
