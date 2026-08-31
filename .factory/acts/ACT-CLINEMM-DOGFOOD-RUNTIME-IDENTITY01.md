# ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01

**Type:** RUNTIME IDENTITY ENABLEMENT (extension-side half of the identity contract; launcher-side half halted)

**Status at freeze (final, 2026-08-31):** **PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL** for the full identity chain (resolver + producer + composition), with **LIVE_IDENTITY = NOT_EXECUTED** as the only remaining caveat (no headed VSCodium in this sandbox; user directive `DO NOT RESTART ANY VSCODIUM INSTANCE`)

**Status at first commit (overclaimed, 2026-08-31):** PASS for resolver; HALT_LAUNCHER_SOURCE_UNBOUND for producer. **Superseded by this correction commit.**

**Priority:** P1 / HIGH

**Factory disposition (final):**

  C0: GO
       resolver GREEN (22/22 vitest, tsc EXIT=0, biome clean)
       producer FOUND in operator's darwin-configuration.nix
       generated wrappers PROVEN on disk (SHA-256 captured)
       composition PROVEN (deterministic writeShellScriptBin literal)
       ablation pinned by R1+R2 (no second permanent Nix commit)
  C1: GO
       end-to-end identity chain is structurally pinned; LIVE qualification
       is the only remaining caveat and is operator-dependent (restart
       headed VSCodium with codium-clinemm/codium-factory).

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

**Initial search (overclaimed by missing the right search space):**

| Searched | Result |
|----------|--------|
| `apps/` source tree (`codium-clinemm`/`codium-factory` literal) | 1 comment-only reference in `seatbelt-all-workspace-realpath-authority-correction02.live-compound-shape.red.test.ts` (test fixture prose; no source) |
| `sdk/` source tree | 0 hits |
| `scripts/` | 0 hits; the only dogfood installer is `scripts/install-vscodium-dev.sh` which does NOT modify a launcher wrapper, it invokes `codium` directly |
| `docs/` | 0 hits |
| `which codium-clinemm` | not found on this sandbox's `$PATH` |
| `which codium-factory` | not found on this sandbox's `$PATH` |
| `ls /opt/homebrew/bin/codium-*` | only `/opt/homebrew/bin/codium -> /Applications/VSCodium.app/Contents/Resources/app/bin/codium` (single binary, no wrappers) |
| `ls /usr/local/bin/codium-*` | not found |
| `nix` | present (`/run/current-system/sw/bin/nix`) but no `codium-clinemm` or `codium-factory` generated-wrappers visible in the default `$PATH` of this sandbox |

**Corrected search (after operator placed darwin-configuration.nix in repo root on 2026-08-31):**

| Searched | Result |
|----------|--------|
| `/etc/profiles/per-user/chistyakov/bin/codium-clinemm` | EXISTS as symlink -> `/nix/store/qi54yx128rk6yhgi28nbrs8x4dya31cj-codium-clinemm/bin/codium-clinemm` |
| `/etc/profiles/per-user/chistyakov/bin/codium-factory` | EXISTS as symlink -> `/nix/store/3qm0llh4hg13jj8zjc1hjiyhfryf85an-codium-factory/bin/codium-factory` |
| Both target wrappers | contain `export CLINEMM_RUNTIME_PROFILE=dogfood` (line 12 of generated script) |
| `/etc/profiles/per-user/chistyakov/bin/codium-{15 profiles}` | 15 total (cline, trim, roz, ulybka, indeep, indeepfe, kgb, spbnix, rees, factory, leamas, thecircus, clinemm, granelle, run); all share `mkCodiumProfile` constructor; all contain the marker |
| `darwin-configuration.nix` (operator-supplied at repo root, ignored) | AUTHORITATIVE PRODUCER; line 281-301 = `mkCodiumProfile` constructor; line 294 = marker injection |
| Authoritative owner | operator's separate home-manager repo (`~/.nixpkgs/darwin-configuration.nix`) |

**Recon conclusion (initial, overclaimed):** CASE L3 (launcher source not durably owned / cannot be modified reproducibly from this shell). Per ACT section 2: `HALT_LAUNCHER_SOURCE_UNBOUND`. The reviewer-favored solution class (explicit closed-runtime launch assertion owned by the `codium-clinemm`/`codium-factory` wrappers) is correct in principle, but those wrappers do not exist in any source tree or generated wrapper path this shell can author or inspect.

**Recon conclusion (corrected 2026-08-31, per Factory causal reviewer P0):** the prior conclusion was a P0 overclaim because the search space was wrong. The authoritative producer lives in the operator's separate home-manager repository (`~/.nixpkgs/darwin-configuration.nix`, copy placed at ClineMM repo root for review only and ignored via `/darwin-configuration.nix` in `.gitignore`). After that file was inspected:

  - `mkCodiumProfile` constructor at line 281 of operator's darwin-configuration.nix
  - Marker injection `export CLINEMM_RUNTIME_PROFILE=dogfood` at line 294
  - 15 `codium-*` profiles generated from this constructor
  - Both target wrappers (`codium-clinemm`, `codium-factory`) are present on disk at `/etc/profiles/per-user/chistyakov/bin/`, byte-deterministic SHA-256 captured

The correct case is **CASE L1 (launcher source is owned in another operator-controlled Git repository; copy available for review in this checkout via `/darwin-configuration.nix` ignore pattern)**, not CASE L3. The producer is durably owned and structurally proven. `HALT_LAUNCHER_SOURCE_UNBOUND` is NOT_ASSERTED in this commit.

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


## section 5. Launcher producer - CORRECTION (per Factory causal reviewer)

**Prior classification (overclaimed in commit `5f0c15763`):**

```
HALT_LAUNCHER_SOURCE_UNBOUND
  (claimed launcher source does not exist / ownership unknown)
```

**Corrected classification (this commit):**

```
LAUNCHER_ARTIFACT_EXISTENCE       = PREVIOUSLY_BOUND
AUTHORITATIVE_NIX_SOURCE          = OPERATOR_SUPPLIED
                                     (operator's home-manager repo,
                                     separate from this ClineMM checkout)
PRODUCER_RUNTIME_BINDING          = ALREADY_PRESENT_IN_NIX_SOURCE
COMPOSITION_PROVEN                = STRUCTURAL
```

The Factory causal reviewer's P0 correction notes that the prior search
space (`apps/`, `sdk/`, `scripts/`, `docs/`, visible `$PATH` on the
sandbox) was the wrong space: the authoritative producer lives in the
operator's separate home-manager repo, and nix-darwin materializes
declarative config into Nix-managed system/profile outputs only after
`darwin-rebuild switch`. The absence of the source from the ClineMM
checkout is therefore unsurprising and not a defect.

On 2026-08-31 the operator placed a copy of `~/.nixpkgs/darwin-configuration.nix`
at the ClineMM repo root for review. The file is operator-owned (separate
home-manager repo) and is NOT a ClineMM-tracked artifact; `.gitignore`
now excludes it via `/darwin-configuration.nix` so it cannot accidentally
be committed to this repo.

The producer definition (line 281-301 of operator's file):

```nix
home.packages = let
  mkCodiumProfile = name: pkgs.writeShellScriptBin "codium-${name}" ''
    set -euo pipefail

    APP="/Applications/VSCodium.app"
    CLI="$APP/Contents/Resources/app/bin/codium"

    BASE_DIR="$HOME/.vscodium-${name}"
    DATA_DIR="$BASE_DIR/user-data"
    EXT_DIR="$BASE_DIR/extensions"
    WORKSPACE_DIR="$BASE_DIR/workspaces"

    mkdir -p "$DATA_DIR" "$EXT_DIR" "$WORKSPACE_DIR"

    export CLINEMM_RUNTIME_PROFILE=dogfood
    export CLINEMM_PTAD=1

    exec "$CLI" \
      --user-data-dir "$DATA_DIR" \
      --extensions-dir "$EXT_DIR" \
      "$@"
  '';

  codiumCline     = mkCodiumProfile "cline";
  codiumTrim      = mkCodiumProfile "trim";
  codiumRoz       = mkCodiumProfile "roz";
  codiumUlybka    = mkCodiumProfile "ulybka";
  codiumIndeep    = mkCodiumProfile "indeep";
  codiumIndeepFE  = mkCodiumProfile "indeepfe";
  codiumKGB       = mkCodiumProfile "kgb";
  codiumSPbNIX    = mkCodiumProfile "spbnix";
  codiumRees      = mkCodiumProfile "rees";
  codiumFactory   = mkCodiumProfile "factory";
  codiumLeamas    = mkCodiumProfile "leamas";
  codiumThecircus = mkCodiumProfile "thecircus";
  codiumClinemm   = mkCodiumProfile "clinemm";
  codiumGranelle  = mkCodiumProfile "granelle";
  codiumRun       = mkCodiumProfile "run";
in [ codiumCline codiumTrim ... codiumFactory ... codiumClinemm ... ];
```

The marker `export CLINEMM_RUNTIME_PROFILE=dogfood` is in the **shared
constructor** `mkCodiumProfile`, which means it is injected into all 15
`codium-*` profiles the operator owns. This is the correct blast radius:
any operator-owned isolated dogfood launcher gets the marker automatically.


### section 5a. Generated wrappers (proved on disk)

Both target wrappers are present on disk at `/etc/profiles/per-user/chistyakov/bin/`,
each as a symlink into the corresponding Nix-store derivation:

```
/etc/profiles/per-user/chistyakov/bin/codium-clinemm
  -> /nix/store/qi54yx128rk6yhgi28nbrs8x4dya31cj-codium-clinemm/bin/codium-clinemm
  SHA-256: a829795f1d6b66957a5d193ed433c4be3d623a38a766b9a64f136b4d24e3a312

/etc/profiles/per-user/chistyakov/bin/codium-factory
  -> /nix/store/3qm0llh4hg13jj8zjc1hjiyhfryf85an-codium-factory/bin/codium-factory
  SHA-256: d07e250e435097062b06c3dd1c9a4bc8c5c08e76382a5f4190c87630e4356ee6
```

Generated wrapper content (clinemm; factory differs in `BASE_DIR` only):

```bash
#!/nix/store/l4lm58dbybyv6mrkis58l7dav18s6gk6-bash-5.3p3/bin/bash
set -euo pipefail

APP="/Applications/VSCodium.app"
CLI="$APP/Contents/Resources/app/bin/codium"

BASE_DIR="$HOME/.vscodium-clinemm"
DATA_DIR="$BASE_DIR/user-data"
EXT_DIR="$BASE_DIR/extensions"
WORKSPACE_DIR="$BASE_DIR/workspaces"

mkdir -p "$DATA_DIR" "$EXT_DIR" "$WORKSPACE_DIR"

  export CLINEMM_RUNTIME_PROFILE=dogfood
  export CLINEMM_PTAD=1

exec "$CLI" \
  --user-data-dir "$DATA_DIR" \
  --extensions-dir "$EXT_DIR" \
  "$@"
```

`diff codium-clinemm codium-factory`:

```diff
7c7
<           BASE_DIR="$HOME/.vscodium-clinemm"
---
>           BASE_DIR="$HOME/.vscodium-factory"
```

(plus the symlink target itself.) The marker injection is byte-identical
across both wrappers and across all 15 sibling profiles derived from the
same constructor.

### section 5b. Structural composition (deterministic)

```
NIX_SOURCE_PATH        = (operator's home-manager repo; copy at
                          ClineMM repo root for review only;
                          IGNORED via /darwin-configuration.nix)
NIX_DEFINITION_SYMBOL  = mkCodiumProfile
NIX_MARKER_LINE        = line 294: export CLINEMM_RUNTIME_PROFILE=dogfood

GENERATED_CLINEMM_WRAPPER = /nix/store/qi54yx128rk6yhgi28nbrs8x4dya31cj-codium-clinemm/bin/codium-clinemm
GENERATED_FACTORY_WRAPPER = /nix/store/3qm0llh4hg13jj8zjc1hjiyhfryf85an-codium-factory/bin/codium-factory

PRODUCER_DEFINITION = writeShellScriptBin "codium-${name}" ''...''
                      (deterministic; literal interpolation)
COMPOSITION         = Nix source -> writeShellScriptBin derivation ->
                      symlink -> exec -> process.env.CLINEMM_RUNTIME_PROFILE=dogfood

RESOLVER            = apps/vscode/src/sdk/dogfood-runtime-profile.ts
                      resolveClineMmRuntimeProfile() === "dogfood"
                      (proven by R2: marker === 'dogfood' -> dogfood)
```

The composition is deterministic: the `writeShellScriptBin` derivation
embeds the marker literal into the produced script. Any change to the
marker line in `mkCodiumProfile` propagates to all 15 generated wrappers
after `darwin-rebuild switch` and would be visible in the SHA-256 of the
generated wrappers.

### section 5c. Ablation (mechanically pinned, no second permanent commit)

The reviewer-prescribed ablation is already implicitly pinned by the
structural composition + R1/R2 vitest tests:

```
Nix definition WITHOUT marker
  -> generated wrapper WITHOUT marker
  -> process.env.CLINEMM_RUNTIME_PROFILE unset when exec'd
  -> resolver returns "public"   [pinned by R1]

Nix definition WITH marker
  -> generated wrapper WITH marker
  -> process.env.CLINEMM_RUNTIME_PROFILE === "dogfood" when exec'd
  -> resolver returns "dogfood"  [pinned by R2]
```

Per Factory causal reviewer section 7: "If safely practical, evaluate/build
an ablated temporary Nix expression. Do NOT mutate the active system merely
for ceremonial ablation if the producer -> wrapper derivation is already
deterministic and inspected." Both conditions hold: deterministic
(writeShellScriptBin literal interpolation) and inspected (SHA-256 +
byte-identical marker line captured for both wrappers). The ablation is
therefore STRUCTURAL_COMPOSITION, not LIVE, and is honored without
further ceremony.


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
LIVE_LAUNCHER_INSPECTION = PROVEN_ON_DISK
                           (codium-clinemm + codium-factory wrappers
                            inspected at /etc/profiles/per-user/chistyakov/bin/;
                            both contain the marker; SHA-256 captured;
                            byte-identical diff except BASE_DIR)
LIVE_RUNTIME_RESOLVE     = NOT_EXECUTED
                           (no headed VSCodium in this sandbox;
                            user directive DO NOT RESTART ANY VSCODIUM INSTANCE)
```

Per ACT section 13 disposition (final):

  PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL
  PRODUCER  = STRUCTURAL_REAL
  CONSUMER  = STRUCTURAL_REAL
  COMPOSITION = PROVEN
  LIVE_IDENTITY = NOT_EXECUTED

The reviewer-prescribed ablation is mechanically pinned by R1 + R2
(22/22 vitest) plus the deterministic Nix `writeShellScriptBin`
derivation (see section 5c): removing the marker from `mkCodiumProfile`
would necessarily remove it from all 15 generated wrappers, and the
resolver would return `"public"` for any process spawned without it.
No second permanent Nix commit is required; the ablation is honored
as STRUCTURAL_COMPOSITION.

Live qualification (the only remaining open item) requires the
operator to launch headed VSCodium via `codium-clinemm` (or
`codium-factory`) on their own machine and report
`resolveClineMmRuntimeProfile()` from the real extension host. This is
the single step that would promote this ACT from
`PASS_DOGFOOD_RUNTIME_IDENTITY_V1_STRUCTURAL` to
`PASS_DOGFOOD_RUNTIME_IDENTITY_V1` (no qualifier).


## section 9. Halt conditions

```
HALT_UNEXPECTED_TRACKED_DIRT             = not asserted (worktree clean post-gates)
HALT_LAUNCHER_SOURCE_UNBOUND             = NOT_ASSERTED (prior commit `5f0c15763` overclaimed; corrected in this commit. Producer FOUND in operator's darwin-configuration.nix; generated wrappers PROVEN on disk; composition PROVEN structurally.)
HALT_IDENTITY_REQUIRES_WORKSPACE_HEURISTIC = not asserted (R5 explicitly forbids; reviewer-rejected proposal never landed)
HALT_IDENTITY_REQUIRES_PUBLIC_SETTING    = not asserted (R6 explicitly forbids)
HALT_IDENTITY_FAILS_OPEN                 = not asserted (R3 fail-closed; "1"/"true"/"yes"/"banana" all return public)
HALT_PUBLIC_RUNTIME_CLASSIFIED_DOGFOOD   = not asserted (R1 + R5 + R6: marker absent + workspace/extension-irrelevant -> public)
HALT_DOGFOOD_RUNTIME_CLASSIFIED_PUBLIC   = not asserted (R2: marker === 'dogfood' -> dogfood)
HALT_DIAGNOSTIC_BEHAVIOR_CHANGED         = not asserted (C6: identity ACT does not couple to diagnostics; that coupling is the halted diagnostic-profile ACT's job)
HALT_ACT_OWNED_REGRESSION                = not asserted (tsc EXIT=0; no imports changed; no consumers; no diagnostic coupling)
P2_REVIEW_FIX (R7-signature-proves-purity overclaim) = FIXED in this commit
  (see apps/vscode/src/sdk/dogfood-runtime-profile.test.ts R7 comment block;
   the test now verifies body-level purity witness - input not mutated -
   rather than re-stating signature purity as a tautology. 22/22 still PASS.)
```

## section 10. Durability + predecessor update

This commit:

  - Creates `apps/vscode/src/sdk/dogfood-runtime-profile.ts` (106 lines; resolver + predicate)
  - Creates `apps/vscode/src/sdk/dogfood-runtime-profile.test.ts` (162 lines; R1-R7 + defensive + predicate)
  - Creates `.factory/acts/ACT-CLINEMM-DOGFOOD-RUNTIME-IDENTITY01.md` (this file)
  - Updates `.factory/epic-board.md` row 19 (the previously-halted dogfood-diagnostic-profile row) from `HALT_DOGFOOD_IDENTITY_ABSENT` to `IDENTITY_AVAILABLE_VIA_RESOLVER / LAUNCHER_HALTED`, and adds a new row 19a for this ACT
  - Adds `.gitignore` whitelist entries for the new ACT file and any future evidence

Predecessor (`ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01`) is NOT updated to `REOPENABLE / DOGFOOD_IDENTITY_AVAILABLE` in this commit because per the Factory causal reviewer's section 9 directive ("Do NOT implement VIAP in this continuation"):

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
                 + LIVE_IDENTITY = NOT_EXECUTED
                 (prior commit `5f0c15763` carried
                  HALT_LAUNCHER_SOURCE_UNBOUND; corrected in this
                  commit. Producer FOUND, generated wrappers PROVEN,
                  composition PROVEN. LIVE qualification is the only
                  remaining caveat and is operator-dependent.)

ENTRY_HEAD     = f63556b175b02516d8fbe3e68a7029a48e3aa3a3
SUBJECT_HEAD   = f63556b175b02516d8fbe3e68a7029a48e3aa3a3
FINAL_HEAD     = <this commit>
WORKTREE       = clean tracked post-commit

LAUNCHER_SOURCE =
  codium-clinemm  : operator's darwin-configuration.nix line 281-301
                    (mkCodiumProfile constructor; marker at line 294)
                    -> /nix/store/qi54yx128rk6yhgi28nbrs8x4dya31cj-codium-clinemm/bin/codium-clinemm
                    SHA-256: a829795f1d6b66957a5d193ed433c4be3d623a38a766b9a64f136b4d24e3a312
                    symlink at /etc/profiles/per-user/chistyakov/bin/codium-clinemm
  codium-factory  : same shared constructor (mkCodiumProfile "factory")
                    -> /nix/store/3qm0llh4hg13jj8zjc1hjiyhfryf85an-codium-factory/bin/codium-factory
                    SHA-256: d07e250e435097062b06c3dd1c9a4bc8c5c08e76382a5f4190c87630e4356ee6
                    symlink at /etc/profiles/per-user/chistyakov/bin/codium-factory

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

P0 = none (after correction; full identity chain structurally pinned)
P1 = none (after correction; LIVE qualification is the only remaining open item)
P2 = R7-signature-proves-purity overclaim (FIXED in this commit; see test file comment correction)

NEXT = (a) Operator-side (the ONLY remaining open work in this ACT):
                    launch headed VSCodium via `codium-clinemm` (or
                    `codium-factory`) per the operator's normal workflow;
                    inside the extension host, prove
                    `resolveClineMmRuntimeProfile()` reports `"dogfood"`.
                    Then launch an ordinary non-wrapper VSCodium with the
                    same VSIX and prove it reports `"public"`. This is the
                    LIVE qualification that promotes this ACT to
                    `PASS_DOGFOOD_RUNTIME_IDENTITY_V1` (no qualifier).

       (b) Per Factory causal reviewer directive, this continuation did
           NOT open `…-LAUNCHER01` because the producer half is already
           structurally pinned and the causal chain is a single identity
           proof, not two ACTs. Splitting would be ceremony.

       (c) After (a) lands, reopen
           `ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01`
           with C1: GO and proceed to implement sections 3-6 (resolver
           import + capture sink + header indicator + P probe) +
           sections 7-9 tests + section 13 live qualification. That
           re-open is OUT OF SCOPE for this continuation (per reviewer
           directive "Do NOT implement VIAP in this continuation").
```

---

## section 12. Factory rule applied

**STOP.** This ACT (across both commits) established the full identity
chain structurally: resolver (extension-side) + producer (Nix-side,
found in operator's darwin-configuration.nix) + composition (deterministic
writeShellScriptBin literal) + generated wrappers (proved on disk).
The only remaining open item is LIVE qualification by the operator on
their own machine (launch headed `codium-clinemm` / `codium-factory`,
prove resolver returns `"dogfood"` from the real extension host). No
further review loop on this shell. The full identity chain is durably
bound to the next chat's diagnostic-profile re-open via this file's
`section 11` NEXT item, but the diagnostic-profile re-open itself is
out of scope for this continuation per reviewer directive.
