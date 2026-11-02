# ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 — C4 Decision Record

## 1. Decision

**`PASS_STRUCTURAL_ONLY`**

Every executable structural gate passes, the two load-bearing numeric
baselines match EXACTLY, and there are **zero ACT-owned failures**. The
installed-UI qualification remains unavailable in this environment and is
explicitly **NOT** claimed.

`PASS` is NOT available: the installed-VSIX dogfood UI qualification and the
live provider turn are `LIVE_UNOBSERVABLE` / `NOT_EXECUTED` here. Per the
brief, `PASS_STRUCTURAL_ONLY` is the correct terminal decision when the
executable structural gates pass and installed-UI qualification remains
unavailable.

`HALT_<reason>` does NOT apply: **no new P0 was found**, and there is no
unresolved correctness or evidence blocker.

## 2. The three P1 findings from the independent Codex review — disposition

| # | P1 finding | Disposition | Evidence |
|---|---|---|---|
| **P1-1** | Two historical evidence artifacts were unintentionally modified by the merge and must be restored, with new findings kept out of them. | **RESOLVED** — both restored byte-for-byte from baseline `265044bf3`; verified by SHA-256 and byte length. | `02-historical-evidence-conservation.md` |
| **P1-2** | The upstream remote-hook filter may change required ClineMM trace coverage, event identity, ordering or cardinality — the merge must be qualified, and the upstream optimization preserved unless coverage is actually lost. | **RESOLVED — NO COVERAGE LOSS.** The upstream optimization is preserved (byte-identical to upstream head; both filter commits are ancestors of HEAD). Coverage, identity, ordering and cardinality are all unchanged, proven by EXERCISING the real hub proxy and the real agent runtime. **No remedy was applied because none was needed.** | `03-hub-trace-cardinality-discriminator.md` |
| **P1-3** | The integration qualification is incomplete — the missing gates must be executed and classified. | **RESOLVED** — 30 distinct gates executed; 28 PASS; the 2 non-PASS results are proven PRE-EXISTING (identical at the fork baseline); **0 ACT-owned failures**; 5 gates explicitly labelled `NOT_EXECUTED` / `LIVE_UNOBSERVABLE`. | `04-qualification-gates.md` |

## 3. Key technical finding (P1-2)

The upstream filter — `94980446c` plus the later `590785eff` — drops four
per-chunk event types (`assistant-text-delta`, `assistant-reasoning-delta`,
`tool-call-delta`, `tool-updated`) from the **remote `onEvent` hook proxy**
in `sdk/packages/core/src/hub/server/hub-client-contributions.ts`.

The ClineMM portable-trace recorder does **not** consume that path. It is
wired as a `ModelBehaviorTraceSink` on the session/agent config and invoked
**inline** by the agent runtime at each observation boundary. The two paths
are structurally disjoint, so the filter cannot change what the recorder
observes.

Two facts were established that the ACT brief's framing did not state and
that only EXECUTION revealed:

1. The merged tree's filter set is **FOUR** types, not three — the brief's
   "three delta types" omits `tool-call-delta`, which upstream commit
   `590785eff` added. The discriminator's own first iteration FAILED on this
   point and was corrected against the code.
2. The filter commits **are** ancestors of HEAD. The upstream optimization
   landed in the merge; U02's triage note had recorded `94980446c` as
   deferred, but the file was not a merge conflict and upstream's version
   won cleanly. The fork's trace provenance is nevertheless intact.

## 4. Change inventory (this ACT)

| Path | Change | Kind |
|---|---|---|
| `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json` | restored to baseline | **historical artifact repair** |
| `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md` | restored to baseline | **historical artifact repair** |
| `sdk/packages/core/src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | NEW | test witness (D1/D2) |
| `sdk/packages/agents/src/agent-runtime.hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | NEW | test witness (D3) |
| `.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/*` | NEW | ACT evidence (5 files) |
| `.factory/epic-board.md` | board row | board update |

**No production source file was modified.** The only non-evidence changes are
two added test files, which change no runtime behaviour.

## 5. Artifact hashes (SHA-256)

### 5.1 Build artifacts

| Artifact | SHA-256 |
|---|---|
| `dist/clinemm-corr01-qualification.vsix` (50,504,372 bytes) | `21f0a1615187afc5d5a1aa2a15fe4245302820d132c3ade7b6a26b74b13d14e9` |

The VSIX was **built and packaged but NOT installed**. No installed-UI
claim is derived from it.

### 5.2 New witness files

| Artifact | SHA-256 |
|---|---|
| `sdk/packages/core/src/hub/server/hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | `28a6ba13e069c2b008106af361bc3a545bfb7b53ea26b0bc113a9904032042ea` |
| `sdk/packages/agents/src/agent-runtime.hub-trace-cardinality-discriminator.c2-4-fork-upstream-corr01.test.ts` | `b8bc1f08eda9c79b2b0acc98168502578f329b9d4a7dc7faa487c7e6b911b7e0` |

(These hashes are of the files as committed, after the repository's Biome
formatter was applied. Both witnesses were re-executed after formatting and
still pass: 4/4 and 2/2.)

### 5.3 Restored historical artifacts (post-repair)

| Artifact | SHA-256 | Matches baseline |
|---|---|---|
| `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json` | `818ae980171ee4fa899adad094c42b2927b1ca46e508d40c320eca26fefe6410` | **YES** |
| `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md` | `be41bc034ef03c316757372ed80ad01dee6edec410a77ec023e764d1c11ebe58` | **YES** |

### 5.4 ACT evidence files

| Artifact | SHA-256 |
|---|---|
| `01-identity-and-ancestry.md` | `c2535b05437f2885cb4b48fb8f7ca9fa9a35fa0e4ecd4a6067a7edab0e3a9ed3` |
| `02-historical-evidence-conservation.md` | `e39c702628d6e01ead2788aa575528b861d6e84d71087c69ce4bce83b0576669` |
| `03-hub-trace-cardinality-discriminator.md` | `3cca0a0a3714dabd9ba1a1cae584ea414c67bbae865c511c79edc8da40249dbe` |
| `04-qualification-gates.md` | `5befa5739ad8186c43709b1be00703338f90a43c8fc038bd5faab7ed43acad2a` |

(The hashes in §5.4 are of the files as committed; the
`05-decision-record.md` and `ledger.json` hashes are recorded in the commit
message, since a file cannot contain its own hash.)

## 6. Source HEAD identity

| Item | Value |
|---|---|
| Subject HEAD at execution | `3fc91ddda3e6d27f05640aca497acecadd558320` |
| Branch | `integration/upstream-20261102` |
| Merge commit (unchanged) | `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a` |
| Merge parent 1 (fork) | `265044bf37429cb3c48918eb7473e46cc3933964` |
| Merge parent 2 (upstream) | `a6507a62a147db4a35e27f4294589742ccac5060` |
| Merge base | `48d63852745460ff0fa3dfcc0457bbe2493841de` |
| `main` (must not change) | `265044bf37429cb3c48918eb7473e46cc3933964` — **UNCHANGED** |
| Protected stashes | `stash@{0}`, `stash@{1}` — **UNTOUCHED** |
| Push | **NONE** |

## 7. Explicitly not done

- No merge was recreated; the existing two-parent merge `167f5ca8d` is intact.
- No push, no publish, no install, no promotion, no release.
- `main` was not changed.
- No protected stash was popped, applied, dropped or otherwise touched.
- No Factory infrastructure was rebuilt.
- No new P0 was found; no further general review round was initiated.
