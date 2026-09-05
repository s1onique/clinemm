# 02 — Dependency Graph

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Generator:** `.factory/tmp/factorize-f0/dep-graph.py`
**Input:** `.factory/tmp/factorize-f0/package-inventory.json`
**Evidence label:** STRUCTURAL (parsed `package.json` `dependencies` field)

---

## Summary

| Metric | Value |
|---|---:|
| Total workspace edges | **37** |
| Cycles | **0** |
| Lower → higher edges (forbidden) | **0** |
| Host → host edges | **1** (`@cline/cli → @cline/cline-hub`) |
| `core → host-app` edges | **0** |
| `agents → core` edges | **0** |
| `shared → higher` edges | **0** |
| Edges with one or both endpoints unclassified | **15** (examples + nested webview packages) |

**Bottom line:** the package dependency graph is acyclic and one-way. There are no upstream-style layering violations at the `package.json` level.

## Reference layer assignment

| Layer | Package |
|---:|---|
| 0 (lowest) | `@cline/shared` |
| 1 | `@cline/llms`, `@cline/ui` |
| 2 | `@cline/agents` |
| 3 | `@cline/core` |
| 4 (public surface) | `@cline/sdk` |
| 5 (hosts) | `clinemm`, `@cline/cli`, `@cline/cline-hub`, `@cline/cline-hub-webview`, `@cline/code` |

## Workspace edges (sorted)

```
@cline/agents          → @cline/llms
@cline/agents          → @cline/shared
@cline/cli             → @cline/cline-hub
@cline/cline-hub       → @cline/core
@cline/cline-hub       → @cline/llms
@cline/cline-hub       → @cline/shared
@cline/cline-hub-webview → @cline/shared
@cline/cline-hub-webview → @cline/ui
@cline/code            → @cline/core
@cline/code            → @cline/llms
@cline/code            → @cline/shared
@cline/code            → @cline/ui
@cline/core            → @cline/agents
@cline/core            → @cline/llms
@cline/core            → @cline/shared
@cline/example-cli-agent           → @cline/sdk
@cline/example-cline-core-cli-agent → @cline/sdk
@cline/example-code-review-bot     → @cline/sdk
@cline/example-multi-agent         → @cline/sdk
@cline/example-quickstart          → @cline/sdk
@cline/example-vscode              → @cline/core
@cline/example-vscode              → @cline/llms
@cline/example-vscode              → @cline/shared
@cline/menubar                     → @cline/core
@cline/menubar                     → @cline/shared
@cline/sdk         → @cline/core
@cline/ui          → @cline/shared
@cline/vscode-rollout (no @cline/* deps)
@cline/analysis    (no @cline/* deps)
clinemm            → @cline/agents
clinemm            → @cline/core
clinemm            → @cline/llms
clinemm            → @cline/shared
webview            → @cline/shared
webview            → @cline/ui
webview-ui         → @cline/shared
webview-ui         → @cline/ui
examples           → @cline/core
```

## Classification of suspicious edges

| Edge | Class | Notes |
|---|---|---|
| `@cline/cli → @cline/cline-hub` | INTENTIONAL_FORK_EXTENSION | CLI composes hub; cline-hub is the daemon |
| `@cline/example-* → @cline/sdk` | INTENTIONAL_FORK_EXTENSION | Examples integrate via the public surface |
| `@cline/example-vscode → @cline/{core,llms,shared}` | INTENTIONAL_FORK_EXTENSION | Reference example host |
| `@cline/menubar → @cline/{core,shared}` | INTENTIONAL_FORK_EXTENSION | Mac menubar host |
| `@cline/vscode → @cline/{core,llms,shared}` | INTENTIONAL_FORK_EXTENSION | Example VS Code host |
| `@cline/code → @cline/{core,llms,shared,ui}` | INTENTIONAL_FORK_EXTENSION | Tauri desktop host |
| `clinemm → @cline/{agents,core,llms,shared}` | INTENTIONAL_FORK_EXTENSION | ClineMM host consumes all four SDK layers |
| `webview-ui → @cline/{shared,ui}` | INTENTIONAL_FORK_EXTENSION | React webview |
| `webview → @cline/{shared,ui}` | INTENTIONAL_FORK_EXTENSION | Example webview subdir |
| `examples → @cline/core` | INTENTIONAL_FORK_EXTENSION | SDK examples reference core |
| `cline-hub-webview → @cline/{shared,ui}` | INTENTIONAL_FORK_EXTENSION | Hub's webview surface |

**No edge is currently classified `LEGACY`, `COMPATIBILITY`, or `UNEXPLAINED`.** The dep graph is clean. If a violation exists, it is not visible at the `package.json` boundary.

## Suspect surfaces (NOT violations — flagged for §14)

1. **`clinemm → @cline/agents`** — the host reaches *below* `@cline/core` into `@cline/agents` directly. Upstream reference model says host apps should compose against `@cline/core` (and `@cline/sdk`). Direct `agents` access from the host is a host-side composition smell, not a layering violation, but it is worth a closer look in §14.
2. **`cline-hub-webview → @cline/ui`** — a *webview* package depends on `@cline/ui`. Whether that constitutes a violation depends on whether `@cline/ui` is host-agnostic (it should be). Recorded for follow-up in §14.
3. **`webview-ui → @cline/ui`** — same as above for the VS Code host. Already known pattern.

## Visual

```
shared ──→ llms ──→ agents ──→ core ──→ sdk
   │                    ▲          ▲
   │                    │          │
   │                    └──────────┘ (core → agents is expected)
   └────────→ ui (host webviews consume ui)
                                  ▲
                                  │ hosts
                  ┌───────────────┼───────────────┐
                  │               │               │
              clinemm        @cline/cli    @cline/code
                  │              │
                  │              └──→ @cline/cline-hub ──→ core/llms/shared
                  │
                  └──→ @cline/agents (direct host→agents)
```

(The "core → agents" edge is the upstream-required direction — agents is *intended* to be re-exported by core. Confirmed in upstream ARCHITECTURE.md.)
