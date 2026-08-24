/**
 * ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01
 *
 * Unit tests for the workspace path authority module. These tests
 * exercise `isLexicallyContained`, `isPathOperandConforming`,
 * `extractPathOperands`, and `evaluateCommandPathConformance` in
 * isolation. They do NOT touch the canonical command policy; the
 * integration between the path authority and the R0 rules is
 * tested in `command-risk-corpus.path-authority.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
	evaluateCommandPathConformance,
	extractPathOperands,
	isLexicallyContained,
	isPathOperandConforming,
} from "./path-authority";

const ROOT = "/current/project";
const CWD = ROOT;

describe("isLexicallyContained", () => {
	it("returns true for exact match", () => {
		expect(isLexicallyContained(ROOT, [ROOT])).toBe(true);
	});

	it("returns true for direct child", () => {
		expect(isLexicallyContained(`${ROOT}/src`, [ROOT])).toBe(true);
	});

	it("returns true for nested descendant", () => {
		expect(isLexicallyContained(`${ROOT}/src/foo/bar.ts`, [ROOT])).toBe(true);
	});

	it("rejects lexical prefix that is not a directory boundary", () => {
		// /current/project-evil must NOT pass containment under
		// /current/project. This is the load-bearing safety check.
		expect(isLexicallyContained("/current/project-evil", [ROOT])).toBe(false);
	});

	it("rejects parent of the root", () => {
		expect(isLexicallyContained("/current", [ROOT])).toBe(false);
	});

	it("rejects completely unrelated absolute paths", () => {
		expect(isLexicallyContained("/etc", [ROOT])).toBe(false);
		expect(isLexicallyContained("/home/user", [ROOT])).toBe(false);
	});

	it("returns false on empty resolved path", () => {
		expect(isLexicallyContained("", [ROOT])).toBe(false);
	});

	it("skips empty roots (defensive)", () => {
		expect(isLexicallyContained("/etc", [""])).toBe(false);
	});

	it("accepts if any of multiple roots contains the path", () => {
		const roots = ["/other/project", ROOT, "/third/project"];
		expect(isLexicallyContained(`${ROOT}/src`, roots)).toBe(true);
		expect(isLexicallyContained("/other/project/src", roots)).toBe(true);
		expect(isLexicallyContained("/unrelated", roots)).toBe(false);
	});
});

describe("isPathOperandConforming (absolute paths)", () => {
	const ctx = { workspaceRoots: [ROOT], cwd: CWD };

	it("conforming for path under root", () => {
		const r = isPathOperandConforming(`${ROOT}/src`, ctx);
		expect(r.conforming).toBe(true);
		expect(r.resolved).toBe(`${ROOT}/src`);
	});

	it("non-conforming for /etc", () => {
		const r = isPathOperandConforming("/etc", ctx);
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("outside-workspace");
	});

	it("non-conforming for /home/user", () => {
		const r = isPathOperandConforming("/home/user", ctx);
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("outside-workspace");
	});

	it("non-conforming for lexical-prefix attack (/current/project-evil)", () => {
		const r = isPathOperandConforming("/current/project-evil", ctx);
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("outside-workspace");
	});

	it("conforming for exact root match", () => {
		const r = isPathOperandConforming(ROOT, ctx);
		expect(r.conforming).toBe(true);
		expect(r.resolved).toBe(ROOT);
	});

	it("rejects empty / whitespace operand", () => {
		expect(isPathOperandConforming("", ctx).reason).toBe("empty-operand");
		expect(isPathOperandConforming("   ", ctx).reason).toBe("empty-operand");
	});

	it("rejects tilde-prefixed operands (POSIX shell-expansion token)", () => {
		// `~/.ssh` is a shell expansion that resolves to
		// `$HOME/.ssh` (typically outside the project). The
		// path authority refuses tilde-prefixed operands up
		// front rather than relying on `path.resolve` (which
		// would treat `~` as a literal directory name).
		const r = isPathOperandConforming("~/.ssh", ctx);
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("shell-expansion-token");
	});
});

describe("isPathOperandConforming (relative paths)", () => {
	const ctx = { workspaceRoots: [ROOT], cwd: CWD };

	it("conforming for relative path under cwd", () => {
		const r = isPathOperandConforming("src/foo.ts", ctx);
		expect(r.conforming).toBe(true);
		expect(r.resolved).toBe(`${ROOT}/src/foo.ts`);
	});

	it("conforming for bare relative (./)", () => {
		const r = isPathOperandConforming(".", ctx);
		expect(r.conforming).toBe(true);
		expect(r.resolved).toBe(ROOT);
	});

	it("conforming for parent-traversal that resolves back into root", () => {
		// /current/project/sub/../foo resolves to /current/project/foo,
		// which is under /current/project.
		const r = isPathOperandConforming("sub/../foo", ctx);
		expect(r.conforming).toBe(true);
		expect(r.resolved).toBe(`${ROOT}/foo`);
	});

	it("non-conforming for traversal that escapes the root", () => {
		const r = isPathOperandConforming("../../etc", ctx);
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("outside-workspace");
	});

	it("non-conforming for traversal to a sensitive system path", () => {
		const r = isPathOperandConforming("../.ssh", ctx);
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("outside-workspace");
	});

	it("non-conforming for relative when no cwd is supplied", () => {
		const r = isPathOperandConforming("foo", {
			workspaceRoots: [ROOT],
			cwd: undefined,
		});
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("no-cwd-for-relative-operand");
	});

	it("non-conforming for relative when cwd is empty", () => {
		const r = isPathOperandConforming("foo", {
			workspaceRoots: [ROOT],
			cwd: "",
		});
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("no-cwd-for-relative-operand");
	});
});

describe("isPathOperandConforming (no configuration)", () => {
	it("rejects absolute path when no workspace roots are configured", () => {
		const r = isPathOperandConforming("/etc", {});
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("no-workspace-roots");
	});

	it("rejects relative path when no workspace roots are configured", () => {
		const r = isPathOperandConforming("foo", { cwd: "/somewhere" });
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("no-workspace-roots");
	});

	it("rejects when workspaceRoots is empty array", () => {
		const r = isPathOperandConforming("/etc", {
			workspaceRoots: [],
			cwd: "/somewhere",
		});
		expect(r.conforming).toBe(false);
		expect(r.reason).toBe("no-workspace-roots");
	});
});

describe("extractPathOperands", () => {
	it("extracts positional arguments from a simple ls", () => {
		expect(extractPathOperands("ls /etc")).toEqual(["/etc"]);
	});

	it("skips short options", () => {
		expect(extractPathOperands("ls -la /etc /tmp")).toEqual(["/etc", "/tmp"]);
	});

	it("skips long options with values", () => {
		expect(extractPathOperands("ls --color=auto /etc")).toEqual(["/etc"]);
	});

	it("skips --", () => {
		expect(extractPathOperands("ls -- /tmp")).toEqual(["/tmp"]);
	});

	it("returns empty for commands with no path operands", () => {
		expect(extractPathOperands("pwd")).toEqual([]);
		// Note: `git status --short --branch` is rendered as a
		// single string and `extractPathOperands` is intentionally
		// simple — it returns the first positional token (`status`)
		// as a candidate path. The policy layer does NOT consult
		// the path authority for `host_safe_git_status` because
		// that rule is NOT in `R0_READONLY_PATH_BEARING_SOURCES`.
		// The path authority fires only for `host_safe_ls` and
		// `host_safe_find`, so the would-be-extracted `status`
		// operand is never checked. This test pins the simple
		// extractor behavior so the boundary is explicit.
		expect(extractPathOperands("git status --short --branch")).toEqual([
			"status",
		]);
	});
});

describe("evaluateCommandPathConformance", () => {
	const ctx = { workspaceRoots: [ROOT], cwd: CWD };

	it("conforming for pwd (no operands)", () => {
		const r = evaluateCommandPathConformance("pwd", ctx);
		expect(r.conforming).toBe(true);
		expect(r.operands).toEqual([]);
	});

	it("conforming for ls with workspace-absolute path", () => {
		const r = evaluateCommandPathConformance(`ls ${ROOT}`, ctx);
		expect(r.conforming).toBe(true);
		expect(r.operands).toHaveLength(1);
	});

	it("non-conforming for ls /etc", () => {
		const r = evaluateCommandPathConformance("ls /etc", ctx);
		expect(r.conforming).toBe(false);
		expect(r.operands[0]?.result.reason).toBe("outside-workspace");
	});

	it("non-conforming when ANY operand is outside the root", () => {
		const r = evaluateCommandPathConformance(`ls ${ROOT}/src /etc`, ctx);
		expect(r.conforming).toBe(false);
		expect(r.operands[0]?.result.conforming).toBe(true);
		expect(r.operands[1]?.result.conforming).toBe(false);
	});

	it("non-conforming for lexical escape via ..", () => {
		const r = evaluateCommandPathConformance(`ls ${ROOT}/../.ssh`, ctx);
		expect(r.conforming).toBe(false);
	});

	it("structured input: passing a structured command shape", () => {
		const r = evaluateCommandPathConformance(
			{ command: "ls", args: ["/etc"] },
			ctx,
		);
		expect(r.conforming).toBe(false);
	});
});
