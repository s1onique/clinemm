import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { isToolAutoApproved } from "./sdk-tool-policies"

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("uses executeSafeCommands as the single command approval flag", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	// ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01
	// EDIT-AUTOAPPROVE-AUTHORITY-REGRESSION01: prove non-command tools consult
	// the live user settings (matches upstream v4.1.10 wiring).
	it("auto-approves edit_files when actions.editFiles=true", () => {
		expect(isToolAutoApproved("editor", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
	})

	it("does NOT auto-approve edit_files when actions.editFiles=false", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				editFiles: false,
			},
		}
		expect(isToolAutoApproved("editor", settings)).toBe(false)
	})

	it("auto-approves read_files when actions.readFiles=true", () => {
		expect(isToolAutoApproved("read_files", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
	})

	it("does NOT auto-approve read_files when actions.readFiles=false", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				readFiles: false,
			},
		}
		expect(isToolAutoApproved("read_files", settings)).toBe(false)
	})

	it("auto-approves fetch_web_content when actions.useBrowser=true", () => {
		expect(isToolAutoApproved("fetch_web_content", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(true)
	})

	it("does NOT auto-approve fetch_web_content when actions.useBrowser=false", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				useBrowser: false,
			},
		}
		expect(isToolAutoApproved("fetch_web_content", settings)).toBe(false)
	})
})
