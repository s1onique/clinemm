/**
 * ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01
 *
 * Tests for the Markdown-embedded Mermaid block guard
 * (`scripts/verify-markdown-mermaid-blocks.ts`).
 *
 * THE DEFECT THIS ACT REPAIRS.
 *
 * `docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md` shipped a
 * `mermaid` fence whose CLOSING fence sat at the very bottom of the document.
 * GitHub therefore fed the intervening Markdown (headings and tables) into
 * the Mermaid parser, which rejected the document at the first table row:
 *
 *   Parse error on line 44: ...| Field | Value ||---|---|| source |
 *
 * The pre-existing `scripts/verify-lifecycle-transition-contract.ts` did NOT
 * catch this because it validates the SEPARATE `c9-c10-traceability.mmd`
 * file, not the diagram embedded in the Markdown. A green contract verifier
 * therefore gave false assurance about the embedded diagram.
 *
 * These tests drive the REAL guard against the REAL architecture document
 * and against reconstructions of the pre-fix defect, so the exact class of
 * failure that shipped cannot come back silently.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { detectMermaidDiagramType, parseMarkdownFences, verifyMarkdownMermaidBlocks } from "../markdown-mermaid-block-verifier"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..")
const chart02Path = resolve(repoRoot, "docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md")
const chart02 = readFileSync(chart02Path, "utf8")

/**
 * Rebuild the pre-fix defect: the `mermaid` fence's closing fence was at the
 * very bottom of the document, so everything between was Mermaid body.
 */
function withMisplacedClosingFence(document: string): string {
	const lines = document.split("\n")
	const mermaidOpen = lines.findIndex((line) => line.trim() === "```mermaid")
	if (mermaidOpen === -1) throw new Error("fixture does not contain a mermaid fence")
	const closeIndex = lines.findIndex((line, index) => index > mermaidOpen && line.trim() === "```")
	if (closeIndex === -1) throw new Error("fixture does not contain a closing fence")
	// Remove the real closing fence and append it at the very end.
	const withoutClose = [...lines.slice(0, closeIndex), ...lines.slice(closeIndex + 1)]
	return [...withoutClose, "```"].join("\n")
}

describe("ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01 — embedded Mermaid block guard", () => {
	describe("the shipped architecture document", () => {
		it("has exactly one mermaid block", () => {
			const { mermaidBlockCount } = verifyMarkdownMermaidBlocks(chart02)
			expect(mermaidBlockCount).toBe(1)
		})

		it("closes every fenced block", () => {
			const fences = parseMarkdownFences(chart02)
			const unclosed = fences.filter((fence) => fence.endLine === undefined)
			expect(unclosed).toHaveLength(0)
		})

		it("keeps the mermaid block free of Markdown (tables and headings)", () => {
			const { errors } = verifyMarkdownMermaidBlocks(chart02)
			expect(errors).toEqual([])
		})

		it("closes the mermaid fence immediately after the last diagram edge", () => {
			const fences = parseMarkdownFences(chart02)
			const mermaid = fences.find((fence) => fence.language === "mermaid")
			expect(mermaid).toBeDefined()
			const lines = chart02.split("\n")
			// The line right before the closing fence is the last terminal edge.
			const lastBodyLine = lines[(mermaid?.endLine ?? 1) - 2].trim()
			expect(lastBodyLine).toBe("C10Withheld --> [*]")
		})

		it("declares a mermaid diagram type mermaid recognises", () => {
			const fences = parseMarkdownFences(chart02)
			const mermaid = fences.find((fence) => fence.language === "mermaid")
			expect(detectMermaidDiagramType(mermaid?.body ?? "")).toBe("stateDiagram")
		})

		it("routes the BCB recovery edge through the Elm consult", () => {
			// The BCB recovery path MUST re-consult Elm: `reevaluateDeferredCompletionBarrier`
			// calls `checkElmCompletionAuthority` BEFORE `setTurnPhase("completed", ...)`.
			// An edge straight from C10Blocked to C10Committed would bypass the
			// mandatory Elm authority gate and contradict A-03/A-04.
			const fences = parseMarkdownFences(chart02)
			const mermaid = fences.find((fence) => fence.language === "mermaid")
			expect(mermaid?.body).toContain("C10Blocked --> ElmConsulted : obligations resolve")
			expect(mermaid?.body).not.toContain("C10Blocked --> C10Committed")
		})

		it("keeps the terminal transitions inside the mermaid block", () => {
			const fences = parseMarkdownFences(chart02)
			const mermaid = fences.find((fence) => fence.language === "mermaid")
			expect(mermaid?.body).toContain("C10Committed --> [*]")
			expect(mermaid?.body).toContain("C10Withheld --> [*]")
		})
	})

	describe("the pre-fix defect", () => {
		const broken = withMisplacedClosingFence(chart02)

		it("is rejected by the guard", () => {
			const { errors } = verifyMarkdownMermaidBlocks(broken)
			expect(errors.length).toBeGreaterThan(0)
		})

		it("reports the Markdown headings that leaked into the mermaid block", () => {
			const { errors } = verifyMarkdownMermaidBlocks(broken)
			expect(errors.some((error) => error.includes("Markdown HEADING"))).toBe(true)
		})

		it("reports the Markdown table rows that leaked into the mermaid block", () => {
			const { errors } = verifyMarkdownMermaidBlocks(broken)
			expect(errors.some((error) => error.includes("Markdown TABLE ROW"))).toBe(true)
		})
	})

	describe("an unterminated fence", () => {
		it("is rejected", () => {
			const { errors } = verifyMarkdownMermaidBlocks("# Title\n\n```mermaid\nstateDiagram-v2\n    [*] --> A\n")
			expect(errors.some((error) => error.includes("never closed"))).toBe(true)
		})
	})

	describe("a mermaid block with no recognised diagram type", () => {
		it("is rejected", () => {
			const { errors } = verifyMarkdownMermaidBlocks("```mermaid\nnot a diagram\n```\n")
			expect(errors.some((error) => error.includes("recognised Mermaid diagram type"))).toBe(true)
		})
	})

	describe("a well-formed document", () => {
		it("passes", () => {
			const { errors, mermaidBlockCount } = verifyMarkdownMermaidBlocks(
				"# Title\n\n```mermaid\nstateDiagram-v2\n    [*] --> A\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
			)
			expect(errors).toEqual([])
			expect(mermaidBlockCount).toBe(1)
		})
	})
})
