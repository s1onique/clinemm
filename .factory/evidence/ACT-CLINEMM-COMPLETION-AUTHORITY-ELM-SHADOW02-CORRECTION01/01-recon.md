# CORRECTION01 recon

## Reviewer finding (P0)

The previous SHADOW02 commit landed a fully-tested Elm shadow runtime
(19/19 SHADOW02 tests; authority firewall clean; Elm kernel SHA
unchanged) but the production enable path was missing:

- extension.ts did NOT call setElmShadowEnabled(true, ...)
- dogfood-diagnostic-profile.ts did NOT export applyElmShadowDiagnosticProfile
- registry.ts did NOT expose a dump command id
- package.json did NOT declare the dump command

Result: in a packaged extension, the shadow runtime remained
DEFAULT-OFF and could never become LIVE. The reviewer correctly
classified this as PASS_SHADOW_RUNTIME_GREEN_LIVE_REACHABILITY_MISSING
rather than PASS_LIVE_ELM_SHADOW.

## Bounded correction scope (per reviewer)

1. Production enable seam at extension.ts:activate, BEFORE
   SdkController construction, sibling to applyContinuationCardinalityAuthorityDiagnosticProfile.
2. Resolve the packaged Elm kernel path from the bundled extension
   root. Use the esbuild banner's `_importMetaUrl` (which mirrors
   `__filename`).
3. Enable only under CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1
   (also true/yes).
4. Register a dump command via the standard BJLA/BOCOR/CCARD
   pattern: registry key, package.json contribution, vscode.commands
   registration in extension.ts.
5. ELS02-16 source-presence tests prove the wiring exists.

## Files touched (bounded)

  apps/vscode/src/extension.ts                       +68
  apps/vscode/src/registry.ts                        +12
  apps/vscode/src/sdk/dogfood-diagnostic-profile.ts  +88
  apps/vscode/src/sdk/__tests__/completion-authority-elm-shadow02.test.ts  +105
  apps/vscode/package.json                           +5
  apps/vscode/src/sdk/completion-authority-elm-shadow-runtime.ts   +NEW (85 lines)

Total: 278 insertions across 5 modified files + 1 new file. No
deletions. No production semantics altered.

## Path resolution proof

The esbuild banner sets `_importMetaUrl = pathToFileURL(__filename)`
at the top of the bundled extension.js. For the in-source path:

  /Volumes/.../apps/vscode/dist/extension.js

the banner gives:

  file:///Volumes/.../apps/vscode/dist/extension.js

extension.ts derives:

  path.resolve(
    path.dirname(fileURLToPath(_importMetaUrl)),
    "..", "elm", "completion-authority", "vendor", "completion-authority.js"
  )

which resolves to:

  /Volumes/.../apps/vscode/elm/completion-authority/vendor/completion-authority.js

Verified by /tmp/verify-kernel-path2.cjs:
  Resolved: .../apps/vscode/elm/completion-authority/vendor/completion-authority.js
  Exists? true
  SHA-256: 034f70b7b725738b284f3ec94f646b68f9c2def535cc811304c31313902d706e

This is the exact path shipped by `vsce package` because
`.vscodeignore` does NOT exclude `elm/**`.

## Activation contract (frozen)

- Default off. CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW must be unset,
  "0", "false", "no", or "" for the shadow to stay off.
- Opt-in: "1", "true", "yes" enable the shadow.
- fail-closed: env says ON but the caller did not pass a kernel
  path → shadow stays off.
- Side-effect: extension.ts logs
  `[ELM-SHADOW] enabled=true kernelPath=<resolved>` to the
  developer console when the shadow arms.

## Verdict

SUBJECT: PASS_LIVE_ELM_SHADOW_REACHABILITY_GREEN
(side-effect: PASS_SHADOW_RUNTIME_GREEN_LIVE_REACHABILITY_MISSING
from the predecessor ACT is now corrected).

OPERATOR_LIVE: pending (operator runs install + mundane task +
dump both streams per §26/§28/§29).

READY_FOR_FIRST_ELM_AUTHORITY_SEAM_EXPERIMENT:
true (subject to operator-rendered 1:1 live correspondence per §36).
