import { describe, it } from "bun:test"
import { strict as assert } from "node:assert"
import type { ClineMessage } from "../ExtensionMessage"
import { getApiMetrics, getLastApiReqContextInputTokens, getLastApiReqTotalTokens } from "../getApiMetrics"

describe("getApiMetrics", () => {
	it("includes subagent_usage in aggregate totals", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 10,
					tokensOut: 20,
					cacheWrites: 3,
					cacheReads: 1,
					cost: 0.12,
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify({
					source: "subagents",
					tokensIn: 4,
					tokensOut: 8,
					cacheWrites: 2,
					cacheReads: 1,
					cost: 0.05,
				}),
			},
			{
				ts: 3,
				type: "say",
				say: "deleted_api_reqs",
				text: JSON.stringify({
					tokensIn: 6,
					tokensOut: 9,
					cacheWrites: 1,
					cacheReads: 0,
					cost: 0.03,
				}),
			},
		]

		const metrics = getApiMetrics(messages)

		assert.equal(metrics.totalTokensIn, 20)
		assert.equal(metrics.totalTokensOut, 37)
		assert.equal(metrics.totalCacheWrites, 6)
		assert.equal(metrics.totalCacheReads, 2)
		assert.ok(Math.abs(metrics.totalCost - 0.2) < 1e-9)
	})

	it("ignores malformed usage payloads", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "subagent_usage",
				text: "{not-json",
			},
		]

		const metrics = getApiMetrics(messages)
		assert.equal(metrics.totalTokensIn, 0)
		assert.equal(metrics.totalTokensOut, 0)
		assert.equal(metrics.totalCost, 0)
	})
})

describe("getLastApiReqTotalTokens", () => {
	it("uses only the latest api_req_started payload", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify({
					source: "subagents",
					tokensIn: 100,
					tokensOut: 200,
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 11,
					tokensOut: 7,
					cacheWrites: 2,
					cacheReads: 3,
				}),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 23)
	})

	it("scales the last request by the shrink ratio of a compaction completed after it", () => {
		// The compaction counters are the SDK's estimate — a different scale from
		// the provider-reported request total. Only the ratio carries over.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 90_000, tokensOut: 5_000, cacheReads: 5_000 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 200_000, tokensAfter: 50_000 }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 25_000)
	})

	it("compounds multiple compactions completed since the last request", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 100_000 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 200_000, tokensAfter: 100_000 }),
			},
			{
				ts: 3,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 100_000, tokensAfter: 50_000 }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 25_000)
	})

	it("grows the request total when a compaction made the estimated context larger", () => {
		// Compacting a tiny conversation can produce a summary bigger than the
		// original messages. The header must follow the divider's direction
		// instead of freezing at the pre-compaction value.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 4_000, tokensOut: 1_000 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 1_000, tokensAfter: 1_300 }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 6_500)
	})

	it("leaves the request total unscaled when a completed compaction lacks token counters", () => {
		// The coordinator's fallback divider carries only message counts.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 40_000, tokensOut: 2_000 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", messagesBefore: 40, messagesAfter: 6 }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 42_000)
	})

	it("returns 0 when a compaction completed but no request preceded it", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 95_000, tokensAfter: 30_000 }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 0)
	})

	it("ignores compaction rows without a usable compacted size", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 11, tokensOut: 7, cacheWrites: 2, cacheReads: 3 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "started", mode: "auto" }),
			},
			{
				ts: 3,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "failed", mode: "auto" }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 23)
	})

	it("prefers a request newer than the last compaction", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "auto", tokensBefore: 95_000, tokensAfter: 30_000 }),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 31_000, tokensOut: 1_000 }),
			},
		]

		const total = getLastApiReqTotalTokens(messages)
		assert.equal(total, 32_000)
	})
})

describe("getLastApiReqContextInputTokens", () => {
	it("returns tokensIn + cacheReads + cacheWrites from the last api_req_started payload", () => {
		// ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 (CORRECTION01): the UI's
		// context-occupancy projection must read the provider-normalized
		// context-input token count (the AI SDK `inputTokens.total` contract:
		// `tokensIn + cacheReads + cacheWrites`) — i.e. the actual prompt size
		// that competed for the model's window on the last request. Output
		// tokens are deliberately excluded (they describe the previous
		// response, not the current request's input occupancy).
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "subagent_usage",
				text: JSON.stringify({
					source: "subagents",
					tokensIn: 100,
					tokensOut: 200,
				}),
			},
			{
				ts: 2,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 11,
					tokensOut: 7,
					cacheWrites: 2,
					cacheReads: 3,
				}),
			},
		]

		// 11 + 2 + 3 = 16
		assert.equal(getLastApiReqContextInputTokens(messages), 16)
	})

	it("OpenAI-compatible inclusive cache accounting: tokensIn already contains the cached subset", () => {
		// Provider #11037 / OpenAI-compatible semantic: the upstream
		// `prompt_tokens` (which becomes `tokensIn` after
		// `normalizeUsageEvent`) already includes the cached tokens as the
		// *uncached* portion: the AI SDK OpenAI-compat adapter emits
		// `noCache = prompt_tokens - cached_tokens`. The fork's producer seam
		// therefore produces disjoint buckets whose sum equals the original
		// inclusive `prompt_tokens`. The helper sums them back to recover
		// that inclusive total — the size of the prompt that competed for
		// the model's window.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					// noCache = prompt_tokens - cached_tokens = 297402 - 148167 = 149235
					tokensIn: 149_235,
					tokensOut: 8_000,
					cacheWrites: 0,
					cacheReads: 148_167,
				}),
			},
		]

		// Inclusive prompt size = 149_235 + 0 + 148_167 = 297_402.
		// This is NOT a double-count: after `normalizeUsageEvent`, the
		// three buckets are disjoint and the sum is the original
		// `prompt_tokens` (== AI SDK `inputTokens.total`).
		assert.equal(getLastApiReqContextInputTokens(messages), 297_402)
		assert.equal(getLastApiReqTotalTokens(messages), 305_402)
	})

	it("Anthropic-native exclusive cache accounting: tokensIn excludes the cached subset", () => {
		// Anthropic prompt caching semantic: `input_tokens` (which becomes
		// `tokensIn` after `normalizeUsageEvent`) contains only the uncached
		// input. `cache_read_input_tokens` and `cache_creation_input_tokens`
		// are reported separately. The helper therefore sums all three
		// disjoint buckets to recover the actual context-input size that
		// competed for the window.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 50,
					tokensOut: 30,
					cacheWrites: 0,
					cacheReads: 100_000,
				}),
			},
		]

		// 50 + 0 + 100_000 = 100_050 (Anthropic's documented total).
		assert.equal(getLastApiReqContextInputTokens(messages), 100_050)
	})

	it("Anthropic cache creation: cacheWrites contribute to context-input size", () => {
		// `cache_creation_input_tokens` adds to context input on creation.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 200,
					tokensOut: 50,
					cacheWrites: 12_500,
					cacheReads: 0,
				}),
			},
		]

		// 200 + 12_500 + 0 = 12_700
		assert.equal(getLastApiReqContextInputTokens(messages), 12_700)
	})

	it("tokensOut never contributes to context-input occupancy", () => {
		// Output tokens describe the previous response. They must never
		// inflate the numerator regardless of size.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					tokensIn: 10,
					tokensOut: 500_000,
					cacheWrites: 0,
					cacheReads: 0,
				}),
			},
		]

		assert.equal(getLastApiReqContextInputTokens(messages), 10)
		assert.equal(getLastApiReqTotalTokens(messages), 500_010)
	})

	it("rescales the context-input total by the shrink ratio of a compaction completed after it", () => {
		// The compaction counters are the SDK's estimate — a different scale
		// from the provider-reported request total. Only the ratio carries
		// over.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 90_000, tokensOut: 5_000, cacheReads: 5_000 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 200_000, tokensAfter: 50_000 }),
			},
		]

		// (90_000 + 0 + 5_000) * (50_000 / 200_000) = 95_000 * 0.25 = 23_750
		assert.equal(getLastApiReqContextInputTokens(messages), 23_750)
	})

	// R0-A — HEADER POST-COMPACTION PROJECTION (PROJECTION_FORMULA_BOUND)
	//
	// ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01 §6 R0-A
	// (factory causal reviewer 2026-09-02, recon step 1; superseded by
	// R0' on 2026-09-02 — see ACT §6 R0' / R0' note).
	//
	// WITNESS, not defect oracle:
	// The production rescaling formula is:
	//
	//   header = ceil(lastRequestInput * (tokensAfter / tokensBefore))
	//
	// For the LIVE-symptom input observed in ClineMM:
	//
	//   lastRequestInput = 167_100
	//   tokensBefore     = 680_100
	//   tokensAfter      = 28_900
	//
	// the function returns ceil(167_100 * (28_900 / 680_100))
	//                       = ceil(7_100.7)
	//                       = 7_101
	//
	// matching the observed header value (~7.1k) within rounding noise.
	//
	// This is arithmetic bind only. It does NOT establish that the
	// projection is semantically valid. The validity of the projection
	// depends on whether the calibration factor
	// (lastRequestInput / tokensBefore) is stable across the two
	// payloads it compares — a question that requires either a real
	// provider run (R0') or a code-trace recon (see ACT §6 R0').
	//
	// R0-B and R0-C from commit 2916fb9fd were HALT_RED_NOT_REPRODUCED
	// by the factory causal reviewer (2026-09-02). The "permitted
	// values" list asserted by R0-B was not an independently established
	// production invariant. The doc-comment-vs-behavior claim of R0-C
	// is contradicted by the doc comment's own text ("rescaled by any
	// completed compactions"). Both tests removed.
	//
	// R0' — COMPACTION INPUT IDENTITY — now supersedes R0-B and is the
	// load-bearing next discriminator. See ACT §6 R0' for the new
	// question and ACT §7/§8 for the updated classification / stop
	// rule.
	it("[R0-A] rescaling reproduces the LIVE-symptom header value (~7.1k)", () => {
		// PROJECTION_FORMULA_BOUND / LIVE_ARITHMETIC_BIND_PROVEN.
		// Documentary only; this is NOT a defect oracle.
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensIn: 167_100, tokensOut: 8_000, cacheReads: 0, cacheWrites: 0 }),
			},
			{
				ts: 2,
				type: "say",
				say: "compaction",
				text: JSON.stringify({
					status: "completed",
					mode: "auto",
					tokensBefore: 680_100,
					tokensAfter: 28_900,
				}),
			},
		]

		// (167_100 + 0 + 0) * (28_900 / 680_100) = 167_100 * 0.04249 ≈ 7_100.7
		// ceil(7_100.7) = 7_101
		assert.equal(getLastApiReqContextInputTokens(messages), 7_101)
	})

	it("returns 0 when no api_req_started message exists", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "compaction",
				text: JSON.stringify({ status: "completed", mode: "manual", tokensBefore: 95_000, tokensAfter: 30_000 }),
			},
		]

		assert.equal(getLastApiReqContextInputTokens(messages), 0)
	})

	it("returns 0 when the api_req_started payload has no tokensIn", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({ tokensOut: 500 }),
			},
		]

		assert.equal(getLastApiReqContextInputTokens(messages), 0)
	})

	it("ignores malformed api_req_started payloads", () => {
		const messages: ClineMessage[] = [
			{
				ts: 1,
				type: "say",
				say: "api_req_started",
				text: "{not-json",
			},
		]

		assert.equal(getLastApiReqContextInputTokens(messages), 0)
	})
})
