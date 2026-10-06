/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — C2 (Backend abstraction)
 *
 * The narrow seam between the orchestrator and any concrete VM
 * runtime. Only two implementations exist today:
 *   - TartBackend (real)
 *   - FakeTestbedBackend (deterministic, no VM)
 *
 * Future implementations (Lima, Qemu, ...) would add to this
 * interface but the substrate ACT explicitly forbids that.
 */

import type { ProcessRunner } from "./process-runner.ts";
import type { TestbedErrorCode } from "./types.ts";

/** A file to copy into the guest, by host path. */
export interface CopyInRequest {
  readonly hostPath: string;
  readonly guestPath: string;
  readonly recursive?: boolean;
}

/** A file/dir to copy out of the guest, by host destination. */
export interface CopyOutRequest {
  readonly guestPath: string;
  readonly hostDestination: string;
  readonly recursive?: boolean;
}

/** Result of copying a single artifact out. */
export interface CopyOutResult {
  readonly exists: boolean;
  readonly byteSize: number;
  readonly sha256: string;
}

/** A single remote command. */
export interface ExecRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface ExecResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface BackendPrepareArgs {
  readonly image: string;
  readonly vmName: string;
  readonly cpu?: number;
  readonly memoryMiB?: number;
  readonly diskGiB?: number;
}

export interface BackendStartArgs {
  readonly vmName: string;
}

export interface BackendWaitReadyArgs {
  readonly vmName: string;
  readonly ipTimeoutMs: number;
  readonly sshTimeoutMs: number;
  readonly user: string;
  readonly identityFile?: string;
  /** Ephemeral UserKnownHostsFile path (server-identity pin). */
  readonly knownHostsFile?: string;
}

export interface BackendReadyInfo {
  readonly guestIp: string;
  readonly phase: "IP_AVAILABLE" | "SSH_AVAILABLE" | "READY";
}

export interface TestbedBackend {
  /** Name used for evidence. */
  readonly backendName: string;

  /** (C3) Acquire the VM definition. Returns when ready for `start`. */
  prepare(args: BackendPrepareArgs, proc: ProcessRunner): Promise<void>;

  /** (C6) Start the VM asynchronously. Must NOT block forever. */
  start(args: BackendStartArgs, proc: ProcessRunner): Promise<void>;

  /** (C7) Wait for IP_AVAILABLE → SSH_AVAILABLE → READY. */
  waitReady(args: BackendWaitReadyArgs, proc: ProcessRunner): Promise<BackendReadyInfo>;

  /** (C8) Execute one remote command. Non-zero does NOT auto-abort. */
  exec(args: { vmName: string; guestIp: string; user: string; req: ExecRequest; identityFile?: string; knownHostsFile?: string }, proc: ProcessRunner): Promise<ExecResult>;

  /** (C9) Copy a directory or file INTO the guest. */
  copyIn(args: { vmName: string; guestIp: string; user: string; req: CopyInRequest; identityFile?: string; knownHostsFile?: string }, proc: ProcessRunner): Promise<void>;

  /** (C10) Copy a file/directory OUT of the guest to a host path. */
  copyOut(args: { vmName: string; guestIp: string; user: string; req: CopyOutRequest; identityFile?: string; knownHostsFile?: string }, proc: ProcessRunner): Promise<CopyOutResult>;

  /** (C11) Best-effort stop. Errors are caught and reported in teardown. */
  stop(args: { vmName: string }, proc: ProcessRunner): Promise<void>;

  /** (C11) Best-effort delete. Errors are caught and reported in teardown.
   *  Implementations MUST refuse to delete a VM they don't own. */
  destroy(args: { vmName: string; runId: string }, proc: ProcessRunner): Promise<void>;
}

/** Utility: classify a backend error into a code, if applicable. */
export function classifyBackendError(err: unknown): TestbedErrorCode | null {
  if (err instanceof Error) {
    const m = err.message;
    if (/spawn.*tart.*failed|tart: command not found/.test(m)) return "TESTBED_UNAVAILABLE";
    if (/TART_START_FAILED|TART_START|TART_START_FAILED_START_FAILED/.test(m)) return "TART_START_FAILED";
    if (/TART_IP_TIMEOUT/.test(m)) return "TART_IP_TIMEOUT";
    if (/TART_SSH_TIMEOUT/.test(m)) return "TART_SSH_TIMEOUT";
    if (/TART_CLONE_FAILED/.test(m)) return "TART_CLONE_FAILED";
    if (/TART_DELETE_FAILED/.test(m)) return "TART_DELETE_FAILED";
    if (/TART_STOP_FAILED/.test(m)) return "TART_STOP_FAILED";
    if (/TESTBED_VM_OWNERSHIP_UNPROVEN/.test(m)) return "TESTBED_VM_OWNERSHIP_UNPROVEN";
    if (/TESTBED_REQUIRED_ARTIFACT_MISSING/.test(m)) return "TESTBED_REQUIRED_ARTIFACT_MISSING";
    if (/TESTBED_COPY_IN_FAILED/.test(m)) return "TESTBED_COPY_IN_FAILED";
    if (/TESTBED_COPY_OUT_FAILED/.test(m)) return "TESTBED_COPY_OUT_FAILED";
    if (/TESTBED_PREPARE_FAILED/.test(m)) return "TESTBED_PREPARE_FAILED";
  }
  return null;
}