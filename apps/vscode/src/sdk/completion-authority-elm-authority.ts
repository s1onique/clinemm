/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY
 *
 * Elm-authority seam for completion commit eligibility. The Elm
 * kernel is the MANDATORY authority for completion commit; there is
 * NO silent TS fallback.
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
 *     TS MUST NOT invoke the commit effect. The coordinator surfaces
 *     the bounded classification (no session / decode error / kernel
 *     error / invalid transition / unavailable). There is no "default
 *     authorize" fallback anywhere in this module or its callers.
 *
 * History note: prior versions of this module exported a
 * silent default-Authorize fallback that returned
 * `kind: "authorize", reason: "elm_authority_off_default_authorize"`.
 * That constant and its DI seam wrapper have been removed. Any
 * caller that previously fell back to the default now consumes
 * the real Elm runtime unconditionally (ACT-CLINEMM-COMPLETION-
 * AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY).
 */

export type ElmCompletionAuthorityDecision =
	| { readonly kind: "authorize"; readonly reason: string }
	| { readonly kind: "hold"; readonly reason: string; readonly holdReasons: readonly string[] }
	| {
			readonly kind: "failure"
			readonly reason: string
			readonly classification:
				| "elm_authority_no_session"
				| "elm_authority_decode_error"
				| "elm_authority_kernel_error"
				| "elm_authority_invalid_transition"
				| "elm_authority_unavailable"
	  }
