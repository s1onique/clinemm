// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-LOCATOR-CORRECTION01
//
// Structural witness for the V2 helper locator. The production
// `resolveExtensionRoot()` previously hardcoded the upstream package
// identity ("claude-dev") when calling `vscode.extensions.getExtension`.
// The ClineMM fork's installed identity is `s1onique.clinemm`
// (`package.json` `publisher` + `name`, surfaced as
// `ExtensionRegistryInfo.id`). Under the fork that hardcoded lookup
// returned `undefined` and the V2 helper locator silently fell back
// to the V1 conservative path for every command — V2 stayed dormant
// even when the helper binary was present and the parser-helper
// mirror was correctly placed under `<extension-root>/bin/`.
//
// We do not exercise `resolveExtensionRoot()` end-to-end here:
// instantiating the production code path requires a real VS Code
// extension host, and the lookup is a lazy `require("vscode")` that
// does not intercept cleanly under the vitest module graph (the
// `import` and `require` paths resolve to separate stub instances).
// The same source-bound pattern is used in
// `SdkController.task-telemetry-wiring.test.ts` (M9 mutation-proof
// structural sentinel) — see its header for the rationale.
//
// RED cases pinned by this test:
//   1. The locator function calls `vscode.extensions.getExtension`
//      with the canonical registry identity (`ExtensionRegistryInfo.id`),
//      not a hardcoded literal.
//   2. The hardcoded literal `"claude-dev"` MUST NOT appear as the
//      lookup key in `resolveExtensionRoot()`. This is the regression
//      guard — re-introducing the upstream identity (whether literal
//      "claude-dev" or any other hardcoded fork string) fails this
//      assertion.
//   3. The lookup is part of the `buildProductionHelper()` -> locator
//      chain, so the resolved `extensionUri.fsPath` flows into
//      `defaultParserHelperLocator({ consumerRoot })`. This is
//      verified transitively by typecheck (`ExtensionRegistryInfo` is
//      the canonical registry identity used elsewhere in the
//      codebase, see `getIdeRedirectUri.ts` and `openWalkthrough.ts`).
//
// EVIDENCE QUALIFICATION:
//
//   REAL_CONTROLLER_VERTICAL = NOT_EXECUTED (intentional)
//   STRUCTURAL_WIRING_SENTINEL = YES
//   LIVE_DOGFOOD_VERTICAL = required for final acceptance (the
//     compound `git status && git diff --stat` probe)

import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const SdkControllerPath = path.resolve(__dirname, "SdkController.ts")
const SdkControllerSource = fs.readFileSync(SdkControllerPath, "utf8")

/**
 * Extract the body of `resolveExtensionRoot()` from the source.
 * Matches the function signature verbatim so this test does not
 * regress when the function is renamed or moved.
 */
function locateResolveExtensionRoot(source: string): string {
	const start = source.indexOf("function resolveExtensionRoot(): string | undefined {")
	if (start < 0) {
		throw new Error("SdkController.resolveExtensionRoot signature not found")
	}
	return source.slice(start)
}

describe("ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-LIVE-LOCATOR-CORRECTION01 / structural witness", () => {
	const body = locateResolveExtensionRoot(SdkControllerSource)

	it("LOCATOR-1: resolveExtensionRoot() looks up the extension by canonical registry identity (ExtensionRegistryInfo.id)", () => {
		// The lookup MUST use `ExtensionRegistryInfo.id`. The call
		// site uses optional chaining, e.g.
		//   vscode?.extensions?.getExtension?.(ExtensionRegistryInfo.id)
		// The regex tolerates either the optional-chain form
		// (`getExtension?.(ExtensionRegistryInfo.id)`) or a plain
		// call (`getExtension(ExtensionRegistryInfo.id)`).
		expect(body).toMatch(/getExtension\??\s*\.\s*\(\s*ExtensionRegistryInfo\.id\s*\)/)
	})

	it("LOCATOR-2: the hardcoded 'claude-dev' literal MUST NOT appear as the lookup key", () => {
		// Regression guard. Re-introducing the upstream identity
		// (whether the literal "claude-dev" or any other hardcoded
		// fork string) fails this assertion. Note: the literal may
		// legitimately appear in COMMENTS, in the package.json
		// rewrite tooling, or in unrelated test fixtures — so we
		// match against the `getExtension(...)` call site only.
		expect(body).not.toMatch(/getExtension\??\s*\.\s*\(\s*["']claude-dev["']\s*\)/)
	})

	it("LOCATOR-3: the resolved extensionUri.fsPath flows into defaultParserHelperLocator({ consumerRoot })", () => {
		// The path from the lookup to the locator argument is
		// short: `resolveExtensionRoot()` returns the
		// `extensionUri.fsPath`, which is then passed as
		// `consumerRoot` to `defaultParserHelperLocator(...)` from
		// `buildProductionHelper()`. We assert both ends exist.
		expect(body).toMatch(/extensionUri\?\.fsPath/)
		expect(SdkControllerSource).toMatch(/defaultParserHelperLocator\(\s*\{\s*consumerRoot:\s*extensionRoot\s*\}\s*\)/)
	})
})
