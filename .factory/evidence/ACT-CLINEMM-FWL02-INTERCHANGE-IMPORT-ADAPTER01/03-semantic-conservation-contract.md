# 03 — Semantic conservation contract

The brief's requirement list maps onto two mechanisms: the **strict validator** (which
refuses an import whose records are not fully valid) and the **persisted conservation
checks** (which re-read what was written and prove nothing was lost or promoted).

## 3.1 Strict validation — `validate.ts`

Severity is three-valued. `ERROR` blocks the import. `WARNING` does not block it, but is
surfaced in the receipt and in the CLI output — an import that silently dropped 36
deferred-vs-unknown distinctions is exactly the failure this ACT exists to prevent.
`INFO` is recorded.

| Code | What it refuses |
|---|---|
| `MANIFEST_REPOSITORY_MISSING` / `MANIFEST_SOURCE_HEAD_INVALID` / `MANIFEST_FILES_MISSING` | a manifest that does not identify what was read |
| `MANIFEST_SHA256_INVALID` / `MANIFEST_GIT_BLOB_INVALID` / `MANIFEST_BYTES_INVALID` / `MANIFEST_LINES_INVALID` / `MANIFEST_DISPOSITION_MISSING` | a file with no verifiable identity or disposition |
| `MANIFEST_DUPLICATE_PATH` | the same path inventoried twice |
| `EPIC_ID_DUPLICATE` / `EPIC_ID_MISSING` | a non-unique epic identity |
| `EPIC_LIFECYCLE_INVALID` / `ITEM_LIFECYCLE_INVALID` | **an unsupported or ambiguous authoritative state transition** |
| `ITEM_TITLE_MISSING` / `ITEM_DESCRIPTION_EMPTY` | an obligation nobody could act on — the E8/E9 defect the migration was asked to fix |
| `ITEM_QUALIFICATION_INVALID` | a qualification outside the FWMI vocabulary |
| `ITEM_CRITERIA_COVERAGE_INVALID` / `ITEM_DEPENDENCY_COVERAGE_INVALID` | a coverage value that cannot express "not recovered" |
| `ITEM_DEPENDENCIES_INVALID` / `ITEM_BLOCKERS_INVALID` / `ITEM_RELATED_ACTS_INVALID` / `ITEM_EVIDENCE_LOCATORS_INVALID` / `ITEM_REOPEN_CONDITIONS_INVALID` | a malformed collection |
| `SOURCE_REFS_INVALID` / `SOURCE_REF_PATH_MISSING` / `SOURCE_REF_START_LINE_INVALID` / `SOURCE_REF_END_LINE_INVALID` / `SOURCE_REF_RANGE_INVERTED` / `SOURCE_REF_SHA256_INVALID` | a provenance binding that cannot be honoured |
| `DEPENDENCY_UNRESOLVED` | **an edge that would be silently dropped on import** |
| `RELATIONSHIP_TARGET_UNRESOLVED` | a relationship whose target resolves to nothing |
| `HISTORICAL_ACT_ID_DUPLICATE` / `HISTORICAL_RECONCILIATION_INVALID` | a broken historical index |
| `RECONCILIATION_KIND_MISSING` / `RECONCILIATION_IDENTITIES_MISSING` / `RECONCILIATION_RESOLUTION_INVALID` / `RECONCILIATION_REASON_MISSING` | an unaccounted ambiguity |
| `PRODUCER_RECEIPT_FAIL` / `PRODUCER_HALT_REPOSITORY_TRUST` | a package the producer itself says is not good |
| `FRONTIER_EMPTY` | an empty frontier view |

Two load-bearing distinctions are carried as WARNINGs rather than silently normalised:

- `DEPENDENCY_SET_EMPTY_UNKNOWN` — an empty dependency list with `UNKNOWN` coverage means
  "dependencies were not recovered", NOT "there are none". The `COMPLETE` counterpart
  (`DEPENDENCY_SET_EMPTY_COMPLETE`) is an INFO, because the source then asserted there
  are none.
- `CRITERIA_SET_EMPTY_UNKNOWN` — the same distinction for acceptance criteria.

## 3.2 Persisted conservation — `conserve.ts`

The plan is an intent; this checks the persisted result. It is deliberately NOT a byte
comparison: byte equality proves determinism, not meaning.

| Check | Requirement |
|---|---|
| **C1** | Every scoped identity is present and its source identity (`source_epic_id`, `source_item_id`, `scoped_id`) is intact. |
| **C2** | Every source reference survived, byte for byte — count and content. |
| **C3** | An unknown source status (`original_status: null`) did not become a status, and the lifecycle did not become `DEFERRED`. `DEFERRED` asserts an intentional postponement the source never made. |
| **C4** | An `UNRESOLVED` obligation stayed `UNRESOLVED`; an `AMBIGUOUS`/`CONFLICTING`/`UNRESOLVED` historical record stayed flagged unresolved. |
| **C5** | Every explicit dependency, acceptance criterion, blocker and reopen condition survived, **and** the coverage fields survived with them. |
| **C6** | Every historical ACT is findable in the persisted archive index with its original verdict, its evidence locators and its source references. |
| **C7** | `acceptance.state` is `NOT_VERIFIED_BY_IMPORT`; the source qualification is unchanged; the persisted verdict equals the original qualification. |
| **C8** | Every cross-link survived with its kind and target; the `carries_obligation` flag is true only for `DEPENDS_ON`; a non-`DEPENDS_ON` edge never carries an obligation. |
| **C9** | The interchange reconciliation state is carried onto the record, and no record asserts an acceptance the import never performed. |

## 3.3 The two invariants, structurally

**An imported qualification assertion is not newly verified evidence.** The persisted
type is:

```ts
readonly acceptance: {
  readonly state: "NOT_VERIFIED_BY_IMPORT";
  readonly source_qualification: string;
  readonly interchange_reconciliation_state: string | null;
  readonly note: string;
};
```

`"NOT_VERIFIED_BY_IMPORT"` is the only value the type admits. A record asserting
`ACCEPTED` is not representable in this adapter's output; the C7 check additionally
inspects a record written by some other tool.

**`SOURCE_RECONCILIATION_READY` is not cutover approval.** It is carried as
`interchange_reconciliation_state` — a fact about the producer's reconciliation, not
about the imported record's authority. The CLI prints
`reconciliationReady=true (a reconciliation state, NOT cutover approval)`.

## 3.4 Cross-links versus obligations

A cross-link is a CONSERVATION EDGE: it lets a reader find the related record. It never
carries the related record's obligation. Only `DEPENDS_ON` establishes local execution
prerequisite authority, and even then only as "this record waits on that record" — the
target keeps the sole authority over its own criteria, status and evidence.

The legacy adapter's behaviour on the two `TEMP-INTERNAL-CONTROL-CLEANUP` records was to
QUARANTINE them. The adapter instead preserves the ambiguity: the reconciliation record
stays `UNRESOLVED`, no obligation is created for either identity, and the ambiguity stays
visible in `reconciliation.json` and in the validator's report.

## 3.5 Legacy Markdown path — reconnaissance only

The legacy Markdown migration is retained as read-only reconnaissance
(`tools/factory/fwmi/recon.ts`). It measures the structural surface of the real source
and reports the semantic classes the legacy path cannot carry. It does NOT parse
Markdown for meaning, and it is NOT the import path.

Measured against the real repository at entry:

```text
board lines=44731 bytes=3571144
epic files=22 epic lines=9447
sections=1564 work-item representations=2134
extracted ACT identities=2498
```

The FWL02-A baseline recorded 211 extracted sections and 61 work-item representations
from the Leamas Markdown adapter; the reconnaissance tool's counts are its own
structural rules, not a claim of equivalence. What the two share is the finding that
matters: **the legacy path persisted 0 acceptance criteria, 0 dependency relationships, 0
evidence references and 0 blockers, and represented 36 items with an absent source status
as deferred.**
