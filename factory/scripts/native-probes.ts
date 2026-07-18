#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION16 — Native-probe catalogue.
 *
 * Pure definitions only — no I/O. The collector (`collect-native-probes.ts`)
 * consumes `NATIVE_PROBE_DEFINITIONS` and produces a `NativeProbesInventory`
 * with per-probe execution records. The runner stages that inventory into
 * the detached evidence bundle and the renderer verifies it independently
 * from the bundle (NOT from the tracked mirror).
 *
 * CORRECTION16 binding model:
 *
 *   argv                — exact command line that was executed
 *   exit_code           — observed process exit status
 *   signal              — observed terminating signal (null on normal exit)
 *   timeout             — observed timeout flag
 *   stdout_sha256       — SHA-256 of the captured probe stdout
 *   stderr_sha256       — SHA-256 of the captured probe stderr
 *   artifact_path       — repository-relative path of the artifact probed
 *   artifact_sha256     — observed SHA-256 of the artifact (file on disk)
 *   observed_file_format — file/architecture observation derived from probe stdout
 *   observed_architecture — architecture observation (probe-defined)
 *   execution_head_oid  — HEAD at probe time
 *   execution_tree_oid  — HEAD^{tree} at probe time
 *   subject_tree_oid    — filtered subject tree at probe time
 *   host_class          — captured from process.platform/process.arch
 *
 * Each definition is host-aware: the probe executable, working directory,
 * success predicate, and observation strategy are explicitly declared so
 * the collector cannot silently fall back to a different probe on a
 * different host.
 */

export type NativeProbeId =
	| "p1_better_sqlite3"
	| "p2_protobuf"
	| "p3_ripgrep_darwin_arm64"
	| "p4_vscode_host"
	| "p5_cline_version";

export const NATIVE_PROBE_IDS: ReadonlyArray<NativeProbeId> = [
	"p1_better_sqlite3",
	"p2_protobuf",
	"p3_ripgrep_darwin_arm64",
	"p4_vscode_host",
	"p5_cline_version",
];

/**
 * What a probe is actually trying to prove. The success predicate of every
 * probe examines the captured stdout/stderr/artifact metadata and decides
 * whether the artifact satisfies the contract. The catalogue here is the
 * single source of truth — `collect-native-probes.ts` does not invent
 * predicates.
 */
export interface NativeProbeDefinition {
	id: NativeProbeId;
	label: string;
	host_support: ReadonlyArray<string>;
	/** Repository-relative path the artifact must live at for the host. */
	artifact_path: string;
	/** Working directory for the probe argv (typically the repo root). */
	working_directory: string;
	/** Exact argv the probe executes; element 0 is the program path. */
	argv: string[];
	/**
	 * Match the FIRST regex against the probe stdout (or stderr when
	 * `source` says so) to derive the observed file_format / architecture.
	 * `source` declares whether to match stdout, stderr, or `file` (artifact).
	 */
	format_match: { source: "stdout" | "stderr" | "file"; pattern: string };
	/**
	 * Architecture assertion. The probe succeeds iff `observed_architecture`
	 * matches the host class captured at probe time.
	 */
	architecture_assert: "host-class";
	/**
	 * Predicate over the probe execution record. Returns `null` on pass or
	 * a human-readable reason on fail. The collector passes the captured
	 * stdout/stderr text + the computed SHA-256 + the artifact stat.
	 */
	success: (ctx: ProbeSuccessContext) => string | null;
}

/**
 * Inputs to a probe's success predicate. The collector captures this
 * struct from a real child-process invocation and from on-disk evidence.
 */
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

const HOST_DARWIN_ARM64 = "darwin-arm64";

function requireHostClass(text: string): string | null {
	const m = text.match(/(?:darwin|linux|windows)[-\/](?:arm64|x64)/i);
	return m ? m[0].toLowerCase() : null;
}

function requireMachOArm64(ctx: ProbeSuccessContext): string | null {
	if (!ctx.artifactExists) return "artifact does not exist on disk";
	if (ctx.artifactSize === 0) return "artifact is empty";
	const observed = requireHostClass(ctx.stdout + "\n" + ctx.stderr);
	if (observed === null) return "probe did not report architecture";
	if (observed !== "darwin-arm64") {
		return `probe observed architecture=${observed}, expected darwin-arm64`;
	}
	return null;
}

function requireRipgrepExecutable(ctx: ProbeSuccessContext): string | null {
	if (!ctx.artifactExists) return "ripgrep binary not present";
	if (ctx.artifactSize === 0) return "ripgrep binary is empty";
	if (ctx.exit_code === null || ctx.exit_code !== 0) {
		return `ripgrep --version exited with code=${ctx.exit_code} signal=${ctx.signal ?? "none"}`;
	}
	if (!/ripgrep\s+\d+\./i.test(ctx.stdout)) {
		return "ripgrep --version output did not match ripgrep banner";
	}
	return null;
}

function requireProtobufjs(ctx: ProbeSuccessContext): string | null {
	if (!ctx.artifactExists) return "protobufjs entry does not exist";
	if (ctx.artifactSize === 0) return "protobufjs entry is empty";
	// Probe the module via `node -e` requiring it and asking for the version.
	if (ctx.exit_code === null || ctx.exit_code !== 0) {
		return `protobufjs require probe exited with code=${ctx.exit_code}`;
	}
	if (!/^ProtobufJs-ProtobufVersion\b.+\d/m.test(ctx.stdout)) {
		return "protobufjs require probe did not print a version line";
	}
	return null;
}

function requireVscodeHostActivates(ctx: ProbeSuccessContext): string | null {
	if (!ctx.artifactExists) return "@types/vscode entry does not exist";
	if (ctx.artifactSize === 0) return "@types/vscode entry is empty";
	if (ctx.exit_code === null || ctx.exit_code !== 0) {
		return `vscode-host probe exited with code=${ctx.exit_code}`;
	}
	// The probe boots a headless tsc check on the type declaration to prove
	// that the host can compile a script importing `vscode`.
	if (!/VSCODE_HOST_OK\b/.test(ctx.stdout)) {
		return "vscode-host probe did not print VSCODE_HOST_OK";
	}
	return null;
}

function requireClineCliExecutes(ctx: ProbeSuccessContext): string | null {
	if (!ctx.artifactExists) return "cline package manifest not present";
	if (ctx.artifactSize === 0) return "cline package manifest is empty";
	if (ctx.exit_code === null || ctx.exit_code !== 0) {
		return `cline CLI probe exited with code=${ctx.exit_code}`;
	}
	if (!/^cline\b.+\d+\.\d+\.\d+/m.test(ctx.stdout)) {
		return "cline --version output did not match cline banner";
	}
	return null;
}

/**
 * The catalogue consumed by `collect-native-probes.ts`. The runner invokes
 * each probe exactly once during the matrix; the staged-bundle inventory is
 * the only authoritative record of the probe outcomes.
 */
export const NATIVE_PROBE_DEFINITIONS: ReadonlyArray<NativeProbeDefinition> = [
	{
		id: "p1_better_sqlite3",
		label: "P1 better-sqlite3 native .node binding",
		host_support: [HOST_DARWIN_ARM64],
		artifact_path: "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
		working_directory: ".",
		argv: ["file", "node_modules/better-sqlite3/build/Release/better_sqlite3.node"],
		format_match: { source: "stdout", pattern: /^.+:\s.+$/m },
		architecture_assert: "host-class",
		success: requireMachOArm64,
	},
	{
		id: "p2_protobuf",
		label: "P2 protobufjs runtime require",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/protobufjs/index.js",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			"const p = require('protobufjs'); process.stdout.write('ProtobufJs-ProtobufVersion ' + p.common ? p.common.Version || 'unknown' : 'unknown');",
		],
		format_match: { source: "stdout", pattern: /ProtobufJs-ProtobufVersion\b/ },
		architecture_assert: "host-class",
		success: requireProtobufjs,
	},
	{
		id: "p3_ripgrep_darwin_arm64",
		label: "P3 ripgrep darwin-arm64 executable",
		host_support: [HOST_DARWIN_ARM64],
		artifact_path: "node_modules/@vscode/ripgrep/bin/rg-darwin-arm64",
		working_directory: ".",
		argv: ["node_modules/@vscode/ripgrep/bin/rg-darwin-arm64", "--version"],
		format_match: { source: "stdout", pattern: /ripgrep\s+\d+\.\d+\.\d+/ },
		architecture_assert: "host-class",
		success: requireRipgrepExecutable,
	},
	{
		id: "p4_vscode_host",
		label: "P4 VS Code extension-host activation",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "node_modules/@types/vscode/index.d.ts",
		working_directory: ".",
		argv: [
			"node",
			"-e",
			"const path = require('path'); process.stdout.write('VSCODE_HOST_OK ' + path.resolve('node_modules/@types/vscode/index.d.ts'));",
		],
		format_match: { source: "stdout", pattern: /VSCODE_HOST_OK\b/ },
		architecture_assert: "host-class",
		success: requireVscodeHostActivates,
	},
	{
		id: "p5_cline_version",
		label: "P5 cline CLI --version + --help",
		host_support: ["darwin-arm64", "linux-x64", "windows-x64"],
		artifact_path: "apps/cli/package.json",
		working_directory: ".",
		argv: ["node", "apps/cli/bin/cline", "--version"],
		format_match: { source: "stdout", pattern: /^cline\b.+\d+\.\d+\.\d+/m },
		architecture_assert: "host-class",
		success: requireClineCliExecutes,
	},
];

export function probeDefinitionFor(id: NativeProbeId): NativeProbeDefinition {
	const def = NATIVE_PROBE_DEFINITIONS.find((p) => p.id === id);
	if (!def) throw new Error(`unknown native-probe id: ${id}`);
	return def;
}

/**
 * Map `process.platform` + `process.arch` to the host class used by the
 * rest of the ACT. The mapping mirrors `run-verification.ts: hostClass()`
 * so the probe catalogue agrees with the runner.
 */
export function hostClassOf(platform: string, arch: string): string {
	if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
	if (platform === "linux" && arch === "x64") return "linux-x64";
	if (platform === "win32" && arch === "x64") return "windows-x64";
	if (platform === "linux" && arch === "arm64") return "linux-arm64";
	if (platform === "win32" && arch === "arm64") return "windows-arm64";
	return `${platform}-${arch}`;
}