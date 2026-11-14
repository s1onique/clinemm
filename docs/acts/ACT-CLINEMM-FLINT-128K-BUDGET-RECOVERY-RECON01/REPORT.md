# ACT-CLINEMM-FLINT-128K-BUDGET-RECOVERY-RECON01 — REPORT

## 1. Primary verdict

**`HALT_FALSE_BUDGET_REJECTION`**

The 128K rejection is a **false budget rejection caused by an authority/representation mismatch**. The task-contract guard measures the internal compacted `MessageWithMetadata[]` representation. Provider dispatch receives a materially smaller provider-visible representation after the production `MessageBuilder.buildForApi()` and `messagesToAgentMessages()` conversions.

For the first rejected candidate, the unchanged production guard estimated **133,487 tokens** (source-equivalent replay; historical **133,626**) and failed closed. The same logical candidate, same system prompt, same tools, after the production provider-message conversion, measured **66,059 estimated tokens** and fit under the unchanged 128,000 ceiling.

This is not:
- a false claim that the provider would necessarily accept the request (provider usage for the blocked candidate is `UNAVAILABLE_FROM_TRACE`);
- contract-headroom starvation (the carried contract adds only 29 tokens);
- a failed summarization (the 16K summary was generated, persisted, projected, and used);
- an automatic retry loop (all later failures were explicit user resumptions).

No production repair is implemented by this ACT.

## 2. Entry, final HEAD, and installed identity

| Item | Value |
|---|---|
| Repository | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` (`git@github.com:s1onique/clinemm.git`) |
| Branch | `main` |
| Entry HEAD | `f4e22222e881748cb712c7cf4e7e0cd659a57ba8` |
| Expected budget ancestor | `b03d935cfd2834953c1ab0daa9067c26b753f141` — ancestor YES |
| Expected header ancestor | `f4e22222e881748cb712c7cf4e7e0cd659a57ba8` — HEAD YES |
| Final HEAD | `f4e22222e881748cb712c7cf4e7e0cd659a57ba8` |
| Worktree | Clean at entry; only this ACT's redacted docs at closure |
| `stash@{0}` | `6c9f5493e8406caf3f11f729504f6fdfadf115c8` — preserved verbatim |
| Installed extension | `4.1.16-5a1c485cb-e761cea8c` (`e761cea8c`) |
| Installed bundle SHA-256 | `48998ee982f7b5bcae8123359bbbbf6a2487a578fd6081f978ed2f4c1a5b62b5` |

The installed source is one commit behind HEAD. The difference is confined to the task-header `ContextWindow` component and tests; the budget guard is already present. This is a **non-budget bundle discrepancy**.

## 3. Exact failing session

`1794645443041_2y9gh` — started 2026-11-14T08:37:23.182Z, `openai-compatible` / `flint:16gb`, configured ceiling 128,000, model context 256,000.

- canonical transcript: 112 messages, SHA-256 `4b6df2b894d54099c118f0a9cab043c16de65a841b821ecfa6ee2ac7106e3a18`
- compaction sidecar: SHA-256 `ab51254955b3a73396a0889fdf1be69a7cd7670679bf155c29f26f804ac98cd6`
- raw artifacts remain local/private and are not committed.

## 4. W/P/B accounting

### Matched historical request (not the blocked candidate)

Exact prior captured provider request, recomputed with the current estimator:

| Quantity | Value |
|---|---:|
| W | 91,222 |
| P (same request) | 75,341 |
| W/P | 1.211 |

The estimator is conservative by about 21% for that matched request. This was not compared with the blocked candidate's P.

### Blocked candidate (no provider dispatch)

| Boundary | W | Limit | Result |
|---|---:|---:|---|
| Contract-stripped compacted baseline | 132,950 | 128,000 | **A1: already over** |
| Guard input with carried contract | 133,487 (historical 133,626) | 128,000 | rejected |
| Contract-only delta | 29 | — | immaterial |
| Final provider-message representation | 66,059 | 128,000 | fits |

## 5. Compaction and summarizer outcome

The 16K summarizer request had 1,531 input tokens, 9,898 generated tokens, and `finish_reason=stop`. The sidecar was written at 08:47:56.201Z with a 3,688-character summary containing the complete task contract exactly once. The next provider-visible request carried the compacted continuation (`P=19,768`). Therefore C1 and C2 are proven; C4 is rejected.

## 6. Retry cardinality

- guard evaluations/throws: 12 / 12
- new run attempts: 12 (1 initial + 11 explicit user resumptions)
- automatic retries: **0**
- provider dispatches after the first rejection: **0**
- additional compactions: 0; sidecar writes: 0
- persisted/UI error rows: **12**, not 8

The visible estimate grew 133,626 → 136,381 (+2,755). The source-equivalent replay reproduced all 12 values with a constant 139/140-token offset and the identical +2,755 growth. Each resumption added one synthetic `[TASK RESUMPTION]` prompt (~247–248 estimated tokens) and a display-only runtime reminder. This was user-driven non-progress, not an internal automatic retry loop.

## 7. Causal discriminator and ablation

The decisive ablation held the logical candidate, system prompt, and tools constant:

- A — existing guard input: 133,487 → `TaskContractBudgetError`, zero dispatch, zero sidecar write;
- B — same candidate after production provider conversion: 66,059 → fits;
- C — restore original input: same typed error reproduced.

Compaction-target and recovery-loop ablations were intentionally not executed because the evidence conclusively identified the representation boundary and the canonical transcript disproved an automatic retry loop.

## 8. Tests and gates

- disposable production-seam witness: **4/4 passed**, exit 0; removed after capture;
- focused permanent suites: **8 files / 340 tests passed**, exit 0;
- disposable witness typecheck delta: **zero diagnostics**; package-wide typecheck exit 2 from 40 pre-existing unrelated diagnostics;
- `git diff --check`: PASS;
- ACT-owned diagnostics: **0**.

See `evidence/gates.txt` for exact commands.

## 9. Invariants and authorization

Preserved: fail-closed task-contract invariant, 128K ceiling, 16K summarizer cap, model/provider configuration, tool approval/execution, canonical task authority, no partial sidecar, no uncontracted dispatch, no production source change, no stash manipulation, no push/PR/VSIX, no full benchmark.

## 10. One bounded successor repair recommendation

**Outcome R1 — repair the request-budget authority boundary.**

Successor scope: make the existing final request-preparation boundary the single authority for the task-contract budget decision, measuring the provider-visible request representation plus the final system prompt and tools.

RED → GREEN conditions:

1. RED: the historical candidate still throws at the current internal-representation guard with W≈133.5K while its final provider representation is ≈66K.
2. GREEN: the same candidate is accepted under the same 128K ceiling, with the complete contract present exactly once.
3. GREEN: a candidate whose **final provider representation** exceeds 128K still throws `TaskContractBudgetError`, dispatches nothing, and persists no partial sidecar.
4. GREEN: final system prompt and final tool inventory are counted exactly once.
5. GREEN: images, tool results, unusual token distributions, and unknown tokenization remain conservative/fail-closed.
6. GREEN: provider usage is used only for the same logical request; cached input is not subtracted and usage is not double-counted; missing usage is not invented.
7. GREEN: already-contract-bearing summaries do not duplicate or bypass the contract.
8. GREEN: explicit user retry remains distinguishable from any bounded automatic recovery.

Do **not** weaken the guard, raise the ceiling, change the summarizer cap, strip instructions, add a second estimator authority, or dispatch an uncontracted fallback.

## 11. Remaining uncertainties

- The failing run's exact provider-request capture was absent after cleanup, so the reconstruction is `SYNTHETIC_REAL`, not `REAL`; the exact tool-schema serialization remains unavailable.
- Provider token usage for the blocked candidate is `UNAVAILABLE_FROM_TRACE`; the 66,059 value is an estimate of the final representation, not observed P.
- The live source of the 16K summarizer cap is unavailable; the current source default is 8,192.
- The screenshot's “8 visible errors” reflects a viewport/UI observation; the canonical persisted count is 12.
