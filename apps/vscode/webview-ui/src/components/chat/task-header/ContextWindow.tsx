import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { SlashServiceClient } from "@/services/grpc-client"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import CompactTaskButton from "./buttons/CompactTaskButton"
import { ContextWindowSummary } from "./ContextWindowSummary"

// Type definitions
interface ContextWindowInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	size?: number
}

interface ContextWindowProgressProps extends ContextWindowInfoProps {
	useAutoCondense: boolean
	// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): provider-normalized
	// context-input token count of the last request — the disjoint sum
	// `tokensIn + cacheReads + cacheWrites` — drives the percentage and the
	// displayed "used" value. This mirrors the AI SDK `inputTokens.total`
	// contract (Anthropic: `input_tokens + cache_creation + cache_read`;
	// OpenAI-compat: `prompt_tokens` with `cached_tokens` already included) and
	// is therefore provider-independent. It is **not** the billed request
	// activity (`tokensIn + tokensOut + cacheWrites + cacheReads`); the latter
	// would overstate context-window occupancy (see #11037), and would
	// undercount Anthropic-native cached prompts if `tokensIn` alone were used.
	lastApiReqContextInputTokens?: number
	// Preserved for callers that want the broader request-activity total
	// (billed dimensions). The ContextWindow does **not** use this for the
	// percentage projection.
	lastApiReqTotalTokens?: number
	contextWindow?: number
	onSendMessage?: (command: string, files: string[], images: string[]) => void
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-first-pass) — Boundary 5:
	//
	// Authoritative current working-context estimate (W)
	// published by the agent runtime via
	// `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`
	// and mirrored to `ExtensionState.currentWorkingContext
	// Estimate` by the host-side carrier
	// (`apps/vscode/src/sdk/working-context-host-capture.ts`).
	//
	// The bar numerator precedence is:
	//
	//   currentWorkingContextEstimate === number
	//     → use W (runtime-published occupancy)
	//   currentWorkingContextEstimate === undefined
	//     → "never set / omitted" — legacy /
	//       classic / pre-runtime path. Fall back
	//       to P (lastApiReqContextInputTokens) so
	//       the legacy bar continues to render.
	//       The carrier contract uses `null` for
	//       runtime-cleared (see below); the
	//       absence of the field on
	//       `ExtensionState` only persists when
	//       the carrier is absent (legacy path).
	//   currentWorkingContextEstimate === null
	//     → "runtime emitted, no W" — runtime is
	//       active but the latest event carried
	//       no W. Render UNAVAILABLE (reviewer
	//       twentieth-pass fallback B); do NOT
	//       silently substitute P-as-W. P and W
	//       are explicitly different authorities.
	//
	// Stale W reuse is FORBIDDEN (assignment
	// semantics include undefined at the carrier).
	// Conservation: no estimator imports. W is
	// transport-only.
	currentWorkingContextEstimate?: number | null
}

const ConfirmationDialog = memo<{
	onConfirm: (e: React.MouseEvent) => void
	onCancel: (e: React.MouseEvent) => void
}>(({ onConfirm, onCancel }) => (
	<div className="mt-2 flex flex-col gap-2 rounded-sm border border-border-panel bg-code p-2 text-sm">
		<span className="font-semibold">Compact the current task?</span>
		<span className="text-xs text-description">
			Replaces the conversation history with a summary to free up context window space.
		</span>
		<span className="flex justify-end gap-1.5">
			<VSCodeButton
				appearance="secondary"
				className="text-sm"
				onClick={onCancel}
				title="No, keep the task as is"
				type="button">
				Cancel
			</VSCodeButton>
			<VSCodeButton
				appearance="primary"
				autoFocus={true}
				className="text-sm"
				onClick={onConfirm}
				title="Yes, compact the task"
				type="button">
				Compact
			</VSCodeButton>
		</span>
	</div>
))
ConfirmationDialog.displayName = "ConfirmationDialog"

const ContextWindow: React.FC<ContextWindowProgressProps> = ({
	contextWindow = 0,
	lastApiReqContextInputTokens = 0,
	lastApiReqTotalTokens: _lastApiReqTotalTokens = 0,
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-first-pass): W is the authoritative
	// current-working-context estimate. See the prop
	// docstring above for the precedence rules.
	currentWorkingContextEstimate,
	onSendMessage,
	useAutoCondense,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
}) => {
	const [isOpened, setIsOpened] = useState(false)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)
	const progressBarRef = useRef<HTMLDivElement>(null)

	const handleCompactClick = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			setConfirmationNeeded(!confirmationNeeded)
		},
		[confirmationNeeded],
	)

	const handleConfirm = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		// Trigger a real SDK manual compaction rather than sending the literal
		// text "/compact" to the model (which it would treat as a normal prompt
		// and improvise a fake summary — CLINE-2503). The condense RPC runs the
		// same SDK compaction effect as the CLI's `/compact` command.
		SlashServiceClient.condense(StringRequest.create({ value: "compact" })).catch((err) =>
			console.error("Failed to compact task:", err),
		)
		setConfirmationNeeded(false)
	}, [])

	const handleCancel = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded(false)
	}, [])

	const tokenData = useMemo(() => {
		if (!contextWindow) {
			return null
		}
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
		// (twenty-first-pass) — Boundary 5 numerator
		// precedence:
		//
		//   1. currentWorkingContextEstimate === number
		//      → numerator = W (runtime-published
		//        occupancy of the next request).
		//   2. currentWorkingContextEstimate === undefined
		//      → "never set / omitted". Legacy /
		//        classic / pre-runtime path. Fall
		//        back to P
		//        (lastApiReqContextInputTokens) so
		//        classic tasks keep working. The
		//        carrier contract uses `undefined`
		//        as the omission marker; the
		//        production carrier assigns
		//        `ExtensionState.currentWorkingContext
		//        Estimate` explicitly to a number or
		//        null at every runtime event, so
		//        `undefined` only persists when the
		//        carrier is absent (legacy path).
		//   3. currentWorkingContextEstimate === null
		//      → runtime is active but the latest
		//        event carried no W. Reviewer
		//        twentieth-pass fallback B: render
		//        UNAVAILABLE. P must not masquerade
		//        as W. P and W are explicitly
		//        different authorities; silently
		//        substituting the disjoint-sum P
		//        for the runtime-published W would
		//        recreate the semantic category
		//        error this chain has been
		//        eliminating.
		//
		// The previous ACT-CLINEMM-CONTEXT-
		// ACCOUNTING-TRUTH01 (CORRECTION01) semantic
		// (provider-normalized input tokens / window)
		// is preserved for the legacy path. No
		// estimator is used; transport-only.
		let numerator: number
		if (typeof currentWorkingContextEstimate === "number") {
			numerator = currentWorkingContextEstimate
		} else if (currentWorkingContextEstimate === null) {
			// Reviewer's strict fallback B: when
			// the runtime is active but W is
			// explicitly cleared (no-W event), the
			// bar is unavailable. P must not
			// masquerade as W.
			return null
		} else {
			// `undefined` = "never set" (legacy /
			// classic path / pre-runtime). Preserve
			// the existing P-based bar so classic
			// tasks keep working.
			numerator = lastApiReqContextInputTokens
		}
		return {
			// Round to integer percent for display —
			// matches the existing ContextWindow
			// behavior (see "uses
			// lastApiReqContextInputTokens" tests:
			// 20_000 / 200_000 = 10). Raw floats
			// (e.g. 135.6685) leak ugly precision in
			// the progressbar tooltip and the
			// "X%" label.
			percentage: Math.round((numerator / contextWindow) * 100),
			max: contextWindow,
			used: numerator,
		}
	}, [
		contextWindow,
		lastApiReqContextInputTokens,
		currentWorkingContextEstimate,
	])

	const debounceCloseHover = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		const showHover = debounce((open: boolean) => setIsOpened(open), 100)

		return showHover(false)
	}, [])

	const handleFocus = useCallback(() => {
		setIsOpened(true)
	}, [])

	// Close tooltip when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Element
			const isInsideProgressBar = progressBarRef.current?.contains(target as Node)

			// Check if click is inside any tooltip content by looking for our custom class
			const isInsideTooltipContent = target.closest(".context-window-tooltip-content") !== null

			if (!isInsideProgressBar && !isInsideTooltipContent) {
				setIsOpened(false)
			}
		}

		if (isOpened) {
			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpened])

	if (!tokenData) {
		return null
	}

	return (
		<div className="flex flex-col mt-1.5" onMouseLeave={debounceCloseHover}>
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<span className="cursor-pointer text-sm" title="Current tokens used in this request">
						{formatTokenNumber(tokenData.used)}
					</span>
					<div className="flex relative items-center gap-1 flex-1 w-full h-full" onMouseEnter={() => setIsOpened(true)}>
						<HoverCard>
							<HoverCardContent className="bg-menu rounded-xs shadow-sm">
								<ContextWindowSummary
									cacheReads={cacheReads}
									cacheWrites={cacheWrites}
									contextWindow={tokenData.max}
									percentage={tokenData.percentage}
									tokensIn={tokensIn}
									tokensOut={tokensOut}
									tokenUsed={tokenData.used}
								/>
							</HoverCardContent>
							<HoverCardTrigger asChild>
								{/* TODO: Re-add role="slider", aria-value*, onKeyDown, onClick, and tabIndex
								    when click-to-set-threshold is implemented. See PR #9348 for context. */}
								<div
									className="relative w-full text-foreground context-window-progress brightness-100"
									onFocus={handleFocus}
									ref={progressBarRef}>
									<Progress
										aria-label="Context window usage progress"
										color="success"
										value={tokenData.percentage}
									/>
									{isOpened}
								</div>
							</HoverCardTrigger>
						</HoverCard>
					</div>
					<span className="cursor-pointer text-sm" title="Maximum context window size for this model">
						{formatTokenNumber(tokenData.max)}
					</span>
				</div>
				<CompactTaskButton onClick={handleCompactClick} />
			</div>
			{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
		</div>
	)
}

export default memo(ContextWindow)
