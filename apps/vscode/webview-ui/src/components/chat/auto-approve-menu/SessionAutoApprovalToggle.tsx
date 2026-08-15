/**
 * ACT-CLINEMM-SESSION-AUTONOMY01 + ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01
 *
 * "Approve all for this task" — a session-scoped, ephemeral auto-approval
 * projection over the canonical AutoApprove authority. Lives inside the
 * AutoApprove panel (not in Settings → Features) because AutoApprove is
 * the product authority this feature projects over.
 *
 * UI is a pure mirror of the host-owned `sessionAutoApproval` state. The
 * host is the security authority; the toggle posts a gRPC RPC and the
 * host pushes the resulting state back via subscribeToState.
 *
 * CORRECTION01: supports pre-arm before any task exists. When no task is
 * active, the toggle is "Arm for next task"; clicking it sets a one-shot
 * intent that the host binds to the next session. Status copy is
 * corrected to reflect the actual lattice:
 *
 *   - "ClineMM command policy remains enforced"  (was: "Hard ClineMM
 *     security denials remain enforced" — production has no production
 *     hard-DENY rule corpus today; the corrected wording is honest).
 */

import type { SessionAutoApprovalOverride } from "@shared/ExtensionMessage"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

interface SessionAutoApprovalToggleProps {
	currentTaskSessionId: string | undefined
}

export const SessionAutoApprovalToggle = ({ currentTaskSessionId }: SessionAutoApprovalToggleProps) => {
	const { sessionAutoApproval, sessionAutonomy, sessionAutoApprovalArmed } = useExtensionState()
	const [confirming, setConfirming] = useState(false)
	const [busy, setBusy] = useState(false)

	const snapshot = sessionAutoApproval ??
		sessionAutonomy ?? { override: "none" as SessionAutoApprovalOverride, sessionId: undefined }
	const isArmed = sessionAutoApprovalArmed === "all"
	const isActiveForTask = snapshot.override === "all" && snapshot.sessionId === currentTaskSessionId
	// The toggle is visually on when EITHER bound-active-for-this-task OR armed
	// for the next task. Both flow through the same RPC.
	const checked = isActiveForTask || isArmed

	const setOverride = useCallback(async (override: SessionAutoApprovalOverride) => {
		setBusy(true)
		try {
			await StateServiceClient.setSessionAutoApprovalOverride({ override })
		} finally {
			setBusy(false)
		}
	}, [])

	const handleToggle = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation()
			// ACT §17: First activation may show a concise confirmation;
			// subsequent toggles do not (no melodrama).
			if (!checked && !confirming) {
				setConfirming(true)
				return
			}
			setConfirming(false)
			await setOverride(checked ? "none" : "all")
		},
		[checked, confirming, setOverride],
	)

	const handleConfirmEnable = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation()
			setConfirming(false)
			await setOverride("all")
		},
		[setOverride],
	)

	const handleCancelConfirm = useCallback((e: React.MouseEvent) => {
		e.stopPropagation()
		setConfirming(false)
	}, [])

	if (confirming) {
		return (
			<div className="px-3.5 pb-3 pt-2 border-t border-[color:var(--vscode-sideBar-background)]">
				<div className="text-xs text-foreground mb-2">
					{currentTaskSessionId
						? "Approve ordinary actions automatically for this task?"
						: "Arm autonomy for the next task? The override activates on submission and clears at task end."}
				</div>
				<div className="text-xs text-muted-foreground mb-2">{CORRECTION01_TRUTHFUL_COPY}</div>
				<div className="flex gap-2">
					<button
						className="text-xs px-2 py-1 bg-[color:var(--vscode-button-background)] text-[color:var(--vscode-button-foreground)] rounded-sm cursor-pointer"
						disabled={busy}
						onClick={handleConfirmEnable}
						type="button">
						{currentTaskSessionId ? "Enable for this task" : "Arm for next task"}
					</button>
					<button
						className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground rounded-sm cursor-pointer"
						disabled={busy}
						onClick={handleCancelConfirm}
						type="button">
						Cancel
					</button>
				</div>
			</div>
		)
	}

	const labelText = currentTaskSessionId ? "Approve all for this task" : "Approve all for next task"

	return (
		<div className="px-3.5 py-2 border-t border-[color:var(--vscode-sideBar-background)]">
			<label
				className="flex items-center gap-2 cursor-pointer text-sm"
				data-testid="session-autonomy-toggle"
				onClick={handleToggle}>
				<VSCodeCheckbox checked={checked} disabled={busy} />
				<span className="flex items-center gap-1">
					<span aria-hidden="true">⚡</span>
					<span>{labelText}</span>
				</span>
			</label>
		</div>
	)
}

const CORRECTION01_TRUTHFUL_COPY =
	"ClineMM command policy remains enforced (canonical lattice still applies; deny rules + hardened envelopes for safe commands)."
