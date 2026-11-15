/**
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the CAPTURE IDENTITY witnesses.
 *
 * ## What this file establishes
 *
 * The Round C latency trace must be able to state WHICH software, WHICH
 * model and WHICH inference configuration produced a run, so that two runs
 * can be compared without guessing.
 *
 * The truthfulness rules this file pins:
 *
 *   - The REQUESTED model id and the EFFECTIVE model id are DISTINCT.
 *     The requested id is the CONFIGURED value; the effective id is what
 *     the provider REPORTED. They are never conflated.
 *
 *   - The quantization is recorded ONLY when it was explicitly observed.
 *     It is NEVER inferred from a model-family name — a model id that
 *     happens to contain "iq3" is a REQUESTED identifier, not a served
 *     quantization receipt.
 *
 *   - A field the trace could not observe is `UNAVAILABLE_FROM_TRACE` —
 *     never a guess and never a plausible-looking default.
 *
 *   - NO credential, prompt, tool command or model response is ever
 *     placed in the identity record.
 */

import type { ModelBehaviorTraceSink } from "@cline/shared"
import { beforeEach, describe, expect, it } from "vitest"
import {
	_resetRoundcLatencyTraceForTests,
	buildRoundcLatencyTraceArtifact,
	installRoundcLatencyTraceSink,
	observeRoundcCaptureIdentity,
	setRoundcLatencyTraceEnabled,
	UNAVAILABLE_FROM_TRACE,
} from "../roundc-latency-trace-runtime"

beforeEach(() => {
	_resetRoundcLatencyTraceForTests()
})

describe("ACT-CLINEMM-ROUND-C-TRACE-QUAL01 / capture identity", () => {
	it("ID.1: the identity starts UNAVAILABLE for every field the trace cannot observe", () => {
		setRoundcLatencyTraceEnabled(true)
		installRoundcLatencyTraceSink("session-qual01")
		const artifact = buildRoundcLatencyTraceArtifact()
		expect(artifact).toBeDefined()

		// The model identity was NEVER observed, so it is unavailable —
		// not a guess.
		expect(artifact?.identity.requestedModelId).toBe(UNAVAILABLE_FROM_TRACE)
		expect(artifact?.identity.effectiveModelId).toBe(UNAVAILABLE_FROM_TRACE)
		expect(artifact?.identity.quantization).toBe(UNAVAILABLE_FROM_TRACE)
		expect(artifact?.identity.providerFamily).toBe(UNAVAILABLE_FROM_TRACE)
		expect(artifact?.identity.effectiveContextBudgetTokens).toBe(UNAVAILABLE_FROM_TRACE)
		// The runtime profile and the schema version are KNOWN by the
		// capture itself.
		expect(artifact?.identity.runtimeProfile).toBe("dogfood")
		expect(artifact?.identity.captureSchemaVersion).toBe("cline.roundc-latency-trace.v1")
	})

	it("ID.2: the CONFIGURED model id is recorded as CONFIGURED, never as served", () => {
		setRoundcLatencyTraceEnabled(true)
		const sink = observeRoundcCaptureIdentity(installRoundcLatencyTraceSink("session-qual01") as ModelBehaviorTraceSink)
		expect(sink).toBeDefined()

		// The production seam reports the CONFIGURED provider and model.
		sink?.onProviderRequestSubmitted?.({
			payload: {
				providerId: "openai-compatible",
				modelId: "qwen3.8-flash-next-iq3_s",
			},
		})

		const artifact = buildRoundcLatencyTraceArtifact()
		expect(artifact?.identity.providerFamily).toBe("openai-compatible")
		expect(artifact?.identity.requestedModelId).toBe("qwen3.8-flash-next-iq3_s")
		expect(artifact?.identity.requestedModelIdSource).toBe("CONFIGURED")
		// The EFFECTIVE (served) model id was NEVER reported, so it stays
		// unavailable — the requested id is NOT substituted for it.
		expect(artifact?.identity.effectiveModelId).toBe(UNAVAILABLE_FROM_TRACE)
		expect(artifact?.identity.effectiveModelIdSource).toBe("UNAVAILABLE_FROM_TRACE")
		// The quantization is NEVER inferred from the model id, even
		// though that id contains "iq3".
		expect(artifact?.identity.quantization).toBe(UNAVAILABLE_FROM_TRACE)
		expect(artifact?.identity.quantizationSource).toBe("UNAVAILABLE_FROM_TRACE")
	})

	it("ID.3: the EFFECTIVE context budget is taken from the production compaction resolver", () => {
		setRoundcLatencyTraceEnabled(true)
		const sink = observeRoundcCaptureIdentity(installRoundcLatencyTraceSink("session-qual01") as ModelBehaviorTraceSink)
		expect(sink).toBeDefined()

		// The production compaction resolver published the effective
		// budget for THIS request.
		sink?.onCompactionDiagnostics?.({
			payload: {
				effectiveMaxInputTokens: 115200,
				compactionInitiated: false,
			},
		})

		const artifact = buildRoundcLatencyTraceArtifact()
		expect(artifact?.identity.effectiveContextBudgetTokens).toBe(115200)
	})

	it("ID.4: the effective reasoning settings are taken from the effective-model-config channel", () => {
		setRoundcLatencyTraceEnabled(true)
		const sink = observeRoundcCaptureIdentity(installRoundcLatencyTraceSink("session-qual01") as ModelBehaviorTraceSink)
		expect(sink).toBeDefined()

		sink?.onEffectiveModelConfig?.({
			payload: {
				thinkingEnabled: true,
				reasoningEffort: "high",
				maxOutputTokens: 8192,
			},
		})

		const artifact = buildRoundcLatencyTraceArtifact()
		expect(artifact?.identity.thinkingEnabled).toBe(true)
		expect(artifact?.identity.reasoningEffort).toBe("high")
		expect(artifact?.identity.maxOutputTokens).toBe(8192)
	})

	it("ID.5: a NEW session starts with a NEW identity — no cross-session attribution", () => {
		setRoundcLatencyTraceEnabled(true)
		const first = observeRoundcCaptureIdentity(installRoundcLatencyTraceSink("session-A") as ModelBehaviorTraceSink)
		first?.onProviderRequestSubmitted?.({
			payload: { providerId: "openai-compatible", modelId: "model-A" },
		})
		expect(buildRoundcLatencyTraceArtifact()?.identity.requestedModelId).toBe("model-A")

		// A new session REPLACES the sink — and the identity with it.
		installRoundcLatencyTraceSink("session-B")
		const artifact = buildRoundcLatencyTraceArtifact()
		expect(artifact?.sessionId).toBe("session-B")
		expect(artifact?.identity.requestedModelId).toBe(UNAVAILABLE_FROM_TRACE)
	})

	it("ID.6: the identity record carries NO credential, prompt or content", () => {
		setRoundcLatencyTraceEnabled(true)
		const sink = observeRoundcCaptureIdentity(installRoundcLatencyTraceSink("session-qual01") as ModelBehaviorTraceSink)
		expect(sink).toBeDefined()

		sink?.onProviderRequestSubmitted?.({
			payload: {
				providerId: "openai-compatible",
				modelId: "model-A",
				// A hostile payload carrying content must NOT reach the
				// identity record.
				apiKey: "sk-SECRET-VALUE",
				authorization: "Bearer SECRET-TOKEN",
				prompt: "the user's private prompt",
				command: "rm -rf /",
			},
		})

		const artifact = buildRoundcLatencyTraceArtifact()
		const serialized = JSON.stringify(artifact?.identity)
		expect(serialized).not.toContain("sk-SECRET-VALUE")
		expect(serialized).not.toContain("SECRET-TOKEN")
		expect(serialized).not.toContain("private prompt")
		expect(serialized).not.toContain("rm -rf")
		// The identity is a FLAT record of identifiers, digests, counts and
		// bounded classifications — no free-form content field.
		expect(Object.keys(artifact?.identity ?? {}).length).toBeGreaterThan(0)
	})

	it("ID.7: the PUBLIC profile installs NO sink and NO identity — zero state-semantic delta", () => {
		// The diagnostic is OFF: the public profile.
		setRoundcLatencyTraceEnabled(false)
		const sink = installRoundcLatencyTraceSink("session-qual01")
		expect(sink).toBeUndefined()
		expect(buildRoundcLatencyTraceArtifact()).toBeUndefined()
	})
})
