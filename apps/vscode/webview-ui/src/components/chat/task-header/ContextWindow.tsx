import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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

type ContextUsageSource = "provider" | "estimate"

interface ContextUsageAuthority {
	readonly value: number
	readonly source: ContextUsageSource
	readonly label: string
	readonly title: string
	readonly ariaLabel: string
}

/** A token count is usable only when it is finite and non-negative. */
export function isValidContextTokenCount(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
}

/**
 * Selects the authoritative context-occupancy observation for presentation.
 *
 * Provider-reported input (P) is the observation of the last reported main
 * request. The working-context estimate (W) is a prospective next-request
 * estimate and is used only when P is unavailable. This selector never mixes,
 * averages, rescales, or synthesizes the two authorities.
 */
export function selectContextUsageAuthority(input: {
	readonly providerInputTokens?: number | null
	readonly workingContextEstimate?: number | null
}): ContextUsageAuthority | undefined {
	if (isValidContextTokenCount(input.providerInputTokens)) {
		return {
			value: input.providerInputTokens,
			source: "provider",
			label: "Provider-reported input",
			title: "Provider-reported input for the last reported request",
			ariaLabel: "Provider-reported input for the last reported request",
		}
	}
	if (isValidContextTokenCount(input.workingContextEstimate)) {
		return {
			value: input.workingContextEstimate,
			source: "estimate",
			label: "Estimated",
			title: "Estimated next-request input",
			ariaLabel: "Estimated next-request input",
		}
	}
	return undefined
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
	compactDisabled: boolean
	compactTask: () => Promise<boolean>
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
	lastApiReqContextInputTokens,
	lastApiReqTotalTokens: _lastApiReqTotalTokens = 0,
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-first-pass): W is the authoritative
	// current-working-context estimate. See the prop
	// docstring above for the precedence rules.
	currentWorkingContextEstimate,
	compactDisabled,
	compactTask,
	lastApiReqTotalTokens = 0,
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

	const handleConfirm = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			e.stopPropagation()
			void compactTask().catch((err) => console.error("Failed to compact task:", err))
			setConfirmationNeeded(false)
		},
		[compactTask],
	)

	const handleCancel = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setConfirmationNeeded(false)
	}, [])

	const tokenData = useMemo(() => {
		if (!isValidContextTokenCount(contextWindow) || contextWindow <= 0) {
			return null
		}
		const authority = selectContextUsageAuthority({
			providerInputTokens: lastApiReqContextInputTokens,
			workingContextEstimate: currentWorkingContextEstimate,
		})
		if (!authority) {
			return null
		}
		return {
			percentage: (authority.value / contextWindow) * 100,
			max: contextWindow,
			used: authority.value,
			authority,
		}
	}, [contextWindow, lastApiReqContextInputTokens, currentWorkingContextEstimate])

	const estimate = useMemo(
		() =>
			selectContextUsageAuthority({
				providerInputTokens: undefined,
				workingContextEstimate: currentWorkingContextEstimate,
			}),
		[currentWorkingContextEstimate],
	)
	const providerObservation = useMemo(
		() => selectContextUsageAuthority({ providerInputTokens: lastApiReqContextInputTokens }),
		[lastApiReqContextInputTokens],
	)

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
		return (
			<div className="flex flex-col mt-1.5">
				<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
					<div
						className="flex items-center gap-1.5 flex-1 whitespace-nowrap text-description"
						title="No provider input or working-context estimate is available">
						Context usage unavailable
					</div>
					<CompactTaskButton disabled={compactDisabled} onClick={handleCompactClick} />
				</div>
				{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
			</div>
		)
	}

	return (
		<div className="flex flex-col mt-1.5" onMouseLeave={debounceCloseHover}>
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<span
						aria-label={tokenData.authority.ariaLabel}
						className="cursor-pointer text-sm"
						data-testid="context-window-used-tokens"
						title={tokenData.authority.title}>
						{formatTokenNumber(tokenData.used)}
					</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								aria-label={tokenData.authority.ariaLabel}
								className="flex items-center border-0 bg-transparent p-0 text-xs text-description"
								data-testid="context-window-usage-authority"
								title={tokenData.authority.title}
								type="button">
								{tokenData.authority.source === "provider" ? "Prv" : "Est"}
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom">{tokenData.authority.title}</TooltipContent>
					</Tooltip>
					<div className="flex relative items-center gap-1 flex-1 w-full h-full" onMouseEnter={() => setIsOpened(true)}>
						<HoverCard>
							<HoverCardContent className="bg-menu rounded-xs shadow-sm">
								<ContextWindowSummary
									cacheReads={cacheReads}
									cacheWrites={cacheWrites}
									contextWindow={tokenData.max}
									percentage={tokenData.percentage}
									providerInputTokens={providerObservation?.value}
									tokensIn={tokensIn}
									tokensOut={tokensOut}
									tokenUsed={tokenData.used}
									usageLabel={tokenData.authority.label}
									usageTitle={tokenData.authority.title}
									workingContextEstimate={estimate?.value}
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
				<CompactTaskButton disabled={compactDisabled} onClick={handleCompactClick} />
			</div>
			{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
		</div>
	)
}

export default memo(ContextWindow)
