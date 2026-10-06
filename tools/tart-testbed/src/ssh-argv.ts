/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C7, C8 (SSH argv)
 *
 * Pure argv-construction for the SSH side. The TartBackend uses
 * these to drive `tart ip` polling and remote command execution.
 *
 * Defense-in-depth (matches the existing vsix-testbed contract
 * without coupling to it):
 *   - BatchMode=yes (no password fallback)
 *   - StrictHostKeyChecking=yes
 *   - UserKnownHostsFile (only when caller supplies contents)
 *   - IdentitiesOnly=yes
 *   - IdentityFile (only when caller supplies a key)
 *   - PreferredAuthentications=publickey
 *
 * `remoteArgv` is passed as one argv element per token, joined
 * with spaces inside a single positional arg (OpenSSH requires
 * one remote command string).
 */

/** Sanitize a guest IP — must look like an IPv4/v6 literal. */
export function isValidGuestIp(ip: string): boolean {
  if (typeof ip !== "string" || ip.length === 0) return false;
  return /^[0-9a-fA-F:.]+$/.test(ip);
}

/** Render the remote argv as a single shell-safe string. Each argv
 * element is one whitespace-delimited token; tokens that need
 * quoting are wrapped in single quotes and any embedded single
 * quotes are escaped as `'\''`.
 *
 * We deliberately do NOT use shlex / eval. The transformation is
 * lossless and reversible: shell tokenization of the result is
 * equivalent to the original argv split.
 */
export function quoteShellArgv(argv: readonly string[]): string {
  const parts: string[] = [];
  for (const tok of argv) {
    parts.push(quoteShellToken(tok));
  }
  return parts.join(" ");
}

function quoteShellToken(s: string): string {
  if (s.length === 0) return "''";
  // Safe unquoted: alnum + a handful of punctuation that has no
  // shell meaning.
  if (/^[A-Za-z0-9_\-.\/:=]+$/.test(s)) return s;
  // Escape: wrap in single quotes, replace ' with '\''.
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the SSH argv for running one remote command in the guest.
 *
 * Returns `{ ok: true, argv }` or `{ ok: false, error }`. Pure.
 */
export function sshRemoteArgv(args: {
  readonly guestIp: string;
  readonly user: string;
  readonly remoteArgv: readonly string[];
  readonly identityFile?: string;
  readonly knownHostsFile?: string;
  /** ms before ssh is killed (matches OpenSSH's ConnectTimeout
   *  semantics for connect, but here we pass it as a wrapper
   *  because the orchestrator enforces the timeout via the
   *  ProcessRunner). When provided, ssh is invoked with `-o
   *  ConnectTimeout=<seconds>` for the connect phase. */
  readonly connectTimeoutMs?: number;
}): { readonly ok: true; readonly argv: readonly string[] } | { readonly ok: false; readonly error: string } {
  if (!isValidGuestIp(args.guestIp)) {
    return { ok: false, error: `guestIp is not an IP literal: ${JSON.stringify(args.guestIp)}` };
  }
  if (typeof args.user !== "string" || args.user.length === 0) {
    return { ok: false, error: "user is empty" };
  }
  for (let i = 0; i < args.remoteArgv.length; i++) {
    const el = args.remoteArgv[i];
    if (typeof el !== "string") {
      return { ok: false, error: `remoteArgv[${i}] is ${typeof el}, expected string` };
    }
  }

  const argv: string[] = ["ssh", "-o", "BatchMode=yes"];
  argv.push("-o", "StrictHostKeyChecking=yes");
  if (args.knownHostsFile !== undefined) {
    argv.push("-o", `UserKnownHostsFile=${args.knownHostsFile}`);
  } else {
    argv.push("-o", "UserKnownHostsFile=/dev/null");
  }
  argv.push("-o", "IdentitiesOnly=yes");
  if (args.identityFile !== undefined) {
    argv.push("-o", `IdentityFile=${args.identityFile}`);
  }
  argv.push("-o", "PreferredAuthentications=publickey");
  if (typeof args.connectTimeoutMs === "number" && args.connectTimeoutMs > 0) {
    argv.push("-o", `ConnectTimeout=${Math.ceil(args.connectTimeoutMs / 1000)}`);
  }
  argv.push(`${args.user}@${args.guestIp}`);
  argv.push(quoteShellArgv(args.remoteArgv));
  return { ok: true, argv };
}

/** `ssh-keygen -lf <pub>` — fingerprint check helper, used by tests. */
export function sshKeygenFingerprintArgv(pubKeyPath: string): readonly string[] {
  return ["ssh-keygen", "-lf", pubKeyPath];
}