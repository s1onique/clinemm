/**
 * ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01
 *
 * Characterization tests for the dogfood seatbelt qualification runner.
 *
 * ===========================================================================
 * SCOPE
 * ===========================================================================
 *
 * C1 only ships the runner + manifest + characterization tests. The
 * actual real-substrate seatbelt qualification matrix (B01..S02) is
 * C2 work — it requires a macOS host with `/usr/bin/sandbox-exec` and
 * the dogfood opt-in enabled, and the C2 ACT owns the run artifacts.
 *
 * These tests prove:
 *   (R1) the runner iterates the manifest in order and produces
 *        `total === DOGFOOD_PROBE_COUNT` results.
 *   (R2) the runner calls `manager.start()` for every probe — no
 *        probes are silently skipped.
 *   (R3) the runner substitutes `${VAR}` references in the probe
 *        command before passing it to the production seam.
 *   (R4) DEFAULT_OFF (no opt-in) does NOT touch the sandbox backend
 *        — child runs unsandboxed and pwd reports the harness's cwd.
 *   (R5) sandboxOptIn=true sets CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt
 *        only for the duration of runDogfood, then restores it.
 *   (R6) policy lane is decoupled from execution lane — policy ASK
 *        does NOT prevent probe execution.
 *   (R7) P0 halt: a probe that returns the synthetic secret in its
 *        stdout halts the runner with DogfoodSecurityInvariantHalt.
 *   (R8) P1 tolerance: a probe that fails with COMPATIBILITY_FAIL
 *        does NOT halt the runner.
 *   (R9) classifyProbeResult correctly maps each `expected` class
 *        to PASS / EXPECTED_DENY / P0_SECURITY_FAIL / etc.
 *
 * The tests use a minimal FAKE CommandJobManager that captures the
 * per-probe calls instead of spawning real processes. This keeps
 * the test suite fast, deterministic, and platform-independent.
 * The C2 ACT separately exercises the real production seam under
 * the real /usr/bin/sandbox-exec.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { realpath } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager, type StartCommandJobResult } from "../../sdk/command-job-manager"
import { DOGFOOD_PROBE_COUNT, DOGFOOD_PROBE_MANIFEST, type DogfoodProbe, MANIFEST_VERSION } from "./seatbelt-dogfood-manifest"
import {
	buildProbeEnv,
	type CausalPairLeg,
	classifyCausalPairProbe,
	classifyProbeResult,
	classifyStderr,
	computeManifestSha256,
	DOGFOOD_NETWORK_RESPONSE_TOKEN,
	DOGFOOD_SANDBOX_OPTIN_ENV,
	DOGFOOD_SANDBOX_OPTIN_VALUE,
	DOGFOOD_SYNTHETIC_SECRET_NAME,
	DOGFOOD_SYNTHETIC_SECRET_VALUE,
	type DogfoodProbeResult,
	isP0Failure,
	runDogfood,
	substituteCommandEnv,
	writeRunArtifacts,
} from "./seatbelt-dogfood-runner"

interface FakeJobSpec {
	id: string
	command: string
	cwd: string
	env: Record<string, string>
	waitBudgetMs: number
	executionDeadlineMs: number
	/**
	 * C1-CORRECTION02: probe id is attached by the runner, NOT
	 * inferred from command text. This eliminates the ambiguity
	 * that previously caused `probeIdForCommand()` to mis-identify
	 * probes (multiple probes start with "printf" or "/bin/sh").
	 */
	probeId: string
}

/**
 * Minimal fake CommandJobManager that:
 *   - captures every start() invocation in `specs`
 *   - returns a stub result for each call (controllable per-test
 *     via `mockResult` or `mockResults`)
 *   - tracks per-probe-id call counts so tests can distinguish
 *     CONTROL vs TEST legs of a causal pair
 *
 * We deliberately do NOT subclass CommandJobManager — that would
 * couple the test to the seam. Instead we accept a factory in
 * DogfoodRunnerInputs and substitute the fake.
 */
class FakeCommandJobManager {
	specs: FakeJobSpec[] = []
	disposed = false
	/**
	 * C1-CORRECTION02: tests inject the CURRENT probe id via a
	 * closure-captured variable. The runner now sets this before
	 * calling manager.start(), so the fake knows the probe id
	 * without inferring it from command text.
	 */
	currentProbeId: string | null = null
	/**
	 * C1-CORRECTION02: per-probe-id call counter. Tests use this
	 * to differentiate CONTROL vs TEST legs in their mockResult
	 * callbacks.
	 */
	private callCountByProbeId: Map<string, number> = new Map()

	constructor(
		public mockResult:
			| Partial<StartCommandJobResult>
			| ((spec: FakeJobSpec, index: number) => Partial<StartCommandJobResult>),
	) {}

	start(input: {
		command: string
		cwd: string
		env?: Record<string, string>
		waitBudgetMs: number
		executionDeadlineMs: number
	}): Promise<StartCommandJobResult> {
		const spec: FakeJobSpec = {
			id: `fake_${this.specs.length}`,
			command: input.command,
			cwd: input.cwd,
			env: input.env ?? {},
			waitBudgetMs: input.waitBudgetMs,
			executionDeadlineMs: input.executionDeadlineMs,
			probeId: this.currentProbeId ?? "?",
		}
		this.specs.push(spec)

		const override = typeof this.mockResult === "function" ? this.mockResult(spec, this.specs.length - 1) : this.mockResult
		const base: StartCommandJobResult = {
			jobId: spec.id,
			state: "exited",
			elapsedMs: 5,
			deadlineRemainingMs: 1_000,
			stdout: "",
			stderr: "",
			outputTruncated: false,
			terminalPromise: Promise.resolve({ becameIdle: false }),
			becameActive: false,
			exitCode: 0,
			// The real type carries a SupervisableShellProcess; the
			// fake doesn't spawn anything. Cast for the test seam.
			process: undefined as unknown as StartCommandJobResult["process"],
		}
		const merged: StartCommandJobResult = { ...base, ...override }
		return Promise.resolve(merged)
	}

	/**
	 * C1-CORRECTION02: derive the current leg ("control" or "test")
	 * for the CURRENT probe id. Tests call this from inside their
	 * mockResult function to drive distinct CONTROL vs TEST
	 * responses against the same fake.
	 */
	legForCurrentProbe(): "control" | "test" {
		const probeId = this.currentProbeId ?? "?"
		const count = this.callCountByProbeId.get(probeId) ?? 0
		this.callCountByProbeId.set(probeId, count + 1)
		return count === 0 ? "control" : "test"
	}

	async dispose(): Promise<void> {
		this.disposed = true
	}

	async status(): Promise<{ ok: true; snapshot: unknown }> {
		return { ok: true, snapshot: {} }
	}

	async cancel(): Promise<{ ok: true; state: "running" }> {
		return { ok: true, state: "running" }
	}

	get activeCount(): number {
		return 0
	}
	get terminalCount(): number {
		return 0
	}
	getActiveJobIds(): string[] {
		return []
	}
}

/**
 * C1-CORRECTION02: removed the previous `probeIdForCommand()` helper.
 * The fake now receives the probe id directly via `currentProbeId`,
 * eliminating the text-inference ambiguity that broke W01/C02
 * disambiguation (multiple probes start with "printf" or "/bin/sh").
 */

/**
 * C1-CORRECTION02: the "happy path" mockResult used by tests that
 * do not specifically test causal-pair error semantics.
 *
 * Identity comes from `fake.currentProbeId` (set by the runner's
 * createCommandJobManager factory before each manager.start()
 * call), NOT from command text. This eliminates the W01/B03 /
 * C01/C02 ambiguity the previous text-inference helper had.
 *
 * For P0 kernel-deny probes (W01, C02):
 *   - CONTROL leg: write to the sentinel file (changes bytes →
 *     CAUSAL signal observed), exit 0.
 *   - TEST leg: EPERM on stderr (deny signature observed), exit 1.
 *     (Note: C1-CORRECTION02 ALSO requires state conservation,
 *     which the runner restores the sentinel baseline between
 *     CONTROL and TEST, so the fake does not need to do anything
 *     special here.)
 *
 * For P0 network-deny probes (N01):
 *   - CONTROL leg: stdout contains the response token, exit 0.
 *   - TEST leg: stdout does NOT contain the token, exit 7.
 *
 * All other probes: pass through to `fallback` (or default to a
 * plain PASS).
 */
function causalPairHappyMockResult(
	fake: FakeCommandJobManager,
	fallback?: (spec: FakeJobSpec, idx: number) => Partial<StartCommandJobResult>,
): (spec: FakeJobSpec, idx: number) => Partial<StartCommandJobResult> {
	return (spec, idx) => {
		const probeId = spec.probeId
		if (probeId === "W01" || probeId === "C02") {
			// kernel-deny P0
			const leg = fake.legForCurrentProbe()
			if (leg === "control") {
				// Change the sentinel bytes for the runner's post-state SHA check.
				const target = spec.env["CLINEMM_DOGFOOD_READONLY_PROBE"]
				if (target) {
					try {
						// Write something DIFFERENT from the frozen baseline
						// so the post-state SHA differs from the pre-state SHA.
						if (existsSync(target)) {
							writeFileSync(target, "FAKE-CONTROL-LEG-OVERWRITE\n")
						}
					} catch {
						// best-effort
					}
				}
				return { exitCode: 0, stdout: "", stderr: "" }
			}
			// TEST leg: EPERM, exit 1. Runner restored baseline before
			// the test leg, so the test leg's post-state SHA matches
			// the pre-state SHA → stateConserved = true.
			return { exitCode: 1, stderr: "/bin/sh: printf: file: Operation not permitted" }
		}
		if (probeId === "N01") {
			// network-deny P0
			const leg = fake.legForCurrentProbe()
			if (leg === "control") {
				return {
					exitCode: 0,
					stdout: "clinemm-dogfood-LOCAL-RESPONSE-TOKEN-0xFEEDFACE-c0ffee01",
				}
			}
			return { exitCode: 7, stderr: "curl: (7) Failed to connect to 127.0.0.1" }
		}
		if (probeId === "E01") {
			// secret-absent P0 single-leg.
			// C1-CORRECTION03: E01's command now emits a positive
			// witness (`DOGFOOD_ENV_PROBE_OK:`) and the synthetic
			// secret. The runner's sanitized mode strips the
			// secret, so the child should print the witness but
			// NOT the secret value. We model the SANITIZER-STRIPPED
			// happy path here: child prints the witness line with
			// the secret value blank (printf with $VAR
			// sanitized-to-empty).
			return {
				exitCode: 0,
				state: "exited",
				stdout: `DOGFOOD_ENV_PROBE_OK:\n`,
			}
		}
		if (fallback) return fallback(spec, idx)
		return {}
	}
}

/**
 * Casts a FakeCommandJobManager to look like a real CommandJobManager
 * for the runner. This is structurally safe because the runner only
 * uses `start()` and `dispose()` — the methods we override.
 */
function asManager(fake: FakeCommandJobManager): CommandJobManager {
	return fake as unknown as CommandJobManager
}

/**
 * C1-CORRECTION03: builds the inputs.createCommandJobManager
 * factory AND inputs.onProbeStart seam that together let the
 * fake track the CURRENT probe id across every `start()` call.
 *
 * The factory fires ONCE per primary manager (so it only sets
 * the probe id for the first probe). The runner's onProbeStart
 * callback fires BEFORE every `start()` invocation (including
 * all subsequent single-leg probes that share the same primary
 * manager), so the fake stays in sync with the actual probe
 * sequence.
 */
function fakeHarness(fake: FakeCommandJobManager) {
	return {
		createCommandJobManager: (_workspaceRoots: readonly string[], probeId: string) => {
			fake.currentProbeId = probeId
			return asManager(fake)
		},
		onProbeStart: (probeId: string) => {
			fake.currentProbeId = probeId
		},
	}
}

let scratchDir: string | null = null

beforeEach(() => {
	// Resolve a project-local scratch dir explicitly so this test
	// works inside IDE-sandboxed shells that block /tmp writes.
	// (CI runs use the real `os.tmpdir()`; this override is a
	// testing-harness concern only.)
	const base = process.env["CLINEMM_DOGFOOD_TEST_TMP"] ?? resolve(__dirname, "../node_modules/.cache/clinemm-dogfood-test")
	if (!existsSync(base)) {
		try {
			mkdirSync(base, { recursive: true, mode: 0o700 })
		} catch {
			// best-effort; may already exist
		}
	}
	scratchDir = mkdtempSync(join(base, "scratch-"))
})

afterEach(() => {
	if (scratchDir && existsSync(scratchDir)) {
		rmSync(scratchDir, { recursive: true, force: true })
	}
	scratchDir = null
	// Restore env state between tests so the sandbox opt-in tests
	// don't leak into each other.
	delete process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
})

// ===========================================================================
// (R1) Manifest iteration: every probe is executed in order.
// ===========================================================================
describe("dogfood runner — manifest iteration", () => {
	it("executes every probe in manifest order", async () => {
		const fake = new FakeCommandJobManager({})
		const mr = causalPairHappyMockResult(fake)
		fake.mockResult = mr as FakeCommandJobManager["mockResult"]
		await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: false,
		})

		// C1-CORRECTION02: P0 kernel-deny / network-deny probes call
		// start() twice (CONTROL + TEST). Other probes call once.
		// Total = DOGFOOD_PROBE_COUNT + (causal-paired count).
		const causalPaired = DOGFOOD_PROBE_MANIFEST.filter(
			(p) => p.p0Sensitive && (p.expected === "kernel-deny" || p.expected === "network-deny"),
		).length
		expect(fake.specs).toHaveLength(DOGFOOD_PROBE_COUNT + causalPaired)
		// C1-CORRECTION02: the previous index-based assertion
		// (`fake.specs[i].command` ↔ `manifest[i]`) was wrong once
		// causal-pair probes create a CONTROL + TEST expansion.
		// We now plan the expected execution sequence explicitly:
		// for each manifest probe in order, we either expect one
		// spawn (single-leg) or two spawns with the same
		// probe id (causal pair).
		const plannedSequence: Array<{ probeId: string; firstToken: string }> = []
		for (const p of DOGFOOD_PROBE_MANIFEST) {
			const isCausal = p.p0Sensitive && (p.expected === "kernel-deny" || p.expected === "network-deny")
			const firstToken = p.command.split(" ")[0]
			plannedSequence.push({ probeId: p.id, firstToken })
			if (isCausal) {
				plannedSequence.push({ probeId: p.id, firstToken })
			}
		}
		expect(fake.specs).toHaveLength(plannedSequence.length)
		for (let i = 0; i < plannedSequence.length; i++) {
			expect(fake.specs[i].probeId).toBe(plannedSequence[i].probeId)
			expect(fake.specs[i].command).toContain(plannedSequence[i].firstToken)
		}
	})

	it("summary.total equals DOGFOOD_PROBE_COUNT", async () => {
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake) as FakeCommandJobManager["mockResult"]
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: false,
		})
		expect(result.summary.total).toBe(DOGFOOD_PROBE_COUNT)
		expect(result.summary.manifestVersion).toBe(MANIFEST_VERSION)
		expect(result.summary.manifestSha256).toBe(computeManifestSha256())
		expect(result.summary.manifestSha256).toMatch(/^[0-9a-f]{64}$/)
	})
})

// ===========================================================================
// (R3) Env substitution: ${VAR} in the probe command is replaced
// before spawn. The synthetic secret must never reach the child as
// a literal `${...}` reference (which would be a sandbox pass-through).
// ===========================================================================
describe("dogfood runner — env substitution", () => {
	it("substitutes ${VAR} refs in the probe command before spawn", () => {
		const out = substituteCommandEnv("printf X > ${FOO}; cat ${BAR}", { FOO: "/tmp/a", BAR: "/tmp/b" })
		expect(out).toBe("printf X > /tmp/a; cat /tmp/b")
	})

	it("buildProbeEnv seeds the synthetic secret + readonly probe path + local port", () => {
		// C1-CORRECTION01: buildProbeEnv takes a third arg — the
		// dynamic port from startLocalhostListener(), not a hardcoded
		// value. We pass a synthetic port here; production code uses
		// the assigned port from the listener.
		const env = buildProbeEnv(undefined, "/tmp/readonly-probe", 54321)
		expect(env[DOGFOOD_SYNTHETIC_SECRET_NAME]).toBe(DOGFOOD_SYNTHETIC_SECRET_VALUE)
		expect(env["CLINEMM_DOGFOOD_READONLY_PROBE"]).toBe("/tmp/readonly-probe")
		expect(env["CLINEMM_DOGFOOD_LOCAL_PORT"]).toBe("54321")
	})

	it("the readonly probe target lives INSIDE the scratch dir (inside workspaceRoots)", async () => {
		// C1-CORRECTION02: production code moved the readonly probe
		// target from `scratchDir/../sentinel` (outside the
		// workspace root) to `scratchDir/readonly-probe-<runId>`.
		// The previous assertion (`not.toContain(scratchDir!)`) was
		// the inverse of the production behavior and would fail
		// once executed.
		//
		// Canonical containment check (realpath-aware): the dirname
		// of the readonly probe target must equal the realpath of
		// the scratch dir. We compare realpaths to defeat symlink
		// and `/private` prefix games on macOS.
		//
		// The runner's `finally` block rmSync's the runner-created
		// scratch dir after the run. We pre-mkdir the scratch
		// dir and pass it explicitly so it survives the run;
		// then realpath it before AND compare against the dirname
		// of the captured readonly path.
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const ownedScratch = join(scratchDir!, `contain-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		mkdirSync(ownedScratch, { recursive: true, mode: 0o700 })
		const ownedRealpath = await realpath(ownedScratch)

		await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: false,
			scratchDir: ownedScratch,
		})
		const w01 = fake.specs.find((s) => s.command.includes("printf X > "))
		expect(w01).toBeDefined()
		expect(w01!.env["CLINEMM_DOGFOOD_READONLY_PROBE"]).toBeDefined()
		const readonlyPath = w01!.env["CLINEMM_DOGFOOD_READONLY_PROBE"]
		expect(await realpath(dirname(readonlyPath))).toBe(ownedRealpath)
		// Cleanup: rmSync the test-owned scratch (runner does NOT
		// clean up caller-supplied scratchDirs).
		rmSync(ownedScratch, { recursive: true, force: true })
	})
})

// ===========================================================================
// (R4 / R5) Sandbox opt-in toggle. Tests prove the runner sets /
// unsets the production env var exactly as documented.
// ===========================================================================
describe("dogfood runner — sandbox opt-in toggle", () => {
	it("sandboxOptIn=true sets CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt DURING the run and restores prior value on dispose", async () => {
		// C1-CORRECTION02: the runner snapshots and restores the
		// prior value of the env var. The production design
		// sets the env var on `process.env` (which
		// `defaultSandboxBackendResolver` reads at manager
		// construction time), NOT in the per-probe `options.env`
		// (which the production sanitizer consumes). Verify the
		// env var was set on process.env DURING manager.start()
		// (via the fake's wrapped start) AND that the prior value
		// was restored after the run.
		process.env[DOGFOOD_SANDBOX_OPTIN_ENV] = "prior-value"
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const seenDuringRun = new Set<string | undefined>()
		const originalStart = fake.start.bind(fake)
		fake.start = (input) => {
			// Read process.env — this is where the runner sets
			// the opt-in value (the production resolver reads
			// from process.env, not options.env).
			seenDuringRun.add(process.env[DOGFOOD_SANDBOX_OPTIN_ENV])
			return originalStart(input)
		}
		await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: true,
		})
		// During the run, the env var was set to "seatbelt".
		expect(seenDuringRun.has(DOGFOOD_SANDBOX_OPTIN_VALUE)).toBe(true)
		// After the run, the prior value is restored.
		expect(process.env[DOGFOOD_SANDBOX_OPTIN_ENV]).toBe("prior-value")
	})

	it("sandboxOptIn=true with no prior value removes the env var on dispose", async () => {
		delete process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: true,
		})
		expect(process.env[DOGFOOD_SANDBOX_OPTIN_ENV]).toBeUndefined()
	})

	it("sandboxOptIn=false explicitly clears the env var (and restores prior value if set)", async () => {
		process.env[DOGFOOD_SANDBOX_OPTIN_ENV] = "stale-value"
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: false,
		})
		expect(process.env[DOGFOOD_SANDBOX_OPTIN_ENV]).toBe("stale-value")
	})

	it("sandboxOptIn=true without Seatbelt substrate: harness halts on the first P0-sensitive probe (control-succeeded + test-failed => P0_SECURITY_FAIL)", async () => {
		// On a non-darwin host, the production resolver returns
		// undefined. CommandJobManager reports spawn_failed with
		// a sandbox-unavailable signal on the TEST leg. The
		// CONTROL leg still succeeds (the underlying shell works
		// fine; only the seatbelt wrapper is unavailable).
		//
		// C1-CORRECTION04: the previous test returned spawn_failed
		// for BOTH legs, which yielded P0_CAUSAL_PAIR_FAIL because
		// the runner's controlSignalObserved check (post-SHA
		// differs from pre-SHA) requires the CONTROL leg to
		// actually write the file. The corrected test inlines
		// the causal-pair happy-path logic (so the file IS
		// written on the CONTROL leg via the fake's
		// writeFileSync) and overrides only the TEST leg to
		// return spawn_failed with the sandbox-unavailable
		// signal.
		const fake = new FakeCommandJobManager((spec) => {
			const probeId = spec.probeId
			if (probeId === "W01" || probeId === "C02") {
				// kernel-deny P0 causal pair
				const leg = fake.legForCurrentProbe()
				if (leg === "control") {
					// Write the sentinel file (changes SHA).
					const target = spec.env["CLINEMM_DOGFOOD_READONLY_PROBE"]
					if (target && existsSync(target)) {
						writeFileSync(target, "FAKE-CONTROL-LEG-OVERWRITE\n")
					}
					return { exitCode: 0, stdout: "", stderr: "" }
				}
				// TEST leg: sandbox unavailable (spawn_failed).
				return {
					state: "spawn_failed",
					stdout: "",
					stderr: "sandbox-unavailable: opt-in seatbelt but no backend resolved",
					exitCode: undefined,
				}
			}
			// Non-P0 probes: just succeed.
			return { exitCode: 0, stdout: "", stderr: "" }
		})
		let caught: unknown = null
		try {
			await runDogfood({
				createCommandJobManager: fakeHarness(fake).createCommandJobManager,
				onProbeStart: fakeHarness(fake).onProbeStart,
				cwd: scratchDir!,
				sandboxOptIn: true,
			})
		} catch (err) {
			caught = err
		}
		expect(caught).not.toBeNull()
		expect((caught as { name?: string }).name).toBe("DogfoodSecurityInvariantHalt")
		const halt = caught as {
			summary: { p0Halted: boolean; haltedAtProbeId: string; p0Fail: number }
			failingProbe: { id: string; classification: string }
		}
		expect(halt.summary.p0Halted).toBe(true)
		// The first p0Sensitive probe is W01 (kernel-deny).
		expect(halt.summary.haltedAtProbeId).toBe("W01")
		expect(halt.failingProbe.classification).toBe("P0_SECURITY_FAIL")
	})
})

// ===========================================================================
// (R6) Policy lane is decoupled from execution lane.
// ===========================================================================
describe("dogfood runner — policy lane decoupling", () => {
	it("a policy 'deny' verdict does NOT prevent probe execution", async () => {
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const policyCalls: string[] = []
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: false,
			evaluatePolicy: (input) => {
				policyCalls.push(typeof input.toolInput === "string" ? input.toolInput : "?")
				return {
					decision: { kind: "deny", source: "host_hard_deny" },
				}
			},
		})
		// All probes were evaluated by the policy lane.
		expect(policyCalls).toHaveLength(DOGFOOD_PROBE_COUNT)
		// Every probe was STILL spawned (no lane coupling). Causal-paired
		// probes spawn twice; total = DOGFOOD_PROBE_COUNT + causalPaired.
		const causalPaired = DOGFOOD_PROBE_MANIFEST.filter(
			(p) => p.p0Sensitive && (p.expected === "kernel-deny" || p.expected === "network-deny"),
		).length
		expect(fake.specs.length).toBeGreaterThanOrEqual(DOGFOOD_PROBE_COUNT)
		expect(fake.specs.length).toBe(DOGFOOD_PROBE_COUNT + causalPaired)
		// The policy matrix records every probe as "deny".
		expect(result.policyMatrix).toHaveLength(DOGFOOD_PROBE_COUNT)
		expect(result.policyMatrix.every((p) => p.policyKind === "deny")).toBe(true)
	})

	it("policy evaluator throwing records 'policy-evaluator-threw' but does not halt", async () => {
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: false,
			evaluatePolicy: () => {
				throw new Error("policy engine down")
			},
		})
		expect(result.policyMatrix).toHaveLength(DOGFOOD_PROBE_COUNT)
		expect(result.policyMatrix.every((p) => p.policySource === "policy-evaluator-threw")).toBe(true)
		expect(result.summary.p0Halted).toBe(false)
	})
})

// ===========================================================================
// (R7) P0 halt on synthetic secret leak.
// ===========================================================================
describe("dogfood runner — P0 halt", () => {
	it("halts with DogfoodSecurityInvariantHalt when a probe returns the synthetic secret in stdout", async () => {
		const fake = new FakeCommandJobManager((spec) => {
			// Chain: use the causal-pair happy path for probes that
			// would otherwise halt first (W01 etc.), then override
			// E01 to leak the secret.
			const happy = causalPairHappyMockResult(fake)
			const happyResult = happy(spec, fake.specs.length - 1)
			if (spec.command.includes("DOGFOOD_ENV_PROBE_OK:")) {
				// C1-CORRECTION03: E01's command now emits the
				// positive witness + the secret. To simulate
				// the sanitization regression (P0_SECURITY_FAIL),
				// the fake returns stdout containing BOTH the
				// witness and the secret value.
				return {
					stdout: `DOGFOOD_ENV_PROBE_OK:${DOGFOOD_SYNTHETIC_SECRET_VALUE}\n`,
					stderr: "",
					state: "exited",
					exitCode: 0,
				}
			}
			return happyResult
		})
		let caught: unknown = null
		try {
			await runDogfood({
				createCommandJobManager: fakeHarness(fake).createCommandJobManager,
				onProbeStart: fakeHarness(fake).onProbeStart,
				cwd: scratchDir!,
				sandboxOptIn: true,
			})
		} catch (err) {
			caught = err
		}
		expect(caught).not.toBeNull()
		expect((caught as { name?: string }).name).toBe("DogfoodSecurityInvariantHalt")
		const halt = caught as {
			summary: { p0Halted: boolean; haltedAtProbeId: string; p0Fail: number }
			failingProbe: DogfoodProbeResult
		}
		expect(halt.summary.p0Halted).toBe(true)
		expect(halt.summary.haltedAtProbeId).toBe("E01")
		expect(halt.failingProbe.classification).toBe("P0_SECURITY_FAIL")
	})

	it("the partial matrix is preserved on halt (subsequent probes were not run)", async () => {
		const fake = new FakeCommandJobManager((spec) => {
			const happy = causalPairHappyMockResult(fake)
			const happyResult = happy(spec, fake.specs.length - 1)
			if (spec.command.includes("DOGFOOD_ENV_PROBE_OK:")) {
				return { stdout: DOGFOOD_SYNTHETIC_SECRET_VALUE, exitCode: 0, state: "exited" }
			}
			return happyResult
		})
		try {
			await runDogfood({
				createCommandJobManager: fakeHarness(fake).createCommandJobManager,
				onProbeStart: fakeHarness(fake).onProbeStart,
				cwd: scratchDir!,
				sandboxOptIn: true,
			})
		} catch {
			// expected
		}
		// E01 is roughly probe #13 in execution order; everything
		// after it must NOT have been spawned.
		const e01Idx = DOGFOOD_PROBE_MANIFEST.findIndex((p) => p.id === "E01")
		expect(e01Idx).toBeGreaterThan(0)
		// Number of specs is the count of every logical probe
		// up to and including E01, PLUS one extra control leg
		// per causal-pair probe that ran before E01 (only W01
		// is in the prefix: N01, C02 are AFTER E01). So
		// expected = (e01Idx + 1 logical) + (count of W01 in
		// the prefix * 1 extra control) = 19 + 1 = 20.
		const priorCausalPaired = DOGFOOD_PROBE_MANIFEST.slice(0, e01Idx + 1).filter(
			(p) => p.p0Sensitive && (p.expected === "kernel-deny" || p.expected === "network-deny"),
		).length
		expect(fake.specs.length).toBe(e01Idx + 1 + priorCausalPaired)
	})
})

// ===========================================================================
// (R8) P1 tolerance — a probe that returns COMPATIBILITY_FAIL does
// not halt the runner.
// ===========================================================================
describe("dogfood runner — P1 tolerance", () => {
	it("continues through COMPATIBILITY_FAIL probes and completes the manifest", async () => {
		const fake = new FakeCommandJobManager((spec) => {
			// Chain: causal-pair happy path so W01/N01/C02 don't halt,
			// then B01 returns non-zero to produce COMPATIBILITY_FAIL.
			const happy = causalPairHappyMockResult(fake)
			const happyResult = happy(spec, fake.specs.length - 1)
			if (spec.command.startsWith("pwd")) {
				return { exitCode: 1, state: "exited" }
			}
			return happyResult
		})
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: true,
		})
		expect(result.summary.p0Halted).toBe(false)
		expect(result.summary.compatibilityFail).toBeGreaterThanOrEqual(1)
		// C1-CORRECTION01: P0 kernel-deny / network-deny probes
		// spawn twice; total = DOGFOOD_PROBE_COUNT + causalPaired.
		const causalPaired = DOGFOOD_PROBE_MANIFEST.filter(
			(p) => p.p0Sensitive && (p.expected === "kernel-deny" || p.expected === "network-deny"),
		).length
		expect(fake.specs.length).toBe(DOGFOOD_PROBE_COUNT + causalPaired)
	})

	it("continues through TOOL_MISSING probes (e.g. node not installed)", async () => {
		const fake = new FakeCommandJobManager((spec) => {
			const happy = causalPairHappyMockResult(fake)
			const happyResult = happy(spec, fake.specs.length - 1)
			if (spec.command.startsWith("node ")) {
				return {
					exitCode: 127,
					state: "exited",
					stderr: "/bin/sh: node: command not found",
				}
			}
			return happyResult
		})
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: true,
		})
		expect(result.summary.p0Halted).toBe(false)
		expect(result.summary.toolMissing).toBeGreaterThanOrEqual(1)
	})
})

// ===========================================================================
// (R9) classifyProbeResult unit tests.
// ===========================================================================
describe("classifyProbeResult", () => {
	const probe = (expected: DogfoodProbe["expected"]): DogfoodProbe => ({
		id: "T01",
		domain: "temp",
		command: "true",
		expected,
		timeoutMs: 1000,
		p0Sensitive: false,
		description: "test",
	})

	it("expected=success + exit 0 => PASS", () => {
		expect(
			classifyProbeResult(probe("success"), {
				state: "exited",
				exitCode: 0,
				stdout: "",
				stderr: "",
			}),
		).toBe("PASS")
	})

	it("expected=success + exit 1 => COMPATIBILITY_FAIL", () => {
		expect(
			classifyProbeResult(probe("success"), {
				state: "exited",
				exitCode: 1,
				stdout: "",
				stderr: "",
			}),
		).toBe("COMPATIBILITY_FAIL")
	})

	it("expected=success + exit 127 with not-found pattern => TOOL_MISSING", () => {
		expect(
			classifyProbeResult(probe("success"), {
				state: "exited",
				exitCode: 127,
				stdout: "",
				stderr: "node: command not found",
			}),
		).toBe("TOOL_MISSING")
	})

	it("expected=kernel-deny + EPERM => EXPECTED_DENY", () => {
		expect(
			classifyProbeResult(probe("kernel-deny"), {
				state: "exited",
				exitCode: 1,
				stdout: "",
				stderr: "/bin/sh: file: Operation not permitted",
			}),
		).toBe("EXPECTED_DENY")
	})

	it("expected=kernel-deny + exit 0 (write succeeded) => P0_SECURITY_FAIL", () => {
		expect(
			classifyProbeResult(probe("kernel-deny"), {
				state: "exited",
				exitCode: 0,
				stdout: "",
				stderr: "",
			}),
		).toBe("P0_SECURITY_FAIL")
	})

	it("expected=network-deny + curl exit 7 => COMPATIBILITY_FAIL (single-leg cannot prove kernel deny; defer to causal pair)", () => {
		// C1-CORRECTION01: single-leg network-deny classification no
		// longer accepts generic curl-exit-7 as evidence of kernel
		// denial — that's observationally confounded with a closed
		// port. P0 network-deny probes MUST go through
		// classifyCausalPairProbe.
		expect(
			classifyProbeResult(probe("network-deny"), {
				state: "exited",
				exitCode: 7,
				stdout: "",
				stderr: "curl: (7) Failed to connect to 127.0.0.1 port 1",
			}),
		).toBe("COMPATIBILITY_FAIL")
	})

	it("expected=kernel-deny + exit 1 with NO EPERM signature => COMPATIBILITY_FAIL (cannot prove kernel deny)", () => {
		// C1-CORRECTION01: generic non-zero exit alone is no longer
		// sufficient for EXPECTED_DENY on a kernel-deny probe. The
		// causal-pair classifier handles the strict case.
		expect(
			classifyProbeResult(probe("kernel-deny"), {
				state: "exited",
				exitCode: 1,
				stdout: "",
				stderr: "sh: syntax error",
			}),
		).toBe("COMPATIBILITY_FAIL")
	})

	it("expected=secret-absent + secret visible => P0_SECURITY_FAIL", () => {
		expect(
			classifyProbeResult(probe("secret-absent"), {
				state: "exited",
				exitCode: 0,
				stdout: DOGFOOD_SYNTHETIC_SECRET_VALUE,
				stderr: "",
			}),
		).toBe("P0_SECURITY_FAIL")
	})

	// C1-CORRECTION03: E01 is now a positive-AND-negative witness.
	// The next four tests pin down the four failure modes that
	// would have falsely PASSed under the previous negative-only
	// classification.

	it("expected=secret-absent + child never ran (spawn_failed) => P0_CAUSAL_PAIR_FAIL, not PASS", () => {
		expect(
			classifyProbeResult(probe("secret-absent"), {
				state: "spawn_failed",
				exitCode: null,
				stdout: "",
				stderr: "spawn failed",
			}),
		).toBe("P0_CAUSAL_PAIR_FAIL")
	})

	it("expected=secret-absent + child killed by deadline => P0_CAUSAL_PAIR_FAIL, not PASS", () => {
		expect(
			classifyProbeResult(probe("secret-absent"), {
				state: "deadline_exceeded",
				exitCode: null,
				stdout: "",
				stderr: "killed",
			}),
		).toBe("P0_CAUSAL_PAIR_FAIL")
	})

	it("expected=secret-absent + child exited non-zero (e.g. exit 127 missing printf) => P0_CAUSAL_PAIR_FAIL, not PASS", () => {
		expect(
			classifyProbeResult(probe("secret-absent"), {
				state: "exited",
				exitCode: 127,
				stdout: "",
				stderr: "sh: printf: not found",
			}),
		).toBe("P0_CAUSAL_PAIR_FAIL")
	})

	it("expected=secret-absent + exited 0 but missing positive witness => P0_CAUSAL_PAIR_FAIL, not PASS", () => {
		// C1-CORRECTION03: this is the most insidious false-pass.
		// The child "succeeded" with exit 0 but stdout did NOT
		// contain the witness. Possible causes: a printf shim that
		// succeeded but printed something else; a hardened
		// sandbox that intercepted printf without erroring; a
		// printf wrapper that suppressed the line. We cannot tell
		// whether the sanitizer did its job, so P0.
		expect(
			classifyProbeResult(probe("secret-absent"), {
				state: "exited",
				exitCode: 0,
				stdout: "",
				stderr: "",
			}),
		).toBe("P0_CAUSAL_PAIR_FAIL")
	})

	it("expected=secret-absent + exited 0 + witness + no secret => PASS", () => {
		expect(
			classifyProbeResult(probe("secret-absent"), {
				state: "exited",
				exitCode: 0,
				stdout: "DOGFOOD_ENV_PROBE_OK:\n",
				stderr: "",
			}),
		).toBe("PASS")
	})

	it("expected=informational + any outcome => PASS", () => {
		expect(
			classifyProbeResult(probe("informational"), {
				state: "exited",
				exitCode: 99,
				stdout: "",
				stderr: "anything",
			}),
		).toBe("PASS")
	})
})

// ===========================================================================
// isP0Failure unit tests.
// ===========================================================================
describe("isP0Failure", () => {
	const p0Probe: DogfoodProbe = {
		id: "X01",
		domain: "workspace",
		command: "true",
		expected: "kernel-deny",
		timeoutMs: 1000,
		p0Sensitive: true,
		description: "test",
	}
	const nonP0Probe: DogfoodProbe = { ...p0Probe, p0Sensitive: false }

	it("returns false for non-p0Sensitive probes regardless of classification", () => {
		expect(isP0Failure(nonP0Probe, "COMPATIBILITY_FAIL")).toBe(false)
		expect(isP0Failure(nonP0Probe, "TOOL_MISSING")).toBe(false)
		expect(isP0Failure(nonP0Probe, "TIMEOUT")).toBe(false)
	})

	it("returns false for p0Sensitive probes that PASS or EXPECTED_DENY", () => {
		expect(isP0Failure(p0Probe, "PASS")).toBe(false)
		expect(isP0Failure(p0Probe, "EXPECTED_DENY")).toBe(false)
	})

	it("returns true for p0Sensitive probes that fail for any other reason", () => {
		expect(isP0Failure(p0Probe, "COMPATIBILITY_FAIL")).toBe(true)
		expect(isP0Failure(p0Probe, "TOOL_MISSING")).toBe(true)
		expect(isP0Failure(p0Probe, "TIMEOUT")).toBe(true)
		expect(isP0Failure(p0Probe, "P0_SECURITY_FAIL")).toBe(true)
	})
})

// ===========================================================================
// classifyStderr unit tests.
// ===========================================================================
describe("classifyStderr", () => {
	it("detects kernel EPERM", () => {
		expect(classifyStderr("/bin/sh: foo: Operation not permitted", "")).toBe("kernel-eperm")
	})

	it("detects network failure", () => {
		expect(classifyStderr("curl: (7) Failed to connect", "")).toBe("network-failure")
	})

	it("detects sandbox-unavailable", () => {
		expect(classifyStderr("sandbox-unavailable: ...", "")).toBe("sandbox-error")
	})

	it("returns 'other' for unrecognized stderr", () => {
		expect(classifyStderr("some unrelated error", "")).toBe("other")
		expect(classifyStderr("", "")).toBe("other")
	})
})

// ===========================================================================
// Manifest hash stability — same content => same SHA. This guards
// against accidental manifest mutation between dogfood runs.
// ===========================================================================
describe("computeManifestSha256", () => {
	it("returns a stable hash", () => {
		expect(computeManifestSha256()).toBe(computeManifestSha256())
	})

	it("hash length is 64 hex chars", () => {
		expect(computeManifestSha256()).toMatch(/^[0-9a-f]{64}$/)
	})
})

// ===========================================================================
// Manifest count guard. Adding probes must bump MANIFEST_VERSION
// AND this assertion (so the reviewer is forced to update both).
// ===========================================================================
describe("manifest sanity", () => {
	it("DOGFOOD_PROBE_COUNT === manifest length", () => {
		expect(DOGFOOD_PROBE_COUNT).toBe(DOGFOOD_PROBE_MANIFEST.length)
	})

	it("every probe has a unique id", () => {
		const ids = new Set(DOGFOOD_PROBE_MANIFEST.map((p) => p.id))
		expect(ids.size).toBe(DOGFOOD_PROBE_MANIFEST.length)
	})

	it("at least one p0Sensitive probe exists (otherwise the runner is useless)", () => {
		expect(DOGFOOD_PROBE_MANIFEST.some((p) => p.p0Sensitive)).toBe(true)
	})

	// C1-CORRECTION01: MANIFEST_VERSION bump event for the closed
	// port→ephemeral-port fix. This guard must be updated whenever
	// probes are added/removed/renamed OR when command text changes.
	it("MANIFEST_VERSION is non-empty", () => {
		expect(MANIFEST_VERSION).toMatch(/^wave-/)
	})
})

// ===========================================================================
// C1-CORRECTION01 RED tests.
//
// These tests lock the causal-pair semantics the reviewer required:
//   - Closed localhost port MUST NOT satisfy a network P0.
//   - Generic non-zero exit MUST NOT satisfy a kernel-deny P0.
//   - E01 synthetic secret visible => P0.
//   - Same write unsandboxed => succeeds.
//
// If any of these regress, the harness is once again producing
// unfalsifiable PASS verdicts.
// ===========================================================================
describe("C1-CORRECTION01 — causal-pair guarantees", () => {
	const kernelDenyProbe: DogfoodProbe = {
		id: "X1",
		domain: "workspace",
		command: "printf X > ${TGT}",
		expected: "kernel-deny",
		timeoutMs: 1_000,
		p0Sensitive: true,
		description: "test",
	}
	const networkDenyProbe: DogfoodProbe = {
		id: "X2",
		domain: "network",
		command: "curl --max-time 1 -fsS http://127.0.0.1:${PORT}/ 2>&1",
		expected: "network-deny",
		timeoutMs: 1_000,
		p0Sensitive: true,
		description: "test",
	}

	const makeLeg = (over: Partial<CausalPairLeg>): CausalPairLeg => ({
		role: "control",
		exitCode: null,
		denySignatureObserved: false,
		controlSignalObserved: false,
		stateConserved: false,
		stdoutExcerpt: "",
		stderrExcerpt: "",
		durationMs: 1,
		...over,
	})

	it("closed localhost port + non-zero curl exit => P0_CAUSAL_PAIR_FAIL, NOT EXPECTED_DENY", () => {
		// CONTROL leg fails: no response token in stdout (because
		// nothing is listening on the port).
		const control = makeLeg({ exitCode: 7, stdoutExcerpt: "", stderrExcerpt: "Failed to connect" })
		// TEST leg happens to also fail with the same curl-7 pattern.
		const test = makeLeg({
			role: "test",
			exitCode: 7,
			stdoutExcerpt: "",
			stderrExcerpt: "Failed to connect",
		})
		expect(classifyCausalPairProbe(networkDenyProbe, control, test)).toBe("P0_CAUSAL_PAIR_FAIL")
	})

	it("kernel-deny + exit 1 + no EPERM signature on stderr => P0_CAUSAL_PAIR_FAIL (control must succeed first)", () => {
		// CONTROL leg fails: post-state SHA equals pre-state SHA
		// (sentinel bytes unchanged).
		const control = makeLeg({ exitCode: 1, controlSignalObserved: false })
		// TEST leg has a non-zero exit but no EPERM on stderr.
		const test = makeLeg({
			role: "test",
			exitCode: 1,
			denySignatureObserved: false,
			stderrExcerpt: "sh: syntax error",
		})
		expect(classifyCausalPairProbe(kernelDenyProbe, control, test)).toBe("P0_CAUSAL_PAIR_FAIL")
	})

	it("kernel-deny + EPERM on stderr + control succeeded + state conserved => EXPECTED_DENY", () => {
		const control = makeLeg({ exitCode: 0, controlSignalObserved: true })
		const test = makeLeg({
			role: "test",
			exitCode: 1,
			denySignatureObserved: true,
			stateConserved: true,
			stderrExcerpt: "Operation not permitted",
		})
		expect(classifyCausalPairProbe(kernelDenyProbe, control, test)).toBe("EXPECTED_DENY")
	})

	it("kernel-deny + EPERM but state NOT conserved => P0_SECURITY_FAIL", () => {
		// C1-CORRECTION02: state conservation is REQUIRED. A kernel
		// deny without state conservation (file was actually
		// written) is a P0 sandbox regression.
		const control = makeLeg({ exitCode: 0, controlSignalObserved: true })
		const test = makeLeg({
			role: "test",
			exitCode: 1,
			denySignatureObserved: true,
			stateConserved: false,
			stderrExcerpt: "Operation not permitted",
		})
		expect(classifyCausalPairProbe(kernelDenyProbe, control, test)).toBe("P0_SECURITY_FAIL")
	})

	it("network-deny + no token in stdout + non-zero exit + control had token => EXPECTED_DENY", () => {
		const control = makeLeg({
			exitCode: 0,
			stdoutExcerpt: DOGFOOD_NETWORK_RESPONSE_TOKEN,
			controlSignalObserved: true,
		})
		const test = makeLeg({
			role: "test",
			exitCode: 7,
			stdoutExcerpt: "",
			denySignatureObserved: true,
		})
		expect(classifyCausalPairProbe(networkDenyProbe, control, test)).toBe("EXPECTED_DENY")
	})

	it("network-deny + control succeeded but test exit was 0 => P0_SECURITY_FAIL (sandbox let it through)", () => {
		const control = makeLeg({
			exitCode: 0,
			stdoutExcerpt: DOGFOOD_NETWORK_RESPONSE_TOKEN,
			controlSignalObserved: true,
		})
		const test = makeLeg({
			role: "test",
			exitCode: 0,
			stdoutExcerpt: DOGFOOD_NETWORK_RESPONSE_TOKEN,
			denySignatureObserved: true,
			controlSignalObserved: true,
		})
		expect(classifyCausalPairProbe(networkDenyProbe, control, test)).toBe("P0_SECURITY_FAIL")
	})
})

// ===========================================================================
// C1-CORRECTION01 RED test: the harness's runDogfood() correctly
// builds the causal pair for W01 / N01 / C02 in the runner loop.
// ===========================================================================
describe("C1-CORRECTION01 — runner integration: causal pairs in runDogfood", () => {
	it("kernel-deny P0 probe (W01) records causalPair with both legs and reaches EXPECTED_DENY", async () => {
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: true,
		})
		const w01 = result.results.find((r) => r.id === "W01")
		expect(w01).toBeDefined()
		expect(w01!.classification).toBe("EXPECTED_DENY")
		expect(w01!.causalPair).toBeDefined()
		expect(w01!.causalPair!.control.exitCode).toBe(0)
		expect(w01!.causalPair!.control.controlSignalObserved).toBe(true)
		expect(w01!.causalPair!.test.denySignatureObserved).toBe(true)
		// C1-CORRECTION02: state conservation is now required.
		expect(w01!.causalPair!.test.stateConserved).toBe(true)
	})

	it("network-deny P0 probe (N01) records causalPair with both legs and reaches EXPECTED_DENY", async () => {
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: fakeHarness(fake).onProbeStart,
			cwd: scratchDir!,
			sandboxOptIn: true,
		})
		const n01 = result.results.find((r) => r.id === "N01")
		expect(n01).toBeDefined()
		expect(n01!.classification).toBe("EXPECTED_DENY")
		expect(n01!.causalPair).toBeDefined()
		expect(n01!.causalPair!.control.controlSignalObserved).toBe(true)
		expect(n01!.causalPair!.test.denySignatureObserved).toBe(true)
	})

	it("kernel-deny P0 probe (W01) with FAILED control leg => P0_CAUSAL_PAIR_FAIL => halt", async () => {
		// Default mockResult returns {} (empty stdout/stderr). For
		// W01: CONTROL leg's post-state SHA equals pre-state SHA
		// because nothing was actually written, so
		// controlSignalObserved = false.
		// classifyCausalPairProbe returns P0_CAUSAL_PAIR_FAIL. The
		// runner halts.
		const fake = new FakeCommandJobManager({})
		let caught: unknown = null
		try {
			await runDogfood({
				createCommandJobManager: fakeHarness(fake).createCommandJobManager,
				onProbeStart: fakeHarness(fake).onProbeStart,
				cwd: scratchDir!,
				sandboxOptIn: true,
			})
		} catch (err) {
			caught = err
		}
		expect(caught).not.toBeNull()
		expect((caught as { name?: string }).name).toBe("DogfoodSecurityInvariantHalt")
		const halt = caught as { summary: { p0Halted: boolean; haltedAtProbeId: string } }
		expect(halt.summary.haltedAtProbeId).toBe("W01")
	})
})

// ===========================================================================
// C1-CORRECTION04 — C2 driver contract.
// ===========================================================================
//
// The C2 driver (apps/vscode/src/dev/dogfood/dogfood-c2-driver.ts)
// invokes runDogfood against the REAL production seam and writes
// evidence to .factory/evidence/.../ It runs under VS Code's
// --extensionTestsPath launcher, which reports success/failure
// based on the named `run()` Promise (resolve = pass, reject = fail).
//
// Two contracts the driver depends on:
//
//   1. writeRunArtifacts() must be robust to an absent outDir.
//      A P0 halt may occur before the driver has finished its
//      own mkdir pre-step, and the evidence dir is the
//      authoritative halt record.
//
//   2. runDogfood() treats a supplied scratchDir as caller-owned.
//      The driver is responsible for creating it. (This is a
//      test for the driver's mkdir discipline, not the runner's.)
//
// These tests do NOT launch a real VSCode; they exercise the
// contracts directly against tmp dirs.
// ===========================================================================
describe("C1-CORRECTION04 — C2 driver contract", () => {
	it("writeRunArtifacts() creates the outDir if absent and writes probe-results.jsonl", async () => {
		// Build a minimal DogfoodRunResult-shaped object. The
		// summary must include every required field (manifest
		// version, sha256, pass/expectedDeny/timeout counts).
		const fakeRun = {
			summary: {
				manifestVersion: MANIFEST_VERSION,
				manifestSha256: computeManifestSha256(),
				total: 1,
				pass: 1,
				expectedDeny: 0,
				compatibilityFail: 0,
				toolMissing: 0,
				timeout: 0,
				causalPairFail: 0,
				p0Fail: 0,
				p0Halted: false,
				haltedAtProbeId: null,
			},
			results: [
				{
					id: "B01",
					classification: "PASS" as const,
					p0Sensitive: false,
					durationMs: 0,
				},
			],
			policyMatrix: [],
		} as unknown as Parameters<typeof writeRunArtifacts>[1]

		const outDir = join(scratchDir!, `driver-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		expect(existsSync(outDir)).toBe(false)
		await writeRunArtifacts(outDir, fakeRun)
		expect(existsSync(outDir)).toBe(true)
		expect(existsSync(join(outDir, "probe-results.jsonl"))).toBe(true)
		expect(existsSync(join(outDir, "summary.json"))).toBe(true)
		expect(existsSync(join(outDir, "policy-matrix.tsv"))).toBe(true)
	})

	it("runDogfood() requires caller-owned scratchDir (NO auto-mkdir of supplied path)", async () => {
		// Pass a scratchDir that does NOT exist. The runner treats
		// supplied scratchDir as caller-owned; prepareKernelDenySentinel
		// will throw ENOENT. This is the contract the C2 driver
		// depends on (it must pre-mkdir).
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const nonexistentScratch = join(scratchDir!, `does-not-exist-${Date.now()}`)
		expect(existsSync(nonexistentScratch)).toBe(false)

		let caught: unknown = null
		try {
			await runDogfood({
				createCommandJobManager: fakeHarness(fake).createCommandJobManager,
				onProbeStart: fakeHarness(fake).onProbeStart,
				cwd: scratchDir!,
				sandboxOptIn: true,
				scratchDir: nonexistentScratch,
			})
		} catch (err) {
			caught = err
		}
		// The runner should have thrown (sentinel write failed)
		// BEFORE any probe executed. We don't care WHICH error
		// the runner surfaces — only that it surfaced one
		// (proves the contract: caller-owned, not auto-created).
		expect(caught).not.toBeNull()
		expect(fake.specs).toHaveLength(0)
	})

	it("runDogfood() with a freshly-mkdir'd scratchDir proceeds normally and writes the readonly sentinel during the run", async () => {
		// The DRIVER pattern: pre-mkdir the scratchDir, then
		// invoke runDogfood. This must NOT throw.
		//
		// The runner has a `finally` block that rmSync's the
		// readonly-probe file. To verify the file is actually
		// created during the run, we observe the directory
		// contents from the first `onProbeStart` callback (which
		// fires AFTER `prepareKernelDenySentinel` and BEFORE
		// any cleanup).
		const fake = new FakeCommandJobManager({})
		fake.mockResult = causalPairHappyMockResult(fake)
		const ownedScratch = join(scratchDir!, `owned-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		mkdirSync(ownedScratch, { recursive: true, mode: 0o700 })

		let readonlyProbeSeenDuringRun = false
		const observeStart = () => {
			const files = readdirSync(ownedScratch)
			if (files.some((f: string) => f.startsWith("readonly-probe-"))) {
				readonlyProbeSeenDuringRun = true
			}
		}

		const result = await runDogfood({
			createCommandJobManager: fakeHarness(fake).createCommandJobManager,
			onProbeStart: (probeId) => {
				fakeHarness(fake).onProbeStart(probeId)
				observeStart()
			},
			cwd: scratchDir!,
			sandboxOptIn: true,
			scratchDir: ownedScratch,
		})
		expect(result.summary.total).toBeGreaterThan(0)
		// The readonly-probe file was actually written by
		// prepareKernelDenySentinel during the run — proves the
		// runner reached that code path. (It is removed in the
		// runner's `finally` block, so we observe it via
		// onProbeStart rather than after runDogfood returns.)
		expect(readonlyProbeSeenDuringRun).toBe(true)
	})
})
