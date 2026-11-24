# 01 — Predecessor artifact status

## The question G0.2 asks

The predecessor's targeted digest reported approximately 30 ACT-owned
**untracked** files, including its probe implementation and evidence. The ACT
therefore must NOT assume the predecessor was committed merely because its
evidence report says "complete".

## Determination

```text
PREDECESSOR_ARTIFACT_STATUS: COMMITTED
```

The predecessor's ACT is the repository's HEAD~0 at entry:

```text
$ git --no-pager log --oneline -3
0f111f3d7 ACT-CLINEMM-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01: reproduce the compaction knowledge loss and bound the checkpoint carrier
502d31c58 ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION02: keep the host-private adjudication records out of the webview-facing state
dbed460e7 ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01: record the packaging and the embedded-bundle identity
```

`502d31c58` is the ACT's stated historical anchor and is the predecessor's
own `FINAL_HEAD`. The predecessor was committed as `0f111f3d7`.

Consequently **none** of the predecessor's files is untracked at this ACT's
entry. The ACT's entry dirt consists only of its own two new paths.

## Identity verification

Every predecessor source file's SHA-256 was recomputed and compared with the
predecessor's own `artifact-hashes.json`. **All thirteen matched exactly.**

```text
f231690d9e2cbd66859d4d6e51d6d92aacb95da8a7f25878a7f33ce3b03290f8  knowledge-checkpoint-probe/checkpoint-binding.ts
31335097735791f480f6e89f9933b6c3bb5914b8a8400c4c36e79385a76d1d0b  knowledge-checkpoint-probe/checkpoint-historical-baseline.test.ts
45b44261f6dff0e81ad260e1851173650f324ca73efa817b902d7f845dc0348f  knowledge-checkpoint-probe/checkpoint-model-treatment.test.ts
d20fa76b0892e22e21795c4223e81a56b598bc22e9eb8ed095ca41ccaf5c90d7  knowledge-checkpoint-probe/checkpoint-probe.fixture.ts
07211fcd9ad76096d3097ec000de741c49828c317f4b3a9dcbe2cc9606b07327  knowledge-checkpoint-probe/checkpoint-projection.test.ts
9ce0df50acaab5e97f2106bb552940e3d844c78ce250dbf6a055157b08e422c0  knowledge-checkpoint-probe/checkpoint-projection.ts
6bc68bca3c68e7f7aa987bd684dd6301239f4d14d69244cb9461ea035fb03c0a  knowledge-checkpoint-probe/checkpoint-request.ts
14f4f0d9502265f9c549ab0aaa9ee7ec7859d79e1af76456c51989354382fe8e  knowledge-checkpoint-probe/checkpoint-schema.ts
4cbf4a1bab57389b4da1b8e3855c4f092a340618743ea90ebb2ce3a34c27ccbd  knowledge-checkpoint-probe/checkpoint-seam.ts
d583bb3c2f817ef60c4f34e6aeec4fab345c71f9d866d40d2baa4767fd3dc4fc  knowledge-checkpoint-probe/checkpoint-security-controls.test.ts
b793653152d09f6b02efa27bb8eb328a162fe134403efcba0f6c143628db61ae  knowledge-checkpoint-probe/checkpoint-validation.ts
4458f22d49bcafb18e4a415ffbffec11341a91d7252abf26eebe479b51be80b6  scripts/knowledge-checkpoint-probe.generate.ts
```

No predecessor artifact is missing. No hash disagrees. Nothing had to be
stopped.

## The predecessor's operator-local artifacts

The predecessor's raw model output was deliberately kept OUT of Git. It
survives in the repository's gitignored `tmp/` tree:

```text
tmp/pck-probe-private/1795466566666_uzla2/checkpoint-boundary-1.json   (mode 0600)
tmp/pck-probe-private/1795466566666_uzla2/checkpoint-boundary-2.json   (mode 0600)
tmp/pck-probe-private/1795466566666_uzla2/checkpoint-generation-receipt.json
```

This ACT READ those files (they are the historical model output the G5
record-selection discriminator must run against). They were NOT modified,
NOT staged, and NOT committed. They remain operator-local.

## Frozen private capture artifacts

All six frozen artifacts were re-hashed at this ACT's entry and match the
ACT's recorded identities exactly:

```text
53161e6b3b4190951442dc37e89016a7d1b7e67898a01bc29d2bd250fe83efe1  pre.json                MATCH
c938f0e2174a3edf74ddb0580bc1918d25acd722d6d4e73c6c45c00c8463e191  post.json               MATCH
40a60baf6ca1fadf0cfe2d6bcfc2538b6e653dcf948af7c4bc98f91dfd3070e2  second-pre.json         MATCH
666c87977416a08fc54cffe7563b012866e40d790d1c57c227d6a76ecd05a807  second-post.json        MATCH
49bff441c6cbcb0aa904aae8a80dcb567e6897a878986834764322b072fd845d  first-compaction.json   MATCH
6bc0f6f9dfab122229dc52bc3954144db403ae234c63e26233dcbb02cd43b069  second-compaction.json  MATCH
```

## Canonical boundary correlation

The production v2 source-prefix hash (`sourcePrefixHash()` in
`sdk/packages/core/src/session/models/session-compaction.ts`) was reproduced
over the canonical transcript:

```text
Boundary 1:
  captures             15 -> 16
  source_message_count 47
  source_prefix_hash   sha256:54936f46c7034de73268c085d551d227e1bbced8225e41757d42a22b90a3dbf9   MATCH
  source_last_message_key  id:msg_ApSB6S4t
  canonical[46].id          msg_ApSB6S4t   (the boundary key agrees with the
                                            canonical message AT the boundary)

Boundary 2:
  captures             33 -> 34
  source_message_count 101
  source_prefix_hash   sha256:df3d0a481febff3f3c8d5581e930faed80112c9bef8c7e4b609da7136d4c5409   MATCH
  source_last_message_key  id:msg_3d6nueiy
  canonical[100].id         msg_3d6nueiy   (the boundary key agrees with the
                                            canonical message AT the boundary)
```

The correlation is by the production algorithm over the canonical history,
**not** by provider-visible message counts.

## The P2 hygiene item

The targeted digest's invalid legacy `.factory/gate-summary.json` is a
SEPARATE P2 hygiene item. This ACT does not depend on it, did not modify it,
and does not report it as an authoritative gate result.
