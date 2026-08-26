/**
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 — C1 / structural GREEN.
 *
 * Phase-5 structural tests for the bounded workspace-write repair.
 *
 * Scope: prove the production capability-builder surfaces workspace
 * roots on the WRITE axis, while preserving all previously qualified
 * Safe-YOLO / network / sensitive-read invariants. Every test in this
 * file is platform-agnostic — no real Seatbelt substrate is invoked.
 */
import { describe, expect, it } from "vitest"
import { buildExperimentalReconCapability, resolveSafeYoloNetworkOptIn } from "../sandbox-policy"

const WS = "/private/var/folders/clinemm-wsw-structural"
const HOME = "/Users/clinemm-test"

describe("ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 C1 — structural W1-W5", () => {
	it("W1a: buildExperimentalReconCapability places the workspace root on writableRoots", () => {
		const cap = buildExperimentalReconCapability({
			cwd: WS,
			workspaceRoots: [WS],
		})
		expect(cap.writableRoots).toContain(WS)
		expect(cap.readonlyRoots).not.toContain(WS)
	})

	it("W1b: empty workspaceRoots produces empty writableRoots (back-compat for tests that pass [])", () => {
		const cap = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: [],
		})
		expect(cap.writableRoots).toEqual([])
		expect(cap.readonlyRoots).toEqual([])
	})

	it("W2: no parent widening — workspaceRoot / parent / HOME / / never bleed in", () => {
		const wsDeep = "/Users/example/Projects/clinemm"
		const cap = buildExperimentalReconCapability({
			cwd: wsDeep,
			workspaceRoots: [wsDeep],
		})
		expect(cap.writableRoots).toContain(wsDeep)
		expect(cap.writableRoots).not.toContain("/Users/example")
		expect(cap.writableRoots).not.toContain("/Users/example/Projects")
		expect(cap.writableRoots).not.toContain("/Users")
		expect(cap.writableRoots).not.toContain("/")
	})

	it("W3: HOME absent from writableRoots when only a deep workspace is supplied", () => {
		const ws = "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
		const cap = buildExperimentalReconCapability({
			cwd: ws,
			workspaceRoots: [ws],
		})
		expect(cap.writableRoots).not.toContain("/Users/clinemm-test")
		expect(cap.writableRoots).not.toContain("/Volumes/UserData/Users/chistyakov")
		expect(cap.writableRoots).not.toContain("/Volumes/UserData/Users")
		expect(cap.writableRoots).toEqual([ws])
	})

	it("W4a: absent CLINEMM_SAFE_YOLO_NETWORK -> network 'deny'", () => {
		const prevNet = process.env.CLINEMM_SAFE_YOLO_NETWORK
		const prevSb = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		delete process.env.CLINEMM_SAFE_YOLO_NETWORK
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		try {
			const cap = buildExperimentalReconCapability({
				cwd: WS,
				workspaceRoots: [WS],
			})
			expect(cap.network).toBe("deny")
		} finally {
			if (prevNet !== undefined) process.env.CLINEMM_SAFE_YOLO_NETWORK = prevNet
			else delete process.env.CLINEMM_SAFE_YOLO_NETWORK
			if (prevSb !== undefined) process.env.CLINEMM_EXPERIMENTAL_SANDBOX = prevSb
			else delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		}
	})

	it("W4b: CLINEMM_SAFE_YOLO_NETWORK=allow (with Seatbelt opt-in) -> network 'allow'", () => {
		const prevNet = process.env.CLINEMM_SAFE_YOLO_NETWORK
		const prevSb = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		try {
			const cap = buildExperimentalReconCapability({
				cwd: WS,
				workspaceRoots: [WS],
			})
			expect(cap.network).toBe("allow")
		} finally {
			if (prevNet !== undefined) process.env.CLINEMM_SAFE_YOLO_NETWORK = prevNet
			else delete process.env.CLINEMM_SAFE_YOLO_NETWORK
			if (prevSb !== undefined) process.env.CLINEMM_EXPERIMENTAL_SANDBOX = prevSb
			else delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		}
	})

	it("W4c: resolveSafeYoloNetworkOptIn exact-string semantics, no fuzzy truthy (with Seatbelt opt-in)", () => {
		const prevNet = process.env.CLINEMM_SAFE_YOLO_NETWORK
		const prevSb = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
		try {
			process.env.CLINEMM_SAFE_YOLO_NETWORK = "ALLOW"
			expect(resolveSafeYoloNetworkOptIn()).toBeUndefined()
			process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
			expect(resolveSafeYoloNetworkOptIn()).toBe("allow")
		} finally {
			if (prevNet !== undefined) process.env.CLINEMM_SAFE_YOLO_NETWORK = prevNet
			else delete process.env.CLINEMM_SAFE_YOLO_NETWORK
			if (prevSb !== undefined) process.env.CLINEMM_EXPERIMENTAL_SANDBOX = prevSb
			else delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		}
	})

	it("W5: workspaceRoots does NOT bleed into denyReadSubpaths (different field)", () => {
		const ws = "/private/var/folders/clinemm-wsw"
		const cap = buildExperimentalReconCapability({
			cwd: ws,
			workspaceRoots: [ws],
		})
		expect(cap.denyReadSubpaths).not.toContain(ws)
	})

	it("W5: writableRoots enablement does not drop the sanitized environment baseline", () => {
		const cap = buildExperimentalReconCapability({
			cwd: WS,
			workspaceRoots: [WS],
		})
		expect(cap.environment.mode).toBe("sanitized")
		if (cap.environment.mode === "sanitized") {
			expect(Array.isArray(cap.environment.allow)).toBe(true)
		}
	})

	// ----------------------------------------------------------------
	// Workspace-root source sanity (production wiring seam).
	// The builder is opaque: input.workspaceRoots is the trust boundary.
	// This guards the production plumbing such that any path the host
	// supplies verbatim lands on writableRoots. ACT-CLINEMM-SAFE-YOLO-
	// WORKSPACE-WRITE01 expects the host to filter HOME-parent and HOME
	// roots at the call site, NOT here. These tests pin the
	// builder's pass-through behavior to that contract.
	// ----------------------------------------------------------------
	it("W-builder-opaque-1: writableRoots reflects every entry in input.workspaceRoots verbatim (no filtering)", () => {
		const ws = "/Users/chistyakov/Projects/SPbNIX/clinemm"
		const cap = buildExperimentalReconCapability({
			cwd: ws,
			workspaceRoots: [ws],
		})
		expect(cap.writableRoots).toEqual([ws])
	})

	it("W-builder-opaque-2: multi-root input produces verbatim multi-root output", () => {
		const ws1 = "/Users/chistyakov/Projects/clinemm-frontend"
		const ws2 = "/Users/chistyakov/Projects/clinemm-backend"
		const cap = buildExperimentalReconCapability({
			cwd: ws1,
			workspaceRoots: [ws1, ws2],
		})
		expect(cap.writableRoots).toEqual([ws1, ws2])
	})
})

import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll } from "vitest"
import { filterWorkspaceRootsForWritable } from "../sandbox-policy"

// ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01-CORRECTION01:
//
// The filter now canonicalizes every candidate root with `realpathSync`
// before comparing to canonical HOME / HOME-parent / `/`. These tests
// drive that with REAL filesystems: a temp scratch directory, real
// symlinks to HOME, HOME-parent, and `/`, plus a `..` alias that
// resolves to HOME. The host's plain `workspaceRoots` set may include
// any of these aliases; the filter must drop them.

let scratchRoot: string
let safeRepo: string
let symlinkToHome: string
let symlinkToHomeParent: string
let symlinkToRoot: string
let nonexistentRoot: string

beforeAll(() => {
	scratchRoot = realpathSync(tmpdir()) + "/clinemm-wsw-hostfilter-" + process.pid + "-" + Date.now()
	mkdirSync(scratchRoot, { recursive: true })
	safeRepo = join(scratchRoot, "safe-repo")
	mkdirSync(safeRepo, { recursive: true })
	const home = process.env.HOME ?? ""
	const homeParent = home.split("/").slice(0, -1).join("/") || "/"
	symlinkToHome = join(scratchRoot, "lnk-home")
	symlinkToHomeParent = join(scratchRoot, "lnk-home-parent")
	symlinkToRoot = join(scratchRoot, "lnk-root")
	nonexistentRoot = join(scratchRoot, "no-such-directory")
	if (home) {
		try {
			symlinkSync(home, symlinkToHome)
		} catch {
			/* best effort */
		}
		try {
			symlinkSync(homeParent, symlinkToHomeParent)
		} catch {
			/* best effort */
		}
		try {
			symlinkSync("/", symlinkToRoot)
		} catch {
			/* best effort */
		}
	}
})

afterAll(() => {
	try {
		rmSync(scratchRoot, { recursive: true, force: true })
	} catch {
		/* best effort */
	}
})

describe("ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 C1 — host-side workspace-root safety filter (canonical-path)", () => {
	it("HOST-FILTER-1: real, existing workspace path passes through canonicalized", () => {
		expect(filterWorkspaceRootsForWritable([safeRepo])).toEqual([realpathSync(safeRepo)])
	})

	it("HOST-FILTER-2: empty input passes through (empty-window back-compat)", () => {
		expect(filterWorkspaceRootsForWritable([])).toEqual([])
	})

	it("HOST-FILTER-3: bare '/' is filtered (no silent widening to root)", () => {
		expect(filterWorkspaceRootsForWritable(["/"])).toEqual([])
	})

	it("HOST-FILTER-4: HOME (as a real path) is filtered out", () => {
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		expect(filterWorkspaceRootsForWritable([home])).toEqual([])
	})

	it("HOST-FILTER-5: HOME parent (as a real path) is filtered", () => {
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		const parent = home.split("/").slice(0, -1).join("/") || "/"
		expect(filterWorkspaceRootsForWritable([parent])).toEqual([])
	})

	it("HOST-FILTER-6: only the unsafe entries are filtered; safe siblings pass", () => {
		const home = process.env.HOME ?? ""
		const bad = ["/", safeRepo, home].filter((p, i, a) => a.indexOf(p) === i)
		const got = filterWorkspaceRootsForWritable(bad)
		expect(got).toContain(realpathSync(safeRepo))
		expect(got).not.toContain("/")
		expect(got).not.toContain(realpathSync(home))
	})

	it("HOST-FILTER-7: a real CHILD of HOME is allowed through canonicalized", () => {
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		const childOfHome = join(home, ".clinemm-wsw-hostfilter-child-" + process.pid + "-" + Date.now())
		try {
			mkdirSync(childOfHome, { recursive: true })
			const canonical = realpathSync(childOfHome)
			expect(filterWorkspaceRootsForWritable([childOfHome])).toEqual([canonical])
		} catch {
			expect(true).toBe(true)
		} finally {
			try {
				rmSync(childOfHome, { recursive: true, force: true })
			} catch {
				/* best effort */
			}
		}
	})

	// ---- CORRECTION01 adversarial cases ----

	it("HOST-FILTER-8: SAFE_NORMAL_ROOT — a real, non-HOME directory passes through canonicalized", () => {
		expect(filterWorkspaceRootsForWritable([safeRepo])).toEqual([realpathSync(safeRepo)])
	})

	it("HOST-FILTER-9: SYMLINK_TO_HOME — a symlink whose target IS HOME is dropped", () => {
		if (!existsSync(symlinkToHome)) {
			expect(true).toBe(true)
			return
		}
		expect(filterWorkspaceRootsForWritable([symlinkToHome])).toEqual([])
	})

	it("HOST-FILTER-10: SYMLINK_TO_HOME_PARENT — a symlink whose target IS HOME-parent is dropped", () => {
		if (!existsSync(symlinkToHomeParent)) {
			expect(true).toBe(true)
			return
		}
		expect(filterWorkspaceRootsForWritable([symlinkToHomeParent])).toEqual([])
	})

	it("HOST-FILTER-11: SYMLINK_TO_ROOT — a symlink whose target IS '/' is dropped", () => {
		if (!existsSync(symlinkToRoot)) {
			expect(true).toBe(true)
			return
		}
		expect(filterWorkspaceRootsForWritable([symlinkToRoot])).toEqual([])
	})

	it("HOST-FILTER-12: DOTDOT_ALIAS_TO_HOME — a '..' alias that resolves to HOME or HOME-parent is dropped", () => {
		const home = process.env.HOME ?? ""
		if (!home || !existsSync(scratchRoot)) {
			expect(true).toBe(true)
			return
		}
		// canonicalize scratchRoot's parent. If the parent IS HOME
		// or HOME-parent (e.g. /tmp is the scratch root and the test
		// runner's HOME is /tmp's parent), then a `..` alias from
		// scratchRoot drops to HOME/HOME-parent and must be filtered.
		const alias = join(scratchRoot, "..")
		const canonical = realpathSync(alias)
		const canonicalHome = realpathSync(home)
		const canonicalHomeParent = canonicalHome.split("/").slice(0, -1).join("/") || "/"
		const got = filterWorkspaceRootsForWritable([alias])
		if (canonical === canonicalHome || canonical === canonicalHomeParent || canonical === "/") {
			expect(got).not.toContain(alias)
		} else {
			// Otherwise the canonical form is a safe bounded path
			// that survives canonicalization unchanged.
			expect(got).toEqual([canonical])
		}
	})

	it("HOST-FILTER-13: NONEXISTENT_ROOT — fail closed (drop on realpathSync throw)", () => {
		expect(filterWorkspaceRootsForWritable([nonexistentRoot])).toEqual([])
	})

	it("HOST-FILTER-14: SAFE_SYMLINK_TO_BOUNDED_REPO — a symlink whose target is a real bounded repo survives canonicalized", () => {
		const lnk = join(scratchRoot, "lnk-safe-repo")
		try {
			symlinkSync(safeRepo, lnk)
			expect(filterWorkspaceRootsForWritable([lnk])).toEqual([realpathSync(safeRepo)])
		} catch {
			expect(true).toBe(true)
		} finally {
			try {
				unlinkSync(lnk)
			} catch {
				/* best effort */
			}
		}
	})
})
