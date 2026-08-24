#!/usr/bin/env bun
/**
 * Freeze the legacy parser-helper binaries as the v2 oracle.
 *
 * ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / Phase 1.A + 1.B + 1.C.
 *
 * Purpose:
 *   - Record for each vendored platform binary:
 *       platform, path, byte_size, sha256, protocolVersion
 *   - Run the reviewer's v2 equivalence corpus against the local-host
 *     binary and persist normalized outputs as
 *     `.factory/oracle/REFERENCE_PROTOCOL_V2.json` (the protocol-v2 oracle).
 *
 * Scope guard (per ACT boundary):
 *   - Does NOT add shellStatic.
 *   - Does NOT bump the protocol version.
 *   - Does NOT replace vendored binaries.
 *   - Does NOT touch TS V2 echo authority.
 *
 * Output:
 *   - .factory/oracle/LEGACY_HELPERS.txt  (one record per binary)
 *   - .factory/oracle/REFERENCE_PROTOCOL_V2.json  (corpus -> normalized JSON)
 *
 * Invocation:
 *   bun sdk/packages/core/parser-helper-src/scripts/freeze-legacy-helpers.mjs
 *
 * NOTE: Runs only on the host platform. The non-host binaries are still
 * recorded (size + sha256), but their protocolVersion field is left null
 * (the binary does not embed a string header) -- it can be cross-checked
 * later by invoking the binary on the matching host.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const HELPER_DIR = join(PROJECT_ROOT, "sdk", "packages", "core", "bin", "parser-helper");
const SHA_SUMS_PATH = join(HELPER_DIR, "SHA256SUMS.txt");
const ORACLE_DIR = join(__dirname, "..", ".factory", "oracle");
const HOST_PLATFORM = `${process.platform}-${process.arch}`;

const PLATFORMS = [
	{ platform: "darwin-arm64", exe: "cline-parser-helper" },
	{ platform: "darwin-amd64", exe: "cline-parser-helper" },
	{ platform: "linux-amd64", exe: "cline-parser-helper" },
	{ platform: "linux-arm64", exe: "cline-parser-helper" },
	{ platform: "win32-x64", exe: "cline-parser-helper.exe" },
];

// Reviewer-supplied v2 equivalence corpus (Phase 1.C). No shell execution
// happens at the helper level -- each input is fed as JSON-on-stdin to the
// helper and stdout is captured as the oracle output.
const CORPUS = [
	{ id: "01-pwd", source: "pwd" },
	{ id: "02-pwd-semicolon-pwd", source: "pwd; pwd" },
	{ id: "03-git-status-and-diff-stat", source: "git status && git diff --stat" },
	{ id: "04-echo-dashes-branch", source: "echo '---BRANCH---'" },
	{ id: "05-echo-star-unquoted", source: "echo *" },
	{ id: "06-echo-star-single-quoted", source: "echo '*'" },
	{ id: "07-echo-brace-unquoted", source: "echo {a,b}" },
	{ id: "08-echo-brace-single-quoted", source: "echo '{a,b}'" },
	{ id: "09-echo-dollar-home-double", source: 'echo "$HOME"' },
	{ id: "10-echo-procsub-unquoted", source: "echo <(pwd)" },
	{ id: "11-bash-c-rm-rf-home", source: 'bash -c \'rm -rf "$HOME"\'' },
	{ id: "12-find-glob-quoted", source: "find . -name '*.ts'" },
	{ id: "13-find-glob-unquoted", source: "find . -name *.ts" },
	{ id: "14-redirect-output", source: "pwd > ~/.ssh/authorized_keys" },
	{ id: "15-malformed-input", source: "${BROKEN_INVOCATION" },
	{ id: "16-echo-rm-cmd-subst", source: 'echo "$(rm -rf foo)"' },
	{ id: "17-rm-rf-home-direct", source: 'rm -rf "$HOME"' },
	{ id: "18-and-or-compound", source: 'git status --short && echo X && git remote -v' },
	{ id: "19-pipe", source: "git log --oneline | head -5" },
	{ id: "20-assign-prefix", source: "FOO=bar pwd" },
];

function sha256File(p) {
	return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function recordPlatform(p) {
	const path = join(HELPER_DIR, p.platform, p.exe);
	if (!existsSync(path)) {
		return {
			platform: p.platform,
			path,
			byte_size: 0,
			sha256: "",
			protocolVersion: null,
			hostRunnable: false,
		};
	}
	const size = statSync(path).size;
	const sha = sha256File(path);
	return {
		platform: p.platform,
		path,
		byte_size: size,
		sha256: sha,
		// protocolVersion is runtime-only (the binary does not embed a
		// string header). Read it from the host-platform invocation below;
		// for non-host platforms, leave null (it can be cross-checked
		// later by invoking the binary on the matching platform).
		protocolVersion: null,
		hostRunnable: p.platform === HOST_PLATFORM,
	};
}

function invokeHelper(binaryPath, source) {
	const stdinPayload = JSON.stringify({ dialect: "bash", source });
	const res = spawnSync(binaryPath, [], {
		input: stdinPayload,
		encoding: "utf8",
		timeout: 5000,
	});
	if (res.status !== 0 || !res.stdout) {
		return null;
	}
	try {
		return JSON.parse(res.stdout);
	} catch {
		return null;
	}
}

function normalize(parsed) {
	// Sort object keys recursively so two semantically equal parses produce
	// identical bytes. mvdan/sh preserves input order in its arrays, so we
	// keep array order intact and only sort the dict keys.
	function recurse(v) {
		if (Array.isArray(v)) return v.map(recurse);
		if (v && typeof v === "object") {
			const obj = v;
			const sorted = {};
			for (const k of Object.keys(obj).sort()) {
				sorted[k] = recurse(obj[k]);
			}
			return sorted;
		}
		return v;
	}
	return JSON.stringify(recurse(parsed));
}

function main() {
	const records = PLATFORMS.map(recordPlatform);
	const hostRec = records.find((r) => r.platform === HOST_PLATFORM);

	if (!hostRec || hostRec.byte_size === 0) {
		console.error(`No legacy helper binary for host platform ${HOST_PLATFORM} at ${HELPER_DIR}.`);
		console.error("Phase 1 requires a legacy binary present for the host platform to capture protocol-version + corpus output.");
		process.exit(2);
	}

	// Probe protocolVersion from the host binary with a trivially parseable
	// input. This is the canonical protocolVersion for the legacy binary
	// frozen here.
	const probe = invokeHelper(hostRec.path, "pwd");
	if (!probe || typeof probe !== "object") {
		console.error("Legacy helper binary returned no parseable output on probe.");
		process.exit(2);
	}
	const pv = probe.protocolVersion;
	if (pv !== 2) {
		console.error(`Legacy helper protocolVersion=${String(pv)}; expected 2.`);
		process.exit(2);
	}
	hostRec.protocolVersion = pv;

	// Capture corpus.
	const corpus = [];
	for (const c of CORPUS) {
		const raw = invokeHelper(hostRec.path, c.source);
		const norm = raw == null ? "<null>" : normalize(raw);
		corpus.push({ id: c.id, source: c.source, raw, normalized: norm });
	}

	// Persist.
	const outHelpers = records
		.map((r) =>
			[
				`platform:    ${r.platform}`,
				`path:        ${r.path}`,
				`byte_size:   ${r.byte_size}`,
				`sha256:      ${r.sha256}`,
				`protocolVer: ${r.protocolVersion === null
				? "<UNAVAILABLE_FROM_CURRENT_HOST -- run freeze on a host matching this platform to bind it>"
				: r.protocolVersion}`,
				`hostRun:     ${r.hostRunnable}`,
			].join("\n"),
		)
		.join("\n\n");

	writeFileSync(join(ORACLE_DIR, "LEGACY_HELPERS.txt"), outHelpers + "\n");
	writeFileSync(
		join(ORACLE_DIR, "REFERENCE_PROTOCOL_V2.json"),
		JSON.stringify(
			{
				frozenAt: new Date().toISOString(),
				hostPlatform: HOST_PLATFORM,
				protocolVersion: 2,
				corpus,
			},
			null,
			"\t",
		) + "\n",
	);

	// Cross-check SHA256SUMS.txt against the freshly recorded hashes.
	const shaLines = readFileSync(SHA_SUMS_PATH, "utf8").trim().split("\n");
	const drift = [];
	for (const line of shaLines) {
		const [sha, rel] = line.trim().split(/\s+/);
		const platform = rel.split("/")[0];
		const rec = records.find((r) => r.platform === platform);
		if (rec && rec.sha256 !== sha) {
			drift.push(`${platform}: bundle SHA256SUMS.txt=${sha} computed=${rec.sha256}`);
		}
	}
	if (drift.length > 0) {
		console.error("SHA256 drift vs SHA256SUMS.txt:");
		console.error(drift.join("\n"));
		process.exit(2);
	}

	console.log("Freeze complete.");
	console.log(`- LEGACY_HELPERS.txt: ${records.length} binaries recorded`);
	console.log(`- REFERENCE_PROTOCOL_V2.json: ${corpus.length} corpus entries captured (protocolVersion=${pv})`);
}

main();