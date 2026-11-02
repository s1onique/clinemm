# Repair-or-No-Change Decision — C4

Subject HEAD: `eab87e94759deb483571904b7943e6ad53f9e42b`

## 1. Decision

**`PASS_NO_CHANGE_NEEDED`**

**PRODUCTION DELTA: ZERO.**  No production source file was created, modified or
deleted by this ACT.  `git status --porcelain=v1 --untracked-files=all` is empty
apart from this ACT's own evidence directory.

The C4 gate is conditional:
> *If C2/C3 finds no reproducible production-seam difference, make no production
> change and close PASS_NO_CHANGE_NEEDED, with concrete source and conservation
> evidence.*

C2 found **no** `OBSERVED_REGRESSION` in any of the four domains.  C3 executed
**~40 distinct gates** across all seven required behavioural-matrix rows and
found **no** reproducible production-seam difference.  Therefore the conditional
applies and no production change was made.

## 2. What was actually looked for (and NOT found)

The ACT's purpose was to find a *reproducibly broken seam* at the merged head.
The candidate seams, and what happened to each:

| Candidate hypothesis | How it was tested | Outcome |
|---|---|---|
| The merge weakened the fork's C9/C10 completion authority | Read the merged `sdk-session-event-coordinator.ts` diff (upstream delta = **1 additive line**, no completion/marker/authority path touched); ran the 51-case H03 contract, the 39-case C9/C10 suites, the 12-case first-seam suites; rebuilt all 5 Elm kernels and re-ran all 4 Elm test suites | **NOT REPRODUCED.** Authority conserved; only upstream cloud-session plumbing added; Elm tree byte-identical |
| Upstream's `portable-reasoning` rewrite replaced the fork's native-option guard, changing MiniMax M3 None/low wire behaviour | Read `portable-reasoning.ts:71-113, 190-238`; ran all 6 MiniMax witness files (8/4/3/6/7/9) + `provider-options` 149/149 + `reasoning-options` 10/10 | **NOT REPRODUCED.** The fork guard is retained and *runs first*; the upstream model-facts adaptation is composed on top, not substituted |
| The merge changed the exact MiniMax-M3.1-Flash wire id or dropped the effort ladder | Read `minimax-thinking.ts:50-73` (byte-identical to the fork); ran `minimax-m31-exact-id-wire01` = **8/8** | **NOT REPRODUCED.** Exact capitalised id + `low\|medium\|high\|xhigh\|max` ladder intact |
| The merge silently widened the native editor's realpath / approval boundary | Ran `editor.realpath-authority.test.ts` -> **3 failed (C/D/E) / 4 passed (A/B/F/H)** — the exact declared baseline; ran 34 approval-scope witnesses GREEN | **NOT REPRODUCED.** No widening |
| The merge broke the BCB automatic continuation (stale "Resume Task") | Ran `test:vitest:b2po01` -> **9/9**; ran the 5 BCB01 files -> **38/38**; ran `ptwcr01c01` -> **10/10** | **NOT REPRODUCED** |
| The merge introduced a React functional-updater side effect | Read the upstream `ExtensionStateContext.tsx` delta line by line; ran the purity probe **5/5**, updater-purity **2/2**, committed-witness **1/1** | **NOT REPRODUCED.** The only removed block was a *subscription*; the only added expression is evaluated at request-time, before the setter call |
| The merge let a task switch resurrect an older task or leak settings | Ran `sdk-task-control-coordinator` 24/24, `auto-approve-overlay-regression` 3/3, `session-auto-approval.controller` 10/10 | **NOT REPRODUCED** |
| Upstream's Hub remote-event filter reduced ClineMM trace coverage | Verified the merged `hub-client-contributions.ts` is **byte-identical to upstream head** and that both filter commits are ancestors; re-ran the 4/4 core and 2/2 agents cardinality discriminators | **NOT REPRODUCED.** No new causal counterexample; the optimisation stays intact |
| The merge duplicated native edits / approvals / terminal outcomes on retry or compaction | Ran compaction 112/112 + 1/1 + 3/3, pending-prompt 15/15, edit-workspace-effect-trace 12/12, edit-efficiency-trace 19/19 | **NOT REPRODUCED** |
| The merge changed `@cline/core` diagnostic identity | Ran the typecheck in BOTH trees and diffed by normalized (file, code, message) | **NOT REPRODUCED as a production regression** — ADDED=3 all inside a prior-ACT-added *test* file, REMOVED=0 |

## 3. Pre-existing failures encountered — all classified, none ACT-owned

Every non-green result was A/B'd against the fork baseline `265044bf3` and, where
the production seam changed, compared **failure-mode identity** (not just counts
and not just test names) via JSON reporters.

| Witness | Merged | Fork baseline | Classification |
|---|---|---|---|
| `editor.realpath-authority.test.ts` | 3 failed / 4 passed | 3 failed / 4 passed | **PRE-EXISTING BY DESIGN** — the file's own header declares C/D/E the intentional load-bearing RED; file byte-identical |
| `local-runtime-host.test.ts` | 1 failed / 101 passed | 1 failed / 84 passed | **PRE-EXISTING (F3)** — same test name, same assertion; upstream added 17 passing tests |
| `sdk-session-event-coordinator.test.ts` | 2 failed / 131 passed | 2 failed / 27 passed | **PRE-EXISTING** — same 2 names, **identical assertion messages** (`SAME-FAIL` ×2) |
| `showtask-withid-...showtask01.test.ts` | 5 failed / 4 passed | 5 failed / 4 passed | **PRE-EXISTING declared RED** — 9/9 cases SAME status AND SAME message |
| `completion-continuation-control` (Elm) | 39 pass / 2 fail | 39 pass / 2 fail | **PRE-EXISTING fork-parity RED** — same labels, same expected/actual values |

**ACT-owned failures: 0.**

## 4. Why no repair was attempted (and why a repair would have been wrong)

The ACT's P0-reject list is explicit:
> *A proposed repair that disables provider retry globally, replaces Elm with a
> React decision, bypasses realpath, deletes fork trace fields, or rewrites
> shared agent.ts wholesale is a P0 REJECT.*

Every one of those would have been the **wrong** repair here:

* the upstream Hub filter is **already** the upstream file, byte-for-byte, and no
  ClineMM coverage is lost — "restoring" anything would delete upstream's
  optimisation without cause;
* the Elm authority is **already** byte-identical — re-projecting it would be a
  no-op at best;
* the realpath RED is **already** exactly 3/4 — "fixing" it would WIDEN the
  editor's reach and destroy a deliberate safety witness;
* the fork's native-option guard is **already** retained — replacing it with
  upstream's model-facts semantics would change MiniMax M3 None/low wire
  behaviour, i.e. the exact regression the fork-authority map forbids;
* the fork's trace fields are **already** present and the hub filter is provably
  disjoint from the recorder.

There was also **no observable to repair against**: without a RED, any change
would have been a speculative rewrite of a seam that the evidence says is
conserved.  Per the brief, *"Do not implement unrelated upstream enhancements
for volume."*

**Therefore: no production change.  PASS_NO_CHANGE_NEEDED.**

## 5. Rejected-as-obsolete candidates (recorded so they are not re-litigated)

* **The upstream `onRelinquishControl` removal.**  A textual difference from the
  fork, but upstream commit `93e5e455e` removed the whole feature (proto RPC +
  server handler + webview subscription) because its only sender was already
  dead.  A repository-wide grep confirms **no orphan**.  Re-adding it would

## 6. Live qualification status — honest statement

| Contract | Status |
|---|---|
| Installed VS Code dogfood UI | **LIVE_UNOBSERVABLE** — VSIX built and packaged, **NOT installed**, no UI claim |
| Real MiniMax / Strata provider turn | **NOT_EXECUTED** — no credential; all MiniMax evidence is **offline wire/catalog** |
| Live Hub CLI end-to-end | **NOT_EXECUTED** — no live hub daemon |
| Hub cross-client attach (live) | **NOT_EXECUTED** |

These remain with **U04** (`ACT-CLINEMM-UPSTREAM-EXACT-HEAD-QUALIFICATION01`).
**An unexecuted live gate is not a structural failure and is not a PASS.**
This ACT's verdict is scoped to the *structural* production seam, and it does
not promote any LIVE_UNOBSERVABLE / NOT_EXECUTED item.

## 7. C7 closure facts

* Expected parent / current SUBJECT_HEAD: entry and exit HEAD are both
  `eab87e94759deb483571904b7943e6ad53f9e42b`.  The merge
  `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a` is unchanged.
* Changed-file identities in production: **NONE**.  The only files this ACT
  adds are its own evidence artifacts under
  `.factory/evidence/ACT-CLINEMM-UPSTREAM-VSCODE-PROVIDER-RECONCILE01/` plus
  the durable board row in `.factory/epic-board.md`.
* `main` unchanged (`265044bf3`), `origin/main` unchanged, both protected
  stashes intact, **no push**, **no install**, **no reset/rebase/re-merge**,
  **no branch created**, `bun.lock` unmodified.

## 8. Residual carried forward (non-blocking, for U04)

1. The `@cline/core` typecheck remains RED at 40 diagnostics, all in `*.test.ts`,
   3 of which are inside the previous ACT's own discriminator witness.  This is a
   **test-only** baseline condition, identical in kind to the accepted 37.
   U04 will re-run it at the exact head it qualifies.
2. The five "intentional RED / pre-existing" witnesses listed in §3 remain RED
   by design at this head.  U04 must not treat them as regressions.
3. The U02 gate-tally P1 (29 = 26 + 3, not 30 = 28 + 2) is **reconciled and
   recorded** in `u02-gate-tally-reconciliation.md`.  It is an
   evidence-accounting defect in a prior artifact; it does not change any
   observed result and does not block U04.

  resurrect dead code.  **NOT_APPLICABLE.**
* **Upstream cloud-session / cloud-task UI features.**  Additive; no fork
  authority to conserve.  **NOT_APPLICABLE.**
* **The 3 added `@cline/core` typecheck diagnostics.**  They live in a
  *test file the previous ACT added*, at this ACT's own HEAD.  Fixing them
  would mean editing another ACT's evidence witness — explicitly forbidden by
  this ACT's C0/C6 ("edit another ACT's immutable evidence").  They are
  recorded and attributed, not repaired.  **NOT_APPLICABLE.**


**No RED was reproduced against the merged production seam.**  Under the ACT's
own rule, a hypothesis that cannot be reproduced as a real/prod-seam failure is
**NOT_REPRODUCED**, and production must be left untouched.  That is what happened.
