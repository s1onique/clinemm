// ClineMM fork: keep the canonical "cline.*" command prefix so existing keybindings,
// menu items, and command-palette entries continue to match regardless of whether
// the fork's npm package name is "clinemm" (dogfood build) or "claude-dev"
// (upstream-compatible rebuild). The upstream comment below is still accurate for
// nightly builds with arbitrary package names.
import { name, publisher, version } from "../package.json"
import { HostProvider } from "./hosts/host-provider"

const CLINEMM_DEFAULT_PACKAGE_NAME = "clinemm"
const CLINE_DEFAULT_PACKAGE_NAME = "claude-dev"

const prefix = name === CLINEMM_DEFAULT_PACKAGE_NAME || name === CLINE_DEFAULT_PACKAGE_NAME ? "cline" : name

/**
 * List of commands with the name of the extension they are registered under.
 * These should match the command IDs defined in package.json.
 * For Nightly build, the publish script has updated all the commands to use the extension name as prefix.
 * In production, all commands are registered under "cline" for consistency.
 */
const ClineCommands = {
	PlusButton: prefix + ".plusButtonClicked",
	McpButton: prefix + ".mcpButtonClicked",
	MarketplaceButton: prefix + ".marketplaceButtonClicked",
	SettingsButton: prefix + ".settingsButtonClicked",
	HistoryButton: prefix + ".historyButtonClicked",
	AccountButton: prefix + ".accountButtonClicked",
	WorktreesButton: prefix + ".worktreesButtonClicked",
	TerminalOutput: prefix + ".addTerminalOutputToChat",
	AddToChat: prefix + ".addToChat",
	FixWithCline: prefix + ".fixWithCline",
	ExplainCode: prefix + ".explainCode",
	ImproveCode: prefix + ".improveCode",
	FocusChatInput: prefix + ".focusChatInput",
	Walkthrough: prefix + ".openWalkthrough",
	GenerateCommit: prefix + ".generateGitCommitMessage",
	AbortCommit: prefix + ".abortGitCommitMessage",
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
	// Debug commands for the post-terminal authority diagnostic. Not user-facing;
	// only the dump command should ever be invoked (the toggle is implicit
	// through `vscode.commands.executeCommand` from the debug harness).
	TogglePostTerminalAuthorityDiagnostic: prefix + ".debug.togglePostTerminalAuthorityDiagnostic",
	DumpPostTerminalAuthorityDiagnostic: prefix + ".debug.dumpPostTerminalAuthorityDiagnostic",
	// ACT-CLINEMM-TURNSTATE-WRITER-PROVENANCE-COMMAND-SURFACE01:
	// Debug commands for the legacy TurnState writer-provenance diagnostic.
	// Default off. The toggle flips a workspace-state flag and the dump
	// serializes the bounded ring to <globalStorageUri>/turn-state-writer-provenance.jsonl.
	ToggleTurnStateWriterProvenanceDiagnostic: prefix + ".debug.toggleTurnStateWriterProvenanceDiagnostic",
	DumpTurnStateWriterProvenanceDiagnostic: prefix + ".debug.dumpTurnStateWriterProvenanceDiagnostic",
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-ninth-pass) — debug dump command for the temporary
	// Q1..Q4 W-carrier trace observer. The dump is unconditional
	// (the operator can always inspect the captured buffer even
	// after the diagnostic was disabled); the toggle is implicit
	// via the central dogfood diagnostic profile + `CLINEMM_W_TRACE`
	// env override (no workspace toggle needed for this ACT).
	DumpWCarrierTrace: prefix + ".debug.dumpWCarrierTrace",
	// ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01:
	// Debug commands for the temporary host-ownership diagnostic. Default
	// off. The toggle flips a workspace-state flag; the dump serializes
	// the bounded ring to <globalStorageUri>/host-ownership-diagnostic.jsonl.
	ToggleHostOwnershipDiagnostic: prefix + ".debug.toggleHostOwnershipDiagnostic",
	DumpHostOwnershipDiagnostic: prefix + ".debug.dumpHostOwnershipDiagnostic",
	// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01:
	// Debug commands for the bounded TaskHeader selector-input diagnostic.
	// Default off (env var gate). The dump serializes the bounded ring
	// to <globalStorageUri>/task-header-selector-input-capture.jsonl.
	// REMOVAL_TRIGGER: first successful LIVE binding of
	// PUBLICATION_SHADOW_BINDING + LOCAL_SHADOW_TURNSEQ for a
	// recurrence, OR CAPTURE_INSUFFICIENT.
	DumpTaskHeaderSelectorInputDiagnostic: prefix + ".debug.dumpTaskHeaderSelectorInputDiagnostic",
	ClearTaskHeaderSelectorInputDiagnostic: prefix + ".debug.clearTaskHeaderSelectorInputDiagnostic",
	// ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01:
	// Debug dump command for the bounded Background Owner Correlation
	// (BOCOR) diagnostic at the Q5 done-without-completion boundary.
	// Dogfood-only (controlled by the central dogfood profile
	// resolver - no separate env-var toggle, no workspace toggle).
	// The dump serializes the bounded ring to
	// <globalStorageUri>/background-owner-correlation.jsonl. No
	// toggle command (the diagnostic enablement is owned by
	// `applyBackgroundOwnerCorrelationDiagnosticProfile` in
	// dogfood-diagnostic-profile.ts). REMOVAL_TRIGGER: first
	// successful LIVE binding of the LIVE cause (OC1/OC2/OC3) AND
	// qualification of the bounded repair, OR CAPTURE_INSUFFICIENT.
	DumpBackgroundOwnerCorrelation: prefix + ".debug.dumpBackgroundOwnerCorrelation",
	// ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01:
	// Debug dump command for the bounded Background Job Liveness
	// Authority (BJLA) diagnostic at the CommandJob lifecycle
	// seams. Dogfood-only (controlled by the central dogfood
	// profile resolver - no separate env-var toggle, no workspace
	// toggle). The dump serializes the bounded ring to
	// <globalStorageUri>/background-job-liveness-authority.jsonl.
	// No toggle command (the diagnostic enablement is owned by
	// `applyBackgroundJobLivenessAuthorityDiagnosticProfile` in
	// dogfood-diagnostic-profile.ts). REMOVAL_TRIGGER: first
	// successful LIVE classification AND qualification of the
	// bounded repair, OR CAPTURE_INSUFFICIENT.
	DumpBackgroundJobLivenessAuthority: prefix + ".debug.dumpBackgroundJobLivenessAuthority",
	// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
	// Debug dump command for the bounded Continuation Cardinality
	// Authority (CCARD) diagnostic at the autonomous-turn boundary
	// (C1..C10 production seams). Dogfood-only (controlled by the
	// central dogfood profile resolver - no separate env-var toggle,
	// no workspace toggle). The dump serializes the bounded ring to
	// <globalStorageUri>/continuation-cardinality-authority.jsonl
	// AND the per-stage counters to
	// <globalStorageUri>/continuation-cardinality-authority.counters.json.
	// No toggle command (the diagnostic enablement is owned by
	// `applyContinuationCardinalityAuthorityDiagnosticProfile` in
	// dogfood-diagnostic-profile.ts). REMOVAL_TRIGGER: first 1 -> 2
	// cardinality seam mechanically identified AND ablation returns
	// cardinality to 1, OR CAPTURE_INSUFFICIENT, OR
	// HALT_RED_NOT_REPRODUCED, OR successor evidence supersedes it.
	DumpContinuationCardinalityAuthority: prefix + ".debug.dumpContinuationCardinalityAuthority",
	// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-AUTHORITY-COUNTER-DUMP01:
	// Debug dump command for the SYNCHRONOUS REAL Elm authority
	// runtime counter snapshot. Unconditional (operator can always
	// inspect whatever the runtime captured), dump != clear (no
	// counter mutation). The dump serializes `getElmAuthorityCounters()`
	// to <globalStorageUri>/completion-authority-elm-authority.counters.json.
	// No toggle command (enablement is owned by
	// `initializeElmAuthorityRuntime` in dogfood-diagnostic-profile.ts;
	// UNCONDITIONAL, no env gate). REMOVAL_TRIGGER:
	// PASS_LIVE_ELM_AUTHORITY with operator-rendered 1:1 live
	// correspondence AND the cause is RED on HOLD/FAILURE for
	// operator review, OR successor evidence supersedes.
	DumpCompletionAuthorityElmAuthority: prefix + ".debug.dumpCompletionAuthorityElmAuthority",
	// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION01-LIVE-CALLBACK-OUTCOME:
	// Debug dump command for the LIVE callback-outcome counter
	// snapshot. Mirrors the CCARD / SHADOW / ELM-AUTHORITY dump
	// pattern: unconditional (operator can always inspect whatever
	// the runtime captured), dump != clear (no counter mutation).
	// The dump serializes
	// `getCompletionContinuationDeliveryCounters()` to
	// <globalStorageUri>/completion-continuation-delivery.counters.json.
	// The runtime is always collecting so the dump can report a
	// fresh process; the diagnostic enablement is owned by the
	// presence of the production callback (no toggle command).
	// REMOVAL_TRIGGER: first of (a) root cause isolated, (b)
	// capture insufficient (successor counter design required), (c)
	// successor evidence supersedes.
	DumpCompletionContinuationDelivery: prefix + ".debug.dumpCompletionContinuationDelivery",
	// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR:
	// Debug dump command for the LIVE upstream-discriminator
	// counter snapshot (U0..U11 first-divergence counters).
	// Mirrors the CCARD / CCDO / SHADOW / ELM-AUTHORITY dump
	// pattern: unconditional (operator can always inspect
	// whatever the runtime captured), dump != clear (no
	// counter mutation). The dump serializes
	// `getCompletionContinuationUpstreamCounters()` to
	// <globalStorageUri>/completion-continuation-upstream.counters.json.
	// The runtime is always collecting so the dump can report a
	// fresh process; the diagnostic enablement is owned by the
	// dogfood profile (no toggle command, no env knob).
	// REMOVAL_TRIGGER: first of (a) root cause isolated, (b)
	// capture insufficient (successor counter design required), (c)
	// successor evidence supersedes.
	DumpCompletionContinuationUpstream: prefix + ".debug.dumpCompletionContinuationUpstream",
	// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01:
	// Dump command for the EHLOOP01 (Extension Host Hotloop) counter
	// diagnostic. Mirrors the BJLA / BOCOR / CCARD dump pattern:
	// unconditional (operator can always inspect captured counters),
	// dump != clear (no counter mutation). The dump serializes the
	// bounded counter snapshot to
	// <globalStorageUri>/extension-host-hotloop-diagnostic.json.
	// No toggle command (the diagnostic enablement is owned by
	// `applyExtensionHostHotloopDiagnosticProfile` in
	// dogfood-diagnostic-profile.ts). REMOVAL_TRIGGER: extension-host
	// hot-loop repair GREEN on LIVE qualification, OR
	// CAPTURE_INSUFFICIENT, OR HALT_CAUSE_NOT_ESTABLISHED, OR
	// successor evidence supersedes it.
	DumpExtensionHostHotloopDiagnostic: prefix + ".debug.dumpExtensionHostHotloopDiagnostic",
	// ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01 — CALLER-REASON DISCRIMINATOR.
	// Dump command for the lifecycle-clear recorder. Mirrors the
	// CCARD / CCDO / CCDSO / CCNTUP / EHLOOP / ELM-SHADOW / ELM-AUTHORITY
	// dump pattern: unconditional (operator can always inspect whatever the
	// recorder captured), dump != clear (no snapshot mutation). The dump
	// serializes the lifecycle-clear snapshot (`getLifecycleClearSnapshot()`)
	// to <globalStorageUri>/lifecycle-clear.counters.json. The recorder
	// gates internally via `isDogfoodRuntime()` (matched to the ccupd01 /
	// CCDO01 gate) — no toggle / enable command. REMOVAL_TRIGGER: first of
	// (a) root cause isolated (LIVE classifies an exact lastClearReason),
	// (b) capture insufficient (successor counter design required),
	// (c) successor evidence supersedes. On removal, this registry entry +
	// the package.json declaration + the extension.ts handler + the host
	// dump runtime + the production recorder MUST be removed TOGETHER.
	DumpLifecycleClear: prefix + ".debug.dumpLifecycleClear",
	// ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-DUMP-COMMAND-SURFACE01:
	// Debug dump command for the MYC prime live diagnostic. Mirrors
	// the CCARD / CCDO / CCDSO / CCNTUP / EHLOOP / ELM-SHADOW /
	// ELM-AUTHORITY / Lifecycle-Clear dump convention: unconditional
	// (operator can always inspect whatever the recorder captured),
	// dump != clear (no snapshot mutation). The dump serializes the
	// existing `getMycPrimeLiveDiag(sessionId)` snapshot for the
	// currently active ClineMM session to
	// <globalStorageUri>/myc-prime-live.counters.json. The recorder
	// gates internally via `isMycPrimeLiveDiagEnabled()` (set by the
	// central dogfood profile resolver at activation) — no toggle /
	// enable command. The sessionId is RESOLVED BY THE HANDLER from
	// the controller's active task, NOT manually typed, so the dump
	// joins the operator's "task I just ran" with the diagnostic
	// snapshot. REMOVAL_TRIGGER: first successful LIVE binding of
	// MYC03, OR CAPTURE_INSUFFICIENT, OR successor evidence
	// supersedes it. On removal, this registry entry + the package.json
	// declaration + the extension.ts handler + the host dump runtime
	// MUST be removed TOGETHER.
	DumpMycPrimeLiveDiagnostic: prefix + ".debug.dumpMycPrimeLiveDiagnostic",
	// ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS:
	// Single Command Palette entry point for the TaskHeader Elm
	// runtime-shadow observer's bounded diagnostics. The runtime
	// shadow is enabled AUTOMATICALLY in the dogfood profile (no
	// env var, no flag — see
	// `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`).
	// When invoked, the handler shows the compact summary
	// (`Task Header Elm Runtime Shadow` header + the seven
	// classification counters + the last N bounded observations)
	// via `vscode.window.showInformationMessage`, then opens a
	// `showQuickPick` action picker with three entries: Copy
	// Report / Reset Observations / Close. "Reset Observations"
	// clears the bounded observation ring ONLY — does NOT touch
	// the enabled flag, the TS presentation, or the Elm kernel
	// state. When invoked OUTSIDE dogfood (shadow disabled), the
	// handler returns a single bounded message
	// ("Task Header Elm runtime shadow is disabled in this
	// profile.") so the operator gets an obvious, non-crashing
	// no-op. REMOVAL_TRIGGER: first successful LIVE qualification
	// that authorizes cutover to `ORCHESTRATION03-AUTHORITY`, OR
	// the first real LIVE semantic mismatch that identifies a
	// contract defect, OR CAPTURE_INSUFFICIENT. On removal, this
	// registry entry + the package.json declaration + the
	// extension.ts handler + the host-side diagnostics module +
	// the SOT-level helpers in `task-header-elm-shadow.ts` MUST
	// be removed TOGETHER.
	TaskHeaderElmShadowDiagnostics: prefix + ".taskHeaderElmShadowDiagnostics",
	// Jupyter Notebook commands
	JupyterGenerateCell: prefix + ".jupyterGenerateCell",
	JupyterExplainCell: prefix + ".jupyterExplainCell",
	JupyterImproveCell: prefix + ".jupyterImproveCell",
}

/**
 * IDs for the views registered by the extension.
 * These should match the name + view IDs defined in package.json.
 */
const ClineViewIds = {
	Sidebar: name + ".SidebarProvider",
}

/**
 * The registry info for the extension, including its ID, name, version, commands, and views
 * registered for the current host.
 */
export const ExtensionRegistryInfo = {
	id: publisher + "." + name,
	name,
	version,
	publisher,
	commands: ClineCommands,
	views: ClineViewIds,
}

export interface HostInfo {
	/**
	 * The name of the host platform, e.g VSCode, IntelliJ Ultimate Edition, etc.
	 */
	platform: string
	/**
	 * The operating system platform, e.g. linux, darwin, win32
	 */
	os: string
	/**
	 * The type of the cline host environment, e.g. 'VSCode Extension', 'Cline for JetBrains', 'CLI'
	 * This is different from the platform because there are many JetBrains IDEs, but they all use the same
	 * plugin.
	 */
	ide: string
	/**
	 * A distinct ID for this installation of the host client
	 */
	distinctId: string
	/**
	 * The version of the host platform, e.g. 1.103.0 for VSCode, or 2025.1.1.1 for JetBrains IDEs.
	 */
	hostVersion?: string
	/**
	 * The version of Cline that the host client is running
	 */
	extensionVersion: string
}

let hostInfo = null as HostInfo | null

export const HostRegistryInfo = {
	init: async (distinctId: string) => {
		const host = await HostProvider.env.getHostVersion({})
		const hostVersion = host.version
		const extensionVersion = host.clineVersion || ExtensionRegistryInfo.version
		const platform = host.platform || "unknown"
		const os = process.platform || "unknown"
		const ide = host.clineType || "unknown"
		hostInfo = { hostVersion, extensionVersion, platform, os, ide, distinctId }
	},
	get: () => hostInfo,
}
