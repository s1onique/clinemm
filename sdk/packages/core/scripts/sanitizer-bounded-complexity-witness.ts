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
		default:
			console.error(`unknown mode: ${mode}`);
			process.exit(2);
	}
	const startedAt = Date.now();
	const result = sanitizeOutcomeText(body);
	process.stdout.write(
		JSON.stringify({
			mode,
			inputLength: body.length,
			elapsedMs: Date.now() - startedAt,
			outputLength: result.length,
			redacted: !result.includes("hunter2"),
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
		},
		null,
		2,
	),
);
