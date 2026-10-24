# ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01

## Verdict

**CLOSED_CLEAN**

The C9 → C10 diagram in
`docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md` renders
successfully on GitHub. The Mermaid fence is correctly closed, the Markdown
tables and headings are OUTSIDE the Mermaid block, and the diagram is
accepted by the REAL Mermaid parser (mermaid 11.16.1, the version pinned in
the root `package.json` `overrides`).

## Identity

- ENTRY_HEAD: `38cb209ff` (main)
- CLOSURE_HEAD: this ACT's closeout commit
- ACT_BODY_BINDING: `.factory/acts/ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01.md` (this file)
- EVIDENCE_BINDING: `.factory/evidence/ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01/`
- SCOPE: one Markdown document, plus a bounded regression guard for
  Markdown-embedded Mermaid blocks.

## The defect

`docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md` opened a
```mermaid fence at line 18 but closed it at the VERY BOTTOM of the document
(line 253). Every line in between — the `## Load-bearing transitions`
heading, the `### A-01` … `### A-06` headings, and all seven Markdown
tables — was therefore part of the Mermaid block body.

GitHub feeds a `mermaid` fence's body to the Mermaid parser verbatim. The
parser rejects `| Field | Value |` at line 44, so the whole document failed
to render its diagram.

### RED witness — the REAL Mermaid parser rejects the pre-fix document

Extracting the fenced block exactly as GitHub sees it (the text between the
fences) and handing it to `mermaid.parse()` from mermaid 11.16.1:

```
file: .../02-c9-bcb-elm-c10-authority.md   (pre-fix, from HEAD)
fenced blocks found: 3
  - lang="mermaid" lines 18..145
  - lang=""       lines 153..186
  - lang=""       lines 206..253
FAIL: mermaid block at lines 18..145: Parse error on line 44:
...| Field | Value ||---|---|| source |
---------------------^
Expecting 'SPACE', 'NL', 'DESCR', '-->', 'HIDE_EMPTY', 'scale',
'COMPOSIT_STATE', 'STRUCT_STOP', 'STATE_DESCR', 'ID', 'FORK', 'JOIN',
'CHOICE', 'CONCURRENT', 'note', 'acc_title', 'acc_descr', ... got 'INVALID'
```

This reproduces the reported GitHub failure EXACTLY: the same line number
(44), the same offending construct (the `| Field | Value |` table row).

### Why the existing gate did not protect against this

`scripts/verify-lifecycle-transition-contract.ts` validates the SEPARATE
`docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/c9-c10-traceability.mmd`
file — a standalone `.mmd`, not the diagram embedded in the Markdown. Its
green status therefore gave false assurance about the embedded diagram. This
is the exact false-negative class this ACT closes.

## The correction

### 1. Fence relocation

The two terminal transitions and the closing fence moved from the bottom of
the document to immediately after the last diagram edge:

```
     ElmHold --> C10Withheld : C10 commit SUPPRESSED
     ElmFailure --> C10Withheld : C10 commit SUPPRESSED

+    C10Committed --> [*]
+    C10Withheld --> [*]
+```
+
 ## Load-bearing transitions
```

The `mermaid` block now spans lines 18..59. The two trailing plain fences
(the LIVE-incident transcript at 149..157 and the causal chain at 190..210)
are unchanged and remain balanced.

### 2. The BCB recovery edge

```
-    C10Blocked --> C10Committed : obligations resolve (reevaluateDeferredCompletionBarrier)
+    C10Blocked --> ElmConsulted : obligations resolve (reevaluateDeferredCompletionBarrier)
```

The original edge visually BYPASSED Elm authorization: a BCB-held task that
later resolved would appear to jump straight to `C10Committed`. That
contradicts the document's own mandatory-Elm contract (A-03 "the Elm
consult" → A-04 "the C10 commit" → A-05 "the C10 commit is withheld").

**Source truth confirms the correction.** In
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`,
`reevaluateDeferredCompletionBarrier` calls
`await this.checkElmCompletionAuthority(...)` BEFORE
`this.options.setTurnPhase?.("completed", ...)`, and the C10 capture
(`captureContinuationCardinalityAuthorityRecord`) happens only AFTER the
phase write. On an Elm HOLD the function re-registers a
`deferredCompletionBarrier` and returns without committing. The BCB recovery
path therefore MUST re-consult Elm; `C10Blocked --> ElmConsulted` is the
faithful projection and `C10Blocked --> C10Committed` was wrong.

The canonical ledger agrees: `docs/architecture/task-lifecycle/transitions.tsv`
A-03 is `C9 captured → Elm consulted`, and A-04 is `Elm authorized → C10
committed` with the predicate "all of T-02's conjuncts, including the Elm
authorize". A path that reaches `C10 committed` without passing through
`Elm consulted`/`Elm authorized` cannot satisfy A-04.

## GREEN witness — the REAL Mermaid parser accepts the corrected document

```
file: .../02-c9-bcb-elm-c10-authority.md   (post-fix)
fenced blocks found: 3
  - lang="mermaid" lines 18..59
  - lang=""       lines 149..157
  - lang=""       lines 190..210
PASS: mermaid block at lines 18..59 parsed (diagramType=stateDiagram)
```

All four lifecycle architecture documents were checked with the same real
parser and all four parse (`01` at 15..45, `02` at 18..59, `03` at 12..40,
`04` at 25..64).

### The Markdown is OUTSIDE the Mermaid block

The mermaid block is now exactly lines 18..59. Every Markdown table row and
every heading in the document lives outside that range — verified by the new
guard, which enumerates the fence spans and reports any Markdown heading or
table row that falls inside one.

## The regression guard

The pre-fix defect was invisible to the existing contract verifier. To stop
the same class of failure from shipping again, this ACT adds a bounded
structural guard for Markdown-embedded Mermaid blocks:

- `apps/vscode/src/sdk/markdown-mermaid-block-verifier.ts` — the PURE
  validation core (no side effects, no DOM, no network, Node/Bun built-ins
  only), following the same core/CLI split the repo already uses for
  `lifecycle-transition-contract-verifier.ts` and
  `verify-lifecycle-transition-contract.ts`.
- `scripts/verify-markdown-mermaid-blocks.ts` — the CLI wrapper.
- `apps/vscode/src/sdk/__tests__/markdown-mermaid-block-verifier.c9c10mm01.test.ts`
  — 13 tests.
- Root `package.json` scripts `verify:markdown-mermaid-blocks` and
  `verify:lifecycle-transition-contract`.

The guard checks that every fence is closed, that a `mermaid` block contains
no Markdown table rows and no headings, that the block declares a diagram
type Mermaid recognises, and that the document still has Markdown table rows
OUTSIDE the Mermaid fence.

### RED/GREEN of the guard itself

Against the pre-fix document the guard fails and names the leaked Markdown:

```
FAIL .../02-c9-bcb-elm-c10-authority.md
  - mermaid block (lines 18..145) contains a Markdown HEADING at line 57: ## Load-bearing transitions — GitHub's Mermaid renderer will reject the whole document
  - mermaid block (lines 18..145) contains a Markdown TABLE ROW at line 61: | Field | Value | — GitHub's Mermaid renderer will reject the whole document
  ...
```

Against the corrected document it passes with zero errors.

## Gates

| Gate | Result |
|---|---|
| Real Mermaid parser (11.16.1) on the corrected document | PASS — `stateDiagram` |
| Real Mermaid parser on the pre-fix document | FAIL — reproduces the GitHub error at line 44 |
| Real Mermaid parser on all 4 lifecycle documents | PASS (4/4) |
| `bun run verify:markdown-mermaid-blocks` | PASS — 4 documents, 0 errors |
| `bun run verify:lifecycle-transition-contract` | PASS — "4 transitions, Mermaid synchronized" |
| New guard unit tests | PASS — 1 file, 13 tests |
| `tsc --noEmit` (apps/vscode) | PASS — exit 0, 0 diagnostics |
| Biome (`apps/vscode` config) on the new/changed TS files | PASS — 0 errors |
| `git diff --check` | PASS — exit 0 |

Vitest emitted the known non-fatal fork-pool `kill EPERM` teardown warning
after all selected tests passed.

## GitHub rendering

Confirmed on the pushed commit: the document renders its `stateDiagram-v2`
diagram and the Markdown tables/headings render as Markdown. See
`.factory/evidence/ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01/02-github-rendering.md`.

## Preservation

No production code changed. No completion-authorization policy, lifecycle
state ownership, Elm policy, wire protocol, or public API changed. The
transition ledger (`transitions.tsv`) and the standalone
`c9-c10-traceability.mmd` projection are untouched. The only semantic
change is in the DOCUMENTED DIAGRAM, where the BCB recovery edge is
corrected to match the source truth it claims to describe.

## Evidence

- `docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md` — the
  corrected document.
- `apps/vscode/src/sdk/markdown-mermaid-block-verifier.ts` — the pure guard core.
- `scripts/verify-markdown-mermaid-blocks.ts` — the CLI wrapper.
- `apps/vscode/src/sdk/__tests__/markdown-mermaid-block-verifier.c9c10mm01.test.ts` — 13 tests.
- `.factory/evidence/ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01/01-mermaid-render-fix.md`
- `.factory/evidence/ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01/02-github-rendering.md`
