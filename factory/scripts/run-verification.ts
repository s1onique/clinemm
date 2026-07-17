#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01 — Work package F
 *
 * Verification runner.
 *
 * Reads factory/inventories/verification.json, executes every command whose
 * class is "mandatory" or "affected-scope" on the current host, captures
 * stdout/stderr separately, hashes each stream, records start/end/duration/
 * exit code/signal/timeout, and writes both:
 *   - factory/inventories/verification-results.json  (combined evidence)
 *   - .factory/evidence/ACT-CLINEMM-FORK-BASELINE01/{commands,evidence.json,hashes.sha256}
 *
 * When `--finalize-evidence` is passed, the detached evidence bundle is
 * regenerated and bound to the literal final HEAD/tree.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	createWriteStream,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const RESULTS_JSON = "factory/inventories/verification-results.json";
const DETACHED_DIR = ".factory/evidence/ACT-CLINEMM-FORK-BASELINE01";

function repoRoot(): string {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error("git rev-parse failed");
	return (r.stdout ?? "").trim();
}

const ROOT = repoRoot();

// ---------- argument parsing --------------------------------------------------

const argv = process.argv.slice(2);
const finalize = argv.includes("--finalize-evidence");
const onlyFilter = (() => {
	const i = argv.indexOf("--only");
	return i >= 0 ? argv[i + 1] : null;
})();
const skipFilter = (() => {
	const i = argv.indexOf("--skip");
	return i >= 0 ? new Set(argv[i + 1].split(",")) : null;
})();
const timeoutMs = (() => {
	const i = argv.indexOf("--timeout-ms");
	return i >= 0 ? Number.parseInt(argv[i + 1], 10) : 600_000; // 10min default
})();

// ---------- helpers -----------------------------------------------------------

function shQuote(s: string): string {
	if (/^[A-Za-z0-9._\/=:@+-]+$/.test(s)) return s;
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface ExecResult {
	id: string;
	status: "pass" | "fail" | "skip" | "unavailable" | "not-run";
	started_at: string;
	finished_at: string;
	duration_ms: number;
	exit_code: number | null;
	signal: string | null;
	timeout: boolean;
	stdout_sha256: string;
	stderr_sha256: string;
	stdout_path?: string;
	stderr_path?: string;
	head_oid: string;
	tree_oid: string;
	environment_sha256: string;
	failure_classification?: string;
	notes?: string;
}

function headTreeNow(): { head: string; tree: string } {
	const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
	const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).stdout.trim();
	return { head, tree };
}

function envSha(): string {
	const env = JSON.stringify({
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version,
	}, Object.keys(process.env).sort());
	return createHash("sha256").update(env).digest("hex");
}

function hostClass(): string {
	const a = process.arch;
	const p = process.platform;
	if (p === "darwin" && a === "arm64") return "darwin-arm64";
	if (p === "linux" && a === "x64") return "linux-x64";
	if (p === "win32" && a === "x64") return "windows-x64";
	if (p === "linux" && a === "arm64") return "linux-arm64";
	if (p === "win32" && a === "arm64") return "windows-arm64";
	return `${p}-${a}`;
}

async function executeCommand(cmd: {
	id: string;
	command: string;
	working_directory: string;
	class: string;
	host_support: string[];
	requires_gui: boolean;
	mutates_tracked_files: boolean;
}): Promise<ExecResult> {
	const detachedCmdDir = join(ROOT, DETACHED_DIR, "commands");
	mkdirSync(detachedCmdDir, { recursive: true });
	const stdoutPath = join(detachedCmdDir, `${cmd.id}.stdout`);
	const stderrPath = join(detachedCmdDir, `${cmd.id}.stderr`);
	const metaPath = join(detachedCmdDir, `${cmd.id}.metadata.json`);
	const stdoutStream = createWriteStream(stdoutPath);
	const stderrStream = createWriteStream(stderrPath);

	const startedAt = new Date();
	const startIso = startedAt.toISOString();

	const cmdParts = cmd.command.split(/\s+/);
	const cmdBin = cmdParts[0];
	const cmdArgs = cmdParts.slice(1);

	const workingDir = cmd.working_directory === "." ? ROOT : join(ROOT, cmd.working_directory);

	const proc = spawn(cmdBin, cmdArgs, {
		cwd: workingDir,
		stdio: ["ignore", "pipe", "pipe"],
		detached: false,
		env: process.env,
	});

	let timedOut = false;
	const timeoutHandle = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGTERM");
		setTimeout(() => proc.kill("SIGKILL"), 5000).unref();
	}, timeoutMs);

	let stdoutBuf = "";
	let stderrBuf = "";
	proc.stdout.on("data", (chunk: Buffer) => {
		stdoutBuf += chunk.toString("utf8");
		stdoutStream.write(chunk);
	});
	proc.stderr.on("data", (chunk: Buffer) => {
		stderrBuf += chunk.toString("utf8");
		stderrStream.write(chunk);
	});

	const { head, tree } = headTreeNow();
	const envHash = envSha();

	const finalStatus: ExecResult = await new Promise((resolvePromise) => {
		proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(timeoutHandle);
			stdoutStream.end();
			stderrStream.end();
			const endedAt = new Date();
			const status: ExecResult["status"] = timedOut ? "fail" : code === 0 ? "pass" : "fail";
			const stdoutBytes = Buffer.from(stdoutBuf, "utf8");
			const stderrBytes = Buffer.from(stderrBuf, "utf8");
			resolvePromise({
				id: cmd.id,
				status,
				started_at: startIso,
				finished_at: endedAt.toISOString(),
				duration_ms: endedAt.getTime() - startedAt.getTime(),
				exit_code: code,
				signal: signal ?? null,
				timeout: timedOut,
				stdout_sha256: createHash("sha256").update(stdoutBytes).digest("hex"),
				stderr_sha256: createHash("sha256").update(stderrBytes).digest("hex"),
				stdout_path: stdoutPath.replace(`${ROOT}/`, ""),
				stderr_path: stderrPath.replace(`${ROOT}/`, ""),
				head_oid: head,
				tree_oid: tree,
				environment_sha256: envHash,
			});
		});
		proc.on("error", (err) => {
			clearTimeout(timeoutHandle);
			stdoutStream.end();
			stderrStream.end();
			stderrBuf += `\n[runner-error] ${err.message}\n`;
			const endedAt = new Date();
			resolvePromise({
				id: cmd.id,
				status: "fail",
				started_at: startIso,
				finished_at: endedAt.toISOString(),
				duration_ms: endedAt.getTime() - startedAt.getTime(),
				exit_code: -1,
				signal: null,
				timeout: false,
				stdout_sha256: createHash("sha256").update(stdoutBuf).digest("hex"),
				stderr_sha256: createHash("sha256").update(stderrBuf).digest("hex"),
				stdout_path: stdoutPath.replace(`${ROOT}/`, ""),
				stderr_path: stderrPath.replace(`${ROOT}/`, ""),
				head_oid: head,
				tree_oid: tree,
				environment_sha256: envHash,
				notes: `spawn error: ${err.message}`,
			});
		});
	});

	writeFileSync(metaPath, JSON.stringify(finalStatus, null, "\t") + "\n", "utf8");
	return finalStatus;
}

// ---------- main --------------------------------------------------------------

async function main(): Promise<void> {
	const vPath = join(ROOT, "factory/inventories/verification.json");
	if (!existsSync(vPath)) throw new Error(`missing ${vPath}; run collect-verification first`);
	const vDoc = JSON.parse(readFileSync(vPath, "utf8"));
	const commands: any[] = vDoc.commands;

	// Finalize path: re-read existing verification-results.json (if present) and
	// rebuild the detached evidence bundle bound to the literal final HEAD/tree,
	// without re-executing any command.
	if (finalize) {
		await finalizeEvidence();
		return;
	}

	const host = hostClass();

	const skipped: ExecResult[] = [];
	const executed: ExecResult[] = [];
	let attemptCount = 0;

	// Sequential execution. We keep simple ordering and per-command timeout.
	// Independent commands are not parallelized in this baseline ACT (determinism over speed).
	for (const c of commands) {
		const matchedOnly = onlyFilter ? c.id === onlyFilter : true;
		const matchedSkip = skipFilter ? skipFilter.has(c.id) : false;
		if (onlyFilter && !matchedOnly) {
			// not selected by --only
			skipped.push({
				id: c.id,
				status: "skip",
				started_at: new Date().toISOString(),
				finished_at: new Date().toISOString(),
				duration_ms: 0,
				exit_code: null,
				signal: null,
				timeout: false,
				stdout_sha256: "",
				stderr_sha256: "",
				head_oid: "",
				tree_oid: "",
				environment_sha256: envSha(),
				notes: `class=${c.class}; --only=${onlyFilter} excluded`,
			});
			continue;
		}
		if (matchedSkip) {
			skipped.push({
				id: c.id,
				status: "skip",
				started_at: new Date().toISOString(),
				finished_at: new Date().toISOString(),
				duration_ms: 0,
				exit_code: null,
				signal: null,
				timeout: false,
				stdout_sha256: "",
				stderr_sha256: "",
				head_oid: "",
				tree_oid: "",
				environment_sha256: envSha(),
				notes: `class=${c.class}; --skip filter excluded`,
			});
			continue;
		}

		// Filter to classes we actually run
		const runnable = c.class === "mandatory" || c.class === "affected-scope";
		if (!runnable) {
			skipped.push({
				id: c.id,
				status: "skip",
				started_at: new Date().toISOString(),
				finished_at: new Date().toISOString(),
				duration_ms: 0,
				exit_code: null,
				signal: null,
				timeout: false,
				stdout_sha256: "",
				stderr_sha256: "",
				head_oid: "",
				tree_oid: "",
				environment_sha256: envSha(),
				notes: `class=${c.class} (not executed by runner; classification preserved)`,
			});
			continue;
		}

		// host support check
		if (!c.host_support.includes(host)) {
			skipped.push({
				id: c.id,
				status: "unavailable",
				started_at: new Date().toISOString(),
				finished_at: new Date().toISOString(),
				duration_ms: 0,
				exit_code: null,
				signal: null,
				timeout: false,
				stdout_sha256: "",
				stderr_sha256: "",
				head_oid: "",
				tree_oid: "",
				environment_sha256: envSha(),
				notes: `host=${host} not in host_support=${c.host_support.join(",")}`,
			});
			continue;
		}

		// GUI requirement on headless CI: skip
		if (c.requires_gui && process.env.CI) {
			skipped.push({
				id: c.id,
				status: "unavailable",
				started_at: new Date().toISOString(),
				finished_at: new Date().toISOString(),
				duration_ms: 0,
				exit_code: null,
				signal: null,
				timeout: false,
				stdout_sha256: "",
				stderr_sha256: "",
				head_oid: "",
				tree_oid: "",
				environment_sha256: envSha(),
				notes: "requires GUI; skipped on CI host",
			});
			continue;
		}

		attemptCount++;
		// eslint-disable-next-line no-console
		console.log(`[runner] (${attemptCount}) ${c.id} :: ${c.command}`);
		const result = await executeCommand(c);
		executed.push(result);
		// eslint-disable-next-line no-console
		console.log(`[runner]   ${c.id} -> ${result.status} (${result.duration_ms}ms, exit=${result.exit_code ?? "n/a"})`);
	}

	// Merge with input verification.json, mark result per command
	const merged = commands.map((c) => {
		const e = executed.find((x) => x.id === c.id);
		const s = skipped.find((x) => x.id === c.id);
		const r = e ?? s;
		if (!r) return { ...c, result: "not-run", reason: "runner did not produce a row (filter excluded?)" };
		return {
			...c,
			result: r.status,
			reason: r.notes ?? null,
		};
	});

	// Write results back into verification-results.json
	const out = {
		schema_version: 1,
		host,
		executed_at: new Date().toISOString(),
		executed_commands: executed,
		skipped_commands: skipped,
		commands: merged,
	};
	mkdirSync(dirname(join(ROOT, RESULTS_JSON)), { recursive: true });
	writeFileSync(join(ROOT, RESULTS_JSON), JSON.stringify(out, null, "\t") + "\n", "utf8");

	// Detached evidence bundle
	const detachedDir = join(ROOT, DETACHED_DIR);
	mkdirSync(detachedDir, { recursive: true });
	const { head, tree } = headTreeNow();
	const evidence = {
		schema_version: 1,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		head_oid: head,
		tree_oid: tree,
		generated_at: new Date().toISOString(),
		host_arch: host,
		commands: executed,
		hashes: {} as Record<string, string>,
	};
	// hashes over command stdout/stderr files
	for (const e of executed) {
		if (e.stdout_path) {
			const abs = resolve(ROOT, e.stdout_path);
			if (existsSync(abs)) {
				const buf = readFileSync(abs);
				evidence.hashes[`${e.id}.stdout`] = createHash("sha256").update(buf).digest("hex");
			}
		}
		if (e.stderr_path) {
			const abs = resolve(ROOT, e.stderr_path);
			if (existsSync(abs)) {
				const buf = readFileSync(abs);
				evidence.hashes[`${e.id}.stderr`] = createHash("sha256").update(buf).digest("hex");
			}
		}
		if (e.stdout_sha256) evidence.hashes[`${e.id}.stdout_stream`] = e.stdout_sha256;
		if (e.stderr_sha256) evidence.hashes[`${e.id}.stderr_stream`] = e.stderr_sha256;
	}
	writeFileSync(join(detachedDir, "evidence.json"), JSON.stringify(evidence, null, "\t") + "\n", "utf8");

	// Combined hashes.sha256 over evidence + commands
	const lines: string[] = [];
	function add(rel: string): void {
		const abs = resolve(ROOT, rel);
		if (!existsSync(abs)) return;
		const buf = readFileSync(abs);
		const sha = createHash("sha256").update(buf).digest("hex");
		lines.push(`${sha}  ${rel}`);
	}
	add(`${DETACHED_DIR}/evidence.json`);
	for (const e of executed) {
		if (e.stdout_path) add(e.stdout_path);
		if (e.stderr_path) add(e.stderr_path);
	}
	writeFileSync(join(detachedDir, "hashes.sha256"), lines.join("\n") + "\n", "utf8");

	// eslint-disable-next-line no-console
	console.log(`Wrote ${RESULTS_JSON}`);
	// eslint-disable-next-line no-console
	console.log(`Wrote ${DETACHED_DIR}/evidence.json`);
	// eslint-disable-next-line no-console
	console.log(`Wrote ${DETACHED_DIR}/hashes.sha256`);
	// eslint-disable-next-line no-console
	console.log(`executed=${executed.length} skipped=${skipped.length}`);
}

async function finalizeEvidence(): Promise<void> {
	const resultsPath = join(ROOT, RESULTS_JSON);
	if (!existsSync(resultsPath)) {
		throw new Error(`${resultsPath} not found; run a normal pass first.`);
	}
	const results = JSON.parse(readFileSync(resultsPath, "utf8"));
	const executed: any[] = results.executed_commands ?? [];
	const skipped: any[] = results.skipped_commands ?? [];

	// Do NOT rewrite factory/inventories/verification-results.json on the
	// finalization pass. That file is a stable historical record; the
	// detached evidence bundle below is the authoritative final binding to
	// HEAD/tree. Re-writing would create an OID-update cycle that prevents
	// `git status` from settling at a clean post-finalize state.

	// Rebuild the detached evidence bundle.
	const detachedDir = join(ROOT, DETACHED_DIR);
	mkdirSync(detachedDir, { recursive: true });
	const { head, tree } = headTreeNow();
	const evidence = {
		schema_version: 1,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		head_oid: head,
		tree_oid: tree,
		generated_at: new Date().toISOString(),
		host_arch: host,
		commands: executed,
		hashes: {} as Record<string, string>,
	};
	for (const e of executed) {
		if (e.stdout_path) {
			const abs = resolve(ROOT, e.stdout_path);
			if (existsSync(abs)) {
				const buf = readFileSync(abs);
				evidence.hashes[`${e.id}.stdout`] = createHash("sha256").update(buf).digest("hex");
			}
		}
		if (e.stderr_path) {
			const abs = resolve(ROOT, e.stderr_path);
			if (existsSync(abs)) {
				const buf = readFileSync(abs);
				evidence.hashes[`${e.id}.stderr`] = createHash("sha256").update(buf).digest("hex");
			}
		}
		if (e.stdout_sha256) evidence.hashes[`${e.id}.stdout_stream`] = e.stdout_sha256;
		if (e.stderr_sha256) evidence.hashes[`${e.id}.stderr_stream`] = e.stderr_sha256;
	}
	writeFileSync(join(detachedDir, "evidence.json"), JSON.stringify(evidence, null, "\t") + "\n", "utf8");

	const lines: string[] = [];
	function add(rel: string): void {
		const abs = resolve(ROOT, rel);
		if (!existsSync(abs)) return;
		const buf = readFileSync(abs);
		const sha = createHash("sha256").update(buf).digest("hex");
		lines.push(`${sha}  ${rel}`);
	}
	add(`${DETACHED_DIR}/evidence.json`);
	for (const e of executed) {
		if (e.stdout_path) add(e.stdout_path);
		if (e.stderr_path) add(e.stderr_path);
	}
	writeFileSync(join(detachedDir, "hashes.sha256"), lines.join("\n") + "\n", "utf8");

	// eslint-disable-next-line no-console
	console.log(`Finalized ${RESULTS_JSON}`);
	// eslint-disable-next-line no-console
	console.log(`Finalized ${DETACHED_DIR}/evidence.json`);
	// eslint-disable-next-line no-console
	console.log(`Finalized ${DETACHED_DIR}/hashes.sha256`);
	// eslint-disable-next-line no-console
	console.log(`head_oid=${head} tree_oid=${tree}`);
}

void shQuote;

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
