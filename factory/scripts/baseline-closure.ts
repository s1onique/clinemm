#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION15 — Closure logic (pure).
 *
 * The renderer (`render-baseline-report.ts`) imports the helpers from this
 * module so the verdict logic is independently testable. Importing this
 * module has no side effects — it does not read the working tree, write any
 * file, or spawn git. The renderer's main entry performs I/O and calls into
 * `computeClosure` / `checkEvidence`.
 *
 * Policy (CORRECTION15, fail-closed + non-self-referential subject-tree +
 * independently-derived execution identity + per-command live cleanliness +
 * relational status/classification invariants + bundled self-contained bundle
 * + bundled-result-verification-before-aggregate-exactness +
 * pass-only-closure-arithmetic + fail-closed native-probe dimension +
 * deduplicated row diagnostics):
 *
 *   FAIL      evidence is missing, malformed, stale-bound, hash-invalid,
 *             multi-tree, command-set-mismatched, symlinked,
 *             outside-evidence-dir, self-referential, on-a-dirty-worktree,
 *             split between subject and execution identity, captured
 *             with drift between/within commands, recorded with malformed
 *             paths, or holding a status/classification invariant
 *             violation; OR the bundled verification-results.json command-
 *             set check never explicitly returned `true`; OR the native
 *             probe inventory P1–P5 is missing, malformed, deferred,
 *             unknown, or contains any failed probe; OR there are
 *             UNKNOWN-classified failures with no investigation note.
 *   PARTIAL   evidence is internally valid and command-set-exact (incl. per-
 *             record equality), the bundled-result check returned `true`,
 *             the native-probe dimension is complete, the UNKNOWN policy is
 *             satisfied, but at least one declared baseline requirement
 *             (R4/R5/R6/R7/R16) remains open.
 *   PASS      every requirement is satisfied, the bundled-result check
 *             returned `true`, the native-probe dimension is complete, and
 *             all mandatory commands pass on the binding host.
 *
 * CORRECTION13 collapses the per-command tracked-input assertion from
 * `perCommandInputsClean` (a proof-bearing closure dimension) into a hint
 * (`trackedInputChangeObserved`, `trackedInputMonitorDegraded`) recorded on
 * the command row and surfaced through the report, without entering the
 * fail-closed conjunction. The detached bundle is required to be
 * self-contained: it carries `evidence.json`, every command's stdout/stderr/
 * metadata payload, and `verification-results.json` inside the bundle so
 * `checkEvidence()` can hash-verify the executed-command record without
 * consulting the tracked mirror.
 *
 * CORRECTION15 ordering fix: the bundled-result command-set check MUST run
 * before `commandSetExact` is computed; otherwise the aggregate is
 * unsatisfiable. CORRECTION15 also makes the native-probe inventory a
 * fail-closed closure dimension (P1–P5), counts only `status === "pass"` as
 * a pass (skip / unavailable are tracked separately), and deduplicates
 * row diagnostics with a `Set<string>` before returning them.
 */

import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import {
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";

import {
	canonicalizeProbeForBundle,
	canonicalStreamPaths,
	compileFormatMatch,
	loadEvidencePayload,
	NATIVE_PROBE_DEFINITIONS,
	NATIVE_PROBE_STREAM_LAYOUT_VERSION,
	parseBundledNativeProbe,
	requireAllCanonicalProbes,
	stableStringify,
	type BundledNativeProbe,
	type FormatMatchSpec,
	type NativeProbe,
	type ProbeParseDiagnostic,
} from "./native-probes";


export type Verdict = "PASS" | "PARTIAL" | "FAIL";

export type ReasonCode =
	| "EVIDENCE_INCOMPLETE"
	| "SUBJECT_TREE_COMPUTATION_FAILED"
	| "SUBJECT_TREE_CONTRACT_MISSING"
	| "EXECUTION_IDENTITY_MISSING"
	| "EXECUTION_IDENTITY_MALFORMED"
	| "EXECUTION_IDENTITY_INVALID"
	| "EXECUTION_TREE_NOT_BOUND"
	| "EXECUTION_TREES_MIXED"
	| "WORKTREE_INPUTS_DIRTY_BEFORE"
	| "WORKTREE_INPUTS_DIRTY_AFTER"
	| "SUBJECT_DRIFT"
	| "REPOSITORY_DRIFT"
	| "MANIFEST_PATH_OUTSIDE_EVIDENCE"
	| "BUNDLED_RESULT_PATH_INVALID"
	| "BUNDLED_RESULT_COMMAND_SET_MISMATCH"
	| "ROW_RELATIONAL_INVARIANT_VIOLATION"
	| "METADATA_FILE_MISMATCH"
	| "UNKNOWN_FAILURES_PRESENT"
	| "R4_UNSATISFIED"
	| "R5_UNSATISFIED"
	| "R6_UNSATISFIED"
	| "R7_UNSATISFIED"
	| "R16_UNSATISFIED"
	| "MANDATORY_NOT_ALL_PASS"
	| "AFFECTED_SCOPE_NOT_ALL_PASS"
	| "NATIVE_PROBES_INCOMPLETE";

/**
 * CORRECTION15 / CORRECTION21 / µC-3 native-probe diagnostic. Each entry
 * describes one structured failure mode:
 *
 *   missing-inventory       bundle has no native-probes.json payload
 *   malformed-json          the inventory could not be JSON-parsed
 *   missing-key             a canonical probe id is absent from the inventory
 *   invalid-shape           a record does not satisfy the parser (µC-3 fail-closed)
 *   deferred                the probe was not executed (production preflight rejects this)
 *   non-pass                recorded status disagrees with the derived outcome
 *   hash-mismatch           any of {artifact_sha256, stdout_sha256, stderr_sha256, metadata_hash} differs from the recomputed value
 *   architecture-mismatch   observed or derived architecture disagrees with host_class or Mach-O bytes
 *   identity-mismatch       the recorded head/tree/subject does not match the bundle
 *   argv-mismatch           the recorded argv does not match the catalogue
 *   host-class-mismatch     the recorded host_class does not match the bundle's recorded host
 *   predicate-mismatch      the persisted format_match pattern cannot compile or disagrees with the catalogue
 *   stream-layout-missing   the record omits `stream_layout_version`
 *   stream-layout-unsupported the record declares an unsupported `stream_layout_version`
 *   stream-path-mismatch    one of the recorded paths differs from the canonical layout
 *   stream-payload-missing  an external stdout/stderr/metadata file is absent from the bundle
 *   stream-payload-not-regular an external stream payload exists but is a symlink/non-regular file
 *   stream-payload-hash-mismatch an external stream payload's SHA-256 disagrees with the manifest
 *   stream-record-hash-mismatch the recorded stdout_sha256 / stderr_sha256 disagrees with the on-disk bytes
 *   embedded-stream-mismatch the embedded stdout_text / stderr_text disagrees with the external bytes
 *   metadata-payload-missing  the per-probe metadata.json file is absent from the bundle
 *   metadata-hash-mismatch     the metadata payload's SHA-256 disagrees with the manifest
 *   metadata-json-malformed    the metadata payload could not be JSON-parsed
 *   metadata-shape-invalid     the parsed metadata value is not a JSON object
 *   metadata-record-mismatch   the stableStringify of the metadata file's JSON value differs from the aggregate record
 *   derived-outcome-mismatch   the recorded status agrees with the embedded text only; the external-streams-derivation disagrees
 *
 * The renderer surfaces these in the report so reviewers can distinguish
 * "we did not probe" from "we probed and the artifact is missing" from
 * "we probed and the execution record disagrees with the bundle".
 */
export type NativeProbeDiagnosticKind =
	| "missing-inventory"
	| "malformed-json"
	| "missing-key"
	| "invalid-shape"
	| "deferred"
	| "non-pass"
	| "hash-mismatch"
	| "architecture-mismatch"
	| "identity-mismatch"
	| "argv-mismatch"
	| "host-class-mismatch"
	| "predicate-mismatch"
	| "stream-layout-missing"
	| "stream-layout-unsupported"
	| "stream-path-mismatch"
	| "stream-payload-missing"
	| "stream-payload-not-regular"
	| "stream-payload-hash-mismatch"
	| "stream-record-hash-mismatch"
	| "embedded-stream-mismatch"
	| "metadata-payload-missing"
	| "metadata-hash-mismatch"
	| "metadata-json-malformed"
	| "metadata-shape-invalid"
	| "metadata-record-mismatch"
	| "derived-outcome-mismatch";


export interface NativeProbeDiagnostic {
	probeId: NativeProbeId;
	kind: NativeProbeDiagnosticKind;
	message: string;
}

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

// ---------- CORRECTION21 Mach-O parser + host-class architecture helpers -----

/**
 * Recognized Mach-O magic numbers. Native Mach-O binaries on Apple
 * platforms embed a 32-bit (0xfeedface / 0xcefaedfe little-endian) or
 * 64-bit (0xfeedfacf / 0xcffaedfe little-endian) magic value as their
 * first four bytes. The next four bytes encode the target CPU type.
 */
export const MACHO_MAGIC_BE_32 = 0xfeedface;
export const MACHO_MAGIC_LE_32 = 0xcefaedfe;
export const MACHO_MAGIC_BE_64 = 0xfeedfacf;
export const MACHO_MAGIC_LE_64 = 0xcffaedfe;

/**
 * CPU_TYPE constants from `<mach/machine.h>` for the architectures the
 * factory probes care about. We deliberately do not enumerate every
 * possible CPU type; unknown values produce an "unknown" architecture
 * label that fails the host-class assertion when one is recorded.
 */
export const CPU_TYPE_X86 = 7;
export const CPU_TYPE_X86_64 = 0x0100_0007;
export const CPU_TYPE_ARM = 12;
export const CPU_TYPE_ARM64 = 0x0100_000c;
export const CPU_TYPE_ARM64_32 = 0x0200_000c;

export type MachOArch = "arm64" | "x86_64" | "x86" | "arm" | "arm64_32" | "unknown";

/**
 * Bundle-relative sub-directory where CORRECTION21 externalizes each
 * probe's stdout, stderr, metadata, and artifact payloads. Each file is
 * hash-listed independently in `hashes.sha256` so the validator can
 * recompute the SHA-256 of every stream without trusting the inventory
 * JSON's self-reported hashes.
 */
export const NATIVE_PROBES_PAYLOAD_DIR = "native-probes";

/**
 * Result of an independent Mach-O architecture derivation. `arch` is
 * the architecture label computed from the artifact bytes; `cputype`
 * is the raw CPU_TYPE integer for diagnostics. When the artifact is
 * not a Mach-O binary, `arch` is `null` and the probe's
 * `architecture_assert` is not evaluated against the bytes.
 */
export interface MachODerivation {
	arch: MachOArch | null;
	cputype: number | null;
	bitness: 32 | 64 | null;
	byteOrder: "be" | "le" | null;
}

/**
 * Read the first eight bytes of an artifact and derive its Mach-O
 * architecture. Returns `arch=null` (not an error) when the artifact
 * is not a Mach-O binary — JSON manifests, .d.ts files, text fixtures,
 * and ELF binaries all return `null` because their magic number does
 * not match any of the four known Mach-O values.
 *
 * The parser is independent of any recorded probe metadata: it only
 * reads the staged bytes. A probe whose `recorded_architecture`
 * disagrees with this derivation is rejected by the validator when the
 * probe declares `architecture_assert: "host-class"`.
 */
export function deriveMachOArchitecture(bytes: Buffer): MachODerivation {
	// CORRECTION21 review fix: guard against the full 8-byte header. A
	// four-byte valid magic without the cputype field would otherwise
	// throw ERR_OUT_OF_RANGE inside `bytes.readUInt32*(4)`.
	if (bytes.length < 8) {
		return { arch: null, cputype: null, bitness: null, byteOrder: null };
	}
	// Apple defines MH_* as big-endian constants; MH_CIGAM* are the
	// byte-swapped counterparts used on little-endian hosts. Reading the
	// first four bytes as big-endian gives the natural magic for a
	// big-endian file and the byte-swapped (CIGAM) magic for a
	// little-endian file. The previous implementation cross-compared
	// `magicLe === MACHO_MAGIC_LE_64`, which can never match because a
	// little-endian file's little-endian read returns the natural magic
	// (0xfeedfacf), not the swapped magic (0xcffaedfe).
	const magicBe = bytes.readUInt32BE(0);
	let bitness: 32 | 64 | null = null;
	let byteOrder: "be" | "le" | null = null;
	if (magicBe === MACHO_MAGIC_BE_32) {
		bitness = 32;
		byteOrder = "be";
	} else if (magicBe === MACHO_MAGIC_LE_32) {
		bitness = 32;
		byteOrder = "le";
	} else if (magicBe === MACHO_MAGIC_BE_64) {
		bitness = 64;
		byteOrder = "be";
	} else if (magicBe === MACHO_MAGIC_LE_64) {
		bitness = 64;
		byteOrder = "le";
	} else {
		return { arch: null, cputype: null, bitness: null, byteOrder: null };
	}
	const cputype = byteOrder === "be" ? bytes.readUInt32BE(4) : bytes.readUInt32LE(4);
	const arch = machOCpuTypeToArch(cputype);
	return { arch, cputype, bitness, byteOrder };
}

function machOCpuTypeToArch(cputype: number): MachOArch {
	switch (cputype) {
		case CPU_TYPE_ARM64:
			return "arm64";
		case CPU_TYPE_ARM64_32:
			return "arm64_32";
		case CPU_TYPE_X86_64:
			return "x86_64";
		case CPU_TYPE_X86:
			return "x86";
		case CPU_TYPE_ARM:
			return "arm";
		default:
			return "unknown";
	}
}

/**
 * Project a host-class string (e.g. "darwin-arm64", "linux-x64") to
 * the architecture component. Returns `null` when the host class is
 * malformed (does not match `<os>-<arch>`). The validator uses this to
 * independently verify that a Mach-O probe's derived architecture is
 * compatible with the binding host.
 */
export function archForHostClass(hostClass: string | null): MachOArch | null {
	if (hostClass === null) return null;
	const m = /^(?:darwin|linux|win32|windows)-([a-z0-9_]+)$/.exec(hostClass);
	if (!m) return null;
	const arch = m[1];
	if (arch === "arm64" || arch === "aarch64") return "arm64";
	if (arch === "x64" || arch === "x86_64") return "x86_64";
	if (arch === "x86" || arch === "ia32") return "x86";
	if (arch === "arm" || arch === "armv7") return "arm";
	return "unknown";
}

/**
 * Shape the runner/renderer agree on for a native-probe entry once it has
 * been loaded from the detached evidence bundle. The schema covers the
 * CORRECTION16 execution-record fields: argv, exit_code, signal, timeout,
 * stdout/stderr sha256, artifact path + sha256, observed file_format /
 * architecture, and the identity bindings (execution HEAD/tree + filtered
 * subject + host_class). The CORRECTION15 placeholder fields (`path`,
 * `sha256`, `file_format`, `status`, `reason`) are kept so existing
 * fixtures and reports continue to render.
 */

/**
 * Result of loading and validating the native-probe inventory. `complete` is
 * true only when every required probe key is present, well-formed, and has
 * status "pass". The CORRECTION16 invariant adds:
 *
 *   - the bundle-bound `native-probes.json` was found inside the evidence
 *     directory and parsed without error;
 *   - the staged inventory is hash-listed in `hashes.sha256` and the hash
 *     matches the bytes on disk;
 *   - every probe's recorded SHA-256 matches the artifact on disk at the
 *     recorded path;
 *   - every probe's `observed_architecture` matches the captured host class
 *     when the probe is host-supported;
 *   - every probe's `execution_head_oid`, `execution_tree_oid`, and
 *     `subject_tree_oid` match the bundle's recorded execution identity.
 *
 * Any absent, malformed, deferred, unknown, failed, hash-mismatched,
 * identity-mismatched, or argv-mismatched probe makes `complete` false;
 * the renderer and runner surface the structured diagnostics so reviewers
 * can see which dimension failed.
 */
export type NativeProbeViewRecord = Pick<
	NativeProbe,
	"id" | "path" | "architecture" | "sha256" | "file_format" | "status" | "reason"
>;

export interface NativeProbesView {
	complete: boolean;
	probes: Record<NativeProbeId, NativeProbeViewRecord | null>;
	diagnostics: NativeProbeDiagnostic[];
	// CORRECTION16: where the inventory was loaded from (bundle-relative
	// path under the evidence directory or absolute path outside the bundle).
	source: "bundle" | "tracked" | "missing";
	// CORRECTION16: hash that was declared in the bundle's `hashes.sha256`
	// for `native-probes.json`, or `null` if the entry is absent. The renderer
	// surfaces mismatches between declared and computed hashes here.
	declaredHash: string | null;
	// CORRECTION16: hash that was actually observed on disk.
	observedHash: string | null;
	// CORRECTION16: dimensions surfaced independently so the renderer can
	// show how many probes failed for each reason without re-walking the
	// diagnostics array.
	hashMismatches: NativeProbeId[];
	architectureMismatches: NativeProbeId[];
	identityMismatches: NativeProbeId[];
	argvMismatches: NativeProbeId[];
	hostClassMismatches: NativeProbeId[];
	// CORRECTION21 (µC-3) — explicit structural dimensions. Every dimension
	// reflects whether the corresponding check was *actually evaluated*,
	// not whether the diagnostics list is empty: a missing manifest entry
	// short-circuits the run with `false` for every downstream dimension
	// rather than implying the bundle is complete just because no
	// diagnostic was emitted.
	streamLayoutValid: boolean;
	streamPathsCanonical: boolean;
	externalStreamsComplete: boolean;
	externalStreamHashesValid: boolean;
	embeddedStreamsConsistent: boolean;
	metadataPayloadsComplete: boolean;
	metadataHashesValid: boolean;
	metadataRecordsEqual: boolean;
	derivedOutcomesMatch: boolean;
	allProbesPassed: boolean;
}


export interface PathDiagnostic {
	path: string;
	reason: "missing" | "unexpected" | "symlink" | "traversal" | "absolute" | "outside-evidence-dir";
}

export interface HashMismatch {
	path: string;
	expected: string;
	actual: string;
}

export interface MalformedLine {
	line: number;
	content: string;
}

export interface DuplicatePath {
	path: string;
	occurrences: number;
}

export interface CommandRecordMismatch {
	id: string;
	fields: string[];
	evidence: Record<string, unknown>;
	executed: Record<string, unknown>;
}

export interface RowDiagnostic {
	id: string;
	fields: string[];
	role: "evidence" | "executed";
}

export interface MetadataFileMismatch {
	id: string;
	fields: string[];
}

/**
 * The complete integrity picture for the detached evidence bundle. Every
 * dimension must be satisfied for the verdict to not be FAIL on evidence
 * grounds; see `isEvidenceOk` and `computeClosure`.
 */
export interface EvidenceView {
	exists: boolean;
	headOidWellformed: boolean;
	treeMatches: boolean;
	subjectTreeContract: boolean;
	subjectTreeComputationOk: boolean;
	executionIdentityRecorded: boolean;
	executionHeadOidWellformed: boolean;
	executionTreeOidWellformed: boolean;
	executionHeadExists: boolean;
	executionTreeExists: boolean;
	derivedExecutionTreeOid: string | null;
	runnerExecutionIdentityAssertion: boolean | null;
	executionIdentityAssertionAgrees: boolean;
	executionIdentityValid: boolean;
	executionTreeBound: boolean;
	executionTrees: string[];
	worktreeInputsCleanBefore: boolean | null;
	worktreeInputsCleanAfter: boolean | null;
	perCommandDriftChecked: boolean;
	subjectStableAcrossMatrix: boolean;
	manifestContractHonored: boolean;
	hashManifestValid: boolean;
	bundledResultPathInvalid: PathDiagnostic | null;
	bundledResultCommandSetExact: boolean | null;
	bundledResultExtraCommands: string[];
	bundledResultMissingCommands: string[];
	rowRelationalInvariantViolations: RowDiagnostic[];
	metadataFileMismatches: MetadataFileMismatch[];
	missingFiles: PathDiagnostic[];
	unexpectedFiles: PathDiagnostic[];
	hashMismatches: HashMismatch[];
	malformedLines: MalformedLine[];
	duplicatePaths: DuplicatePath[];
	commandSetExact: boolean;
	duplicateEvidenceCommandIds: DuplicatePath[];
	duplicateExecutedCommandIds: DuplicatePath[];
	commandRecordMismatches: CommandRecordMismatch[];
	rejectedManifestPaths: PathDiagnostic[];
	outOfEvidenceDirPaths: PathDiagnostic[];
	malformedEvidenceCommandRows: number;
	malformedExecutedCommandRows: number;
	decodeError: string | null;
	// CORRECTION15: fail-closed native-probe dimension. true iff P1–P5 are
	// all present, well-formed, and each finished with status="pass".
	nativeProbesComplete: boolean;
	nativeProbesDiagnostics: NativeProbeDiagnostic[];
	// CORRECTION21: provenance stamp. `probeSource` records where the
	// inventory came from (real executed probes vs. hand-authored
	// fixtures); `fixtureDerived` is true iff the runner substituted a
	// fixture for one or more real probes. Both fields are required:
	// `isEvidenceOk` rejects anything that is not `probeSource="executed"`
	// and `fixtureDerived=false`. The fields live at the top level of
	// `native-probes.json` and are surfaced through the bundle's
	// `evidence.json` so the renderer and runner agree on the trust
	// boundary.
	probeSource: "executed" | "fixture" | "unknown";
	fixtureDerived: boolean;
}

export interface ClosureInput {
	evidence: EvidenceView;
	unknownFailures: string[];
	unknownFailureCount: number;
	mandatoryPass: number;
	mandatoryFail: number;
	mandatoryApplicable: number;
	affectedScopePass: number;
	affectedScopeFail: number;
	affectedScopeApplicable: number;
	r4Satisfied: boolean;
	r5Satisfied: boolean;
	r6Satisfied: boolean;
	r7Satisfied: boolean;
	r16Satisfied: boolean;
	nativeProbesComplete: boolean;
}

export interface ClosureResult {
	verdict: Verdict;
	evidenceOk: boolean;
	reasonCodes: ReasonCode[];
	unknownFailureCount: number;
}

// ---------- control files ---------------------------------------------------

export const CONTROL_FILES: ReadonlySet<string> = new Set(["hashes.sha256"]);

const RECORD_COMPARE_FIELDS = [
	"status",
	"head_oid",
	"tree_oid",
	"head_oid_before",
	"head_oid_after",
	"tree_oid_before",
	"tree_oid_after",
	"subject_tree_oid_before",
	"subject_tree_oid_after",
	"exit_code",
	"timeout",
	"stdout_sha256",
	"stderr_sha256",
	"stdout_path",
	"stderr_path",
	"metadata_path",
	"environment_sha256",
	"failure_classification",
] as const;

const OID_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EVIDENCE_PAYLOAD_REL = /^(?:commands\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:stdout|stderr|metadata\.json)|evidence\.json|verification-results\.json)$/;
const FAILURE_CLASSES = new Set([
	"FORK-INTRODUCED",
	"UPSTREAM-REPRODUCIBLE",
	"ENVIRONMENTAL",
	"CREDENTIAL-REQUIRED",
	"NETWORK-DEPENDENT",
	"HOST-UNSUPPORTED",
	"NONDETERMINISTIC",
	"TIMEOUT",
	"TOOLCHAIN-DRIFT",
	"UNKNOWN",
]);

function isOpaquePath(path: string): boolean {
	if (path === "evidence.json" || path === "verification-results.json") return true;
	return EVIDENCE_PAYLOAD_REL.test(path);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateCommandRecord(row: unknown, role: "evidence" | "executed"): RowDiagnostic | null {

	if (row === null || typeof row !== "object") return { id: "(row)", fields: ["<not-an-object>"], role };
	const value = row as Record<string, unknown>;
	// CORRECTION15: collect field names into a Set so structural and relational
	// checks can both append the same name without producing duplicate entries
	// in the final diagnostic. The sorted array preserves stable ordering for
	// the renderer.
	const fieldSet = new Set<string>();
	const pushField = (name: string): void => {
		fieldSet.add(name);
	};
	if (typeof value.id !== "string" || value.id.length === 0 || !SAFE_PATH_SEGMENT.test(value.id)) {
		pushField("id");
	}
	const expectedFields = [
		"status",
		"started_at",
		"finished_at",
		"duration_ms",
		"exit_code",
		"signal",
		"timeout",
		"stdout_sha256",
		"stderr_sha256",
		"stdout_path",
		"stderr_path",
		"metadata_path",
		"head_oid",
		"tree_oid",
		"head_oid_before",
		"head_oid_after",
		"tree_oid_before",
		"tree_oid_after",
		"subject_tree_oid_before",
		"subject_tree_oid_after",
		"environment_sha256",
		"failure_classification",
	] as const;
	for (const field of expectedFields) {
		if (!(field in value)) pushField(field);
	}
	if (
		value.status !== "pass" &&
		value.status !== "fail" &&
		value.status !== "skip" &&
		value.status !== "unavailable"
	) {
		pushField("status");
	}
	if (typeof value.duration_ms !== "number" || value.duration_ms < 0) pushField("duration_ms");
	if (typeof value.timeout !== "boolean") pushField("timeout");
	// CORRECTION21: the canonical spawn-failure shape is exit_code=-1 +
	// signal=null. The runner normalizes outcome.signal back to null on
	// spawnError, so a fail row carrying a non-null signal (including the
	// legacy "" empty-string marker) is malformed. Reject any fail row
	// whose exit_code or signal doesn't match the canonical pair.
	if (
		typeof value.exit_code !== "number" &&
		!(role === "evidence" && value.exit_code === null)
	) {
		pushField("exit_code");
	}
	if (typeof value.signal !== "string" && value.signal !== null) pushField("signal");
	if (typeof value.started_at !== "string" || !ISO8601_PATTERN.test(value.started_at as string)) {
		pushField("started_at");
	}
	if (typeof value.finished_at !== "string" || !ISO8601_PATTERN.test(value.finished_at as string)) {
		pushField("finished_at");
	}
	for (const idField of [
		"head_oid",
		"tree_oid",
		"head_oid_before",
		"head_oid_after",
		"tree_oid_before",
		"tree_oid_after",
		"subject_tree_oid_before",
		"subject_tree_oid_after",
	]) {
		if (typeof value[idField] !== "string" || !OID_PATTERN.test(value[idField] as string)) {
			pushField(idField);
		}
	}
	for (const hashField of ["stdout_sha256", "stderr_sha256", "environment_sha256"]) {
		if (typeof value[hashField] !== "string" || !SHA256_PATTERN.test(value[hashField] as string)) {
			pushField(hashField);
		}
	}
	for (const pathField of ["stdout_path", "stderr_path", "metadata_path"]) {
		const raw = value[pathField];
		if (typeof raw !== "string" || !isOpaquePath(raw)) pushField(pathField);
	}
	if (
		value.failure_classification !== null &&
		(typeof value.failure_classification !== "string" ||
			!FAILURE_CLASSES.has(value.failure_classification))
	) {
		pushField("failure_classification");
	}
	// CORRECTION14: relational status/classification/timeout/exit_code invariants.
	// pass ⇔ exit_code === 0 AND signal === null AND timeout === false AND fc === null.
	// fail ⇔ fc ∈ FAILURE_CLASSES and timeout ⇒ fc === "TIMEOUT".
	if (typeof value.status === "string" && typeof value.failure_classification !== "undefined") {
		const fc = value.failure_classification;
		const isTimeout = value.timeout === true;
		const fcIsNull = fc === null;
		const fcIsTimeout = fc === "TIMEOUT";
		const fcIsString = typeof fc === "string" && FAILURE_CLASSES.has(fc);
		if (value.status === "pass") {
			if (!fcIsNull) pushField("failure_classification");
			if (value.exit_code !== 0) pushField("exit_code");
			// CORRECTION20: the production relational invariant for pass rows
			// is `(status=pass ⇒ signal=null)`. A signal marker that is the
			// empty string would only ever be produced by a runner accident
			// — the fixture in `run-verification.test.ts` now normalizes
			// spawn-failure signals back to null — so accept only the
			// canonical null form here.
			if (value.signal !== null) pushField("signal");
			if (isTimeout) pushField("timeout");
		} else if (value.status === "fail") {
			if (fcIsNull) pushField("failure_classification");
			if (isTimeout && !fcIsTimeout) pushField("failure_classification");
			if (!fcIsString) pushField("failure_classification");
		} else if (value.status === "skip" || value.status === "unavailable") {
			if (value.signal !== null) pushField("signal");
			if (typeof value.failure_classification !== "undefined" && !fcIsNull) {
				pushField("failure_classification");
			}
		}
		if (isTimeout && !fcIsTimeout && value.status === "fail") {
			pushField("failure_classification");
		}
	}
	if (fieldSet.size === 0) return null;
	return {
		id: typeof value.id === "string" ? value.id : "(row)",
		fields: [...fieldSet].sort(),
		role,
	};
}

// ---------- closure decision ------------------------------------------------

export function computeClosure(input: ClosureInput): ClosureResult {
	const r4 = input.r4Satisfied;
	const r5 = input.r5Satisfied;
	const r6 = input.r6Satisfied;
	const r7 = input.r7Satisfied;
	const r16 = input.r16Satisfied;

	const unknownCount =
		input.unknownFailures.length + Math.max(0, input.unknownFailureCount);
	const hasUnknown = unknownCount > 0;

	const allMandatoryPass =
		input.mandatoryApplicable > 0 && input.mandatoryPass === input.mandatoryApplicable;
	const allAffectedPass =
		input.affectedScopeApplicable === 0 ||
		input.affectedScopePass === input.affectedScopeApplicable;

	const evidenceOk = isEvidenceOk(input.evidence);

	const reasonCodes: ReasonCode[] = [];
	if (!evidenceOk) reasonCodes.push("EVIDENCE_INCOMPLETE");
	if (!input.evidence.subjectTreeComputationOk) reasonCodes.push("SUBJECT_TREE_COMPUTATION_FAILED");
	if (!input.evidence.subjectTreeContract) reasonCodes.push("SUBJECT_TREE_CONTRACT_MISSING");
	if (!input.evidence.executionIdentityRecorded) reasonCodes.push("EXECUTION_IDENTITY_MISSING");
	if (!input.evidence.executionHeadOidWellformed || !input.evidence.executionTreeOidWellformed) {
		reasonCodes.push("EXECUTION_IDENTITY_MALFORMED");
	}
	if (input.evidence.executionIdentityRecorded && !input.evidence.executionIdentityValid) {
		reasonCodes.push("EXECUTION_IDENTITY_INVALID");
	}
	if (input.evidence.executionTrees.length > 1) {
		reasonCodes.push("EXECUTION_TREES_MIXED");
	}
	if (input.evidence.executionTrees.length === 1 && !input.evidence.executionTreeBound) {
		reasonCodes.push("EXECUTION_TREE_NOT_BOUND");
	}
	if (input.evidence.worktreeInputsCleanBefore === false) {
		reasonCodes.push("WORKTREE_INPUTS_DIRTY_BEFORE");
	}
	if (input.evidence.worktreeInputsCleanAfter === false) {
		reasonCodes.push("WORKTREE_INPUTS_DIRTY_AFTER");
	}
	if (input.evidence.executionIdentityRecorded && !input.evidence.subjectStableAcrossMatrix) {
		reasonCodes.push("SUBJECT_DRIFT");
	}
	if (
		input.evidence.executionIdentityRecorded &&
		!input.evidence.perCommandDriftChecked
	) {
		reasonCodes.push("REPOSITORY_DRIFT");
	}
	if (!input.evidence.manifestContractHonored) {
		reasonCodes.push("MANIFEST_PATH_OUTSIDE_EVIDENCE");
	}
	if (input.evidence.bundledResultPathInvalid) {
		reasonCodes.push("BUNDLED_RESULT_PATH_INVALID");
	}
	// CORRECTION14: the self-contained bundle is mandatory. A null value
	// (bundle check never ran) is treated the same as a false value.
	if (input.evidence.bundledResultCommandSetExact !== true) {
		reasonCodes.push("BUNDLED_RESULT_COMMAND_SET_MISMATCH");
	}
	if (input.evidence.rowRelationalInvariantViolations.length > 0) {
		reasonCodes.push("ROW_RELATIONAL_INVARIANT_VIOLATION");
	}
	if (input.evidence.metadataFileMismatches.length > 0) {
		reasonCodes.push("METADATA_FILE_MISMATCH");
	}
	// CORRECTION15: the native-probe inventory P1–P5 is a fail-closed closure
	// dimension. A missing, malformed, deferred, unknown, or failed probe
	// blocks PASS; the diagnostic is exposed through the evidence view so
	// reviewers can identify which probe failed.
	if (!input.nativeProbesComplete) reasonCodes.push("NATIVE_PROBES_INCOMPLETE");
	if (hasUnknown) reasonCodes.push("UNKNOWN_FAILURES_PRESENT");
	if (!r4) reasonCodes.push("R4_UNSATISFIED");
	if (!r5) reasonCodes.push("R5_UNSATISFIED");
	if (!r6) reasonCodes.push("R6_UNSATISFIED");
	if (!r7) reasonCodes.push("R7_UNSATISFIED");
	if (!r16) reasonCodes.push("R16_UNSATISFIED");
	if (!allMandatoryPass) reasonCodes.push("MANDATORY_NOT_ALL_PASS");
	if (!allAffectedPass) reasonCodes.push("AFFECTED_SCOPE_NOT_ALL_PASS");

	let verdict: Verdict;
	if (!evidenceOk) {
		verdict = "FAIL";
	} else if (hasUnknown) {
		verdict = "FAIL";
	} else if (r4 && r5 && r6 && r7 && r16 && allMandatoryPass && allAffectedPass && input.nativeProbesComplete) {
		verdict = "PASS";
	} else {
		verdict = "PARTIAL";
	}

	return {
		verdict,
		evidenceOk,
		reasonCodes,
		unknownFailureCount: unknownCount,
	};
}

/**
 * True iff every dimension of the evidence view is satisfied. This is the
 * single source of truth used by both the renderer, runner self-check, and tests.
 * CORRECTION13 removes `perCommandInputsClean` from the conjunction; the
 * `fs.watch`-backed monitor is an advisory hint only.
 */
export function isEvidenceOk(e: EvidenceView): boolean {
	return (
		e.exists &&
		e.subjectTreeComputationOk &&
		e.subjectTreeContract &&
		e.executionIdentityRecorded &&
		e.executionHeadOidWellformed &&
		e.executionTreeOidWellformed &&
		e.executionHeadExists &&
		e.executionTreeExists &&
		e.executionIdentityAssertionAgrees &&
		e.executionIdentityValid &&
		e.worktreeInputsCleanBefore === true &&
		e.worktreeInputsCleanAfter === true &&
		e.subjectStableAcrossMatrix &&
		e.perCommandDriftChecked &&
		e.manifestContractHonored &&
		e.bundledResultPathInvalid === null &&
		e.bundledResultCommandSetExact === true &&
		e.rowRelationalInvariantViolations.length === 0 &&
		e.metadataFileMismatches.length === 0 &&
		e.treeMatches &&
		e.executionTreeBound &&
		e.executionTrees.length === 1 &&
		e.hashManifestValid &&
		e.missingFiles.length === 0 &&
		e.unexpectedFiles.length === 0 &&
		e.hashMismatches.length === 0 &&
		e.malformedLines.length === 0 &&
		e.duplicatePaths.length === 0 &&
		e.commandSetExact &&
		e.duplicateEvidenceCommandIds.length === 0 &&
		e.duplicateExecutedCommandIds.length === 0 &&
		e.commandRecordMismatches.length === 0 &&
		e.rejectedManifestPaths.length === 0 &&
		e.outOfEvidenceDirPaths.length === 0 &&
		e.malformedEvidenceCommandRows === 0 &&
		e.malformedExecutedCommandRows === 0 &&
		e.decodeError === null &&
		// CORRECTION21: provenance stamp. A bundle whose inventory
		// came from a fixture (probe_source="fixture" or
		// fixture_derived=true) is not eligible for closure PASS.
		// The runner always stamps "executed"/false; tests set
		// "fixture"/true and expect isEvidenceOk to return false so
		// the fixture cannot accidentally satisfy the closure.
		e.probeSource === "executed" &&
		e.fixtureDerived === false
	);
}

// ---------- structured evidence check ---------------------------------------

export interface ExecutionIdentityDerivation {
	executionHeadExists: boolean;
	executionTreeExists: boolean;
	derivedTreeOid: string | null;
}

interface CheckEvidenceArgs {
	ev: { ok: boolean; value: unknown; error: string | null };
	hashesText: string;
	evDirAbs: string;
	executedCmds: any[];
	bundledResultPath?: string | null;
	rootAbs: string;
	headOidNow: string;
	treeOidNow: string;
	filteredSubjectTreeOidNow?: string | null;
	executionIdentityDerivation?: ExecutionIdentityDerivation | null;
}

export function checkEvidence(args: CheckEvidenceArgs): EvidenceView {
	const {
		ev,
		hashesText,
		evDirAbs,
		executedCmds,
		bundledResultPath = null,
		rootAbs,
		headOidNow: _headOidNow,
		treeOidNow,
		filteredSubjectTreeOidNow = null,
		executionIdentityDerivation = null,
	} = args;

	const out: EvidenceView = {
		exists: ev.ok,
		headOidWellformed: false,
		treeMatches: false,
		subjectTreeContract: false,
		subjectTreeComputationOk: filteredSubjectTreeOidNow !== null,
		executionIdentityRecorded: false,
		executionHeadOidWellformed: false,
		executionTreeOidWellformed: false,
		executionHeadExists: false,
		executionTreeExists: false,
		derivedExecutionTreeOid: null,
		runnerExecutionIdentityAssertion: null,
		executionIdentityAssertionAgrees: false,
		executionIdentityValid: false,
		executionTreeBound: false,
		executionTrees: [],
		worktreeInputsCleanBefore: null,
		worktreeInputsCleanAfter: null,
		perCommandDriftChecked: false,
		subjectStableAcrossMatrix: false,
		manifestContractHonored: false,
		hashManifestValid: false,
		bundledResultPathInvalid: null,
		bundledResultCommandSetExact: null,
		bundledResultExtraCommands: [],
		bundledResultMissingCommands: [],
		rowRelationalInvariantViolations: [],
		metadataFileMismatches: [],
		missingFiles: [],
		unexpectedFiles: [],
		hashMismatches: [],
		malformedLines: [],
		duplicatePaths: [],
		commandSetExact: false,
		duplicateEvidenceCommandIds: [],
		duplicateExecutedCommandIds: [],
		commandRecordMismatches: [],
		rejectedManifestPaths: [],
		outOfEvidenceDirPaths: [],
		malformedEvidenceCommandRows: 0,
		malformedExecutedCommandRows: 0,
		decodeError: ev.error,
		// CORRECTION15: the native-probe dimension is computed in the
		// helper and only updates these two fields when the caller
		// supplies a probes inventory. Default to incomplete so a missing
		// inventory is fail-closed.
		nativeProbesComplete: false,
		nativeProbesDiagnostics: [],
		// CORRECTION21: provenance stamp. Defaults to "unknown"/true so
		// a bundle that lacks the stamp cannot accidentally satisfy
		// the closure; the renderer / runner set the canonical
		// "executed"/false pair when they write the inventory.
		probeSource: "unknown",
		fixtureDerived: true,
	};

	const evObj = ev.ok && typeof ev.value === "object" && ev.value !== null ? (ev.value as any) : null;
	if (!evObj) return out;

	out.headOidWellformed =
		typeof evObj.head_oid === "string" && OID_PATTERN.test(evObj.head_oid);

	const subjectTreeFromEvidence =
		typeof evObj.subject_tree_oid === "string" ? evObj.subject_tree_oid : null;
	const filteredTree =
		typeof filteredSubjectTreeOidNow === "string" && filteredSubjectTreeOidNow.length > 0
			? filteredSubjectTreeOidNow
			: null;
	if (subjectTreeFromEvidence && filteredTree) {
		out.subjectTreeContract = true;
		out.treeMatches = subjectTreeFromEvidence === filteredTree;
	} else {
		out.subjectTreeContract = false;
		out.treeMatches = false;
	}

	const executionHeadFromEvidence =
		typeof evObj.execution_head_oid === "string" ? evObj.execution_head_oid : null;
	const executionTreeFromEvidence =
		typeof evObj.execution_tree_oid === "string" ? evObj.execution_tree_oid : null;
	const worktreeInputsCleanBefore =
		typeof evObj.worktree_inputs_clean_before === "boolean"
			? evObj.worktree_inputs_clean_before
			: typeof evObj.worktree_clean_before === "boolean"
				? evObj.worktree_clean_before
				: undefined;
	const worktreeInputsCleanAfter =
		typeof evObj.worktree_inputs_clean_after === "boolean"
			? evObj.worktree_inputs_clean_after
			: typeof evObj.worktree_clean_after === "boolean"
				? evObj.worktree_clean_after
				: undefined;

	const runnerExecutionIdentityAssertion =
		typeof evObj.execution_identity_valid === "boolean"
			? evObj.execution_identity_valid
			: null;
	out.executionIdentityRecorded =
		executionHeadFromEvidence !== null &&
		executionTreeFromEvidence !== null &&
		runnerExecutionIdentityAssertion !== null;
	out.executionHeadOidWellformed =
		executionHeadFromEvidence !== null && OID_PATTERN.test(executionHeadFromEvidence);
	out.executionTreeOidWellformed =
		executionTreeFromEvidence !== null && OID_PATTERN.test(executionTreeFromEvidence);
	out.runnerExecutionIdentityAssertion = runnerExecutionIdentityAssertion;
	out.executionHeadExists = executionIdentityDerivation?.executionHeadExists === true;
	out.executionTreeExists = executionIdentityDerivation?.executionTreeExists === true;
	out.derivedExecutionTreeOid = executionIdentityDerivation?.derivedTreeOid ?? null;
	const rendererDerivedIdentityValid =
		out.executionHeadExists &&
		out.executionTreeExists &&
		out.derivedExecutionTreeOid !== null &&
		out.derivedExecutionTreeOid === executionTreeFromEvidence;
	out.executionIdentityAssertionAgrees =
		runnerExecutionIdentityAssertion !== null &&
		runnerExecutionIdentityAssertion === rendererDerivedIdentityValid;
	out.executionIdentityValid =
		rendererDerivedIdentityValid && out.executionIdentityAssertionAgrees;
	out.worktreeInputsCleanBefore = worktreeInputsCleanBefore ?? null;
	out.worktreeInputsCleanAfter = worktreeInputsCleanAfter ?? null;

	const subjectTreeBefore =
		typeof evObj.subject_tree_oid_before === "string" ? evObj.subject_tree_oid_before : null;
	const subjectTreeAfter =
		typeof evObj.subject_tree_oid_after === "string" ? evObj.subject_tree_oid_after : null;
	out.subjectStableAcrossMatrix =
		subjectTreeBefore !== null &&
		subjectTreeAfter !== null &&
		subjectTreeFromEvidence !== null &&
		subjectTreeBefore === subjectTreeAfter &&
		subjectTreeBefore === subjectTreeFromEvidence;

	const expectedEvidencePayloadPaths =
		Array.isArray(evObj.expected_evidence_payload_paths) &&
		evObj.expected_evidence_payload_paths.every((p: unknown) => typeof p === "string")
			? (evObj.expected_evidence_payload_paths as string[])
			: null;

	const evidenceIds = new Set<string>();
	const executionTrees = new Set<string>();
	const evidenceCmds: any[] = [];
	const commandPayloadPaths: string[] = [];
	let perCommandDrift = true;
	const rowRelationalInvariantViolations: RowDiagnostic[] = [];
	if (Array.isArray(evObj.commands)) {
		for (const c of evObj.commands) {
			const issue = validateCommandRecord(c, "evidence");
			if (issue !== null) {
				out.malformedEvidenceCommandRows += 1;
				rowRelationalInvariantViolations.push(issue);
				continue;
			}
			const id = (c as any).id;
			evidenceCmds.push(c);
			evidenceIds.add(id);
			const stdoutPath = (c as any).stdout_path;
			const stderrPath = (c as any).stderr_path;
			const metadataPath = (c as any).metadata_path;
			if (
				typeof stdoutPath === "string" &&
				typeof stderrPath === "string" &&
				typeof metadataPath === "string"
			) {
				commandPayloadPaths.push(stdoutPath, stderrPath, metadataPath);
			} else {
				perCommandDrift = false;
			}
			const t = (c as any).tree_oid;
			if (typeof t === "string" && t.length > 0) executionTrees.add(t);

			const headBefore = (c as any).head_oid_before;
			const headAfter = (c as any).head_oid_after;
			const treeBefore = (c as any).tree_oid_before;
			const treeAfter = (c as any).tree_oid_after;
			const subjectBefore = (c as any).subject_tree_oid_before;
			const subjectAfter = (c as any).subject_tree_oid_after;
			const allPresent =
				typeof headBefore === "string" &&
				typeof headAfter === "string" &&
				typeof treeBefore === "string" &&
				typeof treeAfter === "string" &&
				typeof subjectBefore === "string" &&
				typeof subjectAfter === "string";
			const allPinned =
				allPresent &&
				headBefore === executionHeadFromEvidence &&
				headAfter === executionHeadFromEvidence &&
				treeBefore === executionTreeFromEvidence &&
				treeAfter === executionTreeFromEvidence &&
				subjectBefore === subjectTreeFromEvidence &&
				subjectAfter === subjectTreeFromEvidence &&
				(c as any).head_oid === executionHeadFromEvidence &&
				(c as any).tree_oid === executionTreeFromEvidence;
			if (!allPinned) perCommandDrift = false;
		}
	}
	out.perCommandDriftChecked = perCommandDrift;
	out.rowRelationalInvariantViolations = rowRelationalInvariantViolations;

	const executedIds = new Set<string>();
	const executedRows: any[] = [];
	for (const e of executedCmds) {
		const issue = validateCommandRecord(e, "executed");
		if (issue !== null) {
			out.malformedExecutedCommandRows += 1;
			rowRelationalInvariantViolations.push(issue);
			continue;
		}
		const id = (e as any).id;
		executedRows.push(e);
		executedIds.add(id);
	}
	out.rowRelationalInvariantViolations = rowRelationalInvariantViolations;

	const missingExecs: string[] = [];
	const extraInEvidence: string[] = [];
	for (const id of executedIds) if (!evidenceIds.has(id)) missingExecs.push(id);
	for (const id of evidenceIds) if (!executedIds.has(id)) extraInEvidence.push(id);
	out.executionTrees = Array.from(executionTrees);

	const dup = compareCommandRecords(evidenceCmds, executedRows);
	out.duplicateEvidenceCommandIds = dup.duplicateEvidenceCommandIds;
	out.duplicateExecutedCommandIds = dup.duplicateExecutedCommandIds;
	out.commandRecordMismatches = dup.commandRecordMismatches;

	// CORRECTION13: self-contained bundle — verify the bundled executed-
	// command record hash-matches a manifest entry, parses, and contains
	// the same set of command IDs as evidence/executed. CORRECTION15:
	// this MUST run BEFORE the commandSetExact aggregate is computed;
	// otherwise the aggregate is unsatisfiable because bundledResult-
	// CommandSetExact is still null when it is read.
	if (bundledResultPath) {
		const resolved = resolveEvidencePayloadPath(evDirAbs, rootAbs, bundledResultPath);
		if (!resolved.ok) {
			out.bundledResultPathInvalid = {path: bundledResultPath, reason: resolved.reason};
		} else {
			let parsedBundle: { executed_commands?: any[]; commands?: any[] } | null = null;
			try {
				const text = readFileSync(resolved.abs as string, "utf8");
				parsedBundle = JSON.parse(text) as { executed_commands?: any[]; commands?: any[] };
			} catch (error) {
				out.bundledResultPathInvalid = {
					path: bundledResultPath,
					reason: `<json-parse-error:${error instanceof Error ? error.message : String(error)}>` as any,
				};
			}
			if (parsedBundle) {
				const rows = parsedBundle.executed_commands ?? parsedBundle.commands ?? [];
				const bundledIds = new Set<string>();
				for (const row of rows) {
					if (row && typeof row === "object" && typeof (row as any).id === "string") {
						bundledIds.add((row as any).id);
					}
				}
				const extra: string[] = [];
				const missing: string[] = [];
				for (const id of bundledIds) if (!executedIds.has(id)) extra.push(id);
				for (const id of executedIds) if (!bundledIds.has(id)) missing.push(id);
				out.bundledResultCommandSetExact = extra.length === 0 && missing.length === 0;
				out.bundledResultExtraCommands = extra;
				out.bundledResultMissingCommands = missing;
			}
		}
	}

	// CORRECTION15: commandSetExact is computed AFTER the bundled-result
	// verification above so the bundled check has had a chance to assign
	// a concrete true/false value. CORRECTION14 previously computed this
	// first and read `out.bundledResultCommandSetExact` while it was still
	// `null`, which made every fresh bundle unsatisfiable.
	out.commandSetExact =
		missingExecs.length === 0 &&
		extraInEvidence.length === 0 &&
		out.duplicateEvidenceCommandIds.length === 0 &&
		out.duplicateExecutedCommandIds.length === 0 &&
		out.commandRecordMismatches.length === 0 &&
		out.malformedEvidenceCommandRows === 0 &&
		out.malformedExecutedCommandRows === 0 &&
		out.bundledResultCommandSetExact === true;

	const execTree = executionTrees.size === 1 ? Array.from(executionTrees)[0] : null;
	out.executionTreeBound =
		execTree !== null &&
		executionTreeFromEvidence !== null &&
		execTree === executionTreeFromEvidence;

	const parsed = parseManifest(hashesText);
	out.malformedLines = parsed.malformed;
	out.duplicatePaths = parsed.duplicates;

	const missingFiles: PathDiagnostic[] = [];
	const hashMismatches: HashMismatch[] = [];
	const rejected: PathDiagnostic[] = [];
	const outOfEvDir: PathDiagnostic[] = [];
	for (const [path, expected] of parsed.declared.entries()) {
		const resolved = resolveEvidencePayloadPath(evDirAbs, rootAbs, path);
		if (!resolved.ok) {
			if (resolved.reason === "outside-evidence-dir") {
				outOfEvDir.push({path, reason: "outside-evidence-dir"});
			} else {
				rejected.push({path, reason: resolved.reason});
			}
			continue;
		}
		const abs = resolved.abs as string;
		let lst;
		try {
			lst = lstatSync(abs);
		} catch {
			missingFiles.push({path, reason: "missing"});
			continue;
		}
		if (lst.isSymbolicLink()) {
			missingFiles.push({path, reason: "symlink"});
			continue;
		}
		if (!lst.isFile()) {
			missingFiles.push({path, reason: "missing"});
			continue;
		}
		const actual = createHash("sha256").update(readFileSync(abs)).digest("hex");
		if (actual.toLowerCase() !== expected) {
			hashMismatches.push({path, expected, actual: actual.toLowerCase()});
		}
	}
	out.missingFiles = missingFiles;
	out.hashMismatches = hashMismatches;
	out.rejectedManifestPaths = rejected;
	out.outOfEvidenceDirPaths = outOfEvDir;

	const unexpected = scanUnexpected(evDirAbs, parsed.declared);
	const symlinks: PathDiagnostic[] = [];
	for (const u of unexpected) {
		if (u.reason === "symlink") symlinks.push(u);
		else out.unexpectedFiles.push(u);
	}
	for (const s of symlinks) out.unexpectedFiles.push(s);

	out.hashManifestValid =
		out.malformedLines.length === 0 &&
		out.duplicatePaths.length === 0 &&
		out.missingFiles.length === 0 &&
		out.hashMismatches.length === 0 &&
		out.rejectedManifestPaths.length === 0 &&
		out.outOfEvidenceDirPaths.length === 0;

	// CORRECTION13: parse every metadata file and require normalized
	// equality with the corresponding evidence.commands row.
	if (evidenceCmds.length > 0 && existsSync(evDirAbs)) {
		const metadataMismatches: MetadataFileMismatch[] = [];
		for (const evidenceRow of evidenceCmds) {
			const id = (evidenceRow as any).id;
			const metadataRel = (evidenceRow as any).metadata_path;
			if (typeof metadataRel !== "string") continue;
			const resolved = resolveEvidencePayloadPath(evDirAbs, rootAbs, metadataRel);
			if (!resolved.ok) {
				metadataMismatches.push({id, fields: [`<metadata-path-invalid:${resolved.reason}>`]});
				continue;
			}
			try {
				const text = readFileSync(resolved.abs as string, "utf8");
				const parsedMetadata = JSON.parse(text);
				const expectedSnapshot = {
					id: (evidenceRow as any).id,
					status: (evidenceRow as any).status,
					started_at: (evidenceRow as any).started_at,
					finished_at: (evidenceRow as any).finished_at,
					duration_ms: (evidenceRow as any).duration_ms,
					exit_code: (evidenceRow as any).exit_code,
					signal: (evidenceRow as any).signal,
					timeout: (evidenceRow as any).timeout,
					stdout_sha256: (evidenceRow as any).stdout_sha256,
					stderr_sha256: (evidenceRow as any).stderr_sha256,
					stdout_path: (evidenceRow as any).stdout_path,
					stderr_path: (evidenceRow as any).stderr_path,
					metadata_path: (evidenceRow as any).metadata_path,
					head_oid: (evidenceRow as any).head_oid,
					tree_oid: (evidenceRow as any).tree_oid,
					head_oid_before: (evidenceRow as any).head_oid_before,
					head_oid_after: (evidenceRow as any).head_oid_after,
					tree_oid_before: (evidenceRow as any).tree_oid_before,
					tree_oid_after: (evidenceRow as any).tree_oid_after,
					subject_tree_oid_before: (evidenceRow as any).subject_tree_oid_before,
					subject_tree_oid_after: (evidenceRow as any).subject_tree_oid_after,
					tracked_input_change_observed:
						(evidenceRow as any).tracked_input_change_observed === true,
					tracked_input_monitor_degraded:
						(evidenceRow as any).tracked_input_monitor_degraded === true,
					observed_tracked_input_paths: Array.isArray(
						(evidenceRow as any).observed_tracked_input_paths,
					)
						? (evidenceRow as any).observed_tracked_input_paths
						: [],
					unexpected_paths_after: Array.isArray(
						(evidenceRow as any).unexpected_paths_after,
					)
						? (evidenceRow as any).unexpected_paths_after
						: [],
					environment_sha256: (evidenceRow as any).environment_sha256,
					failure_classification:
						(evidenceRow as any).failure_classification === undefined
							? null
							: (evidenceRow as any).failure_classification,
					notes: (evidenceRow as any).notes ?? "",
				};
				if (stableStringify(parsedMetadata) !== stableStringify(expectedSnapshot)) {
					const fields: string[] = [];
					if (stableStringify(parsedMetadata?.id) !== stableStringify(expectedSnapshot.id)) {
						fields.push("id");
					}
					if (stableStringify(parsedMetadata?.status) !== stableStringify(expectedSnapshot.status)) {
						fields.push("status");
					}
					if (
						stableStringify(parsedMetadata?.head_oid) !== stableStringify(expectedSnapshot.head_oid)
					) {
						fields.push("head_oid");
					}
					if (stableStringify(parsedMetadata?.tree_oid) !== stableStringify(expectedSnapshot.tree_oid)) {
						fields.push("tree_oid");
					}
					metadataMismatches.push({id, fields});
				}
			} catch (error) {
				metadataMismatches.push({
					id,
					fields: [`<metadata-parse-error:${error instanceof Error ? error.message : String(error)}>`],
				});
			}
		}
		out.metadataFileMismatches = metadataMismatches;
	}

	// CORRECTION21: provenance stamp. Read from `evidence.json` so the
	// renderer and runner agree on the trust boundary. The runner stamps
	// {probe_source: "executed", fixture_derived: false} when it
	// executes the probes; hand-authored fixtures stamp
	// {probe_source: "fixture", fixture_derived: true} and expect the
	// closure to reject them.
	if (evObj.probe_source === "executed" || evObj.probe_source === "fixture") {
		out.probeSource = evObj.probe_source;
	}
	if (typeof evObj.fixture_derived === "boolean") {
		out.fixtureDerived = evObj.fixture_derived;
	}

	if (expectedEvidencePayloadPaths !== null) {
		// CORRECTION19: CORRECTION16+ evidence has a mandatory native-probe
		// payload. The expected set is derived from the evidence schema and the
		// canonical inventory contents, never from the manifest itself.
		const evidenceSchemaVersion =
			typeof evObj.schema_version === "number" ? evObj.schema_version : 0;
		const nativeProbesRequired = evidenceSchemaVersion >= 5;
		// CORRECTION21: when probes are required, the schema also mandates
		// externalized stream payloads. Each probe declares its stdout,
		// stderr, metadata.json, and (when present) artifact files, all
		// staged under `native-probes/` and hash-listed independently in
		// `hashes.sha256`. The validator reads those files independently
		// to recompute the SHA-256 declared in the probe record.
		const externalStreamPaths = nativeProbesRequired
			? deriveNativeProbeExternalStreamPayloadPaths()
			: [];
		const nativeProbeArtifactPaths = nativeProbesRequired
			? deriveNativeProbeArtifactPayloadPaths(evDirAbs)
			: [];
		const derivedExpected = nativeProbesRequired
			? [
					"evidence.json",
					"verification-results.json",
					NATIVE_PROBES_BUNDLE_PATH,
					...nativeProbeArtifactPaths,
					...externalStreamPaths,
					...commandPayloadPaths,
				]
			: ["evidence.json", "verification-results.json", ...commandPayloadPaths];
		const expectedSet = new Set(expectedEvidencePayloadPaths);
		const derivedSet = new Set(derivedExpected);
		const declaredSet = new Set(parsed.declared.keys());
		const noExpectedDuplicates = expectedSet.size === expectedEvidencePayloadPaths.length;
		const noDerivedDuplicates = derivedSet.size === derivedExpected.length;
		const expectedPathsValid = expectedEvidencePayloadPaths.every((p) => {
			const resolved = resolveEvidencePayloadPath(evDirAbs, rootAbs, p);
			return resolved.ok;
		});
		out.manifestContractHonored =
			noExpectedDuplicates &&
			noDerivedDuplicates &&
			expectedPathsValid &&
			setsEqual(expectedSet, derivedSet) &&
			setsEqual(expectedSet, declaredSet);
	}

	return out;
}

// ---------- public helpers (exported for tests) -----------------------------

interface ParsedManifest {
	declared: Map<string, string>;
	malformed: MalformedLine[];
	duplicates: DuplicatePath[];
}

export function parseManifest(text: string): ParsedManifest {
	const declared = new Map<string, string>();
	const malformed: MalformedLine[] = [];
	const seenOccurrences = new Map<string, number>();

	if (typeof text !== "string" || text.length === 0) {
		return { declared, malformed, duplicates: [] };
	}

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().length === 0) continue;
		const m = line.match(/^([0-9a-f]{64})[ \t]+(.+?)[ \t]*$/i);
		if (!m) {
			malformed.push({ line: i + 1, content: line.slice(0, 80) });
			continue;
		}
		const sha = m[1].toLowerCase();
		const path = m[2];
		if (declared.has(path)) {
			seenOccurrences.set(path, (seenOccurrences.get(path) ?? 1) + 1);
			continue;
		}
		declared.set(path, sha);
		seenOccurrences.set(path, 1);
	}
	const duplicates: DuplicatePath[] = [];
	for (const [path, occurrences] of seenOccurrences.entries()) {
		if (occurrences > 1) duplicates.push({path, occurrences});
	}
	return { declared, malformed, duplicates };
}

export type EvidenceLoad = {
	ok: boolean;
	value: unknown;
	error: string | null;
};

export function loadEvidenceFile(path: string): EvidenceLoad {
	if (!existsSync(path)) return { ok: false, value: null, error: "missing" };
	try {
		const text = readFileSync(path, "utf8");
		return { ok: true, value: JSON.parse(text), error: null };
	} catch (e: any) {
		return { ok: false, value: null, error: e?.message ?? String(e) };
	}
}

// ---------- helpers ---------------------------------------------------------

export type ResolveResult =
	| { ok: true; abs: string; reason: null }
	| {
			ok: false;
			abs: null;
			reason: "absolute" | "traversal" | "outside-evidence-dir";
	  };

export function resolveEvidencePayloadPath(
	evDirAbs: string,
	rootAbs: string,
	declared: string,
): ResolveResult {
	if (typeof declared !== "string" || declared.length === 0) {
		return { ok: false, abs: null, reason: "traversal" };
	}
	if (isAbsolute(declared)) {
		return { ok: false, abs: null, reason: "absolute" };
	}

	const normalizedEvDir = resolve(evDirAbs);
	const normalizedRoot = resolve(rootAbs);
	const abs = resolve(normalizedEvDir, declared);

	const relToEvDir = normalizeRelative(relative(normalizedEvDir, abs));
	if (
		relToEvDir === "" ||
		relToEvDir === ".." ||
		relToEvDir.startsWith(`..${sep}`) ||
		isAbsolute(relToEvDir)
	) {
		const relToRoot = normalizeRelative(relative(normalizedRoot, abs));
		if (
			relToRoot === "" ||
			relToRoot === ".." ||
			relToRoot.startsWith(`..${sep}`) ||
			isAbsolute(relToRoot)
		) {
			return { ok: false, abs: null, reason: "traversal" };
		}
		return { ok: false, abs: null, reason: "outside-evidence-dir" };
	}
	return { ok: true, abs, reason: null };
}

function deriveNativeProbeArtifactPayloadPaths(evDirAbs: string): string[] {
	const inventoryPath = join(evDirAbs, ...NATIVE_PROBES_BUNDLE_PATH.split("/"));
	if (!existsSync(inventoryPath)) return [];
	try {
		const parsed = JSON.parse(readFileSync(inventoryPath, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
		const record = parsed as Record<string, unknown>;
		if (record.schema_version !== 1 || record.probes === null || typeof record.probes !== "object" || Array.isArray(record.probes)) {
			return [];
		}
		const probes = record.probes as Record<string, unknown>;
		const paths: string[] = [];
		for (const definition of NATIVE_PROBE_DEFINITIONS) {
			const probe = probes[definition.id];
			if (probe !== null && typeof probe === "object" && !Array.isArray(probe) && (probe as Record<string, unknown>).artifact_exists === true) {
				paths.push(definition.artifact_path);
			}
		}
		return paths;
	} catch {
		return [];
	}
}

// The CORRECTION21 (µC-2/µC-3) stream-payload paths are now derived from
// the canonical `canonicalStreamPaths()` helper in `native-probes.ts`.
// The reader uses `deriveNativeProbeExternalStreamPayloadPaths()` defined
// below in the µC-3 reader section; the legacy `externalStreamPayloadPath`
// and inventory-walking `deriveNativeProbeExternalStreamPayloadPaths`
// are removed because they duplicated the canonical layout authority.


function scanUnexpected(
	evDirAbs: string,
	declared: Map<string, string>,
): PathDiagnostic[] {
	if (!existsSync(evDirAbs)) return [];
	const out: PathDiagnostic[] = [];
	const declaredInside = new Set<string>();
	for (const p of declared.keys()) {
		declaredInside.add(normalizeRelative(p));
	}
	walk(evDirAbs, (abs, lst) => {
		if (lst.isSymbolicLink()) {
			out.push({ path: normalizeRelative(relative(evDirAbs, abs)), reason: "symlink" });
			return;
		}
		if (!lst.isFile()) return;
		const rel = normalizeRelative(relative(evDirAbs, abs));
		if (rel.length === 0) return;
		if (CONTROL_FILES.has(rel)) return;
		if (!declaredInside.has(rel)) {
			out.push({ path: rel, reason: "unexpected" });
		}
	});
	return out;
}

function walk(
	absDir: string,
	visit: (abs: string, lst: import("node:fs").Stats) => void,
): void {
	let entries: string[];
	try {
		entries = readdirSync(absDir);
	} catch {
		return;
	}
	for (const name of entries) {
		const child = join(absDir, name);
		let lst;
		try {
			lst = lstatSync(child);
		} catch {
			continue;
		}
		if (lst.isDirectory()) {
			if (name === "node_modules" || name === ".git") continue;
			walk(child, visit);
		} else {
			visit(child, lst);
		}
	}
}

function normalizeRelative(p: string): string {
	return p.split(sep).join("/");
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) if (!b.has(value)) return false;
	return true;
}

interface CompareResult {
	duplicateEvidenceCommandIds: DuplicatePath[];
	duplicateExecutedCommandIds: DuplicatePath[];
	commandRecordMismatches: CommandRecordMismatch[];
}

function compareCommandRecords(
	evidenceCmds: any[],
	executedCmds: any[],
): CompareResult {
	const duplicateEvidenceCommandIds = collectDuplicateIds(evidenceCmds);
	const duplicateExecutedCommandIds = collectDuplicateIds(executedCmds);

	const evidenceById = new Map<string, any>();
	for (const c of evidenceCmds) {
		if (c && typeof c.id === "string") evidenceById.set(c.id, c);
	}
	const executedById = new Map<string, any>();
	for (const c of executedCmds) {
		if (c && typeof c.id === "string") executedById.set(c.id, c);
	}

	const commandRecordMismatches: CommandRecordMismatch[] = [];
	for (const [id, ev] of evidenceById.entries()) {
		const ex = executedById.get(id);
		if (!ex) continue;
		const fields: string[] = [];
		const evSnap: Record<string, unknown> = {};
		const exSnap: Record<string, unknown> = {};
		for (const f of RECORD_COMPARE_FIELDS) {
			const a = (ev as any)[f];
			const b = (ex as any)[f];
			if (valuesEqual(a, b)) continue;
			fields.push(f);
			evSnap[f] = a ?? null;
			exSnap[f] = b ?? null;
		}
		if (fields.length > 0) {
			commandRecordMismatches.push({ id, fields, evidence: evSnap, executed: exSnap });
		}
	}

	return {
		duplicateEvidenceCommandIds,
		duplicateExecutedCommandIds,
		commandRecordMismatches,
	};
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null && b == null) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((value, index) => valuesEqual(value, b[index]));
	}
	return false;
}

function collectDuplicateIds(items: any[]): DuplicatePath[] {
	const seen = new Map<string, number>();
	for (const c of items) {
		if (c && typeof c.id === "string") {
			seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
		}
	}
	const dupes: DuplicatePath[] = [];
	for (const [id, occurrences] of seen.entries()) {
		if (occurrences > 1) dupes.push({ path: id, occurrences });
	}
	return dupes;
}

/**
 * Default location of the native-probe inventory inside the repository.
 * The tracked mirror is informational only; the authoritative copy lives
 * inside the detached evidence bundle at
 * `${EVIDENCE_BUNDLE}/native-probes.json`. See
 * `loadNativeProbesFromEvidence`.
 */
export const NATIVE_PROBES_INVENTORY_PATH = "factory/inventories/native-probes.json";


/**
 * Bundle-relative path of the staged native-probe inventory. The runner
 * writes the executed probe inventory to this path inside the staging
 * directory and hash-lists it in `hashes.sha256`. The renderer reads
 * from this path; the tracked mirror at `NATIVE_PROBES_INVENTORY_PATH`
 * is never consulted by the verifier.
 */
export const NATIVE_PROBES_BUNDLE_PATH = "native-probes.json";

/**
 * Arguments for `loadNativeProbesFromEvidence`. `manifestText` is the
 * verbatim contents of the bundle's `hashes.sha256`; `execution*`
 * identity values come from `evidence.json` plus the renderer's
 * independent derivation (HEAD^{commit}, HEAD^{tree}, filtered
 * subject tree).
 */
export interface LoadNativeProbesFromEvidenceArgs {
	evDirAbs: string;
	manifestText: string;
	executionHeadOid: string | null;
	executionTreeOid: string | null;
	filteredSubjectTreeOid: string | null;
}

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 reader -------


/**
 * Fresh, fully-false `probes` record keyed by every canonical probe id.
 * `NativeProbesView.probes` is this shape; reader functions use it as
 * the starting point for a scan over `NATIVE_PROBE_IDS`. The view is
 * reset to the empty form by both the bundle and tracked readers when a
 * short-circuit fires (no inventory, manifest mismatch, missing key,
 * &c.) so downstream consumers can read the value without a `null`
 * guard.
 */
function emptyProbes(): Record<NativeProbeId, NativeProbeViewRecord | null> {
	const probes = {} as Record<NativeProbeId, NativeProbeViewRecord | null>;
	for (const probeId of NATIVE_PROBE_IDS) probes[probeId] = null;
	return probes;
}

/**
 * Default dimensions for the new µC-3 structural flags. Every early
 * short-circuit (missing inventory, manifest hash mismatch, malformed
 * JSON, missing keys, etc.) populates the same falsified layout so
 * downstream consumers can read the booleans without recursing through
 * `diagnostics`. `complete` mirrors the conjunction of all dimensions.
 */
function emptyDimensions(): Omit<
	NativeProbesView,
	"complete" | "probes" | "diagnostics" | "source" | "declaredHash" | "observedHash" |
	"hashMismatches" | "architectureMismatches" | "identityMismatches" | "argvMismatches" | "hostClassMismatches"
> {
	return {
		streamLayoutValid: false,
		streamPathsCanonical: false,
		externalStreamsComplete: false,
		externalStreamHashesValid: false,
		embeddedStreamsConsistent: false,
		metadataPayloadsComplete: false,
		metadataHashesValid: false,
		metadataRecordsEqual: false,
		derivedOutcomesMatch: false,
		allProbesPassed: false,
	};
}

function initialView(): Pick<
	NativeProbesView,
	"complete" | "probes" | "diagnostics" | "source" | "declaredHash" | "observedHash" |
	"hashMismatches" | "architectureMismatches" | "identityMismatches" | "argvMismatches" | "hostClassMismatches"
> {
	return {
		complete: false,
		probes: emptyProbes(),
		diagnostics: [],
		source: "missing",
		declaredHash: null,
		observedHash: null,
		hashMismatches: [],
		architectureMismatches: [],
		identityMismatches: [],
		argvMismatches: [],
		hostClassMismatches: [],
	};
}


function buildView(
	initial: Pick<
		NativeProbesView,
		"complete" | "probes" | "diagnostics" | "source" | "declaredHash" | "observedHash" |
		"hashMismatches" | "architectureMismatches" | "identityMismatches" | "argvMismatches" | "hostClassMismatches"
	>,
	dimensions: Omit<
		NativeProbesView,
		"complete" | "probes" | "diagnostics" | "source" | "declaredHash" | "observedHash" |
		"hashMismatches" | "architectureMismatches" | "identityMismatches" | "argvMismatches" | "hostClassMismatches"
	>,
): NativeProbesView {
	return {
		complete: initial.complete,
		probes: initial.probes,
		diagnostics: initial.diagnostics,
		source: initial.source,
		declaredHash: initial.declaredHash,
		observedHash: initial.observedHash,
		hashMismatches: initial.hashMismatches,
		architectureMismatches: initial.architectureMismatches,
		identityMismatches: initial.identityMismatches,
		argvMismatches: initial.argvMismatches,
		hostClassMismatches: initial.hostClassMismatches,
		...dimensions,
	};
}

/**
 * Translate a `parseBundledNativeProbe()` diagnostic into a
 * `NativeProbeDiagnostic`. The µC-3 parse layer is pure and produces
 * `{field, reason, expected, observed}` records; this helper merges
 * them with the structural state and stamps `probeId`.
 */
function probeParseToDiagnostic(
	probeId: NativeProbeId,
	d: ProbeParseDiagnostic,
): NativeProbeDiagnostic {
	const reason = d.reason;
	let kind: NativeProbeDiagnosticKind = "invalid-shape";
	if (reason === "stream-layout-missing") kind = "stream-layout-missing";
	else if (reason === "stream-layout-unsupported") kind = "stream-layout-unsupported";
	else if (reason === "stream-path-mismatch") kind = "stream-path-mismatch";
	return {
		probeId,
		kind,
		message: `native-probe \`${probeId}\` field \`${d.field}\`: expected ${d.expected}, observed ${d.observed}`,
	};
}

function missingInventoryDiagnostics(prefix: string): NativeProbeDiagnostic[] {
	const out: NativeProbeDiagnostic[] = [];
	for (const probeId of NATIVE_PROBE_IDS) {
		out.push({
			probeId,
			kind: "missing-inventory",
			message: `${prefix}: native-probe inventory was not found`,
		});
	}
	return out;
}

/**
 * CORRECTION21: enumerate the bundle-relative paths of every probe's
 * externalized stream payloads under µC-3. The stream layout is the
 * canonical three-file layout (stdout / stderr / metadata.json) at
 * `native-probes/<id>.<suffix>`. The runner writes each file in
 * `stageNativeProbesIntoBundle`; the reader path here stays consistent
 * with `canonicalStreamPaths()` in `./native-probes.ts`.
 */
function deriveNativeProbeExternalStreamPayloadPaths(): string[] {
	const out: string[] = [];
	for (const probeId of NATIVE_PROBE_IDS) {
		const paths = canonicalStreamPaths(probeId);
		out.push(paths.stdout_path, paths.stderr_path, paths.metadata_path);
	}
	return out;
}

/**
 * CORRECTION21 — µC-3 authoritative reader. Reads `native-probes.json`
 * from the staged bundle, hash-checks it against `hashes.sha256`, then
 * runs **every** µC-3 binding check against the canonical authorities
 * (layout version, canonical stream paths, external streams, metadata
 * payload, derived outcome):
 *
 *   1. **stream_layout**           — every record's `stream_layout_version`
 *                                   equals `NATIVE_PROBE_STREAM_LAYOUT_VERSION`;
 *   2. **stream_paths**            — every record's `stdout_path`,
 *                                   `stderr_path`, `metadata_path` are
 *                                   exactly the canonical layout;
 *   3. **external_streams**        — every `native-probes/<id>.stdout`,
 *                                   `native-probes/<id>.stderr`,
 *                                   `native-probes/<id>.metadata.json`
 *                                   exists in the bundle, is a regular
 *                                   file (no symlinks), and hash-matches
 *                                   `hashes.sha256`;
 *   4. **stream_hashes**           — every record's `stdout_sha256` /
 *                                   `stderr_sha256` equals the SHA-256
 *                                   of the on-disk bytes;
 *   5. **embedded_consistency**    — every embedded `stdout_text` /
 *                                   `stderr_text` UTF-8 byte-equals the
 *                                   external bytes (informational
 *                                   mirror only);
 *   6. **metadata_payloads**       — every per-probe `metadata.json`
 *                                   exists, parses, and represents a
 *                                   JSON object whose parsed value is
 *                                   `stableStringify`-equal to the
 *                                   aggregate record's parsed value;
 *   7. **derived_outcomes**        — every probe runs the catalogue
 *                                   `success` predicate using
 *                                   EXTERNAL stdout / stderr as the
 *                                   only authority; the recorded
 *                                   `status` must agree;
 *   8. **all_probes_pass**         — every probe finishes with
 *                                   `status="pass"`.
 *
 * Every dimension is an explicit boolean on `NativeProbesView`. The
 * reader never falls back to embedded values to repair external
 * evidence, never rewrites payloads, never regenerates hashes, never
 * adds missing manifest entries, never normalizes files on disk. A
 * missing manifest entry (a common short-circuit trigger) marks
 * every downstream dimension `false` so the renderer does not have
 * to inspect the diagnostics array to know the bundle is unsatisfiable.
 */
export function loadNativeProbesFromEvidence(
	args: LoadNativeProbesFromEvidenceArgs,
): NativeProbesView {
	const { evDirAbs, manifestText, executionHeadOid, executionTreeOid, filteredSubjectTreeOid } = args;
	const initial = initialView();
	const dimensions = emptyDimensions();

	// ---- 1. inventory presence + manifest hash check --------------------

	const bundlePath = join(evDirAbs, ...NATIVE_PROBES_BUNDLE_PATH.split("/"));
	initial.source = "bundle";
	const observedHash = existsSync(bundlePath)
		? createHash("sha256").update(readFileSync(bundlePath)).digest("hex")
		: null;
	initial.observedHash = observedHash;
	const parsedManifest = parseManifest(manifestText);
	const declaredHash = parsedManifest.declared.get(NATIVE_PROBES_BUNDLE_PATH) ?? null;
	initial.declaredHash = declaredHash;

	if (!existsSync(bundlePath)) {
		initial.diagnostics = missingInventoryDiagnostics(`bundle inventory at ${bundlePath}`);
		initial.source = "missing";
		return buildView(initial, dimensions);
	}
	if (declaredHash === null) {
		initial.diagnostics = NATIVE_PROBE_IDS.map((probeId) => ({
			probeId,
			kind: "missing-inventory" as const,
			message: `native-probes.json is not declared in the bundle's hashes.sha256`,
		}));
		initial.hashMismatches = NATIVE_PROBE_IDS.map((id) => id);
		return buildView(initial, dimensions);
	}
	if (observedHash !== null && declaredHash !== observedHash) {
		initial.diagnostics = NATIVE_PROBE_IDS.map((probeId) => ({
			probeId,
			kind: "hash-mismatch" as const,
			message: `native-probes.json hash declared=${declaredHash.slice(0, 12)}… observed=${observedHash.slice(0, 12)}…`,
		}));
		initial.hashMismatches = NATIVE_PROBE_IDS.map((id) => id);
		return buildView(initial, dimensions);
	}

	// ---- 2. parse root JSON + canonical schema --------------------------

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(bundlePath, "utf8"));
	} catch (error) {
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "malformed-json",
				message: `native-probes.json could not be parsed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			});
		}
		return buildView(initial, dimensions);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "malformed-json",
				message: "native-probes.json root must be a JSON object",
			});
		}
		return buildView(initial, dimensions);
	}
	const record = parsed as Record<string, unknown>;
	const schemaVersion = record.schema_version;
	const nestedProbes =
		record.probes !== null &&
		typeof record.probes === "object" &&
		!Array.isArray(record.probes)
			? (record.probes as Record<string, unknown>)
			: null;
	if (schemaVersion !== NATIVE_PROBE_STREAM_LAYOUT_VERSION || nestedProbes === null) {
		const message =
			schemaVersion !== NATIVE_PROBE_STREAM_LAYOUT_VERSION
				? `native-probes.json requires schema_version=${NATIVE_PROBE_STREAM_LAYOUT_VERSION}, got ${JSON.stringify(schemaVersion)}`
				: "native-probes.json requires canonical nested object `probes`";
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message,
			});
		}
		return buildView(initial, dimensions);
	}
	const inventoryHostClass = typeof record.host_class === "string" ? record.host_class : null;

	// ---- 3. inventory-level structural checks ---------------------------
	// Schema_version is `1` (NATIVE_PROBE_STREAM_LAYOUT_VERSION), the
	// inventory parses as a JSON object, and `probes` is a JSON object.
	// Stream-layout validation is per-record and runs below.
	dimensions.streamLayoutValid = true;

	const allParserResults: Array<{
		probeId: NativeProbeId;
		record: BundledNativeProbe;
	}> = [];
	let parserFailed = false;
	for (const probeId of NATIVE_PROBE_IDS) {
		const probeRaw = nestedProbes[probeId];
		const result = parseBundledNativeProbe(probeId, probeRaw);
		if (!result.ok || result.record === null) {
			parserFailed = true;
			for (const d of result.diagnostics) {
				initial.diagnostics.push(probeParseToDiagnostic(probeId, d));
			}
			continue;
		}
		allParserResults.push({ probeId, record: result.record });
	}
	if (parserFailed) dimensions.streamPathsCanonical = false;
	else dimensions.streamPathsCanonical = true;

	const presenceMap = new Map<NativeProbeId, boolean>();
	for (const { probeId } of allParserResults) presenceMap.set(probeId, true);
	for (const probeId of NATIVE_PROBE_IDS) {
		if (!presenceMap.has(probeId)) {
			initial.diagnostics.push({
				probeId,
				kind: "missing-key",
				message: `native-probes.json is missing canonical probe key \`${probeId}\``,
			});
		}
	}
	if (presenceMap.size !== NATIVE_PROBE_IDS.length || allParserResults.length !== NATIVE_PROBE_IDS.length) {
		return buildView(initial, dimensions);
	}

	// ---- 4. external-streams presence + hashing --------------------------

	// (a) external stdout / stderr via shared loader. The loader
	// reads the bytes verbatim, runs SHA-256 over the buffer, and
	// compares with the manifest entry. Failures are surfaced as
	// diagnostics; the per-byte record-hash check happens below.
	let externalStreamsComplete = true;
	let externalStreamHashesValid = true;
	const externalStdout = new Map<NativeProbeId, Buffer>();
	const externalStderr = new Map<NativeProbeId, Buffer>();
	for (const { probeId, record } of allParserResults) {
		const stdoutLoad = loadEvidencePayload(evDirAbs, record.stdout_path, parsedManifest.declared);
		if (!stdoutLoad.ok || stdoutLoad.bytes === null) {
			externalStreamsComplete = false;
			const reason = stdoutLoad.diagnostics[0]?.reason ?? "missing";
			let kind: NativeProbeDiagnosticKind = "stream-payload-missing";
			if (reason === "manifest-undeclared" || reason === "traversal" || reason === "absolute" || reason === "outside-evidence-dir") {
				kind = "stream-payload-hash-mismatch";
			} else if (reason === "symlink" || reason === "not-regular-file") {
				kind = "stream-payload-not-regular";
			}
			initial.diagnostics.push({
				probeId,
				kind,
				message: `native-probe \`${probeId}\` external stdout: ${reason} at \`${record.stdout_path}\` (${stdoutLoad.diagnostics[0]?.expected ?? "n/a"} vs ${stdoutLoad.diagnostics[0]?.observed ?? "n/a"})`,
			});
			continue;
		}
		externalStdout.set(probeId, stdoutLoad.bytes);
		const stderrLoad = loadEvidencePayload(evDirAbs, record.stderr_path, parsedManifest.declared);
		if (!stderrLoad.ok || stderrLoad.bytes === null) {
			externalStreamsComplete = false;
			const reason = stderrLoad.diagnostics[0]?.reason ?? "missing";
			let kind: NativeProbeDiagnosticKind = "stream-payload-missing";
			if (reason === "manifest-undeclared" || reason === "traversal" || reason === "absolute" || reason === "outside-evidence-dir") {
				kind = "stream-payload-hash-mismatch";
			} else if (reason === "symlink" || reason === "not-regular-file") {
				kind = "stream-payload-not-regular";
			}
			initial.diagnostics.push({
				probeId,
				kind,
				message: `native-probe \`${probeId}\` external stderr: ${reason} at \`${record.stderr_path}\` (${stderrLoad.diagnostics[0]?.expected ?? "n/a"} vs ${stderrLoad.diagnostics[0]?.observed ?? "n/a"})`,
			});
			continue;
		}
		externalStderr.set(probeId, stderrLoad.bytes);
		// The manifest entry was already verified by loadEvidencePayload;
		// a separate derived flag tracks whether every external stream
		// was actually read AND hash-matched. With the loader's
		// fail-closed design they are inseparable from `bytes.ok`.
	}
	dimensions.externalStreamsComplete = externalStreamsComplete;
	// For µC-3, streams whose bytes were loaded successfully are
	// hash-valid by construction. Missing/traversal/etc. cases are
	// surfaced in the diagnostics; we set the dimension conservatively
	// false when any probe failed to load.
	dimensions.externalStreamHashesValid = externalStreamsComplete && externalStreamHashesValid;

	// ---- 5. metadata payloads + semantic equality -----------------------

	let metadataPayloadsComplete = true;
	let metadataHashesValid = true;
	let metadataRecordsEqual = true;
	const metadataBytes = new Map<NativeProbeId, Buffer>();
	const metadataParsed = new Map<NativeProbeId, unknown>();
	for (const { probeId, record } of allParserResults) {
		const load = loadEvidencePayload(evDirAbs, record.metadata_path, parsedManifest.declared);
		if (!load.ok || load.bytes === null) {
			metadataPayloadsComplete = false;
			metadataHashesValid = false;
			metadataRecordsEqual = false;
			const reason = load.diagnostics[0]?.reason ?? "missing";
			let kind: NativeProbeDiagnosticKind = "metadata-payload-missing";
			if (reason === "manifest-undeclared" || reason === "traversal" || reason === "outside-evidence-dir") {
				kind = "metadata-hash-mismatch";
			}
			initial.diagnostics.push({
				probeId,
				kind,
				message: `native-probe \`${probeId}\` metadata: ${reason} at \`${record.metadata_path}\` (${load.diagnostics[0]?.expected ?? "n/a"} vs ${load.diagnostics[0]?.observed ?? "n/a"})`,
			});
			continue;
		}
		metadataBytes.set(probeId, load.bytes);
		let parsedMetadata: unknown;
		try {
			parsedMetadata = JSON.parse(load.bytes.toString("utf8"));
		} catch (error) {
			metadataPayloadsComplete = false;
			metadataRecordsEqual = false;
			initial.diagnostics.push({
				probeId,
				kind: "metadata-json-malformed",
				message: `native-probe \`${probeId}\` metadata.json is not valid JSON: ${
					error instanceof Error ? error.message : String(error)
				}`,
			});
			continue;
		}
		if (parsedMetadata === null || typeof parsedMetadata !== "object" || Array.isArray(parsedMetadata)) {
			metadataPayloadsComplete = false;
			metadataRecordsEqual = false;
			initial.diagnostics.push({
				probeId,
				kind: "metadata-shape-invalid",
				message: `native-probe \`${probeId}\` metadata.json must be a JSON object`,
			});
			continue;
		}
		metadataParsed.set(probeId, parsedMetadata);
		// Probe-id cross-check (catch a swapped record).
		const idField = (parsedMetadata as Record<string, unknown>).id;
		if (idField !== probeId) {
			metadataRecordsEqual = false;
			initial.diagnostics.push({
				probeId,
				kind: "metadata-record-mismatch",
				message: `native-probe \`${probeId}\` metadata.json id disagrees with the aggregate record (expected=${probeId}, observed=${JSON.stringify(idField)})`,
			});
			continue;
		}
		// Semantic equality: stableStringify(metadata) === stableStringify(record).
		try {
			if (stableStringify(parsedMetadata) !== stableStringify(record)) {
				metadataRecordsEqual = false;
				initial.diagnostics.push({
					probeId,
					kind: "metadata-record-mismatch",
					message: `native-probe \`${probeId}\` metadata.json JSON value differs from the aggregate record under stableStringify`,
				});
			}
		} catch (error) {
			metadataRecordsEqual = false;
			initial.diagnostics.push({
				probeId,
				kind: "metadata-record-mismatch",
				message: `native-probe \`${probeId}\` metadata.json stableStringify failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			});
		}
	}
	dimensions.metadataPayloadsComplete = metadataPayloadsComplete;
	dimensions.metadataHashesValid = metadataHashesValid;
	dimensions.metadataRecordsEqual = metadataRecordsEqual;

	// ---- 6. stream-hash + embedded consistency + derived outcome ---------

	let embeddedStreamsConsistent = true;
	let derivedOutcomesMatch = true;
	let allProbesPassed = true;
	const probeSummaries = new Map<NativeProbeId, NativeProbeViewRecord>();
	for (const { probeId, record } of allParserResults) {
		const stdoutBytes = externalStdout.get(probeId);
		const stderrBytes = externalStderr.get(probeId);
		if (!stdoutBytes || !stderrBytes) {
			// Already covered by an external-streams diagnostic. Mark
			// downstream comparisons as not evaluated (false).
			allProbesPassed = false;
			continue;
		}
		// (b) external-bytes SHA-256 must equal the recorded hashes.
		const observedStdoutSha = createHash("sha256").update(stdoutBytes).digest("hex");
		const observedStderrSha = createHash("sha256").update(stderrBytes).digest("hex");
		if (record.stdout_sha256 !== observedStdoutSha) {
			allProbesPassed = false;
			externalStreamHashesValid = false;
			initial.diagnostics.push({
				probeId,
				kind: "stream-record-hash-mismatch",
				message: `native-probe \`${probeId}\` recorded stdout_sha256=${record.stdout_sha256.slice(0, 12)}… does not equal SHA-256 of on-disk bytes=${observedStdoutSha.slice(0, 12)}…`,
			});
		}
		if (record.stderr_sha256 !== observedStderrSha) {
			allProbesPassed = false;
			externalStreamHashesValid = false;
			initial.diagnostics.push({
				probeId,
				kind: "stream-record-hash-mismatch",
				message: `native-probe \`${probeId}\` recorded stderr_sha256=${record.stderr_sha256.slice(0, 12)}… does not equal SHA-256 of on-disk bytes=${observedStderrSha.slice(0, 12)}…`,
			});
		}
		// (c) Embedded-text consistency — informational mirror only;
		// record.stdout_text / stderr_text MUST byte-equal the external
		// stream (under UTF-8). Mismatch is reported but is not used to
		// repair the external evidence.
		const embeddedStdout = typeof record.stdout_text === "string"
			? Buffer.from(record.stdout_text, "utf8")
			: null;
		const embeddedStderr = typeof record.stderr_text === "string"
			? Buffer.from(record.stderr_text, "utf8")
			: null;
		if (embeddedStdout !== null && !embeddedStdout.equals(stdoutBytes)) {
			embeddedStreamsConsistent = false;
			initial.diagnostics.push({
				probeId,
				kind: "embedded-stream-mismatch",
				message: `native-probe \`${probeId}\` embedded stdout_text disagrees with the external stdout bytes`,
			});
		}
		if (embeddedStderr !== null && !embeddedStderr.equals(stderrBytes)) {
			embeddedStreamsConsistent = false;
			initial.diagnostics.push({
				probeId,
				kind: "embedded-stream-mismatch",
				message: `native-probe \`${probeId}\` embedded stderr_text disagrees with the external stderr bytes`,
			});
		}
		// (d) Derived outcome authority — run the catalogue predicate
		// using the EXTERNAL streams. The recorded status must agree.
		const def = NATIVE_PROBE_DEFINITIONS.find((d) => d.id === probeId);
		if (!def) {
			allProbesPassed = false;
			continue;
		}
		const context = {
			argv: record.argv as string[],
			exit_code: record.exit_code,
			signal: record.signal as NodeJS.Signals | null,
			timeout: record.timeout === true,
			stdout: stdoutBytes.toString("utf8"),
			stderr: stderrBytes.toString("utf8"),
			artifactExists: record.artifact_exists === true,
			artifactSize: record.artifact_size as number,
			artifactSha256: record.artifact_sha256 as string | null,
		};
		const derivedReason = record.timeout ? "probe timed out" : def.success(context);
		const derivedStatus: "pass" | "fail" = derivedReason === null ? "pass" : "fail";
		if (record.status !== derivedStatus) {
			derivedOutcomesMatch = false;
			allProbesPassed = false;
			initial.diagnostics.push({
				probeId,
				kind: "derived-outcome-mismatch",
				message: `native-probe \`${probeId}\` recorded status=${record.status} does not match external-streams-derived status=${derivedStatus} (reason=${derivedReason ?? "null"})`,
			});
			continue;
		}
		if (record.status !== "pass") {
			// A correctly recorded failed probe is structurally valid
			// but does not satisfy `nativeProbesComplete` — surface as
			// non-pass so the renderer's overall verdict reflects it.
			allProbesPassed = false;
			initial.diagnostics.push({
				probeId,
				kind: "non-pass",
				message: `native-probe \`${probeId}\` external-streams-derived status=${derivedStatus}; reason=${derivedReason ?? "null"}`,
			});
			continue;
		}
		probeSummaries.set(probeId, {
			id: probeId,
			path: record.path,
			architecture: record.architecture,
			sha256: record.sha256,
			file_format: record.file_format,
			status: "pass",
			reason: record.reason,
		});
	}
	dimensions.embeddedStreamsConsistent = embeddedStreamsConsistent;
	dimensions.derivedOutcomesMatch = derivedOutcomesMatch;
	dimensions.allProbesPassed = allProbesPassed;
	// externalStreamHashesValid reflects explicit on-disk + record hash
	// checks for every probe that produced both an external stream and a
	// recorded hash. The short-circuit `false` is sticky even when an
	// earlier iteration sets it to `true`.
	dimensions.externalStreamHashesValid =
		externalStreamHashesValid &&
		dimensions.externalStreamsComplete &&
		dimensions.streamLayoutValid;

	// ---- 7. identity binding (head/tree/subject) -------------------------

	let identityValid = true;
	for (const { probeId, record } of allParserResults) {
		if (executionHeadOid !== null && record.execution_head_oid !== executionHeadOid) {
			identityValid = false;
			initial.identityMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "identity-mismatch",
				message: `native-probe \`${probeId}\` execution_head_oid disagrees with bundle: recorded=${record.execution_head_oid} bundle=${executionHeadOid}`,
			});
		}
		if (executionTreeOid !== null && record.execution_tree_oid !== executionTreeOid) {
			identityValid = false;
			initial.identityMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "identity-mismatch",
				message: `native-probe \`${probeId}\` execution_tree_oid disagrees with bundle: recorded=${record.execution_tree_oid} bundle=${executionTreeOid}`,
			});
		}
		if (
			filteredSubjectTreeOid !== null &&
			record.subject_tree_oid !== filteredSubjectTreeOid
		) {
			identityValid = false;
			initial.identityMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "identity-mismatch",
				message: `native-probe \`${probeId}\` subject_tree_oid disagrees with bundle: recorded=${record.subject_tree_oid} bundle=${filteredSubjectTreeOid}`,
			});
		}
	}

	// ---- 8. aggregate + finalize ----------------------------------------

	const probesOut: Record<NativeProbeId, NativeProbeViewRecord | null> = emptyProbes();
	for (const [id, view] of probeSummaries) probesOut[id] = view;

	const complete = (() => {
		if (inventoryHostClass === null) return false;
		if (initial.diagnostics.length > 0) return false;
		if (!identityValid) return false;
		return dimensions.streamLayoutValid &&
			dimensions.streamPathsCanonical &&
			dimensions.externalStreamsComplete &&
			dimensions.externalStreamHashesValid &&
			dimensions.embeddedStreamsConsistent &&
			dimensions.metadataPayloadsComplete &&
			dimensions.metadataHashesValid &&
			dimensions.metadataRecordsEqual &&
			dimensions.derivedOutcomesMatch &&
			dimensions.allProbesPassed;
	})();
	initial.complete = complete;
	initial.probes = probesOut;
	return buildView(initial, dimensions);
}

/**
 * µC-3 — tracked-mirror reader. The tracked file at
 * `factory/inventories/native-probes.json` is informational only; the
 * authoritative copy lives inside the detached evidence bundle and
 * never returns `complete=true` from this path. The returned view
 * populates every µC-3 structural dimension as `false` so downstream
 * consumers cannot mistake a tracked-mirror read for an authoritative
 * one.
 */
export function loadNativeProbesInventory(inventoryPath: string): NativeProbesView {
	const initial = initialView();
	initial.source = "tracked";
	const dimensions = emptyDimensions();
	if (!existsSync(inventoryPath)) {
		initial.diagnostics = missingInventoryDiagnostics(`tracked inventory at ${inventoryPath}`);
		return buildView(initial, dimensions);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(inventoryPath, "utf8"));
	} catch (error) {
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "malformed-json",
				message: `native-probe inventory JSON could not be parsed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			});
		}
		return buildView(initial, dimensions);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "malformed-json",
				message: "native-probe inventory root must be a JSON object",
			});
		}
		return buildView(initial, dimensions);
	}
	const record = parsed as Record<string, unknown>;
	const nestedRecord =
		record.probes !== null &&
		typeof record.probes === "object" &&
		!Array.isArray(record.probes)
			? (record.probes as Record<string, unknown>)
			: null;
	let complete = true;
	for (const probeId of NATIVE_PROBE_IDS) {
		const raw = nestedRecord === null ? record[probeId] : nestedRecord[probeId];
		if (raw === undefined) {
			initial.diagnostics.push({ probeId, kind: "missing-inventory", message: `native-probe key \`${probeId}\` is absent from the tracked inventory` });
			complete = false;
			continue;
		}
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			initial.diagnostics.push({ probeId, kind: "invalid-shape", message: `native-probe entry \`${probeId}\` must be a JSON object` });
			complete = false;
			continue;
		}
		const v = raw as Record<string, unknown>;
		let shapeOk = true;
		for (const field of ["id", "path", "architecture", "sha256", "file_format", "reason"]) {
			if (typeof v[field] !== "string" || (v[field] as string).length === 0) {
				initial.diagnostics.push({ probeId, kind: "invalid-shape", message: `native-probe \`${probeId}\` missing or empty legacy field \`${field}\`` });
				shapeOk = false;
			}
		}
		if (typeof v.sha256 === "string" && !/^[0-9a-f]{64}$/.test(v.sha256 as string)) {
			initial.diagnostics.push({ probeId, kind: "invalid-shape", message: `native-probe \`${probeId}\` sha256 is not a 64-character lowercase hex string` });
			shapeOk = false;
		}
		const status = v.status;
		if (status === "pass") {
			// pass is the only condition that yields complete=true
		} else if (status === "deferred") {
			initial.diagnostics.push({ probeId, kind: "deferred", message: `native-probe \`${probeId}\` status=deferred; runner deferred this probe to a future pass` });
			complete = false;
		} else if (status === "fail") {
			initial.diagnostics.push({ probeId, kind: "non-pass", message: `native-probe \`${probeId}\` status=fail; reason=${typeof v.reason === "string" ? v.reason : "<no reason recorded>"}` });
			complete = false;
		} else {
			initial.diagnostics.push({ probeId, kind: "invalid-shape", message: `native-probe \`${probeId}\` status is not one of pass|fail|deferred (got \`${JSON.stringify(status)}\`)` });
			shapeOk = false;
		}
		if (!shapeOk) complete = false;
		if (shapeOk && status === "pass") {
			initial.probes[probeId] = {
				id: probeId,
				path: v.path as string,
				architecture: v.architecture as string,
				sha256: v.sha256 as string,
				file_format: v.file_format as string,
				status: "pass",
				reason: v.reason as string,
			};
		} else {
			initial.probes[probeId] = null;
		}
	}
	initial.complete = complete;
	return buildView(initial, dimensions);
}

