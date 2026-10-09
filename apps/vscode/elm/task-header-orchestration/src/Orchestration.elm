module Orchestration exposing
    ( projectPresentation
    )


{-| Pure decision kernel for the TaskHeader presentation projection.

This module is a pure projection `Facts -> Presentation`. It does NOT
import anything from `Main` or `Codec`. The four-rule precedence is
encoded by the body shape, not by an assertion.

Correspondence with `selectTaskHeaderPresentation`:

  R1 (HOST COMPACTION):
    currentLegacyPhase == PhaseCompacting
      => { phase = PhaseCompacting, source = SourceHost, seq = facts.seq }

  R2 (HOST AWAITING_FOLLOWUP):
    currentLegacyPhase == PhaseAwaitingFollowup
      => { phase = PhaseAwaitingFollowup, source = SourceHost, seq = facts.seq }

  R2.5 (HOST ERROR / RESUMABLE — PTBPC01):
    currentLegacyPhase == PhaseError OR currentLegacyPhase == PhaseResumable
      => { phase = currentLegacyPhase, source = SourceHost, seq = facts.seq }

  R3 (CANONICAL SHADOW):
    canonicalShadowPhase = Just p
    AND NOT stale(...)
    AND NOT unbound_demote(...)
      => { phase = p, source = SourceShadow, seq = facts.seq }

  R4 (LEGACY ABSENCE):
    else
      => { phase = currentLegacyPhase, source = SourceLegacy, seq = facts.seq }

Auxiliary predicates (closed):
  terminalShadowPhase p =
    p == PhaseIdle OR p == PhaseCompleted OR p == PhaseError OR p == PhaseResumable
  activeLegacyPhase p =
    p == PhaseStreaming OR p == PhaseAwaitingApproval

  stale =
    (canonicalShadowObservedTurnSeq != Nothing)
    AND (seq > unwrap canonicalShadowObservedTurnSeq)
  unbound_demote =
    (canonicalShadowObservedTurnSeq == Nothing)
    AND terminalShadowPhase (unwrap canonicalShadowPhase)
    AND activeLegacyPhase currentLegacyPhase

ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01 (PTBPC01):
  R2.5 was added so that when the host has authoritatively written
  `error` or `resumable` (e.g. the BCB re-registration site at
  sdk-session-event-coordinator.ts:2725-2753 stamping
  `observation_unavailable`, or the host's cancelTask writing
  `resumable`), the host's authority wins over an UNBOUND canonical
  shadow that may be projecting a different terminal phase. The
  host-owned terminal/blocked phase is the truthful user-visible
  surface; the SCAR shadow projection is not. This closes the
  dual-boundary defect (host `currentLegacyPhase` is `streaming` and
  the UNBOUND-demotion guard falls through to legacy, falsely
  showing Working) and the inverse (legacy is `idle`/anything and
  the shadow's `completed` is trusted, fabricating completion).

This module NEVER:
  * reads global state;
  * reads wall-clock time;
  * mutates any model;
  * emits telemetry;
  * invokes I/O of any kind.

It is a total function: for any input `Facts` it returns exactly one
`Presentation` (no Result / Maybe).

-}

import Domain exposing
    ( Facts
    , Presentation
    , PresentationSource(..)
    , TurnPhase
    , isActiveLegacyPhase
    , isTerminalShadowPhase
    )


projectPresentation : Facts -> Presentation
projectPresentation facts =
    -- R1 — HOST COMPACTION OVERRIDE (host authority for the one
    -- phase the canonical shadow cannot represent).
    if facts.currentLegacyPhase == Domain.PhaseCompacting then
        Domain.Presentation
            facts.currentLegacyPhase
            SourceHost
            facts.seq

    -- R2 — HOST AWAITING_FOLLOWUP OVERRIDE (host authority for the
    -- user-owned phase the canonical shadow cannot represent).
    else if facts.currentLegacyPhase == Domain.PhaseAwaitingFollowup then
        Domain.Presentation
            facts.currentLegacyPhase
            SourceHost
            facts.seq

    -- R2.5 — HOST ERROR / RESUMABLE OVERRIDE (PTBPC01). The host
    -- has authoritatively written a terminal/blocked phase that
    -- the canonical shadow cannot demote: `error` is the
    -- blocked-but-incomplete verdict (e.g. BCB
    -- `observation_unavailable`), `resumable` is the user-cancelled
    -- pause verdict. Both are host-owned terminal/blocked phases;
    -- the SCAR shadow projection (UNBOUND) is not authoritative.
    -- Mirrors R1/R2's structure so the consumer sees
    -- source=SourceHost and the existing stateLabel mapping
    -- renders "Error" / "Paused" (live:false). Without this
    -- rule, the SCAR shadow is trusted and the user sees a
    -- fabricated "Complete" or a stale "Working".
    else if facts.currentLegacyPhase == Domain.PhaseError then
        Domain.Presentation
            facts.currentLegacyPhase
            SourceHost
            facts.seq

    else if facts.currentLegacyPhase == Domain.PhaseResumable then
        Domain.Presentation
            facts.currentLegacyPhase
            SourceHost
            facts.seq

    -- R3 — CANONICAL SHADOW (the shadow's `turnPhase` is the
    -- authority for 6 of the 8 phases). Falls through to R4 when
    -- the shadow is stale (REPAIR01-CORRECTION02) OR when an
    -- UNBOUND shadow would demote an authoritative ACTIVE
    -- legacy phase to a TERMINAL shadow phase (the
    -- UNBOUND-demotion guard added by
    -- ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01).
    else
        case facts.canonicalShadowPhase of
            Nothing ->
                -- No shadow at the seam: fall through to legacy.
                legacyPresentation facts

            Just shadowPhase ->
                if isShadowStale facts || isUnboundDemotingActiveToTerminal facts shadowPhase then
                    legacyPresentation facts

                else
                    Domain.Presentation
                        shadowPhase
                        SourceShadow
                        facts.seq


{-| R4 — ABSENCE FALLBACK. Hub/Remote hosts, Local pre-observation,
or any of the rule-3 fall-through conditions.

The selector MUST NOT consult the shadow for the R4 case: by
construction, R4 fires when `canonicalShadowPhase` is `Nothing`
OR when rule 3 has fallen through. The `seq` is preserved verbatim.
-}
legacyPresentation : Facts -> Presentation
legacyPresentation facts =
    Domain.Presentation
        facts.currentLegacyPhase
        SourceLegacy
        facts.seq


{-| Staleness predicate (CORRECTION02 same-domain comparison).

  stale = (canonicalShadowObservedTurnSeq != Nothing)
          AND (seq > canonicalShadowObservedTurnSeq)

Both `seq` and `canonicalShadowObservedTurnSeq` are in the TurnState
sequence domain. The cross-domain numeric comparison CORRECTION01
attempted has been removed.

A stale shadow MUST NOT override a fresh legacy phase. This is the
guard added by ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-
REPAIR01-CORRECTION02.

-}
isShadowStale : Facts -> Bool
isShadowStale facts =
    case facts.canonicalShadowObservedTurnSeq of
        Nothing ->
            False

        Just observedSeq ->
            facts.seq > observedSeq


{-| UNBOUND-demotion guard.

  unbound_demote =
    (canonicalShadowObservedTurnSeq == Nothing)
    AND terminalShadowPhase canonicalShadowPhase
    AND activeLegacyPhase currentLegacyPhase

Bounded guard added by ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-
RECON01: an UNBOUND shadow (no `canonicalShadowObservedTurnSeq`)
lacks the provenance needed to demote an authoritative ACTIVE
legacy phase to a TERMINAL shadow phase. The selector falls
through to the legacy branch when this predicate holds.

-}
isUnboundDemotingActiveToTerminal : Facts -> TurnPhase -> Bool
isUnboundDemotingActiveToTerminal facts shadowPhase =
    case facts.canonicalShadowObservedTurnSeq of
        Nothing ->
            isTerminalShadowPhase shadowPhase && isActiveLegacyPhase facts.currentLegacyPhase

        Just _ ->
            False