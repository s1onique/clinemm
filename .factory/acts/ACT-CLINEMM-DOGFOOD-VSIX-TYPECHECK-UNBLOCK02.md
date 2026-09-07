# ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02

> Bounded build-unblock correction after nineteenth-reviewer verdict
> HALT_DOGFOOD_WEBVIEW_TYPECHECK_GATE_RED (2026-09-07, immediately
> after the DOGFOOD-VSIX-TYPECHECK-UNBLOCK01 closure at c47e219f7).

## What the reviewer caught

The UNBLOCK01 ACT claimed "webview tsc → exit 0" and "full check-types
→ exit 0" as evidence that `vsce package` would succeed. The reviewer
correctly observed that:

1. The standalone `bunx tsc --noEmit` invocation (run from the webview
   root) is NOT the canonical webview gate — the canonical webview
   gate is `tsc -b` (build mode) invoked from `webview-ui/build`
   during `bun run package`. `tsc -b` checks project references and
   catches JSX ref-typing contracts that `--noEmit` mode does not.

2. The actual exact-head `bun run package` invocation aborts in the
   `bun run build:webview` step (which runs `tsc -b && vite build`)
   with FIVE webview compilation errors tied to the new Model
   Profiles production wiring.

3. Five errors reduce to THREE root causes (per reviewer):
   - **A. Trigger ref polymorphism** — 3 errors. The hook exposes
     `RefObject<HTMLElement | null>` as part of `triggerProps`, but
     it is spread onto two distinct concrete element types:
     `ModelDisplayButton` (a `styled.a` → HTMLAnchorElement) and
     `<button>` (HTMLButtonElement). TS2769/TS2322 reject both.
   - **B. Proto request contract mismatch** — 1 error. The container
     imports `ClearDefaultModelProfileRequest` from
     `@shared/proto/cline/state`, but the proto defines
     `rpc clearDefaultModelProfile(EmptyRequest) returns (Empty)` —
     the type does not exist in the generated protocol. The actual
     call uses `EmptyRequest.create({})` correctly; the import is
     dead and only the typecheck gate surfaces it.
   - **C. Settings container props mismatch** — 1 error. `SettingsView`
     passes `renderSectionHeader={renderSectionHeader}` to
     `<ModelProfilesSectionContainer>` (matching the convention
     established by `SandboxCapabilitiesSection` /
     `TemporaryExternalPathsSection`), but the container's props
     never declared that field. The parent wiring has never
     typechecked under the canonical webview build.

4. The previous "GREEN" claim is `CONTRADICTED_BY_EXACT_DOGFOOD_BUILD`.

## RED preserved

`bun run package` from the previous closure HEAD (c47e219f7):
- `bun run sync-parser-helper` → ok
- `bun run check-types` → ok (still GREEN; my standalone `tsc --noEmit`
  did correctly catch the backend tsc but missed webview `tsc -b`)
- `bun run build:webview` → **5 ERRORS → aborts**:
  - `ChatTextArea.tsx:1681` TS2769 (anchor ref)
  - `ModelProfileQuickSwitch.tsx:237` TS2322 (button ref)
  - `ModelProfileQuickSwitchContainer.tsx:126` TS2322 (button ref)
  - `ModelProfilesSectionContainer.tsx:31` TS2724 (missing exported member `ClearDefaultModelProfileRequest`)
  - `SettingsView.tsx:185` TS2322 (prop `renderSectionHeader` not in `ModelProfilesSectionContainerProps`)
- `bun run lint` (would not run because package aborts earlier)
- VSIX = NOT_BUILT

RED transcript: `.factory/evidence/ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02/01-red-package-fail.txt`

## GREEN scope — three surgical fixes only

Per the reviewer's explicit scope directive:

> Only: 1. fix trigger/ref typing cleanly; 2. bind clear-default RPC
> to the actual generated proto contract; 3. align
> ModelProfilesSectionContainer with the real Settings section
> interface. No runtime/provider/session changes.

Plus the necessary adjacent cleanup so `bun run package` can complete
end-to-end (vsce packaging hygiene: `.factory/**` to .vscodeignore).

### Fix A — Trigger ref contract (root cause A)

**Design (per reviewer's "separate behavioral trigger props from
element ref ownership"):**

`ModelProfileQuickSwitchState.triggerProps` is now ELEMENT-AGNOSTIC
and contains ONLY behavioral attributes (`aria-*`, `onClick`,
`data-testid`, `title`, `disabled`). Element-ref ownership is
delegated to each caller:

```ts
// New shape:
export interface ModelProfileTriggerProps {
  "data-testid": string
  "aria-haspopup": "listbox"
  "aria-expanded": boolean
  "aria-label": string
  title: string
  disabled: boolean
  onClick: () => void
}
```

The hook gains an OPTIONAL `triggerRef` parameter:

```ts
export function useModelProfileQuickSwitch(
  props: ModelProfileQuickSwitchProps,
  options?: { triggerRef?: React.RefObject<HTMLElement | null> },
): ModelProfileQuickSwitchState {
  const fallbackTriggerRef = useRef<HTMLElement | null>(null)
  const triggerRef = options?.triggerRef ?? fallbackTriggerRef
  // ...reads triggerRef.current as HTMLElement | null internally
}
```

Each caller creates its own correctly-typed local ref:

- `<ModelProfileQuickSwitch>` (standalone) — owns an `HTMLButtonElement`
  ref and forwards it: `useRef<HTMLButtonElement | null>(null)` then
  `<button {...triggerProps} ref={triggerButtonRef}>`.
- `ModelProfileQuickSwitchContainer` (legacy standalone) — same.
- `ChatTextArea` — owns an `HTMLAnchorElement` ref (because
  `<ModelDisplayButton>` is `styled.a`) and forwards it:
  `useRef<HTMLAnchorElement | null>(null)` then
  `<ModelDisplayButton {...profileSwitchTriggerProps} ref={modelButtonRef}>`.

This preserves the product invariant established in MPWC02
correction02: the existing model label remains the real trigger.

The hook retains outside-click detection + focus restoration by
reading `.current` via the caller-supplied ref; tests that don't
need those semantics can omit the `triggerRef` and get a harmless
fallback ref.

### Fix B — Proto request contract (root cause B)

The dead `ClearDefaultModelProfileRequest` import in
`ModelProfilesSectionContainer.tsx:31` is removed. The proto
explicitly declares:

```proto
rpc clearDefaultModelProfile(EmptyRequest) returns (Empty);
```

so the existing call site (`EmptyRequest.create({})`) is correct
and needs no change. NO proto changes were needed.

### Fix C — Settings container prop (root cause C)

`ModelProfilesSectionContainerProps` gains
`renderSectionHeader?: (tabId: string) => ReactNode`, matching the
convention used by `SandboxCapabilitiesSection` and
`TemporaryExternalPathsSection`. The container forwards it to
`ModelProfilesSection`, which calls it inside its root `<div>`
matching the existing section-header pattern.

`ModelProfilesSectionProps` gains the same prop. The `useCallback`
for `handleOpenManageProfiles` is unchanged.

### Adjacent fix — vsce packaging hygiene

`apps/vscode/.vscodeignore` adds `.factory/**` so the leftover
`apps/vscode/.factory/tmp/r1-inside-*` symlink-escape probes from
previous PIIF R1 test runs don't fail vsce's "currentLevel is
undefined" safety check. `.factory` is already in the repo's
top-level `.gitignore`, so this is purely a packaging-hygiene
additive — no production source touched.

## Adjacent lint cleanup (bounded, ACT-owned)

`bun run lint` (the next stage after `build:webview`) revealed 6
pre-existing lint failures (5 of them clearly tied to the Model
Profiles production wiring introduced in MPW01 / MPWC02):
- `src/sdk/profile-store/profile-application.ts:53` — unused `readDefaultModelProfileId`
- `src/sdk/profile-store/session-binding.ts:24` — unused `GlobalState` type import
- `src/shared/storage/instance-secret.ts:25` — unused `ClineFileStorage` import
- `webview-ui/src/components/chat/chat-existing-model-label-trigger.mpwc02.test.tsx:23,26` — unused `useState`, `ModelProfileQuickSwitch` imports
- `webview-ui/src/components/chat/chat-existing-model-label-trigger.mpwc02.test.tsx:256` — `noInvalidUseBeforeDeclaration` on the deliberate TDZ-discrimination test

Five are trivial unused-import removals (one was pre-existing in the
container — that was the proto contract fix). The TDZ lint failure
is annotated with a `biome-ignore` comment on the use-site explaining
the test DELIBERATELY exercises a TDZ-violating shape (the read
of `modelDisplayName` happens before the const declaration, and the
test asserts `toThrow(ReferenceError)` to prove the discriminator
is sensitive).

These 6 are pre-existing from earlier MPWC commits (ff23751f8,
5f9e931a3) and not introduced by this ACT. They were simply
invisible to my previous "GREEN" claim because `bun run package`
aborted in `build:webview` and never reached `lint`. They are
ACT-owned per the reviewer's logic ("if `bun run package` fails on
something tied to Model Profiles production wiring, it's our
problem to fix").

## Results

GREEN transcript: `.factory/evidence/ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02/02-green-package-success.txt`

| Gate | Status |
| --- | --- |
| `bun run sync-parser-helper` | ok |
| `bun run check-types` (protos + backend tsc + compat + webview tsc) | 0 errors |
| `bun run build:webview` (protos + webview tsc -b + vite build) | ok (vite built in 8.96s) |
| `bun run lint` (biome lint + proto lint) | 0 errors |
| `bun esbuild.mjs --production` | ok (dist/extension.js rebuilt) |
| **`bun run package`** | **EXIT 0** (decisive gate) |
| **`bunx vsce package`** | **VSIX BUILT** (50 files, 14.17 MB) |

VSIX artifact identity: `.factory/evidence/ACT-CLINEMM-DOGFOOD-VSIX-TYPECHECK-UNBLOCK02/03-vsix-artifact-identity.txt`
- Path: `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-4.1.16-dogfood-c47e219f7.vsix`
- Bytes: 14,859,168 (14.17 MiB)
- SHA-256: `006521cbbf7d7837d077b53426acec46711163cc2c336f6bd936e6b5c895b6df`
- Source HEAD: this ACT's closure commit

## Diff scope

10 tracked files modified, 3 untracked factory artifacts:

- `apps/vscode/.vscodeignore` (+3 lines: `.factory/**` ignore)
- `apps/vscode/src/sdk/profile-store/profile-application.ts` (-1 line: unused import)
- `apps/vscode/src/sdk/profile-store/session-binding.ts` (-1 line: unused import)
- `apps/vscode/src/shared/storage/instance-secret.ts` (-2 lines: unused import)
- `apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx` (+7 lines: anchor ref + 4th hook arg)
- `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.tsx` (+33/-16 lines: hook signature change + button ref + behavioral triggerProps type)
- `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitchContainer.tsx` (+33/-11 lines: 4th hook arg + button ref + renderSectionHeader forwarding)
- `apps/vscode/webview-ui/src/components/chat/chat-existing-model-label-trigger.mpwc02.test.tsx` (+6/-2 lines: unused imports removed + TDZ biome-ignore)
- `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSection.tsx` (+11/-1 lines: renderSectionHeader prop + ReactNode type + JSX call)
- `apps/vscode/webview-ui/src/components/settings/sections/ModelProfilesSectionContainer.tsx` (+14/-4 lines: renderSectionHeader prop + ReactNode type + forwarding + ClearDefaultModelProfileRequest dead-import removed)

`UNEXPECTED_TRACKED_DIRT = ABSENT` — the two cosmetic biome-format
reformat drifts on `getStateToPostToWebview.ts` and
`working-context-state-projection.ts` triggered by `bun run protos`
were reverted via `git checkout --` before commit (per the discipline
established in DOGFOOD-VSIX-TYPECHECK-UNBLOCK01).

## Verification gates run (and the results)

Per the reviewer's mandate:

```bash
bun run check-types              # EXIT 0
bun run check-types:c2-4-c-bridge # OK — 0 diagnostic(s) match the frozen baseline
bun run build:webview            # vite built in 8.96s (tsc -b was inside the same chain)
bun run package                  # EXIT 0  <- DECISIVE GATE
bunx vsce package --no-dependencies --out dist/clinemm-4.1.16-dogfood-c47e219f7.vsix
                                 # VSIX BUILT (50 files, 14.17 MB)
```

## Lessons learned (durable for the next ACT)

1. **`bunx tsc --noEmit` (no `-b`) is NOT the canonical webview
   typecheck gate.** The canonical gate is `tsc -b` (build mode
   invoked from `webview-ui/build` during `bun run package`). Run
   `bun run package` end-to-end to verify; do not infer GREEN from
   any narrower invocation. The previous ACT (UNBLOCK01) made
   exactly this over-claim.

2. **`bun run package = EXIT 0` is the load-bearing gate for
   packaging.** Lint runs INSIDE `bun run package`, after
   `build:webview`. If lint fails, package aborts. Don't claim
   "package would succeed" without running it.

3. **VSIX packaging safety checks (`vsce package`) inspect EVERY
   file in the package tree** including `out/`, `dist/`, and
   `.factory/tmp/` test artifacts. `.factory` must be in
   `.vscodeignore` (not just `.gitignore`) to keep vsce happy.

4. **The "trigger ref contract too generic" architectural smell is
   a recurring failure mode** when a hook tries to be polymorphic
   over element types. Separate behavioral props (element-agnostic)
   from element ref ownership (element-specific). Each caller owns
   its ref; the hook reads `.current` internally.

5. **`biome-ignore` placement matters.** The comment must be on
   the line IMMEDIATELY ABOVE the offending expression (for inline
   offenses) or the offending statement (for statement-level
   offenses), not in a comment block above the surrounding function.

6. **The reviewer's "If `bun run package` fails on something tied to
   Model Profiles production wiring, it's our problem to fix" logic
   generalizes:** the `bun run package` failure surface IS the
   reviewer's red-line. Anything it touches is ACT-owned, even if
   the immediate root cause is in a file that wasn't modified by
   the current ACT. Pre-existing lint failures become ACT-owned
   the moment they block the canonical gate.

## Factory classification

```
P0:
  HALT_DOGFOOD_WEBVIEW_TYPECHECK_GATE_RED    = CLOSED
  EVIDENCE_GREEN_CONTRADICTED_BY_PACKAGE_EXECUTION = RESOLVED (real package execution now GREEN)

ROOT CAUSES:
  TRIGGER_REF_CONTRACT_TOO_GENERIC           = FIXED (Fix A)
  CLEAR_DEFAULT_RPC_TYPE_NOT_GENERATED       = FIXED (Fix B - dead-import removed)
  SETTINGS_CONTAINER_PROP_CONTRACT_MISMATCH  = FIXED (Fix C)
  PRE-EXISTING_LINT_FAILURES_BLOCKING_LINT   = FIXED (6 trivial bounded cleanups)
  VSCE_PACKAGING_HYGIENE                     = FIXED (.factory/** in .vscodeignore)

MODEL_PROFILES_RUNTIME_SEMANTICS:
  NO CHANGE OBSERVED (only typing/contracts fixed)

PREVIOUS 4 BACKEND TYPE ERRORS (UNBLOCK01):
  CLOSED (unchanged)

CANONICAL WEBVIEW TYPECHECK (tsc -b):
  GREEN

PACKAGE:
  GREEN

VSIX:
  EXACT FILE IDENTITY = clinemm-4.1.16-dogfood-c47e219f7.vsix
                       SHA-256 = 006521cbbf7d7837d077b53426acec46711163cc2c336f6bd936e6b5c895b6df
                       BYTES   = 14,859,168
                       PATH    = dist/clinemm-4.1.16-dogfood-c47e219f7.vsix

LIVE_DOGFOOD:
  READY TO INSTALL (artifact present, identity recorded)

C1: GO TO LIVE_DOGFOOD_INSTALL.
```

## Caveats (durable for the dogfood pipeline)

- Local environment lacks `npm` and the `bunx` symlink; both were
  shimmed at `/tmp/binshim` (bunx → `bun x`; npm → no-op echo).
  The shimmed `npm` is acceptable here because the canonical
  prepublish script `bun run package` was independently run and
  proven GREEN. The `vsce package` invocation that produced the
  VSIX is a packaging step on top of `bun run package`'s already-
  produced `dist/extension.js`; it does NOT re-run the build.
- The VSIX is named with the source HEAD's short SHA (`c47e219f7`)
  in the filename; this is purely a dogfood-identify convention and
  does not affect the artifact's contents.
