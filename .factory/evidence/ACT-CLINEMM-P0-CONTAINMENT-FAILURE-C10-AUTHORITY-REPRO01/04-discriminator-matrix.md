# 04 — Observation-versus-containment discriminator matrix

The three conditions the ACT requires to be distinguished, and what each
one actually proves.

## 4.1 The three conditions, kept separate

| Condition | Observable at | What it PROVES | What it does NOT prove |
|---|---|---|---|
| **1. Manager retention** | `CommandJobManager.status()` -> `source: "active" \| "terminal" \| "miss"`; `activeCount`; `terminalCount` | Whether the job is still resolvable in a registry | NOTHING about the process group. The manager deletes from the active map on BOTH the clean and the containment-failure path (`command-job-manager.ts:2636`). |
| **2. Observation consumption** | `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner` / `unconsumedOwnedTerminalJobIdsForOwner`; the `command_status` response | Whether the owning agent received the terminal fact | NOTHING about the process group. The drain (`consumeNonNotifyTerminalObservation`) is an owner-triple-validated map delete with no containment judgement. |
| **3. Containment safety** | `CommandJobSnapshot.containmentFailed` (`pgid_unset` / `substrate_alive` / `substrate_eperm` / `substrate_unknown`); the `command_job_primary_group_cleanup` postcondition; the `command_job_containment_failed` event; the `backgroundCommandJobStates` projection | Whether the primary owned PGID was PROVEN reaped (`postcondition === "gone"`) | It does not prove descendants outside the primary PGID are gone (the PCPC contract explicitly scopes this to the OWNED primary PGID). |

## 4.2 The matrix

`gone` = the process group was PROVEN reaped. `alive`/`eperm`/`unknown`/
`pgid_unset` = NOT proven (fail-closed).

| Manager retention | Observation consumed | Containment | C10 authorized? | Which fact decided it | Source |
|---|---|---|---|---|---|
| retained (active) | no | any | **NO** | `ownerStillRunningForC10` (active-map cardinality) | coordinator L3496-3503 |
| evicted / miss | no | `containment_failed` | **NO** | `heldObligationForC10` (> 0) | coordinator L3503-3517 |
| evicted / miss | no | `gone` | **NO** | `heldObligationForC10` (> 0) | coordinator L3503-3517 |
| evicted / miss | **YES** | **`containment_failed`** | **YES** | **NONE — no conjunct fires** | **THE GAP** |
| evicted / miss | **YES** | **`gone`** | **YES** | none needed (all obligations resolved) | intended path |
| retained (active) | n/a | any | **NO** | `ownerStillRunningForC10` | coordinator L3496-3503 |

## 4.3 The exact causal claim

> **Does successful C10 authorization depend on proven containment, or only
> on disappearance/consumption of an observation?**
>
> **Only on disappearance/consumption of an observation.**
>
> Proven by RED-06 rows 1-4 (the ablation matrix): the C10 outcome is a
> function of the BCB observation count alone. It is invariant with
> respect to the containment postcondition.

This is NOT a chronological association — it is an ablation: rows 2 and 4
differ ONLY in the containment truth and produce IDENTICAL C10 outcomes;
rows 1 and 3 differ ONLY in the containment truth and produce IDENTICAL
(held) outcomes.

## 4.4 The structural asymmetry, stated precisely

| Path | Consults the containment classification? | Fails closed on an unresolved containment failure? |
|---|---|---|
| **Q5 deferred handoff** (`reevaluateDeferredContinuation`, L1087-1132) | **YES** | **YES** — commits `resumable` and does NOT release |
| **C10 barrier** (`handleSessionEvent` barrier block, L3494-3525) | **NO** | **NO** |
| **BCB re-evaluation** (`reevaluateDeferredCompletionBarrier`, L1736-1805) | **NO** | **NO** |
| **Elm completion authority** (`Authority.elm` L520-597) | **NO** — there is no containment axis in the job lifecycle vocabulary | **NO** |

The data IS already wired: `SdkController` threads
`getBackgroundCommandJobStates` (L2664) and `getBackgroundCommandJobOwners`
(L2683) into the coordinator, and the Q5 path uses them. The C10 path
simply never asks.

## 4.5 Two additional structural facts that constrain any repair

1. **The receipt channel is `gone`-gated.** `recordTerminalReceiptFromLifecycle`
   ignores anything that is not `command_job_terminal_committed`
   (`background-notify-coordinator.ts:3548`), and the manager emits that
   event only on the `gone` path (`command-job-manager.ts:2677`). So a
   containment-failed job can NEVER leave a compact receipt. The
   `evicted_receipt` path therefore cannot be the mechanism by which a
   containment failure "becomes" a clean observation.

2. **C1 (`terminal_committed`) is `gone`-gated.** The cardinality
   authority's `terminal_committed` record is emitted inside the
   `if (invariantProven)` block, so the Elm kernel never receives a
   `terminal_committed` fact for a containment-failed job. The Elm kernel
   sees such a job only as `JobTerminal ObservationPending` (via the
   non-notify observation registration), and after consumption as
   `JobTerminal ObservationConsumed` — i.e. indistinguishable from a clean
   terminal.
