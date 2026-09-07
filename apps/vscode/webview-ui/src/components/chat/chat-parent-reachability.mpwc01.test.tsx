/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
 *
 * C1: CHAT_PARENT_REACHABILITY (RED witness)
 *
 * The real chat parent (`ChatTextArea.tsx`'s `ModelContainer`) MUST
 * render `<ModelProfileQuickSwitchContainer>` so the user can click
 * the footer to switch profiles without navigating to Settings.
 *
 * Discriminator: assert the chat parent SOURCE contains an
 * unconditional import + render of the container. This is a static
 * source check, not a behavior test, because the existing
 * `ChatTextArea.test.tsx` integration suite already exercises the
 * surrounding footer row behavior. The point is that the container
 * is actually mounted in the parent — not just present as an
 * orphaned module.
 *
 * RED: the source contains no `<ModelProfileQuickSwitchContainer>`
 * JSX. GREEN: the source contains the JSX.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// webview-ui/src/components/chat/<test>.test.tsx
// → webview-ui/src/components/chat/ChatTextArea.tsx
const CHAT_TEXT_AREA_PATH = join(__dirname, "ChatTextArea.tsx")

describe("MPWC01_C1_CHAT_PARENT_REACHABILITY", () => {
	it("imports ModelProfileQuickSwitchContainer in ChatTextArea.tsx", () => {
		const source = readFileSync(CHAT_TEXT_AREA_PATH, "utf8")
		expect(source).toMatch(/from\s+["'].*ModelProfileQuickSwitchContainer["']/)
	})

	it("renders <ModelProfileQuickSwitchContainer> JSX in ChatTextArea.tsx", () => {
		const source = readFileSync(CHAT_TEXT_AREA_PATH, "utf8")
		expect(source).toMatch(/<ModelProfileQuickSwitchContainer[\s>]/)
	})
})
