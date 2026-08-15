/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * "Approve all for this task" — a session-scoped, ephemeral auto-approval
 * projection over the canonical AutoApprove authority. Lives inside the
 * AutoApprove panel (not in Settings → Features) because AutoApprove is
 * the product authority this feature projects over.
 *
 * UI is a pure mirror of the host-owned `sessionAutoApproval` state. The
 * host is the security authority; the toggle posts a gRPC RPC and the
 * host pushes the resulting state back via subscribeToState.
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
	const { sessionAutoApproval, sessionAutonomy } = useExtensionState()
	const [confirming, setConfirming] = useState(false)
	const [busy, setBusy] = useState(false)

	const snapshot = sessionAutoApproval ??
		sessionAutonomy ?? { override: "none" as SessionAutoApprovalOverride, sessionId: undefined }
	const isActive = snapshot.override === "all"
	const activeForThisTask = isActive && snapshot.sessionId === currentTaskSessionId

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
			if (!isActive && !confirming) {
				setConfirming(true)
				return
			}
			setConfirming(false)
			await setOverride(isActive ? "none" : "all")
		},
		[isActive, confirming, setOverride],
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
				<div className="text-xs text-foreground mb-2">Approve ordinary actions automatically for this task?</div>
				<div className="text-xs text-muted-foreground mb-2">Hard ClineMM security denials remain enforced.</div>
				<div className="flex gap-2">
					<button
						className="text-xs px-2 py-1 bg-[color:var(--vscode-button-background)] text-[color:var(--vscode-button-foreground)] rounded-sm cursor-pointer"
						disabled={busy}
						onClick={handleConfirmEnable}
						type="button">
						Enable for this task
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

	return (
		<div className="px-3.5 py-2 border-t border-[color:var(--vscode-sideBar-background)]">
			<label
				className="flex items-center gap-2 cursor-pointer text-sm"
				data-testid="session-autonomy-toggle"
				onClick={handleToggle}>
				<VSCodeCheckbox checked={activeForThisTask} disabled={busy || !currentTaskSessionId} />
				<span className="flex items-center gap-1">
					<span aria-hidden="true">⚡</span>
					<span>Approve all for this task</span>
				</span>
			</label>
			{!currentTaskSessionId && <div className="text-xs text-muted-foreground mt-1 ml-6">Start a task to enable.</div>}
		</div>
	)
}
