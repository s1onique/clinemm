# 04 — Existing test inventory (T1–T16 from §16)

Inventory at HEAD only. Did NOT run yet (production-edit-forbidden pre-discriminator;
characterization execution deferred to §17 if needed for A/C; not needed for D).

## T-matrix mapping

The four status columns distinguish:

```text
INHERITED_EXECUTED_GREEN
  = test exists AND has a documented prior GREEN execution in a predecessor
    ACT closure (CORRECTION01–05 / F0 / F1 evidence); execution not
    re-verified by THIS ACT

NOT_EXECUTED_IN_THIS_ACT
  = test not run during the F2 recon-only cycle (per §17 RED authorization:
    Outcome D does not require RED, so the existing suite is not re-run)

SOURCE_MAPPING_VERIFIED
  = test file exists at HEAD and references the exact seam F2 recon analyzed

TOTAL_T_WITNESSES
  = source-mapping verified (16/16)
```

| ID | Geometry | Existing test(s) | File exists | Inherited prior GREEN | Run in F2 |
|----|----------|------------------|:------------:|:---------------------:|:---------:|
| T1 | active valid `/private/tmp` authority → root active | `temporaryExternalPathAuthorities.test.ts` (filter tests, realpath tests), `path-authority.temporary-external.test.ts:84-101` | YES | INHERITED_EXECUTED_GREEN (predecessor CORRECTION02 closure) | NO |
| T2 | expired authority → absent | `temporaryExternalPathAuthorities.test.ts` (filter expiry tests), `path-authority.temporary-external.test.ts:119` | YES | INHERITED_EXECUTED_GREEN | NO |
| T3 | expiry `now + 24h` → boundary preserved | `isWithinTwentyFourHourCeiling` boundary tests in `temporaryExternalPathAuthorities.test.ts` | YES | INHERITED_EXECUTED_GREEN (CORRECTION01) | NO |
| T4 | expiry `now + 24h + 1ms` → absent | boundary tests + filter ceiling drop | YES | INHERITED_EXECUTED_GREEN (CORRECTION01) | NO |
| T5 | tampered `"/"` → absent | CORRECTION04 introduced structural predicate tests for "/" rejection in both validator and filter | YES | INHERITED_EXECUTED_GREEN (CORRECTION04) | NO |
| T6 | relative `"tmp" / "../tmp" / "."` → absent | CORRECTION04 relative-path rejection tests (validator + filter shared predicate) | YES | INHERITED_EXECUTED_GREEN (CORRECTION04) | NO |
| T7 | unparseable expiry → absent | filter drop on unparseable expiry (`Date.parse` returns NaN); validator returns typed error | YES | INHERITED_EXECUTED_GREEN | NO |
| T8 | non-existent configured root / realpath failure → absent | resolver `onRealpathFailure` handler drops entry; never throws | YES | INHERITED_EXECUTED_GREEN | NO |
| T9 | `/tmp` → canonical non-root | resolver realpath step; `darwinUserTempRoot` realpath in `sdk-tool-policies.ts:344-348` | YES | INHERITED_EXECUTED_GREEN | NO |
| T10 | cross-instance ADD visible | `temporaryExternalPathAuthorityCrossInstance.test.ts` (CORRECTION03 introduced) | YES | INHERITED_EXECUTED_GREEN (CORRECTION03) | NO |
| T11 | cross-instance REMOVE visible | same file, REMOVE side of cross-instance test | YES | INHERITED_EXECUTED_GREEN (CORRECTION03) | NO |
| T12 | writer change between evidence/auth stages → same eval uses same snapshot | `temporary-external-path-authority01.c2-production-seam.test.ts` (CORRECTION05 introduced) | YES | INHERITED_EXECUTED_GREEN (CORRECTION05) | NO |
| T13 | workspace-only path, no temp root → pre-F2 behavior | covered by `path-authority.temporary-external.test.ts:189-201` (empty roots) | YES | INHERITED_EXECUTED_GREEN | NO |
| T14 | outside path without temp root → ASK via R0 | covered by containment-against-empty-union in core path-authority | YES | INHERITED_EXECUTED_GREEN | NO |
| T15 | outside path covered by active temp root → existing ALLOW/ASK semantics | `path-authority.temporary-external.test.ts` full union cases | YES | INHERITED_EXECUTED_GREEN | NO |
| T16 | hard deny remains DENY independent of temp authority | `command-policy.ts` precedence tests; temp roots only widen containment, never relax hard deny | YES | INHERITED_EXECUTED_GREEN | NO |

```
EXISTING_WITNESS          = 16/16 (file-existence verified at HEAD)
SOURCE_MAPPING_VERIFIED   = 16/16
INHERITED_EXECUTED_GREEN  = 16/16 (per predecessor CORRECTION01–05 / F0 / F1 closures)
EXECUTED_IN_THIS_ACT      = 0/16  (recon-only; Outcome D does not require re-run per §17)
MISSING_CHARACTERIZATION  = 0
RED_CANDIDATE             = 0
NOT_APPLICABLE            = 0
```

Honest summary per eighty-second-pass review: F2 recon established that the
production seam shape is correct, and that all 16 characterization witnesses
have source-mapping verified at HEAD with inherited prior GREEN history from
the CORRECTION01–05 closure chain. F2 itself did not re-execute the suites
because §17 explicitly says RED becomes authorized only if recon chooses
Outcome A or C and identifies an actual behavioral or structural invariant
that the current implementation violates. Outcome D satisfies neither
condition, so re-execution is not warranted.

"File exists" alone does NOT prove "test passes"; the GREEN status here is
inherited from documented predecessor ACT closures, not re-verified by F2.

## Existing test files (verified at HEAD)

- `apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts`
  — validator + filter unit tests (boundary cases T3/T4/T5/T6/T7, realpath T8/T9)
- `apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts`
  — T10/T11 (cross-instance visibility via fresh-read seam)
- `apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`
  — T12 (single-evaluation snapshot identity)
- `sdk/packages/core/src/runtime/command-policy/path-authority.temporary-external.test.ts`
  — T1/T2/T13/T14/T15 (policy-layer containment union semantics)
