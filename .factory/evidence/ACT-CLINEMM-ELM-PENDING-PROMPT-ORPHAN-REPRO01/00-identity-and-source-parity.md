# 00 — Repository and Source Identity / Source Parity

ACT: `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01`
Incident session: `1794840293250_5ugld`
Evidence labels: `REAL` (repository facts), `LIVE` (operator-exported incident bundle)

---

## C0.1 Repository identity

| Fact | Value |
|---|---|
| `HEAD` | `e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1` |
| Branch | `main` |
| `HEAD` subject | `docs(clinemm): ACT-CLINEMM-WORKING-AFTER-COMPLETION-DISCRIMINATOR01 — CAPTURE_INSUFFICIENT` |
| Reported HEAD in ACT brief | `e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1` — **MATCH** |
| Installed incident source | `1d9a37bcd408c185ef356303e1e5ac6237a15307` (`fix(control-seam): ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02 — make the ownership claim genuinely exclusive`) |

### Ancestor verification

```
$ git cat-file -t 1d9a37bcd408c185ef356303e1e5ac6237a15307   -> commit
$ git merge-base --is-ancestor 1d9a37bcd408c185ef356303e1e5ac6237a15307 HEAD
ANCESTOR_YES
```

**The installed incident source IS an ancestor of the current repository HEAD.**

---

## C0.2 Working-tree state

```
$ git status --porcelain=v1 --untracked-files=all
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/fixtures/barrier-timeline.session.jsonl
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/fixtures/completion-authority.session.jsonl
?? .factory/evidence/ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01/fixtures/continuation-events.session.jsonl
?? apps/vscode/src/sdk/__tests__/elm-pending-prompt-orphan-repro01.oppor01.test.ts
```

**No tracked dirt.** All four entries are untracked and are ACT-owned artifacts
(three sanitized source-bound fixtures + the reproduction witness).
`HALT_UNEXPECTED_TRACKED_DIRT` is **not** triggered.

## C0.3 Protected stash inventory (PRESERVED)

```
$ git stash list
stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration
```

One protected stash. **Not popped, not dropped, not modified.**

## C0.4 Existing worktrees (PRESERVED)

```
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm                          e0e30879f [main]
/private/tmp/clinemm-prebase                                                        1f456b971 (detached HEAD) prunable
/private/tmp/worktree-bun.7ddCHQ                                                    bbdccf8a2 (detached HEAD)
/private/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/clinemm-sandbox-temp-1WJufc/clinemm-dogfood-cyoi5ujq/worktree 3147a53b5 (detached HEAD) prunable
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first         38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded               0366ea506 (detached HEAD)
```

No worktree was added, removed, pruned, or modified.

---

## C0.5 Source parity — installed incident source vs current HEAD

Every production file that participates in the causal path was hashed at the
installed revision and at HEAD.

| File | Parity |
|---|---|
| `apps/vscode/src/sdk/canonical-event-subscription.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/continuation-cardinality-authority.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/continuation-cardinality-authority.runtime-capture.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/continuation-cardinality-authority.session-host-capture.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/completion-authority-elm-replay.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/completion-authority-elm-authority-runtime.ts` | **IDENTICAL** |
| `apps/vscode/elm/completion-authority/src/Authority.elm` | **IDENTICAL** |
| `apps/vscode/elm/completion-authority/src/Codec.elm` | **IDENTICAL** |
| `apps/vscode/elm/completion-authority/src/Domain.elm` | **IDENTICAL** |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | **IDENTICAL** |
| `apps/vscode/src/sdk/SdkController.ts` | **IDENTICAL** |

**Conclusion.** The relevant production semantics are *demonstrably equivalent*
between the installed incident source and the current HEAD. Per the ACT brief,
current HEAD is therefore an admissible **replay subject**, and the replay is
simultaneously a **historical reproduction** of the installed incident source.

```
INSTALLED_INCIDENT_SOURCE_HEAD = 1d9a37bcd408c185ef356303e1e5ac6237a15307
REPLAY_SUBJECT_HEAD            = e0e30879f9e5cf0716242b00dc3cd9447fbaa6e1
PARITY                         = byte-identical across all 11 causal-path files
```

## C0.6 Elm kernel and runtime assets

| Asset | Path | SHA-256 |
|---|---|---|
| Compiled Elm completion-authority kernel | `apps/vscode/elm/completion-authority/vendor/completion-authority.js` | `15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c` |
| Elm source | `apps/vscode/elm/completion-authority/src/{Authority,Codec,Domain}.elm` | see parity table |

The kernel artifact is the one the shipped extension loads. The replay test
loads it through the production `loadKernel()` seam
(`completion-authority-elm-replay.kernel.ts:48`) — the SAME function the
production authority runtime calls.

## C0.7 Existing replay / adapter / completion-authority tests located

| File | Tests | Role |
|---|---|---|
| `src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts` | 20 | adapter + historical-replay invariants |
| `src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts` | 3 | stage vocabulary freeze |
| `src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts` | 12 | CCARD capture ring |
| `src/sdk/__tests__/post-terminal-lifecycle-liveness01.corr01-real-elm.test.ts` | 5 | REAL-Elm `scheduled_continuation` chronology |
| `src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts` | 6 | authority counter dump wiring |
| `src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts` | 8 | REAL `LocalRuntimeHost` pending-prompt lifecycle (PPLC-01..08) |
| `src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts` | — | correlation-loss RED |
| `src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts` | — | real-host sentinel |
| `apps/vscode/elm/completion-authority/tests/CompletionAuthorityTest.elm` | — | Elm-side unit tests (ELM-AUTH-13 covers `AgentTurnDone` -> `PromptConsumed`) |

## C0.8 Pre-existing baseline diagnostic preserved by identity

`src/sdk/__tests__/completion-authority-elm-authority-counter-dump01.test.ts`
-> `ELAUTHORITY01.A: registry.ts exposes DumpCompletionAuthorityElmAuthority command id`

```
AssertionError: expected '// ClineMM fork: keep the canonical "..." to match
/DumpCompletionAuthorityElmAuthority\s*:\s*prefix\s*\+/
```

**Baseline, NOT ACT-owned.** Neither the test file nor `src/registry.ts` is
modified by this ACT (`git status` confirms). The failure is a regex/format
mismatch against a fork comment block that precedes the command declaration —
unrelated to the Elm pending-prompt hold. Preserved by identity, not "fixed".

## C0.9 Repository protection compliance

| Constraint | Status |
|---|---|
| Protected stashes preserved | OK - untouched |
| Worktrees preserved | OK - untouched |
| No push | OK |
| No reset / rebase / checkout | OK |
| No force removal | OK |
| No extension installation | OK |
| No live-session modification | OK |
| Did not use the operator's running ClineMM task | OK (all evidence is from the exported bundle + repo source) |
| Unexpected tracked dirt | OK - none |
| Production change budget | OK - **ZERO** production changes |
