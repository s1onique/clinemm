import { spawn } from "node:child_process"
const p = spawn("/bin/sh", ["-c", "echo HELLO; sleep 30"], { detached: true })
p.stdout.on("data", d => console.log("OUT:", d.toString().trim()))
p.on("exit", (c, s) => console.log("EXIT:", c, s))
console.log("PID:", p.pid)
await new Promise(r => setTimeout(r, 300))
try {
  process.kill(-p.pid, "SIGTERM")
  console.log("TERM sent to -pgid", -p.pid)
} catch (e) {
  console.log("TERM ERR:", e.code, e.message)
}
await new Promise(r => setTimeout(r, 1500))
try {
  process.kill(-p.pid, "SIGKILL")
} catch {}
