/**
 * Structured Command Risk -- Reader Path-Authority RED/GREEN
 *
 * ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
 *
 * Evidence classification:
 *   Section A (real-binary):   REAL_PRODUCTION_SEAM
 *   Section B (synthetic-TS):  SYNTHETIC_REAL / STRUCTURAL
 *
 * Scope: BOUNDED path-bearing reader families (`cat FILE`,
 * `head -N FILE`, `tail -N FILE`) integrated with the canonical
 * R0 path-authority machinery. Each command is required to:
 *
 *   - produce a positive V1 safe-rule match
 *     (`host_safe_cat`, `host_safe_head_path`, `host_safe_tail_path`)
 *   - have a parser-proven static operand for every reviewed
 *     argument (option + path)
 *   - bind to canonical host realpath evidence
 *     (per-operand identity + per-operand canonical containment)
 *
 * Adversarial matrix the reviewer demanded (this file is the
 * GREEN witness):
 *
 *   cat <inside-file>                    no evidence      -> ASK
 *   cat <outside-file>                   real evidence    -> ASK
 *   cat <inside-symlink-to-outside>      real evidence    -> ASK
 *   cat <inside-file> + evidence         real evidence    -> ALLOW
 *   cat README.md package.json + evidence                   -> ALLOW
 *   cat README.md /etc/passwd (1 outside operand)            -> ASK
 *   cat FILE 2>/dev/null + evidence                         -> ALLOW (neutral redirect composes)
 *   cat FILE > /tmp/x                                       -> ASK
 *   cat $HOME/file                                          -> ASK
 *
 *   head -30 <inside-file>               no evidence      -> ASK
 *   head -30 <outside-file>              real evidence    -> ASK
 *   head -30 <inside-file> + evidence                       -> ALLOW
 *   head -n 30 <inside-file> + evidence                     -> ALLOW
 *   head -- <inside-file> + evidence                       -> ALLOW
 *   head -30 <inside-symlink>            real evidence    -> ASK
 *   head $HOME/file                       real evidence    -> ASK (dynamic operand)
 *
 *   tail -20 <inside-file>               no evidence      -> ASK
 *   tail -20 <outside-file>              real evidence    -> ASK
 *   tail -20 <inside-file> + evidence                      -> ALLOW
 *   tail -n 20 <inside-file> + evidence                     -> ALLOW
 *   tail -20 <inside-symlink>             real evidence    -> ASK
 *
 *   Mixed pathless/path-bearing composition:
 *   cat README.md | head -30             real evidence for cat -> ALLOW
 *   cat /etc/passwd | head -30            real evidence for /etc -> ASK
 *   pwd && cat .factory/README.md         real evidence for cat -> ALLOW
 *
 *   R5 conservation (a reader does NOT lower aggregate risk):
 *   cat README.md && rm -rf "$HOME"                         -> never-auto-approve
 *   head -30 README.md && git branch -D __CLINEMM_SENTINEL__ -> never-auto-approve
 *
 * Stale-context attacks reuse the proven CORRECTION04 binder:
 *   cat <inside> + evidence from BROADER roots -> ASK
 *   cat <inside> + evidence from FOREIGN cwd   -> ASK
 *
 * Necessity ablation (Section C):
 *   Disable only the new reader-safe source registration ->
 *   cat <inside> + evidence -> ASK
 *   head -30 <inside> + evidence -> ASK
 *   tail -20 <inside> + evidence -> ASK
 *   Outside / symlink / wrong-evidence / stale-roots/cwd ->
 *   unchanged.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { commandHostAuthorization } from "./command-policy-types";
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "./command-safe-rules";
import { buildPathAuthorityEvidence } from "./path-authority-evidence-builder";
import { evaluateCommandPolicy } from "./index";

/* ---------------------------------------------------------------------- *
 * Real-filesystem fixture                                                 *
 * ---------------------------------------------------------------------- */

let TMP_ROOT: string;
let PROJECT_DIR: string;
let OUTSIDE_DIR: string;
let README_FILE: string;
let PACKAGE_JSON_FILE: string;
let INSIDE_LOG_FILE: string;
let OUTSIDE_FILE: string;
let SYMLINK_INSIDE_PROJECT: string;
// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01-CORRECTION01
// HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS fixture:
//   We place literal files at the EXACT path the rule regex
//   would accept (e.g. `${PROJECT_DIR}/$HOME/secret`). This
//   makes the host-evidence builder resolve the LITERAL token
//   inside the workspace fixture, while bash -- evaluating
//   `$HOME` and `~` -- resolves to a path OUTSIDE the
//   fixture. That divergence is the discriminator.
let LITERAL_DOLLAR_HOME_SECRET: string;
let LITERAL_TILDE_SECRET: string;
let CANONICAL_PROJECT_DIR: string;
let CANONICAL_INSIDE_LOG_FILE: string;
let CANONICAL_OUTSIDE_FILE: string;
let CANONICAL_SYMLINK_INSIDE_PROJECT: string;
let CANONICAL_OUTSIDE_DIR: string;

beforeAll(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-reader-path-authority-"));
	PROJECT_DIR = join(TMP_ROOT, "project");
	OUTSIDE_DIR = join(TMP_ROOT, "outside");

	mkdirSync(PROJECT_DIR, { recursive: true });
	mkdirSync(join(PROJECT_DIR, "logs"), { recursive: true });
	mkdirSync(OUTSIDE_DIR, { recursive: true });

	README_FILE = join(PROJECT_DIR, "README.md");
	PACKAGE_JSON_FILE = join(PROJECT_DIR, "package.json");
	INSIDE_LOG_FILE = join(PROJECT_DIR, "logs", "app.log");
	OUTSIDE_FILE = join(OUTSIDE_DIR, "secret.txt");
	SYMLINK_INSIDE_PROJECT = join(PROJECT_DIR, "escape-link");

	writeFileSync(README_FILE, "# README\n");
	writeFileSync(PACKAGE_JSON_FILE, "{}\n");
	writeFileSync(INSIDE_LOG_FILE, "log line 1\nlog line 2\nlog line 3\n");
	writeFileSync(OUTSIDE_FILE, "// outside\n");

	symlinkSync(OUTSIDE_DIR, SYMLINK_INSIDE_PROJECT, "dir");

	// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01-CORRECTION01
	// Place literal files whose name is the SHELL-EXPANSION
	// candidate. The fixture's existence at the exact raw-token
	// path makes the host-evidence builder (operating on the
	// LITERAL token) resolve inside the workspace, while bash
	// (operating on the EVALUATED operand) resolves outside.
	LITERAL_DOLLAR_HOME_SECRET = join(PROJECT_DIR, "$HOME", "secret");
	mkdirSync(join(PROJECT_DIR, "$HOME"), { recursive: true });
	writeFileSync(LITERAL_DOLLAR_HOME_SECRET, "literal-dollar-home-secret\n");
	LITERAL_TILDE_SECRET = join(PROJECT_DIR, "~", "secret");
	mkdirSync(join(PROJECT_DIR, "~"), { recursive: true });
	writeFileSync(LITERAL_TILDE_SECRET, "literal-tilde-secret\n");

	// Canonicalize at the fixture boundary (mirrors what a real
	// host does before passing values to `commandHostAuthorization`).
	CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR);
	CANONICAL_INSIDE_LOG_FILE = realpathSync(INSIDE_LOG_FILE);
	CANONICAL_OUTSIDE_FILE = realpathSync(OUTSIDE_FILE);
	CANONICAL_SYMLINK_INSIDE_PROJECT = realpathSync(SYMLINK_INSIDE_PROJECT);
	CANONICAL_OUTSIDE_DIR = realpathSync(OUTSIDE_DIR);
});

afterAll(() => {
	if (TMP_ROOT && existsSync(TMP_ROOT)) {
		rmSync(TMP_ROOT, { recursive: true, force: true });
	}
});

/* ---------------------------------------------------------------------- *
 * Helpers                                                                *
 * ---------------------------------------------------------------------- */

function makeEvidenceFor(
	command: string,
	opts: {
		roots?: ReadonlyArray<string>;
		cwd?: string | null;
	} = {},
) {
	const roots = opts.roots ?? [CANONICAL_PROJECT_DIR];
	const cwd = opts.cwd ?? CANONICAL_PROJECT_DIR;
	const result = buildPathAuthorityEvidence({
		workspaceRoots: roots,
		cwd,
		command: { command },
	});
	if (!result.ok) {
		throw new Error(
			`buildPathAuthorityEvidence failed for "${command}": reason=${result.reason}`,
		);
	}
	return result.evidence;
}

function evaluate(
	command: string,
	opts: {
		evidence?: ReturnType<typeof makeEvidenceFor>;
		roots?: ReadonlyArray<string>;
		cwd?: string | null;
	} = {},
) {
	const auth = commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: opts.roots ?? [CANONICAL_PROJECT_DIR],
		cwd: opts.cwd ?? CANONICAL_PROJECT_DIR,
		pathAuthorityEvidence: opts.evidence,
	});
	return evaluateCommandPolicy({
		toolInput: { command },
		hostAuthorization: auth,
	});
}

/* ---------------------------------------------------------------------- *
 * Section A: GREEN -- path-bearing readers with valid evidence            *
 * ---------------------------------------------------------------------- */

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 -- path-bearing readers with valid evidence", () => {
	describe("cat", () => {
		it("ALLOW: cat FILE inside workspace + matching evidence", () => {
			const r = evaluate(`cat ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(`cat ${CANONICAL_INSIDE_LOG_FILE}`),
			});
			expect(r.decision.kind).toBe("allow");
			expect(r.decision.matchedRuleSource).toBe("host_safe_cat");
		});

		it("ALLOW: cat README.md package.json (multi-file) + matching evidence", () => {
			const r = evaluate(
				`cat ${README_FILE} ${PACKAGE_JSON_FILE}`,
				{
					evidence: makeEvidenceFor(
						`cat ${README_FILE} ${PACKAGE_JSON_FILE}`,
					),
				},
			);
			expect(r.decision.kind).toBe("allow");
			expect(r.decision.matchedRuleSource).toBe("host_safe_cat");
		});

		it("ASK: cat README.md /etc/passwd (one outside operand) + matching evidence", () => {
			const r = evaluate(
				`cat ${README_FILE} ${CANONICAL_OUTSIDE_FILE}`,
				{
					evidence: makeEvidenceFor(
						`cat ${README_FILE} ${CANONICAL_OUTSIDE_FILE}`,
					),
				},
			);
			// Evidence record itself will mark `/etc/passwd`
			// (well, OUTSIDE_FILE) as `resolved-but-outside-roots`.
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});

		it("ASK: cat FILE 2>/dev/null (redirect always ASK at V1; V2 neutral-discard branch is for parser-proven stdin-only readers)", () => {
			// The neutral stderr-discard skip is a V2 parser-proven
			// branch (`isAuthorityNeutralStderrDiscard` in
			// structured-command-risk.ts), not a V1 safe-rule
			// branch. At V1, `cat FILE 2>/dev/null` matches the
			// `>` opaque shell token and falls through to ASK.
			// Per ACT §13: "do not make this an acceptance
			// requirement for the first commit. If it works
			// automatically, add conservation coverage. If not,
			// leave it ASK and continue."
			const r = evaluate(
				`cat ${CANONICAL_INSIDE_LOG_FILE} 2>/dev/null`,
				{
					evidence: makeEvidenceFor(
						`cat ${CANONICAL_INSIDE_LOG_FILE}`,
					),
				},
			);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: cat FILE > /tmp/x (write redirect stays ASK)", () => {
			const r = evaluate(
				`cat ${CANONICAL_INSIDE_LOG_FILE} > /tmp/x`,
				{
					evidence: makeEvidenceFor(
						`cat ${CANONICAL_INSIDE_LOG_FILE}`,
					),
				},
			);
			expect(r.decision.kind).toBe("ask");
		});
	});

	describe("head (path-bearing)", () => {
		it("ALLOW: head -30 FILE inside workspace + matching evidence", () => {
			const r = evaluate(`head -30 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`head -30 ${CANONICAL_INSIDE_LOG_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("allow");
			expect(r.decision.matchedRuleSource).toBe("host_safe_head_path");
		});

		it("ALLOW: head -n 30 FILE + matching evidence (per-source extractor consumes -n <N>)", () => {
			const r = evaluate(`head -n 30 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`head -n 30 ${CANONICAL_INSIDE_LOG_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("allow");
			expect(r.decision.matchedRuleSource).toBe("host_safe_head_path");
		});

		it("ALLOW: head -- FILE + matching evidence", () => {
			const r = evaluate(`head -- ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`head -- ${CANONICAL_INSIDE_LOG_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("allow");
		});
	});

	describe("tail (path-bearing)", () => {
		it("ALLOW: tail -20 FILE inside workspace + matching evidence", () => {
			const r = evaluate(`tail -20 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`tail -20 ${CANONICAL_INSIDE_LOG_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("allow");
			expect(r.decision.matchedRuleSource).toBe("host_safe_tail_path");
		});

		it("ALLOW: tail -n 20 FILE + matching evidence", () => {
			const r = evaluate(`tail -n 20 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`tail -n 20 ${CANONICAL_INSIDE_LOG_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("allow");
		});

		it("ALLOW: tail -- FILE + matching evidence", () => {
			const r = evaluate(`tail -- ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`tail -- ${CANONICAL_INSIDE_LOG_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("allow");
		});
	});
});

/* ---------------------------------------------------------------------- *
 * Section B: ASK -- missing evidence, outside, symlink, dynamic           *
 * ---------------------------------------------------------------------- */

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 -- negative cases (ASK)", () => {
	describe("missing evidence", () => {
		it("ASK: cat FILE without evidence", () => {
			const r = evaluate(`cat ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});

		it("ASK: head -30 FILE without evidence", () => {
			const r = evaluate(`head -30 ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});

		it("ASK: tail -20 FILE without evidence", () => {
			const r = evaluate(`tail -20 ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});
	});

	describe("outside-workspace operand", () => {
		it("ASK: cat /outside/file even with matching evidence (contained=false)", () => {
			const r = evaluate(`cat ${CANONICAL_OUTSIDE_FILE}`, {
				evidence: makeEvidenceFor(`cat ${CANONICAL_OUTSIDE_FILE}`),
			});
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});

		it("ASK: head -30 /outside/file + matching evidence (out of roots)", () => {
			const r = evaluate(`head -30 ${CANONICAL_OUTSIDE_FILE}`, {
				evidence: makeEvidenceFor(
					`head -30 ${CANONICAL_OUTSIDE_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: tail -20 /outside/file + matching evidence (out of roots)", () => {
			const r = evaluate(`tail -20 ${CANONICAL_OUTSIDE_FILE}`, {
				evidence: makeEvidenceFor(
					`tail -20 ${CANONICAL_OUTSIDE_FILE}`,
				),
			});
			expect(r.decision.kind).toBe("ask");
		});
	});

	describe("symlink escape", () => {
		it("ASK: cat <symlink-to-outside> + matching evidence (contained=false)", () => {
			const r = evaluate(
				`cat ${CANONICAL_SYMLINK_INSIDE_PROJECT}`,
				{
					evidence: makeEvidenceFor(
						`cat ${CANONICAL_SYMLINK_INSIDE_PROJECT}`,
					),
				},
			);
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});

		it("ASK: head -30 <symlink-to-outside> + matching evidence", () => {
			const r = evaluate(
				`head -30 ${CANONICAL_SYMLINK_INSIDE_PROJECT}`,
				{
					evidence: makeEvidenceFor(
						`head -30 ${CANONICAL_SYMLINK_INSIDE_PROJECT}`,
					),
				},
			);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: tail -20 <symlink-to-outside> + matching evidence", () => {
			const r = evaluate(
				`tail -20 ${CANONICAL_SYMLINK_INSIDE_PROJECT}`,
				{
					evidence: makeEvidenceFor(
						`tail -20 ${CANONICAL_SYMLINK_INSIDE_PROJECT}`,
					),
				},
			);
			expect(r.decision.kind).toBe("ask");
		});
	});

	describe("operand identity mismatch (wrong evidence)", () => {
		it("ASK: cat FILE A + evidence for FILE B (operand identity binding)", () => {
			const r = evaluate(`cat ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(`cat ${README_FILE}`),
			});
			expect(r.decision.kind).toBe("ask");
			expect(r.decision.source).toBe(
				"host_workspace_realpath_authority",
			);
		});

		it("ASK: head -30 FILE A + evidence for FILE B", () => {
			const r = evaluate(`head -30 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(`head -30 ${README_FILE}`),
			});
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: tail -20 FILE A + evidence for FILE B", () => {
			const r = evaluate(`tail -20 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(`tail -20 ${README_FILE}`),
			});
			expect(r.decision.kind).toBe("ask");
		});
	});

	describe("stale context (CORRECTION04 conservation)", () => {
		it("ASK: cat FILE + evidence from BROADER roots", () => {
			const r = evaluate(`cat ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(`cat ${CANONICAL_INSIDE_LOG_FILE}`, {
					roots: [tmpdir(), CANONICAL_PROJECT_DIR].sort(),
				}),
				// Narrower current authorization
				roots: [CANONICAL_PROJECT_DIR],
			});
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: head -30 FILE + evidence from FOREIGN cwd", () => {
			const otherCwd = realpathSync(mkdtempSync(join(tmpdir(), "cline-reader-other-")));
			const r = evaluate(`head -30 ${CANONICAL_INSIDE_LOG_FILE}`, {
				evidence: makeEvidenceFor(
					`head -30 ${CANONICAL_INSIDE_LOG_FILE}`,
					{ cwd: otherCwd },
				),
				cwd: CANONICAL_PROJECT_DIR,
			});
			expect(r.decision.kind).toBe("ask");
			rmSync(otherCwd, { recursive: true, force: true });
		});
	});

	describe("dangerous-sink + reader (composition stays ASK)", () => {
		it("ASK: cat FILE | sh (pipe to dangerous sink)", () => {
			const r = evaluate(`cat ${CANONICAL_INSIDE_LOG_FILE} | sh`, {
				evidence: makeEvidenceFor(
					`cat ${CANONICAL_INSIDE_LOG_FILE} | sh`,
				),
			});
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: cat README.md && rm -rf (R5 sibling)", () => {
			const r = evaluate(
				`cat ${README_FILE} && rm -rf ${CANONICAL_PROJECT_DIR}`,
				{
					evidence: makeEvidenceFor(`cat ${README_FILE}`),
				},
			);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: head -30 README.md && git branch -D __SENTINEL__ (R5 sibling)", () => {
			const r = evaluate(
				`head -30 ${README_FILE} && git branch -D __CLINEMM_SENTINEL__`,
				{
					evidence: makeEvidenceFor(`head -30 ${README_FILE}`),
				},
			);
			expect(r.decision.kind).toBe("ask");
		});
	});

	describe("argv-shape conservation (rejected by safe rule)", () => {
		it("ASK: cat -n FILE (cat options not yet reviewed)", () => {
			const r = evaluate(`cat -n ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: head -c 100 FILE (byte-counted not reviewed)", () => {
			const r = evaluate(`head -c 100 ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: tail -f FILE (follow mode out of scope)", () => {
			const r = evaluate(`tail -f ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: tail --follow FILE", () => {
			const r = evaluate(`tail --follow ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
		});

		it("ASK: tail --retry FILE", () => {
			const r = evaluate(`tail --retry ${CANONICAL_INSIDE_LOG_FILE}`);
			expect(r.decision.kind).toBe("ask");
		});
	});
});

/* ---------------------------------------------------------------------- *
 * Section C: conservation -- existing R0 path-bearing leaves still ALLOW  *
 * ---------------------------------------------------------------------- */

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 -- existing R0 conservation", () => {
	it("CONSERVATION: ls FILE + matching evidence -> ALLOW (host_safe_ls unchanged)", () => {
		const r = evaluate(`ls ${CANONICAL_INSIDE_LOG_FILE}`, {
			evidence: makeEvidenceFor(`ls ${CANONICAL_INSIDE_LOG_FILE}`),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.matchedRuleSource).toBe("host_safe_ls");
	});

	it("CONSERVATION: find FILE + matching evidence -> ALLOW (host_safe_find unchanged)", () => {
		const r = evaluate(`find ${CANONICAL_PROJECT_DIR}`, {
			evidence: makeEvidenceFor(`find ${CANONICAL_PROJECT_DIR}`),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.matchedRuleSource).toBe("host_safe_find");
	});

	it("CONSERVATION: pwd alone -> ALLOW (host_safe_pwd unchanged)", () => {
		const r = evaluate("pwd");
		expect(r.decision.kind).toBe("allow");
	});

	it("CONSERVATION: git status -> ALLOW (V1 host_safe_git_status unchanged)", () => {
		const r = evaluate("git status");
		expect(r.decision.kind).toBe("allow");
	});
});

/* ---------------------------------------------------------------------- *
 * Section D: necessity ablation                                            *
 * ---------------------------------------------------------------------- *
 *
 * ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 §16:
 *
 * Disable only the new reader-safe source registration and verify
 * that the previous ALLOW cases now return ASK. Restore, and verify
 * the outside/symlink/wrong-evidence/stale-roots-cwd cases remain
 * unchanged. This proves the new sources are LOAD-BEARING.
 */

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 -- necessity ablation", () => {
	// Build a narrowed ruleset that EXCLUDES the 3 new sources.
	const RULES_WITHOUT_READERS = DEFAULT_COMMAND_HOST_ALLOW_RULES.filter(
		(rule) =>
			rule.source !== "host_safe_cat" &&
			rule.source !== "host_safe_head_path" &&
			rule.source !== "host_safe_tail_path",
	);

	function evaluateWithoutReaders(command: string) {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: RULES_WITHOUT_READERS,
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			pathAuthorityEvidence: makeEvidenceFor(command),
		});
		return evaluateCommandPolicy({
			toolInput: { command },
			hostAuthorization: auth,
		});
	}

	it("NECESSITY: cat FILE without reader rule -> ASK (was ALLOW)", () => {
		const r = evaluateWithoutReaders(`cat ${CANONICAL_INSIDE_LOG_FILE}`);
		// With `host_safe_cat` removed, no positive rule
		// matches `cat FILE`, and V1 emits ASK via
		// `host_mode_safe_only_fallthrough`.
		expect(r.decision.kind).toBe("ask");
	});

	it("NECESSITY: head -30 FILE without reader rule -> ASK (was ALLOW)", () => {
		const r = evaluateWithoutReaders(`head -30 ${CANONICAL_INSIDE_LOG_FILE}`);
		expect(r.decision.kind).toBe("ask");
	});

	it("NECESSITY: tail -20 FILE without reader rule -> ASK (was ALLOW)", () => {
		const r = evaluateWithoutReaders(`tail -20 ${CANONICAL_INSIDE_LOG_FILE}`);
		expect(r.decision.kind).toBe("ask");
	});

	it("NECESSITY CONSERVATION: ls FILE still ALLOW (reader-only ablation does not affect existing R0)", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: RULES_WITHOUT_READERS,
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			pathAuthorityEvidence: makeEvidenceFor(`ls ${CANONICAL_INSIDE_LOG_FILE}`),
		});
		const r = evaluateCommandPolicy({
			toolInput: { command: `ls ${CANONICAL_INSIDE_LOG_FILE}` },
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.matchedRuleSource).toBe("host_safe_ls");
	});

	it("NECESSITY CONSERVATION: cat /outside/file still ASK (unchanged)", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: RULES_WITHOUT_READERS,
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			pathAuthorityEvidence: makeEvidenceFor(`cat ${CANONICAL_OUTSIDE_FILE}`),
		});
		const r = evaluateCommandPolicy({
			toolInput: { command: `cat ${CANONICAL_OUTSIDE_FILE}` },
			hostAuthorization: auth,
		});
		// Without reader rule, ASK via safe-only-fallthrough
		// (no positive match). With reader rule, ASK via
		// host_workspace_realpath_authority (contained=false).
		// Either way: ASK.
		expect(r.decision.kind).toBe("ask");
	});
});

/* ---------------------------------------------------------------------- *
 * Section E: stdin-only path-bearing boundary (don't conflate)           *
 * ---------------------------------------------------------------------- *
 *
 * ACT §12: stdin-only head/tail (zero path operands) must NOT
 * trigger the R0 path-bearing gate. They take the V2 parser-proven
 * stdin-only branch. The "no file" forms of `head` and `tail` MUST
 * remain ALLOWable via the stdin-only path, not the path-bearing
 * path.
 *
 * V1's path-bearing gate fires on `match.source ∈ R0_READONLY_PATH_BEARING_SOURCES`.
 * The stdin-only branches (`host_safe_head_parser_proven_stdin_only`,
 * `host_safe_tail_parser_proven_stdin_only`) are NOT in that set.
 *
 * This is the load-bearing "don't muddle shell provenance and
 * filesystem authority" invariant.
 */

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 -- stdin-only vs path-bearing boundary", () => {
	it("head (no args, stdin-only) is NOT in R0_READONLY_PATH_BEARING_SOURCES", async () => {
		const mod = await import("./command-policy");
		// The function is exported from command-policy.ts.
		// Verify it's NOT in the path-bearing set by checking
		// the predicate directly.
		expect(mod.isR0PathBearingRuleSource("host_safe_head_parser_proven_stdin_only")).toBe(false);
		expect(mod.isR0PathBearingRuleSource("host_safe_tail_parser_proven_stdin_only")).toBe(false);
	});

	it("host_safe_head_path / host_safe_tail_path / host_safe_cat ARE in R0_READONLY_PATH_BEARING_SOURCES", async () => {
		const mod = await import("./command-policy");
		expect(mod.isR0PathBearingRuleSource("host_safe_head_path")).toBe(true);
		expect(mod.isR0PathBearingRuleSource("host_safe_tail_path")).toBe(true);
		expect(mod.isR0PathBearingRuleSource("host_safe_cat")).toBe(true);
	});
});

/* ---------------------------------------------------------------------- *
 * Section F: HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS                  *
 *              (CORRECTION01 RED -> GREEN)                                *
 * ---------------------------------------------------------------------- *
 *
 * Reviewer P0 (post-merge):
 *
 *   The new V1 reader safe-rule regexes
 *   (`host_safe_cat`, `host_safe_head_path`, `host_safe_tail_path`)
 *   positively accept unquoted shell-active characters in path
 *   operands: `$`, `~`, `*`, `?`. Bash performs parameter
 *   expansion / tilde expansion / filename generation BEFORE
 *   `cat` / `head` / `tail` sees argv. The host evidence is
 *   built from the LITERAL token; the kernel executes against
 *   the SHELL-EVALUATED operand. That breaks the load-bearing
 *   invariant:
 *
 *      evidence operand identity  ==  actual filesystem operand
 *
 *   The discriminator the reviewer demanded: an operand that
 *   passes the lexical containment gate under the LITERAL token
 *   while the SHELL-EVALUATED copy resolves to a different
 *   filesystem object.
 *
 *   We build exactly that fixture in `beforeAll`:
 *     `${PROJECT_DIR}/$HOME/secret`  (a literal file at the
 *     exact raw-token name)
 *
 *   Today, `cat $HOME/secret` evaluates to:
 *     - host evidence builder: literal `$HOME/secret` resolves
 *       under cwd -> `${PROJECT_DIR}/$HOME/secret` (the file
 *       we created) -> `contained: true` -> ALLOW.
 *     - bash: `$HOME` expands to user home -> reads
 *       `/Users/<who>/secret` (outside workspace).
 *
 *   PRE-CORRECTION01 RED: ALL FOUR cases below return ALLOW.
 *   POST-CORRECTION01 GREEN: ALL FOUR return ASK (the regex
 *   must REJECT the shell-active operand before the authority
 *   gate fires -- fail-closed at the rule layer, not the gate
 *   layer).
 *
 * Bounded fix: NARROW the V1 reader path character class to
 * characters that are INERT in an unquoted shell word under
 * the supported grammar. Remove `$`, `~`, `*`, `?` from the
 * new positive reader patterns. Quoted/dynamic/path-rich
 * operands stay conservative until V2 can positively establish
 * `argProvenance === "static"` and bind the EXACT projected
 * operand to host authority.
 *
 * Classification: SYNTHETIC_REAL / STRUCTURAL. The harness
 * drives the canonical SDK entrypoint without invoking a real
 * shell. The bash side-channel check (in the standalone RED
 * reproduction harness) confirms the actual shell-expanded
 * path differs from the raw token.
 */

describe("ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01-CORRECTION01 -- HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS", () => {
	// The fixture creates these literal files (see beforeAll):
	//   ${PROJECT_DIR}/$HOME/secret  -> real file at the literal raw-token name
	//   ${PROJECT_DIR}/~/secret      -> real file at the literal raw-token name
	//
	// Without the bounded grammar fix, the host-evidence builder
	// resolves the LITERAL token under cwd and finds these
	// files, which makes `contained: true` and the policy ALLOWs.
	//
	// With the fix, the rule regex MUST REJECT the shell-active
	// operand before any gate evaluation, returning ASK via
	// host_mode_safe_only_fallthrough.

	it("ASK: cat $HOME/secret (parameter expansion; raw token lexically resolves to literal fixture file)", () => {
		const r = evaluate(`cat $HOME/secret`, {
			evidence: makeEvidenceFor(`cat $HOME/secret`),
		});
		// Pre-fix: ALLOW (the discriminator the reviewer demanded).
		// Post-fix: ASK (the regex REJECTS `$` in the path operand).
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: head -30 $HOME/secret (parameter expansion)", () => {
		const r = evaluate(`head -30 $HOME/secret`, {
			evidence: makeEvidenceFor(`head -30 $HOME/secret`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: tail -20 $HOME/secret (parameter expansion)", () => {
		const r = evaluate(`tail -20 $HOME/secret`, {
			evidence: makeEvidenceFor(`tail -20 $HOME/secret`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: cat ~/secret (tilde expansion; raw token lexically resolves to literal fixture file)", () => {
		const r = evaluate(`cat ~/secret`, {
			evidence: makeEvidenceFor(`cat ~/secret`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: head -30 ~/secret (tilde expansion)", () => {
		const r = evaluate(`head -30 ~/secret`, {
			evidence: makeEvidenceFor(`head -30 ~/secret`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: tail -20 ~/secret (tilde expansion)", () => {
		const r = evaluate(`tail -20 ~/secret`, {
			evidence: makeEvidenceFor(`tail -20 ~/secret`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: cat * (filename generation; bash reads every entry under cwd)", () => {
		const r = evaluate(`cat *`, {
			evidence: makeEvidenceFor(`cat *`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	it("ASK: cat ?.txt (filename generation)", () => {
		const r = evaluate(`cat ?.txt`, {
			evidence: makeEvidenceFor(`cat ?.txt`),
		});
		expect(r.decision.kind).toBe("ask");
	});

	// Conservation: the boring, ALLOW-able form MUST still
	// ALLOW after the grammar narrowing. The narrowing must
	// not over-shoot.
	it("CONSERVATION: cat <inside-file> + matching evidence still ALLOWs after grammar narrowing", () => {
		const r = evaluate(`cat ${CANONICAL_INSIDE_LOG_FILE}`, {
			evidence: makeEvidenceFor(`cat ${CANONICAL_INSIDE_LOG_FILE}`),
		});
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.matchedRuleSource).toBe("host_safe_cat");
	});
});
