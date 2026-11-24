# 02 — The reviewer's corrections, implemented and executed

ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01

The reviewer raised two P0 and two P1 findings against the predecessor ACT
(`COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01`). Each is
corrected here, in the source, executably.

## P0-A — Post-boundary contamination in the replay

### The defect, confirmed in the predecessor's source

`sdk/packages/core/scripts/knowledge-loss-discriminator.arms.ts:341-376`:

```ts
async function carryForwardAndAssemble(
	compactedMessages: readonly MessageWithMetadata[],
	canonicalMessages: readonly MessageWithMetadata[],
): Promise<MessageWithMetadata[]> {
	const contracted = await applyTaskContractToCompactedMessages(
		compactedMessages,
		canonicalMessages,
		{
			sourceMessageCount: canonicalMessages.length,
		} as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonicalMessages,
		{ sourceMessageCount: canonicalMessages.length },
	);
```

`canonicalMessages` is the FULL canonical history. `sourceMessageCount:
canonicalMessages.length` therefore makes the carry-forwards' "boundary
prefix" the whole history.

### The correction

`sdk/packages/core/src/extensions/context/bounded-evidence-contract/source-prefix.ts`
introduces the FROZEN prefix, and the corrected replay passes the FROZEN
PREFIX ITSELF as the canonical collection:

```ts
async function carryForwardAndAssemble(
	compactedMessages: readonly MessageWithMetadata[],
	frozenPrefix: readonly MessageWithMetadata[],
): Promise<MessageWithMetadata[]> {
	const contracted = await applyTaskContractToCompactedMessages(
		compactedMessages,
		frozenPrefix,
		{ sourceMessageCount: frozenPrefix.length } as never,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		frozenPrefix,
		{ sourceMessageCount: frozenPrefix.length },
	);
```

Because the carry-forwards derive their prefix with
`canonicalSourceMessages(canonicalMessages)`, passing the frozen prefix makes
them STRUCTURALLY INCAPABLE of observing anything after the boundary.

### The executable assertion

The corrected replay runs the carry-forward TWICE — once over the frozen
prefix, once over the frozen prefix plus a synthetic post-boundary
observation carrying the marker `SYNTHETIC-POST-BOUNDARY-OBSERVATION` — and
compares the two results.

### The measured result (W1, the decisive workload)

```text
frozenPrefix.boundary            = 244
frozenPrefix.prefixHash          = sha256:00720111f28d759454e244ff70200e390b1b710e83e7e77e2136fe2bbe4c22fc
frozenPrefix.fullCanonicalLength = 246
postBoundaryMessageCount          = 2

postBoundaryInvariant.identical           = true
postBoundaryInvariant.markerInClean       = false
postBoundaryInvariant.markerInContaminated = false
postBoundaryInvariant.cleanLength         = 88531
postBoundaryInvariant.contaminatedLength   = 88531
```

The prefix hash EQUALS the sidecar's recorded `source_prefix_hash`, so the
frozen prefix is the EXACT historical one. The continuation reconstructed at
the boundary is BYTE-IDENTICAL with and without a synthetic post-boundary
observation, and the marker appears in neither.

**The contamination window is closed and the closure is measured, not
asserted.**

## P0-B — The restoration control was not a restoration

### The defect, confirmed in the predecessor's source

`sdk/packages/core/scripts/knowledge-loss-discriminator.probe.ts:257-272`:

```ts
case "M":
	contextBlock = renderMinimalEvidenceBlock(
		canonical.slice(0, state.source_message_count),
	);
	break;
```

`renderMinimalEvidenceBlock()` builds a NEW context from the evidence
references of ALL oracle items. It does not append to A0. The reviewer's
table is exact:

| Experimental property | Required M | Actual M |
| --- | --- | --- |
| Base context | A0 compacted continuation | Newly constructed evidence view |
| Missing evidence | Minimal relevant fragment | Evidence for all oracle items |
| Existing summary | Preserved | Replaced |
| Existing task context | Preserved | Potentially changed |
| Unrelated context | Unchanged | Changed |

### The correction

`sdk/packages/core/scripts/bounded-evidence-contract.probe.ts` builds the
GENUINE control:

```ts
case "A0O4":
case "A0O7": {
	const itemId = armId === "A0O4" ? "O4" : "O7";
	const base = renderContextBlock(
		JSON.parse(readFileSync(a0Path, "utf8")) as MessageWithMetadata[],
	);
	const fragment = renderEvidenceFragmentForItem(
		itemId,
		canonical.slice(0, state.source_message_count),
	);
	contextBlock = `${base}\n\n=== RESTORED ORIGINAL EVIDENCE (${itemId}) ===\n${fragment}`;
	break;
}
```

The base is A0's own rendered continuation, BYTE FOR BYTE. The ONLY
difference is the appended fragment, which is the tool's OWN output — not an
oracle-authored answer — taken from the oracle's own evidence references.

The removal control is A0 itself: `A0O4` minus the fragment IS `A0`.

## P1-C — One arm's availability map was applied to every arm

### The defect, confirmed in the predecessor's source

`sdk/packages/core/scripts/knowledge-loss-discriminator.s3-score.ts:67-69`:

```ts
const s2Scores = new Map(
	(arms.arms.A0?.scores ?? []).map((s) => [s.oracleItemId, s.score]),
);
```

and line 126:

```ts
(s2Scores.get(result.oracleItemId) ?? "UNOBSERVABLE") !== "OMITTED";
```

Two consequences: an item missing in A0 was classified as missing in A1 even
when A1 preserved it, and `PARTIALLY_PRESERVED` and `UNOBSERVABLE` counted
as "available".

### The correction

`sdk/packages/core/src/extensions/context/bounded-evidence-contract/availability.ts`
introduces a CLOSED and TOTAL mapping from the closed scoring vocabulary to
an availability verdict:

| S2 score | Availability |
| --- | --- |
| `PRESERVED` | `AVAILABLE` |
| `PARTIALLY_PRESERVED` | `PARTIAL` |
| `OMITTED` / `DISTORTED` / `CONTRADICTED` / `UNSUPPORTED_STRENGTHENING` | `MISSING` |
| `UNOBSERVABLE` / `NOT_APPLICABLE` / absent | `UNOBSERVABLE` |

The corrected scorer builds ONE map PER ARM, from that arm's own scores, and
the classification vocabulary replaces the predecessor's over-strong claim:

```text
INFORMATION_AVAILABLE_AND_USED
MODEL_INTERPRETATION_FAILURE_CANDIDATE   <- was INFORMATION_AVAILABLE_BUT_IGNORED
PARTIAL_INFORMATION_AVAILABLE             <- new
INFORMATION_MISSING_AFTER_COMPACTION
INFORMATION_PRESENT_BUT_DISTORTED
UNSCORABLE
```

## P1-D — W2 was scored with the W1 oracle

### The defect

The predecessor's secondary-workload scoring applied `W1_KNOWLEDGE_ORACLE`
to W2's contexts. W2's boundary is 76 of 114 canonical messages, against
W1's 244 of 246 — a much earlier boundary.

### The correction

`sdk/packages/core/scripts/bounded-evidence-contract.w2-qualification.ts`
answers the question from W2's OWN source prefix, using the SAME assertion
matcher the S2 inventory uses.

### The measured result

```text
sessionId                    = 1795489471969_tachv
boundary                     = 76
fullCanonicalLength          = 114
postBoundaryMessageCount     = 38
oracleItemsConsidered        = 12
admittedAsAcquiredKnowledge  = 7
admittedItemIds              = O1, O2, O3, O5, O8, O11, O12
notAdmittedItemIds           = O4, O6, O7, O9, O10
```

**O4 and O7 — the two propositions the predecessor counted as "W2 S2 = 3
critical omitted" — were NEVER acquired by W2 at its own boundary.** They are
not in W2's source prefix at all. W2 could not have lost them, because it
never had them.

The predecessor's W2 corroboration of the loss was therefore an artefact of
applying W1's oracle to a session that had not acquired W1's knowledge. This
is exactly the qualification the reviewer required:

```text
REAL_WORKLOADS_ACQUIRED=2
INDEPENDENT_SEMANTIC_LOSS_REPRODUCTIONS=1
SECONDARY_WORKLOAD_CORROBORATION=QUALIFIED
```
