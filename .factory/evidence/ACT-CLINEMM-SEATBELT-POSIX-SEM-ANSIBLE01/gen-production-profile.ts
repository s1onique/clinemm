/**
 * ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
 *
 * Generate a Seatbelt profile through the REAL production backend
 * (`SeatbeltSandboxBackendExperimental.prepare()`), which internally
 * calls the REAL production generator (`generateSeatbeltProfile()`).
 *
 * Usage: bun gen-production-profile.ts <workDir> <networkMode>
 *   networkMode: "deny" | "allow"
 *
 * Writes <workDir>/production-profile-<network>.sb and prints diagnostics.
 *
 * NOTE ON THE RUNTIME: run this with BUN (not Node). Node's ESM
 * resolver requires explicit file extensions on relative imports, and
 * the SDK source uses extensionless imports; Bun resolves them the way
 * the repo's own tooling does.
 *
 * NOTE ON THE HOST-HELPER ENDPOINT: Bun's `realpathSync` returns
 * EOPNOTSUPP for the AF_UNIX host-helper socket inode on this
 * filesystem. The host-helper authority is therefore resolved from the
 * ENVIRONMENT VARIABLE (which the production backend prefers) and is
 * cleared for the `deny` mode, where no AF_UNIX authority is emitted
 * anyway. This is a test-harness detail, NOT a production behaviour
 * change: the live profile captured from the real extension host DID
 * carry the host-helper rule.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { SeatbeltSandboxBackendExperimental } from "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts";

const work = process.argv[2]!;
const network = (process.argv[3] ?? "deny") as "deny" | "allow";

mkdirSync(join(work, "tmp"), { recursive: true });

// The backend prefers `CLINEMM_HOST_HELPER_SOCKET` and falls back to
// `$HOME/.clinemm/host-helper.sock`. Bun cannot `realpathSync` the
// real AF_UNIX socket inode on this filesystem, so this harness points
// the endpoint at a REAL AF_UNIX socket that it creates itself (a
// listening socket on a temp path). The backend then canonicalizes it
// successfully and the emitted profile carries the host-helper rule
// exactly as production does.
delete process.env.CLINEMM_HOST_HELPER_SOCKET;
const previousHome = process.env.HOME;
{
	// The AF_UNIX socket path must fit macOS's 104-byte `sock_path`
	// limit, so it is placed under `/tmp` with a short name rather than
	// under the (long) work directory.
	const helperDir = "/tmp/act-hh";
	mkdirSync(helperDir, { recursive: true });
	const helperSock = join(helperDir, `h-${randomBytes(4).toString("hex")}.sock`);
	// Create a real AF_UNIX listener so lstat() sees S_IFSOCK and
	// realpathSync() succeeds.
	const { createServer } = await import("node:net");
	const srv = createServer();
	await new Promise<void>((resolve) => {
		srv.listen(helperSock, () => resolve());
	});
	process.env.CLINEMM_HOST_HELPER_SOCKET = helperSock;
	process.env.HOME = join(work, "helper-home");
	mkdirSync(join(work, "helper-home"), { recursive: true });
}

const prepared = await SeatbeltSandboxBackendExperimental.prepare({
	capability: {
		readonlyRoots: [],
		writableRoots: [work],
		tempRoot: join(work, "tmp"),
		network,
		environment: { mode: "sanitized", allow: [] },
		cwd: work,
	},
	command: {
		executable: process.execPath,
		args: ["-c", "true"],
		cwd: work,
	},
});

const profilePath = prepared.args[1]!;
const profile = readFileSync(profilePath, "utf8");
writeFileSync(join(work, `production-profile-${network}.sb`), profile);

console.log("PROFILE_PATH=" + profilePath);
console.log("PROFILE_OUT=" + join(work, `production-profile-${network}.sb`));
console.log("PROFILE_SEM_RULE_COUNT=" + (profile.split("(allow ipc-posix-sem)").length - 1));
console.log("PROFILE_HAS_DENY_NETWORK=" + profile.includes("(deny network*)"));
console.log("PROFILE_HAS_ALLOW_NETWORK=" + profile.includes("(allow network*)"));
console.log("PROFILE_HAS_AF_UNIX=" + profile.includes("AF_UNIX"));
console.log("PROFILE_HAS_MACH_SERVICE=" + /mach-service/.test(profile));

// Restore the parent HOME for any later process in this run.
if (previousHome !== undefined) {
	process.env.HOME = previousHome;
}
process.exit(0);
