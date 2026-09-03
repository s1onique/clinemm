# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01

> **Status**: **CLOSED_V1 / PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V1** (P1;
> closed 2026-09-03). RED→GREEN pinned at HEAD; conservation matrix
> verified end-to-end on the freshly-built SDK dist + the live
> SdkController filter pipeline (8 + 5 + 6 = 19 verification assertions
> all PASS, including the symlink-escape closure case). Hard-DENY,
> Seatbelt, sensitive-file protections, and realpath verification
> all unchanged.
>
> **Final HEAD**: `ad8f3094c6d2c1c1a5d134cc9738067aeb417345`
> (closure body; lands on top of CORRECTION05 at
> `08f004a7f25fcf3e14051e94dc6254919e94710e`).
>
> **Verdict**: `PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V1`.
>
> **Reviewer halt conditions** (§13): none triggered.
>
> **Primary purpose**: **BOUNDED PRODUCT IMPLEMENTATION** of a temporary,
> expiring, canonical-path-scoped exception to R0 workspace path authority.
> Maximum lifetime **24h**. Hard ceiling.
>
> **Owning epic**: `.factory/epics/safe-yolo-seatbelt.md` (predecessor
> `ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01` closed PASS).
>
> **Predecessors** (frozen, NOT reopened):
> - `ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01` /
>   `…-CORRECTION01` / `…-CORRECTION02` — REALPATH_WORKSPACE_CONFINEMENT.
>   This ACT extends `WorkspacePathAuthorityEvidence` and the
>   `evaluateCommandRealpathConformance` policy seam that predecessor
>   froze.
> - `ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01` —
>   the Settings UI + proto + state-keys + controller plumbing pattern
>   that this ACT inherits verbatim for the new persisted list key.
> - `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` —
>   the precedent for a *narrowly bounded* additional authority grant
>   that does NOT weaken Seatbelt/hard-deny/realpath.
>
> **Substrate-mode default**: UNCHANGED. A user who never opens the
> Settings UI has `clinemmTemporaryExternalPathAuthorities === []`, so
> the effective path-authority roots are exactly the workspace roots
> they had pre-ACT. **Migration Δ for the absent-key category = 0.**

## §0 — Why this ACT exists

`Auto-approve ALL` (YOLO) under ClineMM's R0 contract currently forces a
human approval for any R0 safe command whose operand lies outside the
workspace, because the canonical
`evaluateCommandRealpathConformance` gate (closed at
`ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01`) restricts
containment to `evidence.roots` (the workspace roots) only.

Operator workflow: the model emits `cat /private/tmp/iCW.out` (a
legitimate, R0-safe read of a file outside the workspace). Pre-ACT, the
operator must click "Approve" once per such command per session, dozens
of times per unattended task. That is real friction on a fully-trusted
host.

Upstream Cline itself warns that auto-approving all tools is appropriate
only in trusted/sandboxed environments because it allows arbitrary
commands/files/network operations.

The escape hatch the operator asked for is **not** "disable path
protection for 24h". The escape hatch this ACT implements is:

> **Temporarily trust specific external filesystem roots for R0
> command auto-approval, expiring automatically within ≤24h.**

That solves `/tmp` (and other external scratch roots) without turning
`Auto-approve ALL` into "the model can silently read anything on my
machine."

## §1 — Contract

```text
TEMPORARY_EXTERNAL_PATH_AUTHORITY (V1)

  User enables a setting: clinemmTemporaryExternalPathAuthorities
    array of TemporaryExternalPathAuthority { path, expiresAt }.
    expiresAt is an absolute ISO-8601 timestamp.

  Persistence semantics:
    - expiresAt is ABSOLUTE. We persist the resolved expiry
      (now + chosenDuration), NOT the duration. Five Codium
      instances all see the same absolute expiry.
    - 24h hard ceiling. CORRECTION01: the UI does not clamp; the
      authoritative host validator (`validateTemporaryExternalPathAuthorities`)
      REJECTS (typed error) any write whose `expiresAt` exceeds
      `now + 24h`. Defense-in-depth: the runtime filter also drops
      persisted entries whose `expiresAt > now + 24h`, so tampered
      state cannot create effective >24h authority.
    - Path must be ABSOLUTE and non-root. CORRECTION02: relative
      paths and `/` are REJECTED. The configured authority identity
      is stable regardless of host process CWD; `/` is forbidden
      because configuring it defeats the bounded escape-hatch
      contract (`workspaceRoots ∪ ["/"]` trivially contains every
      canonical path).
    - No grace period: now >= expiresAt ⇒ the entry is
      INACTIVE, even if stale persisted data remains.
    - No auto-renewal. No "remember indefinitely".

  Filtering contract:
    - The HOST filters expired entries BEFORE handing them to
      the policy. The policy is pure / decision-blind.
    - The HOST realpath-canonicalizes the remaining path via
      fs.realpathSync (closing the symlink-escape attack).

  Policy contract:
    - evaluateCommandRealpathConformance extends its containment
      roots to:
        effectiveRoots = workspaceRoots
                       ∪ temporaryExternalCanonicalRoots
    - All other behavior is unchanged:
        * hard DENY still DENY
        * command classification unchanged
        * Seatbelt unchanged
        * safe-only / all / manual mode semantics unchanged
        * operand-identity binding unchanged
        * realpath-required-for-allow unchanged
    - Decision source remains `host_workspace_realpath_authority`
      when the union contains the operand; no new source string
      needed (the temporary-root membership is a structural
      widening of the SAME authority class).

  UI contract:
    - New section "Temporary External Paths" rendered in the
      existing `sandbox` Settings tab.
    - Per entry: typed input path (NOT canonical) + "expires in Xh Ym"
      countdown for active entries, or "Expired (no authority)" for
      entries whose `expiresAt` is in the past or unparseable.
      [Remove] button always available.
    - A small italic disclaimer clarifies that the host canonicalizes
      the typed path via `fs.realpathSync` before granting authority,
      so symlinks at the configured path resolve to their target.
    - [+ Add path] input + duration radio (1h / 4h / 8h / 24h,
      default 4h; 24h is the hard ceiling).
    - One-click preset: "Allow /private/tmp for 24h" (resolves the
      macOS symlink target so the user does not have to).

  Fail-closed contract:
    - pathAuthorityEvidence undefined  ⇒ ASK (unchanged)
    - resolvedRealPath null            ⇒ ASK (unchanged)
    - realpath ENOENT/EACCES/ELOOP     ⇒ ASK (unchanged)
    - operand identity mismatch        ⇒ ASK (unchanged)
    - any single operand outside the
      union of roots                  ⇒ ASK (the temporary
                                          roots do NOT relax
                                          this; they only widen
                                          the accepted set)
    - temp root fails realpath         ⇒ entry INACTIVE
                                          (filtered before
                                          reaching the policy)

  Authority conservation:
    - The escape hatch NEVER bypasses:
        * explicit hard deny (Step 1 of the authority lattice)
        * Seatbelt enforcement (when selected)
        * sensitive-file protections
        * the command-classification gate
        * realpath verification
    - The escape hatch ONLY extends the set of roots acceptable
      to the existing R0 path-authority check.
```

## §2 — What this ACT will NOT do

Deliberate non-goals (explicit refusal list):

```text
NO  generic "disable workspace path authority" toggle
NO  "ignore R0 path authority" switch
NO  per-command "always trust this external path" cache
NO  "auto-approve ALL external paths"
NO  persistence of relative duration ("24h") — only absolute
    expiresAt
NO  extension beyond 24h (no admin override, no operator override,
    no environment variable override)
NO  symlink escape through a temporary root — the canonical
    realpath is the authority, not the lexical path
NO  read-write escalation in V1 — only path-authority membership
    is granted; the temporary root does NOT authorize write
    commands. (R0 is read-only by definition; an R5 write
    command still requires ASK under safe-only, and Seatbelt
    still enforces the temporary root's write policy per
    `seatbelt-profile.ts` ALREADY granting canonical /tmp
    always-writable subpath.)
NO  cross-instance desync — every Codium instance reads the
    SAME persisted list from the SAME file-backed StateManager
    store under the same profile
NO  widening of network / SSH / sensitive-file authority
NO  bypass of model escalation (`requires_approval: true`
    still ASK)
NO  bypass of session override
```

## §3 — Production seams

| Layer | File | Symbol | Pre-ACT | Post-ACT |
|---|---|---|---|---|
| Policy types | `sdk/.../path-authority-evidence.ts` | `WorkspacePathAuthorityEvidence` | `roots`, `cwd`, `operands` | adds `temporaryExternalCanonicalRoots: ReadonlyArray<string>` |
| Policy types | `sdk/.../command-policy-types.ts` | `CommandHostAuthorization` | no field | adds `temporaryExternalCanonicalRoots` |
| Policy core | `sdk/.../path-authority.ts` | `evaluateCommandRealpathConformance` | containment via `evidence.roots` only | containment via `evidence.roots ∪ temporaryExternalCanonicalRoots` |
| Evidence builder | `sdk/.../path-authority-evidence-builder.ts` | `BuildPathEvidenceOptions` | no field | accepts `temporaryExternalCanonicalRoots` (already-filtered, already-canonical) |
| SDK index | `sdk/.../index.ts`, `sdk/packages/core/src/index.ts` | re-exports | (no new exports) | re-export `TemporaryExternalPathAuthority`, `temporaryExternalCanonicalRoots` |
| Settings schema | `apps/vscode/src/shared/storage/state-keys.ts` | `USER_SETTINGS_FIELDS` | (absent) | `clinemmTemporaryExternalPathAuthorities: { default: [] }` |
| Proto | `apps/vscode/proto/cline/state.proto` | `UpdateSettingsRequest`, `Settings` | (absent) | new field; manual regen note (per SETTINGS-SANDBOX precedent) |
| Wire shape | `apps/vscode/src/shared/ExtensionMessage.ts` | `ExtensionState` | (no field) | optional `clinemmTemporaryExternalPathAuthorities?: TemporaryExternalPathAuthority[]` |
| Webview defaults | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` | initial state | (no field) | `clinemmTemporaryExternalPathAuthorities: []` |
| Settings write (UI) | `apps/vscode/src/core/controller/state/updateSettings.ts` | `updateSettings` | (no branch) | explicit branch: replace entire list |
| Settings write (CLI) | `apps/vscode/src/core/controller/state/updateSettingsCli.ts` | `updateSettingsCli` | (no branch) | destructured + dedicated handler |
| State projection | `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts` | `getStateToPostToWebview` | (no field) | projected to ExtensionState |
| Host binding | `apps/vscode/src/sdk/SdkController.ts` | `buildPathAuthorityEvidence` | reads workspace roots only | reads `clinemmTemporaryExternalPathAuthorities`, filters expired (now >= expiresAt), realpath-canonicalizes remaining paths, threads into evidence |
| UI | `apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.tsx` | (new) | (absent) | new section, rendered in `sandbox` tab alongside `SandboxCapabilitiesSection` |
| UI test | `apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.spec.tsx` | (new) | (absent) | 6/6 PASS under vitest |

## §4 — Required conservation matrix (mechanically testable)

| Case | Expected result | Source |
|---|---|---|
| `/private/tmp/x`, exception active | ALLOW (via `host_workspace_realpath_authority`) | unit |
| `/private/tmp/x`, exception expired | ASK | unit |
| `/private/tmp/x`, exception removed | ASK | unit |
| `/tmp/x` lexical → `/private/tmp/x` canonical | ALLOW | unit |
| `/private/tmp/a/../x` | canonical containment (resolves to `/private/tmp/x`) | unit |
| symlink `/private/tmp/x → ~/.ssh/id_rsa` | **ASK** (canonical realpath is `~/.ssh/id_rsa`, not in temp roots) | unit + live |
| other path outside workspace + temp roots | ASK | unit |
| workspace path | existing behavior unchanged | unit |
| hard-denied command inside temp root | DENY | unit |
| SAFE_ONLY + known-safe read | existing policy + temp root | unit |
| unknown command | temp root alone gives NO authority | unit |
| Seatbelt enabled | no change to approval semantics besides existing contract | unit |
| Seatbelt disabled | no change | unit |
| 5 instances read same persisted list | same effective authority | integration |
| one instance expires an entry | other 4 instances see the entry inactive on next policy evaluation | integration |
| clock jumps backward by 1h | persisted entries remain active; absolute timestamps unaffected (no monotonic-clock infra) | unit |
| clock jumps forward past an expiry | entry becomes inactive on next policy evaluation | unit |

## §5 — RED-first plan

### R1 — RED at the policy seam

`apps/vscode/src/sdk/__tests__/seatbelt-all-temporary-external-path-authority01.c1-red.test.ts`:

```ts
// RED: today, /private/tmp/iCW.out ASK with override=ALL because
// the temp exception is not yet wired through.
override = ALL
command = "/usr/bin/cat /private/tmp/iCW.out"
temp root = "/private/tmp"
expiresAt = now + 1h
expected = ALLOW  (RED — currently ASK)
```

### R1-green — Same test, post-implementation

```ts
// Same input, now produces ALLOW because:
//   1. host-safe-cat rule matches the rendered shape (lexical rule)
//   2. host-built evidence contains:
//        roots = [workspaceRoot]
//        temporaryExternalCanonicalRoots = ["/private/tmp"]
//      (realpath-canonicalized from user input)
//   3. evaluateCommandRealpathConformance unions the two:
//        effectiveRoots = [workspaceRoot, "/private/tmp"]
//   4. operand realpath is "/private/tmp/iCW.out" ∈ effectiveRoots
//   5. authority lattice resolves to ALLOW.
```

### R2..R6 — Conservation REDs (each becomes GREEN)

Each row of §4 maps to one focused test under
`path-authority-evidence-builder.test.ts` (HOST seam) and
`path-authority.realpath.test.ts` (POLICY seam), mirroring the structure
of the CORRECTION01/02 matrix.

### R7 — UI spec (vitest under webview-ui)

`TemporaryExternalPathsSection.spec.tsx` covers:

- empty state renders the add-path prompt
- adding a path + duration 4h persists `expiresAt ≈ now + 4h`
- adding a path + duration 24h is the ceiling (no >24h option in UI)
- 1h / 4h / 8h / 24h radios all produce absolute expiresAt
- removing an entry calls updateSetting with the array minus that path
- "Allow /private/tmp for 24h" preset resolves the system temp root
  before storing
- expired entries (manually injected via prop override) are NOT
  rendered as active

### R8 — Production-seam binding (mirrors SETTINGS-SANDBOX precedent)

`apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts`:

Builds the real `SdkController` (or the smallest faithful seam) and
verifies that `buildPathAuthorityEvidence` produces an evidence object
whose `temporaryExternalCanonicalRoots` matches the persisted list
filtered by `now >= expiresAt`.

Ablation matrix:

```text
no entries               → temporaryExternalCanonicalRoots = []
2 entries, 1 expired     → temporaryExternalCanonicalRoots = [the active one]
2 entries, both active   → temporaryExternalCanonicalRoots = [both]
path with leading /tmp/  → canonicalizes to /private/tmp/
symlink chain            → canonicalizes to chain target (out of root)
non-existent path        → entry filtered out as inactive
```

## §6 — Validation gates (final)

```text
- bun run check-types  (apps/vscode + apps/cli + sdk/core) → EXIT 0
- bun run lint         → clean
- @cline/core unit       → 538 PASS pre + 5 NEW (R1..R5) → 543 PASS
- @cline/core command-policy/path-authority → all PASS
- apps/cli command-policy-host tests → all PASS
- apps/vscode sdk-tool-policies → all PASS
- apps/vscode sdk/__tests__/temporary-external-path-authority01.* → PASS
- webview-ui vitest TemporaryExternalPathsSection.spec.tsx → 6/6 PASS
- bun run protos        → EXIT 0 (proto regen if state.proto touched)
- bun run build:sdk     → EXIT 0 (so CLI + downstream see the new exports)
- git diff --check      → silent
```

## §7 — Files touched (anticipated)

```text
sdk/packages/core/src/runtime/command-policy/path-authority-evidence.ts
sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts
sdk/packages/core/src/runtime/command-policy/path-authority.ts
sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
sdk/packages/core/src/runtime/command-policy/index.ts
sdk/packages/core/src/index.ts

sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.test.ts (new tests)
sdk/packages/core/src/runtime/command-policy/path-authority.realpath.test.ts (new tests)

apps/vscode/src/shared/storage/state-keys.ts
apps/vscode/proto/cline/state.proto
apps/vscode/src/shared/ExtensionMessage.ts
apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
apps/vscode/src/core/controller/state/updateSettings.ts
apps/vscode/src/core/controller/state/updateSettingsCli.ts
apps/vscode/src/core/controller/state/getStateToPostToWebview.ts
apps/vscode/src/sdk/SdkController.ts (buildPathAuthorityEvidence extension)

apps/vscode/webview-ui/src/components/settings/SettingsView.tsx
apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.tsx (NEW)
apps/vscode/webview-ui/src/components/settings/sections/TemporaryExternalPathsSection.spec.tsx (NEW)

apps/vscode/src/sdk/__tests__/seatbelt-all-temporary-external-path-authority01.c1-red.test.ts (NEW)
apps/vscode/src/sdk/__tests__/temporary-external-path-authority01.c2-production-seam.test.ts (NEW)

docs/closure-plans/ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01.json (NEW)
.factory/epic-board.md (single row update)
```

## §8 — Default-authority conservation (MIGRATION_OR_DEFAULT_AUTHORITY_DELTA)

```text
ABSENT legacy key  → persisted list = []
                  → host filters expired = []
                  → host realpath-canonicalizes empty list = []
                  → evidence.temporaryExternalCanonicalRoots = []
                  → effectiveRoots = workspaceRoots ∪ []
                  → effectiveRoots = workspaceRoots
                  → IDENTICAL to pre-ACT
MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0

EXPLICIT persisted entry
                  → host filters expired (drops entries where now >= expiresAt)
                  → host realpath-canonicalizes each surviving entry
                  → drops entries whose canonical path is empty (realpath failure)
                  → evidence.temporaryExternalCanonicalRoots = [canonical paths]
                  → effectiveRoots = workspaceRoots ∪ [canonical paths]
                  → INTENTIONAL RELAXATION (user opted in)
```

§8 is the load-bearing property. A user who has never opened the
Settings UI gets the EXACT pre-ACT runtime selection in every
branch. The escape hatch is strictly opt-in.

## §9 — Authority precedence preservation

```text
hard DENY           → still DENY    (Step 1 unchanged)
host_mode_manual    → still ASK     (mode unchanged)
explicitDenyRules   → still matches (unchanged)
realpath gate       → now accepts a wider set of canonical roots
                      (this ACT)
safe-only policy    → unchanged (the temporary roots do NOT
                      classify commands as safe; the existing
                      lexical safe-rule + R0 path-authority
                      composition is preserved)
host mode "all"     → still projects through the same authority
                      lattice
Seatbelt            → unchanged (Seatbelt enforces its own
                      filesystem profile independently of the
                      policy's authority verdict; the temporary
                      roots do NOT alter the seatbelt profile)
sensitive files     → still rejected (the temporary-root list is
                      a separate authority class; sensitive-file
                      deny is a separate authority class)
```

The temporary-root setting never overrides a more-restrictive step;
it only widens the path-authority containment set in Step R0.

## §10 — Why a settings array (not an env var)

- An env var (`CLINEMM_ALLOW_EXTERNAL_ROOT=...`) leaks into shell
  evaluation surfaces (subprocesses, mktemp helpers, etc.) and
  crosses the security boundary by being a string the user can
  accidentally commit. A persisted Settings key is scoped to the
  Cline-- extension's StateManager (file-backed, scope=user or
  workspace, NOT inherited by shell subprocesses).
- A settings array lets the UI show countdown timers and lets the
  model surface the current effective authority in diagnostics.
- An array of `{path, expiresAt}` is the minimum shape that
  guarantees cross-instance consistency (absolute timestamp, not
  relative duration).

## §11 — Cross-instance behavior (CORRECTION03)

**CORRECTION02's chokidar-watcher mechanism is REMOVED.** The
correct mechanism is to **fresh-read the authority at the decision
boundary** — i.e., the consumer pipeline reads the persisted key
DIRECTLY from the backing JSON file every time
`evaluateCommandToolApproval` needs the active temp-root set. The
StateManager cache is never consulted for this key.

### Mechanism

1. `SdkController.resolveActiveTemporaryExternalCanonicalRoots()`
   resolves the backing file path via the StorageContext
   (`getStorageDataDir()` + `globalState.json`).
2. It calls `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`
   in `@shared/storage/temporaryExternalPathAuthorities`. That
   function:
   - reads the backing JSON file via `fs.readFileSync`,
   - extracts the `clinemmTemporaryExternalPathAuthorities` key,
   - runs it through `filterActiveTemporaryExternalPathEntries`
     (drops expired + drops >24h),
   - realpath-canonicalizes the survivors.
3. The returned canonical paths are threaded into
   `buildPathAuthorityEvidence(..., temporaryExternalCanonicalRoots)`.
4. The V1 belt-and-suspenders re-test in the policy layer uses the
   same set.

### Properties (no longer theoretical)

- **No watcher.** No chokidar.
- **No debounce.**
- **No event attribution.** Chronology is not causal identity.
- **No time-based self-write heuristic.**
- **No cross-instance cache-coherence protocol.**
- **Every instance independently filters expired entries against
  its own `Date.now()`** (the active-set definition is local-time
  per the 24h ceiling invariant).

### Why the new wiring is correct

The previous CORRECTION02 chokidar + 1s-tolerance-suppression
mechanism had a structural defect: a 1-second timestamp window is
chronology, not causal identity, so a real external write that
arrived within the suppression window would be DROPPED, leaving
instance A with stale authority. The fresh-read model has no such
defect because there is no chronology to get wrong — at the moment
of evaluation, whatever is on disk is what the policy sees,
regardless of which instance wrote it, when, or whether anyone
flushed a cache.

The factory reviewer's exact words:

> A timestamp window cannot identify "my write."
>
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

That is precisely what the CORRECTION03 implementation does.

## §12 — Out-of-band risk review

The operator's exact words: "Add a temporary escape hatch so
unattended tasks can use external temp artifacts without
babysitting. Keep R0 default intact; add an explicit, expiring
external-path exception with a hard 24h ceiling; scope it narrowly
and preserve Seatbelt/hard-deny authority."

This ACT delivers exactly that. The hard-deny authority is
unchanged (§9). Seatbelt is unchanged (§9). R0 default is intact
when no entry is persisted (§8: MIGRATION_OR_DEFAULT_AUTHORITY_DELTA
= 0). The escape hatch is bounded, explicit, expiring, and scoped
to canonical realpaths (closing the symlink escape).

## §13 — Reviewer halt conditions

The ACT HALT if any of the following becomes true at the reviewer
gate:

```text
P0  any pre-ACT ASK verdict becomes a post-ACT ALLOW when the
    user has not enabled any temporary external path
P0  hard DENY verdict becomes ALLOW for a command that uses a
    temporary external root operand
P0  /tmp/iCW.out ALLOW without a realpath-canonicalized entry
P0  cross-instance divergence: two instances see different
    authority for the same persisted state
P1  UI fails to filter stale entries (UI shows active when
    authority is inactive)
P1  24h ceiling not enforced on write (entry with expiresAt >
    now + 24h accepted)
P1  symlink at a temporary-root path escapes containment
P2  countdown label drifts by > 60s from real expiry
P2  default duration is 24h (must be shorter)
```

## §14 — Closure

This ACT closes when:

1. All §6 gates PASS.
2. The closure-plan JSON
   `docs/closure-plans/ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01.json`
   is committed with the exact file list and stage statuses.
3. The board row is committed (not just present in working tree).

Nothing more. Do not pre-stage the downstream ACT.

## §15 — Closure identity (post-commit)

The terminal HEAD of this ACT is the **parent closure body commit** that
lands alongside the already-committed `08f004a7` CORRECTION05 commit. That
body commit lands:

- the parent ACT + CORRECTION01–04 documentation,
- the parent + CORRECTION01–04 implementation that `08f004a7` already
  presumes (`temporaryExternalCanonicalRoots`,
  `buildPathAuthorityEvidence(..., activeTempRoots)`,
  `getStorageDataDir()`, the write-time validator wiring, the
  `temporaryExternalPathAuthorities` host validator, the fresh-read
  backing-store authority, the Settings UI, the conservation suite, and
  the closure-plan JSON).

To avoid baking a future SHA into the staged content, the exact commit
hash of the closure body is recorded in a **tiny follow-up closure-identity
commit** that updates only this paragraph (and the matching
`docs/closure-plans/ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01.json`
SHA field, if the schema supports it). The two-commit shape preserves
the actual implementation body as a single, reviewable unit and isolates
the SHA bookkeeping.

`FINAL_IMPLEMENTATION_HEAD = 08f004a7f25fcf3e14051e94dc6254919e94710e + ad8f3094c6d2c1c1a5d134cc9738067aeb417345`
`FINAL_STATUS            = PASS_TEMPORARY_EXTERNAL_PATH_AUTHORITY_V5`
`WORKTREE                = CLEAN`
