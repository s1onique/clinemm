/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C2, C3 (TartBackend)
 *
 * Real TartBackend. Drives the actual `tart` CLI via the supplied
 * `ProcessRunner`. All argv are constructed via the pure helpers
 * in `./tart-cli.ts`; no shell, no template strings.
 *
 * Lifecycle (C6): prepare() → start() → waitReady() → exec/etc.
 *   - prepare(): `tart clone`
 *   - start(): `tart run --no-graphics` in the background;
 *     timedOut=true is the expected outcome.
 *   - waitReady(): poll `tart ip` + ssh until both succeed.
 */

import {
  type BackendPrepareArgs,
  type BackendStartArgs,
  type BackendWaitReadyArgs,
  type BackendReadyInfo,
  type CopyInRequest,
  type CopyOutRequest,
  type CopyOutResult,
  type ExecRequest,
  type ExecResult,
  type TestbedBackend,
} from "./backend.ts";
import type { ProcessRunner, ProcessRunResult, ProcessHandle } from "./process-runner.ts";
import { sshRemoteArgv } from "./ssh-argv.ts";
import {
  tartCloneArgv,
  tartDeleteArgv,
  tartIpArgv,
  tartRunArgv,
  tartStopArgv,
  validateImageRef,
} from "./tart-cli.ts";
import { TestbedError, type TestbedErrorCode } from "./types.ts";

const POLL_INTERVAL_MS = 1000;

function mapProcFailure(
  err: ProcessRunResult,
  code: TestbedErrorCode,
  msg: string,
): TestbedError {
  const tail = (s: string): string => s.split("\n").slice(-5).join("\n");
  return new TestbedError(
    code,
    msg,
    `exitCode=${err.exitCode} stderr=${JSON.stringify(tail(err.stderr))}`,
  );
}

export interface TartBackendOptions {
  readonly pollIntervalMs?: number;
  readonly sshUser?: string;
}

export class TartBackend implements TestbedBackend {
  readonly backendName = "tart";
  private readonly pollIntervalMs: number;
  private readonly sshUserDefault: string;
  private lastGuestIp: string | null = null;
  /** Handle to the `tart run` process; retained across start→stop. */
  private runHandle: ProcessHandle | null = null;
  /** VM name we last started; used to refuse to delete foreign VMs. */
  private activeVmName: string | null = null;

  constructor(opts: TartBackendOptions = {}) {
    this.pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.sshUserDefault = opts.sshUser ?? "admin";
  }

  /** Exposed for tests only. The handle is null before start(). */
  _getRunHandle(): ProcessHandle | null {
    return this.runHandle;
  }

  async prepare(args: BackendPrepareArgs, proc: ProcessRunner): Promise<void> {
    const iv = validateImageRef(args.image);
    if (!iv.ok) throw new TestbedError("TESTBED_PREPARE_FAILED", iv.error);
    const argv = tartCloneArgv({ image: args.image, vmName: args.vmName });
    const r = await proc.run({ argv, timeoutMs: 20 * 60 * 1000 });
    if (r.exitCode !== 0) {
      throw mapProcFailure(r, "TART_CLONE_FAILED", `tart clone failed for ${args.vmName}`);
    }
  }

  async start(args: BackendStartArgs, proc: ProcessRunner): Promise<void> {
    const argv = tartRunArgv({ vmName: args.vmName, noGraphics: true });
    // CORRECTION01: `tart run --no-graphics` is a long-running
    // foreground process. We must NOT apply a timeout (SIGKILL
    // tears the VM down). Use spawn() and retain the handle.
    const handle = await proc.spawn({ argv });
    this.runHandle = handle;
    this.activeVmName = args.vmName;
    // Best-effort: detect immediate synchronous failure (binary
    // missing, image invalid). A 200ms probe is short enough not
    // to slow real starts but long enough to catch the most
    // common "spawn returned but child died before our next
    // syscall" case. After this probe, the process is presumed
    // alive; waitReady() will catch any later failure.
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    const probe = new Promise<void>((res) => {
        probeTimer = setTimeout(res, 200);
      });
    const probeResult = await Promise.race([
      handle.exited.then((info) => ({ kind: "exited" as const, info })),
      probe.then(() => ({ kind: "alive" as const })),
    ]);
    if (probeTimer !== undefined) clearTimeout(probeTimer);
    if (probeResult.kind === "exited") {
      // The process died before we could give it 200ms. Surface
      // as a TART_START_FAILED so the orchestrator records the
      // primary failure (not a misleading "tart ip timeout").
      this.runHandle = null;
      throw new TestbedError(
        "TART_START_FAILED",
        `tart run exited before becoming long-lived: code=${probeResult.info.exitCode} signal=${probeResult.info.signal ?? "none"}`,
      );
    }
  }

  async waitReady(args: BackendWaitReadyArgs, proc: ProcessRunner): Promise<BackendReadyInfo> {
    const ipDeadline = Date.now() + args.ipTimeoutMs;
    let guestIp: string | null = null;
    while (Date.now() < ipDeadline) {
      const argv = tartIpArgv(args.vmName);
      const r = await proc.run({ argv, timeoutMs: 5000 });
      if (r.exitCode === 0 && r.stdout.trim().length > 0) {
        const candidate = r.stdout.trim().split(/\s+/)[0] ?? null;
        if (candidate !== null && /^[0-9a-fA-F:.]+$/.test(candidate)) {
          guestIp = candidate;
          break;
        }
      }
      await new Promise((res) => setTimeout(res, this.pollIntervalMs));
    }
    if (guestIp === null) {
      throw new TestbedError(
        "TART_IP_TIMEOUT",
        `tart ip never returned an address within ${args.ipTimeoutMs}ms`,
      );
    }
    const sshDeadline = Date.now() + args.sshTimeoutMs;
    while (Date.now() < sshDeadline) {
      const sb = sshRemoteArgv({
        guestIp,
        user: args.user ?? this.sshUserDefault,
        remoteArgv: ["true"],
        identityFile: args.identityFile,
        knownHostsFile: args.knownHostsFile,
        connectTimeoutMs: 3000,
      });
      if (!sb.ok) throw new TestbedError("TESTBED_INTERNAL_ERROR", sb.error);
      const r = await proc.run({ argv: sb.argv, timeoutMs: 5000 });
      if (r.exitCode === 0) {
        this.lastGuestIp = guestIp;
        return { guestIp, phase: "READY" };
      }
      await new Promise((res) => setTimeout(res, this.pollIntervalMs));
    }
    throw new TestbedError(
      "TART_SSH_TIMEOUT",
      `ssh never became ready within ${args.sshTimeoutMs}ms`,
    );
  }
  async exec(
    args: { vmName: string; guestIp: string; user: string; req: ExecRequest; identityFile?: string; knownHostsFile?: string },
    proc: ProcessRunner,
  ): Promise<ExecResult> {
    const sb = sshRemoteArgv({
      guestIp: args.guestIp,
      user: args.user,
      remoteArgv: args.req.argv,
      identityFile: args.identityFile,
      knownHostsFile: args.knownHostsFile,
      connectTimeoutMs: 5000,
    });
    if (!sb.ok) throw new TestbedError("TESTBED_INTERNAL_ERROR", sb.error);
    const r = await proc.run({
      argv: sb.argv,
      cwd: args.req.cwd,
      env: args.req.env,
      timeoutMs: args.req.timeoutMs ?? 5 * 60 * 1000,
    });
    return {
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      timedOut: r.timedOut,
      durationMs: r.durationMs,
    };
  }

  async copyIn(
    args: { vmName: string; guestIp: string; user: string; req: CopyInRequest; identityFile?: string; knownHostsFile?: string },
    proc: ProcessRunner,
  ): Promise<void> {
    const argv: string[] = ["scp"];
    if (args.req.recursive === true) argv.push("-r");
    argv.push("-o", "BatchMode=yes");
    argv.push("-o", "StrictHostKeyChecking=yes");
    if (args.knownHostsFile !== undefined) {
      argv.push("-o", `UserKnownHostsFile=${args.knownHostsFile}`);
    }
    if (args.identityFile !== undefined) {
      argv.push("-o", `IdentityFile=${args.identityFile}`);
    }
    argv.push(args.req.hostPath, `${args.user}@${args.guestIp}:${args.req.guestPath}`);
    const r = await proc.run({ argv, timeoutMs: 5 * 60 * 1000 });
    if (r.exitCode !== 0) {
      throw mapProcFailure(r, "TESTBED_COPY_IN_FAILED", `scp copyIn failed`);
    }
  }

  async copyOut(
    args: { vmName: string; guestIp: string; user: string; req: CopyOutRequest; identityFile?: string; knownHostsFile?: string },
    proc: ProcessRunner,
  ): Promise<CopyOutResult> {
    const argv: string[] = ["scp"];
    if (args.req.recursive === true) argv.push("-r");
    argv.push("-o", "BatchMode=yes");
    argv.push("-o", "StrictHostKeyChecking=yes");
    if (args.knownHostsFile !== undefined) {
      argv.push("-o", `UserKnownHostsFile=${args.knownHostsFile}`);
    }
    if (args.identityFile !== undefined) {
      argv.push("-o", `IdentityFile=${args.identityFile}`);
    }
    argv.push(`${args.user}@${args.guestIp}:${args.req.guestPath}`, args.req.hostDestination);
    const r = await proc.run({ argv, timeoutMs: 5 * 60 * 1000 });
    if (r.exitCode !== 0) {
      // We can't tell here whether the source file was missing
      // or scp itself failed. Treat as COPY_OUT_FAILED; the
      // orchestrator's copyIn materialization guarantees the
      // source exists if the scenario is well-formed.
      throw mapProcFailure(r, "TESTBED_COPY_OUT_FAILED", `scp copyOut failed`);
    }
    // The orchestrator computes the SHA from the destination
    // file; this method returns zero/empty and the orchestrator
    // will overwrite with the real values. We keep the return
    // shape stable so backend tests can be independent of file
    // IO.
    return { exists: true, byteSize: 0, sha256: "" };
  }

  async stop(args: { vmName: string }, proc: ProcessRunner): Promise<void> {
    // CORRECTION01: stop the daemon `tart run` process via the
    // retained handle, after a polite `tart stop` request.
    const argv = tartStopArgv(args.vmName);
    const r = await proc.run({ argv, timeoutMs: 60 * 1000 });
    if (r.exitCode !== null && r.exitCode !== 0 && !r.timedOut) {
      throw mapProcFailure(r, "TART_STOP_FAILED", `tart stop failed for ${args.vmName}`);
    }
    // The handle may already be null (e.g. start() failed or
    // stop() was called twice).
    const handle = this.runHandle;
    this.runHandle = null;
    this.activeVmName = null;
    if (handle !== null) {
      // Bounded wait: 5s for the spawned `tart run` to exit on
      // its own (because `tart stop` issued shutdown). If it
      // doesn't, escalate to SIGTERM, then SIGKILL.
      const waited = await Promise.race([
        handle.exited.then(() => "exited"),
        new Promise<"timed">((res) => setTimeout(() => res("timed"), 5000)),
      ]);
      if (waited === "timed") {
        await handle.terminate("SIGTERM");
        const waited2 = await Promise.race([
          handle.exited.then(() => "exited"),
          new Promise<"timed">((res) => setTimeout(() => res("timed"), 3000)),
        ]);
        if (waited2 === "timed") await handle.kill("SIGKILL");
      }
    }
  }

  async destroy(args: { vmName: string; runId: string }, proc: ProcessRunner): Promise<void> {
    // VM ownership gate (C4). The orchestrator already checked,
    // but we double-check here as the last line of defense.
    if (!vmOwnedByArgs(args.vmName, args.runId)) {
      throw new TestbedError(
        "TESTBED_VM_OWNERSHIP_UNPROVEN",
        `destroy: refused — '${args.vmName}' is not owned by run '${args.runId}'`,
      );
    }
    // Defense in depth: also refuse to delete a VM we did NOT
    // start in this backend instance (guards against accidental
    // cross-run teardown in long-lived test harnesses).
    if (this.activeVmName !== null && this.activeVmName !== args.vmName) {
      throw new TestbedError(
        "TESTBED_VM_OWNERSHIP_UNPROVEN",
        `destroy: refused — backend owns '${this.activeVmName}', not '${args.vmName}'`,
      );
    }
    const argv = tartDeleteArgv(args.vmName);
    const r = await proc.run({ argv, timeoutMs: 60 * 1000 });
    if (r.exitCode !== null && r.exitCode !== 0 && !r.timedOut) {
      throw mapProcFailure(r, "TART_DELETE_FAILED", `tart delete failed for ${args.vmName}`);
    }
  }
}

/**
 * Local ownership check used inside the backend as a defense in
 * depth. Mirrors the pure `vmOwnedByRun` in vm-identity.ts.
 */
function vmOwnedByArgs(vmName: string, runId: string): boolean {
  if (typeof vmName !== "string" || vmName.length === 0) return false;
  const rid = runId.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (rid.length === 0) return false;
  if (!vmName.startsWith("clinemm-testbed-")) return false;
  return vmName.split("-").includes(rid);
}
