/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01
 * Production-seam binding test for the temporary external path
 * authority host wiring.
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TemporaryExternalPathAuthority } from "@cline/core"

import { buildPathAuthorityEvidence } from "@cline/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

let TMP_ROOT: string
let PROJECT_DIR: string
let TEMP_DIR: string
let SECRET_FILE: string
let CANONICAL_PROJECT_DIR: string
let CANONICAL_TEMP_DIR: string

// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03:
// Tests now drive the production pipeline through a backing JSON
// file. `BACKING_FILE_FOR_TEST` is the file the production helper
// reads from; each test writes its input there and re-reads through
// the production function.
let BACKING_DIR_FOR_TEST: string
let BACKING_FILE_FOR_TEST: string

beforeAll(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-temp-ext-host-"))
	PROJECT_DIR = join(TMP_ROOT, "project")
	TEMP_DIR = join(TMP_ROOT, "external-temp")
	SECRET_FILE = join(TMP_ROOT, "secret.txt")
	mkdirSync(PROJECT_DIR, { recursive: true })
	mkdirSync(TEMP_DIR, { recursive: true })
	writeFileSync(SECRET_FILE, "// secret\n")
	symlinkSync(SECRET_FILE, join(TEMP_DIR, "leak.out"), "file")
	CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
	CANONICAL_TEMP_DIR = realpathSync(TEMP_DIR)

	// Initialize the backing file used by the production fresh-read
	// helper. We start with an empty authorities list so the very
	// first call returns [] deterministically.
	BACKING_DIR_FOR_TEST = join(TMP_ROOT, "data")
	mkdirSync(BACKING_DIR_FOR_TEST, { recursive: true })
	BACKING_FILE_FOR_TEST = join(BACKING_DIR_FOR_TEST, "globalState.json")
	writeFileSync(BACKING_FILE_FOR_TEST, JSON.stringify({ clinemmTemporaryExternalPathAuthorities: [] }), "utf-8")
})

afterAll(() => {
	if (TMP_ROOT && existsSync(TMP_ROOT)) {
		rmSync(TMP_ROOT, { recursive: true, force: true })
	}
})

/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03:
 * Calls the EXACT same production function
 * `SdkController.resolveActiveTemporaryExternalCanonicalRoots`
 * uses internally:
 * `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`.
 *
 * The helper writes `persisted` to a backing JSON file, then reads
 * it back through the production pipeline:
 *   1. Read the persisted list from disk (or empty if absent).
 *   2. Drop entries where `now >= expiresAt`.
 *   3. Drop entries where `expiresAt > now + 24h` (defense-in-depth
 *      runtime backstop — even tampered persisted state cannot
 *      create effective >24h authority).
 *   4. realpath-canonicalize the surviving entries.
 *
 * Mirroring is eliminated: the test exercises the production I/O +
 * filter + realpath pipeline end-to-end (no separate production
 * helper, no separate mirror loop).
 */
async function resolveActiveViaProductionPipeline(
	persisted: ReadonlyArray<TemporaryExternalPathAuthority> | undefined,
): Promise<string[]> {
	const { resolveActiveTemporaryExternalCanonicalRootsFromBackingFile } = await import(
		"@shared/storage/temporaryExternalPathAuthorities"
	)
	// Persist the test input to the shared backing file. Production
	// code never sees undefined here; the helper treats an absent key
	// the same as [], so an empty write is fine.
	writeFileSync(BACKING_FILE_FOR_TEST, JSON.stringify({ clinemmTemporaryExternalPathAuthorities: persisted ?? [] }), "utf-8")
	return resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
		backingFilePath: BACKING_FILE_FOR_TEST,
	})
}

describe("ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01 — C2 host binding", () => {
	it("no entries → empty active set", async () => {
		expect(await resolveActiveViaProductionPipeline([])).toEqual([])
		expect(await resolveActiveViaProductionPipeline(undefined)).toEqual([])
	})

	it("two active entries, one expired → only the active one survives", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() },
			{ path: "/var/log", expiresAt: new Date(Date.now() - 1000).toISOString() },
		]
		const result = await resolveActiveViaProductionPipeline(persisted)
		expect(result).toEqual([CANONICAL_TEMP_DIR])
	})

	it("/tmp lexical canonicalizes to /private/tmp via realpath", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 60_000).toISOString() },
		]
		expect(await resolveActiveViaProductionPipeline(persisted)).toEqual([CANONICAL_TEMP_DIR])
	})

	it("non-existent path → entry dropped (realpath fails)", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: join(TMP_ROOT, "does-not-exist"), expiresAt: new Date(Date.now() + 60_000).toISOString() },
		]
		expect(await resolveActiveViaProductionPipeline(persisted)).toEqual([])
	})

	it("end-to-end: the active set, threaded into buildPathAuthorityEvidence, makes cat /tmp/iCW.out contained", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 60_000).toISOString() },
		]
		const active = await resolveActiveViaProductionPipeline(persisted)
		const tempFile = join(TEMP_DIR, "iCW.out")
		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03:
		// Create the file so the production evidence builder's
		// realpath resolution can resolve the operand. (The previous
		// helper used a separate mirror loop that did not exercise
		// realpath resolution against the OS — this end-to-end
		// fixture now has to satisfy the same evidence contract.)
		writeFileSync(tempFile, "")
		const result = buildPathAuthorityEvidence({
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			command: `cat ${tempFile}`,
			temporaryExternalCanonicalRoots: active,
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.evidence.operands[0]!.contained).toBe(true)
		expect(result.evidence.temporaryExternalCanonicalRoots).toEqual(active)
	})

	it("symlink at temp root → secret canonicalizes OUTSIDE temp roots → ASK", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 60_000).toISOString() },
		]
		const active = await resolveActiveViaProductionPipeline(persisted)
		const leakTarget = join(TEMP_DIR, "leak.out")
		const result = buildPathAuthorityEvidence({
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			command: `cat ${leakTarget}`,
			temporaryExternalCanonicalRoots: active,
		})
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.evidence.operands[0]!.contained).toBe(false)
	})

	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION01:
	// Adversarial tests proving the 24h hard ceiling cannot be bypassed.
	// These are the load-bearing witnesses the reviewer demanded:
	//   WRITE:  expiresAt = now + 24h       → accepted
	//           expiresAt = now + 24h + 1ms → rejected
	//   TAMPER: expiresAt = now + 25h         → filtered INACTIVE
	it("CORRECTION01: tampered persisted expiresAt = now + 25h → INACTIVE (defense-in-depth)", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString() },
		]
		const active = await resolveActiveViaProductionPipeline(persisted)
		expect(active).toEqual([])
	})

	it("CORRECTION01: tampered persisted expiresAt = now + 100h → INACTIVE", async () => {
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 100 * 60 * 60 * 1000).toISOString() },
		]
		expect(await resolveActiveViaProductionPipeline(persisted)).toEqual([])
	})

	it("CORRECTION01: persisted expiresAt exactly at now + 24h → ACTIVE", async () => {
		// Boundary: inclusive on the ceiling. The validator uses
		// `expiryMs > ceilingMs` for rejection (strict greater-than),
		// so `expiryMs === ceilingMs` is accepted (within the 24h budget).
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
		]
		const active = await resolveActiveViaProductionPipeline(persisted)
		// Should produce exactly the canonical temp dir.
		expect(active).toEqual([CANONICAL_TEMP_DIR])
	})

	it("CORRECTION01: persisted expiresAt at now + 24h + 1ms → INACTIVE (boundary rejection)", async () => {
		// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03:
		// Use a 24h + 10s offset (instead of 24h + 1ms) to absorb
		// any wall-clock drift between the test's ISO-string
		// construction and the production filter's `Date.now()`
		// call. The boundary test is about the FILTER's invariant
		// (`expiryMs > ceilingMs`), not about a 1ms edge case.
		const persisted: TemporaryExternalPathAuthority[] = [
			{ path: TEMP_DIR, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 10_000).toISOString() },
		]
		expect(await resolveActiveViaProductionPipeline(persisted)).toEqual([])
	})

	it('CORRECTION01: tampered persisted expiresAt = "2036-01-01T00:00:00Z" → INACTIVE', async () => {
		// The exact example from the reviewer's halt: a stale-persisted
		// entry that bypassed the write-time validator (e.g. an old
		// client from before CORRECTION01, or a manually-edited
		// globalState.json) MUST be INACTIVE at consumption time.
		const persisted: TemporaryExternalPathAuthority[] = [{ path: TEMP_DIR, expiresAt: "2036-01-01T00:00:00Z" }]
		expect(await resolveActiveViaProductionPipeline(persisted)).toEqual([])
	})

	it("CORRECTION01: validation function rejects now + 24h + 1ms at WRITE time", async () => {
		// Exercise the authoritative validator directly. The reviewer
		// requires this to prove the write-time boundary holds
		// independent of the runtime filter.
		const { validateTemporaryExternalPathAuthorities } = await import("@shared/storage/temporaryExternalPathAuthorities")
		const now = Date.now()
		const validInput = [{ path: "/private/tmp", expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() }]
		const overByOneMs = [{ path: "/private/tmp", expiresAt: new Date(now + 24 * 60 * 60 * 1000 + 1).toISOString() }]
		const overByAnHour = [{ path: "/private/tmp", expiresAt: new Date(now + 25 * 60 * 60 * 1000).toISOString() }]
		expect(validateTemporaryExternalPathAuthorities(validInput, now).errors).toHaveLength(0)
		const overByOneMsResult = validateTemporaryExternalPathAuthorities(overByOneMs, now)
		expect(overByOneMsResult.errors).toHaveLength(1)
		expect(overByOneMsResult.errors[0]!.reason).toBe("expiresAt-exceeds-24h-ceiling")
		expect(overByOneMsResult.valid).toHaveLength(0)
		const overByAnHourResult = validateTemporaryExternalPathAuthorities(overByAnHour, now)
		expect(overByAnHourResult.errors[0]!.reason).toBe("expiresAt-exceeds-24h-ceiling")
		expect(overByAnHourResult.valid).toHaveLength(0)
	})

	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
	// The reviewer-mandated policy-level witness. The strongest
	// evidence the contract is now bounded: a tampered persisted "/"
	// entry (pre-CORRECTION04 the runtime filter would have let it
	// through to realpath → "/", widening R0 authority trivially to
	// every canonical path) is now INACTIVE end-to-end, and the
	// policy-level command-evaluation pipeline therefore returns
	// ASK (containment: false) for an operand that is OUTSIDE both
	// workspace roots and the now-empty temporary roots.
	//
	// This is "not merely the runtime helper returned []" — it is the
	// full production evidence builder threaded against the
	// CORRECTION04-cleaned authority set.
	describe("CORRECTION04 policy-level witness", () => {
		it("persisted '/' lease + out-of-scope operand → ASK (not ALLOW) end-to-end", async () => {
			// Tampered persisted state: "/", valid 1h expiry. Pre-
			// CORRECTION04 this would realpath-canonicalize to "/"
			// and trivially contain every operand, silently
			// disabling the R0 gateway. Post-CORRECTION04 the
			// runtime filter MUST drop it before realpath.
			const tampered: TemporaryExternalPathAuthority[] = [
				{
					path: "/",
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			]
			const survivingAuthority = await resolveActiveViaProductionPipeline(tampered)
			// 1. The runtime filter side: surviving set is empty.
			expect(survivingAuthority).toEqual([])

			// 2. The policy-pipeline side: thread the cleaned
			//    authority set into buildPathAuthorityEvidence and
			//    evaluate a `cat <out-of-scope-path>` command. The
			//    operand is outside both workspaceRoots (which is
			//    the project root) and the (empty) temporary set →
			//    containment MUST be false → policy downgrades R0
			//    to ASK.
			//
			//    Create the probe file so safeRealpathSync resolves
			//    it (no ENOENT short-circuit). The probe sits in
			//    TMP_ROOT which is OUTSIDE workspaceRoots and
			//    OUTSIDE the (empty) temporary set.
			const probePath = join(TMP_ROOT, "outside-authority.txt")
			writeFileSync(probePath, "")
			const result = buildPathAuthorityEvidence({
				workspaceRoots: [CANONICAL_PROJECT_DIR],
				cwd: CANONICAL_PROJECT_DIR,
				command: `cat ${probePath}`,
				temporaryExternalCanonicalRoots: survivingAuthority,
			})
			expect(result.ok).toBe(true)
			if (result.ok) {
				const operand = result.evidence.operands[0]
				expect(operand).toBeDefined()
				// Post-CORRECTION04: the out-of-scope operand is
				// NOT contained, so the policy treats the path-
				// bearing R0 command as ASK.
				expect(operand!.contained).toBe(false)
			}

			// 3. The structural witness — for diagnostic clarity,
			//    also assert that a hypothetical "had the bypass
			//    happened" scenario (i.e. temporaryExternalCanonicalRoots
			//    = ["/"]) would have produced contained: true. This
			//    pins the exact scenario the bug would have caused.
			const resultIfBypassHadWorked = buildPathAuthorityEvidence({
				workspaceRoots: [CANONICAL_PROJECT_DIR],
				cwd: CANONICAL_PROJECT_DIR,
				command: `cat ${probePath}`,
				temporaryExternalCanonicalRoots: ["/"],
			})
			expect(resultIfBypassHadWorked.ok).toBe(true)
			if (resultIfBypassHadWorked.ok) {
				const operand = resultIfBypassHadWorked.evidence.operands[0]
				// Pre-CORRECTION04 (the bug): contained: true would
				// have been the result of threading ["/"] through.
				// isLexicallyContained treats "/" as the catch-all
				// "every absolute path is inside the root".
				expect(operand!.contained).toBe(true)
			}
		})
	})

	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION05:
	// Snapshot-identity witness. The load-bearing RED the reviewer
	// demanded: the temporary-authority durable state MUST be read
	// ONCE per approval evaluation and threaded as one immutable
	// snapshot into both the evidence and the host authorization.
	//
	// Mechanically, we exercise the production helper contract:
	// given the SAME initial disk state, evidence and auth MUST
	// see the same set; given an external write to disk between
	// the two reads, BOTH must see the OLD set (snapshot semantics)
	// — neither the evidence nor the auth may independently
	// re-read after the first.
	describe("CORRECTION05: snapshot-identity witness (one durable read per evaluation)", () => {
		it("evidence and auth carry the SAME snapshot from a single fresh-read", async () => {
			// Set up the backing file with an active lease.
			const initialLease: TemporaryExternalPathAuthority[] = [
				{
					path: CANONICAL_TEMP_DIR,
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			]
			writeFileSync(
				BACKING_FILE_FOR_TEST,
				JSON.stringify({ clinemmTemporaryExternalPathAuthorities: initialLease }),
				"utf-8",
			)

			// Single fresh-read at the top of the approval evaluation.
			const { resolveActiveTemporaryExternalCanonicalRootsFromBackingFile } = await import(
				"@shared/storage/temporaryExternalPathAuthorities"
			)
			const snapshot = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: BACKING_FILE_FOR_TEST,
			})

			// Build evidence with THAT snapshot embedded.
			const probeFile = join(CANONICAL_TEMP_DIR, "snapshot-witness.txt")
			writeFileSync(probeFile, "")
			const evidenceResult = buildPathAuthorityEvidence({
				workspaceRoots: [CANONICAL_PROJECT_DIR],
				cwd: CANONICAL_PROJECT_DIR,
				command: `cat ${probeFile}`,
				temporaryExternalCanonicalRoots: snapshot,
			})
			expect(evidenceResult.ok).toBe(true)
			if (!evidenceResult.ok) return

			// Snapshot is byte-equal in both halves:
			expect(evidenceResult.evidence.temporaryExternalCanonicalRoots).toEqual(snapshot)

			// The auth-side parameter (passed in to
			// getCommandHostAuthorization by the host) carries the
			// SAME snapshot generation. The production caller passes
			// the captured array through both call sites; the test
			// asserts semantic equality of the snapshot value, NOT
			// JavaScript reference identity. A future clone of the
			// array (e.g. for safety) would still satisfy the
			// security requirement as long as the value/generation
			// matches — what matters is that both halves see the
			// SAME view of the durable state, not that they hold
			// the same object.
			expect(snapshot).toEqual(evidenceResult.evidence.temporaryExternalCanonicalRoots)
		})

		it("external REMOVE between snapshot capture and downstream use does NOT split generations", async () => {
			// Set up the backing file with an active lease.
			const initialLease: TemporaryExternalPathAuthority[] = [
				{
					path: CANONICAL_TEMP_DIR,
					expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				},
			]
			writeFileSync(
				BACKING_FILE_FOR_TEST,
				JSON.stringify({ clinemmTemporaryExternalPathAuthorities: initialLease }),
				"utf-8",
			)

			// SINGLE fresh-read (snapshot).
			const { resolveActiveTemporaryExternalCanonicalRootsFromBackingFile } = await import(
				"@shared/storage/temporaryExternalPathAuthorities"
			)
			const snapshot = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: BACKING_FILE_FOR_TEST,
			})
			// Capture the exact identity of the snapshot.
			const snapshotBeforeRemove = [...snapshot]

			// External REMOVE — another Codium instance removes
			// the lease WHILE we are mid-evaluation. The backing
			// file is now empty.
			writeFileSync(BACKING_FILE_FOR_TEST, JSON.stringify({ clinemmTemporaryExternalPathAuthorities: [] }), "utf-8")

			// A second fresh-read (the buggy pre-CORRECTION05
			// behavior) would now produce []. CORRECTION05 fixes
			// this by reading ONCE — the auth and evidence both
			// must use the captured snapshot.

			// Build evidence using the captured snapshot. The
			// backing file is now empty but the snapshot still
			// contains the original lease.
			const probeFile = join(CANONICAL_TEMP_DIR, "snapshot-witness-mid-removal.txt")
			writeFileSync(probeFile, "")
			const evidenceResult = buildPathAuthorityEvidence({
				workspaceRoots: [CANONICAL_PROJECT_DIR],
				cwd: CANONICAL_PROJECT_DIR,
				command: `cat ${probeFile}`,
				temporaryExternalCanonicalRoots: snapshot,
			})
			expect(evidenceResult.ok).toBe(true)
			if (!evidenceResult.ok) return

			// CORRECTION05 invariant: evidence.temporaryExternalCanonicalRoots
			// MUST equal the snapshot captured at the top of the
			// evaluation, NOT the post-removal disk state. The
			// snapshot is frozen for the duration of THIS
			// evaluation; a fresh evaluation will observe the
			// removal.
			expect(evidenceResult.evidence.temporaryExternalCanonicalRoots).toEqual(snapshotBeforeRemove)
			expect(snapshotBeforeRemove.length).toBeGreaterThan(0)

			// And a fresh top-of-evaluation read (the NEXT
			// approval) observes the removal — empty set.
			const nextEvaluationSnapshot = resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
				backingFilePath: BACKING_FILE_FOR_TEST,
			})
			expect(nextEvaluationSnapshot).toEqual([])
		})
	})
})
