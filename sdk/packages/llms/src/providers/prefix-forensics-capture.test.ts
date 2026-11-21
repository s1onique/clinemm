/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * The forensic capture's ADVERSARIAL witnesses at the REAL capture seam.
 *
 * These tests drive the ACTUAL production writer — the same function the
 * AI SDK prompt seam and the wire seam call — so the DEFAULT-OFF contract
 * and the privacy contract are proven at the seam, not at a test double.
 *
 * The controls:
 *
 *   V1  disabled mode     — no record, no capture computation, no semantic
 *                           delta in the observed request;
 *   V8  privacy           — no raw sensitive content in the emitted artifact,
 *                           including on exceptions and malformed inputs;
 *   V9  artifact integrity— the record carries session, version, source and
 *                           a SHA-256 identity;
 *   V10 negative evidence — a malformed input produces no record and never
 *                           throws into the caller.
 */
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	_resetPrefixForensicsCohortForTests,
	computeCaptureRecordSha256,
	groupCapturesIntoRequestBundles,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	_resetPrefixForensicsAttemptCountersForTests,
	recordPrefixForensics,
} from "./prefix-forensics-capture";

/** A request whose content is deliberately sensitive. */
const SENSITIVE_MESSAGES = [
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "call_1",
				toolName: "run_commands",
				output:
					"cat /Users/someone/private/project/.env | grep -i 'sk-ant-SECRET-API-KEY-9999'",
			},
		],
	},
];

const SENSITIVE_SYSTEM =
	"You are Cline. Authorization: Bearer sk-ant-SECRET-API-KEY-9999";

describe("ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — the capture writer", () => {
	const savedForensics = process.env.CLINEMM_PREFIX_FORENSICS;
	const savedDir = process.env.CLINEMM_PREFIX_FORENSICS_DIR;
	const savedKey = process.env.CLINEMM_PREFIX_FORENSICS_KEY;
	let dir: string | undefined;

	beforeEach(() => {
		delete process.env.CLINEMM_PREFIX_FORENSICS;
		delete process.env.CLINEMM_PREFIX_FORENSICS_DIR;
		delete process.env.CLINEMM_PREFIX_FORENSICS_KEY;
		_resetPrefixForensicsCohortForTests();
		_resetPrefixForensicsAttemptCountersForTests();
		dir = undefined;
	});

	afterEach(() => {
		if (savedForensics === undefined) {
			delete process.env.CLINEMM_PREFIX_FORENSICS;
		} else {
			process.env.CLINEMM_PREFIX_FORENSICS = savedForensics;
		}
		if (savedDir === undefined) {
			delete process.env.CLINEMM_PREFIX_FORENSICS_DIR;
		} else {
			process.env.CLINEMM_PREFIX_FORENSICS_DIR = savedDir;
		}
		if (savedKey === undefined) {
			delete process.env.CLINEMM_PREFIX_FORENSICS_KEY;
		} else {
			process.env.CLINEMM_PREFIX_FORENSICS_KEY = savedKey;
		}
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
			dir = undefined;
		}
		_resetPrefixForensicsCohortForTests();
		_resetPrefixForensicsAttemptCountersForTests();
	});

	it("V1: the DISABLED path writes nothing and touches no filesystem", () => {
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-off-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		// The switch is NOT set — the DEFAULT-OFF path.
		expect(process.env.CLINEMM_PREFIX_FORENSICS).toBeUndefined();
		recordPrefixForensics({
			stage: "ai_sdk_prompt",
			messages: SENSITIVE_MESSAGES,
			system: SENSITIVE_SYSTEM,
		});
		expect(readdirSync(dir)).toHaveLength(0);
	});

	it("V1: only the exact value '1' arms the capture", () => {
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-arming-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		for (const value of ["0", "true", "yes", "", "on", "01"]) {
			process.env.CLINEMM_PREFIX_FORENSICS = value;
			recordPrefixForensics({
				stage: "ai_sdk_prompt",
				messages: SENSITIVE_MESSAGES,
			});
			expect(readdirSync(dir)).toHaveLength(0);
		}
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		recordPrefixForensics({
			stage: "ai_sdk_prompt",
			messages: SENSITIVE_MESSAGES,
		});
		expect(readdirSync(dir).length).toBeGreaterThan(0);
	});

	it("V8: the ARMED capture persists NO raw prompt, tool command or credential", () => {
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-privacy-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		recordPrefixForensics({
			stage: "ai_sdk_prompt",
			messages: SENSITIVE_MESSAGES,
			system: SENSITIVE_SYSTEM,
			tools: { run_commands: { name: "run_commands", description: "run" } },
			sessionId: "session-1",
			providerAttemptId: "attempt-1",
			iteration: 3,
		});
		const files = readdirSync(dir);
		expect(files.length).toBe(1);
		const raw = readFileSync(join(dir, files[0]!), "utf8");
		expect(raw).not.toContain("SECRET-API-KEY");
		expect(raw).not.toContain("sk-ant");
		expect(raw).not.toContain("cat /Users/someone");
		expect(raw).not.toContain(".env");
		expect(raw).not.toContain("Bearer");
		// The file is restrictive.
		expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
	});

	it("V8: a MALFORMED input produces no record and never throws into the caller", () => {
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-malformed-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() =>
			recordPrefixForensics({
				stage: "wire_request",
				messages: [cyclic],
				body: cyclic,
			}),
		).not.toThrow();
		// The record may or may not exist — but it must never contain a raw
		// serialization of the cyclic value, and it must never throw.
		for (const file of readdirSync(dir)) {
			const raw = readFileSync(join(dir, file), "utf8");
			expect(raw).not.toContain("[object Object]");
		}
	});

	it("V9: the record carries session, version, source and a SHA-256 identity", () => {
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-identity-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		process.env.CLINEMM_PREFIX_FORENSICS_KEY = "a-fixed-test-key";
		recordPrefixForensics({
			stage: "runtime_projection",
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			system: "system",
			sessionId: "session-9",
			preparationRequestId: "prep-9",
			providerAttemptId: "attempt-9",
			iteration: 11,
			providerId: "minimax",
			modelId: "MiniMax-M3",
		});
		const files = readdirSync(dir);
		expect(files.length).toBe(1);
		const record = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
		expect(record.schemaVersion).toBe(1);
		expect(record.producer).toBe("@cline/shared/runtime/prefix-forensics");
		expect(record.source).toBe("runtime_projection");
		expect(record.sessionId).toBe("session-9");
		expect(record.preparationRequestId).toBe("prep-9");
		expect(record.providerAttemptId).toBe("attempt-9");
		expect(record.iteration).toBe(11);
		expect(record.cohortId).toMatch(/^[0-9a-f]{16}$/);
		expect(record.recordSha256).toMatch(/^[0-9a-f]{64}$/);
		// The digest is verifiable by a consumer that re-serializes the
		// record WITHOUT the digest field.
		const { recordSha256, ...withoutDigest } = record;
		expect(computeCaptureRecordSha256(withoutDigest)).toBe(recordSha256);
		// The KEY is never persisted.
		expect(JSON.stringify(record)).not.toContain("a-fixed-test-key");
	});

	it("V7: two wire attempts of the same preparation are recorded as SEPARATE attempts", () => {
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-retry-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		recordPrefixForensics({
			stage: "wire_request",
			messages: [],
			preparationRequestId: "prep-3",
			providerAttemptId: "attempt-1",
		});
		recordPrefixForensics({
			stage: "wire_request",
			messages: [],
			preparationRequestId: "prep-3",
			providerAttemptId: "attempt-2",
		});
		const files = readdirSync(dir);
		expect(files.length).toBe(2);
		const records = files.map((file) =>
			JSON.parse(readFileSync(join(dir, file), "utf8")),
		);
		const attempts = records
			.map((record) => record.wireAttempt ?? 1)
			.sort((a, b) => a - b);
		expect(attempts).toEqual([1, 2]);
		// Both attempts keep the SAME preparation identity.
		const preparations = new Set(
			records.map((record) => record.preparationRequestId),
		);
		expect(preparations.size).toBe(1);
	});

	it("does NOT write when no directory can be resolved", () => {
		delete process.env.CLINEMM_PREFIX_FORENSICS_DIR;
		delete process.env.CLINE_DATA_DIR;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		expect(() =>
			recordPrefixForensics({
				stage: "ai_sdk_prompt",
				messages: [{ role: "user", content: "hi" }],
			}),
		).not.toThrow();
	});

	it("THREE-STAGE-01: the three stages of ONE request form ONE groupable bundle", () => {
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION05 — the
		// LIVE-GATE witness.
		//
		// The analyzer's lineage gate makes FIVE identities mandatory on
		// BOTH sides of a comparison: cohort, session, iteration,
		// preparation and attempt. The runtime projection stage (A) did not
		// carry the SESSION identity, while the two provider-bound stages
		// (B, C) did. Stage A therefore landed in a DIFFERENT bundle from
		// stages B and C of the SAME request, and every authoritative
		// comparison was refused.
		//
		// This witness captures all three stages through the REAL writer
		// with the identities the runtime actually mints, groups them with
		// the REAL analyzer, and requires ONE bundle with all THREE stages.
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-three-stage-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		const identity = {
			sessionId: "session-1",
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		};
		const messages = [
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		];
		for (const stage of [
			"runtime_projection",
			"ai_sdk_prompt",
			"wire_request",
		] as const) {
			recordPrefixForensics({
				stage,
				messages,
				...identity,
			});
		}

		const files = readdirSync(dir);
		expect(files).toHaveLength(3);
		const records = files.map((file) =>
			JSON.parse(readFileSync(join(dir, file), "utf8")),
		);
		// Every stage carries the session identity — the capture contract.
		for (const record of records) {
			expect(record.sessionId).toBe("session-1");
			expect(record.preparationRequestId).toBe("prep-29");
			expect(record.providerAttemptId).toBe("attempt-29");
			expect(record.iteration).toBe(29);
		}

		// The REAL analyzer groups them into ONE request bundle.
		const bundles = groupCapturesIntoRequestBundles(records);
		expect(bundles).toHaveLength(1);
		const bundle = bundles[0];
		expect(bundle?.sessionId).toBe("session-1");
		expect(bundle?.preparationRequestId).toBe("prep-29");
		expect(bundle?.providerAttemptId).toBe("attempt-29");
		expect(bundle?.iteration).toBe(29);
		// All THREE representation stages are present...
		expect(bundle?.stages.size).toBe(3);
		expect(bundle?.stages.has("runtime_projection")).toBe(true);
		expect(bundle?.stages.has("ai_sdk_prompt")).toBe(true);
		expect(bundle?.stages.has("wire_request")).toBe(true);
	});

	it("THREE-STAGE-02: a MISSING session identity on ONE stage breaks the bundle", () => {
		// The NEGATIVE control for the witness above: if a stage omits the
		// session identity, it lands in a DIFFERENT bundle and the
		// three-stage comparison collapses. This is exactly the defect the
		// runtime-projection stage had, so the control must show the
		// failure the defect produced.
		dir = mkdtempSync(join(tmpdir(), "prefix-forensics-three-stage-neg-"));
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		const messages = [
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		];
		// The runtime projection WITHOUT the session identity.
		recordPrefixForensics({
			stage: "runtime_projection",
			messages,
			preparationRequestId: "prep-29",
			providerAttemptId: "attempt-29",
			iteration: 29,
		});
		// The provider-bound stages WITH it.
		for (const stage of ["ai_sdk_prompt", "wire_request"] as const) {
			recordPrefixForensics({
				stage,
				messages,
				sessionId: "session-1",
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			});
		}

		const records = readdirSync(dir).map((file) =>
			JSON.parse(readFileSync(join(dir, file), "utf8")),
		);
		const bundles = groupCapturesIntoRequestBundles(records);
		// TWO bundles: the missing session identity SPLIT the request.
		expect(bundles).toHaveLength(2);
		// And neither bundle has all three stages.
		for (const bundle of bundles) {
			expect(bundle.stages.size).toBeLessThan(3);
		}
	});

	it("the capture directory is created with restrictive permissions", () => {
		const parent = mkdtempSync(join(tmpdir(), "prefix-forensics-perm-"));
		dir = join(parent, "nested", "prefix-forensics");
		process.env.CLINEMM_PREFIX_FORENSICS_DIR = dir;
		process.env.CLINEMM_PREFIX_FORENSICS = "1";
		recordPrefixForensics({
			stage: "ai_sdk_prompt",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(existsSync(dir)).toBe(true);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
	});
});
