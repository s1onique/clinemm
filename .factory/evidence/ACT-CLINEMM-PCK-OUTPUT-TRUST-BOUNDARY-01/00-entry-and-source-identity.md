# 00 — Entry identity, protected evidence and source identity

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01

ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
SUBJECT_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
FINAL_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
BRANCH: main
WORKTREE: /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
TRACKED_DIRT: NONE (git diff --stat HEAD is empty)
UNTRACKED_PATHS:
  ?? .factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/
  ?? sdk/packages/core/scripts/source-visibility-discriminator.generate.ts
  ?? sdk/packages/core/src/extensions/context/source-visibility-discriminator/
  (+ this ACT's own paths, listed in 09-executable-gates.md)
PROTECTED_STASHES: none existed; none popped; none mutated
BUN_VERSION: 1.4.4
VITEST_VERSION: ^4.0.18 (root package.json)
```

## G0.1 — Predecessor artifact status

The predecessor `ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01` was **NOT
committed**. Its 33 ACT-owned files remain untracked, exactly as its exit
report recorded (`git --no-pager status --porcelain=v1` at entry reproduced
the same three untracked roots).

This ACT therefore treats the predecessor's files as **protected evidence and
test sources**. They were read, never modified, never staged. The predecessor's
own evidence directory was NOT amended by this ACT.

```text
PREDECESSOR_ARTIFACT_STATUS: UNTRACKED_PROTECTED (not committed at entry,
  not committed by this ACT)
```

### Predecessor source-file identities (re-verified at entry)

The predecessor's own `artifact-hashes.json` records the SHA-256 of every
ACT-owned file it wrote. This ACT re-verified the SHA-256 of each file that
this ACT depends on, by re-computing the digest from disk.

| Path (under `sdk/packages/core/src/extensions/context/source-visibility-discriminator/`) | SHA-256 at entry |
|---|---|
| `projection.ts` | see `verification/predecessor-source-hashes.txt` |
| `trust.ts` | see `verification/predecessor-source-hashes.txt` |
| `candidate-views.ts` | see `verification/predecessor-source-hashes.txt` |
| `content-origin.ts` | see `verification/predecessor-source-hashes.txt` |
| `selection.ts` | see `verification/predecessor-source-hashes.txt` |
| `discriminator.fixture.ts` | see `verification/predecessor-source-hashes.txt` |
| `security-controls.test.ts` | see `verification/predecessor-source-hashes.txt` |
| `trust-provenance.test.ts` | see `verification/predecessor-source-hashes.txt` |
| `causal-ablation.test.ts` | see `verification/predecessor-source-hashes.txt` |
| `visibility-red.test.ts` | see `verification/predecessor-source-hashes.txt` |
| `selection.test.ts` | see `verification/predecessor-source-hashes.txt` |
| `reasoning-boundary.test.ts` | see `verification/predecessor-source-hashes.txt` |
| `model-evaluation.test.ts` | see `verification/predecessor-source-hashes.txt` |

The exact digests are in `verification/predecessor-source-hashes.txt`
(operator-local generation, committed as evidence).

## G0.2 — The frozen private artefacts

The six frozen private artefacts of the historical session
`1795466566666_uzla2` remain present at their operator-local paths and were
re-verified by digest (see `verification/frozen-artifact-hashes.txt`):

```text
pre.json             53161e6b3b4190951442dc37e89016a7d1b7e67898a01bc29d2bd250fe83efe1
post.json            c938f0e2174a3edf74ddb0580bc1918d25acd722d6d4e73c6c45c00c8463e191
second-pre.json      40a60baf6ca1fadf0cfe2d6bcfc2538b6e653dcf948af7c4bc98f91dfd3070e2
second-post.json     666c87977416a08fc54cffe7563b012866e40d790d1c57c227d6a76ecd05a807
first-compaction.json 49bff441c6cbcb0aa904aae8a80dcb567e6897a878986834764322b072fd845d
second-compaction.json 6bc0f6f9dfab122229dc52bc3954144db403ae234c63e26233dcbb02cd43b069
```

These artefacts are OPERATOR-LOCAL. They are never committed. The
historical-session witnesses (R2/R4/R6) are read through the predecessor's
self-skipping loader `discriminator.fixture.ts`; when the private capture root
is absent the historical assertions report `NOT_EXECUTED` instead of failing.

## G0.3 — Production-source delta

```text
PRODUCTION_DELTA: NONE
```

Every file this ACT writes is either

1. a NEW untracked file under
   `sdk/packages/core/src/extensions/context/output-trust-boundary/`, or
2. a NEW untracked file under
   `.factory/evidence/ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01/`.

No existing tracked file is modified. Verified by `git --no-pager diff --stat
HEAD` (empty) at entry and at exit, and by `git --no-pager status
--porcelain=v1` showing no ` M ` entry.

## G0 exit

```text
GO_TRUST_RECON
```
