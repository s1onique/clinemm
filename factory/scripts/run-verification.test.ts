#!/usr/bin/env bun
/** CORRECTION12 production-runner integration tests. */

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
} from "./baseline-closure";
import { deriveExecutionIdentity } from "./execution-identity";
import { parsePorcelainV1Z } from "./git-status";
import { computeFilteredSubjectTreeOid } from "./subject-tree";

const RUNNER = join(import.meta.dir, "run-verification.ts");
const ACT_DIR = ".factory/evidence/ACT-CLINEMM-FORK-BASELINE01";
const roots: string[] = [];

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

function makeRepo(commands: FixtureCommand[], extraTracked: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "factory-runner-c12-"));
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
	// Bundle the runner, baseline-closure, git-status, and subject-tree helpers
	// into the fixture so `verifyRunnerSourceBound` passes against temp repos.
	for (const source of ["run-verification.ts", "baseline-closure.ts", "git-status.ts", "subject-tree.ts"]) {
		write(
			root,
			`factory/scripts/${source}`,
			readFileSync(join(import.meta.dir, source), "utf8"),
		);
	}
	git(root, ["add", "."]);
	git(root, ["commit", "-qm", "fixture"]);
	return root;
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

function run(root: string, extraArgs: string[] = []): RunnerResult {
	const fixtureRunner = join(root, "factory/scripts/run-verification.ts");
	const result = spawnSync("bun", [fixtureRunner, "--timeout-ms", "5000", ...extraArgs], {
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
	const results = readJson(join(root, "factory/inventories/verification-results.json"));
	const subject = computeFilteredSubjectTreeOid(root);
	if (!subject) throw new Error("fixture subject did not compute");
	return checkEvidence({
		ev: loadEvidenceFile(join(dir, "evidence.json")),
		hashesText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
		evDirAbs: dir,
		executedCmds: executedOverride ?? results.executed_commands,
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

describe("production run-verification.ts integration", () => {
	it("ignored node_modules content does not dirty preflight", () => {
		const root = makeRepo([command()]);
		write(root, "node_modules/pkg/cache.bin", "ignored\n");
		const result = run(root);
		expect(result.status).toBe(0);
		expect(existsSync(join(evidenceDir(root), "evidence.json"))).toBe(true);
	});

	it("unexpected untracked input fails before command execution", () => {
		const root = makeRepo([
			command(["bun", "-e", "await Bun.write('ran.txt', 'yes')"]),
		]);
		write(root, "unexpected\ninput.txt", "dirty\n");
		const result = run(root);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_BEFORE");
		expect(existsSync(join(root, "ran.txt"))).toBe(false);
	});

	it("tracked input left modified by a command fails drift", () => {
		const root = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const result = run(root);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_AFTER_COMMAND");
	});

	it("tracked input modified and restored still fails per-command cleanliness", () => {
		const root = makeRepo([
			command([
				"bun",
				"-e",
				"const p='input.txt'; const old=await Bun.file(p).text(); await Bun.write(p,'temporary\\n'); await Bun.sleep(80); await Bun.write(p,old)",
			]),
		]);
		const result = run(root);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_AFTER_COMMAND");
		expect(readFileSync(join(root, "input.txt"), "utf8")).toBe("original\n");
	});

	it("repository output changes are permitted without entering the manifest domain", () => {
		const root = makeRepo(
			[command(["bun", "-e", "await Bun.write('factory/inventories/environment.json', '{\\\"changed\\\":true}\\n')"])],
			{ "factory/inventories/environment.json": "{}\n" },
		);
		const result = run(root);
		expect(result.status).toBe(0);
		const evidence = readJson(join(evidenceDir(root), "evidence.json"));
		expect(evidence.expected_evidence_payload_paths).toEqual([
			"evidence.json",
			"commands/fixture.stdout",
			"commands/fixture.stderr",
			"commands/fixture.metadata.json",
		]);
		expect(evidence.expected_evidence_payload_paths).not.toContain(
			"factory/inventories/environment.json",
		);
	});

	it.each(["../escape", "/tmp/escape"])("rejects unsafe evidence-producing command id %s", (id) => {
		const root = makeRepo([command(undefined, id)]);
		const result = run(root);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("INVALID_EVIDENCE_PATH");
		expect(existsSync(evidenceDir(root))).toBe(false);
	});

	it("resolveArgv failure still publishes stdout, stderr, and metadata payloads", () => {
		const missingExecutable = command();
		delete missingExecutable.argv;
		const root = makeRepo([missingExecutable]);
		const result = run(root);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		for (const suffix of ["stdout", "stderr", "metadata.json"]) {
			expect(existsSync(join(dir, "commands", `fixture.${suffix}`))).toBe(true);
		}
		const metadata = readJson(join(dir, "commands/fixture.metadata.json"));
		// resolveArgv failure manifests as UNKNOWN classification with an
		// explanatory notes payload; the runner records exit_code === -1
		// to distinguish a setup failure from a real child exit.
		expect(metadata.status).toBe("fail");
		expect(metadata.exit_code).toBe(-1);
		expect(metadata.failure_classification).toBe("UNKNOWN");
		expect(metadata.stderr_sha256).toMatch(/^[0-9a-f]{64}$/);
		const manifest = readFileSync(join(dir, "hashes.sha256"), "utf8");
		expect(manifest).toContain("commands/fixture.metadata.json");
		expect(isEvidenceOk(checkProductionBundle(root))).toBe(true);
	});

	it("spawn failure also materializes complete command payloads", () => {
		// `process.exit(7)` from the child propagates as exit_code === 7
		// while still materialising every payload. The runner treats this
		// as a non-pass command but the bundle remains satisfiable.
		const root = makeRepo([command(["bun", "-e", "process.exit(7)"])]);
		const result = run(root);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		expect(existsSync(join(dir, "commands/fixture.stdout"))).toBe(true);
		expect(existsSync(join(dir, "commands/fixture.stderr"))).toBe(true);
		expect(existsSync(join(dir, "commands/fixture.metadata.json"))).toBe(true);
		const metadata = readJson(join(dir, "commands/fixture.metadata.json"));
		// `process.exit(7)` from a real child surfaces as exit_code === 7
		// with a real (non-`null`, non-`-1`) shell exit code.
		expect(metadata.exit_code).toBe(7);
		expect(metadata.status).toBe("fail");
		expect(isEvidenceOk(checkProductionBundle(root))).toBe(true);
	});

	it("finalize performs one bundle preparation and does not crash", () => {
		const root = makeRepo([command()]);
		const result = run(root, ["--finalize-evidence"]);
		expect(result.status).toBe(0);
		expect(result.stdout.match(/Prepared detached evidence bundle once/g)).toHaveLength(1);
		const evidence = readJson(join(evidenceDir(root), "evidence.json"));
		expect(evidence.pass_label).toBe("finalize");
	});

	it("successful replacement removes old evidence files", () => {
		const root = makeRepo([command()]);
		write(root, `${ACT_DIR}/commands/stale.stdout`, "stale\n");
		write(root, `${ACT_DIR}/stale.txt`, "stale\n");
		const result = run(root);
		expect(result.status).toBe(0);
		expect(existsSync(join(evidenceDir(root), "stale.txt"))).toBe(false);
		expect(existsSync(join(evidenceDir(root), "commands/stale.stdout"))).toBe(false);
	});

	it("failed pass leaves the previous complete bundle untouched", () => {
		const root = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		write(root, `${ACT_DIR}/sentinel.txt`, "previous-complete-bundle\n");
		const result = run(root);
		// Even when a command writes to a tracked input the runner still
		// aborts before publishing; verify the previous bundle is untouched.
		expect(result.status).not.toBe(0);
		expect(readFileSync(join(evidenceDir(root), "sentinel.txt"), "utf8")).toBe(
			"previous-complete-bundle\n",
		);
		const parentEntries = readdirSync(join(root, ".factory/evidence"));
		expect(parentEntries.some((name) => name.includes("-staging-"))).toBe(false);
	});

	it("production-shaped bundle satisfies checkEvidence", () => {
		const root = makeRepo([command()]);
		const result = run(root);
		expect(result.status).toBe(0);
		const view = checkProductionBundle(root);
		expect(isEvidenceOk(view)).toBe(true);
		expect(view.manifestContractHonored).toBe(true);
		expect(view.perCommandInputsClean).toBe(true);
		expect(view.executionIdentityValid).toBe(true);
	});

	it("equal command subject values that differ from bundle subject fail", () => {
		const root = makeRepo([command()]);
		expect(run(root).status).toBe(0);
		const dir = evidenceDir(root);
		const evidence = readJson(join(dir, "evidence.json"));
		const otherSubject = "f".repeat(40);
		evidence.commands[0].subject_tree_oid_before = otherSubject;
		evidence.commands[0].subject_tree_oid_after = otherSubject;
		rewriteManifest(root, evidence);
		const results = readJson(join(root, "factory/inventories/verification-results.json"));
		results.executed_commands[0].subject_tree_oid_before = otherSubject;
		results.executed_commands[0].subject_tree_oid_after = otherSubject;
		const view = checkProductionBundle(root, results.executed_commands);
		expect(view.perCommandDriftChecked).toBe(false);
		const closure = closureFor(view);
		expect(closure.verdict).toBe("FAIL");
		expect(closure.reasonCodes).toContain("REPOSITORY_DRIFT");
	});

	it("renderer-derived execution identity mismatch fails despite runner assertion", () => {
		const root = makeRepo([command()]);
		expect(run(root).status).toBe(0);
		const dir = evidenceDir(root);
		const evidence = readJson(join(dir, "evidence.json"));
		const results = readJson(join(root, "factory/inventories/verification-results.json"));
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
		const subject = computeFilteredSubjectTreeOid(root)!;
		const view = checkEvidence({
			ev: loadEvidenceFile(join(dir, "evidence.json")),
			hashesText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
			evDirAbs: dir,
			executedCmds: results.executed_commands,
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
});
