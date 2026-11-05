import { cn } from "@heroui/react"
import { EmptyRequest } from "@shared/proto/cline/common"
import { BugIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UiServiceClient } from "@/services/grpc-client"

/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The ONE-CLICK "Report Task Problem" action.
 *
 * The button sends a NARROW request with NO parameters: the extension
 * host resolves the active task's retained incident through its own
 * authority, shows the privacy-safe preview, opens the native Save
 * dialog and writes the diagnostic ZIP. The webview never supplies an
 * incident identity and never supplies a filesystem path.
 *
 * The action is discoverable while the task is `Paused`: the task
 * header is always rendered, and the button is placed alongside the
 * existing task actions.
 */
const ReportTaskProblemButton: React.FC<{
	className?: string
}> = ({ className }) => {
	const [inFlight, setInFlight] = useState(false)

	const handleClick = useCallback(() => {
		if (inFlight) {
			return
		}
		setInFlight(true)
		void UiServiceClient.reportTaskProblem(EmptyRequest.create({}))
			.catch((err) => {
				console.error("[AICE01] report task problem request failed", err)
			})
			.finally(() => {
				setInFlight(false)
			})
	}, [inFlight])

	return (
		<Tooltip>
			<TooltipContent side="bottom">Report Task Problem</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="Report Task Problem"
					disabled={inFlight}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						handleClick()
					}}
					size="icon"
					variant="icon">
					<BugIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default ReportTaskProblemButton
