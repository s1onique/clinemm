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
