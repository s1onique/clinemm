# Cline-- Global Epic Board

CANONICAL_AS_OF: 2026-08-19
SOURCE_HEAD: 51f2f6a9c48bd880186928b18a2a9e3817613d43
BOARD_WAVE: 1

---

## Board contract

This file is the canonical project coordination board for Cline--. It is **not** primary evidence: rows point to commits, ACTs, tests, or artifacts where load-bearing claims live. Stale rows are P2/non-blocking and never invalidate executable tests, exact artifacts, live evidence, source truth, or Git identity. Only **P0** halts. **P1** gets one bounded fix cycle. **P2** is batched at cleanup. Prefer executable evidence over documentary completeness. Update this board incrementally at meaningful ACT boundaries. If maintenance slows learning without protecting correctness, simplify it.

---

## Repository topology

```
REPOSITORY TOPOLOGY

  canonical repository:    /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
  canonical branch:        main
  development topology:    one Git worktree
  linked worktrees:        forbidden by default
  exception:               explicit user authorization only
  temporary breakage on local main:  acceptable
  unexpected tracked dirt: HALT
  protected evidence:      preserve explicitly named stashes / artifacts
  historical architecture branch:  act/elm-architecture01-e0-e4
    status:                MERGED, retained temporarily
    cleanup priority:      P2 (do NOT switch to it; do NOT delete in this ACT)
```

Rationale: linked worktrees caused agent path/branch confusion in earlier work; the complexity cost exceeded the isolation benefit. Git supports linked worktrees, but they are optional around one main worktree — this repo deliberately chooses the simpler single-worktree policy.

---

## Closed foundation (Wave 1 only)

### 1. Elm/state architecture groundwork

- status: CLOSED
- note: canonical state-machine / runtime groundwork exists
- exact full history: DEFERRED_TO_BOARD_WAVE02

### 2. E7 Local advisory activation

- status: CLOSED
- note: Local path has canonical advisory activation foundation

### 3. Thinking canonical-state authority

- status: CLOSED
- note: canonical authority exists; static presentation residue remains separately OPEN (see §task state)

### 4. React updater purity repair

- status: CLOSED
- invariant: no diagnostic/external side effects inside functional state updaters

### 5. W1/W2 epoch-domain repair

- status: CLOSED_LIVE
- qualified source: `5637d965dcaf95bd82708b21ecf233d9672cde59`
- live verdict: PASS_LIVE_EPOCH_REPAIR
- proven:
  - W1 `stateVersion > 0`
  - W1 `epoch` present
  - shared W1/W2 sequence authority
  - streaming raw == committed
  - awaiting-followup raw == committed

### 6. Incident-diagnostic retirement

- ACT: `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01`
- status: CLOSED
- final commit: `51f2f6a9c48bd880186928b18a2a9e3817613d43`
- result:
  - LCD01 retired
  - PTAD retained (default-off, opt-in via workspace toggle)
  - production correctness invariants preserved

---

## Immediate critical path

1. **COMPACTION-STATE-AUTHORITY01** — OPEN / LIVE_UI / HIGH
2. **STATIC-THINKING-PRESENTATION-PERSISTENCE01** — OPEN / HIGH
3. **TASKHEADER-OWNER-AWARE-TIMING01** — OPEN / HIGH
4. **CONTEXT-ACCOUNTING-TRUTH01** — OPEN / HIGH
5. **USER-CONTEXT-CEILING01** — OPEN

---

## Context / compaction

These three epics are **semantically distinct**; do not collapse them.

### 11.1 CONTEXT-ACCOUNTING-TRUTH01

- ID: `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01`
- STATUS: OPEN / HIGH

**Observed symptoms.** Compaction/context displays have historically appeared to exceed plausible retained/request context, including >1M token claims.

**Latest live datum.** Visible compaction observed while context UI displayed ~194.0k.

**Primary question.** What quantity is actually being counted and used for compaction?

**Must distinguish:**

```
  model physical context max
  user effective context ceiling
  current request input tokens
  retained conversation/context tokens
  cumulative session tokens
  cache read tokens
  cache write tokens
  output tokens
  reasoning tokens
  compaction trigger estimate
  displayed context occupancy
```

**Leading hypotheses (NOT PROVEN):**

- possible cumulative-vs-current confusion
- possible cache-accounting folding
- possible stale model metadata
- possible tokenizer approximation issue
- possible double counting
- possible display/policy quantity mismatch

**Required progression:**

```
  real anomalous compaction
    → production accounting seam
    → classify token dimensions
    → RED reproduction
    → causal discriminator
    → bounded repair if required
    → live qualification
```

**Rule.** No repair from leading hypothesis.

### 11.2 COMPACTION-STATE-AUTHORITY01

- ID: `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01`
- STATUS: OPEN / LIVE_UI

**Live reproduction.** UI displays `"Compacting context..."`. TaskHeader simultaneously displays `"Waiting"`.

**Evidence quality.** LIVE_UI.

**Invariant.**

```
  active compaction
    → next_action_owner != HUMAN
    → TaskHeader MUST NOT present "Waiting"
```

**Important.** Do **NOT** repair by scraping or special-casing the visible string `"Compacting context..."`.

**Recon must find:**

- actual compaction lifecycle seam
- canonical runtime state during compaction
- whether compaction is:
  - a mutually exclusive task phase, **OR**
  - an orthogonal concurrent activity dimension

**Rule.** Design must follow source recon.

### 11.3 USER-CONTEXT-CEILING01

- ID: `EPIC-CLINEMM-USER-CONTEXT-CEILING01`
- STATUS: OPEN

**Goal.** Allow a user to set an effective operating ceiling below a model's advertised physical maximum.

**Example.** physical max = 1,000,000 → user effective ceiling = 512,000.

**Invariant.**

```
  physical model maximum   ≠
  effective configured ceiling  ≠
  current context occupancy  ≠
  cumulative token usage
```

**Dependency.** `CONTEXT-ACCOUNTING-TRUTH01` must be trustworthy enough before compaction policy is built on top of it.

---

## Task state / presentation

### 12.1 Static thinking presentation

- ID: `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`
- STATUS: OPEN

**Symptom.** Static `"Thinking ›"` presentation can persist after runtime state is no longer thinking/streaming.

**Constraint.** Do not invent a second UI authority. Use the canonical state/projection.

### 12.2 TaskHeader owner-aware timing

- ID: `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01`
- STATUS: OPEN

**Goal.** TaskHeader should project canonical runtime ownership/state.

**Desired semantic distinction:**

- AGENT-owned work
- HUMAN-owned waiting
- completed / terminal
- error / recovery states

**Likely telemetry:**

- agent-active elapsed
- wall elapsed if useful
- tool calls
- recovery count
- canonical state

**Dependency.** `COMPACTION-STATE-AUTHORITY01` should be understood first so `"Waiting"` does not hide active compaction.

---

## Product telemetry

### 13.1 Tool execution semantics

- ID: `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01`
- STATUS: OPEN

**Goal.** Replace an undifferentiated raw tool count with semantically useful execution telemetry.

**Important.** Mechanism ≠ purpose.

**Dimensions:**

```
  mechanism
  purpose
  effect class
  duration
  success / failure
  retry / recovery
  classification confidence / source
```

**Purpose candidates:**

```
  CODE_READ        CODE_EDIT      CODE_SEARCH
  TEST             BUILD          VALIDATION
  REPO_CONTROL     EVIDENCE_CAPTURE  RUNTIME_DIAGNOSTIC
  ENVIRONMENT_SETUP  DATA_QUERY   EXTERNAL_ACTION
  DOCUMENTATION    HOUSEKEEPING   OTHER
```

**Effect class:**

```
  READ_ONLY
  LOCAL_MUTATION
  EXTERNAL_MUTATION
```

**Rule.** Ambiguous shell commands must remain UNKNOWN/OTHER rather than being presented as certain semantic telemetry.

**First ACT.** `TOOL-EXECUTION-SEMANTICS-RECON01`. Do not implement classifier logic in this board ACT.

### 13.2 Flat-rate cost display truth

- ID: `EPIC-CLINEMM-COST-DISPLAY-TRUTH01`
- STATUS: OPEN

**Symptom.** Dollar estimates such as `"$0.0082"` are misleading when the user is on a flat-rate / subscription access path.

**Primary question.** Can runtime reliably know billing semantics?

**Desired behavior:**

```
  metered API        → estimated cost may be meaningful
  flat-rate / subscription  → pseudo-spend total should NOT be presented as actual spend
```

**If billing mode is not observable:** support explicit display policy / user override rather than inventing billing knowledge.

**Rule.** Do not implement in this ACT.

---

## Product configuration / branding

### 14.1 Cline-- branding

- ID: `EPIC-CLINEMM-BRANDING01`
- STATUS: OPEN

**Product identity.** `Cline--`

**First bounded slice.** Activity Bar icon: `|| → --`

**Conservation (do NOT change):**

- command IDs
- settings IDs
- protocol IDs
- package / publisher compatibility unless separately reviewed

**Forbidden.** Global source-wide `Cline → Cline--` replacement.

**First ACT.** `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`.

---

## Architecture

### 15.1 E8 legacy writer retirement

- STATUS: HOLD
- Purpose: retire remaining legacy writer authority only when E7 evidence and dependencies justify it.
- **No action in this board ACT.**

### 15.2 E9 effect interpreter

- STATUS: HOLD
- Purpose: bounded effect execution/interpreter work after E8.
- **No action in this board ACT.**

### 15.3 Elmization02

- ID: `EPIC-CLINEMM-ELMIZATION02`
- STATUS: OPEN / POST-E9 RECON

**Goal.** Migrate deterministic behavioral authority where doing so reduces duplicated state/policy decisions.

**Target direction:**

```
  Elm         → deterministic state transitions, policy, projections
  TypeScript  → VS Code APIs, filesystem/network/process effects, adapters
  React       → rendering, DOM/event adaptation
```

**Forbidden goal.** `"Rewrite everything in Elm"`.

**First post-E9 action.** Authority-domain recon.

---

## Distribution / CI

### 16.1 GitHub Actions

- ID: `EPIC-CLINEMM-GITHUB-ACTIONS01`
- STATUS: OPEN

**First ACT.** `ACT-CLINEMM-GITHUB-ACTIONS-RECON01`.

**Recon covers:**

- existing workflows
- actual failing jobs
- package-manager topology
- typecheck / test / build gates
- VSIX packaging
- permissions / secrets
- release triggers

**No repair in this board ACT.**

### 16.2 GitHub distribution

- ID: `EPIC-CLINEMM-GITHUB-DISTRIBUTION01`
- STATUS: OPEN

**Goals:**

- publish durable release artifact to GitHub
- determine whether GitHub Packages is useful for any reusable package

**Likely primary product artifact:** VSIX via GitHub Release.

**Artifact trust binding:**

```
  SOURCE_HEAD
  VERSION
  PATH
  BYTE_SIZE
  SHA256
  installed version where relevant
```

**Rule.** Do not rebuild a supposedly identical release artifact after qualification unless reproducibility is separately proven.

---

## P2 / deferred residue

1. **Historical branch** — `act/elm-architecture01-e0-e4` (merged, retained temporarily; safe to delete later).
2. **Old gate-summary state mismatch** — `.factory/gate-summary.json` may refer to old unrelated Factory scope. Do **not** treat stale historical summary as current ACT authority.
3. **Dogfood packaging script** — still creates a temporary detached Git worktree; conflicts with the new single-worktree policy. Follow-up cleanup required. Do **not** fix in this ACT.
4. **Historical documentation / SHA wording** — batch later.
5. **PTAD-off wire wording** — preferred wording (when describing the disabled mode):
   - `_ptadEnabled` / `_ptadPushId` absent when PTAD off
   - `stateVersion` / `epoch` retained
   - recorder inert

---

## Deferred to board Wave 2+

```
DEFERRED_TO_BOARD_WAVE02_OR_LATER

  - complete ACT index
  - historical SHA ledger
  - full closed-epic archaeology
  - all old halted / not-reproduced ACTs
  - detailed evidence-file pointers
  - complete UI backlog
  - branch cleanup inventory
  - complete release history
  - complete Factory-rule provenance
  - old repo-comparison-derived tasks
```

**Reason.** Documentary completeness is lower priority than executable learning.

---

## Board maintenance rule

At the end of a meaningful ACT, update **only rows affected by that ACT**. Do not rewrite the whole board.

Each row should preferably contain: `ID`, `STATUS`, `PRIORITY` (if useful), `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT` where known.

Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, **evidence wins**; the board row becomes P2 stale metadata.
