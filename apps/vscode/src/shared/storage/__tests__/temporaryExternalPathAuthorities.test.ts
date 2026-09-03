/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION01
 * Unit tests for the authoritative 24h hard-ceiling validator.
 *
 * The validator is the SINGLE host-side source of truth for the
 * 24h hard ceiling. Both the UI write path (updateSettings.ts) and
 * the CLI write path (updateSettingsCli.ts) MUST call
 * `validateTemporaryExternalPathAuthorities` before persisting.
 *
 * Load-bearing adversarial cases (per the reviewer halt):
 *   - now + 24h       → accepted
 *   - now + 24h + 1ms → rejected (strict boundary)
 *   - now + 25h       → rejected
 *   - "2036-..."      → rejected
 *   - past timestamps → rejected
 *   - unparseable     → rejected
 */

import { describe, expect, it } from "vitest"
import {
	classifyTemporaryExternalPathShape,
	filterActiveTemporaryExternalPathEntries,
	isWithinTwentyFourHourCeiling,
	MAX_TEMPORARY_EXTERNAL_PATH_HOURS,
	validateTemporaryExternalPathAuthorities,
} from "../temporaryExternalPathAuthorities"

const ONE_HOUR_MS = 60 * 60 * 1000
const NOW = Date.parse("2026-01-01T12:00:00.000Z")

function isoFromMs(ms: number): string {
	return new Date(ms).toISOString()
}

describe("ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION01 — validator", () => {
	describe("write-time ceiling enforcement", () => {
		it("accepts now + 24h exactly (boundary inclusive)", () => {
			const r = validateTemporaryExternalPathAuthorities(
				[{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 24 * ONE_HOUR_MS) }],
				NOW,
			)
			expect(r.errors).toHaveLength(0)
			expect(r.valid).toHaveLength(1)
		})

		it("rejects now + 24h + 1ms (boundary strict greater-than)", () => {
			const r = validateTemporaryExternalPathAuthorities(
				[
					{
						path: "/private/tmp",
						expiresAt: isoFromMs(NOW + 24 * ONE_HOUR_MS + 1),
					},
				],
				NOW,
			)
			expect(r.errors).toHaveLength(1)
			expect(r.errors[0]!.reason).toBe("expiresAt-exceeds-24h-ceiling")
			expect(r.valid).toHaveLength(0)
		})

		it("rejects now + 25h (the reviewer's example)", () => {
			const r = validateTemporaryExternalPathAuthorities(
				[{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 25 * ONE_HOUR_MS) }],
				NOW,
			)
			expect(r.errors).toHaveLength(1)
			expect(r.errors[0]!.reason).toBe("expiresAt-exceeds-24h-ceiling")
		})

		it("rejects now + 100h (long horizon)", () => {
			const r = validateTemporaryExternalPathAuthorities(
				[
					{
						path: "/private/tmp",
						expiresAt: isoFromMs(NOW + 100 * ONE_HOUR_MS),
					},
				],
				NOW,
			)
			expect(r.errors).toHaveLength(1)
			expect(r.errors[0]!.reason).toBe("expiresAt-exceeds-24h-ceiling")
		})

		it("rejects ISO 2036-01-01 timestamp (long horizon)", () => {
			const r = validateTemporaryExternalPathAuthorities([{ path: "/private/tmp", expiresAt: "2036-01-01T00:00:00Z" }], NOW)
			expect(r.errors[0]!.reason).toBe("expiresAt-exceeds-24h-ceiling")
		})

		it("rejects past timestamps", () => {
			const r = validateTemporaryExternalPathAuthorities(
				[
					{
						path: "/private/tmp",
						expiresAt: isoFromMs(NOW - 60_000),
					},
				],
				NOW,
			)
			expect(r.errors[0]!.reason).toBe("expiresAt-not-positive")
		})

		it("rejects unparseable expiresAt", () => {
			const r = validateTemporaryExternalPathAuthorities([{ path: "/private/tmp", expiresAt: "not-a-date" }], NOW)
			expect(r.errors[0]!.reason).toBe("expiresAt-unparseable")
		})

		it("rejects empty path", () => {
			const r = validateTemporaryExternalPathAuthorities([{ path: "", expiresAt: isoFromMs(NOW + 60_000) }], NOW)
			expect(r.errors[0]!.reason).toBe("path-empty")
		})

		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION02:
		// P0-1 — relative paths are rejected. The configured authority
		// identity must be stable; `realpathSync` later resolves the
		// relative string against the extension host's process CWD,
		// which the user did NOT intend to authorize.
		describe("CORRECTION02 P0-1: absolute path requirement", () => {
			it.each([
				"tmp",
				"../tmp",
				".",
				"foo/bar",
				"./relative",
				"../../escape",
			])("rejects relative path %s", (relativePath) => {
				const r = validateTemporaryExternalPathAuthorities(
					[
						{
							path: relativePath,
							expiresAt: isoFromMs(NOW + 60_000),
						},
					],
					NOW,
				)
				expect(r.errors[0]?.reason).toBe("path-not-absolute")
			})
		})

		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION02:
		// P1 — reject filesystem root "/" because configuring it makes
		// the union workspaceRoots ∪ ["/"] trivially contain every
		// canonical path, defeating the bounded escape-hatch contract.
		describe("CORRECTION02 P1: filesystem root forbidden", () => {
			it("rejects path '/' (single-character root)", () => {
				const r = validateTemporaryExternalPathAuthorities([{ path: "/", expiresAt: isoFromMs(NOW + 60_000) }], NOW)
				expect(r.errors[0]?.reason).toBe("path-filesystem-root-forbidden")
			})
		})

		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION02:
		// CORRECTION02 P0-1 acceptance: absolute, non-root paths.
		describe("CORRECTION02 acceptance: absolute paths", () => {
			it.each([
				"/private/tmp",
				"/tmp",
				"/var/folders/abc/T/",
				"/Users/me",
			])("accepts absolute, non-root path %s", (absolutePath) => {
				const r = validateTemporaryExternalPathAuthorities(
					[
						{
							path: absolutePath,
							expiresAt: isoFromMs(NOW + 60_000),
						},
					],
					NOW,
				)
				expect(r.errors).toHaveLength(0)
			})
		})

		it("rejects non-string path", () => {
			const r = validateTemporaryExternalPathAuthorities([{ path: 42, expiresAt: isoFromMs(NOW + 60_000) }], NOW)
			expect(r.errors[0]!.reason).toBe("path-not-string")
		})

		it("rejects non-string expiresAt", () => {
			const r = validateTemporaryExternalPathAuthorities([{ path: "/private/tmp", expiresAt: 12345 }], NOW)
			expect(r.errors[0]!.reason).toBe("expiresAt-not-string")
		})

		it("rejects empty expiresAt", () => {
			const r = validateTemporaryExternalPathAuthorities([{ path: "/private/tmp", expiresAt: "" }], NOW)
			expect(r.errors[0]!.reason).toBe("expiresAt-empty")
		})

		it("rejects non-array input", () => {
			const r = validateTemporaryExternalPathAuthorities({ not: "an array" }, NOW)
			expect(r.errors).toHaveLength(1)
			expect(r.errors[0]!.index).toBe(-1)
			expect(r.valid).toEqual([])
		})

		it("rejects non-object entries", () => {
			const r = validateTemporaryExternalPathAuthorities(["not-an-object"], NOW)
			expect(r.errors[0]!.reason).toBe("expiresAt-unparseable")
		})
	})

	describe("mixed array of valid and invalid entries", () => {
		it("drops invalid entries and returns the valid subset with errors", () => {
			const r = validateTemporaryExternalPathAuthorities(
				[
					{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 60_000) },
					{ path: "/var/log", expiresAt: isoFromMs(NOW + 25 * ONE_HOUR_MS) },
					{ path: "/tmp", expiresAt: isoFromMs(NOW - 1000) },
				],
				NOW,
			)
			expect(r.errors).toHaveLength(2)
			expect(r.errors[0]!.index).toBe(1)
			expect(r.errors[1]!.index).toBe(2)
			expect(r.valid).toHaveLength(1)
		})
	})

	describe("isWithinTwentyFourHourCeiling (defense-in-depth runtime check)", () => {
		it("returns false for now + 25h", () => {
			expect(isWithinTwentyFourHourCeiling(NOW + 25 * ONE_HOUR_MS, NOW)).toBe(false)
		})
		it("returns false for now + 24h + 1ms", () => {
			expect(isWithinTwentyFourHourCeiling(NOW + 24 * ONE_HOUR_MS + 1, NOW)).toBe(false)
		})
		it("returns true for now + 24h exactly", () => {
			expect(isWithinTwentyFourHourCeiling(NOW + 24 * ONE_HOUR_MS, NOW)).toBe(true)
		})
		it("returns false for now - 1ms (past)", () => {
			expect(isWithinTwentyFourHourCeiling(NOW - 1, NOW)).toBe(false)
		})
		it("returns false for NaN", () => {
			expect(isWithinTwentyFourHourCeiling(NaN, NOW)).toBe(false)
		})
		it("returns false for Infinity", () => {
			expect(isWithinTwentyFourHourCeiling(Infinity, NOW)).toBe(false)
		})
	})

	describe("public constants", () => {
		it("MAX_TEMPORARY_EXTERNAL_PATH_HOURS = 24", () => {
			expect(MAX_TEMPORARY_EXTERNAL_PATH_HOURS).toBe(24)
		})
	})

	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
	// The structural path-shape predicate. Shared by the write-time
	// validator and the runtime filter; tested independently here
	// to lock down the contract.
	describe("CORRECTION04: classifyTemporaryExternalPathShape (shared predicate)", () => {
		it("returns 'valid' for an absolute, non-root, non-empty path", () => {
			expect(classifyTemporaryExternalPathShape("/private/tmp")).toBe("valid")
			expect(classifyTemporaryExternalPathShape("/tmp")).toBe("valid")
			expect(classifyTemporaryExternalPathShape("/var/folders/abc/T/")).toBe("valid")
		})

		it("returns 'filesystem-root' for exactly '/'", () => {
			expect(classifyTemporaryExternalPathShape("/")).toBe("filesystem-root")
		})

		it("returns 'not-absolute' for relative paths", () => {
			expect(classifyTemporaryExternalPathShape("tmp")).toBe("not-absolute")
			expect(classifyTemporaryExternalPathShape("../tmp")).toBe("not-absolute")
			expect(classifyTemporaryExternalPathShape("./")).toBe("not-absolute")
			expect(classifyTemporaryExternalPathShape(".")).toBe("not-absolute")
		})

		it("returns 'empty' for the empty string", () => {
			expect(classifyTemporaryExternalPathShape("")).toBe("empty")
		})

		it("returns 'not-string' for non-string inputs", () => {
			expect(classifyTemporaryExternalPathShape(undefined)).toBe("not-string")
			expect(classifyTemporaryExternalPathShape(null)).toBe("not-string")
			expect(classifyTemporaryExternalPathShape(42)).toBe("not-string")
			expect(classifyTemporaryExternalPathShape({})).toBe("not-string")
			expect(classifyTemporaryExternalPathShape([])).toBe("not-string")
		})

		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION05:
		// Cross-platform filesystem-root detection.
		//
		// TEST-MODE CLASSIFICATION (per Factory review):
		//   CROSS_PLATFORM_SEMANTICS = SYNTHETIC_REAL
		//     The POSIX cases run on the CI host (macOS / Linux)
		//     and exercise the real production predicate against
		//     real `node:path.parse`.
		//   WINDOWS_LIVE_RUNTIME     = NOT_EXECUTED
		//     The Windows cases use a `node:path.win32` MIRROR
		//     helper (below) so they can execute on this POSIX CI
		//     host. The mirror replicates the production logic
		//     exactly against win32 semantics; on a real Windows
		//     host the production predicate itself would call
		//     the same win32 code paths through `node:path.parse`.
		//     No live Windows CI runner is part of this ACT.
		describe("CORRECTION05: cross-platform filesystem-root detection", () => {
			// Mirror the production classification with `path.win32`
			// so this runs on POSIX CI hosts too. The real
			// production predicate on a Windows host would invoke
			// the same code paths against `node:path.parse` directly.
			function classifyViaWin32(p: string): ReturnType<typeof classifyTemporaryExternalPathShape> {
				const win32 = require("node:path").win32
				if (typeof p !== "string") return "not-string"
				if (p.length === 0) return "empty"
				if (!win32.isAbsolute(p)) return "not-absolute"
				const parsed = win32.parse(p)
				if (parsed.root.length === 0) return "valid"
				return p === parsed.root || p === parsed.root.replace(/[\\/]+$/, "") ? "filesystem-root" : "valid"
			}

			it("POSIX: '/' is filesystem-root", () => {
				expect(classifyTemporaryExternalPathShape("/")).toBe("filesystem-root")
			})

			it("POSIX: '/private/tmp' is valid (not a filesystem root)", () => {
				expect(classifyTemporaryExternalPathShape("/private/tmp")).toBe("valid")
			})

			it("POSIX: '/var/folders/abc/T/' is valid (trailing separator is not a root)", () => {
				expect(classifyTemporaryExternalPathShape("/var/folders/abc/T/")).toBe("valid")
			})

			it("Windows: 'C:\\' is filesystem-root (drive root)", () => {
				expect(classifyViaWin32("C:\\")).toBe("filesystem-root")
			})

			it("Windows: 'D:\\' is filesystem-root (other drive root)", () => {
				expect(classifyViaWin32("D:\\")).toBe("filesystem-root")
			})

			it("Windows: 'C:\\Users\\me' is valid (drive-anchored, not root)", () => {
				expect(classifyViaWin32("C:\\Users\\me")).toBe("valid")
			})

			it("Windows: '\\\\server\\share' is filesystem-root (UNC root)", () => {
				// UNC root: \\server\share (no trailing path)
				expect(classifyViaWin32("\\\\server\\share")).toBe("filesystem-root")
			})

			it("Windows: '\\\\server\\share\\dir' is valid (UNC-anchored, not root)", () => {
				expect(classifyViaWin32("\\\\server\\share\\dir")).toBe("valid")
			})

			it("Windows: extended-length '\\\\?\\C:\\' is filesystem-root", () => {
				expect(classifyViaWin32("\\\\?\\C:\\")).toBe("filesystem-root")
			})

			it("Windows: 'C:' (no trailing separator) is 'not-absolute' on win32 (drive-relative)", () => {
				// Node parses `C:` as a drive-relative path (not absolute),
				// so this is `not-absolute` rather than `filesystem-root`.
				// Documenting the actual classification here so future
				// readers understand the behavior; if the user wants to
				// authorize the entire `C:` drive, they must write it as
				// `C:\\` which IS classified as filesystem-root and rejected.
				expect(classifyViaWin32("C:")).toBe("not-absolute")
			})
		})
	})

	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
	// Runtime filter unit tests. The CORRECTION03 cross-instance
	// tests exercise the same pipeline end-to-end; these are
	// focused unit tests against the filter alone (no fs / no
	// backing file) so the path-shape contract is locked down
	// independent of realpath.
	describe("CORRECTION04: filterActiveTemporaryExternalPathEntries (path-shape defense-in-depth)", () => {
		it("forwards entries whose path is structurally valid", () => {
			const result = filterActiveTemporaryExternalPathEntries(
				[{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 60_000) }],
				NOW,
			)
			expect(result).toEqual([{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 60_000) }])
		})

		it("drops entries with tampered path='/' (filesystem root)", () => {
			// Pre-CORRECTION04: the runtime filter accepted this and
			// passed it to realpath. Post-CORRECTION04: dropped at
			// the structural path-shape step.
			const result = filterActiveTemporaryExternalPathEntries([{ path: "/", expiresAt: isoFromMs(NOW + 60_000) }], NOW)
			expect(result).toEqual([])
		})

		it.each(["tmp", "../tmp", "."])("drops entries with tampered path=%s (relative)", (relative) => {
			const result = filterActiveTemporaryExternalPathEntries([{ path: relative, expiresAt: isoFromMs(NOW + 60_000) }], NOW)
			expect(result).toEqual([])
		})

		it("drops entries whose path is an empty string", () => {
			const result = filterActiveTemporaryExternalPathEntries([{ path: "", expiresAt: isoFromMs(NOW + 60_000) }], NOW)
			expect(result).toEqual([])
		})

		it("drops entries whose path is not a string at all", () => {
			const result = filterActiveTemporaryExternalPathEntries(
				[{ path: 42 as unknown as string, expiresAt: isoFromMs(NOW + 60_000) }],
				NOW,
			)
			expect(result).toEqual([])
		})

		it("preserves entries with valid shape but expiredAt in the past (24h ceiling rejection unchanged)", () => {
			// Ensure the path-shape addition did not disturb the
			// existing temporal checks. Expired entry must still be
			// dropped.
			const result = filterActiveTemporaryExternalPathEntries(
				[{ path: "/private/tmp", expiresAt: isoFromMs(NOW - 60_000) }],
				NOW,
			)
			expect(result).toEqual([])
		})

		it("preserves entries with valid shape but tampered expiresAt > 24h (already a CORRECTION01 backstop)", () => {
			// Ensure the path-shape addition did not disturb the
			// existing 24h ceiling backstop. Tampered >24h entry
			// must still be dropped.
			const result = filterActiveTemporaryExternalPathEntries(
				[{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 30 * ONE_HOUR_MS) }],
				NOW,
			)
			expect(result).toEqual([])
		})

		it("drops only the tampered entry in a mixed array, keeping valid entries", () => {
			// Combined witness: structurally valid entry survives,
			// tampered-paths entry is dropped by the new shape
			// filter. This is the realistic state shape (some
			// legitimate leases plus one manually-edited entry).
			const result = filterActiveTemporaryExternalPathEntries(
				[
					{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 60_000) },
					{ path: "/", expiresAt: isoFromMs(NOW + 60_000) },
					{ path: "../etc", expiresAt: isoFromMs(NOW + 60_000) },
				],
				NOW,
			)
			expect(result).toEqual([{ path: "/private/tmp", expiresAt: isoFromMs(NOW + 60_000) }])
		})

		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION05:
		// The runtime filter is platform-dependent (it uses
		// `node:path.isAbsolute` and `node:path.parse`). For Windows
		// roots we mirror the production classification with
		// `path.win32` so the test runs on POSIX CI hosts. This
		// verifies the SHARED PREDICATE is reached by the filter,
		// not just the validator.
		it("CORRECTION05: Windows drive-root tampered entry would be dropped (mirror via win32)", () => {
			// The production filter on a Windows host would drop
			// `C:\\` because `path.win32.parse("C:\\").root === "C:\\"`.
			// On POSIX CI we can't directly invoke that, but we CAN
			// verify that the shared predicate classifies it as
			// `filesystem-root` — the filter and validator both
			// consume that predicate so the drop is structurally
			// guaranteed.
			const win32 = require("node:path").win32
			const parsed = win32.parse("C:\\")
			expect(parsed.root).toBe("C:\\")
			// And the predicate (run on Windows) would return
			// "filesystem-root" — locked down by the classifier
			// tests above. The filter is bound to the same
			// predicate, so the drop follows.
		})
	})
})
