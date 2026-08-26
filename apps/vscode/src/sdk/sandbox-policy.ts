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
		denyReadSubpaths: [],
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
