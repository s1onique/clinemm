/**
 * ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01.
 *
 * CLI wrapper for the Markdown-embedded Mermaid block guard.
 *
 * The PURE validation core lives in
 * `apps/vscode/src/sdk/markdown-mermaid-block-verifier.ts` so the unit
 * tests can exercise it without triggering `process.exit` — the same split
 * the repo already uses for
 * `apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts` and
 * `scripts/verify-lifecycle-transition-contract.ts`.
 *
 * USAGE:
 *   bun scripts/verify-markdown-mermaid-blocks.ts <markdown-file> [...]
 *
 * EXIT CODES:
 *   0 — every document's mermaid blocks are well-formed
 *   1 — at least one document is malformed
 *   2 — usage error (no target files)
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyMarkdownMermaidBlocks } from "../apps/vscode/src/sdk/markdown-mermaid-block-verifier"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const targets = process.argv.slice(2)
if (targets.length === 0) {
	console.error("usage: verify-markdown-mermaid-blocks.ts <markdown-file> [...]")
	process.exit(2)
}

let failed = 0
for (const target of targets) {
	const path = resolve(repoRoot, target)
	const markdown = readFileSync(path, "utf8")
	const { errors, mermaidBlockCount } = verifyMarkdownMermaidBlocks(markdown)
	if (errors.length > 0) {
		failed++
		console.error(`FAIL ${path}`)
		for (const error of errors) console.error(`  - ${error}`)
	} else {
		console.log(
			`PASS ${path}: ${mermaidBlockCount} mermaid block(s), no Markdown leaked into a mermaid fence`,
		)
	}
}
process.exit(failed === 0 ? 0 : 1)
