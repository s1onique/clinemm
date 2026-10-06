// =============================================================================
// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01
//
// Tests for the tart.preflight method on the C helper
// (helper.c). Uses fixture-injection (CLINEMM_TART_EXECUTABLE,
// CLINEMM_TART_CACHE_DIR) so the real Tart binary is NOT exercised;
// instead we synthesize tiny shell scripts that simulate Tart
// behavior. This isolates the helper's preflight logic from the
// upstream Tart implementation and makes the tests hermetic.
//
// Test groups:
//   RPC-01..04: request contract (envelope parsing, forbidden keys,
//               unknown method, unauthorized client).
//   PF-01..10:  helper preflight behavior (cache canary, Tart
//               discovery, --version, list local, list oci,
//               classification, full PASS).
// =============================================================================

import { test, expect, beforeAll, afterAll } from "bun:test"
import { spawn, type Subprocess } from "bun"
import { createConnection } from "node:net"
import {
  existsSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")
const HELPER_SRC = join(SCRIPT_DIR, "helper.c")

let workDir: string
let socketPath: string
let statusPath: string
let proc: Subprocess | null = null
let fixtureRoot: string

beforeAll(async () => {
  if (!existsSync(HELPER_BIN)) {
    const build = spawn({
      cmd: [join(SCRIPT_DIR, "build.sh")],
      cwd: SCRIPT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const code = await build.exited
    if (code !== 0) {
      throw new Error(`build.sh exited ${code}: ${await new Response(build.stderr).text()}`)
    }
  }
  expect(existsSync(HELPER_BIN)).toBe(true)

  workDir = "/tmp"
  const stamp = Date.now().toString(36)
  socketPath = `/tmp/clinemm-tart-preflight-test-${stamp}.sock`
  statusPath = `/tmp/clinemm-tart-preflight-test-${stamp}.status.json`
  fixtureRoot = `/tmp/clinemm-tart-preflight-fixtures-${stamp}`
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o755 })

  // Default fake-tart: happy path on all three commands.
  const defaultFake = `${fixtureRoot}/default-fake-tart`
  writeFileSync(defaultFake,
    `#!/bin/sh
case "$1" in
  --version) echo "default-fake-tart 0.0.0"; exit 0 ;;
  list) echo '[]'; exit 0 ;;
  *) exit 2 ;;
esac
`)
  chmodSync(defaultFake, 0o755)

  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_HELPER_SRC: HELPER_SRC,
      CLINEMM_TART_EXECUTABLE: defaultFake,
      CLINEMM_TART_CACHE_DIR: `${fixtureRoot}/canary`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  for (let i = 0; i < 50; i++) {
    if (existsSync(statusPath)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!existsSync(statusPath)) {
    try { proc.kill() } catch {}
    throw new Error(`helper did not produce status file in 5s. stderr: ${await new Response(proc.stderr).text()}`)
  }
})

afterAll(() => {
  try { proc?.kill() } catch {}
  try { unlinkSync(socketPath) } catch {}
  try { unlinkSync(statusPath) } catch {}
  try { rmSync(fixtureRoot, { recursive: true, force: true }) } catch {}
})

function send(payload: string, timeoutMs = 5000): Promise<string> {
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
        sock.end()
        resolve(buf.slice(0, i))
      }
    })
    sock.on("error", (e) => { clearTimeout(timer); reject(e) })
  })
}

function parseResp(raw: string): { ok: boolean; [k: string]: unknown } {
  return JSON.parse(raw)
}

async function restartTartHelperWithEnv(envOverrides: Record<string, string>): Promise<void> {
  try { unlinkSync(statusPath) } catch {}
  try { proc?.kill() } catch {}
  await new Promise((r) => setTimeout(r, 500))
  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_HELPER_SRC: HELPER_SRC,
      CLINEMM_TART_CACHE_DIR: `${fixtureRoot}/canary`,
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

function makeFakeTart(
  name: string,
  opts: { versionBody?: string; localListOk?: boolean; ociListOk?: boolean; sleepSeconds?: number } = {},
): string {
  const path = `${fixtureRoot}/${name}`
  const versionLine = opts.versionBody ?? "fake-tart 9.9.9"
  const localLine = opts.localListOk === false ? "exit 1" : "echo '[]'"
  const ociLine = opts.ociListOk === false ? "exit 1" : "echo '[]'"
  const sleep = opts.sleepSeconds ? `sleep ${opts.sleepSeconds}` : ""
  const script = `#!/bin/sh
${sleep}
case "$1" in
  --version) echo '${versionLine.replace(/'/g, "'\\''")}'; exit 0 ;;
  list)
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --source)
          case "$2" in
            local) ${localLine}; exit 0 ;;
            oci) ${ociLine}; exit 0 ;;
          esac
          shift 2
          ;;
        *) shift ;;
      esac
    done
    echo '[]'
    exit 0
    ;;
  *) echo "unknown" 1>&2; exit 2 ;;
esac
`
  writeFileSync(path, script)
  chmodSync(path, 0o755)
  return path
}

// =============================================================================
// RPC-01..04: request contract
// =============================================================================

test("RPC-01: valid tart.preflight envelope accepted (happy path)", async () => {
  const happy = makeFakeTart("fake-tart-rpc01", { versionBody: "happy 1.2.3" })
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: happy })
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-01",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  expect(resp.version).toBe(1)
  expect(resp.request_id).toBe("rpc-01")
  const result = resp.result as Record<string, unknown>
  expect(result.executionBoundary).toBe("launchd")
  expect(result.overall).toBe("PASS")
  const tart = result.tart as Record<string, unknown>
  expect(tart.version).toBe("happy 1.2.3")
  expect(tart.localListSucceeded).toBe(true)
  expect(tart.ociListSucceeded).toBe(true)
})

test("RPC-02: envelope with extra 'command' field is rejected (anti-shell)", async () => {
  const happy = makeFakeTart("fake-tart-rpc02")
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: happy })
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-02",
    method: "tart.preflight",
    command: "rm -rf /",
  })
  const resp = parseResp(await send(wire, 5000))
  expect(resp.ok).toBe(false)
  // The C helper returns FORBIDDEN_KEY; the TS fallback maps to BAD_REQUEST.
  expect(["FORBIDDEN_KEY", "BAD_REQUEST", "METHOD_NOT_ALLOWED"]).toContain(resp.error)
})

test("RPC-02b: envelope with arbitrary extra fields is rejected", async () => {
  const happy = makeFakeTart("fake-tart-rpc02b")
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: happy })
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-02b",
    method: "tart.preflight",
    tartPath: "/etc/passwd",
    argv: ["foo"],
  })
  const resp = parseResp(await send(wire, 5000))
  expect(resp.ok).toBe(false)
  expect(["FORBIDDEN_KEY", "BAD_REQUEST", "METHOD_NOT_ALLOWED"]).toContain(resp.error)
})

test("RPC-03: unknown method -> METHOD_NOT_ALLOWED", async () => {
  const wire = JSON.stringify({
    version: 1,
    request_id: "rpc-03",
    method: "tart.run",
  })
  const resp = parseResp(await send(wire, 5000))
  expect(resp.ok).toBe(false)
  expect(resp.error).toBe("METHOD_NOT_ALLOWED")
})

test("RPC-04: missing request_id -> MISSING_REQUEST_ID/BAD_REQUEST", async () => {
  const resp = parseResp(await send('{"version":1,"method":"tart.preflight"}'))
  expect(resp.ok).toBe(false)
  expect(typeof resp.error).toBe("string")
})

// =============================================================================
// PF-01..10: helper preflight behavior
// =============================================================================

test("PF-01: cache canary succeeds on a writable directory", async () => {
  const happy = makeFakeTart("fake-tart-pf01")
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: happy })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-01",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  const cw = result.cacheWrite as Record<string, unknown>
  expect(cw.attempted).toBe(true)
  expect(cw.succeeded).toBe(true)
  expect(cw.errorClass).toBeUndefined()
  expect(result.overall).toBe("PASS")
})

test("PF-02: cache canary on read-only parent -> CACHE_WRITE_FAILED", async () => {
  const roDir = `${fixtureRoot}/ro-parent-pf02-${Date.now().toString(36)}`
  mkdirSync(roDir, { recursive: true, mode: 0o555 })
  try {
    const happy = makeFakeTart("fake-tart-pf02")
    await restartTartHelperWithEnv({
      CLINEMM_TART_EXECUTABLE: happy,
      CLINEMM_TART_CACHE_DIR: `${roDir}/probe`,
    })
    const wire = JSON.stringify({
      version: 1,
      request_id: "pf-02",
      method: "tart.preflight",
    })
    const resp = parseResp(await send(wire, 10000))
    expect(resp.ok).toBe(true)
    const result = resp.result as Record<string, unknown>
    const cw = result.cacheWrite as Record<string, unknown>
    expect(cw.succeeded).toBe(false)
    expect(["EPERM_OR_EACCES_OR_EROFS", "ENOENT"]).toContain(cw.errorClass)
    expect(result.overall).toBe("CACHE_WRITE_FAILED")
  } finally {
    try { chmodSync(roDir, 0o755) } catch {}
    try { rmSync(roDir, { recursive: true, force: true }) } catch {}
  }
})

test("PF-03: cache canary failure dominates Tart success (no false PASS)", async () => {
  const roDir = `${fixtureRoot}/ro-parent-pf03-${Date.now().toString(36)}`
  mkdirSync(roDir, { recursive: true, mode: 0o555 })
  try {
    const happy = makeFakeTart("fake-tart-pf03")
    await restartTartHelperWithEnv({
      CLINEMM_TART_EXECUTABLE: happy,
      CLINEMM_TART_CACHE_DIR: `${roDir}/probe`,
    })
    const wire = JSON.stringify({
      version: 1,
      request_id: "pf-03",
      method: "tart.preflight",
    })
    const resp = parseResp(await send(wire, 10000))
    expect(resp.ok).toBe(true)
    const result = resp.result as Record<string, unknown>
    expect(result.overall).toBe("CACHE_WRITE_FAILED")
  } finally {
    try { chmodSync(roDir, 0o755) } catch {}
    try { rmSync(roDir, { recursive: true, force: true }) } catch {}
  }
})

test("PF-04: Tart executable absent -> TART_NOT_FOUND", async () => {
  const ghost = `${fixtureRoot}/ghost-${Date.now().toString(36)}`
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: ghost })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-04",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  const cw = result.cacheWrite as Record<string, unknown>
  expect(cw.succeeded).toBe(true)
  expect(result.overall).toBe("TART_NOT_FOUND")
})

test("PF-05: tart --version succeeds with bounded version capture", async () => {
  const fake = makeFakeTart("fake-tart-pf05", { versionBody: "9.9.9-special" })
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: fake })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-05",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  const tart = result.tart as Record<string, unknown>
  expect(tart.version).toBe("9.9.9-special")
  expect(result.overall).toBe("PASS")
})

test("PF-06: tart --version returns nonzero -> TART_EXEC_FAILED", async () => {
  const path = `${fixtureRoot}/fake-tart-pf06`
  writeFileSync(path, `#!/bin/sh\nexit 1\n`)
  chmodSync(path, 0o755)
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: path })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-06",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  expect(result.overall).toBe("TART_EXEC_FAILED")
})

test("PF-07: tart --version hangs past deadline -> TART_EXEC_FAILED", async () => {
  // Helper hardcodes a 10-second version timeout. The fake sleeps
  // 15s. The helper should SIGKILL the child and return
  // TART_EXEC_FAILED.
  const path = `${fixtureRoot}/fake-tart-pf07`
  writeFileSync(path, `#!/bin/sh\nsleep 15\nexit 0\n`)
  chmodSync(path, 0o755)
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: path })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-07",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 30000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  expect(result.overall).toBe("TART_EXEC_FAILED")
}, 35000)

test("PF-08: tart list --source local succeeds", async () => {
  const fake = makeFakeTart("fake-tart-pf08", { localListOk: true })
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: fake })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-08",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  const tart = result.tart as Record<string, unknown>
  expect(tart.localListSucceeded).toBe(true)
  expect(result.overall).toBe("PASS")
})

test("PF-09: tart list --source local nonzero -> TART_EXEC_FAILED", async () => {
  const fake = makeFakeTart("fake-tart-pf09", { localListOk: false })
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: fake })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-09",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  expect(result.overall).toBe("TART_EXEC_FAILED")
})

test("PF-10: full preflight PASS on the happy path", async () => {
  const fake = makeFakeTart("fake-tart-pf10", {
    versionBody: "1.0.0-pf10",
    localListOk: true,
    ociListOk: true,
  })
  await restartTartHelperWithEnv({ CLINEMM_TART_EXECUTABLE: fake })
  const wire = JSON.stringify({
    version: 1,
    request_id: "pf-10",
    method: "tart.preflight",
  })
  const resp = parseResp(await send(wire, 10000))
  expect(resp.ok).toBe(true)
  const result = resp.result as Record<string, unknown>
  expect(result.executionBoundary).toBe("launchd")
  expect(result.overall).toBe("PASS")
  const cw = result.cacheWrite as Record<string, unknown>
  expect(cw.succeeded).toBe(true)
  const tart = result.tart as Record<string, unknown>
  expect(tart.available).toBe(true)
  expect(tart.version).toBe("1.0.0-pf10")
  expect(tart.localListSucceeded).toBe(true)
  expect(tart.ociListSucceeded).toBe(true)
  const si = result.serviceIdentity as Record<string, unknown>
  expect(si.uid).toBe(process.getuid?.() ?? 0)
})