import { fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FeatureSettingsSection from "./FeatureSettingsSection"

const mockUpdateSetting = vi.fn()
const mockExtensionState = vi.hoisted(() => ({
	value: {
		enableCheckpointsSetting: true,
		hooksEnabled: false,
		showFeatureTips: false,
		mcpDisplayMode: "rich",
		useAutoCondense: false,
		compactionStrategy: "basic",
		// ACT-CLINEMM-USER-CONTEXT-CEILING01: undefined = Auto (no explicit
		// operating ceiling). The settings surface preserves the field so a
		// future configured value survives a remount.
		userContextCeiling: undefined,
		subagentsEnabled: false,
		worktreesEnabled: { user: true, featureFlag: true },
		focusChainSettings: { enabled: false, remindClineInterval: 6 },
		remoteConfigSettings: {},
		backgroundEditEnabled: false,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => mockExtensionState.value),
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

// ACT-CLINEMM-USER-CONTEXT-CEILING01: VSCodeTextField is a web component with
// shadow DOM; mock it to a plain input so fireEvent can drive value/change.
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		onInput,
		onBlur,
		placeholder,
		value,
		id,
	}: {
		onInput?: ChangeEventHandler<HTMLInputElement>
		onBlur?: () => void
		placeholder?: string
		value?: string
		id?: string
	}) => <input id={id} onBlur={onBlur} onChange={onInput} placeholder={placeholder} value={value ?? ""} />,
}))

describe("FeatureSettingsSection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockExtensionState.value = {
			...mockExtensionState.value,
			useAutoCondense: false,
			compactionStrategy: "basic",
			userContextCeiling: undefined,
		}
	})

	it("renders Hooks feature toggle", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Hooks")).toBeTruthy()

		const advancedSection = container.querySelector("#advanced-features")
		const agentSection = container.querySelector("#agent-features")

		expect(advancedSection?.querySelector("#Hooks")).toBeTruthy()
		expect(agentSection?.querySelector("#Hooks")).toBeNull()
	})

	it("renders Feature Tips toggle in the Editor section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Feature Tips")).toBeTruthy()

		const editorSection = container.querySelector("#optional-features")
		const agentSection = container.querySelector("#agent-features")

		expect(editorSection?.querySelector('[id="Feature Tips"]')).toBeTruthy()
		expect(agentSection?.querySelector('[id="Feature Tips"]')).toBeNull()
	})

	it("renders the Auto Compact Strategy setting in the Agent section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Auto Compact Strategy")).toBeTruthy()

		const agentSection = container.querySelector("#agent-features")
		expect(agentSection?.textContent).toContain("Basic")
	})

	it("disables Auto Compact Strategy when Auto Compact is off", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const strategySelect = container.querySelector("#agent-features button[role='combobox']")
		expect(strategySelect).toHaveAttribute("disabled")
	})

	it("calls updateSetting with hooksEnabled when toggled", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const hooksSwitch = container.querySelector("#Hooks")
		expect(hooksSwitch).toBeTruthy()

		fireEvent.click(hooksSwitch as Element)

		expect(mockUpdateSetting).toHaveBeenCalledWith("hooksEnabled", true)
	})

	it("calls updateSetting with showFeatureTips when toggled", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const featureTipsSwitch = container.querySelector('[id="Feature Tips"]')
		expect(featureTipsSwitch).toBeTruthy()

		fireEvent.click(featureTipsSwitch as Element)

		expect(mockUpdateSetting).toHaveBeenCalledWith("showFeatureTips", true)
	})

	// ACT-CLINEMM-USER-CONTEXT-CEILING01: settings surface for the user-controlled
	// operating context ceiling. The Auto option is represented by an empty
	// text field; an explicit numeric value is persisted as a positive integer
	// token count. Invalid values are rejected client-side and the persisted
	// state is unchanged.
	it("renders the Context ceiling input with empty placeholder for Auto", () => {
		mockExtensionState.value.userContextCeiling = undefined
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling")
		expect(ceilingField).toBeTruthy()
	})

	it("renders the persisted ceiling value as the text input value", () => {
		mockExtensionState.value.userContextCeiling = 512_000
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		expect(ceilingField?.value).toBe("512000")
	})

	it("persists an explicit positive integer ceiling on blur", () => {
		mockExtensionState.value.userContextCeiling = undefined
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		// Simulate user typing a value
		fireEvent.change(ceilingField as Element, { target: { value: "256000" } })
		fireEvent.blur(ceilingField as Element)
		expect(mockUpdateSetting).toHaveBeenCalledWith("userContextCeiling", 256000)
	})

	it("rejects a negative or zero ceiling and reverts to the last persisted value", () => {
		mockExtensionState.value.userContextCeiling = 128_000
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		fireEvent.change(ceilingField as Element, { target: { value: "0" } })
		fireEvent.blur(ceilingField as Element)
		// Negative / non-positive inputs must NOT be persisted; the surface
		// reverts to the last persisted value (128_000).
		expect(mockUpdateSetting).not.toHaveBeenCalledWith("userContextCeiling", 0)
		expect(ceilingField?.value).toBe("128000")
	})

	it("persists undefined when the user clears the field (Auto)", () => {
		mockExtensionState.value.userContextCeiling = 512_000
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		fireEvent.change(ceilingField as Element, { target: { value: "" } })
		fireEvent.blur(ceilingField as Element)
		expect(mockUpdateSetting).toHaveBeenCalledWith("userContextCeiling", undefined)
	})
})
