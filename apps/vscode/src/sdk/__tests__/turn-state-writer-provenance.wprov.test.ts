/**
 * ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01
 *
 * Test contract for the writer-provenance diagnostic. The capture is
 * purely additive — production semantics are unchanged when the
 * diagnostic is default-off. The tests pin:
 *
 *   WPROV01: diagnostic OFF => zero records, zero semantic effect on
 *            `TurnStateTracker.set()`.
 *   WPROV02: streaming mutation records exact writer + previous/new
 *            seq + writerId identity when enabled.
 *   WPROV03: compacting entry and the three restore paths carry
 *            distinct writer identities.
 *   WPROV04: a subsequent terminal/user-owned writer is independently
 *            visible in the same ring (no over-write, no coalescing).
 *   WPROV05: ring is bounded (default 256 records; older entries are
 *            FIFO-evicted; sized-down ring evicts the oldest).
 *   WPROV06: ordinary `set()` behavior remains byte/semantic-equivalent
 *            to `setWithWriter(phase, anchorTs, { writerId:
 *            "unknown-legacy-writer" })` when the diagnostic is
 *            disabled. When enabled, the legacy `set()` records the
 *            writer as `unknown-legacy-writer` (the explicit sentinel).
 *
 * ACT-CLINEMM-TURNSTATE-WRITER-PROVENANCE-COMMAND-SURFACE01 adds:
 *   CMD01..05: command-surface wiring — manifest contribution,
 *            registry constants, runtime registration, toggle calls
 *            the existing enable/disable seam, dump calls the
 *            existing get/export seam, default-off posture preserved.
 *
 * This is a diagnostic test, NOT a product RED. The directive forbids
 * synthesizing these as production REDs.
 */

import { existsSync, mkdtempSync, readFileSync, readFileSync as readFileSyncFs, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	findTurnStateWriterProvenanceByPhase,
	findTurnStateWriterProvenanceByWriter,
	getTurnStateWriterProvenanceRecords,
	getTurnStateWriterProvenanceSeq,
	isTurnStateWriterProvenanceDiagnosticEnabled,
	setTurnStateWriterProvenanceBufferSize,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { TurnStateTracker } from "../turn-state-tracker"
import {
	dumpExtensionSideTurnStateWriterProvenanceDiagnostic,
	isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled,
	type TurnStateWriterProvenanceDiagnosticContext,
	toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled,
} from "../turn-state-writer-provenance-runtime"

afterEach(() => {
	disableTurnStateWriterProvenanceDiagnostic()
	clearTurnStateWriterProvenanceDiagnostic()
	setTurnStateWriterProvenanceBufferSize(256)
})

describe("WPROV01: diagnostic OFF => zero records, zero semantic effect", () => {
	beforeEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV01.1: set() does NOT append when the diagnostic is disabled", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		tracker.set("idle")
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("WPROV01.2: setWithWriter() also does NOT append when the diagnostic is disabled", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
	})

	it("WPROV01.3: disabling after writes preserves the prior records", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		enableTurnStateWriterProvenanceDiagnostic()
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
		disableTurnStateWriterProvenanceDiagnostic()
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
	})
})

describe("WPROV02: streaming mutation records exact writer + previous/new seq + writerId", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV02.1: setWithWriter captures committed phase + seq + writerId", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const idleSeq = tracker.get().seq
		tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
			taskId: "task-1",
			epoch: minter.epoch,
		})
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(1)
		const r = records[0]!
		expect(r.writerId).toBe("task-start-init-task")
		expect(r.taskId).toBe("task-1")
		expect(r.epoch).toBe(minter.epoch)
		expect(r.previous.phase).toBe("idle")
		expect(r.previous.seq).toBe(idleSeq)
		expect(r.requested.phase).toBe("streaming")
		expect(r.committed.phase).toBe("streaming")
		expect(r.committed.seq).toBeGreaterThan(idleSeq)
	})

	it("WPROV02.2: anchorTs is captured and round-tripped", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("awaiting_approval", 4242, { writerId: "interaction-handle-tool-approval" })
		const r = getTurnStateWriterProvenanceRecords()[0]!
		expect(r.requested.anchorTs).toBe(4242)
		expect(r.committed.anchorTs).toBe(4242)
		expect(r.previous.anchorTs).toBeUndefined()
	})

	it("WPROV02.3: set() legacy alias records writerId=unknown-legacy-writer when enabled", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		const r = getTurnStateWriterProvenanceRecords()[0]!
		expect(r.writerId).toBe("unknown-legacy-writer")
		expect(r.committed.phase).toBe("streaming")
	})

	it("WPROV02.4: findTurnStateWriterProvenanceByWriter returns the matching subset", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		tracker.setWithWriter("error", undefined, { writerId: "controller-on-send-error" })
		const taskStart = findTurnStateWriterProvenanceByWriter("task-start-init-task")
		expect(taskStart.length).toBe(1)
		expect(taskStart[0]!.committed.phase).toBe("streaming")
		const clear = findTurnStateWriterProvenanceByWriter("controller-clear-task")
		expect(clear.length).toBe(1)
		expect(clear[0]!.committed.phase).toBe("idle")
	})

	it("WPROV02.5: findTurnStateWriterProvenanceByPhase returns the matching subset", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("streaming", undefined, { writerId: "controller-ask-response" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		const streaming = findTurnStateWriterProvenanceByPhase((p) => p === "streaming")
		expect(streaming.length).toBe(2)
		const writers = new Set(streaming.map((r) => r.writerId))
		expect(writers.has("task-start-init-task")).toBe(true)
		expect(writers.has("controller-ask-response")).toBe(true)
	})
})

describe("WPROV03: compacting entry and the three restore paths carry distinct writer identities", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV03.1: compaction-enter writes compacting; restore writes the resolved phase", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("compacting", 42, { writerId: "compaction-enter" })
		tracker.setWithWriter("idle", 42, { writerId: "compaction-restore-canonical-resolved" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(3)
		expect(records[0]!.writerId).toBe("task-start-init-task")
		expect(records[1]!.writerId).toBe("compaction-enter")
		expect(records[1]!.committed.phase).toBe("compacting")
		expect(records[1]!.committed.anchorTs).toBe(42)
		expect(records[2]!.writerId).toBe("compaction-restore-canonical-resolved")
		expect(records[2]!.committed.phase).toBe("idle")
	})

	it("WPROV03.2: compaction-restore-entry-preserve keeps the entry phase", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
		tracker.setWithWriter("compacting", 7, { writerId: "compaction-enter" })
		tracker.setWithWriter("resumable", 7, { writerId: "compaction-restore-entry-preserve" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.map((r) => r.writerId)).toEqual([
			"controller-cancel-task",
			"compaction-enter",
			"compaction-restore-entry-preserve",
		])
	})

	it("WPROV03.3: compaction-restore-canonical-unavailable-preserve is distinct from the resolved branch", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("awaiting_approval", 9, { writerId: "interaction-handle-tool-approval" })
		tracker.setWithWriter("compacting", 9, { writerId: "compaction-enter" })
		tracker.setWithWriter("awaiting_approval", 9, {
			writerId: "compaction-restore-canonical-unavailable-preserve",
		})
		const records = getTurnStateWriterProvenanceRecords()
		expect(records[2]!.writerId).toBe("compaction-restore-canonical-unavailable-preserve")
		const restoreWriters = new Set(records.filter((r) => r.writerId.startsWith("compaction-restore")).map((r) => r.writerId))
		expect(restoreWriters.size).toBe(1)
		expect(restoreWriters.has("compaction-restore-canonical-unavailable-preserve")).toBe(true)
	})
})

describe("WPROV04: terminal/user-owned writer is independently visible", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV04.1: streaming to idle path records both writes distinctly", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "controller-ask-response" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(2)
		expect(records[0]!.committed.phase).toBe("streaming")
		expect(records[0]!.committed.seq).toBeLessThan(records[1]!.committed.seq)
		expect(records[1]!.committed.phase).toBe("idle")
		expect(records[1]!.previous.phase).toBe("streaming")
	})

	it("WPROV04.2: subsequent user-owned write survives even if a later stale streaming write happens", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		tracker.setWithWriter("streaming", undefined, { writerId: "unknown-legacy-writer" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.map((r) => r.writerId)).toEqual(["controller-clear-task", "unknown-legacy-writer"])
		expect(records[1]!.previous.phase).toBe("idle")
		expect(records[1]!.committed.phase).toBe("streaming")
	})
})

describe("WPROV05: ring is bounded (default 256; FIFO evict)", () => {
	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		enableTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV05.1: 256 records fit; the 257th evicts the oldest", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		for (let i = 0; i < 256; i++) {
			tracker.setWithWriter("streaming", i, { writerId: "task-start-init-task" })
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(256)
		tracker.setWithWriter("streaming", 256, { writerId: "task-start-init-task" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(256)
		expect(records[0]!.requested.anchorTs).toBe(1)
		expect(records[records.length - 1]!.requested.anchorTs).toBe(256)
	})

	it("WPROV05.2: shrinking the buffer evicts the oldest", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		for (let i = 0; i < 10; i++) {
			tracker.setWithWriter("streaming", i, { writerId: "task-start-init-task" })
		}
		expect(getTurnStateWriterProvenanceRecords().length).toBe(10)
		setTurnStateWriterProvenanceBufferSize(3)
		tracker.setWithWriter("idle", 99, { writerId: "controller-clear-task" })
		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(3)
		expect(records[records.length - 1]!.requested.anchorTs).toBe(99)
	})

	it("WPROV05.3: setting buffer size to 0 disables the ring entirely", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		setTurnStateWriterProvenanceBufferSize(0)
		tracker.setWithWriter("streaming", 1, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(0)
	})
})

describe("WPROV06: set() byte/semantic-equivalent to setWithWriter(..., unknown-legacy-writer)", () => {
	beforeEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("WPROV06.1: phase/anchorTs/seq are identical between set() and setWithWriter()", () => {
		const minterA = new MessageIdMinter()
		const minterB = new MessageIdMinter()
		const tA = new TurnStateTracker(minterA)
		const tB = new TurnStateTracker(minterB)
		tA.set("streaming", 100)
		tB.setWithWriter("streaming", 100, { writerId: "unknown-legacy-writer" })
		expect(tA.get()).toEqual(tB.get())
	})

	it("WPROV06.2: listener fan-out is identical between set() and setWithWriter()", () => {
		const minterA = new MessageIdMinter()
		const minterB = new MessageIdMinter()
		const tA = new TurnStateTracker(minterA)
		const tB = new TurnStateTracker(minterB)
		const aPhases: string[] = []
		const bPhases: string[] = []
		tA.subscribe((p) => aPhases.push(p))
		tB.subscribe((p) => bPhases.push(p))
		tA.set("streaming")
		tA.set("idle")
		tB.setWithWriter("streaming", undefined, { writerId: "unknown-legacy-writer" })
		tB.setWithWriter("idle", undefined, { writerId: "unknown-legacy-writer" })
		expect(aPhases).toEqual(bPhases)
	})

	it("WPROV06.3: set() is a no-op on the ring buffer when disabled (WPROV01 contract)", () => {
		disableTurnStateWriterProvenanceDiagnostic()
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		tracker.set("idle")
		expect(getTurnStateWriterProvenanceRecords().length).toBe(0)
	})
})

describe("WPROV07: mechanical inventory — every production writerId is mapped; no dead union IDs", () => {
	// ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01 §3 (Recon)
	// requires an exhaustive writer table. WPROV07 mechanically
	// reconciles the union against the production source so the
	// cardinality contradiction cannot recur.
	//
	// Convention: the writerId is ALWAYS the LAST string literal in
	// every setTurnPhase(phase, anchor?, writerId?) call. Phase
	// values like "streaming" / "awaiting_approval" are constant
	// strings in @shared/ExtensionMessage, NOT in the union.
	// We assert:
	//   1. Every last-position string literal that is kebab-case
	//      appears in the union.
	//   2. Every union member (except the unknown-legacy-writer
	//      sentinel) appears at least once in the last position.
	//   3. The exact cardinality is logged for the CI artifact.

	it("WPROV07.1: writerId union fully reconciles with production call sites", async () => {
		const { readFile } = await import("node:fs/promises")

		const diagSrc = await readFile("src/shared/turn-state-writer-provenance.ts", "utf8")
		const unionIds = new Set<string>()
		const unionRe = /\|\s*"([a-z][^"]+)"/g
		let m: RegExpExecArray | null
		while ((m = unionRe.exec(diagSrc)) !== null) {
			unionIds.add(m[1])
		}

		const sdkFiles = [
			"src/sdk/SdkController.ts",
			"src/sdk/sdk-interaction-coordinator.ts",
			"src/sdk/sdk-session-event-coordinator.ts",
			"src/sdk/sdk-task-start-coordinator.ts",
			"src/sdk/sdk-task-control-coordinator.ts",
			"src/sdk/sdk-mode-coordinator.ts",
			"src/sdk/sdk-compaction-coordinator.ts",
		]
		const usedIds = new Set<string>()
		let callSites = 0
		for (const file of sdkFiles) {
			const src = await readFile(file, "utf8")
			// Match the START of any setTurnPhase( call. Handles three forms:
			//   setTurnPhase?.(          (bare, closure-internal)
			//   this.options.setTurnPhase?.(  (coordinator internal)
			//   setTurnPhase(           (closure-local variable)
			// The walker then balances parens to the matching close.
			const startRe = /(?:this\.)?options?\.?setTurnPhase\??\s*(?:\.\s*)?\(|(?<![".\w])setTurnPhase\(/g
			let sm: RegExpExecArray | null
			while ((sm = startRe.exec(src)) !== null) {
				const startIdx = sm.index
				let depth = 1
				let j = startIdx + sm[0].length
				const args: string[] = []
				let lastWriterIdArgIdx = -1
				while (j < src.length && depth > 0) {
					const c = src[j]
					if (c === '"' || c === "'" || c === "`") {
						const end = findStringEnd(src, j, c)
						const lit = src.slice(j + 1, end)
						args.push(lit)
						lastWriterIdArgIdx = args.length - 1
						j = end + 1
						continue
					}
					if (c === "(") depth++
					if (c === ")") {
						depth--
						if (depth === 0) break
					}
					j++
				}
				// Convention: the writerId is the LAST string literal in the args.
				if (lastWriterIdArgIdx >= 0) {
					const last = args[lastWriterIdArgIdx]
					if (/^[a-z][a-z0-9-]+$/.test(last)) {
						usedIds.add(last)
						callSites++
					}
				}
				startRe.lastIndex = j + 1
			}
		}
		const controllerSrc = await readFile("src/sdk/SdkController.ts", "utf8")
		// Walk every setWithWriter( call in SdkController and read its
		// writerIdentity("...") literal — exact-args matching, paren-balanced.
		const cRe = /setWithWriter\s*\(/g
		let cm: RegExpExecArray | null
		while ((cm = cRe.exec(controllerSrc)) !== null) {
			let depth = 1
			let j = cm.index + cm[0].length
			const args: string[] = []
			while (j < controllerSrc.length && depth > 0) {
				const c = controllerSrc[j]
				if (c === '"' || c === "'" || c === "`") {
					const end = findStringEnd(controllerSrc, j, c)
					args.push(controllerSrc.slice(j + 1, end))
					j = end + 1
					continue
				}
				if (c === "(") depth++
				if (c === ")") {
					depth--
					if (depth === 0) break
				}
				j++
			}
			const last = args[args.length - 1]
			if (last !== undefined && /^[a-z][a-z0-9-]+$/.test(last)) {
				usedIds.add(last)
				callSites++
			}
			cRe.lastIndex = j + 1
		}

		const SENTINEL = "unknown-legacy-writer"
		const usedNonSentinel = new Set([...usedIds].filter((id) => id !== SENTINEL))
		const unionNonSentinel = new Set([...unionIds].filter((id) => id !== SENTINEL))
		const missingFromUnion = [...usedNonSentinel].filter((id) => !unionNonSentinel.has(id)).sort()
		const deadUnionIds = [...unionNonSentinel].filter((id) => !usedNonSentinel.has(id)).sort()
		// eslint-disable-next-line no-console
		console.log(
			`WPROV07 inventory: production writerIds=${usedIds.size} ` +
				`(non-sentinel=${usedNonSentinel.size}); union writerIds=${unionIds.size} ` +
				`(non-sentinel=${unionNonSentinel.size}); call sites=${callSites}`,
		)
		expect(missingFromUnion).toEqual([])
		expect(deadUnionIds).toEqual([])
	})

	it("WPROV07.2: every writerId is kebab-case ASCII and <= 80 chars", async () => {
		const { readFile } = await import("node:fs/promises")
		const diagSrc = await readFile("src/shared/turn-state-writer-provenance.ts", "utf8")
		const unionRe = /\|\s*"([a-z][^"]+)"/g
		let m: RegExpExecArray | null
		const ids: string[] = []
		while ((m = unionRe.exec(diagSrc)) !== null) ids.push(m[1])
		for (const id of ids) {
			expect(id).toMatch(/^[a-z][a-z0-9-]+$/)
			expect(id.length).toBeLessThanOrEqual(80)
		}
		expect(ids).toContain("unknown-legacy-writer")
	})
})

// =============================================================================
// ACT-CLINEMM-TURNSTATE-WRITER-PROVENANCE-COMMAND-SURFACE01
//
// Command-surface contract tests. The diagnostic's backend ring and
// enable/disable/dump seams already exist (WPROV01..07); what was
// missing was the VS Code command surface that lets an operator
// reach those seams from the Command Palette. These tests pin:
//   CMD01: package.json contributes both command IDs.
//   CMD02: runtime registers both command IDs (extension.ts).
//   CMD03: toggle calls the existing provenance enable/disable seam.
//   CMD04: dump calls the existing provenance get/export seam.
//   CMD05: command registration does not enable the diagnostic by default.
//
// CMD03 + CMD04 are runtime exercises against the same fake-context
// pattern used by post-terminal-authority-diagnostic-runtime.test.ts.
// CMD01 + CMD02 + CMD05 are source-only witnesses (parse the
// registered files and assert presence/absence of the contract).
// =============================================================================

const COMMAND_REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const COMMAND_PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const COMMAND_EXTENSION_PATH = resolve(__dirname, "../../extension.ts")

function readCommandSource(path: string): string {
	return readFileSyncFs(path, "utf8")
}

function fakeTswpdContext(storagePath: string): TurnStateWriterProvenanceDiagnosticContext {
	const store = new Map<string, unknown>()
	return {
		workspaceState: {
			get: ((key: string) => store.get(key)) as TurnStateWriterProvenanceDiagnosticContext["workspaceState"]["get"],
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					store.delete(key)
				} else {
					store.set(key, value)
				}
			},
		},
		globalStorageUri: { fsPath: storagePath },
		subscriptions: [],
	}
}

describe("CMD01: package.json contributes both command IDs", () => {
	it("CMD01.1: toggle command is declared in package.json with palette-searchable title", () => {
		const pkg = readCommandSource(COMMAND_PACKAGE_JSON_PATH)
		expect(pkg).toContain("cline.debug.toggleTurnStateWriterProvenanceDiagnostic")
		expect(pkg).toMatch(
			/"command":\s*"cline\.debug\.toggleTurnStateWriterProvenanceDiagnostic"[\s\S]*?"title":\s*"[^"]*[Tt]urn [Ss]tate [Ww]riter [Pp]rovenance[^"]*"/,
		)
	})

	it("CMD01.2: dump command is declared in package.json with palette-searchable title", () => {
		const pkg = readCommandSource(COMMAND_PACKAGE_JSON_PATH)
		expect(pkg).toContain("cline.debug.dumpTurnStateWriterProvenanceDiagnostic")
		expect(pkg).toMatch(
			/"command":\s*"cline\.debug\.dumpTurnStateWriterProvenanceDiagnostic"[\s\S]*?"title":\s*"[^"]*[Dd]ump [Tt]urn [Ss]tate [Ww]riter [Pp]rovenance[^"]*"/,
		)
	})
})

describe("CMD02: registry exposes both command constants and extension.ts registers them", () => {
	it("CMD02.1: registry declares both constants with the correct id-suffix", () => {
		const registry = readCommandSource(COMMAND_REGISTRY_PATH)
		expect(registry).toContain("ToggleTurnStateWriterProvenanceDiagnostic")
		expect(registry).toContain("DumpTurnStateWriterProvenanceDiagnostic")
		expect(registry).toMatch(/prefix\s*\+\s*"\.debug\.toggleTurnStateWriterProvenanceDiagnostic"/)
		expect(registry).toMatch(/prefix\s*\+\s*"\.debug\.dumpTurnStateWriterProvenanceDiagnostic"/)
	})

	it("CMD02.2: extension.ts registers both commands via vscode.commands.registerCommand", () => {
		const ext = readCommandSource(COMMAND_EXTENSION_PATH)
		expect(ext).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.ToggleTurnStateWriterProvenanceDiagnostic/s)
		expect(ext).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.DumpTurnStateWriterProvenanceDiagnostic/s)
	})
})

describe("CMD03: toggle calls the existing provenance enable/disable seam", () => {
	let tmp: string
	let context: ReturnType<typeof fakeTswpdContext>

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "tswpd-cmd-toggle-"))
		context = fakeTswpdContext(tmp)
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	afterEach(() => {
		if (existsSync(tmp)) {
			rmSync(tmp, { recursive: true, force: true })
		}
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("CMD03.1: workspace state default is OFF (undefined → false)", () => {
		expect(isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)).toBe(false)
	})

	it("CMD03.2: toggle flips the workspace flag AND the in-process enabled flag", async () => {
		const next1 = await toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)
		expect(next1).toBe(true)
		expect(isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)).toBe(true)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)

		const next2 = await toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)
		expect(next2).toBe(false)
		expect(isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)).toBe(false)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("CMD03.3: post-toggle ring captures exactly the expected writer site", async () => {
		await toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
		expect(getTurnStateWriterProvenanceRecords()[0]!.writerId).toBe("task-start-init-task")
	})
})

describe("CMD04: dump calls the existing provenance get/export seam", () => {
	let tmp: string
	let context: ReturnType<typeof fakeTswpdContext>

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "tswpd-cmd-dump-"))
		context = fakeTswpdContext(tmp)
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	afterEach(() => {
		if (existsSync(tmp)) {
			rmSync(tmp, { recursive: true, force: true })
		}
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("CMD04.1: dump produces an empty JSONL file when no records were captured", async () => {
		const filePath = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(context)
		expect(existsSync(filePath)).toBe(true)
		expect(filePath).toContain("turn-state-writer-provenance.jsonl")
		expect(readFileSync(filePath, "utf8")).toBe("")
	})

	it("CMD04.2: dump serializes every captured record with writerId/seq identity", async () => {
		enableTurnStateWriterProvenanceDiagnostic()
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		const filePath = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(context)
		expect(existsSync(filePath)).toBe(true)
		const lines = readFileSync(filePath, "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
		expect(lines.length).toBe(2)
		const records = lines.map((l) => JSON.parse(l))
		expect(records[0].writerId).toBe("task-start-init-task")
		expect(records[0].committed.phase).toBe("streaming")
		expect(records[1].writerId).toBe("controller-clear-task")
		expect(records[1].committed.phase).toBe("idle")
	})

	it("CMD04.3: dump creates the globalStorage directory on a fresh install", async () => {
		const freshDir = join(tmp, "fresh-install", "does-not-exist")
		const freshContext = fakeTswpdContext(freshDir)
		expect(existsSync(freshDir)).toBe(false)
		enableTurnStateWriterProvenanceDiagnostic()
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const filePath = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(freshContext)
		expect(existsSync(freshDir)).toBe(true)
		expect(existsSync(filePath)).toBe(true)
	})

	it("CMD04.4: dump reads through the existing shared getRecords() seam (no private state)", async () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		enableTurnStateWriterProvenanceDiagnostic()
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		disableTurnStateWriterProvenanceDiagnostic()
		const recordsBefore = getTurnStateWriterProvenanceRecords().length
		expect(recordsBefore).toBe(1)
		const filePath = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(context)
		const lines = readFileSync(filePath, "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
		expect(lines.length).toBe(1)
	})
})

describe("CMD05: command registration does not enable the diagnostic by default", () => {
	let tmp: string
	let context: ReturnType<typeof fakeTswpdContext>

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "tswpd-cmd-default-"))
		context = fakeTswpdContext(tmp)
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	afterEach(() => {
		if (existsSync(tmp)) {
			rmSync(tmp, { recursive: true, force: true })
		}
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("CMD05.1: a fresh workspace reports the diagnostic OFF (workspace-state undefined)", () => {
		expect(isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)).toBe(false)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("CMD05.2: turnstate mutations before any toggle produce zero records (production path)", () => {
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
	})

	it("CMD05.3: source-only — runtime does NOT auto-enable on import", () => {
		// A fresh import context must NOT call enable...() at module top-level.
		// Re-parse the runtime source and strip the toggle function body so
		// the in-function enable call (which IS correct) does not match.
		const runtimePath = resolve(__dirname, "../turn-state-writer-provenance-runtime.ts")
		const src = readCommandSource(runtimePath)
		const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "")
		const stripped = noComments.replace(
			/export async function\s+toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled[\s\S]*?\n\}\n/,
			"",
		)
		expect(stripped).not.toMatch(/enableTurnStateWriterProvenanceDiagnostic\s*\(/)
	})
})

function findStringEnd(src: string, startQuoteAt: number, quote: string): number {
	let end = startQuoteAt + 1
	while (end < src.length) {
		if (src[end] === "\\" && end + 1 < src.length) {
			end += 2
			continue
		}
		if (src[end] === quote) return end
		end++
	}
	return end
}
