import { createConnection } from "node:net"

const HELPER_SOCKET = "/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock"

function rt(frame) {
  return new Promise((resolve, reject) => {
    const sock = createConnection(HELPER_SOCKET, () => sock.write(JSON.stringify(frame) + "\n"))
    let buf = ""
    sock.on("data", (c) => {
      buf += c.toString("utf8")
      const i = buf.indexOf("\n")
      if (i >= 0) {
        sock.end()
        try { resolve(JSON.parse(buf.slice(0, i))) } catch (e) { reject(e) }
      }
    })
    sock.once("error", reject)
    sock.setTimeout(5000, () => reject(new Error("timeout")))
  })
}

async function main() {
  const co = await rt({ version: 1, request_id: `co-${Date.now()}`, method: "client.open" })
  console.log("client_token:", co.client_token)
  const pgid = parseInt(process.argv[2], 10)
  const reg = await rt({ version: 1, request_id: `reg-${Date.now()}`, method: "process-group.register-owned", client_token: co.client_token, pgid })
  console.log("register result:", JSON.stringify(reg))
  // Cleanup: close client
  await rt({ version: 1, request_id: `cc-${Date.now()}`, method: "client.close", client_token: co.client_token })
}

main().catch(e => { console.error("FATAL", e.message); process.exit(1) })
