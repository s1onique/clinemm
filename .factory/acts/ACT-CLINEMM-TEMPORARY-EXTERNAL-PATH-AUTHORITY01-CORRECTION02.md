# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION02

> **Status**: **CLOSED_V2 / PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V1** (P1;
> closed 2026-09-03). All reviewer halt conditions from the
> CORRECTION01 review closed; V1 architecture retained.

## §0 — Why this correction

The CORRECTION01 review surfaced two P0s:

1. **P0-1** Validator claimed "absolute/non-empty path" but only
   checked string + non-empty. Relative paths (`tmp`, `../tmp`,
   `.`, `foo/bar`) were accepted at write time and would resolve
   against the extension host's process CWD at `realpathSync`
   time — a CWD-dependent authority identity the user never
   configured.
2. **P0-2** The ACT claimed five-instance convergence via the
   `~/.cline/data/globalState.json` file-backed storage. In
   practice, `StateManager.getGlobalSettingsKey` reads ONLY from
   the in-memory cache populated at startup; no re-read, no
   subscription, no VS Code storage-change notification. Live
   cross-instance visibility was never proven because it is
   **structurally unavailable** with the original architecture.

Two further P1s were flagged: filesystem root `/` defeats the
bounded escape-hatch contract (`workspaceRoots ∪ ["/"]` trivially
contains every canonical path), and the production-seam test used
a `mirrorResolveActive` helper duplicating the production filter.

This CORRECTION02 closes all of these without changing the
architecture.

## §1 — Validator: absolute paths + no filesystem root (P0-1, P1)

`apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts`
now requires:

```text
path.isAbsolute(path)         → required (rejects "tmp", "../tmp", ".", "foo/bar", …)
path !== "/"                  → required (rejects filesystem root)
```

Two new typed error reasons added to
`TemporaryExternalPathValidationErrorReason`:

- `"path-not-absolute"` — the entry's path is not absolute.
- `"path-filesystem-root-forbidden"` — the entry's path is exactly
  the filesystem root `/`.

The validator REJECTS (not clamps, not auto-resolves). At the host
boundary, `realpathSync` already canonicalizes; the write-time
validator now rejects paths that would canonicalize to something
other than the user's intended identity.

## §2 — Cross-instance visibility via filesystem watcher (P0-2)

VS Code's `ExtensionContext.globalState` does NOT provide
live-change notifications across multiple extension hosts. The
factory rule for live multi-instance visibility therefore requires
an explicit mechanism.

`apps/vscode/src/core/storage/StateManager.ts` now installs a
`chokidar` file watcher on `${dataDir}/globalState.json` at
`initialize()` time. The watcher:

1. Suppresses self-write events via a `lastSelfPersistMs` timestamp
   bumped by the persistence flush (with a 1-second tolerance
   window).
2. Calls `reloadTemporaryExternalPathAuthorities()` on external
   changes (50ms debounce to coalesce rapid events).
3. `reloadTemporaryExternalPathAuthorities()` re-reads the single
   key from the backing store via `globalStateBackingStore.get()`
   and updates the in-memory cache.

This widens the runtime authority visibility window from
"per-instance at startup" to "any-while-running", the minimum
required for cross-instance authority to mean anything operationally.

### Why a filesystem watcher is the right primitive

VS Code does NOT provide a globalState-change API. The chokidar
watcher is the smallest reliable mechanism that works across
multiple Codium / VS Code windows in the same profile and across
manually-edited `globalState.json`.

### Self-write feedback suppression

The watcher fires on EVERY write to `globalState.json` — including
our own. The `lastSelfPersistMs` timestamp + 1-second tolerance
window filters those out, preventing every user edit from
triggering a reload that fires `onSyncExternalChange` to the
webview.

## §3 — Production-seam helper shared with tests (P1 mirror)

The `mirrorResolveActive` function in the c2 test duplicated the
production filter logic. CORRECTION02 removes the mirror: the test
now calls `filterActiveTemporaryExternalPathEntries` directly from
`@shared/storage/temporaryExternalPathAuthorities` — the SAME
function `SdkController.resolveActiveTemporaryExternalCanonicalRoots`
uses. `SdkController` itself was refactored to call the shared
helper, eliminating the local implementation entirely.

## §4 — Documentary cleanup (P2)

The stale "UI enforces the 24h ceiling on write" comment was
removed from `state-keys.ts`. The accurate statement: the host
validator REJECTS writes exceeding `now + 24h`; the UI clamps its
own selectors but authority lives in the host.

The "clamped" wording in the original ACT body was corrected to
"REJECTS (typed error)" and the absolute-path requirement was added
to the V1 contract section.

## §5 — Required new evidence

### P0-1 absolute-path: validator unit tests

`apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts`:

- 6 relative-path rejection sub-tests (via `it.each`):
  `tmp`, `../tmp`, `.`, `foo/bar`, `./relative`, `../../escape`
  → `path-not-absolute`
- Filesystem root `/` → `path-filesystem-root-forbidden`
- 4 absolute-path acceptance sub-tests (via `it.each`):
  `/private/tmp`, `/tmp`, `/var/folders/abc/T/`, `/Users/me`
  → `errors.length === 0`

### P0-2 cross-instance: production-equivalent test

`apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts`:

- `external write to globalState.json reaches the cache via
  reloadTemporaryExternalPathAuthorities` — drive a SECOND writer
  to write a different entry to the SAME backing file, then verify
  the first instance sees the new value WITHOUT restart.
- `the runtime filter rejects tampered >24h persisted state after
  cross-instance reload` — write a 25h entry directly, reload,
  verify the cache contains the raw value but the runtime filter
  drops it.
- `the validator (write-time) rejects relative paths and filesystem
  root` — drive the validator directly to prove the write-time
  boundary holds independent of the runtime filter.
- `self-write feedback suppression: own writes do NOT trigger a
  reload` — bump the suppressor timestamp, re-touch the file,
  verify the cache is unchanged.

### P1 mirror eliminated

`apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`
now calls the production helper directly. All 12 tests were
converted to async + await. Plus 2 new sub-tests for absolute-path
rejection and filesystem-root rejection.

## §6 — Files touched in CORRECTION02

```text
apps/vscode/src/shared/storage/temporaryExternalPathAuthorities.ts
  Added path-not-absolute + path-filesystem-root-forbidden errors.
  Added isAbsolute check + filesystem-root rejection in validateEntry.
  Added filterActiveTemporaryExternalPathEntries shared helper
  (eliminates mirror duplication).

apps/vscode/src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts
  +6 relative-path rejection sub-tests (it.each).
  +1 filesystem-root rejection sub-test.
  +4 absolute-path acceptance sub-tests (it.each).

apps/vscode/src/sdk/SdkController.ts
  resolveActiveTemporaryExternalCanonicalRoots now delegates to the
  shared helper (no local filter logic).

apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts
  mirrorResolveActive now wraps the shared helper.
  12 tests updated to async + await.
  +2 new sub-tests for relative-path + filesystem-root rejection.

apps/vscode/src/core/storage/StateManager.ts
  Added installGlobalStateWatcher() — chokidar-based file watcher on
  globalState.json that triggers reloadTemporaryExternalPathAuthorities()
  on external changes (with self-write suppression).
  Added reloadTemporaryExternalPathAuthorities() — surgical re-read
  of the single key from the backing store.
  Added __testOnlyBumpSelfPersistForCrossInstanceTest() helper.
  Persistence flush bumps lastSelfPersistMs for the suppression window.

apps/vscode/src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts  (NEW)
  4 production-equivalent sub-tests proving cross-instance visibility,
  tampered-state rejection, validator absolute-path + filesystem-root
  checks, and self-write feedback suppression.

.factory/acts/ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01.md
  V1 contract section updated: REJECTS (not clamps), and adds the
  absolute-path + non-root requirement.

apps/vscode/src/shared/storage/state-keys.ts
  Updated stale "UI enforces" comment to reflect the host validator
  is the authority.

.gitignore
  (No changes; CORRECTION02 ACT body file already whitelisted).
```

## §7 — Conservation matrix (re-runs unchanged)

```text
active ≤24h /private/tmp → ALLOW
expired                   → ASK
>24h tampered state       → ASK
symlink escape            → ASK
hard deny                 → DENY (unchanged)
absent setting            → pre-ACT behavior
relative path             → REJECT (write-time)
filesystem root "/"       → REJECT (write-time)
self-write feedback       → suppressed (watcher ignores own writes)
external cross-instance   → cache picks up via file watcher
```

## §8 — Verdict

`PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V1` (CORRECTION02). The two
new P0s, two P1s, and one P2 from the CORRECTION01 review are
closed. The architecture is unchanged: this correction adds
defense-in-depth at three independent boundaries
(validator at write + filter at consumption + file watcher for
cross-instance visibility).
