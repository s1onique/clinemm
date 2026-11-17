/**
 * ACT-CLINEMM-EDITOR-REALPATH-TEST-CONTRACT-CORRECTION01 — executor contract.
 *
 * This file exercises the RAW SDK editor executor
 * (`sdk/packages/core/src/extensions/tools/executors/editor.ts`).
 *
 * WHY THIS SUITE WAS CORRECTED
 * =============================
 *
 * The predecessor version of this file was the un-split CYCLE5 RED suite. It
 * asserted a **workspace-only** contract on the raw SDK executor:
 *
 *   C. ABSOLUTE OUTSIDE TARGET              => executor MUST refuse
 *   D. EXISTING SYMLINK ESCAPE               => executor MUST refuse
 *   E. NONEXISTENT OUTSIDE TREE              => executor MUST refuse
 *
 * That contract does not exist in the product. The REAL production contract is
 * "capability-specific authorized writable root":
 *
 *   - The SDK executor is DELIBERATELY POLICY-IGNORANT. Its only path option
 *     is `restrictToCwd`, documented in `editor.ts` as *"Restrict relative-path
 *     file operations to paths inside cwd. Absolute paths are always accepted
 *     as-is."* The `cwd` argument is therefore a RELATIVE-PATH RESOLUTION
 *     BASE, not a security boundary.
 *   - Authorization lives ONE LAYER UP, in the host
 *     (`apps/vscode/src/sdk/editor-path-authority.ts` ->
 *     `editor-auto-approval-policy.ts` ->
 *     `sdk-interaction-coordinator.ts`): the target-aware approval gate
 *     classifies the effective destination (absolute / symlink-resolved /
 *     nonexistent-descendant) as `inside | outside | unavailable` and then
 *     applies the lattice:
 *
 *         editFiles=false                            => ASK  (any target)
 *         editFiles=true  + inside                   => ALLOW
 *         editFiles=true  + outside + external=false => ASK
 *         editFiles=true  + outside + external=true  => ALLOW
 *         classification=unavailable                => ASK  (fail closed)
 *
 *     `editFilesExternally` is the explicit, user-visible authorization for
 *     external edits and it ships ON by default. An ASK resolves to either a
 *     rejection OR an explicit user approval — and an approved outside write
 *     STILL WRITES.
 *
 * This is the contract the predecessor ACT
 * (`ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01`,
 * `.factory/evidence/ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01/`) settled
 * on, having adjudicated the identical conflict in its predecessor:
 *
 *   "current CYCLE5 RED suite expects C/D/E -> executor refuses, but the
 *    correct semantic is C/D/E -> ASK -> user approves -> executor STILL
 *    WRITES ... Cannot simply flip C/D/E to executor-rejection GREEN - that
 *    encodes 'outside is forbidden', contradicting the upstream 'Edit all
 *    files' product contract."
 *
 * The classifier / policy / approval-gate assertions live on the HOST side,
 * in the already-passing suites:
 *
 *   apps/vscode/src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts
 *       (absolute outside, symlink realpath, unavailable)
 *   apps/vscode/src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts
 *       (the full lattice, incl. unavailable => ASK)
 *   apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.*
 *       (the REAL coordinator seam: external=false => ASK, external=true =>
 *       ALLOW, and explicit user approval permitting the outside write)
 *
 * WHAT THIS FILE NOW ASSERTS
 * ===========================
 *
 *   A. CLEAN AUTHORIZED WRITE INSIDE         — PASS (control)
 *   B. RELATIVE LEXICAL TRAVERSAL ESCAPE     — REFUSED (control; unchanged)
 *   C. ABSOLUTE OUTSIDE TARGET               — WRITTEN (already-authorized)
 *   D. EXISTING SYMLINK ESCAPE               — WRITTEN (already-authorized)
 *   E. NONEXISTENT OUTSIDE TREE              — WRITTEN (already-authorized)
 *   F. IN-ROOT CANONICALIZED PATH            — PASS (control)
 *   H. ORDINARY WORKSPACE CONSERVATION       — PASS (control)
 *
 * Cases C / D / E assert the *already-authorized* outside write SUCCEEDS and
 * that the EFFECTIVE DESTINATION (not merely the lexical path) received the
 * intended content. Every case uses disposable `os.tmpdir()` fixtures that are
 * removed by the suite's own `finally` block.
 *
 * Case B is UNCHANGED: a RELATIVE lexical traversal escape is still refused
 * when `restrictToCwd` is enabled. That protection is NOT weakened.
 *
 * NO AUTHORIZATION POLICY IS ADDED TO `createEditorExecutor`. The production
 * executor is untouched by this correction.
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
 *   outsideRoot     — stands in for the writable root the host ALREADY
 *                     authorized (editFilesExternally=true, or an explicit
 *                     user approval that was granted)
 * Each lives outside each other; the cleanest possible
 * symmetric-discriminator harness.
 *
 * Every fixture is created under `os.tmpdir()` and removed by this helper's
 * own `finally` block, so the suite leaves NO filesystem effect behind.
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
		// Cleanup is part of the contract: the disposable fixture tree
		// must be gone once the case completes.
		await expect(fs.access(tmp)).rejects.toMatchObject({
			code: "ENOENT",
		});
	}
}

/**
 * Assert that `expectedPath` is the EFFECTIVE destination that received
 * `expectedContent`, and that the write did not land at any other lexical
 * location.
 */
async function expectEffectiveDestination(
	expectedPath: string,
	expectedContent: string,
): Promise<void> {
	await expect(fs.readFile(expectedPath, "utf-8")).resolves.toBe(
		expectedContent,
	);
}

describe(
	"createEditorExecutor — authorized-external-edit contract (raw SDK executor)",
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

		it("B. relative lexical traversal escape (../...) is refused when restrictToCwd is enabled", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				await fs.mkdir(path.join(authorizedRoot, "sub"), { recursive: true });
				const editor = createEditorExecutor();
				// Truly RELATIVE input (does not start with cwd or any
				// absolute path); path.resolve(cwd, target) is what
				// drives the containment check in `resolveFilePath`.
				//
				// This protection is UNCHANGED by the test-contract
				// correction: `restrictToCwd` (default true) still
				// refuses a RELATIVE lexical traversal escape, so the
				// correction does NOT weaken the relative-traversal
				// protection in any way.
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

		it("C. ABSOLUTE OUTSIDE TARGET — already-authorized outside write succeeds", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				const editor = createEditorExecutor();
				const target = path.join(outsideRoot, "c.txt");
				const content = "host-file-mutation-outside";

				// The host ALREADY authorized this destination (the
				// `editFilesExternally` toggle is ON by default, or the
				// user explicitly approved the ASK card). The raw SDK
				// executor is policy-ignorant by design, so the
				// already-authorized outside write MUST succeed.
				const result = await editor(
					{ path: target, new_text: content },
					authorizedRoot,
					context,
				);
				expect(result).toContain("File created successfully");

				// Actual destination: the absolute outside target itself.
				await expectEffectiveDestination(target, content);
				// The effective destination is OUTSIDE the workspace root.
				const effective = await fs.realpath(target);
				expect(effective.startsWith(await fs.realpath(authorizedRoot) + path.sep)).toBe(
					false,
				);
				// The write did NOT land inside the workspace root.
				await expect(
					fs.access(path.join(authorizedRoot, "c.txt")),
				).rejects.toMatchObject({ code: "ENOENT" });
			});
		});

		it("D. EXISTING SYMLINK ESCAPE — already-authorized outside write resolves to the symlink destination", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				// Pre-place a symlink authorizedRoot/escape -> outsideRoot.
				// The symlink exists BEFORE the executor is called, so
				// this is a deterministic (non-TOCTOU) escape.
				//
				// The host classifier resolves this destination with
				// `fs.realpathSync` and classifies it as OUTSIDE, so the
				// SAME authorization gate applies as for case C. The
				// lexical path is INSIDE the workspace root; the
				// EFFECTIVE destination is OUTSIDE it.
				const escapeLink = path.join(authorizedRoot, "escape");
				await fs.symlink(outsideRoot, escapeLink, "dir");

				const editor = createEditorExecutor();
				// RELATIVE path: "escape/d.txt". The lexical containment
				// check in `resolveFilePath` passes (the resolved path is
				// lexically inside cwd), but `fs.mkdir` + `fs.writeFile`
				// follow the symlink and the file lands at
				// outsideRoot/d.txt.
				const target = path.join("escape", "d.txt");
				const content = "symlink-escape";

				const result = await editor(
					{ path: target, new_text: content },
					authorizedRoot,
					context,
				);
				expect(result).toContain("File created successfully");

				// Actual destination: the symlink's outside target.
				const effectiveDestination = path.join(outsideRoot, "d.txt");
				await expectEffectiveDestination(effectiveDestination, content);
				// The EFFECTIVE destination resolves OUTSIDE the workspace
				// root even though the lexical path is inside it.
				const effective = await fs.realpath(effectiveDestination);
				expect(effective.startsWith(await fs.realpath(authorizedRoot) + path.sep)).toBe(
					false,
				);
				// The write did NOT land at a non-symlinked in-root path.
				await expect(
					fs.access(path.join(authorizedRoot, "d.txt")),
				).rejects.toMatchObject({ code: "ENOENT" });
			});
		});

		it("E. NONEXISTENT OUTSIDE DESCENDANT — already-authorized outside tree is created successfully", async () => {
			await withTwoRootFixture(async (authorizedRoot, outsideRoot) => {
				const editor = createEditorExecutor();
				const target = path.join(outsideRoot, "deep", "sub", "e.txt");
				const content = "fresh-outside-tree";

				// The host classifier resolves the deepest existing
				// ancestor and classifies this OUTSIDE, so the same
				// authorization gate applies. Once authorized, the
				// executor's `mkdir -p` of the outside tree MUST succeed.
				const result = await editor(
					{ path: target, new_text: content },
					authorizedRoot,
					context,
				);
				expect(result).toContain("File created successfully");

				// Actual destination: the created outside tree.
				await expectEffectiveDestination(target, content);
				// The parent tree was created OUTSIDE the workspace root.
				const effective = await fs.realpath(target);
				expect(effective.startsWith(await fs.realpath(authorizedRoot) + path.sep)).toBe(
					false,
				);
				// Nothing was created inside the workspace root.
				await expect(
					fs.access(path.join(authorizedRoot, "deep")),
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
