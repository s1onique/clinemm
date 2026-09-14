/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01
 *
 * The fixed testbed runner. Spawned by the C host helper via
 * execve() with argv:
 *   [0] = runner path
 *   [1] = request_id
 *   [2] = subject_head (40-hex)
 *   [3] = vsix_path (absolute)
 *   [4] = vsix_sha256 (64-hex)
 *
 * The runner:
 *   1. validates the VSIX path/SHA on the host (path-validation.ts)
 *   2. clones a Tart VM from a pinned base image
 *   3. starts the VM headless
 *   4. copies the exact VSIX bytes into the guest (with sha verification)
 *   5. installs the VSIX into an isolated VSCodium extensions dir
 *   6. launches the editor and asserts activation via the
 *      smoke module
 *   7. cleans up the VM (best-effort) and emits one JSON envelope
 *
 * The runner emits ONE JSON object on stdout:
 *   success: {"result":{...}}
 *   failure: {"error":"<CODE>","message":"..."}
 *
 * The C helper wraps this in the protocol envelope. The runner
 * itself must not echo non-JSON garbage; the helper fails closed
 * on malformed output.
 *
 * Substrate check: on substrates where Tart cannot run (e.g. APFS
 * `protect` flag on $HOME), the runner detects this via the
 * tartEnvSane() probe and emits BASE_IMAGE_NOT_READY before
 * attempting any clone.
 */

import { spawn, type Subprocess } from "bun"
import { existsSync } from "node:fs"
import { hostname } from "node:os"
import {
  MAX_VSIX_BYTES,
  TRUSTED_ARTIFACT_ROOT,
  validateVsixPath,
  type RunnerErrorCode,
} from "./path-validation.ts"
import { runInstalledVsixSmoke } from "./guest-smoke.ts"
import {
  readTrustedTestbedConfig,
  type TrustedTestbedConfig,
} from "./testbed-config.ts"

export interface RunnerOk {
  readonly result: {
    readonly subject_head: string
    readonly vsix_sha256: string
    readonly host_sha256: string
    readonly guest_vsix_sha256: string
    readonly extension_id: string
    readonly extension_version: string
    readonly guest_image: string
    readonly base_image: string
    readonly guest_macos_version: string
    readonly vscode_version: string
    readonly activation: "pass"
    readonly red_without_extension: "pass" | "fail"
    readonly cleanup: "pass" | "fail"
    readonly ephemeral_vm_name: string
    readonly tart_invocations: number
    readonly host_hostname: string
  }
}
export interface RunnerFail {
  readonly error: RunnerErrorCode
  readonly message: string
  readonly detail?: string
}
export type RunnerResult = RunnerOk | RunnerFail

// Pinned Tart base image for macOS. The Cirrus registry publishes
// exactly one tag (`latest`); version-style tags like `:14.5` do
// NOT exist and silently fail with 404 MANIFEST_UNKNOWN. We bind
// the digest resolved 2026-01-09 from
//   curl https://ghcr.io/v2/cirruslabs/macos-sonoma-base/tags/list
// (token: anonymous pull scope; the registry returns the digest
// via the `:latest` OCI reference). Reproducibility comes from
// binding the immutable `@sha256:` form, not from a literal tag.
//
// Override via CLINEMM_TART_BASE_IMAGE for development; the
// pinned default below is what the ACT §5 evidence binds.
export const TART_BASE_IMAGE =
  process.env.CLINEMM_TART_BASE_IMAGE ??
  "ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49"

// CORRECTION03: the testbed no longer clones the generic Cirrus
// Sonoma base directly. It clones a QUALIFIED testbed image that
// has, at minimum:
//   - a pinned SSH public key installed for the `admin` user
//   - VS Code (or VSCodium) installed at the pinned absolute path
//   - ClineMM absent (verified at qualification time)
// The qualified-image digest is produced ONCE by
// `tools/macos-vsix-testbed/testbed-image.ts` and pinned in the
// trusted config file $HOME/.clinemm/testbed/config.json.
// PROBE01 clones this digest only.
//
// Default: null (require explicit pinning). Override via
// CLINEMM_TART_TESTBED_IMAGE for developer runs that bypass the
// trusted config; the null default means the runner refuses to
// clone anything until a real digest is provided. That fail-closed
// default is the CORRECTION03 invariant: the testbed cannot
// silently fall back to the un-qualified generic base image.
//
// Mutable: `run()` reassigns this after loading the trusted
// config so guest-smoke.ts (which calls pinnedSshAndEditor())
// sees the validated values.
export let TART_TESTBED_IMAGE: string | null =
  process.env.CLINEMM_TART_TESTBED_IMAGE ?? null

// The image we provision FROM (only used by testbed-image.ts;
// the live PROBE01 path must not use this directly).
export const TART_QUALIFICATION_SOURCE_IMAGE = TART_BASE_IMAGE

// Pinned SSH key path for noninteractive SSH into the testbed
// VM. The qualification step provisions the corresponding public
// key into the qualified image. The path is supplied by the
// trusted testbed config (or by CLINEMM_TESTBED_SSH_KEY_PATH for
// developer runs). Fail-closed default: null.
export let TESTBED_SSH_KEY_PATH: string | null =
  process.env.CLINEMM_TESTBED_SSH_KEY_PATH ?? null

// Pinned editor baseline. The qualified image must have the
// editor binary at this exact absolute path, and `editor
// --version` must produce this exact version string. Fail-closed
// default: null.
export let TESTBED_EDITOR_BINARY: string | null =
  process.env.CLINEMM_TESTBED_EDITOR_BINARY ?? null
export let TESTBED_EDITOR_VERSION: string | null =
  process.env.CLINEMM_TESTBED_EDITOR_VERSION ?? null

// Pinned SSH HOST public key (server identity). Round 7
// provenance: the operator generates the sshd host key pair
// on the dev Mac (`ssh-keygen -t ed25519 -N '' -f
// ./qual-host-ed25519`) and injects it into the qualification
// VM. The qualification flow's in-guest `cat
// /etc/ssh/ssh_host_*_key.pub` is a CONSERVATION CHECK only —
// the captured value is discarded if it does not byte-equal
// the operator's input; the persisted value is always the
// operator's input. The value here therefore originates
// OUTSIDE any unauthenticated SSH channel. NOT sourced from
// `ssh-keyscan`, and NOT bootstrapped from an unauthenticated
// `cat /etc/ssh/ssh_host_*_key.pub`. The live PROBE01 path
// writes it into an ephemeral UserKnownHostsFile so the SSH
// client verifies the server is genuinely the qualified VM.
//
// Why this exists (CORRECTION03 round 5): `IdentitiesOnly=yes +
// IdentityFile=<pinned>` only proves "I am the testbed runner".
// Without server-identity verification, a wrong SSH endpoint can
// sit between `tart ip` and every downstream witness — the pinned
// client key alone does NOT prevent a malicious or accidentally
// wrong SSH server from accepting the presented public key and
// answering the smoke commands.
//
// Fail-closed default: null.
export let TESTBED_SSH_HOST_PUBLIC_KEY: string | null =
  process.env.CLINEMM_TESTBED_SSH_HOST_PUBLIC_KEY ?? null

/**
 * Build the contents of an ephemeral OpenSSH UserKnownHostsFile
 * that pins the qualified guest's SSH host key. Pure function —
 * no I/O. The caller writes the returned string to a tempfile
 * (mode 0o600) and threads the path into `sshCommandForGuest`.
 *
 * CORRECTION03 round 5: server identity pin. The previous
 * builder emitted `-o StrictHostKeyChecking=no -o
 * UserKnownHostsFile=/dev/null` which silently accepts ANY host
 * key. A wrong SSH endpoint (or a man-in-the-middle) could
 * impersonate the qualified guest. We now bind the SERVER
 * identity by writing the single key line captured at
 * qualification time, prefixed with the resolved `tart ip` —
 * so `StrictHostKeyChecking=yes` then refuses any other key.
 *
 * @returns `{ ok: true, contents }` on success; `{ ok: false, error }`
 *   on any malformed input. NO I/O is performed.
 */
export function buildKnownHostsFileContents(args: {
  readonly guestIp: string
  readonly pinnedHostPublicKey: string
}): { readonly ok: true; readonly contents: string } | { readonly ok: false; readonly error: string } {
  // guestIp must look like an IP literal (v4 or v6) — we refuse
  // hostnames to prevent wildcards in the host field.
  if (typeof args.guestIp !== "string" || args.guestIp.length === 0) {
    return { ok: false, error: "guestIp is empty; cannot prefix host key line" }
  }
  if (!/^[0-9a-fA-F:.]+$/.test(args.guestIp)) {
    return { ok: false, error: `guestIp is not an IP literal: ${JSON.stringify(args.guestIp)}` }
  }
  if (typeof args.pinnedHostPublicKey !== "string" || args.pinnedHostPublicKey.length === 0) {
    return { ok: false, error: "pinnedHostPublicKey is empty; the testbed refuses StrictHostKeyChecking=yes without a pinned server identity" }
  }
  const hostKey = args.pinnedHostPublicKey.trim()
  if (hostKey.length === 0) {
    return { ok: false, error: "pinnedHostPublicKey is whitespace only" }
  }
  if (/^[\s@|]/.test(hostKey) || hostKey.startsWith("#")) {
    return { ok: false, error: "pinnedHostPublicKey must not start with @, |, #, or whitespace" }
  }
  if (/\r|\n/.test(args.pinnedHostPublicKey)) {
    return { ok: false, error: "pinnedHostPublicKey must be exactly one line (no embedded newlines)" }
  }
  if (!/^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa|rsa-sha2-256|rsa-sha2-512)\s+[A-Za-z0-9+/=]{43,}/.test(hostKey)) {
    return { ok: false, error: "pinnedHostPublicKey is not a valid bare key line (<keytype> <base64> [comment])" }
  }
  return {
    ok: true,
    contents: `${args.guestIp} ${hostKey}\n`,
  }
}

/**
 * Build the ssh argv for the qualified guest. Bound to THREE
 * authority pins from the qualified-image contract:
 *
 *   - the pinned CLIENT private key (proves "I am the testbed
 *     runner")
 *   - the pinned IMAGE digest (frozen at qualification; refuses
 *     tag-only OCI references that would silently drift)
 *   - the pinned SERVER host public key + an ephemeral
 *     UserKnownHostsFile path (proves "I am the VM from the
 *     qualified image")
 *
 * CORRECTION03 round 5 introduced the third pin:
 * `StrictHostKeyChecking=yes` + an ephemeral UserKnownHostsFile
 * whose sole entry is the runtime `tart ip` bound to the host
 * key captured at qualification time. Without this, a wrong SSH
 * endpoint can sit between `tart ip` and every downstream
 * witness — the pinned client key alone does NOT prevent a
 * malicious or accidentally wrong SSH server from accepting the
 * presented public key and answering the smoke commands.
 *
 * All three pinned values are required arguments (NOT read
 * from env) so unit tests can drive this function
 * deterministically.
 */
export function sshCommandForGuest(args: {
  readonly guestIp: string
  readonly remoteCommand: string
  readonly pinnedKeyPath: string
  readonly pinnedImageDigest: string
  /**
   * Absolute path to an ephemeral UserKnownHostsFile whose sole
   * entry is `<guestIp> <pinnedHostPublicKey>`. The caller writes
   * the file (mode 0o600) BEFORE invoking ssh.
   */
  readonly knownHostsFile: string
  readonly pinnedHostPublicKey: string
}): { readonly ok: true; readonly cmd: readonly string[] } | { readonly ok: false; readonly error: string } {
  if (!args.pinnedImageDigest || !/^[^@\s]+@sha256:[0-9a-f]{64}$/.test(args.pinnedImageDigest)) {
    return {
      ok: false,
      error: `TART_TESTBED_IMAGE is not a registry/path@sha256:<64-hex-digest> reference (refuses tag-only OCI references and malformed digests); got ${JSON.stringify(args.pinnedImageDigest ?? null)}`,
    }
  }
  if (!args.pinnedKeyPath) {
    return {
      ok: false,
      error: "pinned SSH key path is empty; the testbed refuses BatchMode=yes without a pinned key",
    }
  }
  if (!args.knownHostsFile || !/^\//.test(args.knownHostsFile)) {
    return {
      ok: false,
      error: "knownHostsFile must be an absolute path; refusing to write trusted known_hosts to a relative path",
    }
  }
  // Defense in depth: validate the host public key shape here
  // too. The trusted config reader already enforces this, but
  // call sites that bypass the reader (unit tests, future code)
  // must still fail closed.
  const kh = buildKnownHostsFileContents({
    guestIp: args.guestIp,
    pinnedHostPublicKey: args.pinnedHostPublicKey,
  })
  if (!kh.ok) {
    return {
      ok: false,
      error: `pinnedHostPublicKey rejected: ${kh.error}`,
    }
  }
  return {
    ok: true,
    cmd: [
      "ssh",
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${args.knownHostsFile}`,
      "-o", "IdentitiesOnly=yes",
      "-o", `IdentityFile=${args.pinnedKeyPath}`,
      "-o", "PreferredAuthentications=publickey",
      `admin@${args.guestIp}`,
      args.remoteCommand,
    ],
  }
}

/**
 * Assert that the testbed editor baseline is pinned and matches
 * the qualified image contract. Called BEFORE the RED baseline
 * launch so we fail closed with EDITOR_BASELINE_NOT_PROVEN rather
 * than silently passing the activation probe when the editor is
 * missing.
 *
 * The editor binary and version are required arguments (NOT
 * read from env) so unit tests can drive this function
 * deterministically. The top-level runner wires the env-captured
 * constants at the call site.
 */
export function editorBaseline(args: {
  readonly pinnedBinary: string | null
  readonly pinnedVersion: string | null
}): { readonly ok: true; readonly binary: string; readonly version: string } | { readonly ok: false; readonly error: string } {
  if (args.pinnedBinary == null) {
    return {
      ok: false,
      error: "CLINEMM_TESTBED_EDITOR_BINARY is not pinned; the testbed cannot assert the editor baseline",
    }
  }
  if (args.pinnedVersion == null) {
    return {
      ok: false,
      error: "CLINEMM_TESTBED_EDITOR_VERSION is not pinned; the testbed cannot assert the editor baseline",
    }
  }
  return {
    ok: true,
    binary: args.pinnedBinary,
    version: args.pinnedVersion,
  }
}

/**
 * Convenience wrapper that wires the env-captured constants.
 * Used by guest-smoke.ts.
 */
export function pinnedSshAndEditor(): {
  readonly ok: true
  readonly sshKeyPath: string
  readonly imageDigest: string
  readonly editorBinary: string
  readonly editorVersion: string
  /**
   * Bare SSH host public key captured at qualification time. The
   * caller writes a per-guest-Ip ephemeral known_hosts file
   * containing `<guestIp> <pinnedHostPublicKey>` and passes the
   * path into `sshCommandForGuest({ knownHostsFile: ... })`.
   * Without this pin, StrictHostKeyChecking would have nothing
   * to verify against.
   */
  readonly sshHostPublicKey: string
} | { readonly ok: false; readonly error: string } {
  if (TART_TESTBED_IMAGE == null) {
    return {
      ok: false,
      error: "TART_TESTBED_IMAGE is not pinned (CLINEMM_TART_TESTBED_IMAGE env not set)",
    }
  }
  if (TESTBED_SSH_KEY_PATH == null) {
    return {
      ok: false,
      error: "CLINEMM_TESTBED_SSH_KEY_PATH is not set",
    }
  }
  if (TESTBED_SSH_HOST_PUBLIC_KEY == null) {
    return {
      ok: false,
      error: "CLINEMM_TESTBED_SSH_HOST_PUBLIC_KEY is not pinned; the testbed refuses StrictHostKeyChecking=yes without a pinned server identity",
    }
  }
  const eb = editorBaseline({
    pinnedBinary: TESTBED_EDITOR_BINARY,
    pinnedVersion: TESTBED_EDITOR_VERSION,
  })
  if (!eb.ok) return { ok: false, error: eb.error }
  return {
    ok: true,
    sshKeyPath: TESTBED_SSH_KEY_PATH,
    imageDigest: TART_TESTBED_IMAGE,
    editorBinary: eb.binary,
    editorVersion: eb.version,
    sshHostPublicKey: TESTBED_SSH_HOST_PUBLIC_KEY,
  }
}

// Per-phase budgets. The C helper enforces a SINGLE
// RUNNER_TIMEOUT_SECONDS wallclock around the whole child
// lifetime (including pipe drain); each phase must fit inside
// that deadline with margin. The phases are sequenced (clone →
// boot → sshReady → install → activate), so the total upper
// bound is clone + boot + sshReady + install + activate. The
// helper constant must be ≥ that sum.
export const PHASE_BUDGET_MS = {
  clone: 20 * 60 * 1000,
  boot: 10 * 60 * 1000,
  sshReady: 5 * 60 * 1000,
  install: 5 * 60 * 1000,
  activate: 3 * 60 * 1000,
}

// Total upper bound of PHASE_BUDGET_MS in seconds, exported so
// the C helper's RUNNER_TIMEOUT_SECONDS can be set with margin
// (see tools/macos-host-helper/native/helper.c).
export const TOTAL_PHASE_BUDGET_SECONDS =
  (20 + 10 + 5 + 5 + 3) * 60 + 60 // phases + 1 min margin

/**
 * Detect whether Tart can actually run on this substrate. The
 * Tart CLI requires a writable $HOME for cache + VM storage;
 * on APFS volumes with the `protect` flag, Tart fails with
 * FailedToCreateVmFile / NetworkStorageDB write errors.
 *
 * This probe mirrors the recon target without requiring Tart
 * to be fully functional: we spawn `tart --version` and check
 * that the binary exists and runs; we also probe TART_HOME
 * writability.
 */
export async function tartEnvSane(): Promise<{ ok: boolean; reason?: string }> {
  // (a) tart binary on PATH. `spawn` throws on ENOENT in Bun
  // instead of returning exitCode=127, so we wrap in try/catch.
  let probe: ReturnType<typeof spawn>
  try {
    probe = spawn({
      cmd: ["tart", "--version"],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })
  } catch (cause) {
    return { ok: false, reason: `tart not found on PATH: ${(cause as Error).message}` }
  }
  try {
    await probe.exited
  } catch (cause) {
    return { ok: false, reason: `tart --version failed: ${(cause as Error).message}` }
  }
  if (probe.exitCode !== 0) {
    return { ok: false, reason: `tart --version exited ${probe.exitCode}` }
  }
  // (b) TART_HOME (or $HOME/.tart) writable
  const tartHome = process.env.TART_HOME ?? `${process.env.HOME ?? "/tmp"}/.tart`
  try {
    const { mkdirSync } = await import("node:fs")
    mkdirSync(tartHome, { recursive: true })
    const { writeFileSync, unlinkSync } = await import("node:fs")
    const canary = `${tartHome}/.clinemm-testbed-canary-${Date.now()}`
    writeFileSync(canary, "x")
    unlinkSync(canary)
  } catch (cause) {
    return {
      ok: false,
      reason: `TART_HOME ${tartHome} not writable: ${(cause as Error).message}`,
    }
  }
  return { ok: true }
}

/**
 * Generate a unique ephemeral VM name. The C helper embeds the
 * request_id in argv[1] but we use a short slice for the VM name
 * because Tart imposes a name-length limit.
 */
export function vmNameFor(requestId: string): string {
  const safe = requestId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)
  const stamp = Date.now().toString(36)
  return `clinemm-probe-${safe}-${stamp}`
}

/**
 * Top-level entrypoint. argv is parsed exactly as the C helper
 * provides it.
 */
export async function run(argv: string[]): Promise<RunnerResult> {
  const [runnerPath, requestId, subjectHead, vsixPath, vsixSha256] = argv
  if (!runnerPath || !requestId || !subjectHead || !vsixPath || !vsixSha256) {
    return {
      error: "INTERNAL_ERROR",
      message: "argv missing required fields",
      detail: `got ${argv.length} args`,
    }
  }
  if (!/^[0-9a-f]{40}$/i.test(subjectHead)) {
    return {
      error: "INTERNAL_ERROR",
      message: "subject_head not 40-hex",
      detail: subjectHead,
    }
  }
  if (!/^[0-9a-f]{64}$/i.test(vsixSha256)) {
    return {
      error: "INTERNAL_ERROR",
      message: "vsix_sha256 not 64-hex",
      detail: vsixSha256,
    }
  }

  // (1) Tart substrate check. Fail closed BEFORE attempting any
  // VM lifecycle work; the alternative is a long, expensive failure.
  const tart = await tartEnvSane()
  if (!tart.ok) {
    return {
      error: "BASE_IMAGE_NOT_READY",
      message: `tart substrate unavailable: ${tart.reason ?? "unknown"}`,
      detail:
        "On substrates where Tart cannot write $HOME/Library/Caches (e.g. APFS `protect` volumes), the testbed cannot run. Re-run on a developer machine.",
    }
  }

  // (2) Validate the VSIX path/SHA against the trusted artifact root.
  const vsix = validateVsixPath(vsixPath, vsixSha256)
  if (!vsix.ok) {
    return {
      error: vsix.error,
      message: vsix.message,
      detail: `vsix_path=${vsixPath}`,
    }
  }

  // (3) CORRECTION03 fail-closed gate: the testbed refuses to run
  // unless the testbed image AND the SSH key AND the editor
  // baseline are all pinned via the trusted testbed config
  // ($HOME/.clinemm/testbed/config.json). The C helper forwards
  // HOME but no other testbed-relevant variables, so the config
  // file is the ONLY authority reachable from the production
  // execve(2) seam. Without this gate, the runner would silently
  // fall back to the un-qualified generic base image.
  //
  // Resolution order (each layer may override the previous one):
  //   1. $HOME/.clinemm/testbed/config.json (production authority;
  //      produced by testbed-image.ts after live qualification)
  //   2. CLINEMM_TART_TESTBED_IMAGE / CLINEMM_TESTBED_SSH_KEY_PATH /
  //      CLINEMM_TESTBED_EDITOR_BINARY / CLINEMM_TESTBED_EDITOR_VERSION
  //      (developer override for unit tests; cannot reach production
  //      because the C helper does not forward them)
  //   3. null → fail closed
  //
  // The config file MUST be present for the production seam. Env
  // overrides alone would mean: the C helper could not have set
  // them, so the testbed must already be in the developer-override
  // shape (e.g. running under `bun tools/.../runner.ts` directly).
  let pinnedImageDigest: string | null = null
  let pinnedKeyPath: string | null = null
  let pinnedBinary: string | null = null
  let pinnedVersion: string | null = null
  let pinnedHostPublicKey: string | null = null

  // Layer 1: trusted config file under HOME.
  const homeDir = process.env.HOME ?? null
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null
  const cfg = readTrustedTestbedConfig({ homeDir, currentUid })
  if (cfg.ok) {
    pinnedImageDigest = cfg.config.image
    pinnedKeyPath = cfg.config.ssh_key_path
    pinnedBinary = cfg.config.editor_binary
    pinnedVersion = cfg.config.editor_version
    pinnedHostPublicKey = cfg.config.ssh_host_public_key
  }

  // Layer 2: env overrides win over absent config fields. They do
  // NOT override a valid config file — that would defeat the
  // purpose of the trusted artifact. If both are present, the
  // config file wins (logged below as a warning).
  if (cfg.ok) {
    if (
      TART_TESTBED_IMAGE != null ||
      TESTBED_SSH_KEY_PATH != null ||
      TESTBED_EDITOR_BINARY != null ||
      TESTBED_EDITOR_VERSION != null ||
      TESTBED_SSH_HOST_PUBLIC_KEY != null
    ) {
      process.stderr.write(
        "[runner] CORRECTION03: trusted testbed config is loaded; " +
          "ignoring CLINEMM_* env overrides (env cannot reach the " +
          "production C-helper execve seam, so config is the only " +
          "authoritative source).\n",
      )
    }
  } else {
    // No config → fall back to env (developer-override seam).
    pinnedImageDigest = TART_TESTBED_IMAGE
    pinnedKeyPath = TESTBED_SSH_KEY_PATH
    pinnedBinary = TESTBED_EDITOR_BINARY
    pinnedVersion = TESTBED_EDITOR_VERSION
    pinnedHostPublicKey = TESTBED_SSH_HOST_PUBLIC_KEY
  }

  if (pinnedImageDigest == null) {
    if (cfg.ok === false) {
      return {
        error: "BASE_IMAGE_NOT_READY",
        message: cfg.error,
        detail: `configPath=${cfg.configPath}`,
      }
    }
    return {
      error: "BASE_IMAGE_NOT_READY",
      message: "CLINEMM_TART_TESTBED_IMAGE is not pinned; the testbed refuses to run against an un-qualified base image (CORRECTION03 contract).",
      detail: "Run `bun tools/macos-vsix-testbed/testbed-image.ts` once on a developer Mac to produce the qualified testbed image and write $HOME/.clinemm/testbed/config.json.",
    }
  }
  if (pinnedKeyPath == null) {
    return {
      error: "BASE_IMAGE_NOT_READY",
      message: "testbed SSH key path is not pinned; the testbed refuses BatchMode=yes without a pinned key (CORRECTION03 contract).",
      detail: "Provision an SSH keypair, install the public key into the qualified image, and write ssh_key_path into $HOME/.clinemm/testbed/config.json.",
    }
  }
  if (pinnedHostPublicKey == null) {
    return {
      error: "BASE_IMAGE_NOT_READY",
      message: "testbed SSH HOST public key is not pinned; the testbed refuses StrictHostKeyChecking=yes without a pinned server identity (CORRECTION03 round 5 contract, round 7 provenance).",
      detail: "Generate an sshd host key pair on the dev Mac (`ssh-keygen -t ed25519 -N '' -f ./qual-host-ed25519`), inject it into the qualification VM, run the in-guest conservation check, and write ssh_host_public_key (= the operator's PUBLIC key) into $HOME/.clinemm/testbed/config.json. The captured-from-guest value is NOT the root of trust — only the operator's pre-generated key is. Do NOT use `ssh-keyscan` (unauthenticated wire observation) and do NOT rely on `cat /etc/ssh/ssh_host_*_key.pub` over the password-bootstrap channel as the root authority.",
    }
  }
  const baseline = editorBaseline({
    pinnedBinary,
    pinnedVersion,
  })
  if (!baseline.ok) {
    return {
      error: "BASE_IMAGE_NOT_READY",
      message: `${baseline.error} (CORRECTION03 contract).`,
      detail: "Pin editor_binary and editor_version into $HOME/.clinemm/testbed/config.json to the values baked into the qualified image.",
    }
  }

  // Wire the resolved pins back into the module-level constants so
  // guest-smoke.ts (which calls pinnedSshAndEditor()) sees the same
  // values that were just validated by the gate.
  TART_TESTBED_IMAGE = pinnedImageDigest
  TESTBED_SSH_KEY_PATH = pinnedKeyPath
  TESTBED_EDITOR_BINARY = pinnedBinary
  TESTBED_EDITOR_VERSION = pinnedVersion
  TESTBED_SSH_HOST_PUBLIC_KEY = pinnedHostPublicKey

  // (4) Execute the guest-side smoke (clone, boot, install, smoke).
  const smoke = await runInstalledVsixSmoke({
    subjectHead,
    vsixHostPath: vsix.real,
    vsixHostSha256: vsix.hostSha256,
    baseImage: TART_TESTBED_IMAGE,
    vmName: vmNameFor(requestId),
    phaseBudgetMs: PHASE_BUDGET_MS,
  })
  if (!smoke.ok) {
    return {
      error: smoke.error,
      message: smoke.message,
      detail: smoke.detail,
    }
  }

  return {
    result: {
      subject_head: subjectHead,
      vsix_sha256: vsixSha256,
      host_sha256: vsix.hostSha256,
      guest_vsix_sha256: smoke.guestSha256,
      extension_id: smoke.extensionId,
      extension_version: smoke.extensionVersion,
      guest_image: TART_TESTBED_IMAGE,
      base_image: TART_TESTBED_IMAGE,
      guest_macos_version: smoke.guestMacosVersion,
      vscode_version: smoke.vscodeVersion,
      activation: "pass",
      red_without_extension: smoke.redWithoutExtension,
      cleanup: smoke.cleanup,
      ephemeral_vm_name: smoke.ephemeralVmName,
      tart_invocations: smoke.tartInvocations,
      host_hostname: hostname(),
    },
  }
}

// Entrypoint guard: only run when this file is invoked directly.
const argv1 = process.argv[1] ?? ""
if (argv1.endsWith("runner.ts") || argv1.endsWith("runner.js")) {
  void (async () => {
    const result = await run(process.argv.slice(2))
    process.stdout.write(JSON.stringify(result) + "\n")
    process.exit("result" in result ? 0 : 2)
  })()
}
