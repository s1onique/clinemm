/**
 * ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
 *
 * Profile SNAPSHOT generator for the live-kernel evidence scripts.
 *
 * This test drives the REAL production backend
 * (`SeatbeltSandboxBackendExperimental.prepare()`, imported through the
 * apps/vscode `@cline/core` stub, which re-exports the real SDK
 * source) and writes the generated SBPL to disk so the standalone
 * evidence scripts can launch `/usr/bin/sandbox-exec` against the EXACT
 * bytes production would emit.
 *
 * It runs under Vitest (not Bun) so that Node's `realpathSync` is used
 * for the AF_UNIX host-helper socket — Bun returns EOPNOTSUPP for a
 * socket inode on this filesystem, which is a Bun limitation and NOT a
 * production behaviour (the production extension host is Node).
 *
 * OPT-IN CONTRACT
 * ----------------
 * This file is an EVIDENCE-EMISSION helper, not a behavioural test.
 * It writes files to disk and therefore only runs when the operator
 * explicitly opts in by setting `ACT_POSIX_SEM_PROFILE_OUT`.
 *
 *   - `ACT_POSIX_SEM_PROFILE_OUT` UNSET  -> the emitting test is SKIPPED.
 *     An ordinary `vitest run` (which does not set the variable) must
 *     therefore neither fail nor write anything. This is asserted by
 *     the companion "default (unopted-in) behaviour" test below.
 *   - `ACT_POSIX_SEM_PROFILE_OUT` SET    -> the emitting test runs and
 *     writes `production-profile-deny.sb` and `production-profile-allow.sb`
 *     into that directory.
 *
 * Usage:
 *   ACT_POSIX_SEM_PROFILE_OUT=/tmp/somewhere \
 *     vitest run --config vitest.config.ts \
 *       src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SeatbeltSandboxBackendExperimental } from "@cline/core"
import { describe, expect, it } from "vitest"

/**
 * The output directory, or `undefined` when the operator has not opted
 * in. Read AT MODULE LOAD so that the "opted in" state is decided once
 * and does not change between the two tests below.
 */
const PROFILE_OUT = process.env.ACT_POSIX_SEM_PROFILE_OUT

describe("ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01: production profile snapshot", () => {
	it.skipIf(!PROFILE_OUT)("writes the network:deny and network:allow production profiles (opt-in only)", async () => {
		const outDir = PROFILE_OUT as string
		mkdirSync(outDir, { recursive: true })
		mkdirSync(join(outDir, "tmp"), { recursive: true })

		for (const network of ["deny", "allow"] as const) {
			const prepared = await SeatbeltSandboxBackendExperimental.prepare({
				capability: {
					readonlyRoots: [],
					writableRoots: [outDir],
					tempRoot: join(outDir, "tmp"),
					network,
					environment: { mode: "sanitized", allow: [] },
					cwd: outDir,
				},
				command: {
					executable: process.execPath,
					args: ["-c", "true"],
					cwd: outDir,
					env: {},
				},
			})
			const profilePath = prepared.args[1] as string
			const profile = readFileSync(profilePath, "utf8")
			const outPath = join(outDir, `production-profile-${network}.sb`)
			writeFileSync(outPath, profile)
			console.log(`PROFILE_${network.toUpperCase()}_PATH=${outPath}`)
			console.log(`PROFILE_${network.toUpperCase()}_SEM_RULE_COUNT=${profile.split("(allow ipc-posix-sem)").length - 1}`)
			console.log(
				`PROFILE_${network.toUpperCase()}_NETWORK_RULE=${profile.match(/^\((allow|deny) network\*\)$/m)?.[0] ?? "NONE"}`,
			)
			await prepared.cleanup?.()
		}

		// The emitted profiles must carry the repaired rule.
		const deny = readFileSync(join(outDir, "production-profile-deny.sb"), "utf8")
		const allow = readFileSync(join(outDir, "production-profile-allow.sb"), "utf8")
		expect(deny.split("(allow ipc-posix-sem)").length - 1).toBe(1)
		expect(allow.split("(allow ipc-posix-sem)").length - 1).toBe(1)
		expect(deny).toContain("(deny network*)")
		expect(allow).toContain("(allow network*)")
	})

	it("default (unopted-in) behaviour: the emitting test is skipped and nothing is written", () => {
		// When the operator has NOT opted in, the emitting test above is
		// skipped. This test pins that contract so an ordinary
		// `vitest run` can never fail because of the missing env var.
		if (PROFILE_OUT) {
			// Opted in: the emitting test runs instead. Nothing to assert
			// about the skipped path here.
			expect(PROFILE_OUT).toBeTruthy()
			return
		}
		expect(PROFILE_OUT).toBeUndefined()
		// No output directory was requested, so the helper must not have
		// written any profile into the repository.
		const repoProfiles = join(process.cwd(), "src/sdk/__tests__/production-profile-deny.sb")
		expect(existsSync(repoProfiles)).toBe(false)
	})
})
