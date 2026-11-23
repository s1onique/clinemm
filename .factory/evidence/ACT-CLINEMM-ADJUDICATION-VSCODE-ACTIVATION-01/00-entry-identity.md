# 00 — Entry identity and conservation (G0)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Authorization:** C1: GO
**Repository:** `s1onique/clinemm`

## G0.1 — Repository identity

All values were measured, never predicted.

```
$ git rev-parse HEAD
7490a12a58fbec73800f97c4b2346bde6b394725

$ git rev-parse --abbrev-ref HEAD
main

$ git worktree list
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm   7490a12a5 [main]
/private/tmp/clinemm-stash-recovery-20261117                 8b76c9e3e [recovery/protected-stash-20261117] prunable
/private/tmp/worktree-bun.7ddCHQ                            bbdccf8a2 (detached HEAD) prunable
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-action-first  38e726c45 [experiment/m31-action-first]
/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-m31-bounded      0366ea506 (detached HEAD)
```

| Field | Value |
|---|---|
| `ENTRY_HEAD` | `7490a12a58fbec73800f97c4b2346bde6b394725` |
| `ENTRY_BRANCH` | `main` |
| `ENTRY_WORKTREE` | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| `ENTRY_STATUS` | clean (only the two exempt untracked evidence directories, see below) |
| `PROTECTED_STASHES` | `git stash list` → empty at entry. The protected stash lives in the dedicated worktree `/private/tmp/clinemm-stash-recovery-20261117` on branch `recovery/protected-stash-20261117` (head `8b76c9e3e`), and was NOT touched. |
| `SOURCE_VERSION` | `4.1.26` (the `apps/vscode/package.json` version) |
| `INSTALLED_EXTENSION_VERSION` | `4.1.26-613295a95` |

### Ancestry verification

```
$ git merge-base --is-ancestor 613295a95f82f966e142aedec2d28fbb79c957cf HEAD && echo ANCESTOR_OK
ANCESTOR_OK
```

The expected source anchor `613295a95f82f966e142aedec2d28fbb79c957cf` IS an
ancestor of `ENTRY_HEAD`. The ACT brief's "verify ancestry and discover
actual `ENTRY_HEAD`" is satisfied: the anchor is the commit
`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION05`, and
`ENTRY_HEAD` is its descendant (`7490a12a5`, "docs(factory): preserve MCP
supervision and Round C recon evidence").

**No future commit SHA was predicted anywhere in this ACT.**

## G0.3 — Installed identity

```
$ ls ~/.vscodium-roz/extensions/ | grep clinemm
s1onique.clinemm-4.1.26-613295a95
s1onique.clinemm-4.1.26-a493eff07
```

| Field | Value |
|---|---|
| `EXTENSION_IDENTIFIER` | `s1onique.clinemm` (name `clinemm`, publisher `s1onique`) |
| `INSTALLED_VERSION` | `4.1.26-613295a95` |
| `INSTALLED_EXTENSION_PATH` | `/Volumes/UserData/Users/chistyakov/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-613295a95` |
| `INSTALLED_BUNDLE_SHA256` | `0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5` |
| `RUNNING_EXTENSION_HOST_IDENTITY` | NOT OBSERVED — see G9. The editor was not running during this ACT's structural phase. |

### The installed bundle's own provenance

The installed extension ships a `build-provenance.json` that declares its
own identity:

```json
{
  "schemaVersion": 1,
  "sourceHead": "613295a95f82f966e142aedec2d28fbb79c957cf",
  "extensionVersion": "4.1.26-613295a95",
  "sourcePackagePath": "apps/vscode/package.json",
  "sourcePackageSha256": "afb56cb537a3cfd6964bf68a516abf82eaa971e757daef1aa706795b34d615d0",
  "sourcePackageBytes": 24729,
  "bundledExtensionSha256": "0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5"
}
```

The `bundledExtensionSha256` it declares is **byte-identical** to the
SHA-256 computed independently from the installed `dist/extension.js`:

```
$ shasum -a 256 ~/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-613295a95/dist/extension.js
0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5
```

So the installed artifact IS the build of the expected source anchor
`613295a95`. The version metadata is corroborated by an independent byte
digest, not merely trusted.

### The installed bundle does NOT contain this ACT's change

```
$ grep -c 'adjudicationSessionSecrets\|AdjudicationTaskContractStore' \
    ~/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-613295a95/dist/extension.js
0
```

This is the EXPECTED and NECESSARY fact: the installed extension is the
PRE-ACT build, so it does not contain the activation adapter. It is the
reason a live installed qualification (G9) would require a rebuild and
reinstall — see `07-build-and-vsix-identity.md` and `08-installed-live-qualification.md`.

### The version metadata is NOT treated as runtime execution proof

The brief is explicit: "Do not treat version metadata as runtime execution
proof." This ACT records the installed bundle's BYTE IDENTITY (which is
objective and verifiable) and separately records that the RUNNING extension
host identity was NOT observed. The two facts are kept apart.

## G0.2 — Closed findings preserved

The ACT did NOT reopen, and did NOT change the behaviour of, any of:

- the historical M1 loss of thinking-only adjudications,
- acquisition-time evidence identity,
- durable acquisition records,
- multi-source revision compatibility,
- runtime evidence-handle origin validation,
- trailer payload separation,
- trailer pre-strip protection,
- the historical five-test RED.

The SDK's `adjudication-continuity.ts` and `compaction.ts` were NOT modified.
The existing successful source-level tests remain the baseline: the SDK's own
adjudication suites are untouched and still pass.

## Unexpected tracked dirt

**None.** The ACT's `git status --short` at entry and at every checkpoint
showed only:
- the ACT's own new files (the three host adapters, the two test files, the
  evidence package);
- the ACT's own modifications to the producer, the coordinator, the secret
  key list and the test configs.

`HALT_UNEXPECTED_TRACKED_DIRT` does **NOT** apply.

### The two exempt untracked directories

Both were left untouched — not staged, not cleaned, not folded into this ACT:

```
.factory/evidence/
  ACT-CLINEMM-MCP-SUPERVISION-V2-LIVE-QUAL01/

.factory/evidence/
  ACT-CLINEMM-ROUND-C-ADJUDICATION-CONVERGENCE-RECON-01/
```

They remain untracked. `git status --short --untracked-files=all .factory/`
shows no staged entry for either.

### One incidental, reverted modification

The base vitest suite regenerates
`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`
with a fresh `Generated:` timestamp. This is a pre-existing test side effect
of an UNRELATED ACT's evidence file, not a production change. It was
detected, inspected (a one-line timestamp diff), and reverted with
`git checkout --`. It is NOT part of this ACT's delta.
