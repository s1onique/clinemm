/**
 * ACT-CLINEMM-COST-DISPLAY-TRUTH01 / CORRECTION02 — hook-level invariant.
 *
 *   "Only an explicit `"show"` authorization may produce a dollar
 *    spend claim. Everything else fails closed to `"hide"`."
 *
 * Specifically the hook MUST:
 *   - return "show"          for `usageCostDisplay === "show"`
 *   - return "subscription"  for `usageCostDisplay === "subscription"`
 *   - return "hide"          for every other value, including:
 *       * `usageCostDisplay === "hide"`
 *       * future SDK values ("credits-included", "quota",
 *         "enterprise-flat-rate", …) — the wire field is `string`,
 *         not a closed enum, so we cannot enumerate them
 *       * the empty string
 *       * any unrecognized shape
 *
 *   - return "hide"          while the catalog is loading (isLoading)
 *   - return "hide"          when the catalog is empty
 *   - return "hide"          when the catalog does not contain the
 *                             provider id
 *   - return "hide"          when providerId is undefined
 */

import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useProviderListings } from "./useProviderListings"
import { useProviderUsageCostDisplay } from "./useProviderUsageCostDisplay"

vi.mock("./useProviderListings", () => ({
	useProviderListings: vi.fn(),
}))

const mockUseProviderListings = vi.mocked(useProviderListings)

type HookState = {
	providers: { id: string; usageCostDisplay: string }[]
	isLoading: boolean
}

function setHookState(state: Partial<HookState>) {
	mockUseProviderListings.mockReturnValue({
		providers: [],
		isLoading: false,
		error: undefined,
		refresh: async () => [],
		...state,
	} as ReturnType<typeof useProviderListings>)
}

describe("ACT-CLINEMM-COST-DISPLAY-TRUTH01 / useProviderUsageCostDisplay", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("returns 'show' for a known metered provider", () => {
		setHookState({
			providers: [{ id: "anthropic", usageCostDisplay: "show" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("anthropic"))
		expect(result.current).toBe("show")
	})

	it("returns 'subscription' for a known flat-rate subscription provider", () => {
		setHookState({
			providers: [{ id: "cline-pass", usageCostDisplay: "subscription" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("cline-pass"))
		expect(result.current).toBe("subscription")
	})

	it("returns 'hide' for a known 'hide' provider", () => {
		setHookState({
			providers: [{ id: "openai-codex", usageCostDisplay: "hide" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("openai-codex"))
		expect(result.current).toBe("hide")
	})

	// CORRECTION01 P1: unknown/loading must be conservative — never
	// claim spend before the SDK confirms billing semantics.

	it("returns 'hide' when the catalog is still loading (isLoading=true)", () => {
		setHookState({
			providers: [],
			isLoading: true,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("anthropic"))
		expect(result.current).toBe("hide")
	})

	it("returns 'hide' when the catalog has loaded but is empty (no listing for the provider id)", () => {
		setHookState({
			providers: [],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("anthropic"))
		expect(result.current).toBe("hide")
	})

	it("returns 'hide' when the catalog has loaded but does not contain the provider id (even for a known-flat-rate id like cline-pass)", () => {
		setHookState({
			providers: [{ id: "anthropic", usageCostDisplay: "show" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("cline-pass"))
		expect(result.current).toBe("hide")
	})

	it("returns 'hide' when providerId is undefined", () => {
		setHookState({
			providers: [{ id: "anthropic", usageCostDisplay: "show" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay(undefined))
		expect(result.current).toBe("hide")
	})

	it("defaults unknown usageCostDisplay strings to 'hide' (forward-compat: 'show' is allowlist-only)", () => {
		// The wire field is `string`, not a closed protobuf enum. If a
		// future SDK introduces a new value this fork doesn't yet know
		// (e.g. "credits-included", "quota"), the webview must NOT
		// silently treat it as metered. The only path that authorizes a
		// spend claim is the explicit `"show"` value.
		setHookState({
			providers: [{ id: "some-provider", usageCostDisplay: "unknown-future-value" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("hide")
	})

	// CORRECTION02 (P2 follow-up from reviewer): forward-compat values
	// must all fail closed. The test list is intentionally concrete so
	// the invariant is unambiguous: anything not explicitly `"show"`
	// cannot authorize a price-tag.

	it("treats 'credits-included' as 'hide' (forward value)", () => {
		setHookState({
			providers: [{ id: "some-provider", usageCostDisplay: "credits-included" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("hide")
	})

	it("treats 'enterprise-flat-rate' as 'hide' (forward value)", () => {
		setHookState({
			providers: [{ id: "some-provider", usageCostDisplay: "enterprise-flat-rate" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("hide")
	})

	it("treats 'quota' as 'hide' (forward value)", () => {
		setHookState({
			providers: [{ id: "some-provider", usageCostDisplay: "quota" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("hide")
	})

	it("treats an empty-string usageCostDisplay as 'hide'", () => {
		setHookState({
			providers: [{ id: "some-provider", usageCostDisplay: "" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("hide")
	})
})
