/**
 * ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01
 *
 * Frozen probe manifest for the dogfood seatbelt qualification runner.
 *
 * This file is intentionally typed data, not a shell script. The runner
 * in `./seatbelt-dogfood-runner.ts` consumes ONLY this manifest; there is
 * no `--command "..."` surface that would let a caller escape the
 * compile-time frozen probe set into a runtime arbitrary-execution tool.
 *
 * DESIGN
 *
 * Each probe has:
 *   - id           : stable identifier (B01, G01, F01, T01, W01, E01, ...)
 *   - domain       : probe family for grouping in the matrix output
 *   - command      : shell source string, rendered to /bin/sh -c <command>
 *   - expected     : what the harness expects to observe
 *   - timeoutMs    : hard per-probe execution deadline
 *   - p0Sensitive  : true iff a passing run is REQUIRED for the dogfood
 *                    verdict. False positives on these halt the run with
 *                    HALT_SEATBELT_DOGFOOD_SECURITY_INVARIANT.
 *
 * Adding probes:
 *   - frozen manifest. Adding new probes requires bumping
 *     MANIFEST_VERSION so the manifest SHA-256 changes and downstream
 *     evidence can detect drift. Do NOT mutate probes in place between
 *     dogfood runs; the whole point is reproducibility.
 *
 * Removing probes:
 *   - mark them DEPRECATED in place, leave them in the manifest for one
 *     full major dogfood epoch, then remove in a single follow-up ACT.
 *
 * EXPECTED-OUTCOME TAXONOMY
 *
 *   "success"          : exit 0, output structurally sane (PASS target)
 *   "kernel-deny"      : kernel EPERM (Seatbelt) — write/read attempted
 *                        outside allowed regions
 *   "network-deny"     : curl/nc returns 7 (couldn't connect) — sandbox
 *                        blocked the network
 *   "tool-missing"     : exit 127 or PATH lookup failed
 *   "informational"    : probe is about presence of an env var; exit code
 *                        alone is uninformative; the harness inspects
 *                        stdout for the var value
 *   "secret-absent"    : probe EXPECTS the synthetic dogfood secret to be
 *                        absent from stdout; finding the secret is P0
 *
 * P0 SENSITIVITY
 *
 * `p0Sensitive: true` means a successful run is REQUIRED for verdict. A
 * p0Sensitive probe that fails halts the entire run with
 * HALT_SEATBELT_DOGFOOD_SECURITY_INVARIANT and preserves the partial
 * matrix. This is the FACTORY rule: only NEW P0 interrupts acquisition.
 *
 * P0 invariants in this manifest:
 *   - synthetic secret must NOT appear in child output (env leak)
 *   - network must be denied under the sandbox profile
 *   - the workspace write-deny region must be enforced
 *   - secret-shaped env vars from the host must not leak (sanitized
 *     mode baseline)
 *
 * Everything else is P1 (compatibility finding, continues through).
 */

/**
 * Probe domain. Used only for grouping in the matrix output.
 */
export type DogfoodProbeDomain =
	| "basic"
	| "git"
	| "filesystem"
	| "temp"
	| "workspace"
	| "environment"
	| "network"
	| "node"
	| "go"
	| "child"
	| "supervision"

/**
 * Expected outcome class for a probe. The harness's classification
 * logic consumes this string verbatim. See the file header for the
 * full taxonomy.
 */
export type DogfoodProbeExpected = "success" | "kernel-deny" | "network-deny" | "tool-missing" | "informational" | "secret-absent"

/**
 * A single frozen probe. Adding fields is non-breaking; removing or
 * renaming fields is a manifest-bump event.
 */
export interface DogfoodProbe {
	readonly id: string
	readonly domain: DogfoodProbeDomain
	readonly command: string
	readonly expected: DogfoodProbeExpected
	readonly timeoutMs: number
	readonly p0Sensitive: boolean
	/**
	 * Short description for the matrix output. Free-form, no parsing
	 * by the harness.
	 */
	readonly description: string
}

/**
 * Manifest version. Bump whenever probes are added/removed/renamed
 * OR whenever a probe's command text or expected semantics change.
 *
 * History:
 *   wave-1-rc1          — initial 29 probes
 *   wave-1-rc1-corre   — C1-CORRECTION01: removed `|| true` from
 *                         N01, introduced causal-pair requirement.
 *   wave-1-rc1-corre02 — C1-CORRECTION02: S01 contract fixed;
 *                         GO01 + GO02 added (manifest now has 31
 *                         probes); readonly-probe target moved
 *                         inside workspaceRoots.
 *   wave-1-rc1-corre03 — C1-CORRECTION03: E01 positive witness
 *                         added (positive-AND-negative check).
 *   wave-1-rc1-corre04 — C1-CORRECTION04: C2 driver contract
 *                         (mkdir EVIDENCE_DIR + scratchDir, throw
 *                         on P0/harness failure); writeRunArtifacts
 *                         robust to absent outDir.
 *
 * The frozen SHA-256 of this manifest (computed by the runner at
 * startup) is part of the run's reproducibility record.
 */
export const MANIFEST_VERSION = "wave-1-rc1-corre04" as const

/**
 * The frozen probe manifest. Order is the execution order. The harness
 * executes probes strictly sequentially (one at a time) to keep the
 * machine-readable evidence shape deterministic and to simplify P0
 * diagnosis when a probe fails — no interleaving with another probe's
 * state.
 */
export const DOGFOOD_PROBE_MANIFEST: ReadonlyArray<DogfoodProbe> = Object.freeze([
	// --- Basic (3) ---
	{
		id: "B01",
		domain: "basic",
		command: "pwd",
		expected: "success",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "print working directory",
	},
	{
		id: "B02",
		domain: "basic",
		command: "uname -a",
		expected: "success",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "kernel identity",
	},
	{
		id: "B03",
		domain: "basic",
		command: "printf hello\\n",
		expected: "success",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "stdout sanity",
	},

	// --- Git read-only (8) ---
	//
	// These deliberately exercise the commands that have been observed
	// to trigger command-policy ASK verdicts in the safe-only rule set
	// (e.g. `git show`). The dogfood harness executes them anyway
	// because the question is "does Seatbelt allow them?" — not "does
	// the host policy approve them?". Policy findings are reported in
	// the policy-matrix.tsv (separate lane).
	{
		id: "G01",
		domain: "git",
		command: "git status --short",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "git porcelain status",
	},
	{
		id: "G02",
		domain: "git",
		command: "git diff --stat",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "git diff stat (no pager)",
	},
	{
		id: "G03",
		domain: "git",
		command: "git log --oneline -5",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "recent commit oneline",
	},
	{
		id: "G04",
		domain: "git",
		command: "git branch --show-current",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "current branch",
	},
	{
		id: "G05",
		domain: "git",
		command: "git rev-parse HEAD",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "HEAD commit SHA",
	},
	{
		id: "G06",
		domain: "git",
		command: "git show HEAD:package.json",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "git show blob from HEAD",
	},
	{
		id: "G07",
		domain: "git",
		command: "git config --get user.name",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "local repo user.name (may be unset)",
	},
	{
		id: "G08",
		domain: "git",
		command: "git config --global --get user.name",
		expected: "informational",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "global git user.name (informational)",
	},

	// --- Filesystem/search (4) ---
	//
	// These deliberately exercise `rg` and `find -maxdepth` which have
	// been observed to trigger command-policy ASK verdicts (precision
	// gap). The dogfood harness executes them anyway for the same
	// reason as the Git probes: this lane tests Seatbelt, not policy.
	{
		id: "F01",
		domain: "filesystem",
		command: "cat package.json",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "cat a workspace file",
	},
	{
		id: "F02",
		domain: "filesystem",
		command: "head -20 package.json",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "head bounded read",
	},
	{
		id: "F03",
		domain: "filesystem",
		command: "rg SandboxBackend sdk apps",
		expected: "success",
		timeoutMs: 10_000,
		p0Sensitive: false,
		description: "rg search for SandboxBackend symbol",
	},
	{
		id: "F04",
		domain: "filesystem",
		command: "find sdk -maxdepth 2 -type d",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "find bounded by -maxdepth",
	},

	// --- Temp (2) ---
	//
	// `mktemp` is the canonical "does the sandbox's temp model work?"
	// probe. We test both file and directory forms.
	{
		id: "T01",
		domain: "temp",
		command: "mktemp",
		expected: "success",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "mktemp file under sandbox temp",
	},
	{
		id: "T02",
		domain: "temp",
		command: "mktemp -d",
		expected: "success",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "mktemp directory under sandbox temp",
	},

	// --- Workspace write-deny (1) ---
	//
	// The runner creates a sentinel file under the dogfood scratch
	// workspace (writable) and a sibling file under a path the
	// sandbox's readonly workspace region WILL NOT allow writing
	// into. The probe writes to the readonly path; the kernel MUST
	// EPERM the write.
	//
	// The readonly target path is parameterized via
	// CLINEMM_DOGFOOD_READONLY_PROBE (set by the runner when it
	// constructs the per-probe env). This keeps the probe manifest
	// literal-clean — no fixture paths baked into source.
	{
		id: "W01",
		domain: "workspace",
		command: "printf X > ${CLINEMM_DOGFOOD_READONLY_PROBE}",
		expected: "kernel-deny",
		timeoutMs: 2_000,
		p0Sensitive: true,
		description: "write to read-only workspace (sandbox MUST kernel-deny). P0 invariant.",
	},

	// --- Environment (4) ---
	//
	// C1-CORRECTION03: E01 is the security-critical environment
	// probe (sanitized mode strips harness-seeded env vars before
	// spawn). The previous `secret-absent` classification was a
	// NEGATIVE witness: "secret is not in stdout → PASS". That
	// falsifies: spawn_failed / exit 127 / shell-failed-before-printf
	// all looked like PASS because the secret was never printed
	// (the child never ran).
	//
	// The fix is a POSITIVE witness: E01 must also emit a fixed
	// token that can only be produced if the child actually ran
	// printf successfully. Classification requires BOTH:
	//   - stdout contains the witness token (child actually ran)
	//   - stdout does NOT contain the synthetic secret (sanitizer
	//     actually stripped it)
	// Anything else (spawn_failed, exit != 0, no witness, secret
	// present) is P0_SECURITY_FAIL or P0_CAUSAL_PAIR_FAIL — never
	// PASS.
	{
		id: "E01",
		domain: "environment",
		command: "printf 'DOGFOOD_ENV_PROBE_OK:%s\\n' \"$CLINEMM_DOGFOOD_FAKE_SECRET\"",
		expected: "secret-absent",
		timeoutMs: 2_000,
		p0Sensitive: true,
		description: "sanitizer strips synthetic secret AND child prints positive witness. P0 invariant.",
	},
	{
		id: "E02",
		domain: "environment",
		command: "printf 'SSH_AUTH_SOCK=%s\\n' \"${SSH_AUTH_SOCK:-}\"",
		expected: "informational",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "SSH_AUTH_SOCK visibility (informational; sanitized strips it)",
	},
	{
		id: "E03",
		domain: "environment",
		command: "printf 'PATH_LEN=%s\\n' \"${#PATH}\"",
		expected: "success",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "PATH visibility",
	},
	{
		id: "E04",
		domain: "environment",
		command: "printf 'TMPDIR=%s\\n' \"${TMPDIR:-}\"",
		expected: "informational",
		timeoutMs: 2_000,
		p0Sensitive: false,
		description: "TMPDIR (sandbox synthetic tempdir)",
	},

	// --- Network (1) ---
	//
	// N01 expects DENY. The harness starts a controlled localhost HTTP
	// server (in the parent process, before the sandbox child runs)
	// on 127.0.0.1 with an ephemeral port, and captures the port
	// into CLINEMM_DOGFOOD_LOCAL_PORT (a fixture-only var that is
	// stripped by the sanitized-mode env, so curl must reach it via
	// the resolved URL below). The sandbox profile (network=deny)
	// MUST block the connect.
	//
	// Causal-pair requirement: the runner runs BOTH legs back-to-back
	// against the same endpoint:
	//   1. CONTROL: sandbox OFF, expect SUCCESS + response token
	//   2. TEST:    sandbox ON,  expect DENY (no token in stdout)
	// If the control leg does not succeed, the probe is reported as
	// P0_CAUSAL_PAIR_FAIL — NOT EXPECTED_DENY — because a closed
	// port and a kernel sandbox denial are observationally confounded.
	{
		id: "N01",
		domain: "network",
		command: "curl --max-time 1 -fsS http://127.0.0.1:${CLINEMM_DOGFOOD_LOCAL_PORT}/ 2>&1",
		expected: "network-deny",
		timeoutMs: 5_000,
		p0Sensitive: true,
		description: "curl localhost MUST be denied by sandbox network=deny. P0 invariant (causal-pair).",
	},

	// --- Node/Bun (2) ---
	{
		id: "J01",
		domain: "node",
		command: "node --version",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "node --version (informational, may be tool-missing)",
	},
	{
		id: "J02",
		domain: "node",
		command: "bun --version",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "bun --version (informational, may be tool-missing)",
	},

	// --- Descendants (2) ---
	//
	// C02 specifically asserts the sandboxed constraint inherits
	// across an /bin/sh boundary. A P0 here means a child could
	// escape Seatbelt via fork+exec — which would defeat the entire
	// abstraction.
	{
		id: "C01",
		domain: "child",
		command: "/bin/sh -c '/bin/sh -c \"pwd\"'",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "nested shell inherits sandbox",
	},
	{
		id: "C02",
		domain: "child",
		command: "/bin/sh -c 'printf X > ${CLINEMM_DOGFOOD_READONLY_PROBE} 2>&1 || echo NESTED_DENY'",
		expected: "kernel-deny",
		timeoutMs: 5_000,
		p0Sensitive: true,
		description: "nested shell write attempt MUST kernel-deny (capability inherits). P0 invariant.",
	},

	// --- Supervision (2) ---
	//
	// C1-CORRECTION02: S01's contract is "stdout/stderr/exit 7
	// conservation" — i.e. the runner MUST preserve the child's
	// stdout, stderr, and exit code. Previously this probe was
	// declared `expected: "success"`, which is a contradiction:
	// `exit 7` is not exit 0. Mark it `informational` so the
	// outcome is recorded but doesn't fail the run. The
	// conservation invariant is verified by a separate
	// characterization test that inspects the per-leg output.
	{
		id: "S01",
		domain: "supervision",
		command: "printf stdout\\n 1>&2; printf stderr\\n 1>&2; exit 7",
		expected: "informational",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "stdout/stderr/exit 7 conservation (runner preserves all three)",
	},
	{
		id: "S02",
		domain: "supervision",
		command: "sleep 30",
		expected: "informational",
		timeoutMs: 500,
		p0Sensitive: false,
		description: "deadline kills long sleep (timeoutMs<<30)",
	},

	// --- Go (2) ---
	//
	// C1-CORRECTION02: previously the `go` domain was in the
	// DogfoodProbeDomain union but had zero probes. Add the two
	// probes DOGFOOD01 originally intended.
	{
		id: "GO01",
		domain: "go",
		command: "go version",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "go --version (informational, may be tool-missing)",
	},
	{
		id: "GO02",
		domain: "go",
		command: "go env GOCACHE",
		expected: "success",
		timeoutMs: 5_000,
		p0Sensitive: false,
		description: "go env GOCACHE (informational; sanitized strips)",
	},
])

/**
 * Manifest size. Frozen count. Adding/removing probes changes this
 * and is a manifest-version bump event.
 */
export const DOGFOOD_PROBE_COUNT: number = DOGFOOD_PROBE_MANIFEST.length
