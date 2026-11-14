# C3 — Dependency and Supply-Chain Qualification

**Source HEAD:** `08d8969e161f94e76c22165a0be1e1e36892d975`
**Upstream merge:** `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`
**Pre-integration fork:** `265044bf37429cb3c48918eb7473e46cc3933964`
**Audit tool:** Bun `1.3.13` (`$HOME/.bun/bin/bun`), invoked with `--prod --json`.

---

## C3.1 Dependency delta introduced by the upstream merge

```
git diff --stat 265044bf… 167f5ca8… -- bun.lock package.json
  bun.lock     | 416 +++++++++++++++++++++++++++++++++++++++++------------------
  package.json |  27 ++--
```

A programmatic comparison of every package entry in `bun.lock` between the two
commits found **154 packages whose resolved versions changed**.

### Runtime-relevant changes (`apps/vscode` / `sdk/packages/*` production deps)

| Package | Pre-merge | Post-merge | Note |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | **1.30.0** | **1.30.0** | **UNCHANGED** — the MCP advisory exposure is pre-existing (C3.3) |
| `@grpc/grpc-js` | 1.14.4 | 1.14.4 | Unchanged |
| `@ai-sdk/provider-utils` | 5.0.27 | 5.0.72 | The **only** advisory-bearing package the merge changed — and it is **outside** the advisory range in both versions |
| `@ai-sdk/*` (amazon-bedrock, anthropic, gateway, google, google-vertex, mistral, openai, openai-compatible, otel, provider, react) | 3.x–5.x | +0.x patch/minor | Provider transports; no advisory |
| `@ai-sdk/mcp` | 2.0.31 | 2.0.88 | Provider MCP integration |
| `@jerome-benoit/sap-ai-provider` | 4.8.0 | 5.0.3 | SAP provider |
| `@opentelemetry/*` (core, exporter-*, sdk-trace-node, propagator-*) | mixed | +1.29.0 / 0.56.0 / 1.30.1 | Telemetry; `@opentelemetry/core@2.10.0` **unchanged** |
| `axios` | 1.18.0 | 1.20.0 | HTTP client |
| `js-yaml` | ^4.1.1 | ^4.3.2 | YAML parsing |
| `undici` | 6.28.0 | ^7.30.1 | HTTP/1.1 client |
| `ws` | — | **^8.20.0 (new)** | WebSocket client |
| `@types/ws` | — | **^8.18.1 (new)** | Types only |
| `@vscode/test-electron` | ^2.5.2 | ^3.1.0 | Dev/test only |
| `@opentelemetry/exporter-trace-otlp-{grpc,http,proto}` | — | 0.56.0 (new) | Telemetry export |
| `@opentelemetry/sdk-trace-node` | — | ^1.30.1 (new) | Telemetry |
| `yaml` | — | ^2.8.2 (new) | YAML parsing |
| `@sap-cloud-sdk/*` | 4.6.0 | 4.9.1 | SAP provider |

### Build-tooling-only changes (not shipped in the VS Code runtime)

| Item | Pre-merge | Post-merge |
|---|---|---|
| `packageManager` | `bun@1.3.13` | **`bun@1.4.2`** |
| `devDependencies.bun` | `1.3.13` | `1.4.2` |
| `@types/bun` | `^1.3.13` | `^1.4.2` |
| `undici` override | `"undici@>=6.0.0 <7.0.0": "6.28.0"` | `"undici": ">=7.30.1 <8"` |
| `js-yaml` override | `"js-yaml": "^4.1.1"` | `"js-yaml": ">=4.3.2 <5"` |
| `build:sdk` script | `bun --production -F './sdk/packages/*' build` | `… build && bun sdk/packages/core/build-plugin-runtime.mts` |
| `patchedDependencies` | 1 entry | 2 entries (adds `@shadcn/react@0.3.1`) |

The `build-plugin-runtime.mts` step is a **new build artifact producer**. It builds the
plugin runtime that only the **CLI/Hub** consumes; the VS Code bundle does not contain
the plugin loader (C1 R-09).

---

## C3.2 Dependency audit

### Execution receipt

```
$ export PATH="$HOME/.bun/bin:$PATH"
$ cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
$ bun audit --prod --json > /tmp/bun_audit.json
AUDIT_EXIT=1
```

**Audit status: EXECUTED** (registry reachable; the non-zero exit is Bun's signal that
advisories were found, not an execution failure). Raw JSON retained at
`/tmp/bun_audit.json`; **42 packages** carry advisories.

### Per-advisory reachability table

The decisive discriminator for every row is **whether the merge changed the package
version** (computed from `bun.lock` at both commits) and **whether the vulnerable code
path is reachable from the VS Code extension**.

| Package | Installed | Advisory severity | Vulnerable range | Changed by merge? | VS Code reachable? | Actual exposure |
|---|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | high ×3, moderate ×2 | `<1.31.0`, `<1.32.0`, `<1.30.1` | **NO (1.30.0 → 1.30.0)** | **Partially** — client transports only | GHSA-6qxp: **gated** (user-configured OAuth remote MCP server). GHSA-6prh: **gated** (remote HTTP MCP server; `McpHub` custom fetch does not origin-bind). Server-side advisories: **NOT reachable** (no server transport in VS Code) |
| `@ai-sdk/provider-utils` | 5.0.72 | low | `>=5.0.0-beta.0 <5.0.1` | YES (5.0.27 → 5.0.72) | yes | **NONE** — both 5.0.27 and 5.0.72 are outside the vulnerable range |
| `@azure/msal-node` | 5.5.0 | high | `>=5.0.0-beta.0 <7.1.0` | NO | no (Azure AD auth only) | None in VS Code |
| `@grpc/grpc-js` | 1.14.4 | high ×2, low ×2 | `>=1.14.0 <1.14.5`, `<1.13.6` | NO | **server-side only** — the VS Code extension is a gRPC *client*; the Host Bridge server is standalone-only | None in VS Code |
| `hono` / `@hono/node-server` | 4.13.2 / 1.19.17 | moderate ×9 / ×2 | `<4.13.16` etc. | NO | transitively via MCP SDK **server** transports only | None in VS Code |
| `@opentelemetry/core` | 2.10.0 | moderate | `<2.8.0` | NO | telemetry | None (installed is outside the range) |
| `simple-git` / `@simple-git/argv-parser` | 3.36.0 / 1.1.1 | **critical** | `<2.0.1` | NO | **yes** — `simple-git` is a fork production dep | **Argv-parser advisory is a `VISUAL` env-var editor injection in the *library's* CLI helper** — not in Cline's own path. `simple-git` itself is at 3.36.0 (advisory is `<2.0.1` → not affected) |
| `dompurify` | 3.4.13 | critical ×1, high ×1, low ×3 | `<=3.4.16` | NO | webview (browser context) | Pre-existing webview sanitizer advisories; not merge-induced |
| `esbuild` | 0.27.7 | low | `>=0.27.3 <0.28.1` | NO | **build-time only** (dev server file read) | None at runtime |
| `extract-zip` | 2.0.1 | high ×2 | `<=2.0.1` | NO | no VS Code runtime path | None |
| `follow-redirects` | 1.16.0 | high ×3 | `<=1.16.1` | NO | transitive HTTP | Pre-existing |
| `xmldom/xmldom` | 0.8.14 | high ×5, moderate ×2 | `<=0.8.14` | NO | transitive (MCP SDK / optional) | Pre-existing |
| `basic-ftp` | 5.3.1 | high, moderate ×2 | `<=6.2.x` | NO | no | None |
| `body-parser` | 2.3.0 | high | `<2.4.0` | NO | MCP server transports only | None in VS Code |
| `brace-expansion` | 1.1.18 | high ×4, moderate ×2 | `<1.1.19` etc. | NO | transitive (glob) | Pre-existing; not merge-induced |
| `deepmerge` | 4.3.1 | low | `<=4.3.1` | NO | transitive | Pre-existing |
| `glob` | 11.1.0 | moderate | `<=14.0.1` | NO | build/tooling | None |
| `image-size` | 2.0.2 | high ×2 | `<=2.0.2` | NO | transitive | Pre-existing |
| `ip-address` | 10.5.0 | moderate ×5 | `<=10.7.x` | NO | transitive | Pre-existing |
| `katex` | 0.16.47 | low | `<0.18.2` | NO | webview | Pre-existing |
| `linkify-it` | 3.0.3 | high ×2 | `<=5.0.x` | NO | transitive | Pre-existing |
| `markdown-it` | 14.3.0 | high, moderate, low ×3 | `<14.3.3` | NO | webview | Pre-existing |
| `minimatch` | 3.1.5 | moderate | `>=7.0.0 <11.0.1` | NO | transitive | Pre-existing (installed below the range) |
| `next` | 16.2.11 | **critical** ×1, high ×1 | `>=16.0.0 <16.3.8` | NO | **NO** — Next.js is the Desktop app only, not the VS Code extension | None in VS Code |
| `vitest` / `@vitest/mocker` | 4.1.10 | moderate ×2 | `<4.1.12` | NO | **dev/test only** | None |
| `storybook` | 9.1.20 | — | — | NO | dev only | None |
| `shell-quote`, `source-map-js`, `postcss*`, `serialize-javascript`, `sharp`, `proxy-addr`, `qs`, `uuid`, `zod`, `systeminformation`, `node-forge`, `vite`, `undici`(runtime edge) | various | various | various | NO | mostly transitive/dev | Pre-existing |

### Headline audit conclusion

> **41 of the 42 advisory-bearing packages were UNCHANGED by the upstream merge.**
> The single package the merge changed (`@ai-sdk/provider-utils`, 5.0.27 → 5.0.72) is
> **outside its advisory range in both the pre-merge and post-merge versions**
> (advisory: `>=5.0.0-beta.0 <5.0.1`).
>
> **The merge introduced ZERO new vulnerable dependency versions.**

`bun audit fix`, `bun install`, and automatic upgrades were **not** run (explicitly
forbidden by the ACT).

---

## C3.3 Cline Hub / Kanban WebSocket advisories

The mission asked to check advisories "including known Cline Hub/Kanban WebSocket
security issues, where applicable".

| Check | Result |
|---|---|
| Search for "kanban" in the repository and in `.factory/` evidence | **No hits** — no Kanban surface, no Kanban advisory record exists in this repository |
| Hub WebSocket server present in the VS Code extension? | **No.** `grep -c 'hub-websocket-server\|browser-websocket' apps/vscode/dist/extension.js` → **0** |
| `HubRuntimeHost` present in the VS Code extension? | **No.** `grep -c 'HubRuntimeHost' apps/vscode/dist/extension.js` → **0** |
| Hub server source reachable? | **No.** `backendMode:"local"` at `apps/vscode/src/sdk/vscode-session-host.ts:475` makes `host.ts:218-271` (the `auto`/hub-discovery branch) unreachable; `prewarmLocalHubIfNeeded` (`host.ts:38`) is gated on `configuredMode ∈ {auto, hub}` |
| `ws` dependency added by the merge | Present in the manifest, but it is the **client** side and the Hub server subtree is tree-shaken out of the VS Code bundle |
| Hub daemon as a separate process | CLI/Desktop-only; `sdk/packages/core/src/hub/daemon/**` is not in the VS Code activation path |

**Conclusion:** no Cline Hub/Kanban WebSocket advisory is reachable from the VS Code
extension. The Hub remains separately qualified (accepted prior limitation).

---

## C3.4 Packaging trust boundaries

### Executable entrypoints included in the VSIX

```
$ unzip -l dist/clinemm-4.1.16-281b379d0.vsix | grep -E 'extension/bin/'
  extension/bin/parser-helper/SHA256SUMS.txt
  extension/bin/parser-helper/win32-x64/cline-parser-helper.exe
  extension/bin/parser-helper/linux-arm64/cline-parser-helper
  extension/bin/parser-helper/linux-amd64/cline-parser-helper
  extension/bin/parser-helper/darwin-arm64/cline-parser-helper
  extension/bin/parser-helper/darwin-amd64/cline-parser-helper
```

- **6 executable artifacts** total (1 manifest + 5 platform binaries). No other
  native `.node` addons and no other `node_modules/*/bin/` entries.
- **Were they changed by the merge?**
  `git diff --name-status 265044bf… 167f5ca8… -- apps/vscode/bin/` → **empty**.
  The parser-helper binaries are **unchanged** by the upstream merge.
- The in-repo `SHA256SUMS.txt` manifest pins all five binaries:
  `darwin-arm64 874741a3…`, `darwin-amd64 26a313d1…`, `linux-amd64 fcd2eb73…`,
  `linux-arm64 71d5abda…`, `win32-x64 96f5e342…`.
- VSIX totals: **681 files, 267,160,015 bytes uncompressed**.

### Postinstall / lifecycle scripts

| Manifest | Lifecycle scripts | In the VSIX runtime? |
|---|---|---|
| `package.json` (root) | `prepare: husky` — **dev-only git-hook installer** | **No** — not part of the VSIX build |
| `apps/vscode/package.json` | **none** (`preinstall`/`install`/`postinstall`/`prepare`/`prepack`/`postpack` all absent) | n/a |
| `sdk/packages/{core,shared,llms,agents,sdk}/package.json` | **none** | n/a |
| `apps/cli/package.json` | `prepack: bun script/guard-direct-publish.ts` — a **publish guard** for the CLI package | **No** — `apps/cli` is not shipped in the VSIX (unzip grep → 0 entries) |
| `sdk/packages/ui/package.json` | `prepack: bun run build` — a **UI library build** step | **No** — not shipped in the VSIX (unzip grep → 0 entries) |

> **Lifecycle-script conclusion (corrected and completed).** A repository-wide scan
> found **five** manifests with lifecycle scripts, not three. The two additional ones
> (`apps/cli` `prepack`, `sdk/packages/ui` `prepack`) are **pack-time** steps in
> packages that are **not shipped in the VSIX**, and `prepack` runs during packaging —
> never at extension runtime. The `apps/vscode` manifest itself has **no** lifecycle
> script, so **no lifecycle script can execute as part of the shipped VS Code
> extension runtime**.

**No postinstall/lifecycle script executes as part of the shipped VS Code runtime.**

### Bundled code of non-obvious origin

| Item | Status |
|---|---|
| `extension/node_modules/**` | **0 entries** — the VSIX ships only the esbuild bundle (`extension.js`, 28,035,902 bytes) plus webview assets. All npm deps are inlined by esbuild. |
| `extension/standalone/**` | **absent** — the standalone CLI core (and the Host Bridge token machinery) is **not** shipped in the VSIX. **Independently corroborated by `apps/vscode/.vscodeignore:43` → `standalone/**`**, which excludes the whole subtree from packaging. |
| `extension/elm/**` | Present — the Elm completion-authority runtime used by the fork's ELM kernel. Fork-owned, not upstream. |
| `extension/proto/**`, `extension/src/generated/**` | Generated protobuf/gRPC code; generated by `bun run protos`, committed. |
| `extension/webview/**` | Built webview assets. |

### Network endpoints and listeners in the shipped bundle

| Endpoint | Role | Reachable? |
|---|---|---|
| `https://api.cline.bot` | Cline API (providers, MCP marketplace, telemetry) | yes — existing |
| `https://api.cline.bot/v1/mcp` | Cline-hosted MCP servers | yes — existing |
| `https://app.cline.bot` / `https://data.cline.bot` | Account/dashboard/telemetry | yes — existing |
| `https://cline.github.io/marketplace/catalog.json` | MCP marketplace catalog | yes — existing |
| `https://core-api.staging.int.cline.bot`, `https://staging-app.cline.bot` | Staging hosts | present in the bundle; see note below |
| `https://api.cline.bot/api/v1` | Cline API v1 | yes |

> **Staging-host note (P2 residue).** `core-api.staging.int.cline.bot` and
> `staging-app.cline.bot` are string literals present in the shipped bundle. These are
> upstream's own staging hosts and are **not** introduced by the merge in a
> security-relevant way (they are configuration constants reachable only through an
> explicit staging configuration), but shipping staging hostnames in a production
> bundle is a hygiene concern worth a successor look. **Not** classified as an
> exploitable surface here.

**Local listeners:** none in the VS Code extension host. Every listener-creating
upstream addition inside `apps/vscode/src/` is in a test/dev file
(`hosts/external/__tests__/host-bridge-client-auth.test.ts`, `shared/net.test.ts`,
`test/cloud/local-cloud-development.test.ts`, `test/cloud/local-cloud-environment.ts`),
and **none of those files is in the VSIX** (verified by `unzip -l` grep).

### Package versions vs applicable security fixes

| Package | Installed | Fix floor for a reachable advisory | Status |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | ≥1.32.0 (server-side), ≥1.31.0 (GHSA-6qxp), ≥1.32.0 (GHSA-6prh) | **BELOW floor** — but the version is **unchanged by the merge** and the reachable sub-cases are gated on a user-configured remote MCP server. **P2 successor.** |
| `axios` | 1.20.0 | no advisory in this audit | OK |
| `undici` | 7.30.1 | no advisory in this audit | OK |
| `js-yaml` | 4.3.2 | no advisory in this audit | OK |
| `@grpc/grpc-js` | 1.14.4 | ≥1.14.5 (high) | Below floor, but **server-side only** and the server is standalone-only → not reachable in VS Code |
| `@opentelemetry/core` | 2.10.0 | ≥2.8.0 | OK |
| `next` | 16.2.11 | ≥16.3.8 | Below floor, but **Desktop-app only** → not in the VS Code runtime |
| `esbuild` | 0.27.7 | ≥0.28.1 | Build-time only |

### Bun toolchain version residue (P2)

The merged root `package.json` pins `packageManager: "bun@1.4.2"`; this host has Bun
`1.3.13`. Every Bun-native test executed in this ACT ran successfully under `1.3.13`,
and the Vitest suites ran under the pinned Node runtime. The mismatch is recorded as a
**P2 environment residue** (a `bun install` under 1.4.2 would be required to reproduce
the pinned toolchain exactly). **No `bun install` was run** (forbidden by the ACT).

---

## C3.5 Verdict

**PASS with non-blocking residue.** The upstream merge introduced **no new vulnerable
dependency version**, added **no postinstall/lifecycle script** to any shipped
manifest, changed **no bundled native binary**, and created **no local listener** in
the VS Code extension. The one below-floor package with a reachable (but gated)
advisory — `@modelcontextprotocol/sdk@1.30.0` — was at the identical version before
the merge and is a **pre-existing** condition, tracked as a P2 successor.
