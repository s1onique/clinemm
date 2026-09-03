# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 13-final-report

```text
ACT_ID                =
  ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

VERDICT               =
  PASS_OUTSIDE_CWD_MUTATION_PROVEN
  AUTHORITY_VIOLATION   = PENDING_CONTRACT_BIND
  (Q1-Q4 BOUND; Q5 RED REPRODUCED against the production
   createEditorExecutor seam at the LIVE-bound `editor`
   tool; defect classified; HOWEVER, the load-bearing
   "authority violation" claim is PENDING — see
   07-effective-destination-invariant.md for the
   honest ground-truth on what the source actually
   promises vs. what we asserted in the CYCLE3 verdict.
   The corrected handoff is
   ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-CONTRACT01
   (explicit contract introduction; freeze the invariant
    as a new durable rule) followed by
   ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-IMPLEMENTATION01
   (implement the contract at the Q4 seam) — NOT
   ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01
   which overclaims a pre-existing contract violation.)

IDENTITY
  ENTRY_HEAD           = 03af027a9 (pre-existing recon ACT entry,
                                 P1 calibration + handoff)
  ENTRY_TREE           = 479ccebf03baff8402044f785f6f1d5551462bd2
  CYCLE3_HEAD          = a917f73a6 (cycle3 closure commit:
                                 "recon(factory): ... Q1 BOUND +
                                 Q5 RED REPRODUCED"; introduced
                                 the original 6 RED cases A/B/C/E/F/H;
                                 verdict was PASS_AUTHORITY_VIOLATION_
                                 PROVEN which has since been
                                 downgraded by the Factory reviewer)
  FINAL_HEAD           = <to be filled at CYCLE4 commit>
  FINAL_TREE           = <to be filled at CYCLE4 commit>
  WORKTREE_STATUS      = mixed at start of CYCLE4
                          tracked  : clean (10 files from CYCLE3 commit
                                     still in HEAD a917f73a6)
                          untracked: none
                          modified : 5 files (this final report +
                                     03-authority-primitive.md +
                                     06-causal-discriminator.md +
                                     05-red-matrix.txt +
                                     entry-freeze.txt; the test
                                     file also has +1 new case D)
                          expected : CYCLE4 commit will fold all
                                     corrections in one bounded
                                     commit.

LIVE_BIND
  TASK_ID              = 1788238423825_btxab
  SESSION_ID           = 1788238423825_btxab
  TOOL_ID              = editor
  HANDLER              = sdk/packages/core/src/extensions/tools/
                         executors/editor.ts:230
                         (createEditorExecutor closure)
                       -> resolveFilePath at lines 42-65
                       -> fs.writeFile at line 147
                       (preceded by fs.mkdir at line 146)
  REQUESTED_TARGET     = 2 distinct LIVE specimens captured
                         E1: /Volumes/UserData/Users/chistyakov/
                             Projects/Runtime/srs/.otel-lab/tmp/
                             test-require2.pl
                         E3: /Volumes/UserData/Users/chistyakov/
                             Projects/Runtime/srs/.otel-lab/tmp/
                             p.pl
                         (Specimen S2 — shell `cp` — recorded
                         but explicitly out of scope; closed by
                         the SEATBELT-ALL-WORKSPACE-REALPATH-
                         AUTHORITY lineage.)
  EFFECTIVE_TARGET     = same as REQUESTED for E1 and E3
                         (the executor's resolveFilePath
                         returned the input path verbatim
                         through path.normalize)
  MUTATION_PRIMITIVE   = fs.writeFile + fs.mkdir-recursive
                         (editor.ts:144-151)
  EVIDENCE_QUALITY     = LIVE (verbatim tool_use + matching
                       tool_result in the same session;
                       tool_result.success=true echoed the
                       exact target back)

AUTHORITY
  AUTHORITY_PRODUCER     = session cwd = session workspaceRoot =
                            /Volumes/UserData/Users/chistyakov/
                            Projects/Runity/srs
                            (session metadata: cwd ==
                            workspace_root at
                            messages.metadata.cwd)
  AUTHORIZED_ROOTS       = [/Volumes/UserData/Users/chistyakov/
                            Projects/Runity/srs]
                            (single-root scenario; the
                            WorkspacePathAuthorityEvidence
                            substrate supports multi-root but
                            this LIVE specimen is single-root)
  LIVE_TARGET_AUTHORIZED = NO  (E1 and E3 targets differ from
                                 the authorized root in the
                                 second segment of the path;
                                 no `..` involved)

PATH_CHAIN
  SANITIZATION            = NONE on the editor seam (zodToJsonSchema
                            is structural only)
  BASE_SOURCE             = NONE for absolute inputs (path.normalize
                            only; path.resolve(cwd, ...) is
                            unreachable for absolute inputs)
  LEXICAL_RESOLUTION      = path.normalize (for absolute)
                            + path.resolve(cwd, ...) for relative
                            with relative-path containment check
                            (lines 47-50, 56-58, 60-62)
  CANONICALIZATION        = NONE (no fs.realpath invocation
                            anywhere in the closure)
  CONTAINMENT_CHECK       = NONE for absolute inputs (documented
                            "Absolute paths are always accepted
                            as-is" at line 56-58 + JSDoc at
                            line 28-33)
  SYMLINK_HANDLING        = NONE (no lstat / realpath; structurally
                            available seam defect, future ACT)
  NONEXISTENT_TARGET_HANDLING = NONE for absolute paths;
                                fs.mkdir-recursive at editor.ts:146
                                CREATES the parent outside the
                                authorized root — same defect
                                shape as the LIVE specimens.
  RACE_PROTECTION         = NONE (closure returns resolved path,
                                then mkdir + writeFile as separate
                                syscalls; bounded TOCTOU follow-up
                                per ACT §11)
```

```text
RED
  A_CLEAN                = PASS (control)
  B_TRAVERSAL            = PASS (control; relative traversal is
                              already refused today)
  C_ABSOLUTE_OUTSIDE     = FAIL = REPRODUCES (RED; today's editor
                              accepts absolute-outside paths
                              verbatim; this is the LIVE specimen
                              E1/E3 shape)
  D_SYMLINK_OUTSIDE      = NOT_TESTED_HERE (skipped per ACT §18 —
                              unobserved at LIVE; structurally
                              available; deferred to a bounded
                              TOCTOU/symlink follow-up ACT)
  E_NONEXISTENT_OUTSIDE  = FAIL = REPRODUCES (RED; today's editor
                              accepts absolute paths whose
                              NEAREST EXISTING ANCESTOR resolves
                              outside the authorized root; this
                              was the LIVE specimen shape because
                              /Projects/Runtime/srs/.otel-lab/tmp
                              did not exist when the editor was
                              called — fs.mkdir-recursive created
                              the target's parent OUTSIDE
                              cwd during the failed-but-still-
                              executed mutation)
  F_CANONICAL_INSIDE     = PASS (control; canonical inside-of-
                              authorized-root variants succeed)
  G_GLOBAL_CAPABILITY    = N/A  (this test surface exercises only
                              the editor tool; the global-skill
                              and global-rule writers do NOT
                              pass through editor; the corrected
                              capability-specific conservation
                              contract is satisfied by their
                              existing per-tool sanitizers at
                              apps/vscode/src/core/controller/
                              file/createSkillFile.ts and
                              createRuleFile.ts — out of scope
                              per ACT §0.1)
  H_WORKSPACE_CLEAN      = PASS (control; ordinary workspace
                              edit succeeds today)
  REPRODUCED             = YES  (C+E both FAIL today against
                              production createEditorExecutor;
                              all four controls PASS)

CAUSE
  CASE                   = CASE_E_WRONG_AUTHORIZED_ROOT
  FIRST_BROKEN_BOUNDARY  = resolveFilePath at editor.ts:42-65,
                           specifically the
                           isAbsoluteInput branch at line 56-58
  ROOT_CAUSE             = path.normalize() for absolute inputs
                           substitutes for the missing
                           path.resolve(cwd, ...) join, AND the
                           restrictToCwd semantic is lifted for
                           absolute inputs
  DISCRIMINATOR          = single-variable flip on the
                           isAbsoluteInput branch — with the
                           bypass removed, the existing
                           "Path must stay within cwd" check
                           at line 60-62 naturally refuses the
                           LIVE target without any other
                           change
  NECESSITY_ABLATION     = DEFERRED_TO_REPAIR_ACT  (not exercised
                           in this recon ACT per §18 STOP RULE;
                           first action of the repair ACT)
```

```text
REPAIR
  FILES                = pending  (repair ACT in a separate file
                                  will introduce the bounded wrap
                                  on SdkDiffEditCoordinator
                                  .executeEditorTool +
                                  executeApplyPatchTool via the
                                  same constructor-option pattern
                                  already used by
                                  createWorkspaceFileReadExecutor)
  AUTHORITY_DELTA      = pending  (the repair is hard-gated on
                                   this Q1 closing and is not in
                                   scope for this recon ACT)
  FILESYSTEM_DELTA     = pending  (no filesystem mutation in this
                                   cycle beyond the test-fixture
                                   cleanup that already happens in
                                   withTwoRootFixture's finally)
  SHELL_SEATBELT_DELTA = 0  (Seatbelt is not touched)
  TEMP_EXTERNAL_AUTHORITY_DELTA = 0  (TEMPORARY_EXTERNAL_PATH_
                                       AUTHORITY is not widened)
  PUBLIC_PROTOCOL_DELTA = 0  (no gRPC/protobuf surface changed)

CONSERVATION
  EDITOR               = PASS  (CASE C+E now reproduce against
                                 today's seam; future repair ACT
                                 will need to keep A+B+F+H green
                                 while flipping C and E red-to-
                                 green)
  APPLY_PATCH          = PASS-BY-SHARED-SEAM  (shares resolveFilePath
                                  shape; shares fallback executor
                                  in SdkDiffEditCoordinator; same
                                  bug class available; same repair
                                  wrap will be applied symmetrically
                                  by the repair ACT)
  GLOBAL_SKILL         = N/A here  (out of scope; the editor
                                    executor is not in this path;
                                    separate writeToFile-style
                                    controllers under
                                    apps/vscode/src/core/controller/
                                    file/ are unchanged)
  GLOBAL_RULE_HOOK     = N/A here  (same reason; not in scope)
  TEMP                 = N/A here  (TEMPORARY_EXTERNAL_PATH_
                                    AUTHORITY is unchanged; the
                                    repair ACT must NOT widen this
                                    escape hatch into editor
                                    authority per ACT §13)
  WINDOWS_PATHS        = N/A here  (path semantics test is platform-
                                    neutral via path.isAbsolute /
                                    path.relative / path.normalize,
                                    which Node.js provides
                                    consistently across POSIX +
                                    Windows)
  POSIX_PATHS          = PASS  (the RED was authored and runs on
                                POSIX in this cycle; coverage on
                                Windows is acceptable for the
                                repair ACT's quality gate)

QUALITY
  TARGETED             = PASS  (the new vitest
                                editor.realpath-authority.test.ts
                                exercises production
                                createEditorExecutor directly)
  ADJACENT             = PASS  (the existing editor.test.ts still
                                green at 13/13 alongside the new
                                file's 6 tests; no regression in
                                the pre-existing executor suite)
  TYPECHECK            = PENDING  (targeted
                                  check-types not run in this
                                  recon cycle — there are NO
                                  TypeScript changes in this
                                  recon cycle; only a test file
                                  was added. Targeted typecheck
                                  will be a quality gate of the
                                  repair ACT)
  LINT                 = PENDING  (same reason; recon did not
                                  add production code)
  DIFF_CHECK           = silent for the working-tree diff vs HEAD
                          (untracked file only)

DOGFOOD
  SOURCE_HEAD          = PENDING  (no production build this
                                   cycle; recon ACT does not
                                   bundle)
  VERSION              = PENDING
  ARTIFACT_PATH        = PENDING
  BYTE_SIZE            = PENDING
  SHA256               = PENDING
  INSTALLED_VERSION    = PENDING

LIVE_QUALIFICATION
  LIVE_QUALIFICATION   = PENDING  (qualification gate is in the
                                   repair ACT; this recon ACT
                                   intentionally does not
                                   bundle an artifact)
  original /Projects/Runtime/... specimen location = physically
                                  gone from this filesystem at
                                  the recon re-binding time; the
                                  session transcript is the
                                  durable proof (no fresh
                                  reproduction required because
                                  the production seam admits
                                  the same input string today)
```

```text
COMMITS
  COUNT                = 0 (this recon cycle did NOT advance a
                           commit; only the existing files at
                           00-scope.md and entry-freeze.txt
                           pre-date 684356da8; the new Q1-Q4
                           evidence files are working-tree
                           additions for review; the new test
                           file is a working-tree addition for
                           the repair ACT to stage)
  HASHES               = (none)

PUSHED                 = NO
FORCE_PUSHED           = NO
AMENDED_PUBLISHED_COMMIT = NO

NEXT_RECOMMENDED_ACT   =
  ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-CONTRACT01
  (CYCLE4 CORRECTION — see 07-effective-destination-invariant.md
   for the disposition rationale; the previous recommendation
   ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01
   overclaims a pre-existing contract violation and was rejected
   by the Factory reviewer on commit a917f73a6)

  FOLLOWED BY (after (a) closes with the contract frozen):

  ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-IMPLEMENTATION01
  (implements the contract at the Q4 seam
   SdkDiffEditCoordinator.executeEditorTool with realpath-based
   canonical containment — see 06-causal-discriminator.md for
   why pure lexical containment is insufficient: case D
   (existing-symlink escape) is RED today, and a lexical-only
   repair would not close it)
```

## Why the next ACT is a contract ACT, not a repair ACT

```text
The decision matrix applied to this recon:

  Is the LIVE tool still UNBOUND?                NO  (Q1 BOUND)
  Is the LIVE permitted mutation proven?         YES (cases C, D,
                                                       E RED today)
  Is a pre-existing contract proven violated?    NO  (the editor
                                                       has NO code-level
                                                       invariant today;
                                                       the user-facing
                                                       auto-approve
                                                       policy at
                                                       docs/features/
                                                       auto-approve.mdx
                                                       is the only
                                                       partial grounding)
  Was the cause isolated with one-variable flip? YES (CASE_E early
                                                       bypass at
                                                       editor.ts:56-58)
  Is the smallest bounded repair obvious?        YES (delete the
                                                       absolute-bypass
                                                       branch AND add
                                                       realpath
                                                       canonicalization
                                                       for case D)

The handoff is corrected from "repair a contract violation"
to "introduce the contract, then implement it":

  ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-CONTRACT01 must:
    - freeze the invariant as a new durable rule:
        editor mutations must remain inside the workspace
        as EFFECTIVE destination (lexical AND realpath)
    - explicitly cover case D (lexical-inside but
      effective-outside via symlink)
    - explicitly cover cases C and E (absolute-outside,
      nonexistent-outside-tree)
    - bind the apply_patch seam symmetrically (conservation)
    - NOT widen TEMPORARY_EXTERNAL_PATH_AUTHORITY or Seatbelt

  ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-IMPLEMENTATION01 must:
    - flip cases C, D, E from RED to GREEN while keeping
      A/B/F/H GREEN
    - confirm editor.test.ts (adjacent) 13/13 PASS
    - perform necessity ablation: temporarily disable the
      wrap -> C, D, E return to RED; restore
    - dogfood + LIVE qualify on a disposable target
    - typecheck apps/vscode (SdkController.ts will change)
    - targeted lint, git diff --check silent

If the contract ACT halts because the invariant is not
agreed, the recon lane re-opens for Q2b/Q3b. If the
implementation ACT halts because no smaller-than-the-
problem fix is available, it re-opens the recon for
Q4b (re-select seam) and Q9b (re-discriminate cause).
Per ACT §18, those are the only STOP-mandated follow-ups.
```

## Producer-first discipline note (for the reviewer)

```text
The Q5 RED was authored UNDER the bound production seam
(createEditorExecutor), not against a wrapper. This means
the repair ACT's first action can be the bounded change,
not "first prove the seam". Per the developer-rules preamble
("Producer-first. Direct integration over external
emulation."), this is the correct sequencing.

If a future ACT needs the wider ClineMM seam
(SdkDiffEditCoordinator .executeEditorTool +
executeApplyPatchTool) under test, the RED must be RE-authored
against THAT seam — not against the SDK's default executor
in isolation — so the test gates the real production path
the model will hit at runtime.
```

## CYCLE4 amendment (2026-09-04)

Per Factory causal reviewer verdict on commit `a917f73a6`
(`HALT_AUTHORITY_CONTRACT_NOT_PROVEN`), CYCLE4 corrections:

1. **Q2 honestly downgraded**: the CYCLE3 verdict
   `PASS_AUTHORITY_VIOLATION_PROVEN` overclaimed. The editor
   has NO code-level invariant today enforcing workspace-only
   mutation; the user-facing `auto-approve.mdx` is the only
   partial grounding. The corrected verdict is
   `PASS_OUTSIDE_CWD_MUTATION_PROVEN` +
   `AUTHORITY_VIOLATION = PENDING_CONTRACT_BIND`.

2. **Case D added**: existing-symlink escape is now RED.
   This is a deterministic (non-TOCTOU) defect that the
   factory invariant ("effective destination must remain
   inside authorized root") explicitly covers. A
   lexical-only repair would NOT close it; the
   implementation ACT must use fs.realpath canonicalization.

3. **Causal wording corrected**: the earlier draft claim
   "path.normalize() in lieu of path.resolve(cwd, ...)"
   was wrong — `path.resolve("/ws", "/outside")` returns
   "/outside" on Node (absolute second arg resets the base).
   The actual defect is the early bypass of
   `path.relative(cwd, resolved)` containment test for
   absolute inputs. See `06-causal-discriminator.md` for the
   corrected framing.

4. **Handoff changed**: from
   `ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01`
   (which implied a pre-existing contract violation) to
   `ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-CONTRACT01`
   (explicit contract introduction) followed by
   `ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-IMPLEMENTATION01`
   (implementation at the Q4 seam with realpath canonical
   containment).

5. **Conservation explicit**: the read seam
   (`createWorkspaceFileReadExecutor`) and the apply_patch
   seam (conservation) both have analogous lexical-only
   patterns; the implementation ACT must address editor
   first and may consider whether to widen the read/apply
   seams symmetrically in a follow-up ACT, NOT in this one.

```text
EV_VERDICT_CYCLE4     = PASS_OUTSIDE_CWD_MUTATION_PROVEN
                       AUTHORITY_VIOLATION = PENDING_CONTRACT_BIND
RED_MATRIX_CYCLE4     = A PASS, B PASS, C FAIL(RED), D FAIL(RED, NEW),
                       E FAIL(RED), F PASS, H PASS
                       [3 RED / 4 control PASS]
ADJACENT_TEST         = editor.test.ts (13 tests) PASS, no regression
PRODUCTION_FILES      = 0 changed (this ACT is recon-only)
ENTRY_FREEZE          = updated; CYCLE4 block appended
NEXT_ACT              = ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-CONTRACT01
                       (followed by IMPLEMENTATION01)
```
