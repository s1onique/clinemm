# ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01 — Mermaid render fix evidence

**Verdict:** `CLOSED_CLEAN`

**Subject:** `38cb209ff` (main, the pre-fix HEAD).

## The defect, reproduced with the REAL Mermaid parser

The document opened a ```mermaid fence at line 18 and closed it at line 253 —
the very bottom of the file. Everything in between (headings and all seven
Markdown tables) was Mermaid block body.

The validator used the REAL `mermaid` package (11.16.1 — the version pinned
in the root `package.json` `overrides`), running in a jsdom DOM (mermaid's
label sanitizer needs `document`), and handed it the fenced block's inner
text exactly as GitHub does.

### RED — the pre-fix document (`git show HEAD:...`)

```
file: /tmp/orig-chart02.md
fenced blocks found: 3
  - lang="mermaid" lines 18..145
  - lang=""       lines 153..186
  - lang=""       lines 206..253
FAIL: mermaid block at lines 18..145: Parse error on line 44:
...| Field | Value ||---|---|| source |
---------------------^
Expecting 'SPACE', 'NL', 'DESCR', '-->', 'HIDE_EMPTY', 'scale',
'COMPOSIT_STATE', 'STRUCT_STOP', 'STATE_DESCR', 'ID', 'FORK', 'JOIN',
'CHOICE', 'CONCURRENT', 'note', 'acc_title', 'acc_descr',
'acc_descr_multiline_value', 'CLICK', 'STRING', 'HREF', 'classDef',
'style', 'class', 'direction_tb', 'direction_bt', 'direction_rl',
'direction_lr', 'EDGE_STATE', 'STYLE_SEPARATOR', got 'INVALID'
```

This is the reported GitHub failure reproduced EXACTLY: line 44, the
`| Field | Value |` table row. The mermaid block spanned **18..145** — it
swallowed the `## Load-bearing transitions` heading, the `### A-01` …
`### A-06` headings, and the first four Markdown tables.

### GREEN — the corrected document

```
file: .../docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md
fenced blocks found: 3
  - lang="mermaid" lines 18..59
  - lang=""       lines 149..157
  - lang=""       lines 190..210
PASS: mermaid block at lines 18..59 parsed (diagramType=stateDiagram)
```

The mermaid block is now **18..59** — exactly the diagram. The two trailing
plain fences are unchanged and balanced.

### All four lifecycle documents parse

```
PASS: mermaid block at lines 15..45 parsed (diagramType=stateDiagram)   # 01-task-turn-phase.md
PASS: mermaid block at lines 18..59 parsed (diagramType=stateDiagram)   # 02-c9-bcb-elm-c10-authority.md
PASS: mermaid block at lines 12..40 parsed (diagramType=stateDiagram)   # 03-background-command-containment.md
PASS: mermaid block at lines 25..64 parsed (diagramType=stateDiagram)   # 04-completion-presentation.md
```

## The diff

```diff
@@ -45,7 +45,7 @@ stateDiagram-v2
         Suppressed --> [*]
     }

-    C10Blocked --> C10Committed : obligations resolve (reevaluateDeferredCompletionBarrier)
+    C10Blocked --> ElmConsulted : obligations resolve (reevaluateDeferredCompletionBarrier)

     ElmConsulted --> ElmHold : Elm decision = hold
     ElmConsulted --> ElmFailure : Elm decision = failure
@@ -54,6 +54,10 @@ stateDiagram-v2
     ElmHold --> C10Withheld : C10 commit SUPPRESSED
     ElmFailure --> C10Withheld : C10 commit SUPPRESSED

+    C10Committed --> [*]
+    C10Withheld --> [*]
+```
+
 ## Load-bearing transitions

 ### A-01 — C9 capture (`submit_and_exit_seen`)
@@ -247,7 +251,3 @@ completion with NO badge.

 | kind | observed |

-
-    C10Committed --> [*]
-    C10Withheld --> [*]
-```
```

Two changes, both bounded to the one document:

1. The closing fence and the two terminal transitions moved from the bottom
   of the document to immediately after the last diagram edge.
2. The BCB recovery edge was corrected to route through the Elm consult.

## Why the BCB recovery edge correction is right (source truth)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`,
`reevaluateDeferredCompletionBarrier`, in order:

| Order | Call | Meaning |
|---|---|---|
| 1 | `await this.checkElmCompletionAuthority("session-event-turn-complete-completed")` | the Elm kernel is consulted |
| 2 | on a falsy result: `this.deferredCompletionBarrier = {…}` then `return` | the C10 commit is SUPPRESSED and the barrier is re-registered |
| 3 | `this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")` | the phase commit |
| 4 | `captureContinuationCardinalityAuthorityRecord({stage: "task_completion_committed", …})` | the C10 capture, minted AFTER the effect |

The C10 commit is therefore reachable ONLY through an Elm AUTHORIZE. An edge
from `C10Blocked` straight to `C10Committed` would claim a path that the code
does not have: it bypasses the mandatory Elm authority gate.

The canonical ledger `docs/architecture/task-lifecycle/transitions.tsv` says
the same thing:

- `A-03  02  observed  C9 captured  → Elm consulted`
- `A-04  02  observed  Elm authorized → C10 committed` — predicate "all of T-02's conjuncts, **including the Elm authorize**"
- `A-05  02  observed  Elm hold / Elm failure → C10 withheld`

A path that reaches `C10 committed` without passing `Elm consulted` /
`Elm authorized` cannot satisfy A-04.

## The regression guard

The pre-fix defect was invisible to `scripts/verify-lifecycle-transition-contract.ts`,
which validates the SEPARATE `c9-c10-traceability.mmd` file rather than the
diagram embedded in the Markdown. The new guard closes that false-negative
class.

### The new guard's RED/GREEN

Against the pre-fix document:

```
FAIL /tmp/orig-chart02.md
  - mermaid block (lines 18..145) contains a Markdown HEADING at line 57: ## Load-bearing transitions — GitHub's Mermaid renderer will reject the whole document
  - mermaid block (lines 18..145) contains a Markdown HEADING at line 59: ### A-01 — C9 capture (`submit_and_exit_seen`) — GitHub's Mermaid renderer will reject the whole document
  - mermaid block (lines 18..145) contains a Markdown TABLE ROW at line 61: | Field | Value | — GitHub's Mermaid renderer will reject the whole document
  ... (45 further leaked-Markdown reports)
```

Exit code 1.

Against the corrected document:

```
PASS .../02-c9-bcb-elm-c10-authority.md: 1 mermaid block(s), no Markdown leaked into a mermaid fence
```

Exit code 0.

### Unit tests

```
$ bunx vitest run --config vitest.config.ts src/sdk/__tests__/markdown-mermaid-block-verifier.c9c10mm01.test.ts
 ✓ src/sdk/__tests__/markdown-mermaid-block-verifier.c9c10mm01.test.ts (13 tests) 5ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

The 13 tests cover: the shipped document (one mermaid block, every fence
closed, no Markdown inside the mermaid fence, the fence closes right after
the last diagram edge, the diagram type is `stateDiagram`, the BCB recovery
edge routes through `ElmConsulted` and NOT straight to `C10Committed`, the
terminal transitions are inside the mermaid block); the reconstructed pre-fix
defect (rejected, and the leaked headings and table rows are reported); an
unterminated fence (rejected); a mermaid block with no recognised diagram
type (rejected); and a well-formed document (passes).

## Gates

| Gate | Command | Result |
|---|---|---|
| Real Mermaid parser, corrected doc | mermaid 11.16.1 `parse()` | PASS — `stateDiagram` |
| Real Mermaid parser, pre-fix doc | mermaid 11.16.1 `parse()` | FAIL — line 44, `| Field | Value |` |
| Real Mermaid parser, all 4 lifecycle docs | mermaid 11.16.1 `parse()` | PASS (4/4) |
| New structural guard | `bun run verify:markdown-mermaid-blocks` | PASS — 4 docs, 0 errors |
| Existing contract verifier | `bun run verify:lifecycle-transition-contract` | PASS — "4 transitions, Mermaid synchronized" |
| New guard unit tests | `bunx vitest run --config vitest.config.ts src/sdk/__tests__/markdown-mermaid-block-verifier.c9c10mm01.test.ts` | PASS — 13/13 |
| Typecheck | `bunx tsc --noEmit -p tsconfig.json` (apps/vscode) | PASS — exit 0, 0 diagnostics |
| Lint / format | `biome check` (apps/vscode config) on the new/changed TS | PASS — 0 errors |
| Whitespace | `git diff --check` | PASS — exit 0 |

Vitest emitted the known non-fatal fork-pool `kill EPERM` teardown warning
after all selected tests passed.

## Notes on the validation harness

The repository's `bun install` cannot run in the authoring sandbox (bun
refuses its temporary directory), so the real Mermaid parser was wired up
from the repo's own populated install cache
(`.bun-install/install/cache`), which contains mermaid 11.16.1 and jsdom
26.1.0. The dependency closure (140 packages) was copied into a
project-local `node_modules` under the gitignored `.factory/tmp/`.

Two harness findings are worth recording because they would otherwise look
like diagram defects:

1. Mermaid's label sanitizer calls `DOMPurify.addHook`, so a DOM must exist
   BEFORE mermaid is imported — a plain Node/Bun run fails with
   `DOMPurify.addHook is not a function`, not with a diagram error.
2. `securityLevel` does not affect parsing: `strict`, `loose`, `antiscript`
   and `sandbox` all parse identically.

Neither finding is a property of the diagram; both are properties of running
Mermaid outside a browser. GitHub renders Mermaid in a browser, so neither
applies to the rendered page.
