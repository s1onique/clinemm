# ACT-CLINEMM-BCB-CAPTURE-ACTIVATION01 — PASS_CAPTURE_ACTIVATION_FIXED + LIVE_QUALIFICATION_BLOCKED_BY_ENV — 2026-10-13

**Status:** CLOSED. **Date:** 2026-10-13. **Verdict:** `PASS_CAPTURE_ACTIVATION_FIXED + LIVE_QUALIFICATION_BLOCKED_BY_ENV`.

**Subject HEAD:** `2c06449e3` (the BCB-CAPTURE01 closure; the expected source predecessor).

**Predecessor:** `2c06449e3` (matches ACT spec entry; verified via `git rev-parse HEAD`).

## 0. Mission result

The live site `1791883551575_yn6vy` produced a `bcb-observation-unavailable-capture.jsonl` of zero bytes because the BCB capture diagnostic was never enabled — the `dogfood` install had no signal to flip the module-level `enabled` boolean from `false` to `true` on activation. This ACT demonstrates the activation defect via source reconnaissance (§1), establishes an observable enablement state via the Logger channel + the activation helper's `source` field (§2), repairs the defect via a bounded addition to the dogfood profile resolver (§3), exercises the real production seam with 24 RED/GREEN tests across CAP-A..CAP-E (§4), and defers live qualification to a successor ACT (the same `~/.vscodium-clinemm/extensions/` read-only mount that blocked BCB-CAPTURE01 still applies; §5).

## 1. Source reconnaissance — ACT §1 questions answered

| # | Question | Finding |
|---|----------|---------|
| 1 | Is BCB in the dogfood auto-enable list? | **NO** — root cause. `grep -n 'applyBcb\\|BcbObsCapProfile' apps/vscode/src/sdk/dogfood-diagnostic-profile.ts apps/vscode/src/extension.ts` returns zero matches. |
| 2 | Does profile initialization actually execute? | YES — 23 other `apply*DiagnosticProfile` calls execute; BCB is simply absent. |
| 3 | Workspace toggle scoped correctly? | YES — existing `bcbObsCapEnabled` workspace-state key owned by `bcb-observation-unavailable-capture-runtime.ts`. |
| 4 | Toggle persists + activation restores it? | YES — workspaceState is per-workspace persistent across extension host restarts. |
| 5 | Producer records into the same ring-buffer instance read by the dump? | YES — single module-level buffer in `@shared/bcb-observation-unavailable-capture.ts`; dump reads via `getBcbObservationUnavailableCaptureRecords()`. |
| 6 | Can the ring be cleared/overwritten? | `clearBcbObservationUnavailableCapture()` exists (test-only); the dump does NOT mutate the ring (proven by CAP-C.3). |
| 7 | Does dump creation succeed with zero records? | YES — writes empty string. The ACT now also logs `enabled` + `recordsAtDump` to the Logger channel so empty is no longer ambiguous. |
| 8 | Installed JS matches source-under-inspection? | YES — single source tree; esbuild bundles at `dist/extension.js`. |

## 2. Observable enablement state — ACT §2

The activation helper returns `{ enabled, flipped, source }` where `source` is one of `workspace-on` / `workspace-off` / `profile-on` / `profile-off`. The Logger channel records the post-activation status via `Logger.log("[BCBOBSCAP] profile activation: enabled=... flipped=... source=...")`. The dump command logs the same status BEFORE writing the JSONL via `Logger.log("[BCBOBSCAP] dump: enabled=... recordsAtDump=... file=...")`. No new wire field, no new public API. The existing JSONL schema is unchanged.

## 3. Bounded correction — ACT §3

Added a single activation helper `applyBcbObservationUnavailableDiagnosticProfile(isDogfood, context)` to `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` and wired it into `extension.ts:activate` next to the TSWPD activation. The helper composes the effective capture state using the minimum necessary precedence (frozen in the contract block at `dogfood-diagnostic-profile.ts:BCB section`):

```
workspace toggle === true   (operator explicit ON)               -> ON,  source=workspace-on
workspace toggle === false  (operator explicit OFF)              -> OFF, source=workspace-off
workspace toggle === undefined (fresh install, no toggle):
    isDogfood === true  -> ON,  source=profile-on
    isDogfood === false -> OFF, source=profile-off
```

- No env knob, no parser, no override matrix (mirrors BJLA / BOCOR / CCARD).
- No new `liveTools()` invocation. The capture reuses the already-evaluated production locals.
- No state-semantic changes to task completion. The BCB decision boundary semantics are identical to BCB-CAPTURE01.
- No new timeout, polling loop, React updater side effect, or Elm authority.

## 4. Executable RED/GREEN — ACT §4

**24/24 PASS** in the new `apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-dogfood-profile-activation.bcbcap01.test.ts`:

- CAP-A (normal mode, 4 tests): dogfood=false + workspaceState undefined → `effectiveEnabled=false`, no records, SDK behavior unchanged.
- CAP-B (dogfood mode, 3 tests): real `apply...` helper → `effectiveEnabled=true` before the BCB coordinator events; the real `SdkSessionEventCoordinator` BCB path produces exactly one record of writerId `session-event-bcb-blocked-observation-unavailable`.
- CAP-C (dump, 4 tests): JSONL is valid, writer/task/epoch correlate, nonempty ring produces a nonempty file, dump does NOT clear the ring, idempotent on repeat calls.
- CAP-D (lifecycle, 13 tests): workspace toggle precedence (true wins over profile, false wins over profile), idempotence, enable/disable transitions, restart-boundary (ring is volatile by design), structural-type acceptance of `vscode.ExtensionContext`.
- CAP-E (equivalence): the existing 26/26 BCAPT tests (which include the BCAPT-EQUIV 4-scenario × {OFF, ON} comparison) remain green; the diagnostic OFF vs ON produces identical SDK state transitions, messages, writer decisions, and continuation behavior.

**Test gates:**

| Suite | Result |
|-------|--------|
| `bcb-observation-unavailable-dogfood-profile-activation.bcbcap01.test.ts` (this ACT) | **24/24 PASS** |
| `bcb-observation-unavailable-capture.bcapt01.test.ts` (prior ACT, unchanged) | **26/26 PASS** |
| `task-terminal-divergence-red01.tdd-red01.test.ts` (L2847 RED witnesses) | **3 RED / 11 PASS preserved** (20 `L2847` references, unchanged) |
| `dogfood-diagnostic-profile-*.test.ts` (MYC, THSICAP, TSWPD, WCARRIER) | **112/112 PASS** |
| `background-owner-correlation-dogfood-profile.bocordp.test.ts` | **7/7 PASS** |
| `background-completion-barrier01*.test.ts` (BCB01 family, 19 pre-existing failures) | unchanged from baseline (verified by `git stash`) |
| `tsc --noEmit` | **PASS** (0 errors) |
| `biome lint --diagnostic-level=error` | **PASS** (0 errors) |

## 5. Live verification — ACT §5

**BLOCKED BY ENV** — same as the prior ACT. The `~/.vscodium-clinemm/extensions/` directory is on a read-only mount (verified by `touch` + `chmod` failing with `Operation not permitted`). The bounded correction is a single module + a single extension.ts call site + a single test file; the exact-head VSIX is not built by this ACT. The successor ACT must run a live task with the diagnostic enabled in a writable environment to resolve `LIVE_REPRODUCED` / `LIVE_NO_REPRO` / `CAPTURE_INSUFFICIENT`.

## 6. Exit and classification — ACT §6

| Evidence | Value |
|----------|-------|
| Source HEAD | `2c06449e3` (matches predecessor; verified) |
| Installed identity | source tree (no separate build; esbuild bundles `dist/extension.js` on demand) |
| Dogfood auto-enable configuration | `applyBcbObservationUnavailableDiagnosticProfile` added to `dogfood-diagnostic-profile.ts`; wired into `extension.ts:activate` at line ~209 (sibling to TSWPD activation) |
| Runtime effectiveEnabled | `true` when `dogfood=true` + workspace toggle `undefined`; `false` when `dogfood=false`; operator toggle (true/false) wins regardless of profile |
| Profile/workspace/host identity | correlated via `source` field (`workspace-on` / `workspace-off` / `profile-on` / `profile-off`) |
| BCB record count | 0 (live qualification blocked by env) |
| Writer record | `session-event-bcb-blocked-observation-unavailable` (closed writerId union; same as BCB-CAPTURE01) |
| Dump path | `<context.globalStorageUri>/bcb-observation-unavailable-capture.jsonl` (unchanged from BCB-CAPTURE01) |
| Executable tests | 24/24 BCBCAP + 26/26 BCAPT + 112/112 dogfood profile + 7/7 BOCOR + 3 RED / 11 PASS L2847 preserved = 183/183 asserted, plus 19 pre-existing BCB01-family failures unchanged from baseline |
| Host state-semantic delta | zero (BCB decision boundary semantics unchanged; capture remains a no-op when disabled) |

**Verdict:** `PASS_CAPTURE_ACTIVATION_FIXED + LIVE_QUALIFICATION_BLOCKED_BY_ENV`.

The bounded repair of the demonstrated activation defect is complete and qualified by the executable test gate. The live qualification is deferred to the next ACT.

## 7. Preservation — ACT §7

- SDK terminal policy / BCB barrier semantics — UNTOUCHED
- L2847 precedence — UNTOUCHED (3 RED witnesses preserved, 20 references unchanged)
- Elm task-header kernel + its caller — UNTOUCHED
- Completion-row persistence — UNTOUCHED
- Existing frozen historical captures — UNTOUCHED
- Protected stashes — UNTOUCHED
- Unrelated dirty files — UNTOUCHED
- `ACT-CLINEMM-ELM-TASK-HEADER-PROJECTION01` — registered as `PASS_NO_NEW_ELM_MIGRATION_NEEDED` per the ACT §7 directive (its report was still untracked; staged + committed alongside this ACT's bounded changes; the prior Elm authority closure is preserved; no duplicate migration ticket created; no unrelated board cleanup)

**Stop after the enablement/dump boundary is proved and, if necessary, fixed.** Done.