#!/usr/bin/env bun
/**
 * Phase 1.E — Verify v2 behavioral equivalence against the FROZEN
 * REFERENCE_PROTOCOL_V2.json oracle.
 *
 * ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / CORRECTION01.
 *
 * EVIDENCE CONTRACT (per CORRECTION01):
 *
 *   REFERENCE_PROTOCOL_V2.json  =  authority for behavioral equivalence
 *   LEGACY_HELPERS.txt SHA-256  =  authority for identity of the
 *                                  artifact that generated the oracle
 *   live legacy execution       =  diagnostic only (drift detector,
 *                                  NOT behavioral authority)
 *
 * The proof per corpus entry is:
 *
 *   normalize(invoke(reconstructed, entry.source))  ==  entry.normalized
 *
 * NOT:
 *
 *   invoke(reconstructed)  ==  invoke(legacy)
 *
 * This means the verifier remains valid even if the production vendored
 * binaries are intentionally replaced in a later phase -- as long as
 * REFERENCE_PROTOCOL_V2.json itself is not modified, the proof holds.
 *
 * Invocation:
 *   bun sdk/packages/core/parser-helper-src/scripts/verify-v2-equivalence.mjs <reconstructed-binary-path>
 *
 * Scope guard: does NOT add shellStatic, does NOT bump protocol
 * version, does NOT replace vendored binaries, does NOT touch TS V2
 * echo authority.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ORACLE_DIR = join(__dirname, "..", ".factory", "oracle");
const ORACLE_PATH = join(ORACLE_DIR, "REFERENCE_PROTOCOL_V2.json");
const LEGACY_HELPERS_PATH = join(ORACLE_DIR, "LEGACY_HELPERS.txt");
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const LEGACY_HELPER = join(PROJECT_ROOT, "sdk", "packages", "core", "bin", "parser-helper", "darwin-arm64", "cline-parser-helper");

const reconstructedPath = process.argv[2];
if (!reconstructedPath) {
	console.error("Usage: verify-v2-equivalence.mjs <reconstructed-binary-path>");
	process.exit(2);
}
if (!existsSync(reconstructedPath)) {
	console.error(`Reconstructed binary not found: ${reconstructedPath}`);
	process.exit(2);
}

// Load frozen oracle + frozen identity.
const oracle = JSON.parse(readFileSync(ORACLE_PATH, "utf8"));
const legacyHelpers = readFileSync(LEGACY_HELPERS_PATH, "utf8");

// Extract frozen SHA-256 for the host platform from LEGACY_HELPERS.txt
// by walking the platform block.
function frozenShaForPlatform(text, platform) {
	const lines = text.split("\n");
	let inBlock = false;
	for (const line of lines) {
		if (line.startsWith("platform:") && line.includes(platform)) {
			inBlock = true;
			continue;
		}
		if (inBlock && line.startsWith("sha256:")) {
			return line.replace(/^sha256:\s*/, "").trim();
		}
		if (inBlock && line.startsWith("platform:") && !line.includes(platform)) {
			inBlock = false;
		}
	}
	return null;
}

const frozenHostSha = frozenShaForPlatform(legacyHelpers, oracle.hostPlatform);
if (!frozenHostSha) {
	console.error(`Cannot extract frozen SHA-256 for host platform ${oracle.hostPlatform} from ${LEGACY_HELPERS_PATH}.`);
	process.exit(2);
}

function sha256File(p) {
	const buf = readFileSync(p);
	return createHash("sha256").update(buf).digest("hex");
}

// Identity check: live legacy binary SHA-256 against frozen identity.
// This is a DRIFT DETECTOR, not a behavioral authority. If the live
// legacy binary has moved (intentional or otherwise), we report it as
// a warning but proceed with the FROZEN oracle as the proof.
let driftWarning = null;
if (existsSync(LEGACY_HELPER)) {
	const liveSha = sha256File(LEGACY_HELPER);
	if (liveSha !== frozenHostSha) {
		driftWarning = `DRIFT: live legacy binary SHA-256 (${liveSha}) differs from frozen identity (${frozenHostSha}). Behavioral proof still valid against frozen REFERENCE_PROTOCOL_V2.json.`;
	}
}

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

const corpus = oracle.corpus;
let failed = 0;
const failures = [];

// Pre-snapshot: confirm every frozen corpus entry has a `normalized`
// field. If not, the verifier cannot run.
for (const entry of corpus) {
	if (typeof entry.normalized !== "string") {
		console.error(`FROZEN ORACLE CORRUPT: corpus entry ${entry.id} has no "normalized" field. Re-run freeze-legacy-helpers.mjs to rebuild REFERENCE_PROTOCOL_V2.json.`);
		process.exit(2);
	}
}

for (const entry of corpus) {
	// AUTHORITATIVE PROOF: frozen oracle == reconstructed output.
	const newRaw = invoke(reconstructedPath, entry.source);
	const newNorm = newRaw == null ? "<null>" : normalize(newRaw);

	// DRIFT DIAGNOSTIC ONLY: live legacy output (if we can run it AND
	// it still matches the frozen identity).
	let liveLegacyNorm = null;
	if (existsSync(LEGACY_HELPER) && driftWarning === null) {
		const legacyRaw = invoke(LEGACY_HELPER, entry.source);
		liveLegacyNorm = legacyRaw == null ? "<null>" : normalize(legacyRaw);
	}

	if (entry.normalized === newNorm) {
		process.stdout.write(".");
	} else {
		failed++;
		failures.push({
			id: entry.id,
			source: entry.source,
			expected: entry.normalized,
			actual: newNorm,
			liveLegacyNorm,
		});
		process.stdout.write("F");
	}
}

process.stdout.write("\n\n");

if (failed === 0) {
	console.log("=== PASS_HELPER_SOURCE_RECONSTRUCTED_V2_EQUIVALENT ===");
	console.log(`${corpus.length}/${corpus.length} corpus entries normalized-equivalent against FROZEN REFERENCE_PROTOCOL_V2.json.`);
	console.log(`Frozen oracle protocolVersion: ${oracle.protocolVersion}`);
	console.log(`Frozen oracle hostPlatform:    ${oracle.hostPlatform}`);
	console.log(`Frozen oracle host SHA-256:    ${frozenHostSha}`);
	console.log(`Reconstructed binary:          ${reconstructedPath}`);
	if (driftWarning) {
		console.log(`WARN: ${driftWarning}`);
	}
	process.exit(0);
} else {
	console.log(`=== HALT_V2_ORACLE_MISMATCH ===`);
	console.log(`${failed}/${corpus.length} corpus entries diverged against FROZEN REFERENCE_PROTOCOL_V2.json.`);
	for (const f of failures) {
		console.log(`\n--- ${f.id} ---`);
		console.log(`source:    ${f.source}`);
		console.log(`expected:  ${f.expected}`);
		console.log(`actual:    ${f.actual}`);
		if (f.liveLegacyNorm !== null) {
			console.log(`liveLegacy (diagnostic): ${f.liveLegacyNorm}`);
		}
	}
	process.exit(1);
}
