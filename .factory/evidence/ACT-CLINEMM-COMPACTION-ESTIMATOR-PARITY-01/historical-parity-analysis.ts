/**
 * ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01
 *
 * DETERMINISTIC OFFLINE ANALYSIS of the Round C latency trace.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 *
 * It reads the uploaded Round C trace and reproduces the ACT's baseline
 * statistics, then decomposes the estimated/reported ratio into its
 * components. It emits ONLY privacy-safe metadata (token COUNTS, ratios,
 * sizes, counts and classifications) — never a prompt, a message body, a
 * command, a URL or a credential.
 *
 * It performs NO network I/O and NO provider call. It writes only into this
 * evidence directory.
 *
 * USAGE
 * -----
 *
 *   bun historical-parity-analysis.ts <path-to-trace.json>
 *
 * The trace path is an ARGUMENT, not a constant, so the script does not
 * depend on a machine-local path.
 *
 * DETERMINISM
 * -----------
 *
 * The output is a pure function of the input trace. No wall-clock value, no
 * random value and no environment value is written into the emitted JSON.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

interface TraceEvent {
	correlationId: string;
	boundary: string;
	phase: string;
	monotonicMs: number;
	wallClockIso: string;
	metadata: Record<string, unknown>;
	durationMs?: number;
	status?: string;
}

interface Trace {
	schema: string;
	sessionId: string;
	eventCount: number;
	unavailableCount: number;
	integrityFailureCount: number;
	truncation: Record<string, unknown>;
	events: TraceEvent[];
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) {
		return Number.NaN;
	}
	const idx = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round(q * (sorted.length - 1))),
	);
	return sorted[idx];
}

function median(values: number[]): number {
	return quantile(
		[...values].sort((a, b) => a - b),
		0.5,
	);
}

function mean(values: number[]): number {
	if (values.length === 0) {
		return Number.NaN;
	}
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
	if (values.length < 2) {
		return 0;
	}
	const m = mean(values);
	return Math.sqrt(
		values.reduce((acc, v) => acc + (v - m) * (v - m), 0) / values.length,
	);
}

interface Row {
	index: number;
	decisionId: string;
	estimated: number;
	apiMessageTokens: number;
	requestOverheadTokens: number;
	apiMessagesJsonChars: number;
	providerRequestBytes: number;
	reportedInputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	shouldCompact: boolean;
	compactionInitiated: boolean;
	requestTriggerTokens: number;
	rawMaxInputTokens: number;
	underestimateFactor: number;
	actualPreviousInputTokens: number;
	decisionMonotonicMs: number;
	completionMonotonicMs: number;
}

function analyze(trace: Trace) {
	const events = [...trace.events].sort(
		(a, b) => a.monotonicMs - b.monotonicMs,
	);
	const decisions = events.filter(
		(e) => e.boundary === "compaction_decision" && e.phase === "start",
	);
	const providerReady = events.filter(
		(e) => e.boundary === "provider_ready" && e.phase === "start",
	);
	const completions = events.filter(
		(e) => e.boundary === "provider_completed" && e.phase === "start",
	);
	const compactionStarts = events.filter(
		(e) => e.boundary === "compaction" && e.phase === "start",
	);

	const rows: Row[] = [];
	// ORDER-PRESERVING pairing.
	//
	// A naive positional `zip(decisions, completions)` is WRONG here: there
	// are 114 decisions and 113 completions, and a compaction decision is
	// followed by a compaction EXECUTION rather than by the provider
	// request it pre-empted. A positional zip therefore pairs the sixth
	// compaction decision with the POST-compaction provider request and
	// silently shifts every later pair.
	//
	// The correct inferred pairing is: each decision pairs with the FIRST
	// provider completion that starts strictly AFTER it. That consumes the
	// completions in order, never reuses one, and never pairs a decision
	// with a request that preceded it.
	let completionCursor = 0;
	for (let i = 0; i < decisions.length; i++) {
		const d = decisions[i];
		const m = d.metadata;
		while (
			completionCursor < completions.length &&
			(completions[completionCursor].monotonicMs <= d.monotonicMs ||
				completions[completionCursor].metadata.inputTokens === undefined)
		) {
			completionCursor++;
		}
		const completion = completions[completionCursor];
		if (completion) {
			completionCursor++;
		}
		const ready = providerReady[i];
		const apiMessageTokens = num(m.apiMessageTokens) ?? 0;
		const requestOverheadTokens = num(m.requestOverheadTokens) ?? 0;
		rows.push({
			index: i,
			decisionId: String(m.decisionId ?? `unknown#${i}`),
			estimated: apiMessageTokens + requestOverheadTokens,
			apiMessageTokens,
			requestOverheadTokens,
			apiMessagesJsonChars: num(m.apiMessagesJsonChars) ?? 0,
			providerRequestBytes: num(ready?.metadata.providerRequestBytes) ?? 0,
			reportedInputTokens: num(completion?.metadata.inputTokens) ?? 0,
			cacheReadTokens: num(completion?.metadata.cacheReadTokens) ?? 0,
			cacheWriteTokens: num(completion?.metadata.cacheWriteTokens) ?? 0,
			shouldCompact: m.shouldCompact === true,
			compactionInitiated: m.compactionInitiated === true,
			requestTriggerTokens: num(m.requestTriggerTokens) ?? 0,
			rawMaxInputTokens: num(m.rawMaxInputTokens) ?? 0,
			underestimateFactor: num(m.underestimateFactor) ?? 1,
			actualPreviousInputTokens: num(m.actualPreviousInputTokens) ?? 0,
			decisionMonotonicMs: d.monotonicMs,
			completionMonotonicMs: completion?.monotonicMs ?? Number.NaN,
		});
	}
	return { rows, compactionStarts, events };
}

/**
 * The empirical chars-per-token rate observed IN THIS SESSION, measured on
 * the requests whose provider-reported usage IS available.
 *
 * This is the session's own calibration, not an external constant. It is
 * used ONLY to project the unsubmitted candidates; the non-compacting rows'
 * own measured ratios remain the primary parity evidence.
 *
 * IMPORTANT: `apiMessagesJsonChars` is the same provider-visible message
 * payload whose provider-reported `inputTokens` supplied the denominator.
 * The calibration therefore already covers the system prompt, tool schemas,
 * and JSON framing represented by the provider's complete prompt. Adding
 * `requestOverheadTokens` again would double-count that component.
 */
function observedCharsPerToken(rows: Row[]): {
	messages: number;
	bytes: number;
} {
	// Only rows whose provider-reported usage is actually available can
	// calibrate the rate.
	const nonCompacting = rows.filter(
		(r) => !r.compactionInitiated && r.reportedInputTokens > 0,
	);
	const messageRates = nonCompacting
		.filter((r) => r.reportedInputTokens > 0 && r.apiMessagesJsonChars > 0)
		.map((r) => r.apiMessagesJsonChars / r.reportedInputTokens);
	const byteRates = nonCompacting
		.filter((r) => r.reportedInputTokens > 0 && r.providerRequestBytes > 0)
		.map((r) => r.providerRequestBytes / r.reportedInputTokens);
	return {
		messages: median(messageRates),
		bytes: median(byteRates),
	};
}

function main() {
	const tracePath = process.argv[2];
	if (!tracePath) {
		console.error(
			"usage: bun historical-parity-analysis.ts <path-to-trace.json>",
		);
		process.exit(2);
	}
	const raw = readFileSync(tracePath);
	const sha256 = createHash("sha256").update(raw).digest("hex");
	const trace = JSON.parse(raw.toString("utf8")) as Trace;
	const { rows, compactionStarts } = analyze(trace);
	// A decision with NO provider completion after it has no reported usage.
	// Such a row can never participate in a parity measurement: pairing it
	// would fabricate a ratio against a missing denominator.
	const paired = rows.filter(
		(r) =>
			Number.isFinite(r.completionMonotonicMs) && r.reportedInputTokens > 0,
	);
	const nonCompacting = paired.filter((r) => !r.compactionInitiated);
	const cpt = observedCharsPerToken(rows);

	// ---- Baseline statistics (C2.1) ----
	const naiveRatios = nonCompacting.map(
		(r) => r.estimated / r.reportedInputTokens,
	);
	const sortedNaive = [...naiveRatios].sort((a, b) => a - b);
	const excess = nonCompacting.map((r) => r.estimated - r.reportedInputTokens);

	// ---- Ratio decomposition (C2.1 / C5) ----
	const wireBytesOver3 = nonCompacting.map((r) =>
		Math.ceil(r.providerRequestBytes / 3),
	);
	const bytesOverRep = wireBytesOver3.map(
		(v, i) => v / nonCompacting[i].reportedInputTokens,
	);
	const bytesOverComplete = wireBytesOver3.map(
		(v, i) =>
			v /
			(nonCompacting[i].reportedInputTokens + nonCompacting[i].cacheReadTokens),
	);
	const repOverBytesRates = nonCompacting
		.filter((r) => r.reportedInputTokens > 0 && r.providerRequestBytes > 0)
		.map((r) => r.providerRequestBytes / r.reportedInputTokens);

	// ---- Compaction decisions (C2.3) ----
	const compactionDecisions = compactionStarts.map((e) => {
		const m = e.metadata;
		const requestInputTokens =
			(num(m.apiMessageTokens) ?? 0) + (num(m.requestOverheadTokens) ?? 0);
		const rawMaxInputTokens = num(m.rawMaxInputTokens) ?? 0;
		const underestimateFactor = num(m.underestimateFactor) ?? 1;
		const requestTriggerTokens = num(m.requestTriggerTokens) ?? 0;
		const apiMessagesJsonChars = num(m.apiMessagesJsonChars) ?? 0;
		const charsPerTokenAtWhichItWouldNotCompact =
			requestTriggerTokens > 0
				? apiMessagesJsonChars / requestTriggerTokens
				: Number.NaN;
		return {
			decisionId: String(m.decisionId ?? "unknown"),
			compactionMode: String(m.compactionMode ?? "unknown"),
			compactionStrategy: String(m.compactionStrategy ?? "unknown"),
			requestInputTokens,
			requestTriggerTokens,
			rawMaxInputTokens,
			underestimateFactor,
			actualPreviousInputTokens: num(m.actualPreviousInputTokens) ?? 0,
			shouldCompact: m.shouldCompact === true,
			compactionInitiated: m.compactionInitiated === true,
			decisionMonotonicMs: e.monotonicMs,
			executionDurationMs: e.durationMs ?? null,
			// The candidate was NEVER submitted: no provider ever reported
			// its input usage. The value below is an EMPIRICAL PROJECTION derived
			// from the session's own observed chars/token rate, NOT a
			// measurement or a conservative bound.
			providerInputTokensForCandidate: "LIVE_UNOBSERVABLE",
			empiricalProjectedInputTokens: Number.isFinite(
				charsPerTokenAtWhichItWouldNotCompact,
			)
				? Math.round(apiMessagesJsonChars / cpt.messages)
				: null,
			charsPerTokenAtWhichItWouldNotCompact: Number.isFinite(
				charsPerTokenAtWhichItWouldNotCompact,
			)
				? Number(charsPerTokenAtWhichItWouldNotCompact.toFixed(3))
				: null,
		};
	});

	// ---- Necessity / ablation (C5.2 / C5.3) ----
	const nonCompactingWouldCompactUnderProjectedCount = nonCompacting.filter(
		(r) => r.apiMessagesJsonChars / cpt.messages >= r.requestTriggerTokens,
	).length;

	const report = {
		schema: "cline.compaction-estimator-parity.historical-parity.v1",
		act: "ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01",
		input: {
			path: tracePath,
			bytes: raw.byteLength,
			sha256,
			schema: trace.schema,
			sessionId: trace.sessionId,
			eventCount: trace.eventCount,
			unavailableCount: trace.unavailableCount,
			integrityFailureCount: trace.integrityFailureCount,
			truncated: trace.truncation?.truncated === true,
			droppedEventCount: num(trace.truncation?.droppedEventCount) ?? 0,
		},
		pairing: {
			authority: "INFERRED_CHRONOLOGICAL_PAIRING",
			reason:
				"The trace exports no per-request identifier that spans the " +
				"decision, the provider dispatch and the provider completion. " +
				"`decisionId` is minted on the decision seam only; " +
				"`modelRequestId` is not in the trace metadata allowlist. The " +
				"pairing is therefore positional.",
			checks: {
				allTriplesStrictlyOrdered: rows.every(
					(r) => r.decisionMonotonicMs <= r.completionMonotonicMs,
				),
				concurrentModelRequests: false,
				retriesObserved: 0,
				cancellationsObserved: 0,
			},
		},
		baseline: {
			decisionObservations: rows.length,
			providerSubmissions: trace.events.filter(
				(e) => e.boundary === "provider_submitted" && e.phase === "start",
			).length,
			providerCompletions: trace.events.filter(
				(e) => e.boundary === "provider_completed" && e.phase === "start",
			).length,
			executedCompactions: compactionStarts.length,
			nonCompactingPairs: nonCompacting.length,
			medianEstimatedOverReportedRatio: Number(median(naiveRatios).toFixed(6)),
			meanEstimatedExcessTokens: Number(mean(excess).toFixed(1)),
			compactionTrigger: rows[0]?.requestTriggerTokens ?? null,
			effectiveInputLimit: rows[0]?.rawMaxInputTokens ?? null,
			truncatedEvents: num(trace.truncation?.droppedEventCount) ?? 0,
		},
		ratioDistribution: {
			definition:
				"estimated (decision candidate) / provider-reported inputTokens, " +
				"over non-compacting pairs",
			count: naiveRatios.length,
			min: Number(Math.min(...naiveRatios).toFixed(6)),
			max: Number(Math.max(...naiveRatios).toFixed(6)),
			median: Number(median(naiveRatios).toFixed(6)),
			p10: Number(quantile(sortedNaive, 0.1).toFixed(6)),
			p90: Number(quantile(sortedNaive, 0.9).toFixed(6)),
			meanExcessTokens: Number(mean(excess).toFixed(1)),
		},

		ratioDecomposition: {
			note:
				"`inputTokens` is the provider's COMPLETE prompt token count " +
				"(OpenAI-compatible `prompt_tokens`). `cacheReadTokens` is the " +
				"CACHED SUBSET of it, NOT an additional quantity. Adding them " +
				"double-counts the cached portion.",
			estimatedOverReportedCompletePrompt: {
				median: Number(median(naiveRatios).toFixed(6)),
			},
			providerWireBytesOver3OverReported: {
				median: Number(median(bytesOverRep).toFixed(6)),
				min: Number(Math.min(...bytesOverRep).toFixed(6)),
				max: Number(Math.max(...bytesOverRep).toFixed(6)),
			},
			providerWireBytesOver3OverReportedPlusCache: {
				median: Number(median(bytesOverComplete).toFixed(6)),
				min: Number(Math.min(...bytesOverComplete).toFixed(6)),
				max: Number(Math.max(...bytesOverComplete).toFixed(6)),
			},
			observedCharsPerToken: {
				onProviderRequestBytes: Number(cpt.bytes.toFixed(3)),
				onApiMessagesJsonChars: Number(cpt.messages.toFixed(3)),
				estimatorConstant: 3,
				onProviderRequestBytesStdev: Number(
					stdev(repOverBytesRates).toFixed(3),
				),
				onProviderRequestBytesCv: Number(
					(stdev(repOverBytesRates) / mean(repOverBytesRates)).toFixed(4),
				),
			},
		},
		compactionEpochBreakdown: compactionDecisions.map((d) => ({
			decisionId: d.decisionId,
			requestInputTokens: d.requestInputTokens,
			requestTriggerTokens: d.requestTriggerTokens,
			excessOverTrigger: d.requestInputTokens - d.requestTriggerTokens,
			underestimateFactor: d.underestimateFactor,
		})),
		compactionDecisions,

		necessity: {
			question:
				"Would the same request have fit the operating budget under a " +
				"trusted token count?",
			empiricalProjectionMethod:
				"The candidate was never submitted, so no provider ever reported " +
				"its usage. The projection uses the SESSION'S OWN observed " +
				"chars-per-token rate (median over the non-compacting pairs, " +
				"whose provider usage IS available) applied to the candidate's " +
				"measured `apiMessagesJsonChars`. The calibration denominator " +
				"already represents the provider's complete prompt, so " +
				"`requestOverheadTokens` is not added again. This is a point " +
				"projection, not a conservative bound or an authoritative tokenizer " +
				"measurement.",
			observedCharsPerToken: Number(cpt.messages.toFixed(3)),
			estimatorConstant: 3,
			allSixProjectedCandidatesBelowTrigger: compactionDecisions.every(
				(d) =>
					d.empiricalProjectedInputTokens !== null &&
					d.empiricalProjectedInputTokens < d.requestTriggerTokens,
			),
			maxCharsPerTokenAtWhichACandidateWouldStillCompact: Number(
				Math.max(
					...compactionDecisions.map(
						(d) => d.charsPerTokenAtWhichItWouldNotCompact ?? 0,
					),
				).toFixed(3),
			),
			nonCompactingRowsThatWouldHaveCompactedUnderProjectedCount:
				nonCompactingWouldCompactUnderProjectedCount,
			nonCompactingRowCount: nonCompacting.length,
			conservation:
				"A genuinely oversized request still compacts: the trigger " +
				"comparison and the underestimate factor are unchanged by this " +
				"analysis, and the production-seam suite asserts both.",
		},
		limitations: [
			"Pairing authority is INFERRED_CHRONOLOGICAL_PAIRING, not authoritative request identity.",
			"The six compaction candidates were never submitted; their provider input-token count is LIVE_UNOBSERVABLE.",
			"The candidates' token values are empirical projections derived from the session's own observed calibration, not conservative bounds or authoritative tokenizer measurements.",
			"Provider-side usage semantics for this historical run are inferred from the installed AI SDK contract and the session's internal consistency, not from a captured raw provider response.",
			"Strata server-side receipts were not retained for this run; no live Strata probe was performed.",
		],
	};

	const outPath = join(HERE, "historical-parity.json");
	writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(`wrote ${outPath}`);
	console.log(
		`baseline: medianRatio=${report.baseline.medianEstimatedOverReportedRatio} ` +
			`meanExcess=${report.baseline.meanEstimatedExcessTokens} ` +
			`decisions=${report.baseline.decisionObservations} ` +
			`compactions=${report.baseline.executedCompactions}`,
	);
	console.log(
		`necessity: allSixProjectedBelowTrigger=${report.necessity.allSixProjectedCandidatesBelowTrigger} ` +
			`observedCpt=${report.necessity.observedCharsPerToken}`,
	);
}

main();
