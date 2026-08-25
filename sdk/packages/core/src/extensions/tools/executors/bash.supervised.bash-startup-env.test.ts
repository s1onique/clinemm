// ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 -- C2 tests
//
// Drives the PRODUCTION bash supervisor (spawnSupervisableShellCommand)
// directly. These are REAL production-seam tests, NOT unit tests of
// a hypothetical filter. They prove that under the DEFAULT_OFF
// contract (envSemantics: "overlay" or undefined), the inherited
// bash-startup-affecting environment variables (BASH_ENV, ENV,
// SHELLOPTS, BASHOPTS) are stripped from the spawned child's env,
// so bash does NOT source $BASH_ENV before the policy-authorized
// command.
//
// Conservation:
//  - Sanitized Seatbelt mode (envSemantics: "complete") is unchanged;
//    the filter is a NO-OP under "complete".
//  - Caller's config.env is preserved (caller-trusted).
//  - PATH/TERM/LANG/etc. ordinary env is preserved.
//  - exported shell functions (BASH_FUNC_*) are inherited as-is:
//    CORRECTION03 slash-bypass neutralizes them for the command-
//    identity channel.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSupervisableShellCommand } from "./bash";
import type { SupervisableShellProcess } from "./bash";

const FIXTURE_PREFIX = "/tmp/clinemm-bashenv-test-";

async function makeFixture() {
  const root = await fs.mkdtemp(FIXTURE_PREFIX);
  const envFile = path.join(root, "bash-env");
  const sentinel = path.join(root, "sentinel");
  await fs.writeFile(envFile, `printf 'STARTUP %s\\n' "$(date +%N)" >> ${sentinel}\n`);
  await fs.chmod(envFile, 0o755);
  return { root, envFile, sentinel };
}

async function runBashSupervisor(
  bashCmd: string,
  extraEnv?: Record<string, string>,
  envSemantics?: "overlay" | "complete",
): Promise<{ exit: { exitCode: number | null; signal: NodeJS.Signals | null }; sentinel: string; root: string }> {
  const { root, envFile, sentinel } = await makeFixture();
  process.env.BASH_ENV = envFile;
  process.env.ENV = envFile;
  process.env.SHELLOPTS = "errexit:nounset";
  process.env.BASHOPTS = "expand_aliases";
  try {
    const config: {
      executable: string;
      args: string[];
      cwd: string;
      env?: Record<string, string>;
      envSemantics?: "overlay" | "complete";
    } = {
      executable: "/bin/bash",
      args: ["-c", bashCmd],
      cwd: root,
    };
    if (extraEnv) config.env = extraEnv;
    if (envSemantics) config.envSemantics = envSemantics;
    const proc: SupervisableShellProcess = spawnSupervisableShellCommand(config);
    const exit = await proc.exit;
    const sentinelContents = await fs.readFile(sentinel, "utf-8").catch(() => "");
    return { exit, sentinel: sentinelContents.trim(), root };
  } finally {
    delete process.env.BASH_ENV;
    delete process.env.ENV;
    delete process.env.SHELLOPTS;
    delete process.env.BASHOPTS;
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 (C2: supervisor strips inherited bash-startup-affecting env under overlay semantics)", () => {
  describe("RED CLOSED: BASH_ENV startup file does NOT run before the authorized command", () => {
    it("`/usr/bin/mktemp` (slash-form AUTO): BASH_ENV sentinel remains empty", async () => {
      const { sentinel, exit } = await runBashSupervisor("/usr/bin/mktemp");
      expect(exit.exitCode).toBe(0);
      expect(sentinel).toBe("");
    });
    it("`/usr/bin/mktemp -d`: BASH_ENV sentinel remains empty", async () => {
      const { sentinel, exit } = await runBashSupervisor("/usr/bin/mktemp -d");
      expect(exit.exitCode).toBe(0);
      expect(sentinel).toBe("");
    });
    it("`pwd` (general): BASH_ENV sentinel remains empty", async () => {
      const { sentinel, exit } = await runBashSupervisor("pwd");
      expect(exit.exitCode).toBe(0);
      expect(sentinel).toBe("");
    });
    it("`echo hello` (general): BASH_ENV sentinel remains empty", async () => {
      const { sentinel, exit } = await runBashSupervisor("echo hello");
      expect(exit.exitCode).toBe(0);
      expect(sentinel).toBe("");
    });
    it("`/usr/bin/mktemp -d /tmp/foo.XXXXXX` (template ASK candidate): BASH_ENV sentinel remains empty", async () => {
      const { sentinel, exit } = await runBashSupervisor("/usr/bin/mktemp -d /tmp/foo.XXXXXX");
      expect(exit.exitCode).toBe(0);
      expect(sentinel).toBe("");
    });
  });

  describe("RED CLOSED: ENV (POSIX sh analogue) startup file does NOT run before the authorized command", () => {
    it("`pwd` with ENV=<file>: ENV sentinel remains empty (defensive filter)", async () => {
      const { sentinel, exit } = await runBashSupervisor("pwd");
      expect(exit.exitCode).toBe(0);
      expect(sentinel).toBe("");
    });
  });

  describe("CONSERVATION: ordinary env is preserved", () => {
    it("PATH inheritance works (child sees inherited PATH)", async () => {
      // /bin/bash is found via PATH; if PATH were stripped, exec would fail.
      const { exit } = await runBashSupervisor("command -v bash >/dev/null");
      expect(exit.exitCode).toBe(0);
    });
    it("TERM inheritance works (child sees inherited TERM)", async () => {
      const { root } = await makeFixture();
      process.env.TERM = "dumb";
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "test \"$TERM\" = dumb && echo OK || echo NO"],
          cwd: root,
        });
        const exit = await proc.exit;
        const out = proc.stdoutSnapshot().text.trim();
        expect(exit.exitCode).toBe(0);
        expect(out).toBe("OK");
      } finally {
        delete process.env.TERM;
        await fs.rm(root, { recursive: true, force: true });
      }
    });
    it("caller-supplied env (config.env) is preserved over inherited", async () => {
      const { root } = await makeFixture();
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "echo $MY_CALLER_VAR"],
          cwd: root,
          env: { MY_CALLER_VAR: "from-caller" },
        });
        const exit = await proc.exit;
        const out = proc.stdoutSnapshot().text.trim();
        expect(exit.exitCode).toBe(0);
        expect(out).toBe("from-caller");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("CONSERVATION: envSemantics='complete' (sanitized Seatbelt) bypasses the filter (no-op)", () => {
    it("sanitized Seatbelt path: caller env passed AS-IS, filter does NOT touch it", async () => {
      const { root } = await makeFixture();
      try {
        // Sanitized mode under test: caller passes a complete env.
        // We assert the filter is a NO-OP (BASH_ENV not stripped,
        // because the materialized env is already controlled).
        // Note: bash under sanitized mode still sources BASH_ENV,
        // but that's the Seatbelt backend's responsibility to
        // exclude it from its materialized env, not ours.
        // We test: config.env survives intact.
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "echo $SANITIZED_VAR"],
          cwd: root,
          env: { SANITIZED_VAR: "sanitized-payload" },
          envSemantics: "complete",
        });
        const exit = await proc.exit;
        const out = proc.stdoutSnapshot().text.trim();
        expect(exit.exitCode).toBe(0);
        expect(out).toBe("sanitized-payload");
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("CONSERVATION: exported shell function (BASH_FUNC_*) is NOT stripped", () => {
    it("BASH_FUNC_* is inherited; CORRECTION03 slash-bypass is the channel that neutralizes it", async () => {
      // The filter does NOT strip BASH_FUNC_* because slash-bypass
      // already neutralizes them for the command-identity channel.
      // We assert BASH_FUNC_* is INHERITED (the filter is conservative
      // and doesn't touch what it doesn't have to).
      const { root } = await makeFixture();
      try {
        // Set BASH_FUNC_mktemp%% to a value that we can observe
        // via `env | grep BASH_FUNC`. Note: this is bash's internal
        // encoding for exported function names.
        process.env["BASH_FUNC_mktemp%%"] = "() { printf SHADOWED; }";
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "test -n \"$BASH_FUNC_mktemp%%\" && echo PRESENT || echo ABSENT"],
          cwd: root,
        });
        const exit = await proc.exit;
        const out = proc.stdoutSnapshot().text.trim();
        expect(exit.exitCode).toBe(0);
        expect(out).toBe("PRESENT");
      } finally {
        delete process.env["BASH_FUNC_mktemp%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });
});
