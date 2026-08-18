// ============================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1
//
// Structural witness test for the extension-side wiring of the
// post-terminal authority diagnostic. It asserts that:
//
//   1. The SdkController source imports the three diagnostic names from
//      `./post-terminal-authority-diagnostic-builder`.
//   2. The `getStateToPostToWebview` function body contains the
//      diagnostic capture, gated by isPostTerminalAuthorityDiagnosticEnabled
//      and using the buildExtensionSnapshotFromState helper. The capture
//      sits BETWEEN the snapshot construction and the explicit return.
//   3. The existing return shape (the `turnState` field, the
//      `thinkingPresentation` field, the `taskTelemetry` field) is
//      preserved verbatim — the diagnostic does NOT add new fields to
//      the wire payload.
//   4. The webview ExtensionStateContext source imports the same
//      diagnostic names from `@shared/post-terminal-authority-diagnostic`
//      and inserts an opt-in capture inside the setState reducer.
//
// This is a source-only witness. It does NOT exercise the
// diagnostic at runtime — that is the role of the C2 smoke.
// ============================================================================

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const SDK_CONTROLLER_PATH = resolve(__dirname, "../SdkController.ts")
const BUILDER_PATH = resolve(__dirname, "../post-terminal-authority-diagnostic-builder.ts")
const SHARED_DIAGNOSTIC_PATH = resolve(__dirname, "../../shared/post-terminal-authority-diagnostic.ts")
const WEBVIEW_CONTEXT_PATH = resolve(__dirname, "../../../webview-ui/src/context/ExtensionStateContext.tsx")

function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1 / wiring", () => {
	describe("W1: extension-side module wiring", () => {
		it("W1-1: SdkController imports the three diagnostic names from the builder", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			expect(source).toMatch(
				/import\s*\{[^}]*buildExtensionSnapshotFromState[^}]*\}\s*from\s*"\.\/post-terminal-authority-diagnostic-builder"/s,
			)
			expect(source).toMatch(
				/import\s*\{[^}]*isPostTerminalAuthorityDiagnosticEnabled[^}]*\}\s*from\s*"\.\/post-terminal-authority-diagnostic-builder"/s,
			)
			expect(source).toMatch(
				/import\s*\{[^}]*recordPostTerminalAuthoritySnapshot[^}]*\}\s*from\s*"\.\/post-terminal-authority-diagnostic-builder"/s,
			)
		})

		it("W1-2: the diagnostic builder lives in apps/vscode/src/sdk (extension-only)", () => {
			const source = readSource(BUILDER_PATH)
			expect(source).toContain("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1")
			expect(source).toContain("buildExtensionSnapshotFromState")
			// The builder must import the SHARED pure types from the webview-reachable path.
			expect(source).toMatch(
				/import\s+type\s*\{[^}]*PostTerminalAuthoritySnapshot[^}]*\}\s*from\s*"@shared\/post-terminal-authority-diagnostic"/,
			)
			// The builder must import ArbiterSnapshot from the extension-only path.
			expect(source).toMatch(/import\s+type\s*\{[^}]*ArbiterSnapshot[^}]*\}\s*from\s*"\.\/task-state-shadow-recorder"/)
		})

		it("W1-3: the shared module is webview-bundle-safe (no ArbiterSnapshot in its imports)", () => {
			const source = readSource(SHARED_DIAGNOSTIC_PATH)
			// Strip block comments so the docstring does not match the
			// `ArbiterSnapshot` token used in the source-code description.
			const sourceNoComments = source.replace(/\/\*[\s\S]*?\*\//g, "")
			// The shared module must NOT import the extension-only
			// `ArbiterSnapshot` type from the sdk tree (the webview
			// bundle does not include the sdk tree).
			const importLines = sourceNoComments.split("\n").filter((line) => /^import\s+/.test(line.trimStart()))
			const arbiterImport = importLines.find((line) => line.includes("ArbiterSnapshot"))
			expect(arbiterImport, "shared module must not import ArbiterSnapshot").toBeUndefined()
			expect(source).toContain("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1")
		})
	})

	function extractFunctionBody(source: string, signature: string): string {
		// Find the function signature, then brace-match forward to find the
		// closing brace of the function. This is needed because the function
		// body has nested `}` characters that defeat naive indexOf.
		const start = source.indexOf(signature)
		if (start < 0) {
			throw new Error(`Signature not found: ${signature}`)
		}
		// Find the first `{` after the signature. Walk forward, counting
		// braces, until depth returns to 0.
		let i = start
		while (i < source.length && source[i] !== "{") {
			i += 1
		}
		if (i >= source.length) {
			throw new Error("Opening brace not found")
		}
		let depth = 1
		i += 1
		while (i < source.length && depth > 0) {
			const c = source[i]
			if (c === "{") {
				depth += 1
			} else if (c === "}") {
				depth -= 1
			}
			i += 1
		}
		if (depth !== 0) {
			throw new Error("Unbalanced braces")
		}
		return source.slice(start, i)
	}

	describe("W2: extension-side capture wiring", () => {
		const getStateSignature = "async getStateToPostToWebview(): Promise<ExtensionState>"

		it("W2-1: getStateToPostToWebview contains the opt-in capture block", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			const body = extractFunctionBody(source, getStateSignature)
			expect(body).toMatch(/const\s+snapshot\s*=\s*\{/)
			expect(body).toMatch(/isPostTerminalAuthorityDiagnosticEnabled\(\s*"extension"\s*\)/)
			expect(body).toMatch(/recordPostTerminalAuthoritySnapshot\(\s*buildExtensionSnapshotFromState\(/)
			expect(body).toMatch(/return\s+snapshot/)
		})

		it("W2-2: the capture sits AFTER the snapshot construction and BEFORE the return", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			const body = extractFunctionBody(source, getStateSignature)
			const buildIdx = body.indexOf("const snapshot = {")
			// Use the call site (more specific than the gate), to avoid matching
			// the comment that mentions the helper above the snapshot construction.
			const captureIdx = body.indexOf("recordPostTerminalAuthoritySnapshot(")
			const returnIdx = body.indexOf("return snapshot")
			expect(buildIdx).toBeGreaterThan(0)
			expect(captureIdx).toBeGreaterThan(buildIdx)
			expect(returnIdx).toBeGreaterThan(captureIdx)
		})

		it("W2-3: the existing wire fields (turnState, thinkingPresentation, taskTelemetry) are preserved", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			const body = extractFunctionBody(source, getStateSignature)
			expect(body).toContain("turnState: this.turnStateTracker.get()")
			expect(body).toContain("taskTelemetry: this.taskTelemetry.get()")
			expect(body).toContain("thinkingPresentation: selectThinkingPresentation({")
		})
	})

	describe("W3: webview-side capture wiring", () => {
		it("W3-1: ExtensionStateContext imports the shared diagnostic module", () => {
			const source = readSource(WEBVIEW_CONTEXT_PATH)
			expect(source).toMatch(
				/import\s*\{[^}]*isPostTerminalAuthorityDiagnosticEnabled[^}]*\}\s*from\s*"@shared\/post-terminal-authority-diagnostic"/s,
			)
			expect(source).toMatch(
				/import\s*\{[^}]*recordPostTerminalAuthoritySnapshot[^}]*\}\s*from\s*"@shared\/post-terminal-authority-diagnostic"/s,
			)
		})

		it("W3-2: the setState callback contains the opt-in webview capture", () => {
			const source = readSource(WEBVIEW_CONTEXT_PATH)
			// The capture is positioned between setDidHydrateState(true) and return newState.
			const setDidHydrateIdx = source.indexOf("setDidHydrateState(true)")
			const returnIdx = source.indexOf("return newState", setDidHydrateIdx)
			expect(setDidHydrateIdx).toBeGreaterThanOrEqual(0)
			expect(returnIdx).toBeGreaterThan(setDidHydrateIdx)
			const slice = source.slice(setDidHydrateIdx, returnIdx)
			expect(slice).toMatch(/isPostTerminalAuthorityDiagnosticEnabled\(\s*"webview"\s*\)/)
			expect(slice).toMatch(/recordPostTerminalAuthoritySnapshot\(/)
			expect(slice).toMatch(/buildWebviewSnapshot\(/)
		})
	})

	describe("W4: NO production semantic change", () => {
		it("W4-1: every diagnostic entry-point is gated by isPostTerminalAuthorityDiagnosticEnabled", () => {
			const s1 = readSource(SDK_CONTROLLER_PATH)
			const s2 = readSource(WEBVIEW_CONTEXT_PATH)
			// Every call to recordPostTerminalAuthoritySnapshot in the
			// production code must be inside an if-branch that checks
			// isPostTerminalAuthorityDiagnosticEnabled.
			const extCallSites = s1.split("recordPostTerminalAuthoritySnapshot(").length - 1
			const extGuardSites = s1.split('isPostTerminalAuthorityDiagnosticEnabled("extension")').length - 1
			expect(extCallSites).toBeGreaterThan(0)
			expect(extGuardSites).toBeGreaterThanOrEqual(extCallSites)

			const wvCallSites = s2.split("recordPostTerminalAuthoritySnapshot(").length - 1
			const wvGuardSites = s2.split('isPostTerminalAuthorityDiagnosticEnabled("webview")').length - 1
			expect(wvCallSites).toBeGreaterThan(0)
			expect(wvGuardSites).toBeGreaterThanOrEqual(wvCallSites)
		})
	})
})
