# Qualification report — ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01

## Verdict

**CALIBRATION_PROMISING_NOT_QUALIFIED**

The existing estimator is demonstrably conservative for the one authoritative session: it overestimated provider-reported input in **32/32** submitted attempts. A simple constant correction materially improves observed accuracy, but it introduces underestimation on most observed rows and there is **no independent session holdout**. No production change is justified by this ACT.

## Repository and artifact identity

- Repository: `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`
- Remote: `git@github.com:s1onique/clinemm.git`
- Entry source HEAD: `f87e1547d85f1f01b7040bda1b1495812b5c5a0c`
- Offline branch: `act/compaction-estimator-offline-calibration01`
- Source trace SHA-256: `601450acb83dad00a84451147b194ed01010190763b9442d6ed8693900eef5ed`
- Trace schema: `cline.roundc-latency-trace.v1`
- Session: `1794881611778_557z3`
- Model/provider: `qwen3.8-flash-next-iq3_s` / `openai-compatible`
- Installed extension version: `4.1.16-5a1c485cb`; bundle SHA-256: `bfda14727f7a2e91fffb47d74884a58dc11c29f7cbce8612e660a4e473a80fb5`

## Evidence and joins

- Independent sessions: **1**
- Authoritative eligible request pairs: **32**
- Excluded observations: **0** from the supplied final trace
- Join authority: `sessionId + preparationRequestId + modelRequestId`
- The trace contains 32 decisions and 32 distinct completed attempts. Duplicate completion events are deduplicated by attempt identity; chronology is never used.
- Historical PARITY01 rows are excluded from fitting because they are `INFERRED_CHRONOLOGICAL_PAIRING`.
- The unsubmitted shadow candidate is excluded because it is `LIVE_SHADOW_INFERENCE_UNCALIBRATED`.

## Baseline estimator error

For final provider-visible estimates against provider-reported complete input:

- Ratio min / median / mean / max: **1.227373 / 1.248834 / 1.264511 / 1.495628**
- P10 / P50 / P90 / P95 / P99: **1.232096 / 1.248834 / 1.310669 / 1.356647 / 1.454715**
- Median absolute error: **9,806 tokens**
- P95 absolute error: **17,806.2 tokens**
- Maximum absolute error: **21,416 tokens**
- Underestimation frequency: **0%**
- Maximum underestimation: **0 tokens**

The frozen last-pre-compaction observation is reproduced: estimate 97,079, provider input 75,663, difference 21,416.

The pre- and post-compaction groups are descriptive only. The compaction decision candidate was not submitted; its post-compaction provider usage is a different representation and is not its label.

## Offline Pareto frontier

| Candidate | Median absolute error | P95 absolute error | Max underestimation | Underestimating rows | Complexity |
|---|---:|---:|---:|---:|---|
| Baseline | 9,806 | 17,806.2 | 0 | 0/32 | none |
| Constant ×0.79935 | 443 | 1,408.95 | 954 | 20/32 | one multiplication |
| Model-scoped constant ×0.79935 | 443 | 1,408.95 | 954 | 20/32 | multiplication + scope gate |
| Affine 0.80783E − 601.97 | 517.5 | 1,095.35 | 995 | 23/32 | two operands |

All are non-dominated under the stated accuracy/safety axes. The model-scoped constant is the simplest candidate with near-best median accuracy, but it is not preferable to the global constant by measured accuracy. The affine model does not beat the constant on median error.

## Holdout quality

Only one authoritative session exists. The exploratory fit used the first 21 requests and evaluated the later 11 requests as **DEPENDENT_CHRONOLOGICAL_HOLDOUT**. This is not independent generalization. The later suffix nevertheless showed the constant candidate's median absolute error falling from 14,398 to 310 tokens, while it underestimated 10/11 suffix rows by at most 954 tokens.

Classification: **INSUFFICIENT_INDEPENDENT_HOLDOUT** for any production-readiness claim.

## Counterfactual safety

Recorded policy values were preserved exactly: raw/effective ceiling 115,200; trigger 103,680; underestimate factor 1.

- Baseline: zero observed underestimates; zero unsafe near-ceiling classifications; zero observed over-limit requests accepted.
- Constant candidate: 20/32 rows underestimate actual input; max 954 tokens; no observed near-ceiling request becomes falsely safe and no observed over-limit request exists in the sample.
- Affine candidate: 23/32 rows underestimate actual input; max 995 tokens.
- The actual compaction counterfactual remains **HYPOTHESIS_ONLY** because the pre-compaction candidate was never submitted.
- A finite sample with zero unsafe near-ceiling cases does not prove future inputs cannot overflow. The demonstrated calibration range is 6,061–75,663 provider-input tokens, and residual risk outside that range remains unmeasured.

## Adversarial witnesses

T1–T16 all pass. They cover exact joins, chronology rejection, duplicate completion handling, retry distinction, missing usage, cache subset semantics, pre/post representation separation, inferred/shadow exclusion, session leakage, dense-content underestimation, missing ceiling, unknown model fallback, preserved policy arithmetic, raw-content exclusion, and deterministic outputs.

## Historical premature-compaction hypothesis

**NOT PROVEN; NOT REFUTED BY AUTHORITATIVE LABELING.**

The trace proves that the baseline estimator was conservative on the 32 submitted projections, and the independent shadow measured a much smaller token count for the unsubmitted pre-compaction candidate. However, the shadow used a non-equivalent tool-schema rendering and is not an authoritative label for that candidate. The candidate's exact provider input remains unavailable. The evidence therefore supports the hypothesis that the pre-compaction estimate was too conservative, but it does not establish the candidate's true token count or prove that compaction was unnecessary.

## Recommended decision

**Preserve the production baseline. Acquire new independent evidence before proposing a bounded implementation ACT.**

No calibration constant is promoted. A future qualified ACT should collect at least one additional independent session with the same authoritative identities, preserve exact final-projection/provider-attempt correspondence, and include an explicitly pre-registered conservative safety criterion. A production implementation, if later justified, should be model/provider-scoped and must retain the final request-budget guard, the output reserve, provider-confirmed overflow handling, and the existing underestimate-factor mechanism.
