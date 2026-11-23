# 04 — The artifact identity

## The build

    bun run build:sdk          EXIT 0
    apps/vscode bun run package EXIT 0

## The VSIX

    Path:   dist/clinemm-adjud-corr01.vsix
    Bytes:  65044927
    SHA256: 1c9cabff70b9891f6ad6f65bb6853db7a0309fa85da8fff4b7035c949054931f

## The bundled-bytes verification

The extension bundles `@cline/core` from the COMPILED `dist/`, so source-level
tests do NOT establish that the VSIX contains the final implementation. The
VSIX was therefore extracted and its `extension/dist/extension.js` inspected
DIRECTLY.

    verification/gate4-artifact-identity.txt

The receipt records:

1. the corrected markers present in the bundled bytes
   (`no_acquisition_record`, `missing_content_identity`,
   `evidence_has_no_source_identity`);
2. the P1 comparison in the bundle comparing `revision` +
   `repositoryIdentity` + `workspaceRootIdentity` — and NOT
   `contentIdentity`;
3. the PERSISTED flat acquisition shape in the bundle
   (`sourcePaths`, `contentIdentities`, `repositoryIdentity`,
   `workspaceRootIdentity`, `revision`, `clean`);
4. the predecessor's evaluation-time reason ABSENT
   (`no_revision_resolver`: 0 occurrences);
5. the capture at the tool boundary, resolving the revision ONCE from the
   OBSERVED sources.

## The packaging method

`vsce` invokes the package's `vscode:prepublish` npm script, and `npm` is not
installed on this substrate (bun is the package manager). The build was
therefore run FIRST through `bun run package`, the prepublish hook was
NEUTRALISED in the working copy for the packaging step only, and the
working copy's `package.json` was RESTORED afterwards. The lockfile-pinned
`apps/vscode/node_modules/.bin/vsce` was used, never a network-resolved
`bunx @vscode/vsce`.

This is the same shape the repository's own
`scripts/build_dogfood_vsix_lib.py` uses, which documents the same
constraint.
