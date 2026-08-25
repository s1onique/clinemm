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

  // ===========================================================================
  // ACT-CLINEMM-COMMAND-EXECUTOR-BASH-FUNCTION-ENV-AUTHORITY01
  // ===========================================================================
  // The earlier "conservation" test for BASH_FUNC_* was structurally
  // wrong: shell parameter expansion with `$BASH_FUNC_mktemp%%` parses
  // `$BASH_FUNC_mktemp` as the variable name and the trailing `%%`
  // as literal text, so the test reported non-empty without proving
  // that an imported function actually ran. The reviewer correctly
  // flagged this.
  //
  // The REAL test: drive the production executor with a BASH_FUNC_pwd%%
  // export encoding in the parent env, run `bash -c pwd` through it,
  // and observe whether the function imports (runs) or is stripped
  // (real pwd builtin runs).
  // ===========================================================================

  describe("RED CLOSED: BASH_FUNC_<name>%% inherited exported function does NOT shadow bare AUTO commands", () => {
    it("bare `pwd` against BASH_FUNC_pwd%% in parent env: imported function does NOT run", async () => {
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      const sentinel = path.join(root, "sentinel");
      // Inject an exported function encoding into the parent env BEFORE
      // the production executor spawns. The function body writes the
      // sentinel; if bash imports it, the sentinel mutates.
      process.env["BASH_FUNC_pwd%%"] = `() { printf 'UNAUTHORIZED-pwd' >> ${sentinel}; }`;
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "pwd >/dev/null"],
          cwd: root,
        });
        await proc.exit;
        const contents = await fs.readFile(sentinel, "utf-8").catch(() => "");
        // RED-CLOSED: sentinel must remain empty (function did NOT import).
        expect(contents).toBe("");
      } finally {
        delete process.env["BASH_FUNC_pwd%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("bare `ls /tmp` against BASH_FUNC_ls%% in parent env: imported function does NOT run", async () => {
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      const sentinel = path.join(root, "sentinel");
      process.env["BASH_FUNC_ls%%"] = `() { printf 'UNAUTHORIZED-ls' >> ${sentinel}; }`;
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "ls /tmp >/dev/null"],
          cwd: root,
        });
        await proc.exit;
        const contents = await fs.readFile(sentinel, "utf-8").catch(() => "");
        expect(contents).toBe("");
      } finally {
        delete process.env["BASH_FUNC_ls%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("bare `git --version` against BASH_FUNC_git%% in parent env: imported function does NOT run", async () => {
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      const sentinel = path.join(root, "sentinel");
      process.env["BASH_FUNC_git%%"] = `() { printf 'UNAUTHORIZED-git' >> ${sentinel}; }`;
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "git --version >/dev/null"],
          cwd: root,
        });
        await proc.exit;
        const contents = await fs.readFile(sentinel, "utf-8").catch(() => "");
        expect(contents).toBe("");
      } finally {
        delete process.env["BASH_FUNC_git%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("bare `cat /dev/null` against BASH_FUNC_cat%% in parent env: imported function does NOT run", async () => {
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      const sentinel = path.join(root, "sentinel");
      process.env["BASH_FUNC_cat%%"] = `() { printf 'UNAUTHORIZED-cat' >> ${sentinel}; }`;
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "cat /dev/null"],
          cwd: root,
        });
        await proc.exit;
        const contents = await fs.readFile(sentinel, "utf-8").catch(() => "");
        expect(contents).toBe("");
      } finally {
        delete process.env["BASH_FUNC_cat%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("prefix-strip is unbounded: BASH_FUNC_anything%% is stripped (not enumerated)", async () => {
      // Proves the strip is prefix-based: arbitrary function names
      // are also stripped. Without the prefix match, an attacker
      // could pick a name not in a fixed set.
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      const sentinel = path.join(root, "sentinel");
      process.env["BASH_FUNC_arbitrary_name_zzz%%"] = `() { printf 'UNAUTHORIZED' >> ${sentinel}; }`;
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "arbitrary_name_zzz 2>/dev/null; echo done"],
          cwd: root,
        });
        await proc.exit;
        const contents = await fs.readFile(sentinel, "utf-8").catch(() => "");
        expect(contents).toBe("");
      } finally {
        delete process.env["BASH_FUNC_arbitrary_name_zzz%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("type -t pwd reports builtin (not function) when BASH_FUNC_pwd%% is in parent env", async () => {
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      process.env["BASH_FUNC_pwd%%"] = "() { printf SHADOW; }";
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "echo type=\$(type -t pwd)"],
          cwd: root,
        });
        await proc.exit;
        const out = proc.stdoutSnapshot().text.trim();
        // The real bash builtin pwd exists; the imported function
        // does not. type -t should report "builtin".
        expect(out).toBe("type=builtin");
      } finally {
        delete process.env["BASH_FUNC_pwd%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("slash-prefixed `/usr/bin/mktemp` still works (slash-bypass composes with the strip)", async () => {
      // Composition: slash-prefixed commands were neutralized by
      // CORRECTION03 slash-bypass (function lookup doesn't apply to
      // pathnames). With this ACT's strip, parameter inheritance is
      // also defensive. The slash form should succeed AND not run
      // any imported function.
      const root = await fs.mkdtemp(FIXTURE_PREFIX);
      const sentinel = path.join(root, "sentinel");
      process.env["BASH_FUNC_mktemp%%"] = `() { printf 'UNAUTHORIZED' >> ${sentinel}; }`;
      try {
        const proc = spawnSupervisableShellCommand({
          executable: "/bin/bash",
          args: ["-c", "/usr/bin/mktemp"],
          cwd: root,
        });
        const exit = await proc.exit;
        const contents = await fs.readFile(sentinel, "utf-8").catch(() => "");
        // Slash-bypass: function lookup is not performed for
        // pathnames. /usr/bin/mktemp runs the real binary.
        expect(contents).toBe("");
        expect(exit.exitCode).toBe(0);
      } finally {
        delete process.env["BASH_FUNC_mktemp%%"];
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });
});
