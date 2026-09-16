// ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01
// RED reproduction (Phase A).
//
// Mirrors the exact spawn primitive used by ClineMM's bash executor at
// sdk/packages/core/src/extensions/tools/executors/bash.ts:917:
//
//   const child = spawn(config.executable, config.args, {
//     cwd: config.cwd,
//     env: childEnv,
//     stdio: ["pipe", "pipe", "pipe"],
//     detached: !isWindows,
//     windowsHide: true,
//   });
//
// Node's spawn(...) with `detached: true` is the SAME kernel call the
// ClineMM production code uses on darwin; child.pid is the new process
// group leader. -childPid is the PGID the bash supervisor signals.
//
// We then attempt to terminate the OWNED PROCESS GROUP via the same
// pattern the ClineMM supervisor uses (bash.ts:1029):
//
//   process.kill(-childPid, signal)
//
// from THREE substrates in turn:
//   1. The SPAWNING bun process itself (unsandboxed parent).
//   2. A child of `sandbox-exec` (simulating VSCodium extension host).
//   3. The host helper process (unsandboxed, LaunchAgent-managed).
//
// If the same PGID is reachable from (1) and (3) but blocked at (2),
// the helper-fallback pattern is justified.

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = (line) => process.stdout.write(line + "\n");
const err = (line) => process.stderr.write(line + "\n");

// 1. Spawn a long-lived detached shell child. Same kernel call as
//    ClineMM production. The child runs `sleep 120` and forks a
//    grandchild that prints to stdout forever.
out("[1/4] spawning detached shell child (real ClineMM production primitive)");
const shellChild = spawn("/bin/sh", ["-c", "sleep 120 & exec sleep 120"], {
  cwd: "/tmp",
  env: { PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin" },
  stdio: ["ignore", "ignore", "ignore"],
  detached: true, // POSIX: child becomes its own process group leader
  windowsHide: true,
});
const pid = shellChild.pid;
const pgid = pid; // -pid == -childPid is the PGID

out(`SPAWNED_ROOT_PID=${pid}`);
out(`SPAWNED_PGID=${pgid}`);

// Give the shell a moment to fork the grandchild.
await new Promise((r) => setTimeout(r, 300));

// Capture the membership of the PGID via ps.
out("[2/4] members of PGID " + pgid);
const { execSync } = await import("node:child_process");
let members;
try {
  members = execSync(`ps -axo pid,ppid,pgid,command | awk '$3 == ${pgid} { print }'`, {
    encoding: "utf8",
  }).trim();
} catch (e) {
  members = `<ps failed: ${e.message}>`;
}
out(members || "<empty>");

// Write a marker so other probes can find this PGID without
// re-running this script.
writeFileSync("/tmp/clinemm-pgterm-target.txt", String(pgid));

// 3. Direct kill from THIS process (unsandboxed bun parent).
out("[3/4] direct process.kill(-pgid, 0) from THIS unsandboxed parent");
let directProbe = "UNKNOWN";
try {
  process.kill(-pgid, 0);
  directProbe = "PASS";
} catch (e) {
  directProbe = `FAIL: ${e.code || e.message}`;
}
out(`DIRECT_PROBE_RESULT=${directProbe}`);

// 4. Wait so the probe stays alive long enough for an external
//    sandboxed shell to attempt its kill and for the helper to issue
//    its own termination. External probes can find us via the marker
//    file /tmp/clinemm-pgterm-target.txt and the PGID.
out("[4/4] waiting 60s for external probes to attempt termination");
out(`MARKER_FILE=/tmp/clinemm-pgterm-target.txt (pgid=${pgid})`);
await new Promise((r) => setTimeout(r, 60_000));

out("parent: closing detached process group");
try {
  process.kill(-pgid, "SIGKILL");
} catch (e) {
  err(`parent cleanup failed: ${e.message}`);
}
