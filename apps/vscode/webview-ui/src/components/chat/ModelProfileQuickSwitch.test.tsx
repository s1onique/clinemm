/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase E
 *
 * RED -> GREEN witness for MP-R11, MP-R12, P5-P8, P15-P18 quick-switch UX.
 *
 * Production seams driven:
 *   ModelProfileQuickSwitch component = REAL_PRODUCTION_SEAM
 */

import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import { ModelProfileQuickSwitch } from "./ModelProfileQuickSwitch"

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

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase E", () => {
	it("MPQS01_QS_TRIGGER_RENDERS_LABEL: trigger button shows the current label", () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="openai-compat:MiniMax-M3"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		expect(screen.getByTestId("model-profile-trigger")).toHaveTextContent("openai-compat:MiniMax-M3")
	})

	it("MPQS01_QS_CLICK_OPENS_POPOVER: clicking trigger opens the popover", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		expect(screen.getByTestId("model-profile-popover")).toBeInTheDocument()
	})

	it("MPQS01_QS_POPOVER_LISTS_PROFILES: popover contains one row per profile", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		expect(screen.getByTestId("model-profile-option-prof-A")).toBeInTheDocument()
		expect(screen.getByTestId("model-profile-option-prof-B")).toBeInTheDocument()
	})

	it("MPQS01_QS_CURRENT_MARKER: current profile shows checkmark (aria-selected=true)", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		const active = screen.getByTestId("model-profile-option-prof-A")
		expect(active.getAttribute("aria-selected")).toBe("true")
	})

	it("MPQS01_QS_SELECT_PROF_B_CALLS_CALLBACK: clicking option prof-B fires onSelectProfile('prof-B')", async () => {
		const onSelect = vi.fn()
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={onSelect}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		await userEvent.click(screen.getByTestId("model-profile-option-prof-B"))
		expect(onSelect).toHaveBeenCalledWith("prof-B")
	})

	it("MPQS01_QS_POPOVER_CLOSES_AFTER_SELECT: clicking an option closes the popover", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		await userEvent.click(screen.getByTestId("model-profile-option-prof-B"))
		expect(screen.queryByTestId("model-profile-popover")).not.toBeInTheDocument()
	})

	it("MPQS01_QS_ESCAPE_CLOSES: pressing Escape closes the popover", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		fireEvent.keyDown(screen.getByTestId("model-profile-popover"), { key: "Escape" })
		expect(screen.queryByTestId("model-profile-popover")).not.toBeInTheDocument()
	})

	it("MPQS01_QS_ARROW_NAVIGATES: initial focus=active, ArrowDown moves to next, Enter selects that profile", async () => {
		const onSelect = vi.fn()
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={onSelect}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))

		// Initial focus is on the active profile (prof-A in this fixture).
		const popover = screen.getByTestId("model-profile-popover")
		const initialFocused = popover.querySelector('[data-focused="true"]')
		expect(initialFocused?.getAttribute("data-testid")).toBe("model-profile-option-prof-A")

		// ArrowDown moves focus to the next option (prof-B).
		fireEvent.keyDown(popover, { key: "ArrowDown" })
		const afterArrow = popover.querySelector('[data-focused="true"]')
		expect(afterArrow?.getAttribute("data-testid")).toBe("model-profile-option-prof-B")

		// Enter selects the focused option — onSelect is called with the
		// specific profile id, NOT a no-op.
		fireEvent.keyDown(popover, { key: "Enter" })
		expect(onSelect).toHaveBeenCalledWith("prof-B")
		expect(screen.queryByTestId("model-profile-popover")).not.toBeInTheDocument()
	})

	it("MPQS01_QS_MANAGE_PROFILES: 'Manage Profiles...' footer calls onOpenManageProfiles", async () => {
		const onManage = vi.fn()
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={onManage}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		await userEvent.click(screen.getByTestId("model-profile-manage"))
		expect(onManage).toHaveBeenCalled()
	})

	it("MPQS01_QS_DISABLED_WHEN_BUSY: disabled prop disables the trigger", () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				disabled={true}
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		const trigger = screen.getByTestId("model-profile-trigger") as HTMLButtonElement
		expect(trigger.disabled).toBe(true)
		expect(trigger.title).toMatch(/Available when the current request finishes/)
	})

	it("MPQS01_QS_EMPTY_STATE: zero profiles -> empty-state message inside popover", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={[]}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		expect(screen.getByTestId("model-profile-empty")).toBeInTheDocument()
	})

	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4-B:
	// The picker empty state must NOT be a dead-end. It must
	// surface a CTA that routes the user to Settings onboarding.
	it("MPFRB01_B4_QS_EMPTY_STATE_CTA: zero profiles -> empty-state CTA routes to Settings onboarding (onOpenManageProfiles)", async () => {
		const onOpenManageProfiles = vi.fn()
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={onOpenManageProfiles}
				onSelectProfile={() => {}}
				profiles={[]}
			/>,
		)
		await userEvent.click(screen.getByTestId("model-profile-trigger"))
		const cta = screen.getByTestId("model-profile-empty-create")
		expect(cta).toBeInTheDocument()
		// Copy is product terminology, not Factory terminology.
		expect(cta.textContent).toMatch(/Create first profile/)
		expect(cta.textContent).not.toMatch(/Bootstrap/)
		await userEvent.click(cta)
		expect(onOpenManageProfiles).toHaveBeenCalledTimes(1)
	})

	it("MPQS01_QS_ARIA_ROLES: trigger aria-haspopup=listbox; popover role=listbox", async () => {
		render(
			<ModelProfileQuickSwitch
				currentLabel="label"
				onOpenManageProfiles={() => {}}
				onSelectProfile={() => {}}
				profiles={PROFILES}
			/>,
		)
		const trigger = screen.getByTestId("model-profile-trigger")
		expect(trigger.getAttribute("aria-haspopup")).toBe("listbox")
		await userEvent.click(trigger)
		expect(screen.getByTestId("model-profile-popover").getAttribute("role")).toBe("listbox")
	})
})
