/**
 * ACT-CLINEMM-REASONING-DEFAULT-NONE-SEMANTICS-REPAIR-01.
 *
 * C2/C4 — the SETTINGS UI for the three distinct user-visible reasoning
 * selections.
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 *
 * The selector resolved an ABSENT persisted effort to the caller's
 * `defaultEffort`, and the callers passed `"none"`, so the ABSENT state was
 * DISPLAYED as `None`. The user could not tell "the model applies its own
 * reasoning policy" from "I explicitly disabled reasoning".
 *
 * The `onEffortChange` handler then wrote
 *
 *     { enabled: effort !== "none", effort: effort !== "none" ? effort : undefined }
 *
 * which DISCARDED the explicit `"none"` value, so an explicit user
 * selection could not survive to the persisted configuration at all.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The REAL selector component is rendered:
 *
 *   - an ABSENT persisted effort displays `Default`, not `None`;
 *   - `Default` and `None` are BOTH offered, as distinct selections;
 *   - choosing `None` reports the explicit `"none"` selection;
 *   - choosing `Default` reports the `"default"` selection, which REMOVES
 *     the explicit override rather than recording an explicit disable.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import ReasoningEffortSelector from "./ReasoningEffortSelector"

const mocks = vi.hoisted(() => ({
	updateApiConfigurationProto: vi.fn(async () => undefined),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		updateApiConfigurationProto: mocks.updateApiConfigurationProto,
	},
}))

/**
 * Open the selector's dropdown and pick the named option.
 *
 * The selector is a Radix select, so the option list is only mounted while
 * the dropdown is open.
 */
async function chooseOption(label: string): Promise<void> {
	fireEvent.click(screen.getByRole("combobox"))
	const option = await screen.findByRole("option", { name: label })
	fireEvent.click(option)
}

describe("ReasoningEffortSelector — Default vs None", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Radix's select scrolls the highlighted option into view when the
		// list opens; jsdom does not implement `scrollIntoView`.
		Element.prototype.scrollIntoView = vi.fn()
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {},
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)
	})

	it("displays `Default` when NO effort is persisted", async () => {
		render(<ReasoningEffortSelector currentMode="act" />)

		// The absent state is "no explicit override", which reads as
		// `Default` — NOT as `None`.
		await waitFor(() => {
			expect(screen.getByRole("combobox")).toHaveTextContent("Default")
		})
		expect(screen.getByRole("combobox")).not.toHaveTextContent("None")
	})

	it("displays the persisted effort when one IS persisted", async () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: { actModeReasoningEffort: "low" },
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)

		render(<ReasoningEffortSelector currentMode="act" />)

		await waitFor(() => {
			expect(screen.getByRole("combobox")).toHaveTextContent("Low")
		})
	})

	it("displays an explicitly persisted `None` as `None`", async () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: { actModeReasoningEffort: "none" },
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)

		render(<ReasoningEffortSelector currentMode="act" />)

		await waitFor(() => {
			expect(screen.getByRole("combobox")).toHaveTextContent("None")
		})
	})

	it("offers BOTH `Default` and `None` as distinct selections", async () => {
		render(<ReasoningEffortSelector currentMode="act" />)

		fireEvent.click(screen.getByRole("combobox"))

		// Both labels exist, and they are different options.
		expect(await screen.findByRole("option", { name: "Default" })).toBeTruthy()
		expect(await screen.findByRole("option", { name: "None" })).toBeTruthy()
	})

	it("reports the EXPLICIT `none` selection when the user picks `None`", async () => {
		const onEffortChange = vi.fn()
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={onEffortChange} />)

		await chooseOption("None")

		await waitFor(() => {
			expect(onEffortChange).toHaveBeenCalledWith("none")
		})
	})

	it("reports the `default` selection when the user picks `Default`", async () => {
		const onEffortChange = vi.fn()
		// The select is CONTROLLED: the displayed value is the PERSISTED
		// effort. The persisted state is therefore advanced to `none` before
		// `Default` is picked, which is what the real component sees after
		// the user chose `None`.
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: { actModeReasoningEffort: "none" },
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)
		render(<ReasoningEffortSelector currentMode="act" onEffortChange={onEffortChange} />)

		await waitFor(() => {
			expect(screen.getByRole("combobox")).toHaveTextContent("None")
		})

		await chooseOption("Default")

		await waitFor(() => {
			expect(onEffortChange).toHaveBeenCalledWith("default")
		})
	})
})
