/**
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (AMENDMENT-01).
 *
 * THE OCCUPANCY AUTHORITY AND THE OUTPUT PARTITION AUTHORITY.
 *
 * ## WHAT THIS WITNESS DRIVES
 * ---------------------------
 * The REAL production readers:
 *
 *   - `readPhysicalRequestOccupancy()` — the PRODUCTION reader of the
 *     middleware-owned occupancy authority, exercised directly with the
 *     adversarial marker shapes;
 *   - `addUsage()` — the PRODUCTION aggregation fold that establishes the
 *     aggregate's output partition.
 *
 * ## THE ADVERSARIAL CONTROLS
 * ---------------------------
 *   A1  a PRESENT-but-INVALID marker is an EXPLICIT DENIAL, never the
 *       LEGACY absence (which would let the AGGREGATE EXPENDITURE become
 *       the CONTEXT OCCUPANCY);
 *   A1  an INVALID cardinality stays UNKNOWN — it is never synthesized;
 *   A1  an INDEPENDENTLY ESTABLISHED cardinality survives a denial;
 *   A3  an INVALID partition (a visible output that does not reconstruct the
 *       total, a negative part, a reasoning count larger than the total) is
 *       DENIED, and the TOTAL is conserved;
 *   A3.1 an INCOMPLETE aggregate must not regain a complete breakdown from a
 *       constituent attempt's retained raw payload.
 *
 * No provider request leaves the machine. No paid inference.
 */

import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { normalizeUsage } from "../ai-sdk";
import {
	addUsage,
	PHYSICAL_REQUEST_OCCUPANCY_METADATA_KEY,
	PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE,
	readPhysicalRequestOccupancy,
} from "./retry-empty-response";

const OCCUPANCY_KEY = PHYSICAL_REQUEST_OCCUPANCY_METADATA_KEY;
const OCCUPANCY_NAMESPACE = PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE;

/** A finish part's `providerMetadata` carrying the given marker. */
function marker(value: unknown): Record<string, unknown> {
	return {
		[OCCUPANCY_NAMESPACE]: {
			[OCCUPANCY_KEY]: value,
		},
	};
}

describe("ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (AMENDMENT-01) — occupancy authority", () => {
	it("A1: a TRULY ABSENT marker keeps the LEGACY single-request shape", () => {
		// No `cline` namespace at all.
		expect(readPhysicalRequestOccupancy({})).toBeUndefined();
		expect(readPhysicalRequestOccupancy(undefined)).toBeUndefined();
		expect(readPhysicalRequestOccupancy("not-an-object")).toBeUndefined();
		// The namespace is present but the KEY is absent.
		expect(
			readPhysicalRequestOccupancy({ [OCCUPANCY_NAMESPACE]: {} }),
		).toBeUndefined();
		// A provider's OWN namespace is not the middleware's namespace.
		expect(
			readPhysicalRequestOccupancy({
				anthropic: {
					[OCCUPANCY_KEY]: { state: "known", value: 1, attemptCount: 2 },
				},
			}),
		).toBeUndefined();
	});

	it("A1: a PRESENT-but-INVALID marker is an EXPLICIT DENIAL, never an absence", () => {
		// The reviewer observed these four erasing a present-but-invalid
		// authority into the absent legacy shape, which re-enabled the
		// aggregate fallback.
		for (const invalid of [null, false, 42, "occupied", [], true]) {
			const read = readPhysicalRequestOccupancy(marker(invalid));
			expect(read).toBeDefined();
			expect(read?.state).toBe("unknown");
			// A denial carries NO occupancy value: the consumer must not be
			// able to read an occupancy out of it.
			expect(read?.value).toBeUndefined();
		}
	});

	it("A1: an UNKNOWN cardinality stays unknown and is never synthesized", () => {
		// The cardinalities that are NOT a valid count: absent, zero,
		// negative, fractional and non-finite.
		const unknownCardinalities: unknown[] = [
			undefined,
			0,
			-1,
			1.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			"3",
			null,
		];
		for (const attemptCount of unknownCardinalities) {
			const read = readPhysicalRequestOccupancy(
				marker({ state: "unknown", attemptCount }),
			);
			expect(read?.state).toBe("unknown");
			// NOT a synthesized 1: the cardinality is UNKNOWN.
			expect(read?.attemptCount).toBeUndefined();
		}
	});

	it("A1: an INDEPENDENTLY ESTABLISHED cardinality survives a denial", () => {
		// A contradictory record (`single` with three attempts) cannot
		// establish an occupancy, but the cardinality it independently
		// established is a fact and must not be erased into a fabricated 1.
		const contradictory = readPhysicalRequestOccupancy(
			marker({ state: "single", attemptCount: 3 }),
		);
		expect(contradictory?.state).toBe("unknown");
		expect(contradictory?.attemptCount).toBe(3);

		// A `known` record with an INVALID value is denied, and its
		// cardinality survives.
		const invalidValue = readPhysicalRequestOccupancy(
			marker({ state: "known", value: 0, attemptCount: 3 }),
		);
		expect(invalidValue?.state).toBe("unknown");
		expect(invalidValue?.attemptCount).toBe(3);
		expect(invalidValue?.value).toBeUndefined();
	});

	it("A1: the VALID single-attempt and multi-attempt authorities are preserved", () => {
		// A valid SINGLE attempt: the aggregate IS the request's occupancy.
		expect(
			readPhysicalRequestOccupancy(
				marker({ state: "single", attemptCount: 1 }),
			),
		).toEqual({ state: "single", attemptCount: 1 });

		// A valid MULTI-attempt authority with an established served
		// measurement: THAT measurement is the occupancy.
		expect(
			readPhysicalRequestOccupancy(
				marker({ state: "known", value: 1_500, attemptCount: 3 }),
			),
		).toEqual({ state: "known", value: 1_500, attemptCount: 3 });
	});
});

describe("ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (AMENDMENT-01) — output partition", () => {
	/** A usage record whose breakdown is described by the given parts. */
	function usageWithPartition(input: {
		total: number;
		reasoning?: number;
		text?: number;
		raw?: unknown;
	}): LanguageModelV4Usage {
		return {
			inputTokens: { total: 100 },
			outputTokens: {
				total: input.total,
				...(input.reasoning !== undefined
					? { reasoning: input.reasoning }
					: {}),
				...(input.text !== undefined ? { text: input.text } : {}),
			},
			...(input.raw !== undefined ? { raw: input.raw } : {}),
		} as LanguageModelV4Usage;
	}

	// A second attempt whose breakdown is ALSO established, so the fold's
	// completeness test has two established sides.
	const COMPLETE = usageWithPartition({ total: 0, text: 0, reasoning: 0 });

	it("A3: an INVALID partition is DENIED and the TOTAL is conserved", () => {
		// The reviewer's three invalid partitions, which the predecessor
		// accepted as complete.
		const invalidPartitions = [
			// 100 + 700 = 800 != 900
			usageWithPartition({ total: 900, text: 100, reasoning: 700 }),
			// the reasoning exceeds the total
			usageWithPartition({ total: 900, reasoning: 1_000 }),
			// a negative part
			usageWithPartition({ total: 900, reasoning: -1 }),
		];
		for (const partition of invalidPartitions) {
			const sum = addUsage(partition, COMPLETE);
			// The TOTAL is conserved exactly.
			expect(sum.outputTokens.total).toBe(900);
			// The partition is NOT published.
			expect(sum.outputTokens.reasoning).toBeUndefined();
			expect(sum.outputTokens.text).toBeUndefined();
		}
	});

	it("A3: a VALID partition is published and reconstructs the total", () => {
		const sum = addUsage(
			usageWithPartition({ total: 900, text: 100, reasoning: 800 }),
			COMPLETE,
		);
		expect(sum.outputTokens.total).toBe(900);
		expect(sum.outputTokens.reasoning).toBe(800);
		expect(sum.outputTokens.text).toBe(100);
		expect(
			(sum.outputTokens.text ?? 0) + (sum.outputTokens.reasoning ?? 0),
		).toBe(sum.outputTokens.total);
	});

	it("A3.1: an INCOMPLETE aggregate must not regain a breakdown from a constituent", () => {
		// The three attempts of the A3.1 witness:
		//
		//   attempt 1: total 900, reasoning 800
		//   attempt 2: total 900, reasoning UNREPORTED
		//   served:    total 900, reasoning 700
		//
		// The aggregate's reasoning was NEVER established: attempt 2
		// reported none. The aggregate's TOTAL is 2,700 and its breakdown
		// must stay UNAVAILABLE.
		const attempt1 = usageWithPartition({
			total: 900,
			raw: { reasoning_tokens: 800 },
		});
		const attempt2 = usageWithPartition({
			total: 900,
			raw: { output_tokens_details: {} },
		});
		const served = usageWithPartition({
			total: 900,
			raw: { reasoning_tokens: 700 },
		});

		// The production fold: the discarded attempt is folded INTO the
		// accumulated side, whose scope becomes an aggregate.
		let aggregate = addUsage(attempt2, served, { b: "aggregate" });
		aggregate = addUsage(attempt1, aggregate, {
			a: "attempt",
			b: "aggregate",
		});

		// The TOTAL is conserved exactly.
		expect(aggregate.outputTokens.total).toBe(2_700);
		// The breakdown is UNAVAILABLE: it must NOT be re-acquired from the
		// retained raw payload, which describes the SERVED attempt alone.
		expect(aggregate.outputTokens.reasoning).toBeUndefined();
		expect(aggregate.outputTokens.text).toBeUndefined();
	});

	it("A3.1: a COMPLETE aggregate keeps its partition and the raw fallback survives", () => {
		// Every attempt reports the same breakdown: the aggregate's
		// partition IS established.
		const attempt = usageWithPartition({
			total: 900,
			raw: { reasoning_tokens: 800 },
		});
		// The production fold: the discarded attempt is folded INTO the
		// accumulated side. On the FIRST fold the accumulated side is the
		// served ATTEMPT; on every later fold it is the AGGREGATE built so
		// far.
		let aggregate = addUsage(attempt, attempt);
		aggregate = addUsage(attempt, aggregate, {
			a: "attempt",
			b: "aggregate",
		});
		expect(aggregate.outputTokens.total).toBe(2_700);
		expect(aggregate.outputTokens.reasoning).toBe(2_400);
		expect(aggregate.outputTokens.text).toBe(300);
		expect(
			(aggregate.outputTokens.text ?? 0) +
				(aggregate.outputTokens.reasoning ?? 0),
		).toBe(aggregate.outputTokens.total);
	});

	it("A3.2: an EXPLICIT ZERO reasoning count is published; an ABSENT one is not", () => {
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A3.2).
		//
		// The provider stating "this response carried no reasoning tokens" is
		// a REPORTED ZERO, which is a different fact from a provider that
		// does not report the metric at all. The publication uses the
		// validated PRESENCE, so the zero survives.
		const explicitZero = normalizeUsage({
			inputTokens: 100,
			outputTokens: 900,
			outputTokenDetails: { reasoningTokens: 0 },
		} as never);
		expect(explicitZero.reasoningTokenCount).toBe(0);

		// An ABSENT metric stays absent: the key is not published at all.
		const absent = normalizeUsage({
			inputTokens: 100,
			outputTokens: 900,
		} as never);
		expect(absent.reasoningTokenCount).toBeUndefined();
	});
});
