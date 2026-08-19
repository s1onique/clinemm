import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_PLATFORM, type ExtensionState } from "@shared/ExtensionMessage"
import {
	disablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnostic,
	getPostTerminalAuthorityDiagnosticRecords,
	isPostTerminalAuthorityDiagnosticEnabled,
	type PostTerminalAuthorityCaptureKind,
	type PostTerminalAuthoritySnapshot,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"

// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1
//
// Pure helper that builds a PostTerminalAuthoritySnapshot for the webview side.
// The webview does NOT have the `ArbiterSnapshot` shape on the wire (the
// shadow lives only in the extension host), so the shadow-derived fields
// are simply absent on the webview side. The legacy turnStateTracker,
// thinkingPresentation, taskTelemetry, and the post-reducer `newState` are
// captured here.
//
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
// The webview NEVER derives the push ID independently. It reads
// `rawStateData._ptadPushId` (the extension's monotonic push counter
// stamped into the wire payload) and propagates it verbatim into the
// diagnostic record so `_ptadPushId` equality proves same-push
// correlation across the realm boundary. When PTAD is disabled the
// field is undefined on the wire and the diagnostic record carries
// `undefined`.
//
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH:
// This helper is the SINGLE capture-site factory. It stamps
// `rawIncoming*` from `rawStateData` and `applied*` (and the existing
// `legacyPhase`/`legacySeq` / `thinkingPresentation` / `taskTelemetry`)
// from `newState` so a single dump correlates raw + applied truth on
// the same `_ptadPushId`. For captureKinds where one side is not
// meaningful (e.g. `webview-raw-incoming` has no `applied*` because the
// reducer has not run yet), the corresponding fields are simply absent.
//
// The capture is OPT-IN: the diagnostic is a complete no-op when
// isPostTerminalAuthorityDiagnosticEnabled("webview") === false.
// ============================================================================
function buildWebviewSnapshot(
	newState: ExtensionState,
	rawStateData: ExtensionState,
	captureKind: PostTerminalAuthorityCaptureKind,
): PostTerminalAuthoritySnapshot {
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH:
	// Raw incoming payload fields, read from `rawStateData` BEFORE the
	// reducer mutates it. These are stamped on BOTH the raw and the
	// applied capture so a single dump correlates them.
	const rawIncomingLegacyPhase = rawStateData.turnState?.phase
	const rawIncomingLegacySeq = rawStateData.turnState?.seq
	const rawIncomingThinkingPresentation = rawStateData.thinkingPresentation
	const rawIncomingTaskTelemetry = rawStateData.taskTelemetry

	// The `webview-raw-incoming` capture is stamped BEFORE the reducer
	// runs, so `newState` is the same `rawStateData` we already received
	// and the post-reducer `applied*` aliases are meaningless on this
	// record. We still emit `legacyPhase`/`legacySeq` as `undefined` so
	// the type stays uniform; the explicit `appliedLegacyPhase` /
	// `appliedLegacySeq` fields are omitted on the raw capture.
	const isRaw = captureKind === "webview-raw-incoming"

	return {
		origin: "webview",
		captureKind,
		stateVersion: newState.stateVersion ?? rawStateData.stateVersion ?? 0,
		_ptadPushId: newState._ptadPushId ?? rawStateData._ptadPushId,
		capturedAt: Date.now(),
		epoch: newState.epoch ?? rawStateData.epoch,
		sessionId: undefined,
		taskId: newState.currentTaskItem?.id,
		// Post-reducer applied values (the legacy contract).
		legacyPhase: isRaw ? undefined : newState.turnState?.phase,
		legacySeq: isRaw ? undefined : newState.turnState?.seq,
		legacyAnchorTs: isRaw ? undefined : newState.turnState?.anchorTs,
		// Explicit applied view, identical to legacyPhase / legacySeq
		// but self-documenting for forensic analysis.
		appliedLegacyPhase: isRaw ? undefined : newState.turnState?.phase,
		appliedLegacySeq: isRaw ? undefined : newState.turnState?.seq,
		thinkingPresentation: isRaw ? undefined : newState.thinkingPresentation,
		taskTelemetry: isRaw ? undefined : newState.taskTelemetry,
		// Raw incoming view (always stamped on both raw and applied records).
		rawIncomingLegacyPhase,
		rawIncomingLegacySeq,
		rawIncomingThinkingPresentation,
		rawIncomingTaskTelemetry,
	}
}

import { DEFAULT_MCP_DISPLAY_MODE } from "@shared/McpDisplayMode"
import type { UserInfo } from "@shared/proto/cline/account"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { OpenRouterCompatibleModelInfo, ProviderModelsResponse } from "@shared/proto/cline/models"
import { OnboardingModelGroup, type TerminalProfile } from "@shared/proto/cline/state"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fromProtobufModels } from "@shared/proto-conversions/models/typeConversion"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import {
	type ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import { Environment } from "../../../src/shared/config-types"
import type { McpServer, McpViewTab } from "../../../src/shared/mcp"
import {
	createReplicaState,
	type ReplicaState,
	applyMessage as reducerApplyMessage,
	applyStateSnapshot as reducerApplyStateSnapshot,
} from "../components/chat/chat-view/messageReducer"
import { McpServiceClient, ModelsServiceClient, StateServiceClient, UiServiceClient } from "../services/grpc-client"

export type ProviderId = string

interface ProviderModelsState {
	providerId: ProviderId
	models: Record<string, ModelInfo>
	defaultModelId: string
	configFingerprint: string
	requestId: string
	source?: string
	fetchedAt: number
	isLoading: boolean
	isStale: boolean
	error?: string
}

export interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	onboardingModels: OnboardingModelGroup | undefined
	openRouterModels: Record<string, ModelInfo>
	vercelAiGatewayModels: Record<string, ModelInfo>
	hicapModels: Record<string, ModelInfo>
	liteLlmModels: Record<string, ModelInfo>
	openAiModels: string[]
	requestyModels: Record<string, ModelInfo>
	groqModels: Record<string, ModelInfo>
	basetenModels: Record<string, ModelInfo>
	huggingFaceModels: Record<string, ModelInfo>
	providerModelsByProvider: Partial<Record<ProviderId, ProviderModelsState>>
	latestModelRequestIdByProvider: Partial<Record<ProviderId, string>>
	mcpServers: McpServer[]
	totalTasksSize: number | null
	lastDismissedCliBannerVersion: number
	dismissedBanners?: Array<{ bannerId: string; dismissedAt: number }>

	availableTerminalProfiles: TerminalProfile[]

	// View state
	showMarketplace: boolean
	showMcp: boolean
	mcpTab?: McpViewTab
	showSettings: boolean
	settingsTargetSection?: string
	settingsInitialModelTab?: "recommended" | "free"
	showHistory: boolean
	showAccount: boolean
	showWorktrees: boolean
	showAnnouncement: boolean
	expandTaskHeader: boolean

	// Setters
	setShowAnnouncement: (value: boolean) => void
	setShouldShowAnnouncement: (value: boolean) => void
	setMcpServers: (value: McpServer[]) => void
	setRequestyModels: (value: Record<string, ModelInfo>) => void
	setGroqModels: (value: Record<string, ModelInfo>) => void
	setBasetenModels: (value: Record<string, ModelInfo>) => void
	setHuggingFaceModels: (value: Record<string, ModelInfo>) => void
	setGlobalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCursorRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalAgentsRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalSkillsToggles: (toggles: Record<string, boolean>) => void
	setLocalSkillsToggles: (toggles: Record<string, boolean>) => void
	setRemoteRulesToggles: (toggles: Record<string, boolean>) => void
	setRemoteWorkflowToggles: (toggles: Record<string, boolean>) => void
	setTotalTasksSize: (value: number | null) => void
	setExpandTaskHeader: (value: boolean) => void
	setShowWelcome: (value: boolean) => void
	setOnboardingModels: (value: OnboardingModelGroup | undefined) => void
	startProviderModelsRequest: (providerId: ProviderId, requestId: string) => void
	applyProviderModelsResponse: (response: ProviderModelsResponse) => void

	// Refresh functions
	refreshOpenRouterModels: () => void
	refreshVercelAiGatewayModels: () => void
	refreshHicapModels: () => void
	refreshLiteLlmModels: () => Promise<void>
	setUserInfo: (userInfo?: UserInfo) => void

	// Navigation state setters
	setShowMarketplace: (value: boolean) => void
	setShowMcp: (value: boolean) => void
	setMcpTab: (tab?: McpViewTab) => void

	// Navigation functions
	navigateToMarketplace: () => void
	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: (targetSection?: string) => void
	navigateToSettingsModelPicker: (opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToWorktrees: () => void
	navigateToChat: () => void

	// Hide functions
	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	hideWorktrees: () => void
	hideAnnouncement: () => void
	closeMarketplaceView: () => void
	closeMcpView: () => void

	// Event callbacks
	onRelinquishControl: (callback: () => void) => () => void
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
	children: React.ReactNode
}> = ({ children }) => {
	// UI view state
	const [showMarketplace, setShowMarketplace] = useState(false)
	const [showMcp, setShowMcp] = useState(false)
	const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)
	const [showSettings, setShowSettings] = useState(false)
	const [settingsTargetSection, setSettingsTargetSection] = useState<string | undefined>(undefined)
	const [settingsInitialModelTab, setSettingsInitialModelTab] = useState<"recommended" | "free" | undefined>(undefined)
	const [showHistory, setShowHistory] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showWorktrees, setShowWorktrees] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	// Helper for MCP view
	const closeMcpView = useCallback(() => {
		setShowMcp(false)
		setMcpTab(undefined)
	}, [setShowMcp, setMcpTab])
	const closeMarketplaceView = useCallback(() => {
		setShowMarketplace(false)
	}, [])

	// Hide functions
	const hideSettings = useCallback(() => {
		setShowSettings(false)
		setSettingsTargetSection(undefined)
		setSettingsInitialModelTab(undefined)
	}, [])
	const hideHistory = useCallback(() => setShowHistory(false), [setShowHistory])
	const hideAccount = useCallback(() => setShowAccount(false), [setShowAccount])
	const hideWorktrees = useCallback(() => setShowWorktrees(false), [setShowWorktrees])
	const hideAnnouncement = useCallback(() => setShowAnnouncement(false), [setShowAnnouncement])

	// Navigation functions
	const navigateToMcp = useCallback(
		(tab?: McpViewTab) => {
			setShowSettings(false)
			setShowHistory(false)
			setShowAccount(false)
			setShowWorktrees(false)
			closeMcpView()
			if (tab) {
				setMcpTab(tab)
			}
			setShowMarketplace(true)
		},
		[closeMcpView, setMcpTab, setShowSettings, setShowHistory, setShowAccount, setShowWorktrees],
	)

	const navigateToMarketplace = useCallback(() => {
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
		setShowWorktrees(false)
		setShowMarketplace(true)
	}, [closeMcpView])

	const navigateToSettings = useCallback(
		(targetSection?: string) => {
			closeMarketplaceView()
			setShowHistory(false)
			closeMcpView()
			setShowAccount(false)
			setShowWorktrees(false)
			setSettingsTargetSection(targetSection)
			setSettingsInitialModelTab(undefined)
			setShowSettings(true)
		},
		[closeMarketplaceView, closeMcpView],
	)

	const navigateToSettingsModelPicker = useCallback(
		(opts: { targetSection?: string; initialModelTab?: "recommended" | "free" }) => {
			closeMarketplaceView()
			setShowHistory(false)
			closeMcpView()
			setShowAccount(false)
			setShowWorktrees(false)
			setSettingsTargetSection(opts.targetSection)
			setSettingsInitialModelTab(opts.initialModelTab)
			setShowSettings(true)
		},
		[closeMarketplaceView, closeMcpView],
	)

	const navigateToHistory = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowAccount(false)
		setShowWorktrees(false)
		setShowHistory(true)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowAccount, setShowWorktrees, setShowHistory])

	const navigateToAccount = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowWorktrees(false)
		setShowAccount(true)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowHistory, setShowWorktrees, setShowAccount])

	const navigateToWorktrees = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
		setShowWorktrees(true)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowHistory, setShowAccount, setShowWorktrees])

	const navigateToChat = useCallback(() => {
		closeMarketplaceView()
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
		setShowWorktrees(false)
	}, [closeMarketplaceView, setShowSettings, closeMcpView, setShowHistory, setShowAccount, setShowWorktrees])

	const [state, setState] = useState<ExtensionState>({
		version: "",
		clineMessages: [],
		queuedPrompts: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		preferredLanguage: "English",
		mode: "act",
		platform: DEFAULT_PLATFORM,
		environment: Environment.production,
		telemetrySetting: "unset",
		distinctId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: false,
		onboardingModels: undefined,
		mcpResponsesCollapsed: false, // Default value (expanded), will be overwritten by extension state
		useAutoCondense: true,
		compactionStrategy: "basic",
		webSearchEnabled: false,
		subagentsEnabled: false,
		worktreesEnabled: { user: true, featureFlag: false },
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		optOutOfRemoteConfig: false,
		remoteConfigSettings: {},
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		foregroundCommandRunning: false,
		lastDismissedCliBannerVersion: 0,
		backgroundEditEnabled: false,
		showFeatureTips: false,
		globalSkillsToggles: {},
		localSkillsToggles: {},

		// NEW: Add workspace information with defaults
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		// ACT-CLINEMM-SESSION-AUTONOMY01:
		// Webview is a pure mirror of the host-owned session override state.
		// Default is inactive; the host pushes the real snapshot.
		sessionAutoApproval: { override: "none", sessionId: undefined },
		sessionAutonomy: { override: "none", sessionId: undefined },
		// CORRECTION01: one-shot pre-arm intent. Default inactive.
		sessionAutoApprovalArmed: "none",
		hooksEnabled: false,
	})
	const [expandTaskHeader, setExpandTaskHeader] = useState(true)
	const [didHydrateState, setDidHydrateState] = useState(false)

	const [showWelcome, setShowWelcome] = useState(false)
	const [onboardingModels, setOnboardingModels] = useState<OnboardingModelGroup | undefined>(undefined)

	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [vercelAiGatewayModels, setVercelAiGatewayModels] = useState<Record<string, ModelInfo>>({})
	const [hicapModels, setHicapModels] = useState<Record<string, ModelInfo>>({})
	const [liteLlmModels, setLiteLlmModels] = useState<Record<string, ModelInfo>>({})
	const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)
	const [availableTerminalProfiles, setAvailableTerminalProfiles] = useState<TerminalProfile[]>([])

	const [openAiModels, _setOpenAiModels] = useState<string[]>([])
	const [requestyModels, setRequestyModels] = useState<Record<string, ModelInfo>>({
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	})
	// Groq and Baseten model lists start empty. The pickers populate them
	// from two sources: the SDK catalog over gRPC (`useProviderModels`)
	// for the curated set, and the host-side refresh RPCs
	// (`ModelsServiceClient.refreshGroqModelsRpc`,
	// `ModelsServiceClient.refreshBasetenModels`) for any models the
	// live API exposes on top of the SDK catalog.
	const [groqModelsState, setGroqModels] = useState<Record<string, ModelInfo>>({})
	const [basetenModelsState, setBasetenModels] = useState<Record<string, ModelInfo>>({})
	const [huggingFaceModels, setHuggingFaceModels] = useState<Record<string, ModelInfo>>({})
	const [providerModelsByProvider, setProviderModelsByProvider] = useState<Partial<Record<ProviderId, ProviderModelsState>>>({})
	const [latestModelRequestIdByProvider, setLatestModelRequestIdByProvider] = useState<Partial<Record<ProviderId, string>>>({})
	const latestModelRequestIdByProviderRef = useRef<Partial<Record<ProviderId, string>>>({})
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])

	const startProviderModelsRequest = useCallback((providerId: ProviderId, requestId: string) => {
		latestModelRequestIdByProviderRef.current = { ...latestModelRequestIdByProviderRef.current, [providerId]: requestId }
		setLatestModelRequestIdByProvider((prev) => ({ ...prev, [providerId]: requestId }))
		setProviderModelsByProvider((prev) => ({
			...prev,
			[providerId]: {
				...(prev[providerId] ?? {
					providerId,
					models: {},
					defaultModelId: "",
					configFingerprint: "",
					fetchedAt: 0,
					isStale: false,
				}),
				providerId,
				requestId,
				isLoading: true,
				error: undefined,
			},
		}))
	}, [])

	const applyProviderModelsResponse = useCallback((response: ProviderModelsResponse) => {
		setProviderModelsByProvider((prevModels) => {
			const latestRequestId = latestModelRequestIdByProviderRef.current[response.providerId]
			if (latestRequestId !== response.requestId) {
				console.debug("Dropping stale provider models response", {
					providerId: response.providerId,
					requestId: response.requestId,
					latestRequestId,
				})
				return prevModels
			}

			return {
				...prevModels,
				[response.providerId]: {
					providerId: response.providerId,
					models: response.ok ? fromProtobufModels(response.models) : {},
					defaultModelId: response.defaultModelId ?? "",
					configFingerprint: response.configFingerprint,
					requestId: response.requestId,
					source: response.source,
					fetchedAt: response.fetchedAt,
					isLoading: false,
					isStale: false,
					error: response.ok ? undefined : response.error?.message,
				},
			}
		})
	}, [])

	// References to store subscription cancellation functions
	const stateSubscriptionRef = useRef<(() => void) | null>(null)

	const marketplaceButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const mcpButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const historyButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const chatButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const accountButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const settingsButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const worktreesButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const partialMessageUnsubscribeRef = useRef<(() => void) | null>(null)
	const openRouterModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const liteLlmModelsUnsubscribeRef = useRef<(() => void) | null>(null)
	const workspaceUpdatesUnsubscribeRef = useRef<(() => void) | null>(null)
	const relinquishControlUnsubscribeRef = useRef<(() => void) | null>(null)

	// Add ref for callbacks
	const relinquishControlCallbacks = useRef<Set<() => void>>(new Set())

	// Create hook function
	const onRelinquishControl = useCallback((callback: () => void) => {
		relinquishControlCallbacks.current.add(callback)
		return () => {
			relinquishControlCallbacks.current.delete(callback)
		}
	}, [])
	const mcpServersSubscriptionRef = useRef<(() => void) | null>(null)
	// Convergent-replica state for clineMessages. The partial-message stream and the full state
	// snapshots both feed this reducer so the transcript converges correctly regardless of
	// arrival order, duplication, or loss. See messageReducer.ts.
	const replicaRef = useRef<ReplicaState>(createReplicaState())

	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
	// FIXUP03 introduced a per-pushId reducer-output queue
	// (`pendingAppliedByPushRef`) and a drain effect that emitted
	// `webview-reducer-output` captures. The functional updater wrote
	// to this ref map, which is an externally observable side effect
	// inside what React's contract requires to be a pure calculate-and-
	// return function. The reviewer (R9) flagged this as a React
	// contract violation.
	//
	// FIXUP04 removes the queue and the drain effect entirely. The W1
	// updater is now a pure calculate-and-return function. No PTAD or
	// diagnostic side effects inside the updater body.
	//
	// The diagnostic now captures only two observable boundaries on the
	// webview side:
	//   - webview-raw-incoming : wire-side arrival (per onResponse call)
	//   - webview-committed    : React-committed state (per commit,
	//                            keyed on the LATEST pushId)
	//
	// Intermediate reducer outputs are no longer captured. Reasoning
	// about them in the live walk uses the offline-qualified C2R pure
	// reducer replay.

	// Subscribe to state updates and UI events using the gRPC streaming API
	useEffect(() => {
		// Set up state subscription
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(EmptyRequest.create({}), {
			onResponse: (response: any) => {
				if (response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson) as ExtensionState
						// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION02:
						// Toggle symmetry fix: enable when `_ptadEnabled === true`,
						// disable when the bit is missing or false. The wire bit is
						// undefined in production (no toggle ever fired), so the
						// default-off path is the no-op path.
						const ptadEnabled = stateData._ptadEnabled === true
						const webviewRecorderOn = isPostTerminalAuthorityDiagnosticEnabled("webview")
						if (ptadEnabled && !webviewRecorderOn) {
							enablePostTerminalAuthorityDiagnostic("webview")
						} else if (!ptadEnabled && webviewRecorderOn) {
							disablePostTerminalAuthorityDiagnostic("webview")
						}

						// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
						// RAW capture + R5 fail-closed pushId check. The capture is
						// OPT-IN: when the workspace-state PTAD toggle is OFF
						// (production default), this if-branch is skipped and the
						// wire shape and production path semantics are byte-for-byte
						// unchanged.
						//
						// R5 (FAIL CLOSED): if `_ptadPushId` is undefined, the diagnostic
						// cannot correlate the capture to any push id, so we log and
						// emit the RAW capture (with `_ptadPushId = undefined`).
						// There is no reducer-output capture to fail-close on
						// (FIXUP04 removed that intermediate kind); the forensic
						// chain is preserved as "raw only" with an explicit log
						// entry.
						if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
							const pushId = stateData._ptadPushId
							if (pushId === undefined) {
								console.error(
									"[PTAD] webview raw capture without _ptadPushId — failing closed; correlation will be missing",
								)
							}
							recordPostTerminalAuthoritySnapshot(
								buildWebviewSnapshot(stateData, stateData, "webview-raw-incoming"),
							)
						}

						// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
						// R9 (PURE UPDATER): the snapshot reducer is now invoked from
						// inside a FUNCTIONAL UPDATER that contains NO PTAD or
						// diagnostic side effects. The updater body:
						//   1. reads `prevState` (React-authoritative, satisfies R6)
						//   2. calls the reducer (pure derive-next-state)
						//   3. calls existing setShowWelcome / setOnboardingModels /
						//      setDidHydrateState setters (PRE_EXISTING side effects,
						//      out of FIXUP04 scope; these were there before PTAD)
						//   4. returns newState
						// Nothing else. The reducer output is NOT captured; the
						// committed-state capture (webview-committed) is emitted
						// from a separate post-commit useEffect keyed on [state].
						//
						// R6 (REACT AUTHORITY): the functional updater receives
						// React-authoritative prevState. W1 (snapshot), W2 (partial
						// message), and W3 (local setters) all use the
						// functional-updater form. React's documented queue
						// semantics ensure each queued updater receives the prior
						// queued result. No parallel authority.
						setState((prevState) => {
							// Versioning logic for autoApprovalSettings
							const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
							const currentVersion = prevState.autoApprovalSettings?.version ?? 1
							const shouldUpdateAutoApproval = incomingVersion > currentVersion

							// Route the snapshot's transcript through the convergent-replica reducer:
							// merge by ts/seq within the same epoch (never truncate), replace on a
							// newer epoch, ignore stale/older snapshots. Unstamped (classic/legacy)
							// state defaults to epoch 0 / version 0, which merges.
							replicaRef.current = reducerApplyStateSnapshot(
								replicaRef.current,
								stateData.clineMessages ?? [],
								stateData.epoch ?? 0,
								stateData.stateVersion ?? 0,
								stateData.turnState,
							)
							stateData.clineMessages = replicaRef.current.messages
							// Use the seq-gated turnState from the replica, NOT the raw snapshot's, so a
							// late/stale snapshot carrying an older phase (e.g. "idle") cannot revert a
							// newer phase (e.g. "streaming") and hide the Cancel button. Falls back to
							// undefined for classic/legacy state.
							stateData.turnState = replicaRef.current.turnState

							const newState: ExtensionState = {
								...stateData,
								autoApprovalSettings: shouldUpdateAutoApproval
									? stateData.autoApprovalSettings
									: prevState.autoApprovalSettings,
							}

							// Update welcome screen state based on API configuration if welcome view not in progress
							if (!newState.welcomeViewCompleted && !showWelcome) {
								setShowWelcome(true)
								setOnboardingModels(newState.onboardingModels)
							} else if (newState.welcomeViewCompleted) {
								setShowWelcome(false)
								setOnboardingModels(undefined)
							}

							setDidHydrateState(true)

							// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
							// Pure updater: return newState. No PTAD or diagnostic
							// side effects. The committed-state capture is emitted
							// from the post-commit useEffect below.
							return newState
						})
					} catch (error) {
						console.error("Error parsing state JSON:", error)
						console.log("[DEBUG] ERR getting state", error)
					}
				}
				console.log('[DEBUG] ended "got subscribed state"')
			},
			onError: (error: any) => {
				console.error("Error in state subscription:", error)
			},
			onComplete: () => {
				console.log("State subscription completed")
			},
		})

		// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
		// Listen for the extension-side dump trigger. The extension posts
		// `{type: "clinemm.dumpPostTerminalAuthorityDiagnostic"}` to the webview;
		// on receipt, the webview flushes its ring buffer back via
		// `{type: "clinemm.appendPostTerminalAuthorityDiagnostic", ...records}`.
		// We read the records from the module-level ring buffer (which is
		// opt-in only — so in production this listener never produces
		// outgoing traffic).
		const dumpMessageHandler = (event: MessageEvent) => {
			const data = event.data as { type?: string } | undefined
			if (!data || data.type !== "clinemm.dumpPostTerminalAuthorityDiagnostic") {
				return
			}
			const records = getPostTerminalAuthorityDiagnosticRecords("webview")
			const api = (window as unknown as { __clineVsCodeApi?: { postMessage: (m: unknown) => void } }).__clineVsCodeApi
			if (!api) {
				console.error("[PTAD] webview flush skipped: __clineVsCodeApi not available")
				return
			}
			api.postMessage({
				type: "clinemm.appendPostTerminalAuthorityDiagnostic",
				clinemm_postTerminalAuthorityDiagnosticRecords: records,
			})
		}
		window.addEventListener("message", dumpMessageHandler)
		// We do not need to remove this listener on cleanup because the
		// whole window is torn down with the webview; the gRPC stream
		// unsubscribe already handles the state-subscription lifecycle.

		// Subscribe to MCP button clicked events with webview type
		mcpButtonUnsubscribeRef.current = UiServiceClient.subscribeToMcpButtonClicked(
			{},
			{
				onResponse: () => {
					console.log("[DEBUG] Received mcpButtonClicked event from gRPC stream")
					navigateToMarketplace()
				},
				onError: (error: any) => {
					console.error("Error in mcpButtonClicked subscription:", error)
				},
				onComplete: () => {
					console.log("mcpButtonClicked subscription completed")
				},
			},
		)

		marketplaceButtonUnsubscribeRef.current = UiServiceClient.subscribeToMarketplaceButtonClicked(EmptyRequest.create({}), {
			onResponse: () => {
				console.log("[DEBUG] Received marketplaceButtonClicked event from gRPC stream")
				navigateToMarketplace()
			},
			onError: (error: any) => {
				console.error("Error in marketplaceButtonClicked subscription:", error)
			},
			onComplete: () => {
				console.log("marketplaceButtonClicked subscription completed")
			},
		})

		// Set up history button clicked subscription with webview type
		historyButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToHistoryButtonClicked(
			{},
			{
				onResponse: () => {
					// When history button is clicked, navigate to history view
					console.log("[DEBUG] Received history button clicked event from gRPC stream")
					navigateToHistory()
				},
				onError: (error: any) => {
					console.error("Error in history button clicked subscription:", error)
				},
				onComplete: () => {
					console.log("History button clicked subscription completed")
				},
			},
		)

		// Subscribe to chat button clicked events with webview type
		chatButtonUnsubscribeRef.current = UiServiceClient.subscribeToChatButtonClicked(
			{},
			{
				onResponse: () => {
					// When chat button is clicked, navigate to chat
					console.log("[DEBUG] Received chat button clicked event from gRPC stream")
					navigateToChat()
				},
				onError: (error: any) => {
					console.error("Error in chat button subscription:", error)
				},
				onComplete: () => {},
			},
		)

		// Subscribe to MCP servers updates
		mcpServersSubscriptionRef.current = McpServiceClient.subscribeToMcpServers(EmptyRequest.create(), {
			onResponse: (response: any) => {
				console.log("[DEBUG] Received MCP servers update from gRPC stream")
				if (response.mcpServers) {
					setMcpServers(convertProtoMcpServersToMcpServers(response.mcpServers))
				}
			},
			onError: (error: any) => {
				console.error("Error in MCP servers subscription:", error)
			},
			onComplete: () => {
				console.log("MCP servers subscription completed")
			},
		})

		// Set up settings button clicked subscription
		settingsButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToSettingsButtonClicked(EmptyRequest.create({}), {
			onResponse: () => {
				// When settings button is clicked, navigate to settings
				navigateToSettings()
			},
			onError: (error: any) => {
				console.error("Error in settings button clicked subscription:", error)
			},
			onComplete: () => {
				console.log("Settings button clicked subscription completed")
			},
		})

		// Set up worktrees button clicked subscription
		worktreesButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToWorktreesButtonClicked(
			EmptyRequest.create({}),
			{
				onResponse: () => {
					// When worktrees button is clicked, navigate to worktrees
					navigateToWorktrees()
				},
				onError: (error: any) => {
					console.error("Error in worktrees button clicked subscription:", error)
				},
				onComplete: () => {
					console.log("Worktrees button clicked subscription completed")
				},
			},
		)

		// Subscribe to partial message events
		partialMessageUnsubscribeRef.current = UiServiceClient.subscribeToPartialMessage(EmptyRequest.create({}), {
			onResponse: (protoMessage: any) => {
				try {
					// Validate critical fields
					if (!protoMessage.ts || protoMessage.ts <= 0) {
						console.error("Invalid timestamp in partial message:", protoMessage)
						return
					}

					const partialMessage = convertProtoToClineMessage(protoMessage)
					setState((prevState) => {
						// Route through the convergent-replica reducer: merge by ts keeping the
						// higher seq, fence stale epochs, never let an out-of-order or duplicate
						// delivery corrupt the transcript. Unstamped (classic/legacy) messages
						// default to epoch 0 and merge by ts as before.
						const before = replicaRef.current
						replicaRef.current = reducerApplyMessage(before, partialMessage)
						if (replicaRef.current === before) {
							// Stale/ignored — no change.
							return prevState
						}
						return { ...prevState, clineMessages: replicaRef.current.messages }
					})
				} catch (error) {
					console.error("Failed to process partial message:", error, protoMessage)
				}
			},
			onError: (error: any) => {
				console.error("Error in partialMessage subscription:", error)
			},
			onComplete: () => {
				console.log("[DEBUG] partialMessage subscription completed")
			},
		})

		// Subscribe to OpenRouter models updates
		openRouterModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToOpenRouterModels(EmptyRequest.create({}), {
			onResponse: (response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...models,
				})
			},
			onError: (error: any) => {
				console.error("Error in OpenRouter models subscription:", error)
			},
			onComplete: () => {
				console.log("OpenRouter models subscription completed")
			},
		})

		// Subscribe to LiteLLM models updates
		liteLlmModelsUnsubscribeRef.current = ModelsServiceClient.subscribeToLiteLlmModels(EmptyRequest.create({}), {
			onResponse: (response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setLiteLlmModels(models)
			},
			onError: (error: any) => {
				console.error("Error in LiteLLM models subscription:", error)
			},
			onComplete: () => {
				console.log("LiteLLM models subscription completed")
			},
		})

		// Initialize webview using gRPC
		UiServiceClient.initializeWebview(EmptyRequest.create({}))
			.then(() => {
				console.log("[DEBUG] Webview initialization completed via gRPC")
			})
			.catch((error) => {
				console.error("Failed to initialize webview via gRPC:", error)
			})

		// Set up account button clicked subscription
		accountButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToAccountButtonClicked(EmptyRequest.create(), {
			onResponse: () => {
				// When account button is clicked, navigate to account view
				console.log("[DEBUG] Received account button clicked event from gRPC stream")
				navigateToAccount()
			},
			onError: (error: any) => {
				console.error("Error in account button clicked subscription:", error)
			},
			onComplete: () => {
				console.log("Account button clicked subscription completed")
			},
		})

		// Fetch available terminal profiles on launch
		StateServiceClient.getAvailableTerminalProfiles(EmptyRequest.create({}))
			.then((response) => {
				setAvailableTerminalProfiles(response.profiles)
			})
			.catch((error) => {
				console.error("Failed to fetch available terminal profiles:", error)
			})

		// Subscribe to relinquish control events
		relinquishControlUnsubscribeRef.current = UiServiceClient.subscribeToRelinquishControl(EmptyRequest.create({}), {
			onResponse: () => {
				// Call all registered callbacks
				relinquishControlCallbacks.current.forEach((callback) => {
					callback()
				})
			},
			onError: (error: any) => {
				console.error("Error in relinquishControl subscription:", error)
			},
			onComplete: () => {},
		})

		// Clean up subscriptions when component unmounts
		return () => {
			if (stateSubscriptionRef.current) {
				stateSubscriptionRef.current()
				stateSubscriptionRef.current = null
			}
			if (mcpButtonUnsubscribeRef.current) {
				mcpButtonUnsubscribeRef.current()
				mcpButtonUnsubscribeRef.current = null
			}
			if (marketplaceButtonUnsubscribeRef.current) {
				marketplaceButtonUnsubscribeRef.current()
				marketplaceButtonUnsubscribeRef.current = null
			}
			if (historyButtonClickedSubscriptionRef.current) {
				historyButtonClickedSubscriptionRef.current()
				historyButtonClickedSubscriptionRef.current = null
			}
			if (chatButtonUnsubscribeRef.current) {
				chatButtonUnsubscribeRef.current()
				chatButtonUnsubscribeRef.current = null
			}
			if (accountButtonClickedSubscriptionRef.current) {
				accountButtonClickedSubscriptionRef.current()
				accountButtonClickedSubscriptionRef.current = null
			}
			if (settingsButtonClickedSubscriptionRef.current) {
				settingsButtonClickedSubscriptionRef.current()
				settingsButtonClickedSubscriptionRef.current = null
			}
			if (worktreesButtonClickedSubscriptionRef.current) {
				worktreesButtonClickedSubscriptionRef.current()
				worktreesButtonClickedSubscriptionRef.current = null
			}
			if (partialMessageUnsubscribeRef.current) {
				partialMessageUnsubscribeRef.current()
				partialMessageUnsubscribeRef.current = null
			}
			if (openRouterModelsUnsubscribeRef.current) {
				openRouterModelsUnsubscribeRef.current()
				openRouterModelsUnsubscribeRef.current = null
			}
			if (liteLlmModelsUnsubscribeRef.current) {
				liteLlmModelsUnsubscribeRef.current()
				liteLlmModelsUnsubscribeRef.current = null
			}
			if (workspaceUpdatesUnsubscribeRef.current) {
				workspaceUpdatesUnsubscribeRef.current()
				workspaceUpdatesUnsubscribeRef.current = null
			}
			if (relinquishControlUnsubscribeRef.current) {
				relinquishControlUnsubscribeRef.current()
				relinquishControlUnsubscribeRef.current = null
			}
			if (mcpServersSubscriptionRef.current) {
				mcpServersSubscriptionRef.current()
				mcpServersSubscriptionRef.current = null
			}
		}
	}, [])

	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
	// REMOVED in FIXUP04: the post-commit drain effect that emptied
	// `pendingAppliedByPushRef.current` and emitted
	// `webview-reducer-output` captures. This drained queue
	// represented reducer outputs that may have been discarded by
	// React (e.g., higher-priority updates superseding the render).
	// The diagnostic was therefore emitting forensic evidence for
	// transforms the user never observed.
	//
	// FIXUP04 captures only the two observable boundaries:
	//   - webview-raw-incoming  (per onResponse call, at inbound)
	//   - webview-committed     (per React commit, the true
	//                            downstream / context consumer view)
	// Intermediate reducer outputs are not captured.

	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
	// Post-commit capture of React's AUTHORITATIVE committed state.
	// This is the true downstream / context consumer view — the state
	// the React tree actually renders from. Fires once per commit;
	// under React 18+ automatic batching, the committed state is the
	// result of the LAST queued functional updater, so this capture
	// corresponds to the LATEST `_ptadPushId` only.
	//
	// R7 (VOCABULARY): the two webview capture kinds are
	//   - webview-raw-incoming : wire-side arrival (per push)
	//   - webview-committed    : React-committed state (per commit;
	//                            corresponds to the LATEST pushId)
	// The webview-reducer-output capture kind is REMOVED from the
	// PostTerminalAuthorityCaptureKind enum entirely.
	useEffect(() => {
		if (!isPostTerminalAuthorityDiagnosticEnabled("webview")) {
			return
		}
		recordPostTerminalAuthoritySnapshot(buildWebviewSnapshot(state, state, "webview-committed"))
	}, [state])

	const refreshOpenRouterModels = useCallback(() => {
		ModelsServiceClient.refreshOpenRouterModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh OpenRouter models:", error))
	}, [])

	const refreshHicapModels = useCallback(() => {
		ModelsServiceClient.refreshHicapModels(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = response.models
				setHicapModels({
					...models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh Hicap models:", error))
	}, [])

	const refreshLiteLlmModels = useCallback(() => {
		return ModelsServiceClient.refreshLiteLlmModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setLiteLlmModels(models)
			})
			.catch((error: Error) => console.error("Failed to refresh LiteLLM models:", error))
	}, [])

	const refreshBasetenModels = useCallback(() => {
		ModelsServiceClient.refreshBasetenModelsRpc(EmptyRequest.create({}))
			.then((response) => {
				// Live-fetched Baseten models. The SDK-curated catalog is
				// pulled separately by BasetenModelPicker via
				// `useProviderModels("baseten")` and merged on top of this
				// dynamic slice at render time.
				setBasetenModels(fromProtobufModels(response.models))
			})
			.catch((err) => console.error("Failed to refresh Baseten models:", err))
	}, [])

	const refreshVercelAiGatewayModels = useCallback(() => {
		ModelsServiceClient.refreshVercelAiGatewayModelsRpc(EmptyRequest.create({}))
			.then((response: OpenRouterCompatibleModelInfo) => {
				const models = fromProtobufModels(response.models)
				setVercelAiGatewayModels(models)
			})
			.catch((error: Error) => console.error("Failed to refresh Vercel AI Gateway models:", error))
	}, [])

	// Auto-refresh model lists on API key availability
	useEffect(() => {
		if (!openRouterModels || Object.keys(openRouterModels).length <= 1) {
			refreshOpenRouterModels()
		}
		if (!vercelAiGatewayModels || Object.keys(vercelAiGatewayModels).length === 0) {
			refreshVercelAiGatewayModels()
		}
		if (state.apiConfiguration?.basetenApiKey) {
			refreshBasetenModels()
		}
		if (state.apiConfiguration?.liteLlmApiKey) {
			refreshLiteLlmModels()
		}
	}, [
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		state?.apiConfiguration?.basetenApiKey,
		refreshBasetenModels,
		state?.apiConfiguration?.liteLlmApiKey,
		refreshLiteLlmModels,
	])

	const contextValue: ExtensionStateContextType = {
		...state,
		didHydrateState,
		showWelcome,
		onboardingModels,
		openRouterModels,
		vercelAiGatewayModels,
		hicapModels,
		liteLlmModels,
		openAiModels,
		requestyModels,
		groqModels: groqModelsState,
		basetenModels: basetenModelsState,
		huggingFaceModels,
		providerModelsByProvider,
		latestModelRequestIdByProvider,
		mcpServers,
		totalTasksSize,
		availableTerminalProfiles,
		showMarketplace,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		settingsInitialModelTab,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		globalClineRulesToggles: state.globalClineRulesToggles || {},
		localClineRulesToggles: state.localClineRulesToggles || {},
		localCursorRulesToggles: state.localCursorRulesToggles || {},
		localWindsurfRulesToggles: state.localWindsurfRulesToggles || {},
		localAgentsRulesToggles: state.localAgentsRulesToggles || {},
		localWorkflowToggles: state.localWorkflowToggles || {},
		globalWorkflowToggles: state.globalWorkflowToggles || {},
		remoteRulesToggles: state.remoteRulesToggles || {},
		remoteWorkflowToggles: state.remoteWorkflowToggles || {},
		enableCheckpointsSetting: state.enableCheckpointsSetting,

		// Navigation functions
		navigateToMarketplace,
		navigateToMcp,
		navigateToSettings,
		navigateToSettingsModelPicker,
		navigateToHistory,
		navigateToAccount,
		navigateToWorktrees,
		navigateToChat,

		// Hide functions
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
		closeMarketplaceView,
		setShowAnnouncement,
		setShowWelcome,
		setOnboardingModels,
		startProviderModelsRequest,
		applyProviderModelsResponse,
		setShouldShowAnnouncement: (value) =>
			setState((prevState) => ({
				...prevState,
				shouldShowAnnouncement: value,
			})),
		setMcpServers,
		setRequestyModels,
		setGroqModels,
		setBasetenModels,
		setHuggingFaceModels,
		setShowMarketplace,
		setShowMcp,
		closeMcpView,
		setGlobalClineRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalClineRulesToggles: toggles,
			})),
		setLocalClineRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localClineRulesToggles: toggles,
			})),
		setLocalCursorRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localCursorRulesToggles: toggles,
			})),
		setLocalWindsurfRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localWindsurfRulesToggles: toggles,
			})),
		setLocalAgentsRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localAgentsRulesToggles: toggles,
			})),
		setLocalWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localWorkflowToggles: toggles,
			})),
		setGlobalWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalWorkflowToggles: toggles,
			})),
		setGlobalSkillsToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalSkillsToggles: toggles,
			})),
		setLocalSkillsToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localSkillsToggles: toggles,
			})),
		setRemoteRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				remoteRulesToggles: toggles,
			})),
		setRemoteWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				remoteWorkflowToggles: toggles,
			})),
		setMcpTab,
		setTotalTasksSize,
		refreshOpenRouterModels,
		refreshVercelAiGatewayModels,
		refreshHicapModels,
		refreshLiteLlmModels,
		onRelinquishControl,
		setUserInfo: (userInfo?: UserInfo) => setState((prevState) => ({ ...prevState, userInfo })),
		expandTaskHeader,
		setExpandTaskHeader,
	}

	return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)
	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}
	return context
}
