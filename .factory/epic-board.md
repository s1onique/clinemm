# Cline-- Global Epic Board

CANONICAL_AS_OF: 2026-08-19
SUBJECT_HEAD: 1e6430bc15f00d08f66dc905c41edbd3f74045db
BOARD_COMMIT: discover with `git log -1 -- .factory/epic-board.md`
BOARD_WAVE: 1 → TASK CENSUS 01

---

## Board contract

This file is the canonical project coordination board for Cline--. It is **not** primary evidence: rows point to commits, ACTs, tests, or artifacts where load-bearing claims live. Stale rows are P2/non-blocking and never invalidate executable tests, exact artifacts, live evidence, source truth, or Git identity. Only **P0** halts. **P1** gets one bounded fix cycle. **P2** is batched at cleanup. Prefer executable evidence over documentary completeness. Update this board incrementally at meaningful ACT boundaries. If maintenance slows learning without protecting correctness, simplify it.

**Task census rule.** Every actionable task discussed for Cline-- must have one canonical row here. Future planning authority is this board + source/Git/evidence. Routine project-thread archaeology is no longer required. When a new task is discussed, add the row at the next meaningful ACT boundary.

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

Rationale: linked worktrees caused agent path/branch confusion in earlier work; the complexity cost exceeded the isolation benefit. This repo deliberately chooses the simpler single-worktree policy.

---

### Remote push safety

```
REMOTE PUSH SAFETY

  NORMAL REMOTE PUSH:
    requires explicit user / ACT authority
    fast-forward only
    precondition: origin/main is ancestor of local main

  FORCE PUSH:
    categorically FORBIDDEN

  FORBIDDEN FORMS INCLUDE:
    git push --force
    git push -f
    git push --force-with-lease
    any non-fast-forward ref update through another Git spelling
    any API / automation operation equivalent to a force push

  APPLIES TO:
    main
    feature branches
    release branches
    tags where history movement is applicable
    humans
    agents (including Cline / Factory / other agents)
    CI
    release automation

  RULES:
    an ACT may grant normal push authority
    an ACT MUST NOT grant force-push authority
    if published history needs correction:
      create new commits
      revert
      merge / rebase locally before publication as appropriate
      use a new branch / ref if necessary
    DO NOT rewrite already-published remote history

This is a repository safety invariant, not merely a preference. Enforcement is the `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` epic.

---

## Canonical task index

Every actionable Cline-- task has exactly one row here. Narrative sections below refer back to these IDs. Historical identifiers that could not be confidently mapped are kept as `NEEDS_CLASSIFICATION` rather than silently dropped.

| ID | Area | Status | Priority | Depends on | Next action |
|---|---|---|---|---|---|
| `EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01` | CTX | OPEN | HIGH | none | source recon: is compaction a phase or an orthogonal dimension? |
| `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` | CTX | OPEN | HIGH | none | RED reproduction on implausible >1M readings; classify 11 token dimensions |
| `EPIC-CLINEMM-USER-CONTEXT-CEILING01` | CTX | OPEN | HIGH | context-accounting-truth | let users set effective cap below model physical max |
| `CTX-01` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `CTX-02` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `CTX-03` | CTX | NEEDS_CLASSIFICATION | LOW | — | classify when relevant |
| `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01` | TASK-UI | OPEN | HIGH | canonical task state authority | repair without inventing a second UI authority |
| `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01` | TASK-UI | OPEN | HIGH | none | consume canonical task-state projections; do not reconstruct locally |
| `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01` | TASK-UI | OPEN | HIGH | compaction-state-authority, canonical-projection | AGENT/HUMAN/terminal/error timing distinction |
| `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` | OBS | OPEN | HIGH | none | bounded recon; semantic purpose + effect class + classification |
| `EPIC-CLINEMM-COST-DISPLAY-TRUTH01` | OBS | OPEN | MED | none | billing-semantics recon; user display policy under flat-rate |
| `REC-01` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify recovery budget/telemetry semantics when relevant |
| `REC-02` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify recovery presentation semantics when relevant |
| `OBS-01` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (canonical task display) |
| `OBS-02` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (active-agent elapsed) |
| `OBS-03` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (human wait time) |
| `OBS-04` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (semantic tool classification) |
| `OBS-05` | OBS | NEEDS_CLASSIFICATION | LOW | — | classify (other remaining dimensions) |
| `EPIC-CLINEMM-BRANDING01` | PRODUCT | OPEN | MED | none | first slice: Activity Bar icon `|| → --`; preserve command/setting/protocol IDs |
| `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` | PRODUCT | NEXT | MED | branding01 | first bounded branding slice |
| `BRAND-01` | PRODUCT | CLOSED → alias of `EPIC-CLINEMM-BRANDING01` | — | — | historical alias |
| `STATE-01` | STATE | CLOSED via W1/W2 epoch-domain repair | — | — | historical alias |
| `STATE-02` | STATE | NEEDS_CLASSIFICATION | LOW | — | inspect queuedPrompts scope against current architecture |
| `ARCH-01` | ARCH | NEEDS_CLASSIFICATION | LOW | — | classify against E8/E9/Elmization02 |
| `ARCH-02` | ARCH | NEEDS_CLASSIFICATION | LOW | — | classify against E8/E9/Elmization02 |
| `E8 legacy writer retirement` | ARCH | HOLD | — | E7 evidence/dependencies | retire remaining legacy writer authority when justified |
| `E9 effect interpreter` | ARCH | HOLD | — | E8 | bounded effect execution/interpreter after E8 |
| `EPIC-CLINEMM-ELMIZATION02` | ARCH | OPEN | MED | E9 recon | migrate deterministic authority where doing so reduces duplication |
| `EPIC-CLINEMM-GITHUB-ACTIONS01` | DIST | OPEN | HIGH | none | recon workflows, failing jobs, gates, VSIX packaging |
| `ACT-CLINEMM-GITHUB-ACTIONS-RECON01` | DIST | NEXT | HIGH | github-actions01 | recon ACT |
| `EPIC-CLINEMM-GITHUB-DISTRIBUTION01` | DIST | OPEN | HIGH | none | publish VSIX via GitHub Release; decide GitHub Packages applicability |
| `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01` | DIST | P2/OPEN | LOW | one-worktree policy | remove detached temporary worktree from dogfood packaging |
| `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` | GIT-SAFETY | NEXT | CRITICAL | none | server-side enforce block-force-push rule on GitHub; defense in depth |
| `ACT-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01` | GIT-SAFETY | NEXT | CRITICAL | git-safety-no-force-push01 | GitHub ruleset/branch protection recon + enforce; prove server-side rule |
| `ACT-CLINEMM-PUBLISH-CURRENT-MAIN01` | DIST/REPO | OPEN | HIGH | remote-push-safety policy | fast-forward `origin/main` to current local main; requires explicit authority |
| `ACT-CLINEMM-SINGLE-WORKTREE-TRANSITION01` | FACTORY/REPO | CLOSED | — | — | repository-topology migration: main FF from `a9f376edf` → `5637d965d`; linked worktree removed; single-worktree topology frozen |
| `ACT-CLINEMM-LIVE-EPOCH-REPAIR-QUALIFICATION01` | FOUNDATION/QA | CLOSED_LIVE | — | — | W1/W2 epoch repair live qualification; `PASS_LIVE_EPOCH_REPAIR` at `5637d965d` |
| `EPIC-CLINEMM-TEST-BASELINE-ZERO-FAILURES01` | QA | OPEN | HIGH | none | classify and eliminate all long-standing "pre-existing" test failures until the canonical suite is green |
| `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01` | QA | OPEN | HIGH | none | classify and eliminate the 41 pre-existing apps/vscode typecheck errors; typecheck ≠ test gate |
| `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01` | QA | OPEN | HIGH | test-baseline-zero-failures recommended | inventory coverage seams; establish truthful exact-head baseline; publish machine-readable report |
| `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01` | QA | OPEN | HIGH | coverage-baseline01 | prevent aggregate coverage regression; thresholds increase monotonically |
| `UP-01` | UPSTREAM | SUPERSEDED → `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` | — | — | recon scope of fork vs upstream Cline; reclassified as upstream-intake substrate ACT |
| `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` | UPSTREAM | OPEN | HIGH | none | compact upstream issue intake substrate; rank by popularity + Cline-- value; map selected candidates |
| `QA-01` | QA | NEEDS_CLASSIFICATION | LOW | — | classify exact-head dogfood / live qualification / conservation gates |
| `QA-02` | QA | NEEDS_CLASSIFICATION | LOW | — | classify release-artifact qualification scope |
| `MCP-01` | MCP | NEEDS_CLASSIFICATION | LOW | — | classify against current Cline-- MCP usage; do not import InDeep/Figma scope |
| `MCP-02` | MCP | NEEDS_CLASSIFICATION | LOW | — | classify against current Cline-- MCP usage; do not import InDeep/Figma scope |
| `FACT-01` | FACTORY | NEEDS_CLASSIFICATION | LOW | — | classify prior Factory/Leamas substrate scope relevant to Cline-- |
| `FACT-02` | FACTORY | NEEDS_CLASSIFICATION | LOW | — | classify prior Factory/Leamas substrate scope relevant to Cline-- |
| `LIVE-CONTEXT-DIMENSIONS01` (LCD01) | DIAG | CLOSED via LCD01 retirement at `51f2f6a9c` | — | — | historical alias; PTAD retained as default-off substrate |
| `REACT-UPDATER-PURITY-REPAIR01` | FOUNDATION | CLOSED | — | — | historical alias; invariant: no side effects in functional updaters |
| `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` | FOUNDATION | CLOSED via W1/W2 epoch repair | — | — | historical alias; proven at `5637d965d` |
| `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01` | FOUNDATION | CLOSED (E7 Local thinking) | — | — | historical alias |
| `E7-LOCAL-BACKEND-ACTIVATION01` | FOUNDATION | CLOSED (E7 Local advisory) | — | — | historical alias |
| `ELM-02F` / `ELM-02F-CORRECTION01` | FOUNDATION | CLOSED (Elm groundwork) | — | — | historical alias |
| `C2-CORRECTION02-FIXUP01..04` | FOUNDATION | CLOSED via LCD01 retirement | — | — | historical alias |
| `TRACE01` | FOUNDATION | CLOSED (E7.1 thinking) | — | — | historical alias |
| `DOGFOOD-VSIX-QUALIFICATION01` | FOUNDATION | CLOSED | — | — | historical alias |
| `WEBVIEW-TURNSTATE-COMPOSITION01` | FOUNDATION | CLOSED (precondition halt) | — | — | historical alias |
| `C2.4-*` / `C2.5-*` / `C25-*` | FOUNDATION | CLOSED (Elmization groundwork) | — | — | historical alias |
| `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | FOUNDATION | CLOSED at `51f2f6a9c` | — | — | historical alias |
| `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01` | FACTORY | CLOSED at `1e6430bc15f00d08f66dc905c41edbd3f74045db` | — | — | this board's substrate commit |
| `ACT-CLINEMM-FACTORY-GLOBAL-TASK-CENSUS01` | FACTORY | CLOSED at `4b2b2beec059b668bd49799304b9fd78d1ef79a0` | — | — | this ACT's own predecessor; 47 canonical rows at closure |
| `ACT-CLINEMM-E7.1-TEMP-DIAGNOSTICS-REMOVAL01` | DIAG | SUPERSEDED → `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | — | — | old proposed ACT name; recon showed PTAD was valuable as generic dormant substrate, so LCD01 retired but PTAD retained DEFAULT_OFF |

Legend:
- `OPEN` — actionable, scope known.
- `NEXT` — concrete first slice identified, scope known.
- `HOLD` — explicitly not advancing; sequencing dependency only.
- `RECON` — recon phase before scope can be set.
- `BLOCKED` — depends on something outside the repo.
- `CLOSED` / `CLOSED_LIVE` — done; evidence pinned.
- `P2` — non-blocking cleanup or residue.
- `DEFERRED` — intentionally parked.
- `NEEDS_CLASSIFICATION` — historically known to exist; contract not reconstructable without further recon. Not silently dropped.

---

## Closed foundation

### 1. Elm/state architecture groundwork

- status: CLOSED
- note: canonical state-machine / runtime groundwork exists (e.g. `ELM-02F`, `C2.4-*`, `C25-*`)
- evidence: see Canonical task index alias rows

### 2. E7 Local advisory activation

- status: CLOSED
- source IDs: `E7-LOCAL-BACKEND-ACTIVATION01` + `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01`
- note: Local path has canonical advisory activation foundation

### 3. Thinking canonical-state authority

- status: CLOSED
- note: canonical authority exists; static presentation residue remains separately OPEN (see `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`)
- source IDs: `E7.1`, `TRACE01`

### 4. React updater purity repair

- status: CLOSED
- source ID: `REACT-UPDATER-PURITY-REPAIR01`
- invariant: no diagnostic/external side effects inside functional state updaters

### 5. W1/W2 epoch-domain repair

- status: CLOSED_LIVE
- source IDs: `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` / `LIVE-SHAPE-REPRODUCTION01`
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
- source ID: `LIVE-CONTEXT-DIMENSIONS01` (LCD01) + `C2-CORRECTION02-FIXUP01..04`
- status: CLOSED
- final commit: `51f2f6a9c48bd880186928b18a2a9e3817613d43`
- result:
  - LCD01 retired
  - PTAD retained (default-off, opt-in via workspace toggle)
  - production correctness invariants preserved

### 7. Dogfood VSIX qualification

- source ID: `DOGFOOD-VSIX-QUALIFICATION01`
- status: CLOSED

### 8. Factory global epic board substrate

- ACT: `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01`
- status: CLOSED
- final commit: `1e6430bc15f00d08f66dc905c41edbd3f74045db`

---

## Immediate critical path

Priority rationale: an accidental destructive force-push can destroy the evidence and commits behind every product defect. Git-safety comes before any product defect that depends on those commits remaining publishable. Quality substrate precedes long product-work cycles because a green baseline + monotonic coverage ratchet makes every subsequent Cline-- ACT cheaper to qualify.

1. **GIT-SAFETY-NO-FORCE-PUSH-ENFORCEMENT01** — NEXT / CRITICAL (server-side enforcement)
2. **PUBLISH-CURRENT-MAIN01** — OPEN / HIGH (requires explicit authority; fast-forward only)
3. **TEST-BASELINE-ZERO-FAILURES01** — OPEN / HIGH (default canonical gate = zero unexplained failures)
4. **TYPECHECK-ZERO-BASELINE01** — OPEN / HIGH (test gate ≠ typecheck gate; both must be clean)
5. **CODE-COVERAGE-BASELINE01** — OPEN / HIGH (recon before any ratchet)
6. **CODE-COVERAGE-RATCHET01** — OPEN / HIGH (depends on #5; monotonic threshold increase)
7. **COMPACTION-STATE-AUTHORITY01** — OPEN / LIVE_UI / HIGH
8. **STATIC-THINKING-PRESENTATION-PERSISTENCE01** — OPEN / HIGH
9. **TASKHEADER-CANONICAL-PROJECTION01** — OPEN / HIGH
10. **TASKHEADER-OWNER-AWARE-TIMING01** — OPEN / HIGH
11. **CONTEXT-ACCOUNTING-TRUTH01** — OPEN / HIGH
12. **USER-CONTEXT-CEILING01** — OPEN / HIGH (depends on #11)
13. **TOOL-EXECUTION-SEMANTICS01** — OPEN / HIGH
14. **GITHUB-ACTIONS01** — OPEN / HIGH
15. **GITHUB-DISTRIBUTION01** — OPEN / HIGH
16. **BRANDING-ACTIVITYBAR-ICON01** — NEXT / MED

Deferred (not on critical path):

- **FACTORIZATION01** — DEFERRED (recon; one bounded seam at a time; no giant rewrite)

---

## Context / compaction

Three **semantically distinct** epics; do not collapse.

### CONTEXT-ACCOUNTING-TRUTH01

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

**Leading hypotheses (NOT PROVEN):** cumulative-vs-current confusion, cache-accounting folding, stale model metadata, tokenizer approximation, double counting, display/policy quantity mismatch.

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

### COMPACTION-STATE-AUTHORITY01

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

**Recon must find:** actual compaction lifecycle seam, canonical runtime state during compaction, whether compaction is a mutually exclusive task phase OR an orthogonal concurrent activity dimension. Design must follow source recon.

### USER-CONTEXT-CEILING01

- ID: `EPIC-CLINEMM-USER-CONTEXT-CEILING01`
- STATUS: OPEN

**Goal.** Allow a user to set an effective operating ceiling below a model's advertised physical maximum.

**Configuration modes that must be supported:**

- `Auto` — use the model's physical maximum
- explicit effective token ceiling — user-configurable value

**Example.** physical model max = 1,000,000 → explicit user effective ceiling = 512,000.

**Important.** `512k` is a user-configurable example / desired value. It is **NOT** a global hardcoded limit for every 1M-context model. The effective budget must satisfy `effective <= physical model maximum`, but concrete implementation must follow real source recon.

**Invariant.**

```
  physical model maximum   ≠
  effective configured ceiling  ≠
  current context occupancy  ≠
  cumulative token usage
```

**Dependency.** `CONTEXT-ACCOUNTING-TRUTH01` must be trustworthy enough before compaction policy is built on top of it. Do not implement before context-accounting semantics are trustworthy.

### Historical context family (CTX-01..03)

Preserved as `NEEDS_CLASSIFICATION` rows in the canonical task index. Scope not reconstructable from current board + repository history; do not silently forget them. Reclassify when relevant.

---

## Task state / presentation

### STATIC-THINKING-PRESENTATION-PERSISTENCE01

- ID: `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`
- STATUS: OPEN

**Symptom.** Static `"Thinking ›"` presentation can persist after runtime state is no longer thinking/streaming.

**Constraint.** Do not invent a second UI authority. Use the canonical state/projection.

### TASKHEADER-CANONICAL-PROJECTION01

- ID: `EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01`
- HISTORICAL NAME: E7.1-2 TASKHEADER CANONICAL PROJECTION
- STATUS: OPEN

**Purpose.** TaskHeader consumes canonical task-state projections rather than reconstructing state locally.

**Distinct from timing.** This epic is about projection correctness, not elapsed-time semantics. It is **not** folded into owner-aware timing; that would lose it.

### TASKHEADER-OWNER-AWARE-TIMING01

- ID: `EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01`
- STATUS: OPEN

**Goal.** TaskHeader should project canonical runtime ownership/state with timing semantics.

**Desired semantic distinction:**

- AGENT-owned work
- HUMAN-owned waiting
- completed / terminal
- error / recovery states

**Likely telemetry:** agent-active elapsed, wall elapsed if useful, tool calls, recovery count, canonical state.

**Dependencies.** `TASKHEADER-CANONICAL-PROJECTION01` and `COMPACTION-STATE-AUTHORITY01` must be understood first so `"Waiting"` does not hide active compaction.

---

## Product telemetry

### TOOL-EXECUTION-SEMANTICS01

- ID: `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01`
- STATUS: OPEN

**Goal.** Replace an undifferentiated raw tool count with semantically useful execution telemetry.

**Important.** Mechanism ≠ purpose.

**Dimensions:** mechanism, purpose, effect class, duration, success/failure, retry/recovery, classification confidence/source.

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

### COST-DISPLAY-TRUTH01

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

### Historical recovery/observability family

`REC-01`, `REC-02`, `OBS-01..05` preserved as `NEEDS_CLASSIFICATION` rows. Scope not reconstructable from current board + repository history. Recovery counter is partially exposed by TaskHeader but the original contract is unverified. Reclassify when relevant.

---

## Product configuration / branding

### BRANDING01

- ID: `EPIC-CLINEMM-BRANDING01`
- alias: `BRAND-01`
- STATUS: OPEN

**Product identity.** `Cline--`

**First bounded slice.** Activity Bar icon: `|| → --` (see `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01`).

**Icon behavior.** Preserve VS Code monochrome / theming behavior (no colored branding that breaks native Activity Bar theming).

**Compatibility baseline (do NOT change unless a separate compatibility migration is reviewed):**

- publisher: `s1onique`
- package name: `clinemm`
- internal `cline.*` command / settings / protocol namespaces remain unchanged

**Conservation.** Command IDs, settings IDs, protocol IDs, package / publisher compatibility are protected unless a separate compatibility migration is reviewed.

**Forbidden.**

- Global source-wide `Cline → Cline--` replacement
- Colored branding that breaks native Activity Bar theming
- Renaming compatibility IDs merely for cosmetic branding

**Future recon scope.** Visible extension strings, welcome/about, README/screenshots, release presentation.

---

## Architecture

### E8 — legacy writer retirement

- STATUS: HOLD
- Purpose: retire remaining legacy writer authority only when E7 evidence and dependencies justify it.
- **No action in this board ACT.**

### E9 — effect interpreter

- STATUS: HOLD
- Purpose: bounded effect execution/interpreter work after E8.
- **No action in this board ACT.**

### ELMIZATION02

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

### Historical architecture family

`ARCH-01`, `ARCH-02` preserved as `NEEDS_CLASSIFICATION` rows. Scope not reconstructable from current board + repository history.

---

## Quality substrate

Four QA epics plus a deferred architecture epic. Quality substrate precedes long product-work cycles because a green baseline + monotonic coverage ratchet makes every subsequent Cline-- ACT cheaper to qualify.

### TEST-BASELINE-ZERO-FAILURES01

- ID: `EPIC-CLINEMM-TEST-BASELINE-ZERO-FAILURES01`
- STATUS: OPEN / HIGH

**Goal.** Default canonical test gate = zero unexplained failures.

**First ACT.** `ACT-CLINEMM-TEST-BASELINE-FAILURES-RECON01` — reproduce every currently accepted baseline failure and classify each:

```
  PRODUCT_DEFECT
  TEST_DEFECT
  ENVIRONMENT_DEPENDENT
  OBSOLETE_TEST
  INTENTIONAL_UNSUPPORTED
  NOT_REPRODUCED
```

**Then.** Fix bounded causes, remove obsolete tests where justified, isolate genuine environment-specific gates explicitly.

**Forbidden.**

- deleting assertions merely to get green
- broadening baselines
- masking failures with generic ignore / allow-failure

**Policy note.** "Pre-existing" is a legitimate ACT-ownership classification; it is **not** an acceptable permanent quality policy.

### TYPECHECK-ZERO-BASELINE01

- ID: `EPIC-CLINEMM-TYPECHECK-ZERO-BASELINE01`
- STATUS: OPEN / HIGH

**Goal.** Default canonical typecheck = zero unexplained errors.

**Why separate from TEST-BASELINE-ZERO-FAILURES01.** Test gate ≠ typecheck gate. The repo currently carries two distinct flavors of tolerated debt (e.g. `1667 pass / 5 pre-existing fail` test failures and `41 pre-existing` SDK typecheck errors). Conflating them hides half of the debt.

**First ACT.** `ACT-CLINEMM-TYPECHECK-ZERO-BASELINE-RECON01` — reproduce and classify the current baseline with the same classification taxonomy as the test-baseline ACT.

### CODE-COVERAGE-BASELINE01

- ID: `EPIC-CLINEMM-CODE-COVERAGE-BASELINE01`
- STATUS: OPEN / HIGH

**Goal.** Establish a baseline coverage measurement **before** any ratchet is set.

**Must answer first.**

```
  which workspaces / packages are covered?
  which source paths are intentionally excluded?
  which coverage kind: line / function / branch / statement?
  do tests exercise production code or generated / adapter noise?
  can reports compose across workspace test suites?
```

**Output.** Machine-readable exact-head coverage report committed alongside the ACT that produces it.

**Rule.** No arbitrary initial percentage target. Recon first.

### CODE-COVERAGE-RATCHET01

- ID: `EPIC-CLINEMM-CODE-COVERAGE-RATCHET01`
- STATUS: OPEN / HIGH

**Invariant.**

```
  new coverage >= qualified baseline
```

(preferable to: `coverage >= arbitrary 80%`.)

**Thresholds.**

- thresholds increase monotonically
- intentional threshold changes are explicit commits
- CI must NOT silently rewrite thresholds (do not rely on `thresholds.autoUpdate` in CI)
- per-file or changed-code policy **deferred** until `CODE-COVERAGE-BASELINE01` recon is complete

### FACTORIZATION01

- ID: `EPIC-CLINEMM-FACTORIZATION01`
- STATUS: DEFERRED

**Goal.** Progressively factorize Cline-- along real production seams.

**Rule.**

```
  recon first
  one bounded seam at a time
  no giant "modularization" rewrite
```

**Rationale.** Factorization because a concrete seam reduces coupling / testing cost — not because "factorization" itself is virtuous.

**Scope.** Intentionally unfrozen. Detailed design belongs to a future architectural discussion.

**Next action.** Future architectural discussion only. **No ACT in this board delta.**

---

## Upstream intake

### UPSTREAM-ISSUE-INTAKE01

- ID: `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01`
- STATUS: OPEN / HIGH

**Goal.** Acquire trustworthy upstream issue metadata for offline Cline-- triage.

**Substrate (committed in this repo).**

```
  scripts/dump-cline-issues.py
    fetcher: Link-header pagination, PR exclusion, retry contract,
    checkpoint/resume, atomic write, bounded selection policy
  scripts/tests/test_dump_cline_issues.py
    stdlib unittest; 29 network-free tests
  .factory/upstream/cline-open-issues-index.json
    compact machine-readable snapshot
```

**Snapshot contract.** Stored fields per issue: `number`, `title`, `url`, `created_at`, `updated_at`, `comments`, `reactions`, `interactions`, `labels`. **Excluded:** `body`, comment bodies, reactions breakdown, avatar URLs, assignee objects, milestone description, user profile metadata, API payload copies.

**Deterministic ordering.** `interactions` DESC, `updated_at` DESC, `number` DESC.

**Size policy.** Preferred ≤ 1 MiB; acceptable ≤ 2 MiB. When exceeded, a bounded selection policy is applied: top-N by interactions PLUS every issue matching high-value Cline-- keyword/label families (`context`, `compact`, `token`, `prompt`, `checkpoint`, `retry`, `recovery`, `terminal`, `tool`, `provider`, `model`, `performance`, `memory`, `mcp`, `state`, `waiting`, `task`, `install`, `release`, `vscode`). Truncation is **never silent** — `total_open_issue_count`, `committed_issue_count`, `truncated`, `selection_policy` are always recorded.

**First triage ACT.** `ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-TRIAGE01` — uses the substrate to rank upstream open issues and decide per-issue disposition:

```
  IMPORT          -- promote into a Cline-- epic/ACT
  MAP_EXISTING    -- already covered by an existing Cline-- epic
  RADAR           -- worth watching but not importing yet
  REJECT          -- out of scope or value-not-worth-effort
```

**Selection dimensions for triage.**

```
  popularity           comments + reactions (interactions)
  recency / activity   updated_at
  correctness impact   label family, title keyword
  Cline-- product value mapping against the current critical path
  architectural fit    Elm/state/quality-substrate seams
  implementation ROI    effort-to-value ratio
  existing-board overlap against canonical rows
  upstream momentum    active maintainer response signals
```

**Rule.** Popularity ≠ automatic priority. A 100-interaction feature request can still be REJECT if it conflicts with Cline-- direction.

**This ACT is not.**

- upstream issue triage itself (that's TRIAGE01)
- importing upstream issues into Cline-- yet
- fixing upstream issues
- GitHub Actions work
- force-push enforcement
- product implementation

**Historical mapping.** `UP-01` (recon: scope of fork maintenance vs upstream Cline) was reclassified into this epic at substrate ACT — the recon scope became a concrete intake substrate and a planned triage ACT.

---

## Distribution / CI

### GITHUB-ACTIONS01

- ID: `EPIC-CLINEMM-GITHUB-ACTIONS01`
- STATUS: OPEN

**First ACT.** `ACT-CLINEMM-GITHUB-ACTIONS-RECON01`.

**Recon covers:** existing workflows, actual failing jobs, package-manager topology, typecheck / test / build gates, VSIX packaging, permissions / secrets, release triggers.

**No repair in this board ACT.**

### GITHUB-DISTRIBUTION01

- ID: `EPIC-CLINEMM-GITHUB-DISTRIBUTION01`
- STATUS: OPEN

**Goals (two distinct questions, do not conflate):**

A. Publish Cline-- distributable artifact to GitHub. Likely primary artifact: VSIX via GitHub Release asset.
B. Determine whether any package genuinely belongs in GitHub Packages.

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

### DOGFOOD-SINGLE-WORKTREE-CLEANUP01

- ID: `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01`
- STATUS: P2 / OPEN

**Symptom.** Dogfood builder still creates a detached temporary Git worktree, contrary to current one-worktree repository policy.

**Goal.** Package/install dogfood without linked Git worktree topology, if safely possible.

**Do not execute in this ACT.**

---

## P2 / deferred residue

1. **Historical branch** — `act/elm-architecture01-e0-e4` (merged, retained temporarily; safe to delete later).
2. **Old gate-summary state mismatch** — `.factory/gate-summary.json` may refer to old unrelated Factory scope. Do **not** treat stale historical summary as current ACT authority.
3. **Dogfood packaging script worktree** — see `ACT-CLINEMM-DOGFOOD-SINGLE-WORKTREE-CLEANUP01` (promoted to named task above).
4. **Historical documentation / SHA wording** — batch later.
5. **PTAD-off wire wording** — preferred wording (when describing the disabled mode):
   - `_ptadEnabled` / `_ptadPushId` absent when PTAD off
   - `stateVersion` / `epoch` retained
   - recorder inert

---

## Historical aliases / superseded IDs

Compact mapping so old names are preserved without duplicate work.

| Historical ID | Canonical task | Disposition |
|---|---|---|
| `BRAND-01` | `EPIC-CLINEMM-BRANDING01` | renamed |
| `STATE-01` | W1/W2 epoch-domain repair | absorbed (CLOSED_LIVE) |
| `STATE-02` (queuedPrompts) | `NEEDS_CLASSIFICATION` row | preserved; classify when relevant |
| `CTX-01` / `CTX-02` / `CTX-03` | `EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01` + `USER-CONTEXT-CEILING01` + `COMPACTION-STATE-AUTHORITY01` | map individually as recon proceeds |
| `REC-01` / `REC-02` | `NEEDS_CLASSIFICATION` | preserved |
| `OBS-01`..`OBS-05` | `TASKHEADER-*` + `TOOL-EXECUTION-SEMANTICS01` + `COST-DISPLAY-TRUTH01` | likely absorb; classify when relevant |
| `FACT-01` / `FACT-02` | `NEEDS_CLASSIFICATION` | preserved; classify against current Factory work |
| `MCP-01` / `MCP-02` | `NEEDS_CLASSIFICATION` | preserved; classify against current Cline-- MCP usage only |
| `ARCH-01` / `ARCH-02` | E8 / E9 / `EPIC-CLINEMM-ELMIZATION02` | map individually as recon proceeds |
| `UP-01` | `EPIC-CLINEMM-UPSTREAM-ISSUE-INTAKE01` | SUPERSEDED at substrate ACT; recon fork-vs-upstream scope became upstream-issue-intake epic |
| `QA-01` / `QA-02` | exact-head dogfood + live qualification gates | preserved; classify qualification scope |
| `LIVE-CONTEXT-DIMENSIONS01` (LCD01) | LCD01 retirement | CLOSED at `51f2f6a9c` |
| `C2-CORRECTION02-FIXUP01..04` | LCD01 retirement | CLOSED via LCD01 retirement |
| `REACT-UPDATER-PURITY-REPAIR01` | React updater purity repair | CLOSED |
| `RED-FIX01` / `W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01` | W1/W2 epoch-domain repair | CLOSED_LIVE at `5637d965d` |
| `LIVE-SHAPE-REPRODUCTION01` | W1/W2 epoch-domain repair | CLOSED (precondition halt + retraction) |
| `E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01` | E7 Local thinking | CLOSED |
| `E7-LOCAL-BACKEND-ACTIVATION01` | E7 Local advisory | CLOSED |
| `ELM-02F` / `ELM-02F-CORRECTION01` | Elm groundwork | CLOSED |
| `TRACE01` | E7.1 thinking | CLOSED |
| `WEBVIEW-TURNSTATE-COMPOSITION01` | E7.1 (precondition halt) | CLOSED |
| `C2.4-*` / `C2.5-*` / `C25-*` | Elmization groundwork | CLOSED |
| `DOGFOOD-VSIX-QUALIFICATION01` | Dogfood qualification | CLOSED |
| `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | LCD01 retirement | CLOSED at `51f2f6a9c` |
| `ACT-CLINEMM-FACTORY-GLOBAL-EPIC-BOARD-WAVE01` | Factory epic board substrate | CLOSED at `1e6430bc15f00d08f66dc905c41edbd3f74045db` |
| `ACT-CLINEMM-FACTORY-GLOBAL-TASK-CENSUS01` | Factory task census | CLOSED at `4b2b2beec059b668bd49799304b9fd78d1ef79a0` |
| `ACT-CLINEMM-E7.1-TEMP-DIAGNOSTICS-REMOVAL01` | `ACT-CLINEMM-PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE01` | SUPERSEDED (PTAD retained DEFAULT_OFF; recon showed value) |
| `ACT-CLINEMM-SINGLE-WORKTREE-TRANSITION01` | repository-topology migration | CLOSED (main FF `a9f376edf` → `5637d965d`; one-worktree policy frozen) |
| `ACT-CLINEMM-LIVE-EPOCH-REPAIR-QUALIFICATION01` | W1/W2 epoch repair qualification | CLOSED_LIVE at `5637d965d` (`PASS_LIVE_EPOCH_REPAIR`) |

**Unknown-task policy.** If a historical ID is known to have existed but its exact contract cannot be reconstructed from current board + repository history + current source/docs, the row stays in this table as `NEEDS_CLASSIFICATION`. We do not invent scope, we do not silently omit, and we do not spend hours reconstructing now. Reclassification happens when the task becomes relevant to a real decision.

---

## Deferred (post-census)

The Wave-2+ archaeology items remain deferred. This census captured task completeness; full historical narrative is still not the goal.

```
DEFERRED_POST_CENSUS

  - full ACT index
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

**Reason.** Documentary completeness is lower priority than executable learning. The census is intended to be the **last** emergency global thread scan.

---

## Board maintenance rule

At the end of a meaningful ACT, update **only rows affected by that ACT**. Do not rewrite the whole board.

Each row should preferably contain: `ID`, `STATUS`, `PRIORITY` (if useful), `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT` where known.

Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a board row, **evidence wins**; the board row becomes P2 stale metadata.

**Post-census maintenance.** When a new task is discussed, add a single row to the canonical task index at the next meaningful ACT boundary. When an old forgotten task surfaces, add one delta. Do **not** trigger another global archaeology exercise.
