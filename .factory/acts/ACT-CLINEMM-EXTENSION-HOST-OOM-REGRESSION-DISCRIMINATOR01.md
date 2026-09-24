# ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01

**PRIMARY PURPOSE**: causality / necessity

## Status

DISCRIMINATORS_INSTALLED_LIVE_SPECIMEN_READY_FOR_OPERATOR

## Frozen evidence

```
GOOD_ARTIFACT                  = d1ecf48dc
BAD_ARTIFACT                   = 99006fbcc
ENTRY_HEAD                     = 97a2efcb07632420666d53f6bd296313bfcf5fba
REGRESSION_COMMIT              = 99006fbccaacb150b78e54dad7bdadc2a1390238
REGRESSION_COMMIT_COUNT        = 1
```

The two-dot interval `d1ecf48dc..99006fbcc` contains exactly one
commit: `99006fbcc` — ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
V3 production-wiring fix.

## Hypothesis (H1)

Propagation of `next.delivery` across
`PendingPromptsController.drain → deps.send → LocalRuntimeHost.runTurn`
is **necessary** for the observed Extension Host OOM regression.

H1 is NOT proven. This ACT discriminates it.

## Ablation

A throwaway diagnostic ablation seam was added to
`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`:

```typescript
private readonly __ablateDeliveryPropagation =
    process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY === "1";
```

The conditional spread at the `deps.send(...)` payload in
`PendingPromptsController.drain` was modified:

```typescript
// Before (production):
...(next.delivery !== undefined ? { delivery: next.delivery } : {}),

// After (with seam, default off):
...(this.__ablateDeliveryPropagation || next.delivery === undefined
    ? {}
    : { delivery: next.delivery }),
```

When `CLINEMM_OOM_DISC01_ABLATE_DELIVERY=1`, the `delivery` field is
dropped from the `deps.send` payload. When unset (default), the
production behavior is preserved byte-for-byte.

**Preserved** (not touched):
- `next.jobId` propagation (line ~529)
- `onBeforeDispatch` forwarding
- C4/C5/C6 hooks
- C7 placement at executeTurn boundary
- all CCARD capture hooks
- CCARD ring/counters
- termination authority tooling
- CPU profiler substrate
- sandbox behavior
- completion/arbitration/presentation semantics

## Discriminators

### AB-DELIVERY-01 (structural)

File: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts`

Given a drained `PendingPromptEntry` with `delivery: "queue"` and
`jobId: "job-1"`, under the ablation:

```typescript
process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY = "1";
// ...
const call = sendCalls[0];
expect(Object.prototype.hasOwnProperty.call(call, "delivery")).toBe(false);
expect(call?.jobId).toBe("job-1");
```

This exercises the **real** `PendingPromptsController.drain` seam (not
a duplicate of the payload-construction helper).

**RED proof**: temporarily reverting the seam (so the ablation is
no-op) causes AB-DELIVERY-01 to fail with
`hasOwnProperty("delivery") = true` (expected: false). This confirms
AB-DELIVERY-01 is load-bearing.

### AB-DELIVERY-02 (conservation)

With the ablation env var explicitly deleted inside the test
(production path):

```typescript
delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
// ...
expect(call?.delivery).toBe("queue");
expect(call?.jobId).toBe("job-1");
```

Confirms the production path is preserved exactly when the env var
is unset.

### Expected RED on CCARD-WIRE-01 (existing test)

The existing `CCARD-WIRE-01` test pins `sendCalls[0]?.delivery === "queue"`.
Under ablation this fails — proving the ablation is observing the same
field-removal that CCARD-WIRE-01 was originally protecting.

## Gates

| Gate | Result |
|------|--------|
| pending-prompt-service.test.ts (production mode) | 12/12 PASS |
| pending-prompt-service.test.ts (ablation mode) | 11/12 PASS + 1 expected RED (CCARD-WIRE-01) |
| sdk/core typecheck | 67 pre-existing errors in unrelated files; 0 new errors in touched files |
| apps/vscode typecheck | exit 0, empty output (clean) |
| git diff --check | empty (clean) |

## Live specimen

The live specimen is **READY_FOR_OPERATOR_RUN** but was not performed
in this session (this dev environment lacks VSCodium, the isolated
user-data dir, and the ClineMM Nix wrapper required for the same
operator launch path used for the historical BAD=99006fbcc
reproduction).

See `.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/05-live-ablation.md`
for the complete execution contract.

## Verdict (this session)

**DISCRIMINATORS_INSTALLED_LIVE_SPECIMEN_READY_FOR_OPERATOR**

The code-level discriminators are complete and load-bearing. The
ablation seam is wired. The live specimen must be run by a human
operator to convert the code-level proof into a production-OOM
necessity proof.

## If H1 is proven (after operator runs live specimen)

Do NOT fold the repair into this ACT. Close with
**PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM** and open a separate
bounded repair ACT whose first job is to determine WHY propagating
`delivery` back through the drain boundary re-enters or changes
queue/steer semantics. The repair must preserve whatever correlation
CCARD actually needs without reintroducing the causal semantic cycle.

## If H1 is refuted (after operator runs live specimen)

Do NOT immediately modify another semantic field. Close this ACT
with **PASS_DELIVERY_PROPAGATION_REFUTED**. The next discriminator
becomes CCARD diagnostic activation as a whole — specifically,
compare current semantics with all C1..C10 capture callbacks
disabled while preserving the underlying 99006fbcc queue/jobId/delivery
semantics.

## Artifacts

```
.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/
├── 01-entry-state.md
├── 02-single-commit-boundary.txt
├── 03-ablation-diff.txt
├── 04-focused-gates.txt
├── 04a-focused-gates-production-mode-full.txt
├── 04b-focused-gates-ablation-mode-full.txt
├── 04c-sdk-core-typecheck.txt
├── 04d-apps-vscode-typecheck.txt
├── 04e-git-diff-check.txt
├── 05-live-ablation.md
└── result.json
```

---

# CORRECTION01 — Bundle Built, Positive Attestation Wired

## What changed in CORRECTION01

1. **SUBJECT_HEAD checkpoint:** the ablation-seam commit plus a
   thin `apps/vscode/esbuild.mjs` change to wire the
   `CLINEMM_OOM_DISC01_SUBJECT_HEAD` build-time define were
   committed together, then a single dogfood VSIX was built from
   that SUBJECT_HEAD.

   | Field           | Value                                                                                |
   |-----------------|--------------------------------------------------------------------------------------|
   | SUBJECT_HEAD    | `2edd6249855b4413b3a45da3717176958dbcf31c`                                            |
   | Version         | `4.1.16`                                                                              |
   | VSIX path       | `dist/dogfood/clinemm-4.1.16-2edd62498.vsix`                                          |
   | VSIX size       | `14627848` bytes (~13.95 MB)                                                          |
   | VSIX sha256     | `fa7e3ae6eb36a779c345f0a55f88e3cc60c74c06b628483ce203b110ccb24bdd`                   |

2. **Identical VSIX bytes for both specimens:** the ABLATED and
   RESTORED specimens use IDENTICAL VSIX bytes. The ablation is
   toggled entirely by the env var
   `CLINEMM_OOM_DISC01_ABLATE_DELIVERY` at launch time. No rebuild
   between specimens.

3. **Positive Extension Host attestation (AB-ATTEST-01):** the
   constructor of `PendingPromptsController` now emits ONE line on
   `process.stderr` with the exact prefix
   `[CLINEMM_OOM_DISC01_ATTEST]` and key/value fields
   `subject=... ablation_active=... env_present=... eh_pid=...
   ppid=... constructed_at=...`, bound to `process.pid`. Three
   AB-ATTEST-01 tests verify the structural shape in production and
   ablation modes.

4. **Bundle identity verified:** the bundled `extension.js` contains
   the runtime lookup `process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY`,
   the esbuild-inlined `globalThis.CLINEMM_OOM_DISC01_SUBJECT_HEAD`,
   and the `[CLINEMM_OOM_DISC01_ATTEST]` line marker. Verified by
   `grep -o` on extracted `extension.js`.

5. **Vitest exit codes captured:** production mode → 0
   (15/15 PASS); ablation mode → 1 (14/15 + 1 expected RED on
   CCARD-WIRE-01). The vitest-pool worker-termination `EPERM`
   observed in this dev environment is a sandbox-specific
   worker-shutdown quirk; the suite exit code matches the assertion
   result, NOT the EPERM. Separately characterized in
   `04-focused-gates.txt`.

6. **No additional queue/steer semantics altered:** the only
   production-code change is the conditional spread of `next.delivery`
   at the `PendingPromptsController.drain` boundary, plus the
   constructor attestation emission. All other forwarding (jobId,
   onBeforeDispatch, C4/C5/C6/C7 hooks) is preserved.

## Historical pitfall fixed

`declare const CLINEMM_OOM_DISC01_SUBJECT_HEAD` is a TypeScript-only
construct; at runtime the identifier is `undefined` unless esbuild
`--define:CLINEMM_OOM_DISC01_SUBJECT_HEAD='...'` was applied. A direct
reference throws `ReferenceError: ... is not defined`, which
`try { ... } catch {}` silently swallowed, making the AB-ATTEST-01
test fail mysteriously with `n_calls=0` even though
`vi.spyOn(process.stderr, "write")` was correctly set up. The lookup
now goes through
`(globalThis as { CLINEMM_OOM_DISC01_SUBJECT_HEAD?: string }).CLINEMM_OOM_DISC01_SUBJECT_HEAD`
so the absence is observable as the literal token `<runtime-unset>`
rather than a silent swallowed error. The same lesson is documented
in the test file's `describe` block for AB-ATTEST-01.

## Verdict (CORRECTION01)

**PASS_DISCRIMINATORS_INSTALLED_BUNDLE_BUILT_LIVE_SPECIMEN_READY**

The bundle is built, the attestation is wired, and the live
specimen is ready to run. The same VSIX bytes are used for ABLATED
and RESTORED; only the env var at launch differs.

**Repair authorized:** FALSE

The closure of this ACT remains: operator runs the live specimen
and applies one of the three downstream verdicts
(`PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM`,
`PASS_DELIVERY_PROPAGATION_REFUTED`, or `NOT_REPRODUCED`).

## Artifacts (CORRECTION01)

```
.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/
├── 01-entry-state.md
├── 02-single-commit-boundary.txt
├── 03-ablation-diff.txt
├── 04-focused-gates.txt
├── 04a-focused-gates-production-mode-full.txt
├── 04b-focused-gates-ablation-mode-full.txt
├── 04c-sdk-core-typecheck.txt
├── 04d-apps-vscode-typecheck.txt
├── 04e-git-diff-check.txt
├── 05-live-ablation.md
├── 06-bundle-identity.txt    # CORRECTION01: bundled VSIX sha256 + identity
└── result.json               # CORRECTION01: subject_head + positive_attestation + bundled_vsix + halt_conditions
```

Build artifact (NOT in .factory, lives in dist/dogfood/):

```
dist/dogfood/clinemm-4.1.16-2edd62498.vsix
  ├── SUBJECT_HEAD: 2edd62498
  ├── Version:     4.1.16
  ├── Size:        14627848 bytes
  ├── sha256:      fa7e3ae6eb36a779c345f0a55f88e3cc60c74c06b628483ce203b110ccb24bdd
  └── Verified to contain: CLINEMM_OOM_DISC01_ABLATE_DELIVERY (runtime lookup)
                           CLINEMM_OOM_DISC01_SUBJECT_HEAD (esbuild define)
                           CLINEMM_OOM_DISC01_ATTEST (line marker)
```
