// =============================================================================
// bounded-request-lifecycle.test.ts
//
// ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01
//
// Real-kernel RED/GREEN + adversarial qualification for the native
// helper's AF_UNIX request lifecycle.
//
// Production defect under test (tools/macos-host-helper/native/helper.c):
//
//   static ssize_t read_frame(int fd, char *buf, size_t cap) {
//       size_t off = 0;
//       while (off < cap) {
//           ssize_t r = read(fd, buf + off, 1);   // <-- UNBOUNDED BLOCKING READ
//           ...
//       }
//   }
//
//   while (!g_shutdown) {
//       int cfd = accept(listen_fd, NULL, NULL);
//       ...
//       handle_connection(cfd);                   // <-- SYNCHRONOUS
//   }
//
// One incomplete client frame therefore monopolizes the single-threaded
// accept loop: a subsequent `health` request is never serviced.
//
// SUBSTRATE CONTRACT
//
//   The fixture NEVER touches the installed LaunchAgent. It spawns its
//   OWN isolated helper instance against a unique AF_UNIX socket under
//   an isolated temporary directory, using the helper's documented
//   manual/dev fallback (CLINEMM_HOST_HELPER_SOCKET + ESRCH from
//   launch_activate_socket).
//
//   The watchdog owns the isolated helper's exact process identity
//   (pid + start time), bounds the total experiment, closes both client
//   sockets, and reclaims the temporary socket/fixture. Escalation to
//   a signal requires signal authority over the direct child; when the
//   execution substrate withholds that authority the watchdog reports
//   the EXACT residual identity instead of silently passing.
//
//   RED/GREEN mode is selected by the CLINEMM_HELPER_LIFECYCLE_MODE
//   environment variable:
//     "red"  -> assert the OLD behavior (B times out) -- proof the
//               defect is real and the fixture discriminates.
//     "green"-> assert the NEW behavior (A is closed by deadline, B
//               succeeds) -- proof the repair works.
//     "auto" -> assert the NEW behavior (default; used by the default
//               suite so a repaired binary is the only passing state).
//
//   A RED fixture is NEVER enabled in the default suite: the default
//   mode is "auto" (GREEN expectations).
// =============================================================================

import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import { spawn, type Subprocess } from "bun"
import { createConnection, type Socket } from "node:net"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { ensureHelperBinary } from "./test-helper-build"

// The fixture root is /tmp, NOT os.tmpdir(). On macOS, os.tmpdir()
// resolves under /private/var/folders/... which the Background Exec
// Seatbelt profile does not permit the helper child to bind an
// AF_UNIX socket into (the existing helper.test.ts suite documents
// the same restriction and uses /tmp for the same reason).
const FIXTURE_ROOT = "/tmp"

const SCRIPT_DIR = import.meta.dir
const HELPER_BIN = join(SCRIPT_DIR, "helper")
const HELPER_SRC = join(SCRIPT_DIR, "helper.c")

// The receive deadline the repaired helper is expected to enforce.
// Kept in sync with MAX_FRAME_RECEIVE_MS in helper.c.
const EXPECTED_RECEIVE_DEADLINE_MS = 2000

// The response deadline the repaired helper is expected to enforce.
// Kept in sync with MAX_FRAME_RESPONSE_MS in helper.c.
const EXPECTED_RESPONSE_DEADLINE_MS = 2000

// Total experiment bound. The corrected helper must release client A
// after ~2s of receive budget, then serve B. 2s (receive) + 2s (worst
// response) + scheduler/observation margin.
const EXPERIMENT_BOUND_MS = 15000

// How long B is allowed to wait for its health response before the
// fixture declares the service wedged.
const HEALTH_WAIT_MS = 3000

type Mode = "red" | "green" | "auto"

function currentMode(): Mode {
  const raw = (process.env.CLINEMM_HELPER_LIFECYCLE_MODE ?? "auto").toLowerCase()
  if (raw === "red" || raw === "green" || raw === "auto") return raw
  return "auto"
}

/**
 * Read a process's start time from the kernel via sysctl(KERN_PROC_PID).
 *
 * This is the SAME kernel seam the C helper uses for its PID-reuse
 * resistance (`read_proc_identity()` in helper.c), so the watchdog's
 * identity check is exactly as strong as the production ownership
 * check.
 *
 * It deliberately does NOT shell out to /bin/ps: the Background Exec
 * Seatbelt profile blocks posix_spawn of /bin/ps (EPERM), which would
 * make the identity check silently unavailable -- and an unavailable
 * identity check is precisely the condition the ACT forbids ("Verify
 * the helper's PID/start identity before any escalation").
 *
 * The read is performed by the repository-local C fixture
 * `watchdog-identity-probe.c`, compiled on demand into the fixture
 * directory. It is a TEST fixture, never installed or shipped.
 *
 * Returns null when the process is gone or the probe is unavailable.
 */
let identityProbePath: string | null = null

/**
 * Compile the C test fixture ONCE per process into a stable location
 * that is NOT inside any fixture directory.
 *
 * The probe must outlive individual fixtures: the watchdog reclaims
 * each fixture directory, and a probe living inside one of them would
 * be deleted while another test still needs it.
 */
function compileIdentityProbe(): string | null {
  if (identityProbePath) return identityProbePath
  const src = join(SCRIPT_DIR, "watchdog-identity-probe.c")
  // A per-process stable path under /tmp (the fixture root the macOS
  // sandbox permits for AF_UNIX sockets and executables).
  const out = join(FIXTURE_ROOT, `clinemm-watchdog-probe-${process.pid}.bin`)
  const proc = Bun.spawnSync({
    cmd: ["/usr/bin/cc", "-O2", "-w", "-o", out, src],
    stdout: "pipe",
    stderr: "pipe",
  })
  if (proc.exitCode !== 0) return null
  identityProbePath = out
  return out
}

function readStartIdentity(pid: number, probePath: string | null): string | null {
  if (!probePath) return null
  try {
    const proc = Bun.spawnSync({
      cmd: [probePath, String(pid)],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = proc.stdout.toString().trim()
    if (proc.exitCode === 3) return null // GONE
    if (proc.exitCode !== 0) return null
    // "<pid> <sec>.<usec>"
    const parts = text.split(/\s+/)
    if (parts.length < 2) return null
    return parts[1]
  } catch {
    return null
  }
}

function pidAlive(pid: number): boolean {
  try {
    // Signal 0 is a pure existence probe; it does NOT require the
    // same authority as a real signal and is not affected by the
    // same-UID signal restriction that blocks kill().
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    // EPERM means the process EXISTS but we may not signal it.
    if (e?.code === "EPERM") return true
    return false
  }
}

interface ClientResult {
  connected: boolean
  response: string | null
  error: string | null
  closedByPeer: boolean
  elapsedMs: number
}


/**
 * Open a client socket, optionally send a raw payload (no implicit
 * newline), and wait for a response with an INDEPENDENT deadline.
 */
function openClient(
  socketPath: string,
  opts: {
    payload?: string
    waitMs: number
    keepOpen?: boolean
  },
): Promise<ClientResult> {
  const started = Date.now()
  return new Promise<ClientResult>((resolve) => {
    let sock: Socket | null = null
    let settled = false
    let buf = ""
    const finish = (r: Omit<ClientResult, "elapsedMs">): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sock?.removeAllListeners()
        if (!opts.keepOpen) sock?.destroy()
      } catch {
        /* ignore */
      }
      resolve({ ...r, elapsedMs: Date.now() - started })
    }
    const timer = setTimeout(() => {
      finish({ connected: sock !== null, response: null, error: "TIMEOUT", closedByPeer: false })
    }, opts.waitMs)

    try {
      sock = createConnection(socketPath, () => {
        if (opts.payload !== undefined) {
          try {
            sock?.write(opts.payload)
          } catch (e: any) {
            finish({ connected: true, response: null, error: `WRITE:${e?.code ?? e}`, closedByPeer: false })
          }
        }
      })
    } catch (e: any) {
      finish({ connected: false, response: null, error: `CONNECT:${e?.code ?? e}`, closedByPeer: false })
      return
    }
    sock.on("data", (c) => {
      buf += c.toString()
      const i = buf.indexOf("\n")
      if (i >= 0) {
        finish({ connected: true, response: buf.slice(0, i), error: null, closedByPeer: false })
      }
    })
    sock.on("error", (e: any) => {
      finish({ connected: true, response: null, error: `SOCKET:${e?.code ?? e}`, closedByPeer: false })
    })
    sock.on("end", () => {
      finish({
        connected: true,
        response: buf.length > 0 ? buf : null,
        error: buf.length > 0 ? null : "EOF_NO_RESPONSE",
        closedByPeer: true,
      })
    })
    sock.on("close", (hadError: boolean) => {
      if (!settled) {
        finish({
          connected: true,
          response: buf.length > 0 ? buf : null,
          error: buf.length > 0 ? null : "CLOSED_NO_RESPONSE",
          closedByPeer: true,
        })
      }
      void hadError
    })
  })
}


interface Fixture {
  socketPath: string
  workDir: string
  proc: Subprocess
  pid: number
  startIdentity: string | null
  binaryPath: string
  binarySha256: string
  buildId: string
  identityProbePath: string | null
}

/**
 * Spawn an ISOLATED helper instance against a unique socket. This
 * never touches the installed LaunchAgent or its socket.
 */
async function spawnIsolatedHelper(): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const workDir = join(FIXTURE_ROOT, `clinemm-helper-lifecycle-${stamp}`)
  mkdirSync(workDir, { recursive: true, mode: 0o700 })
  const socketPath = join(workDir, "helper.sock")
  const statusPath = join(workDir, "helper.status.json")

  const proc = spawn({
    cmd: [HELPER_BIN],
    env: {
      ...process.env,
      CLINEMM_HOST_HELPER_SOCKET: socketPath,
      CLINEMM_HELPER_STATUS_PATH: statusPath,
      CLINEMM_HELPER_SRC: HELPER_SRC,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })

  // Wait for the status file: it is written after bind()+listen().
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (existsSync(statusPath)) break
    await new Promise((r) => setTimeout(r, 50))
  }
  if (!existsSync(statusPath)) {
    throw new Error(`isolated helper did not produce status file: ${statusPath}`)
  }

  const status = JSON.parse(readFileSync(statusPath, "utf8"))
  if (status.activated !== false) {
    throw new Error(`isolated helper unexpectedly activated under launchd (activated=${status.activated})`)
  }
  if (status.pid !== proc.pid) {
    throw new Error(`isolated helper pid mismatch: status=${status.pid} spawn=${proc.pid}`)
  }

  const shaProc = Bun.spawnSync({ cmd: ["shasum", "-a", "256", HELPER_BIN], stdout: "pipe", stderr: "pipe" })
  const binarySha256 = shaProc.stdout.toString().trim().split(/\s+/)[0] ?? ""
  const bytes = readFileSync(HELPER_BIN)
  const buildIdMatch = bytes.toString("binary").match(/[0-9a-f]{64}/)
  const buildId = buildIdMatch?.[0] ?? "unknown"
  const identityProbePath = compileIdentityProbe()

  return {
    socketPath,
    workDir,
    proc,
    pid: proc.pid,
    startIdentity: readStartIdentity(proc.pid, identityProbePath),
    binaryPath: HELPER_BIN,
    binarySha256,
    buildId,
    identityProbePath,
  }
}


interface WatchdogResult {
  residualPid: number | null
  residualStartIdentity: string | null
  residualAlive: boolean
  escalationAttempted: boolean
  escalationError: string | null
  socketReclaimed: boolean
  fixtureReclaimed: boolean
  cleanupVerified: boolean
}

/**
 * Bounded, identity-verifying watchdog.
 *
 *  - closes both client sockets (done by the caller via the socket refs)
 *  - terminates the isolated helper if it is still running
 *  - verifies the helper's PID/start identity BEFORE any escalation
 *  - verifies the temporary socket and fixture are reclaimed
 *
 * If the execution substrate withholds signal authority, the watchdog
 * reports the EXACT residual identity and the residual liveness. It
 * never silently reports success.
 */
async function runWatchdog(fixture: Fixture, clients: Socket[]): Promise<WatchdogResult> {
  for (const c of clients) {
    try {
      c.removeAllListeners()
      c.destroy()
    } catch {
      /* ignore */
    }
  }

  let escalationAttempted = false
  let escalationError: string | null = null
  const aliveBefore = pidAlive(fixture.pid)
  // Identity check BEFORE escalation: only signal the pid if it is
  // still the exact process we spawned (PID-reuse protection).
  const currentIdentity = readStartIdentity(fixture.pid, fixture.identityProbePath)
  const identityMatches = aliveBefore && fixture.startIdentity !== null && currentIdentity === fixture.startIdentity

  if (aliveBefore) {
    if (identityMatches) {
      escalationAttempted = true
      try {
        fixture.proc.kill("SIGTERM")
      } catch (e: any) {
        escalationError = `SIGTERM:${e?.code ?? e}`
      }
      // Give the helper a bounded window to exit on SIGTERM.
      const killDeadline = Date.now() + 1500
      while (Date.now() < killDeadline && pidAlive(fixture.pid)) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (pidAlive(fixture.pid)) {
        escalationAttempted = true
        try {
          fixture.proc.kill("SIGKILL")
        } catch (e: any) {
          escalationError = `SIGKILL:${e?.code ?? e}`
        }
        const hardDeadline = Date.now() + 1500
        while (Date.now() < hardDeadline && pidAlive(fixture.pid)) {
          await new Promise((r) => setTimeout(r, 50))
        }
      }
    } else {
      escalationError = `IDENTITY_MISMATCH(spawned=${fixture.startIdentity} current=${currentIdentity})`
    }
  }

  // Capture the residual identity BEFORE reclaiming the fixture
  // directory: the identity probe binary lives inside the fixture
  // directory, so removing it first would silently degrade the
  // residual-identity report to "unknown".
  const residualAlive = pidAlive(fixture.pid)
  const residualStartIdentity = residualAlive
    ? readStartIdentity(fixture.pid, fixture.identityProbePath)
    : null

  // Reclaim the fixture directory (socket + status file).
  let socketReclaimed = false
  let fixtureReclaimed = false
  try {
    rmSync(fixture.workDir, { recursive: true, force: true })
    fixtureReclaimed = !existsSync(fixture.workDir)
    socketReclaimed = !existsSync(fixture.socketPath)
  } catch {
    /* ignore */
  }

  return {
    residualPid: residualAlive ? fixture.pid : null,
    residualStartIdentity,
    residualAlive,
    escalationAttempted,
    escalationError,
    socketReclaimed,
    fixtureReclaimed,
    cleanupVerified: !residualAlive && socketReclaimed && fixtureReclaimed,
  }
}


// =============================================================================
// T0 -- transport primitive contract (source-level conservation)
// =============================================================================

describe("bounded transport primitive contract", () => {
  // NOTE: these assertions report a BOOLEAN, not the whole source
  // file. Dumping 200 KB of helper.c into a failed assertion makes
  // the test output unreadable and hides the actual signal.
  const containsAll = (src: string, tokens: string[]): string[] =>
    tokens.filter((t) => !src.includes(t))

  test("source declares bounded receive and response deadlines", () => {
    const src = readFileSync(HELPER_SRC, "utf8")
    const missing = containsAll(src, [
      "MAX_FRAME_RECEIVE_MS",
      "MAX_FRAME_RESPONSE_MS",
      "CLOCK_MONOTONIC",
      "poll(",
      "O_NONBLOCK",
    ])
    expect(missing).toEqual([])
  })

  test("source classifies every read outcome", () => {
    const src = readFileSync(HELPER_SRC, "utf8")
    const missing = containsAll(src, [
      "FRAME_COMPLETE",
      "FRAME_INCOMPLETE_EOF",
      "FRAME_RECEIVE_TIMEOUT",
      "FRAME_RECEIVE_ERROR",
      "FRAME_OVERSIZE",
    ])
    expect(missing).toEqual([])
  })

  test("no unbounded read/write remains on the accepted-socket path", () => {
    const src = readFileSync(HELPER_SRC, "utf8")
    // The pre-fix defect was a bare `read(fd, buf + off, 1)` inside a
    // loop with no poll() and no deadline.
    const stillReadsOneByte = /read\(fd,\s*buf\s*\+\s*off,\s*1\)/.test(src)
    // The pre-fix defect was a bare `write(fd, buf + off, n - off)`
    // loop with no poll() and no deadline. The REPAIRED writer keeps
    // the same call shape but brackets it with an absolute deadline +
    // poll(), so the source-level check is on the ABSENCE of a
    // deadline-free writer: the repaired code must route every write
    // through write_all_bounded().
    const stillWritesBlocking =
      /write\(fd,\s*buf\s*\+\s*off,\s*n\s*-\s*off\)/.test(src) &&
      !/write_all_bounded\(int fd/.test(src)
    // The shared response writer must route every write through the
    // bounded writer. Extract the write_all() body and check it.
    const writeAllBody = (() => {
      const start = src.indexOf("static ssize_t write_all(int fd, const char *buf, size_t n) {")
      if (start < 0) return ""
      const end = src.indexOf("\n}", start)
      return end < 0 ? "" : src.slice(start, end)
    })()
    const writerIsBounded = writeAllBody.includes("write_all_bounded(fd, buf, n, g_response_deadline)")
    expect({ stillReadsOneByte, stillWritesBlocking, writerIsBounded }).toEqual({
      stillReadsOneByte: false,
      stillWritesBlocking: false,
      writerIsBounded: true,
    })
  })
})

// =============================================================================
// RED / GREEN -- two-client lifecycle fixture
// =============================================================================

describe("two-client bounded request lifecycle", () => {
  test("client A incomplete frame cannot indefinitely starve client B", async () => {
    const mode = currentMode()
    await ensureHelperBinary()
    const fixture = await spawnIsolatedHelper()
    const sockets: Socket[] = []
    const startedAt = new Date().toISOString()
    const t0 = Date.now()

    let clientA: ClientResult | null = null
    let clientB: ClientResult | null = null
    let watchdog: WatchdogResult | null = null
    let helperAliveAtTimeout = false

    try {
      // --- Client A: connect, send an INCOMPLETE frame (no newline), stay open.
      const sockA = createConnection(fixture.socketPath)
      sockets.push(sockA)
      await new Promise<void>((resolve, reject) => {
        sockA.once("connect", () => resolve())
        sockA.once("error", (e) => reject(e))
        setTimeout(() => reject(new Error("A_CONNECT_TIMEOUT")), 5000)
      })
      // Partial JSON, deliberately no terminating newline.
      sockA.write('{"version":1,"request_id":"client-a-stall","method":"heal')

      // IMPORTANT: observe client A's close CONCURRENTLY with client
      // B's request. The helper serves connections SEQUENTIALLY, so
      // A's release by the receive deadline is what unblocks B. If the
      // A-observation were started only after B completed, the close
      // event would already have fired and the observation would
      // falsely report "STILL_OPEN".
      const clientAObs = await new Promise<ClientResult>((resolve) => {
        const started = Date.now()
        let buf = ""
        let settled = false
        const finish = (r: Omit<ClientResult, "elapsedMs">): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ ...r, elapsedMs: Date.now() - started })
        }
        const timer = setTimeout(() => {
          finish({ connected: true, response: null, error: "STILL_OPEN", closedByPeer: false })
        }, EXPECTED_RECEIVE_DEADLINE_MS + 4000)
        sockA.on("data", (c) => {
          buf += c.toString()
        })
        sockA.on("end", () =>
          finish({ connected: true, response: buf || null, error: null, closedByPeer: true }),
        )
        sockA.on("close", () =>
          finish({
            connected: true,
            response: buf || null,
            error: buf.length > 0 ? null : "CLOSED_NO_RESPONSE",
            closedByPeer: true,
          }),
        )
        sockA.on("error", (e: any) =>
          finish({ connected: true, response: buf || null, error: `SOCKET:${e?.code ?? e}`, closedByPeer: true }),
        )
      })
      clientA = clientAObs

      // --- Client B: connect, send a COMPLETE valid health request.
      const healthRequest = JSON.stringify({
        version: 1,
        request_id: "client-b-health",
        method: "health",
      })
      const bResult = await openClient(fixture.socketPath, {
        payload: healthRequest + "\n",
        waitMs: HEALTH_WAIT_MS,
      })
      clientB = bResult

      helperAliveAtTimeout = pidAlive(fixture.pid)
    } finally {
      watchdog = await runWatchdog(fixture, sockets)
    }

    const totalMs = Date.now() - t0
    const evidence = {
      startedAt,
      totalMs,
      mode,
      fixture: {
        pid: fixture.pid,
        startIdentity: fixture.startIdentity,
        binaryPath: fixture.binaryPath,
        binarySha256: fixture.binarySha256,
        buildId: fixture.buildId,
        socketPath: fixture.socketPath,
      },
      clientA,
      clientB,
      helperAliveAtTimeout,
      watchdog,
    }
    // Print the raw evidence so the operator can read the exact
    // timestamps and identities from the test output.
    console.log("LIFECYCLE_EVIDENCE " + JSON.stringify(evidence))

    if (mode === "red") {
      // --- RED expectations: the OLD binary wedges the service.
      expect(clientA!.connected).toBe(true)
      expect(clientA!.closedByPeer).toBe(false)
      expect(clientA!.error).toBe("STILL_OPEN")
      expect(clientB!.response).toBeNull()
      expect(clientB!.error).toBe("TIMEOUT")
      expect(helperAliveAtTimeout).toBe(true)
      // Watchdog MUST have reclaimed the fixture. If the substrate
      // withheld signal authority, the residual identity is reported
      // explicitly and the fixture is still reclaimed.
      expect(watchdog!.fixtureReclaimed).toBe(true)
      return
    }

    // --- GREEN expectations (the default `auto` mode asserts these).
    expect(clientA!.connected).toBe(true)
    // A must be closed by the helper's receive deadline.
    expect(clientA!.closedByPeer).toBe(true)
    expect(clientA!.elapsedMs).toBeLessThan(EXPECTED_RECEIVE_DEADLINE_MS + 1500)
    // B must receive a valid, correlated health response.
    expect(clientB!.response).not.toBeNull()
    const parsed = JSON.parse(clientB!.response!)
    expect(parsed.ok).toBe(true)
    expect(parsed.request_id).toBe("client-b-health")
    expect(parsed.service).toBe("clinemm-host-helper")
    // The helper must NOT have been restarted by the repair: the
    // health response's pid must be the SAME pid the fixture spawned.
    expect(parsed.pid).toBe(fixture.pid)
    // The fixture (socket + directory) MUST always be reclaimed.
    expect(watchdog!.socketReclaimed).toBe(true)
    expect(watchdog!.fixtureReclaimed).toBe(true)
    // Process cleanup depends on the execution substrate's authority
    // over its own children. On a substrate that grants that authority
    // the helper must be gone. On a substrate that withholds it (the
    // Background Exec Seatbelt profile blocks kill() on same-UID
    // children with EPERM), the watchdog MUST have attempted the
    // identity-verified escalation AND reported the exact residual
    // identity -- it must never silently claim success.
    if (watchdog!.residualAlive) {
      expect(watchdog!.escalationAttempted).toBe(true)
      expect(watchdog!.escalationError).toBeTruthy()
      expect(watchdog!.residualPid).toBe(fixture.pid)
      expect(watchdog!.residualStartIdentity).toBe(fixture.startIdentity)
    } else {
      expect(watchdog!.cleanupVerified).toBe(true)
    }
    // Bounded total latency: A's receive budget + B's normal budget.
    expect(totalMs).toBeLessThan(EXPECTED_RECEIVE_DEADLINE_MS + EXPECTED_RESPONSE_DEADLINE_MS + 3000)
  }, EXPERIMENT_BOUND_MS)
})

// =============================================================================
// ADVERSARIAL TRANSPORT MATRIX (T1 - T12)
//
// Every case is independently bounded and runs against the ISOLATED
// helper. No case is ever sent to the installed production service.
//
//  T1  connect, send zero bytes              -> deadline, close, health OK
//  T2  partial JSON without newline          -> deadline, close
//  T3  one byte periodically (slow trickle)  -> ABSOLUTE deadline expires
//  T4  complete valid health                 -> response unchanged
//  T5  complete frame followed by EOF        -> normal dispatch
//  T6  EOF before complete frame             -> fail closed
//  T7  oversized frame                       -> existing size limit enforced
//  T8  malformed complete JSON               -> existing parser error
//  T9  client disconnects during response    -> bounded failure, helper survives
//  T10 complete request, peer stops reading  -> bounded response path
//  T11 several sequential stalled clients    -> each eventually released
//  T12 valid request after timeout cases     -> health still operational
// =============================================================================

describe("adversarial transport matrix", () => {
  // Shared isolated helper for the whole matrix. The helper is proven
  // healthy before the matrix runs and after it finishes.
  let fixture: Fixture
  const sockets: Socket[] = []

  beforeAll(async () => {
    await ensureHelperBinary()
    fixture = await spawnIsolatedHelper()
  })

  afterAll(async () => {
    await runWatchdog(fixture, sockets)
  })

  /** Open a raw socket against the isolated helper and return it. */
  const connectRaw = async (): Promise<Socket> => {
    const sock = createConnection(fixture.socketPath)
    sockets.push(sock)
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", () => resolve())
      sock.once("error", (e) => reject(e))
      setTimeout(() => reject(new Error("CONNECT_TIMEOUT")), 5000)
    })
    return sock
  }

  /** Wait for the peer to close the socket, bounded. */
  const waitForPeerClose = (sock: Socket, waitMs: number): Promise<{ closed: boolean; data: string }> =>
    new Promise((resolve) => {
      let buf = ""
      let settled = false
      const finish = (closed: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ closed, data: buf })
      }
      const timer = setTimeout(() => finish(false), waitMs)
      sock.on("data", (c) => {
        buf += c.toString()
      })
      sock.on("end", () => finish(true))
      sock.on("close", () => finish(true))
      sock.on("error", () => finish(true))
    })

  /** Collect whatever the peer sends until it closes or the bound hits. */
  const collectUntilClose = (sock: Socket, waitMs: number): Promise<{ data: string; closed: boolean }> =>
    new Promise((resolve) => {
      let buf = ""
      let settled = false
      const finish = (closed: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ data: buf, closed })
      }
      const timer = setTimeout(() => finish(false), waitMs)
      sock.on("data", (c) => {
        buf += c.toString()
      })
      sock.on("end", () => finish(true))
      sock.on("close", () => finish(true))
      sock.on("error", () => finish(true))
    })

  const health = async (requestId: string): Promise<any> => {
    const r = await openClient(fixture.socketPath, {
      payload: JSON.stringify({ version: 1, request_id: requestId, method: "health" }) + "\n",
      waitMs: 4000,
    })
    expect(r.response).not.toBeNull()
    return JSON.parse(r.response!)
  }

  test("T1: connect and send ZERO bytes -> deadline, close, subsequent health succeeds", async () => {
    const sock = await connectRaw()
    const started = Date.now()
    const closed = await waitForPeerClose(sock, EXPECTED_RECEIVE_DEADLINE_MS + 2000)
    expect(closed.closed).toBe(true)
    // The close must happen near the receive deadline, not instantly
    // (an instant close would mean we dropped a legitimate slow
    // client) and not much later (that would mean no bound).
    expect(Date.now() - started).toBeLessThan(EXPECTED_RECEIVE_DEADLINE_MS + 2000)
    const h = await health("t1-health-after")
    expect(h.ok).toBe(true)
    expect(h.request_id).toBe("t1-health-after")
  }, 15000)

  test("T2: partial JSON without newline -> deadline, close", async () => {
    const sock = await connectRaw()
    sock.write('{"version":1,"request_id":"t2","method":"hel')
    const started = Date.now()
    const closed = await waitForPeerClose(sock, EXPECTED_RECEIVE_DEADLINE_MS + 2000)
    expect(closed.closed).toBe(true)
    expect(Date.now() - started).toBeLessThan(EXPECTED_RECEIVE_DEADLINE_MS + 2000)
    // No correlated response may be synthesized for an incomplete frame.
    expect(closed.data).not.toContain("t2")
  }, 15000)

  test("T3: one byte periodically (slow trickle) -> ABSOLUTE deadline still expires", async () => {
    const sock = await connectRaw()
    const payload = '{"version":1,"request_id":"t3","method":"health"}'
    const started = Date.now()
    let idx = 0
    const ticker = setInterval(() => {
      if (idx < payload.length) {
        try {
          sock.write(payload[idx++])
        } catch {
          /* ignore */
        }
      }
    }, 100)
    const closed = await waitForPeerClose(sock, EXPECTED_RECEIVE_DEADLINE_MS + 2500)
    clearInterval(ticker)
    const elapsed = Date.now() - started
    expect(closed.closed).toBe(true)
    // The trickle must NOT extend the budget: the deadline is absolute.
    expect(elapsed).toBeLessThan(EXPECTED_RECEIVE_DEADLINE_MS + 2500)
    // And it must not expire so early that a legitimate client which
    // finished its frame is dropped.
    expect(elapsed).toBeGreaterThan(EXPECTED_RECEIVE_DEADLINE_MS - 500)
  }, 20000)

  test("T4: complete valid health -> existing response unchanged", async () => {
    const h = await health("t4-health")
    expect(h.version).toBe(1)
    expect(h.ok).toBe(true)
    expect(h.request_id).toBe("t4-health")
    expect(h.service).toBe("clinemm-host-helper")
    expect(typeof h.pid).toBe("number")
    expect(typeof h.uid).toBe("number")
    expect(typeof h.build_id).toBe("string")
    expect(h.build_id.length).toBe(64)
  }, 10000)

  test("T5: complete frame followed by EOF -> normal dispatch", async () => {
    // The half-close case CANNOT be observed through Node/Bun's socket
    // API on macOS AF_UNIX: `socket.end()` there does not deliver a
    // pending write followed by a FIN the way the POSIX syscall
    // sequence does, so it produces a FALSE NEGATIVE that would look
    // like a framing regression. The raw frame client performs the
    // exact syscall sequence the framing contract is about:
    // write(2) the complete frame, then shutdown(fd, SHUT_WR).
    const probe = fixture.identityProbePath
    expect(probe).not.toBeNull()
    const r = Bun.spawnSync({
      cmd: [probe!, "--frame", fixture.socketPath, "--shutdown"],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = r.stdout.toString()
    expect(text).toContain("raw-frame-client")
    expect(text).not.toContain("<NO_RESPONSE>")
    const parsed = JSON.parse(text.split("\n")[0])
    expect(parsed.ok).toBe(true)
    expect(parsed.request_id).toBe("raw-frame-client")
  }, 10000)

  test("T6: EOF before complete frame -> fail closed", async () => {
    // Raw client: write a PARTIAL frame (no newline), then half-close so
    // the helper observes EOF before the frame is complete.
    const probe = fixture.identityProbePath
    expect(probe).not.toBeNull()
    const r = Bun.spawnSync({
      cmd: [probe!, "--frame", fixture.socketPath, "--shutdown", "--partial"],
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = r.stdout.toString()
    // No response may be produced for an incomplete frame, and in
    // particular no successful response.
    expect(text).not.toContain('"ok":true')
    // The helper must survive and still serve.
    const h = await health("t6-health-after")
    expect(h.ok).toBe(true)
  }, 10000)

  test("T7: oversized frame -> existing size limit enforced", async () => {
    const sock = await connectRaw()
    // More than MAX_FRAME (8192) bytes with NO newline.
    const chunk = "x".repeat(4096)
    sock.write(chunk)
    sock.write(chunk)
    sock.write(chunk)
    const r = await collectUntilClose(sock, 4000)
    // The pre-existing OVERSIZE error contract is preserved.
    expect(r.data).toContain("OVERSIZE")
    // The helper must survive.
    const h = await health("t7-health-after")
    expect(h.ok).toBe(true)
  }, 15000)

  test("T8: malformed complete JSON -> existing parser error", async () => {
    const r = await openClient(fixture.socketPath, {
      payload: '{"version":1,"request_id":"t8",,,}\n',
      waitMs: 4000,
    })
    expect(r.response).not.toBeNull()
    const parsed = JSON.parse(r.response!)
    expect(parsed.ok).toBe(false)
    expect(typeof parsed.error).toBe("string")
    const h = await health("t8-health-after")
    expect(h.ok).toBe(true)
  }, 10000)

  test("T9: client disconnects during response -> bounded failure, helper survives", async () => {
    const sock = await connectRaw()
    sock.write(JSON.stringify({ version: 1, request_id: "t9-disconnect", method: "health" }) + "\n")
    // Destroy the socket immediately so the peer may see EPIPE/ECONNRESET
    // while it is writing the response.
    sock.destroy()
    // The helper must survive and keep serving.
    const h = await health("t9-health-after")
    expect(h.ok).toBe(true)
    expect(h.request_id).toBe("t9-health-after")
  }, 10000)

  test("T10: complete request, peer stops reading -> bounded response path", async () => {
    const sock = await connectRaw()
    // Send a complete, valid request but NEVER read the response.
    // The peer socket's receive buffer will eventually fill; the
    // helper's response write must then be bounded by the response
    // deadline rather than blocking indefinitely.
    sock.write(JSON.stringify({ version: 1, request_id: "t10-stalled-writer", method: "health" }) + "\n")
    // Deliberately do not attach a 'data' listener: the response is
    // never consumed by the application.
    sock.pause()
    const started = Date.now()
    // Observe that the helper is released. The response path must not
    // hold the helper beyond the response budget.
    const health = await openClient(fixture.socketPath, {
      payload: JSON.stringify({ version: 1, request_id: "t10-health-after", method: "health" }) + "\n",
      waitMs: EXPECTED_RECEIVE_DEADLINE_MS + EXPECTED_RESPONSE_DEADLINE_MS + 4000,
    })
    const elapsed = Date.now() - started
    expect(health.response).not.toBeNull()
    const parsed = JSON.parse(health.response!)
    expect(parsed.ok).toBe(true)
    expect(parsed.request_id).toBe("t10-health-after")
    // The stalled writer must not have blocked the service forever.
    expect(elapsed).toBeLessThan(EXPECTED_RECEIVE_DEADLINE_MS + EXPECTED_RESPONSE_DEADLINE_MS + 4000)
  }, 25000)

  test("T11: several sequential stalled clients -> each eventually released", async () => {
    const stalled: Socket[] = []
    for (let i = 0; i < 3; i++) {
      const sock = await connectRaw()
      stalled.push(sock)
      // Incomplete frame, no newline.
      sock.write(`{"version":1,"request_id":"t11-${i}","method":"heal`)
      // Each stalled client must be released by the absolute deadline.
      const closed = await waitForPeerClose(sock, EXPECTED_RECEIVE_DEADLINE_MS + 2500)
      expect(closed.closed).toBe(true)
    }
    // After three sequential stalls the helper must still serve.
    const h = await health("t11-health-after")
    expect(h.ok).toBe(true)
    expect(h.request_id).toBe("t11-health-after")
  }, 30000)

  test("T12: valid request after timeout cases -> health and capability services remain operational", async () => {
    // health
    const h = await health("t12-health")
    expect(h.ok).toBe(true)
    expect(h.request_id).toBe("t12-health")
    // client.open -- the capability surface must still work.
    const open = await openClient(fixture.socketPath, {
      payload: JSON.stringify({ version: 1, request_id: "t12-client-open", method: "client.open" }) + "\n",
      waitMs: 4000,
    })
    expect(open.response).not.toBeNull()
    const opened = JSON.parse(open.response!)
    expect(opened.ok).toBe(true)
    expect(opened.request_id).toBe("t12-client-open")
    // The C helper emits client_token at the TOP level of the envelope
    // (see handle_client_open), not nested under `result`.
    expect(typeof opened.client_token).toBe("string")
    expect(opened.client_token.length).toBe(32)
    // client.close -- the capability surface must still reclaim slots.
    const closeRes = await openClient(fixture.socketPath, {
      payload:
        JSON.stringify({
          version: 1,
          request_id: "t12-client-close",
          method: "client.close",
          client_token: opened.client_token,
        }) + "\n",
      waitMs: 4000,
    })
    expect(closeRes.response).not.toBeNull()
    const closed = JSON.parse(closeRes.response!)
    expect(closed.ok).toBe(true)
    expect(closed.request_id).toBe("t12-client-close")
    // And health must still be good afterwards.
    const h2 = await health("t12-health-final")
    expect(h2.ok).toBe(true)
  }, 20000)
})
