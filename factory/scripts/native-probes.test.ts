#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-2 focused helper tests.
 *
 * Pure unit tests for `canonicalizeProbeForBundle()` and
 * `requireAllCanonicalProbes()`. The helper was extracted precisely so
 * these cases can run without copying the production runner into a
 * temporary Git repository.
 *
 * Each test pins one contract claim of the helper:
 *
 *   - valid record → record/bytes/hashes agree
 *   - null record  → NATIVE_PROBE_RECORD_MISSING
 *   - undefined record → NATIVE_PROBE_RECORD_MISSING
 *   - id mismatch  → NATIVE_PROBE_ID_MISMATCH (refuses to overwrite)
 *   - missing stdout → NATIVE_PROBE_STDOUT_MISSING
 *   - missing stderr → NATIVE_PROBE_STDERR_MISSING
 *   - empty output → zero-byte buffer, deterministic empty sha
 *   - Unicode output → byte-for-byte utf8 encoding, hashes derived from bytes
 *   - canonical paths → stdout/stderr/metadata paths are fixed
 *   - layout version → stream_layout_version is the constant
 *   - byte/hash agreement → sha256(stdoutBytes) === record.stdout_sha256
 *   - metadata equality → metadataBytes parses back to the record
 *   - non-mutation → input probe is not mutated
 *
 * `requireAllCanonicalProbes()` is covered for completeness and
 * for the partial-map rejection path.
 *
 * `stableStringify()` is covered for property-order independence so
 * the metadata serialization is shown to be a deliberate,
 * deterministic rule (not an artefact of insertion order).
 *
 * Run with:
 *   bun test factory/scripts/native-probes.test.ts
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
	canonicalStreamPaths,
	canonicalizeProbeForBundle,
	NATIVE_PROBE_IDS,
	NATIVE_PROBE_STREAM_LAYOUT_VERSION,
	type NativeProbe,
	type NativeProbeId,
	PartialBundledNativeProbeMap,
	requireAllCanonicalProbes,
	stableStringify,
} from "./native-probes";

const HEAD_OID = "0123456789abcdef0123456789abcdef01234567";
const TREE_OID = "89abcdef0123456789abcdef0123456789abcdef";
const SUBJECT_OID = "1234abcd1234abcd1234abcd1234abcd1234abcd";

/** SHA-256 of the UTF-8 encoding of a string, as lowercase hex. */
function sha256Of(value: Buffer | string): string {
	return createHash("sha256").update(value).digest("hex");
}

/**
 * Minimal valid collected probe record. All required fields are
 * populated so the helper accepts the record; individual tests
 * mutate the value to exercise the failure paths.
 */
function makeProbe(id: NativeProbeId, overrides: Partial<NativeProbe> = {}): NativeProbe {
	const base: NativeProbe = {
		id,
		// Legacy fields (CORRECTION15).
		path: `node_modules/${id}/package.json`,
		architecture: "darwin-arm64",
		sha256: "0".repeat(64),
		file_format: "(no output captured)",
		status: "pass",
		reason: "fixture",
		// Extended execution-record fields (CORRECTION16/17).
		artifact_path: `node_modules/${id}/package.json`,
		artifact_sha256: null,
		artifact_size: 0,
		artifact_exists: false,
		argv: ["node", "-e", "console.log('fixture')"],
		exit_code: 0,
		signal: null,
		timeout: false,
		stdout_text: `stdout-${id}\n`,
		stdout_sha256: "0".repeat(64),
		stderr_text: `stderr-${id}\n`,
		stderr_sha256: "0".repeat(64),
		observed_file_format: null,
		observed_architecture: null,
		execution_head_oid: HEAD_OID,
		execution_tree_oid: TREE_OID,
		subject_tree_oid: SUBJECT_OID,
		host_class: "darwin-arm64",
		host_supported: true,
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		started_at: "2026-01-01T00:00:00.000Z",
		finished_at: "2026-01-01T00:00:00.500Z",
		duration_ms: 500,
		working_directory: ".",
		format_match_source: "stdout",
		format_match_pattern_source: "fixture",
		format_match_pattern_flags: "",
		architecture_assert: "host-class",
		success_contract_version: 1,
		invocation_id: "20260101-fixture",
		// µC-3 round 3 — the structured failure kind and companion
		// message the parser copies to the bundled record so the
		// metadata semantic-equality check stays byte-equal.
		failure_kind: "pass",
		failure_message: "",
	};
	return {...base, ...overrides};
}

describe("canonicalizeProbeForBundle — happy paths", () => {
	it("returns a record/bytes/hashes triple for a valid probe", () => {
		const probe = makeProbe("p1_better_sqlite3");
		const result = canonicalizeProbeForBundle("p1_better_sqlite3", probe);
		expect(result.record.id).toBe("p1_better_sqlite3");
		expect(result.stdoutBytes.toString("utf8")).toBe(probe.stdout_text);
		expect(result.stderrBytes.toString("utf8")).toBe(probe.stderr_text);
		// Hashes are computed from the exact returned buffers.
		expect(sha256Of(result.stdoutBytes)).toBe(result.record.stdout_sha256);
		expect(sha256Of(result.stderrBytes)).toBe(result.record.stderr_sha256);
	});

	it("derives stream_layout_version from the constant", () => {
		const result = canonicalizeProbeForBundle("p2_protobuf", makeProbe("p2_protobuf"));
		expect(result.record.stream_layout_version).toBe(NATIVE_PROBE_STREAM_LAYOUT_VERSION);
		expect(result.record.stream_layout_version).toBe(1);
	});

	it("assigns canonical stream paths derived from the probe id only", () => {
		const result = canonicalizeProbeForBundle("p3_ripgrep_darwin_arm64", makeProbe("p3_ripgrep_darwin_arm64"));
		const expected = canonicalStreamPaths("p3_ripgrep_darwin_arm64");
		expect(result.record.stdout_path).toBe(expected.stdout_path);
		expect(result.record.stderr_path).toBe(expected.stderr_path);
		expect(result.record.metadata_path).toBe(expected.metadata_path);
		expect(result.record.stdout_path).toBe("native-probes/p3_ripgrep_darwin_arm64.stdout");
		expect(result.record.stderr_path).toBe("native-probes/p3_ripgrep_darwin_arm64.stderr");
		expect(result.record.metadata_path).toBe("native-probes/p3_ripgrep_darwin_arm64.metadata.json");
	});

	it("encodes empty output as a present zero-byte buffer", () => {
		const probe = makeProbe("p4_vscode_host", {stdout_text: "", stderr_text: ""});
		const result = canonicalizeProbeForBundle("p4_vscode_host", probe);
		expect(result.stdoutBytes.length).toBe(0);
		expect(result.stderrBytes.length).toBe(0);
		// SHA-256 of an empty buffer is the well-known e3b0c44... constant.
		expect(result.record.stdout_sha256).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(result.record.stderr_sha256).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("encodes Unicode output byte-for-byte from utf8 and hashes the bytes", () => {
		const unicodeStdout = "Привет мир 🚀 αβγ\n";
		const unicodeStderr = "エラー: 不正な値 ✗\n";
		const probe = makeProbe("p5_cline_version", {
			stdout_text: unicodeStdout,
			stderr_text: unicodeStderr,
		});
		const result = canonicalizeProbeForBundle("p5_cline_version", probe);
		expect(result.stdoutBytes.toString("utf8")).toBe(unicodeStdout);
		expect(result.stderrBytes.toString("utf8")).toBe(unicodeStderr);
		// Hashes derived from the returned bytes, not the input string.
		expect(result.record.stdout_sha256).toBe(sha256Of(result.stdoutBytes));
		expect(result.record.stderr_sha256).toBe(sha256Of(result.stderrBytes));
		// And independently from a fresh encode of the same text.
		expect(result.record.stdout_sha256).toBe(sha256Of(Buffer.from(unicodeStdout, "utf8")));
		expect(result.record.stderr_sha256).toBe(sha256Of(Buffer.from(unicodeStderr, "utf8")));
	});
});

describe("canonicalizeProbeForBundle — failure modes (fail-closed)", () => {
	it("throws NATIVE_PROBE_RECORD_MISSING for a null record", () => {
		expect(() => canonicalizeProbeForBundle("p1_better_sqlite3", null)).toThrow(
			/NATIVE_PROBE_RECORD_MISSING:p1_better_sqlite3/,
		);
	});

	it("throws NATIVE_PROBE_RECORD_MISSING for an undefined record", () => {
		expect(() => canonicalizeProbeForBundle("p2_protobuf", undefined)).toThrow(
			/NATIVE_PROBE_RECORD_MISSING:p2_protobuf/,
		);
	});

	it("throws NATIVE_PROBE_ID_MISMATCH when the record id does not match the argument", () => {
		const probe = makeProbe("p1_better_sqlite3");
		expect(() => canonicalizeProbeForBundle("p2_protobuf", probe)).toThrow(
			/NATIVE_PROBE_ID_MISMATCH:p2_protobuf:record=p1_better_sqlite3/,
		);
	});

	it("throws NATIVE_PROBE_STDOUT_MISSING when stdout_text is missing", () => {
		// Build a probe and then assert against a record that omits stdout_text.
		const base = makeProbe("p1_better_sqlite3");
		const broken = {...base} as Partial<NativeProbe>;
		delete (broken as {stdout_text?: string}).stdout_text;
		expect(() => canonicalizeProbeForBundle("p1_better_sqlite3", broken as NativeProbe)).toThrow(
			/NATIVE_PROBE_STDOUT_MISSING:p1_better_sqlite3/,
		);
	});

	it("throws NATIVE_PROBE_STDOUT_MISSING when stdout_text is not a string", () => {
		const base = makeProbe("p2_protobuf");
		const broken = {...base, stdout_text: 42 as unknown as string};
		expect(() => canonicalizeProbeForBundle("p2_protobuf", broken)).toThrow(
			/NATIVE_PROBE_STDOUT_MISSING:p2_protobuf/,
		);
	});

	it("throws NATIVE_PROBE_STDERR_MISSING when stderr_text is missing", () => {
		const base = makeProbe("p1_better_sqlite3");
		const broken = {...base} as Partial<NativeProbe>;
		delete (broken as {stderr_text?: string}).stderr_text;
		expect(() => canonicalizeProbeForBundle("p1_better_sqlite3", broken as NativeProbe)).toThrow(
			/NATIVE_PROBE_STDERR_MISSING:p1_better_sqlite3/,
		);
	});

	it("throws NATIVE_PROBE_STDERR_MISSING when stderr_text is not a string", () => {
		const base = makeProbe("p2_protobuf");
		const broken = {...base, stderr_text: null as unknown as string};
		expect(() => canonicalizeProbeForBundle("p2_protobuf", broken)).toThrow(
			/NATIVE_PROBE_STDERR_MISSING:p2_protobuf/,
		);
	});
});

describe("canonicalizeProbeForBundle — invariants", () => {
	it("does not mutate the input probe", () => {
		const probe = makeProbe("p1_better_sqlite3");
		const snapshot = JSON.stringify(probe);
		canonicalizeProbeForBundle("p1_better_sqlite3", probe);
		expect(JSON.stringify(probe)).toBe(snapshot);
		// And specifically: the helper MUST NOT overwrite stdout_sha256 on
		// the input record, even when the input hash is wrong. The helper
		// returns a fresh record.
		expect(probe.stdout_sha256).toBe("0".repeat(64));
	});

	it("the staged metadataBytes parses back to the returned record (semantic equality)", () => {
		const result = canonicalizeProbeForBundle("p1_better_sqlite3", makeProbe("p1_better_sqlite3"));
		const text = result.metadataBytes.toString("utf8");
		// Trailing newline — the helper always terminates with a single LF.
		expect(text.endsWith("\n")).toBe(true);
		const parsed = JSON.parse(text.replace(/\n$/, ""));
		// Semantic equality via stableStringify — byte-level canonical
		// comparison tolerates property insertion order differences on
		// both sides, but the helper also writes a stable serialization
		// so a direct equal-check works.
		expect(stableStringify(parsed)).toBe(stableStringify(result.record));
		// And the concrete values:
		expect(parsed.id).toBe(result.record.id);
		expect(parsed.stdout_path).toBe(result.record.stdout_path);
		expect(parsed.stderr_path).toBe(result.record.stderr_path);
		expect(parsed.metadata_path).toBe(result.record.metadata_path);
		expect(parsed.stream_layout_version).toBe(NATIVE_PROBE_STREAM_LAYOUT_VERSION);
		expect(parsed.stdout_sha256).toBe(result.record.stdout_sha256);
		expect(parsed.stderr_sha256).toBe(result.record.stderr_sha256);
	});

	it("recomputed hashes match the bytes the caller must stage", () => {
		const result = canonicalizeProbeForBundle("p2_protobuf", makeProbe("p2_protobuf"));
		// Independent SHA over the same byte sequence.
		expect(result.record.stdout_sha256).toBe(sha256Of(result.stdoutBytes));
		expect(result.record.stderr_sha256).toBe(sha256Of(result.stderrBytes));
	});

	it("rejects id drift between caller argument and record id", () => {
		const probe = makeProbe("p3_ripgrep_darwin_arm64");
		// Even though the helper would otherwise succeed, the id mismatch
		// must surface before any byte work — the failure message must
		// reference both ids.
		let caught: Error | null = null;
		try {
			canonicalizeProbeForBundle("p4_vscode_host", probe);
		} catch (error) {
			caught = error as Error;
		}
		expect(caught).not.toBeNull();
		expect(caught?.message).toContain("NATIVE_PROBE_ID_MISMATCH");
		expect(caught?.message).toContain("p4_vscode_host");
		expect(caught?.message).toContain("p3_ripgrep_darwin_arm64");
	});
});

describe("requireAllCanonicalProbes — checked completeness", () => {
	it("returns the full Record when all five canonical probes are present", () => {
		const partial: PartialBundledNativeProbeMap = {};
		for (const id of NATIVE_PROBE_IDS) {
			const {record} = canonicalizeProbeForBundle(id, makeProbe(id));
			partial[id] = record;
		}
		const full = requireAllCanonicalProbes(partial);
		for (const id of NATIVE_PROBE_IDS) {
			expect(full[id].id).toBe(id);
		}
	});

	it("throws NATIVE_PROBE_INCOMPLETE listing missing ids when one record is absent", () => {
		const partial: PartialBundledNativeProbeMap = {};
		for (const id of NATIVE_PROBE_IDS) {
			if (id === "p2_protobuf") continue;
			const {record} = canonicalizeProbeForBundle(id, makeProbe(id));
			partial[id] = record;
		}
		expect(() => requireAllCanonicalProbes(partial)).toThrow(
			/NATIVE_PROBE_INCOMPLETE.*p2_protobuf/,
		);
	});

	it("throws NATIVE_PROBE_INCOMPLETE listing multiple missing ids when several are absent", () => {
		const partial: PartialBundledNativeProbeMap = {};
		const {record} = canonicalizeProbeForBundle(
			"p1_better_sqlite3",
			makeProbe("p1_better_sqlite3"),
		);
		partial.p1_better_sqlite3 = record;
		expect(() => requireAllCanonicalProbes(partial)).toThrow(
			/NATIVE_PROBE_INCOMPLETE/,
		);
	});

	it("throws NATIVE_PROBE_INCOMPLETE on an empty partial map", () => {
		expect(() => requireAllCanonicalProbes({})).toThrow(/NATIVE_PROBE_INCOMPLETE/);
	});
});

describe("stableStringify — deterministic metadata serialization", () => {
	it("produces identical output regardless of property insertion order", () => {
		const a = {z: 1, a: 2, m: 3};
		const b = {m: 3, a: 2, z: 1};
		const c = {a: 2, z: 1, m: 3};
		expect(stableStringify(a)).toBe(stableStringify(b));
		expect(stableStringify(b)).toBe(stableStringify(c));
	});

	it("recurses into nested objects and arrays", () => {
		const a = {x: [3, 1, 2], y: {z: 1, a: 2}};
		const b = {y: {a: 2, z: 1}, x: [3, 1, 2]};
		expect(stableStringify(a)).toBe(stableStringify(b));
	});

	it("differentiates semantically distinct values that share a sorted serialisation", () => {
		// Two different objects that would NOT be considered equal even
		// after sorting — `stableStringify` is byte-level, not semantic.
		// This guards against the helper being misread as a "semantic
		// canonicalization" — the writer and reader must share the
		// exact same deterministic rule.
		const a = {a: 1, b: 2};
		const b = {a: 2, b: 1};
		expect(stableStringify(a)).not.toBe(stableStringify(b));
	});
});
