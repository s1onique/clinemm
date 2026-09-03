// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import type { TemporaryExternalPathAuthority } from "@cline/core"
import type { GeneratedMedia } from "@cline/shared"
import { WorkspaceRoot } from "@shared/multi-root/types"
import { RemoteConfigFields } from "@shared/storage/state-keys"
import type { Environment } from "../config"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import { ApiConfiguration } from "./api"

/**
 * ACT-CLINEMM-SESSION-AUTONOMY01:
 * Runtime mirror of the host-owned session auto-approval override.
 * The webview MUST NOT use this as the security authority — it is a
 * read-only render target.
 */
export type SessionAutoApprovalOverride = "none" | "all"

export interface SessionAutoApprovalState {
	override: SessionAutoApprovalOverride
	/**
	 * The active SDK session id when the override is bound. Undefined
	 * when inactive. The webview uses this to render "active for current task".
	 */
	sessionId?: string
}

/**
 * CORRECTION01:
 * Ephemeral pre-arm intent. When this is "all", the next task that
 * obtains its session id will be bound to the override automatically
 * (one-shot consumption). The webview renders "Armed for next task"
 * when armed !== "none".
 */
export type SessionAutoApprovalArmedState = SessionAutoApprovalOverride

import { BrowserSettings } from "./BrowserSettings"
import { ClineFeatureSetting } from "./ClineFeatureSetting"
import { BannerCardData } from "./cline/banner"
import { ClineRulesToggles } from "./cline-rules"
import { HistoryItem } from "./HistoryItem"
import { McpDisplayMode } from "./McpDisplayMode"
import { ClineMessageModelInfo } from "./messages"
import { OnboardingModelGroup } from "./proto/cline/state"
import { Mode } from "./storage/types"
import { TelemetrySetting } from "./TelemetrySetting"
import { UserInfo } from "./UserInfo"
// webview will hold state
export interface ExtensionMessage {
	type: "grpc_response" // New type for gRPC responses
	grpc_response?: GrpcResponse
}

export type GrpcResponse = {
	message?: any // JSON serialized protobuf message
	request_id: string // Same ID as the request
	error?: string // Optional error message
	is_streaming?: boolean // Whether this is part of a streaming response
	sequence_number?: number // For ordering chunks in streaming responses
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"

export const DEFAULT_PLATFORM = "unknown"

export const COMMAND_CANCEL_TOKEN = "__cline_command_cancel__"
export interface ExtensionState {
	/**
	 * ACT-CLINEMM-SESSION-AUTONOMY01:
	 * Ephemeral session-scoped auto-approval override. Never persisted.
	 * Lifecycle is owned by SdkController (cleared on clearTask/cancelTask).
	 * The webview is a pure mirror of this state — the host is the security authority.
	 */
	sessionAutoApproval?: SessionAutoApprovalState
	/**
	 * Backwards-compatible alias used by some webview consumers; same payload.
	 */
	sessionAutonomy?: SessionAutoApprovalState
	/**
	 * ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION01:
	 * One-shot pre-arm intent. When this is "all", the next task starts
	 * already bound to the session override (the arm is consumed at first
	 * session id read). The webview uses this to render "Armed for next task".
	 */
	sessionAutoApprovalArmed?: SessionAutoApprovalArmedState
	isNewUser: boolean
	welcomeViewCompleted: boolean
	onboardingModels: OnboardingModelGroup | undefined
	apiConfiguration?: ApiConfiguration
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	remoteBrowserHost?: string
	preferredLanguage?: string
	mode: Mode
	clineMessages: ClineMessage[]
	checkpointRestoreInput?: {
		text: string
		images?: string[]
		files?: string[]
		sessionId: string
	}
	/**
	 * The single authoritative UI mode for the current turn, owned by the extension. The webview
	 * renders the footer/buttons/thinking indicator from this, NOT from the tail of clineMessages.
	 * Optional for classic/legacy (absent => webview falls back to legacy tail heuristics).
	 */
	turnState?: TurnState
	/**
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: cumulative runtime-derived task
	 * metrics, owned by the host-side {@link TaskTelemetryTracker} and surfaced
	 * to the Task Header as a read-only projection.
	 *
	 * Intentionally NOT a context/token/compaction surface — that accounting
	 * stays isolated in `CONTEXT-ACCOUNTING-TRUTH01`. The webview renders
	 * "—" for the strip when this field is undefined (no canonical authority
	 * on the wire) rather than reconstructing telemetry from message prose.
	 *
	 * Lifetime: bound to a single task identity. Reset on new task. Cumulative
	 * across the visible task's multiple turns/follow-ups.
	 */
	taskTelemetry?: TaskHeaderTelemetryStrip
	/**
	 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
	 * effective diagnostic-knob state for the current extension host
	 * runtime. Computed host-side by
	 * {@link resolveEffectiveDiagnosticKnobs} from
	 * `isDogfoodRuntime()` + env overrides + the resolved V2 capture
	 * path. The webview TaskHeader indicator renders the letters V / I
	 * / A / P / D in canonical order (e.g. `"VIAPD"` for the dogfood
	 * initial render after D landed via
	 * `ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01`; `"VIAP"`
	 * was the pre-D historical value; `"VIP"` was the pre-A
	 * historical value). Hidden entirely in public (when
	 * `isDogfood === false` all five are false and the field is
	 * omitted from the UI).
	 *
	 * Wire contract: always present. Each knob is a boolean. `a`
	 * follows the same identity+env-var precedence as `i` and `p`
	 * (identity-gated, `CLINEMM_DIAG_ACTIVITY_STATE_V1` overridable,
	 * default-on in dogfood). `d` is the TSWPD gate, identity-gated
	 * and overridable via
	 * `CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE=<truthy>` (default-on
	 * in dogfood).
	 */
	diagnosticKnobs?: {
		readonly v: boolean
		readonly i: boolean
		readonly a: boolean
		readonly p: boolean
		readonly d: boolean
	}
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
	 *
	 * The webview-facing projection of the canonical TaskState shadow for
	 * Thinking/presentation. Source authority:
	 *
	 *   - LOCAL + qualified shadow available → projected from
	 *     `SdkController.getLocalShadowProjection().execution.modelStreaming`
	 *     (the same canonical mapper the wiring already produces for the
	 *     arbiter differential). Source = `"shadow"`.
	 *   - LOCAL qualified shadow absent → falls back to the legacy
	 *     `TurnStateTracker.phase === "streaming"` projection. Source =
	 *     `"legacy"` — same value the legacy `turnState` field encodes,
	 *     preserved byte-equivalent so Hub/Remote consumers see no
	 *     observable delta.
	 *
	 * The three webview `Thinking` consumers migrated in E7.1
	 * (ChatRow `case "reasoning"`, RequestStartRow inline shimmer,
	 * useThinkingLoaderRow — threaded via MessagesArea) MUST consume
	 * this field instead of reaching into `turnState.phase` directly.
	 * The TaskHeader state label (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
	 * is explicitly NOT migrated by E7.1 — its `taskHeaderStateLabel`
	 * helper consumes the full multi-phase `turnState.phase` vocabulary
	 * ("Working" / "Approval" / "Complete" / "Error" / "Paused" /
	 * "Waiting") and is left for an E7.1-2 slice. Migrating it requires
	 * a richer TurnPhase-shaped projection that is out of scope for
	 * the current ACT.
	 *
	 * The legacy `turnState` field is retained for non-thinking
	 * presentation concepts (button set, composer lockout, follow-up
	 * routing) that E7.1 explicitly does not migrate.
	 *
	 * Lifetime: stamped every `getStateToPostToWebview` push; reset on
	 * new task. Webview consumers should treat `undefined` as the
	 * legacy-safe state (no Thinking) — the canonical producer never
	 * publishes `undefined` while a controller is alive.
	 *
	 * Note: the `seq` field on the projection is stamped from
	 * `TurnStateTracker.seq` for transport-level fencing (the same
	 * monotonic seq semantics the legacy `turnState.seq` field carries),
	 * but the migrated E7.1 consumers do NOT compare it directly — the
	 * stale-push-fencing rule is applied upstream on the wire (the
	 * webview replica reducer's seq gating), not inside the consumers.
	 */
	thinkingPresentation?: ThinkingPresentationProjection
	/**
	 * ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
	 *
	 * The webview-facing TaskHeader state projection. The TaskHeader
	 * state label consumers (TaskHeaderTelemetry.tsx →
	 * taskHeaderStateLabel) consume this projection instead of
	 * `turnState.phase` directly. The projection carries the full
	 * multi-phase vocabulary (`idle` / `streaming` /
	 * `awaiting_approval` / `awaiting_followup` / `compacting` /
	 * `completed` / `error` / `resumable`) plus a provenance tag
	 * (`source: "shadow" | "host" | "legacy"`).
	 *
	 * Source authority (frozen by the THCP01 selector contract):
	 *
	 *   - `"host"`    — host-owned compaction system transition. The
	 *                   canonical shadow cannot represent this phase
	 *                   (compaction is not a runtime event), so the
	 *                   host is the only legitimate authority for the
	 *                   `compacting` label.
	 *   - `"shadow"`  — canonical @cline/agents TaskStateShadow
	 *                   projection (`getLocalShadowPhase()`). The
	 *                   shadow's `turnPhase` is the authority for 7 of
	 *                   the 8 phases (idle / streaming /
	 *                   awaiting_approval / awaiting_followup /
	 *                   completed / error / resumable).
	 *   - `"legacy"`  — Hub/Remote absence fallback (or Local
	 *                   pre-observation collapse), same byte-equivalent
	 *                   semantics as the E7.1 Thinking legacy branch.
	 *
	 * `seq` is stamped from `TurnStateTracker.seq` for transport-level
	 * stale-push fencing (same domain as `thinkingPresentation.seq`).
	 * The webview replica reducer applies the seq gating upstream;
	 * individual THCP consumers do NOT compare `seq` directly.
	 *
	 * Lifecycle: stamped every `getStateToPostToWebview` push; reset
	 * on new task. Webview consumers should treat `undefined` as the
	 * legacy-safe state (no TaskHeader projection authority) — the
	 * canonical producer never publishes `undefined` while a controller
	 * is alive.
	 *
	 * The legacy `turnState` field is retained for non-TaskHeader
	 * presentation concepts (button set, composer lockout, follow-up
	 * routing) that this ACT explicitly does not migrate.
	 */
	taskHeaderPresentation?: TaskHeaderPresentationProjection
	/**
	 * Follow-up prompts submitted while the active agent turn is still running.
	 * These are owned by the SDK pending-prompt queue and are sent after the
	 * current turn reaches a safe continuation point.
	 */
	queuedPrompts?: QueuedPrompt[]
	/**
	 * Monotonic version of this state snapshot. The webview applies a snapshot only if its
	 * stateVersion is newer than the last applied, so stale/out-of-order state pushes are
	 * ignored. Stamped by the extension. Optional for classic/legacy.
	 */
	stateVersion?: number
	/**
	 * Conversation/replica fence for this snapshot (see ClineMessage.epoch). A snapshot with a
	 * newer epoch replaces the webview transcript; an older one is dropped; an equal one merges.
	 * Optional for classic/legacy.
	 */
	epoch?: number
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
	 * Debug-only wire bit. Stamped `true` by the extension when the user has toggled
	 * `cline.debug.togglePostTerminalAuthorityDiagnostic` ON via the workspace state.
	 * The webview reads this field on its first state push and enables its own side of
	 * the diagnostic recorder. In production (no toggle ever fired) the field is
	 * always `undefined` and the wire shape is byte-for-byte identical to C0.
	 */
	_ptadEnabled?: boolean
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
	 * Diagnostic-only monotonic push ID. Stamped by the extension on every
	 * ExtensionState push (sampled from the shared `MessageIdMinter` counter)
	 * ONLY when the workspace-state PTAD toggle is ON. The webview reads this
	 * field and propagates it verbatim into every webview-side diagnostic
	 * record so `_ptadPushId` equality proves same-push correlation across
	 * the realm boundary — independent of the wire `stateVersion` (which is
	 * no longer the diagnostic correlation authority because all live
	 * captured records used `stateVersion=0`). In production (toggle OFF)
	 * the field is always `undefined` and the wire shape is unchanged.
	 */
	_ptadPushId?: number
	currentTaskItem?: HistoryItem
	/**
	 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	 * (nineteenth-pass, twenty-first-pass):
	 *
	 * Authoritative current working-context estimate (W) for the
	 * active task, mirrored from
	 * `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`
	 * by the host-side carrier
	 * (`apps/vscode/src/sdk/working-context-host-capture.ts`)
	 * and projected into the webview state payload by
	 * `getStateToPostToWebview`.
	 *
	 * Field semantics:
	 *   - `number`:  runtime-published W. Drives the bar
	 *                numerator (Boundary 5).
	 *   - `null`:    runtime is active but the latest event
	 *                carried no W. TaskHeader renders the
	 *                bar UNAVAILABLE (reviewer
	 *                twentieth-pass fallback B). P must not
	 *                masquerade as W.
	 *   - `undefined`: carrier absent / legacy / classic /
	 *                no Boundary 3 -> 4 wiring. TaskHeader
	 *                falls back to P
	 *                (lastApiReqContextInputTokens) so the
	 *                legacy bar continues to render.
	 *
	 * Distinct from `lastApiReqContextInputTokens` (which is
	 * the disjoint sum `tokensIn + cacheReads + cacheWrites`
	 * from the last `api_req_started` message — provider-driven
	 * P). The numerator of the TaskHeader ContextWindow bar
	 * consumes W INSTEAD OF P (when W is present). The P
	 * fallback is the ONLY path where P drives the bar; it
	 * exists for legacy / classic compatibility, not as a
	 * silent W-as-P substitution.
	 *
	 * Transport-only: the carrier does NOT call
	 * `estimateRequestInputTokens` or `estimateMessageTokens`
	 * to derive this value. W is read verbatim from the
	 * runtime event payload.
	 *
	 * Fail-closed: the carrier uses unconditional assignment
	 * semantics (runtime-published `undefined` is normalized
	 * to `null`), so the host W slot becomes `null` when the
	 * runtime emits a no-W `working-context-state-changed`
	 * event. UNDEFINED_W_STALE_REUSE is FORBIDDEN.
	 */
	currentWorkingContextEstimate?: number | null
	mcpMarketplaceEnabled?: boolean
	mcpDisplayMode: McpDisplayMode
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting?: boolean
	platform: Platform
	environment?: Environment
	shouldShowAnnouncement: boolean
	taskHistory: HistoryItem[]
	telemetrySetting: TelemetrySetting
	shellIntegrationTimeout: number
	terminalReuseEnabled?: boolean
	defaultTerminalProfile?: string
	vscodeTerminalExecutionMode: string
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	/**
	 * True while a foreground (VS Code terminal) command is awaited by a
	 * run_commands tool call. Drives the "Proceed While Running" button.
	 */
	foregroundCommandRunning?: boolean
	lastCompletedCommandTs?: number
	userInfo?: UserInfo
	version: string
	/**
	 * Which rollout bundle this build is ("legacy" or "next"). Only present for
	 * bundles built by the combined rollout workflow; undefined for ordinary builds.
	 */
	extensionVariant?: "legacy" | "next"
	distinctId: string
	globalClineRulesToggles: ClineRulesToggles
	localClineRulesToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
	globalWorkflowToggles: ClineRulesToggles
	localCursorRulesToggles: ClineRulesToggles
	localWindsurfRulesToggles: ClineRulesToggles
	remoteRulesToggles?: ClineRulesToggles
	remoteWorkflowToggles?: ClineRulesToggles
	localAgentsRulesToggles: ClineRulesToggles
	mcpResponsesCollapsed?: boolean
	useAutoCondense?: boolean
	compactionStrategy?: string
	// ACT-CLINEMM-USER-CONTEXT-CEILING01: user-controlled operating context
	// ceiling. Undefined = Auto (canonical model/provider effective input
	// capacity). A positive integer lowers the operating capacity that
	// drives auto-compaction; it can never expand the model/provider limit.
	userContextCeiling?: number
	webSearchEnabled?: boolean
	subagentsEnabled?: boolean
	worktreesEnabled?: ClineFeatureSetting
	favoritedModelIds: string[]
	// NEW: Add workspace information
	workspaceRoots: WorkspaceRoot[]
	primaryRootIndex: number
	isMultiRootWorkspace: boolean
	multiRootSetting: ClineFeatureSetting
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	lastDismissedCliBannerVersion: number
	dismissedBanners?: Array<{ bannerId: string; dismissedAt: number }>
	hooksEnabled?: boolean
	remoteConfigSettings?: Partial<RemoteConfigFields>
	remoteConfigRevision?: number
	globalSkillsToggles?: Record<string, boolean>
	localSkillsToggles?: Record<string, boolean>
	backgroundEditEnabled?: boolean
	optOutOfRemoteConfig?: boolean
	remoteConfigAvailable?: boolean
	showFeatureTips?: boolean
	// ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01:
	// Persisted Settings values for the sandbox capability toggles.
	// Defaults to undefined (= deny/deny = pre-ACT runtime); when the
	// user touches the toggle, become true. See state-keys.ts.
	clinemmSafeYoloAllowNetwork?: boolean
	clinemmSafeYoloAllowSshAgent?: boolean
	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01:
	// User-enabled, expiring exception to R0 workspace path authority.
	// Defaults to [] (the pre-ACT contract;
	// MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0 for the absent-key
	// category). The host filters expired entries at policy
	// evaluation time; the validator REJECTS at write time any
	// entry whose expiresAt exceeds now + 24h.
	clinemmTemporaryExternalPathAuthorities?: TemporaryExternalPathAuthority[]
	banners?: BannerCardData[]
	welcomeBanners?: BannerCardData[]
	openAiCodexIsAuthenticated?: boolean
}

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
 *
 * Wire-shape for the webview-facing `Thinking`/`model streaming` projection.
 * The webview renders the Thinking indicator from this projection in the
 * three consumers actually migrated by E7.1:
 *
 *   - ChatRow `case "reasoning"` Thinking shimmer
 *   - RequestStartRow inline shimmer
 *   - useThinkingLoaderRow loader row (pre-reasoning; threaded via MessagesArea)
 *
 * — NOT from `turnState.phase` directly. The TaskHeader state label
 * (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
 * is explicitly OUT OF SCOPE for E7.1; its `taskHeaderStateLabel` helper
 * consumes the full multi-phase `turnState.phase` vocabulary ("Working" /
 * "Approval" / "Complete" / "Error" / "Paused" / "Waiting") and is left
 * for an E7.1-2 slice. Migrating it requires a richer TurnPhase-shaped
 * projection that the current shape does not carry.
 *
 * Two-source rule (frozen):
 *
 *   - `source: "shadow"`  — projected from the canonical TaskState shadow
 *     (`SdkController.getLocalShadowProjection().execution.modelStreaming`).
 *     This is the LOCAL qualified path; `modelStreaming` reflects the
 *     canonical `AgentRuntime.snapshot().execution.modelStreaming` flag,
 *     independent of the legacy `TurnStateTracker.phase`.
 *   - `source: "legacy"`  — projected from `TurnStateTracker.phase ===
 *     "streaming"`. Hub/Remote hosts (no `taskStateShadowWiring`), LOCAL
 *     sessions with no canonical snapshot yet, and the absence-state
 *     collapse (CONTRACT_2 in `task-state-shadow-arbiter-mapper.ts`).
 *
 * Webview consumers MUST tolerate both sources. Mutation-kill tests pin
 * the dual-source rule: T2_LEGACY_INDEPENDENCE (canonical mapper ignores
 * legacy phase) and T8_NECESSITY (canonical mapper captures new mutations).
 *
 * The shape is intentionally minimal — only the facts the three migrated
 * Thinking consumers actually need. Other TurnPhase concepts (button set,
 * composer lockout, follow-up routing, TaskHeader state label) keep
 * reading `turnState.phase` and are explicitly OUT OF SCOPE for E7.1.
 */
export interface ThinkingPresentationProjection {
	/**
	 * Whether the agent is currently producing model output. Drives:
	 *   - ChatRow `case "reasoning"` Thinking shimmer
	 *   - RequestStartRow inline shimmer
	 *   - useThinkingLoaderRow loader row (pre-reasoning)
	 *
	 * The TaskHeader state label is NOT driven by `modelStreaming`
	 * (it carries the multi-phase `turnState.phase` vocabulary;
	 * E7.1-2 will plumb a richer projection for it).
	 */
	modelStreaming: boolean
	/**
	 * Which authority produced `modelStreaming`. Diagnostic only; do not
	 * branch behavior on this in production code paths — the value is the
	 * same regardless of source (the legacy fallback is byte-equivalent).
	 */
	source: "shadow" | "legacy"
	/**
	 * Stamped from `TurnStateTracker.seq`. Transport-level stale-push
	 * fencing is applied UPSTREAM by the webview replica reducer's seq
	 * gating (`apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`),
	 * NOT inside the E7.1 consumers — none of the three migrated
	 * consumers compare `thinkingPresentation.seq` directly. The field
	 * is preserved here so a future E7.1-2 consumer that needs it (or
	 * a diagnostic overlay) can rely on a stable seq stamp.
	 */
	seq: number
}

/**
 * ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
 *
 * Wire shape for the webview-facing `taskHeaderPresentation` field.
 * The TaskHeader state label consumer
 * (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
 * consumes this projection via `taskHeaderStateLabel(taskHeaderPresentation, turnState)`
 * instead of `turnState.phase` directly.
 *
 * Three-source precedence (frozen by `selectTaskHeaderPresentation` in
 * `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`):
 *
 *   - `"host"`    — host-owned compaction system transition. The
 *                   canonical shadow cannot represent this phase
 *                   (compaction is not a runtime event), so the host
 *                   is the only legitimate authority for the
 *                   `compacting` label.
 *   - `"shadow"`  — canonical `@cline/agents` TaskStateShadow
 *                   projection (`getLocalShadowPhase()`). The shadow's
 *                   `turnPhase` is the authority for 7 of the 8 phases
 *                   (idle / streaming / awaiting_approval /
 *                   awaiting_followup / completed / error / resumable).
 *                   When the shadow is present its value wins over the
 *                   legacy `turnState.phase` (T2_LEGACY_INDEPENDENCE).
 *   - `"legacy"`  — Hub/Remote absence fallback (or Local
 *                   pre-observation collapse), same byte-equivalent
 *                   semantics as the E7.1 Thinking legacy branch.
 *
 * `seq` is stamped from `TurnStateTracker.seq` for transport-level
 * stale-push fencing (same domain as `thinkingPresentation.seq`).
 * The webview replica reducer applies the seq gating upstream;
 * THCP consumers do NOT compare `seq` directly.
 *
 * The shape is intentionally minimal — only the facts the TaskHeader
 * state label needs. The E7.1 contract for `thinkingPresentation`
 * is preserved unchanged.
 */
export interface TaskHeaderPresentationProjection {
	/**
	 * The phase the TaskHeader should render. This is the canonical
	 * multi-phase vocabulary (`idle` / `streaming` /
	 * `awaiting_approval` / `awaiting_followup` / `compacting` /
	 * `completed` / `error` / `resumable`).
	 */
	phase: TurnPhase
	/**
	 * Provenance of `phase`. Exactly one of `"host"` / `"shadow"` /
	 * `"legacy"`. Consumers MAY use this for diagnostics but should
	 * branch the same way regardless of source — the selector
	 * already encoded the authority precedence.
	 */
	source: "shadow" | "host" | "legacy"
	/**
	 * Stamped from `TurnStateTracker.seq`. Transport-level stale-push
	 * fencing is applied UPSTREAM by the webview replica reducer's
	 * seq gating — THCP consumers do NOT compare
	 * `taskHeaderPresentation.seq` directly.
	 */
	seq: number
}

/**
 * The authoritative UI mode for the current agent turn, owned by the extension. The webview reads
 * this instead of inferring mode from the tail of clineMessages.
 */
export type TurnPhase =
	| "idle" // no active turn; input enabled, no buttons
	| "streaming" // model producing content / tool running; Thinking + Cancel
	| "awaiting_approval" // a tool/command/mcp/subagent approval is pending
	| "awaiting_followup" // ask_question / plan_mode_respond / done-without-completion
	// ACT-CLINEMM-COMPACTION-STATE-AUTHORITY01: an internal SYSTEM
	// TRANSITION owns the next progress step — context compaction is
	// actively summarizing/replacing the conversation history. It is
	// NOT model/tool work (`streaming`) and it is emphatically NOT a
	// human wait (`awaiting_followup`): no user action is actionable
	// while it runs. The phase is entered when the compaction divider
	// row goes `started` and the PREVIOUS phase (and its anchor) is
	// restored when compaction reaches any terminal status.
	| "compacting"
	| "completed" // attempt_completion done; Start New Task
	| "error" // api_req_failed / fatal; Retry / recovery
	| "resumable" // task cancelled / interrupted; Resume Task

export interface TurnState {
	phase: TurnPhase
	/** ts of the ClineMessage this phase is "about" (e.g. the pending approval/ask). */
	anchorTs?: number
	/** Monotonic; the webview keeps the highest-seq TurnState and ignores older ones. */
	seq: number
}

/**
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: cumulative runtime-derived task
 * metrics, owned by the host-side `TaskTelemetryTracker`.
 *
 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION02:
 *  - `recoveryFailures` renamed to `recoveryBudgetFailures` because
 *    the underlying counter (`RecoverySnapshot.episodeFailures`) is
 *    a bounded-recovery control-plane metric, not a total of all
 *    recoverable tool failures. It only grows while the recovery
 *    second stage is `idle`; once the second stage is `armed` or
 *    `terminating`, additional failures do not increment it. The wire
 *    field name and the tooltip are updated to match.
 *  - `endedAt` semantics: the freeze is now REOPENABLE. It is set on
 *    the first `error` / `resumable` / `completed` transition within
 *    the current stopped interval, and CLEARED on a `streaming` /
 *    `awaiting_approval` transition on the same task identity
 *    (same-task follow-up via `askResponse`, resume via
 *    `reinitExistingTaskFromId`, retry-after-error). `startedAt` and
 *    the cumulative counters are preserved across reopenings.
 *
 * Fields:
 * - `startedAt`              — wall-clock ms epoch when the visible
 *                              task was created. Persisted in the
 *                              `HistoryItem.ts` slot so a remount or
 *                              webview reconnect resumes the same
 *                              elapsed timeline.
 * - `endedAt`                — wall-clock ms epoch when the visible
 *                              task reached the current stopped
 *                              interval's terminal phase (`error` /
 *                              `resumable` / `completed`). Undefined
 *                              while the task is live OR while the
 *                              task is paused for user input
 *                              (`awaiting_followup` — the same task
 *                              continues when the user replies, so the
 *                              elapsed clock must keep ticking to
 *                              represent "task duration since
 *                              creation"). The TaskHeader freezes its
 *                              display at `endedAt` instead of
 *                              continuing to grow after the task is
 *                              over; a subsequent same-task
 *                              continuation reopens the clock.
 * - `toolCalls`              — number of canonical `tool-started`
 *                              runtime events observed for this task.
 *                              Each invocation is counted exactly
 *                              once, including failed executions and
 *                              parallel siblings. Host DENY / user
 *                              rejection / pre-exec block / registry
 *                              miss do not increment — no canonical
 *                              tool-start occurs for those paths.
 * - `recoveryBudgetFailures` — cumulative positive deltas of the
 *                              `RecoverySnapshot.episodeFailures`
 *                              counter (single canonical authority).
 *                              The TaskHeader renders this as `↻ N`
 *                              to mean "failures counted toward
 *                              bounded-recovery episode limits".
 *                              `currentRepairAttempts` and
 *                              `circuitNoticeCount` are tracked on the
 *                              runtime side but intentionally NOT
 *                              projected to the UI metric because
 *                              they describe overlapping consequences
 *                              of the same recoverable failure
 *                              (family pressure / bounded-exhaustion
 *                              notices), not independent
 *                              interventions — summing them
 *                              double-counted.
 * - `mechanism?`            — ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01
 *                              (TES-IMPL-01): per-mechanism cumulative
 *                              projection (edit / command / search /
 *                              read / mcp / other) derived from the
 *                              canonical `toolName` on each
 *                              `tool-started` runtime event. `total`
 *                              here is conserved against `toolCalls`:
 *
 *                                mechanism.total === toolCalls
 *                                mechanism.total === sum(mechanism buckets)
 *
 *                              Mechanism-only, not purpose — the
 *                              classifier never infers semantic purpose
 *                              from tool arguments (e.g. `run_commands
 *                              ("sed -i ...")` stays `command`, never
 *                              `edit`). Optional on the wire so
 *                              Hub/Remote hosts that have not yet
 *                              received the field simply omit it.
 *
 * The transport is intentionally minimal: NO state label (use
 * `turnState.phase`), NO context/token/cost fields (out of scope for
 * 01-A), NO `messages`-derived values. The webview renders "—" when
 * this projection is absent.
 */
export interface TaskHeaderTelemetryStrip {
	startedAt: number
	endedAt?: number
	toolCalls: number
	recoveryBudgetFailures: number
	mechanism?: ToolMechanismSummary
}

/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01:
 * Wire-shape for the per-mechanism cumulative projection. Mirrors
 * `apps/vscode/src/sdk/tool-mechanism-classifier.ts` so the host
 * serializes the exact same shape the webview decodes.
 */
export interface ToolMechanismSummary {
	total: number
	edit: number
	command: number
	read: number
	search: number
	mcp: number
	other: number
}

export interface QueuedPrompt {
	id: string
	prompt: string
	delivery: "queue" | "steer"
	attachmentCount: number
}

export interface ClineMessage {
	ts: number
	type: "ask" | "say"
	ask?: ClineAsk
	say?: ClineSay
	text?: string
	reasoning?: string
	images?: string[]
	media?: GeneratedMedia[]
	files?: string[]
	partial?: boolean
	/**
	 * Freshness counter for convergent-replica merging on the webview side. Monotonically
	 * increasing per process; a higher `seq` means a newer copy of the SAME `ts` (identity).
	 * Stamped by the extension as the message flows to the webview. Optional for classic/legacy.
	 */
	seq?: number
	/**
	 * Conversation/replica fence. Messages from an older epoch (a previous task or a previous
	 * render of the same task) are dropped by the webview. Stamped by the extension. Optional
	 * for classic/legacy.
	 */
	epoch?: number
	commandCompleted?: boolean
	/**
	 * ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01: narrow
	 * lifecycle disposition of a `say:"command"` row, propagated from
	 * the runtime's `AgentContentEndEvent.executionDisposition` field.
	 *
	 * - "executed"                  ⇒ the tool's executor was invoked. The result
	 *                                 may still be an error; downstream
	 *                                 status-pill rendering differentiates
	 *                                 running / completed / executed-failed.
	 * - "rejected_before_execution" ⇒ the runtime declined to invoke the executor
	 *                                 (input parse error, policy deny, user
	 *                                 reject, etc.). No approval was awaited;
	 *                                 the row is a request-lifecycle
	 *                                 rejection, NOT an approval-pending
	 *                                 prompt and NOT an execution result.
	 *
	 * ABSENT means the translator has no signal — consumers MUST treat
	 * absence as opaque and not synthesize either value.
	 */
	commandExecutionDisposition?: "executed" | "rejected_before_execution"
	/**
	 * ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
	 * immutable per-message marker stamped by the runtime AT THE MOMENT a
	 * final terminal completion_result row is published (the
	 * attempt_completion / submit_and_exit `content_end` seam in
	 * `message-translator.ts`). Stamped once and persisted on the
	 * message for the rest of the row's lifetime, so it survives phase
	 * flips (resume, retry-after-error, follow-up, compaction) and
	 * provides a stable per-message identity that the webview can
	 * key on without depending on the mutable task-level `TurnState.phase`.
	 *
	 * Stamped only by the canonical completion tool `content_end` seam;
	 * partial rows and rows produced outside that seam (debug commands,
	 * legacy translation paths) are intentionally NOT stamped.
	 *
	 * ABSENT means the row was never authoritatively marked as a
	 * terminal completion — either pre-CORRECTION01 history, or a
	 * synthetic ask:"completion_result" / say:"completion_result" row
	 * produced outside the canonical completion seam. Consumers MUST
	 * treat absence as opaque and fall back to other gates (legacy
	 * ask path uses `turnState.phase === "completed"` + non-empty
	 * text; new rows without the marker must NOT be framed).
	 */
	isAuthoritativelyCompletedResult?: boolean
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
	modelInfo?: ClineMessageModelInfo
}

export type ClineAsk =
	| "followup"
	| "plan_mode_respond"
	| "act_mode_respond"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "new_task"
	| "condense"
	| "summarize_task"
	| "report_bug"
	| "use_subagents"

export type ClineSay =
	| "task"
	| "error"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "reasoning"
	| "completion_result"
	| "plan_completion_result" // turn-final plan-mode response inferred at turn end (SDK path)
	| "user_feedback"
	| "user_feedback_diff"
	| "command"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "shell_integration_warning_with_suggestion"
	| "browser_action_launch"
	| "browser_action"
	| "browser_action_result"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "mcp_notification"
	| "use_mcp_server"
	| "diff_error"
	| "deleted_api_reqs"
	| "clineignore_error"
	| "command_permission_denied"
	| "checkpoint_created"
	| "load_mcp_documentation"
	| "info" // Added for general informational messages like retry status
	| "task_progress"
	| "hook_status"
	| "hook_output_stream"
	| "subagent"
	| "use_subagents"
	| "subagent_usage"
	| "conditional_rules_applied"
	| "compaction" // context compaction progress/result divider

export interface ClineSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "fileDeleted"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "webFetch"
		| "webSearch"
		| "summarizeTask"
		| "useSkill"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	operationIsLocatedInWorkspace?: boolean
	/** Starting line numbers in the original file where each SEARCH block matched */
	startLineNumbers?: number[]
	/** One-based inclusive line range requested by read_file; readLineEnd omitted = open-ended read (for UI summaries). */
	readLineStart?: number
	readLineEnd?: number
}

// must keep in sync with system prompt
const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const
export type BrowserAction = (typeof browserActions)[number]

export interface ClineSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	text?: string
}

export type SubagentExecutionStatus = "pending" | "running" | "completed" | "failed"

export interface SubagentStatusItem {
	index: number
	prompt: string
	status: SubagentExecutionStatus
	toolCalls: number
	inputTokens: number
	outputTokens: number
	totalCost: number
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
	latestToolCall?: string
	result?: string
	error?: string
}

export interface ClineSaySubagentStatus {
	status: "running" | "completed" | "failed"
	total: number
	completed: number
	successes: number
	failures: number
	toolCalls: number
	inputTokens: number
	outputTokens: number
	contextWindow: number
	maxContextTokens: number
	maxContextUsagePercentage: number
	items: SubagentStatusItem[]
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export interface ClineAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
}

export interface ClineAskUseSubagents {
	prompts: string[]
}

export interface ClinePlanModeResponse {
	response: string
	options?: string[]
	selected?: string
}

export interface ClineAskQuestion {
	question: string
	options?: string[]
	selected?: string
}

export interface ClineApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
}

/**
 * JSON payload of a say:"compaction" message. Mirrors the CLI's compaction
 * divider (apps/cli/src/tui/utils/compaction-status.ts): a "started" row shows
 * a spinner and is later updated in place (same ts) to its terminal status.
 */
export interface ClineCompactionInfo {
	status: "started" | "completed" | "skipped" | "failed" | "cancelled"
	mode: "auto" | "manual"
	tokensBefore?: number
	tokensAfter?: number
	messagesBefore?: number
	messagesAfter?: number
}

export interface ClineSubagentUsageInfo {
	source: "subagents"
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost: number
}

type ClineApiReqCancelReason = "streaming_failed" | "user_cancelled" | "retries_exhausted"

export const COMPLETION_RESULT_CHANGES_FLAG = "HAS_CHANGES"
