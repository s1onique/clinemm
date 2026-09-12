/**
 * ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
 *
 * Pure-functional tests for the host-helper AF_UNIX authority rule
 * emitted by {@link generateSeatbeltProfile}. Mirror of the ssh-agent
 * authority tests; pure-functional so no Seatbelt substrate required.
 *
 * Cases covered:
 *   - default mode (host-helper env absent): no AF_UNIX rules
 *   - empty / undefined canonicalSocketPath: no AF_UNIX rules
 *   - canonical path present: emits path-literal network-outbound,
 *     no subpath widening, no filesystem grant widening
 *   - control-character path: rejected (escape invariant preserved)
 *   - quote in path: escaped correctly inside the SBPL string
 *   - exact scope test (HH-SIBLING): helper.sock allowed, sibling.sock
 *     not allowed, different.sock not allowed
 *   - exact scope test (HH-PARENT-DIR): no subpath grant for the
 *     parent directory of the helper socket
 */

import { describe, expect, it } from "vitest"

import { generateSeatbeltProfile } from "./seatbelt-profile"
import type { CommandCapability } from "../types"

const minimalCap: CommandCapability = {
	readonlyRoots: [],
	writableRoots: [],
	tempRoot: "/tmp",
	createOnlyRoots: [],
	network: "deny",
	environment: { mode: "sanitized", allow: [] },
	cwd: "/tmp",
}

describe("ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01: host-helper socket rules", () => {
	it("HH-01 default mode (no hostHelperCanonicalSocketPath): no AF_UNIX rules emitted", () => {
		const p = generateSeatbeltProfile(minimalCap)
		expect(p).not.toContain("AF_UNIX")
		expect(p).not.toContain("unix-socket")
	})

	it("HH-02 empty/undefined canonicalSocketPath produces no host-helper rules", () => {
		const p1 = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: undefined,
		})
		expect(p1).not.toContain("AF_UNIX")
		const p2 = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: "",
		})
		expect(p2).not.toContain("AF_UNIX")
	})

	it("HH-03 canonical path present: emits AF_UNIX system-socket + path-literal network-outbound", () => {
		const CANONICAL = "/Users/me/.clinemm/host-helper.sock"
		const p = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: CANONICAL,
		})
		expect(p).toContain("(allow system-socket")
		expect(p).toContain("(socket-domain AF_UNIX))")
		expect(p).toContain("(allow network-outbound")
		expect(p).toContain(
			`(remote unix-socket (path-literal "${CANONICAL}"))`,
		)
		// NEGATIVE: subpath is the filesystem primitive — must NOT be
		// used for sockets.
		expect(p).not.toMatch(/\(remote unix-socket \(subpath/)
	})

	it("HH-04 host-helper rule does NOT widen to filesystem grant (no subpath for parent dir)", () => {
		const CANONICAL = "/Users/me/.clinemm/host-helper.sock"
		const p = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: CANONICAL,
		})
		// The parent directory MUST NOT appear as a writable/readable subpath.
		expect(p).not.toMatch(/\(subpath "\/Users\/me\/\.clinemm"\)/)
	})

	it("HH-05 control-character socket path is REJECTED (CORRECTION01 P0-3 invariant)", () => {
		expect(() =>
			generateSeatbeltProfile(minimalCap, {
				hostHelperCanonicalSocketPath: "/tmp/helper\nsock",
			}),
		).toThrow()
	})

	it("HH-06 socket path with quote is escaped inside the SBPL string", () => {
		const CANONICAL = '/tmp/helper"quoted'
		const p = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: CANONICAL,
		})
		expect(p).toContain('(path-literal "/tmp/helper\\"quoted")')
	})

	it("HH-07 EXACT scope: helper.sock allowed, sibling.sock NOT allowed", () => {
		const HELPER = "/Users/me/.clinemm/host-helper.sock"
		const p = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: HELPER,
		})
		// The canonical helper path MUST be present.
		expect(p).toContain(`(path-literal "${HELPER}")`)
		// A sibling socket in the same directory MUST NOT appear as a
		// allowed path-literal. (Sentinel: this is the load-bearing
		// exact-scope assertion; if it regresses we widen authority.)
		expect(p).not.toContain("/Users/me/.clinemm/sibling.sock")
		expect(p).not.toContain("/Users/me/.clinemm/different.sock")
	})

	it("HH-08 ssh-agent and host-helper rules coexist when both env vars are set", () => {
		const AGENT = "/private/tmp/com.apple.launchd.abc/Listeners"
		const HELPER = "/Users/me/.clinemm/host-helper.sock"
		const p = generateSeatbeltProfile(minimalCap, {
			sshAgentCanonicalSocketPath: AGENT,
			hostHelperCanonicalSocketPath: HELPER,
		})
		expect(p).toContain(`(path-literal "${AGENT}")`)
		expect(p).toContain(`(path-literal "${HELPER}")`)
		// Each path-literal appears EXACTLY once.
		const occurrencesAgent = p.split(`(path-literal "${AGENT}")`).length - 1
		const occurrencesHelper = p.split(`(path-literal "${HELPER}")`).length - 1
		expect(occurrencesAgent).toBe(1)
		expect(occurrencesHelper).toBe(1)
	})
})
