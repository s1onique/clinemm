/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01 (C2.3)
 *
 * THE SANITIZER MEASUREMENT CHILD.
 *
 * WHY A CHILD PROCESS
 * -------------------
 *
 * The production sanitizer is SYNCHRONOUS, so a pathological input blocks
 * the event loop for its whole duration. A `Promise.race` against a timeout
 * cannot interrupt it, and a test framework's own timeout cannot interrupt
 * it either: a return to quadratic behaviour would HANG the worker rather
 * than fail it.
 *
 * So the measurement runs HERE, in a process the parent can SIGKILL. The
 * parent (`sanitizer-bounded-complexity.repair01.test.ts`) enforces a hard
 * timeout, so a pathological return produces a REPORTED failure instead of
 * a hang.
 *
 * WHAT IS MEASURED
 * ----------------
 *
 * The PRODUCTION `sanitizeOutcomeText()`, loaded from the real TypeScript
 * module through `jiti` (a production dependency of this package). The
 * module under measurement is therefore the SAME source file the extension
 * host bundles — not a copy and not a re-implementation.
 *
 * The execution time is measured INSIDE this child, so the child's start-up
 * cost is excluded from the measurement of the sanitizer.
 *
 * USAGE
 * -----
 *
 *   node sanitizer-bounded-complexity.child.mjs --family nonmatching --lengths 2048,4096
 *
 * It prints one JSON object on stdout:
 *
 *   { "measurements": [ { family, requestedLength, inputLength, medianMs,
 *                         maxMs, secretSurvived }, ... ] }
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

/**
 * The number of repetitions per measurement.
 */
const REPETITIONS = 5;

/**
 * The synthetic credential the "matching" family carries.
 *
 * It is synthetic and it is not a real credential.
 */
const SYNTHETIC_CREDENTIAL = "hunter2";

/**
 * The PEM marker's label, held separately so the marker can be assembled.
 */
const PEM_MARKER_LABEL = "RSA PRIVATE KEY-----";

/**
 * Build the input body for one family.
 *
 * Each family exercises a different pathological operation:
 *
 *   - `nonmatching`: a long run with no match, so the credential-assignment
 *     pattern has nothing to match.
 *   - `matching`: a long body that DOES carry a credential.
 *   - `pemflood`: a long run of PEM `BEGIN` markers, so the PEM pattern's
 *     pairing has many markers to pair.
 */
function buildBody(family, length) {
	switch (family) {
		case "nonmatching":
			return "a".repeat(length);
		case "matching":
			return `${"x".repeat(length)}\nDB_PASSWORD=${SYNTHETIC_CREDENTIAL}\n`;
		case "pemflood":
			return `-----BEGIN ${PEM_MARKER_LABEL}`.repeat(
				Math.max(1, Math.floor(length / 30)),
			);
		default:
			throw new Error(`unknown family: ${family}`);
	}
}

/**
 * Parse the command line.
 */
function parseArgs(argv) {
	const familyIndex = argv.indexOf("--family");
	const lengthsIndex = argv.indexOf("--lengths");
	if (familyIndex === -1 || lengthsIndex === -1) {
		throw new Error("usage: --family <name> --lengths <n,n,...>");
	}
	const family = argv[familyIndex + 1];
	const lengths = (argv[lengthsIndex + 1] ?? "")
		.split(",")
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0);
	if (!family || lengths.length === 0) {
		throw new Error("usage: --family <name> --lengths <n,n,...>");
	}
	return { family, lengths };
}

const { family, lengths } = parseArgs(process.argv.slice(2));

const jiti = createJiti(import.meta.url, { interopDefault: true });
const modulePath = join(
	dirname(fileURLToPath(import.meta.url)),
	"evidence-continuity.ts",
);
const { sanitizeOutcomeText } = await jiti.import(modulePath);

const measurements = lengths.map((requestedLength) => {
	const body = buildBody(family, requestedLength);
	const samples = [];
	let result = "";
	for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
		const startedAt = process.hrtime.bigint();
		result = sanitizeOutcomeText(body);
		samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
	}
	const sorted = [...samples].sort((left, right) => left - right);
	return {
		family,
		requestedLength,
		inputLength: body.length,
		medianMs: sorted[sorted.length >> 1],
		maxMs: sorted[sorted.length - 1],
		secretSurvived: result.includes(SYNTHETIC_CREDENTIAL),
	};
});

process.stdout.write(JSON.stringify({ measurements }));
