// ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02
//
// Real-wiring RED for the production callback bound to
// `getCanonicalRestorePhase`. Drives the actual
// `selectCanonicalRestorePhase` helper at
// `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` and
// asserts the production SdkController binding routes through
// `createCanonicalRestorePhaseCallback` with BOTH
// `getCanonicalShadowPhase` AND `getCurrentLegacyPhase` inputs.
//
// =============================================================================
// TABLE-DRIVEN CASES (replaces the verbose 28-test matrix)
// =============================================================================
//
// The selector truth table is small (4 branches × ~3 inputs each =
// ~12 cells). The factory's contract is "delegates both accessors
// verbatim" (1 cell). The wiring's contract is "factory call with
// both accessors" (1 cell). The ablation is "OLD form would lose
// the host dimension" (1 cell). That is ~15 semantic cases total
// — the matrix below encodes them as data so a future maintainer
// can read the invariants in one table.
//
// Reference contract -- the canonical-projection / entry-phase matrix.
//
//   entry.phase \ canonical | undefined | idle | awaiting_followup | completed | resumable | error
//   ----------------------|-----------|------|-------------------|-----------|-----------|-------
//   idle (terminal)        | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   completed (terminal)   | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   awaiting_followup (T)  | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   resumable (terminal)   | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   error (terminal)       | preserve  | preserve | preserve    | preserve  | preserve  | preserve
//   compacting (system)    | restorePhase is never invoked with compacting
//   streaming (non-T)      | preserve  | idle     | awaiting_fu | completed | resumable | error
//   awaiting_approval (NT) | preserve  | idle     | awaiting_fu | completed | resumable | error
//
// The bounded repair fires ONLY in the cells where the entry phase
// is a non-terminal owner AND the canonical projection is a
// defined TurnPhase. Every other cell preserves byte-equivalent
// behavior.
//
// =============================================================================
// CORRECTION02 BOUNDED REPAIR: production wiring
// =============================================================================
//
// The canonical restore callback is rebuilt to follow the EXACT
// same three-source precedence the TaskHeader projection
// (`selectTaskHeaderPresentation`) uses:
//   1. HOST COMPACTING OVERRIDE (system-owned)
//   2. HOST AWAITING_FOLLOWUP OVERRIDE (user-owned, reads the
//      legacy `turnStateTracker.currentPhase` because the canonical
//      shadow cannot represent it)
//   3. CANONICAL SHADOW PROJECTION for the 6 phases the canonical
//      shadow CAN represent (idle / streaming / awaiting_approval /
//      completed / error / resumable)
//
// Implemented by adding `selectCanonicalRestorePhase` +
// `createCanonicalRestorePhaseCallback` to
// `task-state-shadow-arbiter-mapper.ts` (the same file that owns
// the analogous `selectTaskHeaderPresentation`). The
// SdkController wires the new composition into
// `getCanonicalRestorePhase` via the factory. The coordinator API
// is preserved verbatim.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { TurnPhase } from "@shared/ExtensionMessage"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { createCanonicalRestorePhaseCallback, selectCanonicalRestorePhase } from "../task-state-shadow-arbiter-mapper"

// =============================================================================
// PART 1: SELECTOR TRUTH TABLE -- data-driven; one entry per cell.
// =============================================================================
//
// The "entry phase" matches the legacy tracker's entry phase the
// coordinator's `enterCompactingPhase()` samples (the `entry.phase`
// argument passed to `restorePhase()`). The "canonical" matches
// what the canonical shadow reports (or `undefined` when absent).
// The "expected" is the canonical restore phase the bounded repair
// must write.
//
// "preserve" means: the bounded repair does NOT fire; the
// coordinator preserves the entry phase (the prior compatibility
// behavior). "idle" / "completed" etc. mean: the bounded repair
// fires and writes that phase.

type Case = readonly [string, TurnPhase | undefined, TurnPhase, TurnPhase | undefined]

const SELECTOR_CASES: readonly Case[] = [
	// HOST COMPACTING OVERRIDE -- regardless of canonical shadow.
	["host compacting override beats shadow idle", "idle", "compacting", "compacting"],
	["host compacting override beats shadow undefined", undefined, "compacting", "compacting"],

	// HOST AWAITING_FOLLOWUP OVERRIDE -- regardless of canonical shadow.
	["host awaiting_followup override beats shadow idle", "idle", "awaiting_followup", "awaiting_followup"],
	["host awaiting_followup override beats shadow undefined", undefined, "awaiting_followup", "awaiting_followup"],

	// TERMINAL ENTRY PHASES -- preserve entry ALWAYS, regardless of
	// canonical shadow. The legacy tracker IS the authority for
	// terminal owners (the session-event coordinator writes them
	// directly); consulting the canonical shadow could regress a
	// terminal state.
	["idle entry preserved regardless of shadow", "streaming", "idle", "idle"],
	["idle entry preserved with shadow undefined", undefined, "idle", "idle"],
	["completed entry preserved", "idle", "completed", "completed"],
	["completed entry preserved with shadow undefined", undefined, "completed", "completed"],
	["resumable entry preserved", "idle", "resumable", "resumable"],
	["error entry preserved", "idle", "error", "error"],

	// NON-TERMINAL ENTRY + DEFINED CANONICAL -- bounded repair fires,
	// writes canonical projection.
	["streaming entry + canonical idle -> idle", "idle", "streaming", "idle"],
	["streaming entry + canonical completed -> completed", "completed", "streaming", "completed"],
	["streaming entry + canonical resumable -> resumable", "resumable", "streaming", "resumable"],
	["streaming entry + canonical error -> error", "error", "streaming", "error"],
	["streaming entry + canonical streaming -> streaming", "streaming", "streaming", "streaming"],
	["streaming entry + canonical awaiting_approval -> awaiting_approval", "awaiting_approval", "streaming", "awaiting_approval"],
	["awaiting_approval entry + canonical idle -> idle", "idle", "awaiting_approval", "idle"],

	// P1: `unavailable != idle` -- non-terminal entry + canonical
	// undefined returns undefined so the coordinator's
	// `undefined -> preserve` gate fires (preserves entry; does NOT
	// synthesize `idle`).
	["streaming entry + canonical undefined -> undefined (preserve entry)", undefined, "streaming", undefined],
	["awaiting_approval entry + canonical undefined -> undefined (preserve entry)", undefined, "awaiting_approval", undefined],
] as const

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / selectCanonicalRestorePhase truth table", () => {
	for (const [label, canonical, entry, expected] of SELECTOR_CASES) {
		it(label, () => {
			expect(selectCanonicalRestorePhase({ canonicalShadowPhase: canonical, currentLegacyPhase: entry })).toBe(expected)
		})
	}
})

// =============================================================================
// PART 2: FACTORY DELEGATES BOTH ACCESSORS VERBATIM.
// =============================================================================

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / createCanonicalRestorePhaseCallback factory", () => {
	it("factory returns undefined when canonical is undefined and entry is a non-terminal owner (P1: unavailable != idle)", () => {
		// Factory + selector together preserve the P1 invariant:
		// canonical undefined + non-terminal entry -> undefined.
		// (Terminal entries ALWAYS preserve entry -- not synthesized
		// as undefined; this is the selector's step 3.)
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => undefined,
			getCurrentLegacyPhase: () => "streaming",
		})
		expect(cb()).toBeUndefined()
	})

	it("factory preserves entry for terminal-owner entries regardless of canonical shadow", () => {
		// Terminal-owner entries ALWAYS preserve entry (selector
		// step 3), even when canonical shadow disagrees.
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "completed",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(cb()).toBe("idle")
	})

	it("factory reads the canonical shadow and the legacy tracker on every call (not memoized)", () => {
		// The factory's closure must invoke both accessors per
		// call. If either is memoized, the helper would be stale.
		let canonicalCount = 0
		let legacyCount = 0
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => {
				canonicalCount++
				return "idle"
			},
			getCurrentLegacyPhase: () => {
				legacyCount++
				return "streaming"
			},
		})
		expect(cb()).toBe("idle")
		expect(cb()).toBe("idle")
		expect(canonicalCount).toBe(2)
		expect(legacyCount).toBe(2)
	})
})

// =============================================================================
// PART 3: ABLATION -- the OLD non-host-aware binding collapses to idle.
// =============================================================================

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / ablation", () => {
	it("OLD non-host-aware binding collapses awaiting_followup to idle (the capability gap)", () => {
		// The pre-CORRECTION02 binding at SdkController was:
		//   getCanonicalRestorePhase: () =>
		//     this.taskStateShadowWiring?.getLastObservedShadowPhase()
		// Simulated here. The canonical shadow's projection (driven
		// by `TaskState.projectTurnState(model)`) cannot produce
		// `awaiting_followup` -- it returns `idle` for an idle
		// runtime. The OLD binding would therefore lose the
		// user-owned phase distinction. This is the capability gap
		// CORRECTION02 closes.
		const oldBinding = (canonicalShadowPhase: TurnPhase | undefined): TurnPhase | undefined => canonicalShadowPhase
		expect(oldBinding("idle")).toBe("idle")
		expect(oldBinding("idle")).not.toBe("awaiting_followup")

		// Contrast: the CORRECTION02 factory for the same canonical
		// shadow + a host legacy `awaiting_followup` returns the
		// user-owned phase (via the host-override branch).
		const newBinding = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "awaiting_followup",
		})
		expect(newBinding()).toBe("awaiting_followup")
	})
})

// =============================================================================
// PART 4: AST-LEVEL WIRING ASSERTION (replaces source-text regex inspection).
// =============================================================================
//
// Production SdkController wiring MUST route through
// `createCanonicalRestorePhaseCallback` with BOTH
// `getCanonicalShadowPhase` AND `getCurrentLegacyPhase` inputs.
// This part uses the TypeScript Compiler API (SourceFile /
// forEachChild / ts.factory.createCall / etc.) to walk the AST and
// find the actual CallExpression. It is robust to:
//   - local variable renames (no regex match on identifier text)
//   - whitespace / formatting changes (no regex match on layout)
//   - optional-chaining shape (`a?.b()` vs `a.b()`)
//   - callback body restructuring (we match the structure of the
//     factory CallExpression, not the surrounding code)
//
// Reference:
//   https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
//
// The prior source-text regex inspection (CLTCC13 INSPECTION-A..E
// Helper: read the SdkController source.
function readSdkControllerSource(): string {
	const path = join("..", "..", "apps", "vscode", "src", "sdk", "SdkController.ts")
	return readFileSync(path, "utf-8")
}

// Helper: parse a source file.
function parseSource(name: string, source: string): ts.SourceFile {
	return ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
}

// Helper: find the `new SdkCompactionCoordinator({...})` initializer
// inside the constructor. The object literal is the first argument.
function findSdkCompactionCoordinatorArg(sf: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
	let found: ts.ObjectLiteralExpression | undefined
	function walk(node: ts.Node) {
		if (found) return
		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "SdkCompactionCoordinator") {
			const arg = node.arguments?.[0]
			if (arg && ts.isObjectLiteralExpression(arg)) {
				found = arg
				return
			}
		}
		ts.forEachChild(node, walk)
	}
	walk(sf)
	return found
}

// Helper: find a property initializer by name in an object literal.
function findPropertyInitializer(obj: ts.ObjectLiteralExpression, propName: string): ts.Expression | undefined {
	for (const prop of obj.properties) {
		if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propName) {
			return prop.initializer
		}
	}
	return undefined
}

// Helper: walk every node in the source file.
function walkAll(sf: ts.SourceFile, cb: (node: ts.Node) => void): void {
	function walk(node: ts.Node) {
		cb(node)
		ts.forEachChild(node, walk)
	}
	walk(sf)
}

// Helper: collect exported function declarations.
function collectExportedFunctions(sf: ts.SourceFile): string[] {
	const exported: string[] = []
	walkAll(sf, (node) => {
		if (ts.isFunctionDeclaration(node) && node.name) {
			const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
			if (hasExport) {
				exported.push(node.name.text)
			}
		}
	})
	return exported
}

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / AST-level SdkController wiring assertion", () => {
	const source = readSdkControllerSource()
	const sf = parseSource("SdkController.ts", source)

	it("AST-1: SdkController constructs an SdkCompactionCoordinator with a `getCanonicalRestorePhase` option", () => {
		// Walk the AST and find the SdkCompactionCoordinator
		// constructor. The first argument is the options object
		// literal. The `getCanonicalRestorePhase` property must
		// exist on that object.
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init).toBeDefined()
	})

	it("AST-2: `getCanonicalRestorePhase` is initialized via `createCanonicalRestorePhaseCallback(...)` factory call", () => {
		// The RHS of the `getCanonicalRestorePhase` property
		// assignment MUST be a CallExpression whose callee is the
		// `createCanonicalRestorePhaseCallback` identifier. Robust
		// to local variable renames, reformat, and accessor body
		// changes -- we match the structural shape (factory call)
		// not the surface text.
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init).toBeDefined()
		if (!init || !ts.isCallExpression(init)) {
			throw new Error("getCanonicalRestorePhase initializer is not a CallExpression")
		}
		const callee = init.expression
		if (!ts.isIdentifier(callee) || callee.text !== "createCanonicalRestorePhaseCallback") {
			throw new Error(`getCanonicalRestorePhase callee is not createCanonicalRestorePhaseCallback: ${callee.getText()}`)
		}
	})

	it("AST-3: factory call passes BOTH `getCanonicalShadowPhase` AND `getCurrentLegacyPhase` accessors", () => {
		// The factory CallExpression's first argument is an
		// ObjectLiteralExpression. Both properties must be
		// present. The arrow body of each accessor is irrelevant
		// to this test -- only the property NAME and presence
		// matter (so the test is robust to accessor body
		// restructuring, e.g. extracting an internal variable).
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init && ts.isCallExpression(init)).toBe(true)
		if (!init || !ts.isCallExpression(init)) return
		const factoryArg = init.arguments?.[0]
		expect(factoryArg && ts.isObjectLiteralExpression(factoryArg)).toBe(true)
		if (!factoryArg || !ts.isObjectLiteralExpression(factoryArg)) return
		expect(findPropertyInitializer(factoryArg, "getCanonicalShadowPhase")).toBeDefined()
		expect(findPropertyInitializer(factoryArg, "getCurrentLegacyPhase")).toBeDefined()
	})

	it("AST-4: the RHS is NOT an ArrowFunction (i.e. NOT the OLD non-host-aware bare-canonical-shadow form)", () => {
		// Guard against accidental regression: the binding MUST
		// be a `createCanonicalRestorePhaseCallback({...})` CallExpression
		// (not the OLD bare `() => this.taskStateShadowWiring?.getLastObservedShadowPhase()`
		// ArrowFunction). The structural assertion is robust to
		// whitespace / formatting / reformat and proves the binding
		// routes through the factory. The OLD form is detected via
		// `ts.isArrowFunction` rather than text matching, so
		// renames / reformat cannot bypass it.
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init).toBeDefined()
		if (!init) return
		expect(ts.isArrowFunction(init)).toBe(false)
	})

	it("AST-5: selectCanonicalRestorePhase + createCanonicalRestorePhaseCallback are exported from task-state-shadow-arbiter-mapper.ts", () => {
		// The wiring depends on the helper existing. Assert both
		// exports via the AST (also robust to renames / reformat).
		const path = join("..", "..", "apps", "vscode", "src", "sdk", "task-state-shadow-arbiter-mapper.ts")
		const mapperSource = readFileSync(path, "utf-8")
		const mapperSf = parseSource("task-state-shadow-arbiter-mapper.ts", mapperSource)
		const exported = collectExportedFunctions(mapperSf)
		expect(exported).toContain("selectCanonicalRestorePhase")
		expect(exported).toContain("createCanonicalRestorePhaseCallback")
	})
})
