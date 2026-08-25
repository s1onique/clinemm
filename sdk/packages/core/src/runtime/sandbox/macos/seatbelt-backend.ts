/**
 * SeatbeltSandboxBackendExperimental — the experimental macOS Seatbelt
 * (`/usr/bin/sandbox-exec`) backend.
 *
 * ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01.
 *
 * Behavior summary:
 *
 *  - `id` is `"seatbelt-experimental"`.
 *  - `isAvailable()` runs the cached availability probe (darwin +
 *    binary present + minimal `(version 1) (allow default)` profile
 *    round-trips successfully).
 *  - `prepare()`:
 *      1. Canonicalizes every path in the capability.
 *      2. Generates an SBPL profile.
 *      3. Allocates a sandbox-private temp dir (separate from the
 *         capability's `tempRoot`) and writes the profile there.
 *      4. Materializes the environment record from the capability
 *         using {@link materializeEnvironment}.
 *      5. Returns a `SandboxPreparedInvocation` whose `executable`
 *         is `/usr/bin/sandbox-exec` and whose `args` is prefixed
 *         with `["-f", <profile-path>]`.
 *      6. Returns a `cleanup` hook that best-effort removes the
 *         profile temp dir. Cleanup failures NEVER affect the
 *         command's exit classification.
 *
 * On any failure (canonicalize, profile generation, profile write,
 * launch prepare) we throw a {@link SandboxError}. The executor
 * MUST treat thrown errors as fail-closed.
 *
 * This backend is EXPERIMENTAL_UNSUPPORTED_INTERFACE per Apple's
 * posture — see recon evidence `final-assessment.md`.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { canonicalizeSandboxRoot } from "../canonical-paths";
import { materializeEnvironment, getEnvironmentSemantics } from "../environment";
import {
	SANDBOX_EXEC_PATH,
	probeSeatbeltAvailability,
} from "./seatbelt-availability";
import { generateSeatbeltProfile } from "./seatbelt-profile";
import type {
	CommandCapability,
	CommandInvocation,
	SandboxBackend,
	SandboxPreparedInvocation,
} from "../types";
import { SandboxError } from "../types";

/**
 * Stable identifier. Surfaced in logs and in the `backendId` field
 * of every prepared invocation.
 */
export const SEATBELT_BACKEND_ID = "seatbelt-experimental" as const;

/**
 * Subdirectory prefix under the system temp dir for profile temp
 * files. Distinct from the capability's `tempRoot` so that the
 * capability-private writable area cannot accidentally expose the
 * profile (and therefore the full capability shape, which may be
 * sensitive in dogfood) to the child.
 */
const PROFILE_TEMP_DIR_PREFIX = "clinemm-sandbox-profile-";

/**
 * ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01.
 *
 * Subdirectory prefix under the system temp dir for the SYNTHESIZED
 * per-invocation writable temp root. Distinct from
 * `PROFILE_TEMP_DIR_PREFIX` so profile cleanup and temp-root cleanup
 * cannot be confused. The synthesized root becomes the child command's
 * `TMPDIR` and is granted as a single `(subpath "...")` write rule.
 */
const SYNTHESIZED_TEMP_DIR_PREFIX = "clinemm-sandbox-temp-";

/**
 * Best-effort cleanup of a directory. Used for the profile temp dir.
 * Errors are swallowed because cleanup MUST NOT alter the command's
 * exit classification.
 */
function bestEffortRm(path: string): void {
	try {
		rmSync(path, { recursive: true, force: true });
	} catch {
		// Swallow: cleanup failures are non-fatal.
	}
}

/**
 * The single, lazily-constructed `SeatbeltSandboxBackendExperimental`
 * instance.
 *
 * Stateless and immutable: can be reused across calls.
 */
export const SeatbeltSandboxBackendExperimental: SandboxBackend =
	Object.freeze({
		id: SEATBELT_BACKEND_ID,

		async isAvailable(): Promise<boolean> {
			return probeSeatbeltAvailability();
		},

		async prepare(input: {
			readonly capability: CommandCapability;
			readonly command: CommandInvocation;
		}): Promise<SandboxPreparedInvocation> {
			const cmd = input.command;
			const cap = input.capability;

			// 1) Canonicalize every path. Fail-closed: any canonicalize
			//    failure throws SandboxError and we do NOT proceed.
			let cwd: string;
			try {
				cwd = cap.cwd ? canonicalizeSandboxRoot(cap.cwd) : cmd.cwd;
			} catch (cause) {
				throw new SandboxError(
					`Seatbelt: failed to canonicalize capability.cwd=${cap.cwd}`,
					{
						backendId: SEATBELT_BACKEND_ID,
						reason: "canonicalization-failed",
						cause,
					},
				);
			}

			// CORRECTION01 (P0-1): readonlyRoots is now load-bearing.
			// We MUST canonicalize it exactly the same way as writableRoots
			// because the profile generator embeds these strings into SBPL
			// as positive `(subpath ...)` allow rules. The kernel matches
			// against the resolved vnode path, so an un-canonicalized
			// readonlyRoot would silently fail to match its real inode.
			const readonlyRoots: string[] = [];
			for (const p of cap.readonlyRoots) {
				try {
					readonlyRoots.push(canonicalizeSandboxRoot(p));
				} catch (cause) {
					throw new SandboxError(
						`Seatbelt: failed to canonicalize readonlyRoot=${p}`,
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
							cause,
						},
					);
				}
			}

			const writableRoots: string[] = [];
			for (const p of cap.writableRoots) {
				try {
					writableRoots.push(canonicalizeSandboxRoot(p));
				} catch (cause) {
					throw new SandboxError(
						`Seatbelt: failed to canonicalize writableRoot=${p}`,
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
							cause,
						},
					);
				}
			}

			// Wave-1 outside-read containment: the capability may carry
			// an explicit list of "outside" subpaths to deny. We pass
			// them through to the profile generator as-is (after
			// canonicalization, which is enforced by the type via the
			// `capability.denyReadSubpaths` field). This mirrors the
			// recon's production-shape-recommended.sb pattern:
			//
			//   (allow file-read*)
			//   (deny file-read* (subpath "<outside-1>"))
			//   (deny file-read* (subpath "<outside-2>"))
			//
			// We intentionally do NOT auto-derive the deny list from
			// cwd's parent: doing so would deny reads of cwd itself
			// (since cwd is a descendant of the parent), which breaks
			// benign workspace reads. The caller is responsible for
			// naming the specific sibling directories to deny.
			const denyReadSubpaths: string[] = [];
			for (const p of cap.denyReadSubpaths ?? []) {
				try {
					denyReadSubpaths.push(canonicalizeSandboxRoot(p));
				} catch (cause) {
					throw new SandboxError(
						`Seatbelt: failed to canonicalize denyReadSubpath=${p}`,
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
							cause,
						},
					);
				}
			}

			let tempRoot: string | undefined;
			let synthesizedTempRoot: string | undefined;
			if (cap.tempRoot) {
				try {
					tempRoot = canonicalizeSandboxRoot(cap.tempRoot);
				} catch (cause) {
					throw new SandboxError(
						`Seatbelt: failed to canonicalize tempRoot=${cap.tempRoot}`,
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
							cause,
						},
					);
				}
			} else {
				// ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01:
				// honor the contract in types.ts (line 113) — when the
				// caller omits `tempRoot`, the backend synthesizes one
				// under the system temp root (per-invocation, unique).
				// The profile emits `(allow file-write* (subpath "<canonical>"))`
				// for it (via `tempRoot`), and `materializeEnvironment`
				// sets TMPDIR to the canonical path so child tools like
				// `mktemp` resolve to the writable root. Cleanup removes
				// the synthesized root best-effort.
				try {
					synthesizedTempRoot = mkdtempSync(
						join(tmpdir(), SYNTHESIZED_TEMP_DIR_PREFIX),
					);
				} catch (cause) {
					throw new SandboxError(
						"SandboxError: failed to synthesize per-invocation temp root",
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "profile-write-failed",
							cause,
						},
					);
				}
				try {
					tempRoot = canonicalizeSandboxRoot(synthesizedTempRoot);
				} catch (cause) {
					bestEffortRm(synthesizedTempRoot);
					throw new SandboxError(
						"SandboxError: failed to canonicalize synthesized temp root",
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
							cause,
						},
					);
				}
			}

			// 2) Generate the SBPL profile.
			const profile = generateSeatbeltProfile(
				{
					...cap,
					readonlyRoots,
					writableRoots,
					tempRoot,
					cwd,
				},
				{ denyReadSubpaths },
			);

			// 3) Allocate a sandbox-private temp dir for the profile
			//    file. Distinct from `tempRoot`.
			let profileDir: string;
			try {
				profileDir = mkdtempSync(
					join(tmpdir(), PROFILE_TEMP_DIR_PREFIX),
				);
			} catch (cause) {
				throw new SandboxError(
					"Seatbelt: failed to create profile temp dir",
					{
						backendId: SEATBELT_BACKEND_ID,
						reason: "profile-write-failed",
						cause,
					},
				);
			}
			const profilePath = join(
				profileDir,
				`profile-${randomBytes(6).toString("hex")}.sb`,
			);

			try {
				writeFileSync(profilePath, profile, { mode: 0o600 });
			} catch (cause) {
				bestEffortRm(profileDir);
				throw new SandboxError(
					`Seatbelt: failed to write profile to ${profilePath}`,
					{
						backendId: SEATBELT_BACKEND_ID,
						reason: "profile-write-failed",
						cause,
					},
				);
			}

			// 4) Materialize the environment.
			const materialized = materializeEnvironment(cap.environment, {
				parentEnv: process.env,
				// Synthetic TMPDIR is only set when the capability
				// provides a tempRoot. Synthetic HOME is intentionally
				// omitted in Wave-1 — see recon final-assessment.md
				// ("this changes behavior; dogfood separately").
				syntheticTempDir: tempRoot,
			});

			// 5) Build the prepared invocation: sandbox-exec -f
			//    <profile> <original-executable> <original-args...>.
			return {
				executable: SANDBOX_EXEC_PATH,
				args: ["-f", profilePath, cmd.executable, ...cmd.args],
				cwd,
				env: materialized,
				input: cmd.input,
				backendId: SEATBELT_BACKEND_ID,
				// CORRECTION01-P1: envSemantics is the typed metadata
				// the executor reads to decide whether to spread
				// process.env underneath env ("overlay") or to use env
				// AS-IS ("complete"). The capability's mode determines
				// the value; see environment.ts getEnvironmentSemantics
				// and types.ts EnvironmentSemantics.
				envSemantics: getEnvironmentSemantics(cap.environment),
				cleanup: async () => {
					bestEffortRm(profileDir);
					// ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01:
					// best-effort remove the per-invocation synthesized
					// temp root if we created one. A caller-supplied
					// tempRoot is the caller's responsibility and is
					// NOT touched here (we only canonicalized the
					// caller-supplied path; we never allocated it).
					if (synthesizedTempRoot) {
						bestEffortRm(synthesizedTempRoot);
					}
				},
			};
		},
	});

