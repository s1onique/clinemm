#!/usr/bin/env bun
/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R4) — LIVE
 * configuration probe.
 *
 * PURPOSE
 * -------
 * Establish, against the REAL providers, the ACTUAL wire-level reasoning
 * configuration for each of the four discriminator variants:
 *
 *   M3-A   MiniMax M3, thinking disabled
 *   M3-B   MiniMax M3, adaptive thinking
 *   M3.1-A MiniMax M3.1-Flash, explicit `low` effort
 *   M3.1-B MiniMax M3.1-Flash, explicit `max` effort
 *
 * This is a CONFIGURATION PROBE, not the full benchmark: it makes ONE short
 * request per variant and records the serialized request's reasoning controls
 * plus the provider's response observations.
 *
 * WHAT IS REAL HERE
 * -----------------
 *   - The REAL provider gateway (@cline/llms).
 *   - The REAL MiniMax and OpenRouter APIs.
 *   - The REAL serialized HTTP request body.
 *   - The REAL provider response and its usage metadata.
 *
 * WHAT IS NOT RECORDED
 * --------------------
 *   No prompt text, no reasoning content, no tool arguments, no credentials.
 *   The request body is reduced to its reasoning control fields BEFORE it is
 *   recorded.
 *
 * USAGE
 * -----
 *   cd apps/vscode
 *   bun src/dev/preflight/live-minimax-reasoning-wire-probe.ts \
 *     --out /tmp/clinemm-minimax-wire
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createGateway } from "@cline/llms"
import type { GatewayStreamRequest } from "@cline/shared"

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`)
	if (index === -1) {
		return undefined
	}
	const value = process.argv[index + 1]
	return value && !value.startsWith("--") ? value : undefined
}

const OUT_DIR = arg("out") ?? "/tmp/clinemm-minimax-wire"
const SECRETS_PATH = arg("secrets") ?? `${process.env.HOME}/.cline/data/secrets.json`
const PROMPT = "Reply with the single word: ok"

type Variant = {
	label: string
	providerId: string
	modelId: string
	apiKey: string
	reasoning: GatewayStreamRequest["reasoning"]
}

type WireObservation = {
	variant: string
	providerId: string
	modelId: string
	requestedThinking: string
	requestedReasoningEffort?: string
	wireThinkingMode?: string
	wireReasoningEffort?: string
	wireOutputConfigEffort?: string
	wireReasoningEnabled?: boolean
	wireReasoningExcluded?: boolean
	wireOutputTokenLimit?: number
	normalizationResult: "preserved" | "transformed" | "dropped" | "unsupported"
	protocol: "anthropic" | "openai" | "responses"
	response: {
		ok: boolean
		error?: string
		finishReason?: string
		outputTokens?: number
		providerReportedReasoningTokens?: number
		reasoningContentPresent: boolean
		reasoningContentBytes: number
		durationMs: number
	}
}

function readReasoningMode(thinking: unknown): string {
	return typeof thinking === "boolean" ? (thinking ? "on" : "off") : "unset"
}

/**
 * The reasoning control fields of a SERIALIZED request body. This is the
 * only part of the body that is ever recorded.
 */
function observeWire(body: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {}
	const thinking = body.thinking
	if (thinking && typeof thinking === "object") {
		const type = (thinking as Record<string, unknown>).type
		if (typeof type === "string") {
			result.wireThinkingMode = type
		}
	}
	const reasoning = body.reasoning
	if (reasoning && typeof reasoning === "object") {
		const record = reasoning as Record<string, unknown>
		if (typeof record.effort === "string") {
			result.wireReasoningEffort = record.effort
		}
		if (typeof record.enabled === "boolean") {
			result.wireReasoningEnabled = record.enabled
		}
		if (typeof record.exclude === "boolean") {
			result.wireReasoningExcluded = record.exclude
		}
	}
	const outputConfig = body.output_config
	if (outputConfig && typeof outputConfig === "object") {
		const effort = (outputConfig as Record<string, unknown>).effort
		if (typeof effort === "string") {
			result.wireOutputConfigEffort = effort
		}
	}
	for (const key of ["max_tokens", "max_output_tokens", "max_completion_tokens"]) {
		const value = body[key]
		if (typeof value === "number") {
			result.wireOutputTokenLimit = value
			break
		}
	}
	return result
}

async function main(): Promise<void> {
	const secrets = JSON.parse(await readFile(SECRETS_PATH, "utf8")) as Record<string, string>
	const minimaxKey = secrets.minimaxApiKey
	if (!minimaxKey) {
		throw new Error("Missing minimaxApiKey in the secrets file.")
	}

	const variants: Variant[] = [
		{
			label: "M3-A",
			providerId: "minimax",
			modelId: "MiniMax-M3",
			apiKey: minimaxKey,
			reasoning: { enabled: false },
		},
		{
			label: "M3-B",
			providerId: "minimax",
			modelId: "MiniMax-M3",
			apiKey: minimaxKey,
			reasoning: { enabled: true },
		},
		{
			label: "M3.1-A",
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			apiKey: minimaxKey,
			reasoning: { enabled: true, effort: "low" },
		},
		{
			label: "M3.1-B",
			providerId: "minimax",
			modelId: "minimax-m3.1-flash",
			apiKey: minimaxKey,
			reasoning: { enabled: true, effort: "max" },
		},
	]

	await mkdir(OUT_DIR, { recursive: true })
	const observations: WireObservation[] = []

	for (const variant of variants) {
		let capturedBody: Record<string, unknown> | undefined
		const captureFetch = (async (input, init) => {
			if (typeof init?.body === "string") {
				try {
					capturedBody = JSON.parse(init.body) as Record<string, unknown>
				} catch {
					capturedBody = undefined
				}
			}
			return fetch(input, init)
		}) as typeof fetch

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: variant.providerId,
					apiKey: variant.apiKey,
					fetch: captureFetch,
					baseUrl: "https://api.minimax.io/anthropic/v1",
				},
			],
		})

		const startedAt = Date.now()
		const observation: WireObservation = {
			variant: variant.label,
			providerId: variant.providerId,
			modelId: variant.modelId,
			requestedThinking: readReasoningMode(variant.reasoning?.enabled),
			...(variant.reasoning?.effort ? { requestedReasoningEffort: variant.reasoning.effort } : {}),
			normalizationResult: "unsupported",
			protocol: "anthropic",
			response: {
				ok: false,
				reasoningContentPresent: false,
				reasoningContentBytes: 0,
				durationMs: 0,
			},
		}

		try {
			const stream = await gateway.stream({
				providerId: variant.providerId,
				modelId: variant.modelId,
				messages: [
					{
						id: "probe-1",
						role: "user",
						content: [{ type: "text", text: PROMPT }],
						createdAt: Date.now(),
					},
				],
				maxTokens: 64,
				reasoning: variant.reasoning,
			})

			let finishReason: string | undefined
			let outputTokens: number | undefined
			let providerReportedReasoningTokens: number | undefined
			let reasoningContentBytes = 0
			for await (const event of stream) {
				if (event.type === "reasoning-delta") {
					reasoningContentBytes += event.text?.length ?? 0
				}
				if (event.type === "usage") {
					outputTokens = event.usage.outputTokens
					providerReportedReasoningTokens = event.usage.reasoningTokenCount
				}
				if (event.type === "finish") {
					finishReason = event.reason
				}
			}

			observation.response = {
				ok: true,
				...(finishReason ? { finishReason } : {}),
				...(outputTokens !== undefined ? { outputTokens } : {}),
				...(providerReportedReasoningTokens !== undefined ? { providerReportedReasoningTokens } : {}),
				reasoningContentPresent: reasoningContentBytes > 0,
				reasoningContentBytes,
				durationMs: Date.now() - startedAt,
			}
		} catch (error) {
			observation.response = {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				reasoningContentPresent: false,
				reasoningContentBytes: 0,
				durationMs: Date.now() - startedAt,
			}
		}

		const wire = observeWire(capturedBody ?? {})
		Object.assign(observation, wire)
		// The normalization result is derived from what actually reached the
		// wire, not from what was requested.
		if (wire.wireOutputConfigEffort === variant.reasoning?.effort || wire.wireReasoningEffort === variant.reasoning?.effort) {
			observation.normalizationResult = "preserved"
		} else if (wire.wireThinkingMode !== undefined) {
			observation.normalizationResult = "transformed"
		} else if (variant.reasoning?.enabled === false) {
			observation.normalizationResult = "dropped"
		} else {
			observation.normalizationResult = "unsupported"
		}

		observations.push(observation)
		console.log(`[probe] ${variant.label}: wire=${JSON.stringify(wire)} response=${JSON.stringify(observation.response)}`)
	}

	await writeFile(join(OUT_DIR, "wire-observations.json"), `${JSON.stringify(observations, null, 2)}\n`, "utf8")
	console.log(`[probe] wrote ${join(OUT_DIR, "wire-observations.json")}`)
}

await main()
