/**
 * ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 — RED matrix
 *
 * Reproduces the production-seam editor-tool path-authority defect class.
 * See .factory/evidence/ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01/
 *   01-live-bind.md
 *   02-authorized-root.md
 *   03-authority-primitive.md
 *   04-composition-seam.md
 *   05-red-matrix.txt
 *
 * RED cases (per ACT §6):
 *   A. CLEAN AUTHORIZED WRITE               — PASS (control)
 *   B. LEXICAL TRAVERSAL ESCAPE             — PASS (control today)
 *   C. ABSOLUTE OUTSIDE TARGET              — REPRODUCES (RED)
 *   D. EXISTING SYMLINK ESCAPE              — unobserved (skipped)
 *   E. NONEXISTENT OUTSIDE TREE             — REPRODUCES (RED)
 *   F. IN-ROOT CANONICALIZED PATH           — PASS (control)
 *   G. GLOBAL-CAPABILITY CONSERVATION       — out of scope here
 *   H. ORDINARY WORKSPACE CONSERVATION      — PASS (control)
 *
 * The RED cases C and E are the load-bearing defect observations;
 * cases A/B/F/H are positive controls. Once the production repair
 * is in place, this test must GREEN at C and E (and remain green at
 * all positive controls).
 *
 * TEMPORARY_EXTERNAL_PATH_AUTHORITY is NOT touched. Seatbelt is NOT
 * touched. The test exercises only the editor seam.
 *
 * This file calls the SAME production createEditorExecutor(); it does
 * NOT re-implement the authority primitive. The wrap-around would
 * be the future ACT's bounded repair.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createEditorExecutor } from "./editor";

const context = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

/**
 * Build a fresh two-root fixture:
 *   authorizedRoot  — stands in for the LIVE workspaceRoot
 *   outsideRoot     — stands in for /Projects/Runtime/...
 * Each lives outside each other; the cleanest possible
 * symmetric-discriminator harness.
 */
async function withTwoRootFixture(
	run: (authorizedRoot: string, outsideRoot: string) => Promise<void>,
): Promise<void> {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-edit-auth-"));
	const authorizedRoot = path.join(tmp, "authorized");
	const outsideRoot = path.join(tmp, "outside");
	await fs.mkdir(authorizedRoot, { recursive: true });
	await fs.mkdir(outsideRoot, { recursive: true });
	try {
		await run(authorizedRoot, outsideRoot);
	} finally {
		await fs.rm(tmp, { recursive: true, force: true });
	}
}

describe(
	"createEditorExecutor — Q5 RED matrix for case-E absolute-outside",
	() => {
		it("A. control: clean write inside cwd passes", async () => {
			await withTwoRootFixture(async (authorizedRoot) => {
				const editor = createEditorExecutor();
				const target = path.join(authorizedRoot, "fresh", "a.txt");
				const result = await editor(
					{ path: target, new_text: "ok" },
					authorizedRoot,
					context,
				);
				expect(result).toContain("File created successfully");
				await expect(fs.readFile(target, "utf-8")).resolves.toBe("ok");
			});
		});

		it("B. relative lexical traversal escape (../...) is refused today", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				await fs.mkdir(path.join(authorizedRoot, "sub"), { recursive: true });
				const editor = createEditorExecutor();
				// Truly RELATIVE input (does not start with cwd or any
				// absolute path); path.resolve(cwd, target) is what
				// drives the containment check on line 60.
				const target = path.join(
					"sub",
					"..",
					"..",
					path.basename(outsideRoot),
					"b.txt",
				);
				await expect(
					editor(
						{ path: target, new_text: "should be refused" },
						authorizedRoot,
						context,
					),
				).rejects.toThrow(/Path must stay within cwd/);
				await expect(
					fs.access(path.join(outsideRoot, "b.txt")),
				).rejects.toMatchObject({ code: "ENOENT" });
			});
		});

		it("C. ABSOLUTE OUTSIDE TARGET — RED: must be refused", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				const editor = createEditorExecutor();
				const target = path.join(outsideRoot, "c.txt");
				// Future ACT contract: absolute paths whose lexical /
				// canonical resolution lands outside the
				// authorizedRoot MUST be refused BEFORE the executor
				// performs fs.mkdir + fs.writeFile. Today's executor
				// (sdk/.../executors/editor.ts line 56-58) accepts
				// absolute paths verbatim; the LIVE specimens E1
				// and E3 reproduce that exact defect class.
				await expect(
					editor(
						{ path: target, new_text: "host-file-mutation-outside" },
						authorizedRoot,
						context,
					),
				).rejects.toThrow(/out.*(workspace|authorized)/i);
				await expect(fs.access(target)).rejects.toMatchObject({
					code: "ENOENT",
				});
			});
		});

		it("E. nonexistent descendant of an outside root — RED: must be refused", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				const editor = createEditorExecutor();
				const target = path.join(outsideRoot, "deep", "sub", "e.txt");
				// mkdir-recursive inside createFile would create the
				// target's parent OUTSIDE the authorizedRoot. The
				// authority check must run BEFORE that mkdir — even
				// when the target itself is absent.
				await expect(
					editor(
						{ path: target, new_text: "fresh-outside-tree" },
						authorizedRoot,
						context,
					),
				).rejects.toThrow(/out.*(workspace|authorized)/i);
				await expect(
					fs.access(path.join(outsideRoot, "deep")),
				).rejects.toMatchObject({ code: "ENOENT" });
			});
		});

		it("F. control: in-root canonical variant still passes", async () => {
			await withTwoRootFixture(async (authorizedRoot) => {
				const editor = createEditorExecutor();
				const realpath = await fs.realpath(authorizedRoot);
				const target = path.join(realpath, ".", "f.txt");
				const result = await editor(
					{ path: target, new_text: "ok" },
					authorizedRoot,
					context,
				);
				expect(result).toContain("File created successfully");
				await expect(fs.readFile(target, "utf-8")).resolves.toBe("ok");
			});
		});

		it("H. control: ordinary workspace edit still passes", async () => {
			await withTwoRootFixture(async (authorizedRoot) => {
				await fs.writeFile(path.join(authorizedRoot, "h.txt"), "original");
				const editor = createEditorExecutor();
				const result = await editor(
					{
						path: path.join(authorizedRoot, "h.txt"),
						old_text: "original",
						new_text: "edited",
					},
					authorizedRoot,
					context,
				);
				expect(result).toContain("Edited");
				await expect(
					fs.readFile(path.join(authorizedRoot, "h.txt"), "utf-8"),
				).resolves.toBe("edited");
			});
		});
	},
);
