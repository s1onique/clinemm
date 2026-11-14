/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * ENTRY POINT for the local stdio MCP proxy.
 *
 * Codex is pointed at THIS file:
 *
 *   {
 *     "mcpServers": {
 *       "clinemm": {
 *         "command": "bun",
 *         "args": ["<repo>/apps/vscode/src/sdk/control-seam/control-seam-proxy-main.ts"]
 *       }
 *     }
 *   }
 *
 * The proxy is a LOCAL child process. It opens no listening socket of
 * its own and contacts no network host. Everything it does is a
 * round trip to the extension host's AF_UNIX control socket.
 *
 * NOTHING IS EVER WRITTEN TO STDOUT EXCEPT THE MCP PROTOCOL. The MCP
 * stdio transport owns stdout, so a stray `console.log` here would
 * corrupt the protocol stream — there is deliberately no logging in
 * this file.
 */

import { runControlSeamProxy } from "./control-seam-proxy"

void runControlSeamProxy().catch(() => {
	// Fail closed and quiet: a proxy that cannot start must not leave
	// a partial protocol stream on stdout. The exit code is the only
	// signal the launcher gets.
	process.exit(1)
})
