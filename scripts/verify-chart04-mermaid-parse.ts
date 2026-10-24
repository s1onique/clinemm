/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01
 *
 * Parse the ACTUAL embedded Chart 04 Mermaid block with the INSTALLED REAL
 * Mermaid parser (the pinned `mermaid` version from the workspace root).
 *
 * The Markdown-Mermaid guard (`verify-markdown-mermaid-blocks.ts`) checks
 * the FENCE STRUCTURE; this script checks that the diagram is a SYNTACTICALLY
 * VALID Mermaid document according to Mermaid itself.
 *
 * IMPORTANT: syntax validity is NOT behavioural conformance. The behaviour
 * is proven by the executable witness suite
 * (`apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts`).
 * This script only establishes that the embedded diagram is well-formed.
 *
 * USAGE:
 *   bun scripts/verify-chart04-mermaid-parse.ts [markdown-file ...]
 *
 * EXIT CODES:
 *   0 — every document's embedded mermaid block parses
 *   1 — at least one document's mermaid block fails to parse
 *   2 — usage error (no target files)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractMermaidBlocks } from "../apps/vscode/src/sdk/lifecycle-transition-contract-verifier";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = process.argv.slice(2);
if (targets.length === 0) {
	console.error("usage: verify-chart04-mermaid-parse.ts <markdown-file> [...]");
	process.exit(2);
}

// The REAL Mermaid parser.
//
// Mermaid's own `mermaid.parse()` entry point is the authoritative
// validation: it registers the diagram types and runs the full parse +
// validation pipeline. It needs a DOM (for its sanitizer), so a headless
// `jsdom` window is installed BEFORE the Mermaid module is imported.
//
// The pinned versions are used: `mermaid` from the root package.json and
// the `jsdom` copy already present in the workspace store. Both are
// resolved through the Bun store layout because they are not hoisted into
// the root `node_modules` directory.
const jsdomEntry = resolve(
	repoRoot,
	"node_modules/.bun/jsdom@26.1.0/node_modules/jsdom/lib/api.js",
);
const mermaidEntry = resolve(
	repoRoot,
	"node_modules/.bun/mermaid@11.16.1/node_modules/mermaid/dist/mermaid.core.mjs",
);
for (const entry of [jsdomEntry, mermaidEntry]) {
	if (!existsSync(entry)) {
		console.error(
			`FAIL: a required pinned dependency is not installed at ${entry}`,
		);
		process.exit(1);
	}
}

const { JSDOM } = (await import(jsdomEntry)) as {
	JSDOM: new (
		html?: string,
		options?: Record<string, unknown>,
	) => {
		window: Record<string, unknown> & { document: unknown };
	};
};
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	pretendToBeVisual: true,
});
const globalScope = globalThis as unknown as Record<string, unknown>;
globalScope.window = dom.window;
globalScope.document = dom.window.document;
globalScope.navigator = dom.window.navigator;
globalScope.HTMLElement = (
	dom.window as unknown as Record<string, unknown>
).HTMLElement;
globalScope.SVGElement = (
	dom.window as unknown as Record<string, unknown>
).SVGElement;
globalScope.Element = (
	dom.window as unknown as Record<string, unknown>
).Element;
globalScope.Node = (dom.window as unknown as Record<string, unknown>).Node;
globalScope.DOMParser = (
	dom.window as unknown as Record<string, unknown>
).DOMParser;
globalScope.NodeFilter = (
	dom.window as unknown as Record<string, unknown>
).NodeFilter;
globalScope.getComputedStyle = (
	dom.window as unknown as Record<string, unknown>
).getComputedStyle;
globalScope.requestAnimationFrame = (cb: (t: number) => void) =>
	setTimeout(() => cb(Date.now()), 0);
globalScope.cancelAnimationFrame = (id: number) => clearTimeout(id);

const mermaidModule = (await import(mermaidEntry)) as {
	default?: {
		parse: (text: string) => Promise<unknown>;
		initialize: (o: Record<string, unknown>) => void;
	};
	parse?: (text: string) => Promise<unknown>;
	initialize?: (o: Record<string, unknown>) => void;
};
const mermaid =
	mermaidModule.default ??
	(mermaidModule as unknown as { parse: (text: string) => Promise<unknown> });
mermaid.initialize?.({ startOnLoad: false, securityLevel: "loose" });

let failed = 0;
for (const target of targets) {
	const path = resolve(repoRoot, target);
	const markdown = readFileSync(path, "utf8");
	const blocks = extractMermaidBlocks(markdown);
	if (blocks.length === 0) {
		console.error(`FAIL ${path}: no embedded mermaid block`);
		failed++;
		continue;
	}
	for (const [index, block] of blocks.entries()) {
		try {
			await mermaid.parse(block);
			console.log(
				`PASS ${path}: mermaid block ${index + 1}/${blocks.length} parses (real Mermaid parser)`,
			);
		} catch (error) {
			failed++;
			const message = error instanceof Error ? error.message : String(error);
			console.error(
				`FAIL ${path}: mermaid block ${index + 1}/${blocks.length} failed to parse`,
			);
			console.error(`  - ${message.split("\n").join("\n  - ")}`);
		}
	}
}

process.exit(failed === 0 ? 0 : 1);
