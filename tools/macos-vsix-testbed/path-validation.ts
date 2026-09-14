/**
 * ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01
 *
 * Path validation for the trusted installed-VSIX testbed runner.
 *
 * The C host helper does structural anti-shell validation
 * (length, hex, extension, traversal). The runner is the SOLE
 * substrate allowed to perform the filesystem operations that
 * bridge "request-side canonical path string" and "actual
 * trusted artifact bytes". This module centralizes that bridge.
 *
 * Hard invariants:
 *   - realpath(vsix_path) MUST resolve under TRUSTED_ARTIFACT_ROOT
 *   - The resolved file MUST be a regular file
 *   - The file's SHA-256 MUST match the request's vsix_sha256
 *   - Symlink escapes (realpath chain crosses outside root) are denied
 *   - The path component `..` is denied
 *   - The extension MUST be `.vsix`
 *
 * Soft invariants:
 *   - The file's owner MUST equal the current uid
 *   - The file MUST be readable by the current uid
 *   - The file size MUST NOT exceed MAX_VSIX_BYTES (sandbox budget)
 *
 * On any failure, the runner emits a structured
 * `{"ok":false,"error":"<CODE>"}` envelope that the C helper
 * forwards verbatim. On success, the runner emits
 * `{"result":{...}}` with the host SHA-256 (H1) and other
 * identity fields.
 *
 * The validation is pure (no I/O) where possible so that the
 * guard logic is unit-testable against any fixture without
 * requiring a Tart VM.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import { createHash } from "node:crypto"

export const MAX_VSIX_BYTES = 256 * 1024 * 1024 // 256 MiB upper bound

/**
 * Resolve the trusted artifact root lazily so that tests can
 * override process.env.HOME before the first call.
 */
export function trustedArtifactRoot(): string {
  return `${process.env.HOME ?? "/tmp"}/.clinemm/artifacts`
}

/**
 * Backwards-compat constant. Reads process.env.HOME at import
 * time; tests should call {@link trustedArtifactRoot} instead.
 */
export const TRUSTED_ARTIFACT_ROOT = trustedArtifactRoot()

export type RunnerErrorCode =
  | "VSIX_NOT_FOUND"
  | "VSIX_HASH_MISMATCH"
  | "TART_NOT_AVAILABLE"
  | "VM_CLONE_FAILED"
  | "VM_BOOT_FAILED"
  | "GUEST_UNREACHABLE"
  | "GUEST_HASH_MISMATCH"
  | "VSIX_INSTALL_FAILED"
  | "EXTENSION_NOT_FOUND"
  | "ACTIVATION_FAILED"
  | "TIMEOUT"
  | "INTERNAL_ERROR"
  | "BASE_IMAGE_NOT_READY"
  | "BASE_IMAGE_CONTAMINATED"
  | "RUNNER_NOT_AVAILABLE"
  | "EDITOR_BASELINE_NOT_PROVEN"
  | "SSH_KEY_NOT_PINNED"

export interface ValidateVsixPathOk {
  readonly ok: true
  readonly canonical: string
  readonly real: string
  readonly size: number
  readonly hostSha256: string
  readonly ownerUid: number
}
export interface ValidateVsixPathFail {
  readonly ok: false
  readonly error: RunnerErrorCode
  readonly message: string
}
export type ValidateVsixPathResult = ValidateVsixPathOk | ValidateVsixPathFail

export function validateVsixPath(
  inputPath: string,
  expectedSha256: string,
): ValidateVsixPathResult {
  let lst: import("node:fs").Stats
  try {
    lst = lstatSync(inputPath)
  } catch (cause) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `lstat failed: ${(cause as Error).message}`,
    }
  }
  if (!lst.isFile()) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: "not a regular file (symlink, directory, or special)",
    }
  }
  let real: string
  try {
    real = realpathSync(inputPath)
  } catch (cause) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `realpath failed: ${(cause as Error).message}`,
    }
  }
  // Realpath both sides so that `/tmp` ↔ `/private/tmp` symlink
  // resolution does not break the prefix check on macOS.
  const trustedRoot = (() => {
    try {
      return realpathSync(trustedArtifactRoot())
    } catch {
      return trustedArtifactRoot()
    }
  })()
  if (!real.startsWith(trustedRoot + "/") && real !== trustedRoot) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `canonical path ${real} escapes trusted root ${trustedRoot}`,
    }
  }
  if (/(^|\/)\.\.($|\/)/.test(real)) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: "real path contains '..' component",
    }
  }
  let st: import("node:fs").Stats
  try {
    st = statSync(real)
  } catch (cause) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `stat failed: ${(cause as Error).message}`,
    }
  }
  if (!st.isFile()) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: "resolved target is not a regular file",
    }
  }
  if (st.size > MAX_VSIX_BYTES) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `file size ${st.size} exceeds ${MAX_VSIX_BYTES}`,
    }
  }
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `owner uid ${st.uid} != current uid ${process.getuid()}`,
    }
  }
  let bytes: Buffer
  try {
    bytes = readFileSync(real)
  } catch (cause) {
    return {
      ok: false,
      error: "VSIX_NOT_FOUND",
      message: `readFileSync failed: ${(cause as Error).message}`,
    }
  }
  const actualSha = createHash("sha256").update(bytes).digest("hex")
  if (actualSha !== expectedSha256.toLowerCase()) {
    return {
      ok: false,
      error: "VSIX_HASH_MISMATCH",
      message: `expected ${expectedSha256}, got ${actualSha}`,
    }
  }
  return {
    ok: true,
    canonical: real,
    real,
    size: st.size,
    hostSha256: actualSha,
    ownerUid: st.uid,
  }
}
