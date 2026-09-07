/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04
 *
 * B3-UI RED -> GREEN witness (HALT_B3_USER_VISIBILITY_NOT_PROVEN absorb).
 *
 * The CORRECTION03 vitest file
 * (apps/vscode/src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts)
 * proves that the typed RPC envelope is preserved through the
 * controller-handler boundary. This webview file proves the FINAL
 * leg: the typed envelope reaches the React state of the settings
 * section and renders a visible, actionable, status-aware severity
 * banner instead of the previous console.error-only swallow that
 * left bootstrap failures invisible to the user.
 *
 * Production seams driven:
 *   - ModelProfilesSection = REAL_PRODUCTION_SEAM
 *   - bootstrapStatusToSeverity = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed: onSaveCurrentAsProfile, onUse,
 * onSetAsDefault, onClearDefault, onRename, onUpdateFromCurrent,
 * onDelete, onBootstrapFromCurrent. The typed envelope is fed in
 * via the new `bootstrapResult` prop so the test exercises the
 * "RPC response -> banner" pipeline without mocking the gRPC
 * client (which is correctly tested by the controller-handler
 * vitest file on the other side of the seam).
 */

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { ModelProfileSummary } from "@/services/model-profile-types"
import { type BootstrapModelProfileResultLike, bootstrapStatusToSeverity, ModelProfilesSection } from "./ModelProfilesSection"

const PROFILES: ModelProfileSummary[] = [
	{
		profileId: "prof-A",
		name: "Corporate MiniMax",
		providerId: "openai-compatible",
		modelId: "MiniMax-M3",
		isActive: true,
		isDefault: false,
	},
]

function renderSection(
	overrides: Partial<React.ComponentProps<typeof ModelProfilesSection>> = {},
	bootstrapResult: BootstrapModelProfileResultLike | null = null,
) {
	const onSave = vi.fn()
	const onUse = vi.fn()
	const onSetAsDefault = vi.fn()
	const onClearDefault = vi.fn()
	const onRename = vi.fn()
	const onUpdate = vi.fn()
	const onDelete = vi.fn()
	const onBootstrap = vi.fn()
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
		onBootstrapFromCurrent: onBootstrap,
		bootstrapResult,
		...overrides,
	}
	const result = render(<ModelProfilesSection {...props} />)
	return {
		...result,
		onSave,
		onUse,
		onSetAsDefault,
		onClearDefault,
		onRename,
		onUpdate,
		onDelete,
		onBootstrap,
	}
}

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION04 / B3-UI", () => {
	it("MPFRB01_B3_UI_SEVERITY: CREATED -> success; CREATED_BINDING_FAILED -> warning; the typed-envelope errors -> error", () => {
		expect(bootstrapStatusToSeverity("CREATED")).toBe("success")
		expect(bootstrapStatusToSeverity("CREATED_BINDING_FAILED")).toBe("warning")
		expect(bootstrapStatusToSeverity("NO_CURRENT_CONFIGURATION")).toBe("error")
		expect(bootstrapStatusToSeverity("CURRENT_CONFIGURATION_UNSUPPORTED")).toBe("error")
		expect(bootstrapStatusToSeverity("MISSING_CREDENTIAL")).toBe("error")
		expect(bootstrapStatusToSeverity("MISSING_MODEL")).toBe("error")
		expect(bootstrapStatusToSeverity("INSTANCE_WRITE_FAILED")).toBe("error")
		expect(bootstrapStatusToSeverity("PROFILE_WRITE_FAILED")).toBe("error")
	})

	it("MPFRB01_B3_UI_MISSING_CREDENTIAL: typed MISSING_CREDENTIAL reaches the DOM as a visible error banner with actionable text", () => {
		renderSection(
			{},
			{
				status: "MISSING_CREDENTIAL",
				message: "No API key configured for anthropic. Set one in API Configuration.",
			},
		)

		const banner = screen.getByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-severity")).toBe("error")
		expect(banner.getAttribute("data-status")).toBe("MISSING_CREDENTIAL")
		expect(banner.getAttribute("role")).toBe("alert")
		expect(screen.getByTestId("model-profiles-bootstrap-message").textContent).toMatch(/No API key configured/i)
		expect(screen.getByText(/Could not create a profile from the current configuration\./)).toBeInTheDocument()
	})

	it("MPFRB01_B3_UI_CURRENT_CONFIGURATION_UNSUPPORTED: typed CURRENT_CONFIGURATION_UNSUPPORTED reaches the DOM as a visible error banner", () => {
		renderSection(
			{},
			{
				status: "CURRENT_CONFIGURATION_UNSUPPORTED",
				message: "Provider 'claude_code' is not supported by Model Profile bootstrap (BOOTSTRAP_COVERAGE).",
			},
		)

		const banner = screen.getByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-severity")).toBe("error")
		expect(banner.getAttribute("data-status")).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
		expect(banner.getAttribute("role")).toBe("alert")
		expect(screen.getByTestId("model-profiles-bootstrap-message").textContent).toMatch(
			/not supported by Model Profile bootstrap/i,
		)
	})

	it("MPFRB01_B3_UI_CREATED_BINDING_FAILED: typed CREATED_BINDING_FAILED reaches the DOM as a visible warning, NOT as a total failure", () => {
		renderSection(
			{},
			{
				status: "CREATED_BINDING_FAILED",
				profileId: "prof-abc123",
				instanceId: "inst-xyz789",
				message: "Profile written, but binding to the active task did not complete (no current task).",
			},
		)

		const banner = screen.getByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-severity")).toBe("warning")
		expect(banner.getAttribute("data-status")).toBe("CREATED_BINDING_FAILED")
		expect(banner.getAttribute("role")).toBe("status")
		expect(screen.getByText(/Profile created, but binding to the current task did not complete\./)).toBeInTheDocument()
		expect(screen.getByText(/prof-abc123/)).toBeInTheDocument()
		expect(screen.getByText(/inst-xyz789/)).toBeInTheDocument()
	})

	it("MPFRB01_B3_UI_CREATED: typed CREATED reaches the DOM as a success banner and a re-render clears any prior error state", () => {
		const onBootstrap = vi.fn()
		const onSave = vi.fn()
		const onUse = vi.fn()
		const onSetAsDefault = vi.fn()
		const onClearDefault = vi.fn()
		const onRename = vi.fn()
		const onUpdate = vi.fn()
		const onDelete = vi.fn()

		const { rerender } = render(
			<ModelProfilesSection
				bootstrapResult={{ status: "MISSING_CREDENTIAL", message: "Earlier failure (placeholder before retry)." }}
				canApplyLive
				canCreateFromCurrent
				onBootstrapFromCurrent={onBootstrap}
				onClearDefault={onClearDefault}
				onDelete={onDelete}
				onRename={onRename}
				onSaveCurrentAsProfile={onSave}
				onSetAsDefault={onSetAsDefault}
				onUpdateFromCurrent={onUpdate}
				onUse={onUse}
				profiles={PROFILES}
			/>,
		)
		expect(screen.getByTestId("model-profiles-bootstrap-banner").getAttribute("data-severity")).toBe("error")

		rerender(
			<ModelProfilesSection
				bootstrapResult={{
					status: "CREATED",
					profileId: "prof-new1",
					instanceId: "inst-new1",
				}}
				canApplyLive
				canCreateFromCurrent
				onBootstrapFromCurrent={onBootstrap}
				onClearDefault={onClearDefault}
				onDelete={onDelete}
				onRename={onRename}
				onSaveCurrentAsProfile={onSave}
				onSetAsDefault={onSetAsDefault}
				onUpdateFromCurrent={onUpdate}
				onUse={onUse}
				profiles={PROFILES}
			/>,
		)

		const banner = screen.getByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-severity")).toBe("success")
		expect(banner.getAttribute("data-status")).toBe("CREATED")
		expect(banner.getAttribute("role")).toBe("status")
		expect(screen.getByText(/Profile created\./)).toBeInTheDocument()
		expect(screen.getByText(/prof-new1/)).toBeInTheDocument()
		expect(screen.getByText(/inst-new1/)).toBeInTheDocument()
	})

	it("MPFRB01_B3_UI_BOOTSTRAP_BUTTON: clicking the bootstrap button invokes onBootstrapFromCurrent", async () => {
		const { onBootstrap } = renderSection({}, null)
		await userEvent.click(screen.getByTestId("model-profiles-bootstrap"))
		expect(onBootstrap).toHaveBeenCalledTimes(1)
	})

	it("MPFRB01_B3_UI_NO_BANNER: with bootstrapResult=null the banner is NOT rendered (default state)", () => {
		renderSection({}, null)
		expect(screen.queryByTestId("model-profiles-bootstrap-banner")).not.toBeInTheDocument()
	})

	it("MPFRB01_B3_UI_NO_BOOTSTRAP_BUTTON: when onBootstrapFromCurrent is omitted, the button is hidden - section stays additive-only", () => {
		const props: React.ComponentProps<typeof ModelProfilesSection> = {
			profiles: PROFILES,
			canCreateFromCurrent: true,
			canApplyLive: true,
			onSaveCurrentAsProfile: vi.fn(),
			onUse: vi.fn(),
			onSetAsDefault: vi.fn(),
			onClearDefault: vi.fn(),
			onRename: vi.fn(),
			onUpdateFromCurrent: vi.fn(),
			onDelete: vi.fn(),
			// intentionally no onBootstrapFromCurrent
		}
		render(<ModelProfilesSection {...props} />)
		expect(screen.queryByTestId("model-profiles-bootstrap")).not.toBeInTheDocument()
	})

	it("MPFRB01_B3_UI_ALL_STATUSES_VISIBLE: every BootstrapModelProfileStatus renders a visible banner (no console.error-only swallow)", () => {
		const statuses: Array<BootstrapModelProfileResultLike["status"]> = [
			"CREATED",
			"CREATED_BINDING_FAILED",
			"NO_CURRENT_CONFIGURATION",
			"CURRENT_CONFIGURATION_UNSUPPORTED",
			"MISSING_CREDENTIAL",
			"MISSING_MODEL",
			"INSTANCE_WRITE_FAILED",
			"PROFILE_WRITE_FAILED",
		]
		for (const status of statuses) {
			const { unmount } = renderSection({}, { status, message: `status: ${status}` })
			const banner = screen.getByTestId("model-profiles-bootstrap-banner")
			expect(banner).toBeInTheDocument()
			expect(banner.getAttribute("data-status")).toBe(status)
			const severity = banner.getAttribute("data-severity")
			expect(severity).toBeTruthy()
			expect(["success", "warning", "error"]).toContain(severity)
			unmount()
		}
	})
})
