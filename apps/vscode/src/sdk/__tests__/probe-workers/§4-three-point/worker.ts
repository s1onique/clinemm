#!/usr/bin/env bun
/**
 * ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01 — §4 probe worker.
 *
 * Single-purpose subprocess worker. Invoked exactly once per
 * configuration (D, A, or O), in a SEPARATE OS PROCESS so that the
 * separate-process isolation required by ACT §14 is honored — no
 * shared process.env, no shared module-level cache, no cross-process
 * contamination. (Scope clarification: each worker is a separate Bun
 * OS process exercising the production CommandJobManager / policy
 * seam, NOT a full VS Code extension-host instance; the latter is a
 * much heavier boundary that §4's specific question does not require.)
 *
 * NO causal classification. The worker emits the raw observed
 * evidence (rc, stdout, stderr) and the source-proven capability
 * derivation. The orchestrator compares across the three workers.
 *
 * Output: one JSON line per emitted key, prefixed with `RESULT `.
 * Exit code: ALWAYS 0 so the orchestrator's child.spawn does not
 * pollute the PASS/FAIL chain with worker-process faults.
 *
 * Usage:
 *   env -u CLINEMM_EXPERIMENTAL_SANDBOX -u CLINEMM_SAFE_YOLO_NETWORK \
 *     bun apps/vscode/src/sdk/__tests__/probe-workers/§4-three-point/worker.ts D
 *   env -u CLINEMM_EXPERIMENTAL_SANDBOX CLINEMM_SAFE_YOLO_NETWORK=allow \
 *     bun apps/vscode/src/sdk/__tests__/probe-workers/§4-three-point/worker.ts A
 *   CLINEMM_EXPERIMENTAL_SANDBOX=off env -u CLINEMM_SAFE_YOLO_NETWORK \
 *     bun apps/vscode/src/sdk/__tests__/probe-workers/§4-three-point/worker.ts O
 */
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { createServer } from "node:net"
import { CommandJobManager } from "../../../command-job-manager"
import {
	buildExperimentalReconCapability,
	resolveExperimentalSandboxMode,
	resolveSafeYoloNetworkOptIn,
} from "../../../sandbox-policy"

type Config = "D" | "A" | "O"

const config = process.argv[2] as Config | undefined
if (config !== "D" && config !== "A" && config !== "O") {
	console.error("usage: worker.ts <D|A|O>")
	process.exit(0)
}

function emit(key: string, value: unknown): void {
	console.log(`RESULT ${key} ${JSON.stringify(value)}`)
}

/**
 * STRUCTURAL — not generated. Per source-seam-map.md §E and
 * `buildNetworkRule` in
 * sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:274,
 * the closed-union mapping is:
 *   network === "deny"  -> "(deny network*)"
 *   network === "allow" -> "(allow network*)"
 * This function projects that mapping; it does NOT execute the
 * production profile generator.
 */
function expectedSbplRuleFromSourceMapping(capability: { network: "deny" | "allow" }): string {
	return capability.network === "deny" ? "(deny network*)" : "(allow network*)"
}

async function main(): Promise<void> {
	emit("config", config)
	emit("runId", `§4-${config}-${Date.now()}-${randomBytes(2).toString("hex")}`)
	emit("sandboxOptInEnv", process.env.CLINEMM_EXPERIMENTAL_SANDBOX ?? null)
	emit("networkOptInEnv", process.env.CLINEMM_SAFE_YOLO_NETWORK ?? null)

	const resolvedMode = resolveExperimentalSandboxMode()
	const resolvedOptIn = resolveSafeYoloNetworkOptIn()
	emit("resolvedSandboxMode", resolvedMode ?? null)
	emit("resolvedNetworkOptIn", resolvedOptIn ?? null)

	// Source-proven capability derivation (the same object the
	// production CommandJobManager.start feeds into the Seatbelt
	// profile generator for this configuration).
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-§4-worker-")))
	const cap = buildExperimentalReconCapability({
		cwd,
		workspaceRoots: [cwd],
	})
	emit("capabilityNetwork", cap.network)
	emit("expectedSbplRuleFromSourceMapping", expectedSbplRuleFromSourceMapping(cap))
	emit("cwd", cwd)

	// PROBE — parent-owned loopback listener with token-gated
	// CONNECTED-vs-DENIED exact-stdout discrimination. Pattern is
	// the same as the GREEN test in
	// darwin-seatbelt-safe-yolo-network-open01.c1-green.test.ts.
	// No DNS, no external endpoints, no `sandbox_apply:` regex.
	const TOKEN = `TKN-${randomBytes(6).toString("hex")}`
	const server = createServer((socket) => {
		socket.write(`${TOKEN}\n`)
		socket.end()
	})
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => resolve())
	})
	const addr = server.address()
	if (!addr || typeof addr === "string") {
		emit("probeError", "could not bind loopback listener")
		return
	}
	const port = addr.port
	emit("probeEndpoint", `127.0.0.1:${port}`)

	const scriptPath = join(cwd, `probe-${randomBytes(4).toString("hex")}.sh`)
	const scriptBody = [
		"#!/bin/bash",
		`if exec 3<>/dev/tcp/127.0.0.1/${port}; then`,
		`  IFS= read -r -t 3 line <&3 || line=""`,
		`  printf "CONNECTED:%s\\n" "$line"`,
		`  exec 3<&-`,
		`else`,
		`  printf "DENIED\\n"`,
		`fi`,
		``,
	].join("\n")
	writeFileSync(scriptPath, scriptBody, { mode: 0o755 })
	emit("probeCommand", `/bin/bash ${scriptPath}`)
	emit("probeDiscriminator", `stdout === "CONNECTED:${TOKEN}\\n" | stdout === "DENIED\\n"`)

	const manager = new CommandJobManager({
		experimentalSandboxWorkspaceRoots: [cwd],
	})
	let rc: number | undefined
	let stdout = ""
	let stderr = ""
	let state = "unknown"
	try {
		const result = await manager.start({
			command: `/bin/bash ${scriptPath}`,
			cwd,
			waitBudgetMs: 15_000,
			executionDeadlineMs: 30_000,
		})
		state = result.state
		rc = result.exitCode
		stdout = result.stdout
		stderr = result.stderr
	} finally {
		try {
			await manager.dispose()
		} catch {
			// already disposed
		}
		try {
			server.close()
		} catch {
			// already closed
		}
	}

	emit("state", state)
	emit("rc", rc ?? null)
	emit("stdout", stdout)
	emit("stderr", stderr)
	// Exact-stdout match — the production-correct discriminator
	// (matches the c1-green.test.ts pattern). No substring matching on
	// `sandbox_apply` or `Operation not permitted` here.
	emit("exactStdoutMatched", stdout === `CONNECTED:${TOKEN}\n`)
	emit("stdoutEqualsDenied", stdout === "DENIED\n")
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		emit("workerError", err instanceof Error ? err.message : String(err))
		process.exit(0) // see header; worker never errors out the orchestrator
	})
