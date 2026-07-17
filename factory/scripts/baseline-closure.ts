#!/usr/bin/env bun
/**
 * ACT-CLINEMM-FORK-BASELINE01-CORRECTION05 — Closure logic (pure).
 *
 * The renderer (`render-baseline-report.ts`) imports the helpers from this
 * module so that the verdict logic is independently testable. Importing this
 * module has no side effects — it does not read the working tree, write any
 * file, or spawn git. The renderer's main entry performs I/O and calls into
 * `computeClosure` / `checkEvidence`.
 *
 * Policy (CORRECTION05, fail-closed):
 *
 *   FAIL      evidence is missing, stale, or hash-invalid; OR there are
 *             UNKNOWN-classified failures with no investigation note.
 *   PARTIAL   evidence is internally valid and command-set-exact, the
 *             UNKNOWN policy is satisfied, but at least one declared
 *             baseline requirement (R4/R5/R6/R7/R16) remains open.
 *   PASS      every requirement is satisfied and all mandatory commands
 *             pass on the binding host.
 *
 * Evidence must satisfy ALL of the following simultaneously:
 *
 *   - evidence file exists
 *   - subject (HEAD) matches current HEAD
 *   - tree matches current HEAD^{tree}
 *   - hash manifest is present, well-formed, duplicate-free, and every
 *     declared path exists and matches its declared SHA-256
 *   - every executed command has a matching evidence row (and vice versa)
 *   - all executed commands share a single execution tree value
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

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
	reason: "missing" | "unexpected";
}

export interface HashMismatch {
	path: string;
	expected: string; // declared SHA-256 (lowercase)
	actual: string; // computed SHA-256 (lowercase)
}

export interface MalformedLine {
	line: number; // 1-based line number in the manifest
	content: string; // the offending line, truncated to 80 chars
}

export interface DuplicatePath {
	path: string;
	occurrences: number;
}

/**
 * The complete integrity picture for the detached evidence bundle. Every
 * dimension must be satisfied for the verdict to not be FAIL on evidence
 * grounds; see `computeClosure`.
 */
export interface EvidenceView {
	/** The evidence.json file existed and was JSON-decodable. */
	exists: boolean;
	/** evidence.head_oid === git rev-parse HEAD on the closing snapshot. */
	subjectMatches: boolean;
	/** evidence.tree_oid === git rev-parse HEAD^{tree} on the closing snapshot. */
	treeMatches: boolean;
	/** Manifest is well-formed and every declared path matches its declared hash. */
	hashManifestValid: boolean;
	/** Paths declared in the manifest but absent on disk under the closing tree. */
	missingFiles: PathDiagnostic[];
	/** Files present on disk under the detached evidence directory but not in the manifest. */
	unexpectedFiles: PathDiagnostic[];
	/** Per-file hash mismatches, with both expected and actual values. */
	hashMismatches: HashMismatch[];
	/** Lines in hashes.sha256 that do not match the canonical `<sha>  <path>` format. */
	malformedLines: MalformedLine[];
	/** Paths that appear more than once in the manifest. */
	duplicatePaths: DuplicatePath[];
	/** Every executed command has an evidence record and every evidence record has an executed command. */
	commandSetExact: boolean;
	/** Distinct tree values appearing in evidence.commands[].tree_oid; a valid bundle has exactly one. */
	executionTrees: string[];
}

export interface ClosureInput {
	evidence: EvidenceView;
	unknownFailures: string[];
	/** Count of evidence-shape UNKNOWN classifications across the matrix (snapshot). */
	unknownFailureCount: number;
	mandatoryPass: number;
	mandatoryFail: number;
	mandatoryApplicable: number;
	affectedScopePass: number;
	affectedScopeFail: number;
	affectedScopeApplicable: number;
	/** R4: full production-tree comparison vs selected upstream OID. */
	r4Satisfied: boolean;
	/** R5: real JSON Schema validation of every tracked inventory. */
	r5Satisfied: boolean;
	/** R6: structural baseline regenerated from the upstream tree (no self-contamination). */
	r6Satisfied: boolean;
	/** R7: cross-platform CI evidence bound to a recorded run id. */
	r7Satisfied: boolean;
	/** R16: verification discovery is a real source-derived scan. */
	r16Satisfied: boolean;
}

export interface ClosureResult {
	verdict: Verdict;
	/** Internal shorthand for the renderer — true iff every evidence dimension is satisfied. */
	evidenceOk: boolean;
	r4: boolean;
	r5: boolean;
	r6: boolean;
	r7: boolean;
	r16: boolean;
	/** Stable, machine-readable reason codes for the verdict. */
	reasonCodes: ReasonCode[];
	/** Aggregated count of unknown-classified failures (evidence-class + snapshot-class). */
	unknownFailureCount: number;
}

/**
 * Compute the closure verdict. Pure — same input always produces the same
 * output. The renderer must reflect `verdict` faithfully: stale evidence
 * (subject/tree/hash/manifest/command-set/multi-tree) is a hard FAIL.
 */
export function computeClosure(input: ClosureInput): ClosureResult {
	const r4 = input.r4Satisfied;
	const r5 = input.r5Satisfied;
	const r6 = input.r6Satisfied;
	const r7 = input.r7Satisfied;
	const r16 = input.r16Satisfied;

	// Aggregate "unknown" presence: every UNKNOWN classification blocks closure
	// until it is reproduced and assigned a real failure category.
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

	// 1) Invalid evidence is the most fundamental fail-closed state.
	if (!evidenceOk) reasonCodes.push("EVIDENCE_INCOMPLETE");
	// 2) UNKNOWN-without-investigation blocks closure regardless of evidence.
	if (hasUnknown) reasonCodes.push("UNKNOWN_FAILURES_PRESENT");
	// 3) Each open requirement records its individual reason.
	if (!r4) reasonCodes.push("R4_UNSATISFIED");
	if (!r5) reasonCodes.push("R5_UNSATISFIED");
	if (!r6) reasonCodes.push("R6_UNSATISFIED");
	if (!r7) reasonCodes.push("R7_UNSATISFIED");
	if (!r16) reasonCodes.push("R16_UNSATISFIED");
	// 4) Mandatory not-all-pass is recorded separately so a PARTIAL with
	//    would-be-otherwise-PASS evidence surfaces the gap.
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
 * single source of truth used by both `computeClosure` and the tests; do not
 * re-derive `evidenceOk` ad-hoc elsewhere.
 */
export function isEvidenceOk(e: EvidenceView): boolean {
	return (
		e.exists &&
		e.subjectMatches &&
		e.treeMatches &&
		e.hashManifestValid &&
		e.missingFiles.length === 0 &&
		e.unexpectedFiles.length === 0 &&
		e.hashMismatches.length === 0 &&
		e.malformedLines.length === 0 &&
		e.duplicatePaths.length === 0 &&
		e.commandSetExact &&
		e.executionTrees.length === 1
	);
}

// ---------- structured evidence check ---------------------------------------

interface CheckEvidenceArgs {
	/** The decoded evidence.json, or null when the file is missing. */
	ev: any;
	/** Raw text of hashes.sha256, or empty string when missing. */
	hashesText: string;
	/** Absolute path to the detached evidence directory (containing evidence.json, hashes.sha256, commands/). */
	evDirAbs: string;
	/** The executed_commands[] slice of verification-results.json. */
	executedCmds: any[];
	/** Repository root, used to resolve relative manifest paths from hashes.sha256. */
	rootAbs: string;
	/** `git rev-parse HEAD` for the closing snapshot. */
	headOidNow: string;
	/** `git rev-parse HEAD^{tree}` for the closing snapshot. */
	treeOidNow: string;
}

/**
 * Compute every dimension of the EvidenceView. Reads files on disk; does
 * not mutate anything. Errors reading individual files surface as
 * structured diagnostics (missing/duplicate/malformed) rather than thrown
 * exceptions — the renderer treats these as evidence-integrity failures.
 */
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
	};

	if (!ev) return out;

	// Subject (HEAD) and tree.
	out.subjectMatches = typeof ev.head_oid === "string" && ev.head_oid === headOidNow;
	out.treeMatches = typeof ev.tree_oid === "string" && ev.tree_oid === treeOidNow;

	// Command-set exactness + distinct execution trees.
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
	for (const id of evidenceIds) if (!executedIds.has(id)) extraInEvidence.add(id);
	out.commandSetExact = missingExecs.length === 0 && extraInEvidence.length === 0;
	out.executionTrees = Array.from(executionTrees);

	// Hash manifest parse + per-line validity.
	const parsed = parseManifest(hashesText);
	out.malformedLines = parsed.malformed;
	out.duplicatePaths = parsed.duplicates;

	// Path existence + per-file hash verification.
	const missingFiles: PathDiagnostic[] = [];
	const hashMismatches: HashMismatch[] = [];
	for (const [path, expected] of parsed.declared.entries()) {
		const abs = resolveManifestPath(rootAbs, path);
		if (!existsSync(abs)) {
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

	// Unexpected files: anything on disk under the detached evidence dir that
	// the manifest does not acknowledge. Manifest paths are repo-root-relative
	// in production, so we resolve each declared path against `rootAbs` and
	// then strip the evidence-dir prefix to get the inside-evidence-dir form.
	out.unexpectedFiles = scanUnexpected(evDirAbs, rootAbs, parsed.declared);

	out.hashManifestValid =
		out.malformedLines.length === 0 &&
		out.duplicatePaths.length === 0 &&
		out.missingFiles.length === 0 &&
		out.hashMismatches.length === 0;

	return out;
}

// ---------- internal helpers (exported for tests) ---------------------------

interface ParsedManifest {
	declared: Map<string, string>; // path -> expected sha256 (lowercase)
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

function resolveManifestPath(rootAbs: string, declared: string): string {
	if (isAbsolute(declared)) return declared;
	return join(rootAbs, declared);
}

function scanUnexpected(
	evDirAbs: string,
	rootAbs: string,
	declared: Map<string, string>,
): PathDiagnostic[] {
	if (!existsSync(evDirAbs)) return [];
	const out: PathDiagnostic[] = [];
	// Manifest paths are repo-root-relative: resolve each to an absolute path
	// and strip the evidence-dir prefix so we can compare against the
	// inside-evidence-dir relative paths produced by `walk`.
	const declaredInside = new Set<string>();
	for (const p of declared.keys()) {
		const abs = isAbsolute(p) ? p : join(rootAbs, p);
		const inside = normalizeRelative(relative(evDirAbs, abs));
		if (inside.length > 0 && !inside.startsWith("..")) {
			declaredInside.add(inside);
		}
	}
	walk(evDirAbs, (abs) => {
		const rel = normalizeRelative(relative(evDirAbs, abs));
		if (rel.length === 0) return;
		if (rel.endsWith(".tmp") || rel.endsWith(".swp")) return; // editor debris
		if (!declaredInside.has(rel)) {
			out.push({ path: rel, reason: "unexpected" });
		}
	});
	return out;
}

function walk(absDir: string, visit: (abs: string) => void): void {
	let entries: string[];
	try {
		entries = readdirSync(absDir);
	} catch {
		return;
	}
	for (const name of entries) {
		const child = join(absDir, name);
		let st;
		try {
			st = statSync(child);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			// Skip worktree junk that is committed into the bundle.
			if (name === "node_modules" || name === ".git") continue;
			walk(child, visit);
		} else if (st.isFile()) {
			visit(child);
		}
	}
}

function normalizeRelative(p: string): string {
	// Normalize to forward-slash relative path; tests assert on this form.
	return p.split(sep).join("/");
}
