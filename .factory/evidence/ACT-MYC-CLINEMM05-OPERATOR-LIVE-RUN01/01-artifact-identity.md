# 01 — Dogfood Artifact Identity

Source of truth: dist/dogfood/clinemm-4.1.16-89249175c.vsix,
                installed at /Volumes/UserData/Users/chistyakov/.vscodium-cline/extensions/s1onique.clinemm-4.1.16-89249175c/

## Identity fields

```text
DOGFOOD_SOURCE_HEAD         = 89249175c71fcbc059d26d54f5c50f7f6dbd3373
INSTALLED_EXTENSION_VERSION = 4.1.16-89249175c
VSIX_PATH                   = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/dogfood/clinemm-4.1.16-89249175c.vsix
VSIX_BYTE_SIZE              = 14625242
VSIX_SHA256                 = d5399a250acdcf1c824404094360f7059259db74682f106e02be4719f5dca040
INSTALLED_EXTENSION_PATH    = /Volumes/UserData/Users/chistyakov/.vscodium-cline/extensions/s1onique.clinemm-4.1.16-89249175c/
INSTALLED_PROFILE           = /Volumes/UserData/Users/chistyakov/.vscodium-cline
INSTALL_TIMESTAMP           = Sep 28 16:08 (matches HEAD commit ts)
```

## SHA256 verification

```bash
$ shasum -a 256 dist/dogfood/clinemm-4.1.16-89249175c.vsix
d5399a250acdcf1c824404094360f7059259db74682f106e02be4719f5dca040  dist/dogfood/clinemm-4.1.16-89249175c.vsix
```

## Source → VSIX → install coherence

```text
HEAD commit       : 89249175c (fix(mcp): bound per-session post-connect discovery)
HEAD commit ts    : Mon Sep 28 16:04:52 2026 +0300
VSIX packaging    : "vsce package" derives dist/extension.js from the HEAD source tree
VSIX file ts      : Sep 28 16:08 (4 minutes after HEAD commit)
Install path ts   : Sep 28 16:08 (same minute as VSIX file ts)
```

The bounded-bootstrap repair (`+95/-18` in `McpHub.ts`) is the only
production change between the previous ACT's dogfood build
(`clinemm-4.1.16-8fdde3fb5.vsix`,
sha256 `36521b02c1976f2b350ffcdcd2859d2f534ca54ef3a5b52e6d093b10872fcb6d`,
14625002 bytes) and this ACT's dogfood build. The two VSIX SHA256s are
distinct, confirming a real rebuild and not a stale reuse.

## Required repair content present in the install

The 89249175c McpHub.ts patch (the FINALIZATION-RUN-BOOTSTRAP-STALL01
repair) is part of the bundled dist/extension.js in the VSIX and
therefore present in the installed extension. The patch replaces an
unbounded `Promise.allSettled` aggregate over `client.listTools`/
`listResources`/`listResourceTemplates`/`listPrompts` with
capability-aware, per-request-timeout `client.request(...)` calls.

## Halt evaluation

```text
HALT_INSTALLED_ARTIFACT_IDENTITY_UNPROVEN = false
```

## Conservation

```text
AUTOSTART01 startup projection                       preserved
AUTOSTART01 CORRECTION01 teardown projection         preserved
FINALIZATION-RUN-BOOTSTRAP-STALL01 bounded discovery present (HEAD commit)
```