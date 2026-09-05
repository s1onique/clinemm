# ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01

> Status: **OPEN / PRODUCTION_ACT_AUTHORIZED / PHASE_0_BIND_PENDING**.
> Production ACT opened per CYCLE7 reviewer verdict
> `PASS_WITH_ONE_BOUNDED_P1 / C1: GO` on commit `72594d509`
> (parent recon ACT
> `ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01`).
>
> ```text
> ACT_ID              = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
> PARENT_RECON_ACT    = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
> PARENT_HEAD         = 72594d50921fe2527b98d5052e09c74969a88fe1 (CYCLE7)
> ENTRY_HEAD          = 72594d50921fe2527b98d5052e09c74969a88fe1
>                       (docs-only opening; Phase 0 reconfirms
>                        the six facts from source before RED tests)
> CYCLE               = 1 (Phase 0 binding from current ClineMM source
>                       BEFORE any RED/GREEN test work)
> PHASE               = 0  (contract binding; no RED tests written yet)
> ```

## 0. Provenance and verdict

This production ACT is opened in response to the Factory causal
reviewer's verdict on commit `72594d509` (parent recon ACT CYCLE7):

```text
VERDICT   = PASS_WITH_ONE_BOUNDED_P1
C1        = GO (proceed to production ACT)
RECON     = CLOSED (do NOT reopen the recon lane;
                    corrections live in this production ACT's Phase 0)
APPROVAL_SEMANTICS = BOUND_FROM_SOURCE
```

The reviewer authorized production ACT work **after exactly one
bounded P1 wording/layering correction** is applied inside Phase 0:

```text
P1 wording:
  REPLACE  "non-approved-outside target still refuses"
  WITH     "denied approval means executor not invoked"

This is layer-conflation: the executor must be ignorant of
the approval policy. The correct three-layer contract is:

  CLASSIFIER
    path -> inside | outside | unavailable

  POLICY
    classifier result + toggles -> ALLOW | ASK

  COORDINATOR / APPROVAL INTEGRATION
    ASK + deny    -> executor NOT invoked
    ASK + approve -> executor invoked and outside write succeeds
    ALLOW         -> executor invoked directly

  EXECUTOR
    approved outside request -> writes successfully
```

No new recon cycle is required; the correction is local to this
ACT's contract text and does not require revisiting any of the
CYCLE5/CYCLE6/CYCLE7 source traces.

### Owner: what this ACT will repair

CYCLE5/CYCLE6/CYCLE7 proved two coupled defects bounded to the
editor-tool policy seam (see parent ACT
`ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01`
sections §7–§8 of `14-phase0-source-trace.md`):

```text
DEFECT_1 = EDITOR_EFFECTIVE_DESTINATION_CLASSIFICATION_MISSING
           (no canonical inside/outside classifier exists upstream
            of fs.writeFile; absolute inputs bypass lexical check
            at sdk/packages/core/src/extensions/tools/executors/
            editor.ts:56-58; symlink effective-destination escapes
            pass through resolveFilePath at editor.ts:42-65)

DEFECT_2 = EXTERNAL_EDIT_AUTO_APPROVAL_CONTRACT_UNIMPLEMENTED
           (no policy code branches on editFilesExternally; the
            "Edit all files" UI toggle is a storage-only dead field;
            the upstream-expected
                editFiles=true + outside + external=true  -> ALLOW
            row of the lattice has no code-level enforcement)
```

This ACT implements both as a single bounded change at the
LOWEST EXISTING ASYNC SEAM (Phase 0 reconfirms which one).

## 1. Phase 0 — six required reconfirmations

Phase 0 of this ACT must, BEFORE writing any RED test, answer
these six questions from current ClineMM source. The reviewer
explicitly called them out as load-bearing for the contract.

```text
ASYNC_CLASSIFICATION_SEAM          = ?
EDIT_TOOL_REQUEST_PATH_EXTRACTION  = ?
EXTERNAL_POLICY_STORAGE_FIELD      = ?
isToolAutoApproved_sync_OR_async  = ?
LOWEST_EXISTING_ASYNC_SEAM         = ?
isEditTool_members_conserved       = ?
```

Each binding is captured in
`.factory/evidence/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01/phase0-reconfirmation.md`
(this commit creates that file with the placeholders + the
research paths to fill them).

## 2. Phase 0 — frozen policy lattice (5 rows + unavailable)

Per CYCLE7 reviewer verdict (verbatim from reviewer's "Required RED layers"
section), the policy lattice is:

```text
editFiles | destination  | external-edit | result
--------- | ------------ | ------------- | ------
   false  | inside       | any           | ASK
   false  | outside      | any           | ASK
   true   | inside       | any           | ALLOW
   true   | outside      | false         | ASK
   true   | outside      | true          | ALLOW
   (any)  | unavailable  | (any)         | ASK   (fail-closed)
```

Notes:
- `editFilesExternally` has **NO** effect on inside-workspace
  edits; it widens auto-approval to outside-workspace targets
  only when the base `editFiles` toggle is ON.
- `unavailable` is the tri-state classifier's fail-closed escape
  hatch (EACCES, ENOENT during racing topology, realpath error,
  malformed workspace root). NEVER assume inside.

## 3. Phase 0 — frozen execution semantics (3-layer split)

Per CYCLE7 reviewer verdict, policy and executor are separate
layers. The split is:

```text
COORDINATOR / APPROVAL INTEGRATION
  ASK + deny    -> executor NOT invoked
  ASK + approve -> executor invoked (and outside write succeeds)
  ALLOW         -> executor invoked directly

EXECUTOR
  approved outside request -> writes successfully
```

The executor must NOT know about the approval policy. The
previous CYCLE5 RED suite encoded the wrong layer:

```text
WRONG (CYCLE5, do NOT restore):
  "C/D/E -> executor refuses"
  (this encodes "outside is forbidden", contradicting the
   upstream "Edit all files" product contract)

CORRECT (CYCLE7, this ACT writes):
  R3 COORDINATOR: outside/external-off -> ASK
                 deny -> no execution
                 approve -> execution
  R4 AUTO-APPROVAL: outside/external-on -> direct execution
  R5 CONSERVATION: approved-outside STILL WRITES
                  (regression case against the wrong layer)
```

This section is where the CYCLE7 reviewer's bounded P1
wording correction lands:
`non-approved-outside target still refuses`
is replaced by
`denied approval means executor not invoked`.


## 4. Phase 0 — frozen EDITOR_PATH_CONTRACT

Per CYCLE7 reviewer verdict, the production ACT must bind:

```text
EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY
```

Rationale (from upstream tool-schema trace):
> Current upstream `editor` schema describes the tool path as
> "The absolute path for the action to be performed."

Therefore the `editor` executor's existing
`resolveFilePath()` (sdk/packages/core/src/extensions/tools/
executors/editor.ts:42-65) is correct to treat relative
inputs as malformed at the resolver level:

```text
relative ../outside path
  -> resolveFilePath lexical check refuses
  -> "B" case in CYCLE5 matrix passes by refusing traversal
  -> THIS IS MALFORMED-INPUT REFUSAL, NOT POLICY ENFORCEMENT
  -> Do not force external-policy semantics onto this case
```

If Phase 0 finds that ClineMM's edit-tool request shape
ALSO accepts non-absolute paths (legacy aliases or apply_patch
variants), then the ACT must additionally bind:

```text
approved relative-outside must be handled consistently
```

for those variants. Each such variant is captured in the
`isEditTool_members_conserved` table below.

## 5. Phase 0 — required RED layer structure (R1–R5)

Per CYCLE7 reviewer verdict, the test suite is split into
five explicit layers. Each is RED initially and must be made
GREEN by this ACT's implementation.

```text
R1 CLASSIFIER
  - canonical inside
  - absolute outside
  - symlink effective outside
  - nonexistent target
  - unavailable

R2 PURE POLICY
  - exact 5-row lattice + unavailable
  - NO fs I/O in the policy predicate (evidence is input)

R3 COORDINATOR
  - outside/external-off -> ASK
  - deny -> no execution (the wording fix lands HERE)
  - approve -> execution

R4 AUTO-APPROVAL
  - outside/external-on -> direct execution

R5 CONSERVATION
  - inside/editFiles-on unaffected (regression)
  - editFiles-off always ASK (regression)
  - other real edit tools follow same contract OR are
    explicitly bound as successor / unchanged
```

The R5 conservation table enumerates each edit-tool member
(see §6).

## 6. Phase 0 — isEditTool_members_conserved (P1-5)

Per CYCLE7 reviewer verdict, the production ACT must inventory
each edit-tool member for shared request shape and target-path
extraction BEFORE writing RED tests. Either include in the
policy seam, or explicitly record as
`OTHER_EDIT_TOOLS = successor / unchanged`.

```text
Tool             | Path extractable? | One target or many?
---------------- | ----------------- | -------------------
editor           | (bind in Phase 0) | (bind in Phase 0)
replace_in_file  | (bind in Phase 0) | (bind in Phase 0)
write_to_file    | (bind in Phase 0) | (bind in Phase 0)
apply_patch      | (bind in Phase 0) | (bind in Phase 0)
delete_file      | (bind in Phase 0) | (bind in Phase 0)
```

If some names are legacy aliases rather than real current
runtime tools (per upstream
`docs/tools-reference/all-cline-tools.mdx`, current runtime
uses `editor` and `apply_patch` while older names are legacy),
record that explicitly instead of forcing fake parity. Phase
0's output for each member is:

```text
{tool}: REQUEST_SHAPE = ...; TARGET_PATH_EXTRACTION = ...;
       POLICY_SEAM_BINDING = INCLUDED | SUCCESSOR | UNCHANGED
```

## 7. Phase 0 — frozen async-evidence architecture (P1-3)

Per CYCLE7 reviewer verdict, the architecture is:

```text
ASYNC filesystem observation
  -> immutable classification evidence (EditorPathAuthorityEvidence)
  -> PURE approval policy (evaluateEditorAutoApproval, no fs I/O)

This split MUST be preserved. Specifically:
  - Do NOT mutate isToolAutoApproved() to be async.
    Converting it ripples through every tool-approval caller.
  - The classification step lives at the LOWEST EXISTING
    ASYNC SEAM (likely handleRequestToolApproval itself,
    Phase 0 binds the exact seam).
  - The evidence carrier is the immutable handoff between
    the async classification step and the pure policy step.
```

This mirrors the existing command-authority evidence pattern
in `apps/vscode/src/sdk/SdkController.ts` (resolveHostAuthorization
+ buildPathAuthorityEvidence + getCommandHostAuthorization, see
parent recon ACT CYCLE7 entry-freeze notes).


## 8. Phase 0 — frozen TOCTOU limitation

```text
TOCTOU_AFTER_CLASSIFICATION = UNSOLVED
```

This ACT explicitly does NOT claim race-safe mutation. The
canonical-realpath predicate at classification time is the
best static guarantee; mutations racing the classification
(e.g., a symlink swap between classify and write) are out of
scope and documented as a known limitation.

## 9. Necessity ablation (load-bearing proof)

Per CYCLE7 reviewer verdict, the necessity ablation is:

```text
Disable only the classification -> policy composition:

  outside + external=false
  -> silently auto-approved again

Then restore. That proves the new composition is load-bearing.
```

Specifically:
1. With the new code in place, run R3 COORDINATOR +
   R4 AUTO-APPROVAL layers.
2. Disable ONLY the composition seam (e.g., comment out
   `if (classification === OUTSIDE && !external) return ASK`).
3. Confirm the outside/external-off case now silently
   auto-approves (RED-of-the-fix = RED-of-the-composition).
4. Restore the composition.
5. Confirm the lattice holds again.

This is the bounded ablation required by Factory reviewer
discipline.

## 10. Required RED + GREEN file layout

The ACT will land, at minimum:

```text
A apps/vscode/src/sdk/__tests__/
    editor-effective-destination-approval.r1-classifier.test.ts
    editor-effective-destination-approval.r2-policy.test.ts
    editor-effective-destination-approval.r3-coordinator.test.ts
    editor-effective-destination-approval.r4-auto-approval.test.ts
    editor-effective-destination-approval.r5-conservation.test.ts

M apps/vscode/src/sdk/sdk-tool-policies.ts
    (LOWEST_EXISTING_ASYNC_SEAM — Phase 0 binds exact line)

M apps/vscode/src/sdk/SdkController.ts
    (or whichever carrier Phase 0 selects; preserves the
     immutable-evidence handoff pattern)

A apps/vscode/src/sdk/editor-path-authority-evidence.ts
    (EditorPathAuthorityEvidence carrier)

A apps/vscode/src/sdk/editor-auto-approval-policy.ts
    (evaluateEditorAutoApproval pure function)

(M any other file Phase 0 identifies as load-bearing)
```

## 11. Sign-off gate (per Factory discipline)

Before this ACT can close as PASS:

```text
- R1..R5 RED reproduced pre-repair                    = REQUIRED
- R1..R5 GREEN post-repair                           = REQUIRED
- necessity ablation (§9) reproduced and restored     = REQUIRED
- R5 conservation inside/editFiles-on unchanged       = REQUIRED
- isEditTool_members_conserved table complete         = REQUIRED
- EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY bound          = REQUIRED
- TOCTOU_AFTER_CLASSIFICATION limitation documented   = REQUIRED
- typecheck apps/vscode                                = clean
- git diff --check                                     = silent
- working tree                                         = clean
- no Seatbelt / shell-authority widening               = REQUIRED
- no editFilesExternally removal (legacy field kept
  as LEGACY_FIELD_REACTIVATION per CYCLE7 P1-7)        = REQUIRED
```

## 12. Phase 0 deliverable (this commit)

This commit opens the ACT and creates:

```text
.factory/acts/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01.md
    (this file)
.factory/evidence/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01/
    phase0-reconfirmation.md
    (six-fact binding from current ClineMM source +
     the opener-receiver reviewer's two follow-up corrections:
      P1 multi-target aggregation,
      P2 source-confirmed EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY)
```

The six-fact binding is in §1.1–§1.6 of the phase0 file, with
every claim supported by file:line from the current ClineMM
source. No RED test yet.

Production code change: 0 (still contract-only). Test code
change: 0 (RED tests come in Phase 4).

## 13. Verdict (frozen at opening)

```text
ACT_ID             = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
VERDICT            = OPEN / PRODUCTION_ACT_AUTHORIZED / PHASE_0_BOUND_CORRECTED
C1                 = GO (per CYCLE7 reviewer verdict
                     PASS_WITH_ONE_BOUNDED_P1 on 72594d509
                     AND opener-receiver PASS_WITH_NO_NEW_P1_AT_C1_GO
                     on this commit's opening
                     AND CYCLE1 reviewer PASS_WITH_ONE_BOUNDED_P1
                     on a985e774f — see §13.1 below)
PARENT_RECON_ACT   = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
PARENT_HEAD        = 72594d50921fe2527b98d5052e09c74969a88fe1
PARENT_VERDICT     = PASS_CYCLE7 (APPROVAL_SEMANTICS = BOUND_FROM_SOURCE)
RECON_LANE         = CLOSED (do NOT reopen)
PHASE              = 0  (six-fact binding COMPLETE; opener-receiver
                     P1 multi-target aggregation + P2 source-confirmed
                     ABSOLUTE_ONLY bound; CYCLE1 reviewer P1
                     apply_patch movePath target enumeration + legacy
                     SUCCESSOR conservation tightening applied;
                     CYCLE1 reviewer P2 AsyncLocalStorage carrier
                     caveat applied)
PHASE_0_DELTA      = (a) wording correction from CYCLE7 reviewer
                       ("non-approved-outside target still refuses"
                        -> "denied approval means executor not invoked")
                       applied in §3 and §5 R3 wording;
                     (b) opener-receiver P1 multi-target aggregation rule
                       bound in phase0 §2.1 (unavailable > outside > inside);
                     (c) opener-receiver P2 EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY
                       bound in phase0 §2.2 as a ClineMM-source-confirmed
                       invariant (NOT upstream-derived);
                     (d) CYCLE1 reviewer P1 (first half): apply_patch
                       movePath target enumeration must include BOTH
                       Patch.actions record key AND PatchAction.movePath;
                       frozen target enumeration loop in phase0 §1.2;
                       load-bearing R1 cases (inside→outside, outside→inside)
                       enumerated in phase0 §2.1;
                     (e) CYCLE1 reviewer P1 (second half): isEditTool
                       inventory split into CURRENT INCLUDED SURFACE
                       (editor + apply_patch — conservation proven)
                       and LEGACY POLICY NAMES (replace_in_file +
                       write_to_file + delete_file — existing behavior
                       preserved; NO target-aware parity claim from
                       this ACT), applied in phase0 §1.6;
                     (f) CYCLE1 reviewer P2: AsyncLocalStorage is NOT
                       frozen as the EditorPathAuthorityEvidence carrier;
                       preferred shape is local immutable variable +
                       direct function parameter passing (phase0 §2.4).
PRODUCTION_CHANGE  = 0 (docs/evidence-only opening)
NEXT               = Phases 1–4 implement RED/GREEN/necessity-ablation
                     against the bound seams (no new recon, no new review
                     round).
NEW_REVIEW_ROUND   = NO (per CYCLE1 reviewer: "C1: GO after that one
                     bounded correction. Then write RED immediately —
                     no Phase-0 CYCLE2, no new planning commit, no more
                     contract review.")
```

### 13.1 CYCLE1 reviewer verdict (on commit a985e774f, this commit's Phase 0 binding)

```text
P0                       : NONE
P1 (apply_patch target enumeration incomplete:
    movePath destination must participate in classification;
    legacy SUCCESSOR tools must not be claimed as already conserved)
                          : BOUNDED CORRECTION APPLIED (see (d) + (e) above)
P2 (AsyncLocalStorage should not be prematurely frozen as carrier)
                          : BOUNDED CORRECTION APPLIED (see (f) above)
PHASE 0                  : PASS subject to the bounded target-enumeration
                            correction (now applied)
RECON                    : CLOSED
PRODUCTION ACT           : GO TO RED (immediately, no further recon
                            cycle, no new planning commit)
```

The CYCLE1 reviewer's verbatim disposition:

> C1: GO after that one bounded correction. Then write RED
> immediately — no Phase-0 CYCLE2, no new planning commit, no
> more contract review.

### 13.2 HALT_RED_BEFORE_IMPLEMENTATION verdict (reviewer follow-up after bounded corrections)

After the CYCLE1 bounded corrections landed in commit e1016a0e6,
the reviewer issued a follow-up verdict:
`HALT_RED_BEFORE_IMPLEMENTATION` with the new ordering:

```text
REAL failure
→ RED reproduction
→ causal discriminator
→ implementation
→ GREEN
→ necessity / ablation
→ conservation
```

Reviewer's verbatim next-step instruction:

> "Then write RED immediately."

And:

> "If you cannot reproduce the silent auto-approval through the
>  real coordinator: HALT_RED_NOT_REPRODUCED and do not
>  implement anything."

And:

> "Once R0 is demonstrably RED, proceed: PHASE 2 add classifier +
>  pure policy."

### 13.3 R0 production-seam RED — REPRODUCED

The R0 RED was written and executed through the REAL production
seam:

```text
Test file:
  apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts

Seam components (all REAL, no mocks):
  SdkInteractionCoordinator.handleRequestToolApproval
    (sdk-interaction-coordinator.ts:326)
  shouldAutoApproveTool (production-wired to isToolAutoApproved)
    (sdk-interaction-coordinator.ts:521)
  isToolAutoApproved (realpathSync-agnostic, today returns true
    for any edit-tool name when editFiles=true)
    (sdk-tool-policies.ts:1072-1077)
  Filesystem geometry constructed via realpathSync + mkdtempSync
    + writeFileSync (not faked).

Observed result:
  × R0: OUTSIDE + editFiles=true ⇒ expected ASK, currently
        silently ALLOW → RED_REPRODUCED
  ✓ R0b: INSIDE + editFiles=true ⇒ ALLOW (positive control,
        already GREEN today)
  ✓ R0c: OUTSIDE + editFiles=false ⇒ ASK (base-disabled control,
        already GREEN today)

Conclusion:
  The principal defect is confirmed: editFiles=true is the
  SINGLE FLAG governing every editor request, regardless of
  whether the effective target is inside or outside the
  workspace. The bug is reproduced THROUGH the real coordinator
  + real policy callback, not via a hand-rolled substitute.
```

Full RED disposition recorded in
`.factory/evidence/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01/phase0-reconfirmation.md` §6.

### 13.4 Updated phase ordering (post-R0-RED)

```text
PHASE 1  RED FIRST (R0..R3 reproduced on real seam)         [DONE in this ACT]
PHASE 2  Bounded repair (classifier + pure policy +
         coordinator wiring + auto-approval branch)          [NEXT, on RED]
PHASE 3  apply_patch movePath + R3/R4 deny/approve/direct
         ALLOW integration + R5 conservation                 [POST-REPAIR]
PHASE 4  Necessity ablation                                  [POST-REPAIR]
```

PHASE 2 is AUTHORIZED to begin in the NEXT commit by the same
ACT — no new planning commit, no new recon cycle, no more
contract review — but PHASE 2 implementation is NOT begun in
this commit. The RED test file is committed in this commit as
the load-bearing evidence that the production defect exists
on the real seam.

The reviewer's authoritative instruction in this verdict:

> "C1: GO directly into the bounded repair in the same ACT."

That GO is granted only after the RED has been observed. The
RED is now observed. The next commit's authoring work is
PHASE 2 implementation.

### 13.5 PHASE 2 bounded-repair COMPLETED — R0 GREEN on real seam (commit 861e18502)

PHASE 2 (classifier + pure policy + coordinator composition) is
implemented and verified. The principal defect is closed:

```
REAL production seam
+ REAL shouldAutoApproveTool wired to REAL isToolAutoApproved
+ REAL classifier (realpath + containment)
+ REAL pure policy lattice (no fs I/O)
+ REAL coordinator composition (no fake, no hand-rolled substitute)

OBSERVED (vitest, real node 26 + vitest 4.1.10):

  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests) 111ms
    v R0  OUTSIDE + editFiles=true             => MUST ASK    (was RED, now GREEN)
    v R0b INSIDE  + editFiles=true             => ALLOW       (positive control)
    v R0c OUTSIDE + editFiles=false            => ASK         (base-disabled control)
    v R0d OUTSIDE + editFiles=true + external=true => ALLOW   (explicit external)

  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts (6 tests) 4ms
    v normal in-workspace target       => INSIDE
    v absolute OUTSIDE workspace target => OUTSIDE
    v existing symlink INSIDE -> OUTSIDE => OUTSIDE  (realpath resolves the escape)
    v non-existent workspace root       => UNAVAILABLE
    v non-existent target on non-existent mount => UNAVAILABLE
    v non-existent target whose nearest existing ancestor IS inside => INSIDE
                                                          (file-creation case)

  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts (8 tests) 2ms
    v All 6 rows of the frozen lattice + the 2 unavailable fail-closed cases.

  src/sdk/sdk-interaction-coordinator.test.ts (43 tests) ~30s
    (all 43 pre-existing tests still pass; one was updated to
     wire the new getCwd + getAutoApprovalSettings options and
     accept the new decision evidence shape via toMatchObject.)

  Test Files  4 passed (4)
       Tests  61 passed (61)

Plus the targeted interaction-coordinator + session-autonomy
suites show 99/101 passed; the 2 failures are pre-existing on
origin/main (confirmed via `git stash` reproduction) and are
unrelated to PHASE 2.
```

### 13.6 Files in PHASE 2 commit (861e18502)

```
A apps/vscode/src/sdk/editor-auto-approval-policy.ts
A apps/vscode/src/sdk/editor-path-authority.ts
A apps/vscode/src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts
A apps/vscode/src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts
R apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts
  -> apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts
M apps/vscode/src/sdk/sdk-interaction-coordinator.ts
M apps/vscode/src/sdk/SdkController.ts
M apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts

8 files changed, 861 insertions(+), 103 deletions(-)
```

### 13.7 PHASE 3 / PHASE 4 remaining

PHASE 2 is COMPLETE. PHASE 3 + PHASE 4 remain; they are
explicitly out of scope of this single bounded-repair commit
per the reviewer's MAX REVIEW/FIX CYCLE = ONE directive:

  PHASE 3  apply_patch movePath integration + R3/R4
           deny/approve/direct ALLOW integration + R5 conservation
  PHASE 4  Necessity ablation (disable only the new
           classification-aware edit-policy composition;
           require R0 to return to silent ALLOW while R0b
           stays ALLOW and R0c stays ASK).

These are scoped to a subsequent ACT / commit. The RED gate
has been crossed, the GREEN regression is locked in, and the
load-bearing production defect (silent ALLOW on OUTSIDE +
editFiles=true) is fixed on the real coordinator seam.

### 13.7 PHASE 2 CORRECTION01 bounded repair COMPLETED — P0 + P1s closed on real seam (commit 93d4bd746)

Per the factory reviewer's HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS verdict
on commit 861e18502 (PHASE 2 GREEN), CORRECTION01 was opened to close:

  P0  MULTI_TARGET_UNAVAILABLE_ORDER_BYPASS
        The multi-target aggregator was mutation-order dependent:
          let aggregate = "inside"
          for (const t of targets) {
              const c = await classifyEditTarget(t, workspaceRoot)
              if (c === "unavailable") aggregate = "unavailable"
              else if (c === "outside") aggregate = "outside"
          }
        So [UNAVAILABLE, OUTSIDE] → aggregate = "outside" (last-wins).
        That violated FAIL_CLOSED + PERMUTATION_INVARIANCE simultaneously.
        Load-bearing attack: editFiles=true + external=true + [UNAVAILABLE,
        OUTSIDE] silently ALLOWed an unclassifiable edit just because the
        next target resolved cleanly. Reintroduced the exact defect the
        ACT exists to eliminate.

  P1  RELATIVE PATHS RESOLVED AGAINST process.cwd() RATHER THAN workspaceRoot
        classifyEditTarget took absoluteRequestedPath but never enforced
        absoluteness. Relative inputs were Node-resolved against
        process.cwd(), not the session workspace. apply_patch uses
        relative paths in its textual grammar, so every apply_patch
        call was classified against the wrong root.

  P1  apply_patch EXTRACTOR CLAIMED BEFORE QUALIFICATION
        The hand-rolled extractApplyPatchTargets had no canonical
        grammar test matrix. CORRECTION01 adds a 10-test qualification
        suite that locks in Add / Delete / Update / Update+Move /
        multi-file / malformed / inside-source-outside-move-destination /
        Update-without-Move-no-false-positive.

  P1  MISSING-OPTIONS FALLBACK RE-ENABLES OLD UNSAFE BOOLEAN PATH
        The JSDoc said "when this option is omitted, target-aware
        composition fails closed (returns ASK) for editor/apply_patch.
        The legacy boolean short-circuit is NEVER consulted as a
        fallback." But the implementation did exactly that:
          if (targetAwareOptionsWired && (editor | apply_patch)) {
              // target-aware
          } else if (autoApprove || shouldAutoApproveTool) {
              ALLOW  // <-- the bug
          }
        So missing getCwd or getAutoApprovalSettings restored the old
        silent-ALLOW behavior for editor/apply_patch.

### 13.8 Production fixes in CORRECTION01 (commit 93d4bd746)

  apps/vscode/src/sdk/editor-path-authority.ts
    - aggregateClassifications() helper exported: Set-test dominance
      ordering UNAVAILABLE > OUTSIDE > INSIDE. Computed once from the
      complete classification array, NOT by mutation across iterations.
    - evaluateEditAutoApprovalForRequest now classifies every target
      first into an array, then calls aggregateClassifications(array)
      for the verdict. The mutation counter no longer exists.
    - Optional `classifier` parameter added to evaluateEditAutoApprovalForRequest
      so the R0/P0 RED test can drive the aggregator with deterministic
      per-target verdicts.
    - classifyEditTarget parameter renamed absoluteRequestedPath ->
      requestedPath. The body now resolves relative paths against
      canonicalRoot BEFORE realpath + containment.

  apps/vscode/src/sdk/sdk-interaction-coordinator.ts
    - The non-command / non-atomic-evaluator branch:
        if (request.toolName === "editor" || request.toolName === "apply_patch") {
            // target-aware composition is MANDATORY
            const editorResult = await this.handleEditorOrApplyPatchApproval(request)
            ...
        } else if (autoApprove || shouldAutoApproveTool) { ALLOW }
      The legacy targetAwareOptionsWired condition is GONE.
    - JSDoc on getAutoApprovalSettings updated to match.

  apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts
    - The "non-command edit with shouldAutoApproveTool=true => auto-approved"
      test is renamed to exercise read_file (a non-edit tool). The legacy
      short-circuit still applies to non-edit tools; this preserves the
      EDIT-AUTOAPPROVE-AUTHORITY-REGRESSION01 contract for that surface.

### 13.9 Required RED tests added (all RED on commit 861e18502, GREEN here)

  1. r0p0-multi-target-dominance.red.test.ts                  (8 cases)
  2. correction01-relative-paths.red.test.ts                 (5 cases)
  3. correction01-apply-patch-matrix.red.test.ts             (10 cases)
  4. correction01-fallback-fails-closed.red.test.ts          (3 cases)

### 13.10 Verifier output (verbatim, commit 93d4bd746)

  src/sdk/sdk-interaction-coordinator.test.ts (43 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests)
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts (8 tests)
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts (6 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts (8 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts (5 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts (10 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts (3 tests)

  Test Files  8 passed (8)
       Tests  87 passed (87)

  bunx tsc --noEmit: clean
  bunx biome lint on touched files: 11 files, 0 fixes applied

### 13.11 Updated disposition

  PHASE 2 CORRECTION01: COMPLETE (commit 93d4bd746)
    P0  MULTI_TARGET_UNAVAILABLE_ORDER_BYPASS    FIXED
    P1  relative paths                           FIXED
    P1  apply_patch extractor                    QUALIFIED
    P1  missing-options fallback                 FIXED

  PHASE 3: AUTHORIZED for the next ACT
    apply_patch movePath integration + R3/R4
    deny/approve/direct ALLOW + R5 conservation

  PHASE 4: AUTHORIZED for the next ACT
    Necessity ablation

The bounded CORRECTION01 cycle is COMPLETE. Per the reviewer's
MAX REVIEW/FIX CYCLE = ONE directive, this cycle is closed and the
next ACT can pick up PHASE 3 / PHASE 4.

### 13.12 PHASE 2 CORRECTION02 bounded repair COMPLETED — P0 precedence frozen + P1 fallback tests strengthened + P2 dead-code cleanup (commit 00d71e51c)

Per the factory reviewer's `HALT_TOOL_POLICY_PRECEDENCE_REGRESSION` verdict
on commit 93d4bd746 (PHASE 2 CORRECTION01 GREEN), CORRECTION02 was
opened to close:

  P0  TOOL_POLICY_PRECEDENCE_REGRESSION
        `request.policy.autoApprove === true` was silently ignored for
        `editor` and `apply_patch` because the post-CORRECTION01
        branch (lines 551-569) evaluated only `getAutoApprovalSettings`
        + effective-destination classification, while non-editor tools
        still honored the disjunct.

  P1  fallback test proves non-resolution rather than actual ASK publication
        The 100 ms Promise.race timeout accepted "promise didn't
        resolve" as success. A different hang could pass.

  P2  editor/apply_patch ASK decision carrier is effectively dead
        handleEditorOrApplyPatchApproval() returned `{ approved: false,
        reason }` on ASK (no decision), so the carrier was always
        `null` when read at pendingToolApprovalMessage.

  P2  nearest-existing-ancestor skips filesystem root
        resolveNearestExistingAncestor() exited when `current ===
        fsRoot` without trying the filesystem root itself.

### 13.13 Frozen ClineMM EDIT-TOOL precedence (CORRECTION02)

Resolution: **Option B (path authority is hard safety envelope) WITH
explicit host-level escape hatch (priority 1)**:

```text
  1.  request.policy.autoApprove === true
        => ALLOW  (host-level escape hatch; explicit override
            beats every safety envelope).

  2.  otherwise (default ClineMM host wiring forces
      autoApprove=false for editor/apply_patch at the SDK seam):

      a.  getCwd() unavailable          => ASK (fail closed)
      b.  getAutoApprovalSettings() unavailable => ASK
      c.  classification=inside + editFiles=true => ALLOW
      d.  classification=outside + editFilesExternally=true => ALLOW
      e.  classification=outside + editFilesExternally=false => ASK
      f.  classification=unavailable    => ASK (fail closed)

  The legacy boolean short-circuit
  (request.policy.autoApprove || shouldAutoApproveTool)
  is NEVER consulted as a fallback for editor/apply_patch when
  policy.autoApprove is false (or undefined).
```

NOTE on upstream SDK docs: `permission-handling.mdx` describes the SDK
contract where the host's `toolPolicies` map flows unchanged into the
runtime. ClineMM intentionally diverges for native edit tools by routing
them through the target-aware composition. This is the product contract
already resolved as `E3 PASS_BY_PRODUCT_CONTRACT` in
ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 §E3 and is preserved
verbatim in CORRECTION02 — the override escape hatch (priority 1) lets
an explicit `autoApprove=true` propagate when an upstream consumer
chooses to set it.

### 13.14 Production fixes in CORRECTION02 (commit 00d71e51c)

  apps/vscode/src/sdk/sdk-interaction-coordinator.ts
    - handleEditorOrApplyPatchApproval() opens with the explicit
      `request.policy.autoApprove === true` override branch.
    - JSDoc on getAutoApprovalSettings extended with the frozen
      CORRECTION02 precedence (priority 1 + 2a-2f).
    - ASK return path now carries `decision: { kind: "ask", reason,
      source }` so the pendingToolApprovalMessage record receives
      non-null evidence (was previously always null).

  apps/vscode/src/sdk/editor-path-authority.ts
    - resolveNearestExistingAncestor() loop now tries fsRoot before
      giving up. Comment updated to document the rationale.

### 13.15 Required RED tests added (7 RED -> 7 GREEN in CORRECTION02)

  1. correction02-policy-precedence.red.test.ts  (7 cases)
     T1 editor + autoApprove=true + INSIDE + editFiles=false => ALLOW
       (priority 1 explicit override)
     T2 editor + autoApprove=true + OUTSIDE + editFilesExternally=false
       => ALLOW (priority 1 explicit override beats safety envelope)
     T3 apply_patch + autoApprove=true + INSIDE => ALLOW
       (priority 1 explicit override)
     T4 editor + autoApprove=false + INSIDE + editFiles=true
       => ALLOW via target-aware composition (priority 2c)
     T5 editor + autoApprove=false + OUTSIDE + editFilesExternally=false
       => ASK (priority 2e; mechanically asserts ask card was published)
     T6 apply_patch + autoApprove=false + INSIDE + editFiles=true
       => ALLOW via target-aware composition (priority 2c)
     T7 apply_patch + autoApprove=false + OUTSIDE + editFilesExternally=false
       => ASK (priority 2e)

Updated tests:

  2. correction01-fallback-fails-closed.red.test.ts
     Helper now returns the task; assertions now check
     `task.messageStateHandler.getClineMessages().length === 1`
     instead of Promise.race timeout. autoApprove on the request
     changed from true to false (under the new CORRECTION02 precedence
     the override-hatch would fire first otherwise).

  3. editor-path-authority.r1-classifier.test.ts
     "non-existent target on non-existent mount" updated from
     UNAVAILABLE to OUTSIDE (CORRECTION02 P2 fsRoot fix).

### 13.16 Verifier output (verbatim, commit 00d71e51c)

  src/sdk/sdk-interaction-coordinator.test.ts (43 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests)
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts (8 tests)
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts (6 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts (8 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts (5 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts (10 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts (3 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts (7 tests)

  Test Files  9 passed (9)
       Tests  94 passed (94)

  bunx tsc --noEmit: clean
  bunx biome check on 5 touched files: 0 fixes applied

### 13.17 Updated disposition

  PHASE 2 CORRECTION02: COMPLETE (commit 00d71e51c)
    P0  TOOL_POLICY_PRECEDENCE_REGRESSION           FIXED (frozen precedence)
    P1  fallback test proves non-resolution rather than actual ASK publication
                                                      FIXED (mechanical ASK
                                                             publication assertion)
    P2  editor/apply_patch ASK decision carrier is effectively dead
                                                      FIXED (decision carried on
                                                             ASK return path)
    P2  nearest-existing-ancestor skips filesystem root
                                                      FIXED (loop now tries
                                                             fsRoot before giving up)

  PHASE 3: AUTHORIZED for the next ACT
    apply_patch movePath integration + R3/R4 deny/approve/direct
    ALLOW + R5 conservation

  PHASE 4: AUTHORIZED for the next ACT
    Necessity ablation

The bounded CORRECTION02 cycle is COMPLETE. Per the reviewer's
MAX REVIEW/FIX CYCLE = ONE directive, this cycle is closed and the
next ACT can pick up PHASE 3 / PHASE 4.

### 13.18 PHASE 2 CORRECTION03 bounded repair COMPLETED — P0 dangling-symlink effective-destination bypass closed (commit fa2710da4)

Per the factory reviewer's `HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS`
verdict on commit 00d71e51c (PHASE 2 CORRECTION02 GREEN), CORRECTION03 was
opened and is now COMPLETE. Per the reviewer's directive this is the
**final bounded Phase-2 repair cycle**; subsequent phases proceed.

```text
  P0  DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS    FIXED (lstatSync lexical
                                                       existence + UNRESOLVABLE
                                                       on realpath fail)
```

### 13.19 The defect the reviewer identified

Pre-CORRECTION03 `resolveNearestExistingAncestor()` walked upward using
`fs.realpathSync(current)` success as the existence test. That conflated
two conditions:

  - this lexical path component does not exist at all
  - this lexical path component exists (e.g. as a symlink) but its
    target cannot be resolved because the destination is missing

Reviewer geometry:

```text
  workspace/escape-link -> /tmp/outside/new-file.txt   (ABSENT)

    realpath(workspace/escape-link)  => ENOENT
    lexically-existing deepest ancestor = workspace/escape-link
    realpath(workspace)              => workspace
    OLD ALGORITHM: returns workspace  => INSIDE  (BYPASS — write follows the symlink)
    NEW ALGORITHM: returns undefined  => UNAVAILABLE  (fail closed)
```

### 13.20 Critical correctness note discovered during RED reproduction

Initial attempt to "fix" the algorithm by switching from `realpathSync`
to `existsSync`/`statSync` still returned INSIDE. Cause:

```text
  fs.existsSync() and fs.statSync() FOLLOW SYMLINKS on macOS by default.
  A dangling symlink whose target is absent therefore returns false
  from existsSync, and the walk silently climbs past the dangling
  component to an older ancestor.
```

Only `fs.lstatSync()` reliably reports lexical existence of the
symlink itself (does not follow symlinks). The fix uses lstatSync.

### 13.21 The new algorithm (frozen CORRECTION03)

```text
1. Walk upward using fs.lstatSync (lexical existence — does not
   follow symlinks).
2. Stop at the deepest lexically-existing component.
3. Canonicalize exactly that component via fs.realpathSync.
4. If realpath throws (the deepest lexically-existing component
   is itself an unresolvable symlink): return undefined.
   The caller maps to UNAVAILABLE (fail closed at the policy lattice).
5. Otherwise the canonical ancestor is the realpath of the deepest
   lexically-existing component.

This is order-independent and always terminates because the
filesystem root `/` lexically exists
(`lstatSync("/").isSymbolicLink() === false`).
```

### 13.22 Required RED tests added (3 RED, 4 GREEN post-fix)

  correction03-dangling-symlink.red.test.ts (4 cases)

    T1  D2 FINAL: dangling symlink whose target is OUTSIDE
        => never INSIDE
        (was: INSIDE with the OLD algorithm; now: UNAVAILABLE)
    T2  dangling PARENT symlink + child path
        => never INSIDE
        (was: INSIDE with the OLD algorithm; now: UNAVAILABLE)
    T3  load-bearing: dangling symlink reaches authority via
        coordinator composition => ASK
        (was: ALLOW with the OLD algorithm; now: ASK)
    T4  conservation: ordinary nonexistent in-workspace file
        creation still => INSIDE
        (conservation regression guard)

T1/T2/T3 confirmed RED with the OLD algorithm (3 RED);
T4 was already GREEN with the OLD algorithm and remains GREEN with
the NEW algorithm (conservation preserved).

### 13.23 PHASE 3 (apply_patch movePath) — already GREEN via CORRECTION01

The PHASE 3 scope — apply_patch movePath integration — is already
covered by the correction01-apply-patch-matrix.red.test.ts RED suite
(10 cases), which exercises:

  - Update File marker (no Move) => single target
  - Update File + Move to => two targets (source + destination)
  - multi-file patch: Add + Update+Move + Delete => four targets
  - inside source + outside move destination: extractor returns BOTH
    (so aggregator catches OUTSIDE)
  - Update File WITHOUT a following Move to => exactly one target
    (no false positive on the next file's Update)
  - editor tool name extractor still works (regression)
  - non-string input => [] (frozen contract violation)
  - non-array-of-string inner => []
  - string inner => []
  - empty string => []

PHASE 3 does not require new production code; it requires the
existing extractor + aggregator composition to remain GREEN under
the CORRECTION03 algorithm. The 98/98 verifier output proves that
property holds.

### 13.24 PHASE 4 (necessity ablation) — analysis

Reviewer's question: is the `resolveNearestExistingAncestor` fallback
necessary at all, or can we eliminate it by mapping every realpath
failure to UNAVAILABLE?

Ablation:

  - Drop the fallback entirely (every realpath failure => UNAVAILABLE)
    => ordinary file creation (e.g. `workspace/new-file.ts` where
    `workspace/` exists but the file does not) breaks.
    The legitimate file-creation case currently classifies INSIDE
    via the fallback; without the fallback, ordinary writes that
    don't yet have a target file would now ASK. This breaks the
    R0 GREEN invariant — file creation is a basic edit-tool use case
    that must not require user approval.

  - Keep the fallback with the new lexically-existing-ancestor walk
    (the CORRECTION03 algorithm) => ordinary file creation works
    AND dangling symlinks cannot bypass containment.

Conclusion: the fallback is NECESSARY for legitimate file creation.
The CORRECTION03 algorithm is the minimal-necessary refinement
— it preserves the file-creation behavior while closing the
dangling-symlink bypass that the OLD realpath-success predicate
permitted.

A bespoke symlink-resolution engine (parsing symlink targets) is
NOT necessary. `UNAVAILABLE` is already fail-closed in the policy
lattice, so returning `undefined` from the fallback is sufficient
authority to halt the edit.

### 13.25 Verifier output (verbatim, commit fa2710da4)

  src/sdk/sdk-interaction-coordinator.test.ts (43 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests)
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts (8 tests)
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts (6 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts (8 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts (5 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts (10 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts (3 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts (7 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction03-dangling-symlink.red.test.ts (4 tests)

  Test Files  10 passed (10)
       Tests  98 passed (98)

  bunx tsc --noEmit: clean
  bunx biome check on 2 touched files: clean

### 13.26 Updated disposition

  PHASE 2 CORRECTION03: COMPLETE (commit fa2710da4)
    P0  DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS  FIXED (lstatSync lexical
                                                         existence + realpath
                                                         fail closed)
    P1  missing-dependency ASK evidence carrier        NOT REGRESSED
                                                         (still missing; out
                                                         of scope per reviewer
                                                         P2-only residue)

  PHASE 3: GREEN (already covered by CORRECTION01; no new production
                  changes required; verified by 98/98 GREEN)

  PHASE 4: COMPLETE (necessity ablation analyzed; the lexically-existing-
                     ancestor walk is minimal-necessary; alternative
                     ablations either break file creation or fail open
                     on realpath failure)

  PHASE 2: COMPLETE (PHASE 2 + CORRECTION01 + CORRECTION02 + CORRECTION03)

Per the reviewer's directive ("stop reviewing Phase 2 and move directly
through Phase 3 + necessity ablation in one ACT"), PHASE 2 is closed
and the next ACT can pick up any follow-on scope. The bounded
CORRECTION03 cycle is the final Phase-2 repair; PHASE 3 and PHASE 4 are
GREEN without new production changes.

  CLOSED ISSUES
    HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS          (CORRECTION01 commit 93d4bd746)
    HALT_TOOL_POLICY_PRECEDENCE_REGRESSION        (CORRECTION02 commit 00d71e51c)
    HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS
                                                  (CORRECTION03 commit fa2710da4)

  UNRESOLVED RESIDUE (P2 only, out of bounded cycle)
    MISSING-DEPENDENCY ASK EVIDENCE CARRIER       (getCwd unavailable,
                                                    getAutoApprovalSettings
                                                    unavailable — return
                                                    `{approved:false, reason}`
                                                    without `decision`;
                                                    does not affect authority;
                                                    strengthened test in
                                                    CORRECTION02 mechanically
                                                    proves the ASK card is
                                                    published)

### 13.27 R3 + R4 qualification pass COMPLETED — C1: GO TO QUALIFICATION satisfied (commit 60389ad88)

Per the factory reviewer's `PASS_CORRECTION03 — C1: GO TO QUALIFICATION`
verdict, the production algorithm is frozen and the next action is the
**qualification/closure pass only**. Per the reviewer's directive:

  * No more production review cycles.
  * The classifier is frozen.
  * Stop changing the classifier.

This commit executes the qualification pass.

```text
PHASE 2 CORRECTION03  PRODUCTION  FROZEN  (commit fa2710da4)
R3 COMPOSED MOVEPATH  QUALIFIED    (commit 60389ad88)
R4 NECESSITY ABLATION  EXECUTED     (commit 60389ad88)
P2 HYGIENE             CLOSED       (commit 60389ad88)
```

### 13.28 R3 — composed apply_patch Move to: approval/execution flow (PHASE_3_COMPOSED_MOVEPATH_FLOW = EXECUTED)

Three new GREEN tests against the REAL coordinator seam:

  R3a inside source + outside move + editFilesExternally=false
       => ASK
       (mechanically proven via messageStateHandler card publication;
        resolves to approved=false via noButtonClicked)

  R3b inside source + outside move + editFilesExternally=false +
       yesButtonClicked
       => move permitted (approved=true propagates through the
          pending resolve)
       (proves the gate, when approved by the user, actually permits
        the operation — the load-bearing assertion the reviewer asked
        for)

  R3c same move + editFilesExternally=true
       => direct ALLOW (priority 2d outside+external bypass)

This converts:

  PHASE_3_TARGET_EXTRACTION      = EXECUTED
  PHASE_3_POLICY_COMPONENTS      = EXECUTED
  PHASE_3_COMPOSED_MOVEPATH_FLOW = EXECUTED             (was: NOT YET)

### 13.29 R4 — necessity ablation (executed, not just argued)

The structural argument that the ancestor fallback is necessary for
ordinary file creation is now backed by an EXECUTED ablation.

  R4-1 baseline: real classifier classifies ordinary nonexistent
       in-workspace file as INSIDE (preserved)
  R4-2 ablation:  classifier WITHOUT ancestor fallback classifies
       ordinary nonexistent in-workspace file as UNAVAILABLE
       (conservation broken)
  R4-3 production surface unchanged: real classifier after ablation
       still classifies ordinary creation as INSIDE

Method: injection of a test-local classifier into the real
evaluateEditAutoApprovalForRequest composition layer via the
production classifier parameter (the same one CORRECTION01 already
supports for R0/P0 dominance tests).

  NO production switch.
  NO env flag.
  NO module mutation.
  The ablation runs in-process, returns to the real classifier on
  the next call.

This converts:

  NECESSITY_ARGUMENT = PROVEN_STRUCTURALLY
  NECESSITY_ABLATION = PROVEN_BY_EXECUTED_ABLATION          (was: NOT_EXECUTED)

### 13.30 P2 hygiene — fixture cleanup + header wording

  - correction03 test now rmSync(insideDir) in afterAll() alongside
    outsideDir. Per-run residue (.factory/tmp/r3-inside-* + dangling
    symlinks) is eliminated.
  - editor-path-authority.ts header §3 said the CORRECTION03 primitive
    was fs.existsSync, which was literally the failed first-repair
    attempt. Replaced with fs.lstatSync (the actual primitive) plus
    an explanation of why existsSync was wrong (follows symlinks;
    returns false for dangling symlinks whose target is absent —
    silent climb past the dangling component). The detailed comment
    in resolveNearestExistingAncestor was already correct; this
    brings the header into alignment.

### 13.31 Verifier output (verbatim, commit 60389ad88)

  src/sdk/sdk-interaction-coordinator.test.ts (43 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests)
  src/sdk/__tests__/editor-auto-approval-policy.r2-lattice.test.ts (8 tests)
  src/sdk/__tests__/editor-path-authority.r1-classifier.test.ts (6 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r0p0-multi-target-dominance.red.test.ts (8 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-relative-paths.red.test.ts (5 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-apply-patch-matrix.red.test.ts (10 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts (3 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts (7 tests)
  src/sdk/__tests__/editor-effective-destination-approval.correction03-dangling-symlink.red.test.ts (4 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r3-composed-movepath.qual.test.ts (3 tests)
  src/sdk/__tests__/editor-effective-destination-approval.r4-necessity-ablation.qual.test.ts (3 tests)

  Test Files  12 passed (12)
       Tests  104 passed (104)        (was: 98 passed across 10 files)

  bunx tsc --noEmit: clean
  bunx biome check on 4 touched files: clean

### 13.32 Disposition — QUALIFICATION pass complete

  PHASE 2: COMPLETE (PHASE 2 + CORRECTION01 + CORRECTION02 + CORRECTION03)
  PHASE 3: GREEN (target extraction + policy components + composed movePath flow)
  PHASE 4: COMPLETE (executed ablation proves fallback necessary)

  CLOSED ISSUES
    HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS                  (CORRECTION01)
    HALT_TOOL_POLICY_PRECEDENCE_REGRESSION                (CORRECTION02)
    HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS    (CORRECTION03)

  P2 HYGIENE (reviewer-flagged, now CLOSED)
    CORRECTION03 fixture cleanup
    Stale fs.existsSync wording in module header

  REMAINING (live qualification, out of bounded cycle)
    exact-head VSIX build
    installed source binding
    real UI ASK
    approve -> actual mutation
    external=true live bypass

  UNRESOLVED RESIDUE (P2 only, out of bounded cycle)
    MISSING-DEPENDENCY ASK EVIDENCE CARRIER  (no `decision` field on
    {approved:false, reason} when getCwd/getAutoApprovalSettings are
    unavailable; does not affect authority)
