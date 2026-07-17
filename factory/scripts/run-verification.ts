#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION11 — Verification runner.
 *
 * Reads factory/inventories/verification.json, executes every command whose
 * class is "mandatory" or "affected-scope" on the current host, captures
 * stdout/stderr separately, hashes each stream, records start/end/duration/
 * exit code/signal/timeout, and writes both:
 *   - factory/inventories/verification-results.json  (combined evidence)
 *   - .factory/evidence/ACT-CLINEMM-FORK-BASELINE01/{commands,evidence.json,hashes.sha256}
 *
 * CORRECTION11 — runner drift attestation:
 *
 *   The runner now records THREE additional attestations on
 *   evidence.json:
 *
 *     subject_tree_oid_before / subject_tree_oid_after
 *                          — filtered subject tree captured before and
 *                            after the matrix. Required to be equal.
 *
 *     executionIdentityValid — verified by `git cat-file -e <head>^{commit}`
 *                              and `git rev-parse <head>^{tree}`,
 *                              which must equal `execution_tree_oid`.
 *
 *     worktree_inputs_clean_before / worktree_inputs_clean_after
 *                          — `git status --porcelain` sampled with the
 *                            runner's `expected_output_paths` excluded,
 *                            captured before and after the matrix.
 *
 *   Every command row carries:
 *     head_oid_before / head_oid_after
 *     tree_oid_before / tree_oid_after
 *     subject_tree_oid_before / subject_tree_oid_after
 *
 *   captured immediately around the command. Any deviation aborts the
 * run with `REPOSITORY_DRIFT` rather than producing a misleading
 * bundle. The captured values are also pinned to the bundle's
 * top-level execution identity.
 *
 *   Preflight: the runner aborts before any command runs if
 *   `worktree_inputs_clean_before` is `false`. This closes the
 *   CORRECTION10 R1 defect.
 *
 *   Path-aware cleanliness (CORRECTION10 R2 closure): only paths NOT
 *   in `expected_output_paths` are considered when sampling cleanliness,
 *   so intentionally regenerated tracked outputs do not make the
 *   post-run check unsatisfiable.
 *
 *   Evidence-directory-relative paths (CORRECTION10 R6 closure): every
 *   payload path recorded on a command row or in the manifest is
 *   relative to `EVIDENCE_DIR`, not to the repository root. The
 *   manifest declares `evidence.json`, every `commands/<id>.stdout`,
 *   `commands/<id>.stderr`, and `commands/<id>.metadata.json`, so a
 *   reviewer can hash-verify the entire payload surface.
 *
 * The runner accepts commands as **structured argv** to avoid shell-quoting
 * bugs. A command can also carry `shell_command` (string) and `use_shell:
 * true` to run through `/bin/sh -c` when necessary; in that mode the
 * timeout handler kills the entire process group.
 *
 * Every failure is explicitly classified. Missing classification is
 * `UNKNOWN`, which blocks ACT closure.
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
const EVIDENCE_DIR = join(ROOT, DETACHED_DIR);

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

const OID_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Verify that the execution head/tree pair forms a valid Git object
 * pair: the head dereferences to a commit, the tree is a tree object,
 * and `git rev-parse <head>^{tree}` equals the supplied tree. Returns
 * `false` for any malformed input or git-level failure.
 */
function verifyExecutionIdentityShape(head: string, tree: string): boolean {
	if (!OID_PATTERN.test(head) || !OID_PATTERN.test(tree)) return false;
	const r1 = spawnSync("git", ["cat-file", "-e", `${head}^{commit}`], {
		encoding: "utf8",
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r1.status !== 0) return false;
	const r2 = spawnSync("git", ["cat-file", "-e", `${tree}^{tree}`], {
		encoding: "utf8",
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r2.status !== 0) return false;
	const derived = spawnSync("git", ["rev-parse", `${head}^{tree}`], {
		encoding: "utf8",
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
	}).stdout.trim();
	return derived === tree;
}

/**
 * Paths the runner intentionally regenerates. Cleanliness checks
 * ignore these paths so the post-run state can be `true` even
 * though the runner wrote new files. Everything else must be
 * unchanged for the run to be considered drift-free.
 */
const EXPECTED_OUTPUT_PATHS: ReadonlyArray<string> = [
	`${DETACHED_DIR}/`,
	`${DETACHED_DIR}/commands/`,
	RESULTS_JSON,
	"factory/inventories/environment.json",
	"factory/inventories/repository.json",
	"factory/inventories/workspaces.json",
	"factory/inventories/native-probes.json",
	"factory/inventories/network-listener-candidates.csv",
	"factory/inventories/privileged-sink-candidates.csv",
	"factory/baselines/file-size-summary.json",
	"factory/baselines/file-size.csv",
	"factory/baselines/exact-duplicates.json",
];

function isExpectedOutput(path: string): boolean {
	for (const p of EXPECTED_OUTPUT_PATHS) {
		if (path === p) return true;
		if (p.endsWith("/") && path.startsWith(p)) return true;
		if (path.startsWith(p + "/")) return true;
	}
	return false;
}

/**
 * CORRECTION11: path-aware cleanliness. Returns `true` iff every
 * non-ignored change in the worktree is inside `EXPECTED_OUTPUT_PATHS`.
 * Uses `git -c status.showUntrackedFiles=all status --porcelain=v1
 * --untracked-files=all --ignored=traditional` so the check is
 * independent of the user's `status.showUntrackedFiles` config and
 * excludes gitignored files (such as `node_modules`).
 */
function worktreeInputsClean(): { clean: boolean; unexpected: string[] } {
	const r = spawnSync(
		"git",
		[
			"-c", "status.showUntrackedFiles=all",
			"status", "--porcelain=v1", "--untracked-files=all", "--ignored=traditional",
		],
		{ encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
	);
	if (r.status !== 0) return { clean: false, unexpected: [r.stderr || "git status failed"] };
	const unexpected: string[] = [];
	for (const line of r.stdout.split("\n")) {
		if (line.length === 0) continue;
		// Porcelain v1 format: XY <path> [-> <path2>]
		const head = line.slice(3);
		const path = head.split(" -> ").pop() ?? head;
		const unquoted = path.replace(/^"(.*)"$/, "$1");
		if (!isExpectedOutput(unquoted)) unexpected.push(unquoted);
	}
	return { clean: unexpected.length === 0, unexpected };
}

function captureExecutionIdentity(): { head: string; tree: string; subject: string } {
	const { head, tree } = headTreeNow();
	const subject = computeFilteredSubjectTreeOid(ROOT);
	if (!subject) {
		throw new Error("SUBJECT_TREE_COMPUTATION_FAILED: filtered tree could not be computed at run start");
	}
	return { head, tree, subject };
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
	metadata_path?: string;
	head_oid: string;
	tree_oid: string;
	head_oid_before: string;
	head_oid_after: string;
	tree_oid_before: string;
	tree_oid_after: string;
	subject_tree_oid_before: string;
	subject_tree_oid_after: string;
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
	if (Array.isArray(c.argv) && c.argv.length > 0) {
		return { argv: c.argv.map((s: unknown) => String(s)), useShell: false };
	}
	if (typeof c.shell_command === "string" && c.shell_command.length > 0) {
		return { argv: ["/bin/sh", "-c", c.shell_command], useShell: true };
	}
	if (typeof c.command === "string" && c.command.length > 0) {
		const parts = c.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
		return { argv: parts, useShell: false };
	}
	throw new Error(`command ${c.id} has no executable form (argv/shell_command/command)`);
}

// ---------- command execution ------------------------------------------------

async function executeCommand(
	cmd: any,
	identityBefore: { head: string; tree: string; subject: string },
): Promise<ExecResult> {
	const detachedCmdDir = join(ROOT, DETACHED_DIR, "commands");
	mkdirSync(detachedCmdDir, { recursive: true });
	// CORRECTION11 R6 closure: paths are recorded relative to the
	// evidence directory, not to the repository root. The renderer
	// already treats declared manifest paths as evidence-dir-relative.
	const stdoutRel = join("commands", `${cmd.id}.stdout`);
	const stderrRel = join("commands", `${cmd.id}.stderr`);
	const metaRel = join("commands", `${cmd.id}.metadata.json`);
	const stdoutAbs = join(EVIDENCE_DIR, stdoutRel);
	const stderrAbs = join(EVIDENCE_DIR, stderrRel);
	const metaAbs = join(EVIDENCE_DIR, metaRel);
	const stdoutStream = createWriteStream(stdoutAbs);
	const stderrStream = createWriteStream(stderrAbs);

	// CORRECTION11 R4 closure: capture execution state immediately
	// before the command runs.
	const stateBeforeNow = captureExecutionIdentity();
	if (
		stateBeforeNow.head !== identityBefore.head ||
		stateBeforeNow.tree !== identityBefore.tree ||
		stateBeforeNow.subject !== identityBefore.subject
	) {
		stdoutStream.end();
		stderrStream.end();
		throw new Error(
			`REPOSITORY_DRIFT_BEFORE_COMMAND: ${cmd.id} — head/tree/subject changed before command started`,
		);
	}

	const startedAt = new Date();
	const startIso = startedAt.toISOString();

	let resolved: Resolved;
	try {
		resolved = resolveArgv(cmd);
	} catch (err: any) {
		stdoutStream.end();
		stderrStream.end();
		return buildFailure(cmd, startedAt, "UNKNOWN", err.message, { stdoutRel, stderrRel, metaRel }, "");
	}

	const workingDir = cmd.working_directory === "." ? ROOT : join(ROOT, cmd.working_directory);

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
				stdout_path: stdoutRel,
				stderr_path: stderrRel,
				metadata_path: metaRel,
				head_oid: identityBefore.head,
				tree_oid: identityBefore.tree,
				head_oid_before: stateBeforeNow.head,
				head_oid_after: identityBefore.head, // sentinel; overwritten below
				tree_oid_before: stateBeforeNow.tree,
				tree_oid_after: identityBefore.tree, // sentinel; overwritten below
				subject_tree_oid_before: stateBeforeNow.subject,
				subject_tree_oid_after: identityBefore.subject, // sentinel; overwritten below
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
				stdout_path: stdoutRel,
				stderr_path: stderrRel,
				metadata_path: metaRel,
				head_oid: identityBefore.head,
				tree_oid: identityBefore.tree,
				head_oid_before: stateBeforeNow.head,
				head_oid_after: identityBefore.head,
				tree_oid_before: stateBeforeNow.tree,
				tree_oid_after: identityBefore.tree,
				subject_tree_oid_before: stateBeforeNow.subject,
				subject_tree_oid_after: identityBefore.subject,
				environment_sha256: envHash,
				failure_classification: "UNKNOWN",
				notes: `spawn error: ${err.message}`,
			});
		});
	});

	// CORRECTION11 R4 closure: capture execution state immediately
	// after the command finishes.
	const stateAfterNow = captureExecutionIdentity();
	if (
		stateAfterNow.head !== identityBefore.head ||
		stateAfterNow.tree !== identityBefore.tree ||
		stateAfterNow.subject !== identityBefore.subject
	) {
		writeFileSync(metaAbs, JSON.stringify(finalStatus, null, "\t") + "\n", "utf8");
		throw new Error(
			`REPOSITORY_DRIFT_AFTER_COMMAND: ${cmd.id} — head/tree/subject changed after command finished`,
		);
	}

	finalStatus.head_oid_before = stateBeforeNow.head;
	finalStatus.head_oid_after = stateAfterNow.head;
	finalStatus.tree_oid_before = stateBeforeNow.tree;
	finalStatus.tree_oid_after = stateAfterNow.tree;
	finalStatus.subject_tree_oid_before = stateBeforeNow.subject;
	finalStatus.subject_tree_oid_after = stateAfterNow.subject;

	writeFileSync(metaAbs, JSON.stringify(finalStatus, null, "\t") + "\n", "utf8");
	return finalStatus;
}

function buildFailure(
	cmd: any,
	startedAt: Date,
	classification: FailureClass,
	notes: string,
	paths: { stdoutRel: string; stderrRel: string; metaRel: string },
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
		stdout_path: paths.stdoutRel,
		stderr_path: paths.stderrRel,
		metadata_path: paths.metaRel,
		head_oid: head,
		tree_oid: tree,
		head_oid_before: head,
		head_oid_after: head,
		tree_oid_before: tree,
		tree_oid_after: tree,
		subject_tree_oid_before: "",
		subject_tree_oid_after: "",
		environment_sha256: envSha(),
		failure_classification: classification,
		notes,
	};
}

function classifyFailure(cmd: any, code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string): FailureClass {
	const text = (stdout + "\n" + stderr).toLowerCase();
	if (/no matching workspace|cannot find module|@cline\/\S+ not found|workspace not found/i.test(text)) {
		return "ENVIRONMENTAL";
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

	// CORRECTION11 R1 closure: capture execution identity BEFORE
	// any command runs.
	const identityBefore = captureExecutionIdentity();
	if (!verifyExecutionIdentityShape(identityBefore.head, identityBefore.tree)) {
		throw new Error("EXECUTION_IDENTITY_INVALID: head/tree do not form a valid Git object pair");
	}

	// CORRECTION11 preflight: subject inputs must be clean.
	const preflight = worktreeInputsClean();
	if (!preflight.clean) {
		throw new Error(
			`WORKTREE_INPUTS_DIRTY_BEFORE: ${preflight.unexpected.join(", ")}`,
		);
	}

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
		console.log(`[runner:${opts.label}] (${attemptCount}) ${c.id} :: ${c.command ?? c.shell_command ?? c.argv?.join(" ")}`);
		const result = await executeCommand(c, identityBefore);
		executed.push(result);
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
	console.log(`Wrote ${RESULTS_JSON} executed=${executed.length} skipped=${skipped.length}`);

	// CORRECTION11 R1 closure: re-capture cleanliness after the matrix
	// (postflight). Path-aware: expected outputs are excluded.
	const postflight = worktreeInputsClean();
	const identityAfter = captureExecutionIdentity();
	const identityStillValid = verifyExecutionIdentityShape(
		identityAfter.head,
		identityAfter.tree,
	);

	if (!postflight.clean) {
		throw new Error(
			`WORKTREE_INPUTS_DIRTY_AFTER: ${postflight.unexpected.join(", ")}`,
		);
	}
	if (!identityStillValid) {
		throw new Error("EXECUTION_IDENTITY_INVALID: head/tree no longer form a valid pair");
	}
	if (identityAfter.head !== identityBefore.head || identityAfter.tree !== identityBefore.tree) {
		throw new Error(
			`REPOSITORY_DRIFT_END_OF_MATRIX: head=${identityAfter.head} tree=${identityAfter.tree}`,
		);
	}
	if (identityAfter.subject !== identityBefore.subject) {
		throw new Error(
			`SUBJECT_DRIFT_END_OF_MATRIX: subject=${identityAfter.subject}`,
		);
	}

	await writeDetachedBundle(commands, opts.label, identityBefore, postflight);
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
		head_oid_before: head,
		head_oid_after: head,
		tree_oid_before: tree,
		tree_oid_after: tree,
		subject_tree_oid_before: "",
		subject_tree_oid_after: "",
		environment_sha256: envSha(),
		failure_classification: null,
		notes,
	};
}

async function writeDetachedBundle(
	commands: any[],
	label: string,
	identityBefore: { head: string; tree: string; subject: string },
	postflight: { clean: boolean; unexpected: string[] },
): Promise<void> {
	const resultsPath = join(ROOT, RESULTS_JSON);
	if (!existsSync(resultsPath)) return;
	const results = JSON.parse(readFileSync(resultsPath, "utf8"));
	const executed: any[] = results.executed_commands ?? [];
	const host = hostClass();

	const detachedDir = join(ROOT, DETACHED_DIR);
	mkdirSync(detachedDir, { recursive: true });

	const executionIdentityValid = verifyExecutionIdentityShape(
		identityBefore.head,
		identityBefore.tree,
	);

	const evidence = {
		schema_version: 3,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		pass_label: label,
		// CORRECTION08/10: filtered subject tree.
		subject_tree_oid: identityBefore.subject,
		// CORRECTION11: subject tree captured both before and after the matrix.
		subject_tree_oid_before: identityBefore.subject,
		subject_tree_oid_after: identityBefore.subject,
		// CORRECTION10: separate execution identity triple.
		execution_head_oid: identityBefore.head,
		execution_tree_oid: identityBefore.tree,
		// CORRECTION11: tri-state cleanliness (true / false / null).
		// CORRECTION10 used `worktree_clean_before` / `worktree_clean_after`
		// (boolean only). We populate both forms: the CORRECTION11 names
		// (`worktree_inputs_clean_*`) and the CORRECTION10 names for
		// back-compat, so legacy renderers still see the boolean value.
		worktree_inputs_clean_before: true,
		worktree_inputs_clean_after: postflight.clean,
		worktree_clean_before: true,
		worktree_clean_after: postflight.clean,
		worktree_inputs_clean_after_unexpected: postflight.unexpected,
		// CORRECTION11: identity shape verified by `git cat-file -e` /
		// `git rev-parse <head>^{tree}` checks.
		execution_identity_valid: executionIdentityValid,
		// CORRECTION11: the runner declares every path it intentionally
		// regenerates; the renderer checks the manifest declares them all.
		expected_output_paths: EXPECTED_OUTPUT_PATHS as unknown as string[],
		// CORRECTION07: legacy literal-tree field, retained only for the
		// per-record equality check inside the runner. The renderer no
		// longer binds against this value.
		tree_oid: identityBefore.tree,
		head_oid: identityBefore.head,
		generated_at: new Date().toISOString(),
		host_arch: host,
		subject_tree_excludes: SUBJECT_TREE_EXCLUDES.map((e) => ({ kind: e.kind, path: e.path })),
		commands: executed,
		hashes: {} as Record<string, string>,
	};
	for (const e of executed) {
		if (e.stdout_path) {
			const abs = resolve(EVIDENCE_DIR, e.stdout_path);
			if (existsSync(abs)) {
				const buf = readFileSync(abs);
				evidence.hashes[`${e.id}.stdout`] = createHash("sha256").update(buf).digest("hex");
			}
		}
		if (e.stderr_path) {
			const abs = resolve(EVIDENCE_DIR, e.stderr_path);
			if (existsSync(abs)) {
				const buf = readFileSync(abs);
				evidence.hashes[`${e.id}.stderr`] = createHash("sha256").update(buf).digest("hex");
			}
		}
		if (e.stdout_sha256) evidence.hashes[`${e.id}.stdout_stream`] = e.stdout_sha256;
		if (e.stderr_sha256) evidence.hashes[`${e.id}.stderr_stream`] = e.stderr_sha256;
	}
	writeFileSync(join(detachedDir, "evidence.json"), JSON.stringify(evidence, null, "\t") + "\n", "utf8");

	// Manifest: every declared payload path is evidence-dir-relative.
	const lines: string[] = [];
	function add(rel: string): void {
		const abs = resolve(EVIDENCE_DIR, rel);
		if (!existsSync(abs)) return;
		const buf = readFileSync(abs);
		const sha = createHash("sha256").update(buf).digest("hex");
		lines.push(`${sha}  ${rel}`);
	}
	add("evidence.json");
	for (const e of executed) {
		if (e.stdout_path) add(e.stdout_path);
		if (e.stderr_path) add(e.stderr_path);
		if (e.metadata_path) add(e.metadata_path);
	}
	writeFileSync(join(detachedDir, "hashes.sha256"), lines.join("\n") + "\n", "utf8");

	console.log(`Wrote ${DETACHED_DIR}/evidence.json (subject=${identityBefore.subject.slice(0, 12)}…, exec=${identityBefore.tree.slice(0, 12)}…)`);
	console.log(`Wrote ${DETACHED_DIR}/hashes.sha256 (${lines.length} entries)`);
	console.log(`worktree_inputs_clean: before=true after=${postflight.clean}`);
	console.log(`execution_identity_valid: ${executionIdentityValid}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
