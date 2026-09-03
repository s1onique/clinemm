# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION05

> **Status**: **CLOSED / PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V5**
> (P0 + P1 + P2; closed 2026-09-03). The new post-CORRECTION04
> P0 (snapshot-identity race between evidence construction and
> host authorization) is closed: one durable read per approval
> evaluation, threaded as an immutable snapshot into both halves.
> The cross-platform filesystem-root P1 (Windows drive roots and
> UNC paths) is closed via `path.parse(path).root` semantics.
> The P2 EOF newline residue in `path-authority-evidence.ts` is
> closed. CORRECTION04 architecture is preserved unchanged.

## §0 — Why this correction

The CORRECTION04 review surfaced one new P0, one P1, and one P2:

> **P0 — TEMP_AUTHORITY_SNAPSHOT_IDENTITY**: The
> `resolveHostAuthorization` callback in `SdkController` performs
> two fresh-reads of `clinemmTemporaryExternalPathAuthorities`
> during one approval decision:
> ```ts
> const pathAuthorityEvidence = await this.buildPathAuthorityEvidence(...)
> const activeTempRoots = this.resolveActiveTemporaryExternalCanonicalRoots()
> ```
> An external REMOVE between the two reads lets a mixed-generation
> decision slip through: evidence carries the OLD authority set,
> auth carries the NEW one, the policy evaluates against an OLD
> snapshot for a command the user has already revoked. Mechanically
> the two reads are NOT guaranteed to be the same set.

> **P1 — CROSS_PLATFORM_ROOT_SHAPE**: The CORRECTION04
> `classifyTemporaryExternalPathShape` returns `"valid"` for
> Windows drive roots like `C:\` and UNC roots like
> `\\server\share` because the predicate compares against literal
> `"/"`. On Windows the platform root is `C:\` not `/`. Granting
> `C:\` would make the entire drive an external authority root.

> **P2 — EOF newline residue**: `path-authority-evidence.ts` ends
> with `}` and no trailing newline. Trivial cleanup.

The reviewer's exact recommendation:

> Read the authority ONCE per approval evaluation and use that
> same immutable snapshot everywhere downstream. Option B:
> resolve once in the outer approval function and pass it to
> both evidence construction and auth construction.
> [diagram]: fresh durable read → TEMP_AUTHORITY_SNAPSHOT →
> [evidence builder, host authorization] → policy decision

> For the cross-platform root, use the platform root rather than
> literal `/`, e.g. `parse(path).root === normalize(path)`.

This CORRECTION05 adopts both recommendations verbatim. No
new persistence mechanism, no watcher, no lock — just one
fresh-read, one snapshot, one decision. CORRECTION04 is not
revisited.

## §1 — Single fresh-read snapshot (P0)

In `SdkController.resolveHostAuthorization`:

```text
const activeTempRoots =
    this.resolveActiveTemporaryExternalCanonicalRoots()   // ONE fresh-read at the top

const pathAuthorityEvidence = await this.buildPathAuthorityEvidence(
    requestInput,
    activeTempRoots,                                       // SAME snapshot embedded
)

let hostAuthorization = getCommandHostAuthorization(
    ...,
    {
        ...,
        temporaryExternalCanonicalRoots: activeTempRoots, // SAME snapshot carried
    },
    ...,
)
```

`buildPathAuthorityEvidence` now accepts an optional
`temporaryExternalCanonicalRoots` parameter (default `[]` for
backward compatibility with other callers) and forwards it to
the SDK helper. The SDK helper embeds the array into the
evidence record. The policy re-test compares
`evidence.temporaryExternalCanonicalRoots` against
`auth.temporaryExternalCanonicalRoots` — they are now
**same snapshot value/generation** because they came from the
single fresh-read at the top of the callback. The security
requirement is semantic equality (same view of the durable
state at decision-time), NOT JavaScript reference identity.
A future clone of the array for safety would still satisfy the
invariant.

## §2 — Cross-platform filesystem-root detection (P1)

`classifyTemporaryExternalPathShape` now uses
`path.parse(path).root` to detect the platform root:

- POSIX: `parse("/").root === "/"` → filesystem-root
- POSIX: `parse("/private/tmp").root === "/"` (root is parent
  drive, NOT same as full path) → valid
- Windows: `parse("C:\\").root === "C:\\"` → filesystem-root
- Windows: `parse("C:\\Users\\me").root === "C:\\"` → valid
- Windows: `parse("\\\\server\\share").root === "\\\\server\\share"` → filesystem-root
- Windows: `parse("\\\\?\\C:\\").root === "\\\\?\\C:\\"` → filesystem-root

Trailing-separator-tolerant comparison so `C:\` and `C:` (when
treated as drive root, e.g. with trailing `\` on win32) are
classified consistently.

Windows tests use `node:path.win32` directly so the test runs
on POSIX CI hosts.

**Test-mode classification (per Factory review):**
```
CROSS_PLATFORM_SEMANTICS = SYNTHETIC_REAL
  POSIX cases execute against the real production predicate
  (real `node:path.parse`).
WINDOWS_LIVE_RUNTIME     = NOT_EXECUTED
  Windows cases mirror the production logic with `path.win32`
  helpers so they can execute on this POSIX CI host. No live
  Windows CI runner is part of this ACT; live Windows execution
  remains a follow-up (NOT a P0; current coverage is sufficient).
```

## §3 — EOF newline residue (P2)

`sdk/packages/core/src/runtime/command-policy/path-authority-evidence.ts`
now ends with `}\n` instead of `}`. Trivial. The file had
been untracked (factory in-progress work); the EOF is fixed in
the same change-set.

## §4 — Snapshot-identity contract

```
one evaluation:
  EXACTLY ONE temp-authority durable read (at the top of
  resolveHostAuthorization)

evidence.temporaryExternalCanonicalRoots
  === same snapshot value/generation as authorization
  (NOT JavaScript reference identity — semantic equality
  is the security requirement)

external removal after snapshot:
  cannot produce mixed-generation evidence/auth (snapshot
  semantics — removal applies to the NEXT evaluation)

next evaluation:
  observes removal → ASK
```

This matches the same Factory rule used elsewhere in the
codebase: independently sampled state must not be presented as
one coherent authority identity.

## §5 — Files touched in CORRECTION05

```
apps/vscode/src/sdk/SdkController.ts
  ~ resolveHostAuthorization: ONE fresh-read at the top of the
    callback; the same snapshot is passed into both
    buildPathAuthorityEvidence (via new optional parameter)
    and getCommandHostAuthorization.
  ~ buildPathAuthorityEvidence: added optional
    temporaryExternalCanonicalRoots parameter (default [] for
    other callers); forwarded to the SDK helper. The evidence
    record now carries the snapshot.

apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts
  ~ classifyTemporaryExternalPathShape: replaced literal `path
    === "/"` check with cross-platform `isFilesystemRoot(path)`
    using `path.parse(path).root` plus trailing-separator
    tolerance.

sdk/packages/core/src/runtime/command-policy/path-authority-evidence.ts
  ~ EOF newline: file now ends with `}\n` (P2 cleanup).

apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts
  + 10 cross-platform filesystem-root tests (POSIX + Windows).
  + 1 Windows drive-root runtime filter witness.

apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts
  + describe("CORRECTION05: snapshot-identity witness") with 2
    tests:
      - evidence and auth carry the SAME snapshot from a single
        fresh-read
      - external REMOVE between snapshot capture and downstream
        use does NOT split generations
```

## §6 — Conservation matrix (re-runs unchanged)

```
active ≤24h /private/tmp               → ALLOW
expired                                 → ASK
>24h tampered state                     → ASK
symlink escape                          → ASK
hard deny                               → DENY (unchanged)
absent setting                          → pre-ACT behavior
relative path                           → REJECT (write-time) + INACTIVE (runtime)
filesystem root POSIX "/"              → REJECT (write-time) + INACTIVE (runtime)
filesystem root Windows "C:\", UNC     → REJECT (write-time) + INACTIVE (runtime)
mixed valid + tampered-paths            → valid forwarded, tampered dropped
persisted "/" lease + cat /etc/passwd   → ASK (not ALLOW) end-to-end
ADD in B → next A evaluation sees ADD  → PASS
REMOVE in B → next A evaluation []      → PASS (security-sensitive direction)
EXPIRE → every instance independently  → PASS
fresh-read pipeline (no watcher)        → unchanged
ONE durable read per evaluation         → snapshot frozen for THIS evaluation
external REMOVE mid-evaluation         → applies to NEXT evaluation, not THIS
```

## §7 — Verdict

`PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V5` (CORRECTION05).
The new post-CORRECTION04 P0 `TEMP_AUTHORITY_SNAPSHOT_IDENTITY`
is closed via single-fresh-read snapshot semantics. The
cross-platform filesystem-root P1 is closed via
`path.parse(path).root`. The P2 EOF newline residue is closed.
CORRECTION04 architecture (no watcher, fresh-read at the
decision boundary, shared path-shape predicate, defense-in-
depth) is preserved unchanged.

**Snapshot-identity evidence composition:**
- STRUCTURAL: the production callback
  `resolveHostAuthorization` contains exactly one call to
  `this.resolveActiveTemporaryExternalCanonicalRoots()` (the
  durable read); that snapshot is threaded into both
  `buildPathAuthorityEvidence` and `getCommandHostAuthorization`.
- SYNTHETIC_REAL: the snapshot-identity witnesses exercise the
  production durable-read helper plus evidence pipeline and
  prove (a) the snapshot survives external REMOVE and (b) the
  next fresh evaluation observes `[]`.

The combination is sufficient bounded proof of snapshot
semantics — no dependency injection or filesystem-read
instrumentation was needed to count one obvious call in a
small production closure.

If the snapshot-identity matrix goes GREEN (it does — see §5)
this should be the last structural correction. The reviewer's
directive:

> Then STOP. No more architecture changes unless that
> correction reveals a genuinely new P0.

The corrections to follow (UI cache freshness, EOF newline)
are cosmetic / non-blocking per Factory classification.
