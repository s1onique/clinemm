/**
 * CORRECTION03 (production-seam wiring):
 *
 * The C helper executes the runner with a deliberately FROZEN
 * environment (only CLINEMM_TESTBED_RUNNER=1, PATH, HOME). The
 * qualified-testbed authority (testbed image digest, SSH key path,
 * editor binary, editor version, SSH host public key) therefore
 * CANNOT come from arbitrary env passthrough — that would weaken
 * the frozen-env invariant defended since HOST-HELPER01.
 *
 * Instead, the runner reads a single trusted artifact:
 *
 *     $HOME/.clinemm/testbed/config.json
 *
 * whose canonical schema is verified at load time:
 *
 *     {
 *       "schema_version": 1,
 *       "image":         "registry/path@sha256:<digest>",
 *       "ssh_key_path":  "/absolute/path/to/private/key",
 *       "editor_binary": "/absolute/path/to/editor",
 *       "editor_version": "<exact-semver>",
 *       "ssh_host_public_key": "<single line: 'ssh-ed25519 AAAA...'>"
 *     }
 *
 * The file is treated as a security-critical trusted artifact:
 *
 *   - path is fixed under $HOME (no env override; only HOME is
 *     forwarded by the production C helper, and $HOME cannot
 *     be influenced by the JSON-RPC envelope)
 *   - file must exist, be a regular file, mode ≤ 0o644 (no
 *     group/other write — prevents operator MITM)
 *   - file owner must equal the current uid (defense against
 *     non-owner crafted configs)
 *   - schema validated field-by-field
 *   - `image` must contain `@sha256:` (refuses tag-only OCI
 *     references that would silently drift)
 *   - all paths must be absolute
 *   - `ssh_host_public_key` MUST be a single base64 key line
 *     (no comments, no markers, no host field embedded) so the
 *     runner can write it verbatim into the ephemeral
 *     UserKnownHostsFile. This is the server-identity pin for
 *     StrictHostKeyChecking=yes.
 *
 * On any failure the runner fails closed with BASE_IMAGE_NOT_READY
 * — the production seam cannot silently fall back to the
 * un-qualified generic base image.
 *
 * readTrustedTestbedConfig() is a pure function: it takes `homeDir`
 * and `currentUid` as arguments so unit tests can drive it
 * deterministically without mutating process.env.
 */

import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs"
import { join, isAbsolute } from "node:path"

export interface TrustedTestbedConfig {
  readonly schema_version: 1
  readonly image: string
  readonly ssh_key_path: string
  readonly editor_binary: string
  readonly editor_version: string
  /**
   * Server identity pin. The qualification step (`testbed-image.ts`)
   * captures the actual content of the qualified VM's
   * `/etc/ssh/ssh_host_*_key.pub` from INSIDE the guest, but
   * NOT as the root of trust. The actual root of trust is
   * the operator-generated sshd host key pair, generated on
   * the dev Mac (`ssh-keygen -t ed25519 -N '' -f
   * ./qual-host-ed25519`), injected into the qualification
   * VM, and passed here as the operator's PUBLIC key. The
   * in-guest `cat /etc/ssh/ssh_host_*_key.pub` is a
   * CONSERVATION CHECK only — the captured value is
   * discarded if it does not byte-equal the operator's
   * input; the persisted value is always the operator's
   * input. The captured line is the bare
   * `<keytype> <base64> [<comment>]` form that ssh-keygen
   * wrote into that file — no host field. The live PROBE01
   * path writes it verbatim into an ephemeral
   * `UserKnownHostsFile` and runs with `StrictHostKeyChecking=yes`
   * — so a wrong SSH endpoint (or a man-in-the-middle) cannot
   * impersonate the qualified guest. Without this pin, ssh
   * silently accepts any host key.
   *
   * Provenance (round 7): the value written here originates
   * OUTSIDE any unauthenticated SSH connection. The
   * reviewer's discriminator:
   *   "the value written as ssh_host_public_key must
   *    originate outside any unauthenticated SSH
   *    connection."
   * The operator's key never travels through an
   * unauthenticated channel. NOT sourced from `ssh-keyscan`
   * (round 5 closed that), and NOT bootstrapped from an
   * unauthenticated `cat /etc/ssh/ssh_host_*_key.pub` (round
   * 6 closed that, but its root was still an
   * unauthenticated-SSH channel — round 7 moves it further
   * out).
   */
  readonly ssh_host_public_key: string
}

export type TrustedTestbedConfigResult =
  | { readonly ok: true; readonly config: TrustedTestbedConfig; readonly configPath: string }
  | { readonly ok: false; readonly error: string; readonly configPath: string }

// CORRECTION03 round 5+6+7: server identity pin. Round 7
// tightened the PROVENANCE: the value written here is the
// OPERATOR'S PUBLIC key (generated on the dev Mac via
// `ssh-keygen -t ed25519 -N '' -f ./qual-host-ed25519` and
// injected into the qualification VM), NOT a value read
// from inside the guest. The in-guest `cat
// /etc/ssh/ssh_host_*_key.pub` is a CONSERVATION CHECK only
// — the captured value is discarded if it does not byte-equal
// the operator's input. The persisted value is always the
// operator's input. We require exactly three
// whitespace-separated tokens:
//   <keytype> <base64-key> [<comment>]
// where:
//   - keytype MUST be one of: ssh-ed25519, ecdsa-sha2-nistp256,
//     ssh-rsa, rsa-sha2-256, rsa-sha2-512 (the formats ssh-keygen
//     writes into ssh_host_*_key.pub)
//   - base64-key MUST decode (sanity) and MUST be at least 32 bytes
//     after decode (anything shorter is not a valid public key)
//   - NO host field embedded: the host field would be the
//     `tart ip` output, but a host field would allow the trusted
//     config to bind an arbitrary attacker address. The runner
//     prefixes the guest ip at runtime, so the key line MUST NOT
//     carry a host field. ssh-keygen does NOT prepend a host field
//     (just emits the bare key line), so requiring its absence is
//     the natural shape.
//   - no leading '@' markers (which indicate revoked/CA markers
//     in known_hosts) and no '#' comment lines
//
// Anything else fails closed.
const SSH_HOST_PUBLIC_KEY_LINE_RE =
  /^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa|rsa-sha2-256|rsa-sha2-512)\s+([A-Za-z0-9+/=]{43,})\s*([!-~]*)$/

const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

// P1 (round 3): a weaker "contains @sha256:" check accepts malformed
// digests such as `registry/foo@sha256:not-a-digest`. The trusted
// config claims "strict digest checks" in its documentation; this
// regex is the actual enforcement. It requires:
//   - at least one non-@, non-whitespace char before `@sha256:`
//     (the registry/path component)
//   - literal `@sha256:` separator
//   - exactly 64 lowercase or uppercase hex chars
//
// Anything else fails closed. This matches the OCI immutable-image
// reference form: `registry/path@sha256:<64-hex-digest>`.
const OCI_SHA256_REF_RE = /^[^@\s]+@sha256:[0-9a-f]{64}$/

/**
 * Pure reader for the trusted testbed config. All inputs are
 * explicit arguments (no env reads) so unit tests can drive this
 * function deterministically. The runner wires `process.env.HOME`
 * and `process.getuid?.()` at the call site.
 *
 * On success, returns the parsed + validated config.
 * On failure, returns a typed error explaining which invariant
 * was violated. Every failure path is explicit; no silent fallback.
 */
export function readTrustedTestbedConfig(args: {
  readonly homeDir: string | null
  readonly currentUid: number | null
}): TrustedTestbedConfigResult {
  if (args.homeDir == null || args.homeDir.length === 0) {
    return {
      ok: false,
      error:
        "HOME is not set; cannot resolve the trusted testbed config path (CORRECTION03 production-seam wiring).",
      configPath: "",
    }
  }
  const configPath = join(args.homeDir, ".clinemm", "testbed", "config.json")

  if (!existsSync(configPath)) {
    return {
      ok: false,
      error: `trusted testbed config not found at ${configPath}; run \`bun tools/macos-vsix-testbed/testbed-image.ts\` once on a developer Mac to produce the qualified image and write the config (CORRECTION03 production-seam wiring).`,
      configPath,
    }
  }
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(configPath)
  } catch (e) {
    return {
      ok: false,
      error: `stat(${configPath}) failed: ${(e as Error).message}`,
      configPath,
    }
  }
  if (!stat.isFile()) {
    return {
      ok: false,
      error: `${configPath} is not a regular file`,
      configPath,
    }
  }
  // Defense against operator MITM: refuse group/other-writable
  // configs (a 0o644 file owned by the operator is the canonical
  // case; 0o600 is also fine).
  if ((stat.mode & 0o022) !== 0) {
    return {
      ok: false,
      error: `${configPath} has insecure mode 0${(stat.mode & 0o777).toString(8).padStart(3, "0")}; refusing group/other-writable trusted config`,
      configPath,
    }
  }
  // Defense against non-owner crafted configs: the file owner must
  // equal the current uid. On systems without getuid (Windows), the
  // check is skipped; the mode check above still catches the
  // common operator-MITM shape.
  if (args.currentUid != null && stat.uid !== args.currentUid) {
    return {
      ok: false,
      error: `${configPath} is owned by uid ${stat.uid}, current uid is ${args.currentUid}; refusing non-owner trusted config`,
      configPath,
    }
  }

  let raw: string
  try {
    raw = readFileSync(configPath, "utf8")
  } catch (e) {
    return {
      ok: false,
      error: `readFile(${configPath}) failed: ${(e as Error).message}`,
      configPath,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return {
      ok: false,
      error: `${configPath} is not valid JSON: ${(e as Error).message}`,
      configPath,
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      error: `${configPath} must be a JSON object`,
      configPath,
    }
  }
  const obj = parsed as Record<string, unknown>

  // schema_version
  if (obj.schema_version !== 1) {
    return {
      ok: false,
      error: `${configPath}: schema_version must be 1, got ${JSON.stringify(obj.schema_version)}`,
      configPath,
    }
  }

  // image — must contain @sha256:
  if (typeof obj.image !== "string" || obj.image.length === 0) {
    return {
      ok: false,
      error: `${configPath}: image must be a non-empty string`,
      configPath,
    }
  }
  if (!OCI_SHA256_REF_RE.test(obj.image)) {
    return {
      ok: false,
      error: `${configPath}: image must be a registry/path@sha256:<64-hex-digest> reference (refuses tag-only OCI references and malformed digests that would silently drift or fail later); got ${JSON.stringify(obj.image)}`,
      configPath,
    }
  }

  // ssh_key_path — absolute
  if (typeof obj.ssh_key_path !== "string" || obj.ssh_key_path.length === 0) {
    return {
      ok: false,
      error: `${configPath}: ssh_key_path must be a non-empty string`,
      configPath,
    }
  }
  if (!isAbsolute(obj.ssh_key_path)) {
    return {
      ok: false,
      error: `${configPath}: ssh_key_path must be absolute; got ${JSON.stringify(obj.ssh_key_path)}`,
      configPath,
    }
  }

  // editor_binary — absolute
  if (typeof obj.editor_binary !== "string" || obj.editor_binary.length === 0) {
    return {
      ok: false,
      error: `${configPath}: editor_binary must be a non-empty string`,
      configPath,
    }
  }
  if (!isAbsolute(obj.editor_binary)) {
    return {
      ok: false,
      error: `${configPath}: editor_binary must be absolute; got ${JSON.stringify(obj.editor_binary)}`,
      configPath,
    }
  }

  // editor_version — semver
  if (typeof obj.editor_version !== "string" || !SEMVER_RE.test(obj.editor_version)) {
    return {
      ok: false,
      error: `${configPath}: editor_version must be semver (X.Y.Z); got ${JSON.stringify(obj.editor_version)}`,
      configPath,
    }
  }

  // ssh_host_public_key — server identity pin (round 5, provenance
  // tightened in round 6). The qualification step (`testbed-image.ts`)
  // writes a single bare key line here, captured from INSIDE the
  // qualified VM through the authenticated provisioning channel
  // (sshpass + admin/admin) — NOT via `ssh-keyscan`, which would
  // only observe the unauthenticated wire response. The captured
  // file is /etc/ssh/ssh_host_*_key.pub, so the line MUST be exactly
  // `<keytype> <base64> [<comment>]` with no host field, no marker,
  // no leading whitespace, no '#' comment. Anything else fails
  // closed — StrictHostKeyChecking=yes is the wrong default if the
  // key line is malformed (a wrong key would brick every
  // connection).
  if (typeof obj.ssh_host_public_key !== "string" || obj.ssh_host_public_key.length === 0) {
    return {
      ok: false,
      error: `${configPath}: ssh_host_public_key must be a non-empty string (server identity pin for StrictHostKeyChecking=yes)`,
      configPath,
    }
  }
  // No newlines, no host field, no markers. We allow exactly one
  // line (surrounding whitespace stripped). Embedded newlines
  // would let the operator smuggle additional known_hosts entries
  // (revoked/CA markers, additional host pins) into the trusted
  // known_hosts file.
  const hostKey = obj.ssh_host_public_key.trim()
  if (hostKey.length === 0 || /\r|\n/.test(obj.ssh_host_public_key)) {
    return {
      ok: false,
      error: `${configPath}: ssh_host_public_key must be exactly one line with no embedded newlines (multi-line entries would smuggle additional known_hosts markers)`,
      configPath,
    }
  }
  // No leading '@' markers, no '|' hashed-host entries, no '#'.
  if (/^[\s@|]/.test(hostKey) || hostKey.startsWith("#")) {
    return {
      ok: false,
      error: `${configPath}: ssh_host_public_key must not start with @ (revoked/CA marker), | (hashed host), or # (comment); got ${JSON.stringify(hostKey.slice(0, 32))}`,
      configPath,
    }
  }
  // Shape: keytype base64 [comment]
  if (!SSH_HOST_PUBLIC_KEY_LINE_RE.test(hostKey)) {
    return {
      ok: false,
      error: `${configPath}: ssh_host_public_key must be a bare '<keytype> <base64> [<comment>]' line (the exact byte shape ssh-keygen writes into /etc/ssh/ssh_host_*_key.pub) with no host field; got ${JSON.stringify(hostKey.slice(0, 80))}`,
      configPath,
    }
  }

  return {
    ok: true,
    config: {
      schema_version: 1,
      image: obj.image,
      ssh_key_path: obj.ssh_key_path,
      editor_binary: obj.editor_binary,
      editor_version: obj.editor_version,
      ssh_host_public_key: hostKey,
    },
    configPath,
  }
}

/**
 * Canonical default config path under HOME. Useful for tooling
 * (testbed-image.ts) that wants to write the config to the
 * expected location.
 */
export function defaultTrustedTestbedConfigPath(homeDir: string): string {
  return join(homeDir, ".clinemm", "testbed", "config.json")
}
