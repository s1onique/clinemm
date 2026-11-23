# 13 — CORRECTION01 packaging and embedded-bundle verification

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01
**Classification:** STRUCTURAL

## VERDICT

```
PASS — the VSIX is built from the exact committed HEAD and its embedded
       bundle is byte-identical to the local build.
```

## The artifact

The VSIX is rebuilt and repackaged from the **exact committed HEAD**, as the
review required. The previously packaged VSIX
(`clinemm-4.1.26-7490a12a5-av01.vsix`) is **not** used as evidence for the
correction: it was built from `7490a12a5` **plus uncommitted changes** and
therefore does not contain the CORRECTION01 fix.

```text
SOURCE_HEAD:  1fac5c871d05287c64a7f7f83edfad4fc3c7b14e
BRANCH:       main
VSIX_PATH:    dist/clinemm-4.1.26-1fac5c871-corr01.vsix
VSIX_BYTES:   65047022
VSIX_SHA256:  4fd0e7b2bb861bb1d3f6071b0e77ccfae5fcfacbc070ee0f6cd6b2e55231c899
BUNDLE_SHA256: ca970de4af3c14663d0540a1dd178125d78cf419a6d1b5455457b07758e3b6f3
              (apps/vscode/dist/extension.js — the locally built bundle)
EMBEDDED_BUNDLE_SHA256:
              ca970de4af3c14663d0540a1dd178125d78cf419a6d1b5455457b07758e3b6f3
              (extension/dist/extension.js, extracted FROM the VSIX)
```

### The embedded bundle is byte-identical to the local build

The bundle was extracted from the packaged VSIX and hashed independently:

```text
$ unzip -o -q dist/clinemm-4.1.26-1fac5c871-corr01.vsix "extension/dist/extension.js"
$ shasum -a 256 extension/dist/extension.js
ca970de4af3c14663d0540a1dd178125d78cf419a6d1b5455457b07758e3b6f3
$ shasum -a 256 apps/vscode/dist/extension.js
ca970de4af3c14663d0540a1dd178125d78cf419a6d1b5455457b07758e3b6f3
```

**MATCH.** The packaged artifact is genuinely bound to the committed source.

## The correction is verifiably PRESENT in the shipped bundle

The two P0 fixes were read back out of the **minified, packaged** bundle —
not from the source tree. This is the strongest available evidence that the
correction reached the shipped artifact.

The producer seam (`buildSessionConfig`) in the embedded bundle:

```js
j = !!t.sessionId?.trim(),
z = j ? H.getBoundOrPersisted(t.sessionId) : H.peekArmed(),
$ = j ? Xxl() : Yxl(),
```

| Fragment | Meaning | Gate |
|---|---|---|
| `!!t.sessionId?.trim()` | the session-identity split | **P0-1** |
| `j ? H.getBoundOrPersisted(t.sessionId) : H.peekArmed()` | an EXISTING session NEVER consults the armed slot | **P0-1** |
| `$ = j ? Xxl() : Yxl()` | RESTORE secret semantics for an existing session, START for a new one | **P0-2** |

The store, in the embedded bundle:

```js
getBoundOrPersisted(e) {
  let r = e?.trim();
  if (!r) return;
  let n = this.getBound(r);
  if (n) return n;
  let o = uEl(r);              // readPersistedSessionVocabulary(sessionId)
  if (o) return { vocabulary: o };
}
clearBound() {
  let e = this.bound?.sessionId;
  this.bound = void 0;
  e && cEl(e);                 // clearPersistedSessionVocabulary(sessionId)
}
```

and the consumption point persists the vocabulary on bind:

```js
this.bound = { sessionId: e, contract: r }, lEl(e, r.vocabulary), r
```

`lEl` is `persistSessionVocabulary`, `cEl` is
`clearPersistedSessionVocabulary` and `uEl` is
`readPersistedSessionVocabulary`.

Marker counts in the embedded bundle:

```text
getBoundOrPersisted                     2 occurrences
adjudicationSessionVocabularies        14 occurrences
## The build gates that produced it

```text
bun run build:sdk       -> exit 0 (core, agents, sdk, llms, ui, shared)
bun run build:webview   -> exit 0 (protos + vite build)
bun esbuild.mjs --production -> exit 0
bun run protos          -> exit 0 (25 proto files compiled, no syntax errors)
bun x tsc --noEmit      -> exit 0 (0 diagnostics)
biome lint (3126 files) -> exit 0
bash ./scripts/proto-lint.sh -> exit 0
vsce package            -> exit 0 (693 files, 62.03 MB)
```

## A pre-existing generator defect found and fixed during packaging

The `vsce package` prepublish chain re-ran the pre-commit hook's
`scripts/generate-state-proto.mjs`, and the generator produced an **invalid**
`state.proto` that `protoc` rejects:

```text
cline/state.proto:372:2: Expected top-level statement
cline/state.proto:400:1: Unmatched "}"
```

This is the SAME corruption class the repository has already hit twice
(`c0cb2f679`, `80c13886c`); it was previously repaired by hand each time.
It was triggered here because CORRECTION01 adds secret keys, which makes the
pre-commit hook regenerate `state.proto`.

Two distinct root causes were found and fixed in the generator itself
(commit `1fac5c871`):

1. **The message-boundary regex.** `replaceMessage()` located the message
   with `message\s+<name>\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}`, which matches a
   closing brace that lives inside a COMMENT. The `Settings` message carries
   the comment `// Wire format: serialized JSON array of { path, expiresAt }.`,
   so the regex stopped in the MIDDLE of the message and the replacement left
   the tail dangling outside any message block. It is now a brace-counting
   scan that skips line comments, block comments and quoted strings.

2. **Silently deleted wire fields.** The generator derived the `Settings`
   message purely from `state-keys.ts`, so any field no longer declared
   there was DELETED on regeneration. That removed
   `auto_approve_all_toggled = 174` (still read by the legacy VS Code
   migration at `src/hosts/vscode/vscode-to-file-migration.ts`) and
   `clear_user_context_ceiling = 188` (the explicit Auto/reset signal the
   webview sends alongside `user_context_ceiling`). Both were restored
   deliberately in `c0cb2f679` and were being deleted again by the same
   class of bug. `PRESERVED_SETTINGS_FIELDS` now keeps them.

The generator is now **idempotent** (a second pass is byte-identical) and
its output is **valid** (`protoc` parses it cleanly).

### The resulting proto diff is exactly the intended change

```diff
+  optional string adjudication_session_secrets = 51;
+  optional string adjudication_session_vocabularies = 52;
   optional bool auto_approve_all_toggled = 174;      (preserved)
   optional bool clear_user_context_ceiling = 188;     (preserved)
```

No unrelated wire field was added, removed or renumbered.

## What is NOT claimed

```text
INSTALLED-LIVE QUALIFICATION:  NOT EXECUTED for the corrected source.
                              The VSIX has now been built and its embedded
                              bundle verified, but it has NOT been installed
                              into the codium-roz profile and no live model
                              turn has been observed against it.
NEXT_ACTION:                  the separately scoped debug-only arming seam,
                              then the installed-live qualification against
                              THIS artifact.
ROUND C:                      unchanged and NOT re-litigated.
```

