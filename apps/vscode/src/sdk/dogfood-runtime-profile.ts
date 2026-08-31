/**
 * ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01 — closed-runtime identity resolver.
 *
 * Establishes one explicit, truthful, closed-runtime identity bit for
 * isolated ClineMM development installs, distinguishing them from
 * ordinary / public ClineMM VSIX installations WITHOUT any of the
 * rejected heuristics:
 *
 *   - NOT publisher/name (s1onique.clinemm is the same for ALL installs)
 *   - NOT ExtensionContext.extensionMode (both dogfood VSIX and ordinary
 *     VSIX resolve to ExtensionMode.Production in the upstream VS Code API)
 *   - NOT workspace path / repository contents (an ordinary install can
 *     open the ClineMM/Factory repository and would falsely trip a
 *     workspace-fingerprint discriminator)
 *   - NOT installation id / extension id / user-data-dir path
 *   - NOT username / hostname / OS-level heuristics
 *
 * Identity contract (FROZEN):
 *
 *   CLINEMM_RUNTIME_PROFILE = "dogfood"   -> resolveClineMmRuntimeProfile() === "dogfood"
 *   CLINEMM_RUNTIME_PROFILE unset / ""   -> resolveClineMmRuntimeProfile() === "public"
 *   CLINEMM_RUNTIME_PROFILE = <anything-else>  -> "public"   (fail-closed; do NOT
 *                                                          fail-open on typos)
 *
 * The marker is OWNED by the operator's isolated launcher wrappers
 * (`codium-clinemm`, `codium-factory`) and injected as a process
 * environment variable before the editor binary executes. The ClineMM
 * extension host merely CONSUMES the marker; it never WRITES it.
 *
 * Conservation (per ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01 section 6):
 *
 *   C1 ordinary ClineMM launch, marker absent         -> "public"
 *   C2 ordinary ClineMM opening repo containing        -> "public"
 *       .factory/BOARD_OWNER (the previously-rejected
 *       workspace-fingerprint shortcut)
 *   C3 dogfood wrapper, marker present                 -> "dogfood"
 *   C4 direct VSCodium + dogfood VSIX, marker absent   -> "public"
 *   C5 default mode                                    -> diagnostics remain OFF
 *       (this module MUST NOT activate diagnostics; the
 *       diagnostic-activation coupling is the halted
 *       DOGFOOD-DIAGNOSTIC-PROFILE ACT's job)
 *   C6 dogfood identity alone                          -> no observable behavior
 *                                                        change in this ACT
 *
 * PUBLIC-SURFACE DISCIPLINE (per ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01
 * section 10):
 *
 *   CLINEMM_RUNTIME_PROFILE is CLOSED_RUNTIME / LAUNCHER_OWNED. Do NOT
 *   document it as a user-facing setting, do NOT expose it via Settings
 *   UI, do NOT add proto fields, do NOT add command-palette controls, do
 *   NOT advertise it as a supported public environment variable. Tests
 *   may use it; product documentation must not.
 */

/**
 * Frozen discriminator values. The union is intentionally small and
 * closed: adding a value here is a durable API change requiring a new
 * ACT. Future profiles (e.g. "ci", "staging") must each be authorized
 * separately before being added to the union.
 */
export type ClineMmRuntimeProfile = "public" | "dogfood"

const DOGFOOD_MARKER_VALUE = "dogfood" as const
const ENV_VAR = "CLINEMM_RUNTIME_PROFILE" as const

/**
 * Resolve the current runtime's profile bit.
 *
 * Pure / synchronous / no I/O. Caller-supplied `env` defaults to
 * `process.env` for production, but tests inject their own env to
 * exercise all branches deterministically (see R1-R4 in the test
 * file).
 *
 * The function is EXACT-MATCH only:
 *
 *   - absent / "" / whitespace-only -> "public"
 *   - "dogfood"                      -> "dogfood"
 *   - anything else (e.g. "1", "yes",
 *     "true", "production", "banana") -> "public"   (fail-closed)
 *
 * The fail-closed behavior is intentional: a misconfigured launcher
 * that exports `CLINEMM_RUNTIME_PROFILE=1` MUST NOT silently enable
 * dogfood-mode diagnostics in a public install. The exact-match
 * contract keeps the operator's launcher edits as the SOLE
 * authoritative production source of the dogfood bit.
 */
export function resolveClineMmRuntimeProfile(env: NodeJS.ProcessEnv = process.env): ClineMmRuntimeProfile {
	const raw = env[ENV_VAR]
	if (typeof raw !== "string") {
		return "public"
	}
	// exact-match, fail-closed; do NOT accept "1", "true", "yes", etc.
	return raw === DOGFOOD_MARKER_VALUE ? "dogfood" : "public"
}

/**
 * Convenience predicate for callers that want a boolean bit instead of
 * the union value. Same semantics as `resolveClineMmRuntimeProfile() === "dogfood"`.
 *
 * Kept as a separate export (rather than `.filter(x => x === "dogfood")`)
 * so call sites read clearly at the dogfood-decision boundary and so a
 * future profile can be added without touching every predicate caller.
 */
export function isDogfoodRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
	return resolveClineMmRuntimeProfile(env) === "dogfood"
}
