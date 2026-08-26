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

import { filterWorkspaceRootsForWritable } from "../sandbox-policy"

describe("ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 C1 — host-side workspace-root safety filter", () => {
	it("HOST-FILTER-1: regular workspace path passes through", () => {
		const ws = "/Users/chistyakov/Projects/SPbNIX/clinemm"
		expect(filterWorkspaceRootsForWritable([ws])).toEqual([ws])
	})

	it("HOST-FILTER-2: empty input passes through (empty-window back-compat)", () => {
		expect(filterWorkspaceRootsForWritable([])).toEqual([])
	})

	it("HOST-FILTER-3: bare '/' is filtered (no silent widening to root)", () => {
		expect(filterWorkspaceRootsForWritable(["/"])).toEqual([])
	})

	it("HOST-FILTER-4: HOME is filtered out (cannot widen to user data silently)", () => {
		// os.homedir() in vitest is the test runner's HOME
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		expect(filterWorkspaceRootsForWritable([home])).toEqual([])
	})

	it("HOST-FILTER-5: HOME parent is filtered (defense-in-depth against shallow roots)", () => {
		const home = process.env.HOME ?? ""
		const parent = home.split("/").slice(0, -1).join("/") || "/"
		expect(filterWorkspaceRootsForWritable([parent])).toEqual([])
	})

	it("HOST-FILTER-6: only the unsafe entries are filtered; safe siblings pass", () => {
		const ws = "/Users/chistyakov/Projects/clinemm"
		const home = process.env.HOME ?? ""
		const bad = ["/", ws, home].filter((p, i, a) => a.indexOf(p) === i)
		expect(filterWorkspaceRootsForWritable(bad)).toEqual([ws])
	})

	it("HOST-FILTER-7: Home-/= siblings under HOME do NOT widen to HOME itself", () => {
		// The filter is exact-path-match against HOME only; it does
		// not silently widen a subdirectory of HOME to HOME.
		const home = process.env.HOME ?? ""
		if (!home) {
			expect(true).toBe(true)
			return
		}
		const childOfHome = `${home}/projects-foo`
		expect(filterWorkspaceRootsForWritable([childOfHome])).toEqual([childOfHome])
	})
})
