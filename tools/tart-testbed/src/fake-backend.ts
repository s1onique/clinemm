/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C2, C16 (FakeTestbedBackend)
 *
 * Deterministic in-memory backend for unit/integration tests.
 * All subprocess calls go through the supplied `FakeProcessRunner`,
 * so test fixtures can script per-argv responses (including
 * failures, timeouts, and stdout/stderr payloads).
 *
 * The fake models the full state machine:
 *   idle → prepared → running → ready → destroyed
 *
 * It honors:
 *   - VM ownership (TESTBED_VM_OWNERSHIP_UNPROVEN when asked to
 *     destroy a VM it didn't prepare)
 *   - error injection per phase
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, statSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type BackendPrepareArgs,
  type BackendStartArgs,
  type CopyInRequest,
  type CopyOutRequest,
  type CopyOutResult,
  type ExecRequest,
  type ExecResult,
  type TestbedBackend,
  type BackendWaitReadyArgs,
  type BackendReadyInfo,
} from "./backend.ts";
import type { ProcessRunner } from "./process-runner.ts";
import { TestbedError } from "./types.ts";
import { vmOwnedByRun } from "./vm-identity.ts";

export interface FakeBackendHooks {
  prepareError?: () => Error;
  startError?: () => Error;
  ipWaitError?: () => Error;
  sshWaitError?: () => Error;
  execError?: () => Error;
  copyInError?: () => Error;
  copyOutError?: () => Error;
  stopError?: () => Error;
  deleteError?: () => Error;
}

export interface FakeBackendOptions {
  readonly guestIp?: string;
  /** First N `waitReady` polls return IP_TIMEOUT. Default 0. */
  readonly ipDelayPolls?: number;
  /** First N `waitReady` polls return SSH_TIMEOUT. Default 0. */
  readonly sshDelayPolls?: number;
  readonly hooks?: FakeBackendHooks;
  readonly noAutoStart?: boolean;
}

type State = "idle" | "prepared" | "running" | "ready" | "stopped" | "destroyed";

export class FakeTestbedBackend implements TestbedBackend {
  readonly backendName = "fake";
  readonly guestIpDefault: string;
  private state: State = "idle";
  private currentVmName: string | null = null;
  private currentRunId: string | null = null;
  private image: string | null = null;
  private ipPollsSoFar = 0;
  private sshPollsSoFar = 0;
  private readonly ipDelayPolls: number;
  private readonly sshDelayPolls: number;
  private readonly hooks: FakeBackendHooks;
  readonly noAutoStart: boolean;
  private readonly scratchDir: string;

  get vmName(): string | null {
    return this.currentVmName;
  }
  get runId(): string | null {
    return this.currentRunId;
  }
  get lifecycleState(): State {
    return this.state;
  }

  constructor(opts: FakeBackendOptions = {}) {
    this.guestIpDefault = opts.guestIp ?? "10.0.0.42";
    this.ipDelayPolls = opts.ipDelayPolls ?? 0;
    this.sshDelayPolls = opts.sshDelayPolls ?? 0;
    this.hooks = opts.hooks ?? {};
    this.noAutoStart = opts.noAutoStart ?? false;
    this.scratchDir = `/tmp/fake-testbed-${Math.random().toString(36).slice(2, 10)}`;
  }

  async prepare(args: BackendPrepareArgs, _proc: ProcessRunner): Promise<void> {
    if (this.hooks.prepareError) throw this.hooks.prepareError();
    if (this.state !== "idle" && this.state !== "destroyed") {
      throw new TestbedError(
        "TESTBED_PREPARE_FAILED",
        `cannot prepare while in state '${this.state}'`,
      );
    }
    this.currentVmName = args.vmName;
    this.currentRunId = args.vmName ? null : null; // not used; orchestrator passes runId through destroy args
    this.image = args.image;
    this.state = "prepared";
  }
  async start(_args: BackendStartArgs, _proc: ProcessRunner): Promise<void> {
    if (this.hooks.startError) throw this.hooks.startError();
    if (this.state !== "prepared") {
      throw new TestbedError(
        "TART_START_FAILED",
        `cannot start while in state '${this.state}' (must be 'prepared')`,
      );
    }
    this.state = "running";
  }

  async waitReady(args: BackendWaitReadyArgs, _proc: ProcessRunner): Promise<BackendReadyInfo> {
    if (this.state !== "running" && this.state !== "ready") {
      throw new TestbedError(
        "TART_START_FAILED",
        `cannot waitReady while in state '${this.state}'`,
      );
    }
    if (this.hooks.ipWaitError) throw this.hooks.ipWaitError();
    this.ipPollsSoFar++;
    if (this.ipPollsSoFar <= this.ipDelayPolls) {
      throw new TestbedError("TART_IP_TIMEOUT", "fake: simulated IP wait timeout");
    }
    if (this.hooks.sshWaitError) throw this.hooks.sshWaitError();
    this.sshPollsSoFar++;
    if (this.sshPollsSoFar <= this.sshDelayPolls) {
      throw new TestbedError("TART_SSH_TIMEOUT", "fake: simulated SSH wait timeout");
    }
    this.state = "ready";
    return { guestIp: this.guestIpDefault, phase: "READY" };
  }

  async exec(
    args: { vmName: string; guestIp: string; user: string; req: ExecRequest; identityFile?: string; knownHostsFile?: string },
    proc: ProcessRunner,
  ): Promise<ExecResult> {
    if (this.hooks.execError) throw this.hooks.execError();
    if (this.state !== "ready") {
      throw new TestbedError("TESTBED_INTERNAL_ERROR", `cannot exec while in state '${this.state}'`);
    }
    if (args.vmName !== this.currentVmName) {
      throw new TestbedError(
        "TESTBED_VM_OWNERSHIP_UNPROVEN",
        `exec: vmName '${args.vmName}' does not match owned '${this.currentVmName}'`,
      );
    }
    const r = await proc.run({
      argv: args.req.argv,
      cwd: args.req.cwd,
      env: args.req.env,
      timeoutMs: args.req.timeoutMs,
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
    if (this.hooks.copyInError) throw this.hooks.copyInError();
    if (this.state !== "ready" && this.state !== "running") {
      throw new TestbedError("TESTBED_INTERNAL_ERROR", `cannot copyIn while in state '${this.state}'`);
    }
    const r = await proc.run({
      argv: ["fake-copy-in", args.req.hostPath, args.req.guestPath],
      cwd: args.req.hostPath,
    });
    if (r.exitCode !== 0) {
      throw new TestbedError("TESTBED_COPY_IN_FAILED", `copyIn failed: ${r.stderr}`);
    }
    // Materialize a sentinel so subsequent copyOut with a deeper
    // guestPath can deterministically simulate "file present".
    // For recursive copies we walk the host path and create
    // corresponding files under scratchDir.
    const hostPath = args.req.hostPath;
    const guestPath = args.req.guestPath;
    if (args.req.recursive === true) {
      // Best-effort: walk host dir and copy structure.
      try {
        const { readdirSync } = await import("node:fs");
        const entries = readdirSync(hostPath);
        mkdirSync(`${this.scratchDir}${guestPath}`, { recursive: true });
        for (const e of entries) {
          const srcPath = `${hostPath}/${e}`;
          const dstPath = `${this.scratchDir}${guestPath}/${e}`;
          try {
            const bytes = await import("node:fs").then((m) => m.readFileSync(srcPath));
            writeFileSync(dstPath, bytes);
          } catch {
            mkdirSync(dstPath, { recursive: true });
          }
        }
      } catch {
        mkdirSync(`${this.scratchDir}${guestPath}`, { recursive: true });
      }
    } else {
      mkdirSync(dirname(`${this.scratchDir}${guestPath}`), { recursive: true });
      writeFileSync(`${this.scratchDir}${guestPath}`, `contents-of:${hostPath}`);
    }
  }

  async copyOut(
    args: { vmName: string; guestIp: string; user: string; req: CopyOutRequest; identityFile?: string; knownHostsFile?: string },
    proc: ProcessRunner,
  ): Promise<CopyOutResult> {
    if (this.hooks.copyOutError) throw this.hooks.copyOutError();
    if (this.state !== "ready") {
      throw new TestbedError("TESTBED_INTERNAL_ERROR", `cannot copyOut while in state '${this.state}'`);
    }
    const fakeGuestPath = `${this.scratchDir}${args.req.guestPath}`;
    if (!existsSync(fakeGuestPath)) {
      return { exists: false, byteSize: 0, sha256: "" };
    }
    const r = await proc.run({
      argv: ["fake-copy-out", args.req.guestPath, args.req.hostDestination],
    });
    if (r.exitCode !== 0) {
      throw new TestbedError("TESTBED_COPY_OUT_FAILED", `copyOut failed: ${r.stderr}`);
    }
    mkdirSync(dirname(args.req.hostDestination), { recursive: true });
    const bytes = readFileSync(fakeGuestPath);
    writeFileSync(args.req.hostDestination, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const st = statSync(args.req.hostDestination);
    return { exists: true, byteSize: st.size, sha256 };
  }

  async stop(args: { vmName: string }, proc: ProcessRunner): Promise<void> {
    if (this.hooks.stopError) throw this.hooks.stopError();
    if (this.state === "destroyed") return;
    if (this.state === "idle") return;
    const r = await proc.run({
      argv: ["fake-stop", args.vmName],
    });
    if (r.exitCode !== 0) {
      throw new TestbedError("TART_STOP_FAILED", `stop failed: ${r.stderr}`);
    }
    this.state = "stopped";
  }

  async destroy(args: { vmName: string; runId: string }, proc: ProcessRunner): Promise<void> {
    if (this.hooks.deleteError) throw this.hooks.deleteError();
    if (!vmOwnedByRun(args.vmName, args.runId)) {
      throw new TestbedError(
        "TESTBED_VM_OWNERSHIP_UNPROVEN",
        `destroy: refused — '${args.vmName}' is not owned by run '${args.runId}'`,
      );
    }
    if (this.currentVmName !== null && this.currentVmName !== args.vmName) {
      throw new TestbedError(
        "TESTBED_VM_OWNERSHIP_UNPROVEN",
        `destroy: refused — owned '${this.currentVmName}' != '${args.vmName}'`,
      );
    }
    const r = await proc.run({
      argv: ["fake-delete", args.vmName],
    });
    if (r.exitCode !== 0) {
      throw new TestbedError("TART_DELETE_FAILED", `delete failed: ${r.stderr}`);
    }
    this.state = "destroyed";
  }

  _setOwnershipForTest(vmName: string, runId: string): void {
    this.currentVmName = vmName;
    this.currentRunId = runId;
  }
}
