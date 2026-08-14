import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"

export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		// In VS Code Web (code serve-web), the auth callback is handled by an HTTP server
		// (AuthHandler). Returning empty here means the success page won't try to redirect
		// to a vscode:// URI (which would open the desktop app instead of the web tab).
		return { value: "" }
	}
	const uriScheme = vscode.env.uriScheme || "vscode"
	// Build the OAuth redirect URI from the runtime extension identity (publisher + name)
	// so it tracks the actual extension ID registered with the host. The hardcoded
	// "saoudrizwan.claude-dev" upstream identity breaks the moment the fork changes
	// its publisher/name (which the ClineMM dogfood intentionally does).
	return { value: `${uriScheme}://${ExtensionRegistryInfo.id}` }
}
