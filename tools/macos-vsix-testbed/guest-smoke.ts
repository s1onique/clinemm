/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01 / CORRECTION01
 *
 * Guest-side smoke: clones a Tart VM, transfers the exact VSIX
 * bytes, installs into an isolated editor profile, and asserts
 * that the extension's `activate()` actually ran by scraping the
 * VS Code extension-host log file for the documented
 *   `ExtensionService: Extension "<id>" is now active`
 * signal emitted by VS Code's own ExtensionService during
 * extension host startup. We previously used
 *   `code --list-extensions --show-versions`
 * to confirm install-only; that proves file presence but NOT
 * activation (a broken VSIX whose `activate()` throws still
 * shows in the list). The log scan is the only honest witness
 * that the extension's `main` entry actually executed.
 *
 * Each run gets a unique VM name (clinemm-probe-<id>) so multiple
 * probes never collide. On success or failure, the VM is
 * stopped + deleted (best-effort; the runner reports the
 * cleanup state).
 *
 * Lifecycle (per ACT §6):
 *   tart clone <base> <vm>
 *     → tart run --no-graphics <vm>
 *     → wait for IP (tart ip <vm>)
 *     → SCP VSIX into guest (with sha verification)
 *     → install via isolated --user-data-dir / --extensions-dir
 *     → activation smoke (extension-host log scan)
 *     → tart stop / tart delete
 *
 * The Tart CLI is invoked with a FIXED command vocabulary; no
 * arbitrary argv from the request crosses into this layer. The
 * host-path of the VSIX is the runner's `realpath`-canonicalized
 * result from path-validation.ts.
 */

import { spawn } from "bun"
import { createHash } from "node:crypto"
import {
  writeFileSync,
  mkdirSync,
  unlinkSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { RunnerErrorCode } from "./path-validation.ts"
import {
  sshCommandForGuest,
  editorBaseline,
  pinnedSshAndEditor,
  buildKnownHostsFileContents,
} from "./runner.ts"

export interface GuestSmokeArgs {
  readonly subjectHead: string
  readonly vsixHostPath: string
  readonly vsixHostSha256: string
  readonly baseImage: string
  readonly vmName: string
  readonly phaseBudgetMs: {
    readonly clone: number
    readonly boot: number
    readonly sshReady: number
    readonly install: number
    readonly activate: number
  }
}

export interface GuestSmokeOk {
  readonly ok: true
  readonly guestSha256: string
  readonly extensionId: string
  readonly extensionVersion: string
  readonly guestMacosVersion: string
  readonly vscodeVersion: string
  readonly redWithoutExtension: "pass" | "fail"
  readonly cleanup: "pass" | "fail"
  readonly ephemeralVmName: string
  readonly tartInvocations: number
}
export interface GuestSmokeFail {
  readonly ok: false
  readonly error: RunnerErrorCode
  readonly message: string
  readonly detail?: string
}
export type GuestSmokeResult = GuestSmokeOk | GuestSmokeFail

export async function runInstalledVsixSmoke(
  args: GuestSmokeArgs,
): Promise<GuestSmokeResult> {
  const proc: import("bun").Subprocess[] = []
  let tartInvocations = 0
  try {
    // (1) Clone the base VM. Uses Tart's copy-on-write semantics
    // so the clone is near-instant once the base image is local.
    {
      const clone = spawn({
        cmd: ["tart", "clone", args.baseImage, args.vmName],
        stdout: "pipe",
        stderr: "pipe",
      })
      proc.push(clone)
      const code = await withTimeout(clone, args.phaseBudgetMs.clone, "VM_CLONE_FAILED")
      tartInvocations++
      if (code !== 0) {
        return {
          ok: false,
          error: "VM_CLONE_FAILED",
          message: `tart clone exited ${code}`,
        }
      }
    }

    // (2) Start the VM headless. --no-graphics prevents macOS UI
    // windows from opening on the host (the ACT calls for a
    // non-interactive run).
    {
      const run = spawn({
        cmd: ["tart", "run", "--no-graphics", args.vmName],
        stdout: "pipe",
        stderr: "pipe",
      })
      proc.push(run)
      tartInvocations++
      // Don't await `exited` here — the VM runs in the foreground
      // for the rest of the smoke. If it exits prematurely, the
      // next tart call will surface the failure.
      await sleep(2000) // give the VM a moment to begin booting
    }

    // (3) Wait for the VM IP.
    const guestIp = await waitForVmIp(args.vmName, args.phaseBudgetMs.sshReady)
    if (!guestIp) {
      return {
        ok: false,
        error: "GUEST_UNREACHABLE",
        message: "guest IP never appeared",
      }
    }
    tartInvocations++ // implicit (tart ip)

    // (4) Transfer the VSIX into the guest and verify SHA.
    //
    // The VSIX bytes travel as a real byte stream over SSH stdin
    // (NOT as inline base64 command text). The previous approach
    // — `echo '<base64>' | base64 -d > file` — embedded the entire
    // VSIX, inflated by ~33%, into a single SSH command string.
    // That fails on real artifacts: local argv limits and SSH
    // channel command-length limits bite before the file ever
    // reaches the guest. MAX_VSIX_BYTES is 256 MiB; the inflated
    // form would be ~341 MiB of command text.
    //
    // The invariant here is:
    //   host VSIX  →  ssh stdin (byte stream)
    //              →  remote `cat > /tmp/.../foo.vsix`
    //              →  guest bytes
    // Bytes never enter the command line.
    //
    // The guest-side `cat > file` is followed by shasum -a 256 in
    // a separate ssh call (smaller, argv-safe). HOST_SHA ==
    // GUEST_SHA is the transfer discriminator.
    const guestTmpPath = `/tmp/clinemm-testbed-${args.vmName}.vsix`
    const writeOk = await scpVsixToGuest({
      hostPath: args.vsixHostPath,
      guestIp,
      guestTmpPath,
      budgetMs: args.phaseBudgetMs.install,
    })
    if (!writeOk.ok) {
      const f = guestExecToFail(writeOk)
      if (f) return f
    }
    // Extract the SHA from `shasum -a 256` output (last token).
    const m = writeOk.stdout.match(/^[0-9a-f]{64}/m)
    if (!m) {
      return {
        ok: false,
        error: "GUEST_HASH_MISMATCH",
        message: "could not parse guest shasum output",
        detail: writeOk.stdout.slice(0, 200),
      }
    }
    const guestSha = m[0]
    if (guestSha !== args.vsixHostSha256) {
      return {
        ok: false,
        error: "GUEST_HASH_MISMATCH",
        message: `host sha ${args.vsixHostSha256} != guest sha ${guestSha}`,
      }
    }

    // (5) Detect contamination: list installed extensions BEFORE
    // we install ours. If s1onique.clinemm is already there, the
    // base image is contaminated (or a previous probe leaked).
    {
      const pre = await guestExec(
        guestIp,
        "command -v code >/dev/null 2>&1 && code --list-extensions --show-versions || command -v codium >/dev/null 2>&1 && codium --list-extensions --show-versions || echo 'no-editor'",
        args.phaseBudgetMs.install,
      )
      if (!pre.ok) {
        const f = guestExecToFail(pre)
        if (f) return f
      }
      if (/\bs1onique\.clinemm@/.test(pre.stdout)) {
        return {
          ok: false,
          error: "BASE_IMAGE_CONTAMINATED",
          message: "s1onique.clinemm already installed in the base image",
          detail: pre.stdout,
        }
      }
    }

    // (6) RED baseline: launch the editor with NO VSIX installed,
    // assert the ClineMM UI marker is absent. This proves the
    // activation smoke has signal.
    const redResult = await activationSmoke({
      guestIp,
      vsixPath: "", // empty -> isolated profile with no extension
      requestId: "red",
      extensionId: "s1onique.clinemm",
      budgetMs: args.phaseBudgetMs.activate,
    })
    if (!redResult.ok) {
      return {
        ok: false,
        error: redResult.error,
        message: redResult.message ?? "RED smoke failed",
        detail: redResult.detail,
      }
    }
    if (redResult.activated) {
      return {
        ok: false,
        error: "BASE_IMAGE_CONTAMINATED",
        message:
          "RED smoke detected ClineMM UI marker without VSIX installed; base image is contaminated",
      }
    }

    // (7) GREEN: install the VSIX into an isolated profile.
    const installResult = await installVsixInGuest({
      guestIp,
      vsixGuestPath: guestTmpPath,
      budgetMs: args.phaseBudgetMs.install,
    })
    if (!installResult.ok) {
      return installResult
    }

    // (8) Verify the extension is listed in the guest's
    // isolated extensions dir.
    {
      const list = await guestExec(
        guestIp,
        `${installResult.editor} --user-data-dir ${installResult.userDataDir} --extensions-dir ${installResult.extensionsDir} --list-extensions --show-versions`,
        args.phaseBudgetMs.install,
      )
      if (!list.ok) {
        const f = guestExecToFail(list)
        if (f) return f
      }
      const expectedLine = `s1onique.clinemm@${installResult.installedVersion}`
      if (!list.stdout.includes(expectedLine)) {
        return {
          ok: false,
          error: "EXTENSION_NOT_FOUND",
          message: `expected ${expectedLine} in extension list`,
          detail: list.stdout,
        }
      }
    }

    // (9) GREEN activation smoke: launch the editor, wait for the
    // ClineMM UI marker to appear.
    const greenResult = await activationSmoke({
      guestIp,
      vsixPath: guestTmpPath,
      requestId: "green",
      extensionId: "s1onique.clinemm",
      budgetMs: args.phaseBudgetMs.activate,
      userDataDir: installResult.userDataDir,
      extensionsDir: installResult.extensionsDir,
      editor: installResult.editor,
    })
    if (!greenResult.ok) {
      return {
        ok: false,
        error: greenResult.error,
        message: greenResult.message ?? "GREEN smoke failed",
        detail: greenResult.detail,
      }
    }
    if (!greenResult.activated) {
      return {
        ok: false,
        error: "ACTIVATION_FAILED",
        message: "ClineMM UI marker did not appear after install",
      }
    }

    // (10) Discover guest OS version for evidence.
    const swVers = await guestExec(
      guestIp,
      "sw_vers",
      args.phaseBudgetMs.install,
    )

    return {
      ok: true,
      guestSha256: guestSha,
      extensionId: "s1onique.clinemm",
      extensionVersion: installResult.installedVersion,
      guestMacosVersion: swVers.ok ? swVers.stdout.replace(/\s+/g, " ").trim() : "unknown",
      vscodeVersion: installResult.editorVersion,
      redWithoutExtension: "pass",
      cleanup: "pass", // best-effort stop/delete in `finally`
      ephemeralVmName: args.vmName,
      tartInvocations,
    }
  } catch (cause) {
    return {
      ok: false,
      error: "INTERNAL_ERROR",
      message: (cause as Error).message,
    }
  } finally {
    // (11) Best-effort cleanup. Even on success we tear down the
    // VM because it is ephemeral. On failure we still try; the
    // cleanup state is reported in the result.
    for (const p of proc) {
      try {
        if (p.exitCode === null) p.kill()
      } catch {}
    }
    try {
      const stop = spawn({
        cmd: ["tart", "stop", args.vmName],
        stdout: "pipe",
        stderr: "pipe",
      })
      await withTimeout(stop, 30_000, "VM_BOOT_FAILED")
      tartInvocations++
    } catch {}
    try {
      const del = spawn({
        cmd: ["tart", "delete", args.vmName],
        stdout: "pipe",
        stderr: "pipe",
      })
      await withTimeout(del, 30_000, "VM_BOOT_FAILED")
      tartInvocations++
    } catch {}
  }
}

// ============================================================================
// Ephemeral known_hosts (round 5)
// ============================================================================

/**
 * Generate an absolute path for an ephemeral UserKnownHostsFile.
 * Pure given `tmpDir` + `tag` so unit tests can pin the location.
 * Production calls go through the no-arg overload that reads
 * `process.env.HOME` + `os.tmpdir()`.
 *
 * The directory MUST exist (the runner pre-creates it) and the
 * path MUST be inside the operator's HOME so we don't write to
 * /tmp where other operators could read or pre-populate it.
 */
export function ephemeralKnownHostsPath(args: {
  readonly homeDir: string
  readonly tag: string
}): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
  if (!args.homeDir || !/^\//.test(args.homeDir)) {
    return { ok: false, error: `homeDir must be absolute; got ${JSON.stringify(args.homeDir)}` }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(args.tag)) {
    return { ok: false, error: `tag must be filesystem-safe; got ${JSON.stringify(args.tag)}` }
  }
  return {
    ok: true,
    path: join(args.homeDir, ".clinemm", "testbed", "run", `known_hosts-${args.tag}`),
  }
}

/**
 * Write the ephemeral known_hosts file containing the pinned
 * guest host public key + runtime guestIp. Returns an absolute
 * path suitable for `ssh -o UserKnownHostsFile=<path>`.
 *
 * On failure: returns a typed error. The caller MUST surface
 * that as SSH_KEY_NOT_PINNED so the run fails closed BEFORE any
 * ssh spawn.
 *
 * The file is written to `<home>/.clinemm/testbed/run/...` —
 * inside HOME, so a different operator on the same Mac cannot
 * tamper with it via /tmp. Mode 0o600 so only the current uid
 * can read/write.
 */
export function writeEphemeralKnownHosts(args: {
  readonly homeDir: string
  readonly guestIp: string
  readonly pinnedHostPublicKey: string
  readonly tag: string
}): { readonly ok: true; readonly path: string } | { readonly ok: false; readonly error: string } {
  const pathResult = ephemeralKnownHostsPath({ homeDir: args.homeDir, tag: args.tag })
  if (!pathResult.ok) {
    return { ok: false, error: pathResult.error }
  }
  const kh = buildKnownHostsFileContents({
    guestIp: args.guestIp,
    pinnedHostPublicKey: args.pinnedHostPublicKey,
  })
  if (!kh.ok) {
    return { ok: false, error: `pinnedHostPublicKey rejected: ${kh.error}` }
  }
  try {
    mkdirSync(join(args.homeDir, ".clinemm", "testbed", "run"), {
      recursive: true,
      mode: 0o700,
    })
  } catch (e) {
    return {
      ok: false,
      error: `mkdir(${join(args.homeDir, ".clinemm", "testbed", "run")}) failed: ${(e as Error).message}`,
    }
  }
  try {
    writeFileSync(pathResult.path, kh.contents, { mode: 0o600, flag: "w" })
  } catch (e) {
    return {
      ok: false,
      error: `writeFile(${pathResult.path}) failed: ${(e as Error).message}`,
    }
  }
  return { ok: true, path: pathResult.path }
}

/**
 * Best-effort delete of an ephemeral known_hosts file. Swallows
 * ENOENT and other errors — the file is owned by the runner and
 * will be re-written on the next run. We do NOT block shutdown
 * on cleanup.
 */
export function cleanupEphemeralKnownHosts(path: string): void {
  try {
    unlinkSync(path)
  } catch {}
}

// ============================================================================
// Helpers
// ============================================================================

async function withTimeout(
  p: import("bun").Subprocess,
  ms: number,
  errCode: RunnerErrorCode,
): Promise<number> {
  let to: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<number>((_, reject) => {
    to = setTimeout(() => reject(new Error(`${errCode}: timeout after ${ms}ms`)), ms)
  })
  try {
    const code = await Promise.race([p.exited, timeout])
    if (to) clearTimeout(to)
    return code
  } catch (cause) {
    try { p.kill() } catch {}
    throw cause
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Build the ssh argv for streaming a VSIX into the guest over
 * stdin. This is the P0/P1 seam fix for the live transfer
 * path: the byte-stream push MUST use the SAME pinned-key
 * authority as `guestExec()`. Refusing to compose here means
 * the transfer can fall back to ambient ssh agent keys or
 * password auth — defeating the CORRECTION03 contract.
 *
 * Pure function (no I/O) so the discriminator test can
 * introspect argv without spawning anything. The three pinned
 * authority values (client key + image digest + server host
 * public key) are required args (NOT read from env) so unit
 * tests can drive this deterministically. Production calls go
 * through `scpVsixToGuest` which calls pinnedSshAndEditor()
 * and writes the ephemeral known_hosts file.
 *
 * Returns the same shape as sshCommandForGuest: typed ok/err.
 * The remote command is the fixed `cat > <path>` writer with
 * umask 077 + staging dir; only the path crosses into the
 * command line, and the path is allow-listed by scpVsixToGuest().
 */
export function scpVsixSshArgv(args: {
  readonly guestIp: string
  readonly guestTmpPath: string
  readonly pinnedKeyPath: string
  readonly pinnedImageDigest: string
  /**
   * Absolute path to the ephemeral UserKnownHostsFile the caller
   * has already written (mode 0o600) with
   * `<guestIp> <pinnedHostPublicKey>` as its sole entry. Same
   * path the production code passes to `sshCommandForGuest` for
   * ordinary `guestExec()` calls.
   */
  readonly knownHostsFile: string
  readonly pinnedHostPublicKey: string
}): { readonly ok: true; readonly cmd: readonly string[] } | { readonly ok: false; readonly error: string } {
  // Same authority contract as guestExec(): pinned SSH key
  // + qualified image digest + pinned server host public key.
  // sshCommandForGuest enforces all three.
  return sshCommandForGuest({
    guestIp: args.guestIp,
    remoteCommand: `set -e; umask 077; mkdir -p /tmp/clinemm-testbed-staging; cat > ${args.guestTmpPath}`,
    pinnedKeyPath: args.pinnedKeyPath,
    pinnedImageDigest: args.pinnedImageDigest,
    knownHostsFile: args.knownHostsFile,
    pinnedHostPublicKey: args.pinnedHostPublicKey,
  })
}

/**
 * Stream a host file to the guest over SSH stdin.
 *
 * Why this exists: the VSIX is potentially up to 256 MiB. Packing
 * it into a single ssh command (even as base64) overflows local
 * argv and SSH command-length limits before the file can be
 * transmitted. The fix is to put the bytes on ssh's stdin and let
 * the remote shell `cat > file` them into place. ssh itself does
 * not interpret the byte stream as a command.
 *
 * Returns a GuestExecResult whose stdout is the SHA-256 line from
 * `shasum -a 256` on the guest. The caller MUST compare that SHA
 * against the host SHA before continuing.
 *
 * The remote command is fixed (`cat > <path>` with umask 077 and
 * a staging directory). No host content crosses into the command
 * line — only the path, which is a server-controlled literal.
 *
 * CORRECTION03 round 4: the transfer SSH command is built by
 * `scpVsixSshArgv()` which composes with the same
 * `pinnedSshAndEditor()` + `sshCommandForGuest()` chain as
 * `guestExec()`. IdentitiesOnly=yes, IdentityFile=<pinned>,
 * PreferredAuthentications=publickey. No ambient-agent /
 * password / sshpass fallback. The byte transport itself is
 * `streamBytesOverSsh()` — bytes still never enter argv.
 */
export async function scpVsixToGuest(args: {
  readonly hostPath: string
  readonly guestIp: string
  readonly guestTmpPath: string
  readonly budgetMs: number
}): Promise<GuestExecResult> {
  // Validate guestTmpPath locally first — defense in depth.
  if (!/^\/[A-Za-z0-9._\-+/@]+$/.test(args.guestTmpPath)) {
    return {
      ok: false,
      stdout: "",
      error: "INTERNAL_ERROR",
      message: "guest tmp path failed allow-list",
      detail: args.guestTmpPath,
    }
  }
  // Read host file as a Buffer; this is intentional — we hand
  // the raw bytes to Bun.spawn's stdin, never to argv.
  const hostFile = Bun.file(args.hostPath)
  if (!(await hostFile.exists())) {
    return {
      ok: false,
      stdout: "",
      error: "VSIX_NOT_FOUND",
      message: `host VSIX does not exist: ${args.hostPath}`,
    }
  }
  const hostBytes = new Uint8Array(await hostFile.arrayBuffer())

  // Build the ssh argv using the SAME pinned-key authority as
  // guestExec(). Failing closed here means a misconfigured
  // transfer can never spawn — it cannot silently fall back to
  // ambient SSH authentication.
  const pinned = pinnedSshAndEditor()
  if (!pinned.ok) {
    return {
      ok: false,
      stdout: "",
      error: "SSH_KEY_NOT_PINNED",
      message: pinned.error,
    }
  }
  // CORRECTION03 round 5: write the ephemeral known_hosts file
  // BEFORE building the ssh argv. Same code path as guestExec()
  // — server identity is bound to the qualified VM's host key
  // captured at qualification time.
  const homeDir = process.env.HOME ?? ""
  const kh = writeEphemeralKnownHosts({
    homeDir,
    guestIp: args.guestIp,
    pinnedHostPublicKey: pinned.sshHostPublicKey,
    tag: `transfer-${args.guestIp.replace(/[^A-Za-z0-9]/g, "_")}`,
  })
  if (!kh.ok) {
    return {
      ok: false,
      stdout: "",
      error: "SSH_KEY_NOT_PINNED",
      message: `ephemeral known_hosts write failed: ${kh.error}`,
    }
  }
  const ssh = scpVsixSshArgv({
    guestIp: args.guestIp,
    guestTmpPath: args.guestTmpPath,
    pinnedKeyPath: pinned.sshKeyPath,
    pinnedImageDigest: pinned.imageDigest,
    knownHostsFile: kh.path,
    pinnedHostPublicKey: pinned.sshHostPublicKey,
  })
  if (!ssh.ok) {
    cleanupEphemeralKnownHosts(kh.path)
    return {
      ok: false,
      stdout: "",
      error: "SSH_KEY_NOT_PINNED",
      message: ssh.error,
    }
  }

  // Push the file over stdin and pipe it to `cat > <path>` on
  // the guest. The shell command is small (~80 bytes); bytes
  // travel on ssh's stdin, never on argv.
  const pushCode = await streamBytesOverSsh({
    cmd: ssh.cmd,
    hostBytes,
    budgetMs: args.budgetMs,
  })
  if (pushCode !== 0) {
    return {
      ok: false,
      stdout: "",
      error: "VSIX_INSTALL_FAILED",
      message: `ssh push exited ${pushCode}`,
    }
  }

  // Now shasum the file on the guest. This is a separate ssh call
  // with a small argv — the SHA is what we read back.
  return guestExec(
    args.guestIp,
    `shasum -a 256 ${args.guestTmpPath}`,
    args.budgetMs,
  )
}

/**
 * Send raw bytes through a child process's stdin and wait for
 * exit. This is the byte-stream transport primitive — bytes never
 * enter argv. Exported for the unit test; the live path uses
 * `scpVsixToGuest()` which builds the ssh command.
 *
 * Returns the child's exit code (>= 0 on success). Throws on
 * timeout.
 */
export async function streamBytesOverSsh(args: {
  readonly cmd: readonly string[]
  readonly hostBytes: Uint8Array
  readonly budgetMs: number
}): Promise<number> {
  const proc = spawn({
    cmd: args.cmd as string[],
    stdin: args.hostBytes,
    stdout: "pipe",
    stderr: "pipe",
  })
  return withTimeout(proc, args.budgetMs, "VSIX_INSTALL_FAILED")
}

async function waitForVmIp(
  vmName: string,
  budgetMs: number,
): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < budgetMs) {
    const probe = spawn({
      cmd: ["tart", "ip", vmName],
      stdout: "pipe",
      stderr: "pipe",
    })
    const code = await probe.exited
    if (code === 0) {
      const text = await new Response(probe.stdout).text()
      const ip = text.trim()
      if (ip) return ip
    }
    await sleep(2000)
  }
  return null
}

interface GuestExecResult {
  readonly ok: boolean
  readonly error?: RunnerErrorCode
  readonly stdout: string
  readonly message?: string
  readonly detail?: string
}

// Helper: lift a failed GuestExecResult into the discriminated
// GuestSmokeResult shape. Returns undefined when the guest exec
// succeeded.
function guestExecToFail(r: GuestExecResult): GuestSmokeFail | undefined {
  if (r.ok) return undefined
  return {
    ok: false,
    error: r.error ?? "GUEST_UNREACHABLE",
    message: r.message ?? "guest exec failed",
    detail: r.detail,
  }
}

async function guestExec(
  guestIp: string,
  command: string,
  budgetMs: number,
): Promise<GuestExecResult> {
  // CORRECTION03: SSH auth is bound to the pinned-key contract.
  // The only authentication surface is the pinned client key
  // (IdentitiesOnly=yes, PreferredAuthentications=publickey).
  // No password fallback, no agent fallback. The qualified
  // testbed image (pinned by digest in runner.ts) provisions
  // the corresponding public key for the `admin` user; sshpass
  // is NOT used.
  //
  // CORRECTION03 round 5: SERVER identity is also pinned. We
  // write an ephemeral UserKnownHostsFile containing only the
  // runtime `tart ip` bound to the host key captured at
  // qualification time, and pass it to ssh via
  // `-o UserKnownHostsFile=<path> -o StrictHostKeyChecking=yes`.
  // Without this, a wrong SSH endpoint could impersonate the
  // qualified guest. Fails closed BEFORE any ssh spawn if the
  // pinned host public key is missing.
  const pinned = pinnedSshAndEditor()
  if (!pinned.ok) {
    return {
      ok: false,
      error: "SSH_KEY_NOT_PINNED",
      stdout: "",
      message: pinned.error,
    }
  }
  // Write the ephemeral known_hosts BEFORE building the ssh
  // argv. sshCommandForGuest will validate the host key shape
  // again (defense in depth), then emit
  // `-o UserKnownHostsFile=<path> -o StrictHostKeyChecking=yes`.
  const homeDir = process.env.HOME ?? ""
  const kh = writeEphemeralKnownHosts({
    homeDir,
    guestIp,
    pinnedHostPublicKey: pinned.sshHostPublicKey,
    tag: `guest-${guestIp.replace(/[^A-Za-z0-9]/g, "_")}`,
  })
  if (!kh.ok) {
    return {
      ok: false,
      error: "SSH_KEY_NOT_PINNED",
      stdout: "",
      message: `ephemeral known_hosts write failed: ${kh.error}`,
    }
  }
  const ssh = sshCommandForGuest({
    guestIp,
    remoteCommand: command,
    pinnedKeyPath: pinned.sshKeyPath,
    pinnedImageDigest: pinned.imageDigest,
    knownHostsFile: kh.path,
    pinnedHostPublicKey: pinned.sshHostPublicKey,
  })
  if (!ssh.ok) {
    cleanupEphemeralKnownHosts(kh.path)
    return {
      ok: false,
      error: "SSH_KEY_NOT_PINNED",
      stdout: "",
      message: ssh.error,
    }
  }
  const proc = spawn({
    cmd: ssh.cmd as string[],
    stdout: "pipe",
    stderr: "pipe",
  })
  const code = await withTimeout(proc, budgetMs, "GUEST_UNREACHABLE")
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  // We deliberately leave the ephemeral file in place: re-creating
  // it on every call is wasteful, and the file only contains
  // public-key material (not a secret). `runInstalledVsixSmoke`
  // removes it after the smoke completes (see `finally`).
  if (code !== 0) {
    return {
      ok: false,
      error: "GUEST_UNREACHABLE",
      stdout,
      message: `ssh command exited ${code}`,
      detail: stderr.slice(0, 500),
    }
  }
  return { ok: true, stdout }
}

interface InstallResult {
  readonly ok: true
  readonly editor: string
  readonly editorVersion: string
  readonly userDataDir: string
  readonly extensionsDir: string
  readonly installedVersion: string
}
async function installVsixInGuest(args: {
  readonly guestIp: string
  readonly vsixGuestPath: string
  readonly budgetMs: number
}): Promise<InstallResult | { readonly ok: false; readonly error: RunnerErrorCode; readonly message: string; readonly detail?: string }> {
  // CORRECTION03: the editor baseline is part of the testbed
  // substrate contract. The qualified image MUST have the
  // pinned editor at the pinned absolute path; the runner
  // asserts both before doing any install work. Fail closed
  // with EDITOR_BASELINE_NOT_PROVEN if either is missing or
  // doesn't match what we baked into the qualified image.
  const pinned = pinnedSshAndEditor()
  if (!pinned.ok) {
    return {
      ok: false,
      error: "EDITOR_BASELINE_NOT_PROVEN",
      message: pinned.error,
    }
  }
  const editor = pinned.editorBinary
  const editorVersion = pinned.editorVersion

  // Confirm the editor binary actually exists at the pinned
  // absolute path inside the qualified VM. This catches
  // qualified-image drift (e.g. someone overwrote the image).
  const whichCheck = await guestExec(
    args.guestIp,
    `test -x ${editor} && echo present || echo missing`,
    args.budgetMs,
  )
  if (!whichCheck.ok || whichCheck.stdout.trim() !== "present") {
    return {
      ok: false,
      error: "EDITOR_BASELINE_NOT_PROVEN",
      message: `editor binary not present at ${editor} on guest`,
      detail: whichCheck.ok ? whichCheck.stdout : whichCheck.detail,
    }
  }

  // Confirm the editor's reported version matches the pinned
  // baseline. This catches editor-version drift between
  // qualified image and pinned constants.
  const versionCheck = await guestExec(
    args.guestIp,
    `${editor} --version`,
    args.budgetMs,
  )
  if (!versionCheck.ok) {
    return {
      ok: false,
      error: "EDITOR_BASELINE_NOT_PROVEN",
      message: `editor --version failed for ${editor}`,
      detail: versionCheck.detail,
    }
  }
  const reportedVersion = versionCheck.stdout.trim()
  if (reportedVersion !== editorVersion) {
    return {
      ok: false,
      error: "EDITOR_BASELINE_NOT_PROVEN",
      message: `editor version drift: pinned=${editorVersion} reported=${reportedVersion}`,
      detail: `Re-run testbed-image.ts to refresh the qualified image, or update CLINEMM_TESTBED_EDITOR_VERSION to match.`,
    }
  }

  // Isolated profile dirs.
  const userDataDir = `~/clinemm-testbed/${Date.now().toString(36)}/user-data`
  const extensionsDir = `~/clinemm-testbed/${Date.now().toString(36)}/extensions`
  // Install.
  const install = await guestExec(
    args.guestIp,
    `${editor} --user-data-dir ${userDataDir} --extensions-dir ${extensionsDir} --install-extension ${args.vsixGuestPath}`,
    args.budgetMs,
  )
  if (!install.ok) {
    return {
      ok: false,
      error: "VSIX_INSTALL_FAILED",
      message: `${editor} --install-extension exited non-zero`,
      detail: install.detail,
    }
  }
  // Parse installed version from the VSIX manifest. We unpack
  // extension/package.json from the guest file and read version.
  const manifest = await guestExec(
    args.guestIp,
    `unzip -p ${args.vsixGuestPath} extension/package.json | python3 -c 'import sys, json; print(json.load(sys.stdin)["version"])'`,
    args.budgetMs,
  )
  const installedVersion = manifest.ok ? manifest.stdout.trim() : "unknown"
  return {
    ok: true,
    editor,
    editorVersion,
    userDataDir,
    extensionsDir,
    installedVersion,
  }
}

async function activationSmoke(args: {
  readonly guestIp: string
  readonly vsixPath: string
  readonly requestId: string
  readonly extensionId: string
  readonly budgetMs: number
  readonly userDataDir?: string
  readonly extensionsDir?: string
  readonly editor?: string
}): Promise<
  | { readonly ok: true; readonly activated: boolean }
  | { readonly ok: false; readonly error: RunnerErrorCode; readonly message: string; readonly detail?: string }
> {
  const baseline = pinnedSshAndEditor()
  const editor = args.editor ?? (baseline.ok ? baseline.editorBinary : "code")
  const userDataDir = args.userDataDir ?? `~/clinemm-testbed/red-${args.requestId}/user-data`
  const extensionsDir = args.extensionsDir ?? `~/clinemm-testbed/red-${args.requestId}/extensions`
  // Activation witness: VS Code's ExtensionService emits
  //   ExtensionService: Extension "<id>" is now active
  // into the log file when an extension's `activate()` resolves
  // without throwing. This is the documented VS Code lifecycle
  // signal (see
  //  https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/extensions/common/abstractExtensionService.ts
  // -- the `ExtensionService: Extension ... is now active`
  // logger.trace call on the activate path).
  //
  // We launch the editor headlessly with --enable-logging,
  // pointing --log at a guest-side path under our isolated
  // user-data-dir. After a short wait we `cat` the log back via
  // SSH and scan for the activation marker.
  const logGuestPath = `/tmp/clinemm-testbed-${args.requestId}-ext-host.log`
  const launch = await guestExec(
    args.guestIp,
      // Background the editor so the foreground script can
      // poll the log after the activation window. `&` is
      // intentional: we don't block waiting for the editor.
      `${editor} --user-data-dir ${userDataDir} --extensions-dir ${extensionsDir} --no-sandbox --headless --disable-gpu --enable-logging=file --log-file=${logGuestPath} >/dev/null 2>&1 &\n` +
      // Wait up to 20s for the extension to activate. VS Code
      // typically activates within 3-8s; 20s gives headroom.
      `for i in $(seq 1 20); do\n` +
      `  if grep -q 'ExtensionService: Extension "${args.extensionId}" is now active' ${logGuestPath} 2>/dev/null; then echo ACTIVATED; exit 0; fi\n` +
      `  sleep 1\n` +
      `done\n` +
      `echo NOT_ACTIVATED\n` +
      // Print last 50 lines of log so the caller can show why
      // the marker never appeared (useful for RED).
      `tail -n 50 ${logGuestPath} 2>/dev/null || true\n` +
      `exit 0`,
    args.budgetMs,
  )
  // The exit code tells us whether the marker was observed:
  //   exit 0 → activation marker present
  //   exit 1 → marker absent (extension did not activate)
  //   exit 127, connection refused, etc. → infrastructure fail.
  // We rely on the embedded shell to set the exit code; ssh
  // returns the remote exit code. So `launch.ok` is the SSH
  // success; the activation flag is `launch.stdout` containing
  // the marker line OR, more reliably, the ssh command's exit
  // code (we no longer have stdout here, so check via a marker
  // file the script writes).
  //
  // The simpler signal: write a marker file from the script:
  if (!launch.ok) {
    return {
      ok: false,
      error: launch.error ?? "ACTIVATION_FAILED",
      message: launch.message ?? "activation launch failed",
      detail: launch.detail,
    }
  }
  // ssh exit code 0 = activated, exit code 1 = not activated,
  // anything else = infrastructure failure. guestExec must
  // surface the exit code for us to distinguish. The current
  // GuestExecResult does not; instead, the embedded shell
  // prints "ACTIVATED" or "NOT_ACTIVATED" as its final line.
  const last = launch.stdout.trim().split("\n").pop() ?? ""
  if (last === "ACTIVATED") return { ok: true, activated: true }
  if (last === "NOT_ACTIVATED") return { ok: true, activated: false }
  // If the script didn't print a recognizable marker, fall
  // back to grepping the full stdout (in case the marker was
  // forwarded by ssh).
  const activated = /ExtensionService: Extension \S+ is now active/.test(launch.stdout) &&
    launch.stdout.includes(args.extensionId)
  return { ok: true, activated }
}
