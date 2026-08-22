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

	it("defaults unknown usageCostDisplay strings to 'show' (only known values are 'hide' / 'subscription')", () => {
		setHookState({
			providers: [{ id: "some-provider", usageCostDisplay: "unknown-future-value" }],
			isLoading: false,
		})
		const { result } = renderHook(() => useProviderUsageCostDisplay("some-provider"))
		expect(result.current).toBe("show")
	})
})
