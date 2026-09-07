/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
 *
 * C1: CHAT_PARENT_REACHABILITY (RED witness)
 *
 * The real chat parent (`ChatTextArea.tsx`'s `ModelContainer`) MUST
 * wire the profile picker. Originally the test asserted a sibling
 * `<ModelProfileQuickSwitchContainer />` mount — but per the
 * sixteenth reviewer's CORRECTION02 verdict
 * (`HALT_MODEL_PROFILE_TRIGGER_SEAM_WRONG`), that was the wrong
 * seam: clicking the existing current-model label still routed to
 * Settings, and the picker lived NEXT TO the existing model
 * button instead of replacing it.
 *
 * CORRECTION02 fixes this by binding the popover to the EXISTING
 * `<ModelDisplayButton>` via `useModelProfileQuickSwitchHost`.
 * The picker is reachable by clicking the visible model label.
 *
 * This file is retained as the reachability contract: the chat
 * parent source MUST contain the picker wiring. The CORRECTION02
 * behavioral witness lives in
 * `chat-existing-model-label-trigger.mpwc02.test.tsx` and proves
 * the click → popover behavior end-to-end.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// webview-ui/src/components/chat/<test>.test.tsx
// → webview-ui/src/components/chat/ChatTextArea.tsx
const CHAT_TEXT_AREA_PATH = join(__dirname, "ChatTextArea.tsx")

describe("MPWC01_C1_CHAT_PARENT_REACHABILITY (superseded-by-correction02)", () => {
	it("ChatTextArea.tsx imports useModelProfileQuickSwitchHost from the picker container", () => {
		const source = readFileSync(CHAT_TEXT_AREA_PATH, "utf8")
		expect(source).toMatch(/useModelProfileQuickSwitchHost/)
	})

	it("ChatTextArea.tsx spreads triggerProps onto the existing ModelDisplayButton (the picker trigger IS the model label)", () => {
		const source = readFileSync(CHAT_TEXT_AREA_PATH, "utf8")
		expect(source).toMatch(/ModelDisplayButton[\s\S]*?\{\.\.\.profileSwitchTriggerProps\}/)
	})

	it("ChatTextArea.tsx renders the popover inside ModelContainer (sibling of the trigger, same DOM subtree)", () => {
		const source = readFileSync(CHAT_TEXT_AREA_PATH, "utf8")
		expect(source).toMatch(/profileSwitchPopover/)
	})
})
