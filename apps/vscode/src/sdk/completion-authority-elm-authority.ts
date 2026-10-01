/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01
 *
 * Elm-authority seam for completion commit eligibility.
 *
 * Architecture (per ACT §2):
 *   factual production inputs
 *     -> Elm authoritative evaluation
 *     -> closed decoded decision (this module)
 *     -> TypeScript effect executor
 *
 * The TS-facing closed discriminated union has THREE outcomes:
 *   - authorize: Elm has confirmed no hold reasons; TS may invoke the
 *     commit effect exactly once.
 *   - hold: Elm has computed at least one hold reason; TS must NOT
 *     invoke the commit effect.
 *   - failure: Elm evaluation could not produce a valid decision;
 *     TS must NOT silently fall back to the legacy TS authority.
 *
 * The `default*` constant and `defaultGetElmCompletionAuthorityDecision`
 * preserve byte-identical behavior when the authority flag is unset
 * (the legacy TS predicate chain is the sole authority, exactly as
 * before this ACT).
 *
 * The runtime authority mode (env-gated) is wired by
 * `dogfood-diagnostic-profile.applyElmAuthorityProfile` and consumed
 * via `SdkSessionEventCoordinator`'s `getElmCompletionAuthorityDecision`
 * option.
 *
 * The ACT goal is: production completion commit is BOTH correct AND
 * causally obedient to this Elm decision. No silent TS fallback.
 */

export type ElmCompletionAuthorityDecision =
	| { readonly kind: "authorize"; readonly reason: string }
	| { readonly kind: "hold"; readonly reason: string; readonly holdReasons: readonly string[] }
	| {
			readonly kind: "failure"
			readonly classification:
				| "elm_authority_no_session"
				| "elm_authority_decode_error"
				| "elm_authority_kernel_error"
				| "elm_authority_invalid_transition"
				| "elm_authority_unavailable"
	  }

/**
 * Default — used when the authority option is absent on the
 * coordinator. The default is a no-op that ALWAYS authorizes, so the
 * legacy TS predicate chain is the sole authority (byte-identical to
 * pre-ACT behavior). ONLY at `OFF`, the Elm decision has no effect.
 */
export const defaultElmCompletionAuthorityDecision: ElmCompletionAuthorityDecision = {
	kind: "authorize",
	reason: "elm_authority_off_default_authorize",
}

/**
 * The default dependency-injection seam: a function that always
 * returns the default-allow decision. When the production enable
 * helper arms the authority mode, the host (SdkController) replaces
 * this with a real Elm-kernel query function. Until then, the legacy
 * TS predicate chain is the sole authority (byte-identical).
 */
export function defaultGetElmCompletionAuthorityDecision(): ElmCompletionAuthorityDecision {
	return defaultElmCompletionAuthorityDecision
}
