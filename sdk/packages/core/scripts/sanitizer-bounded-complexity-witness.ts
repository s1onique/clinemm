/**
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
	const mode = process.argv[3] ?? "nonmatching";
	const length = Number(process.argv[4] ?? "50000");
	const { sanitizeOutcomeText } = await import(
		"../src/extensions/context/evidence-continuity"
	);
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
	for (let repetition = 0; repetition < REPETITIONS; repetition++) {
		const startedAt = process.hrtime.bigint();
		result = sanitizeOutcomeText(body);
		samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
	}
	const sorted = [...samples].sort((left, right) => left - right);
	process.stdout.write(
		JSON.stringify({
			mode,
			runtime: process.versions.node ?? process.versions.bun,
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
	readonly inputBytes: number;
	readonly inputLength: number;
	readonly medianMs: number;
	readonly maxMs: number;
	readonly runtime: string;
	readonly terminated: boolean;
	readonly secretSurvived?: boolean;
}

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
				inputBytes: length,
				inputLength: length,
				medianMs: Number.POSITIVE_INFINITY,
				maxMs: Number.POSITIVE_INFINITY,
				runtime: "unknown",
				terminated: true,
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
			try {
				const parsed = JSON.parse(stdout) as {
					mode: string;
					runtime: string;
					inputBytes: number;
					inputLength: number;
					medianMs: number;
					maxMs: number;
					secretSurvived: boolean;
				};
				resolve({
					mode: parsed.mode,
					inputBytes: parsed.inputBytes,
					inputLength: parsed.inputLength,
					medianMs: parsed.medianMs,
					maxMs: parsed.maxMs,
					runtime: parsed.runtime,
					terminated: false,
					secretSurvived: parsed.secretSurvived,
				});
			} catch {
				resolve({
					mode,
					inputBytes: length,
					inputLength: length,
					medianMs: Number.POSITIVE_INFINITY,
					maxMs: Number.POSITIVE_INFINITY,
					runtime: "unknown",
					terminated: true,
				});
			}
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

const ladderTerminations = ladder.filter((rung) => rung.terminated);
const secretSurvivals = ladder.filter((rung) => rung.secretSurvived === true);
const rung50Kib = ladder.filter(
	(rung) => rung.inputLength === 51_200 || rung.inputLength === 50_000,
);
const rung1Mib = ladder.filter((rung) => rung.inputLength === 1_048_576);
const worst50KibMs = rung50Kib.reduce(
	(worst, rung) => Math.max(worst, rung.maxMs),
	0,
);
const worst1MibMs = rung1Mib.reduce(
	(worst, rung) => Math.max(worst, rung.maxMs),
	0,
);

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
				watchdogTerminations: ladderTerminations.length,
				watchdogTerminationModes: ladderTerminations.map(
					(rung) => `${rung.mode}@${rung.inputLength}`,
				),
				secretSurvivals: secretSurvivals.length,
				worst50KibMaxMs: worst50KibMs,
				worst1MibMaxMs: worst1MibMs,
				within50KibLimit: worst50KibMs <= LIMIT_50_KIB_MS,
				within1MibLimit: worst1MibMs <= LIMIT_1_MIB_MS,
				rungs: ladder,
			},
		},
		null,
		2,
	),
);
