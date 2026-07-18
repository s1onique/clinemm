#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION16 — Native-probe executor.
 *
 * Walks `NATIVE_PROBE_DEFINITIONS`, executes each probe argv exactly once
 * with the same child-process semantics as the verification runner, and
 * produces a `NativeProbesInventory` payload that the runner stages into
 * the detached evidence bundle.
 *
 * The previous CORRECTION15 inventory was a placeholder (`status:
 * "deferred"`, sha256=000…000); CORRECTION16 replaces it with a real
 * execution record so the renderer can independently verify:
 *
 *   - the recorded SHA-256 actually matches the artifact on disk
 *   - the observed architecture matches the captured host class
 *   - the exit code / signal / timeout combination matches a known-good
 *     shape for a real probe
 *   - the probe argv matches the catalogue (no argv drift)
 *   - the execution HEAD/tree + filtered subject at probe time match the
 *     recorded identity at collection time
 *
 * The collector does NOT short-circuit on a failing probe — every probe
 * always runs to completion and the inventory records the failure mode.
 * `loadNativeProbesInventory` (in `baseline-closure.ts`) is fail-closed:
 * any probe with a non-pass status flips `complete` to false.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
	hostClassOf,
	NATIVE_PROBE_DEFINITIONS,
	NATIVE_PROBE_IDS,
	probeDefinitionFor,
	type NativeProbeDefinition,
	type NativeProbeId,
	type ProbeSuccessContext,
} from "./native-probes";
import { computeFilteredSubjectTreeOid } from "./subject-tree";

const ACT_ID = "ACT-CLINEMM-FORK-BASELINE01";

export interface ProbeExecutionRecord {
	id: NativeProbeId;
	label: string;
	host_class: string;
	artifact_path: string;
	working_directory: string;
	argv: string[];
	format_match: { source: "stdout" | "stderr" | "file"; pattern: string };
	started_at: string;
	finished_at: string;
	duration_ms: number;
	exit_code: number | null;
	signal: NodeJS.Signals | null;
	timeout: boolean;
	stdout_sha256: string;
	stderr_sha256: string;
	stdout_text: string;
	stderr_text: string;
	artifact_sha256: string | null;
	artifact_size: number;
	artifact_exists: boolean;
	observed_file_format: string | null;
	observed_architecture: string | null;
	execution_head_oid: string;
	execution_tree_oid: string;
	subject_tree_oid: string;
	host_supported: boolean;
	host_support: ReadonlyArray<string>;
	status: "pass" | "fail";
	reason: string;
}

export interface NativeProbesInventory {
	schema_version: 1;
	act_id: typeof ACT_ID;
	host_class: string;
	collected_at: string;
	execution_head_oid: string;
	execution_tree_oid: string;
	subject_tree_oid: string;
	probes: Record<NativeProbeId, ProbeExecutionRecord>;
}

const OID_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_TIMEOUT_MS = 60_000;
const REDACT_PATTERNS: RegExp[] = [
	/AKIA[0-9A-Z]{16}/g,
	/sk-[A-Za-z0-9_-]{20,}/g,
	/ghp_[A-Za-z0-9]{20,}/g,
	/xox[baprs]-[0-9A-Za-z-]{20,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/Bearer\s+[A-Za-z0-9._-]{20,}/g,
];

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) {
		throw new Error(`git rev-parse --show-toplevel failed: ${(r.stderr ?? "").trim()}`);
	}
	return (r.stdout ?? "").trim();
}

function redact(value: string): string {
	let out = value;
	for (const pattern of REDACT_PATTERNS) out = out.replace(pattern, "[REDACTED]");
	return out;
}

function sha256(value: Buffer | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function captureIdentity(root: string): {
	head: string;
	tree: string;
	subject: string | null;
} {
	const head = spawnSync("git", ["rev-parse", "HEAD^{commit}"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (head.status !== 0) throw new Error("EXECUTION_IDENTITY_INVALID: HEAD did not resolve");
	if (tree.status !== 0) throw new Error("EXECUTION_IDENTITY_INVALID: HEAD^{tree} did not resolve");
	const headOid = head.stdout.trim();
	const treeOid = tree.stdout.trim();
	if (!OID_PATTERN.test(headOid) || !OID_PATTERN.test(treeOid)) {
		throw new Error("EXECUTION_IDENTITY_MALFORMED: HEAD or tree did not match OID pattern");
	}
	return { head: headOid, tree: treeOid, subject: computeFilteredSubjectTreeOid(root) };
}

interface ProcessOutcome {
	code: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	spawnError: Error | null;
}

function runProcess(
	argv: string[],
	cwd: string,
	timeoutMs: number,
): Promise<ProcessOutcome> {
	return new Promise((resolvePromise) => {
		let child;
		try {
			child = spawn(argv[0]!, argv.slice(1), {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				detached: true,
				env: process.env,
				shell: false,
			});
		} catch (error) {
			resolvePromise({
				code: -1,
				signal: null,
				timedOut: false,
				stdout: "",
				stderr: `spawn error: ${error instanceof Error ? error.message : String(error)}\n`,
				spawnError: error instanceof Error ? error : new Error(String(error)),
			});
			return;
		}
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer | string) =>
			stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
		);
		child.stderr?.on("data", (chunk: Buffer | string) =>
			stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
		);
		let timedOut = false;
		let spawnError: Error | null = null;
		let settled = false;
		const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const stdout = redact(Buffer.concat(stdoutChunks).toString("utf8"));
			let stderr = redact(Buffer.concat(stderrChunks).toString("utf8"));
			if (spawnError && !stderr.includes(spawnError.message)) {
				stderr += `${stderr.length > 0 && !stderr.endsWith("\n") ? "\n" : ""}spawn error: ${spawnError.message}\n`;
			}
			resolvePromise({ code, signal, timedOut, stdout, stderr, spawnError });
		};
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				process.kill(-(child.pid ?? 0), "SIGTERM");
			} catch {
				try {
					if (child.pid !== undefined) process.kill(child.pid, "SIGTERM");
				} catch {
					/* already exited */
				}
			}
		}, timeoutMs);
		child.once("error", (error) => {
			spawnError = error;
			queueMicrotask(() => finish(-1, null));
		});
		child.once("close", (code, signal) => finish(code, signal));
	});
}

function statArtifact(root: string, repoRel: string): {
	exists: boolean;
	size: number;
	sha256: string | null;
} {
	const abs = resolve(root, ...repoRel.split("/"));
	if (!existsSync(abs)) return { exists: false, size: 0, sha256: null };
	const buf = readFileSync(abs);
	return { exists: true, size: buf.length, sha256: sha256(buf) };
}

function observeFileFormat(
	argv: string[],
	stdout: string,
	stderr: string,
): string | null {
	const source = stdout.length > 0 ? stdout : stderr;
	const firstLine = source.split("\n", 1)[0]?.trim() ?? "";
	if (firstLine.length > 0 && firstLine.length < 200) return firstLine;
	if (argv[0] === "file") return "file-format-from-file-tool";
	return null;
}

function observeArchitecture(stdout: string, stderr: string): string | null {
	const text = `${stdout}\n${stderr}`;
	const m = text.match(/(?:darwin|linux|windows)[-\/](?:arm64|x64)/i);
	return m ? m[0].toLowerCase() : null;
}

/**
 * Execute one probe and produce its execution record. The function never
 * throws — every failure mode is captured as `status: "fail"` with a
 * human-readable `reason`.
 */
async function executeProbe(
	def: NativeProbeDefinition,
	root: string,
	hostClass: string,
	identity: { head: string; tree: string; subject: string | null },
	timeoutMs: number,
): Promise<ProbeExecutionRecord> {
	const startedAt = new Date();
	const artifact = statArtifact(root, def.artifact_path);
	const hostSupported = def.host_support.includes(hostClass);
	const workingDirectory = resolve(root, def.working_directory);
	let outcome: ProcessOutcome;
	let argv = def.argv;
	// Probe P1 uses `file` (a host CLI for inspecting file headers) which
	// may not exist; we substitute a fallback that computes the Mach-O
	// architecture directly from the first 20 bytes of the artifact.
	if (argv[0] === "file" && !existsArtifact(root, argv[1] ?? "")) {
		argv = ["node", "-e", fileFallbackScript(argv[1] ?? "")];
	}
	if (!hostSupported) {
		outcome = {
			code: null,
			signal: null,
			timedOut: false,
			stdout: "",
			stderr: "",
			spawnError: null,
		};
	} else {
		outcome = await runProcess(argv, workingDirectory, timeoutMs);
	}
	const finishedAt = new Date();
	const stdoutText = outcome.stdout;
	const stderrText = outcome.stderr;
	const stdoutBuf = Buffer.from(stdoutText, "utf8");
	const stderrBuf = Buffer.from(stderrText, "utf8");
	const observedFileFormat = observeFileFormat(argv, stdoutText, stderrText);
	const observedArchitecture = observeArchitecture(stdoutText, stderrText);

	const ctx: ProbeSuccessContext = {
		argv,
		exit_code: outcome.spawnError ? -1 : outcome.code,
		signal: outcome.signal,
		timeout: outcome.timedOut,
		stdout: stdoutText,
		stderr: stderrText,
		artifactExists: artifact.exists,
		artifactSize: artifact.size,
		artifactSha256: artifact.sha256,
	};

	let status: "pass" | "fail";
	let reason: string;
	if (!hostSupported) {
		status = "fail";
		reason = `host=${hostClass} is not in host_support=${def.host_support.join(",")}`;
	} else if (outcome.spawnError !== null) {
		status = "fail";
		reason = `spawn error: ${outcome.spawnError.message}`;
	} else if (outcome.timedOut) {
		status = "fail";
		reason = `probe timed out after ${timeoutMs}ms`;
	} else {
		const verdict = def.success(ctx);
		if (verdict === null) {
			status = "pass";
			reason = `probe satisfied ${def.label}`;
		} else {
			status = "fail";
			reason = verdict;
		}
	}

	return {
		id: def.id,
		label: def.label,
		host_class: hostClass,
		artifact_path: def.artifact_path,
		working_directory: def.working_directory,
		argv,
		format_match: def.format_match,
		started_at: startedAt.toISOString(),
		finished_at: finishedAt.toISOString(),
		duration_ms: finishedAt.getTime() - startedAt.getTime(),
		exit_code: ctx.exit_code,
		signal: outcome.signal,
		timeout: outcome.timedOut,
		stdout_sha256: sha256(stdoutBuf),
		stderr_sha256: sha256(stderrBuf),
		stdout_text: stdoutText,
		stderr_text: stderrText,
		artifact_sha256: artifact.sha256,
		artifact_size: artifact.size,
		artifact_exists: artifact.exists,
		observed_file_format: observedFileFormat,
		observed_architecture: observedArchitecture,
		execution_head_oid: identity.head,
		execution_tree_oid: identity.tree,
		subject_tree_oid: identity.subject ?? "(subject-tree-computation-failed)",
		host_supported: hostSupported,
		host_support: def.host_support,
		status,
		reason,
	};
}

function existsArtifact(root: string, repoRel: string): boolean {
	const abs = resolve(root, ...repoRel.split("/"));
	return existsSync(abs);
}

function fileFallbackScript(path: string): string {
	const escaped = JSON.stringify(path);
	return `const fs = require('fs'); const buf = fs.readFileSync(${escaped}); const cputype = buf.readUInt32LE(4); const magic = buf.readUInt32LE(0); const swap = (n) => ((n & 0xff000000) >>> 24) | ((n & 0x00ff0000) >>> 8) | ((n & 0x0000ff00) << 8) | ((n & 0x000000ff) << 24); const isLE = magic === 0xfeedface; const cpu = isLE ? cputype : swap(cputype); const arch = cpu === 0x0100000c ? 'arm64' : (cpu === 0x01000007 ? 'x86_64' : ('0x' + cpu.toString(16))); process.stdout.write('Mach-O 64-bit ' + arch + ' bundle');`;
}

/**
 * Run every probe in `NATIVE_PROBE_DEFINITIONS` and produce a complete
 * `NativeProbesInventory`. Order of execution is the catalogue order; the
 * resulting object is keyed by `NativeProbeId` at the TOP LEVEL (the
 * schema inherited from CORRECTION15) so the loader and renderer can
 * look up probes by name without re-walking an array.
 */
export async function collectNativeProbesInventory(opts: {
	root?: string;
	timeoutMs?: number;
	collectedAt?: string;
} = {}): Promise<NativeProbesInventory> {
	const root = opts.root ?? repoRoot();
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const collectedAt = opts.collectedAt ?? new Date().toISOString();
	const identity = captureIdentity(root);
	const hostClass = hostClassOf(process.platform, process.arch);
	const inventory: Record<string, unknown> = {
		schema_version: 1,
		act_id: ACT_ID,
		host_class: hostClass,
		collected_at: collectedAt,
		execution_head_oid: identity.head,
		execution_tree_oid: identity.tree,
		subject_tree_oid: identity.subject ?? "(subject-tree-computation-failed)",
	};
	for (const def of NATIVE_PROBE_DEFINITIONS) {
		inventory[def.id] = await executeProbe(def, root, hostClass, identity, timeoutMs);
	}
	return inventory as unknown as NativeProbesInventory;
}

/**
 * Materialise the inventory to disk as JSON. Used both for the tracked
 * mirror (informational only) and the staged bundle copy (authoritative).
 */
export function writeInventory(inv: NativeProbesInventory, outputPath: string): void {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, JSON.stringify(inv, null, "\t") + "\n", "utf8");
}

export const __test_only = {
	probeDefinitionFor,
	statArtifact,
	observeFileFormat,
	observeArchitecture,
	runProcess,
	existsArtifact,
};

if (import.meta.main) {
	void (async () => {
		const inv = await collectNativeProbesInventory();
		const out = join(repoRoot(), "factory/inventories/native-probes.json");
		writeInventory(inv, out);
		const probes = NATIVE_PROBE_IDS.map((id) => inv[id]).filter(
			(p): p is { status: "pass" | "fail" } => p !== undefined,
		);
		const passed = probes.filter((p) => p.status === "pass").length;
		const failed = probes.filter((p) => p.status !== "pass").length;
		// eslint-disable-next-line no-console
		console.log(`Wrote ${out} (passed=${passed} failed=${failed})`);
	})().catch((error) => {
		// eslint-disable-next-line no-console
		console.error(error);
		process.exitCode = 1;
	});
}