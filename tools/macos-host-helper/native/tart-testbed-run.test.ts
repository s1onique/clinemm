// =============================================================================
// ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01
//
// C helper dispatch test for the new tart.testbed.run RPC.
// Exercises the load-bearing dispatch path in the C helper:
//   - parse layer rejects unknown fields
//   - dispatch reaches the handler
//   - handler returns the explicit TART_TESTBED_RUN_NOT_IMPLEMENTED
//     error code (the future DOGFOOD ACT plugs in the full
//     lifecycle at this exact site)
//   - request_id correlation preserved
//
// The C helper binary is built by `bash build.sh` on first run.
// =============================================================================

import { test, expect, beforeAll, afterAll } from "bun:test"
import { spawn, type Subprocess } from "bun"
import { createConnection } from "node:net"
import {
  existsSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")

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
      throw new Error(`build.sh exited ${code}`)
    }
  }
  expect(existsSync(HELPER_BIN)).toBe(true)

  const stamp = Date.now().toString(36)
  socketPath = `/tmp/clinemm-tart-testbed-run-test-${stamp}.sock`
  statusPath = `/tmp/clinemm-tart-testbed-run-test-${stamp}.status.json`
  fixtureRoot = `/tmp/clinemm-tart-testbed-run-fixtures-${stamp}`
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o755 })

  // Default fake-tart: never invoked by the dispatch probe (the
  // handler returns TART_TESTBED_RUN_NOT_IMPLEMENTED before
  // touching the Tart binary).
  const defaultFake = `${fixtureRoot}/fake-tart`
  writeFileSync(defaultFake, `#!/bin/sh\nexit 0\n`)
  chmodSync(defaultFake, 0o755)

  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
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
    throw new Error("helper did not start")
  }
})

afterAll(() => {
  try { proc?.kill() } catch {}
  try { rmSync(socketPath, { force: true }) } catch {}
  try { rmSync(statusPath, { force: true }) } catch {}
  try { rmSync(fixtureRoot, { recursive: true, force: true }) } catch {}
})

function send(payload: string, timeoutMs = 90000): Promise<string> {
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
    sock.on("error", (err) => { clearTimeout(timer); reject(err) })
    sock.on("end", () => {
      clearTimeout(timer)
      if (buf.length > 0) resolve(buf)
      else reject(new Error("helper closed"))
  })
  })
}

async function restartHelperWithFakeTart(fakeTartPath: string): Promise<void> {
  try { rmSync(statusPath, { force: true }) } catch {}
  try { proc?.kill() } catch {}
  await new Promise((r) => setTimeout(r, 300))
  proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_TART_EXECUTABLE: fakeTartPath,
      CLINEMM_TART_CACHE_DIR: `${fixtureRoot}/canary`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  for (let i = 0; i < 100; i++) {
    if (existsSync(statusPath)) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!existsSync(statusPath)) {
    try { proc.kill() } catch {}
    throw new Error("helper did not restart with fake-tart")
  }
}

const IMAGE = "ghcr.io/cirruslabs/macos-sonoma-base@sha256:" + "0".repeat(64)

// Synthetic fake-tart that simulates the full lifecycle:
//   - clone <image> <vm>        -> exit <cloneExit> (default 0)
//   - run <vm> --no-graphics    -> spawn a long-running child
//                                 that responds to SIGTERM with exit 0
//                                 (or exits immediately if requested)
//   - ip <vm>                   -> on the ipAttemptForIP-th call,
//                                 emit a plausible IPv4; otherwise
//                                 emit nothing (so the helper polls)
//   - stop <vm>                 -> exit <stopExit> (default 0)
//   - delete <vm>               -> exit <deleteExit> (default 0)
function writeSyntheticTart(path: string, opts: {
  ipAttemptForIP?: number;
  ip?: string;
  cloneExit?: number;
  stopExit?: number;
  deleteExit?: number;
  runExitImmediately?: boolean;
}): void {
  const ipAttemptForIP = opts.ipAttemptForIP ?? 6;
  const ip = opts.ip ?? "10.0.0.42";
  // Use literal numbers in the script — bash's `${var}` with
  // empty var in sh parsing is "syntax error near unexpected
  // token" on macOS. Substituting at script-generation time
  // avoids that trap entirely.
  const cloneExit = opts.cloneExit ?? 0;
  const stopExit = opts.stopExit ?? 0;
  const deleteExit = opts.deleteExit ?? 0;
  // For the `run` branch: if runExitImmediately, exit 0; otherwise
  // use `true` as a no-op so the then body always has at least
  // one command (POSIX sh rejects empty then bodies).
  const runExitImmediatelyCmd = opts.runExitImmediately ? "exit 0" : "true";
  const script = `#!/bin/sh
# Synthetic fake-tart for tart.testbed.run lifecycle tests.
COUNTER_FILE="/tmp/clinemm-fake-tart-ip-counter-$$"
trap 'rm -f "$COUNTER_FILE"' EXIT
case "$1" in
  clone)
    exit ${cloneExit}
    ;;
  run)
    ${runExitImmediatelyCmd}
    # Long-running child: respond to SIGTERM with exit 0.
    trap 'exit 0' TERM
    while true; do sleep 1; done
    ;;
  ip)
    if [ ! -f "$COUNTER_FILE" ]; then
      echo 1 > "$COUNTER_FILE"
      n=1
    else
      n=$(cat "$COUNTER_FILE")
      n=$((n + 1))
      echo "$n" > "$COUNTER_FILE"
    fi
    if [ "$n" -ge ${ipAttemptForIP} ]; then
      echo "${ip}"
    fi
    exit 0
    ;;
  stop)
    exit ${stopExit}
    ;;
  delete)
    exit ${deleteExit}
    ;;
  *)
    exit 2
    ;;
esac
`;
  writeFileSync(path, script)
  chmodSync(path, 0o755)
}
test("TBRUNNER-C-01: dispatch path reaches handler (handler now does real lifecycle, not stub)", async () => {
  // The handler is no longer a stub. Use a synthetic tart
  // whose `tart run` exits immediately so we get a quick
  // TART_START_FAILED response (rather than the 60s IP_TIMEOUT
  // we'd get from the default fake).
  const fake = `${fixtureRoot}/tbr-c-01-fake`
  writeSyntheticTart(fake, { runExitImmediately: true, ipAttemptForIP: 1, ip: "10.0.0.1" })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-1",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      commands: [{ argv: ["echo", "hi"] }],
    }),
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(true)
  expect(resp.result.failureCode).toBe("TART_START_FAILED")
}, 30_000)

test("TBRUNNER-C-02: extra top-level field rejected by parse layer (FORBIDDEN_KEY)", async () => {
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-2",
    method: "tart.testbed.run",
    spec: JSON.stringify({ image: IMAGE, commands: [{ argv: ["echo"] }] }),
    extra: "nope",
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(false)
  expect(resp.error).toBe("FORBIDDEN_KEY")
}, 10_000)

test("TBRUNNER-C-03: missing spec field rejected", async () => {
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-3",
    method: "tart.testbed.run",
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(false)
  expect(resp.error).toBe("BAD_REQUEST")
}, 10_000)

test("TBRUNNER-C-04: spec missing image -> TESTBED_PREPARE_FAILED", async () => {
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-4",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      commands: [{ argv: ["echo"] }],
    }),
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(false)
  expect(resp.error).toBe("TESTBED_PREPARE_FAILED")
}, 10_000)

test("TBRUNNER-C-05: spec image without sha256 -> TESTBED_PREPARE_FAILED", async () => {
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-5",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: "ghcr.io/cirruslabs/macos-sonoma-base:latest",
      commands: [{ argv: ["echo"] }],
    }),
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(false)
  expect(resp.error).toBe("TESTBED_PREPARE_FAILED")
}, 10_000)

test("TBRUNNER-C-06: spec.run_id sanitized; VM name contains the sanitized run id", async () => {
  // Synthetic tart that gives an IP fast but exits the run child
  // immediately so the lifecycle returns TART_START_FAILED
  // quickly (the test only checks the run_id/vm_name shape).
  const fake = `${fixtureRoot}/tbr-c-06-fake`
  writeSyntheticTart(fake, { runExitImmediately: true, ipAttemptForIP: 1, ip: "10.0.0.99" })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-6",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      run_id: "MyRun-ABC-123!",
      commands: [{ argv: ["echo"] }],
    }),
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(true)
  const result = resp.result
  // Sanitization keeps only [a-z0-9]: myrunabc123
  expect(result.runId).toBe("myrunabc123")
  expect(result.vmName).toContain("myrunabc123")
  expect(result.vmName.startsWith("clinemm-testbed-myrunabc123-")).toBe(true)
}, 30_000)

test("TBRUNNER-C-07: forbidden exec-shaped key inside spec rejected (no image found)", async () => {
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-c-7",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      argv: ["echo"],
    }),
  })
  const resp = JSON.parse(await send(req))
  // The C helper accepts the spec (parse_envelope passes the
  // spec field through). The spec extractor then runs, finds
  // no `image` in the top-level spec, and returns -1, leading
  // to TESTBED_PREPARE_FAILED.
  expect(resp.ok).toBe(false)
  expect(resp.error).toBe("TESTBED_PREPARE_FAILED")
}, 10_000)
test("TBRUNNER-L-01: tart clone failure -> TART_CLONE_FAILED (failure precedence)", async () => {
  const fake = `${fixtureRoot}/tbr-l-01-fake`
  writeSyntheticTart(fake, { cloneExit: 7 })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-l-1",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      run_id: "clonefail",
      commands: [{ argv: ["echo"] }],
    }),
  })
  const raw = await send(req)
  const resp = JSON.parse(raw)
  // Structured testbed result: the helper returns ok:true with
  // result.failureCode for lifecycle failures.
  expect(resp.ok).toBe(true)
  expect(resp.result.overallStatus).toBe("PREPARE_FAILED")
  expect(resp.result.failureCode).toBe("TART_CLONE_FAILED")
}, 30_000)

test("TBRUNNER-L-02: tart run child exits immediately -> TART_START_FAILED", async () => {
  const fake = `${fixtureRoot}/tbr-l-02-fake`
  writeSyntheticTart(fake, { runExitImmediately: true })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-l-2",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      run_id: "startexit",
      commands: [{ argv: ["echo"] }],
    }),
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(true)
  expect(resp.result.overallStatus).toBe("START_FAILED")
  expect(resp.result.failureCode).toBe("TART_START_FAILED")
}, 30_000)

test("TBRUNNER-L-03: tart ip polling never yields a valid IP -> TART_IP_TIMEOUT", async () => {
  const fake = `${fixtureRoot}/tbr-l-03-fake`
  writeSyntheticTart(fake, { ipAttemptForIP: 999 })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-l-3",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      run_id: "iptimeout",
      commands: [{ argv: ["echo"] }],
    }),
  })
  // The fake IP polling runs ~60s (60 attempts at 1s slices).
  const resp = JSON.parse(await send(req, 90_000))
  expect(resp.ok).toBe(true)
  expect(resp.result.overallStatus).toBe("IP_TIMEOUT")
  expect(resp.result.failureCode).toBe("TART_IP_TIMEOUT")
}, 100_000)

test("TBRUNNER-L-04: full lifecycle reaches copyIn (TESTBED_COPY_IN_FAILED on no SSH)", async () => {
  const fake = `${fixtureRoot}/tbr-l-04-fake`
  writeSyntheticTart(fake, { ipAttemptForIP: 1, ip: "10.0.0.42" })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-l-4",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      run_id: "copyinfail",
      commands: [{ argv: ["echo"] }],
    }),
  })
  const raw = await send(req)
  require("fs").writeFileSync("/tmp/l04-raw.txt", raw)
  const resp = JSON.parse(raw)
  // copy_in fails (no SSH server locally), so the primary
  // failure is TESTBED_COPY_IN_FAILED; teardown still runs.
  expect(resp.ok).toBe(true)
  expect(resp.result.overallStatus).toBe("EXCEPTION")
  expect(resp.result.failureCode).toBe("TESTBED_COPY_IN_FAILED")
}, 90_000)

test("TBRUNNER-L-05: keep_vm=true does NOT mask primary failure", async () => {
  const fake = `${fixtureRoot}/tbr-l-05-fake`
  writeSyntheticTart(fake, { cloneExit: 7 })
  await restartHelperWithFakeTart(fake)
  const req = JSON.stringify({
    version: 1,
    request_id: "trunner-l-5",
    method: "tart.testbed.run",
    spec: JSON.stringify({
      image: IMAGE,
      run_id: "keepvmcase",
      keep_vm: true,
      commands: [{ argv: ["echo"] }],
    }),
  })
  const resp = JSON.parse(await send(req))
  expect(resp.ok).toBe(true)
  // Primary failure preserved; keep_vm only sets KEEP_VM on
  // the SUCCESS path, so the structured failure remains.
  expect(resp.result.overallStatus).toBe("PREPARE_FAILED")
  expect(resp.result.failureCode).toBe("TART_CLONE_FAILED")
}, 30_000)
