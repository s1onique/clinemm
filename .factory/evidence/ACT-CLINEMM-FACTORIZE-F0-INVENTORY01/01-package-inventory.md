# 01 — Package Inventory

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Generator:** `.factory/tmp/factorize-f0/package-inventory.py` (Python; Node/bun unavailable in this environment)
**Evidence:** `.factory/tmp/factorize-f0/package-inventory.json`
**Evidence label:** STRUCTURAL (file-system + parsed package.json)

---

## Trust

| Field | Value |
|---|---|
| ENTRY_HEAD | `a523f9471325f4b39488d4f9744d82a0b02cffce` |
| BRANCH | `main` |
| WORKTREE | clean |

## Headline counts

| Classify | Packages | Source LOC | Test LOC | Source Files | Test Files |
|---|---:|---:|---:|---:|---:|
| sdk-package (`@cline/*`) | 20 | 1,417,087 | 604,549 | 3,860 | 1,705 |
| vscode-host (ClineMM extension) | 1 | 339,017 | 153,575 | 1,090 | 462 |
| other (subdirs / test fixtures) | 10 | 83,347 | 20,216 | 455 | 96 |
| **Total walkable** | **31** | **1,839,451** | **778,340** | **5,405** | **2,263** |

The huge `.vscode-test/*` subtree (VS Code bundled extensions + fixtures) is excluded.

**Note on `@cline/packages`:** The monorepo root counts 2,442 source files because it includes `apps/vscode/src/`, `apps/vscode/webview-ui/`, and several smaller host packages — these are nested package.json files that the probe correctly walks *through*, not into. This is why the ClineMM host appears in both rows. To get host-only numbers, see the `vscode-host` row.

## SDK package matrix

| Name | Path | Publishable | Internal deps | Source LOC | Test LOC | Files (src/test) |
|---|---|:-:|---|---:|---:|---|
| `@cline/shared` | `sdk/packages/shared` | no | — | 18,606 | 6,751 | 93 / ? |
| `@cline/ui` | `sdk/packages/ui` | yes | `@cline/shared` | 8,636 | 3,805 | 41 / ? |
| `@cline/llms` | `sdk/packages/llms` | no | `@cline/shared` | 187,308 | 23,138 | 80 / ? |
| `@cline/agents` | `sdk/packages/agents` | no | `@cline/llms`, `@cline/shared` | 8,671 | 15,945 | 24 / ? |
| `@cline/core` | `sdk/packages/core` | yes | `@cline/agents`, `@cline/llms`, `@cline/shared` | 110,589 | 107,650 | 345 / ? |
| `@cline/sdk` | `sdk/packages/sdk` | yes | `@cline/core` | 2 | 0 | 1 / 0 |

## Host apps

| Name | Path | Publishable | Internal deps | Source LOC | Test LOC |
|---|---|:-:|---|---:|---:|
| `clinemm` (VS Code extension) | `apps/vscode` | no | `@cline/agents`, `@cline/core`, `@cline/llms`, `@cline/shared` | 339,017 | 153,575 |
| `@cline/cli` | `apps/cli` | yes | `@cline/cline-hub` | 59,505 | 34,864 |
| `@cline/cline-hub` | `apps/cline-hub` | no | `@cline/core`, `@cline/llms`, `@cline/shared` | 35,414 | 2,144 |
| `@cline/cline-hub-webview` | `apps/cline-hub/src/webview` | no | `@cline/shared`, `@cline/ui` | 29,676 | 147 |
| `@cline/code` (Tauri desktop) | `apps/examples/desktop-app` | no | `@cline/core`, `@cline/llms`, `@cline/shared`, `@cline/ui` | 56,256 | 26,575 |
| `webview-ui` (VS Code webview) | `apps/vscode/webview-ui` | private | `@cline/shared`, `@cline/ui` | 53,331 | 18,179 |

## Observations

1. **Layering matches the upstream reference at the package level.** `shared` → `llms` → `agents`/`ui` → `core` → `sdk` is the canonical direction. The VS Code host (`clinemm`) imports from all four SDK layers — that is intentional host composition, not a layering violation.
2. **`@cline/sdk` is a 2-LOC barrel** (publishing only). It is the public re-export surface — `1` source file, `0` test LOC. This is the package boundary every external integration target lands on.
3. **`@cline/core` carries 107,650 test LOC** — the largest test suite in the SDK by far, ~equal to its production LOC (110,589). That is an unusually strong test/impl ratio and suggests the SDK is being qualified aggressively (likely from the FACTORY cadence).
4. **`@cline/llms` is heavily production-weighted** (187,308 source vs 23,138 test LOC). Test/impl ≈ 12.4 %. Worth comparing to upstream `llms` later.
5. **`@cline/agents` is test-heavy** (8,671 src vs 15,945 test). The agents runtime is small but exercised aggressively — consistent with the "stateless runtime loop, test it hard" upstream model.
6. **VS Code host (`clinemm`) is 339,017 source LOC** with **153,575 test LOC** (45.3 % ratio). Inside the host, the `webview-ui` package contributes ~53k source + ~18k test. The host therefore has roughly **285k host-backend source LOC** beyond the webview.
7. **The monorepo root (`@cline/packages`) is a meta-workspace** with `private: true` and `publishable: false`. It hosts `apps/vscode`, `apps/vscode/webview-ui`, and several other sub-packages. It is not a separate architectural layer; it is a bundle marker.
8. **There is a separate `cline-core` package at `apps/vscode/standalone/runtime-files/cline-core`** (1,520 LOC, 0 tests). This is a *bundled artifact* for standalone CLI use, not a source package. F0 flags it as **structurally interesting** — see §14 (Package Boundary Diff).

## Items the probe deliberately does not classify

- Test infrastructure (`apps/vscode/testing-platform`, `evals/analysis`, `sdk/examples/*`) — included in the table but not in the architectural analysis.
- VS Code test fixture tree (`.vscode-test/*`) — excluded entirely.
- Generated protobuf / grpc outputs (counted as part of the host/source tree where they live, but not as separate packages).

---

## Correction addendum (C1 closure 2026-09-05)

**Relabel `PRODUCTION_LOC` -> `WALKABLE_SOURCE_LOC` and `TEST_LOC` -> `WALKABLE_TEST_LOC`**.

Reviewer P2: the 1,839,451 / 778,340 counts are walkable-source-tree counts.
Generated protobuf/grpc outputs may be included wherever they live, and some
package rows are nested/overlapping.

Revised metric semantics:

```
1,839,451 production LOC
  = WALKABLE_SOURCE_LOC, NOT hand-authored production LOC

778,340 test LOC
  = WALKABLE_TEST_LOC, NOT necessarily vitest/mocha authored LOC
```

No effect on any load-bearing conclusion (F0 ranks by file distribution,
Git history, and semantic inspection, not by raw LOC totals).
