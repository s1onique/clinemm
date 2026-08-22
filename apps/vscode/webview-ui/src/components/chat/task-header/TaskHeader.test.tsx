/**
 * ACT-CLINEMM-COST-DISPLAY-TRUTH01 — TaskHeader cost-display tests.
 *
 * Product contract:
 *   The TaskHeader price-tag (`#price-tag`) must NEVER render a literal
 *   dollar amount as task spend for billing modes where that number is not
 *   the user's marginal monetary spend.
 *
 *   METERED providers (`usageCostDisplay === "show"`)
 *     → cost MAY be shown
 *
 *   FLAT_RATE_SUBSCRIPTION (`usageCostDisplay === "subscription"`)
 *     → cost MUST NOT be presented as task spend
 *
 *   LOCAL_NO_DIRECT_COST (`apiProvider` ∈ {vscode-lm, ollama, lmstudio})
 *     → no fabricated dollar spend
 *
 *   "hide" (`usageCostDisplay === "hide"`)
 *     → cost MUST NOT be presented as task spend
 *
 *   UNKNOWN / LOADING (catalog unresolved, provider id absent)
 *     → cost MUST NOT be presented as task spend (conservative fallback
 *       is "hide", not "show" — claiming a charged amount while billing
 *       semantics are unresolved is materially misleading for flat-rate
 *       providers)
 *
 * The RED (before this ACT's repair): subscription providers leaked
 * `$0.0082`-style values because the catalog layer collapsed
 * `"subscription"` to `"show"` and the TaskHeader gated only on
 * `!== "hide"`. CORRECTION01 (P1 follow-up) closed the remaining
 * transient leak during catalog loading by returning `"hide"` for
 * unresolved providers, so a metered provider that has not yet been
 * registered in the catalog does NOT show a price-tag until the SDK
 * confirms `usageCostDisplay === "show"`.
 */

import type { ApiProvider } from "@shared/api"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockState = vi.hoisted(() => ({
	apiConfiguration: { actModeApiProvider: "anthropic" as ApiProvider },
	usageCostDisplay: "show" as "show" | "hide" | "subscription" | "loading",
	selectedModelInfo: { supportsPromptCache: true } as { supportsPromptCache: boolean } | undefined,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: mockState.apiConfiguration,
		currentTaskItem: undefined,
		mode: "act",
		expandTaskHeader: false,
		setExpandTaskHeader: vi.fn(),
		environment: undefined,
		workspaceRoots: undefined,
		platform: "vscode",
		turnState: { phase: "idle", seq: 0 },
		taskTelemetry: undefined,
		taskHeaderPresentation: undefined,
	}),
}))

vi.mock("@/hooks/useNormalizedApiConfiguration", () => ({
	useNormalizedApiConfiguration: () => ({
		selectedModelInfo: mockState.selectedModelInfo,
		// The "act" mode wrapper currently used by TaskHeader
		// (`getModeSpecificFields(apiConfiguration, mode)`) is the same helper
		// `useNormalizedApiConfiguration` invokes under the hood; we mirror its
		// minimum here so the TaskHeader gate evaluates against `apiProvider`.
	}),
}))

// `useProviderUsageCostDisplay` returns "hide" while the catalog is
// unresolved (loading or empty). Tests model that state by setting
// `usageCostDisplay = "loading"`; the hook contract collapses that to
// "hide" so the TaskHeader does not render a price-tag until the SDK
// has confirmed `usageCostDisplay === "show"`.
vi.mock("@/hooks/useProviderUsageCostDisplay", () => ({
	useProviderUsageCostDisplay: () => (mockState.usageCostDisplay === "loading" ? "hide" : mockState.usageCostDisplay),
}))

// The TaskHeader renders several child components that are not part of the
// cost-display contract. Stub them out so the assertion is isolated to the
// `#price-tag` rendering decision.
vi.mock("./buttons/CopyTaskButton", () => ({ default: () => null }))
vi.mock("./buttons/DeleteTaskButton", () => ({ default: () => null }))
vi.mock("./buttons/NewTaskButton", () => ({ default: () => null }))
vi.mock("./buttons/OpenDiskConversationHistoryButton", () => ({ default: () => null }))
vi.mock("./ContextWindow", () => ({ default: () => null }))
vi.mock("./TaskHeaderTelemetry", () => ({ default: () => null }))
vi.mock("./TaskWorkingDirectoryBadge", () => ({ default: () => null }))
vi.mock("./Highlights", () => ({ highlightText: (text: string) => text }))

const baseTask: ClineMessage = {
	type: "say",
	say: "task",
	text: "Build a weather widget",
	ts: 1,
}

const baseProps = {
	task: baseTask,
	tokensIn: 1234,
	tokensOut: 567,
	cacheWrites: 0,
	cacheReads: 0,
	totalCost: 0.0082,
	doesModelSupportPromptCache: true,
	onClose: () => {},
}

describe("ACT-CLINEMM-COST-DISPLAY-TRUTH01 / TaskHeader price-tag", () => {
	beforeEach(() => {
		mockState.apiConfiguration = { actModeApiProvider: "anthropic" as ApiProvider }
		mockState.usageCostDisplay = "show"
		mockState.selectedModelInfo = { supportsPromptCache: true }
	})

	it("CDT01: renders the price-tag for metered providers (anthropic, usageCostDisplay='show')", () => {
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).not.toBeNull()
	})

	it("CDT02: does NOT render the price-tag for flat-rate subscription providers (cline-pass, usageCostDisplay='subscription')", () => {
		mockState.apiConfiguration = { actModeApiProvider: "cline-pass" as ApiProvider }
		mockState.usageCostDisplay = "subscription"
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()
	})

	it("CDT03: does NOT render the price-tag for providers marked hide (openai-codex, usageCostDisplay='hide')", () => {
		mockState.apiConfiguration = { actModeApiProvider: "openai-codex" as ApiProvider }
		mockState.usageCostDisplay = "hide"
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()
	})

	it("CDT04: does NOT render the price-tag for local-no-direct-cost providers (vscode-lm)", () => {
		mockState.apiConfiguration = { actModeApiProvider: "vscode-lm" as ApiProvider }
		mockState.usageCostDisplay = "show"
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()
	})

	it("CDT05: does NOT render the price-tag for local-no-direct-cost providers (ollama)", () => {
		mockState.apiConfiguration = { actModeApiProvider: "ollama" as ApiProvider }
		mockState.usageCostDisplay = "show"
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()
	})

	it("CDT06: does NOT render the price-tag for local-no-direct-cost providers (lmstudio)", () => {
		mockState.apiConfiguration = { actModeApiProvider: "lmstudio" as ApiProvider }
		mockState.usageCostDisplay = "show"
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()
	})

	// CORRECTION01 (P1 follow-up) — "unknown / loading" is conservative-
	// when-unknown. Claiming a charged amount while billing semantics
	// are unresolved is materially misleading for flat-rate providers.

	it("CDT07: does NOT render the price-tag while catalog is unresolved for a subscription provider (cline-pass)", () => {
		// Catalog loading is in progress: the hook falls back to "hide".
		// Even though the eventual answer is "subscription", we must
		// refuse to render `$0.0082` before the SDK confirms that.
		mockState.apiConfiguration = { actModeApiProvider: "cline-pass" as ApiProvider }
		mockState.usageCostDisplay = "loading"
		render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()
	})

	it("CDT08: catalog-unresolved metered provider (anthropic) suppresses the price-tag, then reveals it once the SDK reports usageCostDisplay='show'", () => {
		// While the catalog is still loading for a metered provider, the
		// hook must return "hide" (NOT "show"). This proves we are not
		// permanently suppressing metered cost — we are merely refusing
		// to make a billing claim before the SDK confirms it.
		mockState.apiConfiguration = { actModeApiProvider: "anthropic" as ApiProvider }
		mockState.usageCostDisplay = "loading"
		const { rerender } = render(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).toBeNull()

		// Catalog resolves with usageCostDisplay === "show"; the
		// price-tag must now appear.
		mockState.usageCostDisplay = "show"
		rerender(<TaskHeader {...baseProps} />)
		expect(document.getElementById("price-tag")).not.toBeNull()
	})
})

import TaskHeader from "./TaskHeader"
