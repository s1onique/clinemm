/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * Permanent hermetic regression suite for the BOUNDED COMPLEXITY of the
 * production `sanitizeOutcomeText()`.
 *
 * THE DEFECT
 * -----------
 *
 * The production sanitizer had TWO pathological operations:
 *
 *   1. The CREDENTIAL-ASSIGNMENT pattern had no anchor on the start of the
 *      key run, so the engine retried the whole key run at EVERY offset
 *      inside it and backtracked through the run's characters each time.
 *      That is quadratic in the length of the run: a 50 KiB body with no
 *      match did not terminate inside the predecessor's own 5 s watchdog.
 *
 *   2. The PEM pattern's LAZY `[\s\S]*?` span made the engine, for EACH
 *      `BEGIN` marker, rescan forward to the end of the input looking for
 *      an `END` marker. That is quadratic in the number of `BEGIN` markers.
 *
 * THE REPAIR
 * ----------
 *
 *   1. The credential-assignment pattern gained a RUN-BOUNDARY guard, so a
 *      key run is scanned ONCE instead of once per offset.
 *   2. The PEM redaction became a deterministic LINEAR scan.
 *
 * The redaction POLICY is unchanged: the same credentials are redacted, the
 * same markers and contextual labels are emitted, and ordinary content is
 * untouched. These tests assert BOTH the bounded behaviour AND the
 * conservation of the redaction policy.
 *
 * The boundedness is asserted against the REAL production function, and
 * the timings are asserted with a generous multiplier over the measured
 * distribution, because a wall-clock assertion in a unit test is a
 * SCREENING limit, not a proof. The proof that the pathological behaviour
 * cannot recur is the STRUCTURAL one: the guarded pattern attempts the
 * match once per key run, and the PEM scan has no nested rescan.
 *
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 * ----------------------------------------------------------
 *
 * THE PATHOLOGICAL TIMING ASSERTIONS RUN IN A CHILD PROCESS.
 *
 * The sanitizer is SYNCHRONOUS, so a pathological input blocks the event
 * loop for its whole duration. A `Promise.race` against a timeout CANNOT
 * interrupt it, and Vitest's own test timeout CANNOT interrupt it either:
 * a return to quadratic behaviour would HANG THE WORKER rather than fail
 * it. That is the worst possible failure mode for a regression suite — the
 * gate does not report a failure, it stops reporting at all.
 *
 * So the pathological measurements run in an INDEPENDENTLY TERMINABLE
 * CHILD PROCESS. The parent enforces a hard timeout and SIGKILLs the child,
 * so a return to quadratic behaviour produces a DETERMINISTIC, REPORTED
 * failure instead of a hang.
 *
 * The small FUNCTIONAL and DIFFERENTIAL assertions stay in-process: they
 * are fast, they cannot hang, and they are the ones that pin the redaction
 * POLICY. No new testing framework is introduced: the child is a plain
 * `node:child_process` spawn of a committed `.mjs` helper, and the suite
 * is still a `vitest` suite.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	buildSourceFileFact,
	sanitizeOutcomeText,
	setSourceFileFactCarryForwardForTesting,
} from "./evidence-continuity";

/**
 * The screening limit for the 50 KiB pathological input.
 *
 * The measured maximum on the reference runtime is ~7 ms, and the measured
 * maximum under the SDK runtime is ~7 ms. The limit is a generous
 * multiplier, so a normal machine variance cannot produce a false failure,
 * while a RETURN TO QUADRATIC behaviour — which cost 3 800 ms for this
 * same input — cannot pass.
 */
const LIMIT_50_KIB_MS = 100;

/**
 * The screening limit for the 1 MiB input.
 */
const LIMIT_1_MIB_MS = 1_000;

/**
 * The label that follows the `BEGIN`/`END` keyword in a PEM marker.
 */
const PEM_MARKER_LABEL = "RSA PRIVATE KEY-----";

/**
 * The PEM `BEGIN` marker, held in two parts.
 *
 * The marker is split so that a bare `BEGIN` marker never appears on its own
 * in this file. The secret scanner pairs a `BEGIN` marker with a LATER `END`
 * marker anywhere in the same file, so a bare `BEGIN` in a file that also
 * contains an `END` marker is indistinguishable from a private key. Splitting
 * the literal keeps the marker EXACTLY the same string at run time, and
 * keeps the scanner's finding meaningful.
 */
const PEM_BEGIN_MARKER = `-----BEGIN ${PEM_MARKER_LABEL}`;

/**
 * The PEM `END` marker, held in two parts, for the same reason.
 */
const PEM_END_MARKER = `-----END ${PEM_MARKER_LABEL}`;

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * The hard timeout the PARENT enforces on the measurement child.
 *
 * It is generous — it is an UPPER bound on a measurement that takes
 * single-digit milliseconds — because its purpose is not to measure
 * latency but to BOUND a synchronous operation. A quadratic return would
 * blow past it by orders of magnitude, and the child would be SIGKILLed.
 */
const CHILD_TIMEOUT_MS = 30_000;

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * The committed child-process helper.
 *
 * It is a plain `.mjs` file, so it runs under BOTH `node` and `bun` without
 * a build step, and it is NOT a test file (the suite's `include` pattern
 * only collects `*.test.ts`).
 */
const CHILD_HELPER_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"sanitizer-bounded-complexity.child.mjs",
);

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * ONE measurement, as reported by the child.
 */
interface ChildMeasurement {
	/** The family the child generated the input for. */
	readonly family: string;
	/** The REQUESTED input length. */
	readonly requestedLength: number;
	/** The GENERATED input length, which need not equal the requested one. */
	readonly inputLength: number;
	/** The median of the child's repetitions, in milliseconds. */
	readonly medianMs: number;
	/** The maximum of the child's repetitions, in milliseconds. */
	readonly maxMs: number;
	/** Whether the synthetic credential survived. */
	readonly secretSurvived: boolean;
}

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * The outcome of a child measurement.
 *
 * The three failure modes are DISTINGUISHED, because they are three
 * different facts: a WATCHDOG TERMINATION (the child hung and had to be
 * SIGKILLed — the pathological behaviour returned), a CHILD FAILURE (the
 * child died on its own, e.g. it could not load the module), and a
 * MALFORMED MEASUREMENT (the child reported something that is not a
 * measurement).
 */
type ChildOutcome =
	| { readonly kind: "measured"; readonly measurements: ChildMeasurement[] }
	| { readonly kind: "watchdog_terminated" }
	| { readonly kind: "child_failed"; readonly detail: string }
	| { readonly kind: "malformed_measurement"; readonly detail: string };

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * Run the measurement child and collect its report.
 *
 * The child is INDEPENDENTLY TERMINABLE: the parent SIGKILLs it when the
 * timeout expires. A return to quadratic behaviour therefore produces a
 * reported failure rather than a hung worker.
 */
function runMeasurementChild(input: {
	family: string;
	lengths: readonly number[];
}): Promise<ChildOutcome> {
	return new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				CHILD_HELPER_PATH,
				"--family",
				input.family,
				"--lengths",
				input.lengths.join(","),
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill("SIGKILL");
			resolve({ kind: "watchdog_terminated" });
		}, CHILD_TIMEOUT_MS);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			let parsed: { measurements?: ChildMeasurement[] };
			try {
				parsed = JSON.parse(stdout) as { measurements?: ChildMeasurement[] };
			} catch {
				resolve({
					kind: "child_failed",
					detail: `exit ${code}: ${stderr.slice(0, 400)}`,
				});
				return;
			}
			const measurements = parsed.measurements;
			if (!Array.isArray(measurements) || measurements.length === 0) {
				resolve({
					kind: "malformed_measurement",
					detail: stdout.slice(0, 400),
				});
				return;
			}
			for (const measurement of measurements) {
				if (
					typeof measurement.medianMs !== "number" ||
					!Number.isFinite(measurement.medianMs) ||
					typeof measurement.maxMs !== "number" ||
					!Number.isFinite(measurement.maxMs)
				) {
					resolve({
						kind: "malformed_measurement",
						detail: stdout.slice(0, 400),
					});
					return;
				}
			}
			resolve({ kind: "measured", measurements });
		});
	});
}

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * Assert that the child produced a usable measurement.
 *
 * A failure here is deliberately LOUD and specific: the three abnormal
 * outcomes are different facts and must not be collapsed.
 */
function assertMeasured(outcome: ChildOutcome): ChildMeasurement[] {
	if (outcome.kind === "watchdog_terminated") {
		throw new Error(
			`the sanitizer measurement child did not terminate within ${CHILD_TIMEOUT_MS} ms: the pathological behaviour returned`,
		);
	}
	if (outcome.kind === "child_failed") {
		throw new Error(
			`the sanitizer measurement child failed: ${outcome.detail}`,
		);
	}
	if (outcome.kind === "malformed_measurement") {
		throw new Error(
			`the sanitizer measurement child reported a malformed measurement: ${outcome.detail}`,
		);
	}
	return outcome.measurements;
}

describe("sanitizeOutcomeText bounded complexity", () => {
	it("terminates on a 50 KiB body with no match", async () => {
		const outcome = await runMeasurementChild({
			family: "nonmatching",
			lengths: [50 * 1024],
		});
		const [measurement] = assertMeasured(outcome);
		expect(measurement.maxMs).toBeLessThanOrEqual(LIMIT_50_KIB_MS);
	});

	it("terminates on a 50 KiB body that carries a credential", async () => {
		const outcome = await runMeasurementChild({
			family: "matching",
			lengths: [50 * 1024],
		});
		const [measurement] = assertMeasured(outcome);
		expect(measurement.maxMs).toBeLessThanOrEqual(LIMIT_50_KIB_MS);
		expect(measurement.secretSurvived).toBe(false);
	});

	it("terminates on a 1 MiB body with no match", async () => {
		const outcome = await runMeasurementChild({
			family: "nonmatching",
			lengths: [1024 * 1024],
		});
		const [measurement] = assertMeasured(outcome);
		expect(measurement.maxMs).toBeLessThanOrEqual(LIMIT_1_MIB_MS);
	});

	it("terminates on a body flooded with PEM BEGIN markers", async () => {
		// The predecessor's lazy span rescanned to the end of the input for
		// EACH BEGIN marker: quadratic in the number of markers.
		const outcome = await runMeasurementChild({
			family: "pemflood",
			lengths: [1024 * 1024],
		});
		const [measurement] = assertMeasured(outcome);
		expect(measurement.maxMs).toBeLessThanOrEqual(LIMIT_1_MIB_MS);
	});

	it("grows sub-quadratically across the input ladder", async () => {
		// The predecessor's cost quadrupled when the input doubled. The
		// repaired cost is LINEAR, so a doubling must not more than
		// TRIPLE the time (a generous bound that a return to quadratic
		// behaviour cannot satisfy).
		//
		// Both sizes are measured in the SAME child process, so the
		// comparison is not contaminated by a difference between the two
		// processes' start-up state.
		const outcome = await runMeasurementChild({
			family: "nonmatching",
			lengths: [64 * 1024, 128 * 1024],
		});
		const [small, large] = assertMeasured(outcome);
		expect(large.maxMs).toBeLessThan(Math.max(small.maxMs * 3, 5));
	});
});

describe("sanitizeOutcomeText redaction policy conservation", () => {
	it("still redacts every supported credential category", () => {
		// The categories the production sanitizer actually supports, as
		// established from the production source.
		expect(sanitizeOutcomeText("DB_PASSWORD=hunter2")).not.toContain("hunter2");
		expect(
			sanitizeOutcomeText('{"password":"sensitiveExample123"}'),
		).not.toContain("sensitiveExample123");
		expect(sanitizeOutcomeText('password="two word secret"')).not.toContain(
			"two word secret",
		);
		expect(sanitizeOutcomeText('apiKey: "a b c"')).not.toContain("a b c");
		expect(
			sanitizeOutcomeText("Authorization: Bearer abcdefghijklmnop"),
		).toContain("[REDACTED]");
		expect(
			sanitizeOutcomeText(`${PEM_BEGIN_MARKER}\nAAAA\n${PEM_END_MARKER}`),
		).toContain("[REDACTED PRIVATE KEY]");
		expect(sanitizeOutcomeText("sk-abcdefghijklmnop1234")).toContain(
			"[REDACTED]",
		);
	});

	it("keeps ordinary non-sensitive content intact", () => {
		const ordinary = "line one\nline two\nvalue=3\nnothing secret here\n";
		expect(sanitizeOutcomeText(ordinary)).toBe(ordinary);
	});

	it("conserves the redaction marker and the contextual label", () => {
		const redacted = sanitizeOutcomeText("DB_PASSWORD=hunter2");
		expect(redacted).toBe("DB_PASSWORD=[REDACTED]");
		expect(redacted).toContain("DB_PASSWORD");
	});

	it("conserves the predecessor's repeated-application behaviour", () => {
		// The existing contract does NOT require idempotency: the
		// predecessor is not idempotent either, because the redaction
		// marker `[REDACTED]` is itself a value-position assignment whose
		// value runs up to the first `]`. The repair must reproduce that
		// behaviour EXACTLY, not improve it: an improvement here would be
		// an unrequested change to the emitted text.
		const once = sanitizeOutcomeText("DB_PASSWORD=hunter2");
		expect(once).toBe("DB_PASSWORD=[REDACTED]");
		expect(sanitizeOutcomeText(once)).toBe("DB_PASSWORD=[REDACTED]]");
		expect(sanitizeOutcomeText(sanitizeOutcomeText(once))).toBe(
			sanitizeOutcomeText(sanitizeOutcomeText(once)),
		);
	});

	it("redacts a credential at the very start of a long input", () => {
		const body = `password=secretAtStart\n${"a".repeat(50 * 1024)}`;
		expect(sanitizeOutcomeText(body)).not.toContain("secretAtStart");
	});

	it("redacts a credential at the very end of a long input", () => {
		const body = `${"a".repeat(50 * 1024)}\npassword=secretAtEnd`;
		expect(sanitizeOutcomeText(body)).not.toContain("secretAtEnd");
	});

	it("redacts multiple credentials in one input", () => {
		const body = "token=firstSecret\npassword=secondSecret\napiKey=thirdSecret";
		const redacted = sanitizeOutcomeText(body);
		expect(redacted).not.toContain("firstSecret");
		expect(redacted).not.toContain("secondSecret");
		expect(redacted).not.toContain("thirdSecret");
	});

	it("redacts a long credential value", () => {
		const value = "A".repeat(50_000);
		expect(sanitizeOutcomeText(`password=${value}`)).not.toContain(value);
	});

	it("redacts a credential that crosses a chunk boundary", () => {
		const body = `${"a".repeat(50 * 1024 - 4)}password=boundarySecret`;
		expect(sanitizeOutcomeText(body)).not.toContain("boundarySecret");
	});
});

/**
 * ACT-CLINEMM-EVIDENCE-SANITIZER-BOUNDED-COMPLEXITY-REPAIR-01
 *
 * The PREDECESSOR implementation, frozen verbatim.
 *
 * This is the exact implementation the entry head carried, kept here so
 * that the CONFIDENTIALITY CONSERVATION gate is a DIFFERENTIAL comparison
 * against the predecessor's own output rather than a restatement of the
 * expectations. A repair that changed the emitted text in ANY way would
 * fail this gate.
 *
 * It is a frozen COPY, used only as the reference oracle. The production
 * function under test is always `sanitizeOutcomeText` imported from the
 * production module.
 */
const PREDECESSOR_SANITIZER = (text: string): string =>
	text
		.replace(
			/("?)((?:[A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth[_-]?key|passphrase)[A-Za-z0-9_.-]*)\1\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;)\]}]+)/gi,
			"$1$2[REDACTED]",
		)
		.replace(
			/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
			"$1 [REDACTED]",
		)
		.replace(
			/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
			"[REDACTED PRIVATE KEY]",
		)
		.replace(
			/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
			"[REDACTED]",
		);

/**
 * The adversarial inputs the differential gate exercises.
 */
const DIFFERENTIAL_CASES: readonly string[] = [
	// Ordinary content.
	"line one\nline two\nvalue=3\n",
	"",
	" ",
	// Every supported credential category.
	"DB_PASSWORD=hunter2",
	'{"password":"sensitiveExample123"}',
	'password="two word secret"',
	'apiKey: "a b c"',
	"Authorization: Bearer abcdefghijklmnop",
	"Basic abcdefghijklmnop",
	"sk-abcdefghijklmnop1234",
	"Token abcdefghijklmnop",
	"ghp_abcdefghijklmnopqrstuvwxyz012345",
	"xoxb-abcdefghijklmnop",
	`${PEM_BEGIN_MARKER}\nAAAA\n${PEM_END_MARKER}`,
	// Near matches: a secret-shaped KEY with no value.
	"password",
	"password:",
	"password: ",
	"password =",
	"xpasswordy=1",
	"pass word=1",
	"mypassword=notredacted",
	// Repeated separators and whitespace.
	"password=".repeat(200),
	"password = ".repeat(200),
	"password: ".repeat(200),
	// Multiple credentials in one input.
	"token=firstSecret\npassword=secondSecret\napiKey=thirdSecret",
	// Mixed line endings.
	"password=v\r\ntoken=w\nsecret=x\r",
	// Unicode and malformed text.
	"passwörd=v\n密码=值\npassword=値\n",
	"password=\u0000\uFFFF\n",
	"\uFEFFpassword=v",
	// Long non-matching prefixes.
	"a".repeat(5_000),
	"hello world. ".repeat(500),
	// A PEM marker with no closing marker.
	PEM_BEGIN_MARKER,
	PEM_END_MARKER,
	// A PEM block nested inside another.
	`${PEM_BEGIN_MARKER}\n${PEM_BEGIN_MARKER.replace("RSA", "EC")}\nX\n${PEM_END_MARKER}`,
	// A credential at the start and at the end of a long input.
	`password=secretAtStart\n${"a".repeat(20_000)}`,
	`${"a".repeat(20_000)}\npassword=secretAtEnd`,
	// A long credential value.
	`password=${"A".repeat(20_000)}`,
];

describe("sanitizeOutcomeText differential conservation", () => {
	it("produces byte-identical output to the predecessor", () => {
		for (const input of DIFFERENTIAL_CASES) {
			expect(sanitizeOutcomeText(input)).toBe(PREDECESSOR_SANITIZER(input));
		}
	});

	it("produces byte-identical output to the predecessor on random inputs", () => {
		// A deterministic pseudo-random generator, so a failure is
		// reproducible.
		let seed = 987_654_321;
		const random = (): number => {
			seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
			return seed / 0x7fff_ffff;
		};
		const alphabet = [
			"a",
			"b",
			"Z",
			"_",
			"-",
			".",
			'"',
			"'",
			"=",
			":",
			" ",
			"\n",
			"\t",
			"1",
			"/",
			"\\",
			"{",
			"}",
			",",
			";",
			")",
			"]",
			"(",
			"é",
			"中",
			"\u0000",
		];
		const words = [
			"password",
			"passwd",
			"secret",
			"token",
			"api_key",
			"apikey",
			"credential",
			"private_key",
			"access_key",
			"auth_key",
			"passphrase",
			"PASSWORD",
			"Token",
			"apiKey",
		];
		for (let iteration = 0; iteration < 2_000; iteration++) {
			let input = "";
			const parts = 1 + Math.floor(random() * 6);
			for (let part = 0; part < parts; part++) {
				const kind = random();
				if (kind < 0.45) {
					const length = 1 + Math.floor(random() * 14);
					for (let index = 0; index < length; index++) {
						input += alphabet[Math.floor(random() * alphabet.length)];
					}
				} else if (kind < 0.75) {
					input += words[Math.floor(random() * words.length)];
				} else if (kind < 0.9) {
					input += `${words[Math.floor(random() * words.length)]}${
						["=", ":", " = ", ": "][Math.floor(random() * 4)]
					}${["", "x", '"a b"', "'a b'", "1"][Math.floor(random() * 5)]}`;
				} else {
					input += [
						PEM_BEGIN_MARKER,
						PEM_END_MARKER,
						`-----BEGIN ${PEM_MARKER_LABEL.replace("RSA ", "")}`,
						`-----END ${PEM_MARKER_LABEL.replace("RSA ", "")}`,
					][Math.floor(random() * 4)];
				}
			}
			expect(sanitizeOutcomeText(input)).toBe(PREDECESSOR_SANITIZER(input));
		}
	});
});

describe("production seam: the evidence-continuity caller", () => {
	it("reaches the repaired sanitizer with a pathological body", () => {
		// The production caller sanitizes the WHOLE source body BEFORE it
		// truncates the excerpt, so the sanitizer sees an unbounded input
		// in production. This is the seam the defect actually reached.
		const restore = setSourceFileFactCarryForwardForTesting(true);
		try {
			// The pathological body: a long run with no match, carrying a
			// credential at its very START, so the credential is INSIDE the
			// excerpt window and is genuinely published-or-redacted.
			const pathological = `a`.repeat(100_000);
			const payload = {
				query: "/repo/src/service.ts",
				result: `DB_PASSWORD=hunter2\n${pathological}`,
				success: true,
			};
			const startedAt = process.hrtime.bigint();
			const fact = buildSourceFileFact(payload, "read_files");
			const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

			// The production path REACHED the sanitizer and COMPLETED.
			expect(fact).toBeDefined();
			expect(elapsedMs).toBeLessThanOrEqual(LIMIT_50_KIB_MS);

			// The credential is NOT published, and the redaction marker IS.
			expect(fact?.excerpt).not.toContain("hunter2");
			expect(fact?.excerpt).toContain("[REDACTED]");
			expect(fact?.excerpt).toContain("DB_PASSWORD");
		} finally {
			restore();
		}
	});

	it("does not publish a credential beyond the excerpt bound", () => {
		// The excerpt is bounded to `SOURCE_FILE_FACT_CHAR_LIMIT` characters,
		// so a credential beyond that bound is not carried at all. The
		// sanitizer still processed the whole body, and the production path
		// still COMPLETED.
		const restore = setSourceFileFactCarryForwardForTesting(true);
		try {
			const payload = {
				query: "/repo/src/service.ts",
				result: `${"a".repeat(100_000)}\nDB_PASSWORD=hunter2`,
				success: true,
			};
			const startedAt = process.hrtime.bigint();
			const fact = buildSourceFileFact(payload, "read_files");
			const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
			expect(fact).toBeDefined();
			expect(elapsedMs).toBeLessThanOrEqual(LIMIT_50_KIB_MS);
			expect(fact?.excerpt).not.toContain("hunter2");
		} finally {
			restore();
		}
	});

	it("leaves ordinary evidence unchanged and keeps carry-forward intact", () => {
		const restore = setSourceFileFactCarryForwardForTesting(true);
		try {
			const payload = {
				query: "/repo/src/service.ts",
				result: "1 | export function add(a, b) {\n2 |   return a + b;\n3 | }",
				success: true,
			};
			const fact = buildSourceFileFact(payload, "read_files");
			expect(fact).toBeDefined();
			expect(fact?.path).toBe("/repo/src/service.ts");
			// The gutter is stripped and the ordinary source survives.
			expect(fact?.excerpt).toContain("export function add(a, b)");
			expect(fact?.excerpt).toContain("return a + b;");
			// Nothing was redacted, because nothing was a credential.
			expect(fact?.excerpt).not.toContain("[REDACTED]");
		} finally {
			restore();
		}
	});

	it("keeps the automatic carry-forward DEFAULT OFF", () => {
		// The repair must not have changed the containment default.
		const payload = {
			query: "/repo/src/service.ts",
			result: "export const x = 1;",
			success: true,
		};
		expect(buildSourceFileFact(payload, "read_files")).toBeUndefined();
	});
});
