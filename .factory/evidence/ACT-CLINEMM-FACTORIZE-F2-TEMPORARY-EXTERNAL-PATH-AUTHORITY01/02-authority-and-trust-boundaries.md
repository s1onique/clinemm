# 02 — Effective-authority read ownership + Trust boundaries

## §9 RECON Q2 — Effective-authority read ownership

### Command-evaluation chain at HEAD (verified from source)

```
command approval evaluation starts
  (apps/vscode/src/sdk/SdkController.ts:1069)
    ↓
const activeTempRoots = this.resolveActiveTemporaryExternalCanonicalRoots()
  (line 1069, ONE private method, returns string[])
    ↓
resolveActiveTemporaryExternalCanonicalRoots() (line 2449-2463)
    ↓
backingFilePath = stateManager.getStorageDataDir() + "/globalState.json"
    ↓
resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({backingFilePath, onRealpathFailure})
  (apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts:458)
    ↓
resolveActiveTemporaryExternalCanonicalRootsFromBackingFileImpl(...) (line 464-516)
    │
    ├── readFileSync(backingFilePath, "utf-8")        ← fresh read #1 of this eval
    ├── JSON.parse(raw).clinemmTemporaryExternalPathAuthorities
    ├── filterActiveTemporaryExternalPathEntries(persisted, now)
    │     (same file:354-388, defense-in-depth runtime filter)
    │       ├── classifyTemporaryExternalPathShape(path)  (shared predicate)
    │       ├── Date.parse(entry.expiresAt)
    │       ├── now >= expiryMs → drop
    │       └── expiryMs > ceilingMs → drop
    └── for each surviving entry:
          resolvedRealpath(entry.path)  ← canonicalize
          catch onRealpathFailure → drop
    → return string[] (canonical active temp roots)
    ↓
// SAME snapshot, threaded into evidence + auth (one snapshot, one generation)
const pathAuthorityEvidence = await this.buildPathAuthorityEvidence(
    requestInput,
    activeTempRoots,                                    ← SNAPSHOT PASSED
)
  (SdkController.ts:1071-1115)
  ├── core: buildPathAuthorityEvidence({...,temporaryExternalCanonicalRoots: activeTempRoots})
  │     (sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts:348)
  └── returns evidence record with embedded snapshot
    ↓
let hostAuthorization = getCommandHostAuthorization(
    _toolName, persisted, this.mcpHub,
    {
        workspaceRoots: canonicalRoots,
        cwd: canonicalCwd,
        pathAuthorityEvidence,
        temporaryExternalCanonicalRoots: activeTempRoots,    ← SAME SNAPSHOT, no second read
    },
    requestInput,
)
  (SdkController.ts:1117-1127)
    ↓
core command-policy evaluation:
  - evidence.temporaryExternalCanonicalRoots embedded by builder
  - auth.temporaryExternalCanonicalRoots carried in auth
  - policy re-test (auth.workspaceRoots === evidence.roots) compares identity
  - containment union = [...evidence.roots, ...evidence.temporaryExternalCanonicalRoots]
    (path-authority.ts:679-684)
```

### Frozen

```
DURABLE_READ_COUNT_PER_EVALUATION     = 1
ACTIVE_ROOT_RESOLUTION_IMPLEMENTATIONS = 1
ONE_SNAPSHOT_SHARED_BY_EVIDENCE_AND_AUTH = YES
FRESH_READ_AT_DECISION_BOUNDARY        = YES
CROSS_REQUEST_EFFECTIVE_ROOT_CACHE     = NO
```

The original F0 "multiple producers → centralize to one writer" hypothesis is
**largely falsified by current HEAD**:

- ONE write validator (`validateTemporaryExternalPathAuthorities`) used by two callers
  (UI + CLI) — that's CALLER duplication, not semantic-owner duplication.
- ONE resolver (`resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`) used
  by ONE host bridge method (`SdkController.resolveActiveTemporaryExternalCanonicalRoots`).
- ONE fresh read per evaluation, read directly from disk at the decision boundary.
- ONE snapshot threaded into evidence AND auth (CORRECTION05), eliminating
  generation-mixing during a single evaluation.

---

## §11 RECON Q4 — Trust boundaries matrix

Verified boundary locations per invariant. For each invariant, where MUST it exist?
Each repeated rule examined for defense-in-depth vs duplication classification.

| Invariant | Write boundary | Durable-read boundary | Host→core boundary | Core policy | Classification |
|-----------|---------------:|----------------------:|-------------------:|------------:|----------------|
| path is string/non-empty | `validateEntry` (validator:181-188) | `filterActiveTemporaryExternalPathEntries` (filter:368) | (no value crosses as raw path string; snapshot already canonical) | n/a | DEFENSE_IN_DEPTH — filter re-checks shape at consumption even if write validator was bypassed by tampered/old client |
| absolute (`isAbsolute`) | `classifyTemporaryExternalPathShape` (validator:118) | `classifyTemporaryExternalPathShape` (filter:370, shared predicate) | n/a | n/a | DEFENSE_IN_DEPTH — shared structural predicate; one source, two call sites by design |
| filesystem root forbidden | `classifyTemporaryExternalPathShape` (validator:120, `isFilesystemRoot`) | `classifyTemporaryExternalPathShape` (filter:370, shared) | n/a | n/a | DEFENSE_IN_DEPTH — shared predicate; CORRECTION04 explicitly unified |
| expiry parseable | `validateEntry` (validator:245-251) | `filterActive` (filter:374-375) | n/a | n/a | DEFENSE_IN_DEPTH — runtime must not crash on tampered persisted state |
| not expired (`now >= expiresAt`) | `validateEntry` (validator:253-258) | `filterActive` (filter:377) | n/a | n/a | DEFENSE_IN_DEPTH — fresh `now` at consumption is canonical truth |
| ≤ 24h from `now` | `validateEntry` (validator:259-265) AND `isWithinTwentyFourHourCeiling` (validator:317-323) | `filterActive` (filter:379-380) | n/a | n/a | DEFENSE_IN_DEPTH — runtime backstop for tampered persisted state with >24h expiry that bypassed write-time validator |
| realpath canonical | n/a (validator is pure, no `node:fs` import) | `resolvedRealpath` in resolver (line 504) | n/a | n/a (core receives already-canonical paths) | CORE PATH AUTHORITY — only one place; defense-in-depth lives in core path-authority too |
| contained target | n/a | evidence builder embeds snapshot | auth carries snapshot | `path-authority.ts:679-684` containment union (test against evidence.roots ∪ snapshot) | CORE PATH AUTHORITY — core re-tests containment (defense-in-depth) against its OWN realpath-resolved operands |

### Repeated-checks classification

```
TRUE_SEMANTIC_DUPLICATION =
  NONE

STRUCTURAL_DUPLICATION =
  ClassifySharedPathShapePredicate — ONE shared predicate
  (classifyTemporaryExternalPathShape), called from both validator
  and filter. NOT duplication: intentional shared source of truth.

TRANSPORT_REPETITION =
  activeTempRoots snapshot threaded through three typed boundaries:
    (a) SdkController local (string[])
    (b) pathAuthorityEvidence.temporaryExternalCanonicalRoots (readonly string[])
    (c) CommandHostAuthorization.temporaryExternalCanonicalRoots (readonly string[])
  Three transports of the SAME immutable snapshot, by design (CORRECTION05).
  Removing one breaks generation consistency between evidence and auth.

NECESSARY_DEFENSE_IN_DEPTH =
  - path shape (CORRECTION04 unified predicate — write + runtime)
  - 24h ceiling (validator + runtime backstop — must hold against
    tampered persisted state from old clients / manual edits)
  - expiry parseable (runtime filter drops bad entries without throwing)
  - containment re-test in core path-authority (defense-in-depth on
    realpath-resolved operands)
```

Each repeated check was put in place deliberately by CORRECTION01–05; removing
ANY of them allows tampered or stale state to widen R0 authority. They are
**defense-in-depth, not duplication**, by the §11 definition.
