/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01
 *
 * UI tests for the TemporaryExternalPathsSection. Green-disk evidence
 * for the Settings UI surface: the section renders the persisted list,
 * exposes add/remove/preset affordances, and writes through the
 * canonical `updateSetting` helper.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TemporaryExternalPathAuthority } from "@cline/core"
import TemporaryExternalPathsSection from "./TemporaryExternalPathsSection"

const mockUpdateSetting = vi.fn()
const mockExtensionState = vi.hoisted(() => ({
	value: {
		clinemmTemporaryExternalPathAuthorities:
			[] as TemporaryExternalPathAuthority[],
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => mockExtensionState.value),
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({
		children,
		onClick,
		disabled,
	}: {
		children: React.ReactNode
		onClick?: () => void
		disabled?: boolean
	}) => (
		<button disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
	VSCodeTextField: ({
		value,
		onInput,
		placeholder,
	}: {
		value?: string
		onInput?: (e: { target: HTMLInputElement }) => void
		placeholder?: string
	}) => (
		<input
			onChange={(e) => onInput?.({ target: e.target })}
			placeholder={placeholder}
			value={value}
		/>
	),
}))

describe("ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01 — TemporaryExternalPathsSection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockExtensionState.value.clinemmTemporaryExternalPathAuthorities = []
	})

	it("renders the section header and the empty-state message", () => {
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		expect(screen.getByText(/Temporary External Paths/i)).toBeTruthy()
		expect(screen.getByText(/No temporary paths configured\./i)).toBeTruthy()
	})

	it("adding a path with 4h duration persists expiresAt ≈ now + 4h", () => {
		const before = Date.now()
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		const input = screen.getByTestId("temp-external-path-input") as HTMLInputElement
		fireEvent.change(input, { target: { value: "/private/tmp" } })
		// Click the 4h radio then the Add button.
		fireEvent.click(screen.getByTestId("temp-external-duration-4h"))
		fireEvent.click(screen.getByTestId("temp-external-add"))
		expect(mockUpdateSetting).toHaveBeenCalledTimes(1)
		const [key, payload] = mockUpdateSetting.mock.calls[0] as [string, string]
		expect(key).toBe("clinemmTemporaryExternalPathAuthorities")
		const parsed = JSON.parse(payload) as TemporaryExternalPathAuthority[]
		expect(parsed).toHaveLength(1)
		expect(parsed[0]!.path).toBe("/private/tmp")
		const expiryMs = Date.parse(parsed[0]!.expiresAt)
		expect(expiryMs).toBeGreaterThanOrEqual(before + 4 * 60 * 60 * 1000 - 1000)
		expect(expiryMs).toBeLessThanOrEqual(Date.now() + 4 * 60 * 60 * 1000 + 1000)
	})

	it("24h duration is the hard ceiling (no longer option exposed)", () => {
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		const radios = screen.getAllByRole("radio")
		// 1h, 4h, 8h, 24h (max)
		expect(radios).toHaveLength(4)
		expect(screen.getByTestId("temp-external-duration-24h")).toBeTruthy()
	})

	it("removing an entry calls updateSetting with the array minus that entry", () => {
		mockExtensionState.value.clinemmTemporaryExternalPathAuthorities = [
			{ path: "/private/tmp", expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() },
			{ path: "/var/log", expiresAt: new Date(Date.now() + 1 * 3600 * 1000).toISOString() },
		]
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByTestId("remove-temp-external-/private/tmp"))
		expect(mockUpdateSetting).toHaveBeenCalledTimes(1)
		const [, payload] = mockUpdateSetting.mock.calls[0] as [string, string]
		const parsed = JSON.parse(payload) as TemporaryExternalPathAuthority[]
		expect(parsed).toHaveLength(1)
		expect(parsed[0]!.path).toBe("/var/log")
	})

	it("'Allow /private/tmp for 24h' preset resolves /private/tmp with a 24h expiry", () => {
		const before = Date.now()
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		fireEvent.click(screen.getByTestId("temp-external-preset-private-tmp"))
		expect(mockUpdateSetting).toHaveBeenCalledTimes(1)
		const [, payload] = mockUpdateSetting.mock.calls[0] as [string, string]
		const parsed = JSON.parse(payload) as TemporaryExternalPathAuthority[]
		expect(parsed).toHaveLength(1)
		expect(parsed[0]!.path).toBe("/private/tmp")
		const expiryMs = Date.parse(parsed[0]!.expiresAt)
		expect(expiryMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000)
		expect(expiryMs).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 1000)
	})

	it("the Add button is disabled while the path field is empty", () => {
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		const addBtn = screen.getByTestId("temp-external-add") as HTMLButtonElement
		expect(addBtn.disabled).toBe(true)
	})

	it("CORRECTION01: expired entries render as 'Expired (no authority)' not 'expires in …'", () => {
		// Mock clock: any time AFTER expiresAt is "expired". We use an
		// expiresAt 1 second in the past so the test is deterministic
		// without depending on wall-clock timing at the assertion site.
		mockExtensionState.value.clinemmTemporaryExternalPathAuthorities = [
			{ path: "/var/log/old", expiresAt: new Date(Date.now() - 1000).toISOString() },
			{ path: "/var/log/fresh", expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() },
		]
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		const expiredStatus = screen.getByTestId("temp-external-status-/var/log/old")
		const freshStatus = screen.getByTestId("temp-external-status-/var/log/fresh")
		expect(expiredStatus.textContent).toMatch(/Expired/i)
		expect(expiredStatus.textContent).not.toMatch(/expires in/i)
		expect(freshStatus.textContent).toMatch(/expires in/i)
		expect(freshStatus.textContent).not.toMatch(/Expired/i)
	})

	it("CORRECTION01: unparseable expiresAt also renders as 'Expired' (not 'expires in NaN')", () => {
		mockExtensionState.value.clinemmTemporaryExternalPathAuthorities = [
			{ path: "/var/log/bad", expiresAt: "not-a-date" },
		]
		render(<TemporaryExternalPathsSection renderSectionHeader={() => null} />)
		const status = screen.getByTestId("temp-external-status-/var/log/bad")
		expect(status.textContent).toMatch(/Expired/i)
	})
})
