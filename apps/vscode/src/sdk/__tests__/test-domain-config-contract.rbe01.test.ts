// ============================================================================
// ACT-CLINEMM-RATCHET-BRIDGE-EXCLUSION-FIXUP01 / RBE01
//
// Structural / config-contract invariant for the apps/vscode test-domain split:
//
//   1. Bridge-only test files (those that live ONLY under a dedicated
//      vitest config, e.g. `vitest.config.c2-4-c-bridge.ts` or
//      `vitest.config.c2-4-d-hub.ts`, because they require aliases /
//      fs.allow scopes the BASE config does NOT supply) MUST be excluded
//      from the BASE `vitest.config.ts` so the canonical coverage
//      ratchet (`bun run test:coverage:ratchet`) does not discover and
//      fail them.
//
//   2. Bridge vitest discovery MUST match bridge tsconfig discovery:
//      every file the bridge vitest config executes must also be
//      typechecked by the corresponding bridge tsconfig.
//
//   3. Bridge tsconfig discovery MUST be a subset of bridge vitest
//      discovery (no orphan-typechecked files).
//
// Why this file is here:
//   Historical evidence showed that AOPC02 Phase-A bridge tests were
//   listed in `vitest.config.c2-4-c-bridge.ts#test.include` but were
//   MISSING from `vitest.config.ts#test.exclude`. The base vitest
//   `test.include` glob (`src/sdk/**/*.test.ts`) then picked them up,
//   the base alias map lacked `@cline-internal/core/...`, and the
//   canonical coverage ratchet failed with `TypeError: Cannot read
//   properties of undefined (reading 'create')`. This test makes that
//   invariant UNCONDITIONALLY enforced at the config layer, so any
//   future file added to a bridge config without also being added to
//   the base exclude (or vice versa) fails CI on this exact assertion
//   before the ratchet even runs.
//
// Non-goals:
//   - No production source change.
//   - No runtime / behavior change.
//   - No coverage threshold manipulation.
//
// CONTRACT_A (preferred per recon): bridge-only tests execute ONLY under
//   the dedicated bridge vitest config and bridge tsconfig, and MUST
//   be excluded from the base vitest config + base tsconfig.
// ============================================================================

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const APPS_VSCODE_ROOT = resolve(__dirname, "../../..")

interface VitestConfigSnapshot {
	includes: string[]
	excludes: string[]
}

interface TsConfigSnapshot {
	includes: string[]
	excludes: string[]
}

/**
 * Best-effort structural parser for `vitest.config*.ts`. We do NOT
 * require importing the actual vitest config (that would pull in the
 * whole resolve/alias machinery we are trying to audit). Instead we
 * extract the `include:` / `exclude:` string arrays from the raw
 * source -- both base and bridge configs use a stable shape:
 *
 *     test: {
 *         include: [ "...", "..." ],
 *         exclude: [ "...", "..." ],
 *     }
 *
 * Any pattern outside that exact shape is reported as a parse failure
 * so the maintainer knows to either simplify or extend the parser.
 */
function parseVitestConfigSnapshot(configPath: string): VitestConfigSnapshot {
	const raw = readFileSync(configPath, "utf8")
	// Locate the `test: { ... }` block. The base config ends the block
	// at the coverage sub-config (depth 2 closing brace); bridge configs
	// (c2-4-c-bridge, c2-4-d-hub) end the block right after
	// `testTimeout` (depth 1 closing brace). Match the OUTER `test: {`
	// then balance braces to find the matching close.
	const testStart = raw.search(/\btest\s*:\s*\{/)
	if (testStart === -1) {
		throw new Error(
			`RBE01: could not locate \`test: { ... }\` block in ${configPath}. The contract parser requires this shape; refactor or extend parseVitestConfigSnapshot.`,
		)
	}
	let depth = 0
	let end = -1
	for (let i = testStart; i < raw.length; i++) {
		const c = raw[i]
		if (c === "{") {
			depth++
		} else if (c === "}") {
			depth--
			if (depth === 0) {
				end = i
				break
			}
		}
	}
	if (end === -1) {
		throw new Error(`RBE01: unbalanced braces in \`test:\` block of ${configPath}.`)
	}
	const inner = raw.slice(testStart, end + 1)
	const includeMatch = inner.match(/include\s*:\s*\[([\s\S]*?)\]/)
	const excludeMatch = inner.match(/exclude\s*:\s*\[([\s\S]*?)\]/)
	if (!includeMatch) {
		throw new Error(
			`RBE01: could not locate \`include:\` array inside \`test:\` block of ${configPath}.`,
		)
	}
	const pluck = (block: string): string[] =>
		block
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.startsWith('"'))
			.map((l) => l.replace(/^"|",?$/g, "").replace(/,$/, ""))
			.filter((l) => l.length > 0)
	return {
		includes: pluck(includeMatch[1]),
		excludes: excludeMatch ? pluck(excludeMatch[1]) : [],
	}
}

function parseTsConfigSnapshot(configPath: string): TsConfigSnapshot {
	// tsconfig files are JSON-with-comments; strip line comments before parsing.
	const raw = readFileSync(configPath, "utf8")
	const stripped = raw
		.split("\n")
		.filter((l) => !/^\s*\/\//.test(l))
		.join("\n")
	const parsed = JSON.parse(stripped) as {
		include?: string[]
		exclude?: string[]
	}
	return {
		includes: parsed.include ?? [],
		excludes: parsed.exclude ?? [],
	}
}

const BASE_VITEST_CONFIG_PATH = resolve(APPS_VSCODE_ROOT, "vitest.config.ts")
const BASE_TSCONFIG_PATH = resolve(APPS_VSCODE_ROOT, "tsconfig.json")

const BRIDGE_CONFIGS = [
	{
		name: "c2-4-c-bridge",
		vitestConfigPath: resolve(APPS_VSCODE_ROOT, "vitest.config.c2-4-c-bridge.ts"),
		tsConfigPath: resolve(APPS_VSCODE_ROOT, "tsconfig.c2-4-c-bridge.json"),
	},
	{
		name: "c2-4-d-hub",
		vitestConfigPath: resolve(APPS_VSCODE_ROOT, "vitest.config.c2-4-d-hub.ts"),
		tsConfigPath: resolve(APPS_VSCODE_ROOT, "tsconfig.c2-4-d-hub.json"),
	},
] as const

describe("RBE01 test-domain config-contract (base vs bridge)", () => {
	const baseVitest = parseVitestConfigSnapshot(BASE_VITEST_CONFIG_PATH)
	const baseTsConfig = parseTsConfigSnapshot(BASE_TSCONFIG_PATH)

	for (const bridge of BRIDGE_CONFIGS) {
		describe(bridge.name + " bridge", () => {
			const bridgeVitest = parseVitestConfigSnapshot(bridge.vitestConfigPath)
			const bridgeTsConfig = parseTsConfigSnapshot(bridge.tsConfigPath)

			it("vitest + tsconfig snapshots parsed", () => {
				expect(bridgeVitest.includes.length).toBeGreaterThan(0)
				expect(bridgeTsConfig.includes.length).toBeGreaterThan(0)
			})

			// INVARIANT 1: every bridge vitest include MUST be excluded
			// from the BASE vitest config. Otherwise the base glob
			// (`src/sdk/**/*.test.ts` etc.) will discover it, the base
			// config will lack the bridge aliases, and the canonical
			// coverage ratchet will fail.
			it("every bridge vitest include is excluded from the BASE vitest config", () => {
				const missing = bridgeVitest.includes.filter(
					(bridgeFile) => !baseVitest.excludes.includes(bridgeFile),
				)
				expect(
					missing,
					"Bridge vitest config " + bridge.name + " includes these files but the BASE vitest.config.ts does NOT exclude them (they will be discovered by the base glob and fail with module-load errors because the base config lacks the bridge aliases):\n" +
						missing.map((f) => "  - " + f).join("\n"),
				).toEqual([])
			})

			// INVARIANT 2: every bridge vitest include MUST be excluded
			// from the BASE tsconfig. Otherwise the base typecheck
			// (`tsc -p tsconfig.json`) will attempt to typecheck them
			// and fail because the `@cline-internal/core/...` aliases
			// are not declared in the base tsconfig.
			it("every bridge vitest include is excluded from the BASE tsconfig", () => {
				const missing = bridgeVitest.includes.filter(
					(bridgeFile) => !baseTsConfig.excludes.includes(bridgeFile),
				)
				expect(
					missing,
					"Bridge vitest config " + bridge.name + " includes these files but the BASE tsconfig.json does NOT exclude them (they will be typechecked by the base tsc and fail because the bridge aliases are not declared in the base tsconfig):\n" +
						missing.map((f) => "  - " + f).join("\n"),
				).toEqual([])
			})

			// INVARIANT 3: every bridge vitest include MUST also be
			// typechecked by the bridge tsconfig. Otherwise a bridge
			// test could execute with stale or absent type information.
			it("every bridge vitest include is in the BRIDGE tsconfig include", () => {
				const missing = bridgeVitest.includes.filter(
					(bridgeFile) => !bridgeTsConfig.includes.includes(bridgeFile),
				)
				expect(
					missing,
					"Bridge vitest config " + bridge.name + " includes these files but the bridge tsconfig does NOT include them (the file would execute but NOT be typechecked):\n" +
						missing.map((f) => "  - " + f).join("\n"),
				).toEqual([])
			})

			// INVARIANT 4: every bridge tsconfig include MUST also be
			// in the bridge vitest include. Otherwise a file would be
			// typechecked but never executed (orphan-typechecked file).
			it("every bridge tsconfig include is in the BRIDGE vitest include", () => {
				const orphan = bridgeTsConfig.includes.filter(
					(bridgeFile) => !bridgeVitest.includes.includes(bridgeFile),
				)
				expect(
					orphan,
					"Bridge tsconfig includes these files but the bridge vitest config " + bridge.name + " does NOT execute them (orphan typecheck -- no test runs them):\n" +
						orphan.map((f) => "  - " + f).join("\n"),
				).toEqual([])
			})
		})
	}
})
