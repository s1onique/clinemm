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
 *   D = TurnState writer-provenance / causal Diagnosability active
 *         (`CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE=<truthy>`; gates
 *         the legacy `turn-state-writer-provenance` ring added by
 *         `ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01`).
 *         ADDED by `ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-
 *         DIAGNOSABILITY01` (this file's owner). The D knob is the
 *         ONLY knob that participates in workspace-toggle precedence
 *         (the legacy `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`
 *         command writes `tswpdEnabled` to `context.workspaceState`).
 *         Resolved via `resolveEffectiveTurnStateWriterProvenanceD`
 *         (see below) with the precedence:
 *           explicit env override (`=1/true/yes` ON;
 *                                     `=0/off/false` OFF) >
 *           explicit workspace toggle (`true`/`false`; legacy
 *             `tswpdEnabled`) >
 *           dogfood profile default (dogfood -> ON; public -> OFF).
 *         The activation seam (`applyTurnStateWriterProvenanceDiagnosticProfile`)
 *         lives at the EARLIEST initialization seam (`extension.ts:activate`
 *         line 96-ish, sibling to `configureDogfoodCaptureStorage`),
 *         NOT at `getStateToPostToWebview`. It runs BEFORE any
 *         SdkController construction so the ring is armed BEFORE the
 *         first relevant TurnState mutation. Idempotent.
 *
 * Knob resolution surface (the source-of-truth split):
 *
 *   - resolveEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath)
 *     returns ResolvedViapDiagnosticKnobs = { v, i, a, p }.
 *     The generic 4-knob resolver uses the precedence below; it
 *     does NOT resolve D (D has its own resolver).
 *
 *   - resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle)
 *     is the SOLE D-knob authority (per Factory causal reviewer
 *     Round 2 P1 finding). Precedence: env override >
 *     workspace toggle > profile default. workspaceToggle === null
 *     means "no workspace toggle read available" (treat as
 *     undefined; falls through to profile default).
 *
 *   - composeEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath, workspaceToggle)
 *     returns EffectiveDiagnosticKnobs = { v, i, a, p, d } by
 *     composing the 4-knob resolver with the D resolver. Wire
 *     payloads and the formatter consume this composed shape.
 *
 * Precedence for V/I/A/P (top wins; deterministic, fail-closed):
 *
 *   1. Explicit env override (per knob):
 *        truthy   -> force ON
 *        "0"/"off"/"false" (case-insensitive)
 *                 -> force OFF (dogfood default can be overridden down)
 *        garbage / unset -> falls through to (2)
 *   2. Dogfood profile default:
 *        isDogfoodRuntime() === true  -> V=ON if path resolved, I=ON, A=ON,
 *                                        P=ON (the V/I/A/P triple is the
 *                                        "VIAP" header indicator on the
 *                                        dogfood initial render).
 *   3. Public default:
 *        else                         -> all OFF (V/I/A/P all false).
 *
 * D has its own precedence (see resolveEffectiveTurnStateWriterProvenanceD).
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

import {
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	isTurnStateWriterProvenanceDiagnosticEnabled,
} from "@shared/turn-state-writer-provenance"
import type { TurnStateWriterProvenanceDiagnosticContext } from "./turn-state-writer-provenance-runtime"


const ENV_VARS: Readonly<Record<DiagnosticKnob, string>> = {
	v: "CLINEMM_CAPTURE_V2_PATH",
	i: "CLINEMM_DIAG_INPUT_SHAPE_V2",
	a: "CLINEMM_DIAG_ACTIVITY_STATE_V1",
	p: "CLINEMM_DIAG_APPROVAL_PUBLICATION_V2",
	d: "CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE",
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
): ResolvedViapDiagnosticKnobs {
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
	// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01 (Round 2 fix):
	// D is no longer resolved here. The D knob has its own resolver
	// (resolveEffectiveTurnStateWriterProvenanceD) with workspace-toggle
	// precedence. Callers that need the full 5-knob shape (wire payload)
	// must use composeEffectiveDiagnosticKnobs(...).
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
 * in canonical order V -> I -> A -> P -> D. Used by the TaskHeader indicator.
 *
 * Example: `{v:true, i:true, a:true, p:true, d:true}` -> `"VIAPD"`.
 * The pre-D canonical dogfood initial render is `"VIAP"` (D=false),
 * preserved as D8 in `dogfood-diagnostic-profile.test.ts`. Hidden entirely
 * in public (the activation site only renders the indicator when
 * `isDogfood === true`).
 */
export function formatEffectiveKnobLetters(knobs: EffectiveDiagnosticKnobs): string {
	let s = ""
	if (knobs.v) s += "V"
	if (knobs.i) s += "I"
	if (knobs.a) s += "A"
	if (knobs.p) s += "P"
	if (knobs.d) s += "D"
	return s
}
export type DiagnosticKnob = "v" | "i" | "a" | "p" | "d"

/**
 * Result of `resolveEffectiveDiagnosticKnobs`: the 4-knob
 * env+identity-only shape (V/I/A/P). D is intentionally absent;
 * the D knob has its own resolver with workspace-toggle
 * precedence.
 */
export interface ResolvedViapDiagnosticKnobs {
	readonly v: boolean
	readonly i: boolean
	readonly a: boolean
	readonly p: boolean
}

/**
 * The 5-knob wire-payload shape consumed by the TaskHeader indicator
 * (formatter + UI) and the wire `diagnosticKnobs` field. Produced
 * exclusively by `composeEffectiveDiagnosticKnobs` (the SOLE D
 * authority) so the wire cannot disagree with the ring state.
 */
export interface EffectiveDiagnosticKnobs {
	readonly v: boolean
	readonly i: boolean
	readonly a: boolean
	readonly p: boolean
	readonly d: boolean
}

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01 (Round 2 fix):
 *
 * Compose the 5-knob wire shape from the 4-knob resolver and the
 * D resolver. This is the SOLE producer of `EffectiveDiagnosticKnobs`;
 * callers MUST go through this function (or
 * `applyTurnStateWriterProvenanceDiagnosticProfile`) so the wire `d`
 * field cannot disagree with the actual ring state.
 *
 * workspaceToggle may be `null` (no workspaceState read available,
 * e.g. tests that don't care about the toggle); the D resolver treats
 * `null` and `undefined` identically (both fall through to profile
 * default).
 */
export function composeEffectiveDiagnosticKnobs(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
	vCapturePath: string | null,
	workspaceToggle: boolean | null | undefined,
): EffectiveDiagnosticKnobs {
	const viap = resolveEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath)
	const dResolved = resolveEffectiveTurnStateWriterProvenanceD(
		env,
		isDogfood,
		workspaceToggle ?? undefined,
	)
	return { ...viap, d: dResolved.d }
}

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01:
 *
 * Workspace-toggle-aware D-knob resolver. The D knob is the ONLY
 * knob that participates in the legacy `tswpdEnabled` workspace
 * toggle; the I/A/P knobs are env+identity-only (no workspace
 * persistence). This function is the SINGLE source of truth for the
 * effective D value — both the ring activation helper AND the wire
 * `diagnosticKnobs.d` projection consult it.
 *
 * Precedence (top wins, deterministic, fail-closed):
 *
 *   1. Explicit env override (per-knob):
 *        `=1`/`true`/`yes`    -> ON (in either profile)
 *        `=0`/`off`/`false`   -> OFF (in either profile)
 *        garbage / unset      -> falls through to (2)
 *
 *   2. Explicit workspace toggle (legacy
 *      `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`):
 *        `tswpdEnabled === true`  -> ON
 *        `tswpdEnabled === false` -> OFF
 *        undefined (never toggled) -> falls through to (3)
 *
 *   3. Profile default:
 *        `isDogfood === true`  -> ON
 *        `isDogfood === false` -> OFF
 *
 * The precedence is FROZEN — there is exactly ONE authority for the
 * effective D value, so the ring activation helper and the wire
 * projection cannot disagree.
 *
 * Pure / synchronous / no I/O / no side effects. Replaces the prior
 * inline precedence at `SdkController.getStateToPostToWebview` (the
 * publication seam), which had two independent authorities fighting
 * each other (per Factory causal reviewer's P1 #4 finding).
 */
export function resolveEffectiveTurnStateWriterProvenanceD(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
	workspaceToggle: boolean | undefined,
): { readonly d: boolean; readonly source: "env" | "workspace" | "profile" } {
	// Layer 1: explicit env override.
	const raw = env["CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE"]
	if (typeof raw === "string" && raw.length > 0) {
		const normalized = raw.trim().toLowerCase()
		if (TRUTHY_DISABLE.has(normalized)) {
			return { d: false, source: "env" }
		}
		if (TRUTHY_ENABLE.has(normalized)) {
			return { d: true, source: "env" }
		}
		// garbage -> fall through to layer 2
	}
	// Layer 2: explicit workspace toggle.
	if (workspaceToggle === true) {
		return { d: true, source: "workspace" }
	}
	if (workspaceToggle === false) {
		return { d: false, source: "workspace" }
	}
	// Layer 3: profile default.
	return { d: isDogfood, source: "profile" }
}

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01:
 *
 * THE single production activation helper for the D knob. Both the
 * extension initialization seam (`extension.ts:activate`) AND the
 * test suite call THIS function — there is exactly one production
 * activation path, no copied orchestration in tests.
 *
 * Contract:
 *   - Reads the resolved D value via
 *     `resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle)`.
 *   - Flips the legacy TSWPD ring (`enable...()` when d=true,
 *     `disable...()` when d=false).
 *   - Idempotent: only mutates the ring when the resolved state
 *     diverges from the current ring state.
 *   - Returns `{ d, source, flipped }` for diagnostics (the wire
 *     projection consults `d` for `diagnosticKnobs.d`).
 *
 * Called from `extension.ts:activate` (line ~96, sibling to
 * `configureDogfoodCaptureStorage`). MUST run BEFORE SdkController
 * construction so the ring is armed BEFORE the first relevant
 * TurnState mutation. Verified by `order_diagnostic_armed_before_
 * first_writer.test.ts` in the same ACT.
 *
 * Failure mode: if this function is called AFTER the first
 * TurnState mutation, the bounded ring will have missed the writer
 * identity for that mutation. The ACT explicitly rejects any
 * publication-seam activation (`getStateToPostToWebview`) because
 * that seam can fire AFTER the first writer.
 */
export function applyTurnStateWriterProvenanceDiagnosticProfile(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
	context: TurnStateWriterProvenanceDiagnosticContext,
): { readonly d: boolean; readonly source: "env" | "workspace" | "profile"; readonly flipped: boolean } {
	const workspaceToggle = context.workspaceState.get<boolean>("tswpdEnabled")
	const resolved = resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle)
	const was = isTurnStateWriterProvenanceDiagnosticEnabled()
	if (resolved.d && !was) {
		enableTurnStateWriterProvenanceDiagnostic()
		return { d: true, source: resolved.source, flipped: true }
	}
	if (!resolved.d && was) {
		disableTurnStateWriterProvenanceDiagnostic()
		return { d: false, source: resolved.source, flipped: true }
	}
	return { d: resolved.d, source: resolved.source, flipped: false }
}
