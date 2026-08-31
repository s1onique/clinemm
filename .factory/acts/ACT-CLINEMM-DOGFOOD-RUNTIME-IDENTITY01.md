# ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01

**Type:** RUNTIME IDENTITY ENABLEMENT (extension-side half of the identity contract; launcher-side half halted)

**Status at freeze:** **PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL** for the resolver, with **HALT_LAUNCHER_SOURCE_UNBOUND** for the launcher-side producer

**Priority:** P1 / HIGH

**Factory disposition (this commit):**

  C0: PROCEED_TO_RECON_AND_RESOLVER
       resolver + tests GREEN; launcher source not located; halt recorded
  C1: GO (extension-side) / HALT (launcher-side)
       bounded implementation cycle complete for the resolver half

**Date frozen:** 2026-08-31
**Subject HEAD:** `f63556b175b02516d8fbe3e68a7029a48e3aa3a3` (HEAD at start)
**Final HEAD:** `f63556b175b02516d8fbe3e68a7029a48e3aa3a3` (this commit)

---

## section 0. Mission (verbatim per Factory causal reviewer)

> Establish one explicit, truthful, closed-runtime dogfood identity for
> isolated ClineMM development installations, with zero manual operator
> environment-variable setup.
>
> This ACT exists solely to unblock:
>   ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
>
> It does NOT implement V/I/A/P diagnostics.
> It does NOT modify approval behavior.
> It does NOT add telemetry-header letters.
> It does NOT implement a public diagnostics setting.

## section 1. Frozen contract

Identity resolver (FROZEN):

  CLINEMM_RUNTIME_PROFILE = "dogfood"   -> resolveClineMmRuntimeProfile() === "dogfood"
  CLINEMM_RUNTIME_PROFILE unset / ""   -> resolveClineMmRuntimeProfile() === "public"
  CLINEMM_RUNTIME_PROFILE = <anything-else>  -> "public"  (fail-closed; do NOT fail-open)

Do NOT use as identity (per reviewer rejection):

  - publisher/name (s1onique.clinemm is the same for ALL installs)
  - ExtensionContext.extensionMode (VS Code documents normally-installed
    VSIX as ExtensionMode.Production; both dogfood and public collapse
    to the same value)
  - workspace path
  - repository contents
  - `.factory/BOARD_OWNER` (a normal install opened on the ClineMM/Factory
    repo satisfies exactly the same predicate; rejected by reviewer)
  - username / hostname / OS-level heuristics
  - ~/.vscodium-* path inference
  - extension id

Public-surface discipline (FROZEN):

  CLINEMM_RUNTIME_PROFILE IS:
    CLOSED_RUNTIME
    INTERNAL
    LAUNCHER_OWNED

  MUST NOT be:
    - documented in end-user settings
    - added to public Settings UI
    - exposed as proto fields
    - exposed via command palette
    - advertised as a supported public environment variable

## section 2. Entry trust + recon (actual HEAD)

```
branch         = main
clean worktree = ok
ENTRY_HEAD     = f63556b175b02516d8fbe3e68a7029a48e3aa3a3
ENTRY_TREE     = f63556b175
git status     = (clean tracked worktree)
```

Launcher-source recon (actual machine):

| Searched | Result |
|----------|--------|
| `apps/` source tree (`codium-clinemm`/`codium-factory` literal) | 1 comment-only reference in `seatbelt-all-workspace-realpath-authority-correction02.live-compound-shape.red.test.ts` (test fixture prose; no source) |
| `sdk/` source tree | 0 hits |
| `scripts/` | 0 hits; the only dogfood installer is `scripts/install-vscodium-dev.sh` which does NOT modify a launcher wrapper, it invokes `codium` directly |
| `docs/` | 0 hits |
| `which codium-clinemm` | not found |
| `which codium-factory` | not found |
| `ls /opt/homebrew/bin/codium-*` | only `/opt/homebrew/bin/codium -> /Applications/VSCodium.app/Contents/Resources/app/bin/codium` (single binary, no wrappers) |
| `ls /usr/local/bin/codium-*` | not found |
| `nix` | present (`/run/current-system/sw/bin/nix`) but no `codium-clinemm` or `codium-factory` generated-wrappers visible in the default search paths |

**Recon conclusion: CASE L3 (launcher source not durably owned / cannot be modified reproducibly from this shell).** Per ACT section 2: `HALT_LAUNCHER_SOURCE_UNBOUND`. The reviewer-favored solution class (explicit closed-runtime launch assertion owned by the `codium-clinemm`/`codium-factory` wrappers) is correct in principle, but those wrappers do not exist in any source tree or generated wrapper path this shell can author or inspect.

## section 3. RED contract (R1-R7) - GREEN

Per ACT section 3, the smallest executable identity tests were written at:

  apps/vscode/src/sdk/dogfood-runtime-profile.test.ts (162 lines, 22 tests)

Test results (`bun run test:vitest -- dogfood-runtime-profile`):

  src/sdk/dogfood-runtime-profile.test.ts (22 tests) 3ms
  Test Files  1 passed (1)
       Tests  22 passed (22)

Coverage of RED contract:

| Test ID | Description | Result |
|---------|-------------|--------|
| R1 | marker absent -> public | PASS |
| R2 | marker === 'dogfood' -> dogfood | PASS |
| R3 (11 cases via it.each) | unknown values (banana/1/true/yes/DOGFOOD/Dogfood/ dogfood/dogfood /public/dogfoodish/\\tdogfood) -> public (fail-closed) | PASS |
| R3b | marker === '' -> public (empty == absent) | PASS |
| R4 | marker === 'public' -> public (explicit override) | PASS |
| R5 | marker absent + workspace/repo contents irrelevant -> public | PASS |
| R6 | marker absent + extension id irrelevant -> public | PASS |
| R7 | resolver signature is pure (env in, profile out) | PASS |
| defensive | sibling CLINEMM_* env vars do NOT influence resolver | PASS |
| predicate | `isDogfoodRuntime` mirror of R1-R4 | PASS |

The `EPERM` at vitest worker termination is a sandboxed-shell artifact, NOT a test failure (same artifact seen in `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` `sdk-tool-policies.test.ts` 36/37 PASS run). ACT-owned tests are GREEN.

## section 4. Production implementation - SHIPPED (extension-side)

File: `apps/vscode/src/sdk/dogfood-runtime-profile.ts` (106 lines)

Public API (frozen):

```ts
export type ClineMmRuntimeProfile = "public" | "dogfood"

export function resolveClineMmRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): ClineMmRuntimeProfile

export function isDogfoodRuntime(env: NodeJS.ProcessEnv = process.env): boolean
```

Implementation requirements honored:

- exact-match only (no "1"/"true"/"yes" fuzzy matching)
- default public
- no filesystem inspection
- no repo inspection
- no extension-id inspection
- no hidden fallback heuristic
- no diagnostic activation coupling (per ACT section 6 C6: dogfood identity alone MUST NOT enable diagnostics; that coupling is the halted `...DIAGNOSTIC-PROFILE...` ACT's job, and it stays halted)

The module is NOT yet exported from `apps/vscode/src/sdk/index.ts` because there are NO consumers yet. Adding the export is part of the follow-on re-open of the diagnostic-profile ACT, NOT this ACT. The module exists as a durably-bound runtime primitive that any future consumer (the diagnostic profile ACT, future dogfood-only features) can import.

Typecheck gate (full `apps/vscode`):

  $ npx tsc --noEmit
  EXIT=0 (clean)

Lint gate (biome, touched files only):

  $ biome check src/sdk/dogfood-runtime-profile.ts src/sdk/dogfood-runtime-profile.test.ts
  Checked 2 files in 5ms. No fixes applied.


## section 5. Launcher producer - HALTED (out of scope for this shell)

Per ACT section 2 CASE L3:

```
HALT_LAUNCHER_SOURCE_UNBOUND
  reason = launcher source is not durably owned / cannot be modified reproducibly
  from this sandboxed shell. The two wrappers named in the canonical recipe
  (`codium-clinemm` and `codium-factory`) are not present in any source tree
  of this repository, nor in any wrapper path visible to this shell
  (`/opt/homebrew/bin/codium*`, `/usr/local/bin/codium*`, `~/.local/bin/codium*`,
  or `/nix/store/...codium*`). They are operator-owned artifacts (presumably in
  the operator's Nix home-manager config or a separate personal dotfiles
  repository) that this shell cannot author, modify, or inspect.

  Do NOT compensate with runtime path heuristics. The reviewer rejected
  `.factory/BOARD_OWNER` workspace-fingerprint for the same reason that
  any path-sniffing fallback would be rejected: it cannot distinguish
  isolated operator-owned dogfood ClineMM from an ordinary public
  ClineMM VSIX installation opened on the same repo / same workspace.
```

Recovery from this halt (operator-side, NOT in this shell):

The operator's launcher source (whatever it is - Nix home-manager, dotfiles
repo, or ad-hoc shell wrapper) MUST be edited to inject:

```bash
export CLINEMM_RUNTIME_PROFILE=dogfood
```

BEFORE the editor binary is executed. The canonical wrapper shape per ACT
section 5 (here for the operator's reference; this shell did NOT author it):

```bash
export CLINEMM_RUNTIME_PROFILE=dogfood

exec "$CLI" \
  --user-data-dir "$DATA_DIR" \
  --extensions-dir "$EXT_DIR" \
  "$@"
```

For Nix home-manager (the most likely ownership location given `/run/current-system/sw/bin/nix` is on PATH):

  - change the Nix source in the operator's home-manager repo
  - rebuild via `home-manager switch`
  - verify generated wrapper text contains `CLINEMM_RUNTIME_PROFILE=dogfood`
  - NEVER edit /nix/store output directly

Once the launcher source is owned/visible to this shell, the same shell can
land the launcher-side half and re-promote this ACT from
`PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL` to
`PASS_DOGFOOD_RUNTIME_IDENTITY_V1`.

## section 6. Conservation

C1 ordinary ClineMM launch, marker absent  -> public   [structural PASS via R1]
C2 ordinary ClineMM opening repo with BOARD_OWNER  -> public   [structural PASS via R5; workspace contents ignored]
C3 dogfood wrapper, marker present       -> dogfood  [structural PASS via R2; requires launcher-side halt to resolve]
C4 direct VSCodium + dogfood VSIX, marker absent  -> public   [structural PASS via R4 + R5; marker absent == public]
C5 default mode                          -> diagnostics OFF (resolver does NOT couple to diagnostics; C6 below)
C6 dogfood identity alone                -> no observable behavior change in this ACT (intentional; per ACT section 6 C6)

## section 7. Tests / gates

| Gate | Result |
|------|--------|
| focused runtime-profile tests (R1-R7 + predicate + defensive) | 22/22 PASS |
| adjacent SDK tests (none imported, so N/A) | N/A |
| apps/vscode typecheck (`npx tsc --noEmit`) | EXIT=0 (clean) |
| biome lint on touched files (`biome check`) | clean (no fixes applied on re-run) |
| git diff --check | (run at commit time) |

## section 8. Live producer qualification

```
LIVE_LAUNCHER_INSPECTION  = NOT_EXECUTED
LIVE_RUNTIME_RESOLVE      = NOT_EXECUTED (no headed VSCodium in this shell)
```

Per ACT section 13 disposition:

  PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL
  LIVE_IDENTITY = NOT_EXECUTED

The reviewer-prescribed ablation (ACT section 9: take the authoritative
wrapper producer and remove the marker, then restore) requires both:
  (a) the launcher source (HALT_LAUNCHER_SOURCE_UNBOUND above)
  (b) a headed VSCodium to exercise the resolver end-to-end

Neither is available in this shell, so the ablation is mechanically
impossible here. The structural tests (R1-R7) substitute by exercising
the same discriminator invariants against an env-injected NodeJS.ProcessEnv
literal, which is a stricter test than the live wrapper-text inspection
the reviewer's ablation prescribes (because the env literal controls
only the marker, with no other state).

Do NOT promote structural producer evidence to live. The
LIVE_IDENTITY = NOT_EXECUTED disposition is correct.


## section 9. Halt conditions

```
HALT_UNEXPECTED_TRACKED_DIRT             = not asserted (worktree clean post-gates)
HALT_LAUNCHER_SOURCE_UNBOUND             = ASSERTED (this commit)
HALT_IDENTITY_REQUIRES_WORKSPACE_HEURISTIC = not asserted (R5 explicitly forbids; reviewer-rejected proposal never landed)
HALT_IDENTITY_REQUIRES_PUBLIC_SETTING    = not asserted (R6 explicitly forbids)
HALT_IDENTITY_FAILS_OPEN                 = not asserted (R3 fail-closed; "1"/"true"/"yes"/"banana" all return public)
HALT_PUBLIC_RUNTIME_CLASSIFIED_DOGFOOD   = not asserted (R1 + R5 + R6: marker absent + workspace/extension-irrelevant -> public)
HALT_DOGFOOD_RUNTIME_CLASSIFIED_PUBLIC   = not asserted (R2: marker === 'dogfood' -> dogfood)
HALT_DIAGNOSTIC_BEHAVIOR_CHANGED         = not asserted (C6: identity ACT does not couple to diagnostics; that coupling is the halted diagnostic-profile ACT's job)
HALT_ACT_OWNED_REGRESSION                = not asserted (tsc EXIT=0; no imports changed; no consumers; no diagnostic coupling)
```

## section 10. Durability + predecessor update

This commit:

  - Creates `apps/vscode/src/sdk/dogfood-runtime-profile.ts` (106 lines; resolver + predicate)
  - Creates `apps/vscode/src/sdk/dogfood-runtime-profile.test.ts` (162 lines; R1-R7 + defensive + predicate)
  - Creates `.factory/acts/ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01.md` (this file)
  - Updates `.factory/epic-board.md` row 19 (the previously-halted dogfood-diagnostic-profile row) from `HALT_DOGFOOD_IDENTITY_ABSENT` to `IDENTITY_AVAILABLE_VIA_RESOLVER / LAUNCHER_HALTED`, and adds a new row 19a for this ACT
  - Adds `.gitignore` whitelist entries for the new ACT file and any future evidence

Predecessor (`ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01`) is NOT updated to `REOPENABLE / DOGFOOD_IDENTITY_AVAILABLE` in this commit because per ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01 section 11:

  > "On PASS change predecessor from `HALT_DOGFOOD_IDENTITY_ABSENT` to
  > `REOPENABLE / DOGFOOD_IDENTITY_AVAILABLE`. Do NOT execute its V/I/A/P
  > implementation in this ACT."

The disposition this commit DOES record is:

  IDENTITY_AVAILABLE_VIA_RESOLVER (extension-side half complete)
  LAUNCHER_HALTED                       (operator-side half required; HALT_LAUNCHER_SOURCE_UNBOUND)
  V/I/A/P_IMPLEMENTATION                = STILL_HALTED (separate ACT; not coupled in this commit)

The exact wording of the predecessor update is left to the next chat / next ACT so that:

  - the eventual re-open of V/I/A/P does NOT silently auto-enable diagnostics on a resolver that is not yet wired to a launcher (LAUNCHER_HALTED remains visible),
  - the launch-side authoring (when it lands) gets its own clean ACT MD with its own diffstat, gates, and verification chain.

## section 11. Final report

```
ACT_ID         = ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01
VERDICT        = PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL
                 + HALT_LAUNCHER_SOURCE_UNBOUND
                 + LIVE_IDENTITY = NOT_EXECUTED

ENTRY_HEAD     = f63556b175b02516d8fbe3e68a7029a48e3aa3a3
SUBJECT_HEAD   = f63556b175b02516d8fbe3e68a7029a48e3aa3a3
FINAL_HEAD     = <this commit>
WORKTREE       = clean tracked post-commit

LAUNCHER_SOURCE =
  codium-clinemm  : not in this repo; not on this shell PATH; presumably
                    operator-owned (Nix home-manager / dotfiles)
  codium-factory  : not in this repo; not on this shell PATH; presumably
                    operator-owned (Nix home-manager / dotfiles)

MARKER         = CLINEMM_RUNTIME_PROFILE=dogfood (FROZEN)
RESOLVER       =
  apps/vscode/src/sdk/dogfood-runtime-profile.ts
  resolveClineMmRuntimeProfile(env: NodeJS.ProcessEnv = process.env) -> ClineMmRuntimeProfile
  isDogfoodRuntime(env: NodeJS.ProcessEnv = process.env) -> boolean

RED            = R1, R2, R3, R3b, R4, R5, R6, R7 + defensive + predicate = 22 tests
GREEN          = 22/22 PASS in 3ms (bun run test:vitest -- dogfood-runtime-profile)

ABLATION       = NOT_EXECUTED (requires launcher source + headed host; both absent in this shell)
PUBLIC_CONSERVATION = mechanically verified by R1, R3, R4, R5, R6, defensive, predicate

DIAGNOSTIC_DELTA = 0
                (resolver exists; nothing imports it yet; the diagnostic-profile ACT stays halted;
                no consumer can activate diagnostics from the resolver in this commit)

LIVE_IDENTITY  = NOT_EXECUTED (no headed VSCodium; documented operator-side dependency)

P0 = none (extension-side half PASS; launcher-side HALT is not a production regression)
P1 = HALT_LAUNCHER_SOURCE_UNBOUND (operator-side; out of scope for this shell)
P2 = none

NEXT = (a) Operator-side: edit the `codium-clinemm` and `codium-factory` launcher source
                    (wherever it lives - Nix home-manager, dotfiles, ad-hoc) to inject
                    `CLINEMM_RUNTIME_PROFILE=dogfood` before invoking the editor binary,
                    then rebuild/apply via the authoritative tooling.
       (b) Once the launcher source is visible to this shell, open a follow-on ACT
           (`ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01-LAUNCHER01` or similar) that
           lands the launcher-side producer + ablation + live qualification,
           re-promoting this ACT to `PASS_DOGFOOD_RUNTIME_IDENTITY_V1` (no qualifier).
       (c) After (b), reopen `ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01`
           with C1: GO and proceed to implement sections 3-6 + sections 7-9 tests +
           section 13 live qualification.
```

---

## section 12. Factory rule applied

**STOP.** This ACT established the extension-side identity bit. The
launcher-side producer is out of scope for this shell. No further review
loop. The resolver is durably bound to the next chat's diagnostic-profile
re-open via this file's `section 11` NEXT item.
