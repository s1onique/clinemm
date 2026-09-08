/**
 * ACT-CLINEMM-MODEL-PROFILES-SECOND-PROFILE-CREATION-CORRECTION01
 *
 * MPSP01 (Model Profile Second-Profile) RED -> GREEN witnesses.
 *
 * Closes the
 * HALT_MODEL_PROFILE_SECOND_INSTANCE_CREATION_ABSENT P0:
 * "Save current configuration as profile" produced nothing visible
 * after the FIRST profile already existed, because the
 * Settings-section container was wired to the
 * `saveCurrentAsModelProfile` RPC, which is the narrow fail-closed
 * primitive that requires an already-bound `providerInstanceId`.
 * After the first profile exists, the current task is normally NOT
 * bound to a profile (the binding is task-scoped and ephemeral),
 * so the old path threw "cannot derive an authoritative
 * providerInstanceId" into console.error with NO visible banner.
 *
 * The bounded correction routes the "Save current configuration as
 * profile" container callback through the SAME canonical creation
 * seam as the first-run CTA: `bootstrapModelProfileFromCurrent
 * Configuration`. The bootstrap RPC reads the CURRENT
 * `ApiConfiguration`, generates a FRESH opaque instanceId, durably
 * persists the instance-scoped secret + instance + profile, and
 * returns a typed envelope that the section's status-aware
 * severity banner renders.
 *
 * Production seams driven:
 *   ModelProfilesSectionContainer  = REAL_PRODUCTION_SEAM
 *   ModelProfilesSection           = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed: StateServiceClient (so the test can
 * observe which RPC was called and inject a typed response), and
 * useExtensionState (so the section sees profiles already
 * present -- the precondition that flips the container from the
 * first-run CTA into the "Save current configuration as profile"
 * affordance, the exact defect geometry).
 */

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import { ModelProfilesSectionContainer } from "./ModelProfilesSectionContainer"

const SEEDED_PROFILES: ModelProfileSummary[] = [
	{
		profileId: "prof-A",
		name: "Default",
		providerId: "openai-compatible",
		modelId: "MiniMax-M3",
		isActive: true,
		isDefault: true,
	},
]

const mockBootstrap = vi.fn()
const mockSaveCurrentAs = vi.fn()

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		bootstrapModelProfileFromCurrentConfiguration: (...args: unknown[]) => mockBootstrap(...args),
		saveCurrentAsModelProfile: (...args: unknown[]) => mockSaveCurrentAs(...args),
		applyModelProfile: vi.fn(async () => ({})),
		setDefaultModelProfile: vi.fn(async () => ({})),
		clearDefaultModelProfile: vi.fn(async () => ({})),
		renameModelProfile: vi.fn(async () => ({})),
		updateModelProfileFromCurrent: vi.fn(async () => ({})),
		deleteModelProfile: vi.fn(async () => ({ deleted: true })),
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		modelProfiles: SEEDED_PROFILES,
		activeModelProfileId: "prof-A",
		defaultModelProfileId: "prof-A",
		apiConfiguration: {
			actModeApiProvider: "openai",
			actModeApiModelId: "model-MM3Subs",
		},
	}),
}))

function renderContainer() {
	return render(<ModelProfilesSectionContainer canApplyLive canCreateFromCurrent />)
}

describe("ACT-CLINEMM-MODEL-PROFILES-SECOND-PROFILE-CREATION-CORRECTION01 / MPSP01", () => {
	beforeEach(() => {
		mockBootstrap.mockReset()
		mockSaveCurrentAs.mockReset()
	})

	it("MPSP01_RED_S1_ROUTES_THROUGH_BOOTSTRAP: when at least one profile exists, 'Save current configuration as profile' calls bootstrapModelProfileFromCurrentConfiguration (NOT saveCurrentAsModelProfile)", async () => {
		mockBootstrap.mockResolvedValue({
			status: "CREATED",
			profileId: "prof-MM3Subs",
			instanceId: "inst-MM3Subs",
			message: "",
		})
		mockSaveCurrentAs.mockResolvedValue({})

		renderContainer()

		const input = screen.getByTestId("model-profiles-new-name") as HTMLInputElement
		const saveBtn = screen.getByTestId("model-profiles-save-current")

		await userEvent.type(input, "MM3Subs")
		await userEvent.click(saveBtn)

		await waitFor(() => {
			expect(mockBootstrap).toHaveBeenCalledTimes(1)
		})
		expect(mockSaveCurrentAs).not.toHaveBeenCalled()

		const firstCallArg = mockBootstrap.mock.calls[0]?.[0]
		expect(firstCallArg).toBeDefined()
		const nameValue = (firstCallArg as { name?: string }).name
		expect(nameValue).toBe("MM3Subs")
	})

	it("MPSP01_RED_S4_SUCCESS_BANNER: a CREATED envelope reaches the DOM as a visible success banner with profileId + instanceId", async () => {
		mockBootstrap.mockResolvedValue({
			status: "CREATED",
			profileId: "prof-MM3Subs",
			instanceId: "inst-MM3Subs",
			message: "",
		})
		mockSaveCurrentAs.mockResolvedValue({})

		renderContainer()

		await userEvent.type(screen.getByTestId("model-profiles-new-name"), "MM3Subs")
		await userEvent.click(screen.getByTestId("model-profiles-save-current"))

		const banner = await screen.findByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-severity")).toBe("success")
		expect(banner.getAttribute("data-status")).toBe("CREATED")
		expect(banner.getAttribute("role")).toBe("status")
		// The CORRECTION06 plumbing already wires profileId +
		// instanceId into the banner; this witness pins that the
		// Save path (not just the first-run CTA path) preserves
		// those identifiers end-to-end.
		expect(banner.textContent).toContain("prof-MM3Subs")
		expect(banner.textContent).toContain("inst-MM3Subs")
	})

	it("MPSP01_RED_S5_VISIBLE_FAILURE: a typed-error envelope reaches the DOM as a role=alert banner with the actionable message (no console.error-only swallow)", async () => {
		// Bootstrap primitive returns a typed MISSING_CREDENTIAL
		// envelope when the current ApiConfiguration has no API
		// key. The B3-UI plumbing already routes this to a
		// role="alert" error banner. The previous Save path did
		// not have access to this plumbing -- it threw an
		// untranslated Error and swallowed the result into
		// console.error. This witness proves the Save path NOW
		// surfaces typed failures visibly.
		mockBootstrap.mockResolvedValue({
			status: "MISSING_CREDENTIAL",
			profileId: "",
			instanceId: "",
			message: "No API key configured for openai. Set one in API Configuration.",
		})
		mockSaveCurrentAs.mockResolvedValue({})

		renderContainer()

		await userEvent.type(screen.getByTestId("model-profiles-new-name"), "MM3Subs")
		await userEvent.click(screen.getByTestId("model-profiles-save-current"))

		const banner = await screen.findByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-severity")).toBe("error")
		expect(banner.getAttribute("data-status")).toBe("MISSING_CREDENTIAL")
		expect(banner.getAttribute("role")).toBe("alert")
		expect(banner.textContent).toContain("No API key configured for openai")
	})
})
