#!/usr/bin/env node
import { spawn } from "node:child_process"
/**
 * ACT-CLINEMM-TRANSIENT-CONTAINMENT-RECONCILIATION-REPAIR01 (TCRR01)
 * LIVE qualification against the INSTALLED exact-head VSIX.
 *
 * The GUI cannot start on this substrate: the branded VS Code AND the
 * harness-downloaded VS Code both die with SIGSEGV under the Seatbelt
 * profile (the harness reports `kill EPERM`). A GUI-driven LIVE run is
 * therefore not possible here.
 *
 * This script performs the strongest LIVE-EQUIVALENT qualification that
 * IS possible: it loads the PACKAGED `dist/extension.js` FROM THE
 * INSTALLED VSIX and drives the `CommandJobManager` class that ships
 * inside it, with REAL child processes, against the REAL kernel
 * `process.kill(-pgid, 0)` probe.
 *
 *   N1 (transient descendant) -> the owned PGID becomes gone -> the
 *        PACKAGED manager emits `command_job_containment_reconciled` and
 *        the canonical state returns to the ORIGINAL terminal class.
 *
 *   N2 (persistent descendant) -> the owned PGID stays alive -> the
 *        PACKAGED manager NEVER reconciles (fail-closed).
 *
 * The packaged bundle's bytes are used verbatim. The only modification is
 * a 1-line APPENDED shim that publishes the bundle-internal manager class
 * onto `globalThis` so the harness can drive it; nothing else is changed.
 *
 * Usage:
 *   node apps/vscode/src/dev/debug-harness/live-installed-vsix-qualification.tcrr01.mjs
 */
import fs from "node:fs"
import Module, { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const EXT_DIR = process.env.TCRR01_EXT_DIR ?? "/tmp/tcrr01-vscode-exts"
const EXTRACT_DIR = process.env.TCRR01_EXTRACT_DIR ?? "/tmp/tcrr01-packaged"

const log = (...a) => console.log("[tcrr01-live]", ...a)
const failures = []

function check(cond, msg, detail) {
	if (cond) {
		log("PASS:", msg)
		return true
	}
	log("FAIL:", msg, detail === undefined ? "" : JSON.stringify(detail))
	failures.push(msg)
	return false
}

/**
 * A permissive `vscode` stub: the packaged bundle initializes against the
 * real VS Code API, and this stub only has to be complete enough for the
 * bundle's module-level initialization. Unknown members return a callable
 * permissive proxy, so the REAL bundle code (not a re-implementation) runs.
 */
function makeStub(name) {
	const fn = () => makeStub(`${name}()`)
	return new Proxy(fn, {
		get(target, prop) {
			if (prop === Symbol.toPrimitive || prop === "then" || prop === Symbol.iterator) return undefined
			if (prop in target) return target[prop]
			if (prop === "toString") return () => "[stub]"
			if (prop === "valueOf") return () => 0
			return makeStub(`${name}.${String(prop)}`)
		},
		apply() {
			return makeStub(`${name}()`)
		},
		construct() {
			return makeStub(`new ${name}`)
		},
	})
}

function buildVscodeStub() {
	const stub = makeStub("vscode")
	// Freeze the namespace objects so repeated property access returns the
	// SAME object (a bare Proxy would otherwise create a new one per access).
	for (const ns of [
		"window",
		"workspace",
		"commands",
		"extensions",
		"env",
		"languages",
		"debug",
		"lm",
		"authentication",
		"Uri",
		"EventEmitter",
		"Disposable",
		"ThemeColor",
		"CancellationTokenSource",
	]) {
		stub[ns] = makeStub(`vscode.${ns}`)
	}
	stub.window.createTextEditorDecorationType = () => ({ dispose() {} })
	stub.env.openExternal = async () => true
	stub.env.clipboard = { writeText: async () => {} }
	stub.extensions.getExtension = () => undefined
	stub.extensions.all = []
	stub.version = "1.117.0"
	stub.Disposable = class {
		constructor(fn) {
			this.fn = fn
		}
		dispose() {
			this.fn?.()
		}
	}
	stub.EventEmitter = class {
		constructor() {
			this.event = () => ({ dispose() {} })
		}
		fire() {}
		dispose() {}
	}
	stub.Uri = { file: (p) => ({ fsPath: p }), parse: (p) => ({ fsPath: p }) }
	stub.ThemeColor = class {}
	stub.CancellationTokenSource = class {
		cancel() {}
		dispose() {}
	}
	stub.UriHandler = class {}
	stub.FileType = { File: 1, Directory: 2, SymbolicLink: 64 }
	stub.QuickPickItemKind = { Separator: -1 }
	stub.StatusBarAlignment = { Left: 1, Right: 2 }
	stub.ViewColumn = { One: 1 }
	stub.ExtensionMode = { Production: 1, Development: 2, Test: 3 }
	stub.languages.registerCodeLensProvider = () => ({ dispose() {} })
	stub.debug.onDidStartDebugSession = () => ({ dispose() {} })
	stub.debug.onDidTerminateDebugSession = () => ({ dispose() {} })
	stub.workspace.getConfiguration = () => ({
		get: () => undefined,
		update: async () => {},
		onDidChange: () => ({ dispose() {} }),
	})
	stub.workspace.onDidChangeConfiguration = () => ({ dispose() {} })
	stub.workspace.onDidChangeConfigurationSection = () => ({ dispose() {} })
	stub.workspace.onDidSaveTextDocument = () => ({ dispose() {} })
	stub.workspace.onDidOpenTextDocument = () => ({ dispose() {} })
	stub.workspace.onDidCloseTextDocument = () => ({ dispose() {} })
	stub.workspace.onDidChangeTextDocument = () => ({ dispose() {} })
	stub.workspace.registerFileSystemProvider = () => ({ dispose() {} })
	stub.workspace.registerTextDocumentContentProvider = () => ({ dispose() {} })
	stub.workspace.applyEdit = async () => true
	stub.workspace.openTextDocument = async () => ({})
	stub.workspace.asRelativePath = (p) => String(p)
	stub.workspace.createFileSystemWatcher = () => ({
		onDidCreate: () => ({ dispose() {} }),
		onDidChange: () => ({ dispose() {} }),
		onDidDelete: () => ({ dispose() {} }),
		dispose() {},
	})
	stub.commands.registerCommand = () => ({ dispose() {} })
	stub.commands.executeCommand = async () => {}
	stub.lm.selectChatModels = async () => []
	stub.authentication.getSession = async () => undefined
	stub.authentication.onDidChangeSessions = () => ({ dispose() {} })
	return stub
}

/**
 * Copy the INSTALLED bundle verbatim and APPEND a one-line shim that
 * publishes the bundle-internal `CommandJobManager` class on
 * `globalThis`, so the harness can drive the SHIPPED implementation.
 */
function preparePackagedBundle(installedBundle) {
	const src = fs.readFileSync(installedBundle, "utf-8")
	const i = src.indexOf("pendingReconciliations=new Map")
	if (i < 0) throw new Error("packaged bundle has no pendingReconciliations")
	const classStart = src.lastIndexOf("=class{", i)
	if (classStart < 0) throw new Error("packaged bundle has no CommandJobManager class")
	// The assignment target is the identifier immediately before "=class{".
	const varMatch = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(src.slice(0, classStart))
	if (!varMatch) throw new Error("could not resolve the manager class variable name")
	const managerVar = varMatch[1]
	const shim = `\n;try{globalThis.__TCRR01_COMMAND_JOB_MANAGER__=${managerVar};}catch(e){globalThis.__TCRR01_SHIM_ERR__=String(e)}\n`
	fs.mkdirSync(EXTRACT_DIR, { recursive: true })
	const outFile = path.join(EXTRACT_DIR, "packaged-bundle-with-shim.cjs")
	fs.writeFileSync(outFile, src + shim)
	return { outFile, managerVar, originalBytes: src.length }
}

async function main() {
	// The packaged bundle is SECURE-BY-DEFAULT: the experimental sandbox is
	// armed unless the explicit break-glass opt-out is present. The sandbox
	// backend needs a real macOS Seatbelt helper that is only resolvable
	// inside the extension host, so the packaged manager would fail closed
	// with `sandbox-unavailable`. The break-glass opt-out is the
	// documented way to run the packaged manager WITHOUT the sandbox; the
	// reconciliation behaviour under test is sandbox-independent (the
	// postcondition probe is `process.kill(-pgid, 0)` either way).
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"

	// ---- 1. locate the INSTALLED extension ----------------------------
	const extDirs = fs
		.readdirSync(EXT_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory() && d.name.startsWith("s1onique.clinemm-"))
		.map((d) => path.join(EXT_DIR, d.name))
	if (!check(extDirs.length === 1, "exactly one installed clinemm extension", { found: extDirs.length })) return
	const installedDir = extDirs[0]
	const bundle = path.join(installedDir, "dist", "extension.js")
	if (!check(fs.existsSync(bundle), "installed extension has dist/extension.js")) return
	const bundleText = fs.readFileSync(bundle, "utf-8")
	check(
		bundleText.includes("command_job_containment_reconciled"),
		"installed bundle contains command_job_containment_reconciled",
	)
	check(bundleText.includes("pendingReconciliations"), "installed bundle contains pendingReconciliations")
	const pkg = JSON.parse(fs.readFileSync(path.join(installedDir, "package.json"), "utf-8"))
	log(`installed extension: ${pkg.publisher}.${pkg.name}@${pkg.version}`)

	// ---- 2. load the PACKAGED bundle and reach its manager ------------
	const { outFile, managerVar, originalBytes } = preparePackagedBundle(bundle)
	log(`packaged bundle: ${originalBytes} bytes; manager class var: ${managerVar}`)

	const originalLoad = Module._load
	Module._load = function (request, ...rest) {
		if (request === "vscode") return buildVscodeStub()
		return originalLoad.call(this, request, ...rest)
	}
	try {
		const require_ = createRequire(import.meta.url)
		const ext = require_(outFile)
		log("packaged bundle loaded. exports:", JSON.stringify(Object.keys(ext || {})))
	} finally {
		Module._load = originalLoad
	}
	const CommandJobManager = globalThis.__TCRR01_COMMAND_JOB_MANAGER__
	if (!check(!!CommandJobManager, "the packaged bundle published its CommandJobManager", globalThis.__TCRR01_SHIM_ERR__)) return

	// ---- 3. N1: transient descendant -> the packaged manager reconciles
	const n1 = await runScenario(CommandJobManager, "transient")
	check(n1.reconciliationEvents.length === 1, "N1: packaged manager emits exactly one command_job_containment_reconciled", n1)
	check(n1.reconciledState === "exited", "N1: reconciled state is the ORIGINAL terminal class", n1)
	check(n1.terminalStateAfter === "exited", "N1: canonical state returned to the original terminal class", n1)
	check(n1.terminalCommits === 0, "N1: no duplicate command_job_terminal_committed", n1)
	check(n1.containmentFailures === 1, "N1: exactly one ORIGINAL containment failure", n1)
	check(n1.activeAfter === 0, "N1: active-job cardinality unchanged at 0", n1)

	// ---- 4. N2: persistent descendant -> the packaged manager HOLDS
	const n2 = await runScenario(CommandJobManager, "persistent")
	check(n2.reconciliationEvents.length === 0, "N2: packaged manager NEVER reconciles a persistent descendant", n2)
	check(n2.terminalStateAfter === "containment_failed", "N2: the terminal state stays containment_failed", n2)
	check(n2.terminalCommits === 0, "N2: no terminal commit", n2)
	check(n2.containmentFailures === 1, "N2: the ORIGINAL containment failure is retained", n2)

	// ---- 5. summary ---------------------------------------------------
	console.log("\n[tcrr01-live] SUMMARY")
	console.log(`  N1 (transient):  ${JSON.stringify(n1)}`)
	console.log(`  N2 (persistent): ${JSON.stringify(n2)}`)
	if (failures.length > 0) {
		console.error(`\n[tcrr01-live] ${failures.length} CHECK(S) FAILED:`)
		for (const f of failures) console.error("  -", f)
		process.exit(1)
	}
	console.log("\n[tcrr01-live] ALL CHECKS PASSED")
}

/**
 * Drive the PACKAGED manager with a REAL child process.
 *
 * A real descendant is started in the shell's OWN process group, the
 * shell exits naturally, and the manager's synchronous finalization
 * probe observes the group as NOT gone. The descendant then exits, and
 * the manager's bounded late re-probe must observe `gone`.
 */
/**
 * A REAL `spawnFactory` for the packaged manager.
 *
 * The packaged bundle's default spawn path goes through the extension-host
 * supervisor, which needs the VS Code extension host to be alive. Since the
 * GUI cannot start on this substrate, this factory spawns a REAL detached
 * shell directly and exposes the SAME `SupervisableShellProcess` contract,
 * so the packaged manager's own finalize + reconciliation code runs
 * unchanged against a REAL kernel process group.
 */
function realSpawnFactory() {
	return (config = {}, _options = {}) => {
		const child = spawn(config.executable, config.args ?? [], {
			cwd: config.cwd,
			env: config.env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		})
		let stdout = ""
		let stderr = ""
		child.stdout?.on("data", (d) => {
			stdout += d.toString()
		})
		child.stderr?.on("data", (d) => {
			stderr += d.toString()
		})
		const exit = new Promise((resolve, reject) => {
			child.once("error", reject)
			child.once("exit", (code, signal) => resolve({ exitCode: code, signal }))
		})
		const pgid = child.pid
		return {
			exit,
			pid: child.pid,
			pgid,
			killTree: async () => {
				try {
					process.kill(-pgid, "SIGKILL")
				} catch {
					/* already gone */
				}
			},
			terminateTree: async () => {
				let treeTerminated = false
				try {
					process.kill(-pgid, "SIGTERM")
				} catch {
					/* already gone */
				}
				try {
					process.kill(-pgid, 0)
				} catch (e) {
					treeTerminated = e?.code === "ESRCH"
				}
				return { treeTerminated, escalatedToKill: false, epermDetected: false }
			},
			stdoutSnapshot: () => ({ text: stdout, totalChars: stdout.length, dropped: false }),
			stderrSnapshot: () => ({ text: stderr, totalChars: stderr.length, dropped: false }),
		}
	}
}

async function runScenario(CommandJobManager, kind) {
	const events = []
	const manager = new CommandJobManager({
		onCommandJobLifecycle: (e) => events.push(e),
		// Use the PACKAGED default probe (process.kill(-pgid, 0)) against
		// the REAL child process group.
		spawnFactory: realSpawnFactory(),
	})
	const descendantSeconds = kind === "transient" ? 1 : 30
	const command = `sleep ${descendantSeconds} & echo started; exit 0`
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcrr01-live-cwd-"))
	const res = await manager.start({
		command,
		cwd,
		waitBudgetMs: 100,
		executionDeadlineMs: 20_000,
	})
	const jobId = res.jobId
	log(
		`  [${kind}] start -> jobId=${jobId} state=${res.state} signal=${res.signal ?? "none"} stderr=${JSON.stringify(res.stderr ?? "")}`,
	)
	await res.terminalPromise
	log(`  [${kind}] terminal resolved; events so far: ${JSON.stringify(events.map((e) => e.event))}`)
	// Allow the bounded reconciliation schedule to run.
	await new Promise((r) => setTimeout(r, kind === "transient" ? 6000 : 8000))
	const statusResult = await manager.status({ jobId, waitMs: 0 })
	const snapshot = statusResult?.ok ? statusResult.snapshot : null
	const reconciliationEvents = events.filter((e) => e.event === "command_job_containment_reconciled")
	const activeAfter = manager.getActiveJobIds?.().length ?? 0
	manager.dispose()
	return {
		kind,
		jobId,
		terminalStateAfter: snapshot?.state,
		reconciledState: reconciliationEvents[0]?.reconciledState ?? null,
		reconciliationEvents: reconciliationEvents.map((e) => ({
			event: e.event,
			reconciledState: e.reconciledState,
			containmentFailed: e.containmentFailed,
			osErrorCode: e.osErrorCode,
			attempt: e.attempt,
		})),
		containmentFailures: events.filter((e) => e.event === "command_job_containment_failed").length,
		terminalCommits: events.filter((e) => e.event === "command_job_terminal_committed").length,
		activeAfter,
	}
}

main().catch((e) => {
	console.error("[tcrr01-live] FAILED:", e)
	process.exit(1)
})
