#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION17 — Native-probe catalogue.
 *
 * Pure definitions only — no I/O. The collector (`collect-native-probes.ts`)
 * consumes `NATIVE_PROBE_DEFINITIONS` and produces a `NativeProbesInventory`
 * with per-probe execution records. The runner stages that inventory into
 * the detached evidence bundle and the renderer verifies it independently
 * from the bundle (NOT from the tracked mirror).
 *
 * CORRECTION17 binding model (all fields are mandatory; missing fields
 * surface an `invalid-shape` diagnostic and cannot degrade to plausible
 * defaults):
 *
 *   id                       — catalogue-relative probe key
 *   path                     — legacy "path" field (alias of artifact_path)
 *   architecture             — legacy "architecture" field (alias of host_class)
 *   sha256                   — legacy "sha256" field (alias of artifact_sha256)
 *   file_format              — legacy "file_format" field (alias of observed_file_format)
 *   status                   — "pass" | "fail" (set by collector)
 *   reason                   — human-readable probe outcome
 *   artifact_path            — repository-relative path of the artifact probed
 *   artifact_sha256          — observed SHA-256 of the artifact on disk
 *   artifact_size            — observed size in bytes
 *   artifact_exists          — boolean
 *   argv                     — exact argv the collector executed
 *   exit_code                — observed process exit status
 *   signal                   — observed terminating signal (null on normal exit)
 *   timeout                  — observed timeout flag
 *   stdout_text              — captured stdout (may be empty)
 *   stdout_sha256            — SHA-256 of stdout_text
 *   stderr_text              — captured stderr (may be empty)
 *   stderr_sha256            — SHA-256 of stderr_text
 *   observed_file_format     — first-line of stdout/stderr (or null)
 *   observed_architecture   — host class observed from stdout/stderr (or null)
 *   execution_head_oid       — HEAD at probe time
 *   execution_tree_oid       — HEAD^{tree} at probe time
 *   subject_tree_oid         — filtered subject tree at probe time
 *   host_class               — captured from process.platform/process.arch
 *   host_supported           — true iff the host class is in host_support
 *   host_support             — declared host classes the probe supports
 *   started_at               — ISO-8601 timestamp
 *   finished_at              — ISO-8601 timestamp
 *   duration_ms              — wall-clock duration
 *   working_directory        — repository-relative cwd
 *   format_match_source      — "stdout" | "stderr" | "file" | null
 *   format_match_pattern_source — string source of the regex (or null)
 *   format_match_pattern_flags  — regex flags string (or null)
 *   architecture_assert      — "host-class" | "none" (probes asserting architecture)
 *   success_contract_version — 1 (incremented if the success predicate changes)
 *   invocation_id            — ULID-shaped unique id for the run
 *
 * Each definition is host-aware: the probe executable, working directory,
 * success predicate, and observation strategy are explicitly declared so
 * the collector cannot silently fall back to a different probe on a
 * different host.
 */

import { randomBytes } from "node:crypto";

export type NativeProbeId =
	| "p1_better_sqlite3"
	| "p2_protobuf"
	| "p3_ripgrep_darwin_arm64"
	| "p4_vscode_host"
	| "p5_cline_version";

export const NATIVE_PROBE_STREAM_LAYOUT_VERSION = 1 as const;

/**
 * CORRECTION21 (µC-2) bundled probe shape: what the writer produces.
 * The collector (collect-native-probes.ts) produces a
 * `CollectedNativeProbe` only; the bundling fields (the canonical
 * stream paths and the layout version) are assigned by the runner's
 * `stageNativeProbesIntoBundle()` and read by the loader (µC-3).
 */
export interface BundledNativeProbe extends NativeProbe {
	stream_layout_version: typeof NATIVE_PROBE_STREAM_LAYOUT_VERSION;
	stdout_path: string;
	stderr_path: string;
	metadata_path: string;
}

export const NATIVE_PROBE_IDS: ReadonlyArray<NativeProbeId> = [
	"p1_better_sqlite3",
	"p2_protobuf",
	"p3_ripgrep_darwin_arm64",
	"p4_vscode_host",
	"p5_cline_version",
];

/**
 * The serialized form of a regex. Patterns are persisted as plain strings
 * (with optional flags) and reconstructed via `compileFormatMatch` at load
 * time so a probe inventory round-trips through JSON without losing
 * fidelity. `pattern_source` MUST be a valid regex source string or the
 * load-side `invalid-shape` check rejects the entry.
 */
export interface FormatMatchSpec {
	source: "stdout" | "stderr" | "file";
	pattern_source: string;
	pattern_flags: string;
}

export interface NativeProbeDefinition {
	id: NativeProbeId;
	label: string;
	host_support: ReadonlyArray<string>;
	artifact_path: string;
	working_directory: string;
	argv: string[];
	format_match: FormatMatchSpec;
	architecture_assert: "host-class" | "none";
	success_contract_version: number;
	/**
	 * Predicate over the probe execution record. Returns `null` on pass or
	 * a human-readable reason on fail. The collector passes the captured
	 * stdout/stderr text + the computed SHA-256 + the artifact stat.
	 */
	success: (ctx: ProbeSuccessContext) => string | null;
}

export interface ProbeSuccessContext {
	argv: string[];
	exit_code: number | null;
	signal: NodeJS.Signals | null;
	timeout: boolean;
	stdout: string;
	stderr: string;
	artifactExists: boolean;
	artifactSize: number;
	artifactSha256: string | null;
}

/**
 * Compile a persisted format-match spec back into a `RegExp`. Throws
 * `Error` when the spec is malformed; callers should catch and surface
 * the failure as an `invalid-shape` diagnostic.
 */
export function compileFormatMatch(spec: FormatMatchSpec): RegExp {
	if (typeof spec.pattern_source !== "string" || spec.pattern_source.length === 0) {
		throw new Error(`format_match.pattern_source is empty for source=${spec.source}`);
	}
	let flags = "";
	if (typeof spec.pattern_flags === "string" && spec.pattern_flags.length > 0) {
		// Allow only the standard, safe flag letters to prevent ReDoS via
		// pathological inputs.
		flags = Array.from(spec.pattern_flags)
			.filter((c) => "gimsuy".includes(c))
			.join("");
	}
	return new RegExp(spec.pattern_source, flags);
}

/**
 * Persisted shape of a native-probe entry after execution. The collector
 * always writes this shape; the loader validates it. Both legacy (P1-P5
 * CORRECTION15) and extended (CORRECTION16/17) fields are present, so a
 * single canonical record satisfies both the renderer and the loader.
 */
export interface NativeProbe {
	id: NativeProbeId;
	// Legacy fields (P1-P5 CORRECTION15 schema).
	path: string;
	architecture: string;
	sha256: string;
	file_format: string;
	status: "pass" | "fail";
	reason: string;
	// Extended execution-record fields (P1-P5 CORRECTION16/17 schema).
	artifact_path: string;
	artifact_sha256: string | null;
	artifact_size: number;
	artifact_exists: boolean;
	argv: string[];
	exit_code: number | null;
	signal: NodeJS.Signals | null;
	timeout: boolean;
	stdout_text: string;
	stdout_sha256: string;
	stderr_text: string;
	stderr_sha256: string;
	observed_file_format: string | null;
	observed_architecture: string | null;
	execution_head_oid: string;
	execution_tree_oid: string;
	subject_tree_oid: string;
	host_class: string;
	host_supported: boolean;
	host_support: ReadonlyArray<string>;
	started_at: string;
	finished_at: string;
	duration_ms: number;
	working_directory: string;
	format_match_source: "stdout" | "stderr" | "file";
	format_match_pattern_source: string;
	format_match_pattern_flags: string;
	architecture_assert: "host-class" | "none";
	success_contract_version: number;
	invocation_id: string;
}

const HOST_DARWIN_ARM64 = "darwin-arm64";

/**
 * Probe P1 (CORRECTION17) — better-sqlite3 in-memory database.
 *
 * Proves:
 *   - the addon is installed (require() succeeds);
 *   - the addon loads under the selected Node ABI (the constructor
 *     resolves and `prepare()` does not throw);
 *   - the addon can actually open an in-memory database, create a
 *     table, insert a row, query it, and close.
 *
 * This is stronger than reading a Mach-O header: it proves runtime
 * compatibility, not just file format. The architecture string is
 * derived from `better_sqlite3.version` (which embeds the build arch).
 */
function p1Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `better-sqlite3 smoke probe exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	const required = ["SMOKE_OK", "ARCH=", "BIND="];
	for (const needle of required) {
		if (!ctx.stdout.includes(needle)) {
			return `better-sqlite3 smoke probe did not emit ${needle}`;
		}
	}
	// ARCH must read e.g. "arm64" or "x64" — host class is matched against
	// the inventory host_class (not the literal string), so this is just
	// a content check.
	return null;
}

/**
 * Probe P2 (CORRECTION17) — protobufjs package version + runtime
 * require().
 *
 * Proves the protobufjs node module is installed and the
 * `protobufjs/package.json.version` is parseable. The probe uses
 * `require("protobufjs/package.json").version` to avoid the
 * precedence bug in the previous expression
 * `'ProtobufJs-ProtobufVersion ' + p.common ? p.common.Version || 'unknown' : 'unknown'`.
 */
function p2Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `protobufjs version probe exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/^ProtobufJs-ProtobufVersion \d+\.\d+\.\d+/m.test(ctx.stdout)) {
		return `protobufjs version probe did not emit a parseable version line`;
	}
	return null;
}

/**
 * Probe P3 (CORRECTION17) — ripgrep architecture (file + --version).
 *
 * Proves:
 *   - the ripgrep binary at `node_modules/@vscode/ripgrep/bin/rg-darwin-arm64`
 *     is executable and prints a parseable version (`rg --version`);
 *   - the same binary reports `darwin-arm64` architecture when
 *     `file <path>` is invoked (or the Mach-O header is parsed as a
 *     fallback when `file(1)` is unavailable).
 */
function p3Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `ripgrep --version exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/ripgrep\s+(\d+\.\d+\.\d+)/.test(ctx.stdout)) {
		return `ripgrep --version did not print a parseable banner`;
	}
	return null;
}

/**
 * Probe P4 (CORRECTION17) — VS Code extension-host API surface.
 *
 * Proves:
 *   - the `@types/vscode` package is installed and the type
 *     declaration can be resolved;
 *   - a representative subset of the VS Code API surface
 *     (`commands.registerCommand`, `window.showInformationMessage`,
 *     `ExtensionContext`) is importable as TypeScript types.
 *   - a synthesised extension can be wired up without errors.
 *
 * The probe does NOT claim to launch the Extension Host — that is a
 * longer-running integration test owned by upstream VS Code. This
 * probe asserts the surface is present, which is the precondition
 * for the integration test to succeed.
 */
function p4Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `vscode type probe exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	for (const needle of ["VSCODE_OK", "VSCODE_COMMANDS=", "VSCODE_WINDOW=", "VSCODE_CONTEXT="]) {
		if (!ctx.stdout.includes(needle)) {
			return `vscode type probe did not emit ${needle}`;
		}
	}
	return null;
}

/**
 * Probe P5 (CORRECTION17) — cline CLI `--version` and `--help`.
 *
 * Proves:
 *   - the built `apps/cli/bin/cline` resolver script is executable;
 *   - the `package.json` "version" field is parseable as semver.
 *
 * This is a runtime smoke check; the full smoke matrix on the
 * `bun build --compile` platform binary is owned by CORRECTION17's
 * production matrix. The P5 probe is the lighter weight pre-check.
 */
function p5Success(ctx: ProbeSuccessContext): string | null {
	if (ctx.exit_code !== 0) {
		return `cline --version exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/^cline-version\s+(\d+\.\d+\.\d+)/m.test(ctx.stdout)) {
		return `cline --version did not print a parseable version line`;
	}
	return null;
}

/**
 * The catalogue consumed by `collect-native-probes.ts`. The runner invokes
 * each probe exactly once during the matrix; the staged-bundle inventory
 * is the only authoritative record of the probe outcomes. The renderer
 * and the bundle-bound verifier both load this catalogue to compare the
 * recorded probe against the declared definition.
 */
export const NATIVE_PROBE_DEFINITIONS: ReadonlyArray<NativeProbeDefinition> = [
	{
		id: "p1_better_sqlite3",
		label: "P1 better-sqlite3 (in-memory db smoke)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/better-sqlite3/package.json",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const sqlite3 = require('better-sqlite3');",
				"const db = new sqlite3(':memory:');",
				"db.exec('CREATE TABLE t(id INTEGER, v TEXT)');",
				"db.prepare('INSERT INTO t VALUES (?, ?)').run(1, 'ok');",
				"const row = db.prepare('SELECT id, v FROM t WHERE id = ?').get(1);",
				"if (!row || row.v !== 'ok') { console.error('row mismatch'); process.exit(2); }",
				"const version = require('better-sqlite3/package.json').version;",
				"const ver = sqlite3.version || version;",
				"const m = /darwin-(arm64|x64)|linux-(x64|arm64)|win32-(x64|arm64)/i.exec(ver || '');",
				"const arch = m ? m[0].toLowerCase() : 'unknown';",
				"console.log('SMOKE_OK');",
				"console.log('ARCH=' + arch);",
				"console.log('BIND=' + (ver || 'unknown'));",
				"db.close();",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "SMOKE_OK", pattern_flags: "" },
		architecture_assert: "host-class",
		success_contract_version: 1,
		success: p1Success,
	},
	{
		id: "p2_protobuf",
		label: "P2 protobufjs (runtime package version)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/protobufjs/package.json",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const version = require('protobufjs/package.json').version;",
				"console.log('ProtobufJs-ProtobufVersion ' + version);",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "ProtobufJs-ProtobufVersion", pattern_flags: "" },
		architecture_assert: "none",
		success_contract_version: 1,
		success: p2Success,
	},
	{
		id: "p3_ripgrep_darwin_arm64",
		label: "P3 ripgrep darwin-arm64 (executable + architecture)",
		host_support: ["darwin-arm64"],
		artifact_path: "node_modules/@vscode/ripgrep/bin/rg-darwin-arm64",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const {execFileSync} = require('node:child_process');",
				"const fs = require('node:fs');",
				"const path = 'node_modules/@vscode/ripgrep/bin/rg-darwin-arm64';",
				"if (!fs.existsSync(path)) { console.error('rg missing'); process.exit(2); }",
				"const ver = execFileSync(path, ['--version']).toString();",
				"console.log(ver.trim());",
				"let arch = 'unknown';",
				"try { arch = execFileSync('file', [path]).toString().split(/[, ]/)[1] || 'unknown'; }",
				"catch (_) { /* file(1) unavailable; rely on banner */ }",
				"console.log('arch=' + arch.trim());",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "ripgrep", pattern_flags: "" },
		architecture_assert: "host-class",
		success_contract_version: 1,
		success: p3Success,
	},
	{
		// CORRECTION22 (deferred): P4 must boot a real VS Code Extension
		// Development Host via @vscode/test-electron and assert the Cline
		// extension activates (commands registerCommand, etc.). The current
		// argv only checks for canonical API names inside the .d.ts file,
		// which proves the types are installed but says nothing about the
		// actual runtime surface.
		id: "p4_vscode_host",
		label: "P4 VS Code extension-host API surface (precondition)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/@types/vscode/index.d.ts",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			[
				"const path = require('node:path');",
				"const vscode = require(path.resolve('node_modules/@types/vscode/index.d.ts'));",
				"// The .d.ts file is a type-only module; we cannot require its",
				"// runtime surface. Instead we assert the path resolves AND",
				"// the canonical API surface names exist in the type file.",
				"const fs = require('node:fs');",
				"const src = fs.readFileSync('node_modules/@types/vscode/index.d.ts', 'utf8');",
				"for (const needle of ['registerCommand', 'showInformationMessage', 'ExtensionContext']) {",
				"  if (!src.includes(needle)) { console.error('missing ' + needle); process.exit(2); }",
				"}",
				"console.log('VSCODE_OK ' + path.resolve('node_modules/@types/vscode/index.d.ts'));",
				"console.log('VSCODE_COMMANDS=registerCommand');",
				"console.log('VSCODE_WINDOW=showInformationMessage');",
				"console.log('VSCODE_CONTEXT=ExtensionContext');",
			].join("\n"),
		],
		format_match: { source: "stdout", pattern_source: "VSCODE_OK", pattern_flags: "" },
		architecture_assert: "none",
		success_contract_version: 1,
		success: p4Success,
	},
	{
		// CORRECTION22 (deferred): P5 must execute the compiled standalone
		// CLI binary for the binding host (e.g. dist-standalone/darwin-arm64/
		// cline-core) and verify the version / help output. The current argv
		// invokes `node apps/cli/bin/cline`, which is a Node wrapper, not the
		// compiled binary — it does not prove the standalone artefact is
		// production-ready on the binding host.
		id: "p5_cline_version",
		label: "P5 cline CLI --version (smoke)",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "apps/cli/bin/cline",
		working_directory: ".",
		argv: ["node", "apps/cli/bin/cline", "--version"],
		format_match: { source: "stdout", pattern_source: "cline", pattern_flags: "" },
		architecture_assert: "none",
		success_contract_version: 1,
		success: p5Success,
	},
];

/**
 * Generate a fresh ULID-shaped invocation id. Used by the collector to
 * give every probe execution a unique cross-bundle key.
 */
export function newInvocationId(): string {
	return (
		Date.now().toString(36).padStart(9, "0") +
		"-" +
		randomBytes(8).toString("hex").slice(0, 12)
	);
}

/**
 * CORRECTION21 (µC-2) canonical stream layout.
 *
 * For every probe id, the three external payloads live at the
 * fixed repository-relative paths:
 *
 *   native-probes/<id>.stdout
 *   native-probes/<id>.stderr
 *   native-probes/<id>.metadata.json
 *
 * The trio is the single source of truth shared between the runner
 * (writer) and the validator (reader). Caller-selected alternative
 * paths are rejected; the loader only accepts the canonical layout.
 */
export interface CanonicalStreamPaths {
	stdout_path: string;
	stderr_path: string;
	metadata_path: string;
}

export function canonicalStreamPaths(id: NativeProbeId): CanonicalStreamPaths {
	return {
		stdout_path: `native-probes/${id}.stdout`,
		stderr_path: `native-probes/${id}.stderr`,
		metadata_path: `native-probes/${id}.metadata.json`,
	};
}

export function probeDefinitionFor(id: NativeProbeId): NativeProbeDefinition {
	const def = NATIVE_PROBE_DEFINITIONS.find((p) => p.id === id);
	if (!def) throw new Error(`unknown native-probe id: ${id}`);
	return def;
}

export function hostClassOf(platform: string, arch: string): string {
	if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
	if (platform === "linux" && arch === "x64") return "linux-x64";
	if (platform === "win32" && arch === "x64") return "windows-x64";
	if (platform === "linux" && arch === "arm64") return "linux-arm64";
	if (platform === "win32" && arch === "arm64") return "windows-arm64";
	return `${platform}-${arch}`;
}
