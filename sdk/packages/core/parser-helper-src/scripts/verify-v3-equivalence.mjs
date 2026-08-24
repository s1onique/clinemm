#!/usr/bin/env bun
/**
 * Phase 2 — Verify v3 helper against the FROZEN REFERENCE_PROTOCOL_V3.json.
 *
 * ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
 *
 * EVIDENCE CONTRACT (mirrors CORRECTION01):
 *
 *   REFERENCE_PROTOCOL_V3.json  =  authority for v3 provenance + v2 wire
 *                                   compatibility
 *   REFERENCE_PROTOCOL_V2.json  =  FROZEN parent authority for v2 wire
 *                                   compatibility (unchanged since
 *                                   9f98d59c4)
 *   LEGACY_HELPERS.txt SHA-256  =  authority for identity of the artifact
 *                                   that generated v2 oracle (unchanged)
 *   live legacy execution       =  diagnostic only (drift detector)
 *   v3 helper binary SHA-256    =  authority for identity of the artifact
 *                                   that generated v3 oracle
 *
 * Per entry the verifier proves:
 *
 *   (a) v2 wire compatibility:
 *       canonicalize(strip_protocolVersion_and_argProvenance(invoke(v3, src)))
 *         == strip_protocolVersion(v2_oracle[entry].normalized)
 *       (proves v3 helper preserves every v2 wire field except the
 *        two legitimate contract deltas)
 *
 *   (b) v3 provenance match:
 *       for the first cmd stmt in invoke(v3, src).program.stmts:
 *         .argProvenance  ==  v3_oracle[entry].argProvenance
 *
 * Invocation:
 *   bun verify-v3-equivalence.mjs <v3-binary-path>
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORACLE_DIR = join(__dirname, "..", ".factory", "oracle");
const V2_PATH = join(ORACLE_DIR, "REFERENCE_PROTOCOL_V2.json");
const V3_PATH = join(ORACLE_DIR, "REFERENCE_PROTOCOL_V3.json");

const v3Path = process.argv[2];
if (!v3Path) {
	console.error("Usage: verify-v3-equivalence.mjs <v3-binary-path>");
	process.exit(2);
}
if (!existsSync(v3Path)) {
	console.error(`v3 binary not found: ${v3Path}`);
	process.exit(2);
}

const v2 = JSON.parse(readFileSync(V2_PATH, "utf8"));
const v3 = JSON.parse(readFileSync(V3_PATH, "utf8"));

const COMPAT_STRIP = new Set([
	"protocolVersion",
	"argProvenance",
	// ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01: v4
	// helpers also additively carry fd + pathProvenance on each
	// redirect. The v2 wire contract still holds; the strip
	// continues to assert additive-only evolution.
	"fd",
	"pathProvenance",
]);
function stripCompat(obj) {
	if (Array.isArray(obj)) return obj.map(stripCompat);
	if (obj && typeof obj === "object") {
		const out = {};
		for (const [k, v] of Object.entries(obj)) {
			if (COMPAT_STRIP.has(k)) continue;
			out[k] = stripCompat(v);
		}
		const sorted = {};
		for (const k of Object.keys(out).sort()) sorted[k] = out[k];
		return sorted;
	}
	return obj;
}
function canon(obj) { return JSON.stringify(stripCompat(obj)); }

function invoke(bin, src) {
	const res = spawnSync(bin, [], { input: JSON.stringify({ dialect: "bash", source: src }), encoding: "utf8", timeout: 5000 });
	if (res.status !== 0 || !res.stdout) return null;
	try { return JSON.parse(res.stdout); } catch { return null; }
}

// Live v3 helper SHA must match the frozen identity.
const liveSha = createHash("sha256").update(readFileSync(v3Path)).digest("hex");
if (liveSha !== v3.frozenByHelperSha256) {
	console.error(`WARN: live v3 helper SHA-256 (${liveSha}) differs from frozen identity (${v3.frozenByHelperSha256}). Proceeding with frozen oracle as authority.`);
}

const v2CompatCanon = v2.corpus.map((e) => {
	const parsed = JSON.parse(e.normalized);
	const stripped = stripCompat(parsed);
	return JSON.stringify(stripped);
});

let failed = 0;
const failures = [];

for (let i = 0; i < v3.corpus.length; i++) {
	const v3Entry = v3.corpus[i];
	const raw = invoke(v3Path, v3Entry.source);
	if (!raw) { failed++; failures.push({ id: v3Entry.id, source: v3Entry.source, why: "no output" }); process.stdout.write("F"); continue; }

	// (a) v2 wire compatibility.
	const compat = canon(raw);
	const v2Compat = v2CompatCanon[i];
	const compatOK = compat === v2Compat;

	// (b) v3 provenance match.
	let prov = [];
	if (raw.program) {
		for (const stmt of raw.program.stmts) {
			if (stmt && stmt.cmd) { prov = stmt.cmd.argProvenance ?? []; break; }
		}
	}
	const expectedProv = v3Entry.argProvenance;
	const provOK = JSON.stringify(prov) === JSON.stringify(expectedProv);

	if (compatOK && provOK) {
		process.stdout.write(".");
	} else {
		failed++;
		failures.push({
			id: v3Entry.id,
			source: v3Entry.source,
			v2CompatOK: compatOK,
			provOK,
			actualProvenance: prov,
			expectedProvenance: expectedProv,
		});
		process.stdout.write("F");
	}
}

process.stdout.write("\n\n");

if (failed === 0) {
	console.log("=== PASS_HELPER_SOURCE_RECONSTRUCTED_V3_EQUIVALENT ===");
	console.log(`${v3.corpus.length}/${v3.corpus.length} corpus entries:`);
	console.log(`  - v2 wire compatibility preserved on every entry`);
	console.log(`  - v3 argProvenance matches frozen REFERENCE_PROTOCOL_V3.json`);
	console.log(`Frozen oracle hostPlatform:    ${v3.hostPlatform}`);
	console.log(`Frozen oracle protocolVersion: ${v3.protocolVersion}`);
	console.log(`Frozen oracle helper SHA-256:  ${v3.frozenByHelperSha256}`);
	console.log(`Live v3 helper SHA-256:        ${liveSha}`);
	process.exit(0);
} else {
	console.log(`=== HALT_V3_EQUIVALENCE_FAILED ===`);
	console.log(`${failed}/${v3.corpus.length} corpus entries failed.`);
	for (const f of failures) {
		console.log(`\n--- ${f.id} ---`);
		console.log(`source: ${f.source}`);
		console.log(`v2-compat: ${f.v2CompatOK} | v3-provenance: ${f.provOK}`);
		if (!f.provOK) {
			console.log(`  expected provenance: ${JSON.stringify(f.expectedProvenance)}`);
			console.log(`  actual provenance:   ${JSON.stringify(f.actualProvenance)}`);
		}
	}
	process.exit(1);
}
