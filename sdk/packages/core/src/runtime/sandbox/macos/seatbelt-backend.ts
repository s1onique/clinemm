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

			// ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2:
			// Canonicalize `createOnlyRoots` exactly like the other
			// path-bearing capability fields. Each root is passed
			// through the same `canonicalizeSandboxRoot` so an
			// attacker who supplies `/var/folders/...` and the kernel
			// canonicalizes to `/private/var/folders/...` cannot
			// escape via path mismatch (Seatbelt subpath matching is
			// vnode-level; un-canonicalized paths may not match).
			//
			// Fail-closed: any canonicalize failure (ENOENT / EACCES /
			// ELOOP / non-string / empty) is a SandboxError. The
			// caller (CommandJobManager) catches this and converts to
			// `spawn_failed` with reason=`canonicalization-failed`;
			// ZERO commands execute.
			const createOnlyRoots: string[] = [];
			for (const p of cap.createOnlyRoots ?? []) {
				try {
					createOnlyRoots.push(canonicalizeSandboxRoot(p));
				} catch (cause) {
					throw new SandboxError(
						`Seatbelt: failed to canonicalize createOnlyRoot=${p}`,
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

			// ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01-CORRECTION01:
			// Wrap the post-allocation preparation (steps 2-4) in a
			// single try/catch so that ANY failure between successful
			// temp-root synthesis and the successful return cleans up
			// BOTH the synthesized temp root AND the profile temp dir
			// before propagating the SandboxError. Without this wrap,
			// a failure in profile generation, profile-dir creation,
			// profile writing, or env materialization would leak the
			// synthesized temp root.
			//
			// Caller-supplied tempRoot is the caller's responsibility
			// and is NEVER touched here. The synthesizedTempRoot we
			// allocated in this prepare() call IS our responsibility
			// and IS cleaned here.
			let profileDir: string | undefined;
			let profilePath: string | undefined;
			let materialized: ReturnType<typeof materializeEnvironment> | undefined;

			// ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01:
			// Resolve ssh-agent authority for the agent case.
			//
			// When `sshAuthenticationAuthority.mode === "agent"`:
			//   1. Take the canonical socket path. Either the capability
			//      provides one (already canonicalized per the contract),
			//      or we derive it from `process.env.SSH_AUTH_SOCK`.
			//   2. Canonicalize it via `canonicalizeSandboxRoot`. Fail-closed
			//      on absent/empty/invalid — no unsandboxed fallback.
			//   3. Reintroduce `SSH_AUTH_SOCK` into the sanitized env by
			//      adding it to `cap.environment.allow`. The allow path
			//      (step 3 of `materializeEnvironment`) wins over the
			//      blocklist-empty step (step 4) — `SECRET_BLOCKLIST`
			//      is unchanged.
			//
			// When the field is omitted or `mode: "deny"`, this block
			// is a no-op: no agent SBPL rule is emitted and
			// `SSH_AUTH_SOCK` is NOT reintroduced.
			let sshAgentCanonicalSocketPath: string | undefined;
			let effectiveEnvironmentCapability = cap.environment;
			const auth = cap.sshAuthenticationAuthority;
			if (auth?.mode === "agent") {
				let raw: string | undefined;
				if (typeof auth.socketPath === "string" && auth.socketPath.length > 0) {
					raw = auth.socketPath;
				} else {
					raw = process.env.SSH_AUTH_SOCK;
				}
				if (typeof raw !== "string" || raw.length === 0) {
					throw new SandboxError(
						"Seatbelt: sshAuthenticationAuthority.mode='agent' requires SSH_AUTH_SOCK to be set in the parent env or cap.sshAuthenticationAuthority.socketPath to be provided",
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
						},
					);
				}
				try {
					sshAgentCanonicalSocketPath = canonicalizeSandboxRoot(raw);
				} catch (cause) {
					throw new SandboxError(
						`Seatbelt: failed to canonicalize SSH_AUTH_SOCK=${JSON.stringify(raw)}`,
						{
							backendId: SEATBELT_BACKEND_ID,
							reason: "canonicalization-failed",
							cause,
						},
					);
				}
				// Reintroduce SSH_AUTH_SOCK via the existing allow-list
				// path. Step 3 of materializeEnvironment wins over the
				// step-4 blocklist-empty fallback (SECRET_BLOCKLIST is
				// preserved unchanged).
				if (
					cap.environment.mode === "sanitized" &&
					!cap.environment.allow.includes("SSH_AUTH_SOCK")
				) {
					effectiveEnvironmentCapability = {
						mode: "sanitized",
						allow: [...cap.environment.allow, "SSH_AUTH_SOCK"],
					};
				}
			}

			try {
				// 2) Generate the SBPL profile.
				const profile = generateSeatbeltProfile(
					{
						...cap,
						readonlyRoots,
						writableRoots,
						tempRoot,
						createOnlyRoots,
						cwd,
					},
					{
						denyReadSubpaths,
						sshAgentCanonicalSocketPath,
					},
				);

				// 3) Allocate a sandbox-private temp dir for the profile
				//    file. Distinct from `tempRoot`.
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
				profilePath = join(
					profileDir,
					`profile-${randomBytes(6).toString("hex")}.sb`,
				);

				try {
					writeFileSync(profilePath, profile, { mode: 0o600 });
				} catch (cause) {
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
				materialized = materializeEnvironment(effectiveEnvironmentCapability, {
					parentEnv: process.env,
					// Synthetic TMPDIR is only set when the capability
					// provides a tempRoot. Synthetic HOME is intentionally
					// omitted in Wave-1 — see recon final-assessment.md
					// ("this changes behavior; dogfood separately").
					syntheticTempDir: tempRoot,
				});
			} catch (cause) {
				// CORRECTION01: pre-existing profile-dir cleanup, plus
				// the new synthesized-temp-root cleanup. Both are
				// best-effort and MUST NOT alter the original cause
				// being propagated to the caller.
				if (profileDir) {
					bestEffortRm(profileDir);
				}
				if (synthesizedTempRoot) {
					bestEffortRm(synthesizedTempRoot);
				}
				throw cause;
			}

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

