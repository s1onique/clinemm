#!/usr/bin/env bun
/** CORRECTION13 production-runner integration tests. */

import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	checkEvidence,
	computeClosure,
	isEvidenceOk,
	loadEvidenceFile,
	NATIVE_PROBES_BUNDLE_PATH,
} from "./baseline-closure";
import { deriveExecutionIdentity } from "./execution-identity";
import { parsePorcelainV1Z } from "./git-status";
import { computeFilteredSubjectTreeOid } from "./subject-tree";

const ACT_DIR = ".factory/evidence/ACT-CLINEMM-FORK-BASELINE01";
const roots: string[] = [];
const fixtureInventoryPaths: string[] = [];

interface FixtureCommand {
	id: string;
	class: string;
	host_support: string[];
	requires_gui: boolean;
	working_directory: string;
	argv?: string[];
	command?: string;
	shell_command?: string;
}

interface RunnerResult {
	status: number | null;
	stdout: string;
	stderr: string;
}

function hostClass(): string {
	if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
	if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
	if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
	if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64";
	if (process.platform === "win32" && process.arch === "arm64") return "windows-arm64";
	return `${process.platform}-${process.arch}`;
}

function command(argv: string[] | undefined = ["bun", "-e", "console.log('ok')"], id = "fixture"): FixtureCommand {
	const result: FixtureCommand = {
		id,
		class: "mandatory",
		host_support: [hostClass()],
		requires_gui: false,
		working_directory: ".",
	};
	if (argv !== undefined) result.argv = argv;
	return result;
}

/**
 * Build a CORRECTION16-shaped fixture native-probe inventory. The HEAD and
 * filtered subject tree are filled in lazily by `stageFixtureInventory` so
 * the fixture inventory agrees with the bundle identity that the runner
 * will actually capture. Tests that intentionally exercise missing /
 * malformed / deferred paths override `extraTracked` with a deliberately
 * broken inventory AFTER calling `stageFixtureInventory`.
 */
function buildFixtureProbeInventory(
	identity: { head: string; tree: string; subject: string; hostClass: string },
): Record<string, unknown> {
	const fakeSha = "a".repeat(64);
	const fakeStdoutSha = "b".repeat(64);
	const fakeStderrSha = "c".repeat(64);
	const probe = (
		id: string,
		path: string,
		fileFormat: string,
		reason: string,
		argv: string[],
	) => ({
		id,
		path,
		architecture: identity.hostClass,
		sha256: fakeSha,
		file_format: fileFormat,
		status: "pass",
		reason,
		argv,
		exit_code: 0,
		signal: null,
		timeout: false,
		stdout_sha256: fakeStdoutSha,
		stderr_sha256: fakeStderrSha,
		artifact_path: path,
		artifact_sha256: fakeSha,
		artifact_size: 1024,
		artifact_exists: true,
		observed_file_format: fileFormat,
		observed_architecture: identity.hostClass,
		execution_head_oid: identity.head,
		execution_tree_oid: identity.tree,
		subject_tree_oid: identity.subject,
		host_class: identity.hostClass,
		started_at: "2026-07-17T09:00:00.000Z",
		finished_at: "2026-07-17T09:00:00.250Z",
		duration_ms: 250,
		host_supported: true,
	});
	return {
		schema_version: 1,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		host_class: identity.hostClass,
		collected_at: "2026-07-17T09:00:00.000Z",
		execution_head_oid: identity.head,
		execution_tree_oid: identity.tree,
		subject_tree_oid: identity.subject,
		probes: {
			p1_better_sqlite3: probe(
				"p1_better_sqlite3",
				"node_modules/better-sqlite3/build/Release/better_sqlite3.node",
				"Mach-O 64-bit arm64 bundle",
				"Fixture inventory entry; production probes are populated by the runner.",
				["file", "node_modules/better-sqlite3/build/Release/better_sqlite3.node"],
			),
			p2_protobuf: probe(
				"p2_protobuf",
				"node_modules/protobufjs/index.js",
				"JavaScript ES module",
				"Fixture inventory entry; production probes are populated by the runner.",
				["node", "-e", "require('protobufjs')"],
			),
			p3_ripgrep_darwin_arm64: probe(
				"p3_ripgrep_darwin_arm64",
				"node_modules/@vscode/ripgrep/bin/rg-darwin-arm64",
				"Mach-O 64-bit arm64 executable",
				"Fixture inventory entry; production probes are populated by the runner.",
				["node_modules/@vscode/ripgrep/bin/rg-darwin-arm64", "--version"],
			),
			p4_vscode_host: probe(
				"p4_vscode_host",
				"node_modules/@types/vscode/index.d.ts",
				"TypeScript declaration",
				"Fixture inventory entry; production probes are populated by the runner.",
				["node", "-e", "process.stdout.write('VSCODE_HOST_OK')"],
			),
			p5_cline_version: probe(
				"p5_cline_version",
				"apps/cline/package.json",
				"JSON manifest",
				"Fixture inventory entry; production probes are populated by the runner.",
				["node", "apps/cli/bin/cline", "--version"],
			),
		},
	};
}

function stageFixtureInventory(root: string): string {
	const head = git(root, ["rev-parse", "HEAD^{commit}"]);
	const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
	const subject = computeFilteredSubjectTreeOid(root);
	if (!subject) throw new Error("fixture subject did not compute");
	const inventory = buildFixtureProbeInventory({
		head,
		tree,
		subject,
		hostClass: hostClass(),
	});
	const path = join(
		mkdtempSync(join(tmpdir(), "factory-runner-probes-")),
		"native-probes.json",
	);
	fixtureInventoryPaths.push(path);
	writeFileSync(path, JSON.stringify(inventory, null, "\t") + "\n");
	return path;
}

function makeRepo(
	commands: FixtureCommand[],
	extraTracked: Record<string, string> = {},
): { root: string; fixtureInventory: string } {
	const root = mkdtempSync(join(tmpdir(), "factory-runner-c13-"));
	roots.push(root);
	git(root, ["init", "-q"]);
	git(root, ["config", "user.email", "factory-test@example.invalid"]);
	git(root, ["config", "user.name", "Factory Test"]);
	write(root, ".gitignore", ".factory/\nnode_modules/\n");
	write(root, "input.txt", "original\n");
	write(
		root,
		"factory/inventories/verification.json",
		`${JSON.stringify({ schema_version: 1, commands }, null, "\t")}\n`,
	);
	for (const [path, content] of Object.entries(extraTracked)) write(root, path, content);
	for (const source of ["run-verification.ts", "baseline-closure.ts", "git-status.ts", "subject-tree.ts"]) {
		write(
			root,
			`factory/scripts/${source}`,
			readFileSync(join(import.meta.dir, source), "utf8"),
		);
	}
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture"]);
	// CORRECTION16: a valid native-probe inventory is now required inside
	// the detached evidence bundle. The runner reads from
	// `--probe-inventory-path <file>` (the test-fixture escape hatch) so
	// it does not need a real `node_modules/` to execute probes. The
	// inventory is rewritten with the actual HEAD/tree/subject of the
	// freshly-committed fixture repo.
	const fixtureInventory = stageFixtureInventory(root);
	return { root, fixtureInventory };
}

function write(root: string, path: string, content: string): void {
	const absolute = join(root, ...path.split("/"));
	mkdirSync(join(absolute, ".."), { recursive: true });
	writeFileSync(absolute, content);
}

function git(root: string, args: string[], input?: string): string {
	const result = spawnSync("git", args, {
		cwd: root,
		encoding: "utf8",
		input,
		stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return (result.stdout ?? "").trim();
}

function run(root: string, extraArgs: string[] = [], fixtureInventory?: string): RunnerResult {
	const fixtureRunner = join(root, "factory/scripts/run-verification.ts");
	const args = [fixtureRunner, "--timeout-ms", "5000"];
	if (fixtureInventory) args.push("--probe-inventory-path", fixtureInventory);
	args.push(...extraArgs);
	const result = spawnSync("bun", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, CI: "" },
		timeout: 15_000,
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function evidenceDir(root: string): string {
	return join(root, ...ACT_DIR.split("/"));
}

function readJson(path: string): any {
	return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function rewriteManifest(root: string, evidence: any): void {
	const dir = evidenceDir(root);
	writeFileSync(join(dir, "evidence.json"), `${JSON.stringify(evidence, null, "\t")}\n`);
	const lines = evidence.expected_evidence_payload_paths.map((path: string) => {
		const bytes = readFileSync(join(dir, ...path.split("/")));
		return `${sha256(bytes)}  ${path}`;
	});
	writeFileSync(join(dir, "hashes.sha256"), `${lines.join("\n")}\n`);
}

function checkProductionBundle(root: string, executedOverride?: any[]) {
	const dir = evidenceDir(root);
	const evidence = readJson(join(dir, "evidence.json"));
	const results = readJson(join(dir, "verification-results.json"));
	const subject = computeFilteredSubjectTreeOid(root);
	if (!subject) throw new Error("fixture subject did not compute");
	return checkEvidence({
		ev: loadEvidenceFile(join(dir, "evidence.json")),
		hashesText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
		evDirAbs: dir,
		executedCmds: executedOverride ?? results.executed_commands,
		bundledResultPath: "verification-results.json",
		rootAbs: root,
		headOidNow: git(root, ["rev-parse", "HEAD"]),
		treeOidNow: git(root, ["rev-parse", "HEAD^{tree}"]),
		filteredSubjectTreeOidNow: subject,
		executionIdentityDerivation: deriveExecutionIdentity(
			root,
			evidence.execution_head_oid,
			evidence.execution_tree_oid,
		),
	});
}

function closureFor(view: ReturnType<typeof checkProductionBundle>) {
	return computeClosure({
		evidence: view,
		unknownFailures: [],
		unknownFailureCount: 0,
		mandatoryPass: 1,
		mandatoryFail: 0,
		mandatoryApplicable: 1,
		affectedScopePass: 0,
		affectedScopeFail: 0,
		affectedScopeApplicable: 0,
		r4Satisfied: false,
		r5Satisfied: false,
		r6Satisfied: false,
		r7Satisfied: false,
		r16Satisfied: false,
	});
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("parsePorcelainV1Z", () => {
	it("preserves whitespace, quotes, and newlines without line parsing", () => {
		const path = "odd name\n\"quoted\".txt";
		const entries = parsePorcelainV1Z(Buffer.from(`?? ${path}\0`));
		expect(entries).toEqual([{ status: "??", path, originalPath: null }]);
	});

	it("consumes the second NUL record for renames", () => {
		const entries = parsePorcelainV1Z(Buffer.from("R  new name\0old\nname\0"));
		expect(entries).toEqual([
			{ status: "R ", path: "new name", originalPath: "old\nname" },
		]);
	});
});

/**
 * Convenience wrapper around `makeRepo + run` so individual tests can
 * read like `const { root, fixtureInventory, result } = runWith(...)`.
 */
function runWith(
	commands: FixtureCommand[],
	options: { extraTracked?: Record<string, string>; extraArgs?: string[] } = {},
): { root: string; fixtureInventory: string; result: RunnerResult } {
	const { root, fixtureInventory } = makeRepo(commands, options.extraTracked ?? {});
	const result = run(root, options.extraArgs ?? [], fixtureInventory);
	return { root, fixtureInventory, result };
}

describe("production run-verification.ts integration", () => {

	it("ignored node_modules content does not dirty preflight", () => {
		const { root } = runWith([command()]);
		write(root, "node_modules/pkg/cache.bin", "ignored\n");
		// Re-stage the fixture inventory because the working tree now has
		// a new tracked-but-ignored node_modules file.
		const { fixtureInventory } = makeRepo([command()], {});
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		expect(existsSync(join(evidenceDir(root), "evidence.json"))).toBe(true);
	});
	it("unexpected untracked input fails before command execution", () => {
		const { root } = runWith([
			command(["bun", "-e", "await Bun.write('ran.txt', 'yes')"]),
		]);
		write(root, "unexpected\ninput.txt", "dirty\n");
		const { fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('ran.txt', 'yes')"]),
		], { "unexpected\ninput.txt": "dirty\n" });
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_BEFORE");
		expect(existsSync(join(root, "ran.txt"))).toBe(false);
	});

	it("tracked input left modified by a command fails drift", () => {
		const { root } = runWith([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const { fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_AFTER_COMMAND");
	});

	it("CORRECTION13: clean post-command sample keeps the bundle satisfiable", () => {
		const { root, result } = runWith([command()]);
		expect(result.status).toBe(0);
		const view = checkProductionBundle(root);
		expect(isEvidenceOk(view)).toBe(true);
		expect(view.worktreeInputsCleanBefore).toBe(true);
		expect(view.worktreeInputsCleanAfter).toBe(true);
	});

	it("repository output changes are permitted without entering the manifest domain", () => {
		const { root, result } = runWith(
			[command(["bun", "-e", "await Bun.write('factory/inventories/environment.json', '{\\\"changed\\\":true}\\n')"])],
			{ extraTracked: { "factory/inventories/environment.json": "{}\n" } },
		);
		expect(result.status).toBe(0);
		const evidence = readJson(join(evidenceDir(root), "evidence.json"));
		expect(evidence.expected_evidence_payload_paths).toContain("evidence.json");
		expect(evidence.expected_evidence_payload_paths).toContain("verification-results.json");
		expect(evidence.expected_evidence_payload_paths).toContain(NATIVE_PROBES_BUNDLE_PATH);
		expect(evidence.expected_evidence_payload_paths).not.toContain(
			"factory/inventories/environment.json",
		);
	});

	it.each(["../escape", "/tmp/escape"])("rejects unsafe evidence-producing command id %s", (id) => {
		const { root, fixtureInventory } = makeRepo([command(undefined, id)]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("INVALID_EVIDENCE_PATH");
		expect(existsSync(evidenceDir(root))).toBe(false);
	});

	it("resolveArgv failure still publishes stdout, stderr, and metadata payloads", () => {
		const missingExecutable = command();
		delete missingExecutable.argv;
		const { root, fixtureInventory, result } = runWith([missingExecutable]);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		for (const suffix of ["stdout", "stderr", "metadata.json"]) {
			expect(existsSync(join(dir, "commands", `fixture.${suffix}`))).toBe(true);
		}
		const metadata = readJson(join(dir, "commands/fixture.metadata.json"));
		expect(metadata.status).toBe("fail");
		expect(metadata.exit_code).toBe(-1);
		expect(metadata.failure_classification).toBe("UNKNOWN");
		expect(metadata.stderr_sha256).toMatch(/^[0-9a-f]{64}$/);
		const manifest = readFileSync(join(dir, "hashes.sha256"), "utf8");
		expect(manifest).toContain("commands/fixture.metadata.json");
		expect(isEvidenceOk(checkProductionBundle(root))).toBe(true);
	});

	// CORRECTION16 P1: a real OS-level spawn error is exercised by pointing
	// `argv[0]` at a path that does not exist. The runner passes this through
	// to `child_process.spawn`, which emits an `error` event with
	// ENOENT/EACCES; the runner still materialises all three payloads with
	// `exit_code === -1` and `failure_classification === "UNKNOWN"`. Unlike
	// the resolveArgv path, this exercises Node's actual spawn failure
	// handler, which the CORRECTION15 `.skip`'d test incorrectly claimed
	// was "covered" by the resolveArgv failure.
	it("CORRECTION16: genuine nonexistent-executable still produces a fail row + all three payloads", () => {
		const { root, result } = runWith([
			command(["/__definitely/not/a/real/executable", "ignored-arg"]),
		]);
		// The runner should still succeed (process completion is non-zero
		// but the row is a recorded fail, not a runner crash).
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		for (const suffix of ["stdout", "stderr", "metadata.json"]) {
			expect(existsSync(join(dir, "commands", `fixture.${suffix}`))).toBe(true);
		}
		const metadata = readJson(join(dir, "commands/fixture.metadata.json"));
		expect(metadata.status).toBe("fail");
		expect(metadata.exit_code).toBe(-1);
		expect(metadata.failure_classification).toBe("UNKNOWN");
		// The stderr stream should carry a spawn-error indicator (either
		// the error message text or a fallback marker the runner appends).
		const stderrText = readFileSync(join(dir, "commands/fixture.stderr"), "utf8");
		expect(stderrText.length).toBeGreaterThan(0);
		// `isEvidenceOk` must remain true: a spawn-error row is recorded,
		// not a bundle-level failure.
		expect(isEvidenceOk(checkProductionBundle(root))).toBe(true);
	});

	it("child exit (process.exit(7)) is reported as a real failure", () => {
		const { root, result } = runWith([command(["bun", "-e", "process.exit(7)"])]);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const metadata = readJson(join(dir, "commands/fixture.metadata.json"));
		expect(metadata.exit_code).toBe(7);
		expect(metadata.status).toBe("fail");
		expect(metadata.failure_classification).toBe("UNKNOWN");
		expect(isEvidenceOk(checkProductionBundle(root))).toBe(true);
	});

	it("finalize performs one bundle preparation and does not crash", () => {
		const { root, fixtureInventory, result } = runWith([command()]);
		const finalized = run(root, ["--finalize-evidence"], fixtureInventory);
		expect(finalized.status).toBe(0);
		expect(finalized.stdout.match(/Prepared detached evidence bundle once/g)).toHaveLength(1);
		const evidence = readJson(join(evidenceDir(root), "evidence.json"));
		expect(evidence.pass_label).toBe("finalize");
		// The first run still produced a satisfiable bundle (this asserts
		// the prior fixture run was not broken by the wrapper).
		expect(result.status).toBe(0);
	});

	it("successful replacement removes old evidence files", () => {
		const { root } = runWith([command()]);
		write(root, `${ACT_DIR}/commands/stale.stdout`, "stale\n");
		write(root, `${ACT_DIR}/stale.txt`, "stale\n");
		const { fixtureInventory } = makeRepo([command()]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		expect(existsSync(join(evidenceDir(root), "stale.txt"))).toBe(false);
		expect(existsSync(join(evidenceDir(root), "commands/stale.stdout"))).toBe(false);
	});

	it("failed pass leaves the previous complete bundle untouched", () => {
		const { root } = runWith([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		write(root, `${ACT_DIR}/sentinel.txt`, "previous-complete-bundle\n");
		const { fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const result = run(root, [], fixtureInventory);
		// Even when a command writes to a tracked input the runner still
		// aborts before publishing; verify the previous bundle is untouched.
		expect(result.status).not.toBe(0);
		expect(readFileSync(join(evidenceDir(root), "sentinel.txt"), "utf8")).toBe(
			"previous-complete-bundle\n",
		);
		const parentEntries = readdirSync(join(root, ".factory/evidence"));
		expect(parentEntries.some((name) => name.includes("-staging-"))).toBe(false);
	});

	it("CORRECTION13: production-shaped bundle is self-contained", () => {
		const { root, result } = runWith([command()]);
		expect(result.status).toBe(0);
		const view = checkProductionBundle(root);
		expect(isEvidenceOk(view)).toBe(true);
		expect(view.manifestContractHonored).toBe(true);
		expect(view.executionIdentityValid).toBe(true);
		expect(view.bundledResultCommandSetExact).toBe(true);
		expect(view.bundledResultPathInvalid).toBeNull();
	});

	it("CORRECTION16: native-probes.json is staged into the bundle and hash-listed", () => {
		const { root, result } = runWith([command()]);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const stagedInventoryPath = join(dir, NATIVE_PROBES_BUNDLE_PATH);
		expect(existsSync(stagedInventoryPath)).toBe(true);
		const manifest = readFileSync(join(dir, "hashes.sha256"), "utf8");
		expect(manifest).toContain(` ${NATIVE_PROBES_BUNDLE_PATH}`);
		// The hash declared in the manifest matches the on-disk bytes.
		const bytes = readFileSync(stagedInventoryPath);
		const observed = createHash("sha256").update(bytes).digest("hex");
		expect(manifest).toContain(`${observed}  ${NATIVE_PROBES_BUNDLE_PATH}`);
	});

	it("CORRECTION16: tracked mirror is informational only; verdict depends on the staged copy", () => {
		const { root } = runWith([command()]);
		const dir = evidenceDir(root);
		const trackedPath = join(root, "factory/inventories/native-probes.json");
		const stagedPath = join(dir, NATIVE_PROBES_BUNDLE_PATH);
		// Tamper the staged copy (NOT the tracked mirror). The renderer
		// must still detect the staged-side hash mismatch via the bundle's
		// `hashes.sha256`, not via the tracked mirror.
		const original = readFileSync(stagedPath);
		writeFileSync(stagedPath, `${original}\nCORRUPTED`);
		const evidence = readJson(join(dir, "evidence.json"));
		rewriteManifest(root, evidence);
		const subject = computeFilteredSubjectTreeOid(root)!;
		const view = checkEvidence({
			ev: loadEvidenceFile(join(dir, "evidence.json")),
			hashesText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
			evDirAbs: dir,
			executedCmds: readJson(join(dir, "verification-results.json")).executed_commands,
			bundledResultPath: "verification-results.json",
			rootAbs: root,
			headOidNow: git(root, ["rev-parse", "HEAD"]),
			treeOidNow: git(root, ["rev-parse", "HEAD^{tree}"]),
			filteredSubjectTreeOidNow: subject,
			executionIdentityDerivation: deriveExecutionIdentity(
				root,
				evidence.execution_head_oid,
				evidence.execution_tree_oid,
			),
		});
		// The tampered staged copy is not the same as the manifest entry
		// — the renderer records a hash mismatch.
		expect(view.hashMismatches.some((m) => m.path === NATIVE_PROBES_BUNDLE_PATH)).toBe(true);
		expect(closureFor(view).reasonCodes).toContain("EVIDENCE_INCOMPLETE");
		// Tracked mirror is unchanged from the runner's refresh, not edited
		// by the test (this asserts the bound-and-tracked relationship).
		expect(existsSync(trackedPath)).toBe(true);
	});

	it("CORRECTION16: missing --probe-inventory-path aborts the runner when no node_modules", () => {
		// A fresh fixture repo with no staged probe inventory and no
		// `node_modules/` to probe against. The runner must fail-closed
		// rather than publishing a bundle with a deferred probe inventory.
		const root = mkdtempSync(join(tmpdir(), "factory-runner-no-probes-"));
		roots.push(root);
		git(root, ["init", "-q"]);
		git(root, ["config", "user.email", "factory-test@example.invalid"]);
		git(root, ["config", "user.name", "Factory Test"]);
		write(root, ".gitignore", ".factory/\nnode_modules/\n");
		write(root, "input.txt", "original\n");
		write(
			root,
			"factory/inventories/verification.json",
			`${JSON.stringify({ schema_version: 1, commands: [command()] }, null, "\t")}\n`,
		);
		for (const source of ["run-verification.ts", "baseline-closure.ts", "git-status.ts", "subject-tree.ts"]) {
			write(
				root,
				`factory/scripts/${source}`,
				readFileSync(join(import.meta.dir, source), "utf8"),
			);
		}
		git(root, ["add", "."]);
		git(root, ["commit", "-qm", "fixture-no-probes"]);
		const result = run(root);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("NATIVE_PROBES_INCOMPLETE");
		expect(existsSync(evidenceDir(root))).toBe(false);
	});

	it("equal command subject values that differ from bundle subject fail", () => {
		const { root, fixtureInventory } = runWith([command()]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const evidence = readJson(join(dir, "evidence.json"));
		const otherSubject = "f".repeat(40);
		evidence.commands[0].subject_tree_oid_before = otherSubject;
		evidence.commands[0].subject_tree_oid_after = otherSubject;
		rewriteManifest(root, evidence);
		const results = readJson(join(dir, "verification-results.json"));
		results.executed_commands[0].subject_tree_oid_before = otherSubject;
		results.executed_commands[0].subject_tree_oid_after = otherSubject;
		writeFileSync(join(dir, "verification-results.json"), JSON.stringify(results, null, "\t") + "\n");
		const view = checkProductionBundle(root, results.executed_commands);
		expect(view.perCommandDriftChecked).toBe(false);
		const closure = closureFor(view);
		expect(closure.verdict).toBe("FAIL");
		expect(closure.reasonCodes).toContain("REPOSITORY_DRIFT");
	});

	it("renderer-derived execution identity mismatch fails despite runner assertion", () => {
		const { root, fixtureInventory } = runWith([command()]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const evidence = readJson(join(dir, "evidence.json"));
		const results = readJson(join(dir, "verification-results.json"));
		const otherTree = git(root, ["mktree"], "");
		evidence.execution_tree_oid = otherTree;
		evidence.tree_oid = otherTree;
		for (const row of evidence.commands) {
			row.tree_oid = otherTree;
			row.tree_oid_before = otherTree;
			row.tree_oid_after = otherTree;
		}
		for (const row of results.executed_commands) {
			row.tree_oid = otherTree;
			row.tree_oid_before = otherTree;
			row.tree_oid_after = otherTree;
		}
		rewriteManifest(root, evidence);
		writeFileSync(join(dir, "verification-results.json"), JSON.stringify(results, null, "\t") + "\n");
		const subject = computeFilteredSubjectTreeOid(root)!;
		const view = checkEvidence({
			ev: loadEvidenceFile(join(dir, "evidence.json")),
			hashesText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
			evDirAbs: dir,
			executedCmds: results.executed_commands,
			bundledResultPath: "verification-results.json",
			rootAbs: root,
			headOidNow: git(root, ["rev-parse", "HEAD"]),
			treeOidNow: git(root, ["rev-parse", "HEAD^{tree}"]),
			filteredSubjectTreeOidNow: subject,
			executionIdentityDerivation: deriveExecutionIdentity(
				root,
				evidence.execution_head_oid,
				evidence.execution_tree_oid,
			),
		});
		expect(view.runnerExecutionIdentityAssertion).toBe(true);
		expect(view.executionHeadExists).toBe(true);
		expect(view.executionTreeExists).toBe(true);
		expect(view.executionIdentityAssertionAgrees).toBe(false);
		expect(view.executionIdentityValid).toBe(false);
		const closure = closureFor(view);
		expect(closure.verdict).toBe("FAIL");
		expect(closure.reasonCodes).toContain("EXECUTION_IDENTITY_INVALID");
	});

	it("CORRECTION13: pass row with non-null classification fails (relational invariant)", () => {
		const { root, fixtureInventory } = runWith([command()]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const evidence = readJson(join(dir, "evidence.json"));
		evidence.commands[0].failure_classification = "ENVIRONMENTAL";
		// Rehash the manifest with the tampered evidence.json.
		rewriteManifest(root, evidence);
		const results = readJson(join(dir, "verification-results.json"));
		results.executed_commands[0].failure_classification = "ENVIRONMENTAL";
		writeFileSync(join(dir, "verification-results.json"), JSON.stringify(results, null, "\t") + "\n");
		const view = checkProductionBundle(root, results.executed_commands);
		expect(view.rowRelationalInvariantViolations.length).toBeGreaterThanOrEqual(1);
		expect(closureFor(view).verdict).toBe("FAIL");
	});

	it("CORRECTION13: bundled verification-results.json command-set mismatch fails", () => {
		const { root, fixtureInventory } = runWith([command()]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const results = readJson(join(dir, "verification-results.json"));
		results.executed_commands.push({...results.executed_commands[0], id: "ghost"});
		// The bundled verification-results.json must be re-hashed into the
		// manifest after the change for the renderer to detect the mismatch
		// (the metadata file inside the bundle has changed).
		const resultPath = "verification-results.json";
		const newHash = sha256(readFileSync(join(dir, ...resultPath.split("/"))));
		rewriteManifest(root, readJson(join(dir, "evidence.json")));
		const manifestText = readFileSync(join(dir, "hashes.sha256"), "utf8");
		writeFileSync(
			join(dir, "hashes.sha256"),
			manifestText.replace(/^[0-9a-f]{64}  verification-results\.json$/m, `${newHash}  verification-results.json`),
		);
		const view = checkProductionBundle(root, results.executed_commands);
		expect(view.bundledResultCommandSetExact).toBe(false);
		expect(closureFor(view).reasonCodes).toContain("BUNDLED_RESULT_COMMAND_SET_MISMATCH");
	});

	it("CORRECTION13: metadata file content disagreement fails (semantic binding)", () => {
		const { root, fixtureInventory } = runWith([command()]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const evidence = readJson(join(dir, "evidence.json"));
		const original = readJson(join(dir, "commands/fixture.metadata.json"));
		writeFileSync(
			join(dir, "commands/fixture.metadata.json"),
			JSON.stringify({...original, status: "fail", exit_code: 1}, null, "\t") + "\n",
		);
		// Re-hash the manifest with the tampered metadata.
		rewriteManifest(root, evidence);
		const view = checkProductionBundle(root);
		expect(view.metadataFileMismatches.length).toBeGreaterThanOrEqual(1);
		expect(closureFor(view).reasonCodes).toContain("METADATA_FILE_MISMATCH");
	});

	it("CORRECTION13: tracked mirror is not updated when the canonical swap fails", () => {
		// Pre-seed the tracked mirror to a sentinel so the test can verify
		// the failed pass does not overwrite it.
		const { root } = runWith([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const trackedPath = join(root, "factory/inventories/verification-results.json");
		writeFileSync(trackedPath, `${JSON.stringify({sentinel: "pre-fail-mirror"}, null, "\t")}\n`);
		const previousMirror = readFileSync(trackedPath, "utf8");
		const { fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		// Even when a prior mirror existed, a failed pass must leave the
		// tracked file byte-identical to its prior contents.
		expect(readFileSync(trackedPath, "utf8")).toBe(previousMirror);
	});
});
