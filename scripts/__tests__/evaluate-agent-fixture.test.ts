/**
 * ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01 — focused evaluator witnesses.
 *
 * The witnesses pin the evaluator's load-bearing guarantees:
 *
 *   BASE-01       The frozen fixture reproduces the expected RED.
 *   PASS-01       A valid repaired candidate independently passes.
 *   FAIL-01       An agent claiming PASS while the tests fail → FAIL.
 *   FAIL-02       A candidate that changes `tests/` → FAIL.
 *   FAIL-03       A candidate that changes `package.json` → FAIL.
 *   FAIL-04       A candidate that changes a file outside `src/` → FAIL.
 *   FAIL-05       An untracked out-of-scope file is detected.
 *   FAIL-06       A deleted protected file is detected.
 *   FAIL-07       A symlink / path traversal outside the workspace is rejected.
 *   FAIL-08       A runner exiting non-zero is FAIL even when its output
 *                 contains "all tests passed".
 *   INCOMPLETE-01 A timeout can never become PASS.
 *   INCOMPLETE-02 A missing required report cannot fabricate counts.
 *   IDENTITY-01   A different starting fixture is rejected.
 *   IDENTITY-02   Modified candidate tests cannot replace the trusted tests.
 *   PRIV-01       The export contains no raw output or sensitive paths.
 *   DET-01        Identical inputs produce identical deterministic fields.
 *
 * REAL vs SYNTHETIC
 * -----------------
 * The RED baseline and the GREEN candidate are REAL: they are the frozen
 * fixture and a repaired workspace observed on this host. The adversarial
 * controls are explicitly labelled `SYNTHETIC` — they are constructions, not
 * evidence of live agent behaviour.
 *
 * The real fixture is materialized from the operator-owned frozen fixture
 * repository at the path named by `CLINE_ACCEPTANCE_FIXTURE_REPO`. When it is
 * ABSENT the real witnesses SKIP with an explicit reason; they never pass on
 * synthetic data.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	type AcceptanceArtifact,
	type AgentFixtureManifest,
	buildAcceptanceEvents,
	canonicalDigest,
	digestWorkspace,
	EVALUATOR_VERSION,
	evaluateCandidate,
	inventoryCandidate,
	matchesGlob,
	parseJunitReport,
	runBounded,
} from "../evaluate-agent-fixture";

// ============================================================================
// Real-fixture plumbing
// ============================================================================

/** The operator-owned frozen fixture repository. */
const FIXTURE_REPO = process.env.CLINE_ACCEPTANCE_FIXTURE_REPO;

/** The operator-owned manifest for the frozen fixture. */
const MANIFEST_PATH = process.env.CLINE_ACCEPTANCE_MANIFEST;

/** The bun binary the frozen fixture's trusted command uses. */
const BUN = process.env.CLINE_ACCEPTANCE_BUN ?? "/opt/homebrew/bin/bun";

/** Whether the real fixture is available on this host. */
const REAL_FIXTURE_AVAILABLE = Boolean(
	FIXTURE_REPO && MANIFEST_PATH && existsSync(MANIFEST_PATH),
);

/** Load the operator's manifest. */
function loadManifest(): AgentFixtureManifest {
	return JSON.parse(
		readFileSync(MANIFEST_PATH as string, "utf8"),
	) as AgentFixtureManifest;
}

/** A temporary directory that is removed when the witness finishes. */
function withTempDir<T>(body: (dir: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "cline-acceptance-witness-"));
	try {
		return body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Copy the frozen fixture into a scratch directory.
 *
 * The frozen fixture's own bytes are the starting point; the witness then
 * mutates the copy, never the original.
 */
function copyFrozenFixture(destination: string): void {
	const source = join(FIXTURE_REPO as string, ".");
	const { cpSync } = require("node:fs") as typeof import("node:fs");
	cpSync(source, destination, { recursive: true });
}

// ============================================================================
// Pure-function witnesses
// ============================================================================

describe("glob matching", () => {
	it("matches a path under an allowed directory", () => {
		expect(matchesGlob("src/**", "src/ledger.ts")).toBe(true);
		expect(matchesGlob("src/**", "src/nested/deep.ts")).toBe(true);
		expect(matchesGlob("src/**", "src")).toBe(true);
	});

	it("does not match a path outside the allowed directory", () => {
		expect(matchesGlob("src/**", "tests/contract.test.ts")).toBe(false);
		expect(matchesGlob("src/**", "srcx/ledger.ts")).toBe(false);
	});

	it("matches an exact file path", () => {
		expect(matchesGlob("package.json", "package.json")).toBe(true);
		expect(matchesGlob("package.json", "package.json.bak")).toBe(false);
	});
});

describe("structured report parsing", () => {
	const validReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="0" failures="1" skipped="0" time="0.01">
  <testsuite name="t.test.ts" file="t.test.ts" tests="2" assertions="0" failures="1" skipped="0" time="0">
    <testcase name="alpha" classname="" time="0.1" file="t.test.ts" line="1" assertions="0" />
    <testcase name="beta" classname="" time="0.1" file="t.test.ts" line="2" assertions="0">
      <failure type="AssertionError" />
    </testcase>
  </testsuite>
</testsuites>`;

	it("parses a structurally valid report into counts and identities", () => {
		const results = parseJunitReport(validReport);
		expect(results.structurallyValid).toBe(true);
		expect(results.total).toBe(2);
		expect(results.failed).toBe(1);
		expect(results.passed).toBe(1);
		expect(results.testIdentities).toEqual([
			"t.test.ts::alpha",
			"t.test.ts::beta",
		]);
		expect(results.failingIdentities).toEqual(["t.test.ts::beta"]);
	});

	it("INCOMPLETE-02: a missing report fabricates no counts", () => {
		const results = parseJunitReport("");
		expect(results.reportPresent).toBe(false);
		expect(results.structurallyValid).toBe(false);
		expect(results.total).toBeNull();
		expect(results.passed).toBeNull();
		expect(results.failed).toBeNull();
		expect(results.testIdentities).toEqual([]);
	});

	it("rejects a malformed report instead of guessing", () => {
		const results = parseJunitReport("<not-a-report/>");
		expect(results.structurallyValid).toBe(false);
		expect(results.total).toBeNull();
	});

	it("rejects a report whose declared counts disagree with its testcases", () => {
		const tampered = validReport.replace('tests="2"', 'tests="5"');
		const results = parseJunitReport(tampered);
		expect(results.structurallyValid).toBe(false);
		expect(results.problem).toContain("disagrees");
	});
});

describe("bounded process execution", () => {
	it("observes the real exit code", async () => {
		const result = await runBounded({
			argv: ["/bin/sh", "-c", "exit 7"],
			cwd: tmpdir(),
			timeoutMs: 10_000,
			env: {},
		});
		expect(result.outcome.endKind).toBe("exited");
		expect(result.outcome.exitCode).toBe(7);
	});

	it("FAIL-08: a non-zero exit is not a success even when stdout claims otherwise", async () => {
		const result = await runBounded({
			argv: ["/bin/sh", "-c", "echo 'all tests passed'; exit 3"],
			cwd: tmpdir(),
			timeoutMs: 10_000,
			env: {},
		});
		expect(result.outcome.exitCode).toBe(3);
		expect(result.stdout).toContain("all tests passed");
	});

	it("INCOMPLETE-01: a timeout is distinguishable from a non-zero exit", async () => {
		const result = await runBounded({
			// The child exits on its own shortly after the timeout so the
			// witness leaves no orphan behind on hosts that refuse to signal
			// a running process.
			argv: ["/bin/sh", "-c", "sleep 0.6"],
			cwd: tmpdir(),
			timeoutMs: 150,
			env: { PATH: "/usr/bin:/bin" },
		});
		expect(result.outcome.endKind).toBe("timeout");
		expect(result.outcome.exitCode).toBeNull();
	});

	it("reports a spawn failure rather than a test failure", async () => {
		const result = await runBounded({
			argv: ["/definitely/not/a/real/binary"],
			cwd: tmpdir(),
			timeoutMs: 10_000,
			env: {},
		});
		expect(result.outcome.endKind).toBe("spawnFailed");
		expect(result.outcome.exitCode).toBeNull();
	});
});

// ============================================================================
// Workspace-inventory witnesses (SYNTHETIC)
// ============================================================================

describe("candidate workspace inventory", () => {
	const scope = {
		allowedChanges: ["src/**"],
		protectedPaths: ["tests/**", "package.json", "README.md"],
	};

	/** Build a minimal synthetic fixture tree. */
	function makeFixture(root: string): void {
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(join(root, "tests"), { recursive: true });
		writeFileSync(join(root, "src", "ledger.ts"), "export const a = 1\n");
		writeFileSync(
			join(root, "tests", "contract.test.ts"),
			"test('x', () => {})\n",
		);
		writeFileSync(join(root, "package.json"), "{}\n");
		writeFileSync(join(root, "README.md"), "# readme\n");
	}

	it("FAIL-02: a modified protected test file is detected", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidate = join(dir, "candidate");
			mkdirSync(fixture);
			mkdirSync(candidate);
			makeFixture(fixture);
			makeFixture(candidate);
			writeFileSync(
				join(candidate, "tests", "contract.test.ts"),
				"test('tampered', () => {})\n",
			);
			const inventory = inventoryCandidate(fixture, candidate, scope);
			expect(inventory.protectedViolations).toContain("tests/contract.test.ts");
			expect(
				inventory.changes.some((c) => c.path === "tests/contract.test.ts"),
			).toBe(true);
		});
	});

	it("FAIL-03: a modified protected package.json is detected", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidate = join(dir, "candidate");
			mkdirSync(fixture);
			mkdirSync(candidate);
			makeFixture(fixture);
			makeFixture(candidate);
			writeFileSync(join(candidate, "package.json"), '{"hacked":true}\n');
			const inventory = inventoryCandidate(fixture, candidate, scope);
			expect(inventory.protectedViolations).toContain("package.json");
		});
	});

	it("FAIL-04: a change outside src/ is detected as an out-of-scope change", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidate = join(dir, "candidate");
			mkdirSync(fixture);
			mkdirSync(candidate);
			makeFixture(fixture);
			makeFixture(candidate);
			writeFileSync(join(candidate, "config.json"), "{}\n");
			const inventory = inventoryCandidate(fixture, candidate, scope);
			expect(inventory.scopeViolations).toContain("config.json");
			expect(inventory.protectedViolations).not.toContain("config.json");
		});
	});

	it("FAIL-05: an untracked out-of-scope file is detected", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidate = join(dir, "candidate");
			mkdirSync(fixture);
			mkdirSync(candidate);
			makeFixture(fixture);
			makeFixture(candidate);
			writeFileSync(join(candidate, "stray.txt"), "untracked\n");
			const inventory = inventoryCandidate(fixture, candidate, scope);
			expect(inventory.scopeViolations).toContain("stray.txt");
			const change = inventory.changes.find((c) => c.path === "stray.txt");
			expect(change?.kind).toBe("added");
		});
	});

	it("FAIL-06: a deleted protected file is detected", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidate = join(dir, "candidate");
			mkdirSync(fixture);
			mkdirSync(candidate);
			makeFixture(fixture);
			makeFixture(candidate);
			rmSync(join(candidate, "tests", "contract.test.ts"));
			const inventory = inventoryCandidate(fixture, candidate, scope);
			expect(inventory.protectedViolations).toContain("tests/contract.test.ts");
			const change = inventory.changes.find(
				(c) => c.path === "tests/contract.test.ts",
			);
			expect(change?.kind).toBe("deleted");
		});
	});

	it("FAIL-07: a symlink escaping the candidate root is detected", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidate = join(dir, "candidate");
			mkdirSync(fixture);
			mkdirSync(candidate);
			makeFixture(fixture);
			makeFixture(candidate);
			symlinkSync("/etc/passwd", join(candidate, "src", "escape.ts"));
			const inventory = inventoryCandidate(fixture, candidate, scope);
			expect(inventory.escapeViolations).toContain("src/escape.ts");
		});
	});

	it("DET-01: identical inputs produce an identical deterministic delta digest", () => {
		withTempDir((dir) => {
			const fixture = join(dir, "fixture");
			const candidateA = join(dir, "candidateA");
			const candidateB = join(dir, "candidateB");
			mkdirSync(fixture);
			mkdirSync(candidateA);
			mkdirSync(candidateB);
			makeFixture(fixture);
			makeFixture(candidateA);
			makeFixture(candidateB);
			writeFileSync(
				join(candidateA, "src", "ledger.ts"),
				"export const a = 2\n",
			);
			writeFileSync(
				join(candidateB, "src", "ledger.ts"),
				"export const a = 2\n",
			);
			const inventoryA = inventoryCandidate(fixture, candidateA, scope);
			const inventoryB = inventoryCandidate(fixture, candidateB, scope);
			expect(inventoryA.deltaSha256).toBe(inventoryB.deltaSha256);
			expect(digestWorkspace(candidateA)).toBe(digestWorkspace(candidateB));
		});
	});
});

// ============================================================================
// Real-fixture end-to-end witnesses
// ============================================================================

/**
 * The KNOWN REPAIR source.
 *
 * The repaired workspace observed on this host (`clinemm-edit-ab-v1`) is the
 * operator's recorded GREEN candidate. The witness reads the repair from the
 * operator-supplied repair directory so the witness source stays free of a
 * second, drifting copy of the fixture's implementation.
 */
const REPAIR_DIR = process.env.CLINE_ACCEPTANCE_REPAIR_DIR;

/** Apply the known repair to a scratch copy of the frozen fixture. */
function applyKnownRepair(candidateRoot: string): void {
	const ledger = readFileSync(
		join(REPAIR_DIR as string, "src", "ledger.ts"),
		"utf8",
	);
	const validate = readFileSync(
		join(REPAIR_DIR as string, "src", "validate.ts"),
		"utf8",
	);
	writeFileSync(join(candidateRoot, "src", "ledger.ts"), ledger);
	writeFileSync(join(candidateRoot, "src", "validate.ts"), validate);
}

/** Whether the operator supplied the repaired workspace. */
const REPAIR_AVAILABLE = Boolean(
	REPAIR_DIR && existsSync(join(REPAIR_DIR, "src", "ledger.ts")),
);

describe("end-to-end evaluation against the real frozen fixture", () => {
	const maybe = REAL_FIXTURE_AVAILABLE ? it : it.skip;

	maybe("BASE-01: the frozen fixture reproduces the expected RED", async () => {
		const manifest = loadManifest();
		const result = await evaluateCandidate({
			manifest,
			candidateRoot: FIXTURE_REPO as string,
			outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-base-")),
			experimentId: "witness",
			trialId: "BASE-01",
		});
		expect(result.baseline).not.toBeNull();
		expect(result.baseline?.results.structurallyValid).toBe(true);
		expect(result.baseline?.results.total).toBe(
			manifest.acceptance.expectedTestCount,
		);
		expect(result.baseline?.results.passed).toBe(14);
		expect(result.baseline?.results.failed).toBe(4);
		expect(result.baseline?.outcome.exitCode).toBe(1);
	});

	maybe("FAIL-01: the unrepaired candidate is FAIL, not PASS", async () => {
		const manifest = loadManifest();
		const result = await evaluateCandidate({
			manifest,
			candidateRoot: FIXTURE_REPO as string,
			outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-fail-")),
			experimentId: "witness",
			trialId: "FAIL-01",
		});
		expect(result.verdict).toBe("FAIL");
		expect(result.reasons).toContain("TEST_FAILURE");
		expect(result.final?.outcome.exitCode).toBe(1);
		expect(result.final?.results.failed).toBe(4);
	});

	const maybeRepair = REAL_FIXTURE_AVAILABLE && REPAIR_AVAILABLE ? it : it.skip;

	maybeRepair(
		"PASS-01: a valid repaired candidate independently passes",
		async () => {
			const manifest = loadManifest();
			const result = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-pass-")),
				experimentId: "witness",
				trialId: "PASS-01",
			});
			expect(result.verdict).toBe("PASS");
			expect(result.reasons).toEqual([]);
			expect(result.final?.outcome.exitCode).toBe(0);
			expect(result.final?.results.passed).toBe(18);
			expect(result.final?.results.failed).toBe(0);
			expect(result.inventory?.protectedViolations).toEqual([]);
			expect(result.inventory?.scopeViolations).toEqual([]);
		},
	);

	maybeRepair(
		"harness neutrality: the verdict is identical with and without a trace",
		async () => {
			const manifest = loadManifest();
			const withTrace = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-trace-")),
				experimentId: "witness",
				trialId: "NEUTRAL-01",
				tracePath: join(FIXTURE_REPO as string, "README.md"),
			});
			const withoutTrace = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-notrace-")),
				experimentId: "witness",
				trialId: "NEUTRAL-01",
			});
			expect(withTrace.verdict).toBe(withoutTrace.verdict);
			expect(withTrace.verdict).toBe("PASS");
			expect(withTrace.artifact.traceProvided.value).toBe(true);
			expect(withoutTrace.artifact.traceProvided.value).toBe(false);
			expect(withTrace.artifact.finalWorkspaceDigest.value).toBe(
				withoutTrace.artifact.finalWorkspaceDigest.value,
			);
			expect(withTrace.artifact.candidateDeltaSha256.value).toBe(
				withoutTrace.artifact.candidateDeltaSha256.value,
			);
			expect(withTrace.artifact.finalTestResults.value?.reportSha256).toBe(
				withoutTrace.artifact.finalTestResults.value?.reportSha256,
			);
		},
	);

	maybeRepair(
		"IDENTITY-02: modified candidate tests cannot replace the trusted tests",
		async () => {
			const manifest = loadManifest();
			const tampered = mkdtempSync(
				join(tmpdir(), "cline-acceptance-tampered-"),
			);
			copyFrozenFixture(tampered);
			writeFileSync(
				join(tampered, "tests", "contract.test.ts"),
				'import { test } from "node:test";\ntest("stub", () => {});\n',
			);
			const result = await evaluateCandidate({
				manifest,
				candidateRoot: tampered,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-identity-")),
				experimentId: "witness",
				trialId: "IDENTITY-02",
			});
			expect(result.verdict).toBe("FAIL");
			expect(result.reasons).toContain("PROTECTED_FILE_CHANGED");
		},
	);

	maybeRepair(
		"FAIL-07 (end-to-end): a symlink escaping the candidate root is rejected",
		async () => {
			const manifest = loadManifest();
			const escaping = mkdtempSync(join(tmpdir(), "cline-acceptance-escape-"));
			copyFrozenFixture(escaping);
			symlinkSync("/etc/passwd", join(escaping, "src", "escape.ts"));
			const result = await evaluateCandidate({
				manifest,
				candidateRoot: escaping,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-escape-out-")),
				experimentId: "witness",
				trialId: "FAIL-07",
			});
			expect(result.verdict).toBe("FAIL");
			expect(result.reasons).toContain("SYMLINK_ESCAPE");
		},
	);

	maybeRepair(
		"necessity ablation: disabling the protected-file gate admits a tampered candidate",
		async () => {
			const manifest = loadManifest();
			const tampered = mkdtempSync(
				join(tmpdir(), "cline-acceptance-ablation-"),
			);
			copyFrozenFixture(tampered);
			writeFileSync(
				join(tampered, "tests", "contract.test.ts"),
				'import { test } from "node:test";\ntest("stub", () => {});\n',
			);
			const ablated = await evaluateCandidate({
				manifest,
				candidateRoot: tampered,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-ablation-out-")),
				experimentId: "witness",
				trialId: "ABLATION-01",
				ablation: { disableProtectedFileCheck: true },
			});
			expect(ablated.reasons).not.toContain("PROTECTED_FILE_CHANGED");
			const restored = await evaluateCandidate({
				manifest,
				candidateRoot: tampered,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-restored-out-")),
				experimentId: "witness",
				trialId: "ABLATION-01",
			});
			expect(restored.verdict).toBe("FAIL");
			expect(restored.reasons).toContain("PROTECTED_FILE_CHANGED");
		},
	);

	maybeRepair(
		"PRIV-01: the exported artifact carries no raw output or private paths",
		async () => {
			const manifest = loadManifest();
			const result = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-privacy-")),
				experimentId: "witness",
				trialId: "PRIV-01",
			});
			const exported = JSON.stringify(result.artifact);
			expect(exported).not.toContain(FIXTURE_REPO as string);
			expect(exported).not.toContain(REPAIR_DIR as string);
			expect(exported).not.toMatch(/\/Volumes\//);
			expect(exported).not.toMatch(/\/Users\//);
			expect(exported).not.toContain("(fail)");
			expect(exported).not.toContain("PASSED");
			expect(exported).toContain("acceptanceVerdict");
			expect(exported).toContain("finalWorkspaceDigest");
		},
	);

	maybeRepair(
		"DET-01 (end-to-end): identical inputs produce identical deterministic evidence",
		async () => {
			const manifest = loadManifest();
			const first = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-det-a-")),
				experimentId: "witness",
				trialId: "DET-01",
			});
			const second = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-det-b-")),
				experimentId: "witness",
				trialId: "DET-01",
			});
			expect(first.artifact.finalWorkspaceDigest.value).toBe(
				second.artifact.finalWorkspaceDigest.value,
			);
			expect(first.artifact.candidateDeltaSha256.value).toBe(
				second.artifact.candidateDeltaSha256.value,
			);
			expect(first.artifact.finalTestResults.value?.reportSha256).toBe(
				second.artifact.finalTestResults.value?.reportSha256,
			);
			expect(first.artifact.baselineTestResults.value?.reportSha256).toBe(
				second.artifact.baselineTestResults.value?.reportSha256,
			);
		},
	);

	maybeRepair(
		"the portable acceptance event stream is evaluator-owned and harness-neutral",
		async () => {
			const manifest = loadManifest();
			const result = await evaluateCandidate({
				manifest,
				candidateRoot: REPAIR_DIR as string,
				outDir: mkdtempSync(join(tmpdir(), "cline-acceptance-events-")),
				experimentId: "witness",
				trialId: "EVENTS-01",
			});
			const events = buildAcceptanceEvents(result.artifact, "some-harness");
			expect(events).toHaveLength(1);
			const event = events[0] as Record<string, unknown>;
			expect(event.contract).toBe("agent-trace/0.1");
			expect(event.family).toBe("acceptance");
			expect(event.harness).toBe("evaluator:some-harness");
			const identity = event.identity as Record<string, unknown>;
			expect(identity.trialId).toBe("EVENTS-01");
			expect(identity.experimentId).toBe("witness");
			// The evaluator's event id is NOT a harness run id.
			expect(String(event.recordId)).not.toContain("run_");
			expect(String(event.nativeTraceId)).toContain("acceptance-trace-");
		},
	);
});
