import { spawn } from "node:child_process"
const p = spawn("/bin/sh", ["-c", "echo CHILD_PID=$BASHPID; sleep 60"], { detached: true })
let out = ""
p.stdout.on("data", d => { out += d.toString() })
p.on("exit", (c, s) => console.log("EXIT", c, s))
console.log("PARENT_PID:", process.pid, "CHILD_PID:", p.pid)
await new Promise(r => setTimeout(r, 300))
console.log("CHILD_OUTPUT:", out.trim())
try {
  process.kill(-p.pid, "SIGTERM")
  console.log("TERM sent to -pgid", -p.pid)
} catch (e) {
  console.log("TERM_EPERM:", e.code, e.message)
}
await new Promise(r => setTimeout(r, 1500))
try { process.kill(-p.pid, "SIGKILL") } catch {}
