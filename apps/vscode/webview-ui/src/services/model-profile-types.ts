/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
 *
 * Webview-side types for ModelProfile. The shape mirrors the
 * canonical `ModelProfileSummary` produced by
 * `apps/vscode/src/sdk/profile-store/webview-summary.ts` — these
 * types are duplicated locally to keep the webview free of
 * backend imports.
 *
 * Recon §11 froze the projection rules; the canonical projection
 * guarantees that none of these fields carry secret material.
 */

export interface ModelProfileSummary {
	profileId: string
	name: string
	providerId: string
	modelId: string
	isActive: boolean
	isDefault: boolean
}
