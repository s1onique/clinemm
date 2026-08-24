#!/usr/bin/env bun
/**
 * Phase 1.E — Verify v2 behavioral equivalence.
 *
 * ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01.
 *
 * Compares the reconstructed helper's normalized output against the
 * legacy helper's normalized output (frozen in
 * `.factory/oracle/REFERENCE_PROTOCOL_V2.json`) for every corpus
 * entry. Emits per-entry PASS/FAIL, plus a final PASS_HELPER_SOURCE_
 * RECONSTRUCTED_V2_EQUIVALENT or HALT_V2_ORACLE_MISMATCH verdict.
 *
 * Invocation:
 *   bun sdk/packages/core/parser-helper-src/scripts/verify-v2-equivalence.mjs <reconstructed-binary-path>
 *
 * Scope guard: does NOT add shellStatic, does NOT bump protocol
 * version, does NOT replace vendored binaries, does NOT touch TS V2
 * echo authority.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORACLE_PATH = join(__dirname, "..", ".factory", "oracle", "REFERENCE_PROTOCOL_V2.json");
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const LEGACY_HELPER = join(PROJECT_ROOT, "sdk", "packages", "core", "bin", "parser-helper", "darwin-arm64", "cline-parser-helper");

const reconstructedPath = process.argv[2];
if (!reconstructedPath) {
	console.error("Usage: verify-v2-equivalence.mjs <reconstructed-binary-path>");
	process.exit(2);
}

const oracle = JSON.parse(readFileSync(ORACLE_PATH, "utf8"));
const corpus = oracle.corpus;

function normalize(value) {
	function recurse(v) {
		if (Array.isArray(v)) return v.map(recurse);
		if (v && typeof v === "object") {
			const sorted = {};
			for (const k of Object.keys(v).sort()) sorted[k] = recurse(v[k]);
			return sorted;
		}
		return v;
	}
	return JSON.stringify(recurse(value));
}

function invoke(binaryPath, source) {
	const stdinPayload = JSON.stringify({ dialect: "bash", source });
	const res = spawnSync(binaryPath, [], { input: stdinPayload, encoding: "utf8", timeout: 5000 });
	if (res.status !== 0 || !res.stdout) return null;
	try { return JSON.parse(res.stdout); } catch { return null; }
}

let failed = 0;
const failures = [];

for (const entry of corpus) {
	const legacyRaw = invoke(LEGACY_HELPER, entry.source);
	const newRaw = invoke(reconstructedPath, entry.source);

	const legacyNorm = legacyRaw == null ? "<null>" : normalize(legacyRaw);
	const newNorm = newRaw == null ? "<null>" : normalize(newRaw);

	if (legacyNorm === newNorm) {
		process.stdout.write(".");
	} else {
		failed++;
		failures.push({ id: entry.id, source: entry.source, legacyNorm, newNorm });
		process.stdout.write("F");
	}
}

process.stdout.write("\n\n");

if (failed === 0) {
	console.log("=== PASS_HELPER_SOURCE_RECONSTRUCTED_V2_EQUIVALENT ===");
	console.log(`${corpus.length}/${corpus.length} corpus entries normalized-equivalent.`);
	console.log(`Legacy SHA-256:    ${oracle.hostPlatform}`);
	console.log(`Reconstructed:     ${reconstructedPath}`);
	console.log(`Protocol version:  ${oracle.protocolVersion}`);
	process.exit(0);
} else {
	console.log(`=== HALT_V2_ORACLE_MISMATCH ===`);
	console.log(`${failed}/${corpus.length} corpus entries diverged.`);
	for (const f of failures) {
		console.log(`\n--- ${f.id} ---`);
		console.log(`source: ${f.source}`);
		console.log(`legacy: ${f.legacyNorm}`);
		console.log(`new:    ${f.newNorm}`);
	}
	process.exit(1);
}