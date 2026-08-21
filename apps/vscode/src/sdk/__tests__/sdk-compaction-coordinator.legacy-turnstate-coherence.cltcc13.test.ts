// ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04
//
// Real-wiring RED for the production callback bound to
// `getCanonicalRestorePhase`. Drives the actual
// `selectCanonicalRestorePhase` helper at
// `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` and
// asserts the production SdkController binding routes through
// `createCanonicalRestorePhaseCallback` with both host-derived
// accessors AND that the coordinator passes the CAPTURED entry
// phase through to the callback.
//
// =============================================================================
// CORRECTION04: TEMPORAL IDENTITY RESOLVED
// =============================================================================
//
// CORRECTION02/03 confused `entryPhase` (the CAPTURED phase
// before compaction took ownership) with `currentLegacyPhase`
// (the LIVE tracker value at callback time). They are not the
// same: the coordinator writes "compacting" at entry
// (`sdk-compaction-coordinator.ts:412`) and the live tracker
// reads "compacting" for the entire compaction work. The
// CORRECTION02 `compacting -> compacting` branch therefore
// ALWAYS fired during the restore callback, blocking the
// canonical projection from ever winning.
//
// CORRECTION04 fixes this by:
//
//   1. Adding `entryPhase` as a SEPARATE input to the selector.
//   2. Passing it as the sole argument to the
//      `getCanonicalRestorePhase(entryPhase)` callback (the
//      coordinator hands over its captured value at restore
//      time).
//   3. Dropping the `compacting -> compacting` branch entirely.
//      `compacting` is a transition marker, not a restore
//      destination.
//   4. Splitting semantic roles:
//      - entryPhase          -> terminal-owner preservation
//      - canonicalShadowPhase -> bounded canonical repair
//      - currentLegacyPhase   -> host-owned `awaiting_followup`
//                                  override ONLY (legitimate
//                                  signal during compaction; the
//                                  session-event coordinator
//                                  wrote it during compaction)
//
// =============================================================================
// TABLE-DRIVEN CASES (the load-bearing invariants)
// =============================================================================
//
// The selector truth table is small (4 precedence branches x ~3
// inputs each = ~12 cells). The factory's contract is "delegates
// both accessors verbatim + receives entryPhase as argument" (1
// cell). The wiring's contract is "factory call with both
// accessors" (1 cell). The chronology test proves the live
// tracker reads "compacting" during the restore callback (1
// cell). The ablation is "OLD form would always return compacting
// during the callback" (1 cell). That is ~16 semantic cases
// total -- the matrix below encodes them as data.
//
// Reference contract -- the canonical-projection / entry-phase matrix.
//
//   entry \ canonical | undefined | idle | awaiting_followup | completed | resumable | error
//   ------------------|-----------|------|-------------------|-----------|-----------|-------
//   idle (terminal)   | idle      | idle | idle              | idle      | idle      | idle
//   completed (T)     | completed | comp | comp              | completed | completed | completed
//   resumable (T)     | resumable | resu | resu              | resumable | resumable | resumable
//   error (T)         | error     | err  | err               | error     | error     | error
//   awaiting_followup | preserve  | preserv| preserv          | preserve  | preserve  | preserve
//   streaming (NT)    | streaming | idle | awaiting_followup | completed | resumable | error
//   awaiting_approval | awaiting  | idle | awaiting_followup | completed | resumable | error
//
//   Above table applies when `currentLegacyPhase == "compacting"`
//   (the LIVE tracker during the restore callback by construction).
//
//   If `currentLegacyPhase == "awaiting_followup"` (host wrote
//   during compaction), `awaiting_followup` wins regardless of
//   entry or canonical (step 2 override).
//
//   If `currentLegacyPhase == idle | completed | resumable |
//   error` (live tracker happened to be terminal), entryPhase
//   still governs because terminal-owner preservation is keyed
//   on `entryPhase`, not `currentLegacyPhase`.
//
// =============================================================================

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
// Columns: [label, entryPhase, canonicalShadowPhase, currentLegacyPhase, expected]
//
// `currentLegacyPhase` is the LIVE tracker value at callback time.
// By the production chronology, this is "compacting" for the
// entire compaction window -- the coordinator writes it at entry
// (sdk-compaction-coordinator.ts:412) and only the restore closure
// moves it. Every cell in the first batch asserts the selector
// does NOT echo "compacting" back.

type Case = readonly [string, TurnPhase, TurnPhase | undefined, TurnPhase, TurnPhase | undefined]

const SELECTOR_CASES: readonly Case[] = [
	// ============================================================
	// (A) RESTORE CALLBACK CHRONOLOGY: currentLegacyPhase = "compacting"
	// ============================================================
	// The live tracker reads "compacting" during the callback by
	// construction. The selector MUST NOT echo it back. The
	// canonical projection (or entry preservation) must win.

	// Terminal owner entries ALWAYS preserve (step 1).
	["terminal idle + canonical undefined + live compacting -> idle", "idle", undefined, "compacting", "idle"],
	["terminal idle + canonical idle + live compacting -> idle", "idle", "idle", "compacting", "idle"],
	["terminal idle + canonical completed + live compacting -> idle", "idle", "completed", "compacting", "idle"],
	["terminal completed + canonical idle + live compacting -> completed", "completed", "idle", "compacting", "completed"],
	[
		"terminal resumable + canonical undefined + live compacting -> resumable",
		"resumable",
		undefined,
		"compacting",
		"resumable",
	],
	["terminal error + canonical idle + live compacting -> error", "error", "idle", "compacting", "error"],
	[
		"terminal awaiting_followup + canonical idle + live compacting -> awaiting_followup",
		"awaiting_followup",
		"idle",
		"compacting",
		"awaiting_followup",
	],

	// Non-terminal entries + canonical available -> canonical wins.
	// NOT "compacting". The bounded repair fires.
	["streaming entry + canonical idle + live compacting -> idle", "streaming", "idle", "compacting", "idle"],
	["streaming entry + canonical completed + live compacting -> completed", "streaming", "completed", "compacting", "completed"],
	["streaming entry + canonical resumable + live compacting -> resumable", "streaming", "resumable", "compacting", "resumable"],
	["streaming entry + canonical error + live compacting -> error", "streaming", "error", "compacting", "error"],
	["streaming entry + canonical streaming + live compacting -> streaming", "streaming", "streaming", "compacting", "streaming"],
	[
		"streaming entry + canonical awaiting_approval + live compacting -> awaiting_approval",
		"streaming",
		"awaiting_approval",
		"compacting",
		"awaiting_approval",
	],
	["awaiting_approval entry + canonical idle + live compacting -> idle", "awaiting_approval", "idle", "compacting", "idle"],
	[
		"awaiting_approval entry + canonical completed + live compacting -> completed",
		"awaiting_approval",
		"completed",
		"compacting",
		"completed",
	],

	// Non-terminal entries + canonical undefined -> undefined
	// (coordinator gate preserves entry; P1: unavailable != idle).
	[
		"streaming entry + canonical undefined + live compacting -> undefined (preserve)",
		"streaming",
		undefined,
		"compacting",
		undefined,
	],
	[
		"awaiting_approval entry + canonical undefined + live compacting -> undefined (preserve)",
		"awaiting_approval",
		undefined,
		"compacting",
		undefined,
	],

	// ============================================================
	// (B) HOST-OWNED AWAITING_FOLLOWUP OVERRIDE: currentLegacyPhase = "awaiting_followup"
	// ============================================================
	// A legitimate user interaction wrote awaiting_followup during
	// compaction (the session-event coordinator fired). The live
	// tracker reads "awaiting_followup" -- this is the ONLY host
	// signal the live tracker carries that supersedes entry. Step
	// 2 wins.
	["awaiting_followup override beats terminal idle entry", "idle", "idle", "awaiting_followup", "awaiting_followup"],
	[
		"awaiting_followup override beats streaming entry + canonical",
		"streaming",
		"completed",
		"awaiting_followup",
		"awaiting_followup",
	],
	[
		"awaiting_followup override beats non-terminal entry + canonical undefined",
		"streaming",
		undefined,
		"awaiting_followup",
		"awaiting_followup",
	],
	// When entry IS awaiting_followup, the override is redundant
	// but still returns awaiting_followup (step 1 also returns it).
	[
		"awaiting_followup override + awaiting_followup entry -> awaiting_followup",
		"awaiting_followup",
		"idle",
		"awaiting_followup",
		"awaiting_followup",
	],

	// ============================================================
	// (C) NON-COMPACTING / NON-OVERRIDE LIVE TRACKER (shouldn't happen
	//     during a real callback, but the selector MUST still be
	//     internally consistent).
	// ============================================================
	["streaming entry + canonical idle + live idle -> idle", "streaming", "idle", "idle", "idle"],
	["terminal completed + canonical undefined + live idle -> completed", "completed", undefined, "idle", "completed"],
	["terminal idle entry + canonical idle + live idle -> idle", "idle", "idle", "idle", "idle"],
] as const

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04 / selectCanonicalRestorePhase truth table", () => {
	for (const [label, entry, canonical, currentLegacy, expected] of SELECTOR_CASES) {
		it(label, () => {
			expect(
				selectCanonicalRestorePhase({
					entryPhase: entry,
					canonicalShadowPhase: canonical,
					currentLegacyPhase: currentLegacy,
				}),
			).toBe(expected)
		})
	}
})

// =============================================================================
// PART 2: FACTORY CONTRACT
// =============================================================================
//
// The factory returns a closure that takes `entryPhase` as its
// sole argument. The closure reads canonicalShadowPhase +
// currentLegacyPhase from the host-derived accessors on every
// call (not memoized). The closure MUST NOT memoize accessors
// (they reflect live state).

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04 / createCanonicalRestorePhaseCallback factory", () => {
	it("factory closure takes entryPhase as the sole argument and returns the canonical restore phase", () => {
		// entry streaming + canonical idle + live compacting (the
		// production chronology) -> canonical idle wins (step 3).
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "compacting",
		})
		expect(cb("streaming")).toBe("idle")
	})

	it("factory closure preserves entry for terminal-owner entries (terminal owns restoration)", () => {
		// terminal idle + canonical completed (would regress) + live
		// compacting -> entry idle preserves (step 1).
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "completed",
			getCurrentLegacyPhase: () => "compacting",
		})
		expect(cb("idle")).toBe("idle")
	})

	it("factory closure reads accessors on every call (no memoization)", () => {
		let canonicalCount = 0
		let legacyCount = 0
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => {
				canonicalCount++
				return "idle"
			},
			getCurrentLegacyPhase: () => {
				legacyCount++
				return "compacting"
			},
		})
		expect(cb("streaming")).toBe("idle")
		expect(cb("streaming")).toBe("idle")
		expect(canonicalCount).toBe(2)
		expect(legacyCount).toBe(2)
	})

	it("factory closure preserves P1 (canonical undefined + non-terminal entry -> undefined)", () => {
		// streaming entry + canonical undefined + live compacting ->
		// undefined (coordinator preserves entry).
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => undefined,
			getCurrentLegacyPhase: () => "compacting",
		})
		expect(cb("streaming")).toBeUndefined()
	})

	it("factory closure surfaces awaiting_followup host override during compaction", () => {
		// The session-event coordinator wrote awaiting_followup
		// during compaction; live tracker reads awaiting_followup;
		// entry streaming; canonical idle -> awaiting_followup wins.
		const cb = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "awaiting_followup",
		})
		expect(cb("streaming")).toBe("awaiting_followup")
	})
})

// =============================================================================
// PART 3: CHRONOLOGY PROOF
// =============================================================================
//
// This is the load-bearing test the reviewer demanded: prove that
// during the production restore callback the live tracker reads
// "compacting" (because the coordinator wrote it at entry). The
// CORRECTION02 `compacting -> compacting` branch therefore would
// always have fired during the callback, blocking the canonical
// projection from ever winning.
//
// The chronology is read statically from
// `sdk-compaction-coordinator.ts` (NOT from a behavioral test of
// the coordinator -- the reviewer's recommendation was to settle
// this from the source). Two invariants must hold:
//
//   1. `enterCompactingPhase()` writes `setTurnPhase("compacting", ...)`
//      at the top of the function (before returning the closure).
//   2. The restore closure reads `getCanonicalRestorePhase?.(entry.phase)`.
//      `entry.phase` is the CAPTURED phase from line `const entry = getTurnState()`
//      above -- NOT the live tracker.
//   3. The restore closure does NOT call `setTurnPhase(...)` BEFORE
//      invoking `getCanonicalRestorePhase`. (If it did, the live
//      tracker would already be the entry phase at callback time
//      and the `compacting -> compacting` branch would be a
//      no-op, but the chronology still works.)

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04 / chronology proof", () => {
	function loadEnterCompactingPhaseBody(): string {
		const path = join("..", "..", "apps", "vscode", "src", "sdk", "sdk-compaction-coordinator.ts")
		const source = readFileSync(path, "utf-8")
		return extractEnterCompactingPhase(source)
	}

	it("CHRONO-1: enterCompactingPhase writes setTurnPhase('compacting', ...) BEFORE returning the restore closure", () => {
		// Read the production source and assert the coordinator
		// writes `compacting` synchronously at entry (not lazily in
		// the restore closure).
		const body = loadEnterCompactingPhaseBody()
		// The body MUST contain a top-level call to
		// `setTurnPhase("compacting", entry.anchorTs, ...)`. The trailing
		// writerId argument is optional in the regex (ACT-CLINEMM-
		// LEGACY-TURNSTATE-WRITER-PROVENANCE01 added it as a tagging
		// convenience — it does not change the chronology contract).
		const setCompactingMatch = body.match(
			/setTurnPhase\(\s*["']compacting["']\s*,\s*entry\.anchorTs\s*(?:,\s*["'][^"']*["'])?\s*\)/,
		)
		expect(setCompactingMatch).toBeTruthy()
		if (!setCompactingMatch) return
		// AND the restore closure (the SECOND return in the body,
		// since the first return is the no-op for missing options)
		// must appear AFTER the setTurnPhase call.
		const setCompactingIndex = setCompactingMatch.index ?? 0
		// Find all `return ()` in the body and pick the LAST one
		// (the real closure return).
		const returnMatches = [...body.matchAll(/return\s+\(\s*\)\s*=>/g)]
		expect(returnMatches.length).toBeGreaterThanOrEqual(2)
		const lastReturnIndex = returnMatches[returnMatches.length - 1].index ?? 0
		expect(setCompactingIndex).toBeLessThan(lastReturnIndex)
	})

	it("CHRONO-2: the restore closure invokes getCanonicalRestorePhase with entry.phase as the argument (CAPTURED, not LIVE)", () => {
		// The coordinator MUST pass `entry.phase` (the captured
		// value) to the callback. If the coordinator passed
		// `this.options.getTurnState()?.phase` (re-sampling the live
		// tracker), the selector would see "compacting" and the
		// CORRECTION02 branch would re-fire.
		const body = loadEnterCompactingPhaseBody()
		// Find the restore closure call to getCanonicalRestorePhase.
		// The CORRECTION04 shape is `getCanonicalRestorePhase?.(entry.phase)`.
		const callbackInvocationPattern = /getCanonicalRestorePhase\?\.?\(\s*([\w.]+)\s*\)/
		const callbackInvocationMatch = body.match(callbackInvocationPattern)
		expect(callbackInvocationMatch).toBeTruthy()
		if (!callbackInvocationMatch) return
		// The argument MUST be `entry.phase` -- not a fresh
		// `getTurnState()` invocation, not any other expression.
		expect(callbackInvocationMatch[1]).toBe("entry.phase")
	})

	it("CHRONO-3: the canonical-result setTurnPhase write happens AFTER the callback invocation", () => {
		// The closure has the structure:
		//
		//   1. (terminal-owner branch): setTurnPhase(entry.phase) +
		//      return -- BEFORE callback, never invokes the callback.
		//   2. (non-terminal branch): const canonicalRestorePhase =
		//      getCanonicalRestorePhase?.(entry.phase)  // BEFORE any
		//      write -- callback fires first.
		//   3. (undefined branch): setTurnPhase(entry.phase) +
		//      return -- after callback fires, canonical was undefined.
		//   4. (success branch): setTurnPhase(canonicalRestorePhase)
		//      -- after callback fires, canonical was defined.
		//
		// The CORRECTION04 invariant is: the callback MUST fire
		// BEFORE step 3 or step 4. Otherwise the live tracker would
		// no longer read "compacting" at callback time and the
		// selector would observe a non-compacting tracker that
		// could itself trigger a different precedence branch.
		//
		// We assert: the FIRST setTurnPhase write AFTER the callback
		// invocation is the canonical-result write (either
		// canonicalRestorePhase or the undefined-fallback entry.phase).
		// Both are AFTER the callback, which is the invariant.
		const body = loadEnterCompactingPhaseBody()
		const returnMatches = [...body.matchAll(/return\s+\(\s*\)\s*=>\s*\{/g)]
		expect(returnMatches.length).toBeGreaterThanOrEqual(1)
		const lastReturnIndex = returnMatches[returnMatches.length - 1].index ?? 0
		const fromRestore = body.slice(lastReturnIndex)
		const fromRestoreStripped = fromRestore.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
		const callbackInvocationMatch = fromRestoreStripped.match(/getCanonicalRestorePhase\?\.?\(/)
		expect(callbackInvocationMatch).toBeTruthy()
		if (!callbackInvocationMatch) return
		const callbackInvocationIndex = callbackInvocationMatch.index ?? 0
		// Slice BEFORE the callback invocation -- this is the
		// terminal-owner branch. There SHOULD be a setTurnPhase
		// here (preserves entry), but it must NOT be reachable
		// from the non-terminal path (it returns early).
		const beforeCallback = fromRestoreStripped.slice(0, callbackInvocationIndex)
		expect(beforeCallback).toMatch(/setTurnPhase\(/)
		// Slice AFTER the callback invocation -- the canonical-result
		// write. There MUST be at least one setTurnPhase here.
		const afterCallback = fromRestoreStripped.slice(callbackInvocationIndex)
		expect(afterCallback).toMatch(/setTurnPhase\(/)
		// The write MUST target canonicalRestorePhase (success
		// branch) or entry.phase (undefined branch). The trailing
		// writerId argument (ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-
		// PROVENANCE01) is ignored by this regex.
		const writesAfterCallback = [
			...afterCallback.matchAll(/setTurnPhase\(([\w.]+),\s*entry\.anchorTs(?:\s*,\s*["'][^"']*["'])?\)/g),
		]
		expect(writesAfterCallback.length).toBeGreaterThanOrEqual(1)
		// The first write is the undefined-fallback (entry.phase);
		// the second is the canonical-result (canonicalRestorePhase).
		// Either is acceptable; both must write entry.anchorTs.
		for (const match of writesAfterCallback) {
			expect(match[1]).toMatch(/^(canonicalRestorePhase|entry\.phase)$/)
		}
	})
})

function extractEnterCompactingPhase(source: string): string {
	// Extract the body of `private enterCompactingPhase(): () => void { ... }`.
	// This is a coarse extraction: we look for the closing brace
	// of the method. The method body is bounded by the first `{`
	// after `enterCompactingPhase(): () => void` and the
	// matching `}` (assumed to be followed by a top-level
	// `private async` or `private` or end-of-class).
	const startMatch = source.match(/private\s+enterCompactingPhase\(\)\s*:\s*\(\s*\)\s*=>\s*void\s*\{/)
	if (!startMatch) {
		throw new Error("enterCompactingPhase declaration not found")
	}
	const startIndex = startMatch.index ?? 0
	let depth = 0
	let i = startIndex + startMatch[0].length - 1 // position of `{`
	for (; i < source.length; i++) {
		const ch = source[i]
		if (ch === "{") depth++
		else if (ch === "}") {
			depth--
			if (depth === 0) break
		}
	}
	return source.slice(startIndex, i + 1)
}

// =============================================================================
// PART 4: ABLATION
// =============================================================================
//
// Reverting to the CORRECTION02-era two-input selector
// (`{canonicalShadowPhase, currentLegacyPhase}` without
// `entryPhase` separation) collapses the chronology to "always
// compacting". The ablation exercises the production chronology
// (entry streaming + live compacting + canonical idle) and shows:
//   - OLD shape: the canonical projection is unreachable because
//     the `compacting -> compacting` branch always fires.
//   - NEW shape: canonical idle wins.

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04 / ablation (OLD vs NEW chronology)", () => {
	it("OLD shape (no entryPhase separation) collapses the production chronology to compacting", () => {
		// Simulated OLD selector: the CORRECTION02 implementation
		// that did NOT separate entryPhase. In production chronology
		// (entry streaming, canonical idle, live compacting), the
		// `compacting -> compacting` branch always fires.
		const oldSelector = (input: {
			canonicalShadowPhase: TurnPhase | undefined
			currentLegacyPhase: TurnPhase
		}): TurnPhase | undefined => {
			if (input.currentLegacyPhase === "compacting") return "compacting"
			if (input.currentLegacyPhase === "awaiting_followup") return "awaiting_followup"
			if (input.canonicalShadowPhase !== undefined) return input.canonicalShadowPhase
			return undefined
		}
		// Production chronology.
		expect(oldSelector({ canonicalShadowPhase: "idle", currentLegacyPhase: "compacting" })).toBe("compacting")
		// Canonical NEVER wins during the callback.
	})

	it("NEW shape (entryPhase separation) lets canonical projection win in production chronology", () => {
		// Production chronology + CORRECTION04 selector: canonical
		// idle wins over the live `compacting` tracker.
		expect(
			selectCanonicalRestorePhase({
				entryPhase: "streaming",
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "compacting",
			}),
		).toBe("idle")
	})
})

// =============================================================================
// PART 5: AST-LEVEL SdkController WIRING ASSERTION
// =============================================================================
//
// Production SdkController wiring MUST route through
// `createCanonicalRestorePhaseCallback` with BOTH
// `getCanonicalShadowPhase` AND `getCurrentLegacyPhase` accessors.
//
// Reference:
//   https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
//
// CORRECTION04 strengthens AST-3 to verify the accessor bodies
// reach the right host fields (per reviewer):
//
//   getCanonicalShadowPhase must reach
//     this.taskStateShadowWiring?.getLastObservedShadowPhase()
//
//   getCurrentLegacyPhase must reach
//     this.turnStateTracker.currentPhase
//
// We verify the accessor bodies structurally via the TypeScript
// Compiler API (no regex on body text). The structural check
// walks the AST of each arrow body and asserts the property
// access chain matches.

function findObjectLiteralPropertyInitializer(obj: ts.ObjectLiteralExpression, propName: string): ts.Expression | undefined {
	for (const prop of obj.properties) {
		if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === propName) {
			return prop.initializer
		}
	}
	return undefined
}

function readSdkControllerSource(): string {
	const path = join("..", "..", "apps", "vscode", "src", "sdk", "SdkController.ts")
	return readFileSync(path, "utf-8")
}

function parseSdkController(source: string): ts.SourceFile {
	return ts.createSourceFile("SdkController.ts", source, ts.ScriptTarget.Latest, true)
}

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

function isArrowReturningThisMemberAccess(expr: ts.Expression, rootName: string, memberName: string): boolean {
	// Match the AST shape produced by EITHER:
	//   () => this.ROOT.MEMBER       (plain property access)
	//   () => this.ROOT?.MEMBER      (optional chain)
	//   () => this.ROOT?.MEMBER()    (optional chain + call)
	//   () => this.ROOT.MEMBER()     (plain chain + call)
	//
	// All four resolve to a top-level
	//   PropertyAccessExpression (name=MEMBER)
	//     PropertyAccessExpression (name=ROOT)
	//       ThisKeyword
	//
	// except that `MEMBER()` wraps the outer PropertyAccess in a
	// CallExpression. We unwrap the optional CallExpression
	// wrapper and check the inner PropertyAccess.
	if (!ts.isArrowFunction(expr)) return false
	const body = expr.body
	const target = ts.isParenthesizedExpression(body) ? body.expression : body
	// Unwrap an optional CallExpression wrapper (e.g. for `MEMBER()`).
	const peeled = ts.isCallExpression(target) ? target.expression : target
	if (!ts.isPropertyAccessExpression(peeled)) return false
	if (peeled.name.text !== memberName) return false
	const inner = peeled.expression
	if (!ts.isPropertyAccessExpression(inner)) return false
	if (inner.name.text !== rootName) return false
	return inner.expression.kind === ts.SyntaxKind.ThisKeyword
}

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04 / AST-level SdkController wiring assertion", () => {
	const source = readSdkControllerSource()
	const sf = parseSdkController(source)

	it("AST-1: production SdkController declares a `getCanonicalRestorePhase` option on the SdkCompactionCoordinator constructor", () => {
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		expect(findObjectLiteralPropertyInitializer(arg, "getCanonicalRestorePhase")).toBeDefined()
	})

	it("AST-2: production SdkController initializes `getCanonicalRestorePhase` via `createCanonicalRestorePhaseCallback(...)` factory call", () => {
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findObjectLiteralPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init).toBeDefined()
		if (!init || !ts.isCallExpression(init)) {
			throw new Error("getCanonicalRestorePhase initializer is not a CallExpression")
		}
		const callee = init.expression
		if (!ts.isIdentifier(callee) || callee.text !== "createCanonicalRestorePhaseCallback") {
			throw new Error(`getCanonicalRestorePhase callee is not createCanonicalRestorePhaseCallback: ${callee.getText()}`)
		}
	})

	it("AST-3: factory call passes BOTH accessors AND accessor bodies reach the right host fields (STRENGTHENED)", () => {
		// Strengthened per reviewer: verify accessor bodies
		// structurally reach the right host fields, not just that
		// the property NAMES are present. A test that only checked
		// property names would pass even if both accessors pointed
		// at the same field.
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findObjectLiteralPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init && ts.isCallExpression(init)).toBe(true)
		if (!init || !ts.isCallExpression(init)) return
		const factoryArg = init.arguments?.[0]
		expect(factoryArg && ts.isObjectLiteralExpression(factoryArg)).toBe(true)
		if (!factoryArg || !ts.isObjectLiteralExpression(factoryArg)) return

		const canonicalInit = findObjectLiteralPropertyInitializer(factoryArg, "getCanonicalShadowPhase")
		const legacyInit = findObjectLiteralPropertyInitializer(factoryArg, "getCurrentLegacyPhase")
		expect(canonicalInit).toBeDefined()
		expect(legacyInit).toBeDefined()
		if (!canonicalInit || !legacyInit) return

		// AST-level structural check: the accessor bodies must reach
		// the right host fields.
		expect(isArrowReturningThisMemberAccess(canonicalInit, "taskStateShadowWiring", "getLastObservedShadowPhase")).toBe(true)
		expect(isArrowReturningThisMemberAccess(legacyInit, "turnStateTracker", "currentPhase")).toBe(true)
	})

	it("AST-4: the RHS is NOT an ArrowFunction (i.e. NOT the OLD non-host-aware bare-canonical-shadow form)", () => {
		const arg = findSdkCompactionCoordinatorArg(sf)
		expect(arg).toBeDefined()
		if (!arg) return
		const init = findObjectLiteralPropertyInitializer(arg, "getCanonicalRestorePhase")
		expect(init).toBeDefined()
		if (!init) return
		expect(ts.isArrowFunction(init)).toBe(false)
	})

	it("AST-5: selectCanonicalRestorePhase + createCanonicalRestorePhaseCallback are exported from task-state-shadow-arbiter-mapper.ts", () => {
		const path = join("..", "..", "apps", "vscode", "src", "sdk", "task-state-shadow-arbiter-mapper.ts")
		const mapperSource = readFileSync(path, "utf-8")
		const mapperSf = parseSdkController(mapperSource)
		const exported: string[] = []
		ts.forEachChild(mapperSf, (node) => {
			if (ts.isFunctionDeclaration(node) && node.name) {
				const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
				if (hasExport) {
					exported.push(node.name.text)
				}
			}
		})
		expect(exported).toContain("selectCanonicalRestorePhase")
		expect(exported).toContain("createCanonicalRestorePhaseCallback")
	})
})
