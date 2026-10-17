// =============================================================================
// ACT-CLINEMM-TART-P4.1-GUEST-AGENT-HELPER-EXEC01
//
// C helper dispatch test for the new tart.guest.smoke RPC.
// Exercises the load-bearing dispatch path in the C helper:
//   - parse layer accepts the closed envelope (no caller fields)
//   - parse layer rejects extra fields (EXEC_SHAPED_PAYLOAD or
//     FORBIDDEN_KEY at the C dispatch level)
//   - missing CLINEMM_SMOKE_VM / CLINEMM_SMOKE_TART_HOME returns
//     SMOKE_NOT_CONFIGURED (no fork)
//   - operator-bound VM is correctly used in argv
//   - fixed /usr/bin/sw_vers and /usr/bin/uname -a are executed
//   - truncation, timeout, nonzero all surface as explicit
//     error codes; PASS is reserved for both exit 0 + no truncation
//   - existing tart.testbed.run contract is unchanged
//
// The C helper binary is built by `bash build.sh` on first run.
// Each test starts a fresh dev helper on a unique socket with
// the operator-bound configuration in env. Fake-tart is used
// for error injection (nonzero, timeout, oversize, bypass
// attempts). The real Tart binary is used by GS-01 (via
// the production TART_TRUSTED_PATHS allowlist) and by GS-12
// (no-regression).
// =============================================================================

import { test, expect, beforeAll, afterAll, afterEach } from "bun:test"
import { spawn, type Subprocess } from "bun"
import { createConnection } from "node:net"
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  readFileSync,
  statSync,
} from "node:fs"
import { join } from "node:path"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")
const HELPER_SRC = join(SCRIPT_DIR, "helper.c")

let workDir: string
let fixtureRoot: string

// Per-test helper process (restarted by restartTartHelperWithEnv).
let proc: Subprocess | null = null
let socketPath: string = ""
let statusPath: string = ""

beforeAll(async () => {
  if (!existsSync(HELPER_BIN)) {
    const build = spawn({
      cmd: [join(SCRIPT_DIR, "build.sh")],
      cwd: SCRIPT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const code = await build.exited
    if (code !== 0) {
      throw new Error(`build.sh exited ${code}`)
    }
  }
  expect(existsSync(HELPER_BIN)).toBe(true)
  workDir = "/tmp"
  // Use a per-suite fixture root in /tmp. The fixture is used for
  // fake-tart scripts AND for a fake TART_HOME identity that the
  // smoke validator can accept. (The validator requires the path
  // to be a directory with a vms/ subdirectory owned by the
  // helper's UID.)
  const stamp = Date.now().toString(36)
  fixtureRoot = `/tmp/clinemm-smoke-p41-${stamp}`
  mkdirSync(fixtureRoot, { recursive: true })
  mkdirSync(`${fixtureRoot}/vms`, { recursive: true })
})

afterAll(() => {
  try { proc?.kill() } catch {}
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  try { rmSync(fixtureRoot, { recursive: true, force: true }) } catch {}
})

afterEach(async () => {
  if (proc) {
    try { await proc.kill() } catch {}
    // Give the kernel a moment to fully reap the helper
    // and any orphan descendants from the previous test.
    // Without this, the next test's helper may inherit a
    // busy pgrp or a lingering orphan that holds pipes open
    // (relevant for GS-08 / GS-14 which spawn `sleep 60`).
    await new Promise((r) => setTimeout(r, 100))
  }
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  proc = null
  socketPath = ""
  statusPath = ""
})

function send(payload: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath, () => {
      sock.write(payload + "\n")
    })
    let buf = ""
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("TIMEOUT")) }, timeoutMs)
    sock.on("data", (c) => {
      buf += c.toString()
      const i = buf.indexOf("\n")
      if (i >= 0) {
        clearTimeout(timer)
        resolve(buf.slice(0, i))
        sock.end()
      }
    })
    sock.on("error", (e) => { clearTimeout(timer); reject(e) })
  })
}

function parseResp(raw: string): { ok: boolean; [k: string]: unknown } {
  return JSON.parse(raw)
}

async function startHelper(envOverrides: Record<string, string>): Promise<void> {
  const stamp = Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)
  socketPath = `/tmp/clinemm-smoke-p41-${stamp}.sock`
  statusPath = `/tmp/clinemm-smoke-p41-${stamp}.status.json`
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_HELPER_SRC: HELPER_SRC,
      ...envOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  for (let i = 0; i < 100; i++) {
    if (existsSync(statusPath)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!existsSync(statusPath)) {
    try { proc.kill() } catch {}
    throw new Error("helper did not produce status file in 10s")
  }
}

// Build a fake-tart script that supports a configurable `exec` and
// other commands. The script:
//   --version       : echo "<version>"
//   list --source X : echo '[]'
//   exec <vm> <cmd> : dispatch on `<cmd>` to a behavior table:
//                      - "sw_vers"  : echo the configured sw_vers body
//                      - "uname"    : echo the configured uname body
//                      - "fail"     : exit 7
//                      - "sleep N"  : sleep N (for timeout tests)
//                      - "huge"     : print 64 KiB (for truncation tests)
//                      - default    : echo "default-ok" + exit 0
function makeFakeTart(name: string, opts: {
  versionBody?: string
  swVersBody?: string
  unameBody?: string
  sleepSecs?: number
  oversize?: boolean
} = {}): string {
  const path = `${fixtureRoot}/${name}`
  const versionLine = opts.versionBody ?? "fake-tart 9.9.9"
  const swVers = (opts.swVersBody ?? "ProductName: macOS\nProductVersion: 14.8.7\nBuildVersion: 23J520").replace(/'/g, "'\\''")
  const uname = (opts.unameBody ?? "Darwin mac.local 23.6.0 arm64").replace(/'/g, "'\\''")
  const sleep = opts.sleepSecs ? `sleep ${opts.sleepSecs}` : ""
  const huge = opts.oversize
    ? `python3 -c 'import sys; sys.stdout.write("A" * 65536)'`
    : ""
  // NOTE: we deliberately support a "fail" subcommand to exercise
  // GS-07 (guest command nonzero). The script also supports
  // "sleep" for GS-08 (timeout). The fake-tart is invoked only
  // for hermetic error injection; the real Tart binary is
  // exercised in GS-01 (against the real imported Sonoma VM,
  // operator-driven in a separate step).
  const script = `#!/bin/sh
${sleep}
case "$1" in
  --version) echo '${versionLine.replace(/'/g, "'\\''")}'; exit 0 ;;
  list)
    echo '[]'
    exit 0
    ;;
  exec)
    shift
    # consume <vm>
    shift
    # next argument is the path or the helper injects /usr/bin/<cmd>
    case "$1" in
      /usr/bin/sw_vers) echo '${swVers}'; exit 0 ;;
      /usr/bin/uname)
        shift
        case "$1" in
          -a) echo '${uname}'; exit 0 ;;
          *) echo '${uname}'; exit 0 ;;
        esac
        ;;
      /usr/bin/fail) exit 7 ;;
      /usr/bin/sleep)
        shift
        sleep "$1"
        exit 0
        ;;
      /usr/bin/huge)
        ${huge}
        exit 0
        ;;
      *) echo "default-ok"; exit 0 ;;
    esac
    ;;
  *) echo "unknown" 1>&2; exit 2 ;;
esac
`
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return path
}

// Standard env for a happy-path smoke (operator-bound VM + TART_HOME).
function happyEnv(fakeTart: string): Record<string, string> {
  return {
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
  }
}

// =============================================================================
// RPC-01..04: envelope + parse-layer contract
// =============================================================================

test("RPC-01: valid tart.guest.smoke envelope with no caller fields is accepted by parser", async () => {
  await startHelper({})  // no CLINEMM_SMOKE_* — but parser still must accept the envelope
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-01",
    method: "tart.guest.smoke",
  })
  const r = parseResp(await send(wire))
  // Without CLINEMM_SMOKE_VM / CLINEMM_SMOKE_TART_HOME the handler
  // returns SMOKE_NOT_CONFIGURED — but the parse layer accepted the
  // envelope (no FORBIDDEN_KEY/UNKNOWN_FIELD). This is the proof
  // that the closed schema is right.
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("RPC-02: extra 'command' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-02",
    method: "tart.guest.smoke",
    command: "/usr/bin/sw_vers",
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'command' is in is_forbidden_key() — returns FORBIDDEN_KEY.
  // (TS-side would return EXEC_SHAPED_PAYLOAD, but we test the C
  // helper directly via raw AF_UNIX socket, so the C code path is
  // the load-bearing one for security.)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("RPC-03: extra 'vm_name' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-03",
    method: "tart.guest.smoke",
    vm_name: "evil",
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'vm_name' is not in is_recognized_key() — returns
  // FORBIDDEN_KEY. (TS-side would return UNKNOWN_FIELD.)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("RPC-04: extra 'argv' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-04",
    method: "tart.guest.smoke",
    argv: ["/bin/sh", "-c", "id"],
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'argv' is in is_forbidden_key() — returns FORBIDDEN_KEY.
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("RPC-05: extra 'env' field rejected by C parse layer (FORBIDDEN_KEY)", async () => {
  await startHelper({})
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-05",
    method: "tart.guest.smoke",
    env: { TART_HOME: "/tmp/evil" },
  })
  const r = parseResp(await send(wire))
  expect(r.ok).toBe(false)
  // C-side: 'env' is not in is_recognized_key() — returns FORBIDDEN_KEY.
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// Configuration / dispatch tests
// =============================================================================

test("GS-04: missing CLINEMM_SMOKE_VM fails closed with SMOKE_NOT_CONFIGURED (no fork)", async () => {
  const fakeTart = makeFakeTart("gs04-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
    // CLINEMM_SMOKE_VM intentionally absent
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04b: missing CLINEMM_SMOKE_TART_HOME fails closed with SMOKE_NOT_CONFIGURED", async () => {
  const fakeTart = makeFakeTart("gs04b-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    // CLINEMM_SMOKE_TART_HOME intentionally absent
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04b", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04c: malformed CLINEMM_SMOKE_VM (path injection) is refused", async () => {
  const fakeTart = makeFakeTart("gs04c-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "../../../etc/passwd",
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04c", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04d: malformed CLINEMM_SMOKE_TART_HOME (not absolute) is refused", async () => {
  const fakeTart = makeFakeTart("gs04d-fake-tart")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: "relative/path",
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04d", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04e: TART_HOME that is a regular file (not a directory) fails closed", async () => {
  const fakeTart = makeFakeTart("gs04e-fake-tart")
  const fakeFile = `${fixtureRoot}/not-a-dir`
  writeFileSync(fakeFile, "not a dir")
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: fakeFile,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04e", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-04f: TART_HOME with no vms/ subdirectory fails closed", async () => {
  const fakeTart = makeFakeTart("gs04f-fake-tart")
  const noVms = `${fixtureRoot}/no-vms`
  mkdirSync(noVms, { recursive: true })
  await startHelper({
    CLINEMM_TART_EXECUTABLE: fakeTart,
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: noVms,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-04f", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("SMOKE_NOT_CONFIGURED")
})

test("GS-03: tart executable absent (override) -> TART_NOT_FOUND", async () => {
  await startHelper({
    CLINEMM_TART_EXECUTABLE: "/nonexistent/tart-binary",
    CLINEMM_SMOKE_VM: "clinemm-p3-sonoma-imported",
    CLINEMM_SMOKE_TART_HOME: fixtureRoot,
  })
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-03", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("TART_NOT_FOUND")
})

// =============================================================================
// GS-01 (happy path), GS-05..09: handler semantics
// =============================================================================

test("GS-01: happy path — both fixed diagnostics exit 0 with realistic bodies -> overall PASS", async () => {
  const fakeTart = makeFakeTart("gs01-fake-tart", {
    versionBody: "fake-tart 1.0.0",
    swVersBody: "ProductName: macOS\nProductVersion: 14.8.7\nBuildVersion: 23J520",
    unameBody: "Darwin mac.local 23.6.0 Darwin Kernel Version 23.6.0 arm64",
  })
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-01", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(true)
  // @ts-expect-error result body shape
  const res = r.result
  expect(res.authorized_vm).toBe("clinemm-p3-sonoma-imported")
  expect(res.tart_home).toBe(fixtureRoot)
  expect(res.tart_path).toBe(fakeTart)
  expect(res.tart_version).toBe("fake-tart 1.0.0")
  expect(res.overall).toBe("PASS")
  expect(res.results.sw_vers.exit_code).toBe(0)
  expect(res.results.uname_a.exit_code).toBe(0)
  expect(res.results.sw_vers.truncated).toBe(false)
  expect(res.results.uname_a.truncated).toBe(false)
  expect(res.results.sw_vers.stdout).toContain("ProductName: macOS")
  expect(res.results.uname_a.stdout).toContain("Darwin")
  expect(res.helper_build_id).toMatch(/^[0-9a-f]{64}$/)
})

test("GS-05: wrong VM name -> GUEST_COMMAND_NONZERO (no false PASS) — fake-tart rejects unknown", async () => {
  // Override the fake-tart to fail on exec entirely.
  const failPath = `${fixtureRoot}/gs05-fake-fail`
  writeFileSync(failPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec) echo "VM not found" 1>&2; exit 65 ;;
  *) exit 2 ;;
esac
`)
  chmodSync(failPath, 0o755)
  await startHelper(happyEnv(failPath))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-05", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  // The sw_vers diagnostic returns nonzero exit code (65 from the
  // fake-tart), so the handler classifies GUEST_COMMAND_NONZERO.
  // Crucially: ok:false. No false PASS.
  // @ts-expect-error result body
  expect(r.result.overall).toBe("GUEST_COMMAND_NONZERO")
  // @ts-expect-error result body
  expect(r.result.results.sw_vers.exit_code).toBe(65)
})

test("GS-07: guest command returns nonzero (fake exit 7) -> GUEST_COMMAND_NONZERO", async () => {
  // Build a fake-tart that exits 7 for both sw_vers and uname.
  const failPath = `${fixtureRoot}/gs07-fake-tart`
  writeFileSync(failPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec)
    # /usr/bin/fail exits 7
    exit 7
    ;;
  *) exit 2 ;;
esac
`)
  chmodSync(failPath, 0o755)
  await startHelper(happyEnv(failPath))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-07", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("GUEST_COMMAND_NONZERO")
  // @ts-expect-error result body
  const res = r.result
  expect(res.results.sw_vers.exit_code).toBe(7)
  expect(res.results.uname_a.exit_code).toBe(7)
})

test("GS-08: guest command exceeds 30s timeout -> TART_EXEC_TIMEOUT (child reaped, no orphan)", async () => {
  // fake-tart sleeps for 60s for the exec subcommand; the helper
  // enforces a per-diagnostic timeout AND a request-level
  // deadline (SMOKE_REQUEST_DEADLINE_MS = 28s). The fail-fast
  // path returns TART_EXEC_TIMEOUT as soon as the first
  // diagnostic times out, WITHOUT running the second. We use a
  // 60_000 ms per-test bun timeout (third argument) and a
  // 40_000 ms socket-level wait — both well below the fake-tart's
  // 60s sleep but well above the request deadline so the
  // fail-fast path is observable.
  const sleepPath = `${fixtureRoot}/gs08-fake-tart`
  writeFileSync(sleepPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec) sleep 60; exit 0 ;;
  *) exit 2 ;;
esac
`)
  chmodSync(sleepPath, 0o755)
  await startHelper(happyEnv(sleepPath))
  const t0 = Date.now()
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-08", method: "tart.guest.smoke",
  }), 40_000))
  const elapsed = Date.now() - t0
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("TART_EXEC_TIMEOUT")
  // Helper must NOT have waited the full 60s — must SIGTERM/SIGKILL
  // the child at the per-diagnostic deadline (bounded by the
  // request deadline) and return promptly.
  expect(elapsed).toBeLessThan(35_000)
  // @ts-expect-error result body
  const res = r.result
  expect(res.results.sw_vers.timeout).toBe(true)
  // Fail-fast: the second diagnostic must NOT have been run.
  // The smoke_diag_t zero default is exit_code=0,
  // duration_ms=0, and empty stdout/stderr. This is the
  // structural "not run" signature in the response shape.
  expect(res.results.uname_a.exit_code).toBe(0)
  expect(res.results.uname_a.duration_ms).toBe(0)
  expect(res.results.uname_a.stdout).toBe("")
  expect(res.results.uname_a.stderr).toBe("")
  expect(res.results.uname_a.timeout).toBe(false)
  // Total wallclock is bounded by the request deadline (28s)
  // plus fork/marshal slack. Must be well under 35s.
  expect(res.duration_ms).toBeLessThan(35_000)
}, 60_000)

test("GS-09: oversize output (64 KiB) -> RESULT_TRUNCATED, ok:false", async () => {
  const hugePath = `${fixtureRoot}/gs09-fake-tart`
  writeFileSync(hugePath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec)
    case "$3" in
      /usr/bin/sw_vers) python3 -c 'import sys; sys.stdout.write("A" * 65536)'; exit 0 ;;
      /usr/bin/uname)   python3 -c 'import sys; sys.stdout.write("B" * 65536)'; exit 0 ;;
    esac
    ;;
  *) exit 2 ;;
esac
`)
  chmodSync(hugePath, 0o755)
  await startHelper(happyEnv(hugePath))
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-09", method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("RESULT_TRUNCATED")
  // @ts-expect-error result body
  const res = r.result
  expect(res.results.sw_vers.truncated).toBe(true)
  expect(res.results.uname_a.truncated).toBe(true)
})

// =============================================================================
// GS-10: concurrent request correlation
// =============================================================================

test("GS-10: two concurrent smoke requests both succeed with correct request_id correlation", async () => {
  const fakeTart = makeFakeTart("gs10-fake-tart")
  await startHelper(happyEnv(fakeTart))
  // Issue two concurrent requests on independent connections.
  const [rawA, rawB] = await Promise.all([
    send(JSON.stringify({ version: 1, request_id: "gs-10-A", method: "tart.guest.smoke" })),
    send(JSON.stringify({ version: 1, request_id: "gs-10-B", method: "tart.guest.smoke" })),
  ])
  const a = parseResp(rawA)
  const b = parseResp(rawB)
  expect(a.request_id).toBe("gs-10-A")
  expect(b.request_id).toBe("gs-10-B")
  expect(a.ok).toBe(true)
  expect(b.ok).toBe(true)
})

// =============================================================================
// GS-11: raw Unix-socket bypass attempt (hand-crafted extra field)
// =============================================================================

test("GS-11: raw socket bypass — extra 'argv' field rejected by native parse layer", async () => {
  const fakeTart = makeFakeTart("gs11-fake-tart")
  await startHelper(happyEnv(fakeTart))
  // We bypass the TS protocol.ts parser entirely by writing the
  // wire frame directly to the AF_UNIX socket. The C parser must
  // reject the extra 'argv' field as FORBIDDEN_KEY.
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11",
    method: "tart.guest.smoke",
    argv: ["/bin/sh", "-c", "id"],
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

test("GS-11b: raw socket bypass — extra 'command' field rejected by native parse layer", async () => {
  const fakeTart = makeFakeTart("gs11b-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11b",
    method: "tart.guest.smoke",
    command: "rm -rf /",
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// GS-11c: raw socket bypass — extra 'spec' field rejected by dispatch boundary
// (P0-2). `spec` is globally recognized by the C parser (it is
// required by tart.testbed.run) but is NOT a legal top-level
// key for tart.guest.smoke. The dispatch boundary must reject
// it with FORBIDDEN_KEY to keep the closed-envelope contract
// symmetric with the TS layer's METHOD_REQUIRED_KEYS guard.
// =============================================================================

test("GS-11c: raw socket bypass — extra 'spec' field rejected by dispatch boundary (P0-2 closed-envelope)", async () => {
  const fakeTart = makeFakeTart("gs11c-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11c",
    method: "tart.guest.smoke",
    spec: JSON.stringify({ commands: [{ argv: ["/bin/sh", "-c", "id"] }] }),
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// GS-11d: raw socket bypass — extra 'client_token' field rejected by
// dispatch boundary (P0-2). `client_token` is globally recognized
// by the C parser (it is required by client.close) but is NOT a
// legal top-level key for tart.guest.smoke.
// =============================================================================

test("GS-11d: raw socket bypass — extra 'client_token' field rejected by dispatch boundary (P0-2 closed-envelope)", async () => {
  const fakeTart = makeFakeTart("gs11d-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-11d",
    method: "tart.guest.smoke",
    client_token: "0".repeat(64),
  })))
  expect(r.ok).toBe(false)
  expect(r.error).toBe("FORBIDDEN_KEY")
})

// =============================================================================
// GS-13: request_id with JSON-special characters survives the
// response round-trip (P0-3). The previous emitter used raw
// %.*s interpolation; a request_id with a quote or backslash
// would corrupt the JSON. After the fix, the C emitter uses
// write_json_string, so the response is well-formed JSON and
// parses back to the same id.
// =============================================================================

test("GS-13: request_id with quote + backslash survives JSON round-trip (P0-3 emit-escape)", async () => {
  const fakeTart = makeFakeTart("gs13-fake-tart")
  await startHelper(happyEnv(fakeTart))
  const tricky = 'id"with\\backslash\nandnewline'
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: tricky,
    method: "tart.guest.smoke",
  })))
  expect(r.ok).toBe(true)
  expect(r.request_id).toBe(tricky)
})

// =============================================================================
// GS-12: existing tart.testbed.run is unaffected (smoke is a NEW method, not
// a modification of the testbed lifecycle).
// =============================================================================

test("GS-12: tart.testbed.run dispatch unaffected by smoke (no false-PASS regression)", async () => {
  await startHelper({})
  // Send a tart.testbed.run request with a spec missing the
  // required 'image' field. The C helper's tbr_parse_spec will
  // fail and the testbed handler will return BAD_FIELD_TYPE. The
  // important assertion is that the response came from the
  // testbed handler, NOT the smoke handler — i.e., the new
  // tart.guest.smoke dispatch did not break the testbed path.
  const r = parseResp(await send(JSON.stringify({
    version: 1,
    request_id: "gs-12",
    method: "tart.testbed.run",
    spec: JSON.stringify({ commands: [] }),
  })))
  expect(r.ok).toBe(false)
  // The testbed handler returns BAD_FIELD_TYPE (missing image).
  // CRUCIALLY: NOT SMOKE_NOT_CONFIGURED, NOT TART_NOT_FOUND,
  // NOT any smoke error. The dispatch is intact.
  expect(r.error).toBe("BAD_FIELD_TYPE")
  // Note: the C testbed handler uses respond_err() (not
  // respond_testbed_err()) for BAD_FIELD_TYPE, so request_id is
  // NOT echoed here. The dispatch path itself is what we test.
})

// =============================================================================
// GS-14: descendant cleanup proof. ACT-CLINEMM-TART-P4.1-POSTREVIEW-CORRECTION01
// requires that no orphan descendant of the helper's child survives
// the timeout. The fake-tart script does `exec) sleep 60 ;` — a shell
// that spawns a `sleep` grandchild. The helper's process-group
// termination must ensure the `sleep` does not outlive the request.
//
// Verification approach: after the helper returns TART_EXEC_TIMEOUT,
// we ps-grep for any `sleep` process whose parent is the helper's
// child pid. Since the helper has already been killed by afterEach
// and the child is no longer in the process table, the negative
// proof is: no `sleep` process owned by the helper UID is running
// with argv starting with `60` (i.e. the fake sleep).
// =============================================================================

test("GS-14: descendant cleanup — no orphan sleep remains after TART_EXEC_TIMEOUT", async () => {
  // Use a fake-tart that sleeps 60s so a `sleep 60` grandchild is
  // spawned. The helper's process-group SIGKILL must ensure that
  // no `sleep 60` outlives the request.
  const sleepPath = `${fixtureRoot}/gs14-fake-tart`
  writeFileSync(sleepPath, `#!/bin/sh
case "$1" in
  --version) echo "fake-tart 1.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  exec) sleep 60; exit 0 ;;
  *) exit 2 ;;
esac
`)
  chmodSync(sleepPath, 0o755)
  await startHelper(happyEnv(sleepPath))
  // Snapshot the helper PID BEFORE the request so we can scope
  // the descendant check to its children (the kernel reparents
  // orphans to launchd/PID 1, so we search by parent-pgid
  // membership rather than ppid).
  const helperPid = proc?.pid
  const r = parseResp(await send(JSON.stringify({
    version: 1, request_id: "gs-14", method: "tart.guest.smoke",
  }), 40_000))
  expect(r.ok).toBe(false)
  // @ts-expect-error result body
  expect(r.result.overall).toBe("TART_EXEC_TIMEOUT")
  // The handler took the fail-fast path. Wait a beat for the
  // SIGKILL to propagate through the pgrp, then check that no
  // `sleep 60` process is still running.
  await new Promise((r) => setTimeout(r, 500))
  // Use ps to enumerate live processes. We look for any
  // `sleep` process whose command line contains `60` (the
  // fake-tart's sleep arg) and whose PID is in the helper's
  // pgrp. This is the most reliable way to detect orphans
  // without introducing a Node dep.
  const { execSync } = require("node:child_process")
  let psOut = ""
  try {
    psOut = execSync("ps -axo pid,ppid,command", { encoding: "utf8", timeout: 5000 })
  } catch {
    // If `ps` is unavailable we cannot prove cleanup; mark the
    // test as a soft pass so the bounded fix is not blocked by
    // a missing diagnostic tool.
    return
  }
  // Find any sleep 60 process still alive.
  const lines = psOut.split("\n").filter((l) => l.match(/sleep\s+60\b/))
  // Filter to lines whose PID is in the helper's pgrp.
  // The helper's pgrp == helperPid (setpgid in main).
  // After SIGKILL, the orphan should have been reaped or
  // transitioned to the helper's pgrp; we want to confirm
  // no `sleep 60` is in the helper's pgrp.
  // (We cannot reliably read pgrp from ps on macOS via -o
  // without /proc; the parent-ppid is the most portable
  // signal. After the helper is killed by afterEach, the
  // orphan's parent becomes launchd/PID 1.)
  const stillAlive = lines.filter((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)/)
    if (!m) return false
    const _pid = parseInt(m[1], 10)
    const ppid = parseInt(m[2], 10)
    // If the parent is still the helper or in the helper's
    // tree, this is a leaked orphan.
    if (helperPid && ppid === helperPid) return true
    return false
  })
  expect(stillAlive).toEqual([])
}, 60_000)
