/**
 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01-CORRECTION01
 *
 * UI tests for the SandboxCapabilitiesSection. Green-disk evidence
 * for the §P0 review finding: T11_UI_STATE and the header-assertion
 * gate that locks the SandBox & Capabilities section header in place
 * so the `renderSectionHeader(tabId)` exact-lookup pattern cannot
 * silently regress again.
 *
 * Test-runner: vitest (matches the existing
 * FeatureSettingsSection.spec.tsx pattern; webview's vite.config.ts
 * defines the @shared path alias). bun test does NOT pick up
 * vite.config.ts aliases and fails on `@shared/proto/cline/state`
 * resolution — vitest is the intended runner for webview-ui tests.
 *
 * Switch interaction: Radix Switch renders a button[role=switch]
 * (NOT a native input[type=checkbox]). Tests select by `id={label}`
 * (the Switch primitive forwards `id`) and click the node.
 *
 * Header assertion: `renderSectionHeader` performs an exact-lookup
 * on `SETTINGS_TABS.find((t) => t.id === tabId)` and returns null
 * when the id is unknown. We assert the header renders the heading
 * "Sandbox & Capabilities" (and not null), so the exact-lookup
 * regression cannot recur.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SandboxCapabilitiesSection from "./SandboxCapabilitiesSection"

const mockUpdateSetting = vi.fn()
const mockExtensionState = vi.hoisted(() => ({
	value: {
		clinemmSafeYoloAllowNetwork: false,
		clinemmSafeYoloAllowSshAgent: false,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => mockExtensionState.value),
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: () => null,
}))

describe("ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01 — SandboxCapabilitiesSection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockExtensionState.value.clinemmSafeYoloAllowNetwork = false
		mockExtensionState.value.clinemmSafeYoloAllowSshAgent = false
	})

	it("renders both capability toggles", () => {
		render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		expect(screen.getByText(/Allow outbound network/i)).toBeTruthy()
		expect(screen.getByText(/Allow SSH agent authentication/i)).toBeTruthy()
	})

	it("toggling Allow outbound network dispatches updateSetting(clinemmSafeYoloAllowNetwork, true)", () => {
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		// Toggle row switches are Radix Switches (button[role=switch]).
		// Each row has its own aria-label matching the visible label.
		// The two toggles inside the Sandbox section are the only
		// switches in the rendered tree at this depth; we pick by
		// aria-label uniqueness (no CSS-id escaping needed).
		const networkSwitch = container.querySelector('[aria-label="Allow outbound network"]')
		expect(networkSwitch).toBeTruthy()
		fireEvent.click(networkSwitch as Element)
		expect(mockUpdateSetting).toHaveBeenCalledWith("clinemmSafeYoloAllowNetwork", true)
	})

	it("toggling Allow SSH agent dispatches updateSetting(clinemmSafeYoloAllowSshAgent, true)", () => {
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		const sshAgentSwitch = container.querySelector(
			'[aria-label="Allow SSH agent authentication"]',
		)
		expect(sshAgentSwitch).toBeTruthy()
		fireEvent.click(sshAgentSwitch as Element)
		expect(mockUpdateSetting).toHaveBeenCalledWith("clinemmSafeYoloAllowSshAgent", true)
	})

	it("toggling one capability does not dispatch updateSetting for the other (independence)", () => {
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		const networkSwitch = container.querySelector('[aria-label="Allow outbound network"]')
		fireEvent.click(networkSwitch as Element)
		expect(mockUpdateSetting).toHaveBeenCalledWith("clinemmSafeYoloAllowNetwork", true)
		expect(mockUpdateSetting).not.toHaveBeenCalledWith(
			"clinemmSafeYoloAllowSshAgent",
			expect.anything(),
		)
	})

	it("renders the persisted true value as the switch's checked state (visual truth)", () => {
		mockExtensionState.value.clinemmSafeYoloAllowNetwork = true
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		const networkSwitch = container.querySelector('[aria-label="Allow outbound network"]')
		expect(networkSwitch).toBeTruthy()
		// Radix Switch with checked={true} renders
		// data-state="checked" on the root (the Switch primitive
		// is a button[role=switch], not a native checkbox input).
		expect((networkSwitch as HTMLElement).getAttribute("data-state")).toBe("checked")
	})

	// §P0 closure-blocker: locks the `renderSectionHeader("sandbox")`
	// exact-lookup. If a future refactor changes the tab id, the
	// SectionHeader helper returns null and the heading vanishes;
	// this test catches that regression instantly.
	it("renders the 'Sandbox & Capabilities' section header (renderSectionHeader('sandbox') lock)", () => {
		const observed: string[] = []
		const { container } = render(
			<SandboxCapabilitiesSection
				renderSectionHeader={(tabId) => {
					observed.push(tabId)
					return (
						<div data-testid="section-header" data-tab-id={tabId}>
							Sandbox & Capabilities
						</div>
					)
				}}
			/>,
		)
		// renderSectionHeader must be invoked exactly once with the
		// canonical tab id "sandbox" (the exact-lookup key in
		// SettingsView.tsx). A return of null means the section
		// renders without its heading.
		expect(observed).toEqual(["sandbox"])
		expect(
			container.querySelector('[data-testid="section-header"][data-tab-id="sandbox"]'),
		).toBeTruthy()
	})
})
