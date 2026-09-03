/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03
 *
 * Cross-instance two-reader / one-backing-store test for the temporary
 * external path authority list.
 *
 * The CORRECTION03 architecture replaces the CORRECTION02 chokidar
 * watcher with a one-shot fresh-read at the command-policy decision
 * boundary (`resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`).
 * This test exercises THAT production function directly with two
 * simulated Codium writers sharing one backing file:
 *
 *   1. Initialize instance A against a temp data dir.
 *   2. Have writer B (a separate process; simulated by writing
 *      globalState.json directly via the production atomic primitive)
 *      write a NEW lease Y to the same backing file.
 *   3. WITHOUT restart, WITHOUT manual cache reload, WITHOUT a watcher
 *      callback, WITHOUT cache mutation: A's next evaluation reads Y
 *      from disk and returns the canonical root.
 *
 * The "REMOVE" direction is the security-sensitive one — a stale
 * lease kept in instance A's view is worse than a missing one — so
 * the second case writes an EMPTY list and verifies A drops the
 * prior authority entirely (no entry survives, the temp root is
 * absent).
 *
 * No chokidar, no debounce, no event attribution, no chronology-
 * based self-write heuristic. If the production helper behaves the
 * way it claims, this test passes.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveActiveTemporaryExternalCanonicalRootsFromBackingFile } from "@shared/storage/temporaryExternalPathAuthorities"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { createStorageContext } from "@/shared/storage/storage-context"

// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03:
// StateManager.initialize() calls initializeDistinctId(), which
// needs the VS Code host to be set up. We don't need a real distinct
// id for the cross-instance test — mock it out.
vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
	getDistinctId: vi.fn(() => undefined),
	getDeviceId: vi.fn(() => undefined),
	setDistinctId: vi.fn(),
}))

let CLINE_DIR: string
let BACKING_FILE_PATH: string
let ORIGINAL_CLINE_DIR: string | undefined
let ORIGINAL_CLINE_DATA_DIR: string | undefined
let PROJECT_DIR: string
let TEMP_DIR: string
let CANONICAL_PROJECT_DIR: string
let CANONICAL_TEMP_DIR: string

beforeAll(() => {
	CLINE_DIR = mkdtempSync(join(tmpdir(), "cline-temp-ext-correction03-"))
	ORIGINAL_CLINE_DIR = process.env.CLINE_DIR
	ORIGINAL_CLINE_DATA_DIR = process.env.CLINE_DATA_DIR
	// Pin BOTH env vars so createStorageContext's resolveDataDirFromEnv
	// agrees with the test-side dataDir. This matches what production
	// does (CLINE_DATA_DIR > CLINE_DIR + "/data" > ~/.cline/data,
	// ENG-2332).
	process.env.CLINE_DATA_DIR = join(CLINE_DIR, "data")
	process.env.CLINE_DIR = CLINE_DIR
	BACKING_FILE_PATH = join(process.env.CLINE_DATA_DIR, "globalState.json")

	// Two real filesystem directories to use as authority roots.
	PROJECT_DIR = join(CLINE_DIR, "project")
	TEMP_DIR = join(CLINE_DIR, "external-temp")
	mkdirSync(PROJECT_DIR, { recursive: true })
	mkdirSync(TEMP_DIR, { recursive: true })
	CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
	CANONICAL_TEMP_DIR = realpathSync(TEMP_DIR)
})

afterAll(async () => {
	try {
		const sm = (() => {
			try {
				return StateManager.get()
			} catch {
				return null
			}
		})()
		if (sm) {
			await sm.flushPendingState()
		}
	} catch {
		// ignore
	}
	if (ORIGINAL_CLINE_DIR === undefined) {
		delete process.env.CLINE_DIR
	} else {
		process.env.CLINE_DIR = ORIGINAL_CLINE_DIR
	}
	if (ORIGINAL_CLINE_DATA_DIR === undefined) {
		delete process.env.CLINE_DATA_DIR
	} else {
		process.env.CLINE_DATA_DIR = ORIGINAL_CLINE_DATA_DIR
	}
	try {
		rmSync(CLINE_DIR, { recursive: true, force: true })
	} catch {
		// ignore
	}
})

/**
 * Write the backing file using the SAME atomic primitive the
 * production ClineFileStorage uses (tmp + renameSync). Mirrors what a
 * separate Codium process would do when its user toggles the temp
 * external paths setting.
 */
function writeBackingFileAtomic(next: Record<string, unknown>): void {
	mkdirSync(process.env.CLINE_DATA_DIR!, { recursive: true })
	const { renameSync } = require("node:fs") as typeof import("node:fs")
	const tmpPath = `${BACKING_FILE_PATH}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}.json`
	writeFileSync(tmpPath, JSON.stringify(next, null, 2), { encoding: "utf-8" })
	// Atomic rename (production primitive).
	renameSync(tmpPath, BACKING_FILE_PATH)
}

/**
 * Non-atomic write — used by tests that don't care about the atomic
 * primitive (they exercise filter / parse branches, not the rename
 * race). Production helper uses the atomic primitive; tests that
 * exercise cross-instance behavior use the atomic variant.
 */
function writeBackingFileUnchecked(filePath: string, next: Record<string, unknown>): void {
	writeFileSync(filePath, JSON.stringify(next, null, 2), { encoding: "utf-8" })
}

/**
 * Read the raw `clinemmTemporaryExternalPathAuthorities` value from
 * the backing file (without filtering or canonicalization), exactly
 * the way a UI consumer would surface it to the user.
 */
function readRawAuthorities(): unknown {
	const { readFileSync } = require("node:fs") as typeof import("node:fs")
	try {
		const raw = readFileSync(BACKING_FILE_PATH, "utf-8")
		if (raw.trim().length === 0) return undefined
		const parsed = JSON.parse(raw)
		return parsed?.clinemmTemporaryExternalPathAuthorities
	} catch {
		return undefined
	}
}

describe("ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03 — cross-instance fresh-read", () => {
	it("without restart, A sees B's NEW lease on A's next authority evaluation", async () => {
		// === Instance A: initialize with its own cached value. ===
		const ctx = createStorageContext({
			clineDir: CLINE_DIR,
			workspacePath: CLINE_DIR,
		})
		await StateManager.initialize(ctx)

		// Set A's initial value via the local cache; flush so the
		// backing file actually contains it.
		const initialLease = [
			{
				path: CANONICAL_PROJECT_DIR,
				expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			},
		]
		StateManager.get().setGlobalState("clinemmTemporaryExternalPathAuthorities", initialLease)
		await StateManager.get().flushPendingState()

		// Sanity: A's cache shows initial.
		expect(StateManager.get().getGlobalSettingsKey("clinemmTemporaryExternalPathAuthorities")).toEqual(initialLease)
		// Sanity: A's first evaluation returns CANONICAL_PROJECT_DIR.
		const beforeB = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: BACKING_FILE_PATH,
		})
		expect(beforeB).toEqual([CANONICAL_PROJECT_DIR])

		// === Instance B: write a DIFFERENT lease to the SAME backing file. ===
		const bLease = [
			{
				path: CANONICAL_TEMP_DIR,
				expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
			},
		]
		// Read the current backing file to preserve any other keys B
		// didn't intend to clobber. (Production ClineFileStorage.setBatch
		// does the same — only the targeted key is replaced.)
		const { readFileSync } = require("node:fs") as typeof import("node:fs")
		const currentRaw = readFileSync(BACKING_FILE_PATH, "utf-8")
		const current = JSON.parse(currentRaw)
		writeBackingFileAtomic({
			...current,
			clinemmTemporaryExternalPathAuthorities: bLease,
		})

		// Sanity: backing file now contains B's value.
		expect(readRawAuthorities()).toEqual(bLease)

		// === Instance A: WITHOUT restart, WITHOUT manual cache reload,
		//     WITHOUT watcher callback, WITHOUT cache mutation — the
		//     next authority evaluation must read from disk and see Y. ===
		// Crucially: A's local cache still holds the OLD value (initialLease).
		// The production fresh-read bypasses the cache entirely.
		expect(StateManager.get().getGlobalSettingsKey("clinemmTemporaryExternalPathAuthorities")).toEqual(initialLease)

		const afterB = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: BACKING_FILE_PATH,
		})
		expect(afterB).toEqual([CANONICAL_TEMP_DIR])
	})

	it("REMOVE direction: B writes an empty list; A drops authority entirely", async () => {
		// The "remove" direction is the security-sensitive one — stale
		// removal is the kind of thing a watcher / cache-coherence
		// system can silently fail at. Fresh-read makes it impossible
		// to miss because there is nothing to keep coherent.

		// B writes an EMPTY authority list to the backing file.
		writeBackingFileAtomic({
			clinemmTemporaryExternalPathAuthorities: [],
		})

		expect(readRawAuthorities()).toEqual([])

		// A's local cache STILL holds the OLD value — proving the
		// fresh-read is independent of the per-instance cache.
		// (We don't clear it; that's exactly the failure mode we are
		//  testing against.)
		expect(StateManager.get().getGlobalSettingsKey("clinemmTemporaryExternalPathAuthorities")).not.toEqual([])

		// A's next evaluation reads from disk and returns []
		// — no temp roots → policy falls back to ASK.
		const afterRemove = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: BACKING_FILE_PATH,
		})
		expect(afterRemove).toEqual([])
	})

	it("missing backing file → empty active set, no throw", () => {
		// Use a guaranteed-non-existent path so we exercise the
		// "ENOENT" branch without disturbing the shared backing file.
		const missingPath = join(CLINE_DIR, "does-not-exist", "globalState.json")
		expect(existsSync(missingPath)).toBe(false)

		const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: missingPath,
		})
		expect(result).toEqual([])
	})

	it("corrupt backing file (invalid JSON) → empty active set, no throw", () => {
		// Write garbage to a fresh sub-path and read it through the
		// production helper.
		const corruptDir = join(CLINE_DIR, "corrupt")
		mkdirSync(corruptDir, { recursive: true })
		const corruptPath = join(corruptDir, "globalState.json")
		writeFileSync(corruptPath, "{ not valid json", "utf-8")

		const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: corruptPath,
		})
		expect(result).toEqual([])
	})

	it("expired entries are dropped by the runtime filter inside the fresh-read", () => {
		// Self-contained: write a backing file with one active + one
		// expired entry, verify only the active one survives.
		const freshDir = join(CLINE_DIR, "fresh")
		mkdirSync(freshDir, { recursive: true })
		const freshPath = join(freshDir, "globalState.json")
		writeBackingFileUnchecked(freshPath, {
			clinemmTemporaryExternalPathAuthorities: [
				{
					path: CANONICAL_PROJECT_DIR,
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
				{
					path: "/var/log",
					expiresAt: new Date(Date.now() - 60_000).toISOString(),
				},
			],
		})

		const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: freshPath,
		})
		expect(result).toEqual([CANONICAL_PROJECT_DIR])
	})

	it("tampered >24h entry is dropped by the defense-in-depth ceiling inside the fresh-read", () => {
		const tamperDir = join(CLINE_DIR, "tamper")
		mkdirSync(tamperDir, { recursive: true })
		const tamperPath = join(tamperDir, "globalState.json")
		writeBackingFileUnchecked(tamperPath, {
			clinemmTemporaryExternalPathAuthorities: [
				{
					path: CANONICAL_TEMP_DIR,
					// 25h: tampered persisted state that bypassed the
					// write-time validator. The runtime filter MUST
					// still treat it as INACTIVE.
					expiresAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
				},
			],
		})

		const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: tamperPath,
		})
		expect(result).toEqual([])
	})

	it("realpath on a non-existent entry is dropped via the onRealpathFailure sink", () => {
		// Realpath-canonicalization closes the symlink-escape attack.
		// For a path that does not exist, realpath throws ENOENT — the
		// entry is dropped and `onRealpathFailure` is invoked so the
		// caller can log a warning.
		const brokenDir = join(CLINE_DIR, "broken")
		mkdirSync(brokenDir, { recursive: true })
		const brokenPath = join(brokenDir, "globalState.json")
		writeBackingFileUnchecked(brokenPath, {
			clinemmTemporaryExternalPathAuthorities: [
				{
					path: join(CLINE_DIR, "this-directory-does-not-exist"),
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			],
		})

		const onRealpathFailure = vi.fn()
		const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
			backingFilePath: brokenPath,
			onRealpathFailure,
		})
		expect(result).toEqual([])
		// onRealpathFailure was invoked at least once.
		expect(onRealpathFailure).toHaveBeenCalled()
	})

	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
	// CORRECTION03 closed the cross-instance visibility P0. CORRECTION04
	// closes the post-CORRECTION03 P0: tampered persisted state of `"/"`
	// (filesystem root) or relative forms (e.g. `"tmp"`, `"../tmp"`, `"."`)
	// previously slipped past `filterActiveTemporaryExternalPathEntries`,
	// surviving into realpath-canonicalization. `realpath("/")` → "/"
	// (trivially widening R0 authority to all canonical paths).
	// `realpath("../tmp")` → CWD-relative resolution (re-introducing the
	// CWD-dependent authority identity CORRECTION02 explicitly closed).
	//
	// These tests are the reviewer-mandated adversarial matrix. Each one
	// writes a fresh backing file containing a TAMPERED entry with a
	// VALID 1-hour expiry (so the only failure mode is the path-shape
	// filter). The production fresh-read pipeline MUST return `[]` for
	// the negative cases, and the canonical root for the positive cases.
	describe("CORRECTION04 tampered-paths adversarial matrix", () => {
		function writeTamperedBackingFile(subdir: string, tamperedEntry: { path: string; expiresAt: string }): string {
			const dir = join(CLINE_DIR, subdir)
			mkdirSync(dir, { recursive: true })
			const fp = join(dir, "globalState.json")
			writeBackingFileUnchecked(fp, {
				clinemmTemporaryExternalPathAuthorities: [tamperedEntry],
			})
			return fp
		}

		const oneHourFromNow = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

		it('tampered path="/" (filesystem root) + valid 1h expiry → []', () => {
			// The strongest reviewer example: a tampered persisted
			// "/" with valid expiry that would otherwise survive the
			// runtime filter and realpath-canonicalize to "/", making
			// `workspaceRoots ∪ ["/"]` contain every canonical path.
			const fp = writeTamperedBackingFile("tamper-root", {
				path: "/",
				expiresAt: oneHourFromNow(),
			})
			const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: fp,
			})
			expect(result).toEqual([])
		})

		it('tampered path="tmp" (bare relative) + valid 1h expiry → []', () => {
			// Bare relative form. realpath would resolve against the
			// extension-host process CWD, reintroducing the
			// CWD-dependent authority identity CORRECTION02 closed.
			const fp = writeTamperedBackingFile("tamper-relative-bare", {
				path: "tmp",
				expiresAt: oneHourFromNow(),
			})
			const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: fp,
			})
			expect(result).toEqual([])
		})

		it('tampered path="../tmp" (relative traversal) + valid 1h expiry → []', () => {
			// `..` traversal. realpath would resolve against the
			// extension-host process CWD's parent — silently
			// arbitrary.
			const fp = writeTamperedBackingFile("tamper-relative-traversal", {
				path: "../tmp",
				expiresAt: oneHourFromNow(),
			})
			const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: fp,
			})
			expect(result).toEqual([])
		})

		it('tampered path="." (cwd-anchor) + valid 1h expiry → []', () => {
			// `.` is the CWD itself — resolves to whatever the host
			// happened to be running in. Same CWD-dependent identity
			// concern as the other relative forms.
			const fp = writeTamperedBackingFile("tamper-relative-dot", {
				path: ".",
				expiresAt: oneHourFromNow(),
			})
			const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: fp,
			})
			expect(result).toEqual([])
		})

		it('legitimate path="/private/tmp" + valid expiry → canonical active root', () => {
			// The positive witness for `/private/tmp`. realpath on
			// `/private/tmp` is itself on macOS (no further
			// canonicalization needed). The runtime filter MUST
			// forward it.
			const fp = writeTamperedBackingFile("legit-private-tmp", {
				path: "/private/tmp",
				expiresAt: oneHourFromNow(),
			})
			const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: fp,
			})
			expect(result).toEqual(["/private/tmp"])
		})

		it('legitimate path="/tmp" + valid expiry → non-empty canonical, not "/"', () => {
			// `/tmp` is canonicalized via realpath. The runtime
			// filter MUST forward it; the realpath step performs
			// the platform-native mapping (on macOS, `/tmp` →
			// `/private/tmp`; on Linux `/tmp` → `/tmp`). The
			// contract we assert here: a non-empty, non-"/"
			// canonical path is produced (i.e. it survived and was
			// properly canonicalized, NOT dropped to "/").
			const fp = writeTamperedBackingFile("legit-tmp", {
				path: "/tmp",
				expiresAt: oneHourFromNow(),
			})
			const result = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: fp,
			})
			expect(result.length).toBeGreaterThan(0)
			expect(result[0]!.length).toBeGreaterThan(1)
			expect(result[0]).not.toBe("/")
		})
	})
})
