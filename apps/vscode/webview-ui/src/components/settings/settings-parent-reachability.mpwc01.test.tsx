/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
 *
 * C2: SETTINGS_PARENT_REACHABILITY (RED witness)
 *
 * The real Settings parent (`SettingsView.tsx`'s tab registry) MUST
 * mount `ModelProfilesSectionContainer` so the user can navigate to
 * it from Settings. The existing `ModelProfilesSection` is present
 * but the `Container` (which wires to `StateServiceClient.*`) is not
 * mounted anywhere.
 *
 * Discriminator: assert the Settings parent SOURCE contains an
 * import of `ModelProfilesSectionContainer` AND a tab that mounts
 * it. The Settings tab registry uses the `TAB_CONTENT_MAP` shape
 * (mirrors `sandbox: () => (<><Sandbox... /><Temporary... /></>)`).
 *
 * RED: the source contains no `ModelProfilesSectionContainer`.
 * GREEN: it does.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// webview-ui/src/components/settings/<test>.test.tsx
// → webview-ui/src/components/settings/SettingsView.tsx
const SETTINGS_VIEW_PATH = join(__dirname, "SettingsView.tsx")

describe("MPWC01_C2_SETTINGS_PARENT_REACHABILITY", () => {
	it("imports ModelProfilesSectionContainer in SettingsView.tsx", () => {
		const source = readFileSync(SETTINGS_VIEW_PATH, "utf8")
		expect(source).toMatch(/from\s+["'].*ModelProfilesSectionContainer["']/)
	})

	it("renders <ModelProfilesSectionContainer> JSX in SettingsView.tsx", () => {
		const source = readFileSync(SETTINGS_VIEW_PATH, "utf8")
		expect(source).toMatch(/<ModelProfilesSectionContainer[\s>]/)
	})
})
