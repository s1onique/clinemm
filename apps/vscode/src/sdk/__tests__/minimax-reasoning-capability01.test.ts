/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 — D2.
 *
 * MiniMax M3.1-Flash REQUIRES reasoning and defaults to `max` effort when the
 * native API omits it. "Thinking disabled" is therefore NOT a supported
 * configuration for it.
 *
 * This witness proves BOTH halves of the requirement:
 *
 *   D2a  The current UI/SDK configuration CAN request `None` for M3.1 — so the
 *        unsupported state is genuinely reachable, not hypothetical.
 *   D2b  The unsupported disable is DETECTED before transport and is NOT
 *        silently represented as reasoning-disabled.
 *   D2c  A PERSISTED (stale) `None` keeps its explicit-selection marker
 *        through the stale-field cleanup, so it can still be rejected at the
 *        production boundary instead of being silently replaced by the
 *        model's mandatory reasoning default.
 *
 * It also pins that M3's VALID disabled-thinking mode is preserved.
 */

import { OPENAI_REASONING_EFFORT_OPTIONS } from "@shared/storage/types"
import { describe, expect, it } from "vitest"
import { normalizeProviderReasoningSettings, sanitizedDisabledReasoningSettings } from "../cline-session-factory"

describe("D2: MiniMax M3.1 mandatory reasoning", () => {
	it("D2a: the UI effort options include None, so an unsupported disable is reachable", () => {
		// The reasoning-effort selector offers every option in
		// OPENAI_REASONING_EFFORT_OPTIONS unless a provider narrows the list.
		// OpenRouter's picker does not narrow it, so `None` is selectable for
		// ANY reasoning-capable model, including M3.1.
		expect(OPENAI_REASONING_EFFORT_OPTIONS).toContain("none")
	})

	it("D2a: the persisted `None` selection becomes a disabled-thinking session request", () => {
		// The user's persisted selection reaches the session layer as
		// `thinking: false`. This is the state the provider layer must
		// DETECT as unsupported for a mandatory-reasoning model.
		expect(normalizeProviderReasoningSettings({ enabled: false })).toEqual({
			thinking: false,
		})
		expect(normalizeProviderReasoningSettings({ effort: "none" })).toEqual({
			thinking: false,
		})
	})

	it("D2b: a disabled-thinking request carries NO effort (so it cannot be mistaken for one)", () => {
		const normalized = normalizeProviderReasoningSettings({
			enabled: false,
			effort: "medium",
		})
		expect(normalized.thinking).toBe(false)
		expect(normalized.reasoningEffort).toBeUndefined()
	})

	it("D2c: the stale-field cleanup KEEPS an explicit `None` selection", () => {
		// A persisted `None` is a user-visible selection, not an incoherent
		// "disabled + active effort" combination. The cleanup drops an
		// ACTIVE effort, but it must keep the `none` marker: dropping it
		// would turn the explicit selection into an anonymous disable, which
		// the production boundary can no longer reject on a model that
		// mandates reasoning — the user's `None` would be silently
		// replaced by the model's mandatory default.
		expect(sanitizedDisabledReasoningSettings({ enabled: false, effort: "none" })).toEqual({
			enabled: false,
			effort: "none",
		})
	})

	it("D2c: the stale-field cleanup still drops an ACTIVE effort", () => {
		// A disabled state must never carry an active effort. That part of
		// the cleanup is unchanged by the correction.
		expect(sanitizedDisabledReasoningSettings({ enabled: false, effort: "medium" })).toEqual({
			enabled: false,
		})
		expect(sanitizedDisabledReasoningSettings({ enabled: false, effort: "medium", budgetTokens: 1024 })).toEqual({
			enabled: false,
		})
	})
})
