/**
 * ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01.
 *
 * PURE validation core for the Mermaid blocks embedded in the lifecycle
 * architecture Markdown documents.
 *
 * WHY THIS EXISTS.
 *
 * `docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md` shipped a
 * `mermaid` fence whose CLOSING fence sat at the very bottom of the document.
 * GitHub therefore fed the intervening Markdown (headings and tables) into
 * the Mermaid parser, which rejected the file at the first table row:
 *
 *   Parse error on line 44: ...| Field | Value ||---|---|| source |
 *
 * The pre-existing `scripts/verify-lifecycle-transition-contract.ts` did NOT
 * catch this: it validates the SEPARATE `c9-c10-traceability.mmd` file, not
 * the diagram embedded in the Markdown. A green contract verifier therefore
 * gave false assurance about the embedded diagram.
 *
 * This core closes that hole. It checks, for every Markdown document that
 * contains a mermaid fence:
 *
 *   1. every fenced block is CLOSED (no unterminated fence);
 *   2. a `mermaid` block contains ONLY Mermaid content — no Markdown table
 *      rows, no ATX headings — so GitHub's Mermaid renderer can never be
 *      handed Markdown;
 *   3. the mermaid block declares a diagram type mermaid recognises;
 *   4. every Markdown table row and heading lives OUTSIDE any mermaid fence.
 *
 * It intentionally uses only Node/Bun built-ins and has NO side effects, so
 * it runs in CI without a DOM and without a network. The CLI wrapper lives
 * at `scripts/verify-markdown-mermaid-blocks.ts`.
 */

/** Mermaid diagram types recognised by `mermaid.detectType`. */
const KNOWN_MERMAID_DIAGRAM_TYPES = [
	"flowchart",
	"graph",
	"sequenceDiagram",
	"classDiagram",
	"stateDiagram",
	"erDiagram",
	"journey",
	"gantt",
	"pie",
	"gitGraph",
	"mindmap",
	"timeline",
	"quadrantChart",
	"requirementDiagram",
	"C4Context",
	"C4Container",
	"C4Component",
	"C4Dynamic",
	"C4Deployment",
	"block-beta",
	"packet-beta",
	"architecture-beta",
	"kanban",
	"radar-beta",
	"treemap-beta",
	"zenuml",
	"sankey-beta",
	"xychart-beta",
]

export interface MarkdownFence {
	/** Fence info string, e.g. "mermaid" or "" for a plain fence. */
	readonly language: string
	/** 1-based line number of the opening fence. */
	readonly startLine: number
	/** 1-based line number of the closing fence, or undefined when unclosed. */
	readonly endLine: number | undefined
	/** The block's inner text (the lines between the fences). */
	readonly body: string
	/** The block's inner lines. */
	readonly bodyLines: readonly string[]
}

/**
 * Extract every fenced code block from a Markdown document.
 *
 * A fence is a line whose first non-whitespace characters are three or more
 * backticks. The info string is the remainder of the opening fence line.
 * An unterminated fence is reported with `endLine === undefined`.
 */
export function parseMarkdownFences(markdown: string): MarkdownFence[] {
	const lines = markdown.split("\n")
	const fences: MarkdownFence[] = []
	let open: { language: string; startLine: number; bodyLines: string[] } | undefined

	for (let i = 0; i < lines.length; i++) {
		const fenceMatch = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i])
		if (fenceMatch) {
			const marker = fenceMatch[1]
			const info = fenceMatch[2].trim()
			if (open === undefined) {
				open = { language: info.split(/\s+/)[0] ?? "", startLine: i + 1, bodyLines: [] }
			} else if (marker.startsWith("`") && info.includes("`")) {
				// A fence whose info string contains a backtick cannot close an
				// open backtick fence (CommonMark rule); treat it as body.
				open.bodyLines.push(lines[i])
			} else {
				fences.push({
					language: open.language,
					startLine: open.startLine,
					endLine: i + 1,
					body: open.bodyLines.join("\n"),
					bodyLines: open.bodyLines,
				})
				open = undefined
			}
			continue
		}
		if (open !== undefined) open.bodyLines.push(lines[i])
	}

	if (open !== undefined) {
		fences.push({
			language: open.language,
			startLine: open.startLine,
			endLine: undefined,
			body: open.bodyLines.join("\n"),
			bodyLines: open.bodyLines,
		})
	}

	return fences
}

/** A Markdown table row: `| a | b |` with a leading/trailing pipe. */
function isMarkdownTableRow(line: string): boolean {
	const trimmed = line.trim()
	if (!trimmed.includes("|")) return false
	const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|")
	return cells.length >= 2
}

/** An ATX heading (`## Title`) or a setext heading underline (`===`). */
function isMarkdownHeading(line: string): boolean {
	const trimmed = line.trim()
	if (/^#{1,6}\s+\S/.test(trimmed)) return true
	if (/^(=+|-{2,})\s*$/.test(trimmed) && trimmed.length > 2) return true
	return false
}

/** Detect the mermaid diagram type declared by a mermaid block body. */
export function detectMermaidDiagramType(body: string): string | undefined {
	const firstMeaningful = body
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !line.startsWith("%%"))
	if (!firstMeaningful) return undefined
	const keyword = firstMeaningful.split(/\s+/)[0]
	return KNOWN_MERMAID_DIAGRAM_TYPES.find((type) => keyword === type || keyword.startsWith(`${type}-`))
}

export interface MermaidBlockVerificationResult {
	readonly errors: string[]
	readonly mermaidBlockCount: number
}

/**
 * Verify the mermaid blocks of a single Markdown document.
 *
 * Returns the list of errors; an empty list means the document's mermaid
 * blocks are well-formed and no Markdown leaked into them.
 */
export function verifyMarkdownMermaidBlocks(markdown: string): MermaidBlockVerificationResult {
	const errors: string[] = []
	const fences = parseMarkdownFences(markdown)
	const mermaidFences = fences.filter((fence) => fence.language.toLowerCase() === "mermaid")

	for (const fence of fences) {
		if (fence.endLine === undefined) {
			errors.push(
				`fence opened at line ${fence.startLine} is never closed; GitHub will treat the REST OF THE DOCUMENT as code`,
			)
		}
	}

	for (const fence of mermaidFences) {
		if (fence.endLine === undefined) continue
		for (const [offset, line] of fence.bodyLines.entries()) {
			const lineNumber = fence.startLine + 1 + offset
			if (line.trim().length > 0 && isMarkdownTableRow(line)) {
				errors.push(
					`mermaid block (lines ${fence.startLine}..${fence.endLine}) contains a Markdown TABLE ROW at line ${lineNumber}: ${line.trim()} — GitHub's Mermaid renderer will reject the whole document`,
				)
			}
			if (isMarkdownHeading(line)) {
				errors.push(
					`mermaid block (lines ${fence.startLine}..${fence.endLine}) contains a Markdown HEADING at line ${lineNumber}: ${line.trim()} — GitHub's Mermaid renderer will reject the whole document`,
				)
			}
		}
		const diagramType = detectMermaidDiagramType(fence.body)
		if (!diagramType) {
			errors.push(
				`mermaid block (lines ${fence.startLine}..${fence.endLine}) does not declare a recognised Mermaid diagram type`,
			)
		}
	}

	// Every Markdown table and heading in the document must live OUTSIDE any
	// mermaid fence. This is the invariant the original file violated.
	const mermaidLineRanges = mermaidFences
		.filter((fence): fence is MarkdownFence & { endLine: number } => fence.endLine !== undefined)
		.map((fence) => [fence.startLine, fence.endLine] as const)

	const lines = markdown.split("\n")
	let tableRowCount = 0
	for (const [index, line] of lines.entries()) {
		const lineNumber = index + 1
		const insideMermaid = mermaidLineRanges.some(([start, end]) => lineNumber > start && lineNumber < end)
		if (insideMermaid) continue
		if (line.trim().startsWith("|") && line.trim().length > 1) tableRowCount++
	}

	if (mermaidFences.length > 0 && tableRowCount === 0) {
		errors.push("document contains a mermaid block but no Markdown table row outside it")
	}

	return { errors, mermaidBlockCount: mermaidFences.length }
}
