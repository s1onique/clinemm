# ACT-CLINEMM-C9C10-MERMAID-RENDER-FIX01 — GitHub rendering evidence

**Verdict:** `CLOSED_CLEAN`

The C9 → C10 diagram renders successfully on GitHub `main` at commit
`b5fac85da`.

## The pushed commit

```
$ git push origin main
To github.com:s1onique/clinemm.git
   38cb209ff..b5fac85da  main -> main
```

The file served by GitHub for `main` is byte-identical to the local one:

```
$ curl -sS "https://api.github.com/repos/s1onique/clinemm/contents/docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md?ref=main" \
    -H 'Accept: application/vnd.github.raw+json' -o /tmp/gh-raw.md
$ diff /tmp/gh-raw.md docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md && echo IDENTICAL
IDENTICAL
$ grep -n '```' /tmp/gh-raw.md
18:```mermaid
59:```
149:```
157:```
190:```
210:```
```

## GitHub's own renderer — the decisive check

The document was submitted to GitHub's **Markdown API**
(`POST https://api.github.com/markdown`, `mode: gfm`), which runs the SAME
server-side Markdown pipeline that produces the rendered blob page and hands
Mermaid blocks to GitHub's viewscreen Mermaid renderer.

### POST-FIX — the diagram is handed over as PURE Mermaid

```
POST-FIX: rendered_bytes=24999  mermaid_error_markers=0
         mermaid container present: True
         payload contains '| Field | Value |': False
         payload contains '## Load-bearing transitions': False
```

The rendered HTML for the "The C9 → C10 chain" section:

```html
<h2>The C9 → C10 chain</h2>
<section class="js-render-needs-enrichment render-needs-enrichment position-relative"
         data-identity="0bdebe5b-..."
         data-host="https://viewscreen.githubusercontent.com"
         data-src="https://viewscreen.githubusercontent.com/markdown/mermaid?docs_host=..."
         data-type="mermaid"
         aria-label="mermaid rendered output container">
  <div class="js-render-enrichment-target" data-json="{&quot;data&quot;:&quot;stateDiagram-v2\n direction TB\n\n [*] --&gt; TurnRunning : turn starts\n ...&quot;}"></div>
</section>
```

GitHub classifies the block as `data-type="mermaid"` and forwards a payload
that contains the diagram source ONLY. The Markdown headings and tables are
NOT in the payload.

### PRE-FIX — the same check reproduces the reported failure

The pre-fix document (`git show HEAD~1:...`, i.e. before the fix) submitted
to the SAME API:

```
PRE-FIX: rendered_bytes=30881  mermaid_error_markers=0
         mermaid container present: True
         payload contains '| Field | Value |': True
         payload contains '## Load-bearing transitions': True
```

**GitHub shipped the Markdown tables and headings to its Mermaid renderer.**
The payload GitHub sent to `viewscreen.githubusercontent.com/markdown/mermaid`
literally contained `| Field | Value |` and `## Load-bearing transitions`.

This is the root cause of the reported failure, observed from GitHub's own
side: the Mermaid renderer received a document that is not a Mermaid diagram
and rejected it at the first table row (line 44). After the fix, that payload
contains the diagram and nothing else.

Note on the `mermaid_error_markers=0` count on the PRE-FIX run: GitHub's
Markdown API emits the Mermaid *container* server-side and lets the
client-side renderer produce the error, so the error text is not in the
API's HTML. The diagnostic that distinguishes the two runs is therefore the
PAYLOAD CONTENT, which shows exactly what GitHub forwards to the Mermaid
renderer. The renderer-side rejection of that payload is independently
reproduced by the real Mermaid parser in
`01-mermaid-render-fix.md` (line 44, `| Field | Value |`).

## The rendered page

```
https://github.com/s1onique/clinemm/blob/main/docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md
```

- The document renders its `stateDiagram-v2` diagram.
- The Markdown headings render as headings — the fetched page shows
  `Chart 02 — C9 / BCB / Elm / C10 Completion Authority` (h1),
  `The four actors`, `The C9 → C10 chain`, `Load-bearing transitions`
  (h2), and `A-01` … `A-06`, `The LIVE incident, traced`,
  `What the evidence DOES establish`, `What the evidence does NOT
  establish`, `The causal chain (confirmed by the RED witness)`,
  `The repair` (h3).
- The Markdown tables render as tables — the fetched page shows the
  `Actor | What it is | Where` table and the
  `Path | What happens to the completion row` table with their cell
  contents intact.
- No Mermaid syntax error text appears anywhere on the page.

## Summary

| Check | Pre-fix | Post-fix |
|---|---|---|
| GitHub Mermaid container (`data-type="mermaid"`) | present | present |
| Markdown inside GitHub's Mermaid payload | **YES** (`| Field | Value |`, `## Load-bearing transitions`) | **NO** |
| Real Mermaid parser on the block | FAIL — line 44 | PASS — `stateDiagram` |
| Markdown headings render as headings | yes (as raw text inside the diagram) | yes |
| Markdown tables render as tables | no (swallowed by the diagram) | yes |
| Mermaid syntax error on the page | yes | **no** |
