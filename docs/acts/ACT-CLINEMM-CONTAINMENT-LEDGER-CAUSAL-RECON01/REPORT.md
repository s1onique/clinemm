# ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 — Recon Report

**Type:** Bounded source reconnaissance + targeted causal-evidence extension
**Status:** COMPLETE — terminal verdict below
**Branch:** existing `main` (no ACT branch created)
**Production delta:** ONE bounded diagnostic extension to the EXISTING BJLA capture. **No completion-barrier semantic changed**, no new process signal, no state-changing probe, no new protocol field, no React/Elm/webview change, no TaskHeader change, no speculative clearing of a containment failure.

---

## 0. Terminal verdict

**`PASS_RECON`** — the containment-ledger causal join is established; the repair is deliberately **NOT** performed.

**The question the ACT was given:**

> *Why do we have 43 `containment_failed` entries, and how many still represent genuine containment obligations?*

**Answered as far as the permitted evidence allows.** The 43 entries can now be joined, one by one, to their original cleanup outcome: the job id, the owner session, the PID/PGID, the kernel verdict, the **OS errno behind that verdict**, and the controller's terminal-state publication. The set of entries that actually held the completion is now named **exactly** (previously only a count reached the recorder), and each blocker carries an explicit ownership classification.

**What is NOT claimed.** The LIVE disposition of those 43 entries is **not** determined by this ACT. That requires the installed extension against real jobs (the successor ACT). This ACT establishes the JOIN, not the OUTCOME.

---

## 1. Entry HEAD, tree and repository hygiene

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `d297ad2d24149d030750ac5cfdc3c1d80647d74c` |
| `ENTRY_TREE` | `29d38e1f9529d1cb019609cbe3594d51c2e09ee4` |
| Branch | `main` |
| Protected stash | `stash@{0}: WIP on main: d46223b51 …` — **INTACT, untouched** |
| Worktrees | 4, all untouched |
| `PUSHED` | NO |
| `INSTALLED` | NO (no VSIX built, no dogfood install) |
| `BRANCH_CREATED` | NO |

---

## 2. §1 — Source recon: the real production chain

The production chain was traced end-to-end BEFORE anything was changed.

```
CommandJobManager.finalize()                          command-job-manager.ts
  → defaultTerminalPostconditionProbe(pgid)           process.kill(-pgid, 0)
  → postcondition ∈ {gone, alive, eperm, unknown}
  → job.terminationFailed latch                       pgid_unset | substrate_alive
                                                      | substrate_eperm | substrate_unknown
  → emit command_job_primary_group_cleanup            (carries postcondition)
  → emit command_job_residual_detected               (pre-delete observation)
  → this.active.delete(job.id)
  → emit command_job_containment_failed               (post-delete, carries containmentFailed)

SdkController.updateBackgroundCommandState()           SdkController.ts
  → backgroundCommandJobStates[jobId] = "containment_failed"
  → backgroundCommandJobOwners[jobId] = ownerSessionId

SdkSessionEventCoordinator
  .unresolvedContainmentFailuresForOwner()            coordinator.ts  (owner-scoped classifier)
  → C10 completion hold                                (captured a COUNT only)
```

### 2.1 What each boundary ALREADY observed (the inventory)

| Boundary | Already observable |
|---|---|
| `finalize()` | `postcondition`, `containmentFailed` reason, `pgid`, `ownerSessionId`, manager identity |
| BJLA `job_active_removed` | `pid`, `pgid`, `previousState`, `terminalState`, `terminationReason` |
| Controller publication | the published terminal reason, the owner session id |
| C10 hold | the **COUNT** of blockers; the aggregate hold conjuncts |
| Classifier | the blocking job id list (in-memory, not captured) |

### 2.2 What was MISSING (the gap the ACT named)

| Field | Status before |
|---|---|
| Exact blocking `jobId` set | **MISSING** — only a count was captured |
| Owner session + ownership classification | **MISSING** — owner scope was implicit in the count |
| PID / PGID / manager identity on the failure | **PARTIAL** — `pid` was on an adjacent record, not the failure |
| Cleanup outcome + **OS error code** | **MISSING** — the probe returned a category, not the errno |
| Terminal-state publication provenance | **MISSING** — not captured |
| Later authoritative containment observation | **UNAVAILABLE_FROM_TRACE** — by design (see §5) |

---

## 3. §2 — Only the missing evidence was added

The existing BJLA capture (`apps/vscode/src/sdk/background-job-liveness-authority.ts`) was **EXTENDED**. No new telemetry system, no new protocol field, no new process signal, no state-changing probe. Every captured value was **already evaluated** by production.

### 3.1 `containment_failure_classified` — the per-job ROOT CAUSE

Captured in `CommandJobManager.finalize()` at the exact boundary the manager classifies the failure:

| Field | Why |
|---|---|
| `jobId` | the join key to the C10 blocker |
| `ownerSessionId` | the join key to the controller's map |
| `pid`, `pgid` | correlate with the original process |
| `postcondition` | the kernel verdict |
| **`osErrorCode`** | `ESRCH` / `EPERM` / `null` — the errno behind the verdict |
| `containmentFailed` | the structured failure reason |
| `managerInstance` | the manager identity |

Captured **only on the failure path** — a clean terminal (`gone`) has no ledger entry.

### 3.2 `containment_ledger_blocking_set` — the JOIN

Captured at **all four** hold boundaries (`c10_completion_attempt`, `deferred_c10_reevaluation`, `q5_deferred_handoff`, `commit_boundary`):

| Field | Why |
|---|---|
| `blockingJobIds` | the **EXACT** set, not a count |
| `blockingOwnershipClasses` | `matching_owner` / `foreign_owner` / `unknown_owner` / `owner_map_absent`, positionally aligned |
| `totalContainmentFailureEntries` | the **denominator** — "43 entries exist, 7 of which block here" |
| `foreignOwnerEntriesExcluded` | how many were proved foreign and excluded |

### 3.3 `containment_terminal_state_published` — the LINK

Captured at `SdkController.updateBackgroundCommandState()`: the published terminal reason, the owner it was filed under, and the boolean form of the predicate the classifier applies.

---

## 4. The macOS `kill(2)` distinction — now observable

The ACT's central observation was that Apple's `kill(2)` contract distinguishes `ESRCH` from `EPERM`, and that a signal-zero probe checks existence **and permission**, not successful termination. The previous capture collapsed the verdict into a bare category. It now carries the errno:

| Verdict | errno | Meaning | Bounded invariant |
|---|---|---|---|
| `alive` | `null` | probe **permitted**, group **EXISTS** | **REFUTED** — a real, live obligation |
| `eperm` | `EPERM` | probe **DENIED** (Seatbelt / privilege) | **UNPROVEN** — liveness unknown |
| `gone` | `ESRCH` | group **NOT FOUND** | **PROVEN** — the only clean verdict |
| `unknown` | verbatim | any other errno | fail-closed |

### 4.1 No additional process signal

`defaultTerminalPostconditionProbe` now returns `{ postcondition, osErrorCode }` instead of a bare category. The errno was **already in hand** on the throw path — no extra syscall, no extra probe, no liveness re-check.

The probe seam's return type was **widened**, not replaced: the legacy bare-string form is still accepted, so all **8** pre-existing injected probe seams (DCCT01, PCPC01, PHCF01, CFC10A01, CFC10AR01, PCCA01, …) compile and behave **unchanged**.

---

## 5. `UNAVAILABLE_FROM_TRACE` — the later authoritative observation

The ACT asked for a "later authoritative containment observation, if any". It is recorded as **`UNAVAILABLE_FROM_TRACE`**, and deliberately so:

> Establishing whether the original failure was superseded requires re-probing the process group. That is a **NEW process signal**, which the ACT explicitly forbids ("no additional process signals, no state-changing probes"). The existing production probe runs **only** inside `finalize()` — there is no later observation seam, and adding one would be a second containment policy, not an observability change.

The consequence is stated plainly in §7: the ledger can prove **why** an entry is held, but it cannot prove **that the group later disappeared**.

---

## 6. The single-classifier invariant was PRESERVED

The shared classifier `unresolvedContainmentFailuresForOwner` remains the **single authoritative containment predicate**:

| Contract | Value |
|---|---|
| `private unresolvedContainmentFailuresForOwner(` definitions | **1** |
| `!== "containment_failed"` comparisons | **1** |
| `unresolvedContainmentFailuresForOwner(` call sites | **5** (Site A, Site B, Site C, R4 helper, definition) |
| `captureContainmentLedgerBlockingSet(` occurrences | **5** (4 boundaries + 1 definition) |

**How it was preserved.** The first implementation of the diagnostic companion re-derived the blocking set, which added a **second** `!== "containment_failed"` comparison and violated the CFC10AR01 "no triplication" contract. It was corrected: the classifier now takes an **optional `ContainmentLedgerDetail` out-parameter** and records each entry's ownership class **during its own filter pass**. The diagnostic companion therefore **consumes** the classification instead of re-deriving it — one predicate, one definition, one pass.

`classifyContainmentOwnershipClass` (free function) and `newContainmentLedgerDetail` are module-level, so the classifier and the diagnostic share **one** implementation of the ownership rule.

---

## 7. §3 — RED reproduction

New suite: `apps/vscode/src/sdk/__tests__/containment-ledger-causal-recon01.clcr01.test.ts` — **20 tests, all passing**.

**EVIDENCE CLASSIFICATION: `SYNTHETIC_REAL`.** The production manager / classifier / coordinator seams are the REAL ones; only the supervisor and the manager's documented `terminalPostconditionProbe` seam are injected. **No live process-group claim is made.**

### 7.1 What it establishes

| Case | Assertion |
|---|---|
| CLCR01-01/04 | a clean `gone`/ESRCH terminal produces **NO** containment record |
| CLCR01-02 | a surviving group → `substrate_alive`, errno **NULL** |
| CLCR01-03 | a denied probe → `substrate_eperm`, errno **EPERM** — **distinct** from (02) |
| CLCR01-05/08 | the owner session is captured; an unrecorded owner is `null` |
| CLCR01-06 | an unknown errno is carried **verbatim** (`EINVAL`) |
| CLCR01-07 | the capture is a **complete no-op** when the diagnostic seam is OFF |
| CLCR01-09 | the blocking set names the **exact** job ids — and excludes a clean terminal |
| CLCR01-10 | a **foreign** owner's failure is excluded and **counted separately** |
| CLCR01-11/12 | an **unknown owner** and an **absent owner map** both **block** (fail closed) |
| CLCR01-14 | the ownership classes are **positionally aligned** with the job ids |
| CLCR01-15 | an unresolved failure **holds** the completion barrier |
| CLCR01-16 | **THE RED REPRODUCTION** — see below |
| CLCR01-17 | the root-cause record proves **why** the entry was held |
| CLCR01-18/19/20 | the production seams are wired; the single-classifier contract holds |

### 7.2 The RED reproduction, stated precisely

`CLCR01-16` proves that a **retained `containment_failed` projection continues to block completion**. It does **NOT** demonstrate a real process group disappearing after the original cleanup observation — and the test says so in its own body.

**The defect hypothesis** is: a containment failure whose process group **subsequently disappeared** leaves a **permanent** `containment_failed` entry in the controller's map, blocking the completion forever even though no containment obligation remains.

**Why the production classifier cannot distinguish it:** the classifier reads the projection map, which still says `containment_failed`. The map has no way to know the group disappeared. Resolving it needs the later authoritative observation of §5, which is `UNAVAILABLE_FROM_TRACE`.

**What the ledger now shows instead** — the honest, complete statement:
- the blocker is a **real** containment failure (`postcondition !== "gone"`),
- its root cause (verdict + errno + process identity + owner) is **named**,
- and there is **no** later authoritative observation — the obligation is **unresolved as far as the trace knows**.

---

## 8. §4 — Repair: deliberately NOT performed

**No repair was made, and none was justified.**

A repair would require either:
1. **re-probing the process group** — a new process signal, forbidden by the ACT; or
2. **clearing a `containment_failed` projection without proof** — exactly the "speculative clearing of containment failures" the ACT ruled out, and unsafe: a genuinely live process group could then be silently classified safe.

The ACT's own gate — *"Only then repair. Require an ablation proving the chosen change is necessary, plus adversarial tests ensuring genuinely live or unknown process groups cannot be silently classified safe"* — cannot be met while the necessary observation is unavailable. **The causal join was the deliverable; the repair is the successor ACT's job, after LIVE qualification.**

The completion-barrier semantics are **UNCHANGED**: the classifier is still fail-closed, an unknown owner still blocks, an absent owner map still blocks, and a foreign owner still does not.

---

## 9. Verification

### 9.1 Typecheck, lint, format

| Gate | Result |
|---|---|
| `bunx tsc --noEmit` | **clean** (exit 0) |
| `bunx biome lint` (6 touched files) | **clean** |
| `bunx biome format` (6 touched files) | **clean** (formatter applied; 5 files fixed) |

### 9.2 Focused regression suite — **117/117 passing** across 9 suites

| Suite | Result |
|---|---|
| `containment-ledger-causal-recon01.clcr01` (new) | **20 passed** |
| `containment-failure-c10-authority01.cfc10a01` | 19 passed |
| `containment-failure-c10-authority-repair01.cfc10ar01` | 25 passed |
| `premature-handoff-containment-failure01.phcf01` | 10 passed |
| `command-job-manager-descendant-conservation.dcct01` | 17 passed |
| `pcpc-containment-product-contract.pcpc01` | 11 passed |
| `background-job-liveness-authority.bclas01` / `.bclas06` | 2 + 2 passed |
| `held-terminal-eviction-conservation01.htec01` | 11 passed |

### 9.3 Full `src/sdk/__tests__` sweep — ZERO regressions

The suite carries a large **pre-existing** failure population on this host (Seatbelt / lifecycle-witness / capture-compose sandbox-dependent tests, plus order-dependent flakes). A **baseline was established by stashing the change** and running the same sweep, and the **failure SETS were diffed** — the authoritative check, not the count (a single run is not a stable baseline):

| Run | Failure count |
|---|---|
| clean baseline, run 1 | 72 (outlier) |
| clean baseline, run 2 | **82** |
| clean baseline, run 3 | **82** |
| with the change | **82** |

```
$ comm -13 baseline-fails after-fails     # entries present only after the change
                                           (empty — ZERO new failures)
$ comm -23 baseline-fails after-fails     # entries present only in the baseline
                                           (empty — ZERO masked failures)
```

The failure sets are **byte-identical**. This ACT introduces **no** regression.

### 9.4 One pre-existing assertion was re-anchored

`containment-failure-c10-authority01.cfc10a01.test.ts:774` sliced the C10 barrier block by a **fixed 2400-character width**. The legitimate growth of that block pushed `unresolvedContainmentFailuresForC10.length > 0` out of the window.

The assertion was **re-anchored on the method boundary** — the same technique its **sibling assertion** (line 785, the deferred-re-evaluation check) already used. A boundary-anchored slice is **strictly stronger** than the fixed-width slice it replaces: it covers the whole block instead of an arbitrary prefix. The assertion was **not weakened** — both required substrings are still asserted, plus the classifier-definition and single-comparison contracts are still asserted unchanged.

---

## 10. Files changed

| File | Δ | What |
|---|---|---|
| `apps/vscode/src/sdk/background-job-liveness-authority.ts` | +216 | 3 new record types; `ContainmentOwnershipClass`; `ContainmentOsErrorCode` |
| `apps/vscode/src/sdk/command-job-manager.ts` | +127/−9 | `TerminalPostcondition` / `TerminalPostconditionProbeResult`; errno-bearing probe; `containment_failure_classified` capture |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | +244/−20 | `ContainmentLedgerDetail`; `classifyContainmentOwnershipClass`; classifier out-parameter; blocking-set capture at 4 boundaries |
| `apps/vscode/src/sdk/SdkController.ts` | +29/−1 | `containment_terminal_state_published` capture at the publication seam |
| `apps/vscode/src/sdk/__tests__/containment-ledger-causal-recon01.clcr01.test.ts` | **new (634 lines)** | 20-test recon/RED suite |
| `apps/vscode/src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts` | +17/−1 | boundary-anchored barrier assertion |

**Zero** changes to: `*.proto`, `ExtensionMessage.ts`, the webview, Elm, the TaskHeader, the completion-authority semantics, or the containment-failure clearing behaviour.

---

## 11. Successor

**`ACT-CLINEMM-CONTAINMENT-LEDGER-LIVE-QUALIFICATION01`** — the next useful evidence must come from the **installed** extension against **real** jobs, not another synthetic suite.

1. Commit this bounded recon; establish `DOGFOOD_SOURCE_HEAD`.
2. Build and install a VSIX bound to that exact HEAD; record version, path, bytes, SHA-256.
3. Dogfood normally. On the next containment-related `Paused` occurrence, dump **Background Job Liveness Authority** and **Completion Incident Bundle**.
4. Join C10's `blockingJobIds` against `containment_failure_classified` and `containment_terminal_state_published`; classify each observed job by ownership, postcondition and errno.
5. If the result isolates a causal discrepancy, open a separate repair ACT with RED→GREEN and an ablation. Otherwise close `CAPTURE_INSUFFICIENT`, with the exact missing observation identified.

### 11.1 A qualification carried forward from review

> BJLA uses a **bounded capture ring**. Earlier root-cause records may be **evicted** before a later dump. An unmatched blocking job id must be reported as **missing evidence**, never assumed to be a stale entry. Whether retention needs changing is to be assessed **only after** examining a LIVE capture.

The `containment_ledger_blocking_set` record carries the **denominator** (`totalContainmentFailureEntries`) precisely so a later analysis can distinguish "the root-cause record was evicted" from "the root-cause record was never captured" — the ring's eviction is itself a countable, visible condition rather than a silent absence.

**No new telemetry implementation is justified yet.**
