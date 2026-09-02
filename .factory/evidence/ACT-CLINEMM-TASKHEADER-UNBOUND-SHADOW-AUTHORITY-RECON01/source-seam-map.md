# Source Seam Map -- ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01

## Q1. `hostStatus` producer

`apps/vscode/src/sdk/activity-publication-v1.ts:152`:

```
const runtimeStatus = shadow?.status
```

Read from `shadow: ArbiterSnapshot`. The builder emits `hostStatus: runtimeStatus ?? null`
on the JSONL record (line 179). `ArbiterSnapshot.status` is the shadow's `status` field,
distinct from the snapshot-derived `taskHeaderPresentation.phase`.

## Q2. `shadowPublicationBinding` producer

`apps/vscode/src/sdk/activity-publication-v1.ts:148`:

```
const shadowPublicationBinding: ShadowPublicationBinding = shadow === undefined ? "MISSING" : "UNBOUND"
```

Literal classification. UNBOUND means: `shadow !== undefined` (a shadow was present at the
seam), but `ArbiterSnapshot` carries no `stateVersion` / `seq` so cross-binding to
`snapshot.stateVersion` CANNOT be proven. The comment block at lines 38-52 explicitly
forbids callers from treating shadow-derived fields as proven same-generation.

## Q3. `taskHeaderSource` producer

`apps/vscode/src/sdk/activity-publication-v1.ts:161` -- reads from
`snapshot.taskHeaderPresentation?.source`, which is produced by
`selectTaskHeaderPresentation` at
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:505`.

The selector returns one of:

- `"host"` -- rule 1 (`compacting` host override) or rule 2 (`awaiting_followup` host override)
- `"shadow"` -- rule 3 (canonical shadow branch)
- `"legacy"` -- rule 4 (absence fallback)

## Q4. `taskHeaderPhase` producer

Same as Q3: `snapshot.taskHeaderPresentation?.phase` is the selector's
`phase: TurnPhase` field. Read at `activity-publication-v1.ts:158`.

## Q5. TaskHeader render consumer

Webview consumes `taskHeaderPresentation` via:
- `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:198` -- `taskHeaderStateLabel(taskHeaderPresentation, turnState)`
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` -- applies the label

The state label is a pure `phase -> {label, glyph, live}` function. No
inference, no last-ask / last-say derivation.

## Q6. UNBOUND mechanically means

UNBOUND means: a shadow was sampled at the publication seam
(`shadow !== undefined` at `activity-publication-v1.ts:148`), but the
shadow's type (`ArbiterSnapshot`) does NOT carry `stateVersion` or any
seq field. Therefore the shadow's `phase` value is NOT proven to be the
same publication as the snapshot's `stateVersion`.

The producer at `SdkController.ts:4074` passes `canonicalShadowPhase:
this.getLocalShadowPhase()` -- a `TurnPhase | undefined` -- and
`canonicalShadowObservedTurnSeq: this.getLocalShadowTurnSeqForPhase(...)`,
which can ALSO be `undefined` if the wiring has no observed TurnSeq stamp
for the phase.

**Critically: the selector does NOT distinguish UNBOUND shadow from
fresh shadow.** It treats `canonicalShadowObservedTurnSeq === undefined`
as "no observation yet" (the noop-wiring / Hub/Remote absence case) and
lets the shadow win. But the LIVE bug demonstrates that `undefined` can
also mean "shadow was sampled but has no generation identity".

## Q7. Under what conditions is shadow intentionally preferred?

Selector rule 3 (`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:546-556`):

```
if (input.canonicalShadowPhase !== undefined) {
    const isShadowStale =
        input.canonicalShadowObservedTurnSeq !== undefined &&
        input.seq > input.canonicalShadowObservedTurnSeq
    if (!isShadowStale) {
        return { phase: input.canonicalShadowPhase, source: "shadow", seq: input.seq }
    }
}
```

Shadow wins when:
1. `canonicalShadowPhase !== undefined`
2. AND (canonicalShadowObservedTurnSeq is undefined) OR (seq <= canonicalShadowObservedTurnSeq)

The first clause of the staleness gate (undefined stamp) is treated as
"no observation yet for this phase" and is not subject to the staleness
check. This is the structural defect.

## Q8. Is the shadow source independently newer, correlated, or authoritative when UNBOUND?

UNBOUND by definition means NOT correlated -- the shadow carries no
`stateVersion` / `seq` field. The shadow's `phase` value may be older,
newer, or contemporaneous with the snapshot's `stateVersion`, but we
cannot prove any of these without independent corroboration.

## Q9. Is `idle` a literal shadow value, fallback, or derived?

`idle` is a literal shadow value -- `TurnPhase = "idle"` is one of the 8
phases in the legacy vocabulary (`@shared/ExtensionMessage.ts`). It
comes from `TaskState.projectTurnState(model)` at
`sdk/packages/agents/src/runtime/state/task-state/selectors.ts:47`,
which yields "idle" when no modelStreaming and no active tooling.

For the LIVE specimen, the shadow's `projectTurnState(model)` had
projected "idle" (model between turns with no modelStreaming and no
tooling) at some prior moment. The shadow's `getLastObservedShadowPhase()`
then returns that "idle" indefinitely because nothing updates it during
the LIVE active turn (the modelStream/tooling observation that would
advance it to "streaming" is missed or racing).

## Q10. Can the LIVE tuple be reproduced via real production selector?

YES -- RED captured at HEAD (`red-green-log.txt`).

```
TUSA01-RED: LIVE-shaped UNBOUND shadow idle MUST NOT demote authoritative legacy streaming
  AssertionError: expected 'idle' not to be 'idle'

TUSA01-RED-SOURCE: LIVE-shaped UNBOUND shadow MUST NOT yield source=shadow against authoritative active TurnState
  AssertionError: expected true to be false
```

## Source-seam Summary

```
+-----------------------------------------------+
| snapshot.taskHeaderPresentation              |
| (built at SdkController.ts:4104)             |
|                                                |
| selectTaskHeaderPresentation(input)           |
|   apps/vscode/src/sdk/task-state-shadow-       |
|   arbiter-mapper.ts:505                       |
|                                                |
|   input.canonicalShadowPhase = "idle"  [UNBOUND]
|   input.currentLegacyPhase   = "streaming" [active]
|   input.seq                  = 27545     [TurnStateTracker]
|   input.canonicalShadowObservedTurnSeq = undefined
|                                                |
|   RULE 1 (compacting)            -- skip       |
|   RULE 2 (awaiting_followup)     -- skip       |
|   RULE 3 (canonicalShadowPhase !== undefined &&
|            !stale)                              |
|     canonicalShadowPhase = "idle"              |
|     isShadowStale = (undefined !== undefined    |
|                       && ...)                  |
|              = false                            |
|     --> shadow wins                             |
|     return { phase: "idle", source: "shadow",    |
|              seq: 27545 }                       |
+-----------------------------------------------+
                |
                v
+-----------------------------------------------+
| snapshot.taskHeaderPresentation:             |
|   phase  = "idle"            (LIVE BUG)       |
|   source = "shadow"                           |
+-----------------------------------------------+
                |
                v
+-----------------------------------------------+
| activity.publication.v1 record:              |
|   taskHeaderPhase          = "idle"           |
|   taskHeaderSource         = "shadow"         |
|   turnPhase                = "streaming"      |
|   shadowPublicationBinding = "UNBOUND"        |
|   hostStatus               = "idle"           |
+-----------------------------------------------+
                |
                v
+-----------------------------------------------+
| TaskHeader.tsx (webview)                      |
|   taskHeaderStateLabel(taskHeaderPresentation, |
|                         turnState)             |
|   phase="idle" --> label "Idle"  (LIVE BUG)    |
+-----------------------------------------------+
```
