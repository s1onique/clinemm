# ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — Causal Summary

**Scope:** bounded implementation. Production classifier corrected; recovery
architecture NOT redesigned; R3 NOT implemented.
**Verdict:** `GO_EXECUTION_PROGRESS_CLASSIFIER_DOGFOOD`

---

## 0. What was corrected

Two reproduced defects were repaired in production code:

| Production file | Change |
|---|---|
| `sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts` | Three-way command classification (inspection / execution / unknown); shell SETUP recognition; environment-inspection programs; SSH as a TRANSPORT WRAPPER whose REMOTE payload is classified; mutation detection extended to `git` inspection subcommands carrying a mutating construct; explicit `failed` verdict for a failed or missing execution outcome. |
| `sdk/packages/shared/src/agents/execution-stagnation.ts` | New `failed` round-productivity verdict. |
| `sdk/packages/agents/src/agent-runtime.ts` | The runtime's fallback no longer launders a failed or missing execution outcome into a productive execution; the host's authoritative negative observation survives the boundary. |

The classifier's decision shape changed from:

```
return isInspectionCommandInput(input) ? "inspected" : "executed";
```

to a three-way classification in which an unrecognised command is an
`unknown` (reported conservatively as an execution), and a positively
recognised inspection is no longer masked by a SETUP prefix or a TRANSPORT
wrapper.

---

## 1. The seven reproduced counterexamples

Reproduced against the ACTUAL production classifier before the repair, and
GREEN after it. The evidence is
`sdk/packages/core/src/extensions/tools/execution-progress-classifier.correction01.test.ts`.

| Command | Predecessor | Repaired |
|---|---|---|
| `ssh host 'grep -n foo bar'` | `executed` | `inspected` |
| `L=/tmp; grep -n foo bar` | `executed` | `inspected` |
| `L=/tmp grep -n foo bar` | `executed` | `inspected` |
| `export X=1; ls` | `executed` | `inspected` |
| `uname -a` | `executed` | `inspected` |
| `git tag new-tag` | `inspected` | `executed` |
| `git status > file` | `inspected` | `executed` |

The command strings are CLASSIFICATION INPUTS ONLY. The test file never
executes them.

---

## 2. The corrected causal verdict

| Finding | Disposition |
|---|---|
| Remote inspection misclassified as execution | **REPRODUCED and REPAIRED** |
| Shell assignment misclassified as execution | **REPRODUCED and REPAIRED** |
| `git` mutation misclassified as inspection | **REPRODUCED and REPAIRED** |
| R1 accounting and decision function | Behaves according to current contract |
| R2 environment opt-in | Established for inspected process |
| R2 eligibility reached | **NOT reached** in either replayed session, before or after the repair |
| R2 delivery defect | Not demonstrated |
| R2 behavioral effectiveness | Still untested |
| Productive execution in Session B | Established |
| Compaction as a behavioral contributor | Still open |

| Compaction as a behavioral contributor | Still open |

### The reviewer's causal correction is CONFIRMED by the corrected replay

The predecessor report's one-sentence summary reversed the session
difference. The corrected replay, using the CORRECTED result collection and
the REPAIRED classifier, shows:

- **Session A** (`1795612311440_l9mhl`): the predecessor's R1 injections are
  reproduced **EXACTLY** (run 2, rounds 8 and 22; transcript message indices
  26 and 55; streak 5 each) and match the transcript's own observed runtime
  notices (message indices 28 and 57). The repaired classifier produces the
  **same** injections. Session A's trajectory is unchanged by the repair.
- **Session B** (`1795619309746_8h3tn`): **12 rounds change** from `executed`
  to `inspected`. These are the reconnaissance rounds the reviewer identified
  — the `L=/nix/store/...` Nim library path assignments followed by `ls`,
  `grep` and `sed` reads, at transcript message indices 36, 46, 60, 62, 64,
  66, 68, 70, 76, 82, 162 and 176. The six consecutive rounds immediately
  before the first successful edit (messages 60–70) are exactly the
  sequence the reviewer reported.

**Session B therefore DID contain false productivity**, and the repaired
classifier detects it. Session B's R1 eligibility moves from **none** to
**run 2, round 25, message index 68**.

**Genuine prerequisite and implementation progress is conserved**: 220 of
Session B's 232 rounds are classified identically by the predecessor and the
repaired classifier. The Session A ledger conserves 34 of 34.

---

## 3. The execution-outcome authority defect

The composed production counterexample is REPRODUCED and REPAIRED.

| | Predecessor | Repaired |
|---|---|---|
| Host verdict for `{ output: [{ exitCode: 1, ok: true }], isError: false }` | `undefined` (declined) | `"failed"` |
| Runtime verdict at the fallback | `executed` | `failed` (does not reset the streak) |

The host used to DECLINE a failed observation — correct on its own terms, but
a decline is not a verdict, and the runtime's fallback then re-classified the
same call as an execution because it checked only the dispatch `isError`
flag. The host's authoritative negative observation DISAPPEARED at that
boundary.

The repair reports the failure EXPLICITLY, and the runtime's fallback
independently distinguishes:

- a **successful** execution,
- a **failed** execution (non-zero exit code or explicit `ok: false`),
- a **missing** execution outcome (the observation carries no output),
- **identified work still running** (still a DECLINE; the runtime's
  `awaiting` reading governs),
- a **recognised inspection**.

**A failed executable experiment is NOT a stall.** It is real evidence and it
is recorded as such; it simply is not positive evidence of PROGRESS, so it
does not reset the stagnation streak.

### Documented residual limitation
limitation of the correction, not a claim of complete outcome detection.

---

## 4. Unknown command disposition

An unrecognised program remains an EXECUTION in the reported verdict, because
the runtime must not declare a stall on the basis of a command whose
semantics were never established. What changed is that the classifier no
longer CONFLATES an unrecognised command with a recognised execution: the
three-way classification keeps `unknown` distinct internally, and the
conservative reporting is a deliberate, documented policy — not an artefact of
the two-way shape.

For SSH specifically, a payload that cannot be established statically (a here
document, a command substitution, a backtick substitution, an interactive
session with no remote command) yields `unknown` and is reported
conservatively. The classifier supports only the bounded, statically
recognisable command shapes needed by the real witnesses. It is NOT a shell
interpreter, and the command authorization and sandbox policy are unchanged.

---

## 5. Historical replay fidelity

The predecessor replay's result-collection loop was corrected in a SUCCESSOR
artifact. The original evidence package is preserved unchanged.

The predecessor's loop broke out of its scan as soon as it found ANY later
assistant message carrying a tool call — including messages BEHIND the scan
cursor — which truncated the collection after the first following user
message. The corrected loop scans forward to the ACTUAL next execution-round
boundary and collects BY TOOL-CALL IDENTITY. Completeness is asserted: a tool
call whose result cannot be found is recorded as `UNAVAILABLE_FROM_TRACE`
rather than silently assumed to have succeeded.

| Session | Rounds replayed | Missing results |
|---|---|---|
| A `1795612311440_l9mhl` | 34 | 0 |
| B `1795619309746_8h3tn` | 232 | 0 |

The predecessor's OBSERVED historical R1 injection identities are reproduced
exactly by the predecessor classifier under the corrected collection, so the
Session B prediction is established rather than asserted.

---

## 6. Counterfactual trigger discriminator

Evidence class: `HYPOTHESIS_ONLY` for the counterfactual trajectory. A
replay reports the detector's trigger points; it does not prove live
behavioral recovery.

The reviewer's conservative Session A reference discriminator was:

- R1 #1 at run-2 round 8,
- R1 #2 at round 13,
- `allowance_exhausted` at round 18.
reaches it, so live R2 eligibility remains untested.

---

## 7. Principal production runtime witness

`sdk/packages/core/src/extensions/tools/execution-progress-classifier.correction01.runtime-witness.test.ts`

A short deterministic trajectory of repeated recognised remote source
inspections, driven through the REAL `AgentRuntime` with the REAL production
host classifier, establishes:

1. The predecessor classifier misclassifies the remote inspections as
   execution.
2. The corrected classifier recognises them as inspections.
3. The corrected classifier increments the stagnation streak (the injected
   instruction reports TWO consecutive unproductive rounds — only possible if
   the remote inspections were counted as UNPRODUCTIVE).
4. The EXISTING R1 allowance is consumed: exactly TWO corrective
   instructions, `attempt 1/2` and `attempt 2/2`.
5. The EXISTING R2 entry condition becomes REACHABLE — it is the R1
   `allowance_exhausted` branch, and the allowance is now spent.

The CONSERVATION control: a trajectory alternating a genuine remote build
with a remote inspection produces NO corrective instruction, because the
genuine build resets the streak. Legitimate engineering progress is
conserved.

The R1 threshold, the R1 allowance, the R2 activation limits, the R2 selection
limits, the PLAN behaviour and the experimental R2 default OFF are all
UNCHANGED. Compaction is unchanged.

---

## 8. Verification

| Gate | Result |
|---|---|
| Focused classifier RED/GREEN | 10/10 GREEN (`correction01.test.ts`) |
| Host/runtime execution-outcome witness | 4/4 GREEN (`correction01.runtime-witness.test.ts`) |
| Existing classifier tests | 7/7 + 4/4 GREEN |
| Production-seam replay | 4/4 GREEN |
| R1 conservation tests | 11/11 GREEN |
| R1/R2 progress-controls + bounded-objective suites | 35/35 GREEN |
| Shared `src/agents/` suites | 47/47 GREEN |
| Affected typecheck | shared 0 · agents 0 · core **45 pre-existing diagnostics, byte-identical before and after** |
| Biome | no findings in the changed files |
| SDK rebuild | `bun run build:sdk` succeeded |

**ACT_OWNED_DIAGNOSTICS = NONE.** The core package's typecheck diagnostics
were captured before and after the change and are byte-identical (45 both
times). The agents package's full suite reports the identical 9 files / 43
tests failing before and after — all pre-existing and unrelated (abort-cause
retention, recovery qualification). The core package's 4 failures in
`bash.supervised.bash-startup-env.test.ts` were reproduced on the
predecessor.

---

## 9. Artifacts

| File | Content |
|---|---|
| `counterfactual-ledger.1795612311440_l9mhl.json` | Session A discriminator: injections, eligibility, changed rounds, conserved rounds |
| `counterfactual-ledger.1795619309746_8h3tn.json` | Session B discriminator: the same schema |
| `round-ledger.json` | Per-round ledger for BOTH sessions — tool identities, BOTH classifications, streak, allowance, R1 decision, R2 eligibility, `UNAVAILABLE_FROM_TRACE` markers |
| `replay/replay.ts` | The CORRECTED successor replay driver |
| `replay/production-classifier.ts` | The runtime's classification methods, extracted |
| `replay/prod/**` | The PREDECESSOR production extracts, for the historical reproduction |
| `replay/repaired/**` | The REPAIRED production extracts |

**Reproduce:**

```bash
bun .factory/evidence/ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01/replay/replay.ts
```

**Frozen witnesses (read-only, unmodified):**
`~/.vscodium-lab/cline-data/sessions/1795612311440_l9mhl/` and
`~/.vscodium-lab/cline-data/sessions/1795619309746_8h3tn/`

---

## 10. Verdict

`GO_EXECUTION_PROGRESS_CLASSIFIER_DOGFOOD`

The GO verdict authorises the next isolated R2 dogfood build. It does NOT
establish live behavioral effectiveness: the R2 entry condition is reachable
under the corrected classifier, but neither replayed session reaches it, and
no model behaviour was observed.


**The full correction produced different eligibility points, and the ACT
explicitly does not require the reference discriminator.** Under the repaired
classifier with the EXISTING threshold (5) and allowance (2), Session A's
injections remain at run-2 rounds 8 and 22, and `allowance_exhausted` is NOT
reached. The reviewer's counterfactual was produced by CHANGING NINE rounds'
classifications by hand; the full correction changes the classification only
where the production classifier itself now recognises an inspection.

**R2 entry reachability is therefore NOT established by this ACT.** The
principal production runtime witness establishes that the EXISTING R2 entry
condition (the R1 `allowance_exhausted` branch) becomes REACHABLE when the
corrected classifier feeds it a trajectory of recognised remote inspections
and the EXISTING allowance is consumed — but neither replayed session
reaches it, so live R2 eligibility remains untested.


A plain-text observation (for example `{ output: "ok" }`) carries no explicit
execution outcome. The classifier cannot distinguish it from a completed
command whose outcome was never reported, and therefore treats it as a
COMPLETED observation, classified by the command's shape. This is a stated
limitation of the correction, not a claim of complete outcome detection.
