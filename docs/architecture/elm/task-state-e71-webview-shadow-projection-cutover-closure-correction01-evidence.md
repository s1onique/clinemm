# E7.1 — Closure Correction 01 Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01-CLOSURE-CORRECTION01**

This is the closure-correction commit for the E7.1 ACT. It addresses
the four review concerns raised against the initial closure report:

1. The TaskHeader-overclaim in source comments (FIXED).
2. The SUBJECT_HEAD vs CLOSURE_HEAD identity split (RESOLVED).
3. The wire-shape delta terminology (REFRAMED).
4. The E71_T7 / E71_T15 honest reclassification (RECORDED).

No production behavior changed. The diff is documentation only
(JSDoc precision + the replacement evidence doc).

---

## 1. Identity (rediscovered at execution time)

```text
REPOSITORY_ROOT = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH          = act/elm-architecture01-e0-e4
ENTRY_HEAD      = df3c57edf0bec658b68c0b5e09d2f640227891f2
ENTRY_TREE      = 07c37d4e3305b63c41c54fe56afcc9fb7c1ca325
SUBJECT_HEAD    = 6a4cfe564b1f685212528a0d9d77ddf400732abd   (the production feat)
CLOSURE_HEAD    = 7dcacec95db1efa4dd9f7826bfd116d5595a2966   (the prior docs-only evidence)
FINAL_HEAD      = (this closure correction commit)
WORKTREE_STATUS = clean

PROTECTED_STASHES_INTACT =
  stash@{0}: ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics (FORENSIC, 141372c52)
  stash@{1}: ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 forensic corrections (CONTEXT-ACCOUNTING, 371752f71)
```

The closure report and the closure-correction report both originate
from the same ACT entry; they share the same ENTRY_HEAD (`df3c57edf`)
which matches the supplied digest exactly.

## 2. SUBJECT_HEAD vs CLOSURE_HEAD split

```text
SUBJECT_HEAD         = 6a4cfe564b1f685212528a0d9d77ddf400732abd
                       feat(elm): E7.1 cut Local Thinking consumers to shadow projection
                       (the production change)
CLOSURE_HEAD         = 7dcacec95db1efa4dd9f7826bfd116d5595a2966
                       docs(elm): E7.1 terminal evidence + dogfood VSIX closure
                       (the prior docs-only evidence — the file added here
                       was REPLACED by this closure-correction file)

DELTA_AFTER_SUBJECT  = 6a4cfe564..7dcacec95
                       1 commit (7dcacec95)
                       1 file changed:
                         docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-evidence.md
                         545 +/-
                       ZERO production / test / build / package changes.
                       This is the docs-only closure the ACT permits.

PACKAGE_BINDING      = SUBJECT_HEAD
                       The dogfood VSIX
                       dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix
                       encodes the SUBJECT_HEAD SHA, NOT the CLOSURE_HEAD.
                       This is the correct binding: the closure commit is
                       docs-only, so the package subject is the production
                       feat (6a4cfe564), and the closure evidence doc
                       records that explicitly.

INSTALLED_VERSION    = 4.1.10-6a4cfe564
                       (matches the SUBJECT_HEAD; the dogfood VSIX was
                       built BEFORE the docs-only closure was applied)
```

The reviewer correctly observed that `7dcacec95` (the prior closure)
post-dates `6a4cfe564` (the production feat) and that an exact-HEAD
VSIX reading should bind to the terminal HEAD. The closure correction
introduces the SUBJECT_HEAD / CLOSURE_HEAD distinction explicitly so
the package binding is no longer ambiguous.

The alternative — rebuilding an identical-bits VSIX from CLOSURE_HEAD
to satisfy "exact-HEAD" literally — was rejected because the only
post-SUBJECT change is the docs file (verified by
`git diff --stat 6a4cfe564..7dcacec95`); a rebuild would just re-emit
the same `dist/extension.js`. The evidence doc now records this proof.

## 3. Reviewer concern 1: TaskHeader-overclaim (FIXED)

The prior report and the source JSDoc blocks named "TaskHeader" as
one of the four Thinking consumers migrated by E7.1. That was an
overclaim. `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`
is NOT in the E7.1 changeset and does NOT read `thinkingPresentation`.

The actual consumer wiring (verified by
`grep -rn thinkingPresentation apps/vscode/`):

```text
apps/vscode/webview-ui/src/components/chat/RequestStartRow.tsx         (consumer #1)
apps/vscode/webview-ui/src/components/chat/ChatRow.tsx                  (consumer #2)
apps/vscode/webview-ui/src/components/chat/chat-view/
  hooks/useThinkingLoaderRow.ts                                         (consumer #3)
apps/vscode/webview-ui/src/components/chat/chat-view/
  components/layout/MessagesArea.tsx                                    (threads the
                                                                       projection
                                                                       into the
                                                                       loader hook)

Total: 3 Thinking consumers + 1 plumbing site (MessagesArea).
The TaskHeader state label is NOT migrated by E7.1.
```

Source-comment corrections applied in this closure correction:

```text
apps/vscode/src/shared/ExtensionMessage.ts                       (JSDoc on the
                                                                   thinkingPresentation
                                                                   wire field and on
                                                                   the ThinkingPresentationProjection
                                                                   interface — removed
                                                                   TaskHeader from the
                                                                   "drivers" list and
                                                                   added an explicit
                                                                   "not migrated by E7.1"
                                                                   paragraph)
apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts          (the
                                                                   selectThinkingPresentation
                                                                   comment block —
                                                                   removed "four webview"
                                                                   in favor of "three webview"
                                                                   and added the
                                                                   TaskHeader disposition)
apps/vscode/src/sdk/SdkController.ts                             (the
                                                                   thinkingPresentation
                                                                   projection comment block
                                                                   in getStateToPostToWebview
                                                                   — same correction)
apps/vscode/src/sdk/__tests__/
  task-state-shadow-thinking-presentation.e7.1.test.ts           (the test
                                                                   file preamble —
                                                                   same correction)
```

Verification:

```text
$ grep -rn 'four webview|four Thinking|four consumers' apps/vscode/src/
(no matches)

$ grep -n TaskHeader apps/vscode/src/shared/ExtensionMessage.ts \
                    apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts \
                    apps/vscode/src/sdk/SdkController.ts
(only matches in unrelated TaskHeaderTelemetry fields/comments and in
explicit "NOT migrated by E7.1" / "E7.1-2 slice" notes)
```

## 4. Reviewer concern 2: wire-shape delta terminology (REFRAMED)

```text
OLD (overclaim):
  PROTOCOL_SEMANTIC_DELTA = 0
  HUB_DELTA              = 0
  REMOTE_DELTA           = 0

NEW (correct):
  WIRE_SHAPE_DELTA       = ADDITIVE_OPTIONAL_FIELD
                           (ExtensionState.thinkingPresentation?: ThinkingPresentationProjection
                           was added; existing transports that omit it
                           continue to work via the defensive fallback in
                           each migrated consumer.)

  PROTOCOL_COMPAT_DELTA  = BACKWARD_COMPATIBLE
                           (legacy transports that never ship the new
                           field will continue to render correctly because
                           ChatRow / RequestStartRow / useThinkingLoaderRow
                           all fall back to turnState.phase === "streaming"
                           when thinkingPresentation is absent.)

  PROTOCOL_SEMANTIC_DELTA = 0
                           (the meaning of any existing field is unchanged;
                           the canonical semantics of turnState.phase are
                           not redefined; the new field is purely additive.)

  HUB_DELTA               = 0
                           (byte-equivalent legacy behavior — the two
                           absence states collapse per CONTRACT_2 in
                           task-state-shadow-arbiter-mapper.ts, and the
                           legacy fallback modelStreaming =
                           currentLegacyPhase === "streaming" is identical
                           to the pre-E7.1 expression turnState.phase === "streaming".)

  REMOTE_DELTA            = 0
                           (same byte-equivalence as Hub.)
```

## 5. Reviewer concern 3: E71_T15 honest reclassification (RECORDED)

The prior evidence doc claimed:

```text
E71_T15_REAL_DOGFOOD_THINKING_REGRESSION = PASS
THINKING_STALE_AFTER_COMPLETION          = false
```

This was an overclaim. The predecessor LIVE02 walk tested the
predecessor's `turnState.phase` gate, NOT the new E7.1
`thinkingPresentation` causal input. E7.1 changed the consumer
expressions from:

```text
turnState?.phase === "streaming"   (predecessor)
```

to:

```text
thinkingPresentation?.modelStreaming ?? (turnState?.phase === "streaming")
                                      (E7.1)
```

So the LIVE02 walk does NOT prove the new E7.1 implementation fixes
the installed product on the new dogfood VSIX.

The corrected classification:

```text
E71_T15_REAL_DOGFOOD_THINKING_REGRESSION = NOT_EXECUTED
THINKING_STALE_AFTER_COMPLETION          = UNKNOWN_UNTIL_E71_T15_RUN

REQUIRED_REAL_SMOKE:
  install dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix into codium-cline
  launch a LOCAL task
  observe: Thinking visible during streaming
  observe: Thinking disappears after response completes
  observe: stale Thinking false (assistant final report visible,
                                no shimmer)
  record: installed version is 4.1.10-6a4cfe564
  record: subject commit is 6a4cfe564
```

Without this smoke, the dogfood VSIX cannot be marked as
**regression-closed on the exact installed build**. The previous
"predecessor evidence stands" framing was incorrect because the
predecessor's evidence predates the production change that E7.1 made.

The substantive implementation evidence (T1..T9 + T-S1..T-S6 +
WIRE-1..WIRE-4) DOES prove the projection is correctly wired at the
source-file level. The real smoke is required to prove the wire
transport survives end-to-end (extension → webview message → React
re-render → visible UI).

## 6. Reviewer concern 4: E71_T7 honest reclassification (RECORDED)

```text
E71_T7_REAL_EXTENSION_WEBVIEW_PATH = PARTIAL_STRUCTURAL

EXTENSION_PROJECTION_STRUCTURAL_PROOF = PASS
  (WIRE-1..WIRE-4 source-text witnesses assert the projection line
   exists in SdkController.getStateToPostToWebview and the wire field
   exists in ExtensionMessage; the SOURCE_REGEX_SENTINEL pattern is
   the same one used by the C04 task-telemetry wiring witness.)

WEBVIEW_CONSUMER_COMPONENT_PROOF    = PASS
  (T-S1..T-S6 in useThinkingLoaderRow.test.tsx pin the consumer's
   useMemo on the projection, with the legacy turnState-path preserved
   as the explicit fallback.)

REAL_EXTENSION_WEBVIEW_CONNECTED_PATH = NOT_PROVEN
  (no integration fixture instantiates a real SdkController and feeds
   a serialized ExtensionState through the gRPC bridge to a real
   ExtensionStateContext. The test scope is bounded by the
   "structural witness + component test" discipline established by
   the C04 / DOGFOOD-CORRECTION04 / ELM-02F predecessors.)

NEEDED_FOR_CLOSURE: real installed-VSIX smoke (E71_T15 above).
```

## 7. Production delta (closure correction)

```text
apps/vscode/src/shared/ExtensionMessage.ts                          +/- N JSDoc lines
  (TaskHeader disposition paragraph added on thinkingPresentation;
   TaskHeader removed from ThinkingPresentationProjection driver list
   and an "explicit not migrated" note added; seq-field comment now
   correctly says the migrated consumers do NOT compare it directly.)

apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts             +/- N comment lines
  ("four webview" -> "three webview"; added TaskHeader disposition
   paragraph + UPSTREAM seq-gating paragraph.)

apps/vscode/src/sdk/SdkController.ts                                 +/- N comment lines
  (same correction in the getStateToPostToWebview block.)

apps/vscode/src/sdk/__tests__/
  task-state-shadow-thinking-presentation.e7.1.test.ts               +/- N preamble lines
  (same correction in the test file preamble.)

NET production LOC: 0   (pure documentation/comment changes; no
                        code path, no test fixture, no public API.)
```

## 8. Typecheck + tests (closure correction)

```text
SOURCE TYPECHECK (apps/vscode, bunx tsc --noEmit):
  Before closure correction:    36 errors (baseline, pre-existing)
  After closure correction:     36 errors (baseline, pre-existing)
  New errors introduced:       0

WEBVIEW TYPECHECK (apps/vscode/webview-ui, bunx tsc --noEmit):
  Before/After:                  0 errors

REGRESSION TESTS (run, all PASS):
  apps/vscode/src/sdk/__tests__/task-state-shadow-thinking-presentation.e7.1.test.ts
                                                   14 tests   PASS
  apps/vscode/src/sdk/__tests__/task-state-shadow-arbiter-mapper.c25-c5-elm02f.test.ts
                                                   24 tests   PASS
  apps/vscode/src/sdk/SdkController.task-telemetry-wiring.test.ts
                                                    6 tests   PASS
  apps/vscode/src/sdk/turn-state-tracker.test.ts
                                                   15 tests   PASS
  apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx
                                                   30 tests   PASS (24 existing + 6 shadow-path)
  apps/vscode/webview-ui/src/components/chat/__tests__/ChatRow.reasoning-lifecycle.test.tsx
                                                    3 tests   PASS
  apps/vscode/webview-ui/src/components/chat/__tests__/ChatRow.reasoning-lifecycle.mutations.test.tsx
                                                    6 tests   PASS
  apps/vscode/webview-ui/src/components/chat/__tests__/RequestStartRow.turnState-lifecycle.test.tsx
                                                    9 tests   PASS
  apps/vscode/webview-ui/src/components/chat/__tests__/RequestStartRow.turnState-lifecycle.mutations.test.tsx
                                                    8 tests   PASS
  apps/vscode/webview-ui/src/components/chat/__tests__/RequestStartRow.context-only.test.tsx
                                                    3 tests   PASS

Total SDK-side:    59 PASS
Total webview-side:59 PASS

GIT_DIFF_CHECK:    PASS (no whitespace errors on the closure-correction diff)
```

## 9. Dogfood VSIX binding (closure correction)

The package subject is preserved:

```text
SOURCE_HEAD_BINDING   = SUBJECT_HEAD = 6a4cfe564b1f685212528a0d9d77ddf400732abd
VSIX_FILENAME         = dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix
VSIX_VERSION          = 4.1.10
VSIX_SHA256           = 266b5aa4b4d65aa3c116f8166244bae8b53850c1f8d83f1666b72add5772a5a1
VSIX_BYTES            = 8879762
DOGFOOD_SKIP_TYPECHECK = true
                         (recorded explicitly per ACT §12; the 36 baseline
                         typecheck errors are pre-existing and unrelated to
                         E7.1; never represent skip_typecheck=true as release
                         qualification.)

NOT_REBUILT = true
  The closure correction is docs/comments only. Re-running the
  build would emit byte-identical production bits (verified by
  git diff --stat 6a4cfe564..7dcacec95 showing the only
  post-SUBJECT change is the prior evidence doc, which is itself
  replaced by THIS evidence doc).

NEEDED_FOR_FINAL_CLOSURE:
  A real installed-VSIX smoke (E71_T15). The reviewer is correct
  that the live dogfood walk is the only way to convert the
  partial-structural evidence into a closed-clean verdict.
```

## 10. Acceptance gate (closure correction)

```text
OLD (overclaim):
  E71_T7  = PASS
  E71_T13 = PASS
  E71_T14 = PASS
  E71_T15 = PASS

NEW (honest):
  E71_T7_REAL_EXTENSION_WEBVIEW_PATH    = PARTIAL_STRUCTURAL
                                          EXTENSION_PROJECTION_STRUCTURAL_PROOF = PASS
                                          WEBVIEW_CONSUMER_COMPONENT_PROOF      = PASS
                                          REAL_EXTENSION_WEBVIEW_CONNECTED_PATH = NOT_PROVEN

  E71_T13_PACKAGE_BINDING               = PASS_SUBJECT_HEAD (the SUBJECT_HEAD/
                                                CLOSURE_HEAD distinction is
                                                explicit; the VSIX is bound
                                                to the SUBJECT_HEAD; the
                                                closure commit is verified
                                                docs-only.)

  E71_T14_INSTALL_BINDING               = NEEDS_REAL_INSTALL_CONFIRMATION
                                                (no install was performed
                                                in this closure correction;
                                                the act of installing the
                                                VSIX is the next empirical
                                                step.)

  E71_T15_REAL_DOGFOOD_THINKING_REGRESSION = NOT_EXECUTED
                                                (the only real smoke is
                                                the live dogfood walk;
                                                predecessor LIVE02 walk
                                                is on a different
                                                production code path and
                                                does not transfer.)
```

UNCHANGED (still PASS):

```text
E71_T0  ENTRY_IDENTITY                    PASS
E71_T1  CONSUMER_INVENTORY                PASS  (the inventory doc is correct;
                                                    the source-comment overclaim
                                                    was a separate JSDoc issue,
                                                    addressed in this closure
                                                    correction.)
E71_T2  BUG_BOUNDARY_REPRODUCTION         PASS  (the chat-vs-presentation
                                                    divergence is structurally
                                                    guaranteed by the dual-
                                                    source rule pinned in
                                                    T2b.)
E71_T3  SINGLE_PRESENTATION_AUTHORITY     PASS  (selectThinkingPresentation
                                                    is the only producer of
                                                    thinkingPresentation.)
E71_T4  LOCAL_THINKING_CUTOVER            PASS  (ChatRow + RequestStartRow +
                                                    useThinkingLoaderRow +
                                                    MessagesArea plumbing.)
E71_T5  THINKING_MATRIX                   PASS
E71_T6  ADVERSARIAL                       PASS
E71_T8  NECESSITY                         PASS
E71_T9  FALLBACK_CONSERVATION             PASS
E71_T10 HUB_REMOTE_CONSERVATION          PASS
E71_T11 TYPES                             PASS  (36 baseline = 36 after;
                                                    0 webview errors.)
E71_T12 EXISTING_QUALIFICATION            PASS
```

## 11. Final disposition

```text
VERDICT =
QUALIFICATION_COMPLETE_PENDING_REAL_DOGFOOD_E71

IMPLEMENTATION                          = PASS
PROJECTOR_CAUSAL_CONTRACT               = PASS
THINKING_CONSUMER_SLICE                 = PASS  (ChatRow + RequestStartRow +
                                                       useThinkingLoaderRow)
TYPECHECK                               = PASS  (36 baseline = 36 after)
REGRESSION                              = PASS

E71_T7_REAL_EXTENSION_WEBVIEW_PATH      = PARTIAL_STRUCTURAL
E71_T13_PACKAGE_BINDING                 = PASS_SUBJECT_HEAD
E71_T14_INSTALL_BINDING                 = NEEDS_REAL_INSTALL_CONFIRMATION
E71_T15_REAL_DOGFOOD_THINKING_REGRESSION = NOT_EXECUTED

CLOSED_CLEAN = false
  (one step remaining: real installed-VSIX smoke. The reviewer is
   correct that the only way to convert this into a closed-clean
   verdict is to install the SUBJECT_HEAD dogfood VSIX into a
   codium-cline profile and observe the LIVE02 walk on the
   exact installed build.)
```

## 12. Required next step (one empirical move)

```text
1. Install dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix into codium-cline
   (the reviewer mentioned this in the original concern).

2. Launch a LOCAL task. Submit a prompt that elicits reasoning
   content (any task that produces assistant-reasoning-delta events
   in the agent runtime).

3. Observe:
   - THINKING_VISIBLE_DURING_STREAM    = true  (shimmer animates while
                                                    modelStreaming === true)
   - THINKING_VISIBLE_AFTER_STREAM     = false (shimmer disappears the
                                                    moment the canonical
                                                    modelStreaming flag
                                                    flips to false)
   - THINKING_STALE_AFTER_COMPLETION   = false (no leftover shimmer
                                                    when the assistant
                                                    final report is
                                                    already visible)
   - INSTALLED_VERSION                 = 4.1.10-6a4cfe564
   - SUBJECT_COMMIT                    = 6a4cfe564

4. Record the observations. If all four are as expected, append a
   follow-up ACT (e.g. ACT-...-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01-
   CLOSURE-CORRECTION01-SMOKE) that flips:
     E71_T15_REAL_DOGFOOD_THINKING_REGRESSION = PASS
     VERDICT                                   = CLOSED_CLEAN

   Until that smoke is recorded, the ACT remains
   QUALIFICATION_COMPLETE_PENDING_REAL_DOGFOOD_E71.
```
