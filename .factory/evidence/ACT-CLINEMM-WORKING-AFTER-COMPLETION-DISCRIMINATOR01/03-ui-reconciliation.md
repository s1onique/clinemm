# 03 — Host-to-UI phase reconciliation

Trace: `TurnStateTracker → state publication → webview reducer → Elm task-phase projection → TaskHeader → action buttons`.

All host-side facts below come from the **runtime-diag publication trace**
`~/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/runtime-diag/clinemm-v2-900dc427-mwjddpq6.jsonl`
(SHA-256 `7b67b4768237d68b30b8b5dee3b235c9f7fa79c7a7ab8155b934ca9cea17f165`), 1178
`activity.publication.v1` records, **540** of them for the incident task
`1794840293250_5ugld`.

---

## C3.1 — The publication trace for the incident task (complete phase history)

Every distinct phase transition published for `taskId = 1794840293250_5ugld`:

| `publicationId` | epoch | `turnPhase` | `taskHeaderPhase` | `taskHeaderSource` | `hostStatus` | `modelStreaming` | `shadowPublicationBinding` |
|---|---|---|---|---|---|---|---|
| 13 | 2 | `idle` | `idle` | `legacy` | `idle` | false | `UNBOUND` |
| 16 | 2 | `streaming` | `streaming` | `legacy` | `idle` | false | `UNBOUND` |
| 23 | 2 | `streaming` | `streaming` | `shadow` | `running` | true | `UNBOUND` |
| 1599 | 2 | `awaiting_followup` | `awaiting_followup` | `host` | `aborted` | false | `UNBOUND` |
| 1607 | 3 | `streaming` | `streaming` | `legacy` | `idle` | false | `UNBOUND` |
| **1893** | 3 | `awaiting_followup` | `awaiting_followup` | `host` | `idle` | false | `UNBOUND` |
| **1898** | 4 | `streaming` | `streaming` | `legacy` | `idle` | false | `UNBOUND` |
| 1903…1957 (19 rows) | 4 | `streaming` | `streaming` | `legacy` | `idle` | false | `UNBOUND` |

**Three facts follow directly and are decisive:**

1. **There is NO `completed` publication for this task — anywhere in the trace.**
   A full scan of all 1178 publication records returns **zero** rows with
   `turnPhase == "completed"` for `taskId = 1794840293250_5ugld`.
2. **There is NO `resumable` publication for this task — or for ANY task in the entire trace.**
   A full scan of all 1178 rows returns **zero** rows with `turnPhase == "resumable"`.
   (The BCB hold DID write `resumable` into the tracker — proven by the incident store's
   `observedPhase: "resumable"` — but no publication carried it.)
3. **The LAST publication for the incident task is `publicationId 1957`, `turnPhase = streaming`.**
   All 19 rows of epoch 4 (1898…1957) are `streaming`.

**The webview's final received phase was therefore `streaming`.**

### Control: the publication machinery works

The very next session in the same trace publishes `completed` normally:

| `publicationId` | task | epoch | `turnPhase` | `taskHeaderPhase` | `hostStatus` |
|---|---|---|---|---|---|
| 1966–1973 | `1794841777469_y8m8j` | 6 | `idle` → `streaming` | `idle` → `streaming` | `idle` → `running` |
| **2998** | `1794841777469_y8m8j` | 6 | **`completed`** | **`completed`** | **`completed`** |

**⇒ The absence of a `completed` publication for the incident task is NOT a publication-pipeline
failure.** The identical pipeline published `completed` 41 publications later for the next
session. The incident's missing `completed` is a consequence of the missing **commit**, not of
a missing **publication**.

---

## C3.2 — The Elm task-phase projection and the rendered label

`apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:152–189`:

```ts
export function stateLabel(phase: TurnPhase | undefined): StateLabelProjection {
    switch (phase) {
        case "idle":             return { label: "Idle",      glyph: "○", live: false }
        case "streaming":        return { label: "Working",   glyph: "●", live: true  }   // ← 157
        case "awaiting_approval":return { label: "Approval",  glyph: "?", live: true  }
        case "awaiting_followup":return { label: "Your turn", glyph: "↳", live: true  }
        case "compacting":       return { label: "Compacting",glyph: "⌄", live: true  }
        case "completed":        return { label: "Complete",  glyph: "✓", live: false }
        case "error":            return { label: "Error",     glyph: "!", live: false }
        case "resumable":        return { label: "Paused",    glyph: "↻", live: false }   // ← 184
        default:                 return { label: "Unknown",   glyph: "?", live: false }
    }
}
```

**The observed header state maps EXACTLY to `streaming`:**
`"Working"` + `live: true` + the `●` glyph. `resumable` would have rendered **"Paused"** with
a `↻` glyph and `live: false`.

The `taskHeaderPresentationStateLabel` entry point (lines 226–234) reads the canonical
`taskHeaderPresentation` projection when present and falls back to `turnState.phase` only when
absent — so the label is a **pure projection of the committed phase**, never inferred from
chat prose.

---

## C3.3 — Action buttons

The button map is phase-keyed (`resumable → BUTTON_CONFIGS.resume_task`, per the PTWCR01C01
comment at `sdk-session-event-coordinator.ts:5107`). The incident header showed **`Cancel`
available** — the action set for a **non-terminal, live** phase. The PTWCR01C01 comment is
explicit that the false-"Working"/"Cancel" pair is the signature of a phase left at its last
**ACTIVE** value:

> *"The BCB hold path used to register the deferred-completion-barrier marker and publish NO
> phase, so the host phase stayed at its last ACTIVE value (`streaming`, written by
> `task-start-init-task`), so the webview rendered `Working` + `Cancel` for a runtime that was
> already `aborted` … the LIVE false-Working defect (session `1792958891945_k2wrd`, epoch 12)."*

**⇒ The incident reproduced the SAME `Working` + `Cancel` signature, but through a DIFFERENT
route.** In the historical PTWCR01 case the `resumable` write was **absent**; in this incident
the `resumable` write **was made** (the incident store proves it) and was then **superseded**
by the continuation-entry reseed, so the last committed phase was again `streaming`.

---

## C3.4 — The C3 chain, field by field

| Field | Value | Evidence |
|---|---|---|
| Controller committed phase | **`streaming`** | runtime-diag pubId 1957 (last for the task) |
| Phase sequence number | not exposed by `activity.publication.v1` | `LIVE_UNOBSERVABLE` |
| Last phase writer identity | `session-event-pending-prompt-submitted` (the epoch-4 reseed at line 4365) — inferred from the writer↔phase map in `turn-phase-contract.ts:383`; the per-write identity ring (`turn-state-writer-provenance.jsonl`) is **stale (Nov 3)** | `INFERRED` from the phase/writer ownership map |
| Task/session identity for the phase | `1794840293250_5ugld` (epoch 4) | runtime-diag `taskId` + `epoch` |
| Publication sequence / generation | `publicationId 1898…1957` | runtime-diag |
| Webview-received phase | **`streaming`** | runtime-diag `taskHeaderPhase = streaming` (the host-side projection of what the webview received) |
| Elm-projected phase | `streaming` | `taskHeaderSource = "legacy"` at pubId 1957 (the legacy `turnState.phase` fallback — the canonical shadow was `UNBOUND`) |
| UI-rendered label | **"Working"** | `stateLabel("streaming")` + the operator screenshot |
| UI action set | **Cancel** | the operator screenshot; `live: true` phase ⇒ active affordance |

**On the React updater-purity restriction (C3):** this ACT performed **no** React-side
instrumentation whatsoever. No diagnostic record write, ref mutation, counter, setter or
external capture callback was placed inside a functional updater — indeed, **no code was
changed at all**. The React-side evidence is the **pre-existing** production projection helper
(`stateLabel` / `taskHeaderPresentationStateLabel`), a **pure** function, exercised by the
executed `taskHeaderTelemetryHelpers.test.ts` (45 assertions, §C6).

**`LIVE_UNOBSERVABLE` items** (stated explicitly rather than reconstructed):
- the committed phase's `seq` (not in the publication record);
- the exact last-writer identity at pubId 1957 (the per-write provenance ring is stale);
- the webview DOM at 18:06 (the operator screenshot is the only UI evidence, and it is **not**
  atomic with the MCP reads);
- the Elm authority's internal model at 18:04:29 (the kernel state is not persisted).

---

## C3.5 — Comparison with the established historical investigations

| Prior investigation | Established invariant | Reused here | Contradicted? |
|---|---|---|---|
| **C9/C10** (`tpc01`, `c9c10cdap01`, `c9c10scr01`) | The C10 commit is authorized only when attempt-completion ∧ terminal-response ∧ no-error ∧ no BCB hold ∧ Elm authorizes; the authorized path commits `completed` with a strictly greater seq | Yes — the incident's conservation half is proven clear, the authority half is not | **No** |
| **BCB continuation/reconciliation** (`bcb01`, `bcb01-c{,2,3,4}`, `ccsa01`) | The BCB holds while an unconsumed owned terminal result exists, and releases exactly once when all conservation predicates clear | Yes — the incident's 7 `c10_reevaluated` records prove the conservation predicates all cleared | **No** |
| **PTWCR01C01** (BCB-hold → `resumable`) | The BCB-hold path publishes the truthful non-running phase `resumable` ("Paused"), never leaving the phase at `streaming` | Yes — and the incident store **confirms** the `resumable` write happened | **No** — the write happened; the *publication* of it did not |
| **B2PO01** (prompt-origin / stale-flag) | The "is this `resumable` a BCB hold?" fact must be read from the **committed writer identity**, not a coordinator-private flag | Yes — `committedPhaseIsBcbHold` at line 4698–4701 is the code that guards the straggler path | **No** |
| **PTWCR01** (the original repro) | The false-"Working"/"Cancel" signature has two distinct causes: (i) no phase published at all, (ii) a phase published that was later superseded | Yes — the incident is cause **(ii)** | **No** |
| **React updater purity** | No diagnostic side effect inside a functional updater | Yes — no React instrumentation was added by this ACT | **No** |

**None of the established invariants is contradicted by the incident evidence.** The incident is
a *new* configuration of an existing mechanism, not a violation of a proven one.

---

## C3.6 — UI reconciliation conclusion

**The webview did exactly what it was told.** It received `turnPhase = streaming` (publication
1957, epoch 4), projected it through the canonical `taskHeaderPresentation` selector
(`taskHeaderSource = "legacy"` — the shadow was `UNBOUND`), and rendered the label that
`stateLabel("streaming")` defines: **"Working"**.

**There is NO UI reconciliation defect (class D is excluded).** Class D requires an
authoritative terminal phase to have been **committed** and the matching UI to remain "Working"
after publication. Here the authoritative phase was **never committed** — the completion
authority withheld it at the Elm gate — so the UI was showing the *truthful* projection of the
*truthful* last committed phase.

**The one genuine UI-adjacent observation** is that the BCB-hold's `resumable` phase was
**never published** (zero `resumable` rows in the whole trace). During the 18:00:43 → 18:00:46
window the webview therefore rendered `streaming` while the host's committed phase was
`resumable`. That window is 2.5 seconds and it coincides with the continuation-entry reseed, so
it is **not** the observed 18:06 state and **not** the defect under investigation. It is
recorded here for completeness, with the classification `INFERRED` (the exact interleaving of
the phase write and the publication inside the same event handler is not observable from the
publication record, which samples the phase at publication time).
