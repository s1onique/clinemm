# ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — AMENDMENT-01 — Causal Summary

**Scope:** bounded implementation. Production classifier corrected; recovery
architecture NOT redesigned; R3 NOT implemented.
**Verdict:** `GO_EXECUTION_PROGRESS_CLASSIFIER_DOGFOOD`

---

## 0. What was corrected

One production file changed:

| Production file | Change |
|---|---|
| `sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts` | (A1) The segment splitter is now DESCRIPTOR-DUPLICATION-aware: the `&` of `2>&1` / `>&2` is a redirection, not a command separator. (A2) `git tag` is a LISTING only when it carries a listing flag; `mount` is a listing only with no arguments; a SETUP form carrying an output redirection is a MUTATION. (A3) An EMPTY or ABSENT execution observation no longer establishes positive execution progress; a terminal outcome must be established by `exitCode`, the production `success` flag, or a terminal `state`. |

No shared, agents, runtime, provider, compaction or PLAN file changed. The R1
threshold, the R1 allowance, the R2 activation limits, the R2 selection
limits, the R2 default-OFF posture, the command authorization policy and the
sandbox policy are all UNCHANGED.

---

## 1. A1 — HISTORICAL SHELL REDIRECTION CONSERVATION

The nine reconnaissance commands of the frozen Session A transcript
(transcript message indices 29–45) ALL carry the trailing `2>&1 | tail -N`
shape. The classifier's segment splitter split on `&` unconditionally, so the
DESCRIPTOR DUPLICATION was read as a command separator and the read-only
reconnaissance was reported as a productive EXECUTION.

The repair discriminates the FOUR distinct `&` shapes:

| Shape | Meaning | Behaviour |
|---|---|---|
| `&&` | logical AND separator | still splits |
| `&` (followed by whitespace/an ordinary character) | background separator | still splits |
| `&>` | output redirection to a file | still splits |
| `N>&M` / `>&M` | DESCRIPTOR DUPLICATION | stays inside the segment |

The repair does NOT remove all ampersands, does NOT globally strip
redirections and does NOT introduce a shell interpreter.

### The reproduced counterexamples (against the ACTUAL production classifier)

| Command | Predecessor | Repaired |
|---|---|---|
| `grep foo bar 2>&1 \| tail -10` | `executed` | `inspected` |
| `grep foo bar >&2` | `executed` | `inspected` |
| `SSH_AUTH_SOCK=... ssh -o BatchMode=yes host 'N=/tmp; grep foo bar' 2>&1 \| tail -10` | `executed` | `inspected` |

### The frozen historical commands

The nine frozen historical command strings are asserted VERBATIM as
classification inputs (never executed). EIGHT are now `inspected`.

The NINTH — transcript message index 37 — carries a COMMAND SUBSTITUTION
(`F=$(find $N/lib -name osproc.nim)`). It is outside the established static
recognition contract, so it keeps the conservative UNKNOWN disposition. This
matches the reviewer's independent finding: "Removing the trailing `2>&1 |
tail -N` suffix changes eight of those nine classifications to inspected."

### Conservation

| Property | Status |
|---|---|
| Actual output redirection to a workspace file (`> file`, `>> file`) | conserved — a MUTATION |
| Actual background execution (`cmd &`) | conserved — the `&` still splits |
| Actual `&&`, `\|\|`, `;` and pipeline boundaries | conserved |
| Quoted and escaped separators | conserved |
| Remote build / installation / mutation classification | conserved |
| Command substitution | UNKNOWN (outside the established contract) |

---

## 2. A2 — BOUNDED MUTATION CONSERVATION

The independently executed counterexamples are no longer positively
classified as inspections:

| Command | Predecessor | Repaired |
|---|---|---|
| `git tag -a new-tag -m msg` | `inspected` | `executed` |
| `git tag -d new-tag` | `inspected` | `executed` |
| `mount /dev/sda /mnt` | `inspected` | `executed` |
| `cd /tmp > file` | `inspected` | `executed` |
| `export X=1 > file` | `inspected` | `executed` |

The repairs reuse the EXISTING command-guard mechanism
(`findFileEditingCommand`) as the authority for "writes a file", rather than
inventing a second notion of redirection. No exhaustive program/subcommand
registry was introduced: `git tag` is a listing only when it carries a
listing flag (`-l`, `--list`), and `mount` is a listing only with no
arguments; every other form keeps the conservative disposition.

Conserved: ordinary `git tag` listing (`git tag`, `git tag -l`,
`git tag --list`) and ordinary environment setup (`export X=1`, `cd /tmp`).

---

## 3. A3 — MISSING EXECUTION OUTCOME

The previous check rejected only an ABSENT `output` property, so an empty
observation fell through to the command-shape reading and was reported as a
productive EXECUTION.

The real production result contract was inspected before deciding:
`CommandStatusOutput` (`ok`, `state`, `exitCode`) and `ToolOperationResult[]`
(`success`, `result`, `error`). **`{ ok: true }` ALONE does not establish a
terminal outcome**: `ok` reports that the OBSERVATION was taken, not that the
COMMAND ran and succeeded — a still-running job reports `ok: true` with
`state: "running"` and no exit code at all.

A terminal outcome is therefore established by an explicit `exitCode`, by the
production operation-result `success` flag, or by a terminal `state`.

| Observation | Predecessor | Repaired |
|---|---|---|
| `output: null` | `executed` | `failed` |
| `output: []` | `executed` | `failed` |
| `output: {}` | `executed` | `failed` |

Conserved: a legitimate background wait (still a DECLINE), explicit negative
observations (`failed`), the plain-text legacy limitation (documented, a
plain-text observation is still treated as a COMPLETED observation), and the
explicit `exitCode` failure repair accepted by the predecessor ACT.

---

## 4. A4 — THE ACTUAL R2 ENTRY WITNESS

`sdk/packages/core/src/extensions/tools/execution-progress-classifier.correction01.runtime-witness.test.ts`

The predecessor witness configured R1 ONLY. It never configured R2 and never
observed R2's activation. The strengthened witness now:

- drives a SHORT trajectory of the HISTORICAL remote inspection shape — WITH
  the descriptor duplication the frozen session actually used — through the
  REAL `AgentRuntime` with R2 CONFIGURED;
- reuses the EXISTING R2 scripted-model fixture and policy
  (`maxActivations: 2`, `maxObjectiveRounds: 8`, `maxSelectionInferences: 1`)
  and the EXISTING R2 selection-rejection control;
- drives the ACTUAL defective predecessor production classifier — frozen
  VERBATIM under
  `sdk/packages/core/src/extensions/tools/__fixtures__/defective-execution-progress-classifier.ts`
  (the production source at commit `1708f1e8f`, Git blob
  `b8029cada039e371cdf2d0a2dc2b987dfc1926c4`, verified byte-identical apart
  from the relative import path). NO test-local predecessor whitelist was
  created.

The four required facts:

1. **R1 allowance is consumed** — exactly TWO corrective instructions
   (`attempt 1/2`, `attempt 2/2`).
2. **The subsequent qualifying round reaches the existing R2 entry branch** —
   exactly ONE `R1 recovery allowance exhausted — selecting a bounded
   objective` notice.
3. **Exactly ONE selection inference executes.**
4. **No additional selection allowance is manufactured** — the rejection
   consumed the ONE permitted inference, was never retried, and no bounded
   objective was ever dispatched.

### The RED is genuine

With the defective predecessor production classifier substituted for the
repaired one, the R2 entry witness FAILS (the R2 entry branch is never
reached). With the repaired classifier it PASSES.

The historical command strings are CLASSIFICATION INPUTS ONLY. The witness
never executes them and never opens an SSH connection.

---

## 5. A5 — THE REPLAY (run once, against the FINAL classifier)

The already-corrected replay was run against the FINAL classifier. Both
existing forensic packages are PRESERVED unchanged; the amendment's replay
driver is `replay/replay-amendment01.ts` and its ledger is
`round-ledger.amendment01.json`.

### Session A (`1795612311440_l9mhl`) — 34 rounds, 0 missing results

**Rounds whose classification changed (10):** every one is a reconnaissance
round carrying the `2>&1 | tail -N` descriptor duplication.

| Run | Iter | Transcript msg index | Before | After |
|---|---|---|---|---|
| 2 | 9 | 29 | `executed` | `inspected` |
| 2 | 10 | 31 | `executed` | `inspected` |
| 2 | 11 | 33 | `executed` | `inspected` |
| 2 | 12 | 35 | `executed` | `inspected` |
| 2 | 14 | 39 | `executed` | `inspected` |
| 2 | 15 | 41 | `executed` | `inspected` |
| 2 | 16 | 43 | `executed` | `inspected` |
| 2 | 17 | 45 | `executed` | `inspected` |
| 2 | 26 | 64 | `executed` | `inspected` |
| 2 | 27 | 66 | `executed` | `inspected` |

(Transcript index 37 — the command-substitution form — is deliberately NOT
listed: it keeps the conservative UNKNOWN disposition.)

- **First R1 eligibility:** run 2, round 8, transcript message index 26,
  streak 5.
- **Second R1 eligibility:** run 2, round 22, transcript message index 55,
  streak 5.
- **First `allowance_exhausted`:** NOT reached.
- **Conserved:** 34 of 34 rounds.

### Session B (`1795619309746_8h3tn`) — 232 rounds, 0 missing results

**Rounds whose classification changed relative to the PREVIOUS repaired
classifier (2):** the `2>/dev/null | head` reconnaissance form.

| Run | Iter | Transcript msg index | Before | After |
|---|---|---|---|---|
| 1 | 4 | 11 | `executed` | `inspected` |
| 2 | 10 | 38 | `executed` | `inspected` |

**Rounds whose classification changed relative to the ORIGINAL predecessor
classifier (14, cumulative):** transcript message indices 11, 36, 38, 46, 60,
62, 64, 66, 68, 70, 76, 82, 162, 176 — all reconnaissance.

- **First R1 eligibility:** run 2, round 25, transcript message index 68,
  streak 5.
- **Second R1 eligibility:** NOT reached.
- **First `allowance_exhausted`:** NOT reached.
- **Conserved:** 220 of 232 rounds.

### Genuine progress is conserved

Session B contains **53 rounds with a successful edit**. Every one of them
is classified identically by the predecessor, the previous repaired
classifier and the final classifier. **ZERO of the changed rounds carried a
successful edit** — every changed round was false-productivity
reconnaissance. The genuine compiler installation, builds, tests and edits
are conserved.

### The historical replay does NOT reach R2

Neither session reaches `allowance_exhausted`, so the historical replay does
NOT reach R2. This is reported as observed, not forced. The R2 entry
witness (section 4) establishes the entry branch on a REAL runtime
trajectory instead.

Counterfactual behaviour remains **HYPOTHESIS_ONLY**.

---

## 6. Verification

| Gate | Result |
|---|---|
| Focused historical RED/GREEN (`…correction01.amendment01.test.ts`) | 13/13 GREEN |
| Bounded mutation and missing-outcome controls | covered by the same file; GREEN |
| Existing principal runtime witness (`…correction01.runtime-witness.test.ts`) | 7/7 GREEN |
| Existing classifier suites | 4/4 + 7/7 + 10/7 GREEN (21/21) |
| Existing command-guard suite | 91/91 GREEN |
| Existing R1/R2 conservation witnesses (agents) | 29/29 + 17/17 GREEN |
| Existing R1/R2 conservation witnesses (shared `src/agents/`) | 47/47 GREEN |
| Corrected frozen replay | exit 0, 34 + 232 rounds, 0 missing results |
| Affected typecheck (`@cline/core`) | 45 diagnostics, BYTE-IDENTICAL before and after; **0 in the changed files** |
| Biome | no findings in the changed files |
| SDK rebuild (`bun run build:sdk`) | succeeded |

**ACT_OWNED_DIAGNOSTICS = NONE.**

---

## 7. Artifacts

| File | Content |
|---|---|
| `CAUSAL-SUMMARY.amendment01.md` | This document |
| `counterfactual-ledger.amendment01.json` | The FINAL replay discriminator for BOTH sessions |
| `round-ledger.amendment01.json` | Per-round ledger: predecessor, previous-repaired and FINAL classifications, streak, allowance, R1 decision, R2 eligibility |
| `replay/replay-amendment01.ts` | The amendment replay driver (final classifier) |
| `replay/final/**` | The FINAL production extracts (classifier + command guard + stagnation) |
| `replay/defective/**` | The DEFECTIVE predecessor production extracts (frozen at `1708f1e8f`) |

**Reproduce:**

```bash
bun .factory/evidence/ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01/replay/replay-amendment01.ts
```

**Frozen witnesses (read-only, unmodified):**
`~/.vscodium-lab/cline-data/sessions/1795612311440_l9mhl/` and
`~/.vscodium-lab/cline-data/sessions/1795619309746_8h3tn/`

---

## 8. Verdict

`GO_EXECUTION_PROGRESS_CLASSIFIER_DOGFOOD`

The GO verdict authorises immediate isolated dogfood. It does NOT establish
live behavioral effectiveness: the historical replay does not reach R2, and
the R2 entry witness is a deterministic trajectory that reports WHEN the
detector WOULD intervene.
