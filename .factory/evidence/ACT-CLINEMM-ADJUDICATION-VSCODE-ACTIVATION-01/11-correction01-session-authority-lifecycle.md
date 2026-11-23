# 11 — CORRECTION01: session authority lifecycle (`HALT_SESSION_AUTHORITY_LIFECYCLE`)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01
**Classification:** STRUCTURAL
**Review verdict closed:** `HALT_SESSION_AUTHORITY_LIFECYCLE` (two P0s)

## VERDICT

```
PASS_STRUCTURAL_ONLY
```

Both P0s raised by the reviewer are closed at the SOURCE level with
EXECUTABLE witnesses. The previously-reported structural observations
(default-off, explicit opt-in, the 18 original witnesses, the VSIX bundle
identity, the installed-editor activation) are PRESERVED — see
`10-exit-report.md` for the pre-correction state.

The installed-live qualification (`PASS_LIVE_ACTIVATION_QUALIFIED`) is
**still NOT claimed**: this correction changes the producer and its
authority wiring, so the VSIX must be rebuilt and repackaged from the exact
committed HEAD before any live claim is made against it. See
`NEXT_ACTION` below.

## P0-1 — A pending contract could attach to the wrong session

### The defect

The producer resolved the contract as:

```ts
const adjudicationContract =
    adjudicationStore.getBound(input.sessionId) ?? adjudicationStore.peekArmed()
```

`input.sessionId` is present for a **resume** or a **rebuild**; a **new
task** receives its session id only AFTER the config is built. The `??`
fallback therefore made the ARMED slot reachable from the EXISTING-session
path.

The interleaving the reviewer identified:

```
1. Operator arms contract A for a new task.
2. Contract A is pending, not yet consumed.
3. Existing unrelated session B is resumed or rebuilt.
4. getBound(B) returns undefined.
5. peekArmed() returns contract A.
6. buildSessionConfig(B) enables adjudication with A's vocabulary.
```

This violates the contract's central invariant: **a task-scoped
authorization must never be inherited by an unrelated session.**

The pre-correction test suite did not cover it: it checked that session B
cannot inherit a contract *after* session A had consumed it. The pending-arm
interleaving — the more dangerous one — was uncovered.

### A second, deeper defect the review surfaced

The reviewer's counterexample was a SOURCE-LEVEL observation. Reading the
production call sites showed the defect was **worse than the review stated**:
`input.sessionId` was **never supplied by any production caller**.

Every resume/rebuild path set the session id AFTER the config was built:

```ts
const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
config.sessionId = oldSessionId
```

So in production the producer ALWAYS saw `sessionId === undefined`, and
therefore ALWAYS took the `peekArmed()` branch — on the resume path, on the
rebuild path, and on the new-task path alike. The producer's session-identity
discrimination was dead code in production.

The correction therefore has two halves:

1. the producer must SPLIT its resolution by session identity; and
2. every production resume/rebuild path must ACTUALLY supply the session id
   to the producer.

### The fix

**Producer** (`apps/vscode/src/sdk/cline-session-factory.ts`):

```ts
const adjudicationStore = getAdjudicationTaskContractStore()
const isExistingSession = Boolean(input.sessionId?.trim())
const adjudicationContract = isExistingSession
    ? adjudicationStore.getBoundOrPersisted(input.sessionId)
    : adjudicationStore.peekArmed()
```

**Store** (`apps/vscode/src/sdk/adjudication-task-contract.ts`):
`getBoundOrPersisted(sessionId)` is the SINGLE authority for an existing
session. It resolves the in-memory BOUND contract for that EXACT session id,
or the PERSISTED vocabulary for that EXACT session id (see P0-2). It NEVER
consults the ARMED slot, and it NEVER consults another session's record.

**Production wiring** — every path that reconstructs an EXISTING session now
passes the session id into the producer:

| Path | File |
|---|---|
| Resume | `apps/vscode/src/sdk/sdk-task-resume.ts` |
| Mode rebuild | `apps/vscode/src/sdk/sdk-mode-coordinator.ts` |
| Provider rebuild (legacy) | `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts` |
| Provider rebuild (typed instance) | `apps/vscode/src/sdk/sdk-provider-change-coordinator.ts` |
| MCP tool restart | `apps/vscode/src/sdk/sdk-mcp-coordinator.ts` |
| Terminal-mode rebuild | `apps/vscode/src/sdk/sdk-terminal-execution-mode-coordinator.ts` |
| Auto-approval rebuild | `apps/vscode/src/sdk/sdk-session-auto-approval-coordinator.ts` |
| Configuration rebuild | `apps/vscode/src/sdk/sdk-session-config-change-coordinator.ts` |

The `sessionId` is still ALSO assigned to `config.sessionId` afterwards, so
the config's identity is unchanged. Only the producer's KNOWLEDGE of the
session identity is new.

### The executable RED

`apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.correction01.session-authority-lifecycle.test.ts`
(GATE 1), against the REAL producer:

```ts
const store = getAdjudicationTaskContractStore()
store.arm({ vocabulary: AUTHORIZED_VOCABULARY })      // pending arm

const config = await buildSessionConfig({
    cwd: path.join(tempDir, "workspace"),
    sessionId: "unrelated-existing-session-B",        // unrelated resume
})

expect(config.adjudication).toBeUndefined()
expect(store.hasArmed()).toBe(true)                   // the arm SURVIVES
```

## P0-2 — Restored sessions did not restore the activation contract

### The defect

`AdjudicationTaskContractStore` is documented as **in-memory**. A recreated
extension host therefore lost its session-bound vocabulary, even when the
evidence-handle secret survived in `secrets.json`:

```
Host A:  arm vocabulary S1 -> bind to session A -> persist secret -> accept adjudication
Host B:  new store, no armed or bound vocabulary
          buildSessionConfig(session A) -> adjudication = undefined
          continuity feature disabled for the authorized session
```

The pre-correction "restoration" test recreated the evidence REGISTRY, not
the extension host and its authorization store. It proved the SDK's
restoration contract, not the VS Code host's configuration path. The
report's restoration claim was therefore stronger than the production
configuration path established.

### The fix — the BOUND contract is a FACT, the ARMED contract is INTENT

The two have different lifetimes, and the correction makes that explicit:

| Slot | Lifetime | Persisted? | Why |
|---|---|---|---|
| ARMED | pending intent for the NEXT task | **NO** | it must never survive a restart into a task the user did not authorize |
| BOUND | a fact about ONE specific session | **YES** | the session it names already exists; a restart must not silently disable the feature for it |

**New adapter:** `apps/vscode/src/sdk/adjudication-session-vocabulary.ts` —
the trusted, host-owned, persisted record of a session's authorized
vocabulary. It lives in the SAME file-backed secret store (mode 0o600) as
the per-session evidence secret, under the new secret key
`adjudicationSessionVocabularies`, as a JSON object keyed by session id. It
is never written to workspace settings, a repository file, a prompt, a
provider request, a debug log, or the committed evidence package.

**Write point:** `AdjudicationTaskContractStore.consumeForSession(sessionId)`
— the authoritative session-id allocation point. Writing there means no
window exists in which a restart loses the authorization, and writing only
there means the record is created exactly once per authorized session.

**Read point:** `getBoundOrPersisted(sessionId)`, as above.

**Retirement:** `AdjudicationTaskContractStore.clearBound()` — the task-clear
choke-point — also retires the PERSISTED record of the retired session, so
a later host restart cannot resurrect an authorization for a task the user
has abandoned. It does NOT touch the ARMED contract: the user's
preparation for the next task survives the current task's cancellation.

### The secret restoration — RESTORE semantics for an existing session

The producer previously supplied `createSessionSecretProviderForStart()`
unconditionally, which MINTS AND PERSISTS a replacement secret for a session
that has none. For a session whose historical evidence handles exist, that
is the exact fail-open the SDK contract forbids: the historical handles would
resolve to nothing while LOOKING like a successful restoration.

The correction selects the provider by the same session-identity split:

```ts
const adjudicationSecretProvider = isExistingSession
    ? createSessionSecretProviderForRestore()
    : createSessionSecretProviderForStart()
```

- **NEW task** (no session id): START semantics. The session is new; it may
  mint and persist its own secret.
- **EXISTING session** (session id present): RESTORE semantics. It recovers
  the stored secret, or — when the secret is genuinely lost — hands back a
  fresh IN-MEMORY-ONLY secret and reports NOT-restorable. It NEVER persists
  a replacement for a lost historical identity.

### The executable REDs

GATE 2 — complete host/store recreation:

```ts
// HOST A
hostAStore.arm({ vocabulary: AUTHORIZED_VOCABULARY })
const hostAConfig = await buildSessionConfig({ cwd: workspaceRoot })   // NEW task
hostAStore.consumeForSession("session-A")

// HOST B — the extension host is recreated
resetAdjudicationTaskContractStore()
expect(getAdjudicationTaskContractStore().hasArmed()).toBe(false)
expect(getAdjudicationTaskContractStore().getBound("session-A")).toBeUndefined()

// HOST B rebuilds the SAME session — WITHOUT re-arming
const hostBConfig = await buildSessionConfig({ cwd: workspaceRoot, sessionId: "session-A" })
expect(hostBConfig.adjudication).toBeDefined()
expect(hostBConfig.adjudication?.enabled).toBe(true)
expect(hostBConfig.adjudication?.vocabulary).toEqual(AUTHORIZED_VOCABULARY)
```

GATE 3 — missing-secret restoration:

```ts
// HOST A: the SDK's session start calls the provider, which persists the secret.
const originalSecret = await hostAConfig.adjudication?.secretProvider?.(sessionId)
// The secret is LOST.
secretStore.set(SECRET_STORAGE_KEY, JSON.stringify({}))

// HOST B rebuilds the SAME session.
const provider = hostBConfig.adjudication?.secretProvider
const restored = await provider?.(sessionId)
expect(restored).not.toBe(originalSecret)
expect(readPersistedSecrets()[sessionId]).toBeUndefined()   // NO replacement persisted
```

## The correction suite

`apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.correction01.session-authority-lifecycle.test.ts`
— 15 witnesses, base `vitest.config.ts`.

| Gate | Witnesses | Covers |
|---|---|---|
| 1 — session isolation | 5 | pending arm vs. unrelated existing session (×2), new-task path preserved, own-bound-session preserved, one-shot arm discipline |
| 2 — authorization restoration | 3 | full host recreation restores the ORIGINAL session's contract, no restoration for an unauthorized session, no restoration without persisted state |
| 3 — secret restoration | 3 | no replacement persistent secret for a lost secret, same secret when it survived, START semantics on the new-task path |
| 4 — store authority discipline | 4 | `getBoundOrPersisted` never consults the armed slot, resolves only its own session, `clearBound` retires the persisted record, `clearBound` does not erase the armed contract |

### RED reproducibility (executed)

The producer's resolution was temporarily reverted to the pre-correction
form and the suite re-run:

```
REVERTED producer to the pre-correction resolution
Tests  5 failed | 10 passed (15)
```

The 5 failures were exactly the P0 witnesses:

- GATE 1 — "does NOT attach a pending (unconsumed) arm to an unrelated EXISTING session"
- GATE 1 — "does NOT attach a pending arm to an unrelated session even when the store has a DIFFERENT bound session"
- GATE 2 — "restores the authorized vocabulary for the original session after a full host recreation"
- GATE 3 — "does NOT mint a replacement PERSISTENT secret for an existing session whose secret is missing"
- GATE 3 — "keeps the SAME secret for an existing session whose secret SURVIVED (a real rebuild)"

The producer was then restored and the suite returned to 15/15 PASS. The
witnesses are load-bearing, not vacuous.

## The storage protection model — stated accurately

The review flagged that the report should not imply platform-encrypted
storage. The correction keeps the existing file-backed store and documents it
accurately:

- The extension's trusted secret store is the file-backed `secrets.json`
  (mode `0o600`) behind `StateManager` — the SAME store the project already
  uses for API keys, OAuth credentials and similar.
- This is **NOT** VS Code's `ExtensionContext.secrets`, and it is **NOT**
  platform-encrypted keychain storage. It is a distinct protection model:
  filesystem permissions on a local file.
- No storage-framework migration is performed by this correction, and none is
  required for it. The two new records use the established store precisely so
  the correction does not fork the storage model.

## CONSERVATION

The correction is a NARROWING plus a RESTORATION, not a behaviour change on
the default path:

- With NO authorization of any kind, the produced `CoreSessionConfig` is
  unchanged: the whole `adjudication` key is still absent, so the SDK's
  `configWithProvider.adjudication?.enabled` is `undefined` and no registry,
  publication instruction, evidence trailer, carry-forward, extra model call,
  provider-prefix change or persistent secret occurs.
- The default path now performs ONE additional pure read
  (`getBoundOrPersisted`) and ONE additional boolean test
  (`isExistingSession`). No new I/O on the default path: the persisted
  vocabulary is only read when a session id is supplied.

### The full-suite conservation measurement (executed)

The whole base suite was run TWICE — once with the correction stashed (the
pre-correction baseline) and once with the correction applied — and the two
FAILING-FILE SETS were compared with `comm`:

| Run | Test files | Failing files | Failing tests | Passing tests |
|---|---|---|---|---|
| baseline (correction stashed) | 546 | 63 | 169 | 6007 |
| corrected | 548 | 63 | 169 | 6027 |

```
=== FAILING FILES ONLY IN CORRECTED RUN (must be empty) ===
=== FAILING FILES ONLY IN BASELINE RUN (must be empty) ===
=== END ===
```

Both `comm` differences are EMPTY: the set of failing files is IDENTICAL
before and after the correction. The 63 failing files / 169 failing tests
are entirely PRE-EXISTING and are untouched by this correction. The passing
count rose by exactly 20 — the 15 new correction witnesses plus the 5
pre-existing producer witnesses the stash had temporarily removed.

No adjudication-related file appears in either failure set.

### The six expectation updates (deliberate, not regressions)

Six pre-existing assertions pinned the EXACT argument object of
`sessionConfigBuilder.build(...)`. The correction adds the `sessionId` field
to that object, so those exact-match assertions were updated:

| Test file | Assertion |
|---|---|
| `sdk-mcp-coordinator.test.ts` | `build` called with `{cwd, mode, sessionId}` |
| `sdk-mode-coordinator.test.ts` | `build` called with `{cwd, mode, sessionAutoApprovalOverride, sessionId}` |
| `sdk-provider-change-coordinator.test.ts` (×2) | `build` called with `{cwd, mode, sessionId}` |
| `sdk-session-config-change-coordinator.test.ts` | `build` called with `objectContaining({..., sessionId})` |
| `sdk-terminal-execution-mode-coordinator.test.ts` | `build` called with `{cwd, mode, sessionAutoApprovalOverride, sessionId}` |
| `sdk-followup-coordinator.test.ts` | `build` called with `{cwd, mode, sessionId}` |

Each is an EXACT-match assertion on the call arguments, not a behavioural
expectation: the reconstructed session's identity, its messages, its
replacement and its disposal reason are all still asserted unchanged. The
`sessionId` values are the SAME session ids the production code already
assigned to `config.sessionId` immediately afterwards — the correction only
moves that fact EARLIER, into the producer's input.

## Build gates

| Gate | Result |
|---|---|
| `apps/vscode` `tsc --noEmit` | 0 diagnostics |
| correction suite (base config) | 15/15 PASS |
| pre-existing producer suite (base config) | 5/5 PASS |
| runtime-chain suite (bridge config) | 13/13 PASS |
| SDK core adjudication/provenance suites | 79/79 PASS |
| coordinator suites (8 files) | 119/119 PASS |
| `cline-session-factory.test.ts` | 92/92 PASS |
| combined focused re-run | 207/207 PASS |
| full base suite vs. baseline | ZERO new failing files, ZERO new failing tests |
| biome lint + format on the changed files | PASS |

## Production delta of this correction

```
apps/vscode/src/sdk/adjudication-session-vocabulary.ts          (NEW)
apps/vscode/src/sdk/adjudication-task-contract.ts                (MODIFIED: persist on consume, getBoundOrPersisted, clearBound retires)
apps/vscode/src/sdk/cline-session-factory.ts                     (MODIFIED: session-identity split, RESTORE secret semantics)
apps/vscode/src/sdk/sdk-task-resume.ts                           (MODIFIED: supply sessionId)
apps/vscode/src/sdk/sdk-mode-coordinator.ts                      (MODIFIED: supply sessionId)
apps/vscode/src/sdk/sdk-provider-change-coordinator.ts           (MODIFIED: supply sessionId x3)
apps/vscode/src/sdk/sdk-mcp-coordinator.ts                       (MODIFIED: supply sessionId)
apps/vscode/src/sdk/sdk-terminal-execution-mode-coordinator.ts   (MODIFIED: supply sessionId)
apps/vscode/src/sdk/sdk-session-auto-approval-coordinator.ts     (MODIFIED: supply sessionId)
apps/vscode/src/sdk/sdk-session-config-change-coordinator.ts     (MODIFIED: supply sessionId)
apps/vscode/src/shared/storage/state-keys.ts                     (MODIFIED: one secret key)
apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.correction01.session-authority-lifecycle.test.ts (NEW)
```

NO change to the SDK core, the proto surface, the webview UI, the provider
request construction, `submit_and_exit`, or any Settings field other than the
one new secret-storage key.

### Source artifact hashes (SHA-256, the corrected source)

```
3153f0746020d971a8df08a0a83bb105cd736c8e358819e3670cfea48a0b6b7f  apps/vscode/src/sdk/adjudication-session-vocabulary.ts
cdbb6ddf082df840842ecfd2816841f7b06ae63dc5c6a9389292392c807d82c9  apps/vscode/src/sdk/adjudication-task-contract.ts
34bcfd092a35dbf6d0df172a420e09785857381f7137d556d6598e693111fa6e  apps/vscode/src/sdk/cline-session-factory.ts
dc74d550fd7bf8bb07737d4513abd2bd9e78ff2f3341222dffa82ba68c83a9eb  apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.correction01.session-authority-lifecycle.test.ts
```

### The ACT + correction suites, together

```
Test Files  11 passed (11)
      Tests  231 passed (231)
```

(the 5 pre-existing producer witnesses + the 15 correction witnesses + the
coordinator and factory suites).

## NEXT_ACTION

1. Commit the corrected source and this evidence.
2. Rebuild and REPACKAGE the VSIX from the EXACT committed HEAD — the
   previously reported VSIX represents `7490a12a5` plus uncommitted changes,
   and its bundle hash identifies a DIFFERENT artifact from the corrected
   source.
3. Proceed to the debug-only arming seam, then the installed-live
   qualification against the newly packaged artifact.

The historical Round C limitation is unchanged and is NOT re-litigated here:
the six identified R4 candidate reads used `run_commands`, not the supported
`read_files` acquisition class, and there is no authorized R1-R10 vocabulary.
