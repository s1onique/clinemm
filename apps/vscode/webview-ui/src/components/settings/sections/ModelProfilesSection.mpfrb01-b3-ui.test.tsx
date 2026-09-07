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
import {
	type BootstrapModelProfileResultLike,
	bootstrapStatusToSeverity,
	ModelProfilesSection,
	parseBootstrapStatus,
} from "./ModelProfilesSection"

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
	// B4: extra props slot for currentConfiguration etc.; merged into overrides
	// so individual tests can specify it without touching the bootstrapResult arg.
	extraOverrides: Partial<React.ComponentProps<typeof ModelProfilesSection>> = {},
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
		...extraOverrides,
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
		// B4: the bootstrap button now lives INSIDE the first-run onboarding
		// pane (profiles.length===0); rendering with profiles:[] ensures the
		// pane is visible. With non-empty profiles the management view hides
		// the onboarding pane (and therefore the button).
		const { onBootstrap } = renderSection({ profiles: [] }, null)
		await userEvent.click(screen.getByTestId("model-profiles-bootstrap"))
		expect(onBootstrap).toHaveBeenCalledTimes(1)
	})

	it("MPFRB01_B3_UI_NO_BANNER: with bootstrapResult=null the banner is NOT rendered (default state)", () => {
		renderSection({}, null)
		expect(screen.queryByTestId("model-profiles-bootstrap-banner")).not.toBeInTheDocument()
	})

	it("MPFRB01_B3_UI_NO_BOOTSTRAP_BUTTON: when onBootstrapFromCurrent is omitted, the button is hidden - section stays additive-only", () => {
		// B4: the button only renders inside the onboarding pane when
		// (a) profiles is empty AND (b) the callback is provided. With
		// profiles non-empty AND no callback, the button is hidden.
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

	it("MPFRB01_B4_UI_NO_BOOTSTRAP_BUTTON_WHEN_EMPTY_AND_OMITTED: empty profiles + omitted callback -> onboarding pane renders, but the button stays hidden (additive-only)", () => {
		// B4: the additive-only contract holds even in the new first-run
		// empty-state surface. When the host doesn't provide the bootstrap
		// callback, the onboarding pane renders the explanation but no
		// primary CTA.
		const props: React.ComponentProps<typeof ModelProfilesSection> = {
			profiles: [],
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
		expect(screen.getByTestId("model-profiles-onboarding")).toBeInTheDocument()
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

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4
	// First-run onboarding pane + single-status-authority decoder.
	// -------------------------------------------------------------------------

	it("MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_KNOWN: parseBootstrapStatus round-trips every known status", () => {
		const known: Array<BootstrapModelProfileResultLike["status"]> = [
			"CREATED",
			"CREATED_BINDING_FAILED",
			"NO_CURRENT_CONFIGURATION",
			"CURRENT_CONFIGURATION_UNSUPPORTED",
			"MISSING_CREDENTIAL",
			"MISSING_MODEL",
			"INSTANCE_WRITE_FAILED",
			"PROFILE_WRITE_FAILED",
		]
		for (const s of known) {
			expect(parseBootstrapStatus(s)).toBe(s)
		}
	})

	it("MPFRB01_B4_UI_PARSE_BOOTSTRAP_STATUS_DRIFT_GUARD: unrecognised status falls through to UNKNOWN (regression guard for backend/proto drift)", () => {
		// Reviewer's bounded P1 (WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED):
		// the decoder is the single load-bearing regression guard against
		// future backend/proto status drift. A new status the webview has
		// not been taught about MUST fall through to "UNKNOWN" rather than
		// silently disappearing (which is what the previous unchecked `as`
		// cast at the container boundary would have allowed).
		expect(parseBootstrapStatus("FUTURE_NEW_STATUS_FROM_BACKEND")).toBe("UNKNOWN")
		expect(parseBootstrapStatus("")).toBe("UNKNOWN")
		expect(parseBootstrapStatus(null)).toBe("UNKNOWN")
		expect(parseBootstrapStatus(undefined)).toBe("UNKNOWN")
		expect(parseBootstrapStatus(42)).toBe("UNKNOWN")
		expect(parseBootstrapStatus({})).toBe("UNKNOWN")
	})

	it("MPFRB01_B4_UI_ONBOARDING_PANE: zero profiles + bootstrap callback -> first-run onboarding pane with CTA", () => {
		// B4 contract: profiles.length===0 + onBootstrapFromCurrent provided
		// -> the onboarding pane renders the explanation copy AND the primary
		// CTA. The CTA copy is product terminology ("Create first profile"),
		// not Factory terminology ("Bootstrap first profile from current ...").
		const { onBootstrap } = renderSection({ profiles: [] }, null)
		const pane = screen.getByTestId("model-profiles-onboarding")
		expect(pane).toBeInTheDocument()
		expect(pane.getAttribute("data-state")).toBe("empty")
		const cta = screen.getByTestId("model-profiles-bootstrap")
		expect(cta).toBeInTheDocument()
		expect(cta.textContent).toMatch(/Create first profile/)
		expect(cta.textContent).not.toMatch(/Bootstrap/)
	})

	it("MPFRB01_B4_UI_ONBOARDING_PANE_WITH_SUMMARY: currentConfiguration prop is rendered as a summary card inside the onboarding pane", () => {
		// B4 contract: the host passes the active provider/model summary so
		// the user sees exactly what they are about to persist as a profile.
		renderSection({ profiles: [] }, null, {
			currentConfiguration: { providerId: "openai-compatible", modelId: "MiniMax-M3" },
		})
		const summary = screen.getByTestId("model-profiles-onboarding-summary")
		expect(summary).toBeInTheDocument()
		expect(summary.textContent).toMatch(/openai-compatible/)
		expect(summary.textContent).toMatch(/MiniMax-M3/)
	})

	it("MPFRB01_B4_UI_ONBOARDING_PANE_UNSUPPORTED: canCreateFromCurrent=false -> inline notice inside onboarding pane", () => {
		renderSection({ profiles: [], canCreateFromCurrent: false }, null)
		const notice = screen.getByTestId("model-profiles-onboarding-unsupported")
		expect(notice).toBeInTheDocument()
		const cta = screen.getByTestId("model-profiles-bootstrap") as HTMLButtonElement
		expect(cta.disabled).toBe(true)
	})

	it("MPFRB01_B4_UI_MANAGEMENT_VIEW_WHEN_HAS_PROFILES: profiles.length>0 -> management view, NOT onboarding pane", () => {
		// B4: distinct views. With at least one profile the section renders
		// the management table, the save-current input, and the default-profile
		// controls; the onboarding pane is hidden.
		renderSection({}, null)
		expect(screen.queryByTestId("model-profiles-onboarding")).not.toBeInTheDocument()
		expect(screen.getByTestId("model-profiles-list")).toBeInTheDocument()
		expect(screen.getByTestId("model-profiles-row-prof-A")).toBeInTheDocument()
	})

	it("MPFRB01_B4_UI_BANNER_STATUS_USES_DECODED: an unrecognised raw status renders as UNKNOWN with error severity (no silent disappearance)", () => {
		// B4 regression guard for backend/proto drift: if a future backend
		// returns a status the webview does not know, the section MUST
		// surface it as a defensive error banner (data-status=UNKNOWN,
		// data-severity=error) rather than letting the banner disappear.
		// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B4 absorbs the
		// reviewer's bounded WEBVIEW_BOOTSTRAP_STATUS_AUTHORITY_DUPLICATED
		// by removing the unchecked `as` cast at the container boundary
		// and routing every raw status through parseBootstrapStatus.
		renderSection({}, { status: "FUTURE_NEW_STATUS_FROM_BACKEND", message: "drift" })
		const banner = screen.getByTestId("model-profiles-bootstrap-banner")
		expect(banner).toBeInTheDocument()
		expect(banner.getAttribute("data-status")).toBe("UNKNOWN")
		expect(banner.getAttribute("data-severity")).toBe("error")
		expect(banner.getAttribute("role")).toBe("alert")
	})
})
