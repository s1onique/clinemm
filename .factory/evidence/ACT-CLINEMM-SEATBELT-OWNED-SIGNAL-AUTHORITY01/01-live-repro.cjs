#!/usr/bin/env node
const { spawn, spawnSync } = require("node:child_process");
const log = (...a) => console.log(...a);

log("=== ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01 / live-repro ===");
log("PARENT_PID=" + process.pid);
log("PARENT_PPID=" + process.ppid);
log("PPID_CMDLINE=" +
  (spawnSync("ps", ["-o", "command=", "-p", String(process.ppid)]).stdout.toString().trim() || "<unknown>"));

const childScript = `
process.title = "fake-clineowned-node";
process.stdout.write("CHILD_PID=" + process.pid + "\\n");
process.on("SIGTERM", () => { process.stdout.write("CHILD_GOT_SIGTERM_BUT_CONTINUES\\n"); });
process.on("SIGINT",  () => { process.stdout.write("CHILD_GOT_SIGINT_BUT_CONTINUES\\n"); });
setInterval(() => {}, 1000);
`;

const child = spawn(process.execPath, ["-e", childScript], {
  detached: true,
  stdio: ["ignore", "pipe", "pipe"],
});
child.unref();

const childPid = child.pid;
log("CHILD_SPAWNED pid=" + childPid);

let childOutput = "";
child.stdout.on("data", (b) => { childOutput += b.toString(); });
child.stderr.on("data", (b) => { process.stderr.write("[child.err] " + b); });

function waitFor(predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

(async () => {
  try { await waitFor(() => /CHILD_PID=\d+/.test(childOutput), 3000); }
  catch (e) { log("FAIL: child did not start"); process.exit(2); }

  const pgid = childPid;
  log("CHILD_PGID=" + pgid);
  spawnSync("ps", ["-axo", "pid,ppid,pgid,command"], { stdio: "inherit" });

  let probeRc;
  try { process.kill(-pgid, 0); probeRc = "OK"; }
  catch (err) { probeRc = "ERR_" + (err.code || err.message); }
  log("PROBE_PGID_0=" + probeRc);

  let termRc;
  try { process.kill(-pgid, "SIGTERM"); termRc = "OK_NO_THROW"; }
  catch (err) { termRc = "ERR_" + (err.code || err.message); }
  log("KILL_PGID_SIGTERM=" + termRc);

  await new Promise((r) => setTimeout(r, 1500));
  log("CHILD_OUTPUT_AFTER_TERM:");
  log(childOutput);

  // IMPORTANT: probePgidExists semantics match bash.ts:1009-1020.
  // EPERM is treated as "still exists" because POSIX says the group
  // exists but we lack permission — never "gone".
  function probe(pgid) {
    try { process.kill(-pgid, 0); return "EXISTS"; }
    catch (err) {
      const code = err.code || err.message;
      if (code === "ESRCH") return "GONE_ESRCH";
      return "EXISTS_DENIED_" + code;  // EPERM, EINVAL, etc.
    }
  }

  let probeAfterTerm = probe(pgid);
  log("PROBE_PGID_0_AFTER_TERM=" + probeAfterTerm);

  let killRc;
  try { process.kill(-pgid, "SIGKILL"); killRc = "OK_NO_THROW"; }
  catch (err) { killRc = "ERR_" + (err.code || err.message); }
  log("KILL_PGID_SIGKILL=" + killRc);

  await new Promise((r) => setTimeout(r, 1500));
  let probeAfterKill = probe(pgid);
  log("PROBE_PGID_0_AFTER_KILL=" + probeAfterKill);

  const psOut = spawnSync("ps", ["-axo", "pid,ppid,pgid,command"]).stdout.toString();
  const lines = psOut.split("\n").filter((l) => l.includes(String(pgid)));
  log("PS_PGID_MATCH_COUNT=" + lines.length);
  lines.forEach((l) => log("  " + l));

  log("\n=== VERDICT ===");
  // EPERM on signalGroup is the live failure pattern. Match bash.ts:
  //   probePgidExists treats EPERM as "still exists" → wait window
  //   expires → SIGKILL also EPERMs → terminateTree reports false.
  const termBlocked = termRc.startsWith("ERR_");
  const killBlocked = killRc.startsWith("ERR_");
  const termReached = !termBlocked && probeAfterTerm === "GONE_ESRCH";
  const killReached = !killBlocked && probeAfterKill === "GONE_ESRCH";
  if (termBlocked && killBlocked) {
    log("RED: BOTH SIGTERM AND SIGKILL BLOCKED by Seatbelt — child CANNOT be killed by parent");
    log("RED: this is the LIVE failure: Cline-owned node processes accumulate as orphans");
    log("RED: this matches the screenshot pattern (~60 GiB resident, ~71 GiB swap)");
    process.exitCode = 1;
  } else if (termBlocked && !killBlocked && killReached) {
    log("AMBER: SIGTERM blocked but SIGKILL worked — partial authority");
    process.exitCode = 2;
  } else if (termReached || killReached) {
    log("GREEN: signal authority IS available — child was killed");
    process.exitCode = 0;
  } else {
    log("INDETERMINATE: termRc=" + termRc + " killRc=" + killRc +
      " probeAfterTerm=" + probeAfterTerm + " probeAfterKill=" + probeAfterKill);
    process.exitCode = 3;
  }

  try { process.kill(-pgid, "SIGKILL"); } catch {}
  process.exit(process.exitCode);
})().catch((e) => { log("FATAL: " + e.message); process.exit(3); });
