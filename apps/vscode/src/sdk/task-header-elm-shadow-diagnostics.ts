// ===========================================================================
// ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
//
// Command Palette diagnostic surface for the TaskHeader Elm
// runtime-shadow observer.
//
// Wires the bounded observation ring to a single VS Code command:
//
//   ClineMM: Task Header Elm Shadow Diagnostics
//     cline.taskHeaderElmShadowDiagnostics
//
// Invoking the command shows the compact summary
// (`Task Header Elm Runtime Shadow` header + the seven counters)
// via `vscode.window.showInformationMessage` and then opens a
// `showQuickPick` action picker with three entries:
//
//   - Copy Report
//       Copies the full report (summary + recent bounded
//       observations) to the system clipboard via
//       `HostProvider.env.clipboardWriteText`. Used for off-line
//       inspection by Factory engineers.
//   - Reset Observations
//       Clears ONLY the bounded observation ring. Does NOT touch
//       the enabled flag, the TS presentation, the Elm kernel
//       state, or any other production state. Mirrors the
//       THSICAP / BOCOR / BJLA / CCARD `dump != clear` contract.
//   - Close
//       No-op dismissal.
//
// When invoked OUTSIDE dogfood (or when the runtime shadow is
// disabled), the handler returns a single-message
// `showInformationMessage`:
//
//   "Task Header Elm runtime shadow is disabled in this profile."
//
// This is the spec-mandated fallback per C7 — no new context-key
// framework is introduced.
//
// REMOVAL_TRIGGER (per Factory doctrine on temporary diagnostics):
//   first successful LIVE qualification that authorizes cutover
//   to `ORCHESTRATION03-AUTHORITY`, OR
//   the first real LIVE semantic mismatch that identifies a
//   contract defect, OR
//   CAPTURE_INSUFFICIENT.
// When cutover lands, REMOVE this module + the registry entry +
// the package.json declaration + the wiring in `extension.ts:activate`
// + the `SOT`-level helpers in `task-header-elm-shadow.ts` together.
// ===========================================================================

import { StringRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import {
	formatTaskHeaderElmRuntimeShadowReport,
	getTaskHeaderElmRuntimeShadowObservations,
	isTaskHeaderElmRuntimeShadowEnabled,
	resetTaskHeaderElmRuntimeShadowObservations,
} from "./task-header-elm-shadow"

/**
 * Pure action selection: which Command Palette action did the
 * operator pick? Testable without VS Code UI by feeding a fixed
 * `selection` label.
 */
export type TaskHeaderElmRuntimeShadowDiagnosticsAction = "copy" | "reset" | "close"

export function selectTaskHeaderElmRuntimeShadowDiagnosticsAction(
	selection: string | undefined,
): TaskHeaderElmRuntimeShadowDiagnosticsAction {
	if (selection === "Copy Report") return "copy"
	if (selection === "Reset Observations") return "reset"
	return "close"
}

/**
 * Pure formatter — produce the report the operator sees (the
 * Command Palette surfaces this via `showInformationMessage` and
 * the "Copy Report" action via the clipboard). Re-exports
 * `formatTaskHeaderElmRuntimeShadowReport` for module-internal
 * convenience.
 */
export function buildTaskHeaderElmRuntimeShadowDiagnosticsReport(): string {
	const observations = getTaskHeaderElmRuntimeShadowObservations()
	return formatTaskHeaderElmRuntimeShadowReport(observations)
}

/**
 * Build the quick-pick options shown to the operator. When the
 * ring is empty, "Reset Observations" is still offered (it is a
 * no-op) and "Copy Report" still copies the empty summary.
 * Treated as a pure function so tests can pin the option labels
 * without mocking VS Code UI.
 */
export function buildTaskHeaderElmRuntimeShadowDiagnosticsActionOptions(): readonly string[] {
	return ["Copy Report", "Reset Observations", "Close"]
}

/**
 * Apply the chosen Command Palette action. Pure relative to the
 * observation ring + module seam; side-effects are limited to
 * (a) clipboard writes via the host bridge,
 * (b) `reset*` -> ring mutation,
 * (c) `close` -> no-op.
 *
 * Returns a short operator-facing message for the result popup;
 * the caller decides whether to surface it via
 * `showInformationMessage`.
 */
export async function applyTaskHeaderElmRuntimeShadowDiagnosticsAction(
	action: TaskHeaderElmRuntimeShadowDiagnosticsAction,
): Promise<string> {
	switch (action) {
		case "copy": {
			const report = buildTaskHeaderElmRuntimeShadowDiagnosticsReport()
			try {
				await HostProvider.env.clipboardWriteText(StringRequest.create({ value: report }))
				return `Report copied to clipboard (${report.length} chars).`
			} catch (err) {
				Logger.error("[task-header-elm-shadow-diagnostics] clipboard write failed", err)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Copy report failed: ${err instanceof Error ? err.message : String(err)}`,
				})
				return `Copy report failed.`
			}
		}
		case "reset":
			resetTaskHeaderElmRuntimeShadowObservations()
			return "Observations cleared."
		case "close":
		default:
			return ""
	}
}

/**
 * Render the disabled-profile message the spec mandates per C7
 * when the runtime shadow is OFF (i.e. outside dogfood).
 */
export function buildTaskHeaderElmRuntimeShadowDiagnosticsDisabledMessage(): string {
	return "Task Header Elm runtime shadow is disabled in this profile."
}

/**
 * Quick boolean — is the runtime shadow currently enabled in this
 * extension host? Re-exported through this module so the handler
 * does not need to import the underlying module seam.
 */
export function isTaskHeaderElmRuntimeShadowDiagnosticsEnabled(): boolean {
	return isTaskHeaderElmRuntimeShadowEnabled()
}
