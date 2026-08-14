/**
 * Regression + acceptance tests for MistakeTracker.
 *
 * ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01.
 *
 * These tests prove the post-fix invariant: a model that emits N
 * recoverable protocol errors in a row is NEVER blocked by the tracker.
 * The tracker returns an advisory `action: "continue"` outcome; the
 * orchestrator does not abort the runtime.
 *
 * Vendor neutrality: the tests use fake model identifiers
 * (`vendor-a/model-x`, `vendor-b/model-y`, `local/model-z`) plus a
 * historical regression case (`claude-sonnet-4-5`) to prove the
 * execution decision never keys on model identity.
 */

import { describe, expect, it } from "vitest"
import { MistakeTracker, buildMistakeLimitStopMessage } from "./mistake-tracker"

function makeOptions(overrides: Partial<ConstructorParameters<typeof MistakeTracker>[0]> = {}) {
	const events: unknown[] = []
	const recoveryNotices: Array<{ message: string; reason: string }> = []
	const telemetryHits: unknown[] = []
	return {
		events,
		recoveryNotices,
		telemetryHits,
		options: {
			maxConsecutiveMistakes: 3,
			emit: (event: unknown) => {
				events.push(event)
			},
			log: () => {
				/* no-op */
			},
			agentId: "agent-test",
			getConversationId: () => "conv-test",
			getActiveRunId: () => "run-test",
			appendRecoveryNotice: (message: string, reason: string) => {
				recoveryNotices.push({ message, reason })
			},
			onLimitTelemetry: (ctx: unknown) => {
				telemetryHits.push(ctx)
			},
			...overrides,
		},
	}
}

describe("MistakeTracker — ACT-CLINEMM-MODEL-QUALITY-WARNING-NONBLOCKING01", () => {
	it("returns continue (advisory) when no callback is configured (vendor-a model)", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 3 })
		const tracker = new MistakeTracker(options)
		const inputs = Array.from({ length: 3 }, (_, i) => ({
			iteration: i + 1,
			reason: "tool_execution_failed" as const,
			details: `vendor-a/model-x attempt ${i + 1}`,
		}))

		const outcomes = []
		for (const input of inputs) {
			outcomes.push(await tracker.record(input))
		}

		// The first two are sub-limit; the third crosses the threshold. None
		// of them may produce `action: "stop"` because the no-callback default
		// must be advisory continue.
		for (const outcome of outcomes) {
			expect(outcome.action).toBe("continue")
		}

		const last = outcomes[outcomes.length - 1]
		if (last.action !== "continue") {
			throw new Error("expected continue outcome")
		}
		expect(last.kind).toBe("advisory")
		expect(last).not.toHaveProperty("message")
	})

	it("returns continue (advisory) at the limit even when the model is unknown / non-preferred", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 2 })
		const tracker = new MistakeTracker(options)

		// Pretend the provider catalog returned "unknown" for this model. The
		// tracker must NOT use that signal to escalate to stop.
		const first = await tracker.record({
			iteration: 1,
			reason: "invalid_tool_call",
			details: "local/model-z malformed JSON",
		})
		const second = await tracker.record({
			iteration: 2,
			reason: "invalid_tool_call",
			details: "local/model-z malformed JSON",
		})

		expect(first.action).toBe("continue")
		expect(second.action).toBe("continue")
		if (second.action !== "continue") {
			throw new Error("expected continue outcome")
		}
		expect(second.kind).toBe("advisory")
	})

	it("does not abort on a historical regression case (claude-sonnet-4-5)", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 1 })
		const tracker = new MistakeTracker(options)
		const outcome = await tracker.record({
			iteration: 1,
			reason: "tool_execution_failed",
			details: "claude-sonnet-4-5: tool returned no result",
		})

		expect(outcome.action).toBe("continue")
		// No `message` field means the orchestrator will not abort the runtime.
		expect(outcome).not.toHaveProperty("message")
	})

	it("calls onLimitTelemetry once per limit hit", async () => {
		const { options, telemetryHits } = makeOptions({ maxConsecutiveMistakes: 2 })
		const tracker = new MistakeTracker(options)
		await tracker.record({ iteration: 1, reason: "tool_execution_failed", details: "fail A" })
		await tracker.record({ iteration: 2, reason: "tool_execution_failed", details: "fail B" })
		expect(telemetryHits).toHaveLength(1)
	})

	it("preserves user-provided guidance when the callback returns continue with guidance", async () => {
		const { options, recoveryNotices } = makeOptions({ maxConsecutiveMistakes: 2 })
		options.onLimitReached = async () => ({
			action: "continue",
			guidance: "vendor-b/model-y: try smaller steps",
		})
		const tracker = new MistakeTracker(options)
		await tracker.record({ iteration: 1, reason: "tool_execution_failed", details: "fail" })
		const outcome = await tracker.record({ iteration: 2, reason: "tool_execution_failed", details: "fail" })

		expect(outcome.action).toBe("continue")
		if (outcome.action !== "continue") {
			throw new Error("expected continue outcome")
		}
		expect(outcome.kind).toBe("user-resolved")
		expect(outcome.guidance).toBe("vendor-b/model-y: try smaller steps")
		expect(recoveryNotices).toEqual([
			{ message: "vendor-b/model-y: try smaller steps", reason: "tool_execution_failed" },
		])
	})

	it("allows an explicit callback to return stop (terminal is opt-in, not default)", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 2 })
		options.onLimitReached = async () => ({ action: "stop", reason: "deliberate operator stop" })
		const tracker = new MistakeTracker(options)
		await tracker.record({ iteration: 1, reason: "tool_execution_failed", details: "x" })
		const outcome = await tracker.record({ iteration: 2, reason: "tool_execution_failed", details: "x" })
		expect(outcome.action).toBe("stop")
		if (outcome.action !== "stop") {
			throw new Error("expected stop outcome")
		}
		expect(outcome.kind).toBe("terminal")
		expect(outcome.message).toContain("Session state was preserved")
	})

	it("treats a throwing callback as advisory (not terminal)", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 2 })
		options.onLimitReached = async () => {
			throw new Error("callback exploded")
		}
		const tracker = new MistakeTracker(options)
		await tracker.record({ iteration: 1, reason: "tool_execution_failed", details: "x" })
		const outcome = await tracker.record({ iteration: 2, reason: "tool_execution_failed", details: "x" })
		// A throwing callback is not a recoverable protocol symptom; degrade
		// to advisory so the run can keep going.
		expect(outcome.action).toBe("continue")
		if (outcome.action !== "continue") {
			throw new Error("expected continue outcome")
		}
		expect(outcome.kind).toBe("advisory")
	})

	it("resets the consecutive counter after a continue at the limit", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 2 })
		const tracker = new MistakeTracker(options)
		await tracker.record({ iteration: 1, reason: "tool_execution_failed", details: "x" })
		await tracker.record({ iteration: 2, reason: "tool_execution_failed", details: "x" })
		expect(tracker.value).toBe(0)
	})

	it("does not enter an infinite retry loop on repeated identical failures", async () => {
		const { options } = makeOptions({ maxConsecutiveMistakes: 3 })
		const tracker = new MistakeTracker(options)
		let advisoryCount = 0
		let stopCount = 0
		for (let i = 0; i < 12; i++) {
			const outcome = await tracker.record({
				iteration: i + 1,
				reason: "tool_execution_failed",
				details: "identical failure",
			})
			if (outcome.action === "continue") {
				advisoryCount++
			}
			if (outcome.action === "stop") {
				stopCount++
			}
		}
		// Three advisory fires (every 3rd call), no stops.
		expect(advisoryCount).toBeGreaterThanOrEqual(4)
		expect(stopCount).toBe(0)
	})

	it("ignores model identifier when classifying mistakes (vendor neutrality)", async () => {
		const { options: aOptions } = makeOptions({ maxConsecutiveMistakes: 2 })
		const { options: bOptions } = makeOptions({ maxConsecutiveMistakes: 2 })

		const models = ["vendor-a/model-x", "vendor-b/model-y", "local/model-z", "claude-sonnet-4-5", "qwen", "deepseek", "gpt"]
		for (const modelId of models) {
			const trackerA = new MistakeTracker(aOptions)
			const trackerB = new MistakeTracker(bOptions)
			await trackerA.record({
				iteration: 1,
				reason: "tool_execution_failed",
				details: `${modelId}: fail A`,
			})
			await trackerA.record({
				iteration: 2,
				reason: "tool_execution_failed",
				details: `${modelId}: fail B`,
			})
			await trackerB.record({
				iteration: 1,
				reason: "invalid_tool_call",
				details: `${modelId}: bad JSON`,
			})
			await trackerB.record({
				iteration: 2,
				reason: "invalid_tool_call",
				details: `${modelId}: bad JSON`,
			})

			expect(trackerA.value).toBe(0)
			expect(trackerB.value).toBe(0)
		}
	})
})

describe("buildMistakeLimitStopMessage — vendor-neutral wording", () => {
	it("describes the symptom in protocol terms, never names a model", () => {
		const message = buildMistakeLimitStopMessage({
			iteration: 4,
			consecutiveMistakes: 3,
			maxConsecutiveMistakes: 3,
			reason: "tool_execution_failed",
			details: "tool returned no result",
		})
		expect(message).toContain("protocol errors")
		expect(message).toContain("tool_execution_failed")
		expect(message).toContain("Session state was preserved")
		// Anti-regression: must not say "Claude", "Sonnet", or any vendor.
		expect(message).not.toMatch(/claude|sonnet|opus|anthropic|openai|gpt|qwen|deepseek/i)
	})
})
