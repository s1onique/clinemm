// =============================================================================
// test-helper-build.ts
//
// ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01:
// Source/build identity verification for the canonical helper
// binary at $SCRIPT_DIR/helper.
//
// Every native test that spawns the helper uses this module (via
// ensureHelperBinary()) instead of the old "existsSync(HELPER_BIN)
// and run build.sh if missing" pattern. The new contract is:
//
//   1. ALWAYS invoke build.sh (even if the file exists). The build
//      is atomic: compile to a unique temp file, codesign --force
//      with the canonical Identifier, codesign --verify --strict,
//      then mv to ./helper. Each build produces a new inode, so
//      the destination file's content matches the current source
//      bytes — not the bytes from some prior build that may have
//      been left in place by a manual `cc -o helper ...`.
//
//   2. Verify the destination's Mach-O Identifier is "helper"
//      (not "helper.ablated" or any other value). This is the
//      invariant that catches the in-place-overwrite hazard:
//      if a manual build accidentally produced a non-canonical
//      binary, the Identifier will be wrong, and the test
//      will fail loudly at suite-start rather than producing
//      confusing runtime crashes downstream.
//
//   3. Verify codesign --verify --strict passes on the
//      destination. A failed strict-verify means the signature
//      is corrupted or absent — never proceed to spawn.
//
//   4. Compute the expected build_id from the current source
//      bytes (same algorithm as build.sh) and assert the
//      compiled binary's embedded build_id matches. A mismatch
//      means the binary is older than the current source — the
//      atomic build above should prevent this, but the check is
//      defense in depth.
//
//   5. Record the artifact identity (sha256, inode, build_id,
//      mtime) to a sentinel file at $SCRIPT_DIR/.helper.identity
//      so other processes (the operator, a follow-up test) can
//      see the current artifact at a glance.
//
// The 6 native test files' beforeAll hooks are updated to call
// ensureHelperBinary() instead of the old existsSync+spawn-build
// pattern.
// =============================================================================

import { spawn } from "bun"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// The directory containing helper.c, helper (built), and build.sh.
const SCRIPT_DIR = import.meta.dir

const HELPER_BIN = join(SCRIPT_DIR, "helper")
const HELPER_SRC = join(SCRIPT_DIR, "helper.c")
const BUILD_SH = join(SCRIPT_DIR, "build.sh")
const IDENTITY_FILE = join(SCRIPT_DIR, ".helper.identity")

// The same ABI_VERSION as in build.sh and Makefile.
const ABI_VERSION =
  "TART_TESTBED_RUN_P0_DOGFOOD01_CORRECTION01_REAL_LIFECYCLE_INTEGRITY"

// The expected Mach-O Identifier for the canonical build.
const CANONICAL_IDENT = "helper"

// Run a child process and capture stdout/stderr text.
async function runChild(cmd: string[], cwd: string, timeoutMs: number) {
  const p = spawn({ cmd, cwd, stdio: ["ignore", "pipe", "pipe"] })
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ])
  // Wait for the timeout-or-exit race. p.exited is already settled
  // since the Promise.all resolved. We use a Promise.race only for
  // early cancellation if the caller wants it.
  if (typeof timeoutMs === "number") {
    // No-op: Promise.all above already waits for exit. The
    // timeoutMs parameter is reserved for future cancellation.
    void timeoutMs
  }
  return { stdout, stderr, code }
}

// Compute the expected build_id from the current source bytes using
// the same algorithm as build.sh. Used as a defense-in-depth check
// that the compiled binary was produced from the current source.
function expectedBuildIdFromSource(): string {
  const src = readFileSync(HELPER_SRC)
  // Use printf to write ABI_VERSION without a trailing newline, then
  // append the raw source bytes. The result is sha256.
  // We use a shell pipeline (via Bun.spawnSync cmd) so the printf +
  // cat happens atomically without buffering issues.
  const proc = Bun.spawnSync({
    cmd: ["sh", "-c", `printf '%s' '${ABI_VERSION}' | cat - '${HELPER_SRC}' | shasum -a 256`],
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString()
    throw new Error(
      `shasum failed (rc=${proc.exitCode}); cannot compute expected build_id; stderr=${stderr}`,
    )
  }
  const out = proc.stdout.toString().trim()
  // shasum format: "<hex>  -" or "<hex>  filename"; take the first token.
  const hex = out.split(/\s+/)[0]
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      `expected build_id is not 64 lowercase hex: '${hex}' (full='${out}')`,
    )
  }
  return hex
}

// Read the Mach-O LC_IDENT string from a binary using codesign -dvv.
// codesign's --display writes its output to STDERR (not stdout),
// which is a known macOS quirk. We use Bun.spawnSync so we can
// capture both stdout and stderr reliably, and concatenate them.
function readMachOIdentifier(path: string): string {
  const proc = Bun.spawnSync({
    cmd: ["codesign", "-dvv", path],
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = (proc.stdout.toString() + "\n" + proc.stderr.toString())
  if (proc.exitCode !== 0) {
    throw new Error(
      `codesign -dvv FAILED for ${path}: exit=${proc.exitCode} combined-output:\n${out}`,
    )
  }
  // codesign -dvv emits "Identifier=<string>" on its own line.
  const m = out.match(/^Identifier=(.+)$/m)
  if (!m) {
    throw new Error(
      `could not parse Identifier from codesign -dvv output for ${path}:\n${out}`,
    )
  }
  return m[1].trim()
}

// Run codesign --verify --strict. Returns true on rc=0, false
// otherwise. Throws on a non-zero codesign exit if throwOnFail
// is true.
function verifyStrict(path: string, throwOnFail = true): boolean {
  const proc = Bun.spawnSync({
    cmd: ["codesign", "--verify", "--strict", path],
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode === 0) return true
  if (throwOnFail) {
    const out =
      proc.stdout.toString() + "\n" + proc.stderr.toString()
    throw new Error(
      `codesign --verify --strict FAILED for ${path}: ` +
        `exit=${proc.exitCode} output:\n${out}`,
    )
  }
  return false
}

export interface HelperBuildIdentity {
  path: string
  sha256: string
  inode: number
  buildId: string
  machOIdentifier: string
  mtimeMs: number
  sizeBytes: number
  verifiedAt: string
}

// Run build.sh, then verify the produced binary against the
// canonical invariants. Returns the identity record for the
// freshly built binary.
//
// This is the only function tests should call. It enforces the
// bounded C1 contract: the binary at HELPER_BIN is a fresh
// build, atomically installed, Identifier=helper, strict-verify
// passes, and the build_id matches the current source.
export async function ensureHelperBinary(): Promise<HelperBuildIdentity> {
  // 1. Run build.sh. Even if HELPER_BIN exists, re-run it: the
  //    whole point of the bounded fix is that the destination
  //    file is the CURRENT build, not a stale leftover from a
  //    previous (possibly ablation) build.
  const build = await runChild(["bash", BUILD_SH], SCRIPT_DIR, 60_000)
  if (build.code !== 0) {
    throw new Error(
      `build.sh exited ${build.code}; stdout=${build.stdout}\nstderr=${build.stderr}`,
    )
  }

  // 2. The file must exist (build.sh guarantees it).
  if (!existsSync(HELPER_BIN)) {
    throw new Error(
      `build.sh exited 0 but ${HELPER_BIN} does not exist`,
    )
  }

  // 3. The Mach-O Identifier must be the canonical one. This is
  //    the load-bearing invariant: an ablation build (which would
  //    produce Identifier=helper.ablated) is NEVER permitted to
  //    satisfy a test that calls this function.
  const ident = readMachOIdentifier(HELPER_BIN)
  if (ident !== CANONICAL_IDENT) {
    throw new Error(
      `helper binary at ${HELPER_BIN} has Identifier='${ident}', ` +
        `expected '${CANONICAL_IDENT}'. This is the C1 atomic-build ` +
        `invariant: an ablation binary (or any other variant) cannot ` +
        `be at the canonical path. Re-run ./build.sh to rebuild ` +
        `from current source.`,
    )
  }

  // 4. codesign --verify --strict must pass. A non-strict-verify
  //    binary is exactly the in-place-build hazard Apple warns
  //    about: it would be killed by the kernel with "Code
  //    Signature Invalid" even though the on-disk signature
  //    appears valid.
  verifyStrict(HELPER_BIN, true)

  // 5. The embedded build_id must match the current source. This
  //    catches a stale binary that was atomically installed but
  //    produced from older source bytes (which build.sh cannot
  //    do in the normal flow, but the check is defense in depth).
  const stat = statSync(HELPER_BIN)
  const expected = expectedBuildIdFromSource()
  // We extract the build_id from the binary's own health response
  // OR from a quick text scan of the binary. The simplest
  // available witness is the __cstring section; for now we use
  // `strings`-like search for the expected hex.
  const bytes = readFileSync(HELPER_BIN)
  const haystack = bytes.toString("binary")
  if (!haystack.includes(expected)) {
    throw new Error(
      `helper binary at ${HELPER_BIN} does not contain the expected ` +
        `build_id (sha256 of ABI_VERSION + helper.c). Expected: ${expected}. ` +
        `The build script may have a different ABI_VERSION than this ` +
        `module, or the binary was built from older source.`,
    )
  }

  // 6. Compute the artifact identity. SHA-256 of the binary.
  const shaProc = Bun.spawnSync({
    cmd: ["shasum", "-a", "256", HELPER_BIN],
    stdout: "pipe",
    stderr: "pipe",
  })
  if (shaProc.exitCode !== 0) {
    throw new Error(
      `shasum FAILED for ${HELPER_BIN}: exit=${shaProc.exitCode} ` +
        `stderr=${shaProc.stderr.toString()}`,
    )
  }
  const sha = shaProc.stdout.toString().trim().split(/\s+/)[0]
  const inode = Number(stat.ino)
  const identity: HelperBuildIdentity = {
    path: HELPER_BIN,
    sha256: sha,
    inode,
    buildId: expected,
    machOIdentifier: ident,
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
    verifiedAt: new Date().toISOString(),
  }

  // 7. Write a sentinel file so other processes (or the next
  //    test run) can see the current artifact identity at a
  //    glance. NOT a hard invariant (the next test run will
  //    rebuild anyway) — a debugging aid.
  try {
    writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2))
  } catch {
    // Best-effort: a non-writable IDENTITY_FILE is not a test
    // failure (e.g. read-only repo checkout).
  }

  return identity
}

// The previous "existsSync and only build if missing" pattern,
// preserved as a single function for compatibility with tests
// that do not need the full atomic-build guarantee. DO NOT USE
// in new tests; use ensureHelperBinary() instead.
export async function buildIfMissing(): Promise<void> {
  if (!existsSync(HELPER_BIN)) {
    await ensureHelperBinary()
  }
}
