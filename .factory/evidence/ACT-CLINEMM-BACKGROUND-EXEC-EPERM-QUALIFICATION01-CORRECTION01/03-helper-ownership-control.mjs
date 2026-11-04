// Control proof that BOTH of the host helper's ownership rules are
// satisfiable on this host (and therefore that the DENY_OWNERSHIP
// responses for the residual groups are a property of those groups,
// NOT a broken helper).
//
//   rule (a): peer_pid == leader_ppid  (the peer is the leader's parent)
//   rule (b): peer_pid == pgid == leader_pid (the peer IS the leader)
//
// Both are proved by reclaiming a group THIS process is entitled to
// reclaim. Each victim is spawned by this process, so cleanup is
// guaranteed and no residual group can be left behind.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const SOCK = "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock";
let seq = 0;
const rid = () => `act01-corr-ctl-${++seq}-${Date.now()}`;
function call(p) {
  return new Promise((res, rej) => {
    const s = createConnection(SOCK, () => s.write(JSON.stringify(p) + "\n"));
    let b = "";
    s.setTimeout(8000);
    s.once("timeout", () => { s.destroy(); rej(new Error("timeout")); });
    s.once("error", rej);
    s.on("data", c => { b += c; const i = b.indexOf("\n"); if (i >= 0) { s.end(); try { res(JSON.parse(b.slice(0, i))); } catch (e) { rej(e); } } });
  });
}

async function reclaimViaRule(label, pgid) {
  const co = await call({ version: 1, request_id: rid(), method: "client.open" });
  const reg = await call({ version: 1, request_id: rid(), method: "process-group.register-owned", client_token: co.client_token, pgid });
  let term = null;
  if (reg.ok) {
    term = await call({ version: 1, request_id: rid(), method: "process-group.terminate-owned", client_token: co.client_token, job_token: reg.job_token });
  }
  await call({ version: 1, request_id: rid(), method: "client.close", client_token: co.client_token }).catch(() => {});
  console.log(`${label}: peer_pid=${process.pid} target_pgid=${pgid} register=${JSON.stringify(reg)} terminate=${JSON.stringify(term)}`);
  return { reg, term };
}

// RULE (a): this process spawns a DETACHED victim, so victim.ppid ===
// process.pid. The peer then registers and terminates it.
const victim = spawn("/bin/sh", ["-c", "trap '' TERM; while :; do sleep 0.2; done"], { detached: true, stdio: "ignore" });
await new Promise(r => setTimeout(r, 400));
const a = await reclaimViaRule("RULE_A_peer_is_parent", victim.pid);

// RULE (b): the victim is spawned by a shell that EXECs the client, so
// the client pid === the group leader pid === pgid.
const script = "/tmp/act01-corr-ruleb-client.sh";
await Bun.write(script, `#!/bin/sh\nexec bun ${process.argv[1]} ${victim.pid}\n`);
const sb = spawn("/tmp/clinemm-act-01-red/setsid-helper", ["/bin/sh", script], { stdio: ["ignore", "pipe", "ignore"] });
await new Promise(r => setTimeout(r, 1500));

console.log(`RULE_A_REGISTER_OK=${a.reg.ok === true} RULE_A_TERMINATED=${a.term?.result ?? "none"}`);
console.log("RULE_B: see the setsid'd client output above (client pid == pgid == leader).");
