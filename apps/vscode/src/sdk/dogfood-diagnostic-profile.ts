/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
 *
 * Closed-runtime dogfood diagnostic-profile resolver. Computes the
 * EFFECTIVE state of the four diagnostic knobs (V / I / A / P) for
 * the current extension host process.
 *
 * Knob meanings (frozen, see ACT section 0 / 3 / 5):
 *
 *   V = V2 capture sink active
 *         (`CLINEMM_CAPTURE_V2_PATH=<path>`; OFF in public, ON in
 *         dogfood with auto-resolved sink under
 *         `<clineDir>/data/runtime-diag/<runtimeInstanceId>.jsonl`).
 *   I = approval.sdk-controller.input-shape.v2 active
 *         (`CLINEMM_DIAG_INPUT_SHAPE_V2=<truthy>`).
 *   A = runtime activity-state diagnostic active
 *         (`CLINEMM_DIAG_ACTIVITY_STATE_V1=<truthy>`).
 *         LANDED by `CANCEL-AFFORDANCE-AUTHORITY-RECON` (this ACT's
 *         owner). The probe site is
 *         `SdkController.getStateToPostToWebview()` — exactly one
 *         `activity.publication.v1` JSONL record per ExtensionState
 *         publication when A=true. The record is built by a pure
 *         function (`./activity-publication-v1.ts`) that reads the
 *         UI-authority fields (taskHeaderPhase, thinkingVisible,
 *         thinkingModelStreaming) from the same `snapshot` object
 *         the wire payload is built from. The host-authority fields
 *         (hostStatus, modelStreaming, toolActive) are read from
 *         the independently sampled shadow projection; the builder
 *         records `shadowPublicationBinding="UNBOUND"` because
 *         `ArbiterSnapshot` carries no generation identity, so the
 *         post-capture join knows these fields are not proven
 *         same-generation. The A knob IS the emission gate at the
 *         production seam (mechanically enforced in
 *         `buildActivityPublicationV1Record`); identity is the SOLE
 *         gate for the public path so public installs never emit.
 *   P = approval publication/final-decision diagnostic active
 *         (`CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=<truthy>`; gates the
 *         `approval.noncommand.result.v1` +
 *         `approval.noncommand.ui-published.v1` code points added by
 *         this ACT at `sdk-interaction-coordinator.ts:417 ASK branch`).
 *
 * Precedence (top wins; deterministic, fail-closed):
 *
 *   1. Explicit env override (per knob):
 *        truthy   -> force ON
 *        "0"/"off"/"false" (case-insensitive)
 *                 -> force OFF (dogfood default can be overridden down)
 *        garbage / unset -> falls through to (2)
 *   2. Dogfood profile default:
 *        isDogfoodRuntime() === true  -> V=ON if path resolved, I=ON, A=OFF,
 *                                        P=ON (the V/I/P triple is the
 *                                        "VIP" header indicator on the
 *                                        dogfood initial render).
 *   3. Public default:
 *        else                         -> all OFF.
 *
 * The resolver is PURE / synchronous / no I/O / no side effects on its
 * inputs. All environment variables are read through `env: NodeJS.ProcessEnv`
 * so the test suite can exercise every branch deterministically (R1-R7
 * pattern, mirroring `dogfood-runtime-profile.ts`).
 *
 * IMPORTANT: this module does NOT itself activate the probes. It is a
 * read-only decision oracle. Probe activation sites
 * (SdkController.ts:459 input-shape, sdk-interaction-coordinator.ts:417
 * publication branch, v2-capture.ts:148 path) MUST consult this
 * resolver and respect its verdict. The probe sites that pre-date this
 * ACT (input-shape, V2 capture path) are augmented to call the
 * resolver; the new P probe gates exclusively on this resolver.
 *
 * PUBLIC-SURFACE DISCIPLINE (per ACT section 18): none of the four knobs
 * becomes a public product setting. They remain closed-runtime
 * diagnostics, default-OFF in public, auto-ON in dogfood via the
 * launcher-owned `CLINEMM_RUNTIME_PROFILE` marker.
 */

const ENV_VARS: Readonly<Record<DiagnosticKnob, string>> = {
	v: "CLINEMM_CAPTURE_V2_PATH",
	i: "CLINEMM_DIAG_INPUT_SHAPE_V2",
	a: "CLINEMM_DIAG_ACTIVITY_STATE_V1",
	p: "CLINEMM_DIAG_APPROVAL_PUBLICATION_V2",
} as const

const TRUTHY_DISABLE = new Set(["0", "off", "false"])
const TRUTHY_ENABLE = new Set(["1", "true", "yes"])

function decideKnob(env: NodeJS.ProcessEnv, knob: DiagnosticKnob, isDogfood: boolean): boolean {
	const raw = env[ENV_VARS[knob]]
	if (typeof raw === "string" && raw.length > 0) {
		const normalized = raw.trim().toLowerCase()
		// Explicit OFF is honored in BOTH profiles (dogfood and public):
		// a public install that exports "0" gets a deterministic false,
		// and a dogfood install that exports "0" overrides the auto-on
		// default down. This is the only token that crosses profiles.
		if (TRUTHY_DISABLE.has(normalized)) {
			return false
		}
		// Explicit ON is honored ONLY in dogfood: a public install that
		// exports "1" / "true" / "yes" MUST NOT silently activate
		// diagnostics (the ACT section 18 invariant — no public
		// product setting for diagnostics). The identity resolver
		// (isDogfoodRuntime) is the SOLE gate.
		if (isDogfood && TRUTHY_ENABLE.has(normalized)) {
			return true
		}
		// garbage: fall through to the per-profile default below
	}
	return isDogfood
}

/**
 * Compute the EFFECTIVE diagnostic-knob state for the current
 * runtime. Pure / synchronous / no I/O.
 *
 * Inputs:
 *   - `env`         : the process environment to read from
 *   - `isDogfood`   : the closed-runtime profile bit (typically
 *                     `isDogfoodRuntime(env)`). Pre-computed here so
 *                     the resolver composes cleanly with callers that
 *                     already resolved the profile.
 *   - `vCapturePath`: the resolved V2 capture path (`null` if unset
 *                     or unresolvable). V is only ON when dogfood
 *                     defaults AND a path is available - we do not
 *                     invent a path here. The auto-path is provided
 *                     by `resolveAutoV2CapturePath()` which the
 *                     activation site composes with this resolver.
 *
 * Output: the four-knob object. `a` is governed by the same
 * identity+env-var precedence as `i` and `p`:
 *   - dogfood + `CLINEMM_DIAG_ACTIVITY_STATE_V1` truthy -> A=true
 *   - dogfood + no env var                              -> A=true
 *     (auto-on in dogfood; the `CLINEMM_DIAG_ACTIVITY_STATE_V1=0`
 *      override-down flips it back off, identical to I/P)
 *   - public + any env var                              -> A=false
 *     (no public product setting; identity is the SOLE gate)
 *   - public + no env var                               -> A=false
 */
export function resolveEffectiveDiagnosticKnobs(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
	vCapturePath: string | null,
): EffectiveDiagnosticKnobs {
	// V is determined ENTIRELY by whether the V2 writer has a
	// resolvable path. Three precedence rules (canonical-truth model,
	// per ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-
	// CAPTURE01 followup review):
	//
	//   1. user-set CLINEMM_CAPTURE_V2_PATH   -> V=true (legacy
	//      public-install opt-in; preserves prior diagnostic workflows
	//      that were never gated on identity).
	//   2. dogfood + auto path (resolved via
	//      `dogfood-runtime-capture-path.ts`) -> V=true.
	//   3. otherwise                          -> V=false (public default
	//      remains OFF; "header matches writer" guarantee).
	//
	// `decideKnob` is NOT used for V because V is a structural fact
	// about the writer, not a profile-gated activation. The env-var
	// override-down (`CLINEMM_CAPTURE_V2_PATH=0`) is honored at the
	// emitter layer in `v2-capture.ts` (the env var is the canonical
	// opt-in; the resolver observes the writer's effective state).
	const vResolved = vCapturePath !== null
	return {
		v: vResolved,
		i: decideKnob(env, "i", isDogfood),
		// A is LANDED by `CANCEL-AFFORDANCE-AUTHORITY-RECON`. Same
		// precedence as I and P: identity-gated, env-var overridable,
		// `decideKnob` covers the truthy/falsy/garbage branches the
		// dogfood-diagnostic-profile.test.ts suite already pins.
		a: decideKnob(env, "a", isDogfood),
		p: decideKnob(env, "p", isDogfood),
	}
}

/**
 * Render the EFFECTIVE knobs as a single string of active letters,
 * in canonical order V -> I -> A -> P. Used by the TaskHeader indicator.
 *
 * Example: `{v:true, i:true, a:false, p:true}` -> `"VIP"`.
 * Hidden entirely in public (the activation site only renders the
 * indicator when `isDogfood === true`).
 */
export function formatEffectiveKnobLetters(knobs: EffectiveDiagnosticKnobs): string {
	let s = ""
	if (knobs.v) s += "V"
	if (knobs.i) s += "I"
	if (knobs.a) s += "A"
	if (knobs.p) s += "P"
	return s
}
export type DiagnosticKnob = "v" | "i" | "a" | "p"

export interface EffectiveDiagnosticKnobs {
	readonly v: boolean
	readonly i: boolean
	readonly a: boolean
	readonly p: boolean
}
