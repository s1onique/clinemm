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

	it("keeps the last request's genuine total when a compaction divider postdates it (no ratio transfer across scales)", () => {
		// Strategy-D: the compaction counters are on the SDK estimator scale
		// (chars/4-class), not the provider-reported request scale. Multiplying
		// the genuine prior provider observation by `tokensAfter/tokensBefore`
		// synthesized a wrong-scale value. The repair makes the consumer
		// return the genuine prior observation unchanged, and let the next
		// request's real usage supersede it. See
		// ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01 §
		// "Frozen RED for the post-fix regression oracle" and the function
		// doc-comment in getApiMetrics.ts for the full rationale.
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
		// Genuine prior total: 90_000 + 5_000 + 0 + 5_000 = 100_000.
		// Pre-repair (buggy HEAD): 25_000 (the wrong-scale ratio
		// was applied). Post-repair: 100_000 (truthful).
		assert.equal(total, 100_000)
	})

	it("does not compound multiple compactions into the last request total (post-repair behavior)", () => {
		// Strategy-D: the consumer returns the genuine prior provider
		// observation unchanged, regardless of how many compaction
		// dividers postdate it. Compaction ratios are not transferred
		// across scales; there is nothing to "compound".
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
		// Genuine prior total: 100_000. Pre-repair (buggy HEAD): 25_000
		// ((100k → 50% → 50%) of 100k, compounded twice). Post-repair:
		// 100_000 (no transfer, no compounding).
		assert.equal(total, 100_000)
	})

	it("does not grow the request total when a compaction made the estimated context larger (post-repair: stale but truthful)", () => {
		// Compacting a tiny conversation can produce a summary bigger than
		// the original messages, so the post-compaction divisor ratio can
		// exceed 1. Pre-repair: the header would multiply by 1.3,
		// yielding 6_500 (a synthesized larger value). Post-repair: the
		// consumer returns the genuine pre-compaction value unchanged.
		// The header now displays a stale pre-compaction value until the
		// next request's real usage lands; that is truthful (not
		// synthesized), and the next request supersedes it (G3).
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
		// Genuine prior total: 4_000 + 1_000 + 0 + 0 = 5_000.
		// Pre-repair (buggy HEAD): 6_500 (4_000 * 1.3 + 1_000 * 1.3,
		// etc., i.e. 5_000 * 1.3 = 6_500). Post-repair: 5_000.
		assert.equal(total, 5_000)
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

	it("keeps the context-input total at the genuine prior observation when a compaction divider postdates it (Strategy-D: no ratio transfer across scales)", () => {
		// Strategy-D mirror of `getLastApiReqTotalTokens`: the consumer must
		// not synthesize a wrong-scale rescaled context-input value. The
		// prior genuine `tokensIn + cacheReads + cacheWrites` is returned
		// unchanged, regardless of any compaction ratio. See the function
		// doc-comment in getApiMetrics.ts and the repair ACT § G2 (regression
		// oracle). The disjoint-bucket semantics are preserved (G5).
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

		// Genuine context-input total: 90_000 + 0 + 5_000 = 95_000.
		// Pre-repair (buggy HEAD): 23_750 (95_000 * 0.25, wrong-scale
		// synthesis). Post-repair: 95_000.
		assert.equal(getLastApiReqContextInputTokens(messages), 95_000)
	})

	// R0-A — LIVE-SYMPTOM FORENSIC WITNESS (re-purposed post-repair)
	//
	// ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01 §6 R0-A
	// (factory causal reviewer 2026-09-02, recon step 1; superseded by
	// R0' on 2026-09-02 — see ACT §6 R0' / R0' note).
	//
	// Pre-repair, R0-A asserted that the buggy HEAD consumer at the
	// LIVE-symptom input produced the fabricated header value (~7.1k)
	// matching the observed header:
	//
	//   lastRequestInput = 167_100
	//   tokensBefore     = 680_100
	//   tokensAfter      = 28_900
	//
	//   buggy output = ceil(167_100 * (28_900 / 680_100))
	//                = ceil(7_100.7)
	//                = 7_101
	//
	// That arithmetic binding is preserved here as a WITNESS
	// (PRODUCTION_FORMULA_BIND), but the assertion now inverts the
	// invariant: post-repair the consumer must NOT synthesize the
	// fabricated wrong-scale value. The genuine prior provider
	// observation (167_100, plus any cache buckets) is returned
	// unchanged, regardless of subsequent compaction dividers.
	//
	// R0-A no longer demonstrates the LIVE-symptom; instead, it now
	// witnesses that the consumer's post-repair output on those exact
	// numbers is NOT the projected synthesized value. This is the same
	// G2 invariant with the original LIVE numbers, kept for forensic
	// continuity with the recon.
	//
	// R0-B and R0-C from commit 2916fb9fd were HALT_RED_NOT_REPRODUCED
	// by the factory causal reviewer (2026-09-02). The "permitted
	// values" list asserted by R0-B was not an independently established
	// production invariant. The doc-comment-vs-behavior claim of R0-C
	// is contradicted by the doc comment's own text ("rescaled by any
	// completed compactions"). Both tests removed.
	//
	// R0' — COMPACTION INPUT IDENTITY — was the load-bearing next
	// discriminator (see ACT §6 R0'); see also
	// ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01 §
	// "Frozen RED for the post-fix regression oracle" which is now the
	// authoritative repair oracle (G2 above; same invariant).
	it("[R0-A] consumer does not synthesize the LIVE-symptom wrong-scale value (~7.1k) post-repair", () => {
		// PRODUCTION_FORMULA_BIND / POST-REPAIR NOT_FABRICATED.
		// The genuine prior provider observation must be returned
		// unchanged; the rescaling that previously matched the LIVE
		// header (~7.1k) is removed.
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

		// Genuine context-input total: 167_100 + 0 + 0 = 167_100.
		// Pre-repair (buggy HEAD): 7_101 (the LIVE-observed fabricated
		// value). Post-repair: 167_100 (genuine prior observation).
		// Forensic note: the rescaling that previously matched the
		// LIVE symptom has been REMOVED; the consumer no longer
		// produces 7_101 in this configuration. The LIVE-symptom
		// header itself, observed in production, WAS this projected
		// value; the post-repair header on the same input returns
		// 167_100 instead (stale pre-compaction value, not synthesized).
		assert.equal(getLastApiReqContextInputTokens(messages), 167_100)
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

	// G2 — CONSUMER-SEAM REPAIR ORACLE
	//   ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01 §
	//   "Frozen RED for the post-fix regression oracle".
	//
	// Honest shape (per factory causal reviewer 2026-09-02):
	//   Given an incompatible baseline (compaction telemetry
	//   tokensBefore/tokensAfter is on the SDK estimator scale,
	//   a different scale from the provider-reported usage that
	//   drives previousProviderInput), getApiMetrics must NOT
	//   manufacture a synthesized post-compaction request-input
	//   value:
	//
	//     fabricated = previousProviderInput * tokensAfter/tokensBefore
	//
	//   At buggy HEAD, this assertion FAILS because the consumer
	//   currently synthesizes exactly that value.
	//
	//   After Strategy-D repair, this assertion PASSES — the
	//   consumer returns the truthful (genuine, unchanged) prior
	//   provider observation rather than fabricating a rescaled
	//   value on the wrong scale.
	//
	// G2 deliberately does NOT pre-judge the post-repair value
	// (it does not assert a specific number); it only asserts
	// that the consumer does not synthesize a wrong-scale value.
	it("[G2] does not synthesize a post-compaction request-input value by multiplying prior provider observation by the compaction H-space ratio", () => {
		const previousProviderInput = 100_000
		const previousRequest = {
			ts: 1,
			type: "say" as const,
			say: "api_req_started" as const,
			text: JSON.stringify({ tokensIn: previousProviderInput }),
		}
		const compactionDivider = {
			ts: 2,
			type: "say" as const,
			say: "compaction" as const,
			text: JSON.stringify({
				status: "completed",
				mode: "manual",
				tokensBefore: 1_000_000,
				tokensAfter: 1_000,
			}),
		}

		const messages: ClineMessage[] = [previousRequest, compactionDivider]

		const fabricated = Math.ceil((previousProviderInput * 1_000) / 1_000_000)
		const actual = getLastApiReqContextInputTokens(messages)

		// Genuine unchanged value (100_000) differs from fabricated
		// (100); the two outcomes are not the same — the repair
		// choice matters, so G2 is not a tautology.
		assert.notEqual(previousProviderInput, fabricated)
		// The repair oracle itself: the consumer must NOT
		// synthesize the wrong-scale fabricated value.
		assert.notEqual(actual, fabricated)
	})

	// G3 — GENUINE TRUTH RESTORATION
	//   When a NEW api_req_started arrives AFTER the compaction
	//   divider, the consumer must use the new provider observation
	//   as the genuine post-compaction truth. No retroactive ratio
	//   is applied to the new observation. Strategy D walks the
	//   messages from the end and returns the first api_req_started
	//   payload's disjoint-bucket sum.
	it("[G3] uses the post-compaction api_req_started observation as ground truth (no retroactive ratio)", () => {
		const preCompactRequest = {
			ts: 1,
			type: "say" as const,
			say: "api_req_started" as const,
			text: JSON.stringify({ tokensIn: 90_000 }),
		}
		const compactionDivider = {
			ts: 2,
			type: "say" as const,
			say: "compaction" as const,
			text: JSON.stringify({
				status: "completed",
				mode: "manual",
				tokensBefore: 1_000_000,
				tokensAfter: 1_000,
			}),
		}
		const postCompactRequest = {
			ts: 3,
			type: "say" as const,
			say: "api_req_started" as const,
			text: JSON.stringify({ tokensIn: 123_456 }),
		}

		const messages: ClineMessage[] = [preCompactRequest, compactionDivider, postCompactRequest]
		assert.equal(getLastApiReqContextInputTokens(messages), 123_456)
	})

	// G4 — POSITIVE COMPATIBILITY
	//   When no compaction has occurred at all, the consumer returns
	//   the genuine prior provider observation, unchanged. This is
	//   the "truncation-doesn't-engage regime" — there's no ratio
	//   to apply and no fabrication to suppress.
	it("[G4] returns the genuine prior provider observation when no compaction has occurred", () => {
		const request = {
			ts: 1,
			type: "say" as const,
			say: "api_req_started" as const,
			text: JSON.stringify({ tokensIn: 90_000, cacheReads: 5_000 }),
		}
		assert.equal(getLastApiReqContextInputTokens([request]), 95_000)
	})

	// G5 — PRESENTATION CONSERVATION
	//   The shared input contract (`tokensIn + cacheReads +
	//   cacheWrites`) is preserved by Strategy D — it modifies
	//   only the ratio-removal decision, not the disjoint-bucket
	//   semantics. cacheReads and cacheWrites continue to flow
	//   through the sum.
	it("[G5] preserves disjoint cacheReads/cacheWrites contribution (presentation conservation)", () => {
		const request = {
			ts: 1,
			type: "say" as const,
			say: "api_req_started" as const,
			text: JSON.stringify({ tokensIn: 80_000, cacheReads: 12_000, cacheWrites: 8_000 }),
		}
		// 80_000 + 12_000 + 8_000 = 100_000 — the disjoint-bucket
		// semantic total is preserved (no ratio, no rescale; just
		// the disjoint sum).
		assert.equal(getLastApiReqContextInputTokens([request]), 100_000)
	})
})
