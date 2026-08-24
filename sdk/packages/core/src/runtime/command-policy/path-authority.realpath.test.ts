/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01
 * REALPATH_WORKSPACE_CONFINEMENT
 *
 * Adversarial RED/GREEN test: the symlink-escape attack.
 *
 * The reviewer flagged that V1's lexical-only path authority is
 * NOT a safe production authority boundary, because a
 * project-internal symlink pointing outside the project
 * lexically passes containment:
 *
 *     /current/project/outside-link  ->  /etc
 *
 * CORRECTION01 closes this gap by requiring the host to call
 * `fs.realpathSync` on the operand and on the workspace root,
 * then passing the result as `WorkspacePathAuthorityEvidence` to
 * the policy layer. Containment is then tested on the
 * CANONICAL pathname.
 *
 * This test uses `os.tmpdir` + `symlinkSync` to build a real
 * filesystem fixture with a project directory and a symlink
 * that points to a directory outside it, then verifies the
 * policy correctly ASK's a `find` invocation that targets the
 * symlink. It also covers the negative cases
 * (non-symlink path under the project => ALLOW; the same path
 * under a multi-root project that INCLUDES the symlink target
 * => ALLOW).
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

import { buildPathAuthorityEvidence } from "./path-authority-evidence-builder";
import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "./index";

let TMP_ROOT: string;
let PROJECT_DIR: string;
let OUTSIDE_DIR: string;
let PROJECT_INSIDE_FILE: string;
let OUTSIDE_FILE: string;

beforeAll(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-path-authority-realpath-"));
	PROJECT_DIR = join(TMP_ROOT, "project");
	OUTSIDE_DIR = join(TMP_ROOT, "outside");

	mkdirSync(PROJECT_DIR, { recursive: true });
	mkdirSync(join(PROJECT_DIR, "inside"), { recursive: true });
	mkdirSync(OUTSIDE_DIR, { recursive: true });

	PROJECT_INSIDE_FILE = join(PROJECT_DIR, "inside", "ok.ts");
	OUTSIDE_FILE = join(OUTSIDE_DIR, "secret.txt");
	writeFileSync(PROJECT_INSIDE_FILE, "// inside\n");
	writeFileSync(OUTSIDE_FILE, "// outside\n");

	// The adversarial symlink: project-internal, pointing to a
	// directory OUTSIDE the project. V1 (lexical) would let a
	// `find` against this path pass containment. V2 (realpath)
	// must reject it.
	symlinkSync(OUTSIDE_DIR, join(PROJECT_DIR, "outside-link"), "dir");
});

afterAll(() => {
	if (TMP_ROOT && existsSync(TMP_ROOT)) {
		rmSync(TMP_ROOT, { recursive: true, force: true });
	}
});

function evaluateWithRealpathEvidence(command: string) {
	const result = buildPathAuthorityEvidence({
		workspaceRoots: [PROJECT_DIR],
		cwd: PROJECT_DIR,
		command: { command },
	});
	if (!result.ok) {
		throw new Error(
			`buildPathAuthorityEvidence failed: reason=${result.reason}`,
		);
	}
	const auth = commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [PROJECT_DIR],
		cwd: PROJECT_DIR,
		pathAuthorityEvidence: result.evidence,
	});
	return evaluateCommandPolicy({
		toolInput: { command },
		hostAuthorization: auth,
	});
}

describe("ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION01 — adversarial symlink RED/GREEN", () => {
	it("GREEN: ls project/inside (real file inside project) => ALLOW (realpath contained)", () => {
		const r = evaluateWithRealpathEvidence(
			`ls ${join(PROJECT_DIR, "inside")}`,
		);
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("GREEN: find project/inside (real directory inside project) => ALLOW (realpath contained)", () => {
		const r = evaluateWithRealpathEvidence(
			`find ${join(PROJECT_DIR, "inside")}`,
		);
		expect(r.decision.kind).toBe("allow");
		expect(r.decision.source).toBe("host_mode_safe_only_rule");
	});

	it("RED: find project/outside-link (project-internal symlink => outside) => ASK (realpath escape closed)", () => {
		// This is the attack the reviewer identified. The
		// V1 lexical gate would have allowed this. The V2
		// realpath gate rejects it because `realpathSync`
		// resolves the symlink to OUTSIDE_DIR, which is
		// not contained in PROJECT_DIR.
		const r = evaluateWithRealpathEvidence(
			`find ${join(PROJECT_DIR, "outside-link")}`,
		);
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("RED: find -L project/outside-link (forced symlink dereference) => ASK (realpath escape closed)", () => {
		// GNU `find -L` dereferences symbolic links. The
		// shape-of-input match still applies (the regex
		// permits -L), but the path authority must reject
		// because the dereferenced target escapes the
		// workspace.
		const r = evaluateWithRealpathEvidence(
			`find -L ${join(PROJECT_DIR, "outside-link")}`,
		);
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("RED: ls project/outside-link (non-recursive listing of a symlink that points outside) => ASK", () => {
		// Even a single `ls` on the symlink path is enough
		// to dereference-and-read its target. V1 lexical
		// would have allowed this. V2 realpath rejects.
		const r = evaluateWithRealpathEvidence(
			`ls ${join(PROJECT_DIR, "outside-link")}`,
		);
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("RED: find project/does-not-exist (ENOENT) => ASK (fail-closed)", () => {
		const r = evaluateWithRealpathEvidence(
			`find ${join(PROJECT_DIR, "does-not-exist")}`,
		);
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("RED: ls /etc (absolute path outside workspace) => ASK (fail-closed)", () => {
		const r = evaluateWithRealpathEvidence(`ls /etc`);
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("GREEN (multi-root): find project/outside-link (symlink target added as second root) => ALLOW", () => {
		// When the host supplies BOTH the project root and
		// the outside target as workspace roots, the symlink
		// escape is a legitimate cross-workspace read.
		const evidenceResult = buildPathAuthorityEvidence({
			workspaceRoots: [PROJECT_DIR, OUTSIDE_DIR],
			cwd: PROJECT_DIR,
			command: { command: `find ${join(PROJECT_DIR, "outside-link")}` },
		});
		expect(evidenceResult.ok).toBe(true);
		if (!evidenceResult.ok) {
			return;
		}
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [PROJECT_DIR, OUTSIDE_DIR],
			cwd: PROJECT_DIR,
			pathAuthorityEvidence: evidenceResult.evidence,
		});
		const r = evaluateCommandPolicy({
			toolInput: {
				command: `find ${join(PROJECT_DIR, "outside-link")}`,
			},
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("allow");
	});

	it("CORRECTION02 REGRESSION: missing realpath evidence ⇒ ASK (NOT V1 lexical fallback ALLOW)", () => {
		// ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02
		// REALPATH_EVIDENCE_REQUIRED_FOR_PATH_BEARING_R0_ALLOW:
		//
		// The reviewer flagged the CORRECTION01 implementation
		// because when `pathAuthorityEvidence` was absent
		// (e.g. `buildPathAuthorityEvidence` returned
		// `ok:false`), the production policy fell back to the
		// V1 lexical gate. The V1 lexical gate ALLOWs the
		// project-internal symlink → outside escape the
		// reviewer identified. CORRECTION02 closes this:
		// missing evidence ⇒ ASK, never ALLOW.
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
			// pathAuthorityEvidence deliberately omitted
		});
		const r = evaluateCommandPolicy({
			toolInput: {
				command: `find ${join(PROJECT_DIR, "outside-link")}`,
			},
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("CORRECTION02: missing evidence for ls project/inside ⇒ ASK", () => {
		// The "inside" case is just as ASK as the symlink case.
		// Evidence is required regardless of whether the
		// lexical gate would have passed.
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
		});
		const r = evaluateCommandPolicy({
			toolInput: {
				command: `ls ${join(PROJECT_DIR, "inside")}`,
			},
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("CORRECTION02: operand identity mismatch (evidence for /safe applied to /evil) ⇒ ASK", () => {
		// The reviewer flagged this as a P1: evidence with
		// operand count == 1 but operand content mismatched
		// used to be accepted (count-only check). CORRECTION02
		// binds operand identity verbatim.
		const realEvidenceForSafe = buildPathAuthorityEvidence({
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
			command: {
				command: `ls ${join(PROJECT_DIR, "inside")}`,
			},
		});
		expect(realEvidenceForSafe.ok).toBe(true);
		if (!realEvidenceForSafe.ok) {
			return;
		}
		// Now apply that evidence to a different operand.
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [PROJECT_DIR],
			cwd: PROJECT_DIR,
			pathAuthorityEvidence: realEvidenceForSafe.evidence,
		});
		const r = evaluateCommandPolicy({
			toolInput: {
				command: `ls ${join(PROJECT_DIR, "outside-link")}`,
			},
			hostAuthorization: auth,
		});
		expect(r.decision.kind).toBe("ask");
		expect(r.decision.source).toBe("host_workspace_realpath_authority");
	});

	it("VERIFICATION: realpathSync actually resolves the symlink to OUTSIDE_DIR on this platform", () => {
		// Pin the property the test relies on: the symlink
		// resolves to OUTSIDE_DIR on the test host. If this
		// fails on some platform, the test environment is
		// not suitable for the realpath gate.
		const resolved = realpathSync(join(PROJECT_DIR, "outside-link"));
		expect(resolved).toBe(realpathSync(OUTSIDE_DIR));
	});
});
