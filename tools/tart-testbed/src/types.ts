/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01
 *
 * Testbed contract — intent, not Tart CLI syntax.
 *
 * Per the ACT spec (C1, C8, C10, C11, C13):
 *   - TestbedSpec: declarative VM + commands + artifacts
 *   - TestbedResult: structured machine-readable evidence
 *   - RemoteCommandResult: per-command structured outcome
 *   - ArtifactRecord: per-artifact structured outcome
 *
 * No ClineMM/myc-specific semantics belong in this layer. Scenarios
 * (VSIX install, MCP lifecycle, Elm diagnostics) compose on top.
 */

// =============================================================================
// Spec
// =============================================================================

export interface TestbedSpec {
  /** Stable image reference — registry/path@sha256:<64-hex-digest> (no tag drift). */
  readonly image: string;
  /** Optional semantic VM name prefix; the harness appends a per-run id. */
  readonly vmNamePrefix?: string;
  /** Optional: pin the run id (e.g. ACT id). Otherwise random hex. */
  readonly runId?: string;
  readonly cpu?: number;
  readonly memoryMiB?: number;
  readonly diskGiB?: number;
  /** Optional: ssh user (default "admin" matches upstream macOS base images). */
  readonly sshUser?: string;
  /** Optional: absolute path to the SSH identity file. */
  readonly sshIdentityFile?: string;
  /** Optional: contents of an ephemeral UserKnownHostsFile (server-identity pin). */
  readonly knownHostsContents?: string;
  /**
   * Optional: declare a workspace to push into the guest before commands run.
   * The host path must exist and be a directory.
   */
  readonly workspaceMount?: {
    readonly hostPath: string;
    readonly guestPath: string;
  };
  /** Ordered list of commands to execute in the guest. */
  readonly commands: readonly TestbedCommand[];
  /** Declared artifacts to copy out of the guest after commands. */
  readonly artifacts: readonly TestbedArtifact[];
  /** Per-phase budget in milliseconds. Defaults applied in the orchestrator. */
  readonly timeouts?: TestbedTimeouts;
  /** Default: false. When true, skip stop/delete intentionally. */
  readonly keepVm?: boolean;
  /**
   * Free-form metadata recorded in the result. MUST NOT contain
   * secrets / private keys / full env / conversation contents.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface TestbedCommand {
  /** argv to execute. Each element is one shell-safe token. NO shell interpolation. */
  readonly argv: readonly string[];
  /** Optional: working directory inside the guest. */
  readonly cwd?: string;
  /** Optional: extra env vars overlaid onto the guest's shell environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Optional: per-command timeout in ms; defaults to commands.timeout. */
  readonly timeoutMs?: number;
  /** Optional: human-readable label recorded in the result. */
  readonly label?: string;
  /**
   * If true, the orchestrator aborts the whole run when this command's
   * exit code is non-zero. Default: false (scenarios decide).
   */
  readonly failOnNonZero?: boolean;
}

export interface TestbedArtifact {
  readonly guestPath: string;
  readonly hostDestination: string;
  readonly required: boolean;
}

export interface TestbedTimeouts {
  readonly cloneMs?: number;
  readonly startMs?: number;
  readonly ipReadyMs?: number;
  readonly sshReadyMs?: number;
  readonly commandMs?: number;
}

export const DEFAULT_TIMEOUTS: Required<TestbedTimeouts> = {
  cloneMs: 20 * 60 * 1000,
  startMs: 10 * 60 * 1000,
  ipReadyMs: 2 * 60 * 1000,
  sshReadyMs: 2 * 60 * 1000,
  commandMs: 5 * 60 * 1000,
};
// =============================================================================
// Result
// =============================================================================

export interface TestbedResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly backend: "tart" | "fake" | string;
  readonly image: string;
  readonly vmName: string;
  readonly hostPlatform: HostClassification;
  readonly startedAt: string; // ISO8601 UTC
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly steps: readonly StepRecord[];
  readonly commands: readonly CommandRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly teardown: TeardownRecord;
  readonly overallStatus: OverallStatus;
  readonly failureReason?: string;
  readonly failureCode?: TestbedErrorCode;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type OverallStatus =
  | "PASS"
  | "PREPARE_FAILED"
  | "START_FAILED"
  | "IP_TIMEOUT"
  | "SSH_TIMEOUT"
  | "COMMAND_FAILED"
  | "ARTIFACT_MISSING"
  | "UNSUPPORTED_HOST"
  | "EXCEPTION"
  | "KEEP_VM";

export interface StepRecord {
  readonly name: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly status: "pass" | "fail" | "skipped";
  readonly detail?: string;
}

export interface CommandRecord {
  readonly index: number;
  readonly label?: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly status: "pass" | "fail" | "timeout" | "skipped";
}

export interface ArtifactRecord {
  readonly guestPath: string;
  readonly hostDestination: string;
  readonly required: boolean;
  readonly exists: boolean;
  readonly byteSize: number | null;
  readonly sha256: string | null;
  readonly status: "collected" | "missing" | "copy_failed";
  readonly error?: string;
}

export interface TeardownRecord {
  readonly status: "pass" | "fail" | "skipped";
  readonly stopStatus: "pass" | "fail" | "skipped" | "not_attempted";
  readonly deleteStatus: "pass" | "fail" | "skipped" | "not_attempted";
  readonly kept: boolean;
  readonly error?: string;
}

// =============================================================================
// Error codes — closed enumeration
// =============================================================================

export type TestbedErrorCode =
  | "TESTBED_UNAVAILABLE"
  | "TESTBED_UNSUPPORTED_HOST"
  | "TESTBED_VM_OWNERSHIP_UNPROVEN"
  | "TESTBED_UNSAFE_SHELL_BOUNDARY"
  | "TESTBED_TEARDOWN_NOT_GUARANTEED"
  | "TESTBED_RESULT_NOT_REPRODUCIBLE"
  | "TART_START_FAILED"
  | "TART_IP_TIMEOUT"
  | "TART_SSH_TIMEOUT"
  | "TART_CLONE_FAILED"
  | "TART_DELETE_FAILED"
  | "TART_STOP_FAILED"
  | "TESTBED_PREPARE_FAILED"
  | "TESTBED_REQUIRED_ARTIFACT_MISSING"
  | "TESTBED_COPY_IN_FAILED"
  | "TESTBED_COPY_OUT_FAILED"
  | "TESTBED_INTERNAL_ERROR";

export class TestbedError extends Error {
  readonly code: TestbedErrorCode;
  readonly detail?: string;
  constructor(code: TestbedErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "TestbedError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// =============================================================================
// Host classification (C15)
// =============================================================================

export type HostClass = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "other";

export interface HostClassification {
  readonly os: NodeJS.Platform;
  readonly arch: string;
  readonly class: HostClass;
  readonly tartAvailable: boolean;
  readonly sshAvailable: boolean;
  readonly supported: boolean;
  /** Present iff !supported. */
  readonly reason?: string;
}
