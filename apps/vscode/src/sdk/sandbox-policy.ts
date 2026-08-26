/**
 * ACT-CLINEMM-COMMAND-SANDBOX-PRODUCTION-OPTIN-INTEGRATION01
 *
 * Sandbox policy module: opt-in discriminator, backend resolver, and
 * Wave-1 capability builder for the production command-execution seam.
 *
 * This module is the ONLY place where `CommandJobManager` reaches into
 * the sandbox abstraction. The rest of the executor stays agnostic.
 *
 * ===========================================================================
 * DEPENDENCY INJECTION (DI) SEAM
 * ===========================================================================
 *
 * Production default: `defaultSandboxBackendResolver` wraps
 * `getSandboxBackend` from `@cline/core` and honors the
 * `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt` opt-in env var.
 *
 * Tests inject a custom resolver to:
 *   - Force substrate-unavailable (returns undefined)
 *   - Inject a failing backend (prepare throws SandboxError)
 *   - Spy on what was prepared / how it was passed to the supervisor
 *
 * This keeps `CommandJobManager` decoupled from the abstraction's
 * internal availability probes and from Seatbelt-specific concepts
 * (sandbox-exec, SBPL, etc.). The constructor accepts the resolver
 * and the executor uses it opaquely.
 *
 * ===========================================================================
 * WAVE-1 CAPABILITY SCOPE
 * ===========================================================================
 *
 * `buildExperimentalReconCapability` builds a CONSERVATIVE, non-network
 * capability suitable for read-only recon:
 *
 *   readonlyRoots = workspace roots          (write-deny regions)
 *   writableRoots = []                       (no writes allowed)
 *   denyReadSubpaths = []                    (read confidentiality is a
 *                                              later concern; the
 *                                              backend's broad-read
 *                                              policy plus writable
 *                                              isolation is enough
 *                                              for Wave-1)
 *   network = "deny"                         (no network in Wave-1)
 *   environment.mode = "sanitized"           (CORRECTION01-P1 contract:
 *                                              envSemantics will be
 *                                              "complete")
 *   environment.allow = SAFE_ENVIRONMENT_BASELINE
 *
 * This is INTENTIONALLY NAMED "recon" and not "read-only workspace":
 *   - file reads are broadly allowed (Seatbelt's
 *     `(allow file-read*)` plus writable-deny on the workspace root);
 *     we do NOT confine reads to the workspace.
 *   - the workspace roots are the WRITE-confined regions, not the
 *     READ-confined region. A more restrictive builder (with explicit
 *     `denyReadSubpaths` for credential directories etc.) is a
 *     downstream concern, addressed when Wave-1 finds what needs
 *     denying.
 */

import { existsSync, realpathSync } from "node:fs"
import {
	type CommandCapability,
	getSandboxBackend,
	readExperimentalSandboxOptIn,
	SAFE_ENVIRONMENT_BASELINE,
	type SandboxBackend,
	type SandboxMode,
} from "@cline/core"

/**
 * DI seam: maps a {@link SandboxMode} to a backend instance.
 *
 * Returns `undefined` to signal "no backend applies" — the executor
 * MUST treat this as fail-closed (`spawn_failed` with a sandbox-
 * unavailable signal), NOT as a fallback to unsandboxed execution.
 *
 * This contract is identical to `getSandboxBackend` from `@cline/core`;
 * the wrapper exists so tests can inject a stub without coupling the
 * executor to the abstraction's internal probes.
 */
export type SandboxBackendResolver = (mode: SandboxMode) => Promise<SandboxBackend | undefined>

/**
 * The current experimental opt-in knob. Today this is the only
 * recognized opt-in source.
 *
 * Returns `undefined` when the env var is unset, when the value is
 * unrecognized (only `"seatbelt"` is recognized), or when the value is
 * a fuzzy truthy that does not match the exact expected form.
 *
 * Any unrecognized or absent opt-in MUST be treated as `disabled`
 * (DEFAULT_OFF). The executor never falls back from disabled to
 * sandboxed based on inferred intent.
 */
export function resolveExperimentalSandboxMode(): SandboxMode | undefined {
	const optIn = readExperimentalSandboxOptIn()
	if (!optIn) {
		return undefined
	}
	return optIn.mode
}

/**
 * ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01.
 *
 * Network-only opt-in knob. When `CLINEMM_SAFE_YOLO_NETWORK=allow` is
 * set AND Seatbelt is the active experimental sandbox mode, the
 * capability built by {@link buildExperimentalReconCapability} flips
 * `network` from `"deny"` to `"allow"`. The Seatbelt profile
 * generator already emits the semantically correct `(allow network*)`
 * rule for `network: "allow"`; this function ONLY selects which value
 * reaches the capability.
 *
 * Returns `"allow"` only when BOTH:
 *   1. `process.env.CLINEMM_SAFE_YOLO_NETWORK === "allow"` (exact).
 *   2. The active experimental mode is `"seatbelt-experimental"` AND
 *      the env opt-in is recognized (see {@link resolveExperimentalSandboxMode}).
 *
 * Any other value, unset var, or absent Seatbelt opt-in returns
 * `undefined` (no-op). Default behavior (`network: "deny"`) is
 * UNCHANGED when this function returns `undefined`.
 *
 * NOT a generic security opt-out: filesystem policy is unaffected.
 * NOT coupled to classic approval: autoApprove / YOLO are unaffected.
 */
export function resolveSafeYoloNetworkOptIn(): "allow" | undefined {
	if (process.env.CLINEMM_SAFE_YOLO_NETWORK !== "allow") {
		return undefined
	}
	if (resolveExperimentalSandboxMode() !== "seatbelt-experimental") {
		return undefined
	}
	return "allow"
}

/**
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01-CORRECTION01
 *
 * Network-open credential read guard: returns the curated set of
 * canonical paths that {@link buildExperimentalReconCapability} will
 * add to the capability's `denyReadSubpaths` field.
 *
 * ===========================================================================
 * CORRECTED INVARIANT (CORRECTION01)
 * ===========================================================================
 *
 * SAFE_YOLO_SENSITIVE_READ_GUARD_V1:
 *
 *   Seatbelt experimental + unrestricted network
 *     → CURATED_CREDENTIAL_SET_V1 read-denied
 *
 *   independent of:
 *     manual / safe-only / YOLO approval mode
 *     `hostAuthorization.mode`
 *     session override (none / all / ...)
 *
 * The previous prose labelled this a "YOLO-targeted guard" with a
 * threat model of "YOLO + unrestricted network → exfiltration". That
 * framing was the source of the SECURITY_SCOPE_MISMATCH the reviewer
 * raised in SRC01 closure: it suggested YOLO was load-bearing for
 * activation, when in fact the implementation (and the corrected
 * intent) is that the **dangerous capability — open network + readable
 * credentials — is what triggers the deny list**, regardless of
 * whether an approval dialog fired first.
 *
 * The architectural separation is preserved:
 *
 *   approval authorization  ≠  Seatbelt capability
 *
 * Whether the user has to click "approve" before running
 *
 *   cat ~/.ssh/id_ed25519 | curl ...
 *
 * does not remove the exfiltration capability. The deny list follows
 * the capability, not the authorization.
 *
 * ===========================================================================
 * CURATED CREDENTIAL SET V1 (Phase-2 freeze, do NOT exceed)
 * ===========================================================================
 *
 *   DENY:
 *     ~/.ssh/id_rsa
 *     ~/.ssh/id_ecdsa
 *     ~/.ssh/id_ecdsa_sk
 *     ~/.ssh/id_ed25519
 *     ~/.ssh/id_ed25519_sk
 *     ~/.ssh/id_mldsa44_ed25519    (OpenSSH 9.9+ post-quantum hybrid)
 *     ~/.gnupg/private-keys-v1.d/
 *
 *   KEEP_READABLE (NOT in deny list):
 *     ~/.ssh/config
 *     ~/.ssh/known_hosts
 *     ~/.ssh/known_hosts2
 *
 *   DEFER_AUTHENTICATED_DEV_CREDENTIALS (NOT in this list):
 *     ~/.aws/{credentials,config,cli/cache/}
 *     ~/.kube/config
 *     ~/.docker/config.json
 *     ~/.config/gh/hosts.yml
 *
 * Claim boundary (per reviewer, do NOT exceed): standard OpenSSH
 * private identities + GnuPG secret-key store only.
 *
 * ===========================================================================
 * EMISSION PATTERN
 * ===========================================================================
 *
 * Pattern: file-level `(subpath "<file>")` for each identity file,
 * directory-level `(subpath "<dir>")` for the GnuPG private-keys
 * directory. The Seatbelt profile generator emits the broad
 * `(allow file-read*)` first and then the targeted
 * `(deny file-read* (subpath X))` per entry. This avoids the
 * parent-deny/child-allow precedence hazard documented at
 * openai/codex#21081 (broader parent denies can shadow more-specific
 * descendant allows on macOS Seatbelt).
 *
 * ===========================================================================
 * NETWORK-DENY BRANCH
 * ===========================================================================
 *
 * When the Seatbelt experimental mode is active but the Safe-YOLO
 * network opt-in is NOT set (default-off posture), the deny list
 * returns `[]` -- the historical broad-read contract is preserved.
 * This is the expected behavior because the threat model requires
 * open network to make credential reads dangerous; under network-deny
 * Seatbelt, reads of credential files cannot reach an exfiltration
 * sink and the historical contract holds.
 *
 * Returns `[]` when the experimental Seatbelt mode is not active
 * (defensive -- preserves current behavior on Linux/Windows hosts
 * where the Wave-1 capability is never reached).
 */
export function resolveSafeYoloSensitiveReadDenials(): readonly string[] {
	// Network-open credential read guard (CORRECTION01).
	//
	// Activation predicate (the CORRECTED intent, not "YOLO-targeted"):
	//
	//   Seatbelt experimental mode active
	//     AND
	//   Safe-YOLO network opt-in is "allow"
	//
	// Independent of `hostAuthorization.mode`, session override,
	// and the YOLO/approval path. The implementation has always had
	// this shape; CORRECTION01 only corrects the *documentation*
	// to match the implementation, which is the safer behavior.
	//
	// Threat model: "open network + readable credentials → exfiltration".
	// Without unrestricted network, credential reads cannot reach an
	// external sink and the historical broad-read contract holds.
	if (resolveExperimentalSandboxMode() !== "seatbelt-experimental") {
		return []
	}
	if (resolveSafeYoloNetworkOptIn() !== "allow") {
		return []
	}
	const home = process.env.HOME
	if (!home) {
		return []
	}
	// realpathSync resolves the user's home through any symlinks (e.g.
	// /Users/me -> /Users/me). The seatbelt backend's
	// canonicalizeSandboxRoot also canonicalizes these before
	// emission, so this is defensive but not load-bearing.
	let canonicalHome: string
	try {
		// realpathSync is called synchronously here because
		// buildExperimentalReconCapability is itself synchronous
		// and the capability builder cannot await.
		canonicalHome = realpathSync(home)
	} catch {
		canonicalHome = home
	}
	const candidates = [
		`${canonicalHome}/.ssh/id_rsa`,
		`${canonicalHome}/.ssh/id_ecdsa`,
		`${canonicalHome}/.ssh/id_ecdsa_sk`,
		`${canonicalHome}/.ssh/id_ed25519`,
		`${canonicalHome}/.ssh/id_ed25519_sk`,
		`${canonicalHome}/.ssh/id_mldsa44_ed25519`,
		`${canonicalHome}/.gnupg/private-keys-v1.d`,
	]
	// Production semantics: only emit denypaths that EXIST. The Seatbelt
	// backend's canonicalizeSandboxRoot uses realpathSync which fails
	// fail-closed on ENOENT; emitting a non-existent path would fail
	// the sandbox preparation for every dev who has only `id_ed25519`
	// (no `id_ecdsa`, `id_ecdsa_sk`, etc.). Filter to existing paths.
	return candidates.filter((p) => {
		try {
			return existsSync(p)
		} catch {
			return false
		}
	})
}

/**
 * Production default resolver. Returns the Seatbelt backend iff:
 *   1. mode === "seatbelt-experimental"
 *   2. opt-in env is recognized
 *   3. Seatbelt substrate is available (cached availability probe)
 *
 * Returns `undefined` otherwise. Never throws.
 */
export const defaultSandboxBackendResolver: SandboxBackendResolver = async (mode) => {
	if (mode === "disabled") {
		// Disabled mode → no backend. The executor takes the legacy path.
		return undefined
	}
	if (mode === "seatbelt-experimental") {
		const optIn = readExperimentalSandboxOptIn()
		if (!optIn) {
			// Opt-in gate: env var wasn't set to "seatbelt".
			return undefined
		}
		return await getSandboxBackend(mode, optIn)
	}
	// Unknown mode (defensive).
	return undefined
}

/**
 * Build a Wave-1 experimental recon capability.
 *
 * Naming convention: this is a RECON capability, not a "workspace
 * read-only" capability. The workspace roots are the WRITE-confined
 * regions. Reads are broadly allowed per the underlying Seatbelt
 * contract (broad read allow + write-deny regions).
 *
 * Returns a fresh capability object on every call; safe to mutate.
 *
 * @param cwd canonical cwd for the command (must exist on the host)
 * @param workspaceRoots canonical absolute paths under which writes
 *                       are FORBIDDEN (treated as readonlyRoots). Pass
 *                       the actual workspace tree so the kernel
 *                       denies any write attempt under it.
 */
export function buildExperimentalReconCapability(input: {
	readonly cwd: string
	readonly workspaceRoots: readonly string[]
}): CommandCapability {
	return {
		readonlyRoots: [...input.workspaceRoots],
		writableRoots: [],
		// ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01
		// ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01-CORRECTION01:
		//
		// Populate denyReadSubpaths with the network-open credential
		// read guard. The helper returns the curated V1 set whenever
		// Seatbelt experimental mode is active AND the Safe-YOLO
		// network opt-in is set, regardless of approval mode / YOLO /
		// session override. The dangerous capability is what triggers
		// the deny list, not the authorization dialog.
		//
		// This is the SOLE production-code change in SRC01. The
		// Seatbelt profile generator already emits
		// `(allow file-read*) + (deny file-read* (subpath X))` per
		// entry; no change to seatbelt-profile.ts, seatbelt-backend.ts,
		// CommandJobManager, or approval/YOLO logic.
		denyReadSubpaths: [...resolveSafeYoloSensitiveReadDenials()],
		// ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01: honor the
		// `CLINEMM_SAFE_YOLO_NETWORK=allow` opt-in. Default remains
		// `"deny"` (the conservative network posture). Filesystem
		// policy is unchanged either way.
		network: resolveSafeYoloNetworkOptIn() === "allow" ? "allow" : "deny",
		environment: {
			mode: "sanitized",
			// `allow` is a list of env var NAMES the sanitized env
			// is permitted to forward from the parent. The baseline
			// (PATH, LANG, TERM, ...) is enumerated here.
			allow: Object.keys(SAFE_ENVIRONMENT_BASELINE),
		},
		cwd: input.cwd,
	}
}
