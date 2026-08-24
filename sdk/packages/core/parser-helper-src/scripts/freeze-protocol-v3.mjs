#!/usr/bin/env bun
/**
 * Phase 2 — Freeze REFERENCE_PROTOCOL_V3.json from a v3 helper binary.
 *
 * ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01-PHASE2-PROVENANCE01.
 *
 * Per CORRECTION01: the v2 oracle (REFERENCE_PROTOCOL_V2.json) is
 * FROZEN. The v3 oracle is a SEPARATE, ADDITIVE authority for the
 * new `argProvenance` contract. This script:
 *
 *   1. Asserts the v2 oracle contains NO `argProvenance` fields.
 *   2. Asserts the v3 helper emits `protocolVersion: 3`.
 *   3. For each v2 corpus entry, asserts the v3 helper preserves
 *      every v2 wire field EXCEPT the additive `argProvenance` and
 *      the contract-marker `protocolVersion`. This proves v2 wire
 *      compatibility.
 *   4. Captures per-entry argProvenance into REFERENCE_PROTOCOL_V3.json.
 *
 * Invocation:
 *   bun sdk/packages/core/parser-helper-src/scripts/freeze-protocol-v3.mjs <v3-binary-path>
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORACLE_DIR = join(__dirname, "..", ".factory", "oracle");
const V2_PATH = join(ORACLE_DIR, "REFERENCE_PROTOCOL_V2.json");
const V3_PATH = join(ORACLE_DIR, "REFERENCE_PROTOCOL_V3.json");

const v3Path = process.argv[2];
if (!v3Path) {
	console.error("Usage: freeze-protocol-v3.mjs <v3-binary-path>");
	process.exit(2);
}
if (!existsSync(v3Path)) {
	console.error(`v3 binary not found: ${v3Path}`);
	process.exit(2);
}

const v2 = JSON.parse(readFileSync(V2_PATH, "utf8"));

// (1) v2 oracle must not contain argProvenance.
function walkClean(obj, path) {
	if (obj && typeof obj === "object") {
		if (Array.isArray(obj)) {
			for (let i = 0; i < obj.length; i++) walkClean(obj[i], `${path}[${i}]`);
		} else {
			for (const [k, v] of Object.entries(obj)) {
				if (k === "argProvenance") {
					throw new Error(`v2 oracle contains argProvenance at ${path}.${k} -- should not`);
				}
				walkClean(v, `${path}.${k}`);
			}
		}
	}
}
walkClean(v2, "$");
console.log("v2 oracle has no argProvenance -- ok");

function invoke(bin, src) {
	const res = spawnSync(bin, [], { input: JSON.stringify({ dialect: "bash", source: src }), encoding: "utf8", timeout: 5000 });
	if (res.status !== 0 || !res.stdout) return null;
	try { return JSON.parse(res.stdout); } catch { return null; }
}

// (2) v3 helper emits protocolVersion: 3.
const sample = invoke(v3Path, "pwd");
if (!sample || sample.protocolVersion !== 3) {
	console.error(`v3 helper does not emit protocolVersion=3; got ${sample && sample.protocolVersion}`);
	process.exit(2);
}
console.log("v3 helper emits protocolVersion=3 -- ok");

// (3) v2 wire compatibility: strip protocolVersion + argProvenance.
const COMPAT_STRIP = new Set(["protocolVersion", "argProvenance"]);
function stripCompat(obj) {
	if (Array.isArray(obj)) return obj.map(stripCompat);
	if (obj && typeof obj === "object") {
		const out = {};
		for (const [k, v] of Object.entries(obj)) {
			if (COMPAT_STRIP.has(k)) continue;
			out[k] = stripCompat(v);
		}
		// canonicalize key order
		const sorted = {};
		for (const k of Object.keys(out).sort()) sorted[k] = out[k];
		return sorted;
	}
	return obj;
}
function canonicalize(obj) {
	return JSON.stringify(stripCompat(obj));
}

// v2 oracle normalized form has protocolVersion=2 baked in; strip
// it the same way for direct comparison.
const v2CompatCanon = v2.corpus.map((e) => {
	const parsed = JSON.parse(e.normalized);
	const stripped = stripCompat(parsed);
	return JSON.stringify(stripped);
});

// (4) Capture argProvenance per entry.
const v3Corpus = [];
for (let i = 0; i < v2.corpus.length; i++) {
	const entry = v2.corpus[i];
	const raw = invoke(v3Path, entry.source);
	if (!raw) {
		console.error(`helper failed for id=${entry.id}`);
		process.exit(2);
	}
	const compat = canonicalize(raw);
	if (compat !== v2CompatCanon[i]) {
		console.error(`\nv2/v3 wire DIVERGENCE on id=${entry.id} source=${JSON.stringify(entry.source)}`);
		console.error(`  v3-stripped: ${compat}`);
		console.error(`  v2-stripped: ${v2CompatCanon[i]}`);
		process.exit(2);
	}

	let provenance = [];
	if (raw.program) {
		for (const stmt of raw.program.stmts) {
			if (stmt && stmt.cmd) {
				provenance = stmt.cmd.argProvenance ?? [];
				break;
			}
		}
	}

	v3Corpus.push({
		id: entry.id,
		source: entry.source,
		argProvenance: provenance,
	});
}

const helperSha = createHash("sha256").update(readFileSync(v3Path)).digest("hex");
const v3Doc = {
	hostPlatform: v2.hostPlatform,
	protocolVersion: 3,
	frozenAt: "9f98d59c4+phase2",
	parentV2Oracle: V2_PATH,
	frozenByHelperSha256: helperSha,
	corpus: v3Corpus,
};
writeFileSync(V3_PATH, JSON.stringify(v3Doc, null, 2) + "\n");
console.log(`frozen ${v3Corpus.length} v3 entries (v2 wire compatibility preserved on every entry)`);
console.log(`v3 helper sha256: ${helperSha}`);
