# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 13-final-report

```text
ACT_ID                =
  ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

VERDICT               =
  PASS_OUTSIDE_CWD_MUTATION_PROVEN
  AUTHORITY_VIOLATION   = SEMANTICS_BOUND_FROM_SOURCE
  (CYCLE6 — per Factory reviewer verdict on commit 78b6361eb
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
       (2) EDITFILES_EXTERNALLY_LEGACY_NOOP_DEADCODE
           (proven by this CYCLE6 source trace - UI toggle
            persists but no policy code reads it)

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
  CYCLE6_HEAD          = <to be filled at CYCLE6 commit>
                         (cycle6: Phase-0 discriminator answered
                                  from source; semantics bound)
  FINAL_HEAD           = <to be filled at CYCLE6 commit>
  FINAL_TREE           = <to be filled at CYCLE6 commit>
  WORKTREE_STATUS      = mixed at start of CYCLE6
                          tracked  : clean (10 files from CYCLE5 commit
                                     still in HEAD 78b6361eb)
                          untracked: none
                          modified : 2 files (this final report +
                                     entry-freeze.txt; NEW file
                                     14-phase0-source-trace.md added)
                          expected : CYCLE6 commit will fold all
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
                       AUTHORITY_VIOLATION = SEMANTICS_BOUND_FROM_SOURCE
                       (CYCLE6 Phase-0 discriminator answered:
                        editFilesExternally is a NO-OP legacy
                        field; the actual gate is editFiles,
                        which controls ASK vs silent ALLOW,
                        not inside vs outside classification.
                        Two independent defects identified:
                        (1) EDITOR_EFFECTIVE_DESTINATION_
                            CLASSIFICATION_MISSING
                        (2) EDITFILES_EXTERNALLY_LEGACY_
                            NOOP_DEADCODE
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
