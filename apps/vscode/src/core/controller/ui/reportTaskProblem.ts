import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import {
	buildBuildRuntimeIdentity,
	readBuildProvenance,
	readInstalledPackageVersion,
	readOnDiskBundleSha256,
} from "@/sdk/automatic-incident-build-identity"
import { getAutomaticIncidentExtensionHostInstanceId } from "@/sdk/automatic-incident-capture"
import { runAutomaticIncidentExport } from "@/sdk/automatic-incident-export-runtime"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 (AICE01)
 *
 * The webview -> extension-host entry point for the ONE-CLICK local
 * incident export.
 *
 * THE REQUEST IS NARROW BY CONSTRUCTION
 * -------------------------------------
 *
 * The request carries NO parameters at all: no incident id, no task
 * id, no filesystem path. The extension host resolves the ACTIVE
 * task's retained incident through its OWN authority, so the webview
 * can never determine the authoritative incident identity and can
 * never direct a write to an arbitrary path.
 *
 * The SAME flow backs the `cline.reportTaskProblem` COMMAND, so the
 * feature is usable from the Command Palette without the webview.
 *
 * NOTHING is transmitted. There is no network call on this path.
 *
 * The dialogs are reached through the HOST BRIDGE (`HostProvider`), not
 * through `vscode.commands.executeCommand` — the repository's lint
 * rules forbid the latter outside the VS Code entry point, and the
 * standalone core cannot provide the `vscode` module at all.
 */
export async function reportTaskProblem(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		const extensionPath = HostProvider.isInitialized() ? HostProvider.get().extensionFsPath : undefined
		const provenance = extensionPath ? await readBuildProvenance(extensionPath) : undefined
		const onDiskBundleSha256 = extensionPath ? await readOnDiskBundleSha256(extensionPath) : undefined
		const installedPackageVersion = extensionPath ? await readInstalledPackageVersion(extensionPath) : undefined
		const buildIdentity = buildBuildRuntimeIdentity({
			provenance,
			installedPackageVersion,
			runtime: {
				runtimeInstanceId: getAutomaticIncidentExtensionHostInstanceId(),
				extensionVersion: ExtensionRegistryInfo.version,
				hostPlatform: process.platform,
				hostArchitecture: process.arch,
				onDiskBundleSha256,
			},
		})

		const windowClient = HostProvider.isInitialized() ? HostProvider.get().hostBridge.windowClient : undefined
		if (!windowClient) {
			Logger.error("[AICE01] report task problem: the host bridge window client is unavailable")
			return Empty.create({})
		}

		await runAutomaticIncidentExport({
			context: controller.context,
			activeTaskId: controller.task?.taskId,
			buildIdentity,
			dialogs: {
				confirm: async (message, confirmLabel) => {
					const response = await windowClient.showMessage({
						type: 1, // INFORMATION
						message,
						options: { modal: true, items: [confirmLabel] },
					})
					return response.selectedOption
				},
				chooseDestination: async (options) => {
					const response = await windowClient.showSaveDialog({
						options: {
							defaultPath: options.defaultPath,
							filters: { "Diagnostic ZIP": { extensions: ["zip"] } },
						},
					})
					return response.selectedPath
				},
				reportError: (message) => {
					Logger.warn(`[AICE01] report task problem: ${message}`)
					void windowClient.showMessage({
						type: 0, // ERROR
						message: `ClineMM: ${message}`,
					})
				},
				reportSuccess: (message) => {
					Logger.log(`[AICE01] report task problem: ${message}`)
					void windowClient.showMessage({
						type: 1, // INFORMATION
						message: `ClineMM: ${message}`,
					})
				},
			},
		})
		return Empty.create({})
	} catch (error) {
		// The export flow owns the user-facing error reporting. A
		// failure here MUST NOT be silent, but it also MUST NOT throw
		// an unhandled rejection into the webview bridge.
		Logger.error(`[AICE01] reportTaskProblem request failed: ${error instanceof Error ? error.message : String(error)}`)
		return Empty.create({})
	}
}
