#!/usr/bin/env bun
/** CORRECTION13 production-runner integration tests. */

import { afterEach, describe, expect, it } from "bun:test";
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
import { dirname, join } from "node:path";

import {
	archForHostClass,
	checkEvidence,
	computeClosure,
	isEvidenceStructurallyValid,
	loadEvidenceFile,
	loadNativeProbesFromEvidence,
	NATIVE_PROBES_BUNDLE_PATH,
} from "./baseline-closure";
import {
	canonicalizeProbeForBundle,
	NATIVE_PROBE_DEFINITIONS,
	requireAllCanonicalProbes,
	type NativeProbe,
} from "./native-probes";
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

type FixtureJsonRow = Record<string, unknown>;

interface FixtureEvidenceJson extends Record<string, unknown> {
	expected_evidence_payload_paths: string[];
	host_arch: string;
	execution_head_oid: string;
	execution_tree_oid: string;
	commands: FixtureJsonRow[];
}

interface FixtureVerificationResultsJson extends Record<string, unknown> {
	executed_commands: FixtureJsonRow[];
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
 * CORRECTION16 + µC-3 round 3: a valid fixture native-probe inventory.
 * The HEAD and filtered subject tree are filled in lazily by
 * `stageFixtureInventory` so the fixture inventory agrees with the
 * bundle identity that the runner will actually capture.
 */
const FIXTURE_NATIVE_ARTIFACT = Buffer.from("fixture better-sqlite3 artifact\n", "utf8");

function buildFixtureProbeInventory(
	identity: { head: string; tree: string; subject: string; hostClass: string },
): Record<string, unknown> {
	const emptySha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
	const cataloguePatterns: Record<string, string> = {
		p1_better_sqlite3: "SMOKE_OK",
		p2_protobuf: "ProtobufJs-ProtobufVersion",
		p3_ripgrep_darwin_arm64: "ripgrep",
		p4_vscode_host: "VSCODE_OK",
		p5_cline_version: "cline",
	};
	const stdoutFor = (id: string): string => {
		switch (id) {
			case "p1_better_sqlite3": return "SMOKE_OK\nARCH=arm64\nBIND=v1";
			case "p2_protobuf": return "ProtobufJs-ProtobufVersion 7.0.0";
			case "p3_ripgrep_darwin_arm64": return "ripgrep 14.1.0\narch=arm64";
			case "p4_vscode_host": return "VSCODE_OK /tmp/idx.d.ts\nVSCODE_COMMANDS=registerCommand\nVSCODE_WINDOW=showInformationMessage\nVSCODE_CONTEXT=ExtensionContext";
			case "p5_cline_version": return "cline-version 3.0.0";
			default: throw new Error(`unknown probe id in fixture stdout: ${id}`);
		}
	};
	const probe = (id: string, fileFormat: string, argv: string[]) => {
		const def = NATIVE_PROBE_DEFINITIONS.find((item) => item.id === id);
		if (!def) throw new Error(`unknown probe id: ${id}`);
		const stdoutText = stdoutFor(id);
		const artifactExists = id === "p1_better_sqlite3";
		const artifactBytes = artifactExists ? FIXTURE_NATIVE_ARTIFACT : null;
		const artifactSha = artifactBytes === null ? null : createHash("sha256").update(artifactBytes).digest("hex");
		// µC-3 round 3 — the recorded `observed_architecture` must equal
		// the architecture string derived from the host_class (e.g.
		// "arm64"), NOT the host_class string itself ("darwin-arm64").
		const observedArch = archForHostClass(identity.hostClass) ?? identity.hostClass;
		const stdoutSha = createHash("sha256").update(stdoutText, "utf8").digest("hex");
		return {
			id,
			path: def.artifact_path,
			architecture: identity.hostClass,
			sha256: artifactSha ?? "0".repeat(64),
			file_format: fileFormat,
			status: "pass",
			reason: `probe satisfied ${def.label}`,
			argv,
			exit_code: 0,
			signal: null,
			timeout: false,
			timeout_ms: 60_000,
			stdout_text: stdoutText,
			stdout_sha256: stdoutSha,
			stderr_text: "",
			stderr_sha256: emptySha,
			artifact_path: def.artifact_path,
			artifact_sha256: artifactSha,
			artifact_size: artifactBytes?.length ?? 0,
			artifact_exists: artifactExists,
			observed_file_format: fileFormat,
			observed_architecture: observedArch,
			execution_head_oid: identity.head,
			execution_tree_oid: identity.tree,
			subject_tree_oid: identity.subject,
			host_class: identity.hostClass,
			host_supported: true,
			host_support: [...def.host_support],
			started_at: "2026-07-17T09:00:00.000Z",
			finished_at: "2026-07-17T09:00:00.250Z",
			duration_ms: 250,
			working_directory: def.working_directory,
			format_match_source: def.format_match.source,
			format_match_pattern_source: cataloguePatterns[id] ?? def.format_match.pattern_source,
			format_match_pattern_flags: def.format_match.pattern_flags,
			architecture_assert: def.architecture_assert,
			success_contract_version: def.success_contract_version,
			invocation_id: `test-invocation-${id}`,
			failure_kind: "pass",
			failure_message: "",
		};
	};
	return {
		schema_version: 1,
		act_id: "ACT-CLINEMM-FORK-BASELINE01",
		host_class: identity.hostClass,
		collected_at: "2026-07-17T09:00:00.000Z",
		execution_head_oid: identity.head,
		execution_tree_oid: identity.tree,
		subject_tree_oid: identity.subject,
		probes: {
			p1_better_sqlite3: probe("p1_better_sqlite3", "Mach-O 64-bit arm64 bundle", NATIVE_PROBE_DEFINITIONS[0]!.argv),
			p2_protobuf: probe("p2_protobuf", "JavaScript ES module", NATIVE_PROBE_DEFINITIONS[1]!.argv),
			p3_ripgrep_darwin_arm64: probe("p3_ripgrep_darwin_arm64", "Mach-O 64-bit arm64 executable", NATIVE_PROBE_DEFINITIONS[2]!.argv),
			p4_vscode_host: probe("p4_vscode_host", "TypeScript declaration", NATIVE_PROBE_DEFINITIONS[3]!.argv),
			p5_cline_version: probe("p5_cline_version", "JSON manifest", NATIVE_PROBE_DEFINITIONS[4]!.argv),
		},
	};
}

function stageFixtureInventory(root: string): string {
	const head = git(root, ["rev-parse", "HEAD^{commit}"]);
	const tree = git(root, ["rev-parse", "HEAD^{tree}"]);
	const subject = computeFilteredSubjectTreeOid(root);
	if (!subject) throw new Error("fixture subject did not compute");
	// The fixture deliberately backs P1 with real bytes so the positive path
	// exercises staging, manifest declaration, size, and SHA-256 validation.
	write(root, NATIVE_PROBE_DEFINITIONS[0]!.artifact_path, FIXTURE_NATIVE_ARTIFACT.toString("utf8"));
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

/**
 * µC-3 round 3 — wired into the fixture flow so the staged bundle
 * exposes every payload the bundle-bound reader expects (stdout,
 * stderr, per-probe metadata, artifact bytes) with hash-listing
 * consistent with the inventory. The helper:
 *
 *   1. Stages artifact bytes from explicit fixture bytes (NOT from
 *      reads of the destination path — that would be circular).
 *   2. Stages stdout / stderr / metadata payloads by routing each
 *      fixture probe through `canonicalizeProbeForBundle()` so the
 *      bytes written are byte-for-byte equal to what the production
 *      runner would stage.
 *   3. Rewrites the aggregate inventory's `probes` map with the
 *      bundled canonical records so `native-probes.json` agrees with
 *      every per-probe `metadata.json` under `stableStringify`.
 *
 * Returns the manifest text suitable for `hashes.sha256` plus the
 * bundled inventory (so callers can persist it to the bundle).
 */
function stageFixtureBundlePayloads(
	bundleDir: string,
	inventory: Record<string, unknown>,
	artifactBytes: Readonly<Record<string, Buffer>>,
): { manifest: string; bundledInventory: Record<string, unknown> } {
	const probes = (inventory as { probes: Record<string, NativeProbe> }).probes;
	const manifestLines: string[] = [];
	const bundledProbes: Record<string, NativeProbe> = {};
	// Step 1: artifact payloads from explicit fixture bytes.
	for (const definition of NATIVE_PROBE_DEFINITIONS) {
		const bytes = artifactBytes[definition.id];
		if (!bytes) continue;
		const stagedAbs = join(bundleDir, ...definition.artifact_path.split("/"));
		mkdirSync(join(stagedAbs, ".."), { recursive: true });
		writeFileSync(stagedAbs, bytes);
		manifestLines.push(`${sha256(bytes)}  ${definition.artifact_path}`);
	}
	// Step 2: stream / metadata payloads via the µC-2 writer helper.
	for (const definition of NATIVE_PROBE_DEFINITIONS) {
		const probe = probes[definition.id];
		if (!probe) continue;
		const { record, stdoutBytes, stderrBytes, metadataBytes } = canonicalizeProbeForBundle(
			definition.id,
			probe,
		);
		bundledProbes[definition.id] = record;
		const stdoutAbs = join(bundleDir, ...record.stdout_path.split("/"));
		const stderrAbs = join(bundleDir, ...record.stderr_path.split("/"));
		const metadataAbs = join(bundleDir, ...record.metadata_path.split("/"));
		mkdirSync(join(stdoutAbs, ".."), { recursive: true });
		mkdirSync(join(stderrAbs, ".."), { recursive: true });
		mkdirSync(join(metadataAbs, ".."), { recursive: true });
		writeFileSync(stdoutAbs, stdoutBytes);
		writeFileSync(stderrAbs, stderrBytes);
		writeFileSync(metadataAbs, metadataBytes);
		manifestLines.push(`${sha256(stdoutBytes)}  ${record.stdout_path}`);
		manifestLines.push(`${sha256(stderrBytes)}  ${record.stderr_path}`);
		manifestLines.push(`${sha256(metadataBytes)}  ${record.metadata_path}`);
	}
	// Step 3: re-serialize the aggregate inventory with the bundled
	// canonical records so the loader and the per-probe metadata.json
	// agree on the stableStringify canonical form. This is the
	// production-style canonicalization the runner performs via
	// `stageNativeProbesIntoBundle`.
	const canonicalProbes = requireAllCanonicalProbes(bundledProbes);
	const bundledInventory: Record<string, unknown> = {
		...inventory,
		probes: canonicalProbes,
	};
	const inventoryBytes = Buffer.from(JSON.stringify(bundledInventory, null, "\t") + "\n", "utf8");
	writeFileSync(join(bundleDir, "native-probes.json"), inventoryBytes);
	manifestLines.push(`${sha256(inventoryBytes)}  native-probes.json`);
	return {
		manifest: manifestLines.join("\n") + "\n",
		bundledInventory,
	};
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
	for (const source of [
		"run-verification.ts",
		"baseline-closure.ts",
		"git-status.ts",
		"subject-tree.ts",
		"native-probes.ts",
		"collect-native-probes.ts",
	]) {
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
		// CORRECTION20: the production runner refuses --probe-inventory-path
		// unless FACTORY_TEST_FIXTURE_MODE=1 is set. The fixture tests set
		// the flag in the child-process env so the runner accepts the
		// hand-authored inventory; a stray production call would now fail
		// closed.
		env: { ...process.env, CI: "", FACTORY_TEST_FIXTURE_MODE: "1" },
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

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function requireJsonObject(value: unknown, source: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${source} must contain a JSON object`);
	}
	return value as Record<string, unknown>;
}

function requireStringField(
	value: Record<string, unknown>,
	field: string,
	source: string,
): string {
	const observed = value[field];
	if (typeof observed !== "string") {
		throw new Error(`${source}.${field} must be a string`);
	}
	return observed;
}

function requireObjectArray(
	value: Record<string, unknown>,
	field: string,
	source: string,
): FixtureJsonRow[] {
	const observed = value[field];
	if (!Array.isArray(observed)) {
		throw new Error(`${source}.${field} must be an array`);
	}
	return observed.map((entry, index) =>
		requireJsonObject(entry, `${source}.${field}[${index}]`),
	);
}

function readJsonObject(path: string): Record<string, unknown> {
	return requireJsonObject(readJson(path), path);
}

function readFixtureEvidence(path: string): FixtureEvidenceJson {
	const value = readJsonObject(path);
	const expectedPaths = value.expected_evidence_payload_paths;
	if (
		!Array.isArray(expectedPaths) ||
		!expectedPaths.every((entry) => typeof entry === "string")
	) {
		throw new Error(`${path}.expected_evidence_payload_paths must be a string array`);
	}
	return {
		...value,
		expected_evidence_payload_paths: expectedPaths,
		host_arch: requireStringField(value, "host_arch", path),
		execution_head_oid: requireStringField(value, "execution_head_oid", path),
		execution_tree_oid: requireStringField(value, "execution_tree_oid", path),
		commands: requireObjectArray(value, "commands", path),
	};
}

function readFixtureVerificationResults(path: string): FixtureVerificationResultsJson {
	const value = readJsonObject(path);
	return {
		...value,
		executed_commands: requireObjectArray(value, "executed_commands", path),
	};
}

function sha256(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function rewriteManifest(root: string, evidence: FixtureEvidenceJson): void {
	const dir = evidenceDir(root);
	writeFileSync(join(dir, "evidence.json"), `${JSON.stringify(evidence, null, "\t")}\n`);
	const lines = evidence.expected_evidence_payload_paths.map((path: string) => {
		const bytes = readFileSync(join(dir, ...path.split("/")));
		return `${sha256(bytes)}  ${path}`;
	});
	writeFileSync(join(dir, "hashes.sha256"), `${lines.join("\n")}\n`);
}

/**
 * µC-3 round 3 — bundle-side structural predicate. The fixture
 * runs are fixture-derived bundles (probeSource="fixture" +
 * fixtureDerived=true) so `isEvidenceOk` correctly rejects them; the
 * structural predicate below accepts them while still asserting the
 * full audit-pinned conjunction minus the two production provenance
 * fields. This is the deliberate fixture-vs-production split the
 * µC-3 review demands:
 *
 *   fixture bundle:
 *     structurally valid = true
 *     production provenance valid = false
 *     isEvidenceStructurallyValid(view) === true
 *     isEvidenceOk(view) === false   (correctly)
 */
function checkProductionBundle(root: string, executedOverride?: FixtureJsonRow[]) {
	const dir = evidenceDir(root);
	const evidence = readFixtureEvidence(join(dir, "evidence.json"));
	const results = readFixtureVerificationResults(join(dir, "verification-results.json"));
	const subject = computeFilteredSubjectTreeOid(root);
	if (!subject) throw new Error("fixture subject did not compute");
	const view = checkEvidence({
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
	// µC-3 round 3 — populate the native-probe dimension on the view
	// so the structural predicate `isEvidenceStructurallyValid` reads
	// the same value the production runner's `loadNativeProbesFromEvidence`
	// would set. The view already encodes the bundle's native-probe
	// complete=true under `nativeProbesComplete` because the runner
	// refuses to publish a bundle that fails this check.
	const nativeProbes = loadNativeProbesFromEvidence({
		bundleHostClass:
			typeof evidence.host_arch === "string" && evidence.host_arch.length > 0
				? evidence.host_arch
				: null,
		evDirAbs: dir,
		manifestText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
		executionHeadOid: evidence.execution_head_oid,
		executionTreeOid: evidence.execution_tree_oid,
		filteredSubjectTreeOid: subject,
	});
	view.nativeProbesComplete = nativeProbes.complete;
	view.nativeProbesDiagnostics = nativeProbes.diagnostics;
	return view;
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
		nativeProbesComplete: view.nativeProbesComplete,
	});
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	for (const path of fixtureInventoryPaths) rmSync(dirname(path), { recursive: true, force: true });
	roots.length = 0;
	fixtureInventoryPaths.length = 0;
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
		const { root, fixtureInventory } = makeRepo([command()]);
		write(root, "node_modules/pkg/cache.bin", "ignored\n");
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		expect(existsSync(join(evidenceDir(root), "evidence.json"))).toBe(true);
	});
	it("unexpected untracked input fails before command execution", () => {
		const { root, fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('ran.txt', 'yes')"]),
		]);
		write(root, "unexpected\ninput.txt", "dirty\n");
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_BEFORE");
		expect(existsSync(join(root, "ran.txt"))).toBe(false);
	});

	it("tracked input left modified by a command fails drift", () => {
		const { root, fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("WORKTREE_INPUTS_DIRTY_AFTER_COMMAND");
	});

	it("CORRECTION13: clean post-command sample keeps the bundle satisfiable", () => {
		const { root, result } = runWith([command()]);
		if (result.status !== 0) throw new Error(`runner stderr: ${result.stderr}`);
		expect(result.status).toBe(0);
		const view = checkProductionBundle(root);
		// µC-3 round 3 — the structural predicate, NOT the production
		// provenance predicate (which `isEvidenceOk` enforces). The
		// fixture-derived bundle cannot satisfy provenance, but every
		// structural dimension the closure uses must hold.
		expect(isEvidenceStructurallyValid(view)).toBe(true);
		expect(view.manifestContractHonored).toBe(true);
		expect(view.executionIdentityValid).toBe(true);
		expect(view.worktreeInputsCleanBefore).toBe(true);
		expect(view.worktreeInputsCleanAfter).toBe(true);
		expect(view.treeMatches).toBe(true);
		expect(view.commandSetExact).toBe(true);
		expect(view.bundledResultCommandSetExact).toBe(true);
		expect(view.bundledResultPathInvalid).toBeNull();
		expect(view.hashManifestValid).toBe(true);
		expect(view.metadataFileMismatches).toEqual([]);
		expect(view.rowRelationalInvariantViolations).toEqual([]);
		expect(view.nativeProbesComplete).toBe(true);
	});

	it("repository output changes are permitted without entering the manifest domain", () => {
		const { root, result } = runWith(
			[command(["bun", "-e", "await Bun.write('factory/inventories/environment.json', '{\\\"changed\\\":true}\\n')"])],
			{ extraTracked: { "factory/inventories/environment.json": "{}\n" } },
		);
		expect(result.status).toBe(0);
		const evidence = readFixtureEvidence(join(evidenceDir(root), "evidence.json"));
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
		const metadata = readJsonObject(join(dir, "commands/fixture.metadata.json"));
		expect(metadata.status).toBe("fail");
		// The runner preserves whatever code Node's `spawn`/`error` event
		// reported. A real `ENOENT` on Linux produces exit_code=-2 with
		// signal=null; the validator's relational invariant accepts any
		// numeric exit_code with status=fail and signal=null.
		expect(typeof metadata.exit_code).toBe("number");
		expect(metadata.exit_code).not.toBe(0);
		expect(metadata.failure_classification).toBe("UNKNOWN");
		expect(metadata.stderr_sha256).toMatch(/^[0-9a-f]{64}$/);
		const manifest = readFileSync(join(dir, "hashes.sha256"), "utf8");
		expect(manifest).toContain("commands/fixture.metadata.json");
		const view = checkProductionBundle(root);
		// µC-3 round 3 — structural predicate accepts fixture bundles
		// even when `isEvidenceOk` (production-provenance predicate)
		// correctly rejects them.
		expect(isEvidenceStructurallyValid(view)).toBe(true);
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
		const metadata = readJsonObject(join(dir, "commands/fixture.metadata.json"));
		expect(metadata.status).toBe("fail");
		// The runner preserves whatever code Node's `spawn`/`error` event
		// reported. A real `ENOENT` on Linux produces exit_code=-2 with
		// signal=null; the validator's relational invariant accepts any
		// numeric exit_code with status=fail and signal=null.
		expect(typeof metadata.exit_code).toBe("number");
		expect(metadata.exit_code).not.toBe(0);
		expect(metadata.failure_classification).toBe("UNKNOWN");
		// The stderr stream should carry a spawn-error indicator (either
		// the error message text or a fallback marker the runner appends).
		const stderrText = readFileSync(join(dir, "commands/fixture.stderr"), "utf8");
		expect(stderrText.length).toBeGreaterThan(0);
		// `isEvidenceOk` must remain false (production-provenance predicate)
		// but `isEvidenceStructurallyValid` accepts the fixture bundle.
		const view = checkProductionBundle(root);
		expect(isEvidenceStructurallyValid(view)).toBe(true);
	});

	it("child exit (process.exit(7)) is reported as a real failure", () => {
		const { root, result } = runWith([command(["bun", "-e", "process.exit(7)"])]);
		expect(result.status).toBe(0);
		const dir = evidenceDir(root);
		const metadata = readJsonObject(join(dir, "commands/fixture.metadata.json"));
		expect(metadata.exit_code).toBe(7);
		expect(metadata.status).toBe("fail");
		expect(metadata.failure_classification).toBe("UNKNOWN");
		const view = checkProductionBundle(root);
		expect(isEvidenceStructurallyValid(view)).toBe(true);
	});

	it("finalize performs one bundle preparation and does not crash", () => {
		const { root, fixtureInventory, result } = runWith([command()]);
		const finalized = run(root, ["--finalize-evidence"], fixtureInventory);
		expect(finalized.status).toBe(0);
		expect(finalized.stdout.match(/Prepared detached evidence bundle once/g)).toHaveLength(1);
		const evidence = readFixtureEvidence(join(evidenceDir(root), "evidence.json"));
		expect(evidence.pass_label).toBe("finalize");
		// The first run still produced a satisfiable bundle (this asserts
		// the prior fixture run was not broken by the wrapper).
		expect(result.status).toBe(0);
	});

	it("successful replacement removes old evidence files", () => {
		const { root, fixtureInventory } = runWith([command()]);
		write(root, `${ACT_DIR}/commands/stale.stdout`, "stale\n");
		write(root, `${ACT_DIR}/stale.txt`, "stale\n");
		const result = run(root, [], fixtureInventory);
		expect(result.status).toBe(0);
		expect(existsSync(join(evidenceDir(root), "stale.txt"))).toBe(false);
		expect(existsSync(join(evidenceDir(root), "commands/stale.stdout"))).toBe(false);
	});

	it("failed pass leaves the previous complete bundle untouched", () => {
		const { root, fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		write(root, `${ACT_DIR}/sentinel.txt`, "previous-complete-bundle\n");
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
		// µC-3 round 3 — structural predicate (the comprehensive
		// assertion the µC-3 review demanded; NOT a 4-boolean
		// weakening). Every dimension the closure reads is checked
		// here explicitly so a fixture drift cannot silently pass.
		expect(isEvidenceStructurallyValid(view)).toBe(true);
		expect(view.manifestContractHonored).toBe(true);
		expect(view.executionIdentityValid).toBe(true);
		expect(view.treeMatches).toBe(true);
		expect(view.commandSetExact).toBe(true);
		expect(view.bundledResultCommandSetExact).toBe(true);
		expect(view.bundledResultPathInvalid).toBeNull();
		expect(view.hashManifestValid).toBe(true);
		expect(view.metadataFileMismatches).toEqual([]);
		expect(view.rowRelationalInvariantViolations).toEqual([]);
		expect(view.unexpectedFiles).toEqual([]);
		expect(view.missingFiles).toEqual([]);
		expect(view.hashMismatches).toEqual([]);
		expect(view.nativeProbesComplete).toBe(true);
		expect(view.worktreeInputsCleanBefore).toBe(true);
		expect(view.worktreeInputsCleanAfter).toBe(true);
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
		const evidence = readFixtureEvidence(join(dir, "evidence.json"));
		// Deliberately leave hashes.sha256 unchanged: rewriting it after
		// tampering would make the tampered bytes authoritative.
		const subject = computeFilteredSubjectTreeOid(root)!;
		const view = checkEvidence({
			ev: loadEvidenceFile(join(dir, "evidence.json")),
			hashesText: readFileSync(join(dir, "hashes.sha256"), "utf8"),
			evDirAbs: dir,
			executedCmds: readFixtureVerificationResults(
				join(dir, "verification-results.json"),
			).executed_commands,
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
		for (const source of [
			"run-verification.ts",
			"baseline-closure.ts",
			"git-status.ts",
			"subject-tree.ts",
			"native-probes.ts",
			"collect-native-probes.ts",
		]) {
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
		const evidence = readFixtureEvidence(join(dir, "evidence.json"));
		const otherSubject = "f".repeat(40);
		evidence.commands[0].subject_tree_oid_before = otherSubject;
		evidence.commands[0].subject_tree_oid_after = otherSubject;
		rewriteManifest(root, evidence);
		const results = readFixtureVerificationResults(join(dir, "verification-results.json"));
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
		const evidence = readFixtureEvidence(join(dir, "evidence.json"));
		const results = readFixtureVerificationResults(join(dir, "verification-results.json"));
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
		const evidence = readFixtureEvidence(join(dir, "evidence.json"));
		evidence.commands[0].failure_classification = "ENVIRONMENTAL";
		// Rehash the manifest with the tampered evidence.json.
		rewriteManifest(root, evidence);
		const results = readFixtureVerificationResults(join(dir, "verification-results.json"));
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
		const results = readFixtureVerificationResults(join(dir, "verification-results.json"));
		results.executed_commands.push({...results.executed_commands[0], id: "ghost"});
		// The bundled verification-results.json must be re-hashed into the
		// manifest after the change for the renderer to detect the mismatch
		// (the metadata file inside the bundle has changed).
		const resultPath = "verification-results.json";
		const newHash = sha256(readFileSync(join(dir, ...resultPath.split("/"))));
		rewriteManifest(root, readFixtureEvidence(join(dir, "evidence.json")));
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
		const evidence = readFixtureEvidence(join(dir, "evidence.json"));
		const original = readJsonObject(join(dir, "commands/fixture.metadata.json"));
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
		const { root, fixtureInventory } = makeRepo([
			command(["bun", "-e", "await Bun.write('input.txt', 'changed\\n')"]),
		]);
		const trackedPath = join(root, "factory/inventories/verification-results.json");
		writeFileSync(trackedPath, `${JSON.stringify({sentinel: "pre-fail-mirror"}, null, "\t")}\n`);
		const previousMirror = readFileSync(trackedPath, "utf8");
		const result = run(root, [], fixtureInventory);
		expect(result.status).not.toBe(0);
		// Even when a prior mirror existed, a failed pass must leave the
		// tracked file byte-identical to its prior contents.
		expect(readFileSync(trackedPath, "utf8")).toBe(previousMirror);
	});
});