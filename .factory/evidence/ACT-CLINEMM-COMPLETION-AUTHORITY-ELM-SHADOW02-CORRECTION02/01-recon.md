# CORRECTION02 recon

## Reviewer finding (P0)

CORRECTION01 added the production enable seam (`applyElmShadowDiagnosticProfile`,
activation call in `extension.ts:activate`, dump command + registry entry +
package.json contribution, runtime module). The enable resolver exists.

However, the kernel-path resolution read `globalThis._importMetaUrl`.
The esbuild banner writes `const _importMetaUrl = pathToFileURL(__filename)`
as a TOP-LEVEL CJS variable. In CommonJS, top-level `const`/`var` is
module-scoped — it is NOT a property on `globalThis`. So in production
activation, `_banner._importMetaUrl` is always `undefined`, the kernel path
is `null`, and the `applyElmShadowDiagnosticProfile` fail-closed branch
silently disables the shadow even when `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1`.

The previous `/tmp/verify-kernel-path2.cjs` proved the path ARITHMETIC was
correct, but not that production activation obtains the banner value.

## Bounded fix (reviewer-prescribed, ~5 lines)

Replace `globalThis._importMetaUrl` with `context.extensionUri.fsPath`:

```ts
const elmShadowKernelPath = path.join(
  context.extensionUri.fsPath,
  "elm",
  "completion-authority",
  "vendor",
  "completion-authority.js",
)
```

`context.extensionUri.fsPath` is the authoritative installed extension
root provided directly by the VS Code activation API. It is independent
of bundling / banner scope / Node CJS-vs-ESM. In a packaged VSIX it is
`<extensions>/<publisher>.<name>-<version>/`. The elm bundle sits at
`<ext-root>/elm/completion-authority/vendor/completion-authority.js`
because `.vscodeignore` does NOT exclude `elm/**`.

## Discriminator tests added (ELS02-16.B2 + B3)

ELS02-16.B2: source-presence — asserts `extension.ts` reads from
`context.extensionUri.fsPath` and does NOT contain any
`globalThis[\s\S]*?_importMetaUrl` pattern. If the previous bug
regressed, this test would fail.

ELS02-16.B3: end-to-end path resolution — constructs the resolved
path from a simulated extension root, asserts `fs.existsSync` is
true, and asserts SHA-256 matches `034f70b7...` (the frozen Elm
vendor SHA from the predecessor ACT).

## Bundle-side verification

The bundled `apps/vscode/dist/extension.js` now reads:

```
const elmShadowKernelPath = import_node_path104.default.join(
    context4.extensionUri.fsPath,
    "elm",
    "completion-authority",
    "vendor",
    "completion-authority.js"
);
```

The previous `globalThis._importMetaUrl` reads are gone from the bundle.

Runtime simulation (`/tmp/verify-extensionUri-resolver.cjs`):

```
Resolved kernel path: /Volumes/.../apps/vscode/elm/completion-authority/vendor/completion-authority.js
Exists? true
SHA-256: 034f70b7b725738b284f3ec94f646b68f9c2def535cc811304c31313902d706e
```

This is the path that production activation will hand to the shadow.

## Gates GREEN (after fix)

- 27/27 SHADOW02 tests (was 25; added ELS02-16.B2 + B3 discriminator tests).
- 98/98 vitest across 4 files (SHADOW02 27/27, TCE 39/39, historical-replay 20/20,
  CCARD 12/12).
- TYPECHECK=PASS.
- ELM_TEST=31/31, ELM_SMOKE=PASS, ELM_VENDOR_JS_SHA256 unchanged (034f70b7...).

## Verdict

VERDICT=PASS_LIVE_ELM_SHADOW_REACHABILITY_GREEN (corrected)
READY_FOR_OPERATOR_LIVE=true (path resolution now proven for both
arithmetic AND runtime binding)

The operator can now proceed:
1. `bun run package` (full prod build; `bun esbuild.mjs --production`
   + `vsce package`).
2. Install the dogfood VSIX with `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1`.
3. Restart Codium, verify `[ELM-SHADOW] enabled=true kernelPath=<resolved>`
   in the extension host output.
4. Run one mundane task (e.g. `pwd`, `git rev-parse --short HEAD`, `date`).
5. Command Palette → `Cline Debug: Dump Continuation Cardinality Authority`
   AND `Cline Debug: Dump Completion Authority Elm Shadow`.
6. Filter both JSONL by the fresh sessionId.
7. Verify 1:1 DIRECT correspondence for `task_started / run_turn_started /
   submit_and_exit_seen / task_completion_committed / agent_turn_done` and
   documented INSUFFICIENT_IDENTITY for `execute_turn_prelude_enter /
   terminal_committed`. Final Elm model should be
   `task=completion_committed, activeRun=null, commitReadyRun=null,
   committedCompletion=<factual completionId>`.

Once both streams are frozen and the correspondence is verified,
`READY_FOR_FIRST_ELM_AUTHORITY_SEAM_EXPERIMENT=true`.
