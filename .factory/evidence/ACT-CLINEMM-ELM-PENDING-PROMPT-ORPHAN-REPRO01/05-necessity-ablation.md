# 05 — Necessity / Ablation

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Labels: `REAL_PRODUCTION_SEAM` (all arms), `REAL` (identities)

---

## C5.0 Precondition

C3 established a real failure (RED reproduced: `hold` / `pending_prompt`
against the unmodified production source). The counterfactual below is
therefore licensed.

## C5.1 The counterfactual input — source-backed, not synthetic

| Field | Value | Provenance |
|---|---|---|
| `promptId` (P1) | `pending_1794841243556_-tSbr` | `REAL` — recorded at seq 46/47/48 of the exported bundle |
| `promptId` (P2) | `pending_1794841410962_5gjid` | `REAL` — recorded at seq 54/56/57 of the exported bundle |
| `runId` | `run_rCw8nsup` | `REAL` — recorded at seq 3 (`run_turn_started`) and on all five `agent_turn_done` records |
| `sessionId` | `1794840293250_5ugld` | `REAL` |
| `stage` | `continuation_started` | the production stage name |
| injection point | immediately after seq 48 (P1) / seq 57 (P2) | the exact position the production join fires |

**No identity is invented. No prompt consumption is forced. No authorization is
forced.** The transition travels through the REAL `adaptRecord` and the REAL
Elm kernel:

```json
OPPOR01-COUNTERFACTUAL-REPORT {
  "adapterStatus": "DIRECT",
  "adapterReason": "mapped to continuation_started",
  "elmMsg": {
    "tag": "continuation_started",
    "promptId": "pending_1794841243556_-tSbr",
    "runId": "run_rCw8nsup"
  },
  "finalKind": "authorize",
  "finalHoldReasons": []
}
```

## C5.2 A1 — baseline (no modification)

| Metric | Value |
|---|---|
| Remaining prompt states | P1 = `scheduled`, P2 = `scheduled` |
| Elm hold reasons | `["pending_prompt", "scheduled_continuation"]` |
| Completion decision | **`hold`** / `pending_prompt` |

## C5.3 A2 — restore the missing correlation

| Metric | Value |
|---|---|
| Remaining prompt states | P1 = `consumed`, P2 = `consumed` |
| Elm hold reasons | `[]` |
| Completion decision | **`authorize`** |

The Elm transition actually performed:

```
continuation_started(P1, run_rCw8nsup) -> P1 = PromptRunning run_rCw8nsup
continuation_started(P2, run_rCw8nsup) -> P2 = PromptRunning run_rCw8nsup
agent_turn_done(run_rCw8nsup)           -> both -> PromptConsumed
                                          (via Authority.consumePromptForRun)
```

**Comparison with baseline: `hold / pending_prompt` -> `authorize`.**

## C5.4 A3 — necessity test (remove it again)

`OPPOR01-NECESSITY` performs four replays, each re-arming the real kernel:

| Arm | Input | Result |
|---|---|---|
| A3-1 baseline | no correlation | `hold`, holds include `pending_prompt` |
| A3-2 with correlation | both transitions | `authorize` |
| A3-3 **removed again** | no correlation (identical to A3-1) | **`hold`, holds include `pending_prompt`** |
| A3-4 half-removed | only P1's correlation | **`hold`, holds include `pending_prompt`** |

A3-3 is the necessity statement: **removing the transition restores the
failure exactly.** A3-4 shows the failure is not attributable to a single
prompt — BOTH orphaned prompts must be correlated, because each one
independently holds `PendingPrompt`.

## C5.5 A4 — adversarial conservation

`OPPOR01-ADVERSARIAL` proves the counterfactual is NOT a blanket "authorize"
hack. Each guard drives the REAL adapter + REAL Elm kernel.

| Guard | Scenario | Expected | Observed |
|---|---|---|---|
| A4-0 | control: both correlations, nothing else outstanding | `authorize` | `authorize` (guards are non-vacuous) |
| A4-1 | a genuinely QUEUED prompt (enqueued, never dequeued/scheduled) | hold | `hold`, holds include `pending_prompt` |
| A4-2 | a SCHEDULED continuation not yet started | hold | `hold`, holds include `scheduled_continuation` |
| A4-3 | a STILL-RUNNING continuation (`PromptRunning`, no matching `agent_turn_done`) | hold | `hold`, holds include `scheduled_continuation` |
| A4-4 | a FOREIGN prompt id | hold | `hold`, holds include `pending_prompt` |
| A4-5 | a STALE / FOREIGN run id | hold | `hold`, holds include `pending_prompt` |
| A4-6 | an UNRESOLVED background-job obligation (real registered owned terminal, delivered through the REAL adapter with full identity) | hold | `hold`, holds include `unconsumed_terminal_observation` |
| A4-7 | a terminal observation that has NOT been consumed | hold | `hold`, holds include `unconsumed_terminal_observation` |

**The Elm model's fail-closed behaviour is intact.** No guard authorizes
completion for outstanding work. The counterfactual removes the hold ONLY for
the specific case where the prompt was genuinely correlated to a run that then
completed.

## C5.6 Ablation outcome

| `CAUSAL_DISCRIMINATOR_PASS` requirement | Status |
|---|---|
| 1. Real failure reproduced | **YES** — `OPPOR01-REPLAY`: `hold` / `pending_prompt` |
| 2. Valid source-backed causal input identified | **YES** — the two `continuation_started(promptId, runId)` transitions, all identities `REAL` |
| 3. Restoring that input removes the failure | **YES** — `OPPOR01-CF`: `authorize`, zero hold reasons |
| 4. Removing it restores the failure | **YES** — `OPPOR01-NECESSITY` A3-3 (and A3-4) |
| 5. Adversarial guards remain intact | **YES** — `OPPOR01-ADVERSARIAL`, 8/8 arms |

### **CAUSAL_DISCRIMINATOR_PASS**

**Not `HYPOTHESIS_ONLY`.** The counterfactual does **not** rely on synthetic
identities: every `promptId` and the `runId` come verbatim from the exported
incident records. It is therefore admissible to qualify a production repair.

### What this does NOT establish

* It does **not** establish *why* the canonical `run-started` event failed to
  reach the subscription for the continuation turns (see `04-causal-discriminator.md`
  §C4.3). That is the residual unknown the successor ACT must resolve.
* It does **not** establish that the repair belongs in the subscription-attach
  path rather than in the `run-started` emission path. Both are open.

## C5.7 Constraints observed

| Constraint | Status |
|---|---|
| Do not modify the Elm completion policy to suppress `PendingPrompt` | **NOT DONE** — `Authority.elm` is byte-identical to the installed incident source |
| Do not force completion based on TypeScript counters | **NOT DONE** — the replay never reads a TypeScript counter; the decision comes only from the real Elm kernel |
| Do not assign a fabricated run ID to a continuation | **NOT DONE** — the runId is `run_rCw8nsup`, verbatim from the record |
| Do not weaken C9/C10, BCB or session ownership | **NOT DONE** — A4-1..A4-7 prove the guards still hold |
| Do not add state-mutating diagnostics inside React functional updaters | **NOT DONE** — no React code touched |
| Do not create a second completion authority | **NOT DONE** — the replay uses the single production `completion-authority-elm-authority-runtime` |
| Do not implement the leading hypothesis | **NOT DONE** — no production change was made |
| Production change budget | **ZERO**
