# ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — execution-progress classifier correction

**Verdict: `GO_EXECUTION_PROGRESS_CLASSIFIER_DOGFOOD`**

Scope: **the execution-progress classifier and the execution-outcome
authority only.** R2 is NOT redesigned. R3 is NOT implemented. Compaction,
PLAN behaviour, the R2 default OFF, the command authorization layer and the
sandbox are UNCHANGED.

Predecessor evidence: `ACT-CLINEMM-AUTONOMOUS-RECOVERY-TRIGGER-FORENSICS-01`.

---

## 1. The defect

The host classifier's decision shape was:

```ts
return isInspectionCommandInput(input) ? "inspected" : "executed";
```

That shape has NO distinction between recognised execution, unrecognised
inspection, shell environment setup and unknown command semantics: anything
the classifier fails to positively recognise as an inspection becomes
EXECUTION. The independent review reproduced SEVEN counterexamples against
the production classifier.

SSH was only ONE manifestation of that general optimism. The defect also
covered shell assignments (`L=/tmp grep -n foo bar`), environment
inspection commands (`uname -a`) and — in the opposite direction — `git`
MUTATIONS that the whitelist reported as inspections (`git tag new-tag`,
`git status > file`).

A second, independent defect sat at the host/runtime boundary: the host
correctly DECLINED a failed observation, but a decline is not a verdict, and
the runtime's fallback then re-classified the very same call as an
execution. The host's authoritative negative observation DISAPPEARED.

---

## 2. The production correction

Three files.

### `sdk/packages/core/src/extensions/tools/execution-progress-classifier.ts`

- A THREE-WAY command classification: `inspection` / `execution` /
  `unknown`. The `unknown` disposition is kept DISTINCT from a recognised
  execution internally.
- SETUP recognition: a bare assignment, an `export`, an `unset` and a `cd`
  are setup segments, and an assignment PREFIX does not change the command's
  classification.
- ENVIRONMENT INSPECTION programs (`uname`, `env`, `id`, `df`, …).
- SSH as a TRANSPORT WRAPPER: OpenSSH separates the destination from the
  command sent for remote execution, so the REMOTE PAYLOAD is classified.
  Options are recognised (an option's VALUE is never mistaken for the
  destination), the destination is the first non-option argument, and a
  dynamically constructed payload yields an honest uncertainty disposition.
- MUTATION detection extended to `git` inspection subcommands that carry a
  mutating construct; the command guard remains the authority.
- An explicit `failed` verdict for a failed or missing execution outcome.

### `sdk/packages/shared/src/agents/execution-stagnation.ts`

A new `failed` round-productivity verdict. A failed round does NOT reset the
stagnation streak — a failed command is not a SUCCESSFUL execution — but it
is also NOT a stall: a failed test is a real result.

### `sdk/packages/agents/src/agent-runtime.ts`

The runtime's fallback no longer launders a failed or missing execution
outcome into a productive execution. The host's authoritative negative
observation survives the boundary.

---

## 3. What was NOT changed

- Any recovery mechanism. No new mechanism was introduced.

---

## 4. Evidence

`.factory/evidence/ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01/`

| Artifact | Content |
|---|---|
| `CAUSAL-SUMMARY.md` | The full causal analysis and the corrected verdict |
| `replay/replay.ts` | The CORRECTED successor replay driver |
| `counterfactual-ledger.*.json` | The Session A / B discriminator |
| `round-ledger.json` | The per-round ledger for both sessions |

The focused production classifier RED/GREEN and the principal production
runtime witness are production test files:

| Test file | Content |
|---|---|
| `sdk/packages/core/src/extensions/tools/execution-progress-classifier.correction01.test.ts` | The seven reproduced counterexamples, the remote-mutation and mixed-command controls, the unknown-command disposition, the execution-outcome authority |
| `sdk/packages/core/src/extensions/tools/execution-progress-classifier.correction01.runtime-witness.test.ts` | The principal production runtime witness over the REAL `AgentRuntime` |

---

## 5. The corrected replay

The predecessor replay's result-collection loop was corrected in a
SUCCESSOR artifact; the original evidence package is preserved unchanged.

The predecessor's loop broke out of its scan as soon as it found ANY later
tool-calling assistant message ANYWHERE in the run — including messages
BEHIND the scan cursor — which truncated the collection after the first
following user message. The corrected loop scans forward to the ACTUAL next
execution-round boundary and collects BY TOOL-CALL IDENTITY, and it asserts
completeness: a missing result is recorded as `UNAVAILABLE_FROM_TRACE`.

Under the corrected collection, the predecessor's OBSERVED historical R1
injection identities are reproduced EXACTLY (Session A run 2 rounds 8 and 22;
transcript message indices 26 and 55; streak 5), matching the transcript's
own runtime notices at message indices 28 and 57.

**The reviewer's causal correction is CONFIRMED.** Session A's injections are
UNCHANGED by the repair, while Session B's reconnaissance rounds — the
`L=/nix/store/...` Nim library reads at message indices 36, 46, 60, 62, 64,
66, 68, 70, 76, 82, 162 and 176, including the six consecutive rounds
immediately before the first successful edit — were false productivity that
the repaired classifier detects. Session B's R1 eligibility moves from NONE
to run-2 round 25 (message index 68).

**R2 entry reachability is NOT established for either replayed session.** The
principal production runtime witness establishes that the EXISTING R2 entry
condition becomes REACHABLE when the corrected classifier feeds it a
trajectory of recognised remote inspections — but neither replayed session
reaches it, so live R2 eligibility remains untested.

---

## 6. Verification

| Gate | Result |
|---|---|
| Focused classifier RED/GREEN | 10/10 GREEN |
| Principal runtime witness | 4/4 GREEN |
| Existing classifier tests | 7/7 + 4/4 GREEN |
| Production-seam replay | 4/4 GREEN |
| R1 conservation + R2 bounded-objective suites | 46/46 GREEN |
| Shared `src/agents/` suites | 47/47 GREEN |
| Typecheck | shared 0 · agents 0 · core byte-identical to the predecessor (45 pre-existing) |
| Biome | no findings in the changed files |
| `bun run build:sdk` | succeeded |

**ACT_OWNED_DIAGNOSTICS = NONE.**

---

## 7. Verdict

`GO_EXECUTION_PROGRESS_CLASSIFIER_DOGFOOD`

The GO verdict authorises the next isolated R2 dogfood build. It does **not**
establish live behavioral effectiveness.

- R1's threshold (5) and allowance (2).
- R2's activation limits and selection limits.
- The R2 environment opt-in and its default OFF.
- PLAN behaviour.
- Compaction.
- The command authorization layer and the sandbox.
- Any recovery mechanism. No new mechanism was introduced.
