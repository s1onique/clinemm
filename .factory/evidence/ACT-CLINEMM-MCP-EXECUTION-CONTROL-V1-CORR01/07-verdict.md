# C7 - Terminal verdict

**ACT:** `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01`
**Branch:** `main`
**Entry HEAD:** `9c9506f0c6fd779ca5c75499df88ab7623846eca`
**Entry tree:** `6fd3e8ffb2d0b378fcbbe1853f45f5fecf7be870`
**Subject HEAD:** `3f4a5e72ece56c18ff8055870f2eccc8e5ccbebc`
**Subject tree:** `bc4c7de1f976025f4941ac6682c14fd8f6498543`
**Version:** `4.1.26`
**Predecessor consumed:** `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01` (implementation at `9c9506f0c6fd`) - consumed, not re-done.

---

## C7.1 Verdict

# `PASS_STRUCTURAL_ONLY`

> **What is proven:** all five reported defects are corrected in the PRODUCTION
> code, and the correction is proven LOAD-BEARING. Each defect has a
> behavioral witness that was RED against the unmodified production code and is
> GREEN after the correction, and reverting each individual production change
> reproduces exactly the defect it corrects. The controller lifecycle, the
> authorization model, the two MCP operations and the read-only view are
> UNCHANGED - proven by an empty diff on every one of those files and by the
> conservation witnesses. The extension bundle was CLEAN-REBUILT from the exact
> final implementation HEAD, and the corrected code is verified present IN the
> built artifact.
>
> **What is NOT proven:** the **live** pilot against a running installed
> extension. No ClineMM extension is installed on this host, and the
> code-execution environment does not install one. The operator's exact
> build / install / opt-in steps and the five ADDED pilot steps that exercise
> the corrected contract are in `06-live-qualification.md`.

## C7.2 The defect ledger

| ID | Severity | Defect | Correction | RED | GREEN | ABLATION |
|---|---|---|---|---|---|---|
| C1 | P0 | request replay returned the wrong outcome | the ledger lookup moves AHEAD of the active-owner check | `C1-1` FAIL | PASS | A -> `C1-1` FAIL |
| C2 | P0 | two different request ids could both reach the lifecycle | a single-slot in-flight start reservation, taken synchronously, released in `finally` | `C2-1` FAIL | PASS | B -> `C2-1` FAIL |
| C3 | P0 | a write credential could read a task it never started | the event-read fence is the session THIS client started | `C3-1` FAIL | PASS | C -> `C3-1` FAIL |
| C4 | P1 | an in-flight ledger entry could be evicted | an IN-FLIGHT entry is NEVER evicted; `complete()` carries the fingerprint | `C4-1`, `C4-3` FAIL | PASS | D -> `C4-1`, `C4-2b`, `C4-3` FAIL |
| C5 | P1 | responses could arrive out of order on one socket | per-socket sequence numbers; responses are flushed in REQUEST order | `C5-1` FAIL | PASS | E -> `C5-1` FAIL |

## C7.3 The executable receipts

| Gate | Command | Result |
|---|---|---|
| Behavioral RED | `bunx vitest run --config vitest.config.ts src/sdk/control-seam/control-seam.execution-control-v1-corr01.test.ts` | **6 failed \| 8 passed (14)** against the UNMODIFIED production code |
| Behavioral GREEN | same command, after the correction | **15 passed (15)** |
| The existing V1 suite | `bunx vitest run --config vitest.config.ts src/sdk/control-seam/control-seam.execution-control-v1.test.ts` | **31 passed (31)** |
| The focused gate | both files together | **46 passed (46)** |
| The whole control-seam suite | `bunx vitest run --config vitest.config.ts src/sdk/control-seam/` | **2 failed \| 139 passed (141)** - the 2 are the PRE-EXISTING `owner-exclusivity.cor02` failures recorded by the predecessor |
| The `src/sdk/` sweep - baseline | `bunx vitest run --config vitest.config.ts src/sdk/` (CORR01 diff stashed) | 64 failed files \| **175 failed / 5642 passed** |
| The `src/sdk/` sweep - corrected | same command, with the CORR01 diff | 64 failed files \| **170 failed / 5647 passed** |
| Regression delta | - | **-5 failures, +5 passes, identical failing-file count. No new failure.** |
| Typecheck | `bun run check-types` | **EXIT 0**, 0 diagnostics |
| Lint | `bunx biome check --config-path ./biome.jsonc <the 4 changed files>` | **EXIT 0** (1 pre-existing warning, 25 infos - the same profile as the pristine baseline) |
| Format | `bunx biome format --config-path ./biome.jsonc <the 4 changed files>` | **clean, no fixes applied** |
| Build | `rm -rf dist && bun esbuild.mjs` | **build finished** - 57 772 457 bytes - SHA-256 `a8e07a5e5d21575d5b2208bf4ca4fc1caa64d92dd04edc316b71e6cdfa9beb29` |
| Artifact identity | `grep` on the built bundle | the C2 and C4 markers are PRESENT in the artifact |
| Worktree | `git status --short` | **clean**; `git stash list` empty |

## C7.4 Conservation - proven, not asserted

| Property | Receipt |
|---|---|
| The controller lifecycle is UNCHANGED | `SdkController.ts`, `control-seam-authority.ts`, `control-seam-runtime.ts` - EMPTY DIFF |
| The authorization model is UNCHANGED | `control-seam-mutation.ts`, `control-seam-client.ts`, `control-seam-proxy.ts` - EMPTY DIFF; CN-1 and V1 R1-1..R1-4, R6-1..R6-9 PASS |
| The two MCP operations are UNCHANGED | `control-seam-protocol.ts` - EMPTY DIFF; no protocol version bump; no proto change |
| The read-only view is UNCHANGED | CN-2 and V1 R6-6 PASS - exactly the original two operations, `readOnly: true` |
| The mutation-authorized view is UNCHANGED | CN-3 and V1 R6-7 PASS - exactly the two write operations added |
| No new dependency, no new runtime, no second execution loop | the diff surface is the server + the ledger + the tests |

## C7.5 The artifact-identity correction

The predecessor ACT bound its bundle to `ae802ca980ae116a3d4c5d35411f4e6628681ac2`
- the PRE-IMPLEMENTATION entry HEAD - which is not a valid exact-head build
attribution. This ACT performs a CLEAN rebuild from the exact final
implementation HEAD `3f4a5e72ece56c18ff8055870f2eccc8e5ccbebc` and asserts the
corrected binding. The corrected code is verified PRESENT in the built bundle.

## C7.6 What is next

1. The operator rebuilds and installs from the exact final implementation HEAD.
2. The operator runs the live pilot - the predecessor's eight steps PLUS the five
   ADDED steps in `06-live-qualification.md` that exercise the corrected
   contract.
3. Only then is the mutation grant enabled in the regular `codium-clinemm`
   profile.

No broad re-review of C9/C10, Elm, or the upstream integration is warranted by
this correction - the diff surface is bounded to the control layer and every
conserved surface is provably untouched.
