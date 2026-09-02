import { ClineMessage } from "./ExtensionMessage"

interface ApiMetrics {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
}

/**
 * Calculates API metrics from an array of ClineMessages.
 *
 * This function processes usage-carrying say messages.
 * It includes:
 * - 'api_req_started' messages that have been combined with their corresponding 'api_req_finished' messages
 * - 'deleted_api_reqs' messages, which are aggregated from deleted messages
 * - 'subagent_usage' messages, which are aggregated usage snapshots emitted by subagent batches
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns An ApiMetrics object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, and totalCost.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = getApiMetrics(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function getApiMetrics(messages: ClineMessage[]): ApiMetrics {
	const result: ApiMetrics = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
	}

	messages.forEach((message) => {
		if (
			message.type === "say" &&
			(message.say === "api_req_started" || message.say === "deleted_api_reqs" || message.say === "subagent_usage") &&
			message.text
		) {
			try {
				const parsedData = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, cost } = parsedData

				if (typeof tokensIn === "number") {
					result.totalTokensIn += tokensIn
				}
				if (typeof tokensOut === "number") {
					result.totalTokensOut += tokensOut
				}
				if (typeof cacheWrites === "number") {
					result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
				}
				if (typeof cacheReads === "number") {
					result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
				}
				if (typeof cost === "number") {
					result.totalCost += cost
				}
			} catch {
				// Ignore JSON parse errors
			}
		}
	})

	return result
}

/**
 * Gets the total token count from the last API request.
 *
 * This is used for context window progress display - it shows how much of the
 * context window is used in the current/most recent request, not cumulative totals.
 *
 * Returns the **genuine, last-known provider-reported total** from the most
 * recent `api_req_started` message. A later `compaction` divider that
 * postdates the request does NOT trigger any rescaling: the compaction's
 * `tokensAfter/tokensBefore` ratio is on the SDK estimator scale (chars/4-class),
 * which is not the same scale as the provider-reported usage that drives this
 * value. Multiplying the provider observation by that ratio would produce a
 * fabricated wrong-scale value (the live symptom: a 167,100 prior input
 * collapsing to ~7,101 after a 0.0425× ratio, with the bar showing the
 * fabricated number until the next request lands). See ACT-CLINEMM-COMPACTION-
 * TOKEN-RESCALING-CONSUMER-REPAIR01 § "Frozen RED for the post-fix regression
 * oracle" / G2 in `__tests__/getApiMetrics.test.ts` for the regression witness.
 *
 * The honest behavior is to retain the prior genuine observation and let the
 * next request's real usage land. Until then the bar shows a stale
 * pre-compaction value; that is truthful (it is not a synthesized estimate),
 * and the next request supersedes it. Repair ACT § G3 establishes this exact
 * contract.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns The total tokens (tokensIn + tokensOut + cacheWrites + cacheReads) from the last api_req_started message, or 0 if none found.
 */
export function getLastApiReqTotalTokens(messages: ClineMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type !== "say" || !msg.text) {
			continue
		}
		if (msg.say === "api_req_started") {
			try {
				const { tokensIn, tokensOut, cacheWrites, cacheReads } = JSON.parse(msg.text)
				const total = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				if (total > 0) {
					return total
				}
			} catch {
				// Ignore JSON parse errors, continue searching
			}
		}
	}
	return 0
}

/**
 * Gets the provider-normalized context-input token count from the last API request.
 *
 * This is the **provider-independent** semantic quantity that should drive the
 * UI's context-occupancy bar (e.g. the percentage shown in the TaskHeader
 * context indicator). It is computed as
 *
 *     tokensIn + cacheReads + cacheWrites
 *
 * where `tokensIn`, `cacheReads`, and `cacheWrites` are the **disjoint** buckets
 * emitted by the producer seam in
 * `apps/vscode/src/sdk/message-translator.ts::normalizeUsageEvent`
 * (input is split into uncached, cache-read, and cache-write components).
 *
 * This matches the AI SDK's `inputTokens.total` contract: both
 * `@ai-sdk/anthropic` (which emits
 * `inputTokens.total = usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens`)
 * and `@ai-sdk/openai-compatible` (which emits
 * `inputTokens.total = usage.prompt_tokens` with
 * `noCache = prompt_tokens - cached_tokens`) converge on the same inclusive
 * total. It is **not** the billed request activity
 * (`tokensIn + tokensOut + cacheWrites + cacheReads`) — output tokens describe
 * the previous response, not the current request's input occupancy.
 *
 * Distinct from {@link getLastApiReqTotalTokens}: that one sums all four
 * counters and is suitable only for cost / activity telemetry, not for the
 * context-window percentage.
 *
 * Like {@link getLastApiReqTotalTokens}, this function does NOT rescale by
 * the compaction's `tokensAfter/tokensBefore` ratio. Same rationale: the ratio
 * is on the SDK estimator scale, not the provider scale; multiplying produces
 * a synthesized wrong-scale value. The honest behavior is to return the
 * genuine prior provider observation unchanged, and let the next request's
 * real usage supersede it. Repair ACT § G2/G3 establish this contract; see
 * `__tests__/getApiMetrics.test.ts` for the regression oracle.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns The provider-normalized context-input token count
 *   (`tokensIn + cacheReads + cacheWrites`) from the last `api_req_started`
 *   message, or 0 if none found.
 */
export function getLastApiReqContextInputTokens(messages: ClineMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type !== "say" || !msg.text) {
			continue
		}
		if (msg.say === "api_req_started") {
			try {
				const { tokensIn, cacheReads, cacheWrites } = JSON.parse(msg.text)
				if (typeof tokensIn !== "number") {
					continue
				}
				const reads = typeof cacheReads === "number" ? cacheReads : 0
				const writes = typeof cacheWrites === "number" ? cacheWrites : 0
				const total = tokensIn + reads + writes
				if (total > 0) {
					return total
				}
			} catch {
				// Ignore JSON parse errors, continue searching
			}
		}
	}
	return 0
}
