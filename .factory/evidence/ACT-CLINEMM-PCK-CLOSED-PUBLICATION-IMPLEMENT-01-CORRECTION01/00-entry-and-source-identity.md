# 00 — Entry and source identity

```text
ACT:           ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01
ENTRY_HEAD:    a99b7187f0192f408608f25896da2bedcd56ed01
PREDECESSOR:   ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
CORRECTION:    ONE bounded correction cycle, authorised by the review.
SCOPE:         Correct false observation assurance; execute the canonical
               reference confidentiality discriminator and repair only if
               reproduced; correct the real-model qualification lifecycle;
               refresh exact-head focused executable evidence; commit the
               bounded correction; preserve both predecessor evidence trees.
NOT IN SCOPE:  Build, package, or install anything.
```

## 0.1 — The entry HEAD and its ancestry

```text
a99b7187f  ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01: implement the
            default-off closed pre-compaction knowledge checkpoint
0f111f3d7  ACT-CLINEMM-PCK-PRECOMPACTION-KNOWLEDGE-CHECKPOINT-PROBE-01
502d31c58  ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION02
```

The correction is applied ON TOP of the reviewed implementation. It does not
reopen the architecture investigation.

## 0.2 — The predecessor evidence trees are PRESERVED

```text
.factory/evidence/ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01/
.factory/evidence/ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01/
.factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/
```

Neither tree is modified, moved or rewritten by this ACT. The correction's
own evidence lives in a NEW tree:

```text
.factory/evidence/ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01/
```

## 0.3 — The files the correction touches

```text
sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/
  evidence.ts                          the ATOM-SCOPED interpreter + the tool
                                       event ledger
  publication-gate.ts                  the OPAQUE ALIAS TABLE
  runtime.ts                           the interpreter call site
  pck-closed-contract.test.ts          G3.5 corrected
  pck-conservation-ablation.test.ts    G7.4d corrected
  pck-observation-assurance.red01.test.ts     NEW — the P0-1 discriminator
  pck-reference-confidentiality.test.ts        NEW — the P0-2 discriminator

sdk/packages/core/scripts/
  pck-closed-contract.model-gate.ts    the provider call moved INSIDE the
                                       production attempt

sdk/packages/core/
  vitest.red.pck-observation-assurance.config.ts   NEW — the isolated config
  package.json                         the two new scripts
```

## 0.4 — The source identity at the corrected HEAD

The corrected source identity is recorded by the commit that this ACT
produces. The commit hash is the ONLY authority; no receipt in this tree
claims an identity it does not itself bind.
