# 01 — Entry identity and the frozen artefacts

ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

## The entry

```text
EXPECTED_PREDECESSOR = 1988a44ec71625c881b862e8f9dc116e77dbcac1
ENTRY_HEAD           = 1988a44ec71625c881b862e8f9dc116e77dbcac1
TRACKED_CLEANLINESS  = CLEAN (git status --porcelain -> 0 entries)
GIT_DIFF_CHECK       = CLEAN
PREDECESSOR_ANCESTRY = CONFIRMED (1988a44ec is HEAD)
```

The expected predecessor and the actual entry head are the same commit, so
the ACT started from the state the review described. The tree was clean and
there were no stashes.

## The frozen artefacts

Every identity was **VERIFIED**, not assumed. Each check throws on a
mismatch, so a changed artefact stops the ACT before any arm is assembled
and before any inference request is spent.

```text
FROZEN_PREFIX_IDENTITY
  boundary              = 244
  prefixHash            = sha256:00720111f28d759454e244ff70200e390b1b710e83e7e77e2136fe2bbe4c22fc
  fullCanonicalLength   = 246
  postBoundaryCount     = 2
  recomputed with       = computeSourcePrefixHash() (the PRODUCTION hash function)
  compared against      = the sidecar's own recorded source_prefix_hash
  VERDICT               = MATCH

FROZEN_SUMMARY_IDENTITY
  digest                = sha256:9ac862f0a4c1d4c56bca01978e61d5122603e3c3ba9dc2f795a81942bde1e93d
  chars                 = 4302
  estimatedTokens       = 1076
  VERDICT               = MATCH (recomputed from the artifact, compared with the frozen value)

FROZEN_SELECTION_IDENTITY (arm B)
  arm                   = SUBJECT_DIVERSITY
  budget                = 2048 estimated tokens
  selected indexes      = [143, 127, 227, 187, 141]
  VERDICT               = MATCH (the selection was RE-RUN with the same code, the
                          same signals and the same budget, and the resulting
                          index set is asserted to EQUAL the recorded one)
```

**No summary was regenerated.** The frozen ordinary summary artifact is read
from the gitignored private tree and its digest is re-verified on every run,
so a changed summary cannot silently alter the comparison.

**No candidate was re-ranked.** Arm B's selection is recomputed by the SAME
production selector with the SAME signals and the SAME budget, and the
script THROWS if the resulting index set differs from the recorded one. A
difference would be a failure of the freeze, not a re-ranking.

## The production projector

The predecessor's evaluation built a CONSTRUCTED summary context and never
appended the retained tail. This ACT uses the **production projector**:

```text
projectSessionCompactionState(sidecar, canonical) -> 53 messages
  compacted messages (the sidecar)  = 51
  retained tail (canonical 244,245) =  2
  internally consistent             = YES
```

The projector REFUSES the frozen state if the prefix identity does not
match, so an inconsistent arm cannot be built.

## The confidentiality position

The experimental evidence is:

- **private** — every raw context, prompt, answer and report is written only
  under the gitignored `tmp/utility-final-discriminator/` tree;
- **destination-authorized** — the single approved local endpoint from the
  operator's own settings;
- **confined** — no fragment is published to any other destination, and the
  arms are assembled through the PRODUCTION admission contract and the
  PRODUCTION publication renderer, so the refusal rules apply unchanged.

The carried section in arms B and C is byte-for-byte what the production
renderer emits. The experiment adds no new publication channel.
