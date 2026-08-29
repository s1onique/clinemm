/**
 * ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01 — §4 host-ablation
 * orchestrator (REVIEWER-REVISED, C2 bounded correction).
 *
 * THIS FILE IS A SCAFFOLDING, not a §4 PASS.
 *
 * Per the 2026-08-28 factory-reviewer verdict `HALT_§4_TEST_NOT_CAUSALLY_VALID`
 * on commit `61d6b0119`:
 *
 *   "Do not commit the current test as '§4 executed'."
 *
 *   "You can commit it as '§4 probe scaffolding + HOST_SUBSTRATE_UNAVAILABLE
 *    evidence' but not as '§4 three-point host ablation executed'."
 *
 * Two P0 defects of the prior implementation are now corrected:
 *
 *   P0 #1 — wrong classifier
 *     OLD: regex-matched `sandbox-exec: sandbox_apply: Operation not permitted`
 *          in child stderr to call a result "SEATBELT_DENIED". That
 *          string is the substrate-availability deny (the helper
 *          couldn't APPLY a new sandbox envelope), not a Seatbelt
 *          network policy deny. A correctly-implemented D case on
 *          Terminal.app would NEVER emit `sandbox_apply:` — the profile
 *          applies cleanly, then the child's connect() returns EPERM.
 *          The old classifier would have false-failed it.
 *
 *     NEW: comparative exact-stdout discrimination across three
 *          INDEPENDENT OS PROCESSES. The worker emits
 *          `stdout === "CONNECTED:${TOKEN}\n"` (host-success) or
 *          `stdout === "DENIED\n"` (connect-failure). The orchestrator
 *          compares the trio:
 *
 *            D ≠ A with respect to permission-denial behavior
 *            AND
 *            A ≈ O with respect to permission-denial behavior
 *
 *          `A ≈ O` means A's permission-denial signal matches O's,
 *          not that A's exact stdout equals O's. O might connect fine
 *          and A might encounter a TLS / DNS / etc error that is
 *          downstream of the kernel — what matters is that the
 *          kernel-level permission denial disappears.
 *
 *   P0 #2 — in-process env mutation
 *     OLD: one Vitest process; `process.env[...] = ...` mutated in-
 *          place between cases. The separate-process isolation
 *          required by ACT §14 was violated.
 *
 *     NEW: each case is a SEPARATE OS PROCESS spawned via
 *          `Bun.spawn`. Process 1 has the D env; process 2 has the
 *          A env; process 3 has the O env. No shared state. (Scope:
 *          each is a separate Bun process exercising the production
 *          CommandJobManager / policy seam — NOT a full VS Code
 *          extension-host instance; the latter is a much heavier
 *          boundary that §4's specific question does not require.)
 *
 * The structural projection of the SBPL network rule is honestly
 * labeled `expectedSbplRuleFromSourceMapping` (not generated SBPL
 * policy). The orchestrator does NOT execute `generateSeatbeltProfile`
 * — that would require importing the SDK's compiled profile generator
 * via a deep relative path, which adds coupling for marginal value on
 * a closed-union derivation.
 *
 * The substrate-availability halt evidence remains valid and is
 * preserved in `§4-metadata/HALT_HOST_SUBSTRATE_UNAVAILABLE.txt`. When
 * this orchestrator is invoked from a substrate-eligible shell
 * (Terminal.app / iTerm2 / debug harness), the three workers will
 * produce the comparative trio; until then, this is recorded as
 * scaffolding + halt evidence only.
 */

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { buildExperimentalReconCapability, resolveExperimentalSandboxMode, resolveSafeYoloNetworkOptIn } from "../sandbox-policy"

const ACT_EVIDENCE_ROOT = (() => {
	const path = require("node:path") as typeof import("node:path")
	const url = require("node:url") as typeof import("node:url")
	const here = url.fileURLToPath((import.meta as { meta?: { url: string }; url: string }).url ?? "")
	// Test file lives at <repo-root>/apps/vscode/src/sdk/__tests__/<this>.test.ts
	// Repo root is five parents up:
	//   __tests__/ → sdk/ → src/ → vscode/ → apps/ → <repo-root>/
	const dir = path.dirname(here)
	const repoRoot = path.resolve(dir, "..", "..", "..", "..", "..")
	return path.resolve(repoRoot, ".factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01")
})()
// The worker is invoked by `spawn(bun, [WORKER_PATH, config])` from
// the orchestrator's process. The spawn inherits the orchestrator's
// cwd, which is `apps/vscode/` (where vitest is invoked). The
// WORKER_PATH must therefore be absolute so the child bun can find
// the script regardless of cwd.
//
// We resolve it relative to the test file's own location: vitest
// tests are loaded from disk and `import.meta.url` is available
// (vitest runs under Node + tsx/loader), so the file URL is the
// most stable anchor.
const WORKER_PATH = (() => {
	const path = require("node:path") as typeof import("node:path")
	const url = require("node:url") as typeof import("node:url")
	const here = url.fileURLToPath((import.meta as { meta?: { url: string }; url: string }).url ?? "")
	const dir = path.dirname(here)
	return path.resolve(dir, "probe-workers/§4-three-point/worker.ts")
})()

type Config = "D" | "A" | "O"

interface WorkerRecord {
	config: Config
	runId: string | null
	launchEnv: {
		sandboxOptInEnv: string | null
		networkOptInEnv: string | null
	}
	resolved: {
		sandboxMode: string | null
		networkOptIn: string | null
	}
	capabilityNetwork: string | null
	expectedSbplRuleFromSourceMapping: string | null
	probe: {
		endpoint: string | null
		command: string | null
		discriminator: string | null
	}
	kernel: {
		state: string | null
		rc: number | null
		stdout: string | null
		stderr: string | null
		exactStdoutMatched: boolean | null
		stdoutEqualsDenied: boolean | null
	}
	workerError: string | null
}

/**
 * Parse the worker's stdout (one `RESULT <key> <json>` line per key)
 * back into a structured record. The worker NEVER emits non-RESULT
 * lines on stdout; its `console.error("usage: ...")` only fires on
 * bad argv, which we filter out before invocation.
 *
 * Returns a `Record<string, unknown>` so callers can read any
 * well-known key. (TS can't see the dynamic-key insertion into
 * `Partial<WorkerRecord>` directly; the resolver below does the
 * safe access.)
 */
function parseWorkerStdout(stdout: string): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const lineRaw of stdout.split("\n")) {
		// Strip ANSI escape codes (the worker may emit colored output
		// when NO_COLOR is not set on the parent shell).
		const line = lineRaw.replace(/\u001b\[[0-9;]*m/g, "")
		const m = /^RESULT (\w+) (.+)$/.exec(line)
		if (!m) continue
		const [, key, rawJson] = m
		try {
			out[key] = JSON.parse(rawJson)
		} catch {
			// ignore malformed lines; orchestrator only fails on missing keys
		}
	}
	return out
}

function asStringOrNull(v: unknown): string | null {
	if (v === null || v === undefined) return null
	if (typeof v === "string") return v
	// Defensive: the worker JSON-stringifies everything; if a value
	// arrives as an object/number/boolean, stringify it so the
	// orchestrator can still display it without crashing.
	return JSON.stringify(v)
}

/**
 * Build an empty record with `workerError` populated. Used when the
 * worker subprocess could not be launched at all (e.g. bun not on
 * PATH, or the shell environment lacks permission to spawn).
 */
function emptyRecord(config: Config, error: string): WorkerRecord {
	return {
		config,
		runId: null,
		launchEnv: { sandboxOptInEnv: null, networkOptInEnv: null },
		resolved: { sandboxMode: null, networkOptIn: null },
		capabilityNetwork: null,
		expectedSbplRuleFromSourceMapping: null,
		probe: { endpoint: null, command: null, discriminator: null },
		kernel: {
			state: null,
			rc: null,
			stdout: null,
			stderr: null,
			exactStdoutMatched: null,
			stdoutEqualsDenied: null,
		},
		workerError: error,
	}
}

/**
 * Substrate predicate. Module-load capture. The kernel half of §4
 * requires that the orchestrator's process can actually invoke
 * `/usr/bin/sandbox-exec` from THIS shell — not merely that the
 * binary is installed on disk. The c3-real-kernel test's gate only
 * checks file presence; for §4 we additionally verify that a
 * minimal sandbox-exec round-trip succeeds. On VSCodium-descended
 * shells, the parent Chromium sandbox strips the
 * `com.apple.security.sandbox` entitlement and the round-trip
 * fails with `sandbox_apply: Operation not permitted` even when
 * the binary is present — exactly the substrate-availability halt
 * captured in `§4-metadata/HALT_HOST_SUBSTRATE_UNAVAILABLE.txt`.
 *
 * When this is false, the REAL_KERNEL_PRODUCTION_SEAM describe
 * block is skipped via `describe.skipIf(!HAS_SUBSTRATE)`. Source-
 * side derivation tests still run regardless — they don't touch
 * the kernel.
 */
const HAS_SUBSTRATE: boolean = (() => {
	if (process.platform !== "darwin") return false
	if (!existsSync("/usr/bin/sandbox-exec")) return false
	const probe = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/bin/echo", "ok"], {
		encoding: "utf8",
		timeout: 2_000,
	})
	return probe.status === 0 && probe.stdout.trim() === "ok"
})()

/**
 * STRUCTURAL projection of the closed-union SBPL network-rule
 * mapping from source-seam-map.md §E and `buildNetworkRule` in
 * sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:274.
 * Used by SOURCE_DERIVATION tests; the orchestrator's worker half
 * uses the same function in `worker.ts` (deliberately duplicated
 * to keep the worker self-contained).
 */
function expectedSbplRuleFromSourceMapping(capability: { network: "deny" | "allow" }): string {
	return capability.network === "deny" ? "(deny network*)" : "(allow network*)"
}

/**
 * Locate the `bun` binary for subprocess invocation. Prefers (in order):
 *   1. `Bun.which("bun")` when running under bun (test or worker host)
 *   2. `process.execPath` when `process.execPath` ends with `/bun`
 *   3. Conventional absolute paths (homebrew + ~/.bun)
 *   4. PATH lookup via `which`
 *
 * Returns the absolute path to `bun`, or `null` if not found. The
 * caller is responsible for emitting a structured halt if `null`.
 */
function locateBun(): string | null {
	try {
		// Bun is the runtime we expect for this project; `Bun` is a
		// global when running under bun.
		const maybeBun = (globalThis as { Bun?: { which: (name: string) => string | null } }).Bun
		if (maybeBun?.which) {
			const p = maybeBun.which("bun")
			if (p) return p
		}
	} catch {
		// not under bun; fall through
	}
	// Detect "I am running under bun even though Bun global isn't set"
	// by execPath basename.
	if (process.execPath && process.execPath.endsWith("/bun")) {
		return process.execPath
	}
	const fallbacks = ["/opt/homebrew/bin/bun", `${process.env.HOME}/.bun/bin/bun`]
	for (const p of fallbacks) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			require("node:fs").accessSync(p)
			return p
		} catch {
			// not present
		}
	}
	return null
}

/**
 * Spawn one worker subprocess with the env for the given configuration.
 * Returns the structured record. The worker always exits with code 0
 * (per its contract); the orchestrator handles missing fields by
 * recording `workerError` rather than failing.
 */
function spawnWorker(config: Config): Promise<WorkerRecord> {
	return new Promise((resolve) => {
		// Build the env per ACT §14 launch discipline:
		//   D: both env vars UNSET
		//   A: CLINEMM_SAFE_YOLO_NETWORK=allow (sandbox env var UNSET)
		//   O: CLINEMM_EXPERIMENTAL_SANDBOX=off (network env var UNSET)
		const env: Record<string, string> = { ...process.env } as Record<string, string>
		delete env.CLINEMM_EXPERIMENTAL_SANDBOX
		delete env.CLINEMM_SAFE_YOLO_NETWORK
		if (config === "A") env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		if (config === "O") env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"

		const bunPath = locateBun()
		if (!bunPath) {
			resolve(emptyRecord(config, "could not locate bun binary for worker subprocess"))
			return
		}

		const child = spawn(bunPath, [WORKER_PATH, config], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		})
		let stdout = ""
		let stderr = ""
		child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()))
		child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()))
		child.on("error", (err) => {
			// Subprocess could not be spawned at all (ENOENT on bun,
			// or EPERM in a sandbox). Record as a structured halt.
			resolve(emptyRecord(config, `spawn error: ${err.message}`))
		})
		child.on("close", (code, signal) => {
			const parsed = parseWorkerStdout(stdout)
			// Debug: if the worker produced no parsed keys at all and
			// emitted nothing on stderr, capture the raw bytes so the
			// operator can see what actually happened.
			const parsedKeys = Object.keys(parsed)
			const debugInfo =
				parsedKeys.length === 0
					? `raw stdout bytes=${stdout.length}; raw stderr bytes=${stderr.length}; first 200 stdout=${JSON.stringify(stdout.slice(0, 200))}; first 200 stderr=${JSON.stringify(stderr.slice(0, 200))}; code=${code}; signal=${signal}`
					: null
			resolve({
				config,
				runId: asStringOrNull(parsed.runId),
				launchEnv: {
					sandboxOptInEnv: asStringOrNull(parsed.sandboxOptInEnv),
					networkOptInEnv: asStringOrNull(parsed.networkOptInEnv),
				},
				resolved: {
					sandboxMode: asStringOrNull(parsed.resolvedSandboxMode),
					networkOptIn: asStringOrNull(parsed.resolvedNetworkOptIn),
				},
				capabilityNetwork: asStringOrNull(parsed.capabilityNetwork),
				expectedSbplRuleFromSourceMapping: asStringOrNull(parsed.expectedSbplRuleFromSourceMapping),
				probe: {
					endpoint: asStringOrNull(parsed.probeEndpoint),
					command: asStringOrNull(parsed.probeCommand),
					discriminator: asStringOrNull(parsed.probeDiscriminator),
				},
				kernel: {
					state: asStringOrNull(parsed.state),
					rc: typeof parsed.rc === "number" ? parsed.rc : null,
					stdout: asStringOrNull(parsed.stdout),
					stderr: asStringOrNull(parsed.stderr),
					exactStdoutMatched: typeof parsed.exactStdoutMatched === "boolean" ? parsed.exactStdoutMatched : null,
					stdoutEqualsDenied: typeof parsed.stdoutEqualsDenied === "boolean" ? parsed.stdoutEqualsDenied : null,
				},
				workerError: asStringOrNull(parsed.workerError) ?? debugInfo,
			})
		})
	})
}

/**
 * Comparative classification (NO regex on `sandbox_apply:`):
 *
 *   SEATBELT_DENIED            stdout === "DENIED\n"
 *   PROCEEDED_PAST_SEATBELT    stdout === "CONNECTED:${TOKEN}\n"
 *   HOST_BEHAVIOR              whatever the no-sandbox baseline does
 *                               (used only as a reference for `A ≈ O`)
 *   INCONCLUSIVE               anything else (timeout, listener bind
 *                               failure, etc.) — substrate halt
 *
 * The final PASS criterion is the BOTH-OF relation:
 *
 *   D shows SEATBELT_DENIED
 *   AND
 *   A shows PROCEEDED_PAST_SEATBELT (or HOST_BEHAVIOR-equivalent —
 *       i.e. permission denial disappears)
 *   AND
 *   O matches A's permission-denial signal
 */
type Classification = "SEATBELT_DENIED" | "PROCEEDED_PAST_SEATBELT" | "HOST_BEHAVIOR" | "INCONCLUSIVE"

function classifyRecord(record: WorkerRecord): Classification {
	if (record.kernel.exactStdoutMatched === true) return "PROCEEDED_PAST_SEATBELT"
	if (record.kernel.stdoutEqualsDenied === true) return "SEATBELT_DENIED"
	if (record.workerError !== null) return "INCONCLUSIVE"
	// Either the worker exited but did not produce exact CONNECTED or
	// DENIED, or the kernel half did not run. The substrate-availability
	// halt is the canonical case here.
	return "INCONCLUSIVE"
}

const records: Partial<Record<Config, WorkerRecord>> = {}

beforeAll(() => {
	for (const cfg of ["D", "A", "O"] as const) {
		mkdirSync(join(ACT_EVIDENCE_ROOT, `§4-${cfg}`), { recursive: true })
	}
})

afterEach(() => {
	// Worker subprocesses are isolated by design; nothing to clean up
	// in the orchestrator's process.env.
})

async function writeCaseEvidence(label: Config, record: WorkerRecord): Promise<void> {
	const launchEnvLines = [
		`RUN_ID=${record.runId ?? "<missing>"}`,
		`CONFIG=${label}`,
		`SANDBOX_OPTIN_ENV=${JSON.stringify(record.launchEnv.sandboxOptInEnv)}`,
		`NETWORK_OPTIN_ENV=${JSON.stringify(record.launchEnv.networkOptInEnv)}`,
		`resolved sandbox mode=${JSON.stringify(record.resolved.sandboxMode)}`,
		`resolved network opt-in=${JSON.stringify(record.resolved.networkOptIn)}`,
		`CommandCapability.network=${JSON.stringify(record.capabilityNetwork)}`,
		`expectedSbplRuleFromSourceMapping=${JSON.stringify(record.expectedSbplRuleFromSourceMapping)}`,
		`probe endpoint=${JSON.stringify(record.probe.endpoint)}`,
		`probe command=${JSON.stringify(record.probe.command)}`,
		`probe discriminator=${JSON.stringify(record.probe.discriminator)}`,
	]
	writeFileSync(join(ACT_EVIDENCE_ROOT, `§4-${label}`, "launch-env.txt"), `${launchEnvLines.join("\n")}\n`)

	const classification = classifyRecord(record)
	const resultLines = [
		`RUN_ID=${record.runId ?? "<missing>"}`,
		`CONFIG=${label}`,
		`backend=${record.resolved.sandboxMode === "seatbelt-experimental" ? "SeatbeltSandboxBackendExperimental" : "none"}`,
		`CommandCapability.network=${JSON.stringify(record.capabilityNetwork)}`,
		`expectedSbplRuleFromSourceMapping=${JSON.stringify(record.expectedSbplRuleFromSourceMapping)}`,
		`command=${JSON.stringify(record.probe.command)}`,
		`rc=${record.kernel.rc}`,
		`stdout=${JSON.stringify(record.kernel.stdout)}`,
		`stderr=${JSON.stringify(record.kernel.stderr)}`,
		`exactStdoutMatched=${JSON.stringify(record.kernel.exactStdoutMatched)}`,
		`stdoutEqualsDenied=${JSON.stringify(record.kernel.stdoutEqualsDenied)}`,
		`classification=${classification}`,
		`workerError=${JSON.stringify(record.workerError)}`,
	]
	writeFileSync(join(ACT_EVIDENCE_ROOT, `§4-${label}`, "result.txt"), `${resultLines.join("\n")}\n`)
}

describe("§4 SOURCE_DERIVATION (always runs; substrate-independent)", () => {
	// These tests exercise the production seam directly in this process —
	// no worker subprocess, no /usr/bin/sandbox-exec, no kernel probe.
	// They validate that resolveExperimentalSandboxMode,
	// resolveSafeYoloNetworkOptIn, and buildExperimentalReconCapability
	// produce the expected capability + structural SBPL-rule projection
	// for each configuration. The substrate predicate does NOT gate
	// this block.

	// Capture env, set per-case, derive, restore. Restoring mirrors
	// the standalone helper's P1 fix so the orchestrator's process
	// doesn't leak state into the rest of the test run.
	function withConfig<T>(cfg: { sandbox: string | undefined; network: string | undefined }, fn: () => T): T {
		const prevSb = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		const prevNet = process.env.CLINEMM_SAFE_YOLO_NETWORK
		if (cfg.sandbox === undefined) delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
		else process.env.CLINEMM_EXPERIMENTAL_SANDBOX = cfg.sandbox
		if (cfg.network === undefined) delete process.env.CLINEMM_SAFE_YOLO_NETWORK
		else process.env.CLINEMM_SAFE_YOLO_NETWORK = cfg.network
		try {
			return fn()
		} finally {
			if (prevSb === undefined) delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
			else process.env.CLINEMM_EXPERIMENTAL_SANDBOX = prevSb
			if (prevNet === undefined) delete process.env.CLINEMM_SAFE_YOLO_NETWORK
			else process.env.CLINEMM_SAFE_YOLO_NETWORK = prevNet
		}
	}

	it("D — DENY (env unset): capability.network='deny', rule='(deny network*)'", () => {
		withConfig({ sandbox: undefined, network: undefined }, () => {
			expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
			expect(resolveSafeYoloNetworkOptIn()).toBeUndefined()
			const cap = buildExperimentalReconCapability({
				cwd: "/tmp",
				workspaceRoots: [],
			})
			expect(cap.network).toBe("deny")
			expect(expectedSbplRuleFromSourceMapping(cap)).toBe("(deny network*)")
		})
	})

	it("A — ALLOW (CLINEMM_SAFE_YOLO_NETWORK=allow): capability.network='allow', rule='(allow network*)'", () => {
		withConfig({ sandbox: undefined, network: "allow" }, () => {
			expect(resolveExperimentalSandboxMode()).toBe("seatbelt-experimental")
			expect(resolveSafeYoloNetworkOptIn()).toBe("allow")
			const cap = buildExperimentalReconCapability({
				cwd: "/tmp",
				workspaceRoots: [],
			})
			expect(cap.network).toBe("allow")
			expect(expectedSbplRuleFromSourceMapping(cap)).toBe("(allow network*)")
		})
	})

	it("O — OFF (CLINEMM_EXPERIMENTAL_SANDBOX=off): no envelope; capability.network='deny' (default), rule='(deny network*)'", () => {
		withConfig({ sandbox: "off", network: undefined }, () => {
			expect(resolveExperimentalSandboxMode()).toBeUndefined()
			expect(resolveSafeYoloNetworkOptIn()).toBeUndefined()
			const cap = buildExperimentalReconCapability({
				cwd: "/tmp",
				workspaceRoots: [],
			})
			expect(cap.network).toBe("deny")
			expect(expectedSbplRuleFromSourceMapping(cap)).toBe("(deny network*)")
		})
	})

	it("D/O derive deny; A derives allow (capability axis only — kernel A≈O is verified separately)", () => {
		let dCap: { network: "deny" | "allow" } | undefined
		let aCap: { network: "deny" | "allow" } | undefined
		let oCap: { network: "deny" | "allow" } | undefined
		withConfig({ sandbox: undefined, network: undefined }, () => {
			dCap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		})
		withConfig({ sandbox: undefined, network: "allow" }, () => {
			aCap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		})
		withConfig({ sandbox: "off", network: undefined }, () => {
			oCap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		})
		expect(dCap!.network).toBe("deny")
		expect(aCap!.network).toBe("allow")
		expect(oCap!.network).toBe("deny")
		expect(dCap!.network).not.toBe(aCap!.network)
		expect(aCap!.network).not.toBe(oCap!.network)
	})
})

describe.skipIf(!HAS_SUBSTRATE)("§4 REAL_KERNEL_PRODUCTION_SEAM (D/A/O subprocesses + comparative; substrate-gated)", () => {
	// This block drives the production CommandJobManager.start seam
	// through three independent bun subprocess workers. Each worker
	// produces its own launch-env.txt + result.txt evidence under
	// .factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01/§4-{D,A,O}/.
	//
	// On a substrate-eligible shell (Terminal.app / iTerm2 / debug
	// harness), the workers exercise the real /usr/bin/sandbox-exec
	// envelope and the parent's loopback listener, producing the
	// comparative trio (D = DENIED, A = CONNECTED:<token>, O =
	// CONNECTED:<token>).
	//
	// On this VSCodium shell, HAS_SUBSTRATE is FALSE (the bash
	// process is itself sandboxed; even `/usr/bin/sandbox-exec
	// -p '(version 1)(allow default)' /bin/echo ok` fails with
	// EPERM), so the entire block is SKIPPED. The vitest report
	// shows `4 skipped`, which is the reviewer-prescribed shape:
	// substrate-unavailable ≠ green.

	it("D — DENY worker subprocess (env unset)", async () => {
		const record = await spawnWorker("D")
		records.D = record
		await writeCaseEvidence("D", record)
		expect(record.capabilityNetwork).toBe("deny")
		expect(record.expectedSbplRuleFromSourceMapping).toBe("(deny network*)")
	})

	it("A — ALLOW worker subprocess (CLINEMM_SAFE_YOLO_NETWORK=allow)", async () => {
		const record = await spawnWorker("A")
		records.A = record
		await writeCaseEvidence("A", record)
		expect(record.capabilityNetwork).toBe("allow")
		expect(record.expectedSbplRuleFromSourceMapping).toBe("(allow network*)")
	})

	it("O — OFF worker subprocess (CLINEMM_EXPERIMENTAL_SANDBOX=off)", async () => {
		const record = await spawnWorker("O")
		records.O = record
		await writeCaseEvidence("O", record)
		expect(record.capabilityNetwork).toBe("deny")
		expect(record.expectedSbplRuleFromSourceMapping).toBe("(deny network*)")
	})

	it("§6 §14 PASS-CRITERION: comparative discrimination (D = SEATBELT_DENIED; A = O = PROCEEDED_PAST_SEATBELT)", () => {
		const dCls = classifyRecord(records.D!)
		const aCls = classifyRecord(records.A!)
		const oCls = classifyRecord(records.O!)

		// D: explicit permission denial (loopback connect to a
		// known-live listener fails inside the Seatbelt envelope).
		expect(dCls).toBe("SEATBELT_DENIED")
		// A: permission-denial signal disappeared; the loopback
		// connect under the Seatbelt envelope reached the
		// listener and received the exact discriminator token.
		expect(aCls).toBe("PROCEEDED_PAST_SEATBELT")
		// O: no envelope; loopback connect reaches the listener
		// and receives the exact token. (A and O both reach
		// the host; the only difference between them is the
		// sandbox-envelope layer, which is what the network
		// policy axis separates.)
		expect(oCls).toBe("PROCEEDED_PAST_SEATBELT")
	})
})
