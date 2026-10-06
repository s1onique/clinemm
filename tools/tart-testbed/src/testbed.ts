/**
 * ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — orchestrator
 *
 * Wires Backend + ProcessRunner + Identity + Spec -> Result.
 *
 * Teardown errors are recorded but do NOT overwrite the primary
 * failure (C11).
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestbedBackend } from "./backend.ts";
import {
  type CommandRecord,
  type OverallStatus,
  type StepRecord,
  type TestbedResult,
  type ArtifactRecord,
  type TeardownRecord,
  type TestbedSpec,
  DEFAULT_TIMEOUTS,
  type TestbedErrorCode,
} from "./types.ts";
import type { ProcessRunner } from "./process-runner.ts";
import { newRunId, vmNameFor } from "./vm-identity.ts";
import { validateImageRef } from "./tart-cli.ts";

export interface OrchestratorOptions {
  readonly backend: TestbedBackend;
  readonly processRunner: ProcessRunner;
  readonly outputDir?: string;
  readonly random?: () => number;
  readonly now?: () => Date;
  readonly host: import("./types.ts").HostClassification;
}

interface RunState {
  spec: TestbedSpec;
  runId: string;
  vmName: string;
  startedAt: Date;
  steps: StepRecord[];
  commands: CommandRecord[];
  artifacts: ArtifactRecord[];
  // Mutable mirrors of the result-shaped types so the orchestrator
  // can populate fields as the run progresses; converted to
  // readonly at finalize().
  teardown: {
    status: "pass" | "fail" | "skipped";
    stopStatus: "pass" | "fail" | "skipped" | "not_attempted";
    deleteStatus: "pass" | "fail" | "skipped" | "not_attempted";
    kept: boolean;
    error?: string;
  };
  overallStatus: OverallStatus;
  failureReason?: string;
  failureCode?: TestbedErrorCode;
  guestIp: string | null;
  knownHostsFile: string | null;
  artifactDir: string;
}

export class TestbedOrchestrator {
  private readonly opts: OrchestratorOptions;
  constructor(opts: OrchestratorOptions) { this.opts = opts; }

  async run(spec: TestbedSpec): Promise<TestbedResult> {
    const now = this.opts.now ?? ((): Date => new Date());
    const runId = spec.runId ?? newRunId(this.opts.random ?? Math.random);
    const vmName = vmNameFor({
      runId,
      vmNamePrefix: spec.vmNamePrefix,
      random: this.opts.random ?? Math.random,
    });
    const artifactDir = this.opts.outputDir ?? join(".factory", "testbed-runs", runId);
    const state: RunState = {
      spec, runId, vmName,
      startedAt: now(),
      steps: [], commands: [], artifacts: [],
      teardown: { status: "skipped", stopStatus: "not_attempted", deleteStatus: "not_attempted", kept: false },
      overallStatus: "PASS",
      guestIp: null, knownHostsFile: null, artifactDir,
    };
    try {
      const iv = validateImageRef(spec.image);
      if (!iv.ok) return await this.fail(state, "TESTBED_PREPARE_FAILED", iv.error, "PREPARE_FAILED", now);

      if (spec.knownHostsContents !== undefined && spec.knownHostsContents.length > 0) {
        try {
          mkdirSync(artifactDir, { recursive: true });
          const kh = join(artifactDir, "known_hosts");
          writeFileSync(kh, spec.knownHostsContents, { mode: 0o600 });
          state.knownHostsFile = kh;
        } catch (e) {
          return await this.fail(state, "TESTBED_PREPARE_FAILED", `known_hosts write failed: ${(e as Error).message}`, "PREPARE_FAILED", now);
        }
      }

      try {
        await this.recordStep(state, "prepare", () => this.opts.backend.prepare(
          { image: spec.image, vmName, cpu: spec.cpu, memoryMiB: spec.memoryMiB, diskGiB: spec.diskGiB },
          this.opts.processRunner));
      } catch (e) {
        return await this.fail(state, "TESTBED_PREPARE_FAILED", (e as Error).message, "PREPARE_FAILED", now);
      }
      try {
        await this.recordStep(state, "start", () => this.opts.backend.start({ vmName }, this.opts.processRunner));
      } catch (e) {
        const msg = (e as Error).message;
        const code = (e as { code?: string }).code ?? "";
        const probe = `${code} ${msg}`;
        if (/TART_START_FAILED/.test(probe)) return await this.fail(state, "TART_START_FAILED", msg, "START_FAILED", now);
        return await this.fail(state, "TESTBED_INTERNAL_ERROR", msg, "EXCEPTION", now);
      }

      const t = { ...DEFAULT_TIMEOUTS, ...(spec.timeouts ?? {}) };
      let ready: { guestIp: string; phase: string };
      try {
        const r = await this.recordStep(state, "waitReady", () => this.opts.backend.waitReady({
          vmName, ipTimeoutMs: t.ipReadyMs, sshTimeoutMs: t.sshReadyMs,
          user: spec.sshUser ?? "admin", identityFile: spec.sshIdentityFile,
          knownHostsFile: state.knownHostsFile ?? undefined,
        }, this.opts.processRunner)) as { guestIp: string; phase: string };
        ready = r;
      } catch (e) {
        const msg = (e as Error).message;
        const code = (e as { code?: string }).code ?? "";
        const probe = `${code} ${msg}`;
        if (/TART_IP_TIMEOUT/.test(probe)) return await this.fail(state, "TART_IP_TIMEOUT", msg, "IP_TIMEOUT", now);
        if (/TART_SSH_TIMEOUT/.test(probe)) return await this.fail(state, "TART_SSH_TIMEOUT", msg, "SSH_TIMEOUT", now);
        if (/TART_START_FAILED/.test(probe)) return await this.fail(state, "TART_START_FAILED", msg, "START_FAILED", now);
        return await this.fail(state, "TESTBED_INTERNAL_ERROR", msg, "EXCEPTION", now);
      }
      state.guestIp = ready.guestIp;

      if (spec.workspaceMount !== undefined) {
        try {
          await this.recordStep(state, "copyIn", () => this.opts.backend.copyIn({
            vmName, guestIp: ready.guestIp, user: spec.sshUser ?? "admin",
            req: { hostPath: spec.workspaceMount!.hostPath, guestPath: spec.workspaceMount!.guestPath, recursive: true },
            identityFile: spec.sshIdentityFile,
            knownHostsFile: state.knownHostsFile ?? undefined,
          }, this.opts.processRunner));
        } catch (e) {
          return await this.fail(state, "TESTBED_COPY_IN_FAILED", (e as Error).message, "EXCEPTION", now);
        }
      }

      let aborted = false;
      for (let i = 0; i < spec.commands.length; i++) {
        if (aborted) break;
        const cmd = spec.commands[i];
        if (cmd === undefined) continue;
        const cmdStarted = now();
        const r = await this.opts.backend.exec({
          vmName, guestIp: ready.guestIp, user: spec.sshUser ?? "admin",
          req: { argv: cmd.argv, cwd: cmd.cwd, env: cmd.env, timeoutMs: cmd.timeoutMs },
          identityFile: spec.sshIdentityFile,
          knownHostsFile: state.knownHostsFile ?? undefined,
        }, this.opts.processRunner);
        const cmdFinished = now();
        const baseRec: CommandRecord = {
          index: i, argv: cmd.argv,
          startedAt: cmdStarted.toISOString(),
          finishedAt: cmdFinished.toISOString(),
          durationMs: cmdFinished.getTime() - cmdStarted.getTime(),
          exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut,
          status: r.timedOut ? "timeout" : r.exitCode === 0 ? "pass" : "fail",
        };
        const rec = cmd.label !== undefined ? { ...baseRec, label: cmd.label } : baseRec;
        state.commands.push(rec);
        if (cmd.failOnNonZero === true && r.exitCode !== 0) {
          state.overallStatus = "COMMAND_FAILED";
          state.failureReason = `command ${i} (${cmd.label ?? "command"}) exited ${r.exitCode}`;
          state.failureCode = "TESTBED_INTERNAL_ERROR";
          aborted = true;
        }
      }

      for (let i = 0; i < spec.artifacts.length; i++) {
        const a = spec.artifacts[i];
        if (a === undefined) continue;
        const dest = a.hostDestination;
        let rec: ArtifactRecord;
        try {
          const r = await this.opts.backend.copyOut({
            vmName, guestIp: ready.guestIp, user: spec.sshUser ?? "admin",
            req: { guestPath: a.guestPath, hostDestination: dest, recursive: false },
            identityFile: spec.sshIdentityFile,
            knownHostsFile: state.knownHostsFile ?? undefined,
          }, this.opts.processRunner);
          if (!r.exists) {
            rec = { guestPath: a.guestPath, hostDestination: dest, required: a.required,
              exists: false, byteSize: null, sha256: null, status: "missing" };
          } else {
            let size = 0, sha = "";
            try {
              const bytes = readFileSync(dest);
              size = bytes.length;
              sha = createHash("sha256").update(bytes).digest("hex");
            } catch (e) {
              rec = { guestPath: a.guestPath, hostDestination: dest, required: a.required,
                exists: true, byteSize: r.byteSize, sha256: r.sha256,
                status: "copy_failed", error: (e as Error).message };
              state.artifacts.push(rec);
              continue;
            }
            rec = { guestPath: a.guestPath, hostDestination: dest, required: a.required,
              exists: true, byteSize: size, sha256: sha, status: "collected" };
          }
        } catch (e) {
          rec = { guestPath: a.guestPath, hostDestination: dest, required: a.required,
            exists: false, byteSize: null, sha256: null, status: "copy_failed",
            error: (e as Error).message };
        }
        state.artifacts.push(rec);
        if (rec.required && rec.status !== "collected") {
          state.overallStatus = "ARTIFACT_MISSING";
          state.failureReason = `required artifact missing: ${a.guestPath}`;
          state.failureCode = "TESTBED_REQUIRED_ARTIFACT_MISSING";
        }
      }

      return await this.finalize(state, now);
    } catch (e) {
      return await this.fail(state, "TESTBED_INTERNAL_ERROR", (e as Error).message, "EXCEPTION", now);
    }
  }

  private async recordStep(state: RunState, name: string, fn: () => Promise<unknown>): Promise<unknown> {
    const now = this.opts.now ?? ((): Date => new Date());
    const startedAt = now();
    let status: "pass" | "fail" = "pass";
    let detail: string | undefined;
    try {
      const r = await fn();
      state.steps.push({
        name,
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        durationMs: now().getTime() - startedAt.getTime(),
        status: "pass",
      });
      return r;
    } catch (e) {
      status = "fail";
      detail = (e as Error).message;
      state.steps.push({
        name,
        startedAt: startedAt.toISOString(),
        finishedAt: now().toISOString(),
        durationMs: now().getTime() - startedAt.getTime(),
        status: "fail",
        detail,
      });
      throw e;
    }
  }

  private async finalize(state: RunState, now: () => Date): Promise<TestbedResult> {
    await this.runTeardown(state);
    const finishedAt = now();
    const teardownOut: TeardownRecord = {
      status: state.teardown.status,
      stopStatus: state.teardown.stopStatus,
      deleteStatus: state.teardown.deleteStatus,
      kept: state.teardown.kept,
      ...(state.teardown.error !== undefined ? { error: state.teardown.error } : {}),
    };
    const baseFields = {
      schemaVersion: 1 as const,
      runId: state.runId,
      backend: this.opts.backend.backendName,
      image: state.spec.image,
      vmName: state.vmName,
      hostPlatform: this.opts.host,
      startedAt: state.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - state.startedAt.getTime(),
      steps: state.steps,
      commands: state.commands,
      artifacts: state.artifacts,
      teardown: teardownOut,
      overallStatus: state.teardown.kept ? "KEEP_VM" : state.overallStatus,
      metadata: state.spec.metadata,
    };
    const result: TestbedResult =
      state.failureReason !== undefined && state.failureCode !== undefined
        ? { ...baseFields, failureReason: state.failureReason, failureCode: state.failureCode }
        : state.failureReason !== undefined
          ? { ...baseFields, failureReason: state.failureReason }
          : state.failureCode !== undefined
            ? { ...baseFields, failureCode: state.failureCode }
            : baseFields;
    try {
      mkdirSync(state.artifactDir, { recursive: true });
      writeFileSync(join(state.artifactDir, "result.json"), JSON.stringify(result, null, 2));
    } catch {
      // Result emission is best-effort; the in-memory result is
      // the authoritative evidence.
    }
    return result;
  }

  private async runTeardown(state: RunState): Promise<void> {
    const keep = state.spec.keepVm === true;
    if (keep) {
      state.teardown.kept = true;
      state.teardown.stopStatus = "skipped";
      state.teardown.deleteStatus = "skipped";
      state.teardown.status = "skipped";
      return;
    }
    // stop
    try {
      await this.opts.backend.stop({ vmName: state.vmName }, this.opts.processRunner);
      state.teardown.stopStatus = "pass";
    } catch (e) {
      state.teardown.stopStatus = "fail";
      state.teardown.error = (e as Error).message;
    }
    // delete (with ownership check)
    try {
      await this.opts.backend.destroy(
        { vmName: state.vmName, runId: state.runId },
        this.opts.processRunner,
      );
      state.teardown.deleteStatus = "pass";
    } catch (e) {
      state.teardown.deleteStatus = "fail";
      if (state.teardown.error === undefined) state.teardown.error = (e as Error).message;
    }
    state.teardown.status =
      state.teardown.stopStatus === "pass" && state.teardown.deleteStatus === "pass"
        ? "pass"
        : "fail";
  }

  private fail(state: RunState, code: TestbedErrorCode, reason: string, status: OverallStatus, now: () => Date): Promise<TestbedResult> {
    state.failureCode = code;
    state.failureReason = reason;
    state.overallStatus = status;
    return this.finalize(state, now);
  }
}
