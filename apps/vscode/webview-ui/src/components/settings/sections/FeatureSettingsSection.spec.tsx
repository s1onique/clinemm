import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
//
// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01: the mock now accepts
// the `onChange` prop (which the production component actually passes;
// see `FeatureSettingsSection.tsx` line ~267) and forwards it to the
// underlying input. The previous mock destructured `onInput` (which the
// production component never passes), so the change handler was
// `undefined` and `handleCeilingChange` was never invoked — the test
// was silently exercising the empty-string branch regardless of the
// test setup. The same `onChange` -> native input `onChange` wiring
// means `fireEvent.change` and `userEvent.type` both surface the typed
// value through `event.target.value`.
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		onChange,
		onBlur,
		placeholder,
		value,
		id,
	}: {
		onChange?: ChangeEventHandler<HTMLInputElement>
		onBlur?: () => void
		placeholder?: string
		value?: string
		id?: string
	}) => <input id={id} onBlur={onBlur} onChange={onChange} placeholder={placeholder} value={value ?? ""} />,
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

	it("persists an explicit positive integer ceiling on blur", async () => {
		// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01: switched from
		// `fireEvent.change` to `userEvent.type` because the controlled-input
		// mock does not surface the typed value through `event.target.value`
		// until React state has updated; `userEvent` properly drives the
		// controlled flow and the test now actually exercises the
		// positive-integer branch (the previous `fireEvent.change` form
		// silently hit the empty-string branch).
		mockExtensionState.value.userContextCeiling = undefined
		const user = userEvent.setup()
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		await user.type(ceilingField as Element, "256000")
		await user.tab() // blur via tab focus shift
		expect(mockUpdateSetting).toHaveBeenCalledWith("userContextCeiling", 256000)
	})

	it("rejects a negative or zero ceiling and reverts to the last persisted value", async () => {
		mockExtensionState.value.userContextCeiling = 128_000
		const user = userEvent.setup()
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		await user.clear(ceilingField as Element)
		await user.type(ceilingField as Element, "0")
		await user.tab()
		// Negative / non-positive inputs must NOT be persisted; the surface
		// reverts to the last persisted value (128_000).
		expect(mockUpdateSetting).not.toHaveBeenCalledWith("userContextCeiling", 0)
		// The persisted value is restored to the input by the rejection
		// path. After the useEffect re-syncs ceilingInput from the
		// userContextCeiling reference, the DOM reflects 128000.
		expect(ceilingField?.value).toBe("128000")
	})

	it("signs the explicit clear/reset intent when the user clears the field (Auto)", async () => {
		// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01: the clear path
		// uses the explicit `clearUserContextCeiling` sibling field. The
		// backend handler deletes the persisted key when this boolean is
		// true. The previous design sent `userContextCeiling = undefined`,
		// which is indistinguishable from "field absent" on the proto3 wire
		// and left the persisted value intact.
		mockExtensionState.value.userContextCeiling = 512_000
		const user = userEvent.setup()
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)
		const ceilingField = container.querySelector("#user-context-ceiling") as HTMLInputElement | null
		expect(ceilingField).toBeTruthy()
		await user.clear(ceilingField as Element)
		await user.tab()
		expect(mockUpdateSetting).toHaveBeenCalledWith("clearUserContextCeiling", true)
		// The value field must NOT be sent alongside the clear signal.
		expect(mockUpdateSetting).not.toHaveBeenCalledWith("userContextCeiling", undefined)
	})
})
