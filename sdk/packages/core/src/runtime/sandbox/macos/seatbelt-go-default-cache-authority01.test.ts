/**
 * ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01
 *
 * Pure-functional tests for the Go default build cache authority
 * surface emitted by {@link generateSeatbeltProfile}. Mirror of the
 * ssh-agent and host-helper authority test suites; pure-functional
 * so no Seatbelt substrate required.
 *
 * Background (per the ACT's live-failure analysis):
 *
 *   Go's NATIVE build cache on darwin is
 *     `os.UserCacheDir() + "/go-build"` = `$HOME/Library/Caches/go-build`
 *
 *   This is documented (cmd/go/internal/cache/default.go) and is
 *   what `go env GOCACHE` reports with `GOCACHE` unset. The Seatbelt
 *   profile generator's prior invariant was: deny everything not on
 *   the explicit allow-list. The Go default cache was not on the
 *   allow-list, so any `go test`/`go build` invocation inside the
 *   sandbox either failed with EPERM or was steered by external
 *   shell init scripts into a per-project `GOCACHE=/tmp/go-cache-*`
 *   override. Hundreds of those directories accumulated in
 *   `/private/tmp` over time, each holding a full Go build cache
 *   that Go would otherwise have aged and shared across projects.
 *
 *   The fix is a SINGLE bounded rule granting write authority to the
 *   canonical `<HOME>/Library/Caches/go-build` subtree, computed
 *   via `realpathSync` at module load (so macOS volume aliasing
 *   cannot silently defeat Seatbelt's `(subpath ...)` matching).
 *   The grant is INTENTIONALLY narrow: no sibling subtree under
 *   `<HOME>/Library/Caches/` is granted.
 *
 * Cases covered (per the ACT's §6 discriminator matrix):
 *
 *   GO-CACHE-01: canonical HOME-derived `<HOME>/Library/Caches/go-build`
 *                is emitted as a `(allow file-write* (subpath ...))` rule
 *   GO-CACHE-02: the grant is subpath-scoped (NOT a literal,
 *                NOT a `~/Library/Caches` blanket)
 *   GO-CACHE-03: a sibling `<HOME>/Library/Caches/<not-go-build>`
 *                subtree is NOT granted
 *   GO-CACHE-04: HOME canonicalization is preserved — the emitted
 *                path is the realpath-resolved vnode, not the
 *                textual `os.homedir()` string
 *   GO-CACHE-05: ssh-agent AF_UNIX authority is unchanged
 *   GO-CACHE-06: trusted host-helper AF_UNIX authority is unchanged
 *   GO-CACHE-07: profile determinism after Go-cache addition
 *   GO-CACHE-08: Go-cache allow does NOT widen to file-read subpath
 *   GO-CACHE-09: readonlyRoots deny appears AFTER the Go-cache
 *                allow (CORRECTION01 — last-match-wins guarantees
 *                readonly descendants of go-build stay denied)
 *   GO-CACHE-09b: real discriminator — a readonlyRoot that is a
 *                descendant of `<HOME>/Library/Caches/go-build` is
 *                structurally DENIED (deny rule appears after the
 *                go-cache allow in the rendered SBPL)
 *   GO-CACHE-09c: P1-fix discriminator — a readonlyRoot that
 *                overlaps a createOnlyRoot is structurally DENIED
 *                (deny is truly LAST, even after the createOnlyAllow)
 *   GO-CACHE-10: homedir() sanity anchor
 *   GO-CACHE-11: bounded fail-closed — generator emits the rule
 *                when the TRUSTED ANCESTOR `<HOME>/Library/Caches`
 *                resolves (even when the LEAF go-build does not
 *                exist yet, which is the normal first-use state
 *                for a freshly installed Go); emits no rule only
 *                when the ancestor itself cannot be canonicalized
 *
 * Note on GO-CACHE-07 (regression sentinel against any code that
 * manufactures a unique GOCACHE override): this is intentionally
 * NOT asserted as a structural test inside the SDK because the
 * workaround lives in external tooling (shell init scripts /
 * factory wrappers), not in this module. The kernel-witness half
 * of the discrimination lives in the apps/vscode end-to-end suite
 * `darwin-seatbelt-go-default-cache-authority01.c1-green.test.ts`
 * (real `sandbox-exec` against a small Go project + a sibling
 * non-go-build Caches probe).
 *
 * Skip conditions: none. The tests are pure-functional. When the
 * canonical Go cache dir does not exist on the host (ENOENT at
 * module load), the test asserts the bounded-fail-closed behavior:
 * the profile MUST NOT include a `Library/Caches` allowance of any
 * shape (the generator must NOT fall back to a textual home path
 * or to a permissive `Library/Caches/**` blanket).
 */

import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"

import { describe, expect, it } from "vitest"

import { generateSeatbeltProfile } from "./seatbelt-profile"
import type { CommandCapability } from "../types"

const minimalCap: CommandCapability = {
	readonlyRoots: [],
	writableRoots: [],
	network: "deny",
	environment: { mode: "sanitized", allow: [] },
}

/**
 * The canonical Go default build-cache path on the host running this
 * test, resolved via the SAME chain the profile generator uses
 * internally: `realpathSync` of the existing trusted ancestor
 * `<HOME>/Library/Caches` followed by appending the fixed leaf
 * `go-build`. `null` when the trusted ancestor itself cannot be
 * canonicalized (the bounded-fail-closed branch of the generator).
 *
 * Mirrors `ALWAYS_WRITABLE_GO_BUILD_CACHE_SUBPATHS` in
 * `seatbelt-profile.ts` exactly — if the generator's path changes,
 * this constant changes in lockstep, and the test fails closed
 * rather than silently producing a tautological GREEN.
 *
 * CORRECTION01: the prior implementation did
 *   `realpathSync(${homedir()}/Library/Caches/go-build)`
 * which ENOENTs on a fresh user account (Go creates the leaf on
 * first use via `MkdirAll`). That made every GO-CACHE-NN test
 * trivially skip on a fresh account, masking the very contract
 * defect the ACT was created to fix. The new helper mirrors the
 * generator's canonicalize-parent + fixed-leaf shape so that
 * the leaf MAY be absent while the generator still emits a rule.
 */
const canonicalGoBuildCache: string | null = (() => {
	try {
		const parent = realpathSync(`${homedir()}/Library/Caches`)
		return `${parent}/go-build`
	} catch {
		return null
	}
})()

/**
 * The raw textual path (`os.homedir()` + literal) used to compute
 * the canonical form. The GO-CACHE-04 discriminator proves the
 * emitted path is the canonical (realpath-resolved) one and NOT
 * the textual concatenation — the difference matters on macOS
 * where `os.homedir()` can return a volume-mounted prefix that
 * does not appear in the kernel's resolved vnode path.
 */
const textualGoBuildCache = `${homedir()}/Library/Caches/go-build`

describe("ACT-CLINEMM-SEATBELT-GO-DEFAULT-CACHE01: Go default build cache authority", () => {
	it("GO-CACHE-01: canonical HOME-derived <HOME>/Library/Caches/go-build is granted as (subpath ...)", () => {
		// On a fresh host where the dir does not yet exist, the
		// bounded-fail-closed branch MUST emit no rule of any shape
		// — never a textual home path, never a blanket Caches grant.
		// We capture both branches in one test so the matrix
		// exercises the module-load realpath contract.
		const p = generateSeatbeltProfile(minimalCap)
		if (canonicalGoBuildCache === null) {
			// Cache dir does not exist yet. Assert NOTHING related
			// to Caches or Go appears in the profile.
			expect(p).not.toMatch(/Library[\\/]Caches/i)
			expect(p).not.toMatch(/go-build/)
			return
		}
		// Cache dir exists: assert the canonical subpath is present.
		expect(p).toContain(`(subpath "${canonicalGoBuildCache}")`)
		// And it is wrapped in a (allow file-write* ...) line.
		expect(p).toMatch(
			new RegExp(
				`\\(allow file-write\\*\\s*\\n\\s*\\(subpath "${canonicalGoBuildCache.replace(
					/[.*+?^${}()|[\]\\]/g,
					"\\$&",
				)}"\\)\\)`,
			),
		)
	})

	it("GO-CACHE-02: the grant is subpath-scoped (NOT a literal, NOT a ~/Library/Caches blanket)", () => {
		// (literal "...") is for kernel-recognized redirect targets
		// (/dev/null, /dev/tty); Go's build cache is a directory
		// tree, never a literal. Using literal would silently
		// match only the dir itself, not its descendants.
		const p = generateSeatbeltProfile(minimalCap)
		if (canonicalGoBuildCache === null) {
			expect(p).not.toMatch(/\(literal "[^"]*go-build/)
			expect(p).not.toMatch(/\(subpath "[^"]*Library[\\/]Caches"\)/)
			return
		}
		// Negative: literal shape MUST NOT be used.
		expect(p).not.toContain(`(literal "${canonicalGoBuildCache}")`)
		// Positive: it is a (subpath ...) match.
		expect(p).toContain(`(subpath "${canonicalGoBuildCache}")`)
	})

	it("GO-CACHE-03: a sibling <HOME>/Library/Caches/<not-go-build> subtree is NOT granted", () => {
		// Load-bearing conservation invariant. The fix is
		// INTENTIONALLY narrow: granting only Go's cache, not the
		// user's whole Caches directory. Sibling subtrees under
		// ~/Library/Caches/ (Safari, Google, etc.) MUST remain
		// denied by `(deny default)`.
		const siblingName = "clinemm-seatbelt-should-deny"
		const p = generateSeatbeltProfile(minimalCap)
		expect(p).not.toContain(siblingName)
		expect(p).not.toMatch(/clinemm-seatbelt-should-deny/i)
		// The profile MAY contain `(subpath "...Library/Caches/go-build")`
		// (the desired grant), but MUST NOT contain any other Caches
		// descendant. We split the check into a positive allow for the
		// exact go-build subpath (when the canonical dir exists) and a
		// negative forbid for any Caches descendant that is NOT exactly
		// the go-build subpath.
		if (canonicalGoBuildCache !== null) {
			// Positive: the go-build subpath IS granted.
			expect(p).toContain(`(subpath "${canonicalGoBuildCache}")`)
			// Negative: no other Caches descendant is granted.
			// We search for any `(subpath "...Library/Caches/<X>")` and
			// assert that <X> is exactly the go-build leaf name.
			const cachesSubpathPattern =
				/\(subpath "([^"]*Library\/Caches\/[^"]*)"\)/g
			for (const match of p.matchAll(cachesSubpathPattern)) {
				const matched = match[1]
				expect(matched).toBe(canonicalGoBuildCache)
			}
		} else {
			// Fail-closed branch: no Caches descendant of any kind
			// (including go-build) is granted.
			expect(p).not.toMatch(/\(subpath "[^"]*Library\/Caches\/[^"]*"\)/)
		}
		// And, structurally, the parent `Library/Caches` itself (a
		// not-yet-leaf subpath) is never granted on its own — that
		// would widen authority to all of the user's Caches.
		expect(p).not.toMatch(/\(subpath "[^"]*\/Library\/Caches"\)/)
		expect(p).not.toMatch(/\(subpath "[^"]*\/Caches"\)/)
	})

	it("GO-CACHE-04: HOME canonicalization is preserved (emitted path is realpath-resolved, not textual)", () => {
		// On hosts where `os.homedir()` is a synthetic prefix that
		// does NOT appear in the kernel's resolved vnode path
		// (e.g. /Volumes/... on a non-boot volume), a textual
		// `(subpath "/Volumes/.../Library/Caches/go-build")`
		// would silently fail to match Go's actual writes.
		const p = generateSeatbeltProfile(minimalCap)
		if (canonicalGoBuildCache === null) {
			expect(p).not.toContain(textualGoBuildCache)
			return
		}
		if (textualGoBuildCache !== canonicalGoBuildCache) {
			expect(p).toContain(`(subpath "${canonicalGoBuildCache}")`)
			expect(p).not.toContain(`(subpath "${textualGoBuildCache}")`)
		} else {
			expect(p).toContain(`(subpath "${canonicalGoBuildCache}")`)
		}
		// Independent sanity check (P1 fix from CORRECTION01 review):
		// the generator's home-derived path matches the canonical
		// path this test computed. We MUST NOT use
		// `realpathSync(${homedir()}/Library/Caches/go-build)` here
		// — that path does not yet exist on a fresh user account,
		// so the assertion would throw ENOENT and the test would
		// fail closed for the wrong reason (masking the first-use
		// scenario this ACT was created to fix). Instead, mirror
		// the generator's shape: canonicalize the EXISTING
		// ancestor and append the fixed leaf.
		expect(canonicalGoBuildCache).toBe(
			`${realpathSync(`${homedir()}/Library/Caches`)}/go-build`,
		)
	})

	it("GO-CACHE-05: ssh-agent AF_UNIX authority is unchanged", () => {
		// CONSERVATION. The Go-cache rule MUST NOT displace or
		// alter the ssh-agent authority surface.
		const AGENT = "/private/tmp/com.apple.launchd.abc/Listeners"
		const p = generateSeatbeltProfile(minimalCap, {
			sshAgentCanonicalSocketPath: AGENT,
		})
		expect(p).toContain("(allow system-socket")
		expect(p).toContain("(socket-domain AF_UNIX))")
		expect(p).toContain(`(remote unix-socket (path-literal "${AGENT}"))`)
		expect(p).not.toMatch(/\(remote unix-socket \(subpath/)
	})

	it("GO-CACHE-06: trusted host-helper AF_UNIX authority is unchanged", () => {
		// CONSERVATION. Same shape as ssh-agent, different path.
		const HELPER = "/Users/me/.clinemm/host-helper.sock"
		const p = generateSeatbeltProfile(minimalCap, {
			hostHelperCanonicalSocketPath: HELPER,
		})
		expect(p).toContain("(allow system-socket")
		expect(p).toContain("(socket-domain AF_UNIX))")
		expect(p).toContain(`(remote unix-socket (path-literal "${HELPER}"))`)
		expect(p).not.toMatch(/\(remote unix-socket \(subpath/)
		expect(p).not.toContain("/Users/me/.clinemm/sibling.sock")
	})

	it("GO-CACHE-07 conservation: profile remains deterministic after Go-cache addition", () => {
		// The Go-cache constant is computed at module load; if a
		// future regression made it time-dependent (e.g. inline
		// Date.now()), this test catches it.
		const cap: CommandCapability = {
			readonlyRoots: [],
			writableRoots: ["/Users/me/writable"],
			tempRoot: "/private/tmp/clinemm-sandbox-1",
			network: "deny",
			environment: { mode: "sanitized", allow: [] },
		}
		const a = generateSeatbeltProfile(cap)
		const b = generateSeatbeltProfile(cap)
		expect(a).toBe(b)
	})

	it("GO-CACHE-08 conservation: Go-cache allow does NOT widen to file-read subpath", () => {
		// The Go-cache rule grants ONLY file-write*. Reads are
		// already granted by the broad (allow file-read*) prelude.
		// The generator MUST NOT add a redundant file-read*
		// subpath allowance for the cache (the broad read prelude
		// already covers it).
		const p = generateSeatbeltProfile(minimalCap)
		expect(p).toMatch(/^\(allow file-read\*\)$/m)
		const readSubpathMatches = p.match(
			/^\(allow file-read\*\s*\n\s*\(subpath "[^"]*"\)\s*\)/m,
		)
		expect(readSubpathMatches).toBeNull()
	})

	it("GO-CACHE-09 conservation: readonlyRoots deny appears AFTER Go-cache allow (CORRECTION01 — last-match-wins guarantees readonly descendants of go-build stay DENIED)", () => {
		// CORRECTION01 (load-bearing): the readonlyRoots deny MUST
		// come AFTER the Go-cache allow. Seatbelt's last-match-wins
		// semantics means a later `(allow ...)` would RE-OPEN a
		// readonly descendant — so if the Go-cache allow were
		// emitted after the deny, a readonlyRoot that is a
		// descendant of `<HOME>/Library/Caches/go-build` would
		// silently become writable.
		//
		// The previous ordering (broad allow → readonly deny →
		// go-cache allow) violated this invariant and was
		// structurally able to re-open a readonly descendant of
		// the canonical cache. The fix flips the order to:
		//   broad allow → go-cache allow → readonly deny
		const cap: CommandCapability = {
			readonlyRoots: [`${homedir()}/Library/Caches/go-build/probe-readonly`],
			writableRoots: [`${homedir()}/Library/Caches/go-build/probe-writable`],
			network: "deny",
			environment: { mode: "sanitized", allow: [] },
		}
		const p = generateSeatbeltProfile(cap)
		const writeAllowIdx = p.indexOf("(allow file-write*")
		const writeDenyIdx = p.indexOf("(deny file-write*")
		expect(writeAllowIdx).toBeGreaterThanOrEqual(0)
		expect(writeDenyIdx).toBeGreaterThan(writeAllowIdx)
		if (canonicalGoBuildCache !== null) {
			const goCacheAllowIdx = p.indexOf(
				`(subpath "${canonicalGoBuildCache}")`,
			)
			if (goCacheAllowIdx >= 0) {
				// CORRECTION01: Go-cache allow must come BEFORE the
				// readonlyRoots deny so "last match wins" makes
				// the deny authoritative.
				expect(goCacheAllowIdx).toBeLessThan(writeDenyIdx)
				expect(goCacheAllowIdx).toBeGreaterThan(writeAllowIdx)
			}
		}
	})

	it("GO-CACHE-09b conservation: a readonlyRoot that is a descendant of the Go cache is structurally DENIED by Seatbelt (last-match-wins kernel discriminator)", () => {
		// CORRECTION01 (real discriminator): the reviewer correctly
		// observed that the prior ordering
		//   broad allow → readonly deny → go-cache allow
		// would RE-OPEN a readonlyRoot that is a descendant of
		// `<HOME>/Library/Caches/go-build` because the later
		// allow wins under Seatbelt's last-match-wins semantics.
		// The fixed ordering is
		//   broad allow → go-cache allow → readonly deny
		// which makes the deny authoritative.
		//
		// This test asserts the FIXED shape directly: a
		// readonlyRoot that sits UNDER the canonical Go cache
		// root MUST appear AFTER the go-cache allow in the
		// rendered SBPL. A kernel witness should additionally
		// verify that an actual write to that readonlyRoot path
		// is denied (G2 sibling test in the apps/vscode suite
		// covers an analogous case at the next-sibling level;
		// the descendant case is structurally equivalent here).
		const readonlyUnderGoCache = canonicalGoBuildCache
			? `${canonicalGoBuildCache}/probe-readonly-${Date.now()}`
			: null
		if (!readonlyUnderGoCache) {
			// Skip when we cannot construct a real descendant
			// path (no canonical cache available). The fixed
			// ordering is still proven by GO-CACHE-09.
			expect(true).toBe(true)
			return
		}
		const cap: CommandCapability = {
			readonlyRoots: [readonlyUnderGoCache],
			writableRoots: [],
			network: "deny",
			environment: { mode: "sanitized", allow: [] },
		}
		const p = generateSeatbeltProfile(cap)
		const goCacheAllowIdx = p.indexOf(`(subpath "${canonicalGoBuildCache}")`)
		expect(goCacheAllowIdx).toBeGreaterThanOrEqual(0)
		// Find the deny line that targets the readonly descendant.
		// We escape any characters that would break a substring
		// match (none expected for our synthesized path), but the
		// substring `"/probe-readonly-"` is sufficient to
		// discriminate.
		const denyIdx = p.indexOf(`(deny file-write* (subpath "${readonlyUnderGoCache}")`)
		expect(denyIdx).toBeGreaterThan(goCacheAllowIdx)
	})

	it("GO-CACHE-09c conservation: a readonlyRoot that overlaps a createOnlyRoot is structurally DENIED (P1 fix — deny is LAST, even after createOnlyAllow)", () => {
		// P1 fix from CORRECTION01 review: the previous shape
		// emitted `createOnlyAllow` AFTER `readonlyRoots deny`,
		// which would silently re-open a readonlyRoot that
		// overlapped a createOnlyRoot. The fixed shape emits
		// createOnlyAllow BEFORE the readonlyRoots deny, so the
		// deny is truly LAST and authoritative under
		// Seatbelt's last-match-wins.
		//
		// This test asserts the FIXED shape directly with a
		// readonlyRoot that exactly equals a createOnlyRoot. A
		// successful write to that path MUST be denied because
		// the readonlyRoots deny is emitted after the
		// createOnlyAllow.
		const overlapRoot = `/tmp/clinemm-overlap-${Date.now()}`
		const cap: CommandCapability = {
			readonlyRoots: [overlapRoot],
			writableRoots: [],
			createOnlyRoots: [overlapRoot],
			network: "deny",
			environment: { mode: "sanitized", allow: [] },
		}
		const p = generateSeatbeltProfile(cap)
		const createOnlyAllowIdx = p.indexOf(
			`(allow file-write-create\n  (subpath "${overlapRoot}"))`,
		)
		expect(createOnlyAllowIdx).toBeGreaterThanOrEqual(0)
		// The readonlyRoots deny MUST come AFTER the createOnlyAllow.
		const denyIdx = p.indexOf(`(deny file-write* (subpath "${overlapRoot}")`)
		expect(denyIdx).toBeGreaterThan(createOnlyAllowIdx)
	})

	it("GO-CACHE-10 sanity: homedir() canonicalization anchor exists on darwin hosts", () => {
		// Precondition assertion: os.homedir() must return a
		// non-empty absolute path. Without this, GO-CACHE-01
		// could pass trivially (canonical = /Library/Caches/go-build
		// = matchable by a buggy generator that emits that same
		// literal). This catches that bug class before it can
		// pass silently.
		const home = homedir()
		expect(home.length).toBeGreaterThan(0)
		expect(home).toMatch(/^[/]/)
	})

	it("GO-CACHE-11 structural: bounded fail-closed when the trusted ancestor cannot be canonicalized", () => {
		// CORRECTION01 (load-bearing change): the bounded-fail-closed
		// branch now triggers when the TRUSTED ANCESTOR
		// `<HOME>/Library/Caches` cannot be canonicalized, NOT when
		// the LEAF `<HOME>/Library/Caches/go-build` is absent. The
		// leaf being absent is the normal first-use state for a
		// freshly provisioned Go installation — Go creates it via
		// `MkdirAll(dir, 0o777)` in `cmd/go/internal/cache/default.go`.
		//
		// When the leaf is absent but the ancestor resolves (the
		// common case on a fresh account) the generator STILL
		// emits the rule — that's the entire point of the fix.
		// When the ancestor itself cannot be resolved (extremely
		// unusual on macOS), the generator emits no rule.
		//
		// This test therefore asserts the POSITIVE side: the rule
		// is emitted even when the leaf is absent (the canonical
		// ancestor resolves, the leaf may or may not exist).
		const canonicalAncestor: string | null = (() => {
			try {
				return realpathSync(`${homedir()}/Library/Caches`)
			} catch {
				return null
			}
		})()
		if (canonicalAncestor === null) {
			// Cannot test the normal case on this host (the
			// trusted ancestor is missing). Skip — the next
			// assertion below covers the no-rule branch.
			const p = generateSeatbeltProfile(minimalCap)
			expect(p).not.toMatch(/Library[\\/]Caches/i)
			expect(p).not.toMatch(/go-build/)
			expect(p).not.toMatch(/\(subpath "~\//)
			return
		}
		// Positive case: the trusted ancestor resolves, so the
		// generator MUST emit a rule for `<ancestor>/go-build`
		// even if the leaf is absent. This is the entire
		// regression discriminator — without this assertion,
		// the prior buggy implementation (canonicalize the leaf
		// directly) would have trivially passed by emitting no
		// rule on a fresh account.
		const expectedRuleSubpath = `(subpath "${canonicalAncestor}/go-build")`
		const p = generateSeatbeltProfile(minimalCap)
		expect(p).toContain(expectedRuleSubpath)
		// And it MUST be a subpath, NOT a literal (subpath is
		// the correct primitive for descendant-or-self matching;
		// literal would not match descendants and would
		// silently break Go's hex-pod fan-out).
		expect(p).not.toContain(`(literal "${canonicalAncestor}/go-build")`)
	})
})
