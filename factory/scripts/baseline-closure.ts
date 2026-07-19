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
 * Policy (CORRECTION15 + CORRECTION21 µC-3 review): fail-closed + non-self-
 * referential subject-tree + independently-derived execution identity +
 * per-command live cleanliness + relational status/classification
 * invariants + bundled self-contained bundle +
 * bundled-result-verification-before-aggregate-exactness +
 * pass-only-closure-arithmetic + fail-closed native-probe dimension +
 * deduplicated row diagnostics.
 *
 * Closure rules (unchanged):
 *
 *   FAIL      evidence is missing/malformed/identity-stale/hash-invalid/
 *             multi-tree/command-set-mismatched/symlinked/outside-evidence-
 *             dir/self-referential/on-a-dirty-worktree/split between subject
 *             and execution identity/drift between/within commands/malformed
 *             command rows/relational invariant violation; OR the bundled
 *             verification-results.json command-set check never explicitly
 *             returned `true`; OR the µC-3 native-probe dimension has any
 *             diagnostic; OR there are UNKNOWN-classified failures with no
 *             investigation note.
 *   PARTIAL   evidence is internally valid and command-set-exact, the
 *             bundled-result check returned `true`, the µC-3 dimension is
 *             complete, but at least one declared baseline requirement
 *             (R4/R5/R6/R7/R16) remains open.
 *   PASS      every requirement is satisfied, the bundled-result check
 *             returned `true`, the µC-3 native-probe dimension is complete,
 *             and all mandatory commands pass on the binding host.
 *
 * µC-3 review (CORRECTION21): the bundle-bound verifier
 * (`loadNativeProbesFromEvidence`) is the single source of truth for the
 * native-probe dimension. The tracked-mirror reader
 * (`loadNativeProbesInventory`) is informational only — it MUST always return
 * `complete=false`. Every explicit dimension on the returned `NativeProbesView`
 * reflects whether the corresponding check actually evaluated true on the
 * bundle (not whether the diagnostics list is empty).
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
	canonicalRecordedProbeReason,
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
	type NativeProbeDefinition,
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
 * describes one structured failure mode. The µC-3 review augments the
 * vocabulary with diagnostic kinds the reader emits when the new
 * checks (catalogue equality, artifact bytes, host-class binding,
 * derived-reason binding, predicate errors) fail or are unevaluated.
 *
 *   missing-inventory       bundle has no native-probes.json payload
 *   malformed-json          the inventory could not be JSON-parsed
 *   missing-key             a canonical probe id is absent from the inventory
 *   invalid-shape           a record does not satisfy the parser (fail-closed)
 *   deferred                the probe was not executed (production preflight rejects this)
 *   non-pass                recorded status agrees with derived, but the
 *                           derived outcome is fail
 *   hash-mismatch           any of {artifact_sha256, stdout_sha256, stderr_sha256} differs from the recomputed value
 *   architecture-mismatch   observed or Mach-O-derived architecture disagrees
 *                           with host_class (only evaluated when the probe
 *                           declares `architecture_assert: "host-class"`)
 *   identity-mismatch       the recorded head/tree/subject does not match the bundle
 *   argv-mismatch           the recorded argv does not match the catalogue
 *   host-class-mismatch     the recorded host_class does not match the bundle's recorded host
 *   predicate-mismatch      the persisted format_match pattern cannot compile or disagrees with the catalogue, OR a catalogue-bound field
 *                           (success_contract_version) disagrees
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
 *   derived-outcome-mismatch   the recorded status does not match the
 *                           external-streams-derived status (including
 *                           secondary checks: predicate error, reason
 *                           disagreement)
 *
 *   CORRECTION21 (µC-3 review) — new kinds:
 *   artifact-mismatch      — recorded artifact_* fields disagree with the bytes staged at artifact_path (missing, size drift, sha256 drift,
 *                           OR the artifact path is undeclared in the bundle's hashes.sha256 manifest)
 *   catalogue-mismatch     — a catalogue-bound field on the recorded record (argv / host_support / format_match / architecture_assert /
 *                           success_contract_version) disagrees with NATIVE_PROBE_DEFINITIONS
 *   predicate-error        — the catalogue success predicate threw while evaluating the external streams
 *   reason-mismatch        — the recorded `reason` text disagrees with the derived reason produced by the catalogue success predicate
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
	| "derived-outcome-mismatch"
	| "artifact-mismatch"
	| "catalogue-mismatch"
	| "predicate-error"
	| "reason-mismatch";


export interface NativeProbeDiagnostic {
	probeId: NativeProbeId;
	kind: NativeProbeDiagnosticKind;
	message: string;
	/**
	 * CORRECTION21 (µC-3 review) — structured fields for downstream
	 * filters. Tests that need to assert the exact failing field can
	 * now use `d.field` without parsing the message. `reason` carries
	 * the parser-level reason string for the more granular
	 * "wrong-shape" / "stream-path-mismatch" / etc. diagnostics. The
	 * fields are populated only by the reader's structured code paths;
	 * call-sites that synthesise a diagnostic may leave them empty.
	 */
	field?: string;
	reason?: string;
	expected?: string;
	observed?: string;
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
 * not match any of the four known Mach-O values. The parser is
 * independent of any recorded probe metadata: it only reads the
 * staged bytes. A probe whose recorded `architecture` disagrees with
 * this derivation is rejected by the validator when the probe declares
 * `architecture_assert: "host-class"`.
 */
export function deriveMachOArchitecture(bytes: Buffer): MachODerivation {
	if (bytes.length < 8) {
		return { arch: null, cputype: null, bitness: null, byteOrder: null };
	}
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
 * CORRECTION15 placeholder shape for a native-probe entry after the
 * reader has accepted the canonical stream/path metadata. The renderer's
 * `Native-dependency probes` table uses this view shape. Migration
 * timeline: the legacy `path` / `sha256` aliases are kept so the renderer
 * table format does not break; the actual evidence lives under
 * `artifact_path` / `artifact_sha256` / `stdout_sha256` / `stderr_sha256`
 * (validated explicitly by the reader).
 */
export type NativeProbeViewRecord = Pick<
	NativeProbe,
	"id" | "path" | "architecture" | "sha256" | "file_format" | "status" | "reason"
>;

/**
 * µC-3 result of `loadNativeProbesFromEvidence`.
 *
 * Every dimension reflects whether the corresponding check actually
 * evaluated true on the bundle (NOT whether the diagnostics list is
 * empty). A bundle missing any required input short-circuits every
 * downstream dimension to `false` so the renderer does not have to
 * inspect the diagnostics array to know the bundle is unsatisfiable.
 */
export interface NativeProbesView {
	complete: boolean;
	probes: Record<NativeProbeId, NativeProbeViewRecord | null>;
	diagnostics: NativeProbeDiagnostic[];
	source: "bundle" | "tracked" | "missing";
	declaredHash: string | null;
	observedHash: string | null;
	hashMismatches: NativeProbeId[];
	architectureMismatches: NativeProbeId[];
	identityMismatches: NativeProbeId[];
	argvMismatches: NativeProbeId[];
	hostClassMismatches: NativeProbeId[];
	/** Original 10 explicit structural dimensions (CORRECTION21 µC-3). */
	streamLayoutValid: boolean;
	streamPathsCanonical: boolean;
	/**
	 * CORRECTION21 (µC-3 review) — independent structural-shape
	 * dimension. `streamLayoutValid` and `streamPathsCanonical` only
	 * track their respective diagnostics; `recordsStructurallyValid`
	 * captures all other parser-level shape failures (argv type,
	 * status enum, identity OID format, etc.). The previous design
	 * aliased both layout and path dimensions to a single
	 * `parserFailed` boolean, which incorrectly reported that the
	 * stream layout was invalid when the actual failure was on the
	 * argv field (and vice versa).
	 */
	recordsStructurallyValid: boolean;
	externalStreamsComplete: boolean;
	externalStreamHashesValid: boolean;
	embeddedStreamsConsistent: boolean;
	metadataPayloadsComplete: boolean;
	metadataHashesValid: boolean;
	metadataRecordsEqual: boolean;
	derivedOutcomesMatch: boolean;
	allProbesPassed: boolean;
	/**
	 * CORRECTION21 (µC-3 review) — new dimensions added by the reader-review
	 * patch. Each reflects whether the corresponding check actually evaluated
	 * true on this bundle. A bundle that fails ANY of these fails
	 * `complete` and therefore the closure.
	 */
	catalogueMatches: boolean;
	hostClassMatchesBundle: boolean;
	artifactBytesValid: boolean;
	recordedIdentityMatchesBundle: boolean;
	derivedReasonMatchesRecorded: boolean;
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
 * The complete integrity picture for the detached evidence bundle.
 * Every dimension must be satisfied for the verdict to not be FAIL on
 * evidence grounds; see `isEvidenceOk` and `computeClosure`.
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
	nativeProbesComplete: boolean;
	nativeProbesDiagnostics: NativeProbeDiagnostic[];
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
	if (typeof value.status === "string" && typeof value.failure_classification !== "undefined") {
		const fc = value.failure_classification;
		const isTimeout = value.timeout === true;
		const fcIsNull = fc === null;
		const fcIsTimeout = fc === "TIMEOUT";
		const fcIsString = typeof fc === "string" && FAILURE_CLASSES.has(fc);
		if (value.status === "pass") {
			if (!fcIsNull) pushField("failure_classification");
			if (value.exit_code !== 0) pushField("exit_code");
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
	if (input.evidence.bundledResultCommandSetExact !== true) {
		reasonCodes.push("BUNDLED_RESULT_COMMAND_SET_MISMATCH");
	}
	if (input.evidence.rowRelationalInvariantViolations.length > 0) {
		reasonCodes.push("ROW_RELATIONAL_INVARIANT_VIOLATION");
	}
	if (input.evidence.metadataFileMismatches.length > 0) {
		reasonCodes.push("METADATA_FILE_MISMATCH");
	}
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
		nativeProbesComplete: false,
		nativeProbesDiagnostics: [],
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

	if (evObj.probe_source === "executed" || evObj.probe_source === "fixture") {
		out.probeSource = evObj.probe_source;
	}
	if (typeof evObj.fixture_derived === "boolean") {
		out.fixtureDerived = evObj.fixture_derived;
	}

	if (expectedEvidencePayloadPaths !== null) {
		const evidenceSchemaVersion =
			typeof evObj.schema_version === "number" ? evObj.schema_version : 0;
		const nativeProbesRequired = evidenceSchemaVersion >= 5;
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

function deriveNativeProbeExternalStreamPayloadPaths(): string[] {
	const out: string[] = [];
	for (const probeId of NATIVE_PROBE_IDS) {
		const paths = canonicalStreamPaths(probeId);
		out.push(paths.stdout_path, paths.stderr_path, paths.metadata_path);
	}
	return out;
}

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
 * `${EVIDENCE_BUNDLE}/native-probes.json`.
 */
export const NATIVE_PROBES_INVENTORY_PATH = "factory/inventories/native-probes.json";

/**
 * Bundle-relative path of the staged native-probe inventory.
 */
export const NATIVE_PROBES_BUNDLE_PATH = "native-probes.json";

/**
 * Arguments for `loadNativeProbesFromEvidence`.
 */
export interface LoadNativeProbesFromEvidenceArgs {
	evDirAbs: string;
	manifestText: string;
	executionHeadOid: string | null;
	executionTreeOid: string | null;
	filteredSubjectTreeOid: string | null;
	/**
	 * CORRECTION21 (µC-3 review) — host class the bundle ascribes to
	 * itself via evidence.json (e.g. via `environment.architecture`).
	 * The reader requires BOTH the inventory host_class AND the
	 * recorded probe host_class to equal this value; without an
	 * independently-derived anchor the host_class_matches_bundle
	 * dimension is purely self-referential and proves nothing about
	 * the host the bundle actually ran on. Pass `null` when the
	 * evidence.json has no authority and the dimension will short-
	 * circuit to false.
	 */
	bundleHostClass: string | null;
}

// ---------- ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — µC-3 reader -------


function emptyProbes(): Record<NativeProbeId, NativeProbeViewRecord | null> {
	const probes = {} as Record<NativeProbeId, NativeProbeViewRecord | null>;
	for (const probeId of NATIVE_PROBE_IDS) probes[probeId] = null;
	return probes;
}

/**
 * Default dimensions for the µC-3 structural flags. Every early
 * short-circuit populates the same falsified layout so downstream
 * consumers can read the booleans without recursing through `diagnostics`.
 */
function emptyDimensions(): Omit<
	NativeProbesView,
	"complete" | "probes" | "diagnostics" | "source" | "declaredHash" | "observedHash" |
	"hashMismatches" | "architectureMismatches" | "identityMismatches" | "argvMismatches" | "hostClassMismatches"
> {
	return {
		streamLayoutValid: false,
		streamPathsCanonical: false,
		recordsStructurallyValid: false,
		externalStreamsComplete: false,
		externalStreamHashesValid: false,
		embeddedStreamsConsistent: false,
		metadataPayloadsComplete: false,
		metadataHashesValid: false,
		metadataRecordsEqual: false,
		derivedOutcomesMatch: false,
		allProbesPassed: false,
		catalogueMatches: false,
		hostClassMatchesBundle: false,
		artifactBytesValid: false,
		recordedIdentityMatchesBundle: false,
		derivedReasonMatchesRecorded: false,
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
 * Compare a recorded NativeProbe against the catalogue NATIVE_PROBE_DEFINITIONS
 * entry of the same id. Returns null on equality; otherwise returns a
 * human-readable diagnostic message listing the divergent field(s). This
 * covers argv (byte-exact array comparison), host_support (set-equality on
 * strings), format_match (source, pattern_source, pattern_flags), and
 * architecture_assert / success_contract_version (literals).
 *
 * The format-match pattern is recompiled via `compileFormatMatch` so a
 * syntax-invalid pattern_source on the recorded side is detected even when
 * the strings happen to compare equal under naive equality (defence in
 * depth; the catalog uses well-formed sources).
 */
function catalogueEqualityMessage(
	recorded: BundledNativeProbe,
	definition: NativeProbeDefinition,
): string | null {
	const issues: string[] = [];
	if (
		recorded.argv.length !== definition.argv.length ||
		!recorded.argv.every((entry, i) => entry === definition.argv[i])
	) {
		issues.push(
			`argv differs (recorded=${JSON.stringify(recorded.argv)}, catalogue=${JSON.stringify(definition.argv)})`,
		);
	}
	// CORRECTION21 (µC-3 review): working_directory and artifact_path are
	// catalogue-bound identity anchors the previous strict validator
	// pinned. Without them the recorded probe can claim a different
	// working directory or substitute a different artifact path while
	// still passing argv/host_support comparison; the reader now
	// requires both to equal the catalogue declaration verbatim.
	if (recorded.working_directory !== definition.working_directory) {
		issues.push(
			`working_directory differs (recorded=${JSON.stringify(recorded.working_directory)}, catalogue=${JSON.stringify(definition.working_directory)})`,
		);
	}
	if (recorded.artifact_path !== definition.artifact_path) {
		issues.push(
			`artifact_path differs (recorded=${JSON.stringify(recorded.artifact_path)}, catalogue=${JSON.stringify(definition.artifact_path)})`,
		);
	}
	// CORRECTION21 (µC-3 review): host_support is a SET equality in
	// NATIVE_PROBE_DEFINITIONS (the docs explicitly say "set equality",
	// not positional). Comparing as positional arrays produced false
	// positives whenever a re-sort left the same elements in different
	// order. The reader now compares as sets.
	const recordedSupport = new Set(Array.isArray(recorded.host_support) ? recorded.host_support : []);
	const catalogueSupport = new Set(definition.host_support);
	let hostSupportMatches = recordedSupport.size === catalogueSupport.size;
	if (hostSupportMatches) {
		for (const h of catalogueSupport) {
			if (!recordedSupport.has(h)) {
				hostSupportMatches = false;
				break;
			}
		}
	}
	if (!hostSupportMatches) {
		issues.push(
			`host_support differs (recorded=${JSON.stringify([...recordedSupport])}, catalogue=${JSON.stringify([...catalogueSupport])})`,
		);
	}
	if (recorded.format_match_source !== definition.format_match.source) {
		issues.push(
			`format_match.source differs (recorded=${JSON.stringify(recorded.format_match_source)}, catalogue=${JSON.stringify(definition.format_match.source)})`,
		);
	}
	if (recorded.format_match_pattern_source !== definition.format_match.pattern_source) {
		issues.push(
			`format_match.pattern_source differs (recorded=${JSON.stringify(recorded.format_match_pattern_source)}, catalogue=${JSON.stringify(definition.format_match.pattern_source)})`,
		);
	}
	if (recorded.format_match_pattern_flags !== definition.format_match.pattern_flags) {
		issues.push(
			`format_match.pattern_flags differs (recorded=${JSON.stringify(recorded.format_match_pattern_flags)}, catalogue=${JSON.stringify(definition.format_match.pattern_flags)})`,
		);
	}
	if (recorded.architecture_assert !== definition.architecture_assert) {
		issues.push(
			`architecture_assert differs (recorded=${JSON.stringify(recorded.architecture_assert)}, catalogue=${JSON.stringify(definition.architecture_assert)})`,
		);
	}
	if (recorded.success_contract_version !== definition.success_contract_version) {
		issues.push(
			`success_contract_version differs (recorded=${recorded.success_contract_version}, catalogue=${definition.success_contract_version})`,
		);
	}
	// Defence in depth: the recorded pattern must compile.
	try {
		compileFormatMatch({
			source: definition.format_match.source,
			pattern_source: recorded.format_match_pattern_source,
			pattern_flags: recorded.format_match_pattern_flags,
		});
	} catch (error) {
		issues.push(
			`recorded pattern cannot be compiled: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (issues.length === 0) return null;
	return issues.join("; ");
}

/**
 * Read the bytes at `artifactPath` (relative to `evDirAbs`), verify they
 * exist as a regular file, hash-listed in `manifestHashes`, and hash+size
 * match the recorded `artifactSha256` / `artifactSize`. Returns null on
 * success; otherwise returns one artifact-mismatch diagnostic. Does not
 * trust the recorded SHA without recomputing it.
 */
function verifyArtifactBytes(
	evDirAbs: string,
	artifactPath: string,
	recordedArtifactSize: number,
	recordedArtifactSha: string,
	manifestHashes: Map<string, string>,
): { ok: true } | { ok: false; message: string } {
	const declared = manifestHashes.get(artifactPath);
	if (declared === undefined) {
		return { ok: false, message: `artifact path \`${artifactPath}\` is not declared in \`hashes.sha256\`` };
	}
	const load = loadEvidencePayload(evDirAbs, artifactPath, manifestHashes);
	if (!load.ok || load.bytes === null) {
		const reason = load.diagnostics[0]?.reason ?? "missing";
		return { ok: false, message: `artifact \`${artifactPath}\` failed load: ${reason}` };
	}
	const bytes = load.bytes;
	if (bytes.length !== recordedArtifactSize) {
		return {
			ok: false,
			message: `artifact \`${artifactPath}\` size drift: recorded=${recordedArtifactSize} bytes, observed=${bytes.length} bytes`,
		};
	}
	const observedSha = createHash("sha256").update(bytes).digest("hex");
	if (observedSha !== recordedArtifactSha) {
		return {
			ok: false,
			message: `artifact \`${artifactPath}\` sha256 drift: recorded=${recordedArtifactSha.slice(0, 12)}…, observed=${observedSha.slice(0, 12)}…`,
		};
	}
	return { ok: true };
}

/**
 * CORRECTION21 — µC-3 authoritative reader. Reads `native-probes.json`
 * from the staged bundle, hash-checks it against `hashes.sha256`, then
 * runs **every** µC-3 binding check against the canonical authorities.
 *
 * Original 8 dimensions (CORRECTION21):
 *   1. **stream_layout**           — every record's stream_layout_version
 *                                   equals NATIVE_PROBE_STREAM_LAYOUT_VERSION.
 *   2. **stream_paths**            — every record's stdout/stderr/metadata
 *                                   paths are exactly the canonical layout.
 *   3. **external_streams**        — every native-probes/<id>.stdout,
 *                                   .stderr, .metadata.json exists in the
 *                                   bundle, is a regular file (no symlinks),
 *                                   and hash-matches hashes.sha256.
 *   4. **stream_hashes**           — every record's stdout_sha256 /
 *                                   stderr_sha256 equals the SHA-256 of
 *                                   the on-disk bytes.
 *   5. **embedded_consistency**    — every embedded stdout_text / stderr_text
 *                                   UTF-8 byte-equals the external bytes.
 *   6. **metadata_payloads**       — every per-probe metadata.json exists,
 *                                   parses, is a JSON object whose parsed
 *                                   value is stableStringify-equal to the
 *                                   aggregate record's parsed value.
 *   7. **derived_outcomes**        — every probe runs the catalogue success
 *                                   predicate using EXTERNAL streams as
 *                                   the only authority; recorded status must
 *                                   agree.
 *   8. **all_probes_pass**         — every probe finishes status="pass".
 *
 * CORRECTION21 (µC-3 review) — 5 new dimensions:
 *   9. **catalogue_matches**       — argv / host_support / format_match /
 *                                   architecture_assert /
 *                                   success_contract_version all match the
 *                                   corresponding catalogue entry.
 *   10. **host_class_matches_bundle** — recorded host_class equals the bundle's
 *                                   recorded host (provenance stamp).
 *   11. **artifact_bytes_valid**   — for every probe where artifact_exists=true:
 *                                   the recorded artifact_path is declared in
 *                                   hashes.sha256, is a regular file with
 *                                   matching bytes / size, and the recorded
 *                                   artifact_sha256 / artifact_size agree with
 *                                   the on-disk recomputation.
 *   12. **recorded_identity_matches_bundle** — execution_head_oid /
 *                                   execution_tree_oid / subject_tree_oid on
 *                                   every record equal the bundle's recorded
 *                                   identity (root head, root tree, filtered
 *                                   subject tree).
 *   13. **derived_reason_matches_recorded** — recorded reason string agrees
 *                                   with the derived reason produced by the
 *                                   catalogue predicate over the external
 *                                   streams (P0.9). Predicate exceptions
 *                                   are caught and surfaced as
 *                                   predicate-error (P0.8); the reader never
 *                                   crashes on a misbehaving predicate.
 *
 * Every dimension is an explicit boolean on NativeProbesView. The reader
 * never falls back to embedded values to repair external evidence, never
 * rewrites payloads, never regenerates hashes, never adds missing
 * manifest entries, never normalizes files on disk. A missing manifest
 * entry (a common short-circuit trigger) marks every downstream dimension
 * `false` so the renderer does not have to inspect the diagnostics array.
 */
export function loadNativeProbesFromEvidence(
	args: LoadNativeProbesFromEvidenceArgs,
): NativeProbesView {
	const {
		evDirAbs,
		manifestText,
		executionHeadOid,
		executionTreeOid,
		filteredSubjectTreeOid,
		bundleHostClass,
	} = args;
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

	// ---- 3. per-record structural parsing (stream layout / paths) ----

	// Independent counters per P0.5 so a parser failure on one field does
	// not silently flip an unrelated dimension. `streamLayoutValid` is
	// computed from layout-version diagnostics only; `streamPathsCanonical`
	// from stream-path diagnostics only; `recordsStructurallyValid`
	// captures the remaining structural shape failures.
	let streamLayoutValid = true;
	let streamPathsCanonical = true;
	let recordsStructurallyValid = true;
	const allParserResults: Array<{
		probeId: NativeProbeId;
		record: BundledNativeProbe;
	}> = [];
	for (const probeId of NATIVE_PROBE_IDS) {
		const probeRaw = nestedProbes[probeId];
		const result = parseBundledNativeProbe(probeId, probeRaw);
		if (!result.ok || result.record === null) {
			for (const d of result.diagnostics) {
				const mapped = probeParseToDiagnostic(probeId, d);
				if (d.reason === "stream-layout-unsupported" || d.reason === "stream-layout-missing") {
					streamLayoutValid = false;
				} else if (d.reason === "stream-path-mismatch") {
					streamPathsCanonical = false;
				} else {
					recordsStructurallyValid = false;
				}
				initial.diagnostics.push(mapped);
			}
			continue;
		}
		allParserResults.push({ probeId, record: result.record });
	}

	const presenceMap = new Map<NativeProbeId, boolean>();
	for (const { probeId } of allParserResults) presenceMap.set(probeId, true);
	for (const probeId of NATIVE_PROBE_IDS) {
		if (!presenceMap.has(probeId)) {
			initial.diagnostics.push({
				probeId,
				kind: "missing-key",
				message: `native-probes.json is missing canonical probe key \`${probeId}\``,
			});
			recordsStructurallyValid = false;
		}
	}
	if (presenceMap.size !== NATIVE_PROBE_IDS.length || allParserResults.length !== NATIVE_PROBE_IDS.length) {
		dimensions.streamLayoutValid = streamLayoutValid;
		dimensions.streamPathsCanonical = streamPathsCanonical;
		return buildView(initial, dimensions);
	}

	// ---- 4. catalogue equality (argv / host_support / format_match /
	//        architecture_assert / success_contract_version,
	//        working_directory, artifact_path) --------------------------

	let catalogueMatches = true;
	for (const { probeId, record } of allParserResults) {
		const def = NATIVE_PROBE_DEFINITIONS.find((d) => d.id === probeId);
		if (!def) continue;
		const message = catalogueEqualityMessage(record, def);
		if (message !== null) {
			catalogueMatches = false;
			initial.diagnostics.push({
				probeId,
				kind: "catalogue-mismatch",
				field: "catalogue",
				message: `native-probe \`${probeId}\` catalogue drift: ${message}`,
			});
		}
	}
	dimensions.catalogueMatches = catalogueMatches;

	// ---- 5. host-class binding -----------------------------------------
	//
	// Per the µC-3 review, the previous reader compared recorded host_class
	// to inventory.host_class only. Both fields live in the same JSON
	// object and can drift together; the dimension therefore proved only
	// that the record agrees with the inventory, not that the inventory
	// agrees with the host the bundle actually ran on. The reader now
	// requires THREE independent host-class values to agree:
	//
	//   inventory.host_class       (from native-probes.json)
	//   record.host_class          (from each per-probe record)
	//   bundleHostClass            (from evidence.json environment)
	//
	// When any of the three is null the dimension short-circuits to false
	// because the comparison cannot be evaluated independently.

	let hostClassMatchesBundle = true;
	if (typeof bundleHostClass !== "string" || bundleHostClass.length === 0) {
		hostClassMatchesBundle = false;
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "host-class-mismatch",
				field: "host_class",
				message: `native-probe \`${probeId}\` bundle host_class is null (no independent anchor from evidence.json); cannot prove host agreement`,
			});
		}
	} else if (typeof inventoryHostClass !== "string") {
		hostClassMatchesBundle = false;
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "host-class-mismatch",
				field: "host_class",
				message: `native-probe \`${probeId}\` inventory host_class is null while bundle host_class=${JSON.stringify(bundleHostClass)} is present; cannot prove host agreement`,
			});
		}
	} else if (inventoryHostClass !== bundleHostClass) {
		hostClassMatchesBundle = false;
		for (const probeId of NATIVE_PROBE_IDS) {
			initial.diagnostics.push({
				probeId,
				kind: "host-class-mismatch",
				field: "host_class",
				message: `native-probe \`${probeId}\` inventory host_class=${JSON.stringify(inventoryHostClass)} disagrees with bundle host_class=${JSON.stringify(bundleHostClass)}`,
			});
		}
	}
	for (const { probeId, record } of allParserResults) {
		if (
			hostClassMatchesBundle &&
			typeof bundleHostClass === "string" &&
			record.host_class !== bundleHostClass
		) {
			hostClassMatchesBundle = false;
			initial.hostClassMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "host-class-mismatch",
				field: "host_class",
				message: `native-probe \`${probeId}\` recorded host_class=${JSON.stringify(record.host_class)} disagrees with bundle host_class=${JSON.stringify(bundleHostClass)}`,
			});
		}
	}
	dimensions.hostClassMatchesBundle = hostClassMatchesBundle;
	dimensions.streamLayoutValid = streamLayoutValid;
	dimensions.streamPathsCanonical = streamPathsCanonical;
	dimensions.recordsStructurallyValid = recordsStructurallyValid;

	// ---- 6. external-streams presence + per-record hash + manifest ----

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
			if (
				reason === "manifest-undeclared" ||
				reason === "traversal" ||
				reason === "absolute" ||
				reason === "outside-evidence-dir"
			) {
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
			if (
				reason === "manifest-undeclared" ||
				reason === "traversal" ||
				reason === "absolute" ||
				reason === "outside-evidence-dir"
			) {
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
	}

	// ---- 7. metadata payloads + semantic equality ---------------------

	let metadataPayloadsComplete = true;
	let metadataHashesValid = true;
	let metadataRecordsEqual = true;
	const metadataParsed = new Map<NativeProbeId, unknown>();
	for (const { probeId, record } of allParserResults) {
		const load = loadEvidencePayload(evDirAbs, record.metadata_path, parsedManifest.declared);
		if (!load.ok || load.bytes === null) {
			metadataPayloadsComplete = false;
			metadataHashesValid = false;
			metadataRecordsEqual = false;
			const reason = load.diagnostics[0]?.reason ?? "missing";
			let kind: NativeProbeDiagnosticKind = "metadata-payload-missing";
			if (
				reason === "manifest-undeclared" ||
				reason === "traversal" ||
				reason === "outside-evidence-dir"
			) {
				kind = "metadata-hash-mismatch";
			}
			initial.diagnostics.push({
				probeId,
				kind,
				message: `native-probe \`${probeId}\` metadata: ${reason} at \`${record.metadata_path}\` (${load.diagnostics[0]?.expected ?? "n/a"} vs ${load.diagnostics[0]?.observed ?? "n/a"})`,
			});
			continue;
		}
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

	// ---- 8. artifact bytes / size / sha / manifest declaration -------

	let artifactBytesValid = true;
	for (const { probeId, record } of allParserResults) {
		if (record.artifact_exists !== true) {
			// Probes that legitimately have no artifact byte (e.g. machine
			// probe argv-only) are not required to back `artifact_exists`.
			// The reader accepts the absence as long as the recorded
			// artifact_sha256 is `null` and artifact_size is 0; any other
			// combination is also recorded below.
			if (
				record.artifact_sha256 !== null ||
				record.artifact_size !== 0
			) {
				artifactBytesValid = false;
				initial.diagnostics.push({
					probeId,
					kind: "artifact-mismatch",
					message: `native-probe \`${probeId}\` artifact_exists=false but recorded artifact_sha256=${JSON.stringify(record.artifact_sha256)} / artifact_size=${record.artifact_size} disagrees (must be null/0)`,
				});
			}
			continue;
		}
		if (
			typeof record.artifact_sha256 !== "string" ||
			!/^[0-9a-f]{64}$/.test(record.artifact_sha256)
		) {
			artifactBytesValid = false;
			initial.diagnostics.push({
				probeId,
				kind: "artifact-mismatch",
				message: `native-probe \`${probeId}\` artifact_exists=true but recorded artifact_sha256=${JSON.stringify(record.artifact_sha256)} is not a 64-character lowercase hex string`,
			});
			continue;
		}
		const result = verifyArtifactBytes(
			evDirAbs,
			record.artifact_path,
			record.artifact_size,
			record.artifact_sha256,
			parsedManifest.declared,
		);
		if (!result.ok) {
			artifactBytesValid = false;
			initial.diagnostics.push({
				probeId,
				kind: "artifact-mismatch",
				message: `native-probe \`${probeId}\` ${result.message}`,
			});
			continue;
		}
		// When architecture_assert="host-class" and the artifact reads as a
		// Mach-O, run the architecture derivation and compare against
		// archForHostClass(recorded host_class). Non-Mach-O artifacts
		// (probes whose artifact is a JSON manifest or .d.ts file) yield
		// arch=null, which is silently accepted on those probes.
		const def = NATIVE_PROBE_DEFINITIONS.find((d) => d.id === probeId);
		if (def && def.architecture_assert === "host-class") {
			const reloaded = loadEvidencePayload(
				evDirAbs,
				record.artifact_path,
				parsedManifest.declared,
			);
			if (reloaded.ok && reloaded.bytes !== null) {
				const derived = deriveMachOArchitecture(reloaded.bytes);
				const expectedArch = archForHostClass(record.host_class);
				if (derived.arch !== null && expectedArch !== null && derived.arch !== expectedArch) {
					artifactBytesValid = false;
					initial.architectureMismatches.push(probeId);
					initial.diagnostics.push({
						probeId,
						kind: "architecture-mismatch",
						message: `native-probe \`${probeId}\` recorded host_class=${JSON.stringify(record.host_class)} (arch=${expectedArch}) but Mach-O cputype derives to ${derived.arch}`,
					});
				}
			}
		}
	}
	dimensions.artifactBytesValid = artifactBytesValid;

	// ---- 9. stream-hash + embedded consistency + derived outcome -----

	let embeddedStreamsConsistent = true;
	let derivedOutcomesMatch = true;
	let derivedReasonMatchesRecorded = true;
	let allProbesPassed = true;
	const probeSummaries = new Map<NativeProbeId, NativeProbeViewRecord>();
	for (const { probeId, record } of allParserResults) {
		const stdoutBytes = externalStdout.get(probeId);
		const stderrBytes = externalStderr.get(probeId);
		if (!stdoutBytes || !stderrBytes) {
			allProbesPassed = false;
			continue;
		}
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
		const embeddedStdout =
			typeof record.stdout_text === "string" ? Buffer.from(record.stdout_text, "utf8") : null;
		const embeddedStderr =
			typeof record.stderr_text === "string" ? Buffer.from(record.stderr_text, "utf8") : null;
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
		let derivedReason: string | null;
		let predicateThrew = false;
		try {
			derivedReason = record.timeout ? "probe timed out" : def.success(context);
		} catch (error) {
			predicateThrew = true;
			derivedReason = `predicate threw: ${error instanceof Error ? error.message : String(error)}`;
			initial.diagnostics.push({
				probeId,
				kind: "predicate-error",
				message: `native-probe \`${probeId}\` catalogue success predicate threw: ${derivedReason}`,
			});
		}
		const derivedStatus: "pass" | "fail" = derivedReason === null ? "pass" : "fail";
		if (predicateThrew) {
			derivedOutcomesMatch = false;
			allProbesPassed = false;
			continue;
		}
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
		// P0.9: bind derived reason as well as status. For fail rows, the
		// recorded `reason` text MUST equal the derived reason text the
		// catalogue predicate produced. For pass rows, the recorded reason
		// can be either null or the canonical "probe satisfied <label>"
		// depending on the runner's choice; the reader accepts either form.
		const recordedReason = typeof record.reason === "string" ? record.reason : "";
		if (derivedStatus === "fail") {
			if (recordedReason !== derivedReason) {
				derivedReasonMatchesRecorded = false;
				initial.diagnostics.push({
					probeId,
					kind: "reason-mismatch",
					message: `native-probe \`${probeId}\` recorded reason=${JSON.stringify(recordedReason)} does not match derived reason=${JSON.stringify(derivedReason)}`,
				});
			}
		} else {
			// Pass row: accept either empty reason or the canonical
			// "probe satisfied <label>" text the runner records.
			if (recordedReason !== "" && recordedReason !== `probe satisfied ${def.label}`) {
				derivedReasonMatchesRecorded = false;
				initial.diagnostics.push({
					probeId,
					kind: "reason-mismatch",
					message: `native-probe \`${probeId}\` recorded reason=${JSON.stringify(recordedReason)} does not match the canonical pass text "probe satisfied ${def.label}"`,
				});
			}
		}
		if (record.status !== "pass") {
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

	dimensions.streamLayoutValid = streamLayoutValid;
	dimensions.streamPathsCanonical = streamPathsCanonical;
	dimensions.recordsStructurallyValid = recordsStructurallyValid;
	// P0.5: externalStreamHashesValid is sticky-false once any external
	// stream payload fails to load (the reader can't actually compare
	// the recorded hash against recomputed bytes). The previous design
	// reported true here when externalStreamsComplete was already false,
	// which falsely claimed the hash dimension could be evaluated.
	if (!externalStreamsComplete) externalStreamHashesValid = false;
	dimensions.externalStreamsComplete = externalStreamsComplete;
	dimensions.externalStreamHashesValid = externalStreamHashesValid;
	dimensions.embeddedStreamsConsistent = embeddedStreamsConsistent;
	dimensions.metadataPayloadsComplete = metadataPayloadsComplete;
	dimensions.metadataHashesValid = metadataHashesValid;
	dimensions.metadataRecordsEqual = metadataRecordsEqual;
	dimensions.derivedOutcomesMatch = derivedOutcomesMatch;
	dimensions.derivedReasonMatchesRecorded = derivedReasonMatchesRecorded;
	dimensions.allProbesPassed = allProbesPassed;

	// ---- 10. identity binding (head/tree/subject) ----------------------

	let recordedIdentityMatchesBundle = true;
	for (const { probeId, record } of allParserResults) {
		if (executionHeadOid !== null && record.execution_head_oid !== executionHeadOid) {
			recordedIdentityMatchesBundle = false;
			initial.identityMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "identity-mismatch",
				message: `native-probe \`${probeId}\` execution_head_oid disagrees with bundle: recorded=${record.execution_head_oid} bundle=${executionHeadOid}`,
			});
		}
		if (executionTreeOid !== null && record.execution_tree_oid !== executionTreeOid) {
			recordedIdentityMatchesBundle = false;
			initial.identityMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "identity-mismatch",
				message: `native-probe \`${probeId}\` execution_tree_oid disagrees with bundle: recorded=${record.execution_tree_oid} bundle=${executionTreeOid}`,
			});
		}
		if (filteredSubjectTreeOid !== null && record.subject_tree_oid !== filteredSubjectTreeOid) {
			recordedIdentityMatchesBundle = false;
			initial.identityMismatches.push(probeId);
			initial.diagnostics.push({
				probeId,
				kind: "identity-mismatch",
				message: `native-probe \`${probeId}\` subject_tree_oid disagrees with bundle: recorded=${record.subject_tree_oid} bundle=${filteredSubjectTreeOid}`,
			});
		}
	}
	dimensions.recordedIdentityMatchesBundle = recordedIdentityMatchesBundle;

	// ---- 11. aggregate + finalize -----------------------------------

	const probesOut: Record<NativeProbeId, NativeProbeViewRecord | null> = emptyProbes();
	for (const [id, view] of probeSummaries) probesOut[id] = view;

	const complete = (() => {
		if (inventoryHostClass === null) return false;
		if (initial.diagnostics.length > 0) return false;
		if (!recordedIdentityMatchesBundle) return false;
		return (
			dimensions.streamLayoutValid &&
			dimensions.streamPathsCanonical &&
			dimensions.externalStreamsComplete &&
			dimensions.externalStreamHashesValid &&
			dimensions.embeddedStreamsConsistent &&
			dimensions.metadataPayloadsComplete &&
			dimensions.metadataHashesValid &&
			dimensions.metadataRecordsEqual &&
			dimensions.derivedOutcomesMatch &&
			dimensions.allProbesPassed &&
			dimensions.catalogueMatches &&
			dimensions.hostClassMatchesBundle &&
			dimensions.artifactBytesValid &&
			dimensions.recordedIdentityMatchesBundle &&
			dimensions.derivedReasonMatchesRecorded
		);
	})();
	initial.complete = complete;
	initial.probes = probesOut;
	return buildView(initial, dimensions);
}

/**
 * µC-3 — tracked-mirror reader. The tracked file at
 * `factory/inventories/native-probes.json` is INFORMATIONAL only; the
 * authoritative copy lives inside the detached evidence bundle and
 * this reader MUST always return `complete=false` so the closure cannot
 * mistake a tracked-mirror read for an authoritative one.
 *
 * The reader still parses the legacy CORRECTION15 placeholder fields
 * so existing call-sites and tests that need to verify a tracked file
 * was actually written (e.g. historical archival) keep working. The
 * µC-3 explicit dimensions are all returned `false`.
 */
export function loadNativeProbesInventory(inventoryPath: string): NativeProbesView {
	const initial = initialView();
	initial.source = "tracked";
	const dimensions = emptyDimensions();
	if (!existsSync(inventoryPath)) {
		initial.diagnostics = missingInventoryDiagnostics(`tracked inventory at ${inventoryPath}`);
		initial.complete = false;
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
		initial.complete = false;
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
		initial.complete = false;
		return buildView(initial, dimensions);
	}
	const record = parsed as Record<string, unknown>;
	const nestedRecord =
		record.probes !== null &&
		typeof record.probes === "object" &&
		!Array.isArray(record.probes)
			? (record.probes as Record<string, unknown>)
			: null;
	for (const probeId of NATIVE_PROBE_IDS) {
		const raw = nestedRecord === null ? record[probeId] : nestedRecord[probeId];
		if (raw === undefined) {
			initial.diagnostics.push({
				probeId,
				kind: "missing-inventory",
				message: `native-probe key \`${probeId}\` is absent from the tracked inventory`,
			});
			continue;
		}
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			initial.diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message: `native-probe entry \`${probeId}\` must be a JSON object`,
			});
			continue;
		}
		const v = raw as Record<string, unknown>;
		let shapeOk = true;
		for (const field of ["id", "path", "architecture", "sha256", "file_format", "reason"]) {
			if (typeof v[field] !== "string" || (v[field] as string).length === 0) {
				initial.diagnostics.push({
					probeId,
					kind: "invalid-shape",
					message: `native-probe \`${probeId}\` missing or empty legacy field \`${field}\``,
				});
				shapeOk = false;
			}
		}
		if (typeof v.sha256 === "string" && !/^[0-9a-f]{64}$/.test(v.sha256 as string)) {
			initial.diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message: `native-probe \`${probeId}\` sha256 is not a 64-character lowercase hex string`,
			});
			shapeOk = false;
		}
		const status = v.status;
		if (status === "pass") {
			// pass is recorded but does not flip complete=true for the
			// tracked mirror (see P0.7).
		} else if (status === "deferred") {
			initial.diagnostics.push({
				probeId,
				kind: "deferred",
				message: `native-probe \`${probeId}\` status=deferred; runner deferred this probe to a future pass`,
			});
		} else if (status === "fail") {
			initial.diagnostics.push({
				probeId,
				kind: "non-pass",
				message: `native-probe \`${probeId}\` status=fail; reason=${typeof v.reason === "string" ? v.reason : "<no reason recorded>"}`,
			});
		} else {
			initial.diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message: `native-probe \`${probeId}\` status is not one of pass|fail|deferred (got \`${JSON.stringify(status)}\`)`,
			});
			shapeOk = false;
		}
		if (!shapeOk) continue;
		initial.probes[probeId] = {
			id: probeId,
			path: v.path as string,
			architecture: v.architecture as string,
			sha256: v.sha256 as string,
			file_format: v.file_format as string,
			status: "pass",
			reason: v.reason as string,
		};
	}
	// P0.7 — tracked inventory is permanently informational. No matter
	// how clean the legacy fields are, `complete` MUST be false so the
	// closure cannot satisfy the native-probe dimension from the mirror.
	initial.complete = false;
	return buildView(initial, dimensions);
}
