/**
 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01
 *
 * UI state test for the new SandboxCapabilitiesSection. Red-state:
 * the section component does not yet exist; importing it should fail
 * until it is added to webview-ui/src/components/settings/sections/.
 *
 * Post-GREEN behaviour:
 *   - section renders from authoritative state
 *   - toggling "Allow outbound network" dispatches
 *     updateSetting("clinemmSafeYoloAllowNetwork", checked)
 *   - toggling "Allow SSH agent authentication" dispatches
 *     updateSetting("clinemmSafeYoloAllowSshAgent", checked)
 *   - the two controls are independent (toggling one does not call
 *     updateSetting for the other)
 *   - the section never sets the persisted value to a non-boolean /
 *     undefined / non-finite type — defensive input hygiene
 *
 * The test follows the precedent of
 * `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx`:
 * mock `useExtensionState`, mock the `updateSetting` helper,
 * mock webview-toolkit. Render with `@testing-library/react`.
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
		const switches = container.querySelectorAll("input[type=checkbox]")
		// The Switch component (ui/switch) renders a checkbox input. The
		// first toggle is the network one.
		const networkSwitch = switches[0] as HTMLInputElement
		expect(networkSwitch).toBeTruthy()
		fireEvent.click(networkSwitch)
		expect(mockUpdateSetting).toHaveBeenCalledWith("clinemmSafeYoloAllowNetwork", true)
	})

	it("toggling Allow SSH agent dispatches updateSetting(clinemmSafeYoloAllowSshAgent, true)", () => {
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		const switches = container.querySelectorAll("input[type=checkbox]")
		const sshAgentSwitch = switches[1] as HTMLInputElement
		expect(sshAgentSwitch).toBeTruthy()
		fireEvent.click(sshAgentSwitch)
		expect(mockUpdateSetting).toHaveBeenCalledWith("clinemmSafeYoloAllowSshAgent", true)
	})

	it("toggling one capability does not dispatch updateSetting for the other (independence)", () => {
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		const switches = container.querySelectorAll("input[type=checkbox]")
		const networkSwitch = switches[0] as HTMLInputElement
		fireEvent.click(networkSwitch)
		expect(mockUpdateSetting).toHaveBeenCalledWith("clinemmSafeYoloAllowNetwork", true)
		expect(mockUpdateSetting).not.toHaveBeenCalledWith("clinemmSafeYoloAllowSshAgent", expect.anything())
	})

	it("renders the persisted true value as the switch's checked state (visual truth, no hidden protocol delta)", () => {
		mockExtensionState.value.clinemmSafeYoloAllowNetwork = true
		const { container } = render(<SandboxCapabilitiesSection renderSectionHeader={() => null} />)
		const switches = container.querySelectorAll("input[type=checkbox]")
		const networkSwitch = switches[0] as HTMLInputElement
		expect(networkSwitch.checked).toBe(true)
	})
})
