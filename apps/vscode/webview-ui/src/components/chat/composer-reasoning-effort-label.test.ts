import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import {
	formatComposerModelLabel,
	getOcaSupportedReasoningEfforts,
	resolveConfiguredReasoningEffort,
} from "./composer-reasoning-effort-label"

const M3 = "minimax:MiniMax-M3"
const M31 = "minimax:MiniMax-M3.1-Flash"

function config(overrides: Partial<ApiConfiguration> = {}): ApiConfiguration {
	return overrides
}

describe("composer reasoning-effort label", () => {
	it("displays an explicitly selected None for M3", () => {
		const effort = resolveConfiguredReasoningEffort(config({ actModeReasoningEffort: "none" }), "act", {
			provider: "minimax",
		})
		expect(formatComposerModelLabel(M3, effort)).toBe("minimax:MiniMax-M3:None")
	})

	it("displays the configured Low effort for M3.1", () => {
		const effort = resolveConfiguredReasoningEffort(config({ actModeReasoningEffort: "low" }), "act", {
			provider: "minimax",
		})
		expect(formatComposerModelLabel(M31, effort)).toBe("minimax:MiniMax-M3.1-Flash:Low")
	})

	it("uses the active mode's configured effort", () => {
		const apiConfiguration = config({
			planModeReasoningEffort: "high",
			actModeReasoningEffort: "low",
		})

		expect(formatComposerModelLabel(M3, resolveConfiguredReasoningEffort(apiConfiguration, "act"))).toBe(
			"minimax:MiniMax-M3:Low",
		)
		expect(formatComposerModelLabel(M3, resolveConfiguredReasoningEffort(apiConfiguration, "plan"))).toBe(
			"minimax:MiniMax-M3:High",
		)
	})

	it("updates the projected label when the configured effort changes", () => {
		const first = resolveConfiguredReasoningEffort(config({ actModeReasoningEffort: "low" }), "act")
		const second = resolveConfiguredReasoningEffort(config({ actModeReasoningEffort: "high" }), "act")

		expect(formatComposerModelLabel(M3, first)).toBe("minimax:MiniMax-M3:Low")
		expect(formatComposerModelLabel(M3, second)).toBe("minimax:MiniMax-M3:High")
	})

	it("does not reuse reasoning information from another provider", () => {
		const apiConfiguration = config({
			actModeReasoningEffort: "high",
			actModeOcaReasoningEffort: "low",
		})

		expect(
			formatComposerModelLabel(
				"oca:model",
				resolveConfiguredReasoningEffort(apiConfiguration, "act", {
					provider: "oca",
					supportedEfforts: ["low", "high"],
				}),
			),
		).toBe("oca:model:Low")
		expect(formatComposerModelLabel(M3, resolveConfiguredReasoningEffort(apiConfiguration, "act"))).toBe(
			"minimax:MiniMax-M3:High",
		)
	})

	it("does not fabricate a value when effort information is unavailable", () => {
		expect(resolveConfiguredReasoningEffort(config(), "act")).toBeUndefined()
		expect(formatComposerModelLabel(M3, resolveConfiguredReasoningEffort(config(), "act"))).toBe(M3)
		expect(resolveConfiguredReasoningEffort(config({ actModeReasoningEffort: "unexpected" }), "act")).toBeUndefined()
	})

	it("displays Max only when the active model explicitly supports it", () => {
		const apiConfiguration = config({
			actModeOcaReasoningEffort: "max",
			actModeOcaModelInfo: {
				modelName: "MiniMax-M3.1-Flash",
				reasoningEffortOptions: ["low", "medium", "high", "xhigh", "max"],
			},
		})

		const supported = getOcaSupportedReasoningEfforts(apiConfiguration, "act")
		expect(
			formatComposerModelLabel(
				M31,
				resolveConfiguredReasoningEffort(apiConfiguration, "act", { provider: "oca", supportedEfforts: supported }),
			),
		).toBe("minimax:MiniMax-M3.1-Flash:Max")

		const unsupported = config({ actModeOcaReasoningEffort: "max" })
		expect(
			resolveConfiguredReasoningEffort(unsupported, "act", {
				provider: "oca",
				supportedEfforts: getOcaSupportedReasoningEfforts(unsupported, "act"),
			}),
		).toBeUndefined()
	})

	it("preserves the existing model label when no suffix is applicable", () => {
		expect(formatComposerModelLabel(M3, undefined)).toBe(M3)
		expect(formatComposerModelLabel("openai-compat:MiniMax-M3", undefined)).toBe("openai-compat:MiniMax-M3")
	})

	it("wires the configured effort into the composer model label", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(__dirname, "ChatTextArea.tsx"), "utf8")

		expect(source).toMatch(/return formatComposerModelLabel\(baseModelLabel, configuredEffort\)/)
		expect(source).toMatch(/resolveConfiguredReasoningEffort\(apiConfiguration, mode/)
	})

	it("keeps the existing model label as the sole model-profile picker trigger", async () => {
		const { readFileSync } = await import("node:fs")
		const { join } = await import("node:path")
		const source = readFileSync(join(__dirname, "ChatTextArea.tsx"), "utf8")

		expect(source).toMatch(/<ModelDisplayButton[\s\S]*?\{\.\.\.profileSwitchTriggerProps\}/)
		expect(source).not.toMatch(/<ModelProfileQuickSwitchContainer/)
		expect(source.match(/data-testid="model-profile-trigger"/g)).toBeNull()
	})
})
