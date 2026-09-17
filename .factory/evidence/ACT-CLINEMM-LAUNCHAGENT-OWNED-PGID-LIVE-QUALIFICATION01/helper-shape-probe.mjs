import { createConnection } from "node:net"

const HELPER_SOCKET = process.env.CLINEMM_HOST_HELPER_SOCKET ?? "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock"

function rt(method, fields = {}) {
  return new Promise((resolve, reject) => {
    const sock = createConnection(HELPER_SOCKET, () => {
      sock.write(JSON.stringify({ version: 1, request_id: `r-${Date.now()}`, method, ...fields }) + "\n")
    })
    let buf = ""
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      const i = buf.indexOf("\n")
      if (i >= 0) {
        const line = buf.slice(0, i)
        sock.end()
        try { resolve(JSON.parse(line)) } catch (e) { reject(e) }
      }
    })
    sock.once("error", reject)
    sock.setTimeout(5000, () => reject(new Error("timeout")))
  })
}

async function main() {
  console.log(`SOCKET=${HELPER_SOCKET}`)
  console.log(`PARENT_PID=${process.pid}`)
  console.log(`PARENT_UID=${process.getuid?.()}`)
  console.log("---")
  for (const m of ["health", "client.open", "client.close", "process-group.register-owned", "process-group.terminate-owned", "process-group.release-owned", "helper.restart"]) {
    try {
      const r = await rt(m)
      console.log(`METHOD ${m}:`)
      console.log(JSON.stringify(r, null, 2))
    } catch (e) {
      console.log(`METHOD ${m}: ERROR ${e.message}`)
    }
    console.log("---")
  }
}

main().catch(err => { console.error("FATAL", err); process.exit(1) })
