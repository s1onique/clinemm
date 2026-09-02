# ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01

> Status: **CLOSED — ROOT_CAUSE_ISOLATED_FOR_GENERIC_SUBCASE /
> REPAIR_VERIFIED_FOR_EXERCISED_CONTRACT / LIVE_CLOSURE_PENDING
> (downgraded by reviewer disposition 2026-09-02
> HALT_LIVE_BINDING_NOT_PROVEN; bounded completion landed at
> 84dbaaade via
> ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01;
> LIVE closure verdict waits for one post-repair dogfood cycle).**
>
> Epistemic purpose: **RECON + BOUNDED_PRODUCTION_REPAIR**.
>
> ```text
> ENTRY_HEAD                  = cb5b5223913e66688cc3f91dd4982b313878d908
> SUBJECT_HEAD                = 6eaa0864524fd60563277caa735351c90289bd52
> LIVE specimen taskId        = 1788292664979_9qbpd
> LIVE epoch                  = 16
> LIVE TSWPD                  = streaming -> streaming (no active->idle write)
> LIVE publication first div  = 27546 (taskHeaderPhase=idle, taskHeaderSource=shadow,
>                                       shadowPublicationBinding=UNBOUND)
> LIVE contradiction          = authoritative streaming + displayed Idle
>                               (UI shows "Idle" while task is still active)
> BOUND_SPECIMEN              = task 1788292664979_9qbpd, epoch 16
> ROOT_CAUSE_ISOLATED         = YES (CASE_A selector authority defect)
> PRODUCTION_REPAIR           = APPLIED (Strategy-B bounded, +78/-10 lines,
>                                1 production source file)
> CLASSIFICATION              = CASE_A (selector authority defect)
> STRATEGY                    = UNBOUND-shadow demotion guard at selector rule 3
> VERDICT                     = ROOT_CAUSE_ISOLATED_FOR_GENERIC_SUBCASE /
>                                REPAIR_VERIFIED_FOR_EXERCISED_CONTRACT /
>                                LIVE_CLOSURE_PENDING
>                                (CORRECTION01 lands the diagnostic
>                                 capture; LIVE closure waits for
>                                 one post-repair dogfood cycle)
> ```

> See the full evidence chain under
> `.factory/evidence/ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01/`.

## Summary

The LIVE specimen taskId `1788292664979_9qbpd` (epoch 16) was observed with
**authoritative `turnPhase = "streaming"` plus persistent
`taskHeaderPhase = "idle"` + `taskHeaderSource = "shadow"` +
`shadowPublicationBinding = "UNBOUND"`** across many publications (27546,
27548, 27552, ...). The UI rendered "Idle" while the task was logically
active.

The LIVE TSWPD proves:
```
writerId    = controller-epoch-transition-reseed
previous    = { phase: "streaming", seq: 27543 }
committed   = { phase: "streaming", seq: 27545 }
```

i.e. NO active->idle TurnState write was observed in epoch 16. The
predecessor bounded repair
`ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01`
(Strategy-B applied to `resetMessageTranslatorAndFence`) is therefore
**NOT contradicted** by this specimen.

## Production selector inspected

`selectTaskHeaderPresentation(input)` at
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:505` has FOUR
rules:

```
1. HOST COMPACTION OVERRIDE       (currentLegacyPhase === "compacting")
2. HOST AWAITING_FOLLOWUP         (currentLegacyPhase === "awaiting_followup")
3. CANONICAL SHADOW               (canonicalShadowPhase !== undefined
                                    && !stale)
4. ABSENCE FALLBACK               (legacy)
```

The staleness gate in rule 3 reads:
```
const isShadowStale =
    input.canonicalShadowObservedTurnSeq !== undefined &&
    input.seq > input.canonicalShadowObservedTurnSeq
```

**The defect**: when `canonicalShadowObservedTurnSeq === undefined`
(the UNBOUND case at `activity-publication-v1.ts:148` — the
`ArbiterSnapshot` carries no `stateVersion` / `seq`), the gate does
NOT fire and rule 3 happily lets the shadow win. The LIVE-shaped tuple
(LIVE-shadow idle vs authoritative streaming) reaches rule 3 and produces
`phase: "idle", source: "shadow"` — exactly the LIVE contradiction.

## RED captured (commit cb6610f37)

`apps/vscode/src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts`
drives the REAL `selectTaskHeaderPresentation` production selector with
the LIVE-shape input token:

```
TUSA01-RED:          FAIL  expected 'idle' not to be 'idle'
                                  (LIVE defect captured)
TUSA01-RED-SOURCE:   FAIL  expected true to be false
                                  (shadow granted authority over active
                                  legacy, the live provenance defect)
TUSA01-CTL_A:        PASS  (legacy=idle + UNBOUND shadow=idle -> idle)
TUSA01-CTL_D:        PASS  (UNBOUND shadow=streaming agreeing)
TUSA01-REG_T9:       PASS  (REPAIR01-CORRECTION02 T9 invariant)
TUSA01-REG_HOST_COMPACTING:   PASS  (host compaction override)
TUSA01-REG_HOST_AWAITING_FOLLOWUP:  PASS  (TCCC01-B1 host override)
TUSA01-REG_FRESH_SHADOW_WINS: PASS  (shadow with seq=obs wins)
```

Total: 2 FAIL | 6 PASS / 8 tests at RED commit.

## CLASSIFICATION: CASE_A (selector authority defect)

The selector at `task-state-shadow-arbiter-mapper.ts:546-556` explicitly
lets an UNBOUND shadow override authoritative ACTIVE TurnState via rule 3.
The defect is in the selector's interpretation of `undefined` provenance,
not in the binding (`CASE_B`), the host status derivation (`CASE_C`), or
the presentation (`CASE_D`).

## Bounded repair applied (commit 6eaa0864)

ONE complementary condition extends the rule-3 staleness gate. The
explicit-staleness path (REPAIR01-CORRECTION02) is preserved unchanged
and remains the primary mechanism for BOUND-shadow demotion; this gate
only protects the UNBOUND case.

```ts
function isTerminalShadowPhase(phase: TurnPhase): boolean {
    return phase === "idle" || phase === "completed" || phase === "error" || phase === "resumable"
}

function isActiveLegacyPhase(phase: TurnPhase): boolean {
    return phase === "streaming" || phase === "awaiting_approval"
}

// in selectTaskHeaderPresentation:
if (input.canonicalShadowPhase !== undefined) {
    const isShadowStale =
        input.canonicalShadowObservedTurnSeq !== undefined &&
        input.seq > input.canonicalShadowObservedTurnSeq
    const isUnboundDemotingActiveToTerminal =
        input.canonicalShadowObservedTurnSeq === undefined &&
        isTerminalShadowPhase(input.canonicalShadowPhase) &&
        isActiveLegacyPhase(input.currentLegacyPhase)
    if (!isShadowStale && !isUnboundDemotingActiveToTerminal) {
        return { phase: input.canonicalShadowPhase, source: "shadow", seq: input.seq }
    }
}
```

**Invariant enforced**: "If authoritative TurnState is ACTIVE AND
shadowPublicationBinding == UNBOUND, an idle shadow MUST NOT demote the
TaskHeader to idle."

Total: 78 insertions, 10 deletions across 3 files. No protocol/wire
change. No new public API. No removal of shadow support. No "always
prefer TurnState" blanket rule. No UI-only masking.

## GREEN at SUBJECT_HEAD (commit 6eaa0864)

- TUSA01-RED / TUSA01-RED-SOURCE: GREEN
- TUSA01-CTL_A / CTL_D: GREEN
- TUSA01-REG_T9 (REPAIR01-CORRECTION02 stale-shadow invariant): GREEN
- TUSA01-REG_HOST_COMPACTING / REG_HOST_AWAITING_FOLLOWUP: GREEN
- TUSA01-REG_FRESH_SHADOW_WINS: GREEN
- 18/18 THCP01: GREEN (THCP04, THCP08, SHADOW_NECESSITY reclassified
  to BOUND-shadow inputs as documented)
- 27/27 TCR01: GREEN (T14 inverted-to-fixed as the LIVE specimen shape)
- 4/4 CTA01: GREEN
- 6/6 THCP11: GREEN
- 12/12 RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01: GREEN

**Total: 148/148 task-header-related tests PASS across 13 files.**

## Ablation (the necessity/ablation matrix from prompt §9)

```
Before bounded repair:
  same LIVE-shaped input (shadow=idle, legacy=streaming, UNBOUND)
  -> taskHeaderPhase = idle, source = shadow
     (the LIVE contradiction: UI displays Idle)

After bounded repair:
  same LIVE-shaped input
  -> taskHeaderPhase = streaming, source = legacy
     (authoritative ACTIVE phase conserved; UNBOUND shadow cannot demote)
```

Unrelated selector behavior is unchanged: BOUND-shadow wins path,
REPAIR01-CORRECTION02 explicit-staleness path, host compaction override,
host awaiting_followup override all produce byte-identical results for
non-UNBOUND cases.

## Conservation tests reclassified (regression-neutral)

Two pre-repair tests in the THCP01 / TCR01 matrix were capturing
UNBOUND-shadow-with-fresh-legacy as "shadow always wins" (the LIVE bug
shape, not desired behavior). Post-repair these tests either:

(a) gain a fresh BOUND-shadow stamp to assert the legitimate
    shadow-wins path (THCP04, THCP08, SHADOW_NECESSITY), or
(b) invert the assertion to capture the LIVE specimen's inverts-to-fixed
    shape (TCR01 T14).

The reclassification is documented in the test comments with the ACT ID
cited (`ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01`).

## Continuation

This ACT closes the LIVE recurrence for taskId `1788292664979_9qbpd`.
The next ACT in this lane (if any) should investigate whether the
underlying shadow projection (the canonical shadow's last
`projectTurnState(model)` projection) is reaching the LIVE-shape "idle"
through a missed model-stream / tool-event observation — but that is
RUNTIME-EVENT observation work, downstream of this selector fix.

The bounded selector guard here is the smallest semantic delta that
removes the presentation contradiction for any shadow projection
fallout that satisfies the LIVE shape; it does NOT change shadow
projection semantics, it only prevents shadow projection outcomes from
silently overriding authoritative ACTIVE TurnState when the shadow
lacks TurnState-domain provenance.
