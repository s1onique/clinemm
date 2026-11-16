# 07 — Decision

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Incident session: `1794840293250_5ugld`

---

## 07.1 The question asked

> Prove whether a missing prompt->run association is the necessary cause of the
> Elm `pending_prompt` hold.

## 07.2 The answer

**PROVEN. The missing prompt->run association is the necessary cause.**

The Elm `pending_prompt` hold on session `1794840293250_5ugld` is caused by the
absence of the `continuation_started(promptId, runId)` transition — the only
Elm transition that can move a continuation prompt out of `PromptScheduled`
and into `PromptRunning`. Without it:

* the prompts `pending_1794841243556_-tSbr` (P1) and `pending_1794841410962_5gjid`
  (P2) remain `PromptScheduled` forever,
* `AgentTurnDone` cannot consume them (it consumes only `PromptRunning r`),
* `computeHoldReasons` reports `PendingPrompt`, and the completion is withheld
  indefinitely.

The prompt->run association is not merely "not delivered to Elm" — it is
**never constructed**, because the `runId` half of the producer's join (the
canonical `run-started` runtime event) did not reach
`subscribeCanonicalRuntimeEventsToShadow` for the continuation turns.

## 07.3 Closure classification

# `PASS_CAUSAL_PROOF`

**Successor:** `ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01`

The successor MUST:

1. Begin from the reproduced RED in
   `apps/vscode/src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts`
   (test `OPPOR01-REPLAY`), which asserts `hold` + `pending_prompt` against the
   unmodified production source and will FAIL once the defect is repaired.
2. Implement **only** the causally necessary correction — the prompt->run
   correlation at the boundary identified in
   `04-causal-discriminator.md` §C4.2.
3. Establish, at the subscription-attach boundary, **why** the canonical
   `run-started` event did not reach the subscription for the continuation
   turns. This is the one residual unknown (see §07.5).

## 07.4 Why this is NOT `CAPTURE_INSUFFICIENT`

The bundle is globally truncated (`evidenceLoss: true`,
`capsuleDroppedRecords: 4937`), but:

* The incident session's CCARD sequence is **contiguous seq 1..64 with no
  gaps** — the recorder did not drop a record inside the causal window.
* The RED reproduces through the REAL adapter and the REAL compiled Elm
  kernel, from the retained records alone.
* The causal claim does not rest on the export alone: it is independently
  corroborated by the **pre-existing, passing** PPLC-08 NECESSITY ablation
  (`pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts`),
  which drives the REAL `LocalRuntimeHost` + REAL canonical subscription +
  REAL Elm kernel and proves that withholding the `continuation_started`
  producer returns the `pending_prompt` hold.
* And by the new `OPPOR01-H1-H7` producer-reachability proof, which shows the
  producer is healthy and its input was missing.

## 07.5 What remains UNKNOWN (explicitly)

> The exported bundle establishes that the canonical subscription did not
> observe a `run-started` event for the continuation turns. It does **not**
> establish **WHY**. The candidate boundaries are:
>
> 1. the canonical subscription was never (re-)attached for the session that
>    ran the continuation (the `LOCAL_RUNTIME_SUBSCRIPTION_MODEL = POINT_IN_TIME`
>    re-attach invariant at `canonical-event-subscription.ts:20-39` /
>    `SdkController.attachCanonicalRuntimeEventSubscription` /
>    `SdkController.ts:2524, 4496, 4718`);
> 2. the subscription was attached but the `run-started` event was never
>    emitted for those turns;
> 3. the subscription was attached to a different session id.
>
> The bundle records no subscription-lifecycle event, so it cannot
> discriminate among these. The successor ACT must establish this at the
> subscription-attach boundary. **This ACT deliberately does not add
> diagnostic instrumentation for it** (per the ACT's CAPTURE_INSUFFICIENT
> guidance, and because the causal repair can be scoped without it).

## 07.6 Evidence-quality labels used

| Label | Where |
|---|---|
| `REAL` | the exported incident records; the repository facts; the source-parity hashes |
| `LIVE` | the eight recorded production completion-authority consultations (`hold` / `pending_prompt`) |
| `REAL_PRODUCTION_SEAM` | the real `adaptRecord`, the real `enqueueElmAuthorityRecord` / `flushElmAuthorityForSession`, the real compiled Elm kernel, the real `createProductionPendingPromptCapture`, the real `subscribeCanonicalRuntimeEventsToShadow` |
| `SYNTHETIC_REAL` | the A4 adversarial guard records (constructed fixtures with full identity, exercising real production functions) |
| `SYNTHETIC` | the two counterfactual `continuation_started` records — but their IDENTITIES are `REAL` (verbatim from the bundle); only their OCCURRENCE is counterfactual |
| `INFERRED` | §C4.3's statement that a point-in-time subscription-scope mismatch explains the capture asymmetry |
| `UNAVAILABLE_FROM_TRACE` | the reason the canonical `run-started` did not reach the subscription; the subscription-lifecycle state at the incident boundary |
| `NOT_EXECUTED` | the repository-wide test sweep (deliberately NOT run per the ACT) |

**A replay using genuine production components is not automatically a live
reproduction.** This ACT is a **source-bound replay through real production
seams** (`REAL` records + `REAL_PRODUCTION_SEAM` execution), NOT a live
reproduction of the running incident.

## 07.7 Source identity binding

```
INSTALLED_INCIDENT_SOURCE_HEAD = 1d9a37bcd408c185ef356303e1e5ac6237a15307
REPLAY_SUBJECT_HEAD            = e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1
PARITY                         = byte-identical across all 11 causal-path files
```

The replay is simultaneously a **historical reproduction** of the installed
incident source and a **current-head reproduction**. No distinction is needed.

## 07.8 What was NOT done (per the ACT's prohibitions)

| Prohibition | Status |
|---|---|
| Implement the leading hypothesis | **NOT DONE** — zero production changes |
| Modify the Elm completion policy to suppress `PendingPrompt` | **NOT DONE** |
| Force completion based on TypeScript counters | **NOT DONE** |
| Assign a fabricated run ID to a continuation | **NOT DONE** — `run_rCw8nsup` is verbatim from the record |
| Weaken C9/C10, BCB or session ownership | **NOT DONE** — A4-1..A4-7 prove the guards still hold |
| Add state-mutating diagnostics inside React functional updaters | **NOT DONE** — no React code touched |
| Create a second completion authority | **NOT DONE** |
| Claim the installed extension was fixed or qualified | **NOT DONE** — no production repair is authorized or performed |
| Modify the Elm completion policy | **NOT DONE** — `Authority.elm` is byte-identical to the installed incident source |

## 07.9 Repository discipline

* Original exported incident bundle: **preserved OUTSIDE** the committed
  repository, at
  `/Volumes/UserData/Users/chistyakov/Downloads/completion-incident-2026-11-16T15-52-00-750Z/`,
  with its SHA-256 identities recorded in `02-source-bound-replay.md`.
* Only the sanitized, source-bound minimum (three session-filtered fixtures)
  is committed.
* Protected stash `stash@{0}` preserved and untouched.
* All 6 worktrees preserved.
* No push, no PR, no release, no installation, no production repair.
* `.factory/epic-board.md` updated **once**.
