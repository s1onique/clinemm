/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase F
 *
 * RED -> GREEN witness for Settings management surface (P16, P17).
 *
 * Production seams driven:
 *   ModelProfilesSection component = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed: onSaveCurrent/onUse/onSetAsDefault/etc.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import { ModelProfilesSection } from "./ModelProfilesSection"

const PROFILES: ModelProfileSummary[] = [
	{
		profileId: "prof-A",
		name: "Corporate MiniMax",
		providerId: "openai-compatible",
		modelId: "MiniMax-M3",
		isActive: true,
		isDefault: false,
	},
	{
		profileId: "prof-B",
		name: "Local Qwen",
		providerId: "openai-compatible",
		modelId: "qwen3-coder",
		isActive: false,
		isDefault: true,
	},
]

function renderSection(overrides: Partial<React.ComponentProps<typeof ModelProfilesSection>> = {}) {
	const onSave = vi.fn()
	const onUse = vi.fn()
	const onSetAsDefault = vi.fn()
	const onClearDefault = vi.fn()
	const onRename = vi.fn()
	const onUpdate = vi.fn()
	const onDelete = vi.fn()
	const props: React.ComponentProps<typeof ModelProfilesSection> = {
		profiles: PROFILES,
		canCreateFromCurrent: true,
		canApplyLive: true,
		onSaveCurrentAsProfile: onSave,
		onUse,
		onSetAsDefault,
		onClearDefault,
		onRename,
		onUpdateFromCurrent: onUpdate,
		onDelete,
		...overrides,
	}
	const result = render(<ModelProfilesSection {...props} />)
	return { ...result, onSave, onUse, onSetAsDefault, onClearDefault, onRename, onUpdate, onDelete }
}

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase F", () => {
	it("MPQS01_SECT_RENDERS_ROWS: list contains one row per profile", () => {
		renderSection()
		expect(screen.getByTestId("model-profiles-row-prof-A")).toBeInTheDocument()
		expect(screen.getByTestId("model-profiles-row-prof-B")).toBeInTheDocument()
	})

	it("MPQS01_SECT_DEFAULT_BADGE: default profile shows Default badge", () => {
		renderSection()
		expect(screen.getByText("Default")).toBeInTheDocument()
	})

	it("MPQS01_SECT_SAVE_CURRENT: typing a name and clicking save calls onSaveCurrentAsProfile", async () => {
		const { onSave } = renderSection()
		await userEvent.type(screen.getByTestId("model-profiles-new-name"), "Local LiteLLM")
		await userEvent.click(screen.getByTestId("model-profiles-save-current"))
		expect(onSave).toHaveBeenCalledWith("Local LiteLLM")
	})

	it("MPQS01_SECT_USE_BUTTON: Use button calls onUse(profileId)", async () => {
		const { onUse } = renderSection()
		await userEvent.click(screen.getByTestId("model-profiles-use-prof-B"))
		expect(onUse).toHaveBeenCalledWith("prof-B")
	})

	it("MPQS01_SECT_USE_DISABLED_FOR_ACTIVE: Use button is disabled for the active profile", () => {
		renderSection()
		const useA = screen.getByTestId("model-profiles-use-prof-A") as HTMLButtonElement
		expect(useA.disabled).toBe(true)
	})

	it("MPQS01_SECT_USE_DISABLED_WHEN_BUSY: Use buttons disabled when canApplyLive=false", () => {
		renderSection({ canApplyLive: false })
		const useB = screen.getByTestId("model-profiles-use-prof-B") as HTMLButtonElement
		expect(useB.disabled).toBe(true)
	})

	it("MPQS01_SECT_SET_AS_DEFAULT: Set as default button calls onSetAsDefault", async () => {
		const { onSetAsDefault } = renderSection()
		await userEvent.click(screen.getByTestId("model-profiles-set-default-prof-A"))
		expect(onSetAsDefault).toHaveBeenCalledWith("prof-A")
	})

	it("MPQS01_SECT_NO_DEFAULT_BUTTON_FOR_DEFAULT: default profile does NOT show Set as default", () => {
		renderSection()
		expect(screen.queryByTestId("model-profiles-set-default-prof-B")).not.toBeInTheDocument()
	})

	it("MPQS01_SECT_CLEAR_DEFAULT: clear default calls onClearDefault", async () => {
		const { onClearDefault } = renderSection()
		await userEvent.click(screen.getByTestId("model-profiles-clear-default"))
		expect(onClearDefault).toHaveBeenCalled()
	})

	it("MPQS01_SECT_RENAME: Rename + Enter commits via onRename", async () => {
		const { onRename } = renderSection()
		await userEvent.click(screen.getByTestId("model-profiles-rename-prof-A"))
		const input = screen.getByTestId("model-profiles-rename-input-prof-A")
		fireEvent.change(input, { target: { value: "Renamed A" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(onRename).toHaveBeenCalledWith("prof-A", "Renamed A")
	})

	it("MPQS01_SECT_UPDATE_FROM_CURRENT: Update from current calls onUpdateFromCurrent", async () => {
		const { onUpdate } = renderSection()
		await userEvent.click(screen.getByTestId("model-profiles-update-prof-B"))
		expect(onUpdate).toHaveBeenCalledWith("prof-B")
	})

	it("MPQS01_SECT_DELETE_DISABLED_FOR_ACTIVE: Delete button disabled for active profile", () => {
		renderSection()
		const delA = screen.getByTestId("model-profiles-delete-prof-A") as HTMLButtonElement
		expect(delA.disabled).toBe(true)
	})

	it("MPQS01_SECT_DELETE_DISABLED_FOR_DEFAULT: Delete button disabled for the default profile (even when not active)", () => {
		// prof-B is the default profile (isDefault=true, isActive=false).
		// Per the ACT contract, the default profile is non-deletable
		// even when it's not the active one — deleting it would break
		// the global default pointer.
		renderSection()
		const delB = screen.getByTestId("model-profiles-delete-prof-B") as HTMLButtonElement
		expect(delB.disabled).toBe(true)
	})

	it("MPQS01_SECT_DELETE_OK_FOR_INACTIVE_NON_DEFAULT: Delete enabled for inactive + non-default profiles", async () => {
		// Construct a third profile that is neither active nor default
		// and assert delete is enabled.
		const profiles = [
			...PROFILES,
			{
				profileId: "prof-C",
				name: "Personal",
				providerId: "openai-compatible",
				modelId: "gpt-4o",
				isActive: false,
				isDefault: false,
			},
		]
		const { onDelete } = renderSection({ profiles })
		const delC = screen.getByTestId("model-profiles-delete-prof-C") as HTMLButtonElement
		expect(delC.disabled).toBe(false)
		await userEvent.click(delC)
		expect(onDelete).toHaveBeenCalledWith("prof-C")
	})

	it("MPQS01_SECT_UNSUPPORTED_CONFIG_NOTICE: canCreateFromCurrent=false shows the unsupported notice", () => {
		renderSection({ canCreateFromCurrent: false })
		expect(screen.getByText(/not supported by Model Profiles V1/)).toBeInTheDocument()
	})

	it("MPQS01_SECT_EMPTY_LIST: zero profiles -> onboarding pane renders the explanation", () => {
		// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4:
		// the inert "No profiles yet" placeholder is replaced by a
		// dedicated first-run onboarding pane. The pane renders the
		// explanation copy so the user understands what a Model
		// Profile is. The CTA itself depends on the host providing
		// `onBootstrapFromCurrent`; this test omits the callback
		// to assert the additive-only contract.
		renderSection({ profiles: [] })
		expect(screen.getByTestId("model-profiles-onboarding")).toBeInTheDocument()
		expect(screen.getByText(/Save your current setup as a reusable profile/)).toBeInTheDocument()
	})
})
