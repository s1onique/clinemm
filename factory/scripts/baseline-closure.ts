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
 * CORRECTION15 native-probe diagnostic. Each entry describes one structured
 * failure mode: an absent inventory, a malformed JSON payload, a missing
 * probe key, an invalid probe shape, a deferred probe, or a probe that
 * finished with anything other than status="pass". The renderer surfaces
 * these in the report so reviewers can distinguish "we did not probe" from
 * "we probed and the artifact is missing".
 */
export interface NativeProbeDiagnostic {
	probeId: NativeProbeId;
	kind:
		| "missing-inventory"
		| "malformed-json"
		| "missing-key"
		| "invalid-shape"
		| "deferred"
		| "non-pass";
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

export interface NativeProbe {
	id: NativeProbeId;
	path: string;
	architecture: string;
	sha256: string;
	file_format: string;
	status: "pass";
	reason: string;
}

/**
 * Result of loading and validating the native-probe inventory. `complete` is
 * true only when every required probe key is present, well-formed, and has
 * status "pass". Any absent, malformed, deferred, unknown, or failed probe
 * makes `complete` false; the renderer and runner surface the structured
 * diagnostics so reviewers can see which dimension failed.
 */
export interface NativeProbesView {
	complete: boolean;
	probes: Record<NativeProbeId, NativeProbe | null>;
	diagnostics: NativeProbeDiagnostic[];
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

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
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
	if (typeof value.exit_code !== "number" && !(role === "evidence" && value.exit_code === null)) {
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
			if (value.signal !== null) pushField("signal");
			if (isTimeout) pushField("timeout");
		} else if (value.status === "fail") {
			if (fcIsNull) pushField("failure_classification");
			if (isTimeout && !fcIsTimeout) pushField("failure_classification");
			if (!fcIsString) pushField("failure_classification");
		} else if (value.status === "skip" || value.status === "unavailable") {
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
		e.decodeError === null
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
					reason: `<json-parse-error:${error instanceof Error ? error.message : String(error)}>`,
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

	if (expectedEvidencePayloadPaths !== null) {
		const derivedExpected = ["evidence.json", "verification-results.json", ...commandPayloadPaths];
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

// ---------- CORRECTION15 native-probe inventory loader ---------------------

/**
 * Default location of the native-probe inventory inside the repository.
 * The renderer and runner both read from this path; tests can pass an
 * explicit inventory through `checkEvidence` to override.
 */
export const NATIVE_PROBES_INVENTORY_PATH = "factory/inventories/native-probes.json";

const PROBE_REQUIRED_STRING_FIELDS = [
	"id",
	"path",
	"architecture",
	"sha256",
	"file_format",
	"reason",
] as const;

/**
 * Load and structurally validate the native-probe inventory. The inventory
 * is a JSON object with one entry per probe key in `NATIVE_PROBE_IDS`. Each
 * entry must be a well-formed object with the required string fields and a
 * status of exactly "pass". Anything else produces a structured diagnostic
 * and leaves the probe marked as null in the returned view.
 *
 * The helper is fail-closed: a missing inventory, malformed JSON, missing
 * key, invalid shape, deferred status, unknown status, or non-pass status
 * all leave `complete` false. The renderer surfaces the structured
 * diagnostics so reviewers can distinguish "we did not probe" from "we
 * probed and the artifact is missing".
 */
export function loadNativeProbesInventory(inventoryPath: string): NativeProbesView {
	const probes = {} as Record<NativeProbeId, NativeProbe | null>;
	for (const probeId of NATIVE_PROBE_IDS) probes[probeId] = null;
	const diagnostics: NativeProbeDiagnostic[] = [];

	if (!existsSync(inventoryPath)) {
		for (const probeId of NATIVE_PROBE_IDS) {
			diagnostics.push({
				probeId,
				kind: "missing-inventory",
				message: `native-probe inventory not found at ${inventoryPath}`,
			});
		}
		return { complete: false, probes, diagnostics };
	}

	let parsed: unknown;
	try {
		const text = readFileSync(inventoryPath, "utf8");
		parsed = JSON.parse(text);
	} catch (error) {
		for (const probeId of NATIVE_PROBE_IDS) {
			diagnostics.push({
				probeId,
				kind: "malformed-json",
				message: `native-probe inventory JSON could not be parsed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			});
		}
		return { complete: false, probes, diagnostics };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		for (const probeId of NATIVE_PROBE_IDS) {
			diagnostics.push({
				probeId,
				kind: "malformed-json",
				message: "native-probe inventory root must be a JSON object",
			});
		}
		return { complete: false, probes, diagnostics };
	}
	const record = parsed as Record<string, unknown>;

	let complete = true;
	for (const probeId of NATIVE_PROBE_IDS) {
		const entry = record[probeId];
		if (entry === undefined) {
			complete = false;
			diagnostics.push({
				probeId,
				kind: "missing-key",
				message: `native-probe key \`${probeId}\` is absent from the inventory`,
			});
			continue;
		}
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			complete = false;
			diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message: `native-probe entry for \`${probeId}\` must be an object`,
			});
			continue;
		}
		const probeValue = entry as Record<string, unknown>;
		const missingField = PROBE_REQUIRED_STRING_FIELDS.find(
			(field) => typeof probeValue[field] !== "string",
		);
		if (missingField) {
			complete = false;
			diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message: `native-probe entry for \`${probeId}\` is missing string field \`${missingField}\``,
			});
			continue;
		}
		const sha = probeValue.sha256 as string;
		if (!SHA256_PATTERN.test(sha)) {
			complete = false;
			diagnostics.push({
				probeId,
				kind: "invalid-shape",
				message: `native-probe entry for \`${probeId}\` has an invalid sha256`,
			});
			continue;
		}
		const status = probeValue.status;
		if (status === "deferred" || status === "unknown") {
			complete = false;
			diagnostics.push({
				probeId,
				kind: "deferred",
				message: `native-probe \`${probeId}\` is deferred (status=${status})`,
			});
			continue;
		}
		if (status !== "pass") {
			complete = false;
			diagnostics.push({
				probeId,
				kind: "non-pass",
				message: `native-probe \`${probeId}\` reported status=${JSON.stringify(status)}`,
			});
			continue;
		}
		probes[probeId] = {
			id: probeId,
			path: probeValue.path as string,
			architecture: probeValue.architecture as string,
			sha256: sha,
			file_format: probeValue.file_format as string,
			status: "pass",
			reason: probeValue.reason as string,
		};
	}

	return { complete, probes, diagnostics };
}
