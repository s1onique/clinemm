# 07 — Gates

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

## The gate table

| Gate | Result | Evidence |
| --- | --- | --- |
| **Focused executable witnesses** | **34 / 34 PASS** | `sdk/packages/core/src/extensions/context/bounded-evidence-contract/bounded-evidence-contract.test.ts` |
| **Existing compaction/context regression tests** | **PASS — 1 028 passed, 0 failed** in `src/extensions/context` (71 files passed, 1 skipped) | `vitest run --config vitest.config.ts src/extensions/context` |
| **Existing confidentiality and authority controls** | **PASS** | The contract REUSES `isSensitiveSourceFilePath()` and `sanitizeOutcomeText()` unchanged; 10 adversarial witnesses; ZERO measured leakage on the real prefix |
| **Relevant typecheck** | **PASS — 72 diagnostics, 0 ACT-owned** | `tsc --noEmit -p tsconfig.dev.json`. The baseline WITHOUT the ACT's files is also 72. |
| **Biome** | **PASS — 0 errors** | `biome check` over the 8 ACT paths |
| **Git diff hygiene** | **PASS** | `git diff --check` clean; no whitespace errors |
| **No new regressions** | **PASS** | See the full-suite comparison below |
| **No production delta** | **PASS** | Every changed path is a NEW untracked file. `PRODUCTION_DELTA=NONE`. |

## The full-suite comparison

The `@cline/core` suite has a PRE-EXISTING failure set that is unrelated to
this ACT (hub server, composio connectors, seatbelt sandbox availability,
checkpoint restore). The ACT's contribution was measured by running the suite
twice — once WITH the ACT's files and once with them REMOVED — and
comparing.

| Run | Test files | Tests |
| --- | --- | --- |
| BASELINE (ACT's files removed) | 17 failed / 395 passed / 3 skipped (415) | 113 failed / 6 119 passed / 162 skipped (6 394) |
| WITH THE ACT | 17 failed / **396** passed / 3 skipped (416) | 113 failed / **6 153** passed / 162 skipped (6 428) |

**IDENTICAL failure count (113), IDENTICAL failing file set (17), and exactly
+34 passing tests — which is exactly the ACT's 34 new witnesses.**

```text
NEW_REGRESSIONS=0
```

The baseline's 17 failing files are:

```text
src/extensions/composio/composio-tools-extension.test.ts
src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts
src/hooks/checkpoint-hooks.test.ts
src/hub/runtime-host/hub-runtime-host.test.ts
src/hub/server/boundary.test.ts
src/hub/server/cloud-session-service.test.ts
src/hub/server/fetch-wiring.test.ts
src/hub/server/hub-plugins.test.ts
src/hub/server/index.test.ts
src/hub/server/replay-wire.test.ts
src/hub/server/ui-events.test.ts
src/hub/settings.test.ts
src/runtime/command-policy/path-authority.temporary-external.test.ts
src/runtime/sandbox/macos/seatbelt-availability.test.ts
src/runtime/sandbox/sandbox-backend.test.ts
src/session/checkpoint-restore.test.ts
src/session/services/persistence-service.test.ts
```

**None of them is in `src/extensions/context`**, and the focused
`src/extensions/context` suite is 100 % green.

The suite is ORDER- and TIMING-dependent (the `hub` suites start real
servers and take SQLite locks), so an absolute failure count is not a
stable measure. The stable measure is the FAILING FILE SET, and it is
unchanged by this ACT.

## The ACT-owned witnesses, by group

| Group | Count | What it establishes |
| --- | --- | --- |
| The frozen source prefix | 5 | The boundary and its identity are exact; a different boundary is a different identity; the contamination window is measurable. |
| The bounded evidence contract | 10 | Observations are admitted; failures are admitted as NEGATIVE; arguments, credential paths, unbounded bodies and unrecognized shapes are refused; the approved scalar rule is unchanged. |
| The adversarial trust boundary | 4 | Runtime-metadata impersonation is neutralised; a production section marker cannot be forged; the frame cannot be closed by the body; private reasoning is not published. |
| The request budget | 3 | The budget is spent in order; the omissions are reported; the added cost is bounded. |
| The per-arm availability map | 5 | Only `PRESERVED` is `AVAILABLE`; one arm's map is never reused for another; an ignored item is a CANDIDATE model failure. |
| The relevance-ordered selection | 6 | Deep evidence is reached; the selection is deterministic; the confidentiality refusals are unchanged; the kept lines stay in order; the informative lines survive; a credential line does not. |

## The artefacts

| Path | Role |
| --- | --- |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/source-prefix.ts` | C1 — the frozen source prefix and the post-boundary marker |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/contract.ts` | C2 — the bounded, attributed evidence admission contract |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/availability.ts` | C3 — the per-arm information availability map and the corrected classification |
| `sdk/packages/core/src/extensions/context/bounded-evidence-contract/bounded-evidence-contract.test.ts` | C4 — the 34 ACT-owned witnesses |
| `sdk/packages/core/scripts/bounded-evidence-contract.corrected-replay.ts` | C5 — the corrected historical replay with the frozen boundary and the post-boundary assertion |
| `sdk/packages/core/scripts/bounded-evidence-contract.probe.ts` | C6 — the behavioural probes, including the genuine targeted restoration arms |
| `sdk/packages/core/scripts/bounded-evidence-contract.score.ts` | C7 — the corrected per-arm scoring |
| `sdk/packages/core/scripts/bounded-evidence-contract.w2-qualification.ts` | C8 — the W2 independent qualification |

Every raw history, rendered context, prompt and model answer lives ONLY in
the GITIGNORED `tmp/bounded-evidence/` tree. The committed evidence carries
aggregates, runtime-owned constants, oracle item ids and short verbatim
quotes that are already part of the committed oracle's own criteria.
