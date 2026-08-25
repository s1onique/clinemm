/**
 * ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01
 *
 * Default-off, dogfood-only qualification runner.
 *
 * This module executes the frozen probe manifest in
 * `./seatbelt-dogfood-manifest.ts` through the PRODUCTION
 * CommandJobManager path:
 *
 *     runner
 *       └── CommandJobManager.start(...)
 *             └── (default resolver)
 *                   └── SeatbeltSandboxBackendExperimental (under opt-in)
 *                         └── /usr/bin/sandbox-exec
 *                               └── kernel
 *
 * The runner deliberately bypasses the command-approval UI (no ASK
 * prompt) and the command-policy evaluateCommandPolicy() gate for
 * EXECUTION — that is the whole point of dogfood: we want to know
 * what Seatbelt allows/denies on its own, not what the policy layer
 * approves.
 *
 * The policy layer is consulted in a SEPARATE LANE for telemetry
 * only (the policy-matrix.tsv output). The two lanes never
 * influence each other.
 *
 * DEFAULT_OFF CONTRACT
 *
 * - This module has NO public surface in the extension manifest.
 * - It is NOT a `vscode.commands.registerCommand` entry point.
 * - It is NOT exposed via any gRPC service.
 * - It is ONLY callable from a test or from a privileged developer
 *   command, both of which require explicit code review.
 *
 * The intent is a TEMPORARY diagnostic harness that will be removed
 * once ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01 (C2 + C3)
 * closes. If a successor ACT wants to graduate this into a maintained
 * sandbox conformance suite, it MUST come with a fresh scope review
 * and a separate closure ACT.
 *
 * CAUSAL-PAIR REQUIREMENT (added in C1-CORRECTION01)
 *
 * Generic non-zero exit codes are NOT sufficient evidence that the
 * kernel sandbox denied an operation. A failed `curl` could mean
 * "sandbox blocked it" OR "the parent endpoint wasn't listening" OR
 * "DNS failed" OR "the binary isn't installed" — those are
 * observationally confounded.
 *
 * For P0-sensitive `kernel-deny` and `network-deny` probes the
 * runner therefore requires a CAUSAL PAIR:
 *
 *   1. CONTROL: same command, sandbox OFF → must succeed (or for
 *               `kernel-deny` probes: same write to the target with
 *               the sandbox OFF, recorded as a sibling baseline).
 *   2. TEST:    same command, sandbox ON  → must show the expected
 *               denial signature (EPERM on stderr for kernel-deny;
 *               no response token for network-deny).
 *
 * If the control leg fails, the probe is reported as
 * `P0_CAUSAL_PAIR_FAIL` (not `EXPECTED_DENY`), because a denial
 * cannot be trusted without a confirmed baseline.
 *
 * P0 HALT SEMANTICS
 *
 * Per probe classification (see `classifyProbeResult`):
 *
 *   PASS                      : observed outcome matches expected class
 *   EXPECTED_DENY             : kernel/network denied as expected, with
 *                               causal pair verified (P0 probes)
 *   COMPATIBILITY_FAIL        : failed for a non-security reason (e.g.
 *                               tool missing, deadline, exit-non-zero
 *                               on success, control-pair failure)
 *   TOOL_MISSING              : exit 127 + command-not-found
 *   TIMEOUT                   : deadline exceeded or cancelled
 *   P0_SECURITY_FAIL          : the P0 invariant is violated: sandbox
 *                               let something through, or env leaked,
 *                               or a P0 probe saw an unexpected class
 *   P0_CAUSAL_PAIR_FAIL       : control leg failed; cannot trust TEST
 *                               verdict (so cannot conclude deny)
 *
 * A probe with `p0Sensitive: true` that does NOT produce PASS or
 * EXPECTED_DENY triggers P0_SECURITY_FAIL (or
 * P0_CAUSAL_PAIR_FAIL → P0_SECURITY_FAIL for p0Sensitive probes).
 * The runner HALTs and returns the partial matrix. This is the
 * Factory rule: only NEW P0 interrupts acquisition.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type CommandDecisionKind, type CommandHostAuthorization, commandHostAuthorization } from "@cline/core"
import { CommandJobManager, DEFAULT_EXECUTION_DEADLINE_MS } from "../../sdk/command-job-manager"
import {
	DOGFOOD_PROBE_MANIFEST,
	type DogfoodProbe,
	type DogfoodProbeExpected,
	MANIFEST_VERSION,
} from "./seatbelt-dogfood-manifest"

/**
 * The synthetic dogfood secret injected by the runner into the
 * child environment. The harness asserts it does NOT reach the
 * child's stdout (sanitized mode strips it). The string itself is
 * distinctive enough to detect in any incidental capture path.
 *
 * NOTE: this is intentionally NOT a real secret. It is a unique,
 * high-entropy marker that we can detect via grep.
 *
 * IMPORTANT (C1-CORRECTION01): the secret is passed ONLY via
 * `options.env` (which goes through the production sandbox prepare
 * path). It is NOT substituted into the probe command via
 * `substituteCommandEnv`. Substituting inline would defeat the very
 * sanitization property the harness exists to test: under
 * `mode: "sanitized"`, the harness's seeded env vars are stripped
 * before the spawn, so the child would not see them at all. That
 * is exactly the property E01 is meant to verify.
 */
export const DOGFOOD_SYNTHETIC_SECRET_NAME = "CLINEMM_DOGFOOD_FAKE_SECRET" as const
export const DOGFOOD_SYNTHETIC_SECRET_VALUE =
	"clinemm-dogfood-FAKE-SECRET-do-not-use-anywhere-real-0xCAFEBABE-deadbeef-2026" as const

/**
 * C1-CORRECTION03: positive witness token for E01. The E01 command
 * is `printf 'DOGFOOD_ENV_PROBE_OK:%s\n' "$CLINEMM_DOGFOOD_FAKE_SECRET"`.
 *
 * If the child actually runs printf successfully, stdout will
 * contain `DOGFOOD_ENV_PROBE_OK:`. If the spawn failed, the shell
 * never reached printf, or sanitization regressed to block ALL env
 * (including any PATH/IFS variables printf would need), stdout will
 * NOT contain the witness.
 *
 * The witness makes E01 a POSITIVE-AND-NEGATIVE check: the child
 * must have run AND the secret must be absent. A missing witness
 * OR a present secret is P0.
 */
export const DOGFOOD_ENV_PROBE_WITNESS = "DOGFOOD_ENV_PROBE_OK:" as const

/**
 * Environment variable name the runner uses to point W01 / C02 at
 * the readonly probe path. Keeping it parameterized means the
 * manifest itself never bakes in fixture paths.
 */
export const DOGFOOD_READONLY_PROBE_ENV = "CLINEMM_DOGFOOD_READONLY_PROBE" as const

/**
 * Environment variable name the runner uses to point N01 at the
 * controlled localhost listener port (set dynamically via the parent's
 * ephemeral-port listener — see {@link startLocalhostListener}).
 *
 * C1-CORRECTION01: previously this was a hardcoded port 1
 * (`DOGFOOD_LOCAL_PORT_VALUE = 1`), which was unfalsifiable: a
 * closed port and a kernel sandbox denial are observationally
 * confounded. The runner now binds 127.0.0.1:0, captures the
 * assigned port, runs the control leg, and only then runs the
 * sandboxed test leg against the same endpoint.
 */
export const DOGFOOD_LOCAL_PORT_ENV = "CLINEMM_DOGFOOD_LOCAL_PORT" as const

/**
 * Frozen response token the localhost listener emits for every
 * request. The runner uses this to confirm the control leg actually
 * reached the parent endpoint (a non-empty response body with this
 * token, AND `stdout.includes(TOKEN)`).
 *
 * It is set high enough entropy to be essentially impossible to
 * appear in any incidental capture path.
 */
export const DOGFOOD_NETWORK_RESPONSE_TOKEN = "clinemm-dogfood-LOCAL-RESPONSE-TOKEN-0xFEEDFACE-c0ffee01" as const

/**
 * Sandbox opt-in env var name. Matches
 * `ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01`.
 */
export const DOGFOOD_SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX" as const
export const DOGFOOD_SANDBOX_OPTIN_VALUE = "seatbelt" as const

/**
 * Classification of a single probe's observed outcome. This is the
 * one of these that a probe result MUST collapse to.
 *
 * C1-CORRECTION01 added `P0_CAUSAL_PAIR_FAIL` for the case where
 * the unsandboxed control leg of a P0 kernel-deny / network-deny
 * probe fails. We cannot conclude `EXPECTED_DENY` if the baseline
 * is unknown, so this is reported separately and (because all
 * current network/kernel-deny P0 probes are p0Sensitive) triggers
 * a HALT.
 */
export type DogfoodProbeClassification =
	| "PASS"
	| "EXPECTED_DENY"
	| "COMPATIBILITY_FAIL"
	| "TOOL_MISSING"
	| "TIMEOUT"
	| "P0_SECURITY_FAIL"
	| "P0_CAUSAL_PAIR_FAIL"

/**
 * Per-probe result line, suitable for JSONL serialization.
 *
 * C1-CORRECTION01 added the `causalPair` field. For P0
 * `kernel-deny` and `network-deny` probes the runner records
 * both the unsandboxed CONTROL leg and the sandboxed TEST leg so
 * the matrix has the evidence required to defend the verdict
 * downstream. For other probes this is `null`.
 */
export interface DogfoodProbeResult {
	id: string
	domain: DogfoodProbe["domain"]
	command: string
	expected: DogfoodProbeExpected
	p0Sensitive: boolean
	state: string
	exitCode: number | null
	signal: string | null
	classification: DogfoodProbeClassification
	stdoutSha256: string
	stderrClass: "none" | "sandbox-error" | "kernel-eperm" | "network-failure" | "other"
	observedStdoutExcerpt: string
	durationMs: number
	notes?: string
	/**
	 * Causal pair record (C1-CORRECTION01). Populated for P0
	 * kernel-deny / network-deny probes; null otherwise.
	 */
	causalPair?: {
		control: CausalPairLeg
		test: CausalPairLeg
	}
}

/**
 * One leg of a causal pair (CONTROL or TEST). Captures both the
 * exit code and the structural signal that proves (or fails to
 * prove) the leg did what we asked.
 *
 * C1-CORRECTION02 added `stateConserved` for kernel-deny probes.
 * The runner writes the ORIGINAL sentinel baseline BEFORE the
 * CONTROL leg. The CONTROL leg writes fresh bytes (overwriting the
 * baseline). Between CONTROL and TEST, the runner RESTORES the
 * ORIGINAL baseline. The TEST leg must then EMIT EPERM AND leave
 * the file with the ORIGINAL bytes — proving the sandbox denied
 * the write. Without restoring the baseline, the TEST comparison
 * would be contaminated by the CONTROL leg's write.
 */
export interface CausalPairLeg {
	/**
	 * Which leg this is. "control" = sandbox OFF, "test" = sandbox
	 * ON (per the runner's `sandboxOptIn` and the per-probe
	 * override for network-deny).
	 */
	role: "control" | "test"
	/** Process exit code, or null if killed by signal / deadline. */
	exitCode: number | null
	/** True iff the sandbox's expected-deny signature was observed. */
	denySignatureObserved: boolean
	/**
	 * True iff the leg produced the expected CONTROL-leg signal
	 * (response token for network-deny; sentinel byte mismatch for
	 * kernel-deny). False for the TEST leg; only meaningful for
	 * CONTROL.
	 */
	controlSignalObserved: boolean
	/**
	 * True iff the leg's post-state of the sentinel target equals
	 * the ORIGINAL baseline bytes (kernel-deny probes only). For
	 * the CONTROL leg this is always false (the leg wrote fresh
	 * bytes); for the TEST leg this MUST be true if the sandbox
	 * denied the write and the file was actually present.
	 */
	stateConserved: boolean
	/** Last 256 chars of stdout for forensic display. */
	stdoutExcerpt: string
	/** Last 256 chars of stderr for forensic display. */
	stderrExcerpt: string
	/** Wall time of this single leg. */
	durationMs: number
}

/**
 * Top-level run summary. Counts and metadata for the run; consumed
 * by C2 to write `summary.json` and `policy-matrix.tsv`.
 */
export interface DogfoodRunSummary {
	manifestVersion: string
	manifestSha256: string
	total: number
	pass: number
	expectedDeny: number
	compatibilityFail: number
	toolMissing: number
	timeout: number
	p0Fail: number
	/** C1-CORRECTION01: count of probes whose causal-pair control failed. */
	causalPairFail: number
	p0Halted: boolean
	haltedAtProbeId: string | null
}

/**
 * Top-level run result. Carries the per-probe results (in execution
 * order) and the summary. The caller is responsible for serializing
 * this to JSONL / summary.json / etc.
 */
export interface DogfoodRunResult {
	summary: DogfoodRunSummary
	results: DogfoodProbeResult[]
	policyMatrix: DogfoodPolicyRow[]
}

export interface DogfoodPolicyRow {
	id: string
	policyKind: CommandDecisionKind
	policySource: string
}

/**
 * Inputs to the runner. Designed for dependency injection so the
 * test suite can swap the production seam for a fake without
 * re-implementing the harness.
 */
export interface DogfoodRunnerInputs {
	/**
	 * Factory that returns a fresh CommandJobManager instance. The
	 * runner calls it once per causal-pair probe (for the
	 * CONTROL + TEST legs) and once for the primary manager
	 * shared across single-leg probes.
	 *
	 * C1-CORRECTION02: the factory receives the CURRENT probe id
	 * alongside the workspace roots. Tests use this to disambiguate
	 * probes without inferring identity from command text (which
	 * is ambiguous: several probes start with `printf` or
	 * `/bin/sh`). The production default resolver ignores the
	 * probe-id argument.
	 */
	createCommandJobManager: (workspaceRoots: readonly string[], probeId: string) => CommandJobManager
	/**
	 * Optional policy evaluator. When omitted, the runner skips
	 * the policy lane entirely (matrix.tsv is empty). Tests pass a
	 * fake; C2 passes the real `evaluateCommandPolicy` from
	 * `@cline/core`.
	 */
	evaluatePolicy?: (input: { toolInput: unknown; hostAuthorization: CommandHostAuthorization }) => {
		decision: { kind: CommandDecisionKind; source: string }
	}
	/**
	 * cwd under which all probes run. Must be the real workspace
	 * root for the workspace write-deny probe to be meaningful.
	 */
	cwd: string
	/**
	 * When true, set CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt BEFORE
	 * constructing the CommandJobManager so the production default
	 * resolver returns the Seatbelt backend. When false, the
	 * opt-in env is absent and the legacy unsandboxed path runs.
	 */
	sandboxOptIn: boolean
	/**
	 * Per-probe env seed. Defaults to a fresh fixture (synthetic
	 * secret + readonly probe path + local port 1). Tests can
	 * override.
	 */
	fixtureEnv?: Record<string, string>
	/**
	 * Optional scratch dir for the runner's per-run workspace.
	 * When omitted, the runner creates a fresh tmp dir under
	 * the host's `os.tmpdir()` and removes it on dispose.
	 */
	scratchDir?: string
	/**
	 * C1-CORRECTION03: optional test seam invoked BEFORE every
	 * `manager.start()` call (CONTROL and TEST legs of causal
	 * pairs, plus every single-leg probe). The runner passes
	 * the current probe id.
	 *
	 * Why this exists in addition to the `probeId` factory
	 * argument: the runner shares a SINGLE `primaryManager`
	 * across every single-leg probe (one factory call, then
	 * N start() invocations). The factory argument only fires
	 * ONCE (with the first probe's id). For tests that need
	 * accurate per-spec probe identity (e.g. the planned
	 * execution sequence assertion), this callback fires
	 * once per start() and lets the test fake track the
	 * CURRENT probe id.
	 *
	 * Production callers omit this — it is a no-op for them.
	 */
	onProbeStart?: (probeId: string) => void
}

/**
 * The HALT signal returned by the runner when a P0 invariant is
 * violated. The matrix is preserved; the caller can serialize the
 * partial state and report.
 */
export class DogfoodSecurityInvariantHalt extends Error {
	readonly summary: DogfoodRunSummary
	readonly results: DogfoodProbeResult[]
	readonly failingProbe: DogfoodProbeResult
	constructor(summary: DogfoodRunSummary, results: DogfoodProbeResult[], failingProbe: DogfoodProbeResult) {
		super(
			`HALT_SEATBELT_DOGFOOD_SECURITY_INVARIANT: probe ${failingProbe.id} (${failingProbe.classification}) violated P0 invariant`,
		)
		this.name = "DogfoodSecurityInvariantHalt"
		this.summary = summary
		this.results = results
		this.failingProbe = failingProbe
	}
}

/**
 * Compute the SHA-256 of the frozen manifest. The exact JSON shape
 * matters only as a stability check; we use the JSON-roundtrip
 * representation so changes to the manifest cause a deterministically
 * different hash.
 */
export function computeManifestSha256(): string {
	const h = createHash("sha256")
	// Stable shape: serialize manifest in execution order.
	const stable = JSON.stringify(
		DOGFOOD_PROBE_MANIFEST.map((p) => ({
			id: p.id,
			domain: p.domain,
			command: p.command,
			expected: p.expected,
			timeoutMs: p.timeoutMs,
			p0Sensitive: p.p0Sensitive,
		})),
	)
	h.update(stable)
	return h.digest("hex")
}

/**
 * Classify the child's stderr into a coarse class for the matrix.
 * This is purely observational — it does NOT influence the PASS /
 * FAIL verdict (which is decided by exit code + exit pattern match).
 */
export function classifyStderr(stderr: string, stdout: string): DogfoodProbeResult["stderrClass"] {
	const hay = `${stderr}\n${stdout}`
	if (hay.includes("Operation not permitted")) return "kernel-eperm"
	if (hay.includes("Failed to connect") || hay.includes("Couldn't connect")) {
		return "network-failure"
	}
	if (hay.includes("sandbox-unavailable") || hay.includes("sandbox-prepare-failed")) {
		return "sandbox-error"
	}
	return "other"
}

/**
 * Classify a SINGLE LEG (one raw StartCommandJobResult) into one of
 * the canonical classification strings.
 *
 * This is the building block the causal-pair classifier consumes.
 * It is intentionally permissive: it does NOT halt. P0 detection
 * happens in a separate pass (see {@link isP0Failure}).
 *
 * C1-CORRECTION01 tightened the kernel-deny and network-deny logic
 * so that a generic non-zero exit is NOT by itself sufficient for
 * `EXPECTED_DENY`. For P0-sensitive kernel-deny / network-deny
 * probes the caller MUST go through {@link classifyCausalPairProbe}
 * instead, which adds the control leg.
 */
export function classifyProbeResult(
	probe: DogfoodProbe,
	raw: {
		state: string
		exitCode?: number | null
		signal?: string | null
		stdout: string
		stderr: string
	},
): DogfoodProbeClassification {
	// TOOL_MISSING detection: shell 127 with command-not-found pattern.
	const stderr = raw.stderr ?? ""
	const stdout = raw.stdout ?? ""
	const combined = `${stderr}\n${stdout}`

	if (probe.expected === "informational") {
		// Outcome-agnostic: even if it fails, that's fine.
		return "PASS"
	}

	if (probe.expected === "secret-absent") {
		// C1-CORRECTION03: require BOTH a positive witness AND a
		// negative check.
		//
		// The previous negative-only check (secret NOT in stdout →
		// PASS) was non-causal: any failure mode that prevented
		// stdout from being printed at all (spawn_failed, shell
		// error before printf, exit 127, deadline) would have been
		// mis-classified as PASS.
		//
		// The E01 command emits a fixed witness token
		// (`DOGFOOD_ENV_PROBE_OK:`). If the child actually ran and
		// printf succeeded, the witness is present. If the witness
		// is missing, the child never ran (or sanitization
		// regressed to block everything printf needs), and the
		// "no secret" result is uninformative — so P0.
		//
		// Order matters: a child that ran but received the secret
		// (sanitization regression) prints the witness AND the
		// secret. We detect that case first as the more dangerous
		// failure (P0_SECURITY_FAIL), and only THEN check for the
		// witness. A child that didn't run at all is
		// P0_CAUSAL_PAIR_FAIL (uninformative probe, not a security
		// regression).
		if (combined.includes(DOGFOOD_SYNTHETIC_SECRET_VALUE)) {
			return "P0_SECURITY_FAIL"
		}
		if (raw.state !== "exited") {
			// spawn_failed / deadline_exceeded — child never ran.
			// The probe is uninformative; we cannot distinguish
			// "sanitizer correctly stripped" from "we never tried".
			return "P0_CAUSAL_PAIR_FAIL"
		}
		if ((raw.exitCode ?? 1) !== 0) {
			// printf exited non-zero; the witness cannot have been
			// printed. Probe is uninformative.
			return "P0_CAUSAL_PAIR_FAIL"
		}
		if (!stdout.includes(DOGFOOD_ENV_PROBE_WITNESS)) {
			// Exited 0 but no witness — printf ran but didn't print
			// what we expected. Possibly a printf shim or a
			// hardened sandbox that intercepted printf without
			// erroring. P0: uninformative on the sanitizer.
			return "P0_CAUSAL_PAIR_FAIL"
		}
		return "PASS"
	}

	if (probe.expected === "kernel-deny") {
		// Probes that are EXPECTED to be denied by the kernel.
		//
		// C1-CORRECTION01: a non-zero exit alone is no longer
		// sufficient. The runner's causal pair provides the
		// classifier with the CONTROL-leg baseline (was the
		// unsandboxed write to the same target successful?) and
		// the TEST-leg deny signature (does the kernel EPERM
		// appear?).
		//
		// For single-leg classification (non-P0 kernel-deny probes,
		// or pre-causal-pair callers), we keep the EPERM signature
		// as the strict signal and fall back to TIMEOUT/TOOL_MISSING
		// detection for the rest.
		if (combined.includes("Operation not permitted")) {
			return "EXPECTED_DENY"
		}
		if (raw.exitCode === 127 || combined.includes("not found") || combined.includes("No such file")) {
			return "TOOL_MISSING"
		}
		if (raw.state === "deadline_exceeded" || raw.state === "cancelled") {
			return "TIMEOUT"
		}
		// A non-zero exit WITHOUT the EPERM signature is NOT
		// "expected deny" — it is ambiguous (could be a syntax
		// error, broken fixture, missing permission from a
		// different layer). Report as COMPATIBILITY_FAIL so the
		// runner can decide whether P0 semantics apply.
		if (raw.exitCode !== 0 && raw.exitCode != null) {
			return "COMPATIBILITY_FAIL"
		}
		return "P0_SECURITY_FAIL"
	}

	if (probe.expected === "network-deny") {
		// Probes expected to be denied by sandbox network=deny.
		//
		// C1-CORRECTION01: the curl-exit-7 / "Failed to connect"
		// pattern is no longer accepted as evidence of kernel
		// denial in isolation. A closed port and a kernel sandbox
		// denial are observationally confounded. Callers MUST go
		// through {@link classifyCausalPairProbe} for P0 probes.
		//
		// Single-leg classification now reports network-failure
		// patterns as COMPATIBILITY_FAIL so the causal-pair
		// classifier can decide.
		if (combined.includes("Failed to connect") || combined.includes("Couldn't connect")) {
			return "COMPATIBILITY_FAIL"
		}
		if (raw.exitCode === 127 || combined.includes("not found") || combined.includes("No such file")) {
			return "TOOL_MISSING"
		}
		if (raw.state === "deadline_exceeded" || raw.state === "cancelled") {
			return "TIMEOUT"
		}
		if (raw.exitCode === 0) {
			// exit 0 from curl with -fsS means it succeeded — the
			// sandbox let it through. That is a P0 regression for
			// a network-deny probe, so signal it as such.
			return "P0_SECURITY_FAIL"
		}
		// Some other non-zero exit (e.g. timeout). Not enough
		// evidence for EXPECTED_DENY; defer to causal pair.
		return "COMPATIBILITY_FAIL"
	}

	// probe.expected === "success" — the most common case.
	if (raw.state === "deadline_exceeded" || raw.state === "cancelled") {
		return "TIMEOUT"
	}
	if (raw.exitCode === 0) {
		return "PASS"
	}
	// exit 127 with command-not-found pattern => TOOL_MISSING.
	if (raw.exitCode === 127 || combined.includes("not found") || combined.includes("No such file")) {
		return "TOOL_MISSING"
	}
	return "COMPATIBILITY_FAIL"
}

/**
 * Classify a P0-sensitive `kernel-deny` or `network-deny` probe
 * whose CONTROL + TEST legs have both been executed.
 *
 * C1-CORRECTION01 introduced this as the strict, evidence-grounded
 * counterpart to `classifyProbeResult`. It enforces:
 *
 *   - CONTROL leg must succeed (exit 0, expected signal present)
 *     → otherwise the baseline is unknown and we cannot conclude
 *       "denied". Result: `P0_CAUSAL_PAIR_FAIL`.
 *
 *   - TEST leg must show the expected-deny signature (EPERM on
 *     stderr for kernel-deny; no response token in stdout for
 *     network-deny)
 *     → otherwise the sandbox failed to deny what we asked it to
 *       deny. Result: `P0_SECURITY_FAIL`.
 *
 *   - Both legs together with the right signatures
 *     → `EXPECTED_DENY`.
 */
export function classifyCausalPairProbe(
	probe: DogfoodProbe,
	control: CausalPairLeg,
	test: CausalPairLeg,
): DogfoodProbeClassification {
	// First: the control leg MUST have produced the structural
	// signal that proves the harness actually exercised the
	// operation. If it didn't, we don't have a baseline, so the
	// TEST leg's outcome is uninformative.
	if (!control.controlSignalObserved) {
		return "P0_CAUSAL_PAIR_FAIL"
	}
	if (probe.expected === "kernel-deny") {
		// TEST leg must show EPERM AND the sentinel target must
		// remain at the ORIGINAL baseline bytes. A non-zero exit
		// WITHOUT EPERM could be anything: syntax error, wrong
		// path, missing tool, unrelated permission problem.
		// Likewise, EPERM WITHOUT state conservation could mean
		// the sandbox denied the FIRST byte but allowed a
		// follow-up write — the C3-quality evidence requires both.
		if (!test.denySignatureObserved) {
			return "P0_SECURITY_FAIL"
		}
		if (!test.stateConserved) {
			return "P0_SECURITY_FAIL"
		}
		return "EXPECTED_DENY"
	}
	if (probe.expected === "network-deny") {
		// TEST leg must NOT contain the response token AND must
		// not have reached a "successful" exit-0 state. (The
		// sandbox could be letting the request through with a
		// fake error, or the token could appear via a side
		// channel; we report either as P0.)
		if (test.controlSignalObserved) {
			// The TEST leg somehow saw the response token.
			return "P0_SECURITY_FAIL"
		}
		if (test.exitCode === 0) {
			return "P0_SECURITY_FAIL"
		}
		return "EXPECTED_DENY"
	}
	// Other expected classes are not causal-paired; defer.
	return classifyProbeResult(probe, {
		state: test.exitCode === null ? "deadline_exceeded" : "exited",
		exitCode: test.exitCode,
		stdout: test.stdoutExcerpt,
		stderr: test.stderrExcerpt,
	})
}

/**
 * P0 detection: re-checks the classification against the probe's
 * p0Sensitive flag. A p0Sensitive probe that is NOT PASS or
 * EXPECTED_DENY is a security invariant violation and triggers
 * HALT_SEATBELT_DOGFOOD_SECURITY_INVARIANT.
 *
 * C1-CORRECTION01: `P0_CAUSAL_PAIR_FAIL` is also a halt trigger
 * because all currently-p0Sensitive kernel-deny / network-deny
 * probes MUST go through the causal-pair classifier, and a
 * causal-pair failure means we cannot conclude the deny.
 */
export function isP0Failure(probe: DogfoodProbe, cls: DogfoodProbeClassification): boolean {
	if (!probe.p0Sensitive) return false
	return cls !== "PASS" && cls !== "EXPECTED_DENY"
}

/**
 * SHA-256 of a string. Local helper to avoid pulling extra deps.
 */
function sha256(buf: string | Buffer): string {
	const h = createHash("sha256")
	h.update(buf)
	return h.digest("hex")
}

/**
 * Frozen sentinel contents written to the readonly probe target
 * before the kernel-deny probes run. C1-CORRECTION01: W01 and
 * C02 now require that the unsandboxed CONTROL leg change the
 * sentinel bytes (proving the operation is possible) AND the
 * sandboxed TEST leg NOT change them (proving the kernel deny
 * applied AND the harness can verify state conservation). Both
 * legs are reported as `causalPair` on the probe result.
 */
const KERNEL_DENY_SENTINEL_BYTES = Buffer.from("clinemm-dogfood-SENTINEL-frozen-baseline-do-not-overwrite\n", "utf8")

/**
 * Start a controlled localhost HTTP listener for N01's causal pair.
 *
 * Binds 127.0.0.1:0 (kernel-assigned ephemeral port), emits the
 * frozen {@link DOGFOOD_NETWORK_RESPONSE_TOKEN} for every request,
 * and returns both the assigned port and the live server handle.
 *
 * The caller is responsible for invoking `close()` on the server
 * during the runner's `finally` block.
 *
 * Why this exists (C1-CORRECTION01): previously N01 used
 * `http://127.0.0.1:1/`, where port 1 is the closed tcpmux port.
 * A `curl` failure against a closed port and a `curl` failure
 * against a kernel-denied port are observationally confounded
 * (both yield "could not connect"). The causal-pair test now uses
 * a live endpoint so we can prove the parent side is reachable
 * BEFORE we conclude the sandbox denied the TEST leg.
 */
function startLocalhostListener(): Promise<{ port: number; server: Server }> {
	return new Promise((resolve, reject) => {
		const server = createServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": String(DOGFOOD_NETWORK_RESPONSE_TOKEN.length) })
			res.end(DOGFOOD_NETWORK_RESPONSE_TOKEN)
		})
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address()
			if (typeof addr === "string" || addr === null) {
				reject(new Error("Localhost listener did not receive an assigned port"))
				return
			}
			resolve({ port: addr.port, server })
		})
	})
}

/**
 * Pre-create the kernel-deny sentinel file at the readonly probe
 * path. Returns the SHA-256 of the frozen contents so the
 * runner's TEST leg can compare bytes against the original.
 *
 * C1-CORRECTION02: the probe file lives INSIDE the scratch dir
 * (`scratchDir/readonly-probe-<runId>`), not one level up. The
 * production-seam binding is: `workspaceRoots=[scratchDir]` flows
 * into `experimentalSandboxWorkspaceRoots`, which the backend
 * uses to derive the read-only capability. By placing the
 * sentinel file inside the workspace root, the test actually
 * proves "kernel denies writes inside the configured readonlyRoot"
 * — not "kernel denies writes outside any root". Earlier
 * placement at `scratchDir/../sentinel` was uninformative
 * because the parent-of-writable deny would fire regardless of
 * the experimental capability.
 *
 * If the file already exists (e.g. a previous run left it behind),
 * we overwrite with the frozen bytes; the SHA comparison remains
 * valid because both legs read the SAME freshly-written baseline.
 *
 * The caller (`runDogfood`) is responsible for creating the
 * scratch dir before invoking this helper. See
 * `dogfood-c2-driver.ts` for the C2 launch path; the unit suite's
 * `beforeEach` does the same with `mkdtempSync`.
 */
function prepareKernelDenySentinel(readonlyProbePath: string): {
	preSha: string
} {
	writeFileSync(readonlyProbePath, KERNEL_DENY_SENTINEL_BYTES, { mode: 0o644 })
	return { preSha: sha256(KERNEL_DENY_SENTINEL_BYTES) }
}

/**
 * Build the per-probe env.
 *
 * The synthetic secret is included in the env so the production
 * sanitizer (sanitized mode) decides whether to strip it. This is
 * the test for the SANITIZATION property — see E01.
 *
 * The readonly probe path is included so W01/C02 can target a known
 * location inside the scratch dir (which is the production
 * `experimentalSandboxWorkspaceRoots[0]`).
 *
 * `localPort` is the controlled listener's actual port (resolved
 * by the runner after {@link startLocalhostListener} binds). C1
 * legacy used a hardcoded port=1, which was unfalsifiable; see
 * the C1-CORRECTION01 header for the rationale.
 *
 * The caller's `fixtureEnv` overrides defaults if provided.
 */
export function buildProbeEnv(
	fixture: Record<string, string> | undefined,
	readonlyProbePath: string,
	localPort: number,
): Record<string, string> {
	return {
		[DOGFOOD_SYNTHETIC_SECRET_NAME]: DOGFOOD_SYNTHETIC_SECRET_VALUE,
		[DOGFOOD_READONLY_PROBE_ENV]: readonlyProbePath,
		[DOGFOOD_LOCAL_PORT_ENV]: String(localPort),
		...(fixture ?? {}),
	}
}

/**
 * Substitute `${VAR}` references in the probe command with the env
 * values.
 *
 * Scope (C1-CORRECTION01): the harness substitutes ONLY `${...}`
 * references that point to path-like or port-like values (i.e.
 * values that need to be resolved before the child can use them
 * in a redirection or URL).
 *
 * The harness does NOT substitute the synthetic secret here. The
 * secret reaches the child via `options.env`, which is the input
 * to the production sanitizer's sanitized mode — that is the
 * property E01 is meant to verify. Substituting inline would
 * embed the secret literal into the command, defeating the
 * sanitization test.
 *
 * Practical effect: the resolver here is for `${...}` forms that
 * show up in commands like W01's `printf X > ${...}` and N01's
 * `curl http://127.0.0.1:${CLINEMM_DOGFOOD_LOCAL_PORT}/`. The
 * secret `${CLINEMM_DOGFOOD_FAKE_SECRET}` (E01) is referenced
 * without dollar-braces (`$CLINEMM_DOGFOOD_FAKE_SECRET`), so the
 * shell sees an empty value under sanitized mode and prints
 * nothing.
 */
export function substituteCommandEnv(command: string, env: Record<string, string>): string {
	let out = command
	for (const [k, v] of Object.entries(env)) {
		out = out.split(`\${${k}}`).join(v)
	}
	return out
}

/**
 * Main entry point. Executes every probe in the manifest, classifies
 * each, halts on P0.
 *
 * The runner deliberately does NOT use a `--command` argument; the
 * manifest is the ONLY authority on what runs. This is structural
 * defense-in-depth: even if a caller tries to bypass the harness, the
 * harness has no surface that lets them.
 *
 * @throws {DogfoodSecurityInvariantHalt} when a P0 invariant fails.
 */
export async function runDogfood(inputs: DogfoodRunnerInputs): Promise<DogfoodRunResult> {
	const manifestSha = computeManifestSha256()

	// Sandbox opt-in: must be set BEFORE constructing the
	// CommandJobManager (its resolver reads the env at start time).
	// We snapshot the prior value so we can restore on dispose.
	const priorSandboxOptIn = process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
	if (inputs.sandboxOptIn) {
		process.env[DOGFOOD_SANDBOX_OPTIN_ENV] = DOGFOOD_SANDBOX_OPTIN_VALUE
	} else {
		delete process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
	}

	// Pre-create the scratch dir (so we can use its absolute path
	// as the readonly probe target). The runner owns its lifecycle:
	// it removes the dir on dispose. Tests can pre-create the dir
	// and pass it via `scratchDir`.
	const scratchDir = inputs.scratchDir ?? mkdtempSync(join(tmpdir(), "clinemm-dogfood-scratch-"))
	const ownedScratchDir = !inputs.scratchDir

	// The readonly probe path lives INSIDE the workspace root
	// (`scratchDir`). The Wave-1 capability maps
	// `experimentalSandboxWorkspaceRoots` → `readonlyRoots` for
	// the sandbox profile. To prove the production mapping, the
	// target MUST be inside `workspaceRoots=[scratchDir]`, not a
	// sibling of it. C1-CORRECTION02 review caught that
	// `scratchDir/../sentinel` was probing "kernel denies writes
	// to a path outside any configured root", not "kernel denies
	// writes to a configured readonlyRoot".
	const readonlyProbePath = join(scratchDir, `readonly-probe-${Date.now()}`)
	prepareKernelDenySentinel(readonlyProbePath)

	// Start the controlled localhost listener for N01's causal pair.
	// C1-CORRECTION01: this used to be port=1 (closed) which was
	// unfalsifiable. We now bind 127.0.0.1:0 and use the assigned
	// port so the CONTROL leg can actually reach the parent.
	const listener = await startLocalhostListener()
	const localPort = listener.port

	const probeEnv = buildProbeEnv(inputs.fixtureEnv, readonlyProbePath, localPort)

	const workspaceRoots: readonly string[] = [scratchDir]
	// Note: we construct CommandJobManager lazily per probe that
	// requires it. P0 kernel-deny / network-deny probes need TWO
	// managers (CONTROL + TEST), each reading the sandbox opt-in
	// env at construction time. The factory therefore gets called
	// potentially 2x per causal-paired probe.
	let primaryManager: CommandJobManager | null = null
	const results: DogfoodProbeResult[] = []
	const policyMatrix: DogfoodPolicyRow[] = []

	// Dogfood forces the lowest-trust policy mode so the policy lane
	// reflects what an UNMODIFIED installed host would assign
	// (manual / safe-only / all). Tests inject a custom evaluator
	// so they can vary the mode.
	const hostAuth: CommandHostAuthorization = commandHostAuthorization({
		mode: "manual",
		explicitAllowRules: [],
	})

	let p0Halted = false
	let haltedAtProbeId: string | null = null
	let passCount = 0
	let expectedDenyCount = 0
	let compatFailCount = 0
	let toolMissingCount = 0
	let timeoutCount = 0
	let p0FailCount = 0
	let causalPairFailCount = 0

	try {
		for (const probe of DOGFOOD_PROBE_MANIFEST) {
			// Policy lane (observational; never gates execution).
			if (inputs.evaluatePolicy) {
				try {
					const pol = inputs.evaluatePolicy({
						toolInput: probe.command,
						hostAuthorization: hostAuth,
					})
					policyMatrix.push({
						id: probe.id,
						policyKind: pol.decision.kind,
						policySource: pol.decision.source,
					})
				} catch {
					policyMatrix.push({
						id: probe.id,
						policyKind: "deny",
						policySource: "policy-evaluator-threw",
					})
				}
			}

			// Substitute ${...} refs in the probe's command string so
			// the child receives a fully-resolved command.
			const resolvedCommand = substituteCommandEnv(probe.command, probeEnv)

			// C1-CORRECTION01: P0-sensitive kernel-deny and network-deny
			// probes use a CAUSAL PAIR (CONTROL + TEST) instead of a
			// single sandboxed run. The CONTROL leg runs unsandboxed to
			// confirm the operation is possible; the TEST leg runs
			// sandboxed to confirm the kernel/network denies it.
			const requiresCausalPair =
				probe.p0Sensitive && (probe.expected === "kernel-deny" || probe.expected === "network-deny")

			let result: DogfoodProbeResult
			if (requiresCausalPair) {
				result = await runCausalPairProbe({
					probe,
					resolvedCommand,
					probeEnv,
					inputs,
					workspaceRoots,
					localPort,
					readonlyProbePath,
				})
			} else {
				result = await runSingleLegProbe({
					probe,
					resolvedCommand,
					probeEnv,
					inputs,
					workspaceRoots,
					primaryManager: (primaryManager ??= inputs.createCommandJobManager(workspaceRoots, probe.id)),
				})
			}
			results.push(result)

			switch (result.classification) {
				case "PASS":
					passCount++
					break
				case "EXPECTED_DENY":
					expectedDenyCount++
					break
				case "COMPATIBILITY_FAIL":
					compatFailCount++
					break
				case "TOOL_MISSING":
					toolMissingCount++
					break
				case "TIMEOUT":
					timeoutCount++
					break
				case "P0_SECURITY_FAIL":
					p0FailCount++
					break
				case "P0_CAUSAL_PAIR_FAIL":
					causalPairFailCount++
					break
			}

			if (isP0Failure(probe, result.classification)) {
				p0Halted = true
				haltedAtProbeId = probe.id
				break
			}
		}
	} finally {
		if (primaryManager) {
			await primaryManager.dispose().catch(() => {
				// best-effort cleanup
			})
		}
		try {
			listener.server.close()
		} catch {
			// best-effort
		}
		if (ownedScratchDir) {
			try {
				rmSync(scratchDir, { recursive: true, force: true })
			} catch {
				// best-effort
			}
		}
		try {
			if (existsSync(readonlyProbePath)) {
				rmSync(readonlyProbePath, { force: true })
			}
		} catch {
			// best-effort
		}
		// Restore the prior sandbox opt-in env var (if any).
		if (priorSandboxOptIn === undefined) {
			delete process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
		} else {
			process.env[DOGFOOD_SANDBOX_OPTIN_ENV] = priorSandboxOptIn
		}
	}

	const summary: DogfoodRunSummary = {
		manifestVersion: MANIFEST_VERSION,
		manifestSha256: manifestSha,
		total: DOGFOOD_PROBE_MANIFEST.length,
		pass: passCount,
		expectedDeny: expectedDenyCount,
		compatibilityFail: compatFailCount,
		toolMissing: toolMissingCount,
		timeout: timeoutCount,
		p0Fail: p0FailCount,
		causalPairFail: causalPairFailCount,
		p0Halted,
		haltedAtProbeId,
	}

	const out: DogfoodRunResult = {
		summary,
		results,
		policyMatrix,
	}

	if (p0Halted) {
		const failingProbe = results[results.length - 1]
		throw new DogfoodSecurityInvariantHalt(summary, results, failingProbe)
	}

	return out
}

/**
 * Convenience: write a DogfoodRunResult to a directory of artifacts.
 * Used by C2 to emit the JSONL / summary.json / policy-matrix.tsv
 * files. The ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01 evidence
 * dir is the canonical destination.
 */
/**
 * Run a non-causal-pair probe through a single CommandJobManager
 * invocation. Used for all probes that do not have p0Sensitive
 * `kernel-deny` or `network-deny` semantics — i.e. success /
 * informational / secret-absent / non-p0 kernel-deny probes.
 *
 * The `primaryManager` is shared across all single-leg probes in a
 * run (one factory call per `runDogfood`). The causal-pair probes
 * each construct their own managers (factory called 2x per causal
 * probe) so they can flip sandbox opt-in for each leg.
 */
async function runSingleLegProbe(args: {
	probe: DogfoodProbe
	resolvedCommand: string
	probeEnv: Record<string, string>
	inputs: DogfoodRunnerInputs
	workspaceRoots: readonly string[]
	primaryManager: CommandJobManager
}): Promise<DogfoodProbeResult> {
	const { probe, resolvedCommand, probeEnv, primaryManager, inputs } = args
	// C1-CORRECTION03: notify the test seam of the probe id BEFORE
	// each manager.start() call. Production callers omit
	// inputs.onProbeStart, so this is a no-op for them. The test
	// fake uses this to set `currentProbeId` for the upcoming
	// spec capture.
	inputs.onProbeStart?.(probe.id)
	const start = await primaryManager.start({
		command: resolvedCommand,
		cwd: inputs.cwd,
		env: probeEnv,
		waitBudgetMs: probe.timeoutMs,
		executionDeadlineMs: Math.max(probe.timeoutMs, Math.min(DEFAULT_EXECUTION_DEADLINE_MS, probe.timeoutMs * 2)),
	})
	const stdoutSha = sha256(start.stdout ?? "")
	const stderrClass = classifyStderr(start.stderr ?? "", start.stdout ?? "")
	const cls = classifyProbeResult(probe, {
		state: start.state,
		exitCode: start.exitCode,
		signal: start.signal,
		stdout: start.stdout ?? "",
		stderr: start.stderr ?? "",
	})
	return {
		id: probe.id,
		domain: probe.domain,
		command: probe.command,
		expected: probe.expected,
		p0Sensitive: probe.p0Sensitive,
		state: start.state,
		exitCode: start.exitCode ?? null,
		signal: start.signal ?? null,
		classification: cls,
		stdoutSha256: stdoutSha,
		stderrClass,
		observedStdoutExcerpt: (start.stdout ?? "").slice(0, 256),
		durationMs: start.elapsedMs,
	}
}

/**
 * Run a P0-sensitive `kernel-deny` or `network-deny` probe as a
 * CAUSAL PAIR (C1-CORRECTION01).
 *
 * Two legs are run, each through a freshly-constructed
 * CommandJobManager because the production default resolver reads
 * the sandbox opt-in env var at construction time:
 *
 *   1. CONTROL leg: sandbox OFF. Must produce the structural
 *      signal (sentinel bytes change for kernel-deny; response
 *      token in stdout for network-deny) — proving the operation
 *      is possible without the sandbox.
 *
 *   2. TEST leg: sandbox ON. Must produce the expected-deny
 *      signature (EPERM on stderr for kernel-deny; no response
 *      token AND non-zero exit for network-deny).
 *
 * The verdict is computed by {@link classifyCausalPairProbe}.
 * If the CONTROL leg fails, the runner records
 * P0_CAUSAL_PAIR_FAIL (a halt trigger because every current
 * kernel-deny / network-deny P0 probe is p0Sensitive).
 */
async function runCausalPairProbe(args: {
	probe: DogfoodProbe
	resolvedCommand: string
	probeEnv: Record<string, string>
	inputs: DogfoodRunnerInputs
	workspaceRoots: readonly string[]
	localPort: number
	readonlyProbePath: string
}): Promise<DogfoodProbeResult> {
	const { probe, resolvedCommand, probeEnv, inputs, workspaceRoots, readonlyProbePath } = args

	// Write the kernel-deny sentinel BEFORE the CONTROL leg so each
	// causal-paired probe gets a fresh baseline.
	const preSha = probe.expected === "kernel-deny" ? prepareKernelDenySentinel(readonlyProbePath).preSha : ""

	// --- CONTROL LEG: sandbox OFF ---
	const priorOptIn = process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
	delete process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
	const controlManager = inputs.createCommandJobManager(workspaceRoots, probe.id)
	let controlLeg: CausalPairLeg
	try {
		controlLeg = await runCausalPairLeg({
			role: "control",
			probe,
			resolvedCommand,
			probeEnv,
			manager: controlManager,
			inputs,
			readonlyProbePath,
			preSha,
		})
	} finally {
		await controlManager.dispose().catch(() => {
			/* best-effort */
		})
		if (priorOptIn === undefined) {
			delete process.env[DOGFOOD_SANDBOX_OPTIN_ENV]
		} else {
			process.env[DOGFOOD_SANDBOX_OPTIN_ENV] = priorOptIn
		}
	}

	// C1-CORRECTION02: RESTORE the ORIGINAL baseline bytes between
	// CONTROL and TEST. Without this restore, the TEST leg's
	// post-state would already differ from the baseline (the
	// CONTROL leg overwrote it), and any "state conserved" check
	// would be contaminated. After restore, the TEST leg's job is
	// to attempt the write AND leave the baseline intact AND emit
	// EPERM — the same high-quality discriminator C3 used.
	if (probe.expected === "kernel-deny") {
		prepareKernelDenySentinel(readonlyProbePath)
	}

	// --- TEST LEG: sandbox ON (per inputs.sandboxOptIn) ---
	if (inputs.sandboxOptIn) {
		process.env[DOGFOOD_SANDBOX_OPTIN_ENV] = DOGFOOD_SANDBOX_OPTIN_VALUE
	}
	const testManager = inputs.createCommandJobManager(workspaceRoots, probe.id)
	let testLeg: CausalPairLeg
	try {
		testLeg = await runCausalPairLeg({
			role: "test",
			probe,
			resolvedCommand,
			probeEnv,
			manager: testManager,
			inputs,
			readonlyProbePath,
			preSha,
		})
	} finally {
		await testManager.dispose().catch(() => {
			/* best-effort */
		})
	}

	const cls = classifyCausalPairProbe(probe, controlLeg, testLeg)

	const stdoutExcerpt = (testLeg.stdoutExcerpt + "\n[CONTROL] " + controlLeg.stdoutExcerpt).slice(0, 512)
	const stderrExcerpt = (testLeg.stderrExcerpt + "\n[CONTROL] " + controlLeg.stderrExcerpt).slice(0, 512)
	const stderrClass = classifyStderr(testLeg.stderrExcerpt, testLeg.stdoutExcerpt)
	const stdoutSha = sha256(testLeg.stdoutExcerpt)

	const notes =
		`causal pair: control=${controlLeg.exitCode === 0 && controlLeg.controlSignalObserved ? "OK" : "FAIL"}` +
		`, test_deny=${testLeg.denySignatureObserved}, test_conserved=${testLeg.stateConserved}`

	return {
		id: probe.id,
		domain: probe.domain,
		command: probe.command,
		expected: probe.expected,
		p0Sensitive: probe.p0Sensitive,
		state: testLeg.exitCode === null ? "deadline_exceeded" : "exited",
		exitCode: testLeg.exitCode,
		signal: null,
		classification: cls,
		stdoutSha256: stdoutSha,
		stderrClass,
		observedStdoutExcerpt: stdoutExcerpt,
		durationMs: controlLeg.durationMs + testLeg.durationMs,
		notes,
		causalPair: {
			control: controlLeg,
			test: testLeg,
		},
	}
}

/**
 * Run one leg (CONTROL or TEST) of a causal pair.
 */
async function runCausalPairLeg(args: {
	role: "control" | "test"
	probe: DogfoodProbe
	resolvedCommand: string
	probeEnv: Record<string, string>
	manager: CommandJobManager
	inputs: DogfoodRunnerInputs
	readonlyProbePath: string
	preSha: string
}): Promise<CausalPairLeg> {
	const { role, probe, resolvedCommand, probeEnv, manager, inputs, readonlyProbePath, preSha } = args
	// C1-CORRECTION03: notify the test seam of the probe id BEFORE
	// each manager.start() call. The test fake uses this to set
	// `currentProbeId` so the spec capture records the correct
	// probe id (CONTROL and TEST legs both fire this).
	inputs.onProbeStart?.(probe.id)
	const start = await manager.start({
		command: resolvedCommand,
		cwd: inputs.cwd,
		env: probeEnv,
		waitBudgetMs: probe.timeoutMs,
		executionDeadlineMs: Math.max(probe.timeoutMs, Math.min(DEFAULT_EXECUTION_DEADLINE_MS, probe.timeoutMs * 2)),
	})

	const stdout = start.stdout ?? ""
	const stderr = start.stderr ?? ""

	let controlSignalObserved = false
	let denySignatureObserved = false
	let stateConserved = false

	if (probe.expected === "kernel-deny") {
		const postSha = existsSync(readonlyProbePath) ? sha256(readFileSync(readonlyProbePath)) : ""
		controlSignalObserved = postSha !== preSha
		denySignatureObserved = stderr.includes("Operation not permitted") || stdout.includes("Operation not permitted")
		// C1-CORRECTION02: the TEST leg must leave the sentinel
		// at the ORIGINAL baseline bytes (the runner restores the
		// baseline between CONTROL and TEST). The CONTROL leg
		// writes fresh bytes, so its post-state is NEVER
		// state-conserved.
		stateConserved = postSha === preSha && existsSync(readonlyProbePath)
	} else if (probe.expected === "network-deny") {
		controlSignalObserved = stdout.includes(DOGFOOD_NETWORK_RESPONSE_TOKEN)
		denySignatureObserved = !stdout.includes(DOGFOOD_NETWORK_RESPONSE_TOKEN) && (start.exitCode ?? 0) !== 0
		// network-deny probes do not have a sentinel; state
		// conservation is N/A. Set true to avoid spurious
		// P0_SECURITY_FAIL signals.
		stateConserved = true
	}

	return {
		role,
		exitCode: start.exitCode ?? null,
		denySignatureObserved,
		controlSignalObserved,
		stateConserved,
		stdoutExcerpt: stdout.slice(0, 256),
		stderrExcerpt: stderr.slice(-256),
		durationMs: start.elapsedMs,
	}
}

/**
 * Convenience: write a DogfoodRunResult to a directory of artifacts.
 * Used by C2 to emit the JSONL / summary.json / policy-matrix.tsv
 * files. The ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01 evidence
 * dir is the canonical destination.
 */
export async function writeRunArtifacts(outDir: string, run: DogfoodRunResult): Promise<void> {
	// C1-CORRECTION04: ensure the evidence dir exists. Drivers and
	// unit tests should pre-create it, but the writer is robust to
	// the absent-directory case so a missing dir never silently
	// swallows evidence on P0 halt. `mode: 0o700` keeps evidence
	// readable only by the user (secrets may appear in
	// `probe-results.jsonl` if a probe leaks its env).
	if (!existsSync(outDir)) {
		mkdirSync(outDir, { recursive: true, mode: 0o700 })
	}
	const jsonl = run.results.map((r) => JSON.stringify(r)).join("\n")
	writeFileSync(join(outDir, "probe-results.jsonl"), jsonl, "utf8")
	writeFileSync(join(outDir, "summary.json"), JSON.stringify(run.summary, null, 2), "utf8")
	const tsv = ["probe_id\tpolicy_kind\tpolicy_source"]
	for (const row of run.policyMatrix) {
		tsv.push(`${row.id}\t${row.policyKind}\t${row.policySource}`)
	}
	writeFileSync(join(outDir, "policy-matrix.tsv"), tsv.join("\n"), "utf8")
}
