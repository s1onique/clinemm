#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION06 — Closure logic (pure).
 *
 * The renderer (`render-baseline-report.ts`) imports the helpers from this
 * module so the verdict logic is independently testable. Importing this
 * module has no side effects — it does not read the working tree, write any
 * file, or spawn git. The renderer's main entry performs I/O and calls into
 * `computeClosure` / `checkEvidence`.
 *
 * Policy (CORRECTION06, fail-closed):
 *
 *   FAIL      evidence is missing, stale, hash-invalid, multi-tree,
 *             command-set-mismatched, symlinked, or path-traversing; OR
 *             there are UNKNOWN-classified failures with no investigation
 *             note.
 *   PARTIAL   evidence is internally valid and command-set-exact (incl. per-
 *             record equality), the UNKNOWN policy is satisfied, but at
 *             least one declared baseline requirement (R4/R5/R6/R7/R16)
 *             remains open.
 *   PASS      every requirement is satisfied and all mandatory commands
 *             pass on the binding host.
 *
 * Every evidence dimension must hold simultaneously for the verdict to not
 * be FAIL on evidence grounds:
 *
 *   - evidence.json exists
 *   - subject matches current HEAD
 *   - tree matches current HEAD^{tree}
 *   - the single execution tree value equals the bound tree (executionTreeBound)
 *   - hash manifest is well-formed, duplicate-free, contains no
 *     traversal/absolute paths, and every declared payload path exists,
 *     matches its declared SHA-256, and is not a symlink
 *   - on-disk non-control files in the evidence directory are all declared
 *     in the manifest (hashes.sha256 itself is a control file and exempt)
 *   - every executed command has exactly one matching evidence row, no
 *     duplicates in either set, and per-ID field equality
 *     (status, head/tree, exit_code, timeout, hashes, classification)
 */

import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

// ---------- public types ----------------------------------------------------

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
	reason: "missing" | "unexpected" | "symlink" | "traversal" | "absolute";
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

export interface EvidenceView {
	/** The evidence.json file existed and was JSON-decodable. */
	exists: boolean;
	/** evidence.head_oid === git rev-parse HEAD. */
	subjectMatches: boolean;
	/** evidence.tree_oid === git rev-parse HEAD^{tree}. */
	treeMatches: boolean;
	/** Manifest is well-formed and every declared path matches its declared hash. */
	hashManifestValid: boolean;
	/** Paths declared in the manifest but absent on disk. */
	missingFiles: PathDiagnostic[];
	/** On-disk non-control files in the evidence directory not declared in the manifest. */
	unexpectedFiles: PathDiagnostic[];
	/** Per-file hash mismatches, with both expected and actual values. */
	hashMismatches: HashMismatch[];
	/** Lines in hashes.sha256 that do not match the canonical `<sha>  <path>` format. */
	malformedLines: MalformedLine[];
	/** Paths that appear more than once in the manifest. */
	duplicatePaths: DuplicatePath[];
	/** All command-set checks pass (no missing/extra IDs, no duplicates, no per-record mismatches). */
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
	/** Paths in the manifest that were rejected for being absolute / traversing outside the repo. */
	rejectedManifestPaths: PathDiagnostic[];
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
	r4: boolean;
	r5: boolean;
	r6: boolean;
	r7: boolean;
	r16: boolean;
	reasonCodes: ReasonCode[];
	unknownFailureCount: number;
}

// ---------- control files ---------------------------------------------------

/**
 * Files that may exist on disk inside the evidence directory but are not
 * included in the manifest. The manifest itself, `hashes.sha256`, is a
 * control file: it documents the payloads it covers, but it is not itself
 * a payload. Excluding it from `unexpectedFiles` makes the bundle
 * satisfiable.
 *
 * `.tmp` and `.swp` debris are NOT broadly exempt — strict closure rejects
 * undeclared files. Operators should not leave editor temp files in the
 * bundle; if they do, they are flagged as unexpected.
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
		r4,
		r5,
		r6,
		r7,
		r16,
		reasonCodes,
		unknownFailureCount: unknownCount,
	};
}

/**
 * True iff every dimension of the evidence view is satisfied. This is the
 * single source of truth used by both `computeClosure` and the tests; do
 * not re-derive `evidenceOk` ad-hoc elsewhere.
 */
export function isEvidenceOk(e: EvidenceView): boolean {
	return (
		e.exists &&
		e.subjectMatches &&
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
		e.rejectedManifestPaths.length === 0
	);
}

// ---------- structured evidence check ---------------------------------------

interface CheckEvidenceArgs {
	ev: any;
	hashesText: string;
	evDirAbs: string;
	executedCmds: any[];
	rootAbs: string;
	headOidNow: string;
	treeOidNow: string;
}

export function checkEvidence(args: CheckEvidenceArgs): EvidenceView {
	const { ev, hashesText, evDirAbs, executedCmds, rootAbs, headOidNow, treeOidNow } = args;

	const out: EvidenceView = {
		exists: ev != null,
		subjectMatches: false,
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
	};

	if (!ev) return out;

	// Subject (HEAD) and tree.
	out.subjectMatches = typeof ev.head_oid === "string" && ev.head_oid === headOidNow;
	out.treeMatches = typeof ev.tree_oid === "string" && ev.tree_oid === treeOidNow;

	// Command-set: collect IDs and detect duplicates + per-record mismatches.
	const evidenceIds = new Set<string>();
	const executionTrees = new Set<string>();
	if (Array.isArray(ev.commands)) {
		for (const c of ev.commands) {
			if (c && typeof c.id === "string") evidenceIds.add(c.id);
			if (c && typeof c.tree_oid === "string" && c.tree_oid.length > 0) {
				executionTrees.add(c.tree_oid);
			}
		}
	}
	const executedIds = new Set<string>();
	for (const e of executedCmds) {
		if (e && typeof e.id === "string") executedIds.add(e.id);
	}
	const missingExecs: string[] = [];
	const extraInEvidence: string[] = [];
	for (const id of executedIds) if (!evidenceIds.has(id)) missingExecs.push(id);
	for (const id of evidenceIds) if (!executedIds.has(id)) extraInEvidence.push(id);
	out.executionTrees = Array.from(executionTrees);

	const dup = compareCommandRecords(ev.commands ?? [], executedCmds);
	out.duplicateEvidenceCommandIds = dup.duplicateEvidenceCommandIds;
	out.duplicateExecutedCommandIds = dup.duplicateExecutedCommandIds;
	out.commandRecordMismatches = dup.commandRecordMismatches;

	out.commandSetExact =
		missingExecs.length === 0 &&
		extraInEvidence.length === 0 &&
		out.duplicateEvidenceCommandIds.length === 0 &&
		out.duplicateExecutedCommandIds.length === 0 &&
		out.commandRecordMismatches.length === 0;

	// Execution-tree binding: the single execution tree must equal both
	// evidence.tree_oid AND the current closing tree.
	const evTree = typeof ev.tree_oid === "string" ? ev.tree_oid : null;
	const execTree = executionTrees.size === 1 ? Array.from(executionTrees)[0] : null;
	out.executionTreeBound =
		evTree !== null && execTree !== null && evTree === execTree && evTree === treeOidNow;

	// Hash manifest parse + per-line validity. Use the structured parse that
	// handles upper/lower-case SHAs, malformed lines, and duplicate paths.
	const parsed = parseManifest(hashesText);
	out.malformedLines = parsed.malformed;
	out.duplicatePaths = parsed.duplicates;

	// Path existence + per-file hash verification, with containment.
	const missingFiles: PathDiagnostic[] = [];
	const hashMismatches: HashMismatch[] = [];
	const rejected: PathDiagnostic[] = [];
	for (const [path, expected] of parsed.declared.entries()) {
		const resolved = resolveManifestPath(rootAbs, path);
		if (!resolved.ok) {
			// Map the internal sentinel to the public PathDiagnostic taxonomy.
			const publicReason: "absolute" | "traversal" =
				resolved.reason === "rejected_absolute" ? "absolute" : "traversal";
			rejected.push({ path, reason: publicReason });
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
			// Symlinks escaping the policy are flagged as missing-hash-wise;
			// the renderer renders them as part of hashMismatches is wrong; we
			// expose them through `unexpectedFiles` instead by recursing.
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

	// Unexpected files: any on-disk non-control, non-symlink file inside the
	// evidence directory that the manifest doesn't acknowledge. Symlinks are
	// reported separately below.
	const unexpected = scanUnexpected(evDirAbs, rootAbs, parsed.declared);
	const symlinks: PathDiagnostic[] = [];
	for (const u of unexpected) {
		if (u.reason === "symlink") symlinks.push(u);
		else out.unexpectedFiles.push(u);
	}
	// Already caught from `missingFiles` (declared-but-symlink) — surface
	// undeclared symlinks via unexpectedFiles for visibility.
	for (const s of symlinks) out.unexpectedFiles.push(s);

	out.hashManifestValid =
		out.malformedLines.length === 0 &&
		out.duplicatePaths.length === 0 &&
		out.missingFiles.length === 0 &&
		out.hashMismatches.length === 0 &&
		out.rejectedManifestPaths.length === 0;

	return out;
}

// ---------- helpers ---------------------------------------------------------

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
		if (occurrences > 1) duplicates.push({ path, occurrences });
	}
	return { declared, malformed, duplicates };
}

interface ResolveResult {
	ok: boolean;
	abs: string | null;
	reason: "rejected_absolute" | "rejected_traversal";
}

/**
 * Resolve a manifest path against the repo root, rejecting:
 *   - absolute paths (cannot be sandboxed)
 *   - paths whose resolution escapes the repo root
 * Containment under `evDirAbs` is enforced separately by `scanUnexpected`
 * via the inside-evidence-dir form.
 */
function resolveManifestPath(rootAbs: string, declared: string): ResolveResult {
	if (isAbsolute(declared)) return { ok: false, abs: null, reason: "rejected_absolute" };
	const abs = join(rootAbs, declared);
	const relToRoot = normalizeRelative(relative(rootAbs, abs));
	if (relToRoot.length === 0 || relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
		return { ok: false, abs: null, reason: "rejected_traversal" };
	}
	return { ok: true, abs, reason: null };
}

function scanUnexpected(
	evDirAbs: string,
	rootAbs: string,
	declared: Map<string, string>,
): PathDiagnostic[] {
	if (!existsSync(evDirAbs)) return [];
	const out: PathDiagnostic[] = [];
	// Build the set of declared inside-evidence-dir paths (so we can compare
	// against the on-disk walk). Reject anything that escapes root or the
	// evidence dir.
	const declaredInside = new Set<string>();
	for (const p of declared.keys()) {
		const resolved = resolveManifestPath(rootAbs, p);
		if (!resolved.ok || !resolved.abs) continue;
		const inside = normalizeRelative(relative(evDirAbs, resolved.abs));
		if (inside.length > 0 && !inside.startsWith("..") && inside !== ".") {
			declaredInside.add(inside);
		}
	}
	walk(evDirAbs, (abs, lst) => {
		if (lst.isSymbolicLink()) {
			// Symlinks are flagged as unexpected. Symlinked control files are
			// also flagged — the policy is strict.
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
