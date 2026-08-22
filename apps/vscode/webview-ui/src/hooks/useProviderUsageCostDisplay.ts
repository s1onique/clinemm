import { useMemo } from "react"
import { useProviderListings } from "./useProviderListings"

/**
 * Surfaces the SDK's `usageCostDisplay` decision for a single provider
 * id. The decision originates in the `@cline/llms` SDK (see
 * `resolveProviderUsageCostDisplay` in
 * `apps/vscode/src/sdk/model-catalog/catalog.ts`) and is propagated
 * through the `ProviderListing.usage_cost_display` gRPC field.
 *
 * Returns `"hide"` or `"subscription"` when the SDK reports a
 * subscription-style provider whose per-token / total cost displays
 * should be suppressed (matches the CLI's `shouldShowCliUsageCost`
 * consumer in `sdk/apps/cli`).
 *
 * ACT-CLINEMM-COST-DISPLAY-TRUTH01 — Conservative-when-unknown contract:
 *
 *   known show          → "show"   (only path that authorizes a spend claim)
 *   known hide          → "hide"
 *   known subscription  → "subscription"
 *   unknown / loading   → "hide"   (suppress cost, do not claim spend)
 *   unknown future value → "hide"  (forward-compatibility: the wire
 *                                    `usage_cost_display` is a `string`,
 *                                    not a closed enum; a future SDK
 *                                    value must NOT silently default to
 *                                    metered. Allowlist-only.)
 *
 * "Show" is an explicit allowlist, not a default. Asserting a charged
 * dollar amount while billing semantics are unknown — whether due to
 * a still-loading catalog or a future SDK value this fork does not yet
 * know — is materially misleading for flat-rate providers (e.g.
 * ClinePass). The reference price is not the user's per-task spend.
 *
 * The catalog hook (`useProviderListings`) exposes an explicit
 * `isLoading` flag; we consult it directly rather than inferring
 * readiness from an empty list.
 *
 * Return union is `"show" | "hide" | "subscription"` (widened from the
 * 2-valued `"show" | "hide"` of pre-ACT main). Renderers must gate
 * cost on `=== "show"` (not `!== "hide"`) to keep flat-rate
 * subscription providers from leaking token-derived reference
 * pricing as charged spend.
 *
 * Webview consumers must pass the returned value into
 * `ModelInfoView.hideUsageCost` (and equivalent cost-display sites)
 * rather than re-deriving it. If a new provider needs to suppress cost,
 * set `metadata.usageCostDisplay = "hide"` (or `"subscription"`) in the
 * SDK provider builtin; the webview picks it up without any change
 * here.
 */
export type WebviewUsageCostDisplay = "show" | "hide" | "subscription"

export function useProviderUsageCostDisplay(providerId: string | undefined): WebviewUsageCostDisplay {
	const { providers, isLoading } = useProviderListings()
	return useMemo(() => {
		if (!providerId) {
			return "hide"
		}
		// While the catalog is loading (or has errored), we cannot know
		// the billing semantics of the current provider. Refuse to make
		// a spend claim until the SDK's `usageCostDisplay` value resolves.
		if (isLoading || providers.length === 0) {
			return "hide"
		}
		const listing = providers.find((p) => p.id === providerId)
		if (!listing) {
			return "hide"
		}
		// Allowlist `"show"` only. The wire field is `string`, so any
		// forward value (e.g. `"credits-included"`, `"quota"`,
		// `"enterprise-flat-rate"`) must NOT default to metered.
		const raw = listing.usageCostDisplay
		if (raw === "show") {
			return "show"
		}
		if (raw === "subscription") {
			return "subscription"
		}
		return "hide"
	}, [providers, isLoading, providerId])
}
