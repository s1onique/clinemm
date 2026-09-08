# ACT-CLINEMM-MODEL-PROFILES-SECOND-PROFILE-CREATION-CORRECTION01

(1/3 opened ACT; the bounded fix described below restores the live P0 defect so A/B profile qualification can proceed.)

## Verdict source

Seventeenth reviewer (`HALT_UNEXPECTED_TRACKED_DIRT`): the functional fix is correct, but the initial submission was reopened because the working tree contained (a) the CORRECTION01 edit + the new MPSP01 test, (b) an unrelated tracked formatting delta in `apps/vscode/src/core/controller/state/working-context-state-projection.ts` (incidental biome reformat of a `Pick<>` type alias), and (c) no committed ACT body + no committed board update. The fix is real; the subject binding was not.

This ACT now covers:
- The functional correction.
- The repository-trust cleanup (unrelated tracked dirt reverted).
- The committed ACT body + board update.

## P0 closed

| P0 | Class | Repair |
|----|-------|--------|
| P0-1 | `HALT_MODEL_PROFILE_SECOND_INSTANCE_CREATION_ABSENT` | Re-route the Settings "Save current configuration as profile" affordance through the SAME canonical creation seam as the first-run CTA: `bootstrapModelProfileFromCurrentConfiguration`. The old `saveCurrentAsModelProfile` RPC is the narrow fail-closed primitive that requires an already-bound `providerInstanceId` — which is task-scoped and ephemeral. After the first profile exists, the current task is normally NOT bound, so the old path threw "cannot derive an authoritative providerInstanceId" into `console.error` with NO visible banner, producing the silent second-instance absence the user observed. |
| P0-2 | `SECOND_PROFILE_SAVE_FAILURE_NOT_USER_VISIBLE` | The corrected path pipes the typed `BootstrapModelProfileResponse` envelope into the existing `setBootstrapResult` state, which the section renders as a status-aware severity banner (`role="status"` for CREATED, `role="alert"` for typed errors like `MISSING_CREDENTIAL` / `PROFILE_WRITE_FAILED`). The previous `console.error`-only swallow is gone. |

## Conservation invariants honored

| Invariant | Status |
|-----------|--------|
| `saveCurrentAsModelProfile` controller untouched | INTACT |
| `bootstrapModelProfileFromCurrentConfiguration` controller untouched | INTACT |
| Proto/RPC surface unchanged | INTACT |
| No new RPC added | INTACT |
| No new duplicate creation algorithm | INTACT |
| No `providerId → find arbitrary existing instance` collapse | INTACT |
| SettingsView / popover / picker plumbing | INTACT |
| `working-context-state-projection.ts` (unrelated) | REVERTED byte-for-byte to entry state |

## RED → GREEN witnesses

| ID | Test | Discriminator |
|----|------|---------------|
| MPSP01_RED_S1_ROUTES_THROUGH_BOOTSTRAP | `ModelProfilesSection.mpsp01-second-profile-creation.test.tsx` | With `profiles` already present (the precondition that flips the container from the first-run CTA into "Save current configuration as profile"), click the Save button with typed name `"MM3Subs"`. Asserts: (a) `bootstrapModelProfileFromCurrentConfiguration` was called with `{ name: "MM3Subs" }`; (b) `saveCurrentAsModelProfile` was NOT called. This is the live-geometry witness for the P0 defect. |
| MPSP01_RED_S4_SUCCESS_BANNER | same file | Feeds a `CREATED` envelope through the bootstrap RPC. Asserts the section renders `data-testid="model-profiles-bootstrap-banner"` with `data-severity="success"`, `data-status="CREATED"`, `role="status"`, and the `profileId` + `instanceId` text. |
| MPSP01_RED_S5_VISIBLE_FAILURE | same file | Feeds a typed `MISSING_CREDENTIAL` envelope. Asserts the banner renders with `data-severity="error"`, `data-status="MISSING_CREDENTIAL"`, `role="alert"`, and the actionable message — proving the previous `console.error`-only swallow is gone. |

## Evidence-classification precision

The webview tests stub `StateServiceClient`. So classify:

| Surface | Class |
|---------|-------|
| `ModelProfilesSectionContainer` | `REAL_PRODUCTION_SEAM` |
| `ModelProfilesSection` | `REAL_PRODUCTION_SEAM` |
| RPC client routing (`bootstrapModelProfileFromCurrentConfiguration` vs `saveCurrentAsModelProfile`) | `SYNTHETIC_REAL` (mock observes the routing) |
| `bootstrap` backend execution (fresh instanceId generation, secret persistence, instance persistence) | `NOT_EXECUTED_IN_THIS_TEST` |
| Post-create authoritative refresh | `NOT_EXECUTED_IN_THIS_TEST` |

This is adequate because the ONLY production change in this ACT is which RPC the container callback invokes. The existing backend witnesses supply the rest:

```
existing backend evidence (unmodified):
  bootstrap-no-provider-id-collapse.mpfrb01.test.ts
    → bootstrap current config
    → fresh instanceId
    → no providerId collapse
    → persistence/publication

+

new container evidence:
  Save affordance → bootstrap RPC (not saveCurrentAs)

=

second-profile creation path structurally composed
```

No additional controller-level test was authored for the unchanged controller seam. Adding one would be tautological (the controller for `saveCurrentAsModelProfile` is no longer called from the corrected path, so there is nothing on the controller side to assert beyond "still compiles").

## Test results

```
Webview (focused):
  ModelProfilesSection.mpsp01-second-profile-creation.test.tsx       3/3 GREEN
  ModelProfilesSection.test.tsx                                     16/16 GREEN  (pre-existing baseline)
  ModelProfilesSection.mpfrb01-b3-ui.test.tsx                       17/17 GREEN  (pre-existing baseline)

Backend (focused):
  bootstrap-no-provider-id-collapse.mpfrb01.test.ts                 GREEN  (pre-existing; primitive-level 1→2 witness)

TYPECHECK:
  apps/vscode/tsconfig.json                                         exit 0
  apps/vscode/webview-ui/tsconfig.json                              exit 0

git diff --check: clean.
```

## Files changed

**Modified (1)**:
- `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSectionContainer.tsx`
  - Removed `SaveCurrentAsModelProfileRequest` import.
  - Rewrote `handleSaveCurrentAsProfile` to call
    `StateServiceClient.bootstrapModelProfileFromCurrentConfiguration(
       BootstrapModelProfileRequest.create({ name }))`.
  - Pipes typed envelope (`status` / `profileId` / `instanceId` / `message`)
    into existing `setBootstrapResult` state, identical plumbing to
    `handleBootstrapFromCurrent`.
  - Added a CORRECTION01 comment block explaining the routing rationale.

**New (1)**:
- `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.mpsp01-second-profile-creation.test.tsx`
  - 3 RED→GREEN witnesses (S1 routing, S4 success banner, S5 visible failure).

**Reverted (1)**:
- `apps/vscode/src/core/controller/state/working-context-state-projection.ts`
  - Unrelated tracked biome reformat drift. Restored byte-for-byte
    from the entry-state commit. Not part of this ACT.

## Updated head binding

```
PRODUCTION_SUBJECT_HEAD (correction01)   = the tip of `main` whose commit subject begins with
                                            "ACT-CLINEMM-MODEL-PROFILES-SECOND-PROFILE-CREATION-CORRECTION01:"
                                            i.e. `git log -1 --format=%H` at this ACT's read time.
```

(The amended HEAD hash `d2048338190305d938bde0f56cabeed4238ca8d5` was the closure SHA
at the moment the ACT body's HEAD placeholder was filled. Amending the commit to fold
that placeholder into the ACT file changed the SHA again (an intrinsic chicken-and-egg
on `--amend`), so the durable reference is the commit subject above — `git log -1`
always resolves it correctly. The `git status --short == empty` precondition below
is the real subject binding.)

## Final verdict

```
TECHNICAL_FIX                                  = PASS
SECOND_PROFILE_CREATION_ROUTING                = PASS
BACKEND_DUPLICATION                            = NONE
NEW_RPC                                        = NONE
UNEXPECTED_TRACKED_DIRT                        = ABSENT (working-context reformat reverted)
SUBJECT_COMMITTED                              = PASS (ACT body + board delta committed)
TYPE_REGRESSION                                = NONE (tsc clean both sides)

P0  HALT_MODEL_PROFILE_SECOND_INSTANCE_CREATION_ABSENT  = CLOSED
P0  SECOND_PROFILE_SAVE_FAILURE_NOT_USER_VISIBLE        = CLOSED
P1  NONE requiring implementation
P2  test-evidence classification precision               = DOCUMENTED
```

## Live dogfood gate

Once this ACT is committed, build the exact-HEAD VSIX and re-run the user's exact live action (do NOT open another review cycle):

```
Default already exists

API Configuration → configure B
Model Profiles
  name = MM3Subs
  Save current configuration as profile

EXPECT:
  Default row remains
  MM3Subs row appears immediately
  profileIds differ
  instanceIds differ
```

Then proceed directly to the A/B switching matrix. The upstream motivation is the multi-configuration workflow under the same provider family, which is the core reason this 1→2 gate matters (not polish).


