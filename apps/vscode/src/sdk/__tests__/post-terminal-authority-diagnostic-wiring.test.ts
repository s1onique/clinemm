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
const RUNTIME_PATH = resolve(__dirname, "../post-terminal-authority-diagnostic-runtime.ts")
const REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const INPUT_SECTION_PATH = resolve(
	__dirname,
	"../../../webview-ui/src/components/chat/chat-view/components/layout/InputSection.tsx",
)
const ACTION_BUTTONS_PATH = resolve(
	__dirname,
	"../../../webview-ui/src/components/chat/chat-view/components/layout/ActionButtons.tsx",
)
const USE_MESSAGE_HANDLERS_PATH = resolve(
	__dirname,
	"../../../webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts",
)
const WEBVIEW_MESSAGE_PATH = resolve(__dirname, "../../shared/WebviewMessage.ts")
const EXTENSION_MESSAGE_PATH = resolve(__dirname, "../../shared/ExtensionMessage.ts")

function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1 / wiring", () => {
	describe("W1: extension-side module wiring", () => {
		it("W1-1: SdkController imports buildExtensionSnapshotFromState from the builder and the rest from @shared", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01:
			// The builder re-exports buildExtensionSnapshotFromState; the
			// webview-bundle-safe module (@shared) exposes the lifecycle
			// helpers. The import split keeps the SDK-side file free of
			// gRPC plumbing while ensuring the SdkController never imports
			// the diagnostic schema through the webview-only path.
			expect(source).toMatch(
				/import\s*\{[^}]*buildExtensionSnapshotFromState[^}]*\}\s*from\s*"\.\/post-terminal-authority-diagnostic-builder"/s,
			)
			expect(source).toMatch(
				/import\s*\{[^}]*isPostTerminalAuthorityDiagnosticEnabled[^}]*\}\s*from\s*"@shared\/post-terminal-authority-diagnostic"/s,
			)
			expect(source).toMatch(
				/import\s*\{[^}]*recordPostTerminalAuthoritySnapshot[^}]*\}\s*from\s*"@shared\/post-terminal-authority-diagnostic"/s,
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

		it("W3-2: the raw-incoming capture is positioned before the pure functional setState callback", () => {
			const source = readSource(WEBVIEW_CONTEXT_PATH)
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REACT-UPDATER-PURITY-REPAIR01:
			// The capture was relocated OUTSIDE the setState callback (between
			// `stateData = JSON.parse(...)` and `setState((prevState) => {`)
			// so the functional updater remains pure (no side effects).
			// This test now pins that the raw-incoming capture precedes the
			// setState call instead of being inside it.
			const jsonParseIdx = source.indexOf("JSON.parse(response.stateJson)")
			const setStateIdx = source.indexOf("setState((prevState)", jsonParseIdx)
			expect(jsonParseIdx).toBeGreaterThanOrEqual(0)
			expect(setStateIdx).toBeGreaterThan(jsonParseIdx)
			const slice = source.slice(jsonParseIdx, setStateIdx)
			expect(slice).toMatch(/isPostTerminalAuthorityDiagnosticEnabled\(\s*"webview"\s*\)/)
			expect(slice).toMatch(/recordPostTerminalAuthoritySnapshot\(/)
			expect(slice).toMatch(/buildWebviewSnapshot\(/)
		})
	})

	describe("W4: NO production semantic change", () => {
		it("W4-1: every diagnostic entry-point is gated by isPostTerminalAuthorityDiagnosticEnabled", () => {
			const s1 = readSource(SDK_CONTROLLER_PATH)
			const s2 = readSource(WEBVIEW_CONTEXT_PATH)
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

	describe("W5: live enablement (R1)", () => {
		it("W5-1: the runtime module exists with workspace-state-driven enablement", () => {
			const source = readSource(RUNTIME_PATH)
			expect(source).toContain("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1")
			expect(source).toContain("togglePostTerminalAuthorityDiagnosticWorkspaceEnabled")
			expect(source).toContain("isPostTerminalAuthorityDiagnosticWorkspaceEnabled")
		})

		it("W5-2: SdkController reads the workspace flag and stamps _ptadEnabled on the wire", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			expect(source).toMatch(/isPostTerminalAuthorityDiagnosticWorkspaceEnabled\(/)
			expect(source).toMatch(/_ptadEnabled: true/)
		})

		it("W5-3: the ExtensionState wire type declares _ptadEnabled as optional boolean", () => {
			const source = readSource(EXTENSION_MESSAGE_PATH)
			expect(source).toMatch(/_ptadEnabled\?:\s*boolean/)
		})

		it("W5-4: the webview reads _ptadEnabled on its first state push", () => {
			const source = readSource(WEBVIEW_CONTEXT_PATH)
			// The wiring must reference _ptadEnabled and act on it
			// (enable or disable) — the if may be in either form
			// (inline or hoisted const). The W12-1 test pins the
			// disable path independently.
			expect(source).toMatch(/stateData\._ptadEnabled\s*===\s*true/)
		})

		it("W5-5: package.json declares the two debug commands", () => {
			const source = readSource(PACKAGE_JSON_PATH)
			expect(source).toContain("cline.debug.togglePostTerminalAuthorityDiagnostic")
			expect(source).toContain("cline.debug.dumpPostTerminalAuthorityDiagnostic")
		})

		it("W5-6: the registry exposes the two debug command constants", () => {
			const source = readSource(REGISTRY_PATH)
			expect(source).toContain("TogglePostTerminalAuthorityDiagnostic")
			expect(source).toContain("DumpPostTerminalAuthorityDiagnostic")
		})

		it("W5-7: extension.ts registers both commands", () => {
			const source = readSource(resolve(__dirname, "../../extension.ts"))
			expect(source).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.TogglePostTerminalAuthorityDiagnostic/s)
			expect(source).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.DumpPostTerminalAuthorityDiagnostic/s)
		})
	})

	describe("W6: live extraction (R2)", () => {
		it("W6-1: the dump command sends a webview postMessage asking the webview to flush", () => {
			const source = readSource(resolve(__dirname, "../../extension.ts"))
			expect(source).toMatch(/type:\s*"clinemm\.dumpPostTerminalAuthorityDiagnostic"/)
		})

		it("W6-2: the webview listens for the dump trigger and posts records back", () => {
			const source = readSource(WEBVIEW_CONTEXT_PATH)
			expect(source).toMatch(/clinemm\.dumpPostTerminalAuthorityDiagnostic/)
			expect(source).toMatch(/__clineVsCodeApi/)
		})

		it("W6-3: the extension handleWebviewMessage handles the flush-back type", () => {
			const source = readSource(resolve(__dirname, "../../hosts/vscode/VscodeWebviewProvider.ts"))
			expect(source).toMatch(/case\s*"clinemm\.appendPostTerminalAuthorityDiagnostic"/)
			expect(source).toMatch(/isPostTerminalAuthoritySnapshotLike/)
		})

		it("W6-4: WebviewMessage union includes the flush-back type", () => {
			const source = readSource(WEBVIEW_MESSAGE_PATH)
			expect(source).toMatch(/clinemm\.appendPostTerminalAuthorityDiagnostic/)
		})
	})

	describe("W7: composer/follow-up capture (R3)", () => {
		it("W7-1: InputSection captures submitDisabled at the exact production expression site", () => {
			const source = readSource(INPUT_SECTION_PATH)
			expect(source).toMatch(/isPostTerminalAuthorityDiagnosticEnabled\("webview"\)/)
			expect(source).toMatch(/chatReducerSendingDisabled: sendingDisabled/)
			expect(source).toMatch(/submitDisabled,/)
			expect(source).toMatch(/allowQueuedSubmit,/)
		})

		it("W7-2: ActionButtons captures buttonConfig.sendingDisabled at the unlock site", () => {
			const source = readSource(ACTION_BUTTONS_PATH)
			expect(source).toMatch(/isPostTerminalAuthorityDiagnosticEnabled\("webview"\)/)
			expect(source).toMatch(/buttonConfig:\s*\{[\s\S]*?sendingDisabled:\s*buttonConfig\.sendingDisabled/)
		})

		it("W7-3: useMessageHandlers captures the follow-up routing decision", () => {
			const source = readSource(USE_MESSAGE_HANDLERS_PATH)
			expect(source).toMatch(/captureFollowupRoute/)
			expect(source).toMatch(/followupCanSubmit/)
			expect(source).toMatch(/pendingResponsePresent/)
			expect(source).toMatch(/pendingUserMessagePresent/)
		})
	})

	describe("W8: correlation semantics (R4)", () => {
		it("W8-1: same stateVersion implies same pushed payload/version (NOT literal same wall-clock instant)", () => {
			const source = readSource(resolve(__dirname, "../../shared/post-terminal-authority-diagnostic.ts"))
			expect(source).not.toMatch(/same\s+logical\s+instant/i)
			expect(source).not.toMatch(/literal\s+single\s+instant/i)
		})
	})

	describe("W9: correlation-domain fix (R7)", () => {
		it("W9-1: InputSection captures the wire-side ExtensionState.stateVersion, NOT turnState.seq", () => {
			const source = readSource(INPUT_SECTION_PATH)
			// The capture must pull stateVersion from useExtensionState, not
			// turnState?.seq.
			expect(source).toMatch(/stateVersion:\s*wireStateVersion\s*\?\?\s*0/)
			expect(source).not.toMatch(/stateVersion:\s*turnState\?\.seq/)
		})

		it("W9-2: ActionButtons captures the wire-side ExtensionState.stateVersion, NOT turnState.seq", () => {
			const source = readSource(ACTION_BUTTONS_PATH)
			expect(source).toMatch(/stateVersion:\s*wireStateVersion\s*\?\?\s*0/)
			expect(source).not.toMatch(/stateVersion:\s*turnState\?\.seq/)
		})

		it("W9-3: useMessageHandlers captures the wire-side ExtensionState.stateVersion, NOT turnState.seq", () => {
			const source = readSource(USE_MESSAGE_HANDLERS_PATH)
			expect(source).toMatch(/stateVersion:\s*args\.wireStateVersion\s*\?\?\s*0/)
			expect(source).not.toMatch(/stateVersion:\s*args\.turnStateSeq\s*\?\?\s*0/)
		})
	})

	describe("W10: dump-path robustness (R8)", () => {
		it("W10-1: the runtime creates globalStorageUri.fsPath with mkdir before writing", () => {
			const source = readSource(RUNTIME_PATH)
			expect(source).toMatch(/mkdir\([^)]*\{[^}]*recursive:\s*true\s*\}/)
			expect(source).toMatch(/ensureDirectory/)
		})

		it("W10-2: both dump paths call ensureDirectory before writeFile", () => {
			const source = readSource(RUNTIME_PATH)
			const ensureCount = source.split("ensureDirectory(dir)").length - 1
			expect(ensureCount).toBeGreaterThanOrEqual(2)
		})
	})

	describe("W11: failed-followup coverage (R9)", () => {
		it("W11-1: useMessageHandlers captures the BLOCKED branch when turnAllowsFollowup returns false", () => {
			const source = readSource(USE_MESSAGE_HANDLERS_PATH)
			// The blocked branch must exist and route name must carry the
			// phase that rejected the follow-up.
			expect(source).toMatch(/clineAsk\.turnAllowsFollowup\.blocked/)
			expect(source).toMatch(/canSubmit:\s*false/)
		})

		it("W11-2: the allowed branch uses route=...allowed and canSubmit=true", () => {
			const source = readSource(USE_MESSAGE_HANDLERS_PATH)
			expect(source).toMatch(/clineAsk\.turnAllowsFollowup\.allowed/)
			expect(source).toMatch(/canSubmit:\s*true/)
		})
	})

	describe("W12: toggle disable symmetry (R10)", () => {
		it("W12-1: the webview context disables the recorder when the wire bit is missing or false", () => {
			const source = readSource(WEBVIEW_CONTEXT_PATH)
			// Must have an else branch that calls disablePostTerminalAuthorityDiagnostic.
			expect(source).toMatch(/disablePostTerminalAuthorityDiagnostic\(\s*"webview"\s*\)/)
		})
	})

	// ============================================================================
	// ACT-CLINEMM-COMPLETION-PTAD-EXTEND01
	//
	// W1-EXT01 / W2-EXT01 / W3-EXT01 pin the wiring of the new
	// `attemptCompletionSeen` / `terminalResponseCommittedThisTurn`
	// discriminator fields at the source level.
	//
	// W1-EXT01: the SdkController capture site passes the canonical
	//           translator state reference.
	// W2-EXT01: the builder uses the structural `Pick<>` so it
	//           CANNOT call any setter method. This is the structural
	//           embodiment of `HALT_DIAGNOSTIC_MUTATES_MESSAGE_TRANSLATOR_SEMANTICS`.
	// W3-EXT01: the shared diagnostic module declares both new
	//           optional fields on `PostTerminalAuthoritySnapshot`.
	// ============================================================================

	describe("W13: ACT-CLINEMM-COMPLETION-PTAD-EXTEND01 wiring", () => {
		it("W1-EXT01: SdkController capture site passes messageTranslatorState to the builder", () => {
			const source = readSource(SDK_CONTROLLER_PATH)
			// The PTAD capture site inside `getStateToPostToWebview()` must
			// pass `messageTranslatorState: this.messageTranslatorState`
			// (or an equivalent bind) to `buildExtensionSnapshotFromState`.
			// We assert the literal string because the exact token name is
			// load-bearing for the structural `Pick<>` type.
			expect(source).toMatch(/messageTranslatorState:\s*this\.messageTranslatorState/)
		})

		it("W2-EXT01: builder source uses Pick<MessageTranslatorState, ...> and does NOT call any setter", () => {
			const source = readSource(BUILDER_PATH)
			// Structural type: the builder's Pick<> shape MUST include
			// exactly the two accessor names. The builder MUST NOT call
			// any setter method on the supplied state — that would
			// mutate the canonical authority and break
			// `HALT_DIAGNOSTIC_MUTATES_MESSAGE_TRANSLATOR_SEMANTICS`.
			//
			// We strip block comments and line comments before searching
			// for setter call-sites, because the JSDoc itself names the
			// setters in its prohibition (a documentation annotation,
			// not a call-site). Stripping comments ensures we test the
			// actual executable surface.
			const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
			expect(source).toMatch(/Pick<\s*MessageTranslatorState/)
			expect(source).toMatch(/wasAttemptCompletionSeen/)
			expect(source).toMatch(/wasTerminalResponseCommittedThisTurn/)
			// No setter call-sites anywhere in the executable source.
			expect(codeOnly).not.toMatch(/setAttemptCompletionSeen/)
			expect(codeOnly).not.toMatch(/setTerminalResponseCommittedThisTurn/)
			// The builder's import surface MUST include the type but
			// MUST NOT import the setters as named exports.
			expect(codeOnly).not.toMatch(/MessageTranslatorState[\s\S]*?setAttemptCompletionSeen/)
		})

		it("W3-EXT01: PostTerminalAuthoritySnapshot declares both new optional fields", () => {
			const source = readSource(SHARED_DIAGNOSTIC_PATH)
			// Both fields must be declared as optional `readonly` on the
			// PostTerminalAuthoritySnapshot interface. We assert the
			// exact declaration form to lock the wire-shape delta at zero.
			expect(source).toMatch(/readonly attemptCompletionSeen\?:\s*boolean/)
			expect(source).toMatch(/readonly terminalResponseCommittedThisTurn\?:\s*boolean/)
		})
	})
})
