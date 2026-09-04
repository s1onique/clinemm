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
