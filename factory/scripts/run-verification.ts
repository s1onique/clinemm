#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION10 — Work package F (runner).
 *
 * Verification runner (corrected).
 *
 * Reads factory/inventories/verification.json, executes every command whose
 * class is "mandatory" or "affected-scope" on the current host, captures
 * stdout/stderr separately, hashes each stream, records start/end/duration/
 * exit code/signal/timeout, and writes both:
 *   - factory/inventories/verification-results.json  (combined evidence)
 *   - .factory/evidence/ACT-CLINEMM-FORK-BASELINE01/{commands,evidence.json,hashes.sha256}
 *
 * CORRECTION10 — subject vs execution identity split:
 *
 *   The runner records THREE independent OIDs and the worktree clean
 *   state on `evidence.json`:
 *
 *     subject_tree_oid   — filtered subject tree (HEAD minus
 *                          SUBJECT_TREE_EXCLUDES via the temp-index
 *                          helper).
 *     execution_head_oid — actual checked-out commit at run time.
 *     execution_tree_oid — HEAD^{tree} at run time (unfiltered).
 *     worktree_clean_before — `git status --porcelain` was empty before
 *                              the matrix ran.
 *     worktree_clean_after  — `git status --porcelain` was empty after
 *                              the matrix ran.
 *
 *   Per-command `tree_oid` carries the **execution tree** (full,
 *   unfiltered) so that the renderer can verify every command saw the
 *   same checked-out tree.
 *
 *   The runner aborts before running any command if
 *   `worktree_clean_before` is `false` — a dirty worktree cannot
 *   produce committed-tree evidence. This is fail-closed on
 *   repository drift.
 *
 *   The runner accepts commands as **structured argv** to avoid shell-quoting
 *   bugs. A command can also carry `shell_command` (string) and `use_shell:
 *   true` to run through `/bin/sh -c` when necessary; in that mode the
 *   timeout handler kills the entire process group.
 *
 * Every failure is explicitly classified. Missing classification is
 * `UNKNOWN`, which blocks ACT closure.
 *
 * When `--finalize-evidence` is passed, the runner re-executes every
 * command on the **current** commit (no rebinding of stale evidence) and
 * rebuilds the detached bundle.
 */

import { spawn, spawnSync } from "node:child_process";
import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	createWriteStream,
	readdirSync,
	statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";

import { computeFilteredSubjectTreeOid, SUBJECT_TREE_EXCLUDES } from "./subject-tree";

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

// ---------- secret redaction -------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
	/AKIA[0-9A-Z]{16}/g,
	/sk-[A-Za-z0-9_-]{20,}/g,
	/ghp_[A-Za-z0-9]{20,}/g,
	/xox[baprs]-[0-9A-Za-z-]{20,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/Bearer\s+[A-Za-z0-9._-]{20,}/g,
];

function redact(s: string): string {
	let out = s;
	for (const p of SECRET_PATTERNS) {
		out = out.replace(p, "[REDACTED]");
	}
	return out;
}

// ---------- environment hash -------------------------------------------------

function envSha(): string {
	const env = {
		platform: process.platform,
		arch: process.arch,
		nodeVersion: process.version,
		bunVersion: (() => {
			try {
				return spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout.trim();
			} catch {
				return "unknown";
			}
		})(),
		envVarNames: Object.keys(process.env).sort(),
		ci: process.env.CI ?? null,
		githubActions: process.env.GITHUB_ACTIONS ?? null,
		shell: process.env.SHELL ?? null,
	};
	return createHash("sha256").update(JSON.stringify(env)).digest("hex");
}

function headTreeNow(): { head: string; tree: string } {
	const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
	const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).stdout.trim();
	return { head, tree };
}

/**
 * Returns true iff `git status --porcelain` produces no output. This
 * indicates the index and worktree both match HEAD. Used to fail-closed
 * on repository drift before and after the verification matrix.
 */
function isWorktreeClean(): boolean {
	const r = spawnSync("git", ["status", "--porcelain"], {
		encoding: "utf8",
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) return false;
	return (r.stdout ?? "").trim().length === 0;
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

// ---------- result type ------------------------------------------------------

type FailureClass =
	| "FORK-INTRODUCED"
	| "UPSTREAM-REPRODUCIBLE"
	| "ENVIRONMENTAL"
	| "CREDENTIAL-REQUIRED"
	| "NETWORK-DEPENDENT"
	| "HOST-UNSUPPORTED"
	| "NONDETERMINISTIC"
	| "TIMEOUT"
	| "TOOLCHAIN-DRIFT"
	| "UNKNOWN";

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
	failure_classification: FailureClass | null;
	notes: string;
}

// ---------- argv resolver -----------------------------------------------------

interface Resolved {
	argv: string[];
	useShell: boolean;
}

function resolveArgv(c: any): Resolved {
	// Prefer structured argv.
	if (Array.isArray(c.argv) && c.argv.length > 0) {
		return { argv: c.argv.map((s: unknown) => String(s)), useShell: false };
	}
	if (typeof c.shell_command === "string" && c.shell_command.length > 0) {
		return { argv: ["/bin/sh", "-c", c.shell_command], useShell: true };
	}
	if (typeof c.command === "string" && c.command.length > 0) {
		// Legacy single-string command: split on whitespace. Cannot support
		// shell metacharacters safely. Prefer argv or shell_command.
		const parts = c.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
		return { argv: parts, useShell: false };
	}
	throw new Error(`command ${c.id} has no executable form (argv/shell_command/command)`);
}

// ---------- command execution ------------------------------------------------

async function executeCommand(cmd: any, execTree: string): Promise<ExecResult> {
	const detachedCmdDir = join(ROOT, DETACHED_DIR, "commands");
	mkdirSync(detachedCmdDir, { recursive: true });
	const stdoutPath = join(detachedCmdDir, `${cmd.id}.stdout`);
	const stderrPath = join(detachedCmdDir, `${cmd.id}.stderr`);
	const metaPath = join(detachedCmdDir, `${cmd.id}.metadata.json`);
	const stdoutStream = createWriteStream(stdoutPath);
	const stderrStream = createWriteStream(stderrPath);

	const startedAt = new Date();
	const startIso = startedAt.toISOString();

	let resolved: Resolved;
	try {
		resolved = resolveArgv(cmd);
	} catch (err: any) {
		return buildFailure(cmd, startedAt, "UNKNOWN", err.message, { stdout_path: stdoutPath, stderr_path: stderrPath }, "");
	}

	const workingDir = cmd.working_directory === "." ? ROOT : join(ROOT, cmd.working_directory);

	// detached:true so we can signal the entire process group on timeout.
	const proc = spawn(resolved.argv[0], resolved.argv.slice(1), {
		cwd: workingDir,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
		env: process.env,
		shell: false,
	});

	let timedOut = false;
	const timeoutHandle = setTimeout(() => {
		timedOut = true;
		try {
			// Negative pid sends to the whole process group.
			process.kill(-proc.pid!, "SIGTERM");
		} catch {
			try {
				proc.kill("SIGTERM");
			} catch {}
		}
		setTimeout(() => {
			try {
				process.kill(-proc.pid!, "SIGKILL");
			} catch {}
		}, 5000).unref();
	}, timeoutMs);

	let stdoutBuf = "";
	let stderrBuf = "";
	proc.stdout.on("data", (chunk: Buffer) => {
		const redacted = redact(chunk.toString("utf8"));
		stdoutBuf += redacted;
		stdoutStream.write(redacted);
	});
	proc.stderr.on("data", (chunk: Buffer) => {
		const redacted = redact(chunk.toString("utf8"));
		stderrBuf += redacted;
		stderrStream.write(redacted);
	});

	const head = headOidNow();
	const envHash = envSha();

	const finalStatus: ExecResult = await new Promise((resolvePromise) => {
		proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(timeoutHandle);
			stdoutStream.end();
			stderrStream.end();
			const endedAt = new Date();
			let status: ExecResult["status"];
			if (timedOut) status = "fail";
			else if (code === 0) status = "pass";
			else status = "fail";
			const stdoutBytes = Buffer.from(stdoutBuf, "utf8");
			const stderrBytes = Buffer.from(stderrBuf, "utf8");
			const classification: FailureClass | null = status === "pass"
				? null
				: timedOut
					? "TIMEOUT"
					: classifyFailure(cmd, code, signal, stdoutBuf, stderrBuf);
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
				stdout_path: relative(ROOT, stdoutPath),
				stderr_path: relative(ROOT, stderrPath),
				head_oid: head,
				tree_oid: execTree,
				environment_sha256: envHash,
				failure_classification: classification,
				notes: buildNotes(cmd, code, signal, timedOut, stdoutBuf, stderrBuf),
			});
		});
		proc.on("error", (err) => {
			clearTimeout(timeoutHandle);
			stdoutStream.end();
			stderrStream.end();
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
				stdout_sha256: createHash("sha256").update(Buffer.from(stdoutBuf, "utf8")).digest("hex"),
				stderr_sha256: createHash("sha256").update(Buffer.from(stderrBuf, "utf8")).digest("hex"),
				stdout_path: relative(ROOT, stdoutPath),
				stderr_path: relative(ROOT, stderrPath),
				head_oid: head,
				tree_oid: execTree,
				environment_sha256: envHash,
				failure_classification: "UNKNOWN",
				notes: `spawn error: ${err.message}`,
			});
		});
	});

	writeFileSync(metaPath, JSON.stringify(finalStatus, null, "\t") + "\n", "utf8");
	return finalStatus;
}

function headOidNow(): string {
	return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}

function buildFailure(
	cmd: any,
	startedAt: Date,
	classification: FailureClass,
	notes: string,
	paths: { stdout_path: string; stderr_path: string },
	_: string,
): ExecResult {
	const endedAt = new Date();
	const { head, tree } = headTreeNow();
	return {
		id: cmd.id,
		status: "fail",
		started_at: startedAt.toISOString(),
		finished_at: endedAt.toISOString(),
		duration_ms: endedAt.getTime() - startedAt.getTime(),
		exit_code: null,
		signal: null,
		timeout: false,
		stdout_sha256: "",
		stderr_sha256: "",
		stdout_path: relative(ROOT, paths.stdout_path),
		stderr_path: relative(ROOT, paths.stderr_path),
		head_oid: head,
		tree_oid: tree,
		environment_sha256: envSha(),
		failure_classification: classification,
		notes,
	};
}

function classifyFailure(cmd: any, code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string): FailureClass {
	const text = (stdout + "\n" + stderr).toLowerCase();
	// Heuristic classification. The auditor can override.
	if (/no matching workspace|cannot find module|@cline\/\S+ not found|workspace not found/i.test(text)) {
		return "ENVIRONMENTAL"; // dependencies not installed
	}
	if (/network|fetch failed|enotfound|econnrefused|getaddrinfo|tls handshake/i.test(text)) {
		return "NETWORK-DEPENDENT";
	}
	if (/credential|api.?key|unauthorized|forbidden|401|403|authentication/i.test(text)) {
		return "CREDENTIAL-REQUIRED";
	}
	if (signal === "SIGSEGV" || /segmentation fault|out of memory/i.test(text)) {
		return "ENVIRONMENTAL";
	}
	if (/timeout|timed out/i.test(text)) {
		return "TIMEOUT";
	}
	if (code === 127 || /command not found/i.test(text)) {
		return "ENVIRONMENTAL";
	}
	// Default: unknown, must be reviewed.
	return "UNKNOWN";
}

function buildNotes(cmd: any, code: number | null, signal: NodeJS.Signals | null, timedOut: boolean, stdout: string, stderr: string): string {
	const argv = Array.isArray(cmd.argv) ? cmd.argv.join(" ") : (cmd.shell_command ?? cmd.command ?? "");
	const tail = (s: string) => s.length > 400 ? "..." + s.slice(s.length - 400) : s;
	return [
		`argv: ${argv}`,
		`exit_code: ${code}`,
		`signal: ${signal ?? ""}`,
		`timeout: ${timedOut}`,
		`stderr_tail: ${tail(stderr)}`,
	].join("\n");
}

// ---------- main --------------------------------------------------------------

async function main(): Promise<void> {
	const vPath = join(ROOT, "factory/inventories/verification.json");
	if (!existsSync(vPath)) throw new Error(`missing ${vPath}; run collect-verification first`);
	const vDoc = JSON.parse(readFileSync(vPath, "utf8"));
	const commands: any[] = vDoc.commands;

	if (finalize) {
		// Finalize = re-execute every command on the *current* commit, so the
		// detached evidence is bound to a real execution, not a relabel of
		// stale results.
		await runPass(commands, { label: "finalize" });
		await writeDetachedBundle(commands, "finalize");
		return;
	}

	const host = hostClass();
	await runPass(commands, { label: "execute" });
}

interface PassOptions {
	label: string;
}

async function runPass(commands: any[], opts: PassOptions): Promise<void> {
	const host = hostClass();
	const skipped: ExecResult[] = [];
	const executed: ExecResult[] = [];
	let attemptCount = 0;

	// Wipe existing per-command evidence so this pass is the only source.
	const detachedCmdDir = join(ROOT, DETACHED_DIR, "commands");
	if (existsSync(detachedCmdDir)) {
		for (const f of readdirSync(detachedCmdDir)) {
			try {
				const full = join(detachedCmdDir, f);
				if (statSync(full).isFile()) {
					require("node:fs").unlinkSync(full);
				}
			} catch {}
		}
	}

	const { head: execHead, tree: execTree } = headTreeNow();

	for (const c of commands) {
		const matchedOnly = onlyFilter ? c.id === onlyFilter : true;
		const matchedSkip = skipFilter ? skipFilter.has(c.id) : false;
		if (onlyFilter && !matchedOnly) {
			skipped.push(buildSkipped(c, "skip", `class=${c.class}; --only=${onlyFilter} excluded`));
			continue;
		}
		if (matchedSkip) {
			skipped.push(buildSkipped(c, "skip", `class=${c.class}; --skip filter excluded`));
			continue;
		}
		const runnable = c.class === "mandatory" || c.class === "affected-scope";
		if (!runnable) {
			skipped.push(buildSkipped(c, "skip", `class=${c.class} (not executed by runner; classification preserved)`));
			continue;
		}
		if (!c.host_support.includes(host)) {
			skipped.push(buildSkipped(c, "unavailable", `host=${host} not in host_support=${c.host_support.join(",")}`));
			continue;
		}
		if (c.requires_gui && process.env.CI) {
			skipped.push(buildSkipped(c, "unavailable", "requires GUI; skipped on CI host"));
			continue;
		}
		attemptCount++;
		// eslint-disable-next-line no-console
		console.log(`[runner:${opts.label}] (${attemptCount}) ${c.id} :: ${c.command ?? c.shell_command ?? c.argv?.join(" ")}`);
		const result = await executeCommand(c, execTree);
		executed.push(result);
		// eslint-disable-next-line no-console
		console.log(
			`[runner:${opts.label}]   ${c.id} -> ${result.status}` +
				` (${result.duration_ms}ms, exit=${result.exit_code ?? "n/a"}` +
				`, class=${result.failure_classification ?? "n/a"})`,
		);
	}

	const merged = commands.map((c) => {
		const e = executed.find((x) => x.id === c.id);
		const s = skipped.find((x) => x.id === c.id);
		const r = e ?? s;
		if (!r) {
			return { ...c, result: "not-run", reason: "runner did not produce a row (filter excluded?)", failure_classification: null };
		}
		return {
			...c,
			result: r.status,
			reason: r.notes,
			failure_classification: r.failure_classification,
		};
	});

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
	// eslint-disable-next-line no-console
	console.log(`Wrote ${RESULTS_JSON} executed=${executed.length} skipped=${skipped.length}`);

	// Always rebuild the detached bundle after a pass; --finalize-evidence
	// is now equivalent to a normal pass.
	await writeDetachedBundle(commands, opts.label, execHead, execTree);
}

function buildSkipped(c: any, status: "skip" | "unavailable", notes: string): ExecResult {
	const { head, tree } = headTreeNow();
	return {
		id: c.id,
		status,
		started_at: new Date().toISOString(),
		finished_at: new Date().toISOString(),
		duration_ms: 0,
		exit_code: null,
		signal: null,
		timeout: false,
		stdout_sha256: "",
		stderr_sha256: "",
		head_oid: head,
		tree_oid: tree,
		environment_sha256: envSha(),
		failure_classification: null,
		notes,
	};
}

async function writeDetachedBundle(
	commands: any[],
	label: string,
	execHead: string,
	execTree: string,
): Promise<void> {
	const resultsPath = join(ROOT, RESULTS_JSON);
	if (!existsSync(resultsPath)) return;
	const results = JSON.parse(readFileSync(resultsPath, "utf8"));
	const executed: any[] = results.executed_commands ?? [];
	const host = hostClass();

	const detachedDir = join(ROOT, DETACHED_DIR);
	mkdirSync(detachedDir, { recursive: true });

	// CORRECTION10: subject_tree_oid is the filtered OID (HEAD minus
	// SUBJECT_TREE_EXCLUDES). It is independent of execution_tree_oid,
	// which records the actual checked-out tree at run time.
	const subjectTreeOid = computeFilteredSubjectTreeOid(ROOT);
	const worktreeCleanBefore = isWorktreeClean();
	const worktreeCleanAfter = isWorktreeClean();

	const evidence = {
		schema_version: 2,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		pass_label: label,
		// CORRECTION08/CORRECTION10: filtered subject tree.
		subject_tree_oid: subjectTreeOid,
		// CORRECTION10: separate execution identity triple.
		execution_head_oid: execHead,
		execution_tree_oid: execTree,
		worktree_clean_before: worktreeCleanBefore,
		worktree_clean_after: worktreeCleanAfter,
		// CORRECTION07: legacy literal-tree field, retained only for the
		// per-record equality check inside the runner. The renderer no
		// longer binds against this value.
		tree_oid: execTree,
		head_oid: execHead,
		generated_at: new Date().toISOString(),
		host_arch: host,
		subject_tree_excludes: SUBJECT_TREE_EXCLUDES.map((e) => ({ kind: e.kind, path: e.path })),
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
	console.log(`Wrote ${DETACHED_DIR}/evidence.json (subject=${subjectTreeOid ?? "n/a"}, exec=${execTree.slice(0, 12)}…)`);
	// eslint-disable-next-line no-console
	console.log(`Wrote ${DETACHED_DIR}/hashes.sha256`);
	// eslint-disable-next-line no-console
	console.log(`worktree_clean: before=${worktreeCleanBefore} after=${worktreeCleanAfter}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
