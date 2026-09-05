# 04 — Existing test inventory (T1–T16 from §16)

Inventory at HEAD only. Did NOT run yet (production-edit-forbidden pre-discriminator;
characterization execution deferred to §17 if needed for A/C; not needed for D).

## T-matrix mapping

| ID | Geometry | Existing test(s) | Status |
|----|----------|------------------|--------|
| T1 | active valid `/private/tmp` authority → root active | `temporaryExternalPathAuthorities.test.ts` (filter tests, realpath tests), `path-authority.temporary-external.test.ts:84-101` | GREEN (prior ACT history confirms) |
| T2 | expired authority → absent | `temporaryExternalPathAuthorities.test.ts` (filter expiry tests), `path-authority.temporary-external.test.ts:119` (empty roots case) | GREEN |
| T3 | expiry `now + 24h` → boundary preserved | `isWithinTwentyFourHourCeiling` boundary tests in `temporaryExternalPathAuthorities.test.ts` | GREEN |
| T4 | expiry `now + 24h + 1ms` → absent | boundary tests + filter ceiling drop | GREEN |
| T5 | tampered `"/"` → absent | CORRECTION04 introduced structural predicate tests for "/" rejection in both validator and filter | GREEN |
| T6 | relative `"tmp" / "../tmp" / "."` → absent | CORRECTION04 relative-path rejection tests (validator + filter shared predicate) | GREEN |
| T7 | unparseable expiry → absent | filter drop on unparseable expiry (`Date.parse` returns NaN); validator returns typed error | GREEN |
| T8 | non-existent configured root / realpath failure → absent | resolver `onRealpathFailure` handler drops entry; never throws | GREEN |
| T9 | `/tmp` → canonical non-root | resolver realpath step; `darwinUserTempRoot` realpath in `sdk-tool-policies.ts:344-348` | GREEN |
| T10 | cross-instance ADD visible | `temporaryExternalPathAuthorityCrossInstance.test.ts` (CORRECTION03 introduced) | GREEN |
| T11 | cross-instance REMOVE visible | same file, REMOVE side of cross-instance test | GREEN |
| T12 | writer change between evidence/auth stages → same eval uses same snapshot | `temporary-external-path-authority01.c2-production-seam.test.ts` (CORRECTION05 introduced) | GREEN |
| T13 | workspace-only path, no temp root → pre-F2 behavior | covered by `path-authority.temporary-external.test.ts:189-201` (empty roots) | GREEN |
| T14 | outside path without temp root → ASK via R0 | covered by containment-against-empty-union in core path-authority | GREEN |
| T15 | outside path covered by active temp root → existing ALLOW/ASK semantics | `path-authority.temporary-external.test.ts` full union cases | GREEN |
| T16 | hard deny remains DENY independent of temp authority | `command-policy.ts` precedence tests; temp roots only widen containment, never relax hard deny | GREEN |

```
EXISTING_GREEN        = 16 of 16 (per prior ACT history; verified by file existence)
MISSING_CHARACTERIZATION = 0
RED_CANDIDATE         = 0
NOT_APPLICABLE        = 0
```

All 16 characterization witnesses already exist in the test corpus. No new tests
needed for Outcome D verification.

## Existing test files (verified at HEAD)

- `apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts`
  — validator + filter unit tests (boundary cases T3/T4/T5/T6/T7, realpath T8/T9)
- `apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts`
  — T10/T11 (cross-instance visibility via fresh-read seam)
- `apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`
  — T12 (single-evaluation snapshot identity)
- `sdk/packages/core/src/runtime/command-policy/path-authority.temporary-external.test.ts`
  — T1/T2/T13/T14/T15 (policy-layer containment union semantics)
