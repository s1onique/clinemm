import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"
import ExpandHandle from "./ExpandHandle"

export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
		onOutputChange,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
		onOutputChange?: () => void
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		useEffect(() => {
			if (isContainerExpanded) {
				onOutputChange?.()
			}
		}, [output, isOutputFullyExpanded, isContainerExpanded, onOutputChange])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		// Check if output contains a log file path indicator
		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		// Render output with clickable log file path
		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			// Split output into parts: before log path, log path line, after log path
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""

			// Extract just the filename from the full path for display
			const fileName = logFilePath.split("/").pop() || logFilePath

			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`Click to open: ${logFilePath}`}>
						<span className="shrink-0">📋 Output is being logged to:</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code rounded-sm", {
					"rounded-b-none": lineCount > 5,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
						"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
						"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

export const CommandOutputRow = memo(
	({
		message,
		isCommandExecuting = false,
		isCommandPending = false,
		isCommandCompleted = false,
		isCommandRejected = false,
		isCommandBackgrounded = false,
		isBackgroundExec = false, // vscodeTerminalExecutionMode === "backgroundExec"
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
		onOutputChange,
	}: {
		message: ClineMessage
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isCommandRejected?: boolean
		/**
		 * ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
		 * True iff the underlying CommandJob is still alive (the
		 * row's `commandExecutionDisposition === "backgrounded"`).
		 * When true, the row's status pill renders "Backgrounded"
		 * (NOT "Completed") and the Cancel affordance MUST remain
		 * visible (independent of `isCommandExecuting`).
		 */
		isCommandBackgrounded?: boolean
		isBackgroundExec?: boolean
		onCancelCommand?: (jobId?: string) => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
		onOutputChange?: () => void
	}) => {
		const splitMessage = (text: string) => {
			const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
			if (outputIndex === -1) {
				return { command: text, output: "" }
			}
			return {
				command: text.slice(0, outputIndex).trim(),
				output: text
					.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
					.trim()
					.split("")
					.map((char) => {
						switch (char) {
							case "\t":
								return "→   "
							case "\b":
								return "⌫"
							case "\f":
								return "⏏"
							case "\v":
								return "⇳"
							default:
								return char
						}
					})
					.join(""),
			}
		}

		const { command: rawCommand, output } = splitMessage(message.text || "")

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
		// ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
		// showCancelButton now fires for backgrounded jobs as well
		// (independent of isCommandExecuting). The user must retain
		// Cancel control over a non-terminal CommandJob regardless
		// of whether the foreground streaming row is still being
		// updated.
		const showCancelButton =
			(isCommandExecuting || isCommandPending || isCommandBackgrounded) &&
			typeof onCancelCommand === "function" &&
			isBackgroundExec

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{icon}
				{title}
			</div>
		)

		return (
			<>
				{commandHeader}
				<div
					className="bg-code rounded-sm border border-editor-group-border"
					style={{
						transition: "all 0.3s ease-in-out",
					}}>
					{command && (
						<div className="bg-code flex items-center justify-between px-2 py-2.5 border-b border-editor-group-border rounded-sm rounded-b-none overflow-hidden">
							<div className="flex items-center gap-2 flex-1 m-w-0">
								<div
									className={cn("bg-description rounded-full w-2 h-2 shrink-0", {
										"bg-success animate-pulse": isCommandExecuting,
										"bg-editor-warning-foreground": isCommandPending,
										// ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
										// backgrounded jobs reuse the success family but with
										// a steadier (non-pulsing) dot so the operator
										// visually distinguishes them from foreground
										// streaming rows. (Mutually exclusive with isCommandExecuting
										// — a backgrounded row has no foreground streaming yet.)
										"bg-success opacity-75": isCommandBackgrounded,
										// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01:
										// rejected-before-execution rows use a
										// distinct dim/red dot so the status
										// pill is visually distinct from
										// "completed".
										"bg-error opacity-50": isCommandRejected,
									})}
								/>
								<span
									className={cn("text-description font-medium text-base shrink-0", {
										"text-success": isCommandExecuting,
										"text-editor-warning-foreground": isCommandPending,
										"text-error opacity-70": isCommandRejected,
									})}>
									{getCommandStatusText(
										isCommandExecuting,
										isCommandPending,
										isCommandCompleted,
										isCommandRejected,
										isCommandBackgrounded,
									)}
								</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{showCancelButton && (
									<Button
										onClick={(e) => {
											e.stopPropagation()
											if (isBackgroundExec) {
												// ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
												// pass the exact jobId (parsed from the running envelope)
												// so the dispatcher targets a single job rather than
												// the session-wide cancel path.
												const jobId = isCommandBackgrounded ? extractJobIdFromOutput(output) : undefined
												onCancelCommand?.(jobId)
											} else {
												// For regular terminal mode, show a message
												alert(
													"This command is running in the VSCode terminal. You can manually stop it using Ctrl+C in the terminal, or switch to Background Execution mode in settings for cancellable commands.",
												)
											}
										}}
										size="sm"
										variant="secondary">
										{isBackgroundExec ? "cancel" : "stop"}
									</Button>
								)}
							</div>
						</div>
					)}

					<div className="bg-code opacity-60 text-sm">
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
					</div>

					{output.length > 0 && (
						<CommandOutputContent
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
							onOutputChange={onOutputChange}
							onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
							output={output}
						/>
					)}
				</div>
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning" />
						<span>The model has determined this command requires explicit approval.</span>
					</div>
				)}
			</>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"

/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
 * Extract the `jobId` from a backgrounded-run output envelope.
 * Returns `undefined` if the output is not a backgrounded envelope
 * or if the jobId cannot be parsed. Cheap and conservative — never
 * throws.
 */
function extractJobIdFromOutput(output: string): string | undefined {
	if (!output) return undefined
	const m = output.match(/"jobId"\s*:\s*"([^"]+)"/)
	return m?.[1]
}

const CommandStatusMap = {
	executing: "Running",
	pending: "Pending",
	completed: "Completed",
	skipped: "Skipped",
	// ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01: a row
	// whose underlying CommandJob is still alive (the
	// `commandExecutionDisposition === "backgrounded"` projection
	// from the message-translator) must NOT show "Completed" (the
	// row is non-terminal). The operator-visible pill must read
	// "Backgrounded" so the user retains Cancel control over the
	// still-running process.
	backgrounded: "Backgrounded",
	// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01: §20 status-pill
	// truth — a row that never executed must NOT show "Completed"
	// (which reads as successful execution).
	rejected: "Rejected",
}

/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
 * Get the operator-visible status pill text. Lifecycle dominates
 * completion: a backgrounded row MUST read "Backgrounded" (NOT
 * "Completed") regardless of `isExecuting` / `isPending` state.
 */
function getCommandStatusText(
	isExecuting: boolean,
	isPending: boolean,
	isCompleted: boolean,
	isRejected: boolean,
	isBackgrounded: boolean,
): string {
	// Lifecycle dominates completion: a row stamped as rejected before
	// execution is finalized at the request boundary, not execution.
	if (isRejected) {
		return CommandStatusMap.rejected
	}
	// ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01:
	// Backgrounded takes precedence over executing/pending/
	// completed so the operator-visible pill truthfully reflects
	// the underlying CommandJob liveness (still alive, NOT
	// terminal).
	if (isBackgrounded) {
		return CommandStatusMap.backgrounded
	}
	if (isExecuting) {
		return CommandStatusMap.executing
	}
	if (isPending) {
		return CommandStatusMap.pending
	}
	if (isCompleted) {
		return CommandStatusMap.completed
	}
	return CommandStatusMap.skipped
}
