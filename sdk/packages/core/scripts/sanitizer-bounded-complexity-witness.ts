/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01
 *
 * C2.1 — THE CORRECTED SANITIZER BOUNDED-COMPLEXITY WITNESS.
 *
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C8 — THE SANITIZER BOUNDED-COMPLEXITY WITNESS.
 *
 * ============================================================================
 * WHAT IT ESTABLISHES
 * ============================================================================
 *
 * The ACT requires that the SELECTED CANDIDATE cannot introduce an unbounded
 * synchronous sanitization, and that the evidence is measured in an
 * INDEPENDENTLY TERMINABLE process. A `Promise.race` against a timeout does
 * NOT do that: the sanitization is SYNCHRONOUS, so a timeout cannot interrupt
 * it — the event loop is blocked for the whole of the backtracking.
 *
 * So the witness runs the sanitization in a CHILD PROCESS and measures it
 * there. The parent can terminate the child, so the measurement is bounded
 * in the only way that matters.
 *
 * ============================================================================
 * THE THREE CASES
 * ============================================================================
 *
 *   1. LONG NON-MATCHING INPUT. The known catastrophic case: a long run of a
 *      single repeated character with no match. The production sanitizer is
 *      known to backtrack catastrophically on it.
 *   2. RELEVANT MATCHING INPUT. A long body that DOES contain a credential.
 *      The sanitizer must terminate and must redact.
 *   3. ADVERSARIAL BOUNDARY CASES. Many near-matches: each contains a
 *      secret-shaped KEY but no value, so the value-position pattern has to
 *      backtrack past each one.
 *
 * ============================================================================
 * WHAT THE WITNESS IS FOR
 * ============================================================================
 *
 * It is NOT the repair of the production sanitizer — that is the independent
 * work item `ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01`.
 *
 * It establishes that the SELECTED CANDIDATE bounds its OWN input before the
 * sanitizer sees it, so the candidate cannot INTRODUCE an unbounded
 * synchronous sanitization, and it QUANTIFIES the defect the candidate
 * inherits.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * THE INPUT LADDER.
 *
 * The ladder is the one the ACT names. Each rung is measured in the SAME
 * runtime, in the SAME child process, with the execution time measured
 * INSIDE the child so that process startup is excluded.
 *
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the ladder is
 * the REQUESTED ladder. It is recorded SEPARATELY from the length of the
 * input the child actually generated, because the generated length is not
 * necessarily the requested one (the PEM family generates a whole number of
 * markers, so its byte length differs from the requested length). A timing
 * claim must be attributable to a REQUESTED rung, not to an accident of the
 * generator.
 */
const INPUT_LADDER = [
	2_048, 8_192, 32_768, 51_200, 131_072, 524_288, 1_048_576,
];

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The screening limits. These are generous ENGINEERING limits, not latency
 * SLOs: the repair's purpose is to make the pathological behaviour
 * impossible, not to make the sanitizer fast.
 */
const LIMIT_50_KIB_MS = 100;
const LIMIT_1_MIB_MS = 1_000;

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The independent hard timeout the PARENT enforces on each child.
 *
 * This is NOT a `Promise.race` against a timer: the sanitization is
 * SYNCHRONOUS, so a timer cannot interrupt it — the child's event loop is
 * blocked for the whole of the backtracking. The parent must be able to
 * TERMINATE the child, and only a real child process can be terminated.
 */
const CHILD_TIMEOUT_MS = 10_000;

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The number of repetitions per ladder rung, in the same runtime.
 */
const REPETITIONS = 5;

if (process.argv[2] === "--child") {
	// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the child
	// loads the PRODUCTION sanitizer from the real TypeScript module.
	//
	// It is loaded through `jiti`, which is a PRODUCTION dependency of this
	// package (see `package.json`), because the sanitizer's module graph
	// reaches a TypeScript source file through an extensionless specifier
	// (`../../session/models/session-compaction`) that Node's own ESM
	// resolver cannot follow. The module under measurement is therefore the
	// SAME source file the extension host bundles — not a copy and not a
	// re-implementation.
	//
	// The measurement is taken INSIDE the child, so the child's startup cost
	// is excluded from the measurement of the sanitizer.
	const { createJiti } = await import("jiti");
	const jiti = createJiti(import.meta.url, { interopDefault: true });
	const modulePath = join(
		import.meta.dirname ?? ".",
		"../src/extensions/context/evidence-continuity.ts",
	);
	const { sanitizeOutcomeText } = (await jiti.import(modulePath)) as {
		sanitizeOutcomeText: (text: string) => string;
	};
	const mode = process.argv[3] ?? "nonmatching";
	const length = Number(process.argv[4] ?? "50000");
	let body: string;
	switch (mode) {
		case "nonmatching":
			body = "a".repeat(length);
			break;
		case "matching":
			body = `${"x".repeat(length)}\nDB_PASSWORD=hunter2\n`;
			break;
		case "adversarial":
			body = Array.from(
				{ length: Math.max(1, Math.floor(length / 20)) },
				(_, index) => `PASSWORD_${index}=not_a_value_here`,
			).join("\n");
			break;
		// ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01: the
		// PEM marker's lazy span was the SECOND pathological operation.
		case "pem-flood":
			body = "-----BEGIN RSA PRIVATE KEY-----".repeat(
				Math.max(1, Math.floor(length / 30)),
			);
			break;
		// The near-match shape: a secret-shaped KEY with a value, repeated.
		case "near-match":
			body = Array.from(
				{ length: Math.max(1, Math.floor(length / 20)) },
				(_, index) => `PASSWORD_${index}=v${index}`,
			).join("\n");
			break;
		default:
			console.error(`unknown mode: ${mode}`);
			process.exit(2);
	}
	// The execution time is measured INSIDE the child, so that the child's
	// startup cost is excluded from the measurement of the sanitizer.
	const samples: number[] = [];
	let result = "";
	for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
		const startedAt = process.hrtime.bigint();
		result = sanitizeOutcomeText(body);
		samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
	}
	const sorted = [...samples].sort((left, right) => left - right);
	process.stdout.write(
		JSON.stringify({
			mode,
			runtime: process.versions.node ?? process.versions.bun,
			// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the
			// REQUESTED length is recorded SEPARATELY from the GENERATED
			// length, so a timing claim is attributable to a requested rung.
			requestedLength: length,
			inputBytes: Buffer.byteLength(body, "utf8"),
			inputLength: body.length,
			medianMs: sorted[sorted.length >> 1],
			maxMs: sorted[sorted.length - 1],
			minMs: sorted[0],
			outputLength: result.length,
			redacted: !result.includes("hunter2"),
			secretSurvived: result.includes("hunter2"),
		}),
	);
	process.exit(0);
}

const CASES = [
	{ mode: "nonmatching", length: 50_000, timeoutMs: 5_000 },
	{ mode: "matching", length: 50_000, timeoutMs: 5_000 },
	{ mode: "adversarial", length: 50_000, timeoutMs: 5_000 },
	// The size the CANDIDATE actually admits: the per-fragment bound.
	{ mode: "nonmatching", length: 2_000, timeoutMs: 5_000 },
	{ mode: "matching", length: 2_000, timeoutMs: 5_000 },
	{ mode: "adversarial", length: 2_000, timeoutMs: 5_000 },
];

interface CaseResult {
	readonly mode: string;
	readonly length: number;
	readonly elapsedMs: number;
	readonly terminated: boolean;
	readonly redacted?: boolean;
	readonly outputLength?: number;
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The result of ONE ladder rung, as reported by the child.
 */
interface LadderRung {
	readonly mode: string;
	/**
	 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the
	 * REQUESTED rung of the ladder. This is the identity the timing claim
	 * is made against.
	 */
	readonly requestedLength: number;
	readonly inputBytes: number;
	readonly inputLength: number;
	readonly medianMs: number;
	readonly maxMs: number;
	readonly runtime: string;
	/**
	 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the
	 * OUTCOME of the rung, so that a WATCHDOG TERMINATION, a CHILD-PROCESS
	 * FAILURE and a MALFORMED MEASUREMENT are distinguishable from one
	 * another. The predecessor's cut collapsed all three into a single
	 * `terminated: true` boolean, so a child that crashed for an unrelated
	 * reason was indistinguishable from a watchdog termination.
	 */
	readonly outcome: LadderRungOutcome;
	readonly secretSurvived?: boolean;
}

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1)
 *
 * The distinguishable outcomes of a ladder rung.
 */
type LadderRungOutcome =
	/** The child completed and reported a well-formed measurement. */
	| "measured"
	/** The parent's watchdog fired: the child had to be SIGKILLed. */
	| "watchdog_terminated"
	/** The child exited without reporting a measurement (a crash). */
	| "child_failed"
	/** The child reported something that is not a valid measurement. */
	| "malformed_measurement";

function runCase(caseToRun: {
	mode: string;
	length: number;
	timeoutMs: number;
}): Promise<CaseResult> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				join(
					import.meta.dirname ?? ".",
					"sanitizer-bounded-complexity-witness.ts",
				),
				"--child",
				caseToRun.mode,
				String(caseToRun.length),
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		const startedAt = Date.now();
		let stdout = "";
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill("SIGKILL");
			resolve({
				mode: caseToRun.mode,
				length: caseToRun.length,
				elapsedMs: Date.now() - startedAt,
				terminated: true,
			});
		}, caseToRun.timeoutMs);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.on("close", () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			try {
				const parsed = JSON.parse(stdout) as {
					elapsedMs: number;
					redacted: boolean;
					outputLength: number;
				};
				resolve({
					mode: caseToRun.mode,
					length: caseToRun.length,
					elapsedMs: parsed.elapsedMs,
					terminated: false,
					redacted: parsed.redacted,
					outputLength: parsed.outputLength,
				});
			} catch {
				resolve({
					mode: caseToRun.mode,
					length: caseToRun.length,
					elapsedMs: Date.now() - startedAt,
					terminated: false,
				});
			}
		});
	});
}

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * Run ONE ladder rung in an independently terminable child process.
 *
 * The parent enforces an INDEPENDENT hard timeout and SIGKILLs the child
 * when it is exceeded. This is the only way to bound a SYNCHRONOUS
 * operation: a `Promise.race` against a timer cannot interrupt a blocked
 * event loop.
 *
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the outcome of
 * the rung is DISTINGUISHED. A watchdog termination, a child that exited
 * without a measurement, and a child that reported a malformed measurement
 * are three DIFFERENT facts, and the predecessor's cut reported all three
 * as the same `terminated: true`.
 */
function runLadderRung(mode: string, length: number): Promise<LadderRung> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				join(
					import.meta.dirname ?? ".",
					"sanitizer-bounded-complexity-witness.ts",
				),
				"--child",
				mode,
				String(length),
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill("SIGKILL");
			resolve({
				mode,
				requestedLength: length,
				inputBytes: length,
				inputLength: length,
				medianMs: Number.POSITIVE_INFINITY,
				maxMs: Number.POSITIVE_INFINITY,
				runtime: "unknown",
				outcome: "watchdog_terminated",
			});
		}, CHILD_TIMEOUT_MS);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.on("close", () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			let parsed: {
				mode: string;
				runtime: string;
				requestedLength: number;
				inputBytes: number;
				inputLength: number;
				medianMs: number;
				maxMs: number;
				secretSurvived: boolean;
			};
			try {
				parsed = JSON.parse(stdout) as typeof parsed;
			} catch {
				// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1):
				// the child produced NO parsable measurement. This is a
				// CHILD-PROCESS FAILURE, which is DISTINCT from a watchdog
				// termination: the watchdog did not fire, so the child
				// terminated on its own.
				resolve({
					mode,
					requestedLength: length,
					inputBytes: length,
					inputLength: length,
					medianMs: Number.POSITIVE_INFINITY,
					maxMs: Number.POSITIVE_INFINITY,
					runtime: "unknown",
					outcome: "child_failed",
				});
				return;
			}
			// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): a
			// measurement is only a measurement when it is COMPLETE. A
			// missing or non-numeric timing field is a MALFORMED
			// MEASUREMENT, not a fast run.
			const isWellFormed =
				typeof parsed.medianMs === "number" &&
				Number.isFinite(parsed.medianMs) &&
				typeof parsed.maxMs === "number" &&
				Number.isFinite(parsed.maxMs);
			if (!isWellFormed) {
				resolve({
					mode,
					requestedLength: length,
					inputBytes: length,
					inputLength: length,
					medianMs: Number.POSITIVE_INFINITY,
					maxMs: Number.POSITIVE_INFINITY,
					runtime: "unknown",
					outcome: "malformed_measurement",
				});
				return;
			}
			resolve({
				mode: parsed.mode,
				requestedLength: parsed.requestedLength ?? length,
				inputBytes: parsed.inputBytes,
				inputLength: parsed.inputLength,
				medianMs: parsed.medianMs,
				maxMs: parsed.maxMs,
				runtime: parsed.runtime,
				outcome: "measured",
				secretSurvived: parsed.secretSurvived,
			});
		});
	});
}

const results: CaseResult[] = [];
for (const caseToRun of CASES) {
	results.push(await runCase(caseToRun));
}

const CANDIDATE_FRAGMENT_CHAR_LIMIT = 2_000;
const candidateBounded = results.filter(
	(result) => result.length <= CANDIDATE_FRAGMENT_CHAR_LIMIT,
);
const candidateAllTerminated = candidateBounded.every(
	(result) => !result.terminated,
);
const candidateWorstMs = candidateBounded.reduce(
	(worst, result) => Math.max(worst, result.elapsedMs),
	0,
);
const unboundedTerminated = results
	.filter((result) => result.length > CANDIDATE_FRAGMENT_CHAR_LIMIT)
	.filter((result) => result.terminated);

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * THE LADDER.
 *
 * Every rung is measured in an independently terminable child process, with
 * the execution time measured INSIDE the child so that the child's startup
 * cost is excluded. The parent enforces an independent hard timeout and
 * SIGKILLs the child when it is exceeded.
 */
const LADDER_MODES = [
	"nonmatching",
	"matching",
	"near-match",
	"pem-flood",
] as const;

const ladder: LadderRung[] = [];
for (const mode of LADDER_MODES) {
	for (const length of INPUT_LADDER) {
		ladder.push(await runLadderRung(mode, length));
	}
}

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1)
 *
 * The MEASURED rungs, i.e. the rungs whose measurement COMPLETED.
 *
 * A watchdog termination, a child failure and a malformed measurement are
 * EXCLUDED from the timing statistics, because none of them produced a
 * timing. They are counted separately, so their absence cannot be mistaken
 * for a fast run.
 */
const measuredRungs = ladder.filter((rung) => rung.outcome === "measured");
const watchdogTerminations = ladder.filter(
	(rung) => rung.outcome === "watchdog_terminated",
);
const childFailures = ladder.filter((rung) => rung.outcome === "child_failed");
const malformedMeasurements = ladder.filter(
	(rung) => rung.outcome === "malformed_measurement",
);
const secretSurvivals = measuredRungs.filter(
	(rung) => rung.secretSurvived === true,
);

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1)
 *
 * THE REQUIRED MEASUREMENTS.
 *
 * Every family must have been measured at EVERY requested rung. A missing
 * measurement is a GAP, and a gap must never be reported as a satisfied
 * limit.
 */
const requiredMeasurements = LADDER_MODES.flatMap((mode) =>
	INPUT_LADDER.map((requestedLength) => ({ mode, requestedLength })),
);
const missingMeasurements = requiredMeasurements.filter(
	({ mode, requestedLength }) =>
		!measuredRungs.some(
			(rung) => rung.mode === mode && rung.requestedLength === requestedLength,
		),
);

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1)
 *
 * THE WORST-CASE TIMING, across ALL FOUR FAMILIES, at each required rung.
 *
 * The predecessor's cut selected the 50 KiB rung by matching the GENERATED
 * length against a hard-coded list (`51200 || 50000 || 48979 || 52886`),
 * which is neither the requested rung nor stable across the families. Here
 * the rung is the REQUESTED one, and the worst case is taken over EVERY
 * family, so no family can hide behind another's faster measurement.
 */
const worstCaseByRung = INPUT_LADDER.map((requestedLength) => {
	const atRung = measuredRungs.filter(
		(rung) => rung.requestedLength === requestedLength,
	);
	return {
		requestedLength,
		familiesMeasured: atRung.length,
		worstMaxMs: atRung.reduce((worst, rung) => Math.max(worst, rung.maxMs), 0),
	};
});
const worst50KibMs =
	(
		worstCaseByRung.find((rung) => rung.requestedLength === 51_200) ??
		worstCaseByRung[0]
	)?.worstMaxMs ?? Number.POSITIVE_INFINITY;
const worst1MibMs =
	(
		worstCaseByRung.find((rung) => rung.requestedLength === 1_048_576) ??
		worstCaseByRung[worstCaseByRung.length - 1]
	)?.worstMaxMs ?? Number.POSITIVE_INFINITY;

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1)
 *
 * EVERY required measurement must EXIST, EVERY rung must have terminated
 * SUCCESSFULLY, and EVERY limit must be satisfied.
 */
const allLimitsSatisfied =
	missingMeasurements.length === 0 &&
	watchdogTerminations.length === 0 &&
	childFailures.length === 0 &&
	malformedMeasurements.length === 0 &&
	worst50KibMs <= LIMIT_50_KIB_MS &&
	worst1MibMs <= LIMIT_1_MIB_MS;

console.log(
	JSON.stringify(
		{
			candidateFragmentCharLimit: CANDIDATE_FRAGMENT_CHAR_LIMIT,
			candidateBoundedCases: candidateBounded.length,
			candidateBoundedAllTerminated: candidateAllTerminated,
			candidateBoundedWorstMs: candidateWorstMs,
			unboundedCasesTerminated: unboundedTerminated.length,
			unboundedTerminationModes: unboundedTerminated.map((r) => r.mode),
			results,
			ladder: {
				repetitions: REPETITIONS,
				childTimeoutMs: CHILD_TIMEOUT_MS,
				limit50KibMs: LIMIT_50_KIB_MS,
				limit1MibMs: LIMIT_1_MIB_MS,
				// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1):
				// the three failure modes are DISTINGUISHED, and the required
				// measurements are asserted to EXIST.
				requiredMeasurementCount: requiredMeasurements.length,
				measuredCount: measuredRungs.length,
				missingMeasurements,
				watchdogTerminations: watchdogTerminations.length,
				watchdogTerminationRungs: watchdogTerminations.map(
					(rung) => `${rung.mode}@${rung.requestedLength}`,
				),
				childFailures: childFailures.length,
				childFailureRungs: childFailures.map(
					(rung) => `${rung.mode}@${rung.requestedLength}`,
				),
				malformedMeasurements: malformedMeasurements.length,
				malformedMeasurementRungs: malformedMeasurements.map(
					(rung) => `${rung.mode}@${rung.requestedLength}`,
				),
				secretSurvivals: secretSurvivals.length,
				worst50KibMaxMs: worst50KibMs,
				worst1MibMaxMs: worst1MibMs,
				within50KibLimit: worst50KibMs <= LIMIT_50_KIB_MS,
				within1MibLimit: worst1MibMs <= LIMIT_1_MIB_MS,
				worstCaseByRequestedRung: worstCaseByRung,
				allLimitsSatisfied,
				rungs: ladder,
			},
		},
		null,
		2,
	),
);

// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.1): the witness
// FAILS when a required measurement is missing, when any rung terminated
// abnormally, or when a limit is exceeded. The predecessor's cut always
// exited 0, so it could not fail the gate that ran it.
if (!allLimitsSatisfied) {
	console.error("SANITIZER_LADDER_LIMITS_NOT_SATISFIED");
	process.exit(1);
}
console.log("SANITIZER_LADDER_LIMITS_SATISFIED");
