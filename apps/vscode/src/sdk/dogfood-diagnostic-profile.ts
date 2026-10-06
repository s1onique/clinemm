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
import { Logger } from "@/shared/services/Logger"
import {
	isBackgroundJobLivenessAuthorityCaptureEnabled as _isBackgroundJobLivenessAuthorityCaptureEnabled,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "./background-job-liveness-authority"
import {
	isBackgroundOwnerCorrelationCaptureEnabled as _isBackgroundOwnerCorrelationCaptureEnabled,
	setBackgroundOwnerCorrelationCaptureEnabled,
} from "./background-owner-correlation"
import * as ElmAuthorityModule from "./completion-authority-elm-authority-runtime"
import {
	isCompletionContinuationDeliveryEnabled,
	setCompletionContinuationDeliveryEnabled,
} from "./completion-continuation-delivery-runtime"
import {
	isCompletionContinuationUpstreamEnabled as _isCompletionContinuationUpstreamEnabled,
	setCompletionContinuationUpstreamEnabled,
} from "./completion-continuation-upstream-runtime"
import {
	isContinuationCardinalityAuthorityCaptureEnabled as _isContinuationCardinalityAuthorityCaptureEnabled,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "./continuation-cardinality-authority"
import { applyExtensionHostAllocationProfilerPolicy } from "./extension-host-allocation-profiler"
import { applyExtensionHostCpuProfilerPolicy } from "./extension-host-cpu-profiler"
import {
	isExtensionHostHotloopDiagnosticEnabled as _isExtensionHostHotloopDiagnosticEnabled,
	setExtensionHostHotloopDiagnosticEnabled,
} from "./extension-host-hotloop-diagnostic"
import { applyExtensionHostQueueLogPolicy } from "./extension-host-queue-log-policy"
import { applyExtensionHostTerminationAuthorityPolicy } from "./extension-host-termination-authority"
import {
	isTaskHeaderSelectorInputCaptureEnabled as _isTaskHeaderSelectorInputCaptureEnabled,
	setTaskHeaderSelectorInputCaptureEnabled,
} from "./task-header-selector-input-capture"
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
	const dResolved = resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle ?? undefined)
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
	const raw = env.CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE
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

// ===========================================================================
// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01
//
// Bounded diagnostic-profile extension for the TaskHeader selector-input
// capture (THSICAP). The capture was authored by
// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01 and
// gated exclusively by the env var
// `CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=<truthy>`. Per Factory
// doctrine on temporary diagnostics, the env-var gate is now folded into
// the central dogfood diagnostic profile so dogfood operators no longer
// need to set the env var on every launcher.
//
// Post-P1-fix: `resolveEffectiveTaskHeaderSelectorInputCapture` below
// is the SOLE parser of the env var; the legacy env-reader in
// `task-header-selector-input-capture.ts` was REMOVED so the capture
// module's production code never reads `process.env` and there is no
// risk of two independently evolvable interpretations of the same knob.
//
// Frozen contract:
//
//   dogfood profile (CLINEMM_RUNTIME_PROFILE=dogfood)
//     + no env var                      -> THSICAP ON  (profile default)
//     + env=1/true/yes                  -> THSICAP ON  (explicit ON)
//     + env=0/off/false                 -> THSICAP OFF (explicit OFF)
//     + garbage env                     -> THSICAP ON  (falls through)
//
//   public profile (anything-else)
//     + no env var                      -> THSICAP OFF (public default)
//     + env=1/true/yes                  -> THSICAP ON  (operator opt-in)
//     + env=0/off/false                 -> THSICAP OFF (explicit OFF)
//     + garbage env                     -> THSICAP OFF (public default)
//
//   explicit env override ALWAYS wins (in either profile): operator
//   opt-in on public is preserved; override-down in dogfood flips the
//   auto-on default off. This is the only piece of state that crosses
//   profiles; identity is the SOLE gate for the profile default.
//
// REMOVAL_TRIGGER (preserved from the bounded-diagnostic doctrine):
//   first successful LIVE binding of
//     PUBLICATION_SHADOW_BINDING + LOCAL_SHADOW_TURNSEQ
//     for a recurrence, OR
//   CAPTURE_INSUFFICIENT
// When the Idle recurrence is finally bound, REMOVE this resolver + the
// activation helper + the capture module + the wiring in
// `extension.ts:activate` TOGETHER.
//
// The capture is NOT exposed as a UI letter in the TaskHeader indicator
// (which stays VIAPD). This is intentional: THSICAP is temporary
// forensic scaffolding with a removal trigger; making it a sixth letter
// risks turning it into permanent profile architecture.
// ===========================================================================

const THSICAP_ENV_VAR = "CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1"

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
 *
 * Pure / synchronous / no I/O. Resolves the EFFECTIVE THSICAP capture
 * state from the env var and the dogfood identity bit. The env var is
 * read in EXACTLY ONE place — this function. All consumers of the
 * effective state go through this resolver (or the activation helper
 * below); the capture helper itself reads ONLY the module seam set by
 * the activation helper.
 *
 * Precedence (top wins; deterministic; fail-closed):
 *
 *   1. Explicit env override:
 *        `=1`/`true`/`yes` (case-insensitive, whitespace tolerant)
 *              -> ON  (honored in both profiles — operator opt-in
 *                      on public is preserved verbatim per the
 *                      predecessor ACT; explicit override-down in
 *                      dogfood flips the auto-on default off)
 *        `=0`/`off`/`false`
 *              -> OFF (honored in both profiles)
 *        garbage / unset -> falls through to (2)
 *
 *   2. Profile default:
 *        `isDogfood === true`  -> ON  (auto-on in dogfood)
 *        `isDogfood === false` -> OFF (public default OFF preserved)
 */
export function resolveEffectiveTaskHeaderSelectorInputCapture(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "env" | "profile" } {
	// Layer 1: explicit env override.
	const raw = env[THSICAP_ENV_VAR]
	if (typeof raw === "string" && raw.length > 0) {
		const normalized = raw.trim().toLowerCase()
		if (TRUTHY_DISABLE.has(normalized)) {
			return { enabled: false, source: "env" }
		}
		if (TRUTHY_ENABLE.has(normalized)) {
			return { enabled: true, source: "env" }
		}
		// garbage -> fall through to layer 2
	}
	// Layer 2: profile default.
	return { enabled: isDogfood, source: "profile" }
}

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01:
 *
 * THE single production activation helper for the THSICAP seam. Called
 * from `extension.ts:activate` (sibling to
 * `applyTurnStateWriterProvenanceDiagnosticProfile`); there is exactly
 * ONE production activation path, no copied orchestration in tests.
 *
 * Contract:
 *   - Reads the resolved THSICAP state via
 *     `resolveEffectiveTaskHeaderSelectorInputCapture(env, isDogfood)`.
 *   - Flips the module seam in
 *     `./task-header-selector-input-capture.ts` via
 *     `setTaskHeaderSelectorInputCaptureEnabled(enabled)` — idempotent
 *     (only mutates when the resolved state diverges from the current
 *     seam state).
 *   - Returns `{ enabled, source, flipped }` for diagnostics.
 *
 * Called BEFORE the first `SdkController.getStateToPostToWebview()`
 * (the publication seam where the capture helper fires). The capture
 * is at the publication seam — not at a mutation seam — so the helper
 * only needs to run BEFORE SdkController construction. Verified by
 * the AC3 test in
 * `dogfood-diagnostic-profile-thsicap-activation.test.ts`.
 */
export function applyTaskHeaderSelectorInputCaptureDiagnosticProfile(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "env" | "profile"; readonly flipped: boolean } {
	const resolved = resolveEffectiveTaskHeaderSelectorInputCapture(env, isDogfood)
	const was = _isTaskHeaderSelectorInputCaptureEnabled()
	if (resolved.enabled && !was) {
		setTaskHeaderSelectorInputCaptureEnabled(true)
		return { enabled: true, source: resolved.source, flipped: true }
	}
	if (!resolved.enabled && was) {
		setTaskHeaderSelectorInputCaptureEnabled(false)
		return { enabled: false, source: resolved.source, flipped: true }
	}
	return { enabled: resolved.enabled, source: resolved.source, flipped: false }
}

// ===========================================================================
// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (twenty-seventh-pass) — central dogfood profile resolver for the
// Q1..Q4 W carrier trace observer.
//
// BACKGROUND
// ----------
// Live dogfood qualification at HEAD `6760717c2` reported a missing
// context-window gauge on a running task. The temporary Q1..Q4 trace
// observer (apps/vscode/src/sdk/w-carrier-trace-runtime.ts) was added
// to classify the missing-gauge boundary. Without a central profile,
// every dogfood session requires the operator to remember to set
// `CLINEMM_W_TRACE=1` — exactly the env-juggling footgun we
// eliminated for THSICAP and turn-state-writer-provenance.
//
// CONTRACT — frozen in this ACT
// -----------------------------
//   - The env var `CLINEMM_W_TRACE` is read in EXACTLY ONE place —
//     `parseClinemmWTraceEnv` below. All other consumers go through
//     the module-level seam in `w-carrier-trace-runtime.ts`.
//   - The activation helper (`applyWCarrierTraceDiagnosticProfile`)
//     is called from `extension.ts:activate` (sibling to the
//     existing THSICAP / D-knob activations); there is exactly ONE
//     production activation path, no copied orchestration in tests.
//
// Precedence (top wins; deterministic; fail-closed):
//
//   1. Explicit env override:
//        `=1`/`true`/`yes` -> ON (honored in both profiles)
//        `=0`/`off`/`false` -> OFF (honored in both profiles;
//                                override-down in dogfood flips
//                                the auto-on default off)
//        garbage / unset -> falls through to (2)
//   2. Profile default:
//        `isDogfood === true`  -> ON  (auto-on in dogfood)
//        `isDogfood === false` -> OFF (public default OFF
//                                  preserved)
//
// HONEST STOP RULE (mirrors THSICAP):
//   Once the live Q1..Q4 capture identifies the missing-gauge
//   boundary and the proper repair lands, this resolver + activation
//   helper + the trace module's seam helpers + the wiring in
//   `extension.ts:activate` MUST be removed TOGETHER. The trace is
//   temporary forensic scaffolding with a removal trigger; making it
//   a permanent profile letter risks turning it into permanent
//   architecture.
// ===========================================================================

import {
	isWCarrierTraceEnabled as _publicIsWCarrierTraceEnabled,
	setWCarrierTraceEnabled as _setWCarrierTraceEnabled,
	W_TRACE_ENV_VAR,
} from "./w-carrier-trace-runtime"

export function parseClinemmWTraceEnv(env: NodeJS.ProcessEnv): { enabled: boolean } | undefined {
	const raw = env[W_TRACE_ENV_VAR]
	if (typeof raw !== "string" || raw.length === 0) {
		return undefined
	}
	const normalized = raw.trim().toLowerCase()
	if (TRUTHY_DISABLE.has(normalized)) {
		return { enabled: false }
	}
	if (TRUTHY_ENABLE.has(normalized)) {
		return { enabled: true }
	}
	return undefined
}

/**
 * Resolves the EFFECTIVE W carrier trace state from the env var and
 * the dogfood identity bit. Pure / synchronous / no I/O. The env var
 * is read in EXACTLY ONE place — this function. All consumers of
 * the effective state go through this resolver (or the activation
 * helper below); the trace recorder itself reads ONLY the module
 * seam set by the activation helper.
 *
 * Precedence (top wins; deterministic; fail-closed):
 *
 *   1. Explicit env override:
 *        `=1`/`true`/`yes` -> ON  (honored in both profiles)
 *        `=0`/`off`/`false` -> OFF (honored in both profiles;
 *                                override-down in dogfood flips
 *                                the auto-on default off)
 *        garbage / unset -> falls through to (2)
 *   2. Profile default:
 *        `isDogfood === true`  -> ON  (auto-on in dogfood)
 *        `isDogfood === false` -> OFF (public default OFF
 *                                  preserved)
 */
export function resolveEffectiveWCarrierTrace(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "env" | "profile" } {
	// Layer 1: explicit env override.
	const parsed = parseClinemmWTraceEnv(env)
	if (parsed !== undefined) {
		return { enabled: parsed.enabled, source: "env" }
	}
	// Layer 2: profile default.
	return { enabled: isDogfood, source: "profile" }
}

/**
 * THE single production activation helper for the W carrier trace
 * seam. Called from `extension.ts:activate` (sibling to the existing
 * THSICAP / D-knob activations); there is exactly ONE production
 * activation path, no copied orchestration in tests.
 *
 * Contract:
 *   - Reads the resolved W carrier state via
 *     `resolveEffectiveWCarrierTrace(env, isDogfood)`.
 *   - Flips the module seam in
 *     `./w-carrier-trace-runtime.ts` via
 *     `_setWCarrierTraceEnabled(enabled)` — idempotent (only mutates
 *     when the resolved state diverges from the current seam state).
 *   - Returns `{ enabled, source, flipped }` for diagnostics.
 *
 * Called BEFORE the first `SdkController.getStateToPostToWebview()`
 * (the producer seam where the trace helper fires) AND BEFORE
 * `WorkingContextHostCapture.setTraceObserver` (the carrier_observe
 * seam where the carrier's trace observer fires). Verified by the
 * `dogfood-diagnostic-profile-w-carrier-activation.test.ts` suite.
 */
export function applyWCarrierTraceDiagnosticProfile(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "env" | "profile"; readonly flipped: boolean } {
	const resolved = resolveEffectiveWCarrierTrace(env, isDogfood)
	const was = _isWCarrierTraceEnabledForActivation()
	if (resolved.enabled && !was) {
		_setWCarrierTraceEnabled(true)
		return { enabled: true, source: resolved.source, flipped: true }
	}
	if (!resolved.enabled && was) {
		_setWCarrierTraceEnabled(false)
		return { enabled: false, source: resolved.source, flipped: true }
	}
	return { enabled: resolved.enabled, source: resolved.source, flipped: false }
}

/**
 * Internal helper used by the activation path to compare against
 * the current seam state. The recorder module's
 * `isWCarrierTraceEnabled` is the single authority on the module
 * seam state.
 */
function _isWCarrierTraceEnabledForActivation(): boolean {
	return _publicIsWCarrierTraceEnabled()
}

// ===========================================================================
// ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01 -
// central dogfood profile resolver for the Q5 BOCOR capture seam.
//
// CONTRACT - frozen in this ACT (CORRECTION01 - bounded)
// ------------------------------------------------------
//   - There is NO new env var. NO override matrix. NO parser.
//     Per the Factory reviewer correction, the diagnostic is
//     enabled STRICTLY by the central dogfood profile:
//       isDogfood === true  -> capture ON
//       isDogfood === false -> capture OFF (public default)
//   - The module seam is
//     ./background-owner-correlation.ts#captureEnabled. The
//     resolver arms it via
//     setBackgroundOwnerCorrelationCaptureEnabled(enabled).
//   - The activation helper is called from
//     extension.ts:activate (sibling to the existing THSICAP /
//     W carrier / D-knob activations); there is exactly ONE
//     production activation path.
//
// HONEST STOP RULE (mirrors THSICAP / W carrier):
//   Once the LIVE cause is isolated (OC1 / OC2 / OC3) AND the
//   bounded repair is qualified (PASS_CASE_*) OR the diagnostic
//   is classified CAPTURE_INSUFFICIENT, this resolver + activation
//   helper + the BOCOR ring module + the host-side dump runtime +
//   the Command Palette registration + the registry entry + the
//   package.json command declaration MUST be removed TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the BOCOR seam.
 * Called from extension.ts:activate (sibling to the existing
 * THSICAP / W carrier / D-knob activations); there is exactly ONE
 * production activation path, no copied orchestration in tests.
 *
 * CORRECTION01 - bounded: the env-var override layer was removed
 * per the Factory reviewer. Enable/disable is now strictly:
 *
 *   isDogfood === true  -> ON
 *   isDogfood === false -> OFF
 *
 * No new env knob. No parser. No override matrix.
 */
export function applyBackgroundOwnerCorrelationDiagnosticProfile(isDogfood: boolean): {
	readonly enabled: boolean
	readonly flipped: boolean
} {
	const was = _isBackgroundOwnerCorrelationCaptureEnabledForActivation()
	const should = isDogfood
	if (should && !was) {
		setBackgroundOwnerCorrelationCaptureEnabled(true)
		return { enabled: true, flipped: true }
	}
	if (!should && was) {
		setBackgroundOwnerCorrelationCaptureEnabled(false)
		return { enabled: false, flipped: true }
	}
	return { enabled: should, flipped: false }
}

function _isBackgroundOwnerCorrelationCaptureEnabledForActivation(): boolean {
	return _isBackgroundOwnerCorrelationCaptureEnabled()
}

// ===========================================================================
// ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 —
// central dogfood profile resolver for the BJLA capture seam.
//
// CONTRACT — frozen in this ACT (mirrors BOCOR; no env override layer):
//   - There is NO new env var. NO override matrix. NO parser.
//     Per the Factory reviewer precedent, the diagnostic is enabled
//     STRICTLY by the central dogfood profile:
//       isDogfood === true  -> capture ON
//       isDogfood === false -> capture OFF (public default)
//   - The module seam is
//     ./background-job-liveness-authority.ts#captureEnabled. The
//     resolver arms it via
//     setBackgroundJobLivenessAuthorityCaptureEnabled(enabled).
//   - The activation helper is called from
//     extension.ts:activate (sibling to the existing BOCOR
//     activation); there is exactly ONE production activation
//     path.
//
// HONEST STOP RULE (mirrors BOCOR):
//   Once the LIVE cause is isolated (LA1..LA6) AND the bounded
//   repair is qualified (PASS_CASE_*) OR the diagnostic is
//   classified CAPTURE_INSUFFICIENT, this resolver + activation
//   helper + the BJLA ring module + the host-side dump runtime +
//   the Command Palette registration + the registry entry +
//   the package.json command declaration MUST be removed TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the BJLA seam.
 * Called from extension.ts:activate (sibling to the BOCOR
 * activation); there is exactly ONE production activation path, no
 * copied orchestration in tests.
 *
 * Mirrors BOCOR's CORRECTION01: enable/disable is strictly:
 *
 *   isDogfood === true  -> ON
 *   isDogfood === false -> OFF
 *
 * No new env knob. No parser. No override matrix.
 */
export function applyBackgroundJobLivenessAuthorityDiagnosticProfile(isDogfood: boolean): {
	readonly enabled: boolean
	readonly flipped: boolean
} {
	const was = _isBackgroundJobLivenessAuthorityCaptureEnabledForActivation()
	const should = isDogfood
	if (should && !was) {
		setBackgroundJobLivenessAuthorityCaptureEnabled(true)
		return { enabled: true, flipped: true }
	}
	if (!should && was) {
		setBackgroundJobLivenessAuthorityCaptureEnabled(false)
		return { enabled: false, flipped: true }
	}
	return { enabled: should, flipped: false }
}

function _isBackgroundJobLivenessAuthorityCaptureEnabledForActivation(): boolean {
	return _isBackgroundJobLivenessAuthorityCaptureEnabled()
}

// ===========================================================================
// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 —
// central dogfood profile resolver for the CCARD (Continuation
// Cardinality Authority) capture seam.
//
// CONTRACT — frozen in this ACT (mirrors BJLA / BOCOR; no env
// override layer):
//   - There is NO new env var. NO override matrix. NO parser.
//     Per the Factory reviewer precedent, the diagnostic is enabled
//     STRICTLY by the central dogfood profile:
//       isDogfood === true  -> capture ON
//       isDogfood === false -> capture OFF (public default)
//   - The module seam is
//     ./continuation-cardinality-authority.ts#captureEnabled. The
//     resolver arms it via
//     setContinuationCardinalityAuthorityCaptureEnabled(enabled).
//   - The activation helper is called from
//     extension.ts:activate (sibling to the existing BJLA / BOCOR
//     activations); there is exactly ONE production activation
//     path.
//
// HONEST STOP RULE (mirrors BJLA / BOCOR):
//   Once the first 1 -> 2 cardinality seam is mechanically
//   identified AND ablation returns cardinality to 1
//   (PASS_CONTINUATION_*) OR the diagnostic is classified
//   CAPTURE_INSUFFICIENT OR HALT_RED_NOT_REPRODUCED, this resolver
//   + activation helper + the CCARD ring module + the host-side
//   dump runtime + the Command Palette registration + the registry
//   entry + the package.json command declaration MUST be removed
//   TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the CCARD seam.
 * Called from extension.ts:activate (sibling to the BJLA / BOCOR
 * activations); there is exactly ONE production activation path,
 * no copied orchestration in tests.
 *
 * Mirrors BJLA / BOCOR: enable/disable is strictly:
 *
 *   isDogfood === true  -> ON
 *   isDogfood === false -> OFF
 *
 * No new env knob. No parser. No override matrix.
 */
export function applyContinuationCardinalityAuthorityDiagnosticProfile(isDogfood: boolean): {
	readonly enabled: boolean
	readonly flipped: boolean
} {
	const was = _isContinuationCardinalityAuthorityCaptureEnabledForActivation()
	const should = isDogfood
	if (should && !was) {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		return { enabled: true, flipped: true }
	}
	if (!should && was) {
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		return { enabled: false, flipped: true }
	}
	return { enabled: should, flipped: false }
}

function _isContinuationCardinalityAuthorityCaptureEnabledForActivation(): boolean {
	return _isContinuationCardinalityAuthorityCaptureEnabled()
}

// ===========================================================================
// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION02-DOGFOOD-DIAGNOSTIC-GATE-AND-ARTIFACT-BINDING
// — central dogfood profile resolver for the CCDCO (Completion
// Continuation DELivery Outcome) capture seam.
//
// CONTRACT — frozen in this ACT (mirrors CCARD / BJLA / BOCOR; no env
// override layer, no new knob):
//   - There is NO new env var. NO override matrix. NO parser.
//     Per the Factory reviewer precedent (and the predecessor
//     ACT §0 "DEFAULT_OFF"), the diagnostic is enabled STRICTLY
//     by the central dogfood profile:
//       isDogfood === true  -> diagnostic ON
//       isDogfood === false -> diagnostic OFF (public default)
//   - The module seam is
//     ./completion-continuation-delivery-runtime.ts#setCompletionContinuationDeliveryEnabled.
//     The resolver arms it via
//     setCompletionContinuationDeliveryEnabled(enabled).
//   - The activation helper is called from
//     extension.ts:activate (sibling to the existing CCARD
//     activation); there is exactly ONE production activation
//     path.
//   - The dump command + the host-side dump runtime remain
//     unconditional (mirrors CCARD / Elm shadow / Elm authority
//     convention: dump is always callable, dump != clear, dump !=
//     enable). While disabled, the dump reports an all-zero
//     snapshot so an operator can always confirm the diagnostic
//     is correctly off.
//
// HONEST STOP RULE (mirrors BJLA / BOCOR / CCARD):
//   Once the root cause is isolated, the diagnostic is
//   classified CAPTURE_INSUFFICIENT, OR successor evidence
//   supersedes, this helper + the runtime module + the dump
//   command + the registry entry + the package.json declaration
//   + the production callback instrumentation MUST be removed
//   TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the CCDCO seam.
 * Called from extension.ts:activate (sibling to the CCARD
 * activation); there is exactly ONE production activation path,
 * no copied orchestration in tests.
 *
 * Mirrors CCARD: enable/disable is strictly:
 *
 *   isDogfood === true  -> ON
 *   isDogfood === false -> OFF
 *
 * No new env knob. No parser. No override matrix.
 */
export function applyCompletionContinuationDeliveryDiagnosticProfile(isDogfood: boolean): {
	readonly enabled: boolean
	readonly flipped: boolean
} {
	const was = isCompletionContinuationDeliveryEnabled()
	const should = isDogfood
	if (should && !was) {
		setCompletionContinuationDeliveryEnabled(true)
		return { enabled: true, flipped: true }
	}
	if (!should && was) {
		setCompletionContinuationDeliveryEnabled(false)
		return { enabled: false, flipped: true }
	}
	return { enabled: should, flipped: false }
}

// ===========================================================================
// ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR
// — central dogfood profile resolver for the CCUD (Completion
// Continuation Upstream Discriminator) capture seam.
//
// CONTRACT — frozen in this ACT (mirrors CCDO / CCARD / BJLA / BOCOR; no
// env override layer, no new knob):
//   - There is NO new env var. NO override matrix. NO parser.
//     Per the Factory reviewer precedent (and the predecessor
//     ACT §0 "DEFAULT_OFF"), the diagnostic is enabled STRICTLY
//     by the central dogfood profile:
//       isDogfood === true  -> diagnostic ON
//       isDogfood === false -> diagnostic OFF (public default)
//   - The module seam is
//     ./completion-continuation-upstream-runtime.ts#setCompletionContinuationUpstreamEnabled.
//     The resolver arms it via
//     setCompletionContinuationUpstreamEnabled(enabled).
//   - The activation helper is called from
//     extension.ts:activate (sibling to the existing CCARD /
//     CCDO activation); there is exactly ONE production
//     activation path.
//   - The dump command + the host-side dump runtime remain
//     unconditional (mirrors CCARD / CCDO / Elm shadow / Elm
//     authority convention: dump is always callable, dump !=
//     clear, dump != enable). While disabled, the dump reports
//     an all-zero snapshot so the operator can always confirm
//     the diagnostic is correctly off.
//
// HONEST STOP RULE (mirrors CCARD / CCDO / BJLA / BOCOR):
//   Once the root cause is isolated (LIVE classifies an exact
//   U<n> first divergence), the diagnostic is classified
//   CAPTURE_INSUFFICIENT, OR successor evidence supersedes,
//   this helper + the runtime module + the dump command +
//   the registry entry + the package.json declaration +
//   the production coordinator instrumentation MUST be
//   removed TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the CCUD seam.
 * Called from extension.ts:activate (sibling to the CCDO / CCARD
 * activation); there is exactly ONE production activation path,
 * no copied orchestration in tests.
 *
 * Mirrors CCDO: enable/disable is strictly:
 *
 *   isDogfood === true  -> ON
 *   isDogfood === false -> OFF
 *
 * No new env knob. No parser. No override matrix.
 */
export function applyCompletionContinuationUpstreamDiagnosticProfile(isDogfood: boolean): {
	readonly enabled: boolean
	readonly flipped: boolean
} {
	const was = _isCompletionContinuationUpstreamEnabledForActivation()
	const should = isDogfood
	if (should && !was) {
		setCompletionContinuationUpstreamEnabled(true)
		return { enabled: true, flipped: true }
	}
	if (!should && was) {
		setCompletionContinuationUpstreamEnabled(false)
		return { enabled: false, flipped: true }
	}
	return { enabled: should, flipped: false }
}

function _isCompletionContinuationUpstreamEnabledForActivation(): boolean {
	return _isCompletionContinuationUpstreamEnabled()
}

// ===========================================================================
// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY
//
// The Elm shadow observer seam has been RETIRED from production.
// `applyElmShadowDiagnosticProfile` and the
// `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW` env var are deleted.
// The pure-Elm-kernel correspondence tests in
// `__tests__/completion-authority-elm-shadow02.test.ts` retain the
// `completion-authority-elm-shadow.ts` module file as test fixture
// substrate, but there is NO production wiring into
// `continuation-cardinality-authority.ts` or `extension.ts`.
// ===========================================================================

// ===========================================================================
// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 — central dogfood
// profile resolver for the EHLOOP01 (Extension Host Hotloop) capture
// seam.
//
// CONTRACT — frozen in this ACT (mirrors BJLA / BOCOR / CCARD; no env
// override layer):
//   - There is NO new env var. NO override matrix. NO parser.
//     Per the Factory reviewer precedent, the diagnostic is enabled
//     STRICTLY by the central dogfood profile:
//       isDogfood === true  -> counters ON
//       isDogfood === false -> counters OFF (public default)
//   - The module seam is
//     ./extension-host-hotloop-diagnostic.ts#isExtensionHostHotloopDiagnosticEnabled.
//     The resolver arms it via
//     setExtensionHostHotloopDiagnosticEnabled(enabled).
//   - The activation helper is called from extension.ts:activate
//     (sibling to the existing BJLA / BOCOR / CCARD activations);
//     there is exactly ONE production activation path.
//
// HONEST STOP RULE (mirrors BJLA / BOCOR / CCARD):
//   Once the extension-host hot-loop repair is GREEN on LIVE
//   qualification (PASS_EXTENSION_HOST_HOTLOOP_REPAIRED or any
//   PASS_* equivalent) OR CAPTURE_INSUFFICIENT OR
//   HALT_CAUSE_NOT_ESTABLISHED, this resolver + activation helper +
//   the EHLOOP counter module + the host-side dump runtime + the
//   Command Palette registration + the registry entry + the
//   package.json command declaration MUST be removed TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the EHLOOP01 seam.
 * Called from extension.ts:activate (sibling to the BJLA / BOCOR /
 * CCARD activations); there is exactly ONE production activation
 * path, no copied orchestration in tests.
 *
 * Mirrors BJLA / BOCOR / CCARD for the diagnostic enablement bit:
 *
 *   isDogfood === true  -> diagnostic ON (counters / phase writes)
 *   isDogfood === false -> diagnostic OFF
 *
 * Two distinct gates are resolved (CORRECTION01 / CORRECTION02):
 *
 *   1. Diagnostic enablement (counters + nested depth + phase write
 *      witness). Defaulted by the dogfood profile. The
 *      `CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC` env knob can force OFF
 *      (truthy disable: 0/off/false) regardless of profile, but
 *      cannot force ON in public (matches ACT §18 invariant).
 *      Owned by THIS module.
 *
 *   2. Synchronous queue-log opt-in (the breadcrumb Logger.log
 *      inside SdkSessionEventCoordinator.logQueueEvents). DEFAULT
 *      OFF IN EVERY PROFILE. Honored ONLY in dogfood when the
 *      explicit env knob `CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=<truthy>`
 *      is set. Public installs cannot enable this regardless of
 *      env var (per ACT §18 + the LIVE failure provenance).
 *
 *      As of CORRECTION02, this gate is OWNED by the permanent
 *      policy module `extension-host-queue-log-policy.ts`. This
 *      helper merely DELEGATES Gate 2 to that module via
 *      `applyExtensionHostQueueLogPolicy(isDogfood, env)`. The
 *      diagnostic no longer owns the production-soundness gate.
 *
 *      Removing the diagnostic does NOT remove this gate. The gate
 *      is permanent for the lifetime of the extension host.
 */
export function applyExtensionHostHotloopDiagnosticProfile(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): {
	readonly enabled: boolean
	readonly flipped: boolean
	readonly queueLogEnabled: boolean
	readonly queueLogFlipped: boolean
} {
	// Gate 1 — diagnostic enablement.
	const diagWas = _isExtensionHostHotloopDiagnosticEnabledForActivation()
	let diagShould = isDogfood
	const diagEnvRaw = env.CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC
	if (typeof diagEnvRaw === "string" && diagEnvRaw.length > 0) {
		const normalized = diagEnvRaw.trim().toLowerCase()
		if (normalized === "0" || normalized === "off" || normalized === "false") {
			diagShould = false
		}
		// Explicit ON is honored ONLY in dogfood (matches the
		// generic decideKnob invariant — no public silent activation).
		else if (isDogfood && (normalized === "1" || normalized === "true" || normalized === "yes")) {
			diagShould = true
		}
	}
	let diagFlipped = false
	if (diagShould && !diagWas) {
		setExtensionHostHotloopDiagnosticEnabled(true)
		diagFlipped = true
	} else if (!diagShould && diagWas) {
		setExtensionHostHotloopDiagnosticEnabled(false)
		diagFlipped = true
	}

	// Gate 2 — synchronous queue-log opt-in (the production soundness
	// gate). Delegated to the PERMANENT policy module
	// (extension-host-queue-log-policy.ts). The diagnostic does NOT
	// own this gate; it merely calls the permanent resolver.
	const qlResult = applyExtensionHostQueueLogPolicy(isDogfood, env)

	return {
		enabled: diagShould,
		flipped: diagFlipped,
		queueLogEnabled: qlResult.enabled,
		queueLogFlipped: qlResult.flipped,
	}
}

function _isExtensionHostHotloopDiagnosticEnabledForActivation(): boolean {
	return _isExtensionHostHotloopDiagnosticEnabled()
}

// ===========================================================================
// ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01 — central dogfood
// profile resolver for the ALLOCAUTH01 (Extension Host Allocation
// Authority) capture seam.
//
// CONTRACT — frozen in this ACT:
//   - The diagnostic is gated by the explicit env knob
//     CLINEMM_DIAG_ALLOCATION_PROFILE=<truthy>.
//   - The env knob is honored ONLY in dogfood (the central identity bit).
//     Public installs NEVER honor the env knob regardless of value
//     (matches the extension-host-queue-log-policy invariant).
//   - The module seam is
//     ./extension-host-allocation-profiler.ts#applyExtensionHostAllocationProfilerPolicy.
//   - The activation helper is called from extension.ts:activate
//     (sibling to the EHLOOP01 activation); there is exactly ONE
//     production activation path.
//
// HONEST STOP RULE: once the allocation authority is classified A/B/C
// OR CAPTURE_INSUFFICIENT OR HALT_PROFILER_PERTURBATION_TOO_HIGH, this
// resolver + activation helper + the profiler module + the trigger
// call site + the focused tests + the analyzer script MUST be removed
// TOGETHER.
// ===========================================================================

/**
 * THE single production activation helper for the ALLOCAUTH01 seam.
 * Called from extension.ts:activate (sibling to the EHLOOP01
 * activation); there is exactly ONE production activation path,
 * no copied orchestration in tests.
 *
 * Mirrors the queue-log env knob resolver in spirit:
 *
 *   isDogfood === true   + env knob truthy -> profiler ARMED
 *   isDogfood === true   + env knob unset   -> profiler DISABLED
 *   isDogfood === false  (any env)         -> profiler DISABLED (fail-closed)
 */
export function applyExtensionHostAllocationProfilerProfile(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	return applyExtensionHostAllocationProfilerPolicy(isDogfood, env)
}

// ===========================================================================
// ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
// ---------------------------------------------------------------------------
// Sibling helper to applyExtensionHostAllocationProfilerProfile. The CPU
// profiler is INDEPENDENT of the allocation profiler (per ACT §5) — both
// share the same dogfood gate + env-knob pattern but use distinct env
// vars (CLINEMM_DIAG_CPU_PROFILE vs CLINEMM_DIAG_ALLOCATION_PROFILE) and
// distinct state machines.
//
// CONTRACT (mirrors the allocation helper exactly):
//
//   isDogfood === true   + env knob truthy -> profiler ARMED
//   isDogfood === true   + env knob unset   -> profiler DISABLED
//   isDogfood === false  (any env)         -> profiler DISABLED (fail-closed)
//
// HONEST STOP RULE: once CPU authority is classified CP1..CP5 OR
// CAPTURE_INSUFFICIENT OR HALT_CPU_PROFILER_PERTURBATION_TOO_HIGH, this
// resolver + activation helper + the profiler module + the trigger
// call site + the focused tests + the analyzer script MUST be removed
// TOGETHER.
// ===========================================================================

export function applyExtensionHostCpuProfilerProfile(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	return applyExtensionHostCpuProfilerPolicy(isDogfood, env)
}

// ===========================================================================
// ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
// ---------------------------------------------------------------------------
// Sibling helper to applyExtensionHostCpuProfilerProfile. The
// termination witness is INDEPENDENT of the CPU profiler and the
// allocation profiler (per ACT §5) -- all three share the same
// dogfood gate + env-knob pattern but use distinct env vars
// (CLINEMM_DIAG_TERMINATION_AUTHORITY vs CLINEMM_DIAG_CPU_PROFILE
// vs CLINEMM_DIAG_ALLOCATION_PROFILE) and distinct state machines.
//
// CONTRACT (mirrors the allocation + CPU helpers exactly):
//
//   isDogfood === true   + env knob truthy -> witness ARMED
//   isDogfood === true   + env knob unset   -> witness DISABLED
//   isDogfood === false  (any env)         -> witness DISABLED (fail-closed)
//
// RETAIN_AS_DIAGNOSTIC: per the operator's directive accompanying
// this ACT, this resolver + activation helper + the witness module +
// the trigger call site + the focused tests + the analyzer script
// MAY stay in the tree as a labeled diagnostic substrate once
// termination authority is classified TA1..TA4.
// ===========================================================================

export function applyExtensionHostTerminationAuthorityProfile(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	return applyExtensionHostTerminationAuthorityPolicy(isDogfood, env)
}

// ===========================================================================
// ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01
//
// Central dogfood profile resolver for:
//   M (myc prime live diagnostic) — see
//       resolveEffectiveMycPrimeLiveDiag /
//       applyMycPrimeLiveDiagDiagnosticProfile
//   R (provider-request AI-SDK prompt capture) — see
//       resolveEffectiveProviderRequestCapture /
//       applyProviderRequestCaptureDiagnosticProfile
//
// HONEST STOP RULE (mirrors BJLA / BOCOR / CCARD): when the myc-prime
// causal record is classified AND a successor evidence substrate
// lands, this resolver + activation helper + the M/R rows of the
// diagnostic profile + the `setMycPrimeLiveDiagEnabled` setter + the
// bounded env adapter in `applyProviderRequestCaptureDiagnosticProfile`
// MUST be reviewed TOGETHER. The forensic diagnostic remains gated on
// its original ACT-03 removal triggers:
//   1. root cause isolated,
//   2. capture insufficient,
//   3. successor evidence supersedes it.
// Dogfood default activation does NOT silently make forensic
// instrumentation permanent.
// ===========================================================================

import { __resetMycPrimeLiveDiagForTests, isMycPrimeLiveDiagEnabled, setMycPrimeLiveDiagEnabled } from "./myc-prime-live-diag"

/**
 * Provider capture mode union (subset of upstream `CaptureMode` in
 * sdk/packages/llms/src/providers/provider-request-capture.ts).
 * Re-declared here so the resolver stays in apps/vscode and does not
 * pull upstream types into the central profile.
 */
export type ProviderRequestCaptureMode = "off" | "summary" | "full"

/**
 * Frozen dogfood defaults for provider-request capture.
 * (Per ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01 §10, §11, §16.)
 */
export const DOGFOOD_PROVIDER_CAPTURE_MODE_DEFAULT: ProviderRequestCaptureMode = "full"
export const DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT: boolean = false
export const DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT: "on" | "off" = "on"

// ---------------------------------------------------------------------------
// M knob — myc prime live diagnostic
//
// Precedence (top wins, deterministic, fail-closed):
//
//   1. Explicit env override:
//        CLINEMM_MYC_PRIME_DIAG="1"/"true"/"yes"    -> ON
//        CLINEMM_MYC_PRIME_DIAG="0"/"off"/"false" -> OFF
//        garbage / unset                            -> fall through
//   2. Profile default:
//        isDogfood === true  -> ON  (no more env-var incantation)
//        isDogfood === false -> OFF (public default)
//
// Explicit-OFF is honored in BOTH profiles (matches decideKnob invariant).
// Explicit-ON is honored ONLY in dogfood (no public silent activation,
// ACT §18 invariant).
// ---------------------------------------------------------------------------

export function resolveEffectiveMycPrimeLiveDiag(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "env" | "profile" } {
	const raw = env.CLINEMM_MYC_PRIME_DIAG
	if (typeof raw === "string" && raw.length > 0) {
		const normalized = raw.trim().toLowerCase()
		if (TRUTHY_DISABLE.has(normalized)) {
			return { enabled: false, source: "env" }
		}
		// Explicit ON is honored in EITHER profile for the M knob.
		// The myc prime live diagnostic is a forensic scaffold (not
		// a product feature); the legacy ACT-03 contract was that
		// `=1` enabled regardless of profile. ACT §9 explicitly
		// preserves this opt-in. The "no public silent activation"
		// §18 invariant applies to the V/I/A/P/D product-feature
		// knobs — the M knob is an explicit opt-in forensic tool.
		if (TRUTHY_ENABLE.has(normalized)) {
			return { enabled: true, source: "env" }
		}
		// garbage -> fall through to profile default
	}
	return { enabled: isDogfood, source: "profile" }
}

/**
 * THE single production activation helper for the myc prime live
 * diagnostic seam. Mirrors the BJLA / BOCOR / CCARD pattern.
 *
 * Idempotent. Sets the module-level seam in
 * `./myc-prime-live-diag.ts` (NOT process.env) so the recorder hot
 * path reads a single boolean instead of re-reading the env on every
 * observation point.
 */
export function applyMycPrimeLiveDiagDiagnosticProfile(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
): { readonly enabled: boolean; readonly flipped: boolean } {
	const resolved = resolveEffectiveMycPrimeLiveDiag(env, isDogfood)
	const was = isMycPrimeLiveDiagEnabled()
	if (was === resolved.enabled) {
		return { enabled: resolved.enabled, flipped: false }
	}
	setMycPrimeLiveDiagEnabled(resolved.enabled)
	return { enabled: resolved.enabled, flipped: true }
}

/**
 * Test seam: reset the myc-prime diagnostic module to its env-fallback
 * path. Production code MUST NOT call this. Tests that flip between
 * dogfood and public in a single suite use it to observe a fresh
 * resolution.
 */
export function __resetMycPrimeLiveDiagDiagnosticProfileForTests(): void {
	__resetMycPrimeLiveDiagForTests()
}

// ---------------------------------------------------------------------------
// R knob — provider-request AI-SDK prompt capture
//
// Precedence (top wins; identical pattern for every column):
//
//   1. Explicit env override (operator wins in BOTH profiles):
//        CLINE_CAPTURE_PROVIDER_REQUEST:
//          "full" / "summary"            -> that mode
//          "off"                         -> off
//          garbage / unset               -> fall through
//        CLINE_CAPTURE_WIRE:
//          "true"  / "1"                 -> true
//          "false" / "0" / garbage       -> fall through
//        CLINE_CAPTURE_CLEANUP:
//          "off"                         -> off
//          anything else / unset         -> fall through
//
//   2. Profile default:
//        dogfood ->
//          captureMode = "full"   (so LIVE04 can prove payload contents)
//          wireCapture = false    (DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT)
//          cleanup    = "on"      (DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT;
//                                   24h prune is the right safety net
//                                   because `full` captures contain prompt
//                                   content)
//        public  ->
//          captureMode = "off"    (public default OFF)
//          wireCapture = false
//          cleanup    = "on"
// ---------------------------------------------------------------------------

export interface ResolvedProviderRequestCapture {
	readonly captureMode: ProviderRequestCaptureMode
	readonly wireCapture: boolean
	readonly cleanup: "on" | "off"
	readonly source: {
		readonly captureMode: "env" | "profile"
		readonly wireCapture: "env" | "profile"
		readonly cleanup: "env" | "profile"
	}
	/** Effective dataDir binding (only set in dogfood). */
	readonly dataDir: string | null
}

export function resolveEffectiveProviderRequestCapture(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
	dataDir: string | null,
): ResolvedProviderRequestCapture {
	// captureMode
	const modeRaw = env.CLINE_CAPTURE_PROVIDER_REQUEST
	let captureMode: ProviderRequestCaptureMode
	let captureModeSource: "env" | "profile"
	if (typeof modeRaw === "string" && modeRaw.length > 0) {
		const normalized = modeRaw.trim().toLowerCase()
		if (normalized === "full" || normalized === "summary" || normalized === "off") {
			captureMode = normalized
			captureModeSource = "env"
		} else {
			captureMode = isDogfood ? DOGFOOD_PROVIDER_CAPTURE_MODE_DEFAULT : "off"
			captureModeSource = "profile"
		}
	} else {
		captureMode = isDogfood ? DOGFOOD_PROVIDER_CAPTURE_MODE_DEFAULT : "off"
		captureModeSource = "profile"
	}

	// wireCapture
	const wireRaw = env.CLINE_CAPTURE_WIRE
	let wireCapture: boolean
	let wireCaptureSource: "env" | "profile"
	if (typeof wireRaw === "string" && wireRaw.length > 0) {
		const normalized = wireRaw.trim().toLowerCase()
		if (normalized === "true" || normalized === "1") {
			wireCapture = true
			wireCaptureSource = "env"
		} else if (normalized === "false" || normalized === "0") {
			wireCapture = false
			wireCaptureSource = "env"
		} else {
			wireCapture = isDogfood ? DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT : false
			wireCaptureSource = "profile"
		}
	} else {
		wireCapture = isDogfood ? DOGFOOD_PROVIDER_WIRE_CAPTURE_DEFAULT : false
		wireCaptureSource = "profile"
	}

	// cleanup
	const cleanupRaw = env.CLINE_CAPTURE_CLEANUP
	let cleanup: "on" | "off"
	let cleanupSource: "env" | "profile"
	if (typeof cleanupRaw === "string" && cleanupRaw.length > 0) {
		const normalized = cleanupRaw.trim().toLowerCase()
		if (normalized === "off") {
			cleanup = "off"
			cleanupSource = "env"
		} else {
			cleanup = isDogfood ? DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT : "on"
			cleanupSource = "profile"
		}
	} else {
		cleanup = isDogfood ? DOGFOOD_PROVIDER_CAPTURE_CLEANUP_DEFAULT : "on"
		cleanupSource = "profile"
	}

	return {
		captureMode,
		wireCapture,
		cleanup,
		source: {
			captureMode: captureModeSource,
			wireCapture: wireCaptureSource,
			cleanup: cleanupSource,
		},
		dataDir: isDogfood && typeof dataDir === "string" && dataDir.length > 0 ? dataDir : null,
	}
}

/**
 * THE single production activation helper for the provider-request
 * capture seam. Mirrors the BJLA / BOCOR / CCARD pattern.
 *
 * Idempotent. Writes the EFFECTIVE values to `process.env` ONCE,
 * BEFORE any provider request flows. The recorder hot path in
 * `sdk/packages/llms/src/providers/provider-request-capture.ts`
 * continues to read `process.env` directly (its design); the
 * activation helper does NOT mutate env per request.
 *
 * `dataDir` is the extension-owned writable root
 * (`context.globalStorageUri.fsPath` for VS Code). When provided
 * AND dogfood, the helper sets `CLINE_DATA_DIR=<dataDir>` so the
 * upstream fallback path resolver materializes captures under
 * `<dataDir>/provider-request-captures/` (NEVER in the repository).
 * Public installs never set `CLINE_DATA_DIR`.
 *
 * Why this adapter exists: upstream provider capture exposes ONLY
 * env-backed configuration at HEAD. ACT §32 forbids modifying
 * upstream. The bounded env adapter is the narrowest change that
 * gives dogfood default-ON without changing upstream.
 */
export function applyProviderRequestCaptureDiagnosticProfile(
	isDogfood: boolean,
	env: NodeJS.ProcessEnv = process.env,
	dataDir: string | null = null,
): {
	readonly captureMode: ProviderRequestCaptureMode
	readonly wireCapture: boolean
	readonly cleanup: "on" | "off"
	readonly dataDir: string | null
	readonly flipped: boolean
} {
	const resolved = resolveEffectiveProviderRequestCapture(env, isDogfood, dataDir)

	// Env-write policy:
	//
	// We mutate process.env ONLY when:
	//   - the upstream recorder would NOT observe the resolved
	//     value from its own defaults, AND
	//   - the operator did not explicitly set the var (so we are
	//     enforcing the profile default, not overriding the operator).
	//
	// This is the bounded env adapter contract from ACT §14. Public
	// installs never get env mutations because the upstream default
	// already matches the resolved public values (capture off, wire
	// off, cleanup on, no data dir). Dogfood installs get the
	// minimum necessary mutations so the upstream recorder honors the
	// dogfood defaults.

	const wasCapture = process.env.CLINE_CAPTURE_PROVIDER_REQUEST
	const wasWire = process.env.CLINE_CAPTURE_WIRE
	const wasCleanup = process.env.CLINE_CAPTURE_CLEANUP
	const wasDataDir = process.env.CLINE_DATA_DIR

	// Capture mode: only mutate when the resolved mode differs from
	// the recorder's default ("off") AND the operator didn't set it.
	const captureShouldWrite = isDogfood && resolved.captureMode !== "off" && typeof wasCapture !== "string"
	const captureFlipped = captureShouldWrite
	if (captureShouldWrite) {
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = resolved.captureMode
	}

	// Wire capture: upstream default is false; we only need to mutate
	// when the operator explicitly opted in to wire capture (which
	// already sets CLINE_CAPTURE_WIRE=true — the resolver is a
	// pass-through in that case). We never need to write false.
	const wireFlipped = false // we never write wire (default false matches all profiles)
	void wasWire

	// Cleanup: upstream default is "on"; we never need to write
	// "on". The operator can opt out via CLINE_CAPTURE_CLEANUP=off
	// (which the upstream recorder already honors).
	const cleanupFlipped = false // we never write cleanup (default on matches all profiles)
	void wasCleanup

	// Data dir: only mutate in dogfood AND when the operator did not
	// set CLINE_DATA_DIR. This is the only required env write besides
	// CLINE_CAPTURE_PROVIDER_REQUEST.
	const dataDirShouldWrite = isDogfood && resolved.dataDir !== null && typeof wasDataDir !== "string"
	const dataDirFlipped = dataDirShouldWrite
	if (dataDirShouldWrite && resolved.dataDir) {
		process.env.CLINE_DATA_DIR = resolved.dataDir
	}

	const flipped = captureFlipped || wireFlipped || cleanupFlipped || dataDirFlipped
	return {
		captureMode: resolved.captureMode,
		wireCapture: resolved.wireCapture,
		cleanup: resolved.cleanup,
		dataDir: resolved.dataDir,
		flipped,
	}
}

// ===========================================================================
// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY
//
// Central activation helper for the SYNCHRONOUS REAL Elm authority
// runtime. The runtime is MANDATORY — there is no env gate, no
// opt-in/opt-out, no silent default-Authorize fallback. The Elm
// kernel is the sole completion authority.
//
// CONTRACT — frozen:
//   - The authority runtime is initialized UNCONDITIONALLY at
//     extension activation, BEFORE SdkController construction.
//   - When the supplied `kernelPath` is non-null, the runtime is
//     armed; the Elm kernel is loaded on first consult; the
//     production `checkElmCompletionAuthority` consult is fail-closed
//     (HOLD and FAILURE both suppress commit effect; AUTHORIZE
//     permits it exactly once).
//   - When the supplied `kernelPath` is null (a packaging error: the
//     canonical runtime asset is missing from the VSIX), the runtime
//     is left in the fail-closed `!enabled` state and the activation
//     helper emits an audible `console.error`. Subsequent consults
//     return `failure` decisions. The legacy
//     `CLINEMM_COMPLETION_AUTHORITY_ELM` env var is REMOVED; there
//     is no opt-out path.
//
// Chronology discipline is enforced INSIDE the runtime
// (`completion-authority-elm-authority-runtime.ts > AUTHORITY_STAGES`):
// the authority kernel never receives post-decision stages
// (`task_completion_committed`, `completion_presented`,
// `task_cancelled`) — feeding those to Elm would constitute the
// self-fulfilling loop the ACT §8 chronology guard prohibits.
// ===========================================================================

/**
 * THE single production activation helper for the synchronous REAL Elm
 * authority runtime. Called from extension.ts:activate BEFORE
 * SdkController construction. There is exactly ONE production
 * activation path; no copied orchestration in tests. The runtime is
 * unconditional (no env gate).
 *
 * Returns:
 *   enabled    — true iff the runtime is now armed (post-call state).
 *   flipped    — true iff this call changed the previous state.
 *   kernelPath — the resolved path passed to the runtime, or null when
 *                the canonical runtime asset is missing from the VSIX.
 *
 * The kernel path is passed by the caller (extension.ts:activate)
 * because the runtime is `vscode`-free and does not know how to
 * derive the packaged extension root.
 */
export function initializeElmAuthorityRuntime(kernelPath: string | null): {
	readonly enabled: boolean
	readonly flipped: boolean
	readonly kernelPath: string | null
} {
	const wasEnabled = ElmAuthorityModule.isElmAuthorityAvailable()
	if (!kernelPath) {
		Logger.error(
			"[SdkController] Elm authority runtime asset is missing from the VSIX; " +
				"the runtime will refuse every completion commit. Check that " +
				"`runtime-assets/completion-authority.js` is present in the packaged extension.",
		)
		ElmAuthorityModule.setElmAuthorityProvider(null)
		return { enabled: false, flipped: wasEnabled, kernelPath: null }
	}
	ElmAuthorityModule.setElmAuthorityProvider(kernelPath)
	return {
		enabled: true,
		flipped: !wasEnabled,
		kernelPath,
	}
}

// ===========================================================================
// ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS
//
// Central dogfood profile resolver for the TaskHeader Elm runtime-shadow
// diagnostic.
//
// CONTRACT — frozen in this ACT:
//   - There is NO env-var override. The user-facing workflow is:
//       public profile  -> shadow OFF (no Elm evaluation)
//       dogfood profile -> shadow ON  (automatic; the operator does NOT
//                                       need to set any env var)
//   - The activation helper
//     (`applyTaskHeaderElmRuntimeShadowDiagnosticProfile`) is called
//     from `extension.ts:activate` (sibling to the existing THSICAP
//     / W carrier / D-knob activations); there is exactly ONE
//     production activation path, no copied orchestration in tests.
//
// Hard invariants (ACT §C2, §C3):
//   - public install NEVER evaluates the Elm kernel against the
//     TaskHeader production seam. The shadow is OFF in public by
//     identity; no env var, no flag, no command flips it on.
//   - dogfood install evaluates the Elm kernel against the TaskHeader
//     production seam automatically. The shadow is ON in dogfood by
//     identity; the operator does NOT need to set any env var to see
//     the bounded observations (the Command Palette diagnostic
//     surfaces them — see `task-header-elm-shadow-diagnostics.ts`).
//   - When disabled: no Elm kernel load, no filesystem read for the
//     TaskHeader Elm asset, no Elm initialization, no comparison, no
//     log emission, no state mutation, no wire delta, no TaskHeader
//     semantic delta.
//   - The TS production selector (`selectTaskHeaderPresentation`)
//     remains authoritative in EVERY branch. The shadow's ONLY effect
//     is appending to a bounded observation ring; the returned
//     `taskHeaderPresentation` is byte-identical to the pre-shadow
//     behavior in every observation.
//
// Precedence (top wins; deterministic; fail-closed):
//
//   1. Profile identity (the ONLY gate; no env var):
//        `isDogfood === true`  -> ON  (dogfood default ON)
//        `isDogfood === false` -> OFF (public default OFF)
//
// REMOVAL_TRIGGER (per Factory doctrine on temporary diagnostics):
//   first successful LIVE qualification that authorizes cutover
//   to `ORCHESTRATION03-AUTHORITY`, OR
//   the first real LIVE semantic mismatch that identifies a contract
//   defect, OR
//   CAPTURE_INSUFFICIENT.
// When cutover lands, REMOVE this resolver + activation helper +
// `runtime-assets/task-header-orchestration.js` staging + the
// comparison seam at `SdkController.ts:5883-5902` + the wiring in
// `extension.ts:activate` + the Command Palette diagnostic +
// the registry entry + the package.json declaration together.
// ===========================================================================

import {
	isTaskHeaderElmRuntimeShadowEnabled as _publicIsTaskHeaderElmRuntimeShadowEnabled,
	setTaskHeaderElmRuntimeShadowEnabled as _setTaskHeaderElmRuntimeShadowEnabled,
} from "./task-header-elm-shadow"

/**
 * Resolves the EFFECTIVE TaskHeader Elm runtime-shadow state from
 * the dogfood identity bit. Pure / synchronous / no I/O / NO env var.
 *
 * Contract (frozen):
 *   - `isDogfood === true`  -> ON  (dogfood default ON, automatic)
 *   - `isDogfood === false` -> OFF (public default OFF, automatic)
 *
 * The env-var branch from the predecessor ACT was REMOVED by
 * ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS — the user does
 * NOT want another env-var workflow for this temporary diagnostic.
 * The `env` parameter is kept for source-compatibility (and so the
 * signature continues to match the central-diagnostic-profile
 * convention), but it is intentionally unused.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function resolveEffectiveTaskHeaderElmRuntimeShadow(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "profile" } {
	// Layer 1 (the only layer): profile identity.
	return { enabled: isDogfood, source: "profile" }
}

/**
 * THE single production activation helper for the TaskHeader Elm
 * runtime-shadow seam. Called from `extension.ts:activate` (sibling
 * to the existing THSICAP / W carrier / D-knob activations); there
 * is exactly ONE production activation path, no copied orchestration
 * in tests.
 *
 * Contract:
 *   - Reads the resolved shadow state via
 *     `resolveEffectiveTaskHeaderElmRuntimeShadow(env, isDogfood)`.
 *   - Flips the module seam in `./task-header-elm-shadow.ts` via
 *     `_setTaskHeaderElmRuntimeShadowEnabled(enabled)` — idempotent
 *     (only mutates when the resolved state diverges from the
 *     current seam state).
 *   - Returns `{ enabled, source, flipped }` for diagnostics.
 *
 * Called BEFORE the first `SdkController.getStateToPostToWebview()`
 * (the publication seam where the shadow helper fires). When disabled,
 * the helper at the seam short-circuits without invoking the Elm
 * kernel.
 */
export function applyTaskHeaderElmRuntimeShadowDiagnosticProfile(
	env: NodeJS.ProcessEnv,
	isDogfood: boolean,
): { readonly enabled: boolean; readonly source: "profile"; readonly flipped: boolean } {
	const resolved = resolveEffectiveTaskHeaderElmRuntimeShadow(env, isDogfood)
	const was = _publicIsTaskHeaderElmRuntimeShadowEnabled()
	if (resolved.enabled && !was) {
		_setTaskHeaderElmRuntimeShadowEnabled(true)
		return { enabled: true, source: "profile", flipped: true }
	}
	if (!resolved.enabled && was) {
		_setTaskHeaderElmRuntimeShadowEnabled(false)
		return { enabled: false, source: "profile", flipped: true }
	}
	return { enabled: resolved.enabled, source: "profile", flipped: false }
}
