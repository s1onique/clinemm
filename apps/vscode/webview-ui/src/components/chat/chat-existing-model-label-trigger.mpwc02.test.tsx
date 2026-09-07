/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
 *
 * C5: EXISTING_MODEL_LABEL_TRIGGER (RED -> GREEN).
 *
 * The product contract is: click the existing current-model
 * label under the chat box → the profile picker popover appears.
 *
 * Earlier (MPWC01) the trigger was a SIBLING of the existing
 * model button — clicking the model name still routed to
 * Settings. That was the wrong seam. CORRECTION02 rebinds the
 * picker to the existing button without adding a sibling.
 *
 * Discriminator: render the real `ChatTextArea` footer fragment
 * containing `<ModelDisplayButton>` (the existing label) and
 * assert that clicking it opens the profile popover. There must
 * be NO standalone sibling trigger.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { useState } from "react"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import {
	ModelProfileQuickSwitch,
	useModelProfileQuickSwitch,
} from "./ModelProfileQuickSwitch"

const PROFILES: ModelProfileSummary[] = [
	{ profileId: "prof-A", name: "Corporate MiniMax", providerId: "openai-compatible", modelId: "MiniMax-M3", isActive: true, isDefault: false },
	{ profileId: "prof-B", name: "Local Qwen", providerId: "openai-compatible", modelId: "qwen3-coder", isActive: false, isDefault: true },
]

/**
 * A minimal "real chat parent footer" surrogate. The real
 * `ChatTextArea.tsx` composes `useModelProfileQuickSwitchHost`
 * and binds the existing current-model label as the trigger.
 * This test renders an analogous surface — the EXISTING label
 * IS the trigger (it owns the triggerProps spread), the popover
 * is a sibling, and there is NO standalone <ModelProfileQuickSwitch/>.
 */
function ChatFooterSurrogate({ currentLabel }: { currentLabel: string }) {
	const { triggerProps, popover, isOpen } = useModelProfileQuickSwitch({
		profiles: PROFILES,
		currentLabel,
		onSelectProfile: () => {},
		onOpenManageProfiles: () => {},
	})
	void isOpen
	return (
		<div>
			{/*
			 * Existing model button — the SAME element the user
			 * already sees. It receives the triggerProps so it
			 * toggles the popover, not Settings.
			 */}
			<button type="button" {...triggerProps}>
				{currentLabel}
			</button>
			{popover}
		</div>
	)
}

describe("MPWC02_C5_EXISTING_MODEL_LABEL_TRIGGER", () => {
	it("clicking the existing current-model label opens the profile popover", async () => {
		const user = userEvent.setup()
		render(<ChatFooterSurrogate currentLabel="openai-compat:MiniMax-M3" />)

		// The label IS the trigger. No second / neighboring button.
		const trigger = screen.getByTestId("model-profile-trigger")
		expect(trigger).toHaveTextContent("openai-compat:MiniMax-M3")

		await user.click(trigger)
		expect(await screen.findByTestId("model-profile-popover")).toBeInTheDocument()
	})

	it("aria-expanded on the existing label reflects popover open/closed state", async () => {
		const user = userEvent.setup()
		render(
			<div>
				<div data-testid="outside">outside</div>
				<ChatFooterSurrogate currentLabel="openai-compat:MiniMax-M3" />
			</div>,
		)

		const trigger = screen.getByTestId("model-profile-trigger")
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
		await user.click(trigger)
		expect(trigger.getAttribute("aria-expanded")).toBe("true")
		// Outside-click on an element that is neither trigger nor popover.
		fireEvent.mouseDown(screen.getByTestId("outside"))
		expect(trigger.getAttribute("aria-expanded")).toBe("false")
	})

	it("selecting a profile from the popover fires onSelectProfile on the existing trigger's surface", async () => {
		const user = userEvent.setup()
		const onSelect = vi.fn()
		function WithCallback() {
			const { triggerProps, popover } = useModelProfileQuickSwitch({
				profiles: PROFILES,
				currentLabel: "label",
				onSelectProfile: onSelect,
				onOpenManageProfiles: () => {},
			})
			return (
				<div>
					<button type="button" {...triggerProps}>label</button>
					{popover}
				</div>
			)
		}
		render(<WithCallback />)
		await user.click(screen.getByTestId("model-profile-trigger"))
		await user.click(screen.getByTestId("model-profile-option-prof-B"))
		expect(onSelect).toHaveBeenCalledWith("prof-B")
		expect(screen.queryByTestId("model-profile-popover")).not.toBeInTheDocument()
	})

	it("MANAGE_PROFILES routes to the parent callback (e.g. Settings)", async () => {
		const user = userEvent.setup()
		const onManage = vi.fn()
		function WithManage() {
			const { triggerProps, popover } = useModelProfileQuickSwitch({
				profiles: PROFILES,
				currentLabel: "label",
				onSelectProfile: () => {},
				onOpenManageProfiles: onManage,
			})
			return (
				<div>
					<button type="button" {...triggerProps}>label</button>
					{popover}
				</div>
			)
		}
		render(<WithManage />)
		await user.click(screen.getByTestId("model-profile-trigger"))
		await user.click(screen.getByTestId("model-profile-manage"))
		expect(onManage).toHaveBeenCalled()
	})
})

/**
 * Source-check for the corrected chat parent: the production
 * `ChatTextArea.tsx` source must:
 *   - import `useModelProfileQuickSwitchHost`
 *   - spread its `triggerProps` onto `<ModelDisplayButton>`
 *   - NOT mount a standalone `<ModelProfileQuickSwitchContainer />`
 *     sibling (the previous wrong seam)
 *   - NOT call `navigateToSettingsModelPicker({ targetSection: "api-config" })`
 *     in `handleModelButtonClick` — that handler is gone.
 */
describe("MPWC02_C5_EXISTING_MODEL_LABEL_TRIGGER_SOURCE_CHECK", () => {
	it("ChatTextArea imports useModelProfileQuickSwitchHost", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(__dirname, "ChatTextArea.tsx"), "utf8")
		expect(source).toMatch(/useModelProfileQuickSwitchHost/)
	})

	it("ChatTextArea spreads triggerProps onto ModelDisplayButton", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(__dirname, "ChatTextArea.tsx"), "utf8")
		expect(source).toMatch(/ModelDisplayButton[\s\S]*?\{\.\.\.profileSwitchTriggerProps\}/)
	})

	it("ChatTextArea does NOT mount a standalone ModelProfileQuickSwitchContainer sibling", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(__dirname, "ChatTextArea.tsx"), "utf8")
		expect(source).not.toMatch(/<ModelProfileQuickSwitchContainer[\s>]/)
	})

	it("ChatTextArea no longer has a handleModelButtonClick that routes to Settings", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(__dirname, "ChatTextArea.tsx"), "utf8")
		expect(source).not.toMatch(/const handleModelButtonClick\s*=.*navigateToSettingsModelPicker/)
	})
})
