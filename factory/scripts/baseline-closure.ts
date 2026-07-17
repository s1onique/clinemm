#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION07 — Closure logic (pure).
 *
 * The renderer (`render-baseline-report.ts`) imports the helpers from this
 * module so the verdict logic is independently testable. Importing this
 * module has no side effects — it does not read the working tree, write any
 * file, or spawn git. The renderer's main entry performs I/O and calls into
 * `computeClosure` / `checkEvidence`.
 *
 * Policy (CORRECTION07, fail-closed + subject-tree binding):
 *
 *   FAIL      evidence is missing, malformed, stale-bound, hash-invalid,
 *             multi-tree, command-set-mismatched, symlinked, or
 *             outside-evidence-dir; OR there are UNKNOWN-classified
 *             failures with no investigation note.
 *   PARTIAL   evidence is internally valid and command-set-exact (incl. per-
 *             record equality), the UNKNOWN policy is satisfied, but at
 *             least one declared baseline requirement (R4/R5/R6/R7/R16)
 *             remains open.
 *   PASS      every requirement is satisfied and all mandatory commands
 *             pass on the binding host.
 *
 * CORRECTION07 binding model:
 *
 *   The report and the runner record both a `tree_oid`. When `tree_oid` of
 *   the detached evidence equals `git rev-parse HEAD^{tree}` on the closing
 *   snapshot, the bundle is bound to the worktree. `head_oid` is recorded
 *   for traceability but is NOT required to equal the enclosing HEAD —
 *   that literal-HEAD contract was identified as inherently unsatisfiable
 *   (regenerating a tracked closure report changes HEAD while the bundle
 *   was bound to the prior HEAD). Bind through `tree_oid`, not through
 *   `head_oid`. This makes the subject-tree model stable across
 *   regenerations and across commits that touch the closure tooling.
 *
 * Every evidence dimension must hold simultaneously for the verdict to
 * not be FAIL on evidence grounds:
 *
 *   - evidence.json exists and was JSON-decodable
 *   - evidence.head_oid is syntactically well-formed (information only)
 *   - evidence.tree_oid matches current HEAD^{tree}
 *   - the single execution tree value equals evidence.tree_oid and the
 *     current HEAD^{tree} (executionTreeBound)
 *   - hash manifest is well-formed, contained under the evidence directory,
 *     duplicate-free, contains no absolute/traversal paths, and every
 *     declared payload path exists, matches its declared SHA-256, and is
 *     not a symlink
 *   - on-disk non-control files in the evidence directory are all declared
 *     in the manifest (hashes.sha256 itself is a control file and exempt)
 *   - every executed command has exactly one matching evidence row, no
 *     duplicates in either set, no malformed rows, and per-ID field
 *     equality (status, head/tree, exit_code, timeout, hashes,
 *     classification)
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
	| "UNKNOWN_FAILURES_PRESENT"
	| "R4_UNSATISFIED"
	| "R5_UNSATISFIED"
	| "R6_UNSATISFIED"
	| "R7_UNSATISFIED"
	| "R16_UNSATISFIED"
	| "MANDATORY_NOT_ALL_PASS"
	| "AFFECTED_SCOPE_NOT_ALL_PASS";

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

/**
 * The complete integrity picture for the detached evidence bundle. Every
 * dimension must be satisfied for the verdict to not be FAIL on evidence
 * grounds; see `isEvidenceOk` and `computeClosure`.
 */
export interface EvidenceView {
	/** The evidence.json file existed and was JSON-decodable. */
	exists: boolean;
	/**
	 * Information-only: evidence.head_oid is a syntactically valid 40-char
	 * lowercase hex OID. This is NOT in the closure conjunction — the
	 * subject binding is `tree_oid`, not `head_oid` (CORRECTION07 model).
	 */
	headOidWellformed: boolean;
	/** evidence.tree_oid === git rev-parse HEAD^{tree} on the closing snapshot. */
	treeMatches: boolean;
	/** Manifest is well-formed and every declared path matches its declared hash. */
	hashManifestValid: boolean;
	/** Paths declared in the manifest but absent on disk under the evidence dir. */
	missingFiles: PathDiagnostic[];
	/** On-disk non-control files in the evidence directory not declared in the manifest. */
	unexpectedFiles: PathDiagnostic[];
	/** Per-file hash mismatches, with both expected and actual values. */
	hashMismatches: HashMismatch[];
	/** Lines in hashes.sha256 that do not match the canonical `<sha>  <path>` format. */
	malformedLines: MalformedLine[];
	/** Paths that appear more than once in the manifest. */
	duplicatePaths: DuplicatePath[];
	/** All command-set checks pass (no missing/extra IDs, no duplicates, no per-record mismatches, no malformed rows). */
	commandSetExact: boolean;
	/** Distinct tree values appearing in evidence.commands[].tree_oid; must be exactly one. */
	executionTrees: string[];
	/** The single execution tree equals evidence.tree_oid AND current HEAD^{tree}. */
	executionTreeBound: boolean;
	/** Command IDs that appear more than once in evidence.commands[]. */
	duplicateEvidenceCommandIds: DuplicatePath[];
	/** Command IDs that appear more than once in executed_commands[]. */
	duplicateExecutedCommandIds: DuplicatePath[];
	/** Per-ID field comparison mismatches between evidence row and executed row. */
	commandRecordMismatches: CommandRecordMismatch[];
	/** Manifest paths that were rejected for being absolute or escaping the repo root. */
	rejectedManifestPaths: PathDiagnostic[];
	/** Manifest paths that resolve inside the repo but outside `evDirAbs`. */
	outOfEvidenceDirPaths: PathDiagnostic[];
	/** Count of evidence rows whose `id` is absent or non-string (silently dropped by set membership). */
	malformedEvidenceCommandRows: number;
	/** Count of executed rows whose `id` is absent or non-string. */
	malformedExecutedCommandRows: number;
	/** `JSON.parse` error from `evidence.json`, or `null` if it decoded. */
	decodeError: string | null;
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
}

export interface ClosureResult {
	verdict: Verdict;
	evidenceOk: boolean;
	reasonCodes: ReasonCode[];
	unknownFailureCount: number;
}

// ---------- control files ---------------------------------------------------

/**
 * Files that may exist on disk inside the evidence directory but are not
 * included in the payload manifest. The manifest itself, `hashes.sha256`,
 * is a control file: it documents the payloads it covers, but it is not
 * itself a payload. Excluding it from `unexpectedFiles` makes the bundle
 * satisfiable (CORRECTION06 R1).
 *
 * No broad `.tmp` / `.swp` exemption — strict closure rejects undeclared
 * debris.
 */
export const CONTROL_FILES: ReadonlySet<string> = new Set(["hashes.sha256"]);

const RECORD_COMPARE_FIELDS = [
	"status",
	"head_oid",
	"tree_oid",
	"exit_code",
	"timeout",
	"stdout_sha256",
	"stderr_sha256",
	"environment_sha256",
	"failure_classification",
] as const;

/** Regex for a syntactically well-formed git SHA-1 OID. */
const OID_PATTERN = /^[0-9a-f]{40}$/;

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
	} else if (r4 && r5 && r6 && r7 && r16 && allMandatoryPass && allAffectedPass) {
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
 * single source of truth used by both `computeClosure` and the tests; do
 * not re-derive `evidenceOk` ad-hoc elsewhere.
 *
 * CORRECTION07: `subjectMatches` is gone. The subject binding is the
 * tree, not the enclosing commit. The check is `treeMatches`.
 */
export function isEvidenceOk(e: EvidenceView): boolean {
	return (
		e.exists &&
		e.treeMatches &&
		e.executionTreeBound &&
		e.hashManifestValid &&
		e.missingFiles.length === 0 &&
		e.unexpectedFiles.length === 0 &&
		e.hashMismatches.length === 0 &&
		e.malformedLines.length === 0 &&
		e.duplicatePaths.length === 0 &&
		e.commandSetExact &&
		e.executionTrees.length === 1 &&
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

interface CheckEvidenceArgs {
	/** The decoded evidence.json, or a parse-error sentinel if it was malformed. */
	ev: { ok: boolean; value: unknown; error: string | null };
	/** Raw text of hashes.sha256, or empty string when missing. */
	hashesText: string;
	/** Absolute path to the detached evidence directory. */
	evDirAbs: string;
	/** The executed_commands[] slice of verification-results.json. */
	executedCmds: any[];
	/** Repository root, used to resolve absolute manifest paths. */
	rootAbs: string;
	/** `git rev-parse HEAD` for the closing snapshot. */
	headOidNow: string;
	/** `git rev-parse HEAD^{tree}` for the closing snapshot. */
	treeOidNow: string;
}

export function checkEvidence(args: CheckEvidenceArgs): EvidenceView {
	const {
		ev,
		hashesText,
		evDirAbs,
		executedCmds,
		rootAbs,
		headOidNow: _headOidNow,
		treeOidNow,
	} = args;

	const out: EvidenceView = {
		exists: ev.ok,
		headOidWellformed: false,
		treeMatches: false,
		hashManifestValid: false,
		missingFiles: [],
		unexpectedFiles: [],
		hashMismatches: [],
		malformedLines: [],
		duplicatePaths: [],
		commandSetExact: false,
		executionTrees: [],
		executionTreeBound: false,
		duplicateEvidenceCommandIds: [],
		duplicateExecutedCommandIds: [],
		commandRecordMismatches: [],
		rejectedManifestPaths: [],
		outOfEvidenceDirPaths: [],
		malformedEvidenceCommandRows: 0,
		malformedExecutedCommandRows: 0,
		decodeError: ev.error,
	};

	const evObj = ev.ok && typeof ev.value === "object" && ev.value !== null ? (ev.value as any) : null;
	if (!evObj) return out;

	// Subject-tree binding (CORRECTION07): tree is the authority, not head.
	out.headOidWellformed =
		typeof evObj.head_oid === "string" && OID_PATTERN.test(evObj.head_oid);
	out.treeMatches = typeof evObj.tree_oid === "string" && evObj.tree_oid === treeOidNow;

	// Command-set: collect IDs and detect duplicates + per-record mismatches.
	const evidenceIds = new Set<string>();
	const executionTrees = new Set<string>();
	const evidenceCmds: any[] = [];
	if (Array.isArray(evObj.commands)) {
		for (const c of evObj.commands) {
			if (c == null) {
				out.malformedEvidenceCommandRows += 1;
				continue;
			}
			if (typeof c !== "object") {
				out.malformedEvidenceCommandRows += 1;
				continue;
			}
			const id = (c as any).id;
			if (typeof id !== "string" || id.length === 0) {
				out.malformedEvidenceCommandRows += 1;
				continue;
			}
			evidenceCmds.push(c);
			evidenceIds.add(id);
			const t = (c as any).tree_oid;
			if (typeof t === "string" && t.length > 0) executionTrees.add(t);
		}
	}

	const executedIds = new Set<string>();
	for (const e of executedCmds) {
		if (e == null || typeof e !== "object") {
			out.malformedExecutedCommandRows += 1;
			continue;
		}
		const id = (e as any).id;
		if (typeof id !== "string" || id.length === 0) {
			out.malformedExecutedCommandRows += 1;
			continue;
		}
		executedIds.add(id);
	}

	const missingExecs: string[] = [];
	const extraInEvidence: string[] = [];
	for (const id of executedIds) if (!evidenceIds.has(id)) missingExecs.push(id);
	for (const id of evidenceIds) if (!executedIds.has(id)) extraInEvidence.push(id);
	out.executionTrees = Array.from(executionTrees);

	const dup = compareCommandRecords(evidenceCmds, executedCmds);
	out.duplicateEvidenceCommandIds = dup.duplicateEvidenceCommandIds;
	out.duplicateExecutedCommandIds = dup.duplicateExecutedCommandIds;
	out.commandRecordMismatches = dup.commandRecordMismatches;

	out.commandSetExact =
		missingExecs.length === 0 &&
		extraInEvidence.length === 0 &&
		out.duplicateEvidenceCommandIds.length === 0 &&
		out.duplicateExecutedCommandIds.length === 0 &&
		out.commandRecordMismatches.length === 0 &&
		out.malformedEvidenceCommandRows === 0 &&
		out.malformedExecutedCommandRows === 0;

	// Execution-tree binding: the single execution tree must equal both
	// evidence.tree_oid AND the current closing tree.
	const evTree = typeof evObj.tree_oid === "string" ? evObj.tree_oid : null;
	const execTree = executionTrees.size === 1 ? Array.from(executionTrees)[0] : null;
	out.executionTreeBound =
		evTree !== null && execTree !== null && evTree === execTree && evTree === treeOidNow;

	// Hash manifest parse + per-line validity.
	const parsed = parseManifest(hashesText);
	out.malformedLines = parsed.malformed;
	out.duplicatePaths = parsed.duplicates;

	// Path existence + per-file hash verification, with containment to BOTH
	// the repo root AND the evidence directory (CORRECTION07).
	const missingFiles: PathDiagnostic[] = [];
	const hashMismatches: HashMismatch[] = [];
	const rejected: PathDiagnostic[] = [];
	const outOfEvDir: PathDiagnostic[] = [];
	for (const [path, expected] of parsed.declared.entries()) {
		const resolved = resolveEvidencePayloadPath(evDirAbs, rootAbs, path);
		if (!resolved.ok) {
			if (resolved.reason === "outside-evidence-dir") {
				outOfEvDir.push({ path, reason: "outside-evidence-dir" });
			} else {
				rejected.push({ path, reason: resolved.reason });
			}
			continue;
		}
		const abs = resolved.abs as string;
		let lst;
		try {
			lst = lstatSync(abs);
		} catch {
			missingFiles.push({ path, reason: "missing" });
			continue;
		}
		if (lst.isSymbolicLink()) {
			missingFiles.push({ path, reason: "symlink" });
			continue;
		}
		if (!lst.isFile()) {
			missingFiles.push({ path, reason: "missing" });
			continue;
		}
		const actual = createHash("sha256").update(readFileSync(abs)).digest("hex");
		if (actual.toLowerCase() !== expected) {
			hashMismatches.push({ path, expected, actual: actual.toLowerCase() });
		}
	}
	out.missingFiles = missingFiles;
	out.hashMismatches = hashMismatches;
	out.rejectedManifestPaths = rejected;
	out.outOfEvidenceDirPaths = outOfEvDir;

	// Unexpected files: any on-disk non-control, non-symlink file inside the
	// evidence directory that the manifest doesn't acknowledge.
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

	return out;
}

// ---------- public helpers (exported for tests) -----------------------------

interface ParsedManifest {
	declared: Map<string, string>; // path (evidence-dir-relative) -> expected sha256 (lowercase)
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
		if (occurrences > 1) duplicates.push({ path, occurrences });
	}
	return { declared, malformed, duplicates };
}

/**
 * Evidence.json decoder result. `error` is non-null when JSON.parse threw.
 */
export type EvidenceLoad = {
	ok: boolean;
	value: unknown;
	error: string | null;
};

/** Decode evidence.json from disk; never throws. */
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

type ResolveResult =
	| { ok: true; abs: string; reason: null }
	| {
			ok: false;
			abs: null;
			reason: "rejected_absolute" | "rejected_traversal" | "outside-evidence-dir";
	  };

/**
 * Resolve a manifest path against the evidence directory (CORRECTION07
 * P0 #1). Strict containment: declared paths must resolve inside
 * `evDirAbs`. Absolute paths and traversal-escaping paths are rejected.
 * Outside-evidence-dir-but-inside-repo paths are kept separate under
 * `outside-evidence-dir` so the renderer can distinguish them.
 */
export function resolveEvidencePayloadPath(
	evDirAbs: string,
	rootAbs: string,
	declared: string,
): ResolveResult {
	if (typeof declared !== "string" || declared.length === 0) {
		return { ok: false, abs: null, reason: "rejected_traversal" };
	}
	if (isAbsolute(declared)) {
		return { ok: false, abs: null, reason: "rejected_absolute" };
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
		// Distinguish "escapes repo entirely" from "inside repo, outside evDir".
		const relToRoot = normalizeRelative(relative(normalizedRoot, abs));
		if (
			relToRoot === "" ||
			relToRoot === ".." ||
			relToRoot.startsWith(`..${sep}`) ||
			isAbsolute(relToRoot)
		) {
			return { ok: false, abs: null, reason: "rejected_traversal" };
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
		if (CONTROL_FILES.has(rel)) return; // control files exempt
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
			if (a === b) continue;
			if (a == null && b == null) continue;
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
