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
 * `getSandboxBackend` from `@cline/core`. The ClineMM-side selector
 * (`resolveExperimentalSandboxMode`) is now SECURE-BY-DEFAULT on
 * darwin hosts: unset / `""` / `"seatbelt"` all resolve to
 * `"seatbelt-experimental"`. The only recognized opt-out is the
 * explicit break-glass `CLINEMM_EXPERIMENTAL_SANDBOX=off`. See
 * `ACT-CLINEMM-SEATBELT-DEFAULT-ON01`.
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
 * `buildExperimentalReconCapability` builds the active workspace
 * capability (read+write grant for trusted workspace roots; nothing
 * wider):
 *
 *   readonlyRoots = []                       (workspace is NOT
 *                                              write-confined — see
 *                                              ACT-CLINEMM-SAFE-YOLO-
 *                                              WORKSPACE-WRITE01)
 *   writableRoots = workspace roots          (READ + WRITE under them)
 *   denyReadSubpaths = curated credential set when the Safe-YOLO
 *                                              network opt-in is
 *                                              active
 *   network = "deny" (default) | "allow" (opt-in)
 *   environment.mode = "sanitized"
 *   environment.allow = SAFE_ENVIRONMENT_BASELINE
 *
 * Reads are broadly allowed by the Seatbelt profile generator's
 * `(allow file-read*)` rule, then narrowed by `(deny file-read*
 * (subpath X))` for each entry in `denyReadSubpaths`. The workspace
 * does not appear in `denyReadSubpaths` (the dog's open directory is
 * always readable to the agent), and the credential deny list is
 * preserved independently so the network-open exfiltration guard is
 * not regressed by workspace-write enablement.
 */

import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import {
	type CommandCapability,
	getSandboxBackend,
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
 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 — ClineMM VS Code Seatbelt selector.
 *
 * The recognized values of `CLINEMM_EXPERIMENTAL_SANDBOX`:
 *
 *   Darwin host:
 *
 *     unset / `""` / `"seatbelt"` → `"seatbelt-experimental"`
 *       (secure default; the legacy opt-in string is still honored as
 *       an explicit / synonymous declaration of the same intent)
 *
 *     `"off"`                     → `undefined`
 *       (deliberate break-glass — classic execution)
 *
 *     any other non-empty string  → THROWS `InvalidSandboxConfigurationError`
 *       (fail closed: a misspelled env var must NOT silently disable
 *       Seatbelt; the user gets a clear configuration error instead
 *       of a quietly-disarmed sandbox)
 *
 *   Non-darwin host:
 *
 *     unset / `""`                → `undefined`
 *       (classic execution — there is no Seatbelt substrate to default
 *       to)
 *
 *     `"off"`                     → `undefined`
 *       (classic execution — explicit break-glass)
 *
 *     `"seatbelt"`                → THROWS `InvalidSandboxConfigurationError`
 *       (fail closed: Seatbelt is not available on this substrate;
 *       silently falling back to classic execution would defeat the
 *       operator's explicit request for sandboxing)
 *
 *     any other non-empty string  → THROWS `InvalidSandboxConfigurationError`
 *       (fail closed for the same reason)
 *
 * `CLINE_SANDBOX` is intentionally NOT read here. It is a CLI-side
 * variable with no production reach into the VS Code extension or the
 * SDK it consumes (see
 * `.factory/acts/se-001-phase0-cline-sandbox-ownership-freeze.md`).
 * Mapping it to Seatbelt would create a false alias and a silent
 * escape hatch via `CLINE_SANDBOX=0`.
 */
export function resolveExperimentalSandboxMode(): SandboxMode | undefined {
	const raw = process.env.CLINEMM_EXPERIMENTAL_SANDBOX

	if (process.platform !== "darwin") {
		if (raw === undefined || raw === "") {
			return undefined
		}
		if (raw === "off") {
			return undefined
		}
		throw new InvalidSandboxConfigurationError(
			`CLINEMM_EXPERIMENTAL_SANDBOX=${JSON.stringify(raw)} is not supported on platform '${process.platform}'. ` +
				`Seatbelt is darwin-only. Use 'off' or unset the variable to run in classic mode.`,
		)
	}

	// Darwin path.
	if (raw === "off") {
		return undefined
	}
	if (raw === undefined || raw === "" || raw === "seatbelt") {
		return "seatbelt-experimental"
	}
	throw new InvalidSandboxConfigurationError(
		`Invalid CLINEMM_EXPERIMENTAL_SANDBOX value: ${JSON.stringify(raw)}. ` +
			`Recognized values on darwin: unset, '' (empty), 'seatbelt', 'off'.`,
	)
}

/**
 * Thrown by {@link resolveExperimentalSandboxMode} when the env var
 * holds a value the selector cannot honor. Distinct error class so
 * upstream callers (the executor / command-job-manager) can
 * distinguish a configuration mistake from a substrate failure
 * (`SandboxError`) and from a runtime backend crash.
 *
 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 — fail closed on garbage
 * configuration. A typo must never silently disable Seatbelt.
 */
export class InvalidSandboxConfigurationError extends Error {
	override readonly name = "InvalidSandboxConfigurationError"
	constructor(message: string) {
		super(message)
	}
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
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 — host-side workspace-root
 * safety filter.
 *
 * The bounded workspace-write repair grants recursive READ+WRITE
 * under whichever paths the host supplies as the active workspace
 * trust boundary. That grant is exact and unforgiving — a path
 * listed in `writableRoots` becomes a (subpath) allow in SBPL. There
 * is no Seatbelt primitive that says "writable but not too writable".
 *
 * This filter is the production safety guard against a user who
 * opens `$HOME`, `/Users`, or `/` as their VSCode workspace folder.
 * Such a state would otherwise transitively grant write authority
 * over the entire user data, all sibling /Users accounts, or the
 * whole filesystem respectively — far beyond the intended bounded-
 * project use case.
 *
 * Filter rules (defense-in-depth; explicit by design):
 *
 *   - empty array  passes through verbatim
 *               (empty-window back-compat path; the rebuild places
 *                nothing on writableRoots, which is the prior
 *                "read-only workspace" behavior)
 *   - "/"          DROPPED  (do not widen to the entire filesystem)
 *   - $HOME        DROPPED  (do not widen to user-personal data)
 *   - HOME parent  DROPPED  (parent is /Users/<u> which would also
 *                           be dangerously broad if interpreted as
 *                           a project root)
 *
 *   - everything else passes through as the canonical form. The
 *     builder sees the canonicalized workspace boundary the host
 *     supplied, minus the explicitly-rejected wildcards.
 *
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01-CORRECTION01:
 *
 * The dangerous-path check is performed AGAINST THE CANONICAL form
 * (`realpathSync`) of the candidate root and of HOME / HOME-parent.
 * A symlink whose target is HOME, a `..` alias that resolves to
 * HOME, or a symlink to `/` MUST all be rejected. Failure to
 * canonicalize was the original review-blocking defect (the
 * exact-string comparison passed `/some/symlink -> /Users/me` and
 * later Seatbelt widening would have granted write authority).
 *
 * `realpathSync` throws on a non-existent or unreadable path; we
 * fail closed (drop) on any throw. This catches
 * `/not/a/real/path`, symlinks with dangling targets, and any
 * other host that feeds garbage into `workspaceRoots`.
 *
 * The filter is canonical-path-match against HOME, not a substring
 * check — a CHILD of HOME (e.g. `$HOME/projects-foo`) is a valid
 * bounded project and PASSES THROUGH (canonicalized). Children of
 * the workspace parent (e.g. `/Users/me/other-project`) are also
 * canonicalized independently and survive.
 *
 * Tests pin this in `darwin-seatbelt-safe-yolo-workspace-write01
 * .c1-green.test.ts` (HOST-FILTER-*).
 */
export function filterWorkspaceRootsForWritable(workspaceRoots: readonly string[]): readonly string[] {
	if (workspaceRoots.length === 0) return []
	// Canonicalize the dangerous paths through realpath so symlink chains
	// and `..` segments that resolve to HOME, HOME-parent, or `/` cannot
	// sneak past an exact-string comparison (ACT-CLINEMM-SAFE-YOLO-
	// WORKSPACE-WRITE01-CORRECTION01). realpathSync throws if the path
	// does not exist; we treat any throw as "fail closed" and drop the
	// root.
	let canonicalHome = homedir()
	try {
		canonicalHome = realpathSync(canonicalHome)
	} catch {
		// HOME unreadable / non-canonicalizable: leave as-is, the
		// canonicalHome === homeParent comparison is still semantically
		// correct for this rare path (the host is misconfigured).
	}
	let canonicalHomeParent = canonicalHome.split("/").slice(0, -1).join("/") || "/"
	if (canonicalHomeParent === "") canonicalHomeParent = "/"
	const unsafeCanonical = new Set<string>(["/", canonicalHome, canonicalHomeParent])
	const out: string[] = []
	for (const root of workspaceRoots) {
		if (typeof root !== "string") continue
		const trimmed = root.trim()
		if (trimmed.length === 0) continue
		let canonical: string
		try {
			canonical = realpathSync(trimmed)
		} catch {
			// Path does not exist or is unreadable -- fail closed.
			continue
		}
		if (unsafeCanonical.has(canonical)) continue
		out.push(canonical)
	}
	return out
}

/**
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01 — host-side workspace-roots
 * resolver.
 *
 * Reads the active workspace folder paths from the hostbridge and
 * runs them through {@link filterWorkspaceRootsForWritable} to drop
 * `$HOME`, HOME parent, and `/`.
 *
 * Returns `[]` (empty) when:
 *   - the hostbridge is not initialized (e.g. unit-test contexts
 *     that build `VscodeSessionHost` directly without going through
 *     the real VS Code extension host). This preserves the prior
 *     "empty workspaceRoots = nothing writable except /dev/null"
 *     contract for those callers.
 *   - the host reports no open workspace folders.
 *
 * Tests pin this in
 * `darwin-seatbelt-safe-yolo-workspace-write01.c1-green.test.ts`
 * (HOST-FILTER-*) — the safety filter is the load-bearing test
 * target; the hostbridge call itself is exercised end-to-end by the
 * C2 / Phase-9 live dogfood evidence.
 */
export async function resolveActiveWorkspaceRootsForSandbox(): Promise<readonly string[]> {
	try {
		// Lazy import to keep @/hosts/host-provider out of the SDK
		// adapter's compile-time graph (CLI/JetBrains builds do not
		// link this module). On platforms where HostProvider is not
		// present, the catch block returns [].
		const mod = await import("@/hosts/host-provider")
		if (typeof mod.HostProvider?.isInitialized === "function" && !mod.HostProvider.isInitialized()) {
			return []
		}
		const workspaceClient = mod.HostProvider?.workspace
		if (!workspaceClient) return []
		const { paths } = await workspaceClient.getWorkspacePaths({})
		return filterWorkspaceRootsForWritable(paths ?? [])
	} catch {
		// HostProvider module not resolvable (CLI/JetBrains/test
		// contexts). Fall back to the prior empty-workspace contract.
		return []
	}
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
 * Production default resolver for the ClineMM VS Code extension.
 *
 * ACT-CLINEMM-SEATBELT-DEFAULT-ON01 (CORRECTION02): the VS Code-side
 * selector (`resolveExperimentalSandboxMode`) is the SOLE authority
 * for whether Seatbelt is the active mode. Once that selector chose
 * `"seatbelt-experimental"` (which is now the secure default on
 * darwin when the env var is unset / empty / "seatbelt"), the
 * resolver EXPLICITLY supplies the opt-in argument to the dispatcher
 * — it does NOT consult the shared SDK helper
 * `readExperimentalSandboxOptIn()`, which intentionally preserves
 * its historical opt-in-only semantics for non-VS-Code consumers
 * (CLI, JetBrains, SDK embeddings, non-darwin hosts).
 *
 * Returning a Seatbelt backend in this resolver never falls back to
 * classic execution; the executor takes the prepared invocation as
 * the only authoritative source. The shared SDK helper is therefore
 * not on the hot path for the VS Code extension.
 *
 * Returns the Seatbelt backend iff:
 *   1. mode === "seatbelt-experimental" (the only mode that ever
 *      reaches this resolver, since `resolveExperimentalSandboxMode`
 *      is the single upstream caller in `CommandJobManager.start`)
 *   2. Seatbelt substrate is available (cached availability probe
 *      inside `getSandboxBackend`)
 *
 * Returns `undefined` otherwise. Never throws.
 */
export const defaultSandboxBackendResolver: SandboxBackendResolver = async (mode) => {
	if (mode === "disabled") {
		// The VS Code selector returned undefined (classic path).
		// No backend; the executor takes the legacy path.
		return undefined
	}
	if (mode === "seatbelt-experimental") {
		// ACT-CLINEMM-SEATBELT-DEFAULT-ON01 CORRECTION02: the VS Code
		// selector chose Seatbelt. Authorize the backend explicitly by
		// passing the opt-in argument directly, NOT via the shared SDK
		// helper (which keeps historical opt-in-only semantics for CLI /
		// JetBrains / SDK embeddings).
		return await getSandboxBackend(mode, { mode: "seatbelt-experimental" })
	}
	// Unknown mode (defensive). Never reached today, but guard against
	// a future selector expansion.
	return undefined
}

/**
 * Build a Wave-1 experimental capability.
 *
 * ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01:
 *   The trust boundary is the set of active workspace roots. The user
 *   (the dogfooder) opened this repository in their editor; everything
 *   recursively under it (including `.factory/...`, `.git/...`, etc.)
 *   is intended to be readable AND writable by the agent.
 *
 *   Seatbelt role of each field:
 *     readonlyRoots  → (deny file-write* (subpath X)) emitted AFTER
 *                      the write-allow rule. last-rule-wins: a root
 *                      in `readonlyRoots` becomes write-DENIED.
 *     writableRoots  → (allow file-write* (subpath X)) appended.
 *                      Reads are already granted by the broad
 *                      (allow file-read*) in buildReadRule().
 *
 *   Consequence: a root that lives in BOTH lists ends up write-DENIED
 *   (the deny wins). To grant workspace writes, this builder must NOT
 *   place the workspace into `readonlyRoots`; placing it in
 *   `writableRoots` is the minimal-correct representation.
 *
 *   Reads under the workspace come from the broad `(allow file-read*)`
 *   rule (buildReadRule) regardless of which list owns the root.
 *   Sensitive reads (CURATED_CREDENTIAL_SET_V1) are still DENIED via
 *   `denyReadSubpaths` because the deny-rule is emitted after the
 *   broad allow (last-rule-wins).
 *
 *   What this does NOT widen:
 *     - $HOME, parent paths, the workspace parent, and `/` are never
 *       added unless the caller explicitly names them. This builder
 *       is opaque: it forwards `input.workspaceRoots` verbatim into
 *       `writableRoots` (Phase-5 W2 invariant).
 *     - The credential deny list is independent and unchanged.
 *     - The network policy is unchanged (opt-in honored, "deny"
 *       default remains).
 *     - The environment mode is unchanged.
 *
 * Returns a fresh capability object on every call; safe to mutate.
 *
 * @param cwd canonical cwd for the command (must exist on the host)
 * @param workspaceRoots canonical absolute paths that the host has
 *                       pre-trusted as the active workspace boundary.
 *                       Each is added to `writableRoots` so the
 *                       Seatbelt kernel permits mkdir / write /
 *                       truncate / rename / unlink / rmdir etc.
 *                       recursively under it (see
 *                       seatbelt-profile.ts buildWriteRule).
 */
export function buildExperimentalReconCapability(input: {
	readonly cwd: string
	readonly workspaceRoots: readonly string[]
}): CommandCapability {
	return {
		// ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01:
		// Workspace roots are NOT placed in readonlyRoots because
		// every readonlyRoot emits a write-deny rule (last-rule-wins)
		// AFTER the write-allow rule, which would silently disable
		// mkdir inside the workspace — exactly the dogfood RED.
		readonlyRoots: [],
		writableRoots: [...input.workspaceRoots],
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
