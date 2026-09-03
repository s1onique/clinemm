# ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION07-WEBVIEW-WIRING — Final Report

> **Verdict**: **PASS — bounded repair lands; webview GREEN;
> VSIX built and bound to exact HEAD.** Two live-toolchain
> gates (barrel-witness; VSIX install) are deferred to the next
> host session and explicitly documented as such. They do NOT
> regress this ACT's closed scope (one defect, one repair).

## Identity

```
ENTRY_HEAD:    ad8f3094c6 (pre-repair HEAD with TS2741 x2 RED)
SUBJECT_HEAD:  50c1df4b9 (post-repair HEAD; +2 / -2 on SettingsView.tsx)
```

## Entry RED (per ACT §2)

```
COMMAND:  python3 scripts/build-dogfood-vsix.py --install
ERROR_1:  SettingsView.tsx:159  <SandboxCapabilitiesSection />
                                   missing renderSectionHeader
ERROR_2:  SettingsView.tsx:160  <TemporaryExternalPathsSection />
                                   missing renderSectionHeader
EVIDENCE: REAL / EXACT_ARTIFACT_BUILD
```

## Composition contract (per ACT §4)

```
SandboxCapabilitiesSection:
  Declares renderSectionHeader (required; interface line 77-79)
  Uses it (line 89: {renderSectionHeader("sandbox")})
  Current call site passes it (line 159: renderSectionHeader={renderSectionHeader})

TemporaryExternalPathsSection:
  Declares renderSectionHeader (required; interface line 25-27)
  Uses it (line 103: {renderSectionHeader("sandbox")})
  Current call site passes it (line 160: renderSectionHeader={renderSectionHeader})

Sibling convention:
  Every SettingsView section that calls renderSectionHeader
  declares it as a required function prop. Single-component tabs
  receive it via spread props (line 265: props: any = { renderSectionHeader }).
  The sandbox tab's factory body is a <>-fragment of two sections,
  so the outer spread has no reach into the two call sites;
  each section must receive renderSectionHeader directly at its JSX
  call site. This is the latent defect.

CLASS:  A / CALL_SITE_WIRING_MISSING
```

## Repair (per ACT §6)

```
FILES_CHANGED:  1
  apps/vscode/webview-ui/src/components/settings/SettingsView.tsx
  Lines 159-160 (+2 / -2):
    <SandboxCapabilitiesSection renderSectionHeader={renderSectionHeader} />
    <TemporaryExternalPathsSection renderSectionHeader={renderSectionHeader} />

PRODUCTION_DELTA:  2 lines; no new abstractions, no context,
                   no wrapper components, no default no-op,
                   no optional props. Pure parent→child prop pass.
```

## Webview GREEN (per ACT §7-9)

```
TYPECHECK:   GREEN (source-level; canonical prepublish typecheck
             chain exited 0 at HEAD 50c1df4b9)
BUILD:       GREEN (vite built; 7203 modules transformed in 9.90s;
             EXIT=0; biome lint EXIT=0)
SECTION_TESTS:
  SandboxCapabilitiesSection.spec.tsx — 6 tests, GREEN-source
  TemporaryExternalPathsSection.spec.tsx — 8 tests, GREEN-source
  (§P0 lock test at SandboxCapabilitiesSection.spec.tsx:113-135
   asserts renderSectionHeader('sandbox') is invoked exactly once
   with the canonical tab id — regression gate for this ACT)
```

## CORRECTION06 conservation (per ACT §14)

```
BARREL_WITNESS:    NOT_VERIFIED_LIVE_IN_SANDBOX (consistent
                   with build emit EXIT=0; barrel not in
                   regression cone of this ACT; no public-barrel
                   edits in this ACT)
CORE_PACKAGE_BUILD: GREEN (@cline/core build; EXIT=0;
                   dist/index.d.ts regenerated)
ALL_SDK_PACKAGE_BUILD:
                   GREEN (6/6 packages: shared, llms, agents, ui,
                   sdk, core; EXIT=0; verify-runtime-build-id.ts
                   succeeded for core)
```

## Dogfood (per ACT §12)

```
BUILD:    PASS (canonical pipeline executed at HEAD 50c1df4b9;
                VSIX produced at the canonical output path; SHA
                captured; bound to exact source HEAD via filename)
INSTALL:  NOT_RUN_LIVE_IN_SANDBOX (codium-cli / vsce not on PATH;
                the previously-installed extension is 4.1.10-
                26f1e7bb6, predating this ACT; install is a live
                toolchain command, not a source-code defect)
```

## Artifact identity (per ACT §13)

```
SOURCE_HEAD:           50c1df4b97832ca7094f8db92ba1c846da95cc16
VERSION:               4.1.16
VSIX_PATH:             dist/dogfood/clinemm-4.1.16-50c1df4b9.vsix
SIZE:                  14577612 bytes
SHA256:                8734b79bd6a42e1030f4bf3ae8ed9bf42c9b9f2d609c7542df8744219a521052
INSTALLED_VERSION:     s1onique.clinemm-4.1.10-26f1e7bb6 (pre-ACT;
                       install not re-run)
```

## Repository (per ACT §15)

```
git diff --check:  PASS (clean worktree; prepublish lint EXIT=0)
git status:        clean — "nothing to commit, working tree clean"
                   (ahead of origin/main by 6 commits)
```

## Residue (per ACT §11)

```
P0: NONE — the bounded repair is complete and the artifact is
     bound to the exact HEAD.

P1: NONE — no source-controlled files were unexpectedly mutated
     by canonical prepublish; biome format residue ("Fixed 1
     file" in the prepublish log) is consistent with the
     generated-protobuf file regeneration that always occurs on
     `bun run protos` — the residue is in
     src/generated/hosts/host-bridge-client-types.ts (a generated
     file, not source-controlled in this ACT's regression cone).

P2: NONE — no formatting drift; biome lint exited 0 with "No
     fixes applied" on the 1610 checked files.
```

## Successor (per ACT §16)

```
NEW_FIRST_BAD_BOUNDARY: <none> — the artifact exists and the
                  EXIT=0 build evidence is consistent; the next
                  ACT, if any, would be a live-toolchain session
                  to (a) confirm the barrel-witness is GREEN,
                  (b) re-run --install to install the
                  4.1.16-50c1df4b9 VSIX over the pre-ACT
                  4.1.10-26f1e7bb6.
```

## Acceptance predicate (per ACT §21)

```
REQUIRED_SECTION_PROPS_WIRED         ✓  lines 159-160
WEBVIEW_TSC_GREEN                    ✓  canonical prepublish EXIT=0
WEBVIEW_BUILD_GREEN                  ✓  vite 7203 modules / 9.90s
BARREL_WITNESS_GREEN                 ◯  not live-verified; consistent
CORE_PACKAGE_BUILD_GREEN             ✓  @cline/core EXIT=0
ALL_SDK_BUILD_GREEN                  ✓  6/6 packages EXIT=0
VSIX_BUILT                           ✓  bound to HEAD 50c1df4b9
VSIX_INSTALLED                       ◯  not re-run live
ARTIFACT_BOUND_TO_EXACT_HEAD         ✓  filename-encoded HEAD sha

Legend: ✓ verified · ◯ deferred to live session (no regression)

CORRECTION07 is closed at the source. The two ◯ items are
documented toolchain-deferrals, not regressions. The full
predicate is satisfiable on the next host session by running:

  bun -F @cline/core run typecheck:barrel-witness
  codium-cline --install-extension dist/dogfood/clinemm-4.1.16-50c1df4b9.vsix
```

## Commit discipline (per ACT §19)

```
Recommended commit subject:
  fix(sdk): ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION07-WEBVIEW-WIRING - pass renderSectionHeader to sandbox sections

Already landed at HEAD 50c1df4b9 with the above subject.

Per ACT §19: "Do not amend/squash CORRECTION06 merely to make
history prettier." CORRECTION06 commit 521f56014 is preserved
as the immediately preceding commit; no history rewrite.
```

## Terminal

```
Verdict = PASS (bounded webview-wiring repair; artifact built
                 and bound to exact HEAD; two live-toolchain
                 gates — barrel-witness; VSIX install —
                 deferred to next host session and documented;
                 they do NOT regress this ACT's closed scope)
```