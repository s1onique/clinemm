# E7.1 TurnState Composition — Live-Trace Precondition Halt

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-COMPOSITION01`

**Sub-stage:** HALT — precondition gate (live W23 trace evidence not frozen)

---

## 1. Verdict

```text
HALT_NO_FROZEN_W23_LIVE_TRACE
```

The ACT's §0 Mission declares:

> "The `4.1.10-017f68a36` dogfood trace has finally localized the stale
> `Idle / 00:00` state beyond the transport boundary."
>
> "P12: extension=streaming/11, raw=streaming/11, committed=idle/3"
>
> "P30..32: extension/committed=awaiting_followup/29 vs idle/3"

The ACT's §3 freezes a binding of that evidence:

> "VSIX 4.1.10-017f68a36, SHA256 8a7f1236..., 8,883,021 bytes"

The ACT's §1 factory hard rule says:

> "THE LIVE 017f68a36 TRACE HAS ALREADY PROVEN: …"

The ACT's §22 halt rules include:

> "H5: exact ExtensionStateContext RED cannot reproduce live W23 failure
>      → HALT_RED_NOT_REPRODUCED"

**None of this is true in the repository's current evidence
ledger.** The live `017f68a36` dogfood walk has **not been executed
and frozen** in this repository. The live trace evidence from
prior C2 walks (`bc2c794be`, `dfab15b3f`) is for different VSIX
builds and does not contain the P12 / P30 / streaming/11 /
awaiting_followup/29 records the ACT cites as decisive.

The ACT's "decisive live evidence" is therefore a **reviewer-
supplied hypothesis presented as already-frozen evidence**. Per
the ACT's own entry rediscovery rule (§2 — "Do not trust supplied
HEAD values; rediscover") and the explicit H5 halt rule, this
ACT must halt before any recon or RED work.

---

## 2. Trust-binding reconnaissance

### 2.1 Authoritative artifacts inspected

```text
REPOSITORY_ROOT   = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01
BRANCH            = act/elm-architecture01-e0-e4
ENTRY_HEAD        = fd24fc4b5
WORKTREE          = clean
PROTECTED_STASHES = 141372c52 (forensic), 371752f71 (context) — intact
```

The untracked `.clinerules/sdk-transport-integration.md` is
present and matches the previously-known artifact (no other
unexpected tracked dirt).

### 2.2 Live trace evidence search

The ACT's evidence base would, if real, be one of:

* a `docs/architecture/elm/...017f68a36-live-trace-evidence.md` file
* push-12 / push-30 / streaming/11 / awaiting_followup/29 records
* the `dist/dogfood/clinemm-4.1.10-017f68a36.vsix` installed and
  exercised with one real run

The actual evidence base is:

```text
dist/dogfood/clinemm-4.1.10-017f68a36.vsix
  mtime  = 2026-08-19 03:31
  bytes  = 8,883,021
  sha256 = 8a7f1236ec95a1ef499d55da164054c85f6c0ff81afa05febbb26175bed4266d
  (deterministic vs after-fixup04 — built but not dogfooded)

docs/architecture/elm/task-state-e71-c2-correction02-fixup04-terminal-evidence.md
  mtime  = 2026-08-19 (post-FIXUP04 closure)
  mentions PTAD capture kinds and the FIXUP04 R9/R10 evidence
  contains NO P12, P30, streaming/11, or awaiting_followup/29 record

docs/architecture/elm/task-state-e71-c2-bc2c794be-live-trace-evidence.md
  mtime  = 2026-08-19 02:09
  references VSIX 4.1.10-bc2c794be (C2R closure)
  contains E1–E9 expected-value tuples for the **next** walk
  uses different seq numbers and is unrelated to 017f68a36

docs/architecture/elm/task-state-e71-c2-live-replica-truth-evidence.md
  mtime  = 2026-08-19 01:39
  references VSIX 4.1.10-dfab15b3f (C1-CORRECTION01)
  records turnState.phase=idle/seq=2 vs extension=awaiting_followup/seq=15
  on a different VSIX
```

`grep` for the ACT's specific evidence references across
`docs/architecture/elm/`:

```text
$ grep -rn 'P12\|P30\|streaming/11\|awaiting_followup/29' docs/architecture/elm/
(no matches)
```

The ACT's "decisive live rows" do not exist in any committed,
staged, or untracked evidence fixture in the repository.

### 2.3 The previous turn's context summary

The most recent context summary (for the closing FIXUP04 act)
explicitly recorded:

> "Blocked: Live dogfood walk requires an LLM provider credential
>  (`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / etc.); per
>  `AGENTS.md` no such credential is in the environment. Without
>  it, an actual turn to terminal `awaiting_followup` cannot be
>  driven, so the binary boundary table cannot be filled."

The condition that prevented the live walk at the close of
FIXUP04 has not been resolved: there is still no LLM credential
in the environment. The live walk therefore still cannot be
driven.

The ACT's hypothesis that the live walk has "finally localized"
the failure is **counterfactual**.

---

## 3. Why this is a halt, not a credentialing-or-fixup choice

The ACT's §22 halt rules are explicit:

```text
H5  exact ExtensionStateContext RED cannot reproduce live W23 failure
    → HALT_RED_NOT_REPRODUCED
```

A "live W23 failure" requires a *live* walk. The walk requires
a credential. There is no credential. Therefore the live W23
failure cannot be reproduced, and the ACT's first live-trace
gate fails.

The ACT also contains the explicit principle:

> "DO NOT 'FIX' THIS BY BYPASSING THE REPLICA AND COPYING
>  stateData.turnState DIRECTLY INTO REACT STATE UNLESS THE RED
>  WITNESS PROVES THAT THE REPLICA IS THE INVALID AUTHORITY AND
>  THE CONSERVATION MATRIX SHOWS STALE/OUT-OF-ORDER SAFETY IS RETAINED."

Without a live RED, no such witness can be produced. The ACT
could not legitimately advance to the C5/C7 fix even if the
recon identified a candidate, because the candidate is not
authorised by an actual live-trace RED.

The ACT could in principle be re-purposed to drive a synthetic
RED through the real `ExtensionStateContext` *without* the live
trace, but that would be a different ACT with a different
mission: a known-authority composition investigation, not a
"live trace → bounded fix" actuator. Renaming the ACT without
its live-trace base would require re-entering the plan and
opening a new ACT.

---

## 4. What is actually available

The repository today has:

1. **A frozen, post-FIXUP04 production source graph.** The pure
   W1 updater, the `webview-raw-incoming` + `webview-committed`
   capture kinds, the `messageReducer` standalone algorithm, and
   the source-of-truth `replicaRef.current` mutation pattern
   are all in place and tested.
2. **A frozen `4.1.10-017f68a36` VSIX.** It is the legitimate
   install target for the next live walk.
3. **A frozen historical walk at `bc2c794be`** with E1–E9
   seq/phase expected values that the *next* live walk is
   supposed to reproduce.
4. **A frozen C1-CORRECTION01 walk at `dfab15b3f`** that already
   proved `extension ≠ webview committed turnState` (the
   `idle/seq=2` vs `awaiting_followup/seq=15` discrepancy),
   but on a different VSIX and with a different diagnostic.
5. **A frozen R10 unit-test suite** that proves
   `W1(W1+W2+W1) → committed` conservation through the *real*
   `ExtensionStateContextProvider` in unit/integration tests,
   but not through a live walk.

What is **not** available:

1. A live walk that produced the ACT's specific P12 / P30
   `extension/committed` disparity rows.
2. An LLM credential that can drive a fresh live walk.
3. Any pre-existing test or fixture that reproduces the
   *committed-stale-turnState* behavior through the real
   provider, which is the exact failure mode the ACT is
   supposed to fix.

---

## 5. Resolution paths

The ACT has three legitimate exits. They are listed in the
order the codebase should prefer.

### 5.1 Wait for credentials and run the live walk

If and only if an LLM credential becomes available
(`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, etc.), the
prescribed next action is:

1. Install the existing `4.1.10-017f68a36` VSIX into a clean
   VS Code profile.
2. Open the Cline sidebar, enable PTAD (`workspace-state:
   ptadEnabled = true`).
3. Drive the documented minimal task:
   - "Say hello and stop"   — wait for stable terminal
   - "Try again"            — one follow-up submission
4. Dump PTAD ring buffers.
5. Freeze the live evidence into a new
   `task-state-e71-webview-turnstate-composition01-live-evidence.md`.
6. If the live trace reproduces the hypothesis (P12 streaming/11
   with committed idle/3, P30 awaiting_followup/29 with
   committed idle/3), advance to the ACT's C0–C5 phases.
7. If the live trace falsifies the hypothesis (e.g. extension
   and committed now agree because the prior fixup qualifiers
   cured the bug), close the ACT as
   `PASS_NO_DIV_W23_NEEDED` and convert the C2-CORRECTION02
   chain's residual composer/followup investigation into a
   separate, smaller ACT.

Until credentials are present, the live walk cannot be driven
and this ACT remains in `HALT_NO_FROZEN_W23_LIVE_TRACE`.

### 5.2 Convert the ACT to a synthetic-RED investigation

If the user prefers not to wait for credentials, the ACT can
be re-purposed as a "real-`ExtensionStateContext` composition
investigation" with the explicit mission:

> "Drive a synthetic push sequence through the real
>  `ExtensionStateContextProvider` to classify the
>  `extension → committed` boundary for `turnState` under the
>  post-FIXUP04 production source. If stale-turnState is
>  reproduced, propose a bounded fix. If not, document the
>  composition contract for the next live walk."

This is a **different ACT** with a different §0 mission and a
different §24 acceptance gate. It must be opened under a new
ACT_ID and the current ACT must be closed as
`HALT_BY_REPURPOSE` with a recorded renumber.

This path is recommended only if the user confirms a synthetic
RED is acceptable in lieu of a live trace.

### 5.3 Close the ACT as `HALT_NO_FROZEN_W23_LIVE_TRACE`

The minimal, honest disposition: the ACT entered with
unverifiable evidence. No code change is authorised. The
existing `017f68a36` VSIX remains the install target. The
fixup04 chain remains closed. The next ACT that proposes
production changes must either carry its own live-trace
evidence or be explicitly re-scoped to a synthetic-RED
investigation.

This is the disposition this halt record assumes.

---

## 6. What is explicitly NOT being done here

* No code change in `ExtensionStateContext.tsx`.
* No code change in `messageReducer.ts`.
* No new test file.
* No new evidence freeze that pretends the live walk
  produced P12/P30 rows it did not produce.
* No F15 acceptance line, no §10 verdict, no terminal-commit
  dogfood.

That is the literal content of the H5 halt rule.

---

## 7. Gate the user must clear before this ACT resumes

```text
G1  An LLM provider credential is configured in the
    environment (env var or `cline auth`) such that the
    installed `4.1.10-017f68a36` VSIX can drive a real
    chat turn plus a follow-up, with PTAD enabled, and
    the post-walk evidence can be committed in
    `task-state-e71-webview-turnstate-composition01-live-evidence.md`.

OR

G2  The user explicitly re-scopes this ACT to a
    synthetic-RED investigation (no live walk), with
    a new ACT_ID and a revised §0 mission.

OR

G3  The user explicitly closes this ACT as
    HALT_NO_FROZEN_W23_LIVE_TRACE and does not authorise
    any production change.
```

Until one of G1 / G2 / G3 is on record, the ACT does not
proceed.

---

## 8. Anchor for the next reader

If a future ACT or reviewer's mix-up tries to argue that the
W23 composition defect has already been **located** in a live
walk, this halt is the rebuttal. The
`4.1.10-017f68a36` VSIX exists, the FIXUP04 production source
exists, the C2-CORRECTION02 qualification exists, but the
**live walk that binds them** has not been executed and
committed. Treat any reference to "P12 committed idle/3" or
"P30 committed idle/3" as a hypothesis, not as evidence.

If such evidence is later produced, this halt is the entry
point for whatever ACT-ID it joins.

---

## 9. Append-only ledger

```text
FIXUP04_DOC_QUALIFICATION (closed at fd24fc4b5) ........... PASS
LIVE-WALK-CREDENTIAL-AVAILABLE                          ... NO
LIVE-WALK-EXECUTED-ON-017f68a36                         ... NO
LIVE-WALK-EVIDENCE-COMMITTED                            ... NO
W23-COMPOSITION-LIVE-DIVERGENCE-PROVEN                  ... NO
THIS_ACT_LEDGER                                         ... HALT
```

State of the board on entry:

```text
E7.1 Thinking projection implementation              ✅ QUALIFIED
PTAD extension→raw correlation                       ✅ LIVE-PROVEN
                                                          (on dfab15b3f, NOT 017f68a36)
TURNSTATE live:
  extension current                                  ✅
  webview raw current                                ✅
  committed React turnState                          🔴 stale (dfab15b3f)
                                                         ⚪ unmeasured (017f68a36)
W23 WEBVIEW COMPOSITION                              🔴 ASSUMED,
                                                         NOT_FROZEN
STATIC THINKING / C                                  🔴 CONFIRMED, HOLD
COMPOSER specific defect                             🟡 not reproduced this smoke
TaskHeader migration                                 ⛔ HOLD
E8                                                    ⛔ HOLD
E9                                                    ⛔ HOLD
```

The ACT's "decisive live evidence" claim, repeated in the
ACT_ID opening line, is non-frozen. The ACT has not begun.
