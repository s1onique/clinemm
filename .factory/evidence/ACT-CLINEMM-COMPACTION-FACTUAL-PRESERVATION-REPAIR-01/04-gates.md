# 04 — The gates

ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01

## The ACT-owned witnesses

| File | Witnesses | What they establish |
|---|---|---|
| `knowledge-loss-discriminator/factual-preservation.test.ts` | 14 | The factual-consistency scoring layer, including the RED fixture and the reviewer's six adversarial cases. |
| `bounded-evidence-contract/boundary-witness.test.ts` | 6 | The repaired source-boundary witness: the negative control and the positive control. |
| `source-bound-evidence.test.ts` | 21 | The source-bound evidence carry-forward: the default-OFF containment, the verbatim carry, the confidentiality refusals, the budget, the idempotence, the boundary stability, the anti-spoofing, and the production seam. |

## The existing suites

| Suite | Result |
|---|---|
| `src/extensions/context/` | 74 files passed, 1 skipped; 1 068 tests passed |
| The ACT-owned files | 5 files; 85 tests passed |
| The typecheck | 45 → 45; **zero delta**; **zero ACT-owned diagnostics** |
| Biome | 10 files checked; 0 errors |
| `git diff --check` | clean |

## The DEFAULT-OFF equivalence

The new behaviour is behind `SOURCE_BOUND_EVIDENCE_CARRY_FORWARD_ENABLED =
false`, the switch being at the ADMISSION boundary. While it is off:

- the extraction returns an empty report;
- the carry-forward reports `applied: false` and returns the message list
  UNCHANGED — the summary message is byte-identical;
- the production request is byte-identical.

The witness "the production seam is UNAFFECTED while the switch is off"
asserts the last two points directly, by object identity.

## What was NOT performed

- No VSIX packaging.
- No installation.
- No installed-live qualification.
- No second workload: W2 did not acquire O4 or O7, so it cannot serve as an
  independent reproduction of the decisive items. Applying W1's oracle to W2
  would be manufacturing a workload, which the ACT forbids.
- No repetition campaign: one live screening run per arm.

## The production delta

| File | Change |
|---|---|
| `sdk/packages/core/src/extensions/context/source-bound-evidence.ts` | NEW — the source-bound evidence carry-forward. |
| `sdk/packages/core/src/extensions/context/source-bound-evidence.test.ts` | NEW — its witnesses. |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/factual-preservation.ts` | NEW — the factual-consistency scoring layer. |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/factual-preservation.test.ts` | NEW — its witnesses. |
| `sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/evidence-identity.ts` | NEW — the evidence-identity vocabulary. |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/boundary-witness.ts` | NEW — the repaired source-boundary witness. |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/boundary-witness.test.ts` | NEW — its witnesses. |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/source-prefix.ts` | MODIFIED — the synthetic observation gained a matching `tool_use` and an affirmative payload, so the positive control exercises the real read path. |
| `sdk/packages/core/src/extensions/context/compaction.ts` | MODIFIED — the carry-forward is applied at the three production integration sites. |
| `sdk/packages/core/scripts/factual-preservation-qualification.ts` | NEW — the live qualification of the candidate ladder. |
| `sdk/packages/core/scripts/factual-preservation-rescore.ts` | NEW — the re-score over the saved arms. |
