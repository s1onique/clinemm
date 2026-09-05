# 03 — Discriminator (frozen at HEAD per §13, §14)

## §12 RECON Q5 — Fresh-read and generation identity

### A — ADD visibility (verified by `temporaryExternalPathAuthorityCrossInstance.test.ts`)

Instance A keeps its StateManager cache stale from startup. External writer B
adds authority X directly to `~/.cline/data/globalState.json`. A performs next
command-policy evaluation.

Current source path:

```text
SdkController.resolveHostAuthorization
  → this.resolveActiveTemporaryExternalCanonicalRoots()   // SdkController.ts:1069
  → resolveActiveTemporaryExternalCanonicalRootsFromBackingFile  // bypasses cache
  → readFileSync(globalState.json)                          // fresh read
  → filter + realpath
  → returns active snapshot including X
  → threaded into evidence + auth
```

StateManager cache is **not consulted**. Cross-instance ADD visible on next
evaluation without process restart.

### B — REMOVE visibility (verified by same test, REMOVE side)

Instance A has stale cache containing X. External writer B removes X directly
from disk. A performs next command-policy evaluation. The next read of the
backing JSON file does NOT contain X; resolver returns no X; evaluation sees
removal.

REMOVE is guaranteed by the same fresh-read seam. No chronology-based heuristic
needed.

### C — Snapshot identity (verified by `temporary-external-path-authority01.c2-production-seam.test.ts`)

`activeTempRoots` is read once into a local at line 1069 and threaded by the
same reference into both:
- `buildPathAuthorityEvidence(requestInput, activeTempRoots)` — evidence builder
  embeds it at `path-authority-evidence-builder.ts:479`
- `getCommandHostAuthorization(..., {temporaryExternalCanonicalRoots: activeTempRoots}, ...)` —
  auth factory stores it at `command-policy-types.ts:576`

External writer removing authority while evaluation is in flight cannot change
this snapshot reference (it's a local `string[]` in `resolveHostAuthorization`).
NEXT evaluation will see removal.

### Frozen

```
CROSS_INSTANCE_ADD             = CURRENTLY_SATISFIED
CROSS_INSTANCE_REMOVE          = CURRENTLY_SATISFIED
SINGLE_EVALUATION_SNAPSHOT     = CURRENTLY_SATISFIED
CURRENT_ARCHITECTURE_USES_EVENTUAL_CACHE_SYNC = NO
```

## §13 RECON Q6 — Seven discriminators

| Discriminator | Answer | Mechanical basis |
|---------------|:------:|------------------|
| SINGLE_SEMANTIC_OWNER | **YES** | One JSON key `clinemmTemporaryExternalPathAuthorities` in one backing file, declared once in `state-keys.ts:327` |
| MULTIPLE_VALUE_PRODUCERS | **NO** | One resolver: `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile` (the only consumer of the durable value at the decision boundary). UI also reads raw via `readTemporaryExternalPathAuthoritiesRawFromBackingFile` for display, but that is **display**, not derivation of the effective active canonical-root set |
| MULTIPLE_MUTATION_AUTHORITIES | **NO** | One validator (`validateTemporaryExternalPathAuthorities`) used by both write paths. Two callers (UI + CLI) but ONE set of mutation rules. The validator IS the mutation-authority; callers transport only |
| FRESH_READ_REQUIRED | **YES** | Cross-instance ADD/REMOVE requires fresh read at decision boundary (verified Q5) |
| REQUEST_BOUND_LIFETIME | **YES** | `activeTempRoots` is a local `string[]` in `resolveHostAuthorization`, exists only for one evaluation |
| HOST_CORE_DUPLICATION | **NO** | Core path-authority does NOT re-read the backing file, does NOT re-filter. It receives a snapshot via `temporaryExternalCanonicalRoots` parameter (already canonical, already filtered) and uses it only for the containment union. Core re-checking containment against already-canonical roots is defense-in-depth (§11) |
| CURRENT_THREADING_REDUNDANT | **NO** | The same immutable snapshot is threaded through three typed boundaries (SdkController local → evidence → auth) precisely to prevent generation-mixing inside one evaluation (CORRECTION05). Removing any step breaks the single-snapshot invariant |

## Selected outcome

```
SINGLE_SEMANTIC_OWNER         = YES
MULTIPLE_VALUE_PRODUCERS      = NO
MULTIPLE_MUTATION_AUTHORITIES = NO
FRESH_READ_REQUIRED           = YES
REQUEST_BOUND_LIFETIME        = YES
HOST_CORE_DUPLICATION         = NO
CURRENT_THREADING_REDUNDANT   = NO

SELECTED_OUTCOME =
  D
```

### Why Outcome D

Per §15:

> Outcome D — already well-factorized
>
> Use when current architecture already resolves to approximately:
> one durable authority → one authoritative validator → one fresh
> effective-root read → one request snapshot → evidence + authorization
> consumers → core defense-in-depth policy check.

HEAD satisfies ALL six of those properties:

1. ONE durable authority (`clinemmTemporaryExternalPathAuthorities` key).
2. ONE authoritative validator (`validateTemporaryExternalPathAuthorities`).
3. ONE fresh effective-root read (`resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`,
   called once per evaluation).
4. ONE request snapshot (`activeTempRoots` local in `resolveHostAuthorization`).
5. evidence + authorization consumers (each receives the same snapshot reference).
6. Core defense-in-depth policy check (containment re-test in `path-authority.ts:679-684`).

This is exactly the architecture CORRECTION03–05 were converging on. The
historical correction density F0 picked up was real evidence of a multi-step
convergence — but the convergence has landed. F2's frozen question

> "Can active temporary-external canonical-root authority be represented
> through one semantically-correct ownership/read seam while preserving
> [the listed invariants]?"

answers YES at HEAD. The current implementation is already the one
semantically-correct ownership/read seam. CORRECTION03–05 already performed
the useful factorization.

## §26 Stop conditions — none triggered

- Stale retain across evaluations: NO (fresh read per evaluation, verified).
- >24h authority admittance: NO (validator rejects + filter backstop).
- Filesystem root admittance: NO (CORRECTION04 structural predicate).
- Relative authority admittance: NO (CORRECTION04 structural predicate).
- Generation mixing inside one evaluation: NO (one snapshot, threaded by reference).
- Hard-deny bypass: NO (temp roots only widen containment; never relax deny).

No HALT_NEW_P0. PASS_F2_NO_FACTORIZATION_NEEDED.
