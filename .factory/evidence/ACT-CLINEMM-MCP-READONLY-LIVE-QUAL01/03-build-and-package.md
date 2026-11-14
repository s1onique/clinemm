# C2 — Build, package, and artifact identity

**ACT:** `ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01`

---

## C2.1 The exact source HEAD

| Field | Value |
|---|---|
| Repository | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| Branch | `main` |
| **Source HEAD (the VSIX's source)** | **`bbf8d7b6116d9f04023691e98dc91f5292046b50`** |
| HEAD tree | `863d5128879c8c21bd71a278841e0037070f302f` |
| HEAD subject | `fix(control-seam): ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — bounded P1 correction to the read-only MCP control seam` |
| Parent HEAD | `cc6aa0987c92c90fd3b3156552931bce12d1367e` (RECON01) |
| Extension version | `4.1.16-5a1c485cb` |
| Working tree at build time | CLEAN (only the untracked evidence directory) |

---

## C2.2 The executed gates

| Gate | Command | Exit | Result |
|---|---|---|---|
| Focused tests | `bun x vitest run --config vitest.config.ts src/sdk/control-seam/` | **0** | **50/50 passed** (4 files: 21 QUAL01 + 21 RECON01 + 5 proxy + 3 production-shape) |
| TypeScript | `bun x tsc --noEmit` | **0** | clean (no diagnostics) |
| TypeScript (vscode-compat) | `bun x tsc --project tsconfig.vscode-compat.json --noEmit` | **0** | clean (run as part of `vscode:prepublish`) |
| Lint (control-seam scope) | `bun x biome lint --config-path ./biome.jsonc … --diagnostic-level=error src/sdk/control-seam/` | **0** | `Checked 14 files … No fixes applied.` |
| Lint (whole package) | `bun run lint` (inside `vscode:prepublish`) | **0** | `Checked 2821 files in 45s. No fixes applied.` + `proto-lint.sh` clean |
| Proto lint | `bash ./scripts/proto-lint.sh` | **0** | clean |
| Webview build | `bun run build:webview` (inside `vscode:prepublish`) | **0** | `✓ built in 51.38s` |
| Extension bundle (dev) | `bun esbuild.mjs` | **0** | `dist/extension.js` 57 621 911 bytes, sha256 `b5319351e5384a31a4f53b8495664ada1401d387d91c3b5234e79ba7bcbd9740` |
| **Extension bundle (production)** | `bun esbuild.mjs --production` | **0** | `dist/extension.js` **28 047 098 bytes**, sha256 `63e79d80f3b216ad7009e1ed5ab8f1c0951d742a791fc95632b3e21b0cf6fa1b` |
| VSIX packaging | `bun x @vscode/vsce package --no-dependencies --out ../../dist/<name>.vsix` | **0** | `DONE Packaged: … (681 files, 62.31 MB)` |

> The `vsce` prepublish hook shells out to `npm run vscode:prepublish`; npm is
> present on this host at `/opt/homebrew/bin/npm` (11.12.1) and was added to
> `PATH` for the packaging step only. The repository's own tooling remains
> bun-only — this is `vsce`'s invocation, not the repo's.

### The seam is present in the production bundle

```
$ grep -o 'ControlSeam'                       dist/extension.js | wc -l   →  71
$ grep -o 'control_seam_payload_too_large'     dist/extension.js | wc -l   →   2
$ grep -o 'CLINEMM_CONTROL_SEAM_FORCE'         dist/extension.js | wc -l   →   1
$ grep -o 'already owned by a live instance'   dist/extension.js | wc -l   →   1
$ grep -o 'clinemm_get_run'                    dist/extension.js | wc -l   →   5
$ grep -o 'clinemm_capabilities'               dist/extension.js | wc -l   →   5
```

Every correction artifact is in the shipped bundle, and the two read-only
operation ids are present.

---

## C2.3 The VSIX artifact — exact identity

| Field | Value |
|---|---|
| **Path** | **`dist/clinemm-4.1.16-5a1c485cb-bbf8d7b6-mcp-readonly-qual01.vsix`** |
| **Bytes** | **65 335 668** |
| **SHA-256** | **`7825199be6e0270dfd2c1fce0e090048e83c05385924954199fcdf5dd64333c5`** |
| Contents | 681 files, 62.31 MB reported by `vsce` |
| Built from source HEAD | `bbf8d7b6116d9f04023691e98dc91f5292046b50` |

---

## C2.4 The embedded `extension.js` MATCHES the qualified build

The VSIX was unzipped and the embedded bundle compared byte-for-byte with
the qualified production build:

```
$ unzip -q dist/clinemm-4.1.16-5a1c485cb-bbf8d7b6-mcp-readonly-qual01.vsix -d /tmp/vsix-extract
$ shasum -a 256 /tmp/vsix-extract/extension/dist/extension.js
63e79d80f3b216ad7009e1ed5ab8f1c0951d742a791fc95632b3e21b0cf6fa1b  extension/dist/extension.js
$ shasum -a 256 apps/vscode/dist/extension.js
63e79d80f3b216ad7009e1ed5ab8f1c0951d742a791fc95632b3e21b0cf6fa1b  apps/vscode/dist/extension.js
```

**IDENTICAL.** The VSIX carries exactly the bundle that was qualified by
the TypeScript, lint, build and test gates above.

The same four correction markers were re-counted **inside the extracted
VSIX**, not just the repo-local bundle:

```
$ grep -o 'ControlSeam'                     /tmp/vsix-extract/extension/dist/extension.js | wc -l  →  12
$ grep -o 'CLINEMM_CONTROL_SEAM_FORCE'       /tmp/vsix-extract/extension/dist/extension.js | wc -l  →   1
$ grep -o 'already owned by a live instance' /tmp/vsix-extract/extension/dist/extension.js | wc -l  →   1
$ grep -o 'control_seam_payload_too_large'   /tmp/vsix-extract/extension/dist/extension.js | wc -l  →   1
```

---

## C2.5 Packaging is NOT installation evidence

The VSIX was **not** installed by this ACT. The operator installs it — see
`OPERATOR-PROCEDURE.md` §2 and `04-live-qualification.md`.

The VSIX's existence proves only that the qualified source builds,
packages, and carries the qualified bundle. It proves **nothing** about the
installed runtime.
