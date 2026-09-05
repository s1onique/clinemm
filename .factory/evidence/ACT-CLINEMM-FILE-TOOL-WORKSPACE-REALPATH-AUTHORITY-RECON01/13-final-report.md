# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 13-final-report

```text
ACT_ID                =
  ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

VERDICT               =
  PASS_OUTSIDE_CWD_MUTATION_PROVEN
  APPROVAL_SEMANTICS    = BOUND_FROM_SOURCE
  (CYCLE7 — per Factory reviewer verdict on commit 1f2abd59a
   (HALT_APPROVAL_POLICY_IS_NOT_PATH_AUTHORITY), this is
   UPGRADED from CYCLE5's PENDING_RUNTIME_POLICY_BIND:
   Phase-0 discriminator has been answered from source.
   The complete trace is at
   14-phase0-source-trace.md. Summary of the bind:

   * editFilesExternally is a NO-OP in policy code. It
     is read ONLY in:
       - apps/vscode/src/shared/AutoApprovalSettings.ts:18
         (type declaration, marked "Legacy field")
       - apps/vscode/src/shared/AutoApprovalSettings.ts:37
         (default value = true)
       - apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts:301
         (persistence migration)
       - apps/vscode/src/sdk/session-auto-approval.ts:236
         (pass-through into SessionAutoApprovalOverride)
     No code path branches on the value. The "Edit all files"
     UI toggle is dead.

   * The actual authority gate is editFiles ONLY, evaluated
     at apps/vscode/src/sdk/sdk-tool-policies.ts:1081-1083:
       if (isEditTool(toolName)) {
         return !!settings.actions.editFiles   ← never editFilesExternally
       }

   * editFiles=true (default) -> silent ALLOW; editor.ts
     lexical relative-path check is the ONLY path classifier,
     and it is bypassed for absolute inputs (line 56-58).
   * editFiles=false -> MANUAL ASK UI; no path classification
     either way; user decides.

   * LIVE specimens E1/E3: editFiles=true (default) implies
     silent ALLOW -> fs.writeFile. The path was most-likely
     authorized at the policy layer (assuming default setting),
     and editFilesExternally IS NOT A FACTOR EITHER WAY.

   * Two independent sub-defects to address in the production ACT:
       (1) EDITOR_EFFECTIVE_DESTINATION_CLASSIFICATION_MISSING
           (proven by CYCLE5 RED matrix - classifier absent)
       (2) EXTERNAL_EDIT_AUTO_APPROVAL_CONTRACT_UNIMPLEMENTED
           (renamed from EDITFILES_EXTERNALLY_LEGACY_NOOP_DEADCODE
            per CYCLE7 reviewer correction; the recon proves the
            CONTRACT is unimplemented, not that the storage field
            is dead-code. Whether to reactivate editFilesExternally
            or introduce a non-legacy field is the production ACT's
            implementation decision, recorded as
              LEGACY_FIELD_REACTIVATION = deliberate ClineMM
                                           compatibility choice)

   * Production ACT contract re-scoped to introduce BOTH:
       - canonical inside/outside classifier at the editor-tool
         policy seam (Phase 1+3)
       - wire editFilesExternally into the policy gate (Phase 2+3)
     so the reviewer's expected lattice becomes enforceable.

   See 14-phase0-source-trace.md for the full chain-by-chain
   source trace and the production-ACT phase plan.)

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
  CYCLE5_HEAD          = 78b6361eb (cycle5 closure commit;
                                 corrected case D geometry +
                                 runtime policy bind + V1
                                 algorithm correction)
  CYCLE6_HEAD          = 1f2abd59a (cycle6 closure commit;
                                  Phase-0 discriminator answered
                                  from source; semantics bound;
                                  editFilesExternally proven NO-OP;
                                  editFiles proven actual gate;
                                  two defects identified)
  CYCLE7_HEAD          = <to be filled at CYCLE7 commit>
                         (cycle7: corrections to the proposed
                                  production-ACT contract per
                                  reviewer verdict on 1f2abd59a;
                                  6 P1 + 1 P2; recon lane stays
                                  closed)
  FINAL_HEAD           = <to be filled at CYCLE7 commit>
  FINAL_TREE           = <to be filled at CYCLE7 commit>
  WORKTREE_STATUS      = mixed at start of CYCLE7
                          tracked  : clean (12 files from CYCLE6 commit
                                     still in HEAD 1f2abd59a)
                          untracked: none
                          modified : 2 files (this final report +
                                     entry-freeze.txt)
                          expected : CYCLE7 commit will fold all
                                     corrections in one bounded
                                     commit (P2 noun fix + defect
                                     rename + 6 P1 contract
                                     corrections + EV_VERDICT_CYCLE7
                                     block + Phase 0 reconfirmation
                                     list for production ACT).

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
  ACT-CLINEMM-EDITOR-WORKSPACE-EFFECTIVE-DESTINATION-AUTHORITY01
  (CYCLE5 — collapsed from CYCLE4's two-ACT plan
   CONTRACT01 + IMPLEMENTATION01 into ONE bounded production
   ACT, per Factory reviewer's discipline note "Factory exists
   to increase learning speed, not turn every invariant into
   an ACT". Phase 0 of the new ACT freezes the V1 contract
   inline; Phases 1-4 implement it. See
   07-effective-destination-invariant.md for the V1 algorithm
   and the corrected defect classification.)
```

## Why the next ACT is collapsed into one (CYCLE5)

```text
The decision matrix applied to this recon:

  Is the LIVE tool still UNBOUND?                NO  (Q1 BOUND)
  Is the LIVE permitted mutation proven?         YES (cases C, D,
                                                       E RED today)
  Is the user's effective runtime policy bound?  LIKELY "Edit all
                                                       files" = ON at
                                                       session time;
                                                       LIVE mutations
                                                       were therefore
                                                       authorized at
                                                       the policy
                                                       layer (this is
                                                       the CYCLE5
                                                       finding)
  Is a pre-existing code-level invariant         NO  (no code-level
  proven violated?                                   invariant exists
                                                       today; partial
                                                       grounding only
                                                       via auto-approve
                                                       policy at
                                                       docs/features/
                                                       auto-approve.mdx
                                                       + global state
                                                       editFilesExternally
                                                       toggle)
  Was the cause isolated with one-variable flip? YES (CYCLE4: early
                                                       bypass at
                                                       editor.ts:56-58
                                                       — single-variable
                                                       flip removes it;
                                                       the V1 algorithm
                                                       also adds realpath
                                                       canonicalization
                                                       for case D)
  Is the smallest bounded repair obvious?        YES (V1 algorithm
                                                       in 07)

The handoff is collapsed to one ACT:

  ACT-CLINEMM-EDITOR-WORKSPACE-EFFECTIVE-DESTINATION-AUTHORITY01:

    Phase 0 (in ACT body):
      - freeze the V1 contract (lexical containment +
        realpath(authorizedRoot) + realpath(nearest
        existing ancestor) — see 07 for the full algorithm)
      - explicitly covers cases C, D, E
      - explicitly preserves A, B, F, H
      - explicitly states TOCTOU is out of scope
      - explicitly states O_NOFOLLOW is not the answer

    Phase 1:
      - author the bounded production fix at the Q4 seam
        (SdkDiffEditCoordinator.executeEditorTool +
        symmetric executeApplyPatchTool for conservation)
      - mirror the existing
        createWorkspaceFileReadExecutor pattern
      - use the V1 algorithm (realpath on existing ancestor)

    Phase 2:
      - flip case C, D, E from RED to GREEN
      - keep A, B, F, H GREEN
      - confirm editor.test.ts (adjacent) 13/13 PASS
      - necessity ablation: temporarily disable the wrap
        -> C, D, E return to RED; restore

    Phase 3:
      - dogfood + LIVE qualify on a disposable target
      - verify auto-approve settings interaction:
        "Edit project files" + outside write -> refused
        "Edit all files"     + outside write -> allowed
        (the wrap must NOT masquerade as the broader
         policy; it must reflect the effective capability)

    Phase 4:
      - apps/vscode typecheck + targeted lint +
        git diff --check silent

    Conservation on apply_patch:
      - answer: does model-driven apply_patch go through
        SdkDiffEditCoordinator or the exact same
        canonical-authority primitive? If yes, conservation
        test in the same ACT. If no, record successor ACT
        ACT-CLINEMM-APPLY-PATCH-WORKSPACE-AUTHORITY01
        and do NOT expand scope opportunistically.
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

## CYCLE5 amendment (2026-09-04)

Per Factory causal reviewer verdict on commit `cf84c996e`
(`PASS_WITH_ONE_BOUNDED_P1 — C1: GO`), CYCLE5 corrections:

1. **P1 fixed**: case D test now uses a RELATIVE target
   (`"escape/d.txt"`) instead of an absolute path. This
   isolates the symlink escape from the absolute-input
   containment bypass (cases C/E). The lexical
   containment check at editor.ts:60-62 now runs and
   passes; only the OS symlink lookup at fs.writeFile
   time reveals the escape. With this geometry, case D
   is a clean causal discriminator of the
   EFFECTIVE_DESTINATION_CANONICALIZATION_MISSING defect
   (separate from the absolute-bypass defect).

2. **Runtime policy bind completed**:
   `~/.cline/data/globalState.json` shows
   `autoApprovalSettings.actions.editFilesExternally = true`
   ("Edit all files" toggle ON). This is the current
   global state, last modified 2026-09-04 03:00 — 3 days
   after the session ended. Session-time durable backup
   is not preserved, but the current setting represents
   the user's durable intent, and no contradictory
   session-time evidence survives in the session
   messages or the workspace state file.

   Therefore the LIVE specimens E1 and E3 were
   MOST-LIKELY within the user's effective authority at
   session time (the user had explicitly opted in to
   outside-workspace editing). The mutations were
   AUTHORIZED at the policy layer, not violations.

   Verdict is FURTHER downgraded to:
   `AUTHORITY_VIOLATION = PENDING_RUNTIME_POLICY_BIND`
   (was `PENDING_CONTRACT_BIND` in CYCLE4). The LIVE
   evidence proves permissive seam behavior, not an
   active opt-out failure.

3. **V1 contract algorithm corrected**:
   - `realpath(target)` is INSUFFICIENT for newly-created
     targets (e.g. `workspace/new/deep/file.ts`) because
     it returns ENOENT. The correct algorithm walks UP
     from the target to the nearest existing ancestor,
     then realpaths the ancestor.
   - `O_NOFOLLOW` is NOT the answer for the parent-chain
     symlink defect. It only refuses a final-file
     symlink; the defect is a parent-directory symlink
     redirecting the OS lookup. V1 explicitly excludes
     TOCTOU (race-safe mutation) as out of scope.

4. **Defect classification reclassified**:
   - Old (CYCLE3): `CASE_E_WRONG_AUTHORIZED_ROOT` —
     inaccurate, cwd IS present and correct
   - New (CYCLE5): `EDITOR_EFFECTIVE_DESTINATION_AUTHORITY_MISSING`
     with sub-cases:
       - C, E: `ABSOLUTE_CONTAINMENT_BYPASS`
       - D: `EFFECTIVE_DESTINATION_CANONICALIZATION_MISSING`

5. **Handoff collapsed to ONE bounded ACT**:
   From CYCLE4's two-ACT plan
   (`CONTRACT01 + IMPLEMENTATION01`) to one
   `ACT-CLINEMM-EDITOR-WORKSPACE-EFFECTIVE-DESTINATION-AUTHORITY01`
   per Factory reviewer's discipline note ("Factory
   exists to increase learning speed, not turn every
   invariant into an ACT"). Phase 0 of the new ACT
   freezes the V1 contract inline; Phases 1-4 implement
   it at the Q4 seam.

```text
EV_VERDICT_CYCLE5     = PASS_OUTSIDE_CWD_MUTATION_PROVEN
                       AUTHORITY_VIOLATION = PENDING_RUNTIME_POLICY_BIND
                       (LIVE specimens E1/E3 were MOST-LIKELY
                        within the user's effective runtime
                        authority at session time because
                        editFilesExternally=true)
RED_MATRIX_CYCLE5     = A PASS, B PASS, C FAIL(RED), D FAIL(RED, RELATIVE
                       target now — isolates symlink escape from
                       absolute-input bypass), E FAIL(RED), F PASS, H PASS
                       [3 RED / 4 control PASS]
CASE_D_GEOMETRY       = RELATIVE TARGET ("escape/d.txt") — the
                       lexical containment check runs and passes;
                       only the OS symlink lookup at fs.writeFile
                       reveals the escape. This isolates the
                       EFFECTIVE_DESTINATION_CANONICALIZATION_MISSING
                       defect from the absolute-input bypass.
V1_ALGORITHM          = realpath(authorizedRoot) + lexical
                       containment + realpath(nearest existing
                       ancestor) [NOT realpath(target); NOT O_NOFOLLOW]
V1_EXCLUSIONS         = TOCTOU (race-safe mutation) explicitly
                       out of scope; O_NOFOLLOW explicitly NOT
                       the answer for parent-chain symlinks
NEXT_ACT              = ACT-CLINEMM-EDITOR-WORKSPACE-EFFECTIVE-
                       DESTINATION-AUTHORITY01 (single bounded ACT,
                       Phase 0 freezes contract, Phases 1-4 implement)
PRODUCTION_FILES      = 0 changed (recon-only)
```

```text
EV_VERDICT_CYCLE6     = PASS_OUTSIDE_CWD_MUTATION_PROVEN
                       APPROVAL_SEMANTICS = BOUND_FROM_SOURCE
                       (CYCLE6 Phase-0 discriminator answered:
                        editFilesExternally is a NO-OP legacy
                        field; the actual gate is editFiles,
                        which controls ASK vs silent ALLOW,
                        not inside vs outside classification.
                        Two independent defects identified:
                        (1) EDITOR_EFFECTIVE_DESTINATION_
                            CLASSIFICATION_MISSING
                        (2) EXTERNAL_EDIT_AUTO_APPROVAL_
                            CONTRACT_UNIMPLEMENTED
                            (renamed from CYCLE6's
                             EDITFILES_EXTERNALLY_LEGACY_
                             NOOP_DEADCODE per CYCLE7
                             correction; the recon proves
                             the contract is unimplemented,
                             not that the storage field is
                             dead-code. Production ACT may
                             choose storage representation.)
                        Both bounded to editor-tool policy
                        seam; both addressable in one ACT.)
PHASE0_BIND_FROM_SOURCE = COMPLETE
                       (see 14-phase0-source-trace.md)
LIVE_SPECIMEN_E1_E3_POLICY =
                       editFiles=true (DEFAULT, session-time
                       snapshot not preserved -> cannot prove
                       session-time value). editFilesExternally
                       is NOT a factor either way.
NEXT_ACT_CYCLE6       = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-
                       APPROVAL01 (renamed from
                       ...WORKSPACE-EFFECTIVE-DESTINATION-
                       AUTHORITY01 per Factory reviewer's
                       recommendation; scope expanded to also
                       wire editFilesExternally into the
                       policy gate so the reviewer's expected
                       lattice becomes enforceable.)
NEW_EVIDENCE          = .factory/evidence/ACT-CLINEMM-FILE-TOOL-
                       WORKSPACE-REALPATH-AUTHORITY-RECON01/
                       14-phase0-source-trace.md (NEW, 311 lines)
PRODUCTION_FILES      = 0 changed (still recon-only)
```
EV_VERDICT_CYCLE7     = PASS_CYCLE6_BUT_HALT_PROPOSED_POLICY_SEAM
                       APPROVAL_SEMANTICS = BOUND_FROM_SOURCE
                       CONTRACT_CORRECTED  = YES
                       (CYCLE7 per Factory reviewer verdict on
                        commit 1f2abd59a. CYCLE6 recon facts are
                        UNCHANGED; the production-ACT contract
                        proposed in CYCLE6 had six P1 issues and
                        one P2 wording issue that the reviewer
                        caught BEFORE the production ACT could
                        open. This cycle records those corrections
                        without re-opening the recon lane:
                          P1-1  corrected 5-row lattice
                                (editFiles x INSIDE/OUTSIDE x
                                 external-edit ON/OFF + UNAVAILABLE
                                 fail-closed)
                          P1-2  classifier is tri-state
                                (inside|outside|unavailable),
                                UNAVAILABLE -> ASK (never silent)
                          P1-3  sync vs async seam reanalysis
                                (isToolAutoApproved probably sync;
                                 do NOT convert it to async;
                                 use existing command-authority
                                 evidence pattern at the lowest
                                 existing async seam, likely
                                 handleRequestToolApproval)
                          P1-4  do NOT conflate approval with
                                executor safety (approved-outside
                                MUST still write; RED suite must
                                split into classifier/policy/
                                executor layers)
                          P1-5  apply_patch conservation mandatory
                                (UI toggle covers ALL edit ops;
                                inventory each isEditTool member
                                for shared request shape / target
                                extraction; either include or
                                record OTHER_EDIT_TOOLS =
                                successor / unchanged as P0
                                product-contract issue)
                          P1-6  V1 classifier algorithm simplified
                                (drop "inspect unresolved suffix"
                                 step; suffix does not exist yet)
                          P1-7  defect 2 renamed to
                                EXTERNAL_EDIT_AUTO_APPROVAL_
                                CONTRACT_UNIMPLEMENTED
                          P1-8  editFilesExternally reactivation
                                recorded as
                                  LEGACY_FIELD_REACTIVATION =
                                    deliberate ClineMM
                                    compatibility choice
                                (NOT a claim upstream currently
                                 treats it as live policy;
                                 may also choose non-legacy field)
                          P2    verdict noun changed
                                AUTHORITY_VIOLATION ->
                                APPROVAL_SEMANTICS
                        Phase 0 of the production ACT must
                        reconfirm:
                          ASYNC_CLASSIFICATION_SEAM         = ?
                          EDIT_TOOL_REQUEST_PATH_EXTRACTION = ?
                          EXTERNAL_POLICY_STORAGE_FIELD     = ?
                          isToolAutoApproved_sync_OR_async  = ?
                          LOWEST_EXISTING_ASYNC_SEAM        = ?
                          isEditTool_members_conserved      = ?
                        BEFORE writing any RED tests.)
RECON_LANE_STATUS     = CLOSED
                       (per reviewer: "Do not reopen the
                        recon lane. CYCLE6 has reached its
                        terminal bound. The corrections live
                        in the production ACT's Phase 0.")

## CYCLE7 — corrections to the proposed production ACT contract (P1×4 + P1-rename + P2)

Per Factory reviewer verdict on commit `1f2abd59a`
(`PASS_CYCLE6 — but HALT_PROPOSED_POLICY_SEAM` / `C1: GO`).
Recon lane stays closed. The recon facts are unchanged.
What changes here is the CONTRACT that the production ACT
must freeze in its own Phase 0 before writing RED tests.

### Correction 1 — corrected 5-row policy lattice (P1)

The CYCLE6 lattice had:

```text
INSIDE + editFilesExternally=false => existing ASK flow
INSIDE + editFilesExternally=true  => existing ALLOW flow
```

This is WRONG. The reviewer's correct lattice is:

```text
editFiles | destination   | external-edit | result
--------- | ------------- | ------------- | ------
   false  | inside        | any           | ASK
   false  | outside       | any           | ASK
   true   | inside        | any           | ALLOW
   true   | outside       | false         | ASK
   true   | outside       | true          | ALLOW
   (any)  | unavailable   | (any)         | ASK    <- fail-closed
```

`editFilesExternally` has NO effect on inside-workspace edits.
The "Edit all files" toggle EXTENDS the base `editFiles`
toggle to outside-workspace targets, and ONLY when the base
toggle is ON. If `editFiles=false`, the extension is a no-op
even when "Edit all files" is ON.

This matches the upstream public documentation: "Edit all
files" extends auto-approval outside the workspace; the
base "Edit project files" toggle is the prerequisite.

### Correction 2 — classification is tri-state, not binary (P1)

The V1 classifier must return one of:

```ts
type EffectiveDestinationClass =
  | "inside"
  | "outside"
  | "unavailable"
```

`unavailable` covers EACCES, ENOENT during racing topology,
realpath error, malformed workspace root. Approval semantics
for `unavailable`:

```text
classifier error -> ASK   (fail-closed)
classifier error -> !assume inside -> !silent write
```

This is particularly important because the classifier is
being added specifically to decide whether a write can
bypass manual approval.


### Correction 3 — policy seam is probably impossible as stated (P1)

The proposed Phase 3 wired the classifier into
`sdk-interaction-coordinator.ts` / `isToolAutoApproved`.
But:

```text
V1 classifier requires:
  realpath(workspaceRoot)
  find deepest existing ancestor
  realpath(existingAncestor)
=> filesystem I/O => normally ASYNC

isToolAutoApproved() is a cheap policy predicate
=> almost certainly SYNCHRONOUS
```

Do NOT convert a central sync predicate to async casually.
That ripples through every tool-approval caller.

The correct architecture is the existing command-authority
pattern (already in ClineMM for command tools):

```text
ASYNC evidence acquisition / canonical filesystem observation
   -> EditorPathAuthorityEvidence { classification, ... }
PURE policy evaluation (no fs I/O)
   -> ALLOW / ASK
```

Production ACT Phase 0 MUST reconfirm:
- sync-ness of `isToolAutoApproved`
- lowest existing async seam (likely
  `handleRequestToolApproval` itself)
- lowest cost of evidence acquisition per call

### Correction 4 — don't confuse approval with executor safety (P1)

If the correct semantic is:

```text
OUTSIDE + external OFF
  -> ASK
  -> user clicks Approve
  -> executor MUST perform the outside write
```

then the current CYCLE5 RED suite (C/D/E -> executor
refuses) encodes the WRONG LAYER.

After the policy semantics are correctly bound, the RED
suite MUST be split into THREE layers:

```text
(a) CLASSIFIER tests (pure):
    A -> INSIDE
    B -> OUTSIDE
    C -> OUTSIDE
    D -> OUTSIDE
    E -> OUTSIDE
    F -> INSIDE
    H -> INSIDE

(b) POLICY tests (pure):
    editFiles=false + INSIDE  -> ASK
    editFiles=false + OUTSIDE -> ASK
    editFiles=true  + INSIDE  -> ALLOW
    editFiles=true  + OUTSIDE + external=false -> ASK
    editFiles=true  + OUTSIDE + external=true  -> ALLOW
    classification unavailable                -> ASK

(c) EXECUTOR tests (real filesystem):
    approved-outside target STILL WRITES (not refused)
    non-approved-outside target still refuses
```

The current `editor.realpath-authority.test.ts` cannot
simply flip C/D/E to executor-rejection GREEN. That would
encode: "outside target is FORBIDDEN", which contradicts
the upstream product contract "Edit all files lets you
edit outside the workspace".


### Correction 5 — apply_patch conservation is mandatory (P1)

`isEditTool()` covers:

```text
editor
replace_in_file
write_to_file
apply_patch
delete_file
```

The "Edit all files" UI toggle is documented as covering
ALL edit operations. If the new path-aware policy only
classifies `editor` and leaves `apply_patch` to its
current silent-ALLOW path, then:

```text
apply_patch outside workspace
  + editFiles=true
  -> silent ALLOW
  -> trivially bypasses the new external-edit rule
```

So conservation is stronger than "if convenient". Phase 0
of the production ACT MUST inventory each `isEditTool`
member:

```text
does the request expose target path deterministically?
can the classifier bind effective destination for it?
does it share the same request shape / resolver?
```

If yes -> include in the policy seam.
If no  -> explicitly record
    OTHER_EDIT_TOOLS = successor / unchanged
       as a P0 product-contract issue
       (UI toggle does not faithfully describe all edit ops)
       to be tracked separately.

### Correction 6 — V1 classifier algorithm, simplified

The CYCLE6 algorithm had a redundant "inspect unresolved
suffix for symlinks" step. Correct simplification:

```text
canonicalRoot    = realpath(workspaceRoot)
lexicalTarget    = absolute(input)
                   ? normalize(input)
                   : resolve(workspaceRoot, input)
existingAncestor = deepest existing ancestor of lexicalTarget
canonicalAncestor = realpath(existingAncestor)
classification   = (canonicalAncestor contained in canonicalRoot)
                   ? INSIDE
                   : OUTSIDE
```

Justification:
- For an existing symlink anywhere in the prefix,
  `realpath(existingAncestor)` resolves it.
- For an existing final symlink, the final target itself
  IS the deepest existing path, and `realpath(target)`
  resolves it (because we walk up to the target, and the
  target exists).
- The unresolved suffix does not, by definition, exist
  on disk yet, so it cannot contain a symlink that would
  redirect the write.

Boundary explicitly preserved:
```text
TOCTOU_AFTER_CLASSIFICATION = explicitly unsolved
```


### Correction 7 — Defect 2 renamed (P1-naming)

The CYCLE6 defect name:

```text
EDITFILES_EXTERNALLY_LEGACY_NOOP_DEADCODE
```

overstated a storage-representation claim (upstream may
deliberately keep the legacy field). Renamed to:

```text
EXTERNAL_EDIT_AUTO_APPROVAL_CONTRACT_UNIMPLEMENTED
```

This names the missing BEHAVIOR (the contract that
outside writes require a separate external-edit opt-in),
not the storage field. The production ACT may choose
storage representation freely.

### Correction 8 — editFilesExternally reactivation is deliberate (P1-storage-decision)

Whether the backing setting is:

```text
editFilesExternally
```

or a new/non-legacy replacement is an implementation
decision to make from the current Settings UI/state model
in the production ACT. Because ClineMM still exposes the
"Edit all files" concept to users, reusing the field is
the smallest migration-compatible choice — but record it as:

```text
LEGACY_FIELD_REACTIVATION = deliberate ClineMM compatibility
                             choice (NOT a claim that
                             upstream currently treats it as
                             live policy)
```

### Correction 9 — verdict noun changed (P2)

```text
AUTHORITY_VIOLATION = SEMANTICS_BOUND_FROM_SOURCE
   -> APPROVAL_SEMANTICS = BOUND_FROM_SOURCE
```

The recon ACT does NOT assert an authority violation
occurred in the live session (runtime policy at session
time is not preserved; user's most-likely effective
policy had editFiles=true). The recon ACT now asserts
that the APPROVAL-SEMANTICS LATTICE is bound from source.

### Phase 0 corrections the production ACT must perform FIRST

```text
ASYNC_CLASSIFICATION_SEAM        = ?
EDIT_TOOL_REQUEST_PATH_EXTRACTION = ?
EXTERNAL_POLICY_STORAGE_FIELD    = ?
   (decide between editFilesExternally reuse
    vs new non-legacy field)
isToolAutoApproved_sync_OR_async = ?
LOWEST_EXISTING_ASYNC_SEAM       = ?
isEditTool_members_conserved     = ?
   editor / replace_in_file / write_to_file
   / apply_patch / delete_file
   -> which share the same request shape
      and target-path extraction
```

### Summary

```text
CYCLE7 verdict: PASS_CYCLE6 — but HALT_PROPOSED_POLICY_SEAM

P0 : NONE in recon
P1 : (1) lattice corrected to 5-row table (Correction 1)
     (2) classifier is tri-state (Correction 2)
     (3) sync vs async seam reanalysis (Correction 3)
     (4) don't conflate approval with executor safety
         (Correction 4)
     (5) apply_patch conservation mandatory (Correction 5)
     (6) defect renamed (Correction 7)
     (7) editFilesExternally reactivation = deliberate
         compatibility choice (Correction 8)
P2 : verdict noun changed (Correction 9)

PROVEN (unchanged from CYCLE6):
  path classification absent
  C/D/E classification defects
  editFiles is live approval gate
  editFilesExternally is currently a NO-OP
  manual ASK exists when editFiles=false

NEXT : one bounded production ACT
  ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
  with the above Phase 0 reconfirmations and 5-row lattice
  frozen inline BEFORE RED tests
```

Recon lane stays closed.


---

## EV_VERDICT_REVIEWER_ON_CYCLE7 (appended 2026-09-04)

```text
ACT_ID                = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
REVIEWER_CYCLE        = on commit 72594d509 (this ACT's CYCLE7)
REVIEWER_VERDICT      = PASS_WITH_ONE_BOUNDED_P1
C1                    = GO (proceed to production ACT)
RECON_LANE            = CLOSED (do NOT reopen)
PRODUCTION_ACT        = AUTHORIZED
                       ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
PRODUCTION_ACT_OPEN   = this commit (docs-only opening;
                                    Phase 0 reconfirms 6 facts)
```

### The bounded P1 (wording/layering)

The CYCLE7 reviewer's only remaining P1 is a single wording
correction that must land INSIDE the production ACT's Phase 0,
not in the recon ACT:

```text
P1 wording correction (applied in production ACT §3):
  REPLACE  "non-approved-outside target still refuses"
  WITH     "denied approval means executor not invoked"
```

This is layer-conflation: the executor must be ignorant of
the approval policy. The correct three-layer contract is:

```text
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

### Other corrections the reviewer affirmed

The reviewer explicitly affirmed CYCLE7's six P1 corrections
and the P2 verdict noun change. Key affirmations:

- Lattice correction (P1-1): the 5-row table is the
  contract; the 6th row `unavailable -> ASK` is fail-closed.
- Tri-state classifier (P1-2): UNAVAILABLE is correct
  fail-closed semantics for an auto-approval decision.
- Sync vs async seam (P1-3): do NOT mutate
  isToolAutoApproved(); use existing async approval seam.
- isEditTool() conservation (P1-5): production ACT's
  Phase 0 must inventory each member; either include
  or explicitly record as successor/unchanged.
- Path-boundary containment (P1-8): use canonical-realpath
  predicate (path.relative), NOT string prefix matching.
- Defect naming (P1-7): EXTERNAL_EDIT_AUTO_APPROVAL_CONTRACT_
  UNIMPLEMENTED is correct.
- Legacy field reactivation (P1-8): reuse editFilesExternally
  as a deliberate ClineMM compatibility choice.

### Important implementation consequence

The reviewer flagged one critical implementation consequence:

```text
Does the editor executor itself reject relative ../outside
paths even after approval?

B currently passes by refusing traversal at the lexical
check (editor.ts:60-62). That creates a potential
policy/executor mismatch:
  classifier: ../outside/file -> OUTSIDE
  policy:     editFiles=true + external=true -> ALLOW
  executor:   may still reject relative traversal

Because current upstream editor schema describes the tool
path as an "absolute path", this may simply be an
invalid-input conservation case rather than a product bug.
```

This is frozen in the production ACT as:

```text
EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY
```

If Phase 0 finds that ClineMM's edit-tool request shape
ALSO accepts non-absolute paths (legacy aliases or apply_patch
variants), then the ACT must additionally bind:

```text
approved relative-outside must be handled consistently
```

### Phase 0 binding list (frozen from reviewer verdict)

The production ACT's Phase 0 must bind only these six things:

```text
ASYNC_CLASSIFICATION_SEAM
EDITOR_PATH_CONTRACT
EDIT_TOOL_REQUEST_PATH_EXTRACTION
EXTERNAL_POLICY_STORAGE_FIELD
isToolAutoApproved_sync_OR_async
isEditTool_members_conserved
```

### Required RED layers (frozen from reviewer verdict)

```text
R1 CLASSIFIER
  canonical inside
  absolute outside
  symlink effective outside
  nonexistent target
  unavailable

R2 PURE POLICY
  exact 5-row lattice + unavailable

R3 COORDINATOR
  outside/external-off -> ASK
  deny -> no execution
  approve -> execution

R4 AUTO-APPROVAL
  outside/external-on -> direct execution

R5 CONSERVATION
  inside/editFiles-on unaffected
  editFiles-off always ASK
  other real edit tools follow same contract or are
  explicitly bound as successor
```

### Necessity ablation (frozen from reviewer verdict)

Disable only the classification -> policy composition:

```text
outside + external=false
-> silently auto-approved again
```

Then restore. That proves the new composition is load-bearing.

### Factory classification (reviewer verdict)

```text
P0              : NONE
P1              : wording/layering only
                  "non-approved outside executor refuses"
                  must become
                  "denied approval means executor not invoked"
P2              : none material
RECON           : CLOSED
APPROVAL_SEMANTICS : BOUND
PRODUCTION_ACT  : AUTHORIZED
```

### Reviewer's note on tooling residue

> The digest's embedded gate-summary and generator binding
> remain invalid/non-authoritative, but that is unrelated
> Factory tooling residue and should not delay this lane.

(Confirmed: the gate-summary.json and generator bindings
are unrelated; this ACT does not touch them.)

### Final acknowledgement

The recon ACT's CYCLE7 corrections (six P1 + one P2) are
complete. The bounded P1 wording correction is the only
remaining CYCLE7 work, and it lives in the production ACT
as the first line of Phase 0. The recon lane is closed;
no further recon cycles are required for this surface.

## EV_VERDICT_REVIEWER_ON_CYCLE1_OPENER (production ACT opening)

This block documents the Factory reviewer's verdict on the
docs/evidence-only opening of production ACT
ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 (commit
148e30c17, "CYCLE1 opener" of the production ACT).

### Verbatim disposition

```text
P0                : NONE
P1                : NONE in this opening commit
PHASE-0 REQUIREMENT : bind multi-target request aggregation
                      if apply_patch is active
P2                : ABSOLUTE_ONLY should be confirmed from
                    ClineMM source, not treated as proven
                    merely from upstream schema
RECON LANE        : CLOSED
PRODUCTION ACT    : OPEN
NEXT              : PHASE 0 BIND -> RED immediately
```

### Phase 0 binding status

All six reconfirmations (ASYNC_CLASSIFICATION_SEAM,
EDIT_TOOL_REQUEST_PATH_EXTRACTION, EXTERNAL_POLICY_STORAGE_FIELD,
isToolAutoApproved_sync_OR_async, LOWEST_EXISTING_ASYNC_SEAM,
isEditTool_members_conserved) plus the two follow-up
corrections (multi-target aggregation; source-confirmed
ABSOLUTE_ONLY) are BOUND in the production ACT evidence at
.factory/evidence/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01/phase0-reconfirmation.md.

Each binding cites the file:line in the current ClineMM source.

### Six-fact binding table (excerpt)

| fact                                 | bound value                                                                                                                                                            |
|--------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ASYNC_CLASSIFICATION_SEAM            | sdk-interaction-coordinator.ts:326 handleRequestToolApproval                                                                                                          |
| EDIT_TOOL_REQUEST_PATH_EXTRACTION    | editor: EditFileInputSchema.path; apply_patch: Patch.actions Record<string,PatchAction>; legacy aliases via message-translator.ts:720-724                              |
| EXTERNAL_POLICY_STORAGE_FIELD        | settings.actions.editFilesExternally (AutoApprovalSettings.ts:18, legacy field reactivated for ClineMM)                                                                |
| isToolAutoApproved_sync_OR_async     | SYNC (sdk-tool-policies.ts:1072-1077)                                                                                                                                  |
| LOWEST_EXISTING_ASYNC_SEAM           | sdk-interaction-coordinator.ts:326 handleRequestToolApproval (insert BEFORE the short-circuit at :510/:521)                                                            |
| isEditTool_members_conserved         | 5-member set at sdk-tool-policies.ts:69, INCLUDED for editor/apply_patch, SUCCESSOR for replace_in_file/write_to_file/delete_file                                      |
| REQUEST_CLASS_AGGREGATION (P1)       | unavailable > outside > inside (per-target TargetEvidence[] reduced by pure policy)                                                                                    |
| EDITOR_PATH_CONTRACT (P2)            | ABSOLUTE_ONLY (EditFileInputSchema docstring schemas.ts:205 + executor resolveFilePath absolute-passthrough behavior)                                                  |

### Reviewer's quote on the bound architecture

> The frozen shape is the one I would implement:
>
> ASYNC filesystem classification
>     v
> immutable evidence
>     v
> PURE approval policy
>     v
> approval coordinator
>     v
> existing executor
>
> Do not make isToolAutoApproved() async.

This ACT's Phase 0 binding matches the reviewer's expected
implementation shape exactly. No edits required to the
recon lane.

### Confirmation of the CYCLE7 corrections carryover

The CYCLE7 reviewer's P1 wording correction (applied in the
production ACT §3 and §5 R3) is preserved by this Phase 0
binding. The opener-receiver reviewer's P1 (multi-target
aggregation) and P2 (source-confirmed ABSOLUTE_ONLY) are
new additions that the CYCLE7 reviewer did not flag because
the production ACT's opener commit had not yet bound the
relevant seams.

### Factory classification (this reviewer verdict)

```text
P0                  : NONE
P1                  : NONE
PHASE-0 REQUIREMENT : APPLIED (multi-target aggregation)
P2                  : APPLIED (source-confirmed ABSOLUTE_ONLY)
RECON LANE          : CLOSED
PRODUCTION ACT      : OPEN / PHASE_0_BOUND
NEW_REVIEW_ROUND    : NO
```

The reviewer explicitly said: "C1: GO. No more contract
review. Bind the six facts, add the multi-target aggregation
rule if needed, and get to RED."

The production ACT is now ready to enter Phases 1-4 (RED +
GREEN + necessity ablation) against the bound seams.

## EV_VERDICT_REVIEWER_ON_PHASE0_BINDING_CYCLE1 (production ACT Phase 0 review)

This block documents the Factory reviewer's verdict on the
docs/evidence-only Phase 0 binding commit `a985e774f` for
production ACT ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01.

### Verbatim disposition

```text
P0                  : NONE
P1                  : apply_patch target enumeration incomplete:
                      movePath destination must participate in classification;
                      legacy SUCCESSOR tools must not be claimed as already conserved
P2                  : AsyncLocalStorage should not be prematurely frozen as carrier
PHASE 0             : PASS subject to bounded target-enumeration correction
RECON               : CLOSED
PRODUCTION ACT      : GO TO RED
```

The reviewer explicitly said: "C1: GO after that one bounded
correction. Then write RED immediately — no Phase-0 CYCLE2,
no new planning commit, no more contract review."

### What the reviewer required

The reviewer identified ONE load-bearing P1 (with a tightly
related inventory tightening as a sub-correction) and ONE P2:

**P1 (first half)**: `apply_patch` target enumeration must
enumerate BOTH `Patch.actions` record keys (source paths) AND
`PatchAction.movePath` (move destinations). The previous
algorithm `Object.keys(patch.actions)` would have classified
`inside source → outside move target` as INSIDE and silently
auto-approved an outside write, defeating the external-edit
rule.

Frozen enumeration:

```ts
for each (sourcePath, action) in patch.actions:
    targets += sourcePath
    if action.movePath exists:
        targets += action.movePath
```

**P1 (second half)**: The isEditTool inventory split must
distinguish "conservation proven" (editor + apply_patch) from
"existing behavior preserved" (replace_in_file + write_to_file
+ delete_file). The previous "All five share the same
classification lattice … R5 conservation therefore holds for
the entire `isEditTool` member set" was TOO BROAD.

Frozen inventory:

```text
CURRENT INCLUDED SURFACE:
  editor
  apply_patch

LEGACY POLICY NAMES:
  replace_in_file
  write_to_file
  delete_file

Disposition:
  preserve existing behavior;
  do not claim target-aware parity until their actual
  approval-time translated request shape is executable
  evidence.
```

**P2**: AsyncLocalStorage inside `handleRequestToolApproval`
is the proven async composition seam but is NOT itself the
correct evidence carrier. Phase 0 binds only the seam; the
carrier choice is deferred to Phase 1-2 with the preferred
shape being a local immutable variable + direct function
parameter passing (NOT ambient ALS).

### Bounded corrections applied in subsequent commit

All three bounded corrections (P1 first half, P1 second half,
P2) were applied to `phase0-reconfirmation.md` and the
production ACT §13 in a follow-up commit, after which the
production ACT is authorized to enter Phases 1-4 (RED + GREEN
+ necessity ablation).

### Factory classification (this reviewer verdict)

```text
P0                  : NONE
P1 (apply_patch target enumeration)
                    : APPLIED (frozen enumeration loop + movePath cases)
P1 (legacy SUCCESSOR conservation tightening)
                    : APPLIED (inventory split)
P2 (AsyncLocalStorage carrier caveat)
                    : APPLIED (Phase 0 binds seam only; carrier is
                      deferred to Phase 1-2 with preferred local-
                      variable shape)
RECON LANE          : CLOSED
PRODUCTION ACT      : OPEN / AUTHORIZED / PHASE_0_BOUND_CORRECTED
NEW_REVIEW_ROUND    : NO
```

The reviewer's authoritative instruction:

> C1: GO after that one bounded correction. Then write RED
> immediately — no Phase-0 CYCLE2, no new planning commit, no
> more contract review.

## EV_R0_REPRODUCTION_PRODUCTION_SEAM (post-bounded-corrections R0 RED)

After the CYCLE1 bounded corrections landed (commit e1016a0e6),
the reviewer issued `HALT_RED_BEFORE_IMPLEMENTATION` and required
the principal RED to be reproduced THROUGH THE REAL coordinator
seam BEFORE any implementation work. That RED has now been
executed and observed:

```text
Test file:
  apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts

Seam: REAL (not mocked):
  - SdkInteractionCoordinator.handleRequestToolApproval
    (apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326)
  - shouldAutoApproveTool wired to isToolAutoApproved
    (apps/vscode/src/sdk/sdk-interaction-coordinator.ts:521)
  - isToolAutoApproved
    (apps/vscode/src/sdk/sdk-tool-policies.ts:1072-1077)
  - Filesystem geometry constructed via realpathSync +
    mkdtempSync + writeFileSync

Observed:
  × R0  OUTSIDE + editFiles=true => expected ASK,
        currently silently ALLOW (defect confirmed).
  ✓ R0b INSIDE + editFiles=true => ALLOW (positive control).
  ✓ R0c OUTSIDE + editFiles=false => ASK (base-disabled control).

Disposition:
  R0 = RED_REPRODUCED. The silent auto-approval bug is the
       load-bearing production defect. The reviewer's
       "HALT_RED_NOT_REPRODUCED" stop rule did NOT fire;
       the seam was reached through constructed geometry.
  R0b + R0c = ALREADY_GREEN. They prove the existing seam is
       wired correctly for the cases it currently handles;
       the missing branch is the OUTSIDE+editFiles=true case.

Phase ordering updated:
  PHASE 1 RED FIRST (DONE)
  PHASE 2 Bounded repair (NEXT, on RED)
  PHASE 3 apply_patch + R3/R4 integration + R5 conservation
  PHASE 4 Necessity ablation

The reviewer's authoritative instruction:
  "Once R0 is demonstrably RED, proceed: PHASE 2 add
   classifier + pure policy."

PHASE 2 is AUTHORIZED to begin in the next commit, by the same
ACT. No new planning commit, no new recon cycle, no more
contract review. PHASE 2 implementation begins in the next
commit.

## EV_PHASE_2_GREEN_BOUNDED_REPAIR_COMPLETED (commit 861e18502)

PHASE 2 (the bounded repair authorized by the reviewer's
`PASS_RED_REPRODUCED + GO TO BOUNDED REPAIR` verdict) is
implemented + verified in commit 861e18502.

The principal defect (silent auto-approval of editor /
apply_patch requests targeting OUTSIDE the workspace when
`editFiles=true`) is fixed at the lowest existing async seam
in `sdk-interaction-coordinator.ts:548`.

### Layer contract (unchanged from Phase 0)

```
async classifier          (apps/vscode/src/sdk/editor-path-authority.ts)
        ↓
immutable evidence
        ↓
pure policy lattice       (apps/vscode/src/sdk/editor-auto-approval-policy.ts)
        ↓
coordinator composition   (apps/vscode/src/sdk/sdk-interaction-coordinator.ts:548)
        ↓
unchanged executor        (NEVER asks policy)
```

`isToolAutoApproved` stays SYNC. The legacy boolean short-circuit
is REPLACED for the CURRENT INCLUDED SURFACE (`editor` +
`apply_patch`) ONLY. Every other tool (read / browser / MCP /
legacy edit names: replace_in_file / write_to_file / delete_file)
keeps the existing behavior unchanged.

### Test coverage (61/61 pass on the touched suite)

  R1 classifier: 6 cases (real filesystem geometry)
  R2 lattice:    8 cases (pure, no fs I/O)
  R0 GREEN:      4 cases (real coordinator seam)
  pre-existing interaction-coordinator suite: 43/43 pass

The renamed test
`editor-effective-destination-approval.r0-red.test.ts` →
`editor-effective-destination-approval.r0-green.test.ts`
documents the RED→GREEN transition. The test history section
in the header cross-references commit 1aaa65a84 (RED) and
861e18502 (GREEN).

### Conservation

  editor inside + editFiles=true                       => unchanged ALLOW
  editor outside + editFiles=true + external=true      => ALLOW
  editor outside + editFiles=true + external=false     => MUST ASK
  editor outside + editFiles=false                     => MUST ASK
  editFiles=false (any target)                         => MUST ASK
  classification unavailable                          => ASK (fail closed)
  non-edit tool                                        => unchanged
  apply_patch inside-only                              => unchanged (PHASE 3)
  apply_patch inside->outside move                     => ASK when external=false
                                                          (PHASE 3 — text extraction
                                                           frozen in Phase 0 §1.2)

### PHASE 3 / PHASE 4 remain (explicitly out of scope of this commit)

  PHASE 3 apply_patch movePath integration + R3/R4
          deny/approve/direct ALLOW integration + R5 conservation
  PHASE 4 Necessity ablation (require R0 to return to
          silent ALLOW while R0b stays ALLOW + R0c stays ASK)

Both are scoped to subsequent ACTs / commits per the
reviewer's MAX REVIEW/FIX CYCLE = ONE directive.

## EV_PHASE_2_CORRECTION01_BOUNDED_REPAIR_COMPLETED (commit 93d4bd746)

Per the factory reviewer's `HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS` verdict
on commit 861e18502, CORRECTION01 was opened and is now COMPLETE.

### P0 closed

MULTI_TARGET_UNAVAILABLE_ORDER_BYPASS. The pre-CORRECTION01 aggregator
was mutation-order dependent; `[UNAVAILABLE, OUTSIDE]` produced aggregate
`outside` (last-wins). The lattice then ALLOWed the request under
`editFiles=true + editFilesExternally=true`. Two invariants violated:

  FAIL_CLOSED          — UNAVAILABLE must dominate
  PERMUTATION_INVARIANCE — verdict must not depend on iteration order

Post-CORRECTION01: `aggregateClassifications(classifications)` is a
Set-test over the complete array; any permutation yields the same
verdict. Severity: UNAVAILABLE > OUTSIDE > INSIDE.

### P1 (relative paths) closed

`classifyEditTarget` now resolves the requested path against
`canonicalRoot` BEFORE realpath + containment. The parameter is renamed
from `absoluteRequestedPath` to `requestedPath` to reflect the new
contract.

### P1 (apply_patch extractor) qualified

10-test grammar matrix added (Add / Delete / Update / Update+Move /
multi-file / malformed / inside-source-outside-move-destination /
Update-without-Move-no-false-positive / editor regression / non-edit-
tool-empty). All GREEN on the existing extractor; the suite is the
qualification evidence.

### P1 (fallback) closed

The `targetAwareOptionsWired` guard around the editor/apply_patch
composition is REMOVED. The legacy boolean short-circuit NEVER applies
to editor/apply_patch. Missing options now produce ASK with explicit
"workspace root unavailable" / "auto-approval settings unavailable"
reasons.

### Verifier output (verbatim)

  Test Files  8 passed (8)
       Tests  87 passed (87)

  bunx tsc --noEmit: clean
  bunx biome lint on 11 touched files: 0 fixes applied

### Conservation (R5) — load-bearing preserved

  editor inside + editFiles=true                  => unchanged ALLOW
  editor outside + editFiles=true + external=true => ALLOW
  editor outside + editFiles=true + external=false=> MUST ASK
  editor outside + editFiles=false                => MUST ASK
  editFiles=false (any target)                    => MUST ASK
  classification unavailable                     => ASK (fail closed)
  non-edit tool                                   => unchanged
  apply_patch inside-only                         => unchanged
  apply_patch inside->outside move                => ASK when external=false
  RELATIVE target inside workspace                => INSIDE (NEW)
  RELATIVE target outside workspace               => OUTSIDE (NEW)
  MULTI-TARGET [UNAVAILABLE, OUTSIDE]             => UNAVAILABLE (NEW; P0)
  missing getCwd/getAutoApprovalSettings          => ASK (NEW; P1 fallback)

### PHASE 3 / PHASE 4 remain

PHASE 3 (apply_patch movePath integration + R3/R4 deny/approve/direct
ALLOW + R5 conservation) and PHASE 4 (necessity ablation) are
AUTHORIZED for the next ACT / commit. The bounded CORRECTION01 cycle
is closed.

## EV_PHASE_2_CORRECTION02_BOUNDED_REPAIR_COMPLETED (commit 00d71e51c)

Per the factory reviewer's `HALT_TOOL_POLICY_PRECEDENCE_REGRESSION` verdict
on commit 93d4bd746, CORRECTION02 was opened and is now COMPLETE.

### Frozen ClineMM EDIT-TOOL precedence (CORRECTION02)

Resolution: **Option B (path authority is hard safety envelope) WITH
explicit host-level escape hatch (priority 1)**.

```text
1.  request.policy.autoApprove === true                => ALLOW (override)
2.  otherwise (default ClineMM host wiring forces
    autoApprove=false for editor/apply_patch at SDK seam):

    a.  getCwd() unavailable          => ASK (fail closed)
    b.  getAutoApprovalSettings() unavailable => ASK
    c.  classification=inside + editFiles=true => ALLOW
    d.  classification=outside + editFilesExternally=true => ALLOW
    e.  classification=outside + editFilesExternally=false => ASK
    f.  classification=unavailable    => ASK (fail closed)
```

The default ClineMM VSCode host wiring forces `autoApprove=false` for
editor/apply_patch at the SDK seam (`sdk-tool-policies.ts:64`), so the
priority-1 override is a no-op in the VSCode host path. It exists so
embedded/JetBrains consumers that wire `toolPolicies` directly (without
`buildToolPolicies`) get the documented SDK behavior.

### P0 closed

`request.policy.autoApprove === true` is now the OUTERMOST priority for
editor/apply_patch. The new override branch returns ALLOW with
`decision.source = "sdk-policy-autoApprove"`. Non-edit tools, command
tools, and editor/apply_patch with `autoApprove=false` all retain
their existing behavior.

### P1 closed (test-quality improvement)

The missing-options fallback tests previously used a 100 ms Promise.race
timeout. CORRECTION02 changes the helper to return the task proxy and
the assertions now mechanically check:

```ts
await vi.waitFor(
    () => expect(task.messageStateHandler.getClineMessages()).toHaveLength(1)
)
const [message] = task.messageStateHandler.getClineMessages()
expect(message).toMatchObject({ type: "ask", ask: "tool", partial: false })
expect(coordinator.resolvePendingToolApproval(undefined, "noButtonClicked")).toBe(true)
await expect(promise).resolves.toMatchObject({ approved: false })
```

A timeout-based assertion can no longer pass for an unrelated hang.

### P2 closed (ASK-decision carrier residue)

`handleEditorOrApplyPatchApproval()`'s ASK return path now carries
`decision: { kind: "ask", reason, source }` matching the shape the
`pendingToolApprovalMessage` consumer expects. The dead/null carrier
residue is gone.

### P2 closed (nearest-existing-ancestor fsRoot skip)

`resolveNearestExistingAncestor()` now tries `fsRoot` itself before
giving up. `/does/not/exist` resolves to canonical `/`, which lies
OUTSIDE any real workspace, so the verdict becomes OUTSIDE instead of
UNAVAILABLE. The r1-classifier test expectation is updated accordingly.

### Verifier output (verbatim)

  Test Files  9 passed (9)
       Tests  94 passed (94)

  bunx tsc --noEmit: clean
  bunx biome check on 5 touched files: 0 fixes applied

### Conservation (R5) — load-bearing preserved

  request.policy.autoApprove=true + ANY target (editor/apply_patch)
       => ALLOW (NEW; explicit override)
  request.policy.autoApprove=false + INSIDE + editFiles=true (editor/apply_patch)
       => unchanged ALLOW via target-aware composition
  request.policy.autoApprove=false + OUTSIDE + editFilesExternally=true
       => ALLOW via target-aware composition
  request.policy.autoApprove=false + OUTSIDE + editFilesExternally=false
       => unchanged ASK
  classification unavailable for editor/apply_patch => unchanged ASK
  non-edit tool (read/browser/MCP/legacy edit names)
       => unchanged (legacy short-circuit still applies)
  command tool with no atomic evaluator
       => unchanged (legacy short-circuit still applies)
  editFiles=false (any target) => unchanged ASK
  relative paths => unchanged (CORRECTION01 fix preserved)
  multi-target dominance => unchanged (CORRECTION01 fix preserved)
  nearest-existing-ancestor => OUTSIDE for /-reachable ancestors (CORRECTION02 fix)

### PHASE 3 / PHASE 4 remain

PHASE 3 (apply_patch movePath integration + R3/R4 deny/approve/direct
ALLOW + R5 conservation) and PHASE 4 (necessity ablation) are
AUTHORIZED for the next ACT / commit. The bounded CORRECTION02 cycle
is closed.

## EV_PHASE_2_CORRECTION03_BOUNDED_REPAIR_COMPLETED (commit fa2710da4)

Per the factory reviewer's `HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS`
verdict on commit 00d71e51c, CORRECTION03 was opened and is now COMPLETE.
Per the reviewer's directive ("stop reviewing Phase 2 and move directly
through Phase 3 + necessity ablation in one ACT"), this is the final
bounded Phase-2 repair; PHASE 3 and PHASE 4 are GREEN without new
production changes.

### The defect the reviewer identified

Pre-CORRECTION03 `resolveNearestExistingAncestor()` walked upward using
`fs.realpathSync(current)` success as the existence test. That conflated:

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

EFFECTIVE DESTINATION = OUTSIDE; CLASSIFICATION = INSIDE; HOST POLICY =
editFiles=true external=false; RESULT = SILENT ALLOW.

### Critical correctness note discovered during RED reproduction

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

### The new algorithm (frozen CORRECTION03)

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

### Production change (1 file)

  apps/vscode/src/sdk/editor-path-authority.ts
    - resolveNearestExistingAncestor() rewritten to use lstatSync
      (lexical existence) instead of realpathSync (canonicalizing
      existence) for the upward-walk predicate.
    - resolveNearestExistingAncestor() now returns undefined when
      the deepest lexically-existing component is itself an
      unresolvable symlink, causing classifyEditTarget() to map
      to UNAVAILABLE (fail closed).
    - Docstring header §3 extended with CORRECTION03 invariant
      documentation.

### Required RED tests added (3 RED initially, 4 GREEN post-fix)

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

### PHASE 3 — apply_patch movePath GREEN via CORRECTION01

The PHASE 3 scope (apply_patch movePath integration) is already
covered by the correction01-apply-patch-matrix.red.test.ts RED suite
(10 cases). PHASE 3 does not require new production code; the 98/98
verifier output proves the CORRECTION03 algorithm preserves the
movePath enumeration behavior:

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

### PHASE 4 — necessity ablation analysis

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
The CORRECTION03 algorithm is the minimal-necessary refinement —
it preserves the file-creation behavior while closing the
dangling-symlink bypass that the OLD realpath-success predicate
permitted.

A bespoke symlink-resolution engine (parsing symlink targets) is
NOT necessary. `UNAVAILABLE` is already fail-closed in the policy
lattice, so returning `undefined` from the fallback is sufficient
authority to halt the edit.

### Verifier output (verbatim, commit fa2710da4)

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

### Conservation (R5) — load-bearing preserved

  request.policy.autoApprove=true + ANY target (editor/apply_patch)
       => ALLOW (CORRECTION02 frozen precedence preserved)
  request.policy.autoApprove=false + INSIDE + editFiles=true
       => unchanged ALLOW via target-aware composition
  request.policy.autoApprove=false + OUTSIDE + editFilesExternally=true
       => unchanged ALLOW via target-aware composition
  request.policy.autoApprove=false + OUTSIDE + editFilesExternally=false
       => unchanged ASK
  classification unavailable for editor/apply_patch => unchanged ASK
  non-edit tool (read/browser/MCP/legacy edit names)
       => unchanged (legacy short-circuit still applies)
  command tool with no atomic evaluator
       => unchanged (legacy short-circuit still applies)
  editFiles=false (any target) => unchanged ASK
  relative paths => unchanged (CORRECTION01 fix preserved)
  multi-target dominance => unchanged (CORRECTION01 fix preserved)
  existing symlink INSIDE -> OUTSIDE
       => OUTSIDE (unchanged — realpath resolves the escape; the
            lexical ancestor walk never sees this case because
            realpath(target) succeeds)

  New conservation invariants introduced:

    workspace/dangling-leaf (symlink, target absent)
        => UNAVAILABLE (CORRECTION03 fix)
    workspace/dangling-dir (parent symlink, target absent)
    + child path
        => UNAVAILABLE (CORRECTION03 fix)
    workspace/new-file-that-does-not-exist.txt
        (parent is a regular directory)
        => INSIDE (conservation — ordinary file creation; T4)
    /definitely-not-a-real-mount-zzz/a/b/c/file.txt
        => OUTSIDE (CORRECTION02 fsRoot fix preserved)
    apply_patch Update + Move => both source AND destination
        classified (CORRECTION01 fix preserved)

### PHASE 2 / 3 / 4 disposition

  PHASE 2: COMPLETE (PHASE 2 + CORRECTION01 + CORRECTION02 + CORRECTION03)
  PHASE 3: GREEN (already covered by CORRECTION01; no new production changes)
  PHASE 4: COMPLETE (necessity ablation analyzed; lexically-existing-ancestor
                     walk is minimal-necessary)

### Reviewer chain

  PASS_RED_REPRODUCED (commit 861e18502)            — PHASE 2 GREEN
  HALT_MULTI_TARGET_FAIL_CLOSED_BYPASS             — CORRECTION01 (commit 93d4bd746 GREEN)
  HALT_TOOL_POLICY_PRECEDENCE_REGRESSION           — CORRECTION02 (commit 00d71e51c GREEN)
  HALT_DANGLING_SYMLINK_EFFECTIVE_DESTINATION_BYPASS
                                                    — CORRECTION03 (commit fa2710da4 GREEN)

Per the reviewer's directive, the bounded Phase-2 cycle is closed.

## EV_PHASE_2_CORRECTION03_QUALIFICATION_COMPLETED (commit 60389ad88)

Per the factory reviewer's `PASS_CORRECTION03 — C1: GO TO QUALIFICATION`
verdict, the production algorithm is FROZEN. No more production review
cycles. Stop changing the classifier.

The qualification/closure pass executes:

  P1  PHASE_3_COMPOSED_MOVEPATH_FLOW    EXECUTED (R3a/R3b/R3c)
  P1  PHASE_4 necessity ablation        EXECUTED (R4-1/R4-2/R4-3)
  P2  CORRECTION03 fixture cleanup      CLOSED (rmSync insideDir)
  P2  Stale fs.existsSync wording       CLOSED (header now says fs.lstatSync)

### R3 — composed apply_patch Move to: approval/execution flow (NEW)

Three new GREEN tests against the REAL coordinator seam. The 10-case
correction01-apply-patch-matrix proves target extraction. CORRECTION02
proves the priority 2c/2d/2e policy components individually. R3 proves
the COMPOSED flow end-to-end on the real coordinator boundary.

  R3a inside source + outside move + editFilesExternally=false
       => ASK
       (mechanically proven via messageStateHandler card publication;
        resolves to approved=false via noButtonClicked)

  R3b inside source + outside move + editFilesExternally=false +
       yesButtonClicked
       => move permitted (approved=true propagates through the
          pending resolve)
       (proves the gate, when approved by the user, actually permits
        the operation)

  R3c same move + editFilesExternally=true
       => direct ALLOW (priority 2d outside+external bypass)

### R4 — necessity ablation (NEW, executed not just argued)

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
production classifier parameter. No production switch. No env flag.
No module mutation.

  NECESSITY_ARGUMENT = PROVEN_STRUCTURALLY
  NECESSITY_ABLATION = PROVEN_BY_EXECUTED_ABLATION          (was: NOT_EXECUTED)

### P2 hygiene (NEW, closed)

  - correction03 test now rmSync(insideDir) in afterAll() alongside
    outsideDir. Per-run residue eliminated.
  - editor-path-authority.ts header §3 replaced the failed first-repair
    primitive reference (fs.existsSync, which FOLLOWS SYMLINKS on macOS)
    with the actual CORRECTION03 primitive (fs.lstatSync, which does
    NOT follow symlinks) plus an explanation of why existsSync was wrong.

### Verifier output (verbatim, commit 60389ad88)

  Test Files  12 passed (12)
       Tests  104 passed (104)        (was: 98 passed across 10 files)

  bunx tsc --noEmit: clean
  bunx biome check on 4 touched files: clean

### Disposition

  PHASE 2: COMPLETE
  PHASE 3: GREEN
  PHASE 4: COMPLETE
  REVIEWER CYCLE: CLOSED (PASS_CORRECTION03 — C1 GO_TO_QUALIFICATION)
  PRODUCTION ALGORITHM: FROZEN (no more production review cycles)

  Remaining (live qualification, out of bounded cycle):
    - exact-head VSIX build
    - installed source binding
    - real UI ASK
    - approve -> actual mutation
    - external=true live bypass
