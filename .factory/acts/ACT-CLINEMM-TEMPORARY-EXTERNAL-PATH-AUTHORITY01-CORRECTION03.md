# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03

> **Status**: **CLOSED_V3 / PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V3** (P0;
> closed 2026-09-03). Cross-instance visibility mechanism is now a
> fresh-read at the decision boundary — no watcher, no debounce,
> no event attribution, no chronology-based self-write heuristic.
> The reviewer halt condition is closed: the test now exercises the
> production pipeline end-to-end (external write to disk →
> `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`
> reads → canonical roots returned), without touching the
> StateManager cache.

## §0 — Why this correction

The CORRECTION02 review surfaced three P0s and one P1 that the
chokidar-based mechanism could not close. Per the Factory rule,
this is the one condition that permits another correction cycle.
The reviewer verdict was `HALT_CROSS_INSTANCE_SYNC_NOT_PROVEN`.

The three P0s (quoted from the review):

> **P0 — the cross-instance test does not test the watcher.**
> The claimed load-bearing test writes the backing file externally,
> but then does this:
> ```ts
> writeGlobalStateDirectly(...)
> StateManager.get().reloadTemporaryExternalPathAuthorities()
> ```
> So the test proves `external disk value + explicit manual reload →
> cache updated`. It does **not** prove `external disk write →
> chokidar event → debounce → reload → cache updated`.

> **Worse: the self-write suppression is causally unsafe.** The
> watcher ignores every event within 1 second of this instance's
> own write:
> ```ts
> if (Date.now() - this.lastSelfPersistMs < SELF_PERSIST_TOLERANCE_MS)
>   return
> ```
> That does not establish event provenance. It establishes only
> chronology. Consider two real Codium instances:
> ```
> t=0ms    A writes its own state; A.lastSelfPersistMs = now
> t=300ms  B changes temporary-path authority
> t=350ms  A receives B's filesystem event
> A: now - lastSelfPersistMs < 1000 → DROP EVENT
> ```
> Instance A can now retain stale authority until some later
> unrelated filesystem event or restart. **chronology != causal identity.**

> **P0-2 — listening only for `change` is narrower than the
> persistence primitive.** The backing-store test explicitly
> simulates atomic persistence as `write temp / rename temp →
> globalState.json`. Yet production subscribes only to
> `watcher.on("change", ...)`. Chokidar's `awaitWriteFinish` does
> normalize a quick unlink/add pair into `change`, but only under
> specific timing windows, which is fragile.

Plus one P1:

> **P1 — watcher failure is explicitly fail-open for coherence.**
> The code says `try { ... } catch { /* best-effort */ log and continue }`.
> But the ACT claims `NO cross-instance desync`. Those two
> contracts cannot both be true.

And a mirror-elimination P1:

> **P1 — the "mirror eliminated" claim is still overstated.**
> The filter duplication is reduced, but the C2 test still
> contains `async function mirrorResolveActive(...)` and
> independently duplicates the production `realpathSync` loop.

## §1 — Decision: simplify

The reviewer's exact recommendation:

> The clean fix is actually simpler than the watcher.
>
> policy evaluation
>   ↓
> read this one key from backing store
>   ↓
> validate/filter
>   ↓
> canonicalize
>   ↓
> use it
>
> In other words: **fresh-read the authority at the decision
> boundary.**

This CORRECTION03 adopts that recommendation in full. The new
mechanism has no watcher, no debounce, no event attribution, no
self-write heuristic, and no cache to keep coherent. Five running
Codium instances therefore see the same authoritative value at
every policy evaluation without any of them depending on a stale
cache.

## §2 — Files removed (CORRECTION02 watcher infrastructure)

`apps/vscode/src/core/storage/StateManager.ts`:

- `private globalStateWatcher: FSWatcher | null = null`
- `private lastSelfPersistMs = 0`
- `private static readonly SELF_PERSIST_TOLERANCE_MS = 1000`
- `private reloadExternalAuthoritiesTimer: NodeJS.Timeout | null = null`
- `private installGlobalStateWatcher(): void`
- `public reloadTemporaryExternalPathAuthorities(): void`
- `public __testOnlyBumpSelfPersistForCrossInstanceTest(): void`
- The `lastSelfPersistMs = Date.now()` bump in `persistPendingState`
- The watcher installation call in `initialize()`
- The watcher cleanup in `dispose()`

Plus the `import * as path from "node:path"` (no longer needed
by the watcher code).

The StateManager's per-instance cache semantics for every OTHER
setting are unchanged (per-instance, populated at startup,
lazy-write, etc.).

## §3 — Files added (CORRECTION03 fresh-read helper)

`apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts`:

- `ResolveActiveTemporaryExternalCanonicalRootsOptions` interface
- `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile(opts)` — public entry-point
- Internal `*Impl` sibling that does the I/O (kept split so the
  `node:fs` import is local to one function; the validator module
  remains usable in browser / bundler contexts that have no
  `node:fs`).
- `readTemporaryExternalPathAuthoritiesRawFromBackingFile(path)` —
  UI-side helper for surfacing the raw list to the user.

`apps/vscode/src/core/storage/StateManager.ts`:

- `public getStorageDataDir(): string` — exposes the StorageContext
  `dataDir` so the consumer pipeline can construct the absolute
  path of `globalState.json` consistently with the writer side
  (ENG-2332).

`apps/vscode/src/sdk/SdkController.ts`:

- The `resolveActiveTemporaryExternalCanonicalRoots()` body is
  rewritten to a single production call to the new helper. No
  mirror duplication, no local realpath loop, no
  `filterActiveTemporaryExternalPathEntries` import.

## §4 — Why this works (the architectural argument)

The CORRECTION02 watcher model:

```
instance A writes X to disk
   ↓ (1s tolerance window)
external writer B writes Y to disk
   ↓ (chokidar event in instance A within 1s)
DROP  ← because A's tolerance window is still open
   ↓
instance A retains X forever (until unrelated event or restart)
```

The CORRECTION03 fresh-read model:

```
instance A evaluates command
   ↓
read Y from disk (one fs.readFileSync)
   ↓
filter + realpath
   ↓
authority is Y
```

There is no chronology to get wrong. There is no causal identity
to fail to identify. There is no cache to keep coherent. There is
no debounce to time-warp. There is no event attribution.

Five running instances, zero explicit synchronization, see the
same authoritative value at every policy evaluation.

## §5 — Test replacement (cross-instance, two-reader / one-backing-store)

The CORRECTION02 cross-instance test
(`temporaryExternalPathAuthorityCrossInstance.test.ts`) was
replaced in full. The new test file
(`apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts`)
exercises the production fresh-read pipeline end-to-end with:

1. **ADD in B → next policy decision in A sees ADD**
   - Instance A initializes with lease X (cache holds X, disk has X).
   - Writer B writes lease Y to the same backing file via the
     production atomic primitive (`tmp + rename`).
   - WITHOUT restart, WITHOUT manual cache reload, WITHOUT
     watcher callback, WITHOUT cache mutation: A's local cache
     STILL holds X (asserted), and A's next call to
     `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`
     returns `[CANONICAL_TEMP_DIR]` (the root of Y), not the root
     of X.

2. **REMOVE in B → next policy decision in A sees REMOVE**
   - Writer B writes `[]` to the same backing file.
   - A's local cache STILL holds the OLD value (asserted).
   - A's next evaluation returns `[]` — no temp roots → policy
     falls back to ASK. **Stale removal is the security-sensitive
     direction; this is the case the reviewer's halt called
     out.**

3. **Missing backing file → `[]`, no throw** (ENOENT branch).
4. **Corrupt backing file → `[]`, no throw** (JSON.parse failure
   branch).
5. **Expired entries dropped by the runtime filter inside the
   fresh-read** (active + expired input → only active survives).
6. **Tampered >24h entry dropped by the defense-in-depth ceiling
   inside the fresh-read** (25h input → `[]`).
7. **Realpath on a non-existent entry dropped via the
   `onRealpathFailure` sink** (the entry is dropped and the
   production logger receives the failure).

7 sub-tests total. The two load-bearing cases (ADD and REMOVE)
both assert that A's local cache still holds the prior value at
the moment of evaluation — proving that the production pipeline
does NOT consult the cache for cross-instance visibility.

## §6 — Production-seam test (mirror elimination)

`apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`
no longer mirrors the production realpath loop. The
`mirrorResolveActive` helper is replaced by
`resolveActiveViaProductionPipeline`, which writes the test input
to the shared backing file and re-reads it through the SAME
production function the SdkController calls:

```ts
async function resolveActiveViaProductionPipeline(
  persisted: ReadonlyArray<TemporaryExternalPathAuthority> | undefined,
): Promise<string[]> {
  writeFileSync(
    BACKING_FILE_FOR_TEST,
    JSON.stringify({ clinemmTemporaryExternalPathAuthorities: persisted ?? [] }),
    "utf-8",
  )
  return resolveActiveTemporaryExternalCanonicalRootsFromBackingFile({
    backingFilePath: BACKING_FILE_FOR_TEST,
  })
}
```

All 12 sub-tests pass. One pre-existing test had a name that
contradicted its assertion (`returns false for now + 1ms (past)`
called the 24h ceiling helper with a value 1ms in the FUTURE).
CORRECTION03 fixes that label (`NOW - 1ms`) so the assertion and
the name agree.

## §7 — Vitest config wiring

The two test files
(`src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts`
and
`src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts`)
are now explicitly listed in `apps/vscode/vitest.config.ts` so
the vitest runner picks them up. Previously the validator test
was only exercised under `bun test:unit`, which never loaded the
vitest include set.

## §8 — Conservation matrix (re-runs unchanged)

```text
active ≤24h /private/tmp               → ALLOW
expired                                 → ASK
>24h tampered state                     → ASK
symlink escape                          → ASK
hard deny                               → DENY (unchanged)
absent setting                          → pre-ACT behavior
relative path                           → REJECT (write-time)
filesystem root "/"                     → REJECT (write-time)
ADD in B → next A evaluation sees ADD  → PASS
REMOVE in B → next A evaluation []      → PASS (REMOVE is the
                                             security-sensitive
                                             direction)
EXPIRE → every instance independently  → PASS (now() is local)
        filters by absolute expiresAt
```

## §9 — What CORRECTION02 will not be revisited

These remain closed by CORRECTION02 and are NOT reopened by
CORRECTION03:

```text
✅ relative path → REJECT
✅ filesystem root "/" → REJECT
✅ >24h write → REJECT
✅ >24h tampered state → INACTIVE
✅ expired state → INACTIVE
✅ canonical realpath confinement
✅ symlink escape remains blocked
✅ default [] preserves pre-ACT authority
✅ filterActiveTemporaryExternalPathEntries shared helper
```

## §10 — Verdict

`PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V3` (CORRECTION03). The
three P0s, one P1, and one P2 from the CORRECTION02 review are
closed by removing the watcher and reading authority from its
durable source at the evaluation seam. The architecture is
strictly simpler than CORRECTION02: it has fewer moving parts,
no chronology dependencies, and no cache to keep coherent. The
factory reviewer's recommendation is adopted verbatim.
