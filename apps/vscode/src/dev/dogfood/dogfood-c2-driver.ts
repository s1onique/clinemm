/**
 * DOGFOOD C2 DRIVER — ACT-only entrypoint for the real production
 * seatbelt matrix.
 *
 * C1-CORRECTION03 reviewer's recommendation: instead of adding a
 * VS Code command, gRPC surface, or settings UI (which would
 * require architectural work and are explicitly out-of-scope
 * per the DEFAULT_OFF contract), invoke this module via the
 * standard VS Code extension-test launch path:
 *
 *     code \
 *         --extensionDevelopmentPath=<committed tree> \
 *         --extensionTestsPath=./out/dev/dogfood/dogfood-c2-driver.js \
 *         <scratch/workspace>
 *
 * VS Code's extension-test runner (Extension Host) loads the
 * driver module, calls the exported `run()` function, and reports
 * success/failure based on the driver's exit signal.
 *
 * Production code path:
 *     runDogfood → inputs.createCommandJobManager → CommandJobManager
 *     → production default resolver → SeatbeltSandboxBackendExperimental
 *     → /usr/bin/sandbox-exec → kernel
 *
 * Evidence mode: REAL_PRODUCTION_SEAM / REAL_SEATBELT /
 * NOT_LIVE_INSTALLED_ARTIFACT (per C1-CORRECTION02).
 *
 * The driver writes machine-readable evidence into
 * `.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/`
 * and follows the documented VS Code test-runner failure contract:
 *   - run() resolves             => qualification succeeded
 *   - run() rejects (P0 halt)    => C2 failed (P0 invariant)
 *   - run() rejects (harness)    => C2 failed (uncaught error)
 *
 * The named `run` Promise is the authoritative signal; the
 * Extension Host's process-exit code is a redundant safety net.
 *
 * Expected CommandJobManager executions:
 *   31 logical probes + 3 extra CONTROL legs (W01, N01, C02)
 *   = 34 manager.start() calls
 *
 * The driver is gated by `DOGFOOD_C2_ENABLED=1` to prevent
 * accidental invocation during dev (no-op without env var).
 *
 * C1-CORRECTION04: the driver pre-creates the evidence and
 * scratch dirs before invoking runDogfood. `runDogfood` treats
 * a supplied `scratchDir` as caller-owned and writes the
 * readonly sentinel via `writeFileSync` immediately, so a
 * non-existent path produces ENOENT before B01 runs. Drivers
 * that rely on auto-creation were a deterministic P0.
 */
import { existsSync, mkdirSync } from "node:fs"
import { CommandJobManager } from "../../sdk/command-job-manager"
import { MANIFEST_VERSION } from "./seatbelt-dogfood-manifest"
import { computeManifestSha256, runDogfood, writeRunArtifacts } from "./seatbelt-dogfood-runner"

const EVIDENCE_DIR = ".factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01"

export async function run(): Promise<void> {
	if (process.env.DOGFOOD_C2_ENABLED !== "1") {
		console.log(
			"[dogfood-c2] DOGFOOD_C2_ENABLED!=1; driver is a no-op. " +
				"Set the env var to enable the real production seatbelt matrix.",
		)
		return
	}

	const workspaceRoots = [process.cwd()]
	const scratchDir = `${EVIDENCE_DIR}/scratch-${Date.now()}`

	// C1-CORRECTION04: pre-create the evidence dir and the
	// timestamped scratch subdir. `runDogfood` expects caller-owned
	// scratch; without this mkdir the run dies on ENOENT inside
	// `prepareKernelDenySentinel` before any probe executes.
	if (!existsSync(EVIDENCE_DIR)) {
		mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 })
	}
	if (!existsSync(scratchDir)) {
		mkdirSync(scratchDir, { recursive: true, mode: 0o700 })
	}

	console.log(
		`[dogfood-c2] starting REAL_PRODUCTION_SEAM matrix (manifest=${MANIFEST_VERSION}, sha256=${computeManifestSha256()})`,
	)
	console.log(`[dogfood-c2] workspaceRoots=${JSON.stringify(workspaceRoots)}`)
	console.log(`[dogfood-c2] scratchDir=${scratchDir}`)
	console.log("[dogfood-c2] expected 34 CommandJobManager.start() calls (31 logical + 3 CONTROL legs for W01/N01/C02)")

	try {
		const result = await runDogfood({
			// C1-CORRECTION02/CORRECTION03: factory is called with
			// (workspaceRoots, probeId). Production ignores the
			// probeId argument. The onProbeStart seam is omitted —
			// production code does not need it.
			createCommandJobManager: (roots) =>
				new CommandJobManager({
					experimentalSandboxWorkspaceRoots: roots,
				}),
			cwd: process.cwd(),
			sandboxOptIn: true,
			scratchDir,
		})

		await writeRunArtifacts(EVIDENCE_DIR, result)
		console.log(
			`[dogfood-c2] COMPLETE: ${result.summary.total} probes; ` +
				`p0Fail=${result.summary.p0Fail}; ` +
				`compatFail=${result.summary.compatibilityFail}; ` +
				`toolMissing=${result.summary.toolMissing}`,
		)

		// C1-CORRECTION04: P0 halt is a C2 failure. Reject the
		// run() promise so VS Code's test runner reports the
		// failure programmatically (resolved = pass; rejected = fail).
		if (result.summary.p0Fail > 0 || result.summary.p0Halted) {
			process.exitCode = 1
			throw new Error(`[dogfood-c2] P0 halt: p0Fail=${result.summary.p0Fail}, p0Halted=${result.summary.p0Halted}`)
		}
		process.exitCode = 0
		return
	} catch (err) {
		// C1-CORRECTION04: P0 halt (`DogfoodSecurityInvariantHalt`)
		// and harness errors are both failure modes. The
		// documented VS Code test-runner contract is to reject
		// the run() Promise on failure. We still write partial
		// evidence first so the halt point is recorded.
		if (err && typeof err === "object" && "summary" in err) {
			const haltErr = err as {
				summary: unknown
				results: unknown
				failingProbe: { id: string; classification: string }
			}
			console.error(`[dogfood-c2] HALT: ${haltErr.failingProbe.id} (${haltErr.failingProbe.classification})`)
			const haltResult = {
				summary: haltErr.summary,
				results: haltErr.results,
				policyMatrix: [],
				artifacts: [],
			} as Parameters<typeof writeRunArtifacts>[1]
			await writeRunArtifacts(EVIDENCE_DIR, haltResult)
			process.exitCode = 1
			throw err
		}
		console.error("[dogfood-c2] HARNESS ERROR:", err)
		process.exitCode = 2
		throw err
	}
}

// VS Code's extension-test runner expects a default export whose
// `run` is a Mocha-test-suite-compatible function OR a Promise.
// We export a `run()` Promise that resolves the test runner
// considers success (process.exitCode === 0).
export default { run }
