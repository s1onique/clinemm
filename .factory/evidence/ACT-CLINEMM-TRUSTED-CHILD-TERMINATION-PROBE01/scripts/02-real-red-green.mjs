// ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01
// Phase A+B: RED reproduction + GREEN helper-side authority proof.
import { spawn, execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const out = (line) => process.stdout.write(line + "\n");

out("[1/7] spawning detached shell child (real ClineMM production primitive: spawn(..., {detached: true}))");
const shellChild = spawn("/bin/sh", ["-c", "sleep 300 & exec sleep 300"], {
  cwd: "/tmp",
  env: { PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin" },
  stdio: ["ignore", "ignore", "ignore"],
  detached: true,
  windowsHide: true,
});
const pgid = shellChild.pid;
out(`SPAWNED_PGID=${pgid}`);

await new Promise((r) => setTimeout(r, 300));

let members = execSync(`ps -axo pid,ppid,pgid,command | awk '$3 == ${pgid} { print }'`, {
  encoding: "utf8",
}).trim();
out(`MEMBERS_BEFORE=${members.replace(/\n/g, "|")}`);

writeFileSync("/tmp/clinemm-pgterm-target.txt", `${pgid}\n${process.pid}\n`);

out("[2/7] probe PGID from THIS unsandboxed parent: process.kill(-pgid, 0)");
let probeResult = "UNKNOWN";
let probeErrCode = "";
try {
  process.kill(-pgid, 0);
  probeResult = "PASS";
} catch (e) {
  probeResult = "FAIL";
  probeErrCode = e.code || e.message;
}
out(`DIRECT_PROBE=${probeResult} CODE=${probeErrCode}`);

let termResult = "UNKNOWN";
let termErrCode = "";
try {
  process.kill(-pgid, "SIGTERM");
  termResult = "PASS";
} catch (e) {
  termResult = "FAIL";
  termErrCode = e.code || e.message;
}
out(`DIRECT_TERM=${termResult} CODE=${termErrCode}`);

out("[3/7] members after direct cancel attempt");
members = execSync(`ps -axo pid,ppid,pgid,command | awk '$3 == ${pgid} { print }'`, {
  encoding: "utf8",
}).trim();
out(`MEMBERS_AFTER_DIRECT=${members.replace(/\n/g, "|") || "(empty)"}`);

out("[4/7] waiting up to 30s for helper kill");
let waitedMs = 0;
let helperKilled = false;
while (waitedMs < 30000) {
  await new Promise((r) => setTimeout(r, 500));
  waitedMs += 500;
  try {
    members = execSync(`ps -axo pid,pgid | awk '$2 == ${pgid} { print }'`, {
      encoding: "utf8",
    }).trim();
    if (members === "") {
      helperKilled = true;
      break;
    }
  } catch {}
}
out(`[5/7] WAIT_RESULT helper_killed=${helperKilled} after ${waitedMs}ms`);

out("[6/7] helper result file (if any)");
try {
  const r = readFileSync("/tmp/clinemm-pgterm-helper-kill-result.json", "utf8");
  out(r);
} catch {
  out("(no helper result file)");
}

out("[7/7] members final");
try {
  members = execSync(`ps -axo pid,ppid,pgid,command | awk '$3 == ${pgid} { print }'`, {
    encoding: "utf8",
  }).trim();
  out(`MEMBERS_FINAL=${members.replace(/\n/g, "|") || "(empty = group gone)"}`);
} catch {
  out("(ps failed)");
}

try { process.kill(-pgid, "SIGKILL"); } catch {}
out("done");
