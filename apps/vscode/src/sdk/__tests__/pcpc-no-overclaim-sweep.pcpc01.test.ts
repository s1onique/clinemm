/**
 * ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01:
 *
 * Structural anti-overclaim gate. Cheap source/doc grep gate that
 * rejects new active claims matching concepts the predecessor ACT
 * retacts (e.g. "zero descendants"). Also verifies production does
 * NOT introduce pkill/killall/kill(-1,/process-name sweeps / same-UID
 * sweeps / command-text detection for detached:true / setsid.
 *
 * Scope:
 *   - apps/vscode/src (production code; no dist/, no generated/)
 *   - docs/ (user-facing docs)
 *   - .factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01/
 *     (test fixtures and historical retraction text are excluded
 *     from the hard-block; see allow-list below)
 *
 * Allow-list (historical / retraction / fixture):
 *   - .factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01/03-red-*
 *     and 04-red-*: these are the RED witness documents that
 *     REFERENCE the escape-claim patterns to refute them. They are
 *     intentionally NOT production claims.
 *   - .factory/evidence/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01/
 *     : the predecessor ACT's evidence file is pre-existing
 *     documentary history and not a new production claim.
 *   - .factory/acts/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01.md
 *     and ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01.md
 *     : the ACT body itself uses these phrases RETRACTIVELY.
 *   - apps/vscode/src/sdk/__tests__/pcpc-*.test.ts and
 *     .factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01/06-incident-cardinality.txt
 *     : these are test / evidence code that REFERENCE the patterns
 *     in the context of asserting they are absent from production.
 *
 * Outside the allow-list, the patterns must produce ZERO matches.
 */

import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..")
const SWEEP_ROOTS = ["apps/vscode/src", "docs"]

// Patterns that, if they appear in production, would constitute an
// overclaim. Each is case-insensitive.
const OVERCLAIM_PATTERNS = [
	/zero descendants/i,
	/all descendants killed/i,
	/all spawned processes terminated/i,
	/escape detected/i,
	/leaked descendant detected/i,
	/process leak detected/i,
	/no descendants leaked/i,
]

// Patterns that, if they appear as NEW code (not historical retraction)
// would violate the ACT spec's structural prohibitions.
const PROHIBITED_PRIMITIVES = [
	/\bpkill\b/,
	/\bkillall\b/,
	/\bkill\(\s*-\s*1/, // kill(-1, ...)
	/pgrep\b.*\bby executable/i,
]

const ALLOW_LIST_RELATIVE = [
	// This ACT's REDs and evidence files that REFERENCE the patterns.
	".factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01/",
	// Predecessor ACT body and evidence.
	".factory/acts/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01.md",
	".factory/evidence/ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01/",
	// This ACT's test files.
	"apps/vscode/src/sdk/__tests__/pcpc-",
	"apps/vscode/src/sdk/__tests__/pcpc-no-overclaim-sweep.pcpc01.test.ts",
	// This ACT's body uses these phrases retractively.
	".factory/acts/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01.md",
]

function isAllowListed(relativePath: string): boolean {
	for (const prefix of ALLOW_LIST_RELATIVE) {
		if (relativePath.startsWith(prefix)) return true
	}
	return false
}

async function walk(dir: string, out: string[]): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true })
	for (const e of entries) {
		const full = join(dir, e.name)
		if (e.isDirectory()) {
			if (e.name === "node_modules" || e.name === "dist" || e.name === "out" || e.name === ".git") continue
			await walk(full, out)
		} else if (e.isFile()) {
			if (e.name.endsWith(".ts") || e.name.endsWith(".tsx") || e.name.endsWith(".md") || e.name.endsWith(".mdx")) {
				out.push(full)
			}
		}
	}
}

describe("ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01 / structural anti-overclaim sweep", () => {
	it("PCPC-AO-02: production code + user docs do NOT contain overclaim patterns", async () => {
		const files: string[] = []
		for (const root of SWEEP_ROOTS) {
			const abs = join(PROJECT_ROOT, root)
			try {
				await walk(abs, files)
			} catch {
				// directory missing — skip
			}
		}
		const violations: { file: string; pattern: string; line: number; text: string }[] = []
		for (const f of files) {
			const rel = relative(PROJECT_ROOT, f)
			if (isAllowListed(rel)) continue
			const text = await readFile(f, "utf8")
			for (const pat of OVERCLAIM_PATTERNS) {
				const m = text.match(pat)
				if (m && m.index !== undefined) {
					const before = text.slice(0, m.index)
					const line = before.split("\n").length
					violations.push({ file: rel, pattern: pat.source, line, text: m[0] })
				}
			}
		}
		expect(violations).toEqual([])
	})

	it("PCPC-AO-03: production code does NOT introduce pkill/killall/kill(-1,/pgrep-by-name", async () => {
		const files: string[] = []
		for (const root of SWEEP_ROOTS) {
			const abs = join(PROJECT_ROOT, root)
			try {
				await walk(abs, files)
			} catch {
				// directory missing — skip
			}
		}
		const violations: { file: string; pattern: string; line: number; text: string }[] = []
		for (const f of files) {
			const rel = relative(PROJECT_ROOT, f)
			if (isAllowListed(rel)) continue
			const text = await readFile(f, "utf8")
			for (const pat of PROHIBITED_PRIMITIVES) {
				const m = text.match(pat)
				if (m && m.index !== undefined) {
					const before = text.slice(0, m.index)
					const line = before.split("\n").length
					violations.push({ file: rel, pattern: pat.source, line, text: m[0] })
				}
			}
		}
		expect(violations).toEqual([])
	})

	it("PCPC-AO-04: production code does NOT introduce same-UID sweeps or ps|grep / command-text detection for detached:true/setsid", async () => {
		const files: string[] = []
		for (const root of SWEEP_ROOTS) {
			const abs = join(PROJECT_ROOT, root)
			try {
				await walk(abs, files)
			} catch {
				// directory missing — skip
			}
		}
		const SAMED_UID_OR_TEXT_DETECT = [
			/same[-_ ]uid/i,
			/same uid sweep/i,
			/\bps\s*\|\s*grep\b/,
			/detected:?\s*['"]?(?:true|setsid)/i, // command-text detection for detached:true/setsid
		]
		const violations: { file: string; pattern: string; line: number; text: string }[] = []
		for (const f of files) {
			const rel = relative(PROJECT_ROOT, f)
			if (isAllowListed(rel)) continue
			const text = await readFile(f, "utf8")
			for (const pat of SAMED_UID_OR_TEXT_DETECT) {
				const m = text.match(pat)
				if (m && m.index !== undefined) {
					const before = text.slice(0, m.index)
					const line = before.split("\n").length
					violations.push({ file: rel, pattern: pat.source, line, text: m[0] })
				}
			}
		}
		expect(violations).toEqual([])
	})
})
