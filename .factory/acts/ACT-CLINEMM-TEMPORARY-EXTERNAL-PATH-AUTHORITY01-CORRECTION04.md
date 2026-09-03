# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04

> **Status**: **CLOSED / PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V4**
> (P0; closed 2026-09-03). Tampered persisted state of `"/"`
> (filesystem root) or relative paths (`tmp`, `../tmp`, `.`) can
> no longer widen R0 authority beyond the bounded contract. The
> runtime defense-in-depth filter now enforces the same
> structural path-shape contract as the write-time validator.
> CORRECTION03's fresh-read architecture is preserved unchanged.

## §0 — Why this correction

The CORRECTION03 review surfaced one new P0 and one P1:

> **P0 — tampered persisted `"/"` or relative paths bypass
> the write-time path restrictions.** The write validator
> correctly rejects `relative/path`, `../tmp`, `.`, `/`. But
> the runtime defense-in-depth filter
> (`filterActiveTemporaryExternalPathEntries`) only checks
> `typeof`, non-emptiness, valid expiry, and the 24h ceiling.
> It does NOT re-check `isAbsolute(path)` or `path !== "/"`.
> Then the fresh-read pipeline performs `realpath(entry.path)`
> and forwards the result as an authoritative temporary root.
> Therefore manually tampered durable state such as
> `{ "path": "/", "expiresAt": "<now + 1h>" }` becomes
> `realpath("/")` = `"/"` → `effectiveRoots =
> workspaceRoots ∪ ["/"]`, which makes essentially every
> canonical filesystem operand pass the R0 containment test.

> **P1 — cross-instance Settings UI can still be stale.**
> The authority path fresh-reads disk, but
> `getStateToPostToWebview()` still reads the StateManager
> cache. Non-blocking under Factory rule.

The CORRECTION03 architecture is correctly closed at its
declared scope (fresh-read eliminates the watcher; ADD and
REMOVE are visible to other instances without restart). The
new P0 is a SEPARATE concern: the asymmetric runtime filter
allowed tampered-paths widening even after CORRECTION03.

The reviewer's exact recommendation: apply the same
structural path constraints as the write validator
(`isAbsolute` + `!=="/"`) at the runtime consumption filter,
optionally extracted into a small pure predicate used by
both. This CORRECTION04 adopts the recommendation in full:
both the structural checks AND a tiny
`classifyTemporaryExternalPathShape` refactor. CORRECTION03
is not revisited.

## §1 — Decision: shared predicate + both enforcement points

A single pure predicate
`classifyTemporaryExternalPathShape(path)` classifies any
persisted `path` value into one of:

- `"valid"` — absolute, non-root, non-empty string
- `"not-string"` — value is not a string at all
- `"empty"` — empty string
- `"not-absolute"` — relative path (e.g. `tmp`, `../tmp`, `.`)
- `"filesystem-root"` — exactly `/`

Two enforcement points share the SAME predicate:

- **Write-time validator** `validateEntry` — emits typed reasons
  (`"path-not-string"`, `"path-empty"`, `"path-not-absolute"`,
  `"path-filesystem-root-forbidden"`).
- **Runtime filter** `filterActiveTemporaryExternalPathEntries`
  — drops silently (entry never reaches realpath).

The runtime filter's previous behavior was a partial subset of
the validator's check. CORRECTION04 closes the asymmetric gap
without redesign.

## §2 — What was preserved (verbatim from CORRECTION03)

```
✅ fresh-read decision-boundary architecture
✅ two-reader/one-store ADD
✅ stale-removal REMOVE
✅ 24h write ceiling
✅ >24h runtime rejection
✅ absolute-path write validation
✅ "/" write rejection
✅ symlink operand escape
✅ no watcher
```

CORRECTION04 does not touch any of the above. The fresh-read
pipeline still reads the backing JSON file at the policy
decision boundary, runs persisted entries through the runtime
filter, and realpath-canonicalizes the survivors. The only
difference is the filter now also gates on the path-shape
predicate BEFORE realpath.

## §3 — What about the P1?

The P1 (cross-instance Settings UI cache freshness) is
classified NON-BLOCKING per Factory rule. The reviewer's
recommendation is explicit: "I'd defer it unless it becomes
operationally annoying. Do not rebuild cache coherence merely
to fix it; the UI can eventually fresh-read on opening/
refreshing the sandbox settings section." The P1 stays open by
Factory classification but is intentionally not addressed by
this CORRECTION04.

## §4 — Required adversarial tests (all PASS)

### Runtime filter unit tests (NEW in CORRECTION04)

Added to
`apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts`:

- `forwards entries whose path is structurally valid`
- `drops entries with tampered path="/"` (filesystem root)
- `it.each(["tmp", "../tmp", "."])` — drops each relative form
- `drops entries whose path is an empty string`
- `drops entries whose path is not a string at all`
- `preserves entries with valid shape but expiredAt in the past`
  (24h ceiling regression)
- `preserves entries with valid shape but tampered expiresAt > 24h`
  (CORRECTION01 backstop regression)
- `drops only the tampered entry in a mixed array, keeping valid entries`

### Classifier unit tests (NEW in CORRECTION04)

Added a `describe("CORRECTION04: classifyTemporaryExternalPathShape ...)`
block exercising the full classification lattice.

### Cross-instance adversarial matrix (NEW in CORRECTION04)

Added to
`apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts`:

| Tampered/legitimate `path`  | Valid 1h expiry | Expected canonical-root result |
| ---------------------------  | --------------- | ------------------------------ |
| `"/"` (filesystem root)     | yes             | `[]` (INACTIVE)                |
| `"tmp"` (bare relative)     | yes             | `[]` (INACTIVE)                |
| `"../tmp"` (rel. traversal) | yes             | `[]` (INACTIVE)                |
| `"."` (cwd-anchor)          | yes             | `[]` (INACTIVE)                |
| `"/private/tmp"` (legit)    | yes             | `["/private/tmp"]`             |
| `"/tmp"` (legit)            | yes             | non-empty canonical, not `"/"` |

### Policy-level witness (NEW in CORRECTION04)

Added to
`apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`:

The strongest end-to-end witness the reviewer demanded:
1. Persist tampered `"/"` (valid 1h expiry).
2. Read through `resolveActiveViaProductionPipeline` — surviving
   authority set is `[]`.
3. Thread that empty set into `buildPathAuthorityEvidence` for a
   `cat <out-of-scope-path>` command.
4. Assert `contained: false` (policy downgrades R0 to ASK).
5. Diagnostic witness: threading `[ "/"]` through the SAME
   `buildPathAuthorityEvidence` call would have produced
   `contained: true` — pinning the exact bypass scenario.

This is "not merely runtime helper returned `[]`" — it is the
full production evidence-builder chain confesses the bypass
cannot have happened.

### Conservation matrix (re-runs unchanged)

```
active ≤24h /private/tmp               → ALLOW
expired                                 → ASK
>24h tampered state                     → ASK
symlink escape                          → ASK
hard deny                               → DENY (unchanged)
absent setting                          → pre-ACT behavior
relative path                           → REJECT (write-time) + INACTIVE (runtime)
filesystem root "/"                     → REJECT (write-time) + INACTIVE (runtime)
mixed valid + tampered-paths            → valid forwarded, tampered dropped
persisted "/" lease + cat /etc/passwd   → ASK (not ALLOW) end-to-end
ADD in B → next A evaluation sees ADD  → PASS
REMOVE in B → next A evaluation []      → PASS
EXPIRE → every instance independently  → PASS
fresh-read pipeline (no watcher)        → unchanged
```

## §5 — Files touched in CORRECTION04

```
apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts
  + classifyTemporaryExternalPathShape(predicate) export.
  + TemporaryExternalPathShapeClassification type export.
  ~ validateEntry now uses the shared predicate (consolidates
    the four shape checks into a single branching site).
  ~ filterActiveTemporaryExternalPathEntries now applies the
    shared predicate and drops anything other than "valid".
  = Module header comment updated to mention CORRECTION04.

apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts
  + 2 describe blocks (classifier + runtime filter).

apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts
  + describe("CORRECTION04 tampered-paths adversarial matrix")
    with 6 sub-tests (4 negative + 2 positive).

apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts
  + describe("CORRECTION04 policy-level witness") with 1 end-
    to-end sub-test that drives the full buildPathAuthorityEvidence chain.
```

No production host-side wiring changes — the validator and
filter are both in the same module already, so wiring into
SdkController is implicit.

## §6 — Architecture preserved vs. expanded

**Before CORRECTION04**: validator enforced
`path !== "" && isAbsolute(path) && path !== "/"`; runtime
filter only enforced `typeof string && path.length > 0`. The
asymmetry was the P0.

**After CORRECTION04**: both enforcement points consult the
same `classifyTemporaryExternalPathShape(path)` predicate.
Drift between them is structurally impossible.

## §7 — Verdict

`PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V4` (CORRECTION04).
The new post-CORRECTION03 P0 is closed: tampered persisted
state of `"/"` or relative paths cannot widen R0 authority via
the runtime filter (and therefore cannot reach the
realpath-canonicalization step downstream). The P1 remains
classified non-blocking and is intentionally not addressed
in this correction per the reviewer's recommendation. The
CORRECTION03 architecture (no watcher, fresh-read at the
decision boundary) is preserved unchanged.

If the tampered-paths matrix goes GREEN (it does — see §4),
this should be the last security correction: the underlying
CORRECTION03 architecture is the right one.
